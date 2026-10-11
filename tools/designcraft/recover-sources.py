#!/usr/bin/env python3
"""Recover deduplicated OTE PDFs/IDML and logo from the supplied archive.

Original PDFs stay byte-identical under originals/. PDFs under pdfs/ are reading
copies (oversize files are optimized to fit static hosting limits).
"""
import argparse
import hashlib
import io
import json
import re
import zipfile
from pathlib import Path
import fitz


def slug(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')[:95]


def recover(archive, out):
    out = Path(out)
    for folder in ['originals', 'pdfs', 'thumbnails', 'assets', 'source-idml']:
        (out / folder).mkdir(parents=True, exist_ok=True)
    by_hash = {}
    idml = {}
    logo = None
    fonts = set()

    def scan(z, prefix=''):
        nonlocal logo
        for info in z.infolist():
            name = info.filename
            if name.endswith('/') or '__MACOSX' in name: continue
            suffix = Path(name).suffix.lower()
            source = prefix + name
            if suffix == '.zip':
                with zipfile.ZipFile(io.BytesIO(z.read(info))) as nested:
                    scan(nested, source + '!/')
            elif suffix == '.pdf':
                data = z.read(info)
                digest = hashlib.sha256(data).hexdigest()
                if digest in by_hash:
                    by_hash[digest]['sourcePaths'].append(source)
                    continue
                stem = slug(Path(name).stem) + '-' + digest[:8]
                filename = stem + '.pdf'
                original = out / 'originals' / filename
                original.write_bytes(data)
                doc = fitz.open(stream=data, filetype='pdf')
                reading = out / 'pdfs' / filename
                optimized = len(data) > 24 * 1024 * 1024
                if optimized:
                    doc.rewrite_images(dpi_threshold=190, dpi_target=150, quality=85)
                    doc.save(reading, garbage=4, deflate=True)
                    if reading.stat().st_size > 24 * 1024 * 1024:
                        raise ValueError('Reading PDF exceeds hosting limit: ' + source)
                else:
                    reading.write_bytes(data)
                cover = doc[0].get_pixmap(matrix=fitz.Matrix(.7, .7), alpha=False)
                cover.save(out / 'thumbnails' / (stem + '.jpg'))
                record = {'id': stem, 'title': Path(name).stem, 'category': 'asset' if '/Links/' in name else 'issue',
                          'pages': len(doc), 'bytes': len(data), 'sha256': digest,
                          'readingBytes': reading.stat().st_size, 'optimizedReadingCopy': optimized,
                          'pdf': 'pdfs/' + filename, 'original': 'originals/' + filename,
                          'thumbnail': 'thumbnails/' + stem + '.jpg', 'sourcePaths': [source],
                          'pageSize': list(doc[0].rect)[2:]}
                by_hash[digest] = record
                doc.close()
            elif suffix == '.idml':
                data = z.read(info); digest = hashlib.sha256(data).hexdigest()
                if digest not in idml:
                    filename = slug(Path(name).stem) + '-' + digest[:8] + '.idml'
                    (out / 'source-idml' / filename).write_bytes(data)
                    idml[digest] = {'path': 'source-idml/' + filename, 'sha256': digest, 'sourcePaths': [source]}
                else: idml[digest]['sourcePaths'].append(source)
            elif 'ote_logo' in name.lower() and suffix == '.png' and logo is None:
                logo = source
                (out / 'assets' / 'ote-horizontal-logo.png').write_bytes(z.read(info))
            elif suffix in ['.otf', '.ttf', '.ttc']:
                fonts.add(Path(name).name)

    with zipfile.ZipFile(archive) as z: scan(z)
    docs = sorted(by_hash.values(), key=lambda d: (d['category'] != 'issue', d['title'], d['id']))
    (out / 'documents.json').write_text(json.dumps({'schemaVersion': 1, 'sourceArchive': 'OneDrive_2026-10-09.zip',
        'documents': docs, 'idml': list(idml.values()), 'fontFileNames': sorted(fonts), 'logoSource': logo,
        'provenance': 'Recovered from the user-supplied source archive. Original PDFs are byte-identical; duplicate files share one record.'}, indent=2))
    print(json.dumps({'uniquePdfs': len(docs), 'uniqueIdml': len(idml), 'pages': sum(d['pages'] for d in docs),
                      'originalBytes': sum(d['bytes'] for d in docs), 'readingBytes': sum(d['readingBytes'] for d in docs), 'fonts': len(fonts)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive'); parser.add_argument('--output', required=True)
    args = parser.parse_args(); recover(args.archive, args.output)
