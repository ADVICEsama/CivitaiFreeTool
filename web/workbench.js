/* 工作台壳、分类设置与只读下载历史；复用现有业务 API 和 SVG sprite。 */
"use strict";
const SETTINGS_CATEGORIES = [
  { id: "general", label: "目录与账号", icon: "folder", description: "先配置存放位置和账号，其余选项可保持默认。" },
  { id: "download", label: "下载行为", icon: "download", description: "选择下载完成后生成哪些文件，以及旧版本如何处理。" },
  { id: "appearance", label: "外观与布局", icon: "sparkles", description: "配色、信息密度和路径显示可即时预览并保存。主题切换后请点保存。" },
  { id: "shortcuts", label: "快捷键", icon: "settings", description: "默认关闭。可点击每个功能的设键入口；支持三套预设及自定义，删除仍需确认。" },
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
  integrated_titlebar: "默认隐藏整条标题栏，仅在软件右上角保留最小化、最大化/还原、关闭按钮。可拖动侧栏品牌区或页面标题区，支持边缘缩放。关闭恢复系统框，需重启。",
  window_appearance: "Mica / Mica Alt 扩展到整个窗口背景，面板不再盖住材质；Mica 取桌面壁纸色调，不是实时透视毛玻璃，窗口失焦/系统关闭透明时回退纯色；需要 Windows 11 22H2 或更新版本，不支持时回退不透明背景。选择外部控制可配合 Mica For Everyone，按进程名 CivitaiFreeToolWeb.exe 添加规则；需要另行安装并配置工具，不等于内置 Mica。外部模式使用系统窗口框，改动需重启。",
  proxy_enabled: "只有需要通过代理连接外网时才开启。代理软件需要保持运行。",
  ssl_verify: "建议开启。仅排查代理证书问题时暂时关闭，不要长期关闭。",
  target_env: "选择模型最终使用的环境，让自动整理采用对应目录结构。",
  organize_mode: "先用手动分类熟悉流程，再根据右侧介绍选择自动分类。",
  window_wait_seconds: "30–600 秒，默认 30 秒。正在初始化时会继续宽限，避免 5–8 秒就打断正常启动。改动重启后生效。",
  ui_mode: "默认先打开软件窗口，只有失败才按兜底开关用浏览器。选择浏览器启动后，以后直接打开浏览器，不创建软件窗口。选择即保存，重启生效。",
  browser_fallback_enabled: "默认开启；仍先启动软件窗口，确认初始化失败后才用浏览器兜底。想一直使用浏览器，请选择“界面模式”；也可点下方按钮主动打开。",
  ui_font: "从本机已安装字体中选择；立即预览并保存。不下载网络字体。不包含中文的字体会回退到系统中文字体。",
  model_list_size: "三档独立调节列表行高与信息：当前完整样式是最大，紧凑去掉封面与作者，极简再去本地文件名；极简仅留 C站模型名称和勾选格。未识别模型暂用文件名，不改变全局字号或瀑布流。",
  masonry_card_width: "140–420 px；模型页滑杆或 Alt + 滚轮都可调整，普通滚轮仍用于浏览模型。",
  folder_picker_show_paths: "仅控制分类选择窗口。默认只显示文件夹名字，也可在该窗口顶部临时切换并记住。",
  cache_detail_images: "把详情中已加载的在线缩略图缓存在本机，重复打开优先读取缓存。不下载原图；关闭后不写新缓存。",
  effects_fps_limit: "仅控制拖尾/点击和氛围动画，不改变视频或 WebView 刷新率。0 跟随屏幕；可输入 15–360，上限不保证实际帧率。",
  cache_original_images: "只缓存你打开过的原图和来源已提供的生成数据，下次优先本地读取；不会批量下载未查看的图片。关闭后不读写缓存。",
  gallery_cache_mb: "64–8192 MB，超过上限按最旧访问自动淘汰。缓存随软件数据目录迁移；清理不删除模型或你保存的图片。",
  pointer_effects: "仅在本软件内绘制波纹与几何拖尾，不安装全局鼠标钩子。静止、切后台或关闭时停止绘制。",
  pointer_effect_quality: "轻量档限制 30 FPS、粒子数和像素比例；软件渲染或较慢机器优先选择轻量档。",
};
let settingsCategory = "general";
let historyItems = [];
let historyPage = 1;
let historyRequest = 0;

function settingCategory(key, oldGroup) {
  if(key.startsWith("shortcuts_"))return "shortcuts";
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
    input = '<input class="input" type="' + (type === "number" ? "number" : "text") + '"' + attrs + (key === "window_wait_seconds" ? ' min="30" max="600" step="1"' : key === "effects_fps_limit" ? ' min="0" max="360" step="1"' : key === "gallery_cache_mb" ? ' min="64" max="8192" step="1"' : "") + ' value="' + esc(value == null ? "" : value) + '"/>';
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
  grouped.appearance.push('<div class="setting-row"><div class="setting-copy"><label>已查看原图缓存</label><p>仅删除软件原图与生成信息缓存，不删除模型或已保存图片。</p></div><div class="setting-control"><button class="btn" id="clearGalleryCache" type="button">清理原图缓存</button></div></div>');
  grouped.advanced.push('<div class="setting-row" data-setting-search="浏览器 打开 软件页面 手动"><div class="setting-copy"><label>临时打开浏览器页面</label><p>只在本次另开同一后台的网页，不改长期启动方式。以后都用浏览器，请选择“启动界面 → 浏览器启动”。</p></div><div class="setting-control"><button type="button" class="btn" id="openBrowserPage">'+_icon('external')+'仅本次打开浏览器</button></div></div>');
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
  setModelListSize(state.cfg.model_list_size,false);
  showSettingsCategory(settingsCategory);
  applyCustomUi();
  updateRulesGuide();
  refreshLocalFontOptions();
  refreshStorageInfo();
  if(typeof renderShortcutSettings === "function")renderShortcutSettings();
  if(typeof captureSettingsBaseline === "function")captureSettingsBaseline();
}
let masonrySaveTimer=0,masonryMenuCloseTimer=0;
function openMasonrySizeMenu(){
  closeListSizeMenu();
  if(typeof state==='undefined' || state.mmView!=='masonry')return;
  clearTimeout(masonryMenuCloseTimer);$('#mmViewSeg').classList.add('size-menu-open');
  $('#mmViewMasonry').setAttribute('aria-expanded','true');positionMasonrySizeMenu();
}
function positionMasonrySizeMenu(){
  const menu=$('#mmImageSizeControl'),anchor=$('#mmViewMasonry');if(!menu || !$('#mmViewSeg').classList.contains('size-menu-open'))return;
  const rect=anchor.getBoundingClientRect(),box=menu.getBoundingClientRect(),z=Number(document.documentElement.style.zoom)||1;
  const x=Math.max(8,Math.min(rect.right-box.width,innerWidth-box.width-8));
  const y=rect.bottom+6+box.height<innerHeight-8?rect.bottom+6:Math.max(8,rect.top-box.height-6);
  Object.assign(menu.style,{left:x/z+'px',top:y/z+'px',right:'auto'});
}
function closeMasonrySizeMenu(){
  clearTimeout(masonryMenuCloseTimer);$('#mmViewSeg')?.classList.remove('size-menu-open');
  $('#mmViewMasonry')?.setAttribute('aria-expanded','false');
}

function setMasonrySize(value,save=false) {
  const width=Math.max(140,Math.min(420,Math.round((Number(value)||220)/10)*10));
  document.documentElement.style.setProperty('--model-card-width',width+'px');
  if(typeof state!=='undefined' && state.cfg)state.cfg.masonry_card_width=width;
  const control=$('#mmImageSizeControl');if(control){control.hidden=typeof state==='undefined' || state.mmView!=='masonry';if(control.hidden)closeMasonrySizeMenu();}
  for(const id of ['mmImageSize','setting-masonry_card_width']){const input=document.getElementById(id);if(input)input.value=width;}
  for(const id of ['mmImageSizeValue','masonrySizeSettings']){const label=document.getElementById(id);if(label)label.textContent=width+' px';}
  if(save){clearTimeout(masonrySaveTimer);masonrySaveTimer=setTimeout(()=>api.call('save_config',{masonry_card_width:width}).catch(()=>setStatus('图片大小保存失败')),350);}
}
const MODEL_LIST_SIZES = {3:['完整 · 最大','封面、名称、文件名、作者'],2:['紧凑 · 无封面/作者','名称、本地文件名'],1:['极简 · 仅名称','仅 C站模型名称；未识别用文件名']};
let listSaveTimer=0,listMenuCloseTimer=0,listPersistedSize=null,listSaveGeneration=0;
function closeListSizeMenu(){
  clearTimeout(listMenuCloseTimer);$('#mmViewSeg')?.classList.remove('list-size-menu-open');
  $('#mmViewList')?.setAttribute('aria-expanded','false');
}
function openListSizeMenu(){
  if(state.mmView!=='list')return;
  closeMasonrySizeMenu();clearTimeout(listMenuCloseTimer);$('#mmViewSeg').classList.add('list-size-menu-open');
  $('#mmViewList').setAttribute('aria-expanded','true');positionListSizeMenu();
}
function positionListSizeMenu(){
  const menu=$('#mmListSizeControl'),anchor=$('#mmViewList');if(!menu || !$('#mmViewSeg').classList.contains('list-size-menu-open'))return;
  const rect=anchor.getBoundingClientRect(),box=menu.getBoundingClientRect(),z=Number(document.documentElement.style.zoom)||1;
  const x=Math.max(8,Math.min(rect.right-box.width,innerWidth-box.width-8));
  const y=rect.bottom+6+box.height<innerHeight-8?rect.bottom+6:Math.max(8,rect.top-box.height-6);
  Object.assign(menu.style,{left:x/z+'px',top:y/z+'px',right:'auto'});
}
function setModelListSize(value,save=false){
  const n=Number(value),size=Number.isFinite(n)?Math.max(1,Math.min(3,Math.round(n))):3;
  if(listPersistedSize===null)listPersistedSize=size;
  const previous=Number(state.cfg.model_list_size || 3),info=MODEL_LIST_SIZES[size];
  state.cfg.model_list_size=size;document.documentElement.dataset.modelListSize=String(size);
  for(const id of ['mmListSize','setting-model_list_size']){const input=document.getElementById(id);if(input)input.value=String(size);}
  $('#mmListSize')?.setAttribute('aria-valuetext',info[0]);
  if($('#mmListSizeValue'))$('#mmListSizeValue').textContent=info[0];
  if($('#mmListSizeHint'))$('#mmListSizeHint').textContent=info[1];
  const menu=$('#mmListSizeControl');if(menu){menu.hidden=state.mmView!=='list';if(menu.hidden)closeListSizeMenu();}
  if(state.mmView==='list')mmApplyCols();
  if(save){
    if(size===3 && previous<3)loadThumbs(0);
    clearTimeout(listSaveTimer);const generation=++listSaveGeneration;
    listSaveTimer=setTimeout(async()=>{
      try{if(!await api.call('save_config',{model_list_size:size}))throw Error('save');listPersistedSize=size;}
      catch(_){if(generation===listSaveGeneration)setModelListSize(listPersistedSize,false);setStatus('列表大小保存失败，已恢复上次保存的档位');}
    },350);
  }
  positionListSizeMenu();
}
function bindModelListSize(){
  const anchor=$('#mmViewList'),menu=$('#mmListSizeControl');
  for(const el of [anchor,menu]){
    el.addEventListener('pointerenter',openListSizeMenu);
    el.addEventListener('pointerleave',()=>{listMenuCloseTimer=setTimeout(closeListSizeMenu,160);});
    el.addEventListener('focusin',openListSizeMenu);
  }
  anchor.addEventListener('click',()=>setTimeout(openListSizeMenu,0));
  anchor.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){openListSizeMenu();$('#mmListSize').focus();e.preventDefault();}});
  menu.addEventListener('input',e=>{if(e.target.id==='mmListSize')setModelListSize(e.target.value,true);});
  menu.addEventListener('wheel',e=>{if(e.ctrlKey || e.metaKey || e.altKey)return;e.preventDefault();setModelListSize(Number(state.cfg.model_list_size || 3)+(e.deltaY<0?1:-1),true);},{passive:false});
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#mmViewSeg'))closeListSizeMenu();});
  document.addEventListener('focusin',e=>{if(!e.target.closest('#mmViewSeg'))closeListSizeMenu();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && $('#mmViewSeg').classList.contains('list-size-menu-open')){anchor.focus();closeListSizeMenu();e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener('scroll',positionListSizeMenu,true);window.addEventListener('resize',positionListSizeMenu);window.addEventListener('cft:zoom',positionListSizeMenu);
}
window.addEventListener('cft:config-saved',e=>{if(e.detail?.model_list_size!==undefined)listPersistedSize=Math.max(1,Math.min(3,Math.round(Number(e.detail.model_list_size)||3)));});
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
  dlStartAll:"play", dlPauseAll:"pause", dlRemoveAll:"x", dlPauseSel:"pause", dlRetrySel:"refresh", dlRemoveSel:"x", dlSave:"file", mmViewToggle:"layers", mmUpdOnly:"refresh", mmScan:"scan", mmRefresh:"refresh", mmVerify:"shield", mmCheckUpd:"refresh", mmUpdate:"refresh", mmUpdDl:"download", mmRename:"pencil", mmLocalize:"file", mmJson:"file", mmSite:"external", mmCovers:"image", mmTranslate:"file", mmSendRp:"search", mmOrganize:"folder", mmCleanup:"trash", mmDedupe:"layers", mmFolders:"folder", mmRecover:"refresh", mmRestore:"refresh", mmFilterClear:"x", mmSelAll:"check", mmSelNone:"x", mmSelInv:"refresh", rpAddFiles:"file", rpAddDir:"folder", rpRemoveSel:"x", rpStart:"play", rpPause:"pause", rpStop:"x", btnSaveSettings:"check", btnTestApi:"globe", btnTestBaidu:"file", btnOnboarding:"info", openLogs:"folder", wfAddFiles:"file", wfAddFile:"file", wfChoose:"folder"
};
function syncModelInspector(active) {
  applyModelToolbarLock();
  document.body.classList.toggle("models-workspace", active);
  const mask = $("#detailMask"), panel = $("#detailPanel");
  mask.style.display = active ? "flex" : "none";
  if (active && !panel.innerHTML.trim()) panel.innerHTML = '<div class="inspector-placeholder">' + _icon("layers", "ic-lg") + '<h3>模型信息</h3><p>单击模型：选中并查看详细信息</p><p>详情栏始终保留，模型位置不会因打开详情而变化。</p></div>';
}
function isModelFavorite(path){
  const key=normalizedModelPath(path);
  return !!key && (state.cfg.model_favorites||[]).some(p=>normalizedModelPath(p)===key);
}
async function toggleModelFavorite(path){
  try{
    const result=await api.call('toggle_model_favorite',path);
    if(!result?.ok){showToast(result?.msg||'收藏保存失败');return;}
    state.cfg.model_favorites=result.favorites;renderMm();
    const button=$('#dFavorite');if(button && normalizedModelPath(detailRow?.path)===normalizedModelPath(path))button.setAttribute('aria-pressed',String(isModelFavorite(path)));
    showToast(result.favorite?'已收藏并置顶':'已取消收藏置顶');
  }catch(_){showToast('收藏保存失败');}
}
function applyModelToolbarLock(){
  const locked=state.cfg?.model_toolbar_locked===true;
  document.body.classList.toggle('model-toolbar-locked',locked);
  const viewport=$('#mmMasonryViewport');if(viewport)viewport.hidden=state.mmView!=='masonry';
  const button=$('#mmToolbarLock');if(button){button.setAttribute('aria-pressed',String(locked));button.innerHTML=_icon('pin')+(locked?'取消固定':'固定菜单');}
}
document.addEventListener('click',async e=>{
  if(e.target.closest('#mmToolbarLock')){
    const previous=state.cfg.model_toolbar_locked===true;state.cfg.model_toolbar_locked=!previous;applyModelToolbarLock();
    try{if(!await api.call('save_config',{model_toolbar_locked:!previous}))throw Error('save');}
    catch(_){state.cfg.model_toolbar_locked=previous;applyModelToolbarLock();showToast('菜单状态保存失败');}
  }
  if(e.target.closest('#clearGalleryCache')){
    if(!await confirmBox('清理已查看原图和生成数据缓存？模型和手动保存图片不会删除。'))return;
    try{const r=await api.call('clear_gallery_cache');if(r?.ok && typeof clearViewerImageCache==='function')clearViewerImageCache();showToast(r?.msg||'清理失败');}catch(_){showToast('清理失败');}
  }
});
function decorateWorkbenchIcons(root = document) {
  root.querySelectorAll(".nav-tab[data-nav-icon]").forEach(button => {
    if (button.querySelector(".ic")) return;
    const label = button.textContent.trim();
    button.setAttribute("aria-label", label);
    button.dataset.tip = label;
    button.innerHTML = _icon(button.dataset.navIcon) + '<span class="nav-label">' + esc(label) + '</span>';
  });
  root.querySelectorAll("button").forEach(button => {
    if (button.matches(".font-choice,.window-control")) return;
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
  bindModelListSize();
  decorateWorkbenchIcons();
  document.querySelectorAll(".sidebar-brand,.sidebar-name,.sidebar-name small,.page-title,.card > h2,.iv-toolbar").forEach(el=>el.classList.add("pywebview-drag-region"));
  const sizeAnchor=$('#mmViewMasonry'),sizeMenu=$('#mmImageSizeControl');
  sizeAnchor.setAttribute('aria-controls','mmImageSizeControl');sizeAnchor.setAttribute('aria-expanded','false');
  for(const el of [sizeAnchor,sizeMenu]){
    el.addEventListener('pointerenter',openMasonrySizeMenu);
    el.addEventListener('pointerleave',()=>{masonryMenuCloseTimer=setTimeout(closeMasonrySizeMenu,160);});
    el.addEventListener('focusin',openMasonrySizeMenu);
  }
  sizeAnchor.addEventListener('click',()=>setTimeout(openMasonrySizeMenu,0));
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#mmViewSeg'))closeMasonrySizeMenu();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && $('#mmViewSeg').classList.contains('size-menu-open')){sizeAnchor.focus();closeMasonrySizeMenu();e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener('focusin',e=>{if(!e.target.closest('#mmViewSeg'))closeMasonrySizeMenu();});
  document.addEventListener('scroll',positionMasonrySizeMenu,true);window.addEventListener('resize',positionMasonrySizeMenu);window.addEventListener('cft:zoom',positionMasonrySizeMenu);
  sizeAnchor.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){openMasonrySizeMenu();$('#mmImageSize').focus();e.preventDefault();}});
  $('#mmImageSize').addEventListener('input' ,e=>setMasonrySize(e.target.value,true));
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
    if (e.target.matches("[data-key], #organizeRules") && !["ui_mode", "browser_fallback_enabled", "show_file_paths", "custom_accent_enabled", "custom_accent", "ui_density", "ui_corners", "ambient_bg"].includes(e.target.dataset.key)) markSettingsDirty();
    if (e.target.id === "organizeRules") updateRulesGuide();
  });
  $("#settingsForm").addEventListener("change", e => {
    if (e.target.matches("[data-key]") && !["ui_mode", "browser_fallback_enabled", "show_file_paths", "custom_accent_enabled", "custom_accent", "ui_density", "ui_corners", "ambient_bg"].includes(e.target.dataset.key)) markSettingsDirty();
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
