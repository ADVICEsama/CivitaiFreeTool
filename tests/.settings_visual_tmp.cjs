/* Real application DOM, synthetic bridge and generated covers; never reads user images. */
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),out=path.join(root,'.test_tmp','endfield-direct-check');fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(__dirname,'test_ui_preferences.cjs'),'utf8').replace(/\r\n/g,'\n');
const begin=source.indexOf('await page.addInitScript(')+'await page.addInitScript('.length,end=source.indexOf('\n    });\n    const url',begin)+6,init=eval('('+source.slice(begin,end)+')');
const server=http.createServer((req,res)=>{const p=path.resolve(web,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!p.startsWith(web+path.sep))return res.writeHead(403).end();fs.readFile(p,(e,b)=>{res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8');res.writeHead(e?404:200).end(e?'':b);});});
let passed=0;const ok=s=>{passed++;console.log('PASS '+s);};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(init);
 await page.route('https://**',r=>r.fulfill({json:[]}));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready);
 await page.evaluate(()=>{state.cfg.theme='dark_endfield';document.documentElement.dataset.theme='dark_endfield';applyUiAppearance();switchPage('settings');showSettingsCategory('appearance');});
 await page.waitForTimeout(400);await page.screenshot({path:path.join(out,'settings-initial.png')});console.log(await page.evaluate(()=>({rows:document.querySelectorAll('.setting-row').length,form:document.querySelector('#settingsForm').getBoundingClientRect().toJSON(),body:document.querySelector('.settings-panels').getBoundingClientRect().toJSON()})));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
