#!/usr/bin/env python3
"""Download the official, checksum-verified DesignCraft v0.4.0 Linux x86_64 release."""
import argparse
import hashlib
from pathlib import Path
import tarfile
import urllib.request

VERSION = '0.4.0'
ARCHIVE = f'designcraft-{VERSION}-linux-x86_64.tar.gz'
BASE = f'https://github.com/storytold/designcraft/releases/download/v{VERSION}/'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sums = urllib.request.urlopen(BASE + 'SHA256SUMS.txt', timeout=60).read().decode()
    matching = [line.split()[0] for line in sums.splitlines() if line.split()[-1].lstrip('*') == ARCHIVE]
    if len(matching) != 1:
        raise SystemExit('Release checksum entry missing or ambiguous')
    archive = args.output / ARCHIVE
    with urllib.request.urlopen(BASE + ARCHIVE, timeout=120) as response, archive.open('wb') as target:
        while block := response.read(1024 * 1024):
            target.write(block)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != matching[0]:
        archive.unlink()
        raise SystemExit('Release archive checksum mismatch')
    with tarfile.open(archive) as package:
        package.extractall(args.output, filter='data')
    print(args.output.resolve() / f'designcraft-{VERSION}-linux-x86_64/bin/designcraft-cli')


if __name__ == '__main__':
    main()
