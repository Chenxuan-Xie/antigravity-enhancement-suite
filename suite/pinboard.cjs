const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
function getFile() {
  return process.env.AGY_SUITE_PINBOARD_FILE || path.join(root, 'data', 'suite-pinboard.json');
}

function sanitizePin(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid pinboard item');
  const content = String(raw.content || '').trim();
  if (!content || content.length > 16000) throw Error('暂存片段长度需在 1~16000 个字符之间');
  const fallbackTitle = content.split('\n')[0].replace(/^[#>*\-\s]+/, '').trim().slice(0, 48) || '上下文片段';
  const title = String(raw.title || fallbackTitle).trim().slice(0, 100) || fallbackTitle;
  const source = String(raw.source || '').trim().slice(0, 80);
  const enabled = raw.enabled !== false;
  const id = typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{2,64}$/.test(raw.id)
    ? raw.id
    : 'pin_' + crypto.randomBytes(6).toString('hex');
  const now = Date.now();
  return {
    id,
    title,
    content,
    source,
    enabled,
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now
  };
}

function readStore() {
  const file = getFile();
  if (!fs.existsSync(file)) return { version: 1, pins: [] };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const pins = Array.isArray(parsed?.pins) ? parsed.pins.map(sanitizePin).slice(0, 100) : [];
  return { version: 1, pins };
}

function writeStore(store) {
  const file = getFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify({ version: 1, pins: store.pins }, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
  return store.pins;
}

function listPins() {
  return [...readStore().pins].sort((a, b) => b.updatedAt - a.updatedAt);
}

function upsertPin(input) {
  const store = readStore();
  const idx = typeof input?.id === 'string' ? store.pins.findIndex(p => p.id === input.id) : -1;
  const prev = idx >= 0 ? store.pins[idx] : null;
  const next = sanitizePin({
    ...prev,
    ...input,
    createdAt: prev?.createdAt || Date.now(),
    updatedAt: Date.now()
  });
  if (idx >= 0) {
    store.pins[idx] = next;
  } else {
    if (store.pins.length >= 100) store.pins.pop();
    store.pins.unshift(next);
  }
  writeStore(store);
  return listPins();
}

function togglePin(id, enabled) {
  const targetId = String(id || '').trim();
  const store = readStore();
  const item = store.pins.find(p => p.id === targetId);
  if (!item) throw Error('未找到对应的暂存条目');
  item.enabled = enabled === undefined ? !item.enabled : Boolean(enabled);
  writeStore(store);
  return listPins();
}

function deletePin(id) {
  const targetId = String(id || '').trim();
  if (!targetId) throw Error('Missing pin id');
  const store = readStore();
  store.pins = store.pins.filter(p => p.id !== targetId);
  writeStore(store);
  return listPins();
}

function clearPins() {
  writeStore({ version: 1, pins: [] });
  return [];
}

module.exports = { listPins, upsertPin, togglePin, deletePin, clearPins, getFile };
