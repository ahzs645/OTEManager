#!/usr/bin/env python3
"""Build measured OTE source presets and vector artwork from the committed PDFs.

Run after build-original-templates.mjs. PyMuPDF is an audit/build dependency only;
the browser and production runtime use the committed outputs.
"""
import copy
import hashlib
import json
import re
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public/designcraft'
ART = PUBLIC / 'source-art'
ART.mkdir(exist_ok=True)
MARCH = 'issue-7-march-2025-dfcbb959'
OCTOBER = 'issue-2-october-2025-0eb630f7'
library = json.loads((PUBLIC / 'templates.json').read_text())
library['templates'] = [t for t in library['templates'] if not t['id'].startswith('source-')]
library['designs']['ote-2024']['fonts']['portable']['Kefa|Regular'] = ['TeX Gyre Heros','Regular']
library['designs']['ote-2024']['fonts']['portable']['Kefa|Bold'] = ['TeX Gyre Heros','Bold']
catalogue = dict(schemaVersion='ote.designcraft.source-presets.v1', sections=[], blocks=[], templates=[],
                 notes='Measured from supplied PDFs. A is the literal source header marker; section names do not imply a different historical header code. Adjacent editorial frames are new editable placement options in source blank areas.')


def source(document, page, label, notes=''):
    path = PUBLIC / 'originals' / (document + '.pdf')
    return dict(documentId=document, pdf='pdfs/' + document + '.pdf', page=page, label=label,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(), notes=notes)


def crop(name, document, page, rect):
    src = fitz.open(PUBLIC / 'originals' / (document + '.pdf'))
    out = fitz.open()
    clip = fitz.Rect(rect)
    target = out.new_page(width=clip.width, height=clip.height)
    target.show_pdf_page(target.rect, src, page - 1, clip=clip)
    path = ART / (name + '.pdf')
    out.save(path, garbage=4, deflate=True)
    target.get_pixmap().save(ART / (name + '.png'))
    return dict(asset='source-art/' + name + '.pdf', previewAsset='source-art/' + name + '.png')


def text_free_art(name, document, page, rect, keep=None):
    """Remove text only; keep source images, vector illustration and clipping."""
    src = fitz.open(PUBLIC / 'originals' / (document + '.pdf'))
    p = src[page-1]
    clip = fitz.Rect(rect)
    for block in p.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                if fitz.Rect(span['bbox']).intersects(clip) and not (keep and keep(span)):
                    p.add_redact_annot(span['bbox'], fill=False, cross_out=False)
    p.apply_redactions(images=0,graphics=0,text=0)
    out = fitz.open(); target = out.new_page(width=clip.width,height=clip.height)
    target.show_pdf_page(target.rect,src,page-1,clip=clip)
    out.save(ART/(name+'.pdf'),garbage=4,deflate=True)
    target.get_pixmap().save(ART/(name+'.png'))
    return dict(asset='source-art/'+name+'.pdf',previewAsset='source-art/'+name+'.png')


def section(sid, label):
    catalogue['sections'].append(dict(id=sid, label=label, code='A'))


def register(template, src):
    template['source'] = src
    library['templates'].append(template)
    catalogue['templates'].append(dict(templateId=template['id'], label=template['name'], source=src))


def house(design, sid, name, slots, count=0, section_label=''):
    date_slots = copy.deepcopy(next(t for t in library['templates'] if t.get('design') == design and t['kind'] == 'story')['slots'])
    date_slots = [s for s in date_slots if s.get('field') == 'issueDate']
    return dict(id=sid, name=name, kind='story' if count else 'custom', storyCount=count, photoCount=0,
                design=design, art='interior', section=dict(code='A', label=section_label), slots=slots + date_slots)


def editorial(rect):
    x, y, r, b = rect
    return [dict(id='headline-1', role='headline', articleIndex=0, rect=[x,y,r,y+63], fontSize=22),
            dict(id='byline-1', role='byline', articleIndex=0, rect=[x,y+67,r,y+85]),
            dict(id='body-1', role='body', articleIndex=0, rect=[x,y+95,r,b], columns=1)]


def fixed(name, document, page, rect, label, design=None, area=None, block_type='ad', notes=''):
    src = source(document, page, label, notes)
    assets = crop(name, document, page, rect)
    block = dict(id=name, name=label, type=block_type, blockType=block_type, rect=rect, fields={}, source=src, fit='contain', **assets)
    catalogue['blocks'].append(block)
    slots = [dict(id=name, role='ad' if block_type == 'ad' else 'piece', rect=rect, fit='contain', **assets)]
    if area:
        slots = editorial(area) + slots
    template = house(design, 'source-' + name, label + (' + article' if area else ' · source artwork'), slots, int(bool(area)), label) if design else dict(id='source-'+name,name=label+' · source artwork',kind='custom',storyCount=0,photoCount=0,slots=slots)
    register(template, src)


for sid, label in [('editorial','Editorial'), ('inside-the-edge','Inside the Edge'), ('president-qa','President question of the month'), ('board','Our Board'), ('alumni','Alumni Profiles'), ('cfur','CFUR Radio')]:
    section(sid, label)

# The exact archived artwork remains an option alongside the editable Q&A.
fixed('2024-president-original',MARCH,6,[374.698547,400.000031,717.664307,757.440002],'President Answers', 'ote-2024', block_type='president-qa', notes='Original question, answer and artwork preserved as one vector PDF placement.')
metadata = json.loads((ART / 'march-president-source.json').read_text())
rect = metadata['clip']
x, y, r, b = rect
fields = {t['role']: t['text'] for t in metadata['texts']}
# Use the paired IDML's actual text-frame bounds and source paragraphs. PDF
# extraction inserts visual line breaks that are not part of the article copy.
source_frames = dict(heading=[452.5155,408.0857,663.12,509.76],subtitle=[416.9239,433.9213,674.1746,468.4813],question=[423.36,564.730957,564.05436554,615.75199085],answer=[498.96,637.2,689.51619888,695.09940324])
fields['question']='Pineapple on pizza—yes or no?'
fields['answer']='I really like pizza but I would be a no for pineapple on mine'
layout = []
for text in metadata['texts']:
    l, t, rr, bb = source_frames[text['role']]
    style = dict(fontFamily=text['fontFamily'], fontStyle=text['fontStyle'], size=text['size'], leading=text['size']*1.08,
                 para=dict(align='center',hyphenate=False), chars=dict(fill='[Paper]' if text.get('fill') == 'white' else '[Black]'))
    layout.append(dict(field=text['role'],rect=[max(0,(l-x)/(r-x)),max(0,(t-y)/(b-y)),min(1,(rr-x)/(r-x)),min(1,(bb-y)/(b-y))],style=style))
qa = dict(id='president-qa',role='piece',blockType='president-qa',rect=rect,fields=fields,contentLayout=layout)
background = dict(id='president-background',role='ad',rect=rect,asset=metadata['background'],previewAsset='source-art/march-president-background.png',fit='contain')
bg = fitz.open(PUBLIC / metadata['background']); bg[0].get_pixmap().save(ART / 'march-president-background.png')
src = source(MARCH,6,'President Answers · editable', 'Original illustration and portrait retained. Heading, subtitle, question and answer are editable native text. Portable fonts substitute the source faces.')
register(house('ote-2024','source-2024-president-qa','President Answers · editable', [background,qa],section_label='President Answers'), src)
register(house('ote-2024','source-2024-president-with-story','President Answers + article', editorial([49,70,365,743])+[background,qa],1,'President Answers'), src)

fixed('2024-inside-edge',MARCH,5,[39,374,717,759],'Inside the Edge','ote-2024',[49,70,706,356],'inside-edge',notes='Original bottom panel retained; the upper article frame uses the blank editorial area in the supplied PDF.')
fixed('2024-moose-ad',MARCH,16,[386.601,65.249,716.849,752.743],'Thirsty Moose right-column ad','ote-2024',[49,70,370,743],notes='Ad rectangle measured from March page 16; adjacent editorial frame is a new placement option.')
fixed('2024-recruitment-ad',MARCH,17,[378.383,64.185,718.898,755.94],'OTE recruitment right-half ad','ote-2024',[49,70,365,743])
fixed('2024-alumni',MARCH,10,[0,0,756,792],'Alumni Profiles',block_type='alumni-profile',notes='Archived full-page artwork, including source text and photographs. Use an article recipe for freely editable alumni copy.')
fixed('2024-cfur-original',MARCH,13,[0,0,756,792],'CFUR Radio March page',block_type='cfur',notes='Archived collage preserves the source torn photos, textured background and shaped text. The editable four-article companion rebuilds native text frames with source wrap contours.')
fixed('2025-president-board',OCTOBER,4,[0,0,756,792],'Interim-President question and Our Board',block_type='president-qa',notes='Complete original page including source names and question. A separate editable question panel is supplied below.')
fixed('2025-board',OCTOBER,4,[53.567,446.614,687.308,740],'Our Board 2025–2026','ote-2025',block_type='board')
fixed('2025-event-ad',OCTOBER,14,[34.954,428.098,365.221,756.94],'CFUR Queen Vinyl Night event ad','ote-2025',[385,70,706,743],notes='Source advertises October 18, 2025, at Omineca Arts Centre; retained as historical artwork.')
fixed('2025-moose-ad',OCTOBER,15,[386.348,65.249,716.849,752.36],'Thirsty Moose 2025 right-column ad','ote-2025',[49,70,370,743])
fixed('2025-recruitment-ad',OCTOBER,16,[380.88,65.249,717.356,754.92],'OTE recruitment 2025 right-half ad','ote-2025',[49,70,365,743])

# October's separate question design, with source portrait, microphones, grid
# and hand retained. The board stays a replaceable archived-art block below.
rect = [54.622,69.39,676.838,439]
assets = text_free_art('october-president-background',OCTOBER,4,rect,lambda s: s['text'].strip() in ['OTE PRESS','BRIEFING'])
fields = dict(heading='interim-President',subtitle='Question',question='Double-dipping:\nacceptable or unforgivable\n?',answer='As for double-dipping, in the words of\nGeorge Costanza, “so??... you dip the way\nyou want to dip, and I dip the way I want to\ndip.”  Double, triple it is all good.')
def relative(box):
    x,y,r,b=rect
    return [(box[0]-x)/(r-x),(box[1]-y)/(b-y),(box[2]-x)/(r-x),(box[3]-y)/(b-y)]
def face(family,style,size,leading,align='left',fill='[Black]'):
    return dict(fontFamily=family,fontStyle=style,size=size,leading=leading,chars=dict(fill=fill),para=dict(align=align,hyphenate=False))
layout = [dict(field='heading',rect=relative([54.622,70,355,127]),style=face('Salted','Regular',44,48,fill='OTE 2025 Green')),
          dict(field='subtitle',rect=relative([355,75,520,121]),style=face('Decalotype','Black',35,38)),
          dict(field='answer',rect=relative([284,181,558,267]),style=face('Helvetica Neue','Italic',12,18)),
          dict(field='question',rect=relative([380,325,615,431]),style=face('Salted','Regular',21,30,'center'))]
qa=dict(id='interim-president-qa',role='piece',blockType='president-qa',rect=rect,fields=fields,contentLayout=layout)
board=copy.deepcopy(next(t for t in library['templates'] if t['id']=='source-2025-board')['slots'][0])
register(house('ote-2025','source-2025-president-qa','Interim-President question · editable',[dict(id='president-background',role='ad',rect=rect,fit='contain',**assets),qa,board],section_label='President question and Our Board'),source(OCTOBER,4,'Interim-President question · editable','Question and response are editable native text; portrait and board panel retain original artwork. Portable fonts substitute unavailable source faces.'))

rect=[39,374,717,759]
assets=text_free_art('march-inside-edge-background',MARCH,5,rect,lambda s: s['bbox'][0]<220 or s['text'].strip()=='OTE is typing...')
page=fitz.open(PUBLIC/'originals'/(MARCH+'.pdf'))[4]
answer=''
for block in page.get_text('dict')['blocks']:
    if 'lines' in block and 530<block['bbox'][1]<540:
        lines='\n'.join(''.join(span['text'] for span in line['spans']) for line in block['lines'])
        answer=' '.join(re.sub('\u00ad\\s*','',lines).split())
fields=dict(heading='Inside the Edge',subtitle='*Q&A section',question='Are there any topics that are off-limits? How does OTE handle controversial or sensitive subjects?',answer=answer)
layout=[dict(field='heading',rect=relative([476,379,696,421]),style=face('Decalotype','Black',28,31)),
        dict(field='subtitle',rect=relative([583,414,658,432]),style=face('Helvetica Neue','Italic',10,12)),
        dict(field='question',rect=relative([342,470,650,510]),style=face('Helvetica Neue','Regular',10,13,fill='[Paper]')),
        dict(field='answer',rect=relative([240,533,696,630]),style=face('Helvetica Neue','Regular',9,12))]
register(house('ote-2024','source-2024-inside-edge-editable','Inside the Edge · editable Q&A',[dict(id='inside-edge-background',role='ad',rect=rect,fit='contain',**assets),dict(id='inside-edge-qa',role='piece',blockType='inside-edge',rect=rect,fields=fields,contentLayout=layout)],section_label='Inside the Edge'),source(MARCH,5,'Inside the Edge · editable Q&A','Original chat artwork and feedback QR retained; heading, question and response are editable native text.'))

# The CFUR collage is the source's four-article page, including polygonal text
# exclusions around its torn photographs. Keep its source art separate from copy.
cfur_file = ART / 'march-cfur-source.json'
if cfur_file.exists():
    cfur = json.loads(cfur_file.read_text())
    art = fitz.open(ART / 'march-cfur-background.pdf'); art[0].get_pixmap().save(ART / 'march-cfur-background.png')
    slots = [dict(id='cfur-background',role='ad',rect=[0,0,756,792],asset='source-art/march-cfur-background.pdf',previewAsset='source-art/march-cfur-background.png',fit='contain')]
    for frame in cfur['frames']:
        ai, role = frame['articleIndex'], frame['role']
        size = 22 if role == 'headline' else 10 if ai in [0,1] else 11
        style = face('Wordy Diva' if role == 'headline' else 'Kefa','Regular',size,26.4 if role == 'headline' else 14 if ai in [0,1] else 15,fill='[Paper]')
        style['portable'] = dict(fontFamily='Caveat Brush' if role=='headline' else 'Source Serif 4',fontStyle='Regular')
        style['para'].update(spaceAfter=0,hyphenate=role=='body')
        region=copy.deepcopy(frame['rect'])
        if ai==1 and role=='body':
            # The bundled Kefa substitute needs one extra line in the source's
            # empty inter-story gap. Keep 10pt/14pt and every source word.
            region[3]+=18
        slots.append(dict(id=f'cfur-{role}-{ai+1}',role=role,articleIndex=ai,rect=region,sourceRect=frame['rect'],style=style))

    def clip_polygon(points):
        # Sutherland–Hodgman clipping retains contour intersections at the page
        # edge, unlike clamping individual vertices of the source polygon.
        for axis,bound,greater in [(0,0,True),(0,756,False),(1,0,True),(1,792,False)]:
            output=[]
            if not points: break
            for prev,cur in zip(points[-1:]+points[:-1],points):
                inside=lambda p: p[axis]>=bound if greater else p[axis]<=bound
                if inside(prev)!=inside(cur):
                    ratio=(bound-prev[axis])/(cur[axis]-prev[axis])
                    output.append([bound if axis==0 else prev[0]+ratio*(cur[0]-prev[0]),bound if axis==1 else prev[1]+ratio*(cur[1]-prev[1])])
                if inside(cur): output.append(cur)
            points=output
        return points
    for wrap in cfur['wraps']:
        points=clip_polygon(wrap['points'])
        slots.append(dict(id=wrap['id'],role='wrap',points=points,offset=wrap['offset'][0],rect=[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]))
    template = dict(id='source-2024-cfur-briefs',name='CFUR Radio · four editable articles',kind='story',storyCount=4,photoCount=0,design='ote-2024',slots=slots,section=dict(code='A',label='CFUR Radio'))
    register(template,source(MARCH,13,'CFUR Radio · four editable articles','Frame coordinates and torn-photo wrap contours from the paired IDML. The CN Centre body extends 18pt into the empty source gap to fit the portable font at the source 10pt/14pt size; sourceRect retains the original bounds. Photos, texture, sponsor panel and folio remain artwork; all four complete titles and bodies are editable. Caveat Brush / Source Serif 4 replace Wordy Diva / Kefa unless original faces are supplied.'))

(PUBLIC / 'templates.json').write_text(json.dumps(library,ensure_ascii=False,indent=2)+'\n')
(PUBLIC / 'source-presets.json').write_text(json.dumps(catalogue,ensure_ascii=False,indent=2)+'\n')
print(f"Built {len(catalogue['templates'])} source templates and {len(catalogue['blocks'])} measured blocks")
