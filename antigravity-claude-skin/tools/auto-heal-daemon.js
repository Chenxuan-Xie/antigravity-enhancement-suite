const fs = require('node:fs');
const path = require('node:path');
const { installNativeAppHook, injectLiveViaCdp, writeIfChanged } = require('./install-core');
const { guardianAlive, ensureSwitcherDaemon, pidFile } = require('./guardian-runtime.cjs');
const { resolveResourcesDir } = require('./agy-paths.cjs');
const root = path.resolve(__dirname, '..');
const resourcesDir = resolveResourcesDir();
const logFile = path.join(root, 'backup', 'auto-heal.log');
const healthFile = path.join(root, 'backup', 'guardian-health.json');
let busy = false, stableArchive, failure = '', stopped = false;
const watchers = new Map();
const status = { pid: process.pid, revision: 'external-bootstrap-v2', startedAt: new Date().toISOString() };

function log(message) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, logFile + '.previous');
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
}

function acquireLease() {
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
        try { fs.writeFileSync(pidFile, String(process.pid), { flag: 'wx' }); return true; }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
            if (guardianAlive(pid)) return false;
            // A failed previous guardian or reused PID is not a valid lease.
            fs.unlinkSync(pidFile);
        }
    }
    return false;
}

function ensureWatchers() {
    for (const dir of [resourcesDir, path.dirname(resourcesDir)]) {
        if (watchers.has(dir) || !fs.existsSync(dir)) continue;
        try {
            const watcher = fs.watch(dir, () => { clearTimeout(watcher.debounce); watcher.debounce = setTimeout(tick, 2000); });
            watcher.on('error', () => { watcher.close(); watchers.delete(dir); });
            watcher.on('close', () => { clearTimeout(watcher.debounce); watchers.delete(dir); });
            watchers.set(dir, watcher);
        } catch {}
    }
}

async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
        const suite = path.resolve(root,'..','suite','settings.cjs');
        if (fs.existsSync(suite) && !require(suite).readSettings().guardian) { stop(); process.exit(0); }
        status.backend = await ensureSwitcherDaemon();
        ensureWatchers();
        const archive = path.join(resourcesDir, 'app.asar');
        if (fs.existsSync(archive)) {
            const stat = fs.statSync(archive), stamp = `${stat.size}:${stat.mtimeMs}`;
            // Do not read/install from an archive which the updater is still writing.
            if (stableArchive?.stamp === stamp && Date.now() - stableArchive.since >= 1500) {
                const hook = installNativeAppHook({ resourcesDir });
                status.hook = hook;
                if (hook.changed) log(`Restored external bootstrap for ${hook.version}; official ASAR unchanged`);
            } else if (stableArchive?.stamp !== stamp) stableArchive = { stamp, since: Date.now() };
        }
        try {
            status.cdp = await injectLiveViaCdp({ onlyIfMissing: true });
            status.cdpError = null;
            if (status.cdp.injected) log(`Restored ${status.cdp.injected} renderer(s), CDP ${status.cdp.port}`);
        } catch (error) { status.cdpError = error.message; }
        status.lastError = null;
        if (failure) { log('Health checks recovered'); failure = ''; }
    } catch (error) {
        status.lastError = error.message;
        if (failure !== error.message) { log('Health check failed: ' + error.message); failure = error.message; }
    } finally {
        status.lastHeartbeat = new Date().toISOString();
        writeIfChanged(healthFile, JSON.stringify(status, null, 2));
        busy = false;
    }
}

function stop() {
    stopped = true;
    for (const watcher of watchers.values()) watcher.close();
    try { if (fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(pidFile); } catch {}
}

async function main() {
    if (process.argv.includes('--oneshot')) {
        console.log(JSON.stringify(installNativeAppHook({ resourcesDir })));
        try { console.log(JSON.stringify(await injectLiveViaCdp({ onlyIfMissing: true }))); } catch (error) { console.log(error.message); }
        return;
    }
    if (!acquireLease()) return;
    process.on('exit', stop);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(0); });
    log(`Guardian ${process.pid} started; 10s heartbeat and external bootstrap restoration enabled`);
    setInterval(tick, 10000);
    await tick();
    setTimeout(tick, 2000);
}
if (require.main === module) main().catch(error => { log(error.stack || error.message); stop(); process.exit(1); });
module.exports = { acquireLease, tick };
