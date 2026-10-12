// Re-emit narrower copies of existing native pages without changing stored history.
// This does not submit a prompt or call a model.
import assert from 'node:assert/strict';
import { connectToAntigravity } from './cdp-utils.mjs';

const cdp = await connectToAntigravity();
try {
    const result = await cdp.evaluate(`(async()=>{
        const api=window.__AGY_MODEL_SWITCHER;
        if(api.getState().isSendingCustomChat)throw Error('正在生成消息，跳过分页检查');
        const cid=api.getActiveConversationId(),context=api.nativeContext();
        const holder=context.states.getAgentStates().get(cid),provider=context.states.peek(cid);
        const raw=holder?.underlyingProvider?.getState(),slice=raw?.trajectorySlice;
        if(!slice?.stepsInSlice.length)throw Error('当前会话没有已加载的官方步骤，无法验证混合分页');
        const before=provider.getState().trajectorySlice;
        const relayKeys=value=>value.trajectorySlice.stepsInSlice.filter(step=>step.__agyRelay)
            .map(step=>step.metadata.sourceTrajectoryStepInfo.trajectoryId+':'+step.metadata.sourceTrajectoryStepInfo.stepIndex);
        const expected=relayKeys(provider.getState());
        if(!expected.length)throw Error('当前会话没有中转消息，无法验证混合分页');
        const failures=[];let emissions=0;
        const listener=provider.onDidChange(value=>{
            emissions++;
            if(JSON.stringify(relayKeys(value))!==JSON.stringify(expected))failures.push('relay history changed');
        });
        try{
            for(const steps of [slice.stepsInSlice.slice(0,1),slice.stepsInSlice.slice(-1),[]]){
                const start=steps[0]?.metadata.sourceTrajectoryStepInfo.stepIndex??slice.totalStepsLength;
                provider.setState({...raw,trajectorySlice:{...slice,stepsInSlice:steps,stepsSlice:{...slice.stepsSlice,startIndex:start,endIndexExclusive:start+steps.length}}});
                await new Promise(resolve=>setTimeout(resolve,40));
            }
            provider.setState({...raw,trajectorySlice:undefined});
            await new Promise(resolve=>setTimeout(resolve,80));
            const after=provider.getState().trajectorySlice;
            return {failures,emissions,relaySteps:expected.length,before:before.stepsInSlice.length,after:after.stepsInSlice.length,
                view:!!document.querySelector('[data-testid="conversation-view"]'),bubbles:document.querySelectorAll('[data-testid="user-input-step"]').length};
        }finally{listener.dispose();provider.setState(raw);}
    })()`);
    assert.deepEqual(result.failures, []);
    assert.equal(result.before, result.after);
    assert.equal(result.view, true);
    assert(result.bubbles > 0);
    console.log(`PASS ${result.relaySteps} relay steps remain present on every native page update, including an empty page and missing slice`);
    console.log('PASS existing conversation stays mounted; no stored history or model configuration was changed');
} finally {
    cdp.close();
}
