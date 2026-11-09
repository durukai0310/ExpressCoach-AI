#!/bin/bash
echo "=== 1. 数据文件总览 (14个) ==="
ls -lh data/
echo ""
echo "=== 2. 黄金案例库 ==="
grep -c '"scenario"' data/golden-cases.json
echo "条黄金案例 (人工评分精选)"
echo ""
echo "=== 3. 关系词典 (32种关系) ==="
grep -c '"type"' data/relation-dict.json
echo "种中文社交关系类型"
echo ""
echo "=== 4. 训练数据 ==="
for f in data/training-w5-complete.json data/scenarios-w4-expanded.json data/seed-cases.json; do
  lines=$(wc -l < "$f")
  echo "  $f: ${lines} 行"
done
echo ""
echo "=== 5. SQLite 持久化 ==="
ls -lh data/expresscoach.sqlite
echo ""
echo "=== 全部展示完毕 - 可以开始录制 ==="
