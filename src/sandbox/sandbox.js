#!/usr/bin/env node
/**
 * Sandbox 沙盒主控 — 双Agent对话沙盒 (Day 16 增强)
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
 * 功能:
 *   - 共享上下文数组 sharedContext: 每轮追加 {role, content, timestamp}
 *   - 10轮硬上限，超过自动触发LLM压缩前5轮为100字摘要，保留后5轮原文
 *   - 支持三种模拟对方性格: friendly / hostile / avoidant
 *   - Coach 旁听并在4种关键时刻介入
 *
 * 用法:
 *   node src/sandbox/sandbox.js "场景描述" friendly
 *   node src/sandbox/sandbox.js "场景描述" hostile --rounds 15 --autopilot
 *   node src/sandbox/sandbox.js "催同事交报告" friendly --rounds 15
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
// startSandbox — 沙盒启动函数（Day 16 增强版）
// ============================================================

/**
 * @param {String} scenario - 用户场景描述（如"我想拒绝朋友借钱"）
 * @param {String} personality - 模拟对方性格: "friendly" | "hostile" | "avoidant"
 * @param {Object} opts - 可选参数 {rounds: 最大轮次数, autopilot: 自动模式}
 */
async function startSandbox(scenario, personality = "friendly", opts = {}) {
  const maxRounds = opts.rounds || 10;
  const autopilot = opts.autopilot !== false && opts.autopilot !== undefined ? opts.autopilot : false;

  console.log("");
  console.log(c(C.bold, "╔══════════════════════════════════════════════════════╗"));
  console.log(c(C.bold, "║        🎭 ExpressCoach 双Agent对话沙盒 (Day 16)       ║"));
  console.log(c(C.bold, "║        Coach (智能介入) + Simulator (模拟对方)         ║"));
  console.log(c(C.bold, "╚══════════════════════════════════════════════════════╝"));
  console.log("");
  console.log(c(C.dim, `  场景: ${scenario}`));
  console.log(c(C.dim, `  对方性格: ${personality}`));
  console.log(c(C.dim, `  最大轮次: ${maxRounds}`));
  console.log(c(C.dim, `  模式: ${autopilot ? "自动测试 🤖" : "交互模式 👤"}`));
  console.log("");

  // 初始化
  const ctx = new ContextManager(maxRounds);
  const coach = new CoachAgent();
  const simulator = new SimulatorAgent(personality);

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

  // 教练检查是否需要介入（首轮通常不需要）
  const initialCoach = await coach.shouldIntervene(ctx.getContext());
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

      // 教练检查是否需要介入
      const coachResult = await coach.shouldIntervene(ctx.getContext());
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

      // 教练检查是否需要介入
      const coachResult = await coach.shouldIntervene(ctx.getContext());
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
// CLI 入口（Day 16 增强版）
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  // 解析参数
  let scenario = "";
  let personality = "friendly";
  let maxRounds = 10;
  let autopilot = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rounds" || args[i] === "-r") {
      maxRounds = parseInt(args[++i]) || 10;
    } else if (args[i] === "--autopilot" || args[i] === "--auto" || args[i] === "-a") {
      autopilot = true;
    } else if (["friendly", "hostile", "avoidant"].includes(args[i])) {
      personality = args[i];
    } else {
      if (!scenario) scenario = args[i];
    }
  }

  if (!scenario) {
    // 无参数：显示帮助
    console.log(c(C.bold, "\n📋 ExpressCoach 沙盒 — 双Agent对话系统 (Day 16)"));
    console.log(c(C.dim, "\n用法:"));
    console.log(c(C.dim, "  node src/sandbox/sandbox.js \"场景描述\" <性格> [--rounds N] [--autopilot]"));
    console.log(c(C.dim, "\n性格选项:"));
    console.log(c(C.dim, "  friendly  — 友善型（理解配合）"));
    console.log(c(C.dim, "  hostile   — 刁难型（质疑施压）"));
    console.log(c(C.dim, "  avoidant  — 回避型（转移拖延）"));
    console.log(c(C.dim, "\n选项:"));
    console.log(c(C.dim, "  --rounds N   最大轮次数（默认10，测试用15）"));
    console.log(c(C.dim, "  --autopilot  自动测试模式（非交互，自动生成用户回复）"));
    console.log(c(C.dim, "\n示例:"));
    console.log(c(C.dim, '  node src/sandbox/sandbox.js "我想拒绝朋友借钱" friendly'));
    console.log(c(C.dim, '  node src/sandbox/sandbox.js "我想催同事交报告" hostile'));
    console.log(c(C.dim, '  node src/sandbox/sandbox.js "催同事交报告" friendly --rounds 15 --autopilot'));
    console.log(c(C.dim, "\nDay 16 完成标志:"));
    console.log(c(C.dim, "  ☐ 教练在4种情况下正确介入/静默"));
    console.log(c(C.dim, "  ☐ 上下文15轮不崩溃"));
    console.log(c(C.dim, "  ☐ 第11轮触发压缩，日志显示\"上下文已压缩\""));
    console.log("");
    process.exit(0);
  }

  // 检查 API Key
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error(c(C.red, "❌ DEEPSEEK_API_KEY 未配置，请检查 .env 文件"));
    process.exit(1);
  }

  try {
    await startSandbox(scenario, personality, { rounds: maxRounds, autopilot });
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
