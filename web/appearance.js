/* Local-font chooser: draft-only dual lists; settings are committed on Confirm. */
"use strict";
const TEXT_SCALES = {small:.9,standard:1,large:1.1,xlarge:1.2,huge:1.3};
let fontPicker=null;
let fontPickerViewPending=null,fontPickerViewSavePromise=null,fontPickerViewSaveError=false;
function normalizeFontPickerView(raw){return {expanded:raw?.expanded===true,scope:FONT_SCRIPT_SCOPES.some(item=>item.id===raw?.scope)?raw.scope:'default'};}
function flushFontPickerViewWrites(){
 if(fontPickerViewSavePromise)return fontPickerViewSavePromise;
 if(!fontPickerViewPending)return Promise.resolve();
 const run=async()=>{while(fontPickerViewPending){
  const next=fontPickerViewPending;fontPickerViewPending=null;let saved=false;
  try{saved=!!await api.call('save_config',{ui_font_picker_view:next});}catch{}
  if(!saved&&!fontPickerViewPending){
   fontPickerViewSaveError=true;
   const message='字库视图未保存，本次临时保留；重新启动后可能恢复。';
   if(fontPicker&&!fontPicker.closing)fontPicker.menu.querySelector('#fontDialogStatus').textContent=message;
   setStatus(message);
  }else if(saved){fontPickerViewSaveError=false;if(fontPicker){const status=fontPicker.menu.querySelector('#fontDialogStatus');if(status.textContent.startsWith('字库视图未保存'))status.textContent='';}}
 }};
 fontPickerViewSavePromise=run().finally(()=>{fontPickerViewSavePromise=null;if(fontPickerViewPending)return flushFontPickerViewWrites();});
 return fontPickerViewSavePromise;
}
function persistFontPickerView(){
 const p=fontPicker;if(!p||p.closing)return;
 const view=normalizeFontPickerView({expanded:!p.menu.querySelector('#fontScopePanel').hidden,scope:p.scope});
 state.cfg.ui_font_picker_view={...view};fontPickerViewPending={...view};
 return flushFontPickerViewWrites();
}
function setFontScopePanel(expanded,persist=true){const p=fontPicker;if(!p||p.busy||p.closing)return;p.menu.querySelector('#fontScopePanel').hidden=!expanded;p.menu.querySelector('#fontScopeToggle').setAttribute('aria-expanded',String(expanded));positionFontMenu();if(persist)persistFontPickerView();}
function customFontStack(){const raw=Array.isArray(state.cfg.ui_font_stack)?state.cfg.ui_font_stack:state.cfg.ui_font?[state.cfg.ui_font]:[];return [...new Set(raw.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()))];}
function syncFontChoice(){const b=document.getElementById('fontChoice');if(!b)return;const fonts=customFontStack(),scripts=Object.keys(normalizeFontScriptStacks(state.cfg.ui_font_scripts)).length;b.querySelector('span').textContent=(fonts.length?fonts[0]+(fonts.length>1?' + '+(fonts.length-1)+' 款回退字体':''):'主题默认字体组合')+(scripts?' · '+scripts+' 类字库分配':'');b.querySelector('span').style.fontFamily='var(--font)';}
function renderFontStack(){const preview=document.querySelector('.font-preview');if(!preview)return;document.getElementById('fontStack')?.remove();const name=document.getElementById('fontPreviewName'),fonts=customFontStack(),scripts=Object.keys(normalizeFontScriptStacks(state.cfg.ui_font_scripts)).length;if(name)name.textContent=(fonts.length?fonts.join(' → '):'默认回退：主题默认')+(scripts?' · 已分配 '+scripts+' 类字库':' · 未分配独立字库');syncFontChoice();}
function syncFontSelect(){const select=document.querySelector('[data-key="ui_font"]');if(!select)return;const font=state.cfg.ui_font||'';if(![...select.options].some(o=>o.value===font))select.add(new Option(font,font));select.value=font;}
async function saveFontStack(fonts,scripts={}){const previous=customFontStack(),previousScripts=normalizeFontScriptStacks(state.cfg.ui_font_scripts);fonts=[...new Set(fonts.filter(f=>typeof f==='string'&&f.trim()).map(f=>f.trim()))];scripts=normalizeFontScriptStacks(scripts);state.cfg.ui_font_stack=fonts;state.cfg.ui_font=fonts[0]||'';state.cfg.ui_font_scripts=scripts;syncFontSelect();applyUiAppearance();renderFontStack();try{if(!await api.call('save_config',{ui_font_stack:fonts,ui_font:fonts[0]||'',ui_font_scripts:scripts}))throw Error('save');if(typeof markSettingSaved==='function')markSettingSaved('ui_font');return true;}catch{state.cfg.ui_font_stack=previous;state.cfg.ui_font=previous[0]||'';state.cfg.ui_font_scripts=previousScripts;syncFontSelect();applyUiAppearance();renderFontStack();setStatus('字体组合保存失败，已恢复');return false;}}
function closeFontMenu(restore=false){if(!fontPicker||fontPicker.busy||fontPicker.closing)return;const p=fontPicker;cancelFontDrag();p.closing=true;p.menu.classList.add('font-picker-closing');p.menu.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);window.removeEventListener('blur',cancelFontDrag);document.removeEventListener('visibilitychange',cancelFontDrag);const finish=()=>{if(fontPicker!==p)return;p.menu.remove();fontPicker=null;document.removeEventListener('keydown',fontDialogKeys,true);const b=document.getElementById('fontChoice');b?.setAttribute('aria-expanded','false');if(restore)b?.focus();};const dialog=p.menu.querySelector('.font-picker-dialog');if((window.CFTMotion?.reduced()||matchMedia('(prefers-reduced-motion: reduce)').matches)||!dialog.animate){finish();return;}p.closeAnimation=dialog.animate([{transform:'translateX(0px)',opacity:1},{transform:'translateX(90px)',opacity:0}],{duration:110,easing:'cubic-bezier(.55,.05,.8,.5)',fill:'forwards'});p.closeAnimation.finished.then(finish,finish);}
function fontFamilyStack(fonts){return fonts.length?fonts.map(f=>JSON.stringify(f)).join(',')+',"HarmonyOS Sans SC",sans-serif':'var(--ef-settings-font,"HarmonyOS Sans SC"),sans-serif';}
const FONT_SCOPE_PREVIEWS={default:{lang:'zh-CN',text:'终末地工业 · 模型管理\nEndfield / Model Library 0123456789'},zhHans:{lang:'zh-CN',text:'终末地工业 · 简体中文字库\n模型管理、设置、下载与探索'},digits:{lang:'en',text:'2560×1440 · 1920×1080\n0123456789  100%  1.0  220 px'},latin:{lang:'en',text:'Endfield / Model Library\nABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz'},ja:{lang:'ja',text:'日本語 · ひらがな · カタカナ\n設定、地形、探索、モデル管理'},zhHant:{lang:'zh-TW',text:'終末地工業 · 繁體中文字庫\n模型管理、設定、下載與探索'},ko:{lang:'ko',text:'한국어 글꼴 · 엔드필드\n설정, 모델 관리, 다운로드'}};
function storeFontScopeDraft(p){if(p.scope==='default')p.defaultDraft=p.draft;else p.scriptDraft[p.scope]=p.draft;}
function setFontScope(id,persist=true){const p=fontPicker;if(!p||p.busy||p.closing||!FONT_SCRIPT_SCOPES.some(s=>s.id===id))return;cancelFontDrag();const sample=p.menu.querySelector('#fontSample');p.samples[p.scope]=sample.value;storeFontScopeDraft(p);p.scope=id;p.draft=id==='default'?p.defaultDraft:(p.scriptDraft[id]||=[]);p.selected=0;p.menu.querySelector('#fontScopeName').textContent=FONT_SCRIPT_SCOPES.find(s=>s.id===id).label;p.menu.querySelectorAll('[data-font-scope]').forEach(button=>{const active=button.dataset.fontScope===id;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});sample.value=p.samples[id]??FONT_SCOPE_PREVIEWS[id].text;sample.lang=FONT_SCOPE_PREVIEWS[id].lang;p.menu.querySelector('#fontSelected').scrollTop=0;renderFontSelection();renderFontRows();if(persist)persistFontPickerView();}
function renderFontScopePreview(){const p=fontPicker;if(!p)return;const own=p.draft,defaults=p.scope==='default'?[]:p.defaultDraft,fonts=[...new Set([...own,...defaults])],sample=p.menu.querySelector('#fontSample');sample.style.fontFamily=fontFamilyStack(fonts);sample.lang=FONT_SCOPE_PREVIEWS[p.scope].lang;const hint=p.menu.querySelector('.font-priority-hint');hint.textContent=p.scope==='default'?'按顺序查找字形；未单独分配的字库使用此组合。':['zhHans','zhHant','ja'].includes(p.scope)?'汉字编码会重叠，按界面 lang 区分简体、繁体和日语。':'此字库优先使用本组，缺字时接续默认回退。';p.menu.querySelector('#fontDraftChain').textContent=(fonts.length?fonts.join(' → ')+' → 主题内置回退':'主题默认字体组合')+(p.scope!=='default'&&!own.length?' · 本组继承默认':'');p.menu.querySelectorAll('[data-font-scope]').forEach(button=>{const list=button.dataset.fontScope==='default'?p.defaultDraft:p.scriptDraft[button.dataset.fontScope];button.classList.toggle('configured',!!list?.length);});}
function openFontMenu(){if(fontPicker)return;const mask=document.createElement('div');mask.id='fontMenu';mask.className='rd-mask font-picker-mask';mask.innerHTML=`<section class="font-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="fontDialogTitle"><div class="font-contour font-contour-left" aria-hidden="true"></div><div class="font-contour font-contour-right" aria-hidden="true"></div><header class="font-picker-head"><div><small>TYPOGRAPHY / LOCAL</small><h2 id="fontDialogTitle">字体与回退顺序</h2></div><div class="font-picker-tools"><button class="btn font-reset font-scope-toggle" id="fontScopeToggle" type="button" aria-expanded="false" aria-controls="fontScopePanel">${_icon('globe')}<span>字库分配</span></button><button class="btn font-reset" id="fontDefaults" type="button">${_icon('refresh')}<span>恢复默认</span></button><button type="button" class="btn font-close" aria-label="取消字体选择">${_icon('x')}</button></div></header><p class="font-picker-intro">左侧双击添加 · 右侧双击移除、长按拖动排序。仅修改本软件字体，不更改 Windows 设置。</p><div class="font-scope-panel" id="fontScopePanel" hidden><div class="font-scope-tabs" role="tablist" aria-label="字库分配">${FONT_SCRIPT_SCOPES.map(s=>`<button class="font-scope-tab${s.id==='default'?' active':''}" type="button" role="tab" aria-selected="${s.id==='default'}" aria-controls="fontSelected" data-font-scope="${s.id}">${s.label}</button>`).join('')}</div><p>各组独立排序；缺少的字形接续默认回退。共享汉字由内容的 lang 标记区分。</p></div><div class="font-picker-columns"><section class="font-library"><h3>Windows 已安装字体 <small id="fontAvailableCount"></small></h3><input id="fontSearch" class="input" type="search" placeholder="搜索字体名称…" aria-label="搜索本地字体" aria-controls="fontAvailable"/><div id="fontAvailable" class="font-list" role="listbox" aria-label="已安装字体" tabindex="0"><div class="font-menu-space"></div></div><button class="btn" id="fontAdd" type="button">＋ 添加到右侧</button></section><section class="font-priority"><h3><span>使用顺序 · <span id="fontScopeName">默认回退</span></span> <small id="fontSelectedCount"></small></h3><p class="font-priority-hint">优先使用第一款，缺少的字再向下查找</p><div id="fontSelected" class="font-list" role="listbox" aria-label="已选字体优先级" tabindex="0"></div><div class="font-order-actions"><button class="btn" id="fontRemove" type="button">移除选中</button><button class="btn" id="fontUp" type="button" aria-label="字体上移">↑ 上移</button><button class="btn" id="fontDown" type="button" aria-label="字体下移">↓ 下移</button></div></section></div><section class="font-live-preview"><label for="fontSample">字形预览 <small>中文 / English / 0123456789</small></label><textarea id="fontSample" rows="2" spellcheck="false" aria-label="字体组合预览文字">终末地工业 · 模型管理\nEndfield / Model Library 0123456789</textarea><p id="fontDraftChain"></p></section><footer class="font-picker-footer"><span id="fontDialogStatus" role="status"></span><div class="font-action-base"><button class="btn" id="fontCancel" type="button">取消</button></div><div class="font-action-base"><button class="btn btn-primary" id="fontConfirm" type="button">确定并应用</button></div></footer></section>`;
 document.body.append(mask);const defaultDraft=customFontStack();fontPicker={menu:mask,fonts:[],active:0,rowHeight:44,defaultDraft,scriptDraft:normalizeFontScriptStacks(state.cfg.ui_font_scripts),scope:'default',draft:defaultDraft,samples:{},selected:0,busy:false};document.getElementById('fontChoice')?.setAttribute('aria-expanded','true');
 const list=mask.querySelector('#fontAvailable');list.addEventListener('scroll',renderFontRows);list.addEventListener('click',e=>{const row=e.target.closest('[data-font-index]');if(row){fontPicker.active=Number(row.dataset.fontIndex);list.querySelectorAll('[role=option]').forEach(option=>{const selected=option===row;option.classList.toggle('focused',selected);option.setAttribute('aria-selected',String(selected));});list.setAttribute('aria-activedescendant',row.id);mask.querySelector('#fontAdd').disabled=fontPicker.draft.includes(fontPicker.fonts[fontPicker.active]);list.focus();}});list.addEventListener('dblclick',e=>{const row=e.target.closest('[data-font-index]');if(row)chooseFont(Number(row.dataset.fontIndex));});
 mask.querySelector('#fontSearch').addEventListener('input',filterFontMenu);mask.querySelector('#fontScopeToggle').onclick=()=>setFontScopePanel(mask.querySelector('#fontScopePanel').hidden);mask.querySelectorAll('[data-font-scope]').forEach(b=>b.onclick=()=>setFontScope(b.dataset.fontScope));mask.querySelector('.font-scope-tabs').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=[...mask.querySelectorAll('[data-font-scope]')],index=tabs.indexOf(e.target);if(index<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;setFontScope(tabs[next].dataset.fontScope);tabs[next].focus();};bindFontSelection(mask.querySelector('#fontSelected'));
 mask.querySelector('#fontAdd').onclick=()=>chooseFont(fontPicker.active);mask.querySelector('#fontRemove').onclick=()=>changeFontOrder(0);mask.querySelector('#fontUp').onclick=()=>changeFontOrder(-1);mask.querySelector('#fontDown').onclick=()=>changeFontOrder(1);
 mask.querySelector('#fontDefaults').onclick=()=>{const p=fontPicker;cancelFontDrag();p.defaultDraft=[];p.scriptDraft={};p.draft=p.scope==='default'?p.defaultDraft:(p.scriptDraft[p.scope]=[]);p.selected=0;renderFontSelection();renderFontRows();p.menu.querySelector('#fontDialogStatus').textContent='所有字库已恢复主题默认，确定后应用';};mask.querySelector('#fontCancel').onclick=mask.querySelector('.font-close').onclick=()=>closeFontMenu(true);
 mask.querySelector('#fontConfirm').onclick=async()=>{const p=fontPicker;if(!p||p.busy)return;cancelFontDrag();p.busy=true;p.menu.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);p.menu.querySelector('#fontDialogStatus').textContent='正在保存…';storeFontScopeDraft(p);await flushFontPickerViewWrites();const saved=await saveFontStack(p.defaultDraft,p.scriptDraft);p.busy=false;if(saved){closeFontMenu(true);setStatus(fontPickerViewSaveError?'字体组合已应用；字库视图尚未保存。':'字体组合已应用');}else{p.menu.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);renderFontSelection();p.menu.querySelector('#fontDialogStatus').textContent='保存失败，原设置已恢复；可重试或取消';}};
 mask.addEventListener('click',e=>{if(e.target===mask)closeFontMenu(true);});document.addEventListener('keydown',fontDialogKeys,true);window.addEventListener('blur',cancelFontDrag);document.addEventListener('visibilitychange',cancelFontDrag);const view=normalizeFontPickerView(state.cfg.ui_font_picker_view);setFontScopePanel(view.expanded,false);filterFontMenu();setFontScope(view.scope,false);if(fontPickerViewSaveError)mask.querySelector('#fontDialogStatus').textContent='字库视图未保存，本次临时保留；重新启动后可能恢复。';mask.querySelector('#fontSearch').focus();
}
function positionFontMenu(){if(fontPicker)renderFontRows();}
function filterFontMenu(){if(!fontPicker)return;const p=fontPicker,q=(p.menu.querySelector('#fontSearch').value||'').trim().toLowerCase(),previous=p.fonts[p.active];p.fonts=localFontFamilies.filter(f=>f.toLowerCase().includes(q));p.active=Math.max(0,p.fonts.indexOf(previous));p.menu.querySelector('#fontAvailableCount').textContent=p.fonts.length+' 款';const list=p.menu.querySelector('#fontAvailable');list.scrollTop=p.active*p.rowHeight;renderFontRows();}
function renderFontRows(){if(!fontPicker)return;const p=fontPicker,list=p.menu.querySelector('#fontAvailable'),space=list.firstElementChild;space.style.height=Math.max(1,p.fonts.length)*p.rowHeight+'px';const start=Math.max(0,Math.floor(list.scrollTop/p.rowHeight)-2),end=Math.min(p.fonts.length,start+Math.ceil((list.clientHeight||300)/p.rowHeight)+5),fragment=document.createDocumentFragment();for(let i=start;i<end;i++){const row=document.createElement('div'),font=p.fonts[i];row.className='font-option'+(i===p.active?' focused':'');row.id='font-option-'+i;row.dataset.fontIndex=i;row.setAttribute('role','option');row.setAttribute('aria-selected',String(i===p.active));Object.assign(row.style,{top:i*p.rowHeight+'px',height:p.rowHeight+'px',fontFamily:fontFamilyStack([font])});const label=document.createElement('span');label.textContent=font;row.append(label);if(p.draft.includes(font)){const check=document.createElement('small');check.textContent='已添加';row.append(check);}fragment.append(row);}if(!p.fonts.length){const empty=document.createElement('p');empty.className='font-empty';empty.textContent=localFontFamilies.length?'没有匹配的字体':'尚未读取到本机字体；可保留当前组合';fragment.append(empty);}space.replaceChildren(fragment);if(p.fonts.length)list.setAttribute('aria-activedescendant','font-option-'+p.active);else list.removeAttribute('aria-activedescendant');p.menu.querySelector('#fontAdd').disabled=p.busy||!p.fonts.length||p.draft.includes(p.fonts[p.active]);}
function renderFontSelection(){if(!fontPicker)return;cancelFontDrag();const p=fontPicker,list=p.menu.querySelector('#fontSelected');list.replaceChildren();p.selected=Math.max(0,Math.min(p.selected,p.draft.length-1));p.draft.forEach((font,i)=>{const row=document.createElement('div');row.className='font-selected-row'+(i===p.selected?' focused':'');row.dataset.selectedIndex=i;row.id='font-selected-'+i;row.setAttribute('role','option');row.setAttribute('aria-selected',String(i===p.selected));row.title='双击移除；长按后拖动调整顺序';const order=document.createElement('b');order.textContent=String(i+1).padStart(2,'0');const name=document.createElement('span');name.textContent=font;name.style.fontFamily=fontFamilyStack([font]);row.append(order,name);if(!localFontFamilies.includes(font)){const missing=document.createElement('small');missing.textContent='本机未找到';row.append(missing);}list.append(row);});if(!p.draft.length){const empty=document.createElement('p');empty.className='font-empty';empty.textContent=p.scope==='default'?'未指定自定义字体\n使用主题默认字体组合':'本组未指定字体\n继承默认回退组合';list.append(empty);list.removeAttribute('aria-activedescendant');}else list.setAttribute('aria-activedescendant','font-selected-'+p.selected);p.menu.querySelector('#fontSelectedCount').textContent=p.draft.length+' 款';p.menu.querySelector('#fontRemove').disabled=p.busy||!p.draft.length;p.menu.querySelector('#fontUp').disabled=p.busy||!p.draft.length||p.selected===0;p.menu.querySelector('#fontDown').disabled=p.busy||!p.draft.length||p.selected===p.draft.length-1;renderFontScopePreview();}
// Capture on the stable list, not a row: the draft is only reordered on drop.
function focusFontSelection(index){const p=fontPicker;if(!p)return;p.selected=index;const list=p.menu.querySelector('#fontSelected');list.querySelectorAll('[role=option]').forEach(row=>{const active=Number(row.dataset.selectedIndex)===index;row.classList.toggle('focused',active);row.setAttribute('aria-selected',String(active));});list.setAttribute('aria-activedescendant','font-selected-'+index);p.menu.querySelector('#fontUp').disabled=p.busy||index===0;p.menu.querySelector('#fontDown').disabled=p.busy||index===p.draft.length-1;list.focus({preventScroll:true});}
function cancelFontDrag(){const p=fontPicker,d=p?.drag;if(!d)return;clearTimeout(d.timer);cancelAnimationFrame(d.frame);p.drag=null;if(d.active)p.suppressClickUntil=performance.now()+350;d.ghost?.remove();d.list.classList.remove('font-dragging');d.list.querySelectorAll('.drag-source,.drop-before,.drop-after').forEach(row=>row.classList.remove('drag-source','drop-before','drop-after'));try{if(d.list.hasPointerCapture(d.id))d.list.releasePointerCapture(d.id);}catch{/* The pointer may already have ended outside the window. */}}
function updateFontDrop(d){const rows=[...d.list.querySelectorAll('[data-selected-index]')];rows.forEach(row=>row.classList.remove('drop-before','drop-after'));let slot=rows.findIndex(row=>{const r=row.getBoundingClientRect();return d.y<r.top+r.height/2;});if(slot<0)slot=rows.length;d.slot=slot;const marker=rows[Math.min(slot,rows.length-1)];marker?.classList.add(slot===rows.length?'drop-after':'drop-before');if(d.ghost){d.ghost.style.left=d.x+14+'px';d.ghost.style.top=d.y+12+'px';}}
function bindFontSelection(list){
 list.addEventListener('click',e=>{const p=fontPicker;if(!p||p.busy||performance.now()<(p.suppressClickUntil||0))return;const row=e.target.closest('[data-selected-index]');if(row)focusFontSelection(Number(row.dataset.selectedIndex));});
 list.addEventListener('dblclick',e=>{const p=fontPicker;if(!p||p.busy||performance.now()<(p.suppressClickUntil||0))return;const row=e.target.closest('[data-selected-index]');if(row){p.selected=Number(row.dataset.selectedIndex);changeFontOrder(0);}});
 list.addEventListener('pointerdown',e=>{const p=fontPicker,row=e.target.closest('[data-selected-index]');if(!p||p.busy||!row||e.button!==0||!e.isPrimary)return;cancelFontDrag();const d=p.drag={list,id:e.pointerId,index:Number(row.dataset.selectedIndex),x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,active:false};d.timer=setTimeout(()=>{if(fontPicker!==p||p.drag!==d)return;d.active=true;focusFontSelection(d.index);list.setPointerCapture(d.id);list.classList.add('font-dragging');row.classList.add('drag-source');d.ghost=document.createElement('div');d.ghost.className='font-drag-ghost';d.ghost.textContent=p.draft[d.index];p.menu.append(d.ghost);updateFontDrop(d);const tick=now=>{if(p.drag!==d)return;const r=list.getBoundingClientRect(),step=Math.min(32,now-(d.lastFrame||now))/2;d.lastFrame=now;if(d.x>=r.left&&d.x<=r.right){if(d.y<r.top+30)list.scrollTop-=step;else if(d.y>r.bottom-30)list.scrollTop+=step;}updateFontDrop(d);d.frame=requestAnimationFrame(tick);};d.frame=requestAnimationFrame(tick);},320);});
 list.addEventListener('pointermove',e=>{const d=fontPicker?.drag;if(!d||e.pointerId!==d.id)return;d.x=e.clientX;d.y=e.clientY;if(!d.active){if(Math.hypot(d.x-d.startX,d.y-d.startY)>7)cancelFontDrag();return;}e.preventDefault();updateFontDrop(d);});
 list.addEventListener('pointerup',e=>{const p=fontPicker,d=p?.drag;if(!d||e.pointerId!==d.id)return;const r=list.getBoundingClientRect(),commit=d.active&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom,slot=d.slot,index=d.index;cancelFontDrag();if(commit){const target=slot>index?slot-1:slot;const [font]=p.draft.splice(index,1);p.draft.splice(target,0,font);p.selected=target;renderFontSelection();p.menu.querySelector('#fontDialogStatus').textContent='顺序已调整，确定后应用';}});
 list.addEventListener('pointerleave',()=>{if(fontPicker?.drag&&!fontPicker.drag.active)cancelFontDrag();});
 list.addEventListener('pointercancel',cancelFontDrag);list.addEventListener('lostpointercapture',cancelFontDrag);
}
function chooseFont(index){if(!fontPicker||fontPicker.busy||fontPicker.closing)return;const p=fontPicker,font=p.fonts[index];if(!font)return;const exists=p.draft.indexOf(font);if(exists<0)p.draft.push(font);p.selected=exists<0?p.draft.length-1:exists;renderFontSelection();renderFontRows();p.menu.querySelector('#font-selected-'+p.selected)?.scrollIntoView({block:'nearest'});}
function changeFontOrder(offset){const p=fontPicker;if(!p||p.busy||p.closing||!p.draft.length)return;const i=p.selected;if(offset){const j=i+offset;if(j<0||j>=p.draft.length)return;[p.draft[i],p.draft[j]]=[p.draft[j],p.draft[i]];p.selected=j;}else p.draft.splice(i,1);renderFontSelection();renderFontRows();p.menu.querySelector('#font-selected-'+p.selected)?.scrollIntoView({block:'nearest'});}
function fontDialogKeys(e){const p=fontPicker;if(!p)return;if(p.closing){e.preventDefault();e.stopImmediatePropagation();return;}if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(p.drag){cancelFontDrag();return;}closeFontMenu(true);return;}if(e.key==='Tab'){const focusable=[...p.menu.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length);const i=focusable.indexOf(document.activeElement);if(i<0||e.shiftKey&&i===0||!e.shiftKey&&i===focusable.length-1){e.preventDefault();(e.shiftKey?focusable.at(-1):focusable[0])?.focus();}return;}if(p.busy){e.preventDefault();return;}const list=e.target.closest('#fontAvailable,#fontSelected');if(!list)return;const installed=list.id==='fontAvailable',length=installed?p.fonts.length:p.draft.length,key=installed?'active':'selected';if(['ArrowDown','ArrowUp','Home','End','Enter',' ','Delete'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='Enter'||e.key===' '){if(installed)chooseFont(p.active);return;}if(e.key==='Delete'){if(!installed)changeFontOrder(0);return;}p[key]=e.key==='Home'?0:e.key==='End'?Math.max(0,length-1):Math.max(0,Math.min(length-1,p[key]+(e.key==='ArrowDown'?1:-1)));if(installed){list.scrollTop=p.active*p.rowHeight;renderFontRows();}else{renderFontSelection();p.menu.querySelector('#font-selected-'+p.selected)?.scrollIntoView({block:'nearest'});}}}
function initFontPicker(){closeFontMenu();const b=document.getElementById('fontChoice');if(!b)return;syncFontChoice();renderFontStack();b.onclick=openFontMenu;b.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();openFontMenu();}};}
window.addEventListener('resize',positionFontMenu);window.addEventListener('cft:zoom',positionFontMenu);

let nativeAppearanceTimer = null, nativeAppearanceSerial = 0;
function applyTextAndWindowAppearance() {
  if (!state.cfg) return; // 初始化期间旧外观绑定可能先于 get_config 执行。
  const root = document.documentElement;
  root.style.setProperty('--type-scale', TEXT_SCALES[state.cfg.ui_text_size] || 1);
  syncFontChoice(); if (fontPicker) filterFontMenu();
  clearTimeout(nativeAppearanceTimer);
  // Invalidate an in-flight response as soon as the theme changes, not after
  // the debounce. Otherwise an old Mica reply can re-enable transparent CSS.
  const serial = ++nativeAppearanceSerial;
  const endfield = ['light_endfield','dark_endfield'].includes(state.cfg.theme);
  if (endfield) root.dataset.nativeMaterial = 'false';
  nativeAppearanceTimer = setTimeout(async () => {
    const css = getComputedStyle(root);
    // 以浏览器实际解析的主题颜色传给 DWM，Metro 和自定义主题同样可用。
    const colorHex = name => {
      const sample = document.createElement('span'); sample.style.color = css.getPropertyValue(name); document.body.append(sample);
      const channels = getComputedStyle(sample).color.match(/[\d.]+/g); sample.remove();
      return channels?.length >= 3 ? '#' + channels.slice(0,3).map(n => Math.round(Number(n)).toString(16).padStart(2,'0')).join('') : '#241c33';
    };
    try {
      const result = await api.call('set_window_appearance', {mode: state.cfg.window_appearance || 'theme', theme:state.cfg.theme, background: colorHex('--bg'), text: colorHex('--text'),integrated:state.cfg.integrated_titlebar!==false,font:state.cfg.ui_font||'',text_scale:TEXT_SCALES[state.cfg.ui_text_size]||1,page:document.querySelector('.nav-tab.active')?.textContent.trim()||''});
      const status = document.getElementById('windowAppearanceStatus');
      if (status && serial === nativeAppearanceSerial) status.textContent = result?.msg || '';
      if (result?.queued) {
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 250));
          if (serial !== nativeAppearanceSerial) break;
          const actual = await api.call('get_window_appearance');
          if (serial !== nativeAppearanceSerial) break;
          if (actual?.mode && actual.mode !== 'pending') {
            if (status?.isConnected) status.textContent = actual.msg || '';
            root.dataset.nativeMaterial=!endfield&&actual.client_material?'true':'false';
            syncWindowControls(actual);
            break;
          }
        }
      }
    } catch (_) { /* 普通浏览器不具备原生窗口接口。 */ }
  }, 120);
}


function syncWindowControls(actual) {
  const controls=document.getElementById('windowControls');
  if (!controls) return;
  const integrated=actual?.integrated === true;
  document.documentElement.dataset.windowButtons=integrated?'true':'false';
  controls.hidden=!integrated;document.documentElement.dataset.windowMaximized=actual?.maximized?'true':'false';
  const max=controls.querySelector('[data-window-action="maximize"]');
  const text=actual?.maximized?'还原窗口':'最大化';
  max.title=text;max.setAttribute('aria-label',text);
  max.querySelector('svg').innerHTML=actual?.maximized?'<path d="M9 5h10v10M5 9h10v10H5Z"/>':'<rect x="5" y="5" width="14" height="14"/>';
}
document.getElementById('windowControls')?.addEventListener('click',async e=>{
  const button=e.target.closest('[data-window-action]');if(!button)return;
  try {
    if(button.dataset.windowAction==='close' && typeof settingsHaveChanges==='function' && settingsHaveChanges()){window.requestSettingsClose();return;}
    const result=await api.call('window_control',button.dataset.windowAction);
    if(result?.ok===false){setStatus(result.msg||'窗口操作失败');return;}
    if(button.dataset.windowAction==='maximize')setTimeout(async()=>{
      try{syncWindowControls(await api.call('get_window_appearance'));}catch(_){}
    },150);
  }catch(_){setStatus('窗口操作暂不可用');}
});
let windowControlsResizeTimer;
window.addEventListener('resize',()=>{
  if(document.getElementById('windowControls')?.hidden)return;
  clearTimeout(windowControlsResizeTimer);
  windowControlsResizeTimer=setTimeout(async()=>{try{syncWindowControls(await api.call('get_window_appearance'));}catch(_){}},120);
});

document.getElementById('windowResizeEdges')?.addEventListener('pointerdown',e=>{
  const edge=e.target.closest('[data-resize-edge]');if(!edge || e.button!==0)return;
  e.preventDefault();e.stopPropagation();api.call('window_resize',edge.dataset.resizeEdge).catch(()=>{});
});
// 页面标题只选空白处拖动，输入/按钮不在拖动范围；双击空白标题可以最大化。
document.addEventListener('dblclick',e=>{
  if(document.documentElement.dataset.windowButtons!=='true' || !e.target.matches('.pywebview-drag-region') || e.target.closest('button,a,input,select,textarea,summary'))return;
  api.call('window_control','maximize').catch(()=>{});
});
