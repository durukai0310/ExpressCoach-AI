#!/usr/bin/env node
/**
 * 需求3: 训练数据校验
 *
 * 三层校验:
 *  L1 结构校验 — JSON 可解析、必需字段齐全、无空值
 *  L2 枚举校验 — 意图/关系/亲密度/权力/利益/难度 取值合法且与词典一致
 *  L3 质量校验 — 场景去重、长度合理
 *  L4 一致性   — 用规则层(RuleMatch)离线跑一遍场景，比对预测与标注的吻合度
 *                （零 API 成本，可直接作为答辩数据）
 *
 * 用法:
 *   node scripts/validate-data.js                       # 校验默认输出文件
 *   node scripts/validate-data.js data/xxx.json         # 指定文件
 *   node scripts/validate-data.js --json                # 机器可读输出
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

const argv = process.argv.slice(2);
const asJSON = argv.includes("--json");
const target = argv.find((a) => a.endsWith(".json") && !a.startsWith("--"));
const FILE = path.resolve(ROOT, target || "data/training-w6-expanded.json");

const INTIMACY_LEVELS = ["亲密", "较近", "一般", "疏远"];
const POWER_LEVELS = ["对方上位", "平等", "己方上位", "不明"];
const INTEREST_LEVELS = ["强利益", "弱利益", "纯情感"];
const DIFFICULTY_LEVELS = ["easy", "medium", "hard", "extreme"];

const REQUIRED_FIELDS = [
  "scenario", "intent", "relationType", "intimacy", "power",
  "interest", "difficulty", "expectedIntent", "expectedRelation",
  "expectedStrategy", "speakingTo",
];

const norm = (s) => String(s || "").replace(/[\s，。、！？,.!?；;：:]|/g, "");

const log = (...a) => { if (!asJSON) console.log(...a); };

async function main() {
  log("=".repeat(64));
  log("  ExpressCoach · 训练数据校验报告");
  log("=".repeat(64));
  log(`\n  文件: ${path.relative(ROOT, FILE)}\n`);

  // ---- L1 结构 ----
  let data;
  try {
    data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch (e) {
    console.error(`✘ L1 失败 — JSON 解析错误: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(data)) {
    console.error("✘ L1 失败 — 顶层不是数组");
    process.exit(1);
  }

  const results = {
    file: path.relative(ROOT, FILE),
    total: data.length,
    structure: { pass: 0, fail: 0, errors: [] },
    enum: { pass: 0, fail: 0, errors: [] },
    quality: { pass: 0, fail: 0, errors: [], duplicates: 0 },
    distribution: {},
  };

  // ---- L1: 字段完整性 ----
  data.forEach((item, i) => {
    const missing = REQUIRED_FIELDS.filter(
      (f) => item[f] === undefined || item[f] === null || item[f] === ""
    );
    if (missing.length) {
      results.structure.fail++;
      if (results.structure.errors.length < 20) {
        results.structure.errors.push({ index: i, missing });
      }
    } else {
      results.structure.pass++;
    }
  });

  log(`  L1 结构校验: 通过 ${results.structure.pass} / 失败 ${results.structure.fail}`);
  if (results.structure.errors.length) {
    log(`     示例错误: ${JSON.stringify(results.structure.errors.slice(0, 3))}`);
  }

  // ---- L2: 枚举合法性 ----
  const INTENT_CANON = {
    拒绝: "拒绝请求", 拒绝请求: "拒绝请求",
    催促: "催促对方", 催促对方: "催促对方",
    反馈: "提出反馈", 提出反馈: "提出反馈",
    设边界: "设立边界", 设立边界: "设立边界",
    求助: "寻求帮助", 寻求帮助: "寻求帮助",
  };

  data.forEach((item, i) => {
    const errs = [];
    if (item.intimacy && !INTIMACY_LEVELS.includes(item.intimacy)) errs.push(`亲密度:${item.intimacy}`);
    if (item.power && !POWER_LEVELS.includes(item.power)) errs.push(`权力:${item.power}`);
    if (item.interest && !INTEREST_LEVELS.includes(item.interest)) errs.push(`利益:${item.interest}`);
    if (item.difficulty && !DIFFICULTY_LEVELS.includes(item.difficulty)) errs.push(`难度:${item.difficulty}`);
    if (item.intent && !INTENT_CANON[item.intent]) errs.push(`意图:${item.intent}`);
    if (errs.length) {
      results.enum.fail++;
      if (results.enum.errors.length < 20) {
        results.enum.errors.push({ index: i, errs });
      }
    } else {
      results.enum.pass++;
    }
  });

  log(`  L2 枚举校验: 通过 ${results.enum.pass} / 失败 ${results.enum.fail}`);

  // ---- L3: 质量（长度 + 去重）----
  const seen = new Map();
  data.forEach((item, i) => {
    const len = String(item.scenario || "").length;
    const nk = norm(item.scenario);
    const errs = [];
    if (len < 8) errs.push(`过短(${len})`);
    if (len > 120) errs.push(`过长(${len})`);
    if (seen.has(nk)) {
      errs.push(`与第${seen.get(nk)}条重复`);
      results.quality.duplicates++;
    } else {
      seen.set(nk, i);
    }
    if (errs.length) {
      results.quality.fail++;
      if (results.quality.errors.length < 20) {
        results.quality.errors.push({ index: i, errs, scenario: String(item.scenario).slice(0, 40) });
      }
    } else {
      results.quality.pass++;
    }
  });

  log(`  L3 质量校验: 通过 ${results.quality.pass} / 失败 ${results.quality.fail}（重复 ${results.quality.duplicates} 条）`);

  // ---- L4: 规则层一致性（离线，零 API 成本）----
  let ruleStats = null;
  try {
    const { ruleMatch } = await import("../src/relationship/analyze.js");
    let typeHit = 0, intHit = 0, powHit = 0, int2Hit = 0, evaluated = 0;

    for (const item of data) {
      const expected = String(item.expectedRelation || "");
      if (!expected) continue;
      const parts = expected.split("-");
      if (parts.length < 3) continue;

      const [expType, expIntimacy, expPower] = parts;
      const expInterest = item.interest;

      const rm = ruleMatch(item.scenario);
      if (!rm || !rm.entry) continue;
      evaluated++;

      if (rm.entry.type === expType) typeHit++;
      if (rm.entry.intimacy === expIntimacy) intHit++;
      if (rm.entry.power === expPower) powHit++;
      if (rm.entry.interest === expInterest) int2Hit++;
    }

    const pct = (n) => (evaluated ? ((n / evaluated) * 100).toFixed(1) : "0.0");
    ruleStats = {
      evaluated,
      relationType: pct(typeHit),
      intimacy: pct(intHit),
      power: pct(powHit),
      interest: pct(int2Hit),
    };

    log(`\n  L4 规则层一致性（离线比对，${evaluated} 条）:`);
    log(`     关系类型: ${ruleStats.relationType}%`);
    log(`     亲密度  : ${ruleStats.intimacy}%`);
    log(`     权力关系: ${ruleStats.power}%`);
    log(`     利益关联: ${ruleStats.interest}%`);
  } catch (e) {
    log(`\n  L4 跳过 — ${e.message}`);
  }

  // ---- 分布统计 ----
  const fields = ["intent", "relationType", "intimacy", "power", "interest", "difficulty", "source"];
  for (const f of fields) {
    const counter = {};
    data.forEach((item) => {
      const v = item[f] || "(空)";
      counter[v] = (counter[v] || 0) + 1;
    });
    results.distribution[f] = counter;
  }

  log("\n  分布统计:");
  for (const f of fields) {
    const c = results.distribution[f];
    const entries = Object.entries(c).sort((a, b) => b[1] - a[1]);
    log(`     ${f}:`);
    entries.slice(0, 12).forEach(([k, v]) => {
      const bar = "#".repeat(Math.min(30, Math.ceil((v / data.length) * 100)));
      log(`        ${String(k).padEnd(14)} ${String(v).padStart(4)}  ${bar}`);
    });
    if (entries.length > 12) log(`        … 另有 ${entries.length - 12} 个取值`);
  }

  // ---- 结论 ----
  const totalFail = results.structure.fail + results.enum.fail + results.quality.fail;
  log("\n" + "=".repeat(64));
  if (totalFail === 0) {
    log(`  ✔ 全部通过 — ${results.total} 条数据无结构/枚举/质量问题`);
  } else {
    log(`  ⚠ 存在 ${totalFail} 项问题，详见上方各层错误列表`);
  }
  log("=".repeat(64));

  if (asJSON) {
    console.log(JSON.stringify({ ...results, ruleConsistency: ruleStats }, null, 2));
  }
}

main().catch((e) => {
  console.error("✘ 校验失败:", e.message);
  process.exit(1);
});
