/* The selection background moves; category text/icons and content retain their behavior. */
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const server = require('../scripts/preview_endfield_settings.cjs');

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  let count = 0;
  const ok = text => console.log(`PASS ${++count} ${text}`);
  try {
    const page = await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.__ready && document.querySelector('.ef-settings-selection:not([hidden])'));
    await page.evaluate(() => document.fonts.ready);
    const aligned = () => page.evaluate(() => {
      const layer=document.querySelector('.ef-settings-selection'),tab=document.querySelector('.settings-tab.active');
      const a=layer.getBoundingClientRect(),b=tab.getBoundingClientRect();
      return {hidden:layer.hidden,error:Math.max(Math.abs(a.left-b.left),Math.abs(a.top-b.top),Math.abs(a.width-b.width),Math.abs(a.height-b.height))};
    });
    for (const theme of ['light_endfield','dark_endfield']) {
      await page.evaluate(theme => {state.cfg.theme=theme;document.documentElement.dataset.theme=theme;applyUiAppearance();},theme);
      await page.evaluate(() => showSettingsCategory('general'));
      await page.waitForTimeout(180);
      const motion=await page.evaluate(async () => {
        const layer=document.querySelector('.ef-settings-selection'),tab=document.querySelector('[data-settings-category=advanced]');
        const label=tab.querySelector('span'),icon=tab.querySelector('svg:not(.ef-settings-original)');
        const before={label:label.getBoundingClientRect().x,icon:icon.getBoundingClientRect().x};
        showSettingsCategory('advanced');
        const animation=layer.getAnimations()[0];animation.pause();
        const sample=[];
        for(const time of [0,65,129]){animation.currentTime=time;await new Promise(requestAnimationFrame);const m=new DOMMatrix(getComputedStyle(layer).transform);sample.push({x:m.e,y:m.f});}
        const result={duration:animation.effect.getTiming().duration,sample,iconDelta:icon.getBoundingClientRect().x-before.icon,labelDelta:label.getBoundingClientRect().x-before.label,tabAnimations:tab.getAnimations().length,contentMotion:[...document.querySelectorAll('#settings-advanced .setting-row')].some(el=>el.getAnimations().length>0),frame:getComputedStyle(layer,'::before').inset,texture:getComputedStyle(layer,'::before').backgroundImage};
        animation.finish();await animation.finished;return result;
      });
      console.log('MOTION',theme,JSON.stringify(motion));assert.equal(motion.duration,130);
      assert(motion.sample[0].x<motion.sample[1].x&&motion.sample[1].x<motion.sample[2].x);
      assert(motion.sample.every(p=>Math.abs(p.y-motion.sample[0].y)<.1));
      assert(Math.abs(motion.iconDelta)<=1&&Math.abs(motion.labelDelta)<=1);
      assert.equal(motion.tabAnimations,0);
      assert(motion.contentMotion);
      assert.equal(motion.frame,'2px');assert.match(motion.texture,/terrain-contours/);
      assert((await aligned()).error<1);
      const nav=await page.locator('.settings-nav').evaluate(el=>({display:getComputedStyle(el).display,columns:getComputedStyle(el).gridTemplateColumns.split(' ').length}));
      assert.equal(nav.display,'grid');assert.equal(nav.columns,9);
      assert.equal(await page.locator('.settings-tab>span').first().evaluate(el=>getComputedStyle(el).position),'static');
      ok(`${theme} 黄块130ms水平平移，原图标文字布局不动、2px剪角和内容动画保留`);
    }
    await page.locator('#settingsSearch').fill('代理');
    await page.waitForFunction(()=>document.querySelector('.ef-settings-selection').hidden);
    assert.equal(await page.locator('.settings-tab.active').count(),0);
    await page.locator('#settingsSearch').fill('');
    await page.waitForFunction(()=>!document.querySelector('.ef-settings-selection').hidden);
    assert((await aligned()).error<1);
    ok('跨分类搜索隐藏黄块，清空后恢复当前分类位置');

    await page.evaluate(()=>{showSettingsCategory('download');showSettingsCategory('organize');showSettingsCategory('maintenance');});
    assert((await page.locator('.ef-settings-selection').evaluate(el=>el.getAnimations().length))<=1);
    await page.waitForTimeout(180);assert((await aligned()).error<1);
    ok('快速连续切换只保留最新背景动画');
    for (const width of [680,980,1101,1920]) {
      await page.setViewportSize({width,height:1000});
      await page.waitForTimeout(60);
      await page.locator('[data-settings-category=maintenance]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(60);
      assert((await aligned()).error<1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    ok('resize及窄屏原生横向滚动后背景仍精确对齐');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>showSettingsCategory('general'));
    assert.equal(await page.locator('.ef-settings-selection').evaluate(el=>el.getAnimations().length),0);
    assert((await aligned()).error<1);
    ok('减少动态效果立即定位，不播放横移动画');
    await page.evaluate(()=>{document.documentElement.dataset.endfield='false';document.documentElement.dataset.theme='dark';});
    await page.waitForFunction(()=>document.querySelector('.ef-settings-selection').hidden);
    await page.evaluate(()=>{document.documentElement.dataset.endfield='true';document.documentElement.dataset.theme='dark_endfield';});
    await page.waitForFunction(()=>!document.querySelector('.ef-settings-selection').hidden);
    assert((await aligned()).error<1);
    assert.equal(await page.locator('.ef-settings-selection').count(),1);
    ok('主题退出停止并隐藏，恢复时仅一个背景层');
    assert.deepEqual(errors,[]);ok('无前端异常');console.log('TOTAL '+count);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
