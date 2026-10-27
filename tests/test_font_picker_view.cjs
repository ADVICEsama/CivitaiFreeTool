/* View preferences are saved immediately; font edits stay transactional. */
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const server = require('../scripts/preview_endfield_settings.cjs');

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  let count = 0;
  const ok = message => console.log(`PASS ${++count} ${message}`);
  try {
    const page = await browser.newPage({viewport: {width:1600, height:1050}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const ready = () => page.waitForFunction(() => window.__ready && document.querySelector('.ef-preview-note') && localFontFamilies.length > 0);
    const open = async () => { await page.locator('#fontChoice').click(); await page.waitForFunction(() => fontPicker && !fontPicker.closing); };
    const cancel = async () => { await page.locator('#fontCancel').click(); await page.waitForFunction(() => !fontPicker); };
    const scope = id => page.locator(`[data-font-scope="${id}"]`).click();
    const flush = () => page.evaluate(() => flushFontPickerViewWrites());
    const add = async family => {
      await page.locator('#fontSearch').fill(family);
      await page.locator('#fontAvailable [role=option]').filter({hasText:new RegExp(`^${family}$`)}).dblclick();
    };
    const fonts = () => page.evaluate(() => ({defaults:customFontStack(), scripts:normalizeFontScriptStacks(state.cfg.ui_font_scripts)}));
    const view = () => page.evaluate(() => ({scope:fontPicker.scope, expanded:!fontPicker.menu.querySelector('#fontScopePanel').hidden}));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await ready();
    await open();
    assert.deepEqual(await view(), {scope:'default', expanded:false});
    ok('旧配置默认折叠且显示默认回退');

    await page.evaluate(() => {
      const original = api.call.bind(api);
      window.viewSavePayloads = [];
      api.call = async (method, ...args) => {
        if (method === 'save_config' && Object.hasOwn(args[0] || {}, 'ui_font_picker_view')) window.viewSavePayloads.push(structuredClone(args[0]));
        return original(method, ...args);
      };
    });
    const originalFonts = await fonts();
    await page.locator('#fontScopeToggle').click();
    await scope('digits');
    await add('Arial');
    await scope('ja');
    await add('Segoe UI');
    await page.locator('#fontScopeToggle').click();
    await flush();
    assert.deepEqual(await page.evaluate(() => fixtureCfg.ui_font_picker_view), {expanded:false, scope:'ja'});
    assert.deepEqual(await fonts(), originalFonts);
    assert((await page.evaluate(() => viewSavePayloads)).every(payload => Object.keys(payload).join(',') === 'ui_font_picker_view'));
    await cancel();
    await open();
    assert.deepEqual(await view(), {scope:'ja', expanded:false});
    assert.deepEqual(await page.evaluate(() => fontPicker.draft), []);
    assert.deepEqual(await fonts(), originalFonts);
    ok('取消再打开仍记住分类和展开状态，字体草稿没有顺带保存');

    await page.locator('#fontScopeToggle').click();
    await scope('latin');
    await add('Arial');
    await page.locator('#fontConfirm').click();
    await page.waitForFunction(() => !fontPicker);
    await open();
    assert.deepEqual(await view(), {scope:'latin', expanded:true});
    assert.deepEqual(await page.evaluate(() => fontPicker.draft), ['Arial']);
    const confirmedFonts = await fonts();
    await cancel();
    await page.reload();
    await ready();
    await open();
    assert.deepEqual(await view(), {scope:'latin', expanded:true});
    assert.deepEqual(await fonts(), confirmedFonts);
    assert.deepEqual(await page.evaluate(() => fontPicker.draft), ['Arial']);
    ok('确认再打开及页面刷新均恢复视图与已确认字库');

    await page.evaluate(() => {
      const original = api.call.bind(api);
      window.viewSaveCalls = [];
      window.viewSaveActive = 0;
      window.viewSaveMaxActive = 0;
      window.failPickerView = false;
      api.call = async (method, ...args) => {
        if (method !== 'save_config' || !Object.hasOwn(args[0] || {}, 'ui_font_picker_view')) return original(method, ...args);
        window.viewSaveCalls.push(structuredClone(args[0]));
        window.viewSaveActive++;
        window.viewSaveMaxActive = Math.max(window.viewSaveMaxActive, window.viewSaveActive);
        try {
          await new Promise(resolve => setTimeout(resolve, 70));
          return window.failPickerView ? false : original(method, ...args);
        } finally { window.viewSaveActive--; }
      };
      setFontScopePanel(false);
      setFontScope('ja');
      setFontScopePanel(true);
      setFontScope('digits');
      setFontScope('ko');
    });
    await flush();
    assert.equal(await page.evaluate(() => viewSaveMaxActive), 1);
    assert((await page.evaluate(() => viewSaveCalls.length)) <= 2);
    assert.deepEqual(await page.evaluate(() => fixtureCfg.ui_font_picker_view), {expanded:true, scope:'ko'});
    assert.deepEqual(await fonts(), confirmedFonts);
    ok('快速连续切换串行且合并待写状态，最后选择不会被旧请求覆盖');

    await page.evaluate(() => { window.failPickerView = true; setFontScope('zhHant'); });
    await flush();
    assert.deepEqual(await view(), {scope:'zhHant', expanded:true});
    assert.deepEqual(await page.evaluate(() => fixtureCfg.ui_font_picker_view), {expanded:true, scope:'ko'});
    assert.match(await page.locator('#fontDialogStatus').innerText(), /未保存/);
    assert.deepEqual(await fonts(), confirmedFonts);
    await cancel();
    await open();
    assert.match(await page.locator('#fontDialogStatus').innerText(), /未保存/);
    await page.evaluate(() => { window.failPickerView = false; setFontScope('digits'); });
    await flush();
    assert.deepEqual(await page.evaluate(() => fixtureCfg.ui_font_picker_view), {expanded:true, scope:'digits'});
    assert.doesNotMatch(await page.locator('#fontDialogStatus').innerText(), /未保存/);
    await cancel();
    assert.deepEqual(await fonts(), confirmedFonts);
    ok('保存失败明确提示临时状态，恢复后可重试且不影响已确认字体');
    assert.deepEqual(errors, []);
    ok('无前端异常');
    console.log('TOTAL ' + count);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
