// Run browser checks in a disposable iframe, without navigating or submitting the user's chat.
import fs from 'node:fs';
import { connectToAntigravity } from './cdp-utils.mjs';
const source = fs.readFileSync(new URL('../core/chat-injector.js', import.meta.url), 'utf8');
const cdp = await connectToAntigravity();
try {
    await cdp.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    const results = await cdp.evaluate(`(async () => {
        const frame = document.createElement('iframe');
        frame.id = 'agy-ms-regression-fixture';
        frame.style.display = 'none';
        document.body.appendChild(frame);
        const w = frame.contentWindow;
        const d = w.document;
        const results = [];
        const assert = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        let serverMode = 'official';
        let serverModel = 'mdl-a';
        let failSelect = false;
        let modeChanges = 0;
        let stateDelay = 0;
        let streamMode = 'success';
        let chatCalls = 0;
        let officialSubmissions = 0;
        let bridgeIncluded = false;
        let markAsSynced;
        let requestedEffort;
        const models = [
            { id: 'mdl-a', name: 'Relay A', modelId: 'gpt-6-astra', protocol: 'openai', hasApiKey: true, reasoningEffort:'default',reasoningOptions:[{value:'default',label:'默认'},{value:'low',label:'低'},{value:'medium',label:'中'},{value:'high',label:'高'}] },
            { id: 'mdl-b', name: 'Relay B', modelId: 'claude-test', protocol: 'anthropic', hasApiKey: true }
        ];
        d.body.innerHTML = '<nav><a href="/" data-testid="new-conversation-button">New</a><a href="/customizations">Settings</a></nav><main class="flex flex-col"><div class="agy-claude-hero-greeting">Welcome</div><section class="contents"><div data-testid="agent-input-box"><div class="flex flex-col bg-card-border"><div class="flex flex-col bg-card"><div data-lexical-editor="true" contenteditable="true"></div><button data-testid="model-selector-trigger">Official</button><button data-testid="send-button">Send</button></div><div>Decoration</div></div></div><div class="agy-claude-starter-pills">Starters</div></section></main><div data-testid="model-selector-panel"><div data-testid="model-selector-header"></div><div class="flex flex-col gap-px"><div role="menuitem" id="official-item">Official</div></div></div>';
        d.querySelector('a[href="/"]').addEventListener('click', event => event.preventDefault());
        const editor = d.querySelector('[data-lexical-editor]');
        // Lexical state stub provides the same update/clear/text interface used by the injector.
        const textNode = { __type: 'text', getTextContent: () => editor.textContent,
            setTextContent: text => { editor.textContent = text; } };
        const rootNode = { getWritable: () => ({ clear: () => { editor.textContent = ''; } }) };
        let lexicalNodes = [];
        const editorState = { _nodeMap: new Map([['root', rootNode], ['text', textNode]]), toJSON: () => ({ root: { children: lexicalNodes } }) };
        editor.__lexicalEditor = { update: fn => fn(), getEditorState: () => editorState, _commands: new Map() };
        d.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
            officialSubmissions++;
            bridgeIncluded = editor.textContent.includes('ANTIGRAVITY_BRIDGE_SYNC_END');
        });
        const reply = (payload, status = 200) => new w.Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
        w.fetch = async (url, options = {}) => {
            const parsed = new URL(String(url), 'http://127.0.0.1');
            const route = parsed.pathname.replace('/api/models', '');
            if(route==='/reasoning'){
                if(failSelect)return reply({ok:false,error:'offline'},503);
                const body=JSON.parse(options.body);
                const model=models.find(m=>m.id===body.modelId);
                model.reasoningEffort=body.effort;serverMode='custom';serverModel=model.id;
                return reply({ok:true,state:{activeMode:serverMode,activeModelId:serverModel,models}});
            }
            if (route === '/select') {
                if (failSelect) return reply({ ok: false, error: 'offline' }, 503);
                const body = JSON.parse(options.body);
                await pause(body.modelId === 'mdl-a' ? 50 : 5);
                serverMode = body.mode;
                if (body.modelId) serverModel = body.modelId;
                modeChanges++;
                return reply({ ok: true, state: { activeMode: serverMode, activeModelId: serverModel } });
            }
            if (route === '/bridge/consume') {
                const body = JSON.parse(options.body);
                markAsSynced = body.markAsSynced;
                return reply({ ok: true, bridgeBlock: '<!-- ANTIGRAVITY_BRIDGE_SYNC_START -->\\ncontext\\n<!-- ANTIGRAVITY_BRIDGE_SYNC_END -->' });
            }
            if (route === '/chat/stream') {
                chatCalls++;
                requestedEffort=JSON.parse(options.body).reasoningEffort;
                const encoder = new w.TextEncoder();
                if (streamMode === 'hang') {
                    return new w.Response(new w.ReadableStream({ start(controller) {
                        options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
                    } }), { headers: { 'Content-Type': 'text/event-stream' } });
                }
                const text = streamMode === 'incomplete'
                    ? 'event: text_delta\\ndata: {"delta":"partial"}\\n\\n'
                    : 'event: text_delta\\ndata: {"delta":"你好"}\\n\\nevent: done\\ndata: {"reply":"你好世界","exchangeId":"fixture-ex","protocol":"openai"}';
                return new w.Response(new w.ReadableStream({ start(controller) { controller.enqueue(encoder.encode(text)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
            }
            const cid = parsed.searchParams.get('conversationId');
            const mode = serverMode;
            const model = serverModel;
            const wait = stateDelay;
            stateDelay = 0;
            if (wait) await pause(wait);
            return reply({ ok: true, activeMode: mode, activeModelId: model, models,
                localSessions: [{ conversationId: 'startpage-old-session', title: 'Old', exchangeCount: 1 }],
                bridge: { conversationId: cid, exchanges: [], unsyncedCustomCount: 0 } });
        };
        const oldSession = sessionStorage.getItem('agy-ms-local-session');
        try {
            sessionStorage.removeItem('agy-ms-local-session');
            w.eval(${JSON.stringify(source)});
            await pause(30);
            const api = w.__AGY_MODEL_SWITCHER;
            const clock=200000;
            const progress={startedAt:clock-30000,lastContentAt:clock-1000,phase:'thinking',thinkingLength:48,replyLength:0};
            assert(api.formatRunStatus(progress,clock).text.includes('接收思考内容'),'thinking status requires recent real thinking content');
            const waiting=api.formatRunStatus({...progress,lastContentAt:clock-22000,monitor:{providerSeen:true,providerIdleMs:1000,receivedAt:clock,timeoutMs:120000}},clock);
            assert(waiting.phase==='waiting'&&waiting.text.includes('22 秒没有新内容')&&waiting.text.includes('连接仍有响应')&&!waiting.text.includes('正在思考'),'provider keepalive without content is waiting, never claimed as thinking');
            const stalled=api.formatRunStatus({...progress,lastContentAt:clock-60000,monitor:{providerSeen:true,providerIdleMs:45000,receivedAt:clock,timeoutMs:120000}},clock);
            assert(stalled.text.includes('45 秒无响应')&&stalled.text.includes('75 秒后超时'),'waiting shows the actual provider idle duration and remaining timeout');
            assert(api.formatRunStatus({...progress,phase:'tool',lastContentAt:clock-60000,message:'正在执行工具：读取文件'},clock).text.includes('执行工具：读取文件'),'long local tools do not become a fake model-thinking state');
            assert(api.formatRunStatus({...progress,phase:'streaming',replyLength:120},clock).text.includes('输出答复'),'text output replaces the thinking state');
            const official = index => ({ metadata: { sourceTrajectoryStepInfo: { trajectoryId: 'paging', stepIndex: index } },
                step: { case: 'plannerResponse', value: { response: 'official-' + index } } });
            const page = (start, end, total = 6, trajectoryId = 'paging') => ({ status: 1, fullyIdle: true,
                trajectorySlice: { trajectoryId, totalStepsLength: total, stepsSlice: { startIndex: start, endIndexExclusive: end },
                    stepsInSlice: Array.from({ length: end - start }, (_, i) => official(start + i)),
                    totalGeneratorMetadataLength: total, generatorMetadataSlice: { startIndex: end === total ? start - total : start },
                    generatorMetadatasInSlice: Array.from({ length: end - start }, (_, i) => ({ stepIndices: [start + i] })) } });
            const retained = { officialSteps: new Map() };
            const relay = [{ id: 'saved', afterOfficialStepIndex: 5, userPrompt: 'saved prompt', assistantReply: 'saved answer' },
                { id: 'live', afterOfficialStepIndex: 5, userPrompt: 'running prompt', assistantReply: 'partial answer', running: true }];
            const applyPage = raw => {
                retained.base = api.retainNativePage(retained, raw);
                return api.projectNativeState(retained.base, relay, 'page-test').trajectorySlice.stepsInSlice;
            };
            applyPage(page(5, 6));
            const stalePage = api.projectNativeState(page(0, 3), relay, 'page-test');
            assert(!stalePage.trajectorySlice.stepsInSlice.some(step => step.__agyRelay), 'fixture reproduces relay disappearance when a native page excludes its anchors');
            for (const incoming of [page(0, 3), { status: 2 }, page(3, 5), page(5, 6), page(0, 1)]) {
                const steps = applyPage(incoming);
                assert(steps.filter(step => step.step.case === 'userInput').map(step => step.step.value.userResponse).join('|') === 'saved prompt|running prompt',
                    'saved and running relay messages survive page change ' + (incoming.trajectorySlice?.stepsSlice.startIndex ?? 'without slice'));
            }
            assert(retained.base.trajectorySlice.stepsInSlice.length === 6 && retained.base.trajectorySlice.generatorMetadatasInSlice.length === 6,
                'disjoint pages merge after gaps fill and retain the associated thinking metadata');
            applyPage(page(6, 7, 7));
            assert(retained.base.trajectorySlice.stepsInSlice.length === 7, 'new official steps extend retained history');
            applyPage(page(0, 3, 3));
            assert(retained.base.trajectorySlice.stepsInSlice.length === 3 && retained.base.trajectorySlice.generatorMetadatasInSlice.length === 3,
                'intentional history truncation removes retained steps and metadata beyond the new total');
            applyPage(page(0, 1, 1, 'replacement'));
            assert(retained.officialSteps.size === 1 && retained.base.trajectorySlice.stepsInSlice.length === 1,
                'a replacement trajectory cannot inherit cached official steps');
            const stepCache = { exchanges: new Map(), indexed: new Map(), users: new WeakMap() };
            const mixed = { trajectorySlice: { trajectoryId: 'stable', totalStepsLength: 2, stepsSlice: { startIndex: 0 },
                stepsInSlice: [{ metadata: { sourceTrajectoryStepInfo: { trajectoryId: 'stable', stepIndex: 0 } }, step: { case: 'userInput', value: { userResponse: 'official prompt', items: [] } } }, official(1)] } };
            const changing = { id: 'stream-sharing', createdAt: 1, afterOfficialStepIndex: 1, running: true, userPrompt: 'API prompt',
                assistantReply: 'first', reasoning: 'thinking summary', toolSteps: [{ id: 'tool-a', name: 'read_file', args: { path: 'fixture.txt' }, output: 'file contents', ok: true }] };
            const initial = api.projectNativeState(mixed, [changing], 'stable-test', stepCache).trajectorySlice.stepsInSlice;
            const updated = api.projectNativeState(mixed, [{ ...changing, assistantReply: 'first token second token' }], 'stable-test', stepCache).trajectorySlice.stepsInSlice;
            assert(initial.slice(0, -1).every((step, index) => step === updated[index]),
                'streaming an answer preserves official messages, the API prompt, thinking and tool step references');
            assert(initial.at(-1) !== updated.at(-1) && updated.at(-1).step.value.response.includes('second token'),
                'streaming changes only the response step with new content');
            const thinkingPhase=api.projectNativeState(mixed,[{...changing,phase:'thinking'}],'phase-test').trajectorySlice.stepsInSlice.find(step=>step.__agyRelay&&step.step.value.rawThinking);
            const outputPhase=api.projectNativeState(mixed,[{...changing,phase:'streaming'}],'phase-test').trajectorySlice.stepsInSlice.find(step=>step.__agyRelay&&step.step.value.rawThinking);
            assert(thinkingPhase.status===2&&outputPhase.status===3,'old reasoning stops showing an active thinking spinner during text output');
            const noOp = { officialSteps: new Map() };
            noOp.base = api.acceptNativePage(noOp, page(0, 6));
            const unchanged = noOp.base;
            noOp.base = api.acceptNativePage(noOp, page(5, 6));
            assert(noOp.base === unchanged, 'a narrower native page with identical retained content does not create a new state');
            noOp.base = api.acceptNativePage(noOp, { ...page(5, 6), status: 2 });
            assert(noOp.base !== unchanged && noOp.base.status === 2, 'a real native status change still publishes a new state');
            const originalCid = api.getActiveConversationId();
            assert(originalCid !== 'startpage-old-session', 'new chat does not reopen the latest saved chat');
            const pendingRefresh = api.refreshState();
            d.querySelector('[data-testid="new-conversation-button"]').click();
            const newCid = api.getActiveConversationId();
            await pendingRefresh;
            assert(newCid !== originalCid, 'explicit new chat creates a fresh conversation ID');
            const input = d.createElement('input');
            input.type = 'file';
            editor.parentElement.appendChild(input);
            const transfer = new w.DataTransfer();
            transfer.items.add(new w.File(['fixture-original-image'], 'fixture.png', { type: 'image/png' }));
            input.files = transfer.files;
            input.dispatchEvent(new w.Event('change', { bubbles: true }));
            await pause(30);
            const image = d.createElement('img');
            image.alt = 'Image attachment';
            image.src = 'data:image/png;base64,' + w.btoa('fixture-preview');
            editor.parentElement.appendChild(image);
            const composer = editor.parentElement;
            assert(api.extractComposerImages(composer)[0].dataUrl.includes(w.btoa('fixture-original-image')), 'attached images use captured original data');
            image.remove();
            assert(api.extractComposerImages(composer).length === 0, 'removed attachments are not silently sent from the image cache');
            d.querySelector('[data-testid="new-conversation-button"]').click();
            const imageCid = api.getActiveConversationId();
            image.src = 'data:image/png;base64,' + w.btoa('fixture-new-image');
            composer.appendChild(image);
            assert(api.extractComposerImages(composer)[0].dataUrl.includes(w.btoa('fixture-new-image')), 'image cache cannot leak attachments across conversations');
            image.remove();
            await api.refreshState();
            failSelect = true;
            await api.selectModel('custom', 'mdl-a');
            assert(api.getState().activeMode === 'official', 'failed selection does not change the visible active model');
            assert(!!d.querySelector('[role="alert"]'), 'failed selection is visible to the user');
            failSelect = false;
            await Promise.all([api.selectModel('custom', 'mdl-a'), api.selectModel('custom', 'mdl-b')]);
            assert(serverModel === 'mdl-b' && api.getState().activeModelId === 'mdl-b', 'rapid model selections preserve the latest choice');
            serverMode = 'official';
            stateDelay = 120;
            const staleRefresh = api.refreshState();
            await api.selectModel('custom', 'mdl-a');
            await staleRefresh;
            assert(api.getState().activeMode === 'custom', 'stale refresh cannot undo a confirmed selection');
            d.querySelector('[data-agy-model-id="mdl-a"]').click();
            assert(!!d.querySelector('.agy-ms-effort-submenu'), 'supported relay models expose an effort submenu in the native model menu');
            assert(!d.querySelector('[data-agy-model-id="mdl-b"]').hasAttribute('aria-haspopup'), 'unknown capabilities do not expose unsupported effort choices');
            const relayRow=d.querySelector('[data-agy-custom-item][data-agy-model-id="mdl-a"]');
            relayRow.querySelector('span').dispatchEvent(new w.PointerEvent('pointerover',{bubbles:true}));
            d.querySelector('.agy-ms-effort-submenu [data-agy-effort="high"]').dispatchEvent(new w.PointerEvent('pointerover',{bubbles:true}));
            assert(!!d.querySelector('.agy-ms-effort-submenu'), 'moving within the relay row or its submenu keeps effort options open');
            d.getElementById('official-item').dispatchEvent(new w.PointerEvent('pointerover',{bubbles:true}));
            assert(!d.querySelector('.agy-ms-effort-submenu')&&relayRow.getAttribute('aria-expanded')==='false', 'hovering an official model closes the relay submenu and resets its expanded state');
            relayRow.click();d.getElementById('official-item').dispatchEvent(new w.FocusEvent('focusin',{bubbles:true}));
            assert(!d.querySelector('.agy-ms-effort-submenu'), 'keyboard focus on an official model closes the relay submenu');
            relayRow.click();d.querySelector('[data-agy-custom-item][data-agy-model-id="mdl-b"]').dispatchEvent(new w.PointerEvent('pointerover',{bubbles:true}));
            assert(!d.querySelector('.agy-ms-effort-submenu'), 'hovering a relay without effort options closes the previous submenu');
            relayRow.click();
            failSelect=true;d.querySelector('[data-agy-effort="high"]').click();await pause(30);
            assert(models[0].reasoningEffort==='default' && api.getState().activeModelId==='mdl-a', 'failed effort selection preserves the previous model and effort');
            failSelect=false;d.querySelector('[data-agy-model-id="mdl-a"]').click();d.querySelector('[data-agy-effort="high"]').click();await pause(30);
            assert(models[0].reasoningEffort==='high' && d.querySelector('[data-testid="model-selector-trigger"]').textContent.includes('高'), 'confirmed effort selection updates the saved model and composer label');
            await api.selectModel('custom','mdl-b');await api.selectModel('custom','mdl-a');
            assert(api.getState().models[0].reasoningEffort==='high', 'switching models retains each model effort preference');
            editor.textContent = 'test';
            d.querySelector('[data-testid="send-button"]').click();
            await pause(30);
            assert(requestedEffort==='high', 'relay submissions transmit the selected effort');
            await pause(80);
            const log = d.getElementById('agy-ms-startpage-chat-log');
            assert(!!log && !d.querySelector('[data-testid="agent-input-box"]').contains(log), 'API replies mount outside the input card');
            assert(log.textContent.includes('你好世界'), 'final reply is authoritative even after streaming deltas');
            assert(officialSubmissions === 0 && chatCalls === 1, 'API submit never triggers the native official submit');
            assert(log.querySelector('.agy-ms-custom-turn-group').getAttribute('data-agy-conversation-id') === imageCid, 'rendered API turns retain their owning conversation ID');
            const dispatchEnter = () => editor.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            const chatsBeforeSlash = chatCalls;
            lexicalNodes = [{ type: 'paragraph', children: [{ type: 'contextScopeItemMention', trigger: '@', value: 'contextScopeItemMention',
                data: { mentionText: 'goal', data: JSON.stringify({ slashCommand: { info: { name: 'goal', modelFacingText: 'long task' } } }) } }] }];
            editor.textContent = 'goal ';
            dispatchEnter();
            await pause(50);
            assert(chatCalls === chatsBeforeSlash && editor.textContent === 'goal ', '/ commands are delegated to the native agent instead of the relay');
            lexicalNodes = [];
            editor.setAttribute('aria-expanded', 'true');
            editor.textContent = 'typeahead open';
            dispatchEnter();
            await pause(50);
            assert(chatCalls === chatsBeforeSlash && editor.textContent === 'typeahead open', 'enter selects a native typeahead item instead of sending a relay message');
            editor.setAttribute('aria-expanded', 'false');
            editor.textContent = 'plain relay';
            dispatchEnter();
            await pause(80);
            assert(chatCalls === chatsBeforeSlash + 1, 'plain enter still submits to the relay model');
            assert(editor.textContent === '' || editor.textContent.includes('plain relay'), 'relay submission handles the composer safely');
            streamMode = 'incomplete';
            editor.textContent = 'retry question';
            d.querySelector('[data-testid="send-button"]').click();
            await pause(80);
            assert(log.textContent.includes('连接中断') && editor.textContent.includes('retry question'), 'incomplete streams show an error and restore the prompt');
            streamMode = 'hang';
            editor.textContent = 'stop question';
            d.querySelector('[data-testid="send-button"]').click();
            await pause(10);
            const stop = Array.from(log.querySelectorAll('button')).find(button => button.textContent === '停止生成');
            assert(!!stop, 'in-flight requests have a stop-generation button');
            stop.click();
            await pause(60);
            assert(!api.getState().isSendingCustomChat && log.textContent.includes('已停止生成'), 'stopping generation clears the pending request state');
            await api.selectModel('official');
            api.getState().bridge = { conversationId: api.getActiveConversationId(), unsyncedCustomCount: 1, exchanges: [] };
            editor.textContent = 'official followup';
            d.querySelector('[data-testid="send-button"]').click();
            await pause(50);
            assert(officialSubmissions === 1 && bridgeIncluded && markAsSynced === false, 'official submit carries context without prematurely acknowledging delivery');
            const before = modeChanges;
            w.__AGY_MODEL_SWITCHER_CLEANUP();
            w.eval(${JSON.stringify(source)});
            await pause(30);
            await w.__AGY_MODEL_SWITCHER.selectModel('custom', 'mdl-a');
            const afterSelect = modeChanges;
            d.getElementById('official-item').click();
            await pause(80);
            assert(modeChanges === afterSelect + 1 && modeChanges > before, 'hot reload removes old native click handlers');
            assert(d.querySelectorAll('[data-agy-custom-api-nav="1"]').length === 1, 'hot reload does not duplicate sidebar entries');
            return results;
        } finally {
            w.__AGY_MODEL_SWITCHER_CLEANUP?.();
            if (oldSession === null) sessionStorage.removeItem('agy-ms-local-session');
            else sessionStorage.setItem('agy-ms-local-session', oldSession);
            frame.remove();
        }
    })()`, 45000);
    results.forEach(result => console.log(`PASS ${result}`));
    console.log(`\n${results.length} browser checks passed.`);
} finally {
    await cdp.call('Emulation.setFocusEmulationEnabled', { enabled: false });
    cdp.close();
}
