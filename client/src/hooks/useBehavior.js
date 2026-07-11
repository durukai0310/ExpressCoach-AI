import { useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { trackEvent } from '../utils/tracker';

export function useBehavior() {
  const location = useLocation();
  const pageStartTime = useRef(Date.now());

  // Track page views on route change
  useEffect(() => {
    const timeSpent = Math.round((Date.now() - pageStartTime.current) / 1000);
    trackEvent('page_view', location.pathname, null, {
      previous_time_spent: timeSpent,
    });
    pageStartTime.current = Date.now();
  }, [location.pathname]);

  // Track clicks on elements with data-track attribute
  useEffect(() => {
    const handler = (e) => {
      const el = e.target.closest('[data-track]');
      if (!el) return;
      trackEvent('click', location.pathname, el.dataset.track);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [location.pathname]);

  // Track time on page (every 30s)
  useEffect(() => {
    const interval = setInterval(() => {
      const timeSpent = Math.round((Date.now() - pageStartTime.current) / 1000);
      trackEvent('time_on_page', location.pathname, null, { seconds: timeSpent });
    }, 30000);
    return () => clearInterval(interval);
  }, [location.pathname]);
}
