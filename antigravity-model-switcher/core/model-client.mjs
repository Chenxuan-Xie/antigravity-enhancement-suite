/**
 * Antigravity 中转站 / 自定义 API 模型通信引擎 (Model Client)
 * ---------------------------------------------------------
 * 同时支持：
 * 1. OpenAI 兼容协议 (/v1/chat/completions) —— 适用于 OneAPI / NewAPI / OpenRouter / DeepSeek / 硅基流动 / 各类 OpenAI 中转站
 * 2. Anthropic 原生协议 (/v1/messages) —— 适用于 Claude Code (cc-switch) 专用中转站 / Anthropic 官方与代理
 * 3. Auto 智能探测与自动回退 —— 当用户不确定中转站协议时，自动尝试并在遇到协议不匹配时无缝回退另一协议
 * 4. 强制流式 (Forced-SSE) 自动聚合 —— 兼容部分无视 stream:false 强制返回 text/event-stream 的中转站
 */

import { execSync } from 'node:child_process';
import { applyReasoningConfig } from './reasoning-config.mjs';

let UndiciProxyAgent = null;
try {
    const undici = await import('undici');
    UndiciProxyAgent = undici.ProxyAgent;
} catch {
    // 若环境中无 undici，则使用原生直连 fetch
}

let cachedProxyUrl = undefined;
let cachedProxyAt = 0;
const proxyAgents = new Map();

/**
 * 自动检测系统代理（带 30 秒缓存），localhost / 127.0.0.1 永不走代理
 */
export function detectSystemProxy(targetUrl = '') {
    try {
        const u = new URL(targetUrl);
        if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]' || u.hostname.startsWith('192.168.')) {
            return null;
        }
    } catch {
        // ignore URL parse error
    }

    const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY;
    if (envProxy) return envProxy;

    const now = Date.now();
    if (cachedProxyUrl !== undefined && now - cachedProxyAt < 30000) {
        return cachedProxyUrl;
    }

    cachedProxyAt = now;
    if (process.platform !== 'win32') {
        cachedProxyUrl = null;
        return null;
    }

    try {
        const out = execSync(
            'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable & reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
            { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, windowsHide: true }
        );
        const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(out);
        if (!enabled) {
            cachedProxyUrl = null;
            return null;
        }
        const match = out.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i);
        if (match && match[1]) {
            let server = match[1].trim();
            if (server.includes('=')) {
                const parts = Object.fromEntries(
                    server.split(';').map(s => s.split('=')).filter(p => p.length === 2)
                );
                server = parts.https || parts.http || server;
            }
            if (!/^https?:\/\//i.test(server)) {
                server = `http://${server}`;
            }
            cachedProxyUrl = server;
            return cachedProxyUrl;
        }
    } catch {
        // ignore registry query error
    }
    cachedProxyUrl = null;
    return null;
}

/**
 * 支持代理优先 + 直连回退的 HTTP 请求封装
 */
async function fetchWithFallback(url, options = {}, timeoutMs = 45000, onActivity) {
    const proxyUrl = detectSystemProxy(url);
    const attemptFetch = async (useProxy) => {
        const controller = new AbortController();
        let timer;
        const armTimer = () => {
            clearTimeout(timer);
            timer = setTimeout(() => controller.abort(new Error(`请求无响应超时 (${Math.round(timeoutMs / 1000)}s)`)), timeoutMs);
        };
        armTimer();
        const cleanup = () => clearTimeout(timer);
        try {
            const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
            signal.throwIfAborted();
            const fetchOpts = { ...options, signal };
            if (useProxy && proxyUrl && UndiciProxyAgent) {
                if (!proxyAgents.has(proxyUrl)) proxyAgents.set(proxyUrl, new UndiciProxyAgent(proxyUrl));
                fetchOpts.dispatcher = proxyAgents.get(proxyUrl);
            }
            const response = await fetch(url, fetchOpts);
            if (onActivity) { armTimer(); onActivity(); }
            if (!response.body) { cleanup(); return response; }
            // Keep the deadline active while the response body is read, including SSE.
            const reader = response.body.getReader();
            const body = new ReadableStream({
                async pull(stream) {
                    try {
                        const { done, value } = await reader.read();
                        if (done) { cleanup(); reader.releaseLock(); stream.close(); }
                        else { if (onActivity) { armTimer(); onActivity(); } stream.enqueue(value); }
                    } catch (err) { cleanup(); stream.error(err); }
                },
                async cancel(reason) { cleanup(); await reader.cancel(reason); }
            });
            return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (err) {
            cleanup();
            throw err;
        }
    };

    try {
        return await attemptFetch(false);
    } catch (directErr) {
        if (options.signal?.aborted) throw options.signal.reason;
        if (proxyUrl && UndiciProxyAgent) {
            try {
                return await attemptFetch(true);
            } catch {
                throw directErr;
            }
        }
        throw directErr;
    }
}

/**
 * 根据模型配置推断首选协议 ('openai' | 'anthropic')
 */
export function inferPrimaryProtocol(modelConfig = {}) {
    const rawProto = String(modelConfig.protocol || 'auto').toLowerCase().trim();
    if (rawProto === 'openai' || rawProto === 'anthropic') {
        return rawProto;
    }

    const baseUrl = String(modelConfig.baseUrl || '').toLowerCase().trim();
    const modelId = String(modelConfig.modelId || '').toLowerCase().trim();

    if (baseUrl.endsWith('/messages') || baseUrl.includes('/v1/messages') || baseUrl.includes('anthropic.com')) {
        return 'anthropic';
    }
    if (baseUrl.endsWith('/chat/completions') || baseUrl.includes('openai.com') || baseUrl.includes('openrouter.ai') || baseUrl.includes('deepseek.com') || baseUrl.includes('siliconflow.cn')) {
        return 'openai';
    }
    // 很多 cc-switch 中转站 URL 带有 /api 或 claude 关键字且模型为 claude-*
    if (modelId.startsWith('claude') && (baseUrl.endsWith('/api') || baseUrl.includes('claude'))) {
        return 'anthropic';
    }
    return 'openai';
}

/**
 * 根据 baseUrl 与协议生成候选 Endpoint URL 列表
 */
export function buildEndpointCandidates(baseUrl, protocol) {
    // A pasted full endpoint must also allow switching to the other protocol.
    const original = String(baseUrl || '').trim().replace(/\/+$/, '');
    const clean = original.replace(/\/(?:chat\/completions|messages)$/, '');
    if (!clean) return [];

    const candidates = [];
    const addUnique = (u) => {
        if (u && !candidates.includes(u)) candidates.push(u);
    };

    if (protocol === 'anthropic') {
        if (original.endsWith('/messages')) addUnique(original);
        if (clean.endsWith('/v1/messages') || clean.endsWith('/messages')) {
            addUnique(clean);
        } else if (clean.endsWith('/v1')) {
            addUnique(`${clean}/messages`);
        } else {
            addUnique(`${clean}/v1/messages`);
            if (!clean.endsWith('/api')) {
                addUnique(`${clean}/api/v1/messages`);
            }
            addUnique(`${clean}/messages`);
        }
    } else {
        if (original.endsWith('/chat/completions')) addUnique(original);
        // openai 兼容协议
        if (clean.endsWith('/chat/completions')) {
            addUnique(clean);
        } else if (clean.endsWith('/v1')) {
            addUnique(`${clean}/chat/completions`);
        } else {
            addUnique(`${clean}/v1/chat/completions`);
            addUnique(`${clean}/chat/completions`);
        }
    }

    return candidates;
}

/**
 * 提取并标准化单条消息中的图像列表
 */
function extractNormalizedImages(msg = {}) {
    const out = [];
    const pushImg = (raw) => {
        if (!raw) return;
        let dataUrl = '';
        let mediaType = 'image/png';
        let base64 = '';
        if (typeof raw === 'string') {
            dataUrl = raw.trim();
        } else if (typeof raw === 'object') {
            dataUrl = String(raw.dataUrl || raw.url || raw.image_url?.url || '').trim();
            mediaType = String(raw.mediaType || raw.media_type || raw.source?.media_type || 'image/png').trim();
            base64 = String(raw.base64 || raw.data || raw.source?.data || '').trim();
        }
        if (dataUrl.startsWith('data:image/')) {
            const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
            if (m) {
                mediaType = m[1];
                base64 = m[2].replace(/\s+/g, '');
            }
        } else if (base64) {
            base64 = base64.replace(/\s+/g, '');
            dataUrl = `data:${mediaType};base64,${base64}`;
        }
        if (base64 && dataUrl) {
            out.push({ mediaType, base64, dataUrl });
        }
    };

    if (Array.isArray(msg.images)) {
        msg.images.forEach(pushImg);
    }
    if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
            if (!part || typeof part !== 'object') continue;
            if (part.type === 'image_url' || part.type === 'image') {
                pushImg(part);
            }
        }
    }
    return out;
}

/**
 * 规范化消息数组：确保 system 提取、user/assistant 严格交替、内容非空，并保留多模态截图数据
 */
export function normalizeMessagesForProtocol(messages = [], extraSystemPrompt = '') {
    const systemParts = [];
    if (extraSystemPrompt && String(extraSystemPrompt).trim()) {
        systemParts.push(String(extraSystemPrompt).trim());
    }

    const turns = [];
    for (const msg of messages) {
        if (!msg || typeof msg !== 'object') continue;
        const role = String(msg.role || 'user').toLowerCase();
        let text = '';
        if (typeof msg.content === 'string') {
            text = msg.content;
        } else if (Array.isArray(msg.content)) {
            text = msg.content
                .map(part => (typeof part === 'string' ? part : part?.text || part?.content || ''))
                .filter(Boolean)
                .join('\n');
        }
        text = text.trim();
        const images = extractNormalizedImages(msg);
        if (!text && images.length === 0) continue;

        if (role === 'system' || role === 'developer') {
            if (text) systemParts.push(text);
            continue;
        }

        const normalizedRole = role === 'assistant' || role === 'model' ? 'assistant' : 'user';
        const effectiveText = text || (images.length > 0 ? '请结合附图回答。' : '');
        if (turns.length > 0 && turns[turns.length - 1].role === normalizedRole) {
            if (effectiveText) {
                turns[turns.length - 1].content = turns[turns.length - 1].content
                    ? `${turns[turns.length - 1].content}\n\n${effectiveText}`
                    : effectiveText;
            }
            if (images.length > 0) {
                turns[turns.length - 1].images.push(...images);
            }
        } else {
            turns.push({
                role: normalizedRole,
                content: effectiveText,
                images: [...images]
            });
        }
    }

    // Anthropic 及部分严格中转站要求第一条非 system 消息必须是 user
    if (turns.length > 0 && turns[0].role !== 'user') {
        turns.unshift({
            role: 'user',
            content: '[对话上下文继续]',
            images: []
        });
    }

    if (turns.length === 0) {
        turns.push({
            role: 'user',
            content: 'Hello',
            images: []
        });
    }

    return {
        systemPrompt: systemParts.join('\n\n').trim(),
        turns
    };
}

/**
 * 构建不同协议下的请求体（支持多模态 Vision 截图）
 */
export function buildProtocolRequestBody({
    protocol,
    modelId,
    systemPrompt,
    turns,
    maxTokens = 4096,
    effectiveTemp,
    reasoningEffort = 'default',
    useStream = false,
    includeUsage = true
}) {
    if (protocol === 'anthropic') {
        const b = {
            model: modelId,
            max_tokens: maxTokens || 4096,
            messages: turns.map(t => {
                if (t.role === 'user' && Array.isArray(t.images) && t.images.length > 0) {
                    const blocks = t.images.map(img => ({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: img.mediaType || 'image/png',
                            data: img.base64
                        }
                    }));
                    blocks.push({
                        type: 'text',
                        text: t.content || '请查看附图'
                    });
                    return { role: t.role, content: blocks };
                }
                return { role: t.role, content: t.content };
            }),
            stream: useStream
        };
        if (systemPrompt) b.system = systemPrompt;
        if (typeof effectiveTemp === 'number') b.temperature = effectiveTemp;
        return applyReasoningConfig(b, { modelId }, reasoningEffort, protocol);
    } else {
        const openAiMessages = [];
        if (systemPrompt) {
            openAiMessages.push({ role: 'system', content: systemPrompt });
        }
        for (const t of turns) {
            if (t.role === 'user' && Array.isArray(t.images) && t.images.length > 0) {
                const parts = [
                    { type: 'text', text: t.content || '请查看附图' },
                    ...t.images.map(img => ({
                        type: 'image_url',
                        image_url: { url: img.dataUrl, detail: 'high' }
                    }))
                ];
                openAiMessages.push({ role: t.role, content: parts });
            } else {
                openAiMessages.push({ role: t.role, content: t.content });
            }
        }
        const b = {
            model: modelId,
            messages: openAiMessages,
            stream: useStream
        };
        if(useStream&&includeUsage)b.stream_options={include_usage:true};
        if (maxTokens) b[/^(?:gpt-[56]|o[134])(?:[.-]|$)/i.test(modelId) ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
        if (typeof effectiveTemp === 'number') b.temperature = effectiveTemp;
        return applyReasoningConfig(b, { modelId }, reasoningEffort, protocol);
    }
}

/**
 * 解析模型响应体（同时兼容标准 JSON 与强制 SSE 流式响应）
 */
function hasModelOutput(response) {
    return Boolean(response.content || response.reasoning || ['tool_calls', 'tool_use'].includes(response.finishReason));
}

export function parseRawModelResponse(rawText, protocol = 'openai') {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) {
        return { ok: false, error: '中转站返回了空响应体 (Empty response body)' };
    }

    // 1. 尝试直接作为 JSON 解析
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const data = JSON.parse(trimmed);
            if (data.error) {
                const errMsg = typeof data.error === 'string'
                    ? data.error
                    : (data.error.message || data.error.code || JSON.stringify(data.error));
                return { ok: false, error: errMsg, rawData: data };
            }

            // OpenAI 标准响应
            if (Array.isArray(data.choices) && data.choices.length > 0) {
                const choice = data.choices[0];
                const msg = choice.message || choice.delta || {};
                let content = '';
                if (typeof msg.content === 'string') {
                    content = msg.content;
                } else if (Array.isArray(msg.content)) {
                    content = msg.content.map(c => c?.text || c?.content || '').join('');
                } else if (typeof choice.text === 'string') {
                    content = choice.text;
                }
                const reasoning = msg.reasoning_content || msg.reasoning || '';
                return {
                    ok: true,
                    content: String(content || '').trim(),
                    reasoning: String(reasoning || '').trim(),
                    finishReason: choice.finish_reason || '',
                    model: data.model || '',
                    usage: data.usage || null,
                    rawData: data
                };
            }

            // Anthropic (/v1/messages) 标准响应
            if (Array.isArray(data.content)) {
                const textParts = [];
                const thinkingParts = [];
                for (const block of data.content) {
                    if (!block) continue;
                    if (block.type === 'text' && typeof block.text === 'string') {
                        textParts.push(block.text);
                    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
                        thinkingParts.push(block.thinking);
                    } else if (typeof block.text === 'string') {
                        textParts.push(block.text);
                    }
                }
                return {
                    ok: true,
                    content: textParts.join('').trim(),
                    reasoning: thinkingParts.join('\n').trim(),
                    finishReason: data.stop_reason || '',
                    model: data.model || '',
                    usage: data.usage || null,
                    rawData: data
                };
            }

            // 部分网关直接返回 { reply: "..." } 或 { output_text: "..." }
            if (typeof data.output_text === 'string' || typeof data.reply === 'string' || typeof data.result === 'string') {
                return {
                    ok: true,
                    content: String(data.output_text || data.reply || data.result).trim(),
                    reasoning: '',
                    model: data.model || '',
                    usage: data.usage || null,
                    rawData: data
                };
            }
        } catch {
            // 若非合法单对象 JSON，继续尝试 SSE 解析
        }
    }

    // 2. 解析 SSE 流式文本 (data: {...})
    if (trimmed.includes('data:')) {
        const payloads = trimmed.split(/\r?\n\r?\n/).map(frame => frame.split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).replace(/^ /, '')).join('\n')).filter(Boolean);
        const contentChunks = [];
        const reasoningChunks = [];
        let detectedModel = '';
        let sseError = null;
        let finishReason = '';

        for (const payload of payloads) {
            if (payload === '[DONE]') break;

            try {
                const evt = JSON.parse(payload);
                if (evt.error) {
                    sseError = typeof evt.error === 'string'
                        ? evt.error
                        : (evt.error.message || JSON.stringify(evt.error));
                    break;
                }
                if (evt.model && !detectedModel) {
                    detectedModel = evt.model;
                }
                if (evt.message?.model && !detectedModel) {
                    detectedModel = evt.message.model;
                }
                finishReason = evt.choices?.[0]?.finish_reason || evt.delta?.stop_reason || evt.message?.stop_reason || finishReason;

                // OpenAI SSE delta
                if (Array.isArray(evt.choices) && evt.choices.length > 0) {
                    const delta = evt.choices[0].delta || evt.choices[0].message || {};
                    if (typeof delta.content === 'string') {
                        contentChunks.push(delta.content);
                    }
                    if (typeof delta.reasoning_content === 'string') {
                        reasoningChunks.push(delta.reasoning_content);
                    } else if (typeof delta.reasoning === 'string') {
                        reasoningChunks.push(delta.reasoning);
                    }
                }

                // Anthropic SSE content_block_delta / content_block_start
                if (evt.type === 'content_block_delta' && evt.delta) {
                    if (typeof evt.delta.text === 'string') {
                        contentChunks.push(evt.delta.text);
                    } else if (typeof evt.delta.thinking === 'string') {
                        reasoningChunks.push(evt.delta.thinking);
                    }
                } else if (evt.type === 'content_block_start' && evt.content_block) {
                    if (typeof evt.content_block.text === 'string') {
                        contentChunks.push(evt.content_block.text);
                    }
                }
            } catch {
                // 忽略单行解析异常
            }
        }

        if (sseError) {
            return { ok: false, error: sseError, partial: contentChunks.length > 0 || reasoningChunks.length > 0 };
        }
        if (contentChunks.length > 0 || reasoningChunks.length > 0 || ['tool_calls', 'tool_use'].includes(finishReason)) {
            return {
                ok: true,
                content: contentChunks.join('').trim(),
                reasoning: reasoningChunks.join('').trim(),
                finishReason,
                model: detectedModel,
                usage: null
            };
        }
    }

    // 3. 若返回的是 HTML 错误页（例如 Cloudflare 502/403 拦截）
    if (/<!doctype html>|<html/i.test(trimmed)) {
        const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : 'HTML 错误页';
        return {
            ok: false,
            error: `中转站返回了网页而非 API JSON (${title})，请检查 Base URL 是否正确`
        };
    }

    return {
        ok: false,
        error: `无法解析中转站响应格式: ${trimmed.slice(0, 180)}`,
        protocol
    };
}

/**
 * 使用指定协议与单个 Endpoint 执行请求
 */
async function executeSingleProtocolRequest({
    endpointUrl,
    protocol,
    apiKey,
    modelId,
    systemPrompt,
    turns,
    maxTokens = 4096,
    temperature,
    reasoningEffort = 'default',
    extraHeaders = {},
    timeoutMs = 45000,
    signal
}) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...extraHeaders
    };

    const isReasoningModel = /^(claude-|gpt-[56]|deepseek-reasoner|o1|o3|o4|gemini-.*thinking)/i.test(modelId);
    const effectiveTemp = (typeof temperature === 'number' && !isReasoningModel) ? temperature : undefined;

    if (protocol === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['anthropic-version'] = extraHeaders['anthropic-version'] || '2023-06-01';
    } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const doAttempt = async (useStream) => {
        const reqHeaders = {
            ...headers,
            'Accept': useStream ? 'text/event-stream, application/json' : 'application/json, text/event-stream'
        };
        const startedAt = Date.now();
        const res = await fetchWithFallback(
            endpointUrl,
            {
                method: 'POST',
                signal,
                headers: reqHeaders,
                body: JSON.stringify(buildProtocolRequestBody({
                    protocol,
                    modelId,
                    systemPrompt,
                    turns,
                    maxTokens,
                    effectiveTemp,
                    reasoningEffort,
                    useStream
                }))
            },
            timeoutMs
        );
        const rawText = await res.text();
        const latencyMs = Date.now() - startedAt;
        const parsed = parseRawModelResponse(rawText, protocol);
        return { res, latencyMs, rawText, parsed };
    };

    let { res, latencyMs, parsed } = await doAttempt(false);

    // 部分中转站强制要求 stream: true 或在非流式下超时返回空内容，自动回退为流式请求并聚合
    const shouldRetryStream =
        (!res.ok && (res.status === 400 || res.status === 422) && /stream/i.test(parsed.error || '')) ||
        (res.ok && !parsed.partial && (!parsed.ok || !hasModelOutput(parsed)));

    if (shouldRetryStream) {
        try {
            const streamAttempt = await doAttempt(true);
            if (streamAttempt.res.ok && streamAttempt.parsed.ok && hasModelOutput(streamAttempt.parsed)) {
                res = streamAttempt.res;
                latencyMs = streamAttempt.latencyMs;
                parsed = streamAttempt.parsed;
            }
        } catch {
            // 保留首次错误
        }
    }

    if (!res.ok) {
        const errDetail = parsed.error || `HTTP ${res.status} ${res.statusText}`;
        return {
            ok: false,
            status: res.status,
            latencyMs,
            endpointUrl,
            protocol,
            error: `HTTP ${res.status}: ${errDetail}`
        };
    }

    if (!parsed.ok || !hasModelOutput(parsed)) {
        return {
            ok: false,
            status: res.status,
            latencyMs,
            endpointUrl,
            protocol,
            partial: parsed.partial,
            error: parsed.error || '中转站返回了空内容，请重试或检查模型状态'
        };
    }

    return {
        ok: true,
        status: res.status,
        latencyMs,
        endpointUrl,
        protocol,
        content: parsed.content,
        reasoning: parsed.reasoning || '',
        finishReason: parsed.finishReason || '',
        model: parsed.model || modelId,
        usage: parsed.usage || null
    };
}

/**
 * 使用指定协议与单个 Endpoint 执行【实时 SSE 流式】请求，边接收边触发回调
 */
async function executeStreamingProtocolRequest({
    endpointUrl,
    protocol,
    apiKey,
    modelId,
    systemPrompt,
    turns,
    maxTokens = 4096,
    temperature,
    reasoningEffort = 'default',
    extraHeaders = {},
    timeoutMs = 120000,
    signal,
    callbacks = {},
    includeUsage = true
}) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json',
        ...extraHeaders
    };

    const isReasoningModel = /^(claude-|gpt-[56]|deepseek-reasoner|o1|o3|o4|gemini-.*thinking)/i.test(modelId);
    const effectiveTemp = (typeof temperature === 'number' && !isReasoningModel) ? temperature : undefined;

    if (protocol === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['anthropic-version'] = extraHeaders['anthropic-version'] || '2023-06-01';
    } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const startedAt = Date.now();
    const res = await fetchWithFallback(
        endpointUrl,
        {
            method: 'POST',
            signal,
            headers,
            body: JSON.stringify(buildProtocolRequestBody({
                protocol,
                modelId,
                systemPrompt,
                turns,
                maxTokens,
                effectiveTemp,
                reasoningEffort,
                useStream: true,
                includeUsage
            }))
        },
        timeoutMs,
        callbacks.onActivity
    );

    if (!res.ok) {
        const rawErr = await res.text();
        const parsedErr = parseRawModelResponse(rawErr, protocol);
        return {
            ok: false,
            status: res.status,
            latencyMs: Date.now() - startedAt,
            endpointUrl,
            protocol,
            error: `HTTP ${res.status}: ${parsedErr.error || res.statusText}`
        };
    }

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    // 如果中转站忽略了 stream: true 直接返回了普通 JSON，则直接解析并通过回调输出
    if (contentType.includes('application/json') || !res.body) {
        const rawText = await res.text();
        const parsed = parseRawModelResponse(rawText, protocol);
        const latencyMs = Date.now() - startedAt;
        if (!parsed.ok || !hasModelOutput(parsed)) {
            return {
                ok: false,
                status: res.status,
                latencyMs,
                endpointUrl,
                protocol,
                error: parsed.error || '中转站返回了空内容'
            };
        }
        if (parsed.reasoning) callbacks.onThinkingDelta?.(parsed.reasoning);
        if (parsed.content) callbacks.onTextDelta?.(parsed.content);
        return {
            ok: true,
            status: res.status,
            latencyMs,
            endpointUrl,
            protocol,
            content: parsed.content,
            reasoning: parsed.reasoning || '',
            finishReason: parsed.finishReason || '',
            model: parsed.model || modelId,
            usage: parsed.usage || null
        };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let rawFallbackBuffer = '';
    const contentChunks = [];
    const reasoningChunks = [];
    let detectedModel = '';
    let usage = null;
    let finishReason = '';
    let sseError = null;
    let sawSseDataLine = false;
    let ended = false;
    let dataLines = [];

    const processSseLine = (line) => {
        const cleanLine = line.trim();
        if (!cleanLine.startsWith('data:')) return;
        sawSseDataLine = true;
        const payload = cleanLine.slice(5).trim();
        if (!payload) return;
        if (payload === '[DONE]') { ended = true; return; }

        try {
            const evt = JSON.parse(payload);
            if (evt.error) {
                sseError = typeof evt.error === 'string'
                    ? evt.error
                    : (evt.error.message || JSON.stringify(evt.error));
                return;
            }
            if (evt.model && !detectedModel) detectedModel = evt.model;
            if (evt.message?.model && !detectedModel) detectedModel = evt.message.model;
            if (evt.message?.usage) usage = { ...usage, ...evt.message.usage };
            if (evt.usage) usage = { ...usage, ...evt.usage };
            if (ended) return;
            finishReason = evt.choices?.[0]?.finish_reason || evt.delta?.stop_reason || evt.message?.stop_reason || finishReason;
            if (evt.type === 'message_stop') ended = true;

            // OpenAI 兼容 SSE delta
            if (Array.isArray(evt.choices) && evt.choices.length > 0) {
                const delta = evt.choices[0].delta || evt.choices[0].message || {};
                const rDelta = delta.reasoning_content ?? delta.reasoning ?? '';
                if (typeof rDelta === 'string' && rDelta.length > 0) {
                    reasoningChunks.push(rDelta);
                    callbacks.onThinkingDelta?.(rDelta);
                }
                if (typeof delta.content === 'string' && delta.content.length > 0) {
                    contentChunks.push(delta.content);
                    callbacks.onTextDelta?.(delta.content);
                }
            }

            // Anthropic 原生 SSE delta
            if (evt.type === 'content_block_delta' && evt.delta) {
                if (typeof evt.delta.thinking === 'string' && evt.delta.thinking.length > 0) {
                    reasoningChunks.push(evt.delta.thinking);
                    callbacks.onThinkingDelta?.(evt.delta.thinking);
                } else if (typeof evt.delta.text === 'string' && evt.delta.text.length > 0) {
                    contentChunks.push(evt.delta.text);
                    callbacks.onTextDelta?.(evt.delta.text);
                }
            } else if (evt.type === 'content_block_start' && evt.content_block) {
                if (typeof evt.content_block.thinking === 'string' && evt.content_block.thinking.length > 0) {
                    reasoningChunks.push(evt.content_block.thinking);
                    callbacks.onThinkingDelta?.(evt.content_block.thinking);
                } else if (typeof evt.content_block.text === 'string' && evt.content_block.text.length > 0) {
                    contentChunks.push(evt.content_block.text);
                    callbacks.onTextDelta?.(evt.content_block.text);
                }
            }
            // Some relays keep HTTP open after the protocol's terminal event.
            // Finish this turn so its tools can run; do not await another token.
            if (evt.choices?.[0]?.finish_reason || (evt.type === 'message_delta' && evt.delta?.stop_reason)) ended = true;
        } catch {
            // ignore malformed chunk
        }
    };

    const processLine = (line) => {
        if (sseError) return;
        if (line === '') {
            if (dataLines.length) processSseLine(`data: ${dataLines.join('\n')}`);
            dataLines = [];
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).replace(/^ /, ''));
        }
    };
    try {
        while (!ended && !sseError) {
            const { done, value } = await reader.read();
            const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
            buffer += chunk;
            if (!sawSseDataLine) rawFallbackBuffer += chunk.slice(0, 1000000 - rawFallbackBuffer.length);
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) processLine(line);
            if (done) { if (buffer) processLine(buffer); processLine(''); break; }
            if(ended && protocol==='openai' && finishReason && !usage){
                // OpenAI usage often arrives just after finish_reason. Read a
                // bounded tail so relays that never close still finish promptly.
                let timer;
                const tail=await Promise.race([reader.read(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),Math.min(300,timeoutMs/2));})]);
                clearTimeout(timer);
                if(tail){buffer+=tail.done?decoder.decode():decoder.decode(tail.value,{stream:true});
                  const tailLines=buffer.split(/\r?\n/);buffer=tailLines.pop()||'';for(const line of tailLines)processLine(line);
                  if(tail.done){if(buffer)processLine(buffer);processLine('');}}
            }
        }
    } finally {
        try { await reader.cancel(); } catch {}
        reader.releaseLock();
    }

    const latencyMs = Date.now() - startedAt;

    // 若流结束后发现中转站返回的是非 SSE 的整块 JSON，自动用 parseRawModelResponse 兜底
    if (!sawSseDataLine && rawFallbackBuffer.trim()) {
        const parsed = parseRawModelResponse(rawFallbackBuffer, protocol);
        if (parsed.ok && hasModelOutput(parsed)) {
            if (parsed.reasoning) callbacks.onThinkingDelta?.(parsed.reasoning);
            if (parsed.content) callbacks.onTextDelta?.(parsed.content);
            return {
                ok: true,
                status: res.status,
                latencyMs,
                endpointUrl,
                protocol,
                content: parsed.content,
                reasoning: parsed.reasoning || '',
                finishReason: parsed.finishReason || '',
                model: parsed.model || modelId,
                usage: parsed.usage || null
            };
        }
    }

    const fullContent = contentChunks.join('').trim();
    const fullReasoning = reasoningChunks.join('').trim();

    if (sseError) {
        return {
            ok: false,
            status: res.status,
            latencyMs,
            endpointUrl,
            protocol,
            error: sseError
        };
    }

    if (!hasModelOutput({ content: fullContent, reasoning: fullReasoning, finishReason })) {
        return {
            ok: false,
            status: res.status,
            latencyMs,
            endpointUrl,
            protocol,
            error: '中转站流式响应未返回任何有效内容'
        };
    }

    return {
        ok: true,
        status: res.status,
        latencyMs,
        endpointUrl,
        protocol,
        content: fullContent,
        reasoning: fullReasoning,
        finishReason,
        model: detectedModel || modelId,
        usage
    };
}

/**
 * 实时流式对话调用接口：支持自动候选 URL 与协议回退，并实时回调思考与正文增量
 */
export async function streamChatWithModel(modelConfig, messages, options = {}, callbacks = {}) {
    const baseUrl = String(modelConfig?.baseUrl || '').trim();
    const apiKey = String(modelConfig?.apiKey || '').trim();
    const modelId = String(modelConfig?.modelId || '').trim();

    if (!baseUrl) return { ok: false, error: '未配置中转站接口地址 (Base URL)' };
    if (!apiKey) return { ok: false, error: '未配置 API Key' };
    if (!modelId) return { ok: false, error: '未配置模型 ID (Model ID)' };

    const explicitProto = String(modelConfig.protocol || 'auto').toLowerCase().trim();
    const primaryProto = inferPrimaryProtocol(modelConfig);
    const protocolsToTry = explicitProto === 'auto'
        ? [primaryProto, primaryProto === 'openai' ? 'anthropic' : 'openai']
        : [primaryProto];

    const { systemPrompt, turns } = normalizeMessagesForProtocol(
        messages,
        options.systemPrompt ?? modelConfig.systemPrompt ?? ''
    );

    const maxTokens = options.maxTokens || modelConfig.maxTokens || 4096;
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 120000);
    const deadline = new AbortController();
    let idleTimer;
    const resetIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => deadline.abort(new Error(`请求无响应超时 (${Math.round(timeoutMs / 1000)}s)`)), timeoutMs);
    };
    resetIdleTimer();
    const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
    let emitted = false;
    const guardedCallbacks = { ...callbacks, onActivity: () => { resetIdleTimer(); callbacks.onActivity?.(); },
        onTextDelta: delta => { emitted = true; callbacks.onTextDelta?.(delta); },
        onThinkingDelta: delta => { emitted = true; callbacks.onThinkingDelta?.(delta); } };
    const extraHeaders = (modelConfig.extraHeaders && typeof modelConfig.extraHeaders === 'object')
        ? modelConfig.extraHeaders
        : {};

    let firstErrorResult = null;

    try {
    for (const proto of protocolsToTry) {
        const endpoints = buildEndpointCandidates(baseUrl, proto);
        for (const endpointUrl of endpoints) {
            try {
                callbacks.onStatus?.({
                    phase: 'connecting',
                    protocol: proto,
                    endpointUrl,
                    message: `正在连接中转站 (${proto.toUpperCase()}) · ${modelConfig.name || modelId}...`
                });

                const result = await executeStreamingProtocolRequest({
                    endpointUrl,
                    protocol: proto,
                    apiKey,
                    modelId,
                    systemPrompt,
                    turns,
                    maxTokens,
                    temperature: options.temperature,
                    reasoningEffort: options.reasoningEffort ?? modelConfig.reasoningEffort ?? 'default',
                    extraHeaders,
                    timeoutMs,
                    signal,
                    callbacks: guardedCallbacks
                    ,includeUsage: options.includeUsage !== false
                });

                if (result.ok) {
                    return result;
                }

                if (!firstErrorResult) {
                    firstErrorResult = result;
                }

                if (emitted || signal.aborted || [401, 403, 429].includes(result.status)) return result;
            } catch (err) {
                if (emitted || signal.aborted) return { ok: false, status: 0, protocol: proto, endpointUrl,
                    error: signal.aborted ? String(signal.reason?.message || '请求已取消或超时') : (err?.message || String(err)) };
                if (!firstErrorResult) {
                    firstErrorResult = {
                        ok: false,
                        status: 0,
                        latencyMs: 0,
                        endpointUrl,
                        protocol: proto,
                        error: err?.message || String(err)
                    };
                }
            }
        }
    }

    return firstErrorResult || {
        ok: false,
        status: 0,
        latencyMs: 0,
        error: '无法连接到中转站接口，请检查 Base URL 与网络设置'
    };
    } finally { clearTimeout(idleTimer); }
}

/**
 * 核心对话调用接口：支持自动候选 URL 与协议回退
 */
export async function chatWithModel(modelConfig, messages, options = {}) {
    const baseUrl = String(modelConfig?.baseUrl || '').trim();
    const apiKey = String(modelConfig?.apiKey || '').trim();
    const modelId = String(modelConfig?.modelId || '').trim();

    if (!baseUrl) {
        return { ok: false, error: '未配置中转站接口地址 (Base URL)' };
    }
    if (!apiKey) {
        return { ok: false, error: '未配置 API Key' };
    }
    if (!modelId) {
        return { ok: false, error: '未配置模型 ID (Model ID)' };
    }

    const explicitProto = String(modelConfig.protocol || 'auto').toLowerCase().trim();
    const primaryProto = inferPrimaryProtocol(modelConfig);
    const protocolsToTry = explicitProto === 'auto'
        ? [primaryProto, primaryProto === 'openai' ? 'anthropic' : 'openai']
        : [primaryProto];

    const { systemPrompt, turns } = normalizeMessagesForProtocol(
        messages,
        options.systemPrompt ?? modelConfig.systemPrompt ?? ''
    );

    const maxTokens = options.maxTokens || modelConfig.maxTokens || 4096;
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 60000);
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const extraHeaders = (modelConfig.extraHeaders && typeof modelConfig.extraHeaders === 'object')
        ? modelConfig.extraHeaders
        : {};

    let firstErrorResult = null;

    for (const proto of protocolsToTry) {
        const endpoints = buildEndpointCandidates(baseUrl, proto);
        for (const endpointUrl of endpoints) {
            try {
                const result = await executeSingleProtocolRequest({
                    endpointUrl,
                    protocol: proto,
                    apiKey,
                    modelId,
                    systemPrompt,
                    turns,
                    maxTokens,
                    temperature: options.temperature,
                    reasoningEffort: options.reasoningEffort ?? modelConfig.reasoningEffort ?? 'default',
                    extraHeaders,
                    timeoutMs,
                    signal
                });

                if (result.ok) {
                    return result;
                }

                if (!firstErrorResult) {
                    firstErrorResult = result;
                }

                // 若是 401 / 403 鉴权失败或 429 额度耗尽，无需继续盲目尝试同一协议下的过多路径
                if (result.partial || signal.aborted || [401, 403, 429].includes(result.status)) return result;
            } catch (err) {
                if (signal.aborted) return { ok: false, status: 0, protocol: proto, endpointUrl,
                    error: String(signal.reason?.message || '请求已取消或超时') };
                if (!firstErrorResult) {
                    firstErrorResult = {
                        ok: false,
                        status: 0,
                        latencyMs: 0,
                        endpointUrl,
                        protocol: proto,
                        error: err?.message || String(err)
                    };
                }
            }
        }
    }

    return firstErrorResult || {
        ok: false,
        status: 0,
        latencyMs: 0,
        error: '无法连接到中转站接口，请检查 Base URL 与网络设置'
    };
}

/**
 * 测试模型连接 (Test Connection)
 * 发送极简 ping 消息，验证 Base URL、API Key、Model ID 是否可用，并返回延迟 (ms) 与响应预览
 */
export async function testModelConnection(modelConfig) {
    const testMessages = [
        {
            role: 'user',
            content: 'Please reply with only the word "OK" to verify API connectivity.'
        }
    ];

    const res = await chatWithModel(modelConfig, testMessages, {
        maxTokens: 32,
        timeoutMs: 20000,
        systemPrompt: ''
    });

    if (!res.ok) {
        return {
            ok: false,
            status: res.status || 0,
            latencyMs: res.latencyMs || 0,
            resolvedProtocol: res.protocol || inferPrimaryProtocol(modelConfig),
            endpointUrl: res.endpointUrl || '',
            error: res.error || '连接失败'
        };
    }

    const preview = (res.content || res.reasoning || 'OK').replace(/\s+/g, ' ').trim().slice(0, 80);
    return {
        ok: true,
        status: res.status || 200,
        latencyMs: res.latencyMs || 0,
        resolvedProtocol: res.protocol,
        endpointUrl: res.endpointUrl,
        reportedModel: res.model || modelConfig.modelId,
        replyPreview: preview || 'OK'
    };
}

/**
 * 从中转站 `/v1/models` 端点自动拉取该令牌支持的模型 ID 列表
 */
export async function discoverRelayModels({ baseUrl, apiKey }) {
    const clean = String(baseUrl || '').trim().replace(/\/+$/, '')
        .replace(/\/chat\/completions$/i, '')
        .replace(/\/messages$/i, '');
    if (!clean || !apiKey) {
        return { ok: false, error: '请先填写中转站 Base URL 与 API Key', models: [] };
    }

    const candidates = clean.endsWith('/v1')
        ? [`${clean}/models`]
        : [`${clean}/v1/models`, `${clean}/models`];

    for (const url of candidates) {
        try {
            const res = await fetchWithFallback(
                url,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        'Accept': 'application/json'
                    }
                },
                12000
            );
            if (!res.ok) {
                const errorText = await res.text();
                if ([401, 403, 429].includes(res.status)) {
                    return { ok: false, error: `HTTP ${res.status}: ${parseRawModelResponse(errorText, 'openai').error || res.statusText}`, models: [] };
                }
                continue;
            }
            const data = await res.json();
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
            const ids = list
                .map(item => (typeof item === 'string' ? item : item?.id || item?.name || ''))
                .filter(Boolean);
            if (ids.length > 0) {
                return {
                    ok: true,
                    endpointUrl: url,
                    models: Array.from(new Set(ids)).sort()
                };
            }
        } catch {
            // continue to next candidate
        }
    }

    return {
        ok: false,
        error: '该中转站未开放 /v1/models 列表接口，请直接手动输入或选择预设模型 ID',
        models: []
    };
}

