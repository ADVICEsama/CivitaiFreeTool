/* Only clipped model names animate. Offscreen names and hidden pages are paused. */
(()=>{
  const selectors='.ms-name,.ms-sub,#mmTable .ml-1,#mmTable .ml-2,.upd-nm,.rp-fname,#dlTable .c-file>div:first-child,#dlHistoryTable .history-file-name,#dlHistoryTable .history-model';
  const records=new Map(),phases=new Map(),motion=matchMedia('(prefers-reduced-motion: reduce)');let scheduled=false;
  const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(refresh);}};
  const resize=new ResizeObserver(schedule);
  const visible=new IntersectionObserver(entries=>{for(const e of entries){const r=records.get(e.target);if(r)r.visible=e.isIntersecting;}schedule();});
  function options(){
    const cfg=state.cfg||{},bounded=(key,fallback,min,max)=>{const n=Number(cfg[key]??fallback);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
    const speed=bounded('name_scroll_speed',70,10,240),start=bounded('name_scroll_start_pause',350,0,5000),end=bounded('name_scroll_end_pause',250,0,5000);
    return {speed,start,end,signature:[speed,start,end].join(':')};
  }
  function refresh(){
    scheduled=false;
    for(const [el,r] of records)if(!el.isConnected){if(r.animation){phases.set(r.key,{time:r.animation.currentTime||0,when:performance.now(),signature:r.signature});if(phases.size>256)phases.delete(phases.keys().next().value);}r.animation?.cancel();resize.unobserve(el);visible.unobserve(el);records.delete(el);}
    const full=document.documentElement.dataset.masonryInfo!=='always'&&document.documentElement.dataset.masonryOverlay==='full';
    document.querySelectorAll(selectors).forEach(el=>{
      if(full&&el.matches('.ms-name[data-civitai-name=true]')){
        const old=records.get(el);if(old?.kind==='wrap')return;
        old?.animation?.cancel();const viewport=el.querySelector('.name-scroll-viewport');if(viewport)viewport.replaceWith(document.createTextNode(viewport.textContent));
        el.classList.remove('has-name-scroll');if(!el.title)el.title=el.textContent.trim();records.set(el,{kind:'wrap',visible:false,animation:null});resize.observe(el);return;
      }
      if(records.get(el)?.kind==='wrap'){resize.unobserve(el);visible.unobserve(el);records.delete(el);}
      if(el.querySelector('.name-scroll-viewport'))return;
      const texts=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE),name=texts.map(n=>n.textContent).join('').trim();if(!name)return;
      const viewport=document.createElement('span'),text=document.createElement('span');viewport.className='name-scroll-viewport';text.className='name-scroll-text';text.textContent=name;viewport.append(text);
      texts[0].before(viewport);texts.forEach(n=>n.remove());el.classList.add('has-name-scroll');if(!el.title)el.title=name;
      const owner=el.closest('[data-path],[data-task-id],[data-history-id]'),key=(owner?.dataset.path||owner?.dataset.taskId||owner?.dataset.historyId||'')+'|'+name;const old=records.get(el);old?.animation?.cancel();records.set(el,{kind:'scroll',viewport,text,key,visible:false,distance:0,animation:null});resize.observe(el);visible.observe(el);
    });
    const zoom=parseFloat(getComputedStyle(document.documentElement).zoom)||1,prefs=options();
    for(const [el,r] of records){
      if(r.kind==='wrap'){
        const css=getComputedStyle(el),line=parseFloat(css.lineHeight)||22,space=el.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom),lines=String(Math.max(1,Math.floor(space/line)));
        if(el.style.getPropertyValue('--ms-title-lines')!==lines)el.style.setProperty('--ms-title-lines',lines);
        continue;
      }
      if(r.signature!==prefs.signature){const changed=r.signature!==undefined;r.animation?.cancel();r.animation=null;r.signature=prefs.signature;if(changed)phases.delete(r.key);r.viewport.classList.remove('running');}
      const distance=Math.max(0,Math.ceil(r.text.getBoundingClientRect().width/zoom-r.viewport.clientWidth));
      if(distance!==r.distance||motion.matches){r.animation?.cancel();r.animation=null;r.distance=distance;r.viewport.classList.remove('running');}
      if(distance<=2||motion.matches||!r.visible||document.hidden){r.animation?.pause();continue;}
      if(!r.animation){
        r.viewport.classList.add('running');const duration=Math.max(1,prefs.start+distance/prefs.speed*1000+prefs.end);
        r.animation=r.text.animate([{transform:'translateX(0)',offset:0},{transform:'translateX(0)',offset:prefs.start/duration},{transform:`translateX(-${distance}px)`,offset:1-prefs.end/duration},{transform:`translateX(-${distance}px)`,offset:1}],{duration,iterations:Infinity,easing:'linear'});const phase=phases.get(r.key);if(phase&&phase.signature===prefs.signature&&performance.now()-phase.when<5000)r.animation.currentTime=phase.time+performance.now()-phase.when;phases.delete(r.key);
      }else r.animation.play();
    }
  }
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,characterData:true});
  new MutationObserver(schedule).observe(document.documentElement,{attributes:true,attributeFilter:['style','data-theme','data-masonry-info','data-masonry-overlay']});
  document.addEventListener('visibilitychange',schedule);motion.addEventListener('change',schedule);window.addEventListener('cft:zoom',schedule);window.addEventListener('cft:name-scroll-options',schedule);
  document.addEventListener('pointerover',e=>{const card=e.target.closest('.ms-card');if(!card||card.contains(e.relatedTarget))return;for(const [el,r] of records)if(card.contains(el)&&r.animation)r.animation.currentTime=0;schedule();});
  // Portaled menus aren't children of the page's scroller. Use their own scroll
  // when possible, otherwise continue scrolling the visible model list.
  document.addEventListener('wheel',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||e.defaultPrevented)return;
    const menu=e.target.closest('.mm-menu,.ctx-menu,#mmFoldersPanel');if(!menu)return;
    for(let el=e.target;el&&el!==menu.parentElement;el=el.parentElement){
      const css=getComputedStyle(el),max=el.scrollHeight-el.clientHeight;
      if(/auto|scroll/.test(css.overflowY)&&max>1&&((e.deltaY>0&&el.scrollTop<max-1)||(e.deltaY<0&&el.scrollTop>1)))return;
    }
    const locked=document.body.classList.contains('model-toolbar-locked');
    const scroller=locked?document.querySelector(state.mmView==='masonry'?'#mmMasonryViewport':'#mmTableWrap'):document.querySelector('.content');
    if(scroller&&scroller.scrollHeight>scroller.clientHeight){e.preventDefault();const zoom=parseFloat(getComputedStyle(document.documentElement).zoom)||1;scroller.scrollTop+=e.deltaY*(e.deltaMode===1?18:e.deltaMode===2?scroller.clientHeight:1)/zoom;}
  },{passive:false});
  schedule();
})();
