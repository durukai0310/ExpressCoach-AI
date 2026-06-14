/**
 * M1 意图识别模块 — recognize.js (Day 8 重构)
 *
 * 职责:
 *   1. recognizeIntent(scenario) — 调用 LLM (DeepSeek) 识别意图
 *   2. fallbackRecognize(scenario) — LLM 失败时用关键词词典兜底
 *
 * 支持的 5 种意图 (来自 SOUL.md):
 *   - 拒绝 (Refuse)
 *   - 催促 (Urge)
 *   - 反馈 (Feedback)
 *   - 设边界 (Set Boundary)
 *   - 求助 (Ask for Help)
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

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

function color(colorCode, text) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return colorCode + text + C.reset;
}

// ============================================================
// 配置
// ============================================================
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const INTENT_SOUL = path.resolve(__dirname, "..", "..", "SOUL.md");
const INTENT_RULES_PATH = path.resolve(__dirname, "..", "..", "data", "intent-rules.json");

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

// ============================================================
// API 调用 (带重试)
// ============================================================

async function callDeepSeek(systemPrompt, userInput, opts = {}) {
  const {
    temperature = 0.1,
    maxTokens = 500,
    maxRetries = 2,
  } = opts;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }

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
        throw new Error(`DeepSeek API 错误 (${response.status}): ${err.substring(0, 200)}`);
      }

      const data = await response.json();
      return {
        content: data.choices[0].message.content,
        tokens: data.usage?.total_tokens || 0,
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        console.error(color(C.yellow, `  ⚠️ 重试 ${attempt + 1}/${maxRetries}: ${error.message}`));
      }
    }
  }

  throw lastError;
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

    return { raw: content, parsed: result };
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
 * @param {string} scenario - 用户输入的社交场景描述
 * @returns {object} { raw: string, parsed: object }
 */
function fallbackRecognize(scenario) {
  const rules = loadIntentRules();

  // 默认兜底结果
  const defaultResult = {
    raw: JSON.stringify({ 意图: "反馈", 置信度: 0.3, 分析: "兜底词典默认匹配", 关键词匹配: [] }),
    parsed: {
      "意图": "反馈",
      "置信度": 0.3,
      "分析": "兜底词典默认匹配（场景信息不足）",
      "关键词匹配": [],
      "追问建议": "能否多描述一下您和对方的关系以及具体发生了什么事？"
    },
  };

  if (!rules || !rules.intents) {
    console.error(color(C.yellow, "  ⚠️ 兜底词典不可用，返回默认结果"));
    return defaultResult;
  }

  // 遍历 5 种意图，计算关键词匹配分数
  let bestMatch = null;
  let bestScore = 0;

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

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { intent, score, matchedKeywords };
    }
  }

  // 如果没有任何匹配，返回默认结果
  if (!bestMatch || bestScore === 0) {
    console.error(color(C.yellow, "  ⚠️ 关键词未匹配到任何意图，返回兜底默认结果"));
    return defaultResult;
  }

  // 根据匹配分数计算置信度 (最高 0.55 — 关键词匹配的结果始终不如 LLM 精确)
  const confidence = Math.min(0.55, bestScore / 12);

  const parsed = {
    "意图": bestMatch.intent.name,
    "置信度": Math.round(confidence * 100) / 100,
    "分析": `关键词兜底匹配: 命中 ${bestMatch.matchedKeywords.length} 个关键词，总分 ${bestScore}`,
    "关键词匹配": bestMatch.matchedKeywords,
  };

  if (confidence < 0.7) {
    parsed["追问建议"] = `场景信息有限，请确认您是否想要"${bestMatch.intent.name}"？可以多描述一下具体情况吗？`;
  }

  return {
    raw: JSON.stringify(parsed),
    parsed,
  };
}

// ============================================================
// 导出
// ============================================================
module.exports = { recognizeIntent, fallbackRecognize, callDeepSeek, parseResponse };
