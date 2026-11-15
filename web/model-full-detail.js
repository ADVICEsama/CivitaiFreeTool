/* Full dossier reuses inspector nodes and business actions, never duplicates IDs. */
(()=>{'use strict';
 let returnFocus=null;
 const t=k=>CFTI18n.t(k);
 function button(key,icon,fn){const b=document.createElement('button');b.type='button';b.className='icon-btn';b.dataset.i18nAriaLabel=key;b.setAttribute('aria-label',t(key));b.innerHTML=icon==='chevron-left'||icon==='chevron-right'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="'+(icon==='chevron-left'?'m15 5-7 7 7 7':'m9 5 7 7-7 7')+'"/></svg>':_icon(icon);b.onclick=fn;return b;}
 function mount(panel,d,full){
  document.querySelectorAll('.model-dossier-model-nav').forEach(n=>n.remove());
  const expand=button('models.expand','chevron-left',()=>showModelDetail(d.path,d.history_id||'',{full:true}));expand.classList.add('model-dossier-expand');panel.append(expand);
  if(!full)return;
  if(!returnFocus&&!panel.contains(document.activeElement))returnFocus=document.activeElement;
  document.body.append(document.getElementById('detailMask'));
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',t('models.expand'));
  const body=panel.querySelector('.dt-body'),left=panel.querySelector('.detail-left'),right=panel.querySelector('.detail-right');if(!body||!left||!right)return;
  const header=document.createElement('header');header.className='model-dossier-header';
  const title=panel.querySelector('.detail-title');if(title)header.append(title);body.before(header);
  const favorite=panel.querySelector('#dFavorite');if(favorite){favorite.classList.add('model-dossier-favorite');header.prepend(favorite);}
  const actions=document.createElement('div');actions.className='model-dossier-heading-actions';
  const close=panel.querySelector('.ef-model-detail-close');if(close){close.className='model-dossier-tool ef-model-detail-close';actions.append(close);}header.append(actions);panel.querySelector('.dt-head')?.remove();
  const heading=panel.querySelector('.ef-inspector-heading');if(heading)right.prepend(heading);
  const more=panel.querySelector('.ef-inspector-more');if(more){more.open=true;more.dispatchEvent(new Event('toggle'));}
  const footer=document.createElement('footer');footer.className='model-dossier-footer';
  for(const node of panel.querySelectorAll('.ef-inspector-actions,.ef-inspector-more'))footer.append(node);panel.append(footer);
  const description=panel.querySelector('.detail-desc')?.closest('.dt-sec');if(description){description.classList.add('model-dossier-description');body.after(description);}
  const gallery=panel.querySelector('.ef-inspector-gallery');if(gallery)left.append(gallery);
  const covers=d.covers||[],hero=left.querySelector('.ef-inspector-hero');
  if(hero&&covers.length>1){
   let selected=0;
   for(const [step,key] of [[-1,'models.image.previous'],[1,'models.image.next']]){
    const nav=button(key,step<0?'chevron-left':'chevron-right',()=>{selected=(selected+step+covers.length)%covers.length;panel.selectDetailImage?.(selected);});
    nav.classList.add('model-dossier-image-nav',step<0?'previous':'next');hero.append(nav);
   }
  }
  const rows=(state.display||[]).filter(r=>r.path),index=rows.findIndex(r=>r.path===d.path);
  if(index>=0&&rows.length>1){
   for(const [step,key] of [[-1,'models.previous'],[1,'models.next']]){
    const nav=button(key,step<0?'chevron-left':'chevron-right',()=>showModelDetail(rows[(index+step+rows.length)%rows.length].path,'',{full:true}));
    nav.classList.add('model-dossier-model-nav',step<0?'previous':'next');document.getElementById('detailMask').append(nav);
   }
  }
  panel.querySelector('.ef-model-detail-close')?.focus({preventScroll:true});
 }
 async function setCover(d,index){
  const c=d?.covers?.[index],status=document.getElementById('ivStatus');if(!d?.path||d.cached_history||!c)return;
  const controls=[...document.querySelectorAll('[data-act="iv_cover"]')];controls.forEach(b=>b.disabled=true);
  if(status)status.textContent=t('models.cover.saving');
  try{const result=await api.call('set_model_cover',d.path,c.local_path||'',c.orig_url||c.url||'');if(!result?.ok)throw Error();
   const row=state.models?.find(r=>r.path===d.path);if(row)row.has_cover=true;
   if(typeof mmInvalidateCover==='function')mmInvalidateCover(d.path);
   if(typeof loadThumbs==='function')loadThumbs();if(typeof loadMasonryThumbs==='function')loadMasonryThumbs();
   if(status)status.textContent=t('models.cover.saved');setStatus(t('models.cover.saved'));
  }catch{if(status)status.textContent=t('models.cover.failed');}finally{controls.forEach(b=>b.disabled=false);}
 }
 document.addEventListener('dblclick',e=>{const row=e.target.closest('#mmMasonry .ms-card,#mmTable tbody tr[data-path]');if(!row||e.target.closest('button,a,input'))return;e.preventDefault();mmCancelDetailPreview();showModelDetail(row.dataset.path,'',{full:true});});
 document.getElementById('mmRandom')?.addEventListener('click',()=>{const rows=state.display||[];if(rows.length)showModelDetail(rows[Math.floor(Math.random()*rows.length)].path,'',{full:true});else setStatus(t('models.random.empty'));});
 document.addEventListener('keydown',e=>{if(e.key!=='Tab'||!document.body.classList.contains('large-model-open')||document.querySelector('.image-viewer'))return;const panel=document.getElementById('detailMask'),items=[...panel.querySelectorAll('button,a[href],input,summary,[tabindex="0"]')].filter(x=>!x.disabled&&x.getClientRects().length);if(!items.length)return;const index=items.indexOf(document.activeElement);if(e.shiftKey&&index<=0){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&index===items.length-1){e.preventDefault();items[0].focus();}});
 window.CFTFullModel={mount,setCover,dispose(){document.querySelectorAll('.model-dossier-model-nav').forEach(n=>n.remove());const p=document.getElementById('detailPanel');p?.removeAttribute('aria-modal');p?.removeAttribute('role');if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}};
})();
