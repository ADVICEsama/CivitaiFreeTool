/* Actual Chromium UI, synthetic models and mocked bridge; no user configuration. */
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
   window.settingsHaveChanges=()=>false;switchPage('models');state.cfg.model_toolbar_locked=true;state.cfg.theme='dark_blue';document.documentElement.dataset.theme='dark_blue';state.cfg.ui_text_size='standard';applyUiAppearance();
   window.filterChoices={};window.filterRecursive=true;window.filterRoot=true;window.filterSaveCount=0;
   const original=api.call.bind(api);api.call=async(method,...args)=>{
    if(method==='get_folders')return JSON.stringify({root:'D:/Demo/models',tree:[{name:'A',path:'A',children:[{name:'B',path:'A/B',children:[{name:'C',path:'A/B/C',children:[]}]},{name:'D',path:'A/D',children:[]}]}],hidden:Object.keys(filterChoices).filter(p=>!filterChoices[p]),visibility:filterChoices,show_root:filterRoot,include_subfolders:filterRecursive});
    if(method==='save_folders'){if(window.filterSaveError)return false;window.filterChoices={...args[2]};window.filterRoot=args[1];window.filterSaveCount++;return true;}
    return original(method,...args);
   };window.filterScanCalls=0;window.mmScan=()=>{window.filterScanCalls++;};
   state.models=['Checkpoint','LORA','VAE','Controlnet','Unknown'].map((type,i)=>({path:'D:/Demo/models/'+i+'.safetensors',name:type+'.safetensors',civitai_name:'演示 '+type,type:type==='Unknown'?'':type,type_filter:type,base:i===1?'SDXL':'Anima',ver:'v1',size:100,mtime:1}));state.models.forEach((r,i)=>{r.size=(i===0?3000:150)*1048576;const c=document.createElement('canvas');c.width=240;c.height=320+(i%3)*40;const g=c.getContext('2d');g.fillStyle=['#90b9c7','#9e8ba7','#95b9aa'][i%3];g.fillRect(0,0,c.width,c.height);g.fillStyle='#f7d9a3';g.beginPath();g.arc(180,60,25,0,Math.PI*2);g.fill();g.fillStyle='#284355';g.beginPath();g.moveTo(0,c.height);g.lineTo(0,180);g.lineTo(75,140);g.lineTo(150,220);g.lineTo(240,140);g.lineTo(240,c.height);g.fill();g.fillStyle='#fff';g.font='16px sans-serif';g.fillText('DEMO / '+r.type_filter,15,c.height-20);state.coverCache.set(r.path,c.toDataURL('image/jpeg'));});$('#mmCount').textContent='5 个演示模型';state.mmView='list';applyMmFilter();
  });
  for(const [value,name] of [['Checkpoint','Checkpoint'],['LORA','LORA'],['VAE','VAE'],['Controlnet','Controlnet'],['Unknown','Unknown']]){
   await page.locator('#mmTypeF').selectOption(value);assert.deepEqual(await page.evaluate(()=>state.display.map(r=>r.name)),[name+'.safetensors']);assert.equal(await page.locator('#mmTable tbody tr').count(),1);if(value==='Checkpoint')await page.screenshot({path:path.join(root,'docs/screenshots/model-type-filter.png')});
  }ok('大模型、LoRA、VAE、ControlNet、未识别类型均可筛选');
  await page.locator('#mmTypeF').selectOption('LORA');await page.locator('#mmBaseF').selectOption('Anima');assert.equal(await page.evaluate(()=>state.display.length),0);await page.locator('#mmBaseF').selectOption('');ok('类型筛选与底模筛选叠加');
  await page.locator('#mmViewMasonry').click();assert.equal(await page.evaluate(()=>state.display.length),1);await page.locator('#mmTypeF').selectOption('');assert.equal(await page.evaluate(()=>state.display.length),5);ok('类型筛选兼容瀑布流，全部类型恢复列表');
  await page.locator('#mmFolders').click();await page.locator('#fmAll').waitFor();
  const item=p=>page.locator('#mmFoldersPanel .fm-item[data-path="'+p+'"]');
  assert.equal(await item('A/B').getAttribute('aria-checked'),'true');await item('A').click();await page.waitForFunction(()=>window.filterChoices.a===false);assert.equal(await item('A/B').getAttribute('aria-checked'),'false');ok('未单独指定的子目录继承父级隐藏');
  await item('A/B').click();await page.waitForFunction(()=>window.filterChoices['a/b']===true);assert.equal(await item('A').getAttribute('aria-checked'),'false');assert.equal(await item('A/B').getAttribute('aria-checked'),'true');assert.equal(await item('A/B/C').getAttribute('aria-checked'),'true');ok('隐藏 A 后可勾选 B，且 B 包含未另选的子目录');await page.screenshot({path:path.join(root,'docs/screenshots/model-folder-filter.png')});
  await item('A').click();await page.waitForFunction(()=>window.filterChoices.a===true);await item('A/B').click();await page.waitForFunction(()=>window.filterChoices['a/b']===false);assert.equal(await item('A/D').getAttribute('aria-checked'),'true');assert.equal(await item('A/B/C').getAttribute('aria-checked'),'false');ok('勾选 A、取消 B：其它内容保留，B 子树排除');
  await item('A/B/C').focus();await page.keyboard.press('Space');await page.waitForFunction(()=>window.filterChoices['a/b/c']===true);assert.equal(await item('A/B/C').getAttribute('aria-checked'),'true');ok('更深子目录可独立选择，支持键盘空格');
  await page.keyboard.press('Escape');await page.locator('#mmFolders').click();await page.locator('#fmAll').waitFor();assert.equal(await item('A/B').getAttribute('aria-checked'),'false');assert.equal(await item('A/B/C').getAttribute('aria-checked'),'true');assert.deepEqual(await page.evaluate(()=>state.cfg.model_folder_visibility),await page.evaluate(()=>window.filterChoices));ok('重开保留选择，前端配置同步避免保存设置覆盖');
  await page.evaluate(()=>{window.filterSaveError=true;});await item('A/B').click();await page.waitForFunction(()=>!fmSaving);assert.equal(await item('A/B').getAttribute('aria-checked'),'false');await page.evaluate(()=>{window.filterSaveError=false;});ok('保存失败保留原选择');
  await page.locator('#fmAll').click();await page.waitForFunction(()=>!fmSaving);assert.equal(await page.locator('#mmFoldersPanel .fm-item[aria-checked=false]').count(),0);await page.locator('#fmNone').click();await page.waitForFunction(()=>!fmSaving);assert.equal(await page.locator('#mmFoldersPanel .fm-item[aria-checked=true]').count(),0);ok('全部显示/隐藏包含所有层级和根目录');
  await page.keyboard.press('Escape');await page.evaluate(()=>{window.filterRecursive=false;window.filterChoices={a:true};});await page.locator('#mmFolders').click();await page.locator('#fmAll').waitFor();assert.equal(await item('A').getAttribute('aria-checked'),'true');assert.equal(await item('A/B').getAttribute('aria-checked'),'false');assert((await page.locator('#mmFoldersPanel').innerText()).includes('直属'));await item('A/B').click();await page.waitForFunction(()=>window.filterChoices['a/b']===true);assert.equal(await item('A/B/C').getAttribute('aria-checked'),'false');ok('直属模式仅显示明确勾选目录，不自动包含 B/C');
  await page.keyboard.press('Escape');await page.evaluate(()=>{switchPage('settings');state.cfg.model_folder_include_subfolders=true;buildSettingsForm();showSettingsCategory('appearance');});assert.equal(await page.locator('[data-key=model_folder_include_subfolders]').isChecked(),true);ok('设置入口位于外观布局，递归默认开启');
  const scanBefore=await page.evaluate(()=>window.filterScanCalls);await page.locator('[data-key=model_folder_include_subfolders]').uncheck();await page.locator('#btnSaveSettings').click();await page.waitForFunction(()=>state.cfg.model_folder_include_subfolders===false);assert((await page.evaluate(()=>window.filterScanCalls))>scanBefore);ok('保存直属模式后立即刷新，毋须重启');
  await page.evaluate(()=>{switchPage('models');state.mmView='list';applyMmFilter();});await page.setViewportSize({width:1000,height:850});await page.locator('#mmTypeF').scrollIntoViewIfNeeded();assert.equal(await page.locator('#mmTypeF').isVisible(),true);assert((await page.locator('#mmTypeF').boundingBox()).width>100);ok('小窗类型筛选仍可见，不挤成窄列');
  assert.equal(errors.length,0,JSON.stringify(errors));ok('无前端异常');console.log('PASS '+passed+' model filter checks');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
