// CivitaiFreeTool 一键下载 —— 右键菜单直接下载
// 点击工具栏图标走 popup 确认窗；右键页面/链接直接开始下载（badge 反馈）
const BRIDGE = "http://127.0.0.1:47531";
const CIVITAI_RE = /^https?:\/\/(www\.)?civitai\.(red|com)\/(api\/download\/)?models\//i;

function badge(text, color, ms) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), ms);
}

async function postDownload(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(BRIDGE + "/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { httpOk: res.ok, ...data };
  } catch (e) {
    return { httpOk: false, msg: "无法连接 CivitaiFreeTool（请先打开软件）" };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadUrl(url) {
  if (!url || !CIVITAI_RE.test(url)) {
    badge("!", "#d93025", 3000);
    chrome.action.setTitle({ title: "当前页面不是 Civitai 模型页" });
    return;
  }
  const r = await postDownload(url);
  if (r.httpOk && r.ok) {
    badge("✓", "#1a73e8", 3000);
    chrome.action.setTitle({ title: "已开始下载，可在 CivitaiFreeTool 下载管理查看" });
  } else if (r.httpOk && !r.ok) {
    badge("!", "#d93025", 3000);
    chrome.action.setTitle({ title: r.msg || "下载启动失败" });
  } else {
    badge("!", "#d93025", 3000);
    chrome.action.setTitle({ title: r.msg || "无法连接 CivitaiFreeTool" });
  }
}

// 右键菜单：页面 / 链接上「一键下载到 CivitaiFreeTool」
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "cft-dl",
    title: "一键下载到 CivitaiFreeTool",
    contexts: ["page", "link"],
  });
});
chrome.contextMenus.onClicked.addListener((info) => {
  downloadUrl(info.linkUrl || info.pageUrl);
});
