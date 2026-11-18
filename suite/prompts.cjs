const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
function getFile() {
  return process.env.AGY_SUITE_PROMPTS_FILE || path.join(root, 'data', 'suite-prompts.json');
}

const BUILTIN_PROMPTS = [
  {
    id: 'builtin-root-cause',
    title: '🔬 深度根因排查与最小修复',
    category: '调试',
    pinned: true,
    content: '我遇到了以下异常 / 问题现象：\n{{问题现象或报错日志}}\n\n相关模块或上下文：{{涉及模块或文件:自动检索相关代码}}\n\n请按以下步骤处理：\n1. 先定位真实根因（给出调用链与代码行号依据），不要猜测或只做表面兜底；\n2. 设计最小侵入且无副作用的修复方案；\n3. 修改后运行并补充针对该边界场景的回归验证。'
  },
  {
    id: 'builtin-arch-design',
    title: '🏛️ 模块架构设计与边界评审',
    category: '工程',
    pinned: true,
    content: '请帮我设计并实现 **{{功能或模块名称}}**：\n- 核心目标：{{核心业务或技术目标}}\n- 关键约束：{{性能与兼容约束:保持现有接口向后兼容，零冗余依赖}}\n\n请先梳理数据流、状态边界与异常恢复策略，确认无架构隐患后直接完成高质量实现与测试。'
  },
  {
    id: 'builtin-research-pilot',
    title: '📐 算法 / 论文核心创新点提炼',
    category: '科研',
    pinned: true,
    content: '围绕课题 **{{研究课题或赛题方向}}**，结合当前代码库与实验基线：\n- 现有瓶颈：{{基线方法痛点}}\n- 目标场景：{{实验平台或评价指标}}\n\n请从第一性原理出发，提炼 2~3 个机制自洽、可消融验证、具备强差异化的核心创新点，并给出最小可行先导实验（Pilot）验证路径。'
  },
  {
    id: 'builtin-perf-audit',
    title: '⚡ 性能瓶颈剖析与基准对比',
    category: '优化',
    pinned: false,
    content: '请对 **{{目标路径或热点流程}}** 进行深度性能剖析：\n- 当前痛点：{{耗时或内存表现}}\n- 优化目标：{{期望提升指标:显著降低延迟与冗余计算}}\n\n请识别复杂度瓶颈、I/O 阻塞或重复渲染点，给出量化对比方案并落地优化。'
  },
  {
    id: 'builtin-clean-refactor',
    title: '🧹 等价重构与代码精简',
    category: '工程',
    pinned: false,
    content: '请审视 **{{目标文件或目录}}** 的代码结构，在严格保持外部行为与现有测试 100% 等价的前提下：\n- 重点清理：{{重构侧重点:消除重复逻辑、收紧状态边界、提升可读性}}\n\n完成后运行完整测试套件确认无回归。'
  },
  {
    id: 'builtin-precommit-guard',
    title: '🛡️ 提交前安全与质量全检',
    category: '自检',
    pinned: false,
    content: '在提交代码到 **{{目标分支:main}}** 之前，请对当前工作区所有改动做一次严格审查：\n1. 检查是否存在硬编码密钥、个人敏感路径或临时调试残留；\n2. 检查边界条件、并发竞态、错误回滚与资源清理；\n3. 运行全部回归测试并汇报结果。'
  }
];

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid prompt item');
  const title = String(raw.title || '').trim();
  const content = String(raw.content || '').trim();
  const category = String(raw.category || '通用').trim().slice(0, 24) || '通用';
  const pinned = Boolean(raw.pinned);
  if (!title || title.length > 80) throw Error('模板标题长度需在 1~80 个字符之间');
  if (!content || content.length > 12000) throw Error('模板内容长度需在 1~12000 个字符之间');
  const id = typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{2,64}$/.test(raw.id)
    ? raw.id
    : 'prm_' + crypto.randomBytes(6).toString('hex');
  return { id, title, category, pinned, content, updatedAt: Number(raw.updatedAt) || Date.now() };
}

function readStore() {
  const file = getFile();
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      deletedBuiltins: [],
      prompts: BUILTIN_PROMPTS.map((item, idx) => ({ ...item, updatedAt: 1700000000000 - idx * 1000 }))
    };
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const deletedBuiltins = Array.isArray(parsed?.deletedBuiltins)
    ? parsed.deletedBuiltins.filter(id => typeof id === 'string')
    : [];
  const list = Array.isArray(parsed?.prompts) ? parsed.prompts.map(sanitizeItem) : [];
  const existingIds = new Set(list.map(p => p.id));
  for (const builtin of BUILTIN_PROMPTS) {
    if (!existingIds.has(builtin.id) && !deletedBuiltins.includes(builtin.id)) {
      list.push({ ...builtin, updatedAt: 1700000000000 });
    }
  }
  return { version: 1, deletedBuiltins, prompts: list.slice(0, 200) };
}

function writeStore(store) {
  const file = getFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify({
    version: 1,
    deletedBuiltins: store.deletedBuiltins || [],
    prompts: store.prompts
  }, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
  return store.prompts;
}

function listPrompts() {
  const store = readStore();
  return [...store.prompts].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.updatedAt - a.updatedAt));
}

function upsertPrompt(input) {
  const store = readStore();
  const next = sanitizeItem({ ...input, updatedAt: Date.now() });
  const idx = store.prompts.findIndex(p => p.id === next.id);
  if (idx >= 0) {
    store.prompts[idx] = next;
  } else {
    if (store.prompts.length >= 200) throw Error('模板数量已达上限 (200)');
    store.prompts.unshift(next);
  }
  store.deletedBuiltins = (store.deletedBuiltins || []).filter(id => id !== next.id);
  writeStore(store);
  return listPrompts();
}

function deletePrompt(id) {
  const targetId = String(id || '').trim();
  if (!targetId) throw Error('Missing prompt id');
  const store = readStore();
  store.prompts = store.prompts.filter(p => p.id !== targetId);
  if (BUILTIN_PROMPTS.some(b => b.id === targetId) && !store.deletedBuiltins.includes(targetId)) {
    store.deletedBuiltins.push(targetId);
  }
  writeStore(store);
  return listPrompts();
}

function importPrompts(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) {
    throw Error('请提供 1~100 条合法的提示词模板数组');
  }
  const store = readStore();
  const sanitized = items.map(item => sanitizeItem({ ...item, updatedAt: Date.now() }));
  for (const item of sanitized) {
    const idx = store.prompts.findIndex(p => p.id === item.id || p.title === item.title);
    if (idx >= 0) store.prompts[idx] = { ...item, id: store.prompts[idx].id };
    else if (store.prompts.length < 200) store.prompts.push(item);
  }
  writeStore(store);
  return listPrompts();
}

module.exports = { BUILTIN_PROMPTS, listPrompts, upsertPrompt, deletePrompt, importPrompts, getFile };
