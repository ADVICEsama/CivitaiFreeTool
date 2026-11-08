const {chromium}=require(process.env.PLAYWRIGHT_PATH),server=require('../scripts/preview_endfield_settings.cjs'),assert=require('node:assert/strict'),path=require('path');
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();try{
 for(const theme of ['dark_endfield','light_endfield']){
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready);
  await page.evaluate(theme=>{state.cfg.theme=theme;applyUiAppearance();showOnboarding();},theme);
  const locales=await page.evaluate(()=>Object.keys(CFTLocales));
  for(const locale of locales)for(let step=0;step<6;step++){
   await page.evaluate(({locale,step})=>{obStep=step;renderOnboarding();CFTI18n.apply(locale);},{locale,step});
   const bad=await page.evaluate(()=>[...document.querySelectorAll('#obMain [data-i18n]')].flatMap(e=>{
    const key=e.dataset.i18n;return !Object.hasOwn(CFTLocales[CFTI18n.locale],key)||e.textContent!==CFTI18n.t(key)?[key]:[];
   }));assert.deepEqual(bad,[],`${theme}/${locale}/${step}: all guide text has native keys`);
   assert.equal(await page.locator('#obSkipAll').isEnabled(),true);
  }
  await page.evaluate(()=>{obStep=0;renderOnboarding();CFTI18n.apply('zh-TW');});
  await page.locator('#obKey').fill('not-a-real-key-測試');await page.locator('#obToggleGuide').click();
  await page.evaluate(()=>CFTI18n.apply('en'));assert.equal(await page.locator('#obKey').inputValue(),'not-a-real-key-測試');assert(await page.locator('#obGuide').isVisible());
  await page.evaluate(()=>{obStep=3;renderOnboarding();});await page.locator('#obDir').fill('D:\\測試\\my models');await page.evaluate(()=>CFTI18n.apply('zh-TW'));assert.equal(await page.locator('#obDir').inputValue(),'D:\\測試\\my models');
  await page.evaluate(()=>{obStep=4;obModelDirs=['D:\\角色\\<script>&模型'];renderOnboarding();CFTI18n.apply('en');});assert.equal(await page.locator('#obModelDirs').inputValue(),'D:\\角色\\<script>&模型');
  assert((await page.locator('#obBody bdi').first().innerText()).includes('D:\\sd-webui-forge-neo\\webui\\models'));
  for(const zoom of [80,100,125,150]){
   await page.evaluate(zoom=>{applyZoom(zoom);obStep=0;renderOnboarding();CFTI18n.apply('zh-TW');},zoom);
   const trigger=page.locator('#obLanguagePicker .ef-select-trigger');await trigger.click();await page.waitForTimeout(700);
   assert(await page.locator('#efSettingsSelectMenu').isVisible(),`${theme}/${zoom}: list remains open`);
   const bounds=await page.evaluate(()=>{const t=document.querySelector('#obLanguagePicker .ef-select-trigger').getBoundingClientRect(),m=document.querySelector('#efSettingsSelectMenu'),r=m.getBoundingClientRect();return {gap:m.dataset.direction==='below'?r.top-t.bottom:t.top-r.bottom,left:r.left-t.left,width:r.width-t.width,top:r.top,bottom:r.bottom,h:innerHeight};});
   assert(bounds.gap>=-2&&bounds.gap<=1,JSON.stringify({theme,zoom,...bounds}));assert(Math.abs(bounds.width)<2,JSON.stringify(bounds));assert(Math.abs(bounds.left)<2,JSON.stringify(bounds));assert(bounds.top>=0&&bounds.bottom<=bounds.h+1,JSON.stringify(bounds));
   if(zoom===100)await page.screenshot({path:path.resolve('.test_tmp/onboarding-localized-'+theme+'.png')});
   await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:680,height:800});await page.evaluate(()=>{applyZoom(100);CFTI18n.apply('de');obStep=1;renderOnboarding();});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  assert.deepEqual(errors,[]);console.log('PASS',theme,'10 locales × 6 guide steps; inputs preserved; dropdown 80/100/125/150%; narrow layout');await page.close();
 }
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
