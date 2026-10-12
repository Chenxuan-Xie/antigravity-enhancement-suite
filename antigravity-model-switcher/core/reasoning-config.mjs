// Provider effort values, independent of UI labels and saved API credentials.
// Sources: OpenAI reasoning guide, Anthropic effort, DeepSeek thinking mode.
const LABELS = { default: '默认', none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' };

export function reasoningProtocol(model = {}) {
    if (['openai', 'anthropic'].includes(model.protocol)) return model.protocol;
    if (['openai', 'anthropic'].includes(model.resolvedProtocol)) return model.resolvedProtocol;
    return /\/messages\/?$|anthropic\.com/i.test(model.baseUrl || '') ? 'anthropic' : 'openai';
}

export function getReasoningValues(model = {}, protocol = reasoningProtocol(model)) {
    const id = String(model.modelId || '').toLowerCase().replace(/^.*\//, '');
    if (protocol === 'anthropic') {
        if (/^claude-(?:fable|mythos)-(?:5(?:[.-]1)?|preview)(?:-|$)/.test(id) ||
            /^claude-(?:opus|sonnet)-5(?:[.-]5)?(?:-|$)/.test(id) || /^claude-haiku-5[.-]5(?:-|$)/.test(id) ||
            /^claude-opus-4[.-][78](?:-|$)/.test(id)) return ['default', 'low', 'medium', 'high', 'xhigh', 'max'];
        if (/^claude-(?:opus|sonnet)-4[.-]6(?:-|$)/.test(id)) return ['default', 'low', 'medium', 'high', 'max'];
        if (/^claude-opus-4[.-]5(?:-|$)/.test(id)) return ['default', 'low', 'medium', 'high'];
        return [];
    }
    if (/^deepseek-(?:flash|v4-(?:flash|pro))(?:-|$)/.test(id)) return ['default', 'none', 'low', 'high', 'max'];
    if (/^gpt-6(?:[.-]1)?-(?:astra|sol|luna)(?:-|$)/.test(id)) {
        return ['default', ...(/astra|^gpt-6[.-]1-sol/.test(id) ? [] : ['none']), 'low', 'medium', 'high', 'xhigh', 'max'];
    }
    if (/^gpt-5/.test(id) && !/chat/.test(id)) {
        if (/^gpt-5-pro(?:-|$)/.test(id)) return ['default', 'high'];
        if (/^gpt-5[.-][2-5]-pro(?:-|$)/.test(id)) return ['default', 'high', 'xhigh'];
        if (/^gpt-5[.-]6(?:-|$)/.test(id)) return ['default', 'none', 'low', 'medium', 'high', 'xhigh', 'max'];
        if (/^gpt-5[.-][2-5]/.test(id)) return ['default', 'none', 'low', 'medium', 'high', 'xhigh'];
        if (/^gpt-5[.-]1-codex-max(?:-|$)/.test(id)) return ['default', 'low', 'medium', 'high', 'xhigh'];
        if (/^gpt-5[.-]1/.test(id)) return ['default', 'none', 'low', 'medium', 'high'];
        return ['default', 'minimal', 'low', 'medium', 'high'];
    }
    if (/^(?:o1|o3|o4)(?:-|$)/.test(id) && !/preview|pro|deep-research/.test(id)) return ['default', 'low', 'medium', 'high'];
    if (/^gpt-oss-/.test(id)) return ['default', 'low', 'medium', 'high'];
    return [];
}

export function getReasoningOptions(model) {
    return getReasoningValues(model).map(value => ({ value, label: LABELS[value] }));
}

export function resolveReasoningEffort(model, requested = model.reasoningEffort ?? 'default', protocol) {
    const value = String(requested);
    if (value === 'default') return value;
    if (!getReasoningValues(model, protocol).includes(value)) throw new Error('当前模型或协议不支持这个思考强度，请选择默认或其他可用档位');
    return value;
}

export function applyReasoningConfig(body, model, effort, protocol) {
    const value = resolveReasoningEffort(model, effort, protocol);
    if (value === 'default') return body; // Do not alter the relay's existing defaults.
    if (protocol === 'anthropic') {
        body.output_config = { effort: value };
        if (/^claude-opus-4[.-]5(?:-|$)/i.test(model.modelId)) {
            const budget = { low: 1024, medium: 4096, high: 8192 }[value];
            body.thinking = { type: 'enabled', budget_tokens: budget };
            body.max_tokens = Math.max(body.max_tokens, budget + 1024);
        } else {
            body.thinking = { type: 'adaptive' };
        }
        delete body.temperature;
    } else {
        body.reasoning_effort = value;
        if (/^deepseek-/i.test(model.modelId)) body.thinking = { type: value === 'none' ? 'disabled' : 'enabled' };
        if (value !== 'none') delete body.temperature;
    }
    return body;
}
