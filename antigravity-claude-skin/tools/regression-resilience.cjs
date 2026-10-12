const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { installNativeAppHook } = require('./install-core');
const { discoverCdp } = require('./cdp-discovery.cjs');
const { languageServerPolicy } = require('./runtime-transforms.cjs');
const http = require('node:http');
const fixtureRoot = path.join(__dirname, '..', 'backup', 'resilience-fixture');
const resources = path.join(fixtureRoot, 'resources');
const archive = path.join(resources, 'app.asar');
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; console.log('PASS ' + message); };
function mockAsar(version, preloadSize) {
    const pkg = Buffer.from(JSON.stringify({ name: 'antigravity', version, main: 'dist/updated-main.js' }));
    const preload = Buffer.alloc(preloadSize, 32);
    const header = Buffer.from(JSON.stringify({ files: { 'package.json': { offset: '0', size: pkg.length }, dist: { files: { 'preload.js': { offset: String(pkg.length), size: preload.length } } } } }));
    const prefix = Buffer.alloc(16); prefix.writeUInt32LE(header.length + 8, 4); prefix.writeUInt32LE(header.length, 12);
    fs.writeFileSync(archive, Buffer.concat([prefix, header, pkg, preload]));
}
const digest = () => crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');

async function main() {
    fs.mkdirSync(resources, { recursive: true });
    try {
        for (const [version, size] of [['2.22.0', 50], ['2.23.0', 7000], ['3.0.0', 1]]) {
            mockAsar(version, size);
            const before = digest();
            const result = installNativeAppHook({ resourcesDir: resources });
            check(result.version === version && result.main === 'dist/updated-main.js', 'bootstrap delegates to updated package metadata ' + version);
            check(before === digest(), 'archive is byte-identical with preload size ' + size);
            check(!installNativeAppHook({ resourcesDir: resources }).changed, 'repeated restoration is idempotent ' + version);
            fs.unlinkSync(path.join(resources, 'app', 'index.js'));
            check(installNativeAppHook({ resourcesDir: resources }).changed, 'removed bootstrap is restored after simulated update ' + version);
        }
        for (const source of ['const MAX_RESTARTS = 3;\nconst RESTART_COOLDOWN_MS = 2000;', 'const MAX_RESTARTS=5;const RESTART_COOLDOWN_MS=3500;']) {
            const result = languageServerPolicy(source);
            check(result.compatible && result.code.includes('999') && result.code.includes('800'), 'restart policy handles whitespace and changed numeric values');
        }
        check(!languageServerPolicy('let changed = true;').compatible, 'unrecognized restart policy reports incompatibility explicitly');
        const bundle = fs.readFileSync(path.join(__dirname, '..', 'i18n', 'claude-cn-i18n.js'), 'utf8');
        const id = bundle.match(/window\.__agyRendererBundleId===("[^"]+")/)?.[1];
        check(!!id, 'renderer bundle includes an idempotence guard');
        const busyApi = { getState: () => ({ isSendingCustomChat: true }) };
        const busyWindow = { __AGY_MODEL_SWITCHER: busyApi };
        vm.runInNewContext(bundle, { window: busyWindow });
        check(busyWindow.__AGY_MODEL_SWITCHER === busyApi, 'reinjection cannot cancel or replace an active relay');
        const idleApi = {};
        const idleWindow = { __agyRendererBundleId: JSON.parse(id), __AGY_MODEL_SWITCHER: idleApi, __agySuite:{} };
        vm.runInNewContext(bundle, { window: idleWindow, document: { getElementById: () => ({}) } });
        check(idleWindow.__AGY_MODEL_SWITCHER === idleApi, 'identical bundle reinjection preserves the existing runtime');

        // Execute the bootstrap with a mock Electron API; official code is never started.
        const loaded = [], events = {}, fakeModule = { _extensions: { '.js': () => {} } };
        class Tray { setContextMenu(menu) { this.menu = menu; } }
        const electron = { app: { commandLine: { hasSwitch: () => false, appendSwitch: () => {} }, on: (name, fn) => { events[name] = fn; } },
            Tray, Menu: { buildFromTemplate: items => ({ items }), setApplicationMenu: () => {} }, dialog: {} };
        const fakeFs = { ...fs, existsSync: () => false, readFileSync: file => /package\.json$/.test(file) ? JSON.stringify({ version: '3.1', main: 'dist/new-entry.js' }) : '' };
        const context = { module: { exports: {} }, __filename: 'bootstrap', process, console,
            setInterval:()=>({unref(){}}),
            require: name => /suite[\\/]settings\.cjs$/.test(name) ? {readSettings:()=>({skin:true,i18n:true})} : name === 'electron' ? electron : name === 'fs' ? fakeFs : name === 'path' ? path : name === 'node:module' ? fakeModule :
                name === './guardian-runtime.cjs' ? { ensureGuardian: () => {} } : name === './runtime-transforms.cjs' ? { languageServerPolicy } :
                name === './native-proxy.cjs' ? require('./native-proxy.cjs') :
                name === './renderer-startup.cjs' ? require('./renderer-startup.cjs') :
                (loaded.push(name), {}) };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'native-bootstrap.cjs'), 'utf8'), context);
        context.module.exports(resources);
        check(loaded.some(file => file.endsWith('new-entry.js')), 'bootstrap runs the current official main entry instead of a fixed dist/main.js');
        let debuggerAttached=false;
        const nativeLoad=async url=>url;
        const windowMock={loadURL:nativeLoad,getBackgroundColor:()=> '#FAFAFA',setBackgroundColor:()=>{},webContents:{loadURL:nativeLoad,on:()=>{},debugger:{isAttached:()=>debuggerAttached,attach:()=>{debuggerAttached=true;},sendCommand:async()=>({identifier:'mock'})}}};
        events['browser-window-created'](null,windowMock);
        check(windowMock.loadURL===nativeLoad&&windowMock.webContents.loadURL===nativeLoad&&!debuggerAttached,'window creation leaves official navigation and debugger lifecycle untouched');
        check(await windowMock.loadURL('https://127.0.0.1:1234/')==='https://127.0.0.1:1234/','official navigation completes without waiting for suite preparation');
        for (const [label, expected] of [['1 agent running', '1 个智能体运行中'], ['12 agents running', '12 个智能体运行中'], ['No agents running', '无运行中的智能体']]) {
            const tray = new electron.Tray(), menu = { items: [{ label }] };
            tray.setContextMenu(menu);
            check(menu.items[0].label === expected, 'dynamic tray translation: ' + label);
        }
        const server = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            const port = server.address().port;
            res.end(JSON.stringify(req.url === '/json/version' ? { Browser: 'Chrome/fixture', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/mock` } :
                [{ type: 'page', title: 'Antigravity', url: 'http://127.0.0.1:1234', webSocketDebuggerUrl: 'ws://fixture' }]));
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const stale = path.join(fixtureRoot, 'DevToolsActivePort'); fs.writeFileSync(stale, '1\nstale-browser-path');
            const result = await discoverCdp({ portFiles: [stale], cache: false, ignoreCache: true, scan: async () => [server.address().port] });
            check(result.port === server.address().port && result.browserWebSocketUrl.endsWith('/mock'), 'stale port file falls back to verified discovery and current browser WebSocket path');
        } finally { await new Promise(resolve => server.close(resolve)); }
        console.log(`${checks} resilience checks passed; no real archive or model was modified.`);
    } finally {
        // This exact, owned fixture is inside the project backup directory.
        const resolved = path.resolve(fixtureRoot);
        assert.equal(resolved, path.resolve(__dirname, '..', 'backup', 'resilience-fixture'));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
