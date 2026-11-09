#!/usr/bin/env node
/**
 * ExpressCoach Web Server — 将 CLI 应用变为 Web 服务
 * 用法: node src/server.js
 * 浏览器打开 http://localhost:3000
 */

import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import crypto from "crypto";
import os from "os";
import { runAnalysis } from "./index.js";
import { getAvailableModels } from "./lib/api.js";
import {
  CoachAgent,
  SimulatorAgent,
  ContextManager,
  MODE_CONFIGS,
  _runCoachCheck,
} from "./sandbox/sandbox.js";

// OpenClaw session store integration — 统一走封装层, 使用正确的会话键派生方式
import * as ocRuntime from "./openclaw/runtime.js";
import * as orchestrator from "./openclaw/orchestrator.js";
const { sessionKey, updateSession, loadSessions } = ocRuntime;

// M5 反应预测 — 走 OpenClaw 编排器注册的 expresscoach.predict Agent
let predictReactions = null;
try {
  const mod = await import("./predict/reactions.js");
  predictReactions = mod.predictReactions;
} catch (e) { /* M5 可选，失败不影响主流程 */ }

// 聊天截图识别（GLM-4V 视觉模型）— 可选，失败降级为纯文本分析
let visionMod = null;
try {
  visionMod = await import("./lib/vision.js");
} catch (e) { /* 视觉模块可选 */ }

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库
let dbDao = null;
try {
  const mod = await import("./db/dao.js");
  dbDao = mod;
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
// 部署在云平台网关后时，X-Forwarded-For 才能拿到真实客户端 IP
// （仅信任第一层代理，避免伪造头绕过限流）
app.set("trust proxy", 1);
app.use(express.json({ limit: "12mb" }));  // 聊天截图 base64 可达数 MB，默认 100kb 会返回 HTML 413 页
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 3000;

// ============================================================
// 限流 — 公网开放前的硬性防护（防刷 GLM API 额度）
// ============================================================
// 仅限制消耗 LLM 额度的接口（分析、沙盒）；健康检查/静态页/统计浏览不限流。
// 计数器用内存实现，单实例部署足够；重启后清零（可接受）。
const RATE_LIMIT = {
  windowMs: 60 * 60 * 1000,          // 滑动窗口 1 小时
  maxPerIpPerHour: Number(process.env.RATE_LIMIT_IP_PER_HOUR || 8),   // 单 IP 每小时
  maxGlobalPerDay: Number(process.env.RATE_LIMIT_GLOBAL_PER_DAY || 200), // 全局每天
  maxInputLen: 200,                  // 场景输入长度上限
};

const ipHits = new Map();   // ip -> { count, resetAt }
let globalDaily = { count: 0, day: dayKey() };

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

/** @returns {null|{retryAfter:number}} null=放行 */
function checkRateLimit(req) {
  const now = Date.now();

  // 全局日配额
  const today = dayKey();
  if (globalDaily.day !== today) globalDaily = { count: 0, day: today };
  if (globalDaily.count >= RATE_LIMIT.maxGlobalPerDay) {
    return { retryAfter: 3600, reason: "global" };
  }

  // 单 IP 小时限额
  const ip = clientIp(req);
  let slot = ipHits.get(ip);
  if (!slot || slot.resetAt <= now) {
    slot = { count: 0, resetAt: now + RATE_LIMIT.windowMs };
    ipHits.set(ip, slot);
  }
  if (slot.count >= RATE_LIMIT.maxPerIpPerHour) {
    return { retryAfter: Math.ceil((slot.resetAt - now) / 1000), reason: "ip" };
  }

  slot.count++;
  globalDaily.count++;
  return null;
}

// 定期清理过期 IP 条目，避免内存无限增长
setInterval(() => {
  const now = Date.now();
  for (const [ip, s] of ipHits) if (s.resetAt <= now) ipHits.delete(ip);
}, 10 * 60 * 1000).unref();

function limiter(req, res, next) {
  const over = checkRateLimit(req);
  if (over) {
    res.set("Retry-After", String(over.retryAfter));
    res.set("X-RateLimit-Limit", String(
      over.reason === "global" ? RATE_LIMIT.maxGlobalPerDay : RATE_LIMIT.maxPerIpPerHour
    ));
    return res.status(429).json({
      error: over.reason === "global"
        ? "今日全站体验名额已用完，明天再来"
        : "请求太频繁，请稍后再试",
      retryAfter: over.retryAfter,
    });
  }
  res.set("X-RateLimit-Remaining", String(RATE_LIMIT.maxPerIpPerHour - (ipHits.get(clientIp(req))?.count || 0)));
  next();
}

/** 场景文本长度校验（上传截图时诉求可为空） */
function requireScenario(req, res, next) {
  const s = typeof req.body?.scenario === "string" ? req.body.scenario : "";
  const hasImage = typeof req.body?.image === "string" && req.body.image.startsWith("data:image/");
  if (!s.trim() && !hasImage) {
    return res.status(400).json({ error: "请输入场景描述，或上传聊天截图" });
  }
  if (s.trim().length > RATE_LIMIT.maxInputLen) {
    return res.status(400).json({ error: `场景描述不超过 ${RATE_LIMIT.maxInputLen} 字（当前 ${s.trim().length} 字）` });
  }
  // 图片大小限制（base64 约 5MB 原图 → 约 7MB 文本）
  if (hasImage && req.body.image.length > 7_000_000) {
    return res.status(400).json({ error: "截图过大，请压缩到 5MB 以内" });
  }
  next();
}


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
// API: 限流状态（仅读，不消耗额度）
// ============================================================
app.get("/api/rate-limit", (req, res) => {
  const ip = clientIp(req);
  const slot = ipHits.get(ip);
  res.json({
    policy: {
      maxPerIpPerHour: RATE_LIMIT.maxPerIpPerHour,
      maxGlobalPerDay: RATE_LIMIT.maxGlobalPerDay,
      maxInputLen: RATE_LIMIT.maxInputLen,
    },
    current: {
      ipUsed: slot?.count || 0,
      ipResetAt: slot?.resetAt ? new Date(slot.resetAt).toISOString() : null,
      globalUsedToday: globalDaily.count,
      trackedIps: ipHits.size,
    },
  });
});

// ============================================================
// API: OpenClaw 框架能力自检 (答辩演示用)
// ============================================================
app.get("/api/openclaw/status", (_req, res) => {
  const { detectCapabilities } = ocRuntime;
  const reg = orchestrator.getRegistry();
  res.json({
    ...detectCapabilities(),
    registeredAgents: reg.all.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: Object.keys(t.parameters?.properties || {}),
    })),
    pipeline: ["M1.intent", "M2.relationship", "M4.generate×3", "M5.predict", "M6.sandbox"],
  });
});

// ============================================================
// API: 全链路分析
// ============================================================
app.post("/api/analyze", limiter, requireScenario, async (req, res) => {
  const { scenario, image, intent } = req.body;

  const t0 = performance.now();

  // ---- 聊天截图识别（可选，失败降级为纯文本）----
  let chatContext = null;
  let effectiveScenario = (scenario || "").trim();
  const hasImage = typeof image === "string" && image.startsWith("data:image/");

  if (hasImage) {
    if (!visionMod) {
      return res.status(503).json({ error: "图片识别模块不可用，请直接粘贴文字内容" });
    }
    try {
      const extracted = await visionMod.extractChatFromImage(image);
      chatContext = extracted;
      // 把对话上文与用户诉求融合为分析场景（前文衔接的关键）
      const userIntent = (intent || scenario || "").trim();
      effectiveScenario = visionMod.buildChatScenario(
        extracted.turns, userIntent, extracted.summary
      );
    } catch (e) {
      return res.status(502).json({ error: "截图识别失败：" + (e.message || "请换一张更清晰的截图") });
    }
  }

  try {
    // 静默 console.log，只获取返回值
    quiet();
    const result = await runAnalysis(effectiveScenario);
    loud();

    const total = ((performance.now() - t0) / 1000).toFixed(1);

    // 映射为前端友好的 JSON
    const data = {
      scenario: (scenario || "").trim() || chatContext?.summary || "（聊天截图）",
      chatContext,   // 截图识别出的对话（含 turns/summary），前端渲染用
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

      // 四维敏感度（雷达图数据源）
      sensitivity: result.relationResult?.sensitivity
        ? {
            score: result.relationResult.sensitivity.score,
            level: result.relationResult.sensitivity.level,
            dimensions: result.relationResult.sensitivity.dimensions, // { I, P, E, C }
            deltaMod: result.relationResult.sensitivity.deltaMod,
            modifiers: result.relationResult.sensitivity.modifiers || [],
            weights: result.relationResult.sensitivity.weights,
            formula: result.relationResult.sensitivity.formula,
          }
        : null,

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

    // ---- M5 反应预测 (已在 runPipeline 内与记忆沉淀并行完成) ----
    if (result.predictions) {
      data.predictions = result.predictions;
      data.predictedFor = "eq";
    }

    res.json(data);
  } catch (error) {
    loud();
    console.error("Analysis error:", error.message);
    res.status(500).json({ error: error.message || "分析失败" });
  }
});

// ============================================================
// 沙盒会话管理 (Map + OpenClaw session store)
// ============================================================
const sandboxSessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30分钟
const SESSION_STORE_KEY = "expresscoach:sandbox";

// OpenClaw session persistence (best-effort)
async function persistSessionsToOpenClaw() {
  try {
    const data = {};
    for (const [id, s] of sandboxSessions) {
      data[id] = {
        scenario: s.scenario, mode: s.mode, personality: s.personality,
        round: s.round, createdAt: s.createdAt.toISOString(),
      };
    }
    // 旧实现为 deriveSessionKey(SESSION_STORE_KEY): 参数个数不足,
    // 框架会把自定义命名空间压成 "+", 导致所有会话写到同一个无名键下。
    await updateSession(sessionKey("sandbox", "registry"), data);
  } catch (e) { /* OpenClaw persistence is best-effort */ }
}

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, s] of sandboxSessions) {
    if (now - s.createdAt.getTime() > SESSION_TTL) {
      sandboxSessions.delete(id);
      changed = true;
    }
  }
  if (changed) persistSessionsToOpenClaw().catch(() => {});
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
    const prompt = `场景: ${this.scenario}\n对话刚开始。你是对方（被行动方），不是发起方。例如场景是"催同事交报告"，你是被催的同事，不是催报告的人。请以你的角色身份首先发言，不要说用户想说的话。`;
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

    // 最后一轮结束时，生成教练总结
    const isFinished = this.round >= this.maxRounds;
    let finalReview = null;
    if (isFinished) {
      try {
        finalReview = await this.coach.generateFinalReview(this.ctx.getContext(), this.scenario);
      } catch (e) { /* 总结失败不影响返回 */ }
    }

    return {
      round: this.round,
      simulatorReply: simReply,
      coachIntervention: {
        should: coachResult.should,
        reason: coachResult.reason,
        suggestion: coachResult.suggestion || "",
        example: coachResult.example || "",
      },
      isFinished,
      finalReview,
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
app.post("/api/sandbox/start", limiter, requireScenario, async (req, res) => {
  const { scenario, mode = "guided", personality = "friendly" } = req.body;

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
app.post("/api/sandbox/:sessionId/message", limiter, async (req, res) => {
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
      _log("[ ok ] 数据库已就绪");
    } catch (e) {
      _log("[ ! ] 数据库初始化失败:", e.message);
    }
  }

  // 检查 API Key
  const models = getAvailableModels();
  if (Object.keys(models).length === 0) {
    _log("[ ! ] 未配置任何 API Key，请在 .env 中设置");
  } else {
    _log("  可用模型: " + Object.values(models).map(m => m.name).join(", "));
  }

  const ifaces = os.networkInterfaces();
  let localIP = "localhost";
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
    if (localIP !== "localhost") break;
  }

  app.listen(PORT, "0.0.0.0", () => {
    _log("");
    _log("  ExpressCoach  表达教练");
    _log("  服务器已启动");
    _log("");
    _log("  本地访问  http://localhost:" + PORT);
    _log("  局域网    http://" + localIP + ":" + PORT);
    _log("");
  });
}

start().catch(e => { _err(e); process.exit(1); });
