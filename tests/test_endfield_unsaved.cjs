const assert = require('node:assert/strict'), path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const server = require('../scripts/preview_endfield_settings.cjs');
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1000}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>window.__ready&&window.CFTEndfieldUnsaved&&document.querySelector('.ef-preview-note'));
    await page.evaluate(()=>document.fonts.ready);
    const banner=page.locator('#efUnsavedNotice');
    assert.equal(await banner.getAttribute('hidden'),'');
    // The preview starts in dark mode. A real unsaved edit must show the ribbon
    // without first switching to the light theme; returning to baseline hides it.
    await page.locator('select[data-key=ui_zoom]').selectOption('110',{force:true});
    await page.waitForFunction(()=>!document.querySelector('#efUnsavedNotice').hidden);
    await page.mouse.move(0,0);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#efUnsavedNotice')).opacity==='1');
    await page.waitForFunction(()=>!document.querySelector('#efUnsavedNotice').classList.contains('is-arriving'));
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark_endfield');
    const darkBounds=await banner.boundingBox();
    assert(darkBounds.y>0&&darkBounds.y+darkBounds.height<=1000);
    await page.locator('select[data-key=ui_zoom]').selectOption('100',{force:true});
    await page.waitForFunction(()=>document.querySelector('#efUnsavedNotice').hidden);
    console.log('PASS 初始暗色模式真实修改可见，恢复原值后正确收起');
    await page.evaluate(()=>{markSettingsDirty();CFTEndfieldUnsaved.refresh();});
    assert.equal(await banner.getAttribute('hidden'),'');
    await page.locator('#settingsSearch').fill('名称滚动');
    const speed=page.locator('[data-key=name_scroll_speed]');
    await speed.fill('75');await speed.press('Tab');
    await page.waitForFunction(()=>state.cfg.name_scroll_speed===75&&!settingsHaveChanges());
    await page.waitForFunction(()=>document.querySelector('#efUnsavedNotice').hidden);
    await speed.fill('70');await speed.press('Tab');
    await page.waitForFunction(()=>state.cfg.name_scroll_speed===70&&!settingsHaveChanges());
    await page.waitForFunction(()=>document.querySelector('#efUnsavedNotice').hidden);
    await page.locator('#settingsSearch').fill('');
    console.log('PASS 原标记过期与立即保存项不会留下虚假的未保存提示');
    for(const theme of ['light_endfield','dark_endfield']){
      await page.evaluate(()=>{window.noticeOpening=[];const ribbon=document.querySelector('.ef-unsaved-ribbon');function opening(e){if(e.animationName!=='ef-unsaved-unfold')return;window.noticeOpening=e.target.getAnimations().map(a=>({duration:a.effect.getTiming().duration,frames:a.effect.getKeyframes()}));ribbon.removeEventListener('animationstart',opening);}ribbon.addEventListener('animationstart',opening);});
      await page.locator('select[data-key=theme]').selectOption(theme,{force:true});
      await page.waitForFunction(()=>!document.querySelector('#efUnsavedNotice').hidden);
      await page.waitForFunction(()=>window.noticeOpening.length>0);
      const opening=await page.evaluate(()=>window.noticeOpening);
      assert(opening.some(a=>a.duration===190&&a.frames.some(f=>f.clipPath.includes('50%'))));
      const layout=await banner.evaluate(el=>{const r=el.getBoundingClientRect(),p=document.querySelector('#page-settings>.card').getBoundingClientRect();return {top:r.top,expectedTop:p.top+p.height*.72,left:r.left,right:r.right,pageLeft:p.left,pageRight:p.right,height:r.height,pointer:getComputedStyle(el).pointerEvents,role:el.getAttribute('role'),background:getComputedStyle(el.querySelector('.ef-unsaved-label')).backgroundColor};});
      assert(Math.abs(layout.top-layout.expectedTop)<1);assert.equal(layout.height,46);assert.equal(layout.pointer,'none');assert.equal(layout.role,'status');
      assert(Math.abs(layout.left-layout.pageLeft)<1);assert(Math.abs(layout.right-layout.pageRight)<1);assert.match(layout.background,/161, 40, 40/);
      assert.equal(await page.locator('#settingsDirty').evaluate(el=>getComputedStyle(el).display),'none');
      const drift=await banner.locator('.ef-unsaved-symbols').evaluate(el=>el.getAnimations().find(a=>a.effect.getTiming().duration===10000)?.effect.getKeyframes());
      assert(drift?.some(f=>f.transform==='translateX(96px)'));
      console.log('PASS '+theme+' 仅真实未保存时出现，横线纵向展开190ms，背景右移且提速至10秒每周期');
      for(const width of [980,1600]){await page.setViewportSize({width,height:1000});await page.waitForFunction(()=>{const r=document.querySelector('#efUnsavedNotice').getBoundingClientRect(),p=document.querySelector('#page-settings>.card').getBoundingClientRect();return r.left>=p.left-.5&&r.right<=p.right+.5;});}
      await page.locator('[data-settings-category=appearance]').click();
      await page.mouse.move(0,0);
      await page.waitForFunction(()=>!document.querySelector('#efUnsavedNotice').classList.contains('is-arriving'));
      await page.evaluate(()=>Promise.all(document.querySelector('#settings-appearance').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
      await page.screenshot({path:path.resolve('.test_tmp/endfield-settings-preview/settings-unsaved-'+theme+'-v7.png')});
      const r=await banner.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
      await page.evaluate(({x,y})=>{const button=document.createElement('button');button.id='noticeHitProof';button.style.cssText=`position:fixed;left:${x-40}px;top:${y-16}px;width:80px;height:32px;z-index:8999`;button.textContent='test';window.noticeHitCount=0;button.onclick=()=>window.noticeHitCount++;document.body.append(button);},{x,y});
      await page.mouse.move(x,y);
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('#efUnsavedNotice')).opacity==='0');
      await page.mouse.click(x,y);assert.equal(await page.evaluate(()=>noticeHitCount),1);
      await page.evaluate(()=>document.querySelector('#noticeHitProof').remove());
      await page.mouse.move(0,0);
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('#efUnsavedNotice')).opacity==='1');
      assert.equal(await banner.evaluate(el=>el.classList.contains('is-arriving')),false);
      console.log('PASS '+theme+' 移入淡出、点击穿透、移出恢复且不重复展开');
      await page.locator('#btnSaveSettings').click();
      await page.waitForFunction(()=>!settingsHaveChanges());
      await page.waitForFunction(()=>document.querySelector('#efUnsavedNotice').hidden);
      console.log('PASS '+theme+' 保存成功后自动收起，无重复旧状态框');
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('select[data-key=theme]').selectOption('light_endfield',{force:true});
    await page.waitForFunction(()=>!document.querySelector('#efUnsavedNotice').hidden);
    assert.equal(await banner.evaluate(el=>el.getAnimations({subtree:true}).length),0);
    await page.evaluate(()=>{document.querySelector('#page-settings').classList.remove('active');CFTEndfieldUnsaved.refresh();});
    await page.waitForFunction(()=>document.querySelector('#efUnsavedNotice').hidden);
    assert.deepEqual(errors,[]);
    console.log('PASS 减少动画、离开设置页收起、无前端异常');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
