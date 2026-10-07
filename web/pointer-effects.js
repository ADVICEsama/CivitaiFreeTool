/* 软件内的轻量几何点击 / 拖尾。无桌面覆盖层、无鼠标钩子、空闲零绘制。 */
"use strict";
(function () {
  let canvas, ctx, mode = "off", quality = "low", raf = 0, lastFrame = 0, lastMove = 0, particles = [];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; particles = [];
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (canvas) { canvas.hidden = true; canvas.dataset.running = "false"; }
  }
  function resize() {
    if (!canvas) return;
    const z = Number(document.documentElement.style.zoom) || 1;
    const dpr = Math.min(devicePixelRatio || 1, quality === "low" ? 1 : 1.5);
    canvas.style.width = innerWidth / z + "px"; canvas.style.height = innerHeight / z + "px";
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function usable() { return mode !== "off" && !reduced.matches && !document.hidden && document.hasFocus(); }
  function tick(now) {
    raf = 0;
    if (!usable()) { stop(); return; }
    const delay = quality === "low" ? 1000/30 : 1000/60;
    if (now - lastFrame < delay) { raf = requestAnimationFrame(tick); return; }
    lastFrame = now;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    particles = particles.filter(p => now - p.born < p.life);
    const color = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#60a5fa";
    ctx.strokeStyle = color; ctx.fillStyle = color;
    for (const p of particles) {
      const t = (now-p.born)/p.life, opacity = Math.max(0,1-t);
      ctx.globalAlpha = opacity * .65;
      ctx.lineWidth = 1.5;
      if (p.ring) {
        ctx.beginPath(); ctx.arc(p.x,p.y,4+t*32,0,Math.PI*2); ctx.stroke();
      } else {
        const x = p.x+p.dx*t, y = p.y+p.dy*t;
        ctx.save(); ctx.translate(x,y); ctx.rotate(p.angle+t*.7);
        ctx.beginPath(); ctx.moveTo(0,-p.size); ctx.lineTo(p.size,p.size); ctx.lineTo(-p.size,p.size); ctx.closePath(); ctx.stroke(); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (particles.length) raf = requestAnimationFrame(tick); else stop();
  }
  function add(e, click) {
    if (!usable() || (!click && mode !== "trail")) return;
    const now = performance.now();
    if (!click && now-lastMove < (quality === "low" ? 34 : 17)) return;
    if (!click) lastMove = now;
    const count = click ? (quality === "low" ? 6 : 10) : 1;
    const limit = quality === "low" ? 40 : 80;
    if (click) particles.push({x:e.clientX,y:e.clientY,born:now,life:600,ring:true});
    for (let i=0;i<count;i++) {
      const angle = Math.random()*Math.PI*2, distance = click ? 20+Math.random()*28 : 6;
      particles.push({x:e.clientX,y:e.clientY,dx:Math.cos(angle)*distance,dy:Math.sin(angle)*distance,angle,size:click?3:2,born:now,life:click?550:300});
    }
    if (particles.length>limit) particles.splice(0,particles.length-limit);
    canvas.hidden=false; canvas.dataset.running="true";
    if (!raf) raf=requestAnimationFrame(tick);
  }
  window.applyPointerEffects = cfg => {
    const next = ["click","trail"].includes(cfg.pointer_effects) ? cfg.pointer_effects : "off";
    quality = cfg.pointer_effect_quality === "high" ? "high" : "low";
    mode = next;
    if (mode === "off" || reduced.matches) { stop(); return; }
    if (!canvas) {
      canvas = document.createElement("canvas"); canvas.id="pointerEffects"; canvas.setAttribute("aria-hidden","true");
      canvas.style.cssText="position:fixed;inset:0;z-index:2147483000;pointer-events:none;";
      document.body.appendChild(canvas); ctx=canvas.getContext("2d");
      if (!ctx) { mode="off"; return; }
    }
    stop(); resize();
  };
  document.addEventListener("pointermove",e=>add(e,false),{passive:true});
  document.addEventListener("pointerdown",e=>{ if(e.button===0)add(e,true); },{passive:true});
  document.addEventListener("visibilitychange",stop);
  window.addEventListener("blur",stop);
  window.addEventListener("resize",()=>{stop();resize();});
  window.addEventListener("cft:zoom",()=>{stop();resize();});
  reduced.addEventListener("change",stop);
})();
