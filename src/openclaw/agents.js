/**
 * ExpressCoach × OpenClaw 多智能体定义 — src/openclaw/agents.js
 *
 * 决赛重构: 全部 8 个 Agent 按 OpenClaw Plugin SDK 的 AnyAgentTool 规范定义
 * (name / description / parameters(JSON Schema) / handler)。
 *
 * 同一份定义有两种消费方式:
 *   - 独立部署: orchestrator.js 注册并编排 (CLI / Web 服务器)
 *   - 网关插件: plugin.js 通过 api.registerTool() 逐条托管给 OpenClaw 网关
 *
 * Agent 一览:
 *   intent      意图识别   (M1)   → SOUL.md
 *   relationship 关系判断  (M2)   → soul/relationship-judge.md + 四维敏感度公式
 *   generate.mild / firm / eq     (M4)   → 三个独立生成器 Agent
 *   predict     反应预测   (M5)   → soul/predictor.md
 *   coach       沙盒教练   (M6)   → soul/ 沙盒教练 (非对称: 只观察不参战)
 *   simulator   沙盒对手   (M6)   → 5型人格角色扮演
 */

import { recognizeIntent } from "../intent/recognize.js";
import { hybridAnalyze } from "../relationship/analyze.js";
import { generateVersion } from "../generate/three-versions.js";
import { predictReactions } from "../predict/reactions.js";
import { CoachAgent } from "../sandbox/coach.js";
import { SimulatorAgent } from "../sandbox/simulator.js";

const scenarioParam = {
  type: "object",
  properties: {
    scenario: { type: "string", description: "中文社交场景描述" },
  },
  required: ["scenario"],
};

/**
 * 构建全部 Agent 工具定义 (OpenClaw AnyAgentTool 规范)
 */
export function buildAgentTools() {
  return [
    {
      name: "expresscoach.intent",
      description: "M1 意图识别 Agent: 将社交场景分类为 拒绝/催促/反馈/设边界/求助 五种意图 (LLM+规则兜底, 断网可降级)",
      parameters: scenarioParam,
      handler: async ({ scenario }) => {
        const r = await recognizeIntent(scenario);
        return r.parsed || r;
      },
    },
    {
      name: "expresscoach.relationship",
      description: "M2 关系判断 Agent: 32种中文关系×亲密度/权力/利益三维度标注, 规则(0.3)+LLM(0.7)混合, 内置四维社交敏感度公式 S=0.35I+0.30P+0.25E+0.10C+Δmod",
      parameters: scenarioParam,
      handler: async ({ scenario }) => {
        const r = await hybridAnalyze(scenario);
        return {
          ...(r.parsed || {}),
          敏感度得分: r.sensitivity?.score,
          敏感度公式: r.sensitivity?.formula,
          // 保留完整四维计算结果, 供 CLI/Web 展示公式推导过程
          sensitivity: r.sensitivity || null,
          双重关系: r.dualRelation?.isDual ? r.dualRelation : undefined,
        };
      },
    },
    ...["mild", "firm", "eq"].map((styleKey) => ({
      name: `expresscoach.generate.${styleKey}`,
      description: `M4 ${styleKey === "mild" ? "温和版" : styleKey === "firm" ? "坚定版" : "高情商版"}生成 Agent: 基于关系分析结果生成对应风格的中文表达话术`,
      parameters: {
        type: "object",
        properties: {
          scenario: { type: "string" },
          relationship: { type: "object", description: "M2 关系判断结果" },
        },
        required: ["scenario"],
      },
      handler: async ({ scenario, relationship }) => {
        const v = await generateVersion(scenario, styleKey, relationship || {});
        return { style: styleKey, content: v?.parsed?.content || v?.content || "", strategy: v?.parsed?.strategy || "" };
      },
    })),
    {
      name: "expresscoach.predict",
      description: "M5 反应预测 Agent: 预测对方 接受/犹豫/拒绝/情绪化/转移话题 五种反应及概率, 附应对建议",
      parameters: {
        type: "object",
        properties: {
          scenario: { type: "string" },
          selectedVersion: { type: "string", description: "用户选定的回复文本" },
          style: { type: "string", enum: ["mild", "firm", "eq"] },
        },
        required: ["scenario", "selectedVersion"],
      },
      handler: async ({ scenario, selectedVersion, style }) => predictReactions(scenario, selectedVersion, style || "eq"),
    },
    {
      name: "expresscoach.coach",
      description: "M6 沙盒教练 Agent (非对称架构-元Agent): 静默监控对话, 最小干预原则, 仅在求助/语气风险/僵局/关系偏离/轮次提醒五类关键时刻介入",
      parameters: {
        type: "object",
        properties: {
          context: { type: "array", description: "对话上下文" },
          userMessage: { type: "string" },
          round: { type: "number" },
        },
        required: ["userMessage", "round"],
      },
      handler: async ({ context, userMessage, round }) => {
        const coach = new CoachAgent();
        // CoachAgent 为非对称架构的"元Agent": 只观察不参战, 由心跳节拍触发介入判定
        const decision = await coach.shouldIntervene(context || [], { userMessage, round });
        return { ...decision, round, stats: coach.getInterventionStats() };
      },
    },
    {
      name: "expresscoach.simulator",
      description: "M6 沙盒对手 Agent (非对称架构-角色扮演): 5型可调人格(友善/中性/刁难/回避/情绪), 模拟真实人类社交反应",
      parameters: {
        type: "object",
        properties: {
          context: { type: "array" },
          userMessage: { type: "string" },
          personality: { type: "string", enum: ["friendly", "neutral", "hostile", "avoidant", "emotional"] },
        },
        required: ["userMessage"],
      },
      handler: async ({ context, userMessage, personality }) => {
        const sim = new SimulatorAgent(personality || "friendly");
        return sim.generateReply(context || [], userMessage);
      },
    },
  ];
}
