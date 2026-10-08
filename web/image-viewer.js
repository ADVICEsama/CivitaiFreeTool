/* 图片大图层与来源生成数据。不执行 ComfyUI 节点，不猜测缺失参数。 */
"use strict";
let imageViewer = null, imageViewerRequest = 0, historyFocusRequest = 0;
const viewerDecodedCache=new Map(),VIEWER_CACHE_BYTES=96*1024*1024,VIEWER_CACHE_COUNT=6;
let viewerCacheAccount=null,viewerCacheEpoch=0;
const viewerWarmRequests=new Map();
function disposeViewerEntry(entry){if(!entry)return;entry.image.onload=null;entry.image.remove();entry.image.removeAttribute('src');URL.revokeObjectURL(entry.url);}
function clearViewerImageCache(){
  viewerCacheEpoch++;viewerWarmRequests.clear();
  if(imageViewer)closeImageViewer();
  for(const entry of viewerDecodedCache.values())disposeViewerEntry(entry);viewerDecodedCache.clear();
}
function viewerCacheKey(detail,index){
  const account=String(state.cfg.api_key||'');
  if(viewerCacheAccount!==account){clearViewerImageCache();viewerCacheAccount=account;}
  const c=detail.covers[index];return String(c.source_revision||c.local_path||c.url||c.orig_url||detail.path+'|'+(detail.history_id||'')+'|'+index);
}
function rememberViewerEntry(key,entry){
  if(state.cfg.cache_original_images===false)return;
  const old=viewerDecodedCache.get(key);if(old && old!==entry)disposeViewerEntry(old);
  viewerDecodedCache.delete(key);viewerDecodedCache.set(key,entry);
  const bytes=()=>[...viewerDecodedCache.values()].reduce((n,e)=>n+e.bytes,0);
  while(viewerDecodedCache.size>1 && (viewerDecodedCache.size>VIEWER_CACHE_COUNT || bytes()>VIEWER_CACHE_BYTES)){
    const keys=[...viewerDecodedCache.keys()],main=document.querySelector('#dMain');
    const oldest=keys.find(k=>{const e=viewerDecodedCache.get(k);return e!==entry && !e.image.isConnected && (imageViewer || main?.src!==e.url);});if(oldest===undefined)break;disposeViewerEntry(viewerDecodedCache.get(oldest));viewerDecodedCache.delete(oldest);
  }
}
function viewerImageElement(){const img=new Image();img.id='ivImage';img.draggable=false;img.alt='模型示例图片';return img;}
async function decodeViewerEntry(full){
  const raw=atob(full.b64),data=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);
  const blob=new Blob([data],{type:full.mime||'image/jpeg'}),url=URL.createObjectURL(blob),image=viewerImageElement();image.src=url;
  try{await image.decode();}catch(error){URL.revokeObjectURL(url);throw error;}
  const {b64,...info}=full;
  return {full:info,url,image,bytes:image.naturalWidth*image.naturalHeight*4+blob.size,metadata:null,retryAt:0};
}
async function warmViewedGallery(detail,index=0){
  if(state.cfg.cache_original_images===false || !detail?.covers?.[index])return null;
  const account=String(state.cfg.api_key||''),key=viewerCacheKey(detail,index),epoch=viewerCacheEpoch;
  if(viewerDecodedCache.has(key))return viewerDecodedCache.get(key);
  if(viewerWarmRequests.has(key))return viewerWarmRequests.get(key);
  const task=(async()=>{
    const cached=await api.call('get_gallery_cached',detail.path,index,detail.history_id||'',index===0 && !!detail.covers[index].local_path);
    if(!cached?.ok || !cached.full?.b64 || state.cfg.cache_original_images===false || String(state.cfg.api_key||'')!==account || epoch!==viewerCacheEpoch)return null;
    const entry=await decodeViewerEntry(cached.full);
    if(state.cfg.cache_original_images===false || String(state.cfg.api_key||'')!==account || epoch!==viewerCacheEpoch){disposeViewerEntry(entry);return null;}
    entry.metadata=cached.metadata||null;rememberViewerEntry(key,entry);return entry;
  })().catch(()=>null).finally(()=>{if(viewerWarmRequests.get(key)===task)viewerWarmRequests.delete(key);});
  viewerWarmRequests.set(key,task);return task;
}
function mergeViewerMetadata(c,metadata){
  if(!metadata?.ok)return;
  c.metadata_note=metadata.metadata_note||'';
  c.meta=metadata.online_metadata?{...(c.meta||{}),...(metadata.meta||{})}:{...(metadata.meta||{}),...(c.meta||{})};
  if(metadata.resources?.length)c.resources=metadata.resources;
  if(metadata.online_metadata || ((!c.metadata_source || c.metadata_source==='未提供生成数据') && Object.keys(metadata.meta||{}).length))c.metadata_source=metadata.metadata_source;
}
function displayViewerEntry(v,c,entry,memory){
  const current=v.root.querySelector('#ivImage');if(current!==entry.image)current.replaceWith(entry.image);
  v.entry=entry;v.full=entry.full;
  Object.assign(c,{meta:{...(c.meta||{}),...(entry.full.meta||{})},resources:entry.full.resources?.length?entry.full.resources:(c.resources||[]),metadata_source:entry.full.metadata_source||c.metadata_source,width:entry.full.width,height:entry.full.height});
  mergeViewerMetadata(c,entry.metadata);renderGeneration(c);setViewerZoom(1,null,true);
  const source=memory?'内存缓存：直接复用已解码图片':entry.full.cache_hit?'本地缓存：读取与解码完成':'首次加载完成';
  v.root.querySelector('#ivStatus').textContent=source+(entry.full.original_available===false?'；仅有预览，来源原图不可用':entry.full.preview_limited?'；预览限制 4096 px，保存仍使用来源文件':'；滚轮直接缩放图片');
  v.root.dataset.imageSource=memory?'memory':entry.full.cache_hit?'disk':'first';
}

const imageText = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value,null,2);
function closeImageViewer() {
  imageViewerRequest++;
  if (!imageViewer) return;
  const {root,keyHandler,focus,entry} = imageViewer;
  if(entry){entry.image.onload=null;entry.image.remove();if(![...viewerDecodedCache.values()].includes(entry))disposeViewerEntry(entry);}
  if(imageViewer.zoomRaf)cancelAnimationFrame(imageViewer.zoomRaf);
  document.removeEventListener('keydown',keyHandler,true);root.remove();imageViewer=null;
  if (focus?.isConnected) focus.focus({preventScroll:true});
}
async function openImageViewer(detail,index=0) {
  closeImageViewer();
  if (!detail?.covers?.length) {showToast('没有可查看的图片');return;}
  const focus=document.activeElement,root=document.createElement('div');
  root.id='imageViewer';root.className='image-viewer';root.setAttribute('role','dialog');
  root.setAttribute('aria-modal','true');root.setAttribute('aria-label','图片与生成数据');
  root.innerHTML='<header class="iv-toolbar pywebview-drag-region"><button class="icon-btn" id="ivClose" aria-label="关闭图片预览">'+_icon('x')+'</button><span id="ivCount"></span><div class="iv-zoom"><button class="btn" id="ivMinus" aria-label="缩小">−</button><button class="btn" id="ivFit">适合窗口</button><button class="btn" id="ivActual">100%</button><button class="btn" id="ivPlus" aria-label="放大">'+_icon('plus')+'</button></div><div class="iv-actions"><button class="btn" id="ivSave" title="选择保存位置，保存来源图片而非列表缩略图">'+_icon('download')+'保存图片</button><button class="btn" id="ivShare" title="复制图片页面链接">'+_icon('copy')+'分享</button><details class="iv-more"><summary class="icon-btn" aria-label="更多图片操作">'+_icon('more-vertical')+'</summary><div><button class="btn" id="ivSite">'+_icon('external')+'打开 C站原图页</button><button class="btn" id="ivCopyImage">'+_icon('copy')+'复制当前图片</button><button class="btn" id="ivPreviewSave">'+_icon('download')+'保存当前预览</button><button class="btn" id="ivExport">'+_icon('file')+'导出生成数据 JSON</button></div></details></div></header><div class="iv-body"><main class="iv-stage" title="滚轮缩放图片；Ctrl + 滚轮仍缩放软件界面"><button class="icon-btn iv-prev" aria-label="上一张">‹</button><div class="iv-image-scroll"><div class="iv-image-canvas"><img id="ivImage" draggable="false" alt="模型示例图片"/></div></div><button class="icon-btn iv-next" aria-label="下一张">›</button><p id="ivStatus" role="status"></p></main><aside class="iv-generation" aria-label="图片生成数据"></aside></div>';
  document.body.append(root);
  const keyHandler=e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();const menu=root.querySelector('#ivContext');if(menu?.style.display==='block')menu.style.display='none';else closeImageViewer();return;}
    if(e.target.closest('input,textarea'))return;
    if(e.key==='Tab'){
      const items=[...root.querySelectorAll('button:not(:disabled),summary')].filter(el=>el.getClientRects().length);
      const first=items[0],last=items.at(-1);
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
    }
  };
  imageViewer={root,detail,index,zoom:1,targetZoom:1,zoomRaf:0,focus,keyHandler,full:null};
  document.addEventListener('keydown',keyHandler,true);
  root.querySelector('#ivClose').onclick=closeImageViewer;
  root.querySelector('.iv-prev').onclick=()=>loadViewerImage(imageViewer.index-1);
  root.querySelector('.iv-next').onclick=()=>loadViewerImage(imageViewer.index+1);
  root.querySelector('#ivPlus').onclick=()=>setViewerZoom(imageViewer.targetZoom*1.2);
  root.querySelector('#ivMinus').onclick=()=>setViewerZoom(imageViewer.targetZoom/1.2);
  root.querySelector('#ivFit').onclick=()=>setViewerZoom(1);
  root.querySelector('#ivActual').onclick=()=>setViewerZoom(Math.max(.2,(imageViewer.full?.width||root.querySelector('#ivImage').naturalWidth)/viewerFitWidth()));
  root.querySelector('.iv-image-scroll').addEventListener('wheel',e=>{if(e.ctrlKey)return;e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?imageArea.clientHeight:1);setViewerZoom(imageViewer.zoom*Math.exp(-Math.max(-300,Math.min(300,delta))*.002),{x:e.clientX,y:e.clientY},true);},{passive:false});
  root.querySelector('#ivShare').onclick=async()=>{
    const c=imageViewer.detail.covers[imageViewer.index],url=c.image_page||c.orig_url||c.url||'';
    root.querySelector('#ivStatus').textContent=url?(await window.__copyText(url)?'图片链接已复制':'复制失败'):'仅有本地图片，没有可分享的公开链接';
  };
  const site=()=>{const c=imageViewer.detail.covers[imageViewer.index];const u=c.image_page||c.orig_url||c.url;if(u)api.call('open_url',u);};
  root.querySelector('#ivSite').onclick=site;
  root.querySelector('#ivSave').onclick=async()=>{
    const v=imageViewer,button=root.querySelector('#ivSave');button.disabled=true;
    try{const r=await api.call('save_gallery_image',v.detail.path,v.index,v.detail.history_id||'');if(root.isConnected)root.querySelector('#ivStatus').textContent=r?.msg||'保存没有返回结果';}
    catch(_){if(root.isConnected)root.querySelector('#ivStatus').textContent='保存失败，可使用更多菜单里的“保存当前预览”';}
    finally{if(root.isConnected)button.disabled=false;}
  };
  root.querySelector('#ivCopyImage').onclick=async()=>{
    const v=imageViewer;
    try{
      const result=await api.call('copy_gallery_image',v.detail.path,v.index,v.detail.history_id||'');
      if(result?.ok){if(root.isConnected)root.querySelector('#ivStatus').textContent=result.msg||'当前图片已复制';return;}
      const img=root.querySelector('#ivImage'),canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      canvas.getContext('2d').drawImage(img,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);root.querySelector('#ivStatus').textContent='当前图片已复制';
    }catch(_){root.querySelector('#ivStatus').textContent='系统不允许复制图片，可改用保存图片';}
  };
  root.querySelector('#ivPreviewSave').onclick=()=>{
    const img=root.querySelector('#ivImage');if(!/^(data:image\/|blob:)/.test(img.src))return;
    const a=document.createElement('a');a.href=img.src;a.download='image-preview.'+(imageViewer.full?.mime==='image/png'?'png':'jpg');a.click();
  };
  root.querySelector('#ivExport').onclick=()=>{
    const c=imageViewer.detail.covers[imageViewer.index];const blob=new Blob([JSON.stringify({source:c.metadata_source,meta:c.meta||{},resources:c.resources||[]},null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='image-generation-data.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  };
  const imageArea=root.querySelector('.iv-image-scroll');
  const viewerImage=()=>root.querySelector('#ivImage');let pan=null,blockClickUntil=0;
  imageArea.addEventListener('dragstart',e=>e.preventDefault());
  imageArea.addEventListener('pointerdown',e=>{
    if(e.button!==0 || !e.target.closest('#ivImage'))return;e.preventDefault();const image=viewerImage();
    pan={id:e.pointerId,x:e.clientX,y:e.clientY,left:imageArea.scrollLeft,top:imageArea.scrollTop,moved:false};
    image.setPointerCapture(e.pointerId);imageArea.classList.add('is-panning');
  });
  imageArea.addEventListener('pointermove',e=>{
    if(!pan || pan.id!==e.pointerId)return;
    const z=Number(document.documentElement.style.zoom)||1,dx=(e.clientX-pan.x)/z,dy=(e.clientY-pan.y)/z;
    if(Math.abs(dx)+Math.abs(dy)>3)pan.moved=true;
    imageArea.scrollLeft=pan.left-dx;imageArea.scrollTop=pan.top-dy;
  });
  const endPan=e=>{
    if(!pan || pan.id!==e.pointerId)return;
    if(pan.moved)blockClickUntil=performance.now()+250;
    pan=null;imageArea.classList.remove('is-panning');
    const image=viewerImage();if(image.hasPointerCapture(e.pointerId))image.releasePointerCapture(e.pointerId);
  };
  for(const type of ['pointerup','pointercancel','lostpointercapture'])imageArea.addEventListener(type,endPan);
  imageArea.addEventListener('click',e=>{
    if(performance.now()<blockClickUntil || !e.target.matches('.iv-image-scroll,.iv-image-canvas'))return;
    const box=imageArea.getBoundingClientRect(),z=Number(document.documentElement.style.zoom)||1;
    if(e.clientX>=box.left+imageArea.clientWidth*z || e.clientY>=box.top+imageArea.clientHeight*z)return;
    closeImageViewer();
  });
  const menu=document.createElement('div');menu.id='ivContext';menu.className='ctx-menu';menu.style.display='none';menu.setAttribute('aria-label','图片右键操作');root.append(menu);
  root.addEventListener('contextmenu',e=>{
    if(!e.target.closest('#ivImage'))return;e.preventDefault();
    const c=imageViewer.detail.covers[imageViewer.index],meta=c.meta||{};
    menu.innerHTML=contextAction('iv_copy','复制图片','copy')+contextAction('iv_save','保存图片…','download')+contextAction('iv_site','打开 C站原图页','external')+'<hr class="ctx-sep"/>'+contextAction('iv_prompt','复制正面提示词','file')+contextAction('iv_negative','复制负面提示词','file')+contextAction('iv_data','复制全部生成数据','copy');
    menu.querySelector('[data-act=iv_site]').disabled=!(c.image_page||c.orig_url||c.url);
    menu.querySelector('[data-act=iv_prompt]').disabled=!(meta.prompt||c.prompt);
    menu.querySelector('[data-act=iv_negative]').disabled=!(meta.negativePrompt||meta['Negative prompt']||c.negative);
    placeContextMenu(menu,e.clientX,e.clientY);
  });
  menu.addEventListener('click',e=>{
    const button=e.target.closest('[data-act]');if(!button||button.disabled)return;menu.style.display='none';
    const ids={iv_copy:'ivCopyImage',iv_save:'ivSave',iv_site:'ivSite'};
    if(ids[button.dataset.act])root.querySelector('#'+ids[button.dataset.act]).click();
    else root.querySelector('[data-iv-copy='+({iv_prompt:'prompt',iv_negative:'negative',iv_data:'all'}[button.dataset.act])+']')?.click();
  });
  root.addEventListener('pointerdown',e=>{if(!e.target.closest('#ivContext'))menu.style.display='none';});
  root.querySelector('#ivClose').focus();await loadViewerImage(index);
}
function viewerFitWidth(){
  if(!imageViewer)return 1;
  const area=imageViewer.root.querySelector('.iv-image-scroll'),img=imageViewer.root.querySelector('#ivImage');
  const w=imageViewer.full?.width||img.naturalWidth||1,h=imageViewer.full?.height||img.naturalHeight||1;
  return Math.max(1,Math.min(area.clientWidth-24,(area.clientHeight-24)*w/h));
}
// 按钮短促 ease-out；滚轮立即跟手，不让图片一直追赶累计目标。
function viewerEaseOut(t){return 1-Math.pow(1-Math.max(0,Math.min(1,t)),3);}
function setViewerZoom(zoom,anchor=null,immediate=false){
  const v=imageViewer;if(!v)return;
  v.targetZoom=Math.max(.05,Math.min(32,Number(zoom)||1));
  const img=v.root.querySelector('#ivImage'),area=v.root.querySelector('.iv-image-scroll');
  const fit=viewerFitWidth(),z=Number(document.documentElement.style.zoom)||1;
  const ab=area.getBoundingClientRect(),ib=img.getBoundingClientRect();
  const x=anchor?(anchor.x-ab.left)/z:area.clientWidth/2,y=anchor?(anchor.y-ab.top)/z:area.clientHeight/2;
  const fractionX=(ab.left+x*z-ib.left)/Math.max(1,ib.width),fractionY=(ab.top+y*z-ib.top)/Math.max(1,ib.height);
  if(v.zoomRaf)cancelAnimationFrame(v.zoomRaf);
  const fromZoom=v.zoom,start=performance.now()-8,duration=80;
  const draw=now=>{
    if(imageViewer!==v)return;
    const progress=Math.max(0,Math.min(1,(now-start)/duration));
    v.zoom=immediate?v.targetZoom:fromZoom+(v.targetZoom-fromZoom)*viewerEaseOut(progress);
    if(progress===1)v.zoom=v.targetZoom;
    const width=fit*v.zoom,height=width*(v.full?.height||img.naturalHeight||1)/(v.full?.width||img.naturalWidth||1);
    img.style.width=width+'px';
    const canvas=v.root.querySelector('.iv-image-canvas');canvas.style.width=Math.max(area.clientWidth,width+24)+'px';canvas.style.height=Math.max(area.clientHeight,height+24)+'px';
    area.scrollLeft=12+Math.max(0,(area.clientWidth-24-width)/2)+fractionX*width-x;
    area.scrollTop=12+Math.max(0,(area.clientHeight-24-height)/2)+fractionY*height-y;
    area.dataset.pannable=(width>area.clientWidth-24 || height>area.clientHeight-24)?'true':'false';
    v.root.querySelector('#ivFit').textContent=Math.abs(v.zoom-1)<.001?'适合窗口':(v.zoom*100).toFixed(1)+'% · 适配';
    v.zoomRaf=v.zoom===v.targetZoom?0:requestAnimationFrame(draw);
  };
  draw(performance.now());
}
function renderGeneration(c){
  const v=imageViewer,meta=c.meta||{},resources=Array.isArray(c.resources)?c.resources:[];
  const prompt=imageText(meta.prompt||c.prompt),negative=imageText(meta.negativePrompt||meta['Negative prompt']||c.negative);
  const textBlock=(id,label,value)=>'<section class="iv-data"><header><h3>'+label+'</h3><button class="icon-btn" data-iv-copy="'+id+'" aria-label="复制'+label+'"'+(value?'':' disabled')+'>'+_icon('copy')+'</button></header><div class="iv-prompt">'+esc(value||'来源未提供')+'</div></section>';
  const fields=Object.entries(meta).filter(([key])=>!['prompt','negativePrompt','Negative prompt','resources','civitaiResources','workflow','comfyPrompt'].includes(key));
  v.root.querySelector('.iv-generation').innerHTML='<header class="iv-data-head"><h2>'+_icon('settings')+'生成数据</h2><button class="btn btn-tiny" data-iv-copy="all">'+_icon('copy')+'复制全部</button></header><p class="iv-source">'+esc(c.metadata_source||'来源未提供生成数据')+'</p>'+(c.metadata_note?'<p class="iv-source">'+esc(c.metadata_note)+'</p>':'')+'<section class="iv-data"><h3>使用资源</h3>'+(resources.length?resources.map(r=>{
    const name=imageText(r.modelName||r.name||r.modelVersionName||(r.modelVersionId?'模型版本 #'+r.modelVersionId:'未命名资源')),id=r.modelId||r.model?.id;
    return '<div class="iv-resource">'+'<button class="iv-resource-link" data-resource-index="'+resources.indexOf(r)+'" title="'+(id||r.modelVersionId?'打开 C站模型页':'尝试匹配本地模型或来源中的模型地址；缺少 ID 不会自动搜索')+'">'+esc(name)+_icon('external')+'</button>'+'<small>'+esc(imageText(r.type||''))+' · '+esc(imageText(r.versionName||r.version||r.modelVersionId||''))+'</small></div>';
  }).join(''):'<p class="iv-missing">图片来源没有记录资源列表，不根据提示词猜测。</p>')+'</section>'+textBlock('prompt','正面提示词',prompt)+textBlock('negative','负面提示词',negative)+'<section class="iv-data"><h3>其他参数</h3><div class="iv-badges">'+fields.map(([k,value])=>'<span><b>'+esc(k)+'</b>: '+esc(imageText(value))+'</span>').join('')+(c.width&&c.height?'<span>尺寸: '+esc(c.width)+' × '+esc(c.height)+'</span>':'')+'</div>'+(!fields.length?'<p class="iv-missing">来源未提供其他参数</p>':'')+'</section>'+
    (meta.workflow||meta.comfyPrompt?'<details class="iv-data"><summary>ComfyUI 节点 / 工作流（只读）</summary><pre>'+esc(imageText(meta.workflow||meta.comfyPrompt))+'</pre></details>':'');
  v.root.querySelector('.iv-generation').onclick=async e=>{
    const b=e.target.closest('[data-iv-copy]');
    if(b){const key=b.dataset.ivCopy;const value=key==='prompt'?prompt:key==='negative'?negative:JSON.stringify({meta,resources},null,2);v.root.querySelector('#ivStatus').textContent=(await window.__copyText(value))?'生成数据已复制':'复制失败';}
    const link=e.target.closest('[data-resource-index]');if(link){link.disabled=true;try{const r=await api.call('open_gallery_resource',resources[Number(link.dataset.resourceIndex)]);if(imageViewer===v)v.root.querySelector('#ivStatus').textContent=r?.msg||'资源跳转没有返回结果';}catch(_){if(imageViewer===v)v.root.querySelector('#ivStatus').textContent='资源跳转失败';}finally{link.disabled=false;}}
  };
}
async function loadViewerImage(index){
  if(!imageViewer)return;
  const v=imageViewer,covers=v.detail.covers;index=Math.max(0,Math.min(covers.length-1,index));
  // 账号或开关变化只能在开始前清空，不在 modal 已挂载后把本次查看器关闭。
  const account=String(state.cfg.api_key||'');if(viewerCacheAccount===null)viewerCacheAccount=account;
  if(viewerCacheAccount!==account){for(const e of viewerDecodedCache.values())disposeViewerEntry(e);viewerDecodedCache.clear();viewerCacheAccount=account;}
  const c=covers[index],key=viewerCacheKey(v.detail,index);let cached=state.cfg.cache_original_images!==false?viewerDecodedCache.get(key):null;
  const menu=v.root.querySelector('#ivContext');if(menu)menu.style.display='none';
  if(v.zoomRaf)cancelAnimationFrame(v.zoomRaf);v.zoomRaf=0;v.index=index;v.zoom=v.targetZoom=1;v.full=null;
  const area=v.root.querySelector('.iv-image-scroll');area.scrollTop=area.scrollLeft=0;const request=++imageViewerRequest;
  v.root.querySelector('#ivCount').textContent=(index+1)+' / '+covers.length;
  v.root.querySelector('.iv-prev').disabled=index===0;v.root.querySelector('.iv-next').disabled=index===covers.length-1;
  for(const id of ['ivShare','ivSite'])v.root.querySelector('#'+id).disabled=!(c.image_page||c.orig_url||c.url);
  if(!cached && viewerWarmRequests.has(key)){
    v.root.querySelector('#ivStatus').textContent='本地高清缓存准备中…';cached=await viewerWarmRequests.get(key);
    if(imageViewer!==v || request!==imageViewerRequest)return;
  }
  if(cached){viewerDecodedCache.delete(key);viewerDecodedCache.set(key,cached);displayViewerEntry(v,c,cached,true);}
  else{
    const old=v.entry,placeholder=viewerImageElement();v.root.querySelector('#ivImage').replaceWith(placeholder);v.entry=null;
    if(old && ![...viewerDecodedCache.values()].includes(old))disposeViewerEntry(old);
    if(c.b64)placeholder.src='data:image/jpeg;base64,'+c.b64;
    placeholder.onload=()=>{if(imageViewer===v && request===imageViewerRequest)setViewerZoom(v.targetZoom,null,true);};
    renderGeneration(c);v.root.querySelector('#ivStatus').textContent='读取图片来源（优先本地缓存）…';
    try{
      const full=await api.call('get_gallery_image',v.detail.path,index,v.detail.history_id||'');
      if(imageViewer!==v || request!==imageViewerRequest)return;
      if(full?.ok && full.b64){
        const entry=await decodeViewerEntry(full);
        if(imageViewer!==v || request!==imageViewerRequest){disposeViewerEntry(entry);return;}
        rememberViewerEntry(key,entry);displayViewerEntry(v,c,entry,false);
      }else v.root.querySelector('#ivStatus').textContent=full?.msg||'图片读取失败，保留现有预览';
    }catch(_){if(imageViewer===v && request===imageViewerRequest)v.root.querySelector('#ivStatus').textContent='图片读取失败，保留现有预览';}
  }
  if(imageViewer!==v || request!==imageViewerRequest || v.entry?.metadata || performance.now()<(v.entry?.retryAt||0))return;
  try{
    const metadata=await api.call('get_gallery_metadata',v.detail.path,index,v.detail.history_id||'');
    if(imageViewer!==v || request!==imageViewerRequest)return;
    if(metadata?.ok){if(v.entry)v.entry.metadata=metadata;mergeViewerMetadata(c,metadata);renderGeneration(c);}
    else if(v.entry)v.entry.retryAt=performance.now()+30000;
  }catch(_){if(imageViewer===v && request===imageViewerRequest && v.entry)v.entry.retryAt=performance.now()+30000;}
}
window.addEventListener('resize',()=>{if(imageViewer)setViewerZoom(imageViewer.targetZoom,null,true);});
const normalizedModelPath=p=>String(p||'').replace(/\\/g,'/').toLowerCase();
async function openHistoryModel(item){
  const request=++historyFocusRequest;switchPage('models');await showModelDetail(item.file_path||'',item.id);
  if(request!==historyFocusRequest || !$('#page-models').classList.contains('active'))return;
  const path=detailRow?.path||item.file_path;
  let target=state.models.find(r=>normalizedModelPath(r.path)===normalizedModelPath(path));
  if(!target && item.file_exists!==false){
    try{
      for(let i=0;i<20;i++){
        const scan=await api.call('get_scan_state');if(!scan?.running)break;
        await new Promise(resolve=>setTimeout(resolve,250));if(request!==historyFocusRequest)return;
      }
      const fresh=JSON.parse(await api.call('get_scan_rows')||'[]');
      target=fresh.find(r=>normalizedModelPath(r.path)===normalizedModelPath(path));if(target)state.models=fresh;
    }catch(_){}
  }
  if(request!==historyFocusRequest)return;
  if(!target){setStatus(item.file_exists===false?'历史信息已打开；本地文件不存在，无法定位模型卡片':'历史信息已打开；模型不在当前扫描结果中，请检查管理目录或隐藏文件夹');return;}
  if(!state.display.some(r=>normalizedModelPath(r.path)===normalizedModelPath(path))){
    $('#mmFilter').value='';state.mmFolderF='';state.mmBaseF='';state.mmAuthorF='';state.mmStF='';state.mmUpdOnly=false;$('#mmUpdOnly')?.classList.remove('active');applyMmFilter();
  }
  state.historyFocusPath=target.path;
  state.mmSel=new Set([target.path]);renderMm();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(request!==historyFocusRequest || !$('#page-models').classList.contains('active'))return;
  const scope=state.mmView==='masonry'?$('#mmMasonry'):$('#mmTable');
  const node=[...scope.querySelectorAll('[data-path]')].find(el=>el.matches('.ms-card,tr') && normalizedModelPath(el.dataset.path)===normalizedModelPath(path));
  if(node){node.classList.add('history-focus');node.tabIndex=0;node.focus({preventScroll:true});node.scrollIntoView({block:'center',inline:'nearest'});setStatus('已定位模型：'+target.name);}
}
async function renameDetailToCivitai(detail){
  try{
    const preview=await api.call('rename_detail_to_civitai',detail.path,true);
    if(!preview?.ok){showToast(preview?.msg||'无法预览改名');return;}
    if(preview.same){showToast(preview.msg||'当前已是 C站名称');return;}
    const ok=await confirmBoxRaw('<p>仅改这个模型及其附属文件：</p><p>'+esc(detail.name)+'</p><p>→ '+esc(preview.path.split(/[\\/]/).pop())+'</p>','文件名 → C站名称');
    if(!ok)return;ok.root?.remove();
    const result=await api.call('rename_detail_to_civitai',detail.path,false);showToast(result?.msg||'改名完成');
    if(!result?.ok)return;
    for(const set of [state.mmSel,state.mmChecked])if(set.delete(detail.path))set.add(result.path);
    if(state.cfg.model_favorites)state.cfg.model_favorites=state.cfg.model_favorites.map(p=>normalizedModelPath(p)===normalizedModelPath(detail.path)?result.path:p);
    state.coverCache.delete(detail.path);for(const row of state.models)if(row.path===detail.path){row.path=result.path;row.name=result.path.split(/[\\/]/).pop();}
    applyMmFilter();await showModelDetail(result.path,detail.history_id||'');
  }catch(_){showToast('改名失败，请重试');}
}

document.addEventListener('pointerdown',e=>{
  const model=e.target.closest('.ms-card[data-path],#mmTable tr[data-path]');
  if(model && state.historyFocusPath && normalizedModelPath(model.dataset.path)!==normalizedModelPath(state.historyFocusPath)){state.historyFocusPath='';document.querySelectorAll('.history-focus').forEach(n=>n.classList.remove('history-focus'));}
});
