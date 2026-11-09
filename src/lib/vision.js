/**
 * 聊天截图识别模块 — src/lib/vision.js
 *
 * 用途: 从聊天截图中抽取结构化对话（谁说了什么、按时间顺序），
 *       供分析管线做"前文衔接"——生成的回复要接得上这段对话。
 *
 * 技术: GLM glm-4v-flash 视觉模型（免费档，实测可用）
 *       一次调用同时完成: 文字识别 + 说话人区分 + 顺序还原
 *
 * 返回: {
 *   turns:    [{ role: "对方"|"我"|"未知", text: "..." }, ...],  // 按时间顺序
 *   rawText:  "识别到的完整文本",
 *   summary:  "一句话概括对话内容",
 *   model:    "glm-4v-flash"
 * }
 */

const GLM_API_KEY = process.env.GLM_API_KEY;
const VISION_MODEL = process.env.GLM_VISION_MODEL || "glm-4v-flash";

const EXTRACT_SYSTEM = `你是聊天记录解析专家。用户会发给你一张聊天截图（微信/QQ/钉钉/iMessage 等任意界面），你需要把对话内容结构化还原。

判断规则：
1. 【最重要】先看每条气泡在图片里的左右位置：左侧气泡记 side="left"，右侧气泡记 side="right"。只按视觉位置判断，不要按"对话一来一回"的规律猜测。同一侧连续出现多条消息是完全正常的。
2. 严格按对话出现的先后顺序输出，不要跳过任何一条消息。
3. 表情包/图片/语音/链接卡片如无文字内容，输出为 [表情包] / [图片] / [语音] 等占位。聊天记录卡片（转发的多条历史消息合并卡片）概括为一行，如 [聊天记录: 主题]。
4. 如果是群聊，无法区分发送者时 side 写 "unknown"，并在 text 开头标注昵称，如 "小张: xxx"。
5. 【重要】微信等客户端会在一条消息正下方显示灰色小字的自动翻译（常见为纯英文行）。翻译行不是独立消息——与上方原文合并为一条（只保留原文），绝对不要单独列为一条消息。

必须严格按照以下 JSON 格式输出（键名必须是 turns/side/text/summary，不要用其他键名），不要输出任何其他文字：
{
  "turns": [{"side": "left", "text": "消息内容"}, {"side": "right", "text": "消息内容"}],
  "summary": "一句话概括这段对话在聊什么（20字内）"
}`;

/**
 * 兼容多种模型返回的字段名，归一为 {role, text}
 * 优先按视觉方位映射: right→我, left→对方（比模型直接猜 role 更可靠）
 */
function normalizeTurns(obj) {
  const raw =
    obj.turns || obj.对话 || obj.messages || obj.chat || obj.dialogue || obj.conversations || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      const side = String(t.side ?? t.位置 ?? t.position ?? "").toLowerCase();
      const roleRaw = t.role ?? t.人物 ?? t.speaker ?? t.sender ?? t.from ?? "";
      const text = t.text ?? t.内容 ?? t.content ?? t.message ?? t.msg ?? "";

      let role;
      if (side === "right") role = "我";
      else if (side === "left") role = "对方";
      else if (side === "unknown") role = "群成员";
      else role = ["对方", "我", "未知", "群成员"].includes(roleRaw) ? roleRaw : "未知";

      return { role, text: String(text).trim() };
    })
    .filter((t) => t.text);
}

/**
 * 过滤微信自动翻译行：紧跟在中文消息后的纯英文长句（含空格）大概率是翻译，
 * 不是独立消息。提示词已要求模型合并，但模型遵守不可靠，这里服务端兜底。
 */
function filterTranslationLines(turns) {
  return turns.filter((t, i) => {
    if (i === 0) return true;
    const isPureAsciiSentence =
      /^[\x00-\x7F\s]+$/.test(t.text) && t.text.length > 8 && /\s/.test(t.text.trim());
    const prevHasCJK = /[一-鿿]/.test(turns[i - 1].text);
    return !(isPureAsciiSentence && prevHasCJK);
  });
}

/**
 * 从聊天截图抽取结构化对话
 * @param {string} imageDataUrl - data:image/png;base64,xxx 格式
 * @returns {Promise<{turns: Array, rawText: string, summary: string, model: string}>}
 */
export async function extractChatFromImage(imageDataUrl) {
  if (!GLM_API_KEY) {
    throw new Error("未配置 GLM_API_KEY，无法识别图片");
  }
  if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
    throw new Error("图片格式无效，请上传 PNG/JPG 截图");
  }

  const body = {
    model: VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl } },
          { type: "text", text: EXTRACT_SYSTEM },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 1000,
  };

  const resp = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GLM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`视觉模型调用失败 HTTP ${resp.status}: ${errText.slice(0, 160)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";

  // 提取 JSON（容忍 ```json 包裹与多余文字）
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { /* fallthrough */ }
    }
  }

  const turns = filterTranslationLines(parsed ? normalizeTurns(parsed) : []);

  if (turns.length === 0) {
    // 降级: 把识别到的文本整体返回，仍然有用
    return {
      turns: [],
      rawText: content.replace(/```json|```/g, "").trim(),
      summary: "",
      model: VISION_MODEL,
    };
  }

  return {
    turns,
    rawText: turns.map((t) => `${t.role}: ${t.text}`).join("\n"),
    summary: String(parsed.summary || parsed.概括 || ""),
    model: VISION_MODEL,
  };
}

/**
 * 把结构化对话折叠为分析管线的场景文本（前文衔接的关键）
 *
 * @param {Array} turns - extractChatFromImage 的 turns
 * @param {string} userIntent - 用户的诉求（可空）
 * @param {string} summary - 对话概括（可空）
 * @returns {string} 融合后的场景描述
 */
export function buildChatScenario(turns, userIntent = "", summary = "") {
  const lines = turns.map((t) => `${t.role}: ${t.text}`).join("\n");
  let s = "";
  if (summary) s += `【对话概括】${summary}\n`;
  s += `【对话上文】\n${lines}\n`;
  s += `【任务】请作为"我"，生成接在上述对话后面的下一条回复。`;
  s += `回复必须衔接上文的语气和内容，是聊天中自然发出的一条消息（不是书信，不要重复上文已说过的话）。`;
  if (userIntent && userIntent.trim()) {
    s += `\n【你的诉求】${userIntent.trim()}`;
  }
  return s;
}
