/* CivitaiFreeTool 前端逻辑（完整版） */
"use strict";

// ---------- js_api 封装 ----------
const api = {
  call(method, ...args) {
    return window.pywebview.api[method](...args);
  },
};

// ---------- 工具 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function fmtSize(n) {
  n = Number(n || 0);
  if (!n) return "-";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return i === 0 ? n + " B" : n.toFixed(1) + " " + u[i];
}

function fmtTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function short(s, n = 40) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// 界面缩放（实时应用 + 防抖保存）
// 用 html 根元素 zoom：Chromium 对根缩放会重排视口逻辑尺寸，
// 全宽布局（无 max-width 居中）随之自适应，无水平偏移、无空白
// 注意：root zoom 不改变 vh/vw（布局视口恒定），.content 高度需反向补偿，
// 否则缩放后高度不足（下半空白）或溢出（放大裁切）
let zoomTimer = null;
function applyZoom(v) {
  v = Math.max(60, Math.min(200, Math.round(v)));
  const z = v / 100;
  const content = document.querySelector(".content");
  if (z === 1) {
    document.documentElement.style.zoom = "";
    if (content) content.style.height = "";
  } else {
    document.documentElement.style.zoom = z;
    if (content) content.style.height = "calc((100vh - 76px) / " + z + ")";
  }
  if (state && state.cfg) state.cfg.ui_zoom = v;
}
document.addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const cur = Number((state && state.cfg && state.cfg.ui_zoom) || 100);
  applyZoom(cur + (e.deltaY < 0 ? 5 : -5));
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(async () => {
    try { if (state && state.cfg) await api.call("save_config", state.cfg); } catch (err) {}
  }, 600);
}, { passive: false });

function setStatus(t) { $("#statusText").textContent = t; }

function confirmBox(msg) {
  return window.confirm(msg);
}

// ---------- 状态 ----------
const state = {
  cfg: null,
  models: [],
  display: [],
  mmChecked: new Set(),
  mmSel: new Set(),
  mmSort: { col: null, rev: false },
  mmLastSel: -1,
  mmView: "list",
  rpRunning: false,
  dlTimer: null,
};

// ---------- 页面切换 ----------
function switchPage(name) {
  $$(".nav-tab").forEach((t) => t.classList.toggle("active", t.dataset.page === name));
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + name));
  if (name === "models") mmScanIfNeeded();
}
$("#navTabs").addEventListener("click", (e) => {
  const b = e.target.closest(".nav-tab");
  if (b) switchPage(b.dataset.page);
});

// ================= 批量下载 =================
function addUrlRow(url) {
  const row = document.createElement("div");
  row.className = "url-row";
  row.innerHTML =
    '<input class="input" placeholder="https://civitai.red/models/12345"/>' +
    '<button class="icon-btn" title="新建">＋</button>' +
    '<button class="icon-btn" title="删除">×</button>';
  const inp = row.querySelector("input");
  if (url) inp.value = url;
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addUrlRow(); } });
  // 粘贴多行链接自动拆分为多条（剪贴板常见多个 URL）
  inp.addEventListener("paste", (e) => {
    const text = ((e.clipboardData || window.clipboardData) || {}).getData
      ? (e.clipboardData || window.clipboardData).getData("text") : "";
    if (!text || text.indexOf("\n") < 0) return;  // 单行走默认粘贴
    e.preventDefault();
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    inp.value = lines[0];
    for (let i = 1; i < lines.length; i++) addUrlRow(lines[i]);
  });
  row.querySelectorAll(".icon-btn")[0].addEventListener("click", () => addUrlRow());
  row.querySelectorAll(".icon-btn")[1].addEventListener("click", () => {
    row.remove();
    if (!$("#urlRows").children.length) addUrlRow();
  });
  $("#urlRows").appendChild(row);
  inp.focus();
}

$("#btnAddUrl").addEventListener("click", () => addUrlRow());
$("#btnClearUrls").addEventListener("click", () => {
  $("#urlRows").innerHTML = "";
  addUrlRow();
});
$("#btnParse").addEventListener("click", async () => {
  const urls = $$("#urlRows .url-row input").map((i) => i.value.trim()).filter(Boolean);
  if (!urls.length) { setStatus("请先输入链接"); return; }
  // 分流：HuggingFace 链接走文件选择弹窗，其余走 civitai 解析
  const hfUrls = urls.filter((u) => /huggingface\.co/i.test(u));
  const cvUrls = urls.filter((u) => !/huggingface\.co/i.test(u));
  if (cvUrls.length) {
    const r = await api.call("parse_urls", cvUrls);
    if (r && r.started) {
      setStatus("解析中 0/" + cvUrls.length);
      pollParse();
    }
  }
  for (const u of hfUrls) {
    try {
      const res = JSON.parse((await api.call("hf_list_files", u)) || "{}");
      if (!res.ok) { setStatus("HF 解析失败: " + (res.msg || "")); continue; }
      showHfDialog(res);
    } catch (e) { setStatus("HF 解析失败: " + e); }
  }
});

// ===== HuggingFace 文件选择弹窗 =====
let hfCtx = null;
function showHfDialog(info) {
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.style.width = "560px";
  dlg.style.maxHeight = "80vh";
  dlg.style.overflow = "auto";
  const files = info.files || [];
  dlg.innerHTML =
    '<div class="rd-title">🤗 ' + esc(info.repo) + "（" + files.length + " 个文件）</div>" +
    '<div class="hf-list">' + files.slice(0, 300).map((f, i) =>
      '<label class="hf-item"><input type="checkbox" class="hf-cb" data-i="' + i + '" ' +
      (/\.(safetensors|ckpt|pt|pth|bin|onnx|gguf|sft)$/i.test(f.path) ? "checked" : "") + "/> " +
      '<span class="hf-path">' + esc(f.path) + "</span>" +
      '<span class="hf-size">' + (f.size ? fmtSize(f.size) : "") + "</span></label>"
    ).join("") + "</div>" +
    '<div class="rd-actions">' +
    '<button class="btn" id="hfAll">全选</button>' +
    '<button class="btn" id="hfNone">全不选</button>' +
    '<button class="btn btn-primary" id="hfOk">下载所选</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  hfCtx = info;
  $("#hfAll").addEventListener("click", () => document.querySelectorAll(".hf-cb").forEach((c) => { c.checked = true; }));
  $("#hfNone").addEventListener("click", () => document.querySelectorAll(".hf-cb").forEach((c) => { c.checked = false; }));
  $("#hfOk").addEventListener("click", async () => {
    const sel = [];
    document.querySelectorAll(".hf-cb:checked").forEach((c) => sel.push(files[Number(c.dataset.i)].path));
    const close = () => { mask.remove(); dlg.remove(); hfCtx = null; };
    close();
    if (!sel.length) { setStatus("未选择任何文件"); return; }
    const r = await api.call("hf_enqueue", info.repo, info.rev, sel);
    setStatus("已加入下载队列 " + (r && r.added ? r.added : 0) + " 个文件");
    dlRefresh();
  });
  mask.addEventListener("click", () => { mask.remove(); dlg.remove(); hfCtx = null; });
}

function pollParse() {
  const t = setInterval(async () => {
    const s = await api.call("get_parse_state");
    if (s && s.items) {
      const log = $("#parseLog");
      log.textContent = s.items.map((i) => (i.ok ? "[OK] " : "[失败] ") + (i.url || "") + " " + (i.msg || "")).join("\n");
      setStatus("解析中 " + s.done + "/" + s.total);
      if (s.finished || !s.running) {
        clearInterval(t);
        setStatus("解析完成，共加入 " + s.items.filter((i) => i.ok).length + " 个任务");
        dlRefresh();
      }
    }
  }, 800);
}

// ================= 下载管理 =================
async function dlRefresh() {
  try {
    const tasks = await api.call("get_tasks");
    state.dlTasks = tasks || [];
    const tbody = $("#dlTable tbody");
    const selPaths = new Set(Array.from(tbody.querySelectorAll("tr.sel-row")).map((tr) => tr.dataset.fn));
    tbody.innerHTML = state.dlTasks.map((t) => {
      const st = { pending: "等待中", downloading: "下载中", done: "已完成", paused: "已暂停", error: "失败", canceled: "已取消" }[t.status] || t.status;
      const prog = t.status === "downloading" ? t.progress.toFixed(1) + "%" : st;
      const speed = t.speed ? (t.speed / 1048576).toFixed(1) + " MB/s" : "";
      const size = t.total ? fmtSize(t.downloaded) + " / " + fmtSize(t.total) : fmtSize(t.downloaded);
      return '<tr data-fn="' + esc(t.filename) + '" class="' + (selPaths.has(t.filename) ? "sel-row" : "") + '">' +
        "<td class='c-file'>" + esc(t.filename) + "</td><td>" + esc(st) + "</td><td>" + esc(prog) + "</td>" +
        "<td>" + esc(speed) + "</td><td>" + esc(size) + "</td><td class='c-err'>" + esc(t.error || "") + "</td></tr>";
    }).join("");
  } catch (e) { /* 未就绪 */ }
}

$("#dlTable tbody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) tr.classList.toggle("sel-row");
  else {
    $$("#dlTable tbody tr").forEach((r) => r.classList.remove("sel-row"));
    tr.classList.add("sel-row");
  }
});

function dlSel() {
  return Array.from($$("#dlTable tbody tr.sel-row")).map((r) => r.dataset.fn);
}

async function dlAct(action) {
  await api.call("dl_action", action, action === "start_all" || action === "clear_done" || action === "save" ? null : dlSel());
  dlRefresh();
}
$("#dlStartAll").addEventListener("click", () => dlAct("start_all"));
$("#dlPauseSel").addEventListener("click", () => dlAct("pause"));
$("#dlRetrySel").addEventListener("click", () => dlAct("retry"));
$("#dlRemoveSel").addEventListener("click", () => dlAct("remove"));
$("#dlClearDone").addEventListener("click", () => dlAct("clear_done"));
$("#dlSave").addEventListener("click", () => dlAct("save"));

// ================= 模型管理 =================
function mmScanIfNeeded() {
  if (!state.models.length && !$("#mmScan").disabled) mmScan();
}

async function mmScan() {
  if (!window.__ready) { setStatus("初始化中，请稍候 ..."); await new Promise((r) => setTimeout(r, 600)); return mmScan(); }
  setStatus("正在扫描 ...");
  // fire-and-forget + 独立轮询：不依赖 js_api Promise 完成来启动轮询
  api.call("scan_models").catch(() => {});
  pollMmScan();
}

function pollMmScan() {
  const t = setInterval(async () => {
    const s = await api.call("get_scan_state");
    if (s && !s.running) {
      clearInterval(t);
      try {
        state.models = JSON.parse((await api.call("get_scan_rows")) || "[]");
      } catch (e) {
        state.models = [];
        setStatus("行数据解析失败: " + e);
      }
      state.display = state.models.slice();
      state.mmChecked.clear();
      state.mmSort = { col: null, rev: false };
      renderMm();
      setStatus(s.msg || "扫描完成：" + state.models.length + " 个模型");
      $("#mmCount").textContent = state.models.length + " 个";
    } else if (s && s.msg) setStatus(s.msg);
  }, 700);
}

function renderMm() {
  const rows = state.display.slice();
  if (state.mmSort.col) {
    const c = state.mmSort.col;
    rows.sort((a, b) => {
      let x, y;
      if (c === "size") { x = a.size || 0; y = b.size || 0; }
      else if (c === "mtime") { x = a.mtime || 0; y = b.mtime || 0; }
      else if (c === "name") { x = a.name.toLowerCase(); y = b.name.toLowerCase(); }
      else { x = String(a[c] || "").toLowerCase(); y = String(b[c] || "").toLowerCase(); }
      return x < y ? -1 : x > y ? 1 : 0;
    });
    if (state.mmSort.rev) rows.reverse();
  }
  if (state.mmView === "masonry") {
    renderMasonry(rows);
    return;
  }
  // 切回列表时恢复容器显示
  $("#mmTableWrap").style.display = "block";
  $("#mmMasonry").style.display = "none";
  const root = (state.cfg && state.cfg.models_dir) || "";
  const tbody = $("#mmTable tbody");
  tbody.innerHTML = rows.map((r, i) => {
    const rel = root ? r.path.replace(root.replace(/\\/g, "/"), "").replace(/^\//, "") : r.path;
    return '<tr data-idx="' + i + '" data-path="' + esc(r.path) + '" class="' + (state.mmSel.has(r.path) ? "sel-row" : "") + '">' +
      '<td class="cell-sel">' + (state.mmChecked.has(r.path) ? "☑" : "☐") + "</td>" +
      '<td class="c-thumb"><img data-idx="' + i + '" class="thumb" alt=""/></td>' +
      "<td class='c-name'>" + esc(r.name) + "</td>" +
      "<td class='c-name'>" + esc(r.civitai_name || "-") + "</td>" +
      "<td>" + esc(r.type || "-") + "</td><td>" + esc(r.base || "-") + "</td>" +
      "<td class='c-ver'>" + esc(r.ver || "-") + "</td>" +
      "<td>" + esc(r.update || "-") + "</td><td>" + esc(r.hash || "-") + "</td>" +
      "<td>" + fmtSize(r.size) + "</td><td class='c-time'>" + fmtTime(r.mtime) + "</td>" +
      "<td class='c-path'>" + esc(short(rel, 30)) + "</td></tr>";
  }).join("");
  $("#mmCheckLabel").textContent = "已勾选 " + state.mmChecked.size + " 个";
  loadThumbs(0);
}

// 分批加载封面缩略图（每次 40 个，避免大传输卡顿）
async function loadThumbs(start) {
  const batch = state.display.slice(start, start + 40);
  if (!batch.length) return;
  try {
    const json = await api.call("get_covers", batch.map((r) => r.path));
    const covers = JSON.parse(json || "{}");
    for (const [p, b64] of Object.entries(covers)) {
      const idx = state.display.findIndex((r) => r.path === p);
      if (idx >= 0) {
        const img = document.querySelector('.thumb[data-idx="' + idx + '"]');
        if (img) img.src = "data:image/jpeg;base64," + b64;
      }
    }
  } catch (e) { /* 缩略图失败不影响列表 */ }
  loadThumbs(start + 40);
}

// ===== 瀑布流视图 =====
function renderMasonry(rows) {
  $("#mmTableWrap").style.display = "none";
  $("#mmMasonry").style.display = "block";
  $("#mmMasonry").innerHTML = rows.map((r, i) => {
    const checked = state.mmChecked.has(r.path) ? "checked" : "";
    return '<div class="ms-card' + (checked ? " checked" : "") + '" data-idx="' + i + '" data-path="' + esc(r.path) + '">' +
      '<div class="ms-img-wrap"><img class="ms-img" data-idx="' + i + '" alt=""/></div>' +
      '<div class="ms-name">' + esc(short(r.name, 26)) + "</div>" +
      '<div class="ms-meta">' + esc(r.type || "-") + (r.ver ? " · " + esc(short(r.ver, 18)) : "") + "</div>" +
      '<div class="ms-size">' + fmtSize(r.size) + "</div></div>";
  }).join("");
  $("#mmCheckLabel").textContent = "已勾选 " + state.mmChecked.size + " 个";
  loadMasonryThumbs(0);
}
async function loadMasonryThumbs(start) {
  const batch = state.display.slice(start, start + 40);
  if (!batch.length) return;
  try {
    const json = await api.call("get_covers", batch.map((r) => r.path), 320);
    const covers = JSON.parse(json || "{}");
    for (const [p, b64] of Object.entries(covers)) {
      const idx = state.display.findIndex((r) => r.path === p);
      if (idx >= 0) {
        const img = document.querySelector('.ms-img[data-idx="' + idx + '"]');
        if (img) img.src = "data:image/jpeg;base64," + b64;
      }
    }
  } catch (e) { /* 封面失败不影响 */ }
  loadMasonryThumbs(start + 40);
}
$("#mmViewToggle").addEventListener("click", () => {
  state.mmView = state.mmView === "masonry" ? "list" : "masonry";
  $("#mmViewToggle").textContent = state.mmView === "masonry" ? "📋 列表视图" : "🖼️ 瀑布流";
  renderMm();
});
// 瀑布流点击勾选 + 右键菜单
$("#mmMasonry").addEventListener("click", (e) => {
  const card = e.target.closest(".ms-card");
  if (!card) return;
  const r = state.display[Number(card.dataset.idx)];
  if (!r) return;
  if (state.mmChecked.has(r.path)) state.mmChecked.delete(r.path);
  else state.mmChecked.add(r.path);
  renderMasonry(state.display.slice());
});
$("#mmMasonry").addEventListener("contextmenu", (e) => {
  const card = e.target.closest(".ms-card");
  if (!card) return;
  e.preventDefault();
  ctxRow = state.display[Number(card.dataset.idx)];
  if (!ctxRow) return;
  const menu = $("#ctxMenu");
  const r = ctxRow;
  menu.innerHTML =
    '<div class="ctx-item" data-act="site">🌐 打开C站</div>' +
    '<div class="ctx-item" data-act="rename">✏️ 重命名</div>' +
    '<div class="ctx-item" data-act="rename_c">🏷️ 重命名C站名</div>' +
    '<div class="ctx-item" data-act="sdjson">📄 生成SD json</div>' +
    '<div class="ctx-item" data-act="localize">🀄 汉化文件名</div>' +
    '<div class="ctx-item" data-act="rp">📤 发送到反向解析</div>' +
    '<div class="ctx-item" data-act="organize">📂 整理模型</div>' +
    '<hr class="ctx-sep"/>' +
    '<div class="ctx-item danger" data-act="del">🗑️ 删除文件</div>';
  menu.style.display = "block";
  const mw = 200, mh = 280;
  menu.style.left = Math.min(e.clientX, window.innerWidth - mw) + "px";
  menu.style.top = Math.min(e.clientY, window.innerHeight - mh) + "px";
});

// 勾选（☑ 列）：shift 范围多选
$("#mmTable tbody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const path = tr.dataset.path;
  const idx = Number(tr.dataset.idx);
  const isCheck = e.target.classList.contains("cell-sel");
  if (isCheck) {
    let targets = [path];
    if (e.shiftKey && state.mmLastSel >= 0) {
      const a = Math.min(state.mmLastSel, idx), b = Math.max(state.mmLastSel, idx);
      targets = state.display.slice(a, b + 1).map((r) => r.path);
    }
    const allChecked = targets.every((p) => state.mmChecked.has(p));
    targets.forEach((p) => allChecked ? state.mmChecked.delete(p) : state.mmChecked.add(p));
    state.mmLastSel = idx;
    renderMm();
    return;
  }
  // 行选择（ctrl 加选）
  if (e.ctrlKey || e.metaKey) {
    state.mmSel.has(path) ? state.mmSel.delete(path) : state.mmSel.add(path);
  } else {
    state.mmSel = new Set([path]);
  }
  renderMm();
});

// 筛选
let mmFilterTimer = null;
$("#mmFilter").addEventListener("input", () => {
  clearTimeout(mmFilterTimer);
  mmFilterTimer = setTimeout(() => {
    const kw = $("#mmFilter").value.trim().toLowerCase();
    state.display = kw ? state.models.filter((r) =>
      (r.name || "").toLowerCase().includes(kw) ||
      (r.civitai_name || "").toLowerCase().includes(kw) ||
      (r.path || "").toLowerCase().includes(kw)) : state.models.slice();
    renderMm();
  }, 200);
});
$("#mmFilterClear").addEventListener("click", () => { $("#mmFilter").value = ""; state.display = state.models.slice(); renderMm(); });

// 排序（点击表头）
$$("#mmTable th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const c = th.dataset.sort;
    if (state.mmSort.col === c) state.mmSort.rev = !state.mmSort.rev;
    else state.mmSort = { col: c, rev: false };
    renderMm();
  });
});

function mmCheckedPaths() {
  const checked = state.models.filter((r) => state.mmChecked.has(r.path)).map((r) => r.path);
  const sel = Array.from(state.mmSel);
  return checked.length ? checked : (sel.length ? sel : null);
}

$("#mmSelAll").addEventListener("click", () => { state.display.forEach((r) => state.mmChecked.add(r.path)); renderMm(); });
$("#mmSelNone").addEventListener("click", () => { state.mmChecked.clear(); renderMm(); });
$("#mmSelInv").addEventListener("click", () => {
  state.display.forEach((r) => state.mmChecked.has(r.path) ? state.mmChecked.delete(r.path) : state.mmChecked.add(r.path));
  renderMm();
});

function mmOp(name, fn) {
  $("#" + name).addEventListener("click", async () => {
    const paths = mmCheckedPaths();
    if (name !== "mmScan" && !paths && !["mmScan"].includes(name)) { setStatus("请先勾选或选中模型"); return; }
    setStatus(name + " 开始 ...");
    // fire-and-forget + 独立轮询
    fn(paths).catch(() => {});
    pollMmProgress();
  });
}

// ===== 文件夹显示：竖排二级菜单 =====
let foldersState = null;
function fmTreeHtml(tree, hidden, depth) {
  return tree.map((n) => {
    const isHidden = hidden.has(n.path);
    const kids = n.children.length ? fmTreeHtml(n.children, hidden, depth + 1) : "";
    return '<div class="fm-item" data-path="' + esc(n.path) + '" style="padding-left:' + (12 + depth * 18) + 'px">' +
      '<span class="fm-icon">' + (isHidden ? "🙈" : "📁") + "</span>" +
      '<span class="fm-name">' + esc(n.name) + "</span>" +
      '<span class="fm-state ' + (isHidden ? "off" : "on") + '">' + (isHidden ? "隐藏" : "显示") + "</span></div>" + kids;
  }).join("");
}
function fmRender() {
  const panel = $("#mmFoldersPanel");
  if (!foldersState) return;
  const hidden = new Set(foldersState.hidden || []);
  const showRoot = foldersState.show_root;
  panel.innerHTML =
    '<div class="fm-title">📁 文件夹显示（点击条目切换）</div>' +
    '<div class="fm-item fm-top" data-path="__root__">' +
      '<span class="fm-icon">🗂️</span><span class="fm-name">根目录下的模型</span>' +
      '<span class="fm-state ' + (showRoot ? "on" : "off") + '">' + (showRoot ? "显示" : "隐藏") + "</span></div>" +
    '<hr class="fp-sep"/>' +
    fmTreeHtml(foldersState.tree || [], hidden, 0);
}
$("#mmFolders").addEventListener("click", async (e) => {
  e.stopPropagation();
  const panel = $("#mmFoldersPanel");
  if (panel && panel.classList.contains("open")) {
    panel.classList.remove("open");
    return;
  }
  const json = await api.call("get_folders");
  try {
    foldersState = JSON.parse(json || "{}");
  } catch (err) { foldersState = {}; }
  if (!foldersState || !foldersState.tree) { setStatus("请先配置模型管理目录"); return; }
  fmRender();
  panel.classList.add("open");
});
document.addEventListener("click", (e) => {
  const panel = $("#mmFoldersPanel");
  if (panel && panel.classList.contains("open") && !e.target.closest("#mmFoldersWrap")) {
    panel.classList.remove("open");
  }
});
$("#mmFoldersPanel").addEventListener("click", async (e) => {
  const item = e.target.closest(".fm-item");
  if (!item || !foldersState) return;
  const path = item.dataset.path;
  const hidden = new Set(foldersState.hidden || []);
  if (path === "__root__") {
    foldersState.show_root = !foldersState.show_root;
  } else {
    if (hidden.has(path)) hidden.delete(path); else hidden.add(path);
    foldersState.hidden = Array.from(hidden);
  }
  await api.call("save_folders", Array.from(hidden), foldersState.show_root);
  fmRender();
  setStatus("文件夹显示已保存");
  await api.call("scan_models");
  pollMmScan();
});

// ===== 右下角关于浮窗 =====
$("#aboutFloat").addEventListener("click", () => {
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.style.width = "460px";
  dlg.innerHTML =
    '<div class="about-head">' +
    '<img class="about-logo" src="bili_face.png" alt=""/>' +
    '<div><div class="about-name">CivitaiFreeTool <span class="about-ver">v1.3.0</span></div></div></div>' +
    '<div style="font-size:13px;color:var(--text);line-height:1.9;margin-top:12px">' +
    "Civitai / HuggingFace 模型下载、管理、反向解析工具（免费全功能）<br/>" +
    '<div style="color:var(--text-dim)">' +
    "· 批量下载（civitai.red / civitai.com / huggingface.co）<br/>" +
    "· 模型管理：扫描 / 校验 / 重命名 / 整理 / 封面 / 瀑布流<br/>" +
    "· 反向解析：SHA256 反查 + 百度翻译<br/>" +
    "· 断点续传 · 并发下载 · 主题 / 缩放 / 分类规则<br/>" +
    "界面字体：HarmonyOS Sans SC</div></div>" +
    '<div class="about-author">' +
    '<div class="rd-home" id="rdHome">👤 作者：爱德怀斯official —— 点击打开 B 站主页</div>' +
    '<div class="rd-group" id="rdGroup">🐧 粉丝群：909810278 —— 点击加入</div></div>' +
    '<div class="rd-actions"><button class="btn btn-primary" id="aboutOk">知道了</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  const close = () => { mask.remove(); dlg.remove(); };
  $("#aboutOk").addEventListener("click", close);
  mask.addEventListener("click", close);
  $("#rdHome").addEventListener("click", () => api.call("open_url", "https://space.bilibili.com/273101122"));
  $("#rdGroup").addEventListener("click", () => api.call("open_url", "https://qm.qq.com/q/EbnuVZB4wE"));
});

// ===== 模型管理右键菜单 =====
let ctxRow = null;
$("#mmTable tbody").addEventListener("contextmenu", (e) => {
  const tr = e.target.closest("tr[data-path]");
  if (!tr) return;
  e.preventDefault();
  ctxRow = state.display[Number(tr.dataset.idx)];
  if (!ctxRow) return;
  const menu = $("#ctxMenu");
  const r = ctxRow;
  menu.innerHTML =
    '<div class="ctx-item" data-act="site">🌐 打开C站</div>' +
    '<div class="ctx-item" data-act="rename">✏️ 重命名</div>' +
    '<div class="ctx-item" data-act="rename_c">🏷️ 重命名C站名</div>' +
    '<div class="ctx-item" data-act="sdjson">📄 生成SD json</div>' +
    '<div class="ctx-item" data-act="localize">🀄 汉化文件名</div>' +
    '<div class="ctx-item" data-act="rp">📤 发送到反向解析</div>' +
    '<div class="ctx-item" data-act="organize">📂 整理模型</div>' +
    '<hr class="ctx-sep"/>' +
    '<div class="ctx-item danger" data-act="del">🗑️ 删除文件</div>';
  menu.style.display = "block";
  // 定位（不超出视口）
  const mw = 200, mh = 280;
  menu.style.left = Math.min(e.clientX, window.innerWidth - mw) + "px";
  menu.style.top = Math.min(e.clientY, window.innerHeight - mh) + "px";
});
document.addEventListener("click", (e) => {
  const menu = $("#ctxMenu");
  if (menu.style.display !== "none" && !e.target.closest("#ctxMenu")) {
    menu.style.display = "none";
  }
});
$("#ctxMenu").addEventListener("click", async (e) => {
  const item = e.target.closest(".ctx-item");
  if (!item || !ctxRow) return;
  const act = item.dataset.act;
  $("#ctxMenu").style.display = "none";
  const path = ctxRow.path;
  try {
    if (act === "site") {
      const url = ctxRow.url || ("https://" + (state.cfg.site_domain || "civitai.red") + "/models/" + (ctxRow.modelId || ""));
      api.call("open_url", url);
    } else if (act === "rename") {
      showRenameDialog(path, ctxRow.name);
    } else if (act === "rename_c") {
      await api.call("mm_rename", [path]);
      setStatus("重命名完成，刷新中...");
      await api.call("scan_models");
      pollMmScan();
    } else if (act === "sdjson") {
      await api.call("mm_gen_json", [path], true);
      setStatus("SD json 已生成");
      await api.call("scan_models");
      pollMmScan();
    } else if (act === "localize") {
      await api.call("mm_localize", [path]);
      setStatus("汉化完成，刷新中...");
      await api.call("scan_models");
      pollMmScan();
    } else if (act === "rp") {
      await api.call("rp_add_paths", [path]);
      setStatus("已发送到反向解析");
      document.querySelector('.nav-tab[data-page="reverse"]').click();
    } else if (act === "organize") {
      await api.call("mm_organize", [path]);
      setStatus("整理完成，刷新中...");
      await api.call("scan_models");
      pollMmScan();
    } else if (act === "del") {
      if (!confirm("确定将「" + (ctxRow.name || path) + "」移入回收站？")) return;
      const res = await api.call("rm_file", path);
      setStatus(res && res.msg ? res.msg : "已删除");
      await api.call("scan_models");
      pollMmScan();
    }
  } catch (err) {
    setStatus("操作失败: " + err);
  }
});

// 重命名弹窗
function showRenameDialog(path, oldName) {
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  const oldBase = String(oldName || "").replace(/\.(safetensors|ckpt|pt|pth|bin|onnx|gguf|sft)$/i, "");
  dlg.innerHTML =
    '<div class="rd-title">✏️ 重命名（保留扩展名）</div>' +
    '<input class="input rd-input" id="rdInput" value="' + esc(oldBase) + '" placeholder="输入新文件名"/>' +
    '<div class="rd-actions">' +
    '<button class="btn" id="rdCancel">取消</button>' +
    '<button class="btn btn-primary" id="rdOk">确定</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  const inp = $("#rdInput");
  inp.focus();
  inp.select();
  const close = () => { mask.remove(); dlg.remove(); };
  $("#rdCancel").addEventListener("click", close);
  mask.addEventListener("click", close);
  $("#rdOk").addEventListener("click", async () => {
    const name = inp.value.trim();
    close();
    if (!name) return;
    const res = await api.call("rename_file", path, name);
    setStatus(res && res.msg ? res.msg : "重命名完成");
    await api.call("scan_models");
    pollMmScan();
  });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#rdOk").click(); });
}

function pollMmProgress() {
  const t = setInterval(async () => {
    const p = await api.call("get_mm_progress");
    if (p && p.running) {
      setStatus((p.msg || "处理中") + " " + p.done + "/" + p.total);
      $("#mmCount").textContent = "";
    } else if (p && !p.running && p.total > 0) {
      clearInterval(t);
      setStatus(p.msg || "完成");
      if (p.result && typeof p.result === "object" && !Array.isArray(p.result) && p.result.ok !== undefined) {
        setStatus(p.msg + "（成功 " + p.result.ok + "，跳过 " + (p.result.skip || 0) + "）");
      }
      await api.call("scan_models");
      pollMmScan();
    }
  }, 700);
}

mmOp("mmVerify", (p) => api.call("mm_verify", p));
mmOp("mmRename", (p) => api.call("mm_rename", p));
mmOp("mmLocalize", (p) => api.call("mm_localize", p));
mmOp("mmJson", (p) => api.call("mm_gen_json", p, true));
mmOp("mmCovers", (p) => api.call("mm_download_covers", p));
mmOp("mmTranslate", (p) => api.call("mm_translate_descs", p));
mmOp("mmOrganize", (p) => api.call("mm_organize", p));
mmOp("mmCleanup", (p) => api.call("mm_cleanup", p));
// 扫描走独立的 scan_state 轮询（不走 mm_progress）
$("#mmScan").addEventListener("click", () => mmScan());

$("#mmUpdate").addEventListener("click", async () => {
  const p = mmCheckedPaths();
  if (!p) { setStatus("请先勾选或选中模型"); return; }
  setStatus("检查更新开始 ...");
  await api.call("mm_check_update", p);
  pollMmProgress();
});
$("#mmSite").addEventListener("click", async () => {
  const p = mmCheckedPaths();
  if (!p || !p.length) { setStatus("请先选中模型"); return; }
  await api.call("mm_open_site", p[0]);
});
$("#mmSendRp").addEventListener("click", async () => {
  const p = mmCheckedPaths();
  if (!p) { setStatus("请先勾选或选中模型"); return; }
  await api.call("rp_add_paths", p);
  setStatus("已发送 " + p.length + " 个到反向解析");
});

// 详情：点击行显示 info
$("#mmTable tbody").addEventListener("dblclick", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const r = state.models.find((m) => m.path === tr.dataset.path);
  if (!r) return;
  $("#mmDetail").textContent = "文件: " + r.path + "\n类型: " + (r.type || "-") + "  基础模型: " + (r.base || "-") + "  版本: " + (r.ver || "-") +
    "\n触发词: " + ((r.trainedWords || []).join("，") || "-") + "\nC站链接: " + (r.url || "-");
});

// ================= 反向解析 =================
async function rpRefresh() {
  const rows = await api.call("rp_get_rows");
  state.rpRows = rows || [];
  const kw = $("#rpFilter").value.trim().toLowerCase();
  const tbody = $("#rpTable tbody");
  tbody.innerHTML = rows.filter((r) => !kw ||
    r.path.toLowerCase().includes(kw) || (r.model || "").toLowerCase().includes(kw) || (r.status || "").toLowerCase().includes(kw))
    .map((r) =>
      '<tr data-path="' + esc(r.path) + '">' +
      "<td class='c-file'>" + esc(r.path) + "</td><td class='c-sha'>" + esc(r.sha || "") + "</td>" +
      "<td>" + esc(r.status) + "</td><td class='c-name'>" + esc(r.model || "") + "</td><td>" + esc(r.version || "") + "</td></tr>").join("");
}

$("#rpFilter").addEventListener("input", rpRefresh);
$("#rpFilterClear").addEventListener("click", () => { $("#rpFilter").value = ""; rpRefresh(); });

$("#rpAddFiles").addEventListener("click", async () => {
  const files = await api.call("pick_files");
  if (files && files.length) { await api.call("rp_add_paths", files); rpRefresh(); }
});
$("#rpAddDir").addEventListener("click", async () => {
  const d = await api.call("pick_dir");
  if (d) { await api.call("rp_add_dir", d); rpRefresh(); }
});
$("#rpRemoveSel").addEventListener("click", async () => {
  const paths = Array.from($$("#rpTable tbody tr.sel-row")).map((r) => r.dataset.path);
  if (paths.length) { await api.call("rp_remove", paths); rpRefresh(); }
});
$("#rpTable tbody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) tr.classList.toggle("sel-row");
  else { $$("#rpTable tbody tr").forEach((r) => r.classList.remove("sel-row")); tr.classList.add("sel-row"); }
});
$("#rpStart").addEventListener("click", async () => {
  await api.call("rp_start");
  $("#rpStart").disabled = true;
  $("#rpPause").disabled = false;
  $("#rpStop").disabled = false;
  pollRp();
});
$("#rpPause").addEventListener("click", async () => {
  const paused = await api.call("rp_pause");
  $("#rpPause").textContent = paused ? "继续" : "暂停";
});
$("#rpStop").addEventListener("click", async () => {
  await api.call("rp_stop");
  $("#rpPause").disabled = true;
  $("#rpStop").disabled = true;
});

function pollRp() {
  const t = setInterval(async () => {
    const s = await api.call("rp_state");
    rpRefresh();
    if (s && s.running) setStatus("反向解析 " + s.done + "/" + s.total + (s.paused ? "（已暂停）" : ""));
    else if (s && !s.running && s.total > 0) {
      clearInterval(t);
      $("#rpStart").disabled = false;
      $("#rpPause").disabled = true;
      $("#rpStop").disabled = true;
      $("#rpPause").textContent = "暂停";
      setStatus("反向解析完成");
    }
  }, 800);
}

// ================= 设置 =================
// [分组, key, 标签, 类型, 选项]
const SETTING_FIELDS = [
  ["🔑 基本", "api_key", "Civitai API Key", "password"],
  ["🔑 基本", "download_dir", "下载目录", "text"],
  ["🔑 基本", "models_dir", "模型管理目录", "text"],
  ["🔑 基本", "site_domain", "站点域名", "select", ["civitai.red", "civitai.com"]],
  ["🌐 网络", "proxy_enabled", "启用代理", "bool"],
  ["🌐 网络", "proxy_address", "代理地址", "text"],
  ["🌐 网络", "max_concurrent_downloads", "并发下载数", "number"],
  ["🌐 网络", "download_timeout", "下载超时(秒)", "number"],
  ["🌐 网络", "hash_threads", "哈希线程数", "number"],
  ["🌏 翻译", "baidu_appid", "百度翻译 APP ID", "text"],
  ["🌏 翻译", "baidu_key", "百度翻译密钥", "password"],
  ["🌏 翻译", "auto_translate", "反向解析自动翻译", "bool"],
  ["🌏 翻译", "translate_filename", "下载文件名为中文", "bool"],
  ["🎨 界面", "theme", "界面主题", "select", ["dark", "light", "modern"]],
  ["🎨 界面", "ui_zoom", "界面缩放", "select", ["80", "90", "100", "110", "125", "150"]],
  ["🎨 界面", "zebra_rows", "模型列表斑马纹", "bool"],
  ["🎨 界面", "ambient_bg", "顶部氛围动态背景", "bool"],
];

// 百度翻译申请链接（desc 备注已说明性质，无需 [official]/【中文】前缀）
const BAIDU_LINKS = [
  { label: "百度翻译开放平台", url: "https://fanyi-api.baidu.com/product/11", desc: "官方申请入口（免费额度）" },
  { label: "申请教程 by TTime", url: "https://ttime.v1.timerecord.cn/pages/4596af/", desc: "图文教程" },
  { label: "申请教程 by BobTranslate", url: "https://bobtranslate.com/service/translate/baidu.html", desc: "图文教程" },
];

function buildSettingsForm() {
  const form = $("#settingsForm");
  const groups = {};
  for (const f of SETTING_FIELDS) {
    const g = f[0];
    if (!groups[g]) groups[g] = [];
    groups[g].push(f.slice(1));
  }
  form.innerHTML = Object.entries(groups).map(([g, fields]) => {
    const body = fields.map(([key, label, type, opts]) => {
      const v = state.cfg[key];
      let input = "";
      if (type === "bool") {
        input = '<label class="check"><input type="checkbox" data-key="' + key + '" ' + (v ? "checked" : "") + "/> " + esc(label) + "</label>";
      } else if (type === "select") {
        input = '<select data-key="' + key + '">' + opts.map((o) => '<option value="' + esc(o) + '" ' + (String(v) === o ? "selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>";
      } else if (type === "number") {
        input = '<input class="input" type="number" data-key="' + key + '" value="' + esc(v) + '"/>';
      } else if (type === "password") {
        input = '<input class="input" type="password" data-key="' + key + '" value="' + esc(v || "") + '"/>';
      } else {
        input = '<input class="input" data-key="' + key + '" value="' + esc(v || "") + '"/>';
      }
      if (type === "bool") return '<div class="form-item">' + input + "</div>";
      return '<label>' + esc(label) + "</label><div>" + input + "</div>";
    }).join("");
    // 翻译组追加百度申请链接
    let extra = "";
    if (g.indexOf("翻译") >= 0) {
      extra = '<div class="bd-links"><div class="bd-links-title">📚 百度翻译 API 申请指南：</div>' +
        BAIDU_LINKS.map((l) =>
          '<div class="bd-link" data-url="' + esc(l.url) + '"><span class="bd-link-label">' + esc(l.label) + "</span><span class=\"bd-link-desc\">" + esc(l.desc) + "</span></div>"
        ).join("") + "</div>";
    }
    return '<fieldset class="form-section"><legend>' + esc(g) + "</legend><div class=\"form-grid\">" + body + "</div>" + extra + "</fieldset>";
  }).join("");
  // 分类规则组
  form.innerHTML += '<fieldset class="form-section"><legend>📂 分类规则（关键词 -> 文件夹，每行一条）</legend><div class="form-grid"><label>整理分类规则</label><div><textarea class="rules" id="organizeRules">' + esc((state.cfg.organize_rules || []).map((r) => (r.keywords || []).join(", ") + " -> " + r.folder).join("\n")) + "</textarea></div></div></fieldset>";
}

// 百度链接点击
$("#settingsForm").addEventListener("click", (e) => {
  const link = e.target.closest(".bd-link");
  if (link) api.call("open_url", link.dataset.url);
});

$("#btnSaveSettings").addEventListener("click", async () => {
  const cfg = {};
  Object.assign(cfg, state.cfg);
  $$("#settingsForm [data-key]").forEach((el) => {
    const k = el.dataset.key;
    if (el.type === "checkbox") cfg[k] = el.checked;
    else if (el.type === "number") cfg[k] = Number(el.value);
    else cfg[k] = el.value;
  });
  cfg.organize_rules = $("#organizeRules").value.split("\n").map((l) => {
    const m = l.match(/^\s*(.+?)\s*(?:->|=>|→)\s*(.+?)\s*$/);
    return m ? { keywords: m[1].split(",").map((s) => s.trim()).filter(Boolean), folder: m[2].trim() } : null;
  }).filter(Boolean);
  await api.call("save_config", cfg);
  state.cfg = await api.call("get_config");
  setStatus("设置已保存");
  window.location.reload();
});

$("#btnTestApi").addEventListener("click", async () => {
  const r = await api.call("test_api");
  alert(r.ok ? r.msg : r.msg);
  setStatus(r.ok ? "API 正常" : "API 失败");
});
$("#btnTestBaidu").addEventListener("click", async () => {
  const r = await api.call("test_baidu");
  alert(r.ok ? r.msg : r.msg);
});
$("#btnOnboarding").addEventListener("click", () => showOnboarding());

// ================= 启动 =================
async function init() {
  state.cfg = await api.call("get_config");
  window.__ready = true;
  // 应用主题（dark / light / modern）
  const theme = state.cfg.theme || "modern";
  document.documentElement.dataset.theme = theme;
  // 界面缩放
  applyZoom(Number(state.cfg.ui_zoom) || 100);
  buildSettingsForm();
  addUrlRow();
  dlRefresh();
  setInterval(dlRefresh, 1000);
  setInterval(rpRefresh, 2000);
  setStatus("就绪");
  // 首次使用引导（未配置 API key 时自动弹出）
  if (!state.cfg.api_key) {
    showOnboarding();
  }
}

// ===== 首次使用引导（主题 / 下载目录 / API key） =====
const OB_STEPS = ["🌗 主题", "📂 下载目录", "🔑 API Key"];
let obStep = 0;
let obTheme = "dark";
let obDirVal = "";   // 跨步骤保存（输入框只在对应步骤渲染）
let obKeyVal = "";
function showOnboarding() {
  obStep = 0;
  obTheme = state.cfg.theme || "dark";
  obDirVal = state.cfg.download_dir || "";
  obKeyVal = state.cfg.api_key || "";
  $("#obMask").style.display = "flex";
  renderOnboarding();
}
function renderOnboarding() {
  $("#obSteps").innerHTML = OB_STEPS.map((s, i) =>
    '<div class="ob-step ' + (i === obStep ? "active" : i < obStep ? "done" : "") + '">' + s + "</div>").join("");
  $("#obPrev").style.display = obStep === 0 ? "none" : "inline-block";
  $("#obNext").textContent = obStep === OB_STEPS.length - 1 ? "完成 🎉" : "下一步";
  const body = $("#obBody");
  if (obStep === 0) {
    body.innerHTML =
      '<div class="ob-label">选择界面主题（可随时在设置页更换）</div>' +
      '<div class="ob-themes" id="obThemes">' +
      '<div class="ob-theme" data-t="dark"><div class="sw" style="background:#171221"></div>🌙 深色</div>' +
      '<div class="ob-theme" data-t="light"><div class="sw" style="background:#f2f2f2;border:1px solid #ddd"></div>☀️ 浅色</div>' +
      '<div class="ob-theme" data-t="modern"><div class="sw" style="background:#efefef;border:1px solid #ddd"></div>🎨 现代浅色</div></div>';
    document.querySelectorAll("#obThemes .ob-theme").forEach((el) => {
      if (el.dataset.t === obTheme) el.classList.add("sel");
      el.addEventListener("click", () => {
        obTheme = el.dataset.t;
        document.documentElement.dataset.theme = obTheme;
        document.querySelectorAll("#obThemes .ob-theme").forEach((x) => x.classList.remove("sel"));
        el.classList.add("sel");
      });
    });
  } else if (obStep === 1) {
    body.innerHTML =
      '<div class="ob-label">下载目录（模型下载后存放位置，可修改）</div>' +
      '<div style="display:flex;gap:8px"><input class="input" id="obDir" style="flex:1" value="' + esc(obDirVal) + '"/>' +
      '<button class="btn" id="obBrowse">📁 浏览</button></div>' +
      '<div style="color:var(--text-dim);font-size:12px;margin-top:6px">默认：软件根目录下的 downloads/models 文件夹</div>';
    $("#obDir").addEventListener("input", () => { obDirVal = $("#obDir").value; });
    $("#obBrowse").addEventListener("click", async () => {
      const picked = await api.call("pick_dir");
      if (picked) { obDirVal = picked; $("#obDir").value = picked; }
    });
  } else {
    body.innerHTML =
      '<div class="ob-label">Civitai API Key（免费申请，用于查询模型信息与下载）</div>' +
      '<input class="input" id="obKey" type="password" value="' + esc(obKeyVal) + '" placeholder="粘贴你的 API Key"/>' +
      '<div class="ob-guide" id="obGuide" style="display:none">' +
      '<div style="font-weight:600;margin-bottom:6px">📚 如何注册 API Key：</div>' +
      '<div>1. 打开 <a class="ob-link" id="obApiPage">civitai.com/settings/api</a>（或点击下方按钮）</div>' +
      '<div>2. 登录账号后点击「New API Key」生成</div>' +
      '<div>3. 复制生成的 Key 粘贴到上方输入框即可</div></div>' +
      '<div class="ob-actions2"><button class="btn" id="obToggleGuide">📚 如何注册 API？</button>' +
      '<button class="btn" id="obOpenApi">🌐 打开注册页</button></div>' +
      '<div style="color:var(--text-dim);font-size:12px;margin-top:6px">不填也能用，但模型查询与部分下载功能受限。</div>';
    $("#obKey").addEventListener("input", () => { obKeyVal = $("#obKey").value; });
    $("#obToggleGuide").addEventListener("click", () => {
      const g = $("#obGuide");
      g.style.display = g.style.display === "none" ? "block" : "none";
    });
    $("#obOpenApi").addEventListener("click", () => api.call("open_url", "https://civitai.com/settings/api"));
    $("#obApiPage").addEventListener("click", () => api.call("open_url", "https://civitai.com/settings/api"));
  }
}
$("#obNext").addEventListener("click", async () => {
  if (obStep === 0) {
    obStep = 1;
  } else if (obStep === 1) {
    obStep = 2;
  } else {
    // 完成：保存配置（obDirVal/obKeyVal 跨步骤保存，输入框已不在 DOM）
    state.cfg.api_key = (obKeyVal || "").trim();
    state.cfg.download_dir = (obDirVal || state.cfg.download_dir || "").trim();
    state.cfg.theme = obTheme;
    document.documentElement.dataset.theme = obTheme;
    await api.call("save_config", state.cfg);
    state.cfg = await api.call("get_config");
    $("#obMask").style.display = "none";
    setStatus("设置完成，欢迎使用！");
    return;
  }
  renderOnboarding();
});
$("#obPrev").addEventListener("click", () => { obStep--; renderOnboarding(); });

window.addEventListener("pywebviewready", init);
if (window.pywebview) init();
// 就绪守卫：init 未完成前禁止依赖 js_api 的操作（首次桥接可能慢）
window.__ready = false;
