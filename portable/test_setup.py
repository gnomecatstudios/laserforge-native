import hashlib
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('laserforge_setup', Path(__file__).with_name('setup.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def fixture(self, root, machine=183):
        source = root / 'download'
        source.mkdir()
        header = bytearray(20)
        header[:4] = b'\x7fELF'
        header[5] = 1
        struct.pack_into('<H', header, 18, machine)
        (source / 'LaserForge-Portable').write_bytes(header)
        (source / 'Fonts').mkdir()
        (source / 'Fonts/font.ttf').write_bytes(b'font')
        (source / 'icon.png').write_bytes(b'\x89PNG\r\n\x1a\nicon')
        return source

    def test_installs_arm64_with_executable_shortcuts_and_fonts(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = self.fixture(root)
            desktop = root / 'Desktop'
            desktop.mkdir()
            data = root / 'data with spaces'
            target = setup.install(source, data, desktop, 'aarch64')
            self.assertEqual((target / 'LaserForge-Portable').stat().st_mode & 0o777, 0o755)
            self.assertEqual((target / 'Fonts/font.ttf').read_bytes(), b'font')
            icon = (source / 'icon.png').read_bytes()
            self.assertEqual((target / 'icon.png').read_bytes(), icon)
            themed = data / 'icons/hicolor/192x192/apps' / ('laserforge-' + hashlib.sha256(icon).hexdigest()[:12] + '.png')
            self.assertEqual(themed.read_bytes(), icon)
            shortcut = (data / 'applications/laserforge.desktop').read_text()
            self.assertIn('Exec="' + str(target / 'LaserForge-Portable') + '"', shortcut)
            self.assertIn('Icon=' + str(themed), shortcut)
            self.assertEqual((desktop / 'Laser Forge.desktop').read_text(), shortcut)
            setup.install(source, data, desktop, 'aarch64')  # Reinstall safely.

    def test_reinstall_refreshes_cached_icon_path(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = self.fixture(root)
            desktop = root / 'Desktop'
            desktop.mkdir()
            data = root / 'data'
            setup.install(source, data, desktop, 'aarch64')
            shortcut = data / 'applications/laserforge.desktop'
            old = shortcut.read_text()
            (source / 'icon.png').write_bytes(b'\x89PNG\r\n\x1a\nnew logo')
            setup.install(source, data, desktop, 'aarch64')
            new = shortcut.read_text()
            self.assertNotEqual(old, new)
            self.assertEqual((desktop / 'Laser Forge.desktop').read_text(), new)
            icon_path = Path(next(line[5:] for line in new.splitlines() if line.startswith('Icon=')))
            self.assertEqual(icon_path.read_bytes(), (source / 'icon.png').read_bytes())

    def test_rejects_missing_or_invalid_icon_before_installing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = self.fixture(root)
            (source / 'icon.png').write_bytes(b'not a png')
            with self.assertRaisesRegex(ValueError, 'invalid Laser Forge icon'):
                setup.install(source, root / 'data', machine='aarch64')
            self.assertFalse((root / 'data').exists())
            (source / 'icon.png').unlink()
            with self.assertRaises(FileNotFoundError):
                setup.install(source, root / 'data', machine='aarch64')
            self.assertFalse((root / 'data').exists())

    def test_new_setup_uses_update_launcher_and_copies_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = self.fixture(root)
            (source / 'update.py').write_text('# helper')
            (source / 'release.json').write_text('{"platform":"raspberry-pi-arm64","version":"0.3.0"}')
            target = setup.install(source, root / 'data', machine='aarch64')
            self.assertEqual((target / 'update.py').read_text(), '# helper')
            self.assertTrue((target / 'release.json').is_file())
            shortcut = (root / 'data/applications/laserforge.desktop').read_text()
            self.assertIn('Exec=python3 "' + str(target / 'update.py') + '" --launch', shortcut)

    def test_rejects_x64_download_on_pi_before_writing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = self.fixture(root, 62)
            with self.assertRaisesRegex(ValueError, 'does not match'):
                setup.install(source, root / 'data', machine='aarch64')
            self.assertFalse((root / 'data').exists())

    def test_rejects_non_executable_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = self.fixture(root)
            (source / 'LaserForge-Portable').write_bytes(b'not an executable')
            with self.assertRaises(ValueError):
                setup.install(source, root / 'data', machine='aarch64')

    def test_desktop_exec_escapes_shell_characters(self):
        self.assertEqual(setup.desktop_quote('/a/$b%"'), '"/a/\\$b%%\\""')


if __name__ == '__main__':
    unittest.main()

