/* Source inventory and synthetic presentation checks; never invoke native actions. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const server=require('../scripts/preview_endfield_settings.cjs');
function inventory(){
 const found=new Map();
 for(const file of ['web/index.html','web/app.js','web/appearance.js','web/commands.js']){
  const source=fs.readFileSync(path.resolve(file),'utf8');
  for(const footer of source.matchAll(/<(?:div|footer)\b[^>]*(?:class="[^"]*(?:rd-actions|ms-footer|ob-actions2?|upd-footer|font-picker-footer)[^"]*"|id="settingsActions")[^>]*>/g)){
   const start=footer.index+footer[0].length;let depth=1,end=start;
   for(const tag of source.slice(start).matchAll(/<(\/?)(div|footer)\b[^>]*>/g)){
    depth+=tag[1]?-1:1;if(!depth){end=start+tag.index+tag[0].length;break;}
   }
   for(const button of source.slice(start,end).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
    const id=button[1].match(/id="([^"]+)"/)?.[1],classes=button[1].match(/class="([^"]+)"/)?.[1]||'';
    if(!id||classes.split(/\s+/).includes('btn-primary')||id==='btnSaveSettings')continue;
    found.set(id,{id,file,line:source.slice(0,start+button.index).split('\n').length,label:button[2].replace(/<[^>]*>/g,'').trim()});
   }
  }
 }
 return [...found.values()];
}
(async()=>{
 const entries=inventory();assert.equal(entries.length,38);
 fs.writeFileSync(path.resolve('.test_tmp/endfield-settings-preview/secondary-button-inventory.json'),JSON.stringify(entries,null,2));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready&&document.querySelector('.ef-preview-note'));
  for(const theme of ['dark_endfield','light_endfield']){
   await page.evaluate(theme=>{state.cfg.theme=theme;document.documentElement.dataset.theme=theme;applyUiAppearance();buildSettingsForm();switchPage('settings');showSettingsCategory('appearance');},theme);
   const dark=theme==='dark_endfield',fill=dark?'rgb(209, 211, 207)':'rgb(72, 75, 71)',ink=dark?'rgb(81, 86, 78)':'rgb(240, 241, 235)',icon=dark?'rgb(67, 74, 64)':'rgb(240, 241, 233)';
   const check=async locator=>{
    const buttons=await locator.evaluateAll(nodes=>nodes.map(el=>({fill:getComputedStyle(el).backgroundColor,ink:getComputedStyle(el).color,icon:getComputedStyle(el.querySelector('.ef-action-circle')).color,texture:getComputedStyle(el.querySelector('.ef-action-texture')).filter,ring:getComputedStyle(el.querySelector('.ef-action-circle'),':after').content,center:(()=>{const b=el.getBoundingClientRect(),c=el.querySelector('.ef-action-caption').getBoundingClientRect();return (c.left+c.right-b.left-b.right)/2;})()})));
    assert(buttons.length);for(const button of buttons){assert.equal(button.fill,fill);assert.equal(button.ink,ink);assert.equal(button.icon,icon);assert.equal(button.texture,dark?'none':'invert(1)');assert.equal(button.ring,'none');assert(Math.abs(button.center)<.6,JSON.stringify(button));}
   };
   await check(page.locator('#settingsActions>.ef-action-secondary'));
   assert.equal(await page.locator('#btnSaveSettings').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 239, 1)');
   for(const id of ['btnTestApi','btnTestBaidu','btnOnboarding','btnSaveSettings']){
    await page.locator('#'+id).hover();const outline=await page.locator('#'+id).evaluate(el=>{const s=getComputedStyle(el);return[s.outlineColor,s.outlineWidth,s.outlineOffset];});assert.deepEqual(outline,['rgb(255, 239, 1)','2px','2px']);
   }
   await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/secondary-settings-'+theme+'-v11.png')});
   await page.locator('#settingsActions').screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/secondary-footer-'+theme+'-v11.png')});
   await page.locator('#fontChoice').click();await page.waitForFunction(()=>document.querySelector('#fontCancel.ef-action-secondary'));
   await check(page.locator('#fontCancel'));
   for(const id of ['fontCancel','fontConfirm']){await page.locator('#'+id).hover();const result=await page.locator('#'+id).evaluate(el=>{const s=getComputedStyle(el),b=el.getBoundingClientRect(),c=el.querySelector('.ef-action-caption').getBoundingClientRect();return{ring:s.outlineColor,center:(c.left+c.right-b.left-b.right)/2};});assert.equal(result.ring,'rgb(255, 239, 1)');assert(Math.abs(result.center)<.6);}
   await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/font-capsule-hover-'+theme+'-v12.png')});await page.locator('#fontCancel').click();
   // Exercise every inventoried label through every shared footer selector. These
   // are inert replicas, not real confirmations, downloads or destructive actions.
   await page.evaluate(entries=>{
    const host=document.createElement('section');host.id='secondaryPaletteAudit';host.style.cssText='position:fixed;left:-20000px;top:0';
    for(const cls of ['rd-actions','font-picker-footer','font-action-base','about-action-base','settings-exit-base','ms-footer','ob-actions','ob-actions2','upd-footer']){
     const footer=document.createElement('div');footer.className=cls;
     for(const entry of entries){const b=document.createElement('button');b.className='btn';b.type='button';b.textContent=entry.label;footer.append(b);}host.append(footer);
    }document.body.append(host);
   },entries);
   await page.waitForFunction(()=>document.querySelectorAll('#secondaryPaletteAudit .ef-action-secondary').length===342);
   await check(page.locator('#secondaryPaletteAudit button'));
   await page.evaluate(()=>document.querySelector('#secondaryPaletteAudit').remove());
   console.log('PASS '+theme+' 38个入口、9种页脚容器文字全部居中；设置页四按钮、字体取消/确认悬停黄圈实测，原色板与主按钮不变');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
