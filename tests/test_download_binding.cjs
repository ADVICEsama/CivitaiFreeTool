/* Synthetic front-end API only. No real file, account or download. */
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web');
const source=fs.readFileSync(path.join(__dirname,'test_ui_preferences.cjs'),'utf8').replace(/\r\n/g,'\n');
const begin=source.indexOf('await page.addInitScript(')+'await page.addInitScript('.length,end=source.indexOf('\n    });\n    const url',begin)+6,init=eval('('+source.slice(begin,end)+')');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),p=path.resolve(web,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(!p.startsWith(web+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(p,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(b);});
});
let passed=0;const ok=s=>{console.log('OK '+s);passed++;};
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(init);
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready);
  await page.evaluate(async()=>{
   window.settingsHaveChanges=()=>false;switchPage('dlmanager');const original=api.call.bind(api);
   window.bindCalls=[];window.bound=false;window.inspectFailed=false;window.fixtureTasks=[{id:'unverified',filename:'Landscape-v1.safetensors',status:'error',error:'SHA256 校验失败',hash_mismatch:true,downloaded:100,total:100,dest_dir:'D:/Demo/models',manual_binding:false},{id:'ordinary',filename:'Other.safetensors',status:'error',error:'HTTP 403',hash_mismatch:false,total:0}];
   api.call=async(method,...args)=>{
    if(method==='get_tasks')return window.fixtureTasks;
    if(method==='get_download_history')return {items:[{...window.fixtureTasks[0],verification_status:'mismatch',manual_binding:window.bound?{hash_verified:false}:null}],error:''};
    if(method==='inspect_download_binding')return window.inspectFailed?{ok:false,msg:'文件大小不完整'}:{ok:true,model_name:'Landscape <script>not executable</script>',version_name:'v1',filename:'Landscape-v1.safetensors',actual_sha256:'a'.repeat(64),expected_sha256:'b'.repeat(64)};
    if(method==='bind_download_metadata'){window.bindCalls.push(args);window.bound=true;window.fixtureTasks[0].manual_binding=true;return {ok:true,msg:'已关联；校验仍不一致'};}
    if(method==='get_task_thumbnails')return {};
    return original(method,...args);
   };mmScan=()=>{};await dlRefresh();
  });
  assert.equal(await page.locator('[data-bind-download]').count(),1);assert((await page.locator('[data-task-id=unverified] .dl-task-status').innerText()).includes('已下载 · 校验不一致'));ok('只有校验不一致任务提供关联入口，普通失败仍是失败');
  await page.locator('[data-bind-download]').click();await page.locator('#cfCancel').waitFor();assert((await page.locator('.rename-dialog').innerText()).includes('不能保证'));assert((await page.locator('.binding-hashes').innerText()).includes('a'.repeat(64)));ok('关联前显示两份完整哈希和明确风险说明');
  assert.equal(await page.locator('.rename-dialog script').count(),0);ok('外部模型名只作为文字显示');
  await page.locator('.rename-dialog p b').evaluate(e=>e.textContent='水彩风格 · 合成示例模型');
  await page.mouse.move(20,20);
  await page.screenshot({path:path.join(root,'docs/screenshots/download-unverified-binding.png')});
  await page.locator('#cfCancel').click();assert.equal(await page.evaluate(()=>window.bindCalls.length),0);ok('取消不提交关联、不改校验状态');
  await page.locator('[data-bind-download]').click();await page.locator('#cfOk').click();await page.waitForFunction(()=>window.bindCalls.length===1);assert.deepEqual(await page.evaluate(()=>window.bindCalls[0]),['unverified','a'.repeat(64),true]);ok('明确确认才提交任务 ID 与预览时的实际哈希');
  await page.waitForFunction(()=>document.querySelector('[data-task-id=unverified]').textContent.includes('已关联'));assert.equal(await page.locator('[data-bind-download]').count(),0);assert((await page.locator('[data-task-id=unverified] .dl-task-status').innerText()).includes('校验不一致'));ok('关联后仍保留警告，不伪装下载校验成功');
  await page.locator('#dlHistoryTab').click();await page.waitForFunction(()=>document.querySelector('#dlHistoryTable').textContent.includes('已关联'));assert((await page.locator('#dlHistoryTable').innerText()).includes('校验不一致'));ok('下载历史同样保留关联与校验不一致状态');
  await page.evaluate(async()=>{document.querySelector('#dlQueueTab').click();window.fixtureTasks[0].manual_binding=false;window.inspectFailed=true;await dlRefresh();});await page.locator('[data-bind-download]').click();await page.waitForFunction(()=>document.body.textContent.includes('文件大小不完整'));assert.equal(await page.locator('#cfOk').count(),0);ok('文件缺失或不完整时不出现可确认窗口');
  assert.equal(errors.length,0,JSON.stringify(errors));ok('没有前端异常');console.log('PASS '+passed+' download binding checks');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
