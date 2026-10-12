// Inspect the real menu and mock selection writes; no real model or settings calls.
import assert from 'node:assert/strict';
import { connectToAntigravity } from './cdp-utils.mjs';

const cdp = await connectToAntigravity();
try {
    await cdp.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    const result = await cdp.evaluate(`(async()=>{
        const api=window.__AGY_MODEL_SWITCHER;
        if(api.getState().isSendingCustomChat)throw new Error('正在生成消息，未测试模型菜单');
        const originalFetch=window.fetch;
        const manager=document.getElementById('agy-model-manager-backdrop');
        const managerDisplay=manager?.style.display;
        const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const original=await originalFetch('http://127.0.0.1:19823/api/models').then(r=>r.json());
        const models=structuredClone(original.models);
        let selected, selectionBody;
        window.fetch=async(url,options={})=>{
            if(String(url).endsWith('/api/models/reasoning')){
                selectionBody=JSON.parse(options.body);
                selected=models.find(m=>m.id===selectionBody.modelId);
                selected.reasoningEffort=selectionBody.effort;
                return new Response(JSON.stringify({ok:true,state:{...original,models,activeMode:'custom',activeModelId:selected.id}}),{headers:{'Content-Type':'application/json'}});
            }
            const response=await originalFetch(url,options);
            if(selected&&String(url).includes('/api/models?')){
                const data=await response.json();
                return new Response(JSON.stringify({...data,models,activeMode:'custom',activeModelId:selected.id}),{headers:{'Content-Type':'application/json'}});
            }
            return response;
        };
        try{
            if(manager)manager.style.display='none';
            if(!document.querySelector('[data-testid="model-selector-panel"]'))document.querySelector('[data-testid="model-selector-trigger"]').click();
            await pause(200);
            const inspected=[];
            for(const model of models.filter(m=>m.reasoningOptions.length)){
                const row=document.querySelector('[data-agy-custom-item][data-agy-model-id="'+model.id+'"]');
                row.scrollIntoView({block:'nearest'});row.click();await pause(30);
                const menu=document.querySelector('.agy-ms-effort-submenu'),rect=menu.getBoundingClientRect();
                inspected.push({name:model.name,options:[...menu.querySelectorAll('[data-agy-effort]')].map(e=>e.getAttribute('data-agy-effort')),
                    inViewport:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight,
                    clickable:menu.contains(document.elementFromPoint(rect.left+20,rect.top+40))});
            }
            const model=models.find(m=>m.reasoningOptions.some(o=>o.value==='high'));
            const relayRow=document.querySelector('[data-agy-custom-item][data-agy-model-id="'+model.id+'"]');
            const officialRow=document.querySelector('[data-testid="model-selector-panel"] [role="menuitem"]:not([data-agy-custom-item])');
            relayRow.click();await pause(30);
            document.querySelector('.agy-ms-effort-submenu [data-agy-effort]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
            const staysOpen=!!document.querySelector('.agy-ms-effort-submenu');
            officialRow.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
            const closesOnOfficialHover=!document.querySelector('.agy-ms-effort-submenu')&&relayRow.getAttribute('aria-expanded')==='false';
            await pause(50);
            document.querySelector('[data-agy-custom-item][data-agy-model-id="'+model.id+'"]').click();officialRow.focus();
            const closesOnOfficialFocus=!document.querySelector('.agy-ms-effort-submenu');
            await pause(50);
            document.querySelector('[data-agy-custom-item][data-agy-model-id="'+model.id+'"]').click();await pause(30);
            const menu=document.querySelector('.agy-ms-effort-submenu');
            menu.querySelector('[data-agy-effort="default"]').focus();
            for(let i=0;i<3;i++)document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
            const keyboardEffort=document.activeElement.getAttribute('data-agy-effort');
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
            await pause(150);
            const label=document.querySelector('[data-testid="model-selector-trigger"]').textContent;
            const untouched=await originalFetch('http://127.0.0.1:19823/api/models').then(r=>r.json());
            return {inspected,keyboardEffort,selectionBody,label,staysOpen,closesOnOfficialHover,closesOnOfficialFocus,
                preferencesUntouched:untouched.activeMode===original.activeMode&&untouched.activeModelId===original.activeModelId&&JSON.stringify(untouched.models.map(m=>m.reasoningEffort))===JSON.stringify(original.models.map(m=>m.reasoningEffort))};
        }finally{
            window.fetch=originalFetch;
            document.querySelector('.agy-ms-effort-submenu')?.remove();
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
            await api.refreshState();
            if(manager)manager.style.display=managerDisplay;
        }
    })()`, 15000);
    assert(result.inspected.length>0);
    for(const menu of result.inspected){assert(menu.inViewport,JSON.stringify(menu));assert(menu.clickable,JSON.stringify(menu));console.log(`PASS ${menu.name}: ${menu.options.join(', ')}`)}
    assert.equal(result.keyboardEffort,'high');
    assert.equal(result.selectionBody.effort,'high');
    assert(result.label.includes('高'));
    assert.equal(result.preferencesUntouched,true);
    assert.equal(result.staysOpen,true);
    assert.equal(result.closesOnOfficialHover,true);
    assert.equal(result.closesOnOfficialFocus,true);
    console.log('PASS native official hover/focus closes the relay submenu; entering effort options keeps it open');
    console.log('PASS native effort submenu placement, keyboard selection and composer label; real settings unchanged');
} finally {
    await cdp.call('Emulation.setFocusEmulationEnabled', { enabled: false });
    cdp.close();
}
