import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{startupSource}=require('../../antigravity-claude-skin/tools/renderer-startup.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const browser=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>file&&fs.existsSync(file));
if(!browser){console.log('SKIP no Chromium browser available for isolated startup verification');process.exit(0);}
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});const fixture=fs.mkdtempSync(path.join(root,'artifacts','startup-browser-'));
const settings={version:1,skin:true,themeMode:'dark',i18n:true,accounts:false,api:true,guardian:false,greetingName:'',replyFont:'default',replySize:'standard',showUsage:true,showQuota:false,quotaReminder:false};
const bundle=fs.readFileSync(path.join(root,'antigravity-claude-skin/i18n/claude-cn-i18n.js'),'utf8'),css=fs.readFileSync(path.join(root,'antigravity-claude-skin/claude-theme.css'),'utf8');
const html=`<!doctype html><html><head><style>body{background:var(--background,#fafafa);color:var(--foreground,#383a42);font-family:system-ui}</style><script>
window.fetch=async(url)=>{if(String(url).includes('/api/suite/settings'))return new Promise(()=>{});return new Response(JSON.stringify({ok:true,models:[],providers:[],activeMode:'official',bridge:{conversationId:new URL(String(url)).searchParams.get('conversationId'),exchanges:[]}}),{headers:{'Content-Type':'application/json'}});};
</script></head><body><nav><a href="/" data-testid="new-conversation-button">New chat</a><a href="/customizations">Customizations</a></nav><main><div data-testid="agent-input-box"><div data-lexical-editor="true" contenteditable="true"></div><button data-testid="model-selector-trigger">Gemini</button></div></main><div data-testid="planner-response-text">Startup fixture</div></body></html>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let child,socket;const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+fixture,'about:blank'],{windowsHide:true,stdio:'ignore'});
  child.on('error',error=>console.error(error.message));
  const portFile=path.join(fixture,'DevToolsActivePort');let port;
  for(let i=0;i<100&&!port;i++){try{port=Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);}catch{}await pause(100);}assert(port,'Browser debugging port unavailable');
  const targets=await fetch('http://127.0.0.1:'+port+'/json').then(response=>response.json()),target=targets.find(target=>target.type==='page');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0,contextId,frameId;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Runtime.executionContextsCleared')contextId=undefined;if(message.method==='Runtime.executionContextCreated'){const c=message.params.context;if(c.auxData?.isDefault&&c.auxData.frameId===frameId)contextId=c.id;}const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(message.error.message)):item.resolve(message.result);});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser check timed out: '+method));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  frameId=(await call('Page.getFrameTree')).frameTree.frame.id;await call('Runtime.enable');await call('Page.enable');
  const evaluate=async(expression)=>{const result=await call('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value;};
  let identifier;
  for(const skin of [true,false]){
    if(identifier)await call('Page.removeScriptToEvaluateOnNewDocument',{identifier});
    ({identifier}=await call('Page.addScriptToEvaluateOnNewDocument',{source:startupSource({...settings,skin},css,bundle)}));
    await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'+(skin?'dark':'official')});
    let value;
    for(let i=0;i<70;i++){await pause(100);value=await evaluate(`({ready:!!window.__agySuite?.getSettings(),skin:window.__agySuite?.getSettings()?.skin,background:getComputedStyle(document.body).backgroundColor,nav:!!document.getElementById('agy-suite-sidebar-button'),style:!!document.getElementById('agy-claude-skin'),seeded:window.__agyAppearanceSeededAt,prepared:window.__agyStartupPreparedAt,paint:performance.getEntriesByType('paint').find(entry=>entry.name==='first-contentful-paint')?.startTime})`);if(value.ready&&value.paint)break;}
    assert(value.ready&&value.nav&&Number.isFinite(value.prepared),JSON.stringify(value));
    if(skin){assert(value.skin&&value.style&&value.background==='rgb(31, 30, 29)'&&value.seeded<=value.paint,JSON.stringify(value));console.log('PASS saved dark skin is installed before first contentful paint while backend settings never respond');
      await evaluate('window.__agySuite.apply({...window.__agySuite.getSettings(),skin:false})');assert(await evaluate('!document.getElementById("agy-claude-skin")&&getComputedStyle(document.body).backgroundColor==="rgb(250, 250, 250)"'));console.log('PASS disabling an early-seeded skin restores native appearance');}
    else{assert(!value.skin&&!value.style&&!value.seeded&&value.background==='rgb(250, 250, 250)',JSON.stringify(value));console.log('PASS saved official appearance preserves native first paint and the control center without the backend');}
  }
  await call('Browser.close');console.log('3 isolated browser startup checks passed.');
}finally{
  socket?.close();if(child&&child.exitCode===null)child.kill();await new Promise(resolve=>server.close(resolve));
}
