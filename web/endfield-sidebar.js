/* Sidebar artwork only. Existing navigation buttons and routing own all actions. */
(()=>{'use strict';
 const ns='http://www.w3.org/2000/svg',tabs=[...document.querySelectorAll('#navTabs .nav-tab')];
 // Restore the original solid sidebar artwork; navigation and motion stay intact.
 const art={
  download:{code:'01 / ACQUISITION',paths:['M17 3h14v18h11L24 39 6 21h11Z','M3 37h8v5h26v-5h8v11H3Z']},
  dlmanager:{code:'02 / TRANSFER',paths:['M3 4h9v9H3zM3 20h9v9H3zM3 36h9v9H3z','M18 5h27v7H18zM18 21h27v7H18zM18 37h17v7H18z','m38 33 9 7-9 7Z']},
  models:{code:'03 / ARCHIVE',paths:['m24 2 22 12-22 12L2 14Zm0 6L13 14l11 6 11-6Z','m2 23 7-4 15 8 15-8 7 4-22 12Z','m2 33 7-4 15 8 15-8 7 4-22 12Z']},
  updates:{code:'04 / VERSION',paths:['M4 4h29v8H12v10H4Z', 'M27 0 44 8 27 17Z', 'M44 44H15v-8h21V26h8Z', 'M21 48 4 40l17-9Z']},
  reverse:{code:'05 / IDENTIFY',paths:['M3 3h42v11h-8v-3H11v3H3ZM3 34h8v3h26v-3h8v11H3Z','M7 20h11v8H7ZM30 20h11v8H30Z','M22 14h4v20h-4Z']},
  workflow:{code:'06 / WORKFLOW',paths:['M17 2h14v14H17zM2 32h14v14H2zM32 32h14v14H32z','M20 15h8v7h15v10h-8v-3H13v3H5V22h15Z']},
  settings:{code:'07 / SYSTEM',paths:['M3 7h42v7H3zM3 21h42v7H3zM3 35h42v7H3z','M11 2h9v17h-9zM29 16h9v17h-9zM12 30h9v17h-9z']}
 };

 for(const tab of tabs){
  const drawing=art[tab.dataset.page];if(!drawing||tab.querySelector('.ef-nav-preview'))continue;
  const preview=document.createElement('span');preview.className='ef-nav-preview';preview.setAttribute('aria-hidden','true');
  const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 48 48');svg.setAttribute('focusable','false');
  for(const d of drawing.paths){const p=document.createElementNS(ns,'path');p.setAttribute('d',d);p.setAttribute('fill-rule','evenodd');svg.append(p);}
  preview.append(svg);
  const key=document.createElement('span');key.className='ef-nav-key';key.setAttribute('aria-hidden','true');
  const tick=document.createElement('span');tick.className='ef-nav-marker';tick.setAttribute('aria-hidden','true');
  const gutter=document.createElement('span');gutter.className='ef-nav-gutter';gutter.setAttribute('aria-hidden','true');
  const stamp=document.createElement('span');stamp.className='ef-nav-stamp';stamp.setAttribute('aria-hidden','true');
  const arrow=document.createElementNS(ns,'svg');arrow.setAttribute('viewBox','0 0 16 16');arrow.setAttribute('focusable','false');const arrowPath=document.createElementNS(ns,'path');arrowPath.setAttribute('d','M2 2h12v3H7l8 8-2 2-8-8v7H2Z');arrow.append(arrowPath);stamp.append(arrow);
  const sweep=document.createElement('span');sweep.className='ef-nav-sweep';sweep.setAttribute('aria-hidden','true');
  tab.append(sweep,preview,key,tick,gutter,stamp);
  // Keep decorative captions out of textContent: page titles and shortcuts still
  // receive only the original Chinese label, never the artwork metadata.
  const sync=()=>{
   // The asynchronous workbench boot wraps the original label with innerHTML.
   // Reattach our inert artwork after that one-time normalization as well.
   if(!tab.contains(preview))tab.append(sweep,preview,key,tick,gutter,stamp);
   const label=tab.querySelector('.nav-label');if(label)label.dataset.efNavMeta=drawing.code;
   key.hidden=!tab.classList.contains('needs-api-key');
   if(tab.classList.contains('active'))tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');
  };
  new MutationObserver(sync).observe(tab,{attributes:true,attributeFilter:['class'],childList:true});sync();
 }
})();
