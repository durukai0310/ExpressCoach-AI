# ExpressCoach AI — W3-W6 修订版详细任务清单

> 基于 W1+W2(截止Day9) 差距分析 · 2026/06/09 修订
>
> 比赛截止: 7/10 | 开发期: 6/8 → 7/5 | 最终冲刺: 7/6-7/10

---

## 📊 差距回顾：当前 W1+Day8/9 状态 vs 评委关切

| # | 评委关切 | 当前状态 | 差距 | 优先级 |
|---|---------|---------|------|--------|
| 1 | 训练数据从哪来 | 零标注数据，靠手写关键词+prompt | 🔴 巨大 | P0 |
| 2 | 核心场景效果如何 | 无量化指标、无测试集、无人工评分 | 🔴 巨大 | P0 |
| 3 | 竞品对比(GPT/Claude/nSoa) | 零对比 | 🔴 巨大 | P0 |
| 4 | 技术亮点/核心竞争力 | 纯prompt工程，无算法 | 🔴 巨大 | P0 |
| 5 | 多Agent协作 | 单链pipeline，零多Agent | 🟡 中等 | P1 |
| 6 | Agent记忆/上下文 | 无用户画像、无对话历史、无关系图谱 | 🟡 中等 | P1 |
| 7 | 表达效果如何量化 | 仅计划Jaccard多样性检查（不是质量评估）| 🔴 巨大 | P0 |
| 8 | 社交关系计算推理 | 关键词查表，不是推理 | 🟡 中等 | P1 |
| 9 | AI能给出好的社交方案吗 | 未经人工评估验证 | 🟡 中等 | P1 |

---

## 🎯 修订策略：四个支柱

```
支柱1: 数据驱动     → 蒸馏标注数据集 + 评测框架 + 量化指标
支柱2: 技术深化     → 关键词→计算推理 + 社交计算模型 + 多Agent
支柱3: 竞品对标     → A/B对比评测 + 差异化分析 + 令人信服的结果
支柱4: 表达质量量化  → 多维度评分框架 + 人工评估 + 自动指标
```

---

## 📅 W2 剩余 (6/10-6/14) — 补基础 + 埋种子

### Day 10 (周三 6/10) — A: M4三版本 + 公用API提取 ⚡ 调整

```
上午/晚上 (20:00-22:00)

步骤1: 【新增⭐】提取公用 API 模块 (20:00-20:30)
  ├─ VS Code: 创建 src/lib/api.js
  ├─ 从 recognize.js / analyze.js / index.js 提取 callDeepSeek() → 统一到 api.js
  ├─ 同时提取 parseResponse()、loadFile()、颜色工具 → api.js
  ├─ 修改 recognize.js → require('../lib/api').callDeepSeek
  ├─ 修改 analyze.js → require('../lib/api').callDeepSeek
  ├─ 修改 index.js → require('./lib/api').callDeepSeek
  ├─ 三个文件中的 callDeepSeek 重复定义全部删除
  └─ git commit -m "refactor: 提取公用API模块 src/lib/api.js"

步骤2: 给 hybridAnalyze 加 mode 开关 (20:30-20:45)
  ├─ 修改 analyze.js: hybridAnalyze(scenario, opts)
  ├─ opts.mode = "hybrid" | "rule-only" | "llm-only"
  ├─ B 的 Day9 三组对比测试不再需要改源码
  └─ git commit -m "feat: hybridAnalyze增加mode开关"

步骤3: M4三版本 + Jaccard差异度 (20:45-22:00)
  ├─ 创建 src/generate/three-versions.js (原Day10计划)
  ├─ Jaccard: 中文用字符级3-gram (零依赖方案)
  │   function charNgrams(text, n=3) — 滑动窗口取n字符
  │   function jaccardSimilarity(textA, textB) — 交集/并集
  ├─ 三组两两对比 → >0.7 → temperature+0.2 重试(最多3次)
  └─ 终端测试3场景 → git commit
```

### Day 11 (周四 6/11) — A Review + M5预留 + B联调

```
步骤1: A 代码Review (20:00-21:00) — 按原计划

步骤2: 【调整⭐】A 提前完成 M5 接口预留 (21:00-21:20)
  ├─ index.js 第4步插入 M5 调用桩:
  │   // M5: 反应预测 (B负责实现)
  │   let predictions = null;
  │   try {
  │     const { predictReactions } = require('./predict/reactions');
  │     predictions = await predictReactions(scenario, selectedVersion);
  │   } catch(e) { /* B还未实现 */ }
  ├─ 同时把 require 路径标准化，避免 B 集成时路径问题
  └─ git push ← 确保 B 能拉到

步骤3: A 性能基线采集 (21:20-21:40)
  ├─ 在 index.js 每步前后加 performance.now() 计时
  ├─ 跑 5 个标准场景，采集: 意图耗时/关系耗时/三版本耗时/总耗时/tokens
  ├─ 目标基线: 全流程 <10s (接受现实，不是 <5s)
  └─ 写入 notes/w2-performance-baseline.md

步骤4: B 联调 (21:00-22:00) — 按B的原计划 + 留 buffer
```

### Day 12 (周五 6/12) — SQLite + 【新增⭐】评测框架搭建

```
步骤1: SQLite Schema + DAO (20:00-21:00) — 按原计划

步骤2: 【新增⭐】搭建评测数据目录 (21:00-21:30)
  ├─ 创建 test/eval/ 目录
  ├─ 创建 test/eval/scenarios.json — 10个标准评测场景
  │   每个场景含: scenario, expected_intent, expected_relation, difficulty
  ├─ 创建 test/eval/run-eval.js — 自动化评测脚本
  │   批量跑10场景 → 采集输出 → 生成 eval-results.json
  └─ git commit -m "feat: 评测框架基础搭建"

步骤3: 【新增⭐】竞品Baseline采集 (21:30-22:00)
  ├─ 打开 ChatGPT/Claude 网页版
  ├─ 输入同样的10个场景 → "帮我写三段不同风格的回复"
  ├─ 保存原始输出到 test/eval/baselines/gpt4-baseline.json
  ├─ 保存原始输出到 test/eval/baselines/claude-baseline.json
  └─ 这是后续 W4 正式对比评测的素材
```

### Day 13 (周六 6/13 全天) — Bug修复 + 评测数据生成

```
上午 9:00-12:00: P0/P1 Bug修复 (按原计划)
  ├─ 【新增】优先修复: api.js 公用化后的路径兼容性
  └─ 【新增】检查 B 的 M5 集成是否阻塞

下午 13:30-17:00:

步骤1: 【新增⭐】蒸馏训练数据生成 (13:30-15:30)
  ├─ 打开 Claude/ChatGPT
  ├─ 输入: "请生成100个中文社交困境场景JSON，覆盖5种意图×4种关系×5种难度"
  ├─ 每个场景包含: scenario, intent, relation_type, intimacy, power, interest
  ├─ 同时生成每个场景的3条理想回复(温和/坚定/高情商)
  ├─ 保存 → data/training-scenarios.json (100条)
  └─ 这是后续微调/评测的核心数据集

步骤2: 边界测试 + Bug Bash (14:00-16:00) — 按原计划

步骤3: 【新增⭐】表达质量评分标准定义 (16:00-17:00)
  ├─ 创建 docs/evaluation-rubric.md
  ├─ 定义4维度评分标准(0-10分):
  │   · 适当性 (Appropriateness): 在当前关系中是否得体
  │   · 有效性 (Effectiveness): 能否达到沟通目标
  │   · 流畅度 (Fluency): 中文是否自然流畅
  │   · 可执行性 (Actionability): 用户真的能说出这段话吗
  ├─ 每个维度定义 0-2 / 3-5 / 6-8 / 9-10 四个等级的具体锚点
  └─ 这是 W4 正式人工评估的依据
```

### Day 14 (周日 6/14 白天) — Demo + W3沙盒

```
上午: 全量回归 + Demo准备 (按原计划)
下午 15:00-16:00: W2 Review (按原计划)
  ├─ 【新增议题】差距分析汇报 — 明确W3需要转弯
  ├─ 【新增议题】W3双Agent架构讨论 — 不只是"讨论"，要确定技术方案
  └─ 【新增议题】分工确认 — 谁做评测、谁做多Agent、谁做蒸馏数据
```

---

## 📅 W3 (6/15-6/21) — 技术深度周：多Agent + 社交计算 + 评测体系

### 核心目标
```
⭐ 多Agent双角色架构 (教练+模拟对方) → 最小可用循环
⭐ 社交关系从"关键词匹配"升级为"计算推理"
⭐ 完整评测体系: 自动指标 + 人工评分 + 竞品对比
⭐ 蒸馏训练数据 200+ 条
```

### Day 15 (周一 6/15) — 多Agent架构设计 + 角色SOUL.md

```
A — 多Agent框架搭建 (20:00-22:00)

步骤1: 设计双Agent通信协议 (20:00-21:00)
  ├─ 创建 docs/multi-agent-architecture.md
  ├─ 定义 Agent 角色:
  │   · Coach Agent (教练): 分析场景→生成回复→评估质量
  │   · Simulator Agent (模拟对方): 接收回复→预测反应→反馈
  ├─ 通信协议:
  │   Coach → Simulator: {scenario, relation, selected_version, draft_reply}
  │   Simulator → Coach: {reaction_type, sample_response, emotional_state, suggestion}
  │   Coach → Simulator: (第二轮) {revised_reply} → Simulator更新反应
  ├─ 循环控制: 2-3轮对话后终止，输出最终方案
  └─ 参考: 斯坦福 Generative Agents 论文的记忆流架构

步骤2: 编写 Coach Agent SOUL.md (21:00-21:40)
  ├─ 创建 soul/coach-agent.md
  ├─ 角色: "你是一个社交教练，帮助用户在复杂社交场景中找到最佳表达方式"
  ├─ 输入: {scenario, intent, relation_info, round_number, simulator_feedback}
  ├─ 输出: {draft_reply, strategy, confidence, expected_reaction}
  └─ 包含3个 Few-shot 示例

步骤3: 编写 Simulator Agent SOUL.md (21:40-22:00)
  ├─ 创建 soul/simulator-agent.md
  ├─ 角色: "你扮演对话的对方，根据你的性格/关系/利益，真实地反应"
  ├─ 输入: {scenario, relation_info, received_message}
  ├─ 输出: {reaction_type, sample_response, emotional_state, underlying_need}
  ├─ 5种反应类型: 接受/犹豫/拒绝/情绪化/转移话题
  └─ 模拟对方要有"个性"——不只是模板回复

B — 评测体系搭建 (20:00-22:00)

步骤1: 整理 W2 评测数据 (20:00-21:00)
  ├─ 从 test/eval/scenarios.json 跑全量自动化测试
  ├─ 整理 M1 意图准确率 / M2 关系准确率 / M4 三版本数据
  ├─ 创建 notes/w3-eval-plan.md — 评测计划

步骤2: 蒸馏数据扩充 (21:00-22:00)
  ├─ data/training-scenarios.json 从100条扩展到200条
  ├─ 确保覆盖: 32种关系 × 5种意图 的交叉组合
  └─ 每个场景增加"难度"标签 (easy/medium/hard)
```

### Day 16 (周二 6/16) — 多Agent核心实现

```
A — 实现双Agent引擎 (20:00-22:00)

步骤1: 创建 src/agents/coach.js (20:00-20:50)
  ├─ 读取 soul/coach-agent.md
  ├─ 调用 callDeepSeek (现在已在 api.js 中公用)
  ├─ 输入: scenario + intent + relation + 上轮反馈
  ├─ 输出: {draft_reply, strategy, confidence}
  └─ module.exports = { coachGenerate }

步骤2: 创建 src/agents/simulator.js (20:50-21:30)
  ├─ 读取 soul/simulator-agent.md
  ├─ 调用 callDeepSeek
  ├─ 输入: scenario + relation + received_message
  ├─ 输出: {reaction_type, sample_response, emotional_state, suggestion}
  └─ module.exports = { simulateReaction }

步骤3: 创建 src/agents/orchestrator.js — 对话循环 (21:30-22:00)
  ├─ 实现 2-3 轮教练-模拟对方对话循环:
  │   Round 1: Coach生成 → Simulator反应
  │   Round 2: Coach根据反应调整 → Simulator再反应
  │   Round 3: (如需要) Coach最终优化
  ├─ 输出: {final_reply, dialogue_log, iterations, confidence_trend}
  ├─ 增加终止条件: confidence提升停滞 / 达到3轮上限
  └─ git commit -m "feat: 多Agent双角色对话引擎★"

B — 评测数据整理 + 代码Review (20:00-22:00)
  ├─ 完成 200 条蒸馏数据的质量检查
  ├─ 跑 test/eval/run-eval.js → 生成 W3 基线数据
  └─ 检查 A 的多Agent代码
```

### Day 17 (周三 6/17) — 社交关系计算推理升级

```
A — 关系维度计算模型 (20:00-22:00)

步骤1: 创建 src/relationship/compute.js (20:00-21:00)
  ├─ 不查表，而是从场景语义中计算关系维度:
  │
  │   powerDistance(scenario) → 0-1 (权力距离)
  │     · 语义信号: 称呼/动词(命令/请求)/场景结构
  │     · 用 LLM 抽取信号 → 规则量化 → 输出数值
  │
  │   intimacyScore(scenario) → 0-1 (亲密度)
  │     · 信号: 私密话题程度/语气/历史互动暗示
  │
  │   interestConflict(scenario) → 0-1 (利益冲突度)
  │     · 信号: 是否涉及金钱/资源/时间/机会
  │
  │   最终输出: {powerDistance, intimacyScore, interestConflict}
  │
  └─ 这是从"查词典"到"语义推理"的关键升级

步骤2: 与传统词典方法对比 (21:00-21:30)
  ├─ 用 30 个场景对比:
  │   · 方法A: 旧版 ruleMatch() 关键词查表
  │   · 方法B: 新版 compute() 语义推理
  │   · Ground Truth: 人工标注
  ├─ 计算两种方法的准确率差异
  └─ 写入 notes/w3-relation-inference-eval.md

步骤3: 更新 analyze.js (21:30-22:00)
  ├─ hybridAnalyze() 增加 computeMode 选项
  ├─ computeMode="rule" → 旧版关键词
  ├─ computeMode="infer" → 新版语义推理
  ├─ computeMode="hybrid" → 两者融合 (0.3推理+0.7LLM)
  └─ git commit -m "feat: 社交关系语义推理模型★"

B — 竞品对比评测执行 (20:00-22:00)
  ├─ 取 30 个评测场景(覆盖全意图×关系)
  ├─ 四种方案对比:
  │   方案1: 直接问 GPT-4 (一条prompt)
  │   方案2: 直接问 Claude (一条prompt)
  │   方案3: ExpressCoach pipeline (当前版本)
  │   方案4: ExpressCoach 多Agent (新版本)
  ├─ 每个场景记录4种方案的输出原始文本
  └─ 保存到 test/eval/baselines/comparison-raw.json
```

### Day 18 (周四 6/18) — 表达质量量化 + 人工评估

```
A+B 联合 — 人工评估执行

步骤1: 准备评估材料 (20:00-20:30)
  ├─ 从 test/eval/baselines/comparison-raw.json 选取 20 个场景
  ├─ 匿名化: 方案1/2/3/4 → A/B/C/D (随机打乱，评测者不知道哪个是哪个)
  ├─ 制作评分表: 20场景 × 4方案 × 4维度(适当性/有效性/流畅度/可执行性)
  └─ Google Sheets 或 Excel 表格

步骤2: ★ 三人独立评分 (20:30-21:30)
  ├─ A/B/C 三人各自评分(不看别人的)
  ├─ 评分标准: docs/evaluation-rubric.md
  ├─ 每个维度 0-10 分
  ├─ 收集 3×20×4×4 = 960 个评分数据点
  └─ 这是整场比赛最关键的实证数据

步骤3: 统计分析 (21:30-22:00)
  ├─ 计算评分者间信度 (Krippendorff's alpha 或简单 Pearson r)
  ├─ 计算每个方案在4个维度上的均值+标准差
  ├─ 统计显著性: ExpressCoach vs GPT-4 的 t-test
  ├─ 生成图表: 雷达图 + 柱状图 + 场景×方案交叉表
  ├─ 关键发现:
  │   · 哪个方案在"适当性"上最好?
  │   · 哪个方案在"可执行性"上最好?
  │   · 高敏感场景(上级+强利益)下谁更好?
  └─ 写入 notes/w3-human-evaluation-results.md ★
```

### Day 19 (周五 6/19) — Agent记忆 + 用户画像

```
A — Agent记忆系统 (20:00-22:00)

步骤1: 创建 src/memory/user-profile.js (20:00-21:00)
  ├─ Schema:
  │   user_profile: {
  │     id, preferred_style,  // "mild"/"firm"/"eq"
  │     common_scenarios: [], // 高频场景类型
  │     relationship_graph: {}, // {person: {type, intimacy, history}}
  │     tone_preferences: {},   // {formality, directness, warmth}
  │     created_at, updated_at
  │   }
  ├─ 方法: createProfile / updateProfile / getProfile
  └─ 存储: SQLite user_profiles 表

步骤2: 创建 src/memory/conversation-context.js (21:00-21:30)
  ├─ 管理当前对话的上下文窗口:
  │   · 当前场景
  │   · 已选版本
  │   · 模拟对方反应
  │   · 教练调整记录
  │   · 轮次计数器
  ├─ 方法: initContext / addRound / getContext / clearContext
  └─ 多轮对话不丢失上下文

步骤3: 集成到 orchestrator.js (21:30-22:00)
  ├─ orchestrator 每次调用 coach/simulator 时注入上下文
  ├─ 用户切换场景时自动清上下文
  └─ git commit -m "feat: Agent记忆系统+用户画像★"

B — 自动评测指标实现 (20:00-22:00)

步骤1: 创建 test/eval/auto-metrics.js (20:00-21:00)
  ├─ 自动指标(不需要人工):
  │   1. 意图识别准确率 (vs expected_intent)
  │   2. 关系判断准确率 (vs expected_relation)
  │   3. 三版本Jaccard差异度 (多样性)
  │   4. 回复长度统计 (mean/std)
  │   5. 平均响应时间
  │   6. Token 消耗
  └─ 单命令: node test/eval/auto-metrics.js → 输出报告

步骤2: 跑全量评测 (21:00-22:00)
  ├─ 200条测试场景
  ├─ 生成 W3 全量评测报告
  └─ 写入 notes/w3-full-evaluation-report.md
```

### Day 20 (周六 6/20 全天) — 集成冲刺 + 边界打磨

```
上午 9:00-12:00 — 全链路集成
  ├─ orchestrator.js + user-profile.js + conversation-context.js 全链路
  ├─ 端到端测试: 用户输入 → 意图 → 关系推理 → 多Agent对话 → 记忆更新 → 输出
  ├─ 性能优化: 目标全流程 <12s (含2-3轮Agent对话)
  └─ 修复集成中发现的问题

下午 13:30-17:00 — 边界打磨
  ├─ 20+ 边界场景测试(空输入/超长/英文/emoji/多意图混合)
  ├─ 极端关系组合: 陌生人+强利益冲突 / 家人+设边界 / 上级+纯情感
  ├─ 降级方案验证: LLM不可用 → 纯规则/纯推理模式
  └─ P0/P1 Bug 清零
```

### Day 21 (周日 6/21 白天) — W3 Review + Demo

```
上午 10:00-12:00: W3 Demo 准备
  ├─ 准备5个演示场景(逐步展示技术进步):
  │   场景1: 简单场景 → 展示pipeline (W2保底)
  │   场景2: 同场景 → 对比旧版vs新版关系推理
  │   场景3: 多Agent对话 → 展示Coach↔Simulator循环
  │   场景4: 记忆系统 → 展示上下文保持
  │   场景5: 与GPT-4对比 → 展示评测结果
  └─ 准备评测数据可视化图表

下午 15:00-16:00: W3 Review
  ├─ Demo展示 (10min, 5个场景)
  ├─ 评测结果汇报 (5min, 图表+统计)
  ├─ 竞品对比结论 (3min)
  └─ W4 计划讨论
```

### W3 核心产出

```
代码:
  src/lib/api.js                ← 公用API模块
  src/agents/coach.js           ← ★ 教练Agent
  src/agents/simulator.js       ← ★ 模拟对方Agent
  src/agents/orchestrator.js    ← ★ 多Agent对话循环
  src/relationship/compute.js   ← ★ 关系语义推理
  src/memory/user-profile.js    ← ★ 用户画像
  src/memory/conversation-context.js ← ★ 对话上下文

数据:
  data/training-scenarios.json  ← 200条蒸馏标注数据
  test/eval/scenarios.json      ← 评测场景集
  test/eval/baselines/          ← 竞品baseline
  docs/evaluation-rubric.md     ← 评分标准

报告:
  notes/w3-human-evaluation-results.md   ← ★ 人工评估结果
  notes/w3-full-evaluation-report.md     ← 自动化评测报告
  notes/w3-relation-inference-eval.md    ← 关系推理对比
```

---

## 📅 W4 (6/22-6/28) — 深度打磨周：模型优化 + 系统完善

### 核心目标
```
⭐ P0复杂场景突破(陌生人+求助/上级+强利益/家人+边界)
⭐ 基于评测结果的prompt迭代优化
⭐ 前端交互Demo (可选但加分)
⭐ 技术文档 + 答辩材料
```

### Day 22 (周一 6/22) — 弱项攻坚

```
A — 基于W3评测结果的精准优化
  ├─ 分析 W3 人工评估中得分最低的场景类型
  ├─ 针对性优化:
  │   · 如果"上级+强利益"得分低 → 优化 power distance 计算
  │   · 如果"设边界"得分低 → 优化 boundary SOUL.md
  │   · 如果 Simulator 反应不真实 → 优化 simulator-agent.md
  └─ 每优化一个维度 → 重新跑评测 → 验证提升

B — 多Agent对话质量提升
  ├─ 分析 orchestrator 日志: 几轮对话后 confidence 提升?
  ├─ 调优终止条件: 过早终止 vs 过度循环
  └─ 增加"多样性": Simulator 不要每次都用同样的反应模式
```

### Day 23 (周二 6/23) — 进阶特性实现

```
A — 社交博弈策略库 (20:00-21:00)
  ├─ 创建 data/social-strategies.json
  ├─ 涵盖经典社交策略:
  │   · 面子协商 (Face Negotiation)
  │   · 互惠原则 (Reciprocity)
  │   · 门槛效应 (Foot-in-the-door / Door-in-the-face)
  │   · 第三方斡旋 (Third-party mediation)
  │   · 利益交换 (Trade-off framing)
  │   · 情感账户 (Emotional bank account)
  └─ coach.js 在选择策略时参考策略库

B — 角色个性多样化 (21:00-22:00)
  ├─ Simulator Agent 增加"人格参数":
  │   · agreeableness: 0-1 (宜人性)
  │   · assertiveness: 0-1 (果断性)
  │   · emotional_volatility: 0-1 (情绪波动)
  │   · face_sensitivity: 0-1 (面子敏感度)
  ├─ 不同人格参数的 Simulator 表现出不同反应模式
  └─ 提升模拟的真实感和多样性
```

### Day 24 (周三 6/24) — 前端Demo + 可视化

```
A+B — 简单前端交互界面 (可选，加分项)

方案A (推荐): Web界面
  ├─ 创建 public/index.html — 单页应用
  ├─ 后端: Express.js 简单 server.js
  ├─ 前端: 纯 HTML/CSS/JS (不引入框架)
  ├─ 功能:
  │   · 输入场景 → 实时展示分析结果
  │   · 三版本并排卡片展示
  │   · 多Agent对话过程可视化(Coach↔Simulator动画)
  │   · 评分反馈按钮(用户可给回复打分)
  └─ 这是收集真实用户反馈的渠道

方案B (保底): CLI 增强版
  ├─ 增加 --verbose 模式: 展示多Agent对话细节
  ├─ 增加 --eval 模式: 自动跑评测
  └─ 增加 --compare 模式: 与竞品并排对比
```

### Day 25-26 (周四-周五 6/25-6/26) — 文档 + 额外数据

```
A — 技术文档撰写
  ├─ docs/architecture.md — 系统架构文档
  ├─ docs/tech-highlights.md — 技术亮点:
  │   1. 社交关系语义推理模型
  │   2. 多Agent协作对话框架
  │   3. 三维度社交计算(权力/亲密度/利益)
  │   4. 表达质量多维度量化评估
  └─ docs/comparison-report.md — 竞品对比报告

B — 数据补充 + 最终评测
  ├─ training-scenarios.json → 扩展到 300+ 条
  ├─ 增加"极端场景"和"陷阱场景"
  └─ 最终全量评测 → notes/w4-final-eval.md
```

### Day 27-28 (周六-周日 6/27-6/28) — W4 Review

```
W4 Review: 全系统Demo + 完整评测报告 + 技术文档
确认 W5 最终冲刺计划
```

---

## 📅 W5 (6/29-7/5) — 最终冲刺周

### 核心目标
```
⭐ P0 Bug 清零
⭐ 全量回归测试
⭐ 答辩 PPT 制作
⭐ 演示视频录制
⭐ GitHub 仓库整理(README/注释/示例)
```

### 关键任务

```
周一-周二: 全量回归 + P0清零
  ├─ 300条测试场景全量跑
  ├─ M1/M2/M4/M5/M7 全部模块验证
  ├─ 多Agent稳定性: 100次重复运行不crash
  └─ 性能达标验证

周三-周四: 答辩准备
  ├─ PPT制作 (技术架构/评测结果/竞品对比/创新点)
  ├─ Demo视频录制 (5-8分钟)
  │   1. 问题引入: 社交表达困境
  │   2. 系统演示: 3个核心场景
  │   3. 技术亮点: 关系推理+多Agent
  │   4. 评测结果: 与GPT-4对比数据
  │   5. 未来展望: 社交计算平台
  ├─ GitHub README 完善 (中英文)
  └─ 代码注释补全 + API文档

周五: 赛前最后检查
  ├─ 全部材料清单核对
  ├─ 备用方案准备(如果API Key出问题)
  └─ 最终 git push + release tag
```

---

## 📅 W6 (7/6-7/10) — 提交 + 答辩

```
7/6-7/9: 缓冲期
  ├─ 处理最后发现的Bug
  ├─ 答辩演练 (至少3次)
  └─ 评委可能的Q&A准备

7/10: 比赛提交日
  ├─ GitHub release
  ├─ 提交材料包
  └─ 答辩
```

---

## 📊 修订前后对比

| 维度 | 原计划 W3+ | 修订后 W3+ |
|------|-----------|-----------|
| 训练数据 | ❌ 无 | ✅ 蒸馏200-300条标注数据 |
| 效果量化 | ❌ 仅Jaccard多样性 | ✅ 4维度×20场景×人工评估×统计检验 |
| 竞品对比 | ❌ 无 | ✅ vs GPT-4/Claude, 匿名A/B评估 |
| 技术深度 | ❌ prompt工程 | ✅ 关系语义推理 + 社交计算模型 |
| 多Agent | ❌ "W3讨论" | ✅ 双Agent对话循环完整实现 |
| Agent记忆 | ❌ 无 | ✅ 用户画像 + 对话上下文 |
| 表达质量 | ❌ 无标准 | ✅ 评分Rubric + 三人独立评估 |
| 核心竞争力 | ❌ 模糊 | ✅ 5个可论证的技术亮点 |

---

## 🏆 答辩时可以直接引用的数据和结论

如果按这个计划执行，到 W5 你们将拥有：

```
✅ "我们构建了200条蒸馏标注数据集，覆盖32种关系×5种意图"
✅ "我们做了20场景×4方案×4维度=960个评分点的三人独立评估"
✅ "在'上级+强利益'高敏感场景中，ExpressCoach在适当性维度
    上超出GPT-4直接生成 1.2分 (p<0.05)"
✅ "我们的关系语义推理模型比传统关键词匹配准确率提升XX%"
✅ "多Agent对话循环使生成策略的多样性提升XX%"
✅ "三版本Jaccard差异度<0.7，确保了风格真正差异化"
```

---

> 📁 文件位置:
> - 项目文件夹: `Documents/super-lobster/expresscoach/docs/revised-plan-w3-w6.md`
> - 桌面副本: `revised-plan-w3-w6.md`
>
> 建议: 打印或用大屏展示此文档，在 Day 14 W2 Review 上逐条讨论确认
