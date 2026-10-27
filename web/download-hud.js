/* Isolated view: only the restricted HudBridge is exposed, never the full application API. */
'use strict';
let bridge, expanded=false, dragging=null, signature='', stopped=false, sawActive=false, completionAt=0;
const $=id=>document.getElementById(id);
const gb=n=>(Number(n||0)/1073741824).toFixed(1);
const labels={pending:'排队',downloading:'下载中',paused:'已暂停',retrying:'重试中',error:'失败',done:'已完成'};
async function act(action,id){try{const ok=await bridge.action(action,id);$('message').textContent=ok?'操作已提交':'操作未执行，请检查设置';}catch{$('message').textContent='操作失败';}}
async function poll(){
  if(stopped)return;
  try{
    const s=await bridge.snapshot(),theme=String(s.theme||'');document.body.dataset.theme=theme.startsWith('light')||['modern','metro'].includes(theme)?'light_endfield':'dark_endfield';document.body.dataset.motion=String(s.motion);
    if(s.active){sawActive=true;completionAt=0;}
    if(s.done&&sawActive){if(!completionAt)completionAt=Date.now();if(Date.now()-completionAt>5000){sawActive=false;bridge.hide();}}
    document.body.classList.toggle('running',s.active>0);document.body.classList.toggle('done',s.done);document.body.classList.toggle('failed',s.failed>0);
    $('received').textContent=gb(s.received);$('total').textContent=' / '+(s.unknown?'?':gb(s.total))+' GB';
    $('percent').textContent=s.unknown?'—':Math.floor(s.progress)+'%';$('speed').textContent=s.failed?s.failed+' 项失败':s.done?'已完成':s.active?(s.speed/1048576).toFixed(1)+' MB/s':'等待 / 暂停';
    const p=s.unknown?0:s.progress;$('arc').style.strokeDasharray=p+' 100';$('bar').style.width=p+'%';
    $('mark').setAttribute('d',s.done?'M12 20l5 5 11-12':'M20 10v17m-6-6 6 6 6-6');
    $('summary').textContent='下载中 '+s.active+' · 排队 '+s.waiting+' · '+s.tasks.length+' 项';
    const next=JSON.stringify(s.tasks);
    if(expanded&&next!==signature){signature=next;const fragment=document.createDocumentFragment();
      for(const t of s.tasks){const row=document.createElement('div');row.className='task';const name=document.createElement('div');name.className='task-name';name.title=t.filename;name.textContent=t.filename;
        const line=document.createElement('progress');line.max=100;line.value=t.total?Math.min(100,t.downloaded/t.total*100):0;name.append(document.createElement('br'),line);
        const status=document.createElement('small');status.textContent=labels[t.status]||t.status;const b=document.createElement('button');b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+(t.status==='paused'?'M8 5v14l12-7Z':'M8 5v14M16 5v14')+'"/></svg>';b.title=t.status==='paused'?'继续此任务':'暂停此任务';b.disabled=!['pending','downloading','paused','retrying'].includes(t.status);b.onclick=()=>act(t.status==='paused'?'start':'pause',t.id);row.append(name,status,b);fragment.append(row);
      }$('tasks').replaceChildren(fragment);
    }
  }catch{$('speed').textContent='连接中断';}
  setTimeout(poll,document.hidden?2000:500);
}
window.addEventListener('pywebviewready',()=>{bridge=window.pywebview.api;poll();});
let dockTimer;
document.body.addEventListener('pointerenter',()=>{clearTimeout(dockTimer);bridge?.dock(false);});
document.body.addEventListener('pointerleave',()=>{clearTimeout(dockTimer);dockTimer=setTimeout(()=>{if(!dragging)bridge?.dock(true);},500);});
async function toggle(){expanded=!expanded;$('details').hidden=!expanded;$('expand').setAttribute('aria-expanded',String(expanded));signature='';await bridge.expand(expanded);}
$('expand').onclick=toggle;$('pause').onclick=()=>act('pause_all');$('hide').onclick=()=>bridge.hide();$('manager').onclick=()=>bridge.open_manager();
$('drag').ondblclick=e=>{if(!e.target.closest('button'))toggle();};
$('drag').onpointerdown=e=>{if(e.button||e.target.closest('button'))return;dragging={x:e.screenX,y:e.screenY,position:bridge.position(),pending:null,moving:null};$('drag').setPointerCapture(e.pointerId);};
$('drag').onpointermove=e=>{
  const d=dragging;if(!d)return;d.pending={x:e.screenX,y:e.screenY};if(d.moving)return;
  d.moving=(async()=>{const p=await d.position;while(d.pending){const point=d.pending;d.pending=null;await bridge.move(p.x+point.x-d.x,p.y+point.y-d.y,false);}})().catch(()=>{}).finally(()=>{d.moving=null;});
};
$('drag').onpointerup=async e=>{if(!dragging)return;const d=dragging;dragging=null;await d.moving;const p=await d.position;bridge.move(p.x+e.screenX-d.x,p.y+e.screenY-d.y,true);};
$('drag').onpointercancel=()=>{dragging=null;};window.addEventListener('beforeunload',()=>{stopped=true;});
