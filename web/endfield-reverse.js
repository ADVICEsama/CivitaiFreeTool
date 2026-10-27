/* Local queue on the left, read-only model dossier on the right. Original queue
   handlers remain authoritative: viewing a dossier never starts an online lookup. */
(()=>{'use strict';
 let phase='all',activePath='',loadedKey='',requestId=0,detail=null,ready=false,loadFailed=false;
 const $r=s=>document.querySelector(s),text=(s,v)=>{const e=$r(s);if(e)e.textContent=v??'';};
 const phaseOf=r=>rpStatusCls(r.status),base=p=>String(p||'').split(/[\\/]/).pop()||'未命名模型';
 const missionState=r=>/暂停|取消/.test(r.status||'')?'paused':phaseOf(r);
 const missionMarkup=(r,extra='')=>'<span class="rp-mission-mark '+extra+'" data-mission-state="'+missionState(r)+'" aria-hidden="true"><span class="rp-mission-icon"></span></span>';
 const rowCovers=new Map(),coverPending=new Set();let coverFrame=0;
 const visibleRows=new IntersectionObserver(entries=>entries.forEach(e=>{e.target.dataset.rpVisible=String(e.isIntersecting);if(e.isIntersecting)queueCovers();}),{rootMargin:'80px'}),observed=new Set();
 function queueCovers(){if(!coverFrame)coverFrame=requestAnimationFrame(()=>{coverFrame=0;fillRowCovers();});}
 function setCover(row,src){if(src){row.style.setProperty('--rp-row-cover','url('+JSON.stringify(src)+')');row.classList.add('rp-has-cover');}else{row.style.removeProperty('--rp-row-cover');row.classList.remove('rp-has-cover');}}
 function fillRowCovers(){
  if(!$r('#page-reverse')?.classList.contains('active'))return;
  const queued=[],bounds=$r('.rp-wrap').getBoundingClientRect();
  for(const row of $r('#rpTable tbody').querySelectorAll('tr[data-path]')){const r=(state.rpRows||[]).find(r=>r.path===row.dataset.path);if(!r)continue;const key=JSON.stringify([r.path,r.status]),cached=state.coverCache.get(r.path)||rowCovers.get(key);if(cached){setCover(row,cached);continue;}const rect=row.getBoundingClientRect();if(rowCovers.has(key)||coverPending.has(key)||rect.bottom<bounds.top||rect.top>bounds.bottom)continue;coverPending.add(key);queued.push({path:r.path,key});}
  for(let i=0;i<queued.length;i+=40){const batch=queued.slice(i,i+40);Promise.resolve(api.call('get_covers',batch.map(r=>r.path),480)).then(result=>{const covers=typeof result==='string'?JSON.parse(result):result||{};for(const r of batch){const b64=String(covers[r.path]||'');rowCovers.set(r.key,/^[A-Za-z0-9+/=\r\n]+$/.test(b64)?'data:image/jpeg;base64,'+b64:'');}while(rowCovers.size>600)rowCovers.delete(rowCovers.keys().next().value);if(ready)for(const row of $r('#rpTable tbody').querySelectorAll('tr[data-path]')){const r=(state.rpRows||[]).find(r=>r.path===row.dataset.path);if(r)setCover(row,state.coverCache.get(r.path)||rowCovers.get(JSON.stringify([r.path,r.status])));}}).catch(()=>batch.forEach(r=>rowCovers.set(r.key,''))).finally(()=>batch.forEach(r=>coverPending.delete(r.key)));}
 }
 function matches(r){return phase==='all'||phaseOf(r)===phase;}
 function setup(){
  const page=$r('#page-reverse'),card=page?.querySelector(':scope>.card');if(!card||ready)return;ready=true;
  card.classList.add('ef-reverse-workspace');
  const title=card.querySelector('.title-row'),kicker=document.createElement('small');kicker.className='rp-kicker';kicker.textContent='// 本地档案 / 哈希识别';title.prepend(kicker);
  const controls=card.querySelector('.rp-controls'),tools=card.querySelector('.rp-tools'),wrap=card.querySelector('.rp-wrap');
  const tabs=document.createElement('div');tabs.id='rpPhaseTabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','反查状态');
  tabs.innerHTML=[['all','全部'],['wait','待反查'],['run','进行中'],['ok','已匹配'],['err','未匹配']].map(([id,name])=>'<button type="button" role="tab" aria-selected="'+(id==='all')+'" tabindex="'+(id==='all'?0:-1)+'" data-rp-phase="'+id+'"><span class="rp-tab-glyph" aria-hidden="true">'+(id==='all'?'ALL':missionMarkup({status:{wait:'待反查',run:'反查中',ok:'成功',err:'失败'}[id]},'rp-tab-mission'))+'</span><b>'+name+'</b><small>0</small></button>').join('');controls.after(tabs);
  const split=document.createElement('div');split.className='rp-split';split.innerHTML='<section class="rp-queue" aria-label="反查列表"><header class="rp-queue-heading"><h3>反查列表 <small id="rpQueueCount">0</small></h3><label id="rpAllLabel">全选</label></header></section><section id="rpInspector" aria-label="当前模型信息"><div class="rp-inspector-empty"><span>'+_icon('search')+'</span><h3>选择一项反查记录</h3><p>模型信息会在这里展开。只读取本地信息，不会自动发起反查。</p></div></section>';
  card.append(split);const queue=split.querySelector('.rp-queue');queue.append(tools,wrap);$r('#rpAllLabel').prepend($r('#rpSelectAll'));
  tools.append($r('#rpSelectedCount'));$r('#rpFilter').placeholder='搜索文件名、模型或状态…';$r('#rpFilter').setAttribute('aria-label','搜索反查列表');
  tabs.addEventListener('click',e=>{const button=e.target.closest('[data-rp-phase]');if(!button)return;phase=button.dataset.rpPhase;rpRefresh();});
  tabs.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...tabs.children],n=buttons.indexOf(e.target.closest('button')),i=e.key==='Home'?0:e.key==='End'?buttons.length-1:(n+(e.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;buttons[i].focus();buttons[i].click();});
  $r('#rpFilterClear').addEventListener('click',()=>{phase='all';rpRefresh();});
  wrap.addEventListener('scroll',queueCovers,{passive:true});
  wrap.addEventListener('click',e=>{const row=e.target.closest('tr[data-path]');if(row)preview(row.dataset.path);},true);
  wrap.addEventListener('keydown',async e=>{const row=e.target.closest('tr[data-path]');if(!row||e.target!==row)return;const list=[...wrap.querySelectorAll('tr[data-path]')],i=list.indexOf(row);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=list[e.key==='Home'?0:e.key==='End'?list.length-1:Math.max(0,Math.min(list.length-1,i+(e.key==='ArrowUp'?-1:1)))];next?.focus();if(next)preview(next.dataset.path);}else if([' ','Enter'].includes(e.key)){e.preventDefault();row.click();await rpRefresh();[...wrap.querySelectorAll('tr[data-path]')].find(r=>r.dataset.path===row.dataset.path)?.focus();}});
  new MutationObserver(()=>{if(page.classList.contains('active'))sync(state.rpRows||[],rpShown);}).observe(page,{attributes:true,attributeFilter:['class']});
  sync(state.rpRows||[],rpShown);
 }
 function sync(rows,shown){
  if(!ready)return;const counts={all:rows.length,wait:0,run:0,ok:0,err:0};rows.forEach(r=>counts[phaseOf(r)]++);
  for(const b of $r('#rpPhaseTabs').children){const on=b.dataset.rpPhase===phase;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1;b.querySelector('small').textContent=counts[b.dataset.rpPhase];}
  text('#rpQueueCount',shown.length+' / '+rows.length);
  for(const row of $r('#rpTable tbody').querySelectorAll('tr[data-path]')){const data=shown.find(r=>r.path===row.dataset.path);row.tabIndex=0;row.dataset.rpStatus=phaseOf(data);row.setAttribute('aria-label',base(data.path)+' · '+(data.status||'待反查'));row.setAttribute('aria-selected',String(rpChecked.has(data.path)));row.classList.toggle('rp-current',row.dataset.path===activePath);const cell=row.querySelector('.c-file');if(!cell.querySelector('.rp-mission-mark'))cell.insertAdjacentHTML('afterbegin',missionMarkup(data,'rp-list-mission'));cell.querySelector('.rp-mission-mark').dataset.missionState=missionState(data);row.cells[3].classList.add('rp-status-cell');}
  const currentNodes=new Set($r('#rpTable tbody').querySelectorAll('tr[data-path]'));for(const row of observed)if(!currentNodes.has(row)){visibleRows.unobserve(row);observed.delete(row);}for(const row of currentNodes)if(!observed.has(row)){visibleRows.observe(row);observed.add(row);}queueCovers();
  if(!shown.some(r=>r.path===activePath)){activePath=shown[0]?.path||'';loadedKey='';requestId++;}
  $r('#rpInspector').hidden=false;
  if(!activePath){loadedKey='';detail=null;$r('#rpInspector').innerHTML='<div class="rp-inspector-empty"><span>'+_icon('search')+'</span><h3>'+(rows.length?'没有符合筛选的记录':'从本地模型开始反查')+'</h3><p>'+(rows.length?'切换状态分类或清除筛选，查看其他记录。':'在模型管理中选择模型，再通过「信息处理 → 识别模型信息」加入列表。')+'</p></div>';return;}
  $r('#rpTable tbody tr[data-path]')&&[...$r('#rpTable tbody').children].forEach(r=>r.classList.toggle('rp-current',r.dataset.path===activePath));
  if($r('#page-reverse').classList.contains('active'))load(shown.find(r=>r.path===activePath));
 }
 function preview(path){if(activePath!==path||loadFailed){activePath=path;loadedKey='';requestId++;}sync(state.rpRows||[],rpShown);}
 function plain(value){const doc=new DOMParser().parseFromString(String(value||''),'text/html');doc.querySelectorAll('script,style,iframe,object').forEach(e=>e.remove());doc.querySelectorAll('br').forEach(e=>e.replaceWith('\n'));doc.querySelectorAll('p,div,li').forEach(e=>e.append('\n'));return doc.body.textContent.trim();}
 async function load(row){
  if(!row)return;const key=JSON.stringify([row.path,row.status,row.model,row.version,row.sha]);if(key===loadedKey)return;loadedKey=key;loadFailed=false;const serial=++requestId;detail=null;render(row,null,true);
  try{const result=await api.call('get_model_detail',row.path),data=typeof result==='string'?JSON.parse(result):result;if(serial!==requestId||row.path!==activePath)return;if(!data?.ok)throw Error(data?.msg||'本地模型信息暂不可读取');detail=data;render(row,data,false);
   if(!(data.covers||[]).some(c=>c.b64)){const value=await Promise.resolve(api.call('get_covers',[row.path],480)).catch(()=>null);const covers=typeof value==='string'?JSON.parse(value):value;if(serial===requestId&&covers?.[row.path]){detail.covers=[{b64:covers[row.path]}];render(row,detail,false);}}
  }catch(error){if(serial!==requestId)return;loadFailed=true;render(row,null,false,error.message||'本地信息读取失败');}
 }
 function render(row,data,loading,error=''){
  const info=data?.info||{},local=(state.models||[]).find(r=>r.path===row.path)||{},ok=phaseOf(row)==='ok',name=ok?(info.name||row.model||base(row.path)):(local.civitai_name||base(row.path));
  const version=typeof info.version==='object'?info.version?.name:info.version,author=typeof info.creator==='object'?info.creator?.username:info.creator,type=info.type||local.type||'待识别',modelBase=info.baseModel||local.base||'—';
  const words=info.trainedWords||local.trainedWords||[],triggers=Array.isArray(words)?words:String(words).split(',').filter(Boolean),description=plain(info.description||'');
  const covers=(data?.covers||[]).filter(c=>c.b64),src=covers[0]?'data:image/jpeg;base64,'+covers[0].b64:'',mid=info.modelId||local.modelId||info.model?.id||'',url=/^[1-9]\d*$/.test(String(mid))?'https://'+(['civitai.red','civitai.com'].includes(state.cfg.site_domain)?state.cfg.site_domain:'civitai.red')+'/models/'+mid:'';
  const hash=String(info.sha256||row.sha||''),size=Number(data?.size||local.size)||0;
  const panel=$r('#rpInspector');panel.setAttribute('aria-busy',loading);panel.innerHTML='<header class="rp-dossier-heading"><small>MODEL DOSSIER / 模型信息</small><h2>'+esc(name)+'</h2><div class="rp-dossier-status" data-status="'+phaseOf(row)+'">'+missionMarkup(row,'rp-status-mission')+'<strong>'+esc(row.status||'待反查')+'</strong><span>'+esc(loading?'正在读取本地信息…':error||(!ok&&row.model?row.model:'本地信息与识别结果'))+'</span></div></header><div class="rp-dossier-scroll"><div class="rp-dossier-hero"><dl class="rp-dossier-facts">'+[['模型类型',type],['基础模型',modelBase],['版本',version||row.version||'—'],['作者',author||local.author||'—'],['文件大小',size?fmtSize(size):'—']].map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl><div class="rp-cover'+(!src?' rp-cover-empty':'')+'">'+(src?'<img src="'+esc(src)+'" alt="'+esc(name)+'的本地封面"/>':'<span>'+_icon('file')+'</span><small>'+esc(loading?'读取封面…':'暂无本地封面')+'</small>')+'</div></div><section class="rp-dossier-section"><h3>'+_icon('tag')+'触发词 <small>点击复制 · 保留原文</small></h3><div id="rpTriggerWords">'+(triggers.length?triggers.map(w=>'<button type="button" class="rp-trigger" data-copy-word="'+esc(w)+'">'+esc(w)+_icon('copy')+'</button>').join(''):'<p class="rp-muted">'+(loading?'正在读取…':'没有可用的触发词')+'</p>')+'</div></section><section class="rp-dossier-section"><h3>'+_icon('file')+'模型简介</h3><p class="rp-description">'+esc(description||(loading?'正在读取本地模型简介…':ok?'本地信息中没有简介。':'完成反查后，这里会显示匹配到的模型简介、触发词与封面。'))+'</p></section><section class="rp-dossier-section rp-file-facts"><h3>本地文件</h3><p>'+esc(row.path)+'</p><small>'+esc(hash?'SHA256'+(hash.includes('…')?'（缩略）':'')+' · '+hash:'SHA256 · 尚未计算')+'</small></section></div><footer class="rp-dossier-actions"><span>'+esc(loading?'只读取本地缓存，不自动访问 C站':error?'本地信息读取失败，可重新选择记录重试':'点击列表可多选；查看信息不更改模型文件')+'</span><div><button type="button" class="btn" id="rpInspectFolder">打开目录</button><button type="button" class="btn" id="rpInspectSite"'+(!url?' disabled':'')+'>打开 C站</button></div></footer>';
  panel.querySelector('#rpInspectFolder').onclick=()=>api.call('open_folder',String(row.path).replace(/[\\/][^\\/]*$/,''));
  panel.querySelector('#rpInspectSite').onclick=()=>{if(url)api.call('open_url',url);};
  panel.querySelectorAll('[data-copy-word]').forEach(b=>b.onclick=async()=>{const done=await window.__copyText(b.dataset.copyWord);setStatus(done?'触发词已复制':'复制失败');});
 }
 window.CFTReverse={matches,sync,preview};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
