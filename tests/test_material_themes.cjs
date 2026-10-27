const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web');
const source=fs.readFileSync(path.join(__dirname,'test_ui_preferences.cjs'),'utf8').replace(/\r\n/g,'\n');
const begin=source.indexOf('await page.addInitScript(')+'await page.addInitScript('.length,end=source.indexOf('\n    });\n    const url',begin)+6,init=eval('('+source.slice(begin,end)+')');
const server=http.createServer((req,res)=>{const p=path.join(web,decodeURIComponent(req.url).split('?')[0]);fs.readFile(p,(e,b)=>{res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(e?'':b)});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:1280,height:820}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(init);await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.waitForFunction(()=>window.__ready);
for(const theme of ['dark_endfield','light_endfield','dark_glass','light_glass']){await page.evaluate(t=>{window.settingsHaveChanges=()=>false;state.cfg.theme=t;document.documentElement.dataset.theme=t;applyUiAppearance();switchPage('settings');},theme);await page.waitForTimeout(300);assert.equal(await page.locator('[data-key="theme"] option[value="'+theme+'"]').count(),1);await page.screenshot({path:path.join(root,'docs/screenshots/hud','app-'+theme+'.png')});const colors=await page.evaluate(()=>{let s=getComputedStyle(document.documentElement);return [s.getPropertyValue('--text').trim(),s.getPropertyValue('--bg').trim()]});assert.notEqual(colors[0],colors[1]);assert.equal(await page.locator('[data-key="download_hud_enabled"]').count(),1);}
for(const width of [980,1280,1920]){await page.setViewportSize({width,height:820});await page.evaluate(()=>{state.cfg.theme='light_endfield';document.documentElement.dataset.theme='light_endfield';applyUiAppearance();switchPage('models');});await page.waitForTimeout(200);const boxes=await page.locator('.nav-tab').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {top:b.top,bottom:b.bottom}}));assert(boxes.every(b=>b.top>=0&&b.bottom<=100),JSON.stringify(boxes));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(root,'docs/screenshots/hud','endfield-models-'+width+'.png')});}
await page.evaluate(()=>{document.documentElement.dataset.theme='dark_blue';applyUiAppearance();});await page.waitForTimeout(100);assert.equal(await page.locator('html').getAttribute('data-endfield'),'false');assert.equal(await page.locator('use[href^="#ef-"]').count(),0);

assert.equal(await page.locator('#startupStage').isVisible(),false,'initialization completes');
await page.evaluate(()=>document.fonts.load('400 24px CFTUrbanism'));
assert.equal(await page.evaluate(()=>document.fonts.check('400 24px CFTUrbanism')),true,'bundled font loads');
const themes=await page.locator('[data-key="theme"] option').evaluateAll(ns=>ns.map(n=>n.value));
assert.equal(themes.length,18);
for(const theme of themes){
 await page.evaluate(t=>{state.cfg.theme=t;document.documentElement.dataset.theme=t;applyUiAppearance();},theme);
 for(const id of ['download','dlmanager','models','updates','reverse','workflow','settings']){
  await page.evaluate(id=>switchPage(id),id);await page.waitForTimeout(30);
  assert.equal(await page.locator('#page-'+id).isVisible(),true,theme+' '+id);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,theme+' '+id+' overflow');
 }
}
await page.setViewportSize({width:1440,height:940});
await page.evaluate(()=>{
 state.cfg.theme='light_endfield';document.documentElement.dataset.theme='light_endfield';applyUiAppearance();switchPage('models');
 state.models=Array.from({length:16},(_,i)=>({path:'D:/Demo/models/'+i+'.safetensors',name:'Landscape-study-'+(i+1)+'.safetensors',civitai_name:['山川研究 / Alpine Survey','暮色边界 / Frontier','风格档案 / Mineral Study','静谧海岸 / Coastal Light'][i%4],type:'LORA',type_filter:'LORA',base:i%2?'SDXL':'Anima',ver:'v1.0',size:(120+i*4)*1048576,mtime:1,author:'CFT Demo'}));
 state.models.forEach((r,i)=>{const c=document.createElement('canvas');c.width=360;c.height=420+(i%3)*70;const g=c.getContext('2d');g.fillStyle=['#a5c5cc','#e2c59d','#9aa8b1','#a7b4a5'][i%4];g.fillRect(0,0,c.width,c.height);g.fillStyle='#f5e1a6';g.beginPath();g.arc(265,90,35,0,Math.PI*2);g.fill();for(let j=0;j<3;j++){g.fillStyle=['#6d8990','#48666c','#28454d'][j];g.beginPath();g.moveTo(0,c.height);g.lineTo(0,230+j*45);g.lineTo(95,120+j*65);g.lineTo(230,240+j*45);g.lineTo(360,130+j*65);g.lineTo(360,c.height);g.fill();}g.fillStyle='#e3e9e3';g.font='18px sans-serif';g.fillText('CFT / DEMO '+String(i+1).padStart(2,'0'),20,c.height-30);state.coverCache.set(r.path,c.toDataURL('image/png'));});
 window.fixtureScanRows=state.models;state.mmView='masonry';syncViewSeg();setMasonrySize(210);applyMmFilter();$('#mmCount').textContent='16 个演示模型';
 const first=state.models[0];window.fixtureCoverB64=state.coverCache.get(first.path).split(',')[1];window.fixtureDetail={ok:true,path:first.path,name:first.name,info:{name:first.civitai_name,type:'LoRA',baseModel:'Anima',version:{name:'v1.0'},trainedWords:['landscape','mineral'],description:'用于界面演示的虚构模型；未连接真实下载。'},covers:[{b64:fixtureCoverB64,meta:{prompt:'mountain landscape, mineral texture, warm light',negativePrompt:'blur',steps:26,cfgScale:6,seed:2026},resources:[{name:'Alpine Survey',type:'LoRA',modelId:123,version:'v1.0'}],metadata_source:'演示数据（非用户图片）'}]};showModelDetail(first.path);
});
await page.waitForTimeout(500);
for(const theme of ['light_endfield','dark_endfield','light_glass','dark_glass']){
 await page.evaluate(t=>{state.cfg.theme=t;document.documentElement.dataset.theme=t;applyUiAppearance();},theme);await page.waitForTimeout(150);
 await page.screenshot({path:path.join(root,'docs/screenshots/hud','models-'+theme+'.png')});
}
await page.evaluate(()=>{state.cfg.theme='light_endfield';document.documentElement.dataset.theme='light_endfield';applyUiAppearance();state.cfg.endfield_parallax=false;CFTEndfield.reset();});
await page.mouse.move(100,200);assert.equal(await page.locator('#efTerrain').evaluate(n=>n.style.getPropertyValue('--ef-rx')),'');
await page.evaluate(()=>state.cfg.endfield_parallax=true);await page.mouse.move(500,400);await page.waitForTimeout(60);assert.notEqual(await page.locator('#efTerrain').evaluate(n=>n.style.getPropertyValue('--ef-rx')),'');
await page.mouse.move(1430,930);await page.waitForTimeout(500);await page.evaluate(()=>openImageViewer(window.fixtureDetail));await page.waitForTimeout(350);assert.equal(await page.locator('.iv-generation').isVisible(),true);
const viewer=await page.locator('.iv-body').boundingBox();assert(viewer.x>=0&&viewer.x+viewer.width<=1441);
await page.screenshot({path:path.join(root,'docs/screenshots/hud','endfield-viewer.png')});await page.evaluate(()=>closeImageViewer());
await page.evaluate(()=>{const original=api.call.bind(api);api.call=(method,...args)=>method==='get_version'?Promise.resolve(JSON.stringify({ok:true,version:'2.6.27'})):original(method,...args);});
await page.route('https://api.github.com/**',r=>r.fulfill({json:[]}));
for(const theme of ['light_endfield','dark_glass','dark_blue']){
 await page.evaluate(async t=>{state.cfg.theme=t;document.documentElement.dataset.theme=t;applyUiAppearance();await showAbout();},theme);
 assert.equal(await page.locator('.ef-credits').count(),1);
 const ab=await page.locator('.about-dlg').boundingBox();assert(ab.y>=0&&ab.y+ab.height<=941,theme+' about fits viewport');
 assert.equal(await page.locator('.about-wordmark').getAttribute('src'),'about-wordmark.svg');
 assert.doesNotMatch(await page.locator('.about-dlg').innerText(),/URBANISM|城市化/);
 await page.locator('#aboutBodyFontSource').click();assert.equal(await page.evaluate(()=>fixtureCalls.at(-1).args[0]),'https://github.com/howlingFounts/GeourceSans/');
 if(theme==='light_endfield')await page.screenshot({path:path.join(root,'docs/screenshots/hud','endfield-about.png')});
 await page.locator('#aboutOk').click();
}
assert.deepEqual(errors,[]);console.log('PASS four app themes + settings entries + no JS errors');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
