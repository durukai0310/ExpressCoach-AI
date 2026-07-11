import express from 'express';
import { behaviorDao } from '../db/dao.js';
import { getOrCreateUser } from '../services/session.js';
const router = express.Router();

// POST /api/behavior/track - Log a single behavior event
router.post('/track', (req, res) => {
  try {
    const { event_type, page, element, metadata, client_time } = req.body;
    const sessionId = req.headers['x-session-id'];

    if (!event_type) {
      return res.status(400).json({ error: 'event_type is required' });
    }

    let user = null;
    if (sessionId) {
      user = getOrCreateUser(sessionId);
    }

    behaviorDao.track(
      user ? user.id : null,
      event_type,
      page || null,
      element || null,
      metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null,
      client_time || null
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[Behavior] Track error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /api/behavior/batch - Log multiple behavior events
router.post('/batch', (req, res) => {
  try {
    const { events } = req.body;
    const sessionId = req.headers['x-session-id'];

    if (!events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events array is required' });
    }

    let user = null;
    if (sessionId) {
      user = getOrCreateUser(sessionId);
    }

    const result = behaviorDao.batchTrack(user ? user.id : null, events);

    res.json({ success: true, inserted: result.inserted });
  } catch (err) {
    console.error('[Behavior] Batch error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
