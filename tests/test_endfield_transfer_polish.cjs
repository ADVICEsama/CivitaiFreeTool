/* Progress is coverage, not a permanent glow. No real bridge, downloads or user configuration. */
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const server=require('../scripts/preview_endfield_settings.cjs'),out=path.resolve('.test_tmp/endfield-settings-preview');
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
 await page.addInitScript(()=>{const native=setInterval;window.setInterval=(fn,...a)=>fn?.name==='dlRefresh'?0:native(fn,...a)});
 await page.goto('http://127.0.0.1:'+server.address().port+'/?transfer=queue');await page.waitForSelector('.ef-transfer-preview-flag');
 const settle=()=>page.evaluate(()=>Promise.all(document.querySelector('.page.active').getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
 for(const theme of ['dark_endfield','light_endfield']){
  await page.evaluate(theme=>{state.cfg.theme=theme;document.documentElement.dataset.theme=theme;applyUiAppearance();switchPage('dlmanager');document.querySelector('#dlQueueTab').click()},theme);await settle();
  for(const progress of [0,10,50,99,100]){
   await page.evaluate(async n=>{const t=fixtureTasks[0];t.status='downloading';t.progress=n;t.downloaded=t.total*n/100;await dlRefresh()},progress);
   await page.waitForFunction(n=>{const e=document.querySelector('#dlTable [data-task-id=transfer-demo-0]');return e&&Math.abs(parseFloat(getComputedStyle(e,':before').width)/e.clientWidth*100-n)<.2},progress);
   const shape=await page.locator('#dlTable [data-task-id=transfer-demo-0]').evaluate(e=>{const s=getComputedStyle(e,':before');return{right:s.right,left:s.left,w:parseFloat(s.width),content:getComputedStyle(e,':after').content,bar:getComputedStyle(e.children[5],':after').content,animation:s.animationName,background:s.backgroundImage}});
   assert.equal(shape.right,'0px');assert.equal(shape.content,'none');assert.equal(shape.bar,'none');if(progress===0){assert.equal(shape.w,0);assert.equal(shape.background,'none');assert.equal(shape.animation,'none')}else assert.equal(shape.animation,'ef-transfer-blue');
  }
  await page.evaluate(async()=>{fixtureTasks[0].progress=50;await dlRefresh()});await page.waitForFunction(()=>document.querySelector('#dlTable [data-task-id=transfer-demo-0]')?.dataset.efProgress==='50');await settle();
  const tabs=await page.locator('#page-dlmanager .download-tabs').evaluate(e=>{const a=[...e.querySelectorAll('.ef-transfer-bookmark')].map(n=>n.getBoundingClientRect()),r=e.getBoundingClientRect();return{center:(a[0].left+a.at(-1).right)/2,parent:(r.left+r.right)/2}});assert(Math.abs(tabs.center-tabs.parent)<1);
  const toolbar=page.locator('#dlQueueActions');assert.equal(await toolbar.locator('button').count(),4);
  const buttonGeometry=await toolbar.locator('button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),c=n.querySelector('.ef-action-caption').getBoundingClientRect();return{center:(c.top+c.bottom-r.top-r.bottom)/2,mask:n.querySelector('mask path')?.getAttribute('transform')}}));for(const x of buttonGeometry){assert(Math.abs(x.center)<1);assert(x.mask.includes('scale(.64)'));}
  assert.equal(await page.locator('.ef-transfer-more,#dlClearDone,#dlRemoveCompleted').count(),0);
  await page.locator('#dlHistoryTab').click();assert(await page.evaluate(()=>document.getAnimations().some(a=>a.id==='ef-transfer-view')));await settle();await page.waitForSelector('.history-batch-toggle');assert.equal(await page.locator('#dlShowHud').isVisible(),false);
  const cells=await page.locator('#dlHistoryTable tr[data-history-id]').first().evaluate(e=>{const r=e.getBoundingClientRect();return[...e.children].filter(n=>getComputedStyle(n).position!=='absolute').map(n=>{const b=n.getBoundingClientRect();return{dy:(b.top+b.bottom-r.top-r.bottom)/2,text:getComputedStyle(n).textAlign}})});assert(cells.every(c=>Math.abs(c.dy)<1&&c.text==='center'),JSON.stringify(cells));
  const button=page.locator('.history-batch-toggle').first();await button.click();assert(await page.evaluate(()=>document.getAnimations().some(a=>a.id==='ef-history-fold')));await settle();await button.click();assert(await page.evaluate(()=>document.getAnimations().some(a=>a.id==='ef-history-fold')));await settle();
  await page.mouse.move(0,0);await page.screenshot({path:path.join(out,'history-centered-'+theme+'-v5.png')});
  await page.locator('#dlQueueTab').click();await settle();await page.locator('#dlTable .dest-picker').first().click();await page.waitForSelector('.fp-terrain canvas[data-ready=true]');assert.equal(await page.locator('#fpReset').count(),0);
  const band=await page.locator('.ef-folder-band').evaluate(e=>{const r=e.getBoundingClientRect(),layout=e.querySelector('.fp-layout').getBoundingClientRect(),face=e.querySelector('#fpCancel').getBoundingClientRect();return{space:face.top-layout.bottom,vertical:Math.abs((r.top+r.bottom)/2-innerHeight/2),bg:getComputedStyle(e,':after').content,draws:Number(e.querySelector('canvas').dataset.draws)}});assert(band.space>12&&band.vertical<1&&band.bg==='none',JSON.stringify(band));await page.waitForFunction(n=>Number(document.querySelector('.fp-terrain canvas').dataset.draws)>n,band.draws);
  await page.screenshot({path:path.join(out,'folder-spaced-'+theme+'-v5.png')});await page.locator('#fpCancel').click();
  console.log('PASS '+theme+' 0%无蓝光、10/50/99/100%右贴边对应覆盖；无旧图标/细线，顶部操作完整、字标留白，页签/折叠动画、历史居中、目录留白与单层流动等高线');
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#dlHistoryTab').click();await page.locator('.history-batch-toggle').first().click();assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>['ef-history-fold','ef-transfer-tab','ef-transfer-view'].includes(a.id)).length),0);assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
