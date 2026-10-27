const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const server=require('../scripts/preview_endfield_settings.cjs');
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready&&document.querySelector('.ef-preview-note'));
  const values=selector=>page.locator(selector).evaluate(el=>[...el.options].map(o=>o.value));
  assert.deepEqual(await values('select[data-key=theme]'),['dark_endfield','light_endfield']);
  assert.deepEqual(await values('select[data-key=download_hud_theme]'),['follow','dark_endfield','light_endfield']);
  assert.equal(await page.locator('.sidebar-brand .nav-logo img').getAttribute('src'),'logo.png');
  assert.match(await page.locator('.sidebar-name').innerText(),/CivitaiFreeTool[\s\S]*模型工作台/);
  assert.equal(await page.locator('.sidebar-wordmark-endfield').count(),0);
  assert.equal(await page.locator('[data-key=ui_scheme],[data-key=metro_accent]').count(),0);
  console.log('PASS 主主题、悬浮窗主题仅保留终末地，原头像和文字恢复');
  const cases=[['dark_glass',{},'dark_endfield'],['light_pink',{},'light_endfield'],['modern',{},'light_endfield'],['metro',{ui_scheme:'dark'},'dark_endfield'],['metro',{ui_scheme:'auto'},'light_endfield'],['unknown',{},'dark_endfield'],['',{dark_mode:false},'light_endfield']];
  for(const [legacy,extra,expected]of cases){
   const result=await page.evaluate(({legacy,extra})=>{delete state.cfg.dark_mode;delete state.cfg.ui_scheme;Object.assign(state.cfg,{theme:legacy,download_hud_theme:'light_glass'},extra);applyUiAppearance();buildSettingsForm();return{theme:state.cfg.theme,hud:state.cfg.download_hud_theme,selected:document.querySelector('[data-key=theme]').value,root:document.documentElement.dataset.theme,endfield:document.documentElement.dataset.endfield};},{legacy,extra});
   assert.deepEqual(result,{theme:expected,hud:'light_endfield',selected:expected,root:expected,endfield:'true'});
  }
  console.log('PASS 旧主题亮暗迁移，首次设置表单与实际主题一致');
  await page.locator('select[data-key=theme]').selectOption('dark_endfield',{force:true});
  await page.locator('#btnSaveSettings').click();await page.waitForFunction(()=>!settingsHaveChanges());
  await page.locator('#btnOnboarding').click();
  // Render the theme step directly: this isolated test must not enter an API key.
  await page.evaluate(()=>{obStep=2;renderOnboarding();});
  assert.deepEqual(await page.locator('#obBody .ob-theme').evaluateAll(nodes=>nodes.map(el=>el.dataset.t)),['dark_endfield','light_endfield']);
  await page.evaluate(()=>document.querySelector('#obMask').style.display='none');
  await page.locator('select[data-key=ui_zoom]').selectOption('110',{force:true});await page.mouse.move(0,0);
  await page.waitForFunction(()=>!document.querySelector('#efUnsavedNotice').hidden&&getComputedStyle(document.querySelector('#efUnsavedNotice')).opacity==='1');
  await page.locator('[data-settings-category=appearance]').click();await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/settings-theme-scope-v8.png')});
  assert.deepEqual(errors,[]);console.log('PASS 新手引导仅两主题，暗色实际未保存红条显示，无前端异常');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
