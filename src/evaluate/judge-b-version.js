const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { callDeepSeek } = require('../intent/recognize');

const JUDGE_PROMPT = `你是一个中文社交表达质量评估专家。请根据以下5个维度对给定的社交回复进行评分（1-5分，5分为最优）。

评估维度：
1. 意图达成度 (25%): 回复是否清晰完整地表达了用户的意图？
   - 1分：完全没表达意图
   - 3分：部分表达但不完整
   - 5分：意图清晰完整传达

2. 关系维护度 (25%): 回复是否考虑了对方的感受，维护了良好关系？
   - 1分：明显伤害关系
   - 3分：中性不影响
   - 5分：增进信任和好感

3. 表达自然度 (20%): 回复是否像真人说话，自然流畅？
   - 1分：生硬像机器翻译
   - 3分：基本通顺可接受
   - 5分：像真人说话，接地气

4. 策略适当性 (20%): 回复策略是否精准匹配当前关系和场景？
   - 1分：策略完全错误
   - 3分：策略可行但不够优
   - 5分：策略精准匹配关系

5. 可操作性 (10%): 回复是否可以直接使用？
   - 1分：没法直接使用
   - 3分：需要修改才能用
   - 5分：可以直接复制使用

场景：{scenario}
关系：{relation}
回复：{response}

请输出JSON格式：
{
  "scores": {
    "intent_achievement": 1-5,
    "relationship_maintenance": 1-5,
    "expression_naturalness": 1-5,
    "strategy_appropriateness": 1-5,
    "operability": 1-5
  },
  "total": 1-5,
  "justification": "评分理由（50字以内）"
}`;

function parseResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1].trim()); } catch (e2) {}
    }
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try { return JSON.parse(braceMatch[0]); } catch (e3) {}
    }
    return null;
  }
}

async function evaluateResponse(scenario, relation, response) {
  const prompt = JUDGE_PROMPT
    .replace('{scenario}', scenario)
    .replace('{relation}', relation)
    .replace('{response}', response);

  try {
    const { content, tokens } = await callDeepSeek(prompt, '', {
      temperature: 0.1,
      maxTokens: 500,
      maxRetries: 2
    });

    const result = parseResponse(content);
    
    if (!result || !result.scores) {
      console.warn(`⚠️ 解析评分结果失败，返回原始内容: ${content.substring(0, 200)}`);
      return {
        raw: content,
        parsed: null,
        tokens,
        error: "解析失败"
      };
    }

    return {
      raw: content,
      parsed: result,
      tokens,
      error: null
    };
  } catch (error) {
    console.error(`❌ 评分时发生错误: ${error.message}`);
    return {
      raw: null,
      parsed: null,
      tokens: 0,
      error: error.message
    };
  }
}

async function batchEvaluate(inputFile, outputFile) {
  const inputPath = path.resolve(__dirname, inputFile.startsWith('/') ? inputFile : '../..', inputFile);
  const outputPath = path.resolve(__dirname, outputFile.startsWith('/') ? outputFile : '../..', outputFile);

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 输入文件未找到: ${inputPath}`);
    process.exit(1);
  }

  const scenarios = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  console.log(`📋 加载 ${scenarios.length} 个场景`);

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    console.log(`\n🔄 处理场景 ${i + 1}/${scenarios.length}: ${scenario.scenario.substring(0, 50)}...`);

    const relation = `${scenario.relationType}-${scenario.intimacy}-${scenario.power}`;
    
    const versions = ['温和版', '坚定版', '高情商版'];
    const versionResults = {};

    for (const version of versions) {
      console.log(`  ⚡ 生成 ${version} 回复...`);
      
      const mockResponse = generateMockResponse(scenario, version);
      console.log(`  📝 生成回复: ${mockResponse.substring(0, 80)}...`);

      console.log(`  📊 评估 ${version}...`);
      const evalResult = await evaluateResponse(scenario.scenario, relation, mockResponse);

      if (evalResult.error) {
        console.error(`  ❌ ${version} 评估失败: ${evalResult.error}`);
        failCount++;
      } else {
        console.log(`  ✅ ${version} 评分: ${evalResult.parsed.total}/5`);
        successCount++;
      }

      versionResults[version] = {
        response: mockResponse,
        evaluation: evalResult
      };
    }

    results.push({
      scenario: scenario.scenario,
      intent: scenario.intent,
      relation: relation,
      expectedIntent: scenario.expectedIntent,
      expectedStrategy: scenario.expectedStrategy,
      versions: versionResults
    });

    if ((i + 1) % 5 === 0) {
      console.log(`\n📈 进度: ${i + 1}/${scenarios.length} | 成功: ${successCount} | 失败: ${failCount}`);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ 批量评估完成！结果已保存到: ${outputPath}`);
  console.log(`📊 统计: 成功 ${successCount} | 失败 ${failCount}`);
}

function generateMockResponse(scenario, version) {
  const responses = {
    '温和版': `我理解你的处境，${scenario.scenario}。不过我这边确实有些困难，可能需要我们一起想个折中方案。`,
    '坚定版': `关于${scenario.scenario}，我仔细考虑过了，我的立场是明确的，无法满足这个要求。`,
    '高情商版': `非常理解你的想法，${scenario.scenario}。从我们的关系出发，我觉得我们可以这样处理，既能照顾到你的需求，也能兼顾我的实际情况。`
  };
  return responses[version] || responses['温和版'];
}

const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--batch') {
    options.batch = args[i + 1];
    i++;
  } else if (args[i] === '--output') {
    options.output = args[i + 1];
    i++;
  }
}

if (options.batch && options.output) {
  batchEvaluate(options.batch, options.output).catch(console.error);
} else if (require.main === module) {
  console.log('用法: node judge.js --batch <输入文件> --output <输出文件>');
  console.log('示例: node judge.js --batch data/scenarios-intent.json --output notes/w4-batch-scores.json');
}

module.exports = { evaluateResponse, batchEvaluate };