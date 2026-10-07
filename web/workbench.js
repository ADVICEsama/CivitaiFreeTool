/* 工作台壳、分类设置与只读下载历史；复用现有业务 API 和 SVG sprite。 */
"use strict";
const SETTINGS_CATEGORIES = [
  { id: "general", label: "目录与账号", icon: "folder", description: "先配置存放位置和账号，其余选项可保持默认。" },
  { id: "download", label: "下载行为", icon: "download", description: "选择下载完成后生成哪些文件，以及旧版本如何处理。" },
  { id: "appearance", label: "外观与布局", icon: "sparkles", description: "配色、信息密度和路径显示可即时预览并保存。主题切换后请点保存。" },
  { id: "network", label: "网络与代理", icon: "globe", description: "网络正常时无需改动。关闭证书验证会降低连接安全性。" },
  { id: "translation", label: "翻译服务", icon: "file", description: "配置百度翻译账号，决定简介和文件名是否汉化。" },
  { id: "organize", label: "分类规则", icon: "tag", description: "这里定义模型的整理方式；保存设置本身不会移动任何文件。" },
  { id: "advanced", label: "高级与启动", icon: "settings", description: "启动、窗口及兼容性选项。不确定用途时建议保留默认值。" },
  { id: "maintenance", label: "维护与帮助", icon: "shield", description: "缓存清理、日志和使用引导。清理缓存不删除模型主文件。" },
];
const ADVANCED_SETTING_KEYS = new Set(["ui_mode", "window_wait_seconds", "browser_fallback_enabled", "close_action", "webview_disable_gpu", "tray_icon", "exit_when_page_closed", "default_page", "confirm_buttons_flip", "rename_menu_default"]);
const WORKBENCH_SETTING_HELP = {
  theme: "绯夜为浓郁玫红，夜樱为柔和低饱和粉。强调色、圆角和字体可独立调整。",
  api_key: "用于查询和下载 C 站模型。在 Civitai 账号页面生成后粘贴到这里。",
  download_dir: "没有另选保存位置时，模型下载到这个目录。",
  models_dirs: "每行一个模型目录；支持同时添加 WebUI 和 ComfyUI 的模型目录。只扫描，不移动文件。",
  site_domain: "用于在浏览器中打开模型页面；模型查询 API 仍使用官方接口。",
  ui_zoom: "统一调整整个界面大小；Ctrl + 滚轮始终用于全局缩放。只放大文字请使用“全局字号”。",
  ui_text_size: "五档文字尺寸，同步调整图标，不改变界面缩放比例和图片宽度；标题、正文保留原有大小层次。立即生效并保存。",
  integrated_titlebar: "默认使用原生自绘窗口栏，融入软件布局；支持窗口按钮、拖动、双击最大化和边缘缩放。关闭可恢复 Windows 标准标题栏。",
  window_appearance: "Mica / Mica Alt 扩展到整个窗口背景，半透明面板仍保持文字与图片清晰；需要 Windows 11 22H2 或更新版本，不支持时回退不透明背景。选择外部控制可配合 Mica For Everyone，按进程名 CivitaiFreeToolWeb.exe 添加规则，不再强制覆盖工具的效果。",
  proxy_enabled: "只有需要通过代理连接外网时才开启。代理软件需要保持运行。",
  ssl_verify: "建议开启。仅排查代理证书问题时暂时关闭，不要长期关闭。",
  target_env: "选择模型最终使用的环境，让自动整理采用对应目录结构。",
  organize_mode: "先用手动分类熟悉流程，再根据右侧介绍选择自动分类。",
  window_wait_seconds: "30–600 秒，默认 30 秒。正在初始化时会继续宽限，避免 5–8 秒就打断正常启动。改动重启后生效。",
  browser_fallback_enabled: "默认开启；仍先启动软件窗口，确认初始化失败后才用浏览器兜底。想一直使用浏览器，请选择“界面模式”；也可点下方按钮主动打开。",
  ui_font: "从本机已安装字体中选择；立即预览并保存。不下载网络字体。不包含中文的字体会回退到系统中文字体。",
  masonry_card_width: "140–420 px；模型页滑杆或 Alt + 滚轮都可调整，普通滚轮仍用于浏览模型。",
  folder_picker_show_paths: "仅控制分类选择窗口。默认只显示文件夹名字，也可在该窗口顶部临时切换并记住。",
  cache_detail_images: "把详情中已加载的在线缩略图缓存在本机，重复打开优先读取缓存。不下载原图；关闭后不写新缓存。",
  pointer_effects: "仅在本软件内绘制波纹与几何拖尾，不安装全局鼠标钩子。静止、切后台或关闭时停止绘制。",
  pointer_effect_quality: "轻量档限制 30 FPS、粒子数和像素比例；软件渲染或较慢机器优先选择轻量档。",
};
let settingsCategory = "general";
let historyItems = [];
let historyPage = 1;
let historyRequest = 0;

function settingCategory(key, oldGroup) {
  if (ADVANCED_SETTING_KEYS.has(key)) return "advanced";
  return ({ "基本": "general", "下载": "download", "界面": "appearance", "网络": "network", "翻译": "translation" })[oldGroup] || "advanced";
}
function settingRow(key, label, type, opts, tip) {
  const value = state.cfg[key] ?? ({ui_text_size:"standard",window_appearance:"theme"})[key];
  const id = "setting-" + key;
  const attrs = ' id="' + id + '" data-key="' + key + '" aria-label="' + esc(label) + '" aria-describedby="' + id + '-help"';
  let input = "";
  if (type === "bool") {
    input = '<label class="setting-switch"><input type="checkbox"' + attrs + ((["zebra_rows","integrated_titlebar"].includes(key) ? value !== false : value) ? " checked" : "") + '/><span>开启</span></label>';
  } else if (type === "select") {
    input = '<select class="input"' + attrs + '>' + opts.map((o) => {
      const val = Array.isArray(o) ? o[0] : o;
      const text = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(val) + '"' + (String(value) === String(val) ? " selected" : "") + '>' + esc(text) + '</option>';
    }).join("") + '</select>';
  } else if (type === "font") {
    input = '<input class="input font-search" id="fontSearch" type="search" placeholder="搜索本地字体名称…" aria-label="搜索本地字体" aria-controls="fontMenu"/><select hidden'+attrs+'><option value="">软件默认字体</option>' + (value ? '<option selected value="'+esc(value)+'">'+esc(value)+'</option>' : '') + '</select><button type="button" class="input font-choice" id="fontChoice" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="fontMenu" aria-label="默认字体（字体名称即预览）"><span>'+esc(value || '软件默认字体')+'</span><span aria-hidden="true">⌄</span></button><div class="font-preview"><span id="fontPreviewName">'+esc(value || '软件默认字体')+'</span><p>角色模型 · 下载管理 · 绯夜主题</p><p>Model Library  ABC abc  0123456789</p><small id="fontListStatus">正在读取本地字体…</small></div>';
  } else if (type === "range") {
    input = '<div class="setting-range"><input type="range"'+attrs+' min="'+opts[0]+'" max="'+opts[1]+'" step="'+opts[2]+'" value="'+(Number(value)||220)+'"/><output id="masonrySizeSettings">'+(Number(value)||220)+' px</output></div>';
  } else if (type === "dirs") {
    const dirs = (Array.isArray(value) && value.length) ? value : (state.cfg.models_dir ? [state.cfg.models_dir] : []);
    input = '<textarea class="input" rows="3"' + attrs + ' placeholder="D:\\ComfyUI\\models&#10;D:\\WebUI\\models">' + esc(dirs.join("\n")) + '</textarea>';
  } else if (type === "dir") {
    input = '<div class="dir-pick"><input class="input"' + attrs + ' value="' + esc(value || "") + '" readonly placeholder="使用默认下载目录"/>' +
      '<button type="button" class="btn" data-dirpick="' + key + '">' + _icon("folder") + '选择</button><button type="button" class="btn" data-dirclear="' + key + '">清除</button></div>';
  } else if (type === "password") {
    input = '<div class="pwd-wrap"><input class="input" type="password"' + attrs + ' value="' + esc(value || "") + '"/><button type="button" class="pwd-eye btn" data-eye="' + key + '" aria-label="显示或隐藏' + esc(label) + '">显示</button></div>';
  } else if (type === "color") {
    input = '<input class="appearance-color" type="color"' + attrs + ' value="' + esc(/^#[0-9a-f]{6}$/i.test(value || "") ? value : "#60a5fa") + '"/>';
  } else {
    input = '<input class="input" type="' + (type === "number" ? "number" : "text") + '"' + attrs + (key === "window_wait_seconds" ? ' min="30" max="600" step="1"' : "") + ' value="' + esc(value == null ? "" : value) + '"/>';
  }
  if(key === "window_appearance") input += '<p id="windowAppearanceStatus" role="status"></p>';
  const help = tip || "保持默认即可，按需要调整。";
  return '<div class="setting-row" data-setting-key="' + key + '" data-setting-search="' + esc((label + " " + help + " " + key).toLowerCase()) + '">' +
    '<div class="setting-copy"><label for="' + id + '">' + esc(label) + '</label><p id="' + id + '-help">' + esc(help) + '</p></div><div class="setting-control">' + input + '</div></div>';
}

function parseOrganizeRules(raw) {
  const rules = [], errors = [];
  String(raw || "").split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const match = line.match(/^\s*(.+?)\s*(?:->|=>|→)\s*(.+?)\s*$/);
    if (!match) { errors.push("第 " + (i + 1) + " 行：请按 关键词 -> 文件夹 填写"); return; }
    const keywords = match[1].split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const folder = match[2].trim();
    if (!keywords.length || !folder || /[\\/:*?"<>|]/.test(folder) || /^\.+$/.test(folder) || /[. ]$/.test(folder)) {
      errors.push("第 " + (i + 1) + " 行：目标需为单个合法文件夹名称，不是完整路径"); return;
    }
    rules.push({keywords, folder});
  });
  return {rules, errors};
}
function buildWorkbenchSettings() {
  const grouped = Object.fromEntries(SETTINGS_CATEGORIES.map(c => [c.id, []]));
  for (const [oldGroup, key, label, type, opts] of SETTING_FIELDS) {
    grouped[settingCategory(key, oldGroup)].push(settingRow(key, label, type, opts, WORKBENCH_SETTING_HELP[key] || SETTING_TIPS[key]));
  }
  grouped.general.push('<div class="setting-row storage-row" data-setting-search="数据 储存 存储 配置 历史 缓存 exe 位置 directory"><div class="setting-copy"><label for="storageNewPath">软件信息储存位置</label><p>默认在 EXE 旁。可迁移配置、任务、历史、图文缓存等软件数据；模型文件不会移动。原数据保留。目录含账号配置，请使用个人专用目录。</p><p id="storageCurrent">正在读取…</p><p id="storageWarning" role="status"></p></div><div class="setting-control"><input class="input" id="storageNewPath" placeholder="输入完整的专用目录路径" aria-label="软件数据新目录"/><div class="storage-actions"><button type="button" class="btn" id="storagePick">'+_icon('folder')+'选择目录</button><button type="button" class="btn" id="storageSuggested">个人数据目录</button><button type="button" class="btn" id="storageDefault">EXE 旁</button><button type="button" class="btn btn-primary" id="storageMigrate">'+_icon('check')+'迁移并使用</button></div><p id="storageResult" role="status"></p></div></div>');
  grouped.advanced.push('<div class="setting-row" data-setting-search="浏览器 打开 软件页面 手动"><div class="setting-copy"><label>主动打开浏览器界面</label><p>在系统浏览器显示同一软件页面，不重启下载后台，也不更改默认启动方式。</p></div><div class="setting-control"><button type="button" class="btn" id="openBrowserPage">'+_icon('external')+'用浏览器打开软件页面</button></div></div>');
  grouped.organize.push(settingRow("target_env", "目标部署环境", "select", [["", "请先选择环境"], ["webui", "WebUI / Forge"], ["comfyui", "ComfyUI"]], WORKBENCH_SETTING_HELP.target_env));
  grouped.organize.push(settingRow("organize_mode", "整理方式", "select", [["manual", "手动选文件夹（推荐新手）"], ["civitai", "按 C 站标签自动分类"], ["rules", "按关键词规则分类"]], WORKBENCH_SETTING_HELP.organize_mode));
  grouped.organize.push('<div class="setting-row rules-row" id="organizeRulesRow" data-setting-search="分类规则 关键词 文件夹 organize_rules"><div class="setting-copy"><label for="organizeRules">关键词规则</label><p>每行一条，英文或中文逗号分隔多个关键词。越具体的规则放在越前面。</p><button class="btn" type="button" id="insertRuleExample">' + _icon("plus") + '插入示例</button></div><div class="setting-control"><textarea class="input rules" id="organizeRules" rows="6" placeholder="写实, realistic -> 写实模型&#10;水彩, watercolor -> 水彩风格">' + esc((state.cfg.organize_rules || []).map(r => (r.keywords || []).join(", ") + " -> " + r.folder).join("\n")) + '</textarea><p id="ruleValidation" role="status"></p></div></div>');
  const guide = '<aside class="organize-guide" aria-label="分类规则使用介绍"><h3>' + _icon("info") + '怎么使用分类规则？</h3><ol><li>先在“目录与账号”配置模型管理目录。</li><li>选择 WebUI / Forge 或 ComfyUI 环境。</li><li>新手选“手动”；想自动整理再选标签或关键词规则。</li><li>保存后到“模型管理”勾选模型，点击“整理模型”。</li></ol><hr/><h4>三种方式有什么区别？</h4><p><b>手动：</b>由你逐个选目标文件夹，不需要写规则。</p><p><b>C 站标签：</b>按类型、基础模型和标签整理；需要已有 C 站元数据，没有时先反向解析。</p><p><b>关键词：</b>检查文件名、C 站模型名及标签；不分大小写，任意关键词包含匹配即可。</p><h4>关键词规则示例</h4><code>写实, realistic -&gt; 写实模型</code><p>“portrait_realistic.safetensors”会进入该模型所属根目录下的“写实模型”。目标填文件夹名，不要填完整路径。</p><p>从上到下采用第一条命中的规则；没有命中则保持原位。主文件及相关元数据 / 封面一起整理。</p><p class="organize-note">保存设置不会移动文件。建议先选少量模型试用；误整理可使用模型管理中的“恢复误整理”。</p></aside>';
  const appearance = '<div class="appearance-preview"><span class="appearance-swatch"></span><span id="appearancePreview">实时预览</span><button class="btn" type="button" id="resetAppearance">恢复外观默认</button></div>';
  const translation = '<div class="bd-links"><h3>还没有百度翻译账号？</h3>' + BAIDU_LINKS.map(l => '<button type="button" class="btn bd-link" data-url="' + esc(l.url) + '">' + _icon("external") + '<span class="bd-link-label">' + esc(l.label) + '</span><span class="bd-link-desc">' + esc(l.desc) + '</span></button>').join("") + '</div>';
  const maintenance = '<div class="maintenance-grid"><div class="setting-row maintenance-item" data-setting-search="图片缓存 清理 删除 images"><h3>图片缓存</h3><p>仅删除模型旁的 .images 图片集。不会删除模型主文件和独立封面。执行前会列出范围并确认。</p><button class="btn" id="btnCleanImgCache">' + _icon("trash") + '清理图片缓存</button></div><div class="setting-row maintenance-item" data-setting-search="排查 日志 入门 帮助 引导"><h3>排查与入门</h3><p>遇到问题先查看日志；首次使用可重新打开配置引导。</p><button class="btn" type="button" data-workbench-proxy="openLogs">' + _icon("folder") + '打开日志</button><button class="btn" type="button" data-workbench-proxy="btnOnboarding">' + _icon("info") + '使用引导</button></div></div>';
  const form = $("#settingsForm");
  form.innerHTML = '<div class="settings-search"><label for="settingsSearch">' + _icon("search") + '</label><input class="input" id="settingsSearch" type="search" placeholder="搜索设置，例如：代理、路径、翻译" aria-label="搜索设置"/><span id="settingsSearchCount" aria-live="polite"></span><span id="settingsDirty" role="status">已保存</span></div><div class="settings-workspace"><div class="settings-nav" role="tablist" aria-label="设置分类" aria-orientation="vertical">' + SETTINGS_CATEGORIES.map(c => '<button class="settings-tab" type="button" role="tab" id="settings-tab-' + c.id + '" aria-controls="settings-' + c.id + '" data-settings-category="' + c.id + '">' + _icon(c.icon) + '<span>' + c.label + '</span></button>').join("") + '</div><div class="settings-panels">' + SETTINGS_CATEGORIES.map(c => '<section class="settings-category" role="tabpanel" id="settings-' + c.id + '" data-settings-panel="' + c.id + '" aria-labelledby="settings-tab-' + c.id + '"><header><h3>' + c.label + '</h3><p>' + c.description + '</p></header>' +
    (c.id === "appearance" ? appearance : "") + (c.id === "organize" ? '<div class="organize-layout"><div>' : "") + grouped[c.id].join("") + (c.id === "organize" ? '</div>' + guide + '</div>' : "") + (c.id === "translation" ? translation : "") + (c.id === "maintenance" ? maintenance : "") + '</section>').join("") + '<p class="settings-empty" id="settingsEmpty" hidden>没有匹配的设置，试试“下载”“路径”或“主题”。</p></div></div>';
  form.querySelectorAll("[data-settings-category]").forEach(b => b.addEventListener("click", () => showSettingsCategory(b.dataset.settingsCategory)));
  $("#settingsSearch").addEventListener("input", filterWorkbenchSettings);
  applyWorkbenchThemeOptions();
  showSettingsCategory(settingsCategory);
  applyCustomUi();
  updateRulesGuide();
  refreshLocalFontOptions();
  refreshStorageInfo();
}
let masonrySaveTimer=0;
function setMasonrySize(value,save=false) {
  const width=Math.max(140,Math.min(420,Math.round((Number(value)||220)/10)*10));
  document.documentElement.style.setProperty('--model-card-width',width+'px');
  if(typeof state!=='undefined' && state.cfg)state.cfg.masonry_card_width=width;
  const control=$('#mmImageSizeControl');if(control)control.hidden=typeof state==='undefined' || state.mmView!=='masonry';
  for(const id of ['mmImageSize','setting-masonry_card_width']){const input=document.getElementById(id);if(input)input.value=width;}
  for(const id of ['mmImageSizeValue','masonrySizeSettings']){const label=document.getElementById(id);if(label)label.textContent=width+' px';}
  if(save){clearTimeout(masonrySaveTimer);masonrySaveTimer=setTimeout(()=>api.call('save_config',{masonry_card_width:width}).catch(()=>setStatus('图片大小保存失败')),350);}
}
let localFontRequest=null;
let localFontFamilies=[];
async function refreshLocalFontOptions() {
  const select=$('[data-key="ui_font"]');if(!select)return;
  initFontPicker(); // 枚举失败或缓慢时，默认字体选项仍可操作。
  try{
    localFontRequest ||= api.call('get_local_fonts');
    const result=await localFontRequest;
    if(!select.isConnected)return;
    const fonts=Array.isArray(result?.fonts)?result.fonts:[];localFontFamilies=fonts;
    const current=String(state.cfg.ui_font || '');
    select.innerHTML='<option value="">软件默认字体</option>'+fonts.map(font=>'<option value="'+esc(font)+'">'+esc(font)+'</option>').join('');
    if(current && !fonts.includes(current))select.insertAdjacentHTML('beforeend','<option value="'+esc(current)+'">'+esc(current)+'（当前未找到）</option>');
    select.value=current;
    syncFontChoice();if(fontPicker)filterFontMenu();
    $('#fontListStatus').textContent=fonts.length?'已读取 '+fonts.length+' 个本地字体族；中文显示取决于字体字形覆盖。':result?.msg || '无法读取本地字体，使用默认字体。';
  }catch(e){if($('#fontListStatus'))$('#fontListStatus').textContent='字体读取失败，仍可使用默认字体。';}
}
let storageInfo={};
async function refreshStorageInfo() {
  const current=$('#storageCurrent');if(!current)return;
  try{
    storageInfo=await api.call('get_data_storage_info') || {};
    if(!current.isConnected)return;
    current.textContent='当前：'+(storageInfo.current || '软件目录');
    $('#storageNewPath').value=storageInfo.current || '';
    $('#storageWarning').textContent=storageInfo.warning || '';
  }catch(e){current.textContent='数据位置读取失败，请稍后重试。';}
}
async function migrateStorageFromSettings() {
  const directory=$('#storageNewPath').value.trim();
  if(!directory){$('#storageResult').textContent='请先选择或填写完整路径';return;}
  if(!confirm('将软件配置、任务、历史和缓存复制到所选目录并切换？原数据保留，模型文件不移动。'))return;
  const button=$('#storageMigrate');button.disabled=true;
  document.body.classList.add('storage-busy');
  let result;
  try{
    result=await api.call('migrate_data_storage',directory,false);
    if(result?.need_confirm){
      if(!confirm(result.msg+'\n涉及：'+(result.conflicts || []).join('、')))return;
      result=await api.call('migrate_data_storage',directory,true);
    }
    $('#storageResult').textContent=result?.msg || '数据迁移没有返回结果';
    if(result?.ok){await refreshStorageInfo();await refreshDownloadHistory();}
  }catch(e){$('#storageResult').textContent='迁移失败；请检查目录权限，原数据仍保留。';}
  finally{button.disabled=false;document.body.classList.remove('storage-busy');}
}
function showSettingsCategory(id) {
  settingsCategory = SETTINGS_CATEGORIES.some(c => c.id === id) ? id : "general";
  const search = $("#settingsSearch");
  if (search) search.value = "";
  filterWorkbenchSettings();
}
function filterWorkbenchSettings() {
  closeFontMenu();
  const q = ($("#settingsSearch")?.value || "").trim().toLowerCase();
  let total = 0;
  $$("[data-settings-panel]").forEach(panel => {
    let matches = 0;
    panel.querySelectorAll(".setting-row").forEach(row => {
      const themeVisible = row.dataset.themeOnly !== "metro" || document.documentElement.dataset.theme === "metro";
      const match = themeVisible && (!q || (row.dataset.settingSearch || "").includes(q));
      row.hidden = !match;
      if (match) matches++;
    });
    total += matches;
    panel.hidden = q ? !matches : panel.dataset.settingsPanel !== settingsCategory;
    panel.querySelectorAll(".organize-guide, .appearance-preview, .bd-links").forEach(el => el.hidden = !!q);
  });
  $$("[data-settings-category]").forEach(tab => {
    const active = !q && tab.dataset.settingsCategory === settingsCategory;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active || q ? 0 : -1;
  });
  const counter = $("#settingsSearchCount");
  if (counter) counter.textContent = q ? total + " 项匹配" : "";
  const empty = $("#settingsEmpty");
  if (empty) empty.hidden = !q || total > 0;
}
function applyWorkbenchThemeOptions() {
  ["ui_scheme", "metro_accent"].forEach(key => {
    const row = document.querySelector('[data-setting-key="' + key + '"]');
    if (row) row.dataset.themeOnly = "metro";
  });
  const zebra = document.querySelector('[data-key="zebra_rows"]');
  if (zebra) { zebra.disabled = false; zebra.checked = state.cfg.zebra_rows !== false; }
  if ($("#settingsSearch")) filterWorkbenchSettings();
}
function updateRulesGuide() {
  const input = $("#organizeRules");
  if (!input) return;
  const parsed = parseOrganizeRules(input.value);
  $("#ruleValidation").textContent = parsed.errors.length ? parsed.errors.join("；") : parsed.rules.length + " 条有效规则 · 保存后在模型管理中执行";
  $("#ruleValidation").classList.toggle("invalid", !!parsed.errors.length);
}
function markSettingsDirty() {
  const badge = $("#settingsDirty");
  if (badge) { badge.textContent = "有未保存更改"; badge.classList.add("dirty"); }
}

async function refreshDownloadHistory() {
  const request = ++historyRequest;
  try {
    const response = await api.call("get_download_history");
    if (request !== historyRequest) return;
    historyItems = Array.isArray(response) ? response : (response && response.items) || [];
    const error = $("#dlHistoryError");
    error.textContent = response?.error || "";
    error.hidden = !error.textContent;
    renderDownloadHistory();
  } catch (e) {
    if (request !== historyRequest) return;
    const error = $("#dlHistoryError");
    error.textContent = "下载历史读取失败，请点击刷新重试。"; error.hidden = false;
  }
}
function renderDownloadHistory() {
  const q = ($("#dlHistorySearch").value || "").trim().toLowerCase();
  const status = {done:"已完成", error:"失败", canceled:"已取消"};
  const rows = historyItems.filter(row => [row.filename, row.modelName, row.dest_dir, status[row.status], row.error].join(" ").toLowerCase().includes(q));
  const pages = Math.max(1, Math.ceil(rows.length / 100));
  historyPage = Math.max(1, Math.min(historyPage, pages));
  $("#dlHistoryTable tbody").innerHTML = rows.slice((historyPage - 1) * 100, historyPage * 100).map(row =>
    '<tr data-history-id="' + esc(row.id) + '"><td class="c-file" title="' + esc(row.filename) + '"><div class="history-thumb" data-history-thumb="' + esc(row.id) + '">' + _icon('image') + '</div><div>' + esc(row.filename) + '</div><div class="file-subpath" title="' + esc(row.dest_dir) + '">' + esc(row.dest_dir || "") + '</div>' + (row.modelName ? '<div class="history-model">' + esc(row.modelName) + '</div>' : "") + '</td><td><span class="history-result ' + esc(row.status) + '">' + esc(status[row.status] || row.status) + '</span>' + (row.error ? '<div class="history-error" title="' + esc(row.error) + '">' + esc(row.error) + '</div>' : "") + '</td><td>' + fmtSize(row.total || row.downloaded) + '</td><td>' + (row.finished_at ? fmtTime(row.finished_at) : '时间未记录') + '</td><td><button class="btn btn-tiny" data-history-open="' + esc(row.id) + '"' + (row.dest_dir ? "" : " disabled") + '>' + _icon("folder") + '打开目录</button><button class="btn btn-tiny" data-history-save="' + esc(row.id) + '"' + (row.file_exists === false || row.status !== 'done' ? ' disabled' : '') + '>' + _icon('folder') + '保存到…</button><button class="btn btn-tiny" data-history-site="' + esc(row.id) + '"' + (row.model_url ? '' : ' disabled') + '>' + _icon('external') + '打开 C 站</button><button class="btn btn-tiny" data-history-info="' + esc(row.id) + '">' + _icon('info') + '模型信息</button></td></tr>').join("") ||
    '<tr><td colspan="5" class="history-empty">' + (q ? '没有匹配的历史记录' : '暂无下载历史。完成、失败、取消的任务会自动保留；收起队列不会删除它们。') + '</td></tr>';
  $("#dlHistoryTable").querySelectorAll("[data-history-thumb]").forEach(async cell => {
    const item = historyItems.find(row => row.id === cell.dataset.historyThumb);
    if (!item?.cached_thumb) return;
    try {
      const b64 = await api.call("get_history_thumbnail", item.id);
      if (b64 && cell.isConnected) cell.innerHTML = '<img alt="历史封面" src="data:image/jpeg;base64,' + b64 + '"/>';
    } catch (e) {}
  });
  $("#dlHistoryCount").textContent = rows.length + " / " + historyItems.length + " 条记录";
  $("#dlHistoryTab").dataset.count = historyItems.length;
  $("#historyPage").textContent = historyPage + " / " + pages;
  $("#historyPrev").disabled = historyPage === 1;
  $("#historyNext").disabled = historyPage >= pages;
}
function updateDownloadQueueCount() {
  $("#dlQueueTab").dataset.count = state.dlTasks.length;
  if (!$("#dlHistoryPanel").hidden) refreshDownloadHistory();
}

const WORKBENCH_ICON_IDS = {
  btnParse:"play", btnClearUrls:"x", btnAddUrl:"plus", btnDlTarget:"folder", btnDlTargetReset:"refresh", dlHistoryTab:"clock", dlQueueTab:"list", dlHistoryRefresh:"refresh",
  dlStartAll:"play", dlPauseSel:"pause", dlRetrySel:"refresh", dlRemoveSel:"x", dlSave:"file", mmViewToggle:"layers", mmUpdOnly:"refresh", mmScan:"scan", mmRefresh:"refresh", mmVerify:"shield", mmCheckUpd:"refresh", mmUpdate:"refresh", mmUpdDl:"download", mmRename:"pencil", mmLocalize:"file", mmJson:"file", mmSite:"external", mmCovers:"image", mmTranslate:"file", mmSendRp:"search", mmOrganize:"folder", mmCleanup:"trash", mmDedupe:"layers", mmFolders:"folder", mmRecover:"refresh", mmRestore:"refresh", mmFilterClear:"x", mmSelAll:"check", mmSelNone:"x", mmSelInv:"refresh", rpAddFiles:"file", rpAddDir:"folder", rpRemoveSel:"x", rpStart:"play", rpPause:"pause", rpStop:"x", btnSaveSettings:"check", btnTestApi:"globe", btnTestBaidu:"file", btnOnboarding:"info", openLogs:"folder", wfAddFiles:"file", wfAddFile:"file", wfChoose:"folder"
};
function syncModelInspector(active) {
  document.body.classList.toggle("models-workspace", active);
  const mask = $("#detailMask"), panel = $("#detailPanel");
  mask.style.display = active ? "flex" : "none";
  if (active && !panel.innerHTML.trim()) panel.innerHTML = '<div class="inspector-placeholder">' + _icon("layers", "ic-lg") + '<h3>模型信息</h3><p>双击模型查看详细信息</p><p>详情栏始终保留，模型位置不会因打开详情而变化。</p></div>';
}
function decorateWorkbenchIcons(root = document) {
  root.querySelectorAll(".nav-tab[data-nav-icon]").forEach(button => {
    if (button.querySelector(".ic")) return;
    const label = button.textContent.trim();
    button.setAttribute("aria-label", label);
    button.dataset.tip = label;
    button.innerHTML = _icon(button.dataset.navIcon) + '<span class="nav-label">' + esc(label) + '</span>';
  });
  root.querySelectorAll("button").forEach(button => {
    if (button.matches(".font-choice")) return;
    Array.from(button.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => {
      const clean = node.data.replace(/^[\s\p{Extended_Pictographic}\uFE0F\u200D▶►]+/u, " ");
      if (node.data !== clean) node.data = clean;
    });
    if (button.querySelector(".ic") || button.classList.contains("nav-tab") || button.classList.contains("mm-seg-btn") || button.matches("[data-eye], .pwd-eye, .ms-check, .fp-favorite-chip")) return;
    const text = button.textContent.replace(/^[\s\p{Extended_Pictographic}\uFE0F▶►＋×]+/u, "").trim();
    const name = WORKBENCH_ICON_IDS[button.id] || WORKBENCH_ICON_IDS[button.dataset.proxy] ||
      ({"取消":"x", "确定":"check", "保存":"check", "刷新":"refresh", "清除":"x", "选择":"folder", "重置尺寸":"ruler", "不移动":"x", "选择文件夹":"folder", "暂停":"pause", "停止":"x", "重试":"refresh", "应用":"check"})[text];
    if (name) button.insertAdjacentHTML("afterbegin", _icon(name));
  });
  root.querySelectorAll(".ctx-item[data-act], .mm-menu button, #page-models .mm-item[data-icon]:not([data-proxy])").forEach(item => {
    if (item.querySelector(".ic")) return;
    const action = item.dataset.act || "";
    const name = item.dataset.icon || (/folder|move|organize/.test(action) ? "folder" : /copy/.test(action) ? "copy" : /site/.test(action) ? "external" : /rename|edit|localize/.test(action) ? "pencil" : /del/.test(action) ? "trash" : /rp|scan/.test(action) ? "search" : "file");
    Array.from(item.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).forEach(n => {n.data = n.data.replace(/^[\s\p{Extended_Pictographic}\uFE0F\u200D]+/u, " ");});
    item.insertAdjacentHTML("afterbegin", _icon(name));
  });
}
function initializeWorkbench() {
  decorateWorkbenchIcons();
  $('#mmImageSize').addEventListener('input',e=>setMasonrySize(e.target.value,true));
  $('#mmImageSizeControl').addEventListener('wheel',e=>{
    if(e.ctrlKey || e.altKey)return;
    e.preventDefault();setMasonrySize(Number(state.cfg.masonry_card_width || 220)+(e.deltaY<0?20:-20),true);
  },{passive:false});
  const about = $("#aboutFloat");
  if (about) {
    $(".nav-right").before(about);
    about.querySelector(".bili-icon").innerHTML = _icon("info");
  }
  for (const link of [about, $(".nav-logo")]) {
    if (!link) continue;
    link.setAttribute("role", "button"); link.tabIndex = 0;
    link.setAttribute("aria-label", "关于 CivitaiFreeTool");
    link.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {e.preventDefault(); link.click();}
    });
  }
  let queued = false;
  new MutationObserver(records => {
    if (!records.some(record => record.addedNodes.length) || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; decorateWorkbenchIcons(); });
  }).observe(document.body, {childList:true, subtree:true});
  $("#toggleSidebar").addEventListener("click", async () => {
    const collapsed = document.documentElement.dataset.sidebar !== "collapsed";
    document.documentElement.dataset.sidebar = collapsed ? "collapsed" : "expanded";
    $("#toggleSidebar").setAttribute("aria-expanded", String(!collapsed));
    $("#toggleSidebar").setAttribute("aria-label", collapsed ? "展开导航" : "收起导航");
    if (state.cfg) state.cfg.sidebar_collapsed = collapsed;
    try { if (!(await api.call("save_config", {sidebar_collapsed:collapsed}))) setStatus("导航布局保存失败"); }
    catch (e) {setStatus("导航布局保存失败");}
  });
  syncModelInspector($("#page-models").classList.contains("active"));
  $("#settingsForm").addEventListener("input", e => {
    if (e.target.matches("[data-key], #organizeRules") && !["show_file_paths", "custom_accent_enabled", "custom_accent", "ui_density", "ui_corners", "ambient_bg"].includes(e.target.dataset.key)) markSettingsDirty();
    if (e.target.id === "organizeRules") updateRulesGuide();
  });
  $("#settingsForm").addEventListener("change", e => {
    if (e.target.matches("[data-key]") && !["show_file_paths", "custom_accent_enabled", "custom_accent", "ui_density", "ui_corners", "ambient_bg"].includes(e.target.dataset.key)) markSettingsDirty();
  });
  $("#settingsForm").addEventListener("click", async e => {
    if(e.target.closest('#openBrowserPage')){const result=await api.call('open_in_browser');setStatus(result?.msg || '已请求打开浏览器界面');return;}
    if(e.target.closest('#storageMigrate')){await migrateStorageFromSettings();return;}
    if(e.target.closest('#storageSuggested')){$('#storageNewPath').value=storageInfo.suggested || '';return;}
    if(e.target.closest('#storageDefault')){$('#storageNewPath').value=storageInfo.default || '';return;}
    if(e.target.closest('#storagePick')){
      const path=await api.call('pick_data_directory');
      if(path)$('#storageNewPath').value=Array.isArray(path)?path[0]:path;
      else $('#storageResult').textContent='未选择目录；浏览器界面可直接填写完整路径。';return;
    }
    if (e.target.closest("#insertRuleExample")) {
      const input = $("#organizeRules");
      const examples = ["写实, realistic -> 写实模型", "水彩, watercolor -> 水彩风格"];
      const missing = examples.filter(line => !input.value.includes(line));
      input.value = [input.value.trim(), ...missing].filter(Boolean).join("\n");
      input.dispatchEvent(new Event("input", {bubbles:true})); input.focus();
    }
    const proxy = e.target.closest("[data-workbench-proxy]");
    if (proxy) document.getElementById(proxy.dataset.workbenchProxy)?.click();
  });
  $("#settingsForm").addEventListener("keydown", e => {
    const tab = e.target.closest("[data-settings-category]");
    if (!tab || !["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const tabs = $$("[data-settings-category]");
    const i = tabs.indexOf(tab);
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click(); tabs[next].focus();
  });
  [false, true].forEach(history => {
    $(history ? "#dlHistoryTab" : "#dlQueueTab").addEventListener("click", () => {
      $("#dlQueuePanel").hidden = history; $("#dlHistoryPanel").hidden = !history;
      for (const id of ["dlQueueTab", "dlHistoryTab"]) {
        const on = (id === "dlHistoryTab") === history;
        $("#" + id).classList.toggle("active", on); $("#" + id).setAttribute("aria-selected", String(on));
      }
      if (history) refreshDownloadHistory();
    });
  });
  $("#dlHistorySearch").addEventListener("input", () => {historyPage = 1; renderDownloadHistory();});
  $("#dlHistoryRefresh").addEventListener("click", refreshDownloadHistory);
  $(".download-tabs").addEventListener("keydown", e => {
    if (e.target.getAttribute("role") !== "tab" || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? $("#dlQueueTab") : e.key === "End" ? $("#dlHistoryTab") :
      e.target.id === "dlQueueTab" ? $("#dlHistoryTab") : $("#dlQueueTab");
    next.click(); next.focus();
  });
  $("#historyPrev").addEventListener("click", () => {historyPage--;renderDownloadHistory();});
  $("#historyNext").addEventListener("click", () => {historyPage++;renderDownloadHistory();});
  $('#dlHistoryTable').addEventListener('dblclick',async e=>{
    if(e.target.closest('button,a,input,select'))return;
    const row=e.target.closest('[data-history-id]');if(!row)return;
    const item=historyItems.find(r=>r.id===row.dataset.historyId);if(!item)return;
    await openHistoryModel(item);
  });
  $("#dlHistoryTable").addEventListener("click", async e => {
    const button = e.target.closest("[data-history-open], [data-history-save], [data-history-site], [data-history-info]");
    if (!button) return;
    const id = button.dataset.historyOpen || button.dataset.historySave || button.dataset.historySite || button.dataset.historyInfo;
    const item = historyItems.find(row => row.id === id);
    if (!item) return;
    try {
      if (button.hasAttribute("data-history-open")) {
        const result = await api.call("open_in_folder", item.file_exists ? item.file_path : item.dest_dir);
        if (result?.ok === false) setStatus(result.msg || "目录可能已移动或删除");
      } else if (button.hasAttribute("data-history-save")) {
        const folder = await pickFolderModal();
        if (!folder) return;
        const result = await api.call("history_move_to", id, folder);
        setStatus(result?.msg || "移动完成");
        await refreshDownloadHistory(); dlRefresh();
      } else if (button.hasAttribute("data-history-site")) {
        if (item.model_url) await api.call("open_url", item.model_url);
      } else {
        await openHistoryModel(item);
      }
    } catch(e) { setStatus("历史操作失败，请重试"); }
  });
}
document.addEventListener("DOMContentLoaded", initializeWorkbench);
window.addEventListener("resize", () => {
  const z = Number(document.documentElement.style.zoom) || 1;
  document.documentElement.dataset.compactLayout = window.innerWidth / z < 1080 ? "true" : "false";
  document.documentElement.dataset.narrowLayout = window.innerWidth / z < 760 ? "true" : "false";
});
