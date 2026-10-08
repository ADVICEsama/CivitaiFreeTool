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
        cache_original_images:false, api_key:'test-fixture-not-a-real-key', default_page:'dlmanager', default_view:'list',
        show_file_paths:true, custom_accent_enabled:false, custom_accent:'#60A5FA', ui_density:'standard', ui_corners:'theme',
        models_dir:'D:\\AI\\models', download_dir:'D:\\AI\\downloads', models_dirs:[],
        ambient_bg:false, ask_move_after_download:false, organize_rules:[],browser_fallback_enabled:true,ui_mode:'window',ui_text_size:'standard',window_appearance:'theme' };
      window.fixtureCfg = Object.assign({}, defaults, JSON.parse(localStorage.getItem(key) || '{}'));
      window.fixtureCalls = [];
      window.fixtureScanRows=JSON.parse(localStorage.getItem('cft-test-scan-rows')||'[]');
      window.addEventListener('load',()=>{window.fixtureRealSettingsChanges=window.settingsHaveChanges;window.settingsHaveChanges=()=>false;});
      window.fixtureFolderMode = 'normal';
      window.fixtureHistory = [];
      window.fixtureTasks=[{id:'fixture-1',filename:'example.safetensors',status:'pending',dest_dir:'D:\\AI\\models\\分类 1',total:123456,downloaded:0,progress:0}];
      window.pywebview = {api: new Proxy({}, {get: (_, method) => async (...args) => {
        window.fixtureCalls.push({method, args});
        if(method === 'toggle_model_favorite'){const path=args[0],favorites=window.fixtureCfg.model_favorites||[];const has=favorites.includes(path);window.fixtureCfg.model_favorites=has?favorites.filter(p=>p!==path):favorites.concat(path);return {ok:true,favorites:window.fixtureCfg.model_favorites,favorite:!has};}
        if(method === 'open_gallery_resource')return {ok:true,direct:!!args[0].modelId,msg:'fixture resource'};
        if(method === 'get_window_appearance')return window.fixtureAppearance||{};
        if (method === 'get_config') return {...window.fixtureCfg};
        if (method === 'save_config') { if(window.fixtureSaveFail || (window.fixtureListSaveFail && 'model_list_size' in args[0]))return false; Object.assign(window.fixtureCfg, args[0]); localStorage.setItem(key, JSON.stringify(window.fixtureCfg)); return true; }
        if (method === 'get_local_fonts') return {ok:true,fonts:['Segoe UI','Microsoft YaHei UI','微软雅黑']};
        if (method === 'get_data_storage_info') return {current:'D:\\CFT',default:'D:\\CFT',suggested:'D:\\Profile\\CFTData',warning:''};
        if (method === 'migrate_data_storage') return {ok:true,msg:'fixture migration'};
        if (method === 'open_in_browser') return {ok:true,msg:'fixture browser'};
        if (method === 'get_folders') {
          if (window.fixtureFolderMode === 'error') throw new Error('fixture folder failure');
          if (window.fixtureFolderMode === 'empty') return JSON.stringify({root:'',tree:[]});
          const tree = Array.from({length:80}, (_,i) => ({name: '分类 '+i, path:'分类 '+i, children:[{name:'风格 <script> & "中文" '+i, path:'分类 '+i+'/风格 <script> & "中文" '+i, children:[]}]}));
          if(window.fixtureFolderDelay) await new Promise(r=>setTimeout(r,window.fixtureFolderDelay));
          return JSON.stringify({root:'D:\\AI\\models',tree,hidden:window.fixtureCfg.hidden_model_folders||[],show_root:window.fixtureCfg.show_root_models!==false});
        }
        if (method === 'save_folders') {if(window.fixtureFolderSaveError)return false;window.fixtureCfg.hidden_model_folders=args[0];window.fixtureCfg.show_root_models=args[1];return true;}
        if (method === 'get_download_history') return {items:window.fixtureHistory,error:''};
        if (method === 'get_history_thumbnail' && window.fixtureHistoryThumbs?.[args[0]])return window.fixtureHistoryThumbs[args[0]];
        if (method === 'get_history_thumbnail') return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0x0AAAAASUVORK5CYII=';
        if (method === 'history_move_to') { const row=window.fixtureHistory.find(r=>r.id===args[0]);row.dest_dir=args[1];row.file_path=args[1]+'\\'+row.filename;return {ok:true,msg:'fixture move'}; }
        if ((method === 'get_history_detail' || method === 'get_model_detail') && window.fixtureDetail) return JSON.stringify({...window.fixtureDetail,path:args[0]});
        if(method==='get_gallery_cached')return typeof window.fixtureWarmGallery==='function'?window.fixtureWarmGallery(...args):(window.fixtureWarmGallery||{});
        if(method==='get_gallery_image')return {ok:true,b64:window.fixtureCoverB64,mime:'image/png',width:600,height:900,original_available:true,...(window.fixtureOriginalMetadata||{})};
        if(method==='get_gallery_metadata')return window.fixtureOnlineMetadata||{};
        if(method==='copy_gallery_image')return {ok:true,msg:'当前图片已复制（fixture）'};
        if(method==='save_gallery_image')return {ok:true,msg:'已保存原图片（fixture）'};
        if (method === 'get_history_detail' || method === 'get_model_detail') return JSON.stringify({ok:true,path:method==='get_history_detail'?(window.fixtureHistory.find(r=>r.id===args[0])?.file_path||args[0]):args[0],name:'示例模型',base:'SDXL',ver:'v1.2',size:1048576,covers:[],info:{name:'示例模型',type:'LoRA',baseModel:'SDXL',trainedWords:['soft light'],description:'这是隔离测试数据，不包含真实模型。',version:{name:'v1.2'}}});
        if (method === 'get_tasks') return window.fixtureTasks;
        if(method==='rp_identify_model'){if(window.fixtureRpReject)return {started:false,msg:'fixture busy'};window.fixtureRpPath=args[0];window.fixtureRpPoll=0;return {started:true,path:args[0]};}
        if(method==='rp_state' && window.fixtureRpPath){window.fixtureRpPoll++;return {running:window.fixtureRpPoll<2,path:window.fixtureRpPath,scope:'single',progress:window.fixtureRpPoll<2?45:100,msg:'正在计算哈希'};}
        if(method==='rp_get_rows' && window.fixtureRpPath)return [{path:window.fixtureRpPath,status:window.fixtureRpPoll>=2?'成功':'反查中',model:'Fixture identified model'}];
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
    const sidebar = await page.locator('.nav-wrap').boundingBox();
    const content = await page.locator('.content').boundingBox();
    assert.equal(sidebar.x,0); assert(content.x >= sidebar.width); ok('左侧导航与主内容左右分区');
    assert.equal(await page.locator('.nav-tab .ic').count(),7); ok('七个页面导航图标完整');
    assert.equal(await page.locator('#dlPauseSel .ic').isVisible(),true); ok('经典主题不再隐藏已有图标');
    const logoThemes = ['dark','dark_purple','dark_blue','dark_green','dark_red','dark_graphite','dark_pink','dark_rose','light','light_blue','light_pink','light_green','modern','metro'];
    for (const theme of logoThemes) {
      const logo=await page.evaluate(t=>{
        document.documentElement.dataset.theme=t;
        state.cfg.theme=t;state.cfg.custom_accent_enabled=true;state.cfg.custom_accent='#ff00aa';state.cfg.ui_corners='square';applyUiAppearance();
        const cs=getComputedStyle(document.querySelector('.nav-logo'));
        return {background:cs.backgroundColor,radius:cs.borderRadius,border:cs.borderWidth,shadow:cs.boxShadow,fit:getComputedStyle(document.querySelector('.nav-logo img')).objectFit};
      },theme);
      assert.equal(logo.background,'rgba(0, 0, 0, 0)');assert.equal(logo.radius,'50%');assert.equal(logo.border,'0px');assert.equal(logo.shadow,'none');assert.equal(logo.fit,'contain');
      ok(theme+' 圆形 Logo 无方形底色');
    }
    await page.evaluate(()=>{state.cfg.theme='dark_graphite';state.cfg.custom_accent_enabled=false;state.cfg.ui_corners='theme';document.documentElement.dataset.theme='dark_graphite';applyUiAppearance();});
    await page.locator('#toggleSidebar').click();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.sidebar),'collapsed');
    await page.reload(); await page.waitForFunction(()=>window.__ready);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.sidebar),'collapsed');
    await page.locator('#toggleSidebar').click(); ok('导航收起状态可记忆');
    await page.locator('.nav-tab[data-page="settings"]').click();
    assert.equal(await page.locator('.settings-category:visible').count(),1);
    assert.equal(await page.locator('#settings-general').isVisible(),true); ok('设置默认只显示常用分类');
    const footerInitial=await page.locator('#settingsActions').boundingBox();
    await page.evaluate(()=>document.querySelector('.content').scrollTop=2000);
    const footerScrolled=await page.locator('#settingsActions').boundingBox();
    assert(Math.abs(footerInitial.y-footerScrolled.y)<1 && Math.abs(footerInitial.y+footerInitial.height-820)<2); ok('四个设置动作始终置底');
    const actionCenter=await page.locator('#settingsActions').evaluate(el=>{const first=el.firstElementChild.getBoundingClientRect(),last=el.lastElementChild.getBoundingClientRect(),bar=el.getBoundingClientRect();return Math.abs((first.x+last.right)/2-(bar.x+bar.width/2))});
    assert(actionCenter<3);ok('设置底栏四个动作居中');
    await page.evaluate(()=>document.querySelector('.content').scrollTop=0);

    await page.locator('#settingsSearch').fill('代理');
    assert.equal(await page.locator('#settings-network').isVisible(),true);
    assert((await page.locator('.setting-row:visible').count())>=2); ok('跨分类搜索设置');
    await page.locator('#settingsSearch').fill('缓存'); assert.equal(await page.locator('#btnCleanImgCache').isVisible(),true); ok('维护功能也可搜索');
    await page.locator('#settingsSearch').fill('xyz-not-present'); assert.equal(await page.locator('#settingsEmpty').isVisible(),true); ok('设置搜索无结果说明');
    await page.locator('[data-settings-category="organize"]').click();
    assert.equal(await page.locator('.organize-guide').isVisible(),true);
    assert((await page.locator('.organize-guide').innerText()).includes('第一条')); ok('分类规则旁有流程与匹配说明');
    await page.locator('#organizeRules').fill('test rule original -> 原始规则');
    await page.locator('[data-settings-category="general"]').click();
    await page.locator('[data-settings-category="organize"]').click();
    assert.equal(await page.locator('#organizeRules').inputValue(),'test rule original -> 原始规则'); ok('切换设置分类不丢未保存输入');
    await page.locator('#insertRuleExample').click();
    assert((await page.locator('#organizeRules').inputValue()).startsWith('test rule original')); ok('插入示例不覆盖用户规则');
    await page.locator('#organizeRules').fill('bad rule without arrow');
    const savesBefore = await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='save_config').length);
    await page.locator('#btnSaveSettings').click();
    assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='save_config').length),savesBefore);
    assert((await page.locator('#ruleValidation').innerText()).includes('第 1 行')); ok('无效规则阻止静默丢失与保存');
    await page.locator('#organizeRules').fill('水彩， watercolor -> 水彩风格');
    await (await settingControl('organize_mode')).selectOption('rules');
    await page.locator('#btnSaveSettings').click();
    await page.waitForFunction(()=>window.fixtureCfg.organize_rules?.length===1);
    assert.equal(await page.evaluate(()=>window.fixtureCfg.organize_rules[0].keywords.length),2);
    assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='mm_organize').length),0); ok('规则支持中文逗号，保存不会移动模型');
    const keys=await page.evaluate(()=>Array.from(document.querySelectorAll('#settingsForm [data-key]')).map(e=>e.dataset.key));
    assert.equal(keys.length,new Set(keys).size); ok('所有设置字段唯一，隐藏页不重复提交');
    await page.locator('.nav-tab[data-page="dlmanager"]').click();
    await page.evaluate(()=>window.fixtureHistory=Array.from({length:135},(_,i)=>({id:'history-'+i,filename:'history_'+String(i).padStart(3,'0')+'.safetensors',dest_dir:'D:\\AI\\models',status:i%3===0?'error':i%3===1?'done':'canceled',total:1048576,finished_at:i===134?null:1791000000-i,modelName:'示例模型 '+i,error:i%3===0?'fixture failure':''})));
    await page.locator('#dlHistoryTab').click();
    await page.waitForFunction(()=>document.querySelector('#dlHistoryTab').dataset.count==='135');
    assert.equal(await page.locator('#dlHistoryTable tbody tr').count(),100);
    assert.equal(await page.locator('#dlQueuePanel').isVisible(),false); ok('任务队列与下载历史分离');
    await page.locator('#historyNext').click(); assert.equal(await page.locator('#dlHistoryTable tbody tr').count(),35);
    assert((await page.locator('#dlHistoryTable').innerText()).includes('时间未记录')); ok('历史分页与旧记录未知时间');
    await page.locator('#dlHistorySearch').fill('history_004');
    assert.equal(await page.locator('#dlHistoryTable tbody tr').count(),1);
    await page.locator('[data-history-open]').click();
    const openCall=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='open_in_folder').at(-1));
    assert.equal(openCall.args.length,1); ok('历史搜索与打开目录使用现有 API');
    await page.evaluate(()=>{
      const row=window.fixtureHistory.find(r=>r.id==='history-4');
      Object.assign(row,{file_exists:true,file_path:'D:\\AI\\models\\Moved\\history_004.safetensors',dest_dir:'D:\\AI\\models\\Moved',model_url:'https://civitai.com/models/123',cached_thumb:true});
      renderDownloadHistory();
    });
    await page.locator('[data-history-thumb] img').waitFor(); ok('历史封面来自独立缓存 API');
    await page.locator('[data-history-open]').click();
    assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='open_in_folder').at(-1))).args[0],'D:\\AI\\models\\Moved\\history_004.safetensors'); ok('历史打开目录使用移动后的实际文件');
    await page.locator('[data-history-site]').click();
    assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='open_url').at(-1))).args[0],'https://civitai.com/models/123'); ok('历史可打开 C 站公共主页');
    await page.locator('[data-history-save]').click(); await page.locator('#fpOk').click();
    await page.waitForFunction(()=>window.fixtureCalls.some(c=>c.method==='history_move_to')); ok('历史保存到使用独立记录 ID');
    await page.locator('[data-history-info]').click();
    await page.locator('#dFavorite').waitFor();
    assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='get_history_detail').at(-1))).args[0],'history-4'); ok('历史信息在模型管理右栏显示');
    await page.locator('.nav-tab[data-page="dlmanager"]').click();
    await page.locator('#dlHistoryTab').click();
    await page.locator('#dlHistoryTable tbody .c-file').dblclick();
    await page.locator('#dFavorite').waitFor();
    assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='get_history_detail').at(-1))).args[0],'history-4');ok('双击下载历史直接进入模型信息');
    await page.locator('.nav-tab[data-page="dlmanager"]').click();await page.locator('#dlHistoryTab').click();
    await page.locator('#dlHistorySearch').fill('不存在的模型'); assert((await page.locator('#dlHistoryTable').innerText()).includes('没有匹配')); ok('历史空结果提示');
    await page.locator('#dlHistorySearch').fill('');
    await page.locator('#dlQueueTab').click();
    await page.locator('.nav-tab[data-page="models"]').click();
    assert.equal(await page.locator('#detailMask').isVisible(),true);
    assert.equal(await page.locator('.inspector-placeholder').isVisible(),true);
    await page.waitForTimeout(800);
    await page.evaluate(()=>{
      state.models=state.display=Array.from({length:8},(_,i)=>({path:'D:\\AI\\models\\fixture'+i+'.safetensors',name:'样例模型 '+i,type:'LoRA',base:'SDXL',ver:'v1',size:1048576}));
      state.mmView='masonry';renderMm();
    });
    await page.locator('.ms-card').first().waitFor();
    await page.locator('#mmViewMasonry').hover();await page.locator('#mmImageSizeControl').waitFor({state:'visible'});
    await page.locator('#mmImageSize').fill('320');await page.locator('#mmImageSize').dispatchEvent('input');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--model-card-width').trim()),'320px');ok('瀑布流图片大小滑杆生效');
    const zoomBefore=await page.evaluate(()=>state.cfg.ui_zoom);
    await page.locator('#mmMasonry').hover();await page.keyboard.down('Alt');await page.mouse.wheel(0,100);await page.keyboard.up('Alt');
    assert.equal(await page.evaluate(()=>state.cfg.masonry_card_width),300);
    assert.equal(await page.evaluate(()=>state.cfg.ui_zoom),zoomBefore);ok('瀑布流 Alt 滚轮只调整图片，不缩放整个界面');
    await page.keyboard.down('Control');await page.mouse.wheel(0,100);await page.keyboard.up('Control');
    assert.equal(await page.evaluate(()=>state.cfg.ui_zoom),zoomBefore-5);assert.equal(await page.evaluate(()=>state.cfg.masonry_card_width),300);ok('瀑布流 Ctrl 滚轮保留全局缩放，不再改变图片');
    await page.evaluate(()=>applyZoom(100));
    await page.evaluate(()=>setMasonrySize(220,true));await page.waitForTimeout(450);
    const beforeCards=await page.locator('.ms-card').evaluateAll(cards=>cards.map(c=>{const b=c.getBoundingClientRect();return [b.x,b.y,b.width,b.height]}));
    const beforeDetail = await page.locator('.content').boundingBox();
    await page.evaluate(()=>showModelDetail('D:\\AI\\models\\fixture.safetensors'));
    assert.equal((await page.locator('.content').boundingBox()).width,beforeDetail.width); ok('详情栏常驻，打开模型不改变浏览区宽度');
    assert.deepEqual(await page.locator('.ms-card').evaluateAll(cards=>cards.map(c=>{const b=c.getBoundingClientRect();return [b.x,b.y,b.width,b.height]})),beforeCards);ok('打开详情后瀑布流各模型坐标不变');
    await page.evaluate(()=>closeDetail());
    assert.equal(await page.locator('.inspector-placeholder').isVisible(),true); ok('关闭模型信息不收起右栏');
    await page.evaluate(()=>showModelDetail('D:\\AI\\models\\fixture.safetensors'));
    await page.locator('#detailMask').waitFor({state:'visible'});
    const drawer=await page.locator('#detailMask').boundingBox();
    assert(Math.abs(drawer.x+drawer.width-1280)<2 && drawer.width<=420);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#detailPanel .dt-body')).display),'block'); ok('模型详情在右侧抽屉中显示');
    await page.locator('.nav-tab[data-page="dlmanager"]').click(); assert.equal(await page.locator('#detailMask').isVisible(),false); ok('换页关闭模型详情，不遮挡其他页面');
    await page.evaluate(() => { window.fpResult = null; pickFolderModal().then(p => window.fpResult = p); });
    await page.locator('.folder-picker').waitFor();
    assert.equal(await page.locator('.fp-item').count(),161); ok('161 个目录显示');
    await page.locator('[data-fold]').first().click();
    assert.equal(await page.locator('.fp-item').count(),1); ok('根目录可折叠整个目录树');
    await page.locator('#fpSearch').fill('分类 1');
    assert((await page.locator('.fp-item').count())>1); ok('搜索可找到折叠目录中的子项');
    await page.locator('#fpSearch').fill('');
    await page.locator('[data-fold]').first().click();
    assert.equal(await page.locator('.fp-item').count(),161); ok('清空搜索保留折叠状态且可以展开');
    assert.equal(await page.locator('#fpShowPaths').isChecked(),false);
    assert.equal(await page.locator('.fp-path').first().isVisible(),false);ok('目录选择器默认只显示名字');
    await page.locator('#fpShowPaths').check();assert.equal(await page.locator('.fp-path').first().isVisible(),true);ok('详细路径有独立开关');
    await page.locator('#fpShowPaths').uncheck();
    await page.locator('[data-favorite]').nth(1).click();
    assert.equal(await page.locator('.fp-favorite-chip').innerText(),'分类 0');
    assert.equal(await page.locator('.fp-item').count(),161);ok('收藏胶囊只有文件夹名且原目录不消失');
    assert.equal(await page.locator('[data-favorite]').nth(1).getAttribute('aria-pressed'),'true');
    assert.notEqual(await page.locator('[data-favorite]').nth(1).locator('.ic').evaluate(e=>getComputedStyle(e).fill),'none');ok('收藏目录尾部显示实心星标');
    await page.locator('#fpList').evaluate(e=>e.scrollTop=e.scrollHeight);
    const pinned=await page.locator('#fpFavorites').boundingBox(),listing=await page.locator('#fpList').boundingBox();assert(pinned.y+pinned.height<=listing.y+1);ok('收藏常驻列表上方，不跟随目录滚走');
    await page.locator('.fp-favorite-chip').click();assert.equal(await page.locator('#fpSelected').innerText(),'分类 0');ok('收藏胶囊可以选择下载位置');
    await page.locator('[data-fold]').first().click();await page.locator('#fpCancel').click();
    await page.reload();await page.waitForFunction(()=>window.__ready);
    await page.evaluate(()=>{window.fpResult=null;pickFolderModal().then(p=>window.fpResult=p)});await page.locator('.folder-picker').waitFor();
    assert.equal(await page.locator('.fp-item').count(),1);assert.equal(await page.locator('.fp-favorite-chip').count(),1);ok('重启后仍记住收藏与折叠');
    await page.locator('[data-fold]').first().click();
    await page.locator('[data-favorite]').nth(1).click();assert.equal(await page.locator('.fp-favorite-chip').count(),0);ok('取消收藏不删除目录');
    for (const viewport of [{width:800,height:600},{width:1280,height:820},{width:1920,height:1080}]) {
      await page.setViewportSize(viewport);
      for (const zoom of [60,100,150,200]) {
        await page.evaluate(z => applyZoom(z), zoom);
        const box = await page.locator('.folder-picker').boundingBox();
        const button = await page.locator('#fpOk').boundingBox();
        const list = await page.locator('#fpList').boundingBox();
        assert(box.x >= 0 && box.y >= 0 && box.x+box.width <= viewport.width+1 && box.y+box.height <= viewport.height+1, JSON.stringify({viewport,zoom,box}));
        assert(button.y+button.height <= box.y+box.height && button.x+button.width <= box.x+box.width && list.height >= 32, JSON.stringify({viewport,zoom,box,button,list}));
        const side=await page.locator('.nav-wrap').boundingBox();
        const main=await page.locator('.content').boundingBox();
        assert(side.x===0 && side.y===0 && side.height<=viewport.height+1 && main.x>=side.width-1 && main.width>100 && main.x+main.width<=viewport.width+1,JSON.stringify({viewport,zoom,side,main}));
        ok(`窗口 ${viewport.width}x${viewport.height} 缩放 ${zoom}% 无越界`);
      }
    }
    await page.setViewportSize({width:1280,height:820});
    await page.evaluate(() => applyZoom(100));
    await page.locator('#fpSearch').fill('风格 <script> & "中文" 23');
    assert.equal(await page.locator('.fp-item').count(),1);
    assert.equal(await page.locator('#fpList script').count(),0); ok('分类搜索与 HTML 转义');
    await page.locator('.fp-item').click();
    assert((await page.locator('#fpSelected').innerText()).includes('中文')); ok('完整选中路径常驻');
    await page.locator('#fpCancel').click();
    await page.waitForFunction(() => window.fpResult === ''); ok('取消解析 Promise');
    for (const action of ['Escape','mask','confirm']) {
      await page.evaluate(() => {window.fpResult=null; pickFolderModal().then(p=>window.fpResult=p)});
      await page.locator('.folder-picker').waitFor();
      if (action==='Escape') await page.keyboard.press('Escape');
      if (action==='mask') await page.mouse.click(4,4);
      if (action==='confirm') await page.locator('#fpOk').click();
      await page.waitForFunction(() => window.fpResult !== null);
      assert.equal(await page.evaluate(()=>window.fpResult), action==='confirm'?'D:\\AI\\models':''); ok(action+' 正常返回');
    }
    await page.evaluate(() => {window.fpResult=null; pickFolderModal().then(p=>window.fpResult=p)});
    await page.locator('.folder-picker').waitFor();
    await page.locator('#fpList').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.fpResult !== null);
    assert.equal(await page.evaluate(()=>window.fpResult),'D:\\AI\\models\\分类 0'); ok('键盘选择');
    await page.evaluate(() => {window.fpResult=null; pickFolderModal().then(p=>window.fpResult=p)});
    await page.locator('.folder-picker').waitFor();
    const dragStart=await page.locator('.folder-picker').boundingBox();
    await page.mouse.move(dragStart.x+dragStart.width-3,dragStart.y+dragStart.height-3);
    await page.mouse.down(); await page.mouse.move(dragStart.x+dragStart.width-70,dragStart.y+dragStart.height-50,{steps:10}); await page.mouse.up();
    const dragged=await page.locator('.folder-picker').boundingBox();
    assert(dragged.width < dragStart.width-30 && dragged.height < dragStart.height-20,JSON.stringify({dragStart,dragged})); ok('真实鼠标拖动右下角调整尺寸');
    await page.evaluate(() => {const d=document.querySelector('.folder-picker');d.style.width='700px';d.style.height='500px'});
    await page.locator('#fpCancel').click();
    await page.reload(); await page.waitForFunction(()=>window.__ready);
    await page.evaluate(() => {window.fpResult=null; pickFolderModal().then(p=>window.fpResult=p)});
    await page.locator('.folder-picker').waitFor();
    const remembered=await page.locator('.folder-picker').boundingBox();
    assert(Math.abs(remembered.width-700)<2 && Math.abs(remembered.height-500)<2, JSON.stringify(remembered)); ok('重启记忆手动尺寸');
    await page.locator('#fpReset').click();
    const reset=await page.locator('.folder-picker').boundingBox(); assert(Math.abs(reset.width-1280*.72)<2); ok('重置分类尺寸');
    await page.locator('#fpCancel').click();
    await page.evaluate(() => {state.cfg.unsaved_fixture='do-not-save';});
    await page.locator('.nav-tab[data-page="settings"]').click();
    await (await settingControl("show_file_paths")).uncheck();
    await page.evaluate(()=>{window.fpResult=null;pickFolderModal().then(p=>window.fpResult=p)});
    await page.locator('.folder-picker').waitFor();
    assert.equal(await page.locator('.fp-path').first().isVisible(),false);
    assert.equal(await page.locator('#fpSelected').isVisible(),true); ok('隐藏路径但目标仍可辨认');
    await page.locator('#fpSearch').fill('AI'); assert.equal(await page.locator('.fp-item').count(),161); ok('隐藏路径仍可搜索路径');
    await page.locator('#fpCancel').click();
    await page.reload(); await page.waitForFunction(()=>window.__ready);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.showPaths),'false');
    assert.equal(await page.evaluate(()=>window.fixtureCfg.unsaved_fixture),undefined); ok('外观持久化且不顺带提交未保存设置');
    await page.locator('.nav-tab[data-page="settings"]').click();
    await settingControl('ui_font');await page.locator('#fontChoice').click();
    await page.locator('.font-option').filter({hasText:/^Segoe UI$/}).click();
    assert((await page.locator('.font-preview').evaluate(e=>getComputedStyle(e).fontFamily)).includes('Segoe UI'));ok('本地字体选择立即应用到预览');
    assert((await page.locator('#fontChoice span').first().evaluate(e=>getComputedStyle(e).fontFamily)).includes('Segoe UI'));ok('字体选择按钮使用当前字体显示名称');
    await page.locator('#fontChoice').click();await page.screenshot({path:path.join(shots,'font-name-preview-v2.5.0.png')});await page.locator('#fontChoice').press('Escape');
    for(const zoom of [80,150]){
      await page.evaluate(z=>applyZoom(z),zoom);await page.locator('#fontChoice').click();
      const box=await page.locator('#fontMenu').boundingBox(),choice=await page.locator('#fontChoice').boundingBox();
      assert(box.x>=0 && box.x+box.width<=1282 && box.y>=0 && box.y+box.height<=822);assert(Math.abs(box.x-choice.x)<2);ok(zoom+'% 缩放下字体菜单与按钮对齐并保持在窗口内');
      await page.locator('#fontChoice').press('Escape');
    }
    await page.evaluate(()=>applyZoom(100));
    await page.locator('#fontSearch').fill('YaHei');assert.equal(await page.locator('.font-option').count(),2);ok('自绘字体菜单按名称过滤');
    assert((await page.locator('.font-option').filter({hasText:'Microsoft YaHei UI'}).evaluate(e=>getComputedStyle(e).fontFamily)).startsWith('"Microsoft YaHei UI"'));ok('下拉菜单每个字体名以自身字体预览');
    await page.locator('#fontSearch').press('End');await page.locator('#fontSearch').press('Enter');
    assert.equal(await page.evaluate(()=>state.cfg.ui_font),'Microsoft YaHei UI');assert.equal(await page.locator('#fontMenu').count(),0);ok('字体菜单支持键盘选择并关闭');
    await page.locator('#fontSearch').fill('');await page.locator('#fontChoice').click();await page.locator('#fontChoice').click();
    await page.locator('.font-option').filter({hasText:/^Segoe UI$/}).click();
    await page.evaluate(()=>{localFontFamilies=Array.from({length:730},(_,i)=>'Preview Font '+String(i).padStart(3,'0'));openFontMenu();});
    assert((await page.locator('.font-option').count())<30);ok('730 字体菜单只渲染可见行');
    await page.locator('#fontChoice').press('End');assert((await page.locator('.font-option.focused').innerText()).includes('729'));ok('虚拟字体菜单键盘可到达最后一项');
    await page.locator('#fontChoice').press('Escape');assert.equal(await page.locator('#fontMenu').count(),0);ok('Escape 关闭字体菜单');
    const typeBefore=await page.evaluate(()=>({font:parseFloat(getComputedStyle(document.querySelector('.setting-copy label')).fontSize),icon:parseFloat(getComputedStyle(document.querySelector('.nav-tab .ic')).width),zoom:state.cfg.ui_zoom,image:state.cfg.masonry_card_width,width:document.querySelector('.content').getBoundingClientRect().width}));
    for(const [preset,scale] of [['small',.9],['standard',1],['large',1.1],['xlarge',1.2],['huge',1.3]]){
      await (await settingControl('ui_text_size')).selectOption(preset);
      const actual=await page.evaluate(()=>({font:parseFloat(getComputedStyle(document.querySelector('.setting-copy label')).fontSize),icon:parseFloat(getComputedStyle(document.querySelector('.nav-tab .ic')).width),zoom:state.cfg.ui_zoom,image:state.cfg.masonry_card_width,width:document.querySelector('.content').getBoundingClientRect().width}));
      assert(Math.abs(actual.font-typeBefore.font*scale)<.05,JSON.stringify({preset,typeBefore,actual,scale}));assert(Math.abs(actual.icon-typeBefore.icon*scale)<.05);assert.equal(actual.zoom,typeBefore.zoom);assert.equal(actual.image,typeBefore.image);assert.equal(actual.width,typeBefore.width);ok(preset+' 字号档只调文字与图标，保持全局 zoom、图片及布局宽度');
    }
    await page.screenshot({path:path.join(shots,'typography-large-v2.5.0.png'),fullPage:true});
    await (await settingControl('window_appearance')).selectOption('mica');
    await page.waitForFunction(()=>window.fixtureCalls.some(c=>c.method==='set_window_appearance' && c.args[0].mode==='mica'));ok('Mica 外观请求原生 API');
    await (await settingControl('window_appearance')).selectOption('external');
    assert((await page.locator('#setting-window_appearance-help').innerText()).includes('CivitaiFreeToolWeb.exe'));ok('外部材质旁提供 Mica For Everyone 进程规则介绍');
    await (await settingControl('ui_text_size')).selectOption('standard');
    await page.locator('#fontSearch').fill('');await page.reload();await page.waitForFunction(()=>window.__ready);
    assert((await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--font'))).includes('Segoe UI'));ok('本地字体跨重启保存');
    assert.equal(await page.evaluate(()=>state.cfg.masonry_card_width),220);ok('图片大小跨重启保存');
    assert.equal(await page.evaluate(()=>state.cfg.window_appearance),'external');ok('窗口外观跨重启保存');
    await page.locator('.nav-tab[data-page="settings"]').click();await (await settingControl('window_appearance')).selectOption('theme');
    await page.locator('.nav-tab[data-page="settings"]').click();
    await page.locator('[data-settings-category="general"]').click();
    assert.equal(await page.locator('#storageCurrent').innerText(),'当前：D:\\CFT');
    await page.locator('#storageSuggested').click();assert.equal(await page.locator('#storageNewPath').inputValue(),'D:\\Profile\\CFTData');ok('数据目录提供独立个人目录选项');
    page.once('dialog',d=>d.accept());await page.locator('#storageMigrate').click();
    await page.waitForFunction(()=>window.fixtureCalls.some(c=>c.method==='migrate_data_storage'));ok('迁移需明确确认且调用专用 API');
    await page.locator('[data-settings-category="advanced"]').click();
    await page.locator('#openBrowserPage').click();assert.equal((await page.evaluate(()=>window.fixtureCalls.at(-1))).method,'open_in_browser');ok('可主动用浏览器打开软件页面');
    assert.equal(await page.locator('[data-key="browser_fallback_enabled"]').isChecked(),true);
    assert.equal(await page.locator('[data-key="ui_mode"]').inputValue(),'window');ok('原生窗口仍默认，自动浏览器兜底开启');
    for(const viewport of [{width:980,height:640},{width:1280,height:820}]) {
      await page.setViewportSize(viewport);
      for(const zoom of [100,150]) {
        await page.evaluate(z=>applyZoom(z),zoom);
        const b=await page.locator('#settingsActions').boundingBox();assert(Math.abs(b.y+b.height-viewport.height)<2 && b.x>=0 && b.x+b.width<=viewport.width+2);
        ok('设置底栏适配 '+viewport.width+' / '+zoom+'%');
      }
    }
    await page.setViewportSize({width:1280,height:820});await page.evaluate(()=>applyZoom(100));
    await (await settingControl('theme')).selectOption('dark_rose');
    const rose=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    assert.equal(rose,'#160b18');ok('绯夜是独立暗玫红主题');
    await (await settingControl("show_file_paths")).check();
    await (await settingControl("custom_accent_enabled")).check();
    await (await settingControl("custom_accent")).fill('#ffffff');
    await (await settingControl("custom_accent")).dispatchEvent('change');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()),'#ffffff');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--primary-fg').trim()),'#000000'); ok('自选强调色和可读前景');
    await (await settingControl("custom_accent")).fill('#000000');
    await (await settingControl("custom_accent")).dispatchEvent('change');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--primary-fg').trim()),'#ffffff'); ok('暗强调色配白字');
    await (await settingControl("ui_density")).selectOption('compact');
    await (await settingControl("ui_corners")).selectOption('square');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#dlTable td')).paddingTop),'4px');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#dlStartAll')).borderRadius),'0px'); ok('密度与圆角生效');
    for (const theme of ['dark','light','modern','metro','dark_pink','dark_graphite']) {
      await (await settingControl("theme")).selectOption(theme);
      assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()),'#000000'); ok(theme+' 兼容自选色');
    }
    await page.locator('#resetAppearance').click();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.customAccent),'false');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()),'#83b8ff'); ok('恢复当前主题默认外观');
    await (await settingControl("theme")).selectOption('dark_pink');
    await page.locator('#btnSaveSettings').click();
    await page.reload(); await page.waitForFunction(()=>window.__ready);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark_pink'); ok('新主题保存后恢复');
    await page.locator('.nav-tab[data-page="settings"]').click();
    await (await settingControl("zebra_rows")).check();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.zebra),'true'); ok('斑马纹默认状态与实际一致');
    await (await settingControl("zebra_rows")).uncheck();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.zebra),'false'); ok('斑马纹可关闭');
    await (await settingControl("pointer_effects")).selectOption('trail');
    await page.mouse.move(430,210); await page.mouse.down(); await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector('#pointerEffects')?.dataset.running==='true');
    await page.waitForTimeout(850);
    assert.equal(await page.locator('#pointerEffects').getAttribute('data-running'),'false'); ok('拖尾点击特效空闲自动停止');
    await (await settingControl("pointer_effects")).selectOption('off');
    await page.mouse.click(500,210);
    assert.equal(await page.locator('#pointerEffects').isVisible(),false); ok('关闭特效没有画布遮挡');
    await page.evaluate(()=>{state.cfg.custom_accent_enabled=false;});
    for (const theme of logoThemes) {
      await (await settingControl("theme")).selectOption(theme);
      const colors=await page.evaluate(()=>['#dlStartAll','[data-proxy="mmScan"]'].map(selector=>{const c=getComputedStyle(document.querySelector(selector));return [c.color,c.backgroundColor]}));
      for(const [fg,bg] of colors) {
        assert.notEqual(fg,bg);
        const lum=value=>{const c=value.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4));return .2126*c[0]+.7152*c[1]+.0722*c[2]};
        const a=lum(fg),b=lum(bg);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,theme+' contrast');
      }
      ok(theme+' 关键按钮有强调色和可读文字');
    }
    await page.locator('.nav-tab[data-page="dlmanager"]').click();await page.locator('#dlQueueTab').click();
    await page.evaluate(()=>{window.fixtureTasks[0].status='done';dlRefresh();});
    await page.locator('[data-archive-task]').waitFor();
    const statusFit=await page.locator('[data-archive-task]').evaluate(e=>{const b=e.getBoundingClientRect(),td=e.closest('td').getBoundingClientRect();return b.right<=td.right+1 && b.left>=td.left});assert(statusFit);ok('已完成与移入历史操作在状态列中完整显示');
    assert.equal(await page.locator('.dest-picker .ic').count(),2);ok('保存到使用目录图标和下拉胶囊按钮');
    await page.evaluate(()=>{window.fixtureTasks[0].status='pending';dlRefresh();});
    for (const mode of ['empty','error']) {
      await page.evaluate(m=>window.fixtureFolderMode=m,mode);
      if(mode==='empty') {
        await page.evaluate(()=>{window.fpResult=null;pickFolderModal().then(p=>window.fpResult=p)});
        await page.locator('.folder-picker').waitFor(); assert.equal(await page.locator('#fpOk').isDisabled(),true);
        await page.locator('#fpCancel').click();
      } else assert.equal(await page.evaluate(()=>pickFolderModal()),'');
      ok(mode+' 不允许误选');
    }
    await page.evaluate(()=>{window.fixtureFolderMode='normal';state.cfg.theme='dark_graphite';document.documentElement.dataset.theme='dark_graphite';applyUiAppearance();state.cfg.folder_picker_size={};setStatus('就绪 · 示例数据');});
    await page.locator('.nav-tab[data-page="dlmanager"]').click();
    await page.evaluate(()=>{window.fpResult=null;pickFolderModal().then(p=>window.fpResult=p)});
    await page.locator('.folder-picker').waitFor();
    fs.mkdirSync(shots,{recursive:true});
    await page.screenshot({path:path.join(shots,'folder-graphite.png')});
    await page.locator('[data-favorite]').nth(1).click();await page.locator('[data-favorite]').nth(3).click();
    await page.screenshot({path:path.join(shots,'folder-favorites-v2.4.0.png')});
    await page.locator('#fpCancel').click();
    await page.locator('.nav-tab[data-page="settings"]').click();
    await (await settingControl("theme")).selectOption('dark_pink');
    await (await settingControl("custom_accent_enabled")).check();
    await (await settingControl("custom_accent")).fill('#f0a4c5');
    await page.locator('#appearancePreview').scrollIntoViewIfNeeded();
    await page.mouse.move(1270,10); await page.waitForTimeout(350);
    await page.screenshot({path:path.join(shots,'appearance-night-pink.png')});
    await (await settingControl('theme')).selectOption('dark_rose');
    await (await settingControl('custom_accent_enabled')).uncheck();
    await page.locator('#appearancePreview').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(shots,'appearance-rose-v2.4.0.png')});
    await page.locator('[data-settings-category="organize"]').click();
    await page.mouse.move(1270,10);
    await page.screenshot({path:path.join(shots,'settings-organize-workbench.png')});
    await page.locator('.nav-tab[data-page="dlmanager"]').click();
    await page.evaluate(()=>window.fixtureHistory=[
      {id:'preview-1',filename:'SoftPortrait_v1.2.safetensors',modelName:'柔光人像',status:'done',total:150994944,dest_dir:'D:\\AI\\models\\人物',finished_at:1791324000},
      {id:'preview-2',filename:'Watercolor_Landscape_v1.safetensors',modelName:'水彩风景',status:'done',total:128974848,dest_dir:'D:\\AI\\models\\风景',finished_at:1791323000},
      {id:'preview-3',filename:'CinematicTexture_v2.safetensors',modelName:'电影质感',status:'error',total:1073741824,dest_dir:'D:\\AI\\models\\风格',finished_at:1791322000,error:'网络连接中断，可在任务列表重试'},
      {id:'preview-4',filename:'ArchitectureSpace_v1.safetensors',modelName:'建筑空间',status:'canceled',total:335544320,dest_dir:'D:\\AI\\models\\场景',finished_at:1791321000},
      {id:'preview-5',filename:'Ink_Landscape_v1.safetensors',modelName:'东方水墨',status:'done',total:167772160,dest_dir:'D:\\AI\\models\\风格',finished_at:null}
    ]);
    await page.locator('#dlHistoryTab').click();
    await page.waitForFunction(()=>document.querySelector('#dlHistoryTab').dataset.count==='5');
    await page.mouse.move(1270,10);
    await page.waitForTimeout(300);
    await page.screenshot({path:path.join(shots,'download-history-workbench.png')});
    await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=600;canvas.height=900;const g=canvas.getContext('2d');const fill=g.createLinearGradient(0,0,600,900);fill.addColorStop(0,'#32485e');fill.addColorStop(1,'#6783a0');g.fillStyle=fill;g.fillRect(0,0,600,900);g.fillStyle='#ffffff';g.font='32px sans-serif';g.fillText('Gallery preview fixture',70,430);window.fixtureCoverB64=canvas.toDataURL('image/png').split(',')[1];
      window.fixtureDetail={ok:true,name:'gallery.safetensors',info:{name:'画廊模型',type:'LoRA',images:[]},covers:[{b64:window.fixtureCoverB64,meta:{prompt:'watercolor mountains <script>not executed</script>',negativePrompt:'blur',steps:20,cfgScale:7,seed:123,workflow:{nodes:[]}},resources:[{name:'Mountain model',modelId:55,type:'LoRA',version:'v1'}],image_page:'https://civitai.com/images/123',metadata_source:'测试元数据',width:600,height:900},{b64:window.fixtureCoverB64,meta:{},resources:[],metadata_source:'来源未提供'}]};
      switchPage('models');
    });
    await page.evaluate(()=>showModelDetail('D:\\AI\\models\\gallery.safetensors'));
    assert.equal(await page.locator('#dRenameC').isVisible(),true);ok('模型详情直接提供文件名到 C站名称入口');
    await page.evaluate(()=>{window.fixtureOriginalMetadata={meta:{originalSteps:26},metadata_source:'原图 PNG 演示数据'};window.fixtureOnlineMetadata={ok:true,online_metadata:true,meta:{onlineSteps:24},metadata_source:'C站图片接口演示'};});
    await page.locator('#dMain').click();await page.locator('#imageViewer').waitFor();
    await page.waitForFunction(()=>document.querySelector('.iv-generation').textContent.includes('onlineSteps'));assert((await page.locator('.iv-generation').innerText()).includes('originalSteps'));ok('原图和 withMeta 接口元数据加载后实际刷新生成数据');
    const overlay=await page.locator('#imageViewer').evaluate(e=>({background:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter}));assert(overlay.background.includes('0.58'));ok('大图遮罩半透明，模型管理页面保留在后方');
    assert((await page.locator('.iv-generation').innerText()).includes('watercolor mountains'));assert((await page.locator('.iv-generation').innerText()).includes('steps'));assert.equal(await page.locator('#imageViewer script').count(),0);ok('图片点击放大并显示生成参数，提示词只按文本展示');
    await page.locator('[data-iv-copy=prompt]').click();assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='copy_text').at(-1))).args[0],'watercolor mountains <script>not executed</script>');ok('生成数据正面提示词可单独复制');
    await page.locator('[data-iv-copy=all]').click();assert((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='copy_text').at(-1))).args[0].includes('cfgScale'));ok('复制全部包含采样参数与资源列表');
    await page.locator('[data-resource-index]').click();assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='open_gallery_resource').at(-1))).args[0].modelId,55);ok('使用资源可打开对应 C站模型');
    await page.locator('#ivShare').click();assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='copy_text').at(-1))).args[0],'https://civitai.com/images/123');ok('图片工具栏支持复制分享链接');
    assert.equal(await page.locator('#ivReport').count(),0);ok('图片查看器已移除举报功能');
    const centered=await page.locator('.iv-more summary').evaluate(e=>{const a=e.getBoundingClientRect(),b=e.querySelector('svg').getBoundingClientRect();return Math.abs((a.left+a.right-b.left-b.right)/2)<1 && Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<1;});assert(centered);ok('更多图片操作图标水平和垂直居中');
    await page.locator('#ivImage').click({button:'right'});await page.locator('#ivContext').waitFor({state:'visible'});
    assert.equal(await page.locator('#ivContext button').count(),6);ok('图片右键提供复制保存、原图页和生成数据操作');
    await page.locator('#ivContext [data-act=iv_copy]').click();await page.waitForFunction(()=>window.fixtureCalls.some(c=>c.method==='copy_gallery_image'));ok('图片右键复制请求正确类型的原生图片剪贴板 API');
    await page.locator('#ivImage').click();assert.equal(await page.locator('#imageViewer').isVisible(),true);ok('点击图片本身不关闭图片查看器');
    await page.locator('#ivImage').click({button:'right'});await page.keyboard.press('Escape');assert.equal(await page.locator('#ivContext').isVisible(),false);assert.equal(await page.locator('#imageViewer').isVisible(),true);ok('Escape 先关闭图片右键菜单');
    await page.locator('#ivSave').click();assert((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='save_gallery_image').at(-1))).args[0].includes('gallery.safetensors'));ok('图片保存请求指定当前模型与图片索引');
    await page.locator('#ivPlus').click();await page.waitForFunction(()=>imageViewer.zoom===imageViewer.targetZoom);assert((await page.locator('#ivFit').innerText()).includes('120'));ok('图片放大按钮只调整当前图片');
    await page.evaluate(()=>setViewerZoom(3,null,true));
    const panBefore=await page.locator('.iv-image-scroll').evaluate(e=>({x:e.scrollLeft,y:e.scrollTop,w:e.clientWidth,h:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight}));assert(panBefore.sw>panBefore.w && panBefore.sh>panBefore.h);ok('超大图片有可访问的横向和纵向画布，不负溢出截掉边缘');
    const stage=await page.locator('.iv-image-scroll').boundingBox();await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);await page.mouse.down();await page.mouse.move(stage.x+stage.width/2-80,stage.y+stage.height/2-65,{steps:10});await page.mouse.up();
    const panAfter=await page.locator('.iv-image-scroll').evaluate(e=>({x:e.scrollLeft,y:e.scrollTop}));assert(panAfter.x>panBefore.x+60 && panAfter.y>panBefore.y+45,JSON.stringify({panBefore,panAfter,stage,img:await page.locator('#ivImage').boundingBox(),canvas:await page.locator('.iv-image-canvas').evaluate(e=>({w:e.style.width,h:e.style.height,cs:getComputedStyle(e).width,display:getComputedStyle(e).display,box:e.getBoundingClientRect().toJSON(),z:document.documentElement.style.zoom}))}));assert.equal(await page.locator('#imageViewer').isVisible(),true);ok('按住图片可同时拖动横纵显示位置，拖完不误关');
    const frame=await page.locator('.iv-image-scroll').evaluate(e=>{const r=e.getBoundingClientRect(),stage=e.closest('.iv-stage').getBoundingClientRect(),status=document.querySelector('#ivStatus').getBoundingClientRect();return {height:r.height,stage:stage.height,status:status.height,bottom:r.bottom,statusTop:status.top};});assert(frame.height<frame.stage && Math.abs(frame.bottom-frame.statusTop)<2);ok('滚动条固定在图片视口边缘而非跟到大图下面');
    await page.evaluate(()=>setViewerZoom(1,null,true));assert.equal(await page.locator('.iv-image-scroll').evaluate(e=>e.scrollTop),0);ok('适合窗口恢复完整图片并解除拖动偏移');
    await page.screenshot({path:path.join(shots,'image-generation-viewer-v2.6.0.png')});
    await page.keyboard.press('ArrowRight');assert((await page.locator('.iv-generation').innerText()).includes('来源没有记录资源列表'));ok('没有生成数据时明确说明，不编造使用资源');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#imageViewer').count(),0);assert.equal(await page.locator('#dFavorite').isVisible(),true);ok('Escape 仅关闭大图，保留模型详情');
    await page.evaluate(()=>{
      window.fixtureDetail=null;state.models=state.display=Array.from({length:130},(_,i)=>({path:'D:\\AI\\models\\focus'+i+'.safetensors',name:'Model '+i,base:'SDXL',type:'LoRA',size:100}));state.mmView='masonry';window.fixtureScanRows=state.models;renderMm();
      $('#mmFilter').value='不匹配';applyMmFilter();
      historyItems=[{id:'focus-history',file_path:'D:\\AI\\models\\focus115.safetensors',file_exists:true}];window.fixtureHistory=historyItems;
    });
    await page.evaluate(()=>openHistoryModel(historyItems[0]));
    assert.equal(await page.locator('.history-focus').count(),1);assert((await page.locator('.history-focus').getAttribute('data-path')).includes('focus115'));assert.equal(await page.locator('#mmFilter').inputValue(),'');ok('历史信息跳转自动解除阻挡筛选并定位瀑布流对应卡片');
    const focusBox=await page.locator('.history-focus').boundingBox();assert(focusBox.y<820 && focusBox.y+focusBox.height>0);ok('历史跳转定位后目标卡片实际进入可视区');
    await page.evaluate(()=>{state.mmView='list';renderMm();});await page.evaluate(()=>openHistoryModel(historyItems[0]));assert.equal(await page.locator('#mmTable .history-focus').count(),1,JSON.stringify(await page.evaluate(()=>({view:state.mmView,path:detailRow.path,models:state.models.length,display:state.display.length,status:$('#statusText').textContent,row:$('#mmTable tbody tr')?.outerHTML.slice(0,300),focuses:[...document.querySelectorAll('.history-focus')].map(e=>e.outerHTML.slice(0,100))}))));ok('历史定位同时支持模型列表');
    await page.evaluate(()=>{state.cfg.theme='dark_blue';state.cfg.ui_corners='theme';state.cfg.ui_text_size='standard';document.documentElement.dataset.theme='dark_blue';applyUiAppearance();window.fixtureAppearance={integrated:true,maximized:false};syncWindowControls(window.fixtureAppearance);switchPage('dlmanager');});
    const controls=page.locator('#windowControls');assert.equal(await controls.isVisible(),true);
    assert.equal(await controls.locator('button').count(),3);assert.equal(await controls.locator('img').count(),0);ok('窗口仅有三个网页按钮，不重复 Logo 或添加顶栏');
    for(const theme of logoThemes){
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(200);
      const style=await page.evaluate(t=>{document.documentElement.dataset.theme=t;const button=document.querySelector('.window-control');return {bg:getComputedStyle(button).backgroundColor,color:getComputedStyle(button).color,theme:getComputedStyle(document.querySelector('.sidebar-name small')).color,panel:getComputedStyle(document.querySelector('#windowControls')).backgroundColor};},theme);
      assert.equal(style.bg,'rgba(0, 0, 0, 0)');assert.equal(style.panel,'rgba(0, 0, 0, 0)');assert.equal(style.color,style.theme);ok(theme+' 窗口按钮无底色并使用主题次级文字色');
    }
    await page.evaluate(()=>document.documentElement.dataset.theme='dark_blue');
    await page.locator('[data-window-action="maximize"]').click();assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='window_control').at(-1))).args[0],'maximize');ok('窗口按钮通过受限 API 操作，不触发整窗拖动');
    await page.evaluate(()=>syncWindowControls({integrated:true,maximized:true}));assert.equal(await page.locator('[data-window-action="maximize"]').getAttribute('aria-label'),'还原窗口');ok('最大化状态同步还原图标及名称');
    await page.locator('[data-window-action="minimize"]').focus();await page.keyboard.press('Tab');assert(await page.locator('[data-window-action="maximize"]').evaluate(e=>e.matches(':focus-visible')));ok('窗口按钮支持键盘焦点');
    await page.evaluate(()=>{syncWindowControls({integrated:false});});assert.equal(await controls.isVisible(),false);ok('浏览器或系统框架模式不显示重复窗口按钮');
    await page.evaluate(()=>{syncWindowControls({integrated:true});document.documentElement.dataset.nativeMaterial='true';});
    const material=await page.evaluate(()=>({body:getComputedStyle(document.body).backgroundColor,shader:getComputedStyle(document.querySelector('#bg')).display,card:getComputedStyle(document.querySelector('#page-dlmanager>.card')).backgroundColor}));assert.equal(material.body,'rgba(0, 0, 0, 0)');assert.equal(material.shader,'none');assert(material.card.includes('0.55'));ok('材质模式实际清空网页底色和氛围画布，内容面板只保留 55% 主题底色');
    await page.mouse.move(600,450);await page.screenshot({path:path.join(shots,'window-controls-v2.6.3.png')});
    await page.evaluate(()=>{syncWindowControls({integrated:false});document.documentElement.dataset.nativeMaterial='false';});
    await page.evaluate(()=>{syncWindowControls({integrated:true,maximized:false});switchPage('models');state.mmView='masonry';renderMm();});
    const corner=await controls.boundingBox();assert(corner.y<1 && Math.abs(corner.x+corner.width-1280)<1);ok('窗口按钮贴齐顶部右侧，不悬在页面半空');
    const drag=await page.locator('#windowDragSurface').boundingBox();assert(drag.width>600 && drag.height>=16);ok('窗口顶部具有宽拖动区域，不限于 Logo');
    assert.equal(await page.locator('#windowResizeEdges [data-resize-edge]').count(),8);await page.locator('[data-resize-edge=bottom-right]').dispatchEvent('pointerdown',{button:0});assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='window_resize').at(-1))).args[0],'bottom-right');ok('无可见边框仍保留八方向原生调整尺寸');
    await page.evaluate(()=>{window.fixtureAppearance={integrated:true,maximized:true};syncWindowControls(window.fixtureAppearance);});assert.equal(await page.locator('[data-resize-edge=bottom-right]').isVisible(),false);ok('最大化后不出现缩放边缘');
    await page.evaluate(()=>{window.fixtureAppearance={integrated:true,maximized:false};syncWindowControls(window.fixtureAppearance);});
    const modelCard=page.locator('.ms-card').first();await modelCard.click({button:'right'});
    assert.equal(await page.locator('#ctxMenu .ctx-group').count(),3);assert.equal(await page.locator('#ctxMenu [data-act]:visible').count(),5);ok('模型右键仅显示五个常用动作，低频功能按三个用途分组');
    await page.locator('#ctxMenu .ctx-group summary').first().click();assert.equal(await page.locator('#ctxMenu [data-act=copy_cname]').isVisible(),true);ok('复制分组可展开，复制 C站名功能保留');
    await page.locator('#ctxMenu .ctx-group summary').nth(1).click();await page.locator('#ctxMenu [data-act=copy_cname]').waitFor({state:'hidden'});assert.equal(await page.locator('#ctxMenu [data-act=rename_c]').isVisible(),true);assert.equal(await page.locator('#ctxMenu [data-act=copy_cname]').isVisible(),false);ok('改名与整理分组展开时收起其他分组');
    assert.equal(await page.locator('#ctxMenu [data-act]').count(),15);ok('模型右键原有十三项仍保留并添加模型信息及收藏入口');
    await page.locator('#ctxMenu .ctx-group summary').first().click();await page.locator('#ctxMenu [data-act=copy_name]').click();assert((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='copy_text').at(-1))).args[0].includes('Model'));ok('折叠菜单操作仍作用于右键指定的模型');
    await page.evaluate(()=>{state.mmView='list';renderMm();});await page.locator('#mmTable tbody tr[data-path]').first().click({button:'right'});assert.equal(await page.locator('#ctxMenu .ctx-group').count(),3);ok('模型列表和瀑布流共用同一分组右键菜单');
    await page.keyboard.press('Escape');await page.evaluate(()=>$('#ctxMenu').style.display='none');
    await page.evaluate(()=>{applyZoom(150);showModelContextMenu({clientX:1260,clientY:800,preventDefault(){}},state.display[0]);});
    const menuBounds=await page.locator('#ctxMenu').boundingBox();assert(menuBounds.x+menuBounds.width<=1280 && menuBounds.y+menuBounds.height<=820);ok('高缩放及右下角展开菜单仍限制在窗口内');
    await page.evaluate(()=>{applyZoom(100);$('#ctxMenu').style.display='none';});
    await page.screenshot({path:path.join(shots,'window-corner-v2.6.4.png')});
    await page.evaluate(()=>showModelDetail('D:\\AI\\models\\gallery.safetensors'));await page.evaluate(()=>{window.fixtureDetail={ok:true,path:'D:\\AI\\models\\gallery.safetensors',covers:[{b64:window.fixtureCoverB64,meta:{},resources:[]}]};openImageViewer(window.fixtureDetail);});
    await page.locator('#ivImage').waitFor();await page.locator('.iv-image-scroll').click({position:{x:10,y:100}});assert.equal(await page.locator('#imageViewer').count(),0);ok('点击图片两侧黑色空白关闭大图并保留模型详情');
    await page.evaluate(()=>{switchPage('models');mmSetView('masonry');});await page.locator('#mmViewMasonry').hover();await page.locator('#mmImageSizeControl').waitFor({state:'visible'});
    const vertical=await page.locator('#mmImageSize').boundingBox();assert(vertical.height>vertical.width*4);assert.equal(await page.locator('#mmImageSize').getAttribute('aria-orientation'),'vertical');ok('瀑布流按钮悬停展开竖向大小滑条');
    await page.locator('#mmImageSize').focus();await page.keyboard.press('ArrowUp');await page.keyboard.press('Escape');assert.equal(await page.locator('#mmImageSizeControl').isVisible(),false);ok('竖向滑条支持键盘且 Escape 收起不重新打开');
    await page.mouse.move(400,600);assert.equal(await page.locator('#mmImageSizeControl').isVisible(),false);ok('调整滑条不再始终占据模型管理标题行');
    // 三档模型列表：不改变全局缩放或数据；勾选与右侧详情仍可操作。
    await page.evaluate(()=>{state.models=state.models.map((r,i)=>({...r,civitai_name:'C站展示名称 '+i,name:'local_file_'+i+'.safetensors',author:'Demo Author'}));state.display=state.models.slice();mmSetView('list');});
    await page.locator('#mmViewList').hover();await page.locator('#mmListSizeControl').waitFor({state:'visible'});assert.equal(await page.locator('#mmListSize').getAttribute('max'),'3');ok('列表按钮悬停展开三档竖向大小滑条');
    const listDefault=await page.locator('#mmTable tbody tr').first().boundingBox();assert.equal(await page.locator('#mmTable .ml-thumb').first().isVisible(),true);assert.equal(await page.locator('#mmTable .ml-3').first().isVisible(),true);ok('完整默认档保持现有最大样式与封面作者');
    const listAppearance=await page.evaluate(()=>({zoom:state.cfg.ui_zoom,font:state.cfg.ui_text_size,masonry:state.cfg.masonry_card_width}));
    await page.evaluate(()=>{const el=$('#mmListSize');el.value=2;el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#mmTable .ml-thumb').first().isVisible(),false);assert.equal(await page.locator('#mmTable .ml-3').first().isVisible(),false);assert.equal(await page.locator('#mmTable .ml-2').first().isVisible(),true);const listCompact=await page.locator('#mmTable tbody tr').first().boundingBox();assert(listCompact.height<listDefault.height);ok('紧凑档同时去封面作者，保留本地名并降低行高');
    await page.evaluate(()=>{const el=$('#mmListSize');el.value=1;el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#mmTable .ml-2').first().isVisible(),false);assert.equal(await page.locator('#mmTable .ml-1').first().innerText(),'C站展示名称 0');
    const listMinimal=await page.locator('#mmTable tbody tr').first().boundingBox();assert(listMinimal.height<listCompact.height);assert.deepEqual(await page.evaluate(()=>Array.from($('#mmTable').querySelectorAll('thead th')).filter(e=>getComputedStyle(e).display!=='none').map(e=>e.dataset.col)),['sel','name']);assert.equal(await page.locator('#mmTable colgroup col').count(),2);ok('极简档仅名称与勾选格，列槽同步减少不留下空白');
    assert.deepEqual(await page.evaluate(()=>({zoom:state.cfg.ui_zoom,font:state.cfg.ui_text_size,masonry:state.cfg.masonry_card_width})),listAppearance);ok('列表大小不改变全局字号缩放或瀑布流卡片尺寸');
    await page.waitForFunction(()=>window.fixtureCfg.model_list_size===1);ok('调节列表大小自动保存独立偏好');
    await page.evaluate(()=>{state.mmChecked.clear();state.mmSel.clear();});await page.locator('#mmTable tbody tr .ml-1').first().click();await page.waitForFunction(()=>detailRow?.path===state.models[0].path);assert.equal(await page.evaluate(()=>state.mmChecked.has(state.models[0].path)),true);ok('极简行单击仍选中并更新右侧详情');
    const selectedDetail=await page.evaluate(()=>detailRow.path);await page.locator('#mmTable tbody tr .cell-sel').first().click();assert.equal(await page.evaluate(()=>state.mmChecked.has(state.models[0].path)),false);assert.equal(await page.evaluate(()=>detailRow.path),selectedDetail);ok('极简档勾选格仍独立处理选择');
    await page.locator('#mmTable tbody tr .ml-1').first().click({button:'right'});assert.equal(await page.locator('#ctxMenu .ctx-group').count(),3);await page.evaluate(()=>$('#ctxMenu').style.display='none');ok('极简档仍可使用右键管理操作');
    const listCalls=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='get_covers').length);await page.evaluate(()=>{state.coverCache.clear();renderMm();});await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='get_covers').length),listCalls);ok('无封面档不再请求隐藏封面');
    await page.evaluate(()=>{localStorage.setItem('mm_hidden_cols',JSON.stringify(['cname','hash','mtime']));mmApplyCols();setModelListSize(3,true);});await page.waitForFunction(()=>window.fixtureCfg.model_list_size===3);assert.equal(await page.locator('#mmTable .ml-thumb').first().isVisible(),true);assert.equal(await page.locator('#mmTable .ml-3').first().isVisible(),true);assert.equal(await page.locator('#mmTable [data-col=mtime]').first().isVisible(),false);assert.equal(await page.locator('#mmTable [data-col=type]').first().isVisible(),true);ok('放大恢复封面作者及原列设置，不覆盖用户隐藏列');
    await page.evaluate(()=>{window.fixtureListSaveFail=true;setModelListSize(1,true);});await page.waitForFunction(()=>state.cfg.model_list_size===3);await page.evaluate(()=>window.fixtureListSaveFail=false);ok('保存失败恢复上次保存档位');
    await page.locator('#mmViewList').hover();await page.locator('#mmListSizeControl').waitFor({state:'visible'});await page.locator('#mmListSize').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');assert.equal(await page.locator('#mmListSizeControl').isVisible(),false);ok('列表大小支持键盘调整，Escape 收起不误重开');
    await page.evaluate(()=>{setModelListSize(3,false);});await page.locator('#mmTableWrap').hover();await page.mouse.wheel(0,70);assert.equal(await page.evaluate(()=>state.cfg.model_list_size),3);ok('普通滚轮浏览列表，不改变大小');await page.keyboard.down('Alt');await page.mouse.wheel(0,70);await page.keyboard.up('Alt');assert.equal(await page.evaluate(()=>state.cfg.model_list_size),2);ok('Alt 滚轮可调列表大小，不与 Ctrl 全局缩放冲突');
    await page.locator('.nav-tab[data-page="settings"]').click();await (await settingControl('model_list_size')).selectOption('1');await page.waitForFunction(()=>window.fixtureCfg.model_list_size===1);assert.equal(await page.evaluate(()=>document.documentElement.dataset.modelListSize),'1');ok('外观设置也提供三档列表大小并即时保存');
    await page.evaluate(()=>{window.fixtureScanRows=state.models.slice();localStorage.setItem('cft-test-scan-rows',JSON.stringify(window.fixtureScanRows));window.fixtureCfg.default_page='models';});await page.reload();await page.waitForFunction(()=>window.__ready);await page.locator('.nav-tab[data-page="models"]').click();await page.waitForFunction(()=>state.models.length>0);await page.evaluate(()=>mmSetView('list'));assert.equal(await page.evaluate(()=>state.cfg.model_list_size),1);assert.equal(await page.locator('#mmTable .ml-2').first().isVisible(),false);ok('重新打开页面保持极简列表档位');
    await page.evaluate(()=>{state.models[0].civitai_name='';renderMm();});assert.equal(await page.locator('#mmTable .ml-1').first().innerText(),'local_file_0.safetensors');ok('尚未识别 C站名称的模型用本地名兜底，不显示空行');
    await page.setViewportSize({width:780,height:620});await page.evaluate(()=>applyZoom(150));await page.locator('#mmViewList').hover();await page.locator('#mmListSizeControl').waitFor({state:'visible'});const listMenuBounds=await page.locator('#mmListSizeControl').boundingBox();assert(listMenuBounds.x>=7 && listMenuBounds.y>=7 && listMenuBounds.x+listMenuBounds.width<=773 && listMenuBounds.y+listMenuBounds.height<=613);ok('列表大小二级菜单在窄窗与放大界面内定位');
    await page.setViewportSize({width:1280,height:820});await page.evaluate(()=>{applyZoom(100);setModelListSize(3,false);mmSetView('masonry');});assert.equal(await page.locator('#mmListSizeControl').isVisible(),false);ok('切换瀑布流关闭列表菜单，两个大小设置独立');
    const docsShots=path.resolve(__dirname,'../docs/screenshots');fs.mkdirSync(docsShots,{recursive:true});
    await page.evaluate(()=>{
      closeImageViewer();closeMasonrySizeMenu();state.cfg.theme='dark_blue';state.cfg.ui_text_size='standard';state.cfg.ui_font='';document.documentElement.dataset.theme='dark_blue';applyUiAppearance();applyZoom(100);syncWindowControls({integrated:true,maximized:false});
      const names=['山川水彩','暮色建筑','柔光风景','墨色山峦','云端城市','湖畔晨光','秋日森林','极简空间','远山薄雾','电影色彩','星空夜景','海岸线'];
      state.models=state.display=names.map((name,i)=>({name:name+'_v1.safetensors',civitai_name:name,path:'D:\\Example\\models\\'+name+'.safetensors',base:'SDXL',type:'LoRA',size:24641536,author:'Demo Studio',version:'v1.0'}));state.mmView='masonry';state.coverCache.clear();
      names.forEach((name,i)=>{const c=document.createElement('canvas');c.width=360;c.height=420+(i%3)*80;const g=c.getContext('2d');const palettes=[['#90b9c7','#284355','#f7d9a3'],['#9e8ba7','#443859','#efbbb2'],['#95b9aa','#335749','#e8cd99']];const p=palettes[i%3];g.fillStyle=p[0];g.fillRect(0,0,c.width,c.height);g.fillStyle=p[2];g.beginPath();g.arc(265,80,35,0,Math.PI*2);g.fill();for(let k=0;k<3;k++){g.fillStyle=k===2?p[1]:p[0];g.beginPath();g.moveTo(-20,c.height);g.lineTo(0,200+k*35);for(let j=0;j<5;j++)g.lineTo(j*90,150+((i+j+k)%3)*60+k*45);g.lineTo(400,c.height);g.fill();}g.fillStyle='#ffffff';g.font='20px sans-serif';g.fillText('LANDSCAPE / '+String(i+1).padStart(2,'0'),20,c.height-24);state.coverCache.set(state.models[i].path,c.toDataURL('image/jpeg'));});
      window.fixtureScanRows=state.models;state.mmChecked.clear();$('#mmFilter').value='';setMasonrySize(180);switchPage('models');renderMm();$('#mmCount').textContent='12 个示例模型';document.activeElement.blur();window.fixtureDetail={ok:true,name:state.models[0].name,info:{name:'山川水彩',type:'LoRA',baseModel:'SDXL',trainedWords:['landscape','watercolor'],description:'用于截图展示的虚构模型，不代表实际下载。',version:{name:'v1.0'}},covers:[{b64:state.coverCache.get(state.models[0].path).split(',')[1],meta:{prompt:'mountain landscape, watercolor',steps:26},resources:[]}]};setStatus('演示模型 · 截图数据不连接真实下载');
    });
    await page.evaluate(()=>showModelDetail(state.models[0].path));await page.mouse.move(600,760);await page.waitForTimeout(350);await page.screenshot({path:path.join(docsShots,'models-workbench.png')});
    await page.evaluate(()=>{closeListSizeMenu();mmSetView('list');});
    for(const size of [3,2,1]){await page.evaluate(s=>{setModelListSize(s,false);closeListSizeMenu();$('.content').scrollTop=0;},size);await page.mouse.move(400,760);await page.screenshot({path:path.join(docsShots,'models-list-size-'+size+'.png')});}
    await page.evaluate(()=>{setModelListSize(3,false);mmSetView('masonry');closeMasonrySizeMenu();});
    await page.evaluate(()=>{const first=state.models[0];window.fixtureDetail={ok:true,path:first.path,name:first.name,info:{name:'山川水彩',type:'LoRA'},covers:[{b64:state.coverCache.get(first.path).split(',')[1],meta:{prompt:'mountain landscape, watercolor, warm light',negativePrompt:'blur',steps:26,cfgScale:6,seed:2026},resources:[{name:'Landscape demo resource',type:'LoRA',version:'v1'}],metadata_source:'演示生成数据（非用户图片）'}]};window.fixtureOriginalMetadata={width:360,height:420};window.fixtureOnlineMetadata={};window.fixtureCoverB64=state.coverCache.get(first.path).split(',')[1];openImageViewer(window.fixtureDetail);});
    await page.locator('#ivImage').waitFor();await page.waitForTimeout(350);await page.screenshot({path:path.join(docsShots,'image-generation-viewer.png')});await page.keyboard.press('Escape');
    await page.locator('.nav-tab[data-page="settings"]').click();await page.locator('[data-settings-category="appearance"]').click();await page.evaluate(()=>{document.querySelector('.content').scrollTop=0;document.querySelector('[data-key=theme]').value='dark_blue';});await page.mouse.move(600,760);await page.waitForTimeout(150);await page.screenshot({path:path.join(docsShots,'settings-appearance.png')});
    await page.locator('[data-settings-category="organize"]').click();await page.evaluate(()=>document.querySelector('.content').scrollTop=0);await page.screenshot({path:path.join(docsShots,'settings-classification.png')});
    await page.evaluate(()=>{window.fixtureHistoryThumbs={};window.fixtureHistory=state.models.slice(0,5).map((m,i)=>{const id='doc-history-'+i;window.fixtureHistoryThumbs[id]=state.coverCache.get(m.path).split(',')[1];return {id,filename:m.name,modelName:m.civitai_name,status:'done',cached_thumb:true,model_url:'https://civitai.com/models/123',total:m.size,dest_dir:'D:\\Example\\models',file_path:m.path,finished_at:1791370200-i*300};});});
    await page.locator('.nav-tab[data-page="dlmanager"]').click();await page.locator('#dlHistoryTab').click();await page.waitForTimeout(300);await page.screenshot({path:path.join(docsShots,'download-history.png')});ok('README 五张示例截图仅使用虚构模型和程序绘制风景，不读取用户配置');
    // 文件夹显隐弹层：真实鼠标点击、固定工具栏、代理入口与缩放边界。
    await page.locator('.nav-tab[data-page="models"]').click();
    await page.evaluate(()=>{state.cfg.model_toolbar_locked=true;applyModelToolbarLock();applyZoom(100);});
    await page.locator('#mmFolders').click();await page.locator('#fmAll').waitFor();
    assert.equal(await page.evaluate(()=>$('#mmFoldersPanel').parentElement===document.body),true);ok('文件夹显隐脱离固定工具栏，不被 overflow 裁切');
    assert.equal(await page.locator('#mmFolders').getAttribute('aria-expanded'),'true');
    await page.locator('#mmFoldersPanel .fm-item[data-path="分类 0"]').click();
    await page.waitForFunction(()=>window.fixtureCfg.hidden_model_folders?.includes('分类 0'));assert.equal(await page.locator('#mmFoldersPanel .fm-item[data-path="分类 0"] .fm-state').innerText(),'隐藏');ok('点击分类保存隐藏状态，菜单保持展开');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#mmFoldersPanel').isVisible(),false);ok('Escape 关闭文件夹菜单');
    await page.locator('#mmFolders').click();await page.locator('#fmAll').waitFor();assert.equal(await page.locator('#mmFoldersPanel .fm-item[data-path="分类 0"] .fm-state').innerText(),'隐藏');ok('重开读取已保存的文件夹显隐');
    await page.locator('#mmFoldersPanel .fm-item[data-path="分类 0"]').click();await page.waitForFunction(()=>window.fixtureCfg.hidden_model_folders?.length===0);ok('隐藏的分类可以再次恢复显示');
    await page.locator('#fmNone').click();await page.waitForFunction(()=>window.fixtureCfg.show_root_models===false);assert.equal(await page.evaluate(()=>window.fixtureCfg.hidden_model_folders.length),160);ok('全部隐藏包含根目录和所有子文件夹');
    await page.locator('#fmAll').click();await page.waitForFunction(()=>window.fixtureCfg.show_root_models===true && window.fixtureCfg.hidden_model_folders.length===0);ok('全部显示恢复根目录和全部子文件夹');
    await page.evaluate(()=>window.fixtureFolderSaveError=true);await page.locator('#mmFoldersPanel .fm-item[data-path="分类 1"]').click();await page.waitForFunction(()=>!fmSaving);assert.equal(await page.locator('#mmFoldersPanel .fm-item[data-path="分类 1"] .fm-state').innerText(),'显示');ok('保存失败保留旧状态，不假装成功');
    await page.evaluate(()=>window.fixtureFolderSaveError=false);await page.keyboard.press('Escape');
    await page.locator('[data-menu="mmMoreMenu"]').click();await page.locator('#mmMoreMenu [data-proxy="mmFolders"]').click();await page.locator('#fmAll').waitFor();assert.equal(await page.locator('#mmFoldersPanel').isVisible(),true);ok('更多菜单代理入口展开文件夹显隐且不误关');
    await page.locator('#mmFolders').click();assert.equal(await page.locator('#mmFoldersPanel').isVisible(),false);ok('再次点击显隐按钮收起弹层');
    for(const zoom of [80,150,200]){
      await page.setViewportSize({width:780,height:620});await page.evaluate(z=>applyZoom(z),zoom);await page.locator('#mmFolders').click();await page.locator('#fmAll').waitFor();
      const rect=await page.locator('#mmFoldersPanel').boundingBox();assert(rect.x>=7 && rect.y>=7 && rect.x+rect.width<=773 && rect.y+rect.height<=613,JSON.stringify(rect));ok(zoom+'% 缩放窄窗文件夹菜单不越界');await page.keyboard.press('Escape');
    }
    await page.setViewportSize({width:1280,height:820});await page.evaluate(()=>{applyZoom(100);window.fixtureFolderMode='error';});await page.locator('#mmFolders').click();await page.waitForFunction(()=>$('#mmFoldersPanel').textContent.includes('读取失败'));ok('读取失败可见提示，不产生未处理异常');await page.keyboard.press('Escape');
    await page.evaluate(()=>{window.fixtureFolderMode='normal';window.fixtureFolderDelay=250;});await page.locator('#mmFolders').click();await page.keyboard.press('Escape');await page.waitForTimeout(300);assert.equal(await page.locator('#mmFoldersPanel').isVisible(),false);ok('读取过程中收起菜单，迟到响应不会重新打开');
    await page.evaluate(()=>window.fixtureFolderDelay=0);await page.locator('#mmFolders').click();await page.locator('#fmAll').waitFor();await page.locator('.nav-tab[data-page="settings"]').click();assert.equal(await page.locator('#mmFoldersPanel').isVisible(),false);ok('切换页面关闭文件夹菜单');
    await page.evaluate(()=>{state.cfg.model_toolbar_locked=false;applyModelToolbarLock();});
    // 连续缩放、收藏、固定工具栏和三步引导的新回归。
    await page.evaluate(()=>{switchPage('models');state.cfg.model_favorites=[];state.mmView='masonry';applyMmFilter();});
    for(const view of ['masonry','list']){
      await page.evaluate(v=>{state.mmView=v;state.mmChecked.clear();state.mmSel.clear();renderMm();},view);
      const rows=page.locator(view==='masonry'?'#mmMasonry .ms-card':'#mmTable tbody tr[data-path]'),first=await rows.nth(0).getAttribute('data-path'),second=await rows.nth(1).getAttribute('data-path');
      await rows.nth(0).locator(view==='masonry'?'.ms-name':'.ml-1').click();await page.waitForFunction(p=>detailRow?.path===p,first);
      assert.equal(await page.evaluate(p=>state.mmChecked.has(p),first),true);ok(view+' 单击选中仍保留，同时更新右侧详情');
      await rows.nth(1).locator(view==='masonry'?'.ms-name':'.ml-1').click();await page.waitForFunction(p=>detailRow?.path===p,second);
      assert.equal(await page.evaluate(()=>state.mmChecked.size),2);ok(view+' 再单击另一模型继续选中并切换右侧信息');
      const count=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='get_model_detail').length);
      await rows.nth(0).locator(view==='masonry'?'.ms-check':'.cell-sel').click();assert.equal(await page.evaluate(p=>state.mmChecked.has(p),first),false);assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='get_model_detail').length),count);assert.equal(await page.evaluate(()=>detailRow.path),second);ok(view+' 勾选格只调整批量选择，不切换正在查看的详情');
      await rows.nth(0).locator(view==='masonry'?'.ms-name':'.ml-1').dblclick();await page.waitForFunction(p=>detailRow?.path===p,first);assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='get_model_detail').length),count+1);assert.equal(await page.evaluate(p=>state.mmChecked.has(p),first),true);ok(view+' 双击不重复请求详情或抵消第一次选中');
    }
    await page.evaluate(()=>{state.mmView='masonry';state.mmChecked.clear();state.mmSel.clear();renderMm();});
    const pinPath=await page.evaluate(()=>state.display.at(-1).path);
    await page.evaluate(p=>toggleModelFavorite(p),pinPath);
    assert.equal(await page.evaluate(()=>state.display[0].path),pinPath);assert.equal(await page.locator('#mmMasonry .model-star').count(),1);ok('收藏模型置顶且显示实心星标');
    await page.evaluate(()=>{state.mmSort.rev=true;renderMm();});assert.equal(await page.evaluate(()=>state.display[0].path),pinPath);ok('降序排序不会把收藏沉到底部');
    await page.evaluate(p=>showModelDetail(p),pinPath);assert.equal(await page.locator('#dFavorite').getAttribute('aria-pressed'),'true');await page.locator('#dFavorite').click();assert.equal(await page.locator('#dFavorite').getAttribute('aria-pressed'),'false');ok('详情右上角星标替代关闭，并可取消收藏');
    await page.locator('#mmToolbarLock').click();assert.equal(await page.locator('#mmToolbarLock').getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>{const seed=state.models.slice();state.models=Array.from({length:120},(_,i)=>({...seed[i%seed.length],path:'D:/Example/models/pinned-'+i+'.safetensors',name:'pin-'+i+'.safetensors'}));applyMmFilter();});
    for(const view of ['masonry','list']){
      await page.evaluate(v=>{state.mmView=v;renderMm();},view);
      const before=await page.locator('#mmToolbar').boundingBox(),scrollId=view==='masonry'?'#mmMasonryViewport':'#mmTableWrap';
      const metrics=await page.locator(scrollId).evaluate(e=>({h:e.clientHeight,sh:e.scrollHeight,sw:e.scrollWidth,w:e.clientWidth}));assert(metrics.sh>metrics.h && metrics.h>40,JSON.stringify({view,metrics}));
      await page.locator(scrollId).evaluate(e=>e.scrollTop=400);const after=await page.locator('#mmToolbar').boundingBox();assert(Math.abs(before.y-after.y)<1);assert.equal(await page.locator('.content').evaluate(e=>e.scrollTop),0);ok(view+' 固定工具栏仅滚动下方列表');
    }
    await page.locator('#mmToolbarLock').click();assert.equal(await page.locator('#mmToolbarLock').getAttribute('aria-pressed'),'false');ok('工具栏锁定状态可取消并保存');
    await page.evaluate(()=>openImageViewer(window.fixtureDetail));await page.waitForTimeout(120);
    const ease=await page.evaluate(()=>[0,.25,.5,.75,1].map(viewerEaseOut));const increments=ease.slice(1).map((v,i)=>v-ease[i]);assert(increments.every((v,i)=>!i || v<increments[i-1]));ok('按钮缩放 ease-out 从快到慢，不经过慢起步');
    await page.evaluate(()=>setViewerZoom(1.237));const mid=await page.evaluate(()=>({zoom:imageViewer.zoom,target:imageViewer.targetZoom}));assert.equal(mid.target,1.237);assert.notEqual(mid.zoom,mid.target);ok('无极缩放接受任意小数且通过动画渐进，而非整数跳档');
    await page.waitForFunction(()=>imageViewer.zoom===1.237);await page.evaluate(()=>setViewerZoom(.071));await page.waitForFunction(()=>imageViewer.zoom===.071);ok('连续缩放支持小于旧 20% 限制');
    await page.evaluate(()=>setViewerZoom(9.41));await page.waitForFunction(()=>imageViewer.zoom===9.41);ok('连续缩放支持超过旧 800% 限制');
    await page.evaluate(()=>setViewerZoom(1,null,true));
    const imgBox=await page.locator('#ivImage').boundingBox();await page.mouse.move(imgBox.x+imgBox.width/2,imgBox.y+imgBox.height/2);const z0=await page.evaluate(()=>imageViewer.targetZoom);await page.mouse.wheel(0,-7);const z1=await page.evaluate(()=>imageViewer.targetZoom);assert(Math.abs(z1-z0*Math.exp(.014))<.000001);assert.equal(await page.evaluate(()=>imageViewer.zoom),z1);assert.equal(await page.evaluate(()=>imageViewer.zoomRaf),0);ok('滚轮按实际 delta 连续缩放，细小触控板输入不会跳一档');
    const overlayStyle=await page.locator('#imageViewer').evaluate(e=>({filter:getComputedStyle(e).backdropFilter,bg:getComputedStyle(e).backgroundColor}));assert.equal(overlayStyle.filter,'none');assert(overlayStyle.bg.includes('0.58'));ok('大图保留半透明背景，移除昂贵的整屏背景模糊');
    await page.evaluate(()=>{state.cfg.pointer_effects='trail';state.cfg.pointer_effect_quality='low';state.cfg.effects_fps_limit=144;applyUiAppearance();});
    await page.mouse.move(500,300);await page.mouse.down();await page.mouse.up();await page.waitForFunction(()=>document.querySelector('#pointerEffects')?.dataset.running==='true');
    const effect=await page.locator('#pointerEffects').evaluate(e=>({w:e.width,h:e.height,cap:e.dataset.fpsLimit}));assert.equal(effect.cap,'144');assert(effect.w*effect.h<1280*820/4,JSON.stringify(effect));ok('大图打开时拖尾仍运行，仅使用局部画布并接受 144 帧上限');
    await page.evaluate(()=>{state.cfg.effects_fps_limit=0;applyUiAppearance();});assert.equal(await page.evaluate(()=>window.cftEffectsFpsLimit),0);ok('0 帧上限跟随显示刷新，不锁 30/60');
    await page.evaluate(()=>{state.cfg.pointer_effects='off';applyUiAppearance();closeImageViewer();showOnboarding();obStep=1;renderOnboarding();});
    assert.equal(await page.locator('.ob-brand-logo').count(),1);ok('页面介绍保留圆形 Logo');
    assert.equal(await page.locator('#obSteps .ob-step').count(),6);assert.equal(await page.locator('.ob-page-card').count(),7);ok('恢复六步教程与七个页面的具体介绍');
    await page.screenshot({style:'#toast{visibility:hidden!important;}',path:path.join(docsShots,'onboarding.png')});
    for(const route of ['download','dlmanager','models','updates','reverse','workflow','settings']){
      await page.locator('.ob-page-card[data-page='+route+']').click();assert.equal(await page.locator('#page-'+route).getAttribute('class'),'page active');assert((await page.locator('#obMask').getAttribute('class')).includes('mini'));ok('教程 '+route+' 页面卡片立即进入并保留迷你引导');await page.locator('#obMiniContinue').click();assert.equal(await page.locator('.ob-page-card').first().isVisible(),true);
    }
    await page.locator('#obNext').click();assert.equal(await page.locator('.ob-theme').count(),14);ok('原主题引导保留全部十四套主题');
    await page.locator('#obNext').click();await page.locator('#obDir').fill('D:/Example/newdownloads');ok('下载目录步骤仍独立保留');
    await page.locator('#obNext').click();await page.locator('#obModelDirs').fill('D:/Example/first\nD:/Example/second');await page.locator('#obNext').click();assert.equal(await page.locator('#obGoRp').isVisible(),true);ok('恢复多目录选择和反向解析介绍');
    await page.locator('#obPrev').click();assert((await page.locator('#obModelDirs').inputValue()).includes('D:/Example/second'));ok('页面式教程回退不丢已填写目录');await page.locator('#obSkipAll').click();await page.waitForFunction(()=>document.querySelector('#obMask').style.display==='none');assert.equal(await page.evaluate(()=>state.cfg.onboarding_done),true);ok('跳过页面式引导仍保存完成标记');
    await page.evaluate(()=>{
      state.cfg.cache_original_images=true;clearViewerImageCache();
      const large=document.createElement('canvas');large.width=1080;large.height=1620;large.getContext('2d').fillRect(0,0,1080,1620);
      const small=document.createElement('canvas');small.width=40;small.height=60;small.getContext('2d').fillRect(0,0,40,60);
      window.fixtureWarmGallery={ok:true,full:{ok:true,b64:large.toDataURL('image/png').split(',')[1],mime:'image/png',width:1080,height:1620,original_available:true,cache_hit:true},metadata:{ok:true,online_metadata:true,meta:{prompt:'prepared local high resolution',steps:30},resources:[]}};
      window.fixtureDetail={ok:true,path:'D:/Example/warm.safetensors',name:'warm.safetensors',info:{name:'Warm local model'},covers:[{b64:small.toDataURL('image/png').split(',')[1],source_revision:'warm-source-revision'}]};switchPage('models');
    });
    await page.evaluate(()=>showModelDetail('D:/Example/warm.safetensors'));await page.waitForFunction(()=>viewerDecodedCache.size===1 && document.querySelector('#dMain')?.src.startsWith('blob:'));
    const warmCalls=await page.evaluate(()=>window.fixtureCalls.filter(c=>['get_gallery_image','get_gallery_metadata'].includes(c.method)).length);
    await page.locator('#dMain').click();assert.equal(await page.locator('#imageViewer').getAttribute('data-image-source'),'memory');const warmSize=await page.locator('#ivImage').evaluate(e=>[e.naturalWidth,e.naturalHeight]);assert.deepEqual(warmSize,[1080,1620]);assert((await page.locator('.iv-generation').innerText()).includes('prepared local high resolution'));assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>['get_gallery_image','get_gallery_metadata'].includes(c.method)).length),warmCalls);ok('已有本地高清图提前解码，点大图立即显示真实高清尺寸与信息，不经过 40px 缩略图');
    await page.keyboard.press('Escape');await page.evaluate(()=>{window.fixtureWarmGallery=null;clearViewerImageCache();});
    await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=1080;c.height=1620;c.getContext('2d').fillRect(0,0,1080,1620);
      const cached={ok:true,full:{ok:true,b64:c.toDataURL('image/png').split(',')[1],mime:'image/png',width:1080,height:1620,original_available:true,cache_hit:true},metadata:{ok:true,online_metadata:true,meta:{prompt:'cached online example',steps:24},resources:[]}};
      window.fixtureWarmGallery=(_path,index)=>index===1?cached:{};
      window.fixtureDetail={ok:true,path:'D:/Example/online-examples.safetensors',name:'online-examples.safetensors',info:{name:'Online examples'},covers:[{b64:window.fixtureCoverB64,source_revision:'local-cover-unchanged'},{b64:window.fixtureCoverB64,url:'https://image.civitai.com/demo/width=450/online.png',source_revision:'cached-online-example'}]};
    });
    await page.evaluate(()=>showModelDetail('D:/Example/online-examples.safetensors'));await page.waitForFunction(()=>viewerDecodedCache.has('cached-online-example'));await page.locator('.detail-thumb[data-i="1"]').click();await page.waitForFunction(()=>document.querySelector('#dMain').dataset.hdIndex==='1');
    const onlineCalls=await page.evaluate(()=>window.fixtureCalls.filter(c=>['get_gallery_image','get_gallery_metadata'].includes(c.method)).length);await page.locator('#dMain').click();assert.equal(await page.locator('#imageViewer').getAttribute('data-image-source'),'memory');assert.deepEqual(await page.locator('#ivImage').evaluate(e=>[e.naturalWidth,e.naturalHeight]),[1080,1620]);assert((await page.locator('.iv-generation').innerText()).includes('cached online example'));assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>['get_gallery_image','get_gallery_metadata'].includes(c.method)).length),onlineCalls);ok('其他在线示例图也提前恢复高清缓存与图片信息，切换及放大不重新加载小图');
    await page.keyboard.press('Escape');await page.evaluate(()=>{window.fixtureWarmGallery=null;clearViewerImageCache();});
    // 同一会话直接复用已解码图片，不重复走大图和元数据 RPC。
    await page.evaluate(()=>{state.cfg.cache_original_images=true;clearViewerImageCache();window.fixtureOnlineMetadata={ok:true,online_metadata:true,meta:{prompt:'cached landscape'},resources:[]};window.fixtureDetail.covers[0].source_revision='fixture-revision-1';switchPage('models');});
    await page.evaluate(()=>openImageViewer(window.fixtureDetail,0));await page.waitForFunction(()=>document.querySelector('#imageViewer')?.dataset.imageSource==='first');await page.waitForFunction(()=>imageViewer.entry?.metadata?.ok);
    const calls0=await page.evaluate(()=>window.fixtureCalls.filter(c=>['get_gallery_image','get_gallery_metadata'].includes(c.method)).length),image0=await page.locator('#ivImage').evaluate(e=>e.src);
    await page.keyboard.press('Escape');await page.evaluate(()=>openImageViewer(window.fixtureDetail,0));assert.equal(await page.locator('#imageViewer').getAttribute('data-image-source'),'memory');assert.equal(await page.locator('#ivImage').evaluate(e=>e.src),image0);assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>['get_gallery_image','get_gallery_metadata'].includes(c.method)).length),calls0);assert((await page.locator('.iv-generation').innerText()).includes('cached landscape'));ok('重复打开直接复用同一已解码图片与信息，无重复读取或网络 RPC');
    await page.keyboard.press('Escape');await page.evaluate(()=>{window.fixtureDetail.covers[0].source_revision='fixture-revision-2';});await page.evaluate(()=>openImageViewer(window.fixtureDetail,0));await page.waitForFunction(()=>imageViewer.entry?.metadata?.ok);assert((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='get_gallery_image').length))>0);assert.notEqual(await page.locator('#ivImage').evaluate(e=>e.src),image0);ok('来源修订变化会重新读取，不复用旧图');
    await page.keyboard.press('Escape');await page.evaluate(()=>{state.cfg.cache_original_images=false;clearViewerImageCache();});assert.equal(await page.evaluate(()=>viewerDecodedCache.size),0);ok('关闭或清理原图缓存同时释放内存图片');
    await page.evaluate(()=>{switchPage('download');navWheelLast=0;navWheelDelta=0;});
    const nav=await page.locator('#navTabs').boundingBox();await page.mouse.move(nav.x+nav.width/2,nav.y+30);await page.mouse.wheel(0,120);assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'dlmanager');ok('导航滚轮向下切到下一个页面');
    await page.waitForTimeout(210);await page.mouse.wheel(0,-120);assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'download');ok('导航滚轮向上切到上一个页面');
    await page.waitForTimeout(210);await page.mouse.wheel(0,-120);assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'download');ok('导航滚轮在首尾不循环跳转');
    await page.evaluate(()=>{switchPage('download');navWheelLast=0;navWheelDelta=0;});await page.mouse.wheel(0,7);assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'download');ok('细小触控板抖动不误切页面');
    await page.evaluate(()=>{switchPage('settings');showSettingsCategory('advanced');});const mode=page.locator('[data-key=ui_mode]');await mode.selectOption('browser');await page.waitForFunction(()=>window.fixtureCfg.ui_mode==='browser');assert.equal(await page.evaluate(()=>state.cfg.ui_mode),'browser');ok('选择浏览器启动立即持久保存，含义明确为以后直接打开浏览器');
    await mode.selectOption('window');await page.waitForFunction(()=>window.fixtureCfg.ui_mode==='window');assert.equal(await page.locator('[data-key=browser_fallback_enabled]').isChecked(),true);ok('切回软件窗口仍保留默认开启的浏览器失败兜底');
    const unresolvedIcons=await page.evaluate(()=>Array.from(document.querySelectorAll('svg.ic use')).map(e=>e.getAttribute('href')).filter(ref=>!document.querySelector(ref)));
    assert.deepEqual(unresolvedIcons,[]); ok('全部可见与动态图标均有 sprite 定义');
    assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='log_ui_error').length),0); ok('无前端异常');
    // 当前模型立即识别：单次点击、页内进度、不触发批量 rp_start。
    await page.evaluate(()=>{switchPage('models');state.cfg.shortcuts_enabled=false;state.models=state.display=Array.from({length:3},(_,i)=>({path:'D:/Fixture/command'+i+'.safetensors',name:'command'+i+'.safetensors',civitai_name:'Command model '+i,author:'Fixture',type:'LoRA'}));window.fixtureScanRows=state.models.slice();state.mmView='list';state.mmChecked.clear();state.mmSel.clear();$('#mmFilter').value='';state.mmBaseF=state.mmFolderF=state.mmAuthorF=state.mmStF='';state.mmUpdOnly=false;setModelListSize(3,false);renderMm();});
    await page.evaluate(()=>showModelDetail(state.models[0].path));const singlePath=await page.evaluate(()=>state.models[0].path),batchBefore=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='rp_start').length);
    await page.locator('#dRp').click();await page.waitForFunction(()=>detailRpPath!==null);assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'models');assert.equal(await page.locator('#dRp').isDisabled(),true);ok('详情识别一键开始且留在模型管理页');
    await page.waitForFunction(()=>detailRpPath===null);assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='rp_identify_model').at(-1))).args[0],singlePath);assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='rp_start').length),batchBefore);assert((await page.locator('#statusText').innerText()).includes('识别完成'));ok('单模型反查进度在左下角结束，不触发批量队列');
    await page.evaluate(()=>window.fixtureRpReject=true);await page.locator('#dRp').click();await page.waitForFunction(()=>detailRpPath===null);assert((await page.locator('#statusText').innerText()).includes('busy'));await page.evaluate(()=>window.fixtureRpReject=false);ok('已有反查时提示忙碌，不跳页或重复启动');
    // 下载选择以任务 ID 为单位，同名文件不连带操作。
    await page.evaluate(()=>{window.fixtureTasks=[{id:'task-a',filename:'same.safetensors',status:'pending',progress:0,downloaded:0},{id:'task-b',filename:'same.safetensors',status:'done',progress:100,downloaded:1}];switchPage('dlmanager');});await page.locator('#dlQueueTab').click();await page.evaluate(()=>dlRefresh());
    await page.locator('#dlTable tbody tr').nth(0).locator('.dl-task-check').check();assert.equal(await page.locator('#dlTable tbody tr.sel-row').count(),1);ok('下载任务前有可独立多选的勾选框');
    await page.locator('#dlTable tbody tr').nth(1).locator('.c-file').click();assert.equal(await page.locator('#dlTable tbody tr.sel-row').count(),1);assert.equal(await page.locator('#dlTable tbody tr').nth(1).locator('.dl-task-check').isChecked(),true);ok('单击下载任务选中并同步勾选框');
    await page.locator('#dlPauseSel').click();assert.deepEqual((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='dl_action').at(-1))).args,['pause',null,['task-b']]);ok('同名任务按 ID 暂停选中项，不误操作另一项');
    await page.locator('#dlSelectAll').check();assert.equal(await page.locator('#dlTable tbody tr.sel-row').count(),2);await page.evaluate(()=>dlRefresh());assert.equal(await page.locator('#dlTable tbody .dl-task-check:checked').count(),2);ok('下载全选及定时刷新保留勾选状态');
    await page.locator('#dlPauseAll').click();assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='dl_action').at(-1))).args[0],'pause_all');ok('下载管理提供全部暂停入口');
    const removeBefore=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='dl_action'&&c.args[0]==='remove_all').length);await page.locator('#dlRemoveAll').click();await page.locator('#cfCancel').click();assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='dl_action'&&c.args[0]==='remove_all').length),removeBefore);ok('全部移除需确认，取消不操作任务');
    await page.locator('#dlRemoveAll').click();await page.locator('#cfOk').click();await page.waitForFunction(()=>window.fixtureCalls.some(c=>c.method==='dl_action'&&c.args[0]==='remove_all'));ok('全部移除使用队列操作，不调用模型文件删除');await page.locator('#dlClearDone').click();assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='dl_action').at(-1))).args[0],'clear_done');ok('全部移入历史入口只使用已结束任务归档接口');
    // API Key 必须是引导第一步，空值无法跳过。
    await page.evaluate(()=>{state.cfg.api_key='';showOnboarding();});assert.equal(await page.locator('#obKey').getAttribute('type'),'password');assert.equal(await page.locator('#obNext').isDisabled(),true);assert.equal(await page.locator('#obSkipAll').isDisabled(),true);ok('教程第一步申请 Key，空值不能继续或跳过');
    await page.locator('#obOpenApi').click();assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='open_url').at(-1))).args[0],'https://civitai.red/user/account');ok('API 申请默认打开 civitai.red');await page.locator('#obKey').fill('tutorial-fixture-not-a-real-key');await page.locator('#obNext').click();await page.locator('.ob-page-card').first().waitFor();assert.equal(await page.evaluate(()=>window.fixtureCfg.api_key),'tutorial-fixture-not-a-real-key');ok('Key 先保存到本地配置，再进入页面介绍');await page.locator('#obSkipAll').click();await page.waitForFunction(()=>$('#obMask').style.display==='none');
    // 快捷键默认关；三个预设；可搜索、设键和点击使用所有已注册命令。
    await page.evaluate(()=>{switchPage('models');state.cfg.shortcuts_enabled=false;state.cfg.shortcuts_preset='arrows';state.cfg.shortcuts_bindings={};state.mmChecked.clear();state.mmSel=new Set([state.models[0].path]);showModelDetail(state.models[0].path);});await page.waitForFunction(()=>detailRow?.path===state.models[0].path);await page.evaluate(()=>document.activeElement.blur());
    const favoriteBefore=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='toggle_model_favorite').length);await page.keyboard.press('f');assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='toggle_model_favorite').length),favoriteBefore);ok('快捷键默认关闭，字母键不触发功能');
    await page.locator('.nav-tab[data-page="settings"]').click();await page.locator('[data-settings-category=shortcuts]').click();assert.equal(await page.locator('[data-key=shortcuts_preset] option').count(),3);assert((await page.locator('#shortcutCatalog [data-command]').count())>100);assert.equal(await page.locator('#shortcutCatalog .shortcut-run').count(),await page.locator('#shortcutCatalog .shortcut-key').count());ok('独立快捷键页提供三预设与全功能设键/使用入口');
    await page.locator('#shortcutSearch').fill('反查');assert((await page.locator('#shortcutCatalog .shortcut-row:visible').count())>0);await page.locator('#shortcutSearch').fill('');await page.locator('[data-command="button:mmScan"] .shortcut-key').focus();await page.keyboard.press('Control+Alt+g');await page.waitForFunction(()=>window.fixtureCfg.shortcuts_bindings?.['button:mmScan']==='Ctrl+Alt+G');ok('每个功能可点击录入组合键并自动保存');
    await page.locator('[data-key=shortcuts_enabled]').check();await page.waitForFunction(()=>window.fixtureCfg.shortcuts_enabled===true);await page.locator('.nav-tab[data-page=models]').click();await page.evaluate(()=>document.activeElement.blur());
    await page.evaluate(()=>showModelDetail(state.display[0].path));await page.waitForFunction(()=>!!detailRow);const navigationBefore=await page.evaluate(()=>detailRow.path);await page.keyboard.press('ArrowDown');await page.waitForFunction(p=>detailRow.path!==p,navigationBefore);assert.equal(await page.evaluate(()=>state.mmChecked.size),0);ok('上下键切换当前模型和右侧详情，不自动勾选');
    const hotkeyPath=await page.evaluate(()=>detailRow.path);await page.keyboard.press('f');await page.waitForFunction(()=>window.fixtureCalls.filter(c=>c.method==='toggle_model_favorite').length>0);assert.equal((await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='toggle_model_favorite').at(-1))).args[0],hotkeyPath);ok('F 快捷收藏当前模型');await page.keyboard.press('Space');assert.equal(await page.evaluate(p=>state.mmChecked.has(p),hotkeyPath),true);ok('空格单独切换勾选状态');
    const deletesBefore=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='rm_file').length);await page.keyboard.press('Delete');await page.locator('#cfCancel').waitFor();assert((await page.locator('.rename-dialog').innerText()).includes('回收站'));await page.locator('#cfCancel').click();assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='rm_file').length),deletesBefore);ok('Delete 复用回收站确认，取消不删除');
    const scanBefore=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='scan_models').length);await page.evaluate(()=>document.activeElement.blur());await page.keyboard.press('Control+Alt+g');await page.waitForFunction(n=>window.fixtureCalls.filter(c=>c.method==='scan_models').length>n,scanBefore);ok('自定义组合键调用现有扫描入口');
    await page.locator('#mmFilter').fill('');await page.locator('#mmFilter').focus();const editFav=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='toggle_model_favorite').length);await page.keyboard.press('f');assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='toggle_model_favorite').length),editFav);await page.locator('#mmFilter').fill('');ok('输入文字时不触发字母快捷键');
    await page.locator('.nav-tab[data-page=settings]').click();await page.locator('[data-settings-category=shortcuts]').click();await page.locator('[data-key=shortcuts_preset]').selectOption('wasd');await page.waitForFunction(()=>window.fixtureCfg.shortcuts_preset==='wasd');assert.equal(await page.locator('[data-command="model:next"] .shortcut-key').inputValue(),'S');await page.locator('[data-key=shortcuts_enabled]').uncheck();await page.waitForFunction(()=>window.fixtureCfg.shortcuts_enabled===false);ok('预设可切换 W/S，关闭总开关即停止全部自定义快捷键');
    // 启用真实未保存防呆（旧回归中只绕过离页确认，不绕过保存逻辑）。
    await page.evaluate(()=>{window.settingsHaveChanges=window.fixtureRealSettingsChanges;state.cfg={...window.fixtureCfg};buildSettingsForm();});await page.locator('[data-settings-category=network]').click();const uaBefore=await page.locator('[data-key=proxy_address]').inputValue();await page.locator('[data-key=proxy_address]').fill('127.0.0.1:8091');await page.locator('.nav-tab[data-page=models]').click();await page.locator('#settingsStay').waitFor();assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'settings');await page.locator('#settingsStay').click();assert.equal(await page.locator('[data-key=proxy_address]').inputValue(),'127.0.0.1:8091');ok('未保存离页弹窗，继续编辑保留输入');
    await page.locator('.nav-tab[data-page=models]').click();await page.locator('#settingsDiscard').click();await page.waitForFunction(()=>$('#page-models').classList.contains('active'));assert.notEqual(await page.evaluate(()=>state.cfg.proxy_address),'127.0.0.1:8091');ok('放弃修改恢复已保存配置后才离页');
    await page.locator('.nav-tab[data-page=settings]').click();await page.locator('[data-settings-category=network]').click();await page.locator('[data-key=proxy_address]').fill('127.0.0.1:8092');await page.locator('.nav-tab[data-page=models]').click();await page.locator('#settingsSaveLeave').click();await page.waitForFunction(()=>$('#page-models').classList.contains('active'));assert.equal(await page.evaluate(()=>window.fixtureCfg.proxy_address),'127.0.0.1:8092');ok('保存并离开真正写入配置后才跳页');
    await page.locator('.nav-tab[data-page=settings]').click();await page.locator('[data-settings-category=network]').click();await page.locator('[data-key=proxy_address]').fill('127.0.0.1:8093');await page.evaluate(()=>window.fixtureSaveFail=true);await page.locator('.nav-tab[data-page=models]').click();await page.locator('#settingsSaveLeave').click();await page.waitForFunction(()=>$('#settingsExitError').textContent.includes('未能'));assert.equal(await page.locator('.nav-tab.active').getAttribute('data-page'),'settings');assert.notEqual(await page.evaluate(()=>window.fixtureCfg.proxy_address),'127.0.0.1:8093');ok('保存失败仍留在设置页，未丢输入或假装成功');await page.locator('#settingsStay').click();await page.evaluate(()=>window.fixtureSaveFail=false);
    await page.evaluate(()=>window.requestSettingsClose());await page.locator('#settingsStay').waitFor();const closeBefore=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='window_control'&&c.args[0]==='close').length);await page.locator('#settingsStay').click();assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.method==='window_control'&&c.args[0]==='close').length),closeBefore);ok('窗口关闭同样先确认未保存设置，取消不关闭');
    await page.evaluate(()=>{state.cfg={...window.fixtureCfg};buildSettingsForm();});await page.locator('[data-settings-category=appearance]').click();await page.locator('[data-key=model_list_size]').selectOption('2');await page.waitForFunction(()=>window.fixtureCfg.model_list_size===2);await page.locator('.nav-tab[data-page=models]').click();assert.equal(await page.locator('#settingsStay').count(),0);ok('已即时保存的选项不重复提示未保存');
    assert.equal(errors.length,0,JSON.stringify(errors));ok('新增功能无前端异常');
    console.log('PASS '+passed+' checks; mock API only, no real download/move operations');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
