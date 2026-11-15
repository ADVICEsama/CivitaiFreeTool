/* Desktop chapters: one wheel gesture per screen; small screens keep native scrolling. */
(()=>{
 'use strict';
 const root=document.documentElement;
 const pages=[...document.querySelectorAll('main > .page')];
 const links=[...document.querySelectorAll('.page-rail a')];
 const desktop=matchMedia('(min-width:1000px) and (min-height:720px)');
 const reduced=matchMedia('(prefers-reduced-motion:reduce)');
 const offsets=[[0,0],[-6,4],[-12,-5],[5,-10],[-4,-15],[10,3],[0,8]];
 let current=-1,lockedUntil=0,lastWheel=0,amount=0,direction=0,frame=0;
 const header=()=>parseFloat(getComputedStyle(root).getPropertyValue('--site-header'))||0;
 const top=page=>Math.max(0,page.getBoundingClientRect().top+scrollY-header());
 function update(){
  frame=0;
  let index=0;
  for(let i=0;i<pages.length;i++)if(top(pages[i])<=scrollY+innerHeight*.3)index=i;
  if(index===current)return;
  current=index;
  links.forEach((link,i)=>{if(i===index)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
  document.getElementById('pageNumber').textContent=String(index+1).padStart(2,'0')+' / 07';
  const [x,y]=offsets[index];
  root.style.setProperty('--map-x',x+'%');root.style.setProperty('--map-y',y+'%');
  root.style.setProperty('--map-gx',-x/2+'%');root.style.setProperty('--map-gy',-y/2+'%');
  pages.forEach(p=>p.classList.remove('is-entering'));pages[index].classList.add('is-entering');
 }
 function go(index){
  if(index<0||index>=pages.length)return;
  lockedUntil=performance.now()+(reduced.matches?220:850);
  scrollTo({top:top(pages[index]),behavior:reduced.matches?'instant':'smooth'});
 }
 function nestedCanScroll(target,dir){
  for(let e=target instanceof Element?target:null;e&&e!==document.body;e=e.parentElement){
   if(/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+2){
    if(dir>0&&e.scrollTop+e.clientHeight<e.scrollHeight-2||dir<0&&e.scrollTop>2)return true;
   }
  }
  return false;
 }
 function mode(){root.classList.toggle('paged',desktop.matches);current=-1;requestAnimationFrame(update);}
 addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(update);},{passive:true});
 addEventListener('resize',mode,{passive:true});desktop.addEventListener('change',mode);
 addEventListener('wheel',e=>{
  if(!desktop.matches||e.ctrlKey||e.metaKey||e.altKey||Math.abs(e.deltaX)>Math.abs(e.deltaY)||!e.deltaY)return;
  const dir=Math.sign(e.deltaY),now=performance.now(),quiet=now-lastWheel;lastWheel=now;
  if(nestedCanScroll(e.target,dir))return;
  const page=pages[Math.max(0,current)],start=top(page),end=start+page.offsetHeight-(innerHeight-header());
  if(page.offsetHeight>innerHeight-header()+8&&(dir>0&&scrollY<end-4||dir<0&&scrollY>start+4))return;
  if(dir>0&&current===pages.length-1||dir<0&&current===0)return;
  e.preventDefault();
  if(now<lockedUntil){amount=0;return;}
  if(quiet>180||direction!==dir)amount=0;
  direction=dir;amount+=Math.abs(e.deltaY)*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1);
  if(amount>=35){amount=0;go(current+dir);}
 },{passive:false});
 addEventListener('keydown',e=>{
  if(!desktop.matches||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,button,summary,[contenteditable="true"],[role="tab"]'))return;
  if(e.key==='PageDown'||e.key==='PageUp'){e.preventDefault();go(current+(e.key==='PageDown'?1:-1));}
 });
 document.addEventListener('click',e=>{
  const a=e.target.closest('a[href^="#"]');if(!a||!desktop.matches)return;
  let id=a.getAttribute('href').slice(1);if(id==='main'||id==='workspace')id='home';
  const i=pages.findIndex(p=>p.id===id);if(i<0)return;
  e.preventDefault();go(i);history.replaceState(null,'','#'+id);
 });
 mode();
})();
