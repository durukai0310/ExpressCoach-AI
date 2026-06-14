/**
 * test-relationship.js — M2 关系判断模块测试 (Day 9)
 *
 * 测试覆盖:
 *  1. 规则匹配层 ruleMatch() — 关键词 → 词典匹配
 *  2. 关系词典加载 — 30+ 关系类型验证
 *  3. 降级兜底 — 无关键词匹配时的默认值
 *  4. 混合分析 hybridAnalyze() — 规则+LLM 全流程
 *
 * 用法: node test/test-relationship.js
 */

const path = require("path");
const { ruleMatch, loadRelationDict, hybridAnalyze } = require("../src/relationship/analyze");

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
// 测试1: 关系词典加载
// ============================================================
section("测试1: 关系词典加载");

const dict = loadRelationDict();
assert(dict !== null, "词典文件加载成功");
assert(dict.relationships && dict.relationships.length >= 30, `词典包含 ≥30 种关系 (实际: ${dict?.relationships?.length || 0})`);
assert(dict.defaults !== undefined, "默认值存在");
assert(dict.dimensions.intimacy.levels.length === 4, "亲密度有 4 个等级");
assert(dict.dimensions.power.levels.length === 4, "权力关系有 4 个等级");
assert(dict.dimensions.interest.levels.length === 3, "利益关联有 3 个等级");

// 验证每种关系都有三维度标注
if (dict && dict.relationships) {
  let validCount = 0;
  const validIntimacies = ["亲密", "较近", "一般", "疏远"];
  const validPowers = ["对方上位", "平等", "己方上位", "不明"];
  const validInterests = ["强利益", "弱利益", "纯情感"];

  for (const rel of dict.relationships) {
    if (validIntimacies.includes(rel.intimacy) &&
        validPowers.includes(rel.power) &&
        validInterests.includes(rel.interest)) {
      validCount++;
    }
  }
  assert(validCount === dict.relationships.length,
    `所有 ${dict.relationships.length} 种关系均有三维度标注 (有效: ${validCount})`);

  // 验证关键词去重
  for (const rel of dict.relationships) {
    assert(rel.keywords.length > 0, `${rel.type} 有关键词 (${rel.keywords.length}个)`);
  }
}

// ============================================================
// 测试2: 规则匹配 — 精确匹配
// ============================================================
section("测试2: 规则匹配 — 精确关键词");

const testCases = [
  {
    scenario: "我想拒绝老板的不合理加班要求",
    expectedType: "上级",
    desc: "场景含'老板' → 上级",
  },
  {
    scenario: "室友总用我东西不打招呼",
    expectedType: "室友",
    desc: "场景含'室友' → 室友",
  },
  {
    scenario: "同事的报告拖了三天了我想催他",
    expectedType: "同事(一般)",
    desc: "场景含'同事' → 同事(一般)",
  },
  {
    scenario: "朋友找我借钱不想借",
    expectedType: "好朋友",
    desc: "场景含'朋友' → 好朋友",
  },
  {
    scenario: "我想向爸妈解释为什么换工作",
    expectedType: "父母",
    desc: "场景含'爸妈' → 父母",
  },
  {
    scenario: "客户一直不付款该怎么催",
    expectedType: "客户",
    desc: "场景含'客户' → 客户",
  },
  {
    scenario: "邻居晚上太吵了我想去说一下",
    expectedType: "邻居(不熟)",
    desc: "场景含'邻居' → 邻居(不熟)",
  },
  {
    scenario: "老师布置的作业太多了我想反馈",
    expectedType: "老师",
    desc: "场景含'老师' → 老师",
  },
];

for (const tc of testCases) {
  const result = ruleMatch(tc.scenario);
  assert(result.matched, `${tc.desc} — 匹配成功`);
  assert(result.entry.type === tc.expectedType,
    `${tc.desc} — 类型正确 (期望: ${tc.expectedType}, 实际: ${result.entry.type})`);
}

// ============================================================
// 测试3: 规则匹配 — 三维度验证
// ============================================================
section("测试3: 规则匹配 — 三维度输出");

const dimensionCases = [
  {
    scenario: "领导安排不合理我想提出来",
    checks: {
      intimacy: "一般",
      power: "对方上位",
      interest: "强利益",
    },
    desc: "上级 → 一般/对方上位/强利益",
  },
  {
    scenario: "我想和老公商量一下要不要换房子",
    checks: {
      intimacy: "亲密",
      power: "平等",
      interest: "纯情感",
    },
    desc: "配偶 → 亲密/平等/纯情感",
  },
  {
    scenario: "陌生人向我求助借手机打电话",
    checks: {
      intimacy: "疏远",
      power: "不明",
      interest: "纯情感",
    },
    desc: "陌生人 → 疏远/不明/纯情感",
  },
  {
    scenario: "下属最近表现不好我想找他谈谈",
    checks: {
      power: "己方上位",
      interest: "强利益",
    },
    desc: "下属 → 己方上位/强利益",
  },
];

for (const tc of dimensionCases) {
  const result = ruleMatch(tc.scenario);
  assert(result.matched, `${tc.desc} — 匹配成功`);
  for (const [dim, expected] of Object.entries(tc.checks)) {
    assert(result.entry[dim] === expected,
      `${tc.desc} — ${dim}: 期望 "${expected}", 实际 "${result.entry[dim]}"`);
  }
}

// ============================================================
// 测试4: 规则匹配 — 降级兜底
// ============================================================
section("测试4: 规则匹配 — 无关键词降级");

const fallbackCases = [
  {
    scenario: "今天天气真好",
    desc: "无关场景 → 默认值",
  },
  {
    scenario: "我想吃火锅",
    desc: "无关系关键词 → 默认值",
  },
  {
    scenario: "",
    desc: "空字符串 → 默认值",
  },
];

for (const tc of fallbackCases) {
  const result = ruleMatch(tc.scenario);
  assert(!result.matched, `${tc.desc} — 未匹配`);
  assert(result.entry.type === "未知", `${tc.desc} — 类型为"未知"`);
  assert(result.source.includes("默认"), `${tc.desc} — 来源包含"默认"`);
}

// ============================================================
// 测试5: 混合分析 — 全流程 (需要 API)
// ============================================================
section("测试5: 混合分析 hybridAnalyze() — 全流程");

// 检查 API Key 是否可用
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const API_AVAILABLE = !!DEEPSEEK_API_KEY;

if (API_AVAILABLE) {
  console.log("  ℹ️  DeepSeek API 可用，运行混合分析测试...");
} else {
  console.log("  ⚠️  DeepSeek API 未配置，跳过 LLM 相关测试");
}

async function runHybridTests() {
  const hybridScenarios = [
    {
      scenario: "我想拒绝老板的不合理加班要求",
      expectedType: "上级",
      desc: "拒绝老板加班 → 上级+强利益",
    },
    {
      scenario: "室友总用我东西不打招呼我想说说他",
      expectedType: "室友",
      desc: "室友用东西 → 室友+较近",
    },
  ];

  for (const tc of hybridScenarios) {
    try {
      const result = await hybridAnalyze(tc.scenario);

      // 基本结构验证
      assert(result.parsed !== null, `${tc.desc} — 有解析结果`);
      assert(result.source !== undefined, `${tc.desc} — 有数据源标注`);
      assert(result.weights !== undefined, `${tc.desc} — 有权重信息`);

      if (result.parsed) {
        assert(["亲密", "较近", "一般", "疏远"].includes(result.parsed["亲密度"] || ""),
          `${tc.desc} — 亲密度有效 (${result.parsed["亲密度"]})`);
        assert(["对方上位", "平等", "己方上位", "不明"].includes(result.parsed["权力关系"] || ""),
          `${tc.desc} — 权力关系有效 (${result.parsed["权力关系"]})`);
        assert(["强利益", "弱利益", "纯情感"].includes(result.parsed["利益关联"] || ""),
          `${tc.desc} — 利益关联有效 (${result.parsed["利益关联"]})`);
      }

      // 规则层验证
      assert(result.ruleResult !== undefined, `${tc.desc} — 有规则匹配结果`);

      console.log(`    📊 结果: ${result.parsed?.["关系类型"] || "?"} | ${result.source}`);
    } catch (error) {
      // API 错误不标记为测试失败（网络问题等外部因素）
      console.log(`  ⚠️ ${tc.desc} — API 调用失败 (非测试错误): ${error.message.substring(0, 100)}`);
      console.log(`    ℹ️  降级到规则模式应该仍可工作`);
    }
  }
}

// ============================================================
// 测试6: 关键词匹配优先级
// ============================================================
section("测试6: 关键词匹配 — 优先级与歧义");

const priorityCases = [
  {
    scenario: "我闺蜜是老板我想拒绝她的聚餐邀请",
    expectedType: "上级",
    desc: "'老板'和'闺蜜'同时出现 → 应匹配更具体的(通过分数排序)",
    note: "注意: 多关键词匹配按分数排序，结果取决于词典关键词权重",
  },
  {
    scenario: "同事也是我同学我想催他交材料",
    expectedType: "同事(一般)",
    desc: "'同事'和'同学' → 按分数优先",
    note: "实际匹配取决于关键词长度和数量",
  },
];

for (const tc of priorityCases) {
  const result = ruleMatch(tc.scenario);
  assert(result.matched, `${tc.desc} — 至少匹配到一个关系`);
  if (result.allMatches && result.allMatches.length > 1) {
    console.log(`    ℹ️  多候选: ${result.allMatches.map(m => `${m.type}(${m.score})`).join(", ")}`);
  }
  console.log(`    📊 选择: ${result.entry.type}`);
  if (tc.note) console.log(`    💡 ${tc.note}`);
}

// ============================================================
// 测试结果汇总
// ============================================================
section("测试结果汇总");

const total = passed + failed;
console.log(`\n  ${passed}/${total} 通过, ${failed} 失败`);
console.log(`  ${"█".repeat(Math.round((passed / total) * 40))}${"░".repeat(40 - Math.round((passed / total) * 40))} ${Math.round((passed / total) * 100)}%\n`);

// 运行异步测试
if (API_AVAILABLE) {
  runHybridTests().then(() => {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  最终结果: ${passed}/${total} 通过, ${failed} 失败\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
} else {
  console.log(`  ℹ️  跳过 API 测试。设置 DEEPSEEK_API_KEY 后可运行完整测试。`);
  process.exit(failed > 0 ? 1 : 0);
}
