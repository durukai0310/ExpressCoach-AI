/**
 * M4 三版本并行生成引擎 (Day 10)
 * 从 index.js 提取 generateVersion() 和 generateThreeVersions()
 *
 * 新增功能:
 *  - Jaccard 文本相似度检查 → 任一组 > 0.7 → temperature + 0.2 → 重试 (最多3次)
 *  - 差异度日志记录
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
const SOUL_DIR = path.resolve(__dirname, "..", "..", "soul");

const GENERATOR_SOULS = {
  mild: path.join(SOUL_DIR, "generator-mild.md"),
  firm: path.join(SOUL_DIR, "generator-firm.md"),
  eq: path.join(SOUL_DIR, "generator-eq.md"),
};

const VERSION_META = {
  mild: { name: "温和版", icon: "🕊️", tag: "关系维护优先" },
  firm: { name: "坚定版", icon: "🛡️", tag: "立场明确优先" },
  eq: { name: "高情商版", icon: "🎯", tag: "双赢导向" },
};

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
// Day 10 新增: Jaccard 文本相似度计算
// ============================================================

/**
 * 计算两段文本的 Jaccard 相似度
 * 分词策略: 中文按字切分 + 去重 + 忽略标点
 */
function jaccardSimilarity(textA, textB) {
  const tokenize = (text) => {
    // 中文按字切分 + 过滤空白和常见标点
    const cleaned = text.replace(/[，。！？、；：""''（）\s\r\n]/g, "");
    const chars = [];
    for (const c of cleaned) {
      chars.push(c);
    }
    return new Set(chars);
  };

  const setA = tokenize(textA);
  const setB = tokenize(textB);

  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

// ============================================================
// Day 10 新增: 差异度检查 + 自动重试
// ============================================================

/**
 * 检查三版本的生成质量:
 * 1. 计算三组两两 Jaccard 相似度
 * 2. 任一组 > MAX_SIMILARITY → 标记为"趋同"
 * 3. 趋同版本用更高 temperature 重新生成 (最多重试 MAX_RETRY 次)
 */
const MAX_SIMILARITY = 0.7;   // Jaccard 相似度阈值
const MAX_RETRY = 3;           // 最大重试次数
const RETRY_TEMP_BOOST = 0.2;  // 重试时 temperature 增量

function calculatePairwiseSimilarities(versions) {
  const keys = Object.keys(versions);
  const similarities = {};

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const keyA = keys[i];
      const keyB = keys[j];
      const textA = versions[keyA].parsed?.content || "";
      const textB = versions[keyB].parsed?.content || "";
      const sim = jaccardSimilarity(textA, textB);
      const pairKey = `${keyA}-${keyB}`;
      similarities[pairKey] = {
        similarity: sim,
        isTooSimilar: sim > MAX_SIMILARITY,
        textA: textA.substring(0, 60),
        textB: textB.substring(0, 60),
      };
    }
  }

  return similarities;
}

/**
 * 找出哪些 style 需要重试 (在任意一组 pair 中参与且该 pair 相似度过高)
 */
function findStylesToRetry(similarities) {
  const stylesToRetry = new Set();
  for (const [pairKey, result] of Object.entries(similarities)) {
    if (result.isTooSimilar) {
      const [a, b] = pairKey.split("-");
      stylesToRetry.add(a);
      stylesToRetry.add(b);
    }
  }
  return Array.from(stylesToRetry);
}

// ============================================================
// 单版本生成
// ============================================================

async function generateVersion(scenario, styleKey, relationshipInfo, retryCount = 0) {
  const soulPath = GENERATOR_SOULS[styleKey];
  const soulContent = loadFile(soulPath, `SOUL.md (${VERSION_META[styleKey].name})`);
  if (!soulContent) throw new Error(`${VERSION_META[styleKey].name} SOUL.md 加载失败`);

  const meta = VERSION_META[styleKey];

  // 构建融入关系判断结果的 prompt
  let prompt = `请为以下社交场景生成${meta.name}的回复:\n\n"${scenario}"`;

  if (relationshipInfo) {
    const r = relationshipInfo;
    prompt += `\n\n【关系分析参考】`;
    prompt += `\n- 关系类型: ${r["关系类型"] || "未知"}`;
    prompt += `\n- 亲密度: ${r["亲密度"] || "一般"}`;
    prompt += `\n- 权力关系: ${r["权力关系"] || "不明"}`;
    prompt += `\n- 利益关联: ${r["利益关联"] || "纯情感"}`;
    prompt += `\n- 表达敏感度: ${r["表达敏感度"] || "中敏感"}`;
    prompt += `\n- 建议策略: ${r["建议策略"] || "保持礼貌和真诚"}`;
    prompt += `\n- 注意事项: ${r["注意事项"] || "避免伤害对方感情"}`;
    prompt += `\n\n请基于以上关系分析，调整你的表达策略，但保持你自身的风格定位。`;
  }

  prompt += `\n\n请严格按照 SOUL.md 中定义的 JSON 格式输出，不要输出其他内容。`;

  const temperature = 0.8 + retryCount * RETRY_TEMP_BOOST;

  const { content, tokens } = await callDeepSeek(soulContent, prompt, {
    temperature,
    maxTokens: 500,
  });

  const parsed = parseResponse(content);
  return { styleKey, meta, content, parsed, tokens, temperature };
}

// ============================================================
// 三版本并行生成 (含 Jaccard 差异度检查 + 自动重试)
// ============================================================

async function generateThreeVersions(scenario, relationshipInfo) {
  console.log(color(C.cyan, "  📝 正在并行生成三个版本（基于关系判断结果）..."));
  console.log(color(C.dim, `     ├─ ${VERSION_META.mild.icon} 温和版 (关系维护优先)`));
  console.log(color(C.dim, `     ├─ ${VERSION_META.firm.icon} 坚定版 (立场明确优先)`));
  console.log(color(C.dim, `     └─ ${VERSION_META.eq.icon} 高情商版 (双赢导向)`));

  const startTime = Date.now();

  // ★ 核心: 三个 Agent 并行调用 (Promise.allSettled + 单点降级)
  // Day 11 Review: 使用 allSettled 避免单个版本失败导致全部丢失
  const settledResults = await Promise.allSettled([
    generateVersion(scenario, "mild", relationshipInfo),
    generateVersion(scenario, "firm", relationshipInfo),
    generateVersion(scenario, "eq", relationshipInfo),
  ]);

  let results = settledResults.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    // 某个版本生成失败时，构造占位结果，不影响其他版本
    const styles = ["mild", "firm", "eq"];
    console.error(color(C.yellow, `  ⚠️ ${VERSION_META[styles[i]].name} 生成失败: ${r.reason?.message || r.reason}`));
    return {
      styleKey: styles[i],
      meta: VERSION_META[styles[i]],
      content: JSON.stringify({ content: "(生成失败，请重试)", strategy: "降级占位" }),
      parsed: { content: "(生成失败，请重试)", strategy: "降级占位" },
      tokens: 0,
      temperature: 0,
      isDegraded: true,
    };
  });

  // ─── Day 10: Jaccard 差异度检查 + 自动重试 ───
  let retryRound = 0;
  let allSimilarities = [];

  while (retryRound < MAX_RETRY) {
    // 将 results 数组转为按 key 索引的对象
    const versionMap = {};
    for (const r of results) {
      versionMap[r.styleKey] = r;
    }

    const similarities = calculatePairwiseSimilarities(versionMap);
    allSimilarities.push({ round: retryRound, similarities });

    // 打印差异度日志
    if (retryRound === 0) {
      console.log("");
      console.log(color(C.cyan, "  🔬 [Jaccard 差异度检查]"));
    } else {
      console.log(color(C.yellow, `  🔄 [Jaccard 重试 第${retryRound}轮]`));
    }

    let hasTooSimilar = false;
    for (const [pairKey, result] of Object.entries(similarities)) {
      const indicator = result.isTooSimilar ? color(C.yellow, "⚠️ 趋同") : color(C.green, "✅ 差异化");
      console.log(color(C.dim, `     ${pairKey}: Jaccard=${result.similarity.toFixed(3)} ${indicator}`));
      if (result.isTooSimilar) hasTooSimilar = true;
    }

    if (!hasTooSimilar) {
      console.log(color(C.green, `  ✅ 所有版本差异度达标 (Jaccard < ${MAX_SIMILARITY})`));
      break;
    }

    // 找出需要重试的 style
    const stylesToRetry = findStylesToRetry(similarities);
    console.log(color(C.yellow, `  ⚠️  检测到文本趋同，重试: ${stylesToRetry.map(s => VERSION_META[s].name).join(", ")} (temperature +${RETRY_TEMP_BOOST.toFixed(1)})`));

    retryRound++;

    // 并行重试趋同的版本
    const retryPromises = stylesToRetry.map((styleKey) =>
      generateVersion(scenario, styleKey, relationshipInfo, retryRound)
    );

    // Day 11 Review: 使用 allSettled 避免单个重试失败导致全部丢失
    const retrySettled = await Promise.allSettled(retryPromises);

    const retriedResults = retrySettled
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    // 记录失败的重试
    retrySettled.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(color(C.yellow, `  ⚠️ 重试 ${stylesToRetry[i]} 失败: ${r.reason?.message || r.reason}，保留原版本`));
      }
    });

    // 用重试结果替换对应版本
    const retryMap = {};
    for (const r of retriedResults) {
      retryMap[r.styleKey] = r;
    }

    results = results.map((r) => retryMap[r.styleKey] || r);
  }

  if (retryRound >= MAX_RETRY) {
    console.log(color(C.yellow, `  ⚠️  已达到最大重试次数 (${MAX_RETRY})，使用当前版本 (可能略有趋同)`));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalTokens = results.reduce((sum, r) => sum + r.tokens, 0);

  // Day 12: 附加最终的 Jaccard 差异度数据，供 SQLite 存储等下游使用
  const finalVersionMap = {};
  for (const r of results) {
    finalVersionMap[r.styleKey] = r;
  }
  const finalSimilarities = calculatePairwiseSimilarities(finalVersionMap);
  results._similarities = finalSimilarities;

  console.log("");
  console.log(color(C.green, `  ⏱️  并行生成完成 (${elapsed}s · ${totalTokens} tokens · 差异度检查${retryRound}轮重试)`));
  console.log("");

  return results;
}

module.exports = {
  generateVersion,
  generateThreeVersions,
  jaccardSimilarity,
  VERSION_META,
  GENERATOR_SOULS,
};
