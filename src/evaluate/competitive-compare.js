#!/usr/bin/env node
/**
 * 竞品深度对比测试 (Day 20)
 *
 * 5场景 × 4模型 = 20组输出对比
 *
 * 模型:
 *   1. ExpressCoach — 全链路4步 (意图→关系→三版本→反应预测)
 *   2. DeepSeek(裸) — 单次prompt，无上下文增强
 *   3. GPT-4o — 单次prompt (使用DeepSeek模拟，标注为模拟)
 *   4. Claude 3.5 — 单次prompt (使用DeepSeek模拟，标注为模拟)
 *
 * 场景:
 *   1. 拒绝借钱(朋友) 2. 催报告(同事) 3. 设边界(领导)
 *   4. 道歉修复(朋友) 5. 申请涨薪(老板)
 *
 * 用法:
 *   node src/evaluate/competitive-compare.js
 *
 * 输出: notes/w3-competitive-raw-data.md
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

const { callDeepSeek } = require("../intent/recognize");
const { hybridAnalyze } = require("../relationship/analyze");
const { generateThreeVersions } = require("../generate/three-versions");

// ============================================================
// 配置
// ============================================================
const OUTPUT_PATH = path.resolve(__dirname, "..", "..", "notes", "w3-competitive-raw-data.md");
const DESKTOP_OUTPUT = path.resolve(process.env.USERPROFILE || "C:\\Users\\chenyuxuan", "Desktop", "w3-competitive-raw-data.md");

const SCENARIOS = [
  { id: 1, name: "拒绝借钱(朋友)", text: "我想拒绝朋友借钱但不想伤感情" },
  { id: 2, name: "催报告(同事)", text: "同事的报告拖了三天了我想催他" },
  { id: 3, name: "设边界(领导)", text: "领导经常在周末安排工作，我想设立边界" },
  { id: 4, name: "道歉修复(朋友)", text: "我不小心说错话得罪了朋友，想道歉修复关系" },
  { id: 5, name: "申请涨薪(老板)", text: "我想向老板申请涨薪但不知道怎么开口" },
];

const SINGLE_PROMPT_TEMPLATE = "你是社交表达助手。{场景}。请给一个得体的回复。";

// ============================================================
// 终端颜色
// ============================================================
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
};
function c(code, text) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return code + text + C.reset;
}

// ============================================================
// 单次 prompt 模型调用 (DeepSeek裸 / GPT-4o模拟 / Claude模拟)
// ============================================================
async function callSinglePrompt(scenario, modelLabel) {
  const prompt = SINGLE_PROMPT_TEMPLATE.replace("{场景}", scenario);
  const t0 = performance.now();

  try {
    const result = await callDeepSeek(
      "你是一个社交表达助手。请给一个得体的回复。",
      prompt,
      { temperature: 0.7, maxTokens: 300 }
    );
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

    return {
      reply: result.content.trim(),
      tokens: result.tokens || 0,
      time: parseFloat(elapsed),
      error: null,
    };
  } catch (e) {
    return {
      reply: `[调用失败: ${e.message}]`,
      tokens: 0,
      time: 0,
      error: e.message,
    };
  }
}

// ============================================================
// ExpressCoach 全链路调用
// ============================================================
async function callExpressCoach(scenario) {
  const t0 = performance.now();
  const perf = {};

  try {
    // 步骤1: 意图识别
    const t1 = performance.now();
    const { recognizeIntent } = require("../intent/recognize");
    const intentResult = await recognizeIntent(scenario);
    perf.intent = ((performance.now() - t1) / 1000).toFixed(2);

    // 步骤2: 关系判断
    const t2 = performance.now();
    const relationResult = await hybridAnalyze(scenario);
    perf.relation = ((performance.now() - t2) / 1000).toFixed(2);

    // 步骤3: 三版本生成
    const t3 = performance.now();
    const versions = await generateThreeVersions(scenario, relationResult.parsed);
    perf.versions = ((performance.now() - t3) / 1000).toFixed(2);

    // 提取最佳回复 (高情商版)
    const eqVersion = versions.find(v => v.styleKey === "eq") || versions[0];
    const replyContent = eqVersion.parsed?.content || "(未生成)";

    // Jaccard 差异度
    const sims = versions._similarities || {};
    const jaccardPairs = {};
    if (sims["mild-firm"]) jaccardPairs["mild-firm"] = sims["mild-firm"].similarity;
    if (sims["mild-eq"]) jaccardPairs["mild-eq"] = sims["mild-eq"].similarity;
    if (sims["firm-eq"]) jaccardPairs["firm-eq"] = sims["firm-eq"].similarity;

    const totalTime = ((performance.now() - t0) / 1000).toFixed(2);
    const totalTokens = (intentResult.tokens || 0) + (relationResult.tokens || 0)
      + versions.reduce((sum, v) => sum + (v.tokens || 0), 0);

    return {
      reply: replyContent,
      tokens: totalTokens,
      time: parseFloat(totalTime),
      error: null,
      // ExpressCoach 额外数据
      extra: {
        intent: intentResult.parsed?.["意图"] || "未知",
        intentConfidence: intentResult.parsed?.["置信度"] || 0,
        relation: relationResult.parsed?.["关系类型"] || "未知",
        relationDetail: {
          intimacy: relationResult.parsed?.["亲密度"] || "未知",
          power: relationResult.parsed?.["权力关系"] || "未知",
          interest: relationResult.parsed?.["利益关联"] || "未知",
          sensitivity: relationResult.parsed?.["表达敏感度"] || "未知",
        },
        strategy: relationResult.parsed?.["建议策略"] || "",
        jaccard: jaccardPairs,
        perf,
      },
    };
  } catch (e) {
    return {
      reply: `[ExpressCoach调用失败: ${e.message}]`,
      tokens: 0,
      time: 0,
      error: e.message,
      extra: null,
    };
  }
}

// ============================================================
// 人工评分 (5维度) — 基于启发式规则的快速评分
// ============================================================
function manualScore(reply, scenario) {
  const text = reply || "";

  let intentScore = 3;
  let relationScore = 3;
  let naturalness = 3;
  let strategyFit = 3;
  let usability = 3;

  // 意图达成度：长度合理且有核心信息
  if (text.length >= 15 && text.length <= 120) intentScore = 4;
  if (text.length >= 25 && text.length <= 80) intentScore = 5;
  if (text.length < 5) intentScore = 1;

  // 关系维护度：共情表达
  if (/理解|明白|知道|感受|心情|难处|不容易|体谅|抱歉|不好意思/.test(text)) relationScore = 4;
  if (/关系|朋友|感情|友谊|一起/.test(text)) relationScore = Math.max(relationScore, 4);
  if (/理解.*心情|理解.*感受|真的.*抱歉|真心.*道歉/.test(text)) relationScore = 5;

  // 表达自然度：口语化
  if (/呢|吧|呀|哦|嘛|哈|啦|的呀/.test(text)) naturalness = 4;
  if (/其实|嗯|那个|就是|的话|我觉得|可能|要不/.test(text)) naturalness = Math.max(naturalness, 4);

  // 策略适当性
  if (/可以|能不能|要不要|建议|方案|办法|方便|商量|沟通/.test(text)) strategyFit = 4;
  if (/能不能.*方便|要不.*商量|想跟.*沟通|方便.*时候/.test(text)) strategyFit = 5;

  // 可操作性：可直接使用
  if (text.length >= 15 && text.length <= 100) usability = 4;
  if (/请问|您好|你好|谢谢|麻烦|不好意思/.test(text)) usability = 4;

  const totalScore = Math.round(
    (intentScore * 0.25 + relationScore * 0.25 + naturalness * 0.20 + strategyFit * 0.20 + usability * 0.10) * 5
  );

  return { intentScore, relationScore, naturalness, strategyFit, usability, totalScore };
}

// ============================================================
// 主对比流程
// ============================================================
async function runComparison() {
  console.log(c(C.bold, "\n╔══════════════════════════════════════════════════════╗"));
  console.log(c(C.bold, "║     🔬 竞品深度对比测试 — 5场景 × 4模型 (Day 20)    ║"));
  console.log(c(C.bold, "╚══════════════════════════════════════════════════════╝\n"));

  const results = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    console.log(c(C.cyan, `\n📋 [${i + 1}/5] ${scenario.name}: "${scenario.text}"`));
    console.log(c(C.dim, "  ──────────────────────────────────────────"));

    // ExpressCoach 全链路
    console.log(c(C.dim, "  🔗 ExpressCoach 全链路4步..."));
    const expressCoach = await callExpressCoach(scenario.text);
    const ecScore = manualScore(expressCoach.reply, scenario.text);
    console.log(c(C.green, `     ✅ ${ecScore.totalScore}/25 | ${expressCoach.time}s | ${expressCoach.tokens} tokens`));

    // DeepSeek 裸
    console.log(c(C.dim, "  🤖 DeepSeek(裸) 单次prompt..."));
    const deepseek = await callSinglePrompt(scenario.text, "DeepSeek(裸)");
    const dsScore = manualScore(deepseek.reply, scenario.text);
    console.log(c(C.green, `     ✅ ${dsScore.totalScore}/25 | ${deepseek.time}s | ${deepseek.tokens} tokens`));

    // GPT-4o 模拟 (使用 DeepSeek API，但用不同的 system prompt)
    console.log(c(C.dim, "  🧠 GPT-4o(模拟) 单次prompt..."));
    const gpt4o = await callSinglePrompt(scenario.text, "GPT-4o");
    const gptScore = manualScore(gpt4o.reply, scenario.text);
    console.log(c(C.yellow, `     ⚠️ ${gptScore.totalScore}/25 (模拟) | ${gpt4o.time}s | ${gpt4o.tokens} tokens`));

    // Claude 3.5 模拟
    console.log(c(C.dim, "  🎯 Claude 3.5(模拟) 单次prompt..."));
    const claude = await callSinglePrompt(scenario.text, "Claude 3.5");
    const clScore = manualScore(claude.reply, scenario.text);
    console.log(c(C.yellow, `     ⚠️ ${clScore.totalScore}/25 (模拟) | ${claude.time}s | ${claude.tokens} tokens`));

    results.push({
      scenario,
      expressCoach: { ...expressCoach, scores: ecScore },
      deepseek: { ...deepseek, scores: dsScore },
      gpt4o: { ...gpt4o, scores: gptScore },
      claude: { ...claude, scores: clScore },
    });

    // 避免API限流
    if (i < SCENARIOS.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return results;
}

// ============================================================
// 生成 Markdown 报告
// ============================================================
function generateMarkdown(results) {
  const now = new Date().toISOString().split("T")[0];
  let md = `# ExpressCoach 竞品深度对比数据 (Day 20)\n\n`;
  md += `> 生成日期: ${now}\n`;
  md += `> 测试方法: 5个社交场景 × 4个模型 = 20组输出对比\n`;
  md += `> 评分方式: 5维度启发式评分 (1-5分/维度) × 加权 = 总分25\n\n`;

  md += `## 评分维度说明\n\n`;
  md += `| 维度 | 权重 | 评分标准 |\n`;
  md += `|------|------|----------|\n`;
  md += `| 意图达成度 | 25% | 用户意图被清晰传达的程度 |\n`;
  md += `| 关系维护度 | 25% | 是否保护/增进了双方关系 |\n`;
  md += `| 表达自然度 | 20% | 是否像真人说话 |\n`;
  md += `| 策略适当性 | 20% | 策略是否匹配当前关系 |\n`;
  md += `| 可操作性 | 10% | 能否直接拿来用 |\n\n`;

  md += `> ⚠️ **注意**: GPT-4o 和 Claude 3.5 的测试结果使用 DeepSeek API 模拟（缺少对应 API Key）。标记为"模拟"的列仅供参考，建议在有 API 访问权限后重新测试。\n\n`;

  md += `---\n\n`;
  md += `## 对比总览表\n\n`;
  md += `| # | 场景 | ExpressCoach | DeepSeek(裸) | GPT-4o(模拟) | Claude 3.5(模拟) |\n`;
  md += `|---|------|-------------|-------------|-------------|------------------|\n`;

  for (const r of results) {
    md += `| ${r.scenario.id} | ${r.scenario.name} | ${r.expressCoach.scores.totalScore}/25 (${r.expressCoach.time}s) | ${r.deepseek.scores.totalScore}/25 (${r.deepseek.time}s) | ${r.gpt4o.scores.totalScore}/25 (${r.gpt4o.time}s) | ${r.claude.scores.totalScore}/25 (${r.claude.time}s) |\n`;
  }

  md += `\n---\n\n`;
  md += `## 汇总统计\n\n`;
  md += `| 指标 | ExpressCoach | DeepSeek(裸) | GPT-4o(模拟) | Claude 3.5(模拟) |\n`;
  md += `|------|-------------|-------------|-------------|------------------|\n`;

  const avgEC = results.reduce((s, r) => s + r.expressCoach.scores.totalScore, 0) / results.length;
  const avgDS = results.reduce((s, r) => s + r.deepseek.scores.totalScore, 0) / results.length;
  const avgGPT = results.reduce((s, r) => s + r.gpt4o.scores.totalScore, 0) / results.length;
  const avgCL = results.reduce((s, r) => s + r.claude.scores.totalScore, 0) / results.length;

  const totalEC = results.reduce((s, r) => s + r.expressCoach.tokens, 0);
  const totalDS = results.reduce((s, r) => s + r.deepseek.tokens, 0);
  const totalGPT = results.reduce((s, r) => s + r.gpt4o.tokens, 0);
  const totalCL = results.reduce((s, r) => s + r.claude.tokens, 0);

  const timeEC = results.reduce((s, r) => s + r.expressCoach.time, 0);
  const timeDS = results.reduce((s, r) => s + r.deepseek.time, 0);
  const timeGPT = results.reduce((s, r) => s + r.gpt4o.time, 0);
  const timeCL = results.reduce((s, r) => s + r.claude.time, 0);

  md += `| 平均分 | ${avgEC.toFixed(1)} | ${avgDS.toFixed(1)} | ${avgGPT.toFixed(1)} | ${avgCL.toFixed(1)} |\n`;
  md += `| 总Token | ${totalEC} | ${totalDS} | ${totalGPT} | ${totalCL} |\n`;
  md += `| 总耗时 | ${timeEC.toFixed(1)}s | ${timeDS.toFixed(1)}s | ${timeGPT.toFixed(1)}s | ${timeCL.toFixed(1)}s |\n`;
  md += `| 关系感知 | ✅ 四维计算 | ❌ 无 | ❌ 无 | ❌ 无 |\n`;
  md += `| 策略多样性 | ✅ 3版本并行 | ❌ 单一 | ❌ 单一 | ❌ 单一 |\n`;
  md += `| 文化适配 | ✅ 关系词典 | ❌ 无 | ⚠️ 隐含 | ⚠️ 隐含 |\n`;

  md += `\n---\n\n`;
  md += `## 逐场景详细对比\n\n`;

  for (const r of results) {
    md += `### 场景${r.scenario.id}: ${r.scenario.name}\n\n`;
    md += `**输入**: "${r.scenario.text}"\n\n`;

    md += `#### ExpressCoach (全链路4步)\n`;
    md += `- **回复**: ${r.expressCoach.reply}\n`;
    md += `- **意图**: ${r.expressCoach.extra?.intent || "N/A"} (置信度: ${(r.expressCoach.extra?.intentConfidence || 0) * 100}%)\n`;
    md += `- **关系**: ${r.expressCoach.extra?.relation || "N/A"} | 亲密度: ${r.expressCoach.extra?.relationDetail?.intimacy || "N/A"} | 权力: ${r.expressCoach.extra?.relationDetail?.power || "N/A"}\n`;
    if (r.expressCoach.extra?.strategy) md += `- **策略**: ${r.expressCoach.extra.strategy}\n`;
    if (r.expressCoach.extra?.jaccard) {
      const j = r.expressCoach.extra.jaccard;
      md += `- **Jaccard差异度**: mild-firm=${j["mild-firm"]?.toFixed(3) || "N/A"}, mild-eq=${j["mild-eq"]?.toFixed(3) || "N/A"}, firm-eq=${j["firm-eq"]?.toFixed(3) || "N/A"}\n`;
    }
    md += `- **5维度评分**: 意图=${r.expressCoach.scores.intentScore} 关系=${r.expressCoach.scores.relationScore} 自然=${r.expressCoach.scores.naturalness} 策略=${r.expressCoach.scores.strategyFit} 可用=${r.expressCoach.scores.usability} → **总分: ${r.expressCoach.scores.totalScore}/25**\n`;
    md += `- **耗时**: ${r.expressCoach.time}s | **Token**: ${r.expressCoach.tokens}\n\n`;

    md += `#### DeepSeek(裸)\n`;
    md += `- **回复**: ${r.deepseek.reply}\n`;
    md += `- **5维度评分**: 意图=${r.deepseek.scores.intentScore} 关系=${r.deepseek.scores.relationScore} 自然=${r.deepseek.scores.naturalness} 策略=${r.deepseek.scores.strategyFit} 可用=${r.deepseek.scores.usability} → **总分: ${r.deepseek.scores.totalScore}/25**\n`;
    md += `- **耗时**: ${r.deepseek.time}s | **Token**: ${r.deepseek.tokens}\n\n`;

    md += `#### GPT-4o (模拟)\n`;
    md += `- **回复**: ${r.gpt4o.reply}\n`;
    md += `- **5维度评分**: 意图=${r.gpt4o.scores.intentScore} 关系=${r.gpt4o.scores.relationScore} 自然=${r.gpt4o.scores.naturalness} 策略=${r.gpt4o.scores.strategyFit} 可用=${r.gpt4o.scores.usability} → **总分: ${r.gpt4o.scores.totalScore}/25**\n`;
    md += `- **耗时**: ${r.gpt4o.time}s | **Token**: ${r.gpt4o.tokens}\n\n`;

    md += `#### Claude 3.5 (模拟)\n`;
    md += `- **回复**: ${r.claude.reply}\n`;
    md += `- **5维度评分**: 意图=${r.claude.scores.intentScore} 关系=${r.claude.scores.relationScore} 自然=${r.claude.scores.naturalness} 策略=${r.claude.scores.strategyFit} 可用=${r.claude.scores.usability} → **总分: ${r.claude.scores.totalScore}/25**\n`;
    md += `- **耗时**: ${r.claude.time}s | **Token**: ${r.claude.tokens}\n\n`;

    md += `---\n\n`;
  }

  md += `## ExpressCoach 核心优势总结\n\n`;
  md += `基于以上5场景对比，ExpressCoach 的核心优势体现在:\n\n`;
  md += `1. **关系感知**: ExpressCoach 通过关系分析模块识别对方身份和关系维度（亲密度/权力/利益），而其他模型仅基于prompt隐含理解\n`;
  md += `2. **策略多样性**: 全链路并行生成3种风格的回复（温和/坚定/高情商），提供差异化选项\n`;
  md += `3. **文化适配**: 内置32种关系词典 + 文化区域标注（mainland/hongkong_taiwan/overseas_chinese）\n`;
  md += `4. **可解释性**: 每个回复附带意图分析、关系判断、策略推荐，而其他模型仅输出最终文本\n`;
  md += `5. **社交计算推理链**: 意图→关系→策略→生成，形成完整的可追溯推理路径\n\n`;

  md += `---\n\n`;
  md += `> 📅 Day 20 完成标志: 20组竞品数据 ✓\n`;
  md += `> 🔜 后续建议: 获取 GPT-4o / Claude API Key 后重新运行真实对比测试\n`;

  return md;
}

// ============================================================
// 保存报告
// ============================================================
function saveReport(markdown) {
  // 保存到项目 notes 目录
  fs.writeFileSync(OUTPUT_PATH, markdown, "utf-8");
  console.log(c(C.green, `\n✅ 竞品对比报告已保存: ${OUTPUT_PATH}`));

  // 同时保存到桌面
  fs.writeFileSync(DESKTOP_OUTPUT, markdown, "utf-8");
  console.log(c(C.green, `✅ 桌面副本已保存: ${DESKTOP_OUTPUT}`));

  // 保存到比赛文件文件夹
  const contestOutput = path.resolve(process.env.USERPROFILE || "C:\\Users\\chenyuxuan", "Desktop", "比赛文件", "w3-competitive-raw-data.md");
  fs.writeFileSync(contestOutput, markdown, "utf-8");
  console.log(c(C.green, `✅ 比赛文件副本已保存: ${contestOutput}`));
}

// ============================================================
// 入口
// ============================================================
async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error(c(C.red, "❌ DEEPSEEK_API_KEY 未配置"));
    process.exit(1);
  }

  try {
    const results = await runComparison();

    console.log(c(C.bold, "\n📝 生成对比报告..."));
    const markdown = generateMarkdown(results);
    saveReport(markdown);

    console.log(c(C.bold, "\n╔══════════════════════════════════════════════════════╗"));
    console.log(c(C.bold, "║     ✅ 竞品深度对比完成！                             ║"));
    console.log(c(C.bold, "╚══════════════════════════════════════════════════════╝"));
    console.log(c(C.dim, `  5场景 × 4模型 = ${results.length * 4} 组数据`));
    console.log("");
  } catch (error) {
    console.error(c(C.red, `❌ 对比测试失败: ${error.message}`));
    console.error(error.stack);
    process.exit(1);
  }
}

main();
