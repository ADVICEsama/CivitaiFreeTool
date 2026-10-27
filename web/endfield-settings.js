/* Theme-scoped accessible presentation; native selects still own values and change events. */
(()=>{'use strict';
 const root=document.documentElement,form=document.getElementById('settingsForm');let menu=null,owner=null,index=0;
 const active=()=>['light_endfield','dark_endfield'].includes(root.dataset.theme);
 function close(restore=false){if(!menu)return;const button=owner?.nextElementSibling;menu.remove();menu=null;owner=null;button?.setAttribute('aria-expanded','false');if(restore&&button?.isConnected)button.focus();}
 function position(){
  if(!menu||!owner)return;
  const r=owner.nextElementSibling.getBoundingClientRect(),zoom=Number(root.style.zoom)||1;
  const rowHeight=menu.firstElementChild?.getBoundingClientRect().height/zoom||48,count=owner.options.length;
  const below=(innerHeight-r.bottom-8)/zoom,above=(r.top-8)/zoom;
  const opensBelow=below>=Math.min(180,(count*rowHeight+9));
  const available=Math.max(0,opensBelow?below:above),padding=9,cap=Math.min(300,available);
  // Always show a half-row hint while more options exist; no fake hint at the true end.
  let height=count*rowHeight+padding;
  if(height>cap){const whole=Math.max(0,Math.floor((cap-padding)/rowHeight-.5));height=padding+(whole+.5)*rowHeight;}
  height=Math.min(height,available);
  const top=opensBelow?r.bottom-1:Math.max(8,r.top-height*zoom);
  Object.assign(menu.style,{left:Math.max(8,Math.min(r.left,innerWidth-r.width-8))/zoom+'px',top:top/zoom+'px',width:r.width/zoom+'px',paddingTop:opensBelow?'9px':'0',paddingBottom:opensBelow?'0':'9px',height:height+'px',maxHeight:height+'px'});
  menu.dataset.partial=String(count*rowHeight+padding>height+.5);
 }
 function highlight(){if(!menu)return;menu.querySelectorAll('[role=option]').forEach((el,i)=>el.classList.toggle('focused',i===index));menu.children[index]?.scrollIntoView({block:'nearest'});}
 function select(i){if(!owner||owner.options[i]?.disabled)return;const original=owner;original.value=original.options[i].value;close(true);original.dispatchEvent(new Event('change',{bubbles:true}));refresh();}
 function open(el){if(owner===el){close(true);return;}close();owner=el;menu=document.createElement('div');menu.className='ef-settings-select-menu';menu.id='efSettingsSelectMenu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',el.getAttribute('aria-label')||'选择设置');menu.tabIndex=-1;index=el.selectedIndex;
 [...el.options].forEach((o,i)=>{const item=document.createElement('div');item.setAttribute('role','option');item.setAttribute('aria-selected',String(o.selected));item.setAttribute('aria-disabled',String(o.disabled));item.textContent=o.textContent;if(o.selected){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','ef-select-check');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M6 12.5 10 17 18 6');svg.append(path);item.append(svg);}item.addEventListener('click',()=>select(i));menu.append(item);});document.body.append(menu);el.nextElementSibling.setAttribute('aria-expanded','true');position();menu.focus();menu.scrollTop=Math.min(Math.max(0,index*(menu.firstElementChild?.offsetHeight||48)-Math.floor(menu.clientHeight/(menu.firstElementChild?.offsetHeight||48)/2)*(menu.firstElementChild?.offsetHeight||48)),menu.scrollHeight-menu.clientHeight);
 menu.addEventListener('keydown',e=>{if(['Escape','Tab'].includes(e.key)){close(e.key==='Escape');if(e.key==='Escape')e.preventDefault();return;}if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='Enter'||e.key===' '){select(index);return;}index=e.key==='Home'?0:e.key==='End'?el.options.length-1:Math.max(0,Math.min(el.options.length-1,index+(e.key==='ArrowDown'?1:-1)));highlight();}});
 }
 function refreshKeys(){for(const button of form?.querySelectorAll('.shortcut-key')||[]){const names={ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Space:'␣',Delete:'DEL',Enter:'ENTER',Escape:'ESC',Control:'CTRL',Shift:'SHIFT',Alt:'ALT',Meta:'WIN'};button.dataset.keyDisplay=(button.value||'').split('+').map(key=>names[key]||key).join(' + ');}}
 let selectionNav=null,selectionLayer=null,selectionAnimation=null,selectionTarget=null,selectionResize=null,selectionObserver=null;
 function stopSelection(){selectionAnimation?.cancel();selectionAnimation=null;}
 function syncSelection(animate=false){
  const nav=selectionNav,layer=selectionLayer;if(!nav||!layer||!nav.isConnected)return;
  const tab=nav.querySelector('.settings-tab.active'),search=form.querySelector('#settingsSearch');
  if(!active()||search?.value.trim()||!tab||!nav.getClientRects().length){stopSelection();layer.hidden=true;selectionTarget=null;if(!active())nav.classList.remove('ef-selection-ready');return;}
  const zoom=Number(root.style.zoom)||1,n=nav.getBoundingClientRect(),r=tab.getBoundingClientRect();
  const target={x:(r.left-n.left)/zoom+nav.scrollLeft,y:(r.top-n.top)/zoom+nav.scrollTop,width:r.width/zoom,height:r.height/zoom};
  if(target.width<1||target.height<1)return;
  const unchanged=selectionTarget&&Object.keys(target).every(key=>Math.abs(target[key]-selectionTarget[key])<.2);
  if(unchanged&&animate&&!layer.hidden)return;
  const previous=selectionTarget,wasHidden=layer.hidden,from=getComputedStyle(layer).transform;
  stopSelection();selectionTarget=target;layer.hidden=false;nav.classList.add('ef-selection-ready');
  const to=`translate(${target.x}px,${target.y}px)`;
  Object.assign(layer.style,{width:target.width+'px',height:target.height+'px',transform:to});
  if(animate&&previous&&!wasHidden&&!reduced.matches&&Math.abs(previous.x-target.x)>.2){
   const motion=layer.animate([{transform:from==='none'?`translate(${previous.x}px,${previous.y}px)`:from},{transform:to}],{duration:130,easing:'cubic-bezier(.2,.8,.2,1)'});
   selectionAnimation=motion;motion.finished.then(()=>{if(selectionAnimation===motion)selectionAnimation=null;},()=>{});
  }
 }
 function attachSelection(nav){
  if(selectionNav===nav)return;
  stopSelection();selectionResize?.disconnect();selectionObserver?.disconnect();selectionLayer?.remove();selectionTarget=null;selectionNav=nav;
  selectionLayer=document.createElement('div');selectionLayer.className='ef-settings-selection';selectionLayer.hidden=true;selectionLayer.setAttribute('aria-hidden','true');nav.append(selectionLayer);
  selectionObserver=new MutationObserver(()=>syncSelection(true));selectionObserver.observe(nav,{subtree:true,attributes:true,attributeFilter:['aria-selected']});
  if(typeof ResizeObserver==='function'){selectionResize=new ResizeObserver(()=>syncSelection(false));selectionResize.observe(nav);}
  nav.addEventListener('scroll',()=>{if(selectionNav===nav)syncSelection(false);},{passive:true});
 }
 const categoryIcons={appearance:['M2 3h20v14H2z M9 18h6v2h4v2H5v-2h4z'],shortcuts:['M8 1h8v10H8z M0 13h7v10H0z M8 13h8v10H8z M17 13h7v10h-7z']};
 function refreshNavigation(animate=false){
  const nav=form?.querySelector('.settings-nav');if(!nav)return;
  nav.setAttribute('aria-orientation',active()?'horizontal':'vertical');
  for(const tab of nav.querySelectorAll('[data-settings-category]')){
   const label=tab.querySelector(':scope > span')?.textContent.trim();if(label){tab.title=label;tab.setAttribute('aria-label',label);}
   if(tab.querySelector('.ef-settings-symbol'))continue;
   const paths=categoryIcons[tab.dataset.settingsCategory];if(!paths)continue;
   tab.querySelector('svg')?.classList.add('ef-settings-original');
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','ic ef-settings-symbol');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
   for(const d of paths){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}tab.prepend(svg);
  }
  attachSelection(nav);syncSelection(animate);
 }
 function refresh(){if(!form)return;refreshNavigation();refreshKeys();
 for(const el of form.querySelectorAll('select[data-key]:not([hidden])')){if(!el.classList.contains('ef-select-native')){el.classList.add('ef-select-native');const button=document.createElement('button');button.type='button';button.className='ef-select-trigger';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','efSettingsSelectMenu');button.setAttribute('aria-label',el.getAttribute('aria-label')||'选择');button.innerHTML='<span></span>';el.after(button);button.addEventListener('click',()=>open(el));button.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open(el);}});}
 const button=el.nextElementSibling;button.querySelector('span').textContent=el.selectedOptions[0]?.textContent||'请选择';button.disabled=el.disabled;
 }
 for(const label of form.querySelectorAll('.setting-switch'))if(!label.querySelector('.ef-switch-off')){const off=document.createElement('span');off.className='ef-switch-off';off.textContent='关闭';off.setAttribute('aria-hidden','true');label.append(off);}
 }
 form?.addEventListener('change',()=>queueMicrotask(refresh));
 form?.addEventListener('click',e=>{if(e.target.closest('#resetAppearance'))queueMicrotask(refresh);});
 form?.addEventListener('keydown',e=>{const tab=e.target.closest('[data-settings-category]');if(!active()||!tab||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const tabs=[...form.querySelectorAll('[data-settings-category]')],next=tabs[(tabs.indexOf(tab)+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];next.click();next.focus();});
 document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target)&&!owner.nextElementSibling.contains(e.target))close();},true);
 document.addEventListener('scroll',e=>{if(menu&&!menu.contains(e.target))close();},true);window.addEventListener('resize',()=>{close();syncSelection(false);});window.addEventListener('cft:zoom',()=>syncSelection(false));
 new MutationObserver(()=>{close();refresh();}).observe(root,{attributes:true,attributeFilter:['data-theme']});
 window.addEventListener('cft:config-saved',refresh);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');let entryAnimations=[];
 // One downward reveal for every page, sharing the original settings motion.
 // Use the actual final stagger (230–352ms) as the sidebar finish time too.
 function reveal(container){
  entryAnimations.forEach(a=>a.cancel());entryAnimations=[];
  if(!active()||reduced.matches||!container)return;
  const selector=container===form?'.settings-category:not([hidden]) > header,.settings-category:not([hidden]) > .setting-row,.settings-category:not([hidden]) > .appearance-preview,.settings-category:not([hidden]) > .organize-guide,.settings-category:not([hidden]) > .bd-links,.settings-category:not([hidden]) .shortcut-group':':scope > .card > *, :scope > .api-key-gate > .key-setup-card';
  const rows=[...container.querySelectorAll(selector)].filter(el=>!el.hidden&&el.getClientRects().length);
  const visibleRows=rows.slice(0,14);
  const finish=230+Math.min(Math.max(0,visibleRows.length-1)*18,122);
  document.getElementById('navTabs')?.style.setProperty('--ef-nav-enter-ms',finish+'ms');
  for(const [i,row] of visibleRows.entries()){ 
   const animation=row.animate([{opacity:0,transform:'translateY(-14px)'},{opacity:1,transform:'translateY(0)'}],{duration:230,delay:Math.min(i*18,122),easing:'cubic-bezier(.2,.75,.25,1)',fill:'backwards'});
   animation.id='ef-page-enter';entryAnimations.push(animation);
  }
 }
 new MutationObserver(refreshKeys).observe(form,{subtree:true,childList:true,attributes:true,attributeFilter:['value']});
 let enteredPage=document.querySelector('.page.active');
 const pageEntryObserver=new MutationObserver(()=>{
  const page=document.querySelector('.page.active');if(page===enteredPage)return;enteredPage=page;
  close();stopSelection();reveal(page?.id==='page-settings'?form:page);
  if(page?.id==='page-settings')syncSelection(false);
 });
 for(const page of document.querySelectorAll('.page'))pageEntryObserver.observe(page,{attributes:true,attributeFilter:['class']});
 reduced.addEventListener('change',()=>{if(reduced.matches)entryAnimations.forEach(a=>a.cancel());syncSelection(false);});
 window.CFTEndfieldSettings={refresh,categoryChanged(){close();const panels=form?.querySelector('.settings-panels');if(panels)panels.scrollTop=0;refreshKeys();refreshNavigation(true);reveal(form);}};refresh();
})();
