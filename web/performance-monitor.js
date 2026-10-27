/* Opt-in frame sampling. Off/hidden means no monitoring requestAnimationFrame. */
(()=>{'use strict';let hud,frame=0,enabled=false,samples=[],lastUpdate=0,mapStart=0,mapAt=0;
 function tick(now){frame=0;if(!enabled||document.hidden)return;samples.push(now);while(samples.length>2&&samples[0]<now-1000)samples.shift();
  if(now-lastUpdate>=500){const elapsed=now-samples[0],fps=elapsed>100?Math.round((samples.length-1)*1000/elapsed):null,map=document.querySelector('#efTerrain canvas'),draws=Number(map?.dataset.draws||0),mapFps=mapAt&&now>mapAt?Math.round((draws-mapStart)*1000/(now-mapAt)):null;hud.textContent=(fps??'—')+' FPS';hud.title='UI requestAnimationFrame 帧率：'+(fps??'采样中')+'；地图实际绘制：'+(mapFps??'采样中')+' FPS。并非 GPU 使用率。';hud.dataset.uiFps=String(fps??'');hud.dataset.mapFps=String(mapFps??'');mapStart=draws;mapAt=now;lastUpdate=now;}
  frame=requestAnimationFrame(tick);
 }
 function start(){samples=[];lastUpdate=mapAt=0;mapStart=Number(document.querySelector('#efTerrain canvas')?.dataset.draws||0);if(enabled&&!document.hidden&&!frame)frame=requestAnimationFrame(tick);}
 function sync(cfg=typeof state==='undefined'?{}:state.cfg){if(!hud){const place=document.querySelector('.nav-right');if(!place)return;hud=document.createElement('output');hud.id='fpsMonitor';hud.setAttribute('aria-label','界面帧率');hud.textContent='— FPS';place.prepend(hud);}const next=cfg?.show_fps===true;hud.hidden=!next;if(enabled===next)return;enabled=next;if(frame)cancelAnimationFrame(frame);frame=0;if(enabled)start();}
 document.addEventListener('visibilitychange',()=>{if(frame)cancelAnimationFrame(frame);frame=0;if(!document.hidden)start();});window.addEventListener('cft:config-saved',()=>sync());window.CFTPerformance={sync};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>sync(),{once:true});else sync();
})();
