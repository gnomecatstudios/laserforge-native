#!/usr/bin/env python3
"""Check native packages contain the complete production web app without executing them."""
import argparse
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def verify(downloads, dist, targets):
    assets = [(p.relative_to(dist).as_posix(), p.read_bytes())
              for p in sorted(dist.rglob('*')) if p.is_file()]
    if not any(name == 'index.html' for name, _ in assets):
        raise ValueError('Production dist/index.html is required')
    version = json.loads((ROOT / 'package.json').read_text())['version']
    for target in targets:
        path = downloads / ('LaserForge-Portable-' + {'raspberry-pi-arm64': 'RPi-ARM64', 'raspberry-pi-arm32': 'RPi-ARM32'}.get(target, target) + f'-v{version}.zip')
        with zipfile.ZipFile(path) as bundle:
            prefix = 'LaserForge-Portable/'
            executable = 'LaserForge-Portable' + ('.exe' if target == 'windows-x64' else '')
            binary = bundle.read(prefix + executable)
            metadata = {'platform': target, 'version': version}
            if json.loads(bundle.read(prefix + 'release.json')) != metadata:
                raise ValueError(f'{target}: release metadata differs')
            if (json.dumps(metadata) + '\n').encode() not in binary:
                raise ValueError(f'{target}: embedded platform metadata differs')
            for name, content in assets:
                # Go embed stores file contents verbatim on every target.
                if content and content not in binary:
                    raise ValueError(f'{target}: missing or stale embedded asset {name}')
            for name in ['update.py', 'Fonts/Geist-500.ttf', 'Fonts/OFL.txt']:
                if bundle.read(prefix + name) != (ROOT / 'portable' / name).read_bytes():
                    raise ValueError(f'{target}: missing or stale companion {name}')
            if target == 'windows-x64':
                if bundle.read(prefix + 'Start-LaserForge.cmd') != (ROOT / 'portable/Start-LaserForge.cmd').read_bytes():
                    raise ValueError('Windows update launcher differs')
        print(f'Verified {target}: {len(assets)} shared app assets and offline/update companions')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--downloads', type=Path, default=ROOT / 'portable/downloads')
    parser.add_argument('--dist', type=Path, default=ROOT / 'dist')
    parser.add_argument('--target', action='append')
    args = parser.parse_args()
    verify(args.downloads, args.dist, args.target or [
        'windows-x64', 'linux-x64', 'raspberry-pi-arm64', 'raspberry-pi-arm32'])
