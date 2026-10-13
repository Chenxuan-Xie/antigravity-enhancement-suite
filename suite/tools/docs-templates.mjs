import assert from 'node:assert/strict';
import {connectToAntigravity} from '../../antigravity-model-switcher/tools/cdp-utils.mjs';

// Only public interface labels survive. Private values are replaced before leaving
// the renderer; live account settings and messages are never written to a fixture.
function anonymousSnapshot(kind = 'home') {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script,style,link,iframe,video,img,[id^="agy-"],[data-agy-custom-api-nav],[data-agy-local-sessions],[data-agy-custom-item],.agy-ms-effort-submenu,#a11y-live-announcer').forEach(el => el.remove());
  const labels = new Set(['Antigravity','文件','视图','窗口','新建会话','会话历史','自动化','个性化定制','项目','会话','设置','通用','应用','外观','模型','无项目','不在项目中','暂无会话','账户','帐户','电子邮箱','退出登录','升级','快捷键','反馈','提供反馈','隐私政策','服务条款','会话日志','Conversation Log','刚刚','File','View','Window','New conversation','History','Automations','Customizations','Projects','Conversations','Settings','General','Appearance','Models','Account','Email','Sign out','No project','+','⌄','提问任何问题，使用 @ 提及，/ 执行操作','Ask anything, @ to mention, / for workflows']);
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const original = node.nodeValue.trim();
    if (kind === 'settings' && /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(original)) node.nodeValue = 'primary@example.test';
    else if (original.endsWith('/panel')) node.nodeValue = '示例项目';
    else if (/^您的计划:|^您的计划：|^Your plan:/.test(original)) node.nodeValue = '您的计划：示例账号';
    else if (!labels.has(original) && original !== '查看用量' && !(node.parentElement.closest('[data-testid="model-selector-panel"]') && (/^(Gemini |Claude (?:Sonnet|Opus) |GPT-OSS )/.test(original) || ['Low','Medium','High','Thinking','Notice','Leaving Soon'].includes(original)))) node.nodeValue = '';
  }
  const titles = ['示例项目检查','代码审查演示','界面优化计划','文档整理示例','工具调用演示','测试结果检查'];
  [...clone.querySelectorAll('a[href^="/c/"]')].forEach((link, index) => {
    const row = link.parentElement;
    if (index >= titles.length) { row.remove(); return; }
    // The native anchor is an empty absolute overlay. Its sibling owns the title.
    const title = row.querySelector('.truncate');
    if (title) title.textContent = titles[index];
    link.setAttribute('href', '/c/00000000-0000-4000-8000-00000000000' + index);
  });
  const editor = clone.querySelector('[data-lexical-editor="true"]');
  if (editor) editor.innerHTML = '<p><br></p>';
  const model = clone.querySelector('[data-testid="model-selector-trigger"]');
  if (model) {
    const arrow = model.querySelector('svg')?.outerHTML || '';
    model.classList.remove('agy-ms-custom-trigger-active');
    model.innerHTML = '<span class="truncate">Gemini 3.8 Flash High</span>' + arrow;
  }
  const heading = [...clone.querySelectorAll('h1.sr-only')].find(el => /Conversation Log|会话日志/.test(el.textContent));
  if (kind === 'chat' && heading) {
    const log = heading.parentElement;
    const user = log.querySelector('[data-testid="user-input-step"] .whitespace-pre-wrap');
    const response = log.querySelector('[data-testid="planner-response-text"] > div');
    if (user) user.textContent = '请帮我检查示例项目的测试。';
    if (response) {
      const paragraph = response.querySelector('p') || document.createElement('p');
      paragraph.textContent = '示例检查完成：12 项测试通过。建议继续验证网络异常与取消请求。以上是虚构对话，用于展示界面。';
      response.replaceChildren(paragraph);
    }
    const turn = log.querySelector('.flex.items-start');
    if (turn) { turn.classList.add('agy-ms-custom-turn-group'); turn.setAttribute('data-agy-exchange-id', 'demo-turn'); turn.setAttribute('data-agy-conversation-id', '00000000-0000-4000-8000-000000000001'); }
    const headingBar = clone.querySelector('[data-testid="conversation-menu-trigger"]');
    if (headingBar) headingBar.textContent = '示例项目检查';
  }
  const permitted = new Set(['class','id','role','type','tabindex','contenteditable','data-testid','data-tooltip-id','data-lexical-editor','data-placeholder','data-radix-popper-content-wrapper','data-agy-exchange-id','data-agy-conversation-id','aria-hidden','aria-expanded','width','height','viewbox','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','d','xmlns','cx','cy','r','x','y','x1','x2','y1','y2','rx','ry','points','preserveaspectratio','style','href']);
  for (const el of [clone, ...clone.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (!permitted.has(attr.name.toLowerCase()) && !attr.name.startsWith('data-overlayscrollbars')) { el.removeAttribute(attr.name); continue; }
      if (attr.name === 'href' && !/^\/(?:$|customizations$|automations$|conversations$|settings$|c\/00000000)/.test(attr.value)) el.setAttribute('href', '/projects/demo');
      if (attr.name === 'style' && /url\(/i.test(attr.value)) el.removeAttribute('style');
    }
    if (el.matches('input,textarea')) { el.removeAttribute('value'); el.value = ''; el.textContent = ''; }
  }
  const css = [...document.styleSheets].filter(sheet => !sheet.ownerNode?.id?.startsWith('agy-')).flatMap(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; } }).join('\n').replace(/url\((?!["']?data:)[^)]*\)/g, 'none');
  const menu = clone.querySelector('[data-testid="model-selector-panel"]');
  return {html:clone.innerHTML, css, htmlClass:document.documentElement.className, bodyClass:document.body.className, menu:menu?.parentElement?.parentElement?.outerHTML || '', viewport:[innerWidth, innerHeight, devicePixelRatio]};
}

export async function readAnonymousTemplates() {
  const live = await connectToAntigravity();
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const snapshot = kind => live.evaluate(`(${anonymousSnapshot.toString()})(${JSON.stringify(kind)})`);
  const original = await live.evaluate('location.pathname');
  let moved = false, settingsOpened = false, menuOpened = false;
  try {
    assert(!await live.evaluate('!!window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat'), 'Wait for the current task to finish before capturing.');
    assert(!await live.evaluate('!!document.querySelector("[data-testid=stop-button],button[aria-label=Stop],button[aria-label=停止]")'), 'Wait for the official model task to finish before capturing.');
    assert(!await live.evaluate('document.querySelector("[data-lexical-editor=true]")?.innerText.trim()'), 'Leave the composer empty before capturing.');
    let chat;
    if (original.startsWith('/c/')) chat = await snapshot('chat');
    else {
      assert(await live.evaluate('!!document.querySelector("a[href^=\\"/c/\\"]")'), 'A completed conversation is needed as the native chat layout template.');
      await live.evaluate('document.querySelector("a[href^=\\"/c/\\"]").click()'); moved = true; await delay(350);
      chat = await snapshot('chat');
      await live.evaluate('history.back()'); await delay(300); moved = false;
    }
    if (original !== '/') { await live.evaluate('document.querySelector("a[data-testid=new-conversation-button],a[href=\\"/\\"]").click()'); moved = true; await delay(350); }
    const home = await snapshot('home');
    await live.evaluate('document.querySelector("[data-testid=settings-button]").click()'); settingsOpened = true; await delay(350);
    await live.evaluate(`(()=>{const profile=[...document.querySelectorAll('[role="dialog"] button')].find(button=>/@/.test(button.textContent));if(profile)profile.click();})()`);await delay(200);
    const settings = await snapshot('settings');
    await live.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await live.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}); settingsOpened = false; await delay(200);
    await live.evaluate('document.querySelector("[data-testid=model-selector-trigger]").click()'); menuOpened = true; await delay(180);
    const menuSnapshot = await snapshot('home');
    home.menu = menuSnapshot.menu;
    assert(home.menu.includes('model-selector-panel'), 'Native model menu did not open.');
    assert(settings.html.includes('退出登录') || settings.html.includes('Sign out'), 'Native account settings were not visible.');
    for (const template of [home,chat,settings]) assert(!/googleusercontent|sk-[A-Za-z0-9]{12}|\b[A-Z]:[\\/]|[\w.+-]+@(?!example\.test)[\w.-]+\.[a-z]{2,}/i.test(template.html), 'Private text survived sanitization.');
    return {home,chat,settings};
  } finally {
    if (settingsOpened || menuOpened) {
      await live.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await live.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    }
    if (moved) { await live.evaluate('history.back()'); await delay(250); }
    live.close();
  }
}
