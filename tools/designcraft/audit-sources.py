#!/usr/bin/env python3
"""Recursively inventory a supplied archive and audit every real PDF/IDML.

Outputs are private review artifacts, never repository fixtures. Requires PyMuPDF.
Native/IDML cycles are comparisons, not claims of Adobe compatibility.
"""
import argparse
import collections
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import zipfile


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def extract_tree(archive, target, records, prefix='', depth=0):
    if depth > 8:
        raise ValueError('Nested archive depth exceeds 8')
    with zipfile.ZipFile(archive) as z:
        for entry in z.infolist():
            rel = PurePosixPath(entry.filename)
            if rel.is_absolute() or '..' in rel.parts:
                raise ValueError('Unsafe archive path: ' + entry.filename)
            if entry.is_dir() or '__MACOSX' in rel.parts or rel.name.startswith('._'):
                continue
            data = z.read(entry)
            path = target / str(rel)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            records.append(dict(source=prefix + entry.filename, path=str(path), bytes=len(data),
                                sha256=digest(data), extension=path.suffix.lower()))
            if path.suffix.lower() == '.zip':
                extract_tree(io.BytesIO(data), path.with_suffix('.contents'), records,
                             prefix + entry.filename + '!/', depth + 1)


def native_snapshot(path):
    with zipfile.ZipFile(path) as z:
        document = json.loads(z.read('document.json'))
        assets = sorted(digest(z.read(n)) for n in z.namelist() if n.startswith('assets/'))
    stories = sorted(s['text'] for s in document['stories'].values())
    return dict(pageCount=sum(len(s['pages']) for s in document['spreads']),
                items=sum(len(s['items']) for s in document['spreads']),
                storyCount=len(stories), stories=stories, assetHashes=assets)


def cycle(cli, source, output):
    output.mkdir(parents=True, exist_ok=True)
    command = [cli, 'run', '--in', str(source), '--cmd', 'preflight.run', '--cmd', 'document.inspect',
               '--export', str(output / 'document.designcraft'), '--export', str(output / 'document.idml')]
    result = subprocess.run(command, capture_output=True, text=True, timeout=300)
    (output / 'stdout.jsonl').write_text(result.stdout)
    (output / 'stderr.txt').write_text(result.stderr)
    if result.returncode:
        return dict(returncode=result.returncode, error=result.stderr[-2000:])
    values = []
    for line in result.stdout.splitlines():
        try:
            values.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    preflight = next((v for v in values if isinstance(v, dict) and 'issues' in v), None)
    snapshot = native_snapshot(output / 'document.designcraft')
    write(output / 'snapshot.json', snapshot)
    write(output / 'preflight.json', preflight)
    return dict(returncode=0, snapshot=snapshot, preflight=preflight)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cli', required=True)
    parser.add_argument('--cycles', type=int, default=3)
    args = parser.parse_args()
    if not 1 <= args.cycles <= 8:
        parser.error('Use 1–8 cycles')
    args.output.mkdir(parents=True, exist_ok=True)
    records_path = args.output / 'inventory.json'
    if records_path.exists():
        records = json.loads(records_path.read_text())
    else:
        records = []
        extract_tree(args.archive, args.output / 'extracted', records)
        write(records_path, records)
    grouped = collections.defaultdict(list)
    for record in records:
        grouped[(record['extension'], record['sha256'])].append(record)
    summary = dict(entries=len(records), uniqueByExtension=dict(collections.Counter(k[0] for k in grouped)),
                   pdfs=[], idml=[], unsupportedIndd=[])
    import fitz
    for (extension, sha), copies in sorted(grouped.items()):
        source = Path(copies[0]['path'])
        if extension == '.indd':
            summary['unsupportedIndd'].append(dict(sha256=sha, paths=[x['source'] for x in copies],
                                                   reason='Stock DesignCraft cannot read INDD; paired IDML is audited separately.'))
        elif extension == '.pdf':
            out = args.output / 'pdf' / sha[:12]
            out.mkdir(parents=True, exist_ok=True)
            pages = []
            try:
                with fitz.open(source) as doc:
                    for i, page in enumerate(doc):
                        pixels = page.get_pixmap(matrix=fitz.Matrix(.5, .5), alpha=False)
                        pixels.save(out / f'page-{i + 1:03}.png')
                        pages.append(dict(page=i + 1, size=list(page.rect), text=page.get_text(sort=True),
                                          renderHash=digest(pixels.samples), imageCount=len(page.get_images())))
                result = dict(sha256=sha, paths=[x['source'] for x in copies], pages=len(pages), status='all-pages-rendered')
                write(out / 'pages.json', pages)
            except Exception as error:
                result = dict(sha256=sha, paths=[x['source'] for x in copies], status='failed', error=str(error))
            summary['pdfs'].append(result)
            print(json.dumps(dict(type='pdf', **result)), flush=True)
        elif extension == '.idml':
            out = args.output / 'idml' / sha[:12]
            package = out / 'package'
            # Keep each IDML with its original sibling resources, not a global
            # basename pool that can silently pick artwork from a different issue.
            if not package.exists():
                shutil.copytree(source.parent, package, ignore=shutil.ignore_patterns('*.contents', '*.zip'))
            fonts = next((p for p in package.iterdir() if p.is_dir() and p.name.lower() == 'document fonts'), None)
            if fonts and fonts.name != 'Document Fonts':
                shutil.copytree(fonts, package / 'Document Fonts', dirs_exist_ok=True)
            current = package / source.name
            cycles = []
            baseline = None
            for number in range(args.cycles):
                destination = out / f'cycle-{number}'
                if (package / 'Document Fonts').is_dir():
                    shutil.copytree(package / 'Document Fonts', destination / 'Document Fonts', dirs_exist_ok=True)
                result = cycle(args.cli, current, destination)
                if result['returncode']:
                    cycles.append(result)
                    break
                snapshot = result.pop('snapshot')
                baseline = baseline or snapshot
                result['matchesFirstImport'] = {key: snapshot[key] == baseline[key] for key in baseline}
                cycles.append(result)
                current = destination / 'document.idml'
            record = dict(sha256=sha, paths=[x['source'] for x in copies], cycles=cycles,
                          sourcePackage=str(package), status='audited' if len(cycles) == args.cycles else 'failed')
            summary['idml'].append(record)
            write(args.output / 'results.json', summary)
            print(json.dumps(dict(type='idml', sha256=sha, cycles=[{k: v for k, v in c.items() if k != 'preflight'} for c in cycles])), flush=True)
    write(args.output / 'results.json', summary)


if __name__ == '__main__':
    main()
