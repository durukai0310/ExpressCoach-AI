# 成员B · W5 产出物盘点与缺口清单

**盘点日期**: 2026-07-01 (W5 Day 31 更新)
**对照基准**: W5_成员A_详细操作手册.md

---

## 一、W4 已有产出物

| 产出物 | 路径 | 状态 |
|--------|------|------|
| 中文社交语用学分析 | notes/w4-chinese-pragmatics.md | ✅ |
| 面子协商理论 | docs/w4-face-negotiation.md | ✅ |
| 社交认知偏差 | docs/w4-social-cognitive-bias.md | ✅ |
| W4 数据质量报告 | docs/w4-data-quality-final.md | ✅ (200条, 28/32关系) |
| 用户使用手册 | docs/user-manual.md | ✅ (W5 Day 31 已修订为v2.0) |
| W4 扩展场景 | data/scenarios-w4-expanded.json | ✅ |

---

## 二、W5 当前状态 (Day 31 完成时)

### A 已完成 (Day 31)

| 任务 | 说明 | 状态 |
|------|------|------|
| 公共模块提取 | src/lib/color.js, parse.js, fs-utils.js | ✅ |
| P1-4 API Key 检查 | index.js + sandbox.js 改为至少一个可用 | ✅ |
| P1-5 日志修正 | coach.js + sandbox.js console.error → console.log | ✅ |
| P2-5 autopilot | sandbox.js 默认值确认正确 | ✅ |
| 比赛文件夹同步 | Desktop/比赛文件/expresscoach | ✅ |

### B/C 产出物已就位 (本次同步)

| 产出物 | 来源 | 路径 |
|--------|------|------|
| 竞品对比报告 (终版) | C | docs/competitive-report-final.md |
| 竞品对比报告 (v1存档) | C | docs/competitive-report-v1.md |
| 雷达图数据 | C | docs/radar-data.csv |
| 图表生成脚本 | C | scripts/generate_charts.py |
| W5 训练数据 | B | data/training-w5-complete.json (168条) |
| W4 扩展场景 | B | data/scenarios-w4-expanded.json |
| 策略矩阵 | B | data/strategy-matrix.json |
| 关系词典 (增强版) | B | data/relation-dict-enhanced.json |
| 人工评分模板 | B | data/manual-ratings-template.json |
| 相关性计算工具 | B | scripts/calculate-correlation.js |
| LLM-as-Judge (B版) | B | src/evaluate/judge-b-version.js |
| Bug 清单 (B版存档) | B | docs/bug-list-b-version.md |
| 回归测试报告 | B | docs/w4-regression-test-report.md |
| W4 数据质量报告 | B | docs/w4-data-quality-final.md |
| W5 数据质量报告 | B | docs/w5-data-quality-final.md |
| W5 批量评分 | B | notes/w5-batch-scores.json |
| LLM-人工相关性 | B | notes/w5-llm-human-correlation.md |
| 面子协商理论 | B | docs/w4-face-negotiation.md |
| 社交认知偏差 | B | docs/w4-social-cognitive-bias.md |
| W5 性能基线 (B版) | B | notes/w5-baseline-b.md |

---

## 三、W5 剩余缺口 (Day 32+ 待办)

1. **案例库扩充**: golden-cases.json 当前仅3条 → 目标≥100条 (Day 32)
2. **边界测试**: 空输入/纯英文/emoji/极端场景未系统测试 (Day 32)
3. **已知局限清单**: docs/w5/known-limitations.md ≥10条 (Day 32)
4. **训练数据**: 168条 → 目标200条，关系覆盖9→≥25种
5. **W5 Figures 嵌入**: 需要 Python 环境运行 generate_charts.py
6. **录屏素材**: 5段素材待录制 (Day 33)
7. **代码冻结**: git tag v1.0.0-freeze (Day 34)

---

## 四、文件一致性说明

| 文件 | 桌面项目 | 比赛文件夹 | 备注 |
|------|----------|-----------|------|
| src/lib/ (4文件) | ✅ | ✅ | Day 31 公共模块 |
| src/ (所有模块) | ✅ | ✅ | 已统一导入 |
| docs/ | ✅ | ✅ | 本次同步 |
| data/ | ✅ | ✅ | 本次同步 |
| notes/ | ✅ | ✅ | 本次同步 |
| scripts/ | ✅ | ✅ | 新增目录 |

---

**结论**: W5 Day 31 代码层面已完成，B/C 产出物已全部同步。剩余工作在 Day 32-34 按手册推进。
