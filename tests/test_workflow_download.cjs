/* Real browser layout, fake bridge. No account, network requests or real downloads. */
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
let passed=0;function ok(s){console.log('OK '+s);passed++;}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(init);
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready);
  await page.evaluate(async()=>{
   window.settingsHaveChanges=()=>false;switchPage('workflow');state.cfg.theme='dark_blue';state.cfg.ui_text_size='standard';state.cfg.ui_font='';document.documentElement.dataset.theme='dark_blue';applyUiAppearance();
   const original=api.call.bind(api);api.call=async(method,...args)=>{
    if(method==='workflow_model_matches'){if(window.wfMatchFail)throw Error('fixture');if(window.wfDelay)await new Promise(r=>setTimeout(r,window.wfDelay));return JSON.stringify(args[0].map((ref,i)=>({ref,local:i<2,path:'D:/Demo/models/'+ref,sha256:'abcdef0123456789'})));}
    if(method==='get_download_file_choice')return window.dfFixture||null;
    if(method==='respond_download_file_choice'){window.dfResponses=(window.dfResponses||[]).concat([{id:args[0],indices:args[1],pause:args[2]}]);if(args[2]){window.dfFixture.paused=true;return {ok:true};}window.dfFixture=null;return {ok:true};}
    return original(method,...args);
   };
   window.wfFixture={ok:true,file:'landscape-workflow.png',has_workflow:true,node_count:40,nodes:Array.from({length:40},(_,i)=>({id:i+1,type:i===2?'KSampler':'WorkflowNode',title:i===2?'采样器':'节点 '+(i+1),widgets:['mountain'],parameters:[{name:'steps',value:24},{name:'cfg',value:7}],inputs:[{name:'model',source:1,slot:0}]})),models:['landscape_v1.safetensors','image_vae.safetensors','watercolor_style.safetensors'],pos_prompt:'watercolor landscape, mountain lake, soft morning light, delicate brushwork',neg_prompt:'low quality, blurry, watermark'};
   await wfRenderResult(window.wfFixture);
  });
  assert.equal(await page.locator('.wf-workspace').getAttribute('data-layout'),'columns');ok('宽内容区三栏');
  const wide=await page.locator('.wf-node-section,.wf-detail-section,.wf-model-section').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().toJSON()));assert(wide[0].x<wide[1].x&&wide[1].x<wide[2].x);assert(Math.max(...wide.map(r=>r.y))-Math.min(...wide.map(r=>r.y))<2);ok('三栏按节点目录、详情、引用模型对齐');
  assert((await page.locator('#wfOverview').innerText()).includes('2 个已匹配'));assert((await page.locator('#wfAlert').innerText()).includes('缺少 1'));ok('总结与缺失数来自真实匹配结果');
  assert.equal(await page.locator('.wf-resource-details').first().getAttribute('open'),null);await page.locator('.wf-resource-details summary').first().click();await page.locator('#wfNodes [data-index="2"]').click();await page.locator('#wfNodeSearch').fill('采样器');ok('节点可选、参数只读、路径哈希默认折叠');
  await page.locator('#wfNodeSearch').fill('');await page.screenshot({path:path.join(root,'docs/screenshots/workflow-columns.png')});await page.locator('#wfNodeSearch').fill('采样器');
  for(const width of [1280,1000,800]){
   await page.setViewportSize({width,height:1000});await page.waitForFunction(()=>document.querySelector('.wf-workspace').dataset.layout==='report');
   const rects=await page.evaluate(()=>['.wf-model-section','.wf-prompt-section','.wf-node-section','.wf-detail-section'].map(s=>document.querySelector(s).getBoundingClientRect().toJSON()));assert(rects.every((r,i)=>!i||r.y>rects[i-1].y));
   assert.equal(await page.locator('#wfNodes [data-index="2"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#wfNodeSearch').inputValue(),'采样器');assert.equal(await page.locator('.wf-resource-details').first().getAttribute('open'),'');
   const overflow=await page.locator('.content').evaluate(e=>e.scrollWidth-e.clientWidth);assert(overflow<=2,'overflow '+width+': '+overflow);ok(width+' 小窗报告，无横向溢出，保持选择/搜索/展开');
  }
  await page.setViewportSize({width:1120,height:1080});await page.evaluate(()=>{document.querySelector('.content').scrollTop=0;});await page.screenshot({path:path.join(root,'docs/screenshots/workflow-report.png')});
  await page.setViewportSize({width:1920,height:1080});await page.evaluate(()=>{applyZoom(150);state.cfg.ui_text_size='huge';applyUiAppearance();});await page.waitForFunction(()=>document.querySelector('.wf-workspace').dataset.layout==='report');assert((await page.locator('.content').evaluate(e=>e.scrollWidth-e.clientWidth))<=2);ok('150% 界面缩放、大字号时自动报告而非硬塞三栏');
  await page.evaluate(async()=>{applyZoom(100);state.cfg.ui_text_size='standard';applyUiAppearance();window.wfMatchFail=true;await wfRenderResult(window.wfFixture);});assert((await page.locator('#wfOverview').innerText()).includes('模型匹配失败'));assert(!(await page.locator('#wfOverview').innerText()).includes('待补齐'));ok('匹配失败不伪装成全部缺失');
  await page.evaluate(async()=>{window.wfMatchFail=false;window.wfDelay=80;const older=wfRenderResult({...window.wfFixture,file:'old.json'});window.wfDelay=0;await wfRenderResult({...window.wfFixture,file:'new.json',models:[]});await older;});assert.equal(await page.locator('.wf-file-name').innerText(),'new.json');assert((await page.locator('#wfModels').innerText()).includes('未识别'));ok('慢旧响应不会覆盖新文件');
  await page.evaluate(async()=>{await wfRenderResult({ok:true,file:'safe.json',nodes:[{type:'<img src=x onerror=alert(1)>',widgets:['<script>bad</script>']}],models:[],positive:'<script>bad</script>'});});assert.equal(await page.locator('#wfResult img,#wfResult script').count(),0);ok('外部文件文本只显示，不执行 HTML');
  await page.evaluate(async()=>{await wfRenderResult({ok:true,file:'weilin.png',nodes:[],models:[],pos_prompt:'synthetic landscape',neg_prompt:'',prompt_notes:'负向条件已清零，未使用文本提示词。<script>not executable</script>'});});
  assert((await page.locator('#wfPrompts').innerText()).includes('负向条件已清零'));assert.equal(await page.locator('#wfPrompts script').count(),0);assert.equal(await page.locator('#wfPrompts [data-prompt]').count(),1);const boxes=await page.locator('#wfPrompts .wf-prompt').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert(Math.abs(boxes[0]-boxes[1])<1);ok('WeiLin 解析说明安全显示，清零负向不提供错误复制按钮');
  await page.evaluate(()=>{window.dfFixture={id:'choice-1',title:'Demo v1',seconds:10,paused:false,files:[0,1,2].map(i=>({name:'landscape_'+i+'.safetensors',sizeKB:13631488/(i+1),primary:i===0,metadata:{format:'SafeTensor',fp:i===0?'fp8':'int8'}}))};CftDownloadFiles.poll();});await page.locator('.df-dialog').waitFor();assert.equal(await page.locator('.df-option input:checked').count(),1);assert((await page.locator('.df-countdown').innerText()).includes('10 秒'));ok('多文件默认勾选首项，显示格式/大小/倒计时');
  await page.locator('.df-option input').nth(1).check();await page.waitForFunction(()=>window.dfFixture.paused);assert((await page.locator('.df-countdown').innerText()).includes('停止'));ok('用户操作勾选停止自动选择');
  await page.screenshot({path:path.join(root,'docs/screenshots/download-file-selection.png')});await page.locator('#dfConfirm').click();await page.locator('.df-dialog').waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>window.dfResponses.at(-1).indices),[0,1]);ok('确认仅提交已勾选文件');
  await page.evaluate(()=>{window.dfFixture={id:'choice-2',title:'Demo',seconds:9,paused:false,files:[{name:'a.safetensors'},{name:'b.gguf'}]};CftDownloadFiles.poll();});await page.locator('.df-dialog').waitFor();await page.locator('.df-option input').first().uncheck();assert.equal(await page.locator('#dfConfirm').isDisabled(),true);await page.locator('#dfCancel').click();assert.deepEqual(await page.evaluate(()=>window.dfResponses.at(-1).indices),[]);ok('空选择禁确认，取消不下载');
  await page.evaluate(()=>{window.dfFixture={id:'choice-3',title:'Demo',seconds:1,files:[{name:'x.safetensors'},{name:'y.gguf'}]};CftDownloadFiles.poll();});await page.locator('.df-dialog').waitFor();await page.evaluate(()=>window.dfFixture=null);await page.locator('.df-dialog').waitFor({state:'detached'});ok('后端超时决定默认下载，前端自动关闭过期弹窗');
  await page.evaluate(()=>{switchPage('settings');buildSettingsForm();showSettingsCategory('download');});assert.equal(await page.locator('[data-key=multi_file_download] option').count(),3);ok('下载行为设置提供选择/第一个/全部');
  assert.equal(errors.length,0,JSON.stringify(errors));ok('无前端异常');console.log('PASS '+passed+' workflow / variant checks');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
