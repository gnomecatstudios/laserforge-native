import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('parity', ROOT / 'scripts/verify-portable-parity.py')
parity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parity)


class ParityTests(unittest.TestCase):
    def test_missing_editor_asset_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            dist = root / 'dist'
            dist.mkdir()
            (dist / 'index.html').write_bytes(b'editor entry')
            (dist / 'text.wasm').write_bytes(b'complex script shaping')
            version = json.loads((ROOT / 'package.json').read_text())['version']
            metadata = json.dumps({'platform': 'windows-x64', 'version': version}) + '\n'
            for complete in [True, False]:
                with zipfile.ZipFile(root / f'LaserForge-Portable-windows-x64-v{version}.zip', 'w') as bundle:
                    prefix = 'LaserForge-Portable/'
                    bundle.writestr(prefix + 'release.json', metadata)
                    bundle.writestr(prefix + 'LaserForge-Portable.exe',
                                    metadata.encode() + b'editor entry' +
                                    (b'complex script shaping' if complete else b''))
                    for name in ['update.py', 'Fonts/Geist-500.ttf', 'Fonts/OFL.txt', 'Start-LaserForge.cmd']:
                        bundle.write(ROOT / 'portable' / name, prefix + name)
                if complete:
                    parity.verify(root, dist, ['windows-x64'])
                else:
                    with self.assertRaisesRegex(ValueError, 'text.wasm'):
                        parity.verify(root, dist, ['windows-x64'])
