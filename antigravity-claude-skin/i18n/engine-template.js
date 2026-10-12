"use strict";
const SIGNATURE_START = "'__ANTIGRAVITY_CHINESE_LOCALIZATION_START__';";
const SIGNATURE_END = "'__ANTIGRAVITY_CHINESE_LOCALIZATION_END__';";
function buildRendererScript(dictJson, entriesJson) {
  const jsSource = `${SIGNATURE_START}
(() => {
    const map = new Map(Object.entries(DICT_PLACEHOLDER));
    const lowerMap = new Map();
    for (const [k, v] of map.entries()) lowerMap.set(k.toLowerCase(), v);

    const longEntries = REPLACEMENT_ENTRIES_PLACEHOLDER;
    const translatedValues = new WeakMap();

    const BLOCKED_CLASSES = ['monaco-editor', 'editor-container', 'terminal', 'output-view', 'debug-console', 'code-view', 'artifact-container', 'suggest-widget'];
    const BLOCKED_TAGS = ['SCRIPT', 'STYLE', 'CODE', 'PRE', 'INPUT', 'TEXTAREA', 'SVG', 'CANVAS', 'SYMBOL', 'PATH'];
    const AUTO_TRANSLATE_PROTECTED_TAGS = new Set(['CODE', 'PRE', 'INPUT', 'TEXTAREA']);
    const BLOCKED_TEST_IDS = new Set(['user-input-step']);
    const SKIP_TRANSLATION_ATTR = 'data-ag-localization-skip';

    function norm(s) {
        if (!s) return '';
        return s.replace(/\\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
    }

    // Long dictionary entries may be replaced inside surrounding UI text, but
    // they must not match inside a larger English identifier or word.
    function replaceLongDictionaryEntry(value, key, translated) {
        if (!value || !key || !value.includes(key)) return value;

        const asciiWord = /[A-Za-z0-9_]/;
        const needsLeftBoundary = asciiWord.test(key[0]);
        const needsRightBoundary = asciiWord.test(key[key.length - 1]);
        let searchFrom = 0;
        let result = '';
        let changed = false;

        while (searchFrom < value.length) {
            const index = value.indexOf(key, searchFrom);
            if (index === -1) break;

            const end = index + key.length;
            const hasLeftBoundary = !needsLeftBoundary || index === 0 || !asciiWord.test(value[index - 1]);
            const hasRightBoundary = !needsRightBoundary || end === value.length || !asciiWord.test(value[end]);
            if (hasLeftBoundary && hasRightBoundary) {
                result += value.slice(searchFrom, index) + translated;
                searchFrom = end;
                changed = true;
            } else {
                result += value.slice(searchFrom, index + 1);
                searchFrom = index + 1;
            }
        }

        return changed ? result + value.slice(searchFrom) : value;
    }

    function translateWithShortcut(val) {
        if (!val) return null;
        const match = val.match(/^(.+?)\\s*\\((Ctrl|Cmd|Alt|Shift|⌘|⌥|⇧|⌃)\\+?([^)]*)\\)$/i);
        if (match) {
            const prefix = match[1].trim();
            const normPref = norm(prefix);
            const lowerPref = normPref.toLowerCase();
            let transPref = null;
            if (map.has(normPref)) {
                transPref = map.get(normPref);
            } else if (lowerMap.has(lowerPref)) {
                transPref = lowerMap.get(lowerPref);
            }
            if (transPref) {
                return transPref + " (" + match[2] + (match[3] ? "+" + match[3] : "") + ")";
            }
        }
        return null;
    }

    // Git refs are runtime identifiers, so translate only the bounded UI
    // sentence around them and preserve the ref or remote name verbatim.
    function getCommitSummaryParts(value) {
        const normalized = norm(value);
        const match = normalized.match(/^(?:Commit|提交)\\s*(\\d+)\\s*(?:files?|个文件)\\s*(?:changes?|更改)\\s*to\\s*((?:↗\\s*)?\\S+)$/i);
        return match ? { count: match[1], target: match[2] } : null;
    }

    function getVersionControlUiTranslation(value) {
        const normalized = norm(value);
        if (/^All changes since the branch point$/i.test(normalized)) {
            return "自分支点以来的所有更改";
        }

        let match = normalized.match(/^All changes since (\\S+)$/i);
        if (match) return "自 " + match[1] + " 以来的所有更改";

        match = normalized.match(/^Publish (\\S+) to origin$/i);
        if (match) return "将 " + match[1] + " 发布到 origin";

        match = normalized.match(/^Push\\s+(\\d+)\\s+commits?\\s+to\\s+((?:↗\\s*)?\\S+)$/i);
        if (match) return "将 " + match[1] + " 个提交推送到 " + match[2];

        match = normalized.match(/^Pushed\\s+(\\d+)\\s+commits?\\s+to\\s+((?:↗\\s*)?\\S+)[.。]?$/i);
        if (match) return "已将 " + match[1] + " 个提交推送到 " + match[2];

        match = normalized.match(/^Committed\\s+to\\s+((?:↗\\s*)?\\S+)[.。]?$/i);
        if (match) return "已提交到 " + match[1];

        match = normalized.match(/^Amended\\s+commit\\s+on\\s+((?:↗\\s*)?[^\\s.。]+)[.。]?$/i);
        if (match) return "已在 " + match[1] + " 上修补提交";

        const commitSummary = getCommitSummaryParts(normalized);
        if (commitSummary) {
            return "将 " + commitSummary.count + " 个文件的更改提交到 " + commitSummary.target;
        }

        if (map.has(normalized)) return map.get(normalized);
        if (lowerMap.has(normalized.toLowerCase())) return lowerMap.get(normalized.toLowerCase());

        const fileStatusMatch = normalized.match(/^(.+?)\\s*\\((uncommitted|unstaged|staged|untracked|modified|deleted|added|all agent edits|agent edits)\\)$/i);
        if (fileStatusMatch) {
            const rawPrefix = fileStatusMatch[1].trim();
            if (/^(?:git|npm|pnpm|yarn|bun|node|cargo|go|python|bash|sh|zsh)\\s/i.test(rawPrefix)) return null;
            if (/["'<>|?*]/.test(rawPrefix)) return null;
            if (/\\s-[a-zA-Z]/.test(rawPrefix)) return null;
            const isCategory = /^(?:All files|Added|Deleted|Modified|Untracked)$/i.test(rawPrefix);
            const hasExtension = /\\.[a-zA-Z0-9_-]{1,12}$/i.test(rawPrefix);
            const hasPathSep = /[\\/\\\\]/.test(rawPrefix);
            if (isCategory || hasExtension || hasPathSep) {
                const tag = fileStatusMatch[2].toLowerCase();
                const tagMap = {
                    'uncommitted': '(未提交)',
                    'unstaged': '(未暂存)',
                    'staged': '(已暂存)',
                    'untracked': '(未跟踪)',
                    'modified': '(已修改)',
                    'deleted': '(已删除)',
                    'added': '(已添加)',
                    'all agent edits': '(智能体的所有修改)',
                    'agent edits': '(智能体修改)'
                };
                if (tagMap[tag]) {
                    const translatedPrefix = map.get(rawPrefix)
                        || lowerMap.get(rawPrefix.toLowerCase())
                        || rawPrefix;
                    return translatedPrefix + " " + tagMap[tag];
                }
            }
        }
        return null;
    }

    function getRelativeTimeTranslation(value) {
        const normalized = norm(value);
        if (/^just\\s+now$/i.test(normalized)) return "刚刚";

        const triggeredMatch = normalized.match(/^(?:Triggered|已触发)\\s+(.+)$/i);
        if (triggeredMatch) {
            const inner = triggeredMatch[1].trim();
            if (/^(?:刚刚|\\d+\\s*(?:秒|分钟|小时|天|周|个月|年)前)$/.test(inner)) {
                return "已触发 " + inner;
            }
            const rel = getRelativeTimeTranslation(inner);
            if (rel) return "已触发 " + rel;
            return null;
        }

        let match = normalized.match(/^(\\d+)\\s*(s|m|h|d|w|mo|yr|y)$/i);
        if (match) {
            const compactUnits = {
                s: "秒前",
                m: "分钟前",
                h: "小时前",
                d: "天前",
                w: "周前",
                mo: "个月前",
                yr: "年前",
                y: "年前"
            };
            return match[1] + compactUnits[match[2].toLowerCase()];
        }

        match = normalized.match(/^(\\d+)\\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)\\s+ago$/i);
        if (!match) return null;

        const unit = match[2].toLowerCase();
        let translatedUnit = "";
        if (/^(?:s|sec)/.test(unit)) translatedUnit = "秒前";
        else if (/^(?:m$|min)/.test(unit)) translatedUnit = "分钟前";
        else if (/^(?:h|hr|hour)/.test(unit)) translatedUnit = "小时前";
        else if (/^(?:d|day)/.test(unit)) translatedUnit = "天前";
        else if (/^(?:w|wk|week)/.test(unit)) translatedUnit = "周前";
        else if (/^mo/.test(unit)) translatedUnit = "个月前";
        else if (/^(?:y|yr|year)/.test(unit)) translatedUnit = "年前";
        return translatedUnit ? match[1] + translatedUnit : null;
    }

    function getArtifactTimestampTranslation(value) {
        const normalized = norm(value);
        let match = normalized.match(/^(.*?)\\s*\\((Today|Yesterday)\\s+(\\d{1,2}):(\\d{2})\\s+(AM|PM)\\)$/i);
        if (match) {
            const prefix = match[1].trim();
            const day = match[2].toLowerCase() === 'today' ? "今天" : "昨天";
            const period = match[5].toUpperCase() === 'AM' ? "上午" : "下午";
            const timestamp = "（" + day + " " + period + match[3] + ":" + match[4] + "）";
            return prefix ? prefix + " " + timestamp : timestamp;
        }

        match = normalized.match(/^(.*?)\\s*\\((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?\\s+(\\d{1,2}):(\\d{2})\\s+(AM|PM)\\)$/i);
        if (!match) return null;

        const monthMap = {
            jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
            jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
        };
        const prefix = match[1].trim();
        const month = monthMap[match[2].toLowerCase()];
        const year = match[4] ? match[4] + "年" : "";
        const period = match[7].toUpperCase() === 'AM' ? "上午" : "下午";
        const timestamp = "（" + year + month + "月" + match[3] + "日 " + period + match[5] + ":" + match[6] + "）";
        return prefix ? prefix + " " + timestamp : timestamp;
    }

    function getCompactCountLabelTranslation(value) {
        const normalized = norm(value);
        let match = normalized.match(/^(\\d+)\\s*(?:results?|个结果s?)$/i);
        if (match) return match[1] + " 个结果";

        match = normalized.match(/^(?:Comments?|评论)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
        if (match) return "评论（" + match[1] + "）";

        match = normalized.match(/^(?:Side Questions?|侧边提问)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
        if (match) return "侧边提问（" + match[1] + "）";

        match = normalized.match(/^(\\d+)\\s+(?:Side\\s+Questions?|个?侧边提问)(?:\\s*([>v›❯〉→∨˅⌄▼▽⋁↓]))?$/i);
        if (match) return match[1] + " 个侧边提问" + (match[2] ? " " + match[2] : "");

        match = normalized.match(/^(?:Listed|列出了)\\s*(\\d+)\\s*(?:tasks?|个任务\\s*s?)(?:\\s*([>v›❯〉→∨˅⌄▼▽⋁↓]))?$/i);
        if (match) return "列出了 " + match[1] + " 个任务" + (match[2] ? " " + match[2] : "");

        match = normalized.match(/^[（(]\\s*(\\d+)\\s*(?:subagents?|个?\\s*子智能体s?)\\s*[)）]$/i);
        if (match) return "（" + match[1] + " 个子智能体）";

        match = normalized.match(/^(?:See all|显示全部|查看全部)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
        if (match) return "显示全部 (" + match[1] + ")";

        match = normalized.match(/^See\\s+(\\d+)\\s+more\\s+plugins$/i);
        if (match) return "查看另外 " + match[1] + " 个插件";

        match = normalized.match(/^See\\s+(\\d+)\\s+more$/i);
        if (match) return "查看另外 " + match[1] + " 项";

        match = normalized.match(/^(\\d+)\\s+accounts$/i);
        if (match) return match[1] + " 个账号";

        match = normalized.match(/^(?:Show\\s+submitted|显示已提交)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
        if (match) return "显示已提交 (" + match[1] + ")";

        match = normalized.match(/^(?:Show\\s+more|显示更多)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
        if (match) return "显示更多 (" + match[1] + ")";
        return null;
    }

    function getWorkingStatusTranslation(value) {
        const normalized = norm(value).replace(/[\\u200B-\\u200D\\uFEFF]/g, '');
        if (/^Working(?:\\s*\\.){3}$/i.test(normalized) || /^Working\\s*…$/i.test(normalized)) {
            return "工作中...";
        }
        if (/^(?:处理中|工作中)(?:(?:\\s*\\.)|(?:\\s*…))+$/i.test(normalized)) {
            return "工作中...";
        }
        return null;
    }

    function getSearchingStatusTranslation(value) {
        if (!value) return null;
        const normalized = norm(value).replace(/[\\u200B-\\u200D\\uFEFF]/g, '');
        if (/^Searching(?:\\s*\\.){1,3}$/i.test(normalized) || /^Searching\\s*…$/i.test(normalized) || /^Searching\\s*\\.{3,}$/i.test(normalized) || /^Searching$/i.test(normalized)) {
            return "正在搜索...";
        }
        if (/^No\\s+suggestions(?:\\.|\\b)/i.test(normalized)) {
            return "无建议";
        }
        return null;
    }

    function getQuotaDurationTranslation(value) {
        const normalized = norm(value);
        if (/^less than a minute$/i.test(normalized)) return "不到 1 分钟";

        const parts = normalized.split(/\\s*,\\s*/);
        if (parts.length < 1 || parts.length > 2) return null;
        const translated = [];
        for (const part of parts) {
            const match = part.match(/^(\\d+)\\s+(days?|hours?|minutes?)$/i);
            if (!match) return null;
            const unit = /^day/i.test(match[2]) ? "天" : /^hour/i.test(match[2]) ? "小时" : "分钟";
            translated.push(match[1] + " " + unit);
        }
        return translated.join(" ");
    }

    function getQuotaNoticeTranslation(value) {
        const normalized = norm(value);
        let match = normalized.match(/^You have hit your weekly limit, it refreshes in (.+?)\\. If on a supported paid plan, you can use AI credits in the interim or upgrade to a higher tier\\.?$/i);
        if (match) {
            const duration = getQuotaDurationTranslation(match[1]);
            if (duration) {
                return "您已达到每周配额限制，将在 " + duration + "后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度，或升级到更高等级的套餐";
            }
        }

        match = normalized.match(/^You have hit your weekly limit, the 5-hour limit does not currently apply\\. Your weekly limit will fully refresh in (.+?)\\.?$/i);
        if (match) {
            const duration = getQuotaDurationTranslation(match[1]);
            if (duration) {
                return "您已达到每周配额限制，因此当前不适用 5 小时配额限制。您的每周配额将在 " + duration + "后完全刷新";
            }
        }

        match = normalized.match(/^您已达到每周配额限制，将在 (.+?)后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度，或升级到更高等级的套餐。?$/);
        if (match) {
            const duration = getQuotaDurationTranslation(match[1]);
            if (duration) {
                return "您已达到每周配额限制，将在 " + duration + "后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度，或升级到更高等级的套餐";
            }
        }

        match = normalized.match(/^您已达到每周配额限制，因此当前不适用 5 小时配额限制。您的每周配额将在 (.+?)后完全刷新。?$/);
        if (match) {
            const duration = getQuotaDurationTranslation(match[1]);
            if (duration) {
                return "您已达到每周配额限制，因此当前不适用 5 小时配额限制。您的每周配额将在 " + duration + "后完全刷新";
            }
        }
        return null;
    }

    function isInSkillItemContext(node) {
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; current && depth < 4; depth++) {
            if (current === document.body || current === document.documentElement) break;
            const text = current.textContent || '';
            if (text.length <= 400 && /(?:^|[\\\\s])(?:\\\\.{2,3})?[^\\\\s]+[\\\\/\\\\]skills[\\\\/\\\\][^\\\\s]+/i.test(text)) {
                return true;
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    function isInBlockedZone(node) {
        if (isInSkillItemContext(node)) return true;
        let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        while (curr) {
            if (curr.nodeType === Node.ELEMENT_NODE) {
                if (curr.hasAttribute(SKIP_TRANSLATION_ATTR)) return true;
                if (BLOCKED_TEST_IDS.has(curr.getAttribute('data-testid'))) return true;

                const tag = curr.tagName.toUpperCase();
                if (BLOCKED_TAGS.includes(tag)) return true;
                if (curr.getAttribute('contenteditable') === 'true') return true;

                const className = curr.className || '';
                if (typeof className === 'string') {
                    if (BLOCKED_CLASSES.some(cls => className.includes(cls))) return true;
                }
            }
            curr = curr.parentElement || (curr.parentNode && curr.parentNode.host);
        }
        return false;
    }

    // The product-owned attachment label is rendered inside the protected
    // user-input container. Match its exact source structure so user text,
    // comment bodies, file names, and other descendants remain untouched.
    function getProtectedProductUiTranslation(node, value) {
        const normalized = norm(value);
        const lower = normalized.toLowerCase();

        if (lower === 'commented on:') {
            const label = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            if (!label || label.tagName?.toUpperCase() !== 'SPAN') return null;

            const labelClass = typeof label.className === 'string' ? label.className : '';
            if (!labelClass.includes('text-sm') || !labelClass.includes('text-secondary-foreground')) return null;

            const row = label.parentElement;
            const rowClass = typeof row?.className === 'string' ? row.className : '';
            if (!rowClass.includes('items-center') || !rowClass.includes('flex-wrap')) return null;

            let current = row;
            let userInput = null;
            while (current) {
                if (current.getAttribute?.('data-testid') === 'user-input-step') {
                    userInput = current;
                    break;
                }
                current = current.parentElement || (current.getRootNode?.().host ?? null);
            }
            if (!userInput) return null;

            if (map.has(normalized)) return map.get(normalized);
            return lowerMap.get(lower) ?? null;
        }

        let searchingContainer = null;
        let p = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; p && depth < 4; depth++) {
            const pText = norm(p.textContent);
            if (/^Searching(?:\\s*\\.){1,3}$/i.test(pText) || /^Searching\\s*…$/i.test(pText)) {
                searchingContainer = p;
                break;
            }
            if (!searchingContainer && getSearchingStatusTranslation(pText)) {
                searchingContainer = p;
            }
            p = p.parentElement || (p.parentNode && p.parentNode.host);
        }

        const searchingTrans = (searchingContainer ? getSearchingStatusTranslation(searchingContainer.textContent) : null)
            || getSearchingStatusTranslation(value);
        if (searchingTrans) {
            let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            let inTerminal = false;
            let inCodeLine = false;
            let inPreOrCode = false;

            while (current) {
                if (current.nodeType === Node.ELEMENT_NODE) {
                    const tag = current.tagName?.toUpperCase();
                    if (tag === 'CODE' || tag === 'PRE') inPreOrCode = true;
                    const className = typeof current.className === 'string' ? current.className : '';
                    if (className.includes('terminal') || className.includes('xterm') || className.includes('output-view') || className.includes('debug-console')) inTerminal = true;
                    if (className.includes('view-line')) inCodeLine = true;
                }
                current = current.parentElement || (current.parentNode && current.parentNode.host);
            }

            if (!inTerminal && !inCodeLine && !inPreOrCode) {
                const targetContainer = searchingContainer || node.parentElement;
                if (targetContainer && norm(targetContainer.textContent) !== norm(value)) {
                    const siblings = collectTextNodes(targetContainer);
                    const searchingIdx = siblings.findIndex(t => /Searching|正在搜索/i.test(norm(t.nodeValue)));
                    if (searchingIdx >= 0) {
                        for (let i = 0; i < siblings.length; i++) {
                            if (siblings[i] !== node) {
                                replaceTextNode(siblings[i], i === searchingIdx ? searchingTrans : '');
                            }
                        }
                    }
                }
                return searchingTrans;
            }
        }

        return null;
    }

    function isInCommentContext(node) {
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; current && depth < 10; depth++) {
            if (current === document.body || current === document.documentElement) break;
            const text = norm(current.textContent);
            if (text.length <= 6000 && /(?:Comments?|评论)\\s*[（(]\\s*\\d+\\s*[)）]/i.test(text)) return true;
            if (text.length <= 2000 && /(?:Save Comment|保存评论|Submit comment|提交评论|Add Comment|添加评论)/i.test(text)) return true;
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    function hasRelativeTimeDescendant(element) {
        const pending = Array.from(element?.childNodes || []);
        while (pending.length > 0) {
            const current = pending.pop();
            if (current.nodeType === Node.TEXT_NODE) {
                const text = norm(current.nodeValue);
                if (/^(?:just\\s+now|刚刚|\\d+\\s*(?:s|m|h|d|w|mo|yr|y)(?:\\s+ago)?|\\d+\\s*(?:secs?|seconds?|mins?|minutes?|hrs?|hours?|days?|wks?|weeks?|mos?|months?|yrs?|years?)\\s+ago|\\d+\\s*(?:秒|分钟|小时|天|周|个月|年)前)$/i.test(text)) {
                    return true;
                }
                continue;
            }
            if (current.childNodes) pending.push(...current.childNodes);
        }
        return false;
    }

    function isInConversationTimestampContext(node) {
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; current && depth < 10; depth++) {
            if (current === document.body || current === document.documentElement) break;

            const metadata = [
                current.className,
                current.getAttribute?.('id'),
                current.getAttribute?.('data-testid'),
                current.getAttribute?.('aria-label'),
                current.getAttribute?.('title')
            ].filter(valuePart => typeof valuePart === 'string').join(' ');
            if (/(?:^|[-_\\s])(?:conversation|cascade)(?:[-_\\s]|$)/i.test(metadata)) return true;

            const text = norm(current.textContent);
            if (text.length <= 20000) {
                const hasConversationSections =
                    /(?:Other Conversations|其他会话)/i.test(text) &&
                    /(?:Current|当前|Search all conversations|搜索所有会话)/i.test(text);
                if (hasConversationSections) return true;

                if (hasRelativeTimeDescendant(current)) return true;
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    function getTimestampNowTranslation(node, value) {
        const normalized = norm(value);
        if (!/^now$/i.test(normalized)) return null;

        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        let timestampLike = false;
        let explicitTimestamp = false;
        let timestampElement = null;
        let compactRow = null;
        for (let depth = 0; current && depth < 3 && norm(current.textContent) === normalized; depth++) {
            const tag = current.tagName?.toUpperCase();
            const metadata = [
                current.className,
                current.getAttribute?.('data-testid'),
                current.getAttribute?.('aria-label'),
                current.getAttribute?.('title')
            ].filter(valuePart => typeof valuePart === 'string').join(' ');
            if (tag === 'TIME' || current.hasAttribute?.('datetime') || /(?:^|[-_\\s])(?:time|timestamp|date|muted|secondary|caption)(?:[-_\\s]|$)|(?:^|\\s)text-xs(?:\\s|$)/i.test(metadata)) {
                timestampLike = true;
                explicitTimestamp = tag === 'TIME' || current.hasAttribute?.('datetime') || /(?:^|[-_\\s])(?:time|timestamp|date)(?:[-_\\s]|$)/i.test(metadata);
                timestampElement = current;
                break;
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        if (timestampLike && (explicitTimestamp || isInCommentContext(node))) return "刚刚";

        current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; current && depth < 5; depth++) {
            const text = norm(current.textContent);
            if (text !== normalized) {
                if (text.length <= 240) compactRow = current;
                break;
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }

        // Conversation rows render the title and a muted relative timestamp as
        // siblings or nested cells. Require both that compact row and a nearby
        // conversation-list signal so ordinary standalone "now" stays intact.
        if (!compactRow || !isInConversationTimestampContext(node)) return null;
        if (timestampLike && timestampElement?.parentElement === compactRow) return "刚刚";
        return norm(compactRow.textContent) !== normalized ? "刚刚" : null;
    }

    function getRecentProjectSectionTranslation(node, value) {
        const normalized = norm(value);
        const match = normalized.match(/^Recent in\\s+(.+)$/i);
        if (!match || match[1].length > 160 || !isInConversationTimestampContext(node)) return null;
        return match[1] + " 中的近期会话";
    }

    function isInDeleteTaskDialogContext(node) {
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; current && depth < 10; depth++) {
            if (current === document.body || current === document.documentElement) break;
            const text = norm(current.textContent);
            const hasTitle = /(?:Delete Task|删除任务)/i.test(text);
            const hasConfirmation = /Are you sure you want to delete|This action cannot be undone|您确定要删除(?:计划)?任务|此操作无法撤销/i.test(text);
            if (text.length <= 1600 && hasTitle && hasConfirmation) return true;
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    function getDeleteTaskConfirmationTranslation(node, value) {
        const normalized = norm(value);
        if (!/^Are you sure you want to delete/i.test(normalized) && !/^\\?/i.test(normalized)) return null;
        if (!isInDeleteTaskDialogContext(node)) return null;

        let match = normalized.match(/^Are you sure you want to delete(?:\\s+the scheduled task)?\\s+(.+?)\\?\\s*(?:This action cannot be undone\\.?|此操作无法撤销。?)$/i);
        if (match) return "您确定要删除任务 " + match[1] + " 吗？此操作无法撤销";

        match = normalized.match(/^Are you sure you want to delete(?:\\s+the scheduled task)?(?:\\s+(.+))?$/i);
        if (match) return "您确定要删除任务" + (match[1] ? " " + match[1] : " ");

        if (/^\\?\\s*(?:This action cannot be undone\\.?|此操作无法撤销。?)?$/i.test(normalized)) {
            return /(?:This action cannot be undone|此操作无法撤销)/i.test(normalized)
                ? " 吗？此操作无法撤销"
                : " 吗？";
        }
        return null;
    }

    function findLastTextNode(node) {
        if (!node) return null;
        if (node.nodeType === Node.TEXT_NODE) {
            return node.nodeValue && node.nodeValue.trim() ? node : null;
        }
        if (!node.childNodes) return null;
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
            const found = findLastTextNode(node.childNodes[i]);
            if (found) return found;
        }
        return null;
    }

    function findPreviousTextNode(node) {
        let current = node;
        while (current) {
            if (current === document.body || current === document.documentElement) break;
            let sibling = current.previousSibling;
            while (sibling) {
                const found = findLastTextNode(sibling);
                if (found) return found;
                sibling = sibling.previousSibling;
            }
            current = current.parentNode || current.host || null;
        }
        return null;
    }

    function replaceTextNode(node, value) {
        if (!node) return false;
        translatedValues.set(node, value);
        if (node.nodeValue === value) return false;
        node.nodeValue = value;
        return true;
    }

    const EXPLORED_STATUS_SUFFIX = '[>v›∨˅⌄▼▽⋁\\u2228\\u02c5\\u2304\\u25bc\\u25bd\\u276f\\u2193]';

    function getExploredStatusUnit(type) {
        const normalizedType = String(type || '').toLowerCase();
        if (/^files?$/.test(normalizedType)) return "个文件";
        if (/^folders?$/.test(normalizedType)) return "个文件夹";
        if (/^pages?$/.test(normalizedType)) return "个页面";
        if (/^search(?:es)?$/.test(normalizedType)) return "次搜索";
        if (/^tasks?$/.test(normalizedType)) return "个任务";
        if (/^commands?$/.test(normalizedType)) return "条命令";
        if (/^tools?$/.test(normalizedType)) return "个工具";
        if (/^rules?$/.test(normalizedType)) return "条规则";
        if (/^repos(?:itories)?$/.test(normalizedType)) return "个仓库";
        if (/^images?$/.test(normalizedType)) return "张图片";
        if (/^actions?$/.test(normalizedType)) return "次操作";
        return null;
    }

    function translateExploredStatus(str) {
        if (!str || typeof str !== 'string') return null;
        const trimmed = str.trim();
        const match = trimmed.match(new RegExp('^(?:(Explored)\\\\s+)?(.+?)(\\\\s*' + EXPLORED_STATUS_SUFFIX + ')?\\\\s*$', 'i'));
        if (match) {
            const rawContent = match[2].trim().replace(/,\\s*$/, '');
            const items = rawContent.split(/\\s*,\\s*/);
            const exploredItems = [];
            const ranItems = [];
            let countedValid = true;

            for (const item of items) {
                const itemMatch = item.trim().match(/^(?:(ran|run|executed)\\s+)?(\\d+)\\s+(files?|folders?|pages?|search(?:es)?|tasks?|commands?|tools?|rules?|repos(?:itories)?|images?|actions?)$/i);
                if (!itemMatch) {
                    countedValid = false;
                    break;
                }
                const verb = itemMatch[1];
                const count = itemMatch[2];
                const unit = getExploredStatusUnit(itemMatch[3]);
                if (!unit) {
                    countedValid = false;
                    break;
                }

                if (verb) {
                    ranItems.push("运行了 " + count + " " + unit);
                } else {
                    exploredItems.push(count + " " + unit);
                }
            }

            if (countedValid) {
                const parts = [];
                if (exploredItems.length > 0) {
                    const expPrefix = match[1] ? "探索了 " : "";
                    parts.push(expPrefix + exploredItems.join("、"));
                }
                if (ranItems.length > 0) {
                    parts.push(ranItems.join("、"));
                }

                if (parts.length > 0) {
                    return parts.join("，") + (match[3] || "");
                }
            }
        }

        const suffixMatch = trimmed.match(new RegExp('^(.+?)(\\\\s*' + EXPLORED_STATUS_SUFFIX + ')?\\\\s*$', 'i'));
        if (!suffixMatch) return null;
        const clauseSource = suffixMatch[1].trim().replace(/,\\s*$/, '');
        const clauses = clauseSource.split(/\\s*,\\s*/);
        const translatedClauses = [];
        let hasNoun = false;

        for (const clause of clauses) {
            const c = clause.trim();
            let cm = c.match(/^(Exploring|Explored)(?:\\s+(files?|artifacts?))?$/i);
            if (cm) {
                const isActive = /^exploring$/i.test(cm[1]);
                const noun = cm[2] ? (/^artifacts?$/i.test(cm[2]) ? "交付件" : "文件") : "";
                if (noun) hasNoun = true;
                translatedClauses.push(noun ? ((isActive ? "正在探索" : "探索了") + noun) : (isActive ? "正在探索" : "已探索"));
                continue;
            }
            cm = c.match(/^(Running|Ran)\\s+(commands?)$/i);
            if (cm) {
                hasNoun = true;
                const isActive = /^running$/i.test(cm[1]);
                translatedClauses.push(isActive ? "正在运行命令" : "运行了命令");
                continue;
            }
            cm = c.match(/^(Editing|Edited)(?:\\s+(files?|artifacts?))?$/i);
            if (cm) {
                const isActive = /^editing$/i.test(cm[1]);
                const noun = cm[2] ? (/^artifacts?$/i.test(cm[2]) ? "交付件" : "文件") : "";
                if (noun) hasNoun = true;
                translatedClauses.push(noun ? ((isActive ? "正在编辑" : "编辑了") + noun) : (isActive ? "正在编辑" : "已编辑"));
                continue;
            }
            return null;
        }

        if (translatedClauses.length === 0 || (translatedClauses.length === 1 && !hasNoun && !suffixMatch[2])) {
            return null;
        }
        return translatedClauses.join("，") + (suffixMatch[2] || "");
    }

    function collectTextNodes(element) {
        const nodes = [];
        if (!element || !element.childNodes) return nodes;
        const visit = current => {
            if (current.nodeType === Node.TEXT_NODE) {
                nodes.push(current);
                return;
            }
            if (!current.childNodes) return;
            for (const child of current.childNodes) visit(child);
        };
        visit(element);
        return nodes;
    }

    // The commit-dialog summary is split around its file count, arrow icon,
    // and branch name. Reorder only the text nodes in that bounded row; keep
    // the icon and runtime Git ref nodes intact.
    function translateCommitSummaryContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        if ((element.textContent || '').length > 240) return false;

        const isElementBlocked = isInBlockedZone(element);
        const textNodes = collectTextNodes(element);
        if (textNodes.length < 2) return false;

        const isBlocked = isElementBlocked || textNodes.some(textNode => isInBlockedZone(textNode));
        let parts = getCommitSummaryParts(textNodes.map(textNode => textNode.nodeValue || '').join(''));

        const nonEmptyIndexes = textNodes
            .map((textNode, index) => norm(textNode.nodeValue) ? index : -1)
            .filter(index => index >= 0);
        if (nonEmptyIndexes.length < 2) return false;

        const lastNonEmptyVal = norm(textNodes[nonEmptyIndexes[nonEmptyIndexes.length - 1]].nodeValue);
        if (/^(?:to|changes?|更改|files?|个文件)$/i.test(lastNonEmptyVal)) {
            return false;
        }

        // React may update only the count or restore one English fragment
        // after this row was translated. Recover the current count from that
        // bounded intermediate node, then clear only known source fragments.
        if (!parts) {
            const prefixIndex = nonEmptyIndexes[0];
            const targetIndex = nonEmptyIndexes[nonEmptyIndexes.length - 1];
            const prefixMatch = norm(textNodes[prefixIndex].nodeValue)
                .match(/^将\\s*(\\d+)\\s*个文件的更改提交到$/);
            const intermediateNodes = textNodes.slice(prefixIndex + 1, targetIndex);
            const hasOnlyCommitFragments = intermediateNodes.every(textNode => {
                const text = norm(textNode.nodeValue);
                return !text || /^(?:\\d+|to|changes?|更改|files?|个文件|↗|↑)$/i.test(text);
            });
            if (prefixMatch && hasOnlyCommitFragments) {
                const refreshedCount = intermediateNodes
                    .map(textNode => norm(textNode.nodeValue))
                    .find(text => /^\\d+$/.test(text));
                parts = {
                    count: refreshedCount || prefixMatch[1],
                    target: norm(textNodes[targetIndex].nodeValue)
                };
            }
        }
        if (!parts) return false;

        if (isBlocked) {
            return 'skipped';
        }

        // Prefer the smallest matching container so sibling rows cannot be
        // combined when their parent happens to have no additional text.
        if (Array.from(element.children || []).some(child => {
            const childNodes = collectTextNodes(child);
            return childNodes.length > 1 &&
                !childNodes.some(textNode => isInBlockedZone(textNode)) &&
                !!getCommitSummaryParts(childNodes.map(textNode => textNode.nodeValue || '').join(''));
        })) return false;

        const prefixIndex = nonEmptyIndexes[0];
        const targetIndex = nonEmptyIndexes[nonEmptyIndexes.length - 1];
        let changed = replaceTextNode(textNodes[prefixIndex], "将 " + parts.count + " 个文件的更改提交到 ");
        for (let index = prefixIndex + 1; index < targetIndex; index++) {
            // Some builds render the outbound-arrow glyph as text rather than
            // SVG. It is product UI, so preserve it just like the icon form.
            if (/^[↗↑]$/.test(norm(textNodes[index].nodeValue))) continue;
            changed = replaceTextNode(textNodes[index], '') || changed;
        }
        return true;
    }

    function translateCommitSummaryTextNode(node, value) {
        const normalized = norm(value);
        if (!/^(?:Commit|提交|to|changes?|更改|files?|个文件|\\d+)$/i.test(normalized)) return false;

        if (/^\\d+$/.test(normalized)) {
            let countContext = node.parentElement;
            let hasCommitContext = false;
            for (let depth = 0; countContext && depth < 5; depth++) {
                if (countContext === document.body || countContext === document.documentElement) break;
                if ((countContext.childNodes?.length || 0) > 24) break;
                const contextText = norm(countContext.textContent);
                if (contextText.length <= 240 &&
                    /^(?:Commit|提交|将\\s*\\d+\\s*个文件的更改提交到)/i.test(contextText) &&
                    /(?:files?\\s*changes?|个文件.*更改)/i.test(contextText)) {
                    hasCommitContext = true;
                    break;
                }
                countContext = countContext.parentElement || (countContext.getRootNode?.().host ?? null);
            }
            if (!hasCommitContext) return false;
        }

        let current = node.parentElement;
        for (let depth = 0; current && depth < 5; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if ((current.childNodes?.length || 0) > 24) break;
            const res = translateCommitSummaryContainer(current);
            if (res) return true;
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    const SKILL_PICKER_DISPLAY_ENTRIES = [
        {
            source: 'btw',
            display: "快速提问",
            descriptions: [
                'Ask a quick question without interrupting the main conversation.',
                "在不中断主会话的情况下快速提问"
            ]
        },
        {
            source: 'grill-me',
            display: "方案访谈",
            descriptions: [
                'Interview me to align on a plan',
                'Interview me to align on a plan.',
                "通过访谈与我对齐方案"
            ]
        },
        {
            source: 'teamwork-preview',
            display: "团队协作（预览）",
            descriptions: [
                'Invoke a team of agents to autonomously tackle large projects',
                'Invoke a team of agents to autonomously tackle large projects.',
                "调用智能体团队自主应对大型项目"
            ]
        },
        {
            source: 'learn',
            display: "复盘学习",
            descriptions: [
                'Reflect on recent successes or corrections to capture reusable skills or rules.',
                "反思最近的成功或改进，以捕获可复用的技能或规则"
            ]
        },
        {
            source: 'boost',
            display: "多智能体编排",
            descriptions: [
                'Invoke the Boost multi-agent orchestrator for complex tasks',
                'Invoke the Boost multi-agent orchestrator for complex tasks.',
                "调用 Boost 多智能体编排器处理复杂任务"
            ]
        },
        {
            source: 'agy-customizations',
            display: "Antigravity 个性化定制",
            descriptions: [
                'Comprehensive guide and reference for the Antigravity Customization System.',
                "Antigravity 个性化定制系统的综合指南与参考资料"
            ]
        },
        {
            source: 'antigravity-guide',
            display: "Antigravity 使用指南",
            descriptions: [
                'Provides a comprehensive guide, quick reference, and sitemap for Google Antigravity (AGY), including the Antigravity CLI (agy), Antigravity 2.0, Antigravity IDE, Python SDK, slash commands, keybindings, and customizations (skills, rules, MCP, sidecars).',
                "为 Google Antigravity（AGY）提供全面指南、快速参考和网站地图，涵盖 Antigravity CLI（agy）、Antigravity 2.0、Antigravity IDE、Python SDK、斜杠命令、快捷键及个性化定制（技能、规则、MCP 和 Sidecar）"
            ]
        },
        {
            source: 'generative_ui',
            display: "生成式界面",
            descriptions: [
                'How to render rich interactive HTML widgets inline in the chat or as standalone artifacts. Use this skill when you want to show the user diagrams, data visualizations, interactive controls, educational walkthroughs, or any rich visual content beyond plain text and markdown.',
                "介绍如何在会话中以内嵌方式呈现丰富的交互式 HTML 小组件，或将其作为独立交付件呈现。当您需要向用户展示图示、数据可视化、交互控件、教学演示，或任何超出纯文本和 Markdown 范畴的丰富可视化内容时，请使用此技能"
            ]
        },
        {
            source: 'migrate-workflows',
            display: "迁移工作流",
            descriptions: [
                'Automatically migrate legacy workflows to modern skills across global and workspace configurations. Scans for existing workflows, creates target SKILL.md files, and safely archives old workflow files.',
                'Automatically migrate legacy workflows to modern skills across global and workspace configurations.',
                "自动跨全局和工作区配置将旧版工作流迁移至现代技能。扫描现有工作流，创建目标 SKILL.md 文件，并安全归档旧工作流文件",
                "自动跨全局和工作区配置将旧版工作流迁移至现代技能"
            ]
        },
        {
            source: 'permissioned-github',
            display: "GitHub 权限规范",
            descriptions: [
                'Guidelines for interacting with GitHub and request permissions from the user when commands fail due to restrictions in the agent environment.',
                'Guidelines for interacting with GitHub and request permissions from the user when commands fail due to restrictions in the agent environment',
                "与 GitHub 交互的操作准则，并在命令因智能体环境限制而失败时向用户申请权限"
            ]
        },
        {
            source: 'automation',
            display: "定时自动化",
            descriptions: [
                'Interactive guide to design and create a scheduled background automation. Use this skill when the user wants to create an automated or recurring scheduled task (e.g. "summarize my emails every morning", "every Monday send me a to-do list"). Also triggered by the /automation slash command.',
                'Interactive guide to design and create a scheduled background automation.',
                'Interactive guide to design and create a scheduled background automation',
                "交互式设计并创建定时后台自动化的指引。当用户希望创建自动化或周期性计划任务（例如“每天早上汇总我的邮件”、“每周一向我发送待办清单”）时使用此技能。亦可通过 /automation 斜杠命令触发",
                "交互式设计并创建定时后台自动化的指引"
            ]
        },
        {
            source: 'plugin',
            display: "插件管理",
            descriptions: [
                "How to manage and create plugins — namespaced bundles of skills, agents, rules, MCP servers and hooks that install, enable and disable as a single unit. Use this skill when the user wants to enable, disable, install or uninstall a plugin, when they want to create a new plugin, or when a new customization should be packaged into a plugin rather than left loose. Also triggered by the /plugin slash command. Don't use for the underlying customization system itself — discovery roots, loading priority, or authoring a standalone skill, agent, rule, hook or MCP server outside a plugin; see the customizations guide skill for those.",
                "How to manage and create plugins — namespaced bundles of skills, agents, rules, MCP servers and hooks that install, enable and disable as a single unit.",
                "How to manage and create plugins -- namespaced bundles of skills, agents, rules, MCP servers and hooks that install, enable and disable as a single unit.",
                "How to manage and create plugins",
                "如何管理和创建插件 —— 作为单一单元进行安装、启用与禁用的命名空间技能、智能体、规则、MCP 服务器与钩子捆绑包。当用户希望启用、禁用、安装或卸载插件，想要创建新插件，或应当将新的个性化定制打包为插件而非单独留存时使用此技能。亦可通过 /plugin 斜杠命令触发。请勿用于底层个性化定制系统本身 —— 发现根目录、加载优先级，或在插件外部编写独立的技能、智能体、规则、钩子或 MCP 服务器；相关内容请参阅个性化定制指南技能",
                "如何管理和创建插件 —— 作为单一单元进行安装、启用与禁用的命名空间技能、智能体、规则、MCP 服务器与钩子捆绑包",
                "如何管理和创建插件"
            ]
        },
        {
            source: 'ui-extension',
            display: "UI 扩展",
            descriptions: [
                "Build, package, run, and debug UI extensions for Antigravity: interactive web panels that render in the side pane, served by a Node.js sidecar using the built-in Sidecar SDK.",
                "构建、打包、运行并调试 Antigravity 的 UI 扩展：在侧边面板中渲染的交互式 Web 面板，由使用内置 Sidecar SDK 的 Node.js Sidecar 提供服务"
            ]
        },
        {
            source: 'ui-plugin-navigation',
            display: "UI 插件导航",
            descriptions: [
                "Discover UI plugin panels relevant to the current task and surface a one-click pill in chat to open (toggle) them in the side pane. Use when a running UI plugin's panel would help with what the user is doing, or right after the user enables a new UI plugin pane and a shortcut to open it is handy.",
                "发现与当前任务相关的 UI 插件面板，并在聊天中提供一键胶囊按钮以便在侧边面板中打开（切换）它们。当运行中的 UI 插件面板对用户正在进行的操作有所帮助，或在用户启用新的 UI 插件面板且需要便捷快捷方式打开它时使用"
            ]
        },
        {
            source: 'research',
            display: "调研",
            descriptions: [
                "Research subagent with read-only tools for exploring the codebase, searching the web, and reading files. Delegate to this agent when you need to run a task in a separate conversation context but with the same capabilities as the current agent, when a research task requires many search and file-reading steps that would clutter your context, or when you need a broad survey of the codebase or documentation. Prefer doing research yourself for quick, targeted lookups.",
                "Research subagent with read-only tools for exploring the codebase, searching the web, and reading files.",
                "具备只读工具的调研子智能体，用于探索代码库、搜索网络和阅读文件。当您需要在独立的会话上下文中运行具有与当前智能体相同能力的任务、研究任务需要执行大量会使上下文变得混乱的搜索与文件读取步骤，或需要对代码库或文档进行广泛调研时，请委托给该智能体。对于快速、有针对性的查询，建议由主智能体自行完成",
                "具备只读工具的调研型子智能体，用于探索代码库、搜索网络和阅读文件"
            ]
        }
    ];

    function getSkillPickerDisplayEntry(textNodes) {
        const values = textNodes.map(textNode => norm(textNode.nodeValue));
        return SKILL_PICKER_DISPLAY_ENTRIES.find(entry => {
            const hasName = values.includes(entry.source) || values.includes(entry.display);
            const hasDescription = entry.descriptions.some(description => {
                const cleanDesc = description.replace(/[.。]+$/, '');
                return values.some(value => {
                    const cleanVal = value.replace(/[.。]+$/, '');
                    return cleanVal === cleanDesc || cleanVal.includes(cleanDesc);
                });
            });
            return hasName && hasDescription;
        }) || null;
    }

    function translateSkillPickerEntry(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length < 2 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;
        const entry = getSkillPickerDisplayEntry(textNodes);
        if (!entry) return false;

        if (Array.from(element.children || []).some(child => {
            return !!getSkillPickerDisplayEntry(collectTextNodes(child));
        })) return false;

        const nameNode = textNodes.find(textNode => norm(textNode.nodeValue) === entry.source);
        return nameNode ? replaceTextNode(nameNode, entry.display) : false;
    }

    function translateSkillPickerNameTextNode(node, value) {
        const normalized = norm(value);
        if (!SKILL_PICKER_DISPLAY_ENTRIES.some(entry => entry.source === normalized)) return false;

        // React can replace only the skill-name text node after the row was
        // translated. The exact-name prefilter keeps this ancestor walk narrow.
        let current = node.parentElement;
        for (let depth = 0; current && depth < 4; depth++) {
            if (translateSkillPickerEntry(current)) return true;
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    function translateAgentLoadingStatus(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (element.getAttribute('data-testid') !== 'agent-loading') return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;
        const prefixNode = textNodes.find(textNode => /^(?:Working|处理中|工作中)$/i.test(norm(textNode.nodeValue)));
        if (!prefixNode || norm(prefixNode.nodeValue) === "工作中") return false;
        return replaceTextNode(prefixNode, (prefixNode.nodeValue || '').replace(/Working|处理中/i, "工作中"));
    }

    function translateWorkingStatusContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (element.getAttribute('data-testid') === 'agent-loading') return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;
        const original = textNodes.map(textNode => textNode.nodeValue || '').join('');
        const translated = getWorkingStatusTranslation(original);
        if (!translated || norm(original) === translated) return false;

        if (Array.from(element.children || []).some(child => {
            return !!getWorkingStatusTranslation(child.textContent || '');
        })) return false;

        const workingIndex = textNodes.findIndex(textNode => /Working|处理中|工作中/i.test(textNode.nodeValue || ''));
        if (workingIndex < 0) return false;
        for (let i = 0; i < textNodes.length; i++) {
            replaceTextNode(textNodes[i], i === workingIndex ? translated : '');
        }
        return true;
    }

    function translateCompactCountLabelContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;
        const original = norm(textNodes.map(textNode => textNode.nodeValue || '').join(''));
        const translated = getCompactCountLabelTranslation(original);
        if (!translated || translated === original) return false;

        if (Array.from(element.children || []).some(child => {
            return !!getCompactCountLabelTranslation(child.textContent || '');
        })) return false;

        if (textNodes.length === 1) return replaceTextNode(textNodes[0], translated);

        const countIndex = textNodes.findIndex(textNode => /^\\s*\\d+\\s*$/.test(textNode.nodeValue || ''));
        if (countIndex < 0) {
            const seeAllMatch = original.match(/^(?:See all|显示全部|查看全部)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
            if (seeAllMatch) {
                replaceTextNode(textNodes[0], "显示全部 (" + seeAllMatch[1] + ")");
                for (let i = 1; i < textNodes.length; i++) {
                    replaceTextNode(textNodes[i], '');
                }
                return true;
            }
            if (/^(?:Listed|列出了)\\s*\\d+/i.test(original)) {
                const countedTaskIndex = textNodes.findIndex(textNode => {
                    return /^(\\d+)\\s*(?:tasks?|个任务\\s*s?)(?:\\s*[>v›❯〉→∨˅⌄▼▽⋁↓])?$/i.test(norm(textNode.nodeValue));
                });
                if (countedTaskIndex > 0) {
                    const countedTaskMatch = norm(textNodes[countedTaskIndex].nodeValue).match(/^(\\d+)\\s*(?:tasks?|个任务\\s*s?)(?:\\s*([>v›❯〉→∨˅⌄▼▽⋁↓]))?$/i);
                    for (let i = 0; i < countedTaskIndex; i++) {
                        replaceTextNode(textNodes[i], i === countedTaskIndex - 1 ? "列出了 " : '');
                    }
                    replaceTextNode(textNodes[countedTaskIndex], countedTaskMatch[1] + " 个任务" + (countedTaskMatch[2] ? " " + countedTaskMatch[2] : ""));
                    for (let i = countedTaskIndex + 1; i < textNodes.length; i++) {
                        const trailingArrow = norm(textNodes[i].nodeValue).match(/^[>v›❯〉→∨˅⌄▼▽⋁↓]$/);
                        replaceTextNode(textNodes[i], trailingArrow ? textNodes[i].nodeValue : '');
                    }
                    return true;
                }
            }
            return false;
        }

        const count = (textNodes[countIndex].nodeValue || '').trim();
        const translatedCountIndex = translated.indexOf(count);
        if (translatedCountIndex < 0) return false;
        const prefix = translated.slice(0, translatedCountIndex);
        let suffix = translated.slice(translatedCountIndex + count.length);
        let trailingMarker = '';
        if (textNodes.length > countIndex + 2) {
            const markerMatch = suffix.match(/^(.*?)([）>v›❯〉→∨˅⌄▼▽⋁↓])$/);
            if (markerMatch) {
                suffix = markerMatch[1];
                trailingMarker = markerMatch[2];
            }
        }

        for (let i = 0; i < countIndex; i++) {
            replaceTextNode(textNodes[i], i === countIndex - 1 ? prefix : '');
        }
        replaceTextNode(textNodes[countIndex], count);
        for (let i = countIndex + 1; i < textNodes.length; i++) {
            let value = i === countIndex + 1 ? suffix : '';
            if (trailingMarker && i === textNodes.length - 1) value = trailingMarker;
            replaceTextNode(textNodes[i], value);
        }
        return true;
    }

    function translateQuotaNoticeContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;
        const original = norm(textNodes.map(textNode => textNode.nodeValue || '').join(''));
        const translated = getQuotaNoticeTranslation(original);
        if (!translated || translated === original) return false;

        if (Array.from(element.children || []).some(child => {
            return !!getQuotaNoticeTranslation(child.textContent || '');
        })) return false;

        if (textNodes.length === 1) return replaceTextNode(textNodes[0], translated);

        const durationIndex = textNodes.findIndex(textNode => {
            return !!getQuotaDurationTranslation(textNode.nodeValue || '');
        });
        if (durationIndex < 0) return false;

        const translatedDuration = getQuotaDurationTranslation(textNodes[durationIndex].nodeValue || '');
        const translatedDurationIndex = translated.indexOf(translatedDuration);
        if (translatedDurationIndex < 0) return false;
        const prefix = translated.slice(0, translatedDurationIndex);
        const suffix = translated.slice(translatedDurationIndex + translatedDuration.length);

        for (let i = 0; i < durationIndex; i++) {
            replaceTextNode(textNodes[i], i === durationIndex - 1 ? prefix : '');
        }
        replaceTextNode(textNodes[durationIndex], translatedDuration);
        for (let i = durationIndex + 1; i < textNodes.length; i++) {
            replaceTextNode(textNodes[i], i === durationIndex + 1 ? suffix : '');
        }
        return true;
    }

    function getArchivedConversationNoticeTranslation(value) {
        const noticePattern = /^(?:View|视图|查看)\\s*(?:an\\s+archived\\s+conversation|(?:an\\s+)?个?\\s*已归档(?:的)?(?:会话|对话))\\s*(?:in|，?请前往)\\s*(?:History|历史记录)[.。]?$/i;
        return noticePattern.test(norm(value)) ? "可在“历史记录”中查看已归档的会话" : null;
    }

    function translateArchivedConversationNotice(element) {
        if (!element) return false;
        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;

        for (let depth = 0; current && depth < 7; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(current) || !getArchivedConversationNoticeTranslation(current.textContent)) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            const historyElement = Array.from(current.querySelectorAll('*')).find(candidate => {
                return !isInBlockedZone(candidate) && /^(?:History|历史记录)[.。]?$/i.test(norm(candidate.textContent));
            });
            if (!historyElement) return false;

            const textNodes = collectTextNodes(current);
            const historyTextNodes = collectTextNodes(historyElement);
            if (textNodes.length === 0 || historyTextNodes.length === 0 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;

            const firstHistoryIndex = textNodes.indexOf(historyTextNodes[0]);
            const lastHistoryIndex = textNodes.indexOf(historyTextNodes[historyTextNodes.length - 1]);
            if (firstHistoryIndex <= 0 || lastHistoryIndex < firstHistoryIndex) return false;

            const prefixNodes = textNodes.slice(0, firstHistoryIndex);
            const suffixNodes = textNodes.slice(lastHistoryIndex + 1);
            replaceTextNode(prefixNodes[0], "可在");
            for (let i = 1; i < prefixNodes.length; i++) replaceTextNode(prefixNodes[i], '');
            replaceTextNode(historyTextNodes[0], "历史记录");
            for (let i = 1; i < historyTextNodes.length; i++) replaceTextNode(historyTextNodes[i], '');

            if (suffixNodes.length > 0) {
                replaceTextNode(suffixNodes[0], "中查看已归档的会话");
                for (let i = 1; i < suffixNodes.length; i++) replaceTextNode(suffixNodes[i], '');
            } else {
                historyElement.parentNode.insertBefore(document.createTextNode("中查看已归档的会话"), historyElement.nextSibling);
            }
            return true;
        }
        return false;
    }

    function translateInputDisabledNotice(element) {
        if (!element) return false;
        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;

        for (let depth = 0; current && depth < 7; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(current)) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            const rawText = norm(current.textContent);
            if (!/(?:Input disabled because|输入已禁用[，,]因为)/i.test(rawText) ||
                !/(?:does not exist|Create the folder in this|不存在.*在此)/i.test(rawText)) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            if (rawText.includes("输入已禁用，因为") && rawText.includes("中创建该文件夹")) {
                return true;
            }

            const projectElement = Array.from(current.querySelectorAll('*')).find(candidate => {
                return !isInBlockedZone(candidate) && /^(?:project|项目)[.。]?$/i.test(norm(candidate.textContent));
            });
            if (!projectElement) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            const textNodes = collectTextNodes(current);
            const projectTextNodes = collectTextNodes(projectElement);
            if (textNodes.length === 0 || projectTextNodes.length === 0 || textNodes.some(tn => isInBlockedZone(tn))) {
                return false;
            }

            const firstProjectIndex = textNodes.indexOf(projectTextNodes[0]);
            const lastProjectIndex = textNodes.indexOf(projectTextNodes[projectTextNodes.length - 1]);
            if (firstProjectIndex <= 0 || lastProjectIndex < firstProjectIndex) {
                return false;
            }

            const prefixIndex = textNodes.findIndex((tn, idx) => {
                return idx < firstProjectIndex && /(?:Input disabled because|输入已禁用[，,]因为)/i.test(tn.nodeValue || '');
            });
            if (prefixIndex < 0) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            const middleNodes = [];
            for (let i = prefixIndex + 1; i < firstProjectIndex; i++) {
                const val = textNodes[i].nodeValue || '';
                if (/(?:does not exist|Create the folder in this|不存在|请在此)/i.test(val)) {
                    middleNodes.push(textNodes[i]);
                }
            }
            if (middleNodes.length === 0) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            replaceTextNode(textNodes[prefixIndex], "输入已禁用，因为 ");

            replaceTextNode(middleNodes[0], " 不存在。请在此");
            for (let i = 1; i < middleNodes.length; i++) {
                replaceTextNode(middleNodes[i], '');
            }

            replaceTextNode(projectTextNodes[0], "项目");
            for (let i = 1; i < projectTextNodes.length; i++) {
                replaceTextNode(projectTextNodes[i], '');
            }

            const suffixNodes = textNodes.slice(lastProjectIndex + 1);
            if (suffixNodes.length > 0) {
                replaceTextNode(suffixNodes[0], "中创建该文件夹");
                for (let i = 1; i < suffixNodes.length; i++) {
                    replaceTextNode(suffixNodes[i], '');
                }
            } else {
                const suffixNode = document.createTextNode("中创建该文件夹");
                translatedValues.set(suffixNode, "中创建该文件夹");
                projectElement.parentNode.insertBefore(suffixNode, projectElement.nextSibling);
            }
            return true;
        }
        return false;
    }

    function translateShowMoreStatus(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const match = norm(element.textContent).match(/^Show\\s+(\\d+)\\s+more(?:\\.\\.\\.|…)?$/i);
        if (!match) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0) return false;
        replaceTextNode(textNodes[0], "显示另外 " + match[1] + " 个...");
        for (let i = 1; i < textNodes.length; i++) replaceTextNode(textNodes[i], '');
        return true;
    }

    function getBaselineQuotaRefreshTranslation(value) {
        const match = norm(value).match(/^Your plan(?:'s|’s) baseline quota will refresh on\\s+(.+?)[.。]$/i);
        if (!match) return null;

        let refreshTime = match[1].trim();
        if (/^\\d+$/.test(refreshTime)) return null;
        const strayPrefix = refreshTime.match(/^\\d+\\.\\s+(\\d{2}\\/\\d{1,2}\\/\\d{1,2}\\s+\\d{1,2}:\\d{2}:\\d{2})$/);
        if (strayPrefix) refreshTime = strayPrefix[1];

        return "您当前计划的基础配额将于 " + refreshTime + " 刷新";
    }

    function replaceTextRange(textNodes, start, end, value) {
        let offset = 0;
        let replaced = false;
        for (const textNode of textNodes) {
            const original = textNode.nodeValue || '';
            const nodeStart = offset;
            const nodeEnd = nodeStart + original.length;
            offset = nodeEnd;

            if (nodeEnd <= start || nodeStart >= end) continue;

            const before = start > nodeStart ? original.slice(0, start - nodeStart) : '';
            const after = end < nodeEnd ? original.slice(end - nodeStart) : '';
            if (!replaced) {
                replaceTextNode(textNode, before + value);
                replaced = true;
                if (after && textNode.parentNode) {
                    textNode.parentNode.insertBefore(document.createTextNode(after), textNode.nextSibling);
                }
            } else {
                if (after) {
                    translatedValues.delete(textNode);
                    textNode.nodeValue = after;
                } else {
                    replaceTextNode(textNode, '');
                }
            }
        }
        return replaced;
    }

    function translateBaselineQuotaNotice(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (Array.from(element.children || []).some(child => /Your plan(?:'s|’s) baseline quota will refresh on/i.test(child.textContent || ''))) {
            return false;
        }
        const textNodes = collectTextNodes(element).filter(textNode => !isInBlockedZone(textNode));
        if (textNodes.length === 0) return false;

        const text = textNodes.map(textNode => textNode.nodeValue || '').join('');
        const match = text.match(/Your plan(?:'s|’s) baseline quota will refresh on\\s+(.+?)\\.(?=\\s*(?:To continue using this model now, enable AI Credit overages\\.|You can upgrade to a Google AI Ultra plan to receive higher rate limits\\.|View plans?\\.?|$))/i);
        if (!match || typeof match.index !== 'number') return false;

        const translated = getBaselineQuotaRefreshTranslation(match[0]);
        if (!translated) return false;
        return replaceTextRange(textNodes, match.index, match.index + match[0].length, translated);
    }

    function getAgentSourceDisplayName(value) {
        const normalized = norm(value);
        if (/^browser$/i.test(normalized)) return "浏览器";
        if (/^(?:Root|Main)\\s+Agent$/i.test(normalized)) return "主智能体";
        return normalized;
    }

    function getDynamicSubagentStatusTranslation(value) {
        const normalized = norm(value);
        let match = normalized.match(/^Found\\s+(\\d+)\\s+subagents?(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "找到 " + match[1] + " 个子智能体" + (match[2] ? " " + match[2] : "");

        match = normalized.match(/^Found\\s+(?:Subagents?|子智能体)$/i);
        if (match) return "已找到子智能体";

        match = normalized.match(/^Found\\s+(?:Browsers?|浏览器)(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "已找到浏览器" + (match[1] ? " " + match[1] : "");

        match = normalized.match(/^(?:Killed|已中止)\\s+(\\d+)\\s+subagents?(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "已中止 " + match[1] + " 个子智能体" + (match[2] ? " " + match[2] : "");

        match = normalized.match(/^Message\\s+from\\s+(?:Root\\s+Agent|主智能体)(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "来自主智能体的消息" + (match[1] ? " " + match[1] : "");

        match = normalized.match(/^Error\\s+from\\s+(.+?)\\s+\\(([^()]+)\\)(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "来自" + getAgentSourceDisplayName(match[1]) + "（" + match[2] + "）的错误" + (match[3] ? " " + match[3] : "");

        match = normalized.match(/^Error\\s+from\\s+\\(([^()]+)\\)(?:\\s*([>›❯〉→]))?$/i);
        if (match) {
            const displayName = getAgentSourceDisplayName(match[1]);
            const source = displayName === match[1] ? " " + match[1] + " " : displayName + "（" + match[1] + "）";
            return "来自" + source + "的错误" + (match[2] ? " " + match[2] : "");
        }

        match = normalized.match(/^Timed\\s+(\\d+)\\s+(seconds?|minutes?|hours?)(?:\\s*([>›❯〉→]))?$/i);
        if (match) {
            const unit = /^second/i.test(match[2]) ? "秒" : /^minute/i.test(match[2]) ? "分钟" : "小时";
            return "耗时 " + match[1] + " " + unit + (match[3] ? " " + match[3] : "");
        }

        match = normalized.match(/^Messaged\\s+Root\\s+Agent(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "已向主智能体发送消息" + (match[1] ? " " + match[1] : "");

        match = normalized.match(/^(\\d+)\\s+tasks?\\s+running,\\s*(\\d+)\\s+active\\s+goals?$/i);
        if (match) return match[1] + " 个任务正在运行，" + match[2] + " 个活跃目标";

        match = normalized.match(/^(\\d+)\\s+subagents?\\s*\\/\\s*tasks?\\s+running$/i);
        if (match) return match[1] + " 个子智能体/任务正在运行";

        match = normalized.match(/^(\\d+)\\s+active\\s+goals?$/i);
        if (match) return match[1] + " 个活跃目标";

        match = normalized.match(/^Goals?\\s+(\\d+)$/i);
        if (match) return "目标 " + match[1];

        match = normalized.match(/^(\\d+)\\s+(?:Side\\s+Questions?|个?侧边提问)(?:\\s*([>›❯〉→]))?$/i);
        if (match) return match[1] + " 个侧边提问" + (match[2] ? " " + match[2] : "");

        match = normalized.match(/^(\\d+)\\s+questions?$/i);
        if (match) return match[1] + " 个问题";

        match = normalized.match(/^View\\s+(\\d+)\\s+side\\s+questions?(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "查看 " + match[1] + " 个侧边提问" + (match[2] ? " " + match[2] : "");

        match = normalized.match(/^Question\\s+(\\d+)\\s+of\\s+(\\d+)$/i);
        if (match) return "第 " + match[1] + " 个问题，共 " + match[2] + " 个";

        match = normalized.match(/^Side\\s+question\\s+failed:\\s*(.+)$/i);
        if (match) return "侧边提问失败：" + match[1];

        match = normalized.match(/^Side\\s+question\\s+answered\\.?$/i);
        if (match) return "侧边提问已回答";

        match = normalized.match(/^Asked\\s+(\\d+)\\s+questions?$/i);
        if (match) return "已询问 " + match[1] + " 个问题";

        match = normalized.match(/^(\\d+)\\s+subagents?\\s+(running|blocked|completed|failed)$/i);
        if (match) {
            const stateMap = {
                running: "正在运行",
                blocked: "已阻塞",
                completed: "已完成",
                failed: "已失败"
            };
            return match[1] + " 个子智能体" + stateMap[match[2].toLowerCase()];
        }
        return null;
    }

    function getBracketedTaskStatusTranslation(value) {
        const normalized = norm(value);
        const match = normalized.match(/^\\[(Completed|Blocked|Running|Failed|Stopped|In Progress|Cancelled|Canceled)\\](?:\\s+(.+))?$/i);
        if (!match) return null;

        const sourceStatus = match[1];
        const translatedStatus = map.get(sourceStatus)
            || lowerMap.get(sourceStatus.toLowerCase());
        if (!translatedStatus) return null;
        return "[" + translatedStatus + "]" + (match[2] ? " " + match[2] : "");
    }

    function getDynamicProductUiTranslation(value) {
        const normalized = norm(value);
        let match = normalized.match(/^When toggled on,\\s+(.+?)\\s+collects usage data to help Google enhance performance and features\\.$/i);
        if (match) return "启用后，" + match[1] + " 会收集使用数据，以帮助 Google 改进性能和功能";

        match = normalized.match(/^Receive product updates, tips, and promotions from Google\\s+(.+?)\\s+via email\\.$/i);
        if (match) return "通过电子邮件接收 Google " + match[1] + " 的产品更新、使用技巧和推广信息";

        match = normalized.match(/^When toggled on,\\s+(.+?)\\s+will use your AI credits to fulfill model requests once you're out of model quota\\.\\s+\\1\\s+will always use your model quota first before using AI credits\\.$/i);
        if (match) return "启用后，当模型配额用尽时，" + match[1] + " 将使用您的 AI 额度处理模型请求。系统会优先使用模型配额，之后才使用 AI 额度";

        match = normalized.match(/^Build with\\s+(.+?)\\s+Plugins$/i);
        if (match) return "使用 " + match[1] + " 插件构建";

        match = normalized.match(/^Plugins are packaged collections of skills and MCPs to help the Agent in\\s+(.+?)\\s+work with Google developer products\\. You can always change your choices in Settings\\.$/i);
        if (match) return "插件是打包的技能与 MCP 集合，用于帮助 " + match[1] + " 中的智能体使用 Google 开发者产品。您随时可以在设置中更改选择";

        match = normalized.match(/^Manage\\s+(project|workspace)\\s+folders, agent settings, and permissions\\.$/i);
        if (match) {
            const scope = match[1].toLowerCase() === "project" ? "项目" : "工作区";
            return "管理" + scope + "文件夹、智能体设置和权限";
        }

        match = normalized.match(/^Agent settings and permissions for conversations outside of\\s+(projects|workspaces)\\.$/i);
        if (match) {
            const scope = match[1].toLowerCase() === "projects" ? "项目" : "工作区";
            return "用于不属于任何" + scope + "的会话的智能体设置和权限";
        }

        match = normalized.match(/^File exceeds the (\\d+(?:\\.\\d+)?\\s*(?:[KMGTP]?B|bytes?))\\s+display limit(?:\\s*\\(([^)]+)\\))?\\.?$/i);
        if (match) {
            return "文件超过 " + match[1] + " 显示限制" + (match[2] ? " (" + match[2] + ")" : "");
        }

        match = normalized.match(/^Setting up WSL:\\s*(.+)$/i);
        if (match) return "正在设置 WSL：" + match[1];

        match = normalized.match(/^Deleted\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "已删除“" + match[1] + "”";

        match = normalized.match(/^Enabled\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "已启用“" + match[1] + "”";

        match = normalized.match(/^Disabled\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "已禁用“" + match[1] + "”";

        match = normalized.match(/^Started\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "已启动“" + match[1] + "”";

        match = normalized.match(/^Failed to start\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "启动“" + match[1] + "”失败";

        match = normalized.match(/^Restarted\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "已重启“" + match[1] + "”";

        match = normalized.match(/^Created\\s+(automation|scheduled task)\\s+["“](.+?)["”][.。]?$/i);
        if (match) {
            const entity = match[1].toLowerCase() === "automation" ? "自动化" : "计划任务";
            return "已创建" + entity + "“" + match[2] + "”";
        }

        match = normalized.match(/^Failed to (update|save|delete)\\s+["“](.+?)["”][.。]?$/i);
        if (match) {
            const act = match[1].toLowerCase();
            const verb = act === "update" ? "更新" : act === "save" ? "保存" : "删除";
            return verb + "“" + match[2] + "”失败";
        }

        match = normalized.match(/^(Automation|Task|Scheduled task)\\s+["“](.+?)["”]\\s+not found\\.?$/i);
        if (match) {
            const entity = match[1].toLowerCase() === "automation" ? "自动化" : "任务";
            return "未找到" + entity + "“" + match[2] + "”";
        }

        match = normalized.match(/^Agents created by this (automation|scheduled task) run in a dedicated (project|workspace) with its own permissions\\.\\s*You can change the permissions in the \\2 settings page\\.?$/i);
        if (match) {
            const entity = match[1].toLowerCase() === "automation" ? "自动化" : "计划任务";
            const scope = match[2].toLowerCase() === "project" ? "项目" : "工作区";
            return "由此" + entity + "创建的智能体会在具有独立权限的专用" + scope + "中运行。您可以在" + scope + "设置页面中更改这些权限";
        }

        match = normalized.match(/^All (scheduled tasks|automations) run (?:as|with the)\\s+(.+?)(?:\\s+model)?[.。]?$/i);
        if (match) {
            const entity = match[1].toLowerCase() === "automations" ? "自动化" : "计划任务";
            const model = match[2].replace(/[.。]+$/, '').trim();
            if (model) return "所有" + entity + "均以 " + model + " 模型运行";
        }

        match = normalized.match(/^(?:A|An)\\s+(automation|scheduled task)\\s+with ID\\s+(.+?)\\s+already exists\\.?$/i);
        if (match) {
            const entity = match[1].toLowerCase() === "automation" ? "自动化" : "计划任务";
            return "ID 为 " + match[2] + " 的" + entity + "已存在";
        }

        match = normalized.match(/^Domains:\\s+(.+)$/i);
        if (match) return "域名：" + match[1];

        match = normalized.match(/^Scopes:\\s+(.+)$/i);
        if (match) return "权限范围：" + match[1];

        match = normalized.match(/^Secret for a new\\s+(.+?)\\s+account$/i);
        if (match) return "用于新 " + match[1] + " 账号的密钥";

        match = normalized.match(/^Secret for\\s+(.+)$/i);
        if (match) return "用于 " + match[1] + " 的密钥";

        match = normalized.match(/^Managed by the\\s+(.+?)\\s+automation$/i);
        if (match) return "由 " + match[1] + " 自动化管理";

        // Permission options (both pure English and half-translated recovery)
        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, and always allow|是，且始终允许)(?: '(.+)')?\\s+in this project$/i);
        if (match) return match[1] ? "是，且在此项目中始终允许运行 '" + match[1] + "'" : "是，且在此项目中始终允许";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, and always allow|是，且始终允许)(?: '(.+)')?\\s+when not in a project$/i);
        if (match) return match[1] ? "是，且在不属于任何项目时始终允许运行 '" + match[1] + "'" : "是，且在不属于任何项目时始终允许";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, and always allow|是，且始终允许)(?: '(.+)')?\\s+in this workspace$/i);
        if (match) return match[1] ? "是，且在此工作区中始终允许运行 '" + match[1] + "'" : "是，且在此工作区中始终允许";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, and always allow|是，且始终允许)(?: '(.+)')?\\s+in this conversation$/i);
        if (match) return match[1] ? "是，且在此会话中始终允许运行 '" + match[1] + "'" : "是，且在此会话中始终允许";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, and always allow|是，且始终允许)\\s*'(.+)'$/i);
        if (match) return "是，且始终允许运行 '" + match[1] + "'";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)(?:\\s*(?:for|用于)\\s*'(.+)')?\\s+in this project$/i);
        if (match) return match[1] ? "是，在此项目中为 '" + match[1] + "' 保存规则" : "是，在此项目中保存规则";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)(?:\\s*(?:for|用于)\\s*'(.+)')?\\s+when not in a project$/i);
        if (match) return match[1] ? "是，在不属于任何项目时为 '" + match[1] + "' 保存规则" : "是，在不属于任何项目时保存规则";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)(?:\\s*(?:for|用于)\\s*'(.+)')?\\s+in this workspace$/i);
        if (match) return match[1] ? "是，在此工作区中为 '" + match[1] + "' 保存规则" : "是，在此工作区中保存规则";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)(?:\\s*(?:for|用于)\\s*'(.+)')?\\s+in this conversation$/i);
        if (match) return match[1] ? "是，在此会话中为 '" + match[1] + "' 保存规则" : "是，在此会话中保存规则";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)(?:\\s*(?:for|用于)\\s*'(.+)')?\\s+globally$/i);
        if (match) return match[1] ? "是，全局为 '" + match[1] + "' 保存规则" : "是，全局保存规则";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)\\s*(?:for|用于)\\s*'(.+)'$/i);
        if (match) return "是，为 '" + match[1] + "' 保存规则";

        // Permission questions
        match = normalized.match(/^(?:Save rule to always allow|保存为始终允许规则)\\s+(.+?)\\??$/i);
        if (match) {
            let act = match[1].toLowerCase();
            let actTrans = null;
            if (act === 'read access to this path') actTrans = '读取此路径';
            else if (act === 'write access to this path') actTrans = '写入此路径';
            else if (act === 'reading this url') actTrans = '读取此 URL';
            else if (act === 'executing actions on this url') actTrans = '在此 URL 上执行操作';
            else if (act === 'running this command') actTrans = '运行此命令';
            else if (act === 'running this command outside the sandbox') actTrans = '在沙箱外运行此命令';
            else if (act === 'using this mcp tool') actTrans = '使用此 MCP 工具';
            else if (act === 'a one-time administrator (uac) elevation') actTrans = '单次管理员 (UAC) 提权';
            else if (act === 'access to this resource') actTrans = '访问此资源';
            if (actTrans) {
                const separator = /[A-Za-z0-9]$/.test(actTrans) ? " 的规则？" : "的规则？";
                return "保存为始终允许" + actTrans + separator;
            }
        }

        match = normalized.match(/^Allow\\s+(.+?)\\??$/i);
        if (match) {
            let act = match[1].toLowerCase();
            let actTrans = null;
            if (act === 'read access to this path') actTrans = '读取此路径';
            else if (act === 'write access to this path') actTrans = '写入此路径';
            else if (act === 'reading this url') actTrans = '读取此 URL';
            else if (act === 'executing actions on this url') actTrans = '在此 URL 上执行操作';
            else if (act === 'running this command') actTrans = '运行此命令';
            else if (act === 'running this command outside the sandbox') actTrans = '在沙箱外运行此命令';
            else if (act === 'using this mcp tool') actTrans = '使用此 MCP 工具';
            else if (act === 'a one-time administrator (uac) elevation') actTrans = '单次管理员 (UAC) 提权';
            else if (act === 'access to this resource') actTrans = '访问此资源';
            if (actTrans) return "是否允许" + actTrans + "？";
        }

        return null;
    }

    function getProjectConversationCountTranslation(value) {
        const normalized = norm(value);
        let match = normalized.match(/^(\\d+)\\s+(?:active conversations?|个活跃会话)(?:\\s*(?:and|及)\\s*(\\d+)\\s+(?:archived conversations?|个已归档会话))?$/i);
        if (match) {
            let result = match[1] + " 个活跃会话";
            if (match[2]) result += "及 " + match[2] + " 个已归档会话";
            return result;
        }

        match = normalized.match(/^(\\d+)\\s+(?:archived conversations?|个已归档会话)$/i);
        return match ? match[1] + " 个已归档会话" : null;
    }

    function getProjectDeleteSummaryTranslation(value) {
        const normalized = norm(value);
        const match = normalized.match(/^(?:Permanently delete|永久删除)\\s+(.{1,200}?)\\s*(?:including|，?包含)\\s+((?:\\d+\\s+(?:active conversations?|个活跃会话)(?:\\s*(?:and|及)\\s*\\d+\\s+(?:archived conversations?|个已归档会话))?)|(?:\\d+\\s+(?:archived conversations?|个已归档会话)))[.。]?$/i);
        if (!match) return null;

        const countTranslation = getProjectConversationCountTranslation(match[2]);
        return countTranslation ? "永久删除 " + match[1] + "，包含 " + countTranslation : null;
    }

    function translateProjectDeleteSummary(element) {
        if (!element) return false;

        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE &&
                current.tagName?.toUpperCase() === 'SPAN' &&
                !isInBlockedZone(current)) {
                const textNodes = collectTextNodes(current).filter(textNode => !isInBlockedZone(textNode));
                const wholeTranslation = getProjectDeleteSummaryTranslation(
                    textNodes.map(textNode => textNode.nodeValue || '').join('')
                );
                if (wholeTranslation) {
                    const prefixIndex = textNodes.findIndex(textNode => /^(?:Permanently delete|永久删除)$/i.test(norm(textNode.nodeValue)));
                    const includingIndex = textNodes.findIndex((textNode, index) => {
                        return index > prefixIndex && /^(?:including|，?包含)$/i.test(norm(textNode.nodeValue));
                    });
                    const countIndex = textNodes.findIndex((textNode, index) => {
                        return index > includingIndex && !!getProjectConversationCountTranslation(textNode.nodeValue);
                    });
                    if (prefixIndex < 0 || includingIndex < 0 || countIndex < 0) return false;

                    const hasProjectName = textNodes.slice(prefixIndex + 1, includingIndex)
                        .some(textNode => norm(textNode.nodeValue));
                    if (!hasProjectName) return false;

                    replaceTextNode(textNodes[prefixIndex], "永久删除");
                    replaceTextNode(textNodes[includingIndex], "，包含 ");
                    replaceTextNode(textNodes[countIndex], getProjectConversationCountTranslation(textNodes[countIndex].nodeValue));

                    const punctuationNode = textNodes.slice(countIndex + 1)
                        .find(textNode => /^[.。]$/.test(norm(textNode.nodeValue)));
                    if (punctuationNode) replaceTextNode(punctuationNode, "");
                    return true;
                }
            }
            current = current.parentElement || (current.parentNode && current.parentNode.host);
        }
        return false;
    }

    function translatePermanentlyDeleteNotice(element) {
        if (!element) return false;

        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE && !isInBlockedZone(current)) {
                const textNodes = collectTextNodes(current).filter(textNode => !isInBlockedZone(textNode));
                if (textNodes.length > 0) {
                    const rawText = textNodes.map(tn => tn.nodeValue || '').join('');
                    const normalized = norm(rawText);

                    const activeAndArchivedMatch = normalized.match(/^(?:This will permanently delete|这将永久删除)\\s+(\\d+)\\s+(?:active (?:conversations?|chats?)|个活跃会话)\\s*(?:and|及)\\s*(\\d+)\\s+(?:archived (?:conversations?|chats?)|个已归档会话)\\s*(?:within it[.。]?)?$/i);
                    const activeOnlyMatch = normalized.match(/^(?:This will permanently delete|这将永久删除)\\s+(\\d+)\\s+(?:active (?:conversations?|chats?)|个活跃会话)\\s*(?:within it[.。]?)?$/i);
                    const archivedOnlyMatch = normalized.match(/^(?:This will permanently delete|这将永久删除)\\s+(\\d+)\\s+(?:archived (?:conversations?|chats?)|个已归档会话)\\s*(?:within it[.。]?)?$/i);

                    if (activeAndArchivedMatch) {
                        const activeCount = activeAndArchivedMatch[1];
                        const archivedCount = activeAndArchivedMatch[2];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将永久删除 " + activeCount + " 个活跃会话及 " + archivedCount + " 个已归档会话");
                        }
                        const firstCountIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === activeCount || val.startsWith(activeCount + " ");
                        });
                        const secondCountIndex = firstCountIndex >= 0
                            ? textNodes.findIndex((tn, idx) => {
                                if (idx <= firstCountIndex) return false;
                                const val = norm(tn.nodeValue);
                                return val === archivedCount || val.startsWith(archivedCount + " ");
                            })
                            : -1;
                        if (firstCountIndex >= 0 && secondCountIndex > firstCountIndex) {
                            let changed = replaceTextNode(textNodes[0], "这将永久删除 ");
                            for (let i = 1; i < firstCountIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const firstIsIsolated = norm(textNodes[firstCountIndex].nodeValue) === activeCount;
                            if (firstIsIsolated) {
                                changed = replaceTextNode(textNodes[firstCountIndex + 1], " 个活跃会话及 ") || changed;
                                for (let i = firstCountIndex + 2; i < secondCountIndex; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            } else {
                                changed = replaceTextNode(textNodes[firstCountIndex], activeCount + " 个活跃会话及 ") || changed;
                                for (let i = firstCountIndex + 1; i < secondCountIndex; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            const secondIsIsolated = norm(textNodes[secondCountIndex].nodeValue) === archivedCount;
                            if (secondIsIsolated) {
                                if (secondCountIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[secondCountIndex + 1], " 个已归档会话") || changed;
                                    for (let i = secondCountIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[secondCountIndex], archivedCount + " 个已归档会话") || changed;
                                for (let i = secondCountIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    } else if (activeOnlyMatch) {
                        const activeCount = activeOnlyMatch[1];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将永久删除 " + activeCount + " 个活跃会话");
                        }
                        const countIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === activeCount || val.startsWith(activeCount + " ");
                        });
                        if (countIndex >= 0) {
                            let changed = replaceTextNode(textNodes[0], "这将永久删除 ");
                            for (let i = 1; i < countIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const isIsolated = norm(textNodes[countIndex].nodeValue) === activeCount;
                            if (isIsolated) {
                                if (countIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[countIndex + 1], " 个活跃会话") || changed;
                                    for (let i = countIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[countIndex], activeCount + " 个活跃会话") || changed;
                                for (let i = countIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    } else if (archivedOnlyMatch) {
                        const archivedCount = archivedOnlyMatch[1];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将永久删除 " + archivedCount + " 个已归档会话");
                        }
                        const countIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === archivedCount || val.startsWith(archivedCount + " ");
                        });
                        if (countIndex >= 0) {
                            let changed = replaceTextNode(textNodes[0], "这将永久删除 ");
                            for (let i = 1; i < countIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const isIsolated = norm(textNodes[countIndex].nodeValue) === archivedCount;
                            if (isIsolated) {
                                if (countIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[countIndex + 1], " 个已归档会话") || changed;
                                    for (let i = countIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[countIndex], archivedCount + " 个已归档会话") || changed;
                                for (let i = countIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    }
                }
            }
            current = current.parentElement || (current.parentNode && current.parentNode.host);
        }
        return false;
    }

    function translateArchiveNotice(element) {
        if (!element) return false;

        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE && !isInBlockedZone(current)) {
                const textNodes = collectTextNodes(current).filter(textNode => !isInBlockedZone(textNode));
                if (textNodes.length > 0) {
                    const rawText = textNodes.map(tn => tn.nodeValue || '').join('');
                    const normalized = norm(rawText);

                    const activeAndArchivedMatch = normalized.match(/^(?:This will archive|这将归档)\\s+(\\d+)\\s*(?:active (?:conversations?|chats?)|个活跃会话)\\s*(?:and|及)\\s*(\\d+)\\s*(?:archived (?:conversations?|chats?)|个已归档会话)\\s*(?:within it[.。]?)?$/i);
                    const activeOnlyMatch = normalized.match(/^(?:This will archive|这将归档)\\s+(\\d+)\\s*(?:active (?:conversations?|chats?)|个活跃会话)\\s*(?:within it[.。]?)?$/i);
                    const archivedOnlyMatch = normalized.match(/^(?:This will archive|这将归档)\\s+(\\d+)\\s*(?:archived (?:conversations?|chats?)|个已归档会话)\\s*(?:within it[.。]?)?$/i);
                    const countOnlyMatch = normalized.match(/^(?:This will archive|这将归档)\\s+(\\d+)\\s*(?:conversations?|chats?|会话s?|个会话)\\s*(?:within it[.。]?)?$/i);

                    if (activeAndArchivedMatch) {
                        const activeCount = activeAndArchivedMatch[1];
                        const archivedCount = activeAndArchivedMatch[2];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将归档其中的 " + activeCount + " 个活跃会话及 " + archivedCount + " 个已归档会话");
                        }
                        const firstCountIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === activeCount || val.startsWith(activeCount + " ");
                        });
                        const secondCountIndex = firstCountIndex >= 0
                            ? textNodes.findIndex((tn, idx) => {
                                if (idx <= firstCountIndex) return false;
                                const val = norm(tn.nodeValue);
                                return val === archivedCount || val.startsWith(archivedCount + " ");
                            })
                            : -1;
                        if (firstCountIndex >= 0 && secondCountIndex > firstCountIndex) {
                            let changed = replaceTextNode(textNodes[0], "这将归档其中的 ");
                            for (let i = 1; i < firstCountIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const firstIsIsolated = norm(textNodes[firstCountIndex].nodeValue) === activeCount;
                            if (firstIsIsolated) {
                                changed = replaceTextNode(textNodes[firstCountIndex + 1], " 个活跃会话及 ") || changed;
                                for (let i = firstCountIndex + 2; i < secondCountIndex; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            } else {
                                changed = replaceTextNode(textNodes[firstCountIndex], activeCount + " 个活跃会话及 ") || changed;
                                for (let i = firstCountIndex + 1; i < secondCountIndex; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            const secondIsIsolated = norm(textNodes[secondCountIndex].nodeValue) === archivedCount;
                            if (secondIsIsolated) {
                                if (secondCountIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[secondCountIndex + 1], " 个已归档会话") || changed;
                                    for (let i = secondCountIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[secondCountIndex], archivedCount + " 个已归档会话") || changed;
                                for (let i = secondCountIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    } else if (activeOnlyMatch) {
                        const activeCount = activeOnlyMatch[1];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将归档其中的 " + activeCount + " 个活跃会话");
                        }
                        const countIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === activeCount || val.startsWith(activeCount + " ");
                        });
                        if (countIndex >= 0) {
                            let changed = replaceTextNode(textNodes[0], "这将归档其中的 ");
                            for (let i = 1; i < countIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const isIsolated = norm(textNodes[countIndex].nodeValue) === activeCount;
                            if (isIsolated) {
                                if (countIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[countIndex + 1], " 个活跃会话") || changed;
                                    for (let i = countIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[countIndex], activeCount + " 个活跃会话") || changed;
                                for (let i = countIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    } else if (archivedOnlyMatch) {
                        const archivedCount = archivedOnlyMatch[1];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将归档其中的 " + archivedCount + " 个已归档会话");
                        }
                        const countIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === archivedCount || val.startsWith(archivedCount + " ");
                        });
                        if (countIndex >= 0) {
                            let changed = replaceTextNode(textNodes[0], "这将归档其中的 ");
                            for (let i = 1; i < countIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const isIsolated = norm(textNodes[countIndex].nodeValue) === archivedCount;
                            if (isIsolated) {
                                if (countIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[countIndex + 1], " 个已归档会话") || changed;
                                    for (let i = countIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[countIndex], archivedCount + " 个已归档会话") || changed;
                                for (let i = countIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    } else if (countOnlyMatch) {
                        const count = countOnlyMatch[1];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将归档其中的 " + count + " 个会话");
                        }
                        const countIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === count || val.startsWith(count + " ") || val.startsWith(count + "会话");
                        });
                        if (countIndex >= 0) {
                            let changed = replaceTextNode(textNodes[0], "这将归档其中的 ");
                            for (let i = 1; i < countIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const countNodeVal = norm(textNodes[countIndex].nodeValue);
                            const isIsolated = countNodeVal === count;
                            if (isIsolated) {
                                if (countIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[countIndex + 1], " 个会话") || changed;
                                    for (let i = countIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[countIndex], count + " 个会话") || changed;
                                for (let i = countIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    }
                }
            }
            current = current.parentElement || (current.parentNode && current.parentNode.host);
        }
        return false;
    }

    function translateBrowserSubagentNotice(element) {
        if (!element) return false;

        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE && !isInBlockedZone(current)) {
                const cText = current.textContent || '';
                if (cText.length <= 500 &&
                    /(?:Configure the browser subagent|配置浏览器子智能体)/i.test(cText) &&
                    /(?:Google Chrome|to be installed)/i.test(cText)) {
                    const textNodes = collectTextNodes(current).filter(tn => !isInBlockedZone(tn));
                    if (textNodes.length === 0) return false;

                    let changed = false;
                    for (let i = 0; i < textNodes.length; i++) {
                        const tn = textNodes[i];
                        const val = tn.nodeValue || '';
                        const valN = norm(val);

                        if (/^Configure the browser subagent\\.\\s*It requires$/i.test(valN)) {
                            changed = replaceTextNode(tn, "配置浏览器子智能体。它需要安装 ") || changed;
                        } else if (/^to be installed\\.?$/i.test(valN)) {
                            changed = replaceTextNode(tn, "。") || changed;
                        } else if (/^to be installed\\.\\s*(.+)$/i.test(valN)) {
                            const match = valN.match(/^to be installed\\.\\s*(.+)$/i);
                            const rest = match[1];
                            const restTrans = map.get(norm(rest)) || lowerMap.get(norm(rest).toLowerCase()) || rest;
                            changed = replaceTextNode(tn, "。" + restTrans) || changed;
                        } else if (/^The browser subagent can be invoked by typing \\/browser in the conversation input box\\.?$/i.test(valN)) {
                            changed = replaceTextNode(tn, "您可以通过在会话输入框中输入 /browser 来调用浏览器子智能体") || changed;
                        }
                    }
                    if (changed) return true;
                }
            }
            current = current.parentElement || (current.parentNode && current.parentNode.host);
        }
        return false;
    }

    function translateLegalHelpNotice(element) {
        if (!element) return false;

        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE && !isInBlockedZone(current)) {
                const cText = current.textContent || '';
                if (cText.length <= 300 &&
                    /(?:Visit|访问)\\s*(?:Legal Help|法律帮助)/i.test(cText) &&
                    /(?:to ask for content changes for legal reasons|出于法律原因)/i.test(cText)) {
                    const textNodes = collectTextNodes(current).filter(tn => !isInBlockedZone(tn));
                    if (textNodes.length === 0) return false;

                    let changed = false;
                    for (let i = 0; i < textNodes.length; i++) {
                        const tn = textNodes[i];
                        const val = tn.nodeValue || '';
                        const valN = norm(val);

                        if (/^Visit$/i.test(valN)) {
                            changed = replaceTextNode(tn, "若出于法律原因需要申请更改内容，请访问 ") || changed;
                        } else if (/^Legal Help$/i.test(valN)) {
                            changed = replaceTextNode(tn, "法律帮助") || changed;
                        } else if (/^to ask for content changes for legal reasons[.。]?$/i.test(valN)) {
                            changed = replaceTextNode(tn, " 页面") || changed;
                        } else if (/^Visit Legal Help to ask for content changes for legal reasons[.。]?$/i.test(valN)) {
                            changed = replaceTextNode(tn, "若出于法律原因需要申请更改内容，请访问法律帮助页面") || changed;
                        }
                    }
                    if (changed) return true;
                }
            }
            current = current.parentElement || (current.parentNode && current.parentNode.host);
        }
        return false;
    }

    function translatePlanCommandAlert(element) {
        if (!element) return false;

        let alertContainer = null;
        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE && !isInBlockedZone(current)) {
                if (current.getAttribute?.('data-testid') === 'plan-command-fyi-alert') {
                    alertContainer = current;
                    break;
                }
                if (current.querySelector?.('[data-testid="plan-command-fyi-alert"]')) {
                    alertContainer = current.querySelector('[data-testid="plan-command-fyi-alert"]');
                    break;
                }
                const cText = current.textContent || '';
                if (cText.length <= 250 &&
                    /(?:Type|类型|键入)\\s*\\/\\s*(?:and\\s+select|并选择)\\s*plan/i.test(cText) &&
                    /(?:to have the agent generate a plan|让智能体生成计划)/i.test(cText)) {
                    alertContainer = current;
                    break;
                }
            }
            current = current.parentElement || (current.parentNode && current.parentNode.host);
        }

        if (!alertContainer) return false;

        const span = alertContainer.querySelector('span') || alertContainer;
        const allTextNodes = collectTextNodes(span);
        if (allTextNodes.length === 0) return false;

        let idxSlash = -1;
        let idxPlan = -1;
        for (let i = 0; i < allTextNodes.length; i++) {
            const tn = allTextNodes[i];
            const parentTag = tn.parentElement?.tagName?.toUpperCase();
            const val = (tn.nodeValue || '').trim();
            if (parentTag === 'CODE' && val === '/' && idxSlash === -1) {
                idxSlash = i;
            } else if (parentTag === 'CODE' && /^plan$/i.test(val) && idxSlash !== -1 && idxPlan === -1) {
                idxPlan = i;
            }
        }

        if (idxSlash === -1 || idxPlan === -1 || idxSlash >= idxPlan) return false;

        let changed = false;

        const beforeNodes = allTextNodes.slice(0, idxSlash);
        if (beforeNodes.length > 0) {
            if (beforeNodes[0].nodeValue !== '键入 ') {
                changed = replaceTextNode(beforeNodes[0], '键入 ') || changed;
            }
            for (let i = 1; i < beforeNodes.length; i++) {
                if (beforeNodes[i].nodeValue !== '') {
                    changed = replaceTextNode(beforeNodes[i], '') || changed;
                }
            }
        }

        const middleNodes = allTextNodes.slice(idxSlash + 1, idxPlan);
        if (middleNodes.length > 0) {
            if (middleNodes[0].nodeValue !== ' 并选择 ') {
                changed = replaceTextNode(middleNodes[0], ' 并选择 ') || changed;
            }
            for (let i = 1; i < middleNodes.length; i++) {
                if (middleNodes[i].nodeValue !== '') {
                    changed = replaceTextNode(middleNodes[i], '') || changed;
                }
            }
        }

        const afterNodes = allTextNodes.slice(idxPlan + 1);
        if (afterNodes.length > 0) {
            if (afterNodes[0].nodeValue !== '，即可让智能体生成计划') {
                changed = replaceTextNode(afterNodes[0], '，即可让智能体生成计划') || changed;
            }
            for (let i = 1; i < afterNodes.length; i++) {
                if (afterNodes[i].nodeValue !== '') {
                    changed = replaceTextNode(afterNodes[i], '') || changed;
                }
            }
        }

        return changed;
    }

    function getCustomizationBudgetTranslation(value) {
        const match = norm(value).match(/^(\\d+(?:\\.\\d+)?)%\\s+of the customization budget is available[.。]?$/i);
        return match ? match[1] + "% 的个性化定制预算可用" : null;
    }

    function getArtifactFileCountTranslation(value) {
        const match = norm(value).match(/^Artifacts\\s*\\((\\d+)\\s+Files?\\s+for\\s+Conversation\\)$/i);
        return match ? "交付件（本会话有 " + match[1] + " 个文件）" : null;
    }

    function getCommandInputStatusTranslation(value) {
        const match = norm(value).match(/^(Rejected sending|Sent|Suggested sending|Error sending|Sending)\\s+(termination request|input)\\s+to command$/i);
        if (!match) return null;

        const item = match[2].toLowerCase() === "termination request" ? "终止请求" : "输入";
        switch (match[1].toLowerCase()) {
            case "rejected sending": return "已拒绝向命令发送" + item;
            case "sent": return "已向命令发送" + item;
            case "suggested sending": return "建议向命令发送" + item;
            case "error sending": return "向命令发送" + item + "时出错";
            case "sending": return "正在向命令发送" + item;
            default: return null;
        }
    }

    function translateDynamicSubagentStatusContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;
        const original = textNodes.map(textNode => textNode.nodeValue || '').join('');
        const translated = getDynamicSubagentStatusTranslation(original);
        if (!translated || norm(original) === translated) return false;

        if (Array.from(element.children || []).some(child => {
            return !!getDynamicSubagentStatusTranslation(child.textContent || '');
        })) return false;

        const killedMatch = norm(original).match(/^(?:Killed|已中止)\\s+(\\d+)\\s+subagents?(?:\\s*([>›❯〉→]))?$/i);
        if (killedMatch && textNodes.length > 1) {
            const countIndex = textNodes.findIndex(textNode => /^\\s*\\d+\\s*$/.test(textNode.nodeValue || ''));
            if (countIndex > 0) {
                const prefixIndex = textNodes.findIndex((textNode, index) => {
                    return index < countIndex && /^(?:Killed|已中止)$/i.test(norm(textNode.nodeValue || ''));
                });
                const suffixIndex = textNodes.findIndex((textNode, index) => {
                    return index > countIndex && /^subagents?(?:\\s*[>›❯〉→])?$/i.test(norm(textNode.nodeValue || ''));
                });
                if (prefixIndex >= 0 && suffixIndex >= 0) {
                    const hasSeparateMarker = textNodes.some((textNode, index) => {
                        return index > suffixIndex && /^[>›❯〉→]$/.test(norm(textNode.nodeValue || ''));
                    });
                    for (let i = 0; i < textNodes.length; i++) {
                        const nodeText = norm(textNodes[i].nodeValue || '');
                        if (i === prefixIndex) replaceTextNode(textNodes[i], "已中止 ");
                        else if (i === countIndex) replaceTextNode(textNodes[i], killedMatch[1]);
                        else if (i === suffixIndex) replaceTextNode(textNodes[i], " 个子智能体" + (killedMatch[2] && !hasSeparateMarker ? " " + killedMatch[2] : ""));
                        else if (/^[>›❯〉→]$/.test(nodeText)) replaceTextNode(textNodes[i], " " + nodeText);
                        else replaceTextNode(textNodes[i], '');
                    }
                    return true;
                }
            }

            const countWithUnitIndex = textNodes.findIndex(textNode => /^\\s*\\d+\\s+subagents?(?:\\s*[>›❯〉→])?\\s*$/i.test(textNode.nodeValue || ''));
            if (countWithUnitIndex > 0) {
                const prefixIndex = textNodes.findIndex((textNode, index) => {
                    return index < countWithUnitIndex && /^(?:Killed|已中止)$/i.test(norm(textNode.nodeValue || ''));
                });
                if (prefixIndex >= 0) {
                    const hasSeparateMarker = textNodes.some((textNode, index) => {
                        return index > countWithUnitIndex && /^[>›❯〉→]$/.test(norm(textNode.nodeValue || ''));
                    });
                    for (let i = 0; i < textNodes.length; i++) {
                        const nodeText = norm(textNodes[i].nodeValue || '');
                        if (i === prefixIndex) replaceTextNode(textNodes[i], "已中止");
                        else if (i === countWithUnitIndex) replaceTextNode(textNodes[i], " " + killedMatch[1] + " 个子智能体" + (killedMatch[2] && !hasSeparateMarker ? " " + killedMatch[2] : ""));
                        else if (/^[>›❯〉→]$/.test(nodeText)) replaceTextNode(textNodes[i], " " + nodeText);
                        else replaceTextNode(textNodes[i], '');
                    }
                    return true;
                }
            }
        }

        const combinedRunMatch = norm(original).match(/^(\\d+)\\s+subagents?\\s*\\/\\s*tasks?\\s+running$/i);
        const countIndex = combinedRunMatch
            ? textNodes.findIndex(textNode => /^\\s*\\d+\\s*$/.test(textNode.nodeValue || ''))
            : -1;
        if (countIndex >= 0 && textNodes.length > 1) {
            const suffixIndex = textNodes.findIndex((textNode, index) => {
                return index > countIndex && norm(textNode.nodeValue || '');
            });
            if (suffixIndex >= 0) {
                for (let i = 0; i < textNodes.length; i++) {
                    if (i === countIndex) replaceTextNode(textNodes[i], combinedRunMatch[1]);
                    else if (i === suffixIndex) replaceTextNode(textNodes[i], " 个子智能体/任务正在运行");
                    else replaceTextNode(textNodes[i], '');
                }
                return true;
            }
        }

        replaceTextNode(textNodes[0], translated);
        for (let i = 1; i < textNodes.length; i++) replaceTextNode(textNodes[i], '');
        return true;
    }

    function translateBusinessSsoOrDivider(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (element.tagName.toUpperCase() !== 'SPAN' || norm(element.textContent) !== 'OR') return false;

        const className = typeof element.className === 'string' ? element.className : '';
        const hasClass = (classes, classToken) => new RegExp('(?:^|\\\\s)' + classToken + '(?:\\\\s|$)').test(classes);
        if (!hasClass(className, 'uppercase') || !hasClass(className, 'select-none')) return false;

        const parent = element.parentElement;
        if (!parent) return false;
        const dividerCount = Array.from(parent.children || []).filter(sibling => {
            if (!sibling || sibling === element || sibling.tagName?.toUpperCase() !== 'DIV') return false;
            const siblingClasses = typeof sibling.className === 'string' ? sibling.className : '';
            return hasClass(siblingClasses, 'flex-1') && hasClass(siblingClasses, 'h-px');
        }).length;
        if (dividerCount !== 2) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length !== 1) return false;
        replaceTextNode(textNodes[0], '或');
        return true;
    }

    function translateSettingOverrides(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const rawText = element.textContent || '';
        if (!/(?:Modified\\s+in|Also\\s+modified\\s+in|修改于|也修改于)/i.test(rawText)) return false;

        let targetContainer = null;
        let current = element;
        for (let depth = 0; current && depth < 4; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE &&
                /(?:^|\\s)inline-block(?:\\s|$)/.test(current.className || '') &&
                /(?:Modified\\s+in|Also\\s+modified\\s+in|修改于|也修改于)/i.test(current.textContent || '')) {
                targetContainer = current;
                break;
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        if (!targetContainer) {
            targetContainer = element;
        }

        const textNodes = collectTextNodes(targetContainer);
        if (textNodes.length === 0) return false;

        const prefixIndex = textNodes.findIndex(node => /^(?:Also\\s+modified|Modified)\\s+in$/i.test(norm(node.nodeValue)));
        const alreadyPrefixIndex = prefixIndex >= 0 ? prefixIndex : textNodes.findIndex(node => /^(?:也修改于|修改于)$/i.test(norm(node.nodeValue)));
        const activePrefixIndex = prefixIndex >= 0 ? prefixIndex : alreadyPrefixIndex;
        if (activePrefixIndex < 0) return false;

        let isAlso = false;
        const prefixVal = norm(textNodes[activePrefixIndex].nodeValue);
        if (/^Also/i.test(prefixVal) || /^也修改于$/i.test(prefixVal)) {
            isAlso = true;
        }

        let translated = false;
        const targetPrefix = (isAlso ? "也修改于" : "修改于") + " ";
        if (textNodes[activePrefixIndex].nodeValue !== targetPrefix) {
            replaceTextNode(textNodes[activePrefixIndex], targetPrefix);
            translated = true;
        }

        for (let i = activePrefixIndex + 1; i < textNodes.length; i++) {
            const tNode = textNodes[i];
            const val = norm(tNode.nodeValue);
            if (!val) continue;

            const countMatch = val.match(/^(\\d+)\\s*(?:projects?|个?项目|workspaces?|个?工作区)\\s*$/i);
            if (countMatch) {
                const countTrans = countMatch[1] + " 个项目";
                if (tNode.nodeValue !== countTrans) {
                    replaceTextNode(tNode, countTrans);
                    translated = true;
                }
                if (i + 1 < textNodes.length) {
                    const nextVal = norm(textNodes[i + 1].nodeValue);
                    if (/^(?:projects?|个?项目|workspaces?|个?工作区)$/i.test(nextVal)) {
                        replaceTextNode(textNodes[i + 1], '');
                        translated = true;
                    }
                }
                break;
            }

            if (/^\\d+$/.test(val) && i + 1 < textNodes.length) {
                const nextVal = norm(textNodes[i + 1].nodeValue);
                if (/^(?:projects?|个?项目|workspaces?|个?工作区)$/i.test(nextVal)) {
                    const countTrans = val + " 个项目";
                    replaceTextNode(tNode, countTrans);
                    replaceTextNode(textNodes[i + 1], '');
                    translated = true;
                    break;
                }
            }

            if (/^untitled\\s+project$/i.test(val)) {
                if (tNode.nodeValue !== '无标题项目') {
                    replaceTextNode(tNode, '无标题项目');
                    translated = true;
                }
                break;
            }

            if (/^outside\\s+of\\s+project$/i.test(val)) {
                if (tNode.nodeValue !== '项目外部') {
                    replaceTextNode(tNode, '项目外部');
                    translated = true;
                }
                break;
            }
        }

        return translated;
    }

    function translateProjectPermissionsSubtitle(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (element.tagName?.toUpperCase() !== 'SPAN') return false;
        const rawText = element.textContent || '';
        if (rawText.length > 360 || !/(?:Also includes|when working in this|在此(?:项目|工作区)中工作时还包括)/i.test(rawText)) return false;

        const children = Array.from(element.children || []);
        const globalPermSpan = children.find(child => {
            return child.tagName?.toUpperCase() === 'SPAN' &&
                /^(?:Global Permissions|全局权限)$/i.test(norm(child.textContent));
        });
        if (!globalPermSpan) return false;

        const strongEl = children.find(child => child.tagName?.toUpperCase() === 'STRONG');
        const learnMoreLink = children.find(child => child.tagName?.toUpperCase() === 'A');
        const scope = /\\bworkspace\\b|工作区/i.test(rawText) ? "工作区" : "项目";
        const hasAutoPrefix = !!strongEl || /(?:was created for|是为.*自动化创建的)/i.test(rawText);

        let changed = false;
        const globalPermTextNodes = collectTextNodes(globalPermSpan);
        if (globalPermTextNodes.length === 1 && norm(globalPermTextNodes[0].nodeValue) !== "全局权限") {
            changed = replaceTextNode(globalPermTextNodes[0], "全局权限") || changed;
        }
        if (learnMoreLink) {
            const linkTextNodes = collectTextNodes(learnMoreLink);
            if (linkTextNodes.length === 1 && /^Learn more$/i.test(norm(linkTextNodes[0].nodeValue))) {
                changed = replaceTextNode(linkTextNodes[0], "了解更多") || changed;
            }
        }

        const childNodes = Array.from(element.childNodes || []);
        const strongIdx = strongEl ? childNodes.indexOf(strongEl) : -1;
        const globalIdx = childNodes.indexOf(globalPermSpan);
        const linkIdx = learnMoreLink ? childNodes.indexOf(learnMoreLink) : -1;
        if (globalIdx < 0) return false;

        const setRangeText = (startIdx, endIdx, targetText) => {
            let assigned = false;
            for (let i = startIdx; i < endIdx; i++) {
                const node = childNodes[i];
                if (node.nodeType !== Node.TEXT_NODE) continue;
                const val = assigned ? "" : targetText;
                assigned = true;
                changed = replaceTextNode(node, val) || changed;
            }
        };

        if (strongIdx >= 0 && strongIdx < globalIdx) {
            setRangeText(0, strongIdx, "此" + scope + "是为 ");
            setRangeText(strongIdx + 1, globalIdx, " 自动化创建的。在此" + scope + "中工作时还包括 ");
        } else {
            const prefix = hasAutoPrefix
                ? "此" + scope + "是为自动化创建的。在此" + scope + "中工作时还包括 "
                : "在此" + scope + "中工作时还包括 ";
            setRangeText(0, globalIdx, prefix);
        }

        if (linkIdx > globalIdx) {
            setRangeText(globalIdx + 1, linkIdx, "。");
            setRangeText(linkIdx + 1, childNodes.length, "");
        } else {
            setRangeText(globalIdx + 1, childNodes.length, "");
        }

        return changed;
    }

    function translateManagedByAutomationNotice(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (element.tagName?.toUpperCase() !== 'SPAN') return false;
        const rawText = element.textContent || '';
        if (rawText.length > 320 || !/(?:is managed by the|can only be deleted by deleting that automation|自动化管理，只能通过删除该自动化来将其删除)/i.test(rawText)) return false;

        const children = Array.from(element.children || []);
        if (children.length !== 1 || children[0].tagName?.toUpperCase() !== 'STRONG') return false;
        const strongEl = children[0];
        const scope = /\\bworkspace\\b|工作区/i.test(rawText) ? "工作区" : "项目";

        const childNodes = Array.from(element.childNodes || []);
        const strongIdx = childNodes.indexOf(strongEl);
        if (strongIdx < 0) return false;

        let changed = false;
        let assignedBefore = false;
        for (let i = 0; i < strongIdx; i++) {
            const node = childNodes[i];
            if (node.nodeType !== Node.TEXT_NODE) continue;
            const val = assignedBefore ? "" : ("此" + scope + "由 ");
            assignedBefore = true;
            changed = replaceTextNode(node, val) || changed;
        }
        let assignedAfter = false;
        for (let i = strongIdx + 1; i < childNodes.length; i++) {
            const node = childNodes[i];
            if (node.nodeType !== Node.TEXT_NODE) continue;
            const val = assignedAfter ? "" : " 自动化管理，只能通过删除该自动化来将其删除";
            assignedAfter = true;
            changed = replaceTextNode(node, val) || changed;
        }
        return changed;
    }

    function translateSearchAndArchivedGuideNotice(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const rawText = element.textContent || '';
        if (rawText.length > 260) return false;
        if (!/(?:Search conversations with|in the top left|View archived in the sidebar|使用左上角的|中查看已归档会话)/i.test(rawText)) return false;

        const childNodes = Array.from(element.childNodes || []);
        const setRangeText = (nodes, startIdx, endIdx, targetText) => {
            let changed = false;
            let assigned = false;
            for (let i = startIdx; i < endIdx; i++) {
                const node = nodes[i];
                if (node.nodeType !== Node.TEXT_NODE) continue;
                const val = assigned ? "" : targetText;
                assigned = true;
                changed = replaceTextNode(node, val) || changed;
            }
            return changed;
        };

        const directElementChildren = Array.from(element.children || []);
        const nonBrChildren = directElementChildren.filter(child => child.tagName?.toUpperCase() !== 'BR');
        if (nonBrChildren.length === 2 &&
            nonBrChildren[0].tagName?.toUpperCase() === 'SVG' &&
            nonBrChildren[1].tagName?.toUpperCase() === 'SVG' &&
            /(?:Search conversations with|使用左上角的)/i.test(rawText) &&
            /(?:View archived in the sidebar|中查看已归档会话)/i.test(rawText)) {
            const svg0Idx = childNodes.indexOf(nonBrChildren[0]);
            const svg1Idx = childNodes.indexOf(nonBrChildren[1]);
            if (svg0Idx < 0 || svg1Idx <= svg0Idx) return false;
            let changed = false;
            changed = setRangeText(childNodes, 0, svg0Idx, "使用左上角的 ") || changed;
            const brIdx = childNodes.findIndex((node, idx) => idx > svg0Idx && idx < svg1Idx && node.nodeType === Node.ELEMENT_NODE && node.tagName?.toUpperCase() === 'BR');
            if (brIdx > svg0Idx) {
                changed = setRangeText(childNodes, svg0Idx + 1, brIdx, " 搜索会话") || changed;
                changed = setRangeText(childNodes, brIdx + 1, svg1Idx, "在侧边栏（") || changed;
            } else {
                changed = setRangeText(childNodes, svg0Idx + 1, svg1Idx, " 搜索会话。在侧边栏（") || changed;
            }
            changed = setRangeText(childNodes, svg1Idx + 1, childNodes.length, " 菜单）中查看已归档会话") || changed;
            return changed;
        }

        if (directElementChildren.length === 1 &&
            directElementChildren[0].tagName?.toUpperCase() === 'SVG' &&
            /(?:Search conversations with|in the top left|使用左上角的)/i.test(rawText) &&
            !/(?:View archived|已归档会话)/i.test(rawText)) {
            const svgIdx = childNodes.indexOf(directElementChildren[0]);
            if (svgIdx < 0) return false;
            let changed = false;
            changed = setRangeText(childNodes, 0, svgIdx, "使用左上角的 ") || changed;
            changed = setRangeText(childNodes, svgIdx + 1, childNodes.length, " 搜索会话") || changed;
            return changed;
        }

        if (directElementChildren.length === 1 &&
            directElementChildren[0].tagName?.toUpperCase() === 'SVG' &&
            /(?:View archived in the sidebar|中查看已归档会话)/i.test(rawText) &&
            !/(?:Search conversations with|in the top left|使用左上角的)/i.test(rawText)) {
            const svgIdx = childNodes.indexOf(directElementChildren[0]);
            if (svgIdx < 0) return false;
            let changed = false;
            changed = setRangeText(childNodes, 0, svgIdx, "在侧边栏（") || changed;
            changed = setRangeText(childNodes, svgIdx + 1, childNodes.length, " 菜单）中查看已归档会话") || changed;
            return changed;
        }

        if (directElementChildren.length === 1 &&
            directElementChildren[0].tagName?.toUpperCase() === 'SPAN' &&
            /(?:View archived in the sidebar|中查看已归档会话)/i.test(rawText)) {
            const innerSpan = directElementChildren[0];
            const innerChildren = Array.from(innerSpan.children || []);
            if (innerChildren.length !== 1 || innerChildren[0].tagName?.toUpperCase() !== 'SVG') return false;
            const spanIdx = childNodes.indexOf(innerSpan);
            const innerNodes = Array.from(innerSpan.childNodes || []);
            const svgIdx = innerNodes.indexOf(innerChildren[0]);
            if (spanIdx < 0 || svgIdx < 0) return false;
            let changed = false;
            changed = setRangeText(childNodes, 0, spanIdx, "在侧边栏") || changed;
            changed = setRangeText(innerNodes, 0, svgIdx, "（") || changed;
            changed = setRangeText(innerNodes, svgIdx + 1, innerNodes.length, " 菜单）") || changed;
            changed = setRangeText(childNodes, spanIdx + 1, childNodes.length, "中查看已归档会话") || changed;
            return changed;
        }

        return false;
    }

    function translateSpecialContainers(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (!element.childNodes || element.childNodes.length === 0) return false;

        const rawText = element.textContent || '';
        const textLength = rawText.length;
        let translated = false;

        if (textLength <= 160 && /(?:(?:Also\\s+modified|Modified)\\s+in|修改于|也修改于)/i.test(rawText)) {
            translated = translateSettingOverrides(element) || translated;
        }
        if (textLength <= 360 && /(?:Also includes|when working in this|在此(?:项目|工作区)中工作时还包括)/i.test(rawText)) {
            translated = translateProjectPermissionsSubtitle(element) || translated;
        }
        if (textLength <= 320 && /(?:is managed by the|can only be deleted by deleting that automation|自动化管理，只能通过删除该自动化来将其删除)/i.test(rawText)) {
            translated = translateManagedByAutomationNotice(element) || translated;
        }
        if (textLength <= 260 && /(?:Search conversations with|View archived in the sidebar|使用左上角的|中查看已归档会话)/i.test(rawText)) {
            translated = translateSearchAndArchivedGuideNotice(element) || translated;
        }

        if (textLength <= 300 && /(?:archived conversations?|已归档.*(?:会话|对话)|^(?:History|历史记录)[.。]?$)/i.test(rawText.trim())) {
            translated = translateArchivedConversationNotice(element) || translated;
        }
        if (textLength <= 320 && /(?:Input disabled because|输入已禁用[，,]因为|does not exist|Create the folder in this)/i.test(rawText)) {
            translated = translateInputDisabledNotice(element) || translated;
        }
        if (textLength <= 80 && /(?:Show\\s+\\d+\\s+more|显示另外\\s+\\d+\\s+个)/i.test(rawText)) {
            translated = translateShowMoreStatus(element) || translated;
        }
        if (textLength <= 1600 && /(?:baseline quota|基础配额)/i.test(rawText)) {
            translated = translateBaselineQuotaNotice(element) || translated;
        }
        if (textLength <= 800 && /(?:weekly limit|每周配额)/i.test(rawText)) {
            translated = translateQuotaNoticeContainer(element) || translated;
        }
        if (textLength <= 1400 && /(?:quick question without interrupting|align on a plan|team of agents to autonomously|recent successes or corrections|Boost multi-agent orchestrator|Antigravity Customization System|comprehensive guide, quick reference, and sitemap|render rich interactive HTML widgets|scheduled background automation|manage and create plugins|namespaced bundles of skills|不中断主会话|通过访谈与我对齐|智能体团队自主应对|反思最近的成功或改进|Boost 多智能体编排器|个性化定制系统的综合指南|全面指南、快速参考和网站地图|交互式 HTML 小组件|定时后台自动化|计划后台自动化|管理和创建插件)/i.test(rawText)) {
            translated = translateSkillPickerEntry(element) || translated;
        }
        if (textLength <= 240 &&
            /(?:\\bCommit\\b|提交)/i.test(rawText) &&
            /(?:files?\\s*changes?|个文件.*更改)/i.test(rawText) &&
            /(?:\\bto\\b|提交到)/i.test(rawText)) {
            translated = (translateCommitSummaryContainer(element) === true) || translated;
        }
        if (textLength <= 80 && /(?:Working|处理中|工作中)/i.test(rawText)) {
            translated = translateAgentLoadingStatus(element) || translated;
            translated = translateWorkingStatusContainer(element) || translated;
        }
        if (textLength <= 120 && /(?:\\bresults?\\b|个结果|(?:Comments?|评论)\\s*[（(]\\s*\\d+|(?:\\d+\\s+)?(?:Side Questions?|侧边提问)(?:\\s*[（(]\\s*\\d+|\\b)|Listed|列出了|\\bsubagents?\\b|子智能体|\\baccounts\\b|个账号|See all|显示全部|See\\s+\\d+\\s+more|查看另外|Show\\s+(?:submitted|more)|显示(?:已提交|更多))/i.test(rawText)) {
            translated = translateCompactCountLabelContainer(element) || translated;
        }
        if (textLength <= 240 &&
            /(?:\\bsubagents?\\b|子智能体|^Found\\s+(?:\\d+|Browsers?|浏览器)|^Timed\\s+\\d+|Messaged\\s+Root\\s+Agent|^Message\\s+from\\s+(?:Root\\s+Agent|主智能体)|^Error\\s+from\\s+|\\btasks?\\s+running\\b|\\bactive\\s+goals?\\b|^Goals?\\s+\\d+|\\bquestions?\\b)/i.test(rawText.trim())) {
            translated = translateDynamicSubagentStatusContainer(element) || translated;
        }
        if (textLength <= 600 &&
            /(?:Permanently delete|\\bincluding\\b|\\bactive conversations?\\b|\\barchived conversations?\\b|永久删除|，包含)/i.test(rawText)) {
            translated = translateProjectDeleteSummary(element) || translated;
        }
        if (textLength <= 600 &&
            /(?:This will permanently delete|这将永久删除|within it)/i.test(rawText) &&
            /(?:active (?:conversations?|chats?)|archived (?:conversations?|chats?)|个活跃会话|个已归档会话|within it)/i.test(rawText)) {
            translated = translatePermanentlyDeleteNotice(element) || translated;
        }
        if (textLength <= 600 &&
            /(?:This will archive|这将归档)/i.test(rawText) &&
            /(?:conversations?|chats?|会话|within it)/i.test(rawText)) {
            translated = translateArchiveNotice(element) || translated;
        }
        if (textLength <= 500 &&
            /(?:Configure the browser subagent|配置浏览器子智能体)/i.test(rawText) &&
            /(?:Google Chrome|to be installed)/i.test(rawText)) {
            translated = translateBrowserSubagentNotice(element) || translated;
        }
        if (element.getAttribute?.('data-testid') === 'plan-command-fyi-alert' ||
            element.querySelector?.('[data-testid="plan-command-fyi-alert"]') ||
            (textLength <= 250 && /(?:Type|类型|键入)\\s*\\/\\s*(?:and\\s+select|并选择)\\s*plan/i.test(rawText))) {
            translated = translatePlanCommandAlert(element) || translated;
        }
        if (textLength <= 300 &&
            /(?:Visit|访问)\\s*(?:Legal Help|法律帮助)/i.test(rawText) &&
            /(?:to ask for content changes for legal reasons|出于法律原因)/i.test(rawText)) {
            translated = translateLegalHelpNotice(element) || translated;
        }
        if (textLength <= 8 && element.tagName?.toUpperCase() === 'SPAN' && /^OR$/i.test(rawText.trim())) {
            translated = translateBusinessSsoOrDivider(element) || translated;
        }
        return translated;
    }

    function getCombinedStatusTranslation(value) {
        const normalized = norm(value);
        if (!normalized) return null;
        if (map.has(normalized)) return map.get(normalized);
        if (lowerMap.has(normalized.toLowerCase())) return lowerMap.get(normalized.toLowerCase());

        const versionControlTranslation = getVersionControlUiTranslation(normalized);
        if (versionControlTranslation) return versionControlTranslation;

        const workingStatusTranslation = getWorkingStatusTranslation(normalized);
        if (workingStatusTranslation) return workingStatusTranslation;

        const compactCountLabelTranslation = getCompactCountLabelTranslation(normalized);
        if (compactCountLabelTranslation) return compactCountLabelTranslation;

        const artifactTimestampTranslation = getArtifactTimestampTranslation(normalized);
        if (artifactTimestampTranslation) return artifactTimestampTranslation;

        const quotaNoticeTranslation = getQuotaNoticeTranslation(normalized);
        if (quotaNoticeTranslation) return quotaNoticeTranslation;

        const archivedConversationNoticeTranslation = getArchivedConversationNoticeTranslation(normalized);
        if (archivedConversationNoticeTranslation) return archivedConversationNoticeTranslation;

        const baselineQuotaTranslation = getBaselineQuotaRefreshTranslation(normalized);
        if (baselineQuotaTranslation) return baselineQuotaTranslation;

        const subagentStatusTranslation = getDynamicSubagentStatusTranslation(normalized);
        if (subagentStatusTranslation) return subagentStatusTranslation;

        const bracketedTaskStatusTranslation = getBracketedTaskStatusTranslation(normalized);
        if (bracketedTaskStatusTranslation) return bracketedTaskStatusTranslation;

        const productUiTranslation = getDynamicProductUiTranslation(normalized);
        if (productUiTranslation) return productUiTranslation;

        const projectDeleteSummaryTranslation = getProjectDeleteSummaryTranslation(normalized);
        if (projectDeleteSummaryTranslation) return projectDeleteSummaryTranslation;

        const customizationBudgetTranslation = getCustomizationBudgetTranslation(normalized);
        if (customizationBudgetTranslation) return customizationBudgetTranslation;

        const artifactFileCountTranslation = getArtifactFileCountTranslation(normalized);
        if (artifactFileCountTranslation) return artifactFileCountTranslation;

        const commandInputStatusTranslation = getCommandInputStatusTranslation(normalized);
        if (commandInputStatusTranslation) return commandInputStatusTranslation;

        const relativeTimeTranslation = getRelativeTimeTranslation(normalized);
        if (relativeTimeTranslation) return relativeTimeTranslation;

        const showMoreMatch = normalized.match(/^Show\\s+(\\d+)\\s+more(?:\\.\\.\\.|…)?$/i);
        if (showMoreMatch) return "显示另外 " + showMoreMatch[1] + " 个...";

        const geminiAvailableMatch = normalized.match(/^Gemini\\s+(.+?)\\s+is now available$/i);
        if (geminiAvailableMatch) return "Gemini " + geminiAvailableMatch[1] + " 现已可用";

        const exploredTrans = translateExploredStatus(normalized);
        if (exploredTrans) return exploredTrans;

        const toolMatch = normalized.match(/^(\\d+)\\s+tools?\\s+enabled$/i);
        if (toolMatch) return toolMatch[1] + " 个工具已启用";

        const scheduleMatch = normalized.match(/^All (scheduled tasks|automations) run (?:as|with the)\\s+(.+?)(?:\\s+model)?[.。]?$/i);
        if (scheduleMatch) {
            const entity = scheduleMatch[1].toLowerCase() === "automations" ? "自动化" : "计划任务";
            const model = scheduleMatch[2].replace(/[.。]+$/, '').trim();
            if (model) return "所有" + entity + "均以 " + model + " 模型运行";
        }
        const viewArchivedHistMatch = normalized.match(/^View(?:\\s+(\\d+))?\\s+archived conversations?\\s+in\\s+History[.。]?$/i);
        if (viewArchivedHistMatch) {
            return viewArchivedHistMatch[1]
                ? "在“历史记录”中查看 " + viewArchivedHistMatch[1] + " 个已归档会话"
                : "可在“历史记录”中查看已归档的会话";
        }
        const viewArchivedMatch = normalized.match(/^View(?:\\s+(\\d+))?\\s+archived conversations?(?:\\s+in)?$/i);
        if (viewArchivedMatch) {
            const countText = viewArchivedMatch[1] ? " " + viewArchivedMatch[1] + " 个" : "";
            return "查看" + countText + "已归档会话" + (/in$/i.test(normalized) ? "，请前往 " : "");
        }

        return null;
    }

    function translateCombinedTextChildren(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) {
            return false;
        }

        if (getCompactCountLabelTranslation(element.textContent || '')) return false;

        let textRun = [];
        const translateRun = () => {
            if (textRun.length < 2) return false;
            const original = textRun.map(textNode => textNode.nodeValue || '').join('');
            const translated = getCombinedStatusTranslation(original);
            if (!translated || translated === original) return false;
            replaceTextNode(textRun[0], translated);
            for (let i = 1; i < textRun.length; i++) replaceTextNode(textRun[i], '');
            return true;
        };

        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                textRun.push(child);
                continue;
            }
            if (translateRun()) return true;
            textRun = [];
        }
        return translateRun();
    }

    function translateQuestionnaireOptionLabel(node, value) {
        const normalized = norm(value);
        const bilingualMatch = normalized.match(/^(.+?[\\u3400-\\u9fff].*?)\\s*[（(]([A-Za-z][A-Za-z0-9 .,'’/&+:#-]*)[)）]$/);
        if (!bilingualMatch) return null;

        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        let optionRow = null;
        for (let depth = 0; current && depth < 6; depth++) {
            const rowText = norm(current.textContent);
            const isCompactLabelRow = rowText.endsWith(normalized)
                && rowText.length <= normalized.length + 32;
            const isInteractive = isCompactLabelRow
                && current.matches?.('button, [role="button"], [role="option"], [role="radio"], [role="checkbox"], [tabindex]');
            const isNumberedRow = isCompactLabelRow && /^\\d+\\s*/.test(rowText);
            if (isInteractive || isNumberedRow) {
                optionRow = current;
                break;
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        if (!optionRow) return null;

        current = optionRow.parentElement || (optionRow.getRootNode?.().host ?? null);
        for (let depth = 0; current && depth < 10; depth++) {
            if (current === document.body || current === document.documentElement) break;
            const cardText = norm(current.textContent);
            const hasProgress = /\\b\\d+\\s+of\\s+\\d+\\b/i.test(cardText);
            const hasActions = /(?:Skip|跳过)/i.test(cardText) && /(?:Continue|继续)/i.test(cardText);
            if (cardText.length <= 4000 && hasProgress && hasActions) return bilingualMatch[1].trim();
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return null;
    }

    function translateFragmentedStatus(node, originalVal) {
        const currentText = norm(originalVal);
        const previous = findPreviousTextNode(node);
        const previousText = previous ? norm(previous.nodeValue) : '';

        if (/^to be installed\\.?$/i.test(currentText)) {
            const parentText = node && node.parentElement ? (node.parentElement.textContent || '') : '';
            if (/^Google Chrome$/i.test(previousText) || /(?:browser subagent|浏览器子智能体|Google Chrome)/i.test(parentText)) {
                return "。";
            }
        }
        if (/^to ask for content changes for legal reasons[.。]?$/i.test(currentText)) {
            const parentText = node && node.parentElement ? (node.parentElement.textContent || '') : '';
            if (/^(?:Legal Help|法律帮助)$/i.test(previousText) || /(?:Legal Help|法律帮助)/i.test(parentText)) {
                return " 页面";
            }
        }
        if (/^Visit$/i.test(currentText)) {
            const parentText = node && node.parentElement ? (node.parentElement.textContent || '') : '';
            if (/(?:Legal Help|法律帮助)/i.test(parentText) && /(?:to ask for content changes for legal reasons|出于法律原因)/i.test(parentText)) {
                return "若出于法律原因需要申请更改内容，请访问 ";
            }
        }
        const toBeInstalledMatch = currentText.match(/^to be installed\\.\\s*(.+)$/i);
        if (toBeInstalledMatch) {
            const parentText = node && node.parentElement ? (node.parentElement.textContent || '') : '';
            if (/^Google Chrome$/i.test(previousText) || /(?:browser subagent|浏览器子智能体|Google Chrome)/i.test(parentText)) {
                const rest = toBeInstalledMatch[1];
                const restTrans = map.get(norm(rest)) || lowerMap.get(norm(rest).toLowerCase()) || rest;
                return "。" + restTrans;
            }
        }

        const commentCountMatch = currentText.match(/^[（(]\\s*(\\d+)\\s*[)）]$/);
        if (commentCountMatch && /^(?:Comments?|评论)$/i.test(previousText)) {
            replaceTextNode(previous, "评论");
            return "（" + commentCountMatch[1] + "）";
        }

        const statusItemMatch = currentText.match(new RegExp('^(files?|folders?|pages?|search(?:es)?|tasks?|commands?|tools?|rules?|repos(?:itories)?|images?|actions?)(\\s*,\\s*|\\s*' + EXPLORED_STATUS_SUFFIX + ')?$', 'i'));
        if (statusItemMatch && previous) {
            const unit = getExploredStatusUnit(statusItemMatch[1]);
            const tail = statusItemMatch[2] || '';
            const translatedTail = /,/.test(tail) ? '、' : tail;
            const prefixedCount = previousText.match(/^(?:Explored|探索了)\\s+(\\d+)$/i);
            if (prefixedCount) {
                replaceTextNode(previous, "探索了 " + prefixedCount[1]);
                return " " + unit + translatedTail;
            }
            const prefixedRanCount = previousText.match(/^(?:ran|运行了)\\s+(\\d+)$/i);
            if (prefixedRanCount) {
                replaceTextNode(previous, "运行了 " + prefixedRanCount[1]);
                return " " + unit + translatedTail;
            }
            if (/^\\d+$/.test(previousText)) return " " + unit + translatedTail;
        }

        let statusMatch = currentText.match(/^(?:subagents?|子智能体)(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch && /^Found$/i.test(previousText)) {
            replaceTextNode(previous, "已找到");
            return "子智能体" + (statusMatch[1] ? " " + statusMatch[1] : "");
        }

        statusMatch = currentText.match(/^(?:Browsers?|浏览器)(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch && /^Found$/i.test(previousText)) {
            replaceTextNode(previous, "已找到");
            return "浏览器" + (statusMatch[1] ? " " + statusMatch[1] : "");
        }

        statusMatch = currentText.match(/^(\\d+)\\s+subagents?(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch && /^Found$/i.test(previousText)) {
            replaceTextNode(previous, "找到");
            return " " + statusMatch[1] + " 个子智能体" + (statusMatch[2] ? " " + statusMatch[2] : "");
        }
        if (statusMatch && /^(?:Killed|已中止)$/i.test(previousText)) {
            replaceTextNode(previous, "已中止");
            return " " + statusMatch[1] + " 个子智能体" + (statusMatch[2] ? " " + statusMatch[2] : "");
        }
        statusMatch = currentText.match(/^subagents?(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch && /^\\d+$/.test(previousText)) {
            const foundNode = findPreviousTextNode(previous);
            if (foundNode && /^Found$/i.test(norm(foundNode.nodeValue))) {
                replaceTextNode(foundNode, "找到 ");
                return " 个子智能体" + (statusMatch[1] ? " " + statusMatch[1] : "");
            }
            if (foundNode && /^(?:Killed|已中止)$/i.test(norm(foundNode.nodeValue))) {
                replaceTextNode(foundNode, "已中止 ");
                return " 个子智能体" + (statusMatch[1] ? " " + statusMatch[1] : "");
            }
        }

        statusMatch = currentText.match(/^(\\d+)\\s+(seconds?|minutes?|hours?)(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch && /^Timed$/i.test(previousText)) {
            const unit = /^second/i.test(statusMatch[2]) ? "秒" : /^minute/i.test(statusMatch[2]) ? "分钟" : "小时";
            replaceTextNode(previous, "耗时");
            return " " + statusMatch[1] + " " + unit + (statusMatch[3] ? " " + statusMatch[3] : "");
        }
        statusMatch = currentText.match(/^(seconds?|minutes?|hours?)(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch && /^\\d+$/.test(previousText)) {
            const timedNode = findPreviousTextNode(previous);
            if (timedNode && /^Timed$/i.test(norm(timedNode.nodeValue))) {
                const unit = /^second/i.test(statusMatch[1]) ? "秒" : /^minute/i.test(statusMatch[1]) ? "分钟" : "小时";
                replaceTextNode(timedNode, "耗时 ");
                return " " + unit + (statusMatch[2] ? " " + statusMatch[2] : "");
            }
        }

        statusMatch = currentText.match(/^Root\\s+Agent(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch && /^Messaged$/i.test(previousText)) {
            replaceTextNode(previous, "已向");
            return "主智能体发送消息" + (statusMatch[1] ? " " + statusMatch[1] : "");
        }

        statusMatch = currentText.match(/^(\\d+)\\s+active\\s+goals?$/i);
        if (statusMatch && /^(\\d+)\\s+tasks?\\s+running,?$/i.test(previousText)) {
            const taskCount = previousText.match(/^(\\d+)/)[1];
            replaceTextNode(previous, taskCount + " 个任务正在运行，");
            return statusMatch[1] + " 个活跃目标";
        }
        if (/^active\\s+goals?$/i.test(currentText) && /^\\d+$/.test(previousText)) {
            return " 个活跃目标";
        }

        if (/^found$/i.test(currentText) && previousText === "项目") {
            const noNode = findPreviousTextNode(previous);
            if (noNode && /^No$/i.test(norm(noNode.nodeValue))) {
                replaceTextNode(noNode, '');
                replaceTextNode(previous, "未找到项目");
                return '';
            }
        }

        if (/^(?:when not in a project|in this project|in this workspace|in this conversation)$/i.test(currentText) && previous) {
            const isAllow = /^(?:Yes, and always allow|是，且始终允许)$/i.test(previousText);
            const isSaveRule = /^(?:Yes, save rule|是，保存规则)$/i.test(previousText);
            if (isAllow || isSaveRule) {
                let scopeTrans = "";
                if (/^in this project$/i.test(currentText)) scopeTrans = "在此项目中";
                else if (/^when not in a project$/i.test(currentText)) scopeTrans = "在不属于任何项目时";
                else if (/^in this workspace$/i.test(currentText)) scopeTrans = "在此工作区中";
                else if (/^in this conversation$/i.test(currentText)) scopeTrans = "在此会话中";

                if (isAllow) {
                    replaceTextNode(previous, "是，且" + scopeTrans + "始终允许");
                } else {
                    replaceTextNode(previous, "是，" + scopeTrans + "保存规则");
                }
                return '';
            }
        }

        if (/^s\\s+enabled$/i.test(currentText) && previous) {
            const countAndTool = previousText.match(/^(\\d+)\\s+tools?$/i);
            if (countAndTool) {
                replaceTextNode(previous, countAndTool[1] + " 个工具已启用");
                return '';
            }
        }

        const isEnabledSuffix = /^s\\s+enabled$/i.test(currentText) || /^enabled$/i.test(currentText);
        if (isEnabledSuffix && previous) {
            let toolNode = previous;
            let toolText = previousText;

            if (/^s$/i.test(toolText) && /^enabled$/i.test(currentText)) {
                toolNode = findPreviousTextNode(previous);
                toolText = toolNode ? norm(toolNode.nodeValue) : '';
                replaceTextNode(previous, '');
            }

            const countNode = toolNode ? findPreviousTextNode(toolNode) : null;
            const countText = countNode ? norm(countNode.nodeValue) : '';
            if (/^(?:tool|tools|工具)$/i.test(toolText) && /^\\d+$/.test(countText)) {
                replaceTextNode(toolNode, '');
                return " 个工具已启用";
            }
        }

        if (previousText === "所有计划任务均以" && currentText && !/[\\u4e00-\\u9fff]/.test(currentText)) {
            const model = currentText.replace(/[.。]+$/, '').trim();
            if (model) return model + " 模型运行";
        }

        if (/^[.。]$/.test(currentText) && /模型运行$/.test(previousText)) {
            return '';
        }

        if (/^\\?\\s*(?:This action cannot be undone\\.?)?$/i.test(currentText) && previous) {
            let candidate = previous;
            for (let i = 0; i < 6 && candidate; i++) {
                if (/^您确定要删除(?:计划)?任务$/.test(norm(candidate.nodeValue))) {
                    return /This action cannot be undone/i.test(currentText)
                        ? " 吗？此操作无法撤销"
                        : " 吗？";
                }
                candidate = findPreviousTextNode(candidate);
            }
        }

        if (currentText === '?' && previous) {
            let candidate = previous;
            let hasProjectScope = false;
            for (let i = 0; i < 8 && candidate; i++) {
                const candidateText = norm(candidate.nodeValue);
                if (/^(?:project|workspace|项目|工作区)$/i.test(candidateText)) {
                    hasProjectScope = true;
                } else if (candidateText === "您确定要删除" && hasProjectScope) {
                    return " 吗？";
                }
                candidate = findPreviousTextNode(candidate);
            }
        }

        if (/^in$/i.test(currentText) && (previousText === "个已归档会话" || previousText === "已归档会话" || previousText === "个已归档对话" || previousText === "已归档对话" || previousText === "archived conversation" || previousText === "archived conversations")) {
            let viewNode = findPreviousTextNode(previous);
            let hasNumber = false;
            if (viewNode && /^\\d+$/.test(norm(viewNode.nodeValue))) {
                hasNumber = true;
                viewNode = findPreviousTextNode(viewNode);
            }
            const articleNodes = [];
            while (viewNode && /^(?:a|an|个)$/i.test(norm(viewNode.nodeValue))) {
                articleNodes.push(viewNode);
                viewNode = findPreviousTextNode(viewNode);
            }
            if (viewNode && /^(?:View|视图|查看)$/i.test(norm(viewNode.nodeValue))) {
                for (const articleNode of articleNodes) replaceTextNode(articleNode, '');
                replaceTextNode(viewNode, "查看");
                if (!hasNumber) {
                    replaceTextNode(previous, "已归档的会话");
                }
                return "，请前往 ";
            }
        }

        return null;
    }

    function translateNode(node, parentContainersScanned = false) {
        try {
            if (!node) return;

            if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                for (const child of node.childNodes) translateNode(child);
                return;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toUpperCase();

                let isBlocked = BLOCKED_TAGS.includes(tag);
                if (!isBlocked) {
                    const className = node.className || '';
                    if (typeof className === 'string') {
                        if (BLOCKED_CLASSES.some(cls => className.includes(cls))) {
                            isBlocked = true;
                        }
                    }
                }
                if (node.getAttribute('contenteditable') === 'true') {
                    isBlocked = true;

                    for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'aria-label', 'title']) {
                        const value = node.getAttribute(attr);
                        if (!value) continue;
                        const normalizedValue = norm(value);
                        const shortcutTranslation = translateWithShortcut(normalizedValue);
                        const versionControlTranslation = getVersionControlUiTranslation(normalizedValue);
                        let target = null;
                        if (versionControlTranslation) target = versionControlTranslation;
                        else if (shortcutTranslation) target = shortcutTranslation;
                        else if (map.has(normalizedValue)) target = map.get(normalizedValue);
                        else if (lowerMap.has(normalizedValue.toLowerCase())) target = lowerMap.get(normalizedValue.toLowerCase());
                        if (target && target !== value) node.setAttribute(attr, target);
                    }
                }

                const shouldMarkBlocked = isBlocked &&
                    (!BLOCKED_TAGS.includes(tag) || AUTO_TRANSLATE_PROTECTED_TAGS.has(tag));
                if (shouldMarkBlocked) {
                    if (node.getAttribute('translate') !== 'no') {
                        node.setAttribute('translate', 'no');
                    }
                    try {
                        if (!node.classList.contains('notranslate')) {
                            node.classList.add('notranslate');
                        }
                    } catch (e) {}
                }

                if (BLOCKED_TAGS.includes(tag)) {
                    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SVG') {
                        for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'title', 'aria-label']) {
                            const v = node.getAttribute(attr);
                            if (v) {
                                const searchingTrans = getSearchingStatusTranslation(v);
                                if (searchingTrans && searchingTrans !== v) {
                                    node.setAttribute(attr, searchingTrans);
                                } else if (!isInBlockedZone(node.parentElement)) {
                                    const t = norm(v);
                                    const shortcutTrans = translateWithShortcut(t);
                                    const versionControlTrans = getVersionControlUiTranslation(t);
                                    const dynamicSubagentTrans = getDynamicSubagentStatusTranslation(t);
                                    const dynamicProductUiTrans = getDynamicProductUiTranslation(t);
                                    const compactCountTrans = getCompactCountLabelTranslation(t);
                                    const exploredTrans = translateExploredStatus(t);
                                    let target = null;
                                    if (versionControlTrans) target = versionControlTrans;
                                    else if (dynamicSubagentTrans) target = dynamicSubagentTrans;
                                    else if (dynamicProductUiTrans) target = dynamicProductUiTrans;
                                    else if (compactCountTrans) target = compactCountTrans;
                                    else if (exploredTrans) target = exploredTrans;
                                    else if (shortcutTrans) target = shortcutTrans;
                                    else if (map.has(t)) target = map.get(t);
                                    else if (lowerMap.has(t.toLowerCase())) target = lowerMap.get(t.toLowerCase());
                                    if (target && target !== v) node.setAttribute(attr, target);
                                }
                            }
                        }
                    }
                    return;
                }

                if (!isInBlockedZone(node)) {
                    translateSpecialContainers(node);
                    translateCombinedTextChildren(node);
                    for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'title', 'aria-label']) {
                        const v = node.getAttribute(attr);
                        if (v) {
                            const searchingTrans = getSearchingStatusTranslation(v);
                            if (searchingTrans && searchingTrans !== v) {
                                node.setAttribute(attr, searchingTrans);
                            } else {
                                const t = norm(v);
                                const shortcutTrans = translateWithShortcut(t);
                                const versionControlTrans = getVersionControlUiTranslation(t);
                                const dynamicSubagentTrans = getDynamicSubagentStatusTranslation(t);
                                const dynamicProductUiTrans = getDynamicProductUiTranslation(t);
                                const compactCountTrans = getCompactCountLabelTranslation(t);
                                const exploredTrans = translateExploredStatus(t);
                                let target = null;
                                if (versionControlTrans) target = versionControlTrans;
                                else if (dynamicSubagentTrans) target = dynamicSubagentTrans;
                                else if (dynamicProductUiTrans) target = dynamicProductUiTrans;
                                else if (compactCountTrans) target = compactCountTrans;
                                else if (exploredTrans) target = exploredTrans;
                                else if (shortcutTrans) target = shortcutTrans;
                                else if (map.has(t)) target = map.get(t);
                                else if (lowerMap.has(t.toLowerCase())) target = lowerMap.get(t.toLowerCase());
                                if (target && target !== v) node.setAttribute(attr, target);
                            }
                        }
                    }
                } else {
                    for (const attr of ['aria-label', 'title', 'placeholder']) {
                        const v = node.getAttribute(attr);
                        if (v) {
                            const searchingTrans = getSearchingStatusTranslation(v);
                            if (searchingTrans && searchingTrans !== v) {
                                node.setAttribute(attr, searchingTrans);
                            }
                        }
                    }
                }

                if (node.shadowRoot) translateNode(node.shadowRoot);
                for (const child of node.childNodes) translateNode(child, true);

            } else if (node.nodeType === Node.TEXT_NODE) {
                let originalVal = node.nodeValue;
                if (!originalVal || originalVal.trim().length < 1) return;
                if (translatedValues.get(node) === originalVal) return;

                if (originalVal.toLowerCase().includes('pack.info')) {
                    const parent = node.parentElement;
                    if (parent) {
                        if (parent.getAttribute('translate') !== 'no') {
                            parent.setAttribute('translate', 'no');
                        }
                        try {
                            if (!parent.classList.contains('notranslate')) {
                                parent.classList.add('notranslate');
                            }
                        } catch (e) {}
                    }
                    return;
                }

                if (isInBlockedZone(node)) {
                    const protectedProductUiTranslation = getProtectedProductUiTranslation(node, originalVal);
                    if (protectedProductUiTranslation) {
                        replaceTextNode(node, protectedProductUiTranslation);
                    }
                    return;
                }

                if (translateSkillPickerNameTextNode(node, originalVal)) return;
                if (translateCommitSummaryTextNode(node, originalVal)) return;
                if (!parentContainersScanned && translateSpecialContainers(node.parentElement)) return;
                if (translateCombinedTextChildren(node.parentElement)) return;

                let newVal = originalVal;
                const hasRecommended = /^\\(Recommended\\)(?:\\s+|$)/i.test(newVal);
                if (hasRecommended) {
                    newVal = newVal.replace(/^\\(Recommended\\)(?:\\s+|$)/i, '');
                }
                const valNorm = norm(newVal);
                const valLower = valNorm.toLowerCase();

                const shortcutTrans = translateWithShortcut(valNorm);
                const versionControlUiTrans = getVersionControlUiTranslation(valNorm);
                const fragmentedStatusTrans = translateFragmentedStatus(node, originalVal);
                const questionnaireOptionTrans = translateQuestionnaireOptionLabel(node, valNorm);
                const timestampNowTrans = getTimestampNowTranslation(node, valNorm);
                const recentProjectSectionTrans = getRecentProjectSectionTranslation(node, valNorm);
                const deleteTaskConfirmationTrans = getDeleteTaskConfirmationTranslation(node, valNorm);
                const exploredTrans = translateExploredStatus(valNorm);
                const baselineQuotaRefreshTrans = getBaselineQuotaRefreshTranslation(valNorm);
                const subagentStatusTrans = getDynamicSubagentStatusTranslation(valNorm);
                const bracketedTaskStatusTrans = getBracketedTaskStatusTranslation(valNorm);
                const productUiTrans = getDynamicProductUiTranslation(valNorm);
                const projectDeleteSummaryTrans = getProjectDeleteSummaryTranslation(valNorm);
                const customizationBudgetTrans = getCustomizationBudgetTranslation(valNorm);
                const artifactFileCountTrans = getArtifactFileCountTranslation(valNorm);
                const commandInputStatusTrans = getCommandInputStatusTranslation(valNorm);
                const relativeTimeTrans = getRelativeTimeTranslation(valNorm);
                const workingStatusTrans = getWorkingStatusTranslation(valNorm);
                const searchingStatusTrans = getSearchingStatusTranslation(valNorm);
                const compactCountLabelTrans = getCompactCountLabelTranslation(valNorm);
                const artifactTimestampTrans = getArtifactTimestampTranslation(valNorm);
                const quotaNoticeTrans = getQuotaNoticeTranslation(valNorm);
                const archivedConversationNoticeTrans = getArchivedConversationNoticeTranslation(valNorm);
                if (fragmentedStatusTrans !== null) {
                    newVal = fragmentedStatusTrans;
                } else if (questionnaireOptionTrans) {
                    newVal = questionnaireOptionTrans;
                } else if (timestampNowTrans) {
                    newVal = timestampNowTrans;
                } else if (recentProjectSectionTrans) {
                    newVal = recentProjectSectionTrans;
                } else if (deleteTaskConfirmationTrans) {
                    newVal = deleteTaskConfirmationTrans;
                } else if (shortcutTrans) {
                    newVal = shortcutTrans;
                } else if (versionControlUiTrans) {
                    newVal = versionControlUiTrans;
                } else if (exploredTrans) {
                    newVal = exploredTrans;
                } else if (baselineQuotaRefreshTrans) {
                    newVal = baselineQuotaRefreshTrans;
                } else if (subagentStatusTrans) {
                    newVal = subagentStatusTrans;
                } else if (bracketedTaskStatusTrans) {
                    newVal = bracketedTaskStatusTrans;
                } else if (productUiTrans) {
                    newVal = productUiTrans;
                } else if (projectDeleteSummaryTrans) {
                    newVal = projectDeleteSummaryTrans;
                } else if (customizationBudgetTrans) {
                    newVal = customizationBudgetTrans;
                } else if (artifactFileCountTrans) {
                    newVal = artifactFileCountTrans;
                } else if (commandInputStatusTrans) {
                    newVal = commandInputStatusTrans;
                } else if (relativeTimeTrans) {
                    newVal = relativeTimeTrans;
                } else if (workingStatusTrans) {
                    newVal = workingStatusTrans;
                } else if (searchingStatusTrans) {
                    newVal = searchingStatusTrans;
                } else if (compactCountLabelTrans) {
                    newVal = compactCountLabelTrans;
                } else if (artifactTimestampTrans) {
                    newVal = artifactTimestampTrans;
                } else if (quotaNoticeTrans) {
                    newVal = quotaNoticeTrans;
                } else if (archivedConversationNoticeTrans) {
                    newVal = archivedConversationNoticeTrans;
                } else if (map.has(valNorm)) {
                    newVal = map.get(valNorm);
                    if ((valNorm === 'Modified in' || valNorm === 'Also modified in') && /\\s$/.test(originalVal)) {
                        newVal += ' ';
                    }
                } else if (/^(?:Also\\s+modified|Modified)\\s+in\\s+(\\d+)\\s*(?:projects?|个?项目)$/i.test(valNorm)) {
                    const isAlso = /^Also/i.test(valNorm);
                    newVal = valNorm.replace(/^(?:Also\\s+modified|Modified)\\s+in\\s+(\\d+)\\s*(?:projects?|个?项目)$/i, (m, count) => (isAlso ? "也修改于 " : "修改于 ") + count + " 个项目");
                } else if (/^(?:Also\\s+modified|Modified)\\s+in\\s+(.+)$/i.test(valNorm)) {
                    const isAlso = /^Also/i.test(valNorm);
                    newVal = valNorm.replace(/^(?:Also\\s+modified|Modified)\\s+in\\s+(.+)$/i, (m, target) => {
                        const targetNorm = norm(target);
                        let translatedTarget = target;
                        if (/^untitled\\s+project$/i.test(targetNorm)) {
                            translatedTarget = "无标题项目";
                        } else if (/^outside\\s+of\\s+project$/i.test(targetNorm)) {
                            translatedTarget = "项目外部";
                        }
                        return (isAlso ? "也修改于 " : "修改于 ") + translatedTarget;
                    });
                } else if (/^Gemini\\s+(.+?)\\s+is now available$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Gemini\\s+(.+?)\\s+is now available$/i, (m, model) => "Gemini " + model + " 现已可用");
                } else if (lowerMap.has(valLower)) {
                    newVal = lowerMap.get(valLower);
                } else if (/^Refreshes in (\\d+) days?, (\\d+) hours?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Refreshes in (\\d+) days?, (\\d+) hours?$/i, (match, d, h) => {
                        return d + " 天 " + h + " 小时后刷新";
                    });
                } else if (/^Refreshes in (\\d+) hours?, (\\d+) minutes?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Refreshes in (\\d+) hours?, (\\d+) minutes?$/i, (match, h, m) => {
                        return h + " 小时 " + m + " 分钟后刷新";
                    });
                } else if (/^Refreshes in (\\d+) days?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Refreshes in (\\d+) days?$/i, (match, d) => {
                        return d + " 天后刷新";
                    });
                } else if (/^Refreshes in (\\d+) hours?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Refreshes in (\\d+) hours?$/i, (match, h) => {
                        return h + " 小时后刷新";
                    });
                } else if (/^Refreshes in (\\d+) minutes?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Refreshes in (\\d+) minutes?$/i, (match, m) => {
                        return m + " 分钟后刷新";
                    });
                } else if (/^Resets in <1m$/i.test(valNorm)) {
                    newVal = "不足 1 分钟后重置";
                } else if (/^Resets in (?:(\\d+)\\s*(?:d|days?))?\\s*,?\\s*(?:(\\d+)\\s*(?:h|hours?))?\\s*,?\\s*(?:(\\d+)\\s*(?:m|mins?|minutes?))?\\s*,?\\s*(?:(\\d+)\\s*(?:s|secs?|seconds?))?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Resets in (?:(\\d+)\\s*(?:d|days?))?\\s*,?\\s*(?:(\\d+)\\s*(?:h|hours?))?\\s*,?\\s*(?:(\\d+)\\s*(?:m|mins?|minutes?))?\\s*,?\\s*(?:(\\d+)\\s*(?:s|secs?|seconds?))?$/i, (match, d, h, m, s) => {
                        let parts = [];
                        if (d) parts.push(d + " 天");
                        if (h) parts.push(h + " 小时");
                        if (m) parts.push(m + " 分钟");
                        if (s) parts.push(s + " 秒");
                        return parts.length ? parts.join(" ") + "后重置" : match;
                    });
                } else if (/^You have used some of your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have used some of your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\.$/i, (match, d, h) => {
                        return "您已使用部分每周配额，将在 " + d + " 天 " + h + " 小时后完全刷新";
                    });
                } else if (/^You have used some of your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have used some of your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i, (match, h, m) => {
                        return "您已使用部分每周配额，将在 " + h + " 小时 " + m + " 分钟后完全刷新";
                    });
                } else if (/^You have used some of your weekly limit, it will fully refresh in (\\d+) days?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have used some of your weekly limit, it will fully refresh in (\\d+) days?\\.$/i, (match, d) => {
                        return "您已使用部分每周配额，将在 " + d + " 天后完全刷新";
                    });
                } else if (/^You have used some of your weekly limit, it will fully refresh in (\\d+) hours?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have used some of your weekly limit, it will fully refresh in (\\d+) hours?\\.$/i, (match, h) => {
                        return "您已使用部分每周配额，将在 " + h + " 小时后完全刷新";
                    });
                } else if (/^You have used some of your weekly limit, it will fully refresh in (\\d+) minutes?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have used some of your weekly limit, it will fully refresh in (\\d+) minutes?\\.$/i, (match, m) => {
                        return "您已使用部分每周配额，将在 " + m + " 分钟后完全刷新";
                    });
                } else if (/^You have used some of your weekly limit, it will fully refresh in less than a minute\\.$/i.test(valNorm)) {
                    newVal = "您已使用部分每周配额，将在不到 1 分钟后完全刷新";
                } else if (/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i, (match, h, m) => {
                        return "您已使用部分 5 小时配额，将在 " + h + " 小时 " + m + " 分钟后完全刷新";
                    });
                } else if (/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) hours?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) hours?\\.$/i, (match, h) => {
                        return "您已使用部分 5 小时配额，将在 " + h + " 小时后完全刷新";
                    });
                } else if (/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) minutes?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) minutes?\\.$/i, (match, m) => {
                        return "您已使用部分 5 小时配额，将在 " + m + " 分钟后完全刷新";
                    });
                } else if (/^You have used some of your 5-hour limit, it will fully refresh in less than a minute\\.$/i.test(valNorm)) {
                    newVal = "您已使用部分 5 小时配额，将在不到 1 分钟后完全刷新";
                } else if (/^Your 5-hour limit will refresh in (\\d+) days?, (\\d+) hours?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Your 5-hour limit will refresh in (\\d+) days?, (\\d+) hours?\\.$/i, (match, d, h) => {
                        return "您的 5 小时配额将在 " + d + " 天 " + h + " 小时后刷新";
                    });
                } else if (/^Your 5-hour limit will refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Your 5-hour limit will refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i, (match, h, m) => {
                        return "您的 5 小时配额将在 " + h + " 小时 " + m + " 分钟后刷新";
                    });
                } else if (/^Your 5-hour limit will refresh in (\\d+) days?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Your 5-hour limit will refresh in (\\d+) days?\\.$/i, (match, d) => {
                        return "您的 5 小时配额将在 " + d + " 天后刷新";
                    });
                } else if (/^Your 5-hour limit will refresh in (\\d+) hours?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Your 5-hour limit will refresh in (\\d+) hours?\\.$/i, (match, h) => {
                        return "您的 5 小时配额将在 " + h + " 小时后刷新";
                    });
                } else if (/^Your 5-hour limit will refresh in (\\d+) minutes?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Your 5-hour limit will refresh in (\\d+) minutes?\\.$/i, (match, m) => {
                        return "您的 5 小时配额将在 " + m + " 分钟后刷新";
                    });
                } else if (/^Your 5-hour limit will refresh in less than a minute\\.$/i.test(valNorm)) {
                    newVal = "您的 5 小时配额将在不到 1 分钟后刷新";
                } else if (/^You have hit your 5-hour limit, it will refresh in (\\d+) days?, (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your 5-hour limit, it will refresh in (\\d+) days?, (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i, (match, d, h) => {
                        return "您已达到 5 小时配额限制，将在 " + d + " 天 " + h + " 小时后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度";
                    });
                } else if (/^You have hit your 5-hour limit, it will refresh in (\\d+) hours?, (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your 5-hour limit, it will refresh in (\\d+) hours?, (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i, (match, h, m) => {
                        return "您已达到 5 小时配额限制，将在 " + h + " 小时 " + m + " 分钟后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度";
                    });
                } else if (/^Error ID:\\s*(.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Error ID:\\s*(.+)$/i, (match, id) => {
                        return "错误 ID: " + id;
                    });
                } else if (/^Models within this group:\\s*(.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Models within this group:\\s*(.+)$/i, (match, models) => {
                        return "此组内的模型: " + models;
                    });
                } else if (/^Executor is not currently running \\(error ID:\\s*(.+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Executor is not currently running \\(error ID:\\s*(.+)\\)$/i, (match, id) => {
                        return "执行器当前未运行 (错误 ID: " + id + ")";
                    });
                } else if (/^(?:Thought for|Worked for|Stopped after)\\s+([\\d\\w\\s,.]+?)(?:\\s*(>))?$/i.test(valNorm)) {
                    const durationMatch = valNorm.match(/^(Thought for|Worked for|Stopped after)\\s+([\\d\\w\\s,.]+?)(?:\\s*(>))?$/i);
                    if (durationMatch) {
                        const action = durationMatch[1].toLowerCase();
                        const arrow = durationMatch[3] ? " >" : "";
                        let actionStr = "工作了 ";
                        if (action === "thought for") actionStr = "思考了 ";
                        else if (action === "stopped after") actionStr = "在 ";

                        let durationStr = durationMatch[2]
                            .replace(/(\\d+)\\s*d(?:ays?)?/gi, "$1 天 ")
                            .replace(/(\\d+)\\s*h(?:ours?)?/gi, "$1 小时 ")
                            .replace(/([\\d\\.]+)\\s*ms/gi, "$1 毫秒 ")
                            .replace(/(\\d+)\\s*m(?:in(?:ute)?s?)?(?![a-z])/gi, "$1 分钟 ")
                            .replace(/([\\d\\.]+)\\s*s(?:ec(?:ond)?s?)?/gi, "$1 秒 ")
                            .replace(/,/g, "")
                            .replace(/\\s+/g, " ")
                            .trim();

                        if (action === "stopped after") {
                            newVal = "在 " + durationStr + " 后停止" + arrow;
                        } else {
                            newVal = actionStr + durationStr + arrow;
                        }
                    }
                } else if (/^You have hit your 5-hour limit, it will refresh in (\\d+) days?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your 5-hour limit, it will refresh in (\\d+) days?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i, (match, d) => {
                        return "您已达到 5 小时配额限制，将在 " + d + " 天后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度";
                    });
                } else if (/^You have hit your 5-hour limit, it will refresh in (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your 5-hour limit, it will refresh in (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i, (match, h) => {
                        return "您已达到 5 小时配额限制，将在 " + h + " 小时后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度";
                    });
                } else if (/^You have hit your 5-hour limit, it will refresh in (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your 5-hour limit, it will refresh in (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i, (match, m) => {
                        return "您已达到 5 小时配额限制，将在 " + m + " 分钟后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度";
                    });
                } else if (/^You have hit your 5-hour limit, it will refresh in less than a minute\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                    newVal = "您已达到 5 小时配额限制，将在不到 1 分钟后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度";
                } else if (/^You have hit your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\.$/i, (match, d, h) => {
                        return "您已达到每周配额限制，将在 " + d + " 天 " + h + " 小时后完全刷新";
                    });
                } else if (/^You have hit your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i, (match, h, m) => {
                        return "您已达到每周配额限制，将在 " + h + " 小时 " + m + " 分钟后完全刷新";
                    });
                } else if (/^You have hit your weekly limit, it will fully refresh in (\\d+) days?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your weekly limit, it will fully refresh in (\\d+) days?\\.$/i, (match, d) => {
                        return "您已达到每周配额限制，将在 " + d + " 天后完全刷新";
                    });
                } else if (/^You have hit your weekly limit, it will fully refresh in (\\d+) hours?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your weekly limit, it will fully refresh in (\\d+) hours?\\.$/i, (match, h) => {
                        return "您已达到每周配额限制，将在 " + h + " 小时后完全刷新";
                    });
                } else if (/^You have hit your weekly limit, it will fully refresh in (\\d+) minutes?\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your weekly limit, it will fully refresh in (\\d+) minutes?\\.$/i, (match, m) => {
                        return "您已达到每周配额限制，将在 " + m + " 分钟后完全刷新";
                    });
                } else if (/^You have hit your weekly limit, it will fully refresh in less than a minute\\.$/i.test(valNorm)) {
                    newVal = "您已达到每周配额限制，将在不到 1 分钟后完全刷新";
                } else if (/^Match case \\((.+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Match case \\((.+)\\)$/i, (m, k) => "区分大小写 (" + k + ")");
                } else if (/^Match whole word \\((.+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Match whole word \\((.+)\\)$/i, (m, k) => "全字匹配 (" + k + ")");
                } else if (/^Use regular expression \\((.+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Use regular expression \\((.+)\\)$/i, (m, k) => "使用正则表达式 (" + k + ")");
                } else if (/^Previous match \\((.+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Previous match \\((.+)\\)$/i, (m, k) => "上一个匹配项 (" + k + ")");
                } else if (/^Next match \\((.+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Next match \\((.+)\\)$/i, (m, k) => "下一个匹配项 (" + k + ")");
                } else if (/^Close \\((.+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Close \\((.+)\\)$/i, (m, k) => "关闭 (" + k + ")");
                } else if (/^Learn more about (.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Learn more about (.+)$/i, (match, p) => {
                        let translatedPreset = p;
                        if (p.toLowerCase() === 'default') translatedPreset = "默认 (Default)";
                        else if (p.toLowerCase() === 'full machine') translatedPreset = "全机访问 (Full Machine)";
                        else if (p.toLowerCase() === 'turbo mode') translatedPreset = "极速模式 (Turbo Mode)";
                        else if (p.toLowerCase() === 'custom') translatedPreset = "自定义 (Custom)";
                        return "了解更多关于 " + translatedPreset + " 的信息";
                    });
                } else if (/^(\\d+) tools? enabled$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+) tools? enabled$/i, (match, num) => {
                        return num + " 个工具已启用";
                    });
                } else if (/^(\\d+) active conversations?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+) active conversations?$/i, (match, num) => {
                        return num + " 个活跃会话";
                    });
                } else if (/^(\\d+) archived conversations?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+) archived conversations?$/i, (match, num) => {
                        return num + " 个已归档会话";
                    });
                } else if (/^(\\d+) tasks? running$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+) tasks? running$/i, (match, num) => {
                        return num + " 个任务正在运行";
                    });
                } else if (/^(\\d+) files? changed$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+) files? changed$/i, (match, num) => {
                        return num + " 个文件已更改";
                    });
                } else if (/^Show (\\d+) more(\\.\\.\\.|…)?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Show (\\d+) more(\\.\\.\\.|…)?$/i, (match, num) => {
                        return "显示另外 " + num + " 个...";
                    });
                } else if (/^Show (\\d+) breakdowns?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Show (\\d+) breakdowns?$/i, (match, num) => {
                        return "显示 " + num + " 项明细";
                    });
                } else if (/^See all \\((\\d+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^See all \\((\\d+)\\)$/i, (match, num) => {
                        return "显示全部 (" + num + ")";
                    });
                } else if (/^Available AI Credits: (\\d+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Available AI Credits: (\\d+)$/i, (match, num) => {
                        return "可用 AI 额度: " + num;
                    });
                } else if (/^Send feedback as\\s+(.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Send feedback as\\s+(.+)$/i, (match, email) => {
                        return "发送反馈身份为 " + email;
                    });
                } else if (/^Media\\s*\\((.+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Media\\s*\\((.+)\\)$/i, (match, timeStr) => {
                        let t = timeStr.replace(/Today/i, '今天').replace(/Yesterday/i, '昨天');
                        return "媒体 (" + t + ")";
                    });
                } else if (/^Updated\\s+(.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Updated\\s+(.+)$/i, (match, rest) => {
                        return "更新于 " + rest;
                    });
                } else if (/^All (scheduled tasks|automations) run (?:as|with the)\\s+(.+?)(?:\\s+model)?[\\.\\s]*$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^All (scheduled tasks|automations) run (?:as|with the)\\s+(.+?)(?:\\s+model)?[\\.\\s]*$/i, (match, entity, model) => {
                        const label = entity.toLowerCase() === "automations" ? "自动化" : "计划任务";
                        return "所有" + label + "均以 " + model + " 模型运行";
                    });
                } else if (/^Individual quota reached\\. Please upgrade your subscription to increase your limits\\. Resets in (.+?)\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Individual quota reached\\. Please upgrade your subscription to increase your limits\\. Resets in (.+?)\\.?$/i, (match, t) => {
                        return "个人配额已达上限。请升级订阅以提高限额。将于 " + t + " 后重置";
                    });
                } else if (/^Mark\\s+(\\d+)\\s+conversations?\\s+as\\s+read$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Mark\\s+(\\d+)\\s+conversations?\\s+as\\s+read$/i, (match, num) => {
                        return "将 " + num + " 个会话标记为已读";
                    });
                } else if (/^Mark\\s+(\\d+)\\s+conversations?\\s+as\\s+unread$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Mark\\s+(\\d+)\\s+conversations?\\s+as\\s+unread$/i, (match, num) => {
                        return "将 " + num + " 个会话标记为未读";
                    });
                } else if (/^Mark\\s+all\\s+(?:conversations?\\s+)?as\\s+read$/i.test(valNorm)) {
                    newVal = "将所有会话标记为已读";
                } else if (/^Mark\\s+all\\s+(?:conversations?\\s+)?as\\s+unread$/i.test(valNorm)) {
                    newVal = "将所有会话标记为未读";
                } else if (/^Version\\s+([\\d\\.]+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Version\\s+([\\d\\.]+)$/i, (match, v) => {
                        return "版本 " + v;
                    });
                } else if (/^(\\d+)\\s+subagents?\\s+(running|blocked|completed|failed)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)\\s+subagents?\\s+(running|blocked|completed|failed)$/i, (match, num, state) => {
                        const stateLower = state.toLowerCase();
                        let stateStr = "";
                        if (stateLower === "running") stateStr = "正在运行";
                        else if (stateLower === "blocked") stateStr = "已阻塞";
                        else if (stateLower === "completed") stateStr = "已完成";
                        else if (stateLower === "failed") stateStr = "已失败";
                        return num + " 个子智能体" + stateStr;
                    });
                } else if (/^(\\d+)\\s+questions?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)\\s+questions?$/i, (match, num) => {
                        return num + " 个问题";
                    });
                } else if (/^Asking\\s+(\\d+)\\s+questions?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Asking\\s+(\\d+)\\s+questions?$/i, (match, num) => {
                        return "正在询问 " + num + " 个问题";
                    });
                } else if (/^View\\s+(\\d+)\\s+side\\s+questions?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^View\\s+(\\d+)\\s+side\\s+questions?$/i, (match, num) => {
                        return "查看 " + num + " 个侧边提问";
                    });
                } else if (/^Asked\\s+(\\d+)\\s+questions?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Asked\\s+(\\d+)\\s+questions?$/i, (match, num) => {
                        return "已询问 " + num + " 个问题";
                    });
                } else if (/^This will permanently delete (\\d+) active (?:conversations?|chats?)(?: and (\\d+) archived (?:conversations?|chats?))? within it\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^This will permanently delete (\\d+) active (?:conversations?|chats?)(?: and (\\d+) archived (?:conversations?|chats?))? within it\\.?$/i, (match, active, archived) => {
                        if (archived) {
                            return "这将永久删除 " + active + " 个活跃会话及 " + archived + " 个已归档会话";
                        }
                        return "这将永久删除 " + active + " 个活跃会话";
                    });
                } else if (/^This will permanently delete (\\d+) archived (?:conversations?|chats?)\\s+within it\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^This will permanently delete (\\d+) archived (?:conversations?|chats?)\\s+within it\\.?$/i, (match, archived) => {
                        return "这将永久删除 " + archived + " 个已归档会话";
                    });
                } else if (/^This will archive (\\d+) active (?:conversations?|chats?)(?: and (\\d+) archived (?:conversations?|chats?))? within it\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^This will archive (\\d+) active (?:conversations?|chats?)(?: and (\\d+) archived (?:conversations?|chats?))? within it\\.?$/i, (match, active, archived) => {
                        if (archived) {
                            return "这将归档其中的 " + active + " 个活跃会话及 " + archived + " 个已归档会话";
                        }
                        return "这将归档其中的 " + active + " 个活跃会话";
                    });
                } else if (/^This will archive (\\d+)\\s*(?:active )?(?:conversations?|chats?|会话s?|个会话)(?: within it)?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^This will archive (\\d+)\\s*(?:active )?(?:conversations?|chats?|会话s?|个会话)(?: within it)?\\.?$/i, (match, count) => {
                        return "这将归档其中的 " + count + " 个会话";
                    });
                } else if (/^(?:active (?:conversations?|chats?)|个活跃会话)\\s+within it[.。]?$/i.test(valNorm)) {
                    newVal = " 个活跃会话";
                } else if (/^(?:archived (?:conversations?|chats?)|个已归档会话)\\s+within it[.。]?$/i.test(valNorm)) {
                    newVal = " 个已归档会话";
                } else if (/^(?:conversations?|chats?|会话s?|个会话)\\s+within it[.。]?$/i.test(valNorm)) {
                    newVal = " 个会话";
                } else if (/^within it[.。]?$/i.test(valNorm)) {
                    const parentText = node && node.parentElement ? (node.parentElement.textContent || '') : '';
                    if (/(?:This will permanently delete|这将永久删除|This will archive|这将归档)/i.test(parentText)) {
                        newVal = '';
                    }
                } else if (/^This will archive$/i.test(valNorm)) {
                    newVal = "这将归档其中的 ";
                } else if (/^to be installed\\.?$/i.test(valNorm)) {
                    const parentText = node && node.parentElement ? (node.parentElement.textContent || '') : '';
                    if (/(?:browser subagent|浏览器子智能体|Google Chrome)/i.test(parentText)) {
                        newVal = '。';
                    }
                } else if (/^to be installed\\.\\s*(.+)$/i.test(valNorm)) {
                    const parentText = node && node.parentElement ? (node.parentElement.textContent || '') : '';
                    if (/(?:browser subagent|浏览器子智能体|Google Chrome)/i.test(parentText)) {
                        const match = valNorm.match(/^to be installed\\.\\s*(.+)$/i);
                        const rest = match[1];
                        const restTrans = map.get(norm(rest)) || lowerMap.get(norm(rest).toLowerCase()) || rest;
                        newVal = '。' + restTrans;
                    }
                } else if (/^(.+?): context deadline exceeded$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(.+?): context deadline exceeded$/i, (match, prefix) => {
                        return prefix + ": 请求超时 (context deadline exceeded)";
                    });
                } else if (/^(.+?): i\\/o timeout$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(.+?): i\\/o timeout$/i, (match, prefix) => {
                        return prefix + ": I/O 超时 (i/o timeout)";
                    });
                } else if (/^Are you sure you want to delete (the |this )?project (.+?)\\??$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Are you sure you want to delete (the |this )?project (.+?)\\??$/i, (match, article, name) => {
                        return "您确定要删除项目 " + name + " 吗？";
                    });
                } else if (/^Permanently delete (.+?) including (\\d+) active conversations? and (\\d+) archived conversations?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Permanently delete (.+?) including (\\d+) active conversations? and (\\d+) archived conversations?\\.?$/i, (match, name, active, archived) => {
                        return "永久删除 " + name + "，包含 " + active + " 个活跃会话及 " + archived + " 个已归档会话";
                    });
                } else if (/^This will permanently delete (.+?) including (\\d+) active conversations? and (\\d+) archived conversations?(?:\\. This action cannot be undone\\.)?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^This will permanently delete (.+?) including (\\d+) active conversations? and (\\d+) archived conversations?(?:\\. This action cannot be undone\\.)?$/i, (match, name, active, archived) => {
                        return "这将永久删除 " + name + "，包含 " + active + " 个活跃会话及 " + archived + " 个已归档会话，此操作无法撤销";
                    });
                } else {
                    if (valNorm.length > 20) {
                        for (const [key, translated] of longEntries) {
                            if (key.length > 20 && key.length <= valNorm.length && valNorm.includes(key)) {
                                newVal = replaceLongDictionaryEntry(newVal, key, translated);
                            }
                        }
                    }

                    newVal = newVal.replace(/Your 5-hour limit will refresh in (\\d+) days?, (\\d+) hours?\\./gi, (match, d, h) => {
                        return "您的 5 小时配额将在 " + d + " 天 " + h + " 小时后刷新";
                    });
                    newVal = newVal.replace(/Your 5-hour limit will refresh in (\\d+) hours?, (\\d+) minutes?\\./gi, (match, h, m) => {
                        return "您的 5 小时配额将在 " + h + " 小时 " + m + " 分钟后刷新";
                    });
                    newVal = newVal.replace(/Your 5-hour limit will refresh in (\\d+) days?\\./gi, (match, d) => {
                        return "您的 5 小时配额将在 " + d + " 天后刷新";
                    });
                    newVal = newVal.replace(/Your 5-hour limit will refresh in (\\d+) hours?\\./gi, (match, h) => {
                        return "您的 5 小时配额将在 " + h + " 小时后刷新";
                    });
                    newVal = newVal.replace(/Your 5-hour limit will refresh in (\\d+) minutes?\\./gi, (match, m) => {
                        return "您的 5 小时配额将在 " + m + " 分钟后刷新";
                    });
                    newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in (\\d+) days?, (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, (match, d, h) => {
                        return "您已达到 5 小时配额限制，将在 " + d + " 天 " + h + " 小时后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度";
                    });
                    newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in (\\d+) hours?, (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, (match, h, m) => {
                        return "您已达到 5 小时配额限制，将在 " + h + " 小时 " + m + " 分钟后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度";
                    });
                    newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in (\\d+) days?\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, (match, d) => {
                        return "您已达到 5 小时配额限制，将在 " + d + " 天后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度";
                    });
                    newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, (match, h) => {
                        return "您已达到 5 小时配额限制，将在 " + h + " 小时后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度";
                    });
                    newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, (match, m) => {
                        return "您已达到 5 小时配额限制，将在 " + m + " 分钟后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度";
                    });
                    newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\./gi, (match, d, h) => {
                        return "您已使用部分每周配额，将在 " + d + " 天 " + h + " 小时后完全刷新";
                    });
                    newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\./gi, (match, h, m) => {
                        return "您已使用部分每周配额，将在 " + h + " 小时 " + m + " 分钟后完全刷新";
                    });
                    newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in (\\d+) days?\\./gi, (match, d) => {
                        return "您已使用部分每周配额，将在 " + d + " 天后完全刷新";
                    });
                    newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in (\\d+) hours?\\./gi, (match, h) => {
                        return "您已使用部分每周配额，将在 " + h + " 小时后完全刷新";
                    });
                    newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in (\\d+) minutes?\\./gi, (match, m) => {
                        return "您已使用部分每周配额，将在 " + m + " 分钟后完全刷新";
                    });
                    newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\./gi, (match, d, h) => {
                        return "您已达到每周配额限制，将在 " + d + " 天 " + h + " 小时后完全刷新";
                    });
                    newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\./gi, (match, h, m) => {
                        return "您已达到每周配额限制，将在 " + h + " 小时 " + m + " 分钟后完全刷新";
                    });
                    newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in (\\d+) days?\\./gi, (match, d) => {
                        return "您已达到每周配额限制，将在 " + d + " 天后完全刷新";
                    });
                    newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in (\\d+) hours?\\./gi, (match, h) => {
                        return "您已达到每周配额限制，将在 " + h + " 小时后完全刷新";
                    });
                    newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in (\\d+) minutes?\\./gi, (match, m) => {
                        return "您已达到每周配额限制，将在 " + m + " 分钟后完全刷新";
                    });
                    newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in less than a minute\\./gi, "您已使用部分每周配额，将在不到 1 分钟后完全刷新");
                    newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in less than a minute\\./gi, "您已达到每周配额限制，将在不到 1 分钟后完全刷新");
                    newVal = newVal.replace(/Your 5-hour limit will refresh in less than a minute\\./gi, "您的 5 小时配额将在不到 1 分钟后刷新");
                    newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in less than a minute\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, "您已达到 5 小时配额限制，将在不到 1 分钟后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度");
                    newVal = newVal.replace(/Match case \\((.+)\\)/gi, (m, k) => "区分大小写 (" + k + ")");
                    newVal = newVal.replace(/Match whole word \\((.+)\\)/gi, (m, k) => "全字匹配 (" + k + ")");
                    newVal = newVal.replace(/Use regular expression \\((.+)\\)/gi, (m, k) => "使用正则表达式 (" + k + ")");
                    newVal = newVal.replace(/Previous match \\((.+)\\)/gi, (m, k) => "上一个匹配项 (" + k + ")");
                    newVal = newVal.replace(/Next match \\((.+)\\)/gi, (m, k) => "下一个匹配项 (" + k + ")");
                    newVal = newVal.replace(/Close \\((.+)\\)/gi, (m, k) => "关闭 (" + k + ")");
                    const exploredSec3 = translateExploredStatus(newVal);
                    if (exploredSec3) {
                        newVal = exploredSec3;
                    }
                    newVal = newVal.replace(/^(\\d+)\\s+searches?\\s*>?\\s*$/i, (m, n) => n + " 次搜索");
                    newVal = newVal.replace(/^searches?\\s*>?\\s*$/i, () => "次搜索");
                    newVal = newVal.replace(/^files?\\s*>?\\s*$/i, () => "个文件");
                    newVal = newVal.replace(/^(\\d+)\\s+pages?(\\s*[>›]?)\\s*$/i, (m, n, suffix) => n + " 个页面" + suffix);
                    newVal = newVal.replace(/^(?:ran|run|executed)\\s+(\\d+)\\s+commands?(\\s*[>›]?)\\s*$/i, (m, n, suffix) => "运行了 " + n + " 条命令" + (suffix || ""));
                    newVal = newVal.replace(/^(\\d+)\\s+commands?(\\s*[>›]?)\\s*$/i, (m, n, suffix) => n + " 条命令" + (suffix || ""));
                }
                if (hasRecommended) {
                    newVal = '（推荐）' + newVal;
                }
                if (newVal !== originalVal) {
                    translatedValues.set(node, newVal);
                    node.nodeValue = newVal;
                }
            }
        } catch (e) {}
    }

    function getClaudeTimeGreeting() {
        const h = new Date().getHours();
        let customName = '';
        try {
            customName = (localStorage.getItem('__agy_greeting_name__') || '').trim();
        } catch (e) {}
        const suffix = customName ? ('，' + customName) : '';
        if (h >= 5 && h < 9) {
            return { title: '早上好' + suffix, subtitle: '新的一天开始了，今天想一起构建什么？' };
        } else if (h >= 9 && h < 12) {
            return { title: '上午好' + suffix, subtitle: '今天有什么我可以帮您构思或实现的？' };
        } else if (h >= 12 && h < 14) {
            return { title: '中午好' + suffix, subtitle: '午间时光，随时准备协助您的下一个想法。' };
        } else if (h >= 14 && h < 18) {
            return { title: '下午好' + suffix, subtitle: '下午想一起推进哪项代码或研究任务？' };
        } else if (h >= 18 && h < 23) {
            return { title: '晚上好' + suffix, subtitle: '夜幕降临，让我们专注完成今天的灵感与创作。' };
        } else {
            return { title: '夜深了' + suffix, subtitle: '静谧时刻，我依然随时在线陪伴您思考与编码。' };
        }
    }

    const AGY_LOGO_SVG = '<svg class="agy-claude-hero-logo" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M144.248 149.062C151.748 154.688 162.998 150.938 152.685 140.625C121.748 110.625 128.31 28.125 89.8727 28.125C51.4352 28.125 57.9977 110.625 27.0602 140.625C15.8102 151.875 27.9977 154.688 35.4977 149.062C64.5602 129.375 62.6852 94.6875 89.8727 94.6875C117.06 94.6875 115.185 129.375 144.248 149.062Z" fill="currentColor"/></svg>';

    const STARTER_PILLS = [
        {
            svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
            label: '架构设计与编码',
            prompt: '请帮我设计并实现以下功能模块，要求结构清晰、代码健壮：'
        },
        {
            svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>',
            label: '排查与调试问题',
            prompt: '我遇到了一个 Bug / 异常报错，请帮我定位根因并给出修复方案：'
        },
        {
            svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>',
            label: '深度重构与优化',
            prompt: '请帮我审视以下代码或工程结构，进行性能优化与代码重构：'
        },
        {
            svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
            label: '技术调研与文档',
            prompt: '请帮我深入调研以下技术方向，并整理一份结构化的对比分析报告：'
        }
    ];

    function mountClaudeStartPageHero() {
        try {
            const homeContainers = document.querySelectorAll('[class*="pt-[30vh]"]');
            homeContainers.forEach(home => {
                const inputBox = home.querySelector('[data-testid="agent-input-box"]');
                if (!inputBox || !inputBox.parentElement) return;
                const composerCol = inputBox.parentElement;
                // Find the outer column that wraps both .no-focus-agent-input and agent-input-box
                const projRow = home.querySelector('.no-focus-agent-input');
                const outerCol = (projRow && projRow.parentElement && projRow.parentElement.parentElement) || composerCol;

                // 1. Mount or update Hero Greeting at the VERY TOP of outerCol (above "无项目 v" and composer!)
                let heroEl = home.querySelector('.agy-claude-hero-greeting');
                const { title, subtitle } = getClaudeTimeGreeting();
                if (!heroEl) {
                    heroEl = document.createElement('div');
                    heroEl.className = 'agy-claude-hero-greeting';
                    heroEl.setAttribute(SKIP_TRANSLATION_ATTR, 'true');
                    heroEl.innerHTML =
                        '<div class="agy-claude-hero-main">' +
                            '<span class="agy-claude-hero-logo-wrap">' + AGY_LOGO_SVG + '</span>' +
                            '<h1 class="agy-claude-hero-title"></h1>' +
                        '</div>' +
                        '<p class="agy-claude-hero-subtitle"></p>';
                    heroEl.querySelector('.agy-claude-hero-title').textContent = title;
                    heroEl.querySelector('.agy-claude-hero-subtitle').textContent = subtitle;
                    outerCol.insertBefore(heroEl, outerCol.firstChild);
                } else {
                    if (heroEl.parentElement !== outerCol || outerCol.firstChild !== heroEl) {
                        outerCol.insertBefore(heroEl, outerCol.firstChild);
                    }
                    const titleEl = heroEl.querySelector('.agy-claude-hero-title');
                    const subEl = heroEl.querySelector('.agy-claude-hero-subtitle');
                    if (titleEl && titleEl.textContent !== title) titleEl.textContent = title;
                    if (subEl && subEl.textContent !== subtitle) subEl.textContent = subtitle;
                }

                // 2. Mount Claude Quick-Start Suggestion Pills below the composer
                let pillsEl = home.querySelector('.agy-claude-starter-pills');
                if (!pillsEl) {
                    pillsEl = document.createElement('div');
                    pillsEl.className = 'agy-claude-starter-pills';
                    pillsEl.setAttribute(SKIP_TRANSLATION_ATTR, 'true');
                    STARTER_PILLS.forEach(item => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'agy-claude-starter-pill';
                        btn.innerHTML =
                            '<span class="agy-claude-starter-pill-icon">' + item.svg + '</span>' +
                            '<span>' + item.label + '</span>';
                        btn.addEventListener('click', () => {
                            const editor = home.querySelector('[data-lexical-editor="true"]');
                            if (editor) {
                                editor.focus();
                                try {
                                    document.execCommand('selectAll', false, null);
                                    document.execCommand('insertText', false, item.prompt);
                                } catch (_) {}
                            }
                        });
                        pillsEl.appendChild(btn);
                    });
                    if (inputBox.nextSibling) {
                        composerCol.insertBefore(pillsEl, inputBox.nextSibling);
                    } else {
                        composerCol.appendChild(pillsEl);
                    }
                }
            });
        } catch (e) {}
    }

    const observer = new MutationObserver(mutations => {
        let hasChildAdditions = false;
        for (const m of mutations) {
            if (m.type === 'childList') {
                if (m.addedNodes.length > 0) hasChildAdditions = true;
                for (const n of m.addedNodes) translateNode(n);
            } else if (m.type === 'characterData') {
                translateNode(m.target);
            } else if (m.type === 'attributes') {
                translateNode(m.target);
            }
        }
        if (hasChildAdditions) {
            mountClaudeStartPageHero();
        }
    });

    const obsOpts = {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'aria-placeholder', 'data-placeholder', 'title', 'aria-label']
    };

    let engineStarted = false;
    const startEngine = () => {
        const target = document.body || document.documentElement;
        if (!target) return;
        mountClaudeStartPageHero();
        if (engineStarted) return;

        engineStarted = true;
        try {
            if (window.__agyCnObserver && typeof window.__agyCnObserver.disconnect === 'function') {
                window.__agyCnObserver.disconnect();
            }
            window.__agyCnObserver = observer;
            translateNode(target);
            observer.observe(target, obsOpts);
        } catch (e) {}
    };

    window.__agyCnRestore = () => {
        try {
            observer.disconnect();
            delete window.__agyCnObserver;
            document.querySelectorAll('.agy-claude-hero-greeting, .agy-claude-starter-pills').forEach(el => el.remove());
        } catch (_) {}
    };

    const CONTEXT_MENU_EXACT_MAP = {
        "Rename": "重命名",
        "Mark Unread": "标记为未读",
        "Mark Read": "标记为已读",
        "Copy": "复制",
        "Split": "拆分",
        "Archive": "归档",
        "Delete": "删除",
        "Conversation Name": "会话名称",
        "Conversation ID": "会话 ID",
        "Project Name": "项目名称",
        "Workspace Name": "工作区名称",
        "Worktree Name": "工作树名称",
        "Split Right": "向右拆分",
        "Split Down": "向下拆分",
        "Replace With New": "替换为新会话",
        "Remove From Split": "从拆分中移除",
        "Copy File Path": "复制文件路径",
        "Copy File Name": "复制文件名称",
        "Add to Chat": "添加到聊天",
        "Copy Image": "复制图片",
        "Save Image": "保存图片"
    };

    function translateContextMenuLabel(label, id) {
        if (typeof label !== 'string' || !label) return label;
        const itemId = String(id || '');
        if (/^group-(?!new$|remove$)/i.test(itemId)) return label;
        const trimmed = norm(label);
        if (!trimmed) return label;
        if (CONTEXT_MENU_EXACT_MAP[trimmed]) return CONTEXT_MENU_EXACT_MAP[trimmed];
        return label;
    }

    function translateContextMenuItems(items) {
        if (!Array.isArray(items)) return items;
        return items.map(item => {
            if (!item || typeof item !== 'object') return item;
            const next = Object.assign({}, item);
            if (typeof next.label === 'string') {
                next.label = translateContextMenuLabel(next.label, next.id);
            }
            if (Array.isArray(next.submenu)) {
                next.submenu = translateContextMenuItems(next.submenu);
            }
            if (Array.isArray(next.items)) {
                next.items = translateContextMenuItems(next.items);
            }
            return next;
        });
    }

    globalThis.__agTranslateContextMenuItems = translateContextMenuItems;

    const origAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function() {
        const sr = origAttachShadow.apply(this, arguments);
        try { observer.observe(sr, obsOpts); } catch(e) {}
        return sr;
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startEngine);
    } else {
        startEngine();
    }
    window.addEventListener('load', startEngine);
})();
${SIGNATURE_END}`;

    return jsSource.replace("DICT_PLACEHOLDER", dictJson).replace("REPLACEMENT_ENTRIES_PLACEHOLDER", entriesJson);
}
module.exports = { buildRendererScript };
