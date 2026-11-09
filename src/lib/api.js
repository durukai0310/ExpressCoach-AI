/**
 * 统一 API 模块 — src/lib/api.js (W4 Day 22 / OpenClaw 集成)
 *
 * 直接 HTTP 调用三个国内大模型，返回统一接口。
 * OpenClaw 集成点: 见 src/plugin.js (插件) 和 src/server.js (session store)
 *
 * 国内模型对标:
 *   DeepSeek  → 主力引擎           对标: GPT-4o 级别的推理能力
 *   Qwen/千问 → DashScope API       对标: GPT-4o 的中文理解
 *   Kimi/月之暗面 → Moonshot API   对标: Claude 的得体表达
 *
 * 每个函数统一返回: { content, tokens, duration }
 */

import { C, c } from "./color.js";

// ============================================================
// API Key 配置
// ============================================================
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;     // 阿里云百炼 (千问)
const MOONSHOT_API_KEY  = process.env.MOONSHOT_API_KEY;      // 月之暗面 (Kimi)
const GLM_API_KEY       = process.env.GLM_API_KEY;           // 智谱 GLM (主力引擎)

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
        console.error(c(C.yellow, `  [ ! ] ${label} 重试 ${attempt}/${maxRetries}`));
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
// 0. 智谱 GLM API (主力引擎 ✅) — OpenAI 兼容接口
// ============================================================

async function callGLM(systemPrompt, userInput, opts = {}) {
  const {
    temperature = 0.3,
    maxTokens = 800,
    model = "glm-5.3-flash",
  } = opts;

  if (!GLM_API_KEY) {
    throw new Error(
      "GLM_API_KEY 未配置。\n" +
      "  注册地址: https://open.bigmodel.cn/\n" +
      "  获取 Key 后在 .env 中添加: GLM_API_KEY=xxx"
    );
  }

  const { data, elapsed } = await fetchWithRetry(
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GLM_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput },
        ],
        temperature,
        max_tokens: maxTokens,
        // GLM-5.x 思考型模型: 推理档位 low, 防止思考烧光 max_tokens 导致 content 为空
        // (实测: 该模型用 reasoning_effort=low/high/max, 不支持 thinking.disabled)
        reasoning_effort: "low",
      }),
    },
    2,
    "GLM/智谱"
  );

  // 容错: 部分 GLM 模型把结果放在 reasoning_content, content 为空时回退
  const msg = data.choices[0].message;
  return {
    content: msg.content || msg.reasoning_content || "",
    tokens: data.usage?.total_tokens || 0,
    duration: parseFloat(elapsed.toFixed(2)),
  };
}

// ============================================================
// 统一调度: callLLM — 按 MODEL 环境变量选择模型，缺省自动回退
// 优先级: MODEL 指定 > glm > deepseek > qwen > kimi
// ============================================================

const PROVIDERS = () => ({
  glm:      { name: "GLM(智谱)",      call: callGLM,      key: GLM_API_KEY },
  deepseek: { name: "DeepSeek",       call: callDeepSeek, key: DEEPSEEK_API_KEY },
  qwen:     { name: "通义千问(Qwen)", call: callQwen,     key: DASHSCOPE_API_KEY },
  kimi:     { name: "Kimi(月之暗面)", call: callKimi,     key: MOONSHOT_API_KEY },
});

function resolveProvider() {
  const providers = PROVIDERS();
  const wanted = (process.env.MODEL || "").toLowerCase().trim();
  if (wanted && providers[wanted]?.key) return { id: wanted, ...providers[wanted] };
  for (const id of ["glm", "deepseek", "qwen", "kimi"]) {
    if (providers[id].key) return { id, ...providers[id] };
  }
  return null;
}

/**
 * 统一 LLM 调用入口 — 所有核心模块应调用此函数而非具体厂商函数
 * 容错策略: 主力模型认证失败(401/403)或网络错误时，自动回退到其他已配置的模型
 */
async function callLLM(systemPrompt, userInput, opts = {}) {
  const providers = PROVIDERS();
  const wanted = (process.env.MODEL || "").toLowerCase().trim();
  const order = wanted && providers[wanted]?.key
    ? [wanted, ...["glm", "deepseek", "qwen", "kimi"].filter(k => k !== wanted)]
    : ["glm", "deepseek", "qwen", "kimi"];

  const configured = order.filter(id => providers[id].key);
  if (configured.length === 0) {
    throw new Error(
      "未配置任何 LLM API Key。请在 .env 中至少配置一个:\n" +
      "  GLM_API_KEY (推荐, https://open.bigmodel.cn/)\n" +
      "  DEEPSEEK_API_KEY (https://platform.deepseek.com/)"
    );
  }

  let lastError = null;
  for (const id of configured) {
    try {
      return await providers[id].call(systemPrompt, userInput, opts);
    } catch (error) {
      lastError = error;
      const isAuth = /401|403|令牌|验证|Unauthorized/i.test(error.message);
      // 认证失败 → 直接换下一个模型；其他错误 → 也尝试下一个（该模型已内部重试过）
      console.error(c(C.yellow, `  [ ! ] ${providers[id].name} 调用失败${isAuth ? "(认证失败)" : ""}，尝试下一个可用模型`));
    }
  }
  throw lastError;
}

// ============================================================
// 1. DeepSeek API (备用引擎)
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

  if (GLM_API_KEY) {
    models.glm = { name: "GLM(智谱)", call: callGLM, configured: true };
  }
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

  console.log(c(C.bold, "\n  可用模型:"));
  if (available.length === 0) {
    console.log(c(C.red, "  [ !! ] 无可用模型！请在 .env 中配置至少一个 API Key"));
    return [];
  }

  for (const [key, info] of Object.entries(models)) {
    console.log(c(C.green, `  [ ok ] ${info.name} (${key})`));
  }

  // 提示未配置的
  const allKeys = ["glm", "deepseek", "qwen", "kimi"];
  const missing = allKeys.filter(k => !available.includes(k));
  if (missing.length > 0) {
    console.log(c(C.yellow, `\n  还可以配置: ${missing.join(", ")}`));
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
export {
  callLLM,
  callGLM,
  callDeepSeek,
  callQwen,
  callKimi,
  getAvailableModels,
  printAvailableModels,
};
