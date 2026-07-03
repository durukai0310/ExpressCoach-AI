#!/usr/bin/env node
/**
 * ExpressCoach AI — MVP 原型 (Day 11 完善版)
 * 完整链路: 意图识别(LLM+规则兜底) → 关系判断(规则+LLM混合) → 三版本并行生成(带 Jaccard 差异度检查) → M5预测(预留) → 格式化输出
 *
 * 用法: node src/index.js "你的社交场景描述"
 * 示例: node src/index.js "我想拒绝朋友借钱但不想伤感情"
 *
 * W2 Day 14 更新:
 *  - ✅ M5 反应预测模块集成 (src/predict/reactions.js + soul/predictor.md)
 *  - ✅ 增强意图关键词 (拒绝/设边界/求助 各+5个关键词, 来自25场景测试发现)
 *  - ✅ 补充关系词典服务类关键词 (物业/快递/外卖等)
 *  - ✅ 交互模式增加 /stats 命令 + 帮助系统完善
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
  predictReactions = require("./predict/reactions").predictReactions;
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

// Day 20: 沙盒集成 — 懒加载沙盒模块
let sandboxModule = null;
function getSandboxModule() {
  if (!sandboxModule) {
    try {
      sandboxModule = require("./sandbox/sandbox");
      console.log("  🎭 沙盒模块已加载");
    } catch (e) {
      console.error(`  ⚠️ 沙盒模块加载失败: ${e.message}`);
    }
  }
  return sandboxModule;
}

// W4 Day 24: 用户画像系统 — 懒加载
let userProfileModule = null;
let currentProfileId = null;
function getUserProfileModule() {
  if (!userProfileModule) {
    try {
      userProfileModule = require("./memory/user-profile");
      console.log("  🧠 用户画像模块已加载");
    } catch (e) {
      console.error(`  ⚠️ 用户画像模块加载失败: ${e.message}`);
    }
  }
  return userProfileModule;
}

// Day 20: 黄金案例库路径
const GOLDEN_CASES_PATH = path.resolve(__dirname, "..", "data", "golden-cases.json");

// W5 Day 31: 公共模块导入
const { C, color } = require("./lib/color");
const { parseResponse } = require("./lib/parse");
const { loadFile } = require("./lib/fs-utils");

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
  console.log(color(C.bold, "📊 步骤1: 意图识别结果 (Day 23 多标签)"));
  printDivider();

  if (result.parsed) {
    const r = result.parsed;
    // Day 23: 显示主意图 + 辅助意图
    const primaryIntent = r["主意图"] || r["意图"] || "未知";
    console.log(`  主意图   : ${color(C.cyan, primaryIntent)}`);
    if (r["辅助意图"] && r["辅助意图"].length > 0) {
      console.log(`  🏷️ 辅助意图: ${color(C.yellow, r["辅助意图"].join(" / "))}`);
    }
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
    if (result.dualRelation && result.dualRelation.isDual) {
      console.log(`  🔀 双重关系 : ${color(C.magenta, result.dualRelation.primaryRelation)}(${result.dualRelation.primaryWeight}) + ${result.dualRelation.secondaryRelation}(${result.dualRelation.secondaryWeight})`);
      console.log(`  📐 敏感度修正 : ${color(C.yellow, `+${result.dualRelation.sensitivityModifier || 0.2}`)} (双重关系自动加成)`);
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

  // ═══ Day 32: 步骤1+步骤2 并行化 — 意图识别与关系判断无依赖，并行执行 ═══
  const parallelSpinner = spinner("⚡ [步骤1+2/3] 正在并行分析意图+关系...");
  const t1 = performance.now();
  const t2 = performance.now(); // 两个步骤共享开始时间

  let intentResult;
  let relationResult;

  try {
    // Day 32 性能优化: Promise.all 并行化意图识别+关系判断
    [intentResult, relationResult] = await Promise.all([
      recognizeIntent(scenario),
      hybridAnalyze(scenario)
    ]);

    perf.intent = (performance.now() - t1) / 1000;
    perf.relation = (performance.now() - t2) / 1000;
    const tag = Math.max(perf.intent, perf.relation) < 1 ? "✅" : "⚠️";
    parallelSpinner.stop(color(C.green, `${tag} [步骤1+2/3] 意图识别+关系判断并行完成 (${Math.max(perf.intent, perf.relation).toFixed(1)}s)`));
  } catch (error) {
    perf.intent = (performance.now() - t1) / 1000;
    perf.relation = (performance.now() - t2) / 1000;
    parallelSpinner.stop(color(C.yellow, `⚠️ [步骤1+2/3] 并行执行部分失败 (${Math.max(perf.intent, perf.relation).toFixed(1)}s)`));

    // 处理部分失败: 检查哪个步骤失败了
    if (!intentResult) {
      console.error(color(C.red, `  ❌ 意图识别失败: ${error.message}`));
      throw new Error(`意图识别失败: ${error.message}`);
    }
    if (!relationResult) {
      console.error(color(C.yellow, `  ⚠️ 关系判断失败: ${error.message}，将使用默认参数`));
      relationResult = { raw: "", parsed: null, ruleResult: null };
    }
  }

  printIntentResult(intentResult);
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

  // ═══ Day 14: M5 反应预测 (已集成) ═══
  let predictionResult = null;
  if (predictReactions) {
    const t4 = performance.now();
    try {
      console.log("");
      const predSpinner = spinner("🔮 [M5] 正在预测对方反应...");
      // 默认选择高情商版作为预测输入
      const eqVersion = versions.find(v => v.styleKey === "eq") || versions[0];
      const selectedContent = eqVersion.parsed?.content || "(未生成)";
      const selectedStyle = eqVersion.meta?.name || "高情商版";
      predictionResult = await predictReactions(scenario, selectedContent, selectedStyle);
      perf.prediction = (performance.now() - t4) / 1000;
      predSpinner.stop(color(C.green, `✅ [M5] 反应预测完成 (${perf.prediction.toFixed(1)}s)`));

      // 打印预测结果
      if (predictionResult.parsed && !predictionResult.error) {
        console.log("");
        printDivider();
        console.log(color(C.bold, "🔮 步骤4: 对方反应预测"));
        printDivider();
        for (let i = 0; i < predictionResult.parsed.length; i++) {
          const pred = predictionResult.parsed[i];
          const probEmoji = pred.probability === "high" ? "🔴" : pred.probability === "medium" ? "🟡" : "🟢";
          const probLabel = pred.probability === "high" ? "高概率" : pred.probability === "medium" ? "中概率" : "低概率";
          console.log(`  ${probEmoji} ${pred.type} (${probLabel})`);
          if (pred.sample_response) console.log(color(C.dim, `     💬 ${pred.sample_response}`));
          if (pred.counter_tip) console.log(color(C.dim, `     💡 ${pred.counter_tip}`));
        }
        if (predictionResult.source) {
          console.log(color(C.dim, `  🔀 数据源: ${predictionResult.source}`));
        }
      }
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
  console.log(color(C.cyan, "  🔗 链路: 用户输入 → 意图识别 → 关系判断(规则0.3+LLM0.7) → 三版本并行生成 → 反应预测(M5) → 格式化输出"));
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
  let savedCaseId = null;
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

      savedCaseId = await dbDao.saveCase({
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
      if (recent && recent.length > 0 && recent[0].id === savedCaseId) {
        console.log(color(C.green, `  ✅ 端到端数据流验证: SQLite 存储+检索正常 (案例 #${savedCaseId})`));
      }
    } catch (error) {
      console.error(color(C.yellow, `  ⚠️ SQLite 存储失败 (非致命): ${error.message}`));
    }
  }

  // Day 20: 返回分析结果（含 caseId 用于反馈闭环）
  return { versions, savedCaseId, intentResult, relationResult };
}

// ============================================================
// Day 20: 反馈闭环 — 用户选择最佳版本 + 评分 + 黄金案例库
// ============================================================

/**
 * 收集用户反馈：选择最佳版本 + 评分
 * 评分 >= 4 → 追加到 data/golden-cases.json
 */
async function collectFeedback(rl, ask, versions, savedCaseId, scenario) {
  console.log("");
  printDivider("─");
  console.log(color(C.bold, "⭐ 反馈闭环 (Day 20): 请为三版本评分"));

  // 选择最佳版本
  const choice = await ask(color(C.cyan, "  请选择最佳版本 (1=温和版 / 2=坚定版 / 3=高情商版): "));
  const choiceNum = parseInt(choice.trim());
  const versionMap = { 1: "mild", 2: "firm", 3: "eq" };
  const versionType = versionMap[choiceNum];

  if (!versionType) {
    console.log(color(C.yellow, "  ⚠️ 无效选择，跳过反馈"));
    return { versionType: null, rating: null };
  }

  // 评分
  const ratingStr = await ask(color(C.cyan, "  请评分 (1-5星): "));
  const rating = parseInt(ratingStr.trim());
  if (isNaN(rating) || rating < 1 || rating > 5) {
    console.log(color(C.yellow, "  ⚠️ 无效评分，跳过反馈"));
    return { versionType: null, rating: null };
  }

  // 可选评语
  const comment = await ask(color(C.cyan, "  评语 (可选，直接回车跳过): "));

  // 保存到 SQLite feedback 表
  if (dbDao && savedCaseId) {
    try {
      await dbDao.saveFeedback(savedCaseId, versionType, rating, comment.trim() || null);
      console.log(color(C.green, `  ⭐ 反馈已保存: ${versionType}版 → ${"★".repeat(rating)}${"☆".repeat(5 - rating)} (${rating}/5)`));
    } catch (e) {
      console.error(color(C.yellow, `  ⚠️ 反馈保存失败: ${e.message}`));
    }
  }

  // Day 20: 评分 >= 4星 → 追加到黄金案例库
  if (rating >= 4) {
    try {
      const goldenCase = {
        scenario,
        selectedVersion: versionType,
        rating,
        comment: comment.trim() || null,
        timestamp: new Date().toISOString(),
        intentType: null,
        relationType: null,
      };

      // 尝试从版本中获取内容
      const selectedVersion = versions.find(v => v.meta?.key === versionType);
      if (selectedVersion?.parsed?.content) {
        goldenCase.replyContent = selectedVersion.parsed.content;
      }

      // 读取现有黄金案例
      let goldenCases = [];
      if (fs.existsSync(GOLDEN_CASES_PATH)) {
        try {
          goldenCases = JSON.parse(fs.readFileSync(GOLDEN_CASES_PATH, "utf-8"));
        } catch (e) {
          goldenCases = [];
        }
      }

      goldenCases.push(goldenCase);
      fs.writeFileSync(GOLDEN_CASES_PATH, JSON.stringify(goldenCases, null, 2), "utf-8");
      console.log(color(C.green, `  🏆 已追加到黄金案例库 (${goldenCases.length} 条)`));
    } catch (e) {
      console.error(color(C.yellow, `  ⚠️ 黄金案例库更新失败: ${e.message}`));
    }
  }

  // W4 Day 24: 返回选择的版本和评分，用于用户画像记录
  return { versionType, rating };
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
  console.log(color(C.bold, "║     🎯 ExpressCoach AI — 社交表达教练 (MVP Day 24)     ║"));
  console.log(color(C.bold, "║  全链路+沙盒+自动评分+反馈闭环+竞品对比+用户画像            ║"));
  console.log(color(C.bold, "╚══════════════════════════════════════════════════════╝"));
  console.log("");
  console.log(color(C.dim, "  📝 在下方输入你的社交场景，AI 会帮你分析意图、判断关系并生成三版本回复"));
  console.log(color(C.dim, "  输入 /help 查看示例  |  /stats 查看统计  |  /search 搜索案例  |  /sandbox 沙盒练习  |  /quit 退出"));
  console.log("");

  // ═══ W4 Day 24: 用户画像加载 ═══
  const upModule = getUserProfileModule();
  if (upModule && dbDao) {
    try {
      await upModule.initProfileTables();
      console.log("  🧠 用户画像表已就绪");
    } catch (e) {
      console.error(color(C.yellow, `  ⚠️ 画像表初始化失败: ${e.message}`));
    }

    // 列出已有画像
    try {
      const profiles = await upModule.listProfiles();
      if (profiles.length > 0) {
        console.log("");
        console.log(color(C.bold, "  👤 已有用户画像:"));
        for (const p of profiles) {
          console.log(color(C.dim, `     ID#${p.id}: ${p.name} | 风格: ${p.preferred_style} | 会话: ${p.total_sessions}次`));
        }
      }
      console.log("");
      const profileChoice = await ask(color(C.cyan, "🧠 是否加载已有用户画像？输入ID、新用户名，或直接回车跳过: "));
      const trimmed = profileChoice.trim();

      if (trimmed) {
        const idNum = parseInt(trimmed);
        if (!isNaN(idNum) && profiles.find(p => p.id === idNum)) {
          // 按ID加载
          const profile = await upModule.getProfile(idNum);
          if (profile) {
            currentProfileId = profile.id;
            console.log(color(C.green, `  ✅ 已加载用户画像: ${profile.name} (ID#${profile.id})`));
            console.log(color(C.dim, `     偏好风格: ${profile.preferred_style} | 常用意图: ${JSON.parse(profile.common_intents || '[]').join(', ') || '暂无'}`));
          }
        } else {
          // 按名称创建新画像
          try {
            const newProfile = await upModule.createProfile(trimmed);
            currentProfileId = newProfile.id;
            console.log(color(C.green, `  ✅ 已创建新用户画像: ${trimmed} (ID#${newProfile.id})`));
          } catch (e) {
            console.log(color(C.yellow, `  ⚠️ 创建画像失败: ${e.message}`));
          }
        }
      } else {
        console.log(color(C.dim, "  ℹ️ 跳过用户画像，分析将不会被记录到个人历史"));
      }
    } catch (e) {
      console.log(color(C.yellow, `  ⚠️ 画像查询失败: ${e.message}`));
    }
  }

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
      console.log(color(C.dim, "  命令: /help 帮助 | /stats 统计 | /search 搜索案例 | /sandbox 沙盒练习 | /profile 画像 | /quit 退出"));
      console.log("");
      continue;
    }

    // Day 20: /sandbox 沙盒命令
    if (input.trim() === "/sandbox" || input.trim().startsWith("/sandbox ")) {
      const sandbox = getSandboxModule();
      if (!sandbox) {
        console.log(color(C.yellow, "  ⚠️ 沙盒模块未加载，请检查 src/sandbox/sandbox.js"));
        continue;
      }

      // 解析参数: /sandbox [场景] [模式]
      let sandboxScenario = "";
      let sandboxMode = "guided";
      let sandboxPersonality = "friendly";

      const parts = input.trim().split(/\s+/);
      if (parts.length >= 2) sandboxScenario = parts.slice(1).join(" ");

      // 如果没提供场景，询问
      if (!sandboxScenario) {
        sandboxScenario = await ask(color(C.cyan, "  🎭 沙盒场景> "));
      }
      if (!sandboxScenario.trim()) {
        console.log(color(C.yellow, "  ⚠️ 需要输入场景"));
        continue;
      }

      // 选择模式
      console.log("");
      console.log(color(C.bold, "  选择练习模式:"));
      console.log(color(C.green, "    1. free   — 自由模式（教练完全静默，自由练习）"));
      console.log(color(C.yellow, "    2. guided — 引导模式（教练每2轮主动给建议）"));
      console.log(color(C.red, "    3. stress — 压力模式（强制刁难对方，教练仅求助时介入）"));
      const modeChoice = await ask(color(C.cyan, "  请选择模式 (1/2/3, 默认2=guided): "));
      const modeMap = { "1": "free", "2": "guided", "3": "stress" };
      sandboxMode = modeMap[modeChoice.trim()] || "guided";

      // 选择性格 (非stress模式)
      if (sandboxMode !== "stress") {
        console.log("");
        console.log(color(C.dim, "  选择对方性格 (默认 friendly):"));
        console.log(color(C.dim, "    1. friendly — 友善型 | 2. hostile — 刁难型 | 3. avoidant — 回避型"));
        const persChoice = await ask(color(C.cyan, "  请选择性格 (1/2/3, 默认1): "));
        const persMap = { "1": "friendly", "2": "hostile", "3": "avoidant" };
        sandboxPersonality = persMap[persChoice.trim()] || "friendly";
      } else {
        sandboxPersonality = "hostile"; // stress 强制 hostile
      }

      // 选择轮次
      const roundsStr = await ask(color(C.cyan, "  轮次数 (默认5): "));
      const sandboxRounds = parseInt(roundsStr.trim()) || 5;

      try {
        await sandbox.startSandbox(sandboxScenario.trim(), sandboxMode, sandboxPersonality, {
          rounds: Math.min(sandboxRounds, 10),
          autopilot: false,
        });
      } catch (error) {
        console.error(color(C.red, `  ❌ 沙盒运行异常: ${error.message}`));
      }
      continue;
    }

    // W4 Day 24: /profile 用户画像命令
    if (input.trim() === "/profile" || input.trim().startsWith("/profile")) {
      const upMod = getUserProfileModule();
      if (!upMod || !dbDao) {
        console.log(color(C.yellow, "  ⚠️ 用户画像模块或数据库未就绪"));
        continue;
      }

      if (!currentProfileId) {
        console.log(color(C.yellow, "  ⚠️ 尚未加载用户画像，请重新启动并在启动时选择画像"));
        continue;
      }

      try {
        const profile = await upMod.getProfile(currentProfileId);
        const inferred = await upMod.inferPreferences(currentProfileId);
        console.log("");
        console.log(color(C.bold, "╔══════════════════════════════════════════════════════╗"));
        console.log(color(C.bold, `║  👤 用户画像: ${(profile?.name || "未知").padEnd(42)}║`));
        console.log(color(C.bold, "╠══════════════════════════════════════════════════════╣"));
        console.log(color(C.bold, `║  ID: ${String(currentProfileId).padEnd(48)}║`));
        console.log(color(C.bold, `║  偏好风格: ${(profile?.preferred_style || "eq").padEnd(43)}║`));
        console.log(color(C.bold, `║  总分析次数: ${String(profile?.total_sessions || 0).padEnd(42)}║`));
        if (inferred) {
          console.log(color(C.bold, `║  最常意图: ${(inferred.topIntents?.join(', ') || '暂无').padEnd(46)}║`));
          console.log(color(C.bold, `║  最爱版本: ${(inferred.preferredStyle || 'eq').padEnd(46)}║`));
          console.log(color(C.bold, `║  上次活跃: ${(inferred.lastActive || '未知').padEnd(46)}║`));
        }
        console.log(color(C.bold, "╚══════════════════════════════════════════════════════╝"));
        console.log("");
      } catch (e) {
        console.log(color(C.yellow, `  ⚠️ 画像查询失败: ${e.message}`));
      }
      continue;
    }

    if (input.trim() === "/stats") {
      console.log("");
      console.log(color(C.bold, "╔══════════════════════════════════════════════════════╗"));
      console.log(color(C.bold, "║              📊 ExpressCoach 系统统计                  ║"));
      console.log(color(C.bold, "╠══════════════════════════════════════════════════════╣"));
      console.log(color(C.bold, "║  M1 意图识别准确率:      84%    ✅ 超过80%目标        ║"));
      console.log(color(C.bold, "║  M2 关系判断准确率:      92.6%  ✅ 混合模式最优        ║"));
      console.log(color(C.bold, "║  M4 风格差异度均值:      7.2/10 ✅ 区分度明显          ║"));
      console.log(color(C.bold, "║  M5 反应预测合理率:      88.9%  ✅ 预测准确性高        ║"));
      console.log(color(C.bold, "║  M7 案例库案例数:        N/A                          ║"));
      console.log(color(C.bold, "╠══════════════════════════════════════════════════════╣"));
      console.log(color(C.bold, "║  效果量化综合评分:       81.9/100                      ║"));
      console.log(color(C.bold, "╚══════════════════════════════════════════════════════╝"));

      // W4 Day 24: 个人统计
      if (currentProfileId && upModule) {
        try {
          const inferred = await upModule.inferPreferences(currentProfileId);
          if (inferred) {
            console.log("");
            console.log(color(C.bold, "  👤 你的个人统计:"));
            console.log(color(C.dim, `     总分析次数: ${inferred.totalAnalyses}`));
            console.log(color(C.dim, `     最常意图: ${inferred.topIntents?.join(', ') || '暂无'}`));
            console.log(color(C.dim, `     最爱版本: ${inferred.preferredStyle || 'eq'}`));
            if (inferred.avgRatings && Object.keys(inferred.avgRatings).length > 0) {
              for (const [v, r] of Object.entries(inferred.avgRatings)) {
                console.log(color(C.dim, `     ${v}版平均评分: ${r}/5`));
              }
            }
          }
        } catch (e) { /* silent */ }
      }
      console.log("");
      continue;
    }

    if (input.trim() === "/search") {
      if (dbDao) {
        const keyword = await ask(color(C.cyan, "🔍 搜索关键词> "));
        if (keyword.trim()) {
          try {
            const results = await dbDao.searchCases(keyword.trim(), 5);
            console.log("");
            console.log(color(C.bold, `  🔍 搜索 "${keyword.trim()}": 找到 ${results.length} 条匹配案例`));
            for (const c of results) {
              console.log(color(C.dim, `     #${c.id}: "${(c.scenario || "").substring(0, 50)}..." → ${c.intent_type || "?"} | ${c.relation_type || "?"}`));
            }
            console.log("");
          } catch (e) {
            console.log(color(C.yellow, `  ⚠️ 搜索失败: ${e.message}`));
          }
        }
      } else {
        console.log(color(C.yellow, "  ⚠️ SQLite 数据库未就绪，无法搜索"));
      }
      continue;
    }

    try {
      const analysisResult = await runAnalysis(input);
      // Day 20: 反馈闭环 — 用户评分
      let feedbackInfo = { versionType: null, rating: null };
      if (analysisResult && analysisResult.versions) {
        feedbackInfo = await collectFeedback(
          rl, ask,
          analysisResult.versions,
          analysisResult.savedCaseId,
          input
        );
      }

      // W4 Day 24: 自动记录分析到用户画像历史（含版本选择和评分）
      if (currentProfileId && upModule && analysisResult) {
        try {
          const intentType = analysisResult.intentResult?.parsed?.["主意图"]
            || analysisResult.intentResult?.parsed?.["意图"]
            || null;
          const relationType = analysisResult.relationResult?.parsed?.["关系类型"] || null;

          await upModule.postAnalysisUpdate(currentProfileId, {
            scenario: input,
            intentType,
            relationType,
            chosenVersion: feedbackInfo.versionType,
            rating: feedbackInfo.rating,
          });
        } catch (e) { /* silent — don't interrupt the flow */ }
      }
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
  // W5 Day 31: 检查 API Key — 至少一个可用即可
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const hasQwen = !!process.env.DASHSCOPE_API_KEY;
  const hasKimi = !!process.env.MOONSHOT_API_KEY;
  if (!hasDeepSeek && !hasQwen && !hasKimi) {
    console.error(color(C.red, "❌ 至少配置一个 API Key (DEEPSEEK_API_KEY / DASHSCOPE_API_KEY / MOONSHOT_API_KEY)"));
    console.error(color(C.dim, "   请在 .env 文件中配置任意一个模型的 API Key"));
    process.exit(1);
  }
  console.error(color(C.dim, `  📡 可用模型: ${[hasDeepSeek && 'DeepSeek', hasQwen && '千问', hasKimi && 'Kimi'].filter(Boolean).join(', ')}`));

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
    console.log(color(C.bold, "║     🎯 ExpressCoach AI — MVP 完整链路演示 (Day 20)    ║"));
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
