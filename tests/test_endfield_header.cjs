const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const server = require('../scripts/preview_endfield_settings.cjs');
const shot = name => path.resolve('.test_tmp/endfield-settings-preview/' + name);

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 1000}}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.__ready && window.CFTEndfieldSettings && document.querySelector('.ef-preview-note'));
    await page.evaluate(() => document.fonts.ready);
    for (const theme of ['light_endfield', 'dark_endfield']) {
      await page.locator('select[data-key=theme]').selectOption(theme, {force: true});
      await page.locator('[data-settings-category=appearance]').click();
      const tabs = page.locator('#settingsForm .settings-tab');
      assert.equal(await tabs.count(), 9);
      for (const tab of await tabs.all()) {
        assert(await tab.getAttribute('title'));
        assert(await tab.getAttribute('aria-label'));
      }
      const current = page.locator('[data-settings-category=appearance]');
      assert.equal(await current.locator(':scope>span').evaluate(el => getComputedStyle(el).position), 'static');
      assert.equal(await page.locator('.settings-nav').evaluate(el => getComputedStyle(el).display), 'grid');
      const nav = await page.locator('.settings-nav').evaluate(el => ({background: getComputedStyle(el).backgroundImage, height: el.getBoundingClientRect().height}));
      assert.match(nav.background, /repeating-linear-gradient/);
      assert(nav.height <= 80);
      const glyph = await current.locator('.ef-settings-symbol').evaluate(el => ({fill: getComputedStyle(el).fill, stroke: getComputedStyle(el).stroke, width: el.getBoundingClientRect().width}));
      assert.equal(glyph.stroke, 'none');
      assert(glyph.width >= 26);
      await current.focus();
      await current.press('ArrowRight');
      assert.equal(await page.locator('[data-settings-category=shortcuts]').getAttribute('aria-selected'), 'true');
      await page.locator('[data-settings-category=shortcuts]').press('ArrowLeft');
      assert.equal(await current.getAttribute('aria-selected'), 'true');
      console.log('PASS ' + theme + ' 原9项图标加文字布局保留，仅重绘黄色激活项');
      await page.locator('#settingsSearch').fill('');
      await page.locator('#settingsSearch').blur();
      await page.evaluate(() => Promise.all(document.querySelector('#settings-appearance').getAnimations({subtree: true}).map(a => a.finished.catch(() => {}))));
      await page.screenshot({path: shot('settings-header-' + theme + '-v6.png')});
      for (const width of [980, 1600, 1920]) {
        await page.setViewportSize({width, height: 1000});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await page.setViewportSize({width: 1600, height: 1000});
    }
    await page.evaluate(() => {state.cfg.theme = 'dark'; document.documentElement.dataset.theme = 'dark'; applyUiAppearance();});
    assert.equal(await page.locator('[data-settings-category=appearance]>span').evaluate(el => getComputedStyle(el).position), 'static');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark_endfield');
    assert.deepEqual(errors, []);
    console.log('PASS 窄宽布局、旧主题归一终末地且保留分类文字，无异常');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
