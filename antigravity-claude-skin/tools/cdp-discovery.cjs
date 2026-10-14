const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

let lastPort;
let scanPromise;
const cacheFile = path.join(__dirname, '..', 'backup', 'cdp-endpoint.json');

async function probe(port) {
    if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) return null;
    try {
        const base = `http://127.0.0.1:${port}`;
        const version = await fetch(base + '/json/version', { signal: AbortSignal.timeout(1000) }).then(r => r.json());
        if (!version.webSocketDebuggerUrl || !/Electron|Chrome/i.test(version.Browser || '')) return null;
        const targets = await fetch(base + '/json', { signal: AbortSignal.timeout(1000) }).then(r => r.json());
        if (!Array.isArray(targets)) return null;
        const pages = targets.filter(t => t.type === 'page' && /^https?:\/\/127\.0\.0\.1(?::|\/)/.test(t.url || ''));
        if (!pages.length) return null;
        return { port: Number(port), browserWebSocketUrl: version.webSocketDebuggerUrl, targets };
    } catch { return null; }
}

function scanOwnedPorts() {
    if (process.platform !== 'win32') return Promise.resolve([]);
    if (scanPromise) return scanPromise;
    const script = "$ids=@(Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" | Select-Object -ExpandProperty ProcessId); if($ids.Count){@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$ids -contains $_.OwningProcess -and $_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0')} | Select-Object -ExpandProperty LocalPort -Unique) | ConvertTo-Json -Compress}";
    scanPromise = new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, (error, stdout) => {
            if (error) return reject(error);
            try { const value = JSON.parse(stdout.trim() || '[]'); resolve(Array.isArray(value) ? value : [value]); }
            catch (error) { reject(error); }
        });
    }).finally(() => { scanPromise = null; });
    return scanPromise;
}

async function discoverCdp(options = {}) {
    const candidates = options.ignoreCache ? [] : [process.env.AGY_CDP_PORT, lastPort];
    if (!options.ignoreCache) { try { candidates.push(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).port); } catch {} }
    const files = options.portFiles || [
        path.join(process.env.APPDATA || '', 'Antigravity', 'DevToolsActivePort'),
        ...(process.env.AGY_APPDATA_DIR ? [path.join(process.env.AGY_APPDATA_DIR, 'DevToolsActivePort')] : [])
    ];
    for (const file of files) { try { candidates.push(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim()); } catch {} }
    const ports = [...new Set(candidates.filter(Boolean).map(Number))];
    let endpoint;
    for (const port of ports) { endpoint = await probe(port); if (endpoint) break; }
    if (!endpoint) {
        const discovered = options.scan ? await options.scan() : await scanOwnedPorts();
        const results = await Promise.all(discovered.filter(port => !ports.includes(port)).map(probe));
        endpoint = results.find(Boolean);
    }
    if (!endpoint) throw new Error('未发现可用的 Antigravity 调试端口；已校验端口文件并探测应用监听端口');
    lastPort = endpoint.port;
    if (options.cache !== false) {
        try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify({ port: endpoint.port, discoveredAt: new Date().toISOString() })); } catch {}
    }
    return endpoint;
}

function isCommittedAppFrame(frame, targetUrl) {
    try {
        const target = new URL(targetUrl), current = new URL(frame.url);
        return ['http:', 'https:'].includes(target.protocol) && target.hostname === '127.0.0.1' &&
            current.origin === target.origin && frame.securityOrigin === target.origin &&
            !!frame.loaderId && frame.mimeType === 'text/html';
    } catch { return false; }
}

module.exports = { discoverCdp, scanOwnedPorts, probe, isCommittedAppFrame };
