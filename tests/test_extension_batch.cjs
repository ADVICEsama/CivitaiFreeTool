/* Background and popup use mocked tabs/bridge; never send users' browsing data. */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),http=require('http');
const root=path.resolve(__dirname,'..');let passed=0;const ok=s=>{passed++;console.log('OK '+s);};
const common=fs.readFileSync(path.join(root,'chrome-extension/tabs-common.js'),'utf8');
function worker(saved=null,hold=null){
 const stored={lastBatch:saved},calls=[];let listener;
 const noop=()=>Promise.resolve();const ext={runtime:{id:'test-id',onMessage:{addListener:f=>listener=f},onInstalled:{addListener:()=>{}}},action:{setBadgeText:noop,setBadgeBackgroundColor:noop,setTitle:noop},contextMenus:{onClicked:{addListener:()=>{}}},storage:{local:{get:async()=>structuredClone(stored),set:async v=>Object.assign(stored,structuredClone(v))}}};
 const ctx=vm.createContext({chrome:ext,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,console,fetch:async(url,o)=>{calls.push(JSON.parse(o.body).url);if(hold)await hold;return {ok:true,json:async()=>({ok:true})};}});
 vm.runInContext(common,ctx);vm.runInContext(fs.readFileSync(path.join(root,'chrome-extension/background.js'),'utf8'),ctx);
 const message=(type,urls,sender={id:'test-id'})=>new Promise(resolve=>{const value=listener({type,urls},sender,resolve);if(value===false)resolve(null);});
 return {ctx,calls,stored,message};
}
const wait=async f=>{for(let i=0;i<200;i++){if(await f())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');};
(async()=>{
 const w=worker(),T=w.ctx.CftTabs;
 assert.equal(T.modelLink('https://evil.example/models/1'),null);assert.equal(T.modelLink('https://civitai.red.evil.example/models/1'),null);assert.equal(T.modelLink('https://civitai.red/models/bad'),null);assert.equal(T.modelLink('https://civitai.red/models/1?fileId=2&fileId=3'),null);ok('只接受合法 C 站模型 URL');
 const links=T.candidates([{id:1,url:'https://civitai.red/models/1/a?modelVersionId=11#x',title:'demo | Civitai'},{id:2,url:'https://www.civitai.com/models/1/b?modelVersionId=11',title:'duplicate'},{id:3,url:'https://civitai.red/models/1/a?modelVersionId=12',title:'different version'},{id:4,url:'https://civitai.red/models/1?modelVersionId=11&fileId=9'},{id:5,url:'https://example.invalid/private',title:'private'}]);
 assert.equal(links.length,3);assert.equal(links[0].copies,2);assert.equal(links[0].title,'demo');ok('跨 red/com 合并重复页，保留不同版本和 fileId，排除无关标签');
 assert(!T.modelLink('https://civitai.red/models/1?token=secret&utm_source=test').url.includes('secret'));ok('不发送 URL 中的 token 或追踪参数');
 assert.equal(await w.message('cft-batch-start',['https://civitai.red/models/1'],{id:'other'}),null);assert.equal(w.calls.length,0);ok('拒绝其它来源的扩展消息');
 assert.equal((await w.message('cft-batch-start',['https://civitai.red/models/1','https://evil.example/models/2'])).ok,false);assert.equal(w.calls.length,0);ok('批量含无效链接时零发送');
 let release;const hold=new Promise(r=>release=r),running=worker(null,hold);
 assert((await running.message('cft-batch-start',['https://civitai.red/models/1','https://civitai.red/models/2'])).ok);assert.equal((await running.message('cft-batch-start',['https://civitai.red/models/3'])).ok,false);ok('批量提交互斥，不重复启动');
 release();await wait(()=>!running.stored.lastBatch?.running);assert.equal(running.calls.length,2);assert(running.stored.lastBatch.items.every(r=>r.status==='sent'));ok('无需 popup 存活，后台继续按顺序提交全部勾选链接');
 assert.equal((await running.message('cft-batch-start',['https://civitai.red/models/1'])).ok,false);assert((await running.message('cft-batch-clear')).ok);assert((await running.message('cft-batch-start',['https://civitai.red/models/1'])).ok);await wait(()=>!running.stored.lastBatch?.running);ok('重复发送必须显式清除记录，CFT 任务不删除');
 const interrupted=worker({id:'old',running:true,items:[{key:'a',status:'sending'},{key:'b',status:'waiting'},{key:'c',status:'sent'}]});const status=await interrupted.message('cft-batch-status');assert.equal(status.job.items[0].status,'uncertain');assert.equal(status.job.items[1].status,'failed');assert.equal(interrupted.calls.length,0);ok('浏览器重启后中断记录可见，绝不自动重试未知请求');
 for(const name of ['chrome-extension','firefox-extension']){const m=JSON.parse(fs.readFileSync(path.join(root,name,'manifest.json')));assert.equal(m.version,'1.3.0');assert(m.permissions.includes('storage'));assert(!m.permissions.includes('scripting'));assert.equal(fs.readFileSync(path.join(root,name,'popup.js'),'utf8'),fs.readFileSync(path.join(root,'chrome-extension/popup.js'),'utf8'));}ok('Chrome/Firefox 同步且不再注入网页');
 const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
 const server=http.createServer((req,res)=>{const p=path.join(root,'chrome-extension',new URL(req.url,'http://localhost').pathname);fs.readFile(p,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(b);});});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.sent=[];window.job=null;
   const all=[{id:1,windowId:1,title:'Demo A | Civitai',url:'https://civitai.red/models/1/a?modelVersionId=11'},{id:2,windowId:1,title:'Demo A duplicate',url:'https://civitai.com/models/1/b?modelVersionId=11'},{id:3,windowId:2,title:'Demo B | Civitai',url:'https://civitai.red/models/2/b'},{id:4,windowId:1,title:'Not a model',url:'https://example.invalid/private'}];
   window.chrome={tabs:{query:async q=>q.active?[all[3]]:q.currentWindow?all.filter(t=>t.windowId===1):all},runtime:{sendMessage:async m=>{if(m.type==='cft-batch-start'){window.sent.push(m.urls);window.job={id:'job',running:false,items:m.urls.map(url=>({...CftTabs.modelLink(url),status:'sent',msg:'accepted'}))};}if(m.type==='cft-batch-clear')window.job=null;return {ok:true,job:window.job};}}};
   window.fetch=async()=>({ok:true,json:async()=>({ok:true})});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/popup.html');await page.waitForFunction(()=>document.querySelectorAll('.tab-row').length===2);assert(await page.locator('#batchPanel').isVisible());ok('当前页非模型时仍可批量其它已打开模型页');await page.setViewportSize({width:420,height:640});await page.screenshot({path:path.join(root,'docs/screenshots/extension-batch.png')});
  assert.equal(await page.locator('.tab-row input:checked').count(),2);await page.locator('.tab-row').filter({hasText:'Demo B'}).locator('input').uncheck();await page.locator('#sendBatch').click();await page.waitForFunction(()=>window.sent.length===1);assert.deepEqual(await page.evaluate(()=>window.sent),[['https://civitai.red/models/1/a?modelVersionId=11']]);ok('按勾选精确发送，不包含未选或其它网页');
  assert.equal(await page.locator('.tab-row input:disabled').count(),1);ok('已提交页面保留状态，避免再次误发');
  await page.locator('#scope').selectOption('current');await page.waitForFunction(()=>document.querySelectorAll('.tab-row').length===1);ok('范围可切换当前窗口 / 所有窗口');
  await page.locator('#modeCurrent').click();assert(await page.locator('#sendCurrent').isDisabled());assert.equal(errors.length,0);ok('非模型当前页不可误提交，界面无脚本错误');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 console.log('PASSED '+passed);
})().catch(e=>{console.error(e);process.exitCode=1;});
