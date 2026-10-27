/* Independent theme controller: switches presentation only; never changes model selection or tasks. */
(()=>{'use strict';
 const root=document.documentElement,NS='http://www.w3.org/2000/svg';
 const paths={download:'M10 2h4v10h5l-7 8-7-8h5Z M3 19v3h18v-3',layers:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',folder:'M2 5h8l3 3h9v13H2Z',scan:'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6 M7 12h10',search:'M3 3h12v12H3z M15 15l7 7',workflow:'M9 2h6v6H9z M2 16h6v6H2z M16 16h6v6h-6z M12 8v4H5v4 M12 12h7v4',settings:'M3 5h18 M3 12h18 M3 19h18 M7 2v6 M17 9v6 M9 16v6',list:'M3 3h3v3H3z M9 4h12 M3 10h3v3H3z M9 11h12 M3 17h3v3H3z M9 18h12',refresh:'M3 10V3h7 M3 3l5 5 M21 14v7h-7 M21 21l-5-5 M7 3h10l4 4v3 M17 21H7l-4-4v-3',pause:'M5 3h4v18H5z M15 3h4v18h-4z',star:'m12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z',check:'M3 3h18v18H3z M6 12l4 4 8-9',external:'M14 3h7v7 M10 14 21 3 M10 3H3v18h18v-7',alert:'M12 2 23 22H1Z M12 8v7 M12 18v1',info:'M3 3h18v18H3z M12 10v8 M12 6v1',clock:'M6 2h12l4 4v12l-4 4H6l-4-4V6Z M12 6v6h5'};
 const sprite=document.createElementNS(NS,'svg');sprite.style.display='none';sprite.setAttribute('aria-hidden','true');
 for(const [key,d] of Object.entries(paths)){const s=document.createElementNS(NS,'symbol');s.id='ef-'+key;s.setAttribute('viewBox','0 0 24 24');const p=document.createElementNS(NS,'path');p.setAttribute('d',d);s.append(p);sprite.append(s);}document.body.append(sprite);
 const active=()=>root.dataset.endfield==='true';
 function icons(scope){for(const u of scope?.querySelectorAll?.('svg use')||[]){const href=u.getAttribute('href')||'';const saved=u.dataset.efOriginal;if(active()&&href.startsWith('#i-')&&paths[href.slice(3)]){u.dataset.efOriginal=href;u.setAttribute('href','#ef-'+href.slice(3));u.closest('svg').classList.add('ef-icon');}else if(!active()&&saved){u.setAttribute('href',saved);delete u.dataset.efOriginal;u.closest('svg').classList.remove('ef-icon');}}}
 const terrain=document.createElement('div');terrain.id='efTerrain';terrain.setAttribute('aria-hidden','true');
 document.body.prepend(terrain);
 const terrainScene=window.CFTTerrainMap.mount(terrain,{strength:.23,flow:true});
 const names={download:'ACQUISITION / DOWNLOAD',dlmanager:'TRANSFER CONTROL',models:'MODEL ARCHIVE',updates:'VERSION INTELLIGENCE',reverse:'RESOURCE IDENTIFICATION',workflow:'WORKFLOW ENGINEERING',settings:'SYSTEM PREFERENCES'};
 for(const [id,label] of Object.entries(names)){const h=document.querySelector('#page-'+id+' .page-title');if(h)h.dataset.efLabel=label;}
 function reset(){
  const enabled=typeof state==='undefined'||state.cfg?.endfield_parallax!==false&&!window.CFTMotion?.reduced();
  root.dataset.efMotion=String(enabled);
  terrainScene.setInteractive(enabled);terrainScene.setFlow(enabled);
  terrainScene.setFps(typeof state==='undefined'?60:state.cfg?.effects_fps_limit);
  terrainScene.setPixelRatio?.(typeof state==='undefined'?1.5:state.cfg?.terrain_pixel_ratio||1.5);
 }
 function followPage(){const id=document.querySelector('.page.active')?.id?.replace('page-','');if(id)terrainScene.focusPage(id);}
 window.addEventListener('cft:page-changed',followPage);
 window.addEventListener('cft:workflow-view',e=>terrainScene.setWorkflowDetail(e.detail?.active));
 function sync(){root.dataset.endfield=String(['dark_endfield','light_endfield'].includes(root.dataset.theme));icons(document);terrainScene.setEnabled(active());reset();followPage();}
 window.addEventListener('cft:config-saved',reset);
 new MutationObserver(sync).observe(root,{attributes:true,attributeFilter:['data-theme']});sync();
 let context='yellow';const color={yellow:'var(--ef-yellow)',cyan:'var(--ef-cyan)',green:'var(--ef-green)',magenta:'var(--ef-magenta)'};
 document.addEventListener('click',e=>{if(!active())return;const object=e.target.closest('[data-ef-state],.nav-tab');if(object){const state=object.dataset.efState;context=state==='downloading'?'cyan':state==='done'?'green':state==='update'||object.dataset.page==='updates'?'magenta':'yellow';root.style.setProperty('--ef-context',color[context]);}},true);
 function enrich(node){if(node.nodeType!==1)return;icons(node);if(node.matches?.('svg'))icons(node.parentElement);}
 new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)enrich(n);}).observe(document.body,{childList:true,subtree:true});
 window.CFTEndfield={sync,reset,holdWorkflow:value=>terrainScene.holdWorkflow(value),moveWorkflow:options=>terrainScene.moveWorkflow(options),redraw:()=>terrainScene.redraw()};
})();
