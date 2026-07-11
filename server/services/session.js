import { v4 as uuidv4 } from 'uuid';
import { userDao } from '../db/dao.js';

function createSession(nickname) {
  const sessionId = uuidv4();
  return userDao.create(sessionId, nickname);
}

function getOrCreateUser(sessionId, nickname) {
  if (!sessionId) return null;
  let user = userDao.findBySessionId(sessionId);
  if (!user) {
    user = userDao.create(sessionId, nickname);
  } else {
    userDao.updateLastSeen(sessionId);
  }
  return user;
}

function generateSessionId() {
  return uuidv4();
}

export { createSession, getOrCreateUser, generateSessionId };
