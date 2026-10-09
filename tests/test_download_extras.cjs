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

  await page.evaluate(()=>{
   window.settingsHaveChanges=()=>false;state.cfg.theme='dark_blue';state.cfg.ui_text_size='standard';document.documentElement.dataset.theme='dark_blue';applyUiAppearance();switchPage('dlmanager');
   const cv=document.createElement('canvas');cv.width=240;cv.height=360;const ctx=cv.getContext('2d');ctx.fillStyle='#356183';ctx.fillRect(0,0,240,360);ctx.fillStyle='#b1cce0';ctx.fillRect(30,80,180,180);window.extraCover=cv.toDataURL('image/png').split(',')[1];
   window.fixtureTasks=[{id:'one',filename:'one.safetensors',status:'paused',progress:20,downloaded:1,total:10,dest_dir:'D:/Demo/models'},{id:'two',filename:'two.safetensors',status:'paused',progress:10,downloaded:1,total:10,dest_dir:'D:/Demo/models'}];
   const original=api.call.bind(api);api.call=async(method,...args)=>{
    if(method==='get_task_thumbnails')return Object.fromEntries(args[0].map(id=>[id,window.extraCover]));
    if(method==='sync_local_model_updates'){window.fixtureSyncRequested=true;window.fixtureScanRows=[{path:'D:/Demo/live.safetensors',name:'live',modelId:7}];window.fixtureSyncItems={'D:/Demo/live.safetensors':{model_name:'Live'}};return {ok:true,removed:1,msg:'同步完成'};}
    if(method==='get_model_updates'&&window.fixtureSyncItems)return {items:window.fixtureSyncItems};
    if(method==='get_rename_default')return 'Mountain-v1.2.safetensors';
    return original(method,...args);
   };dlRefresh();
  });
  await page.waitForFunction(()=>document.querySelectorAll('#dlTable img.thumb').length===2);ok('未完成任务也能读取预取封面');
  await page.locator('#dlTable tr[data-task-id=one] .dl-task-check').check();await page.locator('#dlStartSel').click();
  const selected=await page.evaluate(()=>window.fixtureCalls.filter(x=>x.method==='dl_action').at(-1));assert.equal(selected.args[0],'start');assert.deepEqual(selected.args[2],['one']);ok('开始/继续选中只提交勾选任务 ID');

  await page.evaluate(()=>{window.fixtureTasks[0].status='retrying';window.fixtureTasks[0].speed=0;dlRefresh();});await page.waitForFunction(()=>document.querySelector('#dlTable tr[data-task-id=one]').textContent.includes('等待重试'));ok('重试等待与真实下载状态分开显示');
  await page.evaluate(async()=>{window.fixtureTasks[0].status='downloading';const original=api.call.bind(api);api.call=async(method,...args)=>{if(method==='set_download_order'){window.fixtureOrder=args[0];window.fixtureTasks.sort((a,b)=>args[0].indexOf(a.id)-args[0].indexOf(b.id));return {ok:true,msg:'排序已保存'};}return original(method,...args);};await dlRefresh();});
  const drag=await page.evaluateHandle(()=>new DataTransfer());await page.locator('#dlTable tr[data-task-id=two] .dl-drag-handle').dispatchEvent('dragstart',{dataTransfer:drag});await page.locator('#dlTable tr[data-task-id=one]').dispatchEvent('dragover',{dataTransfer:drag});await page.locator('#dlTable tr[data-task-id=one]').dispatchEvent('drop',{dataTransfer:drag});await page.waitForFunction(()=>window.fixtureOrder?.[0]==='two');assert.deepEqual(await page.evaluate(()=>window.fixtureOrder),['two','one']);ok('拖动手柄调整队列顺序，提交任务 ID 而非文件名');
  const selfDrag=await page.evaluateHandle(()=>new DataTransfer());await page.evaluate(()=>{window.fixtureOrder=null;});await page.locator('#dlTable tr[data-task-id=two] .dl-drag-handle').dispatchEvent('dragstart',{dataTransfer:selfDrag});await page.locator('#dlTable tr[data-task-id=two]').dispatchEvent('drop',{dataTransfer:selfDrag});assert.equal(await page.evaluate(()=>window.fixtureOrder),null);ok('拖回自身不改变顺序');
  const downDrag=await page.evaluateHandle(()=>new DataTransfer());const targetBounds=await page.locator('#dlTable tr[data-task-id=one]').boundingBox();await page.locator('#dlTable tr[data-task-id=two] .dl-drag-handle').dispatchEvent('dragstart',{dataTransfer:downDrag});await page.locator('#dlTable tr[data-task-id=one]').dispatchEvent('drop',{dataTransfer:downDrag,clientY:targetBounds.y+targetBounds.height-1});await page.waitForFunction(()=>window.fixtureOrder?.[0]==='one');assert.deepEqual(await page.evaluate(()=>window.fixtureOrder),['one','two']);ok('向下拖动可放到目标行之后');
  for(const [pageName,id,index] of [['dlmanager','dlTable',3],['dlmanager','dlHistoryTable',2],['updates','updTable',2],['reverse','rpTable',2]]){
   await page.evaluate(([name,id])=>{switchPage(name);if(id==='dlHistoryTable')document.querySelector('#dlHistoryTab').click();},[pageName,id]);
   const handle=page.locator('#'+id+' th').nth(index).locator('.dl-col-resize');await handle.scrollIntoViewIfNeeded();const before=await page.locator('#'+id+' th').nth(index).boundingBox();const box=await handle.boundingBox();
   await page.mouse.move(box.x+4,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+84,box.y+box.height/2,{steps:6});await page.mouse.up();
   const after=await page.locator('#'+id+' th').nth(index).boundingBox();assert(after.width>=before.width+74,JSON.stringify({id,before,after}));ok(id+' 可拖动并持久保存列宽');
   await handle.dblclick();const reset=await page.locator('#'+id+' th').nth(index).boundingBox();assert(Math.abs(reset.width-before.width)<3);ok(id+' 双击分隔线恢复默认');
  }
  for(const route of ['dlmanager','updates','reverse','workflow']){
   await page.evaluate(route=>{switchPage(route);if(route==='dlmanager')document.querySelector('#dlQueueTab').click();const img=new Image();img.src='data:image/png;base64,'+window.extraCover;img.className='hover-fixture';img.style.cssText='width:32px;height:48px;display:block';document.querySelector('#page-'+route).prepend(img);},route);
   const image=page.locator('#page-'+route+' .hover-fixture');await image.scrollIntoViewIfNeeded();await image.hover();await page.locator('.cover-hover-preview').waitFor();
   const popup=await page.locator('.cover-hover-preview').boundingBox();assert(popup.x>=0&&popup.y>=0&&popup.x+popup.width<=1920&&popup.y+popup.height<=1080);assert.equal(await page.locator('.cover-hover-preview').evaluate(e=>getComputedStyle(e).pointerEvents),'none');ok(route+' 悬浮大封面不遮挡交互且不越界');await page.mouse.move(20,20);await page.locator('.cover-hover-preview').waitFor({state:'detached'});
  }
  await page.evaluate(()=>{switchPage('updates');state.mmUpdItems={'D:/Demo/deleted.safetensors':{model_name:'Deleted'}};});await page.locator('#updSync').click();await page.waitForFunction(()=>window.fixtureSyncRequested);await page.waitForFunction(()=>!document.querySelector('#updSync').disabled);assert.deepEqual(await page.evaluate(()=>Object.keys(state.mmUpdItems)),['D:/Demo/live.safetensors']);ok('同步更新页替换陈旧列表并刷新模型列表');
  await page.evaluate(()=>{switchPage('settings');buildSettingsForm();showSettingsCategory('download');});assert.equal(await page.locator('[data-key=download_name_mode] option').count(),3);assert.equal(await page.locator('[data-key=filename_include_version]').isChecked(),false);ok('三种命名方式，附加版本默认关闭');
  await page.evaluate(()=>{switchPage('models');showRenameDialog('D:/Demo/raw.safetensors','raw.safetensors');});await page.locator('#rdInput').waitFor();assert.equal(await page.locator('#rdInput').inputValue(),'Mountain-v1.2');await page.locator('#rdCancel').click();ok('手动改名编辑框沿用默认命名设置');
  await page.evaluate(async()=>{switchPage('workflow');api.call=async(method,...args)=>method==='workflow_model_matches'?'[]':method==='get_covers'?JSON.stringify({'D:/Demo/live.safetensors':window.extraCover}):{};await wfRenderResult({ok:true,file:'flow.json',nodes:[{id:1,type:'Loader',position:[0,0]},{id:2,type:'Sampler',position:[300,0]}],edges:[{source:1,target:2,input:'model'}],models:[]});});await page.locator('#wfFull').click();assert.equal(await page.locator('#wfGraphSection').isVisible(),true);assert((await page.locator('#wfFull').getAttribute('class')).includes('btn-primary'));assert.equal(await page.locator('#wfGraphCanvas .wf-wire').count(),1);assert.equal(await page.locator('#wfGraphCanvas .wf-graph-node').count(),2);ok('完整画布渲染真实节点与连接线');
  await page.locator('.wf-graph-node[data-node-index="1"]').click();assert((await page.locator('#wfNodeDetail').innerText()).includes('Sampler'));ok('点击画布节点同步只读参数');

  await page.evaluate(async()=>{
   document.querySelectorAll('.hover-fixture').forEach(e=>e.remove());
   api.call=async(method,...args)=>method==='workflow_model_matches'?JSON.stringify(args[0].map((ref,i)=>({ref,local:true,path:'D:/Demo/'+ref,sha256:'fixture'}))):method==='get_covers'?JSON.stringify(Object.fromEntries(args[0].map(p=>[p,window.extraCover]))):{};
   const nodes=[
    {id:1,type:'CheckpointLoaderSimple',title:'加载基础模型',position:[0,150],widgets:['landscape.safetensors']},
    {id:2,type:'CLIPTextEncode',title:'正向提示词',position:[300,0],parameters:[{name:'text',value:'watercolor landscape'}]},
    {id:3,type:'CLIPTextEncode',title:'负向提示词',position:[300,170],parameters:[{name:'text',value:'blurry, low quality'}]},
    {id:4,type:'LoraLoader',title:'加载水彩风格',position:[300,350],parameters:[{name:'strength_model',value:0.8}]},
    {id:5,type:'KSampler',title:'采样器',position:[610,160],parameters:[{name:'steps',value:24},{name:'cfg',value:7}]},
    {id:6,type:'VAEDecode',title:'图像解码',position:[910,160]},
    {id:7,type:'SaveImage',title:'保存图片',position:[1210,160]}
   ];const edges=[[1,2,'clip'],[1,3,'clip'],[1,4,'model'],[2,5,'positive'],[3,5,'negative'],[4,5,'model'],[5,6,'samples'],[1,6,'vae'],[6,7,'images']].map(([source,target,input])=>({source,target,input}));
   await wfRenderResult({ok:true,file:'landscape-workflow.json',source:'comfyui',has_workflow:true,nodes,edges,models:['landscape.safetensors','watercolor.safetensors'],pos_prompt:'watercolor landscape, mountain lake, soft light',neg_prompt:'blurry, low quality'});
   document.querySelector('#wfFull').click();document.querySelector('#wfGraphFit').click();document.querySelector('.content').scrollTop=0;
  });assert.equal(await page.locator('.wf-model-cover:not([hidden])').count(),2);ok('工作流引用模型展示现有封面');
  await page.screenshot({path:path.join(root,'docs/screenshots/workflow-full.png')});await page.locator('#wfSimple').click();assert.equal(await page.locator('#wfGraphSection').isVisible(),false);ok('精简/完整切换且记住视图');
  await page.evaluate(async()=>{await wfRenderResult({ok:true,file:'forge.png',source:'forge',nodes:[],edges:[],models:[],pos_prompt:'watercolor',generation_parameters:{Steps:'24',Seed:'123'}});});await page.locator('#wfFull').click();assert.equal(await page.locator('#wfGraphCanvas .wf-wire').count(),0);assert((await page.locator('#wfGraphCanvas').innerText()).includes('不绘制虚假连线'));assert((await page.locator('#wfNodeDetail').innerText()).includes('Seed'));ok('Forge 只展示已有生成参数，不伪造 ComfyUI 连接');
  assert.equal(errors.length,0,JSON.stringify(errors));ok('新增页面无前端异常');console.log('PASS '+passed+' download extras checks');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
