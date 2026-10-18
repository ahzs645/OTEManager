#!/usr/bin/env python3
"""Regression tests. Set DESIGNCRAFT_CLI for native integration tests."""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile
from markdown_story import compose_source
from interchange_metadata import save_metadata, restore_metadata
from cover_fields import resolve_cover
from native_references import verify_cover_references

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = ROOT / 'public/designcraft/templates.json'
if not LIBRARY.exists():
    LIBRARY = Path(__file__).resolve().parent / 'templates.json'
CLI = os.environ.get('DESIGNCRAFT_CLI')


def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result


page=module('page_compiler','compile-template.py')
issue_compiler=module('issue_compiler','compile-issue.py')


def source(body='Complete article copy.', photos=None):
    return dict(schemaVersion=page.ISSUE_SCHEMA,issue={'title':'Regression issue'},
                articles=[dict(id='article',title='A short headline',author='Test author',body=body,photos=photos or [])])


class MarkdownTests(unittest.TestCase):
    def test_plain_copy_is_exact(self):
        body='**Literal** café\n\nSecond paragraph.\n'
        self.assertEqual(compose_source(body,'plain'),dict(text=body,spans=[],paragraphs=[]))

    def test_unicode_byte_ranges_and_combined_emphasis(self):
        result=compose_source('café ***bold*** and [link](https://example.test)')
        body=result['text'].encode()
        self.assertEqual(body[result['spans'][0]['start']:result['spans'][0]['end']].decode(),'link')
        emphasis=next(s for s in result['spans'] if s.get('attrs',{}).get('fontStyle')=='Bold Italic')
        self.assertEqual(body[emphasis['start']:emphasis['end']].decode(),'bold')

    def test_blocks_and_list_numbers(self):
        result=compose_source('# Heading\n\n> Quotation\n\n3. Third\n4. Fourth\n\n```\ncode\n```')
        self.assertIn('3. Third\n4. Fourth',result['text'])
        self.assertEqual([p['style'] for p in result['paragraphs']],['OTE Heading 1','OTE Quote','OTE Body','OTE Body','OTE Code'])

    def test_unsupported_content_is_explicit(self):
        for body in ('<div>Text</div>','![picture](image.png)','text <b>bold</b>'):
            with self.subTest(body=body),self.assertRaises(ValueError):compose_source(body)

    def test_legacy_empty_bookmarks_preserve_visible_copy(self):
        self.assertEqual(compose_source('<a id="_Toc123"></a>Visible')['text'], 'Visible')
        self.assertIn('<a id="x"></a>', compose_source('`<a id="x"></a>`')['text'])
        self.assertIn('<a id="x"></a>', compose_source('```html\n<a id="x"></a>\n```')['text'])
        recovered = compose_source("<a id='_Toc123'></a>café **bold** [link](https://example.test)")
        self.assertEqual(recovered['text'], 'café bold link')
        linked = next(span for span in recovered['spans'] if span.get('kind') == 'link')
        self.assertEqual(recovered['text'].encode()[linked['start']:linked['end']].decode(), 'link')
        self.assertEqual(linked['url'], 'https://example.test')
        with self.assertRaises(ValueError):
            compose_source('<a id="x">Visible content must not disappear</a>')

    def test_ambiguous_interchange_story_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            native=Path(directory)/'document.designcraft';metadata=Path(directory)/'metadata.json'
            document=dict(stories={'1':{'text':'Same body'},'2':{'text':'Same body'}},parents=[],spreads=[],nextId=4,
                hyperlinks=[dict(id=3,source=dict(kind='text',story=1,start=0,end=4),dest=dict(kind='url',value='https://example.test'))])
            with zipfile.ZipFile(native,'w') as z:z.writestr('document.json',json.dumps(document))
            save_metadata(native,metadata)
            with self.assertRaisesRegex(ValueError,'ambiguous'):restore_metadata(native,metadata)


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def page_args(self,template='unknown',data=None):
        path=self.root/'input.json';page.write_json(path,data or source())
        return argparse.Namespace(library=LIBRARY,template=template,issue=path,articles=None,output=self.root/'output',cli=CLI,font_dir=None,page_number=1,page_id='test-page')
    def issue_args(self,data,allow=False):
        path=self.root/'input.json';page.write_json(path,data)
        return argparse.Namespace(library=LIBRARY,issue=path,output=self.root/'output',cli=CLI,font_dir=None,base_native=None,booklet=False,allow_unplaced=allow)
    def test_failed_rebuild_removes_stale_final_exports(self):
        args=self.page_args();args.output.mkdir()
        for name in ('page.pdf','page.idml'):(args.output/name).write_bytes(b'stale')
        with self.assertRaises(ValueError):page.compile_page(args)
        self.assertFalse((args.output/'page.pdf').exists());self.assertFalse((args.output/'page.idml').exists())
    def test_original_profile_requires_explicit_fonts(self):
        args=self.page_args('cover-stacked-cards-border');args.font_profile='original2025'
        with self.assertRaisesRegex(ValueError,'needs --font-dir'):page.compile_page(args)
    def test_partial_review_cannot_duplicate_an_article(self):
        data=source();data['layoutPlan']={'pages':[dict(id='p'+str(n),pageNumber=n,templateId='story-1-none-airy',articleIds=['article']) for n in (1,2)]}
        with self.assertRaisesRegex(ValueError,'explicit continuation'):issue_compiler.compile_issue(self.issue_args(data,True))
    def test_unknown_protected_centre_id_is_rejected(self):
        data=source();data['articles']=[];data['layoutPlan']={'pages':[dict(id='p'+str(n),pageNumber=n,templateId='ad-full',articleIds=[],mode='preserve') for n in range(1,5)],'truck':{'mode':'preserve','pageIds':['missing-left','missing-right']}}
        with self.assertRaisesRegex(ValueError,'two centre pages'):issue_compiler.compile_issue(self.issue_args(data))

    def test_deleted_unmanaged_anchor_is_still_checked_against_the_native_base(self):
        # The CLI has already removed story 2. Its old anchor identity must
        # still be considered before accepting a live reference from story 1.
        base = dict(parents=[], stories={
            '1': dict(text='\ue00c', frames=[1], xrefs=[dict(target=200, format='Other')]),
            '2': dict(text='\ue00bHeading', frames=[2], anchors=[dict(id=200, name='Unmanaged destination')])},
            spreads=[dict(pages=[dict(id=n)], items=[dict(id=n, content=dict(type='text', story=n))]) for n in (1, 2)])
        current = copy.deepcopy(base)
        current['spreads'][1]['items'] = []
        del current['stories']['2']
        current['hyperlinks'] = [dict(id=40, source=dict(kind='text', story=2), dest=dict(kind='url', value='https://example.test'))]
        native = self.root / 'document.designcraft'
        with zipfile.ZipFile(native, 'w') as archive:
            archive.writestr('document.json', json.dumps(current))
        original = native.read_bytes()
        with self.assertRaisesRegex(ValueError, 'unmanaged cross-reference destination'):
            issue_compiler.remove_replaced_orphan_stories(native, base, [{}, {}], [None, 'replacement'], [])
        self.assertEqual(native.read_bytes(), original)
        current['stories']['1']['xrefs'] = []
        with zipfile.ZipFile(native, 'w') as archive:
            archive.writestr('document.json', json.dumps(current))
        self.assertEqual(issue_compiler.remove_replaced_orphan_stories(native, base, [{}, {}], [None, 'replacement'], []), 1)
        self.assertEqual(issue_compiler.load_native(native)['hyperlinks'], [])

    def test_style_namespace_changes_with_font_family_without_changing_source_copy(self):
        source = self.root / 'styles.designcraft'
        document = dict(styles=dict(paragraph=[dict(name='Body', chars=dict(fontFamily='Source Serif 4', size=10))],
                                    character=[], object=[], cell=[], table=[]),
                        stories={'1': dict(text='Exact source copy.', paras=[{'style': 'Body'}])}, spreads=[])
        def namespace(family, name):
            document['styles']['paragraph'][0]['chars']['fontFamily'] = family
            with zipfile.ZipFile(source, 'w') as archive:
                archive.writestr('document.json', json.dumps(document))
            destination = self.root / name
            issue_compiler.namespace_styles(source, destination, 'stable-page')
            return issue_compiler.load_native(destination)
        serif = namespace('Source Serif 4', 'serif.designcraft')
        sans = namespace('Source Sans 3', 'sans.designcraft')
        self.assertNotEqual(serif['styles']['paragraph'][0]['name'], sans['styles']['paragraph'][0]['name'])
        self.assertEqual(sans['stories']['1']['text'], 'Exact source copy.')
        self.assertEqual(sans['stories']['1']['paras'][0]['style'], sans['styles']['paragraph'][0]['name'])


class CoverTests(unittest.TestCase):
    def test_fields_follow_issue_and_reordered_article_assignments(self):
        data=source();data['issue'].update(date='2026-10-11',volume=33,number=2)
        data['layoutPlan']={'cover':{'line':'Cover headline','caption':'Photo credit','photoPath':'photo.png'},
                            'pages':[{'templateId':'story-1-none-airy','pageNumber':3,'articleIds':['article']}]}
        template=next(t for t in json.loads(LIBRARY.read_text())['templates'] if t['id']=='cover-framed-cards-border')
        resolved=resolve_cover(template,data,['article'],Path('/tmp'))
        slots={s['id']:s for s in resolved['slots']}
        self.assertEqual(slots['cover-date']['text'],'OCTOBER 11')
        self.assertEqual(slots['cover-issue']['text'],'VOLUME 33 · ISSUE 2 · 2026')
        self.assertTrue(slots['cover-card-1']['text'].startswith('03 · '))
        self.assertEqual(slots['cover-line']['text'],'Cover headline')
        self.assertEqual(slots['cover-caption']['text'],'Photo credit')
        self.assertEqual(slots['cover-photo']['asset'],'/tmp/photo.png')
        self.assertEqual(template['slots'][-1]['rect'],next(t for t in json.loads(LIBRARY.read_text())['templates'] if t['id']==template['id'])['slots'][-1]['rect'])
        data['layoutPlan']['pages'][0]['pageNumber']=2
        again=resolve_cover(resolved,data,['article'],Path('/tmp'))
        self.assertEqual(len([s for s in again['slots'] if s['id']=='cover-caption']),1)
        self.assertTrue(next(s for s in again['slots'] if s['id']=='cover-card-1')['text'].startswith('02 · '))
    def test_unplaced_and_duplicate_features_cannot_print_false_references(self):
        template=next(t for t in json.loads(LIBRARY.read_text())['templates'] if t['kind']=='cover')
        with self.assertRaisesRegex(ValueError,'Place each featured'):resolve_cover(template,source(),['article'],Path('/tmp'))
        with self.assertRaisesRegex(ValueError,'distinct cover'):resolve_cover(template,source(),['article','article'],Path('/tmp'))


class InterchangeMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.native = self.root / 'document.designcraft'
        self.metadata = self.root / 'metadata.json'
        self.document = dict(nextId=10, parents=[], hyperlinks=[],
                             sections=[dict(start=0, startNumber=1, style='arabicLeadingZero', includePrefix=False)],
                             stories={'1': {'text': 'Alpha'}, '2': {'text': 'Beta'}}, spreads=[])
        for number, title in enumerate(('Alpha', 'Beta'), 1):
            item = dict(id=number+2, name='headline', xf=[1, 0, 0, 1, 0, 0],
                        path={'subpaths': [{'anchors': [{'p': [10, 10]}, {'p': [90, 90]}]}]},
                        label=json.dumps(dict(role='headline', articleId=title, pageId='page-'+str(number))),
                        content=dict(type='text', story=number))
            self.document['spreads'].append(dict(pages=[dict(id=number, x=0, width=100, height=100)], items=[item]))
        self.write(self.document)
        save_metadata(self.native, self.metadata)
    def tearDown(self):
        self.temporary.cleanup()
    def write(self, document):
        with zipfile.ZipFile(self.native, 'w') as archive:
            archive.writestr('document.json', json.dumps(document))
            archive.writestr('assets/photo.png', b'exact retained photo payload')
    def assert_refused_without_modification(self, message):
        previous = self.native.read_bytes()
        with self.assertRaisesRegex(ValueError, message):
            restore_metadata(self.native, self.metadata)
        self.assertEqual(self.native.read_bytes(), previous)
    def test_exact_numbering_and_labels_restore_after_native_id_remapping(self):
        imported = copy.deepcopy(self.document)
        imported['sections'][0]['style'] = 'arabic'
        imported['stories'] = {'11': {'text': 'Alpha'}, '12': {'text': 'Beta'}}
        for index, spread in enumerate(imported['spreads'], 1):
            spread['pages'][0]['id'] += 100
            spread['items'][0]['id'] += 100
            spread['items'][0]['content']['story'] = index+10
            spread['items'][0].pop('label')
        self.write(imported)
        self.assertEqual(restore_metadata(self.native, self.metadata), 0)
        with zipfile.ZipFile(self.native) as archive:
            restored = json.loads(archive.read('document.json'))
            self.assertEqual(archive.read('assets/photo.png'), b'exact retained photo payload')
        self.assertEqual(restored['sections'], self.document['sections'])
        self.assertEqual([s['items'][0]['label'] for s in restored['spreads']],
                         [s['items'][0]['label'] for s in self.document['spreads']])
        self.assertEqual(restored['spreads'][0]['pages'][0]['id'], 101)
    def test_changed_story_or_page_order_cannot_receive_original_numbering(self):
        for change in ('text', 'page-order'):
            altered = copy.deepcopy(self.document)
            if change == 'text':
                altered['stories']['1']['text'] = 'Revised Alpha'
            else:
                altered['spreads'].reverse()
            self.write(altered)
            with self.subTest(change=change):
                self.assert_refused_without_modification('page/story order changed')
    def test_ambiguous_text_frame_label_restore_is_refused(self):
        altered = copy.deepcopy(self.document)
        duplicate = copy.deepcopy(altered['spreads'][0]['items'][0])
        duplicate['id'] = 30
        altered['spreads'][0]['items'].append(duplicate)
        self.write(altered)
        metadata = json.loads(self.metadata.read_text())
        metadata.pop('sections');metadata.pop('sectionPageStories')
        page.write_json(self.metadata, metadata)
        self.assert_refused_without_modification('label missing or ambiguous')
    def test_conflicting_label_and_outside_section_are_refused(self):
        altered = copy.deepcopy(self.document)
        altered['spreads'][0]['items'][0]['label'] = 'Conflicting native identity'
        self.write(altered)
        self.assert_refused_without_modification('label conflicts')
        self.write(self.document)
        metadata = json.loads(self.metadata.read_text())
        metadata['sections'][0]['start'] = 99
        page.write_json(self.metadata, metadata)
        self.assert_refused_without_modification('starts outside')


@unittest.skipUnless(CLI,'Set DESIGNCRAFT_CLI to run native checks')
class NativeTests(unittest.TestCase):
    setUp=ValidationTests.setUp
    tearDown=ValidationTests.tearDown
    page_args=ValidationTests.page_args
    def test_rich_native_and_sidecar_cycle(self):
        args=self.page_args('story-1-none-airy',source('A **bold** word and [a link](https://example.test).'))
        result=page.compile_page(args);self.assertEqual(result['status'],'exported')
        native=args.output/'page.designcraft';metadata=args.output/'interchange-metadata.json'
        with zipfile.ZipFile(native) as z:
            d=json.loads(z.read('document.json'));self.assertEqual(len(d['hyperlinks']),1)
            self.assertTrue(any(s['text']=='A bold word and a link.' for s in d['stories'].values()))
        script=args.output/'cycle.dcs';script.write_text('file.open '+json.dumps({'path':str(args.output/'page.idml')})+'\nfile.saveAs '+json.dumps({'path':str(args.output/'cycle.designcraft')})+'\n')
        page.run_script(CLI,script,args.output);self.assertEqual(restore_metadata(args.output/'cycle.designcraft',metadata),1)
        with zipfile.ZipFile(args.output/'cycle.designcraft') as z:reopened=json.loads(z.read('document.json'))
        self.assertEqual(d['hyperlinks'][0]['dest'],reopened['hyperlinks'][0]['dest'])
    def test_overset_retains_full_draft_and_blocks_finals(self):
        body='Long article paragraph. '*2000;data=source(body);data['articles'][0]['bodyFormat']='plain'
        args=self.page_args('story-1-none-airy',data)
        with self.assertRaisesRegex(ValueError,'Full copy retained'):page.compile_page(args)
        self.assertFalse((args.output/'page.pdf').exists());self.assertFalse((args.output/'page.idml').exists())
        with zipfile.ZipFile(args.output/'page.designcraft') as z:d=json.loads(z.read('document.json'))
        self.assertTrue(any(s['text']==body for s in d['stories'].values()))
    def test_missing_photo_is_in_both_reports(self):
        args=self.page_args('story-1-top-balanced')
        with self.assertRaisesRegex(ValueError,'Full copy retained'):page.compile_page(args)
        preflight=json.loads((args.output/'preflight.json').read_text());manifest=json.loads((args.output/'build-manifest.json').read_text())
        self.assertEqual(preflight['errors'],len(manifest['errors']))
        self.assertIn('missing-input-photo',[i['kind'] for i in preflight['issues']])


@unittest.skipUnless(CLI, 'Set DESIGNCRAFT_CLI to run native preservation regressions')
class NativePreservationTests(unittest.TestCase):
    setUp = ValidationTests.setUp
    tearDown = ValidationTests.tearDown

    def build_base(self, featured=None):
        # Both different articles occupy the same native facing spread.
        # Their protected assignments must be checked page by page.
        self.photo = self.root / 'cover.jpeg'
        self.photo.write_bytes((LIBRARY.parent / 'assets/source-cover-photo.jpeg').read_bytes())
        featured = ['alpha', 'beta'] if featured is None else list(featured)
        data = dict(schemaVersion=page.ISSUE_SCHEMA,
                    issue=dict(title='Over the Edge', date='2026-10-12', volume=33, number=2),
                    articles=[dict(id='alpha', title='Alpha', body='Complete Alpha copy. [Read more](https://example.test/alpha)', photos=[]),
                              dict(id='beta', title='Beta', body='Complete Beta copy.', photos=[])],
                    layoutPlan=dict(cover=dict(mode='editable', articleIds=featured, photoPath=str(self.photo)),
                                    pages=[dict(id='cover', pageNumber=1, templateId='cover-framed-cards-border', articleIds=featured),
                                           dict(id='page-alpha', pageNumber=2, templateId='story-1-none-airy', articleIds=['alpha']),
                                           dict(id='page-beta', pageNumber=3, templateId='story-1-none-airy', articleIds=['beta']),
                                           dict(id='back', pageNumber=4, templateId='ad-full', articleIds=[])]))
        manifest = issue_compiler.compile_issue(self.arguments(data, 'base'))
        self.assertEqual(manifest['preflight']['errors'], 0)
        return data, self.root / 'base/issue.designcraft'

    def arguments(self, data, name, base=None):
        path = self.root / (name + '-source.json')
        page.write_json(path, data)
        return argparse.Namespace(library=getattr(self, 'library', LIBRARY), issue=path, output=self.root / name,
                                  cli=CLI, font_dir=LIBRARY.parent / 'assets/fonts', base_native=base, booklet=False,
                                  allow_unplaced=False, font_profile='portable')

    def assert_blocked(self, data, native, message):
        args = self.arguments(data, 'blocked', native)
        with self.assertRaisesRegex(ValueError, message):
            issue_compiler.compile_issue(args)
        self.assertFalse((args.output / 'issue.pdf').exists())
        self.assertFalse((args.output / 'issue.idml').exists())

    def test_swapped_assignments_on_protected_facing_pages_are_rejected(self):
        data, native = self.build_base()
        data['layoutPlan']['pages'][1].update(mode='preserve', articleIds=['beta'])
        data['layoutPlan']['pages'][2].update(mode='preserve', articleIds=['alpha'])
        self.assert_blocked(data, native, 'Protected article assignments changed')

    def test_unmanifested_facing_base_still_checks_the_actual_article_page(self):
        data, native = self.build_base()
        base_manifest = json.loads((native.parent / 'build-manifest.json').read_text())
        (native.parent / 'build-manifest.json').unlink()
        for index in (1, 2):
            data['layoutPlan']['pages'][index].update(mode='preserve',
                sourceNativePageId=base_manifest['pages'][index]['nativePageId'])
        data['layoutPlan']['pages'][1]['articleIds'] = ['beta']
        data['layoutPlan']['pages'][2]['articleIds'] = ['alpha']
        self.assert_blocked(data, native, 'does not contain the assigned full article body')

    def test_moved_stable_ids_of_protected_pages_are_rejected(self):
        data, native = self.build_base()
        pages = data['layoutPlan']['pages']
        pages[1], pages[2] = pages[2], pages[1]
        for number, planned in enumerate(pages, 1):
            planned['pageNumber'] = number
        pages[1]['mode'] = pages[2]['mode'] = 'preserve'
        self.assert_blocked(data, native, 'Protected page identity/order changed')

    def test_changed_cover_image_bytes_at_the_same_path_are_rejected(self):
        data, native = self.build_base()
        data['layoutPlan']['cover']['mode'] = 'preserve'
        data['layoutPlan']['pages'][0]['mode'] = 'preserve'
        # A valid JPEG can retain extra trailing data. The exact supplied asset
        # still changed, although its filename and crop coordinates did not.
        self.photo.write_bytes(self.photo.read_bytes() + b'changed supplied cover image bytes')
        self.assert_blocked(data, native, 'Cover image bytes changed')

    def test_inplace_base_rebuild_refuses_before_deleting_reviewable_outputs(self):
        data, native = self.build_base()
        files = ['issue.designcraft', 'issue.pdf', 'issue.idml', 'build-manifest.json']
        original = {name: (native.parent / name).read_bytes() for name in files}
        args = self.arguments(data, 'unused', native)
        args.output = native.parent
        with self.assertRaisesRegex(ValueError, 'separate output directory'):
            issue_compiler.compile_issue(args)
        self.assertEqual({name: (native.parent / name).read_bytes() for name in files}, original)

    def test_changed_nonfeatured_title_or_byline_cannot_be_silently_ignored(self):
        data, native = self.build_base(featured=['alpha'])
        for field in ('title', 'author'):
            changed = copy.deepcopy(data)
            changed['articles'][1][field] = 'Changed editorial ' + field
            changed['layoutPlan']['pages'][1]['mode'] = 'preserve'
            changed['layoutPlan']['pages'][2]['mode'] = 'preserve'
            with self.subTest(field=field):
                self.assert_blocked(changed, native, 'Protected article metadata changed')

    def test_static_protected_headline_reference_survives_checked_idml(self):
        data, native = self.build_base(featured=[])
        data['layoutPlan']['cover']['articleIds'] = ['alpha']
        data['layoutPlan']['pages'][0]['articleIds'] = ['alpha']
        data['layoutPlan']['pages'][1]['mode'] = 'preserve'
        data['layoutPlan']['pages'][2]['mode'] = 'preserve'
        args = self.arguments(data, 'static-cover', native)
        manifest = issue_compiler.compile_issue(args)
        self.assertEqual(manifest['nativeCoverReferences']['features'][0]['mode'], 'static')
        restored = args.output / 'reopened.designcraft'
        script = args.output / 'cycle.dcs'
        script.write_text('file.open ' + json.dumps({'path': str(args.output / 'issue.idml')}) + '\n' +
                          'file.saveAs ' + json.dumps({'path': str(restored)}) + '\n')
        page.run_script(CLI, script, args.output)
        restore_metadata(restored, args.output / 'interchange-metadata.json')
        verified = verify_cover_references(restored, manifest['nativeCoverReferences'], CLI, args.output / 'checked-refs')
        self.assertEqual(verified['features'][0]['text'], '02 · Alpha')

    def test_protected_cover_cannot_silently_keep_a_renamed_headline(self):
        # Cover cards hold a live page number followed by the headline as plain text (a reference
        # that generates the whole headline breaks inside words when it wraps). A protected card
        # therefore cannot follow a renamed headline; the compiler must say so instead of printing
        # the old title.
        data, native = self.build_base()
        data['layoutPlan']['cover']['mode'] = 'preserve'
        data['layoutPlan']['pages'][0]['mode'] = 'preserve'
        data['articles'][0]['title'] = 'Revised Alpha'
        self.assert_blocked(data, native, 'cannot follow a changed headline')

    def test_protected_cover_keeps_its_live_page_number_through_idml(self):
        data, native = self.build_base()
        before = issue_compiler.load_native(native)
        cover_before = issue_compiler.page_objects(before, 0)
        data['layoutPlan']['cover']['mode'] = 'preserve'
        data['layoutPlan']['pages'][0]['mode'] = 'preserve'
        args = self.arguments(data, 'same-headline', native)
        manifest = issue_compiler.compile_issue(args)
        self.assertTrue(manifest['preservedNativePages']['cover'])
        self.assertEqual(manifest['preflight']['errors'], 0)
        final = issue_compiler.load_native(args.output / 'issue.designcraft')
        self.assertEqual(issue_compiler.page_objects(final, 0), cover_before)
        checked = verify_cover_references(args.output / 'issue.designcraft', manifest['nativeCoverReferences'], CLI, args.output / 'checked-refs')
        self.assertEqual((checked['features'][0]['generated'], checked['features'][0]['text']), ('02', '02 · Alpha'))
        restored = args.output / 'reopened.designcraft'
        script = args.output / 'cycle.dcs'
        script.write_text('file.open ' + json.dumps({'path': str(args.output / 'issue.idml')}) + '\n' +
                          'file.saveAs ' + json.dumps({'path': str(restored)}) + '\n')
        page.run_script(CLI, script, args.output)
        self.assertEqual(restore_metadata(restored, args.output / 'interchange-metadata.json'), 1)
        cycled = verify_cover_references(restored, manifest['nativeCoverReferences'], CLI, args.output / 'cycled-refs')
        self.assertEqual(cycled['features'][0]['text'], '02 · Alpha')

    def test_issue_metadata_changes_cannot_be_ignored_on_a_protected_cover(self):
        data, native = self.build_base()
        # Cover fields came from issue metadata, rather than explicit cover
        # overrides. Exercise both supported ways of protecting page 1.
        for protection in ('cover-mode', 'page-mode'):
            for field, replacement in (('date', '2026-10-13'), ('volume', 34), ('number', 3)):
                changed = copy.deepcopy(data)
                changed['layoutPlan']['pages'][0]['mode'] = 'preserve'
                if protection == 'cover-mode':
                    changed['layoutPlan']['cover']['mode'] = 'preserve'
                changed['issue'][field] = replacement
                with self.subTest(protection=protection, field=field):
                    self.assert_blocked(changed, native, 'Cover fields changed')

    def test_protected_dynamic_cover_tracks_reordered_featured_articles(self):
        data, native = self.build_base()
        original = issue_compiler.load_native(native)
        cover_before = issue_compiler.page_objects(original, 0)
        data['layoutPlan']['cover']['mode'] = 'preserve'
        data['layoutPlan']['pages'][0]['mode'] = 'preserve'
        pages = data['layoutPlan']['pages']
        pages[1], pages[2] = pages[2], pages[1]
        pages[1]['pageNumber'], pages[2]['pageNumber'] = 2, 3
        args = self.arguments(data, 'moved-featured', native)
        manifest = issue_compiler.compile_issue(args)
        self.assertEqual(manifest['preflight']['errors'], 0)
        final = issue_compiler.load_native(args.output / 'issue.designcraft')
        self.assertEqual(issue_compiler.page_objects(final, 0), cover_before)
        checked = verify_cover_references(args.output / 'issue.designcraft', manifest['nativeCoverReferences'], CLI, args.output / 'checked-refs')
        self.assertEqual([record['text'] for record in checked['features']], ['03 · Alpha', '02 · Beta'])
        # A static cover has no mechanism to follow the moved article.
        base_manifest = json.loads((native.parent / 'build-manifest.json').read_text())
        base_manifest['nativeCoverReferences']['features'][0]['mode'] = 'static'
        page.write_json(native.parent / 'build-manifest.json', base_manifest)
        self.assert_blocked(data, native, 'article moved while its cover was protected')

    def test_reformatted_existing_page_uses_the_new_font_size(self):
        library = json.loads(LIBRARY.read_text())
        for template in library['templates']:
            for slot in template['slots']:
                if slot.get('asset') and not Path(slot['asset']).is_absolute():
                    slot['asset'] = str((LIBRARY.parent / slot['asset']).resolve())
        recipe = next(template for template in library['templates'] if template['id'] == 'story-1-none-airy')
        headline = next(slot for slot in recipe['slots'] if slot['role'] == 'headline')
        headline['fontSize'] = 18
        self.library = self.root / 'templates.json'
        page.write_json(self.library, library)
        data, native = self.build_base()
        original = issue_compiler.load_native(native)
        headline['fontSize'] = 24
        page.write_json(self.library, library)
        data['layoutPlan']['cover']['mode'] = 'preserve'
        data['layoutPlan']['pages'][0]['mode'] = 'preserve'
        args = self.arguments(data, 'new-typography', native)
        manifest = issue_compiler.compile_issue(args)
        self.assertEqual(manifest['preflight']['errors'], 0)
        updated = issue_compiler.load_native(args.output / 'issue.designcraft')
        def headline_style(document):
            frame = next(item for spread in document['spreads'] for item in issue_compiler.walk_items(spread['items'])
                         if item.get('content', {}).get('type') == 'text' and item.get('label') and
                         json.loads(item['label']).get('role') == 'headline' and json.loads(item['label']).get('articleId') == 'alpha')
            name = document['stories'][str(frame['content']['story'])]['paras'][0]['style']
            return next(style for style in document['styles']['paragraph'] if style['name'] == name)
        before, after = headline_style(original), headline_style(updated)
        self.assertEqual(before['chars']['size'], 18)
        self.assertEqual(after['chars']['size'], 24)
        self.assertNotEqual(before['name'], after['name'])
        self.assertTrue(manifest['preservedNativePages']['cover'])


if __name__=='__main__':unittest.main()
