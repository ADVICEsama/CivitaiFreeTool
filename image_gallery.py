"""图片预览/生成数据：只解析来源已提供的信息，不推测缺失提示词或使用资源。"""
import io
import json
import re
from urllib.parse import urlsplit

LIMIT = 25 * 1024 * 1024

def comfy_generation(graph):
    """只读解析标准 ComfyUI API 图中实际连接的节点，不执行或猜测未知节点。"""
    if not isinstance(graph,dict) or len(graph)>10000:return {}
    sampler=next((n for n in graph.values() if isinstance(n,dict) and n.get('class_type') in ('KSampler','KSamplerAdvanced')),None)
    if not sampler:return {}
    inputs=sampler.get('inputs') or {}
    if not isinstance(inputs,dict):return {}
    def nodes(reference):
        seen=set();pending=[reference];out=[]
        while pending and len(seen)<256:
            value=pending.pop()
            if not isinstance(value,list) or len(value)<2 or str(value[0]) not in graph:continue
            key=str(value[0])
            if key in seen:continue
            seen.add(key);node=graph[key]
            if not isinstance(node,dict):continue
            out.append(node);values=node.get('inputs') or {}
            if isinstance(values,dict):pending.extend(v for v in values.values() if isinstance(v,list))
        return out
    result={}
    for side,label in [('positive','prompt'),('negative','negativePrompt')]:
        texts=[]
        for node in nodes(inputs.get(side)):
            if not str(node.get('class_type','')).startswith('CLIPTextEncode'):continue
            values=node.get('inputs') or {}
            for field in ('text','text_g','text_l'):
                text=values.get(field)
                if isinstance(text,str) and text and text not in texts:texts.append(text)
        if texts:result[label]='\n'.join(texts)
    for key in ('seed','noise_seed','steps','cfg','sampler_name','scheduler','denoise'):
        value=inputs.get(key)
        if isinstance(value,(str,int,float)) and not isinstance(value,bool):result[{'cfg':'cfgScale','sampler_name':'sampler','noise_seed':'seed'}.get(key,key)]=value
    for node in nodes(inputs.get('latent_image')):
        values=node.get('inputs') or {}
        for key in ('width','height'):
            if isinstance(values.get(key),(int,float)):result.setdefault(key,values[key])
    resources=[]
    for node in nodes(inputs.get('model')):
        values=node.get('inputs') or {}
        for field,kind in [('ckpt_name','CHECKPOINT'),('lora_name','LORA'),('unet_name','DIFFUSION_MODEL')]:
            name=values.get(field)
            if isinstance(name,str) and name:
                resource={'name':name.replace('\\','/').split('/')[-1],'type':kind}
                if resource not in resources:resources.append(resource)
    if resources:result['resources']=resources
    return result


def generation(image=None, local_path=None, saved=None):
    image=image if isinstance(image,dict) else {}
    meta=dict(image.get('meta') or {}) if isinstance(image.get('meta'),dict) else {}
    source=image.get('metadata_source') or ('C站模型信息缓存' if meta else '未提供生成数据')
    data=saved if isinstance(saved,dict) else {}
    if local_path and saved is None:
        try:
            from PIL import Image
            with Image.open(local_path) as im:data=dict(im.info)
        except Exception:pass
    parameters=data.get('parameters')
    if isinstance(parameters,str) and parameters.strip():
        parts=re.split(r'\n(?=Steps:\s*\d)',parameters,maxsplit=1)
        positive,_,negative=parts[0].partition('\nNegative prompt:')
        meta.update({'prompt':positive.strip(),'negativePrompt':negative.strip()})
        if len(parts)>1:
            for key,value in re.findall(r'(?:^|,\s*)([^:,]+):\s*([^,]+)',parts[1]):meta[key.strip()]=value.strip()
        source='原图内嵌 PNG parameters' if saved is not None else '本地图片 PNG parameters'
    elif data.get('prompt') or data.get('workflow'):
        for key in ('prompt','workflow'):
            value=data.get(key)
            if value:
                try:value=json.loads(value,parse_constant=lambda _:None) if isinstance(value,str) else value
                except (ValueError,TypeError):pass
                meta['comfyPrompt' if key=='prompt' and isinstance(value,dict) else key]=value
        source='原图内嵌 ComfyUI 元数据' if saved is not None else '本地图片 ComfyUI 元数据'
    else:
        comment=data.get('UserComment') or data.get('comment')
        if isinstance(comment,bytes):comment=comment.removeprefix(b'ASCII\0\0\0').decode('utf-8',errors='replace')
        if isinstance(comment,str):
            try:
                fields=json.loads(comment,parse_constant=lambda _:None)
                if isinstance(fields,dict):meta.update(fields);source='原图内嵌 EXIF/Comment 元数据'
            except (ValueError,TypeError):pass
    if isinstance(meta.get('comfyPrompt'),dict):
        for key,value in comfy_generation(meta['comfyPrompt']).items():meta.setdefault(key,value)
    resources=image.get('resources') or meta.get('resources') or meta.get('civitaiResources') or []
    if not isinstance(resources,list):resources=[]
    return {'meta':meta,'resources':[v for v in resources if isinstance(v,dict)],'metadata_source':source,
            'image_id':image.get('id') or image.get('image_id'),'width':image.get('width'),'height':image.get('height'),
            'orig_url':image.get('url') or image.get('orig_url') or '',
            'image_page':image.get('image_page') or ('https://civitai.com/images/'+str(image['id']) if str(image.get('id','')).isdigit() else '')}


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
        saved=dict(im.info)
        try:saved['UserComment']=im.getexif().get(0x9286) or saved.get('UserComment')
        except Exception:pass
        fields=generation(item,saved=saved)
        im=im.convert('RGBA' if 'A' in im.getbands() else 'RGB');im.thumbnail((4096,4096))
        buf=io.BytesIO();im.save(buf,'PNG' if im.mode=='RGBA' else 'JPEG',**({} if im.mode=='RGBA' else {'quality':94}))
        mime='image/png' if im.mode=='RGBA' else 'image/jpeg'
    return {'ok':True,'b64':base64.b64encode(buf.getvalue()).decode(),'mime':mime,'width':w,'height':h,
            'original_available':original,'preview_limited':max(w,h)>4096,
            'meta':fields['meta'],'resources':fields['resources'],'metadata_source':fields['metadata_source']}


def clipboard_dib(data):
    """将受限图片转换成真正的 CF_DIB，不能把 JPEG blob 标成 image/png。"""
    from PIL import Image
    if not isinstance(data,bytes) or len(data)>LIMIT:raise ValueError('图片数据无效或过大')
    with Image.open(io.BytesIO(data)) as im:
        if im.width*im.height>4096*4096:raise ValueError('复制预览尺寸过大')
        image=im.convert('RGB');out=io.BytesIO();image.save(out,format='BMP');image.close()
    return out.getvalue()[14:]  # CF_DIB 不包含 BITMAPFILEHEADER。


def copy_clipboard_image(data, owner=0):
    import sys
    if sys.platform!='win32' or not owner:return False  # 其他平台由网页 PNG ClipboardItem 兜底。
    dib=clipboard_dib(data)
    import ctypes,time
    u,k=ctypes.WinDLL('user32',use_last_error=True),ctypes.WinDLL('kernel32',use_last_error=True)
    u.OpenClipboard.argtypes=[ctypes.c_void_p];u.OpenClipboard.restype=ctypes.c_bool
    u.EmptyClipboard.restype=ctypes.c_bool
    u.SetClipboardData.argtypes=[ctypes.c_uint,ctypes.c_void_p];u.SetClipboardData.restype=ctypes.c_void_p
    u.CloseClipboard.restype=ctypes.c_bool
    k.GlobalAlloc.argtypes=[ctypes.c_uint,ctypes.c_size_t];k.GlobalAlloc.restype=ctypes.c_void_p
    k.GlobalLock.argtypes=[ctypes.c_void_p];k.GlobalLock.restype=ctypes.c_void_p
    k.GlobalUnlock.argtypes=[ctypes.c_void_p];k.GlobalFree.argtypes=[ctypes.c_void_p]
    k.GlobalFree.restype=ctypes.c_void_p
    handle=k.GlobalAlloc(0x42,len(dib))
    if not handle:return False
    try:
        pointer=k.GlobalLock(handle)
        if not pointer:return False
        try:ctypes.memmove(pointer,dib,len(dib))
        finally:k.GlobalUnlock(handle)
        for attempt in range(5):
            if u.OpenClipboard(ctypes.c_void_p(owner)):break
            time.sleep(.04)
        else:return False
        try:
            if not u.EmptyClipboard():return False
            if not u.SetClipboardData(8,handle):return False  # CF_DIB，所有权交给系统。
            handle=None;return True
        finally:u.CloseClipboard()
    finally:
        if handle:k.GlobalFree(handle)
