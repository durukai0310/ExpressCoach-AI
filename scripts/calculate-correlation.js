const fs = require('fs');
const path = require('path');

function calculatePearsonCorrelation(x, y) {
  if (x.length !== y.length) {
    throw new Error('两个数组长度不一致');
  }

  const n = x.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    sumX += xi;
    sumY += yi;
    sumXY += xi * yi;
    sumX2 += xi * xi;
    sumY2 += yi * yi;
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return 0;
  return numerator / denominator;
}

function loadScores(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data;
}

function extractLLMScores(batchScores) {
  const scores = [];
  for (const item of batchScores) {
    for (const version of ['温和版', '坚定版', '高情商版']) {
      const evalResult = item.versions[version]?.evaluation;
      if (evalResult?.parsed?.total) {
        scores.push(evalResult.parsed.total);
      }
    }
  }
  return scores;
}

function extractHumanScores(manualRatings) {
  const scores = [];
  for (const item of manualRatings) {
    for (const version of ['温和版', '坚定版', '高情商版']) {
      const rater1 = item.raters.rater1?.[version];
      const rater2 = item.raters.rater2?.[version];
      
      if (rater1 && rater2) {
        const avgScore = Object.values(rater1).reduce((a, b) => a + (b || 0), 0) / 5;
        scores.push(avgScore);
      }
    }
  }
  return scores;
}

function calculateDimensionCorrelations(batchScores, manualRatings) {
  const dimensions = ['intent_achievement', 'relationship_maintenance', 'expression_naturalness', 'strategy_appropriateness', 'operability'];
  const correlations = {};

  for (const dimension of dimensions) {
    const llmScores = [];
    const humanScores = [];

    for (let i = 0; i < batchScores.length; i++) {
      const batchItem = batchScores[i];
      const manualItem = manualRatings[i];

      for (const version of ['温和版', '坚定版', '高情商版']) {
        const llmEval = batchItem.versions[version]?.evaluation?.parsed?.scores;
        const rater1 = manualItem?.raters?.rater1?.[version];
        const rater2 = manualItem?.raters?.rater2?.[version];

        if (llmEval && rater1 && rater2) {
          llmScores.push(llmEval[dimension]);
          humanScores.push((rater1[dimension] + rater2[dimension]) / 2);
        }
      }
    }

    if (llmScores.length > 0) {
      correlations[dimension] = calculatePearsonCorrelation(llmScores, humanScores);
    }
  }

  return correlations;
}

function main() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--llm') {
      options.llm = args[i + 1];
      i++;
    } else if (args[i] === '--human') {
      options.human = args[i + 1];
      i++;
    }
  }

  if (!options.llm || !options.human) {
    console.log('用法: node calculate-correlation.js --llm <LLM评分文件> --human <人工评分文件>');
    console.log('示例: node calculate-correlation.js --llm notes/w4-batch-scores.json --human data/manual-ratings.json');
    process.exit(1);
  }

  try {
    const llmScores = loadScores(options.llm);
    const humanScores = loadScores(options.human);

    console.log('📊 相关性分析结果');
    console.log('=================\n');

    const llmTotalScores = extractLLMScores(llmScores);
    const humanTotalScores = extractHumanScores(humanScores);

    console.log(`LLM评分样本数: ${llmTotalScores.length}`);
    console.log(`人工评分样本数: ${humanTotalScores.length}`);
    console.log('');

    const totalCorrelation = calculatePearsonCorrelation(llmTotalScores, humanTotalScores);
    console.log(`✅ 总分相关性 (Pearson r): ${totalCorrelation.toFixed(4)}`);
    
    if (totalCorrelation >= 0.75) {
      console.log('🎉 达到目标！(r > 0.75)');
    } else {
      console.log('⚠️ 未达到目标，需要优化评分模型');
    }

    console.log('');
    console.log('📈 各维度相关性:');
    
    const dimensionCorrelations = calculateDimensionCorrelations(llmScores, humanScores);
    for (const [dimension, correlation] of Object.entries(dimensionCorrelations)) {
      const dimensionNames = {
        'intent_achievement': '意图达成度',
        'relationship_maintenance': '关系维护度',
        'expression_naturalness': '表达自然度',
        'strategy_appropriateness': '策略适当性',
        'operability': '可操作性'
      };
      console.log(`  ${dimensionNames[dimension] || dimension}: ${correlation.toFixed(4)}`);
    }

    console.log('');
    console.log('📋 评分统计:');
    console.log(`  LLM评分均值: ${(llmTotalScores.reduce((a, b) => a + b, 0) / llmTotalScores.length).toFixed(2)}`);
    console.log(`  LLM评分标准差: ${Math.sqrt(llmTotalScores.reduce((s, v) => s + Math.pow(v - llmTotalScores.reduce((a, b) => a + b, 0) / llmTotalScores.length, 2), 0) / llmTotalScores.length).toFixed(2)}`);
    console.log(`  人工评分均值: ${(humanTotalScores.reduce((a, b) => a + b, 0) / humanTotalScores.length).toFixed(2)}`);
    console.log(`  人工评分标准差: ${Math.sqrt(humanTotalScores.reduce((s, v) => s + Math.pow(v - humanTotalScores.reduce((a, b) => a + b, 0) / humanTotalScores.length, 2), 0) / humanTotalScores.length).toFixed(2)}`);

  } catch (error) {
    console.error(`❌ 分析失败: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { calculatePearsonCorrelation, extractLLMScores, extractHumanScores };