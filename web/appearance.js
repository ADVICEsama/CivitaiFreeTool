/* 本地字体预览与独立文字尺寸。菜单只渲染可见行，不一次排版数百种字体。 */
"use strict";
const TEXT_SCALES = {small: .9, standard: 1, large: 1.1, xlarge: 1.2, huge: 1.3};
let fontPicker = null;
function syncFontChoice() {
  const button = document.getElementById('fontChoice');
  if (!button) return;
  const font = String(state.cfg.ui_font || '');
  const name = button.querySelector('span');
  name.textContent = font || '软件默认字体';
  name.style.fontFamily = font ? JSON.stringify(font) + ', var(--font)' : 'var(--font)';
}
function closeFontMenu() {
  if (!fontPicker) return;
  fontPicker.menu.remove();
  const button = document.getElementById('fontChoice');
  if (button) { button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-activedescendant'); }
  document.getElementById('fontSearch')?.removeAttribute('aria-activedescendant');
  fontPicker = null;
}
function openFontMenu() {
  if (fontPicker) return;
  const menu = document.createElement('div');
  menu.id = 'fontMenu'; menu.className = 'font-menu'; menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', '本地字体名称预览');
  menu.innerHTML = '<div class="font-menu-space"></div>';
  document.body.append(menu);
  fontPicker = {menu, fonts: [], active: 0, rowHeight: 36};
  document.getElementById('fontChoice').setAttribute('aria-expanded', 'true');
  menu.addEventListener('scroll', renderFontRows);
  menu.addEventListener('mousedown', e => e.preventDefault()); // 保留组合框键盘焦点
  menu.addEventListener('click', e => {
    const row = e.target.closest('[data-font-index]');
    if (row) chooseFont(Number(row.dataset.fontIndex));
  });
  filterFontMenu();
}
function positionFontMenu() {
  if (!fontPicker) return;
  const button = document.getElementById('fontChoice');
  if (!button || !button.getClientRects().length) { closeFontMenu(); return; }
  const rect = button.getBoundingClientRect(), zoom = Number(state.cfg.ui_zoom || 100) / 100;
  const height = Math.min(320, Math.max(140, innerHeight - rect.bottom - 16));
  const above = innerHeight - rect.bottom < 160 && rect.top > 180;
  const upperHeight = Math.min(320, rect.top - 16);
  const contentHeight = fontPicker.fonts.length * fontPicker.rowHeight * zoom + 2 * zoom;
  Object.assign(fontPicker.menu.style, {left: rect.left / zoom + 'px', width: rect.width / zoom + 'px',
    top: (above ? Math.max(8, rect.top - Math.min(upperHeight, contentHeight) - 5) : rect.bottom + 5) / zoom + 'px',
    maxHeight: (above ? upperHeight : height) / zoom + 'px'});
}
function filterFontMenu() {
  if (!fontPicker) return;
  const q = (document.getElementById('fontSearch')?.value || '').trim().toLowerCase();
  const current = String(state.cfg.ui_font || '');
  const all = [...localFontFamilies];
  if (current && !all.includes(current)) all.unshift(current);
  fontPicker.fonts = ['', ...all.filter(f => f.toLowerCase().includes(q))];
  fontPicker.active = Math.max(0, fontPicker.fonts.indexOf(current));
  fontPicker.rowHeight = 36 * (TEXT_SCALES[state.cfg.ui_text_size] || 1);
  fontPicker.menu.firstElementChild.style.height = fontPicker.fonts.length * fontPicker.rowHeight + 'px';
  positionFontMenu();
  if (!fontPicker) return; // 窗口重建/隐藏设置页时定位会关闭菜单。
  fontPicker.menu.scrollTop = fontPicker.active * fontPicker.rowHeight;
  renderFontRows();
}
function renderFontRows() {
  if (!fontPicker) return;
  const {menu, fonts, rowHeight, active} = fontPicker;
  const space = menu.firstElementChild;
  space.style.height = fonts.length * rowHeight + 'px';
  const start = Math.max(0, Math.floor(menu.scrollTop / rowHeight) - 2);
  const end = Math.min(fonts.length, start + Math.ceil((menu.clientHeight || 320) / rowHeight) + 5);
  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const row = document.createElement('div'), font = fonts[i];
    row.id = 'font-option-' + i; row.className = 'font-option' + (active === i ? ' focused' : '');
    row.dataset.fontIndex = i; row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(font === String(state.cfg.ui_font || '')));
    row.textContent = font || '软件默认字体';
    Object.assign(row.style, {top: i * rowHeight + 'px', height: rowHeight + 'px',
      fontFamily: font ? JSON.stringify(font) + ', "Microsoft YaHei UI", sans-serif' : 'var(--font)'});
    fragment.append(row);
  }
  space.replaceChildren(fragment);
  for (const id of ['fontChoice', 'fontSearch']) document.getElementById(id)?.setAttribute('aria-activedescendant', 'font-option-' + active);
}
function chooseFont(index) {
  const font = fontPicker?.fonts[index]; if (font === undefined) return;
  const select = document.querySelector('[data-key="ui_font"]');
  select.value = font; select.dispatchEvent(new Event('change', {bubbles: true}));
  closeFontMenu(); syncFontChoice(); document.getElementById('fontChoice')?.focus();
}
function initFontPicker() {
  closeFontMenu();
  const button = document.getElementById('fontChoice'), search = document.getElementById('fontSearch');
  if (!button || !search) return;
  syncFontChoice();
  button.addEventListener('click', () => fontPicker ? closeFontMenu() : openFontMenu());
  search.addEventListener('input', () => {openFontMenu(); filterFontMenu();});
  const keys = e => {
    if (e.key === 'Escape') {closeFontMenu(); e.preventDefault(); return;}
    if (e.key === 'Tab') {closeFontMenu(); return;}
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key) || (e.target === search && e.key === ' ')) return;
    if (!fontPicker) {if (e.key === 'Enter' && e.target === search) return; openFontMenu(); e.preventDefault(); return;}
    e.preventDefault();
    if (e.key === 'Enter' || e.key === ' ') {chooseFont(fontPicker.active); return;}
    const f = fontPicker;
    f.active = e.key === 'Home' ? 0 : e.key === 'End' ? f.fonts.length - 1 : Math.max(0, Math.min(f.fonts.length - 1, f.active + (e.key === 'ArrowDown' ? 1 : -1)));
    const y = f.active * f.rowHeight;
    if (y < f.menu.scrollTop) f.menu.scrollTop = y;
    else if (y + f.rowHeight > f.menu.scrollTop + f.menu.clientHeight) f.menu.scrollTop = y + f.rowHeight - f.menu.clientHeight;
    renderFontRows();
  };
  button.addEventListener('keydown', keys); search.addEventListener('keydown', keys);
}
document.addEventListener('pointerdown', e => {if (!e.target.closest('#fontMenu, #fontChoice, #fontSearch')) closeFontMenu();});
document.addEventListener('scroll', e => {if (fontPicker && !fontPicker.menu.contains(e.target)) positionFontMenu();}, true);
window.addEventListener('resize', positionFontMenu);
window.addEventListener('cft:zoom', positionFontMenu);

let nativeAppearanceTimer = null, nativeAppearanceSerial = 0;
function applyTextAndWindowAppearance() {
  if (!state.cfg) return; // 初始化期间旧外观绑定可能先于 get_config 执行。
  const root = document.documentElement;
  root.style.setProperty('--type-scale', TEXT_SCALES[state.cfg.ui_text_size] || 1);
  syncFontChoice(); if (fontPicker) filterFontMenu();
  clearTimeout(nativeAppearanceTimer);
  nativeAppearanceTimer = setTimeout(async () => {
    const serial = ++nativeAppearanceSerial, css = getComputedStyle(root);
    // 以浏览器实际解析的主题颜色传给 DWM，Metro 和自定义主题同样可用。
    const colorHex = name => {
      const sample = document.createElement('span'); sample.style.color = css.getPropertyValue(name); document.body.append(sample);
      const channels = getComputedStyle(sample).color.match(/[\d.]+/g); sample.remove();
      return channels?.length >= 3 ? '#' + channels.slice(0,3).map(n => Math.round(Number(n)).toString(16).padStart(2,'0')).join('') : '#241c33';
    };
    try {
      const result = await api.call('set_window_appearance', {mode: state.cfg.window_appearance || 'theme', background: colorHex('--bg'), text: colorHex('--text'),integrated:state.cfg.integrated_titlebar!==false,font:state.cfg.ui_font||'',text_scale:TEXT_SCALES[state.cfg.ui_text_size]||1,page:document.querySelector('.nav-tab.active')?.textContent.trim()||''});
      const status = document.getElementById('windowAppearanceStatus');
      if (status && serial === nativeAppearanceSerial) status.textContent = result?.msg || '';
      if (result?.queued) {
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 250));
          if (serial !== nativeAppearanceSerial) break;
          const actual = await api.call('get_window_appearance');
          if (actual?.mode && actual.mode !== 'pending') {
            if (status?.isConnected) status.textContent = actual.msg || '';
            root.dataset.nativeMaterial=actual.client_material?'true':'false';
            syncWindowControls(actual);
            break;
          }
        }
      }
    } catch (_) { /* 普通浏览器不具备原生窗口接口。 */ }
  }, 120);
}


function syncWindowControls(actual) {
  const controls=document.getElementById('windowControls');
  if (!controls) return;
  const integrated=actual?.integrated === true;
  document.documentElement.dataset.windowButtons=integrated?'true':'false';
  controls.hidden=!integrated;document.documentElement.dataset.windowMaximized=actual?.maximized?'true':'false';
  const max=controls.querySelector('[data-window-action="maximize"]');
  const text=actual?.maximized?'还原窗口':'最大化';
  max.title=text;max.setAttribute('aria-label',text);
  max.querySelector('svg').innerHTML=actual?.maximized?'<path d="M9 5h10v10M5 9h10v10H5Z"/>':'<rect x="5" y="5" width="14" height="14"/>';
}
document.getElementById('windowControls')?.addEventListener('click',async e=>{
  const button=e.target.closest('[data-window-action]');if(!button)return;
  try {
    if(button.dataset.windowAction==='close' && typeof settingsHaveChanges==='function' && settingsHaveChanges()){window.requestSettingsClose();return;}
    const result=await api.call('window_control',button.dataset.windowAction);
    if(result?.ok===false){setStatus(result.msg||'窗口操作失败');return;}
    if(button.dataset.windowAction==='maximize')setTimeout(async()=>{
      try{syncWindowControls(await api.call('get_window_appearance'));}catch(_){}
    },150);
  }catch(_){setStatus('窗口操作暂不可用');}
});
let windowControlsResizeTimer;
window.addEventListener('resize',()=>{
  if(document.getElementById('windowControls')?.hidden)return;
  clearTimeout(windowControlsResizeTimer);
  windowControlsResizeTimer=setTimeout(async()=>{try{syncWindowControls(await api.call('get_window_appearance'));}catch(_){}},120);
});

document.getElementById('windowResizeEdges')?.addEventListener('pointerdown',e=>{
  const edge=e.target.closest('[data-resize-edge]');if(!edge || e.button!==0)return;
  e.preventDefault();e.stopPropagation();api.call('window_resize',edge.dataset.resizeEdge).catch(()=>{});
});
// 页面标题只选空白处拖动，输入/按钮不在拖动范围；双击空白标题可以最大化。
document.addEventListener('dblclick',e=>{
  if(document.documentElement.dataset.windowButtons!=='true' || !e.target.matches('.pywebview-drag-region') || e.target.closest('button,a,input,select,textarea,summary'))return;
  api.call('window_control','maximize').catch(()=>{});
});
