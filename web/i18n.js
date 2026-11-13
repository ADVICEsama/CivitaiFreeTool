(()=>{'use strict';
const catalogs=window.CFTLocales;let locale='zh-CN',busy=false,frame=0;
const t=(k,params={})=>String(catalogs[locale]?.[k]??catalogs['zh-CN'][k]??k).replace(/\{(\w+)\}/g,(match,key)=>params[key]??match);
function label(el,value){if(!el)return;const caption=el.querySelector(':scope>.ef-action-caption,:scope>.nav-label');if(caption){label(caption,value);return;}const nodes=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim());if(nodes.length){if(nodes[0].textContent.trim()!==value)nodes[0].textContent=value;for(const n of nodes.slice(1))n.remove();}}
async function change(value){if(busy||!catalogs[value])return;busy=true;document.querySelectorAll('[data-cft-language]').forEach(e=>e.disabled=true);try{if(!await api.call('save_config',{ui_language:value}))throw Error('save');state.cfg.ui_language=value;apply(value);window.dispatchEvent(new CustomEvent('cft:language-changed',{detail:{locale:value}}));}catch{if(typeof showToast==='function')showToast(t('saveFailed'));}finally{busy=false;document.querySelectorAll('[data-cft-language]').forEach(e=>e.disabled=false);refresh();}}
function picker(host,id){if(!host||document.getElementById(id))return;const wrap=document.createElement('div');wrap.id=id;wrap.className='cft-language-picker';const caption=document.createElement('span');caption.dataset.i18n='language';const select=document.createElement('select');select.dataset.cftLanguage='true';select.className='input';select.id=id+'Select';for(const [value,data] of Object.entries(catalogs)){const option=document.createElement('option');option.value=value;option.textContent=data.name;select.append(option);}select.addEventListener('change',()=>change(select.value));const control=document.createElement('div');control.className='cft-language-control';control.append(select);wrap.append(caption,control);host.append(wrap);}
function refresh(){
 const shareTheme=document.querySelector('#setting-model_share_theme');if(shareTheme){const row=shareTheme.closest('.setting-row');const caption=row?.querySelector('.setting-copy label');if(caption)label(caption,t('share.theme'));for(const o of shareTheme.options){const value=t('share.'+o.value);if(o.textContent!==value)o.textContent=value;}}

 picker(document.querySelector('#obMain .ob-heading'),'obLanguagePicker');
 picker(document.querySelector('#page-settings>.card>.title-row')?.parentElement,'settingsLanguagePicker');
 for(const [anchor,id] of [[document.getElementById('obSteps'),'obTranslationNotice'],[document.getElementById('settingsLanguagePicker'),'settingsTranslationNotice']]){if(!anchor)continue;let note=document.getElementById(id);if(!note){note=document.createElement('p');note.id=id;note.className='cft-language-note';note.dataset.i18n='ob.preview';anchor.insertAdjacentElement('afterend',note);}note.hidden=locale==='zh-CN';}
 for(const el of document.querySelectorAll('[data-i18n]')){const value=t(el.dataset.i18n);if(el.textContent!==value)el.textContent=value;}
 for(const el of document.querySelectorAll('[data-cft-language]')){el.value=locale;el.setAttribute('aria-label',t('language'));}
 for(const attr of ['placeholder','title','aria-label'])for(const el of document.querySelectorAll('[data-i18n-'+attr+']')){const value=t(el.getAttribute('data-i18n-'+attr));if(el.getAttribute(attr)!==value)el.setAttribute(attr,value);}
 label(document.getElementById('obTitle'),t('ob.title'));label(document.getElementById('obMiniContinue'),t('ob.continue'));
 const mini=document.getElementById('obMiniTitle');if(mini&&typeof obStep!=='undefined'){const text=t('ob.stepSummary',{step:t('ob.step.'+obStep),current:obStep+1,total:6});if(mini.textContent!==text)mini.textContent=text;}
 window.CFTEndfieldSettings?.refresh();
 for(const tab of document.querySelectorAll('#navTabs .nav-tab'))label(tab,t('nav.'+tab.dataset.page));
 label(document.getElementById('obPrev'),t('back'));label(document.getElementById('obNext'),t(typeof obStep!=='undefined'&&obStep===OB_STEPS.length-1?'finish':'next'));label(document.getElementById('obSkipAll'),t('skip'));
}
function apply(value){locale=catalogs[value]?value:'zh-CN';document.documentElement.lang=locale;refresh();}
function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;refresh();});}
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
window.CFTI18n={t,apply,refresh,change,get locale(){return locale;}};
})();
