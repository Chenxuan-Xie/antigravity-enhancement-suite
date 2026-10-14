'use strict';
const http = require('node:http');
const https = require('node:https');
const { isCommittedAppFrame } = require('./cdp-discovery.cjs');

function localPageReady(url) {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' || !['http:', 'https:'].includes(parsed.protocol)) return Promise.resolve(false);
    return new Promise(resolve => {
        // Only the app's loopback HTTPS endpoint uses a self-signed certificate.
        const request = (parsed.protocol === 'https:' ? https : http).get(parsed, { rejectUnauthorized: false, timeout: 1000 }, response => {
            const ready = response.statusCode === 200 && /^text\/html(?:;|$)/i.test(response.headers['content-type'] || '');
            response.on('error', () => {}); response.resume(); resolve(ready);
        });
        request.on('timeout', () => request.destroy());
        request.on('error', () => resolve(false));
    });
}

function createStartupRecovery(options = {}) {
    const now = options.now || Date.now, ready = options.ready || localPageReady;
    const attempts = new Map();
    return async function recover(frame, target, call) {
        if (isCommittedAppFrame(frame, target.url)) return false;
        let url;
        try { url = new URL(target.url); } catch { return false; }
        if (url.hostname !== '127.0.0.1' || !['http:', 'https:'].includes(url.protocol)) return false;
        const failed = frame.url === 'chrome-error://chromewebdata/' && frame.unreachableUrl === target.url;
        const blank = ['', 'about:blank'].includes(frame.url);
        if (!failed && !blank) return false;
        const key = target.id + ':' + url.origin;
        if (!attempts.has(key)) attempts.set(key, { firstSeen: now(), attempted: false });
        const attempt = attempts.get(key);
        if (attempt.attempted || (!failed && now() - attempt.firstSeen < 15000) || !await ready(target.url)) return false;
        const latest = (await call('Page.getFrameTree', {})).frameTree.frame;
        // Navigation may have completed while the readiness request was in flight.
        if (isCommittedAppFrame(latest, target.url)) return false;
        if (!['', 'about:blank'].includes(latest.url) &&
            !(latest.url === 'chrome-error://chromewebdata/' && latest.unreachableUrl === target.url)) return false;
        attempt.attempted = true;
        // No JS context, draft, live conversation or generation is present here.
        // Retry the failed native navigation once; ordinary chat pages never reload.
        await call('Page.reload', {});
        return true;
    };
}
module.exports = { createStartupRecovery, localPageReady };
