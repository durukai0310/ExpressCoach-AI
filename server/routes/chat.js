import express from 'express';
import { chatWithCoach } from '../services/ai.js';
import { conversationDao } from '../db/dao.js';
import { getOrCreateUser } from '../services/session.js';
const router = express.Router();

// POST /api/chat - Send message to AI coach
router.post('/', async (req, res) => {
  try {
    const { message, category } = req.body;
    const sessionId = req.headers['x-session-id'];

    if (!message || !message.trim()) {
      return res.status(400).json({ error: '消息不能为空' });
    }

    // Get or create user
    let user = null;
    if (sessionId) {
      user = getOrCreateUser(sessionId);
    }

    // Build message history
    const messages = [];
    if (user) {
      const history = conversationDao.getByUserId(user.id, 20);
      for (const h of history) {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: 'user', content: message.trim() });

    // Save user message
    if (user) {
      conversationDao.create(user.id, 'user', message.trim(), category || 'general', 0);
    }

    // Get AI response
    const result = await chatWithCoach(messages, category || 'general');

    // Save AI response
    if (user) {
      conversationDao.create(user.id, 'assistant', result.content, category || 'general', result.tokens);
    }

    // Get updated history
    const history = user ? conversationDao.getByUserId(user.id, 50) : [];

    res.json({
      reply: result.content,
      tokens: result.tokens,
      history: history.map(h => ({
        id: h.id,
        role: h.role,
        content: h.content,
        category: h.category,
        created_at: h.created_at,
      })),
    });
  } catch (err) {
    console.error('[Chat] Error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/chat/history - Get conversation history
router.get('/history', (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.json({ history: [] });
    }
    const history = conversationDao.getByUserId(user.id, 100);
    res.json({
      history: history.map(h => ({
        id: h.id,
        role: h.role,
        content: h.content,
        category: h.category,
        created_at: h.created_at,
      })),
    });
  } catch (err) {
    console.error('[Chat] History error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// DELETE /api/chat/history - Clear conversation history
router.delete('/history', (req, res) => {
  try {
    const user = req.user;
    if (user) {
      conversationDao.deleteByUserId(user.id);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Chat] Clear error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
