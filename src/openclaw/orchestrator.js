/**
 * ExpressCoach × OpenClaw 多智能体编排器 — src/openclaw/orchestrator.js
 *
 * 决赛重构核心: 项目的六阶段推理链不再用裸 Promise.allSettled 自行调度，
 * 而是统一注册为 OpenClaw 工具(AnyAgentTool 规范) 后由本编排器调度:
 *
 *   M1 intent  →  M2 relationship  →  M4 generate×3 (并行)  →  M5 predict
 *                                                              ↓
 *                                          M6 sandbox: coach(心跳) + simulator
 *
 * 框架能力调用点:
 *   - emitTrace()     每个阶段进出都上报诊断事件总线 → 全链路可追溯
 *   - heartbeatTick() 沙盒每轮 = 一次心跳节拍, 驱动 Coach 的介入判定
 *   - updateSession() 会话状态走框架会话存储, 跨进程持久化
 */

import { buildAgentTools } from "./agents.js";
import { emitTrace, heartbeatTick } from "./runtime.js";
import { generateThreeVersions } from "../generate/three-versions.js";
import { MODE_CONFIGS, ContextManager } from "../sandbox/sandbox.js";
import { CoachAgent } from "../sandbox/coach.js";
import { SimulatorAgent } from "../sandbox/simulator.js";
import { SessionMemory } from "./memory.js";

// ============================================================
// 1. 工具注册表 — 按 OpenClaw Plugin SDK AnyAgentTool 规范
// ============================================================

/**
 * 创建工具注册表。
 * 独立部署时由本编排器调度；作为网关插件运行时同一份定义交给 api.registerTool()。
 */
export function createToolRegistry() {
  const tools = buildAgentTools();
  return {
    /** name → tool 的映射 */
    byName: new Map(tools.map((t) => [t.name, t])),

    /** 全部工具定义 (不含 handler, 可安全序列化给网关) */
    definitions: tools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),

    /** 全部工具 (含 handler) */
    all: tools,

    /**
     * 调用一个工具，并上报诊断事件。
     * @param {string} name 工具名
     * @param {object} args 参数
     */
    async invoke(name, args = {}) {
      const tool = this.byName.get(name);
      if (!tool) throw new Error(`未注册的 Agent 工具: ${name}`);

      const startedAt = Date.now();
      emitTrace(`tool.${name}.start`, { args: Object.keys(args) });
      try {
        const result = await tool.handler(args);
        emitTrace(`tool.${name}.done`, { ms: Date.now() - startedAt, ok: true });
        return result;
      } catch (e) {
        emitTrace(`tool.${name}.error`, { ms: Date.now() - startedAt, error: String(e?.message || e) });
        throw e;
      }
    },
  };
}

/** 全局共享注册表 (懒加载单例) */
let _registry = null;
export function getRegistry() {
  if (!_registry) _registry = createToolRegistry();
  return _registry;
}

// ============================================================
// 2. 六阶段推理链编排
// ============================================================

/**
 * 执行完整推理链: M1 → M2 → M4(三版本并行) → M5
 *
 * 与旧实现的行为保持完全一致(同样的模块、同样的降级逻辑)，
 * 区别是每一步都经过框架工具注册表调度并上报事件。
 *
 * @param {string} scenario 中文社交场景描述
 * @param {object} opts
 * @param {string} [opts.sessionId] 会话标识, 用于框架会话存储
 * @returns {Promise<object>} 完整分析结果
 */
export async function runPipeline(scenario, opts = {}) {
  const reg = getRegistry();
  const sid = opts.sessionId || "default";
  const startedAt = Date.now();

  emitTrace("pipeline.start", { scenario: scenario.slice(0, 40), session: sid });

  // ---- M1 意图识别 ∥ M2 关系判断 (输入相同、互不依赖，并行执行) ----
  emitTrace("pipeline.m1m2.start", { note: "intent + relationship in parallel" });
  const [intent, relationship] = await Promise.all([
    reg.invoke("expresscoach.intent", { scenario }),
    reg.invoke("expresscoach.relationship", { scenario }),
  ]);
  emitTrace("pipeline.m1m2.done", { ms: Date.now() - startedAt });

  // ---- M4 三版本并行生成 ----
  // 三版本必须作为一个整体走差异度校验, 因此单独调用编排后的生成器,
  // 而非拆成三次独立工具调用 (否则 Jaccard 检查丢失)
  emitTrace("pipeline.m4.start", { note: "three generators in parallel" });
  const versions = await generateThreeVersions(scenario, relationship);
  emitTrace("pipeline.m4.done", { count: Object.keys(versions || {}).length });

  // ---- M5 反应预测 ∥ 记忆沉淀 (并行执行) ----
  const eqVersion = (versions || []).find?.((v) => v.styleKey === "eq") || (versions || [])[0];
  const eqContent = eqVersion?.parsed?.content || "";
  const [predictions, memorized] = await Promise.all([
    eqContent
      ? reg.invoke("expresscoach.predict", {
          scenario,
          selectedVersion: eqContent,
          style: eqVersion?.meta?.name || "eq",
        }).catch(() => null)
      : Promise.resolve(null),
    (async () => {
      try {
        const memory = new SessionMemory(sid, { profileId: opts.profileId });
        const prev = memory.profile() || {};
        await memory.consolidate({
          intent: intent?.["意图"] ?? intent?.intent ?? null,
          relationship: relationship?.["关系类型"] ?? null,
          sensitivity: relationship?.敏感度得分 ?? null,
          style: opts.style || "eq",
        });
        return { profileId: opts.profileId ?? null, totalRuns: Number(prev.stats?.total || 0) + 1 };
      } catch { return null; }
    })(),
  ]);

  const result = {
    scenario,
    intent,
    relationship,
    versions,
    predictions: predictions?.parsed || predictions || null,
    meta: {
      sessionId: sid,
      durationMs: Date.now() - startedAt,
      orchestrator: "OpenClaw",
      stages: ["M1.intent∥M2.relationship", "M4.generate×3", "M5.predict∥memory"],
      memorized,
    },
  };

  emitTrace("pipeline.done", { ms: result.meta.durationMs });
  return result;
}

/**
 * 执行 M5 反应预测 (用户选定版本后调用)
 * @param {string} scenario
 * @param {string} selectedVersion 用户选定的回复文本
 * @param {"mild"|"firm"|"eq"} style
 */
export async function runPrediction(scenario, selectedVersion, style = "eq") {
  const reg = getRegistry();
  return reg.invoke("expresscoach.predict", { scenario, selectedVersion, style });
}

// ============================================================
// 3. 沙盒编排 — 心跳驱动的非对称双 Agent
// ============================================================

/**
 * 可编程沙盒会话。
 *
 * 原 startSandbox() 是绑定控制台的交互式实现 (readline + console.log),
 * 无法被 Web 端复用。本类提供等价的多 Agent 调度语义，但以可编程单轮为单位：
 *
 *   每轮 = 一次心跳节拍 (heartbeatTick)
 *          ├─ Simulator 生成对方回复          (角色扮演 Agent)
 *          └─ Coach 按心跳周期判定是否介入    (元 Agent, 最小干预)
 *   上下文由 ContextManager 管理，状态持久化到 OpenClaw 会话存储
 */
export class SandboxOrchestrator {
  /**
   * @param {string} scenario 场景描述
   * @param {"free"|"guided"|"stress"} mode
   * @param {string} personality 对手人格 friendly/neutral/hostile/avoidant/emotional
   * @param {object} opts { rounds, sessionId }
   */
  constructor(scenario, mode = "free", personality = "friendly", opts = {}) {
    const config = MODE_CONFIGS[mode] || MODE_CONFIGS.free;

    this.scenario = scenario;
    this.mode = mode;
    this.round = 0;
    this.maxRounds = opts.rounds || 10;
    this.sessionId = opts.sessionId || `sb-${Date.now()}`;

    this.coachConfig = config.coachConfig;
    this.ctx = new ContextManager(this.maxRounds);

    // 两个非对称 Agent: coach 只观察不参战, simulator 扮演对手
    this.coach = new CoachAgent();
    this.simulator = new SimulatorAgent(
      config.simulatorConfig.forcePersonality || personality
    );

    this.history = [];

    // 会话记忆: 挂到 OpenClaw 会话存储, 支持跨进程恢复上下文
    this.memory = new SessionMemory(this.sessionId, { profileId: opts.profileId });
  }

  /**
   * 发送一轮用户消息，返回对方回复 + (可能的)教练介入
   * @param {string} userMessage
   * @returns {Promise<{reply: string, round: number, intervention: object|null, done: boolean}>}
   */
  async sendTurn(userMessage) {
    if (this.round >= this.maxRounds) {
      return { reply: "", round: this.round, intervention: null, done: true };
    }

    this.round += 1;
    this.ctx.append("user", userMessage);

    // ---- 心跳节拍: 每轮对话 = 一次 tick ----
    heartbeatTick("coach", `round-${this.round}`, {
      round: this.round,
      mode: this.mode,
      session: this.sessionId,
    });

    // ---- Simulator: 角色扮演 Agent 生成对方回复 ----
    emitTrace("sandbox.simulator.start", { round: this.round });
    const reply = await this.simulator.generateReply(this.ctx.getContext(), userMessage);
    emitTrace("sandbox.simulator.done", { round: this.round, len: (reply || "").length });

    this.ctx.append("simulator", reply);
    this.history.push({ round: this.round, user: userMessage, them: reply });

    // ---- Coach: 按心跳周期判定介入 (最小干预原则) ----
    let intervention = null;
    if (this.coachConfig.enabled) {
      const onBeat =
        this.mode === "stress"
          ? this._isHelpRequest(userMessage)
          : this.coachConfig.proactiveInterval > 0 &&
            this.round % this.coachConfig.proactiveInterval === 0;

      if (onBeat) {
        emitTrace("sandbox.coach.evaluate", { round: this.round, trigger: this.mode });
        const decision = await this.coach.shouldIntervene(this.ctx.getContext(), {
          userMessage,
          round: this.round,
        });

        if (decision?.should) {
          // 命中五类触发条件之一 → 直接采用 Coach 的介入建议
          intervention = {
            reason: decision.reason,
            suggestion: decision.suggestion,
            example: decision.example || "",
            round: this.round,
          };
          emitTrace("sandbox.coach.intervene", { round: this.round, reason: decision.reason });
        } else if (this.mode === "guided") {
          // guided 模式到节拍必定给一条策略提示 (与 CLI 原实现行为一致)
          const tip = await this._proactiveTip(this.ctx.getContext());
          if (tip) {
            this.coach.interventionCount++;
            this.coach._recordIntervention(this.round, `proactive (round ${this.round})`, {
              suggestion: tip,
            });
            intervention = {
              reason: `round ${this.round}`,
              suggestion: tip,
              example: "",
              round: this.round,
            };
            emitTrace("sandbox.coach.intervene", { round: this.round, reason: "proactive" });
          }
        }
      }
    }

    // 持久化会话状态到框架记忆层 (跨进程可恢复)
    await this.memory.push("simulator", reply);

    return {
      reply,
      round: this.round,
      intervention,
      done: this.round >= this.maxRounds,
    };
  }

  /**
   * guided 模式的主动提示: 让 LLM 基于最近对话给一条 30-50 字的策略建议。
   * 失败时回退到固定话术, 不阻塞对话。
   */
  async _proactiveTip(context) {
    const recent = (context || []).slice(-6);
    const transcript = recent
      .map((e) => `[${e.role === "user" ? "user" : e.role === "simulator" ? "them" : e.role}] ${e.content}`)
      .join("\n");
    try {
      const { callLLM } = await import("../lib/api.js");
      const llm = await callLLM(
        "你是一位中文社交表达教练。给出一条简短实用的策略提示(30-50字)，只输出提示本身。",
        `对话(第${this.round}轮):\n${transcript}\n\n策略提示:`,
        { temperature: 0.3, maxTokens: 150 }
      );
      return (llm?.content || "").trim();
    } catch {
      return "试着先站在对方角度找到共同点，再表达自己的立场。";
    }
  }

  /** 压力模式下: 仅当用户明确求助时才触发 Coach */
  _isHelpRequest(msg) {
    const helps = ["帮帮我", "怎么说", "救命", "不知道怎么说", "怎么办", "教我", "救救我", "help", "帮我", "怎么回"];
    return helps.some((k) => msg.includes(k));
  }

  /** 导出当前会话摘要 (供 Web 端展示/恢复) */
  getState() {
    return {
      scenario: this.scenario,
      mode: this.mode,
      round: this.round,
      maxRounds: this.maxRounds,
      sessionId: this.sessionId,
      history: this.history,
      coachStats: this.coach.getInterventionStats?.() ?? null,
    };
  }
}

export { MODE_CONFIGS };
