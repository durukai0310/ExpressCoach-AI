#!/usr/bin/env node
/**
 * 训练数据归一化
 *
 * 修复原始数据中发现的两类缺陷（均为校验脚本 L2/L3 实测暴露，非推测）：
 *
 *  缺陷1 — 枚举词汇分裂
 *    200 条种子数据与 relation-dict.json 使用了两套不同词汇：
 *      power   : 种子「上级/平级/下级」      vs 词典「对方上位/平等/己方上位/不明」
 *      interest: 种子「强/高/中/弱/低」(5值) vs 词典「强利益/弱利益/纯情感」(3值)
 *    不统一会导致同一数据集内同义异名，规则层与标注对不上。
 *
 *  缺陷2 — 种子数据内部重复
 *    200 条种子中 #150-199 与 #100-149 完全相同，实际仅 150 条唯一。
 *
 * 处理: 枚举归一 → 去重(保留首次) → 重写文件 → 输出前后对比
 *
 * 用法:
 *   node scripts/normalize-data.js
 *   node scripts/normalize-data.js data/xxx.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

const argv = process.argv.slice(2);
const target = argv.find((a) => a.endsWith(".json") && !a.startsWith("--"));
const FILE = path.resolve(ROOT, target || "data/training-w6-expanded.json");

// ============================================================
// 词汇映射表（旧 → 词典规范）
// ============================================================
const POWER_MAP = {
  上级: "对方上位",
  平级: "平等",
  下级: "己方上位",
};

const INTEREST_MAP = {
  强: "强利益",
  高: "弱利益",
  中: "弱利益",
  弱: "纯情感",
  低: "纯情感",
};

const INTENT_MAP = {
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

const VALID = {
  intimacy: ["亲密", "较近", "一般", "疏远"],
  power: ["对方上位", "平等", "己方上位", "不明"],
  interest: ["强利益", "弱利益", "纯情感"],
  difficulty: ["easy", "medium", "hard", "extreme"],
};

const norm = (s) => String(s || "").replace(/[\s，。、！？,.!?；;：:]|/g, "");

// ============================================================
async function main() {
  const rel = path.relative(ROOT, FILE);
  console.log("=".repeat(64));
  console.log("  ExpressCoach · 训练数据归一化");
  console.log("=".repeat(64));
  console.log(`\n  文件: ${rel}`);

  let data;
  try {
    data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch (e) {
    console.error(`✘ 读取失败: ${e.message}`);
    process.exit(1);
  }

  const before = {
    total: data.length,
    power: {},
    interest: {},
    intent: {},
  };
  for (const x of data) {
    before.power[x.power] = (before.power[x.power] || 0) + 1;
    before.interest[x.interest] = (before.interest[x.interest] || 0) + 1;
    before.intent[x.intent] = (before.intent[x.intent] || 0) + 1;
  }

  // ---- 1. 枚举归一 ----
  let enumFixed = 0;
  const normalized = data.map((x) => {
    const y = { ...x };
    if (y.power && POWER_MAP[y.power]) { y.power = POWER_MAP[y.power]; enumFixed++; }
    if (y.interest && INTEREST_MAP[y.interest]) { y.interest = INTEREST_MAP[y.interest]; enumFixed++; }
    if (y.intent && INTENT_MAP[y.intent]) y.intent = INTENT_MAP[y.intent];
    if (y.expectedIntent && INTENT_MAP[y.expectedIntent]) y.expectedIntent = INTENT_MAP[y.expectedIntent];

    // expectedRelation 形如「父母-亲密-对方上位」，同步归一其权力段
    if (typeof y.expectedRelation === "string" && y.expectedRelation.includes("-")) {
      const parts = y.expectedRelation.split("-");
      if (parts.length >= 3 && POWER_MAP[parts[2]]) {
        parts[2] = POWER_MAP[parts[2]];
        y.expectedRelation = parts.join("-");
      }
    }
    return y;
  });

  // ---- 2. 去重（保留首次出现）----
  const seen = new Set();
  const deduped = [];
  let removed = 0;
  for (const x of normalized) {
    const k = norm(x.scenario);
    if (seen.has(k)) { removed++; continue; }
    seen.add(k);
    deduped.push(x);
  }

  // ---- 3. 写出 ----
  fs.writeFileSync(FILE, JSON.stringify(deduped, null, 2), "utf-8");

  const after = { power: {}, interest: {}, intent: {} };
  for (const x of deduped) {
    after.power[x.power] = (after.power[x.power] || 0) + 1;
    after.interest[x.interest] = (after.interest[x.interest] || 0) + 1;
    after.intent[x.intent] = (after.intent[x.intent] || 0) + 1;
  }

  console.log(`\n  归一化前: ${before.total} 条`);
  console.log(`  枚举修正: ${enumFixed} 处`);
  console.log(`  去重移除: ${removed} 条`);
  console.log(`  归一化后: ${deduped.length} 条`);

  console.log("\n  power 分布:");
  console.log("    修正前:", JSON.stringify(before.power));
  console.log("    修正后:", JSON.stringify(after.power));

  console.log("\n  interest 分布:");
  console.log("    修正前:", JSON.stringify(before.interest));
  console.log("    修正后:", JSON.stringify(after.interest));

  console.log("\n  intent 分布:");
  console.log("    修正后:", JSON.stringify(after.intent));

  const sources = {};
  for (const x of deduped) sources[x.source || "(无)"] = (sources[x.source || "(无)"] || 0) + 1;
  console.log("\n  数据来源构成:");
  console.log("   ", JSON.stringify(sources));

  console.log("\n" + "=".repeat(64));
  console.log("  ✔ 归一化完成");
  console.log("=".repeat(64) + "\n");
}

main().catch((e) => {
  console.error("✘ 归一化失败:", e.message);
  process.exit(1);
});
