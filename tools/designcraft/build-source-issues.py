#!/usr/bin/env python3
"""Build complete source issues, with an artwork and native-text edition of every page.

The archive edition retains each source PDF page as vector artwork. The editable
edition removes its supported PDF text operators, rebuilds those text regions as
native fields and retains the graphics. Tested paragraph-level CFUR/Q&A recipes
replace their generic text regions where available. No missing articles are made up.
"""
import argparse
import copy
import hashlib
import json
import math
import re
from pathlib import Path

import fitz

ROOT=Path(__file__).resolve().parents[2]
PUBLIC=ROOT/'public/designcraft'
ART=PUBLIC/'source-art'
FONT_CACHE={}


def portable_width(text,size,portable):
    """Measure the bundled substitute, so source line lengths remain comparable."""
    family,face=portable['fontFamily'],portable['fontStyle']
    if family=='TeX Gyre Heros':name='texgyreheros-'+face.lower().replace(' ','')+'.otf'
    elif family=='Source Serif 4':name='SourceSerif4-'+{'Italic':'It','Bold Italic':'BoldIt'}.get(face,face)+'.ttf'
    elif family=='Caveat Brush':name='CaveatBrush-Regular.ttf'
    else:name=family.replace(' ','')+'-'+face.replace(' ','')+'.ttf'
    if name not in FONT_CACHE:FONT_CACHE[name]=fitz.Font(fontfile=str(PUBLIC/'assets/fonts'/name))
    return FONT_CACHE[name].text_length(text,fontsize=size)


def source_photo_rect(page,fallback):
    # September and October share a cover family but have different photo
    # frames. Recover the actual source border rather than moving the photo.
    candidates=[d['rect'] for d in page.get_drawings() if d['type']=='s' and
                600<d['rect'].width<700 and 250<d['rect'].height<500 and 80<d['rect'].y0<190]
    return list(min(candidates,key=lambda r:abs(r.get_area()-fitz.Rect(fallback).get_area()))) if candidates else fallback


def write_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')


def save_page(document,index,path,preview):
    out=fitz.open();out.insert_pdf(document,from_page=index,to_page=index)
    out[0].clean_contents()
    out.save(path,garbage=4,deflate=True)
    out[0].get_pixmap(matrix=fitz.Matrix(.8,.8)).save(preview)


def extract_image(document,info,stem):
    data=document.extract_image(info['xref'])
    smask=data.get('smask',0)
    if smask:
        pixmap=fitz.Pixmap(fitz.Pixmap(document,info['xref']),fitz.Pixmap(document,smask))
        payload=pixmap.tobytes('png');ext='png'
    else:payload=data['image'];ext=data['ext']
    path='source-art/'+stem+'.'+ext
    (PUBLIC/path).write_bytes(payload)
    return path


def cover_photo(document,index,rect,stem):
    page=document[index];clip=fitz.Rect(rect)
    images=[i for i in page.get_image_info(xrefs=True) if i['xref'] and (fitz.Rect(i['bbox'])&clip).get_area()>clip.get_area()*.5]
    if not images:return None,[],None
    primary=min(images,key=lambda i:abs(math.log(max(1,fitz.Rect(i['bbox']).get_area())/clip.get_area())))
    path=extract_image(document,primary,stem+'-photo')
    box=fitz.Rect(primary['bbox'])
    focus=dict(x=max(0,min(1,((clip.x0+clip.x1)/2-box.x0)/box.width)),y=max(0,min(1,((clip.y0+clip.y1)/2-box.y0)/box.height)))
    zoom=max(1,min(box.width/clip.width,box.height/clip.height))
    settings=dict(photoPath=path,photoPreviewPath=path,photoMimeType='image/png' if path.endswith('.png') else 'image/jpeg',fit='cover',focus=focus,zoom=zoom)
    overlays=[]
    for i,other in enumerate(page.get_image_info(xrefs=True)):
        region=fitz.Rect(other['bbox'])
        if other['xref'] and other['xref']!=primary['xref'] and (region&clip).get_area()>1 and region.get_area()<clip.get_area()*.6:
            image=extract_image(document,other,stem+f'-overlay-{i}')
            overlays.append(dict(id=f'cover-overlay-{i}',role='piece',rect=list(region&page.rect),asset=image,previewAsset=image,fit='contain'))
    page.delete_image(primary['xref'])
    return settings,overlays,primary


def separate_advertisements(original,index,background,spots,stem):
    """Keep each measured creative in its own replaceable native ad frame."""
    slots=[]
    for spot in spots:
        rect=fitz.Rect(spot['rect']);name=stem+'-ad-'+spot['id']
        cropped=fitz.open();target=cropped.new_page(width=rect.width,height=rect.height)
        target.show_pdf_page(target.rect,original,index,clip=rect)
        asset='source-art/'+name+'.pdf';preview='source-art/'+name+'.png'
        cropped.save(PUBLIC/asset,garbage=4,deflate=True)
        target.get_pixmap(matrix=fitz.Matrix(.8,.8)).save(PUBLIC/preview)
        images=[i for i in background[0].get_image_info(xrefs=True) if i['xref'] and
                (fitz.Rect(i['bbox'])&rect).get_area()>rect.get_area()*.95]
        if images:
            image=min(images,key=lambda i:abs(fitz.Rect(i['bbox']).get_area()-rect.get_area()))
            background[0].delete_image(image['xref'])
        elif spot.get('reserved') or spot['id']=='reserved-ad':
            # The hash-verified September reservation is the page's sole
            # Figure marked-content tail. The header and house border live in
            # the preceding form XObjects. Removing this tail removes the grey
            # fill AND zero-width cross strokes, which MuPDF's contained-line
            # redaction otherwise leaves behind.
            background[0].clean_contents()
            content=background[0].read_contents()
            prefix,marker,figure=content.partition(b'/Figure')
            if not marker or b'/Figure' in figure or b' Do' in figure or b' S' not in figure:
                raise RuntimeError('Unexpected source vector advertisement reservation: '+name)
            background.update_stream(background[0].get_contents()[0],prefix)
        else:raise RuntimeError('Measured advertisement image not found: '+name)
        slots.append(dict(id='source-ad-'+spot['id'],role='ad',rect=list(rect),
                          asset=asset,previewAsset=preview,fit='contain',source=copy.deepcopy(spot)))
    return slots


def font(span):
    name=re.sub(r'^[A-Z]{6}\+','',span['font'])
    low=name.lower()
    bold=bool(span.get('flags',0)&16) or any(v in low for v in ['bold','black','heavy'])
    italic=bool(span.get('flags',0)&2) or any(v in low for v in ['italic','oblique'])
    style='Bold Italic' if bold and italic else 'Bold' if bold else 'Italic' if italic else 'Regular'
    if 'decalotype' in low:
        family='Decalotype';style='Black' if 'black' in low else 'Bold' if bold else 'Medium'
        portable=['Barlow','Black' if style=='Black' else 'ExtraBold' if bold else 'SemiBold']
    elif 'wordy' in low:family='Wordy Diva';style='Regular';portable=['Caveat Brush','Regular']
    elif 'salted' in low:family='Salted';style='Regular';portable=['Caveat Brush','Regular']
    elif 'kefa' in low:family='Kefa';portable=['Source Serif 4',style]
    elif 'minion' in low:family='Minion Pro';portable=['Source Serif 4',style]
    elif any(v in low for v in ['helvetica','arial']):family='Helvetica Neue';portable=['TeX Gyre Heros',style]
    elif 'times' in low:family='Times New Roman';portable=['Source Serif 4',style]
    else:
        family=name.split('-')[0]
        portable=['Source Serif 4' if span.get('flags',0)&4 else 'TeX Gyre Heros',style]
    return family,style,dict(fontFamily=portable[0],fontStyle=portable[1])


def native_text(page,palette):
    """One native region per source text line; keep mixed-style spans separate.

    The PDF has no reliable paragraph semantics. These are explicitly editable
    text regions, not inferred articles. Recoverable article stories use their
    dedicated recipes instead.
    """
    slots=[];redactions=[];source_count=0
    for bi,block in enumerate(page.get_text('dict')['blocks']):
        fields={};layout=[]
        for li,line in enumerate(block.get('lines',[])):
            # Overprinted PDF text can contain identical duplicate spans.
            spans=[];seen=set()
            for span in line['spans']:
                key=(span['text'],tuple(round(v,2) for v in span['bbox']))
                if key not in seen:spans.append(span);seen.add(key)
            if not spans:continue
            # Keep source glyph runs with the same style together for useful editing.
            runs=[]
            for span in spans:
                if not span['text'].strip() and not runs:continue
                key=(span['font'],round(span['size'],3),span['color'])
                if runs and runs[-1][0]==key:
                    runs[-1][1]['text']+=span['text'];runs[-1][1]['bbox']=list(fitz.Rect(runs[-1][1]['bbox'])|fitz.Rect(span['bbox']))
                else:runs.append((key,copy.deepcopy(span)))
            for ri,(_,span) in enumerate(runs):
                text=span['text'].replace('\u00ad','-')
                size=float(span['size'])
                if not text.strip() or not 4<=size<=144 or span.get('alpha',255)==0:continue
                box=fitz.Rect(span['bbox'])&page.rect
                if box.is_empty or box.width<1 or box.height<1:continue
                # Unsupported rotated decorative lettering remains original artwork.
                if abs(line.get('dir',(1,0))[1])>.03:continue
                # A source display heading crossing trim belongs to a spread.
                # Keep its original clipped glyphs in the artwork rather than
                # turning a partial PDF extraction into a shortened new title.
                if span['bbox'][0]<0 or span['bbox'][2]>page.rect.width-8:continue
                family,face,portable=font(span)
                measured=portable_width(text,size,portable)
                if measured>0:
                    # Keep the source point size and every character. Font
                    # substitutions need different horizontal metrics to match
                    # the PDF's explicit visual line; scope this to that font
                    # profile so private original faces keep their own metrics.
                    scale=max(.25,min(4,box.width/measured))
                    portable['chars']=dict(hScale=round(scale,6))
                color=span['color'];swatch=f'Source {color:06x}'
                palette[swatch]=dict(name=swatch,color=dict(model='rgb',r=((color>>16)&255)/255,g=((color>>8)&255)/255,b=(color&255)/255))
                field=f'line{li+1}run{ri+1}'
                fields[field]=text
                # A substitute's glyph metrics differ from the source. Retain
                # the point size and baseline spacing, with explicit frame room.
                x=max(0,box.x0-1);y=max(0,box.y0)
                right=min(756,box.x1+max(8,size*.9));bottom=min(792,y+max(box.height,size*1.6+2))
                if right-x<4 or bottom-y<4:continue
                style=dict(fontFamily=family,fontStyle=face,size=size,leading=size*1.05,portable=portable,chars=dict(fill=swatch),para=dict(hyphenate=False,spaceAfter=0))
                layout.append(dict(field=field,rect=[x/756,y/792,right/756,bottom/792],style=style))
                redactions.append(span['bbox']);source_count+=1
        # The compiler bounds editorial blocks to 32 field regions.
        for chunk in range(0,len(layout),32):
            parts=layout[chunk:chunk+32]
            if parts:slots.append(dict(id=f'source-text-{bi+1}-{chunk//32+1}',role='piece',blockType='source-text',rect=[0,0,756,792],fields={p['field']:fields[p['field']] for p in parts},contentLayout=parts))
    return slots,redactions,source_count


def retain_parts(slots,predicate):
    result=[]
    for slot in slots:
        parts=[p for p in slot['contentLayout'] if predicate(p)]
        if parts:result.append(dict(slot,fields={p['field']:slot['fields'][p['field']] for p in parts},contentLayout=parts))
    return result


def merge_president_bubbles(slots):
    """Reflow visual PDF lines as one source paragraph inside each speech bubble."""
    result=copy.deepcopy(slots)
    for name,band,rect in [('prompt',(545,620),[415,552,572,620]),('response',(620,715),[480,630,705,710])]:
        selected=[]
        for slot in result:
            for part in slot['contentLayout']:
                if band[0]<=part['rect'][1]*792<band[1] and part['rect'][0]*756>400:
                    selected.append((part['rect'][1],slot['fields'][part['field']],part['style']))
        if not selected:continue
        result=retain_parts(result,lambda p:not (band[0]<=p['rect'][1]*792<band[1] and p['rect'][0]*756>400))
        text=' '.join(item[1].strip() for item in sorted(selected))
        style=copy.deepcopy(selected[0][2]);style['para']['align']='center'
        result.append(dict(id='source-president-'+name,role='piece',blockType='source-text',rect=[0,0,756,792],fields={name:text},contentLayout=[dict(field=name,rect=[rect[0]/756,rect[1]/792,rect[2]/756,rect[3]/792],style=style)]))
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--issues',nargs='*');args=parser.parse_args()
    maps=json.loads((PUBLIC/'source-issue-maps.json').read_text())
    base=json.loads((PUBLIC/'templates.json').read_text())
    fixture=json.loads((ROOT/'tests/fixtures/designcraft-march-2025/issue.json').read_text())
    catalogue=dict(schemaVersion='ote.designcraft.source-issues.v1',issues=[],notes='Complete source issues including covers, ads, recurring sections, blank editorial pages and linked spreads. Artwork mode preserves the source; reconstruction mode rebuilds supported source text as native editable regions. Source content not supplied in a PDF is never invented.')
    for mapping in maps['issues']:
        iid=mapping['id']
        if args.issues and iid not in args.issues:continue
        document=fitz.open(PUBLIC/mapping['pdf'])
        assert hashlib.sha256((PUBLIC/mapping['pdf']).read_bytes()).hexdigest()==mapping['sourceSha256']
        directory=PUBLIC/'source-issues'/iid;directory.mkdir(parents=True,exist_ok=True)
        templates=[];pages=[];palette={};art_pages=[];edit_pages=[];articles=[];cover_settings={}
        spreads=[]
        for sid in dict.fromkeys(p.get('spreadId') for p in mapping['pages'] if p.get('spreadId')):
            spreads.append(dict(id=sid,pageNumbers=[p['pageNumber'] for p in mapping['pages'] if p.get('spreadId')==sid]))
        for mapped in mapping['pages']:
            n=mapped['pageNumber'];p=document[mapped['sourcePage']-1]
            stem=f'whole-{iid}-p{n:03d}'
            art_path='source-art/'+stem+'-art.pdf';preview='source-art/'+stem+'-art.png'
            save_page(document,mapped['sourcePage']-1,PUBLIC/art_path,PUBLIC/preview)
            src=dict(documentId=iid,pdf=mapping['pdf'],page=mapped['sourcePage'],label=mapped['label'],sha256=mapping['sourceSha256'],notes=mapped.get('notes',''))
            tid=stem+'-artwork';kind='cover' if n==1 else 'custom'
            original=dict(id=tid,name=f'{n:02d} · {mapped["label"]} · original artwork',kind=kind,sourceCover=n==1,storyCount=0,photoCount=0,source=src,slots=[dict(id='source-page-artwork',role='piece',rect=[0,0,756,792],asset=art_path,previewAsset=preview,fit='contain')])
            templates.append(original)
            native,redactions,count=native_text(p,palette)
            if n==1 and mapping['metadata']['design']=='ote-2025':
                # The source Helvetica Neue condensed font has a much taller
                # PDF ascender box than the bundled sans. Match the measured
                # glyph baseline of the three large cover page references,
                # rather than letting their digits touch the dashed rules.
                for slot in native:
                    for part in slot['contentLayout']:
                        if (part['style']['fontFamily']=='Helvetica Neue' and part['style']['size']>40
                                and part['rect'][1]*792>500 and re.fullmatch(r'\d{2}',slot['fields'][part['field']].strip())):
                            part['rect'][1]+=18.0791/792;part['rect'][3]+=18.0791/792
            if n==6 and mapping['metadata']['design']=='ote-2024':
                native=merge_president_bubbles(native)
                count=sum(len(s['fields']) for s in native)
            if iid=='issue-2-october-2025-0eb630f7' and n==4:
                # The semantic panel also rebuilds its rotated question. Remove
                # that source text operator as well, rather than leaving a
                # hidden second question beneath the replacement graphics.
                redactions += [span['bbox'] for block in p.get_text('dict')['blocks']
                               for line in block.get('lines',[]) for span in line['spans']
                               if 70<span['bbox'][1]<439]
            if mapped['role']=='blank':native=[];redactions=[];count=0
            bg=fitz.open();bg.insert_pdf(document,from_page=mapped['sourcePage']-1,to_page=mapped['sourcePage']-1)
            if redactions:
                for region in redactions:bg[0].add_redact_annot(region,fill=False,cross_out=False)
                bg[0].apply_redactions(images=0,graphics=0,text=0)
            advertisements=separate_advertisements(document,mapped['sourcePage']-1,bg,mapped.get('adSpots',[]),stem)
            if advertisements:
                native=retain_parts(native,lambda part:not any(fitz.Rect(spot['rect']).contains(
                    fitz.Point((part['rect'][0]+part['rect'][2])*378,(part['rect'][1]+part['rect'][3])*396)) for spot in mapped['adSpots']))
                count=sum(len(slot['fields']) for slot in native)
            source_overlays=[];photo=None
            if n==1:
                cover=next(t for t in base['templates'] if t['id']==mapping['metadata']['design']+'-cover')
                region=source_photo_rect(p,next(s['rect'] for s in cover['slots'] if s['id']=='cover-photo'))
                settings,source_overlays,primary=cover_photo(bg,0,region,stem)
                if settings:
                    cover_settings=settings
                    photo=dict(id='cover-photo',role='photo',rect=region,asset=settings['photoPath'],previewAsset=settings['photoPreviewPath'],fit=settings['fit'],focus=settings['focus'],zoom=settings['zoom'])
            bg_path='source-art/'+stem+'-background.pdf';bg_preview='source-art/'+stem+'-background.png'
            save_page(bg,0,PUBLIC/bg_path,PUBLIC/bg_preview)
            reconstructed=dict(id=stem+'-editable',name=f'{n:02d} · {mapped["label"]} · editable source text',kind=kind,sourceCover=n==1,storyCount=0,photoCount=0,design=mapping['metadata']['design'],source={**src,'notes':'Supported source text is rebuilt as native editable regions; original graphics and rotated lettering remain artwork. Measured advertisement frames are separate replaceable artwork.'},slots=[dict(id='source-page-graphics',role='piece',rect=[0,0,756,792],asset=bg_path,previewAsset=bg_preview,fit='contain')]+native+advertisements)
            if n==1:
                if photo:reconstructed['slots'].insert(1,photo);reconstructed['photoCount']=1
                reconstructed['slots']+=source_overlays
                if mapping['metadata']['design']=='ote-2025':reconstructed['overArt']='cover'
            aids=[]
            if iid in ['issue-7-march-2025-dfcbb959','issue-6-feb-2025-5ed75bab'] and n==6:
                # The source PDF wraps a single answer paragraph into two
                # visual lines. Keep the tested original IDML text frames so
                # substitute fonts can reflow the complete question/answer.
                known=copy.deepcopy(next(t for t in base['templates'] if t['id']=='source-2024-president-qa'))
                qa=next(s for s in known['slots'] if s.get('blockType')=='president-qa')
                header=[s for s in native if s['id']=='source-text-1-1']
                reconstructed['slots']=[reconstructed['slots'][0]]+header+[qa]
                count=4+sum(len(s.get('fields',{})) for s in header)
            if iid=='issue-2-october-2025-0eb630f7' and n==4:
                known=copy.deepcopy(next(t for t in base['templates'] if t['id']=='source-2025-president-qa'))
                qa=next(s for s in known['slots'] if s.get('blockType')=='president-qa')
                background=next(s for s in known['slots'] if s['id']=='president-background')
                remainder=retain_parts(native,lambda part:part['rect'][1]*792<65 or part['rect'][1]*792>=439)
                for slot in remainder:
                    for part in slot['contentLayout']:
                        if part['rect'][0]*756>540 and 536<=part['rect'][1]*792<=581:
                            part['rect'][1]+=3/792;part['rect'][3]+=3/792
                reconstructed['slots']=[reconstructed['slots'][0],background]+remainder+[qa]
                count=4+sum(len(s['fields']) for s in remainder)
            # Use the tested paragraph-level story recipe for the complete CFUR page.
            if iid=='issue-7-march-2025-dfcbb959' and n==13:
                known=copy.deepcopy(next(t for t in base['templates'] if t['id']=='source-2024-cfur-briefs'))
                known.update(id=reconstructed['id'],name=reconstructed['name'],source=reconstructed['source'])
                reconstructed=known;articles=copy.deepcopy(fixture['articles'][:4]);aids=[a['id'] for a in articles]
                # Original photos remain in the graphics; unused fixture uploads
                # do not become invented or unplaced issue media.
                for article in articles:article['photos']=[]
                count=8
            templates.append(reconstructed)
            page=dict(id=f'{iid}-page-{n}',pageNumber=n,sourcePage=mapped['sourcePage'],sourceRegion=mapped['sourceRegion'],role=mapped['role'],label=mapped['label'])
            if mapped.get('spreadId'):page['spreadId']=mapped['spreadId']
            art_pages.append(dict(page,templateId=tid,articleIds=[],sourceMode='blank' if mapped['role']=='blank' else 'artwork'))
            edit_pages.append(dict(page,templateId=reconstructed['id'],articleIds=aids,sourceMode='editable' if count else 'blank' if mapped['role']=='blank' else 'artwork'))
            pages.append(dict(page,label=mapped['label'],artworkTemplateId=tid,editableTemplateId=reconstructed['id'],articleIds=aids,editableRegions=count,section=mapped.get('section'),adSpots=copy.deepcopy(mapped.get('adSpots',[]))))
        library=copy.deepcopy(base);library['templates']=templates
        for design in library['designs'].values():design['swatches']+=[c for name,c in palette.items() if name not in {s['name'] for s in design['swatches']}]
        write_json(directory/'templates.json',library)
        info=dict(id=iid,title='Over the Edge',**{k:v for k,v in mapping['metadata'].items() if k!='design' and v is not None})
        source_info=dict(documentId=iid,pageCount=len(pages),spreads=spreads,sourceSha256=mapping['sourceSha256'],sourceMetadata=mapping['metadata'])
        modes={}
        for mode,plan,copy_articles in [('artwork',art_pages,[]),('reconstruction',edit_pages,articles)]:
            cover=dict(mode='editable',articleIds=[],**(cover_settings if mode=='reconstruction' else {}))
            issue=dict(schemaVersion='ote.designcraft.issue.v1',issue=info,sourceIssue=dict(source_info,mode=mode),articles=copy_articles,layoutPlan=dict(pages=plan,cover=cover,truck=dict(mode='editable',pageIds=[])))
            write_json(directory/(mode+'-issue.json'),issue)
            modes[mode]=dict(issue=f'source-issues/{iid}/{mode}-issue.json',library=f'source-issues/{iid}/templates.json')
        used={s[key] for t in templates for s in t['slots'] for key in ['asset','previewAsset'] if s.get(key)}
        for generated in ART.glob('whole-'+iid+'-*'):
            if str(generated.relative_to(PUBLIC)) not in used:generated.unlink()
        catalogue['issues'].append(dict(id=iid,label=mapping['label'],documentId=iid,pdf=mapping['pdf'],readingPdf=mapping.get('readingPdf',mapping['pdf']),sourceSha256=mapping['sourceSha256'],pageCount=len(pages),metadata=mapping['metadata'],spreads=spreads,pages=pages,modes=modes))
        print(iid,len(pages),'pages',sum(p['editableRegions'] for p in pages),'native text regions',flush=True)
    write_json(PUBLIC/'source-issues.json',catalogue)


if __name__=='__main__':main()
