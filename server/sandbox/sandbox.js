#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import dotenv from "dotenv";
import { CoachAgent } from "./coach.js";
import { SimulatorAgent } from "./simulator.js";
import { C, c } from "../lib/color.js";
import { callDeepSeek } from "../lib/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Sandbox — dual-Agent dialogue practice (Notion-style CLI)
 *
 * Usage:
 *   node src/sandbox/sandbox.js "scenario" free
 *   node src/sandbox/sandbox.js "scenario" guided --rounds 5
 *   node src/sandbox/sandbox.js "scenario" stress --rounds 5 --autopilot
 */
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

// ── Helpers ───────────────────────────────────────────
function dim(s)  { return c(C.dim, s); }
function bold(s) { return c(C.bold, s); }
function muted(s){ return c(C.gray, s); }
function accent(s){return c(C.accent, s); }
function ok(s)   { return c(C.green, s); }
function warn(s) { return c(C.yellow, s); }
function err(s)  { return c(C.red, s); }

// ── Compress prompt ───────────────────────────────────
const COMPRESS_PROMPT = `You are a conversation summarizer. Summarize the following dialogue in under 100 characters in Chinese.
Keep: both sides' positions, core conflict, any consensus, emotional shifts.
Output ONLY the summary text.`;

// ── ContextManager ────────────────────────────────────
class ContextManager {
  constructor(maxRounds = 10) {
    this.maxRounds = 10;
    this.sessionMaxRounds = maxRounds;
    this.context = [];
    this.compressionCount = 0;
    this.emotionHistory = [];
  }

  append(role, content) {
    this.context.push({ role, content, timestamp: new Date().toISOString() });
    const userMsgs = this.context.filter(e => e.role === "user");
    if (userMsgs.length > this.maxRounds) this._needsCompression = true;
  }

  needsCompression() {
    return this.context.filter(e => e.role === "user").length > this.maxRounds || this._needsCompression;
  }

  async compress() {
    console.log("\n  " + dim("compressing context..."));
    const split = Math.floor(this.context.length / 2);
    const oldMsgs = this.context.slice(0, split);
    const summary = await this._summarize(oldMsgs);
    const recent = this.context.slice(split);
    this.context = [
      { role: "system", content: `[summary #${this.compressionCount + 1}] ${summary}`, timestamp: new Date().toISOString() },
      ...recent,
    ];
    this.compressionCount++;
    this._needsCompression = false;
    console.log("  " + ok("compressed") + dim(`  ${summary.length} chars  |  ${recent.length} recent messages kept`));
  }

  async _summarize(messages) {
    const text = messages.map(e => `${e.role === "user" ? "user" : "them"}: ${e.content}`).join("\n");
    try {
      const r = await callDeepSeek(COMPRESS_PROMPT, text, { temperature: 0.1, maxTokens: 200 });
      const s = r.content.trim();
      return s.length > 100 ? s.substring(0, 97) + "..." : s;
    } catch (e) {
      return messages.slice(0, 3).map(e => `[${e.role === "user" ? "user" : "them"}] ${e.content}`).join(" | ").substring(0, 100);
    }
  }

  getContext()       { return [...this.context]; }
  getRoundCount()    { return this.context.filter(e => e.role === "user").length; }
  getStats() {
    return { totalEntries: this.context.length, userRounds: this.getRoundCount(), compressionCount: this.compressionCount, contextLimit: this.maxRounds, sessionLimit: this.sessionMaxRounds };
  }

  trackEmotion(text) {
    const round = this.getRoundCount();
    let emotion = "neutral", intensity = 3;
    if (/担心|怕|不敢|紧张|纠结|忐忑|焦虑|万一/.test(text)) { emotion = "anxious"; intensity = Math.min(10, 5 + (text.match(/担心|怕|不敢/g) || []).length); }
    if (/气死|过分|受不了|无语|凭什么/.test(text)) { emotion = "angry"; intensity = Math.min(10, 5 + (text.match(/气死|过分/g) || []).length); }
    if (/算了|随便|不知道|没办法|无所谓/.test(text)) { emotion = "frustrated"; intensity = Math.min(10, 4 + (text.match(/算了|随便/g) || []).length); }
    if (/我觉得|我认为|可以的|没问题|放心/.test(text)) { emotion = "confident"; intensity = Math.min(10, 4 + (text.match(/我觉得|没问题/g) || []).length); }
    const prev = this.emotionHistory[this.emotionHistory.length - 1];
    let trend = "—";
    if (prev) {
      if (intensity > prev.intensity + 2) trend = "↓";
      else if (intensity < prev.intensity - 2) trend = "↑";
    }
    const entry = { round, emotion, intensity, trend };
    this.emotionHistory.push(entry);
    return entry;
  }

  getEmotionDeteriorated() {
    if (this.emotionHistory.length < 3) return false;
    return this.emotionHistory.slice(-3).every(e => e.trend === "↓");
  }

  reset() { this.context = []; this.compressionCount = 0; this._needsCompression = false; this.emotionHistory = []; }
}

// ── Autopilot ─────────────────────────────────────────
const AUTOPILOT_PROMPT = `You are participating in a social conversation practice. You play the "user" role.
Reply naturally in 15-50 characters of Chinese. Output ONLY the reply.`;

async function autoReply(scenario, context) {
  const recent = context.slice(-6);
  const str = recent.map(e => {
    const speaker = e.role === "user" ? "me" : (e.role === "simulator" ? "them" : "system");
    return `${speaker}: ${e.content}`;
  }).join("\n");
  try {
    const r = await callDeepSeek(AUTOPILOT_PROMPT, `Scenario: ${scenario}\n\nHistory:\n${str}\n\nReply as the user:`, { temperature: 0.7, maxTokens: 150 });
    return r.content.trim();
  } catch (e) { return "嗯，让我想想..."; }
}

// ── Mode configs ──────────────────────────────────────
const MODE_CONFIGS = {
  free: {
    label: "free", desc: "coach silent, free practice",
    coachConfig: { enabled: false, helpRequest: false, toneCheck: false, deadlockCheck: false, cooldown: 999 },
    simulatorConfig: { forcePersonality: null },
  },
  guided: {
    label: "guided", desc: "coach gives tips every 2 rounds",
    coachConfig: { enabled: true, helpRequest: true, toneCheck: true, deadlockCheck: true, proactiveInterval: 2, cooldown: 0 },
    simulatorConfig: { forcePersonality: null },
  },
  stress: {
    label: "stress", desc: "hostile simulator, coach only on help request",
    coachConfig: { enabled: true, helpRequest: true, toneCheck: false, deadlockCheck: false, proactiveInterval: 0, cooldown: 3 },
    simulatorConfig: { forcePersonality: "hostile" },
  },
};

// ── Coach check ───────────────────────────────────────
async function _runCoachCheck(coach, ctx, mode, round, coachConfig) {
  if (!coachConfig.enabled) return { should: false, reason: "", suggestion: "" };

  if (mode === "stress") {
    const context = ctx.getContext();
    const lastUser = [...context].reverse().find(e => e.role === "user");
    const msg = lastUser ? lastUser.content : "";
    const helps = ["帮帮我", "怎么说", "救命", "不知道怎么说", "怎么办", "教我", "救救我", "help", "帮我", "怎么回"];
    if (helps.some(k => msg.includes(k))) return await coach.shouldIntervene(context);
    return { should: false, reason: "", suggestion: "" };
  }

  if (mode === "guided" && coachConfig.proactiveInterval > 0) {
    if (ctx.getEmotionDeteriorated && ctx.getEmotionDeteriorated()) {
      coach.interventionCount++;
      coach._recordIntervention(round, "emotion deteriorating", { suggestion: "" });
      return { should: true, reason: "emotion deteriorating", suggestion: "I notice your emotions seem to be escalating. Try pausing, taking a breath, or reframing: acknowledge their feelings first, then express your own needs.", example: "I understand you may be under pressure too. At the same time, I want to share..." };
    }
    if (round > 0 && round % coachConfig.proactiveInterval === 0) {
      const context = ctx.getContext();
      const result = await coach.shouldIntervene(context, { emotionDeteriorated: ctx.getEmotionDeteriorated ? ctx.getEmotionDeteriorated() : false });
      if (result.should) return result;
      coach.interventionCount++;
      coach._recordIntervention(round, `proactive (round ${round})`, { suggestion: "" });
      const recent = context.slice(-6);
      const str = recent.map(e => `[${e.role === "user" ? "user" : (e.role === "simulator" ? "them" : e.role)}] ${e.content}`).join("\n");
      try {
        const llm = await callDeepSeek("You are a social expression coach. Give ONE short, practical strategy tip in Chinese (30-50 chars). Output ONLY the tip.", `Dialogue (round ${round}):\n${str}\n\nStrategy tip:`, { temperature: 0.3, maxTokens: 150 });
        return { should: true, reason: `round ${round}`, suggestion: llm.content.trim() };
      } catch (e) {
        return { should: true, reason: `round ${round}`, suggestion: "Try looking at the conversation from their perspective and find common ground before stating your position." };
      }
    }
  }

  const ed = ctx.getEmotionDeteriorated ? ctx.getEmotionDeteriorated() : false;
  return await coach.shouldIntervene(ctx.getContext(), { emotionDeteriorated: ed });
}

// ── startSandbox ──────────────────────────────────────
async function startSandbox(scenario, mode = "free", personality = "friendly", opts = {}) {
  const maxRounds = opts.rounds || 10;
  const autopilot = opts.autopilot === true;
  const modeConfig = MODE_CONFIGS[mode] || MODE_CONFIGS.free;
  const { coachConfig, simulatorConfig } = modeConfig;
  const effectivePersonality = simulatorConfig.forcePersonality || personality;

  console.log("");
  console.log("  " + bold("Sandbox"));
  console.log("  " + dim(scenario));
  console.log("");
  console.log("  " + dim("mode") + "        " + modeConfig.label + "  —  " + dim(modeConfig.desc));
  console.log("  " + dim("personality") + "  " + effectivePersonality + (simulatorConfig.forcePersonality ? " " + dim("(forced)") : ""));
  console.log("  " + dim("rounds") + "      " + maxRounds);
  console.log("  " + dim("run") + "         " + (autopilot ? "auto" : "interactive"));
  if (coachConfig.enabled) {
    const rules = [];
    if (coachConfig.helpRequest) rules.push("help");
    if (coachConfig.toneCheck) rules.push("tone");
    if (coachConfig.deadlockCheck) rules.push("deadlock");
    if (coachConfig.proactiveInterval) rules.push("every " + coachConfig.proactiveInterval + "r");
    console.log("  " + dim("coach rules") + "  " + rules.join(" · "));
  } else {
    console.log("  " + dim("coach") + "        " + dim("silent"));
  }
  console.log("");

  const ctx = new ContextManager(maxRounds);
  const coach = new CoachAgent();
  const simulator = new SimulatorAgent(effectivePersonality);

  ctx.append("system", `Scenario: ${scenario}`);
  ctx.append("system", `Personality: ${personality}`);

  // Opening
  const opening = await simulator.generateReply(ctx.getContext(), `Scenario: ${scenario}\nYou speak first.`);
  ctx.append("simulator", opening);
  console.log("  " + accent("them") + "  " + opening);
  console.log("");

  const initialCoach = await _runCoachCheck(coach, ctx, mode, 0, coachConfig);
  if (initialCoach.should) {
    console.log("  " + warn("coach") + "  " + initialCoach.suggestion);
    console.log("");
  }

  if (autopilot) {
    console.log("  " + dim("auto mode — generating replies..."));
    console.log("");

    for (let r = 1; r <= maxRounds; r++) {
      if (ctx.needsCompression()) await ctx.compress();

      const reply = await autoReply(scenario, ctx.getContext());
      ctx.append("user", reply);
      ctx.trackEmotion(reply);
      console.log("  " + bold("you") + "   " + reply);

      const cr = await _runCoachCheck(coach, ctx, mode, r, coachConfig);
      if (cr.should) {
        console.log("");
        console.log("  " + warn("coach") + "  " + cr.suggestion);
        if (cr.example) console.log("  " + dim("eg") + "     " + cr.example);
        console.log("");
      }

      const sim = await simulator.generateReply(ctx.getContext(), reply);
      ctx.append("simulator", sim);
      console.log("  " + accent("them") + "  " + sim);
      console.log("");

      if (r < maxRounds) await new Promise(res => setTimeout(res, 300));
    }
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));

    let round = 1;
    while (round <= maxRounds) {
      if (ctx.needsCompression()) await ctx.compress();

      const prompt = dim("[") + round + "/" + maxRounds + dim("]") + "  ";
      const input = await ask(prompt);

      if (!input.trim()) continue;
      const cmd = input.trim();

      if (cmd === "/quit" || cmd === "/exit") { console.log("  " + dim("ended")); break; }
      if (cmd === "/context") { console.log("  " + dim(`context: ${ctx.getStats().totalEntries} entries, ${ctx.getStats().userRounds} rounds`)); continue; }
      if (cmd === "/reset") { ctx.reset(); coach.reset(); console.log("  " + dim("reset")); continue; }

      ctx.append("user", cmd);
      ctx.trackEmotion(cmd);

      const cr = await _runCoachCheck(coach, ctx, mode, round, coachConfig);
      if (cr.should) {
        console.log("");
        console.log("  " + warn("coach  " + cr.reason));
        console.log("  " + warn(cr.suggestion));
        if (cr.example) console.log("  " + dim("eg  " + cr.example));
        console.log("");
      }

      const sim = await simulator.generateReply(ctx.getContext(), cmd);
      ctx.append("simulator", sim);
      console.log("  " + accent("them") + "  " + sim);
      console.log("");

      round++;
    }
    rl.close();
  }

  // Summary
  console.log(dim("─".repeat(48)));
  const stats = ctx.getStats();
  console.log("  " + bold("summary"));
  console.log("  " + dim("rounds") + "          " + stats.userRounds);
  console.log("  " + dim("compressions") + "    " + stats.compressionCount);
  console.log("  " + dim("coach tips") + "      " + coach.interventionCount);
  if (ctx.emotionHistory.length > 0) {
    console.log("");
    console.log("  " + bold("emotion timeline"));
    for (const e of ctx.emotionHistory) {
      const bar = "█".repeat(Math.max(1, e.intensity)) + "░".repeat(Math.max(1, 10 - e.intensity));
      const ti = e.trend === "↓" ? warn("↓") : e.trend === "↑" ? ok("↑") : dim("—");
      console.log("  " + dim(String(e.round).padStart(2)) + "  " + bar + "  " + e.emotion + " " + ti);
    }
  }
  console.log("");

  return { context: ctx.getContext(), stats, coachInterventions: coach.interventionCount, rounds: ctx.getRoundCount() };
}

// ── CLI entry ─────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let scenario = "", mode = "free", personality = "friendly", maxRounds = 10, autopilot = false;
  const VALID_MODES = ["free", "guided", "stress"];
  const VALID_PERS = ["friendly", "hostile", "avoidant"];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rounds" || args[i] === "-r") maxRounds = parseInt(args[++i]) || 10;
    else if (args[i] === "--autopilot" || args[i] === "--auto" || args[i] === "-a") autopilot = true;
    else if (args[i] === "--mode" || args[i] === "-m") { const m = args[++i]; if (VALID_MODES.includes(m)) mode = m; }
    else if (VALID_MODES.includes(args[i])) mode = args[i];
    else if (VALID_PERS.includes(args[i])) personality = args[i];
    else if (!scenario) scenario = args[i];
  }

  if (!scenario) {
    console.log("");
    console.log("  " + bold("ExpressCoach Sandbox"));
    console.log("  " + dim("dual-agent conversation practice"));
    console.log("");
    console.log("  " + dim("usage:"));
    console.log("  " + dim('node src/sandbox/sandbox.js "scenario" <mode> <personality> [--rounds N] [--autopilot]'));
    console.log("");
    console.log("  " + bold("modes"));
    console.log("  " + ok("free") + "      coach silent, free practice");
    console.log("  " + accent("guided") + "    coach tips every 2 rounds");
    console.log("  " + warn("stress") + "    hostile simulator, coach on help only");
    console.log("");
    console.log("  " + bold("personalities"));
    console.log("  " + dim("friendly  — cooperative"));
    console.log("  " + dim("hostile   — challenging  [forced in stress mode]"));
    console.log("  " + dim("avoidant  — evasive, deflecting"));
    console.log("");
    console.log("  " + bold("examples"));
    console.log("  " + dim('node src/sandbox/sandbox.js "refuse friend loan" guided --rounds 5'));
    console.log("  " + dim('node src/sandbox/sandbox.js "urge coworker report" stress --rounds 5 --autopilot'));
    console.log("");
    process.exit(0);
  }

  const hasDS = !!process.env.DEEPSEEK_API_KEY;
  const hasQW = !!process.env.DASHSCOPE_API_KEY;
  const hasKM = !!process.env.MOONSHOT_API_KEY;
  if (!hasDS && !hasQW && !hasKM) {
    console.error(err("No API key configured"));
    process.exit(1);
  }

  try {
    await startSandbox(scenario, mode, personality, { rounds: maxRounds, autopilot });
  } catch (e) {
    console.error(err("sandbox error: " + e.message));
    process.exit(1);
  }
}

export { startSandbox, CoachAgent, SimulatorAgent, ContextManager, MODE_CONFIGS, _runCoachCheck };

const isSandboxMain = process.argv[1] && (process.argv[1].endsWith("sandbox.js") || process.argv[1] === fileURLToPath(import.meta.url));
if (isSandboxMain) { main(); }
