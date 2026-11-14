/* Clipboard images are generated locally from authoritative model metadata. */
(()=>{'use strict';let busy=false;
 async function create(path){if(busy||!path)return;busy=true;const buttons=[...document.querySelectorAll('#dShare')];buttons.forEach(b=>b.disabled=true);setStatus(CFTI18n.t('share.working'));
 try{const previews=[...document.querySelectorAll('.detail-thumb[data-i]')].filter(img=>Number(img.dataset?.i)>0&&img.naturalWidth>1&&img.src.startsWith('data:image/')).slice(0,4).map(img=>({index:Number(img.dataset.i),b64:img.src.split(',')[1]}));const result=await api.call('share_model_card',path,{noDescription:CFTI18n.t('share.noDescription'),noLink:CFTI18n.t('share.noLink'),downloadModel:CFTI18n.t('share.downloadModel')},previews);if(!result?.ok)throw Error('render');
 if(!result.copied){setStatus(CFTI18n.t('share.copying'));if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('clipboard');const bytes=Uint8Array.from(atob(result.b64),c=>c.charCodeAt(0));await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([bytes],{type:'image/png'})})]);}
 setStatus(CFTI18n.t('share.copied'));return true;
 }catch{setStatus(CFTI18n.t('share.failed'));return false;}finally{busy=false;buttons.forEach(b=>{if(b.isConnected)b.disabled=false;});}}
 document.addEventListener('click',e=>{if(e.target.closest('#dShare'))create(typeof detailRow!=='undefined'?detailRow?.path:'');});
 window.CFTModelShare={create};
})();
