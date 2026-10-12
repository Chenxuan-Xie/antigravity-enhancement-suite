'use strict';
function skinPalette(settings,systemDark=false){
  const dark=settings.themeMode==='dark'||(settings.themeMode==='system'&&systemDark);
  return {background:dark?'#1F1E1D':'#FAF9F5',foreground:dark?'#ECE9E2':'#3D3A34'};
}

function startupSource(settings,css,bundle){
  return `(()=>{
    if(window!==window.top||!/^https?:\\/\\/127\\.0\\.0\\.1(?::|\\/)/.test(location.href))return;
    window.__agyStartupPreparedAt=performance.now();
    window.__agySuiteInitialSettings=${JSON.stringify(settings)};
    const settings=window.__agySuiteInitialSettings,original=[];
    const seed=()=>{
      if(!settings.skin||!document.head)return;
      let style=document.getElementById('agy-claude-skin');
      if(!style){style=document.createElement('style');style.id='agy-claude-skin';style.textContent=${JSON.stringify(css)};document.head.appendChild(style);window.__agyAppearanceSeededAt=performance.now();}
      const dark=settings.themeMode==='dark'||(settings.themeMode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
      for(const el of [document.documentElement,document.body].filter(Boolean)){
        if(!original.some(item=>item.el===el))original.push({el,classes:new Map(['dark','dark-theme','theme-dark','theme-light','theme-standalone'].map(name=>[name,el.classList.contains(name)])),attrs:new Map(['data-claude-theme','data-claude-theme-mode','data-ag-theme-seeded'].map(name=>[name,el.getAttribute(name)]))});
        el.classList.toggle('dark',dark);el.classList.toggle('theme-dark',dark);el.classList.toggle('theme-light',!dark);
        el.dataset.claudeTheme=dark?'dark':'light';
      }
    };
    const observer=new MutationObserver(seed);observer.observe(document,{childList:true,subtree:true});seed();
    const start=()=>{seed();observer.disconnect();if(original.length)window.__agySuiteStartupTheme=original;
      ${bundle}
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  })();`;
}

function installEarlyRenderer(win,readAssets){
  const debuggerApi=win.webContents.debugger;
  if(!debuggerApi||debuggerApi.isAttached())return {refresh:async()=>false};
  debuggerApi.attach('1.3');
  let identifier,queue=Promise.resolve();
  const refresh=()=>{
    queue=queue.catch(()=>{}).then(async()=>{
      if(win.isDestroyed()||!debuggerApi.isAttached())return false;
      const {settings,css,bundle}=readAssets();
      await debuggerApi.sendCommand('Page.enable');
      const next=await debuggerApi.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:startupSource(settings,css,bundle)});
      const previous=identifier;identifier=next.identifier;
      if(previous)await debuggerApi.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier:previous});
      return true;
    });
    return queue;
  };
  const load=win.webContents.loadURL.bind(win.webContents);
  win.webContents.loadURL=async(...args)=>{
    let timer;
    try{await Promise.race([refresh(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('startup preparation timed out')),1500);})]);}
    catch(error){console.warn('[Suite] Early appearance unavailable:',error.message);}
    finally{clearTimeout(timer);}
    return load(...args);
  };
  return {refresh};
}
module.exports={skinPalette,startupSource,installEarlyRenderer};
