/**
 * Simulator Agent — 模拟对方Agent (Day 15)
 *
 * 职责: 扮演对话中的对方
 * 支持三种性格:
 *   - friendly (友善): 理解、配合、积极回应
 *   - hostile  (刁难): 质疑、施压、不轻易退让
 *   - avoidant (回避): 不正面回应、转移话题、拖延
 *
 * 使用 CommonJS 规范
 * System Prompt 硬编码在代码中（如果 soul/simulator.md 不存在）
 */

const fs = require("fs");
const path = require("path");

// ============================================================
// 导入共用 API 工具
// ============================================================
const { callDeepSeek } = require("../intent/recognize");

// ============================================================
// 配置
// ============================================================
const SIMULATOR_SOUL_PATH = path.resolve(__dirname, "..", "..", "soul", "simulator.md");

// ============================================================
// 硬编码 System Prompt 模板（兜底：soul/simulator.md 不存在时使用）
// ============================================================

const PERSONALITY_PROMPTS = {
  friendly: `你正在扮演对话中的对方。你的性格是**友善型**。

性格特征:
- 你是一个善解人意、乐于配合的人
- 你会积极回应对方，愿意倾听和协商
- 你的语气温和、友好，偶尔带点幽默
- 即使不完全同意，你也会礼貌地表达不同意见
- 你会尝试寻找双方都能接受的方案

回复要求:
- 用自然的口语化的中文回复
- 保持友善但不要过度热情
- 回复长度在 20-80 字之间
- 只输出回复内容本身，不要添加前缀或说明`,

  hostile: `你正在扮演对话中的对方。你的性格是**刁难型**。

性格特征:
- 你对对方的要求持怀疑态度，不轻易配合
- 你会提出尖锐的问题、质疑对方的动机或方案
- 你的语气直接、坚定，偶尔带有不满
- 你觉得自己的立场更重要，不太愿意让步
- 你会指出对方要求中的不公平或不适之处

回复要求:
- 用自然的口语化的中文回复
- 保持刁难但不要进行人身攻击
- 回复长度在 20-80 字之间
- 只输出回复内容本身，不要添加前缀或说明`,

  avoidant: `你正在扮演对话中的对方。你的性格是**回避型**。

性格特征:
- 你不喜欢正面回应问题，倾向于转移话题或拖延
- 你可能会说"再说吧""我考虑考虑""到时候看情况"
- 你对直接冲突感到不适，选择回避而不是解决
- 你可能会用模糊的承诺来应付对方
- 你喜欢把决定推到未来，不愿当下做选择

回复要求:
- 用自然的口语化的中文回复
- 保持回避但不要完全沉默（必须回复）
- 回复长度在 15-60 字之间
- 只输出回复内容本身，不要添加前缀或说明`,
};

// ============================================================
// 加载 System Prompt（优先读文件，回退到硬编码）
// ============================================================
function loadSimulatorSoul(personality) {
  if (fs.existsSync(SIMULATOR_SOUL_PATH)) {
    try {
      const fileContent = fs.readFileSync(SIMULATOR_SOUL_PATH, "utf-8");
      // 文件中包含多种性格模板时，尝试按 "## 友善型" / "## 刁难型" 等分割
      const sectionMarker = {
        friendly: /##\s*友善型[\s\S]*?(?=##\s*|$)/,
        hostile: /##\s*刁难型[\s\S]*?(?=##\s*|$)/,
        avoidant: /##\s*回避型[\s\S]*?(?=##\s*|$)/,
      };
      const marker = sectionMarker[personality];
      if (marker) {
        const match = fileContent.match(marker);
        if (match) return match[0].trim();
      }
      // 如果文件存在但没有分节，使用整个文件内容
      return fileContent;
    } catch (e) {
      console.error(`  ⚠️ [Simulator] soul/simulator.md 读取失败，使用硬编码 System Prompt`);
    }
  }
  return PERSONALITY_PROMPTS[personality] || PERSONALITY_PROMPTS.friendly;
}

// ============================================================
// SimulatorAgent 类
// ============================================================

class SimulatorAgent {
  /**
   * @param {String} personality - "friendly" | "hostile" | "avoidant"
   */
  constructor(personality = "friendly") {
    this.personality = personality;
    this.systemPrompt = loadSimulatorSoul(personality);
  }

  /**
   * generateReply: 根据对话上下文生成对方回复
   * @param {Array} context - 共享上下文数组 [{role, content, timestamp}]
   * @param {String} userMessage - 用户最新消息
   * @returns {String} 模拟对方的回复
   */
  async generateReply(context, userMessage) {
    // 构建对话历史
    const historyStr = context
      .slice(-6)
      .map((e) => {
        const speaker = e.role === "user" ? "用户" : "对方（你）";
        return `${speaker}: ${e.content}`;
      })
      .join("\n");

    const prompt = `对话历史:
${historyStr}

用户最新消息: ${userMessage}

请以对方（${this._personalityLabel()}）的身份回复用户。`;

    try {
      const result = await callDeepSeek(this.systemPrompt, prompt, {
        temperature: 0.7,
        maxTokens: 200,
      });
      return result.content.trim();
    } catch (e) {
      console.error(`  ⚠️ [Simulator] LLM 调用失败: ${e.message}`);
      return this._fallbackReply(userMessage);
    }
  }

  /**
   * _fallbackReply: API 失败时的规则兜底回复
   */
  _fallbackReply(userMessage) {
    const fallbacks = {
      friendly: [
        "嗯，我理解你的意思，我们可以好好商量。",
        "好吧，我考虑一下你说的话。",
        "你说的有道理，我们再讨论讨论。",
      ],
      hostile: [
        "我不觉得这是个好主意，你凭什么这么要求？",
        "这对我有什么好处？我觉得不太公平。",
        "你说得轻巧，你有没有考虑过我的处境？",
      ],
      avoidant: [
        "这个嘛...以后再说吧。",
        "我现在不想谈这个，改天吧。",
        "让我再想想，到时候看情况。",
      ],
    };
    const replies = fallbacks[this.personality] || fallbacks.friendly;
    return replies[Math.floor(Math.random() * replies.length)];
  }

  /**
   * _personalityLabel: 性格标签（用于 prompt）
   */
  _personalityLabel() {
    return {
      friendly: "友善型",
      hostile: "刁难型",
      avoidant: "回避型",
    }[this.personality] || "友善型";
  }

  /**
   * setPersonality: 动态切换性格
   */
  setPersonality(personality) {
    if (["friendly", "hostile", "avoidant"].includes(personality)) {
      this.personality = personality;
      this.systemPrompt = loadSimulatorSoul(personality);
    }
  }
}

// ============================================================
// 导出
// ============================================================
module.exports = { SimulatorAgent, PERSONALITY_PROMPTS };
