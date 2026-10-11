#!/usr/bin/env python3
"""Rebuild documented layout families as explicit recipes and schematic PDFs.

These are newly reconstructed recipes, not recovered copies of the lost study.
Requires reportlab; source-PDF recovery separately requires PyMuPDF.
"""
import argparse
import json
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color

PAGE = {'width': 756, 'height': 792, 'margin': 36, 'gutter': 12}
GREEN = HexColor('#28624f')
SLOTS = []


def slot(role, rect, index=None, **extras):
    value = {'id': f'{role}-{len(SLOTS)+1}', 'role': role, 'rect': [round(x, 2) for x in rect]}
    if index is not None: value['articleIndex'] = index
    value.update(extras); SLOTS.append(value)


def story(rect, index, image='none', density=1):
    x, y, r, b = rect; width = r-x; height = b-y
    headline = min(44, height*.15)
    slot('headline', [x,y,r,y+headline], index)
    slot('byline', [x,y+headline+3,r,y+headline+18], index)
    top = y+headline+27
    if image == 'none':
        slot('body',[x,top,r,b],index,columns=3 if width>550 else 2 if width>310 else 1)
        return
    if image in ['left','right']:
        iw = width*.38; ix = x if image=='left' else r-iw
        slot('photo',[ix,top,ix+iw,top+(b-top)*.66],index)
        slot('caption',[ix,top+(b-top)*.66+3,ix+iw,top+(b-top)*.66+25],index)
        slot('body',[x+iw+12 if image=='left' else x,top,r if image=='left' else r-iw-12,b],index,columns=1)
    else:
        ih = min((b-top)*(.43 if image=='hero' else .24 if 'small' in image else .34)*density, (b-top)-95)
        if image.startswith('bottom'):
            slot('body',[x,top,r,b-ih-34],index,columns=3 if width>550 else 2 if width>310 else 1)
            slot('photo',[x,b-ih-22,r,b-22],index);slot('caption',[x,b-18,r,b],index)
        else:
            slot('photo',[x,top,r,top+ih],index);slot('caption',[x,top+ih+3,r,top+ih+24],index)
            slot('body',[x,top+ih+32,r,b],index,columns=3 if width>550 else 2 if width>310 else 1)


def story_template(count, pattern, arrangement):
    SLOTS.clear()
    area = [36,100,720,744];x,y,r,b=area;g=12
    shared = pattern=='shared-top'
    if shared:
        slot('photo',[x,y,r,y+160],0);slot('caption',[x,y+164,r,y+184],0);y+=196
    if count==1: rects=[[x,y,r,b]]
    elif arrangement=='stacked':
        h=(b-y-g*(count-1))/count;rects=[[x,y+i*(h+g),r,y+i*(h+g)+h] for i in range(count)]
    elif arrangement=='lead-top' and count==3:
        mid=y+(b-y)*.48
        rects=[[x,y,r,mid],[x,mid+g,(x+r-g)/2,b],[(x+r+g)/2,mid+g,r,b]]
    elif arrangement=='lead-left':
        mid=x+(r-x)*.56
        rects=[[x,y,mid,b]]
        h=(b-y-g*(count-2))/(count-1)
        rects += [[mid+g,y+i*(h+g),r,y+i*(h+g)+h] for i in range(count-1)]
    else:
        w=(r-x-g*(count-1))/count;rects=[[x+i*(w+g),y,x+i*(w+g)+w,b] for i in range(count)]
    density={'compact':.75,'balanced':1,'airy':1.18}.get(arrangement,1)
    for i,rect in enumerate(rects):
        image='none'
        if count==1:image=pattern
        elif not shared and pattern!='none':
            number,position=pattern.split('-',1)
            n={'one':1,'two':2,'three':3}[number]
            if i<n:image={'side':'left'}.get(position,position)
        story(rect,i,image,density)
    slot('folio',[36,756,720,778],text='OVER THE EDGE · {page}')
    photo_count=sum(s['role']=='photo' for s in SLOTS)
    return {'id':f'story-{count}-{pattern}-{arrangement}','name':f'{count} {"story" if count==1 else "stories"} · {pattern.replace("-"," ")} · {arrangement}',
            'kind':'story','storyCount':count,'photoCount':photo_count,'pattern':pattern,'arrangement':arrangement,'slots':list(SLOTS)}


def library():
    templates=[]
    for pattern in ['none','top','bottom','left','right','hero','top-small','bottom-small']:
        for shape in ['compact','balanced','airy']:templates.append(story_template(1,pattern,shape))
    for pattern in ['none','one-top','one-bottom','one-side','two-top','two-bottom','two-side','shared-top']:
        for shape in ['columns','stacked','lead-left']:templates.append(story_template(2,pattern,shape))
    for pattern in ['none','one-top','one-bottom','two-top','three-top','three-bottom','shared-top']:
        for shape in ['columns','stacked','lead-left','lead-top']:templates.append(story_template(3,pattern,shape))
    ad_rects={'full':[36,36,720,756], 'half-top':[36,36,720,390], 'half-bottom':[36,402,720,756],
              'half-left':[36,36,372,756], 'half-right':[384,36,720,756], 'quarter-top-left':[36,36,372,390],
              'quarter-top-right':[384,36,720,390], 'quarter-bottom-left':[36,402,372,756],
              'quarter-bottom-right':[384,402,720,756], 'third-top':[36,36,720,268], 'third-bottom':[36,524,720,756],
              'strip-bottom':[36,636,720,756], 'column-left':[36,36,204,756], 'column-right':[552,36,720,756]}
    for name,rect in ad_rects.items():
        templates.append({'id':'ad-'+name,'name':'Advertisement · '+name.replace('-',' '),'kind':'ad','storyCount':0,'photoCount':0,
                          'slots':[{'id':'ad-1','role':'ad','rect':rect,'text':'RESERVED ADVERTISEMENT'}]})
    pieces={'president-qa':{'question':'Your question','answer':'The president’s answer'},
            'board-members':{'heading':'Meet the board','members':[{'name':'Member name','role':'Board role','bio':'Short introduction','photo':None}]},
            'interview':{'heading':'In conversation','questions':[{'question':'Your question','answer':'Interview response'}]},
            'events':{'heading':'On campus','events':[{'title':'Event title','date':'YYYY-MM-DD','location':'Location'}]},
            'pull-quote':{'quote':'Your quotation','attribution':'Name'}, 'custom':{'heading':'Custom block','body':'Your content'}}
    for name,fields in pieces.items():
        templates.append({'id':'piece-'+name,'name':name.replace('-',' ').title(),'kind':'custom','storyCount':0,'photoCount':0,'fields':fields,
                          'slots':[{'id':'piece-1','role':'piece','rect':[36,100,720,360],'text':name.replace('-',' ').upper(),'fields':fields}]})
    for family in ['stacked','framed']:
        for references in ['list','cards']:
            for border in [True,False]:
                if family=='stacked':
                    slots=[{'id':'cover-photo','role':'photo','rect':[60,116,696,472],'articleIndex':0},
                           {'id':'cover-logo','role':'photo','rect':[36,550,340,752],'asset':'assets/ote-stacked-logo.pdf'},
                           {'id':'cover-date','role':'headline','rect':[36,36,445,78],'text':'SEPTEMBER 12TH'},
                           {'id':'cover-issue','role':'byline','rect':[470,36,600,78],'text':'VOLUME 32 · ISSUE 1'},
                           {'id':'cover-year','role':'headline','rect':[620,36,720,78],'text':'2025'},
                           {'id':'cover-line','role':'caption','rect':[60,488,696,516],'text':'OVER THE EDGE IS BACK!'}]
                    rects=[[390,550+i*66,720,604+i*66] for i in range(3)]
                else:
                    slots=[{'id':'cover-logo','role':'photo','rect':[42,42,520,136],'asset':'assets/ote-horizontal-logo.png'},
                           {'id':'cover-date','role':'headline','rect':[542,42,714,114],'text':'NOVEMBER 14'},
                           {'id':'cover-issue','role':'byline','rect':[542,116,714,142],'text':'2024 · VOLUME 31 · ISSUE 3'},
                           {'id':'cover-photo','role':'photo','rect':[42,154,714,566],'articleIndex':0},
                           {'id':'cover-line','role':'caption','rect':[42,574,714,596],'text':'OVER THE EDGE'}]
                    rects=[[42+i*228,604,258+i*228,746] for i in range(3)]
                slots += [{'id':f'cover-card-{i+1}','role':'piece','rect':rect,'articleIndex':i,'text':f'{[3,5,10][i]:02d} · Selected article {i+1}'} for i,rect in enumerate(rects)]
                templates.append({'id':f'cover-{family}-{references}-'+('border' if border else 'plain'), 'name':f'{family.title()} cover · {references} · '+('border' if border else 'plain'),
                                  'kind':'cover','storyCount':0,'photoCount':1,'family':family,'references':references,'border':border,'slots':slots})
    return {'schemaVersion':'ote.designcraft.templates.v1','page':PAGE,'provenance':'Reconstructed from the earlier build record and recovered source covers. Not the lost original prototype.',
            'fontProfile':{'portable':{'headline':'Source Sans 3 Bold','body':'Source Serif 4 Regular'},
                           'original2025':{'date':'Decalotype Black','handwritten':'Salted','references':'Helvetica Neue Bold / Condensed Bold'},
                           'original2024':{'text':'Helvetica Neue / Heavy'},
                           'missingSourceFont':'Salted is referenced in source IDML but its file was not found. Proprietary fonts are not redistributed.'},
            'templates':templates}


def proof_pdf(data,out):
    path=out/'pdfs'/'reconstructed-template-catalogue.pdf'
    c=canvas.Canvas(str(path),pagesize=(756,792));c.setTitle('OTE reconstructed template catalogue')
    colors={'photo':'#d4e5df','ad':'#ece1cb','piece':'#e1dcf0','headline':'#d4dacf','body':'#f1f0eb','byline':'#ecece7','caption':'#ecece7','folio':'#e5e7e5'}
    for t in data['templates']:
        c.setFillColor(GREEN);c.setFont('Helvetica-Bold',18);c.drawString(36,756,t['name'][:70])
        c.setFont('Helvetica',9);c.drawString(36,739,'RECONSTRUCTED SCHEMATIC · '+t['id'])
        for s in t['slots']:
            x,y,r,b=s['rect'];c.setFillColor(HexColor(colors.get(s['role'],'#eeeeee')));c.setStrokeColor(Color(.55,.65,.6));c.rect(x,792-b,r-x,b-y,fill=1,stroke=1)
            c.setFillColor(GREEN);c.setFont('Helvetica',min(10,max(5,(b-y)/3)))
            c.drawString(x+5,792-y-min(15,(b-y)*.7),s['role'].upper()+(f" {s['articleIndex']+1}" if 'articleIndex' in s else ''))
        c.showPage()
    c.save()
    return path


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',default='public/designcraft');args=p.parse_args()
    out=Path(args.output);(out/'pdfs').mkdir(parents=True,exist_ok=True)
    data=library();(out/'templates.json').write_text(json.dumps(data,indent=2));proof_pdf(data,out)
    print(json.dumps({'templates':len(data['templates']),'storyTemplates':sum(t['kind']=='story' for t in data['templates'])}))
