/**
 * 将 Antigravity 输入框中的原生 @ / 上下文令牌展开为中转模型可读的上下文。
 *
 * 原生 Lexical 编辑器在提交时会把 mention 序列化为：
 *   [显示名](绝对路径;file)
 *   [目录名](绝对路径;directory)
 *   [文件名#L1-L20](绝对路径#L1-L20;fileLineRange)
 *   [Quote](label:Quote:%E4%BD%A0%E5%A5%BD;textBlock)
 *
 * 官方语言服务会解析这些令牌；中转 API 不会。本模块在不改变用户原文的前提下，
 * 把可解析的文件、目录、行号范围和引用块展开为附加上下文。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN_RE = /\[([^\[\]\n]+)\]\(([\s\S]*?);([A-Za-z][A-Za-z0-9]*)\)/g;
const EXPANDABLE_CASES = new Set(['file', 'directory', 'fileLineRange', 'codeContext', 'textBlock', 'link', 'browserPage']);
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.pdf', '.zip', '.7z', '.rar', '.gz', '.tar',
    '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.db', '.sqlite', '.woff', '.woff2', '.ttf', '.otf',
    '.mp3', '.mp4', '.wav', '.webm', '.mov', '.avi'
]);

function toFsPath(uri = '') {
    let value = String(uri || '').trim();
    if (!value) return '';
    if (/^file:\/\//i.test(value)) {
        try { value = fileURLToPath(value); } catch { /* keep original */ }
    }
    return path.normalize(value);
}

function readTextFile(filePath, maxBytes) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('不是文件');
    if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new Error('二进制文件已跳过');
    const bytesToRead = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(bytesToRead);
        const read = fs.readSync(fd, buffer, 0, bytesToRead, 0);
        if (buffer.subarray(0, read).includes(0)) throw new Error('二进制文件已跳过');
        const text = buffer.subarray(0, read).toString('utf8');
        return { text, truncated: stat.size > bytesToRead, size: stat.size };
    } finally {
        fs.closeSync(fd);
    }
}

function parseLineRange(uri) {
    const match = String(uri || '').match(/#L?(\d+)(?:-L?(\d+))?$/i);
    if (!match) return null;
    const start = Math.max(1, Number(match[1]));
    const end = Math.max(start, Number(match[2] || match[1]));
    return { start, end, baseUri: uri.slice(0, match.index) };
}

function selectLines(text, range) {
    const lines = text.split(/\r?\n/);
    const slice = lines.slice(range.start - 1, range.end);
    return slice.map((line, index) => `${range.start + index}: ${line}`).join('\n');
}

function decodeTextBlock(uri = '') {
    const match = String(uri).match(/^label:([^:]+):([\s\S]*)$/);
    if (!match) return null;
    let content = match[2];
    try { content = decodeURIComponent(content); } catch { /* keep */ }
    return { label: match[1], content };
}

function escapeAttribute(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * @param {string} rawPrompt 已通过 sanitizeUserContent 的用户输入
 * @param {{maxFileBytes?:number,maxTotalChars?:number,maxDirectoryEntries?:number}} options
 * @returns {{prompt:string,contextText:string,items:string[],hasSlashCommand:boolean}}
 */
export function expandComposerContext(rawPrompt = '', options = {}) {
    const maxFileBytes = Number(options.maxFileBytes) || 120_000;
    const maxTotalChars = Number(options.maxTotalChars) || 240_000;
    const maxDirectoryEntries = Number(options.maxDirectoryEntries) || 200;
    const items = [];
    let totalChars = 0;
    let hasSlashCommand = false;

    const prompt = String(rawPrompt || '').replace(TOKEN_RE, (token, displayName, rawUri, scopeCase) => {
        if (scopeCase === 'slashCommand') {
            hasSlashCommand = true;
            return token;
        }
        if (!EXPANDABLE_CASES.has(scopeCase)) return token;

        const label = String(displayName || '').trim();
        const contextParts = [];
        try {
            if (scopeCase === 'file' || scopeCase === 'fileLineRange' || scopeCase === 'codeContext') {
                const range = scopeCase === 'file' ? null : parseLineRange(rawUri);
                const filePath = toFsPath(range ? range.baseUri : rawUri);
                if (!filePath || !fs.existsSync(filePath)) throw new Error('文件不存在');
                const file = readTextFile(filePath, maxFileBytes);
                let content = file.text;
                let suffix = '';
                if (range) {
                    content = selectLines(file.text, range);
                    suffix = ` lines="${range.start}-${range.end}"`;
                }
                if (file.truncated) suffix += ` truncated="true" bytes="${file.size}"`;
                contextParts.push(`<CONTEXT_FILE path="${escapeAttribute(filePath)}"${suffix}>\n${content}\n</CONTEXT_FILE>`);
            } else if (scopeCase === 'directory') {
                const dirPath = toFsPath(rawUri);
                if (!dirPath || !fs.existsSync(dirPath)) throw new Error('目录不存在');
                const entries = fs.readdirSync(dirPath, { withFileTypes: true })
                    .slice(0, maxDirectoryEntries)
                    .map(entry => `${entry.isDirectory() ? '[D]' : '[F]'} ${entry.name}`)
                    .join('\n');
                contextParts.push(`<CONTEXT_DIRECTORY path="${escapeAttribute(dirPath)}">\n${entries}\n</CONTEXT_DIRECTORY>`);
            } else if (scopeCase === 'textBlock') {
                const block = decodeTextBlock(rawUri);
                if (!block) throw new Error('引用块无法解析');
                contextParts.push(`<CONTEXT_QUOTE label="${escapeAttribute(block.label)}">\n${block.content}\n</CONTEXT_QUOTE>`);
            } else if (scopeCase === 'link' || scopeCase === 'browserPage') {
                const url = String(rawUri || '').trim();
                if (!url) throw new Error('链接为空');
                contextParts.push(`<CONTEXT_LINK title="${escapeAttribute(label)}" url="${escapeAttribute(url)}" />`);
            }
        } catch (error) {
            items.push(`<CONTEXT_ITEM_ERROR type="${escapeAttribute(scopeCase)}" name="${escapeAttribute(label)}">${escapeAttribute(error.message)}</CONTEXT_ITEM_ERROR>`);
            return `@${label}`;
        }

        const block = contextParts.join('\n\n');
        if (!block) return token;
        if (totalChars + block.length > maxTotalChars) {
            items.push(`<CONTEXT_ITEM_ERROR type="${escapeAttribute(scopeCase)}" name="${escapeAttribute(label)}">上下文总量超过限制，已跳过</CONTEXT_ITEM_ERROR>`);
            return `@${label}`;
        }
        totalChars += block.length;
        items.push(block);
        return scopeCase === 'slashCommand' ? token : `@${label}`;
    });

    const contextText = items.length
        ? `\n\n<AGY_COMPOSER_CONTEXT>\n以下内容由用户在输入框中通过 @ 引用，已自动展开：\n${items.join('\n')}\n</AGY_COMPOSER_CONTEXT>`
        : '';

    return { prompt, contextText, items, hasSlashCommand };
}

export const __test__ = { toFsPath, parseLineRange, decodeTextBlock, TOKEN_RE };
