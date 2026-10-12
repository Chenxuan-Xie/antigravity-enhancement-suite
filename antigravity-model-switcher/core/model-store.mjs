import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { getReasoningOptions, getReasoningValues, resolveReasoningEffort } from './reasoning-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.AGY_MODEL_DATA_DIR
  ? path.resolve(process.env.AGY_MODEL_DATA_DIR) : path.join(__dirname, "..", "data");
export const MODELS_FILE = path.join(DATA_DIR, "models.json");
export const BRIDGES_DIR = path.join(DATA_DIR, "bridges");

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BRIDGES_DIR, { recursive: true });
}

const DEFAULT_STORE = {
  version: 1,
  activeMode: "official", // "official" | "custom"
  activeModelId: null,
  officialModelLabel: "",
  chatRelayMode: "direct", // "direct" (直连不耗官方额度+自动桥接) | "mcp" (Agent工具协同)
  models: [],
};

export function loadModelStore() {
  ensureDirs();
  if (!fs.existsSync(MODELS_FILE)) {
    saveModelStore(DEFAULT_STORE);
    return structuredClone(DEFAULT_STORE);
  }
  try {
    const raw = fs.readFileSync(MODELS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.models) ||
        parsed.models.some(model => !model || typeof model.id !== 'string' || typeof model.modelId !== 'string')) {
      throw new Error('模型配置结构无效');
    }
    const store = {
      ...DEFAULT_STORE,
      ...parsed,
      models: Array.isArray(parsed.models) ? parsed.models : [],
    };
    if (!['official', 'custom'].includes(store.activeMode)) store.activeMode = 'official';
    // Ensure activeModelId is valid if activeMode === "custom"
    if (!store.activeModelId || !store.models.some((m) => m.id === store.activeModelId)) {
      store.activeModelId = store.models[0]?.id || null;
      if (!store.activeModelId) {
        store.activeMode = "official";
      }
    }
    return store;
  } catch (err) {
    console.error("[ModelStore] Failed to parse models.json:", err.message);
    throw new Error("模型配置无法读取，请修复 models.json 后重试；原文件已保留");
  }
}

export function saveModelStore(store) {
  ensureDirs();
  const tmpFile = `${MODELS_FILE}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2) + "\n", "utf8");
  fs.renameSync(tmpFile, MODELS_FILE);
  return store;
}

/**
 * Masks API key for safe display in frontend lists while retaining a flag that key is configured
 */
export function maskApiKey(rawKey = "") {
  const key = String(rawKey || "");
  if (key.length > 10) {
    return `${key.slice(0, 6)}••••${key.slice(-4)}`;
  }
  if (key.length > 0) {
    return `${key.slice(0, 2)}••••`;
  }
  return "";
}

export function sanitizeModelForView(model, includeFullKey = false) {
  if (!model) return null;
  const key = String(model.apiKey || "");
  const maskedKey = maskApiKey(key);
  return {
    ...model,
    reasoningEffort: getReasoningValues(model).includes(model.reasoningEffort) ? model.reasoningEffort : 'default',
    reasoningOptions: getReasoningOptions(model),
    apiKey: includeFullKey ? key : undefined,
    maskedApiKey: maskedKey,
    apiKeyMasked: maskedKey,
    hasApiKey: key.length > 0,
    lastTestError: model.lastTestOk === false ? (model.lastTestMessage || "") : "",
  };
}

export function getPublicStoreState(includeFullKey = false) {
  const store = loadModelStore();
  const activeModel = store.models.find((m) => m.id === store.activeModelId) || store.models[0] || null;
  return {
    version: store.version,
    activeMode: store.activeMode,
    activeModelId: activeModel ? activeModel.id : null,
    activeModel: sanitizeModelForView(activeModel, includeFullKey),
    officialModelLabel: store.officialModelLabel || "",
    chatRelayMode: store.chatRelayMode || "direct",
    models: store.models.map((m) => sanitizeModelForView(m, includeFullKey)),
  };
}

export function getSanitizedState() {
  return getPublicStoreState(false);
}

export function getModelById(id) {
  if (!id) return null;
  const store = loadModelStore();
  return store.models.find((m) => m.id === id) || null;
}

export function getActiveCustomModel() {
  return resolveModelByIdOrName(null);
}

export function setActiveSelection(activeMode, activeModelId = undefined) {
  setSelectionState({ activeMode, activeModelId });
  return getSanitizedState();
}

export function setChatRelayMode(chatRelayMode) {
  setSelectionState({ chatRelayMode });
  return getSanitizedState();
}

export function recordTestResult(id, result, expectedConfig) {
  return recordModelTestResult(id, {
    ok: result?.ok,
    latencyMs: result?.latencyMs,
    resolvedProtocol: result?.resolvedProtocol,
    message: result?.replyPreview || result?.error || result?.message || "",
    error: result?.error || "",
  }, expectedConfig);
}

export function upsertModel(input) {
  const store = loadModelStore();
  const modelId = String(input.modelId || input.name || "").trim();
  const name = String(input.name || modelId).trim();
  const baseUrl = String(input.baseUrl || "").trim();
  const protocol = ["openai", "anthropic", "auto"].includes(input.protocol)
    ? input.protocol
    : "auto";

  if (!modelId) {
    throw new Error("请填写模型名称 / 模型 ID（如 claude-sonnet-4-20250514、gpt-4o、deepseek-chat）");
  }
  if (!baseUrl) {
    throw new Error("请填写中转站 API 地址 (Base URL，如 https://api.xxx.com)");
  }
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error("Base URL 必须是完整的 http:// 或 https:// 地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Base URL 仅支持 HTTP/HTTPS，不能包含用户名、密码、查询参数或片段");
  }
  if (input.protocol !== undefined && !["auto", "openai", "anthropic"].includes(input.protocol)) {
    throw new Error("不支持的 API 协议");
  }
  if (input.maxTokens !== undefined && (!Number.isInteger(Number(input.maxTokens)) || Number(input.maxTokens) <= 0)) {
    throw new Error("maxTokens 必须是正整数");
  }
  if (input.temperature !== undefined && (!Number.isFinite(Number(input.temperature)) || Number(input.temperature) < 0 || Number(input.temperature) > 2)) {
    throw new Error("temperature 必须是 0 到 2 之间的数字");
  }

  let existing = input.id ? store.models.find((m) => m.id === input.id) : null;
  if (input.id && !existing) throw new Error("待编辑的模型已不存在，请刷新后重试");
  const prospective = { modelId, protocol, baseUrl };
  const reasoningEffort = input.reasoningEffort !== undefined
    ? resolveReasoningEffort(prospective, input.reasoningEffort)
    : (getReasoningValues(prospective).includes(existing?.reasoningEffort) ? existing.reasoningEffort : 'default');
  const rawKey = input.apiKey !== undefined ? String(input.apiKey).trim() : "";
  const finalApiKey = (rawKey && !rawKey.includes("••••") && !rawKey.includes("****"))
    ? rawKey
    : (existing ? existing.apiKey : "");

  if (!finalApiKey) {
    throw new Error("请填写对应的 API Key");
  }

  const now = new Date().toISOString();
  if (existing) {
    if (existing.modelId !== modelId || existing.baseUrl !== baseUrl || existing.apiKey !== finalApiKey || existing.protocol !== protocol) {
      existing.lastTestOk = null;
      existing.lastTestAt = null;
      existing.lastTestLatencyMs = null;
      existing.lastTestMessage = null;
      delete existing.resolvedProtocol;
    }
    existing.name = name;
    existing.modelId = modelId;
    existing.protocol = protocol;
    existing.baseUrl = baseUrl;
    existing.apiKey = finalApiKey;
    if (input.systemPrompt !== undefined) existing.systemPrompt = String(input.systemPrompt || "");
    if (input.maxTokens !== undefined) existing.maxTokens = Number(input.maxTokens) || 4096;
    if (input.temperature !== undefined) existing.temperature = Number(input.temperature ?? 0.7);
    existing.updatedAt = now;
  } else {
    existing = {
      id: input.id || `mdl_${crypto.randomBytes(5).toString("hex")}`,
      name,
      modelId,
      protocol,
      baseUrl,
      apiKey: finalApiKey,
      systemPrompt: String(input.systemPrompt || ""),
      maxTokens: Number(input.maxTokens) || 4096,
      temperature: Number(input.temperature ?? 0.7),
      lastTestOk: null,
      lastTestLatencyMs: null,
      lastTestAt: null,
      lastTestMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    store.models.push(existing);
  }

  if (!store.activeModelId || input.setActive === true || input.autoActivate === true) {
    store.activeModelId = existing.id;
  }
  if (input.setActiveMode) {
    store.activeMode = input.setActiveMode;
  }

  existing.reasoningEffort = reasoningEffort;
  saveModelStore(store);
  return existing;
}

export function setModelReasoningEffort(id, effort, activate = false) {
  const store = loadModelStore();
  const model = store.models.find(m => m.id === id);
  if (!model) throw new Error('指定的模型不存在，请刷新模型列表');
  model.reasoningEffort = resolveReasoningEffort(model, effort);
  model.updatedAt = new Date().toISOString();
  if (activate) { store.activeModelId = model.id; store.activeMode = 'custom'; }
  saveModelStore(store);
  return getSanitizedState();
}

export function recordModelTestResult(id, result, expectedConfig) {
  const store = loadModelStore();
  const model = store.models.find((m) => m.id === id);
  if (!model) return null;
  if (expectedConfig && ['modelId', 'baseUrl', 'apiKey', 'protocol'].some(field => model[field] !== expectedConfig[field])) return null;
  model.lastTestOk = Boolean(result.ok);
  model.lastTestLatencyMs = typeof result.latencyMs === "number" ? result.latencyMs : null;
  model.lastTestAt = new Date().toISOString();
  model.lastTestMessage = String(result.message || result.error || "");
  if (result.resolvedProtocol) {
    model.resolvedProtocol = result.resolvedProtocol;
  }
  saveModelStore(store);
  return model;
}

export function deleteModel(id) {
  const store = loadModelStore();
  const idx = store.models.findIndex((m) => m.id === id);
  if (idx === -1) {
    return false;
  }
  store.models.splice(idx, 1);
  if (store.activeModelId === id) {
    store.activeModelId = store.models[0]?.id || null;
    store.activeMode = "official";
  }
  saveModelStore(store);
  return true;
}

export function setSelectionState({ activeMode, activeModelId, officialModelLabel, chatRelayMode }) {
  const store = loadModelStore();
  if (activeMode !== undefined && !["official", "custom"].includes(activeMode)) throw new Error("无效的模型切换模式");
  if (chatRelayMode !== undefined && !["direct", "mcp"].includes(chatRelayMode)) throw new Error("无效的中转模式");
  if (activeMode === "official" || activeMode === "custom") {
    store.activeMode = activeMode;
  }
  if (activeModelId !== undefined) {
    const target = store.models.find((m) => m.id === activeModelId || m.name === activeModelId || m.modelId === activeModelId);
    if (target) {
      store.activeModelId = target.id;
    } else if (activeModelId !== null) {
      throw new Error("指定的模型不存在，请刷新模型列表");
    } else if (activeModelId === null && activeMode !== "custom") {
      // keep existing activeModelId as default when switching back to custom later
    }
  }
  if (store.activeMode === "custom" && !store.models.some(m => m.id === store.activeModelId)) {
    throw new Error("请先添加并选择一个自定义模型");
  }
  if (typeof officialModelLabel === "string") {
    store.officialModelLabel = officialModelLabel;
  }
  if (chatRelayMode === "direct" || chatRelayMode === "mcp") {
    store.chatRelayMode = chatRelayMode;
  }
  saveModelStore(store);
  return store;
}

export function resolveModelByIdOrName(idOrName) {
  const store = loadModelStore();
  if (idOrName) {
    const q = String(idOrName).trim().toLowerCase();
    const match = store.models.find(
      (m) =>
        m.id.toLowerCase() === q ||
        m.name.toLowerCase() === q ||
        m.modelId.toLowerCase() === q
    );
    if (match) return match;
    return null;
  }
  if (store.activeModelId) {
    const active = store.models.find((m) => m.id === store.activeModelId);
    if (active) return active;
  }
  return store.models[0] || null;
}
