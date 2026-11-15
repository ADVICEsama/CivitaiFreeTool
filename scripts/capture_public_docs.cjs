/* Public screenshots use isolated synthetic fixtures, never live user data. */
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const path=require('node:path');
const server=require('../scripts/preview_endfield_settings.cjs');
const themes=process.argv.includes('--light-only')?['light']:['dark','light'];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch();
 try{
  for(const theme of themes)for(const [name,query,ready] of [
   ['models','models=grid','#mmMasonry .ms-card'],
   ['updates','updates=preview','#updTbody tr'],
   ['workflow','workflow=preview','#wfResult']
  ]){
   const page=await browser.newPage({viewport:{width:1440,height:900}});
   await page.goto('http://127.0.0.1:'+server.address().port+'/?'+query);
   await page.waitForSelector(ready);await page.waitForFunction(()=>window.__ready);
   await page.evaluate(theme=>{
    state.cfg.theme=theme+'_endfield';state.cfg.performance_prompt_version=1;
    applyUiAppearance();document.querySelector('#performanceChoice')?.remove();
   },theme);
   if(name==='models')await page.locator('#mmMasonry .ms-card').first().click();
   await page.waitForTimeout(800);await page.mouse.move(2,2);
   const suffix=theme==='dark'?'':'-light';
   await page.screenshot({path:path.resolve('docs/screenshots/overview-'+name+'-v3'+suffix+'.png')});
   console.log('Captured isolated synthetic',theme,name);await page.close();
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
