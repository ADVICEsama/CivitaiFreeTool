/* Task table widths are independent of model-list sizes and survive queue refreshes. */
function bindPersistedTableColumns(tableId, defaults, skipColumns=[], key=null) {
  const table=document.querySelector('#'+tableId);if(!table)return;key=key||'cft-columns-'+tableId+'-v1';
  const headers=[...table.querySelectorAll('thead th')];
  let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch(_){}
  if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};
  const group=table.querySelector('colgroup')||document.createElement('colgroup');group.replaceChildren();
  headers.forEach((th,i)=>{const col=document.createElement('col');col.dataset.dlColumn=String(i);group.appendChild(col);th.dataset.dlColumn=String(i);});
  table.prepend(group);
  const columns=[...group.children];
  let flexColumn=2;
  function apply(){
    const scale=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--type-scale'))||1;
    let total=0;const widths=[];
    columns.forEach((col,i)=>{
      const hidden=tableId==='dlTable'&&i===8&&table.dataset.hasErrors==='false';col.style.display='';
      const min=skipColumns.includes(i)?defaults[i]:60;
      let width=Number(saved[i]);if(!Number.isFinite(width)||width<min||width>2000)width=defaults[i]*scale;
      widths[i]=width;if(!hidden)total+=width;
    });
    if(tableId==='dlTable'){
      const available=Math.max(0,table.parentElement.clientWidth);
      widths[flexColumn]+=Math.max(0,available-total);total=Math.max(total,available);
      table.parentElement.style.overflowX=total>available+1?'auto':'hidden';
      headers[8].hidden=table.dataset.hasErrors==='false';
    }
    columns.forEach((col,i)=>col.style.width=Math.round(widths[i])+'px');
    group.replaceChildren(...columns.filter((_,i)=>!(tableId==='dlTable'&&i===8&&table.dataset.hasErrors==='false')));
    table.style.width=Math.floor(total)+'px';table.style.minWidth=Math.floor(total)+'px';
  }
  const save=()=>{try{localStorage.setItem(key,JSON.stringify(saved));}catch(_){};};
  headers.forEach((th,i)=>{
    if(skipColumns.includes(i))return;
    const handle=document.createElement('span');handle.className='dl-col-resize';handle.title='拖动调整列宽；双击恢复默认';
    let drag=null;
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;e.preventDefault();e.stopPropagation();
      const zoom=parseFloat(getComputedStyle(document.documentElement).zoom)||1;
      drag={x:e.clientX,width:th.getBoundingClientRect().width/zoom,zoom};
      if(tableId==='dlTable'&&i===flexColumn)flexColumn=i===2?7:2;handle.setPointerCapture(e.pointerId);th.classList.add('resizing');
    });
    handle.addEventListener('pointermove',e=>{if(!drag)return;e.preventDefault();saved[i]=Math.max(60,Math.min(2000,drag.width+(e.clientX-drag.x)/drag.zoom));apply();});
    const end=()=>{if(drag){drag=null;th.classList.remove('resizing');save();}};
    handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
    handle.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();delete saved[i];save();apply();});
    handle.addEventListener('click',e=>e.stopPropagation());th.appendChild(handle);
  });
  new MutationObserver(apply).observe(table,{attributes:true,attributeFilter:['data-has-errors']});
  new MutationObserver(apply).observe(document.documentElement,{attributes:true,attributeFilter:['style']});
  if(tableId==='dlTable')new ResizeObserver(apply).observe(table.parentElement);
  apply();
}
bindPersistedTableColumns('dlTable',[72,48,360,180,160,120,130,200,240],[0,1],'cft-download-column-widths-v1');
bindPersistedTableColumns('dlHistoryTable',[420,130,150,180,400]);
bindPersistedTableColumns('updTable',[36,380,180,250,180,160,200],[0]);
bindPersistedTableColumns('rpTable',[380,330,160,260,130]);

// Drag the handle, not the row checkbox / cover. Hold refresh while a drag is active.
(()=>{
 const body=document.querySelector('#dlTable tbody');let dragged='';
 body.addEventListener('dragstart',e=>{const handle=e.target.closest('.dl-drag-handle');if(!handle)return;dragged=handle.closest('tr').dataset.taskId;dlDragging=true;e.dataTransfer.setData('application/x-cft-task',dragged);e.dataTransfer.effectAllowed='move';});
 body.addEventListener('dragover',e=>{if(!dragged)return;const row=e.target.closest('tr[data-task-id]');if(!row)return;e.preventDefault();e.dataTransfer.dropEffect='move';body.querySelectorAll('.dl-drop-target').forEach(r=>r.classList.remove('dl-drop-target'));row.classList.add('dl-drop-target');});
 body.addEventListener('drop',async e=>{const row=e.target.closest('tr[data-task-id]');if(!dragged||!row)return;e.preventDefault();const source=dragged,target=row.dataset.taskId;dragged='';
  if(source===target){dlDragging=false;body.querySelectorAll('.dl-drop-target').forEach(r=>r.classList.remove('dl-drop-target'));return;}
  const bounds=row.getBoundingClientRect(),after=e.clientY>bounds.top+bounds.height/2;
  const ids=[...body.querySelectorAll('tr[data-task-id]')].map(r=>r.dataset.taskId).filter(id=>id!==source);const index=ids.indexOf(target);if(index>=0)ids.splice(index+(after?1:0),0,source);else ids.push(source);
  try{const r=await api.call('set_download_order',ids);setStatus(r?.msg||'队列顺序已更新');}catch(_){setStatus('排序失败，请刷新后重试');}finally{dlDragging=false;body.querySelectorAll('.dl-drop-target').forEach(r=>r.classList.remove('dl-drop-target'));dlRefresh();}
 });
 body.addEventListener('dragend',()=>{dragged='';dlDragging=false;body.querySelectorAll('.dl-drop-target').forEach(r=>r.classList.remove('dl-drop-target'));});
})();
