/* About band, links and focus behavior on an isolated API fixture only. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const server=require('../scripts/preview_endfield_settings.cjs');
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   const original=window.fetch;window.aboutContributorMode='offline';
   window.fetch=(url,options)=>String(url).startsWith('https://api.github.com/repos/ADVICEsama/CivitaiFreeTool/contributors')
    ?window.aboutContributorMode==='offline'?Promise.reject(new Error('isolated offline')):Promise.resolve(new Response(JSON.stringify([{login:'ADVICEsama',contributions:99},{login:'fixture-contributor',contributions:7}]),{status:200}))
    :original(url,options);
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready&&document.querySelector('.ef-preview-note'));
  await page.evaluate(()=>{const original=api.call.bind(api);window.aboutOpenedUrls=[];api.call=(method,...args)=>{if(method==='open_url'){aboutOpenedUrls.push(args[0]);return Promise.resolve({ok:true});}if(method==='get_version'&&window.aboutVersionFail)return Promise.reject(new Error('fixture version unavailable'));return original(method,...args);};});
  const open=async()=>{await page.locator('#aboutFloat').click();await page.waitForFunction(()=>document.querySelectorAll('.about-action-base>.ef-footer-action').length===2);await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.querySelector('.about-dlg').getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});};
  for(const theme of ['dark_endfield','light_endfield']){
   await page.evaluate(theme=>{state.cfg.theme=theme;document.documentElement.dataset.theme=theme;applyUiAppearance();},theme);
   await open();
   assert.equal(await page.locator('.about-dlg').getAttribute('role'),'dialog');assert.equal(await page.locator('.about-dlg').getAttribute('aria-labelledby'),'aboutTitle');
   assert.equal(await page.locator('.about-ver').innerText(),'v2.3.1');assert.equal(await page.locator('.about-up-item').count(),0);assert.equal(await page.locator('.about-credit').count(),2);
   assert.match(await page.locator('.about-legal').textContent(),/docs\/FONT-NOTICES.md/);assert.match(await page.locator('.about-legal').textContent(),/非官方/);assert.doesNotMatch(await page.locator('.about-dlg').innerText(),/液体玻璃|URBANISM|城市化/);
   await page.locator('.about-wordmark').evaluate(el=>el.decode());assert.deepEqual(await page.locator('.about-wordmark').evaluate(el=>({src:el.getAttribute('src'),loaded:el.complete&&el.naturalWidth===2048,filter:getComputedStyle(el).filter})),{src:'about-wordmark.svg',loaded:true,filter:theme==='dark_endfield'?'invert(1)':'none'});assert.equal(await page.locator('.about-capabilities>span').count(),0);
   await page.locator('.about-character').evaluate(el=>el.decode());assert(await page.locator('.about-character').evaluate(el=>el.complete&&el.naturalWidth===1254));assert.equal(await page.locator('.about-details').getAttribute('open'),null);
   const proportions=await page.locator('.about-dlg').evaluate(el=>({logoTop:getComputedStyle(el.querySelector('.about-wordmark')).top,character:el.querySelector('.about-stage').getBoundingClientRect().height,headline:getComputedStyle(el.querySelector('.about-name')).fontSize,caption:getComputedStyle(el.querySelector('.about-poster-caption')).bottom,arrow:el.querySelector('.about-poster-caption h3>span').getBoundingClientRect().toJSON()}));
   assert.equal(proportions.logoTop,'14px');assert.equal(proportions.character,420);assert.equal(proportions.headline,'28px');assert.equal(proportions.caption,'32px');assert(proportions.arrow.width>proportions.arrow.height*1.15);
   assert.equal(await page.locator('#aboutContribs [data-gh]').count(),2);assert.equal(await page.locator('#aboutContribs [data-gh=guanhaisen]').isVisible(),false);await page.locator('#aboutDetailsToggle').click();assert(await page.locator('#aboutContribs [data-gh=guanhaisen]').isVisible());assert.equal(await page.locator('.about-details-body').evaluate(el=>getComputedStyle(el).animationName),'ef-about-details-open');
   const palette=await page.locator('#aboutGithub').evaluate(el=>({fill:getComputedStyle(el).backgroundColor,halo:getComputedStyle(el.querySelector('.ef-action-circle'),':after').content}));
   assert.equal(palette.fill,theme==='dark_endfield'?'rgb(209, 211, 207)':'rgb(72, 75, 71)');assert.equal(palette.halo,'none');
   assert.equal(await page.locator('#aboutOk').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 239, 1)');
   const urls={aboutGithub:'https://github.com/ADVICEsama/CivitaiFreeTool',rdHome:'https://space.bilibili.com/273101122',rdGroup:'https://qm.qq.com/q/EbnuVZB4wE',aboutBodyFontSource:'https://github.com/howlingFounts/GeourceSans/'};
   for(const [id,url] of Object.entries(urls)){await page.locator('#'+id).click();assert.equal(await page.evaluate(()=>aboutOpenedUrls.at(-1)),url);assert.equal(await page.locator('.about-dlg').count(),1);}
   await page.locator('[data-gh=guanhaisen]').click();assert.equal(await page.evaluate(()=>aboutOpenedUrls.at(-1)),'https://github.com/guanhaisen');await page.locator('#aboutDetailsToggle').click();
   for(const viewport of [{width:1600,height:1000},{width:980,height:740},{width:680,height:600},{width:420,height:760},{width:320,height:640},{width:980,height:500}]){
    await page.setViewportSize(viewport);
    const geometry=await page.locator('.about-dlg').evaluate(el=>{
     const r=el.getBoundingClientRect(),s=getComputedStyle(el),scroll=el.querySelector('.about-scroll'),line=getComputedStyle(el,':before');
     return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,line:r.bottom-parseFloat(s.borderBottomWidth)/2,fill:s.backgroundColor,radius:s.borderRadius,stripeWidth:parseFloat(line.width),stripe:line.backgroundImage,scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth,
      buttons:[...el.querySelectorAll('.about-action-base>button')].map(b=>{const r=b.getBoundingClientRect(),base=b.parentElement,br=base.getBoundingClientRect(),c=b.querySelector('.ef-action-caption').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,centerY:(r.top+r.bottom)/2,centerOffset:(c.left+c.right-r.left-r.right)/2,baseBottom:br.bottom,baseShadow:getComputedStyle(base).boxShadow,baseFill:getComputedStyle(base).backgroundColor,shadow:getComputedStyle(b).boxShadow};})};
    });
    assert(Math.abs(geometry.left)<.6&&Math.abs(geometry.right-viewport.width)<.6,JSON.stringify(geometry));assert.equal(geometry.radius,'0px');assert(geometry.top>=0);if(geometry.scrollWidth>geometry.clientWidth+1)console.log('OVERFLOW',await page.locator('.about-scroll *').evaluateAll(nodes=>nodes.map(e=>({class:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>innerWidth+1)));assert(geometry.scrollWidth<=geometry.clientWidth+1,JSON.stringify({viewport,geometry}));
    assert.equal(geometry.stripeWidth,viewport.width);for(const color of ['255, 253, 31','0, 208, 253','249, 84, 253'])assert(geometry.stripe.includes(color));
    for(const b of geometry.buttons){assert(Math.abs(b.centerOffset)<.6);assert(b.left>=0&&b.right<=viewport.width&&b.baseBottom<=viewport.height,JSON.stringify({viewport,geometry}));assert.equal(b.baseShadow,'none');assert.equal(b.baseFill,geometry.fill);assert(b.shadow.includes('3px 5px'));assert(Math.abs((geometry.line-b.centerY)-(b.baseBottom-geometry.line))<.7);}
    assert(geometry.buttons[1].left>geometry.buttons[0].right+4);
    await page.locator('#aboutGithub').hover();assert.deepEqual(await page.locator('#aboutGithub').evaluate(el=>{const s=getComputedStyle(el);return[s.outlineColor,s.outlineWidth,s.outlineOffset];}),['rgb(255, 239, 1)','2px','2px']);
    if(viewport.width===420){await page.locator('.about-character').scrollIntoViewIfNeeded();assert(await page.locator('.about-character').isVisible());await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/about-'+theme+'-narrow-v4.png')});}
   }
   await page.setViewportSize({width:1600,height:1000});await page.locator('.about-scroll').evaluate(el=>el.scrollTop=0);await page.mouse.move(0,0);
   await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/about-'+theme+'-v4.png')});
   await page.locator('#aboutGithub').hover();await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/about-'+theme+'-hover-v4.png')});
   await page.locator('#aboutOk').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'aboutClose');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'aboutOk');
   await page.keyboard.press('Escape');assert.equal(await page.locator('.about-dlg,.about-mask').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.id),'aboutFloat');
   console.log('PASS '+theme+' 关于信息带：用户SVG标识/参考图海报排版/透明角色/大标题黄条/精简正文与折叠鸣谢；六种尺寸不溢出、底座1:1、文字居中黄圈、全部原链接和焦点循环保留');
  }
  await page.evaluate(()=>window.aboutContributorMode='live');await open();await page.locator('#aboutDetailsToggle').click();await page.waitForSelector('[data-gh=fixture-contributor]');assert.equal(await page.locator('[data-gh=ADVICEsama]').count(),0);assert.match(await page.locator('#aboutContribs').innerText(),/7 次提交/);
  await page.locator('[data-gh=fixture-contributor]').click();assert.equal(await page.evaluate(()=>aboutOpenedUrls.at(-1)),'https://github.com/fixture-contributor');
  await page.evaluate(()=>Promise.all([showAbout(),showAbout()]));assert.equal(await page.locator('.about-dlg').count(),1);await page.locator('#aboutClose').click();assert.equal(await page.locator('.about-dlg').count(),0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.aboutVersionFail=true);await open();assert.equal(await page.locator('.about-ver').innerText(),'版本未知');
  assert.equal(await page.locator('.about-dlg').evaluate(el=>el.getAnimations({subtree:true}).length),0);await page.locator('#aboutOk').click();assert.equal(await page.locator('.about-dlg').count(),0);
  await page.locator('.nav-logo').click();await page.waitForSelector('.about-dlg');await page.locator('.about-mask').click({position:{x:8,y:8}});assert.equal(await page.locator('.about-dlg').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS 贡献者在线/离线回退、版本失败占位、不重复开窗、双入口/三种关闭方式、减少动态均通过；未触发任何真实外部操作');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
