/**
 * Antigravity WorkBuddy 风格无状态上下文消毒与双向无缝桥接引擎 (Context Bridge)
 * ----------------------------------------------------------------------------
 * 解决痛点：
 * 在传统 cc-switch 中，同一对话中途从“官方模型”切换到“第三方中转 API”（或反之）会直接报错中断，原因包括：
 * 1. 官方模型历史中含有加密的 `thinking.signature` 签名块，中转站校验失败返回 400 Invalid signature；
 * 2. 官方 Agent 的 `tool_calls` / `tool_result` ID 与第三方 OpenAI/Anthropic 协议不兼容；
 * 3. 消息中包含 `<ADDITIONAL_METADATA>`、`<USER_SETTINGS_CHANGE>` 等内部 XML 标签或连续同角色消息；
 * 4. 在第三方 API 产生的对话记录无法回流到官方模型上下文中。
 *
 * 本模块通过“双向无状态上下文消毒 + 时间轴合并 + 未同步轮次自动桥接”实现真正的同会话无缝切换。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './model-store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRAIN_CANDIDATE_DIRS = [
    ...(process.env.AGY_MODEL_BRAIN_DIR ? [path.resolve(process.env.AGY_MODEL_BRAIN_DIR)] : []),
    path.join(process.env.USERPROFILE || os.homedir(), '.gemini', 'antigravity', 'brain')
];

export const BRIDGES_DIR = path.join(DATA_DIR, 'bridges');
export const BRIDGE_MEDIA_DIR = path.join(BRIDGES_DIR, 'media');

function ensureBridgesDir() {
    if (!fs.existsSync(BRIDGES_DIR)) {
        fs.mkdirSync(BRIDGES_DIR, { recursive: true });
    }
    if (!fs.existsSync(BRIDGE_MEDIA_DIR)) {
        fs.mkdirSync(BRIDGE_MEDIA_DIR, { recursive: true });
    }
}

/**
 * 将 file:// URI 或本地路径解析为可读磁盘路径，并转换为 base64 dataUrl
 */
export function loadMediaFileAsImageObj(rawPathOrUri = '', defaultMime = 'image/png') {
    if (!rawPathOrUri) return null;
    let filePath = String(rawPathOrUri).trim();
    if (filePath.startsWith('data:image/')) {
        const m = filePath.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
        if (m) {
            return {
                mediaType: m[1],
                base64: m[2].replace(/\s+/g, ''),
                dataUrl: filePath
            };
        }
        return null;
    }
    if (filePath.startsWith('file:///')) {
        try {
            filePath = decodeURIComponent(filePath.replace(/^file:\/\/\//i, ''));
        } catch {
            filePath = filePath.replace(/^file:\/\/\//i, '');
        }
    }
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > 15 * 1024 * 1024) return null;
        const buf = fs.readFileSync(filePath);
        const base64 = buf.toString('base64');
        const ext = path.extname(filePath).toLowerCase();
        let mediaType = defaultMime || 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mediaType = 'image/jpeg';
        else if (ext === '.webp') mediaType = 'image/webp';
        else if (ext === '.gif') mediaType = 'image/gif';
        return {
            mediaType,
            base64,
            dataUrl: `data:${mediaType};base64,${base64}`,
            filePath
        };
    } catch {
        return null;
    }
}

/**
 * 将中转对话中上传的截图持久化保存到 D 盘 bridges/media 目录
 */
export function saveBridgeImages(exchangeId, rawImages = []) {
    if (!Array.isArray(rawImages) || rawImages.length === 0) return [];
    ensureBridgesDir();
    const saved = [];
    for (let i = 0; i < rawImages.length && i < 6; i++) {
        const item = rawImages[i];
        if (!item) continue;
        let dataUrl = typeof item === 'string' ? item : (item.dataUrl || '');
        let mediaType = (typeof item === 'object' && item.mediaType) ? item.mediaType : 'image/png';
        let base64 = (typeof item === 'object' && item.base64) ? item.base64 : '';

        if (dataUrl && dataUrl.startsWith('data:image/')) {
            const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
            if (m) {
                mediaType = m[1];
                base64 = m[2];
            }
        }
        if (!base64) continue;

        const ext = mediaType.includes('jpeg') || mediaType.includes('jpg')
            ? 'jpg'
            : (mediaType.includes('webp') ? 'webp' : (mediaType.includes('gif') ? 'gif' : 'png'));
        const fileName = `${exchangeId}-${i}.${ext}`;
        const filePath = path.join(BRIDGE_MEDIA_DIR, fileName);
        try {
            fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
            saved.push({
                mediaType,
                filePath,
                name: (typeof item === 'object' && item.name) ? item.name : fileName
            });
        } catch {
            // ignore write error
        }
    }
    return saved;
}

/**
 * 解析当前活跃会话 ID（若传入 'auto' 或为空，则自动寻找最近更新的会话目录）
 */
export function resolveConversationId(conversationId = '') {
    const clean = String(conversationId || '').trim();
    if (clean && clean !== 'auto' && /^[a-zA-Z0-9_-]{6,}$/i.test(clean)) {
        return clean;
    }
    if (clean && clean !== 'auto') throw new Error('无效的会话 ID');

    let latestId = '';
    let latestMtime = 0;

    for (const brainDir of BRAIN_CANDIDATE_DIRS) {
        if (!fs.existsSync(brainDir)) continue;
        try {
            const entries = fs.readdirSync(brainDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (!/^[a-f0-9-]{20,}$/i.test(entry.name)) continue;
                const logFile = path.join(brainDir, entry.name, '.system_generated', 'logs', 'transcript_full.jsonl');
                const fallbackLog = path.join(brainDir, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
                const target = fs.existsSync(logFile) ? logFile : (fs.existsSync(fallbackLog) ? fallbackLog : null);
                if (!target) continue;
                const stat = fs.statSync(target);
                if (stat.mtimeMs > latestMtime) {
                    latestMtime = stat.mtimeMs;
                    latestId = entry.name;
                }
            }
            if (latestId) break;
        } catch {
            // ignore
        }
    }

    return latestId || 'default-session';
}

/**
 * 定位指定会话的官方 transcript.jsonl 文件路径
 */
export function findTranscriptPath(conversationId) {
    const cid = resolveConversationId(conversationId);
    for (const brainDir of BRAIN_CANDIDATE_DIRS) {
        const fullPath = path.join(brainDir, cid, '.system_generated', 'logs', 'transcript_full.jsonl');
        if (fs.existsSync(fullPath)) return fullPath;
        const compactPath = path.join(brainDir, cid, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(compactPath)) return compactPath;
    }
    return null;
}

/**
 * 清洗用户消息中的 Antigravity 内部包裹标签，提取纯粹的用户输入
 */
export function sanitizeUserContent(rawContent = '') {
    let text = String(rawContent || '');
    if (!text.trim()) return '';

    // 优先提取 <USER_REQUEST>...</USER_REQUEST> 内部文本
    const reqMatch = text.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
    if (reqMatch && reqMatch[1]) {
        text = reqMatch[1];
    } else {
        // 移除元数据与系统注入块
        text = text
            .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
            .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
            .replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi, '')
            .replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, '');
    }

    // 若该用户消息曾附带过【中转模型无缝桥接上下文】，剥离桥接前缀以免重复嵌套
    text = text.replace(/<!--\s*ANTIGRAVITY_BRIDGE_SYNC_START\s*-->[\s\S]*?<!--\s*ANTIGRAVITY_BRIDGE_SYNC_END\s*-->\s*/gi, '');

    return text.trim();
}

/**
 * 清洗模型回复消息：剔除加密签名与长工具原始输出，提取自然语言回复与工具名列表
 */
export function sanitizeAssistantStep(step = {}) {
    const content = typeof step.content === 'string' ? step.content.trim() : '';
    const toolCalls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    const toolNames = toolCalls
        .map(tc => tc?.name || tc?.tool_name || tc?.function?.name || '')
        .filter(Boolean);

    return {
        content,
        toolNames
    };
}

/**
 * 读取并消毒官方会话历史记录（包含用户上传的截图附件路径）
 */
export function readSanitizedOfficialTranscript(conversationId, maxTurns = 24) {
    const cid = resolveConversationId(conversationId);
    const transcriptPath = findTranscriptPath(cid);
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
        return {
            conversationId: cid,
            transcriptPath: null,
            maxStepIndex: -1,
            turns: []
        };
    }

    let rawText = '';
    try {
        rawText = fs.readFileSync(transcriptPath, 'utf-8');
    } catch {
        return {
            conversationId: cid,
            transcriptPath,
            maxStepIndex: -1,
            turns: []
        };
    }

    const lines = rawText.split(/\r?\n/).filter(l => l.trim());
    const parsedSteps = [];

    for (let i = 0; i < lines.length; i++) {
        try {
            const obj = JSON.parse(lines[i]);
            if (obj && typeof obj === 'object') {
                parsedSteps.push({
                    ...obj,
                    _lineOrder: i,
                    _stepIndex: typeof obj.step_index === 'number' ? obj.step_index : i
                });
            }
        } catch {
            // 忽略损坏行
        }
    }

    // 关键修复：transcript_full.jsonl 中的行可能因异步工具完成而乱序，必须按 step_index 升序排列
    parsedSteps.sort((a, b) => {
        if (a._stepIndex !== b._stepIndex) return a._stepIndex - b._stepIndex;
        return a._lineOrder - b._lineOrder;
    });

    let maxStepIndex = -1;
    const rawTurns = [];

    for (const step of parsedSteps) {
        if (step._stepIndex > maxStepIndex) {
            maxStepIndex = step._stepIndex;
        }

        const type = String(step.type || '').toUpperCase();
        const createdAt = step.created_at ? Date.parse(step.created_at) || 0 : 0;

        if (type === 'USER_INPUT') {
            reconcileBridgeReceipt(step.content || '', cid, step._stepIndex);
            const cleanUser = sanitizeUserContent(step.content || '');
            const stepMedia = Array.isArray(step.media)
                ? step.media
                    .filter(m => m && m.uri && (!m.mime_type || String(m.mime_type).startsWith('image/')))
                    .map(m => ({ mediaType: m.mime_type || 'image/png', filePath: m.uri }))
                : [];
            if (!cleanUser && stepMedia.length === 0) continue;
            rawTurns.push({
                role: 'user',
                content: cleanUser || '[附带截图]',
                mediaRefs: stepMedia,
                toolNames: [],
                stepIndex: step._stepIndex,
                createdAt,
                source: 'official'
            });
        } else if (type === 'PLANNER_RESPONSE') {
            const { content, toolNames } = sanitizeAssistantStep(step);
            if (!content && toolNames.length === 0) continue;
            rawTurns.push({
                role: 'assistant',
                content,
                mediaRefs: [],
                toolNames,
                stepIndex: step._stepIndex,
                createdAt,
                source: 'official'
            });
        }
    }

    // 合并官方历史中连续同角色的步骤，并将同一轮中的多次工具调用浓缩为单行摘要
    const mergedTurns = [];
    for (const turn of rawTurns) {
        const prev = mergedTurns[mergedTurns.length - 1];
        if (prev && prev.role === turn.role) {
            if (turn.content && !prev.content.includes(turn.content)) {
                prev.content = prev.content ? `${prev.content}\n\n${turn.content}`.trim() : turn.content;
            }
            if (Array.isArray(turn.toolNames) && turn.toolNames.length > 0) {
                prev.toolNames.push(...turn.toolNames);
            }
            if (Array.isArray(turn.mediaRefs) && turn.mediaRefs.length > 0) {
                prev.mediaRefs.push(...turn.mediaRefs);
            }
            prev.stepIndex = Math.max(prev.stepIndex, turn.stepIndex);
            if (turn.createdAt > prev.createdAt) {
                prev.createdAt = turn.createdAt;
            }
        } else {
            mergedTurns.push({
                ...turn,
                mediaRefs: [...(turn.mediaRefs || [])],
                toolNames: [...(turn.toolNames || [])]
            });
        }
    }

    // 为没有正文或包含工具调用的 assistant 轮次生成精简描述
    const finalizedTurns = mergedTurns
        .map(t => {
            let finalContent = t.content || '';
            if (t.role === 'assistant' && t.toolNames && t.toolNames.length > 0) {
                const uniqueTools = Array.from(new Set(t.toolNames));
                const toolBadge = `[已执行操作: ${uniqueTools.slice(0, 6).join(', ')}${uniqueTools.length > 6 ? ' 等' : ''}]`;
                finalContent = finalContent ? `${toolBadge}\n${finalContent}` : toolBadge;
            }
            return {
                role: t.role,
                content: finalContent.trim(),
                mediaRefs: t.mediaRefs || [],
                stepIndex: t.stepIndex,
                createdAt: t.createdAt,
                source: t.source
            };
        })
        .filter(t => Boolean(t.content) || (t.mediaRefs && t.mediaRefs.length > 0));

    const sliced = maxTurns > 0 ? finalizedTurns.slice(-maxTurns) : finalizedTurns;
    return {
        conversationId: cid,
        transcriptPath,
        maxStepIndex,
        turns: sliced
    };
}

// Only a bridge block present in the official transcript confirms delivery.
// This also carries local API history into a newly created official conversation.
function reconcileBridgeReceipt(content, targetCid, stepIndex) {
    const block = String(content).match(/<!--\s*ANTIGRAVITY_BRIDGE_SYNC_START\s*-->([\s\S]*?)<!--\s*ANTIGRAVITY_BRIDGE_SYNC_END\s*-->/);
    const receipt = block?.[1].match(/\[AGY_BRIDGE_RECEIPT:(\{[^\n]+\})\]/);
    if (!receipt) return;
    let data;
    try { data = JSON.parse(receipt[1]); } catch { return; }
    if (!/^[a-zA-Z0-9_-]{6,}$/.test(data.source || '') || !Array.isArray(data.ids)) return;
    if (data.source !== targetCid && !/^(startpage-|local-)/.test(data.source)) return;
    const source = readBridgeState(data.source);
    const delivered = source.exchanges.filter(ex => data.ids.includes(ex.id));
    if (!delivered.length) return;
    if (data.source !== targetCid) {
        const target = readBridgeState(targetCid);
        let changed = false;
        for (const ex of delivered) {
            if (!target.exchanges.some(existing => existing.id === ex.id)) {
                target.exchanges.push({ ...ex, afterOfficialStepIndex: stepIndex - 1, syncedToOfficial: true });
                changed = true;
            }
        }
        if (changed) writeBridgeState(targetCid, target);
    }
    if (delivered.some(ex => !ex.syncedToOfficial)) {
        delivered.forEach(ex => { ex.syncedToOfficial = true; });
        writeBridgeState(data.source, source);
    }
}

/**
 * 获取指定会话的桥接存储文件路径
 */
function getBridgeFilePath(conversationId) {
    ensureBridgesDir();
    const cid = resolveConversationId(conversationId).replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(BRIDGES_DIR, `${cid}.json`);
}

/**
 * 读取指定会话的中转模型桥接记录
 */
export function readBridgeState(conversationId) {
    const cid = resolveConversationId(conversationId);
    const filePath = getBridgeFilePath(cid);
    if (!fs.existsSync(filePath)) {
        return {
            conversationId: cid,
            updatedAt: 0,
            exchanges: []
        };
    }
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!data || !Array.isArray(data.exchanges)) throw new Error('会话记录结构无效');
        return {
            conversationId: cid,
            updatedAt: data.updatedAt || 0,
            migratedTo: data.migratedTo || null,
            deletedAt: data.deletedAt || 0,
            exchanges: Array.isArray(data.exchanges) ? data.exchanges : []
        };
    } catch {
        throw new Error(`会话记录 ${cid} 无法读取，原文件已保留`);
    }
}

/**
 * 保存指定会话的中转模型桥接记录
 */
export function writeBridgeState(conversationId, state) {
    const cid = resolveConversationId(conversationId);
    const filePath = getBridgeFilePath(cid);
    const previous = readBridgeState(cid);
    if (previous.deletedAt && state.deletedAt !== previous.deletedAt) throw new Error('会话已删除，不能重新保存记录');
    const payload = {
        conversationId: cid,
        updatedAt: Date.now(),
        migratedTo: state.migratedTo || null,
        deletedAt: state.deletedAt || 0,
        exchanges: Array.isArray(state.exchanges) ? state.exchanges : []
    };
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
    return payload;
}

/**
 * 追加一轮中转站 API 对话记录到当前会话桥接存储中（支持持久化用户上传的截图）
 */
export function appendCustomBridgeExchange(conversationId, {
    userPrompt,
    assistantReply,
    reasoning = '',
    latencyMs = 0,
    modelId = '',
    modelName = '',
    protocol = 'openai',
    images = [],
    toolSteps = [],
    completionStatus = 'complete'
}) {
    const cid = resolveConversationId(conversationId);
    const official = readSanitizedOfficialTranscript(cid, 4);
    const state = readBridgeState(cid);

    if (state.deletedAt) throw new Error('会话已删除');

    const exId = `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const savedImages = saveBridgeImages(exId, images);

    const exchange = {
        id: exId,
        createdAt: Date.now(),
        afterOfficialStepIndex: official.maxStepIndex,
        modelId,
        modelName: modelName || modelId,
        protocol,
        userPrompt: sanitizeUserContent(userPrompt) || (savedImages.length > 0 ? '[附带截图]' : ''),
        assistantReply: String(assistantReply || '').trim(),
        reasoning: String(reasoning || '').trim(),
        latencyMs: Number(latencyMs) || 0,
        images: savedImages,
        toolSteps: Array.isArray(toolSteps) ? toolSteps : [],
        completionStatus: completionStatus === 'incomplete' ? 'incomplete' : 'complete',
        syncedToOfficial: false
    };

    state.exchanges.push(exchange);
    writeBridgeState(cid, state);
    return exchange;
}

export function updateCustomBridgeExchange(conversationId, exchangeId, patch = {}) {
    const cid = resolveConversationId(conversationId), state = readBridgeState(cid);
    if (state.deletedAt) throw new Error('会话已删除');
    const exchange = state.exchanges.find(item => item.id === exchangeId);
    if (!exchange) throw new Error('中转记录不存在');
    for (const key of ['assistantReply', 'reasoning', 'toolSteps', 'latencyMs', 'protocol', 'completionStatus', 'error']) {
        if (patch[key] !== undefined) exchange[key] = patch[key];
    }
    writeBridgeState(cid, state);
    return exchange;
}

/**
 * 构建当前会话的“官方模型 + 多个不同中转 API 模型”统一无状态上下文历史
 * 供任何中转模型在同会话中途无缝接力使用（同时支持跨轮次携带最近上传的截图）
 */
export function buildUnifiedConversationHistory(conversationId, {
    maxTurns = 20,
    maxCharsPerTurn = 6000,
    includeImages = true
} = {}) {
    const cid = resolveConversationId(conversationId);
    const official = readSanitizedOfficialTranscript(cid, maxTurns);
    const bridge = readBridgeState(cid);

    if (bridge.deletedAt) return { conversationId: cid, deletedAt: bridge.deletedAt, officialTurnCount: 0, customExchangeCount: 0, unsyncedCustomCount: 0, messages: [], exchanges: [] };

    // 按因果 stepOrder (基于官方 step_index 与 afterOfficialStepIndex) 将官方轮次与中转轮次严格有序融合
    const timeline = [];

    for (const t of official.turns) {
        timeline.push({
            role: t.role,
            content: t.content,
            mediaRefs: t.mediaRefs || [],
            causalOrder: typeof t.stepIndex === 'number' ? t.stepIndex : 0,
            sortTime: t.createdAt || 0,
            source: 'official'
        });
    }

    for (let i = 0; i < bridge.exchanges.length; i++) {
        const ex = bridge.exchanges[i];
        // 跳过没有有效回复的残留空记录
        if (!ex || (!ex.assistantReply && !ex.reasoning)) continue;

        const baseStep = typeof ex.afterOfficialStepIndex === 'number'
            ? ex.afterOfficialStepIndex
            : (official.maxStepIndex >= 0 ? official.maxStepIndex : 0);
        // 保证位于 baseStep 之后、baseStep + 1 之前
        const offset = (i + 1) * 0.001;

        const cleanUserPrompt = sanitizeUserContent(ex.userPrompt);
        const exMediaRefs = Array.isArray(ex.images) ? ex.images : [];
        if (cleanUserPrompt || exMediaRefs.length > 0) {
            timeline.push({
                role: 'user',
                content: cleanUserPrompt || '[附带截图]',
                mediaRefs: exMediaRefs,
                causalOrder: baseStep + offset,
                sortTime: (ex.createdAt || 0) - 1,
                source: `custom:${ex.modelName || ex.modelId}`
            });
        }
        if (ex.assistantReply) {
            let replyForContext = ex.assistantReply;
            if (Array.isArray(ex.toolSteps) && ex.toolSteps.length > 0) {
                const okSteps = ex.toolSteps.filter(s => s && s.ok !== false);
                if (okSteps.length > 0) {
                    const stepDesc = okSteps.map(s => `${s.name}(${s.summary || 'ok'})`).join(', ');
                    replyForContext = `[本轮已调用工具: ${stepDesc}]\n${replyForContext}`;
                }
            }
            if (/返回了\s*`?undefined`?|无法读写文件或连接调试端口/.test(replyForContext)) {
                replyForContext += '\n\n[系统注：以上为旧轮次结果，请实际调用工具验证当前状态，不能据此推断现在不可用。]';
            }
            timeline.push({
                role: 'assistant',
                content: replyForContext,
                mediaRefs: [],
                causalOrder: baseStep + offset + 0.0004,
                sortTime: ex.createdAt || 0,
                source: `custom:${ex.modelName || ex.modelId}`
            });
        }
    }

    timeline.sort((a, b) => {
        if (a.causalOrder !== b.causalOrder) {
            return a.causalOrder - b.causalOrder;
        }
        return (a.sortTime || 0) - (b.sortTime || 0);
    });

    // 截断超长单条消息并合并连续同角色消息，确保 100% 符合 OpenAI / Anthropic 严格交替规范
    const unified = [];
    for (const item of timeline) {
        let content = String(item.content || '').trim();
        const mediaRefs = Array.isArray(item.mediaRefs) ? item.mediaRefs : [];
        if (!content && mediaRefs.length === 0) continue;
        if (maxCharsPerTurn > 0 && content.length > maxCharsPerTurn) {
            content = `${content.slice(0, maxCharsPerTurn)}\n...[上下文已智能裁剪]...`;
        }

        const prev = unified[unified.length - 1];
        if (prev && prev.role === item.role) {
            if (content && !prev.content.includes(content)) {
                prev.content = prev.content ? `${prev.content}\n\n${content}` : content;
            }
            if (mediaRefs.length > 0) {
                prev.mediaRefs.push(...mediaRefs);
            }
        } else {
            unified.push({
                role: item.role,
                content: content || '[附带截图]',
                mediaRefs: [...mediaRefs],
                source: item.source
            });
        }
    }

    const recentUnified = maxTurns > 0 ? unified.slice(-maxTurns) : unified;

    // 为最近包含截图的最多 2 个用户轮次加载 base64 图像数据，使中转模型能够看到本会话中最近发过的截图
    if (includeImages) {
        let loadedTurnCount = 0;
        for (let idx = recentUnified.length - 1; idx >= 0; idx--) {
            const u = recentUnified[idx];
            if (u.role === 'user' && Array.isArray(u.mediaRefs) && u.mediaRefs.length > 0) {
                if (loadedTurnCount < 2) {
                    const loadedImgs = u.mediaRefs
                        .map(ref => loadMediaFileAsImageObj(ref.filePath || ref.uri || ref.dataUrl, ref.mediaType))
                        .filter(Boolean);
                    if (loadedImgs.length > 0) {
                        u.images = loadedImgs;
                        loadedTurnCount++;
                    }
                }
            }
            delete u.mediaRefs;
        }
    } else {
        for (const u of recentUnified) {
            delete u.mediaRefs;
        }
    }

    // 为 exchanges 补充轻量缩略图 dataUrl 以便前端恢复历史对话时显示用户发过的截图
    const hydratedExchanges = bridge.exchanges
        .filter(ex => ex && (ex.assistantReply || ex.reasoning))
        .map(ex => {
            if (Array.isArray(ex.images) && ex.images.length > 0) {
                const hydratedImgs = ex.images
                    .map(img => {
                        const loaded = loadMediaFileAsImageObj(img.filePath || img.dataUrl, img.mediaType);
                        return loaded ? { mediaType: loaded.mediaType, dataUrl: loaded.dataUrl, name: img.name || '' } : null;
                    })
                    .filter(Boolean);
                return { ...ex, images: hydratedImgs };
            }
            return ex;
        });

    const unsyncedCount = hydratedExchanges.filter(e => !e.syncedToOfficial).length;

    return {
        conversationId: cid,
        officialTurnCount: official.turns.length,
        customExchangeCount: hydratedExchanges.length,
        unsyncedCustomCount: unsyncedCount,
        messages: recentUnified,
        exchanges: hydratedExchanges
    };
}

/**
 * 列出所有纯 API 创建的独立本地对话（startpage-* / local-*），供侧边栏展示与切回恢复
 */
export function listLocalCustomSessions() {
    ensureBridgesDir();
    const sessions = [];
    try {
        const files = fs.readdirSync(BRIDGES_DIR);
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const cid = file.slice(0, -5);
            if (!/^(startpage-|local-)/i.test(cid)) continue;
            try {
                const raw = JSON.parse(fs.readFileSync(path.join(BRIDGES_DIR, file), 'utf-8'));
                if (raw.migratedTo || raw.deletedAt) continue;
                const validExchanges = Array.isArray(raw.exchanges)
                    ? raw.exchanges.filter(e => e && (e.assistantReply || e.reasoning))
                    : [];
                if (validExchanges.length === 0) continue;
                if (validExchanges.every(exchange => exchange.syncedToOfficial)) continue;
                const firstPrompt = sanitizeUserContent(validExchanges[0].userPrompt || '') || 'API 新对话';
                const lastModel = validExchanges[validExchanges.length - 1].modelName || validExchanges[validExchanges.length - 1].modelId || 'API';
                sessions.push({
                    conversationId: cid,
                    title: firstPrompt.slice(0, 32),
                    modelName: lastModel,
                    exchangeCount: validExchanges.length,
                    updatedAt: raw.updatedAt || validExchanges[validExchanges.length - 1].createdAt || 0
                });
            } catch {
                // ignore broken session file
            }
        }
    } catch {
        // ignore
    }
    sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return sessions;
}

// Copy first, then record the redirect. Never remove the original conversation file.
export function migrateLocalBridge(sourceId, conversationId) {
    if (!/^(startpage-|local-)[a-zA-Z0-9_-]+$/.test(sourceId || '')) throw new Error('仅允许迁移旧版独立会话');
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(conversationId || '')) throw new Error('目标必须是原生会话 ID');
    const source = readBridgeState(sourceId);
    if (source.deletedAt) throw new Error('会话已删除，不能迁移');
    if (source.migratedTo && readBridgeState(source.migratedTo).deletedAt) throw new Error('目标会话已删除，不能重新迁移');
    if (source.migratedTo && source.migratedTo !== conversationId) return { conversationId: source.migratedTo, migrated: false };
    const target = readBridgeState(conversationId);
    if (target.deletedAt) throw new Error('目标会话已删除');
    for (const exchange of source.exchanges) {
        if (!target.exchanges.some(item => item.id === exchange.id)) {
            target.exchanges.push({ ...exchange, afterOfficialStepIndex: -1, syncedToOfficial: false });
        }
    }
    writeBridgeState(conversationId, target);
    source.migratedTo = conversationId;
    writeBridgeState(sourceId, source);
    return { conversationId, migrated: true, exchangeCount: target.exchanges.length };
}

export function truncateBridge(conversationId, keepIds) {
    if (!Array.isArray(keepIds) || !keepIds.every(id => typeof id === 'string')) throw new Error('保留记录 ID 无效');
    const state = readBridgeState(conversationId);
    if (state.deletedAt) throw new Error('会话已删除');
    const ids = new Set(keepIds);
    state.exchanges = state.exchanges.filter(exchange => ids.has(exchange.id));
    writeBridgeState(conversationId, state);
    return { conversationId, exchangeCount: state.exchanges.length };
}

/**
 * 获取并可选标记消费“尚未同步给谷歌官方模型”的中转 API 对话记录
 * 当用户从【中转 API 模型】切回【Google 官方模型】继续提问时，自动将这些轮次无缝桥接给官方模型
 */
export function consumeUnsyncedCustomTurns(conversationId, { markAsSynced = true } = {}) {
    const cid = resolveConversationId(conversationId);
    readSanitizedOfficialTranscript(cid, 1);
    const state = readBridgeState(cid);
    const unsynced = state.deletedAt ? [] : state.exchanges.filter(e => !e.syncedToOfficial);

    if (unsynced.length === 0) {
        return {
            conversationId: cid,
            count: 0,
            bridgeBlock: '',
            exchanges: []
        };
    }

    const lines = [
        '<!-- ANTIGRAVITY_BRIDGE_SYNC_START -->',
        `[AGY_BRIDGE_RECEIPT:${JSON.stringify({ source: cid, ids: unsynced.map(ex => ex.id) })}]`,
        '[中转模型无缝桥接上下文：以下是刚才在同一对话中通过自定义 API 中转模型进行的对话记录，请结合此上下文直接无缝继续回答下方的新问题]',
        ''
    ];

    for (const ex of unsynced) {
        const tag = ex.modelName || ex.modelId || 'Custom API';
        lines.push(`- **用户**: ${ex.userPrompt}`);
        lines.push(`- **${tag} (中转模型)**: ${ex.assistantReply}`);
        lines.push('');
    }
    lines.push('<!-- ANTIGRAVITY_BRIDGE_SYNC_END -->');

    if (markAsSynced) {
        for (const ex of state.exchanges) {
            ex.syncedToOfficial = true;
        }
        writeBridgeState(cid, state);
    }

    return {
        conversationId: cid,
        count: unsynced.length,
        bridgeBlock: lines.join('\n'),
        exchanges: unsynced
    };
}

/**
 * 清空指定会话的中转桥接缓存
 */
export function clearBridgeState(conversationId) {
    const cid = resolveConversationId(conversationId);
    const filePath = getBridgeFilePath(cid);
    if (readBridgeState(cid).deletedAt) return { ok: true, conversationId: cid };
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
    return { ok: true, conversationId: cid };
}

// Retain the data for recovery, but prevent delayed requests and migration from
// making a conversation visible again after the user has deleted it.
export function deleteBridgeConversation(conversationId) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(conversationId || '') && !/^(startpage-|local-)[a-zA-Z0-9_-]+$/.test(conversationId || '')) throw new Error('删除会话 ID 无效');
    const cid = resolveConversationId(conversationId);
    const state = readBridgeState(cid);
    state.deletedAt ||= Date.now();
    writeBridgeState(cid, state);
    for (const file of fs.readdirSync(BRIDGES_DIR)) {
        if (!/^(startpage-|local-).*\.json$/.test(file)) continue;
        const sourceId = file.slice(0, -5);
        const source = readBridgeState(sourceId);
        if (source.migratedTo !== cid || source.deletedAt) continue;
        source.deletedAt = state.deletedAt;
        writeBridgeState(sourceId, source);
    }
    return { conversationId: cid, deletedAt: state.deletedAt };
}
