/* Unified download workspace; all actions still use the original controls and task IDs. */
(()=>{'use strict';
 const root=document.documentElement,add=document.querySelector('#page-download'),manager=document.querySelector('#page-dlmanager'),queue=document.querySelector('#dlQueuePanel'),table=document.querySelector('#dlTable'),urls=document.querySelector('#urlRows');
 if(!add||!manager||!queue||!table||!urls)return;
 const active=()=>root.dataset.endfield==='true',reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const symbols={add:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM16 13h3v3h3v3h-3v3h-3v-3h-3v-3h3Z',queue:'M2 3h4v4H2zM9 3h13v4H9zM2 10h4v4H2zM9 10h13v4H9zM2 17h4v4H2zM9 17h13v4H9Z',history:'M4 2h13l5 5v15H4Zm4 4v12h10V9h-4V6Zm3 4h3v3h3v3h-6Z'};
 const icon=id=>'<svg class="ic ef-transfer-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="'+symbols[id]+'" fill="currentColor"/></svg>';
 for(const [page,code] of [[add,'01 / ACQUISITION'],[manager,'02 / TRANSFER']]){
  const card=page.querySelector(':scope>.card'),title=card.querySelector('.page-title'),head=document.createElement('header');head.className='ef-transfer-head';
  const kicker=document.createElement('span');kicker.className='ef-transfer-kicker';kicker.textContent='// 模型资源 / 下载工作台';
  const badge=document.createElement('span');badge.className='ef-transfer-code';badge.textContent=code;title.before(head);head.append(kicker,title,badge);
 }
 const tabs=document.createElement('div');tabs.className='ef-transfer-tabs';tabs.setAttribute('aria-label','下载工作台');
 tabs.innerHTML='<button type="button" class="btn active ef-transfer-bookmark" aria-current="page">'+icon('add')+'<span>添加下载<small>ACQUISITION</small></span></button><button type="button" class="btn ef-transfer-bookmark" data-transfer-view="queue">'+icon('queue')+'<span>任务列表<small>TRANSFER QUEUE</small></span></button><button type="button" class="btn ef-transfer-bookmark" data-transfer-view="history">'+icon('history')+'<span>下载历史<small>ARCHIVE</small></span></button>';
 add.querySelector('.ef-transfer-head').after(tabs);
 for(const b of tabs.querySelectorAll('button'))b.setAttribute('aria-label',b.querySelector('span')?.childNodes[0]?.textContent||'添加下载');
 const newTask=document.createElement('button');newTask.type='button';newTask.className='btn ef-transfer-bookmark';newTask.innerHTML=icon('add')+'<span>添加下载<small>ACQUISITION</small></span>';newTask.dataset.transferView='add';newTask.setAttribute('aria-label','添加下载');manager.querySelector('.download-tabs').prepend(newTask);
 for(const [id,symbol,label,code] of [['dlQueueTab','queue','任务列表','TRANSFER QUEUE'],['dlHistoryTab','history','下载历史','ARCHIVE']]){const b=document.getElementById(id);b.classList.add('ef-transfer-bookmark');b.setAttribute('aria-label',label);b.innerHTML=icon(symbol)+'<span>'+label+'<small>'+code+'</small></span>';}
 document.addEventListener('click',e=>{const b=e.target.closest('[data-transfer-view]');if(!b||!active())return;const view=b.dataset.transferView;if(view==='add'){switchPage('download');return;}switchPage('dlmanager');document.querySelector(view==='history'?'#dlHistoryTab':'#dlQueueTab').click();});
 // Primary acquisition actions are always visible; there is no duplicate add-row button or menu.
 const acquireActions=add.querySelector('#btnParse').parentElement;acquireActions.classList.add('ef-transfer-footer');
 const acquirePrimary=document.createElement('div');acquirePrimary.className='rd-actions ef-transfer-primary';acquireActions.append(acquirePrimary);acquirePrimary.append(document.querySelector('#btnParse'));
 const queueActions=document.querySelector('#dlQueueActions');queueActions.classList.add('ef-transfer-toolbar');queueActions.setAttribute('aria-label','选中下载任务的操作');
 const selectionHint=document.createElement('span');selectionHint.className='ef-transfer-selection-hint';selectionHint.textContent='点击任务选择，可多选 · 右键快捷操作';queueActions.append(selectionHint);
 const utilities=document.createElement('footer');utilities.id='dlQueueUtilities';utilities.className='ef-transfer-footer';utilities.innerHTML='<span class="ef-transfer-note">完成后自动归档 · 任务按点击切换选择，拖动左侧手柄排序</span><div class="ef-transfer-actions-main"></div>';queue.append(utilities);utilities.lastElementChild.append(document.querySelector('#dlShowHud'));
 const inputHead=document.createElement('div');inputHead.className='ef-url-heading';inputHead.setAttribute('aria-hidden','true');inputHead.innerHTML='<span>序号</span><span>模型链接 / 一行一条</span><span>操作</span>';urls.before(inputHead);
 const workspace=document.createElement('div');workspace.className='ef-acquisition-workspace';const editor=document.createElement('section');editor.className='ef-acquisition-editor';editor.setAttribute('aria-label','添加模型链接');const art=document.createElement('aside');art.className='ef-acquisition-art';art.setAttribute('aria-hidden','true');art.innerHTML='<span class="ef-acquisition-art-code">CFT / ACQUISITION</span><img src="about-wordmark.svg" alt=""><svg viewBox="0 0 240 240"><path d="m120 14 94 54v108l-94 54-94-54V68Zm0 0v108m94-54-94 54-94-54m94 54v108M64 166l56 32 56-32M64 139l56 32 56-32"/><path class="ef-acquisition-arrow" d="M95 66h50v55h28l-53 57-53-57h28Z"/></svg><span>MODEL RESOURCE TERMINAL<br>模型、元数据与封面，一并归档。</span>';
 add.querySelector('.ef-transfer-tabs').after(workspace);workspace.append(editor,art);
 for(const el of [add.querySelector('.hint'),document.querySelector('#dlTargetRow'),inputHead,urls,document.querySelector('#parseLog')])editor.append(el);
 const empty=document.createElement('div');empty.className='ef-transfer-empty';empty.innerHTML=icon('queue')+'<h3>当前没有进行中的下载</h3><p>已完成的模型会按日期与批次保存在下载历史中。</p><button class="btn" type="button" data-transfer-view="add">添加模型链接</button>';table.parentElement.after(empty);
 const info=document.querySelector('#dlInfo');info.classList.add('ef-transfer-selection');table.querySelector('thead .c-file').childNodes[0].textContent='模型信息';table.querySelector('thead .c-dest').childNodes[0].textContent='保存位置';
 const records=new Map(),collapsedGroups=new Set();let pending=0;
 const completionTiming={blue:650,gold:900,check:780,hold:220,leave:420};
 const staged=['flood','gold','check','hold','leaving','archiving'];
 const done=t=>t.status==='done'&&!t.hash_mismatch&&t.verification_status!=='mismatch';
 function refreshViews(){if(typeof dlRefresh==='function')dlRefresh();if(typeof refreshDownloadHistory==='function')refreshDownloadHistory();}
 function cancelTimers(r){for(const id of r.timers||[])clearTimeout(id);r.timers=[];}
 async function archive(id,r){
  if(records.get(id)!==r||r.status!=='done'||r.requested)return;r.requested=true;r.phase='archiving';refreshViews();
  try{const result=await api.call('archive_download_task',id);if(records.get(id)!==r||r.status!=='done')return;if(!result?.ok)throw Error(result?.msg||'自动归档失败');r.phase='archived';}
  catch(e){if(records.get(id)===r){r.phase='archive-error';r.error=String(e.message||e);setStatus('自动归档未完成，任务仍在列表中，可手动移入历史。');}}
  refreshViews();
 }
 function enterGold(id,r,animate){
  r.phase=animate?'flood':'archiving';r.timers=[];
  if(!animate){r.timers.push(setTimeout(()=>archive(id,r),0));return;}
  const after=(delay,fn)=>r.timers.push(setTimeout(()=>{if(records.get(id)===r&&r.status==='done')fn();},delay));
  const phase=(name)=>{r.phase=name;if(name==='gold')r.goldAt=performance.now();if(name==='check')r.checkAt=performance.now();if(name==='leaving')r.leaveAt=performance.now();schedule();refreshViews();};
  // Clear beats: full blue -> gold settles -> draw the open arc and check -> hold -> slide.
  after(completionTiming.blue,()=>{phase('gold');after(completionTiming.gold,()=>{phase('check');after(completionTiming.check,()=>{phase('hold');after(completionTiming.hold,()=>{phase('leaving');after(completionTiming.leave,()=>archive(id,r));});});});});
 }
 function resultMark(row){
  if(row.querySelector(':scope>.ef-transfer-result'))return;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('ef-transfer-result');svg.setAttribute('viewBox','0 0 80 80');svg.setAttribute('aria-hidden','true');
  for(const [name,d] of [['arc','M62 15A33 33 0 1 0 72 49'],['tick','M20 43l14 14 39-39']]){const path=document.createElementNS(ns,'path');path.classList.add('ef-result-'+name);path.setAttribute('d',d);path.setAttribute('pathLength','1');svg.append(path);}row.append(svg);
 }

 function prepareTasks(tasks){
  if(!active())return tasks;const ids=new Set(tasks.map(t=>t.id));
  for(const t of tasks){let r=records.get(t.id);const previous=r?.status;if(!r){r={status:t.status,phase:'active',timers:[]};records.set(t.id,r);}
   if(!done(t)){if(r.phase!=='active'){cancelTimers(r);r.phase='active';r.requested=false;}r.status=t.status;continue;}
   r.status='done';if(r.phase==='active')enterGold(t.id,r,previous!==undefined&&previous!=='done'&&!reduced.matches&&!document.hidden&&manager.classList.contains('active')&&!queue.hidden);
  }
  if(records.size>1500)for(const [id,r] of records)if(!ids.has(id)&&r.phase==='archived'){cancelTimers(r);records.delete(id);}
  return tasks.filter(t=>!['archiving','archived'].includes(records.get(t.id)?.phase));
 }
 const groupKey=row=>{const raw=Number(row.batch_started_at||row.created_at||row.finished_at),valid=Number.isFinite(raw)&&raw>0,date=valid?new Date(raw*1000):null;const day=date?date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0'):'时间未记录';return {timestamp:valid?raw:0,key:day+'|'+(row.batch_id||'legacy'),day,time:date?date.toLocaleTimeString('zh-CN',{hour12:false}):'',timeLabel:row.batch_started_at?'提交于':row.created_at?'创建于':'结束于',known:!!row.batch_id};};
 window.CFTDownloadPresentation={prepareTasks,completionTiming,includeHistory:row=>!staged.includes(records.get(row.id)?.phase),groupKey,isGroupCollapsed:key=>collapsedGroups.has(key),groupSignature:()=>[...collapsedGroups].join('|')};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const [id,r] of records)if(staged.includes(r.phase)&&r.phase!=='archiving'){cancelTimers(r);archive(id,r);}});
 reduced.addEventListener('change',()=>{if(reduced.matches)for(const [id,r] of records)if(staged.includes(r.phase)&&r.phase!=='archiving'){cancelTimers(r);archive(id,r);}});
 function setText(el,text){if(el.textContent!==text)el.textContent=text;}
 function decorateUrls(){[...urls.children].forEach((row,i)=>{let number=row.querySelector('.ef-url-order');if(!number){number=document.createElement('span');number.className='ef-url-order';number.setAttribute('aria-hidden','true');row.prepend(number);}setText(number,String(i+1).padStart(2,'0'));row.querySelector('input').setAttribute('aria-label','下载链接 '+(i+1));row.querySelectorAll('.icon-btn').forEach((button,j)=>button.setAttribute('aria-label',j?'删除下载链接 '+(i+1):'新建下载链接'));});}

 function update(){pending=0;if(!active())return;decorateUrls();const rows=[...table.querySelectorAll('tbody tr[data-task-id]')],selected=rows.filter(r=>r.classList.contains('sel-row')).length;setText(manager.querySelector('.ef-transfer-code'),String(rows.length).padStart(2,'0')+' TASKS / TRANSFER');setText(add.querySelector('.ef-transfer-code'),String([...urls.querySelectorAll('input')].filter(e=>e.value.trim()).length).padStart(2,'0')+' LINKS / ACQUISITION');empty.hidden=rows.length>0;info.dataset.selected=selected;syncDlSelection();
  for(const row of rows){
   if(!row.querySelector(':scope>.ef-transfer-material')){const material=document.createElement('span');material.className='ef-transfer-material';material.setAttribute('aria-hidden','true');row.append(material);}
   const labels=['选择 / 排序','封面','模型 / 文件','保存位置','状态','进度','速度','传输大小','错误'];[...row.children].slice(0,9).forEach((cell,i)=>cell.dataset.label=labels[i]);
   row.dataset.efProgress=String(parseFloat(row.style.getPropertyValue('--ef-progress'))||0);const r=records.get(row.dataset.taskId),phase=r?.phase||'active',gold=['gold','check','hold','leaving'].includes(phase),check=['check','hold','leaving'].includes(phase);
   if(gold&&row.dataset.presentationPhase!==phase)row.style.setProperty('--gold-delay',Math.min(0,r.goldAt-performance.now())+'ms');
   if(check){resultMark(row);if(!row.classList.contains('ef-transfer-check'))row.style.setProperty('--check-delay',Math.min(0,r.checkAt-performance.now())+'ms');}
   if(phase==='leaving'&&row.dataset.presentationPhase!==phase)row.style.setProperty('--leave-delay',Math.min(0,r.leaveAt-performance.now())+'ms');
   row.classList.toggle('ef-transfer-flood',phase==='flood');row.classList.toggle('ef-transfer-gold',gold);row.classList.toggle('ef-transfer-check',check);row.classList.toggle('ef-transfer-leaving',phase==='leaving');row.classList.toggle('ef-transfer-archive-error',phase==='archive-error');row.dataset.presentationPhase=phase;
  }
 }
 function schedule(){if(!pending)pending=requestAnimationFrame(update);}
 for(const node of [table.querySelector('tbody'),urls])new MutationObserver(schedule).observe(node,{childList:true,subtree:true,characterData:true});
 urls.addEventListener('input',schedule);table.addEventListener('change',schedule);table.addEventListener('click',schedule);new MutationObserver(schedule).observe(root,{attributes:true,attributeFilter:['data-endfield']});
 document.addEventListener('click',e=>{for(const menu of document.querySelectorAll('.ef-transfer-more[open]'))if(!menu.contains(e.target)||e.target.closest('.ef-transfer-menu>button'))menu.open=false;const batch=e.target.closest('[data-history-batch]');if(batch)toggleBatch(batch);const bookmark=e.target.closest('.ef-transfer-bookmark');if(bookmark)revealTransfer(bookmark);});

 const foldMotions=new Map();
 function toggleBatch(button){
  const key=button.dataset.historyBatch,collapse=!collapsedGroups.has(key);if(collapse)collapsedGroups.add(key);else collapsedGroups.delete(key);
  const previous=foldMotions.get(key);previous?.animations.forEach(a=>a.cancel());
  if(reduced.matches){renderDownloadHistory();return;}
  if(!collapse)renderDownloadHistory();
  const rows=[...document.querySelectorAll('#dlHistoryTable [data-history-id]')].filter(row=>row.dataset.historyGroup===key);
  const motion={animations:[]};foldMotions.set(key,motion);button.setAttribute('aria-expanded',String(!collapse));
  if(button.lastElementChild)button.lastElementChild.textContent=button.lastElementChild.textContent.replace(/[−+]$/,collapse?'+':'−');
  for(const row of rows){row.hidden=false;const css=getComputedStyle(row),height=row.getBoundingClientRect().height,full={height:height+'px',minHeight:height+'px',paddingTop:css.paddingTop,paddingBottom:css.paddingBottom,marginBottom:'0px',opacity:1},shut={height:'0px',minHeight:'0px',paddingTop:'0px',paddingBottom:'0px',marginBottom:'-9px',opacity:0};const a=row.animate(collapse?[full,shut]:[shut,full],{duration:210,easing:'cubic-bezier(.2,.75,.25,1)',fill:collapse?'forwards':'none'});a.id='ef-history-fold';motion.animations.push(a);}
  Promise.all(motion.animations.map(a=>a.finished.catch(()=>{}))).then(()=>{if(foldMotions.get(key)!==motion)return;foldMotions.delete(key);renderDownloadHistory();});
 }
 let viewMotions=[];
 reduced.addEventListener('change',()=>{if(!reduced.matches)return;for(const motion of foldMotions.values())motion.animations.forEach(a=>a.cancel());foldMotions.clear();viewMotions.forEach(a=>a.cancel());viewMotions=[];renderDownloadHistory();});
 function revealTransfer(bookmark){
  viewMotions.forEach(a=>a.cancel());viewMotions=[];if(!active()||reduced.matches)return;
  const panel=add.classList.contains('active')?workspace:queue.hidden?document.querySelector('#dlHistoryPanel'):queue;
  if(panel){const a=panel.animate([{opacity:.25,transform:'scale(.975)'},{opacity:1,transform:'scale(1)'}],{duration:210,easing:'cubic-bezier(.2,.75,.25,1)'});a.id='ef-transfer-view';viewMotions.push(a);}
  const a=bookmark.animate([{transform:'scale(.94)'},{transform:'scale(1.012)',offset:.72},{transform:'scale(1)'}],{duration:210,easing:'cubic-bezier(.2,.75,.25,1)'});a.id='ef-transfer-tab';viewMotions.push(a);
 }
 document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const menu of document.querySelectorAll('.ef-transfer-more[open]')){menu.open=false;menu.querySelector('summary').focus();}});schedule();
})();
