const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { resolveNodeBin } = require('./agy-paths.cjs');
const root = path.resolve(__dirname, '..');
const pidFile = path.join(root, 'backup', 'daemon.pid');
const guardianScript = path.join(__dirname, 'auto-heal-daemon.js');
const nodeBin = resolveNodeBin();

function guardianAlive(pid) {
    if (!Number.isInteger(pid) || pid < 1) return false;
    try {
        process.kill(pid, 0);
        const encoded = guardianScript.replace(/'/g, "''");
        const check = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p -and $p.Name -eq 'node.exe' -and $p.CommandLine.Contains('${encoded}')){'owned'}`;
        return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', check], { windowsHide: true, timeout: 5000, encoding: 'utf8' }).trim() === 'owned';
    } catch { return false; }
}

function ensureGuardian() {
    let pid;
    try { pid = Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch {}
    if (guardianAlive(pid)) return { running: true, pid };
    const child = spawn(nodeBin, [guardianScript], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {}); child.unref();
    return { started: true, pid: child.pid };
}

async function ensureSwitcherDaemon() {
    try {
        const health = await fetch('http://127.0.0.1:19823/api/health', { signal: AbortSignal.timeout(1500) }).then(r => r.json());
        if (health.ok && health.service === 'antigravity-account-switcher') return { running: true, pid: health.pid };
        throw Error('Port 19823 is occupied by an unexpected service');
    } catch (error) {
        if (/occupied/.test(error.message)) throw error;
        const daemon = path.resolve(root, '..', 'antigravity-account-switcher', 'core', 'daemon.mjs');
        if (!fs.existsSync(daemon)) throw Error('Switcher daemon script is missing');
        const child = spawn(nodeBin, [daemon], { detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', () => {}); child.unref();
        return { started: true, pid: child.pid };
    }
}

module.exports = { guardianAlive, ensureGuardian, ensureSwitcherDaemon, guardianScript, pidFile, nodeBin };
