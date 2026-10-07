/* 小范围几何特效：画布仅覆盖存活粒子，避免软件渲染上传整个 4K 窗口。 */
"use strict";
(function(){
  let canvas,ctx,mode='off',quality='low',raf=0,lastFrame=0,lastMove=0,particles=[],color='#60a5fa';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function stop(){if(raf)cancelAnimationFrame(raf);raf=0;particles=[];if(canvas){canvas.hidden=true;canvas.dataset.running='false';}}
  function usable(){return mode!=='off' && !reduced.matches && !document.hidden && document.hasFocus();}
  function tick(now){
    raf=0;if(!usable()){stop();return;}
    const cap=window.cftEffectsFpsLimit ?? 60,delay=cap?1000/cap:0;
    if(now-lastFrame<delay-.5){raf=requestAnimationFrame(tick);return;}lastFrame=now;
    particles=particles.filter(p=>now-p.born<p.life);if(!particles.length){stop();return;}
    // 生命周期最大半径 40px，粒子位移也计入范围。不再读整页 computedStyle 或清整屏。
    const left=Math.max(0,Math.floor(Math.min(...particles.map(p=>p.x-Math.abs(p.dx||0)-42)))),top=Math.max(0,Math.floor(Math.min(...particles.map(p=>p.y-Math.abs(p.dy||0)-42))));
    const right=Math.min(innerWidth,Math.ceil(Math.max(...particles.map(p=>p.x+Math.abs(p.dx||0)+42)))),bottom=Math.min(innerHeight,Math.ceil(Math.max(...particles.map(p=>p.y+Math.abs(p.dy||0)+42))));
    const w=Math.max(1,right-left),h=Math.max(1,bottom-top),z=Number(document.documentElement.style.zoom)||1,dpr=Math.min(devicePixelRatio||1,quality==='low'?1:1.5);
    Object.assign(canvas.style,{left:left/z+'px',top:top/z+'px',width:w/z+'px',height:h/z+'px'});
    const pw=Math.ceil(w*dpr),ph=Math.ceil(h*dpr);
    if(canvas.width!==pw || canvas.height!==ph){canvas.width=pw;canvas.height=ph;}else {ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);}
    ctx.setTransform(dpr,0,0,dpr,-left*dpr,-top*dpr);ctx.strokeStyle=color;ctx.lineWidth=1.5;
    for(const p of particles){
      const t=(now-p.born)/p.life;ctx.globalAlpha=(1-t)*.65;
      if(p.ring){ctx.beginPath();ctx.arc(p.x,p.y,4+t*32,0,Math.PI*2);ctx.stroke();}
      else{ctx.save();ctx.translate(p.x+p.dx*t,p.y+p.dy*t);ctx.rotate(p.angle+t*.7);ctx.beginPath();ctx.moveTo(0,-p.size);ctx.lineTo(p.size,p.size);ctx.lineTo(-p.size,p.size);ctx.closePath();ctx.stroke();ctx.restore();}
    }
    ctx.globalAlpha=1;canvas.hidden=false;canvas.dataset.running='true';canvas.dataset.fpsLimit=String(cap);canvas.dataset.draws=String(Number(canvas.dataset.draws||0)+1);raf=requestAnimationFrame(tick);
  }
  function add(e,click){
    if(!usable() || (!click && mode!=='trail'))return;
    const now=performance.now(),cap=window.cftEffectsFpsLimit ?? 60;
    if(!click && now-lastMove<Math.max(4,cap?1000/cap:4))return;if(!click)lastMove=now;
    if(click)particles.push({x:e.clientX,y:e.clientY,born:now,life:600,ring:true});
    const count=click?(quality==='low'?6:10):1,limit=quality==='low'?40:80;
    for(let i=0;i<count;i++){const angle=Math.random()*Math.PI*2,distance=click?20+Math.random()*28:6;particles.push({x:e.clientX,y:e.clientY,dx:Math.cos(angle)*distance,dy:Math.sin(angle)*distance,angle,size:click?3:2,born:now,life:click?550:300});}
    if(particles.length>limit)particles.splice(0,particles.length-limit);if(!raf)raf=requestAnimationFrame(tick);
  }
  function updateColor(){color=getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()||'#60a5fa';}
  window.applyPointerEffects=cfg=>{
    const n=Number(cfg.effects_fps_limit ?? 60);window.cftEffectsFpsLimit=n===0?0:Number.isFinite(n)?Math.max(15,Math.min(360,n)):60;
    quality=cfg.pointer_effect_quality==='high'?'high':'low';mode=['click','trail'].includes(cfg.pointer_effects)?cfg.pointer_effects:'off';stop();
    if(mode==='off' || reduced.matches)return;
    if(!canvas){canvas=document.createElement('canvas');canvas.id='pointerEffects';canvas.setAttribute('aria-hidden','true');canvas.style.cssText='position:fixed;z-index:2147483000;pointer-events:none;contain:strict;';document.body.append(canvas);ctx=canvas.getContext('2d');if(!ctx){mode='off';return;}}
    updateColor();
  };
  new MutationObserver(updateColor).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-scheme','style']});
  document.addEventListener('pointermove',e=>add(e,false),{passive:true});document.addEventListener('pointerdown',e=>{if(e.button===0)add(e,true);},{passive:true});
  document.addEventListener('visibilitychange',stop);window.addEventListener('blur',stop);window.addEventListener('resize',stop);window.addEventListener('cft:zoom',stop);reduced.addEventListener('change',stop);
})();
