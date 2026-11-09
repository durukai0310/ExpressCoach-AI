#!/usr/bin/env node
/**
 * interactive-probe.mjs — CLI 交互模式探针
 *
 * 用途: 以真实子进程启动 src/index.js，按"等待提示 → 发送输入"的脚本驱动，
 *       用于在无 TTY 的环境下回归测试交互模式的各个命令（含沙盒）。
 *
 * 用法:
 *   node scripts/interactive-probe.mjs <preset>
 *   preset: cmds | sandbox | all
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "src", "index.js");

const preset = process.argv[2] || "cmds";

// 每一步: 等待 buffer 中出现 expect 正则 → 发送 send → 再等待 settle 毫秒
const skipProfile = { expect: /加载用户档案/, send: "", settle: 600 };

const scripts = {
  cmds: [
    skipProfile,
    { expect: /→/, send: "/help", settle: 800 },
    { expect: /→/, send: "/stats", settle: 800 },
    { expect: /→/, send: "/profile", settle: 800 },
    { expect: /→/, send: "/openclaw", settle: 800 },
  ],
  sandbox: [
    skipProfile,
    { expect: /→/, send: "/sandbox 我想拒绝朋友借钱但不想伤感情", settle: 1500 },
    { expect: /模式/, send: "2", settle: 1200 },   // 引导模式
    { expect: /性格/, send: "1", settle: 1200 },     // 友善
    { expect: /轮次/, send: "2", settle: 25000 },     // 2 轮，留出 API 时间
  ],
};

const steps = scripts[preset] || scripts.cmds;

const proc = spawn(process.execPath, [CLI], {
  cwd: ROOT,
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

let buffer = "";
let stepIdx = 0;
const transcript = [];

proc.stdout.on("data", (d) => {
  buffer += d.toString();
  tryAdvance();
});
proc.stderr.on("data", (d) => {
  buffer += d.toString();
  tryAdvance();
});

function tryAdvance() {
  if (stepIdx >= steps.length) return;
  const step = steps[stepIdx];
  if (step.expect.test(buffer)) {
    const matchedStep = stepIdx;
    buffer = "";
    stepIdx++;
    setTimeout(() => {
      transcript.push({ step: matchedStep, send: step.send, output: buffer });
      buffer = "";
      if (step.send !== null && step.send !== undefined) {
        if (step.send === "/quit") {
          proc.stdin.write("/quit\n");
        } else if (step.send === "") {
          proc.stdin.write("\n");
        } else {
          proc.stdin.write(step.send + "\n");
        }
      }
    }, step.settle ?? 800);
  }
}

const HARD_TIMEOUT = Number(process.env.PROBE_TIMEOUT_MS || 180000);

setTimeout(() => {
  finish();
}, HARD_TIMEOUT);

function finish() {
  let code = 0;
  console.log("\n════════════════ 探针汇总 ════════════════");
  console.log("preset:", preset, "| 已执行步骤:", stepIdx, "/", steps.length);
  const all = transcript.map((t) => t.output).join("\n");
  const bad = all
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        /(ReferenceError|TypeError|SyntaxError|is not defined|Cannot read|Unhandled|❌|致命错误|错误:)/.test(
          l
        )
    );
  if (bad.length) {
    console.log("⚠️  疑似错误行:");
    [...new Set(bad)].slice(0, 15).forEach((l) => console.log("   " + l));
    code = 1;
  } else {
    console.log("✅ 未发现运行时错误");
  }
  try { proc.kill(); } catch (e) {}
  process.exit(code);
}

// 提前打印每个片段，便于观察
setInterval(() => {
  if (buffer.trim().length > 0 && buffer.length > 200) {
    console.log(buffer);
    buffer = "";
  }
}, 3000);
