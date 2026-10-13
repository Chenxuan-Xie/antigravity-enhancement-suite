// Render anonymous native templates + production components in a disposable browser.
// This file never connects to the actual Antigravity window.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReasoningOptions} from '../../antigravity-model-switcher/core/reasoning-config.mjs';
import {recordAnimations} from './docs-animations.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),assets=path.join(root,'assets');
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});const fixture=fs.mkdtempSync(path.join(root,'artifacts','docs-preview-'));
const templateFile=path.join(root,'artifacts','docs-anonymous-templates.json');
assert(fs.existsSync(templateFile),'Run node suite/tools/read-docs-templates.mjs first.');
const templates=JSON.parse(fs.readFileSync(templateFile,'utf8')),native=templates.home;
fs.writeFileSync(templateFile,JSON.stringify(templates));
assert(native.html.includes('agent-input-box'),'The live page must contain the native composer.');
assert(!/[\w.+-]+@[\w.-]+\.[a-z]{2,}|googleusercontent|sk-[A-Za-z0-9]{12}|\b[A-Z]:[\\/]/i.test(native.html),'Private text or URLs survived sanitization.');
const modelA={id:'demo-claude',providerId:'demo-provider',name:'Claude Sonnet 4.6 · 中转',modelId:'claude-sonnet-4-6',baseUrl:'https://api.example.test',protocol:'anthropic',enabled:true,hasApiKey:true,apiKeyMasked:'••••••••（示例）',reasoningEffort:'high'};
const modelB={id:'demo-deepseek',providerId:'demo-compatible',name:'DeepSeek · 中转',modelId:'deepseek-chat',baseUrl:'https://gateway.example.test/v1',protocol:'openai',enabled:true,hasApiKey:true,apiKeyMasked:'••••••••（示例）',reasoningEffort:'default'};
for(const model of [modelA,modelB])model.reasoningOptions=getReasoningOptions(model);
const seed={version:1,skin:true,i18n:true,accounts:true,api:true,guardian:false,themeMode:'light',greetingName:'开发者',replyFont:'default',replySize:'standard',showUsage:true,showQuota:true,quotaReminder:false};
const providers=[{id:'demo-provider',name:'演示中转站',baseUrl:modelA.baseUrl,protocol:'anthropic',hasApiKey:true},{id:'demo-compatible',name:'演示兼容接口',baseUrl:modelB.baseUrl,protocol:'openai',hasApiKey:true}];
const exchange={id:'demo-turn',userPrompt:'请检查示例项目的测试，并给出下一步建议。',assistantReply:'示例项目检查完成。\n\n- 界面与 API 的基础流程正常。\n- 12 项测试通过（演示数据）。\n- 建议补充网络异常与取消请求的验证。\n\n以上是虚构对话，用于展示界面。',reasoning:'演示进度摘要：查看文件、运行测试、整理结果。',modelName:modelA.name,modelId:modelA.modelId,protocol:'anthropic',createdAt:1791858000000,usage:{inputTokens:1840,outputTokens:426,reportedRounds:3,totalRounds:3,complete:true},toolSteps:[{id:'demo-tool',name:'run_command',status:'completed',arguments:{command:'npm test'},result:'12 tests passed (demo)',summary:'运行示例测试'}]};
const bundle=fs.readFileSync(path.join(root,'antigravity-claude-skin/i18n/claude-cn-i18n.js'),'utf8');
const bootstrap=`
window.__agySuiteInitialSettings=${JSON.stringify(seed)};
window.__docModels=${JSON.stringify([modelA,modelB])};window.__docProviders=${JSON.stringify(providers)};
window.__docExchange=${JSON.stringify(exchange)};window.__docChat=false;window.__docSelected='demo-claude';window.__docMode='official';window.__docTemplates=${JSON.stringify(templates)};
const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-13T10:20:00+08:00']));}static now(){return new RealDate('2026-10-13T10:20:00+08:00').getTime();}};
const groups=percent=>[{displayName:'Gemini',buckets:[{window:'week',remainingPercent:percent},{window:'5h',remainingPercent:100}]},{displayName:'Claude',buckets:[{window:'week',remainingPercent:percent},{window:'5h',remainingPercent:100}]}];
window.__docAccounts=[{email:'primary@example.test',name:'示例用户',label:'主账号',isCurrent:true,quotaSummary:{updatedAt:new Date().toISOString(),groups:groups(76)}},{email:'backup@example.test',name:'备用用户',label:'备用账号',isCurrent:false,quotaSummary:{updatedAt:new Date().toISOString(),groups:groups(94)}}];
window.fetch=async(url,options={})=>{
  const value=String(url),body=JSON.parse(options.body||'{}');let data={ok:true};
  if(value.includes('/api/suite/settings')){if(options.method==='POST')window.__docSettings={...window.__docSettings,...body};data.settings=window.__docSettings;}
  else if(value.includes('/api/switch')||value.includes('/api/accounts/switch')){window.__docAccounts.forEach(account=>account.isCurrent=account.email===body.email);data.accounts=window.__docAccounts;data.message='示例账号切换完成（虚构演示）';}
  else if(value.includes('/api/accounts'))data.accounts=window.__docAccounts;
  else if(value.includes('/api/models/discover'))data={ok:true,models:['claude-sonnet-4-6','claude-opus-4-6','deepseek-chat'],endpointUrl:'https://api.example.test/v1/models'};
  else if(value.includes('/api/models/reasoning')){const m=window.__docModels.find(x=>x.id===body.modelId);if(m)m.reasoningEffort=body.effort;data.state={models:window.__docModels,activeMode:'custom',activeModelId:body.modelId};}
  else if(value.includes('/api/models/select')){window.__docSelected=body.modelId;window.__docMode=body.mode;data.state={models:window.__docModels,activeMode:body.mode,activeModelId:body.modelId};}
  else if(value.includes('/api/models'))data={ok:true,models:window.__docModels,providers:window.__docProviders,activeMode:window.__docMode,activeModelId:window.__docSelected,chatRelayMode:'direct',localSessions:[],bridge:{conversationId:new URL(value).searchParams.get('conversationId')||window.__AGY_MODEL_SWITCHER?.getActiveConversationId(),exchanges:window.__docChat?[window.__docExchange]:[],officialTurnCount:0,customExchangeCount:window.__docChat?1:0,unsyncedCustomCount:0}};
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
window.__docSettings={...window.__agySuiteInitialSettings};
`;
const html='<!doctype html><html class="'+native.htmlClass+'"><head><meta charset="utf-8"><style>'+native.css.replaceAll('</style','<\\/style')+'</style></head><body class="'+native.bodyClass+'">'+native.html+'<script>'+bootstrap.replaceAll('</script','<\\/script')+'</script><script>'+bundle.replaceAll('</script','<\\/script')+'</script></body></html>';
fs.writeFileSync(path.join(fixture,'anonymous-preview.html'),html);
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file));assert(browser,'Chromium browser required');
let child,socket;const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));const generated=[];
try{
  child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(fixture,'browser'),'--window-size=1500,1060','about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let i=0;i<100&&!port;i++){try{port=Number(fs.readFileSync(path.join(fixture,'browser','DevToolsActivePort'),'utf8').split('\n')[0]);}catch{}await pause(100);}assert(port,'Browser port unavailable');
  const target=(await fetch('http://127.0.0.1:'+port+'/json').then(res=>res.json())).find(page=>page.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const pending=new Map();let sequence=0,frameId,contextId;
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Runtime.executionContextsCleared')contextId=undefined;if(message.method==='Runtime.executionContextCreated'){const c=message.params.context;if(c.auxData?.isDefault&&c.auxData.frameId===frameId)contextId=c.id;}const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(message.error.message)):item.resolve(message.result);});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out '+method));},12000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  frameId=(await call('Page.getFrameTree')).frameTree.frame.id;await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1399,height:900,deviceScaleFactor:2,mobile:false});
  const evaluate=async(expression)=>{const result=await call('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value;};
  await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
  for(let i=0;i<100;i++){await pause(100);if(await evaluate('!!window.__agySuite?.getSettings()&&!!document.getElementById("agy-account-badge")'))break;}
  await evaluate('document.fonts.ready');
  const bindEditor=()=>evaluate(`(()=>{const el=document.querySelector('[data-lexical-editor="true"]');if(el){const root={getWritable:()=>({clear:()=>{el.innerHTML='<p><br></p>';}})};el.__lexicalEditor={update:fn=>fn(),getEditorState:()=>({_nodeMap:new Map([['root',root]])}),_commands:new Map()};}})()`);await bindEditor();
  const capture=async(name,selector)=>{
    await pause(200);const visible=await evaluate('document.body.innerText');
    assert(!/\b[A-Z]:[\\/]|googleusercontent|sk-[a-zA-Z0-9]{10}|[\w.+-]+@(?!example\.test)[\w.-]+\.[a-z]{2,}/i.test(visible),'Private data found before screenshot');
    const clip=selector?await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`):undefined;
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:!!clip,...(clip?{clip}:{})});fs.writeFileSync(path.join(assets,name),Buffer.from(shot.data,'base64'));generated.push(name);console.log('Captured '+name);
  };
  await capture('hero-banner.png');
  await evaluate('window.__agySuite.openCenter()');await capture('suite-control-center.png','#agy-suite-center');await evaluate('window.__agySuite.closeCenter()');
  await evaluate('window.__agySuite.save({themeMode:"dark"})');await capture('theme-dark.png');await evaluate('window.__agySuite.save({themeMode:"light"})');
  await evaluate('document.body.innerHTML=window.__docTemplates.chat.html;window.__docChat=true;window.__docMode="custom";history.pushState({},"","/c/00000000-0000-4000-8000-000000000001");window.__AGY_MODEL_SWITCHER.refreshState()');await bindEditor();await pause(300);await capture('relay-chat-and-usage.png');
  await evaluate('document.getElementById("agy-account-badge").click()');await capture('account-quota-menu.png');await evaluate('document.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true}));document.getElementById("agy-account-menu")?.remove()');
  await evaluate('window.__AGY_MODEL_SWITCHER.openModal()');await pause(150);await capture('api-model-manager.png','#agy-model-manager-backdrop .agy-ms-modal');
  await evaluate(`(()=>{const provider=document.getElementById('agy-ms-provider');provider.value='demo-provider';provider.dispatchEvent(new Event('change'));document.getElementById('agy-ms-discover-btn').click();})()`);await pause(180);
  await evaluate(`(()=>{const checks=document.querySelectorAll('#agy-ms-discovered-chips input[type=checkbox]');for(const el of checks){el.checked=true;el.dispatchEvent(new Event('change'));}})()`);await capture('provider-batch-import.png','#agy-model-manager-backdrop .agy-ms-modal');
  await evaluate('document.getElementById("agy-model-manager-backdrop")?.remove()');
  await evaluate(`(()=>{const holder=document.createElement('div');holder.innerHTML=window.__docTemplates.home.menu;document.body.append(...holder.children);window.__AGY_MODEL_SWITCHER.syncAllUI();const panel=document.querySelector('[data-testid=model-selector-panel]'),outer=panel.closest('[data-radix-popper-content-wrapper]')||panel.parentElement.parentElement,rect=document.querySelector('[data-testid=model-selector-trigger]').getBoundingClientRect();outer.style.transform='translate('+rect.left+'px,'+Math.max(8,rect.top-panel.getBoundingClientRect().height-12)+'px)';})()`);
  await evaluate('document.querySelector("[data-agy-custom-item][data-agy-model-id=demo-claude]").dispatchEvent(new PointerEvent("pointerenter"))');
  assert(await evaluate('!!document.querySelector(".agy-ms-effort-submenu")'),'Reasoning submenu was not rendered');await capture('model-reasoning-menu.png');
  await evaluate('document.body.innerHTML=window.__docTemplates.settings.html;window.__docChat=false;history.pushState({},"","/");window.__AGY_MODEL_SWITCHER.refreshState()');await pause(300);
  assert(await evaluate('!!document.getElementById("agy-settings-account-switcher")'),'The real native settings account widget was not mounted');
  await evaluate('document.getElementById("agy-settings-account-switcher").scrollIntoView({block:"end"})');
  if(process.argv.includes('--debug-accounts'))console.log(JSON.stringify(await evaluate(`(()=>{const w=document.getElementById('agy-settings-account-switcher'),parents=[];let p=w;while(p){parents.push({tag:p.tagName,classes:p.className,top:p.getBoundingClientRect().top,height:p.getBoundingClientRect().height,overflow:getComputedStyle(p).overflow,scrollTop:p.scrollTop,scrollHeight:p.scrollHeight});p=p.parentElement;}return parents;})()`)));
  await capture('account-settings.png','[role=dialog]');
  if(process.argv.includes('--animations')){
    await recordAnimations({call,evaluate,fixture,pause,onlyModel:process.argv.includes('--only-model')});
    const encoder=spawn('python',[path.join(root,'suite/tools/encode-docs-gifs.py'),path.join(fixture,'animations.json'),assets],{windowsHide:true,stdio:'inherit'});
    await new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('exit',code=>code===0?resolve():reject(Error('GIF encoder failed: '+code)));});
    generated.push(...(process.argv.includes('--only-model')?['demo-model-switcher.gif']:['demo-skin-i18n.gif','demo-model-switcher.gif','demo-account-switcher.gif']));
  }
  await call('Browser.close');fs.writeFileSync(path.join(fixture,'capture-manifest.json'),JSON.stringify({generated,source:'Live native DOM and CSS, production suite bundle, fictional data',date:'2026-10-13'},null,2));console.log(JSON.stringify({generated}));
}finally{socket?.close();if(child&&child.exitCode===null)child.kill();await new Promise(resolve=>server.close(resolve));}
