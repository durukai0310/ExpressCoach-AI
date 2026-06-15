/**
 * Coach Agent — 教练Agent (Day 15)
 *
 * 职责: 在旁监听对话，只在关键时刻介入
 * 介入触发条件:
 *   1. 用户明确求助（检测关键词: 帮帮我/怎么说/救命/不知道怎么说）
 *   2. 检测到语气问题（过软/过硬）
 *   3. 对话进入僵局（5轮无实质进展）
 *   4. 正常对话时静默旁观
 *
 * 使用 CommonJS 规范
 * System Prompt 硬编码在代码中（如果 soul/coach.md 不存在）
 */

const fs = require("fs");
const path = require("path");

// ============================================================
// 导入共用 API 工具（复用项目已有的 callDeepSeek）
// ============================================================
const { callDeepSeek } = require("../intent/recognize");

// ============================================================
// 配置
// ============================================================
const COACH_SOUL_PATH = path.resolve(__dirname, "..", "..", "soul", "coach.md");

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

## 输出格式

当需要介入时，输出:
{
  "should": true,
  "reason": "求助/语气过软/语气过硬/僵局",
  "suggestion": "具体的策略建议",
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
// 加载 System Prompt
// ============================================================
function loadCoachSoul() {
  if (fs.existsSync(COACH_SOUL_PATH)) {
    try {
      return fs.readFileSync(COACH_SOUL_PATH, "utf-8");
    } catch (e) {
      console.error(`  ⚠️ [Coach] soul/coach.md 读取失败，使用硬编码 System Prompt`);
    }
  }
  return HARDCODED_COACH_SYSTEM_PROMPT;
}

// ============================================================
// 关键词检测：用户是否明确求助
// ============================================================
const HELP_KEYWORDS = ["帮帮我", "怎么说", "救命", "不知道怎么说", "怎么办", "教我", "救救我", "help", "帮我"];

function detectHelpRequest(userMessage) {
  if (!userMessage) return false;
  return HELP_KEYWORDS.some((kw) => userMessage.includes(kw));
}

// ============================================================
// 语气检测：过软 / 过硬
// ============================================================
const SOFT_TONE_KEYWORDS = [
  "对不起对不起", "都是我的错", "我不好", "都怪我", "抱歉抱歉",
  "求你了", "行行好", "随便你", "你说什么就是什么",
];
const HARD_TONE_KEYWORDS = [
  "你他妈", "混蛋", "傻逼", "你不听我的", "你必须",
  "否则后果自负", "你给我听着", "最后一次警告",
];

function detectToneIssue(userMessage) {
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
// ============================================================
function jaccardSimilarity(textA, textB) {
  if (!textA || !textB) return 0;
  const setA = new Set(textA.split(""));
  const setB = new Set(textB.split(""));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// ============================================================
// 僵局检测：最近5轮用户发言 Jaccard 相似度是否过高
// ============================================================
function detectDeadlock(context) {
  const userMessages = context
    .filter((entry) => entry.role === "user")
    .slice(-5);

  if (userMessages.length < 5) return false;

  // 计算相邻用户消息的 Jaccard 相似度
  let highSimilarityCount = 0;
  for (let i = 1; i < userMessages.length; i++) {
    const sim = jaccardSimilarity(userMessages[i].content, userMessages[i - 1].content);
    if (sim > 0.5) highSimilarityCount++;
  }

  // 连续 5 轮中至少 3 对高度相似 → 僵局
  return highSimilarityCount >= 3;
}

// ============================================================
// CoachAgent 类
// ============================================================

class CoachAgent {
  constructor() {
    this.systemPrompt = loadCoachSoul();
    this.interventionCount = 0;
    this.lastInterventionRound = -3; // 初始化为-3，确保前几轮可以介入
  }

  /**
   * shouldIntervene: 判断是否应该介入
   * @param {Array} context - 共享上下文数组 [{role, content, timestamp}]
   * @returns {Object} {should, reason, suggestion}
   */
  async shouldIntervene(context) {
    const currentRound = context.length;
    const lastUserMsg = [...context].reverse().find((e) => e.role === "user");

    // ═══ 规则检测层（先跑，快速判断） ═══

    // 触发1: 用户明确求助
    const userMessage = lastUserMsg ? lastUserMsg.content : "";
    if (detectHelpRequest(userMessage)) {
      // 冷却期检查：求助信号无视冷却期
      this.lastInterventionRound = currentRound;
      this.interventionCount++;
      const result = await this._generateSuggestion(context, "求助");
      return result;
    }

    // 触发2: 语气问题
    const toneIssue = detectToneIssue(userMessage);
    if (toneIssue) {
      // 检查冷却期：上次介入后至少等 2 轮
      if (currentRound - this.lastInterventionRound < 2) {
        return { should: false, reason: "冷却期", suggestion: "" };
      }
      this.lastInterventionRound = currentRound;
      this.interventionCount++;
      const result = await this._generateSuggestion(context, `语气${toneIssue}`);
      return result;
    }

    // 触发3: 对话僵局
    if (detectDeadlock(context)) {
      if (currentRound - this.lastInterventionRound < 2) {
        return { should: false, reason: "冷却期", suggestion: "" };
      }
      this.lastInterventionRound = currentRound;
      this.interventionCount++;
      const result = await this._generateSuggestion(context, "僵局");
      return result;
    }

    // 触发4: 正常对话 → 静默旁观
    return { should: false, reason: "正常", suggestion: "" };
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
      .map((e) => `[${e.role === "user" ? "用户" : "对方"}] ${e.content}`)
      .join("\n");

    const prompt = `当前对话历史:
${contextStr}

触发原因: ${triggerReason}

请判断是否需要介入，如果需要请给出具体建议。`;

    try {
      const result = await callDeepSeek(this.systemPrompt, prompt, {
        temperature: 0.3,
        maxTokens: 400,
      });

      const parsed = this._parseResponse(result.content);
      if (parsed && parsed.should !== undefined) {
        return parsed;
      }
    } catch (e) {
      console.error(`  ⚠️ [Coach] LLM 调用失败: ${e.message}`);
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
        suggestion: "建议先确认对方的核心关切，再用'我理解你的立场，同时我希望...'的句式表达自己的需求。",
      },
      "语气过软": {
        should: true,
        reason: "语气过软",
        suggestion: "你的表达可以更坚定一些。使用'我希望/我需要/我的底线是'等句式，不要过度让步。",
      },
      "语气过硬": {
        should: true,
        reason: "语气过硬",
        suggestion: "建议放缓语气。可以先用'我理解你的处境'表达共情，再提出你的诉求，避免让对方感到被攻击。",
      },
      "僵局": {
        should: true,
        reason: "对话僵局",
        suggestion: "对话似乎陷入了重复循环。建议换个角度切入：先认可对方的感受，再提出新的解决方案，或者暂时搁置争议、约定下次再谈。",
      },
    };
    return suggestions[triggerReason] || { should: false, reason: "正常", suggestion: "" };
  }

  /**
   * _parseResponse: 解析 LLM 返回的 JSON
   */
  _parseResponse(raw) {
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

  /**
   * reset: 重置教练状态
   */
  reset() {
    this.interventionCount = 0;
    this.lastInterventionRound = -3;
  }
}

// ============================================================
// 导出
// ============================================================
module.exports = { CoachAgent, detectHelpRequest, detectToneIssue, detectDeadlock };
