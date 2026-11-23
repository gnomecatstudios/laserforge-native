#!/usr/bin/env python3
"""Build portable ZIPs from the current production dist/."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
APP_VERSION = json.loads((ROOT / 'package.json').read_text())['version']
TARGETS = [
    ('linux-x64', 'linux', 'amd64', 'amd64'),
    ('raspberry-pi-arm64', 'linux', 'arm64', 'arm64'),
    ('raspberry-pi-arm32', 'linux', 'arm', 'armhf'),
    ('windows-x64', 'windows', 'amd64', None),
]



def embed_windows_icon(launcher, go):
    subprocess.run([
        go, 'run', 'github.com/akavel/rsrc@v0.10.2',
        '-ico', str(ROOT / 'public/favicon.ico'),
        '-o', 'resource_windows_amd64.syso', '-arch', 'amd64',
    ], cwd=launcher, env={**os.environ, 'GOTOOLCHAIN': 'local'}, check=True)


def package_name(platform):
    return 'LaserForge-Portable-' + {'raspberry-pi-arm64': 'RPi-ARM64', 'raspberry-pi-arm32': 'RPi-ARM32'}.get(platform, platform) + f'-v{APP_VERSION}.zip'


def archive(folder, output):
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for entry in sorted(folder.rglob('*')):
            if entry.is_file():
                bundle.write(entry, entry.relative_to(folder))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--go', default='go', help='Go compiler executable')
    parser.add_argument('--output', type=Path, default=ROOT / 'portable/downloads')
    parser.add_argument('--target', choices=[t[0] for t in TARGETS], action='append')
    parser.add_argument('--revision', help='exact source revision for an exported checkout without matching Git metadata')
    args = parser.parse_args()
    if not (ROOT / 'dist/index.html').is_file():
        parser.error('Run pnpm build first.')
    for icon in ['icon-192.png', 'favicon.ico']:
        if not (ROOT / 'public' / icon).is_file():
            parser.error('Run pnpm icons before building portable downloads.')
    revision = args.revision or subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = not args.revision and bool(subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT))
    build = revision + ('-working' if dirty else '')
    version = f'{APP_VERSION}+git{revision}' + ('.working' if dirty else '')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    artifacts = []
    with tempfile.TemporaryDirectory(prefix='laserforge-build-') as folder:
        work = Path(folder)
        launcher = work / 'launcher'
        launcher.mkdir()
        for name in ['main.go', 'appwindow.go', 'appwindow_windows.go', 'appwindow_unix.go',
                     'updater.go', 'phonecapture.go', 'phone.html', 'go.mod']:
            shutil.copy2(ROOT / 'portable/launcher' / name, launcher / name)
        shutil.copytree(ROOT / 'dist', launcher / 'dist')
        # Also record the source snapshot in the actual embedded web assets.
        (launcher / 'dist/portable-version.txt').write_text(build + '\n', newline='\n')
        if not args.target or 'windows-x64' in args.target:
            embed_windows_icon(launcher, args.go)
        for name, system, arch, deb_arch in TARGETS:
            if args.target and name not in args.target:
                continue
            (launcher / 'dist/portable-platform.json').write_text(json.dumps({'platform': name, 'version': APP_VERSION}) + '\n', newline='\n')
            package = work / name
            app = package / 'LaserForge-Portable'
            app.mkdir(parents=True)
            environment = {**os.environ, 'GOOS': system, 'GOARCH': arch, 'CGO_ENABLED': '0', 'GOTOOLCHAIN': 'local'}
            if arch == 'arm':
                environment['GOARM'] = '6'
            binary = app / ('LaserForge-Portable.exe' if system == 'windows' else 'LaserForge-Portable')
            # The Windows launcher is a GUI program: the app window opens without a console.
            ldflags = '-s -w -H windowsgui' if system == 'windows' else '-s -w'
            subprocess.run([args.go, 'build', '-buildvcs=false', '-trimpath', '-ldflags=' + ldflags, '-o', str(binary), '.'],
                           cwd=launcher, env=environment, check=True)
            binary.chmod(0o755)
            for filename in ['README.txt', 'LICENSE-LaserForge.txt']:
                shutil.copy2(ROOT / 'portable' / filename, app / filename)
            shutil.copytree(ROOT / 'portable/Fonts', app / 'Fonts')
            shutil.copy2(ROOT / 'public/icon-192.png', app / 'icon.png')
            shutil.copy2(ROOT / 'public/favicon.ico', app / 'LaserForge.ico')
            (app / 'VERSION.txt').write_text(build + '\n', newline='\n')
            shutil.copy2(ROOT / 'portable/update.py', app / 'update.py')
            (app / 'release.json').write_text(json.dumps({'platform': name, 'version': APP_VERSION}) + '\n', newline='\n')
            if system == 'windows':
                shutil.copy2(ROOT / 'portable/Start-LaserForge.cmd', app / 'Start-LaserForge.cmd')
            if system == 'linux':
                shutil.copy2(ROOT / 'portable/setup.py', app / 'setup.py')
                (app / 'setup.py').chmod(0o755)
            zipped = output / package_name(name)
            archive(package, zipped)
            artifacts.append(zipped)
        (launcher / 'dist/portable-platform.json').unlink(missing_ok=True)
        source = work / 'source'
        shutil.copytree(launcher, source)
        shutil.copy2(ROOT / 'portable/README.txt', source / 'README.txt')
        shutil.copy2(ROOT / 'portable/setup.py', source / 'setup.py')
        shutil.copy2(ROOT / 'portable/LICENSE-LaserForge.txt', source / 'LICENSE-LaserForge.txt')
        shutil.copytree(ROOT / 'portable/Fonts', source / 'Fonts')
        shutil.copy2(ROOT / 'public/icon-192.png', source / 'icon.png')
        shutil.copy2(ROOT / 'public/favicon.ico', source / 'LaserForge.ico')
        (source / 'VERSION.txt').write_text(build + '\n', newline='\n')
        zipped = output / f'LaserForge-Portable-source-v{APP_VERSION}.zip'
        archive(source, zipped)
        artifacts.append(zipped)
    # Include every delivered package, including unchanged targets in a partial build.
    supported = {f'LaserForge-Portable-source-v{APP_VERSION}.zip'}
    supported.update(package_name(name) for name, *_ in TARGETS)
    if not args.target:
        for old in output.glob('LaserForge-Portable-*.zip'):
            if old.name not in supported:
                old.unlink()
    for obsolete in output.glob('LaserForge-Setup-*.deb'):
        obsolete.unlink()
    artifacts = sorted(path for path in output.iterdir() if path.name in supported)
    # Explicit LF: Windows hosts would otherwise write CRLF and break byte-exact checks.
    (output / 'SHA256SUMS.txt').write_text(''.join(
        f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in artifacts), newline='\n')
    # Reject stale or incomplete native app payloads before reporting success.
    subprocess.run([
        'python3', str(ROOT / 'scripts/verify-portable-parity.py'),
        '--downloads', str(output),
        *[arg for target, *_ in TARGETS if not args.target or target in args.target
          for arg in ('--target', target)],
    ], check=True)
    print(f'Built {build}. Packages: {output}')


if __name__ == '__main__':
    main()


