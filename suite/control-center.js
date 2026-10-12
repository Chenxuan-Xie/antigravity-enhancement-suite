(() => {
  const API='http://127.0.0.1:19823';
  window.__agySuiteCleanup?.();
  let disposed=false,settings=null,saving=false,queued={},pending={},saveTask=null,statusMessage='',statusError=false,poll,scheduled=false,returnFocus=null;
  const active={};
  const labels={skin:['Claude 皮肤','Claude theme'],i18n:['中文汉化','Chinese localization'],accounts:['多账号切换','Account switcher'],api:['API 中转切换','API model switcher'],guardian:['更新自愈守护（计划任务）','Update recovery (scheduled task)'],showQuota:['显示账号额度','Show account quota'],showUsage:['显示 Token 消耗','Show token usage'],quotaReminder:['配额低水位提醒','Low quota reminders']};
  const text=(cn,en)=>settings?.i18n?cn:en;
  const style=document.createElement('style');style.id='agy-suite-style';
  document.querySelectorAll('.agy-claude-hero-greeting,.agy-claude-starter-pills').forEach(el=>el.remove());
  style.textContent=`#agy-suite-center{border:1px solid var(--border,#8885);border-radius:12px;padding:18px;margin:16px 0;color:var(--foreground,inherit);background:var(--background,inherit);font:13px system-ui}#agy-suite-center h2{font-size:16px;margin:0 0 12px}#agy-suite-center .suite-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0}#agy-suite-center input[type=checkbox]{appearance:none;width:36px;height:20px;border-radius:12px;background:#8887;cursor:pointer;position:relative;flex-shrink:0}#agy-suite-center input[type=checkbox]:after{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;background:white;border-radius:50%}#agy-suite-center input:checked{background:#bd684b}#agy-suite-center input:checked:after{left:19px}#agy-suite-center select,#agy-suite-center input[type=text]{border:1px solid var(--border,#8885);border-radius:6px;padding:5px;background:var(--background,inherit);color:inherit;max-width:210px}#agy-suite-center input:focus-visible,#agy-suite-center select:focus-visible{outline:2px solid #bd684b;outline-offset:2px}.agy-suite-greeting{font:28px system-ui;margin:0 0 22px;text-align:center}`;
  document.head.appendChild(style);
  style.textContent+=`#agy-suite-backdrop{position:fixed;inset:0;z-index:10000;background:#0005;display:flex;align-items:center;justify-content:center;padding:24px}#agy-suite-center{position:relative;width:min(580px,100%);max-height:calc(100vh - 48px);overflow:auto;margin:0;background:var(--agy-bg-primary,var(--background,#fff));color:var(--agy-text-primary,var(--foreground,#222));box-sizing:border-box;box-shadow:0 16px 60px #0003}#agy-suite-close{position:absolute;right:12px;top:10px;border:0;background:transparent;color:inherit;border-radius:6px;padding:4px 8px;cursor:pointer}#agy-suite-close:hover,#agy-suite-close:focus-visible{background:#8882}#agy-suite-sidebar-button{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}#agy-suite-sidebar-button:hover,#agy-suite-sidebar-button:focus-visible{background:var(--sidebar-muted,#8882);outline:none}#agy-suite-sidebar-button svg{flex-shrink:0}#agy-suite-sidebar-button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}`;
  style.textContent+=`#agy-suite-center{width:min(660px,100%);padding:26px;border-radius:20px;font:13px/1.5 system-ui;box-shadow:0 24px 90px #0003}#agy-suite-center h2{font-size:20px;font-weight:600;margin:0;letter-spacing:-.02em}#agy-suite-center .suite-subtitle{margin:5px 0 22px;opacity:.55;font-size:12px}#agy-suite-center h3{font-size:11px;font-weight:600;letter-spacing:.08em;opacity:.55;margin:20px 0 10px}#agy-suite-center .suite-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}#agy-suite-center .suite-feature{padding:13px;border:1px solid #8882;border-radius:12px;background:#88805;align-items:center;gap:12px;cursor:pointer}#agy-suite-center .suite-feature:hover{background:#8881}#agy-suite-center .suite-description{display:block;margin-top:3px;font-size:11px;line-height:1.4;opacity:.55}#agy-suite-center .suite-form{padding:4px 14px;border:1px solid #8882;border-radius:12px}#agy-suite-center .suite-form .suite-row{padding:11px 0}#agy-suite-center .suite-form .suite-row+.suite-row{border-top:1px solid #8881}#agy-suite-center .suite-row{font-size:13px}#agy-suite-center input[type=checkbox]{height:22px;width:38px;transition:background .15s}#agy-suite-center input[type=checkbox]:after{width:16px;height:16px;transition:left .15s}#agy-suite-center input:checked:after{left:19px}#agy-suite-center input[data-pending=true]{opacity:.65;cursor:wait}#agy-suite-center input:disabled,#agy-suite-center select:disabled{opacity:.5;cursor:default}#agy-suite-center select,#agy-suite-center input[type=text]{font:12px system-ui;padding:7px 9px;max-width:230px;background:transparent;border-color:#8883}#agy-suite-center [role=status]{margin:18px 0 0;padding-top:13px;border-top:1px solid #8882;font-size:11px;opacity:.65;min-height:18px}#agy-suite-center [role=status][data-error=true]{color:#c55745;opacity:1}#agy-suite-close{right:20px;top:20px;font-size:20px;line-height:24px;width:32px;height:32px;padding:2px}.agy-suite-greeting{font-family:var(--agy-suite-greeting-font,var(--claude-font-serif));font-size:34px;line-height:1.25;letter-spacing:-.015em}.agy-suite-greeting svg{color:#D97757;width:38px;height:38px;filter:drop-shadow(0 3px 10px #D9775738);animation:agySuiteLogoBreath 4.5s ease-in-out infinite}@keyframes agySuiteLogoBreath{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-2px) scale(1.03)}}@media(prefers-reduced-motion:reduce){.agy-suite-greeting svg{animation:none}}@media(max-width:560px){#agy-suite-center{padding:20px}#agy-suite-center .suite-grid{grid-template-columns:1fr}#agy-suite-center select,#agy-suite-center input[type=text]{max-width:180px}}`;
  async function request(patch){const res=await fetch(API+'/api/suite/settings',{method:patch?'POST':'GET',headers:{'Content-Type':'application/json'},body:patch?JSON.stringify(patch):undefined,signal:AbortSignal.timeout(25000)});const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'Suite service unavailable');return data.settings;}
  function apply(next){
    if(settings&&JSON.stringify(settings)===JSON.stringify(next))return;
    const previous=settings;
    settings=next;window.__agySuiteSettings=settings;
    for(const key of ['i18n','accounts','api','skin']){
      if(active[key]===next[key])continue;
      if(key==='api'&&!next.api&&window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat)continue;
      if(next[key])window.__agySuiteModules[key]?.();
      else if(key==='i18n')window.__agyCnRestore?.();
      else if(key==='accounts')window.__agyAccountSwitcherCleanup?.();
      else if(key==='skin') {window.__agyThemeSwitcherCleanup?.();delete window.__AGY_THEME_SWITCHER;}
      else {window.__AGY_MODEL_SWITCHER_CLEANUP?.();delete window.__AGY_MODEL_SWITCHER;}
      active[key]=next[key];
    }
    let skin=document.getElementById('agy-claude-skin');
    if(next.skin){if(!skin){skin=document.createElement('style');skin.id='agy-claude-skin';document.head.appendChild(skin);}if(skin.textContent!==window.__agySuiteTheme)skin.textContent=window.__agySuiteTheme;}
    else {skin?.remove();window.__agyClaudeObserver?.disconnect();delete window.__agyClaudeObserver;document.querySelectorAll('.agy-claude-hero-greeting,.agy-claude-starter-pills').forEach(el=>el.remove());}
    if(next.skin&&next.themeMode&&(!previous?.skin||previous.themeMode!==next.themeMode))window.__AGY_THEME_SWITCHER?.setMode(next.themeMode,{fromSuite:true});
    localStorage.setItem('__agy_greeting_name__',next.greetingName);
    let typography=document.getElementById('agy-suite-typography');
    if(!typography){typography=document.createElement('style');typography.id='agy-suite-typography';document.head.appendChild(typography);}
    if(document.head.lastElementChild!==typography)document.head.appendChild(typography);
    document.getElementById('agy-suite-fonts')?.remove();
    const font=next.replyFont==='default'?(next.skin?'var(--claude-font-serif)':'inherit'):next.replyFont==='sans'?'system-ui, sans-serif':`'ClaudeSerif', 'Noto Serif SC', 'SimSun', serif`;
    const size={small:14,standard:15.5,large:18}[next.replySize];
    const typographyCss=next.skin?`[data-testid="planner-response-text"],.md-divider-spacing{font-family:${font}!important;font-size:${size}px!important}`:'';
    if(typography.textContent!==typographyCss)typography.textContent=typographyCss;
    renderCenter(false);mountSidebar();mountGreeting();window.dispatchEvent(new CustomEvent('agy-suite-settings-updated'));
  }
  function save(patch){
    if(patch.api===false&&window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat){statusError=true;statusMessage=text('请先等待或停止正在运行的 API 请求','Finish or stop the active API request first');renderCenter(false);return Promise.resolve();}
    Object.assign(queued,patch);Object.assign(pending,patch);statusError=false;statusMessage=text('正在保存…','Saving…');renderCenter(false);
    if(saveTask)return saveTask;
    saving=true;
    saveTask=(async()=>{
      try{while(Object.keys(queued).length){const update=queued;queued={};const next=await request(update);if(disposed)return;for(const key of Object.keys(update))if(!(key in queued))delete pending[key];apply(next);renderCenter(false);}statusMessage=text('已保存','Saved');}
      catch(error){queued={};pending={};statusError=true;statusMessage=error.message;}
      finally{saving=false;saveTask=null;if(!disposed)renderCenter(false);}
    })();return saveTask;
  }
  function mountGreeting(){
    const home=[...document.querySelectorAll('[data-testid="agent-input-box"]')].find(el=>!location.pathname.startsWith('/c/'));
    const old=document.querySelector('.agy-suite-greeting');
    if(!home||!settings.skin){old?.remove();return;}
    const hour=new Date().getHours();const title=text(hour<12?'早上好':hour<18?'下午好':'晚上好',hour<12?'Good morning':hour<18?'Good afternoon':'Good evening')+(settings.greetingName?text('，',', ')+settings.greetingName:'');
    const greeting=old||document.createElement('div');greeting.className='agy-suite-greeting';greeting.setAttribute('data-ag-localization-skip','true');
    if(!greeting.querySelector('.agy-suite-greeting-text'))greeting.innerHTML='<svg width="44" height="44" viewBox="0 0 180 180" fill="currentColor" aria-hidden="true"><path d="M144.248 149.062C151.748 154.688 162.998 150.938 152.685 140.625C121.748 110.625 128.31 28.125 89.8727 28.125C51.4352 28.125 57.9977 110.625 27.0602 140.625C15.8102 151.875 27.9977 154.688 35.4977 149.062C64.5602 129.375 62.6852 94.6875 89.8727 94.6875C117.06 94.6875 115.185 129.375 144.248 149.062Z"/></svg><span class="agy-suite-greeting-text"></span>';
    if(greeting.style.display!=='flex')greeting.style.cssText='display:flex;align-items:center;justify-content:center;gap:12px';
    const greetingText=greeting.querySelector('.agy-suite-greeting-text');if(greetingText.textContent!==title)greetingText.textContent=title;
    const font=settings.replyFont==='sans'?'system-ui, sans-serif':'var(--claude-font-serif)';if(greeting.style.getPropertyValue('--agy-suite-greeting-font')!==font)greeting.style.setProperty('--agy-suite-greeting-font',font);
    if(greeting.parentElement!==home.parentElement)home.parentElement.insertBefore(greeting,home);
  }
  function mountSidebar(){
    const api=document.querySelector('[data-agy-custom-api-nav="1"]'),custom=document.querySelector('a[href="/customizations"]');
    const anchor=api||custom;if(!anchor?.parentElement)return;
    let button=document.getElementById('agy-suite-sidebar-button');
    if(!button){button=document.createElement('button');button.id='agy-suite-sidebar-button';button.type='button';button.setAttribute('data-ag-localization-skip','true');button.setAttribute('aria-haspopup','dialog');button.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--agy-bg-primary,var(--background,#fff))"/><circle cx="15" cy="17" r="3" fill="var(--agy-bg-primary,var(--background,#fff))"/></svg><span></span>';button.onclick=openCenter;}
    const name=text('增强套件控制中心','Enhancement Suite');if(button.lastElementChild.textContent!==name)button.lastElementChild.textContent=name;
    if(api){if(button.nextElementSibling!==api)api.before(button);}
    else if(custom.nextElementSibling!==button)custom.after(button);
  }
  function closeCenter(){document.getElementById('agy-suite-backdrop')?.remove();returnFocus?.focus();returnFocus=null;}
  function openCenter(){
    if(document.getElementById('agy-suite-backdrop'))return;
    returnFocus=document.activeElement;const backdrop=document.createElement('div');backdrop.id='agy-suite-backdrop';backdrop.setAttribute('data-ag-localization-skip','true');backdrop.addEventListener('click',event=>{if(event.target===backdrop)closeCenter();});document.body.appendChild(backdrop);renderCenter();document.getElementById('agy-suite-close')?.focus();
  }
  function onKey(event){
    const center=document.getElementById('agy-suite-center');if(!center)return;
    if(event.key==='Escape'){event.preventDefault();closeCenter();}
    else if(event.key==='Tab'){const focus=[...center.querySelectorAll('button,input,select')].filter(el=>!el.disabled);const first=focus[0],last=focus.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  }
  function renderCenter(rebuild=true){
    if(!settings)return;
    const anchor=document.getElementById('agy-suite-backdrop');
    let center=document.getElementById('agy-suite-center');if(!anchor)return;
    if(!center){center=document.createElement('section');center.id='agy-suite-center';center.setAttribute('data-ag-localization-skip','true');center.setAttribute('role','dialog');center.setAttribute('aria-modal','true');center.setAttribute('aria-labelledby','agy-suite-heading');anchor.prepend(center);rebuild=true;}
    else if(center.parentElement!==anchor)anchor.prepend(center);
    if(!rebuild&&center.dataset.locale===String(settings.i18n)){
      for(const input of center.querySelectorAll('[data-setting]')){const key=input.dataset.setting,value=key in pending?pending[key]:settings[key];if(input.type==='checkbox')input.checked=value;else if(document.activeElement!==input)input.value=value??'';input.disabled=key in pending||(['themeMode','greetingName','replyFont','replySize'].includes(key)&&!settings.skin);const waiting=String(key in pending);if(input.dataset.pending!==waiting)input.dataset.pending=waiting;}
      const status=center.querySelector('[role=status]'),message=statusMessage||text('设置自动保存到本机','Settings save automatically on this device');if(status.textContent!==message)status.textContent=message;status.dataset.error=String(statusError);return;
    }
    const focused=center.contains(document.activeElement)?document.activeElement.dataset.setting:null;
    if(focused&&(document.activeElement.type==='text'||document.activeElement.tagName==='SELECT'))return;
    center.dataset.locale=String(settings.i18n);
    center.replaceChildren();const heading=document.createElement('h2');heading.id='agy-suite-heading';heading.textContent=text('增强套件控制中心','Enhancement Suite');center.appendChild(heading);
    const subtitle=document.createElement('p');subtitle.className='suite-subtitle';subtitle.textContent=text('按需启用，让工作空间更顺手','Make this workspace yours, one feature at a time');center.appendChild(subtitle);
    const close=document.createElement('button');close.id='agy-suite-close';close.type='button';close.textContent='×';close.setAttribute('aria-label',text('关闭','Close'));close.onclick=closeCenter;center.appendChild(close);
    const section=(title,classes)=>{const h=document.createElement('h3');h.textContent=title;const content=document.createElement('div');content.className=classes;center.append(h,content);return content;};
    const modules=section(text('功能模块','FEATURES'),'suite-grid'),appearance=section(text('外观与欢迎语','APPEARANCE'),'suite-form'),options=section(text('显示与后台','DISPLAY & BACKGROUND'),'suite-form');
    const descriptions={skin:['暖白与深色主题，自定义字体','Warm light and dark themes, custom typography'],i18n:['中文菜单与界面文案','Chinese menus and interface'],accounts:['切换账号，查看剩余额度','Switch accounts and view quota'],api:['接入自己的服务商与模型','Connect your providers and models'],guardian:['官方更新后自动恢复套件','Recover the suite after app updates']};
    for(const key of Object.keys(labels)){
      const row=document.createElement('label');row.className='suite-row';const label=document.createElement('span');label.textContent=labels[key][settings.i18n?0:1];
      if(descriptions[key]){const desc=document.createElement('small');desc.className='suite-description';desc.textContent=descriptions[key][settings.i18n?0:1];label.appendChild(desc);}
      const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.setAttribute('aria-label',labels[key][settings.i18n?0:1]);input.dataset.setting=key;input.checked=settings[key];input.onchange=()=>save({[key]:input.checked});row.append(label,input);if(['skin','i18n','accounts','api'].includes(key)){row.classList.add('suite-feature');modules.appendChild(row);}else options.appendChild(row);
    }
    for(const [key,cn,en,options] of [['themeMode','切换皮肤（白天/黑夜/跟随系统）','Skin theme mode',[['light','☀️ 白天（羊皮纸浅色）','☀️ Light (Warm Parchment)'],['dark','🌙 黑夜（暖炭黑深色）','🌙 Dark (Warm Charcoal)'],['system','💻 跟随系统','💻 Follow System']]],['greetingName','首页问候语称呼','Greeting name',null],['replyFont','AI 回复字体','Reply font',[['default','跟随主题','Follow theme'],['serif','书卷衬线体','Serif'],['sans','现代无衬线体','Sans serif']]],['replySize','字号','Reply size',[['small','小','Small'],['standard','标准','Standard'],['large','大','Large']]]]){
      const row=document.createElement('label');row.className='suite-row';row.appendChild(document.createTextNode(text(cn,en)));
      const input=document.createElement(options?'select':'input');if(!options){input.type='text';input.maxLength=60;}
      else for(const [value,zh,english] of options){const option=document.createElement('option');option.value=value;option.textContent=text(zh,english);input.appendChild(option);}
      input.dataset.setting=key;input.value=settings[key]||(key==='themeMode'?'light':'');input.onchange=()=>save({[key]:input.value});if(!options)input.oninput=()=>{clearTimeout(input.debounce);input.debounce=setTimeout(()=>save({[key]:input.value}),400);};row.appendChild(input);appearance.appendChild(row);
    }
    const status=document.createElement('p');status.setAttribute('role','status');center.appendChild(status);renderCenter(false);
    if(focused)center.querySelector('[data-setting="'+focused+'"]')?.focus();
  }
  function refreshUI(){if(disposed||scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(settings){renderCenter(false);mountSidebar();mountGreeting();}});}
  const observer=new MutationObserver(refreshUI);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','hidden']});
  async function refresh(){try{if(!disposed&&!saving)apply(await request());}catch(error){if(!settings)console.warn('[Suite]',error.message);}}
  poll=setInterval(refresh,5000);refresh();
  document.addEventListener('keydown',onKey);
  window.__agySuite={apply,save,getSettings:()=>settings,refresh,openCenter,closeCenter,isSaving:()=>saving};
  window.__agySuiteCleanup=()=>{disposed=true;observer.disconnect();clearInterval(poll);document.removeEventListener('keydown',onKey);style.remove();document.getElementById('agy-suite-center')?.remove();document.getElementById('agy-suite-backdrop')?.remove();document.getElementById('agy-suite-sidebar-button')?.remove();document.querySelector('.agy-suite-greeting')?.remove();};
})();
