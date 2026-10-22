#!/usr/bin/env python3
"""Extract the March CFUR page artwork and measured editable text/wrap geometry.

PDF artwork stays vector. Only the four headlines and four article bodies are
removed. The sponsor, QR code, torn photos and folio stay in their source form.
Story frames and transformed wrap contours come from the paired source IDML.
"""
import os
import fitz,json,zipfile,xml.etree.ElementTree as E
from pathlib import Path
os.chdir(Path(__file__).resolve().parents[2])
out=Path('public/designcraft/source-art');out.mkdir(exist_ok=True)
src=Path('public/designcraft/originals/issue-7-march-2025-dfcbb959.pdf')
d=fitz.open(src);p=d[12]
for b in p.get_text('dict')['blocks']:
 if 'lines' not in b:continue
 for l in b['lines']:
  for s in l['spans']:
   x,y,x1,y1=s['bbox']
   if x>=529 and y>=640 or x>=700 and y<=60:continue
   p.add_redact_annot(s['bbox'],fill=False,cross_out=False)
p.apply_redactions(images=0,graphics=0,text=0)
crop=fitz.open();page=crop.new_page(width=756,height=792);page.show_pdf_page(page.rect,d,12)
crop.save(out/'march-cfur-background.pdf',garbage=4,deflate=True)
print('kept text:',page.get_text())
z=zipfile.ZipFile('public/designcraft/source-idml/issue-7-march-2025-da7e3ca1.idml');r=E.fromstring(z.read('Spreads/Spread_u766.xml'))
def mul(t,u):
 a,b,c,d,e,f=t;g,h,i,j,k,l=u;return [a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f]
def tx(t,p):a,b,c,d,e,f=t;x,y=p;return [a*x+c*y+e,b*x+d*y+f]
def anchors(o):return [list(map(float,p.get('Anchor').split())) for p in o.findall('./Properties/PathGeometry/GeometryPathType/PathPointArray/PathPointType')]
def allpts(o,t=[1,0,0,1,0,0]):
 pts=[tx(t,p) for p in anchors(o)]
 for c in o:
  if c.tag in ['Group','Polygon','Rectangle','Oval','GraphicLine']:pts.extend(allpts(c,mul(t,list(map(float,c.get('ItemTransform','1 0 0 1 0 0').split())))))
 return pts

def hull(points):
 pts=sorted(set(tuple(p) for p in points))
 if len(pts)<=1:return pts
 def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
 low=[];up=[]
 for p in pts:
  while len(low)>=2 and cross(low[-2],low[-1],p)<=0:low.pop()
  low.append(p)
 for p in reversed(pts):
  while len(up)>=2 and cross(up[-2],up[-1],p)<=0:up.pop()
  up.append(p)
 return [list(p) for p in low[:-1]+up[:-1]]
wraps=[]
def walk(o,t=[1,0,0,1,0,0]):
 if o.tag!='Spread':t=mul(t,list(map(float,o.get('ItemTransform','1 0 0 1 0 0').split())))
 p=o.find('TextWrapPreference')
 points=anchors(o)
 if p is not None and p.get('TextWrapMode')!='None' and o.tag in ['Group','Polygon']:
  mode=p.get('TextWrapMode');off=p.find('./Properties/TextWrapOffset');offset=[float(off.get(k,0)) for k in ['Top','Left','Bottom','Right']]
  if o.tag=='Group':
   pts=allpts(o)
   if mode=='BoundingBoxTextWrap':
    xs=[v[0] for v in pts];ys=[v[1] for v in pts];a,b,c,d=min(xs),min(ys),max(xs),max(ys);points=[[a,b],[c,b],[c,d],[a,d]]
   else:points=hull(pts)
  points=[[x,y+396] for x,y in [tx(t,p) for p in points]]
  if points and max(p[0] for p in points)>0 and min(p[0] for p in points)<756 and max(p[1] for p in points)>0 and min(p[1] for p in points)<792:
   wraps.append({'id':'source-wrap-'+o.get('Self'),'role':'wrap','points':points,'offset':offset,'sourceMode':mode,'mode':'contour','sourceShape':o.get('Self')})
 for c in o:
  if c.tag in ['Spread','Group','Polygon','Rectangle','Oval','GraphicLine']:walk(c,t)
walk(r)
stories={'u80d':(0,'headline'),'u88c':(0,'body'),'u911':(1,'headline'),'u8a2':(1,'body'),
         'u8e4':(2,'headline'),'u876':(2,'body'),'u927':(3,'headline'),'u8b8':(3,'body')}
frames=[]
for frame in r.iter('TextFrame'):
 story=frame.get('ParentStory')
 if story not in stories:continue
 transform=list(map(float,frame.get('ItemTransform').split()))
 points=[tx(transform,p) for p in anchors(frame)]
 rect=[min(p[0] for p in points),min(p[1] for p in points)+396,
       max(p[0] for p in points),max(p[1] for p in points)+396]
 article_index,role=stories[story]
 text=E.fromstring(z.read('Stories/Story_'+story+'.xml'))
 frames.append(dict(articleIndex=article_index,role=role,rect=rect,
                    sourceStory=story,sourceFrame=frame.get('Self'),
                    sourceCharAttrs=[v.attrib for v in text.iter('CharacterStyleRange')],
                    fontFamilies=[v.text for v in text.iter('AppliedFont')]))
(out/'march-cfur-source.json').write_text(json.dumps({'source':str(src),'page':13,'background':'source-art/march-cfur-background.pdf','frames':frames,'wraps':wraps},indent=2)+'\n')
print('wraps',json.dumps(wraps,indent=2))
