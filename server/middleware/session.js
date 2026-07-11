import { getOrCreateUser } from '../services/session.js';

function sessionMiddleware(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  req.sessionId = sessionId || null;
  req.user = null;

  if (sessionId) {
    req.user = getOrCreateUser(sessionId);
  }

  next();
}

export default sessionMiddleware;
