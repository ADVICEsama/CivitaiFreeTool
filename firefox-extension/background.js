/* Requests run in the background, not in the short-lived popup. */
if (typeof importScripts === 'function') importScripts('tabs-common.js');
const ext = typeof browser !== 'undefined' ? browser : chrome;
const BRIDGE = 'http://127.0.0.1:47531';
const STORE = 'lastBatch';
let job = null, starting = false;
const ready = (async () => {
  const old = (await ext.storage.local.get(STORE))[STORE];
  if (old) {
    job = old;
    if (job.running) {
      job.running = false;
      for (const row of job.items) {
        if (row.status === 'sending') {row.status = 'uncertain'; row.msg = '提交中断，请先在 CFT 核对，避免重复下载';}
        else if (row.status === 'waiting') {row.status = 'failed'; row.msg = '尚未提交，可重新勾选';}
      }
      await save();
    }
  }
})();
function badge(text, color) {
  ext.action.setBadgeText({text}).catch(() => {});
  ext.action.setBadgeBackgroundColor({color}).catch(() => {});
}
async function save() { await ext.storage.local.set({[STORE]:job}); }
async function post(url) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(BRIDGE + '/api/download', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url}), signal:ctrl.signal});
    const data = await res.json();
    return res.ok && data.ok ? {status:'sent', msg:'已提交，在 CFT 查看解析结果'} : {status:'failed', msg:data.msg || 'CFT 未接受请求'};
  } catch (_) {
    // The server may have accepted it before the response was lost. Never retry implicitly.
    return {status:'uncertain', msg:'未收到确认，请在 CFT 核对后再发送'};
  } finally { clearTimeout(timer); }
}
async function run() {
  try {
    for (const row of job.items) {
      row.status = 'sending'; await save();
      Object.assign(row, await post(row.url)); await save();
      badge(String(job.items.filter(r => r.status === 'sent').length), '#0a84ff');
    }
  } catch (_) {
    for (const row of job.items) {
      if (row.status === 'sending') {row.status = 'uncertain'; row.msg = '提交中断，请在 CFT 核对';}
      else if (row.status === 'waiting') {row.status = 'failed'; row.msg = '尚未提交';}
    }
  } finally {
    job.running = false; await save();
    const sent = job.items.filter(r => r.status === 'sent').length;
    badge(sent === job.items.length ? '✓' : '!', sent === job.items.length ? '#0a84ff' : '#c23d50');
    ext.action.setTitle({title:`已提交 ${sent}/${job.items.length}，点击图标查看结果`}).catch(() => {});
  }
}
async function start(urls) {
  await ready;
  if (starting || job?.running) return {ok:false, msg:'上一批正在提交，请稍候', job};
  starting = true;
  try {
    if (!Array.isArray(urls) || !urls.length || urls.length > 500) return {ok:false, msg:'请勾选 1–500 个模型页'};
    const links = urls.map(CftTabs.modelLink);
    if (links.some(v => !v)) return {ok:false, msg:'含无效模型链接，未发送任何页面'};
    const completedKeys = [...new Set([...(job?.completedKeys || []),...(job?.items || []).filter(r=>['sent','uncertain'].includes(r.status)).map(r=>r.key)])];
    const items = [...new Map(links.map(v => [v.key, {...v,status:'waiting',msg:''}])).values()].filter(r=>!completedKeys.includes(r.key));
    if(!items.length)return {ok:false,msg:'这些页面已提交或待核对；如确需再次发送，请先清除提交记录'};
    job = {id:Date.now().toString(), running:true, completedKeys, items};
    await save();
    void run();
    return {ok:true,job};
  } finally {starting = false;}
}
ext.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== ext.runtime.id || !['cft-batch-start','cft-batch-status','cft-batch-clear'].includes(msg?.type)) return false;
  (async () => {await ready;if(msg.type==='cft-batch-clear'){if(starting||job?.running)return {ok:false,msg:'提交中不能清除记录'};job=null;await save();badge('','#0a84ff');return {ok:true,job};}return msg.type === 'cft-batch-start' ? start(msg.urls) : {ok:true,job};})()
    .then(respond, () => respond({ok:false,msg:'扩展状态读取失败，请重新加载扩展'}));
  return true;
});
ext.runtime.onInstalled.addListener(() => {
  ext.contextMenus.removeAll(() => ext.contextMenus.create({id:'cft-dl', title:'发送到 CivitaiFreeTool', contexts:['page','link']}));
});
ext.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId !== 'cft-dl') return;
  start([info.linkUrl || info.pageUrl]).then(r => {if (!r.ok) {badge('!','#c23d50');ext.action.setTitle({title:r.msg});}}).catch(() => badge('!','#c23d50'));
});
