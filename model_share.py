"""A-layout model share card. Local data only; rendering never fetches URLs."""
import io, re, sys
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode

class PlainText(HTMLParser):
    def __init__(self):super().__init__();self.parts=[];self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'):self.skip+=1
        if tag in ('p','br','div','li'):self.parts.append(' ')
    def handle_endtag(self,tag):
        if tag in ('script','style') and self.skip:self.skip-=1
        if tag in ('p','div','li'):self.parts.append(' ')
    def handle_data(self,data):
        if not self.skip:self.parts.append(data)

def plain(value,limit=600):
    parser=PlainText();parser.feed(str(value or '')[:20000]);return re.sub(r'\s+',' ',' '.join(parser.parts)).strip()[:limit]

def model_url(detail):
    info=detail.get('info') or {};url=info.get('url') or '';mid=info.get('modelId') or info.get('id')
    if str(mid or '').isdigit():return 'https://civitai.com/models/'+str(mid)
    parts=urlsplit(str(url))
    return str(url) if parts.scheme=='https' and parts.hostname in ('civitai.com','civitai.red','www.civitai.com') and re.match(r'^/models/\d+',parts.path) else ''

def render(detail,cover=None,theme='dark',labels=None,previews=None):
    labels=labels or {};info=detail.get('info') or {};version=info.get('version') or {};version=version if isinstance(version,dict) else {'name':str(version)}
    creator=info.get('creator') or '';creator=creator.get('username','') if isinstance(creator,dict) else str(creator)
    bg,fg,muted=('#eef0e8','#252e29','#536052') if theme=='light' else ('#242a29','#eff1e8','#b4bfb3')
    image=Image.new('RGB',(1200,600),bg);d=ImageDraw.Draw(image)
    base=Path(getattr(sys,'_MEIPASS',Path(__file__).resolve().parent))/'web/fonts'
    def font(size,bold=False):return ImageFont.truetype(str(base/('HarmonyOS_Sans_SC_Bold.ttf' if bold else 'HarmonyOS_Sans_SC_Regular.ttf')),size)
    def block(text,x,y,width,size,rows,color,bold=False):
        f=font(size,bold);lines=[];line=''
        for c in str(text):
            if d.textlength(line+c,font=f)>width and line:lines.append(line);line=c
            else:line+=c
        if line:lines.append(line)
        clipped=len(lines)>rows;lines=lines[:rows]
        if clipped:
            last=lines[-1]
            while last and d.textlength(last+'…',font=f)>width:last=last[:-1]
            lines[-1]=last+'…'
        for line in lines:d.text((x,y),line,font=f,fill=color);y+=int(size*1.45)
        return y
    # Constant-opacity contours, not a gradient; only the information panel is textured.
    texture=Image.open(base.parent/'model-share-contours.png').convert('RGBA')
    texture.putalpha(texture.getchannel('A').point(lambda a:round(a*.13)))
    if theme!='light':
        alpha=texture.getchannel('A');texture=ImageOps.invert(texture.convert('RGB')).convert('RGBA');texture.putalpha(alpha)
    image.paste(texture,(400,0),texture)
    if cover:
        with Image.open(io.BytesIO(cover)) as src:
            src=ImageOps.exif_transpose(src).convert('RGB');image.paste(ImageOps.fit(src,(400,596)),(0,4))
    else:
        d.rectangle((0,4,399,599),fill='#637b75');d.polygon([(0,600),(150,180),(400,600)],fill='#334d46')
    for a,b,c in [(0,600,'#ffef01'),(600,900,'#00d0fd'),(900,1200,'#f954fd')]:d.rectangle((a,0,b,3),fill=c)
    d.text((438,30),'CFT / MODEL SHARE',font=font(15),fill=muted)
    title=plain(info.get('name') or detail.get('name'),250)
    title_end=block(title,438,70,710,36,2,fg,True)
    author_end=block(creator,438,title_end+8,710,20,1,muted)
    tag_y=author_end+12
    tags=[info.get('baseModel') or version.get('baseModel'),info.get('type'),version.get('name')]
    x=438
    for i,tag in enumerate(filter(None,tags)):
        tag=plain(tag,32);f=font(17);w=min(220,int(d.textlength(tag,font=f))+26)
        if x+w>1150:break
        d.rectangle((x,tag_y,x+w,tag_y+35),fill='#ffef01' if i==0 else bg,outline='#8c957f');block(tag,x+12,tag_y+5,w-24,17,1,'#283024' if i==0 else fg);x+=w+10
    description=plain(info.get('description'))
    desc_y=tag_y+55
    end=block(description or labels.get('noDescription','—'),438,desc_y,710,28,max(1,(452-desc_y)//40),fg)
    # A short description may leave room for real additional gallery previews.
    thumb_y=end+18;available=466-thumb_y
    if available>=72:
        x=438;seen=set()
        for data in (previews or [])[:5]:
            if not data or data in seen:continue
            seen.add(data)
            try:
                with Image.open(io.BytesIO(data)) as src:
                    h=min(128,available);w=85
                    thumb=ImageOps.fit(ImageOps.exif_transpose(src).convert('RGB'),(w,h))
                    image.paste(thumb,(x,thumb_y));x+=107
            except (OSError,ValueError):continue
    url=model_url(detail)
    logo=Image.open(base.parent/'model-share-wordmark.png').convert('RGBA')
    if theme!='light':
        alpha=logo.getchannel('A');logo=ImageOps.invert(logo.convert('RGB')).convert('RGBA');logo.putalpha(alpha)
    logo.thumbnail((300,91),Image.Resampling.LANCZOS)
    image.paste(logo,(730 if url else 860,488),logo)
    block(url or labels.get('noLink','—'),438,550,280 if url else 410,16,2,muted)
    if url:
        qr=qrcode.QRCode(box_size=4,border=4,error_correction=qrcode.constants.ERROR_CORRECT_M);qr.add_data(url);qr.make(fit=True)
        matrix=qr.get_matrix();scale=max(1,132//len(matrix));size=len(matrix)*scale;left=1160-size;top=580-size
        d.rectangle((left,top,left+size,top+size),fill='white')
        for row,values in enumerate(matrix):
            for col,on in enumerate(values):
                if on:d.rectangle((left+col*scale,top+row*scale,left+(col+1)*scale-1,top+(row+1)*scale-1),fill='black')
    out=io.BytesIO();image.save(out,'PNG');return out.getvalue()
