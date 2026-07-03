/**
 * M2 关系判断模块 — analyze.js (Day 9 增强)
 *
 * 职责:
 *   1. ruleMatch(scenario) — 规则匹配层: 从用户输入提取关系关键词，
 *      查 data/relation-dict.json 词典，输出基准值 (权重 0.3)
 *   2. judgeRelationship(scenario, ruleHints) — LLM 精调层:
 *      调用 DeepSeek 进行关系判断 (权重 0.7)
 *   3. hybridAnalyze(scenario) — 混合编排: 规则 → 注入LLM prompt → LLM精调 → 合并输出
 *
 * 覆盖 32 种中文社交关系类型，三维度标注:
 *   - 亲密度 (intimacy): 亲密 / 较近 / 一般 / 疏远
 *   - 权力关系 (power): 对方上位 / 平等 / 己方上位 / 不明
 *   - 利益关联 (interest): 强利益 / 弱利益 / 纯情感
 */

const fs = require("fs");
const path = require("path");
// dotenv 已由 index.js 加载

const { callDeepSeek } = require("../lib/api");
const { C, color } = require("../lib/color");
const { parseResponse } = require("../lib/parse");
const { loadFile } = require("../lib/fs-utils");

// ============================================================
// 配置
// ============================================================
const RELATION_SOUL = path.resolve(__dirname, "..", "..", "soul", "relationship-judge.md");
const RELATION_DICT_PATH = path.resolve(__dirname, "..", "..", "data", "relation-dict.json");

// 混合权重
const RULE_WEIGHT = 0.3;
const LLM_WEIGHT = 0.7;

// ============================================================
// 工具函数
// ============================================================

function loadRelationDict() {
  if (!fs.existsSync(RELATION_DICT_PATH)) {
    console.error(color(C.yellow, `  ⚠️ relation-dict.json 未找到: ${RELATION_DICT_PATH}`));
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(RELATION_DICT_PATH, "utf-8"));
  } catch (e) {
    console.error(color(C.yellow, `  ⚠️ relation-dict.json 解析失败: ${e.message}`));
    return null;
  }
}

// ============================================================
// 步骤1: 规则匹配层 (Rule Match) — 权重 0.3
// ============================================================

/**
 * 从用户输入中提取关系关键词，查词典返回最佳匹配
 *
 * @param {string} scenario - 用户输入的社交场景描述
 * @returns {object} { matched, entry, score, allMatches }
 *   - matched: 是否匹配到 (boolean)
 *   - entry: 最佳匹配的关系词典条目
 *   - score: 匹配分数 (关键词命中数)
 *   - allMatches: 所有命中的关系条目（按分数排序）
 */
function ruleMatch(scenario) {
  const dict = loadRelationDict();
  const defaults = dict?.defaults || {
    intimacy: "一般",
    power: "不明",
    interest: "纯情感",
    sensitivity: "中敏感",
    strategy: "保持礼貌和真诚",
    caution: "避免伤害对方感情",
  };

  if (!dict || !dict.relationships) {
    console.error(color(C.yellow, "  ⚠️ 关系词典不可用，返回默认值"));
    return {
      matched: false,
      entry: { type: "未知", ...defaults },
      score: 0,
      allMatches: [],
      source: "默认值",
    };
  }

  // 对每条关系类型计算关键词匹配分数
  const scoredMatches = [];
  for (const rel of dict.relationships) {
    let score = 0;
    const matchedKeywords = [];

    for (const kw of rel.keywords || []) {
      if (scenario.includes(kw)) {
        // 关键词越长越精准，给更高权重
        score += kw.length >= 3 ? 2 : 1;
        matchedKeywords.push(kw);
      }
    }

    if (score > 0) {
      scoredMatches.push({
        type: rel.type,
        entry: rel,
        score,
        matchedKeywords,
      });
    }
  }

  // 按分数降序排列
  scoredMatches.sort((a, b) => b.score - a.score);

  if (scoredMatches.length === 0) {
    console.error(color(C.dim, "  📖 规则层: 未匹配到明确关系关键词，使用默认值"));
    return {
      matched: false,
      entry: { type: "未知", ...defaults },
      score: 0,
      allMatches: [],
      source: "默认值（无关键词命中）",
    };
  }

  const best = scoredMatches[0];
  console.error(color(C.dim, `  📖 规则层: 匹配到 "${best.type}" (命中 ${best.matchedKeywords.length} 个关键词: ${best.matchedKeywords.join(", ")}, 分数 ${best.score})`));

  if (scoredMatches.length > 1) {
    console.error(color(C.dim, `     其他候选: ${scoredMatches.slice(1, 4).map(m => `${m.type}(${m.score})`).join(", ")}`));
  }

  // Day 28 Bug Bash: 场景上下文覆盖 (修复 money/power 误判)
  const overriddenEntry = applyContextualOverrides(best.entry, scenario);
  if (overriddenEntry.interest !== best.entry.interest || overriddenEntry.power !== best.entry.power) {
    console.error(color(C.dim, `  📝 上下文覆盖: ${overriddenEntry.interest !== best.entry.interest ? `利益 ${best.entry.interest}→${overriddenEntry.interest}` : ''}${overriddenEntry.power !== best.entry.power ? ` 权力 ${best.entry.power}→${overriddenEntry.power}` : ''}`));
  }

  return {
    matched: true,
    entry: overriddenEntry,
    score: best.score,
    allMatches: scoredMatches,
    matchedKeywords: best.matchedKeywords,
    source: `关键词匹配: ${best.type}`,
  };
}

// ============================================================
// Day 28 Bug Bash: 场景上下文覆盖 — 修复利益关联/权力关系误判
// ============================================================

/**
 * 根据场景中的上下文关键词，动态修正关系词典的基础维度
 * 解决: 借钱→利益关联误判 / 服务提供者→权力关系误判
 */
function applyContextualOverrides(entry, scenario) {
  const overrides = { ...entry }; // shallow copy

  // P0: 金钱相关 → 临时升级为强利益
  const moneyKeywords = /\b(借钱|还钱|付款|欠款|货款|工资|结账|赔偿|索赔|补偿|涨薪|加薪|报销|转账|汇款|收费|扣款|押金)\b/;
  if (moneyKeywords.test(scenario) && overrides.interest !== "强利益") {
    overrides.interest = "强利益";
  }

  // P1: 服务提供者 + 投诉场景 → 权力=己方上位
  const serviceKeywords = /(快递|外卖|包裹|送餐|送货|配送|网约车|出租车|滴滴)/;
  const complaintKeywords = /(错了|延迟|迟到|丢了|坏了|不满|投诉|赔偿|退款|差评|态度差|不达|问题)/;
  if (serviceKeywords.test(scenario) && complaintKeywords.test(scenario) && overrides.power === "平等") {
    overrides.power = "己方上位";
  }

  // P1: 供应商场景 + 质量问题 → 权力=己方上位
  const supplierKeywords = /(供应商|乙方|外包)/;
  const qualityKeywords = /(质量|延期|延迟|不达标|违约|赔偿|问题)/;
  if (supplierKeywords.test(scenario) && qualityKeywords.test(scenario)) {
    if (overrides.power === "平等") overrides.power = "己方上位";
    overrides.interest = "强利益";
  }

  // P2: 亲密+上级+弱利益组合 → 敏感度下调 (避免过度敏感)
  if (overrides.intimacy === "亲密" && overrides.power === "对方上位" && overrides.interest === "弱利益") {
    overrides.sensitivity = "中敏感";
  }

  return overrides;
}

// ============================================================
// W4 Day 25: 双重关系检测
// ============================================================

/**
 * W4 Day 25: detectDualRelationship — 双重关系检测 + 策略融合
 *
 * 检测场景中是否包含双重关系（如"同事兼好友"、"闺蜜也是下属"）
 *
 * 逻辑:
 *   1. 遍历 relation-dict.json 的所有关系类型
 *   2. 如果场景中匹配到2种关系 → 标记为双重关系
 *   3. 输出: { isDual, primaryRelation, secondaryRelation, strategyWeights, sensitivityModifier }
 *
 * 策略融合 (不二选一，而是加权平均):
 *   - 工作场景(利益>情感) → 同事策略权重0.6 + 好友策略权重0.4
 *   - 情感场景(情感>利益) → 同事策略权重0.4 + 好友策略权重0.6
 *   - 四维公式调整: sensitivityModifier += 0.2 (双重关系自动+0.2)
 *
 * @param {object} ruleMatchResult - ruleMatch 的返回结果
 * @param {string} scenario - 原始场景描述
 * @returns {object} { isDual, primaryRelation, secondaryRelation, primaryWeight, secondaryWeight, sensitivityModifier }
 */
function detectDualRelationship(ruleMatchResult, scenario) {
  if (!ruleMatchResult || !ruleMatchResult.matched) {
    return { isDual: false, sensitivityModifier: 0 };
  }

  const allMatches = ruleMatchResult.allMatches || [];
  // 需要至少2个候选，且第二名的分数足够高（> 0.65x 第一名）
  if (allMatches.length < 2) return { isDual: false, sensitivityModifier: 0 };

  const top = allMatches[0];
  const second = allMatches[1];

  // 第二名分数 > 第一名的65% → 可能双重关系
  if (second.score >= top.score * 0.65) {
    // 额外检测: 场景描述中是否有双重关系标记词
    const dualKeywords = /兼|也是|同时是|又是|还是.*也是|既.*又|双重|混合/;
    const hasDualSignal = dualKeywords.test(scenario);

    // 分数接近 + 关键词信号 → 确认双重关系
    if (hasDualSignal || second.score >= top.score * 0.8) {
      const primaryRelation = top.entry;
      const secondaryRelation = second.entry;

      // === W4 Day 25: 策略融合权重 ===
      // 判断场景的利益/情感主导类型
      const workSignals = /工作|报告|任务|项目|汇报|绩效|考核|工资|加班|同事|下属|领导|老板/;
      const emotionSignals = /家|亲戚|爸爸|妈妈|父母|公婆|妯娌|过年|结婚|闺蜜|好友|朋友|借钱|感情/;

      let workWeight, emotionWeight;
      // 确定哪个关系是"工作/利益型"，哪个是"情感型"
      const topIsWork = workSignals.test(top.entry.type) ||
        (top.entry.interest === "强利益" || top.entry.interest === "弱利益");
      const secondIsWork = workSignals.test(second.entry.type) ||
        (second.entry.interest === "强利益" || second.entry.interest === "弱利益");

      // Day 25 策略融合规则:
      // 工作场景(利益>情感) → 工作/同事策略权重0.6 + 好友/情感策略权重0.4
      // 情感场景(情感>利益) → 工作/同事策略权重0.4 + 好友/情感策略权重0.6
      if (workSignals.test(scenario)) {
        // 工作场景: 利益 > 情感
        workWeight = 0.6;
        emotionWeight = 0.4;
      } else if (emotionSignals.test(scenario)) {
        // 情感场景: 情感 > 利益
        workWeight = 0.4;
        emotionWeight = 0.6;
      } else {
        // 默认: 均衡
        workWeight = 0.5;
        emotionWeight = 0.5;
      }

      // 分配权重到具体关系
      const primaryWeight = topIsWork ? workWeight : emotionWeight;
      const secondaryWeight = secondIsWork ? workWeight : emotionWeight;

      // W4 Day 25: 四维公式调整 — 双重关系自动+0.2敏感度
      const sensitivityModifier = 0.2;

      console.error(`\n  🔀 [W4 Day 25] 双重关系检测:`);
      console.error(`     主关系: ${primaryRelation.type} (权重${primaryWeight.toFixed(1)})`);
      console.error(`     副关系: ${secondaryRelation.type} (权重${secondaryWeight.toFixed(1)})`);
      console.error(`     场景类型: ${workSignals.test(scenario) ? '工作主导(利益>情感)' : emotionSignals.test(scenario) ? '情感主导(情感>利益)' : '均衡'}`);
      console.error(`     敏感度修正: +${sensitivityModifier} (双重关系自动加成)`);
      console.error(`     触发: 分数${second.score.toFixed(1)}≈${top.score.toFixed(1)} + 双重信号`);

      return {
        isDual: true,
        primaryRelation: primaryRelation.type,
        secondaryRelation: secondaryRelation.type,
        primaryWeight,
        secondaryWeight,
        sensitivityModifier,
        primaryIsWork: topIsWork,
        secondaryIsWork: secondIsWork,
      };
    }
  }

  return { isDual: false, sensitivityModifier: 0 };
}

// ============================================================
// 步骤2: LLM 精调层 — 权重 0.7 (注入规则结果)
// ============================================================

/**
 * 调用 LLM 进行关系判断，prompt 中注入规则匹配结果作为参考
 *
 * @param {string} scenario - 用户输入的社交场景描述
 * @param {object} ruleResult - 规则匹配层的结果
 * @returns {object} { raw: string, parsed: object|null, tokens: number }
 */
async function judgeRelationship(scenario, ruleResult) {
  const soulContent = loadFile(RELATION_SOUL, "SOUL.md (关系判断)");
  if (!soulContent) throw new Error("关系判断 SOUL.md 加载失败");

  // 构建注入规则结果的增强 prompt
  let enhancedInput = scenario;

  if (ruleResult && ruleResult.matched) {
    const r = ruleResult.entry;
    enhancedInput = `【用户场景】\n"${scenario}"\n\n`;
    enhancedInput += `【规则词典预判结果 — 仅供参考，你可以根据语境调整】\n`;
    enhancedInput += `- 词典匹配关系类型: ${r.type}\n`;
    enhancedInput += `- 亲密度基准: ${r.intimacy}\n`;
    enhancedInput += `- 权力关系基准: ${r.power}\n`;
    enhancedInput += `- 利益关联基准: ${r.interest}\n`;
    enhancedInput += `- 表达敏感度基准: ${r.sensitivity}\n`;
    if (ruleResult.matchedKeywords) {
      enhancedInput += `- 命中关键词: ${ruleResult.matchedKeywords.join(", ")}\n`;
    }
    enhancedInput += `\n请基于以上参考和你的分析，结合具体场景语境，输出最终的关系判断 JSON。`;
    enhancedInput += `\n注意：词典预判仅作为参考，如果场景语境与词典有出入，请以实际语境为准进行调整。`;
  }

  const { content, tokens } = await callDeepSeek(soulContent, enhancedInput, {
    temperature: 0.1,
    maxTokens: 350,
  });

  const parsed = parseResponse(content);
  return { raw: content, parsed, tokens };
}

// ============================================================
// 步骤3: 混合编排 — 规则(0.3) + LLM(0.7) → 合并输出
// ============================================================

/**
 * 混合分析: 规则词典(权重0.3) → 注入LLM prompt → LLM精调(权重0.7) → 合并输出
 *
 * 流程:
 *   1. 规则层先用关键词匹配查词典，得到基准值
 *   2. 将规则结果注入 LLM prompt 作为上下文提示
 *   3. LLM 在规则参考的基础上进行精调判断
 *   4. 如果 LLM 成功，以 LLM 结果为准（规则已融入 prompt）
 *   5. 如果 LLM 失败，降级为纯规则结果
 *
 * @param {string} scenario - 用户输入的社交场景描述
 * @returns {object} { raw, parsed, ruleResult, tokens, source, confidence }
 */
async function hybridAnalyze(scenario) {
  console.error(color(C.cyan, "\n  🔀 M2 混合分析: 规则(0.3) + LLM(0.7)"));

  // ---- 阶段 A: 规则匹配 (权重 0.3) ----
  console.error(color(C.dim, "  ├─ 📖 [阶段A] 规则词典匹配..."));
  const ruleResult = ruleMatch(scenario);

  // W4 Day 25: 双重关系检测
  const dualRelation = detectDualRelationship(ruleResult, scenario);

  // ---- 阶段 B + C: LLM 精调 (权重 0.7) ----
  console.error(color(C.dim, "  ├─ 🤖 [阶段B/C] LLM精调 (已注入规则参考)..."));
  let llmResult = null;
  let llmError = null;

  try {
    llmResult = await judgeRelationship(scenario, ruleResult);
  } catch (error) {
    llmError = error;
    console.error(color(C.yellow, `  ⚠️ LLM 精调失败: ${error.message}`));
  }

  // ---- 阶段 D: 合并输出 ----
  console.error(color(C.dim, "  └─ 🔀 [阶段D] 合并输出..."));

  if (llmResult && llmResult.parsed) {
    // LLM 成功: 以 LLM 结果为主 (规则已作为参考注入 prompt)
    const merged = {
      raw: llmResult.raw,
      parsed: llmResult.parsed,
      dualRelation, // W4: 双重关系信息
      ruleResult: {
        matched: ruleResult.matched,
        type: ruleResult.entry.type,
        intimacy: ruleResult.entry.intimacy,
        power: ruleResult.entry.power,
        interest: ruleResult.entry.interest,
        source: ruleResult.source,
        matchedKeywords: ruleResult.matchedKeywords || [],
      },
      tokens: llmResult.tokens,
      source: "LLM精调(规则参考已注入)",
      weights: { rule: RULE_WEIGHT, llm: LLM_WEIGHT },
    };

    // 打印合并对比
    console.error(color(C.dim, `    📖 规则(0.3): ${ruleResult.entry.type} | ${ruleResult.entry.intimacy} | ${ruleResult.entry.power} | ${ruleResult.entry.interest}`));
    console.error(color(C.dim, `    🤖 LLM(0.7): ${llmResult.parsed["关系类型"]} | ${llmResult.parsed["亲密度"]} | ${llmResult.parsed["权力关系"]} | ${llmResult.parsed["利益关联"]}`));

    // 检查规则与 LLM 是否一致
    const typeAgreement = ruleResult.matched &&
      ruleResult.entry.type === llmResult.parsed["关系类型"];
    if (!typeAgreement && ruleResult.matched) {
      console.error(color(C.yellow, `    ⚠️ 规则与LLM判断不一致 → 以LLM为准（LLM权重0.7）`));
    } else if (typeAgreement) {
      console.error(color(C.green, `    ✅ 规则与LLM判断一致 → 高置信度`));
    }

    return merged;
  }

  // LLM 失败: 降级为纯规则结果
  console.error(color(C.yellow, "  ⚠️ LLM 不可用，降级为纯规则匹配结果"));
  const fallbackParsed = {
    "关系类型": ruleResult.entry.type,
    "亲密度": ruleResult.entry.intimacy,
    "权力关系": ruleResult.entry.power,
    "利益关联": ruleResult.entry.interest,
    "表达敏感度": ruleResult.entry.sensitivity || "中敏感",
    "建议策略": ruleResult.entry.strategy || "保持礼貌和真诚",
    "注意事项": ruleResult.entry.caution || "避免伤害对方感情",
  };

  return {
    raw: JSON.stringify(fallbackParsed),
    parsed: fallbackParsed,
    dualRelation, // W4: 双重关系信息
    ruleResult: {
      matched: ruleResult.matched,
      type: ruleResult.entry.type,
      intimacy: ruleResult.entry.intimacy,
      power: ruleResult.entry.power,
      interest: ruleResult.entry.interest,
      source: ruleResult.source,
      matchedKeywords: ruleResult.matchedKeywords || [],
    },
    tokens: 0,
    source: "纯规则降级(LLM不可用)",
    weights: { rule: 1.0, llm: 0.0 },
    llmError: llmError ? llmError.message : null,
  };
}

// ============================================================
// 导出
// ============================================================
module.exports = {
  ruleMatch,
  judgeRelationship,
  hybridAnalyze,
  detectDualRelationship, // W4 Day 25: 双重关系检测
  callDeepSeek,
  parseResponse,
  loadRelationDict,
};
