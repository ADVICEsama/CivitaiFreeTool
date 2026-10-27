/* Synthetic covers only; tests real UI events, no user model or configuration changes. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const server=require('../scripts/preview_endfield_settings.cjs');
const out=path.resolve('.test_tmp/endfield-settings-preview');
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();try{
 for(const theme of ['dark_endfield','light_endfield']){
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?models=grid');await page.waitForSelector('.ms-card');
  await page.evaluate(t=>{state.cfg.theme=t;applyUiAppearance();},theme);
  const card=page.locator('.ms-card').first();await card.click();await page.waitForSelector('#dMain');const box=await card.boundingBox();assert((await card.locator('.ms-img-wrap').evaluate(e=>getComputedStyle(e).boxShadow)).includes('22px 0px'));
  await page.mouse.move(box.x+box.width*.25,box.y+box.height*.3);
  await page.waitForSelector('.cover-hover-preview');
  const hover=await page.locator('.cover-hover-preview').boundingBox();assert(hover.x>=box.x+box.width*.25+10);assert(hover.y>=box.y+box.height*.3+10);assert.equal(await page.locator('.cover-hover-preview').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
  await page.screenshot({path:path.join(out,'model-hover-'+theme+'-v13.png')});
  await card.click();await page.waitForSelector('#dMain');assert.equal(await page.locator('.cover-hover-preview').count(),0);
  await page.locator('#dMain').click();await page.waitForSelector('#imageViewer');await page.waitForFunction(()=>imageViewer?.full);
  assert.equal(await page.locator('.iv-stepper>button').count(),3);assert.equal(await page.locator('.iv-stepper .ef-pill-action').count(),0);
  const old=await page.evaluate(()=>imageViewer.targetZoom);await page.locator('#ivPlus').click();await page.waitForFunction(()=>imageViewer.zoom===imageViewer.targetZoom);assert((await page.evaluate(()=>imageViewer.zoom))>old);
  await page.locator('#ivMinus').click();await page.waitForFunction(()=>imageViewer.zoom===imageViewer.targetZoom);
  await page.locator('#ivActual').click();await page.waitForFunction(()=>imageViewer.zoom===imageViewer.targetZoom);assert.equal(await page.locator('#ivActual').innerText(),'100%');
  await page.locator('#ivFit').click();await page.waitForFunction(()=>imageViewer.zoom===1);assert.equal(await page.locator('#ivFit').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-iv-index]').count(),3);await page.locator('[data-iv-index="1"]').click();await page.waitForFunction(()=>imageViewer.index===1&&imageViewer.full);assert.equal(await page.locator('#ivCount').innerText(),'2 / 3');assert.equal(await page.locator('[data-iv-index="1"]').getAttribute('aria-current'),'true');
  assert((await page.locator('.iv-generation').innerText()).includes('生成数据'));
  await page.locator('#ivImage').click({button:'right'});await page.waitForSelector('#ivContext',{state:'visible'});await page.keyboard.press('Escape');assert.equal(await page.locator('#imageViewer').count(),1);
  await page.mouse.move(4,4);await page.screenshot({path:path.join(out,'image-viewer-'+theme+'-v13.png')});
  for(const width of [1000,760,420,320]){await page.setViewportSize({width,height:850});await page.waitForTimeout(120);assert(await page.evaluate(()=>document.querySelector('#imageViewer').scrollWidth<=innerWidth+1),'viewer overflow '+width);const controls=await page.locator('.iv-stepper').boundingBox();assert(controls.x>=0&&controls.x+controls.width<=width);if(width===420)await page.screenshot({path:path.join(out,'image-viewer-narrow-'+theme+'-v13.png')});}
  await page.keyboard.press('Escape');assert.equal(await page.locator('#imageViewer').count(),0);assert.equal(await page.locator('#dMain').count(),1);
  assert.deepEqual(errors,[]);console.log('PASS '+theme+' 卡片跟随预览、柔光、大图一体缩放/切图/右键/Escape/四档窄屏');await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
