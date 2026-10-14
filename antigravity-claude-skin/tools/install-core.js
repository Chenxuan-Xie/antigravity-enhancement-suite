const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { discoverCdp, isCommittedAppFrame } = require('./cdp-discovery.cjs');
const recoverStartup = require('./startup-recovery.cjs').createStartupRecovery();
const { skinRoot, resolveResourcesDir, resolveNodeBin, saveInstallPathsCache } = require('./agy-paths.cjs');

const resourcesDir = resolveResourcesDir();
saveInstallPathsCache({ resourcesDir, nodeBin: resolveNodeBin() });

function readAsarPackageJson(asarFile) {
    const fd = fs.openSync(asarFile, 'r');
    try {
        const prefix = Buffer.alloc(16);
        if (fs.readSync(fd, prefix, 0, 16, 0) !== 16) throw Error('ASAR header is incomplete');
        const length = prefix.readUInt32LE(12);
        if (!length || length > 32 * 1024 * 1024) throw Error('Invalid ASAR header size');
        const header = Buffer.alloc(length);
        if (fs.readSync(fd, header, 0, length, 16) !== length) throw Error('ASAR header is incomplete');
        const node = JSON.parse(header.toString('utf8')).files?.['package.json'];
        if (!node || node.size > 1024 * 1024) throw Error('ASAR package.json is unavailable');
        const pkg = Buffer.alloc(node.size);
        if (fs.readSync(fd, pkg, 0, pkg.length, 8 + prefix.readUInt32LE(4) + Number(node.offset)) !== pkg.length) throw Error('ASAR package.json is incomplete');
        return JSON.parse(pkg.toString('utf8'));
    } finally { fs.closeSync(fd); }
}

function writeIfChanged(file, content) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.tmp-' + process.pid;
    fs.writeFileSync(temp, content);
    fs.renameSync(temp, file);
    return true;
}

function installNativeAppHook(options = {}) {
    const resources = options.resourcesDir || resolveResourcesDir();
    const pkg = readAsarPackageJson(path.join(resources, 'app.asar'));
    const main = pkg.main || 'dist/main.js';
    if (path.isAbsolute(main) || main.split(/[\\/]/).includes('..')) throw Error('Unexpected official entry point');
    const bootstrap = path.join(__dirname, 'native-bootstrap.cjs');
    const index = `"use strict";\n// AGY_EXTERNAL_BOOTSTRAP_V2; official ASAR remains untouched.\nrequire(${JSON.stringify(bootstrap)})(require('node:path').dirname(__dirname));\n`;
    const changed = writeIfChanged(path.join(resources, 'app', 'index.js'), index);
    const pkgChanged = writeIfChanged(path.join(resources, 'app', 'package.json'), JSON.stringify({ ...pkg, main: 'index.js' }, null, 2) + '\n');
    return { changed: changed || pkgChanged, version: pkg.version, main, asarModified: false };
}

async function injectLiveViaCdp(options = {}) {
    const endpoint = await discoverCdp();
    const css = fs.readFileSync(path.join(skinRoot, 'claude-theme.css'), 'utf8');
    const bundle = fs.readFileSync(path.join(skinRoot, 'i18n', 'claude-cn-i18n.js'), 'utf8');
    const hash = crypto.createHash('sha256').update(bundle).digest('hex');
    const cssHash = crypto.createHash('sha256').update(css).digest('hex');
    const bundleId = JSON.parse(bundle.match(/window\.__agyRendererBundleId===("[^"]+")/)[1]);
    let injected = 0, recovered = 0;
    for (const target of endpoint.targets.filter(t => t.type === 'page' && /^https?:\/\/127\.0\.0\.1(?::|\/)/.test(t.url || ''))) {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        const pending = new Map();
        let sequence = 0;
        let frameId,contextId;
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => { socket.close(); reject(Error('CDP connection timeout')); }, 3000);
                socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
                socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('CDP connection failed')); }, { once: true });
            });
            socket.addEventListener('message', event => {
                const msg = JSON.parse(String(event.data));
                if(msg.method==='Runtime.executionContextsCleared')contextId=undefined;
                if(msg.method==='Runtime.executionContextCreated'){const context=msg.params.context;if(context.auxData?.isDefault&&context.auxData.frameId===frameId)contextId=context.id;}
                const item = pending.get(msg.id);
                if (!item) return;
                pending.delete(msg.id); clearTimeout(item.timer);
                if (msg.error || msg.result?.exceptionDetails) item.reject(Error('Renderer injection failed'));
                else item.resolve(msg.result);
            });
            const call = (method,params) => new Promise((resolve, reject) => {
                const id = ++sequence;
                const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP evaluation timeout')); }, 8000);
                pending.set(id, { resolve, reject, timer });
                socket.send(JSON.stringify({ id, method, params }));
            });
            const frame=(await call('Page.getFrameTree',{})).frameTree.frame;
            // Runtime.enable can initialize Electron's isolated world too early.
            // Wait for the real document to commit before touching JS contexts.
            if (!isCommittedAppFrame(frame, target.url)) {
                if (await recoverStartup(frame, target, call)) recovered++;
                continue;
            }
            frameId=frame.id;
            await call('Runtime.enable',{});
            const evaluate=async expression=>(await call('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true})).result?.value;
            const condition = await evaluate(`({busy:!!window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat||!!document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]'),ready:document.readyState!=='loading'&&location.origin===${JSON.stringify(frame.securityOrigin)}&&!!document.body?.childElementCount,installed:window.__agyInstalledBundleHash===${JSON.stringify(hash)}&&window.__agyInstalledCssHash===${JSON.stringify(cssHash)}&&window.__agyRendererBundleId===${JSON.stringify(bundleId)}&&!!window.__agySuite})`);
            if (condition.busy || !condition.ready || (options.onlyIfMissing && condition.installed)) continue;
            if(options.settings)await evaluate(`window.__agySuite?.apply(${JSON.stringify(options.settings)})`);
            const initial=options.settings||require(path.resolve(skinRoot,'..','suite','settings.cjs')).readSettings();
            await evaluate('if(!window.__agySuite||window.__agyRendererBundleId!=='+JSON.stringify(bundleId)+')window.__agySuiteInitialSettings='+JSON.stringify(initial)+';\n'+bundle);
            const installed = await evaluate(`(()=>{if(window.__agyRendererBundleId!==${JSON.stringify(bundleId)})return false;window.__agyInstalledBundleHash=${JSON.stringify(hash)};window.__agyInstalledCssHash=${JSON.stringify(cssHash)};return true})()`);
            if (installed) injected++;
        } finally {
            for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('CDP closed')); }
            socket.close();
        }
    }
    return { port: endpoint.port, injected, recovered };
}

function ensureBackups() { fs.mkdirSync(path.join(skinRoot, 'backup'), { recursive: true }); }
function ensureLightThemeConfig() { /* Respect the existing user theme preference. */ }
async function main() {
    require('./build-theme.js'); require('./build-i18n.js');
    ensureBackups();
    console.log('[Hook]', JSON.stringify(installNativeAppHook()));
    try { console.log('[CDP]', JSON.stringify(await injectLiveViaCdp({ onlyIfMissing: true }))); }
    catch (error) { console.log('[CDP] Next launch will load the hook:', error.message); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { installNativeAppHook, injectLiveViaCdp, readAsarPackageJson, ensureBackups, ensureLightThemeConfig, writeIfChanged };
