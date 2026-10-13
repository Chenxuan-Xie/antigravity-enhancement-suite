import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// All calls target capture-docs.mjs's disposable, anonymous browser.
export async function recordAnimations({call,evaluate,fixture,pause,onlyModel=false}) {
  const run=(fn,...args)=>evaluate('('+fn.toString()+')('+args.map(value=>JSON.stringify(value)).join(',')+')');
  await call('Emulation.setDeviceMetricsOverride',{width:1399,height:900,deviceScaleFactor:1,mobile:false});
  async function setup(kind) {
    await run(kind=>{
      document.body.innerHTML=window.__docTemplates[kind].html;
      window.__docChat=kind==='chat';window.__docMode=kind==='chat'?'custom':'official';
      history.pushState({},'',kind==='chat'?'/c/00000000-0000-4000-8000-000000000001':'/');
      window.__AGY_MODEL_SWITCHER.refreshState();
    },kind);
    await pause(180);
    await run(()=>{
      const el=document.querySelector('[data-lexical-editor=true]');
      if(el){const root={getWritable:()=>({clear:()=>{el.innerHTML='<p><br></p>';}})};el.__lexicalEditor={update:fn=>fn(),getEditorState:()=>({_nodeMap:new Map([['root',root]])}),_commands:new Map()};}
      const cursor=document.createElement('div');cursor.id='docs-cursor';
      cursor.style.cssText='position:fixed;left:0;top:0;width:18px;height:26px;z-index:20000;pointer-events:none;filter:drop-shadow(0 1px 2px #0005)';
      cursor.innerHTML='<svg width="18" height="26" viewBox="0 0 18 26"><path d="M1 1v21l5-5 4 8 4-2-4-8 7-1z" fill="#252422" stroke="white" stroke-width="1.5"/></svg>';
      document.body.appendChild(cursor);
    });
    if(kind==='settings')await run(()=>document.getElementById('agy-settings-account-switcher').scrollIntoView({block:'end'}));
  }
  const point=selector=>run(selector=>{
    const el=document.querySelector(selector);if(!el)return null;
    const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};
  },selector);
  const openMenu=()=>run(()=>{
    const holder=document.createElement('div');holder.id='docs-model-menu';
    holder.innerHTML=window.__docTemplates.home.menu;document.body.appendChild(holder);window.__AGY_MODEL_SWITCHER.syncAllUI();
    const panel=holder.querySelector('[data-testid=model-selector-panel]');
    const outer=panel.closest('[data-radix-popper-content-wrapper]')||panel.parentElement.parentElement;
    const rect=document.querySelector('[data-testid=model-selector-trigger]').getBoundingClientRect();
    outer.style.transform='translate('+rect.left+'px,'+Math.max(8,rect.top-panel.getBoundingClientRect().height-12)+'px)';
  });
  const recordings=[];
  async function record(name,seconds,steps) {
    const directory=path.join(fixture,name);fs.mkdirSync(directory,{recursive:true});
    let cursor={x:1100,y:760},move=null,step=0;
    for(let frame=0;frame<seconds*20;frame++) {
      const time=frame/20;
      while(step<steps.length&&steps[step].at<=time) {
        const action=steps[step++];
        if(action.target){const to=await point(action.target);assert(to,'Missing animation target '+action.target);move={from:{...cursor},to,start:time,duration:action.move||0.5};}
        if(action.run)await action.run();
      }
      if(move){const p=Math.min(1,(time-move.start)/move.duration),s=p*p*(3-2*p);cursor={x:move.from.x+(move.to.x-move.from.x)*s,y:move.from.y+(move.to.y-move.from.y)*s};}
      await run(({x,y})=>{const c=document.getElementById('docs-cursor');if(c)c.style.transform='translate('+x+'px,'+y+'px)';},cursor);
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:cursor.x,y:cursor.y});
      const visible=await evaluate('document.body.innerText');
      assert(!/\b[A-Z]:[\\/]|googleusercontent|sk-[a-zA-Z0-9]{10}|[\w.+-]+@(?!example\.test)[\w.-]+\.[a-z]{2,}/i.test(visible),'Private data found in animation');
      const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      fs.writeFileSync(path.join(directory,String(frame).padStart(4,'0')+'.png'),Buffer.from(shot.data,'base64'));
    }
    recordings.push({name,frames:seconds*20,durationMs:seconds*1000,fps:20,directory});
    console.log('Recorded '+name+': '+seconds*20+' frames at 20 fps');
  }
  const center=()=>run(()=>window.__agySuite.openCenter());
  const close=()=>run(()=>window.__agySuite.closeCenter());
  const theme=value=>run(value=>{const el=document.querySelector('[data-setting=themeMode]');el.value=value;el.dispatchEvent(new Event('change'));},value);
  if(!onlyModel){await setup('home');await run(()=>window.__agySuite.save({themeMode:'light'}));
  await record('demo-skin-i18n',9,[
    {at:0.4,target:'#agy-suite-sidebar-button'},{at:1,run:center},
    {at:1.5,target:'[data-setting=themeMode]'},{at:2.2,run:()=>theme('dark')},
    {at:3,target:'#agy-suite-close'},{at:3.6,run:close},
    {at:5,target:'#agy-suite-sidebar-button'},{at:5.6,run:center},
    {at:6,target:'[data-setting=themeMode]'},{at:6.7,run:()=>theme('light')},
    {at:7.3,target:'#agy-suite-close'},{at:7.9,run:close}
  ]);}
  await setup('chat');
  await record('demo-model-switcher',8,[
    {at:0.3,target:'[data-testid=model-selector-trigger]'},{at:0.9,run:openMenu},
    {at:1.3,target:'[data-agy-custom-item][data-agy-model-id=demo-claude]'},
    {at:2,run:()=>run(()=>document.querySelector('[data-agy-custom-item][data-agy-model-id=demo-claude]').dispatchEvent(new PointerEvent('pointerenter')))},
    {at:2.1,target:'.agy-ms-effort-submenu > div:first-child',move:0.4},
    {at:2.7,target:'[data-agy-effort=low]',move:0.35},
    {at:3.3,run:()=>run(()=>{document.querySelector('[data-agy-effort=low]').click();document.getElementById('docs-model-menu')?.remove();})},
    {at:4.1,target:'[data-testid=model-selector-trigger]'},{at:4.7,run:openMenu},
    {at:5.1,target:'[data-testid=model-selector-item]:not([data-agy-custom-item])'},
    {at:5.8,run:()=>run(()=>{window.__AGY_MODEL_SWITCHER.selectModel('official');document.getElementById('docs-model-menu')?.remove();})},
    {at:6.5,target:'[data-testid=model-selector-trigger]'}
  ]);
  if(!onlyModel){await setup('settings');
  const updateAccount=()=>run(()=>{
    const widget=document.getElementById('agy-settings-account-switcher'),current=window.__docAccounts.find(account=>account.isCurrent);
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode()))if(!widget.contains(node)&&/^(?:primary|backup)@example\.test$/.test(node.nodeValue.trim()))node.nodeValue=current.email;
    widget.remove();
  });
  await record('demo-account-switcher',8,[
    {at:0.4,target:'.agy-as-card.switchable .agy-as-btn-primary'},
    {at:1.2,run:()=>run(()=>document.querySelector('.agy-as-card.switchable .agy-as-btn-primary').click())},
    {at:2.3,run:updateAccount},
    {at:3.2,target:'[data-as-action=refresh]'},
    {at:3.9,run:()=>run(()=>document.querySelector('[data-as-action=refresh]').click())},
    {at:5,target:'.agy-as-card.switchable .agy-as-btn-primary'},
    {at:5.7,run:()=>run(()=>document.querySelector('.agy-as-card.switchable .agy-as-btn-primary').click())},
    {at:6.7,run:updateAccount}
  ]);}
  fs.writeFileSync(path.join(fixture,'animations.json'),JSON.stringify(recordings,null,2));
  return recordings;
}
