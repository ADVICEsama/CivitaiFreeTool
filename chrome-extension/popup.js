const ext = typeof browser !== 'undefined' ? browser : chrome;
const $ = id => document.getElementById(id);
let tabs = [], rows = [], selected = new Set(), active = null, job = null, online = false, busy = false, seenJob = '', refreshSerial = 0;
const blocked = () => new Set([...(job?.completedKeys || []),...(job?.items || []).filter(r => ['sent','sending','waiting','uncertain'].includes(r.status)).map(r => r.key)]);
function updateButtons() {
  const lock = busy || !!job?.running;
  $('sendCurrent').disabled = lock || !online || !active || blocked().has(active.key);
  const count = rows.filter(r => selected.has(r.key) && !blocked().has(r.key)).length;
  $('sendBatch').disabled = lock || !online || !count;
  $('sendBatch').textContent = `发送选中 ${count} 项到 CFT`;
  $('selectionCount').textContent = `已选 ${count} / ${rows.length}`;
}
function visibleRows() {const q = $('search').value.trim().toLowerCase();return rows.filter(r => !q || (r.title+' '+r.url).toLowerCase().includes(q));}
function render() {
  const list = $('tabList'), blockedKeys = blocked(); list.replaceChildren();
  const shown = visibleRows();
  for (const row of shown) {
    const label = document.createElement('label'); label.className = 'tab-row';
    const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.key = row.key; input.checked = selected.has(row.key) && !blockedKeys.has(row.key); input.disabled = blockedKeys.has(row.key) || !!job?.running;
    input.addEventListener('change', () => {if(input.checked)selected.add(row.key);else selected.delete(row.key);syncSelection();});
    const text = document.createElement('span'), name = document.createElement('strong'), meta = document.createElement('small');
    name.textContent = row.title;meta.textContent = `ID ${row.id}` + (row.version ? ` · 版本 ${row.version}` : '') + (row.copies > 1 ? ` · 合并 ${row.copies} 个标签` : '') + (blockedKeys.has(row.key) ? ' · 查看下方提交结果' : '');
    label.title = row.url;text.append(name, meta);label.append(input,text);list.append(label);
  }
  if (!shown.length) {const p=document.createElement('p');p.className='empty';p.textContent=rows.length?'没有匹配的模型标签页':'没有打开的 C 站模型页';list.append(p);}
  $('tabSummary').textContent = `${rows.length} 个不同模型 / 版本；只读取模型页标题和链接，不读取网页内容。`;
  syncSelection();
}
function syncSelection() {
  const enabled = visibleRows().filter(r => !blocked().has(r.key)), count=enabled.filter(r=>selected.has(r.key)).length;
  $('selectAll').checked = enabled.length > 0 && count===enabled.length;$('selectAll').indeterminate=count>0&&count<enabled.length;$('selectAll').disabled=!enabled.length||!!job?.running;
  updateButtons();
}
async function health() {
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),2500);
  try {const r=await fetch('http://127.0.0.1:47531/api/health',{signal:c.signal});online=r.ok&&!!(await r.json()).ok;}catch(_){online=false;}finally{clearTimeout(timer);}
  $('connection').textContent=online?'CFT 已连接':'请先打开 CFT';$('connection').classList.toggle('connected',online);updateButtons();
}
async function refresh() {
  const serial=++refreshSerial;
  try {
    const queried=await ext.tabs.query($('scope').value==='current'?{currentWindow:true}:{});
    if(serial!==refreshSerial)return;
    tabs=queried;rows=CftTabs.candidates(tabs);selected=new Set(rows.map(r=>r.key));render();
  }catch(_){$('feedback').textContent='读取标签页失败，请重新加载扩展';}
}
function mode(batch) {
  $('currentPanel').hidden=batch;$('batchPanel').hidden=!batch;
  for (const [id,on] of [['modeBatch',batch],['modeCurrent',!batch]]) {$(id).classList.toggle('active',on);$(id).setAttribute('aria-pressed',String(on));}
}
function renderJob(next) {
  const change = seenJob !== (next?.id||'') || JSON.stringify(job)!==JSON.stringify(next);
  job=next;
  if(!change){updateButtons();return;}
  seenJob=job?.id||'';$('results').hidden=!job;$('clearResults').hidden=!job;$('clearResults').disabled=!!job?.running;
  if(job){
    const sent=job.items.filter(r=>r.status==='sent').length, uncertain=job.items.filter(r=>r.status==='uncertain').length;
    $('resultSummary').textContent=`${job.running?'正在提交':'提交结果'}：已提交 ${sent}/${job.items.length}`+(uncertain?` · ${uncertain} 项待核对`:'');
    $('resultList').replaceChildren();
    for(const row of job.items){const p=document.createElement('p');p.className='result '+row.status;p.textContent=`ID ${row.id}：${({waiting:'等待提交',sending:'正在提交',sent:'已提交',failed:'未提交',uncertain:'待核对'})[row.status]} · ${row.msg||''}`;$('resultList').append(p);}
    if(!job.running){$('results').open=true;$('feedback').textContent='“已提交”仅表示 CFT 接收链接，解析/文件选择结果请在软件内查看。';}
  }
  render();
}
async function status() {try {const r=await ext.runtime.sendMessage({type:'cft-batch-status'});if(r.ok)renderJob(r.job);}catch(_) {}}
async function send(urls) {
  if(busy||job?.running||!urls.length)return;busy=true;updateButtons();$('feedback').textContent='正在提交…';
  try {const r=await ext.runtime.sendMessage({type:'cft-batch-start',urls});if(!r.ok){$('feedback').textContent=r.msg;return;}renderJob(r.job);$('results').open=true;}
  catch(_){$('feedback').textContent='未收到扩展确认，请重新打开小窗核对提交结果，勿重复点击。';}
  finally{busy=false;updateButtons();}
}
$('clearResults').onclick=async()=>{if(!confirm('清除扩展提交记录后，这些页面可再次发送。请先核对 CFT，避免重复任务；不会删除 CFT 中的下载记录。'))return;try{const r=await ext.runtime.sendMessage({type:'cft-batch-clear'});if(r.ok){renderJob(null);$('feedback').textContent='扩展提交记录已清除；CFT 中的任务未改动';}else $('feedback').textContent=r.msg;}catch(_){$('feedback').textContent='清除失败，请重试';}};
$('modeCurrent').onclick=()=>mode(false);$('modeBatch').onclick=()=>mode(true);
$('scope').onchange=refresh;$('refresh').onclick=()=>{refresh();health();};$('search').oninput=render;
$('selectAll').onchange=()=>{for(const r of visibleRows().filter(r=>!blocked().has(r.key))){if($('selectAll').checked)selected.add(r.key);else selected.delete(r.key);}render();};
$('sendCurrent').onclick=()=>send(active?[active.url]:[]);
$('sendBatch').onclick=()=>send(rows.filter(r=>selected.has(r.key)&&!blocked().has(r.key)).map(r=>r.url));
document.addEventListener('DOMContentLoaded',async()=>{
  try {const [tab]=await ext.tabs.query({active:true,currentWindow:true});active=CftTabs.modelLink(tab?.url);$('modelName').textContent=active?CftTabs.cleanTitle(tab.title):'当前页面不是 C 站模型页';$('modelUrl').textContent=active?active.url:'可以切换到“批量标签页”，发送其它已打开的模型页。';if(!active)mode(true);await status();await refresh();await health();}
  catch(_){$('feedback').textContent='扩展初始化失败，请重新加载';}
  setInterval(status,750);
});
