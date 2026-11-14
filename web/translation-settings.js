(()=>{'use strict';
 const presets={deepseek:['https://api.deepseek.com',['deepseek-flash','deepseek-v4-pro']],opencode:['https://opencode.ai/inference/openai/v1',['deepseek-v4.1-flash','deepseek-v4-pro','qwen3.8-max']],custom:['',[]]};
 function refresh(changed=false){const select=document.getElementById('setting-translation_provider');if(!select)return;const provider=select.value,ai=!!presets[provider];
  for(const key of ['translation_protocol','translation_base_url','translation_model','translation_api_key']){const input=document.getElementById('setting-'+key);if(input){input.closest('.setting-row').hidden=!ai;if(changed&&key!=='translation_api_key'){input.value=key==='translation_protocol'?'chat':key==='translation_base_url'?(presets[provider]?.[0]||''):(presets[provider]?.[1]?.[0]||'');}}}
  for(const key of ['baidu_appid','baidu_key']){const input=document.getElementById('setting-'+key);if(input)input.closest('.setting-row').hidden=provider!=='baidu';}
  const input=document.getElementById('setting-translation_model');if(input){let list=document.getElementById('translationModels');if(!list){list=document.createElement('datalist');list.id='translationModels';input.after(list);}list.replaceChildren();for(const id of presets[provider]?.[1]||[]){const o=document.createElement('option');o.value=id;list.append(o);}input.setAttribute('list',list.id);}
  const test=document.getElementById('btnTestBaidu');if(test){const caption=test.querySelector('.ef-action-caption');(caption||test).textContent=CFTI18n.t('translation.test');}
 }
 document.addEventListener('change',e=>{if(e.target.id==='setting-translation_provider')refresh(true);});
 document.addEventListener('click',e=>{if(e.target.closest('[data-settings-category="translation"]'))queueMicrotask(()=>refresh());});
 new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.id==='setting-translation_provider'||n.querySelector?.('#setting-translation_provider')))))refresh();}).observe(document.body,{childList:true,subtree:true});
 window.addEventListener('cft:language-changed',()=>refresh());refresh();
})();
