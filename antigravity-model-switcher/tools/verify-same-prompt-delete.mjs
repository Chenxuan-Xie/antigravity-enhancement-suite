// Real native menus; owned UUIDs and simulated replies only, no model calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { connectToAntigravity } from './cdp-utils.mjs';
import { appendCustomBridgeExchange, readBridgeState } from '../core/context-bridge.mjs';
const source=fs.readFileSync(new URL('../core/chat-injector.js',import.meta.url),'utf8');
const cdp=await connectToAntigravity();
const ids=[];
let originalUrl;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
    assert(await cdp.evaluate(`!window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat && !document.querySelector('[data-lexical-editor]')?.textContent.trim()`),'Busy or unsent draft; test skipped');
    originalUrl=await cdp.evaluate('location.pathname+location.search');
    await cdp.call('Emulation.setFocusEmulationEnabled',{enabled:true});
    for(let i=0;i<3;i++){
        const id=await cdp.evaluate(`(async()=>{const api=window.__AGY_MODEL_SWITCHER;await api.nativeContext().router.navigate({to:'/',search:{section:'outside-of-project'}});await new Promise(r=>setTimeout(r,150));return api.ensureNativeConversation('同提示词删除隔离回归验证');})()`);
        ids.push(id);
        appendCustomBridgeExchange(id,{userPrompt:'同提示词删除隔离回归验证',assistantReply:`独立测试回复 ${i+1}`,modelId:'fixture-only'});
    }
    assert.equal(new Set(ids).size,3);
    console.log('PASS three identical prompts create three independent native UUIDs');
    // The mock sits below the injection so the actual deletion interceptor runs.
    const failed=await cdp.evaluate(`(async()=>{
        window.__AGY_MODEL_SWITCHER_CLEANUP();const real=window.fetch;
        window.fetch=function(input,options){if(String(input).endsWith('/DeleteCascadeTrajectory')){const b=new TextEncoder().encode(JSON.stringify({error:{code:'internal',message:'owned failure fixture'}}));const bytes=new Uint8Array(b.length+5);bytes[0]=2;new DataView(bytes.buffer).setUint32(1,b.length);bytes.set(b,5);return Promise.resolve(new Response(bytes,{headers:{'Content-Type':'application/connect+json'}}));}return real.apply(this,arguments)};
        try{eval(${JSON.stringify(source)});await window.__AGY_MODEL_SWITCHER.refreshState();await new Promise(r=>setTimeout(r,250));
            const ctx=window.__AGY_MODEL_SWITCHER.nativeContext(),p=ctx.states.peek(${JSON.stringify(ids[2])}),request=p.requestPageUpdate;
            try{await ctx.service.deleteCascadeTrajectory(${JSON.stringify(ids[2])})}catch{}
            return {sameRequest:p.requestPageUpdate===request,projected:!!p.getState().__agyNativeProjection,reply:document.querySelector('[data-testid="conversation-view"]')?.innerText.includes('独立测试回复 3')};
        }finally{window.__AGY_MODEL_SWITCHER_CLEANUP();window.fetch=real;eval(${JSON.stringify(source)});await window.__AGY_MODEL_SWITCHER.refreshState();}
    })()`);
    assert.deepEqual(failed,{sameRequest:true,projected:true,reply:true});
    assert.equal(readBridgeState(ids[2]).deletedAt,0);
    console.log('PASS failed native deletion preserves provider actions, rendered history and saved relay data');
    await cdp.evaluate(`document.querySelector('[data-cascade-id="${ids[1]}"] [data-testid="conversation-kebab"]').click()`);
    await pause(150);
    await cdp.evaluate(`document.querySelector('[data-testid="conversation-delete-menu-item"]').click()`);
    await pause(150);
    await cdp.evaluate(`document.querySelector('[data-testid="confirm-delete-conversation"]').click()`);
    await pause(600);
    for(const [i,id]of ids.entries()) assert.equal(Boolean(readBridgeState(id).deletedAt),i===1);
    console.log('PASS the real native delete menu marks only the selected same-title conversation deleted');
    for(const [i,id]of ids.entries()){
        if(i===1)continue;
        const view=await cdp.evaluate(`(async()=>{const api=window.__AGY_MODEL_SWITCHER;await api.nativeContext().router.navigate({to:'/c/$cascadeId',params:{cascadeId:'${id}'},search:{section:'outside-of-project'}});await api.refreshState();await new Promise(r=>setTimeout(r,300));return {reply:document.querySelector('[data-testid="conversation-view"]')?.innerText.includes('独立测试回复 ${i+1}'),deleted:!!api.getState().bridge.deletedAt,error:!!document.getElementById('agy-ms-error-notice')};})()`);
        assert.deepEqual(view,{reply:true,deleted:false,error:false});
    }
    console.log('PASS surviving same-title conversations reopen with their own replies and no deleted-conversation alert');
} finally {
    try {
        await cdp.evaluate(`(async()=>{const ids=${JSON.stringify(ids)},api=window.__AGY_MODEL_SWITCHER,ctx=api.nativeContext();if(ids.includes(api.getActiveConversationId())&&!api.getState().isSendingCustomChat&&!document.querySelector('[data-lexical-editor]')?.textContent.trim())await ctx.router.navigate({to:${JSON.stringify(originalUrl||'/')},search:{section:'outside-of-project'}});for(const id of ids){if(id===api.getActiveConversationId())continue;await ctx.service.deleteCascadeTrajectory(id).catch(()=>{});await ctx.service.deleteSummary({cascadeId:id}).catch(()=>{});}})()`,20000);
    } finally { await cdp.call('Emulation.setFocusEmulationEnabled',{enabled:false});cdp.close(); }
}
