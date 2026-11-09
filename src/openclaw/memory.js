/**
 * ExpressCoach × OpenClaw 记忆桥接层 — src/openclaw/memory.js
 *
 * 决赛重构 (框架使用深度 · 记忆特性):
 *
 *   原实现有两个各自为政的记忆载体:
 *     ① src/memory/user-profile.js  —— SQLite 长期画像 (跨会话, 但只在 CLI 里用)
 *     ② src/sandbox/sandbox.js ContextManager —— 内存上下文 (会话内, 进程退出即丢)
 *
 *   本模块把两者统一挂到 OpenClaw 会话存储之上:
 *     - 长期画像  → 框架会话键 expresscoach:profile:<id>   (持久化)
 *     - 对话上下文 → 框架会话键 expresscoach:context:<sid> (可跨进程恢复)
 *   自研 SQLite 画像仍然保留作为结构化查询层, 框架存储负责会话级状态。
 *
 * 这样"记忆"就真正由框架承载, 而不是进程内的临时 Map。
 */

import {
  sessionKey,
  loadSessions,
  updateSession,
  emitTrace,
} from "./runtime.js";

// ============================================================
// 1. 长期记忆 — 用户画像
// ============================================================

/**
 * 写入/合并一条用户画像记忆
 * @param {string|number} profileId
 * @param {object} patch  要合并的画像字段 (风格偏好 / 常用关系 / 历史统计)
 */
export async function rememberProfile(profileId, patch = {}) {
  const key = sessionKey("profile", String(profileId));
  emitTrace("memory.profile.write", { profileId, fields: Object.keys(patch) });
  return updateSession(key, patch);
}

/**
 * 读取一条用户画像记忆 (无记录时返回 null)
 * @param {string|number} profileId
 */
export function recallProfile(profileId) {
  const key = sessionKey("profile", String(profileId));
  const entry = loadSessions()[key];
  emitTrace("memory.profile.read", { profileId, hit: !!entry });
  return entry || null;
}

/**
 * 列出全部画像记忆条目
 */
export function listProfileMemories() {
  const store = loadSessions();
  const prefix = "expresscoach:profile:";
  return Object.entries(store)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ profileId: k.slice(prefix.length), ...v }));
}

// ============================================================
// 2. 短期记忆 — 对话上下文 (沙盒 / 多轮)
// ============================================================

/**
 * 追加一轮对话到框架会话记忆
 * @param {string} sessionId
 * @param {{role:string, content:string}} turn
 */
export async function appendTurn(sessionId, turn) {
  const key = sessionKey("context", sessionId);
  const prev = loadSessions()[key] || { turns: [] };
  const turns = [...(prev.turns || []), turn].slice(-20); // 只保留最近 20 轮
  emitTrace("memory.context.append", { sessionId, role: turn.role, total: turns.length });
  return updateSession(key, { turns });
}

/**
 * 恢复一个会话的对话记忆
 * @param {string} sessionId
 * @returns {Array<{role:string, content:string}>}
 */
export function recallTurns(sessionId) {
  const key = sessionKey("context", sessionId);
  const entry = loadSessions()[key];
  return entry?.turns || [];
}

/**
 * 清空一个会话的对话记忆
 * @param {string} sessionId
 */
export async function clearTurns(sessionId) {
  const key = sessionKey("context", sessionId);
  emitTrace("memory.context.clear", { sessionId });
  return updateSession(key, { turns: [], clearedAt: Date.now() });
}

// ============================================================
// 3. 记忆桥接器 — 给沙盒/管线统一使用的对象
// ============================================================

/**
 * 会话记忆桥接器。
 *
 * 用法:
 *   const mem = new SessionMemory("sess-001", { profileId: 1 });
 *   await mem.push({ role: "user", content: "..." });
 *   const history = mem.history();
 */
export class SessionMemory {
  /**
   * @param {string} sessionId
   * @param {object} opts { profileId }
   */
  constructor(sessionId, opts = {}) {
    this.sessionId = sessionId;
    this.profileId = opts.profileId ?? null;
    this._turns = recallTurns(sessionId);
  }

  /** 追加一轮并持久化 */
  async push(role, content) {
    const turn = { role, content, at: Date.now() };
    this._turns = [...this._turns, turn].slice(-20);
    await appendTurn(this.sessionId, turn);
    return turn;
  }

  /** 获取对话历史 (不含元字段) */
  history() {
    return this._turns.map(({ role, content }) => ({ role, content }));
  }

  /** 读取关联的长期画像 */
  profile() {
    return this.profileId ? recallProfile(this.profileId) : null;
  }

  /**
   * 把本次分析的关键结论沉淀进长期画像记忆
   * @param {object} analysisData { intent, relationship, sensitivity, style }
   */
  async consolidate(analysisData = {}) {
    if (!this.profileId) return null;
    const prev = recallProfile(this.profileId) || {};
    const stats = prev.stats || { total: 0, byIntent: {}, byStyle: {} };

    stats.total = (stats.total || 0) + 1;
    const intentKey = analysisData.intent || "未知";
    const styleKey = analysisData.style || "eq";
    stats.byIntent[intentKey] = (stats.byIntent[intentKey] || 0) + 1;
    stats.byStyle[styleKey] = (stats.byStyle[styleKey] || 0) + 1;

    return rememberProfile(this.profileId, {
      ...prev,
      stats,
      lastSensitivity: analysisData.sensitivity ?? null,
      lastRelationship: analysisData.relationship ?? null,
      lastUpdated: Date.now(),
    });
  }

  /** 清空本会话记忆 */
  async reset() {
    this._turns = [];
    await clearTurns(this.sessionId);
  }
}
