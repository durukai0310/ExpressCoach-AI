/**
 * 用户画像系统 — src/memory/user-profile.js (W4 Day 24)
 *
 * 功能:
 *   - 创建/加载用户画像
 *   - 自动记录每次分析的历史
 *   - 从历史中推断用户偏好 (最常用意图、最爱版本风格)
 *   - 关系图谱: 记录用户常打交道的人
 *
 * 存储: SQLite (复用 src/db/dao.js 的连接)
 */

const path = require("path");

let db = null;

function getDb() {
  if (!db) {
    try {
      const dao = require("../db/dao");
      db = dao;
    } catch (e) {
      throw new Error(`SQLite DAO 不可用: ${e.message}`);
    }
  }
  return db;
}

// ============================================================
// 用户画像 CRUD
// ============================================================

/**
 * 创建新用户画像
 */
async function createProfile(name, initialPrefs = {}) {
  const dao = getDb();
  const dbConn = await dao.getConnection();

  return new Promise((resolve, reject) => {
    dbConn.run(
      `INSERT INTO user_profiles (name, preferred_style, common_intents, tone_preferences, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        name,
        initialPrefs.preferred_style || "eq",
        JSON.stringify(initialPrefs.common_intents || []),
        JSON.stringify(initialPrefs.tone_preferences || { formality: 0.6, directness: 0.4, warmth: 0.7 }),
      ],
      function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, name });
      }
    );
  });
}

/**
 * 获取用户画像
 */
async function getProfile(id) {
  const dao = getDb();
  const dbConn = await dao.getConnection();

  return new Promise((resolve, reject) => {
    dbConn.get(`SELECT * FROM user_profiles WHERE id = ?`, [id], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);

      // 解析 JSON 字段
      try { row.common_intents = JSON.parse(row.common_intents); } catch (e) { row.common_intents = []; }
      try { row.tone_preferences = JSON.parse(row.tone_preferences); } catch (e) { row.tone_preferences = {}; }

      resolve(row);
    });
  });
}

/**
 * 列出所有用户画像
 */
async function listProfiles() {
  const dao = getDb();
  const dbConn = await dao.getConnection();

  return new Promise((resolve, reject) => {
    dbConn.all(`SELECT id, name, preferred_style, total_sessions, updated_at FROM user_profiles ORDER BY updated_at DESC`, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * 更新用户偏好
 */
async function updatePreferences(id, data) {
  const dao = getDb();
  const dbConn = await dao.getConnection();

  const fields = [];
  const values = [];

  if (data.preferred_style !== undefined) {
    fields.push("preferred_style = ?");
    values.push(data.preferred_style);
  }
  if (data.common_intents !== undefined) {
    fields.push("common_intents = ?");
    values.push(JSON.stringify(data.common_intents));
  }
  if (data.tone_preferences !== undefined) {
    fields.push("tone_preferences = ?");
    values.push(JSON.stringify(data.tone_preferences));
  }

  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  return new Promise((resolve, reject) => {
    dbConn.run(`UPDATE user_profiles SET ${fields.join(", ")} WHERE id = ?`, [...values, id], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// ============================================================
// 分析历史记录
// ============================================================

/**
 * 记录一次分析
 */
async function recordAnalysis(profileId, data) {
  const dao = getDb();
  const dbConn = await dao.getConnection();

  const { scenario, intentType, relationType, chosenVersion, rating, tokens, duration } = data;

  return new Promise((resolve, reject) => {
    dbConn.run(
      `INSERT INTO analysis_history (profile_id, scenario, intent_type, relation_type, chosen_version, rating, tokens, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [profileId, scenario, intentType || null, relationType || null, chosenVersion || null, rating || null, tokens || 0, duration || 0],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

/**
 * 获取用户的分析历史
 */
async function getHistory(profileId, limit = 20) {
  const dao = getDb();
  const dbConn = await dao.getConnection();

  return new Promise((resolve, reject) => {
    dbConn.all(
      `SELECT * FROM analysis_history WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?`,
      [profileId, limit],
      (err, rows) => { if (err) return reject(err); resolve(rows || []); }
    );
  });
}

// ============================================================
// 自动推断用户偏好
// ============================================================

/**
 * 从历史记录中推断用户偏好
 */
async function inferPreferences(profileId) {
  const history = await getHistory(profileId, 50);
  if (history.length === 0) return null;

  // 统计意图频次
  const intentCount = {};
  const versionCount = {};
  const ratingSum = {};
  const ratingNum = {};

  for (const h of history) {
    if (h.intent_type) {
      intentCount[h.intent_type] = (intentCount[h.intent_type] || 0) + 1;
    }
    if (h.chosen_version) {
      versionCount[h.chosen_version] = (versionCount[h.chosen_version] || 0) + 1;
      if (h.rating) {
        ratingSum[h.chosen_version] = (ratingSum[h.chosen_version] || 0) + h.rating;
        ratingNum[h.chosen_version] = (ratingNum[h.chosen_version] || 0) + 1;
      }
    }
  }

  // 最常用意图 (Top 3)
  const topIntents = Object.entries(intentCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  // 最爱版本风格 (选最多的)
  const topVersion = Object.entries(versionCount)
    .sort((a, b) => b[1] - a[1])[0];

  const preferred = topVersion ? topVersion[0] : "eq";

  // 平均评分
  const avgRatings = {};
  for (const [v, sum] of Object.entries(ratingSum)) {
    avgRatings[v] = parseFloat((sum / (ratingNum[v] || 1)).toFixed(1));
  }

  return {
    topIntents,
    preferredStyle: preferred,
    avgRatings,
    totalAnalyses: history.length,
    lastActive: history[0]?.created_at || null,
  };
}

// ============================================================
// 增量更新 (每次分析结束后调用)
// ============================================================

async function postAnalysisUpdate(profileId, analysisData) {
  // 1. 记录本次分析
  await recordAnalysis(profileId, analysisData);

  // 2. 增加 session 计数
  const dao = getDb();
  const dbConn = await dao.getConnection();
  dbConn.run(`UPDATE user_profiles SET total_sessions = total_sessions + 1, updated_at = datetime('now') WHERE id = ?`, [profileId]);

  // 3. 每10次分析自动重推断偏好
  const profile = await getProfile(profileId);
  if (profile && profile.total_sessions % 10 === 0) {
    const inferred = await inferPreferences(profileId);
    if (inferred) {
      await updatePreferences(profileId, {
        preferred_style: inferred.preferredStyle,
        common_intents: inferred.topIntents,
      });
      console.log(`  🧠 已自动更新用户偏好: 风格=${inferred.preferredStyle}, Top意图=${inferred.topIntents.join('/')}`);
    }
  }
}

// ============================================================
// 初始化数据库表 (首次使用时调用)
// ============================================================

async function initProfileTables() {
  const dao = getDb();
  const dbConn = await dao.getConnection();

  const createUserProfiles = `
    CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      preferred_style TEXT DEFAULT 'eq',
      common_intents TEXT DEFAULT '[]',
      tone_preferences TEXT DEFAULT '{}',
      total_sessions INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )`;

  const createAnalysisHistory = `
    CREATE TABLE IF NOT EXISTS analysis_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER,
      scenario TEXT,
      intent_type TEXT,
      relation_type TEXT,
      chosen_version TEXT,
      rating INTEGER,
      tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      created_at TEXT,
      FOREIGN KEY(profile_id) REFERENCES user_profiles(id)
    )`;

  return new Promise((resolve, reject) => {
    dbConn.serialize(() => {
      dbConn.run(createUserProfiles, (err) => {
        if (err) { reject(err); return; }
        dbConn.run(createAnalysisHistory, (err2) => {
          if (err2) { reject(err2); return; }
          resolve();
        });
      });
    });
  });
}

module.exports = {
  createProfile,
  getProfile,
  listProfiles,
  updatePreferences,
  recordAnalysis,
  getHistory,
  inferPreferences,
  postAnalysisUpdate,
  initProfileTables,
};
