const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const server=require('../scripts/preview_endfield_settings.cjs');
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready&&document.querySelector('#fontChoice'));
 const row=key=>page.locator('[data-setting-key="'+key+'"]');
 assert.equal(await page.locator('[data-key=endfield_display_font]').count(),0);
 const keys=await page.evaluate(()=>SETTING_FIELDS.map(f=>f[1]));assert.equal(new Set(keys).size,keys.length);
 assert.equal(await page.locator('#fontChoice').count(),1);assert.equal(await page.locator('[data-key=ui_font]').isVisible(),false);
 console.log('PASS 设置字段无重复，字体只保留一个可见入口');
 await page.evaluate(()=>{state.cfg.window_appearance='mica_alt';state.cfg.ambient_bg=true;state.cfg.metro_accent='#107C10';});
 for(const theme of ['light_endfield','dark_endfield']){
  await page.evaluate(t=>{state.cfg.theme=t;document.documentElement.dataset.theme=t;applyUiAppearance();},theme);
  assert(await row('endfield_parallax').isVisible());assert(!await row('window_appearance').isVisible());assert(!await row('ambient_bg').isVisible());
 }
 await page.locator('#settingsSearch').fill('原生标题栏');assert(!await row('window_appearance').isVisible());await page.locator('#settingsSearch').fill('');
 console.log('PASS 终末地无效材质/氛围入口收起，搜索也不再显示');
 await page.evaluate(()=>{state.cfg.theme='dark';document.documentElement.dataset.theme='dark';applyUiAppearance();});
 assert(await row('window_appearance').isVisible());assert(await row('ambient_bg').isVisible());assert(!await row('endfield_parallax').isVisible());assert.equal(await page.evaluate(()=>state.cfg.window_appearance),'mica_alt');
 console.log('PASS 切回其他主题恢复入口和原配置');
 await page.evaluate(()=>{state.cfg.theme='metro';document.documentElement.dataset.theme='metro';state.cfg.custom_accent_enabled=false;applyUiAppearance();});
 assert(await row('metro_accent').isVisible());assert(!await row('custom_accent').isVisible());
 await page.locator('[data-key=custom_accent_enabled]').check();assert(!await row('metro_accent').isVisible());assert(await row('custom_accent').isVisible());
 await page.locator('[data-key=custom_accent_enabled]').uncheck();assert(await row('metro_accent').isVisible());assert.equal(await page.evaluate(()=>state.cfg.metro_accent),'#107C10');
 console.log('PASS 两种强调色入口互斥，旧值保留');
 await page.evaluate(()=>{state.cfg.theme='dark_endfield';document.documentElement.dataset.theme='dark_endfield';applyUiAppearance();});
 await page.locator('#settingsSearch').fill('字体');await page.waitForTimeout(300);await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/settings-cleanup.png')});
 assert.deepEqual(errors,[]);console.log('PASS 无前端异常');
}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1});
