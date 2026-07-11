import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { callDeepSeek } from "../lib/api.js";
import { C, color } from "../lib/color.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Coach Agent — 教练Agent (Day 16 增强)
 *
 * 职责: 在旁监听对话，只在关键时刻介入
 *
 * Day 16 新增:
 *   - LLM 语气分析（最近3轮），关键词先跑快速筛选，LLM二次确认
 *   - 增强僵局检测（Jaccard > 0.5）
 *   - 4种介入触发条件的完善实现
 *
 * 介入触发条件:
 *   1. 用户明确求助（检测关键词: 帮帮我/怎么说/救命/不知道怎么说）→ 立即给具体建议
 *   2. 检测到语气问题（LLM判断最近3轮语气 → 过软提示坚定、过硬提示软化）
 *   3. 对话进入僵局（连续5轮重复立场，Jaccard相似度>0.5触发）→ 建议改变策略
 *   4. 正常对话时静默旁观
 *
 * 使用 CommonJS 规范
 * System Prompt 硬编码在代码中（如果 soul/coach.md 不存在）
 */

// ============================================================
// 导入共用 API 工具（复用项目已有的 callDeepSeek）
// ============================================================

// ============================================================
// 配置
// ============================================================
const COACH_SOUL_PATH = path.resolve(__dirname, "..", "soul", "coach.md");

// ============================================================
// 硬编码 System Prompt（兜底：soul/coach.md 不存在时使用）
// ============================================================
const HARDCODED_COACH_SYSTEM_PROMPT = `你是一位社交表达教练。你在旁听用户与对方的对话，但只在关键时刻介入。

你的职责不是替代用户表达，而是帮用户理解社交结构、给出策略建议、在用户即将"踩坑"时提醒。

## 介入规则

你只在以下 4 种情况下介入：

1. **用户明确求助**: 用户在对话中发出求助信号（帮帮我/怎么说/救命/不知道怎么说/怎么办）→ 立即给具体建议
2. **语气问题**: 用户表达语气过软（过度讨好/自我贬低）或过硬（攻击性/威胁性）→ 提示调整
3. **对话僵局**: 连续 5 轮双方重复立场无实质进展 → 建议改变策略
4. **正常对话**: 静默旁观，不发言

## 语气判断标准

- 过软特征: 频繁道歉、自我贬低、过度让步、请求式语气、"求你了""随便你""你说什么就是什么"
- 过硬特征: 命令式语气、威胁性措辞、不尊重对方、缺乏共情、"你必须""否则后果自负"

## 输出格式

当需要介入时，输出:
{
  "should": true,
  "reason": "求助/语气过软/语气过硬/僵局",
  "suggestion": "具体的策略建议（50-100字）",
  "example": "可以这样说的示例（可选）"
}

当不需要介入时，输出:
{
  "should": false,
  "reason": "正常",
  "suggestion": ""
}

注意: 只输出 JSON，不要输出其他内容。`;

// ============================================================
// 语气分析专用 System Prompt（Day 16 新增）
// ============================================================
const TONE_ANALYSIS_SYSTEM_PROMPT = `你是一位语言语气分析专家。你的任务是分析用户在对话中的语气。

## 分析维度
1. 语气强度: 过软（过度讨好/自我贬低/缺乏自信）/ 适中 / 过硬（攻击性/命令式/威胁性）
2. 情绪状态: 焦虑/愤怒/委屈/平静/自信
3. 社交风险: 低（不会伤害关系）/ 中（可能引起对方不适）/ 高（可能严重伤害关系）

## 输出格式
{
  "tone": "过软" | "适中" | "过硬",
  "emotion": "焦虑/愤怒/委屈/平静/自信",
  "risk": "低/中/高",
  "analysis": "一句话分析（20字以内）",
  "needsIntervention": true/false
}

注意: 只输出 JSON，不要输出其他内容。`;

// ============================================================
// 加载 System Prompt
// ============================================================
function loadCoachSoul() {
  if (fs.existsSync(COACH_SOUL_PATH)) {
    try {
      return fs.readFileSync(COACH_SOUL_PATH, "utf-8");
    } catch (e) {
      console.log(color(C.yellow, `  ⚠️ [Coach] soul/coach.md 读取失败，使用硬编码 System Prompt`));
    }
  }
  return HARDCODED_COACH_SYSTEM_PROMPT;
}

// ============================================================
// 关键词检测：用户是否明确求助（快速第一道过滤）
// ============================================================
const HELP_KEYWORDS = ["帮帮我", "怎么说", "救命", "不知道怎么说", "怎么办", "教我", "救救我", "help", "帮我", "怎么回", "不会说", "怎么表达"];

function detectHelpRequest(userMessage) {
  if (!userMessage) return false;
  return HELP_KEYWORDS.some((kw) => userMessage.includes(kw));
}

// ============================================================
// 关键词语气检测：过软 / 过硬（快速第一道过滤）
// Day 16: 关键词先跑作为快速筛选，LLM 二次确认
// ============================================================
const SOFT_TONE_KEYWORDS = [
  "对不起对不起", "都是我的错", "我不好", "都怪我", "抱歉抱歉",
  "求你了", "行行好", "随便你", "你说什么就是什么", "我错了",
  "是我的问题", "都怨我", "我不该", "我不配", "我没资格",
];
const HARD_TONE_KEYWORDS = [
  "你他妈", "混蛋", "傻逼", "你不听我的", "你必须",
  "否则后果自负", "你给我听着", "最后一次警告", "你算老几",
  "你懂什么", "你有什么资格", "我问你", "你凭什么",
];

function detectToneIssueByKeywords(userMessage) {
  if (!userMessage) return null;
  const msg = userMessage.toLowerCase();
  for (const kw of SOFT_TONE_KEYWORDS) {
    if (msg.includes(kw.toLowerCase())) return "过软";
  }
  for (const kw of HARD_TONE_KEYWORDS) {
    if (msg.includes(kw.toLowerCase())) return "过硬";
  }
  return null;
}

// ============================================================
// Jaccard 相似度计算（用于僵局检测）
// Day 16: 基于字符级和词级双重计算
// ============================================================
function jaccardSimilarity(textA, textB) {
  if (!textA || !textB) return 0;
  // 字符级 Jaccard
  const setA = new Set(textA.split(""));
  const setB = new Set(textB.split(""));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  const charJaccard = union.size === 0 ? 0 : intersection.size / union.size;

  // 词级 Jaccard（取平均）
  const wordsA = new Set(textA.split(/\s+|(?<=[一-龥])/));
  const wordsB = new Set(textB.split(/\s+|(?<=[一-龥])/));
  const wordIntersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
  const wordUnion = new Set([...wordsA, ...wordsB]);
  const wordJaccard = wordUnion.size === 0 ? 0 : wordIntersection.size / wordUnion.size;

  // 取字符级和词级 Jaccard 的最大值（更敏感地检测重复）
  return Math.max(charJaccard, wordJaccard);
}

// ============================================================
// 僵局检测：最近5轮用户发言 Jaccard 相似度是否过高
// Day 16: Jaccard > 0.5 触发僵局警告
// ============================================================
function detectDeadlock(context) {
  const userMessages = context
    .filter((entry) => entry.role === "user")
    .slice(-5);

  if (userMessages.length < 5) return false;

  // 计算相邻用户消息的 Jaccard 相似度
  let highSimilarityCount = 0;
  const similarities = [];
  for (let i = 1; i < userMessages.length; i++) {
    const sim = jaccardSimilarity(userMessages[i].content, userMessages[i - 1].content);
    similarities.push(sim);
    if (sim > 0.5) highSimilarityCount++;
  }

  // 连续 5 轮中至少 3 对高度相似 → 僵局（Day 16: 更严格的阈值）
  return highSimilarityCount >= 3;
}

/**
 * getDeadlockInfo: 获取僵局详情（Day 16 新增，用于日志）
 */
function getDeadlockInfo(context) {
  const userMessages = context
    .filter((entry) => entry.role === "user")
    .slice(-5);

  const similarities = [];
  for (let i = 1; i < userMessages.length; i++) {
    similarities.push(jaccardSimilarity(userMessages[i].content, userMessages[i - 1].content));
  }
  return {
    roundCount: userMessages.length,
    similarities,
    maxSimilarity: Math.max(...similarities, 0),
    avgSimilarity: similarities.reduce((a, b) => a + b, 0) / similarities.length,
  };
}

// ============================================================
// CoachAgent 类（Day 16 增强版）
// ============================================================

class CoachAgent {
  constructor() {
    this.systemPrompt = loadCoachSoul();
    this.interventionCount = 0;
    this.lastInterventionRound = -3; // 初始化为-3，确保前几轮可以介入
    this.interventionHistory = []; // Day 16: 记录介入历史
  }

  /**
   * shouldIntervene: 判断是否应该介入（Day 16 增强版 + W4 Day 24 情绪触发）
   *
   * 流程: 关键词快速检测 → LLM 二次确认 → 返回介入建议
   *
   * @param {Array} context - 共享上下文数组 [{role, content, timestamp}]
   * @param {Object} opts - W4 Day 24: 可选参数 {emotionDeteriorated: bool}
   * @returns {Object} {should, reason, suggestion, triggerType}
   */
  async shouldIntervene(context, opts = {}) {
    const currentRound = context.filter((e) => e.role === "user").length;
    const lastUserMsg = [...context].reverse().find((e) => e.role === "user");
    const userMessage = lastUserMsg ? lastUserMsg.content : "";

    // ═══════════════════════════════════════════════════════════
    // W4 Day 24: 触发5 — 情绪连续恶化检测
    // 情绪连续2轮恶化 → 触发紧急介入
    // ═══════════════════════════════════════════════════════════
    if (opts.emotionDeteriorated) {
      console.log(color(C.red, `     🚨 [Coach] 触发5: 情绪连续恶化！紧急介入`));
      this.lastInterventionRound = currentRound;
      this.interventionCount++;
      const result = {
        should: true,
        reason: "情绪恶化",
        suggestion: "我注意到你现在可能有点焦虑，要不要暂停一下？深呼吸，换个角度思考——对方可能不是有意让你不舒服的。试着先肯定对方的感受，再表达自己的需求。",
        example: "我理解你现在可能有压力，同时我想说的是...",
      };
      this._recordIntervention(currentRound, "情绪恶化", result);
      return result;
    }

    // ═══════════════════════════════════════════════════════════
    // 第一层: 关键词快速检测（Day 16: 先跑，快速判断）
    // ═══════════════════════════════════════════════════════════

    // 触发1: 用户明确求助 — 关键词检测
    const helpDetected = detectHelpRequest(userMessage);
    if (helpDetected) {
      console.log(color(C.dim, `     🔍 [Coach] 关键词检测: 求助信号 → "${userMessage.substring(0, 30)}..."`));
      // 求助信号无视冷却期，立即介入
      this.lastInterventionRound = currentRound;
      this.interventionCount++;
      const result = await this._generateSuggestion(context, "求助");
      this._recordIntervention(currentRound, "求助", result);
      return result;
    }

    // 触发2: 语气问题 — 关键词先跑
    const keywordTone = detectToneIssueByKeywords(userMessage);
    if (keywordTone) {
      console.log(color(C.dim, `     🔍 [Coach] 关键词检测: 语气${keywordTone} → LLM二次确认中...`));

      // Day 16: 冷却期检查（求助无视冷却期，语气检测需要冷却期）
      if (currentRound - this.lastInterventionRound < 2) {
        console.log(color(C.dim, `     ⏳ [Coach] 冷却期中（上次介入: 第${this.lastInterventionRound}轮），跳过`));
        return { should: false, reason: "冷却期", suggestion: "" };
      }

      // Day 16 新增: LLM 二次确认语气问题
      const llmToneResult = await this._analyzeToneWithLLM(context);
      if (llmToneResult && llmToneResult.needsIntervention) {
        console.log(color(C.yellow, `     ✅ [Coach] LLM确认: 语气${llmToneResult.tone}，需要介入`));
        this.lastInterventionRound = currentRound;
        this.interventionCount++;
        const result = await this._generateSuggestion(context, `语气${llmToneResult.tone}`);
        this._recordIntervention(currentRound, `语气${llmToneResult.tone}`, result);
        return result;
      } else if (llmToneResult) {
        console.log(color(C.dim, `     ℹ️ [Coach] LLM确认: 语气${llmToneResult.tone}，暂不需要介入`));
        return { should: false, reason: `关键词触发但LLM判断语气${llmToneResult.tone}，暂不介入`, suggestion: "" };
      }
      // LLM 失败时降级到关键词结果
      console.log(color(C.yellow, `     ⚠️ [Coach] LLM语气分析失败，使用关键词兜底`));
      this.lastInterventionRound = currentRound;
      this.interventionCount++;
      const fallbackResult = this._fallbackIntervention(`语气${keywordTone}`);
      this._recordIntervention(currentRound, `语气${keywordTone}(兜底)`, fallbackResult);
      return fallbackResult;
    }

    // 触发3: 对话僵局检测（Day 16: Jaccard > 0.5）
    if (detectDeadlock(context)) {
      const deadlockInfo = getDeadlockInfo(context);
      console.log(color(C.dim, `     🔍 [Coach] 僵局检测: Jaccard相似度 max=${deadlockInfo.maxSimilarity.toFixed(2)} avg=${deadlockInfo.avgSimilarity.toFixed(2)} > 0.5`));

      if (currentRound - this.lastInterventionRound < 2) {
        console.log(color(C.dim, `     ⏳ [Coach] 冷却期中，跳过僵局介入`));
        return { should: false, reason: "冷却期", suggestion: "" };
      }

      this.lastInterventionRound = currentRound;
      this.interventionCount++;
      const result = await this._generateSuggestion(context, "僵局");
      this._recordIntervention(currentRound, "僵局", result);
      return result;
    }

    // 触发4: 正常对话 → 静默旁观
    return { should: false, reason: "正常", suggestion: "" };
  }

  /**
   * _analyzeToneWithLLM: 使用 LLM 分析最近3轮对话的语气（Day 16 新增）
   * @param {Array} context - 共享上下文
   * @returns {Object|null} {tone, emotion, risk, analysis, needsIntervention}
   */
  async _analyzeToneWithLLM(context) {
    const recentContext = context.slice(-6); // 最近3轮（每轮2条消息）
    const contextStr = recentContext
      .map((e) => `[${e.role === "user" ? "用户" : "对方"}] ${e.content}`)
      .join("\n");

    const prompt = `请分析以下对话中用户最近一轮的语气:

${contextStr}

请从语气强度、情绪状态、社交风险三个维度分析用户的最新表达。`;

    try {
      const result = await callDeepSeek(TONE_ANALYSIS_SYSTEM_PROMPT, prompt, {
        temperature: 0.1,
        maxTokens: 200,
      });

      return this._parseResponse(result.content);
    } catch (e) {
      console.log(color(C.yellow, `     ⚠️ [Coach] LLM语气分析调用失败: ${e.message}`));
      return null;
    }
  }

  /**
   * _generateSuggestion: 使用 LLM 生成具体建议（二次确认）
   * @param {Array} context - 共享上下文
   * @param {String} triggerReason - 触发原因
   * @returns {Object} {should, reason, suggestion}
   */
  async _generateSuggestion(context, triggerReason) {
    // 构建最近的对话历史摘要
    const recentContext = context.slice(-6);
    const contextStr = recentContext
      .map((e) => `[${e.role === "user" ? "用户" : (e.role === "simulator" ? "对方" : e.role)}] ${e.content}`)
      .join("\n");

    const prompt = `当前对话历史:
${contextStr}

触发原因: ${triggerReason}

请判断是否需要介入，如果需要请给出具体建议（50-100字）。`;

    try {
      const result = await callDeepSeek(this.systemPrompt, prompt, {
        temperature: 0.3,
        maxTokens: 500,
      });

      const parsed = this._parseResponse(result.content);
      if (parsed && parsed.should !== undefined) {
        return parsed;
      }
    } catch (e) {
      console.log(color(C.yellow, `     ⚠️ [Coach] LLM 调用失败: ${e.message}，使用规则兜底`));
    }

    // LLM 失败时使用规则兜底
    return this._fallbackIntervention(triggerReason);
  }

  /**
   * _fallbackIntervention: LLM 失败时的规则兜底介入
   */
  _fallbackIntervention(triggerReason) {
    const suggestions = {
      "求助": {
        should: true,
        reason: "用户求助",
        suggestion: "建议先确认对方的核心关切，再用'我理解你的立场，同时我希望...'的句式表达自己的需求。可以先共情再提出自己的诉求。",
        example: "我理解你最近手头也紧，同时我最近也有一些安排，这次可能帮不上忙了。",
      },
      "语气过软": {
        should: true,
        reason: "语气过软",
        suggestion: "你的表达可以更坚定一些。使用'我希望/我需要/我的底线是'等句式，不要过度让步。让对方知道你的立场是明确的。",
        example: "我理解你的情况，但我的底线是...希望我们能找到一个双方都能接受的方案。",
      },
      "语气过硬": {
        should: true,
        reason: "语气过硬",
        suggestion: "建议放缓语气。可以先用'我理解你的处境'表达共情，再提出你的诉求，避免让对方感到被攻击。强硬不等于有效。",
        example: "我理解你的立场，同时我也想说一下我的想法...你觉得这样可以吗？",
      },
      "僵局": {
        should: true,
        reason: "对话僵局",
        suggestion: "对话似乎陷入了重复循环。建议换个角度切入：先认可对方的感受，再提出新的解决方案，或者暂时搁置争议、约定下次再谈。",
        example: "我觉得我们可能都需要再想想，要不我们改天再聊这个话题？",
      },
    };
    return suggestions[triggerReason] || { should: false, reason: "正常", suggestion: "" };
  }

  /**
   * _recordIntervention: 记录介入历史（Day 16 新增）
   */
  _recordIntervention(round, reason, result) {
    this.interventionHistory.push({
      round,
      reason,
      suggestion: result.suggestion,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * _parseResponse: 解析 LLM 返回的 JSON
   */
  _parseResponse(raw) {
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

  /**
   * getInterventionStats: 获取介入统计（Day 16 新增）
   */
  getInterventionStats() {
    const reasons = {};
    for (const entry of this.interventionHistory) {
      reasons[entry.reason] = (reasons[entry.reason] || 0) + 1;
    }
    return {
      total: this.interventionCount,
      history: this.interventionHistory,
      breakdown: reasons,
    };
  }

  /**
   * reset: 重置教练状态
   */
  reset() {
    this.interventionCount = 0;
    this.lastInterventionRound = -3;
    this.interventionHistory = [];
  }
}

// ============================================================
// 导出
// ============================================================
export { CoachAgent, detectHelpRequest, detectToneIssueByKeywords, detectDeadlock, getDeadlockInfo, jaccardSimilarity };