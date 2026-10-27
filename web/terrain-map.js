/* A single geographical scene behind all seven pages. Only its camera travels;
   page content and sidebar never inherit perspective or pointer transforms. */
(()=>{'use strict';
 const stations=Object.freeze([
  {id:'download',x:820,y:730,h:135,code:'01 / ACQUISITION'},
  {id:'dlmanager',x:1710,y:610,h:126,code:'02 / TRANSFER'},
  {id:'models',x:2630,y:850,h:145,code:'03 / ARCHIVE'},
  {id:'updates',x:2790,y:1760,h:138,code:'04 / VERSION'},
  {id:'reverse',x:1850,y:1940,h:130,code:'05 / IDENTIFY'},
  {id:'workflow',x:900,y:1770,h:143,code:'06 / WORKFLOW'},
  {id:'settings',x:1740,y:1260,h:150,code:'07 / SYSTEM'},
 ].map(Object.freeze));
 const world={minX:-2400,minY:-2400,w:8400,h:7440},roads=[[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[1,6],[3,6],[5,6]];
 // Low, wide ridges join the individual survey peaks into one non-tiled terrain.
 function elevation(x,y){
  let z=18+10*Math.sin(x/520+y/600)+8*Math.cos(y/380-x/700);
  for(let i=0;i<stations.length;i++){const n=stations[i],dx=(x-n.x)/(i===6?420:350),dy=(y-n.y)/(i%2?310:380);z+=(i===6?65:68+i%3*9)*Math.exp(-.5*(dx*dx+dy*dy));}
  return z+8*Math.sin(x/180+y/310)*Math.cos(y/215);
 }
 let sharedGeometry;
 function geometry(){
  if(sharedGeometry)return sharedGeometry;
  const step=40,nx=world.w/step+1,ny=world.h/step+1,heights=new Float32Array(nx*ny),lines=[];
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)heights[y*nx+x]=elevation(world.minX+x*step,world.minY+y*step);
  for(let level=-12;level<=148;level+=5){
   const segments=[];
   for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
    const values=[heights[y*nx+x],heights[y*nx+x+1],heights[(y+1)*nx+x+1],heights[(y+1)*nx+x]],corners=[[world.minX+x*step,world.minY+y*step],[world.minX+(x+1)*step,world.minY+y*step],[world.minX+(x+1)*step,world.minY+(y+1)*step],[world.minX+x*step,world.minY+(y+1)*step]],cross=[];
    for(let e=0;e<4;e++){const next=(e+1)%4,a=values[e],b=values[next];if((a>=level)===(b>=level))continue;const t=(level-a)/(b-a);cross.push([corners[e][0]+t*(corners[next][0]-corners[e][0]),corners[e][1]+t*(corners[next][1]-corners[e][1])]);}
    if(cross.length===2)segments.push([...cross[0],...cross[1]]);
    else if(cross.length===4){const high=values.reduce((a,b)=>a+b,0)/4>=level,first=values[0]>=level;
     // Resolve saddles deterministically, so neighboring contour bands never blink.
     const pairs=high===first?[[0,1],[2,3]]:[[0,3],[1,2]];for(const [a,b] of pairs)segments.push([...cross[a],...cross[b]]);
    }
   }
   if(segments.length)lines.push({z:level,major:(level-8)%20===0,segments});
  }
  const dots=[];for(let y=world.minY;y<=world.minY+world.h;y+=90)for(let x=world.minX;x<=world.minX+world.w;x+=90)dots.push([x,y,elevation(x,y)-3]);
  const routes=roads.map(([a,b])=>{const p=stations[a],q=stations[b],points=[];for(let i=0;i<=30;i++){const t=i/30,x=p.x+(q.x-p.x)*t,y=p.y+(q.y-p.y)*t;points.push([x,y,elevation(x,y)+1]);}return points;});
  // Spatial batches retain every original segment; cull only wholly offscreen batches.
  for(const line of lines){const tiles=new Map();for(const seg of line.segments){const key=Math.floor((seg[0]+seg[2])/800)+':'+Math.floor((seg[1]+seg[3])/800);let tile=tiles.get(key);if(!tile){tile={segments:[],minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};tiles.set(key,tile);}tile.segments.push(seg);tile.minX=Math.min(tile.minX,seg[0],seg[2]);tile.maxX=Math.max(tile.maxX,seg[0],seg[2]);tile.minY=Math.min(tile.minY,seg[1],seg[3]);tile.maxY=Math.max(tile.maxY,seg[1],seg[3]);}line.tiles=[...tiles.values()];}
  return sharedGeometry={lines,dots,routes};
 }
 function mount(host,{strength=.23,interactive=true,flow=true,fps=60,culling=true}={}){
  const canvas=document.createElement('canvas');canvas.className='ef-terrain-canvas';canvas.setAttribute('aria-hidden','true');canvas.dataset.mapStations=String(stations.length);host.append(canvas);
  const ctx=canvas.getContext('2d'),motion=matchMedia('(prefers-reduced-motion: reduce)'),scene=geometry();
  let width=0,height=0,frame=0,lastFrame=0,enabled=true,disposed=false,draws=0,x=0,y=0,tx=0,ty=0,current='',trip=null;
  let workflowDetail=false,workflowHeld=false,workflowYaw=0,workflowTilt=51;
  let camera={x:1740,y:1260,z:elevation(1740,1260),zoom:1,reveal:0},target={...camera};
  let sy=0,cy=1,st=0,ct=1,scale=1,tide=0,pixelRatio=1.5;
  const dark=()=>document.documentElement.dataset.theme!=='light_endfield',canAnimate=()=>flow&&!(motion.matches||window.CFTMotion?.reduced());
  const ease=t=>1-Math.pow(1-t,3);
  function advance(now){if(!trip)return false;const t=Math.min(1,Math.max(0,(now-trip.at)/trip.duration)),v=ease(t);for(const k of ['x','y','z','zoom','reveal'])camera[k]=trip.start[k]+(target[k]-trip.start[k])*v;camera.zoom-=Math.sin(Math.PI*t)*.09;if(t===1){camera={...target};trip=null;}return !!trip;}
  function focusPage(id,{animate=true}={}){
   const station=stations.find(s=>s.id===id);if(!station||disposed)return false;
   if(current===id)return true;
   const now=performance.now(),first=!current;advance(now);current=id;target={x:station.x,y:station.y,z:elevation(station.x,station.y),zoom:id==='workflow'&&workflowDetail?2.2:1,reveal:id==='workflow'&&workflowDetail?1:0};
   const distance=Math.hypot(target.x-camera.x,target.y-camera.y);
   if(first||!animate||!canAnimate()||!enabled||document.hidden){camera={...target};trip=null;}
   else trip={start:{...camera},at:now,duration:Math.min(820,470+distance*.1)};
   canvas.dataset.mapPage=id;canvas.dataset.activePillar=station.code.slice(0,2);canvas.dataset.mapSettled=String(!trip);request();return true;
  }
  function reference(X,Y,Z){const station=stations[5],tilt=51*Math.PI/180;X-=station.x;Y-=station.y;Z-=elevation(station.x,station.y);const depth=Y*Math.sin(tilt)+Z*Math.cos(tilt),p=2200/Math.max(620,2200-depth),s=Math.max(width/1430,height/1010)*1.15*2.2;return [width*(width<650?.61:.69)+X*p*s,height*.74+(Y*Math.cos(tilt)-Z*Math.sin(tilt))*p*s,p];}
  function project(X,Y,Z){
   X-=camera.x;Y-=camera.y;Z-=camera.z;Z+=tide;
   const a=X*cy-Y*sy,b=X*sy+Y*cy,depth=b*st+Z*ct,p=2200/Math.max(620,2200-depth);
   return [width*(width<650?.61:.69)+a*p*scale,height*.74+(b*ct-Z*st)*p*scale,p];
  }
  function tileVisible(tile,z){
   if(!culling)return true;
   const corners=[[tile.minX,tile.minY],[tile.maxX,tile.minY],[tile.maxX,tile.maxY],[tile.minX,tile.maxY]];
   const depths=corners.map(([X,Y])=>((X-camera.x)*sy+(Y-camera.y)*cy)*st+(z-camera.z+tide)*ct);
   if(Math.min(...depths)<1580&&Math.max(...depths)>1580)return true;
   const points=corners.map(([X,Y])=>project(X,Y,z));
   return !(points.every(p=>p[0]<-85)||points.every(p=>p[0]>width+85)||points.every(p=>p[1]<-85)||points.every(p=>p[1]>height+85));
  }
  const inView=(p,margin=40)=>p[0]>-margin&&p[0]<width+margin&&p[1]>-margin&&p[1]<height+margin;
  function draw(now=performance.now()){
   if(!width||!height||disposed||!enabled||document.hidden)return;
   const before=performance.now();draws++;ctx.clearRect(0,0,width,height);
   const heading=x*.12+(current==='workflow'&&workflowDetail?workflowYaw*Math.PI/180:0);sy=Math.sin(heading);cy=Math.cos(heading);const tilt=((current==='workflow'&&workflowDetail?workflowTilt:51)+y*7)*Math.PI/180;st=Math.sin(tilt);ct=Math.cos(tilt);
   scale=Math.max(width/1430,height/1010)*1.15*camera.zoom;tide=current==='workflow'&&workflowDetail?0:canAnimate()?Math.sin(now*.00014)*1.25:0;
   ctx.globalAlpha=current==='workflow'?1-camera.reveal:1;
   const rgb=dark()?'193,204,205':'43,55,54',gold=dark()?'#ffef01':'#8b8000';
   if(current!=='workflow'||camera.reveal<1){
   ctx.fillStyle=`rgba(${rgb},${strength*.13})`;
   ctx.beginPath();for(const d of scene.dots){const p=project(...d);if(!inView(p,3))continue;const r=Math.max(.38,Math.min(.85,p[2]*.6));ctx.moveTo(p[0]+r,p[1]);ctx.arc(p[0],p[1],r,0,Math.PI*2);}ctx.fill();
   for(const line of scene.lines){ctx.beginPath();for(const tile of line.tiles){if(!tileVisible(tile,line.z))continue;for(const [a,b,c,d] of tile.segments){const p=project(a,b,line.z),q=project(c,d,line.z);if((p[0]<-80&&q[0]<-80)||(p[0]>width+80&&q[0]>width+80)||(p[1]<-80&&q[1]<-80)||(p[1]>height+80&&q[1]>height+80))continue;ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);}}ctx.strokeStyle=`rgba(${rgb},${strength*(line.major?.75:.37)})`;ctx.lineWidth=line.major?1.1:.6;ctx.stroke();}
   }
   // Survey links follow actual surface elevation; they are not lines on the UI.
   ctx.strokeStyle=gold;ctx.globalAlpha=strength*.48*(current==='workflow'?1-Math.min(1,camera.reveal/.65):1);ctx.lineWidth=.8;
   for(const route of scene.routes){ctx.beginPath();route.forEach((n,i)=>{const p=project(...n);i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);});ctx.stroke();}
   const sorted=stations.map(n=>({n,p:project(n.x,n.y,elevation(n.x,n.y)),q:project(n.x,n.y,elevation(n.x,n.y)+n.h)})).sort((a,b)=>a.p[1]-b.p[1]);
   for(const {n,p,q} of sorted){if(!inView(p,220)&&!inView(q,220))continue;const active=n.id===current,fade=current==='workflow'?1-Math.min(1,camera.reveal/.65):1;ctx.globalAlpha=fade*strength*(active?1.65:.55);ctx.strokeStyle=gold;ctx.fillStyle=gold;ctx.lineWidth=active?1.3:.8;
    ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();ctx.fillRect(q[0]-(active?3:2),q[1]-(active?3:2),active?6:4,active?6:4);
    // The anchor is projected on the ground plane, so pointer tilt changes its ellipse naturally.
    ctx.beginPath();for(let i=0;i<=40;i++){const a=i/40*Math.PI*2,r=active?17:10,point=project(n.x+Math.cos(a)*r,n.y+Math.sin(a)*r,elevation(n.x,n.y)+1);i?ctx.lineTo(point[0],point[1]):ctx.moveTo(point[0],point[1]);}ctx.stroke();
    ctx.globalAlpha=fade*strength*(active?1.4:.45);ctx.font=(active?'600 ':'400 ')+'9px sans-serif';ctx.fillText(n.code,q[0]+10,q[1]+3);
    if(active){canvas.dataset.focusX=p[0].toFixed(2);canvas.dataset.focusY=p[1].toFixed(2);canvas.dataset.pillarTipX=q[0].toFixed(2);canvas.dataset.pillarTipY=q[1].toFixed(2);}
   }
   ctx.globalAlpha=1;
   canvas.dataset.workflowReveal=camera.reveal.toFixed(3);canvas.dataset.surface=current==='workflow'&&workflowDetail?'city':'contours';canvas.dataset.contourOpacity=(current==='workflow'?1-camera.reveal:1).toFixed(3);canvas.dataset.workflowPillarOpacity=(current==='workflow'?1-Math.min(1,camera.reveal/.65):1).toFixed(3);
   if(current==='workflow'&&(workflowDetail||window.CftWorkflowGraph?.isFlat()&&window.CftWorkflowGraph?.isFull()))window.CftWorkflowGraph?.paintTerrain?.({project,reference,elevation:()=>elevation(stations[5].x,stations[5].y)-50,station:stations[5],zoom:camera.zoom,reveal:camera.reveal,yaw:workflowYaw,tilt:workflowTilt,cameraX:camera.x,cameraY:camera.y,ctx,width,height});
   canvas.dataset.workflowYaw=String(workflowYaw);canvas.dataset.workflowTilt=String(workflowTilt);canvas.dataset.draws=String(draws);canvas.dataset.ready='true';canvas.dataset.cameraX=camera.x.toFixed(2);canvas.dataset.cameraY=camera.y.toFixed(2);canvas.dataset.cameraZoom=camera.zoom.toFixed(3);canvas.dataset.mapSettled=String(!trip);canvas.dataset.yaw=x.toFixed(4);canvas.dataset.tilt=(51+y*7).toFixed(3);canvas.dataset.drawMs=(performance.now()-before).toFixed(1);
  }
  function request(){if(!frame&&!disposed&&enabled&&!document.hidden&&!window.CFTMotion?.paused())frame=requestAnimationFrame(tick);}
  function tick(now){frame=0;if(disposed||!enabled||document.hidden||window.CFTMotion?.paused())return;const budget=fps>0?1000/fps:0;if(budget&&now-lastFrame<budget-.6){request();return;}lastFrame=budget?now-(now-lastFrame)%budget:now;const delta=Math.min(80,Math.max(1,now-(tick.at||now-40)));tick.at=now;
   const travelling=advance(now),amount=1-Math.pow(.78,delta/(1000/24));x+=(tx-x)*amount;y+=(ty-y)*amount;const moving=Math.abs(tx-x)+Math.abs(ty-y)>.001;if(!moving){x=tx;y=ty;}draw(now);if(travelling||moving||canAnimate())request();
  }
  function settle(){camera={...target};trip=null;canvas.dataset.mapSettled='true';}
  function reset(){tx=ty=x=y=0;if(frame)cancelAnimationFrame(frame);frame=0;tick.at=0;if(!canAnimate())settle();if(enabled&&!document.hidden){draw();if(trip||canAnimate())request();}}
  function pointer(e){if(workflowHeld||current==='workflow'&&workflowDetail||!interactive||(motion.matches||window.CFTMotion?.reduced())||!enabled||disposed||document.hidden||e.pointerType==='touch')return;const r=host.getBoundingClientRect();tx=Math.max(-1,Math.min(1,(e.clientX-r.left)/Math.max(r.width,1)*2-1));ty=Math.max(-1,Math.min(1,(e.clientY-r.top)/Math.max(r.height,1)*2-1));request();}
  function resize(){const r=host.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,pixelRatio);width=Math.round(r.width);height=Math.round(r.height);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);request();}
  function visibility(){if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=0;settle();}else reset();}
  function moveState(){if(window.CFTMotion?.paused()){cancelAnimationFrame(frame);frame=0;}else request();}
  window.addEventListener('cft:window-moving',moveState);
  const sizeObserver=new ResizeObserver(resize);sizeObserver.observe(host);
  const themeObserver=new MutationObserver(request);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  document.addEventListener('pointermove',pointer,{passive:true});document.documentElement.addEventListener('pointerleave',reset);document.addEventListener('visibilitychange',visibility);motion.addEventListener('change',reset);
  resize();
  return {focusPage,setWorkflowDetail(value){workflowDetail=!!value;if(workflowDetail){tx=ty=x=y=0;}if(current!=='workflow')return;const now=performance.now();advance(now);const station=stations[5],zoom=workflowDetail?2.2:1,reveal=workflowDetail?1:0;if(target.zoom===zoom&&target.reveal===reveal){request();return;}target={x:station.x,y:station.y,z:elevation(station.x,station.y),zoom,reveal};if(canAnimate()&&enabled&&!document.hidden)trip={start:{...camera},at:now,duration:860};else settle();request();},
   holdWorkflow(value){workflowHeld=!!value;if(workflowHeld){tx=x;ty=y;}request();},moveWorkflow({factor=1,dx=0,dy=0,fit=false,rotate=0,tilt=0}={}){if(current!=='workflow'||!workflowDetail)return;advance(performance.now());const n=stations[5];if(fit){workflowYaw=0;workflowTilt=51;camera={x:n.x,y:n.y,z:elevation(n.x,n.y),zoom:2.2,reveal:1};}else{workflowYaw=((workflowYaw+rotate+180)%360+360)%360-180;workflowTilt=Math.max(25,Math.min(70,workflowTilt+tilt));const a=project(camera.x,camera.y,camera.z),b=project(camera.x+1,camera.y,camera.z),c=project(camera.x,camera.y+1,camera.z),ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-a[0],vy=c[1]-a[1],det=ux*vy-uy*vx;if(Math.abs(det)>.001){camera.x-=(dx*vy-dy*vx)/det;camera.y-=(dy*ux-dx*uy)/det;}camera.zoom=Math.max(.8,Math.min(6,camera.zoom*factor));camera.reveal=1;}target={...camera};trip=null;request();},redraw:request,
   reset,setPixelRatio(value){const next=Math.max(1,Math.min(2,Number(value)||1.5));if(next===pixelRatio)return;pixelRatio=next;resize();},setFlow(value){value=!!value;if(flow===value)return;flow=value;reset();},setInteractive(value){value=!!value;if(interactive===value)return;interactive=value;reset();},setFps(value){fps=Number(value)===0?0:Math.max(15,Math.min(360,Number(value)||60));canvas.dataset.frameLimit=String(fps);},setEnabled(value){value=!!value;if(enabled===value)return;enabled=value;if(!enabled){if(frame)cancelAnimationFrame(frame);frame=0;settle();}else{settle();resize();reset();}},
   destroy(){disposed=true;cancelAnimationFrame(frame);sizeObserver.disconnect();window.removeEventListener('cft:window-moving',moveState);themeObserver.disconnect();document.removeEventListener('pointermove',pointer);document.documentElement.removeEventListener('pointerleave',reset);document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',reset);canvas.remove();}};
 }
 window.CFTTerrainMap={mount,stations};
})();
