import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// ============================================================
// Dynamic ESM imports for ExpressCoach core modules
// ============================================================
let recognizeIntent = null;
let hybridAnalyze = null;
let generateThreeVersions = null;
let predictReactions = null;
let SandboxModules = null;
let dbDao = null;

async function loadModules() {
  if (recognizeIntent) return;
  try {
    const intentMod = await import('../intent/recognize.js');
    recognizeIntent = intentMod.recognizeIntent;
  } catch (e) { console.warn('[EC] Intent module load failed:', e.message); }

  try {
    const relMod = await import('../relationship/analyze.js');
    hybridAnalyze = relMod.hybridAnalyze;
  } catch (e) { console.warn('[EC] Relationship module load failed:', e.message); }

  try {
    const genMod = await import('../generate/three-versions.js');
    generateThreeVersions = genMod.generateThreeVersions;
  } catch (e) { console.warn('[EC] Generate module load failed:', e.message); }

  try {
    const predMod = await import('../predict/reactions.js');
    predictReactions = predMod.predictReactions;
  } catch (e) { console.warn('[EC] Predict module load failed:', e.message); }

  try {
    SandboxModules = await import('../sandbox/sandbox.js');
  } catch (e) { console.warn('[EC] Sandbox module load failed:', e.message); }
}

// ============================================================
// Console noise suppression during analysis
// ============================================================
function quiet() {
  const _log = console.log, _err = console.error, _write = process.stdout.write;
  console.log = () => {};
  console.error = () => {};
  process.stdout.write = () => true;
  return { log: _log, err: _err, write: _write };
}
function loud(saved) {
  console.log = saved.log;
  console.error = saved.err;
  process.stdout.write = saved.write;
}

// ============================================================
// POST /api/analyze — Full pipeline analysis
// ============================================================
router.post('/analyze', async (req, res) => {
  const { scenario } = req.body;
  if (!scenario || !scenario.trim()) {
    return res.status(400).json({ error: '请输入场景描述' });
  }

  await loadModules();

  const t0 = performance.now();
  const timing = {};

  try {
    // Step 1+2: Intent + Relation (parallel)
    const t1 = performance.now();
    let intentResult = null, relationResult = null;

    if (recognizeIntent && hybridAnalyze) {
      const saved = quiet();
      try {
        [intentResult, relationResult] = await Promise.all([
          recognizeIntent(scenario.trim()),
          hybridAnalyze(scenario.trim()),
        ]);
        timing.intent = (performance.now() - t1) / 1000;
        timing.relation = timing.intent;
      } catch (e) {
        timing.intent = (performance.now() - t1) / 1000;
      } finally {
        loud(saved);
      }
    }

    // Step 3: Three versions
    const t3 = performance.now();
    let versions = [];
    if (generateThreeVersions) {
      const saved = quiet();
      try {
        versions = await generateThreeVersions(scenario.trim(), relationResult?.parsed || null);
        timing.versions = (performance.now() - t3) / 1000;
      } catch (e) {
        timing.versions = (performance.now() - t3) / 1000;
      } finally {
        loud(saved);
      }
    }

    const total = (performance.now() - t0) / 1000;

    // Build response
    const data = {
      scenario: scenario.trim(),
      timing: { total, ...timing },

      intent: intentResult?.parsed ? {
        primary: intentResult.parsed['意图'] || intentResult.parsed['主意图'] || '?',
        secondary: intentResult.parsed['辅助意图'] || [],
        confidence: intentResult.parsed['置信度'] || 0,
        analysis: intentResult.parsed['分析'] || '',
        keywords: intentResult.parsed['关键词匹配'] || [],
        followUp: intentResult.parsed['追问建议'] || '',
      } : null,

      relation: relationResult?.parsed ? {
        type: relationResult.parsed['关系类型'] || '',
        intimacy: relationResult.parsed['亲密度'] || '',
        power: relationResult.parsed['权力关系'] || '',
        interest: relationResult.parsed['利益关联'] || '',
        sensitivity: relationResult.parsed['表达敏感度'] || '',
        strategy: relationResult.parsed['建议策略'] || '',
        caution: relationResult.parsed['注意事项'] || '',
        source: relationResult.source || '',
      } : null,

      versions: versions.map(v => ({
        key: v.meta?.key || v.styleKey || '',
        name: v.meta?.name || '',
        tag: v.meta?.tag || '',
        content: v.parsed?.content || '',
        strategy: v.parsed?.strategy || '',
        tokens: v.tokens || 0,
      })),

      jaccard: versions._similarities ? {
        'mild-firm': versions._similarities['mild-firm']?.similarity ?? null,
        'mild-eq': versions._similarities['mild-eq']?.similarity ?? null,
        'firm-eq': versions._similarities['firm-eq']?.similarity ?? null,
      } : null,
    };

    // Try to persist via user's DAO
    try {
      const { userDao, conversationDao } = await import('../db/dao.js');
      const sessionId = req.headers['x-session-id'];
      if (sessionId) {
        const user = userDao.findBySessionId(sessionId);
        if (user) {
          conversationDao.create(user.id, 'user', scenario.trim(), 'analyze', 0);
          const summary = `意图:${data.intent?.primary||'?'} 关系:${data.relation?.type||'?'} 版本数:${data.versions.length}`;
          conversationDao.create(user.id, 'assistant', summary, 'analyze', 0);
        }
      }
    } catch (e) { /* best effort */ }

    res.json(data);
  } catch (error) {
    console.error('[EC] Analyze error:', error.message);
    res.status(500).json({ error: error.message || '分析失败' });
  }
});

// ============================================================
// Sandbox session management
// ============================================================
const sandboxSessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 min

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sandboxSessions) {
    if (now - s.createdAt.getTime() > SESSION_TTL) sandboxSessions.delete(id);
  }
}, 5 * 60 * 1000);

function makeSessionId() {
  return crypto.randomBytes(8).toString('hex');
}

// POST /api/sandbox/start
router.post('/sandbox/start', async (req, res) => {
  await loadModules();
  if (!SandboxModules) {
    return res.status(503).json({ error: '沙盒模块不可用' });
  }

  const { scenario, mode = 'guided', personality = 'friendly' } = req.body;
  if (!scenario || !scenario.trim()) {
    return res.status(400).json({ error: '请输入沙盒场景' });
  }

  try {
    const saved = quiet();
    let session;
    try {
      const { CoachAgent, SimulatorAgent, ContextManager } = SandboxModules;
      session = new SandboxSession(scenario.trim(), mode, personality);
      const opening = await session.generateOpening();
      sandboxSessions.set(session.sessionId, session);
      loud(saved);

      res.json({
        sessionId: session.sessionId,
        scenario: session.scenario,
        mode: session.mode,
        personality: session.personality,
        opening,
        maxRounds: session.maxRounds,
      });
    } catch (e) {
      loud(saved);
      throw e;
    }
  } catch (error) {
    console.error('[EC] Sandbox start error:', error);
    res.status(500).json({ error: error.message || '沙盒启动失败' });
  }
});

// POST /api/sandbox/:sessionId/message
router.post('/sandbox/:sessionId/message', async (req, res) => {
  const { sessionId } = req.params;
  const { message } = req.body;

  const session = sandboxSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: '会话不存在或已过期' });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: '请输入你的回复' });
  }

  try {
    const saved = quiet();
    const result = await session.processMessage(message.trim());
    loud(saved);
    res.json(result);
  } catch (error) {
    console.error('[EC] Sandbox msg error:', error);
    res.status(500).json({ error: error.message || '处理消息失败' });
  }
});

// GET /api/sandbox/:sessionId
router.get('/sandbox/:sessionId', (req, res) => {
  const session = sandboxSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  res.json({ ...session.getSummary(), exists: true });
});

// DELETE /api/sandbox/:sessionId
router.delete('/sandbox/:sessionId', (req, res) => {
  const session = sandboxSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  const summary = session.getSummary();
  sandboxSessions.delete(req.params.sessionId);
  res.json(summary);
});

// ============================================================
// SandboxSession class
// ============================================================
class SandboxSession {
  constructor(scenario, mode, personality) {
    this.sessionId = makeSessionId();
    this.scenario = scenario;
    this.mode = mode;
    this.personality = personality;
    const { ContextManager, CoachAgent, SimulatorAgent } = SandboxModules;
    this.ctx = new ContextManager(10);
    this.coach = new CoachAgent();
    this.simulator = new SimulatorAgent(personality);
    this.round = 0;
    this.maxRounds = 5;
    this.createdAt = new Date();
    this.ctx.append('system', `场景: ${scenario}`);
    this.ctx.append('system', `性格: ${personality}`);
  }

  async generateOpening() {
    const prompt = `场景: ${this.scenario}\n对话刚开始，请你作为对方首先发言。`;
    const reply = await this.simulator.generateReply(this.ctx.getContext(), prompt);
    this.ctx.append('simulator', reply);
    return reply;
  }

  async processMessage(userMessage) {
    this.round++;
    this.ctx.append('user', userMessage);
    if (this.ctx.trackEmotion) this.ctx.trackEmotion(userMessage);
    if (this.ctx.needsCompression()) await this.ctx.compress().catch(() => {});

    const { MODE_CONFIGS, _runCoachCheck } = SandboxModules;
    const modeConfig = MODE_CONFIGS?.[this.mode] || MODE_CONFIGS?.free || { coachConfig: {} };
    let coachResult = { should: false, reason: '', suggestion: '' };
    try {
      coachResult = await _runCoachCheck(this.coach, this.ctx, this.mode, this.round, modeConfig.coachConfig);
    } catch (e) { /* non-critical */ }

    const simReply = await this.simulator.generateReply(this.ctx.getContext(), userMessage);
    this.ctx.append('simulator', simReply);

    return {
      round: this.round,
      simulatorReply: simReply,
      coachIntervention: {
        should: coachResult.should,
        reason: coachResult.reason,
        suggestion: coachResult.suggestion || '',
        example: coachResult.example || '',
      },
      isFinished: this.round >= this.maxRounds,
    };
  }

  getSummary() {
    return {
      sessionId: this.sessionId,
      scenario: this.scenario,
      mode: this.mode,
      rounds: this.round,
      coachInterventions: this.coach.interventionCount || 0,
    };
  }
}

// ============================================================
// GET /api/examples — Return example scenarios for the frontend
// ============================================================
router.get('/examples', (req, res) => {
  res.json({
    examples: [
      { text: '我想拒绝朋友借钱但不想伤感情', intent: '拒绝' },
      { text: '同事的报告拖了三天了我想催他', intent: '催促' },
      { text: '领导安排不太合理我想提出来', intent: '反馈' },
      { text: '同事总在下班后给我发工作消息', intent: '设边界' },
      { text: '我想向老板请假但不知道怎么开口', intent: '求助' },
    ],
  });
});

export default router;
