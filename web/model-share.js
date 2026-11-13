/* Clipboard images are generated locally from authoritative model metadata. */
(()=>{'use strict';let busy=false;
 async function create(path){if(busy||!path)return;busy=true;const buttons=[...document.querySelectorAll('#dShare')];buttons.forEach(b=>b.disabled=true);showToast(CFTI18n.t('share.working'));
 try{const result=await api.call('share_model_card',path,{noDescription:CFTI18n.t('share.noDescription'),noLink:CFTI18n.t('share.noLink')});if(!result?.ok)throw Error('render');
 if(!result.copied){if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('clipboard');const bytes=Uint8Array.from(atob(result.b64),c=>c.charCodeAt(0));await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([bytes],{type:'image/png'})})]);}
 showToast(CFTI18n.t('share.copied'));return true;
 }catch{showToast(CFTI18n.t('share.failed'));return false;}finally{busy=false;buttons.forEach(b=>{if(b.isConnected)b.disabled=false;});}}
 document.addEventListener('click',e=>{if(e.target.closest('#dShare'))create(typeof detailRow!=='undefined'?detailRow?.path:'');});
 window.CFTModelShare={create};
})();
