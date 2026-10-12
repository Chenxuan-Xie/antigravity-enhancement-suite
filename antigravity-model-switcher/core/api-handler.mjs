/**
 * Antigravity 中转站模型管理与无缝对话 HTTP API 路由处理器
 * ---------------------------------------------------------
 * 挂载于本地守护进程 (http://127.0.0.1:19823/api/models/*)
 */

import {
    getSanitizedState,
    getModelById,
    getActiveCustomModel,
    upsertModel,
    deleteModel,
    setActiveSelection,
    setSelectionState,
    setModelReasoningEffort,
    recordTestResult,
    maskApiKey
} from './model-store.mjs';
import { importProviderModels, getProvider, updateProvider } from './model-store.mjs';
import { testModelConnection, chatWithModel, streamChatWithModel, discoverRelayModels } from './model-client.mjs';
import {
    resolveConversationId,
    sanitizeUserContent,
    buildUnifiedConversationHistory,
    appendCustomBridgeExchange,
    updateCustomBridgeExchange,
    consumeUnsyncedCustomTurns,
    clearBridgeState,
    listLocalCustomSessions,
    migrateLocalBridge,
    truncateBridge,
    readBridgeState,
    deleteBridgeConversation
} from './context-bridge.mjs';
import {
    AGENT_TOOLS_SYSTEM_PROMPT,
    findToolCallStart,
    describeToolCall,
    executeAgentTool
} from './agent-tools.mjs';
import { createAgentTurnPolicy, compactAgentMessages, TOOL_RESULT_INSTRUCTION } from './agent-turn-policy.mjs';
import { createUsageAccumulator } from './usage.mjs';
import suiteSettings from '../../suite/settings.cjs';

function createExchangeCheckpoint(cid, fields) {
    let exchange = appendCustomBridgeExchange(cid, { ...fields, completionStatus: 'incomplete' });
    let lastWrite = Date.now(), settled = false;
    let pending = {};
    return {
        get id() { return exchange.id; },
        update(patch, force = false) {
            Object.assign(pending, patch);
            if (force || Date.now() - lastWrite >= 1000) {
                exchange = updateCustomBridgeExchange(cid, exchange.id, pending);
                lastWrite = Date.now();
            }
            return exchange;
        },
        finish(patch) { const saved = this.update({ ...patch, error: '' }, true); settled = true; return saved; },
        interrupt(message) {
            if (settled || readBridgeState(cid).deletedAt) return;
            const steps = pending.toolSteps || exchange.toolSteps || [];
            this.update({ completionStatus: 'incomplete', error: message,
                toolSteps: steps.map(step => step.running ? { ...step, running: false, ok: false, summary: message } : step) }, true);
            settled = true;
        }
    };
}

function summarizeToolResult(name, toolRes = {}) {
    const resObj = toolRes?.result || toolRes || {};
    if (typeof toolRes?.summary === 'string' && toolRes.summary) {
        return toolRes.summary;
    }
    if (typeof resObj?.summary === 'string' && resObj.summary) {
        return resObj.summary;
    }
    if (!resObj || resObj.ok === false) {
        return resObj?.error ? `失败: ${String(resObj.error).slice(0, 80)}` : '执行失败';
    }
    switch (name) {
        case 'read_file':
            return `已读取 ${resObj.shownLines || '全部'} 行 (共 ${resObj.totalLines || 0} 行)`;
        case 'write_file':
            return `已写入 ${resObj.bytesWritten || 0} 字节`;
        case 'replace_in_file':
            return `已替换 ${resObj.replacements || 1} 处内容`;
        case 'list_dir':
            return `读取到 ${(resObj.entries || []).length} 个目录项`;
        case 'search_files':
            return `匹配到 ${(resObj.matches || []).length} 处结果`;
        case 'run_command':
            return `完成 (退出码 ${resObj.exitCode ?? 0})`;
        default:
            return '执行成功';
    }
}

function buildEffectiveSystemPrompt(customPrompt, enableTools = true) {
    const base = (customPrompt || '').trim();
    if (!enableTools) return base;
    return base ? `${AGENT_TOOLS_SYSTEM_PROMPT}\n\n${base}` : AGENT_TOOLS_SYSTEM_PROMPT;
}

/**
 * 计算流式缓冲文本中可安全向前端展示的前缀长度（避免将 <agy_tool name="..."> 标签源码直接吐给前端，同时不误伤正文中的 `<agy_tool>` 讨论）
 */
function getSafeStreamLength(text) {
    const fullTagMatch = findToolCallStart(text);
    if (fullTagMatch && typeof fullTagMatch.index === 'number') {
        return fullTagMatch.index;
    }
    const partialStart = text.lastIndexOf('<');
    if (partialStart >= 0 && text[partialStart - 1] !== '`') {
        const tail = text.slice(partialStart).toLowerCase();
        if (['<agy_tool', '<tool_call', '<function_call', '<tool_use'].some(tag => tag.startsWith(tail))) return partialStart;
    }
    return text.length;
}

function sendJson(res, status, payload) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Allow-Private-Network': 'true',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', chunk => {
            total += chunk.length;
            if (total > 30 * 1024 * 1024) {
                reject(new Error('Payload too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8').trim();
            if (!raw) return resolve({});
            try {
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体必须是 JSON 对象');
                resolve(parsed);
            } catch (e) {
                reject(new Error(`Invalid JSON body: ${e.message}`));
            }
        });
        req.on('error', reject);
    });
}

const activeConversationRequests = new Set();
const conversationControllers = new Map();
export function getActiveModelRequestCount(){return activeConversationRequests.size;}

export async function handleModelApiRequest(req, res, pathname, searchParams = new URL(req.url || '/', 'http://127.0.0.1').searchParams) {
    if (!pathname.startsWith('/api/models')) {
        return false;
    }

    const origin = req.headers?.origin;
    if (origin) {
        let allowed = false;
        try {
            const url = new URL(origin);
            allowed = ['http:', 'https:'].includes(url.protocol) &&
                ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
        } catch {}
        if (!allowed) {
            sendJson(res, 403, { ok: false, error: '仅允许本机 Antigravity 界面访问中转 API' });
            return true;
        }
    }

    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return true;
    }

    if(!suiteSettings.readSettings().api){sendJson(res,403,{ok:false,error:'API 中转功能已关闭'});return true;}

    const controller = new AbortController();
    const onDisconnect = () => { if (!res.writableEnded) controller.abort(new Error('客户端已断开连接')); };
    req.once('aborted', onDisconnect);
    res.once('close', onDisconnect);
    let lockedConversationId = null;
    let requestCheckpoint = null;
    let streamHeartbeat = null;
    const lockConversation = cid => {
        if (readBridgeState(cid).deletedAt) throw new Error('会话已删除');
        if (activeConversationRequests.has(cid)) throw new Error('当前会话已有请求进行中，请等待完成或停止后重试');
        activeConversationRequests.add(cid);
        conversationControllers.set(cid, controller);
        lockedConversationId = cid;
    };
    try {
        if (pathname === '/api/models/bridge/info' && req.method === 'GET') {
            const value = readBridgeState(searchParams.get('conversationId'));
            sendJson(res, 200, { ok: true, conversationId: value.conversationId, migratedTo: value.migratedTo || null, deletedAt: value.deletedAt || 0 });
            return true;
        }
        if (pathname === '/api/models/bridge/delete' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const deleted = deleteBridgeConversation(body.conversationId);
            conversationControllers.get(deleted.conversationId)?.abort(new Error('会话已删除'));
            sendJson(res, 200, { ok: true, ...deleted });
            return true;
        }
        if (pathname === '/api/models/reasoning' && req.method === 'POST') {
            const body = await readJsonBody(req);
            sendJson(res, 200, { ok: true, state: setModelReasoningEffort(body.modelId, body.effort, body.activate === true) });
            return true;
        }
        if (pathname === '/api/models/bridge/truncate' && req.method === 'POST') {
            const body = await readJsonBody(req);
            sendJson(res, 200, { ok: true, ...truncateBridge(body.conversationId, body.keepIds) });
            return true;
        }
        if (pathname === '/api/models/bridge/migrate' && req.method === 'POST') {
            const body = await readJsonBody(req);
            sendJson(res, 200, { ok: true, ...migrateLocalBridge(body.sourceId, body.conversationId) });
            return true;
        }
        // 1. 获取模型列表、当前激活状态及当前会话桥接摘要
        if (pathname === '/api/models' && req.method === 'GET') {
            const cid = resolveConversationId(searchParams.get('conversationId') || 'auto');
            const historyInfo = buildUnifiedConversationHistory(cid, { maxTurns: 6 });
            sendJson(res, 200, {
                ok: true,
                showUsage:suiteSettings.readSettings().showUsage,
                ...getSanitizedState(),
                localSessions: listLocalCustomSessions(),
                bridge: {
                    conversationId: historyInfo.conversationId,
                    deletedAt: historyInfo.deletedAt || 0,
                    officialTurnCount: historyInfo.officialTurnCount,
                    customExchangeCount: historyInfo.customExchangeCount,
                    unsyncedCustomCount: historyInfo.unsyncedCustomCount,
                    exchanges: historyInfo.exchanges || []
                }
            });
            return true;
        }

        if(pathname==='/api/models/import'&&req.method==='POST') {
            sendJson(res,200,{ok:true,...importProviderModels(await readJsonBody(req))});return true;
        }
        if(pathname==='/api/models/provider'&&req.method==='POST') {
            sendJson(res,200,{ok:true,state:updateProvider(await readJsonBody(req))});return true;
        }
        // 2. 新增或更新自定义模型
        if ((pathname === '/api/models' || pathname === '/api/models/save') && req.method === 'POST') {
            const body = await readJsonBody(req);
            const saved = upsertModel(body);
            if (body.autoActivate !== false) {
                setActiveSelection('custom', saved.id);
            }
            sendJson(res, 200, {
                ok: true,
                model: {
                    ...saved,
                    apiKey: undefined,
                    apiKeyMasked: maskApiKey(saved.apiKey),
                    hasApiKey: Boolean(saved.apiKey)
                },
                state: getSanitizedState()
            });
            return true;
        }

        // 3. 删除自定义模型
        if ((pathname === '/api/models/delete' && req.method === 'POST') || (pathname === '/api/models' && req.method === 'DELETE')) {
            const body = await readJsonBody(req);
            const targetId = body.id || searchParams.get('id');
            if (!targetId) {
                sendJson(res, 400, { ok: false, error: '缺少模型 ID' });
                return true;
            }
            const deleted = deleteModel(targetId);
            sendJson(res, 200, {
                ok: true,
                deleted,
                state: getSanitizedState()
            });
            return true;
        }

        // 4. 切换当前对话使用的模型（支持 Official 官方模型 <-> Custom 中转模型）
        if (pathname === '/api/models/select' && req.method === 'POST') {
            const body = await readJsonBody(req);
            setSelectionState({ activeMode: body.mode, activeModelId: body.modelId,
                chatRelayMode: body.chatRelayMode });
            sendJson(res, 200, {
                ok: true,
                state: getSanitizedState()
            });
            return true;
        }

        // 5. 测试连接 (Test Connection) —— 支持测试已保存模型或正在填写的草稿配置
        if (pathname === '/api/models/test' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const existing = body.id ? getModelById(body.id) : getProvider(body.providerId);

            let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
            if ((!apiKey || apiKey.includes('****') || apiKey.includes('••••')) && existing) {
                apiKey = existing.apiKey;
            }

            const configToTest = {
                id: body.id || existing?.id || '',
                name: body.name || existing?.name || body.modelId || '测试模型',
                modelId: (body.modelId || existing?.modelId || '').trim(),
                baseUrl: (body.baseUrl || existing?.baseUrl || '').trim(),
                apiKey,
                protocol: body.protocol || existing?.protocol || 'auto',
                extraHeaders: body.extraHeaders || existing?.extraHeaders || {}
            };

            const result = await testModelConnection(configToTest);
            if (existing) {
                recordTestResult(existing.id, result, configToTest);
            }

            sendJson(res, 200, {
                ok: result.ok,
                result,
                state: getSanitizedState()
            });
            return true;
        }

        // 5b. 自动从中转站 /v1/models 探测可用模型列表
        if (pathname === '/api/models/discover' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const existing = body.id ? getModelById(body.id) : getProvider(body.providerId);
            let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
            if ((!apiKey || apiKey.includes('****') || apiKey.includes('••••')) && existing) {
                apiKey = existing.apiKey;
            }
            const baseUrl = (body.baseUrl || existing?.baseUrl || '').trim();
            const found = await discoverRelayModels({ baseUrl, apiKey });
            sendJson(res, 200, found);
            return true;
        }

        // 6. 执行中转模型无缝对话（自动合并并消毒当前会话上下文，支持多模态截图与本地 Agent 工具调用）
        if (pathname === '/api/models/chat' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const rawImages = Array.isArray(body.images) ? body.images : [];
            const prompt = sanitizeUserContent(body.prompt || '') || (rawImages.length > 0 ? '请查看附图并回答。' : '');
            if (!prompt && rawImages.length === 0) {
                sendJson(res, 400, { ok: false, error: '提问内容不能为空' });
                return true;
            }

            const targetModel = body.modelId
                ? getModelById(body.modelId)
                : getActiveCustomModel();

            if (!targetModel) {
                sendJson(res, 404, {
                    ok: false,
                    error: '未找到可用的自定义中转模型，请先添加并选择一个模型'
                });
                return true;
            }

            const cid = resolveConversationId(body.conversationId || 'auto');
            lockConversation(cid);
            const includeHistory = body.includeHistory !== false;

            let messages = [];
            let historyMeta = { officialTurnCount: 0, customExchangeCount: 0 };

            if (includeHistory) {
                const unified = buildUnifiedConversationHistory(cid, {
                    maxTurns: body.maxTurns || 20,
                    includeImages: true
                });
                messages = [...unified.messages];
                historyMeta = {
                    officialTurnCount: unified.officialTurnCount,
                    customExchangeCount: unified.customExchangeCount
                };
            }

            messages.push({
                role: 'user',
                content: prompt,
                images: rawImages
            });

            const enableTools = body.enableTools !== false;
            const effectiveSystemPrompt = buildEffectiveSystemPrompt(
                body.systemPrompt ?? targetModel.systemPrompt ?? '',
                enableTools
            );

            const maxToolRounds = enableTools ? Infinity : 1;
            const turnPolicy = createAgentTurnPolicy(enableTools);
            let totalLatencyMs = 0;
            const usageStats = createUsageAccumulator();
            const finalContentParts = [];
            const finalReasoningParts = [];
            const executedToolSteps = [];
            let lastChatRes = null;
            const checkpoint = requestCheckpoint = createExchangeCheckpoint(cid, {
                userPrompt: prompt, images: rawImages, modelId: targetModel.modelId, modelName: targetModel.name, protocol: targetModel.protocol
            });

            for (let round = 0; round < maxToolRounds; round++) {
                controller.signal.throwIfAborted();
                compactAgentMessages(messages, prompt);
                const chatRes = await chatWithModel(targetModel, messages, {
                    systemPrompt: effectiveSystemPrompt,
                    maxTokens: body.maxTokens || targetModel.maxTokens || 4096,
                    temperature: body.temperature,
                    reasoningEffort: body.reasoningEffort,
                    includeUsage: suiteSettings.readSettings().showUsage,
                    timeoutMs: body.timeoutMs || 120000,
                    signal: controller.signal
                });
                controller.signal.throwIfAborted();
                lastChatRes = chatRes;
                checkpoint.update({usage:usageStats.add(chatRes.usage)},true);
                if (!chatRes.ok) break;

                totalLatencyMs += (chatRes.latencyMs || 0);
                if (chatRes.reasoning && chatRes.reasoning.trim()) {
                    finalReasoningParts.push(chatRes.reasoning.trim());
                }

                const turn = turnPolicy.next(chatRes);
                const toolCalls = turn.calls;
                const cleanText = turn.cleanText;
                if (cleanText) {
                    finalContentParts.push(cleanText);
                }
                checkpoint.update({ assistantReply: finalContentParts.join('\n\n'), reasoning: finalReasoningParts.join('\n\n'), toolSteps: executedToolSteps }, true);

                if (turn.stop) break;
                if (toolCalls.length === 0) {
                    messages.push({ role: 'assistant', content: chatRes.content || '[本轮仅返回思考，没有答复或工具]' });
                    messages.push({ role: 'user', content: turn.reason });
                    continue;
                }

                messages.push({
                    role: 'assistant',
                    content: chatRes.content || ''
                });

                const resultBlocks = [];
                for (let idx = 0; idx < toolCalls.length; idx++) {
                    const call = toolCalls[idx];
                    const stepId = `step-${round + 1}-${idx + 1}`;
                    const desc = describeToolCall(call.name, call.args);
                    controller.signal.throwIfAborted();
                    const toolRes = await executeAgentTool(call.name, call.args, { signal: controller.signal });
                    controller.signal.throwIfAborted();
                    const summary = summarizeToolResult(call.name, toolRes);
                    executedToolSteps.push({
                        id: stepId,
                        name: call.name,
                        title: desc.title,
                        detail: desc.detail,
                        args: call.args,
                        output: typeof toolRes.output === 'string' ? toolRes.output : JSON.stringify(toolRes.result ?? toolRes, null, 2),
                        ok: toolRes.ok,
                        summary
                    });
                    checkpoint.update({ toolSteps: executedToolSteps }, true);
                    const toolOutputText = typeof toolRes.output === 'string' && toolRes.output
                        ? toolRes.output
                        : JSON.stringify(toolRes.result ?? toolRes, null, 2);
                    resultBlocks.push(
                        `<agy_tool_result name="${call.name}" ok="${Boolean(toolRes.ok)}">\n${toolOutputText}\n</agy_tool_result>`
                    );
                }

                messages.push({
                    role: 'user',
                    content: `${resultBlocks.join('\n\n')}\n\n${TOOL_RESULT_INSTRUCTION}`
                });
            }

            if (!lastChatRes || !lastChatRes.ok) {
                checkpoint.interrupt(lastChatRes?.error || '请求失败');
                recordTestResult(targetModel.id, {
                    ok: false,
                    latencyMs: lastChatRes?.latencyMs || 0,
                    status: lastChatRes?.status || 0,
                    error: lastChatRes?.error || '请求失败'
                });
                sendJson(res, 200, {
                    ok: false,
                    error: lastChatRes?.error || '请求失败',
                    latencyMs: lastChatRes?.latencyMs || 0,
                    protocol: lastChatRes?.protocol,
                    endpointUrl: lastChatRes?.endpointUrl,
                    model: {
                        id: targetModel.id,
                        name: targetModel.name,
                        modelId: targetModel.modelId
                    }
                });
                return true;
            }

            if (turnPolicy.notice) finalContentParts.push(turnPolicy.notice);
            const finalReply = finalContentParts.join('\n\n').trim();
            const finalReasoning = finalReasoningParts.join('\n\n').trim();

            recordTestResult(targetModel.id, {
                ok: true,
                latencyMs: totalLatencyMs,
                status: lastChatRes.status || 200,
                replyPreview: finalReply.slice(0, 60)
            });

            const savedExchange = checkpoint.finish({
                userPrompt: prompt,
                assistantReply: finalReply,
                reasoning: finalReasoning,
                toolSteps: executedToolSteps,
                completionStatus: turnPolicy.completionStatus,
                latencyMs: totalLatencyMs,
                modelId: targetModel.modelId,
                modelName: targetModel.name,
                protocol: lastChatRes.protocol,
                images: rawImages,
                usage: usageStats.value()
            });

            sendJson(res, 200, {
                ok: true,
                completionStatus: turnPolicy.completionStatus,
                conversationId: cid,
                reply: finalReply,
                reasoning: finalReasoning,
                toolSteps: executedToolSteps,
                latencyMs: totalLatencyMs,
                protocol: lastChatRes.protocol,
                endpointUrl: lastChatRes.endpointUrl,
                usage: usageStats.value(),
                exchangeId: savedExchange.id,
                exchange: savedExchange,
                contextStats: historyMeta,
                model: {
                    id: targetModel.id,
                    name: targetModel.name,
                    modelId: targetModel.modelId,
                    baseUrl: targetModel.baseUrl
                }
            });
            return true;
        }

        // 6b. 实时 SSE 流式中转对话接口（实时推送模型状态、思考过程、Agent 工具调用卡片、正文增量与多模态截图解析）
        if (pathname === '/api/models/chat/stream' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const rawImages = Array.isArray(body.images) ? body.images : [];
            const prompt = sanitizeUserContent(body.prompt || '') || (rawImages.length > 0 ? '请查看附图并回答。' : '');

            res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
                'Access-Control-Allow-Private-Network': 'true'
            });
            const activity = { phase: 'context', round: 0, providerSeen: false,
                providerAt: Date.now(), contentAt: Date.now(), timeoutMs: Math.max(1, Number(body.timeoutMs) || 120000) };
            const sendSse = (event, data) => {
                try {
                    if (res.destroyed || res.writableEnded) return;
                    if (event === 'status' && data.phase) activity.phase = data.phase;
                    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
                } catch {
                    // ignore write after close
                }
            };
            let lastActivitySent = 0;
            const sendActivity = (force = false) => {
                const now = Date.now();
                if (!force && now - lastActivitySent < 1000) return;
                lastActivitySent = now;
                sendSse('activity', { phase: activity.phase, round: activity.round, providerSeen: activity.providerSeen,
                    providerIdleMs: now - activity.providerAt, contentIdleMs: now - activity.contentAt, timeoutMs: activity.timeoutMs });
            };
            // Transport keepalive is separate from provider activity and actual
            // model content. A heartbeat must never be presented as thinking.
            streamHeartbeat = setInterval(() => sendActivity(true), 5000);
            streamHeartbeat.unref?.();

            if (!prompt && rawImages.length === 0) {
                sendSse('error', { ok: false, error: '提问内容不能为空' });
                res.end();
                return true;
            }

            const targetModel = body.modelId
                ? getModelById(body.modelId)
                : getActiveCustomModel();

            if (!targetModel) {
                sendSse('error', { ok: false, error: '未找到可用的自定义中转模型，请先添加并选择一个模型' });
                res.end();
                return true;
            }

            const cid = resolveConversationId(body.conversationId || 'auto');
            lockConversation(cid);
            const includeHistory = body.includeHistory !== false;

            let messages = [];
            let historyMeta = { officialTurnCount: 0, customExchangeCount: 0 };

            sendSse('status', {
                phase: 'context',
                message: rawImages.length > 0
                    ? `正在读取会话上下文并编码 ${rawImages.length} 张高清原图...`
                    : '正在读取并合并当前会话上下文...'
            });

            if (includeHistory) {
                const unified = buildUnifiedConversationHistory(cid, {
                    maxTurns: body.maxTurns || 20,
                    includeImages: true
                });
                messages = [...unified.messages];
                historyMeta = {
                    officialTurnCount: unified.officialTurnCount,
                    customExchangeCount: unified.customExchangeCount
                };
            }

            messages.push({
                role: 'user',
                content: prompt,
                images: rawImages
            });

            const enableTools = body.enableTools !== false;
            const effectiveSystemPrompt = buildEffectiveSystemPrompt(
                body.systemPrompt ?? targetModel.systemPrompt ?? '',
                enableTools
            );

            const maxToolRounds = enableTools ? Infinity : 1;
            const turnPolicy = createAgentTurnPolicy(enableTools);
            let totalLatencyMs = 0;
            const usageStats = createUsageAccumulator();
            const finalContentParts = [];
            const finalReasoningParts = [];
            const executedToolSteps = [];
            let lastChatRes = null;
            const checkpoint = requestCheckpoint = createExchangeCheckpoint(cid, {
                userPrompt: prompt, images: rawImages, modelId: targetModel.modelId, modelName: targetModel.name, protocol: targetModel.protocol
            });
            sendSse('checkpoint', { exchangeId: checkpoint.id });

            for (let round = 0; round < maxToolRounds; round++) {
                controller.signal.throwIfAborted();
                compactAgentMessages(messages, prompt);
                let roundRawText = '';
                let roundEmittedLen = 0;
                let roundSawThinking = false;
                let roundSawText = false;
                let roundThinking = '';
                activity.round = round + 1;
                activity.providerAt = Date.now();
                activity.providerSeen = false;

                const chatRes = await streamChatWithModel(
                    targetModel,
                    messages,
                    {
                        systemPrompt: effectiveSystemPrompt,
                        maxTokens: body.maxTokens || targetModel.maxTokens || 4096,
                        temperature: body.temperature,
                        reasoningEffort: body.reasoningEffort,
                        includeUsage: suiteSettings.readSettings().showUsage,
                        timeoutMs: body.timeoutMs || 120000,
                    signal: controller.signal
                    },
                    {
                        onStatus: (st) => {
                            sendSse('status', st);
                        },
                        onActivity: () => {
                            activity.providerSeen = true;
                            activity.providerAt = Date.now();
                            sendActivity();
                        },
                        onThinkingDelta: (delta) => {
                            activity.phase = 'thinking';
                            activity.contentAt = Date.now();
                            roundThinking += delta;
                            checkpoint.update({ reasoning: [...finalReasoningParts, roundThinking].join('\n\n') });
                            if (!roundSawThinking) {
                                roundSawThinking = true;
                                sendSse('status', {
                                    phase: 'thinking',
                                    message: `${targetModel.name || targetModel.modelId} 正在深度思考...`
                                });
                                if (finalReasoningParts.length > 0) {
                                    sendSse('thinking_delta', { delta: '\n\n' });
                                }
                            }
                            sendSse('thinking_delta', { delta });
                        },
                        onTextDelta: (delta) => {
                            activity.phase = roundSawText ? 'streaming' : 'receiving';
                            activity.contentAt = Date.now();
                            roundRawText += delta;
                            checkpoint.update({ assistantReply: [...finalContentParts, roundRawText.slice(0, enableTools ? getSafeStreamLength(roundRawText) : roundRawText.length)].filter(Boolean).join('\n\n') });
                            const safeLen = enableTools
                                ? getSafeStreamLength(roundRawText)
                                : roundRawText.length;

                            if (safeLen > roundEmittedLen) {
                                const chunk = roundRawText.slice(roundEmittedLen, safeLen);
                                roundEmittedLen = safeLen;
                                if (!roundSawText) {
                                    roundSawText = true;
                                    sendSse('status', {
                                        phase: 'streaming',
                                        message: `${targetModel.name || targetModel.modelId} 正在实时输出回复...`
                                    });
                                    if (finalContentParts.length > 0) {
                                        sendSse('text_delta', { delta: '\n\n' });
                                    }
                                }
                                sendSse('text_delta', { delta: chunk });
                            }
                        }
                    }
                );

                controller.signal.throwIfAborted();
                lastChatRes = chatRes;
                checkpoint.update({usage:usageStats.add(chatRes.usage)},true);
                if (!chatRes.ok) {
                    break;
                }

                totalLatencyMs += (chatRes.latencyMs || 0);
                if (chatRes.reasoning && chatRes.reasoning.trim()) {
                    finalReasoningParts.push(chatRes.reasoning.trim());
                }

                const fullRoundContent = chatRes.content || roundRawText || '';
                const turn = turnPolicy.next({ ...chatRes, content: fullRoundContent });
                const toolCalls = turn.calls;
                const cleanRoundText = turn.cleanText;

                // 如果本轮没有任何工具调用，把缓冲末尾尚未吐出的普通字符补齐发送
                if (turn.kind === 'final' && roundRawText.length > roundEmittedLen) {
                    const tail = roundRawText.slice(roundEmittedLen);
                    if (tail) {
                        if (!roundSawText && finalContentParts.length > 0) {
                            sendSse('text_delta', { delta: '\n\n' });
                        }
                        sendSse('text_delta', { delta: tail });
                    }
                }

                if (cleanRoundText) {
                    finalContentParts.push(cleanRoundText);
                }
                checkpoint.update({ assistantReply: finalContentParts.join('\n\n'), reasoning: finalReasoningParts.join('\n\n'), toolSteps: executedToolSteps }, true);

                if (turn.stop) break;
                if (toolCalls.length === 0) {
                    messages.push({ role: 'assistant', content: fullRoundContent || '[本轮仅返回思考，没有答复或工具]' });
                    messages.push({ role: 'user', content: turn.reason });
                    sendSse('status', { phase: 'connecting', message: turn.kind === 'repair' ? '正在自动修正工具调用并继续任务…' : '正在继续完成检查…' });
                    continue;
                }

                // 将本轮包含 <agy_tool> 的原始模型输出推入上下文
                messages.push({
                    role: 'assistant',
                    content: fullRoundContent
                });

                const resultBlocks = [];
                for (let idx = 0; idx < toolCalls.length; idx++) {
                    const call = toolCalls[idx];
                    const stepId = `step-${round + 1}-${idx + 1}`;
                    const desc = describeToolCall(call.name, call.args);

                    sendSse('status', {
                        phase: 'tool',
                        message: `正在执行本地工具: ${desc.title} ${desc.detail ? `(${desc.detail})` : ''}...`
                    });

                    sendSse('tool_start', {
                        id: stepId,
                        name: call.name,
                        title: desc.title,
                        detail: desc.detail,
                        args: call.args
                    });
                    checkpoint.update({ toolSteps: [...executedToolSteps, { id: stepId, name: call.name, title: desc.title, detail: desc.detail, args: call.args, running: true }] }, true);

                    controller.signal.throwIfAborted();
                    const toolRes = await executeAgentTool(call.name, call.args, { signal: controller.signal });
                    controller.signal.throwIfAborted();
                    const summary = summarizeToolResult(call.name, toolRes);

                    const stepRecord = {
                        id: stepId,
                        name: call.name,
                        title: desc.title,
                        detail: desc.detail,
                        args: call.args,
                        output: typeof toolRes.output === 'string' ? toolRes.output : JSON.stringify(toolRes.result ?? toolRes, null, 2),
                        ok: toolRes.ok,
                        summary
                    };
                    executedToolSteps.push(stepRecord);
                    checkpoint.update({ toolSteps: executedToolSteps }, true);

                    sendSse('tool_end', stepRecord);

                    const toolOutputText = typeof toolRes.output === 'string' && toolRes.output
                        ? toolRes.output
                        : JSON.stringify(toolRes.result ?? toolRes, null, 2);
                    resultBlocks.push(
                        `<agy_tool_result name="${call.name}" ok="${Boolean(toolRes.ok)}">\n${toolOutputText}\n</agy_tool_result>`
                    );
                }

                messages.push({
                    role: 'user',
                    content: `${resultBlocks.join('\n\n')}\n\n${TOOL_RESULT_INSTRUCTION}`
                });

                sendSse('status', {
                    phase: 'connecting',
                    message: `工具执行完成，${targetModel.name || targetModel.modelId} 正在整理结果...`
                });
            }

            if (!lastChatRes || !lastChatRes.ok) {
                checkpoint.interrupt(lastChatRes?.error || '请求失败');
                recordTestResult(targetModel.id, {
                    ok: false,
                    latencyMs: lastChatRes?.latencyMs || 0,
                    status: lastChatRes?.status || 0,
                    error: lastChatRes?.error || '请求失败'
                });
                sendSse('error', {
                    ok: false,
                    error: lastChatRes?.error || '请求失败',
                    latencyMs: lastChatRes?.latencyMs || 0,
                    protocol: lastChatRes?.protocol
                });
                res.end();
                return true;
            }

            if (turnPolicy.notice) {
                finalContentParts.push(turnPolicy.notice);
                sendSse('text_delta', { delta: `\n\n${turnPolicy.notice}` });
            }
            const finalReply = finalContentParts.join('\n\n').trim();
            const finalReasoning = finalReasoningParts.join('\n\n').trim();

            recordTestResult(targetModel.id, {
                ok: true,
                latencyMs: totalLatencyMs,
                status: lastChatRes.status || 200,
                replyPreview: finalReply.slice(0, 60)
            });

            const savedExchange = checkpoint.finish({
                userPrompt: prompt,
                assistantReply: finalReply,
                reasoning: finalReasoning,
                toolSteps: executedToolSteps,
                completionStatus: turnPolicy.completionStatus,
                latencyMs: totalLatencyMs,
                modelId: targetModel.modelId,
                modelName: targetModel.name,
                protocol: lastChatRes.protocol,
                images: rawImages,
                usage: usageStats.value()
            });

            sendSse('done', {
                ok: true,
                completionStatus: turnPolicy.completionStatus,
                conversationId: cid,
                reply: finalReply,
                reasoning: finalReasoning,
                toolSteps: executedToolSteps,
                latencyMs: totalLatencyMs,
                protocol: lastChatRes.protocol,
                endpointUrl: lastChatRes.endpointUrl,
                exchangeId: savedExchange.id,
                exchange: savedExchange,
                usage: usageStats.value(),
                contextStats: historyMeta,
                model: {
                    id: targetModel.id,
                    name: targetModel.name,
                    modelId: targetModel.modelId
                }
            });
            res.end();
            return true;
        }

        // 7. 获取会话桥接详情
        if (pathname === '/api/models/bridge' && req.method === 'GET') {
            const cid = resolveConversationId(searchParams.get('conversationId') || 'auto');
            const unified = buildUnifiedConversationHistory(cid, { maxTurns: 24 });
            sendJson(res, 200, {
                ok: true,
                ...unified
            });
            return true;
        }

        // 8. 消费未同步给官方模型的中转轮次（当从 Custom 切回 Official 发送消息时调用）
        if (pathname === '/api/models/bridge/consume' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const cid = resolveConversationId(body.conversationId || 'auto');
            const consumed = consumeUnsyncedCustomTurns(cid, {
                markAsSynced: body.markAsSynced !== false
            });
            sendJson(res, 200, {
                ok: true,
                ...consumed
            });
            return true;
        }

        // 9. 清空指定会话的中转桥接记录
        if (pathname === '/api/models/bridge/clear' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const cid = resolveConversationId(body.conversationId || 'auto');
            const cleared = clearBridgeState(cid);
            sendJson(res, 200, cleared);
            return true;
        }

        sendJson(res, 404, { ok: false, error: `Unknown model API endpoint: ${pathname}` });
        return true;
    } catch (err) {
        if (res.headersSent) {
            if (!res.destroyed && !res.writableEnded) {
                res.end(`event: error\ndata: ${JSON.stringify({ ok: false, error: err?.message || String(err) })}\n\n`);
            }
            return true;
        }
        sendJson(res, 400, {
            ok: false,
            error: err?.message || String(err)
        });
        return true;
    } finally {
        clearInterval(streamHeartbeat);
        try { requestCheckpoint?.interrupt(controller.signal.reason?.message || '本轮执行中断，已保留生成结果'); } catch (error) { console.error('[ModelBridge] 保存中断记录失败:', error.message); }
        req.removeListener('aborted', onDisconnect);
        res.removeListener('close', onDisconnect);
        if (lockedConversationId) {
            activeConversationRequests.delete(lockedConversationId);
            conversationControllers.delete(lockedConversationId);
        }
    }
}
