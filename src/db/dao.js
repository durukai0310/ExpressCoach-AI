/**
 * ExpressCoach AI — SQLite DAO 层 (W2 Day 12)
 *
 * 职责:
 *   - initDB()         — 初始化数据库, 执行 schema.sql, 启用 WAL 模式
 *   - saveCase()       — 保存一次完整分析记录到 cases 表
 *   - searchCases()    — 按关键词搜索历史案例
 *   - getRecentCases() — 获取最近 N 条案例
 *   - saveFeedback()   — 保存用户对某版本回复的评分反馈
 *
 * 数据库文件: data/expresscoach.sqlite
 * 使用 sqlite3 回调 API (CommonJS 风格)
 */

import sqlite3Pkg from "sqlite3";
const sqlite3 = sqlite3Pkg.verbose();

// Suppress diagnostic noise in Notion-style mode
const _log = console.log, _err = console.error;
const Q = !process.env.EXPRESSCOACH_VERBOSE;
function dlog(...a) { if (!Q) _log(...a); }
function derr(...a) { if (!Q) _err(...a); }
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename);

// ============================================================
// 路径配置
// ============================================================
const __dirname = __dirname2;
const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const DB_PATH = path.join(DATA_DIR, "expresscoach.sqlite");
const SCHEMA_PATH = path.resolve(__dirname, "schema.sql");

// ============================================================
// 数据库实例 (懒初始化, 单例)
// ============================================================
let db = null;

function getDb() {
  if (!db) {
    // 确保 data 目录存在
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new sqlite3.Database(DB_PATH);
  }
  return db;
}

// ============================================================
// initDB() — 初始化数据库
// ============================================================
function initDB() {
  return new Promise((resolve, reject) => {
    const database = getDb();

    // 1. 启用 WAL 模式
    database.run("PRAGMA journal_mode=WAL;", (err) => {
      if (err) {
        derr(`  ⚠️ WAL 模式启用失败: ${err.message}`);
      }
    });

    // 2. 启用外键约束
    database.run("PRAGMA foreign_keys=ON;", (err) => {
      if (err) {
        derr(`  ⚠️ 外键约束启用失败: ${err.message}`);
      }
    });

    // 3. 读取并执行 schema.sql
    const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf-8");

    // sqlite3 不支持多语句 exec, 我们使用 db.exec (如果可用) 或手动分割
    database.exec(schemaSql, (err) => {
      if (err) {
        derr(`  ❌ Schema 执行失败: ${err.message}`);
        reject(err);
        return;
      }

      dlog(`  ✅ SQLite 数据库初始化完成`);
      dlog(`  📁 数据库文件: ${DB_PATH}`);
      dlog(`  📋 已创建 3 张表: cases / feedback / preferences`);
      dlog(`  ⚡ WAL 模式已启用`);
      resolve(database);
    });
  });
}

// ============================================================
// saveCase() — 保存一次完整分析记录
// ============================================================
function saveCase(record) {
  return new Promise((resolve, reject) => {
    const database = getDb();
    const sql = `
      INSERT INTO cases (
        scenario,
        intent_type, intent_confidence,
        relation_type, relation_intimacy, relation_power,
        relation_interest, relation_sensitivity, relation_confidence,
        version_mild, version_firm, version_eq,
        jaccard_mild_firm, jaccard_mild_eq, jaccard_firm_eq,
        total_tokens, total_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      record.scenario || "",
      record.intentType || null,
      record.intentConfidence != null ? record.intentConfidence : null,
      record.relationType || null,
      record.relationIntimacy || null,
      record.relationPower || null,
      record.relationInterest || null,
      record.relationSensitivity || null,
      record.relationConfidence != null ? record.relationConfidence : null,
      record.versionMild || null,
      record.versionFirm || null,
      record.versionEq || null,
      record.jaccardMildFirm != null ? record.jaccardMildFirm : null,
      record.jaccardMildEq != null ? record.jaccardMildEq : null,
      record.jaccardFirmEq != null ? record.jaccardFirmEq : null,
      record.totalTokens || 0,
      record.totalTimeMs || 0,
    ];

    database.run(sql, params, function (err) {
      if (err) {
        derr(`  ⚠️ SQLite saveCase 失败: ${err.message}`);
        reject(err);
        return;
      }

      const caseId = this.lastID;
      dlog(`  💾 SQLite: 案例 #${caseId} 已保存`);
      resolve(caseId);
    });
  });
}

// ============================================================
// searchCases() — 按关键词搜索历史案例
// ============================================================
function searchCases(keyword, limit = 10) {
  return new Promise((resolve, reject) => {
    const database = getDb();
    const sql = `
      SELECT id, scenario, intent_type, relation_type, created_at
      FROM cases
      WHERE scenario LIKE ? OR intent_type LIKE ? OR relation_type LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `;
    const like = `%${keyword}%`;

    database.all(sql, [like, like, like, limit], (err, rows) => {
      if (err) {
        derr(`  ⚠️ SQLite searchCases 失败: ${err.message}`);
        reject(err);
        return;
      }

      dlog(`  🔍 搜索 "${keyword}": 找到 ${rows.length} 条匹配案例`);
      resolve(rows);
    });
  });
}

// ============================================================
// getRecentCases() — 获取最近 N 条案例
// ============================================================
function getRecentCases(limit = 10) {
  return new Promise((resolve, reject) => {
    const database = getDb();
    const sql = `
      SELECT id, scenario, intent_type, intent_confidence,
             relation_type, relation_intimacy, relation_power, relation_interest,
             total_tokens, total_time_ms, created_at
      FROM cases
      ORDER BY created_at DESC
      LIMIT ?
    `;

    database.all(sql, [limit], (err, rows) => {
      if (err) {
        derr(`  ⚠️ SQLite getRecentCases 失败: ${err.message}`);
        reject(err);
        return;
      }

      dlog(`  📋 最近 ${rows.length} 条案例已加载`);
      resolve(rows);
    });
  });
}

// ============================================================
// saveFeedback() — 保存用户对某版本回复的评分
// ============================================================
function saveFeedback(caseId, versionType, rating, comment = null) {
  return new Promise((resolve, reject) => {
    const database = getDb();
    const sql = `
      INSERT INTO feedback (case_id, version_type, rating, comment)
      VALUES (?, ?, ?, ?)
    `;

    database.run(sql, [caseId, versionType, rating, comment], function (err) {
      if (err) {
        derr(`  ⚠️ SQLite saveFeedback 失败: ${err.message}`);
        reject(err);
        return;
      }

      const feedbackId = this.lastID;
      dlog(`  ⭐ 反馈 #${feedbackId} 已保存: 案例#${caseId} ${versionType}版 → ${"★".repeat(rating)}${"☆".repeat(5 - rating)} (${rating}/5)`);
      resolve(feedbackId);
    });
  });
}

// ============================================================
// closeDB() — 关闭数据库连接
// ============================================================
function closeDB() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve();
      return;
    }
    db.close((err) => {
      if (err) {
        derr(`  ⚠️ SQLite 关闭失败: ${err.message}`);
        reject(err);
        return;
      }
      dlog(`  📁 SQLite 数据库连接已关闭`);
      db = null;
      resolve();
    });
  });
}

// ============================================================
// 导出
// ============================================================
export {
  initDB,
  saveCase,
  searchCases,
  getRecentCases,
  saveFeedback,
  closeDB,
  getDb,
  getDb as getConnection,  // W4 Day 24: 别名，供 user-profile.js 使用
  DB_PATH,
};
