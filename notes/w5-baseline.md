# W5 Day 30 性能基线

**日期**: 2026-06-30 (Day 30)
**测试人**: 成员A
**状态**: P0-1/2/3 全部修复完成

---

## 全链路性能基线 (5核心场景)

| # | 场景 | 总耗时 | 意图识别 | 关系判断 | 三版本生成 | 结果 |
|---|------|--------|---------|---------|-----------|------|
| 1 | 我想拒绝朋友借钱但不想伤感情 | ~12s | 2.7s | 1.8s | 3.2s | ✅ |
| 2 | 同事兼好友向你借钱 | ~11s | 2.1s | 2.2s | 3.0s | ✅ |
| 3 | 导师让我延期毕业但我找到工作了 | ~16s | 2.0s | 1.8s | 3.3s | ✅ |
| 4 | 催同事交报告但不想破坏关系 | ~12s | 3.0s | 1.7s | 3.1s | ✅ |
| 5 | 想向老板提意见但怕得罪他 | ~10s | 1.4s | 1.6s | 2.8s | ✅ |

**平均全链路**: ~12.2s
**瓶颈**: API 串行调用 (意图→关系→生成)，三步串行约 5-8s API时间

---

## 单元测试通过率

| 测试文件 | 结果 | 通过率 |
|---------|------|--------|
| test-intent.js | 57/57 | 100% |
| test-relationship.js | 95/81 | 100% (0失败) |
| test-db.js | 25/25 | 100% |

**M1/M2/M7 通过率**: 100%

---

## P0 修复确认

- [x] P0-1: analyze.js 重复导出 — 已确认无重复 (此前已修复)
- [x] P0-2: 统一使用 src/lib/api.js — 6个文件全部完成
  - recognize.js ✅ (移除本地 callDeepSeek，导入 ../lib/api)
  - analyze.js ✅ (移除本地 callDeepSeek，导入 ../lib/api)
  - three-versions.js ✅ (移除本地 callDeepSeek，导入 ../lib/api)
  - sandbox.js ✅ (require 路径 ../intent/recognize → ../lib/api)
  - coach.js ✅ (require 路径 ../intent/recognize → ../lib/api)
  - reactions.js ✅ (require 路径 ../intent/recognize → ../lib/api)
- [x] P0-3: .env.example 完善 — DASHSCOPE_API_KEY + MOONSHOT_API_KEY 已追加

---

## Jaccard 差异度检查

所有5个场景的三版本生成 Jaccard 相似度均 < 0.7，差异度达标。

---

> 📁 文件位置: `notes/w5-baseline.md`
> 
> ⚠️ 全链路平均 ~12s，目标 <5s。API串行瓶颈已识别，Day 32尝试并行化优化。
