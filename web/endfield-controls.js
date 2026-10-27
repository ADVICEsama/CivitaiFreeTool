/* Theme-only control presentation. Existing inputs, handlers and action IDs stay authoritative. */
(()=>{'use strict';
 const root=document.documentElement;
 const active=()=>['dark_endfield','light_endfield'].includes(root.dataset.theme);
 const footerSelector='#settingsActions > button,.font-picker-footer > button,.font-action-base > button,.about-action-base > button,.rd-actions > button,.settings-exit-base > button,.ms-footer > button,.ob-actions > button,.ob-actions2 > button,.upd-footer > button,.model-style-actions > button';
 const actionSelector='button.btn:not(.nav-tab):not(.settings-tab):not(.mm-seg-btn):not(.ef-transfer-bookmark):not(.font-scope-tab):not(.shortcut-key):not(.font-reset):not(.font-close):not(.sidebar-toggle):not(.ef-model-tool-button):not([role=tab]),button.dest-picker';
 let iconSerial=0;
 const paths={update:'M2 2h14.5v4H6v5H2Z M13.5 0 22 4l-8.5 4.5Z M22 22H7.5v-4H18v-5h4Z M10.5 24 2 20l8.5-4.5Z',stop:'M6 6h12v12H6Z',scan:'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M6 12h12',pin:'M8 3h8l-1 6 4 4v2H5v-2l4-4ZM12 15v7',pencil:'m4 16 12-12 4 4L8 20H4ZM13 7l4 4',shield:'m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6Zm-4 9 3 3 5-6',settings:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',sort:'M4 5h11M4 11h8M4 17h5M18 3v18m-4-4 4 4 4-4',layers:'m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 16l9 5 9-5',up:'m5 14 7-7 7 7',down:'m5 10 7 7 7-7',monitor:'M3 4h18v13H3ZM12 17v4M7 21h10',copy:'M8 3h12v15H8ZM4 7v15h12',play:'M8 5v14l12-7Z',pause:'M8 5v14M16 5v14',plus:'M12 4v16M4 12h16',trash:'M4 6h16M9 3h6M7 6v15h10V6M10 9v9M14 9v9',clock:'M12 6v7l5 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',download:'M12 3v13M6 10l6 6 6-6M4 16v5h16v-5',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6',external:'M13 3h8v8M21 3 10 14M10 5H3v16h16v-7',list:'M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1',check:'m6 12 4 4 8-9',x:'m7 7 10 10M17 7 7 17',refresh:'M19 8a8 8 0 1 0 1 7M19 3v6h-6',left:'m14 5-7 7 7 7',right:'m10 5 7 7-7 7',info:'M12 10v7M12 6v1',globe:'M3 12h18M12 3c-5 6-5 12 0 18M12 3c5 6 5 12 0 18M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',file:'M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6',folder:'M3 6h7l2 3h9v11H3Z'};
 function iconFor(button){const action=({mmScan:'scan',mmRefresh:'refresh',mmCheckUpd:'refresh',mmUpdDl:'download',mmRenameMain:'pencil',mmOrganizeMenu:'folder',mmCheckMenu:'shield',mmInfoMenu:'file',mmMoreMenu:'list',mmRenameMenu:'down',mmUpdOnly:'refresh'})[button.dataset.proxy||button.dataset.menu||button.id];if(action)return action;const explicit={rpStart:'play',rpStartSelected:'play',rpPause:button.textContent.includes('继续')?'play':'pause',rpStop:'stop',rpTutorial:'info',rpRemoveSel:'trash',rpClearAll:'trash',rpFilterClear:'x',rpInspectFolder:'folder',rpInspectSite:'external',rpInspectDetails:'info',wfMapDirectory:'list',updSync:'refresh',updCheck:'update',updDlSel:'download',updWl:'list',ivSave:'download',ivShare:'copy',ivSite:'external',ivPreviewSave:'download',ivExport:'file',mmCardStyles:'settings',mmToolbarLock:'pin',mmSortDir:'sort',fontUp:'up',fontDown:'down',settingsStay:'left',settingsDiscard:'x',settingsSaveLeave:'check',performanceKeep:'left',performanceApply:'check',aboutGithub:'right',aboutOk:'check',dlStartSel:'play',btnParse:'right'}[button.id];if(explicit)return explicit;
 if(button.matches('.upd-go'))return 'download';
 if(button.matches('.dest-picker,[data-history-open],[data-history-save],#btnDlTarget,#fpBrowse'))return 'folder';
 if(button.matches('[data-history-site]'))return 'external';if(button.matches('[data-history-info]'))return 'info';if(button.id==='dlShowHud')return 'monitor';if(button.id==='btnPaste')return 'copy';if(button.id==='fpReset')return 'refresh';
 const original=button.querySelector(':scope>.ic use')?.getAttribute('href')?.replace('#i-','');if(paths[original])return original;if(original==='chevron-down')return 'down';const text=button.textContent.trim()||button.getAttribute('aria-label')||button.title||button.dataset.tip||'';if(/开始|继续/.test(text))return 'play';if(/暂停/.test(text))return 'pause';if(/下载/.test(text))return 'download';if(/移除|清空|删除/.test(text))return 'trash';if(/添加|新建/.test(text))return 'plus';if(/剪贴板|复制/.test(text))return 'copy';if(/模型信息|详情/.test(text))return 'info';if(/打开.*站|浏览器|网页/.test(text))return 'external';if(/保存到/.test(text))return 'folder';if(/取消|关闭|稍后|不保存|不移动/.test(text))return 'x';if(/恢复|重置|重试|刷新/.test(text))return 'refresh';if(/上一步|上一页|返回/.test(text))return 'left';if(/下一步|下一页|前往|去下载/.test(text))return 'right';if(/测试.*API/.test(text))return 'globe';if(/翻译/.test(text))return 'file';if(/文件夹|目录/.test(text))return 'folder';if(/引导|知道|帮助/.test(text))return 'info';return 'check';}
 function footerButton(button,compact=false){
  if(compact)button.classList.add('ef-pill-action');
  if(!button.textContent.trim()&&!button.getAttribute('aria-label'))button.setAttribute('aria-label',button.title||button.dataset.tip||'操作');
  const name=iconFor(button);
  const primary=button.matches('.btn-primary,#btnSaveSettings');
  button.classList.toggle('ef-action-primary',primary);
  button.classList.toggle('ef-action-secondary',!primary);
  if(button.querySelector(':scope>.ef-action-circle'))return;
  const caption=document.createElement('span');caption.className='ef-action-caption';
  // Remove only app-owned icon decoration; keep text and other meaningful label nodes.
  button.querySelectorAll(':scope>.ic,:scope>.emj').forEach(el=>el.remove());
  while(button.firstChild)caption.append(button.firstChild);
  const circle=document.createElement('span');circle.className='ef-action-circle';circle.setAttribute('aria-hidden','true');
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');
  // Punch the glyph out of a filled disc. The actual button texture shows through the cutout.
  const id='efActionCutout-'+(++iconSerial),defs=document.createElementNS(ns,'defs'),mask=document.createElementNS(ns,'mask');mask.id=id;mask.setAttribute('maskUnits','userSpaceOnUse');mask.setAttribute('x','0');mask.setAttribute('y','0');mask.setAttribute('width','24');mask.setAttribute('height','24');
  const paper=document.createElementNS(ns,'rect');paper.setAttribute('width','24');paper.setAttribute('height','24');paper.setAttribute('fill','white');
  const path=document.createElementNS(ns,'path');path.setAttribute('d',paths[name]);path.setAttribute('fill','none');path.setAttribute('stroke','black');path.setAttribute('stroke-width','3.2');path.setAttribute('stroke-linecap','butt');path.setAttribute('stroke-linejoin','miter');if(compact)path.setAttribute('transform','translate(12 12) scale(.64) translate(-12 -12)');else if(['globe','file','folder','info','refresh','monitor'].includes(name))path.setAttribute('transform','translate(12 12) scale(.76) translate(-12 -12)');else if(name==='check')path.setAttribute('transform','translate(0 .5)');if(name==='update'){path.setAttribute('fill','black');path.setAttribute('stroke','none');}mask.append(paper,path);defs.append(mask);
  const disc=document.createElementNS(ns,'circle');disc.setAttribute('cx','12');disc.setAttribute('cy','12');disc.setAttribute('r','11.5');disc.setAttribute('fill','currentColor');disc.setAttribute('mask','url(#'+id+')');svg.append(defs,disc);circle.append(svg);
  const texture=document.createElement('span');texture.className='ef-action-texture';texture.setAttribute('aria-hidden','true');
  const stem=document.createElement('span');stem.className='ef-action-stem';stem.setAttribute('aria-hidden','true');stem.innerHTML='<svg viewBox="0 0 40 8"><path d="M3 4h34"/><circle cx="3" cy="4" r="1.5"/><circle cx="37" cy="4" r="1.5"/></svg>';
  button.classList.add('ef-footer-action');button.append(texture,stem,caption,circle);

 }
 function numberControl(input){
  if(input.closest('.ef-number-stepper')||input.hidden||input.readOnly)return;
  const wrap=document.createElement('span');wrap.className='ef-number-stepper';input.before(wrap);
  const label=input.getAttribute('aria-label')||input.id||'数值';
  const create=(direction)=>{const button=document.createElement('button');button.type='button';button.className='ef-number-step '+(direction<0?'minus':'plus');button.setAttribute('aria-label',(direction<0?'减少':'增加')+label);button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h20'+(direction>0?'M12 2v20':'')+'"/></svg>';button.addEventListener('click',()=>{if(input.disabled||input.readOnly)return;const before=input.value;if(!input.value)input.value=input.dataset.default||input.min||'0';try{direction>0?input.stepUp():input.stepDown();}catch{return;}if(input.value!==before){input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}syncNumber(input);});return button;};
  wrap.append(create(-1),input,create(1));syncNumber(input);
 }
 function syncNumber(input){const wrap=input.closest('.ef-number-stepper');if(!wrap)return;const value=input.valueAsNumber,low=input.min===''?-Infinity:Number(input.min),high=input.max===''?Infinity:Number(input.max);wrap.querySelector('.minus').disabled=input.disabled||input.readOnly||Number.isFinite(value)&&value<=low;wrap.querySelector('.plus').disabled=input.disabled||input.readOnly||Number.isFinite(value)&&value>=high;}
 function refresh(){
  if(active()){
   document.querySelectorAll(footerSelector).forEach(button=>footerButton(button));
   document.querySelectorAll(actionSelector).forEach(button=>{if(!button.matches(footerSelector))footerButton(button,true);});
   document.querySelectorAll('input[type=number]').forEach(numberControl);
   document.querySelectorAll('.ef-number-stepper input').forEach(syncNumber);
  }else{
   document.querySelectorAll('.ef-number-stepper').forEach(wrap=>{const input=wrap.querySelector('input');wrap.before(input);wrap.remove();});
   document.querySelectorAll('.ef-footer-action').forEach(button=>{button.querySelectorAll('.ef-action-circle,.ef-action-stem,.ef-action-texture').forEach(el=>el.remove());const label=button.querySelector('.ef-action-caption');if(label)label.replaceWith(...label.childNodes);button.classList.remove('ef-footer-action','ef-pill-action','ef-action-primary','ef-action-secondary');});
   if(typeof decorateWorkbenchIcons==='function')decorateWorkbenchIcons();
  }
 }
 let queued=false;function queue(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;refresh();});}
 new MutationObserver(queue).observe(document.body,{subtree:true,childList:true});
 new MutationObserver(queue).observe(root,{attributes:true,attributeFilter:['data-theme']});
 document.addEventListener('input',e=>{if(e.target.matches('input[type=number]'))syncNumber(e.target);});
 document.addEventListener('change',e=>{if(e.target.matches('input[type=number]'))queueMicrotask(()=>syncNumber(e.target));});
 window.CFTEndfieldControls={refresh};refresh();
})();

