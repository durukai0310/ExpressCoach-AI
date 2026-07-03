#!/usr/bin/env node
/**
 * ExpressCoach Web Server — 将 CLI 应用变为 Web 服务
 * 用法: node src/server.js
 * 浏览器打开 http://localhost:3000
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const express = require("express");
const crypto = require("crypto");

// 加载分析管线
const { runAnalysis } = require("./index");
const { getAvailableModels } = require("./lib/api");

// 加载沙盒组件
const {
  CoachAgent,
  SimulatorAgent,
  ContextManager,
  MODE_CONFIGS,
  _runCoachCheck,
} = require("./sandbox/sandbox");

// 数据库
let dbDao = null;
try {
  dbDao = require("./db/dao");
} catch (e) { /* DB 可选 */ }

// ============================================================
// console 静默工具 — Web 模式不需要终端输出
// ============================================================
const _log = console.log;
const _err = console.error;
const _write = process.stdout.write.bind(process.stdout);

function quiet() {
  console.log = () => {};
  console.error = () => {};
  process.stdout.write = () => true;
}
function loud() {
  console.log = _log;
  console.error = _err;
  process.stdout.write = _write;
}

// ============================================================
// Express 初始化
// ============================================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 3000;

// ============================================================
// API: 健康检查
// ============================================================
app.get("/api/health", (req, res) => {
  const models = getAvailableModels();
  res.json({
    status: "ok",
    models: Object.values(models).map(m => m.name),
    dbReady: !!dbDao,
    uptime: process.uptime(),
  });
});

// ============================================================
// API: 全链路分析
// ============================================================
app.post("/api/analyze", async (req, res) => {
  const { scenario } = req.body;
  if (!scenario || !scenario.trim()) {
    return res.status(400).json({ error: "请输入场景描述" });
  }

  const t0 = performance.now();

  try {
    // 静默 console.log，只获取返回值
    quiet();
    const result = await runAnalysis(scenario.trim());
    loud();

    const total = ((performance.now() - t0) / 1000).toFixed(1);

    // 映射为前端友好的 JSON
    const data = {
      scenario: scenario.trim(),
      caseId: result.savedCaseId || null,
      timing: { total: parseFloat(total) },

      // 意图
      intent: result.intentResult?.parsed ? {
        primary: result.intentResult.parsed["意图"] || result.intentResult.parsed["主意图"],
        secondary: result.intentResult.parsed["辅助意图"] || [],
        confidence: result.intentResult.parsed["置信度"],
        analysis: result.intentResult.parsed["分析"] || "",
        keywords: result.intentResult.parsed["关键词匹配"] || [],
      } : null,

      // 关系
      relation: result.relationResult?.parsed ? {
        type: result.relationResult.parsed["关系类型"] || "",
        intimacy: result.relationResult.parsed["亲密度"] || "",
        power: result.relationResult.parsed["权力关系"] || "",
        interest: result.relationResult.parsed["利益关联"] || "",
        sensitivity: result.relationResult.parsed["表达敏感度"] || "",
        strategy: result.relationResult.parsed["建议策略"] || "",
        caution: result.relationResult.parsed["注意事项"] || "",
        source: result.relationResult.source || "",
        weights: result.relationResult.weights || null,
        dualRelation: result.relationResult.dualRelation || null,
      } : null,

      // 三版本
      versions: (result.versions || []).map(v => ({
        key: v.meta?.key || v.styleKey,
        name: v.meta?.name || "",
        icon: v.meta?.icon || "",
        tag: v.meta?.tag || "",
        content: v.parsed?.content || "",
        strategy: v.parsed?.strategy || "",
        tokens: v.tokens || 0,
      })),

      // Jaccard
      jaccard: result.versions?._similarities ? {
        "mild-firm": result.versions._similarities["mild-firm"]?.similarity,
        "mild-eq": result.versions._similarities["mild-eq"]?.similarity,
        "firm-eq": result.versions._similarities["firm-eq"]?.similarity,
      } : null,
    };

    res.json(data);
  } catch (error) {
    loud();
    console.error("Analysis error:", error.message);
    res.status(500).json({ error: error.message || "分析失败" });
  }
});

// ============================================================
// 沙盒会话管理 (Map: sessionId → SandboxSession)
// ============================================================
const sandboxSessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30分钟

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sandboxSessions) {
    if (now - s.createdAt.getTime() > SESSION_TTL) {
      sandboxSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

function makeSessionId() {
  return crypto.randomBytes(8).toString("hex");
}

class SandboxSession {
  constructor(scenario, mode, personality) {
    this.sessionId = makeSessionId();
    this.scenario = scenario;
    this.mode = mode;
    this.personality = personality;
    this.ctx = new ContextManager(10);
    this.coach = new CoachAgent();
    this.simulator = new SimulatorAgent(personality);
    this.round = 0;
    this.maxRounds = 5;
    this.createdAt = new Date();

    // 初始化上下文
    this.ctx.append("system", `用户场景: ${scenario}`);
    this.ctx.append("system", `对方性格: ${personality}`);
  }

  async generateOpening() {
    const prompt = `场景: ${this.scenario}\n对话刚开始，请你作为对方首先发言。`;
    const reply = await this.simulator.generateReply(this.ctx.getContext(), prompt);
    this.ctx.append("simulator", reply);
    return reply;
  }

  async processMessage(userMessage) {
    this.round++;
    this.ctx.append("user", userMessage);
    if (this.ctx.trackEmotion) {
      this.ctx.trackEmotion(userMessage);
    }

    // 上下文压缩检查
    if (this.ctx.needsCompression()) {
      await this.ctx.compress();
    }

    // 教练介入检查
    const modeConfig = MODE_CONFIGS[this.mode] || MODE_CONFIGS.free;
    let coachResult = { should: false, reason: "", suggestion: "" };
    try {
      coachResult = await _runCoachCheck(
        this.coach, this.ctx, this.mode, this.round, modeConfig.coachConfig
      );
    } catch (e) { /* coach check non-critical */ }

    // Simulator 生成回复
    const simReply = await this.simulator.generateReply(this.ctx.getContext(), userMessage);
    this.ctx.append("simulator", simReply);

    const stats = this.ctx.getStats ? this.ctx.getStats() : {};

    return {
      round: this.round,
      simulatorReply: simReply,
      coachIntervention: {
        should: coachResult.should,
        reason: coachResult.reason,
        suggestion: coachResult.suggestion || "",
        example: coachResult.example || "",
      },
      isFinished: this.round >= this.maxRounds,
      contextStats: stats,
    };
  }

  getSummary() {
    const stats = this.ctx.getStats ? this.ctx.getStats() : {};
    const coachStats = this.coach.getInterventionStats ? this.coach.getInterventionStats() : {};
    const emotionHistory = this.ctx.emotionHistory || [];

    return {
      sessionId: this.sessionId,
      scenario: this.scenario,
      mode: this.mode,
      rounds: this.round,
      contextStats: stats,
      coachInterventions: this.coach.interventionCount || 0,
      coachStats,
      emotionHistory: emotionHistory.map(e => ({
        round: e.round, emotion: e.emotion, intensity: e.intensity, trend: e.trend
      })),
    };
  }
}

// ============================================================
// API: 沙盒 — 开始会话
// ============================================================
app.post("/api/sandbox/start", async (req, res) => {
  const { scenario, mode = "guided", personality = "friendly" } = req.body;
  if (!scenario || !scenario.trim()) {
    return res.status(400).json({ error: "请输入沙盒场景" });
  }

  try {
    quiet();
    const session = new SandboxSession(scenario.trim(), mode, personality);
    const opening = await session.generateOpening();
    sandboxSessions.set(session.sessionId, session);
    loud();

    res.json({
      sessionId: session.sessionId,
      scenario: session.scenario,
      mode: session.mode,
      personality: session.personality,
      opening: opening,
      maxRounds: session.maxRounds,
    });
  } catch (error) {
    loud();
    console.error("Sandbox start error:", error);
    res.status(500).json({ error: error.message || "沙盒启动失败" });
  }
});

// ============================================================
// API: 沙盒 — 发送消息
// ============================================================
app.post("/api/sandbox/:sessionId/message", async (req, res) => {
  const { sessionId } = req.params;
  const { message } = req.body;

  const session = sandboxSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: "会话不存在或已过期，请重新开始" });
  }

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "请输入你的回复" });
  }

  try {
    quiet();
    const result = await session.processMessage(message.trim());
    loud();
    res.json(result);
  } catch (error) {
    loud();
    console.error("Sandbox message error:", error);
    res.status(500).json({ error: error.message || "处理消息失败" });
  }
});

// ============================================================
// API: 沙盒 — 获取会话状态
// ============================================================
app.get("/api/sandbox/:sessionId", (req, res) => {
  const session = sandboxSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "会话不存在" });
  }
  const summary = session.getSummary();
  res.json({ ...summary, exists: true });
});

// ============================================================
// API: 沙盒 — 结束会话
// ============================================================
app.delete("/api/sandbox/:sessionId", (req, res) => {
  const session = sandboxSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "会话不存在" });
  }
  const summary = session.getSummary();
  sandboxSessions.delete(req.params.sessionId);
  res.json(summary);
});

// ============================================================
// 启动
// ============================================================
async function start() {
  // 初始化数据库 (如果可用)
  if (dbDao) {
    try {
      await dbDao.initDB();
      _log("✅ SQLite 数据库已就绪");
    } catch (e) {
      _log("⚠️ 数据库初始化失败:", e.message);
    }
  }

  // 检查 API Key
  const models = getAvailableModels();
  if (Object.keys(models).length === 0) {
    _log("⚠️ 未配置任何 API Key，请在 .env 中设置");
  } else {
    _log("📡 可用模型:", Object.values(models).map(m => m.name).join(", "));
  }

  app.listen(PORT, () => {
    _log("");
    _log("╔══════════════════════════════════════════╗");
    _log("║  🎯 ExpressCoach Web Server             ║");
    _log(`║  http://localhost:${PORT}                  ║`);
    _log("║  按 Ctrl+C 停止                          ║");
    _log("╚══════════════════════════════════════════╝");
    _log("");
  });
}

start().catch(e => { _err(e); process.exit(1); });
