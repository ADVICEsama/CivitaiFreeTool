const {chromium}=require(process.env.PLAYWRIGHT_PATH),server=require('../scripts/preview_endfield_settings.cjs'),assert=require('node:assert/strict');
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await chromium.launch();try{
 const p=await b.newPage({viewport:{width:1440,height:1000}});await p.goto('http://127.0.0.1:'+server.address().port+'/?models=grid');await p.waitForFunction(()=>window.__ready);await p.waitForTimeout(500);
 await p.evaluate(()=>{window.fixtureModelGallery=['#183b55','#76432a','#a58b32'].map(color=>{const c=document.createElement('canvas');c.width=120;c.height=160;c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,120,160);return c.toDataURL().split(',')[1];});});
 await p.locator('#mmMasonry .ms-card').first().dblclick();await p.waitForSelector('body.large-model-open');
 await p.locator('.model-dossier-image-nav.next').click();await p.waitForFunction(()=>detailImgIdx===1);await p.waitForFunction(()=>document.querySelector('#dMain').src.includes(fixtureModelGallery[1]));
 await p.locator('.model-dossier-image-nav.previous').click();await p.waitForFunction(()=>detailImgIdx===0);
 const before=await p.locator('#detailPanel .detail-title').innerText();await p.locator('.model-dossier-model-nav.next').click();await p.waitForFunction(t=>document.querySelector('#detailPanel .detail-title').innerText!==t,before);await p.locator('.model-dossier-model-nav.previous').click();await p.waitForFunction(t=>document.querySelector('#detailPanel .detail-title').innerText===t,before);await p.evaluate(()=>closeDetail());
 for(const theme of ['dark_endfield','light_endfield'])for(const [width,height,zoom] of [[640,760,125],[900,700,100]]){
  await p.setViewportSize({width,height});await p.evaluate(({theme,zoom})=>{state.cfg.theme=theme;applyUiAppearance();applyZoom(zoom);showDedupeDialog([{keep:'a',keep_name:'keep',dups:[{path:'b',name:'duplicate',size:500}]}],[]);},{theme,zoom});await p.waitForSelector('.dedup-dialog');await p.waitForTimeout(250);
  const metrics=await p.locator('.dedup-dialog').evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,vw:innerWidth,scroll:e.scrollWidth,width:e.clientWidth}));assert(metrics.left>=-1&&metrics.right<=metrics.vw+1&&metrics.scroll<=metrics.width+1,JSON.stringify(metrics));
  for(const button of await p.locator('.dedup-dialog button').all()){await button.scrollIntoViewIfNeeded();assert(await button.isVisible());}
  await p.screenshot({path:'.test_tmp/v320-dedup-edge-'+theme+'-'+width+'.png'});await p.locator('#ddClose').click();await p.waitForTimeout(250);
 }
 console.log('PASS image navigation changes selected image; filtered model navigation round trip; dedup narrow/zoom in both themes');
}finally{await b.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
