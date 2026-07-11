-- ExpressCoach Database Schema

-- Table 1: Users (identified by session, no login required)
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT UNIQUE NOT NULL,
    nickname    TEXT,
    created_at  TEXT DEFAULT (datetime('now', 'localtime')),
    last_seen   TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Table 2: Conversations (chat history with AI coach)
CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    role        TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content     TEXT NOT NULL,
    category    TEXT DEFAULT 'general',
    tokens_used INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Table 3: Surveys (survey definitions)
CREATE TABLE IF NOT EXISTS surveys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    questions   TEXT NOT NULL,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Table 4: Survey responses (user answers)
CREATE TABLE IF NOT EXISTS survey_responses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id   INTEGER REFERENCES surveys(id),
    user_id     INTEGER REFERENCES users(id),
    answers     TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Table 5: Tests (assessment definitions)
CREATE TABLE IF NOT EXISTS tests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    category    TEXT,
    questions   TEXT NOT NULL,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Table 6: Test results (user scores)
CREATE TABLE IF NOT EXISTS test_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id     INTEGER REFERENCES tests(id),
    user_id     INTEGER REFERENCES users(id),
    score       REAL NOT NULL,
    max_score   REAL NOT NULL,
    analysis    TEXT,
    answers     TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Table 7: Behavior logs (user activity tracking)
CREATE TABLE IF NOT EXISTS behavior_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    event_type  TEXT NOT NULL,
    page        TEXT,
    element     TEXT,
    metadata    TEXT,
    client_time TEXT,
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_test_results_test ON test_results(test_id);
CREATE INDEX IF NOT EXISTS idx_test_results_user ON test_results(user_id);
CREATE INDEX IF NOT EXISTS idx_behavior_logs_user ON behavior_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_behavior_logs_event ON behavior_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_behavior_logs_created ON behavior_logs(created_at);
