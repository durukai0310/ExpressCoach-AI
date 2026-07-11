import express from 'express';
import { testDao } from '../db/dao.js';
import { getOrCreateUser } from '../services/session.js';
import { chatWithCoach } from '../services/ai.js';
const router = express.Router();

// GET /api/tests - List all active tests
router.get('/', (req, res) => {
  try {
    const tests = testDao.getAll();
    res.json({ tests });
  } catch (err) {
    console.error('[Tests] List error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/tests/results - Get all test results
router.get('/results', (req, res) => {
  try {
    const results = testDao.getResults();
    res.json({ results });
  } catch (err) {
    console.error('[Tests] Results error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/tests/:id - Get a specific test
router.get('/:id', (req, res) => {
  try {
    const test = testDao.getById(req.params.id);
    if (!test) {
      return res.status(404).json({ error: '测试不存在' });
    }
    res.json({ test });
  } catch (err) {
    console.error('[Tests] Get error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /api/tests/:id/submit - Submit test answers, calculate score, get AI analysis
router.post('/:id/submit', async (req, res) => {
  try {
    const { answers } = req.body;
    const sessionId = req.headers['x-session-id'];

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: '请提供有效的答案' });
    }

    const test = testDao.getById(req.params.id);
    if (!test) {
      return res.status(404).json({ error: '测试不存在' });
    }

    let user = null;
    if (sessionId) {
      user = getOrCreateUser(sessionId);
    }

    // Calculate score
    const { score, maxScore, dimensionScores } = calculateScore(test.questions, answers);

    // Generate AI analysis
    let analysis = '';
    try {
      const analysisPrompt = buildAnalysisPrompt(test, score, maxScore, dimensionScores);
      const result = await chatWithCoach(
        [{ role: 'user', content: analysisPrompt }],
        'general'
      );
      analysis = result.content;
    } catch (e) {
      analysis = generateSimpleAnalysis(test, score, maxScore, dimensionScores);
    }

    if (!analysis || analysis.length < 10) {
      analysis = generateSimpleAnalysis(test, score, maxScore, dimensionScores);
    }

    // Save result
    const result = testDao.submitResult(test.id, user ? user.id : null, score, maxScore, analysis, answers);

    res.json({
      success: true,
      result: {
        id: result.id,
        score,
        maxScore,
        percentage: Math.round((score / maxScore) * 100),
        dimensionScores,
        analysis,
      },
    });
  } catch (err) {
    console.error('[Tests] Submit error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

function calculateScore(questions, answers) {
  let score = 0;
  let maxScore = 0;
  const dimensionScores = {};

  for (const q of questions) {
    if (q.type === 'scale') {
      const answer = parseInt(answers[q.id]);
      if (!isNaN(answer)) {
        score += answer;
        maxScore += q.max || 5;
      }
      maxScore += q.max || 5; // Always add max even if not answered
    } else if (q.type === 'multiple_choice' && q.options?.[0]?.score) {
      const answer = answers[q.id];
      const selected = q.options.find(o => o.text === answer);
      if (selected?.score) {
        for (const [dim, val] of Object.entries(selected.score)) {
          dimensionScores[dim] = (dimensionScores[dim] || 0) + val;
          score += val;
        }
        maxScore += Math.max(...Object.values(selected.score)) || 3;
      }
    }
  }

  return { score, maxScore: maxScore || 1, dimensionScores };
}

function buildAnalysisPrompt(test, score, maxScore, dimensionScores) {
  const percentage = Math.round((score / maxScore) * 100);
  let dimText = '';
  if (Object.keys(dimensionScores).length > 0) {
    dimText = Object.entries(dimensionScores)
      .map(([k, v]) => `${k}: ${v}分`)
      .join(', ');
  }

  return `你是一位专业的评估分析师。用户刚完成了"${test.title}"测试。

得分：${score}/${maxScore}（${percentage}%）
${dimText ? '各维度得分：' + dimText : ''}

请用中文给出：
1. 总体评价（2-3句话概括结果）
2. 优势分析（用户做得好的方面）
3. 改进建议（具体可行的建议）
4. 下一步行动（给用户1-2个可执行的行动建议）

请保持鼓励和支持的语气，让用户感到被理解和被激励。`;
}

function generateSimpleAnalysis(test, score, maxScore, dimensionScores) {
  const pct = Math.round((score / maxScore) * 100);
  let level = '';
  if (pct >= 80) level = '优秀';
  else if (pct >= 60) level = '良好';
  else if (pct >= 40) level = '中等';
  else level = '需要提升';

  let dimAnalysis = '';
  if (Object.keys(dimensionScores).length > 0) {
    const sorted = Object.entries(dimensionScores).sort((a, b) => b[1] - a[1]);
    dimAnalysis = `\n\n你的优势维度是「${sorted[0][0]}」，可以继续发挥这方面的特长。`;

    if (sorted.length > 1) {
      const last = sorted[sorted.length - 1];
      dimAnalysis += `\n「${last[0]}」维度有较大提升空间，建议在这方面多投入一些时间练习。`;
    }
  }

  return `## ${test.title} 评估报告

**总体得分：${score}/${maxScore}（${pct}%）- ${level}**

你的测试结果显示整体表现为「${level}」水平。${pct >= 60 ? '你在多个方面表现不错，继续努力可以做得更好！' : '这是一个很好的起点，每个专家都是从基础开始的。'}${dimAnalysis}

### 建议下一步行动：
1. 根据测试中发现的薄弱环节，制定针对性的提升计划
2. 定期（如每2-4周）重新评估，追踪自己的进步
3. 结合 AI 教练的日常对话，获取更多个性化指导

记住：评估的目的是帮助你了解自己，而不是给你贴标签。每个人的成长路径都是独特的！`;
}

export default router;
