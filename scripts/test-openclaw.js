#!/usr/bin/env node
/**
 * OpenClaw 集成回归测试 — scripts/test-openclaw.js
 *
 * 用法: node scripts/test-openclaw.js
 *
 * 验证决赛重构后，项目对 OpenClaw 框架的四类能力是否真实生效:
 *   1. 会话存储 (resolveSessionKey / updateSessionStore)
 *   2. 诊断事件总线 (emitDiagnosticEvent / onDiagnosticEvent)
 *   3. 心跳机制 (emitHeartbeatEvent / onHeartbeatEvent)
 *   4. 多智能体工具编排 (AnyAgentTool 规范注册 + 调度)
 *
 * 退出码: 0 = 全部通过, 1 = 存在失败
 */

import "dotenv/config";
import {
  detectCapabilities,
  sessionKey,
  loadSessions,
  updateSession,
  emitTrace,
  onTrace,
  heartbeatTick,
  onHeartbeat,
} from "../src/openclaw/runtime.js";
import { SessionMemory, recallProfile } from "../src/openclaw/memory.js";
import { getRegistry, runPipeline, SandboxOrchestrator } from "../src/openclaw/orchestrator.js";

const results = [];
let failed = 0;

function check(name, condition, detail = "") {
  const ok = !!condition;
  if (!ok) failed++;
  results.push({ name, ok, detail });
  const mark = ok ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✘\x1b[0m";
  console.log(`  ${mark} ${name}${detail ? "  \x1b[2m" + detail + "\x1b[0m" : ""}`);
}

function section(title) {
  console.log("");
  console.log(`  \x1b[1m${title}\x1b[0m`);
}

// ═══════════════════════════════════════════════════════
section("1. 框架能力探测");

const cap = detectCapabilities();
check("框架标识为 OpenClaw", cap.framework === "OpenClaw", cap.framework);
check("会话存储可用", cap.sessionStore.available, cap.sessionStore.api);
check("诊断事件总线可用", cap.diagnosticBus.available);
check("心跳机制可用", cap.heartbeat.available);

// ═══════════════════════════════════════════════════════
section("2. 会话键派生");

const k1 = sessionKey("intent", "user-a");
const k2 = sessionKey("intent", "user-b");
const k3 = sessionKey("intent", "user-a");
check("键保留 expresscoach 命名空间", k1.startsWith("expresscoach:"), k1);
check("不同 subject 产生不同键", k1 !== k2, `${k1} vs ${k2}`);
check("相同参数派生结果稳定", k1 === k3);

// ═══════════════════════════════════════════════════════
section("3. 会话存储读写");

const testKey = sessionKey("selftest", `t-${Date.now()}`);
const written = await updateSession(testKey, { probe: "value", n: 1 });
check("写入返回条目", written && written.probe === "value", JSON.stringify(written));

const reread = loadSessions()[testKey];
check("可重新读出", reread && reread.probe === "value", JSON.stringify(reread));

const merged = await updateSession(testKey, { n: 2 });
check("二次写入合并而非覆盖", merged?.probe === "value" && merged?.n === 2, JSON.stringify(merged));

// ═══════════════════════════════════════════════════════
section("4. 诊断事件总线往返");

let diagGot = null;
const offDiag = onTrace((e) => { diagGot = e; });
emitTrace("selftest.event", { marker: "abc" });
await new Promise((r) => setTimeout(r, 200));
check("能收到自己发出的事件", diagGot?.type === "expresscoach.selftest.event", JSON.stringify(diagGot));
check("事件携带自定义字段", diagGot?.marker === "abc");
if (typeof offDiag === "function") offDiag();

// ═══════════════════════════════════════════════════════
section("5. 心跳事件往返");

let hbGot = null;
const offHb = onHeartbeat((e) => { hbGot = e; });
heartbeatTick("selftest-agent", "probe", { round: 7 });
await new Promise((r) => setTimeout(r, 200));
check("能收到心跳节拍", hbGot?.agentId === "selftest-agent", JSON.stringify(hbGot));
check("心跳携带轮次", hbGot?.round === 7);
if (typeof offHb === "function") offHb();

// ═══════════════════════════════════════════════════════
section("6. 多智能体工具注册表");

const reg = getRegistry();
check("注册 8 个 Agent 工具", reg.all.length === 8, String(reg.all.length));

const expected = [
  "expresscoach.intent",
  "expresscoach.relationship",
  "expresscoach.generate.mild",
  "expresscoach.generate.firm",
  "expresscoach.generate.eq",
  "expresscoach.predict",
  "expresscoach.coach",
  "expresscoach.simulator",
];
const missing = expected.filter((n) => !reg.byName.has(n));
check("关键 Agent 全部就位", missing.length === 0, missing.join(",") || "无缺失");

const badSchema = reg.all.filter(
  (t) => !t.name || !t.description || !t.parameters || typeof t.handler !== "function"
);
check("工具均符合 AnyAgentTool 规范", badSchema.length === 0, badSchema.map((t) => t.name).join(",") || "全部合规");

// ═══════════════════════════════════════════════════════
section("7. 记忆桥接 (跨进程持久化)");

const pid = `mem-${Date.now()}`;
const m1 = new SessionMemory(pid, { profileId: 999 });
await m1.push("user", "记忆桥接测试消息");
await m1.consolidate({ intent: "拒绝", relationship: "同事", sensitivity: 3.1, style: "eq" });

const m2 = new SessionMemory(pid, { profileId: 999 });
check("新实例能恢复上下文", m2.history().length === 1, JSON.stringify(m2.history()));

const prof = recallProfile(999);
check("画像记忆已沉淀", prof?.stats?.total >= 1, JSON.stringify(prof?.stats));

// ═══════════════════════════════════════════════════════
section("8. 六阶段管线端到端 (真实 API)");

const t0 = Date.now();
const r = await runPipeline("我想拒绝朋友借钱但不想伤感情", {
  sessionId: `pipe-${Date.now()}`,
  profileId: 999,
});
const dt = Date.now() - t0;

check("意图识别有结果", !!(r.intent?.["意图"] ?? r.intent?.intent),
  String(r.intent?.["意图"] ?? r.intent?.intent));
check("关系判断有结果", !!r.relationship?.["关系类型"], String(r.relationship?.["关系类型"]));
check("四维敏感度已计算", typeof r.relationship?.敏感度得分 === "number",
  String(r.relationship?.敏感度得分));
check("敏感度公式已生成", !!r.relationship?.敏感度公式, String(r.relationship?.敏感度公式));
check("三版本已生成", Array.isArray(r.versions) && r.versions.length >= 3,
  `实际 ${Array.isArray(r.versions) ? r.versions.length : "非数组"}`);
check("差异度数据已附加", !!r.versions?._similarities);
check("管线标记编排器为 OpenClaw", r.meta?.orchestrator === "OpenClaw");
check("管线完成耗时合理 (<90s)", dt < 90000, `${(dt / 1000).toFixed(1)}s`);

// ═══════════════════════════════════════════════════════
section("9. 沙盒多 Agent 编排 + 心跳节拍");

const beats = [];
const offBeats = onHeartbeat((e) => beats.push(`${e.reason}(r${e.round})`));

const sb = new SandboxOrchestrator(
  "我想拒绝朋友借钱但不想伤感情",
  "guided",
  "friendly",
  { rounds: 3, sessionId: `sb-${Date.now()}` }
);

const turn1 = await sb.sendTurn("最近手头紧，能借我两千吗？");
check("第1轮返回对方回复", !!(turn1.reply || "").trim(), (turn1.reply || "").slice(0, 30));
check("第1轮轮次正确", turn1.round === 1);

const turn2 = await sb.sendTurn("我下个月一定还你");
check("第2轮返回对方回复", !!(turn2.reply || "").trim(), (turn2.reply || "").slice(0, 30));
check("第2轮轮次正确", turn2.round === 2);
check("guided 模式第2轮教练介入", !!turn2.intervention,
  turn2.intervention?.suggestion?.slice(0, 40) || "未介入");

check("心跳按轮次打拍", beats.length === 2, beats.join(" | "));
if (typeof offBeats === "function") offBeats();

const state = sb.getState();
check("会话状态可导出", state.round === 2 && state.history.length === 2);

// ═══════════════════════════════════════════════════════
console.log("");
const passed = results.filter((r) => r.ok).length;
const total = results.length;
if (failed === 0) {
  console.log(`  \x1b[32m\x1b[1m全部通过\x1b[0m  ${passed}/${total}`);
} else {
  console.log(`  \x1b[31m\x1b[1m存在失败\x1b[0m  ${passed}/${total} 通过, ${failed} 失败`);
}
console.log("");
process.exit(failed === 0 ? 0 : 1);
