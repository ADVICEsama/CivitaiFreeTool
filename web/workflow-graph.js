/* Read-only visualization of actual serialized connections. No execution or inferred links. */
window.CftWorkflowGraph=(()=>{
  const q=s=>document.querySelector(s),h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const viewport=q('#wfGraphViewport'),canvas=q('#wfGraphCanvas');
  let width=1000,height=600,scale=1,x=24,y=24,drag=null,needsFit=false;
  let full=false;try{full=localStorage.getItem('cft-workflow-view')==='full';}catch(_){}
  function apply(){canvas.style.transform=`translate(${x}px,${y}px) scale(${scale})`;}
  function fit(){if(!viewport.clientWidth){needsFit=true;return;}scale=Math.max(.08,Math.min(1,(viewport.clientWidth-48)/width,(viewport.clientHeight-48)/height));x=24;y=24;needsFit=false;apply();}
  function mode(value){
    full=value;q('#wfGraphSection').hidden=!full;
    q('#wfSimple').classList.toggle('btn-primary',!full);q('#wfFull').classList.toggle('btn-primary',full);
    q('#wfSimple').setAttribute('aria-pressed',String(!full));q('#wfFull').setAttribute('aria-pressed',String(full));
    try{localStorage.setItem('cft-workflow-view',full?'full':'simple');}catch(_){}
    if(full&&needsFit)fit();
  }
  q('#wfSimple').onclick=()=>mode(false);q('#wfFull').onclick=()=>mode(true);
  q('#wfGraphFit').onclick=fit;
  function zoom(factor,cx=viewport.clientWidth/2,cy=viewport.clientHeight/2){const old=scale;scale=Math.max(.05,Math.min(3,scale*factor));x=cx-(cx-x)*scale/old;y=cy-(cy-y)*scale/old;apply();}
  q('#wfGraphPlus').onclick=()=>zoom(1.2);q('#wfGraphMinus').onclick=()=>zoom(1/1.2);
  viewport.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey)return;e.preventDefault();const z=parseFloat(getComputedStyle(document.documentElement).zoom)||1,b=viewport.getBoundingClientRect();zoom(Math.exp(-Math.max(-120,Math.min(120,e.deltaY))*.002),(e.clientX-b.x)/z,(e.clientY-b.y)/z);},{passive:false});
  viewport.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('[data-node-index]'))return;e.preventDefault();const z=parseFloat(getComputedStyle(document.documentElement).zoom)||1;drag={cx:e.clientX,cy:e.clientY,x,y,z};viewport.setPointerCapture(e.pointerId);});
  viewport.addEventListener('pointermove',e=>{if(!drag)return;x=drag.x+(e.clientX-drag.cx)/drag.z;y=drag.y+(e.clientY-drag.cy)/drag.z;apply();});
  viewport.addEventListener('pointerup',()=>drag=null);viewport.addEventListener('pointercancel',()=>drag=null);
  canvas.addEventListener('click',e=>{const node=e.target.closest('[data-node-index]');if(node){window.CftWorkflow.select(Number(node.dataset.nodeIndex));q('#wfNodeDetail').scrollIntoView({block:'nearest'});}});
  function render(r){
    const all=Array.isArray(r.nodes)?r.nodes:[],nodes=all.slice(0,300);
    if(!nodes.length){canvas.innerHTML=`<div class="wf-graph-empty">${r.source==='forge'?'Forge / A1111 PNG 提供生成参数，但没有 ComfyUI 节点连接数据。已在下方显示参数与引用模型，不绘制虚假连线。':'文件未提供节点数据'}</div>`;width=700;height=160;x=24;y=24;scale=1;apply();mode(full);return;}
    const ids=new Map(nodes.map((n,i)=>[String(n.id??i+1),i])),edges=(r.edges||[]).filter(e=>ids.has(String(e.source))&&ids.has(String(e.target)));
    const depth=nodes.map(()=>0);
    for(let pass=0;pass<Math.min(nodes.length,20);pass++)for(const e of edges){const a=ids.get(String(e.source)),b=ids.get(String(e.target));if(a!==b)depth[b]=Math.min(20,Math.max(depth[b],depth[a]+1));}
    const rows={};let positions=nodes.map((n,i)=>{
      if(Array.isArray(n.position)&&n.position.length>=2&&n.position.slice(0,2).every(v=>Number.isFinite(v)&&Math.abs(v)<100000))return n.position.slice(0,2);
      const col=depth[i],row=rows[col]||0;rows[col]=row+1;return[col*290,row*145];
    });
    const minX=Math.min(...positions.map(p=>p[0])),minY=Math.min(...positions.map(p=>p[1]));positions=positions.map(p=>[p[0]-minX+20,p[1]-minY+20]);
    width=Math.max(...positions.map(p=>p[0]))+240;height=Math.max(...positions.map(p=>p[1]))+140;
    const wires=edges.map(e=>{const a=positions[ids.get(String(e.source))],b=positions[ids.get(String(e.target))],sx=a[0]+210,sy=a[1]+54,ex=b[0],ey=b[1]+54,dx=Math.max(60,Math.abs(ex-sx)*.5);return `<path d="M ${sx} ${sy} C ${sx+dx} ${sy},${ex-dx} ${ey},${ex} ${ey}" class="wf-wire"><title>${h(e.input||'连接')}：#${h(e.source)} → #${h(e.target)}</title></path>`;}).join('');
    const cards=nodes.map((n,i)=>{const [px,py]=positions[i],name=String(n.title||n.type||'节点'),type=String(n.type||''),params=(n.parameters||[]).slice(0,2).map(p=>p.name+': '+String(p.value)).join(' · ')||(n.widgets||[]).slice(0,2).join(' · ');return `<g class="wf-graph-node" data-node-index="${i}" transform="translate(${px},${py})" role="button" tabindex="0"><title>${h(name+'\n'+type+'\n'+params)}</title><rect width="210" height="108" rx="8"/><rect class="wf-graph-node-head" width="210" height="30" rx="8"/><circle cx="0" cy="54" r="5"/><circle cx="210" cy="54" r="5"/><text x="12" y="20">${h(name.slice(0,24))}</text><text x="12" y="53" class="wf-node-id">#${h(n.id??i+1)} · ${h(type.slice(0,22))}</text><text x="12" y="80" class="wf-node-id">${h(String(params).slice(0,28))}</text></g>`;}).join('');
    canvas.innerHTML=`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="工作流真实节点连接图">${wires}${cards}</svg>`;
    canvas.querySelectorAll('[data-node-index]').forEach(node=>node.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();window.CftWorkflow.select(Number(node.dataset.nodeIndex));}}));
    q('.wf-graph-toolbar .hint').textContent=`${edges.length} 条真实连接 · 拖动平移 / 滚轮缩放${all.length>300?' · 性能保护：画布展示前 300 个节点，目录保留全部':''}`;
    needsFit=true;mode(full);if(full)fit();
  }
  mode(full);return{render};
})();
