# 🎯 ExpressCoach AI — 社交表达教练 MVP

> 输入你的社交场景，AI 自动识别意图，并生成三种风格的回复：温和版、坚定版、高情商版。

---

## 快速开始（3 步）

### 第 1 步：安装 Node.js（如已安装可跳过）

打开 https://nodejs.org → 点击左侧 **LTS 20.x** 下载 `.msi` → 一路 Next 安装。

安装完成后，打开**终端**（Win+R → 输入 `cmd` → 回车），验证：

```bash
node -v
```
应该显示 `v20.x.x` 或 `v22.x.x`。

### 第 2 步：安装依赖

在终端中进入本文件夹：

```bash
cd Desktop/expresscoach
npm install
```

### 第 3 步：配置你自己的 API Key

用记事本打开本文件夹中的 `.env` 文件，把 `DEEPSEEK_API_KEY=` 后面的值换成你自己的 Key：

```
DEEPSEEK_API_KEY=sk-你的DeepSeek_API_Key填这里
```

> 📌 免费获取 Key：打开 https://platform.deepseek.com → 注册 → API Keys → 创建 Key（新用户送 500 万 tokens，足够用很久）

---

## 运行

```bash
npm start
```

然后直接输入场景，比如：

```
💬 场景> 我想拒绝朋友借钱但不想伤感情
💬 场景> 我想向老板请假但不知道怎么开口
💬 场景> 朋友误会我了我想解释清楚
```

| 命令 | 功能 |
|------|------|
| 输入场景文字 | AI 分析意图 → 生成三版本回复 |
| `/help` | 查看示例场景 |
| `/quit` | 退出 |

也可以单次运行：

```bash
npm test
```

---

## 项目结构

```
expresscoach/
├── SOUL.md                  # 意图识别专家（5 种意图分类）
├── soul/
│   ├── generator-mild.md    # 温和版生成器（关系维护优先）
│   ├── generator-firm.md    # 坚定版生成器（立场明确优先）
│   └── generator-eq.md      # 高情商版生成器（双赢导向）
├── src/
│   └── index.js             # CLI 入口
├── .env                     # API Key 配置（需自己填）
├── package.json
└── README.md                # 本文件
```

---

## 依赖

| 技术 | 用途 |
|------|------|
| Node.js 20+ | 运行环境 |
| DeepSeek API | LLM 模型 |
| openclaw | Agent 框架 |
| dotenv | 环境变量 |
| sqlite3 | 数据库（后续 W2 使用） |

---

## 团队

- **成员 A**（技术负责人）：核心开发 + SOUL.md 体系 + 多 Agent 协作
- **成员 B**（功能开发）：规则库 / 词典 / Prompt 调优
- **成员 C**（文档/测试）：测试用例 + 演示 + 文档

---

> ExpressCoach AI · 树根杯 · 2026
