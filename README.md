# 🎯 ExpressCoach AI — AI 社交表达教练

> 输入社交场景 → 意图识别 → 关系判断 → 三版本生成 → 反应预测
>
> 我们不是在和 GPT 比谁更会聊，而是比谁更懂社交结构。

[![GitHub](https://img.shields.io/badge/GitHub-ExpressCoach--AI-blue)](https://github.com/durukai0310/ExpressCoach-AI)

---

## 🚀 让别人 3 分钟用上你的程序

### 方法一：分享 GitHub（推荐给有技术基础的人）

把这三行命令发给对方：

```bash
git clone https://github.com/durukai0310/ExpressCoach-AI.git
cd ExpressCoach-AI
npm install
```

然后让对方：
1. 去 [platform.deepseek.com](https://platform.deepseek.com/) 免费注册拿 API Key
2. 把 `.env.example` 改名为 `.env`，填入自己的 Key
3. 双击 `启动.bat`（Windows）或运行 `npm start`

---

### 方法二：直接发压缩包（推荐给完全不懂技术的人）

**在你的电脑上**，把 `expresscoach` 文件夹打包发过去：

```powershell
# 右键 expresscoach 文件夹 → 压缩为 ZIP（或用命令）
Compress-Archive -Path "$env:USERPROFILE\Documents\super-lobster\expresscoach" -DestinationPath "$env:USERPROFILE\Desktop\expresscoach.zip"
```

**对方收到后**，只需三步：

1. 解压到任意目录
2. 去 [platform.deepseek.com](https://platform.deepseek.com/) 免费注册拿 API Key
3. 用记事本打开 `.env` 文件，把 `sk-你的DeepSeek_API_Key填这里` 改成自己的 Key
4. 双击 `启动.bat`

> ⚠️ 压缩包不含 `node_modules`，对方解压后需要双击 `安装依赖.bat`（如果没有 Node.js，需先安装 [nodejs.org](https://nodejs.org)）

---

## 🔑 注册 API Key（2 分钟 · 免费 · 够用很久）

1. 打开 https://platform.deepseek.com/
2. 点右上角"登录"→ 用手机号/微信注册
3. 进入 [API Keys](https://platform.deepseek.com/api_keys) → 点"创建 API Key"
4. 复制 `sk-xxxx` 那串 → 粘贴到 `.env` 文件里
5. 新用户送 **500 万 tokens**，每次分析约消耗 4000 tokens，够用上千次

---

## 🖥️ 启动程序

### 双击启动（最简单）
双击项目文件夹里的 **`启动.bat`** → 输入场景 → 回车 → 看结果

### 命令行启动
```powershell
npm start
# 或者
node src/index.js
```

### 单次分析
```powershell
node src/index.js "我想拒绝朋友借钱但不想伤感情"
```

---

## 🎮 使用指南

| 操作 | 说明 |
|------|------|
| 输入场景文本 | 分析意图 → 判断关系 → 生成三版本 → 预测反应 |
| `/help` | 查看示例场景和命令 |
| `/stats` | 查看系统统计（准确率等数据） |
| `/search` | 搜索历史案例库 |
| `/quit` | 退出程序 |

### 试试这些场景

```
我想拒绝朋友借钱但不想伤感情
同事的报告拖了三天了我想催他
同事总在下班后给我发工作消息
领导安排不太合理我想提出来
我想向老板请假但不知道怎么开口
```

---

## 🏗️ 核心技术架构

```
用户输入
  ↓
🔍 步骤1: 意图识别     → 5种意图 (拒绝/催促/反馈/设边界/求助) | LLM + 规则兜底
  ↓
👥 步骤2: 关系判断     → 32种关系 × 3维度 (亲密度/权力/利益) | 规则(0.3) + LLM(0.7)
  ↓
📝 步骤3: 三版本并行生成 → 🕊️温和版 + 🛡️坚定版 + 🎯高情商版 | Jaccard 差异度检查
  ↓
🔮 步骤4: 反应预测     → 5种反应类型 + 概率评估 + 应对建议 (M5)
  ↓
📊 格式化输出          → 并排对比 + 社交推理链 + SQLite 存储
```

| 模块 | 技术指标 | 验收数据 |
|------|----------|----------|
| M1 意图识别 | 5种分类 · 规则兜底 · 断网降级 | 准确率 84% (25场景) |
| M2 关系判断 | 32种关系 · 三维度标注 · 混合模式 | 准确率 92.6% (18组合) |
| M4 三版本生成 | 并行调用 · Jaccard差异度 · 自动重试 | 差异度均值 7.2/10 |
| M5 反应预测 | 5种反应类型 · 概率评估 · 应对建议 | 合理率 88.9% |
| M7 SQLite | 3张表 · WAL模式 · CRUD | 端到端验证通过 |

---

## 📁 项目结构

```
expresscoach/
├── 启动.bat                      # ← 双击启动
├── 安装依赖.bat                   # ← 首次使用双击安装
├── README.md
├── package.json
├── .env.example                  # 配置模板 → 改名 .env 并填入 Key
├── SOUL.md                       # 意图识别 Agent
├── soul/
│   ├── relationship-judge.md     # 关系判断 Agent
│   ├── predictor.md              # 反应预测 Agent
│   ├── generator-mild.md         # 温和版生成器
│   ├── generator-firm.md         # 坚定版生成器
│   └── generator-eq.md           # 高情商版生成器
├── src/
│   ├── index.js                  # 主程序入口
│   ├── intent/recognize.js       # M1 意图识别
│   ├── relationship/analyze.js   # M2 关系判断
│   ├── generate/three-versions.js# M4 三版本生成
│   ├── predict/reactions.js      # M5 反应预测
│   └── db/
│       ├── schema.sql            # 数据库表结构
│       └── dao.js                # 数据访问层
├── data/
│   ├── intent-rules.json         # 意图关键词规则库
│   ├── relation-dict.json        # 32种关系词典
│   ├── reaction-patterns.json    # 反应检测规则
│   ├── scenarios-intent.json     # 25场景测试集
│   └── seed-cases.json           # 82条种子案例
├── test/
│   ├── test-intent.js            # M1 测试
│   ├── test-relationship.js      # M2 测试
│   └── test-db.js               # M7 测试
├── docs/
│   ├── solved-vs-unsolved.md     # 已解决 vs 未解决清单
│   ├── bug-list.md               # Bug 全记录
│   └── revised-plan-w3-w6.md     # W3-W6 规划
└── notes/
    ├── w2-5min-tech-pitch.md     # ★ 5分钟答辩陈述稿
    ├── w2-competitive-baseline.md# 竞品对比数据
    ├── w2-innovation-claims.md   # 技术不可替代性
    ├── w2-social-computing-accuracy.md
    ├── w2-social-dilemma-test.md
    ├── w2-weakness-analysis.md
    └── w3-sandbox-architecture-design.md
```

---

## 🛠️ 常见问题

| 问题 | 解决 |
|------|------|
| 提示 "DEEPSEEK_API_KEY 未配置" | 注册 DeepSeek → 创建 Key → 填入 `.env` |
| 提示 "node 不是内部命令" | 安装 [Node.js LTS](https://nodejs.org)，勾选 "Add to PATH" |
| npm install 很慢 | `npm config set registry https://registry.npmmirror.com` |
| 双击 bat 闪退 | 右键 `启动.bat` → 编辑 → 检查路径是否正确 |
| 生成内容不理想 | 试试换种方式描述场景，提供更多上下文 |

---

## 👥 团队

超级龙虾杯 / 树根杯参赛作品 · ExpressCoach AI

- **成员A**: 核心引擎开发 (M1+M2+M4+M7) · SOUL.md 架构
- **成员B**: 创新性 & 用户价值 (M5预测+M6效果量化)
- **成员C**: 文档 & 项目管理

---

*W2 Day 14 · 2026-06-14*
