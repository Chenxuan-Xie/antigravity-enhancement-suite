import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleModelApiRequest } from '../../../core/api-handler.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'application/javascript; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);

async function loadSidecarSdk() {
    try {
        return await import('sidecar_sdk');
    } catch {
        const installedSdk = path.resolve(directory,'../../../..','node_modules','sidecar_sdk');
        const sdkDir = fs.existsSync(path.join(installedSdk,'package.json'))?installedSdk:path.join(process.env.USERPROFILE || os.homedir(), '.gemini', 'config', 'node_modules', 'sidecar_sdk');
        const pkg = JSON.parse(fs.readFileSync(path.join(sdkDir, 'package.json'), 'utf8'));
        return await import(pathToFileURL(path.join(sdkDir, pkg.main || 'index.js')).href);
    }
}

if (process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
    // SidecarApp is the API exported by the SDK bundled with Antigravity.
    const { SidecarApp, Response } = await loadSidecarSdk();
    const app = new SidecarApp();
    for (const [route, [name, contentType]] of files) {
        app.page(route, () => new Response(fs.readFileSync(path.join(directory, name)), { contentType }));
    }
    const routes = [
        ['/api/models', 'GET'], ['/api/models/bridge', 'GET'],
        ['/api/models', 'POST'], ['/api/models/save', 'POST'],
        ['/api/models/select', 'POST'], ['/api/models/test', 'POST'],
        ['/api/models/discover', 'POST'], ['/api/models/delete', 'POST'],
        ['/api/models/import','POST'], ['/api/models/provider','POST']
    ];
    for (const [route, method] of routes) {
        app.api(route, async data => {
            const req = new PassThrough();
            req.method = method;
            req.url = route;
            const res = new EventEmitter();
            res.headersSent = false;
            res.writableEnded = false;
            let status = 200;
            let payload;
            res.writeHead = code => { status = code; res.headersSent = true; };
            res.end = body => { payload = body; res.writableEnded = true; };
            const params = new URLSearchParams({ conversationId: data.conversationId || app.config.conversationId || 'auto' });
            const handled = handleModelApiRequest(req, res, route, params);
            req.end(method === 'GET' ? '' : JSON.stringify(data));
            await handled;
            return new Response(payload || '{}', { status, contentType: 'application/json; charset=utf-8' });
        }, method);
    }
    await app.run();
} else {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (url.pathname.startsWith('/api/models')) {
            await handleModelApiRequest(req, res, url.pathname, url.searchParams);
            return;
        }
        if (url.pathname === '/preload.js') {
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            res.end('');
            return;
        }
        const entry = files.get(url.pathname);
        if (!entry) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(path.join(directory, entry[0])));
    });
    server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
        console.log(`Standalone panel listening on http://127.0.0.1:${server.address().port}`);
    });
}
