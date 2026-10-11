/* Model-tab metadata only. No page injection, cookies, API keys or unrelated URLs. */
(function (root) {
  function modelLink(raw) {
    try {
      const u = new URL(raw);
      if (!['http:', 'https:'].includes(u.protocol) || !/^(www\.)?civitai\.(red|com)$/i.test(u.hostname) || u.port || u.username || u.password) return null;
      const m = u.pathname.match(/^\/(api\/download\/)?models\/([1-9]\d*)(?:\/[^?#]*)?$/i);
      if (!m) return null;
      const query = new URLSearchParams();
      for (const key of ['modelVersionId', 'fileId']) {
        const values = u.searchParams.getAll(key);
        if (values.length > 1 || (values.length && !/^[1-9]\d*$/.test(values[0]))) return null;
        if (values.length) query.set(key, values[0]);
      }
      const version = m[1] ? m[2] : query.get('modelVersionId');
      const key = (version ? 'version:' + version : 'model:' + m[2]) + ':file:' + (query.get('fileId') || 'choose');
      u.search = query.toString(); u.hash = '';
      return {url:u.href, key, id:m[2], version:version || ''};
    } catch (_) { return null; }
  }
  function cleanTitle(s) { return String(s || '').replace(/\s*\|\s*Civitai\s*$/i, '').replace(/^Civitai\s*\|\s*/i, '').trim() || 'Civitai 模型'; }
  function candidates(tabs) {
    const rows = [], seen = new Map();
    for (const tab of tabs) {
      const link = modelLink(tab.url);
      if (!link) continue;
      if (seen.has(link.key)) {seen.get(link.key).copies++; continue;}
      const row = {...link, title:cleanTitle(tab.title), tabId:tab.id, windowId:tab.windowId, copies:1};
      seen.set(link.key, row); rows.push(row);
    }
    return rows;
  }
  root.CftTabs = {modelLink, cleanTitle, candidates};
})(globalThis);
