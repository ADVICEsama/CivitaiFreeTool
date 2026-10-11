/* Account setup gates new online work; offline model management stays usable. */
const CIVITAI_LOCKED_PAGES = ['download','dlmanager','updates','reverse'];
const CIVITAI_KEY_ACTIONS = new Set(['parse_urls','dl_enqueue_url','dl_enqueue_url_sync','dl_submit_url','download_image_models','mm_check_updates','mm_check_update','mm_update_models','rp_start','rp_identify_model','rp_add_paths']);
let savedApiKeyPresent = null;
function hasCivitaiKey() {return savedApiKeyPresent ?? !!String(state.cfg?.api_key || '').trim();}
function goToApiKeySettings() {
  switchPage('settings');showSettingsCategory('general');
  const search=$('#settingsSearch');if(search?.value){search.value='';filterWorkbenchSettings();}
  const row=$('[data-setting-key="api_key"]'), input=$('#settingsForm [data-key="api_key"]');
  row?.scrollIntoView({block:'center'});input?.focus();
  row?.classList.add('api-key-highlight');setTimeout(()=>row?.classList.remove('api-key-highlight'),2500);
  setStatus('在 civitai.red 账号页申请 API Key，粘贴后点击底部“保存设置”');
}
function apiKeyPrompt() {
  if(document.getElementById('apiKeyPrompt'))return;
  const root=document.createElement('div');root.id='apiKeyPrompt';root.className='key-prompt-mask';
  root.innerHTML='<div class="key-setup-card" role="dialog" aria-modal="true" aria-labelledby="keyPromptTitle"><h2 id="keyPromptTitle">先连接你的 C 站账号</h2><p>此功能需要 Civitai API Key。填写并保存后即可使用。</p><button class="btn btn-primary" data-key-settings>前往填写 API Key</button><button class="btn" data-key-close>暂不使用</button></div>';
  document.body.append(root);root.querySelector('[data-key-settings]').onclick=()=>{root.remove();goToApiKeySettings();};root.querySelector('[data-key-close]').onclick=()=>root.remove();root.querySelector('[data-key-settings]').focus();
  root.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();root.remove();}if(e.key==='Tab'){const buttons=[...root.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);e.preventDefault();buttons[(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}});
}
function guardCivitaiAction(method,args) {
  const protectedAction=CIVITAI_KEY_ACTIONS.has(method)||(method==='dl_action'&&['start','start_all','retry'].includes(args[0]));
  if(!protectedAction||hasCivitaiKey())return true;
  setStatus('请先填写并保存 Civitai API Key');apiKeyPrompt();return false;
}
function refreshApiKeyGates() {
  const locked=!hasCivitaiKey();
  for(const name of CIVITAI_LOCKED_PAGES){
    const page=document.getElementById('page-'+name);if(!page)continue;
    let gate=page.querySelector('.api-key-gate');
    if(!gate){
      gate=document.createElement('div');gate.className='api-key-gate';
      gate.innerHTML='<div class="key-setup-card"><div class="key-setup-icon" aria-hidden="true">'+_icon('lock')+'</div><h2>填写 API Key 后解锁</h2><p>批量下载、下载管理、检查更新和反向解析<br/>需要先配置你的 Civitai API Key。</p><ol><li>登录 civitai.red 的账号设置。</li><li>创建 API Key，并复制到软件设置。</li><li>点击“保存设置”，立即解锁。</li></ol><div class="key-setup-actions"><button type="button" class="btn" data-key-account>申请 API Key</button><button type="button" class="btn btn-primary" data-key-settings>前往填写</button></div><small>本地模型浏览、移动与工作流分析仍可使用。<br/>不会删除模型或清空下载历史。</small></div>';
      page.append(gate);gate.querySelector('[data-key-settings]').onclick=goToApiKeySettings;gate.querySelector('[data-key-account]').onclick=()=>api.call('open_url','https://civitai.red/user/account');
    }
    page.classList.toggle('api-key-locked',locked);gate.hidden=!locked;
    for(const child of page.children){if(child===gate)continue;if(locked){if(!child.hasAttribute('data-key-was-inert'))child.dataset.keyWasInert=String(child.inert);child.inert=true;}else if(child.hasAttribute('data-key-was-inert')){child.inert=child.dataset.keyWasInert==='true';delete child.dataset.keyWasInert;}}
    const tab=document.querySelector('.nav-tab[data-page="'+name+'"]');tab?.classList.toggle('needs-api-key',locked);
  }
}
window.addEventListener('cft:config-saved',e=>{
  if(Object.prototype.hasOwnProperty.call(e.detail||{},'api_key'))savedApiKeyPresent=!!String(e.detail.api_key||'').trim();
  refreshApiKeyGates();
});
// Capture before old proxy / shortcut listeners can open a nested dialog.
document.addEventListener('click',e=>{
  const page=e.target.closest?.('.page.api-key-locked');
  if(page&&!e.target.closest('.api-key-gate')){e.preventDefault();e.stopImmediatePropagation();apiKeyPrompt();return;}
  const target=e.target.closest?.('#mmSendRp,#dRp,[data-proxy="mmSendRp"],[data-act="syncbatch"]');
  if(target&&!hasCivitaiKey()){e.preventDefault();e.stopImmediatePropagation();apiKeyPrompt();}
},true);
let reverseTour=null;
const REVERSE_TOUR_STEPS=[
  {title:'1 · 打开模型管理',selector:'.nav-tab[data-page="models"]',text:'反查从本地模型开始，不是粘贴图片。进入“模型管理”，先扫描你在设置里添加的目录。'},
  {title:'2 · 全选当前列表',selector:'#mmSelAll',text:'点击“全选”。只会勾选当前筛选结果；想先试用，也可以手动勾选少量模型。教程不会替你勾选或更改文件。'},
  {title:'3 · 打开信息处理',selector:'[data-menu="mmInfoMenu"]',text:'点击工具栏的“信息处理”，展开模型元数据相关功能。'},
  {title:'4 · 识别模型信息',selector:'#mmInfoMenu [data-proxy="mmSendRp"]',text:'点击“识别模型信息”。所选模型加入反向解析列表，页面会切到反向解析。此时还没有开始反查。'},
  {title:'5 · 开始反查',selector:'#rpStart',text:'在反向解析页点击“开始反查”。软件按 SHA256 查询模型名称、版本、触发词和封面。可勾选“仅显示/反查失败”重试失败项，也可只“反查选中”。'}
];
function closeReverseTutorial(){document.getElementById('reverseTutorial')?.remove();document.querySelectorAll('.reverse-tour-target').forEach(el=>el.classList.remove('reverse-tour-target'));reverseTour=null;}
function startReverseTutorial(){
  if(typeof settingsHaveChanges==='function'&&settingsHaveChanges()){requestSettingsLeave(startReverseTutorial);return;}
  if(!hasCivitaiKey()){apiKeyPrompt();return;}
  closeReverseTutorial();reverseTour={step:0};renderReverseTutorial();
}
function renderReverseTutorial(){
  if(!reverseTour)return;document.getElementById('reverseTutorial')?.remove();document.querySelectorAll('.reverse-tour-target').forEach(el=>el.classList.remove('reverse-tour-target'));
  const i=reverseTour.step,step=REVERSE_TOUR_STEPS[i],root=document.createElement('aside');root.id='reverseTutorial';root.className='reverse-tour-card';root.setAttribute('aria-label','反向解析逐步教程');
  root.innerHTML='<div class="reverse-tour-top"><span>反向解析 · '+(i+1)+'/5</span><button class="btn" id="reverseTourClose" aria-label="退出教程">'+_icon('x')+'</button></div><h3>'+step.title+'</h3><p>'+step.text+'</p><div class="reverse-tour-actions"><button class="btn" id="reverseTourBack"'+(!i?' disabled':'')+'>上一步</button><button class="btn btn-primary" id="reverseTourNext">'+(i===4?'完成教程':'下一步')+'</button></div><p class="reverse-tour-note">按提示操作页面，再点下一步。教程不会自动发起反查。</p>';
  document.body.append(root);document.querySelector(step.selector)?.classList.add('reverse-tour-target');
  root.querySelector('#reverseTourClose').onclick=closeReverseTutorial;root.querySelector('#reverseTourBack').onclick=()=>{reverseTour.step--;renderReverseTutorial();};
  root.querySelector('#reverseTourNext').onclick=async e=>{
    e.stopPropagation();
    if(i===0){switchPage('models');}
    if(i===1){const paths=mmCheckedPaths();if(!paths?.length){setStatus('请先全选或勾选要识别的模型');return;}reverseTour.paths=paths;}
    if(i===2){const btn=document.querySelector('[data-menu="mmInfoMenu"]');if(!document.querySelector('#mmInfoMenu')?.classList.contains('open'))btn?.click();}
    if(i===3){const rows=await api.call('rp_get_rows');if(!reverseTour.paths?.length||!reverseTour.paths.every(p=>rows?.some(r=>normalizedModelPath(r.path)===normalizedModelPath(p)))){setStatus('请先点击“识别模型信息”加入所选模型');return;}switchPage('reverse');await rpRefresh();}
    if(i===4){closeReverseTutorial();return;}reverseTour.step++;renderReverseTutorial();
  };
}
