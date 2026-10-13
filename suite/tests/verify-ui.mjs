import fs from 'node:fs';import {connectToAntigravity} from '../../antigravity-model-switcher/tools/cdp-utils.mjs';
const bundle=fs.readFileSync(new URL('../../antigravity-claude-skin/i18n/claude-cn-i18n.js',import.meta.url),'utf8');
const cdp=await connectToAntigravity();
try{
 const results=await cdp.evaluate(`(async()=>{
  const frame=document.createElement('iframe');frame.id='agy-suite-regression-fixture';frame.style.cssText='position:fixed;left:-10000px;width:1000px;height:900px;pointer-events:none';document.body.appendChild(frame);const w=frame.contentWindow,d=w.document;
  const storage=()=>{const values=new Map();return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear(),key:index=>[...values.keys()][index]||null,get length(){return values.size;}};};
  Object.defineProperty(w,'localStorage',{value:storage()});Object.defineProperty(w,'sessionStorage',{value:storage()});
  const results=[],assert=(value,message)=>{if(!value)throw Error(message);results.push(message);},pause=ms=>new Promise(r=>setTimeout(r,ms));
  let settings={version:1,skin:false,i18n:true,accounts:false,api:false,guardian:false,greetingName:'',replyFont:'serif',replySize:'standard',showUsage:false,showQuota:true,quotaReminder:true};
  let posts=0,quotaCalls=0,switches=0,imported,discoverCalls=0,quotaFailure=false,holdSettings=false,releaseSettings=null,failSettings=false,holdInitial=true,releaseInitial,usageExchanges=[];
  const account=(email,percent,isCurrent)=>({email,label:email,isCurrent,quotaSummary:{updatedAt:new Date().toISOString(),groups:[{displayName:'Gemini',buckets:[{displayName:'Gemini',remainingPercent:percent}]}]}});
  let accounts=[account('main@example.test',8,true),account('backup@example.test',100,false)];
  const providers=[{id:'fixture-provider',name:'Fixture',baseUrl:'https://fixture.test/v1',protocol:'openai',hasApiKey:true}];
  d.body.innerHTML='<nav><a href="/" data-testid="new-conversation-button">New conversation</a><a href="/customizations">Customizations</a></nav><div data-testid="settings-content"><h1>Settings</h1></div><button id="translate-me">Settings</button><main><div data-testid="agent-input-box"><div data-lexical-editor="true" contenteditable="true"></div><button data-testid="model-selector-trigger">Gemini</button><button data-testid="send-button">Send</button></div></main><div data-testid="planner-response-text">A sample reply</div>';
  const nativeStyle=d.createElement('style');nativeStyle.textContent='body{background:#fafafa;color:#383a42;font-family:system-ui}';d.head.appendChild(nativeStyle);const nativeBackground=w.getComputedStyle(d.body).backgroundColor,nativeFont=w.getComputedStyle(d.querySelector('[data-testid="planner-response-text"]')).fontFamily;
  w.requestAnimationFrame=fn=>w.setTimeout(fn,0);
  const editor=d.querySelector('[data-lexical-editor]'),root={getWritable:()=>({clear:()=>{editor.textContent='';}})};
  editor.__lexicalEditor={update:fn=>fn(),getEditorState:()=>({_nodeMap:new Map([['root',root]])}),_commands:new Map()};
  w.fetch=async(url,options={})=>{
    const value=String(url),body=JSON.parse(options.body||'{}');let payload={ok:true};
    if(value.includes('/api/suite/settings')){if(options.method==='POST'){posts++;if(holdSettings)await new Promise(resolve=>{releaseSettings=resolve;});if(failSettings)return new w.Response(JSON.stringify({ok:false,error:'Fixture save failure'}),{status:400,headers:{'Content-Type':'application/json'}});settings={...settings,...body};}else if(holdInitial)await new Promise(resolve=>{releaseInitial=resolve;});payload.settings=settings;}
    else if(value.includes('/api/models/discover')){discoverCalls++;payload.models=['model-a','model-b','model-c'];payload.endpointUrl='https://fixture.test/v1/models';}
    else if(value.includes('/api/models/import')){imported=body;payload.state={models:[],activeMode:'official',providers};}
    else if(value.includes('/api/models'))payload={ok:true,models:[],providers,activeMode:'official',bridge:{conversationId:new URL(value).searchParams.get('conversationId')||'auto',exchanges:usageExchanges,officialTurnCount:0,customExchangeCount:usageExchanges.length}};
    else if(value.endsWith('/api/switch')){switches++;accounts=accounts.map(a=>({...a,isCurrent:a.email===body.email}));payload.accounts=accounts;}
    else if(value.includes('/api/accounts')){if(value.includes('/quota')){quotaCalls++;if(quotaFailure)return new w.Response(JSON.stringify({ok:false,error:'Token refresh failed HTTP 401: unauthorized_client'}),{status:401,headers:{'Content-Type':'application/json'}});}payload.accounts=accounts;}
    return new w.Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}});
  };
  try{
    w.__agySuiteInitialSettings={...settings};w.eval(${JSON.stringify(bundle)});
    assert(w.__agySuite?.getSettings().skin===false&&!d.querySelector('#agy-claude-skin')&&d.querySelector('#agy-suite-sidebar-button'),'saved official appearance and control center apply synchronously before backend settings are available');
    holdInitial=false;releaseInitial();await pause(160);
    assert(d.querySelector('#agy-suite-sidebar-button')&&!d.querySelector('#agy-suite-center'),'suite is accessible from the sidebar without adding content to native settings');
    d.querySelector('#agy-suite-sidebar-button').focus();d.querySelector('#agy-suite-sidebar-button').click();await pause(30);
    assert(d.querySelector('#agy-suite-center[role=dialog][aria-modal=true]'),'sidebar opens the independent suite dialog');
    assert(d.querySelectorAll('#agy-suite-center [role=switch]').length===8,'four modules and independent quota, usage, reminders and recovery switches are accessible');
    assert(d.querySelectorAll('.suite-feature').length===4&&d.querySelectorAll('#agy-suite-center h3').length===3,'control center groups feature cards, appearance and background preferences');
    d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert(!d.querySelector('#agy-suite-center')&&d.activeElement.id==='agy-suite-sidebar-button','Escape closes the dialog and restores focus to the sidebar');
    d.querySelector('#agy-suite-sidebar-button').click();
    assert(d.querySelector('#translate-me').textContent==='设置'&&!d.querySelector('#agy-claude-skin')&&!w.__AGY_MODEL_SWITCHER&&!d.querySelector('#agy-account-badge'),'Chinese localization runs independently without skin or account/API modules');
    await w.__agySuite.save({i18n:false,api:true});await pause(150);
    assert(d.querySelector('#agy-suite-sidebar-button').nextElementSibling?.matches('[data-agy-custom-api-nav="1"]'),'suite entry sits directly above the relay API entry');
    assert(d.querySelector('#translate-me').textContent==='Settings'&&!w.__agyCnI18nActive&&!!w.__AGY_MODEL_SWITCHER,'disabling localization restores English while API remains usable');
    holdSettings=true;const apiSwitch=d.querySelector('[data-setting=api]');apiSwitch.click();const noise=d.createElement('div');d.body.appendChild(noise);await pause(40);
    assert(!apiSwitch.checked&&apiSwitch.disabled&&d.querySelector('[role=status]').textContent==='Saving…'&&w.__AGY_MODEL_SWITCHER,'API switch immediately shows pending feedback without reverting or unloading before confirmation');
    holdSettings=false;releaseSettings();await pause(60);assert(!w.__AGY_MODEL_SWITCHER&&!apiSwitch.disabled&&d.querySelector('[data-setting=api]')===apiSwitch,'confirmed API save preserves the input node and applies once');
    await w.__agySuite.save({api:true});noise.remove();
    failSettings=true;await w.__agySuite.save({showUsage:true});failSettings=false;
    assert(!d.querySelector('[data-setting=showUsage]').checked&&!d.querySelector('[data-setting=showUsage]').disabled&&d.querySelector('[role=status]').textContent.includes('Fixture save failure'),'failed save restores committed checkbox state and reports the error');
    await w.__agySuite.save({skin:true,replyFont:'sans',replySize:'large',greetingName:'<img src=x>'});await pause(60);
    assert(d.querySelector('#agy-claude-skin')&&w.getComputedStyle(d.querySelector('[data-testid="planner-response-text"]')).fontSize==='18px','skin, font and font size update without page reload');
    assert(d.querySelector('.agy-suite-greeting').textContent.includes('<img src=x>')&&!d.querySelector('.agy-suite-greeting img'),'greeting is rendered as safe text');
    const logo=d.querySelector('.agy-suite-greeting svg');await w.__agySuite.save({greetingName:'New name'});
    assert(logo&&d.querySelector('.agy-suite-greeting svg')===logo&&d.querySelector('.agy-suite-greeting-text').textContent.includes('New name'),'changing the greeting name preserves the Antigravity logo');
    assert(w.getComputedStyle(logo).color==='rgb(217, 119, 87)'&&w.getComputedStyle(logo).animationName==='agySuiteLogoBreath'&&w.getComputedStyle(logo).animationDuration==='4.5s','welcome logo uses the original orange slow floating animation');
    assert(w.getComputedStyle(d.querySelector('.agy-suite-greeting')).fontFamily.includes('system-ui'),'welcome font follows the selected sans serif reply style');
    await w.__agySuite.save({replyFont:'default'});assert(w.getComputedStyle(d.querySelector('.agy-suite-greeting')).fontFamily.includes('ClaudeSerif'),'default welcome font follows the skin serif font');
    w.__AGY_THEME_SWITCHER.setMode('dark');await pause(60);
    assert(w.__agySuite.getSettings().themeMode==='dark'&&d.body.classList.contains('theme-dark'),'theme mode persists through the shared settings API');
    await w.__agySuite.save({skin:false});await pause(40);
    assert(!w.__AGY_THEME_SWITCHER&&!d.body.classList.contains('theme-dark')&&!d.querySelector('#agy-settings-skin-switcher'),'disabling skin stops theme overrides and restores official theme classes');
    assert(!d.querySelector('#agy-claude-skin')&&w.__AGY_MODEL_SWITCHER,'disabling skin keeps the English API interface active');
    assert(w.getComputedStyle(d.body).backgroundColor===nativeBackground&&w.getComputedStyle(d.querySelector('[data-testid="planner-response-text"]')).fontFamily===nativeFont&&!d.querySelector('.agy-suite-greeting'),'skin off restores native background and reply font and hides skin decorations');
    const api=w.__AGY_MODEL_SWITCHER,get=api.getState;api.getState=()=>({...get(),isSendingCustomChat:true});const before=posts;
    await w.__agySuite.save({api:false});api.getState=get;
    assert(posts===before&&w.__AGY_MODEL_SWITCHER===api,'turning off API during generation is blocked before saving or cleanup');
    await w.__agySuite.save({showUsage:true});
    assert(d.querySelector('[data-agy-custom-api-nav="1"]').nextElementSibling?.id==='agy-ms-usage'&&d.querySelectorAll('#agy-ms-usage tbody tr').length===2,'token usage switch immediately shows a sidebar table below the relay API entry even for an empty chat');
    assert(d.querySelector('#agy-ms-usage').textContent.includes('No relay requests')&&[...d.querySelectorAll('#agy-ms-usage td')].every(cell=>cell.textContent==='—'),'empty chats show a truthful explanation and missing usage instead of fabricated zeros');
    usageExchanges=[{usage:{inputTokens:120,outputTokens:30,reportedRounds:1,totalRounds:1,complete:true}},{usage:{inputTokens:80,outputTokens:20,reportedRounds:1,totalRounds:1,complete:true}}];await api.refreshState();
    assert([...d.querySelectorAll('#agy-ms-usage tbody tr:first-child td')].map(cell=>cell.textContent).join(',')==='80,20,100'&&[...d.querySelectorAll('#agy-ms-usage tbody tr:last-child td')].map(cell=>cell.textContent).join(',')==='200,50,250','table reports the latest turn and all reported chat tokens with correct totals');
    usageExchanges.push({usage:{inputTokens:0,outputTokens:null,reportedRounds:1,totalRounds:1,complete:false}});await api.refreshState();
    assert([...d.querySelectorAll('#agy-ms-usage tbody tr:first-child td')].map(cell=>cell.textContent).join(',')==='0,—,—'&&d.querySelector('#agy-ms-usage p').textContent.includes('complete usage'),'zero token counts are preserved and incomplete provider data is clearly marked');
    const table=d.querySelector('#agy-ms-usage table');api.syncAllUI();assert(d.querySelector('#agy-ms-usage table')===table,'unchanged token statistics preserve table nodes without repeated rendering');
    api.getState().bridge.conversationId='other-chat';api.syncAllUI();assert([...d.querySelectorAll('#agy-ms-usage td')].every(cell=>cell.textContent==='—'),'stale history from another conversation cannot appear in the usage table');
    await api.refreshState();await w.__agySuite.save({showUsage:false});assert(!d.querySelector('#agy-ms-usage'),'token display hides immediately without disabling the relay');
    usageExchanges=[];
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
    const quotaCase=(weekly,fiveHour,order=false)=>({...accounts[0],quotaSummary:{updatedAt:new Date().toISOString(),groups:[{displayName:'Gemini Models',buckets:(order?[['5h',fiveHour],['weekly',weekly]]:[['weekly',weekly],['5h',fiveHour]]).map(([window,remainingPercent])=>({window,remainingPercent,displayName:window==='5h'?'Five Hour Limit Remaining':'Weekly Limit Remaining'}))},{displayName:'Claude and GPT models',buckets:[{window:'weekly',displayName:'Weekly Limit Remaining',remainingPercent:4},{window:'5h',displayName:'Five Hour Limit Remaining',remainingPercent:70}]}]}});
    const quota=w.__agyQuotaBadge;
    const fiveHour=quotaCase(80,20);w.dispatchEvent(new w.CustomEvent('agy-accounts-updated',{detail:[fiveHour]}));
    assert(quota.selection(fiveHour,'Gemini 3.8 Flash High').window==='5h'&&quota.percentage(fiveHour,'Gemini 3.8 Flash High')===20&&d.querySelector('#agy-account-badge').textContent.includes('5h 20%'),'real upstream group and period-only bucket labels select the lower 5h quota without using another model pool');
    d.querySelector('#agy-account-badge').click();assert(d.querySelector('.quota-percent').textContent==='5h 20%','switch menu identifies the selected quota period');d.body.dispatchEvent(new w.PointerEvent('pointerdown',{bubbles:true}));
    const weekly=quotaCase(15,60);w.dispatchEvent(new w.CustomEvent('agy-accounts-updated',{detail:[weekly]}));
    assert(quota.selection(weekly,'Gemini').window==='weekly'&&d.querySelector('#agy-account-badge').textContent.includes('week 15%'),'capsule shows the weekly quota when it is lower');
    assert(quota.selection(quotaCase(50,50,true),'Gemini').window==='weekly','equal quotas prefer weekly even when 5h arrives first');
    assert(quota.selection(quotaCase(null,0),'Gemini').percent===0&&quota.selection(quotaCase(null,0),'Gemini').window==='5h'&&quota.selection(quotaCase(25,null),'Gemini').window==='weekly','missing periods are ignored and exhausted zero-percent quotas stay valid');
    assert(quota.percentage(fiveHour,'Claude Opus 4.6')===4&&quota.percentage(fiveHour,'GPT-OSS 120B')===4&&quota.percentage(fiveHour,'Unknown model')===4,'Claude and GPT share their pool while unknown models fall back to the lowest known quota');
    assert(quota.selection(quotaCase(null,null),'Gemini')===null,'matched model groups with no reported values cannot borrow another model pool');
    w.dispatchEvent(new w.CustomEvent('agy-accounts-updated',{detail:accounts}));
    d.querySelector('#agy-account-badge').click();assert(d.querySelector('#agy-account-menu'),'account capsule opens a one-click switch menu');
    [...d.querySelectorAll('#agy-account-menu button')].find(b=>b.textContent.includes('backup@')).click();await pause(100);
    assert(switches===1&&d.querySelector('#agy-account-badge').textContent.includes('100%'),'choosing backup switches exactly once and refreshes the capsule');
    assert(d.querySelector('#agy-account-capsule')&&w.getComputedStyle(d.querySelector('#agy-account-badge')).width!=='1000px','quota badge uses a compact capsule instead of a full-width button');
    await w.__agySuite.save({showQuota:false});await pause(40);
    assert(!d.querySelector('#agy-account-badge')&&!d.querySelector('#agy-account-menu')&&w.__agyQuotaBadge,'turning quota display off immediately hides the capsule and its menu without disabling accounts');
    await w.__agySuite.save({showQuota:true});await pause(40);d.querySelector('#agy-account-badge').click();
    quotaFailure=true;d.querySelector('[data-quota-refresh]').click();await pause(90);
    assert(d.querySelector('#agy-account-toast')?.textContent.includes('authorization expired')&&!d.querySelector('#agy-account-toast')?.textContent.includes('unauthorized_client'),'manual authorization failure displays a concise recovery message without raw JSON');
    assert(d.querySelector('#agy-account-menu').textContent.includes('Reauthorize')&&d.querySelector('#agy-account-badge').textContent.includes('100%'),'failed refresh keeps cached quota and marks the affected account for reauthorization');
    await pause(6100);assert(!d.querySelector('#agy-account-toast'),'authorization error automatically disappears after six seconds');quotaFailure=false;
    await w.__agySuite.save({accounts:false,api:false});await pause(60);
    assert(!d.querySelector('#agy-account-badge')&&!d.querySelector('#agy-account-menu')&&!w.__AGY_MODEL_SWITCHER,'module disable cleans badges, menus and API runtime');
    w.eval(${JSON.stringify(bundle)});await pause(40);
    assert(!w.__AGY_MODEL_SWITCHER&&d.querySelectorAll('#agy-suite-center').length===1,'identical bundle reinjection respects disabled modules and stays idempotent');
    return results;
  }finally{w.__agySuiteCleanup?.();w.__agyAccountSwitcherCleanup?.();w.__AGY_MODEL_SWITCHER_CLEANUP?.();w.__agyThemeSwitcherCleanup?.();w.__agyCnRestore?.();frame.remove();}
 })()`,30000);
 for(const result of results)console.log('PASS '+result);console.log(results.length+' suite browser checks passed.');
}finally{cdp.close();}
