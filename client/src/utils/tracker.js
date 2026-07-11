import { api } from './api';

let eventBuffer = [];
let flushTimer = null;

function flush() {
  if (eventBuffer.length === 0) return;
  const events = [...eventBuffer];
  eventBuffer = [];
  api.post('/behavior/batch', { events }).catch(() => {});
}

export function trackEvent(eventType, page, element, metadata) {
  eventBuffer.push({
    event_type: eventType,
    page: page || window.location.pathname,
    element: element || null,
    metadata: metadata || null,
    client_time: new Date().toISOString(),
  });

  if (eventBuffer.length >= 10) {
    clearTimeout(flushTimer);
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, 15000);
  }
}

export function batchTrack(sessionId, events) {
  api.post('/behavior/batch', { events }).catch(() => {});
}

// Flush on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushTimer && clearTimeout(flushTimer);
    if (eventBuffer.length > 0) {
      // Use sendBeacon for reliable unload delivery
      const sessionId = localStorage.getItem('expresscoach_session');
      const payload = JSON.stringify({ events: eventBuffer });
      navigator.sendBeacon?.('/api/behavior/batch', new Blob([payload], {
        type: 'application/json',
      }));
    }
  });
}
