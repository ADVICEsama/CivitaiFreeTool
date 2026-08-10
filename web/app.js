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
  // 自定义确认弹窗（原生 confirm 显示地址栏太丑）
  return new Promise((resolve) => {
    const mask = document.createElement("div");
    mask.className = "rd-mask";
    const dlg = document.createElement("div");
    dlg.className = "rename-dialog";
    dlg.style.width = "420px";
    dlg.innerHTML =
      '<div class="rd-title">⚠️ 确认操作</div>' +
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

// 复制到剪贴板（走后端 Win32；WebView2 file:// 下 navigator.clipboard 不可用）
window.__copyText = async function (t) {
  try { await api.call("copy_text", String(t == null ? "" : t)); return true; }
  catch (e) { return false; }
};

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
    '<div class="rd-title">⏰ 待办下载清单（到期打开软件时提醒）</div>' +
    '<div class="form-grid" style="grid-template-columns:90px 1fr">' +
    '<label>链接</label><input class="input" id="tdUrl" placeholder="https://civitai.red/models/..." />' +
    "</div>" +
    '<div style="font-size:12px;color:var(--text-dim);margin:4px 0 6px 90px">时间自动选择：Early Access 模型按其免费到期时间提醒；其他模型默认 7 天后提醒</div>' +
    '<div class="rd-actions"><button class="btn btn-primary" id="tdAdd">➕ 添加</button></div>' +
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
      '<div style="display:flex;gap:8px;align-items:center">' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.url) + "</span>" +
      (t.due ? '<span style="color:var(--danger)">⏰ 已到期</span>' : '<span>' + t.remain_days + " 天后</span>") +
      '<button class="btn btn-tiny" data-del="' + esc(t.url) + '">🗑️</button></div>').join("");
    box.querySelectorAll("button[data-del]").forEach((b) => b.addEventListener("click", async () => {
      await api.call("todo_remove", b.dataset.del);
      renderTodoList();
    }));
  }
  renderTodoList();
}
// 启动时检查到期待办
(async function checkTodoDue() {
  try {
    const r = await api.call("todo_due");
    if (r && r.due && r.due.length) {
      const items = r.due.map((t) => '· <a href="#" class="td-go" data-url="' + esc(t.url) + '">' + esc(t.url) + "</a>").join("<br/>");
      confirmBox("⏰ 以下待办模型已到免费/可下载时间：<br/><div style=\"margin:6px 0;font-size:13px\">" + items + "</div>", "⏰ 待办提醒").then((ok) => {
        if (ok) switchPage("download");
      });
      document.querySelectorAll(".td-go").forEach((a) => a.addEventListener("click", (e) => {
        e.preventDefault();
        $("#urlRows").appendChild(addUrlRow(a.dataset.url));
        switchPage("download");
      }));
    }
  } catch (e) { /* 忽略 */ }
})();
$("#btnClearUrls").addEventListener("click", () => {
  $("#urlRows").innerHTML = "";
  addUrlRow();
});
$("#btnParse").addEventListener("click", async () => {
  const urls = $$("#urlRows .url-row input").map((i) => i.value.trim()).filter(Boolean);
  if (!urls.length) { setStatus("请先输入链接"); return; }
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
      ? '<span class="wf-model-path">✅ 已加入下载队列</span>'
      : '<span class="wf-model-miss">⏭️ 本地已存在，跳过</span>') +
    "</div>").join("");
  dlg.innerHTML =
    '<div class="rd-title">🖼️ 图片页模型批量下载</div>' +
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
      '<div style="font-weight:600">⚠️ 需付费（Early Access）</div>' +
      '<div style="font-size:12px;color:var(--text-dim);word-break:break-all">' + esc(it.url) + "</div>" +
      '<div style="font-size:12px;margin:4px 0 8px">约 ' + remain + ' 天后免费 —— <button class="btn btn-tiny paid-todo">⏰ 加入待办（自动到期提醒）</button> <button class="btn btn-tiny paid-dl">💳 仍要下载</button></div></div>';
  }).join("");
  dlg.innerHTML =
    '<div class="rd-title">⏰ 以下模型需要付费或尚未公开</div>' +
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
    b.textContent = "✅ 已加入待办";
    b.disabled = true;
  }));
  dlg.querySelectorAll(".paid-dl").forEach((b) => b.addEventListener("click", async () => {
    const row = b.closest(".paid-row");
    setStatus("正在加入下载队列 …");
    const r = await api.call("dl_enqueue_url", row.dataset.url);
    b.textContent = "⏳ 已提交";
    b.disabled = true;
    if (r && r.started) pollParse();
  }));
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
    // 下载受限（Early Access/付费）→ 弹窗选择
    maybeAskRestricted(tasks || []);
    // 下载完成 → 询问移动分类（ask_move_after_download 开启且本次会话未询问过）
    maybeAskMove(tasks || []);
  } catch (e) { /* 未就绪 */ }
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
    '<div class="rd-title">⚠️ 模型下载受限（Early Access / 付费）</div>' +
    '<div style="font-size:12px;color:var(--text-dim);word-break:break-all">' + esc(t.filename || "") + "</div>" +
    '<div style="font-size:12px;color:var(--text-dim);margin:4px 0 10px">该模型在 C 站暂不可直接下载。若有积分可先在浏览器购买解锁，或加入待办等免费开放。</div>' +
    '<div class="rd-actions">' +
    '<button class="btn btn-primary" id="rkRetry">💳 花费积分/重试下载</button>' +
    '<button class="btn" id="rkTodo">⏰ 加入待办并移除</button>' +
    '<button class="btn" id="rkSite">🌐 浏览器打开</button></div>';
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
  const done = tasks.find((t) => t.status === "done" && t.dest_dir && !_moveAsked.has(t.id));
  if (!done) return;
  _moveAsked.add(done.id);
  _moveAsking = true;
  const mask = document.createElement("div");
  mask.className = "rd-mask";
  const dlg = document.createElement("div");
  dlg.className = "rename-dialog";
  dlg.innerHTML =
    '<div class="rd-title">📂 下载完成：' + esc(done.filename) + "</div>" +
    '<div style="font-size:13px;color:var(--text-dim);line-height:1.8">是否移动到分类文件夹？（主文件与 json/封面等附属一起移动）</div>' +
    '<div class="rd-actions">' +
    '<button class="btn" id="mvNo">不移动</button>' +
    '<button class="btn btn-primary" id="mvYes">选择文件夹</button></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dlg);
  const close = () => { mask.remove(); dlg.remove(); _moveAsking = false; };
  $("#mvNo", dlg).addEventListener("click", close);
  mask.addEventListener("click", close);
  $("#mvYes", dlg).addEventListener("click", async () => {
    const dir = await api.call("pick_dir");
    close();
    if (!dir) return;
    const res = await api.call("move_file_to", done.dest_dir + "\\" + done.filename, dir);
    setStatus(res && res.msg ? res.msg : "移动完成");
    dlRefresh();
  });
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
      '<td class="cell-sel">' + (state.mmChecked.has(r.path) ? "✅" : "⬜") + "</td>" +
      '<td class="c-thumb"><img data-idx="' + i + '" data-path="' + esc(r.path) + '" class="thumb" alt=""/></td>' +
      "<td class='c-name'>" + esc(r.name) + "</td>" +
      "<td class='c-name'>" + esc(r.civitai_name || "-") + "</td>" +
      "<td>" + esc(r.type || "-") + "</td><td>" + esc(r.base || "-") + "</td>" +
      "<td class='c-ver'>" + esc(r.ver || "-") + "</td>" +
      "<td>" + esc(r.update || "-") + "</td><td>" + esc(r.hash || "-") + "</td>" +
      "<td>" + fmtSize(r.size) + "</td><td class='c-time'>" + fmtTime(r.mtime) + "</td>" +
      "<td class='c-path' data-full='" + esc(rel.replace(/[^\\/]+$/, "")) + "'>" + esc(short(rel, 30)) + "</td></tr>";
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

// 表头 ☑️ 点击 = 全选/取消全选
$("#mmTable thead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-col=sel]");
  if (!th) return;
  const allSel = state.display.length > 0 && state.display.every((r) => state.mmChecked.has(r.path));
  if (allSel) state.mmChecked.clear();
  else state.display.forEach((r) => state.mmChecked.add(r.path));
  th.textContent = allSel ? "☑️" : "✅";
  $("#mmCheckLabel").textContent = "已勾选 " + state.mmChecked.size + " 个";
  state.display.forEach((r) => {
    const tr2 = document.querySelector('#mmTable tbody tr[data-path="' + CSS.escape(r.path) + '"]');
    const c2 = tr2 && tr2.querySelector(".cell-sel");
    if (c2) c2.textContent = state.mmChecked.has(r.path) ? "✅" : "⬜";
  });
});

// ===== 模型列表列显隐（右键表头） =====
const MM_COLS = [["sel", "☑ 勾选"], ["thumb", "缩略图"], ["name", "文件名"], ["cname", "C站模型名"],
                 ["type", "类型"], ["base", "基础模型"], ["ver", "版本"], ["update", "更新"],
                 ["hash", "哈希"], ["size", "大小"], ["mtime", "下载时间"], ["path", "路径"]];
function mmApplyCols() {
  let hidden = [];
  try { hidden = JSON.parse(localStorage.getItem("mm_hidden_cols") || "[]"); } catch (e) {}
  const hs = new Set(hidden);
  document.querySelectorAll("#mmTable thead th[data-col]").forEach((th) => {
    th.style.display = hs.has(th.dataset.col) ? "none" : "";
  });
}
$("#mmTable thead").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  let hidden = [];
  try { hidden = JSON.parse(localStorage.getItem("mm_hidden_cols") || "[]"); } catch (e) {}
  const hs = new Set(hidden);
  const menu = $("#ctxMenu");
  menu.innerHTML = '<div class="ctx-item" style="font-weight:600;cursor:default">📊 显示列</div>' +
    MM_COLS.map(([c, label]) =>
      '<div class="ctx-item" data-col="' + c + '">' + (hs.has(c) ? "⬜ " : "✅ ") + esc(label) + "</div>").join("");
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
// 渲染后应用列显隐（在 renderMm 列表分支后调用）

// ===== 瀑布流视图 =====
function renderMasonry(rows) {
  $("#mmTableWrap").style.display = "none";
  $("#mmMasonry").style.display = "block";
  $("#mmMasonry").innerHTML = rows.map((r, i) => {
    const checked = state.mmChecked.has(r.path) ? "checked" : "";
    return '<div class="ms-card' + (checked ? " checked" : "") + '" data-idx="' + i + '" data-path="' + esc(r.path) + '">' +
      '<span class="ms-check">' + (checked ? "✅" : "⬜") + "</span>" +
      '<div class="ms-img-wrap"><img class="ms-img" data-idx="' + i + '" data-path="' + esc(r.path) + '" alt=""/></div>' +
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
      document.querySelectorAll(".ms-img").forEach((img) => {
        if (img.dataset.path === p) img.src = "data:image/jpeg;base64," + b64;
      });
    }
  } catch (e) { /* 封面失败不影响 */ }
  loadMasonryThumbs(start + 40);
}
$("#mmViewToggle").addEventListener("click", () => {
  state.mmView = state.mmView === "masonry" ? "list" : "masonry";
  $("#mmViewToggle").textContent = state.mmView === "masonry" ? "📋 列表视图" : "🖼️ 瀑布流";
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
    chk.textContent = state.mmChecked.has(r.path) ? "✅" : "⬜";
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
  if (cardChk) cardChk.textContent = state.mmChecked.has(p) ? "✅" : "⬜";
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
    '<div class="ctx-item" data-act="copy_name">📋 复制文件名</div>' +
    '<div class="ctx-item" data-act="copy_cname">🀄 复制C站名</div>' +
    '<div class="ctx-item" data-act="folder">📂 打开所在文件夹</div>' +
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
      if (cell2) cell2.textContent = state.mmChecked.has(p) ? "✅" : "⬜";
    }
  });
  state.mmSel = new Set(state.mmChecked);
  $("#mmCheckLabel").textContent = "已勾选 " + state.mmChecked.size + " 个";
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
    '<div class="fm-toolbar">' +
    '<button class="btn btn-tiny" id="fmAll">✅ 全选</button>' +
    '<button class="btn btn-tiny" id="fmNone">⬜ 全不选</button></div>' +
    '<div class="fm-item fm-top" data-path="__root__">' +
      '<span class="fm-icon">🗂️</span><span class="fm-name">根目录下的模型</span>' +
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
  const desc = String(info.description || "").replace(/<[^>]+>/g, "");
  const covers = d.covers || [];
  detailImgIdx = 0;
  detailImgLocalPath = null;
  const mainB64 = covers.find((c) => c.b64);
  detailImgLocalPath = (mainB64 && mainB64.local && d.path) ? d.path : null;
  detailImgIdx = 0;
  const panel = $("#detailPanel");
  panel.innerHTML =
    '<div class="detail-left">' +
    (mainB64
      ? '<img class="detail-main-img" id="dMain" src="data:image/jpeg;base64,' + mainB64.b64 + '"/>'
      : '<div class="detail-main-img" id="dMain" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim)">暂无封面</div>') +
    '<div class="detail-thumbs">' + covers.map((c, i) =>
      c.b64
        ? '<img class="detail-thumb' + (i === 0 ? " on" : "") + '" data-i="' + i + '" src="data:image/jpeg;base64,' + c.b64 + '"/>'
        : '<img class="detail-thumb" data-i="' + i + '" data-url="' + esc(c.url || "") + '" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="background:var(--surface2)"/>'
    ).join("") + "</div></div>" +
    '<div class="detail-right">' +
    '<div class="detail-title">' + esc(info.name || d.name || "-") + "</div>" +
    '<div class="detail-cname">' + esc(info.modelName || "") + "</div>" +
    '<div class="detail-meta">' +
    (creator ? '<span class="detail-chip author-chip" data-author="' + esc(creator) + '" data-tip="点击复制作者链接">👤 ' + esc(creator) + '</span>' : "") +
    (info.type ? '<span class="detail-chip">' + esc(info.type) + "</span>" : "") +
    (info.baseModel ? '<span class="detail-chip">' + esc(info.baseModel) + "</span>" : "") +
    (v.name ? '<span class="detail-chip">版本 ' + esc(v.name) + "</span>" : "") +

    (info.nsfw ? '<span class="detail-chip" style="color:var(--danger)">NSFW</span>' : "") +
    "</div>" +
    '<div class="detail-sec-title">🎯 触发词（Trigger Words）<span class="detail-hint">点击任一触发词串单独复制</span></div>' +
    '<div class="detail-tags">' + (trained.length ? trained.map((t, ti) => '<div class="detail-tag copy-tag" data-tip="点击复制这一套">' +
      (trained.length > 1 ? '<span class="detail-tag-idx">' + (ti + 1) + "</span>" : "") +
      '<span class="detail-tag-txt">' + esc(t) + "</span></div>").join("") : '<span style="font-size:12px;color:var(--text-dim)">无触发词信息</span>') + "</div>" +
    '<div class="detail-sec-title">📝 简介</div>' +
    '<div class="detail-desc">' + (desc ? esc(desc) : "暂无简介") + "</div>" +
    '<div class="detail-sec-title">📦 文件</div>' +
    '<div class="detail-meta"><span class="detail-chip">' + esc(d.name || "") + "</span></div>" +
    '<div class="detail-actions">' +
    '<button class="btn btn-primary" id="dEditInfo">✏️ 编辑信息</button>' +
    '<button class="btn" id="dCover">📤 自定义封面</button>' +
    '<button class="btn" id="dSite">🌐 打开C站</button>' +
    '<button class="btn" id="dRename">✏️ 重命名</button>' +
    '<button class="btn" id="dRp">📤 发送到反向解析</button>' +
    '<button class="btn" id="dTranslate">🌏 翻译简介</button>' +
    '<button class="btn" id="dLocalize">🀄 汉化文件名</button>' +
    '<button class="btn" id="dAllImgs">🖼️ 下载全部图片</button>' +
    '<button class="btn" id="dJson">📄 生成SD json</button>' +
    '<button class="btn" id="dClose">关闭</button></div></div>';
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
    const mid = info.modelId || info.id;
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
      const el = tg.querySelector(".detail-tag-txt") || tg;
      const ok = await window.__copyText(el.textContent.trim());
      setStatus(ok ? "已复制该套触发词" : "复制失败");
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
      '<div class="rd-title">✏️ 编辑模型信息</div>' +
      '<div class="form-grid" style="grid-template-columns:120px 1fr">' +
      '<label>模型名</label><input class="input" id="eiName" value="' + esc(info.modelName || "") + '"/>' +
      '<label>触发词</label><textarea class="rules" id="eiTags" rows="5" placeholder="每行一套触发词（一套内用英文逗号分隔），与 C 站展示一致">' + esc(trained.join("\n")) + "</textarea>" +
      '<label>类型</label><input class="input" id="eiType" value="' + esc(info.type || "") + '"/>' +
      '<label>基础模型</label><input class="input" id="eiBase" value="' + esc(info.baseModel || "") + '"/>' +
      '<label>版本</label><input class="input" id="eiVer" value="' + esc(v.name || "") + '"/>' +
      '<label>简介</label><textarea class="rules" id="eiDesc" rows="4">' + esc(desc || "") + "</textarea>" +
      "</div>" +
      '<div class="rd-actions"><button class="btn btn-primary" id="eiOk">💾 保存</button><button class="btn" id="eiNo">取消</button></div>';
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
    setStatus("翻译简介中...");
    const r = await api.call("mm_translate_descs", [d.path]);
    setStatus(r && r.msg ? r.msg : "翻译完成");
    showModelDetail(d.path);  // 保持面板，刷新内容
  });
  $("#dLocalize", panel).addEventListener("click", async () => {
    setStatus("汉化文件名中...");
    const r = await api.call("mm_localize", [d.path]);
    setStatus(r && r.msg ? r.msg : "汉化完成");
    showModelDetail(d.path);
  });
  $("#dAllImgs", panel).addEventListener("click", async () => {
    setStatus("下载全部图片中 0%...");
    const timer = setInterval(async () => {
      try {
        const st = JSON.parse((await api.call("get_img_dl_state")) || "{}");
        if (st.total > 0) {
          const pct = Math.round((st.done / st.total) * 100);
          setStatus("下载全部图片中 " + pct + "% (" + st.done + "/" + st.total + ")");
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
    setStatus("已发送到反向解析");
    document.querySelector('.nav-tab[data-page="reverse"]').click();
  });
  $("#dJson", panel).addEventListener("click", async () => {
    await api.call("mm_gen_json", [d.path], true);
    setStatus("SD json 已生成");
    closeDetail();
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
    '<div class="ctx-item" data-act="img_copy">📋 复制当前图片</div>' +
    '<div class="ctx-item" data-act="img_folder">📂 打开图片所在文件夹</div>' +
    '<div class="ctx-item" data-act="img_prompt">💬 复制提示词</div>' +
    '<div class="ctx-item" data-act="img_orig">🌐 打开原图片网站</div>';
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
    if (act === "img_copy") {
      // 优先本地图：复制文件路径；远程图：复制下载地址
      const src = c.local ? (detailRow.path ? null : null) : null;
      if (c.local && detailImgLocalPath) {
        await window.__copyText(detailImgLocalPath);
        setStatus("已复制图片路径");
      } else if (c.b64) {
        try {
          const blob = await (await fetch("data:image/jpeg;base64," + c.b64)).blob();
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          setStatus("图片已复制到剪贴板");
        } catch (e2) {
          await window.__copyText(c.orig_url || c.url || "");
          setStatus("已复制图片链接");
        }
      } else {
        await window.__copyText(c.orig_url || c.url || "");
        setStatus("已复制图片链接");
      }
    } else if (act === "img_folder") {
      const p = detailImgLocalPath;
      if (p) await api.call("open_url", "explorer /select,\"" + p + "\"");
      else if (c.orig_url) await api.call("open_url", c.orig_url);
      else setStatus("无本地文件");
    } else if (act === "img_prompt") {
      const t = c.prompt || "（该图片无提示词信息）";
      await window.__copyText(t);
      setStatus(t === "（该图片无提示词信息）" ? t : "提示词已复制");
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
  $("#wfResultTitle").innerHTML = "📄 " + esc(r.file) + ' <span class="wf-info">' + (r.has_workflow ? "✅ 含内嵌工作流" : "⚠️ 仅提示词信息") + " · 节点 " + r.node_count + " 个</span>";
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
          ? '<span class="wf-model-path">✅ 本地: ' + esc(m.path) + "</span>" +
            (m.sha256 ? '<span class="wf-model-sha">SHA256: ' + esc(m.sha256) + "…</span>" : "")
          : '<span class="wf-model-miss">❌ 本地未找到</span>' +
            '<span class="wf-search" data-search="' + esc(m.ref) + '">🔍 搜索下载</span>') +
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
    '<div class="ctx-item" data-act="copy_name">📋 复制文件名</div>' +
    '<div class="ctx-item" data-act="copy_cname">🀄 复制C站名</div>' +
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
      try { await window.__copyText(ctxRow.civitai_name || "-"); setStatus("已复制C站名: " + (ctxRow.civitai_name || "-")); }
      catch (e) { setStatus("复制失败"); }
    } else if (act === "site") {
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
mmOp("mmJson", (p) => api.call("mm_gen_json", p, true));
mmOp("mmCovers", (p) => api.call("mm_download_covers", p));
mmOp("mmTranslate", (p) => api.call("mm_translate_descs", p));
$("#mmOrganize").addEventListener("click", async () => {
  if (!(state.cfg && state.cfg.target_env)) {
    confirmBox("⚠️ 请先在 设置 → 📂 分类规则 选择 🎯 目标环境（WebUI / ComfyUI），才能整理模型");
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
    confirmBox("⚠️ 请先在 设置 → 📂 分类规则 选择 🎯 目标环境（WebUI / ComfyUI）");
    return;
  }
  setStatus("正在扫描可恢复的模型 …");
  const prev = await api.call("mm_restore_organize", true);
  if (!prev || !prev.ok) { setStatus(prev ? prev.msg : "扫描失败"); return; }
  if (!prev.count) { setStatus("没有发现需要恢复的模型 ✅"); return; }
  const root = (state.cfg.models_dir || "").replace(/\\/g, "/");
  const lines = prev.items.slice(0, 30).map((it) =>
    "· " + esc(it.src.split(/[\\/]/).pop()) + " → " + esc(it.dest.replace(/\\/g, "/").replace(root, "")) + "（" + esc(it.why) + "）").join("<br/>");
  const more = prev.count > 30 ? "<br/>… 共 " + prev.count + " 个" : "";
  const ok = await confirmBox(
    "<div style='font-size:12px;color:var(--text-dim);line-height:1.8'>以下模型将被移回标准目录（只移动不删除，json/封面随行）：</div><div style='font-size:12px;line-height:1.9;max-height:240px;overflow:auto;margin-top:6px'>" + lines + more + "</div>",
    "🔧 恢复误整理");
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

// 修改名称：主按钮执行默认动作（设置可改），hover 显示二级菜单
function mmRenameRun(act) {
  const p = mmCheckedPaths();
  if (!p) { setStatus("请先勾选或选中模型"); return; }
  if (act === "custom") {
    const first = state.display.find((r) => r.path === p[0]);
    if (first) { showRenameDialog(first.path, first.name); return; }
    setStatus("未找到选中模型"); return;
  }
  setStatus((act === "rename_c" ? "重命名C站名" : "汉化文件名") + " 开始 ...");
  api.call(act === "rename_c" ? "mm_rename" : "mm_localize", p).then(() => {
    setStatus("完成，刷新中 ...");
    api.call("scan_models");
    pollMmScan();
  }).catch(() => {});
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
  ["🔑 基本", "api_key", "Civitai API Key", "password"],
  ["🔑 基本", "download_dir", "下载目录", "text"],
  ["🔑 基本", "models_dir", "模型管理目录", "text"],
  ["🔑 基本", "site_domain", "站点域名", "select", ["civitai.red", "civitai.com"]],
  ["🌐 网络", "proxy_enabled", "启用代理", "bool"],
  ["🌐 网络", "ssl_verify", "启用证书验证", "bool"],
  ["🌐 网络", "proxy_address", "代理地址", "text"],
  ["🌐 网络", "max_concurrent_downloads", "并发下载数", "number"],
  ["🌐 网络", "download_timeout", "下载超时(秒)", "number"],
  ["🌐 网络", "hash_threads", "哈希线程数", "number"],
  ["⬇️ 下载", "gen_metadata", "完成后自动生成 json/info", "bool"],
  ["⬇️ 下载", "download_cover", "完成后自动下载封面", "bool"],
  ["⬇️ 下载", "ask_move_after_download", "完成后询问移动分类", "bool"],
  ["⬇️ 下载", "metadata_format", "metadata 格式", "select", ["sd", "civitai", "both"]],
  ["🌏 翻译", "baidu_appid", "百度翻译 APP ID", "text"],
  ["🌏 翻译", "baidu_key", "百度翻译密钥", "password"],
  ["🌏 翻译", "auto_translate", "反向解析自动翻译", "bool"],
  ["🌏 翻译", "translate_filename", "下载文件名为中文", "bool"],
  ["🎨 界面", "theme", "界面主题", "select", ["dark", "light", "modern"]],
  ["🎨 界面", "ui_zoom", "界面缩放", "select", ["80", "90", "100", "110", "125", "150"]],
  ["🎨 界面", "rename_menu_default", "修改名称默认动作", "select", [["custom", "自定义重命名"], ["rename_c", "重命名C站名"], ["localize", "汉化文件名"]]],
  ["🎨 界面", "confirm_buttons_flip", "确认弹窗按钮翻转", "bool"],
  ["🎨 界面", "default_page", "启动默认页", "select", [["models", "🧩 模型管理"], ["download", "📥 批量下载"], ["dlmanager", "⬇️ 下载管理"], ["reverse", "🔍 反向解析"], ["workflow", "🔬 工作流分析"], ["settings", "⚙️ 设置"]]],
  ["🎨 界面", "default_view", "模型默认视图", "select", [["waterfall", "🖼️ 瀑布流"], ["list", "📋 列表"]]],
  ["🎨 界面", "zebra_rows", "模型列表斑马纹", "bool"],
  ["🎨 界面", "ambient_bg", "顶部氛围动态背景", "bool"],
];

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
      if (type === "bool") {
        input = '<label class="check"><input type="checkbox" data-key="' + key + '" ' + (v ? "checked" : "") + "/> " + esc(label) + "</label>";
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
          '<span class="pwd-eye" data-eye="' + key + '">👁️</span></div>';
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
    return '<fieldset class="form-section"><legend><span class="fold-btn">▾</span> ' + esc(g) + "</legend><div class=\"form-grid\">" + body + "</div>" + extra + "</fieldset>";
  }).join("");
  // 分类规则组（目标环境 + 整理模式 + 自定义规则）
  form.innerHTML += '<fieldset class="form-section"><legend>📂 分类规则</legend><div class="form-grid">' +
    '<label>🎯 目标环境</label><div><select data-key="target_env">' +
    [["", "未选择（必须选择才能整理）"], ["webui", "WebUI / Forge（Lora、Stable-diffusion）"], ["comfyui", "ComfyUI（loras、checkpoints）"]]
      .map((o) => '<option value="' + o[0] + '"' + (String(state.cfg.target_env) === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") +
    "</select></div>" +
    '<label>📁 整理模式</label><div><select data-key="organize_mode">' +
    [["manual", "手动分类（逐个选择文件夹）"], ["civitai", "C 站 tags 自动分类（需 info）"], ["rules", "自定义规则分类"]]
      .map((o) => '<option value="' + o[0] + '"' + (String(state.cfg.organize_mode) === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") +
    "</select></div>" +
    '<label>整理分类规则</label><div><textarea class="rules" id="organizeRules">' + esc((state.cfg.organize_rules || []).map((r) => (r.keywords || []).join(", ") + " -> " + r.folder).join("\n")) + "</textarea></div>" +
    "</div></fieldset>";
}

// 密码框小眼睛（切换明文显示）
$("#settingsForm").addEventListener("click", (e) => {
  const eye = e.target.closest(".pwd-eye");
  if (!eye) return;
  const key = eye.dataset.eye;
  const inp = document.querySelector('.pwd-wrap input[data-key="' + key + '"]');
  if (!inp) return;
  inp.type = inp.type === "password" ? "text" : "password";
  eye.textContent = inp.type === "password" ? "🙈" : "👁️";
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
  // 启动默认页
  const defPage = state.cfg.default_page || "models";
  const tab = document.querySelector('.nav-tab[data-page="' + defPage + '"]');
  if (tab) tab.click();
  // 应用模型管理默认视图（设置项 default_view）
  state.mmView = state.cfg.default_view === "waterfall" ? "masonry" : "list";
  const vtb = $("#mmViewToggle");
  if (vtb) vtb.textContent = state.mmView === "masonry" ? "📋 列表视图" : "🖼️ 瀑布流";
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
      '<div>1. 打开 <a class="ob-link" id="obApiPage">civitai.com/user/account</a>（登录后点 Account Settings 生成 API Keys）</div>' +
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
    $("#obOpenApi").addEventListener("click", () => api.call("open_url", "https://civitai.com/user/account"));
    $("#obApiPage").addEventListener("click", () => api.call("open_url", "https://civitai.com/user/account"));
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
    // 重新渲染设置页/主题/缩放，确保引导中的修改立即反映到设置页
    buildSettingsForm();
    applyZoom(Number(state.cfg.ui_zoom) || 100);
    document.documentElement.dataset.theme = state.cfg.theme || "modern";
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
