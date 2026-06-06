#!/usr/bin/env node
/**
 * ExpressCoach AI — MVP 原型
 * 完整链路: 意图识别 → 三版本并行生成 → 格式化输出
 *
 * 用法: node src/index.js "你的社交场景描述"
 * 示例: node src/index.js "我想拒绝朋友借钱但不想伤感情"
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

// ============================================================
// 配置
// ============================================================
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const SOUL_DIR = path.resolve(__dirname, "..", "soul");
const INTENT_SOUL = path.resolve(__dirname, "..", "SOUL.md");
const MODEL = process.env.MODEL || "deepseek";

// 三版本生成器 SOUL.md 路径
const GENERATOR_SOULS = {
  mild: path.join(SOUL_DIR, "generator-mild.md"),
  firm: path.join(SOUL_DIR, "generator-firm.md"),
  eq: path.join(SOUL_DIR, "generator-eq.md"),
};

// 版本中文名和图标
const VERSION_META = {
  mild: { name: "温和版", icon: "🕊️", tag: "关系维护优先" },
  firm: { name: "坚定版", icon: "🛡️", tag: "立场明确优先" },
  eq: { name: "高情商版", icon: "🎯", tag: "双赢导向" },
};

// ============================================================
// 工具函数
// ============================================================

function loadFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ ${label} 未找到: ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, "utf-8");
}

function parseResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1].trim()); } catch (e2) {}
    }
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try { return JSON.parse(braceMatch[0]); } catch (e3) {}
    }
    return null;
  }
}

// ============================================================
// API 调用
// ============================================================

async function callDeepSeek(systemPrompt, userInput, opts = {}) {
  const { temperature = 0.1, maxTokens = 500 } = opts;
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek API 错误 (${response.status}): ${err}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0].message.content,
    tokens: data.usage?.total_tokens || 0,
  };
}

// ============================================================
// 步骤1: 意图识别
// ============================================================

async function recognizeIntent(scenario) {
  const soulContent = loadFile(INTENT_SOUL, "SOUL.md (意图识别)");
  const { content } = await callDeepSeek(soulContent, scenario, {
    temperature: 0.1,
    maxTokens: 300,
  });
  const result = parseResponse(content);
  return { raw: content, parsed: result };
}

// ============================================================
// 步骤2: 三版本并行生成
// ============================================================

async function generateVersion(scenario, styleKey) {
  const soulPath = GENERATOR_SOULS[styleKey];
  const soulContent = loadFile(soulPath, `SOUL.md (${VERSION_META[styleKey].name})`);
  const meta = VERSION_META[styleKey];

  const prompt = `请为以下社交场景生成${meta.name}的回复:\n\n"${scenario}"\n\n请严格按照 SOUL.md 中定义的 JSON 格式输出，不要输出其他内容。`;

  const { content, tokens } = await callDeepSeek(soulContent, prompt, {
    temperature: 0.8, // 较高温度以获得差异化输出
    maxTokens: 500,
  });

  const parsed = parseResponse(content);
  return { styleKey, meta, content, parsed, tokens };
}

async function generateThreeVersions(scenario) {
  console.log("📝 正在并行生成三个版本...");
  console.log(`   ├─ ${VERSION_META.mild.icon} 温和版生成中...`);
  console.log(`   ├─ ${VERSION_META.firm.icon} 坚定版生成中...`);
  console.log(`   └─ ${VERSION_META.eq.icon} 高情商版生成中...`);

  const startTime = Date.now();

  // ★ 核心: 三个 Agent 并行调用 (Promise.all)
  const results = await Promise.all([
    generateVersion(scenario, "mild"),
    generateVersion(scenario, "firm"),
    generateVersion(scenario, "eq"),
  ]);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalTokens = results.reduce((sum, r) => sum + r.tokens, 0);

  console.log(`   ⏱️  并行生成完成 (${elapsed}s · ${totalTokens} tokens)`);
  console.log("");

  return results;
}

// ============================================================
// 格式化输出
// ============================================================

function printDivider(char = "─", length = 64) {
  console.log(char.repeat(length));
}

function printIntentResult(result) {
  console.log("");
  printDivider();
  console.log("📊 步骤1: 意图识别结果");
  printDivider();

  if (result.parsed) {
    const r = result.parsed;
    console.log(`  意图   : ${r["意图"] || "未知"}`);
    console.log(`  置信度 : ${((r["置信度"] || 0) * 100).toFixed(1)}%`);
    if (r["分析"]) console.log(`  分析   : ${r["分析"]}`);
    if (r["关键词匹配"]?.length) console.log(`  关键词 : ${r["关键词匹配"].join(", ")}`);
  } else {
    console.log("  ⚠️ 解析失败，原始响应:");
    console.log(`  ${result.raw}`);
  }
}

function printVersionCard(version, index) {
  const { meta, parsed, tokens } = version;

  console.log(`┌${"─".repeat(60)}┐`);
  console.log(`│ ${meta.icon} ${meta.name} — ${meta.tag}${" ".repeat(40 - meta.name.length - meta.tag.length)}│`);
  console.log(`├${"─".repeat(60)}┤`);

  if (parsed && parsed.content) {
    // 按宽度折行
    const content = parsed.content;
    const maxWidth = 56;
    let line = "│ ";
    for (const char of content) {
      if (char === "\n") {
        console.log(line + " ".repeat(maxWidth - [...line].length + 2) + " │");
        line = "│ ";
      } else if ([...line].length >= maxWidth) {
        console.log(line + " │");
        line = "│ " + char;
      } else {
        line += char;
      }
    }
    if (line.length > 2) {
      console.log(line + " ".repeat(Math.max(0, maxWidth - [...line].length)) + " │");
    }
  } else {
    console.log("│ (生成失败)                                               │");
  }

  if (parsed && parsed.strategy) {
    console.log(`├${"─".repeat(60)}┤`);
    console.log(`│ 💡 策略: ${parsed.strategy.substring(0, 52)}${" ".repeat(Math.max(0, 52 - parsed.strategy.length))} │`);
  }

  console.log(`└${"─".repeat(60)}┘`);
  console.log(`   ⏱️  tokens: ${tokens}`);
  console.log("");
}

function printComparisonTable(versions) {
  console.log("");
  printDivider("=");
  console.log("📊 步骤2: 三版本对比 — 并排输出");
  printDivider("=");
  console.log("");

  versions.forEach((v, i) => {
    printVersionCard(v, i);
  });

  // 总结表
  console.log("");
  printDivider("=");
  console.log("📋 三版本快速对比");
  printDivider("=");
  console.log("");

  const tableData = versions.map((v) => {
    const p = v.parsed || {};
    return {
      icon: v.meta.icon,
      name: v.meta.name,
      tag: v.meta.tag,
      content: (p.content || "(生成失败)").substring(0, 30) + "...",
      tokens: v.tokens,
    };
  });

  for (const row of tableData) {
    console.log(`  ${row.icon} ${row.name} (${row.tag})`);
    console.log(`     ${row.content}`);
    console.log(`     tokens: ${row.tokens}`);
    console.log("");
  }
}

// ============================================================
// 单次分析流程
// ============================================================

async function runAnalysis(scenario) {
  console.log("");
  console.log(`💬 输入场景: "${scenario}"`);
  console.log("");

  // ═══ 步骤1: 意图识别 ═══
  console.log("🔍 [步骤1/2] 正在分析意图...");
  const intentResult = await recognizeIntent(scenario);
  printIntentResult(intentResult);

  // ═══ 步骤2: 三版本并行生成 ═══
  console.log("");
  console.log("⚡ [步骤2/2] 正在生成三版本回复（并行调用 3 个 Agent）...");
  const versions = await generateThreeVersions(scenario);
  printComparisonTable(versions);

  // ═══ 完成 ═══
  console.log("");
  printDivider("=");
  console.log("✅ 完整链路演示完毕！");
  console.log("  🔗 链路: 用户输入 → 意图识别 → 三版本并行生成 → 格式化输出");
  printDivider("=");
  console.log("");
}

// ============================================================
// 交互模式
// ============================================================

async function interactiveMode() {
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log("");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║     🎯 ExpressCoach AI — 社交表达教练 (MVP)         ║");
  console.log("║     完整链路: 意图识别 → 三版本并行生成 → 对比输出    ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");
  console.log("  📝 在下方输入你的社交场景，AI 会帮你分析意图并生成三版本回复");
  console.log("  输入 /help 查看示例  |  输入 /quit 退出");
  console.log("");

  let turn = 0;

  while (true) {
    turn++;
    const input = await ask("💬 场景> ");

    if (!input.trim()) continue;

    if (input.trim() === "/quit" || input.trim() === "/q" || input.trim() === "exit") {
      console.log("");
      console.log(`  👋 本次共分析了 ${turn - 1} 个场景，再见！`);
      console.log("");
      rl.close();
      break;
    }

    if (input.trim() === "/help") {
      console.log("");
      console.log("  📋 示例场景 (复制粘贴即可测试):");
      console.log('    · 我想拒绝朋友借钱但不想伤感情');
      console.log('    · 我想向老板请假但不知道怎么开口');
      console.log('    · 朋友误会我了我想解释清楚');
      console.log('    · 同事总让我帮忙做他的工作');
      console.log('    · 我想给父母提建议但他们总不听');
      console.log('    · 朋友总是迟到我想提醒他');
      console.log("");
      continue;
    }

    try {
      await runAnalysis(input);
    } catch (error) {
      console.error(`❌ 错误: ${error.message}`);
      console.log("  请重试或输入 /quit 退出");
      console.log("");
    }
  }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  // 检查 API Key
  if (!DEEPSEEK_API_KEY) {
    console.error("❌ DEEPSEEK_API_KEY 未配置，请检查 .env 文件");
    process.exit(1);
  }

  const scenario = process.argv.slice(2).join(" ");

  if (scenario.trim()) {
    // 命令行参数模式: 单次运行
    console.log("");
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║     🎯 ExpressCoach AI — MVP 完整链路演示            ║");
    console.log("╚══════════════════════════════════════════════════════╝");
    try {
      await runAnalysis(scenario);
    } catch (error) {
      console.error("❌ 错误:", error.message);
      process.exit(1);
    }
  } else {
    // 无参数: 进入交互模式
    await interactiveMode();
  }
}

main();
