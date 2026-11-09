/**
 * ExpressCoach AI — 数据库种子导入脚本 (scripts/seed-db.js)
 *
 * 用途:
 *   将 data/ 下的三个 JSON 数据集导入 SQLite, 让评委首次启动
 *   即可通过 /stats、/search、Web 界面看到真实历史数据。
 *
 * 数据来源 (全部为团队标注/整理的数据资产):
 *   - data/seed-cases.json          91 条种子案例 (场景+意图+风格化回复)
 *   - data/golden-cases.json        120 条黄金案例 (用户评分≥3的真实使用记录)
 *   - data/training-w5-complete.json 200 条带完整四维标注的训练数据
 *
 * 用法:
 *   node scripts/seed-db.js          # 导入 (跳过已存在的重复场景)
 *   node scripts/seed-db.js --reset  # 清空后重新导入
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDB, saveCase, saveFeedback, closeDB, getDb } from "../src/db/dao.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

const RESET = process.argv.includes("--reset");

// 风格标签 → 三版本列的映射 (seed-cases 的写作风格标签归入最接近的版本)
const STYLE_TO_VERSION = {
  "委婉含蓄": "mild",
  "直接坦诚": "firm",
  "幽默轻松": "eq",
};

// 意图名称归一化: 历史数据中同一意图存在两种写法, 统一为 intent-rules.json 的5种规范名
const INTENT_CANONICAL = {
  "拒绝请求": "拒绝",
  "催促对方": "催促",
  "提出反馈": "反馈",
  "设立边界": "设边界",
  "寻求帮助": "求助",
};

function canonIntent(name) {
  if (!name) return null;
  return INTENT_CANONICAL[name] || name;
}

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf-8"));
}

/**
 * 训练数据载入：优先用扩充后的 1000 条版本，缺失则回退到 200 条种子版。
 * （需求3 数据扩充后由 generate-data.js 产出 training-w6-expanded.json）
 */
function loadTrainingData() {
  const candidates = ["training-w6-expanded.json", "training-w5-complete.json"];
  for (const c of candidates) {
    const p = path.join(DATA_DIR, c);
    if (fs.existsSync(p)) {
      console.log(`  训练数据源: ${c}`);
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  }
  return [];
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    });
  });
}

async function resetTables() {
  await runAsync("DELETE FROM feedback");
  await runAsync("DELETE FROM cases");
  console.log("  🗑️  已清空 cases / feedback 表");
}

async function importSeedCases(rows) {
  let inserted = 0;
  for (const r of rows) {
    const dup = await allAsync("SELECT id FROM cases WHERE scenario = ? LIMIT 1", [r.scenario]);
    if (dup.length > 0) continue;
    const versionCol = STYLE_TO_VERSION[r.style] || "eq";
    await saveCase({
      scenario: r.scenario,
      intentType: canonIntent(r.intent),
      [`version${versionCol[0].toUpperCase()}${versionCol.slice(1)}`]: r.response || null,
    });
    inserted++;
  }
  return inserted;
}

async function importGoldenCases(rows) {
  let inserted = 0;
  for (const g of rows) {
    const dup = await allAsync(
      "SELECT id FROM cases WHERE scenario = ? AND relation_type = ? LIMIT 1",
      [g.scenario, g.relationType || ""]
    );
    if (dup.length > 0) continue;
    const versionCol = ["mild", "firm", "eq"].includes(g.selectedVersion) ? g.selectedVersion : "eq";
    const caseId = await saveCase({
      scenario: g.scenario,
      intentType: canonIntent(g.intentType),
      relationType: g.relationType || null,
      [`version${versionCol[0].toUpperCase()}${versionCol.slice(1)}`]: g.replyContent || null,
    });
    if (g.rating) {
      await saveFeedback(caseId, versionCol, g.rating, g.comment || null);
    }
    if (g.timestamp) {
      await runAsync("UPDATE cases SET created_at = ? WHERE id = ?", [g.timestamp, caseId]);
    }
    inserted++;
  }
  return inserted;
}

async function importTrainingRows(rows) {
  let inserted = 0;
  for (const t of rows) {
    const dup = await allAsync("SELECT id FROM cases WHERE scenario = ? LIMIT 1", [t.scenario]);
    if (dup.length > 0) continue;
    await saveCase({
      scenario: t.scenario,
      intentType: canonIntent(t.intent),
      relationType: t.relationType || null,
      relationIntimacy: t.intimacy || null,
      relationPower: t.power || null,
      relationInterest: t.interest || null,
    });
    inserted++;
  }
  return inserted;
}

async function main() {
  console.log("\n  ExpressCoach AI — 数据库种子导入\n");

  await initDB();
  if (RESET) await resetTables();

  const seedInserted = await importSeedCases(loadJson("seed-cases.json"));
  const goldInserted = await importGoldenCases(loadJson("golden-cases.json"));
  const trainInserted = await importTrainingRows(loadTrainingData());

  const [{ c: totalCases }] = await allAsync("SELECT COUNT(*) AS c FROM cases");
  const [{ c: totalFeedback }] = await allAsync("SELECT COUNT(*) AS c FROM feedback");
  const byIntent = await allAsync(
    "SELECT intent_type, COUNT(*) AS c FROM cases GROUP BY intent_type ORDER BY c DESC"
  );

  console.log("\n  ========== 导入结果 ==========");
  console.log(`  种子案例导入:   ${seedInserted} 条 (去重后)`);
  console.log(`  黄金案例导入:   ${goldInserted} 条 (含评分反馈)`);
  console.log(`  训练数据导入:   ${trainInserted} 条 (带四维标注)`);
  console.log("  ------------------------------");
  console.log(`  cases 表现有:   ${totalCases} 条`);
  console.log(`  feedback 表现有: ${totalFeedback} 条`);
  console.log("  意图分布:");
  for (const row of byIntent) {
    console.log(`    ${row.intent_type || "(未标注)"}: ${row.c} 条`);
  }
  console.log("");

  await closeDB();
}

main().catch((err) => {
  console.error("  ❌ 种子导入失败:", err);
  process.exit(1);
});
