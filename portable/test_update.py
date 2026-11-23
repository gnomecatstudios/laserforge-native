import hashlib
from contextlib import nullcontext
import importlib.util
import io
import json
from pathlib import Path
import socket
import struct
import tempfile
import unittest
from urllib.error import URLError
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('laserforge_update', Path(__file__).with_name('update.py'))
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class UpdateTests(unittest.TestCase):
    def test_opening_without_arguments_launches_on_every_supported_platform(self):
        for platform_id in sorted(updater.PLATFORMS):
            with self.subTest(platform=platform_id), \
                    patch.object(updater, 'metadata', return_value={'platform': platform_id, 'version': '0.2.1'}), \
                    patch.object(updater, 'lock', return_value=nullcontext()), \
                    patch.object(updater, 'launch', return_value=0) as launch:
                self.assertEqual(updater.main([]), 0)
                launch.assert_called_once()

    def test_explicit_check_does_not_launch(self):
        with patch.object(updater, 'metadata', return_value={'platform': 'raspberry-pi-arm64', 'version': '0.2.1'}), \
                patch.object(updater, 'latest', return_value=None) as latest, \
                patch.object(updater, 'launch') as launch:
            self.assertEqual(updater.main(['--check']), 0)
            latest.assert_called_once_with('0.2.1', 'raspberry-pi-arm64')
            launch.assert_not_called()

    def test_conflicting_actions_still_exit_with_usage_error(self):
        with self.assertRaises(SystemExit) as error:
            updater.main(['--check', '--launch'])
        self.assertEqual(error.exception.code, 2)

    def package(self, extra=None):
        header = bytearray(64)
        header[:4] = b'\x7fELF'
        header[4:6] = bytes([2, 1])
        struct.pack_into('<H', header, 18, 62)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as bundle:
            bundle.writestr('LaserForge-Portable/LaserForge-Portable', header)
            bundle.writestr('LaserForge-Portable/release.json', json.dumps({'platform': 'linux-x64', 'version': '0.3.0'}))
            bundle.writestr('LaserForge-Portable/Fonts/font.ttf', b'new font')
            if extra:
                bundle.writestr(extra, b'bad')
        return output.getvalue()

    def installed(self, root):
        (root / 'release.json').write_text(json.dumps({'platform': 'linux-x64', 'version': '0.2.1'}))
        (root / 'LaserForge-Portable').write_bytes(b'old binary')
        (root / 'project.olaser').write_bytes(b'my project')

    def network(self, payload, checksum=None):
        name = 'LaserForge-Portable-linux-x64-v0.3.0.zip'
        def asset(name, size):
            return {'name': name, 'size': size, 'state': 'uploaded',
                    'browser_download_url': f'{updater.BASE}/download/v0.3.0/{name}'}
        release = {'tag_name': 'v0.3.0', 'draft': False, 'prerelease': False,
                   'html_url': f'{updater.BASE}/tag/v0.3.0',
                   'assets': [asset(name, len(payload)), asset('SHA256SUMS.txt', 100)]}
        sums = f'{checksum or hashlib.sha256(payload).hexdigest()}  {name}\n'.encode()
        def fetch(url, limit):
            if url == updater.API:
                return json.dumps(release).encode()
            return sums if url.endswith('SHA256SUMS.txt') else payload
        return fetch

    def test_download_apply_and_preserve_projects(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.installed(root)
            with patch.object(updater, 'host_platform', return_value='linux-x64'), \
                    patch.object(updater, 'ensure_stopped'), \
                    patch.object(updater, 'fetch', side_effect=self.network(self.package())):
                self.assertEqual(updater.download(root), '0.3.0')
                self.assertEqual((root / 'LaserForge-Portable').read_bytes(), b'old binary')
                self.assertTrue(updater.apply_pending(root))
                self.assertEqual(updater.metadata(root)['version'], '0.3.0')
                self.assertEqual((root / 'Fonts/font.ttf').read_bytes(), b'new font')
                self.assertEqual((root / 'project.olaser').read_bytes(), b'my project')
                self.assertEqual((root / 'LaserForge-Portable').stat().st_mode & 0o777, 0o755)
                self.assertFalse((root / '.pending-update.zip').exists())
                self.assertIsNone(updater.download(root))

    def test_corrupt_download_does_not_stage_or_modify_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.installed(root)
            with patch.object(updater, 'host_platform', return_value='linux-x64'), \
                    patch.object(updater, 'fetch', side_effect=self.network(self.package(), '0' * 64)):
                with self.assertRaisesRegex(ValueError, 'mismatch'):
                    updater.download(root)
            self.assertFalse((root / '.pending-update.zip').exists())
            self.assertEqual((root / 'LaserForge-Portable').read_bytes(), b'old binary')

    def test_rejects_traversal_and_unexpected_files(self):
        for extra in ('../escape', '/escape', 'LaserForge-Portable/../escape',
                      'LaserForge-Portable/Fonts/../../escape', 'LaserForge-Portable/evil.sh'):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / 'test.zip'
                archive.write_bytes(self.package(extra))
                with self.assertRaises(ValueError):
                    updater.unpack(archive, root / 'out', 'linux-x64', '0.3.0')
                self.assertFalse((root / 'out').exists())

    def test_mid_install_failure_restores_previous_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.installed(root)
            previous = (root / 'release.json').read_bytes()
            payload = self.package()
            (root / '.pending-update.zip').write_bytes(payload)
            original = Path.replace
            def fail_release(source, destination):
                if source.name == 'release.json' and '.apply-' in str(source):
                    raise OSError('simulated write failure')
                return original(source, destination)
            with patch.object(updater, 'host_platform', return_value='linux-x64'), \
                    patch.object(updater, 'ensure_stopped'), \
                    patch.object(updater, 'fetch', side_effect=self.network(payload)), \
                    patch.object(Path, 'replace', fail_release):
                with self.assertRaisesRegex(OSError, 'simulated'):
                    updater.apply_pending(root)
            self.assertEqual((root / 'LaserForge-Portable').read_bytes(), b'old binary')
            self.assertEqual((root / 'release.json').read_bytes(), previous)
            self.assertFalse((root / 'Fonts/font.ttf').exists())
            self.assertTrue((root / '.pending-update.zip').exists())

    def test_host_detection_uses_process_bitness_on_32bit_pi_os(self):
        with patch.object(updater.sys, 'platform', 'linux'), \
                patch.object(updater.platform, 'machine', return_value='aarch64'), \
                patch.object(updater.struct, 'calcsize', return_value=4):
            self.assertEqual(updater.host_platform(), 'raspberry-pi-arm32')

    def test_rejects_wrong_executable_architecture(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'test.zip'
            archive.write_bytes(self.package())
            with self.assertRaisesRegex(ValueError, 'architecture'):
                updater.unpack(archive, root / 'out', 'raspberry-pi-arm64', '0.3.0')

    def test_refuses_apply_when_native_server_is_running(self):
        with patch.object(updater.socket, 'socket') as factory:
            factory.return_value.__enter__.return_value.bind.side_effect = OSError('in use')
            with self.assertRaisesRegex(ValueError, 'Close Laser Forge'):
                updater.ensure_stopped()

    def test_kernel_lock_prevents_concurrent_updaters(self):
        with tempfile.TemporaryDirectory() as directory:
            with updater.lock(Path(directory)):
                with self.assertRaisesRegex(ValueError, 'already running'):
                    with updater.lock(Path(directory)):
                        pass

    def test_offline_pending_update_still_starts_installed_app(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(updater, 'ensure_stopped'), \
                    patch.object(updater, 'apply_pending', side_effect=URLError('offline')), \
                    patch.object(updater.threading, 'Thread'), \
                    patch.object(updater.subprocess, 'Popen') as process:
                process.return_value.wait.return_value = 0
                self.assertEqual(updater.launch(root), 0)
                process.assert_called_once_with([str(root / 'LaserForge-Portable')], cwd=root)

    def test_tampered_cached_update_cannot_replace_installed_binary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.installed(root)
            payload = self.package()
            tampered = bytearray(payload)
            tampered[0] ^= 1
            (root / '.pending-update.zip').write_bytes(tampered)
            with patch.object(updater, 'host_platform', return_value='linux-x64'), \
                    patch.object(updater, 'ensure_stopped'), \
                    patch.object(updater, 'fetch', side_effect=self.network(payload)):
                with self.assertRaisesRegex(ValueError, 'differs'):
                    updater.apply_pending(root)
            self.assertEqual((root / 'LaserForge-Portable').read_bytes(), b'old binary')


if __name__ == '__main__':
    unittest.main()
