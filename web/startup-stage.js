/* A real initialization stage, deliberately not a fabricated percentage. */
(()=>{'use strict';const stage=document.getElementById('startupStage');if(!stage)return;
let finished=false;const finish=()=>{finished=true;stage.hidden=true;clearTimeout(timer);};
const timer=setTimeout(()=>{if(finished)return;stage.querySelector('p').textContent='连接时间较长，可重试界面；后台下载不会因此被删除。';stage.querySelector('button').hidden=false;},15000);
stage.querySelector('button').onclick=()=>location.reload();
window.addEventListener('cft:ui-ready',finish,{once:true});
window.addEventListener('beforeunload',()=>clearTimeout(timer),{once:true});
})();
