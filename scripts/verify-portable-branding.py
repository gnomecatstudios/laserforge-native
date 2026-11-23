#!/usr/bin/env python3
"""Verify that shipped archives, native icons, and embedded app assets use the current logo."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def ico_images(data):
    reserved, kind, count = struct.unpack_from('<HHH', data)
    assert (reserved, kind) == (0, 1) and count >= 3, 'Invalid multiresolution ICO'
    images = []
    for index in range(count):
        length, offset = struct.unpack_from('<II', data, 6 + index * 16 + 8)
        image = data[offset:offset + length]
        assert image.startswith(b'\x89PNG\r\n\x1a\n'), 'ICO image is not PNG'
        images.append(image)
    return images


def windows_images(data):
    """Read RT_ICON resources from PE32+ without executing the Windows binary."""
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    assert data[pe:pe + 4] == b'PE\0\0', 'Missing PE header'
    sections = struct.unpack_from('<H', data, pe + 6)[0]
    optional_size = struct.unpack_from('<H', data, pe + 20)[0]
    optional = pe + 24
    assert struct.unpack_from('<H', data, optional)[0] == 0x20b, 'Expected PE32+'

    def offset(rva):
        for index in range(sections):
            section = optional + optional_size + index * 40
            virtual_size, address, raw_size, raw = struct.unpack_from('<IIII', data, section + 8)
            if address <= rva < address + max(virtual_size, raw_size):
                return raw + rva - address
        raise AssertionError('Invalid resource RVA')

    resource_rva = struct.unpack_from('<I', data, optional + 112 + 16)[0]
    assert resource_rva, 'Windows executable has no icon resources'
    base = offset(resource_rva)

    def entries(relative):
        directory = base + relative
        named, ids = struct.unpack_from('<HH', data, directory + 12)
        return [struct.unpack_from('<II', data, directory + 16 + index * 8)
                for index in range(named + ids)]

    types = dict(entries(0))
    assert 3 in types and 14 in types, 'Missing icon or group-icon resource'
    images = []

    def walk(relative):
        for _, child in entries(relative):
            if child & 0x80000000:
                walk(child & 0x7fffffff)
            else:
                rva, size = struct.unpack_from('<II', data, base + child)
                start = offset(rva)
                images.append(data[start:start + size])

    walk(types[3] & 0x7fffffff)
    return images


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--downloads', type=Path, default=ROOT / 'portable/downloads')
    args = parser.parse_args()
    downloads = args.downloads
    icon = (ROOT / 'public/icon-192.png').read_bytes()
    mark = (ROOT / 'public/mark.png').read_bytes()
    ico = (ROOT / 'public/favicon.ico').read_bytes()
    expected_windows = set(ico_images(ico))
    version = json.loads((ROOT / 'package.json').read_text())['version']
    packages = sorted(downloads.glob(f'LaserForge-Portable-*-v{version}.zip'))
    assert len(packages) == 5, 'Expected four portable ZIPs and one source ZIP'
    sums = dict(line.split('  ', 1)[::-1] for line in (downloads / 'SHA256SUMS.txt').read_text().splitlines())
    assert set(sums) == {path.name for path in packages}, 'Checksum manifest differs from downloads'
    for path in packages:
        assert hashlib.sha256(path.read_bytes()).hexdigest() == sums[path.name], path.name
        if path.suffix == '.zip':
            with zipfile.ZipFile(path) as bundle:
                source = path.name.endswith(f'-source-v{version}.zip')
                prefix = '' if source else 'LaserForge-Portable/'
                assert bundle.read(prefix + 'icon.png') == icon, path.name
                assert bundle.read(prefix + 'LaserForge.ico') == ico, path.name
                if source:
                    assert bundle.read('dist/mark.png') == mark
                elif 'windows' in path.name:
                    binary = bundle.read(prefix + 'LaserForge-Portable.exe')
                    assert set(windows_images(binary)) == expected_windows, 'Embedded Windows icon differs'
                    assert mark in binary, 'Windows embedded web logo differs'
                else:
                    assert mark in bundle.read(prefix + 'LaserForge-Portable'), path.name
        print('Verified', path.name)


if __name__ == '__main__':
    main()
