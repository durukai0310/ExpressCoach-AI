/**
 * M1 意图识别模块 — recognize.js (Day 23 升级: 多标签分类)
 *
 * 职责:
 *   1. recognizeIntent(scenario) — 调用 LLM (DeepSeek) 识别意图（多标签）
 *   2. fallbackRecognize(scenario) — LLM 失败时用关键词词典兜底（多标签）
 *
 * 支持的 5 种主意图 (来自 SOUL.md):
 *   - 拒绝 (Refuse)
 *   - 催促 (Urge)
 *   - 反馈 (Feedback)
 *   - 设边界 (Set Boundary)
 *   - 求助 (Ask for Help)
 *
 * 辅助意图类型:
 *   - 维护关系, 征求意见, 表达关心, 确立规则, 修复关系,
 *     展示价值, 谈判协商, 信息收集
 *
 * Day 23 升级: 单意图 → 多标签 {主意图, 辅助意图[], 置信度}
 */

const fs = require("fs");
const path = require("path");
// dotenv 已由 index.js 加载

const { callDeepSeek } = require("../lib/api");
const { C, color } = require("../lib/color");
const { parseResponse } = require("../lib/parse");
const { loadFile } = require("../lib/fs-utils");

// ============================================================
// 配置
// ============================================================
const INTENT_SOUL = path.resolve(__dirname, "..", "..", "SOUL.md");
const INTENT_RULES_PATH = path.resolve(__dirname, "..", "..", "data", "intent-rules.json");

// ============================================================
// Day 23: 多标签意图归一化
// ============================================================

/**
 * normalizeIntentResult: 将 LLM 返回的意图结果归一化为多标签格式
 *
 * 输入格式兼容:
 *   旧格式: { 意图: '拒绝', 置信度: 0.95 }
 *   新格式: { 主意图: '拒绝', 辅助意图: ['求助'], 置信度: 0.85 }
 *   SOUL.md格式: { 意图: '拒绝', 辅助意图: [...], 置信度: 0.85 }
 *
 * 输出 (统一格式):
 *   {
 *     意图: '拒绝',        // 向后兼容 (等同于主意图)
 *     主意图: '拒绝',       // 新增字段
 *     辅助意图: [...],      // 数组，可能为空
 *     置信度: 0.85,
 *     分析: '...'
 *   }
 */
function normalizeIntentResult(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;

  const result = { ...parsed };

  // 1. 统一主意图: 意图 ↔ 主意图
  if (result["主意图"] && !result["意图"]) {
    result["意图"] = result["主意图"];
  } else if (result["意图"] && !result["主意图"]) {
    result["主意图"] = result["意图"];
  }

  // 2. 确保辅助意图是数组
  if (!result["辅助意图"]) {
    result["辅助意图"] = [];
  }
  if (!Array.isArray(result["辅助意图"])) {
    // 如果是字符串，转为单元素数组
    result["辅助意图"] = [result["辅助意图"]];
  }

  // 3. 去重辅助意图 (排除与主意图重复的)
  const primaryIntent = result["主意图"] || result["意图"] || "";
  result["辅助意图"] = result["辅助意图"].filter(
    (s) => s && s !== primaryIntent
  );

  // 4. 确保置信度是数字
  if (typeof result["置信度"] === "string") {
    result["置信度"] = parseFloat(result["置信度"]) || 0.5;
  }
  if (result["置信度"] === undefined || result["置信度"] === null) {
    result["置信度"] = 0.5;
  }

  return result;
}

// ============================================================
// 步骤1: 意图识别 (LLM)
// ============================================================

async function recognizeIntent(scenario) {
  const soulContent = loadFile(INTENT_SOUL, "SOUL.md (意图识别)");
  if (!soulContent) {
    console.error(color(C.yellow, "  ⚠️ SOUL.md 加载失败，降级到关键词兜底"));
    return fallbackRecognize(scenario);
  }

  try {
    const { content } = await callDeepSeek(soulContent, scenario, {
      temperature: 0.1,
      maxTokens: 300,
    });
    const result = parseResponse(content);

    // Day 11 Review: LLM 返回解析失败时 → 降级到规则兜底
    if (!result) {
      console.error(color(C.yellow, "  ⚠️ LLM 返回 JSON 解析失败，降级到关键词兜底"));
      return fallbackRecognize(scenario);
    }

    // Day 23: 归一化为多标签格式
    const normalized = normalizeIntentResult(result);

    return { raw: content, parsed: normalized };
  } catch (error) {
    // Day 11 Review: 断网/API 错误时 → 降级到规则兜底，不 crash
    console.error(color(C.yellow, `  ⚠️ LLM 调用失败 (${error.message})，降级到关键词兜底`));
    return fallbackRecognize(scenario);
  }
}

// ============================================================
// 兜底词典: fallbackRecognize (Day 8 新增)
// ============================================================

function loadIntentRules() {
  if (!fs.existsSync(INTENT_RULES_PATH)) {
    console.error(color(C.yellow, `  ⚠️ intent-rules.json 未找到: ${INTENT_RULES_PATH}`));
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(INTENT_RULES_PATH, "utf-8"));
  } catch (e) {
    console.error(color(C.yellow, `  ⚠️ intent-rules.json 解析失败: ${e.message}`));
    return null;
  }
}

/**
 * fallbackRecognize: 当 LLM 返回的 JSON 解析失败时，
 * 使用 intent-rules.json 的关键词词典进行匹配并返回兜底结果。
 *
 * Day 23 升级: 支持多标签 → {主意图, 辅助意图[], 置信度}
 *
 * @param {string} scenario - 用户输入的社交场景描述
 * @returns {object} { raw: string, parsed: object }
 */
function fallbackRecognize(scenario) {
  const rules = loadIntentRules();

  // 默认兜底结果 (Day 23: 多标签格式)
  const defaultResult = {
    raw: JSON.stringify({ 主意图: "反馈", 辅助意图: [], 置信度: 0.3, 分析: "兜底词典默认匹配", 关键词匹配: [] }),
    parsed: normalizeIntentResult({
      "主意图": "反馈",
      "意图": "反馈",
      "辅助意图": [],
      "置信度": 0.3,
      "分析": "兜底词典默认匹配（场景信息不足）",
      "关键词匹配": [],
      "追问建议": "能否多描述一下您和对方的关系以及具体发生了什么事？"
    }),
  };

  if (!rules || !rules.intents) {
    console.error(color(C.yellow, "  ⚠️ 兜底词典不可用，返回默认结果"));
    return defaultResult;
  }

  // 遍历 5 种意图，计算关键词匹配分数 (支持多标签排序)
  const allMatches = [];

  for (const intent of rules.intents) {
    let score = 0;
    const matchedKeywords = [];

    // 匹配关键词 (权重 2)
    for (const kw of intent.keywords || []) {
      if (scenario.includes(kw)) {
        score += 2;
        matchedKeywords.push(kw);
      }
    }

    // 匹配典型句式 (权重 3 — 句式更精准)
    for (const pattern of intent.patterns || []) {
      // 提取句式中的关键词部分进行匹配
      const patternCore = pattern.replace(/[\.\.\.。…]+/g, "").replace(/[（）()]/g, "");
      if (patternCore.length >= 3 && scenario.includes(patternCore.substring(0, Math.min(6, patternCore.length)))) {
        score += 3;
      }
    }

    if (score > 0) {
      allMatches.push({ intent, score, matchedKeywords });
    }
  }

  // 按分数降序排序
  allMatches.sort((a, b) => b.score - a.score);

  // 如果没有任何匹配，返回默认结果
  if (allMatches.length === 0) {
    console.error(color(C.yellow, "  ⚠️ 关键词未匹配到任何意图，返回兜底默认结果"));
    return defaultResult;
  }

  // 主意图 = 最高分
  const primary = allMatches[0];

  // 辅助意图 = 分数 > 0 且非主意图的其他意图 (最多取2个)
  const secondaryMatches = allMatches.slice(1, 3).filter(m => m.score >= 2);
  const secondaryIntents = secondaryMatches.map(m => m.intent.name);

  // Day 23: 检测额外的辅助意图 (从场景关键词)
  const extraSecondaryIntents = detectExtraSecondaryIntents(scenario, primary.intent.name);
  for (const extra of extraSecondaryIntents) {
    if (!secondaryIntents.includes(extra)) {
      secondaryIntents.push(extra);
    }
  }

  // 根据匹配分数计算置信度 (最高 0.55 — 关键词匹配的结果始终不如 LLM 精确)
  const confidence = Math.min(0.55, primary.score / 12);

  const parsed = normalizeIntentResult({
    "主意图": primary.intent.name,
    "意图": primary.intent.name,
    "辅助意图": secondaryIntents,
    "置信度": Math.round(confidence * 100) / 100,
    "分析": `关键词兜底匹配: 主意图命中 ${primary.matchedKeywords.length} 个关键词，总分 ${primary.score}；辅助意图: ${secondaryIntents.join(", ") || "无"}`,
    "关键词匹配": primary.matchedKeywords,
  });

  if (confidence < 0.7) {
    parsed["追问建议"] = `场景信息有限，请确认您是否想要"${primary.intent.name}"？可以多描述一下具体情况吗？`;
  }

  return {
    raw: JSON.stringify(parsed),
    parsed,
  };
}

/**
 * Day 23 新增: 从场景中检测额外的辅助意图
 *
 * 基于关键词检测辅助意图类型:
 *   - 维护关系: 不想伤感情/保持关系/维持友谊/不想...
 *   - 征求意见: 怎么开口/该怎么说/怎么办/求建议
 *   - 表达关心: 关心/体谅/理解他的/为他好
 *   - 确立规则: 以后都/长期/规则/制度/约定
 *   - 修复关系: 和好/修复/挽回/道歉/弥补
 *   - 谈判协商: 商量/协商/讨论/折中/各退一步
 *   - 信息收集: 想知道/了解/打听/问问看/探探
 *   - 展示价值: 证明/展示/表现/能力/价值
 */
function detectExtraSecondaryIntents(scenario, primaryIntent) {
  const secondary = [];

  const patterns = {
    "维护关系": /不想伤感情|不想.*关系|保持关系|维持友谊|不想.*闹僵|不想.*得罪|顾及.*面子|别伤和气|注意.*方式/,
    "征求意见": /怎么开口|该怎么说|怎么办|求建议|指点|给个建议|帮我想想|怎么.*比较|什么方式/,
    "表达关心": /关心|体谅|理解他|为他好|顾虑|为.*着想|照顾.*感受|不想.*压力/,
    "确立规则": /以后都|长期|规则|制度|约定|下次|从今以后|定个|规矩|明确.*边界/,
    "修复关系": /和好|修复|挽回|道歉|弥补|缓和|改善关系|重建|恢复/,
    "谈判协商": /商量|协商|讨论.*方案|折中|各退一步|让步|妥协|条件|交换/,
    "信息收集": /想知道|了解.*情况|打听|问问看|探探|试探|确认一下|打听一下/,
    "展示价值": /证明|展示.*能力|表现|价值|认可|肯定|赞赏|成绩/,
  };

  for (const [label, regex] of Object.entries(patterns)) {
    if (label === primaryIntent) continue; // 不与主意图重复
    if (regex.test(scenario)) {
      secondary.push(label);
    }
  }

  return secondary.slice(0, 2); // 最多返回2个额外辅助意图
}

// ============================================================
// 导出
// ============================================================
module.exports = { recognizeIntent, fallbackRecognize, callDeepSeek, parseResponse, normalizeIntentResult, detectExtraSecondaryIntents };
