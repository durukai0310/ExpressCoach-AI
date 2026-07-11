import { getDb } from './init.js';

// sql.js API wrapper - mimics better-sqlite3 interface
function prepare(sql) {
  return {
    get(...params) {
      const stmt = getDb().prepare(sql);
      stmt.bind(params);
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        stmt.free();
        const obj = {};
        cols.forEach((c, i) => { obj[c] = vals[i]; });
        return obj;
      }
      stmt.free();
      return undefined;
    },
    all(...params) {
      const results = [];
      const stmt = getDb().prepare(sql);
      stmt.bind(params);
      const cols = stmt.getColumnNames();
      while (stmt.step()) {
        const vals = stmt.get();
        const obj = {};
        cols.forEach((c, i) => { obj[c] = vals[i]; });
        results.push(obj);
      }
      stmt.free();
      return results;
    },
    run(...params) {
      const stmt = getDb().prepare(sql);
      stmt.bind(params);
      stmt.step();
      stmt.free();
      // Get lastInsertRowId from a separate query
      const r = getDb().exec('SELECT last_insert_rowid() as id');
      return { lastInsertRowid: r[0]?.values[0]?.[0] || 0, changes: getDb().getRowsModified() };
    },
  };
}

// ========== Users ==========
const userDao = {
  findBySessionId(sessionId) {
    return prepare('SELECT * FROM users WHERE session_id = ?').get(sessionId);
  },
  create(sessionId, nickname) {
    prepare('INSERT INTO users (session_id, nickname) VALUES (?, ?)').run(sessionId, nickname || null);
    return this.findBySessionId(sessionId);
  },
  updateLastSeen(sessionId) {
    prepare("UPDATE users SET last_seen = datetime('now', 'localtime') WHERE session_id = ?").run(sessionId);
  },
  count() {
    return prepare('SELECT COUNT(*) as count FROM users').get().count;
  },
  findById(id) {
    return prepare('SELECT * FROM users WHERE id = ?').get(id);
  },
};

// ========== Conversations ==========
const conversationDao = {
  create(userId, role, content, category, tokensUsed) {
    const r = prepare('INSERT INTO conversations (user_id, role, content, category, tokens_used) VALUES (?, ?, ?, ?, ?)').run(userId, role, content, category || 'general', tokensUsed || 0);
    return prepare('SELECT * FROM conversations WHERE id = ?').get(r.lastInsertRowid);
  },
  getByUserId(userId, limit) {
    return prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at ASC LIMIT ?').all(userId, limit || 50);
  },
  deleteByUserId(userId) {
    return prepare('DELETE FROM conversations WHERE user_id = ?').run(userId);
  },
  countToday() {
    return prepare("SELECT COUNT(*) as count FROM conversations WHERE date(created_at) = date('now', 'localtime')").get().count;
  },
  totalCount() {
    return prepare('SELECT COUNT(*) as count FROM conversations').get().count;
  },
  dailyCounts(days) {
    return prepare(`SELECT date(created_at) as day, COUNT(*) as count FROM conversations WHERE created_at >= datetime('now', '-' || ? || ' days', 'localtime') GROUP BY date(created_at) ORDER BY day ASC`).all(days || 7);
  },
};

// ========== Surveys ==========
const surveyDao = {
  getAll() {
    return prepare('SELECT * FROM surveys WHERE is_active = 1 ORDER BY created_at DESC').all();
  },
  getById(id) {
    const survey = prepare('SELECT * FROM surveys WHERE id = ?').get(id);
    if (survey) {
      try { survey.questions = JSON.parse(survey.questions); } catch (e) {}
    }
    return survey;
  },
  submitResponse(surveyId, userId, answers) {
    return prepare('INSERT INTO survey_responses (survey_id, user_id, answers) VALUES (?, ?, ?)').run(surveyId, userId, JSON.stringify(answers));
  },
  getResponses() {
    return prepare('SELECT sr.*, s.title as survey_title FROM survey_responses sr JOIN surveys s ON sr.survey_id = s.id ORDER BY sr.created_at DESC').all();
  },
  responseCount(surveyId) {
    const where = surveyId ? 'WHERE survey_id = ?' : '';
    const params = surveyId ? [surveyId] : [];
    const stmt = getDb().prepare(`SELECT COUNT(*) as count FROM survey_responses ${where}`);
    stmt.bind(params);
    if (stmt.step()) { const v = stmt.get()[0]; stmt.free(); return v; }
    stmt.free();
    return 0;
  },
};

// ========== Tests ==========
const testDao = {
  getAll() {
    return prepare('SELECT * FROM tests WHERE is_active = 1 ORDER BY created_at DESC').all();
  },
  getById(id) {
    const test = prepare('SELECT * FROM tests WHERE id = ?').get(id);
    if (test) {
      try { test.questions = JSON.parse(test.questions); } catch (e) {}
    }
    return test;
  },
  submitResult(testId, userId, score, maxScore, analysis, answers) {
    const r = prepare('INSERT INTO test_results (test_id, user_id, score, max_score, analysis, answers) VALUES (?, ?, ?, ?, ?, ?)').run(testId, userId, score, maxScore, analysis, JSON.stringify(answers));
    return prepare('SELECT * FROM test_results WHERE id = ?').get(r.lastInsertRowid);
  },
  getResults() {
    return prepare('SELECT tr.*, t.title as test_title, t.category FROM test_results tr JOIN tests t ON tr.test_id = t.id ORDER BY tr.created_at DESC').all();
  },
  resultCount(testId) {
    const where = testId ? 'WHERE test_id = ?' : '';
    const params = testId ? [testId] : [];
    const stmt = getDb().prepare(`SELECT COUNT(*) as count FROM test_results ${where}`);
    stmt.bind(params);
    if (stmt.step()) { const v = stmt.get()[0]; stmt.free(); return v; }
    stmt.free();
    return 0;
  },
  avgScore(testId) {
    return prepare('SELECT AVG(score) as avg_score, AVG(score/max_score*100) as avg_pct FROM test_results WHERE test_id = ?').get(testId);
  },
};

// ========== Behavior Logs ==========
const behaviorDao = {
  track(userId, eventType, page, element, metadata, clientTime) {
    return prepare('INSERT INTO behavior_logs (user_id, event_type, page, element, metadata, client_time) VALUES (?, ?, ?, ?, ?, ?)').run(userId, eventType, page || null, element || null, metadata || null, clientTime || null);
  },
  batchTrack(userId, events) {
    for (const ev of events) {
      prepare('INSERT INTO behavior_logs (user_id, event_type, page, element, metadata, client_time) VALUES (?, ?, ?, ?, ?, ?)').run(userId, ev.event_type, ev.page || null, ev.element || null, ev.metadata ? JSON.stringify(ev.metadata) : null, ev.client_time || null);
    }
    return { inserted: events.length };
  },
  getRecent(limit) {
    return prepare('SELECT * FROM behavior_logs ORDER BY created_at DESC LIMIT ?').all(limit || 100);
  },
  getStats() {
    const eventCounts = prepare("SELECT event_type, COUNT(*) as count FROM behavior_logs WHERE created_at >= datetime('now', '-7 days', 'localtime') GROUP BY event_type").all();
    const pageViews = prepare("SELECT page, COUNT(*) as count FROM behavior_logs WHERE event_type = 'page_view' AND created_at >= datetime('now', '-7 days', 'localtime') GROUP BY page").all();
    const dailyActivity = prepare("SELECT date(created_at) as day, COUNT(*) as count FROM behavior_logs WHERE created_at >= datetime('now', '-7 days', 'localtime') GROUP BY date(created_at) ORDER BY day ASC").all();
    return { eventCounts, pageViews, dailyActivity };
  },
  totalCount() {
    return prepare('SELECT COUNT(*) as count FROM behavior_logs').get().count;
  },
};

export { userDao, conversationDao, surveyDao, testDao, behaviorDao };
