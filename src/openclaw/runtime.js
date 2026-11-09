/**
 * ExpressCoach × OpenClaw 框架能力封装层 — src/openclaw/runtime.js
 *
 * 决赛重构: 将项目对 OpenClaw 框架的使用收敛到本模块，集中调用框架的四类真实能力:
 *
 *   1. 多智能体工具规范 (AnyAgentTool: name/description/parameters/handler)
 *      → 见 src/openclaw/agents.js, 编排见 src/openclaw/orchestrator.js
 *   2. 诊断事件总线 (emitDiagnosticEvent / onDiagnosticEvent)
 *      → 六阶段推理链的每一步都上报事件, 实现全链路可观测、可追溯
 *   3. 心跳事件机制 (emitHeartbeatEvent / onHeartbeatEvent)
 *      → 沙盒 Coach 的"每2轮介入检查"由心跳节拍驱动, 见 sandbox.js
 *   4. 会话存储 (resolveSessionKey / updateSessionStore / loadSessionStore)
 *      → 用户画像与沙盒会话的跨进程持久化, 替代易失的内存 Map
 *
 * 说明: OpenClaw 的完整子Agent运行时 (PluginRuntime.subagent) 由网关宿主注入,
 * 本工程在独立部署模式下通过编排器实现等价的多Agent调度语义;
 * 当作为 OpenClaw 网关插件运行时, 同一套工具定义由 registerTool 直接托管 (见 src/plugin.js)。
 */

import path from "path";
import { fileURLToPath } from "url";
import { resolveSessionKey } from "openclaw";
import {
  loadSessionStore,
  updateSessionStore,
  saveSessionStore,
} from "openclaw/plugin-sdk/session-store-runtime";
import { emitDiagnosticEvent, onDiagnosticEvent } from "openclaw/plugin-sdk/diagnostic-runtime";
import { emitHeartbeatEvent, onHeartbeatEvent } from "openclaw/plugin-sdk/heartbeat-runtime";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.resolve(__dirname, "..", "..", "data", "openclaw-sessions.json");

/** 框架能力探测结果缓存 (避免每次调用重复探测) */
let _capabilities = null;

// ============================================================
// 0. 框架能力探测 — 答辩时可现场打印, 证明框架真实被调用
// ============================================================

/**
 * 探测当前环境实际可用的 OpenClaw 能力。
 * 返回各能力的 {available, api} 描述, 供 /api/openclaw/status 与 CLI 展示。
 */
export function detectCapabilities() {
  if (_capabilities) return _capabilities;

  const probe = (fn) => {
    try {
      const v = fn();
      return { available: typeof v === "function", api: typeof v === "function" };
    } catch {
      return { available: false, api: false };
    }
  };

  // 会话键派生: 必须能正确派生出 expresscoach 命名空间下的键, 才算真实可用
  let sessionStoreAvailable = false;
  try {
    const k = resolveSessionKey("per-sender", { SessionKey: "expresscoach:self-test" });
    sessionStoreAvailable = typeof k === "string" && k.startsWith("expresscoach:");
  } catch { /* ignore */ }

  _capabilities = {
    framework: "OpenClaw",
    sessionStore: { available: sessionStoreAvailable, api: "resolveSessionKey/loadSessionStore/updateSessionStore" },
    diagnosticBus: probe(() => emitDiagnosticEvent),
    heartbeat: probe(() => emitHeartbeatEvent),
    storePath: STORE_PATH,
  };
  return _capabilities;
}

// ============================================================
// 1. 诊断事件总线 — 推理链可观测性
// ============================================================

/** 上报一个管线阶段事件到 OpenClaw 诊断事件总线 */
export function emitTrace(stage, detail = {}) {
  try {
    emitDiagnosticEvent({ type: `expresscoach.${stage}`, ...detail });
  } catch { /* 诊断上报不阻塞主流程 */ }
}

/** 订阅诊断事件 (供日志/UI 展示推理链), 返回退订函数 */
export function onTrace(listener) {
  try {
    return onDiagnosticEvent((evt) => {
      if (String(evt?.type || "").startsWith("expresscoach.")) listener(evt);
    });
  } catch {
    return () => {};
  }
}

// ============================================================
// 2. 心跳事件 — 沙盒 Coach 节拍驱动
// ============================================================

/** 发送一次心跳节拍 (沙盒中每轮对话 = 一次 tick) */
export function heartbeatTick(agentId, reason, extra = {}) {
  try {
    emitHeartbeatEvent({ type: "tick", agentId, reason, ...extra });
  } catch { /* 心跳失败不阻塞主流程 */ }
}

/** 订阅心跳事件, 返回退订函数 */
export function onHeartbeat(listener) {
  try {
    return onHeartbeatEvent(listener);
  } catch {
    return () => {};
  }
}

// ============================================================
// 3. 会话存储 — 用户画像 / 沙盒会话持久化
// ============================================================

/**
 * 派生符合 OpenClaw 规范的会话键。
 *
 * 注意: 框架提供两个函数 ——
 *   deriveSessionKey(scope, ctx)  会对 ctx.From 做 E.164 归一化,
 *                                 自定义命名空间(如 expresscoach:*)会被压成 "+"/"unknown";
 *   resolveSessionKey(scope, ctx) 优先采用 ctx.SessionKey 显式键并原样保留。
 * 因此本工程统一走 resolveSessionKey + SessionKey, 保证命名空间与可读性。
 */
export function sessionKey(agentId, subject = "default") {
  const explicit = `expresscoach:${agentId}:${subject}`;
  try {
    return resolveSessionKey("per-sender", { SessionKey: explicit });
  } catch {
    return explicit;
  }
}

/** 读取整个会话存储 (无文件或异常时返回空对象) */
export function loadSessions(opts = {}) {
  try {
    return loadSessionStore(STORE_PATH, opts) || {};
  } catch {
    return {};
  }
}

/**
 * 原子更新单个会话条目 — 走框架的 updateSessionStore(读-改-写) 语义,
 * 避免自行 load/save 造成的并发覆盖。
 *
 * @param {string} key     会话键 (由 sessionKey() 派生)
 * @param {object} patch   要合并进条目的字段
 * @param {object} options 透传给 updateSessionStore, 如 { agentId, storePath }
 */
export async function updateSession(key, patch, options = {}) {
  try {
    const entry = await updateSessionStore(
      STORE_PATH,
      (store) => {
        const prev = store[key] || {};
        store[key] = { ...prev, ...patch, updatedAt: Date.now() };
        return store[key];
      },
      options
    );
    return entry || null;
  } catch {
    // 框架存储不可用时回退到普通写, 保证功能不中断
    try {
      const store = loadSessions();
      store[key] = { ...(store[key] || {}), ...patch, updatedAt: Date.now() };
      await saveSessionStore(STORE_PATH, store);
      return store[key];
    } catch {
      return null;
    }
  }
}

export const OPENCLAW_STORE_PATH = STORE_PATH;
