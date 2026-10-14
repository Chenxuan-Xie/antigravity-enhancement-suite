'use strict';
const assert = require('node:assert/strict');
const { createStartupRecovery, localPageReady } = require('./startup-recovery.cjs');
let checks = 0;
function check(value, label) { assert(value, label); checks++; console.log('PASS ' + label); }
async function main() {
    let now = 0, serverReady = false;
    const calls = [];
    const recover = createStartupRecovery({ now: () => now, ready: async () => serverReady });
    const target = { id: 'main', url: 'https://127.0.0.1:1234/' };
    const call = async (...args) => { calls.push(args); return { frameTree: { frame: { url: '' } } }; };
    check(!await recover({ url: '' }, target, call), 'initial blank navigation is given time to finish');
    now = 16000;
    check(!await recover({ url: '' }, target, call), 'startup retry waits until the local HTML server is ready');
    serverReady = true;
    check(await recover({ url: '' }, target, call) && calls.at(-1)[0] === 'Page.reload', 'stalled blank startup retries native navigation without creating a JS context');
    const firstCount = calls.length;
    check(!await recover({ url: '' }, target, call) && calls.length === firstCount, 'one window and port cannot enter a refresh loop');
    const committed = { url: target.url, securityOrigin: 'https://127.0.0.1:1234', loaderId: 'loaded', mimeType: 'text/html' };
    check(!await recover(committed, target, call), 'loaded conversation pages are never reloaded');
    const racing = createStartupRecovery({ ready: async () => true });
    check(!await racing({ url: 'chrome-error://chromewebdata/', unreachableUrl: target.url }, target,
        async method => { assert.equal(method, 'Page.getFrameTree'); return { frameTree: { frame: committed } }; }), 'a page which finishes loading during the readiness check is never reloaded');
    check(!await recover({ url: 'https://accounts.google.com/' }, target, call), 'official login navigation stays untouched');
    check(!await recover({ url: 'chrome-error://chromewebdata/', unreachableUrl: 'https://external.test/' }, target, call), 'unrelated failed navigation stays untouched');
    const failed = { url: 'chrome-error://chromewebdata/', unreachableUrl: target.url };
    const second = { ...target, id: 'fresh-window' };
    check(await recover(failed, second, call), 'failed native startup can recover immediately when the local service is healthy');
    check(!await recover(failed, second, call), 'recovery of a failed page is also limited to one attempt');
    const third = { ...target, id: 'changed-port', url: 'https://127.0.0.1:5678/' };
    check(await recover({ ...failed, unreachableUrl: third.url }, third, call), 'a restarted language server has its own recovery attempt');
    check(!await localPageReady('https://external.test/'), 'readiness checks cannot contact external hosts or follow redirects');
    console.log(`${checks} startup recovery checks passed; no real app page was reloaded.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
