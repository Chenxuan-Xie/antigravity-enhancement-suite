import {
  getAccountsWithActiveSync,
  switchToAccount,
  startOAuthAddAccountFlow,
  getOAuthFlowStatus,
  completeOAuthManually,
  addAccountByRefreshToken,
  updateAccountMeta,
  removeAccount,
  refreshAccountQuota,
} from "./account-manager.mjs";
import { handleModelApiRequest } from "../../antigravity-model-switcher/core/api-handler.mjs";

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("请求体不是合法的 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Private-Network": "true",
  });
  res.end(JSON.stringify(payload));
}

export async function handleAccountApiRequest(req, res, pathname) {
  if (pathname && pathname.startsWith("/api/models")) {
    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    return await handleModelApiRequest(req, res, pathname, urlObj.searchParams);
  }

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  try {
    // GET /api/accounts
    if (pathname === "/api/accounts" && req.method === "GET") {
      const data = getAccountsWithActiveSync();
      // Trigger non-blocking background enrichment if any account lacks picture or quota
      for (const acc of data.accounts) {
        if (!acc.picture || !acc.quotaSummary) {
          refreshAccountQuota(acc.email).catch(() => {});
        }
      }
      sendJson(res, 200, { ok: true, ...data });
      return true;
    }

    // POST /api/accounts/quota
    if (pathname === "/api/accounts/quota" && req.method === "POST") {
      const body = await readRequestBody(req);
      if (body.email) {
        await refreshAccountQuota(body.email);
      } else {
        const current = getAccountsWithActiveSync();
        for (const acc of current.accounts) {
          try {
            await refreshAccountQuota(acc.email);
          } catch {}
        }
      }
      const data = getAccountsWithActiveSync();
      sendJson(res, 200, { ok: true, ...data });
      return true;
    }

    // POST /api/switch
    if (pathname === "/api/switch" && req.method === "POST") {
      const body = await readRequestBody(req);
      const target = body.email || body.id;
      if (!target) {
        sendJson(res, 400, { ok: false, error: "请提供要切换的账号 (email 或 id)" });
        return true;
      }
      const result = await switchToAccount(target);
      sendJson(res, 200, result);
      return true;
    }

    // POST /api/oauth/start
    if (pathname === "/api/oauth/start" && req.method === "POST") {
      const body = await readRequestBody(req);
      const flow = await startOAuthAddAccountFlow({
        openBrowser: body.openBrowser !== false,
        customLabel: body.label || "",
      });
      sendJson(res, 200, { ok: true, ...flow });
      return true;
    }

    // GET /api/oauth/status
    if (pathname === "/api/oauth/status" && req.method === "GET") {
      const status = getOAuthFlowStatus();
      if (status.status === "completed" && status.account) {
        refreshAccountQuota(status.account.email).catch(() => {});
      }
      sendJson(res, 200, { ok: true, ...status });
      return true;
    }

    // POST /api/oauth/manual
    if (pathname === "/api/oauth/manual" && req.method === "POST") {
      const body = await readRequestBody(req);
      const saved = await completeOAuthManually(body.codeOrUrl, body.label || "");
      refreshAccountQuota(saved.email).catch(() => {});
      const data = getAccountsWithActiveSync();
      sendJson(res, 200, { ok: true, account: saved, ...data });
      return true;
    }

    // POST /api/accounts/import-token
    if (pathname === "/api/accounts/import-token" && req.method === "POST") {
      const body = await readRequestBody(req);
      const saved = await addAccountByRefreshToken(body.refreshToken, body.label || "");
      refreshAccountQuota(saved.email).catch(() => {});
      const data = getAccountsWithActiveSync();
      sendJson(res, 200, { ok: true, account: saved, ...data });
      return true;
    }

    // PUT /api/accounts/meta
    if (pathname === "/api/accounts/meta" && (req.method === "PUT" || req.method === "POST")) {
      const body = await readRequestBody(req);
      updateAccountMeta(body.email || body.id, {
        label: body.label,
        name: body.name,
      });
      const data = getAccountsWithActiveSync();
      sendJson(res, 200, { ok: true, ...data });
      return true;
    }

    // DELETE /api/accounts
    if (pathname === "/api/accounts/delete" && (req.method === "POST" || req.method === "DELETE")) {
      const body = await readRequestBody(req);
      removeAccount(body.email || body.id);
      const data = getAccountsWithActiveSync();
      sendJson(res, 200, { ok: true, ...data });
      return true;
    }

    return false;
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err.message || String(err),
    });
    return true;
  }
}
