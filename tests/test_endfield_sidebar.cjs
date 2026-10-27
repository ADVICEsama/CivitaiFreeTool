/* Navigation integration on the isolated API fixture, never real user config. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const server=require('../scripts/preview_endfield_settings.cjs');
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready&&document.querySelector('.ef-preview-note'));
  await page.waitForFunction(()=>document.querySelectorAll('#navTabs .ef-nav-preview svg').length===7&&[...document.querySelectorAll('#navTabs .nav-label')].every(el=>el.dataset.efNavMeta));
  const labels=['批量下载','下载管理','模型管理','检查更新','反向解析','工作流分析','设置'];
  assert.deepEqual(await page.locator('#navTabs .nav-tab').evaluateAll(tabs=>tabs.map(t=>t.textContent.trim())),labels);
  const artwork=await page.locator('#navTabs .ef-nav-preview svg').evaluateAll(nodes=>nodes.map(el=>({paths:[...el.querySelectorAll('path')].map(p=>p.getAttribute('d')).join('|'),fill:getComputedStyle(el).fill,stroke:getComputedStyle(el).stroke,width:getComputedStyle(el).strokeWidth,cap:getComputedStyle(el).strokeLinecap,join:getComputedStyle(el).strokeLinejoin,fixed:[...el.querySelectorAll('path')].every(p=>getComputedStyle(p).vectorEffect==='non-scaling-stroke')})));
  assert.equal(new Set(artwork.map(a=>a.paths)).size,7);assert(artwork.every(a=>a.fill!=='none'&&a.stroke==='none'));
  for(const theme of ['dark_endfield','light_endfield']){
   await page.evaluate(theme=>{state.cfg.theme=theme;state.cfg.sidebar_collapsed=false;document.documentElement.dataset.theme=theme;applyUiAppearance();},theme);
   await page.locator('.nav-tab[data-page=workflow]').click();
   const sequence=await page.locator('.nav-tab.active').evaluate(async el=>{
    const animations=el.getAnimations({subtree:true}).filter(a=>a.animationName?.startsWith('ef-nav-')||a.animationName==='ef-sidebar-fill');
    animations.forEach(a=>a.pause());const frames=[],duration=parseFloat(getComputedStyle(el).animationDuration)*1000;
    for(const part of [0,.02,.23,.55,.81,.82,.9,1,1.1]){
     const time=part*duration;
     animations.forEach(a=>a.currentTime=time);await new Promise(requestAnimationFrame);
     const face=getComputedStyle(el),sweep=getComputedStyle(el.querySelector('.ef-nav-sweep'),':before'),gutter=getComputedStyle(el.querySelector('.ef-nav-gutter'));
     frames.push({time,height:parseFloat(face.height),fill:face.backgroundColor,clip:sweep.clipPath,whiteClip:getComputedStyle(el,':before').clipPath,whiteOpacity:+getComputedStyle(el,':before').opacity,whiteFill:getComputedStyle(el,':before').backgroundColor,whiteZ:+getComputedStyle(el,':before').zIndex,labelZ:+getComputedStyle(el.querySelector('.nav-label')).zIndex,whiteAnimation:getComputedStyle(el,':before').animationName,whiteGeometry:['left','right','top','bottom'].map(p=>getComputedStyle(el,':before')[p]).join('|'),sharedRadius:getComputedStyle(el.querySelector('.ef-nav-sweep')).borderRadius,cardRadius:face.borderRadius,sharedOverflow:getComputedStyle(el.querySelector('.ef-nav-sweep')).overflow,sweepOpacity:+getComputedStyle(el.querySelector('.ef-nav-sweep')).opacity,sweepLeft:el.querySelector('.ef-nav-sweep').getBoundingClientRect().left,marker:+getComputedStyle(el.querySelector('.ef-nav-marker')).opacity,bracket:+getComputedStyle(el,':after').opacity,text:getComputedStyle(el.querySelector('.ef-nav-stamp'),':before').content,symbol:getComputedStyle(el.querySelector('.ef-nav-stamp'),':after').content,stampOpacity:+getComputedStyle(el.querySelector('.ef-nav-stamp')).opacity,arrowOpacity:+getComputedStyle(el.querySelector('.ef-nav-stamp>svg')).opacity,stripes:gutter.backgroundPosition});
    }
    const travel=[];
    for(let i=0;i<=8;i++){
     const time=i*duration*.82/8;
     animations.forEach(a=>a.currentTime=time);await new Promise(requestAnimationFrame);
     const sr=el.querySelector('.ef-nav-sweep').getBoundingClientRect(),clip=getComputedStyle(el.querySelector('.ef-nav-sweep'),':before').clipPath,percent=+clip.match(/inset\(\S+\s+([\d.e+-]+)%/)[1];
     travel.push({time,front:sr.left+sr.width*(1-percent/100)});
    }
    animations.forEach(a=>a.currentTime=16.979267*duration*.82/320);await new Promise(requestAnimationFrame);const sr=el.querySelector('.ef-nav-sweep').getBoundingClientRect(),clip=getComputedStyle(el.querySelector('.ef-nav-sweep'),':before').clipPath,percent=+clip.match(/inset\(\S+\s+([\d.e+-]+)%/)[1],contact={front:sr.left+sr.width*(1-percent/100),cardLeft:el.getBoundingClientRect().left};
    animations.forEach(a=>{if(a.effect.getComputedTiming().iterations===Infinity)a.play();else a.finish();});return{duration,frames,travel,contact,names:animations.map(a=>a.animationName)};
   });
   const f=sequence.frames;assert.equal(f[0].height,52);assert.equal(f[1].height,52);assert.equal(f[0].marker,0);assert.equal(f[1].marker,0);assert(f[2].height>52);assert.equal(f[2].marker,1);assert.equal(f[3].height,70);assert(f.slice(0,6).every(x=>x.bracket<.001));assert(f[6].bracket>0&&f[6].bracket<1);assert.equal(f[7].bracket,1);assert(f.every(x=>x.sweepOpacity===1&&x.sharedRadius===x.cardRadius&&x.sharedOverflow==='hidden'));assert(f.every(x=>Math.abs(x.sweepLeft)<.6));
   for(const frame of f.slice(0,7)){assert.equal(frame.stampOpacity,1);assert.equal(JSON.parse(frame.text).length,3);assert.notEqual(frame.text,'"CFT"');assert.notEqual(frame.symbol,'""');assert.equal(frame.arrowOpacity,0);}
   for(const frame of f.slice(7)){assert.equal(frame.text,'"CFT"');assert.equal(frame.symbol,'""');assert.equal(frame.arrowOpacity,1);}
   assert(f.every(x=>x.whiteClip==='none'&&x.whiteOpacity===1&&x.whiteFill==='rgb(245, 244, 243)'&&x.whiteZ>0&&x.labelZ>x.whiteZ&&x.whiteAnimation==='none'&&x.whiteGeometry==='0px|0px|0px|0px'));
   assert(f.every(x=>x.fill==='rgb(245, 244, 243)'));
   assert(sequence.duration>=230&&sequence.duration<=352);assert(Math.abs(sequence.travel.at(-1).front-222)<.6);
   const increments=sequence.travel.slice(1).map((x,i)=>x.front-sequence.travel[i].front);assert(increments.every((v,i,a)=>v>0&&(i===0||v<=a[i-1]+.6)),JSON.stringify(sequence.travel));
   assert(Math.abs(sequence.contact.front-sequence.contact.cardLeft)<.2);console.log('PASS '+theme+' 白色从第0帧起始终不透明置顶并贴合卡片，黄色始终在其后移动；文字与图标在白色上方，CFT、箭头和括框与页面同步结束');

   assert.equal(await page.locator('.nav-tab.active').getAttribute('aria-current'),'page');
   assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'workflow');
   const palette=await page.locator('#navTabs .nav-tab').evaluateAll(tabs=>tabs.map(t=>({active:t.classList.contains('active'),fill:getComputedStyle(t).backgroundColor,ink:getComputedStyle(t).color,border:getComputedStyle(t).borderTopColor,height:t.getBoundingClientRect().height,width:t.getBoundingClientRect().width})));
   const current=palette.find(p=>p.active);assert.equal(current.fill,'rgb(245, 244, 243)');assert.equal(await page.locator('.nav-tab.active').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
   for(const p of palette.filter(p=>!p.active)){assert.equal(p.fill,theme==='light_endfield'?'rgb(216, 220, 213)':'rgb(48, 53, 54)');assert(current.height>p.height+15);assert(current.width>p.width+8);}
   assert.equal(await page.locator('.nav').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
   assert.equal(await page.locator('.nav').evaluate(el=>getComputedStyle(el).borderRightWidth),'0px');
   assert.equal(await page.locator('.nav-wrap').evaluate(el=>getComputedStyle(el).borderRightWidth),'0px');
   assert.equal(await page.locator('#toggleSidebar').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
   const cft=await page.locator('.nav-tab.active .ef-nav-stamp').evaluate(el=>({text:getComputedStyle(el,':before').content,size:getComputedStyle(el,':before').fontSize,background:getComputedStyle(el).backgroundColor,svg:el.querySelectorAll('svg').length}));
   assert.equal(cft.text,'"CFT"');assert.equal(cft.size,'9px');assert.equal(cft.background,'rgba(0, 0, 0, 0)');assert.equal(cft.svg,1);
   assert.equal(current.height,70);assert(palette.filter(p=>!p.active).every(p=>p.height===52));
   const details=await page.locator('.nav-tab.active').evaluate(el=>{
    const nav=el.closest('.nav').getBoundingClientRect(),r=el.getBoundingClientRect(),g=el.querySelector('.ef-nav-gutter'),gr=g.getBoundingClientRect(),frame=getComputedStyle(el,':after'),rail=el.parentElement,stamp=el.querySelector('.ef-nav-stamp');return{gutterLeft:gr.left,navLeft:nav.left,gutterWidth:gr.width,gutterHeight:gr.height,faceHeight:r.height,faceLeft:r.left,gutterFill:getComputedStyle(g).backgroundImage,right:frame.right,top:frame.borderTopWidth,bottom:frame.borderBottomWidth,left:frame.borderLeftWidth,frameWidth:frame.borderRightWidth,frameColor:frame.borderRightColor,stamp:getComputedStyle(stamp).display,stampY:stamp.getBoundingClientRect().top,faceBottom:r.bottom,ticks:getComputedStyle(rail,':after').backgroundImage,railHeight:parseFloat(getComputedStyle(rail,':before').height),navHeight:rail.getBoundingClientRect().height};
   });
   assert(Math.abs(details.gutterLeft-details.navLeft)<.6,JSON.stringify(details));assert.equal(details.gutterWidth,36);assert.equal(details.gutterHeight,details.faceHeight);assert(details.gutterFill.includes('linear-gradient'));assert.equal(details.right,'-10px');assert.equal(details.frameWidth,'3px');assert.equal(details.top,'3px');assert.equal(details.bottom,'3px');assert.equal(details.left,'0px');assert.equal(details.frameColor,'rgb(255, 239, 1)');assert.equal(details.stamp,'flex');assert(details.stampY>details.faceBottom);assert(details.ticks.includes('repeating-linear-gradient'));assert(Math.abs(details.railHeight-details.navHeight)<.6);
   assert.match(await page.locator('.nav-tab[data-page=updates] .ef-nav-preview path').first().getAttribute('d'),/A20 20/);
   const brand=await page.locator('.sidebar-brand .nav-logo').boundingBox(),card=await page.locator('.nav-tab:not(.active)').first().boundingBox();assert(Math.abs(brand.x-card.x)<.6);
   await page.mouse.move(500,50);await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/sidebar-'+theme+'-v25.png')});
   await page.locator('#toggleSidebar').click();await page.waitForFunction(()=>document.documentElement.dataset.sidebar==='collapsed');
   assert.equal(await page.locator('.nav-wrap').evaluate(el=>el.getBoundingClientRect().width),66);await page.waitForFunction(()=>getComputedStyle(document.querySelector('.nav-tab.active .ef-nav-preview')).opacity==='0.95');
   await page.locator('#toggleSidebar').click();await page.waitForFunction(()=>document.documentElement.dataset.sidebar==='expanded');
   await page.locator('.nav-tab[data-page=download]').click();assert(await page.locator('#page-download').evaluate(el=>el.classList.contains('active')&&el.classList.contains('api-key-locked')));
   assert.equal(await page.locator('.nav-tab[data-page=download] .ef-nav-key').getAttribute('hidden'),null);
   // Native button keyboard activation and existing wheel routing stay intact.
   await page.locator('.nav-tab[data-page=models]').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'models');
   await page.evaluate(()=>{navWheelLast=0;navWheelDelta=0;});const r=await page.locator('#navTabs').boundingBox();await page.mouse.move(r.x+r.width/2,r.y+20);await page.mouse.wheel(0,120);assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'updates');
   await page.evaluate(()=>{navWheelLast=0;navWheelDelta=0;});const header=await page.locator('.sidebar-brand').boundingBox();await page.mouse.move(header.x+header.width/2,header.y+header.height/2);await page.mouse.wheel(0,120);assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'reverse');
   await page.evaluate(()=>{navWheelLast=0;navWheelDelta=0;});const footer=await page.locator('#aboutFloat').boundingBox();await page.mouse.move(footer.x+footer.width/2,footer.y+footer.height/2);await page.mouse.wheel(0,-120);assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'updates');
   await page.evaluate(()=>{navWheelLast=0;navWheelDelta=0;});await page.mouse.wheel(0,7);assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'updates');
   assert.equal(await page.locator('#navTabs .nav-tab:not(.active)').evaluateAll(nodes=>nodes.flatMap(el=>el.getAnimations({subtree:true})).filter(a=>a.animationName?.startsWith('ef-nav-')||a.animationName==='ef-sidebar-fill').length),0);
   console.log('PASS '+theme+' 恢复七张原版实心图标卡片、白底放大、外置黄括框/整块黄条/连续刻度/工业小标、分阶段黄扫/三角/括框/CFT乱码/斜纹流动/品牌对齐；收起、键盘、滚轮及API门禁不变');
  }
  for(const theme of ['light_endfield','dark_endfield']){
   await page.evaluate(theme=>{state.cfg.theme=theme;document.documentElement.dataset.theme=theme;applyUiAppearance();},theme);
   // Leave the previous selection first, then exercise every page including the API gate.
   await page.evaluate(()=>switchPage('workflow'));
   for(const name of ['download','dlmanager','models','updates','reverse','settings','workflow']){
    await page.evaluate(name=>switchPage(name),name);
    const entry=await page.locator('.page.active').evaluate(async el=>{
     const animations=el.getAnimations({subtree:true}).filter(a=>a.id==='ef-page-enter');
     const info=animations.map(a=>({end:a.effect.getComputedTiming().endTime,easing:a.effect.getTiming().easing,start:a.effect.getKeyframes()[0].transform}));
     animations.forEach(a=>{a.pause();a.currentTime=352;});await new Promise(requestAnimationFrame);
     const settled=animations.every(a=>+getComputedStyle(a.effect.target).opacity===1);
     animations.forEach(a=>a.finish());
     return{info,settled,navDuration:parseFloat(getComputedStyle(document.querySelector('.nav-tab.active')).animationDuration)*1000,stripes:getComputedStyle(document.querySelector('.nav-tab.active .ef-nav-gutter')).animationDuration,old:document.querySelectorAll('.page:not(.active)').length?[...document.querySelectorAll('.page:not(.active)')].flatMap(p=>p.getAnimations({subtree:true})).filter(a=>a.id==='ef-page-enter').length:0};
    });
    assert(entry.info.length>0,theme+' '+name);assert(entry.info.every(a=>a.end<=352&&a.easing==='cubic-bezier(0.2, 0.75, 0.25, 1)'&&a.start==='translateY(-14px)'));assert(entry.settled);assert.equal(entry.old,0);assert(Math.abs(entry.navDuration-Math.max(...entry.info.map(a=>a.end)))<.01);assert(entry.stripes.endsWith('1s'));
   }
   console.log('PASS '+theme+' 七个页面共用设置页向下入场，230–352ms内全部展开、括框与乱码同刻结束、斜纹1秒一周期；快速切页取消旧动画，API门禁保持');
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.nav-tab[data-page=settings]').click();assert.equal(await page.locator('.nav-tab.active').evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await page.locator('.nav-tab.active .ef-nav-gutter').evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await page.locator('.nav-tab.active .ef-nav-stamp').evaluate(el=>getComputedStyle(el,':before').content),'"CFT"');
  assert.equal(await page.locator('.nav-tab.active .ef-nav-stamp').evaluate(el=>getComputedStyle(el,':after').content),'\"\"');
  assert.equal(await page.locator('.page.active').evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.id==='ef-page-enter').length),0);
  assert.equal(await page.locator('.nav-tab.active .ef-nav-stamp>svg').evaluate(el=>getComputedStyle(el).opacity),'1');
  for(const viewport of [{width:680,height:600},{width:420,height:760},{width:980,height:500}]){
   await page.setViewportSize(viewport);await page.waitForFunction(()=>document.documentElement.dataset.narrowLayout==='true'||innerWidth>760);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(viewport.width<=760)assert.equal(await page.locator('.nav-wrap').evaluate(el=>el.getBoundingClientRect().width),66);
   assert(await page.locator('.nav-tab.active .ef-nav-preview').isVisible());
  }
  assert.deepEqual(errors,[]);console.log('PASS 窄屏/短屏无横向溢出，减少动态时直接显示最终状态，无前端异常');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
