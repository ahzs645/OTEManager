#!/usr/bin/env python3
"""Download the official, checksum-verified DesignCraft v0.4.0 CLI for this platform."""
import argparse
import hashlib
from pathlib import Path
import platform
import re
import shutil
import stat
import tarfile
import urllib.request
import zipfile

VERSION = '0.4.0'
BASE = f'https://github.com/storytold/designcraft/releases/download/v{VERSION}/'


def resolve_release(system=None, machine=None):
    """Resolve actual official release names, independently testable on any host."""
    system = (system or platform.system()).lower()
    machine = (machine or platform.machine()).lower()
    arch = {'amd64': 'x86_64', 'x64': 'x86_64', 'arm64': 'aarch64',
            'i386': 'x86', 'i686': 'x86', 'x86': 'x86'}.get(machine, machine)
    if system == 'darwin' and arch in ('x86_64', 'aarch64'):
        return f'designcraft-cli-{VERSION}-macos-universal.zip', 'designcraft-cli'
    if system == 'windows' and arch in ('x86_64', 'aarch64', 'x86'):
        windows_arch = {'x86_64': 'x64', 'aarch64': 'arm64', 'x86': 'x86'}[arch]
        return f'designcraft-{VERSION}-windows-{windows_arch}-portable.zip', 'designcraft-cli.exe'
    if system == 'linux' and arch in ('x86_64', 'aarch64'):
        return f'designcraft-{VERSION}-linux-{arch}.tar.gz', 'designcraft-cli'
    if system == 'freebsd' and arch == 'x86_64':
        return f'designcraft-{VERSION}-freebsd-x86_64.tar.gz', 'designcraft-cli'
    raise ValueError(f'No supported official CLI archive for {system}/{machine}')


def archive_checksum(sums, archive_name):
    matching = [parts[0] for line in sums.splitlines()
                if len(parts := line.split()) == 2 and parts[1].lstrip('*') == archive_name]
    if len(matching) != 1 or not re.fullmatch(r'[0-9a-fA-F]{64}', matching[0]):
        raise ValueError('Release checksum entry missing, invalid or ambiguous')
    return matching[0].lower()


def extract_archive(archive, output):
    """Extract a verified release with destination and archive safety checks."""
    output = output.resolve()
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as package:
            for entry in package.infolist():
                destination = (output / entry.filename.replace('\\', '/')).resolve()
                if not destination.is_relative_to(output):
                    raise ValueError('Release ZIP contains a path outside its destination')
                mode = entry.external_attr >> 16
                if stat.S_ISLNK(mode):
                    raise ValueError('Release ZIP contains an unsupported symbolic link')
            package.extractall(output)
            # macOS ZIPs retain POSIX executable bits in their metadata; Python's
            # ZIP extraction does not apply those permissions automatically.
            for entry in package.infolist():
                mode = entry.external_attr >> 16
                if not entry.is_dir() and mode & 0o111:
                    (output / entry.filename).chmod((mode & 0o777) | 0o600)
    else:
        with tarfile.open(archive) as package:
            # Python 3.11's original tarfile API has no extraction filter.
            # Validate every entry first, then copy ordinary files ourselves;
            # never materialize archive links, devices, ownership or suid bits.
            members = package.getmembers()
            for entry in members:
                destination = (output / entry.name.replace('\\', '/')).resolve()
                if not destination.is_relative_to(output):
                    raise ValueError('Release TAR contains a path outside its destination')
                if not (entry.isdir() or entry.isfile()):
                    raise ValueError('Release TAR contains an unsupported link or special file')
            for entry in members:
                destination = (output / entry.name.replace('\\', '/')).resolve()
                # Recheck after preceding entries have created paths.
                if not destination.is_relative_to(output):
                    raise ValueError('Release TAR contains a path outside its destination')
                if entry.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                    destination.chmod((entry.mode & 0o777) | 0o700)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    source = package.extractfile(entry)
                    if source is None:
                        raise ValueError('Release TAR file could not be read')
                    with source, destination.open('wb') as target:
                        shutil.copyfileobj(source, target, length=1024 * 1024)
                    destination.chmod((entry.mode & 0o777) | 0o600)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        archive_name, executable_name = resolve_release()
    except ValueError as error:
        raise SystemExit(str(error)) from error
    args.output.mkdir(parents=True, exist_ok=True)
    sums = urllib.request.urlopen(BASE + 'SHA256SUMS.txt', timeout=60).read().decode()
    try:
        expected = archive_checksum(sums, archive_name)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    archive = args.output / archive_name
    partial = archive.with_suffix(archive.suffix + '.partial')
    with urllib.request.urlopen(BASE + archive_name, timeout=120) as response, partial.open('wb') as target:
        while block := response.read(1024 * 1024):
            target.write(block)
    with partial.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    if digest != expected:
        partial.unlink()
        raise SystemExit('Release archive checksum mismatch')
    partial.replace(archive)
    extract_archive(archive, args.output)
    with zipfile.ZipFile(archive) if zipfile.is_zipfile(archive) else tarfile.open(archive) as package:
        names = package.namelist() if isinstance(package, zipfile.ZipFile) else package.getnames()
    candidates = [(args.output / name).resolve() for name in names
                  if Path(name).name == executable_name and (args.output / name).is_file()]
    if len(candidates) != 1:
        raise SystemExit('Release does not contain exactly one expected CLI executable')
    if platform.system() != 'Windows':
        candidates[0].chmod(candidates[0].stat().st_mode | 0o111)
    print(candidates[0])


if __name__ == '__main__':
    main()
