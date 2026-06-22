/**
 * 统一 API 模块 — src/lib/api.js (W4 Day 22)
 *
 * 封装三个国内大模型的调用，统一接口格式。
 *
 * 国内模型对标:
 *   DeepSeek  → 主力引擎 (已配置)     对标: GPT-4o 级别的推理能力
 *   Qwen/千问 → DashScope API (需注册)  对标: GPT-4o 的中文理解
 *   Kimi/月之暗面 → Moonshot API (需注册) 对标: Claude 的得体表达
 *
 * 每个函数统一返回: { content, tokens, duration }
 *
 * 用法:
 *   const { callDeepSeek, callQwen, callKimi } = require('./lib/api');
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

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
// API Key 配置
// ============================================================
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;     // 阿里云百炼 (千问)
const MOONSHOT_API_KEY  = process.env.MOONSHOT_API_KEY;      // 月之暗面 (Kimi)

// ============================================================
// 通用工具
// ============================================================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 通用 fetch 调用 (带重试)
 */
async function fetchWithRetry(url, options, maxRetries = 2, label = "API") {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.error(c(C.yellow, `  ⚠️ ${label} 重试 ${attempt}/${maxRetries}`));
        await sleep(1000 * attempt);
      }

      const t0 = performance.now();
      const response = await fetch(url, options);
      const elapsed = ((performance.now() - t0) / 1000);

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`${label} HTTP ${response.status}: ${err.substring(0, 200)}`);
      }

      const data = await response.json();
      return { data, elapsed };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

// ============================================================
// 1. DeepSeek API (已配置 ✅)
// ============================================================

async function callDeepSeek(systemPrompt, userInput, opts = {}) {
  const {
    temperature = 0.3,
    maxTokens = 800,
    model = "deepseek-chat",
  } = opts;

  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY 未配置，请在 .env 中设置");
  }

  const { data, elapsed } = await fetchWithRetry(
    "https://api.deepseek.com/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    },
    2,
    "DeepSeek"
  );

  return {
    content: data.choices[0].message.content,
    tokens: data.usage?.total_tokens || 0,
    duration: parseFloat(elapsed.toFixed(2)),
  };
}

// ============================================================
// 2. 通义千问 (DashScope / 阿里云百炼) 🆕
// ============================================================

async function callQwen(systemPrompt, userInput, opts = {}) {
  const {
    temperature = 0.3,
    maxTokens = 800,
    model = "qwen-plus",  // qwen-turbo(免费) / qwen-plus(性价比) / qwen-max(最强)
  } = opts;

  if (!DASHSCOPE_API_KEY) {
    throw new Error(
      "DASHSCOPE_API_KEY 未配置。\n" +
      "  注册地址: https://dashscope.aliyun.com/\n" +
      "  新用户有免费额度。获取 Key 后在 .env 中添加: DASHSCOPE_API_KEY=sk-xxx"
    );
  }

  const { data, elapsed } = await fetchWithRetry(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    },
    2,
    "Qwen/千问"
  );

  return {
    content: data.choices[0].message.content,
    tokens: data.usage?.total_tokens || 0,
    duration: parseFloat(elapsed.toFixed(2)),
  };
}

// ============================================================
// 3. Kimi / 月之暗面 (Moonshot API) 🆕
// ============================================================

async function callKimi(systemPrompt, userInput, opts = {}) {
  const {
    temperature = 0.3,
    maxTokens = 800,
    model = "moonshot-v1-8k",
  } = opts;

  if (!MOONSHOT_API_KEY) {
    throw new Error(
      "MOONSHOT_API_KEY 未配置。\n" +
      "  注册地址: https://platform.moonshot.cn/\n" +
      "  新用户有免费额度。获取 Key 后在 .env 中添加: MOONSHOT_API_KEY=sk-xxx"
    );
  }

  const { data, elapsed } = await fetchWithRetry(
    "https://api.moonshot.cn/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MOONSHOT_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    },
    2,
    "Kimi/月之暗面"
  );

  return {
    content: data.choices[0].message.content,
    tokens: data.usage?.total_tokens || 0,
    duration: parseFloat(elapsed.toFixed(2)),
  };
}

// ============================================================
// 4. 便捷函数: 检测哪些模型可用
// ============================================================

function getAvailableModels() {
  const models = {};

  if (DEEPSEEK_API_KEY) {
    models.deepseek = { name: "DeepSeek", call: callDeepSeek, configured: true };
  }
  if (DASHSCOPE_API_KEY) {
    models.qwen = { name: "通义千问(Qwen)", call: callQwen, configured: true };
  }
  if (MOONSHOT_API_KEY) {
    models.kimi = { name: "Kimi(月之暗面)", call: callKimi, configured: true };
  }

  return models;
}

function printAvailableModels() {
  const models = getAvailableModels();
  const available = Object.keys(models);

  console.log(c(C.bold, "\n📡 可用模型:"));
  if (available.length === 0) {
    console.log(c(C.red, "  ❌ 无可用模型！请在 .env 中配置至少一个 API Key"));
    return [];
  }

  for (const [key, info] of Object.entries(models)) {
    console.log(c(C.green, `  ✅ ${info.name} (${key})`));
  }

  // 提示未配置的
  const allKeys = ["deepseek", "qwen", "kimi"];
  const missing = allKeys.filter(k => !available.includes(k));
  if (missing.length > 0) {
    console.log(c(C.yellow, `\n  💡 还可以配置: ${missing.join(", ")}`));
    if (missing.includes("qwen")) {
      console.log(c(C.dim, "     千问注册: https://dashscope.aliyun.com/ (新用户免费)"));
    }
    if (missing.includes("kimi")) {
      console.log(c(C.dim, "     Kimi注册: https://platform.moonshot.cn/ (新用户免费)"));
    }
  }

  console.log("");
  return available;
}

// ============================================================
// 导出
// ============================================================
module.exports = {
  callDeepSeek,
  callQwen,
  callKimi,
  getAvailableModels,
  printAvailableModels,
};
