(() => {
  window.__agyQuotaBadgeCleanup?.();
  const API='http://127.0.0.1:19823';let accounts=[],disposed=false,busy=false,requesting=false,lastQuotaFetch=0,refreshAgain=false;
  const notices=new Map();let popup=null,toast=null;
  const text=(cn,en)=>window.__agySuiteSettings?.i18n===false?en:cn;
  function percentage(account,label=''){
    const buckets=(account?.quotaSummary?.groups||[]).flatMap(group=>(group.buckets||[]).map(bucket=>({...bucket,group:group.displayName})));
    const valid=buckets.filter(b=>Number.isFinite(b.remainingPercent));
    const normal=value=>String(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,'');
    const target=normal(label);
    const matched=valid.filter(b=>target&&normal(b.displayName||b.group)&&(target.includes(normal(b.displayName||b.group))||normal(b.displayName||b.group).includes(target)));
    const list=matched.length?matched:valid;
    return list.length?Math.min(...list.map(b=>Math.max(0,Math.min(100,b.remainingPercent)))):null;
  }
  const label=()=>document.querySelector('[data-testid="model-selector-trigger"]')?.textContent||'';
  const generating=()=>!!window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat||!!document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
  const stale=account=>!Number.isFinite(Date.parse(account?.quotaSummary?.updatedAt))||Date.now()-Date.parse(account.quotaSummary.updatedAt)>600000;
  async function request(endpoint,body){const response=await fetch(API+endpoint,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Account service unavailable');return data;}
  async function switchTo(account){if(busy||generating())return;busy=true;render();try{await request('/api/switch',{email:account.email});popup?.remove();popup=null;toast?.remove();toast=null;await refresh();}catch(error){showError(error.message);}finally{busy=false;render();}}
  function showError(message){toast?.remove();toast=document.createElement('div');toast.setAttribute('role','status');toast.style.cssText='position:fixed;right:20px;bottom:24px;z-index:10000;padding:16px;background:var(--background,#fff);color:var(--foreground,#222);border:1px solid var(--border,#888);border-radius:10px;max-width:360px;';toast.textContent=message;const close=document.createElement('button');close.textContent=' ×';close.onclick=()=>{toast.remove();toast=null;};toast.appendChild(close);document.body.appendChild(toast);}
  function remind(force=false){
    if(window.__agySuiteSettings?.quotaReminder===false||window.__AGY_MODEL_SWITCHER?.getState().activeMode==='custom')return;
    const current=accounts.find(a=>a.isCurrent),percent=percentage(current,label());
    if(!current||(!force&&(percent===null||percent>=10||stale(current))))return;
    const key=current.email+':'+label();if(Date.now()-(notices.get(key)||0)<1800000)return;
    notices.set(key,Date.now());
    const backup=accounts.filter(a=>!a.isCurrent&&!stale(a)&&percentage(a,label())!==null&&percentage(a,label())>(percent??-1)).sort((a,b)=>percentage(b,label())-percentage(a,label()))[0];
    showError(text('当前账号配额即将用尽','Current account quota is low')+(backup?' · '+(backup.label||backup.email)+' '+percentage(backup,label())+'%':''));
    if(backup){const button=document.createElement('button');button.textContent=text('切换至备用账号','Switch account');button.disabled=generating();button.onclick=()=>switchTo(backup);toast.appendChild(button);}
  }
  function openMenu(button){
    popup?.remove();popup=document.createElement('div');popup.id='agy-account-menu';popup.setAttribute('role','menu');popup.setAttribute('data-ag-localization-skip','true');
    const bounds=button.getBoundingClientRect();popup.style.cssText=`position:fixed;z-index:10000;left:${Math.max(8,Math.min(bounds.left,innerWidth-310))}px;bottom:${Math.max(8,innerHeight-bounds.top+8)}px;width:300px;max-height:320px;overflow:auto;padding:8px;border-radius:10px;border:1px solid var(--border,#8885);background:var(--background,#fff);color:var(--foreground,#222);box-shadow:0 4px 20px #0002;`;
    for(const account of accounts){const row=document.createElement('button');row.setAttribute('role','menuitem');row.style.cssText='display:block;text-align:left;width:100%;padding:8px;background:transparent;color:inherit;';
      const percent=percentage(account,label());row.textContent=(account.isCurrent?'✓ ':'')+(account.label||account.email)+' · '+(percent===null?text('配额未知','quota unknown'):percent+'%')+(stale(account)?text('（缓存）',' (cached)'):'');row.disabled=account.isCurrent||busy||generating();row.onclick=()=>switchTo(account);popup.appendChild(row);}
    const refreshButton=document.createElement('button');refreshButton.textContent=text('刷新当前账号配额','Refresh current quota');refreshButton.onclick=async()=>{refreshButton.disabled=true;lastQuotaFetch=0;await refresh();openMenu(button);};popup.appendChild(refreshButton);
    popup.addEventListener('keydown',event=>{const rows=[...popup.querySelectorAll('button:not(:disabled)')];let index=rows.indexOf(document.activeElement);if(event.key==='Escape'){popup.remove();popup=null;button.focus();}else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();rows[(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();}});
    document.body.appendChild(popup);popup.querySelector('button:not(:disabled)')?.focus();
  }
  function render(){
    if(disposed)return;const composer=document.querySelector('[data-testid="agent-input-box"]');if(!composer)return;
    let button=document.getElementById('agy-account-badge');if(!button){button=document.createElement('button');button.id='agy-account-badge';button.type='button';button.setAttribute('aria-haspopup','menu');button.setAttribute('data-ag-localization-skip','true');button.style.cssText='border:1px solid var(--border,#8885);border-radius:14px;padding:3px 10px;margin:4px 8px;background:transparent;color:inherit;font:12px system-ui;';button.onclick=()=>openMenu(button);}
    if(button.parentElement!==composer)composer.appendChild(button);
    const current=accounts.find(a=>a.isCurrent),percent=percentage(current,label());
    const title=(current?.label||current?.email||text('账号','Account'))+' · '+(percent===null?text('配额未知','quota unknown'):percent+'%')+(current&&stale(current)?text('（缓存）',' (cached)'):'');
    if(button.textContent!==title)button.textContent=title;button.disabled=busy;button.title=text('点击切换账号；百分比为当前模型匹配配额，无法匹配时显示最低配额。','Switch accounts; matching model quota or the lowest known quota.');
  }
  async function refresh(){if(disposed)return;if(requesting){refreshAgain=true;return;}requesting=true;try{
    let data=await request('/api/accounts');accounts=data.accounts||[];
    const current=accounts.find(a=>a.isCurrent);if(current&&Date.now()-lastQuotaFetch>300000){lastQuotaFetch=Date.now();data=await request('/api/accounts/quota',{email:current.email});accounts=data.accounts||accounts;}
    if(!disposed){render();remind();}
  }catch(error){if(!disposed)console.warn('[Account badge]',error.message);}finally{requesting=false;if(refreshAgain&&!disposed){refreshAgain=false;refresh();}}}
  function onAccountsUpdated(event){if(Array.isArray(event.detail)){accounts=event.detail;render();remind();}}
  function onMessage(event){if(/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(event.origin)&&event.data?.type==='agy-account-switcher-updated')refresh();}
  window.addEventListener('agy-accounts-updated',onAccountsUpdated);window.addEventListener('message',onMessage);
  function onPointer(event){if(popup&&!popup.contains(event.target)&&!event.target.closest('#agy-account-badge')){popup.remove();popup=null;}}
  document.addEventListener('pointerdown',onPointer);
  const observer=new MutationObserver(mutations=>{
    render();
    for(const mutation of mutations)for(const node of mutation.addedNodes){if(node.nodeType!==1)continue;
      const alert=node.matches?.('[role="alert"]')?node:node.querySelector?.('[role="alert"]');
      if(alert&&!alert.closest('#agy-ms-error-notice')&&/(hit.*limit|quota.*exceeded|resource.?exhausted|配额.*限制|达到.*配额)/i.test(alert.textContent))remind(true);
    }
  });observer.observe(document.documentElement,{childList:true,subtree:true});
  const timer=setInterval(refresh,60000);refresh();
  window.__agyQuotaBadge={percentage,refresh,getAccounts:()=>accounts};
  window.__agyQuotaBadgeCleanup=()=>{disposed=true;observer.disconnect();clearInterval(timer);document.removeEventListener('pointerdown',onPointer);window.removeEventListener('agy-accounts-updated',onAccountsUpdated);window.removeEventListener('message',onMessage);document.getElementById('agy-account-badge')?.remove();popup?.remove();toast?.remove();};
  const cleanup=window.__agyAccountSwitcherCleanup;window.__agyAccountSwitcherCleanup=()=>{window.__agyQuotaBadgeCleanup();cleanup?.();};
})();
