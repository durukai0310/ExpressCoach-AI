import express from 'express';
import { userDao, conversationDao, surveyDao, testDao, behaviorDao } from '../db/dao.js';
const router = express.Router();

// GET /api/analytics/summary - Dashboard summary
router.get('/summary', (req, res) => {
  try {
    const summary = {
      totalUsers: userDao.count(),
      totalConversations: conversationDao.totalCount(),
      chatsToday: conversationDao.countToday(),
      totalSurveyResponses: surveyDao.responseCount(),
      totalTestResults: testDao.resultCount(),
      totalBehaviorEvents: behaviorDao.totalCount(),
    };
    res.json({ summary });
  } catch (err) {
    console.error('[Analytics] Summary error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/analytics/behavior - Behavior log statistics
router.get('/behavior', (req, res) => {
  try {
    const stats = behaviorDao.getStats();
    const recent = behaviorDao.getRecent(50);
    res.json({ stats, recent });
  } catch (err) {
    console.error('[Analytics] Behavior error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/analytics/survey-stats - Survey response aggregation
router.get('/survey-stats', (req, res) => {
  try {
    const responses = surveyDao.getResponses();
    const surveys = surveyDao.getAll();

    const stats = surveys.map(s => {
      const surveyResponses = responses.filter(r => r.survey_id === s.id);
      return {
        surveyId: s.id,
        title: s.title,
        responseCount: surveyResponses.length,
      };
    });

    res.json({ stats, responses });
  } catch (err) {
    console.error('[Analytics] Survey stats error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/analytics/test-stats - Test score distributions
router.get('/test-stats', (req, res) => {
  try {
    const tests = testDao.getAll();
    const results = testDao.getResults();

    const stats = tests.map(t => {
      const testResults = results.filter(r => r.test_id === t.id);
      const scores = testResults.map(r => r.score);
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const percentages = testResults.map(r => Math.round((r.score / r.max_score) * 100));
      const avgPct = percentages.length > 0 ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length) : 0;

      return {
        testId: t.id,
        title: t.title,
        category: t.category,
        responseCount: testResults.length,
        avgScore: Math.round(avg * 10) / 10,
        avgPercentage: avgPct,
      };
    });

    // Daily chat counts for line chart
    const dailyChats = conversationDao.dailyCounts(7);

    res.json({ stats, results, dailyChats });
  } catch (err) {
    console.error('[Analytics] Test stats error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
