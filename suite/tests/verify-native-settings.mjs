import fs from 'node:fs';import assert from 'node:assert/strict';import {connectToAntigravity} from '../../antigravity-model-switcher/tools/cdp-utils.mjs';
const source=fs.readFileSync(new URL('../control-center.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function findSettingsAnchor()'),source.indexOf('function refreshUI('));
const cdp=await connectToAntigravity();let original;
try{
  const safe=await cdp.evaluate('!window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat');if(!safe)throw Error('当前中转请求正在运行，未打开设置');
  original=await cdp.evaluate('location.pathname+location.search');
  await cdp.evaluate("window.__AGY_MODEL_SWITCHER.nativeContext().router.navigate({to:'/settings'})");await new Promise(r=>setTimeout(r,250));
  const result=await cdp.evaluate(`(()=>{const settings={skin:true,i18n:true,accounts:true,api:true,guardian:false,greetingName:'Fixture',replyFont:'default',replySize:'standard',showUsage:false,quotaReminder:true};const labels={skin:['Claude 皮肤'],i18n:['中文汉化'],accounts:['多账号切换'],api:['API 中转切换']};const text=cn=>cn,save=()=>{};${helper};renderCenter();const anchor=findSettingsAnchor(),dialog=document.querySelector('.settings-modal-container'),center=document.getElementById('agy-suite-center');const found=!!center&&center.parentElement===anchor;center?.remove();return {found,inDialog:!!anchor&&dialog.contains(anchor),hasNav:!!anchor?.querySelector('[data-testid^="settings-nav-item-"]'),width:anchor?.getBoundingClientRect().width,dialogWidth:dialog?.getBoundingClientRect().width};})()`);
  assert(result.found&&result.inDialog&&!result.hasNav&&result.width>result.dialogWidth/2,JSON.stringify(result));
  console.log('PASS suite control card mounts in the native main content panel and cleans up without changing settings');
}finally{if(original)await cdp.evaluate('window.__AGY_MODEL_SWITCHER.nativeContext().router.navigate({to:'+JSON.stringify(original)+'})');cdp.close();}
