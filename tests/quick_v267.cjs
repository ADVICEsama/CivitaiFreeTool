/* 隔离前端回归测试：只使用虚构数据，不连接正在运行的下载后端。
 * PLAYWRIGHT_PATH=<playwright 包路径> node tests/test_ui_preferences.cjs
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const web = path.resolve(__dirname, '../web');
const shots = path.resolve(__dirname, '../screens_ui');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(web, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(web + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8'})[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});
let passed = 0;
function ok(name) { passed++; console.log('OK ' + name); }
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width:1280, height:820}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const key = 'cft-test-config';
      const defaults = { theme:'dark_graphite', ui_zoom:100, ui_scheme:'light', metro_accent:'#0078D4',
        api_key:'test-fixture-not-a-real-key', default_page:'dlmanager', default_view:'list',
        show_file_paths:true, custom_accent_enabled:false, custom_accent:'#60A5FA', ui_density:'standard', ui_corners:'theme',
        models_dir:'D:\\AI\\models', download_dir:'D:\\AI\\downloads', models_dirs:[],
        ambient_bg:false, ask_move_after_download:false, organize_rules:[],browser_fallback_enabled:true,ui_mode:'window',ui_text_size:'standard',window_appearance:'theme' };
      window.fixtureCfg = Object.assign({}, defaults, JSON.parse(localStorage.getItem(key) || '{}'));
      window.fixtureCalls = [];
      window.fixtureFolderMode = 'normal';
      window.fixtureHistory = [];
      window.fixtureTasks=[{id:'fixture-1',filename:'example.safetensors',status:'pending',dest_dir:'D:\\AI\\models\\分类 1',total:123456,downloaded:0,progress:0}];
      window.pywebview = {api: new Proxy({}, {get: (_, method) => async (...args) => {
        window.fixtureCalls.push({method, args});
        if(method === 'toggle_model_favorite'){const path=args[0],favorites=window.fixtureCfg.model_favorites||[];const has=favorites.includes(path);window.fixtureCfg.model_favorites=has?favorites.filter(p=>p!==path):favorites.concat(path);return {ok:true,favorites:window.fixtureCfg.model_favorites,favorite:!has};}
        if(method === 'open_gallery_resource')return {ok:true,direct:!!args[0].modelId,msg:'fixture resource'};
        if(method === 'get_window_appearance')return window.fixtureAppearance||{};
        if (method === 'get_config') return {...window.fixtureCfg};
        if (method === 'save_config') { Object.assign(window.fixtureCfg, args[0]); localStorage.setItem(key, JSON.stringify(window.fixtureCfg)); return true; }
        if (method === 'get_local_fonts') return {ok:true,fonts:['Segoe UI','Microsoft YaHei UI','微软雅黑']};
        if (method === 'get_data_storage_info') return {current:'D:\\CFT',default:'D:\\CFT',suggested:'D:\\Profile\\CFTData',warning:''};
        if (method === 'migrate_data_storage') return {ok:true,msg:'fixture migration'};
        if (method === 'open_in_browser') return {ok:true,msg:'fixture browser'};
        if (method === 'get_folders') {
          if (window.fixtureFolderMode === 'error') throw new Error('fixture folder failure');
          if (window.fixtureFolderMode === 'empty') return JSON.stringify({root:'',tree:[]});
          const tree = Array.from({length:80}, (_,i) => ({name: '分类 '+i, path:'分类 '+i, children:[{name:'风格 <script> & "中文" '+i, path:'分类 '+i+'/风格 <script> & "中文" '+i, children:[]}]}));
          return JSON.stringify({root:'D:\\AI\\models',tree});
        }
        if (method === 'get_download_history') return {items:window.fixtureHistory,error:''};
        if (method === 'get_history_thumbnail' && window.fixtureHistoryThumbs?.[args[0]])return window.fixtureHistoryThumbs[args[0]];
        if (method === 'get_history_thumbnail') return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0x0AAAAASUVORK5CYII=';
        if (method === 'history_move_to') { const row=window.fixtureHistory.find(r=>r.id===args[0]);row.dest_dir=args[1];row.file_path=args[1]+'\\'+row.filename;return {ok:true,msg:'fixture move'}; }
        if ((method === 'get_history_detail' || method === 'get_model_detail') && window.fixtureDetail) return JSON.stringify({...window.fixtureDetail,path:args[0]});
        if(method==='get_gallery_image')return {ok:true,b64:window.fixtureCoverB64,mime:'image/png',width:600,height:900,original_available:true,...(window.fixtureOriginalMetadata||{})};
        if(method==='get_gallery_metadata')return window.fixtureOnlineMetadata||{};
        if(method==='copy_gallery_image')return {ok:true,msg:'当前图片已复制（fixture）'};
        if(method==='save_gallery_image')return {ok:true,msg:'已保存原图片（fixture）'};
        if (method === 'get_history_detail' || method === 'get_model_detail') return JSON.stringify({ok:true,path:method==='get_history_detail'?(window.fixtureHistory.find(r=>r.id===args[0])?.file_path||args[0]):args[0],name:'示例模型',base:'SDXL',ver:'v1.2',size:1048576,covers:[],info:{name:'示例模型',type:'LoRA',baseModel:'SDXL',trainedWords:['soft light'],description:'这是隔离测试数据，不包含真实模型。',version:{name:'v1.2'}}});
        if (method === 'get_tasks') return window.fixtureTasks;
        if (method === 'rp_get_rows') return [{path:'D:\\AI\\models\\example.safetensors',status:'待反查',sha:''}];
        if (method === 'get_download_target') return JSON.stringify({default:window.fixtureCfg.download_dir});
        if (method === 'get_version') return JSON.stringify({ok:true,version:'2.3.1'});
        if (method === 'get_scan_rows') return JSON.stringify(window.fixtureScanRows||[]);
        if (method === 'get_scan_state') return {running:false};
        if (method === 'get_covers') return '{}';
        if (method === 'get_system_accent') return '#107C10';
        if (method === 'log_ui_error') throw new Error('UI error: ' + args[0]);
        return {};
      }})};
    });
    const url = 'http://127.0.0.1:' + server.address().port;
    async function settingControl(key) {
      await page.evaluate(k => {
        const row=document.querySelector('[data-key="'+k+'"]');
        if(row) showSettingsCategory(row.closest('[data-settings-panel]').dataset.settingsPanel);
      },key);
      return page.locator('[data-key="'+key+'"]');
    }
    await page.goto(url);
    await page.waitForFunction(() => window.__ready && document.querySelector('#settingsForm [data-key="show_file_paths"]'));
    await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=900;window.fixtureCoverB64=c.toDataURL('image/png').split(',')[1];window.fixtureDetail={ok:true,path:'fixture',covers:[{b64:window.fixtureCoverB64,width:600,height:900}]};openImageViewer(window.fixtureDetail);});
    await page.waitForTimeout(400);await page.evaluate(()=>{document.querySelector('.iv-image-scroll').style.placeItems='normal';setViewerZoom(3,null,true);});
    console.log(await page.evaluate(()=>{const a=document.querySelector('.iv-image-scroll'),c=document.querySelector('.iv-image-canvas');return {area:{display:getComputedStyle(a).display,align:getComputedStyle(a).alignItems,justify:getComputedStyle(a).justifyContent,place:getComputedStyle(a).placeItems,scrollLeft:a.scrollLeft,width:a.clientWidth,sw:a.scrollWidth},canvas:{box:c.getBoundingClientRect().toJSON(),style:c.style.cssText},rootzoom:document.documentElement.style.zoom};}));
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});