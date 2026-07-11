/**
 * M1 意图识别模块 — recognize.js (Day 23 升级: 多标签分类)
 *
 * 职责:
 *   1. recognizeIntent(scenario) — 调用 LLM (DeepSeek) 识别意图（多标签）
 *   2. fallbackRecognize(scenario) — LLM 失败时用关键词词典兜底（多标签）
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { callDeepSeek } from "../lib/api.js";
import { C, color } from "../lib/color.js";
import { parseResponse } from "../lib/parse.js";
import { loadFile } from "../lib/fs-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 配置
// ============================================================
const INTENT_SOUL = path.resolve(__dirname, "..", "..", "SOUL.md");
const INTENT_RULES_PATH = path.resolve(__dirname, "..", "..", "data", "intent-rules.json");

// ============================================================
// Day 23: 多标签意图归一化
// ============================================================

function normalizeIntentResult(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;

  const result = { ...parsed };

  if (result["主意图"] && !result["意图"]) {
    result["意图"] = result["主意图"];
  } else if (result["意图"] && !result["主意图"]) {
    result["主意图"] = result["意图"];
  }

  if (!result["辅助意图"]) {
    result["辅助意图"] = [];
  }
  if (!Array.isArray(result["辅助意图"])) {
    result["辅助意图"] = [result["辅助意图"]];
  }

  const primaryIntent = result["主意图"] || result["意图"] || "";
  result["辅助意图"] = result["辅助意图"].filter(
    (s) => s && s !== primaryIntent
  );

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
    console.error(color(C.yellow, "  [ ! ] SOUL.md 加载失败，降级到关键词兜底"));
    return fallbackRecognize(scenario);
  }

  try {
    const { content } = await callDeepSeek(soulContent, scenario, {
      temperature: 0.1,
      maxTokens: 300,
    });
    const result = parseResponse(content);

    if (!result) {
      console.error(color(C.yellow, "  [ ! ] LLM 返回 JSON 解析失败，降级到关键词兜底"));
      return fallbackRecognize(scenario);
    }

    const normalized = normalizeIntentResult(result);

    return { raw: content, parsed: normalized };
  } catch (error) {
    console.error(color(C.yellow, `  [ ! ] LLM 调用失败 (${error.message})，降级到关键词兜底`));
    return fallbackRecognize(scenario);
  }
}

// ============================================================
// 兜底词典: fallbackRecognize
// ============================================================

function loadIntentRules() {
  if (!fs.existsSync(INTENT_RULES_PATH)) {
    console.error(color(C.yellow, `  [ ! ] intent-rules.json 未找到: ${INTENT_RULES_PATH}`));
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(INTENT_RULES_PATH, "utf-8"));
  } catch (e) {
    console.error(color(C.yellow, `  [ ! ] intent-rules.json 解析失败: ${e.message}`));
    return null;
  }
}

function fallbackRecognize(scenario) {
  const rules = loadIntentRules();

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
    console.error(color(C.yellow, "  [ ! ] 兜底词典不可用，返回默认结果"));
    return defaultResult;
  }

  const allMatches = [];

  for (const intent of rules.intents) {
    let score = 0;
    const matchedKeywords = [];

    for (const kw of intent.keywords || []) {
      if (scenario.includes(kw)) {
        score += 2;
        matchedKeywords.push(kw);
      }
    }

    for (const pattern of intent.patterns || []) {
      const patternCore = pattern.replace(/[\.\.\.。…]+/g, "").replace(/[（）()]/g, "");
      if (patternCore.length >= 3 && scenario.includes(patternCore.substring(0, Math.min(6, patternCore.length)))) {
        score += 3;
      }
    }

    if (score > 0) {
      allMatches.push({ intent, score, matchedKeywords });
    }
  }

  allMatches.sort((a, b) => b.score - a.score);

  if (allMatches.length === 0) {
    console.error(color(C.yellow, "  [ ! ] 关键词未匹配到任何意图，返回兜底默认结果"));
    return defaultResult;
  }

  const primary = allMatches[0];

  const secondaryMatches = allMatches.slice(1, 3).filter(m => m.score >= 2);
  const secondaryIntents = secondaryMatches.map(m => m.intent.name);

  const extraSecondaryIntents = detectExtraSecondaryIntents(scenario, primary.intent.name);
  for (const extra of extraSecondaryIntents) {
    if (!secondaryIntents.includes(extra)) {
      secondaryIntents.push(extra);
    }
  }

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
    if (label === primaryIntent) continue;
    if (regex.test(scenario)) {
      secondary.push(label);
    }
  }

  return secondary.slice(0, 2);
}

export { recognizeIntent, fallbackRecognize, callDeepSeek, parseResponse, normalizeIntentResult, detectExtraSecondaryIntents };
