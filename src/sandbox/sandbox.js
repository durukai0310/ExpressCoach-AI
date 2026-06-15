#!/usr/bin/env node
/**
 * Sandbox 沙盒主控 — 双Agent对话沙盒 (Day 15)
 *
 * 架构:
 *   Coach Agent (教练)  ←→  共享上下文  ←→  Simulator Agent (模拟对方)
 *                              ↕
 *                           用户输入
 *
 * 功能:
 *   - 共享上下文数组 sharedContext: 每轮追加 {role, content, timestamp}
 *   - 10轮硬上限，超过自动压缩前5轮为摘要
 *   - 支持三种模拟对方性格: friendly / hostile / avoidant
 *   - Coach 旁听并在关键时刻介入
 *
 * 用法:
 *   node src/sandbox/sandbox.js "场景描述" friendly
 *   node src/sandbox/sandbox.js "场景描述" hostile [--rounds 10]
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
// ContextManager — 共享上下文窗口管理
// ============================================================

class ContextManager {
  constructor(maxRounds = 10) {
    this.maxRounds = maxRounds;
    this.context = []; // [{role, content, timestamp}]
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

    // 检查是否超过硬上限
    const userMessages = this.context.filter((e) => e.role === "user");
    if (userMessages.length > this.maxRounds) {
      this._compress();
    }
  }

  /**
   * _compress: 压缩前5轮为摘要，保留后5轮原文
   * 压缩不是截断——是保留信息但释放空间
   */
  async _compress() {
    console.log(c(C.yellow, "\n  ⚡ 上下文已超过10轮上限，触发压缩..."));
    const oldMessages = this.context.splice(0, Math.floor(this.context.length / 2));

    const oldSummary = oldMessages
      .map((e) => `[${e.role === "user" ? "用户" : "对方"}] ${e.content}`)
      .join(" | ");

    const summaryEntry = {
      role: "system",
      content: `[对话摘要] ${oldSummary.substring(0, 150)}...`,
      timestamp: new Date().toISOString(),
    };

    this.context.unshift(summaryEntry);
    console.log(c(C.green, `  ✅ 上下文已压缩（保留 ${this.context.length} 条记录）`));
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
   * reset: 重置上下文
   */
  reset() {
    this.context = [];
  }
}

// ============================================================
// startSandbox — 沙盒启动函数
// ============================================================

/**
 * @param {String} scenario - 用户场景描述（如"我想拒绝朋友借钱"）
 * @param {String} personality - 模拟对方性格: "friendly" | "hostile" | "avoidant"
 * @param {Object} opts - 可选参数 {rounds: 最大轮次数, interactive: 是否交互模式}
 */
async function startSandbox(scenario, personality = "friendly", opts = {}) {
  const maxRounds = opts.rounds || 10;
  const interactive = opts.interactive !== false;

  console.log("");
  console.log(c(C.bold, "╔══════════════════════════════════════════════════════╗"));
  console.log(c(C.bold, "║        🎭 ExpressCoach 双Agent对话沙盒                ║"));
  console.log(c(C.bold, "║        Coach (教练) + Simulator (模拟对方)            ║"));
  console.log(c(C.bold, "╚══════════════════════════════════════════════════════╝"));
  console.log("");
  console.log(c(C.dim, `  场景: ${scenario}`));
  console.log(c(C.dim, `  对方性格: ${personality}`));
  console.log(c(C.dim, `  最大轮次: ${maxRounds}`));
  console.log("");

  // 初始化
  const ctx = new ContextManager(maxRounds);
  const coach = new CoachAgent();
  const simulator = new SimulatorAgent(personality);

  // 初始化对话：将场景描述作为对话起点
  ctx.append("system", `用户场景: ${scenario}`);
  ctx.append("system", `对方性格: ${personality}`);

  console.log(c(C.green, "  ✅ Coach Agent 初始化成功"));
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
    console.log(c(C.yellow, `  🧠 教练提示: ${initialCoach.suggestion}`));
    console.log("");
  }

  // 交互循环
  if (interactive) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

    let round = 1;
    while (round <= maxRounds) {
      const prompt = c(C.cyan, `  💬 [轮次 ${round}/${maxRounds}] 你的回复> `);
      const userInput = await ask(prompt);

      if (!userInput.trim()) continue;

      // 特殊命令
      if (userInput.trim() === "/quit" || userInput.trim() === "/exit") {
        console.log(c(C.green, "\n  👋 沙盒对话结束"));
        break;
      }
      if (userInput.trim() === "/context") {
        console.log(c(C.dim, `\n  当前上下文: ${ctx.getContext().length} 条记录, ${ctx.getRoundCount()} 轮`));
        continue;
      }
      if (userInput.trim() === "/reset") {
        ctx.reset();
        coach.reset();
        console.log(c(C.yellow, "  🔄 上下文已重置"));
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
        console.log("");
      }

      // Simulator 生成回复
      const simReply = await simulator.generateReply(ctx.getContext(), userInput);
      ctx.append("simulator", simReply);
      console.log(c(C.blue, `  🎭 对方: ${simReply}`));
      console.log("");

      round++;
    }

    // 对话结束总结
    console.log(c(C.dim, "\n──────────────────────────────────────────────────"));
    const totalRounds = ctx.getRoundCount();
    console.log(c(C.bold, `  📊 沙盒对话总结: 共 ${totalRounds} 轮`));
    console.log(c(C.dim, `  教练介入: ${coach.interventionCount} 次`));
    console.log(c(C.dim, `  上下文: ${ctx.getContext().length} 条记录`));
    console.log("");

    rl.close();
  } else {
    // 非交互模式：只输出初始状态
    console.log(c(C.dim, "  (非交互模式，沙盒已就绪)"));
  }

  return {
    context: ctx.getContext(),
    coachInterventions: coach.interventionCount,
    rounds: ctx.getRoundCount(),
  };
}

// ============================================================
// CLI 入口
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  // 解析参数
  let scenario = "";
  let personality = "friendly";
  let maxRounds = 10;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rounds" || args[i] === "-r") {
      maxRounds = parseInt(args[++i]) || 10;
    } else if (["friendly", "hostile", "avoidant"].includes(args[i])) {
      personality = args[i];
    } else {
      if (!scenario) scenario = args[i];
    }
  }

  if (!scenario) {
    // 无参数：显示帮助
    console.log(c(C.bold, "\n📋 ExpressCoach 沙盒 — 双Agent对话系统"));
    console.log(c(C.dim, "\n用法:"));
    console.log(c(C.dim, "  node src/sandbox/sandbox.js \"场景描述\" <性格> [--rounds N]"));
    console.log(c(C.dim, "\n性格选项:"));
    console.log(c(C.dim, "  friendly  — 友善型（理解配合）"));
    console.log(c(C.dim, "  hostile   — 刁难型（质疑施压）"));
    console.log(c(C.dim, "  avoidant  — 回避型（转移拖延）"));
    console.log(c(C.dim, "\n示例:"));
    console.log(c(C.dim, '  node src/sandbox/sandbox.js "我想拒绝朋友借钱" friendly'));
    console.log(c(C.dim, '  node src/sandbox/sandbox.js "我想催同事交报告" hostile'));
    console.log(c(C.dim, "  node src/sandbox/sandbox.js \"向老板提意见\" hostile --rounds 15"));
    console.log("");
    process.exit(0);
  }

  // 检查 API Key
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error(c(C.red, "❌ DEEPSEEK_API_KEY 未配置，请检查 .env 文件"));
    process.exit(1);
  }

  try {
    await startSandbox(scenario, personality, { rounds: maxRounds });
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
