import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { handleAccountApiRequest } from "../../../core/api-handler.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = path.resolve(__dirname, "../../../core/daemon.mjs");

// Ensure the background daemon on 127.0.0.1:19823 is running too
try {
  const child = spawn(process.execPath, [DAEMON_SCRIPT], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
} catch {}

let sidecar = null;
try {
  const { Sidecar } = await import("@antigravity/sidecar-sdk");
  sidecar = new Sidecar();
} catch {
  try {
    const os = await import("node:os");
    const { pathToFileURL } = await import("node:url");
    const sdkPath = path.join(os.default.homedir(), ".gemini", "config", "node_modules", "sidecar_sdk", "index.mjs");
    if (fs.existsSync(sdkPath) && process.env.ANTIGRAVITY_SIDECAR_SOCKET) {
      const { Sidecar } = await import(pathToFileURL(sdkPath).href);
      sidecar = new Sidecar();
    }
  } catch {}
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (url.pathname.startsWith("/api/")) {
    const handled = await handleAccountApiRequest(req, res, url.pathname);
    if (handled) return;
  }

  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const filePath = path.resolve(__dirname, rel);
  if (filePath.startsWith(__dirname) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(fs.readFileSync(filePath));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

const listenPort = sidecar ? 0 : Number(process.env.PORT || 0);
httpServer.listen(listenPort, "127.0.0.1", async () => {
  const { port } = httpServer.address();
  if (sidecar) {
    await sidecar.start(port);
  } else {
    console.log(`Standalone panel listening on http://127.0.0.1:${port}`);
  }
});

if (sidecar) {
  sidecar.onShutdown(() => {
    httpServer.close();
  });
}
