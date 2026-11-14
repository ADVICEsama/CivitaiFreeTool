const {chromium}=require(process.env.PLAYWRIGHT_PATH),server=require('../scripts/preview_endfield_settings.cjs'),assert=require('node:assert/strict');
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();try{
const p=await browser.newPage({viewport:{width:2560,height:1440}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:'+server.address().port+'/?models=masonry');await p.waitForFunction(()=>window.__ready);
for(const theme of ['dark_endfield','light_endfield']){
 await p.evaluate(theme=>{state.cfg.theme=theme;applyUiAppearance();applyZoom(125);showOnboarding();obStep=5;renderOnboarding();},theme);await p.waitForTimeout(350);
 const guide=await p.locator('#obMain').boundingBox();assert(guide.width>1500,JSON.stringify(guide));assert(guide.height>900,JSON.stringify(guide));
 await p.locator('#obBody .ob-actions2 button').first().scrollIntoViewIfNeeded();await p.screenshot({path:'.test_tmp/v317-guide-'+theme+'.png'});
 await p.evaluate(()=>finishOnboarding({skip:true}));await p.waitForTimeout(350);
 await p.evaluate(()=>{switchPage('settings');showSettingsCategory('download');});assert.equal(await p.locator('[data-key=download_target_dir]').count(),0);assert(await p.locator('[data-key=download_cover]').isVisible());
 await p.evaluate(()=>{switchPage('models');});await p.locator('#mmUpdOnly').click();assert.equal(await p.locator('#mmUpdOnly').getAttribute('aria-pressed'),'true');assert.equal(await p.locator('#mmUpdOnly').evaluate(e=>getComputedStyle(e).color),'rgb(255, 239, 1)');await p.locator('#mmUpdOnly').click();
 await p.setViewportSize({width:950,height:780});await p.evaluate(()=>{showModelContextMenu({preventDefault(){},clientX:300,clientY:190},{...state.models[0],civitai_name:'Long title '.repeat(80)});});
 const menu=await p.locator('#ctxMenu').boundingBox();assert(menu.width<400&&menu.x>=0&&menu.x+menu.width<=950);assert(await p.locator('#ctxMenu .ctx-item').first().evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));await p.screenshot({path:'.test_tmp/v317-context-'+theme+'.png'});await p.keyboard.press('Escape');
 await p.setViewportSize({width:1800,height:1100});await p.evaluate(()=>{window.linkCalls=[];const original=api.call.bind(api);api.call=async(n,...a)=>{if(['open_url','copy_text'].includes(n)){linkCalls.push([n,a[0]]);return true;}return original(n,...a);};showAbout();});await p.waitForSelector('#aboutWebsite');await p.locator('#aboutWebsite').click();assert(await p.evaluate(()=>linkCalls.filter(x=>x[1]==='https://advicesama.github.io/CivitaiFreeTool/').length===2));await p.screenshot({path:'.test_tmp/v317-about-'+theme+'.png'});await p.locator('#aboutOk').click();await p.waitForTimeout(300);await p.setViewportSize({width:2560,height:1440});
}
assert.deepEqual(errors,[]);console.log('PASS guide height and width / removed preset / default cover setting / update filter gold / narrow long-name context hit targets / website open+copy');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
