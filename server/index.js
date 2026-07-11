import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
import { initDatabase } from './db/init.js';
import sessionMiddleware from './middleware/session.js';
import { generateSessionId, getOrCreateUser } from './services/session.js';
import chatRouter from './routes/chat.js';
import surveysRouter from './routes/surveys.js';
import testsRouter from './routes/tests.js';
import analyticsRouter from './routes/analytics.js';
import behaviorRouter from './routes/behavior.js';
import expresscoachRouter from './routes/expresscoach.js';

// Initialize database (async for sql.js)
await initDatabase();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(sessionMiddleware);

// Serve static frontend in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// API Routes
app.use('/api/chat', chatRouter);
app.use('/api/surveys', surveysRouter);
app.use('/api/tests', testsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/behavior', behaviorRouter);
app.use('/api', expresscoachRouter);  // ExpressCoach analyze + sandbox

// Session endpoint - generate new session ID
app.post('/api/session', (req, res) => {
  const sessionId = generateSessionId();
  const { nickname } = req.body || {};
  const user = getOrCreateUser(sessionId, nickname);
  res.json({ sessionId, user: { id: user.id, nickname: user.nickname } });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
  });
});

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) {
        res.status(200).json({ message: 'ExpressCoach API Server is running.' });
      }
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🧠 ExpressCoach Server v2.0`);
  console.log(`  📡 Local:  http://localhost:${PORT}`);
  console.log(`  💚 Health: http://localhost:${PORT}/api/health\n`);
});
