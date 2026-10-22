#!/usr/bin/env python3
"""Package generated complete issues and portable planner recipes for delivery.

The original source archive and private database backup are never copied into
these deliverables. Recipes carry their selected artwork; the separate compiler
toolkit supplies the open fonts and engine.
"""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public/designcraft'
OUTPUT = ROOT / 'artifacts/source-archive-publish'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    maps = json.loads((PUBLIC / 'source-issue-maps.json').read_text())
    OUTPUT.mkdir(parents=True, exist_ok=True)
    jobs = []
    for issue in maps['issues']:
        iid = issue['id']
        source = PUBLIC / 'source-issues' / iid
        proof = ROOT / 'artifacts/source-reconstruction/whole-issues' / (iid + '-reconstruction')
        directory = OUTPUT / 'issues' / iid
        directory.mkdir(parents=True, exist_ok=True)
        label = issue['label'].replace(' · ', ' — ')
        native = directory / (iid + '-editable-files.zip')
        with zipfile.ZipFile(native, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for name in ['issue.designcraft', 'issue.idml', 'build-manifest.json', 'verification.json']:
                z.write(proof / name, name)
            z.writestr('README.txt', label + '\n\nOpen issue.designcraft in OTEManager DesignCraft, or use issue.idml in a compatible editor. '
                       'The complete issue PDF is supplied separately. This is the verified portable reconstruction; '
                       'font substitutions, retained artwork and source blanks are recorded in its manifest.\n')
        data = json.loads((source / 'reconstruction-issue.json').read_text())
        library = json.loads((source / 'templates.json').read_text())
        selected = {page['templateId'] for page in data['layoutPlan']['pages']}
        library['templates'] = [t for t in library['templates'] if t['id'] in selected]
        media = set()
        for template in library['templates']:
            for slot in template['slots']:
                for key in ['asset', 'previewAsset']:
                    if slot.get(key):
                        media.add(slot[key])
            family = library.get('designs', {}).get(template.get('design'), {})
            layer = family.get('art', {}).get(template.get('art'))
            overlay = family.get('art', {}).get('cover', {}).get('over') if template.get('overArt') else None
            for art in [layer, overlay]:
                if art:
                    media.update(art[key] for key in ['original', 'portable'] if art.get(key))
                    if art.get('over'):
                        media.update(art['over'][key] for key in ['original', 'portable'] if art['over'].get(key))
        for article in data['articles']:
            media.update(photo['path'] for photo in article.get('photos', []))
        if data.get('layoutPlan', {}).get('cover', {}).get('photoPath'):
            media.add(data['layoutPlan']['cover']['photoPath'])
        recipe = directory / (iid + '-issue-recipe.zip')
        with zipfile.ZipFile(recipe, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            z.writestr('issue.json', json.dumps(data, ensure_ascii=False, indent=2) + '\n')
            z.writestr('templates.json', json.dumps(library, ensure_ascii=False, indent=2) + '\n')
            for name in sorted(media):
                path = (PUBLIC / name).resolve()
                if not path.is_relative_to(PUBLIC.resolve()) or not path.is_file():
                    raise ValueError('Missing or unsafe recipe media: ' + name)
                z.write(path, name)
            z.writestr('README.txt', label + '\n\nImport this ZIP into the OTEManager DesignCraft planner to edit the complete issue. '
                       'It includes every source page in its original order and the selected artwork. '
                       'For offline compilation, extract the separate template toolkit, run npm install in the toolkit, then:\n'
                       'node tools/designcraft/compile.mjs --library /path/to/recipe/templates.json '
                       '--issue /path/to/recipe/issue.json --output /path/to/output\n\n'
                       'Original article records and metadata are supplied separately in the source-archive import package.\n')
        for kind, path, name in [('recreatedPdf', proof / 'issue.pdf', label + ' — recreated.pdf'),
                                 ('editableFiles', native, label + ' — editable files.zip'),
                                 ('issueRecipe', recipe, label + ' — issue recipe.zip')]:
            jobs.append(dict(documentId=iid, label=issue['label'], kind=kind, path=str(path),
                             fileName=name, bytes=path.stat().st_size, sha256=digest(path)))
        print(iid, 'packaged', flush=True)
    (OUTPUT / 'issue-deliverables.json').write_text(json.dumps(jobs, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
