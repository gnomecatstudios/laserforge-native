#!/usr/bin/env python3
"""Publish tested binary packages to the consolidated repository.

Run after all checks and build-portable.py. Requires authenticated gh with access
to create/manage gnomecatstudios/laserforge-native. Never uploads source ZIPs.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPO = 'gnomecatstudios/laserforge-native'  # native app releases only
PLATFORMS = ['windows-x64', 'linux-x64', 'raspberry-pi-arm64', 'raspberry-pi-arm32']


def gh(*args, payload=None):
    for attempt in range(3):
        result = subprocess.run(['gh', *args], text=True, capture_output=True,
                                input=json.dumps(payload) if payload else None)
        if result.returncode == 0:
            return result.stdout
        if attempt < 2 and any(f'HTTP {code}' in result.stderr for code in (502, 503, 504)):
            time.sleep(2 ** attempt)
            continue
        raise subprocess.CalledProcessError(result.returncode, result.args,
                                            output=result.stdout, stderr=result.stderr)


def put_file(path, content):
    try:
        sha = json.loads(gh('api', f'repos/{REPO}/contents/{path}'))['sha']
    except subprocess.CalledProcessError as error:
        if 'HTTP 404' not in (error.stderr or ''):
            raise RuntimeError(f'Cannot read {path}: {error.stderr}') from error
        sha = None
    body = {'message': f'Update {path}', 'content': base64.b64encode(content).decode()}
    if sha:
        body['sha'] = sha
    try:
        gh('api', '--method', 'PUT', f'repos/{REPO}/contents/{path}', '--input', '-', payload=body)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f'Cannot update {path}: {error.stderr}') from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--packages', type=Path, required=True)
    parser.add_argument('--publish', action='store_true', help='create public repository/release')
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text())['version']
    files = [args.packages / ('LaserForge-Portable-' + {'raspberry-pi-arm64': 'RPi-ARM64', 'raspberry-pi-arm32': 'RPi-ARM32'}.get(p, p) + f'-v{version}.zip') for p in PLATFORMS]
    for path in files:
        if not path.is_file():
            parser.error(f'Missing package: {path}')
    # Verify version and platform metadata inside the actual embedded executable.
    for platform, path in zip(PLATFORMS, files):
        with zipfile.ZipFile(path) as package:
            names = package.namelist()
            if any(n.endswith(('.map', '.go', '.ts', '.svelte')) or '/.git/' in n for n in names):
                parser.error(f'Unexpected source files in {path}')
            binary = next(n for n in names if n.endswith('LaserForge-Portable.exe') or
                          n == 'LaserForge-Portable/LaserForge-Portable')
            expected = {'platform': platform, 'version': version}
            prefix = 'LaserForge-Portable/'
            if prefix + 'update.py' not in names or json.loads(package.read(prefix + 'release.json')) != expected:
                parser.error(f'Missing updater or mismatched release metadata in {path}')
            metadata = json.dumps({'platform': platform, 'version': version}).encode()
            if metadata not in package.read(binary):
                parser.error(f'Wrong platform/version in {path}')
    print(f'Ready to publish v{version}: {len(files)} binary packages. Source ZIP excluded.')
    if not args.publish:
        return
    repo = json.loads(gh('api', f'repos/{REPO}'))
    if repo.get('private') is not False:
        parser.error('The downloads repository must be public. Visibility was not changed.')
    with tempfile.TemporaryDirectory(prefix='laserforge-publish-') as folder:
        checksums = Path(folder) / 'SHA256SUMS.txt'
        checksums.write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n'
                                    for p in files), newline='\n')
        notes = Path(folder) / 'notes.md'
        notes.write_text(
            f'Laser Forge {version}\n\n'
            'Includes the update download popup. Portable builds check on startup; '
            'About and the project menu offer Check for updates. The popup waits until '
            'the laser is disconnected. The Python update launcher downloads releases in the '
            'background and applies them before the next launch. Native launchers continue to use manual updates.\n\n'
            f'[Platform installation instructions](https://github.com/{REPO}#installation)\n\n'
            'Existing installations need one manual download to get the update popup. '
            'Save your project and close the app and launcher before replacing them.\n\n'
            'Unsigned builds. Windows and Raspberry Pi packages are cross-compiled; '
            'native execution and physical laser hardware have not been tested.\n')
        gh('release', 'create', f'v{version}', '--repo', REPO, '--draft',
           '--title', f'Laser Forge {version}', '--notes-file', str(notes),
           *map(str, files), str(checksums))
        gh('release', 'edit', f'v{version}', '--repo', REPO, '--draft=false', '--latest')
    print(f'https://github.com/{REPO}/releases/tag/v{version}')


if __name__ == '__main__':
    main()

