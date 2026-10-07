/* 图片大图层与来源生成数据。不执行 ComfyUI 节点，不猜测缺失参数。 */
"use strict";
let imageViewer = null, imageViewerRequest = 0, historyFocusRequest = 0;
const imageText = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value,null,2);
function closeImageViewer() {
  imageViewerRequest++;
  if (!imageViewer) return;
  const {root,keyHandler,focus} = imageViewer;
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
    if(e.key==='ArrowLeft'){e.preventDefault();loadViewerImage(imageViewer.index-1);}
    if(e.key==='ArrowRight'){e.preventDefault();loadViewerImage(imageViewer.index+1);}
    if(e.key==='Tab'){
      const items=[...root.querySelectorAll('button:not(:disabled),summary')].filter(el=>el.getClientRects().length);
      const first=items[0],last=items.at(-1);
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
    }
  };
  imageViewer={root,detail,index,zoom:1,focus,keyHandler,full:null};
  document.addEventListener('keydown',keyHandler,true);
  root.querySelector('#ivClose').onclick=closeImageViewer;
  root.querySelector('.iv-prev').onclick=()=>loadViewerImage(imageViewer.index-1);
  root.querySelector('.iv-next').onclick=()=>loadViewerImage(imageViewer.index+1);
  root.querySelector('#ivPlus').onclick=()=>setViewerZoom(imageViewer.zoom*1.2);
  root.querySelector('#ivMinus').onclick=()=>setViewerZoom(imageViewer.zoom/1.2);
  root.querySelector('#ivFit').onclick=()=>setViewerZoom(1);
  root.querySelector('#ivActual').onclick=()=>setViewerZoom(Math.max(.2,(imageViewer.full?.width||root.querySelector('#ivImage').naturalWidth)/viewerFitWidth()));
  root.querySelector('.iv-image-scroll').addEventListener('wheel',e=>{if(e.ctrlKey)return;e.preventDefault();setViewerZoom(imageViewer.zoom*(e.deltaY<0?1.1:1/1.1));},{passive:false});
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
    const img=root.querySelector('#ivImage');if(!img.src.startsWith('data:image/'))return;
    const a=document.createElement('a');a.href=img.src;a.download='image-preview.'+(img.src.startsWith('data:image/png')?'png':'jpg');a.click();
  };
  root.querySelector('#ivExport').onclick=()=>{
    const c=imageViewer.detail.covers[imageViewer.index];const blob=new Blob([JSON.stringify({source:c.metadata_source,meta:c.meta||{},resources:c.resources||[]},null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='image-generation-data.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  };
  const imageArea=root.querySelector('.iv-image-scroll');
  const image=root.querySelector('#ivImage');let pan=null,blockClickUntil=0;
  image.addEventListener('dragstart',e=>e.preventDefault());
  image.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;e.preventDefault();
    pan={id:e.pointerId,x:e.clientX,y:e.clientY,left:imageArea.scrollLeft,top:imageArea.scrollTop,moved:false};
    image.setPointerCapture(e.pointerId);imageArea.classList.add('is-panning');
  });
  image.addEventListener('pointermove',e=>{
    if(!pan || pan.id!==e.pointerId)return;
    const z=Number(document.documentElement.style.zoom)||1,dx=(e.clientX-pan.x)/z,dy=(e.clientY-pan.y)/z;
    if(Math.abs(dx)+Math.abs(dy)>3)pan.moved=true;
    imageArea.scrollLeft=pan.left-dx;imageArea.scrollTop=pan.top-dy;
  });
  const endPan=e=>{
    if(!pan || pan.id!==e.pointerId)return;
    if(pan.moved)blockClickUntil=performance.now()+250;
    pan=null;imageArea.classList.remove('is-panning');
    if(image.hasPointerCapture(e.pointerId))image.releasePointerCapture(e.pointerId);
  };
  for(const type of ['pointerup','pointercancel','lostpointercapture'])image.addEventListener(type,endPan);
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
function setViewerZoom(zoom){
  if(!imageViewer)return;
  imageViewer.zoom=Math.max(.2,Math.min(8,zoom));
  const img=imageViewer.root.querySelector('#ivImage'),area=imageViewer.root.querySelector('.iv-image-scroll');
  const ratio=(area.scrollLeft+area.clientWidth/2)/(area.scrollWidth||1),vertical=(area.scrollTop+area.clientHeight/2)/(area.scrollHeight||1);
  img.style.width=viewerFitWidth()*imageViewer.zoom+'px';
  // 保持缩放中心，避免每次缩放都跳到角落；超大图放在可滚动画布而非居中负溢出。
  area.scrollLeft=ratio*area.scrollWidth-area.clientWidth/2;area.scrollTop=vertical*area.scrollHeight-area.clientHeight/2;
  area.dataset.pannable=(area.scrollWidth>area.clientWidth+1 || area.scrollHeight>area.clientHeight+1)?'true':'false';
  imageViewer.root.querySelector('#ivFit').textContent=imageViewer.zoom===1?'适合窗口':Math.round(imageViewer.zoom*100)+'% · 适配';
}
function renderGeneration(c){
  const v=imageViewer,meta=c.meta||{},resources=Array.isArray(c.resources)?c.resources:[];
  const prompt=imageText(meta.prompt||c.prompt),negative=imageText(meta.negativePrompt||meta['Negative prompt']||c.negative);
  const textBlock=(id,label,value)=>'<section class="iv-data"><header><h3>'+label+'</h3><button class="icon-btn" data-iv-copy="'+id+'" aria-label="复制'+label+'"'+(value?'':' disabled')+'>'+_icon('copy')+'</button></header><div class="iv-prompt">'+esc(value||'来源未提供')+'</div></section>';
  const fields=Object.entries(meta).filter(([key])=>!['prompt','negativePrompt','Negative prompt','resources','civitaiResources','workflow','comfyPrompt'].includes(key));
  v.root.querySelector('.iv-generation').innerHTML='<header class="iv-data-head"><h2>'+_icon('settings')+'生成数据</h2><button class="btn btn-tiny" data-iv-copy="all">'+_icon('copy')+'复制全部</button></header><p class="iv-source">'+esc(c.metadata_source||'来源未提供生成数据')+'</p>'+(c.metadata_note?'<p class="iv-source">'+esc(c.metadata_note)+'</p>':'')+'<section class="iv-data"><h3>使用资源</h3>'+(resources.length?resources.map(r=>{
    const name=imageText(r.modelName||r.name||r.modelVersionName||'未命名资源'),id=r.modelId||r.model?.id;
    return '<div class="iv-resource">'+(/^\d+$/.test(String(id))?'<button class="iv-resource-link" data-resource-id="'+esc(id)+'">'+esc(name)+'</button>':'<b>'+esc(name)+'</b>')+'<small>'+esc(imageText(r.type||''))+' · '+esc(imageText(r.versionName||r.version||r.modelVersionId||''))+'</small></div>';
  }).join(''):'<p class="iv-missing">图片来源没有记录资源列表，不根据提示词猜测。</p>')+'</section>'+textBlock('prompt','正面提示词',prompt)+textBlock('negative','负面提示词',negative)+'<section class="iv-data"><h3>其他参数</h3><div class="iv-badges">'+fields.map(([k,value])=>'<span><b>'+esc(k)+'</b>: '+esc(imageText(value))+'</span>').join('')+(c.width&&c.height?'<span>尺寸: '+esc(c.width)+' × '+esc(c.height)+'</span>':'')+'</div>'+(!fields.length?'<p class="iv-missing">来源未提供其他参数</p>':'')+'</section>'+
    (meta.workflow||meta.comfyPrompt?'<details class="iv-data"><summary>ComfyUI 节点 / 工作流（只读）</summary><pre>'+esc(imageText(meta.workflow||meta.comfyPrompt))+'</pre></details>':'');
  v.root.querySelector('.iv-generation').onclick=async e=>{
    const b=e.target.closest('[data-iv-copy]');
    if(b){const key=b.dataset.ivCopy;const value=key==='prompt'?prompt:key==='negative'?negative:JSON.stringify({meta,resources},null,2);v.root.querySelector('#ivStatus').textContent=(await window.__copyText(value))?'生成数据已复制':'复制失败';}
    const link=e.target.closest('[data-resource-id]');if(link)api.call('open_url','https://civitai.com/models/'+link.dataset.resourceId);
  };
}
async function loadViewerImage(index){
  if(!imageViewer)return;
  const v=imageViewer,covers=v.detail.covers;index=Math.max(0,Math.min(covers.length-1,index));
  const menu=v.root.querySelector('#ivContext');if(menu)menu.style.display='none';
  v.index=index;v.zoom=1;v.full=null;const area=v.root.querySelector('.iv-image-scroll');area.scrollTop=area.scrollLeft=0;const request=++imageViewerRequest,c=covers[index],img=v.root.querySelector('#ivImage');
  img.removeAttribute('src');if(c.b64)img.src='data:image/jpeg;base64,'+c.b64;
  v.root.querySelector('#ivCount').textContent=(index+1)+' / '+covers.length;
  v.root.querySelector('.iv-prev').disabled=index===0;v.root.querySelector('.iv-next').disabled=index===covers.length-1;
  for(const id of ['ivShare','ivSite'])v.root.querySelector('#'+id).disabled=!(c.image_page||c.orig_url||c.url);
  renderGeneration(c);v.root.querySelector('#ivStatus').textContent='正在读取大图…';
  img.onload=()=>{if(imageViewer===v)setViewerZoom(v.zoom);};
  try{
    const full=await api.call('get_gallery_image',v.detail.path,index,v.detail.history_id||'');
    if(imageViewer!==v || request!==imageViewerRequest)return;
    if(full?.ok && full.b64){Object.assign(c,{meta:{...(c.meta||{}),...(full.meta||{})},resources:full.resources?.length?full.resources:(c.resources||[]),metadata_source:full.metadata_source||c.metadata_source,width:full.width,height:full.height});renderGeneration(c);v.full=full;img.src='data:'+(full.mime||'image/jpeg')+';base64,'+full.b64;setViewerZoom(1);
      v.root.querySelector('#ivStatus').textContent=full.original_available?(full.preview_limited?'大图预览限制 4096 px，保存图片仍使用来源文件':'大图已加载；滚轮缩放图片'):'仅有缓存预览，来源原图不可用';
    }else v.root.querySelector('#ivStatus').textContent=full?.msg||'大图加载失败，保留现有预览';
  }catch(_){if(imageViewer===v && request===imageViewerRequest)v.root.querySelector('#ivStatus').textContent='大图加载失败，保留现有预览';}
  if(imageViewer!==v || request!==imageViewerRequest)return;
  try {
    const metadata=await api.call('get_gallery_metadata',v.detail.path,index,v.detail.history_id||'');
    if(imageViewer!==v || request!==imageViewerRequest)return;
    if(metadata?.ok){
      c.metadata_note=metadata.metadata_note||'';
      c.meta=metadata.online_metadata?{...(c.meta||{}),...(metadata.meta||{})}:{...(metadata.meta||{}),...(c.meta||{})};if(metadata.resources?.length)c.resources=metadata.resources;
      if(metadata.online_metadata || ((!c.metadata_source || c.metadata_source==='未提供生成数据') && Object.keys(metadata.meta||{}).length))c.metadata_source=metadata.metadata_source;
      renderGeneration(c);
    }
  }catch(_){ /* 保留原图已读取的元数据，不让网络失败清空面板。 */ }
}
window.addEventListener('resize',()=>{if(imageViewer)setViewerZoom(imageViewer.zoom);});
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
    state.coverCache.delete(detail.path);for(const row of state.models)if(row.path===detail.path){row.path=result.path;row.name=result.path.split(/[\\/]/).pop();}
    applyMmFilter();await showModelDetail(result.path,detail.history_id||'');
  }catch(_){showToast('改名失败，请重试');}
}

document.addEventListener('pointerdown',e=>{
  const model=e.target.closest('.ms-card[data-path],#mmTable tr[data-path]');
  if(model && state.historyFocusPath && normalizedModelPath(model.dataset.path)!==normalizedModelPath(state.historyFocusPath)){state.historyFocusPath='';document.querySelectorAll('.history-focus').forEach(n=>n.classList.remove('history-focus'));}
});
