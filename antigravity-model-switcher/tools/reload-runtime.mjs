import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connectToAntigravity } from './cdp-utils.mjs';

const daemonPath = fileURLToPath(new URL('../../antigravity-account-switcher/core/daemon.mjs', import.meta.url));
const source = fs.readFileSync(new URL('../core/chat-injector.js', import.meta.url), 'utf8');
const cdp = await connectToAntigravity();
try {
    const idle = await cdp.evaluate(`!window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat`);
    if (!idle) throw new Error('当前有中转请求正在运行，请完成或停止后重新加载');
    const health = await fetch('http://127.0.0.1:19823/api/health', { signal: AbortSignal.timeout(3000) }).then(res => res.json());
    if (health.service !== 'antigravity-account-switcher' || health.inproc || !Number.isInteger(health.pid)) {
        throw new Error('无法安全重启独立守护进程');
    }
    const check = `$runtime = Get-CimInstance Win32_Process -Filter 'ProcessId = ${health.pid}'; if ($runtime -and $runtime.CommandLine.Contains('antigravity-account-switcher') -and $runtime.CommandLine.Contains('daemon.mjs')) { 'verified' }`;
    const verified = execFileSync('powershell.exe', ['-NoProfile', '-Command', check], { encoding: 'utf8', windowsHide: true }).trim();
    if (verified !== 'verified') throw new Error('守护进程身份校验失败');
    process.kill(health.pid);
    const child = spawn(process.execPath, [daemonPath], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
    let ready;
    for (let attempt = 0; attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        try {
            ready = await fetch('http://127.0.0.1:19823/api/health', { signal: AbortSignal.timeout(500) }).then(res => res.json());
            if (ready.ok && ready.pid !== health.pid) break;
        } catch {}
    }
    if (!ready?.ok || ready.pid === health.pid) throw new Error('守护进程未能重新启动');
    if (process.argv.includes('--refresh-renderer')) {
        const canRefresh = await cdp.evaluate(`(() => {
            const editor = document.querySelector('[data-lexical-editor="true"]');
            return !(editor?.textContent || '').trim() &&
                !document.querySelector('[data-testid="input-attachment"]') &&
                !window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat;
        })()`);
        if (!canRefresh) throw new Error('当前有未发送草稿或附件，未刷新界面；后端已重新加载');
        await cdp.call('Page.reload');
        await new Promise(resolve => setTimeout(resolve, 1000));
        for (let attempt = 0; attempt < 30; attempt++) {
            try {
                if (await cdp.evaluate(`!!document.querySelector('[data-lexical-editor="true"]')`)) break;
            } catch {}
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    await cdp.evaluate(source);
    const result = await cdp.evaluate(`(async () => {
        for (let attempt = 0; attempt < 20; attempt++) {
            await window.__AGY_MODEL_SWITCHER.refreshState();
            const state = window.__AGY_MODEL_SWITCHER.getState();
            if (state.bridge.conversationId === window.__AGY_MODEL_SWITCHER.getActiveConversationId()) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const state = window.__AGY_MODEL_SWITCHER.getState();
        if (state.bridge.conversationId !== window.__AGY_MODEL_SWITCHER.getActiveConversationId()) {
            throw new Error('当前会话的模型状态尚未加载完成');
        }
        return { mode: state.activeMode, modelCount: state.models.length,
            sidebarEntries: document.querySelectorAll('[data-agy-custom-api-nav="1"]').length,
            supportsStop: typeof window.__AGY_MODEL_SWITCHER.stopGeneration === 'function' };
    })()`);
    console.log(JSON.stringify({ daemonRestarted: true, rendererRefreshed: process.argv.includes('--refresh-renderer'), ...result }));
} finally {
    cdp.close();
}
