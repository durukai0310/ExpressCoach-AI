#!/usr/bin/env node
/**
 * ExpressCoach AI — MVP 原型 (Day 11 完善版)
 * 完整链路: 意图识别(LLM+规则兜底) → 关系判断(规则+LLM混合) → 三版本并行生成(带 Jaccard 差异度检查) → M5预测(预留) → 格式化输出
 *
 * 用法: node src/index.js "你的社交场景描述"
 * 示例: node src/index.js "我想拒绝朋友借钱但不想伤感情"
 *
 * W2 Day 11 更新:
 *  - ✅ 代码Review: recognizeIntent 断网降级到 fallbackRecognize (P0修复)
 *  - ✅ 代码Review: Promise.allSettled 替代 Promise.all (P1修复)
 *  - ✅ 性能打点: 每步 performance.now() 计时 + 性能报告
 *  - ✅ M5 预留接口: predictReactions 动态 require + try/catch
 *  - ✅ 竞品对比基线: notes/w2-competitive-baseline.md
 *  - ✅ 弱点分析: notes/w2-weakness-analysis.md
 *
 * W2 Day 10 更新:
 *  - ✅ M4 三版本模块化 (src/generate/three-versions.js)
 *  - ✅ SOUL.md 精调 (3份生成器各增加催报告/设边界 Few-shot 示例)
 *  - ✅ Jaccard 文本相似度检查 (阈值 0.7, 最多重试 3 次)
 *  - ✅ 差异度自动重试机制 (temperature +0.2 per retry)
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

// Day 8: 意图识别模块化 — 从 src/intent/recognize.js 引入
const { recognizeIntent } = require("./intent/recognize");

// Day 10: 关系判断模块化 — 从 src/relationship/analyze.js 引入 (规则+LLM混合)
const { hybridAnalyze } = require("./relationship/analyze");

// Day 10: 三版本模块化 — 从 src/generate/three-versions.js 引入 (含 Jaccard 差异度检查)
const { generateVersion, generateThreeVersions, VERSION_META, GENERATOR_SOULS } = require("./generate/three-versions");

// Day 11: M5 反应预测模块预留接口 (成员B尚未实现)
// 当 B 完成 predict/reactions.js 后，取消注释 require 即可接入
let predictReactions = null;
try {
  predictReactions = require("./predict/reactions");
  console.log("  🔮 M5 反应预测模块已加载");
} catch (e) {
  // M5 模块尚未实现 — 这是预期行为
  if (e.code !== "MODULE_NOT_FOUND") {
    console.error(`  ⚠️ M5 模块加载异常: ${e.message}`);
  }
}

// Day 12: SQLite DAO 层 — 数据持久化
let dbDao = null;
try {
  dbDao = require("./db/dao");
  // 初始化数据库 (如果尚未初始化)
  dbDao.initDB().then(() => {
    console.log("  🗄️  SQLite 数据库已就绪");
  }).catch((e) => {
    console.error(`  ⚠️ SQLite 初始化失败: ${e.message}`);
    dbDao = null;
  });
} catch (e) {
  console.error(`  ⚠️ SQLite DAO 加载失败: ${e.message}`);
}

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
  white: "\x1b[37m",
};

function color(color, text) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return color + text + C.reset;
}

// ============================================================
// 配置
// ============================================================
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const SOUL_DIR = path.resolve(__dirname, "..", "soul");
const INTENT_SOUL = path.resolve(__dirname, "..", "SOUL.md");
const RELATION_SOUL = path.join(SOUL_DIR, "relationship-judge.md");
const MODEL = process.env.MODEL || "deepseek";

// ============================================================
// 工具函数
// ============================================================

function loadFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(color(C.red, `❌ ${label} 未找到: ${filePath}`));
    return null;
  }
  return fs.readFileSync(filePath, "utf-8");
}

function parseResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 尝试从 markdown 代码块提取
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1].trim()); } catch (e2) {}
    }
    // 尝试找最外层花括号
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try { return JSON.parse(braceMatch[0]); } catch (e3) {}
    }
    return null;
  }
}

function spinner(message) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]} ${message}`);
  }, 80);
  return {
    stop: (finalMessage) => {
      clearInterval(id);
      process.stdout.write(`\r  ${finalMessage}\n`);
    },
  };
}

// ============================================================
// 步骤2: 关系判断 (Day 10 增强: 规则+LLM混合)
// 已移至 src/relationship/analyze.js → 使用 hybridAnalyze()

// 步骤3: 三版本并行生成 (Day 10: 模块化 + Jaccard 差异度检查)
// 已移至 src/generate/three-versions.js → 使用 generateThreeVersions()

// ============================================================
// 格式化输出
// ============================================================

function printDivider(char = "─", length = 64) {
  console.log(color(C.dim, char.repeat(length)));
}

function printIntentResult(result) {
  console.log("");
  printDivider();
  console.log(color(C.bold, "📊 步骤1: 意图识别结果"));
  printDivider();

  if (result.parsed) {
    const r = result.parsed;
    console.log(`  意图     : ${color(C.cyan, r["意图"] || "未知")}`);
    console.log(`  置信度   : ${color(C.green, ((r["置信度"] || 0) * 100).toFixed(1) + "%")}`);
    if (r["分析"]) console.log(`  分析     : ${r["分析"]}`);
    if (r["关键词匹配"]?.length) console.log(`  关键词   : ${r["关键词匹配"].join(", ")}`);
  } else {
    console.log(color(C.yellow, "  ⚠️ 解析失败，原始响应:"));
    console.log(color(C.dim, `  ${result.raw.substring(0, 200)}`));
  }
}

function printRelationshipResult(result) {
  console.log("");
  printDivider();
  console.log(color(C.bold, "👥 步骤2: 关系判断结果 (规则0.3 + LLM0.7 混合)"));
  printDivider();

  if (result.parsed) {
    const r = result.parsed;
    console.log(`  关系类型   : ${color(C.magenta, r["关系类型"] || "未知")}`);
    console.log(`  亲密度     : ${color(C.magenta, r["亲密度"] || "一般")}`);
    console.log(`  权力关系   : ${color(C.magenta, r["权力关系"] || "不明")}`);
    console.log(`  利益关联   : ${color(C.magenta, r["利益关联"] || "纯情感")}`);
    console.log(`  表达敏感度 : ${color(C.yellow, r["表达敏感度"] || "中敏感")}`);
    if (r["建议策略"]) console.log(`  💡 策略    : ${r["建议策略"]}`);
    if (r["注意事项"]) console.log(`  ⚠️  注意    : ${r["注意事项"]}`);

    // Day 10: 显示混合模式详情
    if (result.source) {
      console.log(color(C.dim, `  🔀 数据源  : ${result.source}`));
    }
    if (result.ruleResult && result.ruleResult.matched) {
      console.log(color(C.dim, `  📖 规则匹配: ${result.ruleResult.type} | 命中词: ${(result.ruleResult.matchedKeywords || []).join(", ")}`));
    }
    if (result.weights) {
      console.log(color(C.dim, `  ⚖️  权重    : 规则${result.weights.rule} / LLM${result.weights.llm}`));
    }
    if (result.tokens) {
      console.log(color(C.dim, `  🎫 tokens  : ${result.tokens}`));
    }
  } else {
    console.log(color(C.yellow, "  ⚠️ 解析失败，将使用默认关系参数继续"));
    console.log(color(C.dim, `  ${(result.raw || "").substring(0, 200)}`));
  }
}

function printVersionCard(version, index) {
  const { meta, parsed, tokens } = version;

  console.log(`┌${"─".repeat(60)}┐`);
  console.log(`│ ${meta.icon} ${meta.name} — ${meta.tag}${" ".repeat(Math.max(0, 38 - meta.name.length - meta.tag.length))}│`);
  console.log(`├${"─".repeat(60)}┤`);

  if (parsed && parsed.content) {
    const content = parsed.content;
    const maxWidth = 56;
    let line = "│ ";
    for (const char of content) {
      if (char === "\n") {
        const padding = Math.max(0, maxWidth - [...line].length);
        console.log(line + " ".repeat(padding) + " │");
        line = "│ ";
      } else if ([...line].length >= maxWidth) {
        console.log(line + " │");
        line = "│ " + char;
      } else {
        line += char;
      }
    }
    if (line.length > 2) {
      const padding = Math.max(0, maxWidth - [...line].length);
      console.log(line + " ".repeat(padding) + " │");
    }
  } else {
    console.log("│ " + color(C.yellow, "(生成失败)") + " ".repeat(43) + " │");
  }

  if (parsed && parsed.strategy) {
    console.log(`├${"─".repeat(60)}┤`);
    const stratLine = `│ 💡 策略: ${parsed.strategy}`.slice(0, 59);
    console.log(stratLine + " ".repeat(Math.max(0, 61 - [...stratLine].length)) + "│");
  }

  console.log(`└${"─".repeat(60)}┘`);
  console.log(color(C.dim, `   ⏱️  tokens: ${tokens}`));
  console.log("");
}

function printComparisonTable(versions) {
  console.log("");
  printDivider("=");
  console.log(color(C.bold, "📊 步骤3: 三版本对比 — 并排输出（已融合关系判断结果）"));
  printDivider("=");
  console.log("");

  versions.forEach((v, i) => {
    printVersionCard(v, i);
  });

  // 总结表
  console.log("");
  printDivider("=");
  console.log(color(C.bold, "📋 三版本快速对比"));
  printDivider("=");
  console.log("");

  for (const v of versions) {
    const p = v.parsed || {};
    const preview = (p.content || "(生成失败)").length > 35
      ? (p.content || "").substring(0, 35) + "..."
      : (p.content || "(生成失败)");
    console.log(`  ${v.meta.icon} ${v.meta.name} (${v.meta.tag})`);
    console.log(`     ${preview}`);
    console.log(color(C.dim, `     tokens: ${v.tokens}`));
    console.log("");
  }
}

// ============================================================
// 完整分析流程 (Day 7: 三步 Pipeline)
// ============================================================

async function runAnalysis(scenario) {
  // Day 11: 全流程性能打点
  const perfStart = performance.now();
  const perf = {};

  console.log("");
  console.log(color(C.bold, `💬 输入场景: "${scenario}"`));
  console.log("");

  // ═══ 步骤1: 意图识别 ═══
  const intentSpinner = spinner("🔍 [步骤1/3] 正在分析用户意图...");
  const t1 = performance.now();
  let intentResult;
  try {
    intentResult = await recognizeIntent(scenario);
    perf.intent = (performance.now() - t1) / 1000;
    const tag = perf.intent < 1 ? "✅" : "⚠️";
    intentSpinner.stop(color(C.green, `${tag} [步骤1/3] 意图识别完成 (${perf.intent.toFixed(1)}s)`));
  } catch (error) {
    perf.intent = (performance.now() - t1) / 1000;
    intentSpinner.stop(color(C.red, `❌ [步骤1/3] 意图识别失败 (${perf.intent.toFixed(1)}s)`));
    throw new Error(`意图识别失败: ${error.message}`);
  }
  printIntentResult(intentResult);

  // ═══ 步骤2: 关系判断 (Day 10: 规则+LLM混合) ═══
  const relationSpinner = spinner("👥 [步骤2/3] 正在混合判断关系类型 (规则0.3+LLM0.7)...");
  const t2 = performance.now();
  let relationResult;
  try {
    relationResult = await hybridAnalyze(scenario);
    perf.relation = (performance.now() - t2) / 1000;
    const tag = perf.relation < 1 ? "✅" : "⚠️";
    relationSpinner.stop(color(C.green, `${tag} [步骤2/3] 关系判断完成 (混合模式, ${perf.relation.toFixed(1)}s)`));
  } catch (error) {
    perf.relation = (performance.now() - t2) / 1000;
    relationSpinner.stop(color(C.yellow, `⚠️ [步骤2/3] 关系判断失败，将使用默认参数继续 (${perf.relation.toFixed(1)}s)`));
    console.error(color(C.yellow, `  原因: ${error.message}`));
    relationResult = { raw: "", parsed: null, ruleResult: null };
  }
  printRelationshipResult(relationResult);

  // ═══ 步骤3: 三版本并行生成 (Day 7: 融入关系判断) ═══
  console.log("");
  const genSpinner = spinner("📝 [步骤3/3] 正在并行生成三版本回复...");
  const t3 = performance.now();
  let versions;
  try {
    versions = await generateThreeVersions(scenario, relationResult.parsed);
    perf.versions = (performance.now() - t3) / 1000;
    const tag = perf.versions < 3 ? "✅" : "⚠️";
    genSpinner.stop(color(C.green, `${tag} [步骤3/3] 三版本生成完成 (${perf.versions.toFixed(1)}s)`));
  } catch (error) {
    perf.versions = (performance.now() - t3) / 1000;
    genSpinner.stop(color(C.red, `❌ [步骤3/3] 三版本生成失败 (${perf.versions.toFixed(1)}s)`));
    throw new Error(`三版本生成失败: ${error.message}`);
  }
  printComparisonTable(versions);

  // ═══ Day 11: M5 反应预测 (预留接口) ═══
  let predictionResult = null;
  if (predictReactions) {
    const t4 = performance.now();
    try {
      console.log("");
      const predSpinner = spinner("🔮 [M5] 正在预测对方反应...");
      predictionResult = await predictReactions(scenario, relationResult.parsed, versions);
      perf.prediction = (performance.now() - t4) / 1000;
      predSpinner.stop(color(C.green, `✅ [M5] 反应预测完成 (${perf.prediction.toFixed(1)}s)`));
    } catch (error) {
      perf.prediction = (performance.now() - t4) / 1000;
      console.error(color(C.yellow, `  ⚠️ M5 预测失败: ${error.message}，跳过此步骤`));
    }
  }

  // ═══ 完成 + 性能报告 ═══
  perf.total = (performance.now() - perfStart) / 1000;
  console.log("");
  printDivider("=");
  console.log(color(C.bold, color(C.green, "✅ 完整链路演示完毕！")));
  console.log(color(C.cyan, "  🔗 链路: 用户输入 → 意图识别 → 关系判断(规则0.3+LLM0.7) → 三版本并行生成(带关系调整) → 格式化输出"));
  printDivider("=");

  // Day 11: 性能报告
  console.log("");
  console.log(color(C.bold, "⏱️  性能报告 (Day 11 打点)"));
  console.log(color(C.dim, `  意图识别 : ${(perf.intent || 0).toFixed(2)}s  ${perf.intent < 1 ? color(C.green, "✅ < 1s目标") : color(C.yellow, "⚠️ > 1s目标")}`));
  console.log(color(C.dim, `  关系判断 : ${(perf.relation || 0).toFixed(2)}s  ${perf.relation < 1 ? color(C.green, "✅ < 1s目标") : color(C.yellow, "⚠️ > 1s目标")}`));
  console.log(color(C.dim, `  三版本   : ${(perf.versions || 0).toFixed(2)}s  ${perf.versions < 3 ? color(C.green, "✅ < 3s目标") : color(C.yellow, "⚠️ > 3s目标")}`));
  if (perf.prediction !== undefined) {
    console.log(color(C.dim, `  反应预测 : ${perf.prediction.toFixed(2)}s (M5)`));
  }
  console.log(color(C.bold, `  全流程   : ${perf.total.toFixed(2)}s  ${perf.total < 5 ? color(C.green, "✅ < 5s目标") : color(C.yellow, "⚠️ > 5s目标")}`));
  console.log("");

  // ═══ Day 12: 端到端数据持久化 — 保存分析记录到 SQLite ═══
  if (dbDao) {
    try {
      // 计算总 tokens
      const totalTokens =
        (intentResult.tokens || 0) +
        (relationResult.tokens || 0) +
        versions.reduce((sum, v) => sum + (v.tokens || 0), 0);

      // 提取三版本内容和 Jaccard 差异度
      const versionData = { mild: null, firm: null, eq: null };
      const jaccardData = {};
      for (const v of versions) {
        if (v.meta && v.meta.key) {
          versionData[v.meta.key] = v.parsed?.content || null;
          if (v.jaccard) {
            jaccardData[`jaccard${v.meta.key.charAt(0).toUpperCase() + v.meta.key.slice(1)}`] = v.jaccard;
          }
        }
      }

      // 提取 Jaccard 差异度数据 (从 generateThreeVersions 附加的 _similarities)
      const sims = versions._similarities || {};
      const jaccardMildFirm = sims["mild-firm"]?.similarity ?? null;
      const jaccardMildEq = sims["mild-eq"]?.similarity ?? null;
      const jaccardFirmEq = sims["firm-eq"]?.similarity ?? null;

      const caseId = await dbDao.saveCase({
        scenario,
        intentType: intentResult.parsed?.["意图"] || null,
        intentConfidence: intentResult.parsed?.["置信度"] || null,
        relationType: relationResult.parsed?.["关系类型"] || null,
        relationIntimacy: relationResult.parsed?.["亲密度"] || null,
        relationPower: relationResult.parsed?.["权力关系"] || null,
        relationInterest: relationResult.parsed?.["利益关联"] || null,
        relationSensitivity: relationResult.parsed?.["表达敏感度"] || null,
        relationConfidence: relationResult.parsed?.["置信度"] || null,
        versionMild: versionData.mild,
        versionFirm: versionData.firm,
        versionEq: versionData.eq,
        jaccardMildFirm,
        jaccardMildEq,
        jaccardFirmEq,
        totalTokens,
        totalTimeMs: Math.round(perf.total * 1000),
      });

      // 验证检索
      const recent = await dbDao.getRecentCases(1);
      if (recent && recent.length > 0 && recent[0].id === caseId) {
        console.log(color(C.green, `  ✅ 端到端数据流验证: SQLite 存储+检索正常 (案例 #${caseId})`));
      }
    } catch (error) {
      console.error(color(C.yellow, `  ⚠️ SQLite 存储失败 (非致命): ${error.message}`));
    }
  }
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
  console.log(color(C.bold, "╔══════════════════════════════════════════════════════╗"));
  console.log(color(C.bold, "║     🎯 ExpressCoach AI — 社交表达教练 (MVP Day 10)     ║"));
  console.log(color(C.bold, "║  完整链路: 意图识别 → 关系判断(规则+LLM) → 三版本     ║"));
  console.log(color(C.bold, "╚══════════════════════════════════════════════════════╝"));
  console.log("");
  console.log(color(C.dim, "  📝 在下方输入你的社交场景，AI 会帮你分析意图、判断关系并生成三版本回复"));
  console.log(color(C.dim, "  输入 /help 查看示例  |  输入 /quit 退出"));
  console.log("");

  let turn = 0;
  let totalTokens = 0;

  while (true) {
    turn++;
    const input = await ask(color(C.cyan, "💬 场景> "));

    if (!input.trim()) continue;

    if (input.trim() === "/quit" || input.trim() === "/q" || input.trim() === "exit") {
      console.log("");
      console.log(color(C.green, `  👋 本次共分析了 ${turn - 1} 个场景，再见！`));
      console.log("");
      rl.close();
      break;
    }

    if (input.trim() === "/help") {
      console.log("");
      console.log(color(C.bold, "  \u{1f4cb} 示例场景 (按5种意图分类):"));
      console.log('    \u{1f6ab} 拒绝: 我想拒绝朋友借钱但不想伤感情');
      console.log('    ⏰ 催促: 同事的报告拖了三天了我想催他');
      console.log('    \u{1f4ac} 反馈: 领导安排不太合理我想提出来');
      console.log('    \u{1f6a7} 设边界: 同事总在下班后给我发工作消息');
      console.log('    \u{1f198} 求助: 我想向老板请假但不知道怎么开口');
      console.log('    \u{1f6ab} 拒绝: 同事总让我帮忙做他的工作');
      console.log('    ⏰ 催促: 客户一直不付款该怎么催');
      console.log('    \u{1f4ac} 反馈: 朋友总是迟到我想提醒他');
      console.log("");
      continue;
    }

    try {
      await runAnalysis(input);
    } catch (error) {
      console.error(color(C.red, `❌ 错误: ${error.message}`));
      console.log(color(C.yellow, "  请重试或输入 /quit 退出"));
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
    console.error(color(C.red, "❌ DEEPSEEK_API_KEY 未配置，请检查 .env 文件"));
    process.exit(1);
  }

  // 检查关键文件
  const requiredFiles = [
    { path: INTENT_SOUL, label: "意图识别 SOUL.md" },
    { path: RELATION_SOUL, label: "关系判断 SOUL.md" },
    { path: GENERATOR_SOULS.mild, label: "温和版 SOUL.md" },
    { path: GENERATOR_SOULS.firm, label: "坚定版 SOUL.md" },
    { path: GENERATOR_SOULS.eq, label: "高情商版 SOUL.md" },
  ];
  let missingFiles = false;
  for (const f of requiredFiles) {
    if (!fs.existsSync(f.path)) {
      console.error(color(C.red, `❌ ${f.label} 未找到: ${f.path}`));
      missingFiles = true;
    }
  }
  if (missingFiles) {
    console.error(color(C.red, "请确保所有 SOUL.md 文件存在后再运行"));
    process.exit(1);
  }

  const scenario = process.argv.slice(2).join(" ");

  if (scenario.trim()) {
    // 命令行参数模式: 单次运行
    console.log("");
    console.log(color(C.bold, "╔══════════════════════════════════════════════════════╗"));
    console.log(color(C.bold, "║     🎯 ExpressCoach AI — MVP 完整链路演示 (Day 10)    ║"));
    console.log(color(C.bold, "╚══════════════════════════════════════════════════════╝"));
    try {
      await runAnalysis(scenario);
    } catch (error) {
      console.error(color(C.red, "❌ 错误:"), error.message);
      process.exit(1);
    }
  } else {
    // 无参数: 进入交互模式
    await interactiveMode();
  }
}

main();
