/* Local-only preview: serves production UI with synthetic API. Never loads user config. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web');
const source=fs.readFileSync(path.join(root,'tests/test_ui_preferences.cjs'),'utf8').replace(/\r\n/g,'\n');
const begin=source.indexOf('await page.addInitScript(')+'await page.addInitScript('.length,end=source.indexOf('\n    });\n    const url',begin)+6;
const fixture='('+source.slice(begin,end)+')();';
const demoCover=fs.readFileSync(path.join(web,'about-character-v1.png')).toString('base64');
const realWorkflow=process.env.CFT_WORKFLOW_FIXTURE?JSON.parse(fs.readFileSync(process.env.CFT_WORKFLOW_FIXTURE,'utf8')):null;
const boot=fixture+`
Object.assign(window.fixtureCfg,{performance_prompt_version:new URL(location.href).searchParams.has('performance')&&!localStorage.getItem('cft-test-config')?0:(fixtureCfg.performance_prompt_version||1),ui_animations:true,terrain_pixel_ratio:1.5,performance_profile:'custom',theme:window.fixtureCfg.theme||'dark_endfield',default_page:'settings',endfield_parallax:true,download_hud_scale:'100',download_hud_dock:true,download_hud_motion:true,ui_zoom:100,api_key:'',window_appearance:'theme',masonry_card_width:220});
window.fixtureTasks=[];window.fixtureScanRows=[];
const transferPreview=new URL(location.href).searchParams.get('transfer');
const modelPreview=new URL(location.href).searchParams.get('models');
const updatesPreview=new URL(location.href).searchParams.has('updates');
const reversePreview=new URL(location.href).searchParams.has('reverse');
const workflowPreview=new URL(location.href).searchParams.get('workflow');
if(modelPreview){
 fixtureCfg.default_view=modelPreview==='grid'?'grid':'waterfall';if(fixtureCfg.model_toolbar_locked===undefined)fixtureCfg.model_toolbar_locked=true;
 const names=['山川水彩','银色回响','角色光影','工业空间','星夜旅途','晴空映像','像素材质','场景构图','霓虹街景','自然光影','梦境花园','机械设计','纸上风景','柔和人像','深海回声','晨光森林','城市速写','云间漫游'];
 window.fixtureScanRows=names.map((name,i)=>({path:'D:/Demo/Models/'+['checkpoints','loras','vae','controlnet','embeddings'][i%5]+'/'+name+'.safetensors',name:name+'.safetensors',civitai_name:name,type:['Checkpoint','LORA','VAE','Controlnet','TextualInversion'][i%5],type_filter:['Checkpoint','LORA','VAE','Controlnet','TextualInversion'][i%5],base:['MOSS','Krea2','Anima','SDXL','FLUX.1'][i%5],ver:'v1.'+(i%3),author:'示例作者',size:(128+i*67)*1048576,mtime:1792800000+i*100}));
 fixtureCfg.model_favorites=fixtureScanRows.slice(0,2).map(r=>r.path);
 fixtureCfg.model_card_styles=fixtureCfg.model_card_styles||{'base:moss':{glow:'gold',frames:['icon_user_avatar_frame_endfield_2']},'base:krea2':{glow:'cyan',frames:['icon_user_avatar_frame_activity_9']},'base:anima':{glow:'violet',frames:['icon_user_avatar_frame_bp_1_2']}};
}

if(transferPreview){
 fixtureCfg.api_key='isolated-preview-only';
 const names=['工业空间','角色光影','像素材质','场景构图'],batchAt=Date.UTC(2026,9,24,2,10)/1000;
 window.fixtureTasks=names.map((name,i)=>({id:'transfer-demo-'+i,filename:name+'.safetensors',status:['downloading','pending','retrying','paused'][i],dest_dir:'D:/Demo/Models/Collection',total:2147483648,downloaded:i===1?0:841813590,progress:i===1?0:39.2,speed:i===0?12834567:0,batch_id:'demo-20261024-a',batch_started_at:batchAt,created_at:batchAt}));
 window.transferDemoCover=${JSON.stringify(demoCover)};
 window.fixtureHistory=Array.from({length:4},(_,i)=>({id:'history-demo-'+i,filename:names[i]+'.safetensors',status:'done',dest_dir:'D:/Demo/Models/Collection',total:2147483648,downloaded:2147483648,modelName:names[i],file_exists:true,cached_thumb:true,batch_id:i<2?'demo-20261024-older':i===2?'demo-20261024-other':'demo-20261023-older',batch_started_at:i<2?batchAt-7200:i===2?batchAt-3600:batchAt-86400,finished_at:batchAt-600-i*120}));
 window.fixtureHistoryThumbs=Object.fromEntries(fixtureHistory.map(t=>[t.id,transferDemoCover]));
}

if(updatesPreview){
 fixtureCfg.api_key='isolated-preview-only';
 const names=['山川水彩','银色回响','工业空间','柔和人像','梦境花园','机械设计'],at=Date.UTC(2026,9,25,2,20)/1000;
 const items={};window.fixtureScanRows=names.map((name,i)=>{const path='D:/Demo/Models/'+name+'.safetensors';items[path]={model_id:String(100+i),model_name:name,author:'示例作者',local_name:'v1.0',local_base:['MOSS','Krea2','Anima'][i%3],model_type:i%2?'LORA':'Checkpoint',local_version:'10',checked_at:at,has_update:i%3===0,other_base:i===2,unknown:i===4,latest_version:String(200+i),latest_name:'v2.0',latest_date:'2026-10-24',url:'https://civitai.red/models/'+(100+i),ver_list:[{id:'10',name:'v1.0',date:'2026-10-01',current:true},{id:String(200+i),name:'v2.0',date:'2026-10-24',current:false}]};return {path,name:name+'.safetensors',civitai_name:name,modelId:100+i,verId:10,base:items[path].local_base,type:items[path].model_type};});
 for(const item of Object.values(items))if(!item.has_update&&!item.unknown)item.ver_list=[{id:'10',name:'v1.0',date:'2026-10-01',current:true},{id:'9',name:'v0.9',date:'2026-09-20',current:false}];
 const clone=v=>JSON.parse(JSON.stringify(v));
 window.fixtureUpdatePayload={items,checked_at:at,batches:[{id:'check-today',started_at:at,finished_at:at+30,total:6,done:6,newer:2,scope:'all',status:'complete',items:clone(items)},{id:'check-earlier',started_at:at-4200,finished_at:at-4170,total:3,done:3,newer:1,scope:'selected',status:'complete',items:Object.fromEntries(Object.entries(clone(items)).slice(0,3))},{id:'check-yesterday',started_at:at-86400,finished_at:at-86350,total:6,done:4,newer:1,scope:'all',status:'stopped',items:Object.fromEntries(Object.entries(clone(items)).slice(2))}]};
 window.fixtureUpdateProgress={running:false};window.fixtureUpdateSerial=0;window.fixtureUpdateWhitelist=[{model_id:'999',name:'白名单示例模型'}];
}
if(reversePreview){
 fixtureCfg.api_key='isolated-preview-only';
 const names=['山川水彩','银色回响','旧版场景','工业空间','柔和人像','星夜旅途'];
 window.fixtureScanRows=names.map((name,i)=>({path:'D:/Demo/Models/'+name+'.safetensors',name:name+'.safetensors',civitai_name:i===0||i===4?name:'',base:['MOSS','Krea2','Anima'][i%3],type:i%2?'LORA':'Checkpoint',ver:'v1.2',author:'示例作者',size:(200+i*300)*1048576,modelId:i===0||i===4?200+i:''}));
 window.fixtureReverseRows=fixtureScanRows.map((r,i)=>({path:r.path,status:['成功','待反查','未收录','失败','成功','已暂停'][i],model:i===0||i===4?names[i]:i===2?'C站暂未收录此哈希':i===3?'隔离示例：网络请求超时':'',version:i===0||i===4?'v1.2':'',sha:i===1?'':'3a1459bbd2004f82…'}));
 window.fixtureReverseProgress={running:false,paused:false,total:0,done:0};window.fixtureReverseDetailDelay={};
}
if(workflowPreview){
 window.fixtureWorkflow={ok:true,file:'terrain-workflow.png',source:'comfyui',has_workflow:true,node_count:6,
 nodes:[{id:1,type:'CheckpointLoaderSimple',title:'加载模型',position:[0,80],inputs:[],outputs:[{name:'MODEL',type:'MODEL'},{name:'CLIP',type:'CLIP'},{name:'VAE',type:'VAE'}],parameters:[{name:'ckpt_name',value:'mountain.safetensors'}]},
 {id:2,type:'CLIPTextEncode',title:'正面提示词',position:[330,0],inputs:[{name:'clip',source:1,slot:1,type:'CLIP'}],outputs:[{name:'CONDITIONING',type:'CONDITIONING'}],parameters:[{name:'text',value:'watercolor landscape, mountain lake, soft morning light'}]},
 {id:3,type:'CLIPTextEncode',title:'负面提示词',position:[330,250],inputs:[{name:'clip',source:1,slot:1,type:'CLIP'}],outputs:[{name:'CONDITIONING',type:'CONDITIONING'}],parameters:[{name:'text',value:'blurry, watermark, low quality'}]},
 {id:4,type:'KSampler',title:'采样器',position:[670,100],inputs:[{name:'model',source:1,slot:0,type:'MODEL'},{name:'positive',source:2,slot:0,type:'CONDITIONING'},{name:'negative',source:3,slot:0,type:'CONDITIONING'}],outputs:[{name:'LATENT',type:'LATENT'}],parameters:[{name:'steps',value:24},{name:'cfg',value:7},{name:'seed',value:123456}]},
 {id:5,type:'VAEDecode',title:'图像解码',position:[1010,100],inputs:[{name:'samples',source:4,slot:0,type:'LATENT'},{name:'vae',source:1,slot:2,type:'VAE'}],outputs:[{name:'IMAGE',type:'IMAGE'}]},
 {id:6,type:'SaveImage',title:'保存图像',position:[1350,100],inputs:[{name:'images',source:5,slot:0,type:'IMAGE'}],outputs:[]}],
 edges:[{source:1,target:2,input:'clip',slot:1},{source:1,target:3,input:'clip',slot:1},{source:1,target:4,input:'model',slot:0},{source:2,target:4,input:'positive',slot:0},{source:3,target:4,input:'negative',slot:0},{source:4,target:5,input:'samples',slot:0},{source:1,target:5,input:'vae',slot:2},{source:5,target:6,input:'images',slot:0}],
 models:['mountain.safetensors','watercolor.safetensors'],pos_prompt:'watercolor landscape, mountain lake, soft morning light, delicate brushwork',neg_prompt:'blurry, watermark, low quality'};
 if(workflowPreview==='forge')Object.assign(fixtureWorkflow,{source:'forge',has_workflow:false,nodes:[],edges:[],node_count:0,generation_parameters:{Steps:24,Sampler:'Euler',Seed:123456,'CFG scale':7,Size:'768x1024'}});
 if(workflowPreview==='image')Object.assign(fixtureWorkflow,{source:'image',has_workflow:false,nodes:[],edges:[],models:[],node_count:0,pos_prompt:'',neg_prompt:'',generation_parameters:{'宽度':768,'高度':1024,'格式':'PNG'},prompt_notes:'图片未记录工作流或生成参数，仅显示真实图片信息，不推测节点与连线。'});
}
const native=window.pywebview.api;
window.pywebview.api=new Proxy({}, {get:(_,method)=>async(...args)=>{
 if(workflowPreview&&['analyze_workflow','wf_analyze_data'].includes(method))return JSON.stringify(fixtureWorkflow);
 if(workflowPreview&&method==='pick_file')return 'D:/IsolatedPreview/terrain-workflow.png';
 if(workflowPreview==='real'&&method==='workflow_model_matches')throw new Error('真实图片预览未扫描本地模型，匹配状态未知');
 if(workflowPreview&&method==='workflow_model_matches')return JSON.stringify((args[0]||[]).map((ref,i)=>({ref,local:i===0,path:i===0?'D:/Demo/Models/'+ref:'',sha256:i===0?'a1b2c3d4':''})));
 if(reversePreview&&['rp_get_rows','rp_state','rp_start','rp_pause','rp_stop','rp_clear','rp_remove_selected','get_model_detail','get_covers'].includes(method))fixtureCalls.push({method,args});
 if(reversePreview&&method==='rp_get_rows')return fixtureReverseRows;
 if(reversePreview&&method==='rp_state'){
  const p=fixtureReverseProgress;if(p.running&&!p.paused){const r=fixtureReverseRows.find(r=>p.paths.includes(r.path)&&r.status==='反查中');if(r){r.status='成功';r.model=fixtureScanRows.find(m=>m.path===r.path)?.name.replace('.safetensors','')||'示例模型';r.version='v1.2';r.sha='3a1459bbd2004f82…';p.done++;}const next=fixtureReverseRows.find(r=>p.paths.includes(r.path)&&r.status==='等待开始');if(next)next.status='反查中';else p.running=false;}return {...p};
 }
 if(reversePreview&&method==='rp_start'){if(fixtureReverseProgress.running)return false;const paths=(args[0]||fixtureReverseRows.map(r=>r.path)).filter(path=>fixtureReverseRows.some(r=>r.path===path&&(!args[1]||/失败|错误|未收录|文件不存在/.test(r.status))));if(!paths.length)return false;fixtureReverseProgress={running:true,paused:false,done:0,total:paths.length,paths};fixtureReverseRows.filter(r=>paths.includes(r.path)).forEach((r,i)=>r.status=i===0?'反查中':'等待开始');return true;}
 if(reversePreview&&method==='rp_pause'){fixtureReverseProgress.paused=!fixtureReverseProgress.paused;return fixtureReverseProgress.paused;}
 if(reversePreview&&method==='rp_stop'){fixtureReverseProgress.running=false;fixtureReverseRows.filter(r=>r.status==='反查中'||r.status==='等待开始').forEach(r=>r.status='已取消');return true;}
 if(reversePreview&&method==='rp_clear'){if(fixtureReverseProgress.running)return false;fixtureReverseRows=[];return true;}
 if(reversePreview&&method==='rp_remove_selected'){fixtureReverseRows=fixtureReverseRows.filter(r=>!(args[0]||[]).includes(r.path)||fixtureReverseProgress.running&&fixtureReverseProgress.paths.includes(r.path));return {ok:true,msg:'隔离预览：只移除示例记录'};}
 if(reversePreview&&method==='get_model_detail'){
  const path=args[0],r=fixtureScanRows.find(r=>r.path===path),row=fixtureReverseRows.find(r=>r.path===path);if(fixtureReverseDetailDelay[path])await new Promise(resolve=>setTimeout(resolve,fixtureReverseDetailDelay[path]));
  if(r)return JSON.stringify({ok:true,...r,covers:row?.status==='成功'?[{b64:${JSON.stringify(demoCover)}}]:[],info:row?.status==='成功'?{modelId:r.modelId,name:row.model,type:r.type,baseModel:r.base,creator:{username:r.author},version:{name:row.version},trainedWords:['soft light','watercolor'],description:'隔离预览模型档案。\\n按 SHA256 反查本地文件，保留原始触发词与版本信息。\\n此处不包含真实模型，也不会发起在线查询。'}:{}});
 }
 if(reversePreview&&method==='get_covers')return JSON.stringify(Object.fromEntries((args[0]||[]).map(path=>[path,${JSON.stringify(demoCover)}])));
 if(updatesPreview&&['clear_model_update_results','sync_local_model_updates','get_update_whitelist','add_update_whitelist','remove_update_whitelist','save_update_whitelist','mm_download_version'].includes(method)){
  fixtureCalls.push({method,args});
  if(method==='clear_model_update_results'){fixtureUpdatePayload={items:{},batches:[],checked_at:0};fixtureUpdateProgress={running:false};return {ok:true,msg:'隔离预览：已清空示例检查记录'};}
  if(method==='sync_local_model_updates')return {ok:true,removed:0,msg:'隔离预览：已同步示例记录，未扫描本机目录'};
  if(method==='get_update_whitelist')return {items:JSON.parse(JSON.stringify(fixtureUpdateWhitelist))};
  if(method==='add_update_whitelist'){fixtureUpdateWhitelist.push({model_id:args[0],name:args[1]});for(const [path,item] of Object.entries(fixtureUpdatePayload.items))if(String(item.model_id)===String(args[0]))delete fixtureUpdatePayload.items[path];return {ok:true,msg:'已加入示例白名单（不写真实配置）'};}
  if(method==='remove_update_whitelist'){if(window.fixtureWhitelistFail)return {ok:false,msg:'隔离示例：模拟保存失败，记录保留'};window.fixtureUpdateWhitelist=fixtureUpdateWhitelist.filter(item=>String(item.model_id)!==String(args[0]));return {ok:true,msg:'已移出示例白名单'};}
  if(method==='save_update_whitelist'){
   if(window.fixtureWhitelistFail)return {ok:false,msg:'隔离示例：模拟保存失败，原白名单保留'};
   const expected=new Set(args[1]||[]),current=new Set(fixtureUpdateWhitelist.map(i=>String(i.model_id)));if(expected.size!==current.size||[...expected].some(id=>!current.has(id)))return {ok:false,msg:'白名单已在其他窗口改变'};
   window.fixtureUpdateWhitelist=JSON.parse(JSON.stringify(args[0]));const selected=new Set(fixtureUpdateWhitelist.map(i=>String(i.model_id)));fixtureUpdatePayload.items=Object.fromEntries(Object.entries(fixtureUpdatePayload.items).filter(([path,item])=>!selected.has(String(item.model_id))));return {ok:true,count:selected.size,msg:'示例白名单已保存（不写真实配置）'};
  }
  const path=args[0],vid=args[1],id='preview-update-'+encodeURIComponent(path)+'-'+vid;if(!fixtureTasks.some(t=>t.id===id))fixtureTasks.push({id,filename:path.split('/').pop(),dest_dir:'D:/Demo/Models',status:'pending',progress:0,downloaded:0,total:0});return {ok:true,msg:'已加入隔离示例队列，未执行真实下载'};
 }
 if(updatesPreview&&method==='get_model_updates')return fixtureUpdatePayload;
 if(updatesPreview&&method==='get_covers')return JSON.stringify(Object.fromEntries((args[0]||[]).map(path=>[path,${JSON.stringify(demoCover)}])));
 if(updatesPreview&&method==='mm_check_updates'){
  const paths=args[1]?.length?args[1]:Object.keys(fixtureUpdatePayload.items);window.fixtureUpdateProgress={running:true,total:paths.length,done:0,newer:0,items:{},paths,checked_at:Date.now()/1000,batch_id:'demo-check-'+(++fixtureUpdateSerial),scope:args[1]?.length?'selected':'all'};return {started:true,...fixtureUpdateProgress};
 }
 if(updatesPreview&&method==='cancel_mm_op'){fixtureUpdateProgress.running=false;fixtureUpdateProgress.cancelled=true;return {ok:true,msg:'隔离预览：停止示例检查'};}
 if(updatesPreview&&method==='get_mm_update_state'){
  const p=fixtureUpdateProgress;if(p.running){p.done=Math.min(p.total,p.done+1);const path=p.paths[p.done-1];p.items[path]={...fixtureUpdatePayload.items[path],checked_at:p.checked_at};p.newer=Object.values(p.items).filter(i=>i.has_update).length;if(p.done===p.total)p.running=false;}
  if(p.batch_id&&!p.running&&!p.recorded){p.recorded=true;fixtureUpdatePayload.items={...fixtureUpdatePayload.items,...p.items};fixtureUpdatePayload.batches.unshift({id:p.batch_id,started_at:p.checked_at,finished_at:Date.now()/1000,total:p.total,done:p.done,newer:p.newer,scope:p.scope,status:p.cancelled?'stopped':'complete',items:JSON.parse(JSON.stringify(p.items))});fixtureUpdatePayload.batches=fixtureUpdatePayload.batches.slice(0,20);fixtureUpdatePayload.checked_at=p.checked_at;}
  return JSON.parse(JSON.stringify(p));
 }
 if(method==='archive_download_task'){
  window.fixtureCalls.push({method,args});const t=fixtureTasks.find(t=>t.id===args[0]);if(!t)return {ok:false,msg:'任务不存在'};
  if(!['done','error','canceled'].includes(t.status))return {ok:false,msg:'任务未结束'};
  if(!fixtureHistory.some(h=>h.id===t.id))fixtureHistory.unshift({...t,file_exists:true,cached_thumb:!!window.transferDemoCover});
  if(window.transferDemoCover){window.fixtureHistoryThumbs=window.fixtureHistoryThumbs||{};fixtureHistoryThumbs[t.id]=transferDemoCover;}
  window.fixtureTasks=fixtureTasks.filter(t=>t.id!==args[0]);return {ok:true,msg:'隔离示例：已归档'};
 }
 if(modelPreview&&method==='get_model_detail'){
  const r=fixtureScanRows.find(r=>r.path===args[0]);if(r)return JSON.stringify({ok:true,...r,covers:(window.fixtureModelGallery||[${JSON.stringify(demoCover)}]).map((b64,i)=>({b64,local:i===0})),info:{name:r.civitai_name,type:r.type,baseModel:r.base,version:{name:r.ver},creator:{username:r.author},trainedWords:['soft light'],description:'隔离预览示例，不包含真实模型。'}});
 }
 if(modelPreview&&method==='get_gallery_image'){
  const b64=window.fixtureModelGallery?.[Number(args[1])||0];if(!b64)return {ok:false,msg:'示例图片不存在'};
  const image=new Image();image.src='data:image/png;base64,'+b64;await image.decode();return {ok:true,b64,mime:'image/png',width:image.naturalWidth,height:image.naturalHeight,original_available:true,metadata_source:'隔离预览示例，不包含真实生成数据'};
 }
 if(method==='get_local_fonts'){const r=await fetch('/__preview/windows-fonts.json');if(r.ok){const fonts=await r.json();return {ok:true,fonts};}}
 if(['open_url','open_folder','open_logs','open_in_browser','window_control','set_window_appearance','open_folder_location'].includes(method))return {ok:false,msg:'隔离预览：不执行本机操作'};
 return native[method](...args);
}});
window.open=()=>null;
// The shared UI fixture suppresses dirty prompts for its broad preference tests.
// This preview must exercise the real pending-settings state, including the notice.
window.addEventListener('load',()=>{if(typeof window.fixtureRealSettingsChanges==='function')window.settingsHaveChanges=window.fixtureRealSettingsChanges;window.CFTEndfieldUnsaved?.refresh();});
const previewReady=setInterval(()=>{if(!window.__ready||!state.cfg||!document.querySelector('.ef-transfer-head')||(updatesPreview&&!document.querySelector('.ef-update-tools')))return;clearInterval(previewReady);document.querySelector('#obMask').style.display='none';setOnboardingBackground(false);state.cfg.theme=fixtureCfg.theme;document.documentElement.dataset.theme=fixtureCfg.theme;applyUiAppearance();buildSettingsForm();switchPage('settings');showSettingsCategory('appearance');if(workflowPreview){const image=document.createElement('canvas');image.width=360;image.height=460;const context=image.getContext('2d');context.fillStyle='#a6b5a6';context.fillRect(0,0,360,460);context.fillStyle='#f0eccf';context.beginPath();context.arc(110,100,60,0,Math.PI*2);context.fill();context.fillStyle='#314b4c';context.beginPath();context.moveTo(0,460);context.lineTo(0,270);context.lineTo(140,170);context.lineTo(360,360);context.lineTo(360,460);context.fill();context.fillStyle='#1b3436';context.beginPath();context.moveTo(0,460);context.lineTo(0,400);context.lineTo(260,290);context.lineTo(360,350);context.lineTo(360,460);context.fill();fixtureWorkflow.preview_b64=image.toDataURL('image/jpeg').split(',')[1];if(workflowPreview==='real'&&${JSON.stringify(!!realWorkflow)})window.fixtureWorkflow=${JSON.stringify(realWorkflow).replace(/</g,'\u003c')};switchPage('workflow');CftWorkflowGraph.mode(true);wfRenderResult(fixtureWorkflow);wfSetStatus(workflowPreview==='real'?'真实图片解析预览 · 不执行工作流；本地模型匹配未执行':'隔离预览 · 合成节点示例，不执行工作流','done');}else if(reversePreview){state.models=fixtureScanRows;switchPage('reverse');rpRefresh();const flag=document.createElement('small');flag.className='rp-preview-note';flag.textContent='隔离预览 · 示例反查，不读取真实模型';document.querySelector('#page-reverse .title-row').append(flag);}else if(updatesPreview){state.models=fixtureScanRows;applyUpdatePayload(fixtureUpdatePayload);switchPage('updates');renderUpdatesPage();const note=document.createElement('small');note.className='ef-update-preview-note';note.textContent='隔离预览 · 示例批次，非真实检查';document.querySelector('.ef-update-tools').append(note);}else if(modelPreview){
 state.models=fixtureScanRows;state.mmChecked.clear();
 window.fixtureModelGallery=[${JSON.stringify(demoCover)}];for(let i=0;i<2;i++){const c=document.createElement('canvas');c.width=300;c.height=380;const g=c.getContext('2d');g.fillStyle=i?'#7d8ba6':'#a6b5a6';g.fillRect(0,0,300,380);g.fillStyle='#f0eccf';g.beginPath();g.arc(90+i*90,100,55,0,Math.PI*2);g.fill();g.fillStyle='#314b4c';g.beginPath();g.moveTo(0,380);g.lineTo(0,240);g.lineTo(100,150);g.lineTo(240,300);g.lineTo(300,190);g.lineTo(300,380);g.fill();fixtureModelGallery.push(c.toDataURL('image/png').split(',')[1]);}
 const hues=['#9caeaa','#607f83','#9c8eac','#b0ac88','#94a5b7','#b4a39c'];
 fixtureScanRows.forEach((r,i)=>{const w=360,h=[460,340,510,320,400][i%5];const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><rect width="100%" height="100%" fill="'+hues[i%6]+'"/><circle cx="'+(80+i%3*70)+'" cy="95" r="58" fill="#f4f2db" opacity=".8"/><path d="M0 '+h+'V'+(h*.62)+'L110 '+(h*.32)+'L230 '+(h*.71)+'L360 '+(h*.44)+'V'+h+'Z" fill="#30494b"/><path d="M0 '+h+'V'+(h*.86)+'L160 '+(h*.64)+'L360 '+(h*.88)+'V'+h+'Z" fill="#182e32"/><text x="22" y="'+(h-30)+'" fill="#ffffff66" font-family="sans-serif" font-size="12">CFT / ISOLATED PREVIEW '+String(i+1).padStart(2,'0')+'</text></svg>';state.coverCache.set(r.path,i%6===2?'data:image/png;base64,'+${JSON.stringify(demoCover)}:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg));});
 state.mmView=modelPreview==='grid'?'grid':'masonry';switchPage('models');applyMmFilter();syncViewSeg();document.getElementById('mmCount').textContent=fixtureScanRows.length+' 个 · 隔离示例';
 }else if(transferPreview){
 for(const t of fixtureTasks)state.dlThumbs[t.id]=transferDemoCover;
 switchPage(transferPreview==='add'?'download':'dlmanager');dlRefresh();
 }const note=document.createElement('span');note.className='ef-preview-note';note.textContent='隔离预览 · 不写入软件配置';document.getElementById('settingsActions').prepend(note);if(transferPreview){const flag=note.cloneNode(true);flag.className='ef-transfer-preview-flag';flag.textContent='隔离预览 · 示例任务，非真实下载';document.querySelector('.page.active .ef-transfer-head').append(flag);
 const demo=document.createElement('button');demo.id='previewComplete';demo.className='btn btn-tiny ef-transfer-demo-control';demo.textContent='演示完成动画';demo.addEventListener('click',()=>{const t=fixtureTasks.find(t=>t.status==='downloading');if(!t)return;t.status='done';t.progress=100;t.downloaded=t.total;t.speed=0;t.finished_at=Date.UTC(2026,9,24,3,0)/1000;dlRefresh();});const tools=document.querySelector('#dlQueueUtilities .ef-transfer-actions-main');tools.append(demo);
 const progress=document.createElement('button');progress.id='previewProgress';progress.className='btn btn-tiny ef-transfer-demo-control';progress.textContent='演示 0 → 100%';progress.addEventListener('click',()=>{let task=fixtureTasks.find(t=>t.id==='progress-demo');if(!task){task={...fixtureTasks[0],id:'progress-demo',filename:'进度演示.safetensors'};fixtureTasks.unshift(task);state.dlThumbs[task.id]=transferDemoCover;}task.status='downloading';task.progress=0;task.downloaded=0;task.total=2147483648;task.speed=12834567;clearInterval(window.previewProgressTimer);clearTimeout(window.previewProgressStart);dlRefresh();window.previewProgressStart=setTimeout(()=>{window.previewProgressTimer=setInterval(()=>{if(!fixtureTasks.includes(task)){clearInterval(window.previewProgressTimer);return;}task.progress=Math.min(100,task.progress+2);task.downloaded=task.total*task.progress/100;if(task.progress===100){clearInterval(window.previewProgressTimer);task.status='done';task.speed=0;task.finished_at=Date.now()/1000;}dlRefresh();},160);},500);});tools.append(progress);}},50);
`;
const extra=`<style>@font-face{font-family:GamePreviewCN;src:url('/__preview/font-cn.ttf');font-weight:500;font-display:swap}@font-face{font-family:GamePreviewDisplay;src:url('/__preview/font-display.ttf');font-weight:700;font-display:swap}:root{--font:GamePreviewCN,"HarmonyOS Sans SC",sans-serif;--ef-settings-font:GamePreviewCN,'HarmonyOS Sans SC',sans-serif;--ef-settings-display:GamePreviewDisplay,sans-serif}.ef-transfer-preview-flag{position:absolute;right:14px;top:48px;color:var(--text-dim);font-size:9px;max-width:42%;text-align:right}.ef-transfer-demo-control{font-size:10px}.ef-preview-note{margin-right:auto;align-self:center;font-size:10px;color:var(--text-dim)}@font-face{font-family:GamePreviewCode;src:url('/__preview/font-code.ttf')}#page-settings input,#page-settings button,#page-settings textarea{font-family:var(--font)!important}#settingsForm input[type=number],#settingsForm output{font-family:var(--font)!important}#settingsForm input[readonly],#organizeRules{font-family:var(--ef-custom-fonts,GamePreviewCode),var(--font)!important}</style>`;
const fontDir=path.join(root,'.test_tmp/endfield-settings-preview/game-fonts');
const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"connect-src 'self'; object-src 'none'; base-uri 'self'");
 let url;try{url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{return res.writeHead(400).end();}
 if(req.method!=='GET')return res.writeHead(405).end();
 if(url==='/__preview/boot.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(boot);}
 if(url==='/__preview/windows-fonts.json'){const f=path.join(root,'.test_tmp/endfield-settings-preview/windows-fonts.json');if(!fs.existsSync(f))return res.writeHead(404).end();res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(fs.readFileSync(f));}
 const fontMap={'/__preview/font-cn.ttf':'395.ttf','/__preview/font-display.ttf':'396.ttf','/__preview/font-code.ttf':'398.ttf'};
 const file=fontMap[url]?path.join(fontDir,fontMap[url]):path.resolve(web,'.'+(url==='/'?'/index.html':url));
 if(!fontMap[url]&&!file.startsWith(web+path.sep))return res.writeHead(403).end();
 fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();const ext=path.extname(file);res.setHeader('Content-Type',({'.js':'text/javascript; charset=utf-8','.css':'text/css','.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'})[ext]||'application/octet-stream');if(ext==='.html')data=data.toString('utf8').replace('<head>','<head><script src="/__preview/boot.js"></script>').replace('</head>',extra+'</head>');res.end(data);});
});
if(require.main===module)server.listen(Number(process.argv[2])||65051,'127.0.0.1',()=>console.log('PREVIEW http://127.0.0.1:'+server.address().port));
module.exports=server;
