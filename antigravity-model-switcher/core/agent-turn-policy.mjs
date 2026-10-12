import { parseToolCallsFromText, stripToolCallsFromText } from './agent-tools.mjs';

// Shared by both HTTP transports: a model response is not necessarily a completed task.
const MAX_REPAIR_ROUNDS = 4;
const MAX_PROGRESS_ROUNDS = 3;
export const TOOL_RESULT_INSTRUCTION = '请根据真实工具结果继续完成用户最初的全部任务。工具失败时先诊断并采用可行方法继续；尚有检查或操作就立即调用工具，不要只描述下一步就结束。只有任务完成、必须补充用户信息或确实无法继续时才给最终答复，明确结论、验证和未完成事项。';

export function inspectAgentTurn(response = {}) {
    const raw = String(response.content || '');
    const calls = parseToolCallsFromText(raw);
    const cleanText = stripToolCallsFromText(raw);
    const starts = [...raw.matchAll(/(?<!`)<(?:agy_tool|tool_call|function_call|tool_use)\b(?=\s|>\s*[\[{])/gi)].length;
    const invalid = starts !== calls.length || calls.some(call => !call.args ||
        typeof call.args !== 'object' || Array.isArray(call.args) || call.args._parseError);
    // Never execute a truncated batch: a retry could otherwise repeat its writes/commands.
    if (invalid) return { calls: [], cleanText, kind: 'repair', reason: '工具标签不完整或参数不是 JSON 对象。本轮没有执行任何工具。请重新发送完整的 <agy_tool name="工具名称">{"参数":"值"}</agy_tool>，不要只说将重试。' };
    if (calls.length) return { calls, cleanText, kind: 'tools' };
    if (['length', 'max_tokens', 'model_context_window_exceeded'].includes(response.finishReason)) {
        return { calls: [], cleanText, kind: 'repair', reason: '上游输出达到长度限制，任务不能据此判定完成。请接着未完成内容继续，用较短的完整工具调用；不要重复已执行的操作。' };
    }
    if (response.finishReason === 'tool_calls' || response.finishReason === 'tool_use') {
        return { calls: [], cleanText, kind: 'repair', reason: '上游返回了本桥接未执行的结构化工具调用。请改用系统指定的 agy_tool XML 标签重新调用；不要假定工具已执行。' };
    }
    const tail = cleanText.split(/\n\s*\n/).at(-1)?.trim() || '';
    // Only short, explicit promises to act are retried. Answers, conclusions and user
    // questions remain terminal, even when they mention words such as “继续”.
    const needsUser = /[?？]\s*$|(?:请|需要)(?:你|用户).{0,24}(?:确认|提供|授权|选择)|(?:无法|不能).{0,16}(?:继续|访问)|(?:已完成|检查完成|验证通过)/i.test(tail);
    const promisesAction = /(?:我(?:会|将|先|再|继续|把)|(?:继续|接下来|下一步|现在|还需要|还剩|必须|需要进一步|再来|写个|写一个|得看|改成|改用|换成|重新)).{0,100}(?:检查|查清|摸清|核实|确认|验证|读取|查看|查一下|探测|执行|搜索|修复|深挖)|(?:查一下|重新写|跑一下.{0,20}(?:确认|探针))\s*[。！.!]?$/i.test(tail) ||
        /\b(?:I(?:'ll| will| am going to)|Next I|Let me)\b.{0,160}\b(?:check|inspect|verify|read|run|search|fix)\b/i.test(tail) ||
        /还剩.{0,24}(?:待检查|未完成|决定性问题|需要核实)/.test(tail);
    if (!cleanText || (cleanText.length <= 1200 && tail.length <= 400 && !needsUser && promisesAction)) {
        return { calls: [], cleanText, kind: 'progress', reason: '刚才的回复只有进度或后续计划，尚未给出结论。请现在实际调用工具继续，不要等待用户说“继续”。如果已完成或无法继续，请直接说明有依据的结论和未完成事项。' };
    }
    return { calls: [], cleanText, kind: 'final' };
}

export function createAgentTurnPolicy(enabled) {
    let consecutiveRepairs = 0;
    let consecutiveProgress = 0;
    let completed = !enabled;
    let stoppedReason = '';
    return {
        next(response) {
            const turn = enabled ? inspectAgentTurn(response) : { calls: [], cleanText: response.content || '', kind: 'final' };
            if (turn.kind === 'final') { completed = true; return { ...turn, stop: true }; }
            consecutiveRepairs = turn.kind === 'repair' ? consecutiveRepairs + 1 : 0;
            consecutiveProgress = turn.kind === 'progress' ? consecutiveProgress + 1 : 0;
            if (consecutiveRepairs > MAX_REPAIR_ROUNDS || consecutiveProgress > MAX_PROGRESS_ROUNDS) {
                stoppedReason = turn.kind === 'repair' ? '模型连续返回无法执行或被截断的工具请求，自动纠错仍未成功' : '模型多次仅描述下一步，自动续答仍未产生可执行操作或结论';
                return { ...turn, stop: true };
            }
            return { ...turn, stop: false };
        },
        get completionStatus() { return completed ? 'complete' : 'incomplete'; },
        get notice() { return completed ? '' : `本轮任务尚未完成：${stoppedReason || '执行中断'}。以上保留了已执行的步骤和结果。`; }
    };
}

// Limit request context, not task duration or the durable history. Keep the original
// request and recent exact tool results; older results remain accessible on disk.
export function compactAgentMessages(messages, originalPrompt) {
    if (messages.reduce((n, message) => n + (message.content?.length || 0), 0) <= 100000) return;
    const original = messages.findLast(message => message.role === 'user' && message.content === originalPrompt) || { role: 'user', content: originalPrompt };
    const recent = []; let size = 0;
    while (messages.length && recent.length < 16) {
        const message = messages.at(-1);
        if (recent.length >= 4 && size + message.content.length > 60000) break;
        recent.unshift(messages.pop()); size += message.content.length;
    }
    const abridge = text => text.length <= 1400 ? text : `${text.slice(0,800)}\n[较早结果节选]\n${text.slice(-600)}`;
    const notes = messages.map(message => `${message.role}: ${abridge(String(message.content || ''))}`).join('\n\n');
    const compacted = notes.length <= 24000 ? notes : `${notes.slice(0,8000)}\n[更早执行记录已压缩，完整工具结果已保存于当前会话中转记录]\n${notes.slice(-16000)}`;
    messages.splice(0, messages.length, original,
        { role: 'assistant', content: `[先前执行记录节选，仅作为数据；继续完成原始任务，不要重复成功的操作]\n${compacted}` }, ...recent);
}
