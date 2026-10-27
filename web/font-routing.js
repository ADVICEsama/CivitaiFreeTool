/* Local, script-specific font stacks. No font files are installed or uploaded. */
"use strict";
const FONT_SCRIPT_SCOPES=Object.freeze([
  {id:'default',label:'默认回退'}, {id:'zhHans',label:'中文 · 简体'},
  {id:'digits',label:'数字'}, {id:'latin',label:'英文 / 拉丁'},
  {id:'ja',label:'日语'}, {id:'zhHant',label:'中文 · 繁体'}, {id:'ko',label:'韩语'}
]);
function normalizeFontScriptStacks(raw){
  const result={};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return result;
  for(const {id} of FONT_SCRIPT_SCOPES){
    if(id==='default'||!Array.isArray(raw[id]))continue;
    const fonts=[...new Set(raw[id].filter(f=>typeof f==='string'&&f.trim()).map(f=>f.trim().slice(0,200)))].slice(0,20);
    if(fonts.length)result[id]=fonts;
  }
  return result;
}
function applyFontScriptRouting(cfg){
  const root=document.documentElement,stacks=normalizeFontScriptStacks(cfg.ui_font_scripts);
  let sheet=document.getElementById('fontScriptFaces');
  if(!Object.keys(stacks).length){sheet?.remove();return;}
  if(!sheet){sheet=document.createElement('style');sheet.id='fontScriptFaces';document.head.append(sheet);}
  // CSS unicode-range lets the browser use a separate font inside the same text node.
  const han='U+2E80-2FFF,U+3000-303F,U+31C0-31EF,U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF,U+20000-323AF';
  const kana='U+3040-30FF,U+31F0-31FF,U+FF65-FF9F,U+1AFF0-1AFFF,U+1B000-1B16F';
  const ranges={digits:'U+0030-0039,U+FF10-FF19',latin:'U+0020-002F,U+003A-007E,U+00A0-024F,U+1E00-1EFF',zhHans:han,zhHant:han,ja:kana,jaHan:han+','+kana,ko:'U+1100-11FF,U+3130-318F,U+A960-A97F,U+AC00-D7AF,U+D7B0-D7FF'};
  ranges.koHan=han+','+ranges.ko;
  const faces=[],aliases={};
  for(const [scope,range] of Object.entries(ranges)){
    aliases[scope]=(stacks[scope==='jaHan'?'ja':scope==='koHan'?'ko':scope]||[]).map((font,index)=>{
      const name='CFT Script '+scope+' '+index;
      // JSON strings escape quotes, backslashes and newlines before entering CSS.
      faces.push('@font-face{font-family:'+JSON.stringify(name)+';src:local('+JSON.stringify(font)+');unicode-range:'+range+';font-weight:normal;font-style:normal;font-display:swap}');
      return JSON.stringify(name);
    });
  }
  const base=getComputedStyle(root).getPropertyValue('--font').trim()||'"HarmonyOS Sans SC",sans-serif';
  const family=groups=>groups.flatMap(id=>aliases[id]).concat(base).join(',');
  root.style.setProperty('--font',family(['digits','latin','ja','ko','zhHans']));
  faces.push('[lang]{--font:'+family(['digits','latin','ja','ko','zhHans'])+';font-family:var(--font)}');
  faces.push(':lang(ko){--font:'+family(['digits','latin','ja','koHan','zhHans'])+';font-family:var(--font)}');
  // Han code points are shared: language metadata, not script guessing, chooses regional forms.
  faces.push(':lang(ja){--font:'+family(['digits','latin','jaHan','ko','zhHans'])+';font-family:var(--font)}');
  faces.push(':is(:lang(zh-Hant),:lang(zh-TW),:lang(zh-HK),:lang(zh-MO)){--font:'+family(['digits','latin','ja','ko','zhHant','zhHans'])+';font-family:var(--font)}');
  const css=faces.join('\n');
  if(sheet.textContent!==css)sheet.textContent=css;
}
