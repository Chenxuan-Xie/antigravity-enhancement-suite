import assert from 'node:assert/strict';import {connectToAntigravity} from '../../antigravity-model-switcher/tools/cdp-utils.mjs';
const cdp=await connectToAntigravity();let wasOpen=false;
try{
  const safe=await cdp.evaluate('!window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat&&!document.querySelector(\'button[data-tooltip-id="input-send-button-cancel-tooltip"]\')');if(!safe)throw Error('当前正在生成，未打开控制中心');
  wasOpen=await cdp.evaluate('!!document.getElementById("agy-suite-backdrop")');
  const original=await cdp.evaluate('location.href');
  await cdp.evaluate('window.__agySuite.openCenter()');await new Promise(r=>setTimeout(r,100));
  const result=await cdp.evaluate(`(()=>{const center=document.getElementById('agy-suite-center'),button=document.getElementById('agy-suite-sidebar-button'),api=document.querySelector('[data-agy-custom-api-nav="1"]');return {visible:!!center?.getClientRects().length,dialog:center?.getAttribute('role')==='dialog',aboveApi:!api||button?.nextElementSibling===api,inSettings:!!center?.closest('.settings-modal-container,[data-testid="settings-content"]'),switches:center?.querySelectorAll('[role=switch]').length,url:location.href};})()`);
  assert(result.visible&&result.dialog&&result.aboveApi&&!result.inSettings&&result.switches===8&&result.url===original,JSON.stringify(result));
  console.log('PASS independent control center opens above relay entry without navigating or modifying native settings');
}finally{if(!wasOpen)await cdp.evaluate('window.__agySuite?.closeCenter()');cdp.close();}
