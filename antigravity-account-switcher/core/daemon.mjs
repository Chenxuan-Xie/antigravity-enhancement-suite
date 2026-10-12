import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleAccountApiRequest } from "./api-handler.mjs";
import { getActiveModelRequestCount } from '../../antigravity-model-switcher/core/api-handler.mjs';
import suiteSettings from '../../suite/settings.cjs';
import { execFile } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_DIR = path.join(__dirname, "..", "plugin", "sidecars", "panel");
const LOG_FILE = path.join(__dirname, "..", "data", "daemon.log");
const PORT = Number(process.env.AGY_SWITCHER_PORT || 19823);

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
  } catch {}
}

if (!globalThis.__AGY_INPROC_SWITCHER__) {
  process.on("uncaughtException", (err) => {
    log(`UncaughtException (kept alive): ${err && (err.stack || err.message || err)}`);
  });
  process.on("unhandledRejection", (reason) => {
    log(`UnhandledRejection (kept alive): ${reason && (reason.stack || reason.message || reason)}`);
  });
  process.on("exit", (code) => {
    log(`Process exiting (PID ${process.pid}) with code=${code}`);
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(sig, () => {
      log(`Received signal ${sig} on PID ${process.pid} (ignoring to stay alive)`);
    });
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

export function ensureLocalSwitcherServer() {
  if (globalThis.__AGY_SWITCHER_SERVER_LISTENING__) {
    return globalThis.__AGY_SWITCHER_SERVER__;
  }

  const server = http.createServer(async (req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

      if (url.pathname === "/api/health") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Private-Network": "true",
        });
        res.end(
          JSON.stringify({
            ok: true,
            service: "antigravity-account-switcher",
            port: PORT,
            pid: process.pid,
            inproc: Boolean(globalThis.__AGY_INPROC_SWITCHER__),
            runtimeRoot: path.resolve(__dirname,'../..'),
            activeRequests: getActiveModelRequestCount(),
          })
        );
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        const handled = await handleAccountApiRequest(req, res, url.pathname);
        if (handled) return;
      }

      const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
      const filePath = path.resolve(PANEL_DIR, rel);
      if (filePath.startsWith(PANEL_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(fs.readFileSync(filePath));
        return;
      }

      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end("Not Found");
    } catch (err) {
      log(`Request handler error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      if (!globalThis.__AGY_INPROC_SWITCHER__) {
        process.exit(0);
      }
      return;
    }
    log(`Server error: ${err.message}`);
  });

  server.listen(PORT, "127.0.0.1", () => {
    globalThis.__AGY_SWITCHER_SERVER_LISTENING__ = true;
    log(
      `Listening on http://127.0.0.1:${PORT} (PID ${process.pid}, inproc=${Boolean(
        globalThis.__AGY_INPROC_SWITCHER__
      )})`
    );
  });

  globalThis.__AGY_SWITCHER_SERVER__ = server;
  return server;
}

ensureLocalSwitcherServer();

// Recovery is optional. Without it, an installed suite backend retires when
// its app is closed, rather than becoming an unwanted permanent background job.
if(process.platform==='win32'&&!globalThis.__AGY_INPROC_SWITCHER__){
  let checking=false;
  const lifecycle=setInterval(()=>{
    if(checking||getActiveModelRequestCount()>0)return;
    try{
      if(suiteSettings.readSettings().guardian)return;
      const manifestFile=path.join(suiteSettings.root,'data','install-manifest.json');if(!fs.existsSync(manifestFile))return;
      const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
      const exe=path.join(path.dirname(manifest.resourcesDir),'Antigravity.exe').replace(/'/g,"''");
      checking=true;
      execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',`if(Get-CimInstance Win32_Process -Filter "Name='Antigravity.exe'" | Where-Object { $_.ExecutablePath -eq '${exe}' }) { 'running' }`],{windowsHide:true,timeout:5000,encoding:'utf8'},(error,stdout)=>{
        checking=false;if(!error&&stdout.trim()!=='running'&&getActiveModelRequestCount()===0){log('App closed; recovery disabled, retiring backend');process.exit(0);}
      });
    }catch(error){checking=false;log('Lifecycle check: '+error.message);}
  },20000);lifecycle.unref();
}
