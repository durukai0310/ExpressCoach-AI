#!/usr/bin/env node
/**
 * LLM-as-Judge 自动评分引擎 (Day 19)
 *
 * 功能:
 *   - evaluateReply(scenario, relationInfo, replyContent) — 单条回复评分
 *   - batchEvaluate(scenarios[]) — 批量评分
 *
 * 评分维度 (5维 × 5分 = 25分):
 *   1. 意图达成度 (25%): 用户意图是否被清晰传达？1=完全没表达 5=完整传达
 *   2. 关系维护度 (25%): 是否保护了双方关系？1=伤害关系 5=增进好感
 *   3. 表达自然度 (20%): 像真人说话吗？1=机器翻译 5=接地气
 *   4. 策略适当性 (20%): 策略匹配当前关系？1=完全错误 5=精准匹配
 *   5. 可操作性 (10%): 能直接拿来用？1=没法用 5=直接说出口
 *
 * 技术:
 *   - DeepSeek API (temperature=0.1)
 *   - System Prompt 存 soul/judge.md
 *   - JSON 解析失败时正确降级
 *
 * 用法:
 *   node src/evaluate/judge.js "我想拒绝朋友借钱但不想伤感情"
 *   node src/evaluate/judge.js --batch data/scenarios-intent.json
 *   node src/evaluate/judge.js --compare "data/seed-cases.json"
 *
 * 使用 CommonJS 规范
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

// 复用项目已有的 callDeepSeek
const { callDeepSeek } = require("../intent/recognize");
const { C, c } = require("../lib/color");

// ============================================================
// 配置
// ============================================================
const JUDGE_SOUL_PATH = path.resolve(__dirname, "..", "..", "soul", "judge.md");

// ============================================================
// 硬编码 System Prompt（兜底：soul/judge.md 不存在时使用）
// ============================================================
const HARDCODED_JUDGE_SYSTEM_PROMPT = `你是一位社交表达质量评估专家。你的任务是对社交表达回复从5个维度进行客观、严格的评分（每个维度1-5分）。

## 评分维度
1. 意图达成度(25%): 用户意图是否被清晰传达？1=完全没表达 5=完整传达
2. 关系维护度(25%): 是否保护了双方关系？1=伤害关系 5=增进好感
3. 表达自然度(20%): 像真人说话吗？1=机器翻译 5=接地气
4. 策略适当性(20%): 策略匹配当前关系？1=完全错误 5=精准匹配
5. 可操作性(10%): 能直接拿来用？1=没法用 5=直接说出口

总分 = (意图达成度×0.25 + 关系维护度×0.25 + 表达自然度×0.20 + 策略适当性×0.20 + 可操作性×0.10) × 5

## 注意
不要做老好人——敢于给低分。不好的回复就是不好。
只输出JSON格式：{"scores":{"intentScore":1-5,"relationScore":1-5,"naturalness":1-5,"strategyFit":1-5,"usability":1-5},"totalScore":数值,"analysis":"一句话总结","strengths":["优点1"],"weaknesses":["不足1"]}`;

// ============================================================
// 加载 System Prompt
// ============================================================
function loadJudgeSoul() {
  if (fs.existsSync(JUDGE_SOUL_PATH)) {
    try {
      const content = fs.readFileSync(JUDGE_SOUL_PATH, "utf-8");
      console.log(c(C.dim, `  📖 已加载 soul/judge.md (${content.length} 字符)`));
      return content;
    } catch (e) {
      console.error(c(C.yellow, `  ⚠️ soul/judge.md 读取失败，使用硬编码 System Prompt`));
    }
  } else {
    console.error(c(C.yellow, `  ⚠️ soul/judge.md 不存在，使用硬编码 System Prompt`));
  }
  return HARDCODED_JUDGE_SYSTEM_PROMPT;
}

// ============================================================
// JSON 解析（健壮处理，支持多种回退策略）
// ============================================================
function parseJudgeResponse(raw) {
  if (!raw) return null;

  // 策略1: 直接解析
  try {
    const result = JSON.parse(raw);
    if (result.scores && typeof result.totalScore === "number") {
      return result;
    }
  } catch (e) {
    // 继续尝试其他策略
  }

  // 策略2: 从 markdown 代码块提取
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const result = JSON.parse(jsonMatch[1].trim());
      if (result.scores) return result;
    } catch (e2) {}
  }

  // 策略3: 找最外层花括号
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      const result = JSON.parse(braceMatch[0]);
      if (result.scores) return result;
    } catch (e3) {}
  }

  // 所有策略都失败，返回 null
  return null;
}

/**
 * 降级评分: 当 LLM 调用失败或 JSON 解析失败时使用规则兜底
 * 基于基本启发式规则估算分数
 */
function fallbackScore(replyContent) {
  const text = replyContent || "";

  // 基于文本长度的基本启发式
  let intentScore = 3;
  let relationScore = 3;
  let naturalness = 3;
  let strategyFit = 3;
  let usability = 3;

  // 长度太短 < 5字
  if (text.length < 5) {
    intentScore = 1;
    usability = 1;
  }
  // 长度适中 20-80字
  if (text.length >= 20 && text.length <= 80) {
    intentScore = 4;
    usability = 4;
  }

  // 包含共情表达
  if (/理解|明白|知道|感受|心情|难处|不容易/.test(text)) {
    relationScore = 4;
  }

  // 包含口语化表达
  if (/呢|吧|呀|哦|嘛|哈/.test(text)) {
    naturalness = 4;
  }

  // 包含具体方案
  if (/可以|能不能|要不要|建议|方案|办法/.test(text)) {
    strategyFit = 4;
  }

  const totalScore =
    (intentScore * 0.25 + relationScore * 0.25 + naturalness * 0.20 + strategyFit * 0.20 + usability * 0.10) * 5;

  return {
    scores: { intentScore, relationScore, naturalness, strategyFit, usability },
    totalScore: Math.round(totalScore * 10) / 10,
    analysis: "降级评分（启发式规则估算，非LLM精确评分）",
    strengths: ["内容长度合理"],
    weaknesses: ["此为降级评分，仅供参考"],
    _fallback: true,
  };
}

// ============================================================
// evaluateReply — 单条回复评分
// ============================================================

/**
 * @param {String} scenario - 用户场景描述（如"我想拒绝朋友借钱但不想伤感情"）
 * @param {Object|null} relationInfo - 关系分析结果（可选）
 * @param {String} replyContent - 需要评分的回复内容
 * @returns {Object} {scores, totalScore, analysis, strengths, weaknesses}
 */
async function evaluateReply(scenario, relationInfo, replyContent) {
  const systemPrompt = loadJudgeSoul();

  // 构建评分 prompt
  let prompt = `请对以下社交表达回复进行评分。

场景: ${scenario}`;

  if (relationInfo) {
    const ri = relationInfo;
    if (ri["关系类型"]) prompt += `\n关系类型: ${ri["关系类型"]}`;
    if (ri["亲密度"]) prompt += `\n亲密度: ${ri["亲密度"]}`;
    if (ri["权力关系"]) prompt += `\n权力关系: ${ri["权力关系"]}`;
    if (ri["利益关联"]) prompt += `\n利益关联: ${ri["利益关联"]}`;
  }

  prompt += `\n回复内容: ${replyContent}

请严格按照5维度评分标准进行评分。不要做老好人——敢于给低分。只输出JSON。`;

  try {
    const result = await callDeepSeek(systemPrompt, prompt, {
      temperature: 0.1,
      maxTokens: 600,
    });

    const parsed = parseJudgeResponse(result.content);

    if (parsed) {
      return {
        ...parsed,
        _tokens: result.tokens,
        _raw: result.content,
      };
    }

    // JSON 解析失败，降级
    console.error(c(C.yellow, `  ⚠️ [Judge] JSON解析失败，使用规则降级。原始响应: ${result.content.substring(0, 150)}...`));
    return fallbackScore(replyContent);
  } catch (error) {
    // API 调用失败，降级
    console.error(c(C.yellow, `  ⚠️ [Judge] LLM调用失败: ${error.message}，使用规则降级`));
    return fallbackScore(replyContent);
  }
}

// ============================================================
// batchEvaluate — 批量评分
// ============================================================

/**
 * @param {Array} scenarios - 场景数组
 *   每个元素: {scenario, relationInfo?, replyContent, expectedScore?}
 * @returns {Object} {results, summary}
 */
async function batchEvaluate(scenarios) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    console.error(c(C.red, "  ❌ batchEvaluate: scenarios 不能为空"));
    return { results: [], summary: { total: 0, avgScore: 0, correlation: null } };
  }

  console.log(c(C.bold, `\n📊 批量评分开始 — ${scenarios.length} 个场景`));
  console.log(c(C.dim, "  ──────────────────────────────────────────"));

  const results = [];
  let successCount = 0;
  let fallbackCount = 0;
  let totalTokens = 0;

  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const label = s.scenario
      ? `场景${i + 1}: ${s.scenario.substring(0, 25)}...`
      : `条目${i + 1}`;

    process.stdout.write(c(C.dim, `  [${i + 1}/${scenarios.length}] ${label} `));

    try {
      const result = await evaluateReply(
        s.scenario || "未指定场景",
        s.relationInfo || null,
        s.replyContent || s.response || ""
      );

      results.push({
        index: i,
        scenario: s.scenario,
        replyContent: s.replyContent || s.response,
        result,
        expectedScore: s.expectedScore || null,
      });

      if (result._fallback) {
        fallbackCount++;
        process.stdout.write(c(C.yellow, `⚠️ 降级\n`));
      } else {
        successCount++;
        const scoreStr = `总分${result.totalScore}`;
        process.stdout.write(c(C.green, `✅ ${scoreStr}\n`));
      }

      totalTokens += result._tokens || 0;

      // 简介延迟避免 API 限流
      if (i < scenarios.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (error) {
      console.error(c(C.red, `\n  ❌ [${i + 1}] 评分失败: ${error.message}`));
      const fallback = fallbackScore(s.replyContent || s.response || "");
      results.push({
        index: i,
        scenario: s.scenario,
        replyContent: s.replyContent || s.response,
        result: fallback,
        expectedScore: s.expectedScore || null,
        error: error.message,
      });
      fallbackCount++;
    }
  }

  // 汇总统计
  const validResults = results.filter((r) => !r.error);
  const scores = validResults.map((r) => r.result.totalScore);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  // 人工评分相关性（如果有 expectedScore）
  let correlation = null;
  const resultsWithExpected = validResults.filter((r) => r.expectedScore !== null && r.expectedScore !== undefined);
  if (resultsWithExpected.length >= 3) {
    correlation = calculateCorrelation(
      resultsWithExpected.map((r) => r.expectedScore),
      resultsWithExpected.map((r) => r.result.totalScore)
    );
  }

  const summary = {
    total: results.length,
    success: successCount,
    fallback: fallbackCount,
    avgScore: Math.round(avgScore * 10) / 10,
    totalTokens,
    correlation: correlation !== null ? Math.round(correlation * 1000) / 1000 : null,
  };

  console.log(c(C.dim, "  ──────────────────────────────────────────"));
  console.log(c(C.bold, `  完成: ${successCount} 成功, ${fallbackCount} 降级, 均分 ${summary.avgScore}/25`));
  if (summary.correlation !== null) {
    const corrLabel = summary.correlation > 0.7 ? c(C.green, `${summary.correlation}`) : c(C.yellow, `${summary.correlation}`);
    console.log(c(C.bold, `  人工相关性: ${corrLabel} ${summary.correlation > 0.7 ? '✅ > 0.7' : '⚠️ < 0.7'}`));
  }
  console.log("");

  return { results, summary };
}

// ============================================================
// 皮尔逊相关系数计算（用于人工 vs LLM 评分对比）
// ============================================================
function calculateCorrelation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return null;

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  if (varX === 0 || varY === 0) return 0;
  return cov / Math.sqrt(varX * varY);
}

// ============================================================
// 格式化输出
// ============================================================
function printDivider(char = "─", length = 64) {
  console.log(c(C.dim, char.repeat(length)));
}

function printScoreCard(evaluation) {
  const s = evaluation.scores || {};

  console.log("");
  printDivider("=");
  console.log(c(C.bold, "📊 LLM-as-Judge 自动评分结果 (5维度 × 5分制)"));
  printDivider("=");
  console.log("");

  // 分数条
  const bar = (score) => {
    const filled = "█".repeat(score);
    const empty = "░".repeat(5 - score);
    return filled + empty;
  };

  console.log(`  1. 意图达成度 (25%):  ${bar(s.intentScore || 0)}  ${s.intentScore}/5  ${c(C.dim, `加权: ${((s.intentScore || 0) * 0.25 * 5).toFixed(1)}`)}`);
  console.log(`  2. 关系维护度 (25%):  ${bar(s.relationScore || 0)}  ${s.relationScore}/5  ${c(C.dim, `加权: ${((s.relationScore || 0) * 0.25 * 5).toFixed(1)}`)}`);
  console.log(`  3. 表达自然度 (20%):  ${bar(s.naturalness || 0)}  ${s.naturalness}/5  ${c(C.dim, `加权: ${((s.naturalness || 0) * 0.20 * 5).toFixed(1)}`)}`);
  console.log(`  4. 策略适当性 (20%):  ${bar(s.strategyFit || 0)}  ${s.strategyFit}/5  ${c(C.dim, `加权: ${((s.strategyFit || 0) * 0.20 * 5).toFixed(1)}`)}`);
  console.log(`  5. 可操作性   (10%):  ${bar(s.usability || 0)}  ${s.usability}/5  ${c(C.dim, `加权: ${((s.usability || 0) * 0.10 * 5).toFixed(1)}`)}`);
  console.log("");
  console.log(c(C.bold, `  📈 总分: ${evaluation.totalScore}/25`));

  if (evaluation.analysis) {
    console.log(c(C.dim, `  📝 分析: ${evaluation.analysis}`));
  }

  if (evaluation.strengths && evaluation.strengths.length > 0) {
    console.log(c(C.green, `  ✅ 优点: ${evaluation.strengths.join(" | ")}`));
  }

  if (evaluation.weaknesses && evaluation.weaknesses.length > 0) {
    console.log(c(C.yellow, `  ⚠️  不足: ${evaluation.weaknesses.join(" | ")}`));
  }

  if (evaluation._fallback) {
    console.log(c(C.yellow, `  ⚠️  注意: 此结果为降级评分（启发式规则），非 LLM 精确评分`));
  }

  console.log("");
}

// ============================================================
// 加载场景数据（用于 CLI 测试）
// ============================================================
function loadScenariosFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(c(C.red, `❌ 文件不存在: ${filePath}`));
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);

    if (Array.isArray(data)) {
      return data.map((item) => ({
        scenario: item.scenario || "未指定场景",
        replyContent: item.response || item.replyContent || "",
        relationInfo: item.relationInfo || null,
        expectedScore: item.score || item.expectedScore || null,
      }));
    }

    if (data.scenarios && Array.isArray(data.scenarios)) {
      return data.scenarios.map((item) => ({
        scenario: item.scenario || "未指定场景",
        replyContent: item.response || item.replyContent || "",
        relationInfo: item.relationInfo || null,
        expectedScore: item.score || item.expectedScore || null,
      }));
    }

    return [];
  } catch (e) {
    console.error(c(C.red, `❌ 文件解析失败: ${e.message}`));
    return [];
  }
}

// ============================================================
// CLI 入口
// ============================================================
async function main() {
  const args = process.argv.slice(2);

  // 检查 API Key
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error(c(C.red, "❌ DEEPSEEK_API_KEY 未配置，请检查 .env 文件"));
    process.exit(1);
  }

  // 解析 --batch 参数
  const batchIndex = args.indexOf("--batch");
  const compareIndex = args.indexOf("--compare");

  if (batchIndex !== -1 && args[batchIndex + 1]) {
    // 批量评分模式
    const filePath = path.resolve(args[batchIndex + 1]);
    console.log(c(C.bold, `\n📊 批量评分模式 — 数据源: ${filePath}`));

    const scenarios = loadScenariosFromFile(filePath);
    if (scenarios.length === 0) {
      console.error(c(C.red, "❌ 未找到有效的评分数据"));
      process.exit(1);
    }

    await batchEvaluate(scenarios);
    process.exit(0);
  }

  if (compareIndex !== -1 && args[compareIndex + 1]) {
    // 对比模式：人工 vs LLM 评分
    const filePath = path.resolve(args[compareIndex + 1]);
    console.log(c(C.bold, `\n🔬 对比模式 — 人工 vs LLM评分 — 数据源: ${filePath}`));

    const scenarios = loadScenariosFromFile(filePath);

    // 为每个条目添加人工评分（模拟，因为 seed-cases.json 没有人工评分字段）
    // 对于有 style 标签的，尝试根据风格分配参考分
    const labeledScenarios = scenarios.map((s, i) => {
      // 提取原始数据中的 style 信息
      const rawData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const item = Array.isArray(rawData) ? rawData[i] : null;
      const style = item?.style || "";
      const urgency = item?.urgency || "中";
      const importance = item?.importance || "中";

      // 基于启发式为不同风格设定参考分（模拟人工评分）
      let expectedScore = 17; // 默认中等偏上
      if (style === "委婉含蓄") expectedScore = 19;
      if (style === "直接坦诚") expectedScore = 16;
      if (style === "幽默轻松") expectedScore = 15;

      return { ...s, expectedScore };
    });

    console.log(c(C.dim, `  已标注 ${labeledScenarios.length} 个场景（模拟人工评分）`));
    console.log(c(C.yellow, `  ⚠️ 提示: 人工评分为模拟值，真实对比请使用 w2-three-versions-eval(1).md`));

    await batchEvaluate(labeledScenarios);
    process.exit(0);
  }

  // 单次评分模式
  const scenario = args.join(" ") || "我想拒绝朋友借钱但不想伤感情";

  console.log("");
  console.log(c(C.bold, "╔══════════════════════════════════════════════════════╗"));
  console.log(c(C.bold, "║     📊 ExpressCoach LLM-as-Judge 自动评分引擎 (Day 19)  ║"));
  console.log(c(C.bold, "║     5维度 × 5分制 = 25分总分                            ║"));
  console.log(c(C.bold, "╚══════════════════════════════════════════════════════╝"));
  console.log("");
  console.log(c(C.dim, `  场景: ${scenario}`));
  console.log("");

  try {
    // 步骤1: 关系分析（借用已有的 hybridAnalyze）
    let relationInfo = null;
    try {
      const { hybridAnalyze } = require("../relationship/analyze");
      const relationResult = await hybridAnalyze(scenario);
      if (relationResult.parsed) {
        relationInfo = relationResult.parsed;
        console.log(c(C.dim, `  👥 关系分析: ${relationInfo["关系类型"] || "未知"} | 敏感度: ${relationInfo["表达敏感度"] || "未知"}`));
      }
    } catch (e) {
      console.log(c(C.yellow, `  ⚠️ 关系分析跳过: ${e.message}`));
    }

    // 步骤2: 生成一个示例回复（借用三版本生成器的温和版）
    let replyContent = "";
    try {
      const { generateVersion } = require("../generate/three-versions");
      const version = await generateVersion(scenario, "mild", relationInfo);
      replyContent = version.parsed?.content || "";
      if (replyContent) {
        console.log(c(C.dim, `  📝 待评分回复: ${replyContent.substring(0, 60)}...`));
      }
    } catch (e) {
      // 如果生成失败，使用一个默认回复
      replyContent = "不好意思，我最近手头也比较紧，可能帮不上你的忙了，希望你能理解。";
      console.log(c(C.yellow, `  ⚠️ 回复生成跳过: ${e.message}，使用默认回复`));
    }

    // 步骤3: LLM-as-Judge 评分
    console.log("");
    console.log(c(C.dim, "  🔍 LLM-as-Judge 评分中..."));
    const evaluation = await evaluateReply(scenario, relationInfo, replyContent);

    // 打印结果
    printScoreCard(evaluation);

    // Day 19 完成标志检查
    console.log(c(C.bold, "Day 19 完成标志检查:"));
    console.log(c(C.dim, "  ☐ 单次评分正常输出5维度分数"), evaluation.scores ? c(C.green, " ✅") : c(C.red, " ❌"));
    console.log(c(C.dim, "  ☐ 总分在合理范围 (0-25)"), (evaluation.totalScore >= 0 && evaluation.totalScore <= 25) ? c(C.green, " ✅") : c(C.red, " ❌"));
    console.log(c(C.dim, "  ☐ JSON解析失败时正确降级"), evaluation._fallback ? c(C.green, " ✅ (已降级)") : c(C.dim, "  (未触发降级，这是好现象)"));
    console.log("");

  } catch (error) {
    console.error(c(C.red, `❌ 评分失败: ${error.message}`));
    console.error(error.stack);
    process.exit(1);
  }
}

// ============================================================
// 导出
// ============================================================
module.exports = { evaluateReply, batchEvaluate, fallbackScore, parseJudgeResponse, calculateCorrelation };

// 直接运行
if (require.main === module) {
  main();
}
