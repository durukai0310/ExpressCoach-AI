#!/usr/bin/env node
/**
 * 需求3: AI 批量训练数据生成
 *
 * 按「5 意图 × 32 关系 × 4 难度」矩阵批量产出中文社交场景及标注，
 * 把现有 200 条种子数据扩充到 1000 条。
 *
 * 设计要点：
 *  - 并发受控（默认 3），避免打爆 API 频率限制
 *  - 失败自动重试（指数退避，429 额外加长等待）
 *  - 断点续传：每个 combo 完成即落盘 checkpoint，中断后重跑自动跳过
 *  - 来源标记：合成数据一律打 source="llm-synthetic"，与人工种子区分
 *    （答辩口径红线：合成数据不得宣称真实用户数据）
 *
 * 用法:
 *   node scripts/generate-data.js                    # 生成到 1000 条
 *   node scripts/generate-data.js --target 600       # 指定目标条数
 *   node scripts/generate-data.js --batch 10         # 每次请求生成 10 条
 *   node scripts/generate-data.js --concurrency 5    # 并发数
 *   node scripts/generate-data.js --fresh            # 丢弃 checkpoint 重跑
 *   node scripts/generate-data.js --dry-run          # 只打印计划不调 API
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

dotenv.config({ path: path.join(ROOT, ".env") });

// ============================================================
// 参数解析
// ============================================================
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : def;
};
const flag = (name) => argv.includes(`--${name}`);

const TARGET = parseInt(arg("target", "1000"), 10);
const BATCH = parseInt(arg("batch", "5"), 10);
const CONCURRENCY = parseInt(arg("concurrency", "3"), 10);
const FRESH = flag("fresh");
const DRY_RUN = flag("dry-run");

/** 生成结果输出文件；同时作为增量续跑时的基础数据（见 main 中的 loadBase 逻辑） */
const OUTPUT_FILE = path.join(DATA_DIR, "training-w6-expanded.json");
/** 回退用的原始种子数据（仅当输出文件不存在时使用） */
const FALLBACK_FILE = path.join(DATA_DIR, "training-w5-complete.json");
const CHECKPOINT_FILE = path.join(DATA_DIR, ".gen-checkpoint.json");
const DICT_FILE = path.join(DATA_DIR, "relation-dict.json");
const INTENT_FILE = path.join(DATA_DIR, "intent-rules.json");

// ============================================================
// 枚举（与 data/relation-dict.json、data/intent-rules.json 对齐）
// ============================================================
const INTIMACY_LEVELS = ["亲密", "较近", "一般", "疏远"];
const POWER_LEVELS = ["对方上位", "平等", "己方上位", "不明"];
const INTEREST_LEVELS = ["强利益", "弱利益", "纯情感"];
const DIFFICULTY_LEVELS = ["easy", "medium", "hard", "extreme"];

const INTENT_CANON = {
  拒绝: "拒绝请求",
  拒绝请求: "拒绝请求",
  催促: "催促对方",
  催促对方: "催促对方",
  反馈: "提出反馈",
  提出反馈: "提出反馈",
  设边界: "设立边界",
  设立边界: "设立边界",
  求助: "寻求帮助",
  寻求帮助: "寻求帮助",
};

const DIFFICULTY_HINT = {
  easy: "日常轻松场合，双方关系简单，冲突风险低",
  medium: "有一定顾虑或尴尬，需要斟酌措辞",
  hard: "关系复杂或 stakes 较高，措辞失误有明显代价",
  extreme: "高度敏感或两难困境，几乎难以两全",
};

/**
 * 旧词汇 → relation-dict.json 规范词汇
 * 原始种子数据存在两套词汇并存的问题，生成阶段一并归一，避免合法数据被误弃。
 */
const POWER_MAP = { 上级: "对方上位", 平级: "平等", 下级: "己方上位" };
const INTEREST_MAP = { 强: "强利益", 高: "弱利益", 中: "弱利益", 弱: "纯情感", 低: "纯情感" };

// ============================================================
// 工具
// ============================================================
function readJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

/** 从 LLM 输出中稳健提取 JSON 数组（容忍 ```json 围栏、前后说明文字） */
function extractJSONArray(text) {
  if (!text) return null;
  let s = String(text).trim();
  // 去掉代码围栏
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // 截取第一个 [ 到最后一个 ]
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : v && Array.isArray(v.cases) ? v.cases : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// 生成计划
// ============================================================
function buildPlan(relations, intents, need) {
  const plan = [];
  // 第一轮覆盖全部 160 个「关系 × 意图」组合；若条数不够则开启第二轮，
  // 难度整体错位，避免第二轮与第一轮重复。
  let n = 0;
  for (let round = 0; round < 10; round++) {
    for (const rel of relations) {
      for (const intent of intents) {
        if (plan.length * BATCH >= need) return plan;
        plan.push({
          relation: rel,
          intent,
          difficulty: DIFFICULTY_LEVELS[(n + round) % DIFFICULTY_LEVELS.length],
          round,
        });
        n++;
      }
    }
  }
  return plan;
}

function buildPrompt(combo) {
  const { relation, intent, difficulty } = combo;
  const label = INTENT_CANON[intent] || intent;

  return `你是中文社交场景数据标注专家。请生成 ${BATCH} 个**互不重复**的中文社交困境场景，并为每个场景打上结构化标注。

## 约束条件（必须严格遵守）
- 关系对象：**${relation.type}**
  - 亲密度基准：${relation.intimacy}
  - 权力关系基准：${relation.power}
  - 利益关联基准：${relation.interest}
  - 该关系典型策略：${relation.strategy || "（无）"}
  - 注意事项：${relation.caution || "（无）"}
- 表达意图：**${label}**
- 难度等级：**${difficulty}**（${DIFFICULTY_HINT[difficulty]}）

## 场景要求
1. 真实、具体、有细节（点明人物、时间、具体事件、金额/次数等），不要空泛
2. 是第一人称视角的真实生活/工作/家庭困境，不是抽象命题
3. 场景长度 20-60 字，情节完整可理解
4. 每个场景必须不同（不同事件、不同诱因），禁止套模板换词
5. 符合中国大陆当代社交语境

## 输出格式
只输出一个 JSON 数组，不要任何解释文字、不要代码围栏。每个元素结构如下：

[
  {
    "scenario": "场景描述文本",
    "intent": "${label}",
    "relationType": "关系大类（家庭关系/朋友关系/恋人关系/同学关系/同事关系/上下级关系/师生关系/商业关系/服务关系/陌生人关系 之一）",
    "intimacy": "亲密度（亲密/较近/一般/疏远 之一）",
    "power": "权力关系（对方上位/平等/己方上位/不明 之一）",
    "interest": "利益关联（强利益/弱利益/纯情感 之一）",
    "difficulty": "${difficulty}",
    "expectedIntent": "${label}",
    "expectedRelation": "${relation.type}-亲密等级-权力等级",
    "expectedStrategy": "推荐表达策略，格式如『委婉拒绝+说明理由+提供替代方案』，必须与关系、意图、难度匹配",
    "speakingTo": "对话对象称呼，如『室友』『领导』『妈妈』"
  }
]
`;
}

// ============================================================
// 校验（生成后立即筛掉不合格项）
// ============================================================
const REQUIRED_FIELDS = [
  "scenario", "intent", "relationType", "intimacy", "power",
  "interest", "difficulty", "expectedIntent", "expectedRelation",
  "expectedStrategy", "speakingTo",
];

function validateItem(item) {
  const errs = [];
  for (const f of REQUIRED_FIELDS) {
    if (item[f] === undefined || item[f] === null || item[f] === "") {
      errs.push(`缺字段 ${f}`);
    }
  }
  if (item.scenario) {
    const len = String(item.scenario).length;
    if (len < 8) errs.push(`场景过短(${len}字)`);
    if (len > 120) errs.push(`场景过长(${len}字)`);
  }
  if (item.intimacy && !INTIMACY_LEVELS.includes(item.intimacy)) {
    errs.push(`亲密度非法: ${item.intimacy}`);
  }
  if (item.power && !POWER_LEVELS.includes(item.power)) {
    errs.push(`权力非法: ${item.power}`);
  }
  if (item.interest && !INTEREST_LEVELS.includes(item.interest)) {
    errs.push(`利益非法: ${item.interest}`);
  }
  if (item.difficulty && !DIFFICULTY_LEVELS.includes(item.difficulty)) {
    errs.push(`难度非法: ${item.difficulty}`);
  }
  if (item.intent && !INTENT_CANON[item.intent]) {
    errs.push(`意图非法: ${item.intent}`);
  }
  return errs;
}

const norm = (s) => String(s || "").replace(/[\s，。、！？,.!?；;：:]|/g, "");

/** 按归一化后的场景文本去重，保留首次出现 */
function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = norm(r.scenario);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log("=".repeat(64));
  console.log("  ExpressCoach · 训练数据批量生成");
  console.log("=".repeat(64));

  // 载入数据
  // 基础数据优先取已扩充文件（支持增量续跑），否则回退到 200 条种子
  let base = [];
  for (const p of [OUTPUT_FILE, FALLBACK_FILE]) {
    const arr = readJSON(p, []);
    if (Array.isArray(arr) && arr.length) {
      base = arr;
      console.log(`\n  基础数据源: ${path.basename(p)} (${arr.length} 条)`);
      break;
    }
  }

  const dict = readJSON(DICT_FILE, { relationships: [] });
  const intentCfg = readJSON(INTENT_FILE, { intents: [] });

  const relations = dict.relationships || [];
  const intents = (intentCfg.intents || []).map((i) => i.id || i.name);

  if (!relations.length || !intents.length) {
    console.error("✘ 无法载入关系词典或意图规则");
    process.exit(1);
  }

  // 种子数据内部存在完全重复行（实测 200 条中 50 条重复），先去重再算缺口
  const beforeDedupe = base.length;
  base = dedupeRows(base);
  const dupesRemoved = beforeDedupe - base.length;
  if (dupesRemoved > 0) {
    console.log(`  种子去重:     移除 ${dupesRemoved} 条重复`);
  }

  const need = Math.max(0, TARGET - base.length);
  console.log(`  种子数据: ${base.length} 条`);
  console.log(`  目标总数: ${TARGET} 条`);
  console.log(`  需新生成: ${need} 条`);
  console.log(`  关系类型: ${relations.length} 种 | 意图类型: ${intents.length} 种`);
  console.log(`  批次大小: ${BATCH} | 并发: ${CONCURRENCY}`);

  if (need === 0) {
    console.log("\n✔ 数据量已达标，无需生成");
    return;
  }

  const plan = buildPlan(relations, intents, need);
  const estimatedCalls = plan.length;
  console.log(`  计划请求: ${estimatedCalls} 次 (预计产出 ${estimatedCalls * BATCH} 条)\n`);

  if (DRY_RUN) {
    console.log("  [dry-run] 计划前 5 项:");
    plan.slice(0, 5).forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.relation.type} × ${c.intent} × ${c.difficulty}`);
    });
    return;
  }

  // 检查 Key
  const { getAvailableModels } = await import("../src/lib/api.js");
  const models = getAvailableModels();
  const names = Object.keys(models).filter((k) => models[k].configured);
  if (!names.length) {
    console.error("\n✘ 未配置任何 API Key。请在 .env 中配置 GLM_API_KEY");
    process.exit(1);
  }
  console.log(`  可用模型: ${names.join(", ")} (优先: ${names[0]})\n`);

  // 载入 checkpoint
  let done = FRESH ? {} : readJSON(CHECKPOINT_FILE, {});
  if (FRESH) {
    console.log("  [fresh] 已丢弃历史 checkpoint\n");
  } else if (Object.keys(done).length) {
    const n = Object.values(done).reduce((s, arr) => s + arr.length, 0);
    console.log(`  恢复 checkpoint: ${Object.keys(done).length} 个组合已完成，${n} 条\n`);
  }

  // round 参与键名，保证第二轮不会与第一轮撞键而被误判为"已完成"
  const keyOf = (c) =>
    `${c.relation.type}||${c.intent}||${c.difficulty}||r${c.round ?? 0}`;
  const pending = plan.filter((c) => !done[keyOf(c)]);

  if (!pending.length) {
    console.log("✔ 计划已全部完成");
  }

  const stats = { calls: 0, ok: 0, failed: 0, items: 0, rejected: 0, retries: 0 };
  const seen = new Set();
  // 用已有数据预填去重集
  for (const b of base) seen.add(norm(b.scenario));
  for (const arr of Object.values(done)) {
    for (const it of arr) seen.add(norm(it.scenario));
  }

  const started = Date.now();
  let cursor = 0;

  async function worker(wid) {
    while (cursor < pending.length) {
      const idx = cursor++;
      const combo = pending[idx];
      const k = keyOf(combo);

      let lastErr = null;
      let items = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          stats.calls++;
          const { callLLM } = await import("../src/lib/api.js");
          const { content } = await callLLM(
            "你是严谨的中文社交场景数据标注专家，只输出符合规范的 JSON。",
            buildPrompt(combo),
            { temperature: 0.9, maxTokens: 4000 }
          );
          items = extractJSONArray(content);
          if (items && items.length) break;
          lastErr = "返回内容无法解析为 JSON 数组";
        } catch (e) {
          lastErr = e.message;
          // 429 / 频率限制 → 加长等待
          const isRate = /429|频率|限流|rate/i.test(String(e.message));
          const wait = isRate ? 15000 * attempt : 2000 * attempt;
          if (isRate) stats.retries++;
          await sleep(wait);
        }
        if (attempt < 3) {
          stats.retries++;
          await sleep(1500 * attempt);
        }
      }

      if (!items || !items.length) {
        stats.failed++;
        console.log(`  [w${wid}] ✘ ${combo.relation.type}×${combo.intent} — ${lastErr}`);
        continue;
      }

      // 逐条归一 → 校验 → 去重
      const accepted = [];
      for (const raw of items) {
        const item = {
          ...raw,
          intent: INTENT_CANON[raw.intent] || raw.intent,
          expectedIntent: INTENT_CANON[raw.expectedIntent] || raw.expectedIntent,
          difficulty: DIFFICULTY_LEVELS.includes(raw.difficulty) ? raw.difficulty : "medium",
          source: "llm-synthetic",
          generator: "glm-5.3-flash",
          generatedAt: new Date().toISOString(),
          batchKey: k,
        };
        // 枚举归一（LLM 偶尔会回退到旧词汇）
        if (POWER_MAP[item.power]) item.power = POWER_MAP[item.power];
        if (INTEREST_MAP[item.interest]) item.interest = INTEREST_MAP[item.interest];

        const errs = validateItem(item);
        if (errs.length) {
          stats.rejected++;
          continue;
        }
        const nk = norm(item.scenario);
        if (seen.has(nk)) {
          stats.rejected++;
          continue;
        }
        seen.add(nk);
        accepted.push(item);
      }

      // 补齐可能缺失的 speakingTo（容错）
      for (const it of accepted) {
        if (!it.speakingTo) it.speakingTo = combo.relation.type;
      }

      done[k] = accepted;
      stats.ok++;
      stats.items += accepted.length;
      writeJSON(CHECKPOINT_FILE, done);

      const pct = (((stats.ok + stats.failed) / pending.length) * 100).toFixed(0);
      console.log(
        `  [w${wid}] ${String(stats.ok + stats.failed).padStart(3)}/${pending.length} (${pct}%) ` +
        `${combo.relation.type}×${combo.intent} → ${accepted.length} 条`
      );
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, pending.length || 1); i++) {
    workers.push(worker(i + 1));
  }
  await Promise.all(workers);

  // 汇总写出
  const generated = [];
  for (const arr of Object.values(done)) generated.push(...arr);

  // 若超出目标，截断
  const finalGenerated = generated.slice(0, need);

  const output = [
    ...base.map((b) => ({ ...b, source: b.source || "manual-seed" })),
    ...finalGenerated,
  ];

  writeJSON(OUTPUT_FILE, output);

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(64));
  console.log("  生成完成");
  console.log("=".repeat(64));
  console.log(`  请求次数: ${stats.calls} (成功 ${stats.ok} / 失败 ${stats.failed})`);
  console.log(`  重试次数: ${stats.retries}`);
  console.log(`  产出条目: ${stats.items} 条，校验拒绝 ${stats.rejected} 条`);
  console.log(`  人工种子: ${base.length} 条`);
  console.log(`  合成新增: ${finalGenerated.length} 条`);
  console.log(`  最终总计: ${output.length} 条`);
  console.log(`  耗时: ${secs}s`);
  console.log(`\n  输出文件: ${path.relative(ROOT, OUTPUT_FILE)}`);
  console.log("=".repeat(64));
}

main().catch((e) => {
  console.error("\n✘ 生成失败:", e.message);
  process.exit(1);
});
