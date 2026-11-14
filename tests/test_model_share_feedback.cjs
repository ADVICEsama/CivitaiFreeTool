const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
async function scenario(result,clipboard){
 const statuses=[],button={disabled:false,isConnected:true};let release;
 const context={document:{querySelectorAll:s=>s==='#dShare'?[button]:[],addEventListener(){}},window:{},CFTI18n:{t:k=>k},setStatus:t=>statuses.push(t),api:{call:()=>new Promise(r=>{release=r;})},navigator:{clipboard},atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array,Blob,ClipboardItem:class{constructor(data){this.data=data;}}};
 vm.runInNewContext(fs.readFileSync('web/model-share.js','utf8'),context);
 const pending=context.window.CFTModelShare.create('model');
 assert.equal(button.disabled,true);assert.deepEqual(statuses,['share.working']);
 assert.equal(await context.window.CFTModelShare.create('another'),undefined);
 release(result);const ok=await pending;assert.equal(button.disabled,false);return {ok,statuses};
}
(async()=>{
 assert.deepEqual(await scenario({ok:true,copied:true}),{ok:true,statuses:['share.working','share.copied']});
 let writes=0;
 assert.deepEqual(await scenario({ok:true,copied:false,b64:'AA=='},{write:async()=>{writes++;}}),{ok:true,statuses:['share.working','share.copying','share.copied']});assert.equal(writes,1);
 assert.deepEqual(await scenario({ok:true,copied:false,b64:'AA=='},{write:async()=>{throw Error('denied');}}),{ok:false,statuses:['share.working','share.copying','share.failed']});
 assert.deepEqual(await scenario({ok:false}),{ok:false,statuses:['share.working','share.failed']});
 console.log('PASS share status: working / clipboard / success / failure / duplicate click');
})().catch(e=>{console.error(e);process.exitCode=1;});
