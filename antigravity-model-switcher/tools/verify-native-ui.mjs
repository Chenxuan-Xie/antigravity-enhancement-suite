// Exercise the real native UI with an owned empty conversation and mocked model stream.
// No request is sent to an official model or a relay provider.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { connectToAntigravity } from './cdp-utils.mjs';
import { appendCustomBridgeExchange, clearBridgeState, readBridgeState } from '../core/context-bridge.mjs';

const cdp = await connectToAntigravity();
const source = fs.readFileSync(new URL('../core/chat-injector.js', import.meta.url), 'utf8');
const errors = [];
cdp.onEvent(event => {
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        errors.push(event.params.args.map(arg => arg.description || arg.value).join(' '));
    }
});
let cid, originalUrl;
try {
    await cdp.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.call('Runtime.enable');
    errors.length = 0;
    await cdp.evaluate(`(()=>{const editor=document.querySelector('[data-lexical-editor]');if(['停止回归验证','流式回归验证','原生中转回归验证','未发送草稿回归验证'].includes(editor?.textContent)){const lex=editor.__lexicalEditor;lex.update(()=>{(lex._pendingEditorState||lex.getEditorState())._nodeMap.get('root').getWritable().clear()},{discrete:true});window.__AGY_MODEL_SWITCHER.nativeContext().composer?.draftsRef.current?.delete(location.pathname.match(/^\\/c\\/([^/]+)/)?.[1]||'__home__');}})()`);
    const canTest = await cdp.evaluate(`!document.querySelector('[data-lexical-editor]')?.textContent.trim() && !window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat`);
    if (!canTest) throw new Error('当前有草稿或正在生成的消息，未进行原生界面测试');
    originalUrl = await cdp.evaluate('location.pathname + location.search');
    await cdp.evaluate(source);
    await new Promise(resolve => setTimeout(resolve, 200));
    cid = await cdp.evaluate(`(async () => {
        const api = window.__AGY_MODEL_SWITCHER;
        const context = api.nativeContext();
        window.__agyFixtureContext = context;
        await context.router.navigate({to:'/',search:{section:'outside-of-project'}});
        await new Promise(resolve=>setTimeout(resolve,200));
        const editor=document.querySelector('[data-lexical-editor]');
        editor.focus();document.execCommand('insertText',false,'原生中转回归验证');
        await new Promise(resolve=>setTimeout(resolve,250));
        return api.ensureNativeConversation('原生中转回归验证');
    })()`);
    errors.length = 0;
    assert.match(cid, /^[a-f0-9-]{36}$/);
    const newChatDraft = await cdp.evaluate(`(async()=>{
        const api=window.__AGY_MODEL_SWITCHER,context=api.nativeContext();
        document.querySelector('a[data-testid="new-conversation-button"]')?.click();
        await new Promise(resolve=>setTimeout(resolve,300));
        const draft=document.querySelector('[data-lexical-editor]')?.textContent;
        await context.router.navigate({to:'/c/$cascadeId',params:{cascadeId:'${cid}'},search:{section:'outside-of-project'}});
        await new Promise(resolve=>setTimeout(resolve,250));
        return draft;
    })()`);
    assert.equal(newChatDraft, '', '已提交的主页提示词不应在新建会话时恢复');
    console.log('PASS starting a new conversation does not restore the submitted home draft');
    const unsentDraft = await cdp.evaluate(`(async()=>{
        const api=window.__AGY_MODEL_SWITCHER,context=api.nativeContext();
        await context.router.navigate({to:'/',search:{section:'outside-of-project'}});
        await new Promise(resolve=>setTimeout(resolve,200));
        const editor=document.querySelector('[data-lexical-editor]');
        editor.focus();document.execCommand('insertText',false,'未发送草稿回归验证');
        await new Promise(resolve=>setTimeout(resolve,250));
        await context.router.navigate({to:'/c/$cascadeId',params:{cascadeId:'${cid}'},search:{section:'outside-of-project'}});
        await new Promise(resolve=>setTimeout(resolve,200));
        document.querySelector('a[data-testid="new-conversation-button"]')?.click();
        await new Promise(resolve=>setTimeout(resolve,250));
        const restored=document.querySelector('[data-lexical-editor]');
        const text=restored.textContent;
        const lex=restored.__lexicalEditor;
        lex.update(()=>{(lex._pendingEditorState||lex.getEditorState())._nodeMap.get('root').getWritable().clear()},{discrete:true});
        context.composer.draftsRef.current.delete('__home__');
        await context.router.navigate({to:'/c/$cascadeId',params:{cascadeId:'${cid}'},search:{section:'outside-of-project'}});
        await new Promise(resolve=>setTimeout(resolve,250));
        return text;
    })()`);
    assert.equal(unsentDraft, '未发送草稿回归验证', '真正未发送的主页草稿应保留');
    console.log('PASS navigation preserves an unrelated unsent home draft');
    const exchange = appendCustomBridgeExchange(cid, {
        userPrompt: '原生显示验证', assistantReply: '这是模拟回复，**粗体**与表格由原生 Markdown 渲染。\n\n| 项目 | 结果 |\n| --- | --- |\n| 测试 | 通过 |',
        reasoning: '这是一段测试接口返回的模拟思考摘要。', modelId: 'fixture-only', modelName: 'Fixture',
        toolSteps: [{ id: 'fixture-tool', name: 'read_file', args: { path: 'fixture.txt' }, ok: true, summary: '已读取 fixture.txt', output: 'fixture output' }]
    });
    await cdp.evaluate('window.__AGY_MODEL_SWITCHER.refreshState()');
    await new Promise(resolve => setTimeout(resolve, 600));
    await cdp.evaluate(`(async()=>{
        document.querySelector('[data-testid="worked-for-collapsible"]')?.click();
        await new Promise(resolve=>setTimeout(resolve,400));
        document.querySelectorAll('[data-testid="conversation-view"] button[aria-expanded="false"]').forEach(button=>{
            if(button.getAttribute('data-testid')!=='model-selector-trigger') button.click();
        });
        await new Promise(resolve=>setTimeout(resolve,400));
        document.querySelector('[data-testid="thinking-collapsible-trigger"][aria-expanded="false"]')?.click();
        await new Promise(resolve=>setTimeout(resolve,300));
    })()`);
    const persisted = await cdp.evaluate(`(() => {
        const api=window.__AGY_MODEL_SWITCHER, context=api.nativeContext();
        return { cid:api.getActiveConversationId(), listed:!!document.querySelector('a[href*="${cid}"]'),
            users:document.querySelectorAll('[data-testid="user-input-step"]').length,
            customDom:document.querySelectorAll('.agy-ms-custom-turn-group').length,
            table:!!document.querySelector('table') || (document.body.innerText.includes('项目') && document.body.innerText.includes('通过') && !document.body.innerText.includes('| --- |')),
            thinking:document.body.innerText.includes('模拟思考摘要'),
            tool:document.body.innerText.includes('fixture.txt'),
            steps:context.states.peek('${cid}').getState().trajectorySlice.stepsInSlice.map(step=>step.step.case)
        };
    })()`);
    if (errors.length) console.log(errors.map(error=>error.slice(0,1700)));
    if (!persisted.thinking) console.log(await cdp.evaluate(`({text:document.querySelector('[data-testid="conversation-view"]')?.innerText,thinkingButtons:document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]').length,verbose:window.__AGY_MODEL_SWITCHER.nativeContext().render.chatParams.verboseAgentChat})`));
    assert.equal(persisted.cid, cid);
    assert.equal(persisted.listed, true);
    assert.equal(persisted.users, 1);
    assert.equal(persisted.customDom, 0);
    assert.equal(persisted.table, true);
    assert.equal(persisted.tool, true);
    assert.equal(persisted.thinking, true);
    assert.deepEqual(persisted.steps, ['userInput', 'plannerResponse', 'generic', 'plannerResponse']);
    console.log('PASS first relay chat uses a native UUID and appears in the normal conversation list');
    console.log('PASS persisted relay turns use native bubbles, Markdown tables, thinking and tool steps');
    const stableHistory=await cdp.evaluate(`(async()=>{
        const api=window.__AGY_MODEL_SWITCHER,c=api.nativeContext(),provider=c.states.peek('${cid}');
        const raw=c.states.getAgentStates().get('${cid}').underlyingProvider.getState();
        const firstStep=provider.getState().trajectorySlice.stepsInSlice[0];
        const user=document.querySelector('[data-testid="user-input-step"]');
        let missing=0;const listener=provider.onDidChange(value=>{if(!value.__agyNativeProjection||!value.trajectorySlice.stepsInSlice.some(step=>step.__agyRelay))missing++;});
        try{for(let i=0;i<8;i++){provider.setState({...raw});await new Promise(resolve=>setTimeout(resolve,20));}
            return {missing,stableStep:firstStep===provider.getState().trajectorySlice.stepsInSlice[0],stableBubble:user===document.querySelector('[data-testid="user-input-step"]')};
        }finally{listener.dispose();provider.setState(raw);}
    })()`);
    assert.equal(stableHistory.missing,0);
    assert.equal(stableHistory.stableStep,true);
    assert.equal(stableHistory.stableBubble,true);
    console.log('PASS native state updates never drop relay history and preserve existing message nodes');

    const projection = await cdp.evaluate(`(() => {
        const api=window.__AGY_MODEL_SWITCHER;
        const official=(index,text)=>({metadata:{sourceTrajectoryStepInfo:{stepIndex:index,trajectoryId:'official'}},step:{case:index%2?'plannerResponse':'userInput',value:index%2?{response:text}:{items:[{chunk:{case:'text',value:text}}],userResponse:text}}});
        const base={status:1,trajectorySlice:{stepsInSlice:[official(0,'官方提问'),official(1,'官方回答')],stepsSlice:{startIndex:0},totalStepsLength:2}};
        const result=api.projectNativeState(base,[{id:'before',createdAt:1,afterOfficialStepIndex:-1,userPrompt:'之前',assistantReply:'之前回答'},{id:'after',createdAt:2,afterOfficialStepIndex:1,userPrompt:'之后',assistantReply:'之后回答'}],'fixture');
        return { users:result.trajectorySlice.stepsInSlice.filter(step=>step.step.case==='userInput').map(step=>step.step.value.userResponse),
            originalIndexes:result.trajectorySlice.stepsInSlice.filter(step=>!step.__agyRelay).map(step=>step.__agyOfficialStepIndex),
            originalLength:base.trajectorySlice.stepsInSlice.length };
    })()`);
    assert.deepEqual(projection.users, ['之前', '官方提问', '之后']);
    assert.deepEqual(projection.originalIndexes, [0, 1]);
    assert.equal(projection.originalLength, 2);
    console.log('PASS official and relay turns retain chronological order without changing the native transcript');
    const pageMap = await cdp.evaluate(`(()=>{
        const api=window.__AGY_MODEL_SWITCHER;
        const base={trajectorySlice:{stepsSlice:{startIndex:30,endIndexExclusive:60},stepsInSlice:[],totalStepsLength:90}};
        const exchanges=[-1,0,29,59,89].map((anchor,i)=>({id:'page-'+i,createdAt:i+1,afterOfficialStepIndex:anchor,userPrompt:'测试',assistantReply:'回复'}));
        const layout=api.nativeLayout(base,exchanges,'page-fixture');
        return {first:layout.officialAt(2),beforeLoaded:layout.officialAt(5),relay:layout.officialAt(34),afterPage:layout.officialAt(68),end:layout.boundary(100),total:layout.displayTotal};
    })()`);
    assert.deepEqual(pageMap,{first:0,beforeLoaded:1,relay:null,afterPage:60,end:90,total:100});
    console.log('PASS pagination maps display indices even outside the loaded official page');
    const streaming = await cdp.evaluate(`(async()=>{
        const api=window.__AGY_MODEL_SWITCHER, originalFetch=window.fetch;
        let submissions=0, requestedCid='', aborted=false, streamMode='success', timerFired=false, requestedModes=[];
        const fixtureContext=api.nativeContext(),provider=fixtureContext.states.peek('${cid}');
        const historyBubble=document.querySelector('[data-testid="user-input-step"]');
        let missingHistory=0,liveThinking,stableThinking=true,sawOutputStatus=false,thinkingCompletedDuringOutput=false;
        const trace=provider.onDidChange(value=>{
            if(location.pathname==='/c/${cid}'&&!value.__agyNativeProjection)missingHistory++;
            const thinking=value.trajectorySlice.stepsInSlice.find(step=>step.__agyRelay&&step.status===3&&step.step.value.rawThinking==='模拟流式思考');
            if(thinking&&!thinking.metadata?.completedAt){if(liveThinking&&liveThinking!==thinking)stableThinking=false;liveThinking=thinking;}
            if(thinking&&api.getState().isSendingCustomChat)thinkingCompletedDuringOutput=true;
            if(document.querySelector('[data-testid="relay-run-status"]')?.textContent.includes('正在输出答复'))sawOutputStatus=true;
        });
        let updates=0;const countUpdates=provider.onDidChange(()=>updates++);
        const originalMode=api.getState().activeMode;
        api.getState().activeMode='custom';
        window.fetch=async(url,options={})=>{
            if(String(url).includes('/api/models?')){
                const response=await originalFetch(url,options),data=await response.json();
                return new Response(JSON.stringify({...data,activeMode:'custom'}),{status:response.status,headers:{'Content-Type':'application/json'}});
            }
            if(!String(url).endsWith('/api/models/chat/stream'))return originalFetch(url,options);
            submissions++;requestedCid=JSON.parse(options.body).conversationId;requestedModes.push(streamMode);
            const encoder=new TextEncoder();
            return new Response(new ReadableStream({start(controller){
                options.signal.addEventListener('abort',()=>{aborted=true;controller.error(options.signal.reason)},{once:true});
                if(streamMode==='hang')return;
                controller.enqueue(encoder.encode('event: checkpoint\\ndata: {"exchangeId":"fixture-stream"}\\n\\nevent: thinking_delta\\ndata: {"delta":"模拟流式思考"}\\n\\nevent: text_delta\\ndata: {"delta":"模拟流式"}\\n\\n'));
                for(let i=0;i<20;i++)controller.enqueue(encoder.encode('event: text_delta\\ndata: {"delta":"增量"}\\n\\n'));
                const pulse=setInterval(()=>controller.enqueue(encoder.encode('event: text_delta\\ndata: {"delta":"持续输出"}\\n\\n')),100);
                setTimeout(()=>{clearInterval(pulse);timerFired=true;controller.enqueue(encoder.encode('event: done\\ndata: {"reply":"模拟流式最终回复","reasoning":"模拟流式思考","exchangeId":"fixture-stream"}\\n\\n'));controller.close()},4600);
            }}),{headers:{'Content-Type':'text/event-stream'}});
        };
        try{
            const submit=async text=>{const editor=document.querySelector('[data-lexical-editor]');editor.focus();document.execCommand('insertText',false,text);for(let i=0;i<30;i++){await new Promise(resolve=>setTimeout(resolve,50));const button=document.querySelector('[data-testid="send-button"]');if(button&&!button.disabled){api.getState().activeMode='custom';button.click();return;}}throw new Error('测试发送按钮未就绪');};
            await submit('流式回归验证');
            for(let i=0;i<60;i++){await new Promise(resolve=>setTimeout(resolve,100));if(!api.getState().isSendingCustomChat&&submissions)break;}
            await new Promise(resolve=>setTimeout(resolve,150));
            const final=document.querySelector('[data-testid="conversation-view"]').innerText.includes('模拟流式最终回复');
            const streamingUpdates=updates;
            const stableBubble=historyBubble===document.querySelector('[data-testid="user-input-step"]');
            trace.dispose();countUpdates.dispose();
            const context=api.nativeContext();
            document.querySelector('a[data-testid="new-conversation-button"]')?.click();
            await new Promise(resolve=>setTimeout(resolve,250));
            const freshDraft=document.querySelector('[data-lexical-editor]')?.textContent;
            await context.router.navigate({to:'/c/$cascadeId',params:{cascadeId:'${cid}'},search:{section:'outside-of-project'}});
            await new Promise(resolve=>setTimeout(resolve,250));
            const sentDraft=document.querySelector('[data-lexical-editor]')?.textContent;
            streamMode='hang';await submit('停止回归验证');
            await new Promise(resolve=>setTimeout(resolve,150));
            const stop=document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
            const nativeStop=!!stop;if(stop)stop.click();else api.stopGeneration();
            await new Promise(resolve=>setTimeout(resolve,200));
            const editor=document.querySelector('[data-lexical-editor]');const lex=editor.__lexicalEditor;lex.update(()=>{(lex._pendingEditorState||lex.getEditorState())._nodeMap.get('root').getWritable().clear()},{discrete:true});
            await new Promise(resolve=>setTimeout(resolve,250));
            return {submissions,requestedCid,final,nativeStop,aborted,timerFired,requestedModes,freshDraft,sentDraft,busy:api.getState().isSendingCustomChat,missingHistory,stableBubble,stableThinking,sawLiveThinking:!!liveThinking,streamingUpdates,sawOutputStatus,thinkingCompletedDuringOutput,statusRemoved:!document.querySelector('[data-testid="relay-run-status"]')};
        }finally{trace.dispose();countUpdates.dispose();window.fetch=originalFetch;api.getState().activeMode=originalMode;}
    })()`, 45000);
    if(streaming.submissions!==2 || !streaming.nativeStop || !streaming.final)console.log(streaming);
    assert.equal(streaming.submissions, 2);
    assert.equal(streaming.requestedCid, cid);
    assert.equal(streaming.final, true);
    assert.equal(streaming.aborted, true);
    assert.equal(streaming.busy, false);
    assert.equal(streaming.nativeStop, true);
    assert.equal(streaming.freshDraft, '');
    assert.equal(streaming.sentDraft, '', '返回已发送中转消息的会话时输入框也应为空');
    assert.equal(streaming.missingHistory,0);
    assert.equal(streaming.stableBubble,true);
    assert.equal(streaming.stableThinking,true);
    assert.equal(streaming.sawLiveThinking,true);
    assert.equal(streaming.sawOutputStatus,true);
    assert.equal(streaming.thinkingCompletedDuringOutput,true);
    assert.equal(streaming.statusRemoved,true);
    assert(streaming.streamingUpdates<65,JSON.stringify(streaming));
    console.log('PASS streaming batches token bursts and keeps the existing conversation mounted');
    console.log('PASS sustained streaming preserves reasoning while completing its spinner during text output');
    console.log('PASS native composer shows actual output status and removes it after completion or cancellation');
    console.log('PASS native composer streams relay output and its native cancel button aborts upstream');
    for(let i=0;i<36;i++)appendCustomBridgeExchange(cid,{
        userPrompt:'长历史滚动验证 '+i,assistantReply:('第 '+i+' 轮模拟输出。\n\n').repeat(12),
        reasoning:i%3===0?'接口模拟思考摘要。':'',modelId:'fixture-only',modelName:'Fixture',
        toolSteps:[{id:'long-tool-'+i,name:'read_file',args:{path:'fixture-'+i+'.txt'},ok:true,output:'模拟工具结果'}]
    });
    await cdp.evaluate('window.__AGY_MODEL_SWITCHER.refreshState()');
    await new Promise(resolve=>setTimeout(resolve,400));
    const longHistory=await cdp.evaluate(`(async()=>{
        const api=window.__AGY_MODEL_SWITCHER,c=api.nativeContext(),view=document.querySelector('[data-testid="conversation-view"]');
        const scroll=[view,...view.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+300&&['auto','scroll'].includes(getComputedStyle(e).overflowY));
        if(!scroll)throw Error('测试聊天滚动容器不存在');
        for(const top of [scroll.scrollHeight,0,scroll.scrollHeight/2,0]){scroll.scrollTop=top;scroll.dispatchEvent(new Event('scroll'));await new Promise(resolve=>setTimeout(resolve,100));}
        const before=api.getState().bridge.exchanges.length;
        await c.router.navigate({to:'/',search:{section:'outside-of-project'}});await new Promise(resolve=>setTimeout(resolve,250));
        await c.router.navigate({to:'/c/$cascadeId',params:{cascadeId:'${cid}'},search:{section:'outside-of-project'}});await new Promise(resolve=>setTimeout(resolve,400));
        await api.refreshState();
        const state=api.nativeContext().states.peek('${cid}').getState();
        return {before,after:api.getState().bridge.exchanges.length,view:!!document.querySelector('[data-testid="conversation-view"]'),steps:state.trajectorySlice.stepsInSlice.length,hasHistory:document.querySelectorAll('[data-testid="user-input-step"]').length>0};
    })()`,20000);
    assert.equal(longHistory.before,37);assert.equal(longHistory.after,37);assert.equal(longHistory.view,true);assert.equal(longHistory.hasHistory,true);assert(longHistory.steps>100);
    console.log('PASS long relay history scrolls in both directions and survives navigating away and back');
    const edited = await cdp.evaluate(`(async()=>{
        const api=window.__AGY_MODEL_SWITCHER;
        await api.nativeContext().render.stepHandler.revertToIndex('${cid}',-1,{conversationOnly:true});
        return api.getState().bridge.exchanges.length;
    })()`);
    assert.equal(edited, 0);
    console.log('PASS native edit/retry removes only the fixture history and maps to the original step index');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Native UI checks passed without invoking a model.');
} finally {
    if (cid) {
        clearBridgeState(cid);
        await cdp.evaluate(`(async()=>{const context=window.__AGY_MODEL_SWITCHER.nativeContext().router?window.__AGY_MODEL_SWITCHER.nativeContext():window.__agyFixtureContext;await context.router.navigate({to:${JSON.stringify(originalUrl)}});await context.service.deleteSummary({cascadeId:${JSON.stringify(cid)}});await context.service.deleteCascadeTrajectory(${JSON.stringify(cid)});delete window.__agyFixtureContext;})()`).catch(error => console.error('Owned fixture cleanup:', error.message));
        const convDir = path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'conversations');
        assert.equal(fs.existsSync(path.join(convDir, `${cid}.db`)), false, '测试会话的原生数据库必须删除，不能仅清理摘要');
        assert.ok(readBridgeState(cid).deletedAt, '原生删除必须同步中转会话的删除状态');
        console.log('PASS native deletion removes the fixture database and persists its relay tombstone');
    }
    await cdp.call('Emulation.setFocusEmulationEnabled', { enabled: false });
    cdp.close();
}
