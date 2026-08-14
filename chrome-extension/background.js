// CivitaiFreeTool 一键添加 —— 点击图标把当前 Civitai 模型页添加到 CivitaiFreeTool
// 依赖：CivitaiFreeTool.exe 正在运行（其内置本地桥服务 127.0.0.1:47531）
const BRIDGE = "http://127.0.0.1:47531";
const CIVITAI_RE = /^https?:\/\/(www\.)?civitai\.(red|com)\/(api\/download\/)?models\//i;

function badge(text, color, ms) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), ms);
}

async function postUrl(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(BRIDGE + "/api/add", {
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

async function addUrl(url) {
  if (!url || !CIVITAI_RE.test(url)) {
    badge("!", "#d93025", 3000);
    chrome.action.setTitle({ title: "当前页面不是 Civitai 模型页" });
    return;
  }
  const r = await postUrl(url);
  if (r.httpOk && r.ok) {
    badge(r.already ? "=" : "✓", "#1a73e8", 2500);
    chrome.action.setTitle({ title: r.already ? "已在队列中（重复添加已忽略）" : "已添加到 CivitaiFreeTool" });
  } else if (r.httpOk && !r.ok) {
    badge("!", "#d93025", 3000);
    chrome.action.setTitle({ title: r.msg || "添加失败" });
  } else {
    badge("!", "#d93025", 3000);
    chrome.action.setTitle({ title: r.msg || "无法连接 CivitaiFreeTool" });
  }
}

// 点击工具栏图标 → 直接添加当前活动标签页
chrome.action.onClicked.addListener((tab) => {
  addUrl(tab && tab.url);
});

// 右键菜单：页面 / 链接上「添加到 CivitaiFreeTool」
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "cft-add",
    title: "添加到 CivitaiFreeTool",
    contexts: ["page", "link"],
  });
});
chrome.contextMenus.onClicked.addListener((info) => {
  addUrl(info.linkUrl || info.pageUrl);
});
