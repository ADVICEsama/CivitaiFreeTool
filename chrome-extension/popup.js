// CivitaiFreeTool 一键下载 —— 确认小窗
const BRIDGE = "http://127.0.0.1:47531";
const CIVITAI_MODEL_RE = /^https?:\/\/(www\.)?civitai\.(red|com)\/(api\/download\/)?models\//i;

const $ = (id) => document.getElementById(id);
const views = {
  loading: $("view-loading"),
  bad: $("view-bad"),
  offline: $("view-offline"),
  ready: $("view-ready"),
  done: $("view-done"),
  error: $("view-error"),
};
function show(name) {
  Object.entries(views).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
}
function cleanTitle(t) {
  // C 站标题形如 "模型名 | Civitai" / "Civitai | 模型名"
  let s = String(t || "").trim();
  s = s.replace(/\s*[|\|]\s*Civitai\s*$/i, "").trim();
  s = s.replace(/^Civitai\s*[|\|]\s*/i, "").trim();
  return s || "Civitai 模型";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function readPageTitle(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.title,
    });
    return r && r.result ? cleanTitle(r.result) : "";
  } catch (e) {
    return ""; // 无 host 权限（非模型页等）时忽略
  }
}

async function checkBridge() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(BRIDGE + "/api/health", { signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    return !!(data && data.ok);
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function init() {
  show("loading");
  const tab = await getActiveTab();
  const url = tab && tab.url ? tab.url : "";
  if (!CIVITAI_MODEL_RE.test(url)) {
    show("bad");
    return;
  }
  const online = await checkBridge();
  if (!online) {
    show("offline");
    return;
  }
  $("modelName").textContent = await readPageTitle(tab.id);
  $("modelUrl").textContent = url;
  $("modelMeta").textContent = "确认后将在 CivitaiFreeTool 中直接下载";
  show("ready");
}

async function startDownload() {
  const btn = $("btnDownload");
  btn.disabled = true;
  btn.textContent = "正在提交…";
  try {
    const url = $("modelUrl").textContent;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      res = await fetch(BRIDGE + "/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: ctrl.signal,
      });
    } catch (e) {
      show("offline");
      return;
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      show("done");
    } else {
      $("errMsg").textContent = data.msg || "未知错误";
      show("error");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "⬇️ 开始下载";
  }
}

$("btnDownload").addEventListener("click", startDownload);
$("btnClose").addEventListener("click", () => window.close());
$("btnRetry").addEventListener("click", () => { show("loading"); init(); });
document.addEventListener("DOMContentLoaded", init);
