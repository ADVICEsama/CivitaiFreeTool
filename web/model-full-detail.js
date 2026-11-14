/* Full dossier reuses inspector nodes and business actions, never duplicates IDs. */
(()=>{'use strict';
 let returnFocus=null;
 const t=k=>CFTI18n.t(k);
 function button(key,icon,fn){const b=document.createElement('button');b.type='button';b.className='icon-btn';b.dataset.i18nAriaLabel=key;b.setAttribute('aria-label',t(key));b.innerHTML=_icon(icon);b.onclick=fn;return b;}
 async function upgradePreview(img,cover){
  if(!img||!cover)return;
  try{let b64,mime='image/jpeg';if(cover.local_path){let data=await api.call('get_local_img_b64',cover.local_path,1024);if(typeof data==='string')data=JSON.parse(data);if(data?.ok){b64=data.b64;mime=data.mime||mime;}}else if(cover.url)b64=await api.call('get_cover_b64',cover.url,1024);if(img.isConnected&&b64){cover.b64=b64;img.src='data:'+mime+';base64,'+b64;}}catch{}
 }
 function mount(panel,d,full){
  const expand=button('models.expand','external',()=>showModelDetail(d.path,d.history_id||'',{full:true}));expand.classList.add('model-dossier-expand');panel.append(expand);
  if(!full)return;
  if(!panel.contains(document.activeElement))returnFocus=document.activeElement;
  document.body.append(document.getElementById('detailMask'));
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',t('models.expand'));
  const body=panel.querySelector('.dt-body'),left=panel.querySelector('.detail-left'),right=panel.querySelector('.detail-right');if(!body||!left||!right)return;
  const header=document.createElement('header');header.className='model-dossier-header';
  const title=panel.querySelector('.detail-title');if(title)header.append(title);body.before(header);
  const favorite=panel.querySelector('#dFavorite');if(favorite){favorite.classList.add('model-dossier-favorite');header.prepend(favorite);}
  const actions=document.createElement('div');actions.className='model-dossier-heading-actions';
  const compact=button('models.compact','layers',()=>showModelDetail(d.path,d.history_id||'',{full:false}));compact.className='model-dossier-tool model-dossier-compact';const caption=document.createElement('span');caption.dataset.i18n='models.compact';caption.textContent=t('models.compact');compact.append(caption);if(!document.body.classList.contains('external-model-detail-open'))actions.append(compact);
  const close=panel.querySelector('.ef-model-detail-close');if(close){close.className='model-dossier-tool ef-model-detail-close';const label=document.createElement('span');label.dataset.i18n='models.close';label.textContent=t('models.close');close.append(label);actions.append(close);}header.append(actions);panel.querySelector('.dt-head')?.remove();
  const heading=panel.querySelector('.ef-inspector-heading');if(heading)right.prepend(heading);
  const more=panel.querySelector('.ef-inspector-more');if(more){more.open=true;more.dispatchEvent(new Event('toggle'));}
  const footer=document.createElement('footer');footer.className='model-dossier-footer';
  for(const node of panel.querySelectorAll('.ef-inspector-actions,.ef-inspector-more'))footer.append(node);panel.append(footer);
  const description=panel.querySelector('.detail-desc')?.closest('.dt-sec');if(description){description.classList.add('model-dossier-description');body.after(description);}
  const gallery=panel.querySelector('.ef-inspector-gallery');if(gallery)left.append(gallery);
  const covers=d.covers||[];upgradePreview(panel.querySelector('#dMain'),covers[0]);if(covers.length>1){const second=document.createElement('button');second.type='button';second.className='model-dossier-second';second.setAttribute('aria-label',t('models.image.open'));const img=document.createElement('img');img.alt='';const set=c=>{if(c?.b64)img.src='data:image/jpeg;base64,'+c.b64;};set(covers[1]);second.append(img);left.querySelector('.ef-inspector-hero')?.append(second);second.onclick=()=>openImageViewer(d,1);upgradePreview(img,covers[1]);}
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
 document.addEventListener('keydown',e=>{if(e.key!=='Tab'||!document.body.classList.contains('large-model-open')||document.querySelector('.image-viewer'))return;const panel=document.getElementById('detailPanel'),items=[...panel.querySelectorAll('button,a[href],input,summary,[tabindex="0"]')].filter(x=>!x.disabled&&x.getClientRects().length);if(!items.length)return;const index=items.indexOf(document.activeElement);if(e.shiftKey&&index<=0){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&index===items.length-1){e.preventDefault();items[0].focus();}});
 window.CFTFullModel={mount,setCover,dispose(){const p=document.getElementById('detailPanel');p?.removeAttribute('aria-modal');p?.removeAttribute('role');if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}};
})();
