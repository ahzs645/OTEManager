#!/usr/bin/env python3
"""Meaningful thread/reference regressions; set DESIGNCRAFT_CLI for native checks."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile

from native_flow import _read_native, thread_article_stories
from native_references import attach_cover_references, verify_cover_references, _run, ANCHOR_MARK

CLI = os.environ.get('DESIGNCRAFT_CLI')
ROOT = Path(__file__).resolve().parents[2]


def synthetic_frame(fid, sid, page_id):
    return dict(id=fid, xf=[1, 0, 0, 1, 0, 0],
                path={'subpaths': [{'anchors': [{'p': [5, 5]}, {'p': [95, 95]}]}]},
                label=json.dumps(dict(role='body', articleId='article', pageId=page_id, slotId='body')),
                content=dict(type='text', story=sid, options={'columns': 2}))


class ThreadValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.native = self.root / 'document.designcraft'
        self.rich = dict(id=11, text='café link', frames=[1],
                         chars=[{'len': 10, 'attrs': {'fontStyle': 'Bold Italic'}}],
                         paras=[{'style': 'Article Body'}], notes=[], objects=[], anchors=[], xrefs=[])
        self.document = dict(spreads=[dict(pages=[dict(id=n, x=0, width=100, height=100)],
                                          items=[synthetic_frame(n, 10+n, 'page-'+str(n))]) for n in (1, 2)],
                             stories={'11': self.rich, '12': dict(id=12, text='', frames=[2], chars=[], paras=[])},
                             hyperlinks=[dict(id=30, source=dict(kind='text', story=11, start=0, end=5),
                                              dest=dict(kind='url', value='https://example.test'))])
        self.save()
    def tearDown(self):
        self.temporary.cleanup()
    def save(self):
        with zipfile.ZipFile(self.native, 'w') as archive:
            archive.writestr('document.json', json.dumps(self.document, ensure_ascii=False))
            archive.writestr('assets/photo.png', b'exact embedded image payload')
    def flow(self):
        return {'article': {'pageIds': ['page-1', 'page-2']}}
    def test_thread_keeps_rich_copy_links_and_assets_and_is_idempotent(self):
        result = thread_article_stories(self.native, self.flow(), set())
        document, entries = _read_native(self.native)
        self.assertEqual(document['stories']['11'], {**self.rich, 'frames': [1, 2]})
        self.assertEqual(document['hyperlinks'], self.document['hyperlinks'])
        self.assertEqual(next(payload for info, payload in entries if info.filename == 'assets/photo.png'), b'exact embedded image payload')
        self.assertNotIn('12', document['stories'])
        self.assertTrue(result['article']['sourceTextUnchanged'])
        self.assertTrue(thread_article_stories(self.native, self.flow(), set())['article']['alreadyThreaded'])
    def test_rejections_do_not_modify_native_input(self):
        original = self.native.read_bytes()
        cases = [(self.flow(), {'page-2'}, 'protected'),
                 ({'article': {'pageIds': ['page-1', 'page-1']}}, set(), 'repeat'),
                 ({'article': {'pageIds': ['page-1', 'missing']}}, set(), 'ambiguous')]
        for flows, protected, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                thread_article_stories(self.native, flows, protected)
            self.assertEqual(self.native.read_bytes(), original)
    def test_nonempty_continuation_and_ambiguous_frame_are_rejected(self):
        self.document['stories']['12']['text'] = 'Copy must never be discarded.'
        self.save()
        with self.assertRaisesRegex(ValueError, 'empty independent'):
            thread_article_stories(self.native, self.flow(), set())
        self.document['stories']['12']['text'] = ''
        self.document['spreads'][1]['items'].append(synthetic_frame(3, 12, 'page-2'))
        self.save()
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            thread_article_stories(self.native, self.flow(), set())


@unittest.skipUnless(CLI, 'Set DESIGNCRAFT_CLI for native integration checks')
class NativePipelineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        fonts = ROOT / 'public/designcraft/assets/fonts'
        if fonts.is_dir():
            (self.root / 'Document Fonts').symlink_to(fonts, target_is_directory=True)
        self.native = self.root / 'issue.designcraft'
        self.body = '\n'.join('Section %d: Useful words in an article continue to another page.' % n for n in range(1, 7))
        self.articles = {'article': dict(id='article', title='Alpha', body=self.body)}
        steps = [('file.new', dict(width=200, height=200, pages=4, facingPages=False, margins=20)),
                 ('file.saveAs', {'path': str(self.native)}), ('file.open', {'path': str(self.native)})]
        def frame(spread, rect, text, role, pid, slot, size=10):
            index = len(steps)
            steps.append(('frame.create', dict(spread=spread, rect=rect, content='text', text=text, caret=False)))
            steps.append(('object.label', dict(ids=['$'+str(index)+'.id'],
                         label=json.dumps(dict(role=role, articleId='article', pageId=pid, slotId=slot)))))
            if text:
                steps.append(('text.select', dict(story='$'+str(index)+'.story', anchor=0, focus=len(text.encode()))))
                steps.append(('type.char', dict(attrs=dict(fontFamily='Source Sans 3', fontStyle='Regular', size=size,
                                                          leading=dict(kind='points', value=size*1.2)))))
            return index
        self.card_index = frame(0, [20, 20, 180, 80], '02 · Alpha', 'piece', 'cover', 'cover-card-1', 12)
        self.head_index = frame(1, [20, 5, 180, 30], 'Alpha', 'headline', 'page-A', 'headline', 12)
        self.body_index = frame(1, [20, 40, 180, 130], self.body, 'body', 'page-A', 'body')
        frame(3, [20, 5, 180, 30], 'Alpha', 'headline', 'page-C', 'headline', 12)
        self.next_index = frame(3, [20, 40, 180, 180], '', 'body', 'page-C', 'body')
        steps.extend([('text.select', dict(story='$'+str(self.body_index)+'.story', anchor=0, focus=9)),
                      ('hyperlink.create', {'url': 'https://example.test/article'}),
                      ('file.saveAs', {'path': str(self.native)})])
        results = _run(CLI, self.root, 'fixture', steps)
        self.first_body_sid = results[self.body_index]['story']
        self.head_sid = results[self.head_index]['story']
        self.head_id = results[self.head_index]['id']
    def tearDown(self):
        self.temporary.cleanup()
    def attach(self, protected=None, base=None):
        return attach_cover_references(self.native, ['article'], self.articles, protected or set(), CLI, self.root, base)
    def test_real_continuation_and_dynamic_reference_survive_idml(self):
        before, _ = _read_native(self.native)
        flow = thread_article_stories(self.native, {'article': {'pageIds': ['page-A', 'page-C']}}, set())
        manifest = self.attach()
        self.assertEqual(manifest['verification']['features'][0]['text'], '2 · Alpha')
        saved, _ = _read_native(self.native)
        self.assertEqual(saved['stories'][str(self.first_body_sid)]['text'], self.body)
        self.assertEqual(saved['hyperlinks'], before['hyperlinks'])
        idml = self.root / 'issue.idml'
        cycle = self.root / 'cycle.designcraft'
        results = _run(CLI, self.root, 'roundtrip', [
            ('file.open', {'path': str(self.native)}), ('preflight.run', {}),
            ('file.exportIdml', {'path': str(idml)}), ('file.open', {'path': str(idml)}),
            ('file.saveAs', {'path': str(cycle)}), ('preflight.run', {})])
        self.assertEqual(results[1]['errors'], 0)
        self.assertEqual(results[-1]['errors'], 0)
        reopened, _ = _read_native(cycle)
        story = next(story for story in reopened['stories'].values() if story['text'] == self.body)
        self.assertEqual(len(story['frames']), 2)
        locations = {}
        for index, spread in enumerate(reopened['spreads']):
            for item in spread['items']:
                if item.get('content', {}).get('type') == 'text':
                    locations[item['id']] = index
        self.assertEqual([locations[fid] for fid in story['frames']], [1, 3])
        self.assertEqual(flow['article']['physicalPageNumbers'], [2, 4])
        self.assertTrue(verify_cover_references(cycle, manifest, CLI, self.root)['valid'])
    def test_reference_updates_after_native_move_and_unresolved_anchor_is_rejected(self):
        manifest = self.attach()
        _run(CLI, self.root, 'insert-page', [('file.open', {'path': str(self.native)}),
             ('layout.pages.insert', {'after': 0, 'count': 1}), ('file.saveAs', {'path': str(self.native)})])
        self.assertEqual(verify_cover_references(self.native, manifest, CLI, self.root)['features'][0]['text'], '3 · Alpha')
        _run(CLI, self.root, 'remove-anchor', [('file.open', {'path': str(self.native)}),
             ('text.select', dict(story=self.head_sid, anchor=0, focus=len(ANCHOR_MARK.encode()))),
             ('text.delete', {}), ('file.saveAs', {'path': str(self.native)})])
        with self.assertRaisesRegex(ValueError, 'anchor is missing'):
            verify_cover_references(self.native, manifest, CLI, self.root)
    def test_protected_unanchored_headline_stays_static_and_cover_conflict_fails(self):
        original, _ = _read_native(self.native)
        manifest = self.attach({'page-A'})
        saved, _ = _read_native(self.native)
        self.assertEqual(manifest['features'][0]['mode'], 'static')
        self.assertEqual(saved['stories'][str(self.head_sid)], original['stories'][str(self.head_sid)])
        self.assertTrue(manifest['staticFallbacks'])
        _run(CLI, self.root, 'move-static', [('file.open', {'path': str(self.native)}),
             ('layout.pages.insert', {'after': 0, 'count': 1}), ('file.saveAs', {'path': str(self.native)})])
        with self.assertRaisesRegex(ValueError, 'stale'):
            verify_cover_references(self.native, manifest, CLI, self.root)
    def test_protected_cover_can_rebind_replaced_editable_headline(self):
        self.attach()
        base = self.root / 'base.designcraft'
        base.write_bytes(self.native.read_bytes())
        original, _ = _read_native(base)
        card_story = next(story for story in original['stories'].values() if story.get('xrefs'))
        _run(CLI, self.root, 'replace-headline', [
            ('file.open', {'path': str(self.native)}), ('edit.clear', {'ids': [self.head_id]}),
            ('frame.create', dict(spread=1, rect=[20, 5, 180, 30], content='text', text='Alpha', caret=False)),
            ('object.label', dict(ids=['$2.id'], label=json.dumps(dict(role='headline', articleId='article', pageId='page-A', slotId='headline')))),
            ('file.saveAs', {'path': str(self.native)})])
        manifest = self.attach({'cover'}, base)
        final, _ = _read_native(self.native)
        self.assertEqual(final['spreads'][0], original['spreads'][0])
        self.assertEqual(final['stories'][str(card_story['id'])], card_story)
        self.assertTrue(manifest['verification']['valid'])

    def test_quoted_headline_keeps_source_bytes_on_the_page_and_the_cover(self):
        title = 'The "Campus"'
        self.articles['article']['title'] = title
        # frame.create retains authored ASCII quote bytes, matching the page
        # compiler. text.insert applies the editor's smart-quote preference.
        changed = _run(CLI, self.root, 'quote-title', [('file.open', {'path': str(self.native)}),
             ('edit.clear', {'ids': [self.head_id]}),
             ('frame.create', dict(spread=1, rect=[20, 5, 180, 30], content='text', text=title, caret=False)),
             ('object.label', dict(ids=['$2.id'], label=json.dumps(dict(role='headline', articleId='article', pageId='page-A', slotId='headline')))),
             ('file.saveAs', {'path': str(self.native)})])
        self.head_sid = changed[2]['story']
        manifest = self.attach()
        saved, _ = _read_native(self.native)
        self.assertEqual(saved['stories'][str(self.head_sid)]['text'], ANCHOR_MARK + title)
        # The live reference holds only the page number; the card repeats the headline's own bytes.
        self.assertEqual(manifest['verification']['features'][0]['text'], '2 · ' + title)
        self.assertEqual(manifest['verification']['features'][0]['generated'], '2')
        self.assertEqual(saved['stories'][str(self.first_body_sid)]['text'], self.body)

    def test_multiline_feature_title_is_refused_without_mutating_the_native_source(self):
        self.articles['article']['title'] = 'Alpha\nSubtitle'
        before = self.native.read_bytes()
        with self.assertRaisesRegex(ValueError, 'headline needs one paragraph'):
            self.attach()
        self.assertEqual(self.native.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
