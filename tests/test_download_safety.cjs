/* No real backend, account, file removal or large-model download. */
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
   window.removed=[];window.opened=[];window.ackCount=0;window.choices=[];window.choice=null;window.fixtureHidden=false;
   window.tasks=[{id:'a',filename:'same.safetensors',dest_dir:'D:/Demo/A',status:'paused',url:'https://civitai.red/models/111'},{id:'b',filename:'same.safetensors',dest_dir:'D:/Demo/B',status:'paused',url:'https://civitai.red/models/222'}];
   Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.fixtureHidden?'hidden':'visible'});
   api.call=async(method,...args)=>{
    if(method==='get_tasks')return window.tasks;
    if(method==='get_download_history')return {items:[],error:''};
    if(method==='get_task_thumbnails')return {};
    if(method==='remove_download_task'){window.removed.push(args[0]);window.tasks=window.tasks.filter(t=>t.id!==args[0]);return {ok:true,msg:'已移除，停止写入后清理 .part；模型及历史保留'};}
    if(method==='open_url'){window.opened.push(args[0]);return true;}
    if(method==='get_download_file_choice')return window.choice;
    if(method==='acknowledge_download_file_choice'){window.ackCount++;window.choice.shown=true;return {ok:true};}
    if(method==='respond_download_file_choice'){if(args[2]){window.choice.paused=true;}else{window.choices.push(args[1]);window.choice=null;}return {ok:true};}
    return original(method,...args);
   };await dlRefresh();
  });
  await page.locator('[data-task-id=a] .dl-task-check').check();
  await page.locator('[data-task-id=b]').click({button:'right'});assert.equal(await page.locator('#ctxMenu [data-act=dl_remove]').count(),1);ok('下载列表右键提供移除此任务');
  await page.locator('[data-act=dl_site]').click();assert.deepEqual(await page.evaluate(()=>window.opened),['https://civitai.red/models/222']);ok('右键操作定位点击行 ID，不取上一条选中行或同名文件');
  await page.locator('[data-task-id=b]').click({button:'right'});await page.locator('[data-act=dl_remove]').click();await page.locator('#cfCancel').click();assert.equal(await page.evaluate(()=>window.removed.length),0);ok('取消移除不提交请求');
  await page.locator('[data-task-id=b]').click({button:'right'});await page.locator('[data-act=dl_remove]').click();assert((await page.locator('.rename-dialog').innerText()).includes('.part'));await page.locator('#cfOk').click();await page.waitForFunction(()=>window.removed.length===1);assert.deepEqual(await page.evaluate(()=>window.removed),['b']);assert.equal(await page.locator('[data-task-id=a]').count(),1);ok('确认只移除右键任务，清理提示明确且保留另一任务');
  await page.evaluate(()=>{window.fixtureHidden=true;window.choice={id:'diffusion',title:'合成大模型 v1',shown:false,seconds:10,paused:false,files:[{name:'demo-fp8.safetensors',sizeKB:13*1024*1024,primary:true,metadata:{format:'SafeTensor',fp:'fp8'}},{name:'demo-bf16.safetensors',sizeKB:26*1024*1024,metadata:{format:'SafeTensor',fp:'bf16'}}]};CftDownloadFiles.poll();});
  await page.locator('.df-dialog').waitFor();await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>window.ackCount),0);assert((await page.locator('.df-countdown').innerText()).includes('尚未开始'));ok('隐藏页面不确认弹窗显示，不开始自动选择倒计时');
  await page.evaluate(()=>{window.fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>window.ackCount===1);assert((await page.locator('.df-list').innerText()).includes('bf16'));assert.equal(await page.locator('.df-option').count(),2);ok('可见后才确认显示，两个权重格式都可选');
  await page.evaluate(()=>CftDownloadFiles.poll());assert.equal(await page.evaluate(()=>window.ackCount),1);ok('重复轮询不重新启动倒计时');
  await page.locator('.df-option input').first().uncheck();await page.locator('.df-option input').nth(1).check();await page.screenshot({path:path.join(root,'docs/screenshots/diffusion-file-choice.png')});await page.locator('#dfConfirm').click();await page.waitForFunction(()=>window.choices.length===1);assert.deepEqual(await page.evaluate(()=>window.choices[0]),[1]);ok('仅选择第二项时不会提交第一个文件');
  assert.equal(errors.length,0,JSON.stringify(errors));ok('没有前端异常');console.log('PASS '+passed+' download safety checks');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
