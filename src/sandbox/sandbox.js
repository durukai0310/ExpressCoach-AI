#!/usr/bin/env node
/**
 * Sandbox 沙盒主控 — 双Agent对话沙盒 (Day 17 增强)
 *
 * 架构:
 *   Coach Agent (教练)  ←→  共享上下文  ←→  Simulator Agent (模拟对方)
 *                              ↕
 *                           用户输入
 *
 * Day 16 新增:
 *   - ContextManager: LLM生成100字摘要压缩（不是简单截断）
 *   - 非交互自动模式: --autopilot 自动生成用户回复进行多轮测试
 *   - 15轮连续对话不崩溃验证
 *
 * Day 17 新增:
 *   - 三种练习模式 mode: free(自由) / guided(引导) / stress(压力)
 *   - 每种模式有独立配置对象 {coachConfig, simulatorConfig}
 *   - free: coach完全静默, simulator正常性格
 *   - guided: coach每2轮主动给一次建议, simulator正常
 *   - stress: simulator强制hostile性格, coach只在求助时介入
 *
 * 功能:
 *   - 共享上下文数组 sharedContext: 每轮追加 {role, content, timestamp}
 *   - 10轮硬上限，超过自动触发LLM压缩前5轮为100字摘要，保留后5轮原文
 *   - 支持三种模拟对方性格: friendly / hostile / avoidant
 *   - Coach 旁听并在4种关键时刻介入
 *
 * 用法:
 *   node src/sandbox/sandbox.js "场景描述" free
 *   node src/sandbox/sandbox.js "场景描述" guided --rounds 5
 *   node src/sandbox/sandbox.js "场景描述" stress --rounds 5 --autopilot
 *
 * 使用 CommonJS 规范
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

const { CoachAgent } = require("./coach");
const { SimulatorAgent } = require("./simulator");
const { callDeepSeek } = require("../intent/recognize");

// ============================================================
// 终端颜色
// ============================================================
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};
function c(code, text) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return code + text + C.reset;
}

// ============================================================
// 上下文压缩专用 System Prompt（Day 16 新增）
// ============================================================
const COMPRESS_SYSTEM_PROMPT = `你是一个对话摘要专家。你的任务是将多轮对话压缩为简洁的摘要。

## 要求
1. 摘要必须控制在100字以内
2. 保留关键信息: 双方立场、核心争议点、已达成的共识、情绪变化
3. 使用简洁的中文
4. 只输出摘要文本，不要加任何前缀或说明

## 示例
输入: "用户: 我想拒绝朋友借钱。对方: 怎么了？你说说看。用户: 我最近手头也紧。对方: 我也是没办法才找你的..."
输出: "用户拒绝朋友借钱请求。对方以急需为由施压，用户以自身困难推脱。双方立场对立但尚未撕破脸，对话处于试探阶段。"`;

// ============================================================
// ContextManager — 共享上下文窗口管理（Day 16 增强版）
// ============================================================

class ContextManager {
  constructor(maxRounds = 10) {
    // Day 16: maxRounds 是上下文窗口硬上限（固定10轮），
    // 与会话总轮次（--rounds 15）是独立的概念
    this.maxRounds = 10; // 硬编码10轮上限（上下文窗口限制）
    this.sessionMaxRounds = maxRounds; // 会话总轮次（可配置，默认10）
    this.context = []; // [{role, content, timestamp}]
    this.compressionCount = 0; // Day 16: 压缩次数统计
  }

  /**
   * append: 追加一条消息到上下文
   */
  append(role, content) {
    this.context.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });

    // 检查是否超过硬上限（基于 user 消息轮次，固定10轮限制）
    const userMessages = this.context.filter((e) => e.role === "user");
    if (userMessages.length > this.maxRounds) {
      // 标记需要压缩，在下一轮前由 compress() 异步处理
      this._needsCompression = true;
    }
  }

  /**
   * needsCompression: 检查是否需要压缩（Day 16 新增）
   */
  needsCompression() {
    const userMessages = this.context.filter((e) => e.role === "user");
    return userMessages.length > this.maxRounds || this._needsCompression;
  }

  /**
   * compress: LLM生成100字摘要，压缩前5轮，保留后5轮原文（Day 16 增强版）
   *
   * 压缩不是截断——是保留信息但释放空间
   * 前5轮 → LLM生成100字摘要
   * 后5轮 → 保留原文
   */
  async compress() {
    console.log(c(C.yellow, "\n  ⚡ 上下文已超过10轮硬上限，触发 LLM 压缩..."));
    console.log(c(C.dim, `     压缩前: ${this.context.length} 条记录`));

    // 取前一半（旧消息）用于生成摘要
    const splitPoint = Math.floor(this.context.length / 2);
    const oldMessages = this.context.slice(0, splitPoint);

    // Day 16: 使用 LLM 生成100字摘要
    const summary = await this._generateSummary(oldMessages);

    // 保留后一半（新消息）
    const recentMessages = this.context.slice(splitPoint);

    // 重建上下文: 摘要 + 后缀标识 + 保留的新消息
    const summaryEntry = {
      role: "system",
      content: `[对话摘要 #${this.compressionCount + 1}] ${summary}`,
      timestamp: new Date().toISOString(),
    };

    this.context = [summaryEntry, ...recentMessages];
    this.compressionCount++;
    this._needsCompression = false;

    console.log(c(C.green, `     ✅ 上下文已压缩（LLM生成${summary.length}字摘要，保留 ${recentMessages.length} 条新记录）`));
    console.log(c(C.dim, `     摘要: ${summary}`));
  }

  /**
   * _generateSummary: 调用 LLM 生成100字摘要（Day 16 新增）
   * @param {Array} messages - 需要压缩的消息列表
   * @returns {String} 100字摘要
   */
  async _generateSummary(messages) {
    const conversationText = messages
      .map((e) => {
        const speaker = e.role === "user" ? "用户" : (e.role === "simulator" ? "对方" : "系统");
        return `${speaker}: ${e.content}`;
      })
      .join("\n");

    const prompt = `请将以下对话压缩为100字以内的摘要:\n\n${conversationText}`;

    try {
      const result = await callDeepSeek(COMPRESS_SYSTEM_PROMPT, prompt, {
        temperature: 0.1,
        maxTokens: 200,
      });
      const summary = result.content.trim();
      // 确保不超过100字
      return summary.length > 100 ? summary.substring(0, 97) + "..." : summary;
    } catch (e) {
      console.error(c(C.yellow, `     ⚠️ [ContextManager] LLM摘要生成失败: ${e.message}，使用简单截断`));
      // 降级: 简单连接前几条消息
      return messages
        .slice(0, 3)
        .map((e) => `[${e.role === "user" ? "用户" : "对方"}] ${e.content}`)
        .join(" | ")
        .substring(0, 100);
    }
  }

  /**
   * getContext: 获取当前上下文副本
   */
  getContext() {
    return [...this.context];
  }

  /**
   * getRoundCount: 获取当前轮次
   */
  getRoundCount() {
    return this.context.filter((e) => e.role === "user").length;
  }

  /**
   * getStats: 获取上下文统计（Day 16 新增）
   */
  getStats() {
    return {
      totalEntries: this.context.length,
      userRounds: this.getRoundCount(),
      compressionCount: this.compressionCount,
      contextLimit: this.maxRounds, // 上下文硬上限（固定10）
      sessionLimit: this.sessionMaxRounds, // 会话总轮次
    };
  }

  /**
   * reset: 重置上下文
   */
  reset() {
    this.context = [];
    this.compressionCount = 0;
    this._needsCompression = false;
  }
}

// ============================================================
// 自动用户回复生成（Day 16 新增：用于非交互自动测试）
// ============================================================
const AUTOPILOT_SYSTEM_PROMPT = `你正在参与一个社交对话练习。你扮演"用户"，正在就某个社交场景与对方对话。

## 你的角色
- 你是来练习社交表达的人
- 你的回复应该像一个真实的人在和对方对话
- 回复长度 15-50 字
- 保持自然口语化
- 只输出回复内容，不要加任何前缀或说明`;

/**
 * generateAutoUserReply: 自动生成用户回复（非交互模式测试用）
 */
async function generateAutoUserReply(scenario, context) {
  const recentContext = context.slice(-6);
  const contextStr = recentContext
    .map((e) => {
      const speaker = e.role === "user" ? "我（用户）" : (e.role === "simulator" ? "对方" : "系统");
      return `${speaker}: ${e.content}`;
    })
    .join("\n");

  const prompt = `场景: ${scenario}

对话历史:
${contextStr}

请以"用户"的身份回复对方。`;

  try {
    const result = await callDeepSeek(AUTOPILOT_SYSTEM_PROMPT, prompt, {
      temperature: 0.7,
      maxTokens: 150,
    });
    return result.content.trim();
  } catch (e) {
    console.error(c(C.yellow, `     ⚠️ 自动回复生成失败: ${e.message}`));
    return "嗯，让我想想怎么说...";
  }
}

// ============================================================
// 三种练习模式配置（Day 17 新增）
// ============================================================

const MODE_CONFIGS = {
  /**
   * free (自由模式): coach完全静默, simulator正常性格
   * - 教练不介入任何情况
   * - 模拟对方使用用户指定的性格
   */
  free: {
    label: "自由模式 🆓",
    description: "教练完全静默，自由练习社交表达",
    coachConfig: {
      enabled: false,        // 完全禁用教练
      helpRequest: false,    // 求助也不介入
      toneCheck: false,      // 语气检测关闭
      deadlockCheck: false,  // 僵局检测关闭
      cooldown: 999,         // 超大冷却期（永不介入）
    },
    simulatorConfig: {
      forcePersonality: null, // 不强制性格，使用用户指定
    },
  },

  /**
   * guided (引导模式): coach每2轮主动给一次建议, simulator正常
   * - 教练每2轮主动介入一次（无视其他条件）
   * - 模拟对方使用用户指定的性格
   */
  guided: {
    label: "引导模式 🎓",
    description: "教练每2轮主动给建议，边练边学",
    coachConfig: {
      enabled: true,
      helpRequest: true,     // 求助时立即响应
      toneCheck: true,       // 语气检测开启
      deadlockCheck: true,   // 僵局检测开启
      proactiveInterval: 2,  // 每2轮主动给一次建议（核心）
      cooldown: 0,           // 无冷却期（允许每轮介入）
    },
    simulatorConfig: {
      forcePersonality: null, // 不强制性格，使用用户指定
    },
  },

  /**
   * stress (压力模式): simulator强制hostile性格, coach只在求助时介入
   * - 模拟对方强制使用 hostile 性格（无视用户指定）
   * - 教练只在用户明确求助时介入
   */
  stress: {
    label: "压力模式 💪",
    description: "强制刁难对方，教练仅在求助时介入",
    coachConfig: {
      enabled: true,
      helpRequest: true,     // 求助时立即响应（核心）
      toneCheck: false,      // 语气检测关闭（压力下不提醒语气）
      deadlockCheck: false,  // 僵局检测关闭
      proactiveInterval: 0,  // 不主动介入
      cooldown: 3,           // 冷却期3轮（避免频繁介入）
    },
    simulatorConfig: {
      forcePersonality: "hostile", // 强制 hostile（核心）
    },
  },
};

// ============================================================
// _runCoachCheck — 根据模式配置执行教练介入检查（Day 17 新增）
// ============================================================

/**
 * 根据当前模式的 coachConfig 决定教练行为
 *
 * @param {CoachAgent} coach - 教练实例
 * @param {ContextManager} ctx - 上下文管理器
 * @param {String} mode - 练习模式
 * @param {Number} round - 当前轮次
 * @param {Object} coachConfig - 模式对应的教练配置
 * @returns {Object} {should, reason, suggestion}
 */
async function _runCoachCheck(coach, ctx, mode, round, coachConfig) {
  // free 模式: 教练完全静默
  if (!coachConfig.enabled) {
    return { should: false, reason: "自由模式-教练静默", suggestion: "" };
  }

  // stress 模式: 教练只在求助时介入
  if (mode === "stress") {
    const context = ctx.getContext();
    const lastUserMsg = [...context].reverse().find((e) => e.role === "user");
    const userMessage = lastUserMsg ? lastUserMsg.content : "";
    const helpKeywords = ["帮帮我", "怎么说", "救命", "不知道怎么说", "怎么办", "教我", "救救我", "help", "帮我", "怎么回", "不会说", "怎么表达"];
    const hasHelpRequest = helpKeywords.some((kw) => userMessage.includes(kw));

    if (hasHelpRequest) {
      console.log(c(C.dim, `     🔍 [Coach/stress] 检测到求助信号 → 介入`));
      return await coach.shouldIntervene(context);
    }
    // stress 模式非求助 → 静默
    return { should: false, reason: "压力模式-非求助静默", suggestion: "" };
  }

  // guided 模式: 每 N 轮主动给一次建议
  if (mode === "guided" && coachConfig.proactiveInterval > 0) {
    // 检查是否到达主动介入轮次
    if (round > 0 && round % coachConfig.proactiveInterval === 0) {
      console.log(c(C.dim, `     🔍 [Coach/guided] 第${round}轮 → 主动介入`));
      const context = ctx.getContext();
      const result = await coach.shouldIntervene(context);
      if (result.should) return result;

      // 即使 shouldIntervene 返回 false，guided 模式也强制给建议
      // Day 21 fix: 手动递增教练介入计数
      coach.interventionCount++;
      coach._recordIntervention(round, `主动引导（第${round}轮）`, { suggestion: "" });
      // 构建主动建议
      const recentContext = context.slice(-6);
      const contextStr = recentContext
        .map((e) => `[${e.role === "user" ? "用户" : (e.role === "simulator" ? "对方" : e.role)}] ${e.content}`)
        .join("\n");

      try {
        const { callDeepSeek } = require("../intent/recognize");
        const prompt = `当前对话（第${round}轮）:
${contextStr}

你是教练，请每2轮给用户一个简短的策略建议（30-50字）。
建议应该帮助用户优化表达策略，如调整语气、换一种切入方式、或提供可用的句式。
只输出建议内容本身，不要加前缀。`;

        const llmResult = await callDeepSeek(
          "你是一位社交表达教练，请给用户简短实用的策略建议。",
          prompt,
          { temperature: 0.3, maxTokens: 150 }
        );
        return {
          should: true,
          reason: `主动引导（第${round}轮）`,
          suggestion: llmResult.content.trim(),
        };
      } catch (e) {
        return {
          should: true,
          reason: `主动引导（第${round}轮）`,
          suggestion: "建议回顾一下对方的反应，调整你的表达角度。试着从对方的需求出发，寻找共同点。",
        };
      }
    }
  }

  // 通用模式: 按正常规则检查（guided/stress 的非特殊轮次也走这里）
  return await coach.shouldIntervene(ctx.getContext());
}

// ============================================================
// startSandbox — 沙盒启动函数（Day 17 增强版）
// ============================================================

/**
 * @param {String} scenario - 用户场景描述（如"我想拒绝朋友借钱"）
 * @param {String} mode - 练习模式: "free" | "guided" | "stress"
 * @param {String} personality - 模拟对方性格: "friendly" | "hostile" | "avoidant"
 * @param {Object} opts - 可选参数 {rounds: 最大轮次数, autopilot: 自动模式}
 */
async function startSandbox(scenario, mode = "free", personality = "friendly", opts = {}) {
  const maxRounds = opts.rounds || 10;
  const autopilot = opts.autopilot !== false && opts.autopilot !== undefined ? opts.autopilot : false;

  // Day 17: 获取模式配置
  const modeConfig = MODE_CONFIGS[mode] || MODE_CONFIGS.free;
  const { coachConfig, simulatorConfig } = modeConfig;

  // Day 17: stress 模式强制 hostile 性格
  const effectivePersonality = simulatorConfig.forcePersonality || personality;

  console.log("");
  console.log(c(C.bold, "╔══════════════════════════════════════════════════════╗"));
  console.log(c(C.bold, "║     🎭 ExpressCoach 双Agent对话沙盒 (Day 17)         ║"));
  console.log(c(C.bold, "║     Coach (智能介入) + Simulator (模拟对方)          ║"));
  console.log(c(C.bold, "╚══════════════════════════════════════════════════════╝"));
  console.log("");
  console.log(c(C.dim, `  场景: ${scenario}`));
  console.log(c(C.bold, `  练习模式: ${modeConfig.label}`));
  console.log(c(C.dim, `     ${modeConfig.description}`));
  console.log(c(C.dim, `  对方性格: ${effectivePersonality}${simulatorConfig.forcePersonality ? " (强制)" : ""}`));
  console.log(c(C.dim, `  最大轮次: ${maxRounds}`));
  console.log(c(C.dim, `  运行模式: ${autopilot ? "自动测试 🤖" : "交互模式 👤"}`));
  console.log("");

  // Day 17: 打印模式配置摘要
  console.log(c(C.dim, `  📋 模式配置:`));
  console.log(c(C.dim, `     Coach: ${coachConfig.enabled ? "启用" : "完全静默"}`));
  if (coachConfig.enabled) {
    const rules = [];
    if (coachConfig.helpRequest) rules.push("求助响应");
    if (coachConfig.toneCheck) rules.push("语气检测");
    if (coachConfig.deadlockCheck) rules.push("僵局检测");
    if (coachConfig.proactiveInterval) rules.push(`每${coachConfig.proactiveInterval}轮主动建议`);
    console.log(c(C.dim, `     介入规则: ${rules.join(" | ") || "无"}`));
  }
  console.log(c(C.dim, `     Simulator: ${simulatorConfig.forcePersonality ? `强制 ${simulatorConfig.forcePersonality}` : "跟随用户指定"} `));
  console.log("");

  // 初始化
  const ctx = new ContextManager(maxRounds);
  const coach = new CoachAgent();
  const simulator = new SimulatorAgent(effectivePersonality);

  // 初始化对话：将场景描述作为对话起点
  ctx.append("system", `用户场景: ${scenario}`);
  ctx.append("system", `对方性格: ${personality}`);

  console.log(c(C.green, "  ✅ Coach Agent 初始化成功（4种介入规则已就绪）"));
  console.log(c(C.green, `  ✅ Simulator Agent 初始化成功 (${personality})`));
  console.log("");

  // 第一轮：Simulator 先开场（模拟对方打招呼）
  const openingPrompt = `场景: ${scenario}\n对话刚开始，请你作为对方首先发言。`;
  const openingReply = await simulator.generateReply(ctx.getContext(), openingPrompt);
  ctx.append("simulator", openingReply);
  console.log(c(C.blue, `  🎭 对方: ${openingReply}`));
  console.log("");

  // Day 17: 教练检查是否需要介入（根据模式配置，首轮通常不需要）
  const initialCoach = await _runCoachCheck(coach, ctx, mode, 0, coachConfig);
  if (initialCoach.should) {
    console.log(c(C.yellow, `  🧠 教练提示 [${initialCoach.reason}]: ${initialCoach.suggestion}`));
    console.log("");
  }

  if (autopilot) {
    // ═══════════════════════════════════════════════════════════
    // 非交互自动模式（Day 16 新增：用于15轮测试）
    // ═══════════════════════════════════════════════════════════
    console.log(c(C.cyan, "  🤖 自动测试模式启动..."));
    console.log(c(C.dim, "  ──────────────────────────────────────────"));
    console.log("");

    for (let round = 1; round <= maxRounds; round++) {
      // 压缩检查（在第11轮及以后触发）
      if (ctx.needsCompression()) {
        await ctx.compress();
      }

      // 自动生成用户回复
      const autoReply = await generateAutoUserReply(scenario, ctx.getContext());
      ctx.append("user", autoReply);
      console.log(c(C.cyan, `  💬 [轮次 ${round}/${maxRounds}] 用户: ${autoReply}`));

      // Day 17: 教练介入（根据模式配置）
      const coachResult = await _runCoachCheck(coach, ctx, mode, round, coachConfig);
      if (coachResult.should) {
        console.log("");
        console.log(c(C.yellow, `  🧠 教练介入 [${coachResult.reason}]:`));
        console.log(c(C.yellow, `     ${coachResult.suggestion}`));
        if (coachResult.example) {
          console.log(c(C.dim, `     示例: ${coachResult.example}`));
        }
        console.log("");
      }

      // Simulator 生成回复
      const simReply = await simulator.generateReply(ctx.getContext(), autoReply);
      ctx.append("simulator", simReply);
      console.log(c(C.blue, `  🎭 对方: ${simReply}`));
      console.log("");

      // 短暂延迟以避免 API 限流
      if (round < maxRounds) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  } else {
    // ═══════════════════════════════════════════════════════════
    // 交互模式（原 Day 15 逻辑，增强压缩处理）
    // ═══════════════════════════════════════════════════════════
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

    let round = 1;
    while (round <= maxRounds) {
      // Day 16: 压缩检查
      if (ctx.needsCompression()) {
        await ctx.compress();
      }

      const prompt = c(C.cyan, `  💬 [轮次 ${round}/${maxRounds}] 你的回复> `);
      const userInput = await ask(prompt);

      if (!userInput.trim()) continue;

      // 特殊命令
      if (userInput.trim() === "/quit" || userInput.trim() === "/exit") {
        console.log(c(C.green, "\n  👋 沙盒对话结束"));
        break;
      }
      if (userInput.trim() === "/context") {
        const stats = ctx.getStats();
        console.log(c(C.dim, `\n  上下文: ${stats.totalEntries} 条记录, ${stats.userRounds} 轮, 压缩${stats.compressionCount}次`));
        continue;
      }
      if (userInput.trim() === "/reset") {
        ctx.reset();
        coach.reset();
        console.log(c(C.yellow, "  🔄 上下文已重置"));
        continue;
      }
      if (userInput.trim() === "/stats") {
        const coachStats = coach.getInterventionStats();
        console.log(c(C.dim, `\n  教练介入: ${coachStats.total} 次`));
        for (const [reason, count] of Object.entries(coachStats.breakdown)) {
          console.log(c(C.dim, `    - ${reason}: ${count} 次`));
        }
        continue;
      }

      // 追加用户消息
      ctx.append("user", userInput);

      // Day 17: 教练介入（根据模式配置）
      const coachResult = await _runCoachCheck(coach, ctx, mode, round, coachConfig);
      if (coachResult.should) {
        console.log("");
        console.log(c(C.yellow, `  🧠 教练介入 [${coachResult.reason}]:`));
        console.log(c(C.yellow, `     ${coachResult.suggestion}`));
        if (coachResult.example) {
          console.log(c(C.dim, `     示例: ${coachResult.example}`));
        }
        console.log("");
      }

      // Simulator 生成回复
      const simReply = await simulator.generateReply(ctx.getContext(), userInput);
      ctx.append("simulator", simReply);
      console.log(c(C.blue, `  🎭 对方: ${simReply}`));
      console.log("");

      round++;
    }

    rl.close();
  }

  // 对话结束总结
  console.log(c(C.dim, "\n──────────────────────────────────────────────────"));
  const stats = ctx.getStats();
  console.log(c(C.bold, `  📊 沙盒对话总结:`));
  console.log(c(C.dim, `     总轮次: ${stats.userRounds}`));
  console.log(c(C.dim, `     上下文条目: ${stats.totalEntries}`));
  console.log(c(C.dim, `     上下文压缩: ${stats.compressionCount} 次`));
  console.log(c(C.dim, `     教练介入: ${coach.interventionCount} 次`));
  const coachStats = coach.getInterventionStats();
  if (Object.keys(coachStats.breakdown).length > 0) {
    for (const [reason, count] of Object.entries(coachStats.breakdown)) {
      console.log(c(C.dim, `       - ${reason}: ${count} 次`));
    }
  }
  console.log("");

  return {
    context: ctx.getContext(),
    stats,
    coachInterventions: coach.interventionCount,
    coachStats,
    rounds: ctx.getRoundCount(),
  };
}

// ============================================================
// CLI 入口（Day 17 增强版）
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  // 解析参数
  let scenario = "";
  let mode = "free";       // Day 17: 默认 free 模式
  let personality = "friendly";
  let maxRounds = 10;
  let autopilot = false;

  const VALID_MODES = ["free", "guided", "stress"];
  const VALID_PERSONALITIES = ["friendly", "hostile", "avoidant"];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rounds" || args[i] === "-r") {
      maxRounds = parseInt(args[++i]) || 10;
    } else if (args[i] === "--autopilot" || args[i] === "--auto" || args[i] === "-a") {
      autopilot = true;
    } else if (args[i] === "--mode" || args[i] === "-m") {
      // 显式指定模式: --mode guided
      const m = args[++i];
      if (VALID_MODES.includes(m)) {
        mode = m;
      }
    } else if (VALID_MODES.includes(args[i])) {
      // Day 17: 第二个位置参数可能是 mode（如 free/guided/stress）
      mode = args[i];
    } else if (VALID_PERSONALITIES.includes(args[i])) {
      personality = args[i];
    } else {
      if (!scenario) scenario = args[i];
    }
  }

  if (!scenario) {
    // 无参数：显示帮助
    console.log(c(C.bold, "\n📋 ExpressCoach 沙盒 — 双Agent对话系统 (Day 17)"));
    console.log(c(C.dim, "\n用法:"));
    console.log(c(C.dim, '  node src/sandbox/sandbox.js "场景描述" <模式> <性格> [--rounds N] [--autopilot]'));
    console.log(c(C.dim, "\n练习模式 (Day 17 新增):"));
    console.log(c(C.green, "  free      — 自由模式（教练完全静默，自由练习）"));
    console.log(c(C.yellow, "  guided    — 引导模式（教练每2轮主动给建议，边练边学）"));
    console.log(c(C.red, "  stress    — 压力模式（强制刁难对方，教练仅求助时介入）"));
    console.log(c(C.dim, "\n对方性格:"));
    console.log(c(C.dim, "  friendly  — 友善型（理解配合）"));
    console.log(c(C.dim, "  hostile   — 刁难型（质疑施压）【stress模式强制使用】"));
    console.log(c(C.dim, "  avoidant  — 回避型（转移拖延）"));
    console.log(c(C.dim, "\n选项:"));
    console.log(c(C.dim, "  --rounds N   最大轮次数（默认10）"));
    console.log(c(C.dim, "  --autopilot  自动测试模式（非交互，自动生成用户回复）"));
    console.log(c(C.dim, "  --mode MODE  显式指定练习模式"));
    console.log(c(C.dim, "\n示例:"));
    console.log(c(C.green, '  node src/sandbox/sandbox.js "催同事交报告" free --rounds 5 --autopilot'));
    console.log(c(C.yellow, '  node src/sandbox/sandbox.js "催同事交报告" guided --rounds 5 --autopilot'));
    console.log(c(C.red, '  node src/sandbox/sandbox.js "催同事交报告" stress --rounds 5 --autopilot'));
    console.log(c(C.dim, '  node src/sandbox/sandbox.js "我想拒绝朋友借钱" guided friendly'));
    console.log(c(C.dim, "\nDay 17 完成标志:"));
    console.log(c(C.dim, "  ☐ 三种模式Simulator回复风格有明显差异"));
    console.log(c(C.dim, "  ☐ guided模式coach每2轮出现一次"));
    console.log(c(C.dim, "  ☐ stress模式simulator使用hostile性格"));
    console.log("");
    process.exit(0);
  }

  // 检查 API Key
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error(c(C.red, "❌ DEEPSEEK_API_KEY 未配置，请检查 .env 文件"));
    process.exit(1);
  }

  try {
    // Day 17: startSandbox(scenario, mode, personality, opts)
    await startSandbox(scenario, mode, personality, { rounds: maxRounds, autopilot });
  } catch (error) {
    console.error(c(C.red, `❌ 沙盒运行异常: ${error.message}`));
    console.error(error.stack);
    process.exit(1);
  }
}

// ============================================================
// 导出
// ============================================================
module.exports = { startSandbox, CoachAgent, SimulatorAgent, ContextManager };

// 直接运行
if (require.main === module) {
  main();
}
