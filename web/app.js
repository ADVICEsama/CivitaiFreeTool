/* CivitaiFreeTool 前端逻辑（完整版） */
"use strict";

// ---------- js_api 封装 ----------
// ============ 浏览器模式适配（A/C 方案）：把 window.pywebview.api 映射到本地 HTTP RPC ============
// 后端 browser_bridge 提供 /api/rpc 与界面文件服务；pywebview 窗口模式下这段不生效
// （那时 window.pywebview 已由 pywebview 注入）。界面出问题不会拖死下载任务——
// 页面只是"显示器"，后端（exe）独立常驻。
(function () {
  if (window.pywebview && window.pywebview.api) return;
  if (!(location.protocol === "http:" || location.protocol === "https:")) return;
  window.__browserMode = true;
  window.pywebview = {
    api: new Proxy({}, {
      get: function (_t, name) {
        if (typeof name !== "string") return undefined;
        return async function () {
          const args = Array.prototype.slice.call(arguments);
          const res = await fetch("/api/rpc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: name, args: args }),
          });
          const data = await res.json().catch(function () { return {}; });
          if (data && data.error) throw new Error(data.error);
          return data ? data.result : null;
        };
      },
    }),
  };
  // 心跳：让后端知道页面还在（设置里的「关页面后自动退出」依赖它）
  setInterval(function () { fetch("/api/heartbeat").catch(function () {}); }, 2000);
})();

// 前端错误也写进后端日志（error.log），出问题时可以查
window.addEventListener("error", (e) => {
  try { api.call("log_ui_error", String(e.message || e.error || "?"), String(e.filename || ""), String(e.lineno || ""), String((e.error && e.error.stack) || "")); } catch (err) { /* 忽略 */ }
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason || {};
  try { api.call("log_ui_error", "未处理的 Promise 拒绝: " + String(r.message || r), "", "", String(r.stack || "")); } catch (err) { /* 忽略 */ }
});

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

// 醒目 toast 提示（底部悬浮，2.6s 自动消失）——用于右键等快捷操作的反馈
let toastTimer = null;
function showToast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = "block";
  requestAnimationFrame(() => { t.style.opacity = "1"; });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.style.opacity = "0";
    setTimeout(() => { t.style.display = "none"; }, 300);
  }, 2600);
}

function confirmBox(msg) {
  // 自定义确认弹窗（原生 confirm 显示地址栏太丑）
  return new Promise((resolve) => {
    const mask = document.createElement("div");
    mask.className = "rd-mask";
    const dlg = document.createElement("div");
    dlg.className = "rename-dialog";
    dlg.style.width = "420px";
    dlg.innerHTML =
      '<div class="rd-title">确认操作</div>' +
      '<div style="font-size:13px;color:var(--text);line-height:1.7;word-break:break-all">' + esc(msg) + "</div>" +
      '<div class="rd-actions">' +
      ((state.cfg && state.cfg.confirm_buttons_flip)
        ? '<button class="btn" id="cfCancel">取消</button><button class="btn btn-danger" id="cfOk">确定</button>'
        : '<button class="btn btn-danger" id="cfOk">确定</button><button class="btn" id="cfCancel">取消</button>') +
      "</div>";
    document.body.appendChild(mask);
    document.body.appendChild(dlg);
    const close = () => { mask.remove(); dlg.remove(); };
    $("#cfCancel", dlg).addEventListener("click", () => { close(); resolve(false); });
    mask.addEventListener("click", () => { close(); resolve(false); });
    $("#cfOk", dlg).addEventListener("click", () => { close(); resolve(true); });
  });
}

// 与 confirmBox 相同，但**不转义**（传已拼好的富文本；会 resolve {ok:true, root} 便于往里面塞缩略图）
function confirmBoxRaw(html, title) {
  return new Promise((resolve) => {
    const mask = document.createElement("div");
    mask.className = "rd-mask";
    const dlg = document.createElement("div");
    dlg.className = "rename-dialog";
    dlg.style.width = "560px";
    dlg.innerHTML =
      '<div class="rd-title">' + (title || "确认操作") + "</div>" +
      '<div style="font-size:13px;color:var(--text);line-height:1.7">' + html + "</div>" +
      '<div class="rd-actions">' +
      ((state.cfg && state.cfg.confirm_buttons_flip)
        ? '<button class="btn" id="cfCancel">取消</button><button class="btn btn-danger" id="cfOk">确定</button>'
        : '<button class="btn btn-danger" id="cfOk">确定</button><button class="btn" id="cfCancel">取消</button>') +
      "</div>";
    document.body.appendChild(mask);
    document.body.appendChild(dlg);
    const close = () => { mask.remove(); dlg.remove(); };
    $("#cfCancel", dlg).addEventListener("click", () => { close(); resolve(false); });
    mask.addEventListener("click", () => { close(); resolve(false); });
    $("#cfOk", dlg).addEventListener("click", () => { mask.remove(); resolve({ ok: true, root: dlg }); });
  });
}

// 批量把封面塞进某个容器里的 img.dd-thumb（查重/确认弹窗用；失败静默）
async function loadDdThumbs(rootEl, paths, size) {
  try {
    const list = (paths || []).filter(Boolean);
    if (!list.length) return;
    const json = await api.call("get_covers", list, size || 96);
    const covers = JSON.parse(json || "{}");
    rootEl.querySelectorAll("img.dd-thumb").forEach((img) => {
      const b64 = covers[img.dataset.path];
      if (b64) img.src = "data:image/jpeg;base64," + b64;
    });
  } catch (e) { /* 缩略图失败不影响功能 */ }
}

// 复制到剪贴板（走后端 Win32；WebView2 file:// 下 navigator.clipboard 不可用）
window.__copyText = async function (t) {
  try { await api.call("copy_text", String(t == null ? "" : t)); return true; }
  catch (e) { return false; }
};

// 报错一键复制：点下载管理里标了 .err-copy 的报错单元格、或点批量下载的解析日志区，直接复制去搜
document.addEventListener("click", function (e) {
  let txt = "";
  const cell = e.target && e.target.closest ? e.target.closest("td.err-copy") : null;
  if (cell) {
    txt = (cell.textContent || "").trim();
  } else if (e.target && e.target.id === "parseLog") {
    txt = (e.target.textContent || "").trim();
  } else {
    return;
  }
  if (!txt) return;
  window.__copyText(txt).then(function (ok) {
    setStatus(ok ? "已复制报错到剪贴板，可直接搜索" : "复制失败（可手动选中复制）");
  });
});

// ---------- 状态 ----------
const state = {
  cfg: null,
  models: [],
  display: [],
  mmChecked: new Set(),
  mmSel: new Set(),
  mmSort: { col: "name", rev: false },
  mmBaseF: "", mmStF: "", mmFolderF: "",   // Metro 筛选：底模 / 更新状态 / 所在文件夹
  mmUpdOnly: false,          // 只看有更新的模型（更新检测筛选）
  mmUpdItems: null,          // 更新检测结果（path → 记录），「更新」页面用
  mmUpdCheckedAt: 0,
  updSel: new Set(),         //「更新」页面勾选的文件
  updPick: {},               //「更新」页面每行下拉选中的目标版本 {path: versionId}
  updQ: "", updBase: "", updState: "", updSortKey: "date",
  updPer: 50, updPage: 1,
  updSortRev: true,          // 表头排序方向（点击切换）
  updCtxPath: "",            //「更新」页面右键/··· 的目标
  updBatchBusy: false,       // 批量更新进行中（防重复点击）
  mmLastSel: -1,
  mmView: "list",
  rpRunning: false,
  dlTimer: null,
  dlTasks: [],
  dlThumbs: {},   // 下载管理列表缩略图缓存（filename → base64）
};

// ---------- 页面切换 ----------
function switchPage(name) {
  $$(".nav-tab").forEach((t) => t.classList.toggle("active", t.dataset.page === name));
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + name));
  if (name === "models") mmScanIfNeeded();
  if (name === "download") refreshDlTarget();
  if (name === "updates") renderUpdatesPage();
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
$("#btnPaste").addEventListener("click", async () => {
  const txt = await api.call("get_clipboard");
  const lines = String(txt || "").split(/[\r\n]+/).map((x) => x.trim()).filter((x) => x.startsWith("http"));
  if (!lines.length) { setStatus("剪贴板中没有链接"); return; }
  addUrlRow();
  const last = document.querySelector("#urlRows .url-row:last-child input");
  if (last) last.value = lines[0];
  for (let i = 1; i < lines.length; i++) addUrlRow(lines[i]);
  setStatus("已从剪贴板粘贴 " + lines.length + " 条链接");
});
$("#btnTodo").addEventListener("click", () => openTodoDialog());
function openTodoDialog() {
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.style.width = "520px";
  dlg.innerHTML =
    '<div class="rd-title">到期提醒清单（到期打开软件时提醒）</div>' +
    '<div class="form-grid" style="grid-template-columns:90px 1fr">' +
    '<label>链接</label><input class="input" id="tdUrl" placeholder="https://civitai.red/models/..." />' +
    "</div>" +
    '<div style="font-size:12px;color:var(--text-dim);margin:4px 0 6px 90px">时间自动选择：Early Access 模型按其免费到期时间提醒；其他模型默认 7 天后提醒</div>' +
    '<div class="rd-actions"><button class="btn btn-primary" id="tdAdd">添加</button></div>' +
    '<div style="font-size:13px;font-weight:600;margin:10px 0 6px">清单：</div>' +
    '<div id="tdList" style="max-height:200px;overflow:auto;font-size:12px;line-height:1.9"></div>' +
    '<div class="rd-actions"><button class="btn" id="tdClose">关闭</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  const close = () => { mask.remove(); dlg.remove(); };
  mask.addEventListener("click", close);
  $("#tdClose").addEventListener("click", close);
  $("#tdAdd").addEventListener("click", async () => {
    const url = $("#tdUrl").value.trim();
    if (!url) { setStatus("请输入链接"); return; }
    setStatus("检测到期时间 …");
    const res = await api.call("todo_add", url);
    setStatus(res && res.msg ? res.msg : "已添加");
    $("#tdUrl").value = "";
    renderTodoList();
  });
  async function renderTodoList() {
    const r = await api.call("todo_list");
    const box = $("#tdList");
    if (!r || !r.todos || !r.todos.length) { box.innerHTML = "（空）"; return; }
    box.innerHTML = r.todos.map((t) =>
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(t.url) + '">' + esc(t.label || t.url) + "</span>" +
      (t.due ? '<span style="color:var(--danger)">已到期</span>' : "<span>" + t.remain_days + " 天后</span>") +
      '<button class="btn btn-tiny" data-dl="' + esc(t.url) + '" title="立即解析并下载这个模型">下载</button>' +
      '<button class="btn btn-tiny" data-del="' + esc(t.url) + '" title="从清单移除"></button></div>').join("");
    box.querySelectorAll("button[data-dl]").forEach((b) => b.addEventListener("click", async () => {
      setStatus("正在解析并加入下载队列 …");
      const res = await api.call("todo_download", b.dataset.dl);
      setStatus(res && res.msg ? res.msg : "已开始下载");
      renderTodoList();
    }));
    box.querySelectorAll("button[data-del]").forEach((b) => b.addEventListener("click", async () => {
      await api.call("todo_remove", b.dataset.del);
      renderTodoList();
    }));
  }
  renderTodoList();
}
// 启动时检查到期待办：直接给「一键下载 / 全部下载」，不用再自己去翻链接
(async function checkTodoDue() {
  try {
    const r = await api.call("todo_due");
    if (!r || !r.due || !r.due.length) return;
    const mask = document.createElement("div");
    mask.className = "rd-mask";
    const dlg = document.createElement("div");
    dlg.className = "rename-dialog";
    dlg.style.width = "470px";
    const rows = r.due.map((t) =>
      '<div style="display:flex;gap:8px;align-items:center;margin:5px 0">' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px" title="' + esc(t.url) + '">' + esc(t.label || t.url) + "</span>" +
      '<button class="btn btn-tiny td-dl" data-url="' + esc(t.url) + '">一键下载</button></div>').join("");
    dlg.innerHTML =
      '<div style="font-size:15px;font-weight:600;margin-bottom:6px">到期待办：可以下载了</div>' +
      '<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">这些模型已到免费/可下载时间（下载成功后会自动从清单里移除）：</div>' +
      '<div style="max-height:240px;overflow:auto">' + rows + "</div>" +
      '<div class="rd-actions"><button class="btn btn-primary" id="tdAll">全部下载</button><button class="btn" id="tdGoDl">去下载页</button><button class="btn" id="tdLater">稍后再说</button></div>';
    document.body.appendChild(mask);
    document.body.appendChild(dlg);
    const close = () => { mask.remove(); dlg.remove(); };
    mask.addEventListener("click", close);
    $("#tdLater").addEventListener("click", close);
    $("#tdGoDl").addEventListener("click", () => { switchPage("download"); close(); });
    $("#tdAll").addEventListener("click", async () => {
      setStatus("正在把到期待办加入下载队列 …");
      const res = await api.call("todo_download_all");
      setStatus(res && res.msg ? res.msg : "已开始下载");
      close();
    });
    dlg.querySelectorAll(".td-dl").forEach((b) => b.addEventListener("click", async () => {
      setStatus("正在解析并加入下载队列 …");
      const res = await api.call("todo_download", b.dataset.url);
      setStatus(res && res.msg ? res.msg : "已开始下载");
      b.disabled = true;
      b.textContent = "已加入";
      const row = b.parentElement;
      if (row) row.style.opacity = ".5";
    }));
  } catch (e) { /* 忽略 */ }
})();
$("#btnClearUrls").addEventListener("click", () => {
  $("#urlRows").innerHTML = "";
  addUrlRow();
});
// 批量下载跳转提示：告诉用户任务已排队，等待即可（4 秒自动关闭，也可点按钮）
function showDlNotice() {
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.style.width = "380px";
  dlg.innerHTML =
    '<div class="rd-title">已在下载队列中</div>' +
    '<div style="font-size:13px;color:var(--text-dim);line-height:1.8">任务已开始解析并入队，请在本页等待，无需重复点击「解析」。</div>' +
    '<div class="rd-actions"><button class="btn btn-primary" id="dnOk">知道了</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  const timer = setTimeout(close, 4000);
  function close() { clearTimeout(timer); mask.remove(); dlg.remove(); }
  $("#dnOk", dlg).addEventListener("click", close);
  mask.addEventListener("click", close);
}

// Chrome 扩展一键下载成功 → 后端推送：自动切到下载管理页并刷新
window.__extDownloadStarted = function () {
  try {
    switchPage("dlmanager");
    dlRefresh();
    showDlNotice();
  } catch (e) { /* 忽略 */ }
};

$("#btnParse").addEventListener("click", async () => {  const urls = $$("#urlRows .url-row input").map((i) => i.value.trim()).filter(Boolean);
  if (!urls.length) { setStatus("请先输入链接"); return; }
  // 立即跳转到下载管理页，并禁用按钮防止重复点击（用户反馈：等待期重复点击导致重复下载同一模型）
  switchPage("dlmanager");
  showDlNotice();
  const btn = $("#btnParse");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "解析中...";
  try {
  // 分流：HuggingFace 走文件选择；C 站图片页走批量模型下载；其余走 civitai 解析
  const imgUrls = urls.filter((u) => /civitai\.(red|com)\/images\//i.test(u));
  const hfUrls = urls.filter((u) => /huggingface\.co/i.test(u));
  const cvUrls = urls.filter((u) => !/huggingface\.co/i.test(u) && !/civitai\.(red|com)\/images\//i.test(u));
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
  for (const u of imgUrls) {
    try {
      setStatus("图片页解析中...");
      const res = JSON.parse((await api.call("download_image_models", u)) || "{}");
      if (!res.ok) { setStatus("图片解析失败: " + (res.msg || "")); continue; }
      showImgDlResult(res);
      dlRefresh();
    } catch (e) { setStatus("图片解析失败: " + e); }
  }
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
});

// ===== 图片页模型批量下载结果弹窗 =====
function showImgDlResult(r) {
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.style.width = "520px";
  dlg.style.maxHeight = "80vh";
  dlg.style.overflow = "auto";
  const detail = (r.detail || []).map((d) =>
    '<div class="wf-model"><span class="wf-model-ref">' + esc(d.name) + '（' + esc(d.type || "-") + "）</span>" +
    (d.status === "add"
      ? '<span class="wf-model-path">已加入下载队列</span>'
      : '<span class="wf-model-miss">本地已存在，跳过</span>') +
    "</div>").join("");
  dlg.innerHTML =
    '<div class="rd-title">图片页模型批量下载</div>' +
    '<div class="wf-info">图片共使用 ' + r.total + ' 个模型 · 新增 ' + r.added + ' · 已存在跳过 ' + r.skipped + "</div>" +
    '<div class="wf-nodes" style="margin-top:8px">' + (detail || '<div class="wf-empty">无可用模型</div>') + "</div>" +
    '<div class="rd-actions"><button class="btn btn-primary" id="imgDlOk">知道了</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  const close = () => { mask.remove(); dlg.remove(); };
  $("#imgDlOk", dlg).addEventListener("click", close);
  mask.addEventListener("click", close);
}

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
    '<div class="rd-title">' + esc(info.repo) + "（" + files.length + " 个文件）</div>" +
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
        const paid = (s.items || []).filter((i) => i.paid);
        const ok = (s.items || []).filter((i) => i.ok).length;
        setStatus("解析完成，共加入 " + ok + " 个任务" + (paid.length ? "；" + paid.length + " 个需付费" : ""));
        if (paid.length) showPaidDialog(paid);
        dlRefresh();
        if (ok > 0) switchPage("dlmanager");
      }
    }
  }, 800);
}

// 付费/Early Access 模型处理弹窗
function showPaidDialog(items) {
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.style.width = "540px";
  const rows = items.map((it) => {
    const remain = it.deadline ? Math.max(1, Math.ceil((it.deadline - Date.now() / 1000) / 86400)) : 7;
    return '<div class="paid-row" data-url="' + esc(it.url) + '" data-deadline="' + (it.deadline || 0) + '">' +
      '<div style="font-weight:600">需付费（Early Access）</div>' +
      '<div style="font-size:12px;color:var(--text-dim);word-break:break-all">' + esc(it.url) + "</div>" +
      '<div style="font-size:12px;margin:4px 0 8px">约 ' + remain + ' 天后免费 —— <button class="btn btn-tiny paid-todo">加入待办（自动到期提醒）</button> <button class="btn btn-tiny paid-dl">仍要下载</button></div></div>';
  }).join("");
  dlg.innerHTML =
    '<div class="rd-title">以下模型需要付费或尚未公开</div>' +
    '<div style="max-height:260px;overflow:auto;font-size:13px;line-height:1.8">' + rows + "</div>" +
    '<div class="rd-actions"><button class="btn" id="paidClose">知道了</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  const close = () => { mask.remove(); dlg.remove(); };
  mask.addEventListener("click", close);
  $("#paidClose").addEventListener("click", close);
  dlg.querySelectorAll(".paid-todo").forEach((b) => b.addEventListener("click", async () => {
    const row = b.closest(".paid-row");
    const res = await api.call("todo_add", row.dataset.url, null, Number(row.dataset.deadline) || null);
    setStatus(res && res.msg ? res.msg : "已加入待办");
    b.textContent = "已加入待办";
    b.disabled = true;
  }));
  dlg.querySelectorAll(".paid-dl").forEach((b) => b.addEventListener("click", async () => {
    const row = b.closest(".paid-row");
    setStatus("正在加入下载队列 …");
    const r = await api.call("dl_enqueue_url", row.dataset.url);
    b.textContent = "已提交";
    b.disabled = true;
    if (r && r.started) pollParse();
  }));
}

// ================= 下载目标文件夹（下载页选择 / 设置里预设） =================
async function refreshDlTarget() {
  const el = $("#dlTargetPath");
  if (!el) return;
  try {
    const t = JSON.parse((await api.call("get_download_target")) || "{}");
    if (t.target) {
      el.textContent = t.target;
      el.classList.add("dl-target-set");
    } else {
      el.textContent = "默认下载目录：" + (t.default || "（未设置）");
      el.classList.remove("dl-target-set");
    }
  } catch (e) { /* 忽略 */ }
}

// 从模型目录树里选文件夹（数据源与模型管理页同源：get_folders）
async function pickFolderModal() {
  let data = {};
  try { data = JSON.parse((await api.call("get_folders")) || "{}"); } catch (e) { data = {}; }
  const root = (data.root || "").replace(/\/$/, "");
  const rows = [{ path: root, label: "模型目录根目录（直接放根下）", depth: 0 }];
  (function walk(nodes, depth) {
    (nodes || []).forEach((n) => {
      rows.push({ path: root + "\\" + String(n.path || "").replace(/\//g, "\\"), label: n.name, depth: depth + 1 });
      walk(n.children, depth + 1);
    });
  })(data.tree || [], 0);

  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.style.width = "560px";
  dlg.innerHTML =
    '<div class="rd-title">选择下载落地的文件夹</div>' +
    '<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">下载的模型（连 json/封面一起）直接放进这个文件夹；选中后不再弹「移动分类」询问</div>' +
    '<div id="fpList" style="max-height:330px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:6px"></div>' +
    '<div class="rd-actions"><button class="btn" id="fpCancel">取消</button><button class="btn btn-primary" id="fpOk">确定</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  let sel = rows[0] ? rows[0].path : "";
  const list = $("#fpList", dlg);
  list.innerHTML = rows.map((r) =>
    '<div class="fp-item" data-path="' + esc(r.path) + '" style="padding:6px 8px;border-radius:8px;cursor:pointer;margin-left:' + (r.depth * 16) + 'px">' +
    (r.depth ? _icon("folder") : _icon("folder")) + esc(r.label) +
    '<div style="font-size:11px;color:var(--text-dim);word-break:break-all">' + esc(r.path) + "</div></div>").join("");
  const mark = () => {
    list.querySelectorAll(".fp-item").forEach((d) => {
      const on = d.dataset.path === sel;
      d.style.background = on ? "var(--accent, #4da3ff)" : "";
      d.style.color = on ? "#fff" : "";
    });
  };
  list.addEventListener("click", (e) => {
    const it = e.target.closest(".fp-item");
    if (!it) return;
    sel = it.dataset.path;
    mark();
  });
  mark();
  const close = () => { mask.remove(); dlg.remove(); };
  mask.addEventListener("click", close);
  $("#fpCancel", dlg).addEventListener("click", close);
  return new Promise((resolve) => {
    $("#fpOk", dlg).addEventListener("click", () => { close(); resolve(sel); });
  });
}

async function applyDownloadTarget(p) {
  const r = JSON.parse((await api.call("set_download_target", p)) || "{}");
  if (r.ok) {
    state.cfg.download_target_dir = p || "";
    setStatus(r.msg || (p ? "下载将直接保存到：" + p : "已恢复为默认下载目录"));
    await refreshDlTarget();
  } else {
    setStatus(r.msg || "设置失败");
  }
  return r.ok;
}

if ($("#btnDlTarget")) $("#btnDlTarget").addEventListener("click", async () => {
  const p = await pickFolderModal();
  if (p) await applyDownloadTarget(p);
});
if ($("#btnDlTargetReset")) $("#btnDlTargetReset").addEventListener("click", () => applyDownloadTarget(""));

// ================= SHA256 查重 =================
function fmtBytes(n) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  n = Number(n) || 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n + " B" : n.toFixed(1) + " " + u[i]);
}

async function mmDedupeFlow() {
  const r = await api.call("mm_dedupe", null);
  if (!r || !r.started) { setStatus((r && r.msg) || "查重未开始"); return; }
  setStatus("查重中：正在计算文件哈希并整理新旧版本（大库需要一会儿）…");
  const timer = setInterval(async () => {
    const p = await api.call("get_mm_progress");
    if (!p) return;
    if (p.running) { setStatus("查重中 " + (p.done || 0) + "/" + (p.total || 0) + (p.msg ? " · " + p.msg : "")); return; }
    clearInterval(timer);
    setStatus(p.msg || "查重完成");
    const dupGroups = Array.isArray(p.result) ? p.result : [];
    const modelGroups = Array.isArray(p.model_groups) ? p.model_groups : [];
    if (dupGroups.length || modelGroups.length) showDedupeDialog(dupGroups, modelGroups);
  }, 800);
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

async function showDedupeDialog(groups, modelGroups) {
  groups = groups || [];
  modelGroups = modelGroups || [];
  const totalDups = groups.reduce((s, g) => s + g.dups.length, 0);
  const sizeA = groups.reduce((s, g) => s + g.dups.reduce((x, d) => x + (d.size || 0), 0), 0);
  const totalOlds = modelGroups.reduce((s, g) => s + (g.olds || []).length, 0);
  const sizeB = modelGroups.reduce((s, g) => s + (g.olds || []).reduce((x, o) => x + (o.size || 0), 0), 0);
  const thumb = (p) => '<img class="dd-thumb" data-path="' + esc(p) + '" alt=""/>';

  const secA = groups.length ? (
    '<div class="dedup-sec">完全相同（同哈希 · ' + groups.length + " 组 · " + totalDups + " 个副本）</div>" +
    '<div class="dd-hint">同名同内容只留一份：默认勾选的是「多余的副本」，会移入回收站（可还原）。</div>' +
    groups.map((g, gi) =>
      '<div class="dedup-group">' +
      '<div class="dedup-keep">' + thumb(g.keep) + '<div class="dd-text">保留 <b>' + esc(g.keep_name) + "</b>" +
      '<div class="dedup-dir">' + esc(g.keep_dir) + "</div></div></div>" +
      g.dups.map((d, di) =>
        '<label class="dedup-dup">' + thumb(d.path) +
        '<input type="checkbox" data-g="' + gi + '" data-d="' + di + '" checked/> ' +
        '<div class="dd-text"><span>' + esc(d.name) + "</span>" +
        '<div class="dedup-dir">' + esc(d.dir) + " · " + fmtBytes(d.size) + "</div></div></label>").join("") +
      "</div>").join("")) : "";

  const secB = modelGroups.length ? (
    '<div class="dedup-sec">同模型多版本（' + modelGroups.length + " 组 · 旧版 " + totalOlds + " 个 · 约 " + fmtBytes(sizeB) + "）</div>" +
    '<div class="dd-hint">同一个模型存了多个版本：<b>默认已帮你勾上「旧版」</b>（点下面「旧版共存」就能全部不删）；' +
    "每条都能看缩略图 + 点 去 C 站核对到底是哪一版。</div>" +
    modelGroups.map((g, gi) =>
      '<div class="dedup-group">' +
      '<div class="dedup-keep">' + thumb(g.keep.path) + '<div class="dd-text"><b>' + esc(g.model_name || g.model_id) + "</b> " +
      '<a href="#" class="dd-link" data-url="' + esc(g.url) + '">模型 C 站页面</a>' +
      (g.count > 2 ? '<span style="color:var(--text-dim)"> · 共 ' + g.count + " 个版本</span>" : "") +
      '<div class="dedup-dir">保留（最新） ' + esc(g.keep.ver || g.keep.name) + " · " + esc(g.keep.base || "-") +
      " · " + fmtBytes(g.keep.size) + (g.keep.mtime ? " · " + fmtDate(g.keep.mtime) : "") +
      ' <a href="#" class="dd-link" data-url="' + esc(g.keep.url) + '">这一版</a></div></div></div>' +
      g.olds.map((o, oi) =>
        '<label class="dedup-dup">' + thumb(o.path) +
        '<input type="checkbox" data-mg="' + gi + '" data-o="' + oi + '" checked/> ' +
        '<div class="dd-text"><span>旧版 ' + esc(o.ver || o.name) + "</span>" +
        '<div class="dedup-dir">' + esc(o.base || "-") + " · " + fmtBytes(o.size) + (o.mtime ? " · " + fmtDate(o.mtime) : "") +
        (o.copies > 1 ? " · 另有同名副本 " + o.copies + " 份（在上一节里）" : "") + "</div>" +
        '<div class="dedup-dir">' + esc(o.dir) + ' · <a href="#" class="dd-link" data-url="' + esc(o.url) + '">这一版</a></div></div></label>').join("") +
      "</div>").join("")) : "";

  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.style.width = "720px";
  dlg.innerHTML =
    '<div class="rd-title">查重结果：' + groups.length + " 组完全相同 + " + modelGroups.length + " 组同模型多版本（可清理约 " + fmtBytes(sizeA + sizeB) + "）</div>" +
    '<div class="dd-hint" style="border:1px solid var(--border);border-radius:8px;padding:6px 8px;margin-bottom:8px">' +
    "<b>勾选 = 移入回收站</b>（可在回收站还原，不会真删）。「<b>删旧留新</b>」= 把所有旧版都勾上；「<b>旧版共存</b>」= 全部取消勾选、什么都不删。</div>" +
    '<div style="max-height:400px;overflow:auto">' + secA + secB + "</div>" +
    '<div class="rd-actions"><button class="btn" id="ddSelAll">全选</button><button class="btn" id="ddSelNone">全不选</button>' +
    '<button class="btn" id="ddOldsAll" title="把所有旧版都勾上（只保留最新版）">删旧留新（勾选旧版）</button>' +
    '<button class="btn" id="ddCoexist" title="取消勾选全部旧版 = 新旧版本都留着，什么都不删">旧版共存（不删）</button>' +
    '<button class="btn" id="ddClose">关闭</button>' +
    '<button class="btn btn-danger" id="ddDel">移入回收站</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  const close = () => { mask.remove(); dlg.remove(); };
  mask.addEventListener("click", close);
  $("#ddClose", dlg).addEventListener("click", close);
  dlg.querySelectorAll(".dd-link").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    api.call("open_url", a.dataset.url);
  }));
  function updCount() {
    let n = 0;
    dlg.querySelectorAll("input[type=checkbox]:checked").forEach((c) => {
      if (c.dataset.mg !== undefined || c.dataset.g !== undefined) n++;
    });
    $("#ddDel", dlg).textContent = n ? "移入回收站（" + n + " 个）" : "移入回收站";
  }
  dlg.addEventListener("change", updCount);
  $("#ddSelAll", dlg).addEventListener("click", () => { dlg.querySelectorAll("input[type=checkbox]").forEach((c) => (c.checked = true)); updCount(); });
  $("#ddSelNone", dlg).addEventListener("click", () => { dlg.querySelectorAll("input[type=checkbox]").forEach((c) => (c.checked = false)); updCount(); });
  $("#ddOldsAll", dlg).addEventListener("click", () => { dlg.querySelectorAll("input[data-mg]").forEach((c) => (c.checked = true)); updCount(); setStatus("已勾选全部旧版：确认后只保留每个模型的最新版"); });
  $("#ddCoexist", dlg).addEventListener("click", () => { dlg.querySelectorAll("input[data-mg]").forEach((c) => (c.checked = false)); updCount(); setStatus("已取消全部旧版勾选：新旧版本都保留"); });
  updCount();
  // 缩略图（有封面的才显示，失败不影响）
  const allPaths = [];
  groups.forEach((g) => { allPaths.push(g.keep); (g.dups || []).forEach((d) => allPaths.push(d.path)); });
  modelGroups.forEach((g) => { allPaths.push(g.keep.path); (g.olds || []).forEach((o) => allPaths.push(o.path)); });
  loadDdThumbs(dlg, allPaths);

  $("#ddDel", dlg).addEventListener("click", async () => {
    const picked = [];
    dlg.querySelectorAll("input[type=checkbox]:checked").forEach((c) => {
      if (c.dataset.mg !== undefined && c.dataset.mg !== "") {
        const g = modelGroups[Number(c.dataset.mg)];
        const o = g && g.olds[Number(c.dataset.o)];
        if (o) picked.push({ path: o.path, name: o.name, dir: o.dir, ver: o.ver, size: o.size });
      } else if (c.dataset.g !== undefined && c.dataset.g !== "") {
        const g = groups[Number(c.dataset.g)];
        const d = g && g.dups[Number(c.dataset.d)];
        if (d) picked.push({ path: d.path, name: d.name, dir: d.dir, size: d.size });
      }
    });
    if (!picked.length) { setStatus("没有勾选任何要清理的文件"); return; }
    // 带缩略图 + 排版的确认框（confirmBox 会转义 HTML，所以这里用不转义的版本）
    const totalSize = picked.reduce((s, d) => s + (d.size || 0), 0);
    const rows = picked.map((d) =>
      '<div class="cf-row">' + thumb(d.path) + '<div class="dd-text">' +
      "<b>" + esc(d.name) + "</b>" + (d.ver ? ' <span style="color:var(--warn,#d29922)">旧版 ' + esc(d.ver) + "</span>" : " <span style='color:var(--text-dim)'>重复副本</span>") +
      '<div class="dedup-dir">' + esc(d.dir) + (d.size ? " · " + fmtBytes(d.size) : "") + "</div></div></div>").join("");
    const ok = await confirmBoxRaw(
      '<div style="font-size:12px;color:var(--text-dim);margin-bottom:6px">以下 <b>' + picked.length +
      "</b> 个文件将移入回收站（可还原，不会真正删除）：</div>" +
      '<div style="max-height:300px;overflow:auto">' + rows + "</div>",
      "清理重复 / 旧版模型（" + picked.length + " 个" + (totalSize ? " · 约 " + fmtBytes(totalSize) : "") + "）");
    if (!ok) return;
    if (ok.root) loadDdThumbs(ok.root, picked.map((d) => d.path));
    if (ok.root) ok.root.remove();          // 关掉确认框（否则清理完它还挂在屏幕上）
    await close();
    const r0 = await api.call("mm_dedupe_delete", picked.map((d) => d.path));
    if (!r0 || !r0.ok) { setStatus((r0 && r0.msg) || "清理失败"); return; }
    setStatus(r0.msg || "开始清理…");
    const timer = setInterval(async () => {
      const p = await api.call("get_mm_progress");
      if (!p) return;
      if (p.running) { setStatus(p.msg || "正在清理…"); return; }
      clearInterval(timer);
      setStatus(p.msg || "清理完成");
      if (Array.isArray(p.result) && p.result.length) {
        infoBox('<div style="font-size:12px;line-height:1.8">' +
          p.result.map((f) => "· <b>" + esc(f.file) + "</b>：" + esc(f.msg)).join("<br/>") +
          "</div>", "这些没能清理（可在资源管理器里手动删除）");
      }
      await api.call("scan_models");
      pollMmScan();
    }, 700);
  });
}

if ($("#mmDedupe")) $("#mmDedupe").addEventListener("click", mmDedupeFlow);

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
      const thumb = state.dlThumbs[t.filename] ? '<img class="thumb" src="data:image/jpeg;base64,' + state.dlThumbs[t.filename] + '" alt=""/>' : '<span class="thumb thumb-empty"></span>';
      const errCell = t.error
        ? "<td class='c-err err-copy' title='点击复制完整报错'>" + esc(t.error) + "</td>"
        : "<td class='c-err'></td>";
      // 「保存到」列：显示该任务会落在哪（未单独指定时显示全局目标）；点一下可单独换
      const destFull = t.dest_dir || "";
      const effFull = destFull || (state.cfg ? (state.cfg.download_target_dir || state.cfg.download_dir || "") : "");
      const md = (state.cfg && state.cfg.models_dir) || "";
      let destShow = effFull;
      if (md && effFull && effFull.toLowerCase().indexOf(md.toLowerCase()) === 0) {
        destShow = effFull.slice(md.length).replace(/^[\\/]+/, "");
      }
      const destTip = (destFull ? destFull : (effFull + "\n（全局目标）")) + "\n点击选择该文件的保存文件夹";
      const destCell = "<td class='c-dest cell-dest' data-task='" + esc(t.id) + "' title='" + esc(destTip) + "'>" + esc(destShow || effFull || "未设置") + (destFull ? "" : " <span class='dest-def'>默认</span>") + "</td>";
      return '<tr data-fn="' + esc(t.filename) + '" class="' + (selPaths.has(t.filename) ? "sel-row" : "") + '">' +
        "<td class='c-thumb'>" + thumb + "</td><td class='c-file'>" + esc(t.filename) + "</td>" + destCell + "<td>" + esc(st) + "</td><td>" + esc(prog) + "</td>" +
        "<td>" + esc(speed) + "</td><td>" + esc(size) + "</td>" + errCell + "</tr>";
    }).join("");
    loadDlThumbs(state.dlTasks || []);
    // 下载受限（Early Access/付费）→ 弹窗选择
    maybeAskRestricted(tasks || []);
    // 下载完成 → 询问移动分类（ask_move_after_download 开启且本次会话未询问过）
    maybeAskMove(tasks || []);
  } catch (e) { /* 未就绪 */ }
}

// 下载管理列表缩略图：按文件名缓存，已加载的不重复请求（get_covers 传模型文件路径自动找同目录封面）
const _dlThumbLoading = new Set();
function loadDlThumbs(tasks) {
  const todo = tasks.filter((t) =>
    t.dest_dir && t.status === "done" && !state.dlThumbs[t.filename] && !_dlThumbLoading.has(t.filename)).slice(0, 40);
  if (!todo.length) return;
  todo.forEach((t) => _dlThumbLoading.add(t.filename));
  api.call("get_covers", todo.map((t) => t.dest_dir + "\\" + t.filename), 96).then((json) => {
    try {
      const covers = JSON.parse(json || "{}");
      for (const [p, b64] of Object.entries(covers)) {
        const fn = todo.find((t) => (t.dest_dir + "\\" + t.filename).toLowerCase() === p.toLowerCase());
        if (fn) {
          state.dlThumbs[fn.filename] = b64;
          const img = $("#dlTable tbody tr[data-fn='" + CSS.escape(fn.filename) + "'] .thumb");
          if (img) img.src = "data:image/jpeg;base64," + b64;
        }
      }
    } catch (e) { /* 忽略 */ }
    todo.forEach((t) => _dlThumbLoading.delete(t.filename));
  }).catch(() => todo.forEach((t) => _dlThumbLoading.delete(t.filename)));
}

// 下载受限（C 站限制）弹窗选择：花费积分重试 / 加入待办并移除 / 浏览器打开
const _restrictAsked = new Set();
function maybeAskRestricted(tasks) {
  if (_restrictAsking) return;
  const t = (tasks || []).find((x) =>
    x.status === "error" && (x.error || "").includes("暂不可下载") && !_restrictAsked.has(x.id));
  if (!t) return;
  _restrictAsked.add(t.id);
  _restrictAsking = true;
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.style.width = "480px";
  dlg.innerHTML =
    '<div class="rd-title">模型下载受限（Early Access / 付费）</div>' +
    '<div style="font-size:12px;color:var(--text-dim);word-break:break-all">' + esc(t.filename || "") + "</div>" +
    '<div style="font-size:12px;color:var(--text-dim);margin:4px 0 10px">该模型在 C 站暂不可直接下载。若有积分可先在浏览器购买解锁，或加入待办等免费开放。</div>' +
    '<div class="rd-actions">' +
    '<button class="btn btn-primary" id="rkRetry">花费积分/重试下载</button>' +
    '<button class="btn" id="rkTodo">加入待办并移除</button>' +
    '<button class="btn" id="rkSite">浏览器打开</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  const close = () => { mask.remove(); dlg.remove(); _restrictAsking = false; };
  mask.addEventListener("click", close);
  $("#rkRetry").addEventListener("click", async () => {
    close();
    await api.call("dl_action", "retry", [t.filename]);
    dlRefresh();
  });
  $("#rkSite").addEventListener("click", () => {
    const url = t.url || ("https://" + (state.cfg.site_domain || "civitai.red") + "/models/" + (t.filename || ""));
    api.call("open_url", url);
  });
  $("#rkTodo").addEventListener("click", async () => {
    close();
    if (t.url) await api.call("todo_add", t.url);
    await api.call("dl_action", "remove", [t.filename]);
    setStatus("已加入待办并从下载管理移除");
    dlRefresh();
  });
}
let _restrictAsking = false;

// 下载完成移动询问（每个任务仅询问一次）
const _moveAsked = new Set();
let _moveAsking = false;
function maybeAskMove(tasks) {
  if (_moveAsking || !(state.cfg && state.cfg.ask_move_after_download)) return;
  // 已在下载页/设置里选了「下载目标文件夹」→ 下载完成会自动归位，不再弹窗询问
  if (state.cfg && (state.cfg.download_target_dir || "").trim()) return;
  const done = tasks.find((t) => t.status === "done" && t.dest_dir && !_moveAsked.has(t.id));
  if (!done) return;
  _moveAsked.add(done.id);
  _moveAsking = true;
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.innerHTML =
    '<div class="rd-title">下载完成：' + esc(done.filename) + "</div>" +
    '<div style="display:flex;gap:14px;align-items:flex-start">' +
    '<div id="mvThumb" style="width:112px;height:112px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;border:1px solid var(--border)"><span style="font-size:30px"></span></div>' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-size:13px;color:var(--text-dim);line-height:1.8">是否移动到分类文件夹？（主文件与 json/封面等附属一起移动）</div>' +
    '<div class="rd-actions" style="margin-top:10px">' +
    '<button class="btn" id="mvNo">不移动</button>' +
    '<button class="btn btn-primary" id="mvYes">选择文件夹</button></div>' +
    "</div></div>";
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  const close = () => { clearTimeout(mvTimer); mask.remove(); dlg.remove(); _moveAsking = false; };
  // 左侧显示模型缩略图（同目录 preview.png 封面；封面下载是后台任务，可能稍后才落盘，最多重试 4 次）
  let mvTries = 0;
  let mvTimer = null;
  (function loadMvThumb() {
    api.call("get_covers", [done.dest_dir + "\\" + done.filename], 112).then((json) => {
      try {
        const covers = JSON.parse(json || "{}");
        const b64 = Object.values(covers)[0];
        if (b64) {
          $("#mvThumb", dlg).innerHTML = '<img src="data:image/jpeg;base64,' + b64 + '" style="width:100%;height:100%;object-fit:cover"/>';
          return;
        }
      } catch (e) { /* 忽略 */ }
      // 封面还没落盘：等 2.5s 后重试（最多 4 次，约 10s 内追上封面下载；弹窗关闭则停止）
      if (mvTries < 4 && document.body.contains(dlg)) {
        mvTries++;
        mvTimer = setTimeout(loadMvThumb, 2500);
      }
    }).catch(() => { /* 无封面保持占位 */ });
  })();
  $("#mvNo", dlg).addEventListener("click", close);
  mask.addEventListener("click", close);
  $("#mvYes", dlg).addEventListener("click", async () => {
    const dir = await pickFolderModal();   // 应用内文件夹树（与模型管理同源），不用系统弹窗
    close();
    if (!dir) return;
    const res = await api.call("move_file_to", done.dest_dir + "\\" + done.filename, dir);
    setStatus(res && res.msg ? res.msg : "移动完成");
    dlRefresh();
  });
}

$("#dlTable tbody").addEventListener("click", async (e) => {
  // 「保存到」列：给这一个任务单独选文件夹（应用内文件夹树，不用系统弹窗）
  const destCell = e.target.closest(".cell-dest");
  if (destCell) {
    const tid = destCell.dataset.task;
    const p = await pickFolderModal();
    if (!p) return;
    const r = await api.call("set_task_target", tid, p);
    setStatus((r && r.msg) || "已更新保存位置");
    dlRefresh();
    return;
  }
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
// 批量/单选：给任务指定保存文件夹（应用内文件夹树；未勾选=全部任务）
$("#dlSetTarget").addEventListener("click", async () => {
  const sel = dlSel();
  const tasks = (state.dlTasks || []).filter((t) => !sel.length || sel.indexOf(t.filename) >= 0);
  if (!tasks.length) { setStatus(sel.length ? "选中的任务里没有可设置的" : "任务列表为空"); return; }
  const p = await pickFolderModal();
  if (!p) return;
  let ok = 0, fail = 0, msg = "";
  for (const t of tasks) {
    const r = await api.call("set_task_target", t.id, p);
    if (r && r.ok) ok++; else { fail++; msg = (r && r.msg) || msg; }
  }
  setStatus("已设置 " + ok + " 个任务的保存位置" + (fail ? ("，失败 " + fail + (msg ? "：" + msg : "")) : ""));
  dlRefresh();
});
$("#dlClearDone").addEventListener("click", () => dlAct("clear_done"));
$("#dlSave").addEventListener("click", () => dlAct("save"));

// 下载管理行右键菜单：打开所在文件夹 / 复制文件名 / 打开C站（复用全局 ctxMenu，act 前缀 dl_）
$("#dlTable tbody").addEventListener("contextmenu", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const t = (state.dlTasks || []).find((x) => x.filename === tr.dataset.fn);
  if (!t) return;
  e.preventDefault();
  const menu = $("#ctxMenu");
  menu.innerHTML =
    '<div class="ctx-item" data-act="dl_folder" data-tip="打开资源管理器并选中该文件">打开所在文件夹</div>' +
    '<div class="ctx-item" data-act="dl_copy" data-tip="复制当前文件名">复制文件名</div>' +
    '<div class="ctx-item" data-act="dl_site" data-tip="在浏览器打开该模型在 C 站的主页">打开C站</div>';
  menu.style.display = "block";
  const zf = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  menu.style.left = (e.clientX / zf) + "px";
  menu.style.top = (e.clientY / zf) + "px";
  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - mr.width) + "px";
  if (mr.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - mr.height) + "px";
});
$("#ctxMenu").addEventListener("click", async (e) => {
  const item = e.target.closest("[data-act^=dl_]");
  if (!item) return;
  const tr = document.querySelector("#dlTable tbody tr.sel-row");
  const t = tr && (state.dlTasks || []).find((x) => x.filename === tr.dataset.fn);
  $("#ctxMenu").style.display = "none";
  const act = item.dataset.act;
  if (!t) return;
  if (act === "dl_copy") {
    await window.__copyText(t.filename);
    setStatus("文件名已复制: " + t.filename);
  } else if (act === "dl_folder") {
    const full = (t.dest_dir ? t.dest_dir + "\\" : "") + t.filename;
    const r = JSON.parse(await api.call("open_in_folder", full) || "{}");
    setStatus((r && r.ok) ? "已打开所在文件夹" : ((r && r.msg) || "文件不存在或已被移动"));
  } else if (act === "dl_site") {
    const url = t.url || ("https://" + (state.cfg.site_domain || "civitai.red") + "/models/" + t.filename);
    api.call("open_url", url);
  }
});

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
      state.mmSort = { col: "name", rev: false };
      try {
        const u = await api.call("get_model_updates");   // 缓存的更新检测结果 → 卡片         if (u && u.items) applyUpdatesToRows(u.items);
      } catch (e) { /* 忽略 */ }
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
  state.display = rows.slice();  // 同步排序后的显示顺序（shift 区间 / data-idx 依赖）
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
      '<td class="cell-sel" data-col="sel">' + (state.mmChecked.has(r.path) ? '<span class="cbox on"></span>' : '<span class="cbox"></span>') + "</td>" +
      "<td class='c-name' data-col='name'><div class='ml-wrap'>" +
        '<img data-idx="' + i + '" data-path="' + esc(r.path) + '" class="thumb ml-thumb" alt=""/>' +
        (r.upd && r.upd.has_update ? '<a href="#" class="mm-upd" data-url="' + esc(r.upd.url || "") + '" title="' + esc(updTip(r.upd)) + '">' + _icon("alert") + '</a>' : "") +
        '<div class="ml-txt">' +
          '<div class="ml-1" data-tip="' + esc((r.civitai_name || r.name) + "\n" + String(r.name || "")) + '">' + esc(r.civitai_name || r.name) + "</div>" +
          ((r.author || (r.info && r.info.creator)) ? '<div class="ml-3">作者 ' + esc(r.author || (r.info && r.info.creator)) + "</div>" : "") +
        "</div></div></td>" +
      "<td class='c-name' data-col='cname' data-tip='' >" + esc(r.civitai_name || "-") + "</td>" +
      "<td data-col='type'>" + esc(r.type || "-") + "</td><td data-col='base'>" + esc(r.base || "-") + "</td>" +
      "<td class='c-ver' data-col='ver'>" + esc(r.ver || "-") + "</td>" +
      "<td data-col='update'>" + ((r.upd && (r.upd.has_update || r.upd.other_base)) ? '<span class="st-mini upd">' + _icon("alert") + '有更新</span>' : (r.upd ? '<span class="st-mini ok">' + _icon("check") + '已最新</span>' : '<span class="st-mini none">未检查</span>')) + "</td>" +
      "<td data-col='hash'>" + esc(r.hash || "-") + "</td>" +
      "<td data-col='size'>" + fmtSize(r.size) + "</td><td class='c-time' data-col='mtime'>" + fmtTime(r.mtime) + "</td>" +
      "<td class='c-path' data-col='path' data-full='" + esc(rel.replace(/[^\\/]+$/, "")) + "'>" + esc(short(rel, 30)) + "</td></tr>";
  }).join("");
  $("#mmCheckLabel").textContent = "已勾选 " + state.mmChecked.size + " 个";
  loadThumbs(0);
  mmApplyCols();
}

// 分批加载封面缩略图（每次 40 个，避免大传输卡顿）
async function loadThumbs(start) {
  const batch = state.display.slice(start, start + 40);
  if (!batch.length) return;
  try {
    const json = await api.call("get_covers", batch.map((r) => r.path));
    const covers = JSON.parse(json || "{}");
    for (const [p, b64] of Object.entries(covers)) {
      document.querySelectorAll(".thumb").forEach((img) => {
        if (img.dataset.path === p) img.src = "data:image/jpeg;base64," + b64;
      });
    }
  } catch (e) { /* 缩略图失败不影响列表 */ }
  loadThumbs(start + 40);
}

// ===== 表头列宽拖拽 =====
(function () {
  let drag = null;
  document.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const zf = parseFloat(document.documentElement.style.zoom) || 1;
    const w = Math.max(50, drag.startW + (e.clientX - drag.startX) / zf);
    drag.th.style.width = w + "px";
  });
  document.addEventListener("mouseup", () => {
    if (!drag) return;
    drag.th.classList.remove("resizing");
    const widths = {};
    document.querySelectorAll("#mmTable th[data-col]").forEach((th) => {
      widths[th.dataset.col] = th.style.width;
    });
    try { localStorage.setItem("mm_col_widths", JSON.stringify(widths)); } catch (e) {}
    drag = null;
  });
  function bindResize() {
    document.querySelectorAll("#mmTable th[data-col]").forEach((th) => {
      if (th.querySelector(".col-resize")) return;
      const hd = document.createElement("div");
      hd.className = "col-resize";
      hd.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        drag = { th, startX: e.clientX, startW: th.getBoundingClientRect().width };
        th.classList.add("resizing");
      });
      th.appendChild(hd);
    });
    // 恢复保存的宽度
    try {
      const widths = JSON.parse(localStorage.getItem("mm_col_widths") || "{}");
      document.querySelectorAll("#mmTable th[data-col]").forEach((th) => {
        if (widths[th.dataset.col]) th.style.width = widths[th.dataset.col];
      });
    } catch (e) {}
  }
  // 表格渲染后重新绑定（renderMm 调用 mmApplyCols 后）
  const origApply = window.mmApplyCols;
  window.mmApplyCols = function () {
    if (origApply) origApply();
    bindResize();
  };
})();

// 表头 点击 = 全选/取消全选
$("#mmTable thead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-col=sel]");
  if (!th) return;
  const allSel = state.display.length > 0 && state.display.every((r) => state.mmChecked.has(r.path));
  if (allSel) state.mmChecked.clear();
  else state.display.forEach((r) => state.mmChecked.add(r.path));
  th.innerHTML = '<span class="cbox' + (allSel ? " on" : "") + '"></span> 全选';
  $("#mmCheckLabel").textContent = "已勾选 " + state.mmChecked.size + " 个";
  state.display.forEach((r) => {
    const tr2 = document.querySelector('#mmTable tbody tr[data-path="' + CSS.escape(r.path) + '"]');
    const c2 = tr2 && tr2.querySelector(".cell-sel");
    if (c2) c2.innerHTML = state.mmChecked.has(r.path) ? '<span class="cbox on"></span>' : '<span class="cbox"></span>';
  });
});

// ===== 模型列表列显隐（右键表头） =====
const MM_COLS = [["sel", "勾选"], ["thumb", "缩略图"], ["name", "模型信息"], ["cname", "C站模型名"],
                 ["type", "类型"], ["base", "基础模型"], ["ver", "版本"], ["update", "更新"],
                 ["hash", "哈希"], ["size", "大小"], ["mtime", "下载时间"], ["path", "路径"]];
function mmApplyCols() {
  let hidden = [];
  const DEFAULT_HIDDEN = ["cname", "hash"];   // 只收起「C站模型名」「哈希」；大小/时间/路径都保留（信息密度优先）
  try {
    // v2 迁移：早期版本默认藏得太多（fixed 布局下会留下空槽 → 右侧一片空白），升级时重置一次
    if (localStorage.getItem("mm_hidden_cols_v") !== "3") {
      hidden = DEFAULT_HIDDEN.slice();
      localStorage.setItem("mm_hidden_cols", JSON.stringify(hidden));
      localStorage.setItem("mm_hidden_cols_v", "3");
    } else {
      hidden = JSON.parse(localStorage.getItem("mm_hidden_cols") || "[]");
    }
  } catch (e) { hidden = DEFAULT_HIDDEN.slice(); }
  const hs = new Set(hidden);
  // 表头与数据行必须用同一份清单、同步隐藏（否则表头 A 位置/数据 B 位置）
  document.querySelectorAll("#mmTable thead [data-col], #mmTable tbody [data-col]").forEach((el) => {
    el.style.display = hs.has(el.dataset.col) ? "none" : "";
  });
  // ★ 关键根因修复（2026-09 用无头浏览器实测量出来的，勿改回）：
  //   CSS 表格里 display:none 的单元格会让后续单元格"左移"，错误占用 <colgroup> 的列槽
  //   → 列宽整体错位、表格尾部无列覆盖 → 右侧出现固定空白（实测 1280 宽下 237px）。
  //   正确做法：<colgroup> 只重建"可见列"的 <col>（class 与 CSS 的 col.c-* 规则同源），
  //   让可见单元格与 <col> 一一对应；弹性列（c-name = auto）随之吃掉全部剩余宽度 → 永远铺满。
  const cg = document.querySelector("#mmTable colgroup");
  const ths = Array.from(document.querySelectorAll("#mmTable thead th"));
  if (cg) {
    cg.innerHTML = ths.filter((th) => !hs.has(th.dataset.col))
      .map((th) => '<col class="c-' + th.dataset.col + '"/>').join("");
  }
  // 「缩略图」是伪列（缩略图在模型信息单元格里，没有独立 <col>）：用表上的 class 控制
  const tbl = document.getElementById("mmTable");
  if (tbl) tbl.classList.toggle("no-thumb", hs.has("thumb"));
}
$("#mmTable thead").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  let hidden = [];
  try { hidden = JSON.parse(localStorage.getItem("mm_hidden_cols") || "[]"); } catch (e) {}
  const hs = new Set(hidden);
  const menu = $("#ctxMenu");
  menu.innerHTML = '<div class="ctx-item" style="font-weight:600;cursor:default">显示列</div>' +
    MM_COLS.map(([c, label]) =>
      '<div class="ctx-item" data-col="' + c + '">' + (hs.has(c) ? '<span class="cbox"></span> ' : '<span class="cbox on"></span> ') + esc(label) + "</div>").join("");
  menu.style.display = "block";
  const zf2 = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  menu.style.left = (e.clientX / zf2) + "px";
  menu.style.top = (e.clientY / zf2) + "px";
  for (let k = 0; k < 4; k++) {
    const got = menu.getBoundingClientRect();
    const dx = e.clientX - got.left;
    const dy = e.clientY - got.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    menu.style.left = (parseFloat(menu.style.left) + dx) + "px";
    menu.style.top = (parseFloat(menu.style.top) + dy) + "px";
  }
  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - mr.width) + "px";
  if (mr.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - mr.height) + "px";
});
$("#ctxMenu").addEventListener("click", (e) => {
  const item = e.target.closest("[data-col]");
  if (!item || !item.dataset.col) return;
  let hidden = [];
  try { hidden = JSON.parse(localStorage.getItem("mm_hidden_cols") || "[]"); } catch (e) {}
  const hs = new Set(hidden);
  if (hs.has(item.dataset.col)) hs.delete(item.dataset.col); else hs.add(item.dataset.col);
  localStorage.setItem("mm_hidden_cols", JSON.stringify(Array.from(hs)));
  mmApplyCols();
  $("#ctxMenu").style.display = "none";
});
// 「显示列」等右键面板：点击面板外或按 Esc 关闭（此前只能靠再次切换列才会关，用户反馈"关不掉"）
document.addEventListener("click", (e) => {
  const m = $("#ctxMenu");
  if (m && m.style.display === "block" && e.target && !(e.target.closest && e.target.closest("#ctxMenu"))) m.style.display = "none";
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { const m = $("#ctxMenu"); if (m) m.style.display = "none"; }
});
// 渲染后应用列显隐（在 renderMm 列表分支后调用）

// ===== 瀑布流视图 =====
function renderMasonry(rows) {
  $("#mmTableWrap").style.display = "none";
  $("#mmMasonry").style.display = "block";
  $("#mmMasonry").innerHTML = rows.map((r, i) => {
    const checked = state.mmChecked.has(r.path) ? "checked" : "";
    const _cn = String(r.civitai_name || "").trim();
    const _disp = _cn || String(r.name || "");
    const _sub = (_cn && _cn !== r.name) ? String(r.name || "") : "";
    const _meta = [r.base, r.type].filter(Boolean).map((x) => short(String(x), 16)).join(" · ");
    const _meta2 = [r.ver ? short(String(r.ver), 16) : "", fmtSize(r.size)].filter(Boolean).join(" · ");
    return '<div class="ms-card' + (checked ? " checked" : "") + '" data-idx="' + i + '" data-path="' + esc(r.path) + '" title="' + esc(String(r.name || "") + " · " + String(r.path || "")) + '">' +
      '<span class="ms-check">' + (checked ? '<span class="cbox on"></span>' : '<span class="cbox"></span>') + "</span>" +
      _msTag(r) +
      (r.upd && r.upd.has_update ? '<a href="#" class="ms-upd" data-url="' + esc(r.upd.url || "") + '" title="' + esc(updTip(r.upd)) + '">' + _icon("alert") + '</a>' : "") +
      '<div class="ms-img-wrap" data-ph="loading"><img class="ms-img" data-idx="' + i + '" data-path="' + esc(r.path) + '" alt=""/></div>' +
      '<div class="ms-name">' + esc(short(_disp, 30)) + "</div>" +
      (_sub ? '<div class="ms-sub">' + esc(short(_sub, 30)) + "</div>" : "") +
      '<div class="ms-meta">' + esc(_meta || (r.type || "-")) + "</div>" +
      '<div class="ms-size">' + esc(_meta2 || fmtSize(r.size)) + "</div></div>";
  }).join("");
  $("#mmCheckLabel").textContent = "已勾选 " + state.mmChecked.size + " 个";
  loadMasonryThumbs(0);
}
async function loadMasonryThumbs(start) {
  const batch = state.display.slice(start, start + 40);
  if (!batch.length) {
    // 所有批次跑完：仍处 loading 的标记为"暂无封面"（保证高度稳定、不再是白块）
    document.querySelectorAll('.ms-img-wrap[data-ph="loading"]').forEach((w) => { w.dataset.ph = "none"; });
    return;
  }
  const _markBatch = (paths, ph) => {
    paths.forEach((pp) => {
      document.querySelectorAll(".ms-img[data-path]").forEach((img) => {
        if (img.dataset.path === pp) {
          const w = img.closest(".ms-img-wrap");
          if (w && w.dataset.ph === "loading") w.dataset.ph = ph;
        }
      });
    });
  };
  try {
    const json = await api.call("get_covers", batch.map((r) => r.path), 320);
    const covers = JSON.parse(json || "{}");
    for (const [p, b64] of Object.entries(covers)) {
      document.querySelectorAll(".ms-img").forEach((img) => {
        if (img.dataset.path === p) {
          const w = img.closest(".ms-img-wrap");
          img.onload = () => { if (w) w.dataset.ph = "ok"; };
          img.onerror = () => { if (w) w.dataset.ph = "fail"; };
          img.src = "data:image/jpeg;base64," + b64;
        }
      });
    }
    _markBatch(batch.filter((r) => !covers[r.path]).map((r) => r.path), "none");
  } catch (e) {
    _markBatch(batch.map((r) => r.path), "fail");     // 拉取失败：统一显示"封面加载失败"
  }
  loadMasonryThumbs(start + 40);
}
$("#mmViewToggle").addEventListener("click", () => {
  state.mmView = state.mmView === "masonry" ? "list" : "masonry";
  $("#mmViewToggle").textContent = state.mmView === "masonry" ? "列表视图" : "瀑布流";
  try { syncViewSeg(); } catch (e) { /* 忽略 */ }
  renderMm();
});
// 瀑布流：单击卡片打开详情；勾选走卡片角标按钮
$("#mmMasonry").addEventListener("click", (e) => {
  const chk = e.target.closest(".ms-check");
  if (chk) {
    const card = chk.closest(".ms-card");
    const r = card && state.display[Number(card.dataset.idx)];
    if (!r) return;
    if (state.mmChecked.has(r.path)) state.mmChecked.delete(r.path);
    else state.mmChecked.add(r.path);
    chk.innerHTML = state.mmChecked.has(r.path) ? '<span class="cbox on"></span>' : '<span class="cbox"></span>';
    card.classList.toggle("checked", state.mmChecked.has(r.path));
    $("#mmCheckLabel").textContent = "已勾选 " + state.mmChecked.size + " 个";
    return;
  }
  const card = e.target.closest(".ms-card");
  if (!card) return;
  const p = card.dataset.path;
  const cardChk = card.querySelector(".ms-check");
  if (state.mmChecked.has(p)) state.mmChecked.delete(p);
  else state.mmChecked.add(p);
  card.classList.toggle("checked", state.mmChecked.has(p));
  if (cardChk) cardChk.innerHTML = state.mmChecked.has(p) ? '<span class="cbox on"></span>' : '<span class="cbox"></span>';
  $("#mmCheckLabel").textContent = "已勾选 " + state.mmChecked.size + " 个";
});
$("#mmMasonry").addEventListener("contextmenu", (e) => {
  const card = e.target.closest(".ms-card");
  if (!card) return;
  e.preventDefault();
  ctxRow = state.display.find((r2) => r2.path === card.dataset.path) || null;
  if (!ctxRow) return;
  const menu = $("#ctxMenu");
  const r = ctxRow;
  menu.innerHTML =
    '<div class="ctx-item" data-act="copy_name" data-tip="复制当前本地文件名">复制文件名</div>' +
    '<div class="ctx-item" data-act="copy_cname" data-tip="复制 C 站上的模型名（不改本地文件）">🀄 复制C站模型名</div>' +
    '<div class="ctx-item" data-act="folder" data-tip="打开资源管理器并选中该文件">打开所在文件夹</div>' +
    '<div class="ctx-item" data-act="site" data-tip="在浏览器打开该模型在 C 站的主页">打开C站</div>' +
    '<div class="ctx-item" data-act="rename" data-tip="自定义改名（保留扩展名）">改名</div>' +
    '<div class="ctx-item" data-act="rename_c" data-tip="把本地文件名改成 C 站上的模型名（只改本地文件）">文件名改成C站名</div>' +
    '<div class="ctx-item" data-act="sdjson" data-tip="生成 WebUI 能识别的「模型名.json」元数据文件">生成SD可读json</div>' +
    '<div class="ctx-item" data-act="localize" data-tip="把本地文件名翻译成中文">🀄 文件名翻中文</div>' +
    '<div class="ctx-item" data-act="rp" data-tip="从 C 站匹配该模型的名字/触发词/封面">识别模型信息</div>' +
    '<div class="ctx-item" data-act="organize" data-tip="把该模型移动到分类文件夹（需先在设置选 目标环境）">整理模型</div>' +
    '<hr class="ctx-sep"/>' +
    '<div class="ctx-item danger" data-act="del" data-tip="把该模型文件移入回收站（可还原）">移入回收站</div>';
  menu.style.display = "block";
  const zf = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const mw = 200, mh = 280;
  // 迭代校正：反复对比实际渲染位置与鼠标位置，最多 4 次收敛
  menu.style.left = (e.clientX / zf) + "px";
  menu.style.top = (e.clientY / zf) + "px";
  for (let k = 0; k < 4; k++) {
    const got = menu.getBoundingClientRect();
    const dx = e.clientX - got.left;
    const dy = e.clientY - got.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    menu.style.left = (parseFloat(menu.style.left) + dx) + "px";
    menu.style.top = (parseFloat(menu.style.top) + dy) + "px";
  }
  // 边缘限制
  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - mr.width) + "px";
  if (mr.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - mr.height) + "px";
  // rAF 后再校正一次（布局稳定，防显示瞬间读到旧位置）
  requestAnimationFrame(() => {
    for (let k = 0; k < 3; k++) {
      const got = menu.getBoundingClientRect();
      const dx = e.clientX - got.left;
      const dy = e.clientY - got.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
      menu.style.left = (parseFloat(menu.style.left) + dx) + "px";
      menu.style.top = (parseFloat(menu.style.top) + dy) + "px";
    }
    const mr2 = menu.getBoundingClientRect();
    if (mr2.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - mr2.width) + "px";
    if (mr2.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - mr2.height) + "px";
  });
});

// 列表：单击行 = 勾选（shift 范围多选，ctrl 加选）；双击打开详情
$("#mmTable tbody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const path = tr.dataset.path;
  const idx = Number(tr.dataset.idx);
  let targets = [path];
  if (e.shiftKey) {
    const base = state.mmLastSel >= 0 ? state.mmLastSel : 0;
    const a = Math.min(base, idx), b = Math.max(base, idx);
    targets = state.display.slice(a, b + 1).map((r) => r.path);
  } else if (e.ctrlKey || e.metaKey) {
    // ctrl 单击：单独切换当前行
    const cur = state.mmChecked.has(path);
    cur ? state.mmChecked.delete(path) : state.mmChecked.add(path);
    state.mmLastSel = idx;
    targets.forEach((p) => {
      const tr2 = document.querySelector('#mmTable tbody tr[data-path="' + CSS.escape(p) + '"]');
      if (tr2) tr2.classList.toggle("sel-row", state.mmChecked.has(p));
    });
    state.mmSel = new Set(state.mmChecked);
    $("#mmCheckLabel").textContent = "已勾选 " + state.mmChecked.size + " 个";
    return;
  }
  const allChecked = targets.every((p) => state.mmChecked.has(p));
  targets.forEach((p) => allChecked ? state.mmChecked.delete(p) : state.mmChecked.add(p));
  state.mmLastSel = idx;
  targets.forEach((p) => {
    const tr2 = document.querySelector('#mmTable tbody tr[data-path="' + CSS.escape(p) + '"]');
    if (tr2) {
      tr2.classList.toggle("sel-row", state.mmChecked.has(p));
      const cell2 = tr2.querySelector(".cell-sel");
      if (cell2) cell2.innerHTML = state.mmChecked.has(p) ? '<span class="cbox on"></span>' : '<span class="cbox"></span>';
    }
  });
  state.mmSel = new Set(state.mmChecked);
  $("#mmCheckLabel").textContent = "已勾选 " + state.mmChecked.size + " 个";
});

// 筛选
let mmFilterTimer = null;
// 统一过滤：关键词 + 「只看有更新」
function applyMmFilter() {
  const kw = $("#mmFilter").value.trim().toLowerCase();
  let rows = state.models;
  if (state.mmUpdOnly) rows = rows.filter((r) => r.upd && r.upd.has_update);
  if (kw) {
    rows = rows.filter((r) =>
      (r.name || "").toLowerCase().includes(kw) ||
      (r.civitai_name || "").toLowerCase().includes(kw) ||
      (r.path || "").toLowerCase().includes(kw));
  }
  if (state.mmFolderF) {
    // 相对文件夹路径（Lora/风格）对绝对模型路径做"目录段"匹配；统一斜杠与大小写
    const _fp = String(state.mmFolderF).toLowerCase().replace(/^[\/]+|[\/]+$/g, "");
    rows = rows.filter((r) => {
      const p2 = String(r.path || "").replace(/\\/g, "/").toLowerCase();
      return p2.indexOf("/" + _fp + "/") >= 0 || p2.indexOf("/" + _fp) === p2.length - _fp.length - 1;
    });
  }
  if (state.mmBaseF) rows = rows.filter((r) => String(r.base || "") === state.mmBaseF);
  if (state.mmStF) {
    rows = rows.filter((r) => {
      const u = r.upd || {};
      const st = u.has_update ? "upd" : (r.upd ? (u.other_base ? "other" : "latest") : "none");
      return st === state.mmStF;
    });
  }
  state.display = rows.slice();
  renderMm();
  fillMmBaseOptions();
  fillMmFolderOptions();
  if (state.mmUpdOnly) setStatus("筛选：有更新的模型 " + state.display.length + " 个（点「有更新」可取消）");
}
$("#mmFilter").addEventListener("input", () => {
  clearTimeout(mmFilterTimer);
  mmFilterTimer = setTimeout(applyMmFilter, 200);
});
$("#mmFilterClear").addEventListener("click", () => { $("#mmFilter").value = ""; applyMmFilter(); });
if ($("#mmUpdOnly")) $("#mmUpdOnly").addEventListener("click", () => {
  state.mmUpdOnly = !state.mmUpdOnly;
  $("#mmUpdOnly").classList.toggle("active", !!state.mmUpdOnly);
  applyMmFilter();
});

// ===== 更新检测：按钮 + 徽标 =====
function updTip(u) {
  if (!u) return "";
  const parts = ["有新版"];
  if (u.latest_name) parts.push(u.latest_name);
  if (u.latest_base) parts.push("（" + u.latest_base + "）");
  if (u.behind > 1) parts.push("· 落后 " + u.behind + " 个版本");
  parts.push("· 点击去 C 站看新版（不会自动下载）");
  return parts.join(" ");
}
function applyUpdatesToRows(items) {
  if (!items) return;
  state.mmUpdItems = items;          // 供「更新」页面使用
  for (const r of state.models) {
    const it = items[r.path];
    r.upd = it || null;
  }
}
async function mmCheckUpdatesFlow(force, paths) {
  const r = await api.call("mm_check_updates", !!force, (paths && paths.length) ? paths : null);
  if (!r || !r.started) {
    if (r && r.recent) {
      const ok = await confirmBox(r.msg + "<br/><br/>要现在强制重新检查一遍吗？<br/>（约 200 个模型，需要 1~2 分钟）");
      if (ok) return mmCheckUpdatesFlow(true);
    } else {
      setStatus((r && r.msg) || "检查更新未开始");
    }
    return;
  }
  setStatus("检查更新中 0/" + (r.total || "?") + " …");
  const timer = setInterval(async () => {
    const p = await api.call("get_mm_update_state");
    if (!p) return;
    if (p.running) {
      setStatus("检查更新中 " + (p.done || 0) + "/" + (p.total || 0) + " · 已发现 " + (p.newer || 0) + " 个有更新（再点一次按钮可停止）");
      ["#updCheck", "#mmCheckUpd"].forEach((sel) => {
        const b = $(sel);
        if (b) { b.textContent = "停止检查（" + (p.done || 0) + "/" + (p.total || 0) + "）"; b.classList.add("is-busy"); }
      });
      return;
    }
    clearInterval(timer);
    ["#updCheck", "#mmCheckUpd"].forEach((sel) => {
      const b = $(sel);
      if (b) { b.textContent = "检查更新"; b.classList.remove("is-busy"); }
    });
    const wlSkip = p.wl_skipped ? "（已按白名单跳过 " + p.wl_skipped + " 个）" : "";
    setStatus((p.msg || "检查完成") + wlSkip);
    try {
      const u = await api.call("get_model_updates");
      if (u && u.items) {
        applyUpdatesToRows(u.items);
        state.mmUpdCheckedAt = u.checked_at || 0;
        if (state.models.length) applyMmFilter();
        if ($("#page-updates") && $("#page-updates").classList.contains("active")) {
          renderUpdatesPage();                    // 正在「更新」页面 → 直接刷新列表
        } else {
          showUpdateResults(u.items);             // 其它页面 → 弹结果窗
        }
      }
    } catch (e) { /* 忽略 */ }
  }, 800);
}

// 检查更新结果窗口：列出「有同底模新版」的模型，每条可去 C 站
// ================= 更新页面（紧凑数据表 + 版本下拉 / 批量更新 / 白名单） =================
function _updBase(p) { return String(p || "").replace(/\\/g, "/").split("/").pop() || ""; }
function _updDir(p) { const a = String(p || "").replace(/\\/g, "/").split("/"); a.pop(); return a.join("/"); }

// 语义化版本比较：v1 < v1.1 < v1.2 < v1.10 < v2（绝不按字符串序排）
function _verKey(name) {
  const parts = String(name || "").match(/\d+|[A-Za-z]+/g) || [];
  return parts.slice(0, 10).map((p) => (/^\d+$/.test(p) ? [0, Number(p), ""] : [1, 0, p.toLowerCase()]));
}
function _verCmp(a, b) {
  const ka = _verKey(a), kb = _verKey(b);
  const n = Math.max(ka.length, kb.length);
  for (let i = 0; i < n; i++) {
    const x = ka[i] || [-1, 0, ""], y = kb[i] || [-1, 0, ""];   // 段数少的（v1）排在前（v1 < v1.1）
    if (x[0] !== y[0]) return x[0] - y[0];
    if (x[1] !== y[1]) return x[1] - y[1];
    if (x[2] !== y[2]) return x[2] < y[2] ? -1 : 1;
  }
  return 0;
}

function _updState(it) {
  if (it && it.has_update) return { k: "upd", t: _icon("alert") + "有更新", cls: "green" };
  if (it && it.other_base) return { k: "other", t: _icon("layers") + "仅换底模", cls: "mut" };
  if (it && it.unknown) return { k: "unknown", t: _icon("info") + "无法判定", cls: "gray" };
  if (it && !it.checked_at) return { k: "todo", t: _icon("info") + "未检查", cls: "gray" };
  return { k: "latest", t: _icon("check") + "已是最新", cls: "blue" };
}

// 更新页状态选项卡：与列表徽章共用同一套状态色令牌；再点当前项 = 取消筛选
const UPD_ST_DEF = [["", "全部"], ["upd", "有更新"], ["latest", "已是最新"], ["other", "仅换底模"], ["unknown", "无法判定"], ["todo", "未检查"]];
function renderUpdTabs(baseRows) {
  const host = $("#updTabs");
  if (!host) return;
  const cnt = { "": (baseRows || []).length };
  (baseRows || []).forEach((x) => { const k = _updState(x.it).k; cnt[k] = (cnt[k] || 0) + 1; });
  host.innerHTML = UPD_ST_DEF.map(([k, t]) => {
    const on = state.updState === k ? " on" : "";
    const dot = k ? '<span class="dot ' + k + '"></span>' : "";
    return '<button type="button" class="upd-tab' + on + '" data-st="' + k + '" role="tab" aria-selected="' + (on ? "true" : "false") + '">' +
      dot + t + ' <span class="n">' + (cnt[k] || 0) + "</span></button>";
  }).join("");
  host.querySelectorAll(".upd-tab").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.st || "";
    state.updState = (state.updState === k) ? "" : k;   // 再点当前筛选 = 取消
    state.updPage = 1;
    renderUpdatesPage();
  }));
}

// 该行的「可选版本」清单：优先用后端 ver_list（含当前/推荐），老缓存退化到只知最新版
function _updVers(x) {
  const it = x.it || {};
  let vl = (it.ver_list || []).slice();
  if (!vl.length && it.has_update) {
    vl = [{ id: String(it.latest_version || ""), name: it.latest_name || ("ID " + (it.latest_version || "?")),
            date: String(it.latest_date || "").slice(0, 10), current: false }];
  }
  vl.sort((a, b) => _verCmp(b.name, a.name));          // 语义化倒序：v3, v1.1, v1, v0.9
  const rec = it.has_update ? String(it.latest_version || "") : "";
  return { list: vl, rec };
}

// 版本选择控件：Metro 直角按钮 + 门户菜单（列出全部同底模版本）
function vselHtml(x, list, rec, sel, selEntry) {
  const cur = String(x.path);
  const label = selEntry ? ((String(selEntry.id) === String(rec) ? '<span class="v-star">★</span> ' : "") + esc(selEntry.name || sel)) : "选择版本";
  const items = list.map((v) => {
    const isRec = String(v.id) === String(rec);
    const isCur = !!v.current;
    return '<div class="vitem' + (String(v.id) === String(sel) ? " on" : "") + '" data-vpath="' + esc(cur) + '" data-vid="' + esc(v.id) + '">' +
      '<span class="v-name">' + (isRec ? '<span class="v-star">★</span> ' : "") + esc(v.name || ("ID " + v.id)) +
      (isCur ? '<span class="v-cur">当前版本</span>' : "") + "</span>" +
      '<span class="v-date">' + esc(String(v.date || "").slice(0, 10)) + "</span></div>";
  }).join("");
  const site = x.it && x.it.url
    ? '<div class="mm-sep-h"></div><div class="vitem vopen" data-vsite="' + esc(x.it.url) + '">打开 C 站查看全部版本 →</div>'
    : "";
  return '<span class="btn-group vsel-wrap">' +
    '<button class="btn vsel-btn" data-vsel="' + esc(cur) + '" data-tip="选择要更新到的版本（推荐版本默认选中）">' +
    '<span class="vsel-label">' + label + '</span>' + _icon("chevron-down") + "</button>" +
    '<div class="mm-menu vmenu">' + items + site + "</div></span>";
}

function _updRowHtml(x) {
  const it = x.it || {};
  const st = _updState(it);
  const isUpd = !!it.has_update;
  const { list, rec } = _updVers(x);
  const sel = state.updPick[x.path] || rec || (list.length ? String(list[0].id) : "");
  const selEntry = list.find((v) => String(v.id) === String(sel)) || null;
  const curName = it.local_name || "";
  const date = String(it.latest_date || it.local_date || "").slice(0, 10);

  // 版本清单直接由 vselHtml() 渲染（自定义门户菜单，列出全部版本）

  // 降级判断：选中的版本比当前版本旧（按发布日期；没有日期就用语义化版本名兜底）
  const curEntry = list.find((v) => v.current) || null;
  const selIsCurrent = !!(selEntry && selEntry.current);
  let isDown = false;
  if (selEntry && !selIsCurrent) {
    const sd = selEntry.date || "", cd = (curEntry && curEntry.date) || "";
    if (sd && cd) isDown = sd < cd;
    else if (selEntry.name && curName) isDown = _verCmp(selEntry.name, curName) < 0;
  }
  const actLabel = isDown ? "降级到 " + esc((selEntry && selEntry.name) || sel) : "更新到 " + esc((selEntry && selEntry.name) || "最新");
  const actTip = isDown
    ? "回退到这一版（比你当前用的旧）：新版会下到旧版所在文件夹；当前这份文件保留或删除由设置决定"
    : "下载这一版到旧版所在文件夹；旧版保留或删除由设置决定";
  return '<tr class="' + (state.updSel.has(x.path) ? "is-sel" : "") + (isUpd ? "" : " is-flat") + '" data-path="' + esc(x.path) + '" data-mid="' + esc(it.model_id || "") +
    '" data-mname="' + esc(it.model_name || "") + '">' +
    '<td class="c-ck"><input type="checkbox" class="upd-cb" data-path="' + esc(x.path) + '"' + (state.updSel.has(x.path) ? " checked" : "") + "/></td>" +
    '<td class="c-info"><div class="upd-info">' +
      '<img class="dd-thumb upd-thumb" data-path="' + esc(x.path) + '" alt=""/>' +
      '<div class="upd-meta">' +
        '<div class="upd-nm" data-tip="' + esc(it.model_name || _updBase(x.path)) + '">' + esc(it.model_name || _updBase(x.path)) + "</div>" +
        '<div class="upd-sub2">' + (it.author ? "作者：" + esc(it.author) + " ｜ " : "") + (it.local_base ? "底模：" + esc(it.local_base) : "") + (it.model_type ? " ｜ " + esc(it.model_type) : "") + "</div>" +
        '<div class="upd-sub2 upd-dim" data-tip="' + esc(x.path) + '">' + esc(_updBase(x.path)) + " ｜ " + esc(_updDir(x.path)) + "</div>" +
      "</div></div></td>" +
    '<td class="c-cur"><span class="ver-badge" data-tip="' + esc(it.local_name || "") + '">' + esc(curName || "未知") + "</span>" +
      (!curName && it.local_version ? '<div class="upd-dim upd-id">ID ' + esc(it.local_version) + "</div>" : "") + "</td>" +
    '<td class="c-ver">' + (list.length ? vselHtml(x, list, rec, sel, selEntry) : '<span class="upd-dim">—</span>') + "</td>" +
    '<td class="c-date">' + esc(date || "—") + "</td>" +
    '<td class="c-st"><span class="st-badge ' + st.cls + '">' + st.t + "</span></td>" +
    '<td class="c-act"><div class="upd-acts2">' +
      ((!selIsCurrent && sel) ? '<button class="btn btn-tiny upd-go' + (isDown ? " is-down" : " btn-primary") + '" data-path="' + esc(x.path) + '" data-vid="' + esc(sel) + '" data-tip="' + actTip + '">' + actLabel + "</button>" : "") +
      (it.url ? '<a href="#" class="dd-link upd-site" data-url="' + esc(it.url) + '" data-tip="在浏览器打开 C 站页面">C 站</a>' : "") +
      '<button class="icon-btn upd-more" data-path="' + esc(x.path) + '" data-tip="更多：打开文件夹 / 复制路径 / 不再提醒">···</button>' +
    "</div></td></tr>";
}

function _updFilterRows() {
  const items = state.mmUpdItems || {};
  const union = Object.assign({}, items);
  for (const r of (state.models || [])) {         // 扫到、有 C 站信息、但还没检查过的 → 补一条「未检查」行
    if (r && r.path && r.modelId && !union[r.path]) {
      union[r.path] = { model_name: r.civitai_name || "", local_name: r.versionName || "",
                        local_base: r.base || "", model_type: r.type || "", author: r.author || "" };
    }
  }
  let rows = Object.entries(union).map(([path, it]) => ({ path, it: it || {} }));
  const q = String(state.updQ || "").trim().toLowerCase();
  if (state.updBase) rows = rows.filter((x) => String(x.it.local_base || "") === state.updBase);
  if (q) rows = rows.filter((x) => ((x.it.model_name || "") + " " + x.path + " " + (x.it.local_name || "") + " " + (x.it.author || "")).toLowerCase().includes(q));
  renderUpdTabs(rows);                                                    // 计数：底模/搜索过滤后、状态过滤前的行
  if (state.updState) rows = rows.filter((x) => _updState(x.it).k === state.updState);
  const sk = state.updSortKey || "date";
  const rev = !!state.updSortRev;
  // 各列默认方向：date/ver 默认"新的多者在前"(降序)，其余默认升序
  // 说明：比较器一律按升序写，rev=true 时才 reverse()
  const ST_RANK = { upd: 0, other: 1, unknown: 2, todo: 3, latest: 4 };   // 有更新在前
  const cmp = (a, b) => {
    if (sk === "name") {
      const x = String(a.it.model_name || _updBase(a.path)), y = String(b.it.model_name || _updBase(b.path));
      return x.localeCompare(y, "zh") || String(a.path).localeCompare(b.path);
    }
    if (sk === "cur") {
      return _verCmp(String(a.it.local_name || ""), String(b.it.local_name || "")) || String(a.path).localeCompare(b.path);
    }
    if (sk === "ver") {
      const x = (a.it.ver_list || []).length, y = (b.it.ver_list || []).length;
      return (x - y) || String(a.path).localeCompare(b.path);          // 升序；"多的在前"是默认方向(rev)
    }
    if (sk === "state") {
      return (ST_RANK[_updState(a.it).k] ?? 9) - (ST_RANK[_updState(b.it).k] ?? 9)
        || String(a.path).localeCompare(b.path);
    }
    const x = String(a.it.latest_date || a.it.local_date || ""), y = String(b.it.latest_date || b.it.local_date || "");
    return x.localeCompare(y) || String(a.path).localeCompare(b.path);  // 升序；"新的在前"是默认方向(rev)
  };
  rows.sort(cmp);
  if (rev) rows.reverse();
  return rows;
}

function _updPagerHtml(pages, page) {
  if (pages <= 1) return "";
  const btn = (p, label, dis) => '<button class="pg' + (p === page ? " on" : "") + '" data-p="' + p + '"' + (dis ? " disabled" : "") + ">" + label + "</button>";
  const out = [btn(page - 1, "‹", page <= 1)];
  const win = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) win.push(p);
    else if (win[win.length - 1] !== "…") win.push("…");
  }
  win.forEach((p) => { out.push(p === "…" ? '<span class="pg-dot">…</span>' : btn(p, p, false)); });
  out.push(btn(page + 1, "›", page >= pages));
  return out.join("");
}

async function renderUpdatesPage() {
  const tbody = $("#updTbody");
  if (!tbody) return;
  if (!state.mmUpdItems) {
    try {
      const u = await api.call("get_model_updates");
      if (u && u.items) { applyUpdatesToRows(u.items); state.mmUpdCheckedAt = u.checked_at || 0; }
    } catch (e) { /* 忽略 */ }
  }
  const items = state.mmUpdItems || {};
  const all = _updFilterRows();
  const per = Number(state.updPer || 50);
  const pages = Math.max(1, Math.ceil(all.length / per));
  state.updPage = Math.min(Math.max(1, state.updPage || 1), pages);
  const pageRows = all.slice((state.updPage - 1) * per, state.updPage * per);

  // 底模下拉
  const bases = Array.from(new Set(Object.values(items).map((it) => String((it || {}).local_base || "")).filter(Boolean))).sort();
  const bsel = $("#updBase");
  if (bsel) bsel.innerHTML = '<option value="">全部底模</option>' + bases.map((b) => '<option value="' + esc(b) + '"' + (b === state.updBase ? " selected" : "") + ">" + esc(b) + "</option>").join("");

  // 顶部统计
  const nUpd = Object.values(items).filter((it) => it && it.has_update).length;
  const ca = state.mmUpdCheckedAt ? new Date(state.mmUpdCheckedAt * 1000).toLocaleString() : "还没检查过";
  const cnt = $("#updCount");
  if (cnt) cnt.innerHTML = "可更新 <b class=\"warn\">" + nUpd + "</b> ｜ 共 " + Object.keys(items).length + " 个 ｜ 上次检查 " + esc(ca);

  // 表体 + 空态
  const empty = $("#updEmpty");
  if (!all.length) {
    tbody.innerHTML = "";
    if (empty) {
      empty.style.display = "block";
      empty.innerHTML = Object.keys(items).length
        ? "当前筛选/搜索下没有条目（清空搜索框或把筛选改回「全部」）。"
        : "还没有检查结果：点右上角「检查更新」开始（首次约 1~2 分钟，结果缓存 24 小时）。";
    }
  } else {
    if (empty) empty.style.display = "none";
    tbody.innerHTML = pageRows.map(_updRowHtml).join("");
    loadDdThumbs(tbody, pageRows.map((x) => x.path), 64);
  }

  // 表头排序指示
  try {
    const sk2 = state.updSortKey || "date", rv = !!state.updSortRev;
    document.querySelectorAll("#updTable thead th.sortable").forEach((th) => {
      const on = th.dataset.key === sk2;
      th.classList.toggle("on", on);
      const sp = th.querySelector(".th-sort");
      if (sp) sp.textContent = on ? (rv ? " ▼" : " ▲") : "";
    });
    const sel = $("#updSort");
    if (sel) {
      const map = { date: "date", name: "name", state: "state" };
      if (map[sk2]) sel.value = map[sk2];
    }
  } catch (e) { /* 忽略 */ }

  // 底栏
  const st1 = $("#updStat");
  if (st1) st1.textContent = "共 " + all.length + " 个模型" + (all.length !== Object.keys(items).length ? "（筛选中，总 " + Object.keys(items).length + "）" : "");
  _updSyncSel();
  const pg = $("#updPager");
  if (pg) pg.innerHTML = _updPagerHtml(pages, state.updPage);
  _updBind(tbody);
}

function _updSyncSel() {
  const n = state.updSel.size;
  const el = $("#updSelInfo");
  if (el) el.innerHTML = "已选 <b>" + n + "</b> 个";
  const b = $("#updDlSel");
  if (b) { b.textContent = n ? "批量更新（" + n + "）" : "批量更新"; b.disabled = !n; }
  const allCk = $("#updAll");
  if (allCk) {
    const boxes = Array.from(document.querySelectorAll("#updTbody .upd-cb"));
    const on = boxes.filter((c) => c.checked).length;
    allCk.checked = boxes.length > 0 && on === boxes.length;
    allCk.indeterminate = on > 0 && on < boxes.length;
  }
}

// 下拉换版本时实时重算按钮：更新到 X / 降级到 X；选回当前版本则隐藏按钮
function _updSyncRowButton(tr, path, vid) {
  const it = (state.mmUpdItems || {})[path] || {};
  const { list } = _updVers({ path, it });
  const e = list.find((x) => String(x.id) === String(vid)) || null;
  const cur = list.find((x) => x.current) || null;
  const isCur = !!(e && e.current);
  let isDown = false;
  if (e && !isCur) {
    const sd = e.date || "", cd = (cur && cur.date) || "";
    if (sd && cd) isDown = sd < cd;
    else if (e.name && it.local_name) isDown = _verCmp(e.name, it.local_name) < 0;
  }
  let btn = tr.querySelector(".upd-go");
  if (isCur || !e) { if (btn) btn.remove(); return; }
  if (!btn) {
    const acts = tr.querySelector(".upd-acts2");
    if (!acts) return;
    btn = document.createElement("button");
    btn.className = "btn btn-tiny upd-go";
    btn.dataset.path = path;
    acts.insertBefore(btn, acts.firstChild);
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const oldTxt = btn.textContent;
      btn.disabled = true;
      btn.textContent = "加入队列…";
      const r = await api.call("mm_download_version", btn.dataset.path, btn.dataset.vid);
      btn.textContent = (r && r.ok) ? "已加入" : ((r && r.msg) || "失败");
      setStatus((r && r.msg) || "");
      setTimeout(() => { btn.disabled = false; btn.textContent = oldTxt; }, 1800);
    });
  }
  btn.dataset.vid = vid;
  btn.textContent = isDown ? "降级到 " + ((e.name) || vid) : "更新到 " + ((e.name) || vid);
  btn.classList.toggle("is-down", isDown);
  btn.classList.toggle("btn-primary", !isDown);
}

function _updBind(tbody) {
  tbody.querySelectorAll(".upd-cb").forEach((cb) => cb.addEventListener("change", () => {
    const p = cb.dataset.path;
    if (cb.checked) state.updSel.add(p); else state.updSel.delete(p);
    const tr = cb.closest("tr");
    if (tr) tr.classList.toggle("is-sel", cb.checked);
    _updSyncSel();
  }));
  tbody.querySelectorAll(".upd-vsel").forEach((sel) => sel.addEventListener("change", () => {
    const p = sel.dataset.path;
    const it = (state.mmUpdItems || {})[p] || {};
    const v = sel.value;
    if (v === "__site") {
      api.call("open_url", it.url || "");
      sel.value = state.updPick[p] || String(it.latest_version || "");
      return;
    }
    state.updPick[p] = v;
    const tr2 = sel.closest("tr");
    if (tr2) _updSyncRowButton(tr2, p, v);
  }));
  tbody.querySelectorAll(".upd-go").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const old = b.textContent;
    b.disabled = true;
    b.textContent = "加入队列…";
    const r = await api.call("mm_download_version", b.dataset.path, b.dataset.vid);
    b.textContent = (r && r.ok) ? "已加入" : ((r && r.msg) || "失败");
    setStatus((r && r.msg) || "");
    setTimeout(() => { b.disabled = false; b.textContent = old; }, 1800);
  }));
  tbody.querySelectorAll(".chip-go, .upd-site").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    if (a.dataset.url) api.call("open_url", a.dataset.url);
  }));
  tbody.querySelectorAll(".upd-more").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    _updCtxMenu(b.dataset.path, b);
  }));
  tbody.querySelectorAll("tr").forEach((tr) => tr.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    _updCtxMenu(tr.dataset.path, null, e.clientX, e.clientY);
  }));
}

function _updCtxMenu(path, anchor, cx, cy) {
  const it = (state.mmUpdItems || {})[path] || {};
  state.updCtxPath = path;
  const menu = $("#ctxMenu");
  menu.innerHTML =
    (it.has_update ? '<div class="ctx-item" data-act="upd_dl" data-tip="把下拉里选中的版本加入下载队列">更新到选中版本</div>' : "") +
    (it.has_update ? '<div class="ctx-item" data-act="upd_wl" data-tip="以后不再提示这个模型的更新（按模型记入白名单）">不再提醒更新（加入白名单）</div>' : "") +
    (it.url ? '<div class="ctx-item" data-act="upd_site2" data-tip="在浏览器打开 C 站页面">打开 C 站页面</div>' : "") +
    '<div class="ctx-item" data-act="upd_folder" data-tip="打开资源管理器并选中该文件">打开所在文件夹</div>' +
    '<div class="ctx-item" data-act="upd_copy" data-tip="复制文件完整路径">复制文件路径</div>';
  menu.style.display = "block";
  const zf = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    menu.style.left = (r.left / zf) + "px";
    menu.style.top = ((r.bottom + 4) / zf) + "px";
  } else {
    menu.style.left = ((cx || 0) / zf) + "px";
    menu.style.top = ((cy || 0) / zf) + "px";
  }
  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - mr.width) + "px";
  if (mr.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - mr.height) + "px";
}

$("#ctxMenu").addEventListener("click", async (e) => {
  const item = e.target.closest("[data-act^=upd_]");
  if (!item) return;
  $("#ctxMenu").style.display = "none";
  const p = state.updCtxPath || "";
  const it = (state.mmUpdItems || {})[p] || {};
  const act = item.dataset.act;
  if (act === "upd_dl") {
    const { rec } = _updVers({ path: p, it });
    const vid = state.updPick[p] || rec;
    const r = await api.call("mm_download_version", p, vid);
    setStatus((r && r.msg) || "");
  } else if (act === "upd_wl") {
    const r = await api.call("add_update_whitelist", it.model_id || "", it.model_name || "");
    setStatus((r && r.msg) || "已加入白名单");
    if (state.mmUpdItems) delete state.mmUpdItems[p];
    state.updSel.delete(p);
    for (const rw of state.models) if (rw.path === p) rw.upd = null;
    renderUpdatesPage();
    renderMm();
  } else if (act === "upd_site2") { if (it.url) api.call("open_url", it.url); }
  else if (act === "upd_folder") {
    const r = JSON.parse(await api.call("open_in_folder", p) || "{}");
    setStatus((r && r.ok) ? "已打开所在文件夹" : ((r && r.msg) || "文件不存在或已被移动"));
  } else if (act === "upd_copy") {
    await window.__copyText(p);
    setStatus("路径已复制: " + p);
  }
});

// 批量更新：逐条按各自下拉选中的版本入队（每条几百毫秒，带进度）
async function updBatchDownload(paths) {
  const items = state.mmUpdItems || {};
  const picks = [];
  (paths || []).forEach((p) => {
    const it = items[p] || {};
    if (!it.has_update) return;
    const { rec } = _updVers({ path: p, it });
    picks.push({ path: p, vid: state.updPick[p] || rec, name: it.model_name || _updBase(p) });
  });
  if (!picks.length) { setStatus("勾选的条目里没有「有更新」的（先点「检查更新」）"); return; }
  const keepTxt = (state.cfg && state.cfg.update_keep_old === "delete") ? "旧版将移入回收站" : "旧版保留";
  const ok = await confirmBoxRaw(
    "将把以下 <b>" + picks.length + "</b> 个模型更新到各自选择的版本（新版下到旧版所在文件夹）：<br/>" +
    '<div class="dedup-dir" style="max-height:200px;overflow:auto">' +
    picks.slice(0, 40).map((x) => "· " + esc(x.name) + " → " + esc(((_updVers({ path: x.path, it: items[x.path] }).list.find((v) => String(v.id) === String(x.vid)) || {}).name) || x.vid)).join("<br/>") +
    (picks.length > 40 ? "<br/>… 等 " + picks.length + " 个" : "") + "</div>" +
    '<div class="dedup-dir">' + keepTxt + "（设置里可改）。</div>",
    "确认批量更新");
  if (!ok) return;
  if (ok.root) ok.root.remove();          // 关掉确认框（confirmBoxRaw 只收遮罩，内容框要调用方自己收）
  const btn = $("#updDlSel");
  if (state.updBatchBusy) return;
  state.updBatchBusy = true;
  if (btn) btn.disabled = true;
  let done = 0, skip = 0, fail = 0;
  for (const x of picks) {
    setStatus("批量更新 " + (done + skip + fail + 1) + "/" + picks.length + "：" + x.name);
    try {
      const r = await api.call("mm_download_version", x.path, x.vid);
      if (r && r.ok) done++;
      else if (r && r.skipped) skip++;
      else fail++;
    } catch (e) { fail++; }
  }
  state.updBatchBusy = false;
  if (btn) btn.disabled = false;
  setStatus("批量更新完成：入队 " + done + " 个" + (skip ? "，跳过 " + skip + " 个（已在队列或已存在）" : "") +
            (fail ? "，失败 " + fail + " 个" : "") + " —— 已跳到「下载管理」");
  renderUpdatesPage();
  switchPage("dlmanager");                // 自动跳到下载管理页看进度
  if (typeof dlRefresh === "function") dlRefresh();
}

// 批量忽略（加入更新白名单）
async function updBatchIgnore(paths) {
  const items = state.mmUpdItems || {};
  const list = (paths || []).filter((p) => (items[p] || {}).model_id);
  if (!list.length) { setStatus("没有可忽略的条目"); return; }
  const ok = await confirmBoxRaw("把选中的 <b>" + list.length + "</b> 个模型加入<b>更新白名单</b>？<br/>以后检查更新会直接跳过它们（可在「白名单」里移出）。", "不再提醒更新");
  if (!ok) return;
  if (ok.root) ok.root.remove();          // 关掉确认框
  let n = 0;
  for (const p of list) {
    const it = items[p] || {};
    try { await api.call("add_update_whitelist", it.model_id || "", it.model_name || ""); n++; } catch (e) { /* 单个失败继续 */ }
    if (state.mmUpdItems) delete state.mmUpdItems[p];
    state.updSel.delete(p);
  }
  setStatus("已忽略 " + n + " 个模型的更新提醒");
  renderUpdatesPage();
  renderMm();
}

async function updWhitelistDialog() {
  let items = [];
  try {
    const r = await api.call("get_update_whitelist");
    items = ((r && r.items) || []).slice();
  } catch (e) {
    infoBox("<div class='dt-dim'>白名单读取失败：" + esc(String(e)) + "</div>", "更新白名单");
    return;
  }
  const dlg = document.createElement("div");
  dlg.className = "rd-mask";
  const box = document.createElement("div");
  box.className = "rename-dialog";
  box.style.width = "620px";
  const onKey = (e) => { if (e.key === "Escape") closeAll(); };
  const closeAll = () => { document.removeEventListener("keydown", onKey); dlg.remove(); box.remove(); };
  document.addEventListener("keydown", onKey);
  const render = () => {
    box.innerHTML =
      '<div class="rd-title">更新白名单 <span class="dt-dim">（' + items.length + ' 个模型）</span><span class="dlg-x" id="wlX" title="关闭" data-tip="关闭（Esc）">' + _icon("x") + "</span></div>" +
      '<input class="input" id="wlQ" placeholder="搜索模型名称 / modelId…" style="width:100%;margin:6px 0 8px" />' +
      '<div class="dd-hint">名单里的模型<b>不再提示更新</b>（检查时直接跳过）。加入方式：行内「···」→「不再提醒更新」。</div>' +
      '<div style="max-height:320px;overflow:auto">' +
      (items.length ? items.map((x) =>
        '<div class="cf-row" data-name="' + esc(((x.name || "") + " " + x.model_id).toLowerCase()) + '"><div class="dd-text"><b>' + esc(x.name || x.model_id) + "</b>" +
        '<div class="dedup-dir">modelId ' + esc(x.model_id) + '</div></div>' +
        '<button class="btn btn-tiny wl-del" data-mid="' + esc(x.model_id) + '">移出</button></div>').join("")
        : '<div class="upd-empty">白名单是空的。</div>') +
      "</div>" +
      '<div class="rd-actions"><button class="btn" id="wlClose">关闭</button></div>';
    $("#wlClose", box).addEventListener("click", closeAll);
    $("#wlX", box).addEventListener("click", closeAll);
    const qEl = $("#wlQ", box);
    if (qEl) qEl.addEventListener("input", () => {
      const q = qEl.value.trim().toLowerCase();
      box.querySelectorAll('.cf-row[data-name]').forEach((row) => {
        row.style.display = (!q || row.dataset.name.includes(q)) ? "" : "none";
      });
    });
    box.querySelectorAll(".wl-del").forEach((b) => b.addEventListener("click", async () => {
      const rr = await api.call("remove_update_whitelist", b.dataset.mid);
      setStatus((rr && rr.msg) || "已移出");
      const i = items.findIndex((x) => String(x.model_id) === String(b.dataset.mid));
      if (i >= 0) items.splice(i, 1);
      render();
    }));
  };
  render();
  document.body.appendChild(dlg);
  document.body.appendChild(box);
  dlg.addEventListener("click", closeAll);
}

// 工具栏 / 底栏交互（一次性绑定）
if ($("#updCheck")) $("#updCheck").addEventListener("click", async () => {
  const st = await api.call("get_mm_update_state").catch(() => null);
  if (st && st.running) {                       // 正在检查 → 再点一次 = 停止
    const r = await api.call("cancel_mm_op");
    setStatus((r && r.msg) || "已请求停止检查");
    return;
  }
  const sel = [...state.updSel];                // 有勾选 → 只检查勾选的这几个
  if (sel.length) { setStatus("只检查勾选的 " + sel.length + " 个模型…"); mmCheckUpdatesFlow(true, sel); return; }
  mmCheckUpdatesFlow(false);
});
if ($("#updWl")) $("#updWl").addEventListener("click", updWhitelistDialog);
if ($("#updDlSel")) $("#updDlSel").addEventListener("click", () => updBatchDownload([...state.updSel]));
if ($("#updAll")) $("#updAll").addEventListener("change", (e) => {
  const on = e.target.checked;
  document.querySelectorAll("#updTbody .upd-cb").forEach((cb) => {
    cb.checked = on;
    const p = cb.dataset.path;
    if (on) state.updSel.add(p); else state.updSel.delete(p);
    const tr = cb.closest("tr");
    if (tr) tr.classList.toggle("is-sel", on);
  });
  _updSyncSel();
});
if ($("#updSearch")) {
  let tmr = null;
  $("#updSearch").addEventListener("input", (e) => {
    clearTimeout(tmr);
    const v = e.target.value;
    tmr = setTimeout(() => { state.updQ = v; state.updPage = 1; renderUpdatesPage(); }, 200);
  });
}
if ($("#updBase")) $("#updBase").addEventListener("change", (e) => { state.updBase = e.target.value; state.updPage = 1; renderUpdatesPage(); });
// 状态筛选已改为 #updTabs 选项卡（点击逻辑在 renderUpdTabs 内绑定）
if ($("#updSort")) $("#updSort").addEventListener("change", (e) => { state.updSortKey = e.target.value; state.updSortRev = (e.target.value === "date"); state.updPage = 1; renderUpdatesPage(); });   // 下拉只有 时间/名称/状态，方向与表头一致
if ($("#updPer")) $("#updPer").addEventListener("change", (e) => { state.updPer = Number(e.target.value) || 50; state.updPage = 1; renderUpdatesPage(); });
// 表头点击排序：同一列再点一次切换升/降序
(function bindUpdHeaderSort() {
  const thead = document.querySelector("#updTable thead");
  if (!thead) return;
  thead.addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const key = th.dataset.key || "";
    if (!key) return;
    const DEF_REV = { date: true, ver: true };    // 这两列默认"新的/多者在前"
    if (state.updSortKey === key) state.updSortRev = !state.updSortRev;
    else {
      state.updSortKey = key;
      state.updSortRev = !!DEF_REV[key];
    }
    state.updPage = 1;
    renderUpdatesPage();
  });
})();

if ($("#updPager")) $("#updPager").addEventListener("click", (e) => {
  const b = e.target.closest("button.pg");
  if (!b || b.disabled) return;
  state.updPage = Number(b.dataset.p) || 1;
  renderUpdatesPage();
});

// 纯提示弹窗：只有一个「知道了」，点它就关（修"关不掉的弹窗"）
function infoBox(html, title) {
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.style.width = "560px";
  dlg.innerHTML =
    '<div class="rd-title">' + (title || "提示") + '<span class="dlg-x" id="ibX" title="关闭（Esc）">' + _icon("x") + "</span></div>" +
    '<div class="ib-body" style="font-size:13px;color:var(--text);line-height:1.7">' + html + "</div>" +
    '<div class="rd-actions"><button class="btn btn-primary" id="ibOk">知道了</button></div>';
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { document.removeEventListener("keydown", onKey); mask.remove(); dlg.remove(); };
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  document.addEventListener("keydown", onKey);
  mask.addEventListener("click", close);
  const ok = dlg.querySelector("#ibOk");
  if (ok) ok.addEventListener("click", close);
  const bx = dlg.querySelector("#ibX");
  if (bx) bx.addEventListener("click", close);
  mask.addEventListener("click", close);
  return close;
}

async function showUpdateResults(items) {
  const rows = Object.entries(items || {}).filter(([, it]) => it && it.has_update);
  const others = Object.entries(items || {}).filter(([, it]) => it && it.other_base);
  if (!rows.length && !others.length) { setStatus("检查完成：没有发现有更新的模型 "); return; }
  const dlg = document.createElement("div");
  dlg.className = "rd-mask";
  const box = document.createElement("div");
  box.className = "rename-dialog";
  box.style.width = "700px";
  const rowHtml = (r) => {
    const it = r[1];
    const nm = r[0].replace(/\\/g, "/").split("/").pop();
    return '<div class="cf-row"><img class="dd-thumb" data-path="' + esc(r[0]) + '" alt=""/>' +
      '<div class="dd-text"><b>' + esc(nm) + "</b>" +
      (it.has_update
        ? ' <span style="color:var(--warn,#d29922)">有新版</span>'
        : ' <span style="color:var(--text-dim)">换底模（未计入）</span>') +
      '<div class="dedup-dir">你本地：' + esc(it.local_base || "-") + " ｜ " +
      (it.has_update ? "同底模最新：" : "最新版：") + esc(it.latest_base || "-") +
      (it.latest_name ? " · " + esc(it.latest_name) : "") +
      (it.latest_date ? " · " + esc(String(it.latest_date).slice(0, 10)) : "") +
      (it.behind > 1 ? " · 落后 " + it.behind + " 个版本" : "") +
      (it.unknown ? esc(it.msg || "") : "") + "</div>" +
      (it.has_update && (it.newer_list || []).length
        ? '<div class="upd-t3">更新后可用：' + it.newer_list.map((v) =>
            '<span class="upd-chip"><a href="#" class="chip-go" data-url="' + esc(v.url || "") + '">' + esc(v.name || v.id) +
            (v.date ? ' <i>' + esc(v.date) + "</i>" : "") + '</a><a href="#" class="chip-dl" data-path="' + esc(r[0]) +
            '" data-vid="' + esc(v.id) + '" data-tip="只下载这一版"></a></span>').join(" ") + "</div>"
        : "") +
      (it.url ? '<a href="#" class="dd-link" data-url="' + esc(it.url) + '">去 C 站看新版</a>' : "") +
      (it.has_update ? ' <button class="btn btn-tiny upd-one" data-path="' + esc(r[0]) + '">更新</button>' : "") +
      "</div></div>";
  };
  box.innerHTML =
    '<div class="rd-title">检查更新：' + rows.length + " 个模型有同底模新版" + (others.length ? "（另有 " + others.length + " 个只换了底模）" : "") + "</div>" +
    '<div class="dd-hint">只列出「<b>和你所用底模相同</b>」的新版本；换了底模的（如 Anima→Krea）单列在下面，<b>不算更新</b>。' +
    "点 去 C 站看新版，或直接点「更新」把新版加入下载队列；模型列表里这些条目已标 ，可用「有更新」筛选。</div>" +
    '<div style="max-height:360px;overflow:auto">' +
    rows.map(rowHtml).join("") +
    (others.length ? '<div class="dedup-sec">最新版换了底模（仅供参考，未计入更新）</div>' + others.map(rowHtml).join("") : "") +
    "</div>" +
    '<div class="rd-actions">' +
    (rows.length ? '<button class="btn btn-primary" id="updAll">全部更新（' + rows.length + "）</button>" : "") +
    '<button class="btn" id="updClose">关闭</button>' +
    '<button class="btn" id="updFilter">只看这些模型</button></div>';
  document.body.appendChild(dlg);
  document.body.appendChild(box);
  const close = () => { dlg.remove(); box.remove(); };
  dlg.addEventListener("click", close);
  $("#updClose", box).addEventListener("click", close);
  $("#updFilter", box).addEventListener("click", () => {
    close();
    state.mmUpdOnly = true;
    const b = $("#mmUpdOnly");
    if (b) b.classList.add("active");
    applyMmFilter();
    setStatus("已筛选出有更新的模型");
  });
  box.querySelectorAll(".dd-link").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    api.call("open_url", a.dataset.url);
  }));
  box.querySelectorAll(".chip-go").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (a.dataset.url) api.call("open_url", a.dataset.url);
  }));
  box.querySelectorAll(".chip-dl").forEach((a) => a.addEventListener("click", async (e) => {
    e.preventDefault();
    setStatus("正在解析这一版并加入下载队列…");
    const r = await api.call("mm_download_version", a.dataset.path, a.dataset.vid);
    setStatus((r && r.msg) || "完成");
  }));
  const allBtn = $("#updAll", box);
  if (allBtn) allBtn.addEventListener("click", async () => { close(); await mmUpdateFlow(null); });
  box.querySelectorAll(".upd-one").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    b.textContent = "…";
    await mmUpdateFlow([b.dataset.path]);
    b.textContent = "已加入";
    b.disabled = false;
  }));
  loadDdThumbs(box, rows.concat(others).map((r) => r[0]));
}
if ($("#mmCheckUpd")) $("#mmCheckUpd").addEventListener("click", async () => {
  const st = await api.call("get_mm_update_state").catch(() => null);
  if (st && st.running) {
    const r = await api.call("cancel_mm_op");
    setStatus((r && r.msg) || "已请求停止检查");
    return;
  }
  const sel = [...state.mmChecked];             // 勾了模型就只查勾选的
  if (sel.length) { setStatus("只检查勾选的 " + sel.length + " 个模型…"); mmCheckUpdatesFlow(true, sel); return; }
  mmCheckUpdatesFlow(false);
});

// ===== 更新选中：把勾选（或结果窗里指定）的「有新版」模型加入下载队列 =====
async function mmUpdateFlow(paths) {
  const r = await api.call("mm_update_models", paths && paths.length ? paths : null);
  if (!r || !r.ok) { setStatus((r && r.msg) || "没有可更新的模型"); return false; }
  setStatus(r.msg || "开始更新…");
  const timer = setInterval(async () => {
    const p = await api.call("get_mm_progress");
    if (!p) return;
    if (p.running) { setStatus("更新中 " + (p.done || 0) + "/" + (p.total || 0) + (p.msg ? " · " + p.msg : "")); return; }
    clearInterval(timer);
    setStatus(p.msg || "更新完成");
    if (Array.isArray(p.result) && p.result.length) {
      infoBox("<div style='font-size:12px;line-height:1.9'>" +
        p.result.map((f) => "· <b>" + esc(f.file) + "</b>：" + esc(f.msg)).join("<br/>") +
        "</div>", "这些没能加入下载队列");
    }
  }, 800);
  return true;
}
async function mmUpdateSelectedFlow() {
  const paths = state.models.filter((r) => state.mmChecked.has(r.path) && r.upd && r.upd.has_update).map((r) => r.path);
  if (!paths.length) {
    setStatus("没有勾选「有新版」的模型：先点「检查更新」，再用「有更新」筛出来并全选");
    return;
  }
  const ok = await confirmBoxRaw(
    "<div style='font-size:13px;line-height:1.8'>将下载以下 <b>" + paths.length + "</b> 个模型的<b>新版</b>：" +
    "<div style='max-height:200px;overflow:auto;margin-top:6px'>" +
    paths.map((p) => "· " + esc(p.replace(/\\/g, "/").split("/").pop())).join("<br/>") + "</div>" +
    "<div style='font-size:12px;color:var(--text-dim);margin-top:6px'>新版会下到旧版所在文件夹；<b>旧版文件不会被动</b>（要清理可用「查重」的删旧留新）。</div></div>",
    "更新选中的 " + paths.length + " 个模型");
  if (!ok) return;
  if (ok.root) ok.root.remove();
  await mmUpdateFlow(paths);
}
if ($("#openLogs")) $("#openLogs").addEventListener("click", async () => {
  const r = await api.call("open_logs_dir");
  setStatus((r && r.msg) || "已打开日志文件夹");
});

if ($("#mmGoUpdates")) $("#mmGoUpdates").addEventListener("click", () => {
  state.updState = "upd";                 // 默认只看「有更新」
  state.updQ = "";
  state.updPage = 1;
  switchPage("updates");                  // switchPage 内部会调 renderUpdatesPage（含 tabs 刷新）                  // switchPage 内部会调 renderUpdatesPage
});

if ($("#mmUpdDl")) $("#mmUpdDl").addEventListener("click", () => {
  // 模型管理页的「更新选中」：把勾选里有新版的交给新的批量更新流程（版本按更新页每行的下拉选择）
  const paths = state.models.filter((r) => state.mmChecked.has(r.path) && r.upd && r.upd.has_update).map((r) => r.path);
  if (!paths.length) { setStatus("没有勾选「有新版」的模型：先点「检查更新」，再勾选带 的条目"); return; }
  updBatchDownload(paths);
});
// 点卡片/列表里的 → 打开 C 站新版页面（不会下载）
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest(".ms-upd, .mm-upd");
  if (!a) return;
  e.preventDefault();
  e.stopPropagation();
  if (a.dataset.url) {
    api.call("open_url", a.dataset.url);
    setStatus("已打开 C 站新版页面（下载需自己决定）");
  }
}, true);

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
      '<span class="fm-icon">' + "" + "</span>" +
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
    '<div class="fm-title">文件夹显示（点击条目切换）</div>' +
    '<div class="fm-toolbar">' +
    '<button class="btn btn-tiny" id="fmAll">全选</button>' +
    '<button class="btn btn-tiny" id="fmNone">全不选</button></div>' +
    '<div class="fm-item fm-top" data-path="__root__">' +
      '<span class="fm-icon"></span><span class="fm-name">根目录下的模型</span>' +
      '<span class="fm-state ' + (showRoot ? "on" : "off") + '">' + (showRoot ? "显示" : "隐藏") + "</span></div>" +
    '<hr class="fp-sep"/>' +
    fmTreeHtml(foldersState.tree || [], hidden, 0);
}
// 文件夹全选/全不选：隐藏集合整体变更后保存并刷新
function fmSetHidden(nextHidden) {
  foldersState.hidden = nextHidden;
  api.call("save_folders", nextHidden, foldersState.show_root).then(() => {
    fmRender();
    mmScan();
  });
}
$("#mmFoldersPanel").addEventListener("click", (e) => {
  const btn = e.target.closest("#fmAll, #fmNone");
  if (!btn) return;
  if (!foldersState) return;
  const all = [];
  (function walk(nodes) {
    (nodes || []).forEach((n) => {
      all.push(n.path);
      walk(n.children);
    });
  })(foldersState.tree || []);
  if (btn.id === "fmAll") fmSetHidden([]);       // 全部显示
  else fmSetHidden(all);                          // 全部隐藏
});
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

// 模型详情二级界面（C 站风格）
let detailRow = null;
// 详情面板全局状态（document 级图片右键委托需要访问）
let detailImgIdx = 0;
let detailImgLocalPath = null;
// ===== 简介富文本：白名单 sanitize + 纯文本转换（零依赖；不直接 innerHTML 注入 C 站原始 HTML） =====
const DESC_OK_TAGS = { P: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1, S: 1, DEL: 1, INS: 1, UL: 1, OL: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, BLOCKQUOTE: 1, CODE: 1, PRE: 1, A: 1, IMG: 1, HR: 1, SPAN: 1, DIV: 1, FONT: 1, SUB: 1, SUP: 1 };
const DESC_DROP_TAGS = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1, LINK: 1, META: 1, SVG: 1, MATH: 1, VIDEO: 1, AUDIO: 1, SOURCE: 1 };
function sanitizeDescHtml(html) {
  if (!html) return "";
  let doc;
  try { doc = new DOMParser().parseFromString(String(html), "text/html"); } catch (e) { return ""; }
  const body = doc.body;
  if (!body) return "";
  const walk = (node) => {
    Array.from(node.childNodes).forEach((ch) => {
      if (ch.nodeType === 3) return;                       // 纯文本：保留
      if (ch.nodeType !== 1) { ch.remove(); return; }      // 注释/处理指令：丢
      const tag = ch.tagName;
      if (DESC_DROP_TAGS[tag]) { ch.remove(); return; }    // script/iframe/style…：连内容一起丢
      if (!DESC_OK_TAGS[tag]) {
        walk(ch);                                          // 未知标签（如 <section>、<figure>）：原样展开、保留文字
        while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
        ch.remove();
        return;
      }
      Array.from(ch.attributes).forEach((at) => {          // 属性白名单：其余全删（含 style/class/on*）
        const n = at.name.toLowerCase();
        const keep = (tag === "A" && n === "href") || (tag === "IMG" && (n === "src" || n === "alt"));
        if (!keep) ch.removeAttribute(at.name);
      });
      if (tag === "A") {
        const href = ch.getAttribute("href") || "";
        if (/^https?:\/\//i.test(href)) { ch.setAttribute("target", "_blank"); ch.setAttribute("rel", "noopener noreferrer"); }
        else ch.removeAttribute("href");                   // javascript:/data: 等一律拆掉链接
      }
      if (tag === "IMG") {
        const src = ch.getAttribute("src") || "";
        if (/^https?:\/\//i.test(src) || /^data:image\//i.test(src)) ch.setAttribute("loading", "lazy");
        else ch.remove();
      }
      walk(ch);
    });
  };
  walk(body);
  return body.innerHTML;
}
// 富文本 → 人类可读纯文本（段落保留换行、列表加 •，复制用）
function descToPlain(html) {
  if (!html) return "";
  const BLOCK = { P: 1, DIV: 1, H1: 1, H2: 1, H3: 1, H4: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1 };
  let doc;
  try { doc = new DOMParser().parseFromString("<div id='__r'>" + sanitizeDescHtml(html) + "</div>", "text/html"); }
  catch (e) { return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
  const root = doc.getElementById("__r");
  if (!root) return "";
  const out = [];
  const rec = (n) => {
    if (n.nodeType === 3) { out.push(n.nodeValue.replace(/\s+/g, " ")); return; }
    if (n.nodeType !== 1) return;
    const t = n.tagName;
    if (t === "BR") { out.push("\n"); return; }
    if (BLOCK[t]) out.push("\n");
    if (t === "LI") out.push("• ");
    Array.from(n.childNodes).forEach(rec);
    if (BLOCK[t]) out.push("\n\n");
  };
  Array.from(root.childNodes).forEach(rec);
  return out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

// ===== 从 C 站同步：Metro 对话框（四态状态机 + 实际更新字段 diff） =====
function syncDialogClose(d) {
  try { document.removeEventListener("keydown", d.onKey); } catch (e) { }
  try { d.mask.remove(); } catch (e) { }
  try { d.dlg.remove(); } catch (e) { }
}
function syncDialogOpen() {
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog m-dlg";
  dlg.style.width = "520px";
  const d = { mask: mask, dlg: dlg, onKey: null };
  d.onKey = (e) => { if (e.key === "Escape") syncDialogClose(d); };
  document.addEventListener("keydown", d.onKey);
  mask.addEventListener("click", () => syncDialogClose(d));
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  return d;
}
function syncDialogRender(d, st) {
  const dlg = d.dlg; if (!dlg) return;
  const ICON = { run: "refresh", ok: "check", fail: "x", notfound: "search", net: "alert" };
  const TXT = { run: "正在从 C 站同步 …", ok: "同步成功", fail: "同步失败", notfound: "未找到对应 C 站模型", net: "无法连接 C 站" };
  const cls = st.state === "ok" ? "ok" : (st.state === "run" ? "run" : (st.state === "notfound" ? "warn" : "fail"));
  let html = '<div class="rd-title">从 C 站同步<span class="dlg-x" id="sdX" title="关闭（Esc）">' + _icon("x") + "</span></div>" +
    '<div class="sb-status ' + cls + '">' + _icon(ICON[st.state] || "info") + "<span>" + (TXT[st.state] || "") +
    (st.note ? "（" + esc(String(st.note)) + "）" : "") + "</span></div>";
  if (st.model) html += '<div class="sb-kv"><span class="k">模型</span><span class="v">' + esc(String(st.model)) + "</span></div>";
  if (st.version) html += '<div class="sb-kv"><span class="k">版本</span><span class="v">' + esc(String(st.version)) + "</span></div>";
  if (st.state === "ok") {
    if (st.changed && st.changed.length) {
      html += '<div class="sb-fields"><div class="sb-fields-h">已更新字段（' + st.changed.length + " 项）</div><ul>" +
        st.changed.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul></div>";
    } else {
      html += '<div class="sb-fields"><div class="sb-dim">信息已是最新，无需变更。</div></div>';
    }
  } else if (st.state === "notfound") {
    html += '<div class="sb-dim">C 站没有匹配到该模型；可到「反向解析」页用哈希排查，或确认该模型是否已从 C 站删除。</div>';
  } else if (st.err) {
    html += '<div class="sb-err">' + esc(String(st.err).slice(0, 200)) + "</div>";
  }
  if (st.state !== "run") html += '<div class="rd-actions"><button class="btn btn-primary" id="sdOk">知道了</button></div>';
  dlg.innerHTML = html;
  const bx = dlg.querySelector("#sdX"); if (bx) bx.addEventListener("click", () => syncDialogClose(d));
  const okb = dlg.querySelector("#sdOk"); if (okb) okb.addEventListener("click", () => syncDialogClose(d));
}

async function showModelDetail(path) {
  const json = await api.call("get_model_detail", path);
  let d;
  try { d = JSON.parse(json || "{}"); } catch (e) { d = {}; }
  if (!d.ok) { setStatus("详情获取失败"); return; }
  detailRow = d;
  const info = d.info || {};
  const v = info.version || {};
  const creator = (info.creator && info.creator.username) || info.creator || "";
  const trained = Array.isArray(info.trainedWords) ? info.trainedWords : [];
  const descOrig = String(info.description || "");            // C 站原始 description（HTML 富文本，保持原样）
  const descZh = String(info.description_zh || "");           // 中文翻译（纯文本）
  const descIsRich = /<[a-z][\s\S]*>/i.test(descOrig);       // 含标签 → 富文本
  const descRich = descIsRich ? sanitizeDescHtml(descOrig) : "";
  const descPlain = descIsRich ? descToPlain(descOrig) : descOrig;   // 复制用：纯文本、保留段落
  const descRaw = descPlain;                                  // 兼容旧引用
  const desc = descPlain;
  const covers = d.covers || [];
  detailImgIdx = 0;
  detailImgLocalPath = null;
  const mainB64 = covers.find((c) => c.b64);
  detailImgLocalPath = (mainB64 && mainB64.local && d.path) ? d.path : null;
  detailImgIdx = 0;
  const panel = $("#detailPanel");
  panel.innerHTML =
    '<div class="dt-head">' +
      '<div class="dt-head-t">模型详情</div>' +
      '<div class="dt-head-r">' +
        (creator ? '<span class="dt-author author-chip" data-author="' + esc(creator) + '" data-tip="点击复制作者链接">' + esc(creator) + '</span>' : "") +
        '<button class="icon-btn dt-close" id="dClose" data-tip="关闭（Esc）">' + _icon("x") + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="dt-body">' +
    '<div class="detail-left">' +
    (mainB64
      ? '<img class="detail-main-img" id="dMain" src="data:image/jpeg;base64,' + mainB64.b64 + '"/>'
      : '<div class="detail-main-img dt-empty" id="dMain">' + _icon("image", "ic-lg") + '<span>暂无封面</span></div>') +
    '<div class="detail-thumbs">' + covers.map((c, i) =>
      c.b64
        ? '<img class="detail-thumb' + (i === 0 ? " on" : "") + '" data-i="' + i + '" src="data:image/jpeg;base64,' + c.b64 + '"/>'
        : '<img class="detail-thumb" data-i="' + i + '" data-url="' + esc(c.url || "") + '" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"/>'
    ).join("") + "</div></div>" +
    '<div class="detail-right">' +
    '<div class="detail-title">' + esc(info.name || d.name || "-") + "</div>" +
    (info.modelName && info.modelName !== info.name ? '<div class="detail-cname">' + esc(info.modelName) + "</div>" : "") +
    '<div class="dt-mrs">' +
      '<div class="dt-mr"><span class="k">类型</span><span class="v">' + esc(info.type || "-") + "</span></div>" +
      '<div class="dt-mr"><span class="k">底模</span><span class="v">' + esc(info.baseModel || d.base || "-") + "</span></div>" +
      '<div class="dt-mr"><span class="k">版本</span><span class="v">' + esc(v.name || d.ver || "-") + "</span></div>" +
      '<div class="dt-mr"><span class="k">文件</span><span class="v dt-mono" data-tip="' + esc(d.path || "") + '">' + esc(d.name || "-") + "</span></div>" +
      (info.nsfw ? '<div class="dt-mr"><span class="k">分级</span><span class="v dt-warn">NSFW</span></div>' : "") +
    "</div>" +
    '<div class="dt-sec"><div class="dt-sec-h">' + _icon("tag") + '触发词<span class="dt-sec-hint">点击复制（英文原文）</span></div>' +
      '<div class="detail-tags">' + (trained.length ? trained.map((t, ti) => {
        return '<div class="detail-tag copy-tag" data-orig="' + esc(t) + '" data-tip="点击复制这一套">' +
          (trained.length > 1 ? '<span class="detail-tag-idx">' + (ti + 1) + "</span>" : "") +
          '<span class="detail-tag-txt">' + esc(t) + "</span>" +
          '<span class="dt-copy">' + _icon("copy") + "</span></div>";
      }).join("") : '<span class="dt-dim">无触发词信息（可先「识别模型信息」）</span>') + "</div></div>" +
    '<div class="dt-sec"><div class="dt-sec-h">' + _icon("file") + '简介' +
      (descPlain || descZh ? '<button class="btn dt-copy" id="dCopyDesc" data-tip="复制纯文本简介（保留段落与列表）">' + _icon("copy") + '复制</button>' : "") + '</div>' +
      '<div class="detail-desc' + (descIsRich ? " rich" : "") + '">' + (descIsRich
        ? descRich
        : (descPlain || descZh ? esc(descPlain || descZh) : '<span class="dt-dim">暂无简介</span>')) + '</div>' +
      (descZh && descIsRich ? '<div class="detail-desc-zh"><span class="dz-label">' + _icon("globe") + '中文翻译</span>' + esc(descZh) + "</div>" : "") + "</div>" +
    '<div class="dt-sec"><div class="dt-sec-h">' + _icon("settings") + '操作</div>' +
      '<div class="dt-ag"><div class="dt-ag-h">主要操作</div><div class="dt-ag-b">' +
        '<button class="btn btn-primary" id="dEditInfo">' + _icon("pencil") + '编辑信息</button>' +
        '<button class="btn" id="dSite" data-tip="在浏览器打开该模型在 C 站的主页">' + _icon("external") + '打开 C 站</button>' +
      "</div></div>" +
      '<div class="dt-ag"><div class="dt-ag-h">文件</div><div class="dt-ag-b">' +
        '<button class="btn" id="dRename" data-tip="自定义改名（保留扩展名）">' + _icon("pencil") + '改名</button>' +
        '<button class="btn" id="dCover" data-tip="用本地图片替换封面">' + _icon("image") + '设置封面</button>' +
      "</div></div>" +
      '<div class="dt-ag"><div class="dt-ag-h">信息处理</div><div class="dt-ag-b">' +
        '<button class="btn" id="dRp" data-tip="从 C 站匹配该模型的名字/触发词/封面">' + _icon("upload") + '识别模型信息</button>' +
        '<button class="btn" id="dSync" data-tip="立即从 C 站重新匹配并写回本模型信息（模型名/触发词/版本/封面，沿用现有识别逻辑）">' + _icon("refresh") + '从 C 站同步</button>' +
        '<button class="btn" id="dTranslate" data-tip="把简介翻译成中文（需在设置配置百度翻译）">' + _icon("globe") + '翻译成中文</button>' +
        '<button class="btn" id="dLocalize" data-tip="把本地文件名翻译成中文">' + _icon("globe") + '文件名翻中文</button>' +
        '<button class="btn" id="dJson" data-tip="生成 WebUI 能识别的元数据文件">' + _icon("file") + '生成 SD 可读 JSON</button>' +
      "</div></div>" +
      '<div class="dt-ag"><div class="dt-ag-h">图片</div><div class="dt-ag-b">' +
        '<button class="btn" id="dAllImgs" data-tip="把 C 站该模型的全部示例图下载到「模型名.images」文件夹">' + _icon("download") + '下载示例图</button>' +
      "</div></div>" +
    "</div>" +
    "</div></div>";
  $("#detailMask").style.display = "flex";
  // 自动加载所有 URL 缩略图（避免空占位）
  covers.forEach((c, i) => {
    if (!c.b64 && c.url) {
      api.call("get_cover_b64", c.url).then((b64) => {
        if (!b64) {
          // 加载失败：移除该占位缩略图
          const th = panel.querySelector('.detail-thumb[data-i="' + i + '"]');
          if (th) th.remove();
          return;
        }
        c.b64 = b64;
        const th = panel.querySelector('.detail-thumb[data-i="' + i + '"]');
        if (th) th.src = "data:image/jpeg;base64," + b64;
        const main = $("#dMain");
        if (main && main.src.indexOf("data:image/jpeg;base64,") < 0 && main.getAttribute("src") !== undefined && (!mainB64 || main.dataset.empty)) {
          main.src = "data:image/jpeg;base64," + b64;
          main.style.opacity = "1";
        }
      });
    }
  });
  // 画廊切换
  const loadB64 = async (i) => {
    const c = covers[i];
    if (!c) return;
    detailImgIdx = i;
    detailImgLocalPath = (c.local && d.path) ? d.path : null;
    const img = $("#dMain");
    if (c.b64) { img.src = "data:image/jpeg;base64," + c.b64; }
    else if (c.url) {
      img.style.opacity = "0.5";
      const b64 = await api.call("get_cover_b64", c.url);
      if (b64) { img.src = "data:image/jpeg;base64," + b64; c.b64 = b64; }
      img.style.opacity = "1";
    }
    panel.querySelectorAll(".detail-thumb").forEach((t) => t.classList.remove("on"));
    const th = panel.querySelector('.detail-thumb[data-i="' + i + '"]');
    if (th) th.classList.add("on");
  };
  panel.querySelectorAll(".detail-thumb").forEach((t) => {
    t.addEventListener("click", () => loadB64(Number(t.dataset.i)));
  });
  // 操作
  $("#dSite", panel).addEventListener("click", () => {
    const mid = info.modelId || info.id || info.model_id;
    api.call("open_url", "https://" + (state.cfg.site_domain || "civitai.red") + "/models/" + (mid || ""));
  });

  panel.querySelectorAll(".author-chip").forEach((el) => {
    el.addEventListener("click", async () => {
      const uname = el.dataset.author || "";
      const url = "https://" + (state.cfg.site_domain || "civitai.red") + "/user/" + uname;
      try { await window.__copyText(url); setStatus("作者链接已复制: " + url); }
      catch (e) { setStatus("复制失败"); }
    });
  });
  panel.querySelectorAll(".copy-tag").forEach((tg) => {
    tg.addEventListener("click", async () => {
      // 优先复制英文原文（data-orig）——WebUI 触发词必须用英文；没有翻译时回退显示文本
      const orig = tg.dataset.orig;
      const el = tg.querySelector(".detail-tag-txt") || tg;
      const ok = await window.__copyText(orig || el.textContent.trim());
      setStatus(ok ? "已复制该套触发词（英文原文）" : "复制失败");
    });
  });
  $("#dCover").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.addEventListener("change", async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const b64 = String(reader.result).split(",").pop();
        setStatus("上传封面中 …");
        const res = await api.call("set_custom_cover", path, b64);
        setStatus(res && res.msg ? res.msg : "封面已更新");
        showModelDetail(path);
      };
      reader.readAsDataURL(f);
    });
    inp.click();
  });
  $("#dEditInfo").addEventListener("click", async () => {
    const mask = document.createElement("div");
    mask.className = "rd-mask";
    const dlg = document.createElement("div");
    dlg.className = "rename-dialog";
    dlg.style.width = "520px";
    const v = info.version || {};
    dlg.innerHTML =
      '<div class="rd-title">编辑模型信息</div>' +
      '<div class="form-grid" style="grid-template-columns:120px 1fr">' +
      '<label>模型名</label><input class="input" id="eiName" value="' + esc(info.modelName || "") + '"/>' +
      '<label>触发词</label><textarea class="rules" id="eiTags" rows="5" placeholder="每行一套触发词（一套内用英文逗号分隔），与 C 站展示一致">' + esc(trained.join("\n")) + "</textarea>" +
      '<label>类型</label><input class="input" id="eiType" value="' + esc(info.type || "") + '"/>' +
      '<label>基础模型</label><input class="input" id="eiBase" value="' + esc(info.baseModel || "") + '"/>' +
      '<label>版本</label><input class="input" id="eiVer" value="' + esc(v.name || "") + '"/>' +
      '<label>简介</label><textarea class="rules" id="eiDesc" rows="4">' + esc(desc || "") + "</textarea>" +
      "</div>" +
      '<div class="rd-actions"><button class="btn btn-primary" id="eiOk">保存</button><button class="btn" id="eiNo">取消</button></div>';
    document.body.appendChild(mask);
    document.body.appendChild(dlg);
    const close = () => { mask.remove(); dlg.remove(); };
    mask.addEventListener("click", close);
    $("#eiNo").addEventListener("click", close);
    $("#eiOk").addEventListener("click", async () => {
      const res = await api.call("save_model_info", path, {
        name: $("#eiName").value,
        trained_words: $("#eiTags").value.split(/\r?\n/).map((x) => x.trim()).filter((x) => x),
        type: $("#eiType").value,
        base_model: $("#eiBase").value,
        version: $("#eiVer").value,
        description: $("#eiDesc").value,
      });
      setStatus(res && res.msg ? res.msg : "已保存");
      close();
      showModelDetail(path);
    });
  });
  $("#dTranslate", panel).addEventListener("click", async () => {
    setStatus("翻译成中文中...");
    const r = await api.call("mm_translate_descs", [d.path]);
    setStatus(r && r.msg ? r.msg : "翻译完成");
    showModelDetail(d.path);  // 保持面板，刷新内容
  });
  $("#dLocalize", panel).addEventListener("click", async () => {
    setStatus("文件名翻中文中...");
    const r = await api.call("mm_localize", [d.path]);
    setStatus(r && r.msg ? r.msg : "汉化完成");
    showModelDetail(d.path);
  });
  $("#dAllImgs", panel).addEventListener("click", async () => {
    setStatus("下载所有示例图中 0%...");
    const timer = setInterval(async () => {
      try {
        const st = JSON.parse((await api.call("get_img_dl_state")) || "{}");
        if (st.total > 0) {
          const pct = Math.round((st.done / st.total) * 100);
          setStatus("下载所有示例图中 " + pct + "% (" + st.done + "/" + st.total + ")");
        }
      } catch (e) {}
    }, 400);
    const r = JSON.parse((await api.call("download_all_images", d.path)) || "{}");
    clearInterval(timer);
    setStatus(r.ok ? "已下载 " + r.downloaded + " 张图片" : "失败: " + (r.msg || ""));
    if (r.ok) { closeDetail(); showModelDetail(d.path); }
  });
  $("#dRename", panel).addEventListener("click", () => { closeDetail(); showRenameDialog(d.path, d.name); });
  $("#dRp", panel).addEventListener("click", async () => {
    await api.call("rp_add_paths", [d.path]);
    closeDetail();
    setStatus("已发送去识别模型信息");
    document.querySelector('.nav-tab[data-page="reverse"]').click();
  });
  $("#dSync", panel).addEventListener("click", async () => {
    const btn = $("#dSync", panel);
    if (btn) btn.disabled = true;
    setStatus("正在从 C 站同步 …");
    const pick = (x) => {
      const it = (x && x.info) || {};
      return {
        name: String(it.name || ""),
        author: String((it.creator && it.creator.username) || it.creator || ""),
        version: String((it.version && it.version.name) || ""),
        words: (Array.isArray(it.trainedWords) ? it.trainedWords.join("|") : ""),
        desc: String(it.description || ""),
        type: String(it.type || ""),
        base: String(it.baseModel || ""),
        imgs: (Array.isArray(it.images) ? it.images.length : 0)
      };
    };
    let before = null;
    try { before = pick(await api.call("get_model_detail", d.path)); } catch (e) { before = null; }
    const dlg = syncDialogOpen();
    syncDialogRender(dlg, { state: "run" });
    let last = null, errText = "";
    try {
      await api.call("rp_add_paths", [d.path]);
      await api.call("rp_start");
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const rows = (await api.call("rp_get_rows").catch(() => null)) || [];
        last = rows.find((x) => x.path === d.path) || null;
        const st0 = last ? String(last.status || "") : "";
        if (/完成|成功|失败|错误|未匹配|未收录|已跳过|已取消/.test(st0)) break;
        if (i === 4) {
          syncDialogRender(dlg, { state: "run", note: st0 || "排队中" });
          setStatus("正在从 C 站同步 …（" + (st0 || "排队中") + "）");
        }
      }
    } catch (e) { errText = String(e || ""); }
    if (btn) btn.disabled = false;
    const st = last ? String(last.status || "") : "";
    let state, model = (last && last.model) || "", version = (last && last.version) || "", err = "";
    if (/完成|成功/.test(st)) state = "ok";
    else if (/未匹配|未收录|404/.test(st)) state = "notfound";
    else if (errText && /timeout|timed out|connect|network|SSL|ECONN|HTTP|proxy/i.test(errText)) { state = "net"; err = errText; }
    else if (/失败|错误|已取消/.test(st)) { state = "fail"; err = String((last && last.model) || ""); }
    else { state = "fail"; err = st || errText || "未收到完成状态"; }
    let changed = [];
    if (state === "ok") {
      await new Promise((r) => setTimeout(r, 700));
      let after = null;
      try { after = pick(await api.call("get_model_detail", d.path)); } catch (e) { after = null; }
      const LABELS = [["name", "模型名称"], ["author", "作者"], ["version", "版本"], ["words", "触发词"], ["desc", "简介"], ["type", "类型"], ["base", "基础模型"], ["imgs", "示例图片"]];
      if (before && after) LABELS.forEach((p2) => { if (before[p2[0]] !== after[p2[0]]) changed.push(p2[1]); });
      if (after && after.name) model = after.name;
      if (after && after.version) version = after.version;
      try { showModelDetail(d.path); } catch (e) { }
    }
    syncDialogRender(dlg, { state: state, model: model, version: version, changed: changed, err: err });
    setStatus(state === "ok"
      ? ("同步完成：" + (changed.length ? "更新 " + changed.length + " 项" : "信息已是最新"))
      : ("同步未完成：" + (st || err || "无结果")));
  });
  $("#dJson", panel).addEventListener("click", async () => {
    await api.call("mm_gen_json", [d.path], true);
    setStatus("SD json 已生成");
    closeDetail();
  });
  const dCopyBtn = $("#dCopyDesc", panel);
  if (dCopyBtn) dCopyBtn.addEventListener("click", async () => {   // 复制：纯文本（段落/列表保留，无 HTML 标签）
    const full = [descPlain, descZh ? "—— 中文翻译 ——\n" + descZh : ""].filter(Boolean).join("\n\n");
    let ok = false;
    try { ok = await window.__copyText(full); } catch (e) { ok = false; }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = full; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove();
      } catch (e2) { ok = false; }
    }
    setStatus(ok ? "简介已复制" : "复制失败（可手动选中复制）");
  });
  $("#dClose", panel).addEventListener("click", closeDetail);
}
// 详情图片右键：复制/打开文件夹/复制提示词/打开原图（document 级委托）
let detailImgCtx = null;
document.addEventListener("contextmenu", (e) => {
  const img = e.target && e.target.closest ? e.target.closest(".detail-main-img, .detail-thumb") : null;
  if (!img || !detailRow) return;
  e.preventDefault();
  const idx = img.classList.contains("detail-main-img") ? (detailImgIdx || 0) : Number(img.dataset.i);
  const c = detailRow.covers ? detailRow.covers[idx] : null;
  if (!c) return;
  detailImgCtx = { c, idx };
  const menu = $("#ctxMenu");
  menu.innerHTML =
    '<div class="ctx-item" data-act="img_copy" data-tip="把图片本身复制到剪贴板（可直接粘贴）">复制图片到剪贴板</div>' +
    '<div class="ctx-item" data-act="img_prompt" data-tip="复制该图片的正面提示词（本地 PNG 元数据 / C 站 info）">复制正面提示词</div>' +
    '<div class="ctx-item" data-act="img_neg" data-tip="复制该图片的负面提示词">复制负面提示词</div>' +
    '<div class="ctx-item" data-act="img_tags" data-tip="复制模型级触发词（与图片提示词分开）">复制触发词（模型 tags）</div>' +
    '<div class="ctx-item" data-act="img_folder" data-tip="打开资源管理器并选中该图片">打开图片所在文件夹</div>' +
    '<div class="ctx-item" data-act="img_orig" data-tip="在浏览器打开该图片在 C 站的原页">打开原图片网站</div>';
  menu.style.display = "block";
  const zf = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  menu.style.left = (e.clientX / zf) + "px";
  menu.style.top = (e.clientY / zf) + "px";
  for (let k = 0; k < 4; k++) {
    const got = menu.getBoundingClientRect();
    const dx = e.clientX - got.left;
    const dy = e.clientY - got.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    menu.style.left = (parseFloat(menu.style.left) + dx) + "px";
    menu.style.top = (parseFloat(menu.style.top) + dy) + "px";
  }
  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - mr.width) + "px";
  if (mr.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - mr.height) + "px";
});
$("#ctxMenu").addEventListener("click", async (e) => {
  const item = e.target.closest("[data-act^=img_]");
  if (!item || !detailImgCtx) return;
  const { c, idx } = detailImgCtx;
  const act = item.dataset.act;
  $("#ctxMenu").style.display = "none";
  try {
    // 本地图文件路径：优先图自身 local_path（右键哪张就用哪张），本地图无路径时用模型文件兜底
    const localImgPath = c.local_path || (c.local ? detailRow.path : null);
    if (act === "img_copy") {
      // 复制图片本身到剪贴板（本地图读原图；远程图用已加载的 b64；都没有才复制路径/链接）
      let b64 = null;
      if (c.local_path) {
        try {
          const r = JSON.parse(await api.call("get_local_img_b64", c.local_path) || "{}");
          if (r && r.ok && r.b64) b64 = r.b64;
        } catch (e) { b64 = null; }
      }
      if (!b64 && c.b64) b64 = c.b64;
      if (b64) {
        try {
          const blob = await (await fetch("data:image/jpeg;base64," + b64)).blob();
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          showToast("图片已复制到剪贴板，可直接粘贴");
        } catch (e2) {
          await window.__copyText(c.local_path || c.orig_url || c.url || "");
          showToast("剪贴板写入失败，已复制路径/链接");
        }
      } else {
        await window.__copyText(c.local_path || c.orig_url || c.url || "");
        showToast("已复制路径/链接");
      }
    } else if (act === "img_folder") {
      // 只打开本地文件夹；远程图没有本地文件时提示，不打开网站（打开网站走"打开原图片网站"）
      if (localImgPath) {
        const r = await api.call("open_in_folder", localImgPath);
        if (r && r.ok) showToast("已打开文件夹：" + localImgPath);
        else showToast(r && r.msg ? r.msg + "：" + localImgPath : "打开失败");
      } else {
        showToast("该图没有本地文件（可点「下载封面图」或详情页下载所有示例图）");
      }
    } else if (act === "img_tags") {
      const tw = (detailRow && detailRow.trainedWords) ? detailRow.trainedWords : [];
      if (tw.length) {
        await window.__copyText(tw.join(", "));
        setStatus("触发词已复制（" + tw.length + " 套）");
      } else {
        setStatus("该模型没有触发词信息（可先反向解析）");
      }
    } else if (act === "img_prompt") {
      // 复制图片的正面提示词（本地识别 PNG 元数据 / C 站 info 兜底）
      const p = c.prompt || "";
      if (p) {
        await window.__copyText(p);
        showToast("正面提示词已复制");
      } else {
        showToast("该图片没有正面提示词信息");
      }
    } else if (act === "img_neg") {
      // 复制图片的负面提示词
      const n = c.negative || "";
      if (n) {
        await window.__copyText(n);
        showToast("负面提示词已复制");
      } else {
        showToast("该图片没有负面提示词信息");
      }
    } else if (act === "img_orig") {
      if (c.orig_url) await api.call("open_url", c.orig_url);
      else setStatus("无原图链接");
    }
  } catch (err) { setStatus("操作失败: " + err); }
  detailImgCtx = null;
});

// 伪 C 站详情面板：ESC 退出
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("#detailMask") && $("#detailMask").style.display === "flex") closeDetail();
  }
});
function closeDetail() {
  $("#detailMask").style.display = "none";
  $("#detailPanel").innerHTML = "";
  detailRow = null;
}
$("#detailMask").addEventListener("click", (e) => {
  if (e.target.id === "detailMask") closeDetail();
});
// 打开入口：行双击 / 瀑布流卡片双击（单击统一为选中）
document.addEventListener("dblclick", (e) => {
  // 双击只对"模型主体"生效：按钮 / 链接 / 输入 / 下拉 / 自绘勾选 等交互控件上的双击不打开详情（防冒泡误触）
  if (e.target.closest("button, a, input, select, textarea, .cbox, .ms-check, .ms-upd, .btn, .mm-menu")) return;
  const tr = e.target.closest("tr[data-path]");
  if (tr && tr.dataset.path) showModelDetail(tr.dataset.path);
  const card = e.target.closest(".ms-card");
  if (card && card.dataset.path) showModelDetail(card.dataset.path);
});

// ===== 工作流分析（独立页面：拖入/选择 → 解析 → 节点 + 模型哈希匹配） =====
async function wfAnalyze(path) {
  if (!path) return;
  setStatus("工作流解析中...");
  const json = await api.call("analyze_workflow", path);
  let r = {};
  try { r = JSON.parse(json || "{}"); } catch (e) {}
  if (!r.ok) { setStatus("解析失败: " + (r.msg || "")); return; }
  setStatus("工作流分析完成");
  wfRenderResult(r);
}
async function wfRenderResult(r) {
  $("#wfResult").style.display = "block";
  $("#wfResultTitle").innerHTML = "" + esc(r.file) + ' <span class="wf-info">' + (r.has_workflow ? "含内嵌工作流" : "仅提示词信息") + " · 节点 " + r.node_count + " 个</span>";
  const nodes = r.nodes || [];
  $("#wfNodes").innerHTML = nodes.length
    ? nodes.map((n) => '<div class="wf-node"><span class="wf-node-type">' + esc(n.type || "?") + "</span>" +
      (n.title ? '<span class="wf-node-title">' + esc(n.title) + "</span>" : "") +
      (n.widgets && n.widgets.length ? '<span class="wf-node-widgets">' + esc(n.widgets.join(" · ")) + "</span>" : "") +
      "</div>").join("")
    : '<div class="wf-empty">未识别到节点</div>';
  const refs = r.models || [];
  $("#wfModels").innerHTML = '<div class="wf-hint">本地匹配计算中...</div>';
  if (refs.length) {
    try {
      const mjson = await api.call("workflow_model_matches", refs);
      const matches = JSON.parse(mjson || "[]");
      $("#wfModels").innerHTML = matches.map((m) =>
        '<div class="wf-model' + (m.local ? " hit" : "") + '">' +
        '<span class="wf-model-ref">' + esc(m.ref) + "</span>" +
        (m.local
          ? '<span class="wf-model-path">本地: ' + esc(m.path) + "</span>" +
            (m.sha256 ? '<span class="wf-model-sha">SHA256: ' + esc(m.sha256) + "…</span>" : "")
          : '<span class="wf-model-miss">本地未找到</span>' +
            '<span class="wf-search" data-search="' + esc(m.ref) + '">搜索下载</span>') +
        "</div>").join("");
    } catch (e) {
      $("#wfModels").innerHTML = '<div class="wf-empty">模型匹配失败</div>';
    }
  } else {
    $("#wfModels").innerHTML = '<div class="wf-empty">未识别到模型引用</div>';
  }
  const pos = r.positive || r.pos_prompt || "";
  const neg = r.negative || r.neg_prompt || "";
  $("#wfPrompts").innerHTML =
    (pos ? '<div class="wf-prompt"><span class="wf-prompt-label">正向</span><div class="wf-prompt-text">' + esc(pos) + "</div></div>" : "") +
    (neg ? '<div class="wf-prompt"><span class="wf-prompt-label neg">负向</span><div class="wf-prompt-text">' + esc(neg) + "</div></div>" : "") +
    ((!pos && !neg) ? '<div class="wf-empty">未提取到提示词</div>' : "");
}
const wfDrop = $("#wfDrop");
wfDrop.addEventListener("dragover", (e) => { e.preventDefault(); wfDrop.classList.add("over"); });
wfDrop.addEventListener("dragleave", () => wfDrop.classList.remove("over"));
wfDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  wfDrop.classList.remove("over");
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) { setStatus("无法读取拖入文件，请点击选择"); return; }
  if (f.path) { wfAnalyze(f.path); return; }
  setStatus("读取文件中...");
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const bytes = new Uint8Array(rd.result);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      const b64 = btoa(bin);
      const json = await api.call("wf_analyze_data", f.name, b64);
      let r = {};
      try { r = JSON.parse(json || "{}"); } catch (err) {}
      if (!r.ok) { setStatus("解析失败: " + (r.msg || "")); return; }
      wfRenderResult(r);
    } catch (err) { setStatus("读取失败: " + err); }
  };
  rd.onerror = () => setStatus("文件读取失败");
  rd.readAsArrayBuffer(f);
});
$("#wfPick").addEventListener("click", async () => {
  const p = await api.call("pick_file");
  if (p) wfAnalyze(p);
});


// ===== 关于弹窗（右下角「关于」/左上角 logo） =====
async function showAbout() {
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.style.width = "480px";
  let ver = "v?";
  try {
    const r = JSON.parse(await api.call("get_version") || "{}");
    if (r && r.ok) ver = "v" + r.version;
  } catch (e) { /* 版本获取失败时显示占位 */ }
  dlg.innerHTML =
    '<div class="about-head">' +
    '<img class="about-logo" src="bili_face.png" alt=""/>' +
    '<div><div class="about-name">CivitaiFreeTool <span class="about-ver">' + esc(ver) + '</span></div>' +
    '<div style="font-size:12px;color:var(--text-dim)">Civitai / HuggingFace 模型下载、管理、反向解析工具（免费全功能）</div></div></div>' +
    '<div class="about-updates">' +
    '<div class="about-up-title">🆕 最近更新（' + esc(ver) + '）</div>' +
    '<div class="about-up-body">' +
    '<div class="about-up-item"><b>修复「翻译成中文」不生效</b>：简介+触发词一起翻，写回 info 与 json，英文原文保留，复制触发词仍为英文原文（WebUI 用）</div>' +
    '<div class="about-up-item"><b>下载体验</b>：批量下载跳转弹窗提示；移动分类弹窗显示模型缩略图；下载列表新增缩略图列+行右键菜单（打开文件夹/复制文件名/打开C站）</div>' +
    '<div class="about-up-item"><b>新手引导大修</b>：点击功能卡片/主题切换即刻生效；引导缩小为右下角小窗不中断；保存设置不再白屏刷新</div>' +
    '<div class="about-up-item">10 套主题 + 氛围背景跟随主题；设置页「保存设置」红色显眼</div>' +
    '</div></div>' +
    '<div class="about-thanks">' +
    '<div class="about-up-title">感谢 Contributors</div>' +
    '<div class="about-contribs" id="aboutContribs">加载中…</div></div>' +
    '<div class="about-author">' +
    '<div class="rd-home" id="rdHome">作者：爱德怀斯official —— 点击打开 B 站主页</div>' +
    '<div class="rd-group" id="rdGroup">粉丝群：909810278 —— 点击加入</div></div>' +
    '<div class="rd-actions">' +
    '<button class="btn" id="aboutGithub">GitHub 仓库</button>' +
    '<button class="btn btn-primary" id="aboutOk">知道了</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  const close = () => { mask.remove(); dlg.remove(); };
  $("#aboutOk").addEventListener("click", close);
  mask.addEventListener("click", close);
  $("#aboutGithub").addEventListener("click", () => api.call("open_url", "https://github.com/ADVICEsama/CivitaiFreeTool"));
  $("#rdHome").addEventListener("click", () => api.call("open_url", "https://space.bilibili.com/273101122"));
  $("#rdGroup").addEventListener("click", () => api.call("open_url", "https://qm.qq.com/q/EbnuVZB4wE"));
  // 贡献者：动态拉取 GitHub contributors（排除作者本人），失败回退静态致谢
  const box = $("#aboutContribs", dlg);
  const fallback = '<div class="about-contrib">感谢 <a href="#" data-gh="guanhaisen">@guanhaisen</a>、<a href="#" data-gh="LckHot">@LckHot</a> 的社区贡献 </div>';
  fetch("https://api.github.com/repos/ADVICEsama/CivitaiFreeTool/contributors?per_page=10")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((list) => {
      const others = (list || []).filter((c) => c.login !== "ADVICEsama");
      if (!others.length) { box.innerHTML = fallback; return; }
      box.innerHTML = others.map((c) =>
        '<a class="about-contrib" href="#" data-gh="' + esc(c.login) + '" title="' + c.contributions + ' 次提交">' +
        (c.avatar_url ? '<img class="about-contrib-avatar" src="' + esc(c.avatar_url) + '&s=48" alt=""/>' : "") +
        '<span>@' + esc(c.login) + '<em>' + c.contributions + " 次提交</em></span></a>").join("");
    })
    .catch(() => { box.innerHTML = fallback; });
  box.addEventListener("click", (e) => {
    const a = e.target.closest("[data-gh]");
    if (a) { e.preventDefault(); api.call("open_url", "https://github.com/" + a.dataset.gh); }
  });
}
$("#aboutFloat").addEventListener("click", showAbout);
// 左上角 logo 点击 = 关于页
const _logoEl = document.querySelector(".nav-logo");
if (_logoEl) _logoEl.addEventListener("click", showAbout);

// ===== 全局悬浮提示（带动画，鼠标跟随） =====
(function () {
  const tip = document.createElement("div");
  tip.className = "tip-float";
  tip.style.display = "none";
  document.body.appendChild(tip);
  document.addEventListener("mousemove", (e) => {
    const t = e.target && e.target.closest ? e.target.closest("[data-tip], td") : null;
    if (!t) { tip.style.display = "none"; return; }
    let text = (t.dataset && t.dataset.tip) || "";
    if (!text && t.tagName === "TD") {
      const full = t.getAttribute("data-full");
      const cur = (t.textContent || "").trim();
      const truncated = full != null || (t.scrollWidth > t.clientWidth + 4) || cur.length >= 20;
      if (!truncated) { tip.style.display = "none"; return; }
      text = (full != null ? full : cur) || "";
    }
    if (!text || !text.trim()) { tip.style.display = "none"; return; }
    tip.textContent = text.trim();
    tip.style.display = "block";
    tip.classList.remove("show");
    void tip.offsetWidth;
    tip.classList.add("show");
    const zf = parseFloat(document.documentElement.style.zoom) || 1;
    tip.style.left = (e.clientX / zf + 14) + "px";
    tip.style.top = (e.clientY / zf + 14) + "px";
    clearTimeout(tip._h);
    tip._h = setTimeout(() => { tip.style.display = "none"; }, 3000);
  });
})();

// ===== 模型管理右键菜单 =====
let ctxRow = null;
$("#mmTable tbody").addEventListener("contextmenu", (e) => {
  const tr = e.target.closest("tr[data-path]");
  if (!tr) return;
  e.preventDefault();
  ctxRow = state.display.find((r2) => r2.path === tr.dataset.path) || null;
  if (!ctxRow) return;
  const menu = $("#ctxMenu");
  const r = ctxRow;
  menu.innerHTML =
    '<div class="ctx-item" data-act="copy_name" data-tip="复制当前本地文件名">复制文件名</div>' +
    '<div class="ctx-item" data-act="copy_cname" data-tip="复制 C 站上的模型名（不改本地文件）">🀄 复制C站模型名</div>' +
    '<div class="ctx-item" data-act="folder" data-tip="打开资源管理器并选中该文件">打开所在文件夹</div>' +
    '<div class="ctx-item" data-act="site" data-tip="在浏览器打开该模型在 C 站的主页">打开C站</div>' +
    '<div class="ctx-item" data-act="rename" data-tip="自定义改名（保留扩展名）">改名</div>' +
    '<div class="ctx-item" data-act="rename_c" data-tip="把本地文件名改成 C 站上的模型名（只改本地文件）">文件名改成C站名</div>' +
    '<div class="ctx-item" data-act="sdjson" data-tip="生成 WebUI 能识别的「模型名.json」元数据文件">生成SD可读json</div>' +
    '<div class="ctx-item" data-act="localize" data-tip="把本地文件名翻译成中文">🀄 文件名翻中文</div>' +
    '<div class="ctx-item" data-act="rp" data-tip="从 C 站匹配该模型的名字/触发词/封面">识别模型信息</div>' +
    '<div class="ctx-item" data-act="organize" data-tip="把该模型移动到分类文件夹（需先在设置选 目标环境）">整理模型</div>' +
    '<hr class="ctx-sep"/>' +
    '<div class="ctx-item danger" data-act="del" data-tip="把该模型文件移入回收站（可还原）">移入回收站</div>';
  menu.style.display = "block";
  const zf = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  menu.style.left = (e.clientX / zf) + "px";
  menu.style.top = (e.clientY / zf) + "px";
  for (let k = 0; k < 4; k++) {
    const got = menu.getBoundingClientRect();
    const dx = e.clientX - got.left;
    const dy = e.clientY - got.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    menu.style.left = (parseFloat(menu.style.left) + dx) + "px";
    menu.style.top = (parseFloat(menu.style.top) + dy) + "px";
  }
  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - mr.width) + "px";
  if (mr.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - mr.height) + "px";
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
    if (act === "folder") { api.call("open_in_folder", path); return; }
    if (act === "copy_name") {
      try { await window.__copyText(ctxRow.name || ""); setStatus("已复制文件名: " + ctxRow.name); }
      catch (e) { setStatus("复制失败"); }
    } else if (act === "copy_cname") {
      try { await window.__copyText(ctxRow.civitai_name || "-"); setStatus("已复制C站模型名: " + (ctxRow.civitai_name || "-")); }
      catch (e) { setStatus("复制失败"); }
    } else if (act === "site") {
      const url = ctxRow.url || ("https://" + (state.cfg.site_domain || "civitai.red") + "/models/" + (ctxRow.modelId || ""));
      api.call("open_url", url);
    } else if (act === "rename") {
      showRenameDialog(path, ctxRow.name);
    } else if (act === "rename_c") {
      await api.call("mm_rename", [path]);
      setStatus("改名完成，刷新中...");
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
      setStatus("已发送去识别模型信息");
      document.querySelector('.nav-tab[data-page="reverse"]').click();
    } else if (act === "organize") {
      await api.call("mm_organize", [path]);
      setStatus("整理完成，刷新中...");
      await api.call("scan_models");
      pollMmScan();
    } else if (act === "del") {
      if (!(await confirmBox("确定将「" + (ctxRow.name || path) + "」移入回收站？"))) return;
      const res = await api.call("rm_file", path);
      setStatus(res && res.msg ? res.msg : "已删除");
      await api.call("scan_models");
      pollMmScan();
    }
  } catch (err) {
    setStatus("操作失败: " + err);
  }
});

// 改名弹窗
function showRenameDialog(path, oldName) {
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  const oldBase = String(oldName || "").replace(/\.(safetensors|ckpt|pt|pth|bin|onnx|gguf|sft)$/i, "");
  dlg.innerHTML =
    '<div class="rd-title">改名（保留扩展名）</div>' +
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
    setStatus(res && res.msg ? res.msg : "改名完成");
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
mmOp("mmJson", (p) => api.call("mm_gen_json", p, true));
mmOp("mmCovers", (p) => api.call("mm_download_covers", p));
mmOp("mmTranslate", (p) => api.call("mm_translate_descs", p));
$("#mmOrganize").addEventListener("click", async () => {
  if (!(state.cfg && state.cfg.target_env)) {
    confirmBox("请先在 设置 → 分类规则 选择 目标环境（WebUI / ComfyUI），才能整理模型");
    return;
  }
  if ((state.cfg.organize_mode || "manual") === "manual") {
    const paths = Array.from(state.mmChecked);
    const rows = state.models.filter((r) => paths.includes(r.path));
    if (!rows.length) { setStatus("请先勾选要整理的模型"); return; }
    setStatus("手动整理：共 " + rows.length + " 个，逐个选择目标文件夹 …");
    for (const r of rows) {
      const dir = await api.call("pick_dir");
      if (!dir) break;
      const res = await api.call("move_file_to", r.path, dir);
      setStatus(res && res.msg ? res.msg : "已移动 " + r.name);
    }
    mmScan();
    return;
  }
  mmOp("mmOrganize", (p) => api.call("mm_organize", p));
});
mmOp("mmCleanup", (p) => api.call("mm_cleanup", p));
$("#mmRestore").addEventListener("click", async () => {
  if (!(state.cfg && state.cfg.target_env)) {
    confirmBox("请先在 设置 → 分类规则 选择 目标环境（WebUI / ComfyUI）");
    return;
  }
  setStatus("正在扫描可恢复的模型 …");
  const prev = await api.call("mm_restore_organize", true);
  if (!prev || !prev.ok) { setStatus(prev ? prev.msg : "扫描失败"); return; }
  if (!prev.count) { setStatus("没有发现需要恢复的模型 "); return; }
  const root = (state.cfg.models_dir || "").replace(/\\/g, "/");
  const lines = prev.items.slice(0, 30).map((it) =>
    "· " + esc(it.src.split(/[\\/]/).pop()) + " → " + esc(it.dest.replace(/\\/g, "/").replace(root, "")) + "（" + esc(it.why) + "）").join("<br/>");
  const more = prev.count > 30 ? "<br/>… 共 " + prev.count + " 个" : "";
  const ok = await confirmBox(
    "<div style='font-size:12px;color:var(--text-dim);line-height:1.8'>以下模型将被移回标准目录（只移动不删除，json/封面随行）：</div><div style='font-size:12px;line-height:1.9;max-height:240px;overflow:auto;margin-top:6px'>" + lines + more + "</div>",
    "恢复误整理");
  if (!ok) return;
  setStatus("正在恢复 …");
  const res = await api.call("mm_restore_organize", false);
  setStatus(res && res.msg ? res.msg : "恢复完成");
  mmScan();
});
function updateOrganizeBtns() {
  const env = state.cfg && state.cfg.target_env;
  const mode = (state.cfg && state.cfg.organize_mode) || "manual";
  const canAuto = env && mode !== "manual";
  const el = $("#mmRestore");
  if (el) el.style.display = canAuto ? "" : "none";
}
updateOrganizeBtns();
// 扫描走独立的 scan_state 轮询（不走 mm_progress）
$("#mmRefresh").addEventListener("click", () => {
  setStatus("刷新中 ...");
  api.call("scan_models").catch(() => {});
  pollMmScan();
});
$("#mmScan").addEventListener("click", () => mmScan());

// 改名：主按钮执行默认动作（设置可改），hover 显示二级菜单
function mmRenameRun(act) {
  const p = mmCheckedPaths();
  if (!p) { setStatus("请先勾选或选中模型"); return; }
  if (act === "custom") {
    const first = state.display.find((r) => r.path === p[0]);
    if (first) { showRenameDialog(first.path, first.name); return; }
    setStatus("未找到选中模型"); return;
  }
  mmRenamePreview(act, p);      // 批量改名：先试算预览，确认后才执行
}

// 批量改名预览（只读试算 → 用户确认 → 才真正执行）
async function mmRenamePreview(act, paths) {
  const label = act === "rename_c" ? "文件名 → C站名称" : "文件名 → 中文";
  setStatus("试算中（未修改任何文件）…");
  let r = null;
  try { r = await api.call("mm_rename_preview", act, paths); } catch (e) { setStatus("试算失败：" + e); return; }
  const items = ((r && r.items) || []).filter((x) => x && x.old);
  if (!items.length) { setStatus("没有可改名的模型（先勾选）"); return; }
  const willChange = items.filter((x) => x.new && !x.same);
  const rows = items.map((it) => {
    const tag = it.new && !it.same ? "" : ' <span class="rp-skip">' + (it.new ? "名字已相同" : "跳过") + "</span>";
    return "<tr><td class=\"rp-old\" data-tip=\"" + esc(it.old) + "\">" + esc(short(it.old, 46)) + "</td>" +
      '<td class="rp-arrow">→</td>' +
      '<td class="rp-new" data-tip="' + esc(it.new || "") + '">' + esc(short(it.new || "—", 46)) + tag + "</td></tr>";
  }).join("");
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog rp-dlg";
  dlg.innerHTML =
    '<div class="rd-title">批量改名预览 · ' + esc(label) + "</div>" +
    '<div class="rp-hint">以下为<b>试算结果，尚未修改任何文件</b>；点「应用」才会执行。</div>' +
    '<div class="rp-list"><table class="rp-tb"><thead><tr><th>原文件名</th><th></th><th>新文件名</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
    '<div class="rd-actions"><span class="rp-count">共 ' + items.length + " 项，将改动 " + willChange.length + " 项</span><span style=\"flex:1\"></span>" +
    '<button class="btn" id="rpCancel">取消</button>' +
    '<button class="btn btn-primary" id="rpApply"' + (willChange.length ? "" : " disabled") + ">应用 " + willChange.length + " 项</button></div>";
  const close = () => { try { mask.remove(); dlg.remove(); } catch (e) { /* 忽略 */ } };
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  mask.addEventListener("click", close);
  dlg.querySelector("#rpCancel").addEventListener("click", close);
  dlg.querySelector("#rpApply").addEventListener("click", () => {
    close();
    setStatus(label + " 开始 …");
    api.call(act === "rename_c" ? "mm_rename" : "mm_localize", paths).then(() => {
      setStatus("完成，刷新中 …");
      api.call("scan_models");
      pollMmScan();
    }).catch(() => {});
  });
}
$("#mmRenameMain").addEventListener("click", () => {
  const def = (state.cfg && state.cfg.rename_menu_default) || "custom";
  mmRenameRun(def);
});
// 子菜单显示：JS 延迟隐藏（200ms 缓冲，穿过空隙不消失）+ CSS hover 双保险
let renameHideTimer = null;
$("#mmRenameGroup").addEventListener("mouseenter", () => {
  clearTimeout(renameHideTimer);
  $("#mmRenameSub").style.display = "block";
});
$("#mmRenameGroup").addEventListener("mouseleave", () => {
  renameHideTimer = setTimeout(() => { $("#mmRenameSub").style.display = "none"; }, 200);
});
$("#mmRenameSub").addEventListener("mouseenter", () => {
  clearTimeout(renameHideTimer);
  $("#mmRenameSub").style.display = "block";
});
$("#mmRenameSub").addEventListener("click", (e) => {
  const item = e.target.closest(".submenu-item");
  if (!item) return;
  $("#mmRenameSub").style.display = "none";
  mmRenameRun(item.dataset.act);
});
$("#mmSendRp").addEventListener("click", async () => {
  const p = mmCheckedPaths();
  if (!p) { setStatus("请先勾选或选中模型"); return; }
  await api.call("rp_add_paths", p);
  setStatus("已发送 " + p.length + " 个到反向解析");
});

// 批量从 C 站同步：勾选模型 → 加入反向解析队列并立即开始 → 进度 → 汇总
let _batchSyncBusy = false;
async function mmSyncBatchRun() {
  if (_batchSyncBusy) { setStatus("批量同步正在进行中…"); return; }
  const paths = mmCheckedPaths();
  if (!paths) { setStatus("请先勾选要同步的模型（可先「全选」）"); return; }
  const ok = await confirmBox(
    "将从 C 站获取这 " + paths.length + " 个模型的最新信息（名称 / 简介 / 触发词 / 版本等），并更新本地记录。" +
    "\n\n每模型约 1~4 秒，数据量大时需要较长时间。开始吗？");
  if (!ok) return;
  _batchSyncBusy = true;
  try {
    await api.call("rp_add_paths", paths);
    await api.call("rp_start");
    const t0 = Date.now();
    let st = null;
    while (true) {
      await new Promise((r) => setTimeout(r, 1500));
      st = await api.call("rp_state").catch(() => null);
      if (st && st.total) setStatus("批量同步中… " + (st.done || 0) + " / " + st.total);
      if (!st || st.running === false) break;
      if (Date.now() - t0 > 3 * 3600 * 1000) break;
    }
    const rows = (await api.call("rp_get_rows").catch(() => null)) || [];
    const failN = rows.filter((r) => /失败|未收录|错误/.test(String(r.status || ""))).length;
    const okN = Math.max(0, rows.length - failN);
    setStatus("批量同步完成：成功 " + okN + " 个" + (failN ? "，失败/未收录 " + failN + " 个" : "") + "（列表显示如需刷新请点「刷新」）");
    try { if (typeof window.toast === "function") window.toast("批量同步完成：成功 " + okN + " 个" + (failN ? "，失败 " + failN + " 个" : ""), 5000); } catch (e) { }
  } catch (e) {
    setStatus("批量同步失败：" + (e && e.message || e));
  } finally {
    _batchSyncBusy = false;
  }
}
document.querySelectorAll(".mm-metro [data-act='syncbatch']").forEach((it) => {
  if (it._sb) return; it._sb = 1;
  it.addEventListener("click", () => { _closeMmMenus(); mmSyncBatchRun(); });
});

// 打开入口：行双击 / 瀑布流卡片双击（单击统一为选中）

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
let rpLastSel = -1;
$("#rpTable tbody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const rows = Array.from($$("#rpTable tbody tr"));
  const idx = rows.indexOf(tr);
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.shiftKey && rpLastSel >= 0) {
    const a = Math.min(rpLastSel, idx), b = Math.max(rpLastSel, idx);
    rows.slice(a, b + 1).forEach((r) => r.classList.add("sel-row"));
  } else if (ctrl) {
    tr.classList.toggle("sel-row");
  } else {
    rows.forEach((r) => r.classList.remove("sel-row"));
    tr.classList.add("sel-row");
  }
  rpLastSel = idx;
});
$("#rpClearAll").addEventListener("click", async () => {
  const ok = await confirmBox("确定清空反向解析列表的全部条目？");
  if (!ok) return;
  await api.call("rp_clear");
  rpRefresh();
  $("#rpStart").disabled = false;
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
    let s = null;
    try {
      s = await api.call("rp_state");
      await rpRefresh();
    } catch (e) { s = null; }
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
  ["基本", "api_key", "Civitai API Key", "password"],
  ["基本", "download_dir", "下载目录", "text"],
  ["基本", "models_dirs", "模型管理目录（每行一个）", "dirs"],
  ["基本", "site_domain", "站点域名", "select", ["civitai.red", "civitai.com"]],
  ["网络", "proxy_enabled", "启用代理", "bool"],
  ["网络", "ssl_verify", "启用证书验证", "bool"],
  ["网络", "proxy_address", "代理地址", "text"],
  ["网络", "max_concurrent_downloads", "并发下载数", "number"],
  ["网络", "download_timeout", "下载超时(秒)", "number"],
  ["网络", "download_retry", "断流自动重试次数", "number"],
  ["网络", "hash_threads", "哈希线程数", "number"],
  ["下载", "gen_metadata", "完成后自动生成 json/info", "bool"],
  ["下载", "download_cover", "完成后自动下载封面", "bool"],
  ["下载", "ask_move_after_download", "完成后询问移动分类", "bool"],
  ["下载", "download_target_dir", "下载目标文件夹（预设）", "dir"],
  ["下载", "rename_clean_rules", "文件名清理符号", "select", [["", "不清理"], ["comma", "去逗号（推荐）"], ["comma,paren", "去逗号 + 括号"], ["comma,paren,dash", "去逗号+括号，横线/下划线→空格"]]],
  ["下载", "metadata_format", "metadata 格式", "select", ["sd", "civitai", "both"]],
  ["翻译", "baidu_appid", "百度翻译 APP ID", "text"],
  ["翻译", "baidu_key", "百度翻译密钥", "password"],
  ["翻译", "auto_translate", "反向解析自动翻译", "bool"],
  ["翻译", "translate_filename", "下载文件名为中文", "bool"],
  ["界面", "theme", "界面主题", "select", [
    ["dark", "深色"],
    ["dark_purple", "暮紫（暗）"],
    ["dark_blue", "深海（暗）"],
    ["dark_green", "森林（暗）"],
    ["dark_red", "熔岩（暗）"],
    ["light", "浅色"],
    ["light_blue", "晴空（亮）"],
    ["light_pink", "樱粉（亮）"],
    ["light_green", "薄荷（亮）"],
    ["metro", "Metro 磁贴（Win10 风 · 直角扁平）"],
    ["modern", "现代浅色"],
  ]],
  ["界面", "ui_zoom", "界面缩放", "select", ["80", "90", "100", "110", "125", "150"]],
  ["界面", "ui_scheme", "Metro 亮暗", "select", [["light", "亮色"], ["dark", "暗色"], ["auto", "跟随系统"]]],
  ["界面", "metro_accent", "Metro 主题色", "select", [["#0078D4", "Windows 蓝（默认）"], ["#107C10", "翡翠绿"], ["#7A3FF2", "紫罗兰"], ["#B26A00", "琥珀橙"], ["#C42B1C", "绛红"], ["#006E8C", "青碧"], ["system", "跟随系统主题色"]]],
  ["界面", "rename_menu_default", "改名默认动作", "select", [["custom", "自定义改名"], ["rename_c", "文件名改成C站名"], ["localize", "文件名翻中文"]]],
  ["界面", "confirm_buttons_flip", "确认弹窗按钮翻转", "bool"],
  ["界面", "default_page", "启动默认页", "select", [["models", "模型管理"], ["download", "批量下载"], ["dlmanager", "下载管理"], ["reverse", "反向解析"], ["workflow", "工作流分析"], ["settings", "设置"]]],
  ["界面", "default_view", "模型默认视图", "select", [["waterfall", "瀑布流"], ["list", "列表"]]],
  ["界面", "zebra_rows", "模型列表斑马纹", "bool"],
  ["界面", "ambient_bg", "顶部氛围动态背景", "bool"],
  ["界面", "ui_mode", "界面模式", "select", [["window", "原生窗口（默认）"], ["browser", "浏览器模式（可托盘 / 关页面退）"]]],
  ["界面", "window_wait_seconds", "窗口模式等待秒数", "number"],
  ["界面", "close_action", "点窗口关闭按钮时", "select", [["exit", "退出软件（默认）"], ["minimize", "最小化到任务栏（不退出）"]]],
  ["下载", "update_keep_old", "更新后如何处理旧版本", "select", [["keep", "保留旧版文件（默认）"], ["delete", "删除旧版（移入回收站，可还原）"]]],
  ["界面", "webview_disable_gpu", "禁用 GPU 加速（软件渲染）", "bool"],
  ["界面", "tray_icon", "浏览器模式：托盘图标", "bool"],
  ["界面", "exit_when_page_closed", "浏览器模式：关页面后自动退出", "bool"],
];

// ===== Metro 外观：亮暗（可跟随系统）+ 主题色（可跟随系统主题色）=====
let _schemeMQ = null;
function applyUiAppearance() {
  const scheme = String((state.cfg && state.cfg.ui_scheme) || "light");
  const acc = String((state.cfg && state.cfg.metro_accent) || "#0078D4");
  const root = document.documentElement;
  if (scheme === "auto") {
    if (!_schemeMQ) {
      try {
        _schemeMQ = window.matchMedia("(prefers-color-scheme: dark)");
        _schemeMQ.addEventListener("change", () => applyUiAppearance());
      } catch (e) { _schemeMQ = null; }
    }
    root.dataset.scheme = (_schemeMQ && _schemeMQ.matches) ? "dark" : "light";
  } else {
    root.dataset.scheme = scheme === "dark" ? "dark" : "light";
  }
  const _setAcc = (c) => {
    root.style.setProperty("--metro-accent", c);
    // --primary 只在 Metro 主题下跟随主题色；经典主题必须保持自己的主题主色（否则主按钮变黑底黑字）
    if (root.dataset.theme === "metro") root.style.setProperty("--primary", c);
    else root.style.removeProperty("--primary");
  };
  if (/^#([0-9a-f]{6})$/i.test(acc)) {
    _setAcc(acc);
  } else if (acc === "system") {
    api.call("get_system_accent").then((c) => {
      if (c && /^#([0-9a-fA-F]{6})$/.test(c)) _setAcc(c);
    }).catch(() => { });
  }
  // 主题切换后：代理按钮标签需要按主题重刷（经典带 emoji / Metro 不带）
  try { (window._mmLabelSync || []).forEach((f) => f()); } catch (e) { }
  try { _applyMetroOpts(); } catch (e) { }
}

// 设置项 hover 说明（鼠标移到标签上显示功能作用）
const SETTING_TIPS = {
  "api_key": "Civitai 账号免费生成的 API Key，用于查询模型信息、下载与反向解析。在 civitai.com/user/account 登录后点「New API Key」生成",
  "download_dir": "模型下载后存放的位置，可填任意文件夹（如 D:\\models）",
  "models_dirs": "本地模型管理目录：软件从这里扫描模型并显示封面/触发词。WebUI 与 ComfyUI 分开存放时每行填一个（如 D:\\sd-webui-forge-neo\\webui\\models 和 D:\\ComfyUI\\models），扫描会合并显示",
  "site_domain": "打开 C 站页面用的域名：网络异常时可在 civitai.red 与 civitai.com 之间切换",
  "proxy_enabled": "开启后所有请求走代理（科学上网工具），解析/下载失败时可尝试开启",
  "ssl_verify": "关闭后跳过 TLS 证书验证：代理软件开了 HTTPS 解密（MITM）导致报证书错误时取消勾选即可恢复",
  "proxy_address": "代理软件地址，如 127.0.0.1:7897（Clash 默认端口）",
  "max_concurrent_downloads": "同时下载的任务数：越大越快，但占用更多带宽",
  "download_timeout": "单个文件下载无响应超过该秒数判定失败并重试",
  "download_retry": "连接被掐断（SSL EOF / 超时，代理节点不稳定时常见）自动重试次数：每次从已下载的断点续传，不重下。0 = 不重试",
  "rename_clean_rules": "下载命名与「改成 C 站名」一键改名时清理符号：ComfyUI 会把文件名里的逗号当成提示词分隔符，导致找不到 lora（如 py,ill,xl 这种名字）。推荐「去逗号」",
  "hash_threads": "计算文件哈希（校验/反向解析用）的线程数",
  "gen_metadata": "下载完成后自动生成 <模型名>.civitai.info / .json 元数据；没有它，模型管理里看不到名称/触发词",
  "download_cover": "下载完成后自动把 C 站预览图保存到模型目录（模型管理显示缩略图用）",
  "ask_move_after_download": "下载完成后询问是否把文件移动到指定文件夹（适合按类型归档；设了「下载目标文件夹」后本项自动不弹）",
  "window_wait_seconds": "窗口模式下等几秒没出界面就自动改用浏览器模式（默认 12 秒）。机器慢或 WebView2 正在更新时可调大；想固定用浏览器模式就把「界面模式」改成浏览器模式",
  "update_keep_old": "「更新页面」下载新版完成后的旧版处理：默认【保留旧版文件】（新版和旧版并存，要清理可用「查重 → 删旧留新」）；选【删除旧版】则下载完成后把旧版文件移入回收站（含预览图/元数据，可还原）。只影响「更新下载」，不影响普通批量下载",
  "download_target_dir": "预设下载落地文件夹（在模型目录里选）：下载的模型连 json/封面直接放进它，不再弹窗询问。也可在「批量下载」页临时选择",
  "metadata_format": "sd = WebUI 能直接识别的扁平 json；civitai = C 站原始 info 结构；both = 两个都生成",
  "baidu_appid": "百度翻译开放平台 APP ID（免费申请），用于反向解析自动翻译模型名/简介",
  "baidu_key": "百度翻译开放平台密钥，与 APP ID 配套",
  "auto_translate": "反向解析时自动把模型名/简介翻译成中文",
  "translate_filename": "下载时把模型名翻译成中文作为文件名（需要配置百度翻译）",
  "theme": "界面主题：深色 / 浅色 / 现代浅色；选 Metro 磁贴 = Win10 直角扁平风（顶部按钮分组 + 默认瀑布流）",
  "ui_zoom": "界面整体缩放比例（百分比）",
  "ui_scheme": "Metro 主题的亮暗模式：亮色 / 暗色 / 跟随系统（Windows 的浅色/深色设置）",
  "metro_accent": "Metro 主题的强调色：影响按钮、选中、链接等；「跟随系统主题色」读取 Windows 个性化里的主题色",
  "rename_menu_default": "点「改名」默认执行的动作：自定义 / 改成 C 站模型名 / 文件名翻中文",
  "confirm_buttons_flip": "交换确认弹窗中「确定/取消」按钮位置（防误点）",
  "default_page": "启动软件后默认打开的页面",
  "default_view": "模型管理默认展示方式：瀑布流（大图卡片）或列表（表格）",
  "zebra_rows": "模型列表行间斑马纹，便于横向对齐查看",
  "ambient_bg": "顶部氛围动态背景（渐变光晕）",
  "ui_mode": "界面显示方式：窗口 = 原生窗口（默认）；浏览器 = 软件在后台跑、界面用系统浏览器打开 —— 界面卡死/崩溃不会拖死下载任务，刷新页面即可恢复（推荐受「启动卡死」困扰时使用）。改完重启软件生效",
  "close_action": "点窗口右上角 X 的行为：退出软件（默认）/ 最小化到任务栏（软件继续在后台跑，点任务栏图标可还原）。想彻底退出可改用托盘菜单或任务管理器",
  "webview_disable_gpu": "禁用 WebView2 的 GPU 加速（强制软件渲染）。默认关闭——软件渲染会让「顶部氛围动态背景」等动画吃满 CPU、笔记本/台式机都会明显升温。只有在遇到「WebView2 建窗卡死」且关掉氛围背景仍无法解决时才建议勾选",
  "tray_icon": "浏览器模式：在托盘显示图标（左键打开界面，右键菜单里有「退出软件」）",
  "exit_when_page_closed": "浏览器模式：关掉页面且没有任务在下载时，自动退出软件；有下载任务时会继续在后台跑",
  "target_env": "你的模型最终要放进哪个部署环境：WebUI/Forge 用 Lora、Stable-diffusion 目录；ComfyUI 用 loras、checkpoints 目录。整理前必须选择",
  "organize_mode": "整理方式：手动 = 每个模型弹窗让你选文件夹；C 站 tags = 按 C 站分类自动归档（需先反向解析生成 info）；自定义规则 = 按你填的关键词规则归档",
  "organize_rules": "每行一条：关键词1, 关键词2 -> 目标文件夹（如：NoobAI, noob -> NoobAI）",
};

// 设置分组折叠
$("#settingsForm").addEventListener("click", (e) => {
  const lg = e.target.closest("fieldset.form-section > legend");
  if (!lg) return;
  const fs = lg.parentElement;
  const body = fs.querySelector(".form-grid, .bd-links, .form-item, textarea, label, div");
  const grid = fs.querySelector(".form-grid");
  if (!grid) return;
  const collapsed = fs.dataset.collapsed === "1";
  fs.dataset.collapsed = collapsed ? "0" : "1";
  grid.style.display = collapsed ? "" : "none";
  const extra = fs.querySelector(".bd-links");
  if (extra) extra.style.display = collapsed ? "" : "none";
  const rules = fs.querySelector("textarea.rules");
  if (rules) rules.closest(".form-grid") && (rules.closest(".form-grid").style.display = collapsed ? "" : "none");
  if (!lg.dataset.arrow) lg.dataset.arrow = lg.textContent.replace(/[▾▸]\s*$/, "").trim();
  lg.innerHTML = lg.dataset.arrow + (collapsed ? " ▸" : " ▾");
  lg.style.cursor = "pointer";
});
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
      const tip = SETTING_TIPS[key] || "";
      if (type === "bool") {
        input = '<label class="check"' + (tip ? ' data-tip="' + esc(tip) + '"' : "") + '><input type="checkbox" data-key="' + key + '" ' + (v ? "checked" : "") + "/> " + esc(label) + "</label>";
      } else if (type === "select") {
        input = '<select data-key="' + key + '">' + opts.map((o) => {
          const val = Array.isArray(o) ? o[0] : o;
          const label = Array.isArray(o) ? o[1] : o;
          return '<option value="' + esc(val) + '" ' + (String(v) === val ? "selected" : "") + ">" + esc(label) + "</option>";
        }).join("") + "</select>";
      } else if (type === "number") {
        input = '<input class="input" type="number" data-key="' + key + '" value="' + esc(v) + '"/>';
      } else if (type === "password") {
        input = '<div class="pwd-wrap"><input class="input" type="password" data-key="' + key + '" value="' + esc(v || "") + '"/>' +
          '<span class="pwd-eye" data-eye="' + key + '"></span></div>';
      } else if (type === "dirs") {
        const list = (Array.isArray(v) && v.length) ? v : (state.cfg.models_dir ? [state.cfg.models_dir] : []);
        input = '<textarea class="input" rows="3" data-key="' + key + '" placeholder="D:\\sd-webui-forge-neo\\webui\\models">' + esc(list.join("\n")) + '</textarea>' +
          '<div class="tip-inline">每行一个文件夹；WebUI 与 ComfyUI 分开存放时都填进来，扫描会合并显示（推荐填你实际的 webui\\models 和 comfyui\\models 目录）</div>';
      } else if (type === "dir") {
        input = '<div class="dir-pick"><input class="input" data-key="' + key + '" value="' + esc(v || "") + '" readonly placeholder="（未设置：用默认下载目录，完成后弹窗询问）"/>' +
          '<button type="button" class="btn btn-tiny" data-dirpick="' + key + '">选择</button>' +
          '<button type="button" class="btn btn-tiny" data-dirclear="' + key + '">清除</button></div>';
      } else {
        input = '<input class="input" data-key="' + key + '" value="' + esc(v || "") + '"/>';
      }
      if (type === "bool") return '<div class="form-item">' + input + "</div>";
      return '<label' + (tip ? ' data-tip="' + esc(tip) + '"' : "") + ">" + esc(label) + "</label><div>" + input + "</div>";
    }).join("");
    // 翻译组追加百度申请链接
    let extra = "";
    if (g.indexOf("翻译") >= 0) {
      extra = '<div class="bd-links"><div class="bd-links-title">百度翻译 API 申请指南：</div>' +
        BAIDU_LINKS.map((l) =>
          '<div class="bd-link" data-url="' + esc(l.url) + '"><span class="bd-link-label">' + esc(l.label) + "</span><span class=\"bd-link-desc\">" + esc(l.desc) + "</span></div>"
        ).join("") + "</div>";
    }
    return '<fieldset class="form-section"><legend><span class="fold-btn">▾</span> ' + esc(g) + "</legend><div class=\"form-grid\">" + body + "</div>" + extra + "</fieldset>";
  }).join("");
  // 分类规则组（目标环境 + 整理模式 + 自定义规则）
  form.innerHTML += '<fieldset class="form-section"><legend>分类规则</legend><div class="form-grid">' +
    '<label>目标环境</label><div><select data-key="target_env">' +
    [["", "未选择（必须选择才能整理）"], ["webui", "WebUI / Forge（Lora、Stable-diffusion）"], ["comfyui", "ComfyUI（loras、checkpoints）"]]
      .map((o) => '<option value="' + o[0] + '"' + (String(state.cfg.target_env) === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") +
    "</select></div>" +
    '<label>整理模式</label><div><select data-key="organize_mode">' +
    [["manual", "手动分类（逐个选择文件夹）"], ["civitai", "C 站 tags 自动分类（需 info）"], ["rules", "自定义规则分类"]]
      .map((o) => '<option value="' + o[0] + '"' + (String(state.cfg.organize_mode) === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") +
    "</select></div>" +
    '<label>整理分类规则</label><div><textarea class="rules" id="organizeRules">' + esc((state.cfg.organize_rules || []).map((r) => (r.keywords || []).join(", ") + " -> " + r.folder).join("\n")) + "</textarea></div>" +
    "</div></fieldset>";
  // 维护区块：清理伪 C 站图片缓存
  form.innerHTML += '<fieldset class="form-section"><legend>维护</legend><div class="form-grid">' +
    '<label data-tip="删除模型目录下所有「模型名.images」图片缓存文件夹（详情面板里下载的示例图），释放磁盘空间；封面缩略图不受影响">图片缓存清理</label>' +
    '<div><button class="btn" id="btnCleanImgCache">删除下载的图片文件夹</button></div>' +
    "</div></fieldset>";
  // Metro 专属项（亮暗 / 主题色）仅在 Metro 主题下显示；斑马纹在 Metro 下自动关闭（样式不生效，用户要求直接关掉）
  _applyMetroOpts();

}


// Metro 主题的选项联动：亮暗/主题色仅 Metro 显示；斑马纹仅 Metro 下强制关闭
function _applyMetroOpts() {
  try {
    const isMetro = document.documentElement.dataset.theme === "metro";
    ["ui_scheme", "metro_accent"].forEach((k) => {
      const el = document.querySelector('#settingsForm [data-key="' + k + '"]');
      if (!el) return;
      const cell = el.parentElement; if (cell) cell.classList.add("metro-opt");
      const lab = cell && cell.previousElementSibling; if (lab) lab.classList.add("metro-opt");
    });
    const zb = document.querySelector('#settingsForm [data-key="zebra_rows"]');
    if (zb) {
      const zw = zb.closest("div");
      const zl = zw && zw.previousElementSibling;
      if (zw) zw.classList.toggle("classic-opt", isMetro);
      if (zl) zl.classList.toggle("classic-opt", isMetro);
      const mode = isMetro ? "metro" : "normal";
      if (zb._lastMode !== mode) {
        zb._lastMode = mode;
        zb.disabled = isMetro;
        if (isMetro) zb.checked = false;
        else zb.checked = !!(state.cfg && state.cfg.zebra_rows);
      }
      const wrap = zb.closest("div");
      const lab = wrap && wrap.previousElementSibling;
      if (lab) lab.dataset.tip = isMetro ? "Metro 主题不使用斑马纹：该选项在 Metro 下自动关闭" : "模型列表行间斑马纹，便于横向对齐查看";
    }
  } catch (e) { }
}

// 密码框小眼睛（切换明文显示）
$("#settingsForm").addEventListener("click", (e) => {
  const eye = e.target.closest(".pwd-eye");
  if (!eye) return;
  const key = eye.dataset.eye;
  const inp = document.querySelector('.pwd-wrap input[data-key="' + key + '"]');
  if (!inp) return;
  inp.type = inp.type === "password" ? "text" : "password";
  eye.textContent = inp.type === "password" ? "显示" : "隐藏";
});
// 工作流缺失模型搜索下载（Civitai + HuggingFace）
$("#wfModels").addEventListener("click", (e) => {
  const btn = e.target.closest(".wf-search");
  if (!btn) return;
  const q = encodeURIComponent(btn.dataset.search || "");
  api.call("open_url", "https://civitai.red/search/models?query=" + q);
});

// ===== 设置 =====
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
    else if (el.tagName === "TEXTAREA") cfg[k] = el.value.split("\n").map((s) => s.trim()).filter(Boolean);
    else cfg[k] = el.value;
  });
  updateOrganizeBtns();
  cfg.organize_rules = $("#organizeRules").value.split("\n").map((l) => {
    const m = l.match(/^\s*(.+?)\s*(?:->|=>|→)\s*(.+?)\s*$/);
    return m ? { keywords: m[1].split(",").map((s) => s.trim()).filter(Boolean), folder: m[2].trim() } : null;
  }).filter(Boolean);
  await api.call("save_config", cfg);
  state.cfg = await api.call("get_config");
  setStatus("设置已保存");
  // 不刷新页面：直接应用主题/缩放/表单（避免白屏闪烁）
  applyZoom(Number(state.cfg.ui_zoom) || 100);
  document.documentElement.dataset.theme = state.cfg.theme || "modern";
  applyUiAppearance();
  buildSettingsForm();
});

// 设置里「下载目标文件夹」的选择/清除（点击即时保存，不依赖底部「保存设置」）
$("#settingsForm").addEventListener("click", async (e) => {
  const pick = e.target.closest("[data-dirpick]");
  if (pick) {
    const p = await pickFolderModal();
    if (p && await applyDownloadTarget(p)) {
      const inp = $('#settingsForm [data-key="' + pick.dataset.dirpick + '"]');
      if (inp) inp.value = p;
    }
    return;
  }
  const clr = e.target.closest("[data-dirclear]");
  if (clr) {
    if (await applyDownloadTarget("")) {
      const inp = $('#settingsForm [data-key="' + clr.dataset.dirclear + '"]');
      if (inp) inp.value = "";
    }
  }
});

// 设置项即时生效：主题/缩放等改完立即应用，不必等「保存设置」（也不触发整页刷新）
$("#settingsForm").addEventListener("change", (e) => {
  const el = e.target.closest("[data-key]");
  if (!el) return;
  const key = el.dataset.key;
  const val = el.type === "checkbox" ? el.checked : (el.type === "number" ? Number(el.value) : el.value);
  if (key === "theme") {
    state.cfg.theme = val;
    document.documentElement.dataset.theme = val || "modern";
    applyUiAppearance();   // 主题切换：重算 --primary/主题色 + 重刷代理按钮标签（经典 emoji / Metro 无）
  } else if (key === "ui_scheme" || key === "metro_accent") {
    if (state.cfg) state.cfg[key] = val;
    applyUiAppearance();
  } else if (key === "ui_zoom") {
    applyZoom(Number(val) || 100);
  }
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

// 清理图片缓存（删除 *.images 文件夹）
$("#settingsForm").addEventListener("click", async (e) => {
  const btn = e.target.closest("#btnCleanImgCache");
  if (!btn) return;
  const r = JSON.parse(await api.call("cleanup_img_cache", true) || "{}");
  if (!r.ok || !r.count) {
    showToast(r.msg || "没有图片缓存文件夹（未下载过全部图片）");
    return;
  }
  const mb = (r.size / 1048576).toFixed(1);
  const list = r.dirs.slice(0, 5).map((d) => "· " + d.path).join("\n");
  const more = r.dirs.length > 5 ? "\n… 等 " + r.dirs.length + " 个" : "";
  const ok = await confirmBox(
    "将删除 <b>" + r.count + "</b> 个图片缓存文件夹（共 <b>" + mb + " MB</b>）：<br/>" +
    esc(list).replace(/\n/g, "<br/>") + esc(more).replace(/\n/g, "<br/>") +
    "<br/><br/>删除后详情面板的本地示例图会清空（封面缩略图不受影响）。确定删除？");
  if (!ok) return;
  const r2 = JSON.parse(await api.call("cleanup_img_cache", false) || "{}");
  if (r2 && r2.ok) {
    showToast("已删除 " + (r2.removed || 0) + " 个图片缓存文件夹");
    // 刷新模型管理（缩略图可能变化）
    api.call("scan_models");
  } else {
    showToast("清理失败");
  }
});

// ================= 启动 =================
async function init() {
  state.cfg = await api.call("get_config");
  window.__ready = true;
  refreshDlTarget();
  // 应用主题（dark / light / modern）
  const theme = state.cfg.theme || "modern";
  document.documentElement.dataset.theme = theme;
  // 主题既已确定：立即重算 亮暗/主题色/设置页联动，并重刷代理按钮标签
  // （启动时 bindMmMetro 早于 init 运行，那一刻主题还是空的 → 代理标签会走经典分支；这里补一次重刷）
  try { applyUiAppearance(); } catch (e) { }
  // 界面缩放
  applyZoom(Number(state.cfg.ui_zoom) || 100);
  // 启动默认页
  const defPage = state.cfg.default_page || "models";
  const tab = document.querySelector('.nav-tab[data-page="' + defPage + '"]');
  if (tab) tab.click();
  // 应用模型管理默认视图（设置项 default_view）
  state.mmView = state.cfg.default_view === "waterfall" ? "masonry" : "list";
  try { syncViewSeg(); } catch (e) { /* 忽略 */ }
  const vtb = $("#mmViewToggle");
  if (vtb) vtb.textContent = state.mmView === "masonry" ? "列表视图" : "瀑布流";
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

// ===== 首次使用引导（主题 / 下载目录 / API key / 模型目录 / 反向解析） =====
const OB_STEPS = ["功能", "主题", "下载目录", "API Key", "模型目录", "反向解析"];
let obStep = 0;
let obTheme = "dark";
let obDirVal = "";   // 跨步骤保存（输入框只在对应步骤渲染）
let obKeyVal = "";
let obModelDirs = []; // 模型管理目录（多目录）
let obMini = false;   // 迷你模式：引导缩小悬浮右侧，不中断

// 迷你模式切换：全屏 ⇄ 右下角小窗
function setObMini(mini) {
  obMini = mini;
  const mask = $("#obMask");
  mask.classList.toggle("mini", mini);
  if (mini) {
    $("#obMiniTitle").textContent = OB_STEPS[obStep] + "（第 " + (obStep + 1) + "/" + OB_STEPS.length + " 步）";
  }
}
$("#obMiniContinue").addEventListener("click", () => setObMini(false));
$("#obMiniClose").addEventListener("click", async () => {
  setObMini(false);
  await finishOnboarding();
});
function showOnboarding() {
  obStep = 0;
  obTheme = state.cfg.theme || "dark";
  obDirVal = state.cfg.download_dir || "";
  obKeyVal = state.cfg.api_key || "";
  const md = state.cfg.models_dirs;
  obModelDirs = (Array.isArray(md) && md.length) ? md.slice() : (state.cfg.models_dir ? [state.cfg.models_dir] : []);
  obMini = false;
  $("#obMask").classList.remove("mini");
  $("#obMask").style.display = "flex";
  renderOnboarding();
}
function renderOnboarding() {
  $("#obSteps").innerHTML = OB_STEPS.map((s, i) =>
    '<div class="ob-step ' + (i === obStep ? "active" : i < obStep ? "done" : "") + '">' + s + "</div>").join("");
  $("#obPrev").style.display = obStep === 0 ? "none" : "inline-block";
  $("#obNext").textContent = obStep === OB_STEPS.length - 1 ? "完成 " : "下一步";
  const body = $("#obBody");
  if (obStep === 0) {
    // 第一页：功能介绍 —— 六个按钮对应六个页面，hover 显示功能简介
    const feats = [
      ["", "批量下载", "download", "粘贴 C 站 / HuggingFace 链接，批量解析并下载；支持付费模型到期提醒"],
      ["", "下载管理", "dlmanager", "查看下载进度、断点续传、暂停/重试/移除任务，完成后自动写元数据"],
      ["", "模型管理", "models", "扫描本地模型、缩略图瀑布流、改名/整理/校验完整性/一键清理"],
      ["", "反向解析", "reverse", "把已下载的模型文件识别出 C 站信息：名字、触发词、类型、封面"],
      ["", "工作流分析", "workflow", "拖入 ComfyUI 的 json/png 工作流，解析节点、模型引用与参数"],
      ["", "设置", "settings", "下载目录、API Key、主题缩放、分类规则、清理缓存、新手引导"],
    ];
    body.innerHTML =
      '<div class="ob-label">六个页面，各司其职（鼠标移上去查看功能介绍，点击直接进入）：</div>' +
      '<div class="ob-feat-grid">' +
      feats.map((f) =>
        '<div class="ob-feat-btn" data-page="' + f[2] + '" data-tip="' + esc(f[3]) + '"><span>' + f[0] + "</span><span>" + f[1] + "</span></div>"
      ).join("") +
      "</div>" +
      '<div style="margin-top:10px;text-align:center">' +
      '<a class="ob-github" id="obGithub">GitHub 仓库（源码 / 更新 / 反馈）</a></div>' +
      '<div style="color:var(--text-dim);font-size:12px;margin-top:8px;text-align:center">免费 · 全功能 · 无付费墙</div>';
    document.querySelectorAll(".ob-feat-btn").forEach((el) => {
      el.addEventListener("click", async () => {
        const page = el.dataset.page;
        // 切换页面但不结束引导：引导缩小悬浮在画面右侧继续
        const tab = document.querySelector('.nav-tab[data-page="' + page + '"]');
        if (tab) tab.click();
        setObMini(true);
      });
    });
    $("#obGithub").addEventListener("click", () => api.call("open_url", "https://github.com/ADVICEsama/CivitaiFreeTool"));
  } else if (obStep === 1) {
    body.innerHTML =
      '<div class="ob-label">选择界面主题（可随时在设置页更换）</div>' +
      '<div class="ob-themes" id="obThemes">' +
      '<div class="ob-theme" data-t="dark"><div class="sw" style="background:#171221;border:2px solid #0a84ff"></div>深色</div>' +
      '<div class="ob-theme" data-t="dark_purple"><div class="sw" style="background:#16112b;border:2px solid #a06bff"></div>暮紫</div>' +
      '<div class="ob-theme" data-t="dark_blue"><div class="sw" style="background:#0d1524;border:2px solid #38bdf8"></div>深海</div>' +
      '<div class="ob-theme" data-t="dark_green"><div class="sw" style="background:#0e1a14;border:2px solid #34d399"></div>森林</div>' +
      '<div class="ob-theme" data-t="dark_red"><div class="sw" style="background:#1d1010;border:2px solid #ff7a59"></div>熔岩</div>' +
      '<div class="ob-theme" data-t="light"><div class="sw" style="background:#f2f2f2;border:1px solid #ddd"></div>浅色</div>' +
      '<div class="ob-theme" data-t="light_blue"><div class="sw" style="background:#eef4fb;border:1px solid #2f7cf6"></div>晴空</div>' +
      '<div class="ob-theme" data-t="light_pink"><div class="sw" style="background:#fdf2f4;border:1px solid #ec5d7a"></div>樱粉</div>' +
      '<div class="ob-theme" data-t="light_green"><div class="sw" style="background:#f0f8f3;border:1px solid #2e9e63"></div>薄荷</div>' +
      '<div class="ob-theme" data-t="modern"><div class="sw" style="background:#efefef;border:1px solid #ddd"></div>现代浅色</div></div>';
    document.querySelectorAll("#obThemes .ob-theme").forEach((el) => {
      if (el.dataset.t === obTheme) el.classList.add("sel");
      el.addEventListener("click", () => {
        obTheme = el.dataset.t;
        // 立即写入 state + 同步设置页下拉：中途保存设置不会把刚选的主题覆盖回旧值
        if (state.cfg) state.cfg.theme = obTheme;
        document.querySelectorAll('select[data-key="theme"]').forEach((sel) => { sel.value = obTheme; });
        document.documentElement.dataset.theme = obTheme;
        applyUiAppearance();
        document.querySelectorAll("#obThemes .ob-theme").forEach((x) => x.classList.remove("sel"));
        el.classList.add("sel");
      });
    });
  } else if (obStep === 2) {
    body.innerHTML =
      '<div class="ob-label">下载目录（模型下载后存放位置，可修改）</div>' +
      '<div style="display:flex;gap:8px"><input class="input" id="obDir" style="flex:1" value="' + esc(obDirVal) + '"/>' +
      '<button class="btn" id="obBrowse">浏览</button></div>' +
      '<div style="color:var(--text-dim);font-size:12px;margin-top:6px">默认：软件根目录下的 downloads/models 文件夹</div>';
    $("#obDir").addEventListener("input", () => { obDirVal = $("#obDir").value; });
    $("#obBrowse").addEventListener("click", async () => {
      const picked = await api.call("pick_dir");
      if (picked) { obDirVal = picked; $("#obDir").value = picked; }
    });
    $("#obBrowse2") && null;
  } else if (obStep === 3) {
    body.innerHTML =
      '<div class="ob-label">Civitai API Key（免费申请，用于查询模型信息与下载）</div>' +
      '<input class="input" id="obKey" type="password" value="' + esc(obKeyVal) + '" placeholder="粘贴你的 API Key"/>' +
      '<div class="ob-guide" id="obGuide" style="display:none">' +
      '<div style="font-weight:600;margin-bottom:6px">如何注册 API Key：</div>' +
      '<div>1. 打开 <a class="ob-link" id="obApiPage">civitai.com/user/account</a>（登录后点 Account Settings 生成 API Keys）</div>' +
      '<div>2. 登录账号后点击「New API Key」生成</div>' +
      '<div>3. 复制生成的 Key 粘贴到上方输入框即可</div></div>' +
      '<div class="ob-actions2"><button class="btn" id="obToggleGuide">如何注册 API？</button>' +
      '<button class="btn" id="obOpenApi">打开注册页</button></div>' +
      '<div style="color:var(--text-dim);font-size:12px;margin-top:6px">不填也能用，但模型查询与部分下载功能受限。</div>';
    $("#obKey").addEventListener("input", () => { obKeyVal = $("#obKey").value; });
    $("#obToggleGuide").addEventListener("click", () => {
      const g = $("#obGuide");
      g.style.display = g.style.display === "none" ? "block" : "none";
    });
    $("#obOpenApi").addEventListener("click", () => api.call("open_url", "https://civitai.com/user/account"));
    $("#obApiPage").addEventListener("click", () => api.call("open_url", "https://civitai.com/user/account"));
  } else if (obStep === 4) {
    // 模型管理目录：手把手选择（可多目录）
    body.innerHTML =
      '<div class="ob-label">模型管理目录 —— 你本地存放模型的地方</div>' +
      '<div class="ob-hint">软件从这里扫描模型、显示封面和触发词。WebUI 与 ComfyUI 分开存放的，把两个目录都填上（每行一个）：</div>' +
      '<textarea class="input" id="obModelDirs" rows="3" style="width:100%;box-sizing:border-box">' + esc(obModelDirs.join("\n")) + '</textarea>' +
      '<div class="ob-actions2"><button class="btn" id="obBrowseModels">选择文件夹</button>' +
      '<button class="btn" id="obBrowseModels2">再添加一个</button></div>' +
      '<div style="color:var(--text-dim);font-size:12px;margin-top:6px">常见路径：D:\\sd-webui-forge-neo\\webui\\models（WebUI）、D:\\ComfyUI\\models（ComfyUI）</div>';
    const sync = () => { obModelDirs = $("#obModelDirs").value.split("\n").map((s) => s.trim()).filter(Boolean); };
    $("#obModelDirs").addEventListener("input", sync);
    const addDir = async () => {
      const picked = await api.call("pick_dir");
      if (!picked) return;
      sync();
      if (!obModelDirs.includes(picked)) obModelDirs.push(picked);
      $("#obModelDirs").value = obModelDirs.join("\n");
    };
    $("#obBrowseModels").addEventListener("click", async () => {
      const picked = await api.call("pick_dir");
      if (!picked) return;
      obModelDirs = [picked];
      $("#obModelDirs").value = picked;
    });
    $("#obBrowseModels2").addEventListener("click", addDir);
  } else {
    // 反向解析：推荐但可跳过
    body.innerHTML =
      '<div class="ob-label">反向解析（强烈推荐，也可跳过）</div>' +
      '<div class="ob-hint">把你已下载的模型文件识别出 C 站信息：自动匹配模型名、触发词（tags）、类型和基础模型，并生成封面。</div>' +
      '<div class="ob-hint" style="margin-top:4px">做完后，模型管理里每个模型才有名字和触发词可复制；<b>跳过也不影响其他功能</b>。</div>' +
      '<div class="ob-actions2"><button class="btn btn-primary" id="obGoRp">立即体验（推荐）</button>' +
      '<button class="btn" id="obSkipRp">跳过（以后在 反向解析 页随时可用）</button></div>';
    $("#obGoRp").addEventListener("click", async () => {
      await finishOnboarding();
      document.querySelector(".nav-tab[data-page=\"reverse\"]").click();
      setStatus("已进入反向解析页，拖入或选择模型文件即可开始");
    });
    $("#obSkipRp").addEventListener("click", async () => {
      await finishOnboarding();
    });
  }
  // 每一步底部都有「跳过引导」：不填剩余项，直接保存已填内容并关闭
  // 注意：必须用 insertAdjacentHTML 追加——innerHTML += 会重建整个 body、清空上面绑定的
  // 功能卡/主题点击监听器（曾导致「点击无法进入」「主题切换无效」）
  body.insertAdjacentHTML("beforeend",
    '<div class="ob-skip-row"><button class="btn" id="obSkipAll">跳过引导（剩余步骤不填，以后可随时在设置页重开）</button></div>');
  $("#obSkipAll").addEventListener("click", async () => {
    await finishOnboarding();
  });
}

// 引导完成：保存全部配置
async function finishOnboarding() {
  state.cfg.api_key = (obKeyVal || "").trim();
  state.cfg.download_dir = (obDirVal || state.cfg.download_dir || "").trim();
  state.cfg.theme = obTheme;
  const dirs = obModelDirs.filter(Boolean);
  state.cfg.models_dirs = dirs;
  if (dirs.length) state.cfg.models_dir = dirs[0];
  document.documentElement.dataset.theme = obTheme;
        applyUiAppearance();
  await api.call("save_config", state.cfg);
  state.cfg = await api.call("get_config");
  buildSettingsForm();
  applyZoom(Number(state.cfg.ui_zoom) || 100);
  document.documentElement.dataset.theme = state.cfg.theme || "modern";
  $("#obMask").style.display = "none";
  setStatus("设置完成，欢迎使用！");
}
$("#obNext").addEventListener("click", async () => {
  if (obStep === 0) {
    obStep = 1;
  } else if (obStep === 1) {
    obStep = 2;
  } else if (obStep === 2) {
    obStep = 3;
  } else if (obStep === 3) {
    obStep = 4;
  } else if (obStep === 4) {
    obStep = 5;
  } else {
    // 完成：保存配置（obDirVal/obKeyVal/obModelDirs 跨步骤保存，输入框已不在 DOM）
    await finishOnboarding();
    return;
  }
  renderOnboarding();
});
$("#obPrev").addEventListener("click", () => { obStep--; renderOnboarding(); });

window.addEventListener("pywebviewready", init);
if (window.pywebview) init();
// 就绪守卫：init 未完成前禁止依赖 js_api 的操作（首次桥接可能慢）
window.__ready = false;

// 批量下载页 hint 仓库域名外链：仅处理 .ob-link（定向委托，避免误伤其他 data-url 元素）
document.addEventListener("click", (e) => {
  const el = e.target.closest("#page-download .card .ob-link[data-url]");
  if (!el) return;
  e.preventDefault();
  api.call("open_url", el.dataset.url);
});

/* ============================================================================
   Metro 工具区（仅 Metro 主题可见）——
   按钮全部是"代理"：点击转交给下面老按钮的 click()，业务逻辑零改动；
   标签/禁用/显隐用 MutationObserver 跟随原按钮（如「停止检查（N/M）」、恢复误整理的显隐）。
   ========================================================================== */

// SVG 图标（内联 sprite，见 index.html 的 #i-* symbols）
function _icon(name, cls) {
  return '<svg class="ic' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<use href="#i-' + name + '"/></svg>';
}

function _msTag(r) {
  const u = (r && r.upd) || {};
  if (u.has_update || u.other_base) return "";          // 有更新 → 用 角标（可点去 C 站）
  if (r && r.upd) return '<span class="ms-tag ok">已最新</span>';
  return "";
}

function syncViewSeg() {
  const l = document.getElementById("mmViewList"), m = document.getElementById("mmViewMasonry");
  if (l) l.classList.toggle("on", state.mmView === "list");
  if (m) m.classList.toggle("on", state.mmView === "masonry");
}

function mmSetView(v) {
  state.mmView = (v === "masonry") ? "masonry" : "list";
  const t = document.getElementById("mmViewToggle");
  if (t) t.textContent = state.mmView === "masonry" ? "\ud83d\udccb \u5217\u8868\u89c6\u56fe" : "\ud83d\uddbc\ufe0f \u7011\u5e03\u6d41";
  syncViewSeg();
  renderMm();
}

function syncSortDir() {
  const sd = document.getElementById("mmSortDir");
  if (sd) {
    sd.innerHTML = _icon("sort") + (state.mmSort.rev ? "降序" : "升序");
    sd.dataset.tip = state.mmSort.rev ? "当前降序，点击切换为升序" : "当前升序，点击切换为降序";
  }
}

let _mmFolderTree = null;
async function fillMmFolderOptions() {
  // 复用现有 get_folders（与「文件夹显隐」面板同源），只做"拉平 + 填充下拉"
  const sel = document.getElementById("mmFolderF");
  if (!sel) return;
  if (!_mmFolderTree) {
    try {
      const j = JSON.parse((await api.call("get_folders")) || "{}");
      _mmFolderTree = Array.isArray(j) ? j : ((j && j.tree) || []);   // ★ get_folders 返回 {root, tree, hidden, show_root}
    } catch (e) { _mmFolderTree = []; }
  }
  const flat = [];
  const walk = (nodes, depth) => (nodes || []).forEach((n) => {
    if (n && n.path) flat.push({ path: n.path, name: (depth ? "　".repeat(depth) : "") + (n.name || n.path) });
    if (n && n.children) walk(n.children, depth + 1);
  });
  walk(_mmFolderTree, 0);
  const sig = flat.map((f) => f.path).join("|");
  if (sel._sig === sig) return;
  sel._sig = sig;
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部文件夹</option>' + flat.map((f) =>
    '<option value="' + esc(f.path) + '">' + esc(f.name) + "</option>").join("");
  sel.value = cur;
}
function fillMmBaseOptions() {
  const bf = document.getElementById("mmBaseF");
  if (!bf) return;
  const bases = [...new Set(state.models.map((r) => String(r.base || "").trim()).filter(Boolean))].sort();
  const sig = bases.join("|");
  if (bf._sig === sig) return;
  bf._sig = sig;
  const cur = bf.value;
  bf.innerHTML = '<option value="">全部底模</option>' +
    bases.map((b) => '<option value="' + esc(b) + '">' + esc(b) + "</option>").join("");
  bf.value = cur;
}

function _closeMmMenus() {
  document.querySelectorAll(".btn-group.open").forEach((g) => {
    g.classList.remove("open");
    const m = g._menu;
    if (m) m.classList.remove("open");
  });
}

// 打开菜单：把菜单移到 body（portal），用 fixed 定位 + 完全不透明背景 —— 任何祖先的
// overflow / transform / stacking context 都影响不到它
function _mmOpenMenu(grp, menu, btn) {
  if (menu.parentElement !== document.body) document.body.appendChild(menu);
  menu.style.position = "fixed";
  menu.style.background = "var(--surface, #fff)";   // 暗色模式下跟随主题面
  menu.style.zIndex = "var(--z-dropdown, 340)";
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth || 220;
  menu.style.left = Math.max(8, Math.min(r.left, (window.innerWidth || 1920) - w - 8)) + "px";
  menu.style.top = (r.bottom + 2) + "px";
  menu.classList.add("open");
  grp.classList.add("open");
  grp._menu = menu;
  menu._owner = grp;
}

function bindMmMetro() {
  const _sec = (name, fn) => { try { fn(); } catch (e) { console.error("[bindMmMetro]", name, e); try { api.call("log_ui_error", "bindMmMetro/" + name + ": " + (e && e.message || e)); } catch (e2) { } } };
  // 1) 代理按钮：点击 → 原按钮 click()
  document.querySelectorAll(".mm-metro [data-proxy]").forEach((el) => {
    if (el._px) return; el._px = 1;
    el.addEventListener("click", () => {
      _closeMmMenus();
      const src = document.getElementById(el.dataset.proxy);
      if (src && !src.disabled) src.click();
    });
  });
  // 2) 菜单开合（点击式；再点收起；外点/Esc 关闭）
  _sec("menus", () => {
  document.querySelectorAll(".mm-metro [data-menu]").forEach((btn) => {
    if (btn._mn) return; btn._mn = 1;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const grp = btn.closest(".btn-group");
      if (!grp) return;
      // 菜单首次打开后会 portal 到 body，此时 grp.querySelector 找不到它 → 用记住的引用兜底（否则第二次点不开）
      const menu = grp.querySelector(".mm-menu") || grp._menu || null;
      const wasOpen = grp.classList.contains("open");
      _closeMmMenus();
      if (!wasOpen && menu) _mmOpenMenu(grp, menu, btn);   // 箭头翻转由 CSS 负责（.btn-group.open .car svg）
    });
  });
  });
  // 3) 改名菜单（复用 mmRenameRun，功能与老菜单完全一致）
  _sec("rename", () => {
  document.querySelectorAll(".mm-metro [data-ract]").forEach((it) => {
    if (it._ra) return; it._ra = 1;
    it.addEventListener("click", () => { _closeMmMenus(); mmRenameRun(it.dataset.ract); });
  });
  });
  // 4) 跳设置 / 打开日志
  _sec("goto", () => {
  document.querySelectorAll(".mm-metro [data-goto='settings']").forEach((it) => {
    if (it._gt) return; it._gt = 1;
    it.addEventListener("click", () => { _closeMmMenus(); switchPage("settings"); });
  });
  document.querySelectorAll(".mm-metro [data-act='logs']").forEach((it) => {
    if (it._lg) return; it._lg = 1;
    it.addEventListener("click", async () => {
      _closeMmMenus();
      const r = await api.call("open_logs_dir");
      setStatus((r && r.msg) || "已打开日志文件夹");
    });
  });
  });
  _sec("outside", () => {
  document.addEventListener("click", (e) => {
    if (e.target && e.target.closest && e.target.closest(".mm-menu")) return;   // 点在菜单里不关
    _closeMmMenus();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") _closeMmMenus(); });
  // 窗口尺寸变化时，已打开的菜单重新定位（避免飘走）
  window.addEventListener("resize", () => {
    document.querySelectorAll(".btn-group.open").forEach((g) => {
      const b = g.querySelector(".btn[data-menu]");
      if (b && g._menu) _mmOpenMenu(g, g._menu, b);
    });
  });
  });
  // 5) Metro 筛选（底模 / 状态 / 排序），复用既有 state 与排序机制
  _sec("filters", () => {
  const bf = document.getElementById("mmBaseF"), sf = document.getElementById("mmStF"),
        so = document.getElementById("mmSortF"), sd = document.getElementById("mmSortDir");
  const ff = document.getElementById("mmFolderF");
  if (ff) ff.addEventListener("change", () => { state.mmFolderF = ff.value; applyMmFilter(); });
  if (bf) bf.addEventListener("change", () => { state.mmBaseF = bf.value; applyMmFilter(); });
  if (sf) sf.addEventListener("change", () => { state.mmStF = sf.value; applyMmFilter(); });
  if (so) so.addEventListener("change", () => {
    if (!so.value) state.mmSort = { col: null, rev: false };
    else state.mmSort = { col: so.value, rev: state.mmSort.col === so.value ? state.mmSort.rev : false };
    syncSortDir(); applyMmFilter();
  });
  if (sd) sd.addEventListener("click", () => {
    state.mmSort = { col: state.mmSort.col || "name", rev: !state.mmSort.rev };
    if (so) so.value = state.mmSort.col;
    syncSortDir(); applyMmFilter();
  });
  syncSortDir();
  // 5b) 分段视图切换
  const _vl = document.getElementById("mmViewList"), _vm = document.getElementById("mmViewMasonry");
  if (_vl) _vl.addEventListener("click", () => mmSetView("list"));
  if (_vm) _vm.addEventListener("click", () => mmSetView("masonry"));
  syncViewSeg();
  });
  _sec("appearance", () => { applyUiAppearance(); });
  // 6) 代理跟随原按钮（文字/禁用/显隐）
  document.querySelectorAll(".mm-metro [data-proxy]").forEach((el) => {
    const src = document.getElementById(el.dataset.proxy);
    if (!src) return;
    const _clean = (t) => String(t || "").replace(/^[\u{1F300}-\u{1FAFF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u200D\s]+/u, "");
    const _isMetro = () => document.documentElement.dataset.theme === "metro";
    const sync = () => {
      const raw = String(src.textContent || "");
      const lbl = _isMetro() ? _clean(raw) : raw.trim();       // 经典主题：保留 emoji（原样）
      const ic = (_isMetro() && el.dataset.icon) ? _icon(el.dataset.icon) : "";
      if (el.innerHTML !== (ic + lbl)) el.innerHTML = ic + lbl;
      el.disabled = !!src.disabled;
      el.style.display = (src.style.display === "none") ? "none" : "";
    };
    (window._mmLabelSync = window._mmLabelSync || []).push(sync);
    try {
      new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["style", "disabled"] });
    } catch (e) { /* 忽略 */ }
    sync();
  });
}
try { bindMmMetro(); } catch (e) { /* Metro 未启用时也不报错 */ }

/* ===== 更新页「版本选择」控件的事件（委托；与门户菜单同一套逻辑） ===== */
document.addEventListener("click", (e) => {
  const t = e.target;
  if (!t || !t.closest) return;
  // 打开/关闭
  const btn = t.closest(".vsel-btn");
  if (btn) {
    e.stopPropagation();
    const wrap = btn.closest(".btn-group");
    const menu = wrap && wrap.querySelector(".mm-menu");
    const wasOpen = wrap && wrap.classList.contains("open");
    _closeMmMenus();
    if (!wasOpen && menu) _mmOpenMenu(wrap, menu, btn);
    return;
  }
  // 选择版本
  const item = t.closest(".vitem[data-vid]");
  if (item) {
    const pth = item.dataset.vpath, vid = item.dataset.vid;
    state.updPick[pth] = vid;
    _closeMmMenus();
    renderUpdatesPage();
    return;
  }
  // 去 C 站
  const site = t.closest(".vopen[data-vsite]");
  if (site) {
    _closeMmMenus();
    api.call("open_url", site.dataset.vsite);
  }
}, true);

// 门户菜单挂在 body 后仍可点（portal 出去的菜单也走上面的委托）
