#!/usr/bin/env python3
"""Structural IDML check, measured against IDMLs that Adobe InDesign itself wrote.

  python3 tools/designcraft/check-idml.py output/issue.idml [--baseline original.idml ...] [--json report.json]

InDesign rejects or silently repairs packages with a misplaced mimetype, broken
XML, dangling references or missing resources. This checks those rules without
InDesign: package layout, well-formed XML, designmap references, story/frame
links, paragraph/character/object styles, swatches, fonts and links, plus page
geometry. With --baseline the candidate is compared with packages InDesign wrote
(for OTE: the original issue IDMLs), so anything they also show is not reported
as a problem. Opening the file in InDesign remains the final test.
"""
import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree

MIMETYPE = b'application/vnd.adobe.indesign-idml-package'
BUILTIN_SWATCHES = {'Swatch/None', 'Color/Black', 'Color/Paper', 'Color/Registration', 'Color/White', 'n'}


def ids(root, tags):
    return {e.get('Self') for e in root.iter() if e.tag.split('}')[-1] in tags and e.get('Self')}


def profile(path):
    problems, notes = [], []
    archive = zipfile.ZipFile(path)
    infos = archive.infolist()
    names = [i.filename for i in infos]
    if not infos or infos[0].filename != 'mimetype' or infos[0].compress_type != zipfile.ZIP_STORED or archive.read('mimetype') != MIMETYPE:
        problems.append('mimetype must be the first entry, stored uncompressed, with the IDML media type')
    if 'META-INF/container.xml' not in names:
        problems.append('META-INF/container.xml is missing')
    xml = {}
    for name in names:
        if name.endswith('.xml'):
            try:
                xml[name] = ElementTree.fromstring(archive.read(name))
            except ElementTree.ParseError as error:
                problems.append(f'{name} is not well-formed XML: {error}')
    designmap = archive.read('designmap.xml').decode('utf-8') if 'designmap.xml' in names else ''
    if not designmap:
        problems.append('designmap.xml is missing')
    dom = re.search(r'DOMVersion="([^"]+)"', designmap)
    product = re.search(r'product="([^"]+)"', designmap)
    referenced = re.findall(r'<idPkg:\w+ src="([^"]+)"', designmap)
    for src in referenced:
        if src not in names:
            problems.append(f'designmap references a missing part: {src}')
    unreferenced = [n for n in names if n.split('/')[0] in ('Spreads', 'Stories', 'MasterSpreads') and n not in referenced]
    if unreferenced:
        problems.append('Parts not listed in designmap.xml: ' + ', '.join(unreferenced[:5]))

    story_ids = set()
    for name, root in xml.items():
        if name.startswith('Stories/'):
            story_ids |= ids(root, {'Story'})
    frames, parents, pages, links = 0, set(), [], []
    applied = {'paragraph': set(), 'character': set(), 'object': set(), 'swatch': set(), 'font': set()}
    for name, root in xml.items():
        for e in root.iter():
            tag = e.tag.split('}')[-1]
            if tag == 'TextFrame':
                frames += 1
                parents.add(e.get('ParentStory'))
            elif tag == 'Page' and name.startswith('Spreads/'):
                bounds = [float(v) for v in (e.get('GeometricBounds') or '0 0 0 0').split()]
                pages.append([round(bounds[3] - bounds[1], 2), round(bounds[2] - bounds[0], 2)])
            elif tag == 'Link':
                links.append(dict(uri=e.get('LinkResourceURI'), stored=e.get('StoredState')))
            for key, kind in (('AppliedParagraphStyle', 'paragraph'), ('AppliedCharacterStyle', 'character'), ('AppliedObjectStyle', 'object'),
                              ('FillColor', 'swatch'), ('StrokeColor', 'swatch')):
                if e.get(key):
                    applied[kind].add(e.get(key))
            if tag == 'Properties':
                continue
            if e.get('AppliedFont'):
                applied['font'].add(e.get('AppliedFont'))
        for e in root.iter():
            if e.tag.split('}')[-1] == 'AppliedFont' and e.text:
                applied['font'].add(e.text)
    missing_stories = sorted(p for p in parents if p and p not in story_ids)
    if missing_stories:
        problems.append(f'{len(missing_stories)} text frame(s) point at missing stories: ' + ', '.join(missing_stories[:5]))
    orphans = sorted(story_ids - parents)
    if orphans:
        notes.append(f'{len(orphans)} stories have no text frame (InDesign keeps them unplaced)')
    styles = xml.get('Resources/Styles.xml')
    graphic = xml.get('Resources/Graphic.xml')
    fonts_xml = xml.get('Resources/Fonts.xml')
    defined = {
        'paragraph': ids(styles, {'ParagraphStyle'}) if styles is not None else set(),
        'character': ids(styles, {'CharacterStyle'}) if styles is not None else set(),
        'object': ids(styles, {'ObjectStyle'}) if styles is not None else set(),
        'swatch': (ids(graphic, {'Color', 'Swatch', 'Gradient', 'Tint', 'MixedInk'}) if graphic is not None else set()) | BUILTIN_SWATCHES,
    }
    for kind in ('paragraph', 'character', 'object', 'swatch'):
        dangling = sorted(applied[kind] - defined[kind] - {'n'})  # 'n': InDesign's "no style".
        if dangling:
            problems.append(f'Undefined {kind} reference(s): ' + ', '.join(dangling[:6]))
    families = {f.get('Name') for f in fonts_xml.iter() if f.tag.split('}')[-1] == 'FontFamily'} if fonts_xml is not None else set()
    unknown_fonts = sorted(f for f in applied['font'] if f not in families and '\t' not in f)
    if unknown_fonts:
        notes.append('Fonts used but not listed in Fonts.xml (InDesign substitutes them): ' + ', '.join(unknown_fonts[:6]))
    external = [l['uri'] for l in links if l['stored'] != 'Embedded' and l['uri']]
    if external:
        names = sorted({unquote(uri.rsplit('/', 1)[-1]) for uri in external})
        notes.append(f'{len(external)} linked (not embedded) file(s); keep them beside the IDML: ' + ', '.join(names[:3]))
    return dict(file=str(path), product=product.group(1) if product else None, domVersion=dom.group(1) if dom else None,
                parts=len(names), spreads=sum(n.startswith('Spreads/') for n in names), stories=len(story_ids), textFrames=frames,
                pageSizes=sorted({tuple(p) for p in pages}), pages=len(pages), fonts=sorted(families), links=len(links),
                problems=problems, notes=notes)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('idml', type=Path, nargs='+')
    parser.add_argument('--baseline', type=Path, nargs='*', default=[])
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    baselines = [profile(p) for p in args.baseline]
    known = {p for b in baselines for p in b['problems']}
    report = dict(baseline=baselines, candidates=[])
    failed = False
    for path in args.idml:
        result = profile(path)
        # Something InDesign's own files show is how InDesign writes them, not a defect.
        result['sharedWithBaseline'] = [p for p in result['problems'] if p in known]
        result['problems'] = [p for p in result['problems'] if p not in known]
        if baselines:
            sizes = {s for b in baselines for s in b['pageSizes']}
            if result['pageSizes'] and not set(result['pageSizes']) <= sizes:
                result['problems'].append(f"Page size {result['pageSizes']} differs from the originals' {sorted(sizes)}")
            versions = sorted({b['domVersion'] for b in baselines if b['domVersion']})
            if result['domVersion'] and versions and float(result['domVersion']) < float(versions[0]):
                result['notes'].append(f"DOMVersion {result['domVersion']} is older than the originals' {', '.join(versions)}; InDesign opens older IDML and converts it")
        failed |= bool(result['problems'])
        report['candidates'].append(result)
        print(f"{'FAIL' if result['problems'] else 'ok':4} {path.name}: DOM {result['domVersion']}, {result['pages']} pages {result['pageSizes']}, "
              f"{result['stories']} stories, {result['textFrames']} text frames, {len(result['fonts'])} font families")
        for line in result['problems']:
            print('     problem:', line)
        for line in result['notes']:
            print('     note:', line)
    if args.json:
        args.json.write_text(json.dumps(report, indent=2, default=list) + '\n')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
