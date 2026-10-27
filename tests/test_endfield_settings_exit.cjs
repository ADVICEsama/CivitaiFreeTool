/* Synthetic settings only; no user configuration or native window is touched. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const server=require('../scripts/preview_endfield_settings.cjs');
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready&&document.querySelector('.ef-preview-note'));
  const pending=async()=>{const value=await page.locator('[data-key=default_view]').inputValue();await page.locator('[data-key=default_view]').selectOption(value==='list'?'waterfall':'list',{force:true});await page.mouse.move(0,0);await page.waitForFunction(()=>!document.querySelector('#efUnsavedNotice').hidden);};
  const open=async()=>{await page.locator('.nav-tab[data-page=workflow]').click();await page.waitForFunction(()=>document.querySelectorAll('.settings-exit-dialog .ef-action-circle').length===3);};
  for(const theme of ['light_endfield','dark_endfield']){
   await page.evaluate(theme=>{fixtureCfg.theme=theme;state.cfg=structuredClone(fixtureCfg);document.documentElement.dataset.theme=theme;applyUiAppearance();buildSettingsForm();switchPage('settings');showSettingsCategory('appearance');},theme);
   await pending();await open();await page.evaluate(()=>document.fonts.ready);assert.equal(await page.locator('.settings-exit-art>span').count(),0);
   assert.equal(await page.locator('#efUnsavedNotice').evaluate(el=>getComputedStyle(el).display),'none');
   assert.equal(await page.locator('.settings-exit-copy').evaluate(el=>getComputedStyle(el).textAlign),'center');
   assert.equal(await page.locator('.settings-exit-art').evaluate(el=>getComputedStyle(el).overflow),'hidden');
   assert.equal(await page.locator('.settings-exit-dialog').getAttribute('aria-labelledby'),'settingsExitTitle');
   assert.deepEqual(await page.locator('.settings-exit-dialog .ef-action-circle').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el,':after').content)),['none','none','none']);
   const iconPaths=await page.locator('.settings-exit-dialog .ef-action-circle mask path').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('d')));
   assert.deepEqual(iconPaths,['m14 5-7 7 7 7','m7 7 10 10M17 7 7 17','m6 12 4 4 8-9']);
   assert.equal(await page.locator('#settingsStay').evaluate(el=>getComputedStyle(el).backgroundColor),theme==='light_endfield'?'rgb(72, 75, 71)':'rgb(209, 211, 207)');
   assert.equal(await page.locator('#settingsStay').evaluate(el=>getComputedStyle(el).color),theme==='light_endfield'?'rgb(240, 241, 235)':'rgb(81, 86, 78)');
   assert.equal(await page.locator('#settingsSaveLeave').evaluate(el=>el.getBoundingClientRect().height),56);
   assert.equal(await page.locator('#settingsSaveLeave').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 239, 1)');
   const motion=await page.locator('.settings-exit-dialog').evaluate(async el=>{
    const animations=el.getAnimations({subtree:true}).filter(a=>a.animationName==='ef-confirm-contour-flow'),times=animations.map(a=>a.currentTime);
    const read=()=>({paint:[':before',':after'].map(p=>getComputedStyle(el,p).backgroundPosition),copy:el.querySelector('.settings-exit-copy').getBoundingClientRect().y,buttons:el.querySelector('.rd-actions').getBoundingClientRect().y});
    animations.forEach(a=>{a.pause();a.currentTime=0;});await new Promise(requestAnimationFrame);const start=read();
    animations.forEach(a=>a.currentTime=10000);await new Promise(requestAnimationFrame);const middle=read();
    animations.forEach((a,i)=>{a.currentTime=times[i];a.play();});return{count:animations.length,start,middle,height:el.getBoundingClientRect().height};
   });
   const contour=await page.locator('.settings-exit-dialog').evaluate(el=>[':before',':after'].map(p=>{const s=getComputedStyle(el,p);return{height:parseFloat(s.height),width:parseFloat(s.width)};}));assert(Math.abs(contour[0].height-contour[1].height)<.1);assert(Math.abs(contour[0].width-contour[1].width)<.1);
   assert.equal(motion.count,2);assert.equal(motion.height,310);assert(motion.start.paint.every((p,i)=>p!==motion.middle.paint[i]));assert.equal(motion.start.copy,motion.middle.copy);assert.equal(motion.start.buttons,motion.middle.buttons);
   await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.settings-exit-dialog').evaluate(el=>getComputedStyle(el,':before').animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
   for(const width of [1600,980,700,420]){
    await page.setViewportSize({width,height:1000});
    if(width>=700){const art=await page.locator('.settings-exit-art').evaluate(el=>{const line=getComputedStyle(el,':before'),panel=el.parentElement;return{lineWidth:line.width,lineFill:line.backgroundImage,panelLayers:[getComputedStyle(panel,':before').backgroundImage,getComputedStyle(panel,':after').backgroundImage]};});assert(art.panelLayers.every(s=>s.includes('terrain-contours.svg')));assert(Math.abs(parseFloat(art.lineWidth)-width)<1);for(const rgb of ['255, 253, 31','0, 208, 253','249, 84, 253'])assert(art.lineFill.includes(rgb));}
    const layout=await page.locator('.settings-exit-dialog').evaluate(el=>{const r=el.getBoundingClientRect(),buttons=[...el.querySelectorAll('.settings-exit-base>button')].map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),caption=el.querySelector('.ef-action-caption').getBoundingClientRect(),base=el.parentElement,br=base.getBoundingClientRect(),bs=getComputedStyle(base);return{captionCenter:caption.x+caption.width/2,faceCenter:r.x+r.width/2,x:r.x,y:r.y,right:r.right,bottom:r.bottom,baseBottom:br.bottom,baseWidth:br.width,baseHeight:br.height,faceWidth:r.width,faceHeight:r.height,baseFill:bs.backgroundColor,baseShadow:bs.boxShadow,baseOverflow:bs.overflow,faceShadow:s.boxShadow,baseTop:br.top};});const style=getComputedStyle(el);return{left:r.left,right:r.right,bottom:r.bottom,top:r.top,buttons,line:r.bottom-parseFloat(style.borderBottomWidth)/2,radius:style.borderRadius,fill:style.backgroundColor};});
    assert(Math.abs(layout.left)<1&&Math.abs(layout.right-width)<1);
    assert(layout.top>=0&&layout.bottom<=1000);assert.equal(layout.radius,'0px');
    for(let i=0;i<layout.buttons.length;i++){const b=layout.buttons[i];assert(Math.abs(b.captionCenter-b.faceCenter)<.6,'caption must center on face '+JSON.stringify(b));assert(b.x>=0&&b.right<=width&&b.bottom<=layout.bottom+29);if(i){const a=layout.buttons[i-1];assert(b.x>=a.right+5||b.y>=a.bottom+5);}}
    if(width>=700){assert(layout.buttons.every(b=>Math.abs(b.y-layout.buttons[0].y)<1));for(const b of layout.buttons){const center=(b.y+b.bottom)/2,upper=layout.line-center,lower=b.baseBottom-layout.line;assert(upper>10&&lower>10);assert.equal(b.baseShadow,'none');assert.equal(b.baseFill,layout.fill);assert.equal(b.baseOverflow,'hidden');assert(Math.abs(b.baseWidth-b.faceWidth-10)<.3&&Math.abs(b.baseHeight-b.faceHeight-12)<.3);assert(Math.abs(b.y-b.baseTop-4)<.3);assert(b.faceShadow.includes('3px 5px'));assert(Math.abs(upper-lower)<.6,'1:1 center/baseline/base '+JSON.stringify(layout));}assert(Math.abs((layout.buttons[0].x+layout.buttons.at(-1).right)/2-width/2)<.6);}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
   await page.setViewportSize({width:1600,height:1000});
   for(const id of ['settingsStay','settingsDiscard','settingsSaveLeave']){
    await page.locator('#'+id).hover();
    const ring=await page.locator('#'+id).evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return{color:s.outlineColor,width:s.outlineWidth,offset:s.outlineOffset,style:s.outlineStyle,topRoom:r.top-b.top,leftRoom:r.left-b.left};});
    assert.equal(ring.color,'rgb(255, 239, 1)');assert.equal(ring.width,'2px');assert.equal(ring.offset,'2px');assert.equal(ring.style,'solid');assert(ring.topRoom>=4&&ring.leftRoom>=4);assert.equal(await page.locator('.settings-exit-base>button:not(:hover)').evaluateAll(nodes=>nodes.every(el=>getComputedStyle(el).outlineStyle==='none')),true);
   }
   await page.locator('#settingsDiscard').hover();await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/settings-exit-hover-'+theme+'-v11.png')});
   await page.mouse.move(0,0);await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/settings-exit-'+theme+'-v11.png')});
   await page.locator('#settingsStay').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'settingsSaveLeave');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'settingsStay');
   await page.locator('#settingsStay').click();await page.waitForFunction(()=>!document.querySelector('.settings-exit-mask')&&!document.querySelector('#efUnsavedNotice').hidden);
   assert(await page.evaluate(()=>settingsHaveChanges()));
   console.log('PASS '+theme+' 亮色深灰/暗色浅灰次要按钮，胶囊1:1及投影不变，左右等高线等高铺满、三枚文字精确居中、悬停外圈黄色且不被裁切');
  }
  await open();await page.keyboard.press('Escape');assert.equal(await page.locator('.settings-exit-mask').count(),0);assert(await page.evaluate(()=>settingsHaveChanges()));
  await open();await page.locator('#settingsDiscard').click();await page.waitForFunction(()=>!document.querySelector('.settings-exit-mask')&&document.querySelector('.nav-tab.active').dataset.page==='workflow');
  await page.locator('.nav-tab[data-page=settings]').click();await pending();await open();await page.locator('#settingsSaveLeave').click();await page.waitForFunction(()=>!document.querySelector('.settings-exit-mask')&&document.querySelector('.nav-tab.active').dataset.page==='workflow');
  assert.equal(await page.locator('#efUnsavedNotice').getAttribute('hidden'),'');
  console.log('PASS Esc/继续编辑保留修改，放弃与保存并离开仍走原逻辑');
  await page.locator('.nav-tab[data-page=settings]').click();await pending();
  await page.evaluate(()=>{window.exitActualSave=window.saveSettings;window.saveSettings=async()=>false;});await open();await page.locator('#settingsSaveLeave').click();await page.locator('#settingsExitError').waitFor({state:'visible'});assert.equal(await page.locator('#settingsStay').isEnabled(),true);assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'settings');
  assert.equal(await page.locator('#efUnsavedNotice').evaluate(el=>getComputedStyle(el).display),'none');
  await page.evaluate(()=>window.saveSettings=window.exitActualSave);await page.locator('#settingsStay').click();
  assert.deepEqual(errors,[]);console.log('PASS 保存失败留在面板，可重试且无前端异常');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

