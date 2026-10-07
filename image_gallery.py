"""图片预览/生成数据：只解析来源已提供的信息，不推测缺失提示词或使用资源。"""
import io
import json
import re
from urllib.parse import urlsplit

LIMIT = 25 * 1024 * 1024

def generation(image=None, local_path=None):
    image = image if isinstance(image, dict) else {}
    meta = dict(image.get('meta') or {}) if isinstance(image.get('meta'), dict) else {}
    source = 'C站模型信息缓存' if meta else '未提供生成数据'
    if local_path:
        try:
            from PIL import Image
            with Image.open(local_path) as im: saved = dict(im.info)
            parameters = saved.get('parameters')
            if isinstance(parameters, str) and parameters.strip():
                parts = re.split(r'\n(?=Steps:\s*\d)', parameters, maxsplit=1)
                positive, _, negative = parts[0].partition('\nNegative prompt:')
                meta = {'prompt': positive.strip(), 'negativePrompt': negative.strip()}
                if len(parts)>1:
                    for key,value in re.findall(r'(?:^|,\s*)([^:,]+):\s*([^,]+)',parts[1]):meta[key.strip()]=value.strip()
                source='本地图片 PNG parameters'
            elif saved.get('prompt') or saved.get('workflow'):
                meta = {}
                for key in ('prompt','workflow'):
                    value=saved.get(key)
                    if value:
                        try:value=json.loads(value) if isinstance(value,str) else value
                        except (ValueError,TypeError):pass
                        meta['comfyPrompt' if key=='prompt' and isinstance(value,dict) else key]=value
                source='本地图片 ComfyUI 元数据'
        except Exception:pass
    resources = image.get('resources') or meta.get('resources') or meta.get('civitaiResources') or []
    if not isinstance(resources,list):resources=[]
    return {'meta':meta,'resources':[r for r in resources if isinstance(r,dict)],'metadata_source':source,
            'image_id':image.get('id'),'width':image.get('width'),'height':image.get('height'),
            'orig_url':image.get('url') or '', 'image_page':('https://civitai.com/images/'+str(image['id'])) if str(image.get('id','')).isdigit() else ''}

def original_url(url):
    parsed=urlsplit(str(url or ''))
    if parsed.scheme != 'https' or parsed.hostname != 'image.civitai.com' or parsed.username or parsed.password:
        raise ValueError('仅支持 C站官方图片 CDN 的 HTTPS 地址')
    return re.sub(r'/(?:width=[^/]+|original=true[^/]*)/', '/original=true/',url)

def read_bytes(item, cfg):
    if item.get('local_path'):
        with open(item['local_path'],'rb') as f:data=f.read(LIMIT+1)
        original=True
    elif item.get('url'):
        import urllib.request
        import civitai_api
        proxy=cfg.get('proxy_address') if cfg.get('proxy_enabled') else None
        opener=civitai_api.build_opener(proxy,verify=cfg.get('ssl_verify',True))
        req=urllib.request.Request(original_url(item['url']),headers={'User-Agent':'Mozilla/5.0','Referer':'https://civitai.com/'})
        with opener.open(req,timeout=25) as r:data=r.read(LIMIT+1)
        original=True
    elif item.get('b64'):
        import base64
        data=base64.b64decode(item['b64'],validate=True);original=False
    else:raise ValueError('没有可查看的图片来源')
    if len(data)>LIMIT:raise ValueError('图片超过 25 MB，建议在 C站原图页查看')
    from PIL import Image
    with Image.open(io.BytesIO(data)) as im:
        if im.format not in ('PNG','JPEG','WEBP','GIF'):raise ValueError('不支持的图片格式')
        width,height=im.size;fmt=im.format
        im.verify()
    return data,fmt,width,height,original

def preview(item,cfg):
    from PIL import Image
    import base64
    data,fmt,w,h,original=read_bytes(item,cfg)
    with Image.open(io.BytesIO(data)) as im:
        im=im.convert('RGBA' if 'A' in im.getbands() else 'RGB');im.thumbnail((4096,4096))
        buf=io.BytesIO();im.save(buf,'PNG' if im.mode=='RGBA' else 'JPEG',**({} if im.mode=='RGBA' else {'quality':94}))
        mime='image/png' if im.mode=='RGBA' else 'image/jpeg'
    return {'ok':True,'b64':base64.b64encode(buf.getvalue()).decode(),'mime':mime,'width':w,'height':h,
            'original_available':original,'preview_limited':max(w,h)>4096}
