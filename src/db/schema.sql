-- ============================================================
-- ExpressCoach AI — SQLite 数据库 Schema (W2 Day 12)
-- 3 张表: cases / feedback / preferences
-- 使用 WAL 模式以提升并发读写性能
-- ============================================================

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============================================================
-- 表1: cases — 每次完整分析的记录
-- ============================================================
CREATE TABLE IF NOT EXISTS cases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario        TEXT    NOT NULL,                     -- 用户输入场景描述
    -- 意图识别结果
    intent_type     TEXT,                                 -- 拒绝/催促/反馈/设边界/求助
    intent_confidence REAL,                               -- 置信度 (0-1)
    -- 关系判断结果 (混合: 规则0.3 + LLM0.7)
    relation_type       TEXT,                             -- 关系类型 (同事/好朋友/上级/...)
    relation_intimacy   TEXT,                             -- 亲密度: 亲密/较近/一般/疏远
    relation_power      TEXT,                             -- 权力关系: 对方上位/平等/己方上位/不明
    relation_interest   TEXT,                             -- 利益关联: 强利益/弱利益/纯情感
    relation_sensitivity TEXT,                            -- 表达敏感度: 高敏感/中敏感/低敏感
    relation_confidence REAL,                             -- LLM 判断的置信度
    -- 三版本生成结果
    version_mild    TEXT,                                 -- 温和版回复内容
    version_firm    TEXT,                                 -- 坚定版回复内容
    version_eq      TEXT,                                 -- 高情商版回复内容
    -- Jaccard 差异度 (三组两两对比)
    jaccard_mild_firm  REAL,
    jaccard_mild_eq    REAL,
    jaccard_firm_eq    REAL,
    -- 性能指标
    total_tokens    INTEGER,                              -- 总 token 消耗
    total_time_ms   REAL,                                 -- 全流程耗时 (毫秒)
    created_at      TEXT DEFAULT (datetime('now'))
);

-- 索引: 按时间检索最近案例
CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at DESC);

-- 索引: 按意图类型检索
CREATE INDEX IF NOT EXISTS idx_cases_intent ON cases(intent_type);

-- 索引: 按关系类型检索
CREATE INDEX IF NOT EXISTS idx_cases_relation ON cases(relation_type);

-- ============================================================
-- 表2: feedback — 用户对生成回复的评分反馈
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id         INTEGER REFERENCES cases(id) ON DELETE CASCADE,
    version_type    TEXT    NOT NULL,                     -- mild / firm / eq
    rating          INTEGER CHECK(rating >= 1 AND rating <= 5),  -- 1-5 星评分
    comment         TEXT,                                 -- 用户文字反馈
    created_at      TEXT DEFAULT (datetime('now'))
);

-- 索引: 按案例ID检索反馈
CREATE INDEX IF NOT EXISTS idx_feedback_case_id ON feedback(case_id);

-- ============================================================
-- 表3: preferences — 用户偏好键值存储
-- ============================================================
CREATE TABLE IF NOT EXISTS preferences (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    key             TEXT    UNIQUE NOT NULL,              -- 偏好键 (如 default_style, max_tokens)
    value           TEXT,                                 -- 偏好值
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- 预置默认偏好
INSERT OR IGNORE INTO preferences (key, value) VALUES
    ('default_style', 'eq'),
    ('max_history', '50'),
    ('auto_save', 'true');
