import express from 'express';
import { surveyDao } from '../db/dao.js';
import { getOrCreateUser } from '../services/session.js';
const router = express.Router();

// GET /api/surveys - List all active surveys
router.get('/', (req, res) => {
  try {
    const surveys = surveyDao.getAll();
    res.json({ surveys });
  } catch (err) {
    console.error('[Surveys] List error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/surveys/responses - Get all survey responses
router.get('/responses', (req, res) => {
  try {
    const responses = surveyDao.getResponses();
    res.json({ responses });
  } catch (err) {
    console.error('[Surveys] Responses error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/surveys/:id - Get a specific survey
router.get('/:id', (req, res) => {
  try {
    const survey = surveyDao.getById(req.params.id);
    if (!survey) {
      return res.status(404).json({ error: '问卷不存在' });
    }
    res.json({ survey });
  } catch (err) {
    console.error('[Surveys] Get error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /api/surveys/:id/submit - Submit survey answers
router.post('/:id/submit', (req, res) => {
  try {
    const { answers } = req.body;
    const sessionId = req.headers['x-session-id'];

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: '请提供有效的答案' });
    }

    const survey = surveyDao.getById(req.params.id);
    if (!survey) {
      return res.status(404).json({ error: '问卷不存在' });
    }

    let user = null;
    if (sessionId) {
      user = getOrCreateUser(sessionId);
    }

    surveyDao.submitResponse(survey.id, user ? user.id : null, answers);

    res.json({
      success: true,
      message: '感谢你的参与！你的回答已成功提交。',
    });
  } catch (err) {
    console.error('[Surveys] Submit error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
