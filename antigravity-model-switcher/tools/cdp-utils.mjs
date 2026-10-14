import discovery from '../../antigravity-claude-skin/tools/cdp-discovery.cjs';

export async function connectToAntigravity() {
    const { targets } = await discovery.discoverCdp();
    const page = targets.find(target => target.type === 'page' && target.url.includes('127.0.0.1'));
    if (!page) throw new Error('Antigravity 窗口尚未就绪');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error('CDP 连接超时')); }, 5000);
        socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP 连接失败')); }, { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    const listeners = new Set();
    let frameId,contextId;
    socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data));
        if(message.method==='Runtime.executionContextsCleared')contextId=undefined;
        if(message.method==='Runtime.executionContextCreated'){const context=message.params.context;if(context.auxData?.isDefault&&context.auxData.frameId===frameId)contextId=context.id;}
        if (message.method) listeners.forEach(listener => listener(message));
        if (!message.id || !pending.has(message.id)) return;
        const { resolve, reject, timer } = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
    });
    const call = (method, params = {}, timeoutMs = 15000) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时: ${method}`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
    });
    try{const frame=(await call('Page.getFrameTree')).frameTree.frame;if(!discovery.isCommittedAppFrame(frame,page.url))throw Error('Antigravity 主页面尚未加载完成；请等待启动完成后重试');frameId=frame.id;await call('Runtime.enable');}catch(error){socket.close();throw error;}
    return {
        call,
        onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async evaluate(expression, timeoutMs = 15000) {
            const result = await call('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true }, timeoutMs);
            if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result?.value;
        },
        close() { socket.close(); }
    };
}
