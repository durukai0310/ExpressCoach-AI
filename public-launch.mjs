/**
 * ExpressCoach 公网分享 — 一键启动
 *
 * 启动本地服务器 + localtunnel 隧道，
 * 生成公网链接可直接分享给他人使用。
 *
 * 用法: node public-launch.mjs
 */

import { spawn, execSync } from "child_process";
import { createServer } from "http";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;

// Kill any existing server on our port
try {
  const out = execSync(`netstat -ano | findstr ":${PORT}" | findstr "LISTENING"`, {
    encoding: "utf8", shell: "cmd.exe", timeout: 5000
  });
  for (const line of out.trim().split("\n")) {
    const pid = line.trim().split(/\s+/).pop();
    if (pid) execSync(`taskkill /f /pid ${pid}`, { stdio: "ignore", shell: "cmd.exe" });
  }
} catch {}

console.log("");
console.log("  ExpressCoach  表达教练");
console.log("  正在启动公网分享...");
console.log("");

// ── Step 1: Start the Express server ──
const serverProc = spawn("node", ["src/server.js"], {
  cwd: resolve(__dirname),
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
});

let serverReady = false;
serverProc.stdout.on("data", (data) => {
  const text = data.toString();
  if (text.includes("服务器已启动") || text.includes("listening")) {
    serverReady = true;
  }
});

serverProc.stderr.on("data", (data) => {
  // Suppress dotenv injected noise
  const text = data.toString();
  if (!text.includes("injected env")) process.stderr.write(text);
});

// ── Step 2: Wait for server, then start tunnel ──
await new Promise((resolve) => {
  const check = () => {
    if (serverReady) return resolve();
    setTimeout(check, 300);
  };
  setTimeout(resolve, 5000); // fallback: wait 5s max
  check();
});

console.log("  服务器已启动  http://localhost:" + PORT);
console.log("  正在创建公网隧道...");
console.log("");

// ── Step 3: Start localtunnel ──
const tunnel = spawn("npx.cmd", ["localtunnel", "--port", String(PORT), "--print-requests"], {
  cwd: resolve(__dirname),
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
});

let publicUrl = null;

tunnel.stdout.on("data", (data) => {
  const text = data.toString();
  // localtunnel prints the URL like: your url is: https://xxxx.loca.lt
  const match = text.match(/(https?:\/\/[^\s]+\.loca\.lt)/);
  if (match && !publicUrl) {
    publicUrl = match[1];
    printSuccess(publicUrl);
  }
  // Also print request logs if --print-requests is on
  if (text.includes("GET") || text.includes("POST")) {
    process.stdout.write("  " + text.trim() + "\n");
  }
});

tunnel.stderr.on("data", (data) => {
  const text = data.toString();
  // localtunnel prints URL to stderr sometimes
  const match = text.match(/(https?:\/\/[^\s]+\.loca\.lt)/);
  if (match && !publicUrl) {
    publicUrl = match[1];
    printSuccess(publicUrl);
  }
});

function printSuccess(url) {
  console.log("");
  console.log("  ╔══════════════════════════════════════════╗");
  console.log("  ║      ExpressCoach  公网分享已就绪        ║");
  console.log("  ╠══════════════════════════════════════════╣");
  console.log("  ║                                          ║");
  console.log("  ║  分享链接:                               ║");
  console.log("  ║  " + url + "               ║");
  console.log("  ║                                          ║");
  console.log("  ║  将此链接发送给任何人，打开即可使用       ║");
  console.log("  ║  关闭本窗口即停止分享                     ║");
  console.log("  ╚══════════════════════════════════════════╝");
  console.log("");
}

// ── Cleanup on exit ──
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);

function cleanup() {
  try { tunnel.kill(); } catch {}
  try { serverProc.kill(); } catch {}
  console.log("\n  分享已停止。\n");
  process.exit(0);
}
