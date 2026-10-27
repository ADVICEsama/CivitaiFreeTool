const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const server = require('../scripts/preview_endfield_settings.cjs');
const output = name => path.resolve('.test_tmp/endfield-settings-preview/' + name);

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 1050}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.__ready && window.CFTEndfieldControls && localFontFamilies.length);
    await page.evaluate(() => document.fonts.ready);
    for (const theme of ['dark_endfield', 'light_endfield']) {
      await page.evaluate(theme => {
        state.cfg.theme = theme;
        document.documentElement.dataset.theme = theme;
        applyUiAppearance();
      }, theme);
      await page.locator('#settingsSearch').fill('名称滚动');
      await page.locator('#settingsSearch').blur();
      const input = page.locator('[data-key=name_scroll_speed]');
      const plus = input.locator('..').locator('.plus');
      const number = await input.evaluate(el => {
        const style = getComputedStyle(el), box = el.getBoundingClientRect(), track = el.parentElement.getBoundingClientRect();
        return {size: style.fontSize, dy: (box.top + box.bottom - track.top - track.bottom) / 2};
      });
      assert.equal(number.size, '22px');
      assert.equal(number.dy, -1);
      await plus.hover();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-key=name_scroll_speed]').parentElement.querySelector('.plus')).backgroundColor === 'rgb(255, 239, 1)');
      await page.screenshot({path: output('settings-controls-' + theme + '-v3.png')});
      await input.hover();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-key=name_scroll_speed]')).opacity === '0.55');
      await input.click();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-key=name_scroll_speed]')).opacity === '1');
      await input.fill('75');
      await input.press('Tab');
      assert.equal(await page.evaluate(() => state.cfg.name_scroll_speed), 75);
      await input.fill('70');
      await input.press('Tab');
      console.log('PASS ' + theme + ' 22px数字上移校准，加减悬停黄色，数字悬停半透明且编辑仍清楚');

      const small = await page.locator('#settingsActions>.ef-footer-action:not(.ef-action-primary)').evaluateAll(buttons => buttons.map(button => ({
        padding: getComputedStyle(button).paddingRight,
        gap: getComputedStyle(button).columnGap,
        transform: button.querySelector('mask path').getAttribute('transform'),
        cap: getComputedStyle(button.querySelector('mask path')).strokeLinecap,
        join: getComputedStyle(button.querySelector('mask path')).strokeLinejoin,
      })));
      small.forEach(button => {
        assert.equal(button.padding, '9px');
        assert.equal(button.gap, '10px');
        assert.match(button.transform, /scale\(\.76\)/);
        assert.equal(button.cap, 'butt');
        assert.equal(button.join, 'miter');
      });
      const check = page.locator('#btnSaveSettings mask path');
      assert.equal(await check.getAttribute('stroke-linecap'), 'butt');
      assert.equal(await check.getAttribute('stroke-linejoin'), 'miter');
      if (theme === 'light_endfield') {
        const shadow = await page.locator('#btnSaveSettings').evaluate(el => getComputedStyle(el).boxShadow);
        assert.match(shadow, /rgb\(32, 37, 29\) 0px 0px 0px 2px/);
        const ring = await page.locator('#btnSaveSettings .ef-action-circle').evaluate(el => getComputedStyle(el, '::after').content);
        assert.equal(ring, 'none');
        const secondaryShadow = await page.locator('#btnTestApi').evaluate(el => getComputedStyle(el).boxShadow);
        assert(!secondaryShadow.includes('rgb(32, 37, 29)'));
        const nav = await page.locator('.nav-tab.active').evaluate(el => getComputedStyle(el, '::after').borderRightColor);
        assert.equal(nav, 'rgb(255, 239, 1)');
        const slash = await page.locator('#page-settings .page-title').evaluate(el => getComputedStyle(el, '::before').webkitTextStrokeWidth);
        assert.equal(slash, '0.65px');
        const section = await page.locator('#settings-appearance h3').evaluate(el => getComputedStyle(el, '::before').borderLeftColor);
        assert.equal(section, 'rgb(32, 37, 29)');
        assert.equal(await page.locator('#settingsDirty').evaluate(el => getComputedStyle(el).display), 'none');
        await page.mouse.move(0, 0);
        await page.locator('#settingsSearch').focus();
        await page.locator('#settingsSearch').blur();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-key=name_scroll_speed]')).opacity === '1');
        await page.screenshot({path: output('settings-controls-light-final-v4.png')});
      }
      console.log('PASS ' + theme + ' 小图标留白、直角端点，亮色次按钮无黑圈且主图标无多余圈');

      await page.locator('#settingsSearch').fill('');
      await page.locator('#fontChoice').click();
      await page.waitForFunction(() => document.querySelector('#fontCancel.ef-action-secondary'));
      const cancel = await page.locator('#fontCancel').evaluate(el => ({
        height: el.getBoundingClientRect().height,
        stem: getComputedStyle(el.querySelector('.ef-action-stem')).display,
        texture: getComputedStyle(el.querySelector('.ef-action-texture')).backgroundImage,
        icon: el.querySelector('.ef-action-circle').getBoundingClientRect().width,
      }));
      assert.equal(cancel.height, await page.locator('#fontConfirm').evaluate(el => el.getBoundingClientRect().height));
      assert.equal(cancel.icon, 32);
      assert.equal(cancel.stem, 'block');
      assert.match(cancel.texture, /button-contours\.svg/);
      if (await page.locator('#fontScopeToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#fontScopeToggle').click();
      await page.locator('[data-font-scope=zhHans]').click();
      if (theme === 'light_endfield') {
        for (const selector of ['#fontScopeToggle', '[data-font-scope=zhHans]', '#fontAvailable .focused']) {
          assert.match(await page.locator(selector).evaluate(el => getComputedStyle(el).boxShadow), /rgb\(32, 37, 29\)/);
        }
      }
      await page.screenshot({path: output('font-controls-' + theme + '-v3.png')});
      await page.locator('#fontCancel').click();
      await page.waitForFunction(() => !fontPicker);
      console.log('PASS ' + theme + ' 取消与确认同尺寸细节，字体激活黄块黑框');
    }
    await page.evaluate(() => {state.cfg.theme = 'dark'; document.documentElement.dataset.theme = 'dark'; applyUiAppearance();});
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark_endfield');
    assert.equal(await page.locator('#settingsActions>.ef-action-secondary').count(), 3);
    assert.deepEqual(errors, []);
    console.log('PASS 已删除主题迁移为终末地，保留统一控件且无前端异常');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
