#!/usr/bin/env python3
"""Laser Forge portable updater (Python 3.9+, standard library only).

--launch applies a previously downloaded release before starting the native app,
then checks/downloads in the background. Package-manager installations are excluded.
Opening this script without arguments uses --launch.
Release hashes protect download integrity; they are not publisher signatures.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import urllib.request
import zipfile

REPO = 'gnomecatstudios/laserforge-native'  # native app releases only
API = f'https://api.github.com/repos/{REPO}/releases/latest'
BASE = f'https://github.com/{REPO}/releases'
MAX_DOWNLOAD = 128 * 1024 * 1024
PLATFORMS = {'windows-x64', 'linux-x64', 'raspberry-pi-arm64', 'raspberry-pi-arm32'}
FILES = {'LaserForge-Portable', 'LaserForge-Portable.exe', 'icon.png',
         'LaserForge.ico', 'README.txt', 'LICENSE-LaserForge.txt', 'VERSION.txt',
         'release.json', 'setup.py', 'update.py', 'Start-LaserForge.cmd'}


def version(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d+\.\d+\.\d+', value):
        raise ValueError('Expected a stable version such as 0.2.2')
    return tuple(int(p) for p in value.split('.'))


def host_platform():
    machine = platform.machine().lower()
    bits = struct.calcsize('P') * 8
    if sys.platform == 'win32' and machine in ('amd64', 'x86_64') and bits == 64:
        return 'windows-x64'
    if sys.platform.startswith('linux'):
        if machine in ('amd64', 'x86_64') and bits == 64:
            return 'linux-x64'
        if machine in ('aarch64', 'arm64', 'armv7l', 'armv6l', 'armv8l'):
            return 'raspberry-pi-arm64' if bits == 64 else 'raspberry-pi-arm32'
    raise ValueError('Automatic updates support Windows x64 and Linux x64/ARM only')


def metadata(root):
    data = json.loads((root / 'release.json').read_text(encoding='utf-8'))
    version(data['version'])
    if data['platform'] != host_platform():
        raise ValueError('Installed package does not match this operating system/architecture')
    return data


def fetch(url, limit):
    request = urllib.request.Request(url, headers={
        'Accept': 'application/vnd.github+json' if url == API else 'application/octet-stream',
        'User-Agent': 'LaserForge-Updater',
    })
    with urllib.request.urlopen(request, timeout=15) as response:
        if not response.url.startswith('https://'):
            raise ValueError('Update downloads must use HTTPS')
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Update exceeds download size limit')
    return data


def latest(current, platform_id):
    data = json.loads(fetch(API, 1024 * 1024))
    tag = data.get('tag_name', '')
    if not tag.startswith('v'):
        raise ValueError('Invalid release tag')
    candidate = tag[1:]
    version(candidate)
    if data.get('draft') is not False or data.get('prerelease') is not False:
        raise ValueError('Only published stable releases are supported')
    if data.get('html_url') != f'{BASE}/tag/{tag}':
        raise ValueError('Invalid release URL')
    if version(candidate) <= version(current):
        return None
    assets = data.get('assets', [])
    def asset(name):
        url = f'{BASE}/download/{tag}/{name}'
        matches = [a for a in assets if a.get('name') == name and
                   a.get('browser_download_url') == url and a.get('state') == 'uploaded' and
                   isinstance(a.get('size'), int) and 0 < a['size'] <= MAX_DOWNLOAD]
        if len(matches) != 1:
            raise ValueError(f'Missing or invalid release asset: {name}')
        return matches[0]
    short = {'raspberry-pi-arm64': 'RPi-ARM64', 'raspberry-pi-arm32': 'RPi-ARM32'}.get(platform_id, platform_id)
    names = [f'LaserForge-Portable-{suffix}-v{candidate}.zip' for suffix in (short, platform_id)]
    names += [f'LaserForge-Portable-{suffix}.zip' for suffix in (short, platform_id)]
    name = next((n for n in names if any(a.get('name') == n for a in assets)), names[0])
    return {'version': candidate, 'platform': platform_id,
            'package': asset(name),
            'checksums': asset('SHA256SUMS.txt')}


def validate_binary(path, platform_id):
    with path.open('rb') as stream:
        header = stream.read(64)
        if platform_id == 'windows-x64':
            if len(header) < 64 or header[:2] != b'MZ':
                raise ValueError('Invalid Windows executable')
            stream.seek(struct.unpack_from('<I', header, 60)[0])
            if stream.read(6) != b'PE\0\0d\x86':
                raise ValueError('Expected a Windows x64 executable')
        else:
            expected = {'linux-x64': (2, 62), 'raspberry-pi-arm64': (2, 183),
                        'raspberry-pi-arm32': (1, 40)}[platform_id]
            if (len(header) < 20 or header[:4] != b'\x7fELF' or header[5] != 1 or
                    (header[4], struct.unpack_from('<H', header, 18)[0]) != expected):
                raise ValueError('Wrong Linux executable architecture')


def unpack(archive, destination, platform_id, expected_version):
    """Reject traversal, links, duplicates and oversized archives before writing."""
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        if len(entries) > 1000 or sum(e.file_size for e in entries) > MAX_DOWNLOAD:
            raise ValueError('Update archive is too large')
        seen = set()
        for entry in entries:
            path = PurePosixPath(entry.filename)
            mode = entry.external_attr >> 16
            if (path.is_absolute() or '..' in path.parts or '\\' in entry.filename or
                    ':' in entry.filename or not path.parts or path.parts[0] != 'LaserForge-Portable' or
                    path.as_posix() != entry.filename.rstrip('/') or
                    path.as_posix().casefold() in seen or (mode & 0o170000) == 0o120000):
                raise ValueError('Unsafe update archive')
            seen.add(path.as_posix().casefold())
            if entry.is_dir():
                continue
            relative = path.parts[1:]
            if not relative or not (len(relative) == 1 and relative[0] in FILES or
                                    len(relative) == 2 and relative[0] == 'Fonts'):
                raise ValueError('Unexpected update file')
        package.extractall(destination)
    app = destination / 'LaserForge-Portable'
    binary = app / ('LaserForge-Portable.exe' if platform_id == 'windows-x64' else 'LaserForge-Portable')
    validate_binary(binary, platform_id)
    # Older official releases lack this file; the validated release API supplies it.
    release_path = app / 'release.json'
    expected = {'platform': platform_id, 'version': expected_version}
    if release_path.exists() and json.loads(release_path.read_text()) != expected:
        raise ValueError('Package version/platform does not match release')
    release_path.write_text(json.dumps(expected) + '\n', encoding='utf-8')
    return app


@contextmanager
def lock(root, name='.update.lock'):
    """Kernel lock is released even if the updater crashes."""
    with (root / name).open('a+b') as stream:
        stream.seek(0)
        stream.write(b'0')
        stream.flush()
        stream.seek(0)
        try:
            if sys.platform == 'win32':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise ValueError('Another Laser Forge updater is already running') from error
        try:
            yield
        finally:
            if sys.platform == 'win32':
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


def download(root):
    current = metadata(root)
    release = latest(current['version'], current['platform'])
    if release is None:
        return None
    with lock(root):
        checksums = fetch(release['checksums']['browser_download_url'], 64 * 1024).decode('utf-8')
        name = release['package']['name']
        hashes = [line.split()[0] for line in checksums.splitlines()
                  if len(line.split()) == 2 and line.split()[1] == name]
        if len(hashes) != 1 or not re.fullmatch('[a-fA-F0-9]{64}', hashes[0]):
            raise ValueError('Missing or invalid package checksum')
        payload = fetch(release['package']['browser_download_url'], MAX_DOWNLOAD)
        if len(payload) != release['package']['size'] or hashlib.sha256(payload).hexdigest() != hashes[0].lower():
            raise ValueError('Update checksum/size mismatch')
        with tempfile.TemporaryDirectory(prefix='.update-', dir=root) as temporary:
            work = Path(temporary)
            archive = work / 'release.zip'
            archive.write_bytes(payload)
            unpack(archive, work / 'validated', current['platform'], release['version'])
            # One atomic file is the source of truth for a pending update.
            archive.replace(root / '.pending-update.zip')
        return release['version']


def ensure_stopped():
    with socket.socket() as probe:
        if sys.platform == 'win32':
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            probe.bind(('127.0.0.1', 5190))
        except OSError as error:
            raise ValueError('Close Laser Forge and its launcher before applying an update') from error


def apply_pending(root):
    with lock(root):
        return _apply_pending(root)


def _apply_pending(root):
    pending = root / '.pending-update.zip'
    if not pending.exists():
        return False
    ensure_stopped()
    current = metadata(root)
    # Recheck the official release and checksum before applying cached bytes.
    release = latest(current['version'], current['platform'])
    if release is None:
        return False
    checksums = fetch(release['checksums']['browser_download_url'], 64 * 1024).decode('utf-8')
    if pending.stat().st_size > MAX_DOWNLOAD or pending.stat().st_size != release['package']['size']:
        raise ValueError('Cached update has an invalid size')
    expected = f"{hashlib.sha256(pending.read_bytes()).hexdigest()}  {release['package']['name']}"
    if expected not in checksums.splitlines():
        raise ValueError('Cached update differs from the latest release; download again')
    with tempfile.TemporaryDirectory(prefix='.apply-', dir=root) as temporary:
        work = Path(temporary)
        app = unpack(pending, work / 'new', current['platform'], release['version'])
        backup = work / 'backup'
        backup.mkdir()
        changed = []
        try:
            for source in sorted(app.rglob('*')):
                if not source.is_file():
                    continue
                relative = source.relative_to(app)
                target = root / relative
                if target.is_symlink() or target.parent.is_symlink():
                    raise ValueError('Refusing to replace a linked installation file')
                target.parent.mkdir(parents=True, exist_ok=True)
                previous = backup / relative
                previous.parent.mkdir(parents=True, exist_ok=True)
                existed = target.exists()
                if existed:
                    shutil.copy2(target, previous)
                if source.name == 'LaserForge-Portable':
                    source.chmod(0o755)
                source.replace(target)
                changed.append((target, previous, existed))
        except Exception:
            for target, previous, existed in reversed(changed):
                if existed:
                    previous.replace(target)
                else:
                    target.unlink()
            raise
        pending.unlink()
    return True


def launch(root):
    ensure_stopped()
    try:
        if apply_pending(root):
            print('Laser Forge updated. Starting the new version.', flush=True)
    except Exception as error:
        print(f'Update deferred: {error}. Starting the installed version.', flush=True)
    binary = root / ('LaserForge-Portable.exe' if sys.platform == 'win32' else 'LaserForge-Portable')
    child = subprocess.Popen([str(binary)], cwd=root)
    def background():
        try:
            candidate = download(root)
            if candidate:
                print(f'Laser Forge {candidate} downloaded. It will install on your next launch.', flush=True)
        except Exception as error:
            print(f'Update check skipped: {error}', flush=True)
    threading.Thread(target=background, daemon=True).start()
    try:
        return child.wait()
    except KeyboardInterrupt:
        child.terminate()
        return child.wait()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    for action in ('check', 'download', 'apply', 'launch'):
        actions.add_argument('--' + action, action='store_true')
    args = parser.parse_args(argv)
    if not any((args.check, args.download, args.apply, args.launch)):
        args.launch = True
    root = Path(__file__).resolve().parent
    try:
        if str(root).startswith(('/usr/', '/opt/')):
            raise ValueError('Use your package manager to update system installations')
        installed = metadata(root)
        if args.launch:
            with lock(root, '.session.lock'):
                return launch(root)
        if args.apply:
            with lock(root, '.session.lock'):
                print('Update installed.' if apply_pending(root) else 'No pending update.')
        elif args.download:
            candidate = download(root)
            print(f'Downloaded {candidate}. Close the launcher, then run --apply.' if candidate else 'Up to date.')
        else:
            candidate = latest(installed['version'], installed['platform'])
            print(f"Available: {candidate['version']}" if candidate else 'Up to date.')
        return 0
    except Exception as error:
        print(f'Laser Forge updater: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
