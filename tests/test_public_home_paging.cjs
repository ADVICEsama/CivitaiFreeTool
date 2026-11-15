'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'../docs');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404);return res.end();}const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.otf':'font/otf'};res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(b);});});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});
 try{
 for(const [width,height,theme] of [[1440,900,'dark'],[1440,900,'light'],[1000,720,'light'],[1920,1080,'dark']]){
  const page=await browser.newPage({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce'});let errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(url)&&r.status()!==200)errors.push(r.status()+' '+r.url());});
  await page.route('https://api.github.com/**',r=>r.fulfill({status:503,body:'unavailable'}));await page.goto(url);await page.evaluate(()=>document.fonts.ready);
  assert(await page.locator('.brand-logo').evaluate(img=>img.complete&&img.naturalWidth>0),'logo missing');
  assert.equal(await page.locator('main > .page').count(),7);
  assert(await page.locator('html').evaluate(e=>e.classList.contains('paged')));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const ids=['home','capabilities','analysis','performance','download','start','questions'];
  for(let i=0;i<ids.length;i++){
   await page.locator('.page-rail a').nth(i).click();await page.waitForFunction(n=>document.querySelector('#pageNumber').textContent.startsWith(n),String(i+1).padStart(2,'0'));
   assert.equal(await page.locator('html').getAttribute('data-scene'),ids[i]);
   const header=await page.locator('.top').boundingBox();assert.equal(header.x,0);assert.equal(header.width,width,'header must cover viewport');
   assert.equal(await page.locator('.map-contours').count(),1);
   assert.equal(await page.locator('.analysis').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
   assert.equal(await page.locator('.download').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
   const rect=await page.locator('#'+ids[i]).boundingBox();assert(Math.abs(rect.y-96)<4,'chapter alignment '+ids[i]+' '+rect.y);
   await page.screenshot({path:path.resolve(__dirname,`../.test_tmp/chapter-${ids[i]}-${width}-${theme}.png`)});
  }
  await page.locator('.page-rail a').first().click();await page.waitForTimeout(250);await page.mouse.move(width/2,height/2);await page.mouse.wheel(0,120);await page.waitForFunction(()=>document.querySelector('#pageNumber').textContent.startsWith('02'));
  await page.waitForTimeout(250);await page.keyboard.press('PageUp');await page.waitForFunction(()=>document.querySelector('#pageNumber').textContent.startsWith('01'));
  assert.deepEqual(errors,[]);console.log('PASS chapters / wheel / keyboard',width,height,theme);await page.close();
 }
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'no-preference'});await page.route('https://api.github.com/**',r=>r.fulfill({status:503,body:'unavailable'}));await page.goto(url);await page.mouse.move(700,450);await page.mouse.wheel(0,120);for(let i=0;i<5;i++)await page.mouse.wheel(0,60);await page.waitForTimeout(1100);assert.equal(await page.locator('#pageNumber').textContent(),'02 / 07','one gesture skipped a chapter');console.log('PASS smooth gesture momentum');await page.close();
 const small=await browser.newPage({viewport:{width:390,height:844}});await small.route('https://api.github.com/**',r=>r.fulfill({status:503,body:'unavailable'}));await small.goto(url);assert(!(await small.locator('html').evaluate(e=>e.classList.contains('paged'))));await small.mouse.move(200,400);await small.mouse.wheel(0,250);await small.waitForTimeout(300);assert(await small.evaluate(()=>scrollY>0&&scrollY<500));console.log('PASS mobile native scroll');await small.close();
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
