import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'expresscoach.sqlite');

let SQL = null;
let db = null;

async function loadSQL() {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export async function initDatabase() {
  if (db) return db;

  const sql = await loadSQL();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new sql.Database(fileBuffer);
  } else {
    db = new sql.Database();
  }

  // Enable WAL (sql.js supports this via exec)
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  // Run schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.run(schema);

  seedData();
  saveDb();
  console.log('[DB] Database initialized at', DB_PATH);
  return db;
}

function seedData() {
  const result = db.exec('SELECT COUNT(*) as count FROM surveys');
  if (result.length > 0 && result[0].values[0][0] > 0) {
    console.log('[DB] Seed data exists, skipping...');
    return;
  }

  console.log('[DB] Seeding surveys and tests...');
  const surveys = [
    { title: '使用体验反馈', description: '帮助我们了解你的 ExpressCoach 使用体验。', questions: JSON.stringify([
      { id:'q1', type:'multiple_choice', question:'你主要使用哪个功能？', options:['场景分析','沙盒练习','问卷测试','数据查看'], required:true },
      { id:'q2', type:'scale', question:'AI 表达建议对你有帮助吗？（1-5）', min:1, max:5, required:true },
      { id:'q3', type:'text', question:'你觉得最需要改进的地方是什么？', required:false },
    ])},
    { title: '社交表达习惯调查', description: '帮助完善意图识别模型。', questions: JSON.stringify([
      { id:'q1', type:'multiple_choice', question:'面对拒绝场景你通常？', options:['直接拒绝','委婉找理由','拖延/回避','请第三方帮忙'], required:true },
      { id:'q2', type:'scale', question:'表达真实想法的频率？（1=几乎不,5=总是）', min:1, max:5, required:true },
      { id:'q3', type:'checkbox', question:'最常遇到的困境？（可多选）', options:['拒绝他人','催促任务','提出反馈','设定边界','请求帮助'], required:true },
    ])},
  ];

  for (const s of surveys) {
    db.run('INSERT INTO surveys (title, description, questions) VALUES (?, ?, ?)', [s.title, s.description, s.questions]);
  }

  const tests = [
    { title: '社交意图识别能力自测', description: '评估你在不同社交场景中识别意图的能力。', category: 'social_skill', questions: JSON.stringify([
      { id:'q1', type:'multiple_choice', question:'朋友借钱想拒绝，这属于？', options:[{text:'拒绝',score:{correct:3}},{text:'催促',score:{wrong:0}},{text:'设边界',score:{partial:1}}] },
      { id:'q2', type:'multiple_choice', question:'催同事交报告，这属于？', options:[{text:'催促',score:{correct:3}},{text:'拒绝',score:{wrong:0}},{text:'反馈',score:{partial:1}}] },
      { id:'q3', type:'multiple_choice', question:'给领导提建议，这属于？', options:[{text:'反馈',score:{correct:3}},{text:'求助',score:{wrong:0}},{text:'设边界',score:{partial:1}}] },
      { id:'q4', type:'multiple_choice', question:'想表达私人边界被侵犯，这属于？', options:[{text:'设边界',score:{correct:3}},{text:'拒绝',score:{partial:1}},{text:'催促',score:{wrong:0}}] },
      { id:'q5', type:'scale', question:'你在社交中识别意图的能力？（1-5）', min:1, max:5, required:true },
      { id:'q6', type:'scale', question:'会根据亲疏关系选表达方式吗？（1=从不,5=总是）', min:1, max:5, required:true },
    ])},
  ];

  for (const t of tests) {
    db.run('INSERT INTO tests (title, description, category, questions) VALUES (?, ?, ?, ?)', [t.title, t.description, t.category, t.questions]);
  }

  console.log(`[DB] Seeded ${surveys.length} surveys and ${tests.length} tests`);
}

// Persist to disk
function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Auto-save every 30 seconds
setInterval(() => {
  try { saveDb(); } catch (e) {}
}, 30000);

// Save on process exit
process.on('SIGINT', () => { saveDb(); process.exit(0); });
process.on('SIGTERM', () => { saveDb(); });
