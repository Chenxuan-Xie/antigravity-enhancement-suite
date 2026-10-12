#!/usr/bin/env node
/**
 * Antigravity 中转站模型管理与无缝切换 MCP Server (`api-model-switcher-mcp`)
 * --------------------------------------------------------------------------
 * 支持标准 JSON-RPC 2.0 (兼容行分隔 JSON 与 Content-Length 帧格式)
 * 让官方 Agent 与中转站模型在同一对话中双向协同、无缝共享上下文。
 */

import {
    getSanitizedState,
    getModelById,
    getActiveCustomModel,
    upsertModel,
    deleteModel,
    setActiveSelection,
    recordTestResult
} from './model-store.mjs';
import { testModelConnection, chatWithModel } from './model-client.mjs';
import {
    resolveConversationId,
    buildUnifiedConversationHistory,
    appendCustomBridgeExchange,
    consumeUnsyncedCustomTurns
} from './context-bridge.mjs';
import {
    AGENT_TOOLS_SYSTEM_PROMPT,
    parseToolCallsFromText,
    stripToolCallsFromText,
    describeToolCall,
    executeAgentTool
} from './agent-tools.mjs';

const SERVER_INFO = {
    name: 'api-model-switcher-mcp',
    version: '1.0.0'
};

const TOOLS = [
    {
        name: 'list_custom_models',
        description: '查看当前已配置的所有中转站 / 自定义 API 模型列表、当前选中状态（官方模型或自定义模型）以及当前会话无缝桥接状态。',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: '可选会话 ID，默认自动识别当前活跃会话'
                }
            }
        }
    },
    {
        name: 'add_custom_model',
        description: '新增或更新一个中转站自定义模型（支持 OpenAI /v1/chat/completions 与 Anthropic /v1/messages 协议），并在保存后自动执行连接测试。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '显示在聊天模型选择界面中的名称，例如 "Claude 3.7 中转" 或 "DeepSeek V3"' },
                modelId: { type: 'string', description: '接口实际调用的模型 ID，例如 "claude-3-7-sonnet-20250219" 或 "gpt-4o"' },
                baseUrl: { type: 'string', description: '中转站接口地址 Base URL，例如 "https://api.xxx.com/v1"' },
                apiKey: { type: 'string', description: '对应的 API Key (sk-...)' },
                protocol: {
                    type: 'string',
                    enum: ['auto', 'openai', 'anthropic'],
                    description: '协议类型：auto（自动识别）、openai（/v1/chat/completions）、anthropic（/v1/messages）'
                },
                setActive: { type: 'boolean', description: '保存后是否立即设为当前激活模型（默认 true）' }
            },
            required: ['modelId', 'baseUrl', 'apiKey']
        }
    },
    {
        name: 'test_custom_model',
        description: '测试指定自定义模型或草稿配置的 API 连通性、协议兼容性与响应延迟 (ms)。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '已保存模型的 ID（若提供则直接使用已保存的配置测试）' },
                modelId: { type: 'string', description: '可选：直接测试的模型 ID' },
                baseUrl: { type: 'string', description: '可选：直接测试的中转站 Base URL' },
                apiKey: { type: 'string', description: '可选：直接测试的 API Key' },
                protocol: { type: 'string', enum: ['auto', 'openai', 'anthropic'], description: '可选：协议类型' }
            }
        }
    },
    {
        name: 'switch_active_model',
        description: '在当前会话中无缝切换使用“Google 官方模型 (official)”或“自定义中转 API 模型 (custom)”。',
        inputSchema: {
            type: 'object',
            properties: {
                mode: {
                    type: 'string',
                    enum: ['official', 'custom'],
                    description: 'official 表示切回谷歌官方模型；custom 表示切换到自定义中转站模型'
                },
                modelId: {
                    type: 'string',
                    description: '当 mode 为 custom 时，指定要激活的模型配置 ID、显示名称或 modelId'
                },
                conversationId: {
                    type: 'string', description: '切回官方模型时读取桥接上下文的会话 ID'
                }
            },
            required: ['mode']
        }
    },
    {
        name: 'chat_with_custom_model',
        description: '使用当前激活（或指定）的中转站 API 模型在当前对话中继续回答问题。会自动读取并消毒当前官方会话历史（剥离不兼容的签名与内部标签），实现同会话无缝切换。',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: '要发送给中转模型的问题或指令' },
                modelId: { type: 'string', description: '可选：指定使用哪个自定义模型（不填则使用当前选中的自定义模型）' },
                conversationId: { type: 'string', description: '可选：当前会话 ID（默认 auto 自动关联当前会话历史）' },
                includeHistory: { type: 'boolean', description: '是否自动携带消毒后的当前对话历史（默认 true）' }
            },
            required: ['prompt']
        }
    },
    {
        name: 'get_unsynced_bridge_context',
        description: '获取当前对话中尚未同步给官方模型的中转 API 对话记录，实现从自定义 API 模型切回官方模型时的无缝上下文承接。',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: { type: 'string', description: '可选：会话 ID（默认 auto）' },
                markAsSynced: { type: 'boolean', description: '获取后是否标记为已同步（默认 true）' }
            }
        }
    },
    {
        name: 'delete_custom_model',
        description: '删除指定的自定义中转站模型配置。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '要删除的模型 ID' }
            },
            required: ['id']
        }
    }
];

function findModelFlexible(identifier) {
    const state = getSanitizedState();
    if (!identifier) return getActiveCustomModel();
    const direct = getModelById(identifier);
    if (direct) return direct;
    const clean = String(identifier).toLowerCase().trim();
    const matched = state.models.find(
        m => m.id.toLowerCase() === clean ||
            m.name.toLowerCase() === clean ||
            m.modelId.toLowerCase() === clean
    );
    return matched ? getModelById(matched.id) : null;
}

async function handleToolCall(name, args = {}) {
    if (name === 'list_custom_models') {
        const state = getSanitizedState();
        const cid = resolveConversationId(args.conversationId || 'auto');
        const bridge = buildUnifiedConversationHistory(cid, { maxTurns: 6 });
        return {
            ...state,
            bridge: {
                conversationId: bridge.conversationId,
                officialTurnCount: bridge.officialTurnCount,
                customExchangeCount: bridge.customExchangeCount,
                unsyncedCustomCount: bridge.unsyncedCustomCount
            }
        };
    }

    if (name === 'add_custom_model') {
        const saved = upsertModel({
            name: args.name || args.modelId,
            modelId: args.modelId,
            baseUrl: args.baseUrl,
            apiKey: args.apiKey,
            protocol: args.protocol || 'auto',
            autoActivate: args.setActive !== false
        });
        if (args.setActive !== false) {
            setActiveSelection('custom', saved.id);
        }
        const testRes = await testModelConnection(saved);
        recordTestResult(saved.id, testRes);
        return {
            ok: true,
            savedModel: {
                id: saved.id,
                name: saved.name,
                modelId: saved.modelId,
                baseUrl: saved.baseUrl,
                protocol: saved.protocol
            },
            connectionTest: testRes,
            activeState: getSanitizedState()
        };
    }

    if (name === 'test_custom_model') {
        const existing = args.id ? findModelFlexible(args.id) : null;
        const cfg = {
            id: existing?.id || '',
            name: existing?.name || args.modelId || '测试模型',
            modelId: args.modelId || existing?.modelId || '',
            baseUrl: args.baseUrl || existing?.baseUrl || '',
            apiKey: args.apiKey || existing?.apiKey || '',
            protocol: args.protocol || existing?.protocol || 'auto'
        };
        const res = await testModelConnection(cfg);
        if (existing) {
            recordTestResult(existing.id, res);
        }
        return res;
    }

    if (name === 'switch_active_model') {
        if (!['official', 'custom'].includes(args.mode)) return { ok: false, error: '无效的模型切换模式' };
        if (args.mode === 'official') {
            const state = setActiveSelection('official', null);
            const unsynced = consumeUnsyncedCustomTurns(args.conversationId || 'auto', { markAsSynced: false });
            return {
                ok: true,
                message: '已无缝切换回 Google 官方模型',
                activeMode: state.activeMode,
                unsyncedBridgeTurns: unsynced
            };
        }
        const target = findModelFlexible(args.modelId);
        if (!target) {
            return { ok: false, error: `未找到指定的自定义模型: ${args.modelId || '(未指定)'}` };
        }
        const state = setActiveSelection('custom', target.id);
        return {
            ok: true,
            message: `已无缝切换到自定义中转模型: ${target.name} (${target.modelId})`,
            activeMode: state.activeMode,
            activeModel: {
                id: target.id,
                name: target.name,
                modelId: target.modelId,
                baseUrl: target.baseUrl,
                protocol: target.protocol
            }
        };
    }

    if (name === 'chat_with_custom_model') {
        const target = findModelFlexible(args.modelId);
        if (!target) {
            return { ok: false, error: '当前没有已配置的自定义模型，请先添加模型' };
        }
        const cid = resolveConversationId(args.conversationId || 'auto');
        const includeHistory = args.includeHistory !== false;
        let messages = [];
        if (includeHistory) {
            const unified = buildUnifiedConversationHistory(cid, { maxTurns: 20 });
            messages = [...unified.messages];
        }
        messages.push({ role: 'user', content: String(args.prompt || '') });

        const enableTools = args.enableTools !== false;
        const baseSys = (target.systemPrompt || '').trim();
        const effectiveSystemPrompt = enableTools
            ? (baseSys ? `${AGENT_TOOLS_SYSTEM_PROMPT}\n\n${baseSys}` : AGENT_TOOLS_SYSTEM_PROMPT)
            : baseSys;

        const maxRounds = enableTools ? 10 : 1;
        let totalLatencyMs = 0;
        const finalContentParts = [];
        const finalReasoningParts = [];
        const executedToolSteps = [];
        let lastRes = null;

        for (let round = 0; round < maxRounds; round++) {
            const res = await chatWithModel(target, messages, {
                systemPrompt: effectiveSystemPrompt
            });
            lastRes = res;
            if (!res.ok) break;

            totalLatencyMs += (res.latencyMs || 0);
            if (res.reasoning && res.reasoning.trim()) {
                finalReasoningParts.push(res.reasoning.trim());
            }

            const toolCalls = enableTools ? parseToolCallsFromText(res.content || '') : [];
            const cleanText = enableTools ? stripToolCallsFromText(res.content || '') : (res.content || '');
            if (cleanText) {
                finalContentParts.push(cleanText);
            }

            if (toolCalls.length === 0) {
                break;
            }

            messages.push({ role: 'assistant', content: res.content || '' });
            const resultBlocks = [];
            for (let idx = 0; idx < toolCalls.length; idx++) {
                const call = toolCalls[idx];
                const desc = describeToolCall(call.name, call.args);
                const toolRes = await executeAgentTool(call.name, call.args);
                executedToolSteps.push({
                    id: `step-${round + 1}-${idx + 1}`,
                    name: call.name,
                    title: desc.title,
                    detail: desc.detail,
                    ok: toolRes.ok,
                    summary: toolRes.summary
                });
                const toolOutputText = typeof toolRes.output === 'string' && toolRes.output
                    ? toolRes.output
                    : JSON.stringify(toolRes.result ?? toolRes, null, 2);
                resultBlocks.push(
                    `<agy_tool_result name="${call.name}" ok="${Boolean(toolRes.ok)}">\n${toolOutputText}\n</agy_tool_result>`
                );
            }

            messages.push({
                role: 'user',
                content: `${resultBlocks.join('\n\n')}\n\n请根据上述工具真实执行结果继续完成用户的任务。如果还需要调用其他工具，请继续输出 <agy_tool>；如果任务已完成，请直接向用户输出最终回复。`
            });
        }

        const finalReply = finalContentParts.join('\n\n').trim() || (lastRes?.content || '');
        const finalReasoning = finalReasoningParts.join('\n\n').trim();

        if (lastRes && lastRes.ok) {
            recordTestResult(target.id, {
                ok: true,
                latencyMs: totalLatencyMs,
                status: 200,
                replyPreview: finalReply.slice(0, 60)
            });
            appendCustomBridgeExchange(cid, {
                userPrompt: args.prompt,
                assistantReply: finalReply,
                reasoning: finalReasoning,
                toolSteps: executedToolSteps,
                modelId: target.modelId,
                modelName: target.name,
                protocol: lastRes.protocol
            });
        }
        return {
            ok: Boolean(lastRes?.ok),
            modelName: target.name,
            modelId: target.modelId,
            protocol: lastRes?.protocol,
            latencyMs: totalLatencyMs,
            reply: finalReply,
            reasoning: finalReasoning,
            toolSteps: executedToolSteps,
            error: lastRes?.error || null
        };
    }

    if (name === 'get_unsynced_bridge_context') {
        return consumeUnsyncedCustomTurns(args.conversationId || 'auto', {
            markAsSynced: args.markAsSynced !== false
        });
    }

    if (name === 'delete_custom_model') {
        const deleted = deleteModel(args.id);
        return { ok: deleted, state: getSanitizedState() };
    }

    throw new Error(`Unknown tool: ${name}`);
}

let useContentLengthFraming = false;

function sendRpcMessage(obj) {
    const json = JSON.stringify(obj);
    if (useContentLengthFraming) {
        const byteLen = Buffer.byteLength(json, 'utf-8');
        process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
    } else {
        process.stdout.write(`${json}\n`);
    }
}

async function processRpcRequest(msg) {
    if (!msg || typeof msg !== 'object') return;
    const { id, method, params } = msg;

    try {
        if (method === 'initialize') {
            sendRpcMessage({
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: params?.protocolVersion || '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: SERVER_INFO
                }
            });
            return;
        }

        if (method === 'notifications/initialized' || method === 'initialized') {
            return;
        }

        if (method === 'ping') {
            sendRpcMessage({ jsonrpc: '2.0', id, result: {} });
            return;
        }

        if (method === 'tools/list') {
            sendRpcMessage({
                jsonrpc: '2.0',
                id,
                result: { tools: TOOLS }
            });
            return;
        }

        if (method === 'tools/call') {
            const toolName = params?.name;
            const toolArgs = params?.arguments || {};
            const output = await handleToolCall(toolName, toolArgs);
            sendRpcMessage({
                jsonrpc: '2.0',
                id,
                result: {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(output, null, 2)
                        }
                    ],
                    isError: output && output.ok === false
                }
            });
            return;
        }

        if (id !== undefined) {
            sendRpcMessage({
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `Method not found: ${method}` }
            });
        }
    } catch (err) {
        if (id !== undefined) {
            sendRpcMessage({
                jsonrpc: '2.0',
                id,
                error: { code: -32000, message: err?.message || String(err) }
            });
        }
    }
}

// 同时兼容 Content-Length 与行分隔 JSON 的解析器
let rawBuffer = Buffer.alloc(0);

process.stdin.on('data', chunk => {
    rawBuffer = Buffer.concat([rawBuffer, Buffer.from(chunk)]);

    while (rawBuffer.length > 0) {
        const preview = rawBuffer.toString('utf-8', 0, Math.min(rawBuffer.length, 64));
        if (/^Content-Length:/i.test(preview)) {
            useContentLengthFraming = true;
            const headerEnd = rawBuffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) break;
            const headerStr = rawBuffer.toString('utf-8', 0, headerEnd);
            const match = headerStr.match(/Content-Length:\s*(\d+)/i);
            if (!match) {
                rawBuffer = rawBuffer.subarray(headerEnd + 4);
                continue;
            }
            const len = parseInt(match[1], 10);
            const totalNeeded = headerEnd + 4 + len;
            if (rawBuffer.length < totalNeeded) break;
            const bodyStr = rawBuffer.toString('utf-8', headerEnd + 4, totalNeeded);
            rawBuffer = rawBuffer.subarray(totalNeeded);
            try {
                processRpcRequest(JSON.parse(bodyStr));
            } catch {
                // ignore malformed json
            }
        } else {
            const newlineIdx = rawBuffer.indexOf('\n');
            if (newlineIdx === -1) break;
            const line = rawBuffer.toString('utf-8', 0, newlineIdx).trim();
            rawBuffer = rawBuffer.subarray(newlineIdx + 1);
            if (!line) continue;
            try {
                processRpcRequest(JSON.parse(line));
            } catch {
                // ignore malformed line
            }
        }
    }
});
