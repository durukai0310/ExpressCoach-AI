const API_BASE = '/api';

function getSessionId() {
  let sessionId = localStorage.getItem('expresscoach_session');
  if (!sessionId) {
    sessionId = 'temp_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('expresscoach_session', sessionId);
    // Register with server
    fetch(`${API_BASE}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(res => res.json())
      .then(data => {
        if (data.sessionId) {
          localStorage.setItem('expresscoach_session', data.sessionId);
        }
      })
      .catch(() => {});
  }
  return sessionId;
}

async function request(path, options = {}) {
  const sessionId = getSessionId();
  const headers = {
    'Content-Type': 'application/json',
    'X-Session-Id': sessionId,
    ...options.headers,
  };

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

export { getSessionId };
