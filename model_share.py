"""A-layout model share card. Local data only; rendering never fetches URLs."""
import io, re, sys, os, unicodedata
from functools import lru_cache
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode

class PlainText(HTMLParser):
    def __init__(self,paragraphs=False):super().__init__();self.parts=[];self.skip=0;self.separator='\n' if paragraphs else ' '
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'):self.skip+=1
        if tag in ('p','br','div','li'):self.parts.append(self.separator)
    def handle_endtag(self,tag):
        if tag in ('script','style') and self.skip:self.skip-=1
        if tag in ('p','div','li'):self.parts.append(self.separator)
    def handle_data(self,data):
        if not self.skip:self.parts.append(data)

def plain(value,limit=600,paragraphs=False):
    parser=PlainText(paragraphs);parser.feed(str(value or '')[:20000]);text=''.join(parser.parts) if paragraphs else ' '.join(parser.parts);return ('\n'.join(re.sub(r'[ \t]+',' ',line).strip() for line in text.splitlines()) if paragraphs else re.sub(r'\s+',' ',text)).strip()[:limit]

def model_url(detail):
    info=detail.get('info') or {};url=info.get('url') or '';mid=info.get('modelId') or info.get('id')
    if str(mid or '').isdigit():return 'https://civitai.com/models/'+str(mid)
    parts=urlsplit(str(url))
    return str(url) if parts.scheme=='https' and parts.hostname in ('civitai.com','civitai.red','www.civitai.com') and re.match(r'^/models/\d+',parts.path) else ''

def text_clusters(value):
    """Keep emoji modifiers, keycaps, flags and ZWJ sequences together when wrapping."""
    clusters=[]
    for char in str(value):
        code=ord(char)
        attach=(unicodedata.combining(char) or code in (0xfe0e,0xfe0f,0x20e3,0x200d)
                or 0x1f3fb<=code<=0x1f3ff or 0xe0020<=code<=0xe007f)
        if clusters and (attach or clusters[-1].endswith('\u200d') or
                         0x1f1e6<=code<=0x1f1ff and len(clusters[-1])==1 and 0x1f1e6<=ord(clusters[-1])<=0x1f1ff):
            clusters[-1]+=char
        else:clusters.append(char)
    return clusters


def text_family(cluster):
    code=ord(cluster[0])
    if any(0x1f000<=ord(c)<=0x1faff or 0x2600<=ord(c)<=0x27bf or ord(c) in (0xfe0f,0x20e3) for c in cluster):return 'emoji'
    if '0'<=cluster[0]<='9' or 0xff10<=code<=0xff19:return 'digits'
    if 'A'<=cluster[0]<='Z' or 'a'<=cluster[0]<='z' or 0x00c0<=code<=0x024f or 0x1e00<=code<=0x1eff:return 'line'
    return 'latin' if code<=0x024f else 'han'


@lru_cache(maxsize=1)
def installed_font_files():
    """Read Windows font registrations only; do not install or bundle system fonts."""
    found={}
    if sys.platform!='win32':return found
    import winreg
    for hive in (winreg.HKEY_LOCAL_MACHINE,winreg.HKEY_CURRENT_USER):
        try:
            with winreg.OpenKey(hive,r'SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts') as key:
                for index in range(winreg.QueryInfoKey(key)[1]):
                    name,value,_=winreg.EnumValue(key,index)
                    if not isinstance(value,str):continue
                    path=Path(value)
                    if not path.is_absolute():path=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts'/path
                    if path.is_file():found[re.sub(r'\s*\([^)]*\)\s*$','',name).casefold()]=str(path)
        except OSError:continue
    return found


def custom_font_file(names,bold=False):
    fonts=installed_font_files()
    for name in names:
        if not isinstance(name,str):continue
        name=name.strip().casefold()
        for candidate in ([name+' bold',name] if bold else [name,name+' regular',name+' medium']):
            if candidate in fonts:return fonts[candidate]
    return None


def wrap_text(value,width,measure):
    """Prefer word/paragraph boundaries; split only a token wider than one whole line."""
    lines=[]
    for paragraph in str(value).splitlines() or ['']:
        line=''
        for token in re.findall(r'\S+|[ \t]+',paragraph):
            if token.isspace():
                if line:line+=' '
                continue
            if line and measure(line+token)>width:lines.append(line.rstrip());line=''
            if measure(token)<=width:line+=token;continue
            for cluster in text_clusters(token):
                if line and measure(line+cluster)>width:lines.append(line.rstrip());line=''
                line+=cluster
        if line.strip():lines.append(line.rstrip())
    return lines or ['']


def render(detail,cover=None,theme='dark',labels=None,previews=None,font_config=None):
    labels=labels or {};info=detail.get('info') or {};version=info.get('version') or {};version=version if isinstance(version,dict) else {'name':str(version)}
    creator=info.get('creator') or '';creator=creator.get('username','') if isinstance(creator,dict) else str(creator)
    bg,fg,muted=('#eef0e8','#252e29','#536052') if theme=='light' else ('#242a29','#eff1e8','#b4bfb3')
    image=Image.new('RGB',(1200,600),bg);d=ImageDraw.Draw(image)
    base=Path(getattr(sys,'_MEIPASS',Path(__file__).resolve().parent))/'web/fonts'
    font_cache={};font_config=font_config or {}
    def runs(value):
        result=[]
        for cluster in text_clusters(value):
            family=text_family(cluster)
            if result and result[-1][0]==family:result[-1]=(family,result[-1][1]+cluster)
            else:result.append((family,cluster))
        return result
    def font(size,bold=False,family='han'):
        key=(size,bold,family)
        if key not in font_cache:
            # Defaults follow the UI; caller-provided font routing still takes priority.
            filename='LINESeedSans_Bd.otf' if family in ('line','latin','digits') else 'HarmonyOS_Sans_SC_Bold.ttf'
            scope={'line':'latin','latin':'latin','digits':'digits','han':'zhHans'}.get(family)
            scripts=font_config.get('ui_font_scripts') or {}
            stack=font_config.get('ui_font_stack')
            if not isinstance(stack,list):stack=[font_config.get('ui_font','')]
            names=scripts.get(scope,[]) if isinstance(scripts,dict) else []
            path=custom_font_file((names if isinstance(names,list) else [])+stack,bold) if family!='emoji' else None
            if family=='emoji':
                emoji=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts'/'seguiemj.ttf'
                if emoji.is_file():path=str(emoji)
            font_cache[key]=ImageFont.truetype(path or str(base/filename),size)
        return font_cache[key]
    def measure(text,size,bold=False):return sum(d.textlength(t,font=font(size,bold,f)) for f,t in runs(text))
    def bounds(text,size,bold=False):
        boxes=[font(size,bold,f).getbbox(t,anchor='ls') for f,t in runs(text)]
        return (min((b[1] for b in boxes),default=-size),max((b[3] for b in boxes),default=0))
    def text(text,x,baseline,size,color,bold=False):
        for family,part in runs(text):
            f=font(size,bold,family);d.text((x,baseline),part,font=f,fill=color,anchor='ls',embedded_color=family=='emoji');x+=d.textlength(part,font=f)
    def clip(text,width,size,bold=False):
        value=str(text)
        if measure(value,size,bold)<=width:return value
        clusters=text_clusters(value);lo=0;hi=len(clusters)
        while lo<hi:
            mid=(lo+hi+1)//2
            if measure(''.join(clusters[:mid])+'…',size,bold)<=width:lo=mid
            else:hi=mid-1
        return ''.join(clusters[:lo])+'…'
    def block(value,x,y,width,size,rows,color,bold=False):
        lines=wrap_text(value,width,lambda part:measure(part,size,bold))
        clipped=len(lines)>rows;lines=lines[:rows]
        if clipped:lines[-1]=clip(lines[-1]+'…',width,size,bold)
        for line in lines:text(line,x,y+size,size,color,bold);y+=int(size*1.4)
        return y
    # Constant-opacity contours, not a gradient; only the information panel is textured.
    texture=Image.open(base.parent/'model-share-contours.png').convert('RGBA')
    texture.putalpha(texture.getchannel('A').point(lambda a:round(a*.13)))
    if theme!='light':
        alpha=texture.getchannel('A');texture=ImageOps.invert(texture.convert('RGB')).convert('RGBA');texture.putalpha(alpha)
    image.paste(texture,(400,0),texture)
    if cover:
        with Image.open(io.BytesIO(cover)) as src:
            src.draft('RGB',(800,1200));src=ImageOps.exif_transpose(src).convert('RGB');image.paste(ImageOps.fit(src,(400,596)),(0,4))
    else:
        d.rectangle((0,4,399,599),fill='#637b75');d.polygon([(0,600),(150,180),(400,600)],fill='#334d46')
    for a,b,c in [(0,600,'#ffef01'),(600,900,'#00d0fd'),(900,1200,'#f954fd')]:d.rectangle((a,0,b,3),fill=c)
    text('CFT / MODEL SHARE',438,45,15,muted)
    title=plain(info.get('name') or detail.get('name'),250)
    title_end=block(title,438,70,710,36,2,fg,True)
    author_end=block(creator,438,title_end+8,710,20,1,muted)
    tag_y=author_end+12
    tags=[info.get('baseModel') or version.get('baseModel'),info.get('type'),version.get('name')]
    x=438
    for i,tag in enumerate(filter(None,tags)):
        tag=plain(tag,32);w=min(220,int(measure(tag,17))+26)
        if x+w>1150:break
        d.rectangle((x,tag_y,x+w,tag_y+35),fill='#ffef01' if i==0 else bg,outline='#8c957f');caption=clip(tag,w-24,17);top,bottom=bounds(caption,17);text(caption,x+12,tag_y+17.5-(top+bottom)/2,17,'#283024' if i==0 else fg);x+=w+10
    description=plain(info.get('description'),paragraphs=True)
    desc_y=tag_y+55
    has_previews=bool(previews)
    desc_bottom=430 if has_previews else 452
    end=block(description or labels.get('noDescription','—'),438,desc_y,710,24,max(1,(desc_bottom-desc_y)//34),fg)
    # Dedicated lower-left gallery strip, even for a long description. Never cover the logo/URL.
    x=438;seen=set();preview_count=0
    for data in (previews or [])[:4]:
        if not data or data in seen:continue
        seen.add(data)
        try:
            with Image.open(io.BytesIO(data)) as src:
                thumb=ImageOps.fit(ImageOps.exif_transpose(src).convert('RGB'),(56,84))
                image.paste(thumb,(x,496));x+=66;preview_count+=1
        except (OSError,ValueError):continue
    url=model_url(detail)
    logo=Image.open(base.parent/'model-share-wordmark.png').convert('RGBA')
    if theme!='light':
        alpha=logo.getchannel('A');logo=ImageOps.invert(logo.convert('RGB')).convert('RGBA');logo.putalpha(alpha)
    logo.thumbnail((300,91),Image.Resampling.LANCZOS)
    image.paste(logo,(730 if url else 860,488),logo)
    link=clip(url or labels.get('noLink','—'),(570 if preview_count else 280) if url else 710,16);text(link,438,(480 if preview_count else 580)-bounds(link,16)[1],16,muted)
    if url:
        qr=qrcode.QRCode(box_size=4,border=4,error_correction=qrcode.constants.ERROR_CORRECT_M);qr.add_data(url);qr.make(fit=True)
        matrix=qr.get_matrix();scale=max(1,132//len(matrix));size=len(matrix)*scale;left=1160-size;top=580-size
        caption=labels.get('downloadModel','下载该模型');caption=clip(caption,size+12,12);text(caption,left+(size-measure(caption,12))/2,top-10,12,muted)
        d.rectangle((left,top,left+size,top+size),fill='white')
        for row,values in enumerate(matrix):
            for col,on in enumerate(values):
                if on:d.rectangle((left+col*scale,top+row*scale,left+(col+1)*scale-1,top+(row+1)*scale-1),fill='black')
    out=io.BytesIO();image.save(out,'PNG');return out.getvalue()
