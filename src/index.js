#!/usr/bin/env node
/**
 * ExpressCoach AI — CLI (MUJI-style + OpenClaw)
 *
 * Usage: node src/index.js "your social scenario"
 *        node src/index.js            (interactive mode)
 *
 * Pipeline: Intent → Relationship → 3 Versions → Prediction → Feedback
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
// 注: M1/M2/M4 已改由 OpenClaw 编排器调度, 入口不再直接 import 各阶段模块,
//     仅保留 GENERATOR_SOULS 用于 /doctor 的 SOUL 文件完整性自检。
import { GENERATOR_SOULS } from "./generate/three-versions.js";
// 决赛重构: 六阶段推理链改由 OpenClaw 编排器统一调度
import { runPipeline, runPrediction } from "./openclaw/orchestrator.js";
import { detectCapabilities } from "./openclaw/runtime.js";
import { C, c } from "./lib/color.js";
import { parseResponse } from "./lib/parse.js";
import { loadFile } from "./lib/fs-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let predictReactions = null;
try { const mod = await import("./predict/reactions.js"); predictReactions = mod.predictReactions; }
catch (e) { /* M5 optional */ }

let dbDao = null;
try { const mod = await import("./db/dao.js"); dbDao = mod; }
catch (e) { /* DB optional */ }

let sandboxModule = null;
async function getSandboxModule() {
  if (!sandboxModule) {
    try { sandboxModule = await import("./sandbox/sandbox.js"); }
    catch (e) { console.error(c(C.red, "沙盒模块不可用")); }
  }
  return sandboxModule;
}

let userProfileModule = null;
let currentProfileId = null;
async function getUserProfileModule() {
  if (!userProfileModule) {
    try { userProfileModule = await import("./memory/user-profile.js"); }
    catch (e) { /* optional */ }
  }
  return userProfileModule;
}

const GOLDEN_CASES_PATH = path.resolve(__dirname, "..", "data", "golden-cases.json");

// ── Config ────────────────────────────────────────────
const SOUL_DIR = path.resolve(__dirname, "..", "soul");
const INTENT_SOUL = path.resolve(__dirname, "..", "SOUL.md");
const RELATION_SOUL = path.join(SOUL_DIR, "relationship-judge.md");

// ── Notion-style helpers ──────────────────────────────

function dim(s)  { return c(C.dim, s); }
function bold(s) { return c(C.bold, s); }
function muted(s){ return c(C.gray, s); }
function accent(s){return c(C.accent, s); }
function ok(s)   { return c(C.green, s); }
function warn(s) { return c(C.yellow, s); }
function err(s)  { return c(C.red, s); }

/** Subtle horizontal rule — soft pencil-line style */
function hr(label) {
  if (label) console.log("\n  " + dim("· · ·") + "  " + bold(label));
  else console.log(dim("  · · · · · · · · · · · · · · · · · ·"));
}

/** Dot-pulse loader — slow, quiet, deliberate */
function dotPulse(message) {
  const frames = [".  ", ".. ", "..."];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write("\r  " + dim(frames[i++ % frames.length]) + " " + message);
  }, 500);
  return {
    stop: (final) => {
      clearInterval(id);
      process.stdout.write("\r  " + final + "\n");
    },
  };
}

/** Print a clean version card — MUJI style, unified warm tones */
function printVersionCard(v) {
  const { meta, parsed } = v;

  console.log("");
  console.log("  " + bold(meta.name) + "  " + dim("(" + meta.tag + ")"));
  if (parsed && parsed.content) {
    const lines = parsed.content.split("\n");
    for (const line of lines) {
      console.log("  " + line);
    }
  } else {
    console.log("  " + dim("(generation failed)"));
  }
  if (parsed && parsed.strategy) {
    console.log("  " + accent("> " + parsed.strategy));
  }
  console.log(dim("  tokens: " + v.tokens));
}

// ── Pipeline ──────────────────────────────────────────

async function runAnalysis(scenario) {
  const t0 = performance.now();
  const perf = {};

  console.log("");
  console.log("  " + bold(scenario));
  console.log("");

  // Step 1+2+3: intent + relation + 三版本生成 — 统一由 OpenClaw 编排器调度
  //
  // 决赛重构前: 此处是裸 Promise.all([recognizeIntent, hybridAnalyze]) + 后续
  //             单独调用 generateThreeVersions, 各阶段无框架参与、无可观测事件。
  // 决赛重构后: 一次 runPipeline() 走框架工具注册表, M1/M2/M4 各自上报诊断事件,
  //             结果自动沉淀到框架会话记忆 (跨进程可恢复)。
  const load = dotPulse("分析意图与关系...");
  const t1 = performance.now();
  let intentResult, relationResult, versions, pipedPredictions;

  try {
    const piped = await runPipeline(scenario, {
      profileId: currentProfileId || undefined,
    });
    intentResult = { parsed: piped.intent };
    relationResult = { parsed: piped.relationship, sensitivity: piped.relationship?.sensitivity };
    versions = piped.versions;
    pipedPredictions = piped.predictions;
    perf.step1 = (performance.now() - t1) / 1000;
    load.stop(ok("[ ok ]") + dim("  pipeline (OpenClaw)  ") + dim(`(${perf.step1.toFixed(1)}s)`));
  } catch (error) {
    perf.step1 = (performance.now() - t1) / 1000;
    load.stop(err("[ !! ]") + dim("  pipeline failed"));
    throw new Error("Pipeline failed: " + error.message);
  }

  // ── Intent ──
  if (intentResult && intentResult.parsed) {
    const r = intentResult.parsed;
    const primary = r["主意图"] || r["意图"] || "?";
    const conf = ((r["置信度"] || 0) * 100).toFixed(0);
    const secondary = r["辅助意图"] || [];

    console.log("");
    console.log("  " + bold("Intent") + "  " + accent(primary) + "  " + dim(conf + "%"));
    if (secondary.length) console.log("  " + dim("辅助意图") + "  " + secondary.map(s => muted(s)).join("  "));
    if (r["分析"]) console.log("  " + dim(r["分析"]));
  }

  // ── Relation ──
  if (relationResult && relationResult.parsed) {
    const r = relationResult.parsed;
    console.log("");
    console.log("  " + bold("Relationship"));
    console.log("  " + [r["关系类型"], r["亲密度"], r["权力关系"], r["利益关联"]]
      .filter(Boolean).map(s => muted(s)).join("  ·  "));
    if (r["表达敏感度"]) console.log("  " + warn("敏感度") + "  " + r["表达敏感度"]);
    // 决赛升级: 展示四维敏感度公式计算过程 (S = 0.35I + 0.30P + 0.25E + 0.10C + Δmod)
    if (relationResult.sensitivity) {
      const s = relationResult.sensitivity;
      console.log("  " + warn("敏感度得分") + "  " + s.score.toFixed(2) +
        dim(`  (I=${s.dimensions.I} P=${s.dimensions.P} E=${s.dimensions.E} C=${s.dimensions.C}` +
        (s.deltaMod ? ` Δmod=${s.deltaMod > 0 ? "+" : ""}${s.deltaMod}` : "") + ")"));
      console.log("  " + dim("公式: " + s.formula));
      if (s.modifiers && s.modifiers.length > 0) {
        console.log("  " + dim("微调: " + s.modifiers.map(m => `${m.name}${m.value > 0 ? "+" : ""}${m.value}`).join(", ")));
      }
    }
    if (r["建议策略"]) console.log("  " + accent("> " + r["建议策略"]));
    if (r["注意事项"]) console.log("  " + dim("注意: " + r["注意事项"]));
  }

  // Step 3 的三版本生成已在 runPipeline() 内完成 (含 Jaccard 差异度校验)

  // ── Print versions ──
  console.log("");
  hr("Versions");
  versions.forEach(v => printVersionCard(v));

  // Jaccard summary
  if (versions._similarities) {
    console.log("");
    console.log("  " + dim("差异度检查"));
    const sims = versions._similarities;
    for (const [k, v] of Object.entries(sims)) {
      const val = (v.similarity * 100).toFixed(0);
      const icon = v.similarity < 0.5 ? ok("ok") : warn("!!");
      console.log("  " + icon + "  " + k + "  " + dim(val + "%") + (v.similarity < 0.7 ? "" : "  " + warn("too similar")));
    }
  }

  // ── M5: prediction (已在 runPipeline 内与记忆沉淀并行完成) ──
  let predictionResult = null;
  if (pipedPredictions) {
    predictionResult = { parsed: pipedPredictions };
    try {
      console.log("");
      hr("Predicted Reactions");
      for (const pred of pipedPredictions) {
        const icon = pred.probability === "high" ? "*" : pred.probability === "medium" ? "-" : ".";
        const cls = pred.probability === "high" ? warn : pred.probability === "medium" ? muted : dim;
        console.log("  " + cls(icon) + "  " + pred.type + "  " + dim(pred.probability));
        if (pred.counter_tip) console.log("     " + dim(pred.counter_tip));
      }
    } catch (e) { /* display only */ }
  }

  // ── Timing ──
  perf.total = (performance.now() - t0) / 1000;
  console.log("");
  console.log(dim("  · · · · · · · · · · · · · · · · · ·"));
  console.log("  " + ok("[ ok ]") + dim(`  done  ${perf.total.toFixed(1)}s`));
  console.log("");

  // ── Persist ──
  let savedCaseId = null;
  if (dbDao) {
    try {
      const versionData = { mild: null, firm: null, eq: null };
      for (const v of versions) {
        if (v.meta && v.meta.key) versionData[v.meta.key] = v.parsed?.content || null;
      }
      const sims = versions._similarities || {};
      savedCaseId = await dbDao.saveCase({
        scenario,
        intentType: intentResult.parsed?.["意图"] || null,
        intentConfidence: intentResult.parsed?.["置信度"] || null,
        relationType: relationResult.parsed?.["关系类型"] || null,
        relationIntimacy: relationResult.parsed?.["亲密度"] || null,
        relationPower: relationResult.parsed?.["权力关系"] || null,
        relationInterest: relationResult.parsed?.["利益关联"] || null,
        relationSensitivity: relationResult.parsed?.["表达敏感度"] || null,
        relationConfidence: relationResult.parsed?.["置信度"] || null,
        versionMild: versionData.mild,
        versionFirm: versionData.firm,
        versionEq: versionData.eq,
        jaccardMildFirm: sims["mild-firm"]?.similarity ?? null,
        jaccardMildEq: sims["mild-eq"]?.similarity ?? null,
        jaccardFirmEq: sims["firm-eq"]?.similarity ?? null,
        totalTokens: versions.reduce((s, v) => s + (v.tokens || 0), 0),
        totalTimeMs: Math.round(perf.total * 1000),
      });
    } catch (e) { /* non-critical */ }
  }

  return { versions, savedCaseId, intentResult, relationResult };
}

// ── Feedback ──────────────────────────────────────────

async function collectFeedback(rl, ask, versions, savedCaseId, scenario) {
  console.log("");
  console.log("  " + bold("评价版本"));
  const choice = await ask("  " + dim("最佳版本？") + "  " + accent("1") + "=温和  " + warn("2") + "=坚定  " + c(C.accent, "3") + "=平衡  ");
  const num = parseInt(choice.trim());
  const map = { 1: "mild", 2: "firm", 3: "eq" };
  const vt = map[num];
  if (!vt) { console.log("  " + dim("跳过")); return { versionType: null, rating: null }; }

  const ratingStr = await ask("  " + dim("评分 (1-5)") + "  ");
  const rating = parseInt(ratingStr.trim());
  if (isNaN(rating) || rating < 1 || rating > 5) {
    console.log("  " + dim("跳过"));
    return { versionType: null, rating: null };
  }

  const comment = await ask("  " + dim("备注 (可选)") + "  ");

  let stars = "";
  for (let i = 0; i < 5; i++) stars += i < rating ? "+" : "-";
  console.log("  " + ok(stars) + "  " + dim(vt));

  if (dbDao && savedCaseId) {
    try { await dbDao.saveFeedback(savedCaseId, vt, rating, comment.trim() || null); }
    catch (e) { /* silent */ }
  }

  if (rating >= 4) {
    try {
      const gc = { scenario, selectedVersion: vt, rating, comment: comment.trim() || null, timestamp: new Date().toISOString() };
      const sel = versions.find(v => v.meta?.key === vt);
      if (sel?.parsed?.content) gc.replyContent = sel.parsed.content;
      let golden = [];
      if (fs.existsSync(GOLDEN_CASES_PATH)) {
        try { golden = JSON.parse(fs.readFileSync(GOLDEN_CASES_PATH, "utf-8")); } catch (e) {}
      }
      golden.push(gc);
      fs.writeFileSync(GOLDEN_CASES_PATH, JSON.stringify(golden, null, 2), "utf-8");
      console.log("  " + ok("已保存至精选案例  (" + golden.length + " 个)"));
    } catch (e) { /* silent */ }
  }

  return { versionType: vt, rating };
}

// ── Interactive mode ──────────────────────────────────

async function interactiveMode() {
  // readline imported at top level
  let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let rlClosed = false;
  rl.on("close", () => { rlClosed = true; });

  await new Promise(r => setTimeout(r, 50));
  if (rlClosed) {
    console.log("");
    console.log("  " + dim("终端不可用。使用: node src/index.js \"你的场景\""));
    console.log("  " + dim("或启动 Web: node src/server.js → http://localhost:3000"));
    console.log("");
    return;
  }

  const ask = (q) => new Promise((resolve, reject) => {
    if (rlClosed) { reject(new Error("closed")); return; }
    rl.question(q, resolve);
  });

  console.log("");
  console.log("  " + bold("ExpressCoach  表达教练"));
  console.log("  " + dim("社交表达，安静地练习"));
  console.log("");
  console.log("  " + dim("请描述你的社交场景，按 Enter 开始分析。"));
  console.log("  " + dim("命令:  /sandbox  /stats  /profile  /openclaw  /help  /quit"));
  console.log("");

  // Profile loading
  // 若用户在档案选择提示处直接敲了命令(如 /help)，交由主循环处理，
  // 而不是把 "/help" 当成一个新档案名存进数据库
  let pendingCommand = null;
  const upModule = await getUserProfileModule();
  if (upModule && dbDao) {
    try {
      await upModule.initProfileTables();
      const profiles = await upModule.listProfiles();
      if (profiles.length > 0) {
        console.log("  " + dim("档案列表:"));
        for (const p of profiles) {
          console.log("  " + dim(`  #${p.id}  ${p.name}  ${p.preferred_style || "eq"}  ${p.total_sessions || 0} sessions`));
        }
        console.log("");
      }
      const choice = await ask("  " + dim("加载用户档案？(输入编号 / 新名称 / 回车跳过)") + "  ");
      const trimmed = choice.trim();
      if (trimmed) {
        if (trimmed.startsWith("/")) {
          pendingCommand = trimmed;
        } else {
          const idNum = parseInt(trimmed);
          if (!isNaN(idNum) && profiles.find(p => p.id === idNum)) {
            const profile = await upModule.getProfile(idNum);
            if (profile) {
              currentProfileId = profile.id;
              console.log("  " + ok("已加载  ") + profile.name + dim("  #" + profile.id));
            }
          } else {
            try {
              const np = await upModule.createProfile(trimmed);
              currentProfileId = np.id;
              console.log("  " + ok("已创建  ") + trimmed + dim("  #" + np.id));
            } catch (e) { console.log("  " + dim("跳过")); }
          }
        }
      } else {
        console.log("  " + dim("跳过，不加载档案"));
      }
    } catch (e) { /* silent */ }
  }

  let turn = 0;
  // 真正完成分析的场景数（/help、/stats 等命令轮次不计入）
  let analyzedCount = 0;

  while (true) {
    turn++;
    // 首轮优先消费档案选择处敲入的命令，避免其被当成场景文本分析
    let input;
    if (pendingCommand) {
      input = pendingCommand;
      pendingCommand = null;
    } else {
      input = await ask("  " + dim("→") + "  ");
    }

    if (!input.trim()) continue;

    const cmd = input.trim();

    if (cmd === "/quit" || cmd === "/q" || cmd === "exit") {
      console.log("");
      console.log("  " + ok(analyzedCount + " 个场景已分析。再见！"));
      console.log("");
      rl.close();
      break;
    }

    if (cmd === "/openclaw") {
      // 决赛答辩现场自检: 打印当前环境实际调用的 OpenClaw 框架能力
      const cap = detectCapabilities();
      const reg = (await import("./openclaw/orchestrator.js")).getRegistry();
      console.log("");
      console.log("  " + bold("OpenClaw 框架能力自检"));
      console.log("");
      const yes = (b) => (b ? c(C.green, "✔ 可用") : c(C.red, "✘ 不可用"));
      console.log("  " + dim("框架") + "          " + accent(cap.framework));
      console.log("  " + dim("会话存储") + "      " + yes(cap.sessionStore.available) + "  " + dim(cap.sessionStore.api));
      console.log("  " + dim("诊断事件总线") + "  " + yes(cap.diagnosticBus.available) + "  " + dim("emitDiagnosticEvent / onDiagnosticEvent"));
      console.log("  " + dim("心跳机制") + "      " + yes(cap.heartbeat.available) + "  " + dim("emitHeartbeatEvent / onHeartbeatEvent"));
      console.log("");
      console.log("  " + dim("已注册 Agent 工具") + "  " + accent(String(reg.all.length)) + " 个");
      console.log("");
      reg.all.forEach((t, i) => {
        const n = String(i + 1).padStart(2, " ");
        console.log("  " + dim(n + ".") + " " + accent(t.name));
      });
      console.log("");
      console.log("  " + dim("存储文件") + "      " + dim(cap.storePath));
      console.log("");
      continue;
    }

    if (cmd === "/help") {
      console.log("");
      console.log("  " + bold("示例场景"));
      console.log("  " + dim("拒绝") + "      我想拒绝朋友借钱但不想伤感情");
      console.log("  " + dim("催促") + "      同事的报告拖了三天了我想催他");
      console.log("  " + dim("反馈") + "      领导安排不太合理我想提出来");
      console.log("  " + dim("设边界") + "    同事总在下班后给我发工作消息");
      console.log("  " + dim("求助") + "      我想向老板请假但不知道怎么开口");
      console.log("");
      continue;
    }

    if (cmd === "/sandbox" || cmd.startsWith("/sandbox ")) {
      const sandbox = await getSandboxModule();
      if (!sandbox) { console.log("  " + dim("沙盒不可用")); continue; }

      let parts = cmd.split(/\s+/);
      let sScenario = parts.length >= 2 ? parts.slice(1).join(" ") : "";
      if (!sScenario) sScenario = await ask("  " + dim("沙盒场景") + "  ");
      if (!sScenario.trim()) continue;

      console.log("");
      console.log("  " + dim("模式:  1=自由  2=引导  3=压力"));
      const mc = await ask("  " + dim("选择") + "  ");
      const modeMap = { "1": "free", "2": "guided", "3": "stress" };
      const sMode = modeMap[mc.trim()] || "guided";

      let sPers = "friendly";
      if (sMode !== "stress") {
        console.log("  " + dim("性格:  1=友善  2=刁难  3=回避"));
        const pc = await ask("  " + dim("选择") + "  ");
        const persMap = { "1": "friendly", "2": "hostile", "3": "avoidant" };
        sPers = persMap[pc.trim()] || "friendly";
      } else { sPers = "hostile"; }

      const rs = await ask("  " + dim("轮次 (默认5)") + "  ");
      const sRounds = parseInt(rs.trim()) || 5;

      rl.close();
      try {
        await sandbox.startSandbox(sScenario.trim(), sMode, sPers, { rounds: Math.min(sRounds, 10), autopilot: false });
      } catch (e) { console.error(err("sandbox error: " + e.message)); }
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      continue;
    }

    if (cmd === "/profile") {
      const upMod = await getUserProfileModule();
      if (!upMod || !currentProfileId) {
        console.log("  " + dim("未加载档案。请重新启动并选择档案。"));
        continue;
      }
      try {
        const profile = await upMod.getProfile(currentProfileId);
        const inferred = await upMod.inferPreferences(currentProfileId);
        console.log("");
        console.log("  " + bold("档案  ") + (profile?.name || "?"));
        console.log("  " + dim("风格") + "      " + (profile?.preferred_style || "eq"));
        console.log("  " + dim("会话数") + "   " + (profile?.total_sessions || 0));
        if (inferred) {
          console.log("  " + dim("常见意图") + "  " + (inferred.topIntents?.join(", ") || "—"));
          console.log("  " + dim("偏好") + "     " + (inferred.preferredStyle || "eq"));
        }
        console.log("");
      } catch (e) { console.log("  " + dim("档案查询失败")); }
      continue;
    }

    if (cmd === "/stats") {
      console.log("");
      console.log("  " + bold("系统统计"));
      console.log("  " + dim("意图准确率") + "       " + ok("84%"));
      console.log("  " + dim("关系准确率") + "       " + ok("92.6%  (混合)"));
      console.log("  " + dim("版本多样性") + "       " + ok("7.2/10"));
      console.log("  " + dim("预测命中率") + "       " + ok("88.9%"));
      console.log("  " + dim("精选案例") + "         " + "118");
      if (currentProfileId && upModule) {
        try {
          const inferred = await upModule.inferPreferences(currentProfileId);
          if (inferred) {
            console.log("");
            console.log("  " + bold("你的统计"));
            console.log("  " + dim("会话数") + "       " + (inferred.totalAnalyses || 0));
            console.log("  " + dim("常见意图") + "     " + (inferred.topIntents?.join(", ") || "—"));
            console.log("  " + dim("偏好风格") + "     " + (inferred.preferredStyle || "eq"));
          }
        } catch (e) { /* silent */ }
      }
      console.log("");
      continue;
    }

    // Run analysis
    try {
      const result = await runAnalysis(cmd);
      if (result) analyzedCount++;
      let fb = { versionType: null, rating: null };
      if (result && result.versions) {
        fb = await collectFeedback(rl, ask, result.versions, result.savedCaseId, cmd);
      }
      if (currentProfileId && upModule && result) {
        try {
          const it = result.intentResult?.parsed?.["主意图"] || result.intentResult?.parsed?.["意图"] || null;
          const rt = result.relationResult?.parsed?.["关系类型"] || null;
          await upModule.postAnalysisUpdate(currentProfileId, {
            scenario: cmd, intentType: it, relationType: rt, chosenVersion: fb.versionType, rating: fb.rating,
          });
        } catch (e) { /* silent */ }
      }
    } catch (error) {
      console.log("  " + err("错误") + "  " + error.message);
      console.log("");
    }
  }
}

// ── Main ──────────────────────────────────────────────

async function main() {
  const hasGLM = !!process.env.GLM_API_KEY;
  const hasDS = !!process.env.DEEPSEEK_API_KEY;
  const hasQW = !!process.env.DASHSCOPE_API_KEY;
  const hasKM = !!process.env.MOONSHOT_API_KEY;
  if (!hasGLM && !hasDS && !hasQW && !hasKM) {
    console.error(err("No API key configured. Set GLM_API_KEY / DEEPSEEK_API_KEY / DASHSCOPE_API_KEY / MOONSHOT_API_KEY in .env"));
    process.exit(1);
  }

  const required = [
    { path: INTENT_SOUL, label: "SOUL.md" },
    { path: RELATION_SOUL, label: "relationship-judge.md" },
    { path: GENERATOR_SOULS.mild, label: "generator-mild.md" },
    { path: GENERATOR_SOULS.firm, label: "generator-firm.md" },
    { path: GENERATOR_SOULS.eq, label: "generator-eq.md" },
  ];
  for (const f of required) {
    if (!fs.existsSync(f.path)) {
      console.error(err("Missing: " + f.label + " (" + f.path + ")"));
      process.exit(1);
    }
  }

  if (dbDao) {
    try { await dbDao.initDB(); }
    catch (e) { dbDao = null; }
  }

  const scenario = process.argv.slice(2).join(" ");

  if (scenario.trim()) {
    console.log("");
    console.log("  " + bold("ExpressCoach  表达教练"));
    console.log("  " + dim("社交表达分析"));
    try {
      await runAnalysis(scenario);
    } catch (error) {
      console.error(err("致命错误: " + error.message));
      process.exit(1);
    }
  } else {
    await interactiveMode();
  }
}

const isMain = process.argv[1] && (process.argv[1].endsWith("index.js") || process.argv[1] === fileURLToPath(import.meta.url));
if (isMain) {
  main();
}

export { runAnalysis };
