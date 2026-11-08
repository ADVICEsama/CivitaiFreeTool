const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({window:{}});
for(const file of ['web/i18n-catalog.js','web/i18n-onboarding.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
const catalogs=context.window.CFTLocales,locales=['zh-CN','zh-TW','en','ja','ko','de','fr','es','pt-BR','ru'];
assert.deepEqual(Object.keys(catalogs).sort(),locales.sort());
const base=catalogs['zh-CN'],keys=Object.keys(base).sort();
const placeholders=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
for(const locale of locales){
 assert.deepEqual(Object.keys(catalogs[locale]).sort(),keys,locale+' key coverage');
 for(const key of keys){assert.equal(typeof catalogs[locale][key],'string');assert(catalogs[locale][key].trim(),locale+'/'+key);assert.deepEqual(placeholders(catalogs[locale][key]),placeholders(base[key]),locale+'/'+key+' placeholders');}
}
assert.equal(catalogs['zh-TW']['ob.models.choose'],'選擇資料夾');
assert(catalogs['zh-TW']['ob.key.offline'].includes('儲存'));
console.log(`PASS ${locales.length} locales × ${keys.length} keys / placeholder parity / Taiwan terminology`);
