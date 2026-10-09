/* Cached thumbnails only. The preview never follows arbitrary model links or loads originals. */
(() => {
  const pages = '#page-dlmanager,#page-updates,#page-reverse,#page-workflow';
  const cache=new Map();
  let target=null, timer=0, popup=null, point={x:0,y:0}, frame=0;
  function hide(){clearTimeout(timer);timer=0;target=null;if(popup){popup.remove();popup=null;}}
  function place(){
    frame=0;if(!popup)return;
    const z=parseFloat(getComputedStyle(document.documentElement).zoom)||1;
    const box=popup.getBoundingClientRect(),w=innerWidth,h=innerHeight;
    let x=point.x+18,y=point.y+18;
    if(x+box.width>w-10)x=point.x-box.width-18;
    if(y+box.height>h-10)y=h-box.height-10;
    popup.style.left=Math.max(10,x)/z+'px';popup.style.top=Math.max(10,y)/z+'px';
  }
  document.addEventListener('pointerover',e=>{
    const img=e.target.closest('img');
    if(!img||!img.closest(pages)||img.closest('.detail-mask,.iv-mask,.df-mask'))return;
    if(img===target)return;hide();target=img;point={x:e.clientX,y:e.clientY};
    timer=setTimeout(()=>{
      timer=0;
      if(!target?.isConnected||!target.src.startsWith('data:image/'))return;
      popup=document.createElement('div');popup.className='cover-hover-preview';popup.setAttribute('aria-hidden','true');
      const cover=new Image();cover.alt='';cover.src=target.currentSrc||target.src;popup.appendChild(cover);document.body.appendChild(popup);cover.onload=place;place();
      const candidate=target,path=candidate.dataset.path||candidate.closest('tr[data-path]')?.dataset.path;
      if(path){
        if(cache.has(path))cover.src=cache.get(path);
        else api.call('get_covers',[path],512).then(value=>{try{const data=typeof value==='string'?JSON.parse(value):value;if(data?.[path]){const src='data:image/jpeg;base64,'+data[path];if(cache.size>200)cache.clear();cache.set(path,src);if(target===candidate&&popup)cover.src=src;}}catch(_){}}).catch(()=>{});
      }
    },180);
  });
  document.addEventListener('pointermove',e=>{point={x:e.clientX,y:e.clientY};if(popup&&!frame)frame=requestAnimationFrame(place);});
  document.addEventListener('pointerout',e=>{if(e.target===target)hide();});
  document.addEventListener('scroll',hide,true);document.addEventListener('click',hide,true);
  window.addEventListener('resize',hide);window.addEventListener('blur',hide);
})();
