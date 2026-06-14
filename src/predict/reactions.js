/**
 * M5 社交反应预测模块 — reactions.js (Day 14 集成)
 *
 * 职责:
 *   1. predictReactions(scenario, selectedVersion, style) — 基于用户选择的回复版本,
 *      调用 DeepSeek + soul/predictor.md 预测对方可能产生的 3-5 种反应,
 *      提供概率评估和应对建议
 *
 * 支持的 5 种反应类型 (来自 predictor.md):
 *   - accept (接受): 对方同意请求或建议
 *   - hesitate (犹豫): 对方不确定,需要进一步考虑
 *   - reject (拒绝): 对方明确或委婉拒绝
 *   - emotional (情绪化): 对方带强烈情绪色彩
 *   - deflect (转移话题): 对方有意回避话题
 *
 * 用法: const { predictReactions } = require('./predict/reactions');
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

const { callDeepSeek } = require("../intent/recognize");

// ============================================================
// 配置
// ============================================================
const PREDICTOR_SOUL = path.resolve(__dirname, "..", "..", "soul", "predictor.md");
const PATTERNS_PATH = path.resolve(__dirname, "..", "..", "data", "reaction-patterns.json");

// ============================================================
// 工具函数
// ============================================================

function loadFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ ${label} 未找到: ${filePath}`);
    return null;
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
// 规则兜底: 基于关键词的简易反应预测
// ============================================================

function fallbackPredict(scenario, selectedVersion) {
  let patterns = null;
  try {
    if (fs.existsSync(PATTERNS_PATH)) {
      patterns = JSON.parse(fs.readFileSync(PATTERNS_PATH, "utf-8"));
    }
  } catch (e) {
    // 兜底文件不可用，使用内置规则
  }

  const combined = (selectedVersion || "") + " " + (scenario || "");
  const predictions = [];

  // 使用 reaction-patterns.json 中的 detection_rules，或内置兜底规则
  const rules = patterns?.detection_rules || {
    accept: ["好的", "可以", "没问题", "同意", "乐意", "OK", "行"],
    hesitate: ["可能", "大概", "也许", "考虑", "想想", "看看", "如果"],
    refuse: ["不行", "不能", "抱歉", "不好意思", "不方便", "没办法"],
    emotional: ["！", "？", "怎么能", "太过分", "简直", "啊", "呀"],
    deflect: ["对了", "说到", "顺便", "改天", "你呢"],
  };

  const typeLabels = {
    accept: "接受",
    hesitate: "犹豫",
    refuse: "拒绝",
    emotional: "情绪化",
    deflect: "转移话题",
  };

  for (const [type, keywords] of Object.entries(rules)) {
    let score = 0;
    for (const kw of keywords) {
      if (combined.includes(kw)) score++;
    }
    const probability = score >= 3 ? "high" : score >= 1 ? "medium" : "low";
    predictions.push({
      type: typeLabels[type] || type,
      probability,
      sample_response: `(规则兜底: ${type})`,
      counter_tip: "建议根据具体情况灵活应对",
    });
  }

  // 按概率排序
  const probOrder = { high: 3, medium: 2, low: 1 };
  predictions.sort((a, b) => (probOrder[b.probability] || 0) - (probOrder[a.probability] || 0));

  return {
    raw: JSON.stringify(predictions),
    parsed: predictions.slice(0, 4),
    source: "rule-fallback",
  };
}

// ============================================================
// 主函数: predictReactions
// ============================================================

/**
 * 预测对方对所选回复的可能反应
 *
 * @param {string} scenario - 用户输入的社交场景描述
 * @param {string} selectedVersion - 用户选择的回复版本内容
 * @param {string} style - 回复风格名称 (温和版/坚定版/高情商版)
 * @returns {object} { raw, parsed, error }
 */
async function predictReactions(scenario, selectedVersion, style) {
  const soulContent = loadFile(PREDICTOR_SOUL, "predictor.md");

  if (!soulContent) {
    console.warn("⚠️ predictor.md 加载失败，使用规则兜底预测");
    return fallbackPredict(scenario, selectedVersion);
  }

  const userInput = JSON.stringify({
    scenario: scenario,
    selected_version: selectedVersion,
    style: style,
  });

  try {
    const { content } = await callDeepSeek(soulContent, userInput, {
      temperature: 0.3,
      maxTokens: 500,
      maxRetries: 2,
    });

    const result = parseResponse(content);

    if (!result || !result.predictions) {
      console.warn(`⚠️ 解析预测结果失败，降级到规则兜底: ${(content || "").substring(0, 200)}`);
      const fallback = fallbackPredict(scenario, selectedVersion);
      return {
        ...fallback,
        raw: content,
        error: "LLM解析失败，使用规则兜底",
      };
    }

    return {
      raw: content,
      parsed: result.predictions,
      source: "LLM (DeepSeek + predictor.md)",
      error: null,
    };
  } catch (error) {
    console.error(`❌ 预测反应时发生错误: ${error.message}`);
    const fallback = fallbackPredict(scenario, selectedVersion);
    return {
      ...fallback,
      error: `LLM调用失败: ${error.message}，已降级到规则兜底`,
    };
  }
}

module.exports = { predictReactions, fallbackPredict };
