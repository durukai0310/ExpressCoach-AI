/**
 * ExpressCoach OpenClaw Plugin — src/plugin.js
 *
 * 决赛重构: 作为 OpenClaw 网关插件运行时，把项目全部 8 个 Agent 工具
 * 通过 api.registerTool() 托管给框架，并挂载框架钩子:
 *
 *   registerTool(...)  8 个 Agent (M1/M2/M4×3/M5/M6×2)
 *   registerHook("subagent_spawned", ...)        监听子 Agent 生命周期
 *   registerHook("heartbeat_prompt_contribution") 向心跳注入教练上下文
 *
 * 用法 (作为 OpenClaw 插件):
 *   在 openclaw.json 中配置:
 *   {
 *     "plugins": {
 *       "expresscoach": { "module": "./src/plugin.js" }
 *     }
 *   }
 *
 * 说明: 框架的 OpenClawPluginDefinition 契约支持 register(api) / activate(api)。
 * 本文件同时保留旧的 { tools, meta } 默认导出形状，兼容既有加载方式。
 */

import { buildAgentTools } from "./openclaw/agents.js";
import { detectCapabilities, emitTrace, heartbeatTick } from "./openclaw/runtime.js";
import { getAvailableModels } from "./lib/api.js";

// 全量 Agent 工具定义 (OpenClaw AnyAgentTool 规范: name/description/parameters/handler)
export const tools = buildAgentTools();

/**
 * 插件元数据
 */
export const meta = {
  name: "expresscoach",
  version: "2.0.0",
  description: "ExpressCoach — AI 社交表达教练，基于四维社交计算模型，由 OpenClaw 编排",
  author: "ExpressCoach Team",
  models: Object.values(getAvailableModels()).map((m) => m.name),
  openclaw: detectCapabilities(),
};

/**
 * 插件注册入口 — OpenClaw Plugin SDK 标准契约
 *
 * 网关宿主注入 api 后，本函数:
 *   1. 逐个注册 Agent 工具
 *   2. 挂载子 Agent 生命周期钩子 (多智能体编排可观测)
 *   3. 挂载心跳上下文注入钩子 (教练节拍)
 */
export function register(api) {
  const log = (...a) => api?.logger?.info?.("[expresscoach]", ...a);

  // ---- 1. 注册全部 Agent 工具 ----
  for (const tool of tools) {
    try {
      api.registerTool(tool);
      log(`registered tool: ${tool.name}`);
    } catch (e) {
      log(`register failed: ${tool.name} — ${e.message}`);
    }
  }

  // ---- 2. 子 Agent 生命周期钩子 (多智能体编排观测) ----
  try {
    api.registerHook(
      ["subagent_spawned", "subagent_ended"],
      async (event) => {
        emitTrace(`lifecycle.${event?.type || "unknown"}`, {
          agentId: event?.agentId ?? event?.runId ?? null,
        });
      },
      { name: "expresscoach.subagent-lifecycle" }
    );
    log("hook registered: subagent lifecycle");
  } catch (e) {
    log(`hook skipped (subagent lifecycle): ${e.message}`);
  }

  // ---- 3. 心跳上下文注入 (教练在每一拍获得当前会话摘要) ----
  try {
    api.registerHook(
      "heartbeat_prompt_contribution",
      async (event) => {
        heartbeatTick("coach", "heartbeat-contribution", {
          sessionKey: event?.sessionKey ?? null,
          agentId: event?.agentId ?? null,
        });
        return { prependContext: "[ExpressCoach] 当前会话启用社交表达教练监控。" };
      },
      { name: "expresscoach.heartbeat-contribution" }
    );
    log("hook registered: heartbeat contribution");
  } catch (e) {
    log(`hook skipped (heartbeat): ${e.message}`);
  }

  log(`ready — ${tools.length} agents, framework=${meta.openclaw.framework}`);
}

/** 兼容旧版: 直接把 register 作为 activate 使用 */
export function activate(api) {
  return register(api);
}

export default {
  id: "expresscoach",
  name: meta.name,
  version: meta.version,
  description: meta.description,
  tools,
  meta,
  register,
  activate,
};
