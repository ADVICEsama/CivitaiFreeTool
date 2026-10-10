/* Same DOM in report / three-column modes; resizing never rerenders analysis data. */
window.CftWorkflow = (() => {
  const q = s => document.querySelector(s);
  const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
  const text = value => typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  let nodes = [], selected = -1, revision = 0;
  const workspace = q('.wf-workspace');
  function adapt() {
    const width = workspace.clientWidth;
    if (!width) return;
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--type-scale')) || 1;
    const layout = width >= 1160 * Math.max(1, scale) ? 'columns' : 'report';
    if (workspace.dataset.layout !== layout) workspace.dataset.layout = layout;
  }
  if (window.ResizeObserver) new ResizeObserver(adapt).observe(workspace);
  new MutationObserver(adapt).observe(document.documentElement, {attributes:true, attributeFilter:['style','class','data-theme']});
  function filter() {
    const kw = q('#wfNodeSearch').value.trim().toLowerCase();
    let count = 0;
    q('#wfNodes').querySelectorAll('.wf-node').forEach(row => {
      row.hidden = !row.dataset.search.includes(kw);
      if (!row.hidden) count++;
    });
    q('#wfNodeEmpty').hidden = count > 0 || !nodes.length;
  }
  function pairs(items) {
    return `<dl class="wf-values">${items.map(([key,value]) => `<div><dt>${h(key)}</dt><dd>${h(text(value))}</dd></div>`).join('')}</dl>`;
  }
  function select(index) {
    const n = nodes[index];
    if (!n) { q('#wfNodeDetail').innerHTML = '<div class="wf-empty">未识别到节点参数</div>'; return; }
    selected = index;
    q('#wfNodes').querySelectorAll('.wf-node').forEach((row,i) => row.setAttribute('aria-pressed', String(i === index)));
    const params = Array.isArray(n.parameters) ? n.parameters.map(p => [p.name,p.value]) : (n.widgets || []).map((w,i) => [`参数 ${i+1}`,w]);
    const ports = n.inputs || [];
    const outputs = n.outputs || [];
    q('#wfNodeDetail').innerHTML = `<div class="wf-detail-title">${h(n.title || n.type || '未命名节点')}<span class="wf-tag">#${h(n.id ?? index+1)}</span></div>` +
      `<div class="wf-detail-type">${h(n.type || '未知类型')}</div><h4>参数</h4>` +
      (params.length ? pairs(params) : '<div class="wf-hint">文件未记录此节点的参数</div>') +
      (n.parameter_names_known === false && params.length ? '<p class="wf-hint">UI 工作流未提供参数名，按原始顺序显示，不猜测含义。</p>' : '') +
      (ports.length ? '<h4>输入与关联</h4>' + pairs(ports.map(p => [p.name, p.source != null ? `节点 #${p.source} · 输出 ${p.slot ?? 0}` : p.link != null ? `连接 #${p.link}` : p.value ?? p.type ?? '未连接'])) : '') +
      (outputs.length ? '<h4>输出</h4>' + pairs(outputs.map(p => [p.name,p.type || '未标注类型'])) : '');
  }
  function overview(r, total, matches, status) {
    const hit = matches.filter(m => m.local).length;
    const missing = total - hit;
    q('#wfOverview').innerHTML = `${icon('check')}<strong>解析完成</strong><span>${h(r.node_count ?? nodes.length)} 个节点</span><span>${total} 个引用模型</span>` +
      (status === 'done' ? `<span class="wf-ok">${hit} 个已匹配</span><span class="${missing ? 'wf-warning' : ''}">${missing} 个待补齐</span>` : `<span>${status === 'error' ? '模型匹配失败' : '本地匹配中…'}</span>`);
    const alert = q('#wfAlert');
    alert.hidden = status === 'done' && !missing;
    alert.classList.toggle('error', status === 'error');
    alert.textContent = status === 'error' ? '无法完成本地匹配，请重新分析。未将未知结果标为缺失。' : status === 'done' ? `缺少 ${missing} 个引用模型，可搜索下载或检查模型目录。` : '正在核对本地模型与哈希，请稍候…';
  }
  async function render(r) {
    const token = ++revision;
    q('#wfResult').style.display = 'block';
    workspace.classList.add('has-result');
    nodes = Array.isArray(r.nodes) ? r.nodes : [];
    selected = nodes.length ? 0 : -1;
    const refs = Array.isArray(r.models) ? r.models : [];
    adapt();
    q('#wfNodeSection').open = workspace.dataset.layout === 'columns';
    q('#wfResultTitle').innerHTML = `<div class="wf-file">${r.preview_b64 ? `<img class="wf-file-preview" src="data:image/jpeg;base64,${h(r.preview_b64)}" alt="工作流图片预览"/>` : icon('file')}<span class="wf-file-name" title="${h(r.file)}">${h(r.file || '工作流文件')}</span><span class="wf-tags"><span class="wf-tag">${/\.png$/i.test(r.file || '') ? 'PNG' : 'JSON'}</span><span class="wf-tag">${r.source==='forge' ? 'Forge / A1111 参数' : r.has_workflow ? '内嵌 Workflow' : 'API / 提示词'}</span></span><span class="wf-file-actions"><button class="btn" id="wfRechoose">重新选择</button><button class="btn btn-primary" id="wfReanalyze">重新分析</button></span></div>`;
    q('#wfNodeCount').textContent = `${nodes.length} 个`;
    q('#wfModelCount').textContent = `${refs.length} 个`;
    q('#wfNodeSearch').value = '';
    q('#wfNodes').innerHTML = nodes.length ? nodes.map((n,i) => `<button type="button" class="wf-node" data-index="${i}" data-search="${h([n.id,n.type,n.title,...(n.widgets || []),...(n.parameters || []).map(p=>text(p.value))].join(' ').toLowerCase())}" aria-pressed="${i === selected}">${icon('grid')}<span class="wf-node-copy"><span class="wf-node-type">${h(n.title || n.type || '未命名节点')}</span>${n.title && n.title !== n.type ? `<span class="wf-node-sub">${h(n.type)}</span>` : ''}</span><span class="wf-node-id">#${h(n.id ?? i+1)}</span></button>`).join('') : '<div class="wf-empty">未识别到节点</div>';
    filter(); select(selected);
    if(r.source==='forge')q('#wfNodeDetail').innerHTML='<div class="wf-detail-title">Forge / A1111 生成参数</div>'+pairs(Object.entries(r.generation_parameters||{}));
    window.CftWorkflowGraph.render(r);
    const pos = r.positive || r.pos_prompt || '', neg = r.negative || r.neg_prompt || '';
    wfLastPromptText = [pos ? '正向:\n'+pos : '',neg ? '负向:\n'+neg : ''].filter(Boolean).join('\n\n');
    q('#wfCopy').style.display = pos || neg ? '' : 'none';
    q('#wfPrompts').innerHTML = (r.prompt_notes ? `<p class="wf-hint">${h(r.prompt_notes)}</p>` : '') + [['正向提示词',pos,'positive'],['负向提示词',neg,'negative']].map(([name,value,kind]) => `<article class="wf-prompt ${kind}"><header><strong>${name}</strong>${value ? `<button type="button" class="btn wf-prompt-copy" data-prompt="${kind}" aria-label="复制${name}">${icon('copy')}复制</button>` : ''}</header><div class="wf-prompt-text">${h(value || '文件未记录'+name)}</div></article>`).join('');
    q('#wfPrompts').querySelectorAll('[data-prompt]').forEach(btn => btn.addEventListener('click', async () => {
      const ok = await window.__copyText(btn.dataset.prompt === 'positive' ? pos : neg);
      setStatus(ok ? '提示词已复制' : '复制失败，可选中文字手动复制');
    }));
    q('#wfModels').innerHTML = '<div class="wf-hint">本地匹配计算中…</div>';
    overview(r,refs.length,[],'loading');
    try {
      const raw = refs.length ? decode(await api.call('workflow_model_matches',refs)) : [];
      if (token !== revision) return;
      if (!Array.isArray(raw)) throw new Error('Invalid matches');
      const matches = refs.map(ref => raw.find(m => m.ref === ref) || {ref,local:false,path:''});
      q('#wfModels').innerHTML = matches.length ? `<div class="wf-resource-head"><span>模型名称</span><span>本地状态</span><span>操作</span></div>` + matches.map(m => `<article class="wf-resource"><div class="wf-resource-row"><span class="wf-resource-title"><img class="wf-model-cover" data-wf-cover="${h(m.path)}" alt="模型封面" hidden/><strong class="wf-resource-name" title="${h(m.ref)}">${h(m.ref)}</strong></span><span class="wf-badge ${m.local ? 'hit' : 'miss'}">${icon(m.local ? 'check' : 'info')}${m.local ? '本地匹配' : '本地缺失'}</span>${m.local ? `<button type="button" class="btn wf-open-model" data-path="${h(m.path)}">打开模型</button>` : `<button type="button" class="btn btn-primary wf-search" data-search="${h(m.ref)}">搜索下载</button>`}</div>${m.local ? `<details class="wf-resource-details"><summary>查看路径与哈希</summary><div class="wf-model-path">${h(m.path)}</div><div class="wf-model-sha">SHA256 前缀：${h(m.sha256 || '未获取')}</div></details>` : ''}</article>`).join('') : '<div class="wf-empty">未识别到模型引用</div>';
      overview(r,refs.length,matches,'done');
      const paths=matches.filter(m=>m.local).map(m=>m.path);
      if(paths.length){try{const covers=decode(await api.call('get_covers',paths,512));if(token!==revision)return;q('#wfModels').querySelectorAll('[data-wf-cover]').forEach(img=>{const b=covers?.[img.dataset.wfCover];if(b){img.src='data:image/jpeg;base64,'+b;img.hidden=false;}});}catch(_){}}
    } catch (_) {
      if (token !== revision) return;
      q('#wfModels').innerHTML = '<div class="wf-empty">本地匹配失败，请重新分析</div>';
      overview(r,refs.length,[],'error');
    }
  }
  q('#wfNodeSearch').addEventListener('input',filter);
  q('#wfNodes').addEventListener('click', e => {
    const row = e.target.closest('[data-index]');
    if (row) select(Number(row.dataset.index));
  });
  q('#wfModels').addEventListener('click', async e => {
    const btn = e.target.closest('.wf-open-model');
    if (!btn) return;
    await switchPage('models');
    await showModelDetail(btn.dataset.path);
  });
  return {render,adapt,select};
})();
