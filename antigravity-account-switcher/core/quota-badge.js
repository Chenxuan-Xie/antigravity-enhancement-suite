(() => {
  window.__agyQuotaBadgeCleanup?.();
  const API='http://127.0.0.1:19823';let accounts=[],disposed=false,busy=false,requesting=false,lastQuotaFetch=0,refreshAgain=false;
  const notices=new Map(),authIssues=new Map();let popup=null,toast=null,toastTimer=null;
  const text=(cn,en)=>window.__agySuiteSettings?.i18n===false?en:cn;
  const style=document.createElement('style');style.id='agy-account-capsule-style';style.textContent=`
    #agy-account-capsule{display:flex;align-items:center;justify-content:flex-end;align-self:flex-end;flex:0 0 auto;margin:4px 12px 8px;max-width:100%}
    #agy-account-badge{display:inline-flex;align-items:center;gap:7px;flex:0 0 auto;width:auto!important;max-width:240px;border:1px solid var(--border,#8883);border-radius:999px;padding:5px 10px;margin:0;background:transparent;color:inherit;font:12px system-ui;cursor:pointer;transition:background .15s,border-color .15s}
    #agy-account-badge:hover,#agy-account-badge:focus-visible{background:#8882;border-color:#8885;outline:none}
    #agy-account-badge .quota-dot{width:6px;height:6px;border-radius:50%;background:#5c8b67;flex-shrink:0}#agy-account-badge[data-low=true] .quota-dot{background:#c57d46}
    #agy-account-badge .quota-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#agy-account-badge .quota-chevron{opacity:.55;font-size:11px}
    #agy-account-menu{position:fixed;z-index:10000;width:300px;max-width:calc(100vw - 16px);max-height:min(360px,calc(100vh - 24px));overflow:auto;padding:8px;border-radius:12px;border:1px solid var(--border,#8883);background:var(--agy-bg-primary,var(--background,#fff));color:var(--agy-text-primary,var(--foreground,#222));box-shadow:0 8px 32px #0002;font:13px system-ui;box-sizing:border-box}
    #agy-account-menu .quota-menu-title{padding:4px 8px 8px;opacity:.6;font-size:11px}#agy-account-menu button{display:flex;align-items:center;gap:8px;text-align:left;width:100%;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer;transition:background .15s}
    #agy-account-menu button:hover:not(:disabled),#agy-account-menu button:focus-visible{background:#8882;outline:none}#agy-account-menu button:disabled{cursor:default}#agy-account-menu button[data-current=true]{background:#8881}
    #agy-account-menu .quota-account-info{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}#agy-account-menu .quota-account-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}#agy-account-menu .quota-account-meta{font-size:11px;opacity:.6}
    #agy-account-menu .quota-meter{height:3px;border-radius:3px;background:#8882;overflow:hidden}#agy-account-menu .quota-meter span{display:block;height:100%;background:#6a9374;border-radius:3px}#agy-account-menu .quota-meter[data-low=true] span{background:#c57d46}
    #agy-account-menu .quota-percent{font-variant-numeric:tabular-nums;font-size:12px}#agy-account-menu [data-quota-refresh]{margin-top:6px;border-top:1px solid #8882;border-radius:0 0 8px 8px;color:inherit}#agy-account-menu [data-quota-refresh]:disabled{opacity:.55}
    #agy-account-toast{position:fixed;right:20px;bottom:24px;z-index:10001;padding:12px 14px;display:flex;align-items:center;gap:10px;background:var(--agy-bg-primary,var(--background,#fff));color:var(--agy-text-primary,var(--foreground,#222));border:1px solid var(--border,#8883);border-radius:10px;max-width:min(360px,calc(100vw - 40px));box-shadow:0 4px 20px #0002;font:12px system-ui}#agy-account-toast button{background:transparent;color:inherit;border:0;padding:4px;border-radius:5px;cursor:pointer}#agy-account-toast button:hover{background:#8882}
  `;document.head.appendChild(style);
  const friendlyError=message=>/unauthorized|invalid_grant|invalid_client|HTTP 401/i.test(message)?text('账号授权已失效，请在「设置 → 账户」重新授权。','Account authorization expired. Reauthorize in Settings → Account.'):/timeout|timed out/i.test(message)?text('刷新超时，请稍后重试。','Refresh timed out. Try again shortly.'):text('操作失败，请稍后重试。','Operation failed. Please try again.');
  function closeToast(){clearTimeout(toastTimer);toastTimer=null;toast?.remove();toast=null;}
  function closeMenu(){popup?.remove();popup=null;document.getElementById('agy-account-badge')?.setAttribute('aria-expanded','false');}
  function selection(account,label=''){
    const buckets=(account?.quotaSummary?.groups||[]).flatMap(group=>(group.buckets||[]).map(bucket=>({...bucket,group:group.displayName})));
    const normal=value=>String(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,'').replace(/models?$|模型$/,'');
    const target=normal(label);
    const matches=value=>String(value||'').split(/\s+and\s+|[\/&,|]/i).some(part=>{const name=normal(part);return target&&name&&(target.includes(name)||name.includes(target));});
    const matched=buckets.filter(b=>matches(b.group)||matches(b.displayName));
    const list=(matched.length?matched:buckets).filter(b=>Number.isFinite(b.remainingPercent));
    let selected=null;
    for(const bucket of list){
      const period=String(bucket.window||'').toLowerCase();
      const window=period==='5h'?'5h':/^(week|weekly)$/.test(period)?'weekly':null;
      const percent=Math.max(0,Math.min(100,bucket.remainingPercent));
      if(!selected||percent<selected.percent||(percent===selected.percent&&window==='weekly'&&selected.window!=='weekly'))selected={percent,window};
    }
    return selected;
  }
  const percentage=(account,label='')=>selection(account,label)?.percent??null;
  const periodLabel=quota=>quota?.window==='5h'?'5h':quota?.window==='weekly'?text('周','week'):'';
  const quotaLabel=quota=>quota?[periodLabel(quota),quota.percent+'%'].filter(Boolean).join(' '):'—';
  const label=()=>{const button=document.querySelector('[data-testid="model-selector-trigger"]');return button?.querySelector('.agy-ms-trigger-custom-label')?.textContent||button?.innerText||button?.textContent||'';};
  const generating=()=>!!window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat||!!document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
  const stale=account=>!Number.isFinite(Date.parse(account?.quotaSummary?.updatedAt))||Date.now()-Date.parse(account.quotaSummary.updatedAt)>600000;
  async function request(endpoint,body){const response=await fetch(API+endpoint,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Account service unavailable');return data;}
  async function switchTo(account){if(busy||generating())return;busy=true;render();try{await request('/api/switch',{email:account.email});closeMenu();closeToast();await refresh();}catch(error){showError(friendlyError(error.message));}finally{busy=false;render();}}
  function showError(message){closeToast();toast=document.createElement('div');toast.id='agy-account-toast';toast.setAttribute('role','status');toast.setAttribute('data-ag-localization-skip','true');const content=document.createElement('span');content.textContent=/unauthorized|invalid_grant|invalid_client|HTTP 401/i.test(message)?friendlyError(message):message;toast.appendChild(content);const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label',text('关闭提示','Dismiss notification'));close.onclick=closeToast;toast.appendChild(close);document.body.appendChild(toast);toastTimer=setTimeout(closeToast,6000);}
  function remind(force=false){
    if(window.__agySuiteSettings?.quotaReminder===false||window.__AGY_MODEL_SWITCHER?.getState().activeMode==='custom')return;
    const current=accounts.find(a=>a.isCurrent),percent=percentage(current,label());
    if(!current||authIssues.has(current.email)||(!force&&(percent===null||percent>=10||stale(current))))return;
    const key=current.email+':'+label();if(Date.now()-(notices.get(key)||0)<1800000)return;
    notices.set(key,Date.now());
    const backup=accounts.filter(a=>!a.isCurrent&&!stale(a)&&percentage(a,label())!==null&&percentage(a,label())>(percent??-1)).sort((a,b)=>percentage(b,label())-percentage(a,label()))[0];
    showError(text('当前账号配额即将用尽','Current account quota is low')+(backup?' · '+(backup.label||backup.email)+' '+percentage(backup,label())+'%':''));
    if(backup){const button=document.createElement('button');button.textContent=text('切换至备用账号','Switch account');button.disabled=generating();button.onclick=()=>switchTo(backup);toast.appendChild(button);}
  }
  function openMenu(button){
    if(disposed||window.__agySuiteSettings?.showQuota===false||!button.isConnected)return;closeMenu();popup=document.createElement('div');popup.id='agy-account-menu';popup.setAttribute('role','menu');popup.setAttribute('data-ag-localization-skip','true');button.setAttribute('aria-expanded','true');
    const bounds=button.getBoundingClientRect();popup.style.left=Math.max(8,Math.min(bounds.right-300,innerWidth-308))+'px';if(bounds.top>200)popup.style.bottom=Math.max(8,innerHeight-bounds.top+8)+'px';else popup.style.top=Math.min(innerHeight-200,bounds.bottom+8)+'px';
    const heading=document.createElement('div');heading.className='quota-menu-title';heading.textContent=text('账号与剩余额度','Accounts · remaining quota');popup.appendChild(heading);
    for(const account of accounts){const row=document.createElement('button');row.type='button';row.setAttribute('role','menuitem');row.dataset.current=String(!!account.isCurrent);
      const quota=selection(account,label()),percent=quota?.percent??null,info=document.createElement('span');info.className='quota-account-info';const name=document.createElement('span');name.className='quota-account-name';name.textContent=(account.isCurrent?'✓ ':'')+(account.label||account.email);info.appendChild(name);
      const meta=document.createElement('span');meta.className='quota-account-meta';meta.textContent=authIssues.has(account.email)?text('需重新授权 · 显示缓存额度','Reauthorize · cached quota'):stale(account)?text('缓存额度','Cached quota'):text('最新额度','Latest quota');info.appendChild(meta);
      if(percent!==null){const meter=document.createElement('span');meter.className='quota-meter';meter.dataset.low=String(percent<10);const fill=document.createElement('span');fill.style.width=percent+'%';meter.appendChild(fill);info.appendChild(meter);}
      const value=document.createElement('span');value.className='quota-percent';value.textContent=quotaLabel(quota);row.append(info,value);row.disabled=account.isCurrent||busy||generating();row.onclick=()=>switchTo(account);popup.appendChild(row);}
    const refreshButton=document.createElement('button');refreshButton.type='button';refreshButton.setAttribute('role','menuitem');refreshButton.dataset.quotaRefresh='true';refreshButton.disabled=requesting;refreshButton.textContent='↻ '+text('刷新当前账号配额','Refresh current quota');refreshButton.onclick=async()=>{refreshButton.disabled=true;refreshButton.textContent=text('正在刷新…','Refreshing…');const menu=popup;lastQuotaFetch=0;await refresh({notify:true});if(!disposed&&popup===menu&&button.isConnected)openMenu(button);};popup.appendChild(refreshButton);
    popup.addEventListener('keydown',event=>{const rows=[...popup.querySelectorAll('button:not(:disabled)')];let index=rows.indexOf(document.activeElement);if(event.key==='Escape'){closeMenu();button.focus();}else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();rows[(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();}});
    document.body.appendChild(popup);popup.querySelector('button:not(:disabled)')?.focus();
  }
  function render(){
    if(disposed)return;if(window.__agySuiteSettings?.showQuota===false){document.getElementById('agy-account-capsule')?.remove();document.getElementById('agy-account-badge')?.remove();closeMenu();return;}const composer=document.querySelector('[data-testid="agent-input-box"]');if(!composer)return;
    let host=document.getElementById('agy-account-capsule');if(!host){host=document.createElement('div');host.id='agy-account-capsule';}if(host.parentElement!==composer)composer.appendChild(host);
    let button=document.getElementById('agy-account-badge');if(!button){button=document.createElement('button');button.id='agy-account-badge';button.type='button';button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');button.setAttribute('data-ag-localization-skip','true');button.innerHTML='<span class="quota-dot" aria-hidden="true"></span><span class="quota-label"></span><span class="quota-chevron" aria-hidden="true">⌄</span>';button.onclick=()=>{if(popup)closeMenu();else openMenu(button);};}
    if(button.parentElement!==host)host.appendChild(button);
    const current=accounts.find(a=>a.isCurrent),quota=selection(current,label()),percent=quota?.percent??null;
    const title=(current?.label||current?.email||text('账号','Account'))+' · '+(quota?quotaLabel(quota):text('配额未知','quota unknown'))+(current&&(stale(current)||authIssues.has(current.email))?text('（缓存）',' (cached)'):'');
    const caption=button.querySelector('.quota-label');if(caption.textContent!==title)caption.textContent=title;button.dataset.low=String(percent!==null&&percent<10);button.disabled=busy;button.title=text('点击切换账号；显示当前模型周与 5h 额度中剩余更低的一项，相同时显示周额度；无法匹配模型时显示最低已知额度。','Switch accounts; shows the lower weekly or 5h quota for this model, weekly on ties. Unknown models use the lowest known quota.');
  }
  async function refresh({notify=false}={}){if(disposed)return;if(requesting){refreshAgain=true;return;}requesting=true;try{
    let data=await request('/api/accounts');accounts=data.accounts||[];
    const current=accounts.find(a=>a.isCurrent);if(current&&Date.now()-lastQuotaFetch>300000&&(window.__agySuiteSettings?.showQuota!==false||window.__agySuiteSettings?.quotaReminder!==false)){lastQuotaFetch=Date.now();try{data=await request('/api/accounts/quota',{email:current.email});accounts=data.accounts||accounts;authIssues.delete(current.email);}catch(error){authIssues.set(current.email,friendlyError(error.message));if(notify)showError(friendlyError(error.message));}}
    if(!disposed){render();remind();}
  }catch(error){if(!disposed){if(notify)showError(friendlyError(error.message));render();}}finally{requesting=false;if(refreshAgain&&!disposed){refreshAgain=false;refresh();}}}
  function onAccountsUpdated(event){if(Array.isArray(event.detail)){accounts=event.detail;render();remind();}}
  function onMessage(event){if(/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(event.origin)&&event.data?.type==='agy-account-switcher-updated')refresh();}
  window.addEventListener('agy-accounts-updated',onAccountsUpdated);window.addEventListener('message',onMessage);
  window.addEventListener('agy-suite-settings-updated',render);
  function onPointer(event){if(popup&&!popup.contains(event.target)&&!event.target.closest('#agy-account-badge'))closeMenu();}
  document.addEventListener('pointerdown',onPointer);
  const observer=new MutationObserver(mutations=>{
    render();
    for(const mutation of mutations)for(const node of mutation.addedNodes){if(node.nodeType!==1)continue;
      const alert=node.matches?.('[role="alert"]')?node:node.querySelector?.('[role="alert"]');
      if(alert&&!alert.closest('#agy-ms-error-notice')&&/(hit.*limit|quota.*exceeded|resource.?exhausted|配额.*限制|达到.*配额)/i.test(alert.textContent))remind(true);
    }
  });observer.observe(document.documentElement,{childList:true,subtree:true});
  const timer=setInterval(refresh,60000);refresh();
  window.__agyQuotaBadge={percentage,selection,refresh,getAccounts:()=>accounts};
  window.__agyQuotaBadgeCleanup=()=>{disposed=true;observer.disconnect();clearInterval(timer);document.removeEventListener('pointerdown',onPointer);window.removeEventListener('agy-accounts-updated',onAccountsUpdated);window.removeEventListener('message',onMessage);window.removeEventListener('agy-suite-settings-updated',render);document.getElementById('agy-account-capsule')?.remove();document.getElementById('agy-account-badge')?.remove();closeMenu();closeToast();style.remove();};
  const cleanup=window.__agyAccountSwitcherCleanup;window.__agyAccountSwitcherCleanup=()=>{window.__agyQuotaBadgeCleanup();cleanup?.();};
})();
