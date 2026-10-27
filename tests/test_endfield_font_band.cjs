/* Font band presentation on synthetic API only. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const server=require('../scripts/preview_endfield_settings.cjs');
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready&&document.querySelector('.ef-preview-note'));
  for(const theme of ['dark_endfield','light_endfield']){
   await page.evaluate(theme=>{state.cfg.theme=theme;document.documentElement.dataset.theme=theme;applyUiAppearance();},theme);
   await page.locator('#fontChoice').click();await page.waitForFunction(()=>document.querySelector('#fontCancel.ef-action-secondary'));
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.querySelector('#fontMenu').getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().endTime!==Infinity).map(a=>a.finished.catch(()=>{})));});
   assert.equal(await page.locator('#fontCancel').evaluate(el=>getComputedStyle(el).backgroundColor),theme==='dark_endfield'?'rgb(209, 211, 207)':'rgb(72, 75, 71)');
   assert.equal(await page.locator('#fontConfirm').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 239, 1)');
   for(const viewport of [{width:1600,height:1000},{width:680,height:600},{width:420,height:760},{width:980,height:500}]){
    await page.setViewportSize(viewport);
    const geometry=await page.locator('.font-picker-dialog').evaluate(el=>{
     const r=el.getBoundingClientRect(),stripe=getComputedStyle(el,':before'),face=[...el.querySelectorAll('.font-action-base>button')].map(b=>{
      const c=b.querySelector('.ef-action-caption').getBoundingClientRect(),r=b.getBoundingClientRect(),base=b.parentElement.getBoundingClientRect();return {captionOffset:(c.left+c.right-r.left-r.right)/2,left:r.left,right:r.right,top:r.top,bottom:r.bottom,center:(r.top+r.bottom)/2,baseBottom:base.bottom,baseShadow:getComputedStyle(b.parentElement).boxShadow,baseFill:getComputedStyle(b.parentElement).backgroundColor};
     });return {width:r.width,line:r.bottom,stripeWidth:parseFloat(stripe.width),stripeFill:stripe.backgroundImage,fill:getComputedStyle(el).backgroundColor,face};
    });
    assert.equal(geometry.stripeWidth,geometry.width);
    for(const rgb of ['255, 253, 31','0, 208, 253','249, 84, 253'])assert(geometry.stripeFill.includes(rgb));
    assert.equal(geometry.face.length,2);
    for(const face of geometry.face){assert(Math.abs(face.captionOffset)<.6);assert.equal(face.baseShadow,'none');assert.equal(face.baseFill,geometry.fill);assert(Math.abs((geometry.line-face.center)-(face.baseBottom-geometry.line))<1.1);assert(face.left>=0&&face.right<=viewport.width&&face.baseBottom<=viewport.height);}
    assert(geometry.face[1].left>geometry.face[0].right+5);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
   await page.setViewportSize({width:1600,height:1000});await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/font-band-'+theme+'-v12.png')});
   await page.locator('#fontCancel').click();await page.waitForFunction(()=>!document.querySelector('#fontMenu'));
   console.log('PASS '+theme+' 满宽三色线、统一胶囊与面板同色底座、1:1对齐及四种窗口尺寸');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
