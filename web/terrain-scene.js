/* Shared Endfield terrain. Real perspective projection, no moving UI; bounded flow rendering while visible. */
(()=>{'use strict';
 const asset=new URL('terrain-contours.svg',document.currentScript.src).href;
 let geometry;
 function loadGeometry(){return geometry||(geometry=fetch(asset).then(r=>{if(!r.ok)throw Error('Terrain asset unavailable');return r.text();}).then(text=>{
   const doc=new DOMParser().parseFromString(text,'image/svg+xml');
   return [...doc.querySelectorAll('path[d]')].map((p,level)=>({level,segments:[...p.getAttribute('d').matchAll(/M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/g)].map(m=>m.slice(1).map(Number))})).filter(p=>p.segments.length);
 }));}
 function mount(host,{strength=1,interactive=true,flow=false,fps=24,cover=false}={}){
   const canvas=document.createElement('canvas');canvas.className='ef-terrain-canvas';canvas.setAttribute('aria-hidden','true');host.append(canvas);
   const ctx=canvas.getContext('2d'),motion=matchMedia('(prefers-reduced-motion: reduce)');
   let contours=[],width=0,height=0,frame=0,enabled=true,visible=true,disposed=false,x=0,y=0,tx=0,ty=0,draws=0,lastFrame=0,phase=0;
   const dark=()=>host.dataset.palette==='dark'||(host.dataset.palette!=='light'&&document.documentElement.dataset.theme!=='light_endfield');
   function project(X,Y,Z=0){
     X-=600;Y-=450;
     if(flow&&!(motion.matches||window.CFTMotion?.reduced())){X+=Math.sin(phase+Z*.025)*7;Y+=Math.cos(phase*.7+Z*.02)*6;Z+=Math.sin(phase+X*.003)*3;}
     const yaw=x*.12,tilt=(53+y*7)*Math.PI/180;
     const a=X*Math.cos(yaw)-Y*Math.sin(yaw),b=X*Math.sin(yaw)+Y*Math.cos(yaw);
     const depth=b*Math.sin(tilt)+Z*Math.cos(tilt),perspective=1500/(1500-depth);
     const scale=cover?Math.max(width/1000,height/420)*1.22:Math.min(width/1180,height/650)*.95;
     return [width*.5+a*perspective*scale,height*.57+(b*Math.cos(tilt)-Z*Math.sin(tilt))*perspective*scale,perspective];
   }
   function draw(){
     if(!width||!height||disposed)return;
     draws++;ctx.clearRect(0,0,width,height);
     const rgb=dark()?'193,204,205':'43,55,54';
     // Equally spaced ground points recede naturally; terrain density comes from elevation.
     for(let Y=0;Y<=900;Y+=30)for(let X=0;X<=1200;X+=30){const [a,b,s]=project(X,Y,-8);ctx.fillStyle=`rgba(${rgb},${.22*strength})`;ctx.beginPath();ctx.arc(a,b,Math.max(.45,s*.9),0,Math.PI*2);ctx.fill();}
     for(const {level,segments} of contours){
       ctx.beginPath();for(const [a,b,c,d] of segments){const p=project(a,b,level*3.2),q=project(c,d,level*3.2);ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);}
       ctx.strokeStyle=`rgba(${rgb},${(level%5===0?.67:.37)*strength})`;ctx.lineWidth=level%5===0?1.25:.65;ctx.stroke();
     }
     // Survey beacons sit above their ground anchors, not on the same flat bitmap.
     const pins=[[225,260,107],[705,490,112]];ctx.strokeStyle=dark()?'#ffef01':'#737900';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=1;
     for(const [a,b,z] of pins){const p=project(a,b,0),q=project(a,b,z+30);ctx.globalAlpha=.75*strength;ctx.beginPath();ctx.moveTo(...p.slice(0,2));ctx.lineTo(...q.slice(0,2));ctx.stroke();ctx.fillRect(q[0]-2.5,q[1]-2.5,5,5);ctx.beginPath();ctx.ellipse(p[0],p[1],7,3,0,0,Math.PI*2);ctx.stroke();}
     const p=project(...pins[0]),q=project(...pins[1]);ctx.beginPath();ctx.moveTo(...p.slice(0,2));ctx.lineTo(...q.slice(0,2));ctx.stroke();ctx.globalAlpha=1;
     canvas.dataset.draws=String(draws);canvas.dataset.ready=String(contours.length>0);
   }
   function tick(now=performance.now()){frame=0;if(disposed||document.hidden||!enabled||!visible||window.CFTMotion?.paused())return;
     const flowing=flow&&!(motion.matches||window.CFTMotion?.reduced());
     if(now-lastFrame<1000/Math.max(1,window.CFTMotion?.effectiveFps(fps)??fps)){frame=requestAnimationFrame(tick);return;}
     lastFrame=now;phase=now*.00013;
     x+=(tx-x)*.22;y+=(ty-y)*.22;
     const moving=Math.abs(tx-x)+Math.abs(ty-y)>=.002;
     if(!moving){x=tx;y=ty;}
     draw();if(moving||flowing)frame=requestAnimationFrame(tick);
   }
   function request(){if(!frame&&!disposed&&!document.hidden&&enabled&&visible)frame=requestAnimationFrame(tick);}
   function reset(){tx=ty=x=y=0;if(frame)cancelAnimationFrame(frame);frame=0;if(enabled&&visible&&!document.hidden){draw();if(flow&&!(motion.matches||window.CFTMotion?.reduced()))request();}}
   function pointer(e){if(!visible||!interactive||(motion.matches||window.CFTMotion?.reduced())||!enabled||document.hidden||e.pointerType==='touch')return;const r=host.getBoundingClientRect();tx=Math.max(-1,Math.min(1,(e.clientX-r.left)/Math.max(r.width,1)*2-1));ty=Math.max(-1,Math.min(1,(e.clientY-r.top)/Math.max(r.height,1)*2-1));request();}
   function resize(){const r=host.getBoundingClientRect();width=Math.round(r.width);height=Math.round(r.height);const dpr=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);request();}
   const intersection=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;if(!visible){cancelAnimationFrame(frame);frame=0;}else request();});intersection.observe(host);
   window.addEventListener('cft:activity-changed',request);
   window.addEventListener('cft:config-saved',reset);
   window.addEventListener('cft:window-moving',request);
   const observer=new ResizeObserver(resize);observer.observe(host);
   const themeObserver=new MutationObserver(request);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
   document.addEventListener('pointermove',pointer,{passive:true});document.documentElement.addEventListener('pointerleave',reset);document.addEventListener('visibilitychange',reset);motion.addEventListener('change',reset);
   loadGeometry().then(data=>{if(disposed)return;contours=data;request();}).catch(()=>{canvas.dataset.ready='error';});
   return {reset,setFlow(value){flow=!!value;reset();},setFps(value){fps=Math.max(1,Math.min(24,Number(value)||24));},setInteractive(value){interactive=!!value;reset();},setEnabled(value){enabled=!!value;if(!enabled&&frame){cancelAnimationFrame(frame);frame=0;}if(enabled){resize();request();}},
     destroy(){window.removeEventListener('cft:activity-changed',request);disposed=true;cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();window.removeEventListener('cft:config-saved',reset);window.removeEventListener('cft:window-moving',request);themeObserver.disconnect();document.removeEventListener('pointermove',pointer);document.documentElement.removeEventListener('pointerleave',reset);document.removeEventListener('visibilitychange',reset);motion.removeEventListener('change',reset);canvas.remove();}};
 }
 window.CFTTerrain={mount};
})();
