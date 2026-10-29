// All writes go to an isolated directory. Real model keys and histories are never modified.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scratchRoot = path.join(os.tmpdir(), 'antigravity-api-regression');
fs.mkdirSync(scratchRoot, { recursive: true });
const temporary = fs.mkdtempSync(path.join(scratchRoot, 'run-'));
process.env.AGY_MODEL_DATA_DIR = path.join(temporary, 'data');
process.env.AGY_MODEL_BRAIN_DIR = path.join(temporary, 'brain');
const store = await import('../core/model-store.mjs');
const bridge = await import('../core/context-bridge.mjs');
const client = await import('../core/model-client.mjs');
const reasoning = await import('../core/reasoning-config.mjs');
const { executeAgentTool } = await import('../core/agent-tools.mjs');
const { inspectAgentTurn, compactAgentMessages } = await import('../core/agent-turn-policy.mjs');
const { handleModelApiRequest } = await import('../core/api-handler.mjs');
const contextExpander = await import('../core/context-expander.mjs');
const requests = [];
let closedHangingResponses = 0;
let passed = 0;
let agentScript = null;
let agentRequestIndex = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(20); }
    throw new Error('Condition timed out');
};
const mock = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body || '{}');
    requests.push({ path: req.url, body: data });
    const model = data.model;
    const json = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if(['anthropic-usage-fixture','openai-usage-fixture'].includes(model)){
        res.writeHead(200,{'Content-Type':'text/event-stream'});
        const event=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
        if(model==='anthropic-usage-fixture'){
            event({type:'message_start',message:{usage:{input_tokens:4,cache_read_input_tokens:2}}});
            event({type:'content_block_delta',delta:{type:'text_delta',text:'usage fixture done'}});
            event({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:3}});
            res.end();
        }else{
            event({choices:[{delta:{content:'usage fixture done'},finish_reason:'stop'}]});
            await delay(30);event({choices:[],usage:{prompt_tokens:7,completion_tokens:5}});res.end('data: [DONE]\n\n');
        }return;
    }
    if (['claude-live-idle', 'claude-stop-open', 'openai-finish-open'].includes(model)) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders();
        const event = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
        if (model === 'claude-live-idle') {
            for (let i=0;i<8;i++) {
                event({ type:'content_block_delta', delta:{ type:'thinking_delta', thinking:'思考' } });
                await delay(45);
            }
            event({ type:'content_block_delta', delta:{ type:'text_delta', text:'持续输出完成' } });
            event({ type:'message_delta', delta:{ stop_reason:'end_turn' } });
        } else if (model === 'claude-stop-open') {
            event({ type:'content_block_delta', delta:{ type:'text_delta', text:'CLAUDE DONE' } });
            event({ type:'message_delta', delta:{ stop_reason:'end_turn' }, usage:{output_tokens:3} });
        } else {
            event({ choices:[{delta:{content:'OPENAI DONE'},finish_reason:'stop'}] });
        }
        res.once('close', () => closedHangingResponses++);
        return;
    }
    if (model === 'agent-fixture') {
        const turn = agentScript(agentRequestIndex++, data);
        if (turn.hang) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders();
            res.once('close', () => closedHangingResponses++);
            return;
        }
        if (data.stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            for (const content of turn.chunks || [turn.content || '']) {
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content, reasoning_content: turn.reasoning || '' } }] })}\n\n`);
                if (turn.chunkDelay) await delay(turn.chunkDelay);
            }
            if (turn.hangAfterChunks) { res.once('close', () => closedHangingResponses++); return; }
            res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: turn.finishReason || 'stop' }] })}\n\ndata: [DONE]\n\n`);
        } else json(200, { choices: [{ message: { content: turn.content || '', reasoning_content: turn.reasoning || '' }, finish_reason: turn.finishReason || 'stop' }] });
        return;
    }
    if (req.url.endsWith('/models')) return json(req.url.startsWith('/auth') ? 401 : 200,
        req.url.startsWith('/auth') ? { error: { message: 'invalid key' } } : { data: [{ id: 'gpt-test' }, { id: 'claude-test' }] });
    if (model === 'auth') return json(401, { error: { message: 'invalid key' } });
    if (model === 'quota') return json(429, { error: { message: 'quota exhausted' } });
    if (req.url.startsWith('/anthropic') && !req.url.endsWith('/messages')) return json(404, { error: 'wrong protocol' });
    if (model === 'stream-only' && !data.stream) return json(400, { error: { message: 'stream must be true' } });
    if (model === 'slow-test') await delay(100);
    if (model === 'headers-hang' || model === 'slow-json') {
        res.writeHead(200, { 'Content-Type': model === 'slow-json' ? 'application/json' : 'text/event-stream' });
        res.flushHeaders();
        if (model === 'slow-json') res.write('{"choices":[');
        res.once('close', () => closedHangingResponses++);
        return;
    }
    if (model === 'long-json') return json(200, { choices: [{ message: { content: 'x'.repeat(300000) } }] });
    if (model === 'json-stream') return json(200, { choices: [{ message: { content: 'JSON instead of SSE' } }] });
    if (data.stream || model === 'forced-sse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (req.url.endsWith('/messages')) {
            res.write('event: content_block_start\ndata: {"type":"content_block_start","content_block":{"text":"你好"}}\n\n');
            res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"世界"}}\n\n');
            res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
            return;
        }
        if (model === 'partial-error') {
            res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
            res.end('data: {"error":{"message":"upstream failed"}}\n\n');
            return;
        }
        if (model === 'partial-disconnect') {
            res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
            setTimeout(() => res.destroy(), 30);
            return;
        }
        const bytes = Buffer.from('data: {"choices":\r\ndata: [{"delta":{"content":"你好世界"}}]}\r\n\r\n');
        const split = bytes.indexOf(Buffer.from('你')) + 1;
        res.write(bytes.subarray(0, split));
        await delay(5);
        res.write(bytes.subarray(split));
        if (model === 'ended-open') {
            res.write('data: [DONE]\n\n');
            res.once('close', () => closedHangingResponses++);
            return;
        }
        res.end('data: [DONE]'); // intentionally omit the trailing newline
        return;
    }
    if (req.url.endsWith('/messages')) return json(200, { content: [{ type: 'text', text: 'ANTHROPIC OK' }] });
    json(200, { choices: [{ message: { content: 'OPENAI OK' } }] });
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${mock.address().port}`;
const api = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    await handleModelApiRequest(req, res, url.pathname); // exercise query parsing at the entry point
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const apiUrl = `http://127.0.0.1:${api.address().port}/api/models`;
const config = (modelId = 'gpt-test', protocol = 'openai', endpoint = baseUrl) => ({ modelId, protocol, baseUrl: endpoint, apiKey: 'sk-regression-secret' });
const fresh = () => store.saveModelStore({ version: 1, activeMode: 'official', activeModelId: null, models: [] });
const callApi = async (route, body) => {
    const res = await fetch(apiUrl + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
};
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
const agentTool = (name, args) => `<agy_tool name="${name}">${JSON.stringify(args)}</agy_tool>`;
const readFixture = agentTool('read_file', { path: path.join(temporary, 'agent-fixture.txt') });
fs.writeFileSync(path.join(temporary, 'agent-fixture.txt'), 'verified fixture');
let agentSession = 0;
const runAgent = async (stream, script) => {
    fresh();
    const model = store.upsertModel(config('agent-fixture'));
    agentScript = script; agentRequestIndex = 0;
    const cid = `agent-regression-${++agentSession}`;
    const body = { modelId: model.id, conversationId: cid, prompt: '检查安装和持久化，完成全部检查并验证' };
    if (!stream) return { ...(await callApi('/chat', body)).data, cid };
    const res = await fetch(apiUrl + '/chat/stream', { method: 'POST', body: JSON.stringify(body) });
    const text = await res.text();
    const frames = text.split('\n\n').filter(Boolean).map(frame => ({
        event: frame.match(/^event: (.+)/m)?.[1], data: JSON.parse(frame.match(/^data: (.+)/m)?.[1] || '{}')
    }));
    assert(!frames.some(frame => frame.event === 'error'), text);
    const done = frames.find(frame => frame.event === 'done');
    assert(done, text);
    return { ...done.data, frames, cid };
};

try {
    await check('model selection is scoped to each conversation', async () => {
        fresh();
        const first = store.upsertModel(config('per-conversation-a'));
        const second = store.upsertModel(config('per-conversation-b'));
        store.setSelectionState({ activeMode: 'custom', activeModelId: first.id, conversationId: 'conversation-a' });
        store.setSelectionState({ activeMode: 'custom', activeModelId: second.id, conversationId: 'conversation-b' });
        assert.equal(store.getSanitizedState('conversation-a').activeModelId, first.id);
        assert.equal(store.getSanitizedState('conversation-b').activeModelId, second.id);
        store.setSelectionState({ activeMode: 'official', conversationId: 'conversation-a' });
        assert.equal(store.getSanitizedState('conversation-a').activeMode, 'official');
        assert.equal(store.getSanitizedState('conversation-b').activeMode, 'custom');
    });

    await check('native @ file mentions are expanded into relay context', async () => {
        const mentionFile = path.join(temporary, 'mention-fixture.txt');
        fs.writeFileSync(mentionFile, 'alpha\nbeta\ngamma');
        fresh();
        const model = store.upsertModel(config('context-file-fixture'));
        const before = requests.length;
        const res = await callApi('/chat', {
            modelId: model.id, conversationId: 'context-file-fixture',
            prompt: `请阅读 [mention-fixture.txt](${mentionFile};file)`, enableTools: false
        });
        assert.equal(res.status, 200);
        const sent = requests[before].body.messages.find(message => message.role === 'user');
        assert.match(sent.content, /<CONTEXT_FILE/);
        assert.match(sent.content, /alpha\nbeta\ngamma/);
        assert.match(sent.content, /请阅读 @mention-fixture\.txt/);
    });

    await check('native line-range and quote mentions keep precise context in SSE chats', async () => {
        const mentionFile = path.join(temporary, 'mention-lines.txt');
        fs.writeFileSync(mentionFile, 'zero\none\ntwo\nthree');
        fresh();
        const model = store.upsertModel(config('context-lines-fixture'));
        const before = requests.length;
        const prompt = `看这两行 [mention-lines.txt#L2-L3](${mentionFile}#L2-L3;fileLineRange)，并参考 [Quote](label:Quote:${encodeURIComponent('原始引用')};textBlock)`;
        const res = await fetch(apiUrl + '/chat/stream', { method: 'POST', body: JSON.stringify({
            modelId: model.id, conversationId: 'context-lines-fixture', prompt, enableTools: false
        }) });
        assert.equal(res.status, 200);
        await res.text();
        const sent = requests[before].body.messages.find(message => message.role === 'user');
        assert.match(sent.content, /lines="2-3"/);
        assert.match(sent.content, /2: one\n3: two/);
        assert.match(sent.content, /<CONTEXT_QUOTE label="Quote">\n原始引用/);
        assert.match(sent.content, /@mention-lines\.txt#L2-L3/);
    });

    await check('slash-command tokens are detected and left for the native agent', async () => {
        const expanded = contextExpander.expandComposerContext('执行 [/browser](browser;slashCommand)');
        assert.equal(expanded.hasSlashCommand, true);
        assert.equal(expanded.contextText, '');
        assert.match(expanded.prompt, /;slashCommand\)/);
    });

    await check('progress from the reported dialogue continues while conclusions and user questions stop', async () => {
        for (const content of [
            '这个问题不能靠推测回答，得看代码。我先摸清项目结构和持久化/注入机制。',
            '继续深挖机制：关键是注入是怎么装进去的以及配置存在哪。',
            '关键点找到了：决定重启是否有效和更新是否有效的正是这个安装位置和加载方式。查一下。',
            '核心机制现在清楚了。还剩两个决定性问题：守护进程怎么开机自启，以及配置/会话落在哪个目录。',
            '守护进程在跑，但资源目录没探到——必须查清真实安装位置。',
            '我的工具标签格式出错了，重新写。',
            'PowerShell 转义踩坑了（中文 + 变量）。改成写脚本文件再执行，避免转义问题。',
            'CDP 端口拒绝连接，说明端口文件是陈旧的。跑一下环境探针确认。',
            '路径找到了：真实安装目录已确认。写个干净脚本把最后几点确认完。'
        ]) assert.equal(inspectAgentTurn({ content }).kind, 'progress', content);
        for (const content of ['检查完成：重启后配置仍在；更新后需要重新验证注入。', '下一步需要你提供正确的项目路径，可以吗？', '你好！', '可以继续使用，配置保存在本地。', '无法继续访问，需要用户确认权限。']) {
            assert.equal(inspectAgentTurn({ content }).kind, 'final', content);
        }
        assert.equal(inspectAgentTurn({ content: '`<agy_tool name="read_file">{}</agy_tool>` 是格式示例。' }).kind, 'final');
        for (const content of ['<agy_tool>{"name":"read_file"}</agy_tool>', '<function_call name="read_file">{}</function_call>', '<agy_tool name="read_file">null</agy_tool>']) {
            assert.equal(inspectAgentTurn({ content }).kind, 'repair');
        }
    });
    for (const stream of [false, true]) {
        const transport = stream ? 'SSE' : 'JSON';
        await check(`${transport} finishes an inspection beyond the old 12-round ceiling`, async () => {
            const result = await runAgent(stream, index => ({ content: index < 15 ? readFixture : '检查完成，已验证文件内容。' }));
            assert.equal(agentRequestIndex, 16); assert.equal(result.toolSteps.length, 15);
            assert.equal(result.completionStatus, 'complete'); assert.match(result.reply, /检查完成/);
            assert.equal(bridge.readBridgeState(result.cid).exchanges.length, 1);
        });
        await check(`${transport} automatically resumes a progress-only answer`, async () => {
            const result = await runAgent(stream, (index, data) => {
                if (index === 1) assert.match(data.messages.at(-1).content, /不要等待用户/);
                return { content: ['我先检查配置文件。', readFixture, '检查完成，文件内容已核实。'][index] };
            });
            assert.equal(agentRequestIndex, 3); assert.equal(result.toolSteps.length, 1);
            assert.equal(result.completionStatus, 'complete');
        });
        await check(`${transport} repairs malformed tool batches without repeating a write`, async () => {
            const output = path.join(temporary, `repaired-${transport}.txt`);
            const write = agentTool('write_file', { path: output, content: 'once' });
            const result = await runAgent(stream, (index, data) => {
                if (index === 0) return { content: write + '\n<agy_tool name=read_file>{"path":' };
                if (index === 1) { assert(!fs.existsSync(output)); assert.match(data.messages.at(-1).content, /没有执行任何工具/); return { content: write }; }
                return { content: '已完成并写入文件。' };
            });
            assert.equal(result.toolSteps.length, 1); assert.equal(fs.readFileSync(output, 'utf8'), 'once');
            assert(!result.reply.includes('<agy_tool'));
            if (stream) assert(!result.frames.filter(f => f.event === 'text_delta').map(f => f.data.delta).join('').includes('<agy_tool'));
        });
        await check(`${transport} continues after a real tool failure using its error result`, async () => {
            const result = await runAgent(stream, (index, data) => {
                if (index === 0) return { content: agentTool('read_file', { path: path.join(temporary, 'missing-file') }) };
                if (index === 1) { assert.match(data.messages.at(-1).content, /ok="false"/); return { content: readFixture }; }
                return { content: '检查完成，正确路径已核实。' };
            });
            assert.equal(result.toolSteps[0].ok, false); assert.equal(result.toolSteps[1].ok, true);
            assert.equal(result.completionStatus, 'complete');
        });
        await check(`${transport} resumes a token-limited answer and unsupported structured call`, async () => {
            const result = await runAgent(stream, index => [
                { content: '尚未核实所有配置', finishReason: 'length' },
                { content: '', finishReason: 'tool_calls' },
                { content: readFixture },
                { content: '检查完成，配置已经核实。' }
            ][index]);
            assert.equal(agentRequestIndex, 4); assert.equal(result.toolSteps.length, 1);
            assert.equal(result.completionStatus, 'complete');
        });
        await check(`${transport} bounds repeated malformed output and saves an explicit incomplete result`, async () => {
            const result = await runAgent(stream, () => ({ content: '<agy_tool name="read_file">{"path":' }));
            assert.equal(agentRequestIndex, 5); assert.equal(result.toolSteps.length, 0);
            assert.equal(result.completionStatus, 'incomplete'); assert.match(result.reply, /尚未完成/);
            assert.match(bridge.readBridgeState(result.cid).exchanges[0].assistantReply, /尚未完成/);
            assert.equal(bridge.readBridgeState(result.cid).exchanges[0].completionStatus, 'incomplete');
            assert(!result.reply.includes('工具已执行完成'));
        });
        await check(`${transport} continues beyond 48 rounds until the task completes`, async () => {
            const result = await runAgent(stream, index => ({ content: index < 55 ? readFixture : '检查完成，全部步骤通过。' }));
            assert.equal(agentRequestIndex, 56); assert.equal(result.toolSteps.length, 55);
            assert.equal(result.completionStatus, 'complete'); assert.match(result.reply, /检查完成/);
        });
    }
    await check('Anthropic and buffered SSE preserve the provider stop reason', async () => {
        assert.equal(client.parseRawModelResponse(JSON.stringify({ content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens' }), 'anthropic').finishReason, 'max_tokens');
        assert.equal(client.parseRawModelResponse('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n').finishReason, 'length');
    });
    await check('fragmented malformed tool tags stay hidden during streaming repair', async () => {
        const result = await runAgent(true, index => index === 0 ? { chunks: ['<f', 'unction', '_call name="read_file">{}</function_call>'] } : { content: '检查完成。' });
        assert.equal(agentRequestIndex, 2);
        assert(!result.frames.filter(frame => frame.event === 'text_delta').map(frame => frame.data.delta).join('').includes('<function_call'));
    });
    await check('progress-only loops are bounded without prompting continuation forever', async () => {
        const result = await runAgent(true, () => ({ content: '我继续检查文件。' }));
        assert.equal(agentRequestIndex, 4); assert.equal(result.completionStatus, 'incomplete');
        assert.match(result.reply, /尚未完成/);
    });
    await check('user cancellation aborts an automatic continuation and cannot start a later round', async () => {
        fresh(); const saved = store.upsertModel(config('agent-fixture'));
        agentRequestIndex = 0;
        agentScript = index => index === 0 ? { content: '我继续检查文件。' } : { hang: true };
        const controller = new AbortController(); const before = closedHangingResponses;
        const response = await fetch(apiUrl + '/chat/stream', { method: 'POST', signal: controller.signal,
            body: JSON.stringify({ modelId: saved.id, conversationId: 'agent-stop-fixture', prompt: '检查完整任务' }) });
        const reading = response.text().catch(() => 'cancelled');
        await until(() => agentRequestIndex === 2);
        controller.abort(); await reading;
        await until(() => closedHangingResponses > before);
        assert.equal(agentRequestIndex, 2);
        const savedExchange = bridge.readBridgeState('agent-stop-fixture').exchanges[0];
        assert.equal(savedExchange.completionStatus, 'incomplete'); assert.match(savedExchange.assistantReply, /继续检查/);
    });
    await check('partial text is durable before the stream finishes and survives disconnection', async () => {
        fresh(); const model = store.upsertModel(config('agent-fixture'));
        agentRequestIndex = 0; agentScript = () => ({ chunks: ['已开始检查。', '配置已读取。'], chunkDelay: 1100, hangAfterChunks: true });
        const cid = 'agent-partial-checkpoint', controller = new AbortController();
        const response = await fetch(apiUrl + '/chat/stream', { method: 'POST', signal: controller.signal,
            body: JSON.stringify({ modelId: model.id, conversationId: cid, prompt: '检查并保存过程' }) });
        const reading = response.text().catch(() => 'cancelled');
        await until(() => bridge.readBridgeState(cid).exchanges[0]?.assistantReply?.includes('配置已读取'));
        const disk = JSON.parse(fs.readFileSync(path.join(bridge.BRIDGES_DIR, cid + '.json'), 'utf8'));
        assert.equal(disk.exchanges.length, 1); assert.equal(disk.exchanges[0].completionStatus, 'incomplete');
        controller.abort(); await reading; await delay(100);
        const saved = bridge.readBridgeState(cid).exchanges[0];
        assert.match(saved.assistantReply, /配置已读取/); assert(saved.error); assert.equal(agentRequestIndex, 1);
    });
    await check('long-running context compacts without dropping the original request, image or recent results', async () => {
        const original = { role: 'user', content: '原始完整任务', images: [{ dataUrl: 'fixture-image' }] };
        const messages = [original, ...Array.from({ length: 70 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: `result-${i}:` + 'x'.repeat(8000) }))];
        compactAgentMessages(messages, original.content);
        assert.equal(messages[0], original); assert.equal(messages.at(-1).content.slice(0,10), 'result-69:');
        assert(messages.reduce((n, m) => n + m.content.length, 0) < 100000);
        assert.match(messages[1].content, /先前执行记录/);
    });
    await check('effort choices match the model and protocol instead of advertising unsupported levels', async () => {
        assert.deepEqual(reasoning.getReasoningValues(config('gpt-6-astra')), ['default','low','medium','high','xhigh','max']);
        assert.deepEqual(reasoning.getReasoningValues(config('claude-opus-5-5','anthropic')), ['default','low','medium','high','xhigh','max']);
        assert.deepEqual(reasoning.getReasoningValues(config('claude-fable-5-1','anthropic')), ['default','low','medium','high','xhigh','max']);
        assert.deepEqual(reasoning.getReasoningValues(config('deepseek-v4-pro')), ['default','none','low','high','max']);
        assert.deepEqual(reasoning.getReasoningValues(config('gpt-4o')), []);
        assert.deepEqual(reasoning.getReasoningValues(config('claude-opus-5-5','openai')), []);
        assert.throws(()=>reasoning.resolveReasoningEffort(config('gpt-6-astra'),'none'),/不支持/);
        assert.throws(()=>reasoning.resolveReasoningEffort(config('deepseek-flash'),'medium'),/不支持/);
    });
    await check('default effort leaves provider thinking parameters unspecified', async () => {
        for (const protocol of ['openai','anthropic']) {
            const body=client.buildProtocolRequestBody({protocol,modelId:protocol==='openai'?'gpt-6-astra':'claude-opus-5-5',turns:[{role:'user',content:'ping'}]});
            assert.equal(body.reasoning_effort,undefined);assert.equal(body.thinking,undefined);assert.equal(body.output_config,undefined);
        }
    });
    await check('Claude adaptive effort and old thinking budgets use valid wire parameters', async () => {
        const body=client.buildProtocolRequestBody({protocol:'anthropic',modelId:'claude-opus-5-5',turns:[],reasoningEffort:'xhigh',effectiveTemp:0.7});
        assert.deepEqual(body.output_config,{effort:'xhigh'});assert.deepEqual(body.thinking,{type:'adaptive'});assert.equal(body.temperature,undefined);
        const old=client.buildProtocolRequestBody({protocol:'anthropic',modelId:'claude-opus-4-5',turns:[],reasoningEffort:'high',maxTokens:4096});
        assert.equal(old.thinking.budget_tokens,8192);assert(old.max_tokens>old.thinking.budget_tokens);
    });
    await check('DeepSeek thinking switch and effort use its supported levels', async () => {
        for(const effort of ['none','low','high','max']){
            const body=client.buildProtocolRequestBody({protocol:'openai',modelId:'deepseek-v4-pro',turns:[],reasoningEffort:effort});
            assert.equal(body.reasoning_effort,effort);assert.equal(body.thinking.type,effort==='none'?'disabled':'enabled');
        }
    });
    await check('effort selection is atomic, persists per model and never exposes credentials', async () => {
        fresh();const first=store.upsertModel(config('gpt-6-astra')),second=store.upsertModel(config('claude-opus-5-5','anthropic'));
        const result=await callApi('/reasoning',{modelId:first.id,effort:'high',activate:true});
        assert.equal(result.status,200);assert.equal(result.data.state.activeModelId,first.id);
        assert.equal(result.data.state.activeModel.reasoningEffort,'high');assert(!JSON.stringify(result.data).includes('sk-regression-secret'));
        const before=fs.readFileSync(store.MODELS_FILE,'utf8');
        assert.equal((await callApi('/reasoning',{modelId:first.id,effort:'none',activate:true})).status,400);
        assert.equal(fs.readFileSync(store.MODELS_FILE,'utf8'),before);
        store.setActiveSelection('custom',second.id);assert.equal(store.getModelById(first.id).reasoningEffort,'high');
        store.upsertModel({...store.getModelById(first.id),name:'renamed'});assert.equal(store.getModelById(first.id).reasoningEffort,'high');
        store.upsertModel({...store.getModelById(first.id),modelId:'gpt-4o',reasoningEffort:undefined});assert.equal(store.getModelById(first.id).reasoningEffort,'default');
    });
    await check('streaming and JSON requests both transmit saved effort and per-request overrides', async () => {
        const messages=[{role:'user',content:'ping'}];
        for(const [modelId,protocol,effort] of [['gpt-6-astra','openai','max'],['claude-fable-5-1','anthropic','low'],['deepseek-flash','openai','high']]){
            const cfg={...config(modelId,protocol),reasoningEffort:effort};
            assert.equal((await client.chatWithModel(cfg,messages)).ok,true);
            let wire=requests.at(-1).body;assert.equal(protocol==='anthropic'?wire.output_config.effort:wire.reasoning_effort,effort);
            assert.equal((await client.streamChatWithModel(cfg,messages,{reasoningEffort:'low'})).ok,true);
            wire=requests.at(-1).body;assert.equal(protocol==='anthropic'?wire.output_config.effort:wire.reasoning_effort,'low');
            if(modelId==='gpt-6-astra'){assert.equal(wire.max_tokens,undefined);assert.equal(wire.max_completion_tokens,4096)}
        }
    });
    await check('chat routes forward effort to the provider without changing saved preference', async () => {
        fresh();const saved=store.upsertModel({...config('gpt-6-astra'),reasoningEffort:'high'});
        const body={modelId:saved.id,prompt:'ping',conversationId:'startpage-effort-json',enableTools:false,reasoningEffort:'low'};
        assert.equal((await callApi('/chat',body)).status,200);assert.equal(requests.at(-1).body.reasoning_effort,'low');
        const stream=await fetch(apiUrl+'/chat/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,conversationId:'startpage-effort-stream',reasoningEffort:'max'})});
        assert((await stream.text()).includes('event: done'));assert.equal(requests.at(-1).body.reasoning_effort,'max');
        assert.equal(store.getModelById(saved.id).reasoningEffort,'high');
        bridge.clearBridgeState('startpage-effort-json');
        bridge.clearBridgeState('startpage-effort-stream');
    });
    await check('selection rejects missing models without changing stored state', async () => {
        fresh();
        assert.throws(() => store.setActiveSelection('custom'), /添加/);
        const first = store.upsertModel(config());
        store.setActiveSelection('custom', first.id);
        const before = fs.readFileSync(store.MODELS_FILE, 'utf8');
        assert.throws(() => store.setActiveSelection('custom', 'deleted-model'), /不存在/);
        assert.throws(() => store.setActiveSelection('invalid'), /无效/);
        assert.equal(fs.readFileSync(store.MODELS_FILE, 'utf8'), before);
        assert.equal(store.resolveModelByIdOrName('missing'), null);
    });
    await check('editing other models preserves selection and blank keys', async () => {
        fresh();
        const first = store.upsertModel(config());
        const second = store.upsertModel(config('second'));
        store.setActiveSelection('custom', first.id);
        const edited = store.upsertModel({ ...config('second'), id: second.id, name: 'renamed', apiKey: '' });
        assert.equal(edited.apiKey, 'sk-regression-secret');
        assert.equal(store.getSanitizedState().activeModelId, first.id);
        assert.throws(() => store.upsertModel({ ...config(), id: 'missing' }), /不存在/);
    });
    await check('deleting the active relay returns to official mode', async () => {
        const active = store.getSanitizedState().activeModelId;
        store.deleteModel(active);
        assert.equal(store.getSanitizedState().activeMode, 'official');
    });
    await check('invalid URL, protocol and numeric settings are rejected', async () => {
        for (const fields of [{ baseUrl: 'example.com' }, { baseUrl: 'file:///test' }, { baseUrl: baseUrl + '?secret=1' }, { protocol: 'bad' }, { maxTokens: -1 }, { temperature: 'NaN' }]) {
            assert.throws(() => store.upsertModel({ ...config(), ...fields }));
        }
    });
    await check('test status resets when configuration changes and ignores stale results', async () => {
        fresh();
        const saved = store.upsertModel(config());
        store.recordTestResult(saved.id, { ok: true, resolvedProtocol: 'openai' }, saved);
        store.upsertModel({ ...saved, modelId: 'updated' });
        store.recordTestResult(saved.id, { ok: true }, saved);
        assert.equal(store.getModelById(saved.id).lastTestOk, null);
        assert.equal(store.getModelById(saved.id).resolvedProtocol, undefined);
    });
    await check('API keys are absent from public responses', async () => {
        const result = await callApi('?conversationId=startpage-test');
        assert.equal(result.status, 200);
        assert(!JSON.stringify(result.data).includes('sk-regression-secret'));
    });
    await check('invalid selection is atomic across mode and relay settings', async () => {
        const before = fs.readFileSync(store.MODELS_FILE, 'utf8');
        const result = await callApi('/select', { mode: 'custom', modelId: 'missing', chatRelayMode: 'mcp' });
        assert.equal(result.status, 400);
        assert.equal(fs.readFileSync(store.MODELS_FILE, 'utf8'), before);
    });
    await check('unrelated websites cannot read relay history or change settings', async () => {
        const before = fs.readFileSync(store.MODELS_FILE, 'utf8');
        const denied = await fetch(apiUrl + '/select', { method: 'POST', headers: { Origin: 'https://unrelated.example' }, body: JSON.stringify({ mode: 'custom' }) });
        assert.equal(denied.status, 403);
        assert.equal((await fetch(apiUrl, { headers: { Origin: 'https://unrelated.example' } })).status, 403);
        assert.equal(fs.readFileSync(store.MODELS_FILE, 'utf8'), before);
        assert.equal((await fetch(apiUrl + '?conversationId=startpage-test', { headers: { Origin: 'https://127.0.0.1:1234' } })).status, 200);
    });
    await check('corrupted stores are preserved rather than silently overwritten', async () => {
        const original = fs.readFileSync(store.MODELS_FILE, 'utf8');
        fs.writeFileSync(store.MODELS_FILE, '{broken');
        assert.throws(() => store.upsertModel(config()), /原文件已保留/);
        assert.equal(fs.readFileSync(store.MODELS_FILE, 'utf8'), '{broken');
        fs.writeFileSync(store.MODELS_FILE, '{"models":{}}');
        assert.throws(() => store.upsertModel(config()), /原文件已保留/);
        assert.equal(fs.readFileSync(store.MODELS_FILE, 'utf8'), '{"models":{}}');
        fs.writeFileSync(store.MODELS_FILE, original);
    });
    await check('full endpoint URLs normalize when the protocol changes', async () => {
        assert.equal(client.buildEndpointCandidates(baseUrl + '/v1/messages', 'openai')[0], baseUrl + '/v1/chat/completions');
        assert.equal(client.buildEndpointCandidates(baseUrl + '/v1/chat/completions', 'anthropic')[0], baseUrl + '/v1/messages');
        assert.equal(client.buildEndpointCandidates(baseUrl + '/custom/messages', 'anthropic')[0], baseUrl + '/custom/messages');
    });
    await check('OpenAI and Anthropic JSON requests succeed', async () => {
        assert.equal((await client.chatWithModel(config(), [{ role: 'user', content: 'ping' }])).content, 'OPENAI OK');
        assert.equal((await client.chatWithModel(config('claude-test', 'anthropic'), [{ role: 'user', content: 'ping' }])).content, 'ANTHROPIC OK');
    });
    await check('auto protocol fallback works for Anthropic-only gateways', async () => {
        const result = await client.chatWithModel(config('claude-test', 'auto', baseUrl + '/anthropic/v1/chat/completions'), [{ role: 'user', content: 'ping' }]);
        assert.equal(result.ok, true);
        assert.equal(result.protocol, 'anthropic');
    });
    await check('401 and 429 stop further requests and preserve the real error', async () => {
        for (const model of ['auth', 'quota']) {
            const before = requests.length;
            const result = await client.streamChatWithModel(config(model, 'auto'), [{ role: 'user', content: 'ping' }]);
            assert.equal(result.ok, false);
            assert.equal(requests.length - before, 1);
        }
    });
    await check('SSE handles multiline frames, split UTF-8 and an unterminated final frame', async () => {
        let text = '';
        const result = await client.streamChatWithModel(config(), [{ role: 'user', content: 'ping' }], {}, { onTextDelta: delta => { text += delta; } });
        assert.equal(result.content, '你好世界');
        assert.equal(text, '你好世界');
    });
    await check('Anthropic streaming text and message_stop are parsed', async () => {
        assert.equal((await client.streamChatWithModel(config('claude-test', 'anthropic'), [{ role: 'user', content: 'ping' }])).content, '你好世界');
    });
    await check('streaming requests accept ordinary JSON including large replies', async () => {
        assert.equal((await client.streamChatWithModel(config('json-stream'), [{ role: 'user', content: 'ping' }])).content, 'JSON instead of SSE');
        assert.equal((await client.streamChatWithModel(config('long-json'), [{ role: 'user', content: 'ping' }])).content.length, 300000);
    });
    await check('a partial stream error never retries or reports success', async () => {
        const before = requests.length;
        let text = '';
        const result = await client.streamChatWithModel(config('partial-error', 'auto'), [{ role: 'user', content: 'ping' }], {}, { onTextDelta: delta => { text += delta; } });
        assert.equal(result.ok, false);
        assert.match(result.error, /upstream failed/);
        assert.equal(text, 'partial');
        assert.equal(requests.length - before, 1);
    });
    await check('transport failure after partial output never duplicates requests', async () => {
        const before = requests.length;
        const result = await client.streamChatWithModel(config('partial-disconnect', 'auto'), [{ role: 'user', content: 'ping' }]);
        assert.equal(result.ok, false);
        assert.equal(requests.length - before, 1);
    });
    await check('body-read deadlines stop hanging SSE and JSON responses', async () => {
        for (const model of ['headers-hang', 'slow-json']) {
            const before = requests.length;
            const started = Date.now();
            const result = await client.streamChatWithModel(config(model, 'auto'), [{ role: 'user', content: 'ping' }], { timeoutMs: 150 });
            assert.equal(result.ok, false);
            assert(Date.now() - started < 1500);
            assert.equal(requests.length - before, 1);
        }
    });
    await check('SSE completion closes a connection that upstream leaves open', async () => {
        const before = closedHangingResponses;
        const result = await client.streamChatWithModel(config('ended-open'), [{ role: 'user', content: 'ping' }], { timeoutMs: 1000 });
        assert.equal(result.ok, true);
        await until(() => closedHangingResponses > before);
    });
    await check('Claude thinking can exceed the timeout duration while its stream remains active', async () => {
        let thinking='';
        const started=Date.now();
        const result=await client.streamChatWithModel(config('claude-live-idle','anthropic'),[{role:'user',content:'ping'}],{timeoutMs:150},{onThinkingDelta:delta=>{thinking+=delta;}});
        assert.equal(result.ok,true,result.error);
        assert.equal(result.content,'持续输出完成');
        assert.equal(thinking,'思考'.repeat(8));
        assert(Date.now()-started>300);
    });
    await check('Claude stop_reason and OpenAI finish_reason complete without EOF or DONE', async () => {
        for(const [model,protocol,expected] of [['claude-stop-open','anthropic','CLAUDE DONE'],['openai-finish-open','openai','OPENAI DONE']]){
            const before=closedHangingResponses;
            const result=await client.streamChatWithModel(config(model,protocol),[{role:'user',content:'ping'}],{timeoutMs:1000});
            assert.equal(result.ok,true,result.error);assert.equal(result.content,expected);
            await until(()=>closedHangingResponses>before);
        }
    });
    await check('provider activity is reported independently from genuine Claude reasoning content', async () => {
        const saved=store.upsertModel(config('claude-live-idle','anthropic'));
        const response=await fetch(apiUrl+'/chat/stream',{method:'POST',body:JSON.stringify({modelId:saved.id,conversationId:'activity-fixture',prompt:'ping',enableTools:false,timeoutMs:150})});
        const raw=await response.text();
        assert(!raw.includes('event: error'),raw);
        const monitor=raw.match(/event: activity\ndata: ([^\n]+)/);
        assert(monitor,'Provider transport activity must be visible to the UI');
        const data=JSON.parse(monitor[1]);
        assert.equal(data.providerSeen,true);
        assert.equal(data.timeoutMs,150);
        assert(data.phase!=='thinking','A response header is not thinking content');
        assert(raw.includes('event: thinking_delta')&&raw.includes('event: done'));
    });
    await check('Anthropic streaming merges input/cache usage with the final output count',async()=>{
        const result=await client.streamChatWithModel(config('anthropic-usage-fixture','anthropic'),[{role:'user',content:'fixture'}]);
        assert.equal(result.usage.input_tokens,4);assert.equal(result.usage.output_tokens,3);assert.equal(result.usage.cache_read_input_tokens,2);
    });
    await check('OpenAI usage after finish_reason is captured without waiting forever',async()=>{
        const result=await client.streamChatWithModel(config('openai-usage-fixture'),[{role:'user',content:'fixture'}]);
        assert.equal(result.usage.prompt_tokens,7);assert.equal(result.usage.completion_tokens,5);assert.equal(requests.at(-1).body.stream_options.include_usage,true);
    });
    await check('chat SSE returns normalized usage and persists it in the same exchange',async()=>{
        const model=store.upsertModel(config('anthropic-usage-fixture','anthropic'));
        const response=await fetch(apiUrl+'/chat/stream',{method:'POST',body:JSON.stringify({modelId:model.id,prompt:'fixture',conversationId:'usage-fixture',enableTools:false})});
        const done=JSON.parse((await response.text()).split('event: done\ndata: ')[1].split('\n\n')[0]);
        assert.equal(done.usage.inputTokens,6);assert.equal(done.usage.outputTokens,3);assert.equal(done.usage.complete,true);
        assert.deepEqual(bridge.readBridgeState('usage-fixture').exchanges[0].usage,done.usage);
    });
    await check('caller cancellation reaches upstream and disables fallback', async () => {
        const before = requests.length;
        const controller = new AbortController();
        const task = client.streamChatWithModel(config('headers-hang', 'auto'), [{ role: 'user', content: 'ping' }], { signal: controller.signal });
        await until(() => requests.length > before);
        controller.abort(new Error('user stopped'));
        assert.equal((await task).ok, false);
        assert.equal(requests.length - before, 1);
    });
    await check('cancellation also stops an active local command', async () => {
        const controller = new AbortController();
        const started = Date.now();
        const task = executeAgentTool('run_command', { command: 'Start-Sleep -Seconds 5', cwd: temporary }, { signal: controller.signal });
        setTimeout(() => controller.abort(new Error('user stopped')), 100);
        const result = await task;
        assert.equal(result.ok, false);
        assert(Date.now() - started < 2000);
    });
    await check('stream-only relay falls back from non-stream requests', async () => {
        const result = await client.chatWithModel(config('stream-only'), [{ role: 'user', content: 'ping' }]);
        assert.equal(result.ok, true);
        // Simple single-line frames are used by legacy aggregation.
    });
    await check('invalid conversation IDs cannot silently select another chat', async () => {
        assert.throws(() => bridge.resolveConversationId('../bad'), /无效/);
        const result = await callApi('?conversationId=../bad');
        assert.equal(result.status, 400);
    });
    await check('history survives reloads and remains isolated by conversation', async () => {
        bridge.appendCustomBridgeExchange('startpage-session-a', { userPrompt: 'A', assistantReply: 'reply A' });
        bridge.appendCustomBridgeExchange('startpage-session-b', { userPrompt: 'B', assistantReply: 'reply B' });
        const result = await callApi('?conversationId=startpage-session-a');
        assert.equal(result.data.bridge.conversationId, 'startpage-session-a');
        assert.equal(result.data.bridge.exchanges[0].assistantReply, 'reply A');
        assert.equal(bridge.listLocalCustomSessions().length, 2);
    });
    await check('over 60 exchanges are retained on disk', async () => {
        bridge.writeBridgeState('retention-session', { exchanges: Array.from({ length: 65 }, (_, i) => ({ id: `ex-${i}`, userPrompt: 'p', assistantReply: 'r' })) });
        assert.equal(bridge.readBridgeState('retention-session').exchanges.length, 65);
    });
    await check('corrupted bridge files cannot be overwritten with empty history', async () => {
        const file = path.join(bridge.BRIDGES_DIR, 'broken-session.json');
        fs.writeFileSync(file, '{"exchanges":{}}');
        assert.throws(() => bridge.appendCustomBridgeExchange('broken-session', { userPrompt: 'p', assistantReply: 'r' }), /原文件已保留/);
        assert.equal(fs.readFileSync(file, 'utf8'), '{"exchanges":{}}');
    });
    await check('bridge sync is confirmed by transcript and migrates local history', async () => {
        const source = 'startpage-session-a';
        const receipt = bridge.consumeUnsyncedCustomTurns(source, { markAsSynced: false });
        assert.equal(bridge.readBridgeState(source).exchanges[0].syncedToOfficial, false);
        const target = '01234567-89ab-cdef-0123-456789abcdef';
        const logs = path.join(process.env.AGY_MODEL_BRAIN_DIR, target, '.system_generated', 'logs');
        fs.mkdirSync(logs, { recursive: true });
        fs.writeFileSync(path.join(logs, 'transcript_full.jsonl'), JSON.stringify({ type: 'USER_INPUT', step_index: 0, content: 'continue\n\n' + receipt.bridgeBlock }) + '\n');
        const unified = bridge.buildUnifiedConversationHistory(target);
        assert.deepEqual(unified.messages.map(message => message.content), ['A', 'reply A', 'continue']);
        assert.equal(unified.unsyncedCustomCount, 0);
        assert.equal(bridge.readBridgeState(source).exchanges[0].syncedToOfficial, true);
        assert.equal(bridge.buildUnifiedConversationHistory(target).exchanges.length, 1);
        // New exchanges appended after preparing the receipt are not accidentally acknowledged.
        bridge.appendCustomBridgeExchange(source, { userPrompt: 'new', assistantReply: 'new reply' });
        bridge.buildUnifiedConversationHistory(target);
        assert.equal(bridge.readBridgeState(source).exchanges[1].syncedToOfficial, false);
    });
    await check('legacy relay sessions migrate once into a native conversation without deleting history', async () => {
        const source = 'startpage-migration-fixture';
        const target = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        const exchange = bridge.appendCustomBridgeExchange(source, { userPrompt: 'Migration', assistantReply: 'Reply', latencyMs: 2500,
            toolSteps: [{ id: 'tool', name: 'read_file', args: { path: 'fixture' }, output: 'read output', ok: true }] });
        const migrated = await callApi('/bridge/migrate', { sourceId: source, conversationId: target });
        assert.equal(migrated.data.conversationId, target);
        assert.equal(bridge.readBridgeState(source).exchanges.length, 1);
        const saved = bridge.readBridgeState(target).exchanges[0];
        assert.equal(saved.id, exchange.id);
        assert.equal(saved.afterOfficialStepIndex, -1);
        assert.equal(saved.latencyMs, 2500);
        assert.equal(saved.toolSteps[0].output, 'read output');
        assert.equal(bridge.listLocalCustomSessions().some(session => session.conversationId === source), false);
        const repeated = await callApi('/bridge/migrate', { sourceId: source, conversationId: '11111111-2222-3333-4444-555555555555' });
        assert.equal(repeated.data.conversationId, target);
        assert.equal(bridge.readBridgeState(target).exchanges.length, 1);
        const invalid = await callApi('/bridge/migrate', { sourceId: target, conversationId: source });
        assert.equal(invalid.data.ok, false);
    });
    await check('native deletion retains recovery data, hides history and rejects late writes across reloads', async () => {
        const cid = 'aaaaaaaa-1111-2222-3333-eeeeeeeeeeee';
        const source = 'startpage-deletion-fixture';
        bridge.appendCustomBridgeExchange(source, { userPrompt: 'Delete this fixture', assistantReply: 'Recovery data' });
        bridge.migrateLocalBridge(source, cid);
        const stale = bridge.readBridgeState(cid);
        const result = await callApi('/bridge/delete', { conversationId: cid });
        assert.equal(result.data.ok, true);
        assert.ok(result.data.deletedAt > 0);
        assert.equal(bridge.readBridgeState(cid).exchanges.length, 1);
        assert.equal(bridge.buildUnifiedConversationHistory(cid).exchanges.length, 0);
        assert.ok(bridge.readBridgeState(source).deletedAt);
        assert.equal(bridge.listLocalCustomSessions().some(s => s.conversationId === source), false);
        assert.throws(() => bridge.writeBridgeState(cid, stale), /已删除/);
        assert.throws(() => bridge.appendCustomBridgeExchange(cid, { userPrompt: 'Late', assistantReply: 'Reply' }), /已删除/);
        assert.throws(() => bridge.migrateLocalBridge(source, 'bbbbbbbb-1111-2222-3333-eeeeeeeeeeee'), /已删除/);
        bridge.clearBridgeState(cid);
        const reloaded = await import('../core/context-bridge.mjs?deletion-reload');
        assert.equal(reloaded.buildUnifiedConversationHistory(cid).customExchangeCount, 0);
        assert.equal((await callApi('/bridge/delete', { conversationId: cid })).data.deletedAt, result.data.deletedAt);
        assert.equal((await callApi('/bridge/info?conversationId=' + cid)).data.deletedAt, result.data.deletedAt);
        assert.equal((await callApi('/bridge/delete', { conversationId: 'auto' })).data.ok, false);
    });
    await check('three identical prompts retain independent UUIDs, deletion and migration across reloads', async () => {
        const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
        const sources=ids.map((_,i)=>`startpage-same-prompt-${i}`);
        for(const [i,id]of ids.entries()){
            bridge.appendCustomBridgeExchange(sources[i],{userPrompt:'完全相同的提示词',assistantReply:`独立回复 ${i}`});
            bridge.migrateLocalBridge(sources[i],id);
        }
        const result=await callApi('/bridge/delete',{conversationId:ids[1]});assert.equal(result.data.ok,true);
        const reloaded=await import('../core/context-bridge.mjs?same-prompt-reload');
        for(const [i,id]of ids.entries()){
            const state=reloaded.readBridgeState(id);
            assert.equal(Boolean(state.deletedAt),i===1);
            assert.equal(Boolean(reloaded.readBridgeState(sources[i]).deletedAt),i===1);
            if(i!==1){
                assert.equal(reloaded.buildUnifiedConversationHistory(id).exchanges[0].assistantReply,`独立回复 ${i}`);
                bridge.appendCustomBridgeExchange(id,{userPrompt:'完全相同的提示词',assistantReply:`继续回复 ${i}`});
            }
        }
    });
    await check('editing a conversation truncates only its selected relay exchanges', async () => {
        const cid = 'truncate-fixture';
        const first = bridge.appendCustomBridgeExchange(cid, { userPrompt: 'One', assistantReply: 'One' });
        bridge.appendCustomBridgeExchange(cid, { userPrompt: 'Two', assistantReply: 'Two' });
        const truncated = await callApi('/bridge/truncate', { conversationId: cid, keepIds: [first.id] });
        assert.equal(truncated.data.exchangeCount, 1);
        assert.deepEqual(bridge.readBridgeState(cid).exchanges.map(exchange => exchange.id), [first.id]);
        const invalid = await callApi('/bridge/truncate', { conversationId: cid, keepIds: null });
        assert.equal(invalid.data.ok, false);
        assert.equal(bridge.readBridgeState(cid).exchanges.length, 1);
    });
    await check('errors after SSE headers are returned as SSE events', async () => {
        const res = await fetch(apiUrl + '/chat/stream', { method: 'POST', body: JSON.stringify({ modelId: store.getSanitizedState().models[0].id, prompt: 'p', conversationId: '../bad', enableTools: false }) });
        const body = await res.text();
        assert.equal(res.status, 200);
        assert.match(body, /event: error/);
        assert.match(body, /无效/);
    });
    await check('disconnect cancels upstream and releases the per-chat request lock', async () => {
        const saved = store.upsertModel(config('headers-hang'));
        const controller = new AbortController();
        const before = requests.length;
        const body = { modelId: saved.id, prompt: 'ping', conversationId: 'cancel-api-session', enableTools: false };
        const first = await fetch(apiUrl + '/chat/stream', { method: 'POST', signal: controller.signal, body: JSON.stringify(body) });
        await until(() => requests.length > before);
        const second = await fetch(apiUrl + '/chat/stream', { method: 'POST', body: JSON.stringify(body) });
        assert.match(await second.text(), /已有请求/);
        controller.abort();
        try { await first.text(); } catch {}
        await delay(100);
        store.upsertModel({ ...saved, modelId: 'gpt-test' });
        const third = await fetch(apiUrl + '/chat/stream', { method: 'POST', body: JSON.stringify(body) });
        assert.match(await third.text(), /event: done/);
        assert.equal(bridge.readBridgeState('cancel-api-session').exchanges.length, 2);
        assert.equal(bridge.readBridgeState('cancel-api-session').exchanges[0].completionStatus, 'incomplete');
    });
    await check('deleting a conversation cancels its upstream request without restoring history', async () => {
        const saved = store.upsertModel(config('headers-hang'));
        const cid = 'cccccccc-1111-2222-3333-aaaaaaaaaaaa';
        const before = closedHangingResponses;
        const first = await fetch(apiUrl + '/chat/stream', { method: 'POST', body: JSON.stringify({ modelId: saved.id, conversationId: cid, prompt: 'fixture', enableTools: false }) });
        await until(() => requests.at(-1)?.body.model === 'headers-hang');
        assert.equal((await callApi('/bridge/delete', { conversationId: cid })).data.ok, true);
        assert.match(await first.text(), /event: error/);
        await until(() => closedHangingResponses > before);
        assert.equal(bridge.buildUnifiedConversationHistory(cid).exchanges.length, 0);
        const again = await fetch(apiUrl + '/chat/stream', { method: 'POST', body: JSON.stringify({ modelId: saved.id, conversationId: cid, prompt: 'late', enableTools: false }) });
        assert.match(await again.text(), /已删除/);
    });
    await check('draft connection tests do not overwrite saved-model test status', async () => {
        const saved = store.upsertModel(config());
        const result = await callApi('/test', { id: saved.id, modelId: 'slow-test' });
        assert.equal(result.data.ok, true);
        assert.equal(store.getModelById(saved.id).lastTestOk, null);
    });
    await check('discovery reports authentication failures directly', async () => {
        const before = requests.length;
        const result = await client.discoverRelayModels({ baseUrl: baseUrl + '/auth', apiKey: 'invalid' });
        assert.equal(result.ok, false);
        assert.match(result.error, /401/);
        assert.equal(requests.length - before, 1);
    });
    await check('standalone sidecar boots and serves the shared API', async () => {
        const script = fileURLToPath(new URL('../plugin/sidecars/panel/main.mjs', import.meta.url));
        const env = { ...process.env, PORT: '0' };
        delete env.ANTIGRAVITY_SIDECAR_WEB_PORT;
        const child = spawn(process.execPath, [script], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        try {
            const url = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Panel did not start')), 5000);
                child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
                child.once('error', reject);
                child.once('exit', code => { if (code) reject(new Error(`Panel exit ${code}`)); });
            });
            assert.equal((await fetch(url + '/api/models?conversationId=startpage-session-b').then(res => res.json())).bridge.conversationId, 'startpage-session-b');
            assert.equal((await fetch(url + '/')).status, 200);
            assert.equal((await fetch(url + '/missing')).status, 404);
        } finally { child.kill(); }
    });
    if(!process.env.AGY_SKIP_SDK_TESTS)await check('installed SDK sidecar starts, honors authentication and binds conversation', async () => {
        const reservation = http.createServer();
        await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
        const port = reservation.address().port;
        await new Promise(resolve => reservation.close(resolve));
        const script = fileURLToPath(new URL('../plugin/sidecars/panel/main.mjs', import.meta.url));
        const env = { ...process.env, NODE_PATH: path.join(os.homedir(), '.gemini', 'config', 'node_modules'),
            ANTIGRAVITY_SIDECAR_WEB_PORT: String(port),
            ANTIGRAVITY_LS_ADDRESS: 'http://127.0.0.1:1', ANTIGRAVITY_CSRF_TOKEN: 'fixture-csrf',
            ANTIGRAVITY_SIDECAR_UI_TOKEN: 'fixture-token', ANTIGRAVITY_CONVERSATION_ID: 'startpage-session-b' };
        const child = spawn(process.execPath, [script], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('SDK sidecar did not start')), 5000);
                child.stdout.on('data', chunk => { if (String(chunk).includes('[sidecar] listening')) { clearTimeout(timer); resolve(); } });
                child.once('error', reject);
                child.stderr.on('data', chunk => { clearTimeout(timer); reject(new Error(String(chunk))); });
            });
            const url = `http://127.0.0.1:${port}`;
            assert.equal((await fetch(url + '/api/models').then(res => res.json())).bridge.conversationId, 'startpage-session-b');
            assert.equal((await fetch(url + '/api/models/select', { method: 'POST', body: '{}' })).status, 401);
            const selected = await fetch(url + '/api/models/select', { method: 'POST', headers: { 'X-Sidecar-Token': 'fixture-token' }, body: JSON.stringify({ mode: 'official' }) });
            assert.equal(selected.status, 200);
            assert.equal((await selected.json()).state.activeMode, 'official');
            assert.equal((await fetch(url + '/preload.js')).status, 200);
            const imported=await fetch(url+'/api/models/import',{method:'POST',headers:{'X-Sidecar-Token':'fixture-token'},body:JSON.stringify({...config(),modelIds:['sdk-bulk-a','sdk-bulk-b']})});
            assert.equal(imported.status,200);const importedData=await imported.json();assert.equal(importedData.models.length,2);
            const provider=await fetch(url+'/api/models/provider',{method:'POST',headers:{'X-Sidecar-Token':'fixture-token'},body:JSON.stringify({id:importedData.models[0].providerId,apiKey:'sdk-fixture-updated-key'})});assert.equal(provider.status,200);
        } finally { child.kill(); }
    });
    console.log(`\n${passed} regression checks passed.`);
} finally {
    api.closeAllConnections();
    mock.closeAllConnections();
    await Promise.all([new Promise(resolve => api.close(resolve)), new Promise(resolve => mock.close(resolve))]);
    if (!path.resolve(temporary).startsWith(path.resolve(scratchRoot) + path.sep)) throw new Error('Unsafe cleanup path');
    fs.rmSync(temporary, { recursive: true, force: true });
}
