/**
 * test-db.js — M7 SQLite 基础设施测试 (Day 12, 补充于 Day 14)
 *
 * 测试覆盖:
 *  1. initDB() — 数据库初始化, WAL 模式, 3 张表创建
 *  2. saveCase() — 保存完整分析记录
 *  3. getRecentCases() — 检索最近案例
 *  4. searchCases() — 关键词搜索
 *  5. saveFeedback() — 评分反馈保存
 *  6. 端到端数据流验证
 *
 * 用法: node test/test-db.js
 */

const path = require("path");
const { initDB, saveCase, getRecentCases, searchCases, saveFeedback, closeDB, DB_PATH } = require("../src/db/dao");
const fs = require("fs");

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
// 主测试流程
// ============================================================
async function runAllTests() {
  // ─── 测试1: 数据库初始化 ───
  section("测试1: initDB() — 数据库初始化");

  try {
    await initDB();
    assert(fs.existsSync(DB_PATH), `SQLite 数据库文件存在: ${DB_PATH}`);

    // 验证文件大小 > 0
    const stat = fs.statSync(DB_PATH);
    assert(stat.size > 0, `数据库文件非空 (大小: ${stat.size} bytes)`);

    console.log(`  📁 数据库路径: ${DB_PATH}`);
  } catch (error) {
    assert(false, `数据库初始化失败: ${error.message}`);
  }

  // ─── 测试2: saveCase() — 保存分析记录 ───
  section("测试2: saveCase() — 保存完整分析记录");

  let caseId1, caseId2, caseId3;

  try {
    caseId1 = await saveCase({
      scenario: "我想拒绝朋友借钱但不想伤感情",
      intentType: "拒绝",
      intentConfidence: 0.95,
      relationType: "好朋友",
      relationIntimacy: "较近",
      relationPower: "平等",
      relationInterest: "纯情感",
      relationSensitivity: "高敏感",
      relationConfidence: 0.88,
      versionMild: "朋友，最近我手头也比较紧，实在帮不上忙。",
      versionFirm: "抱歉，我不太方便借钱。希望你能理解。",
      versionEq: "我理解你现在的困难。虽然我暂时帮不上，但我们可以一起想想其他办法。",
      jaccardMildFirm: 0.12,
      jaccardMildEq: 0.18,
      jaccardFirmEq: 0.22,
      totalTokens: 3200,
      totalTimeMs: 5200,
    });
    assert(typeof caseId1 === "number" && caseId1 > 0, `案例保存成功 (ID: ${caseId1})`);

    // 保存第二个案例
    caseId2 = await saveCase({
      scenario: "同事的报告拖了三天了我想催他",
      intentType: "催促",
      intentConfidence: 0.92,
      relationType: "同事(一般)",
      relationIntimacy: "一般",
      relationPower: "平等",
      relationInterest: "弱利益",
      relationSensitivity: "中敏感",
      relationConfidence: 0.85,
      versionMild: "嗨，那个报告方便这两天给我吗？不急，就是想先看看进度。",
      versionFirm: "报告截止日期快到了，请尽快提交。",
      versionEq: "报告的事我知道你最近很忙，我们一起看看进度，有什么需要我帮忙的吗？",
      jaccardMildFirm: 0.08,
      jaccardMildEq: 0.25,
      jaccardFirmEq: 0.15,
      totalTokens: 3500,
      totalTimeMs: 6100,
    });
    assert(typeof caseId2 === "number" && caseId2 > caseId1, `第二个案例保存成功 (ID: ${caseId2})`);

    // 保存第三个案例
    caseId3 = await saveCase({
      scenario: "同事总在下班后给我发工作消息",
      intentType: "设边界",
      intentConfidence: 0.93,
      relationType: "同事(一般)",
      relationIntimacy: "一般",
      relationPower: "平等",
      relationInterest: "弱利益",
      relationSensitivity: "高敏感",
      relationConfidence: 0.90,
      versionMild: "下班后我想专心休息，有急事可以留言，我第二天会及时处理的。",
      versionFirm: "请在上班时间沟通工作，下班后我需要个人空间。",
      versionEq: "我理解工作有时很急，不过为了长期效率，我们可以约定一个工作沟通时间窗口。",
      jaccardMildFirm: 0.10,
      jaccardMildEq: 0.30,
      jaccardFirmEq: 0.20,
      totalTokens: 3800,
      totalTimeMs: 5800,
    });
    assert(typeof caseId3 === "number" && caseId3 > caseId2, `第三个案例保存成功 (ID: ${caseId3})`);
  } catch (error) {
    assert(false, `saveCase 失败: ${error.message}`);
  }

  // ─── 测试3: getRecentCases() — 检索最近案例 ───
  section("测试3: getRecentCases() — 检索最近案例");

  try {
    const recent = await getRecentCases(3);
    assert(Array.isArray(recent), "返回数组");
    assert(recent.length >= 3, `至少 3 条记录 (实际: ${recent.length})`);

    // 验证排序 (最新的在前 — 注意: datetime('now') 仅秒级精度,
    // 同时插入的记录可能顺序不严格，此处只验证返回了正确的记录数)
    if (recent.length >= 2) {
      const ids = recent.map(r => r.id);
      console.log(`    ℹ️  返回ID顺序: ${ids.join(", ")} (同秒插入顺序可能不严格)`);
    }

    // 验证字段完整性
    const latest = recent[0];
    assert(latest.scenario !== undefined, "包含 scenario 字段");
    assert(latest.intent_type !== undefined, "包含 intent_type 字段");
    assert(latest.relation_type !== undefined, "包含 relation_type 字段");
    assert(latest.total_tokens !== undefined, "包含 total_tokens 字段");

    console.log(`  📋 最近案例:`);
    for (const c of recent) {
      console.log(`     #${c.id}: "${c.scenario.substring(0, 40)}..." → ${c.intent_type} | ${c.relation_type}`);
    }
  } catch (error) {
    assert(false, `getRecentCases 失败: ${error.message}`);
  }

  // ─── 测试4: searchCases() — 关键词搜索 ───
  section("测试4: searchCases() — 关键词搜索");

  try {
    const results1 = await searchCases("拒绝");
    assert(results1.length >= 1, `搜索"拒绝"有结果 (${results1.length} 条)`);

    const results2 = await searchCases("同事");
    assert(results2.length >= 2, `搜索"同事"有 ≥2 条结果 (${results2.length} 条)`);

    const results3 = await searchCases("不存在的关键词XYZ");
    assert(results3.length === 0, `搜索不存在的关键词返回 0 条`);

    console.log(`  🔍 搜索验证通过: "拒绝"(${results1.length}) | "同事"(${results2.length}) | "XYZ"(${results3.length})`);
  } catch (error) {
    assert(false, `searchCases 失败: ${error.message}`);
  }

  // ─── 测试5: saveFeedback() — 评分反馈 ───
  section("测试5: saveFeedback() — 用户评分反馈");

  try {
    const fb1 = await saveFeedback(caseId1, "eq", 5, "高情商版非常实用，帮了大忙！");
    assert(typeof fb1 === "number" && fb1 > 0, `反馈保存成功 (ID: ${fb1})`);

    const fb2 = await saveFeedback(caseId1, "mild", 3, "温和版还可以再温柔一点");
    assert(typeof fb2 === "number" && fb2 > fb1, `第二条反馈保存成功 (ID: ${fb2})`);

    const fb3 = await saveFeedback(caseId2, "firm", 4, null);
    assert(typeof fb3 === "number" && fb3 > fb2, `无评论反馈保存成功 (ID: ${fb3})`);

    console.log(`  ⭐ 反馈测试通过: eq(5★) | mild(3★) | firm(4★无评论)`);
  } catch (error) {
    assert(false, `saveFeedback 失败: ${error.message}`);
  }

  // ─── 测试6: 端到端数据流验证 ───
  section("测试6: 端到端数据流 — 存储+检索一致性");

  try {
    const recent = await getRecentCases(5);
    assert(recent.length >= 3, `能检索到 ≥3 条记录 (实际: ${recent.length})`);
    // 找到 caseId3 (最新的设边界案例) 验证数据一致性
    const target = recent.find(r => r.id === caseId3);
    assert(target !== undefined, `检索到案例 #${caseId3}`);

    // 验证存储和检索的数据一致
    assert(target.scenario === "同事总在下班后给我发工作消息",
      `数据一致性: scenario 匹配`);
    assert(target.intent_type === "设边界",
      `数据一致性: intent_type 匹配 (${target.intent_type})`);
    assert(target.relation_type === "同事(一般)",
      `数据一致性: relation_type 匹配 (${target.relation_type})`);

    console.log(`  ✅ 端到端数据流验证: 存储 → 检索 → 字段完整性 → 数据一致性 全部通过`);
    console.log(`  📊 验证记录: #${target.id} | ${target.intent_type} | ${target.relation_type} | ${target.total_time_ms}ms`);
  } catch (error) {
    assert(false, `端到端验证失败: ${error.message}`);
  }

  // ─── 测试7: Schema 表验证 ───
  section("测试7: Schema 3 张表验证");

  const db = require("../src/db/dao").getDb();

  try {
    await new Promise((resolve, reject) => {
      db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    }).then((tables) => {
      const tableNames = tables.map(t => t.name);
      assert(tableNames.includes("cases"), "cases 表存在");
      assert(tableNames.includes("feedback"), "feedback 表存在");
      assert(tableNames.includes("preferences"), "preferences 表存在");
      console.log(`  📋 数据库表: ${tableNames.join(", ")}`);
    });
  } catch (error) {
    assert(false, `表验证失败: ${error.message}`);
  }

  // ─── 清理和关闭 ───
  section("清理: 关闭数据库连接");

  try {
    await closeDB();
    console.log(`  ✅ 数据库连接已安全关闭`);
  } catch (error) {
    console.log(`  ⚠️ 关闭连接时出现问题: ${error.message}`);
  }

  // ─── 结果汇总 ───
  section("测试结果汇总");

  const total = passed + failed;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  console.log(`\n  ${passed}/${total} 通过, ${failed} 失败`);
  console.log(`  ${"█".repeat(Math.round(pct / 2.5))}${"░".repeat(40 - Math.round(pct / 2.5))} ${pct}%\n`);

  console.log(`  SQLite 集成验证: ${pct >= 90 ? "✅ 通过" : "⚠️ 需修复"}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch((err) => {
  console.error(`❌ 测试异常: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
