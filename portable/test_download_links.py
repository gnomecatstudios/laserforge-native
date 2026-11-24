import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('download_links', ROOT / 'scripts/update-download-links.py')
links = importlib.util.module_from_spec(spec)
spec.loader.exec_module(links)

PLATFORMS = ['windows-x64', 'linux-x64', 'RPi-ARM64', 'RPi-ARM32']


class DownloadLinksTest(unittest.TestCase):
    def test_links_match_the_package_version(self):
        version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
        for name in links.DOCS:
            text = (ROOT / name).read_text(encoding='utf-8')
            self.assertEqual(links.update(text, version), text,
                             f'{name} links are not for v{version}: run scripts/update-download-links.py {version}')

    def test_download_tables_link_every_platform(self):
        version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
        for name in ['README.md', 'portable/README.md', 'portable/public-downloads-README.md']:
            text = (ROOT / name).read_text(encoding='utf-8')
            for platform in PLATFORMS:
                self.assertIn(f'/releases/download/v{version}/LaserForge-Portable-{platform}-v{version}.zip', text, name)
            self.assertIn(f'/releases/download/v{version}/SHA256SUMS.txt', text, name)

    def test_update_moves_zip_and_checksum_links_to_the_new_version(self):
        base = 'https://github.com/gnomecatstudios/laserforge-native/releases/download'
        before = (f'[ARM32]({base}/v3.0.0/LaserForge-Portable-RPi-ARM32-v3.0.0.zip) '
                  f'[sums]({base}/v3.0.0/SHA256SUMS.txt) [all](https://github.com/x/releases)')
        self.assertEqual(links.update(before, '3.0.1'),
                         f'[ARM32]({base}/v3.0.1/LaserForge-Portable-RPi-ARM32-v3.0.1.zip) '
                         f'[sums]({base}/v3.0.1/SHA256SUMS.txt) [all](https://github.com/x/releases)')


if __name__ == '__main__':
    unittest.main()
