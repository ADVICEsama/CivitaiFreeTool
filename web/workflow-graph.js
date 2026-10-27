/* Read-only workflow city. Original node coordinates undergo one uniform world transform;
   solid roof links are serialized ComfyUI edges, buildings are decorative geometry only. */
window.CftWorkflowGraph=(()=>{
 const q=s=>document.querySelector(s),NS='http://www.w3.org/2000/svg';
 const cityGeometryCache=new Map(),flowDots=[],flatOffsets=new Map();
 const citySurface=document.createElement('canvas');citySurface.dataset.workflowCitySurface='true';const cityContext=citySurface.getContext('2d');
 const viewport=q('#wfGraphViewport'),canvas=q('#wfGraphCanvas');
 let full=true,result=null,nodes=[],edges=[],world=[],elements=[],wires=[],associations=[],plate=null,selected=-1,drag=null,bounds=null,dirty=true,layoutKey='',svg,buildings=[],cityRegionKey='',cityPaintKey='',graphFrameKey='',lastCameraKey='',cameraChangedAt=0,qualityTimer=0,hovered=-1,overview=false,pendingFocus=false,spaceHeld=false,leftAction='pan',flatRevision=0,flat=false,flatView={cx:0,cy:0,scale:2,ready:false};
 try{const value=localStorage.getItem('cft-workflow-view');if(value)full=value==='full';}catch(_){}
 function el(tag,attrs={},text){const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!=null)e.textContent=text;return e;}
 function invalidate(){bounds=null;dirty=true;graphFrameKey='';window.CFTEndfield?.redraw();}
 function mode(value){endDrag();full=!!value;q('#wfGraphSection').hidden=!full;for(const [id,on] of [['wfSimple',!full],['wfFull',full]]){const b=q('#'+id);b.classList.remove('btn-primary');b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}q('.wf-view-switch').dataset.view=full?'full':'simple';try{localStorage.setItem('cft-workflow-view',full?'full':'simple');}catch(_){}window.CFTWorkflowAtlas?.setMode(full);invalidate();syncFlow();}
 q('#wfSimple').onclick=()=>mode(false);q('#wfFull').onclick=()=>mode(true);
 q('.wf-view-switch').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();mode(e.key==='ArrowRight'||e.key==='End');q(full?'#wfFull':'#wfSimple').focus();});
 function fit(){if(flat){const xs=world.map((n,i)=>n.x+(flatOffsets.get(i)?.[0]||0)),ys=world.map((n,i)=>n.y+(flatOffsets.get(i)?.[1]||0));flatView.cx=(Math.min(...xs)+Math.max(...xs))/2;flatView.cy=(Math.min(...ys)+Math.max(...ys))/2;flatView.scale=Math.max(.2,Math.min(3,(bounds.width-220)/Math.max(1,Math.max(...xs)-Math.min(...xs)),(bounds.height-100)/Math.max(1,Math.max(...ys)-Math.min(...ys))));graphFrameKey='';window.CFTEndfield?.redraw();return;}pendingFocus=false;overview=true;dirty=true;layoutKey='';window.CFTEndfield?.moveWorkflow({fit:true});invalidate();}
 function zoom(factor){if(flat){flatView.scale=Math.max(.2,Math.min(5,flatView.scale*factor));graphFrameKey='';window.CFTEndfield?.redraw();}else window.CFTEndfield?.moveWorkflow({factor});}
 q('#wfGraphFit').onclick=fit;q('#wfGraphPlus').onclick=()=>zoom(1.2);q('#wfGraphMinus').onclick=()=>zoom(1/1.2);
 viewport.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey)return;e.preventDefault();zoom(Math.exp(-Math.max(-120,Math.min(120,e.deltaY))*.002));},{passive:false});
 function endDrag(){if(!drag)return;const id=drag.id;drag=null;viewport.classList.remove('dragging','rotating');canvas.dataset.dragging='false';canvas.dataset.gesture='none';if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id);window.CFTEndfield?.holdWorkflow(false);}
 viewport.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('button,input,textarea'))return;endDrag();const node=e.target.closest('[data-node-index]'),index=node?Number(node.dataset.nodeIndex):-1;if(index>=0)choose(index);
  const kind=flat?(index>=0&&!spaceHeld?'node':leftAction==='select'&&!spaceHeld?'select':'pan'):spaceHeld?'rotate':leftAction;
  if(kind==='select')return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,kind,node:index,moved:false};viewport.setPointerCapture(e.pointerId);viewport.classList.add(kind==='rotate'?'rotating':'dragging');canvas.dataset.dragging='true';canvas.dataset.gesture=kind;window.CFTEndfield?.holdWorkflow(true);e.preventDefault();
 });
 viewport.addEventListener('pointermove',e=>{if(!drag)return;if(e.pointerId!==drag.id)return;if(!(e.buttons&1)){endDrag();return;}const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)<4)return;drag.moved=true;
  if(drag.kind==='node'){const previous=flatOffsets.get(drag.node)||[0,0];flatOffsets.set(drag.node,[previous[0]+dx/flatView.scale,previous[1]+dy/flatView.scale]);flatRevision++;graphFrameKey='';window.CFTEndfield?.redraw();}
  else if(flat){flatView.cx-=dx/flatView.scale;flatView.cy-=dy/flatView.scale;graphFrameKey='';window.CFTEndfield?.redraw();}
  else window.CFTEndfield?.moveWorkflow(drag.kind==='rotate'?{rotate:dx*.35,tilt:-dy*.2}:{dx,dy});drag.x=e.clientX;drag.y=e.clientY;
 });
 for(const event of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(event,endDrag);
 const editable=e=>!!e.target?.closest?.('input,textarea,select,[contenteditable=true]');
 window.addEventListener('keydown',e=>{if(e.code!=='Space'||editable(e)||!full||!result||!q('#page-workflow').classList.contains('active'))return;e.preventDefault();spaceHeld=true;viewport.classList.add('space-rotate');});
 window.addEventListener('keyup',e=>{if(e.code!=='Space')return;spaceHeld=false;viewport.classList.remove('space-rotate');endDrag();});
 const cancelGesture=()=>{spaceHeld=false;viewport.classList.remove('space-rotate');endDrag();};
 window.addEventListener('pointerup',endDrag,true);window.addEventListener('blur',cancelGesture);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelGesture();});
 window.addEventListener('cft:page-changed',cancelGesture);
 canvas.addEventListener('pointerover',e=>{const g=e.target.closest('[data-node-index]');hovered=g?Number(g.dataset.nodeIndex):-1;window.CFTEndfield?.redraw();});
 canvas.addEventListener('pointerleave',()=>{hovered=-1;window.CFTEndfield?.redraw();});

 function choose(index){const n=nodes[index];if(!n)return;if(n._summary)window.CFTWorkflowAtlas?.selectSummary(n);else window.CftWorkflow.select(index);highlight(index);}
 canvas.addEventListener('click',e=>{const g=e.target.closest('[data-node-index]');if(g)choose(Number(g.dataset.nodeIndex));});
 canvas.addEventListener('keydown',e=>{const g=e.target.closest('[data-node-index]');if(g&&['Enter',' '].includes(e.key)){e.preventDefault();choose(Number(g.dataset.nodeIndex));}});
 function highlight(index){selected=index;elements.forEach((e,i)=>{e.group.classList.toggle('selected',i===index);e.group.setAttribute('aria-pressed',String(i===index));});window.CFTEndfield?.redraw();}
 function summary(r){const positive=r.positive||r.pos_prompt,negative=r.negative||r.neg_prompt;const list=[{title:'输入图片',_kind:'image',position:[0,0],parameters:[{name:'文件',value:r.file||'未命名'}]}];
  if(positive)list.push({title:'正面提示词',_kind:'positive',position:[-380,-220],parameters:[{name:'正面',value:positive}]});
  if(negative)list.push({title:'负面提示词',_kind:'negative',position:[380,-220],parameters:[{name:'负面',value:negative}]});
  list.push({title:r.source==='image'?'图片信息':'生成参数',_kind:'parameters',position:[-300,300],parameters:Object.entries(r.generation_parameters||{}).map(([name,value])=>({name,value}))});
  if(r.models?.length)list.push({title:'引用模型',_kind:'models',position:[350,290],parameters:r.models.map((value,i)=>({name:'模型 '+(i+1),value}))});
  return list.map((n,i)=>({...n,id:'summary-'+i,type:'信息摘要 · 非 ComfyUI 节点',_summary:true}));
 }
 function render(r){endDrag();overview=false;pendingFocus=true;flatView.ready=false;flatOffsets.clear();flatRevision++;world=[];result=r;nodes=(r.nodes?.length?r.nodes.slice(0,300):summary(r));selected=nodes.length?0:-1;
  const ids=new Map(nodes.map((n,i)=>[String(n.id??i+1),i]));
  const serialized=Array.isArray(r.edges)?r.edges:(r.nodes||[]).flatMap(n=>(n.inputs||[]).filter(p=>p.source!=null).map(p=>({source:p.source,target:n.id,slot:p.slot??0,input:p.name})));
  edges=r.nodes?.length?serialized.filter(e=>ids.has(String(e.source))&&ids.has(String(e.target))).slice(0,2000).map(e=>({...e,a:ids.get(String(e.source)),b:ids.get(String(e.target))})):[];
  canvas.replaceChildren();canvas.style.transform='none';svg=el('svg',{'aria-label':r.nodes?.length?'建筑沙盘中的工作流节点与真实柱顶连接':'默认信息地图，不包含推测的节点连接',class:'wf-survey-scene wf-city-scene'});canvas.append(svg);plate=null;
  if(!r.nodes?.length&&r.preview_b64){const group=el('g',{class:'wf-image-island'}),shadow=el('path',{class:'wf-image-ground'}),risers=el('path',{class:'wf-image-risers'}),face=el('g'),image=el('image',{href:'data:image/jpeg;base64,'+r.preview_b64,width:90,height:110,preserveAspectRatio:'xMidYMid meet'}),frame=el('rect',{width:90,height:110,class:'wf-image-frame'});face.append(image,frame);group.append(shadow,risers,face);svg.append(group);plate={face,shadow,risers};}
  associations=[];
  flowDots.length=0;
  const socketColors={MODEL:'#c09ae6',CLIP:'#f3da69',VAE:'#e78b8b',CONDITIONING:'#f0b365',LATENT:'#d4a1e6',IMAGE:'#87bbef',MASK:'#82d6a2',INT:'#73cec4',FLOAT:'#88c8a0',STRING:'#bfd18a'},lightColors={MODEL:'#69408e',CLIP:'#766000',VAE:'#aa3541',CONDITIONING:'#8b4905',LATENT:'#854586',IMAGE:'#245d9a',MASK:'#267244',INT:'#206c67',FLOAT:'#33714a',STRING:'#566b25'};
  wires=edges.map((e,i)=>{const type=String(nodes[e.a].outputs?.[Number(e.slot)||0]?.type||nodes[e.b].inputs?.find(p=>p.name===e.input)?.type||'UNKNOWN').toUpperCase(),p=el('path',{id:'wf-real-edge-'+i,class:'wf-wire','data-source':e.source,'data-target':e.target,'data-output-slot':e.slot??0,'data-input':e.input,'data-socket-type':type});p.style.setProperty('--wf-wire-color',socketColors[type]||'#d5dfd7');p.style.setProperty('--wf-wire-light',lightColors[type]||'#344c3c');p.append(el('title',{},`#${e.source} 输出 ${e.slot??0} → #${e.target} / ${e.input||'输入'} · ${type}`));svg.append(p);
   if(i<180){const dot=el('g',{class:'wf-flow-dot','aria-hidden':'true','data-edge-index':i}),motion=el('animateMotion',{dur:(2.8+(i%7)*.16)+'s',begin:(-i*.137)+'s',repeatCount:'indefinite',calcMode:'paced'});dot.style.setProperty('--wf-wire-color',socketColors[type]||'#d5dfd7');dot.style.setProperty('--wf-wire-light',lightColors[type]||'#344c3c');motion.append(el('mpath',{href:'#wf-real-edge-'+i}));dot.append(el('circle',{r:5,fill:'currentColor',opacity:.2}),el('circle',{r:2,fill:'currentColor'}),el('circle',{r:.8,fill:'#fff'}),motion);svg.append(dot);flowDots[i]=dot;}
   return p;
  });

  elements=nodes.map((n,i)=>{const title=n.title||n.type||'节点',group=el('g',{class:'wf-survey-node'+(i===selected?' selected':''),'data-node-index':i,tabindex:0,role:'button','aria-label':`${title}，查看参数`,'aria-pressed':String(i===selected)}),ring=el('path',{class:'wf-survey-ring'}),stem=el('path',{class:'wf-survey-stem'}),hit=el('path',{class:'wf-survey-hit'}),cap=el('rect',{class:'wf-survey-cap',width:6,height:6}),back=el('rect',{class:'wf-city-label-back',rx:0}),texture=el('image',{class:'wf-card-contours',href:'workflow-node-contours.svg',preserveAspectRatio:'xMaxYMid slice'}),label=el('text',{class:'wf-survey-label'},String(title)),id=el('text',{class:'wf-survey-id'},n._summary?'信息摘要':'#'+String(n.id??i+1));group.append(el('title',{},title+'\n'+(n.type||'')+'\n点击查看完整参数'),ring,stem,hit,cap,back,texture,label,id);svg.append(group);return{group,ring,stem,hit,cap,back,texture,label,id};});
  canvas.dataset.graphKind=r.nodes?.length?'comfyui-city':'summary-city';canvas.dataset.edgeCount=String(edges.length);canvas.dataset.nodeCount=String(nodes.length);
  q('.wf-graph-toolbar .hint').textContent=r.nodes?.length?`${edges.length} 条真实连接 · 左键拖动 / 空格+左键旋转 / 滚轮缩放`:'图片信息 · 左键拖动 / 空格+左键旋转 / 滚轮缩放';
  dirty=true;layoutKey='';mode(full);setFlat(flat);syncFlow();
 }
 function nodePositions(){const depth=nodes.map(()=>0);for(let pass=0;pass<Math.min(20,nodes.length);pass++)for(const e of edges)if(e.a!==e.b)depth[e.b]=Math.min(20,Math.max(depth[e.b],depth[e.a]+1));const cols={};return nodes.map((n,i)=>{if(Array.isArray(n.position)&&n.position.length>=2&&n.position.slice(0,2).every(v=>Number.isFinite(v)&&Math.abs(v)<100000))return n.position.slice(0,2);const col=depth[i],row=cols[col]||0;cols[col]=row+1;return [col*320,row*260];});}
 function layout(frame,rect){canvas.dataset.layoutRuns=String((Number(canvas.dataset.layoutRuns)||0)+1);const raw=nodePositions(),minX=Math.min(...raw.map(p=>p[0])),maxX=Math.max(...raw.map(p=>p[0])),minY=Math.min(...raw.map(p=>p[1])),maxY=Math.max(...raw.map(p=>p[1])),angle=-.38;
  const points=raw.map(p=>{const x=p[0]-(minX+maxX)/2,y=p[1]-(minY+maxY)/2;return[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)];});
  const wide=innerWidth>900,left=wide?(innerWidth>1100?242:208):20,right=left,area={x:rect.left+left,y:rect.top+65,w:Math.max(100,rect.width-left-right),h:Math.max(160,rect.height-90)};
  let cx=frame.station.x,cy=frame.station.y,unit=.35;const height=nodes.length>12?35:48;
  for(let pass=0;pass<8;pass++){
   const projected=points.flatMap(p=>{const x=cx+p[0]*unit,y=cy+p[1]*unit,z=frame.elevation(x,y);return [frame.reference(x,y,z),frame.reference(x,y,z+height)];});
   const a=Math.min(...projected.map(p=>p[0]))-10,b=Math.max(...projected.map(p=>p[0]))+95,c=Math.min(...projected.map(p=>p[1]))-15,d=Math.max(...projected.map(p=>p[1]))+12;
   const fx=area.x+area.w/2-(a+b)/2,fy=area.y+area.h/2-(c+d)/2,z=frame.elevation(cx,cy),o=frame.reference(cx,cy,z),u=frame.reference(cx+1,cy,frame.elevation(cx+1,cy)),v=frame.reference(cx,cy+1,frame.elevation(cx,cy+1)),ux=u[0]-o[0],uy=u[1]-o[1],vx=v[0]-o[0],vy=v[1]-o[1],det=ux*vy-uy*vx;
   if(Math.abs(det)>.001){cx+=(fx*vy-fy*vx)/det;cy+=(fy*ux-fx*uy)/det;}
   unit*=Math.max(.6,Math.min(1.3,Math.min(area.w/Math.max(1,b-a),area.h/Math.max(1,d-c))*.94));
  }
  if(nodes.length>12&&!overview)unit=Math.max(unit,.22);
  world=points.map(p=>{const x=cx+p[0]*unit,y=cy+p[1]*unit;return{x,y,z:frame.elevation(x,y),h:height};});
  if(nodes.length>12){
   // Keep imported neighbourhoods, but locally expand colliding labels. No row/column snapping.
   const preferred=world.map(n=>frame.reference(n.x,n.y,n.z+n.h).slice(0,2)),spread=preferred.map(p=>p.slice());
   for(let pass=0;pass<110;pass++){
    for(let a=0;a<spread.length;a++)for(let b=a+1;b<spread.length;b++){
     const dx=spread[b][0]-spread[a][0],dy=spread[b][1]-spread[a][1],ox=310-Math.abs(dx),oy=184-Math.abs(dy);if(ox<=0||oy<=0)continue;
     if(ox/310<oy/184){const sign=Math.sign(preferred[b][0]-preferred[a][0])||1,d=ox*.28*sign;spread[a][0]-=d;spread[b][0]+=d;}
     else{const sign=Math.sign(preferred[b][1]-preferred[a][1])||1,d=oy*.28*sign;spread[a][1]-=d;spread[b][1]+=d;}
    }
    if(pass<80)spread.forEach((p,i)=>{p[0]+=(preferred[i][0]-p[0])*.004;p[1]+=(preferred[i][1]-p[1])*.004;});
   }
   world.forEach((n,i)=>{for(let k=0;k<6;k++){const o=frame.reference(n.x,n.y,n.z+n.h),u=frame.reference(n.x+1,n.y,n.z+n.h),v=frame.reference(n.x,n.y+1,n.z+n.h),ux=u[0]-o[0],uy=u[1]-o[1],vx=v[0]-o[0],vy=v[1]-o[1],det=ux*vy-uy*vx;if(Math.abs(det)<.001)break;const dx=spread[i][0]-o[0],dy=spread[i][1]-o[1];n.x+=(dx*vy-dy*vx)/det;n.y+=(dy*ux-dx*uy)/det;}n.adjustment=Math.hypot(spread[i][0]-preferred[i][0],spread[i][1]-preferred[i][1]);});
  }
  if(flat&&!flatView.ready&&world.length){const n=world[selected]||world[0];flatView={cx:n.x,cy:n.y,scale:2,ready:true};}
  cityGeometryCache.clear();graphFrameKey='';buildCity(frame);canvas.dataset.layoutOrigin=nodes.every(n=>Array.isArray(n.position))?(nodes.length>12?'original-expanded':'original'):'fallback';svg.classList.toggle('dense',nodes.length>12);dirty=false;
 }
 function cityRegion(frame){const extent=Math.ceil(Math.max(550,Math.min(1800,650*2.2/frame.zoom))/200)*200+200,cx=Math.floor(frame.cameraX/200)*200,cy=Math.floor(frame.cameraY/200)*200;const step=frame.zoom>=2?9:frame.zoom>=1.45?14:frame.zoom>=1.05?22:32;return {cx,cy,extent,step,key:[cx,cy,extent,step].join(',')};}
 function buildCity(frame){
  if(!world.length){buildings=[];return;}const region=cityRegion(frame);cityRegionKey=region.key;cityPaintKey='';const cached=cityGeometryCache.get(region.key);if(cached){buildings=cached.objects;Object.assign(canvas.dataset,cached.metrics);canvas.dataset.cityGeometryCacheHit='true';return;}const buildStarted=performance.now();canvas.dataset.cityGeometryCacheHit='false';
  const minX=region.cx-region.extent,maxX=region.cx+region.extent,minY=region.cy-region.extent,maxY=region.cy+region.extent,step=region.step;
  const hash=(x,y)=>{const v=Math.sin(x*127.1+y*311.7)*43758.5453;return v-Math.floor(v);};
  // Only real node plazas carve out empty space. No noise mask, random holes or invisible roads.
  buildings=[];let candidates=0,cleared=0,transitionCells=0,edgeMax=0,minHeight=Infinity,maxHeight=-Infinity;const masses=new Set();
  // Plazas remain generous, but adjacent plazas must not consume the entire district between them.
  world.forEach((n,i)=>{const nearest=Math.min(...world.filter((_,j)=>i!==j).map(b=>Math.hypot(n.x-b.x,n.y-b.y)));n.plazaRadius=Math.max(34,Math.min(58,nearest*.32));});
  for(let row=Math.floor(minY/(step*.866));row<=Math.ceil(maxY/(step*.866));row++)for(let col=Math.floor(minX/step);col<=Math.ceil(maxX/step);col++){
   const x=col*step+(row%2)*step/2,y=row*step*.866;candidates++;
   let grade=1,inside=false;
   for(const n of world){const dx=x-n.x,dy=y-n.y;if(Math.abs(dx)>130||Math.abs(dy)>130)continue;const angle=Math.atan2(dy,dx),radius=n.plazaRadius*(.55+.055*Math.sin(angle*3+n.x*.01)),distance=Math.hypot(dx,dy),band=n.plazaRadius*1.1+18;
    if(distance<radius){inside=true;break;}
    const t=Math.max(0,Math.min(1,(distance-radius)/band));grade=Math.min(grade,t*t*(3-2*t));
   }
   if(inside){cleared++;continue;}if(grade<1)transitionCells++;
   const districtX=Math.floor(x/150),districtY=Math.floor(y/150);
   // Continuous district relief plus small local irregularities: no rectangular height plateaus.
   const districtHeight=Math.max(8,21+6*Math.sin(x/97)+5*Math.cos(y/113)+4*Math.sin((x+y)/71)+(hash(col,row)-.5)*8*9/step);
   const massHeight=districtHeight*grade;if(grade<.03)edgeMax=Math.max(edgeMax,massHeight);
   minHeight=Math.min(minHeight,massHeight);maxHeight=Math.max(maxHeight,massHeight);masses.add(districtX+','+districtY);
   buildings.push({x,y,z:frame.elevation(x,y)-4,r:step/Math.sqrt(3)+.06,massHeight,detailHeight:(3+districtHeight*.6+Math.pow(hash(row,col+71),2)*24)*grade});
  }
  canvas.dataset.buildings=String(buildings.length);canvas.dataset.cityCandidates=String(candidates);canvas.dataset.cityClearedCells=String(cleared);canvas.dataset.cityMassCells=String(masses.size);canvas.dataset.cityStep=String(step);canvas.dataset.cityHeightMin=minHeight.toFixed(2);canvas.dataset.cityHeightMax=maxHeight.toFixed(2);canvas.dataset.nodePlazaRadius='adaptive';canvas.dataset.nodePlazaMin=Math.min(...world.map(n=>n.plazaRadius)).toFixed(2);canvas.dataset.nodePlazaMax=Math.max(...world.map(n=>n.plazaRadius)).toFixed(2);canvas.dataset.cityOccupancy='anchor-plazas-only';canvas.dataset.cityPlazaProfile='smoothstep-valley';canvas.dataset.cityTransitionCells=String(transitionCells);canvas.dataset.cityEdgeHeightMax=edgeMax.toFixed(3);
  canvas.dataset.cityBuildMs=(performance.now()-buildStarted).toFixed(1);
  const metrics={};for(const key of ['buildings','cityCandidates','cityClearedCells','cityMassCells','cityStep','cityHeightMin','cityHeightMax','nodePlazaRadius','nodePlazaMin','nodePlazaMax','cityOccupancy','cityPlazaProfile','cityTransitionCells','cityEdgeHeightMax','cityBuildMs'])metrics[key]=canvas.dataset[key];
  cityGeometryCache.set(region.key,{objects:buildings,metrics});if(cityGeometryCache.size>8)cityGeometryCache.delete(cityGeometryCache.keys().next().value);

 }
 function paintCity(frame){if(!frame.ctx||!buildings.length)return;
  const reveal=Math.max(0,Math.min(1,(frame.reveal-.2)/.8)),dark=document.documentElement.dataset.theme!=='light_endfield',project=frame.project,t=Math.max(0,Math.min(1,(frame.zoom-2.2)/1.25)),detail=t*t*(3-2*t);
  canvas.dataset.cityDetail=detail.toFixed(3);canvas.dataset.cityLod=detail===0?'masses':detail===1?'buildings':'transition';canvas.dataset.cityRenderer='opaque-single-mesh';
  const cameraKey=[frame.cameraX,frame.cameraY,frame.zoom,frame.yaw,frame.tilt].join('|'),now=performance.now();if(cameraKey!==lastCameraKey){lastCameraKey=cameraKey;cameraChangedAt=now;clearTimeout(qualityTimer);qualityTimer=setTimeout(()=>window.CFTEndfield?.redraw(),170);}
  // Keep labels and wires full resolution; temporarily reduce only city raster cost while the camera moves.
  const moving=now-cameraChangedAt<150,dpr=Math.min(devicePixelRatio||1,1.5)*(moving?.68:1);canvas.dataset.cityRasterQuality=moving?'motion':'full';
  const key=[cityRegionKey,frame.cameraX,frame.cameraY,frame.zoom,frame.yaw,frame.tilt,reveal,dark,dpr,bounds.left,bounds.top,bounds.width,bounds.height].join('|');
  const composite=()=>{frame.ctx.save();frame.ctx.globalAlpha=reveal;frame.ctx.drawImage(citySurface,0,0,frame.width,frame.height);frame.ctx.restore();};
  if(cityPaintKey===key){canvas.dataset.cityCacheHit='true';composite();return;}const started=performance.now();canvas.dataset.cityCacheHit='false';
  const w=Math.round(frame.width*dpr),h=Math.round(frame.height*dpr);if(citySurface.width!==w||citySurface.height!==h){citySurface.width=w;citySurface.height=h;}
  const ctx=cityContext;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.clearRect(0,0,frame.width,frame.height);
  ctx.save();const clipTop=bounds.top+(innerWidth<=800?76:40),clipHeight=Math.max(0,bounds.bottom-clipTop);ctx.beginPath();ctx.rect(bounds.left,clipTop,bounds.width,clipHeight);ctx.clip();
  const path=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();};
  const groundZ=buildings[0].z,groundCorners=[];
  for(const [sx,sy] of [[bounds.left-100,clipTop-130],[bounds.right+100,clipTop-130],[bounds.left-100,bounds.bottom+150],[bounds.right+100,bounds.bottom+150]]){
   let x=frame.cameraX,y=frame.cameraY;for(let k=0;k<7;k++){const p=project(x,y,groundZ),u=project(x+1,y,groundZ),v=project(x,y+1,groundZ),ux=u[0]-p[0],uy=u[1]-p[1],vx=v[0]-p[0],vy=v[1]-p[1],det=ux*vy-uy*vx;if(Math.abs(det)<.00001)break;const dx=sx-p[0],dy=sy-p[1];x+=(dx*vy-dy*vx)/det;y+=(dy*ux-dx*uy)/det;}groundCorners.push([x,y]);
  }
  const minX=Math.min(...groundCorners.map(p=>p[0]))-80,maxX=Math.max(...groundCorners.map(p=>p[0]))+80,minY=Math.min(...groundCorners.map(p=>p[1]))-80,maxY=Math.max(...groundCorners.map(p=>p[1]))+80,sorted=[];
  for(const b of buildings){if(b.x<minX||b.x>maxX||b.y<minY||b.y>maxY)continue;const p=project(b.x,b.y,b.z);if(p[0]>bounds.left-100&&p[0]<bounds.right+100&&p[1]>clipTop-130&&p[1]<bounds.bottom+150)sorted.push({b,p});}sorted.sort((a,b)=>a.p[1]-b.p[1]);canvas.dataset.cityVisibleCells=String(sorted.length);

  // One mesh morphs from joined roofs into separate towers. Never crossfade two overlapping cities.
  for(const {b} of sorted){const ground=[],top=[],radius=b.r*(1-detail*.12),height=b.massHeight+(b.detailHeight-b.massHeight)*detail;
   for(let j=0;j<6;j++){const angle=j*Math.PI/3+Math.PI/6;ground.push(project(b.x+Math.cos(angle)*radius,b.y+Math.sin(angle)*radius,b.z));top.push(project(b.x+Math.cos(angle)*radius,b.y+Math.sin(angle)*radius,b.z+height*reveal));}
   for(let j=0;j<6;j++){const k=(j+1)%6;if(top[k][0]-top[j][0]>0)continue;path([ground[j],ground[k],top[k],top[j]]);const shade=dark?91+j*6:159+j*5;ctx.fillStyle=`rgb(${shade},${shade+7},${shade+3})`;ctx.fill();}
   path(top);ctx.fillStyle=dark?'#aeb9af':'#d9e0d3';ctx.fill();
  }
  // Fade only the flattened scene boundary, after opaque depth occlusion has been resolved.
  ctx.globalCompositeOperation='destination-in';const vertical=ctx.createLinearGradient(0,clipTop,0,bounds.bottom);vertical.addColorStop(0,'transparent');vertical.addColorStop(Math.min(.2,35/Math.max(1,clipHeight)),'#000');vertical.addColorStop(.92,'#000');vertical.addColorStop(1,'transparent');ctx.fillStyle=vertical;ctx.fillRect(bounds.left,clipTop,bounds.width,clipHeight);
  ctx.restore();ctx.globalCompositeOperation='source-over';cityPaintKey=key;canvas.dataset.cityPaintMs=(performance.now()-started).toFixed(1);composite();
 }
 function focus(index){if(flat&&world[index]){flatView.cx=world[index].x+(flatOffsets.get(index)?.[0]||0);flatView.cy=world[index].y+(flatOffsets.get(index)?.[1]||0);graphFrameKey='';window.CFTEndfield?.redraw();return;}const e=elements[index];if(!e||!bounds)return;const x=Number(e.group.dataset.tipX),y=Number(e.group.dataset.tipY);if(!Number.isFinite(x+y))return;window.CFTEndfield?.moveWorkflow({dx:bounds.width/2-x,dy:Math.max(100,bounds.height/2)-y});}
 function promptIndex(kind){const text=kind==='positive'?(result.positive||result.pos_prompt):(result.negative||result.neg_prompt);return nodes.findIndex(n=>n._kind===kind||text&&(n.parameters||[]).some(p=>typeof p.value==='string'&&p.value.length>3&&text.includes(p.value)));}
 function paintTerrain(frame){if(!full||!result||!svg||q('#wfGraphSection').hidden)return;
  if(!bounds){bounds=viewport.getBoundingClientRect();}if(!bounds.width||!bounds.height)return;const key=[bounds.width,bounds.height,innerWidth].join(',');if(dirty||key!==layoutKey){layout(frame,bounds);layoutKey=key;svg.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);}
  const nextFrameKey=[frame.cameraX,frame.cameraY,frame.zoom,frame.yaw,frame.tilt,frame.reveal,flat,flatView.cx,flatView.cy,flatView.scale,flatRevision,bounds.left,bounds.top,bounds.width,bounds.height,selected,hovered].join('|');
  if(nextFrameKey===graphFrameKey){if(!flat)paintCity(frame);return;}graphFrameKey=nextFrameKey;
  const project=(x,y,z)=>{if(flat)return[bounds.width/2+(x-flatView.cx)*flatView.scale,bounds.height/2+(y-flatView.cy)*flatView.scale];const p=frame.project(x,y,z);return[p[0]-bounds.left,p[1]-bounds.top];},to=(p)=>p.map(v=>v.toFixed(2)).join(' '),points=world.map((n,i)=>{const offset=flat?(flatOffsets.get(i)||[0,0]):[0,0];return{base:project(n.x+offset[0],n.y+offset[1],n.z),top:project(n.x+offset[0],n.y+offset[1],n.z+n.h)};});
  svg.style.opacity=flat?'1':String(Math.max(0,Math.min(1,(frame.reveal-.2)/.7)));canvas.dataset.scale=(flat?flatView.scale/2:frame.zoom/2.2).toFixed(3);const percentage=Math.round((flat?flatView.scale/2:frame.zoom/2.2)*100)+'%';if(q('#wfGraphFit').textContent!==percentage)q('#wfGraphFit').textContent=percentage;
  if(!flat){if(cityRegion(frame).key!==cityRegionKey)buildCity(frame);paintCity(frame);}associations.forEach(a=>a.path.setAttribute('d',`M ${to(points[0].top)} L ${to(points[a.index].top)}`));
  if(plate&&world[0]){const n=world[0],tip=points[0].top,scale=Math.max(1,Math.min(2.2,frame.zoom*.8)),w=90*scale,h=110*scale;plate.face.setAttribute('transform',`translate(${tip[0]-w/2} ${tip[1]-h-24}) scale(${scale})`);plate.shadow.setAttribute('d','');plate.risers.setAttribute('d','');}

  edges.forEach((e,i)=>{const a=points[e.a].top,b=points[e.b].top,ax=flat?a[0]+(elements[e.a].nameWidth||130)+10:a[0],bx=flat?b[0]+10:b[0],bend=Math.max(45,Math.abs(bx-ax)*.45),d=flat?`M ${ax.toFixed(2)} ${a[1].toFixed(2)} C ${(ax+bend).toFixed(2)} ${a[1].toFixed(2)} ${(bx-bend).toFixed(2)} ${b[1].toFixed(2)} ${bx.toFixed(2)} ${b[1].toFixed(2)}`:`M ${to(a)} L ${to(b)}`;wires[i].setAttribute('d',d);wires[i].classList.toggle('related',e.a===(hovered>=0?hovered:selected)||e.b===(hovered>=0?hovered:selected));flowDots[i]?.classList.toggle('related',wires[i].classList.contains('related'));});
  const labelBoxes=[],order=elements.map((_,i)=>i).sort((a,b)=>((b===selected||b===hovered)?1:0)-((a===selected||a===hovered)?1:0));
  for(const i of order){const e=elements[i],n=world[i],p=points[i],d=`M ${to(p.base)} L ${to(p.top)}`;e.stem.setAttribute('d',d);e.hit.setAttribute('d',d);e.cap.setAttribute('x',p.top[0]-3);e.cap.setAttribute('y',p.top[1]-3);
   const title=String(nodes[i].title||nodes[i].type||'节点'),inspected=i===selected||i===hovered;
   if(e.titleValue!==title){const lines=[];let line='',width=0;for(const c of title){const w=c.codePointAt(0)>0x2e80?12:6.5;if(width+w>174&&line){lines.push(line);line='';width=0;}line+=c;width+=w;}if(line)lines.push(line);e.lines=lines;e.nameWidth=Math.min(188,Math.max(65,...lines.map(l=>[...l].reduce((a,c)=>a+(c.codePointAt(0)>0x2e80?12:6.5),0)+16)));e.titleValue=title;e.label.replaceChildren(...lines.map((line,j)=>el('tspan',{dy:j?15:0},line)));}
   const w=e.nameWidth,h=e.lines.length*15+18,leftLabel=!flat&&p.top[0]+w+16>bounds.width-(innerWidth>900?230:0),x=p.top[0]+(leftLabel?-w-10:10),y=p.top[1]-12,box={x,y,w,h};
   const blocked=!flat&&!inspected&&labelBoxes.some(b=>box.x<b.x+b.w+5&&box.x+box.w+5>b.x&&box.y<b.y+b.h+5&&box.y+box.h+5>b.y);
   for(const part of [e.label,e.back,e.texture,e.id])part.style.visibility=blocked?'hidden':'visible';if(!blocked)labelBoxes.push(box);
   if(flat){e.hit.setAttribute('d',`M ${x} ${y} h ${w} v ${h} h ${-w} Z`);e.hit.style.fill='transparent';}else e.hit.style.fill='none';
   e.back.setAttribute('x',x);e.back.setAttribute('y',y);e.back.setAttribute('width',w);e.back.setAttribute('height',h);for(const [key,value] of Object.entries({x,y,width:w,height:h}))e.texture.setAttribute(key,value);e.label.setAttribute('text-anchor','start');e.label.setAttribute('x',x+8);e.label.setAttribute('y',y+13);for(const line of e.label.children)line.setAttribute('x',x+8);e.id.setAttribute('text-anchor','start');e.id.setAttribute('x',x+8);e.id.setAttribute('y',y+h-5);
   // Deliberately screen-space: zoom, depth and node count never change the pad diameter.
   const ring=Array.from({length:33},(_,j)=>{const a=j/32*Math.PI*2;return(j?'L ':'M ')+to([p.base[0]+Math.cos(a)*9,p.base[1]+Math.sin(a)*4]);}).join(' ')+' Z';e.ring.setAttribute('d',ring);e.group.dataset.padWidth='18';e.group.dataset.padHeight='8';
   e.group.dataset.flatOffsetX=String(flatOffsets.get(i)?.[0]||0);e.group.dataset.flatOffsetY=String(flatOffsets.get(i)?.[1]||0);e.group.dataset.layoutAdjustment=(n.adjustment||0).toFixed(2);e.group.dataset.worldX=n.x.toFixed(4);e.group.dataset.worldY=n.y.toFixed(4);e.group.dataset.originalX=String(nodes[i].position?.[0]??'');e.group.dataset.originalY=String(nodes[i].position?.[1]??'');e.group.dataset.tipX=p.top[0].toFixed(2);e.group.dataset.tipY=p.top[1].toFixed(2);
  }
  const view=q('#wfGraphOrientation');if(view){const text=Math.round(frame.yaw||0)+'° / '+Math.round(frame.tilt||51)+'°';if(view.textContent!==text)view.textContent=text;}

  if(pendingFocus&&frame.reveal>=1){pendingFocus=false;if(nodes.length>12)focus(selected);}

 }
 function setFlat(value){endDrag();flat=!!value;if(flat&&!flatView.ready&&world.length){const n=world[selected]||world[0];flatView={cx:n.x,cy:n.y,scale:2,ready:true};}canvas.dataset.projection=flat?'2d':'3d';svg?.classList.toggle('wf-flat-scene',flat);q('.wf-atlas-stage')?.classList.toggle('wf-is-flat',flat);const label=q('#wfProjectionToggle .wf-projection-caption');if(label)label.textContent=flat?'回到 3D 沙盘':'回到 2D 视图';q('#wfProjectionToggle')?.setAttribute('aria-pressed',String(flat));for(const id of ['wfRotateLeft','wfRotateRight','wfTiltUp','wfTiltDown'])if(q('#'+id))q('#'+id).disabled=flat;setLeftAction(leftAction);graphFrameKey='';window.dispatchEvent(new CustomEvent('cft:workflow-view',{detail:{active:full&&!!result&&!flat}}));window.CFTEndfield?.redraw();}
 function setLeftAction(value){if(['pan','rotate','select'].includes(value))leftAction=value;endDrag();canvas.dataset.leftAction=leftAction;viewport.dataset.leftAction=leftAction;for(const [id,action] of [['wfActionPan','pan'],['wfActionRotate','rotate'],['wfActionSelect','select']]){const b=q('#'+id);if(b){b.setAttribute('aria-pressed',String(leftAction===action));b.disabled=flat&&action==='rotate';}}viewport.title=flat?'拖动卡片可调整节点位置（仅当前会话，不写回图片）；空白处拖动平移；滚轮缩放':'左键默认'+({pan:'拖动',rotate:'旋转',select:'选择'}[leftAction])+'；空格 + 左键旋转镜头；滚轮缩放';}
 function syncFlow(){if(!svg)return;const pause=document.hidden||!full||!q('#page-workflow').classList.contains('active')||matchMedia('(prefers-reduced-motion:reduce)').matches||document.documentElement.dataset.efMotion==='false';pause?svg.pauseAnimations():svg.unpauseAnimations();}
 document.addEventListener('visibilitychange',syncFlow);window.addEventListener('cft:page-changed',syncFlow);window.addEventListener('cft:config-saved',syncFlow);matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change',syncFlow);
 new ResizeObserver(invalidate).observe(viewport);document.addEventListener('scroll',()=>{bounds=null;window.CFTEndfield?.redraw();},true);window.addEventListener('resize',invalidate);
 mode(full);return{render,mode,fit,highlight,focus,setFlat,isFlat:()=>flat,setLeftAction,getLeftAction:()=>leftAction,rotate:(yaw,tilt=0)=>{if(!flat)window.CFTEndfield?.moveWorkflow({rotate:yaw,tilt});},paintTerrain,refresh:invalidate,isFull:()=>full};
})();
