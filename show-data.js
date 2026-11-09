#!/usr/bin/env node
/**
 * 素材5 — 数据文件完整内容展示
 * 用法: node show-data.js
 * 展示: 黄金案例库 / 关系词典 / 训练数据 / SQLite
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env"), quiet: true });

const DATA_DIR = path.resolve(__dirname, "data");
const { C, color } = require("./src/lib/color");

function waitEnter() {
  const readline = require("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question("", () => { rl.close(); resolve(); }));
}

async function main() {
  console.log("");
  console.log(color(C.bold, "╔══════════════════════════════════════════════════════════╗"));
  console.log(color(C.bold, "║    📊 ExpressCoach 数据体系 — 完整内容展示                 ║"));
  console.log(color(C.bold, "╚══════════════════════════════════════════════════════════╝"));

  // ═══════════════════════════════════════════════════════════
  // 1. 黄金案例库 golden-cases.json
  // ═══════════════════════════════════════════════════════════
  const golden = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "golden-cases.json"), "utf-8"));
  console.log("");
  console.log(color(C.yellow, "═══════════════════════════════════════════════════════════"));
  console.log(color(C.bold, `  🏆 黄金案例库 — 共 ${golden.length} 条（人工评分精选）`));
  console.log(color(C.yellow, "═══════════════════════════════════════════════════════════"));

  for (let i = 0; i < Math.min(8, golden.length); i++) {
    const g = golden[i];
    const ver = g.selectedVersion === "eq" ? "高情商版" : g.selectedVersion === "mild" ? "温和版" : g.selectedVersion === "firm" ? "坚定版" : g.selectedVersion;
    console.log("");
    console.log(color(C.cyan, `  📋 #${i + 1}`));
    console.log(color(C.bold, `     场景: ${g.scenario}`));
    if (g.intentType) console.log(color(C.dim, `     意图: ${g.intentType}`));
    if (g.relationType) console.log(color(C.dim, `     关系: ${g.relationType}`));
    console.log(color(C.dim, `     最佳版本: ${ver}`));
    console.log(color(C.green, `     ⭐ ${g.rating}/5 分`));
  }
  if (golden.length > 8) console.log(color(C.dim, `\n  ... 还有 ${golden.length - 8} 条`));
  console.log("");
  console.log(color(C.dim, "  （按 Enter 继续看关系词典）"));
  await waitEnter();

  // ═══════════════════════════════════════════════════════════
  // 2. 关系词典 relation-dict.json
  // ═══════════════════════════════════════════════════════════
  const dictRaw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "relation-dict.json"), "utf-8"));
  // 实际关系数据在 dictRaw.relationships 数组里
  const relationships = Array.isArray(dictRaw.relationships) ? dictRaw.relationships : [];
  console.log("");
  console.log(color(C.yellow, "═══════════════════════════════════════════════════════════"));
  console.log(color(C.bold, `  📖 关系词典 — ${relationships.length} 种中文社交关系`));
  console.log(color(C.dim, `     ${dictRaw.description || ""}`));
  console.log(color(C.yellow, "═══════════════════════════════════════════════════════════"));

  // 按亲密度分组
  const byIntimacy = {};
  for (const item of relationships) {
    const intimacy = item.intimacy || "?";
    if (!byIntimacy[intimacy]) byIntimacy[intimacy] = [];
    byIntimacy[intimacy].push(item);
  }

  const order = ["亲密", "较近", "一般", "疏远"];
  for (const intimacy of [...order, ...Object.keys(byIntimacy).filter(k => !order.includes(k))]) {
    if (!byIntimacy[intimacy]) continue;
    console.log("");
    console.log(color(C.bold, `  【${intimacy}】(共 ${byIntimacy[intimacy].length} 种)`));
    for (const r of byIntimacy[intimacy]) {
      const power = r.power || "?";
      const interest = r.interest || "?";
      const sens = r.sensitivity || "?";
      const mod = r.sensitivityModifier != null ? (r.sensitivityModifier > 0 ? "+" + r.sensitivityModifier : r.sensitivityModifier) : "";
      console.log(color(C.dim, `    ${r.type.padEnd(8)} 权力: ${power.padEnd(6)} 利益: ${interest.padEnd(6)} 敏感度: ${sens.padEnd(6)} ${mod}`));
    }
  }
  console.log("");
  console.log(color(C.dim, "  四维标注: 亲密度 × 权力关系 × 利益关联 × 文化区域"));
  console.log(color(C.dim, "  （按 Enter 继续看训练数据）"));
  await waitEnter();

  // ═══════════════════════════════════════════════════════════
  // 3. 训练数据 training-w5-complete.json
  // ═══════════════════════════════════════════════════════════
  const training = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "training-w5-complete.json"), "utf-8"));
  console.log("");
  console.log(color(C.yellow, "═══════════════════════════════════════════════════════════"));
  console.log(color(C.bold, `  📚 训练数据集 (W5) — ${training.length} 条`));
  console.log(color(C.yellow, "═══════════════════════════════════════════════════════════"));

  // 按意图分组
  const byIntent = {};
  for (const t of training) {
    const intent = t.intent || t.intentType || "其他";
    if (!byIntent[intent]) byIntent[intent] = [];
    byIntent[intent].push(t);
  }

  for (const [intent, samples] of Object.entries(byIntent)) {
    console.log("");
    console.log(color(C.bold, `  【${intent}】(${samples.length} 条)`));
    for (const s of samples.slice(0, 4)) {
      const text = s.scenario || s.text || s.input || "";
      const rel = s.relationType || s.relation || "";
      console.log(color(C.dim, `    └ ${text.substring(0, 60)}`));
      if (rel) console.log(color(C.dim, `      关系: ${rel}`));
    }
    if (samples.length > 4) console.log(color(C.dim, `    ... 还有 ${samples.length - 4} 条`));
  }

  // ═══════════════════════════════════════════════════════════
  // 4. SQLite 数据库
  // ═══════════════════════════════════════════════════════════
  console.log("");
  console.log(color(C.yellow, "═══════════════════════════════════════════════════════════"));
  console.log(color(C.bold, "  🗄️  SQLite 本地数据库"));
  console.log(color(C.yellow, "═══════════════════════════════════════════════════════════"));
  const sqlitePath = path.join(DATA_DIR, "expresscoach.sqlite");
  const stat = fs.statSync(sqlitePath);
  console.log(color(C.dim, `     ${sqlitePath}`));
  console.log(color(C.dim, `     大小: ${(stat.size / 1024).toFixed(0)} KB  |  WAL 模式`));
  console.log(color(C.dim, "     表: cases（案例） | feedback（反馈） | preferences（偏好）"));

  // 汇总
  const seedPath = path.join(DATA_DIR, "seed-cases.json");
  const seed = fs.existsSync(seedPath) ? JSON.parse(fs.readFileSync(seedPath, "utf-8")) : [];
  const w4Path = path.join(DATA_DIR, "scenarios-w4-expanded.json");
  const w4 = fs.existsSync(w4Path) ? JSON.parse(fs.readFileSync(w4Path, "utf-8")) : [];
  const totalScenarios = golden.length + training.length + seed.length + w4.length;

  console.log("");
  console.log(color(C.bold, "╔══════════════════════════════════════════════════════════╗"));
  console.log(color(C.bold, `║  总计: 黄金${golden.length}条 | 关系${relKeys.length}种 | 训练${training.length}条 | 种子${seed.length}+${w4.length}条 | 累计${totalScenarios}条  ║`));
  console.log(color(C.bold, "║  全部离线可用 — 无云端依赖                               ║"));
  console.log(color(C.bold, "╚══════════════════════════════════════════════════════════╝"));
  console.log("");
}

main().catch(e => { console.error(e); process.exit(1); });
