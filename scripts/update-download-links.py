#!/usr/bin/env python3
"""Point the README download links at one release's portable ZIPs and checksums.

The links name exact release files, such as
releases/download/v3.0.0/LaserForge-Portable-windows-x64-v3.0.0.zip, because the ZIP
names carry the version. The "Build portable packages" workflow runs this with the
version it is about to publish, so the links move with each release.

Usage: python3 scripts/update-download-links.py 3.0.1
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ['README.md', 'portable/README.md', 'portable/raspberry-pi.md', 'portable/public-downloads-README.md']
VERSION = r'\d+\.\d+\.\d+'
ZIP_LINK = re.compile(rf'/releases/download/v{VERSION}/LaserForge-Portable-([A-Za-z0-9-]+?)-v{VERSION}\.zip')
SUMS_LINK = re.compile(rf'/releases/download/v{VERSION}/SHA256SUMS\.txt')


def update(text, version):
    text = ZIP_LINK.sub(lambda match: f'/releases/download/v{version}/LaserForge-Portable-{match[1]}-v{version}.zip', text)
    return SUMS_LINK.sub(f'/releases/download/v{version}/SHA256SUMS.txt', text)


def main(argv):
    if len(argv) != 1 or not re.fullmatch(VERSION, argv[0]):
        sys.exit('usage: update-download-links.py MAJOR.MINOR.PATCH')
    version = argv[0]
    for name in DOCS:
        path = ROOT / name
        text = path.read_text(encoding='utf-8')
        if not ZIP_LINK.search(text):
            sys.exit(f'{name}: no versioned download links found')
        updated = update(text, version)
        if updated != text:
            path.write_text(updated, encoding='utf-8', newline='\n')
        print(f'{name}: links point to v{version}')


if __name__ == '__main__':
    main(sys.argv[1:])
