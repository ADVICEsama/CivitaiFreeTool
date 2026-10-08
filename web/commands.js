"use strict";
// Local application commands only: no system-wide hooks, no eval, no automatic destructive action.
const SHORTCUT_PRESETS={arrows:{previous:'ArrowUp',next:'ArrowDown',favorite:'F',identify:'R',select:'Space',recycle:'Delete',preview:'Enter'},wasd:{previous:'W',next:'S',favorite:'F',identify:'R',select:'Space',recycle:'Delete',preview:'Enter'},vim:{previous:'K',next:'J',favorite:'F',identify:'R',select:'Space',recycle:'Delete',preview:'Enter'}};
const commandRegistry=new Map();let shortcutSaveTimer=0,shortcutRunning=new Set(),shortcutNavigateAt=0,shortcutHistoryId='';
let settingsBaseline=new Map(),settingsExitPending=false;
const PAGE_NAMES={download:'批量下载',dlmanager:'下载管理',models:'模型管理',updates:'检查更新',reverse:'反向解析',workflow:'工作流分析',settings:'设置'};
function shortcutBindings(){return {...Object.fromEntries(Object.entries(SHORTCUT_PRESETS[state.cfg.shortcuts_preset]||SHORTCUT_PRESETS.arrows).map(([k,v])=>['model:'+k,v])),...(state.cfg.shortcuts_bindings||{})};}
function canonicalShortcut(value){
  const parts=String(value||'').trim().split('+').filter(Boolean),raw=parts.pop();if(!raw)return '';
  const aliases={' ':'Space',space:'Space',spacebar:'Space',up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',esc:'Escape',del:'Delete'};
  let key=aliases[raw.toLowerCase()]||raw;if(key.length===1)key=key.toUpperCase();
  const known=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Enter','Escape','Delete','Backspace','Home','End','PageUp','PageDown','Tab'];
  key=known.find(v=>v.toLowerCase()===key.toLowerCase())||key;
  if(!(/^[A-Z0-9]$/.test(key)||/^F(?:[1-9]|1[0-2])$/.test(key)||known.includes(key)))return '';
  const modifiers=parts.map(p=>p.toLowerCase());if(modifiers.some(p=>!['ctrl','control','alt','shift','meta','cmd'].includes(p)))return '';
  return [modifiers.some(p=>['ctrl','control'].includes(p))?'Ctrl':'',modifiers.includes('alt')?'Alt':'',modifiers.includes('shift')?'Shift':'',modifiers.some(p=>['meta','cmd'].includes(p))?'Meta':'',key].filter(Boolean).join('+');
}
function shortcutFromEvent(e){return canonicalShortcut([e.ctrlKey?'Ctrl':'',e.altKey?'Alt':'',e.shiftKey?'Shift':'',e.metaKey?'Meta':'',e.code==='Space'?'Space':e.key].filter(Boolean).join('+'));}
function currentShortcutModel(){return state.display.find(r=>normalizedModelPath(r.path)===normalizedModelPath(detailRow?.path))||state.display.find(r=>state.mmSel.has(r.path))||null;}
async function modelCommand(action){
  const rows=state.display;let row=currentShortcutModel();
  if(action==='previous'||action==='next'){
    if(performance.now()-shortcutNavigateAt<100)return;shortcutNavigateAt=performance.now();
    const i=row?rows.indexOf(row):-1,index=i<0?(action==='next'?0:rows.length-1):Math.max(0,Math.min(rows.length-1,i+(action==='next'?1:-1)));row=rows[index];
    if(!row)return;state.mmSel=new Set([row.path]);renderMm();await showModelDetail(row.path);
    const el=Array.from(document.querySelectorAll('#mmTable tbody tr[data-path],#mmMasonry .ms-card')).find(e=>e.dataset.path===row.path);el?.scrollIntoView({block:'nearest'});return;
  }
  if(!row){setStatus('请先选择一个模型');return;}
  if(action==='favorite')return toggleModelFavorite(row.path);
  if(action==='identify')return identifyDetailModel(row.path);
  if(action==='select'){if(state.mmChecked.has(row.path))state.mmChecked.delete(row.path);else state.mmChecked.add(row.path);renderMm();return;}
  if(action==='preview'){await showModelDetail(row.path);if(detailRow?.covers?.length)openImageViewer(detailRow);else setStatus('当前模型没有可查看的图片');return;}
  if(action==='recycle')return runModelContextCommand('del',row);
}
async function runModelContextCommand(action,row=currentShortcutModel()){
  if(!row){setStatus('请先选择一个模型');return;}
  showModelContextMenu({clientX:12,clientY:12,preventDefault(){}},row);
  const button=Array.from(document.querySelectorAll('#ctxMenu [data-act]')).find(e=>e.dataset.act===action);button?.click();$('#ctxMenu').style.display='none';
}
function collectShortcutCommands(){
  for(const [id,label] of Object.entries({previous:'上一个模型',next:'下一个模型',favorite:'当前模型收藏/取消收藏',identify:'立即反查当前模型',select:'勾选/取消当前模型',recycle:'当前模型移入回收站（需确认）',preview:'查看当前模型大图'}))commandRegistry.set('model:'+id,{label,scope:'models',run:()=>modelCommand(id)});
  document.querySelectorAll('button[id],.submenu[id],.nav-tab[data-page],.mm-metro [data-menu]').forEach(el=>{
    if(el.closest('#shortcutCatalog')||el.id.startsWith('ob')||el.closest('.rename-dialog,.settings-exit-dialog'))return;
    if(el.matches('.nav-tab')){const page=el.dataset.page;commandRegistry.set('page:'+page,{label:'切换到 '+PAGE_NAMES[page],scope:'global',run:()=>switchPage(page)});return;}
    if(!el.matches('button'))return;
    const id=el.id||'menu:'+el.dataset.menu,label=(el.getAttribute('aria-label')||el.textContent).trim().replace(/\s+/g,' ');if(!label)return;
    const scope=el.closest('#detailPanel')?'models':el.closest('.image-viewer')?'image':el.closest('.page')?.id.replace('page-','')||'global';
    commandRegistry.set('button:'+id,{label,scope,run:()=>{const button=el.id?document.getElementById(id):document.querySelector('[data-menu="'+CSS.escape(el.dataset.menu)+'"]');if(button&&!button.disabled)button.click();else setStatus('当前功能暂不可用');}});
  });
  const detail={dRename:'自定义改名',dRp:'识别当前模型信息',dSync:'从 C站同步当前模型',dTranslate:'翻译简介',dLocalize:'文件名翻中文',dJson:'生成 SD JSON',dAllImgs:'下载模型示例图',dFavorite:'收藏/取消收藏',dSite:'打开当前模型 C站页',dEditInfo:'编辑模型信息',dRenameC:'文件名改成 C站名称',dCover:'设置封面',dCopyDesc:'复制简介'};
  for(const [id,label] of Object.entries(detail))commandRegistry.set('detail:'+id,{label:'模型详情 · '+label,scope:'models',run:async()=>{const row=currentShortcutModel();if(!row){setStatus('请先选择一个模型');return;}await showModelDetail(row.path);const button=document.getElementById(id);if(button&&!button.disabled)button.click();else setStatus('当前详情不支持此操作');}});
  for(const [act,label] of Object.entries({folder:'打开所在文件夹',site:'打开 C站',copy_name:'复制文件名',copy_cname:'复制 C站名称',rename:'自定义改名',rename_c:'文件名改成 C站名',localize:'文件名翻中文',organize:'整理模型',move:'移动文件',sdjson:'生成 SD JSON',wl:'不再提醒更新',del:'移入回收站（需确认）'}))commandRegistry.set('context:'+act,{label:'模型右键 · '+label,scope:'models',run:()=>runModelContextCommand(act)});
  document.querySelectorAll('#settingsForm [data-key]').forEach(el=>{const key=el.dataset.key;commandRegistry.set('setting:'+key,{label:'设置 · '+el.getAttribute('aria-label'),scope:'settings',run:()=>{showSettingsCategory(el.closest('[data-settings-panel]').dataset.settingsPanel);el.focus();if(el.type==='checkbox')el.click();}});});
  for(const [id,label] of Object.entries({open:'打开历史模型目录',site:'打开历史模型 C站页',info:'查看历史模型信息',save:'历史模型保存到…'}))commandRegistry.set('history:'+id,{label,scope:'dlmanager',run:()=>{const row=Array.from(document.querySelectorAll('#dlHistoryTable tbody tr')).find(r=>r.dataset.historyId===shortcutHistoryId);if(!row){setStatus('请先单击选择一条下载历史');return;}row.querySelector('[data-history-'+id+']')?.click();}});
  for(const [action,label] of Object.entries({save:'保存原图',share:'分享图片',copy_image:'复制图片',copy_url:'复制图片地址',previous:'上一张图片',next:'下一张图片',close:'关闭大图'}))commandRegistry.set('image:'+action,{label:'图片大图 · '+label,scope:'image',run:()=>{const selector={save:'#ivSave',share:'#ivShare',copy_image:'#ivCopyImage',copy_url:'[data-iv-act="copy_url"]',previous:'.iv-prev',next:'.iv-next',close:'#ivClose'}[action];document.querySelector(selector)?.click();}});
  commandRegistry.set('download:select-all',{label:'勾选/取消全部下载任务',scope:'dlmanager',run:()=>{const input=$('#dlSelectAll');input.checked=!input.checked;input.dispatchEvent(new Event('change',{bubbles:true}));}});
  for(const [id,label] of Object.entries({ivFit:'适合窗口',ivActual:'原始尺寸',ivPlus:'放大图片',ivMinus:'缩小图片',ivSite:'打开图片来源页',ivPreviewSave:'保存当前预览',ivExport:'导出生成数据',ivCopyImage:'复制当前图片'}))commandRegistry.set('image:'+id,{label:'图片大图 · '+label,scope:'image',run:()=>document.getElementById(id)?.click()});
  for(const [key,label] of Object.entries({all:'复制全部生成数据',prompt:'复制正面提示词',negative:'复制负面提示词'}))commandRegistry.set('image:copy-'+key,{label:'图片大图 · '+label,scope:'image',run:()=>document.querySelector('[data-iv-copy="'+key+'"]')?.click()});
  for(const [action,label] of Object.entries({minimize:'最小化窗口',maximize:'最大化/还原窗口',close:'关闭软件窗口（先检查未保存设置）'}))commandRegistry.set('window:'+action,{label,scope:'global',run:()=>document.querySelector('#windowControls [data-window-action="'+action+'"]')?.click()});
  document.querySelectorAll('.mm-menu [data-proxy],.mm-menu [data-ract],.mm-menu [data-goto],.mm-menu [data-act]').forEach(el=>{
    const id=el.dataset.proxy?'proxy-'+el.dataset.proxy:el.dataset.ract?'rename-'+el.dataset.ract:el.dataset.goto?'goto-'+el.dataset.goto:'action-'+el.dataset.act;
    const label=el.textContent.trim();commandRegistry.set('toolbar:'+id,{label:'模型工具 · '+label,scope:'models',run:()=>el.click()});
  });
  for(const [action,label] of Object.entries({dl_folder:'打开任务所在文件夹',dl_copy:'复制任务文件名',dl_site:'打开任务 C站页'}))commandRegistry.set('download-context:'+action,{label,scope:'dlmanager',run:()=>{const row=document.querySelector('#dlTable tbody tr.sel-row');if(!row){setStatus('请先选择下载任务');return;}row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:12,clientY:12}));document.querySelector('#ctxMenu [data-act="'+action+'"]')?.click();$('#ctxMenu').style.display='none';}});
  return commandRegistry;
}
function renderShortcutSettings(){
  const panel=document.querySelector('[data-settings-panel="shortcuts"]');if(!panel)return;
  panel.querySelector('#shortcutCatalog')?.remove();collectShortcutCommands();
  const bindings=shortcutBindings(),groups=new Map();for(const [id,c] of commandRegistry){if(!groups.has(c.scope))groups.set(c.scope,[]);groups.get(c.scope).push([id,c]);}
  const section=document.createElement('div');section.id='shortcutCatalog';section.innerHTML='<p class="shortcut-note">快捷键默认全部关闭。点击设键框后按组合键；Backspace 清除，Escape 取消。输入文字或打开确认框时不触发，删除仍需确认。修改预设不会自动启用；Windows 占用的组合键无法在软件中接管。</p><input class="input" id="shortcutSearch" type="search" placeholder="搜索功能，例如 收藏、反查、下载、复制" aria-label="搜索快捷键功能"/>'+Array.from(groups,([scope,commands])=>'<details class="shortcut-group" open><summary>'+esc(PAGE_NAMES[scope]||({global:'导航与公共功能',image:'图片大图'})[scope]||scope)+' · '+commands.length+' 项</summary>'+commands.map(([id,c])=>'<div class="shortcut-row" data-command="'+esc(id)+'"><span>'+esc(c.label)+'</span><button class="btn btn-tiny shortcut-run" type="button" aria-label="运行此功能">使用</button><input class="input shortcut-key" id="binding-'+esc(id)+'" data-shortcut-key="'+esc(id)+'" readonly value="'+esc(bindings[id]||'')+'" placeholder="点击设键" aria-label="'+esc(c.label)+' 快捷键"/></div>').join('')+'</details>').join('');panel.appendChild(section);
  section.querySelector('#shortcutSearch').oninput=e=>{const query=e.target.value.toLowerCase();section.querySelectorAll('.shortcut-row').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(query));section.querySelectorAll('.shortcut-group').forEach(group=>group.hidden=!Array.from(group.querySelectorAll('.shortcut-row')).some(row=>!row.hidden));};
  section.addEventListener('click',e=>{const button=e.target.closest('.shortcut-run');if(!button)return;const command=commandRegistry.get(button.closest('[data-command]').dataset.command);if(!command)return;const run=async()=>{if(command.scope==='image'&&!imageViewer){await modelCommand('preview');}else if(PAGE_NAMES[command.scope])switchPage(command.scope);if(command.scope==='global'||command.scope==='image'||document.querySelector('.nav-tab.active')?.dataset.page===command.scope)await command.run();};if(settingsHaveChanges())requestSettingsLeave(run);else run().catch(()=>setStatus('当前功能未能执行'));});
  section.addEventListener('keydown',e=>{const input=e.target.closest('.shortcut-key');if(!input)return;e.preventDefault();e.stopPropagation();if(e.key==='Escape'){input.blur();return;}if(['Control','Alt','Shift','Meta'].includes(e.key))return;const id=input.closest('[data-command]').dataset.command,key=e.key==='Backspace'?'':shortcutFromEvent(e);if(!key&&e.key!=='Backspace'){setStatus('暂不支持此键，请使用字母、数字、方向键或组合键');return;}const duplicate=Object.entries(shortcutBindings()).find(([other,value])=>other!==id&&value===key&&key);if(duplicate){setStatus('此键已用于：'+(commandRegistry.get(duplicate[0])?.label||duplicate[0]));return;}state.cfg.shortcuts_bindings={...(state.cfg.shortcuts_bindings||{}),[id]:key};input.value=key;publishSettingsDirty();saveShortcutPreferences();});
}
function saveShortcutPreferences(){clearTimeout(shortcutSaveTimer);shortcutSaveTimer=setTimeout(async()=>{try{if(!await api.call('save_config',{shortcuts_enabled:state.cfg.shortcuts_enabled===true,shortcuts_preset:state.cfg.shortcuts_preset||'arrows',shortcuts_bindings:state.cfg.shortcuts_bindings||{}}))throw Error('save');setStatus('快捷键设置已保存');}catch(_){setStatus('快捷键保存失败，请点击保存设置重试');}},250);}
function applyShortcutPreference(key,value){state.cfg[key]=key==='shortcuts_enabled'?!!value:value;if(key==='shortcuts_preset')state.cfg.shortcuts_bindings={};renderShortcutSettings();saveShortcutPreferences();}
function settingRawValue(el){return el.type==='checkbox'?String(el.checked):String(el.value??'');}
function captureSettingsBaseline(){settingsBaseline=new Map(Array.from(document.querySelectorAll('#settingsForm [data-key],#organizeRules,#settingsForm [data-shortcut-key]')).map(el=>[el.id,settingRawValue(el)]));publishSettingsDirty();}
function settingsHaveChanges(){return document.querySelector('#page-settings.active') && Array.from(document.querySelectorAll('#settingsForm [data-key],#organizeRules,#settingsForm [data-shortcut-key]')).some(el=>settingsBaseline.has(el.id)&&settingsBaseline.get(el.id)!==settingRawValue(el));}
function publishSettingsDirty(){if(typeof api!=='undefined')api.call('set_settings_dirty',!!settingsHaveChanges()).catch(()=>{});}
async function requestSettingsLeave(proceed){
  if(settingsExitPending)return;settingsExitPending=true;
  const mask=document.createElement('div');mask.className='rd-mask settings-exit-mask';mask.innerHTML='<div class="rename-dialog settings-exit-dialog" role="dialog" aria-modal="true" aria-label="设置尚未保存"><div class="rd-title">设置尚未保存</div><p>是否保存这些修改？放弃会恢复到上次已保存的设置。</p><div class="rd-actions"><button class="btn" id="settingsStay">继续编辑</button><button class="btn btn-danger" id="settingsDiscard">放弃修改</button><button class="btn btn-primary" id="settingsSaveLeave">保存并离开</button></div><p id="settingsExitError" role="status"></p></div>';document.body.appendChild(mask);
  const finish=()=>{mask.remove();settingsExitPending=false;};
  const leave=async save=>{mask.querySelectorAll('button').forEach(b=>b.disabled=true);try{if(save){if(!await saveSettings())throw Error('save');}else{state.cfg=await api.call('get_config');buildSettingsForm();document.documentElement.dataset.theme=state.cfg.theme||'modern';applyZoom(state.cfg.ui_zoom||100);applyUiAppearance();}await api.call('set_settings_dirty',false);finish();proceed();}catch(_){mask.querySelectorAll('button').forEach(b=>b.disabled=false);mask.querySelector('#settingsExitError').textContent='设置未能保存或恢复，仍留在设置页，请重试。';}};
  mask.querySelector('#settingsStay').onclick=finish;mask.querySelector('#settingsDiscard').onclick=()=>leave(false);mask.querySelector('#settingsSaveLeave').onclick=()=>leave(true);mask.querySelector('#settingsStay').focus();mask.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish();}});
}
window.requestSettingsClose=()=>{if(settingsHaveChanges())requestSettingsLeave(()=>api.call('window_control','close'));else api.call('set_settings_dirty',false).then(()=>api.call('window_control','close'));};
window.addEventListener('cft:config-saved',e=>{const cfg=e.detail||{};if(cfg.shortcuts_bindings||cfg.shortcuts_preset){for(const el of document.querySelectorAll('[data-shortcut-key]'))settingsBaseline.set(el.id,settingRawValue(el));}for(const el of document.querySelectorAll('#settingsForm [data-key]')){const key=el.dataset.key;if(!(key in cfg))continue;const value=Array.isArray(cfg[key])?cfg[key].join('\n'):String(cfg[key]??'');if(settingRawValue(el)===value)settingsBaseline.set(el.id,settingRawValue(el));}publishSettingsDirty();});
document.addEventListener('input',e=>{if(e.target.closest('#settingsForm'))publishSettingsDirty();});document.addEventListener('change',e=>{if(e.target.closest('#settingsForm'))publishSettingsDirty();});
window.addEventListener('beforeunload',e=>{if(settingsHaveChanges()){e.preventDefault();e.returnValue='设置尚未保存';}});
document.addEventListener('click',e=>{const row=e.target.closest('#dlHistoryTable tbody tr[data-history-id]');if(row&&!e.target.closest('button,a,input')){shortcutHistoryId=row.dataset.historyId;document.querySelectorAll('#dlHistoryTable tbody tr').forEach(r=>r.classList.toggle('sel-row',r===row));}});
document.addEventListener('keydown',async e=>{
  if(typeof state==='undefined'||!window.__ready||state.cfg.shortcuts_enabled!==true||e.isComposing||e.defaultPrevented||e.target.closest('input,textarea,select,[contenteditable=true]'))return;
  if([' ','Enter'].includes(e.key)&&e.target.closest('button,a,summary'))return;
  if(document.querySelector('.rd-mask,.settings-exit-mask,.mm-menu.open,.folders-panel.open')||getComputedStyle(document.querySelector('#obMask')).display!=='none'||settingsExitPending)return;
  collectShortcutCommands();const key=shortcutFromEvent(e),binding=Object.entries(shortcutBindings()).find(([,value])=>canonicalShortcut(value)===key&&key);if(!binding)return;
  const command=commandRegistry.get(binding[0]),page=document.querySelector('.nav-tab.active')?.dataset.page;if(!command)return;
  if(imageViewer?command.scope!=='image':!['global',page].includes(command.scope))return;
  if(e.repeat&&!['model:previous','model:next'].includes(binding[0]))return;
  e.preventDefault();if(shortcutRunning.has(binding[0])&&!['model:previous','model:next'].includes(binding[0]))return;shortcutRunning.add(binding[0]);
  try{await command.run();}catch(_){setStatus('快捷键操作未完成，请重试');}finally{shortcutRunning.delete(binding[0]);}
});
