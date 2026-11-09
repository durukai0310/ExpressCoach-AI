/**
 * 统一 JSON 解析模块 — src/lib/parse.js (W5 Day 31)
 *
 * 从各模块提取的公共 JSON 解析函数。
 * 支持: 纯 JSON / markdown 代码块 / 花括号包裹的 JSON
 */

/**
 * 从 LLM 原始返回中提取 JSON 对象
 *
 * 按顺序尝试:
 *   1. 直接 JSON.parse
 *   2. 提取 markdown ```json ... ``` 代码块
 *   3. 提取最外层花括号 {...}
 *
 * @param {string} raw - LLM 原始返回文本
 * @returns {object|null} 解析成功返回对象，失败返回 null
 */
export function parseResponse(raw) {
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
