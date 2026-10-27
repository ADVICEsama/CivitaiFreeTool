/* The original settings/baseline keep ownership of saving and dirty state. */
(()=>{'use strict';
 const root=document.documentElement,form=document.getElementById('settingsForm'),page=document.getElementById('page-settings');
 if(!form||!page)return;
 const notice=document.createElement('div');notice.id='efUnsavedNotice';notice.hidden=true;notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');notice.setAttribute('aria-atomic','true');
 notice.innerHTML='<div class="ef-unsaved-ribbon"><div class="ef-unsaved-symbols" aria-hidden="true"></div><div class="ef-unsaved-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h14l4 4v14H3ZM7 3v6h9V3M7 15h10v6M10 5h3"/></svg><span>有未保存更改</span></div></div>';
 document.body.append(notice);
 let visible=false,queued=false,badge=null,hideTimer=0,arriveTimer=0,pointerFrame=0,lastPointer=null;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function position(){
  const bounds=(page.querySelector(':scope>.card')||page).getBoundingClientRect(),zoom=Number(root.style.zoom)||1;
  notice.style.setProperty('--ef-unsaved-left',bounds.left/zoom+'px');
  notice.style.setProperty('--ef-unsaved-width',Math.max(0,bounds.width)/zoom+'px');
  notice.style.setProperty('--ef-unsaved-top',(bounds.top+bounds.height*.72)/zoom+'px');
 }
 function hit(r,point){return point&&point.x>=r.left-4&&point.x<=r.right+4&&point.y>=r.top-4&&point.y<=r.bottom+4;}
 function avoid(){
  if(!visible)return;
  const r=notice.getBoundingClientRect(),focus=document.activeElement;
  let obscuresFocus=false;
  if(focus?.matches('input,textarea,select,[contenteditable=true]')&&page.contains(focus)){
   const f=focus.getBoundingClientRect();obscuresFocus=f.width>0&&f.height>0&&f.bottom>r.top&&f.top<r.bottom&&f.right>r.left&&f.left<r.right;
  }
  notice.classList.toggle('is-avoiding',!!(hit(r,lastPointer)||obscuresFocus));
 }
 function show(){
  position();
  if(visible){avoid();return;}
  clearTimeout(hideTimer);clearTimeout(arriveTimer);visible=true;notice.hidden=false;notice.classList.remove('is-leaving','is-arriving');void notice.offsetWidth;notice.classList.add('is-arriving');avoid();
  arriveTimer=setTimeout(()=>notice.classList.remove('is-arriving'),(reduced.matches||window.CFTMotion?.reduced())?0:210);
 }
 function hide(immediate=false){
  if(!visible&&notice.hidden)return;
  visible=false;clearTimeout(hideTimer);clearTimeout(arriveTimer);notice.classList.remove('is-arriving','is-avoiding');
  if(immediate||(reduced.matches||window.CFTMotion?.reduced())){notice.hidden=true;notice.classList.remove('is-leaving');return;}
  notice.classList.add('is-leaving');hideTimer=setTimeout(()=>{if(!visible){notice.hidden=true;notice.classList.remove('is-leaving');}},160);
 }
 const badgeObserver=new MutationObserver(()=>schedule());
 function sync(){
  const current=document.getElementById('settingsDirty');
  if(current!==badge){badgeObserver.disconnect();badge=current;if(badge)badgeObserver.observe(badge,{childList:true,attributes:true,attributeFilter:['class']});}
  const active=['light_endfield','dark_endfield'].includes(root.dataset.theme)&&page.classList.contains('active')&&!document.hidden&&!document.querySelector('.settings-exit-mask');
  // Compare against the actual baseline: instant-save preferences must not leave a false warning.
  const dirty=active&&(typeof settingsHaveChanges==='function'?!!settingsHaveChanges():!!badge?.classList.contains('dirty'));
  if(dirty)show();else hide(!active);
 }
 function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync();});}
 new MutationObserver(schedule).observe(form,{childList:true,subtree:true});
 new MutationObserver(schedule).observe(root,{attributes:true,attributeFilter:['data-theme','data-sidebar']});
 new MutationObserver(schedule).observe(page,{attributes:true,attributeFilter:['class']});
 new ResizeObserver(()=>{if(visible){position();avoid();}}).observe(page.querySelector(':scope>.card')||page);
 for(const type of ['input','change'])document.addEventListener(type,e=>{if(form.contains(e.target))schedule();});
 document.addEventListener('pointermove',e=>{lastPointer={x:e.clientX,y:e.clientY};if(!visible||pointerFrame)return;pointerFrame=requestAnimationFrame(()=>{pointerFrame=0;avoid();});},{passive:true});
 document.addEventListener('pointerout',e=>{if(!e.relatedTarget){lastPointer=null;avoid();}},{passive:true});
 document.addEventListener('focusin',avoid);document.addEventListener('focusout',()=>queueMicrotask(avoid));
 document.addEventListener('visibilitychange',schedule);window.addEventListener('resize',()=>{if(visible){position();avoid();}});window.addEventListener('scroll',avoid,true);
 window.addEventListener('cft:zoom',()=>{if(visible){position();avoid();}});
 window.addEventListener('cft:config-saved',schedule);
 window.addEventListener('cft:settings-exit',schedule);
 window.CFTEndfieldUnsaved={refresh:schedule};sync();
})();
