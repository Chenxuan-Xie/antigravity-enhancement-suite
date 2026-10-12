import fs from 'node:fs';import {connectToAntigravity} from '../../antigravity-model-switcher/tools/cdp-utils.mjs';
const bundle=fs.readFileSync(new URL('../../antigravity-claude-skin/i18n/claude-cn-i18n.js',import.meta.url),'utf8');
const cdp=await connectToAntigravity();
try{
 const results=await cdp.evaluate(`(async()=>{
  const savedGreeting=localStorage.getItem('__agy_greeting_name__'),savedAccounts=localStorage.getItem('__agy_saved_accounts__');
  const frame=document.createElement('iframe');frame.id='agy-suite-regression-fixture';frame.style.display='none';document.body.appendChild(frame);const w=frame.contentWindow,d=w.document;
  const results=[],assert=(value,message)=>{if(!value)throw Error(message);results.push(message);},pause=ms=>new Promise(r=>setTimeout(r,ms));
  let settings={version:1,skin:false,i18n:true,accounts:false,api:false,guardian:false,greetingName:'',replyFont:'serif',replySize:'standard',showUsage:false,quotaReminder:true};
  let posts=0,quotaCalls=0,switches=0,imported,discoverCalls=0;
  const account=(email,percent,isCurrent)=>({email,label:email,isCurrent,quotaSummary:{updatedAt:new Date().toISOString(),groups:[{displayName:'Gemini',buckets:[{displayName:'Gemini',remainingPercent:percent}]}]}});
  let accounts=[account('main@example.test',8,true),account('backup@example.test',100,false)];
  const providers=[{id:'fixture-provider',name:'Fixture',baseUrl:'https://fixture.test/v1',protocol:'openai',hasApiKey:true}];
  d.body.innerHTML='<nav><a href="/" data-testid="new-conversation-button">New conversation</a><a href="/customizations">Customizations</a></nav><div data-testid="settings-content"><h1>Settings</h1></div><button id="translate-me">Settings</button><main><div data-testid="agent-input-box"><div data-lexical-editor="true" contenteditable="true"></div><button data-testid="model-selector-trigger">Gemini</button><button data-testid="send-button">Send</button></div></main><div data-testid="planner-response-text">A sample reply</div>';
  w.requestAnimationFrame=fn=>w.setTimeout(fn,0);
  const editor=d.querySelector('[data-lexical-editor]'),root={getWritable:()=>({clear:()=>{editor.textContent='';}})};
  editor.__lexicalEditor={update:fn=>fn(),getEditorState:()=>({_nodeMap:new Map([['root',root]])}),_commands:new Map()};
  w.fetch=async(url,options={})=>{
    const value=String(url),body=JSON.parse(options.body||'{}');let payload={ok:true};
    if(value.includes('/api/suite/settings')){if(options.method==='POST'){posts++;settings={...settings,...body};}payload.settings=settings;}
    else if(value.includes('/api/models/discover')){discoverCalls++;payload.models=['model-a','model-b','model-c'];payload.endpointUrl='https://fixture.test/v1/models';}
    else if(value.includes('/api/models/import')){imported=body;payload.state={models:[],activeMode:'official',providers};}
    else if(value.includes('/api/models'))payload={ok:true,models:[],providers,activeMode:'official',bridge:{conversationId:'auto',exchanges:[],officialTurnCount:0,customExchangeCount:0}};
    else if(value.endsWith('/api/switch')){switches++;accounts=accounts.map(a=>({...a,isCurrent:a.email===body.email}));payload.accounts=accounts;}
    else if(value.includes('/api/accounts')){if(value.includes('/quota'))quotaCalls++;payload.accounts=accounts;}
    return new w.Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}});
  };
  try{
    w.eval(${JSON.stringify(bundle)});await pause(160);
    assert(d.querySelector('#agy-suite-center'),'settings page contains the suite control card');
    assert(d.querySelectorAll('#agy-suite-center [role=switch]').length===7,'four feature switches plus optional recovery, usage and quota reminders are accessible');
    assert(d.querySelector('#translate-me').textContent==='设置'&&!d.querySelector('#agy-claude-skin')&&!w.__AGY_MODEL_SWITCHER&&!d.querySelector('#agy-account-badge'),'Chinese localization runs independently without skin or account/API modules');
    await w.__agySuite.save({i18n:false,api:true});await pause(150);
    assert(d.querySelector('#translate-me').textContent==='Settings'&&!w.__agyCnI18nActive&&!!w.__AGY_MODEL_SWITCHER,'disabling localization restores English while API remains usable');
    await w.__agySuite.save({skin:true,replyFont:'sans',replySize:'large',greetingName:'<img src=x>'});await pause(60);
    assert(d.querySelector('#agy-claude-skin')&&w.getComputedStyle(d.querySelector('[data-testid="planner-response-text"]')).fontSize==='18px','skin, font and font size update without page reload');
    assert(d.querySelector('.agy-suite-greeting').textContent.includes('<img src=x>')&&!d.querySelector('.agy-suite-greeting img'),'greeting is rendered as safe text');
    await w.__agySuite.save({skin:false});await pause(40);
    assert(!d.querySelector('#agy-claude-skin')&&w.__AGY_MODEL_SWITCHER,'disabling skin keeps the English API interface active');
    const api=w.__AGY_MODEL_SWITCHER,get=api.getState;api.getState=()=>({...get(),isSendingCustomChat:true});const before=posts;
    await w.__agySuite.save({api:false});api.getState=get;
    assert(posts===before&&w.__AGY_MODEL_SWITCHER===api,'turning off API during generation is blocked before saving or cleanup');
    api.openModal();await pause(30);
    assert(d.querySelectorAll('#agy-ms-provider-preset option').length===7,'native model dialog provides all six service presets');
    const preset=d.querySelector('#agy-ms-provider-preset');preset.value='deepseek';preset.dispatchEvent(new w.Event('change'));
    assert(d.querySelector('#agy-ms-input-base-url').value==='https://api.deepseek.com'&&d.querySelector('#agy-ms-input-protocol').value==='openai','DeepSeek preset fills its URL and protocol');
    const provider=d.querySelector('#agy-ms-provider');provider.value='fixture-provider';provider.dispatchEvent(new w.Event('change'));
    d.querySelector('#agy-ms-discover-btn').click();await pause(40);
    const checks=d.querySelectorAll('#agy-ms-discovered-chips input[type=checkbox]');assert(checks.length===3&&discoverCalls===1,'saved provider discovers models without asking for the key again');
    for(const input of [checks[0],checks[2]]){input.checked=true;input.dispatchEvent(new w.Event('change'));}
    d.querySelector('#agy-ms-import-btn').click();await pause(70);
    assert(imported.providerId==='fixture-provider'&&imported.modelIds.join(',')==='model-a,model-c'&&!imported.apiKey,'native bulk import submits only selected models using the shared provider');
    d.querySelector('#agy-model-manager-backdrop')?.remove();
    await w.__agySuite.save({accounts:true});await pause(120);
    assert(d.querySelector('#agy-account-badge')?.textContent.includes('8%')&&quotaCalls===1,'account capsule shows matching quota and refreshes current account data');
    assert(d.querySelector('[role=status]')&&[...d.querySelectorAll('button')].some(b=>b.textContent==='Switch account'),'low quota offers a manual backup switch');
    d.querySelector('#agy-account-badge').click();assert(d.querySelector('#agy-account-menu'),'account capsule opens a one-click switch menu');
    [...d.querySelectorAll('#agy-account-menu button')].find(b=>b.textContent.includes('backup@')).click();await pause(100);
    assert(switches===1&&d.querySelector('#agy-account-badge').textContent.includes('100%'),'choosing backup switches exactly once and refreshes the capsule');
    await w.__agySuite.save({accounts:false,api:false});await pause(60);
    assert(!d.querySelector('#agy-account-badge')&&!d.querySelector('#agy-account-menu')&&!w.__AGY_MODEL_SWITCHER,'module disable cleans badges, menus and API runtime');
    w.eval(${JSON.stringify(bundle)});await pause(40);
    assert(!w.__AGY_MODEL_SWITCHER&&d.querySelectorAll('#agy-suite-center').length===1,'identical bundle reinjection respects disabled modules and stays idempotent');
    return results;
  }finally{w.__agySuiteCleanup?.();w.__agyAccountSwitcherCleanup?.();w.__AGY_MODEL_SWITCHER_CLEANUP?.();w.__agyCnRestore?.();frame.remove();for(const [key,value] of [['__agy_greeting_name__',savedGreeting],['__agy_saved_accounts__',savedAccounts]]){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}}
 })()`,30000);
 for(const result of results)console.log('PASS '+result);console.log(results.length+' suite browser checks passed.');
}finally{cdp.close();}
