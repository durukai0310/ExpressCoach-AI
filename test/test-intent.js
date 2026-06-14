/**
 * test-intent.js — M1 意图识别模块测试 (Day 8, 补充于 Day 14)
 *
 * 测试覆盖:
 *  1. 规则兜底 fallbackRecognize() — 5种意图关键词匹配
 *  2. 兜底降级 — 无匹配时的默认值
 *  3. 意图规则库加载验证
 *  4. LLM recognizeIntent() — 全流程 (需要 API)
 *
 * 用法: node test/test-intent.js
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const { recognizeIntent, fallbackRecognize } = require("../src/intent/recognize");

// ============================================================
// 测试框架
// ============================================================
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

// ============================================================
// 测试1: 规则兜底 — 5种意图精确匹配
// ============================================================
section("测试1: 规则兜底 — 5种意图关键词匹配");

const fallbackCases = [
  {
    scenario: "同事总让我帮做他的工作我想拒绝",
    expectedIntent: "拒绝",
    desc: "含'拒绝'+'不想' → 拒绝",
  },
  {
    scenario: "同事的报告拖了三天了我想催他",
    expectedIntent: "催促",
    desc: "含'催'+'拖了' → 催促",
  },
  {
    scenario: "领导安排不太合理我想提出来",
    expectedIntent: "反馈",
    desc: "含'不合理'+'提出来' → 反馈",
  },
  {
    scenario: "同事总在下班后给我发工作消息",
    expectedIntent: "设边界",
    desc: "含'总是'+'打扰'语义 → 设边界",
  },
  {
    scenario: "我想向老板请假但不知道怎么开口",
    expectedIntent: "求助",
    desc: "含'请假'+'不知道' → 求助",
  },
];

for (const tc of fallbackCases) {
  const result = fallbackRecognize(tc.scenario);
  assert(result.parsed !== null, `${tc.desc} — 有解析结果`);
  assert(result.parsed["意图"] === tc.expectedIntent,
    `${tc.desc} — 意图正确 (期望: ${tc.expectedIntent}, 实际: ${result.parsed["意图"]})`);
  assert(typeof result.parsed["置信度"] === "number",
    `${tc.desc} — 置信度为数字 (${result.parsed["置信度"]})`);
  assert(result.parsed["置信度"] <= 0.55,
    `${tc.desc} — 置信度 ≤ 0.55 (兜底匹配低于LLM, 实际: ${result.parsed["置信度"]})`);
}

// ============================================================
// 测试2: 规则兜底 — 无匹配降级
// ============================================================
section("测试2: 规则兜底 — 无关键词降级默认值");

const noMatchCases = [
  {
    scenario: "今天天气真好",
    desc: "无关场景 → 默认'反馈'",
  },
  {
    scenario: "我想吃火锅",
    desc: "无意图关键词 → 默认值",
  },
  {
    scenario: "",
    desc: "空字符串 → 默认值",
  },
];

for (const tc of noMatchCases) {
  const result = fallbackRecognize(tc.scenario);
  assert(result.parsed !== null, `${tc.desc} — 有解析结果`);
  assert(result.parsed["置信度"] <= 0.5,
    `${tc.desc} — 置信度较低 (${result.parsed["置信度"]})`);
  assert(result.parsed["分析"] && result.parsed["分析"].includes("兜底"),
    `${tc.desc} — 标记为兜底匹配`);
}

// ============================================================
// 测试3: 意图规则库加载验证
// ============================================================
section("测试3: 意图规则库 data/intent-rules.json 验证");

const fs = require("fs");
const rulesPath = path.resolve(__dirname, "..", "data", "intent-rules.json");

assert(fs.existsSync(rulesPath), "intent-rules.json 文件存在");

const rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
assert(rules.intents && rules.intents.length === 5, `包含 5 种意图 (实际: ${rules.intents?.length})`);

const intentNames = rules.intents.map(i => i.name);
assert(intentNames.includes("拒绝"), "包含'拒绝'意图");
assert(intentNames.includes("催促"), "包含'催促'意图");
assert(intentNames.includes("反馈"), "包含'反馈'意图");
assert(intentNames.includes("设边界"), "包含'设边界'意图");
assert(intentNames.includes("求助"), "包含'求助'意图");

for (const intent of rules.intents) {
  assert(intent.keywords.length >= 15,
    `${intent.name}: 关键词 ≥ 15 (实际: ${intent.keywords.length})`);
  assert(intent.patterns.length >= 5,
    `${intent.name}: 句式 ≥ 5 (实际: ${intent.patterns.length})`);
}

// ============================================================
// 测试4: 边界场景 — 拒绝 vs 设边界 区分
// ============================================================
section("测试4: 关键区分 — 拒绝 vs 设边界");

const boundaryCases = [
  {
    scenario: "我想拒绝同事的聚餐邀请",
    expectedIntent: "拒绝",
    desc: "拒绝具体请求 → 拒绝",
  },
  {
    scenario: "同事总是下班后找我聊工作",
    expectedIntent: "设边界",
    desc: "持续性底线问题 → 设边界",
  },
];

for (const tc of boundaryCases) {
  const result = fallbackRecognize(tc.scenario);
  assert(result.parsed["意图"] === tc.expectedIntent,
    `${tc.desc} — 正确区分 (期望: ${tc.expectedIntent}, 实际: ${result.parsed["意图"]})`);
}

// ============================================================
// 测试5: LLM 意图识别 — 全流程 (需要 API)
// ============================================================
section("测试5: LLM recognizeIntent() — 全流程");

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const API_AVAILABLE = !!DEEPSEEK_API_KEY;

if (!API_AVAILABLE) {
  console.log("  ⚠️  DeepSeek API 未配置，跳过 LLM 测试");
}

async function runLLMTests() {
  const llmScenarios = [
    {
      scenario: "我想拒绝朋友借钱但不想伤感情",
      expectedIntent: "拒绝",
      desc: "拒绝借钱 → 拒绝",
    },
    {
      scenario: "同事的报告拖了三天了我想催他",
      expectedIntent: "催促",
      desc: "催报告 → 催促",
    },
    {
      scenario: "同事总在下班后给我发工作消息",
      expectedIntent: "设边界",
      desc: "下班后发消息 → 设边界",
    },
  ];

  for (const tc of llmScenarios) {
    try {
      const result = await recognizeIntent(tc.scenario);
      assert(result.parsed !== null, `${tc.desc} — LLM 返回解析成功`);
      if (result.parsed) {
        assert(result.parsed["意图"] === tc.expectedIntent,
          `${tc.desc} — 意图正确 (期望: ${tc.expectedIntent}, 实际: ${result.parsed["意图"]})`);
        assert(result.parsed["置信度"] >= 0.5,
          `${tc.desc} — 置信度 ≥ 0.5 (实际: ${result.parsed["置信度"]})`);
      }
      console.log(`    📊 意图: ${result.parsed?.["意图"]} | 置信度: ${result.parsed?.["置信度"]}`);
    } catch (error) {
      console.log(`  ⚠️ ${tc.desc} — API 调用失败 (非测试错误): ${error.message.substring(0, 100)}`);
      console.log(`    ℹ️  降级到规则兜底应该仍可工作`);
      // 验证降级
      const fallback = fallbackRecognize(tc.scenario);
      assert(fallback.parsed !== null, `${tc.desc} — 降级兜底可用`);
    }
  }
}

// ============================================================
// 测试结果汇总
// ============================================================
section("测试结果汇总");

const total = passed + failed;
console.log(`\n  ${passed}/${total} 通过, ${failed} 失败`);
const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
console.log(`  ${"█".repeat(Math.round(pct / 2.5))}${"░".repeat(40 - Math.round(pct / 2.5))} ${pct}%\n`);

// 运行异步测试
if (API_AVAILABLE) {
  runLLMTests().then(() => {
    const finalTotal = passed + failed;
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  最终结果: ${passed}/${finalTotal} 通过, ${failed} 失败\n`);
    console.log(`  意图识别准确率目标 ≥ 80% — ${pct >= 80 ? "✅ 达标" : "⚠️ 待提升"}\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
} else {
  console.log(`  意图识别准确率目标 ≥ 80% — ${pct >= 80 ? "✅ 达标" : "⚠️ 待提升"}\n`);
  console.log(`  ℹ️  跳过 API 测试。设置 DEEPSEEK_API_KEY 后可运行完整测试。`);
  process.exit(failed > 0 ? 1 : 0);
}
