(() => {
  const API='http://127.0.0.1:19823';
  window.__agySuiteCleanup?.();
  let disposed=false,settings=null,saving=false,queued={},poll,scheduled=false;
  const active={};
  const labels={skin:['Claude 皮肤','Claude theme'],i18n:['中文汉化','Chinese localization'],accounts:['多账号切换','Account switcher'],api:['API 中转切换','API model switcher'],guardian:['更新自愈守护（计划任务）','Update recovery (scheduled task)'],showUsage:['显示 Token 消耗','Show token usage'],quotaReminder:['配额低水位提醒','Low quota reminders']};
  const text=(cn,en)=>settings?.i18n?cn:en;
  const style=document.createElement('style');style.id='agy-suite-style';
  document.querySelectorAll('.agy-claude-hero-greeting,.agy-claude-starter-pills').forEach(el=>el.remove());
  style.textContent=`#agy-suite-center{border:1px solid var(--border,#8885);border-radius:12px;padding:18px;margin:16px 0;color:var(--foreground,inherit);background:var(--background,inherit);font:13px system-ui}#agy-suite-center h2{font-size:16px;margin:0 0 12px}#agy-suite-center .suite-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0}#agy-suite-center input[type=checkbox]{appearance:none;width:36px;height:20px;border-radius:12px;background:#8887;cursor:pointer;position:relative;flex-shrink:0}#agy-suite-center input[type=checkbox]:after{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;background:white;border-radius:50%}#agy-suite-center input:checked{background:#bd684b}#agy-suite-center input:checked:after{left:19px}#agy-suite-center select,#agy-suite-center input[type=text]{border:1px solid var(--border,#8885);border-radius:6px;padding:5px;background:var(--background,inherit);color:inherit;max-width:210px}#agy-suite-center input:focus-visible,#agy-suite-center select:focus-visible{outline:2px solid #bd684b;outline-offset:2px}.agy-suite-greeting{font:28px system-ui;margin:0 0 22px;text-align:center}`;
  document.head.appendChild(style);
  async function request(patch){const res=await fetch(API+'/api/suite/settings',{method:patch?'POST':'GET',headers:{'Content-Type':'application/json'},body:patch?JSON.stringify(patch):undefined,signal:AbortSignal.timeout(25000)});const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'Suite service unavailable');return data.settings;}
  function apply(next){
    if(settings&&JSON.stringify(settings)===JSON.stringify(next))return;
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
    if(next.skin&&next.themeMode)window.__AGY_THEME_SWITCHER?.setMode(next.themeMode,{fromSuite:true});
    localStorage.setItem('__agy_greeting_name__',next.greetingName);
    let typography=document.getElementById('agy-suite-typography');
    if(!typography){typography=document.createElement('style');typography.id='agy-suite-typography';document.head.appendChild(typography);}
    if(document.head.lastElementChild!==typography)document.head.appendChild(typography);
    let fontStyle=document.getElementById('agy-suite-fonts');
    if(next.replyFont==='serif'&&!next.skin){if(!fontStyle){fontStyle=document.createElement('style');fontStyle.id='agy-suite-fonts';document.head.appendChild(fontStyle);}fontStyle.textContent=window.__agySuiteTheme.slice(0,window.__agySuiteTheme.indexOf(':root'));}else fontStyle?.remove();
    const font=next.replyFont==='default'?(next.skin?'var(--claude-font-serif)':'inherit'):next.replyFont==='sans'?'system-ui, sans-serif':`'ClaudeSerif', 'Noto Serif SC', 'SimSun', serif`;
    const size={small:14,standard:15.5,large:18}[next.replySize];
    typography.textContent=(next.skin||next.replyFont!=='default'||next.replySize!=='standard')?`[data-testid="planner-response-text"],.md-divider-spacing{font-family:${font}!important;font-size:${size}px!important}`:'';
    renderCenter();mountGreeting();
  }
  async function save(patch){
    Object.assign(queued,patch);if(saving)return;saving=true;
    const status=document.querySelector('#agy-suite-center [role=status]');
    try{while(Object.keys(queued).length){const update=queued;queued={};if(update.api===false&&window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat)throw Error(text('请先等待或停止正在运行的 API 请求','Finish or stop the active API request first'));apply(await request(update));}}
    catch(error){queued={};if(status)status.textContent=error.message;renderCenter(false);}
    finally{saving=false;}
  }
  function mountGreeting(){
    const home=[...document.querySelectorAll('[data-testid="agent-input-box"]')].find(el=>!location.pathname.startsWith('/c/'));
    const old=document.querySelector('.agy-suite-greeting');
    if(!home||(!settings.skin&&!settings.greetingName)){old?.remove();return;}
    const hour=new Date().getHours();const title=text(hour<12?'早上好':hour<18?'下午好':'晚上好',hour<12?'Good morning':hour<18?'Good afternoon':'Good evening')+(settings.greetingName?text('，',', ')+settings.greetingName:'');
    const greeting=old||document.createElement('div');greeting.className='agy-suite-greeting';greeting.setAttribute('data-ag-localization-skip','true');
    if(greeting.textContent!==title)greeting.textContent=title;
    if(greeting.parentElement!==home.parentElement)home.parentElement.insertBefore(greeting,home);
  }
  function findSettingsAnchor(){
    const explicit=document.querySelector('[data-testid="settings-content"]');if(explicit)return explicit;
    const dialog=document.querySelector('.settings-modal-container');
    if(dialog){
      const scroller=[...dialog.querySelectorAll('div')].find(el=>el.classList.contains('overflow-y-auto')&&el.querySelector('h2')&&!el.querySelector('[data-testid^="settings-nav-item-"]'));
      if(scroller)return scroller;
      const heading=[...dialog.querySelectorAll('h2')].find(el=>/^(General|通用|Appearance|外观|Account|账号|账户)$/.test(el.textContent.trim()));
      if(heading)return heading.parentElement.parentElement;
    }
    return null;
  }
  function renderCenter(rebuild=true){
    if(!settings)return;
    const anchor=findSettingsAnchor();
    let center=document.getElementById('agy-suite-center');if(!anchor)return;
    if(!center){center=document.createElement('section');center.id='agy-suite-center';center.setAttribute('data-ag-localization-skip','true');anchor.prepend(center);rebuild=true;}
    if(!rebuild&&center.dataset.locale===String(settings.i18n)){for(const input of center.querySelectorAll('[data-setting]'))if(input.type==='checkbox')input.checked=settings[input.dataset.setting];else if(input.tagName==='SELECT')input.value=settings[input.dataset.setting];return;}
    const focused=center.contains(document.activeElement)?document.activeElement.dataset.setting:null;
    if(focused&&(document.activeElement.type==='text'||document.activeElement.tagName==='SELECT'))return;
    center.dataset.locale=String(settings.i18n);
    center.replaceChildren();const heading=document.createElement('h2');heading.textContent=text('✨ 增强套件控制中心','✨ Enhancement Suite');center.appendChild(heading);
    for(const key of Object.keys(labels)){
      const row=document.createElement('label');row.className='suite-row';const label=document.createElement('span');label.textContent=labels[key][settings.i18n?0:1];
      const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.setAttribute('aria-label',label.textContent);input.dataset.setting=key;input.checked=settings[key];input.onchange=()=>save({[key]:input.checked});row.append(label,input);center.appendChild(row);
    }
    for(const [key,cn,en,options] of [['themeMode','切换皮肤（白天/黑夜/跟随系统）','Skin theme mode',[['light','☀️ 白天（羊皮纸浅色）','☀️ Light (Warm Parchment)'],['dark','🌙 黑夜（暖炭黑深色）','🌙 Dark (Warm Charcoal)'],['system','💻 跟随系统','💻 Follow System']]],['greetingName','首页问候语称呼','Greeting name',null],['replyFont','AI 回复字体','Reply font',[['default','跟随主题','Follow theme'],['serif','书卷衬线体','Serif'],['sans','现代无衬线体','Sans serif']]],['replySize','字号','Reply size',[['small','小','Small'],['standard','标准','Standard'],['large','大','Large']]]]){
      const row=document.createElement('label');row.className='suite-row';row.appendChild(document.createTextNode(text(cn,en)));
      const input=document.createElement(options?'select':'input');if(!options){input.type='text';input.maxLength=60;}
      else for(const [value,zh,english] of options){const option=document.createElement('option');option.value=value;option.textContent=text(zh,english);input.appendChild(option);}
      input.dataset.setting=key;input.value=settings[key]||(key==='themeMode'?'light':'');input.onchange=()=>{if(key==='themeMode')window.__AGY_THEME_SWITCHER?.setMode(input.value,{fromSuite:true});save({[key]:input.value});};if(!options)input.oninput=()=>{clearTimeout(input.debounce);input.debounce=setTimeout(()=>save({[key]:input.value}),400);};row.appendChild(input);center.appendChild(row);
    }
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent=text('关闭功能保留本地配置；关闭自愈守护将移除计划任务，官方更新后可能需要重新安装。','Turning features off keeps local data. Without update recovery, reinstall may be needed after app updates.');center.appendChild(status);
    if(focused)center.querySelector('[data-setting="'+focused+'"]')?.focus();
  }
  function refreshUI(){if(disposed||scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(settings){renderCenter(false);mountGreeting();}});}
  const observer=new MutationObserver(refreshUI);observer.observe(document.documentElement,{childList:true,subtree:true});
  async function refresh(){try{if(!disposed&&!saving)apply(await request());}catch(error){if(!settings)console.warn('[Suite]',error.message);}}
  poll=setInterval(refresh,5000);refresh();
  window.__agySuite={apply,save,getSettings:()=>settings,refresh};
  window.__agySuiteCleanup=()=>{disposed=true;observer.disconnect();clearInterval(poll);style.remove();document.getElementById('agy-suite-center')?.remove();document.querySelector('.agy-suite-greeting')?.remove();};
})();
