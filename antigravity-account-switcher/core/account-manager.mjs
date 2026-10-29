import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const WIN_CRED_PS1 = path.join(__dirname, "win-cred.ps1");
const HOT_SWITCH_WORKER = path.join(__dirname, "hot-switch-worker.mjs");

function readCredentialUserScope() {
  try {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return fs.readFileSync(path.join(appData, "Antigravity", "credential-user-scope"), "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * Antigravity 2.28+ 会把凭据写到 `antigravity-<credential-user-scope>`，
 * 旧版本使用 `gemini:antigravity`。读取时新目标优先，写入时两者都写，
 * 这样升级/降级都不会丢失当前账号。
 */
export function credentialTargets() {
  const scope = readCredentialUserScope();
  return [...new Set([scope ? `antigravity-${scope}` : "", "gemini:antigravity"])].filter(Boolean);
}

/**
 * Antigravity 2.28+ derives the per-account credential scope as
 * `u` + first 16 hex chars of SHA-256(id_token.sub).
 */
export function credentialScopeForAccount(account = {}) {
  if (account.credential_scope) return account.credential_scope;
  try {
    const claims = decodeJwtPayload(account.id_token);
    if (claims?.sub) {
      return "u" + crypto.createHash("sha256").update(String(claims.sub)).digest("hex").slice(0, 16);
    }
  } catch {}
  return "";
}

import { createRequire } from "node:module";
const requireCjs = createRequire(import.meta.url);

// Dynamically resolve OAuth 2.0 Client Config from env or local Antigravity installation (zero hardcoded secrets in repo)
let cachedOAuthClients = null;

function readOfficialOAuthClients() {
  if (cachedOAuthClients) return cachedOAuthClients;
  if (process.env.AGY_OAUTH_CLIENT_ID && process.env.AGY_OAUTH_CLIENT_SECRET) {
    cachedOAuthClients = [{
      clientId: process.env.AGY_OAUTH_CLIENT_ID,
      clientSecret: process.env.AGY_OAUTH_CLIENT_SECRET,
    }];
    return cachedOAuthClients;
  }
  try {
    const { resolveResourcesDir } = requireCjs("../../antigravity-claude-skin/tools/agy-paths.cjs");
    const resourcesDir = resolveResourcesDir();
    const lsBin = path.join(resourcesDir, "bin", "language_server.exe");
    if (fs.existsSync(lsBin)) {
      const content = fs.readFileSync(lsBin, "latin1");
      // Antigravity 2.28 carries multiple OAuth clients (legacy and current);
      // 13-digit project numbers must not be truncated to 12 digits.
      const clientIds = [...new Set(content.match(/\d{12,16}-[a-z0-9]{32}\.apps\.googleusercontent\.com/g) || [])];
      const clientSecrets = [...new Set(content.match(/GOCSPX-[A-Za-z0-9_-]{28}/g) || [])];
      const clients = clientIds
        .map((clientId, index) => ({ clientId, clientSecret: clientSecrets[index] || "" }))
        .filter((client) => client.clientSecret);
      if (clients.length > 0) {
        cachedOAuthClients = clients;
        return cachedOAuthClients;
      }
    }
  } catch {}
  throw new Error("未能从本机 Antigravity 安装目录读取 OAuth 客户端配置，请确认已安装 Antigravity 或设置环境变量 AGY_OAUTH_CLIENT_ID / AGY_OAUTH_CLIENT_SECRET");
}

export function getOfficialOAuthClient(clientIdHint = "") {
  const clients = readOfficialOAuthClients();
  const hint = String(clientIdHint || "").trim();
  if (hint) {
    const exact = clients.find((client) => client.clientId === hint);
    if (exact) return exact;
  }
  // The current Antigravity client is used for fresh logins. Legacy accounts
  // carry their own `aud` and are matched above.
  return clients.find((client) => client.clientId.startsWith("1071006060591-")) || clients[0];
}

export function oauthAudienceForAccount(account = {}) {
  try {
    const claims = decodeJwtPayload(account.id_token);
    return typeof claims?.aud === "string" ? claims.aud : "";
  } catch {
    return "";
  }
}
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
].join(" ");

const QUOTA_SUMMARY_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
];

// Active OAuth Flow State
let activeOAuthFlow = null;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Decode JWT payload without signature verification
 */
export function decodeJwtPayload(jwt) {
  if (!jwt || typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Detect Windows system proxy (e.g. 127.0.0.1:8800) or env proxy
 */
let cachedProxy = null;
let cachedProxyAt = 0;

export function getSystemProxyUrl() {
  const now = Date.now();
  if (cachedProxy !== null && now - cachedProxyAt < 15000) {
    return cachedProxy;
  }
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY;
  if (envProxy) {
    cachedProxy = envProxy;
    cachedProxyAt = now;
    return cachedProxy;
  }

  try {
    const out = execFileSync(
      "reg.exe",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      ],
      { windowsHide: true, encoding: "utf8", timeout: 3000 }
    );
    const enableMatch = /ProxyEnable\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i.exec(out);
    const serverMatch = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(out);
    const enabled = enableMatch ? parseInt(enableMatch[1], 16) === 1 : false;
    if (enabled && serverMatch && serverMatch[1]) {
      let raw = serverMatch[1].trim();
      if (raw.includes("=")) {
        const httpsPart = raw
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("https=") || s.startsWith("http="));
        if (httpsPart) raw = httpsPart.split("=")[1];
      }
      if (!/^https?:\/\//i.test(raw)) {
        raw = `http://${raw}`;
      }
      cachedProxy = raw;
      cachedProxyAt = now;
      return cachedProxy;
    }
  } catch {}

  cachedProxy = "";
  cachedProxyAt = now;
  return "";
}

/**
 * HTTPS request supporting Windows HTTP CONNECT proxy with direct fallback
 */
export function httpsRequestJson(urlStr, options = {}) {
  const method = options.method || "GET";
  const headers = Object.assign(
    {
      "User-Agent": "Antigravity-Account-Switcher/1.0",
      Accept: "application/json",
    },
    options.headers || {}
  );
  const bodyBuffer = options.body
    ? Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(String(options.body), "utf8")
    : null;
  if (bodyBuffer) {
    headers["Content-Length"] = String(bodyBuffer.length);
  }
  const timeoutMs = options.timeoutMs || 12000;

  const targetUrl = new URL(urlStr);
  const proxyUrlStr = getSystemProxyUrl();

  const doDirectRequest = () =>
    new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port || 443,
          path: targetUrl.pathname + targetUrl.search,
          method,
          headers,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {}
            resolve({ status: res.statusCode || 0, text, json });
          });
        }
      );
      req.on("timeout", () => req.destroy(new Error("HTTPS request timeout")));
      req.on("error", reject);
      if (bodyBuffer) req.write(bodyBuffer);
      req.end();
    });

  if (!proxyUrlStr) {
    return doDirectRequest();
  }

  return new Promise((resolve, reject) => {
    let proxyUrl;
    try {
      proxyUrl = new URL(proxyUrlStr);
    } catch {
      doDirectRequest().then(resolve, reject);
      return;
    }

    const targetPort = Number(targetUrl.port || 443);
    const connectReq = http.request({
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port || 80),
      method: "CONNECT",
      path: `${targetUrl.hostname}:${targetPort}`,
      timeout: timeoutMs,
    });

    connectReq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        doDirectRequest().then(resolve, reject);
        return;
      }
      const tlsSocket = tls.connect({
        socket,
        servername: targetUrl.hostname,
      });

      const req = https.request(
        {
          hostname: targetUrl.hostname,
          port: targetPort,
          path: targetUrl.pathname + targetUrl.search,
          method,
          headers,
          createConnection: () => tlsSocket,
          timeout: timeoutMs,
        },
        (httpsRes) => {
          const chunks = [];
          httpsRes.on("data", (c) => chunks.push(c));
          httpsRes.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {}
            resolve({ status: httpsRes.statusCode || 0, text, json });
          });
        }
      );
      req.on("timeout", () => req.destroy(new Error("Proxied HTTPS timeout")));
      req.on("error", reject);
      if (bodyBuffer) req.write(bodyBuffer);
      req.end();
    });

    connectReq.on("timeout", () => {
      connectReq.destroy(new Error("Proxy CONNECT timeout"));
    });
    connectReq.on("error", () => {
      doDirectRequest().then(resolve, reject);
    });
    connectReq.end();
  });
}

/**
 * Read current credential from Windows Credential Manager.
 * Antigravity 2.28+ uses `antigravity-<scope>`; older versions use `gemini:antigravity`.
 */
export function readCurrentSystemCredential() {
  try {
    let parsed = null;
    for (const target of credentialTargets()) {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          WIN_CRED_PS1,
          "-Action",
          "read",
          "-Target",
          target,
        ],
        { windowsHide: true, encoding: "utf8", timeout: 8000 }
      ).trim();
      if (!out || out === "NOT_FOUND" || !out.startsWith("OK:")) continue;
      const b64 = out.slice(3).trim();
      if (!b64) continue;
      parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      break;
    }
    if (!parsed) return null;
    const idClaims = decodeJwtPayload(parsed.id_token);

    // Also read app_storage.json fallback email
    let lastLoginUsername = "";
    try {
      const appData =
        process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
      const storagePath = path.join(appData, "Antigravity", "app_storage.json");
      if (fs.existsSync(storagePath)) {
        const st = JSON.parse(fs.readFileSync(storagePath, "utf8"));
        lastLoginUsername = st["jetski.onboarding.lastLoginUsername"] || "";
      }
    } catch {}

    const email = (idClaims && idClaims.email) || parsed.id_token_email || lastLoginUsername || "";
    const name = (idClaims && idClaims.name) || "";
    const picture = (idClaims && idClaims.picture) || "";
    const token = parsed.token || {};

    return {
      email,
      name,
      picture,
      access_token: token.access_token || "",
      refresh_token: token.refresh_token || "",
      expiry: token.expiry || "",
      id_token: parsed.id_token || "",
      auth_method: parsed.auth_method || "consumer",
      raw: parsed,
    };
  } catch (err) {
    console.error("[AccountManager] readCurrentSystemCredential error:", err.message);
    return null;
  }
}

/**
 * Load saved accounts list from disk
 */
export function loadAccountsStore() {
  ensureDataDir();
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    return { accounts: [], updatedAt: new Date().toISOString() };
  }
  try {
    const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    if (!Array.isArray(data.accounts)) data.accounts = [];
    return data;
  } catch {
    return { accounts: [], updatedAt: new Date().toISOString() };
  }
}

export function saveAccountsStore(store) {
  ensureDataDir();
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(store, null, 2), "utf8");
}

/**
 * Sync the currently active system account into accounts.json automatically
 * and return the full list of accounts with `isCurrent` marked.
 */
export function getAccountsWithActiveSync() {
  const store = loadAccountsStore();
  const sysCred = readCurrentSystemCredential();
  let currentEmail = "";

  if (sysCred && sysCred.email && sysCred.refresh_token) {
    currentEmail = sysCred.email.toLowerCase();
    const existingIdx = store.accounts.findIndex(
      (a) => a.email && a.email.toLowerCase() === currentEmail
    );

    if (existingIdx >= 0) {
      const existing = store.accounts[existingIdx];
      existing.email = sysCred.email;
      if (sysCred.name) existing.name = sysCred.name;
      if (sysCred.picture) existing.picture = sysCred.picture;
      existing.access_token = sysCred.access_token || existing.access_token;
      existing.refresh_token = sysCred.refresh_token || existing.refresh_token;
      existing.expiry = sysCred.expiry || existing.expiry;
      existing.id_token = sysCred.id_token || existing.id_token;
      existing.auth_method = sysCred.auth_method || existing.auth_method || "consumer";
      existing.credential_scope = readCredentialUserScope() || existing.credential_scope;
      existing.lastActiveAt = new Date().toISOString();
    } else {
      store.accounts.push({
        id: crypto.randomUUID(),
        email: sysCred.email,
        name: sysCred.name || sysCred.email.split("@")[0],
        label: store.accounts.length === 0 ? "主账号" : `账号 ${store.accounts.length + 1}`,
        picture: sysCred.picture || "",
        access_token: sysCred.access_token,
        refresh_token: sysCred.refresh_token,
        expiry: sysCred.expiry,
        id_token: sysCred.id_token,
        auth_method: sysCred.auth_method || "consumer",
        credential_scope: readCredentialUserScope() || "",
        addedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      });
    }
    saveAccountsStore(store);
  }

  const sanitizedAccounts = store.accounts.map((acc) => {
    const isCurrent =
      Boolean(currentEmail) &&
      Boolean(acc.email) &&
      acc.email.toLowerCase() === currentEmail;
    let expiryMs = 0;
    try {
      if (acc.expiry) expiryMs = new Date(acc.expiry).getTime();
    } catch {}
    return {
      id: acc.id,
      email: acc.email,
      name: acc.name || acc.email.split("@")[0],
      label: acc.label || "",
      picture: acc.picture || "",
      isCurrent,
      expiry: acc.expiry || "",
      isTokenValid: expiryMs > Date.now() + 60_000,
      hasRefreshToken: Boolean(acc.refresh_token),
      addedAt: acc.addedAt,
      lastActiveAt: acc.lastActiveAt,
      quotaSummary: acc.quotaSummary || null,
    };
  });

  return {
    currentEmail: sysCred ? sysCred.email : "",
    accounts: sanitizedAccounts,
  };
}

/**
 * Refresh OAuth 2.0 access_token using refresh_token
 */
export async function refreshGoogleToken(refreshToken, accountOrAudience = "") {
  const hintedAudience = typeof accountOrAudience === "string"
    ? accountOrAudience
    : oauthAudienceForAccount(accountOrAudience);
  const clients = readOfficialOAuthClients();
  const ordered = [];
  const seen = new Set();
  const add = (client) => {
    if (!client || seen.has(client.clientId)) return;
    seen.add(client.clientId);
    ordered.push(client);
  };
  add(getOfficialOAuthClient(hintedAudience));
  for (const client of clients) add(client);

  let lastError = null;
  for (const { clientId, clientSecret } of ordered) {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const res = await httpsRequestJson(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (res.status === 200 && res.json && res.json.access_token) {
      const expiresIn = Number(res.json.expires_in || 3599);
      const expiryIso = new Date(Date.now() + expiresIn * 1000).toISOString();
      return {
        access_token: res.json.access_token,
        id_token: res.json.id_token || "",
        expiry: expiryIso,
        expires_in: expiresIn,
        client_id: clientId,
      };
    }

    lastError = `Token 刷新失败 (HTTP ${res.status}): ${res.text.slice(0, 240)}`;
    // A refresh token is bound to the OAuth client that issued it. If this
    // client does not match, try the other Antigravity clients in the binary.
    if (!/unauthorized_client/i.test(String(res.text || ""))) break;
  }
  throw new Error(lastError || "Token 刷新失败：没有可用的 OAuth 客户端");
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code, redirectUri) {
  const { clientId, clientSecret } = getOfficialOAuthClient();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await httpsRequestJson(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (res.status !== 200 || !res.json || !res.json.access_token) {
    throw new Error(
      `授权码换取 Token 失败 (HTTP ${res.status}): ${res.text.slice(0, 240)}`
    );
  }

  if (!res.json.refresh_token) {
    throw new Error(
      "Google 未返回 refresh_token，请在授权页面确保勾选同意离线访问权限后再试。"
    );
  }

  const expiresIn = Number(res.json.expires_in || 3599);
  const expiryIso = new Date(Date.now() + expiresIn * 1000).toISOString();

  return {
    access_token: res.json.access_token,
    refresh_token: res.json.refresh_token,
    id_token: res.json.id_token || "",
    expiry: expiryIso,
  };
}

/**
 * Fetch Google UserInfo using access_token
 */
export async function fetchGoogleUserInfo(accessToken) {
  const res = await httpsRequestJson(OAUTH_USERINFO_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status !== 200 || !res.json || !res.json.email) {
    throw new Error(`获取 Google 账号信息失败 (HTTP ${res.status})`);
  }

  return {
    email: res.json.email,
    name: res.json.name || res.json.given_name || res.json.email.split("@")[0],
    picture: res.json.picture || "",
  };
}

/**
 * Upsert an account into accounts.json
 */
export function upsertAccountRecord({
  email,
  name,
  label,
  picture,
  access_token,
  refresh_token,
  expiry,
  id_token,
}) {
  const store = loadAccountsStore();
  const cleanEmail = email.trim();
  const idx = store.accounts.findIndex(
    (a) => a.email && a.email.toLowerCase() === cleanEmail.toLowerCase()
  );

  if (idx >= 0) {
    const acc = store.accounts[idx];
    acc.email = cleanEmail;
    if (name) acc.name = name;
    if (label !== undefined && label !== "") acc.label = label;
    if (picture) acc.picture = picture;
    if (access_token) acc.access_token = access_token;
    if (refresh_token) acc.refresh_token = refresh_token;
    if (expiry) acc.expiry = expiry;
    if (id_token) acc.id_token = id_token;
    if (id_token) acc.credential_scope = credentialScopeForAccount({ id_token }) || acc.credential_scope;
    acc.updatedAt = new Date().toISOString();
    saveAccountsStore(store);
    return acc;
  } else {
    const newAcc = {
      id: crypto.randomUUID(),
      email: cleanEmail,
      name: name || cleanEmail.split("@")[0],
      label:
        label ||
        (store.accounts.length === 0
          ? "主账号"
          : `账号 ${store.accounts.length + 1}`),
      picture: picture || "",
      access_token: access_token || "",
      refresh_token: refresh_token || "",
      expiry: expiry || new Date(Date.now() + 3600_000).toISOString(),
      id_token: id_token || "",
      credential_scope: credentialScopeForAccount({ id_token }) || "",
      auth_method: "consumer",
      addedAt: new Date().toISOString(),
      lastActiveAt: null,
    };
    store.accounts.push(newAcc);
    saveAccountsStore(store);
    return newAcc;
  }
}

/**
 * Add or update an account directly via refresh_token
 */
export async function addAccountByRefreshToken(refreshToken, customLabel = "") {
  const cleanToken = String(refreshToken || "").trim();
  if (!cleanToken) {
    throw new Error("请输入有效的 refresh_token");
  }
  const refreshed = await refreshGoogleToken(cleanToken);
  let email = "";
  let name = "";
  let picture = "";

  const claims = decodeJwtPayload(refreshed.id_token);
  if (claims && claims.email) {
    email = claims.email;
    name = claims.name || "";
    picture = claims.picture || "";
  }
  if (!email) {
    const info = await fetchGoogleUserInfo(refreshed.access_token);
    email = info.email;
    name = info.name;
    picture = info.picture;
  }

  return upsertAccountRecord({
    email,
    name,
    label: customLabel,
    picture,
    access_token: refreshed.access_token,
    refresh_token: cleanToken,
    expiry: refreshed.expiry,
    id_token: refreshed.id_token,
  });
}

/**
 * Update account remark/label or order
 */
export function updateAccountMeta(emailOrId, { label, name }) {
  const store = loadAccountsStore();
  const target = store.accounts.find(
    (a) =>
      a.id === emailOrId ||
      (a.email && a.email.toLowerCase() === String(emailOrId).toLowerCase())
  );
  if (!target) throw new Error("未找到指定账号");
  if (label !== undefined) target.label = String(label).trim();
  if (name !== undefined && String(name).trim()) {
    target.name = String(name).trim();
  }
  saveAccountsStore(store);
  return target;
}

/**
 * Remove an account from the saved list
 */
export function removeAccount(emailOrId) {
  const store = loadAccountsStore();
  const before = store.accounts.length;
  store.accounts = store.accounts.filter(
    (a) =>
      a.id !== emailOrId &&
      (!a.email || a.email.toLowerCase() !== String(emailOrId).toLowerCase())
  );
  if (store.accounts.length === before) {
    throw new Error("未找到要移除的账号");
  }
  saveAccountsStore(store);
  return true;
}

/**
 * Check whether an account is licensed for Antigravity before switching.
 * Only an explicit 403 license response blocks the switch; a network failure
 * stays non-blocking so a temporary outage does not make accounts unusable.
 */
export async function checkAccountLicense(account) {
  if (!account?.access_token) return { ok: true, unknown: true };
  for (const endpoint of QUOTA_SUMMARY_ENDPOINTS) {
    try {
      const res = await httpsRequestJson(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
        timeoutMs: 8000,
      });
      if (res.status === 200) return { ok: true };
      if (res.status === 403) {
        const message = String(res.json?.error?.message || res.text || "").trim();
        if (/valid license|license of this product|permission_denied|没有.*许可/i.test(message)) {
          return { ok: false, status: 403, message: message || "该账号没有 Antigravity 使用许可" };
        }
      }
    } catch {}
  }
  return { ok: true, unknown: true };
}

/**
 * Fetch quota summary for an account (non-blocking helper)
 */
export async function refreshAccountQuota(emailOrId) {
  const store = loadAccountsStore();
  const target = store.accounts.find(
    (a) =>
      a.id === emailOrId ||
      (a.email && a.email.toLowerCase() === String(emailOrId).toLowerCase())
  );
  if (!target) throw new Error("未找到指定账号");

  let expiryMs = 0;
  try {
    if (target.expiry) expiryMs = new Date(target.expiry).getTime();
  } catch {}

  if (!target.access_token || expiryMs < Date.now() + 5 * 60_000) {
    const refreshed = await refreshGoogleToken(target.refresh_token, target);
    target.access_token = refreshed.access_token;
    target.expiry = refreshed.expiry;
    if (refreshed.id_token) target.id_token = refreshed.id_token;
    saveAccountsStore(store);
  }

  // Enrich Google display name & avatar if missing or default
  if (!target.picture || !target.name || target.name === target.email.split("@")[0]) {
    try {
      const info = await fetchGoogleUserInfo(target.access_token);
      if (info.name) target.name = info.name;
      if (info.picture) target.picture = info.picture;
      saveAccountsStore(store);
    } catch {}
  }

  for (const endpoint of QUOTA_SUMMARY_ENDPOINTS) {
    try {
      const res = await httpsRequestJson(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
        timeoutMs: 8000,
      });
      if (res.status === 200 && res.json && Array.isArray(res.json.groups)) {
        const groups = res.json.groups.map((g) => ({
          displayName: g.displayName || "",
          buckets: (g.buckets || []).map((b) => ({
            bucketId: b.bucketId || "",
            displayName: b.displayName || "",
            window: b.window || "",
            remainingPercent:
              typeof b.remainingFraction === "number"
                ? Math.round(b.remainingFraction * 100)
                : null,
            resetTime: b.resetTime || "",
          })),
        }));
        target.quotaSummary = {
          groups,
          updatedAt: new Date().toISOString(),
        };
        saveAccountsStore(store);
        return target.quotaSummary;
      }
    } catch {}
  }
  return null;
}

/**
 * Start a local OAuth 2.0 browser flow to add a new account without logging out
 */
export async function startOAuthAddAccountFlow(options = {}) {
  const { openBrowser = true, customLabel = "" } = options;

  // Close any previous pending flow
  if (activeOAuthFlow && activeOAuthFlow.server) {
    try {
      activeOAuthFlow.server.close();
    } catch {}
    activeOAuthFlow = null;
  }

  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString("hex");
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
        if (reqUrl.pathname !== "/oauth-callback") {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not Found");
          return;
        }

        const code = reqUrl.searchParams.get("code");
        const errParam = reqUrl.searchParams.get("error");
        if (errParam || !code) {
          activeOAuthFlow.status = "error";
          activeOAuthFlow.error = errParam || "未获取到授权码 (code)";
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>授权失败</title></head>
          <body style="font-family:system-ui,-apple-system,sans-serif;background:#FAF9F5;color:#141413;text-align:center;padding:60px 20px;">
            <div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #E6E4DD;border-radius:14px;padding:32px;">
              <h2 style="color:#C94A4A;margin-top:0;">❌ 账号授权未完成</h2>
              <p style="color:#66645E;">原因：${activeOAuthFlow.error}</p>
              <p style="font-size:13px;color:#8C8980;">您可以关闭此页面并返回 Antigravity 重试。</p>
            </div>
          </body></html>`);
          return;
        }

        activeOAuthFlow.status = "exchanging";
        const tokens = await exchangeCodeForTokens(code, activeOAuthFlow.redirectUri);
        const claims = decodeJwtPayload(tokens.id_token);
        let email = (claims && claims.email) || "";
        let name = (claims && claims.name) || "";
        let picture = (claims && claims.picture) || "";

        if (!email) {
          const info = await fetchGoogleUserInfo(tokens.access_token);
          email = info.email;
          name = info.name;
          picture = info.picture;
        }

        const saved = upsertAccountRecord({
          email,
          name,
          label: customLabel,
          picture,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry: tokens.expiry,
          id_token: tokens.id_token,
        });

        activeOAuthFlow.status = "completed";
        activeOAuthFlow.account = {
          id: saved.id,
          email: saved.email,
          name: saved.name,
          label: saved.label,
        };

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>添加成功 - Antigravity</title></head>
        <body style="font-family:system-ui,-apple-system,sans-serif;background:#FAF9F5;color:#141413;text-align:center;padding:60px 20px;">
          <div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #E6E4DD;border-radius:16px;padding:36px;box-shadow:0 8px 28px rgba(20,20,19,0.06);">
            <div style="width:48px;height:48px;line-height:48px;border-radius:50%;background:#EBF5EE;color:#2E7D47;font-size:24px;margin:0 auto 16px;">✓</div>
            <h2 style="margin:0 0 8px;font-size:20px;">账号添加成功！</h2>
            <p style="margin:0 0 16px;color:#D97757;font-weight:600;font-size:15px;">${saved.email}</p>
            <p style="margin:0;color:#66645E;font-size:13px;line-height:1.6;">该账号已安全保存至 Antigravity 多账号切换器。<br>您可以关闭此浏览器标签页，返回 Antigravity 点击账号名称随时一键切换。</p>
          </div>
          <script>setTimeout(() => { try { window.close(); } catch(e) {} }, 2500);</script>
        </body></html>`);

        setTimeout(() => {
          try {
            server.close();
          } catch {}
        }, 1500);
      } catch (err) {
        activeOAuthFlow.status = "error";
        activeOAuthFlow.error = err.message || String(err);
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>授权失败</title></head>
        <body style="font-family:system-ui,-apple-system,sans-serif;background:#FAF9F5;color:#141413;text-align:center;padding:60px 20px;">
          <div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #E6E4DD;border-radius:14px;padding:32px;">
            <h2 style="color:#C94A4A;margin-top:0;">❌ 换取凭证失败</h2>
            <p style="color:#66645E;word-break:break-all;">${activeOAuthFlow.error}</p>
          </div>
        </body></html>`);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr.port;
      const redirectUri = `http://127.0.0.1:${port}/oauth-callback`;

      const { clientId } = getOfficialOAuthClient();
      const authParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: OAUTH_SCOPES,
        access_type: "offline",
        prompt: "select_account consent",
        include_granted_scopes: "true",
        state,
      });

      const authUrl = `${OAUTH_AUTH_URL}?${authParams.toString()}`;

      activeOAuthFlow = {
        state,
        port,
        redirectUri,
        authUrl,
        customLabel,
        status: "waiting",
        error: null,
        account: null,
        server,
        startedAt: Date.now(),
      };

      if (openBrowser) {
        try {
          execFileSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `Start-Process '${authUrl.replace(/'/g, "''")}'`,
            ],
            { windowsHide: true, timeout: 4000 }
          );
        } catch {}
      }

      resolve({
        authUrl,
        redirectUri,
        state,
        status: "waiting",
      });
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}

export function getOAuthFlowStatus() {
  if (!activeOAuthFlow) {
    return { status: "idle" };
  }
  return {
    status: activeOAuthFlow.status,
    authUrl: activeOAuthFlow.authUrl,
    error: activeOAuthFlow.error,
    account: activeOAuthFlow.account,
    startedAt: activeOAuthFlow.startedAt,
  };
}

/**
 * Complete OAuth manually if user pasted callback URL or code
 */
export async function completeOAuthManually(codeOrUrl, customLabel = "") {
  if (!activeOAuthFlow || !activeOAuthFlow.redirectUri) {
    throw new Error("请先点击「添加新账号」生成授权会话");
  }
  let code = String(codeOrUrl || "").trim();
  if (code.startsWith("http://") || code.startsWith("https://")) {
    const u = new URL(code);
    code = u.searchParams.get("code") || "";
  }
  if (!code) {
    throw new Error("未能从输入中解析出授权码 (code)");
  }

  const tokens = await exchangeCodeForTokens(code, activeOAuthFlow.redirectUri);
  const claims = decodeJwtPayload(tokens.id_token);
  let email = (claims && claims.email) || "";
  let name = (claims && claims.name) || "";
  let picture = (claims && claims.picture) || "";

  if (!email) {
    const info = await fetchGoogleUserInfo(tokens.access_token);
    email = info.email;
    name = info.name;
    picture = info.picture;
  }

  const saved = upsertAccountRecord({
    email,
    name,
    label: customLabel || activeOAuthFlow.customLabel,
    picture,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry: tokens.expiry,
    id_token: tokens.id_token,
  });

  activeOAuthFlow.status = "completed";
  activeOAuthFlow.account = {
    id: saved.id,
    email: saved.email,
    name: saved.name,
    label: saved.label,
  };
  try {
    activeOAuthFlow.server.close();
  } catch {}

  return saved;
}

/**
 * Prepare & trigger 1-click zero-logout hot switch to the target account
 */
export async function switchToAccount(emailOrId) {
  // First sync current credential so we never lose the currently logged-in account!
  getAccountsWithActiveSync();

  const store = loadAccountsStore();
  const target = store.accounts.find(
    (a) =>
      a.id === emailOrId ||
      (a.email && a.email.toLowerCase() === String(emailOrId).toLowerCase())
  );

  if (!target) {
    throw new Error(`未找到目标账号: ${emailOrId}`);
  }
  if (!target.refresh_token) {
    throw new Error(`账号 ${target.email} 缺少 refresh_token，请重新授权添加`);
  }

  // Check if access_token needs refresh (if expiring within 15 minutes or missing)
  let expiryMs = 0;
  try {
    if (target.expiry) expiryMs = new Date(target.expiry).getTime();
  } catch {}

  if (!target.access_token || expiryMs < Date.now() + 15 * 60_000) {
    const refreshed = await refreshGoogleToken(target.refresh_token, target);
    target.access_token = refreshed.access_token;
    target.expiry = refreshed.expiry;
    if (refreshed.id_token) {
      target.id_token = refreshed.id_token;
    }
  }

  const license = await checkAccountLicense(target);
  if (!license.ok) {
    throw new Error(`账号 ${target.email} 没有 Antigravity 使用许可，已保持当前账号不变。${license.message ? `（${license.message}）` : ""}`);
  }

  target.lastActiveAt = new Date().toISOString();
  saveAccountsStore(store);

  const targetScope = readCredentialUserScope() ? credentialScopeForAccount(target) : "";

  // Build CredentialBlob JSON compatible with both Antigravity 2.22+ (`gemini:antigravity`)
  // and 2.28+ (`antigravity-<credential-user-scope>` + id_token_email).
  const keyringExpiry = target.expiry || new Date(Date.now() + 3600_000).toISOString();
  const keyringPayload = {
    token: {
      access_token: target.access_token,
      token_type: "Bearer",
      refresh_token: target.refresh_token,
      expiry: keyringExpiry,
      expires_in: Math.max(0, Math.floor((new Date(keyringExpiry).getTime() - Date.now()) / 1000)) || 3600,
    },
    auth_method: target.auth_method || "consumer",
    id_token_email: target.email,
  };
  if (target.id_token) {
    keyringPayload.id_token = target.id_token;
  }

  const payloadBase64 = Buffer.from(
    JSON.stringify(keyringPayload),
    "utf8"
  ).toString("base64");

  // Spawn hot-switch-worker via WMI Win32_Process.Create so it is 100% outside language_server's Job Object!
  const scopeArg = targetScope ? ` --scope "${targetScope}"` : "";
  const cmdLine = `"${process.execPath}" "${HOT_SWITCH_WORKER}" --email "${target.email}" --payload-b64 "${payloadBase64}"${scopeArg}`;
  let launchedViaWmi = false;
  try {
    const psCmd = `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${cmdLine.replace(/'/g, "''")}' } | Out-Null`;
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psCmd],
      { windowsHide: true, stdio: "ignore", timeout: 5000 }
    );
    launchedViaWmi = true;
  } catch {}

  if (!launchedViaWmi) {
    const child = spawn(
      process.execPath,
      [
        HOT_SWITCH_WORKER,
        "--email",
        target.email,
        "--payload-b64",
        payloadBase64,
        ...(targetScope ? ["--scope", targetScope] : []),
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }
    );
    child.unref();
  }

  return {
    ok: true,
    switchedTo: target.email,
    name: target.name,
    label: target.label,
    message: `正在无缝切换至 ${target.email}，窗口将在约 2 秒内自动刷新生效…`,
  };
}

