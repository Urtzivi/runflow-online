(() => {
  'use strict';

  if (window.__runflowPublishRecoveryInstalled) return;
  window.__runflowPublishRecoveryInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const publishPattern = /^\/api\/coach\/athletes\/([^/]+)\/week\/publish(?:\?.*)?$/;
  const CLIENT_TIMEOUT_MS = 15000;

  const inputUrl = input => typeof input === 'string' ? input : String(input?.url || '');

  async function verifyPublished(athleteId, weekStart) {
    if (!athleteId || !weekStart) return null;
    const end = new Date(`${weekStart}T12:00:00`);
    end.setDate(end.getDate() + 6);
    const newest = end.toISOString().slice(0, 10);
    const response = await nativeFetch(
      `/api/coach/athletes/${encodeURIComponent(athleteId)}/calendar?oldest=${encodeURIComponent(weekStart)}&newest=${encodeURIComponent(newest)}`,
      { credentials: 'same-origin', cache: 'no-store' }
    );
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    return (data.weeks || []).find(week => week.week_start === weekStart && week.status === 'published') || null;
  }

  function recoveredResponse(week) {
    return new Response(JSON.stringify({
      week,
      intervals: {
        skipped: true,
        reason: 'Semana publicada en RunFlow. La sincronización con Intervals no se pudo confirmar y puede reintentarse después.'
      },
      already_published: true,
      recovered_after_sync_failure: true
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  window.fetch = async function runflowPublishFetch(input, init = {}) {
    const url = inputUrl(input);
    const match = url.match(publishPattern);
    if (!match || String(init?.method || 'GET').toUpperCase() !== 'POST') {
      return nativeFetch(input, init);
    }

    let body = {};
    try { body = JSON.parse(init.body || '{}'); } catch {}
    const weekStart = String(body.week_start || body.start_date || '').slice(0, 10);
    const athleteId = decodeURIComponent(match[1]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    let signal = controller.signal;
    if (init.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      signal = AbortSignal.any([init.signal, controller.signal]);
    }

    try {
      const response = await nativeFetch(input, { ...init, signal });
      if (response.ok) return response;

      const published = await verifyPublished(athleteId, weekStart).catch(() => null);
      return published ? recoveredResponse(published) : response;
    } catch (error) {
      const published = await verifyPublished(athleteId, weekStart).catch(() => null);
      if (published) return recoveredResponse(published);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
})();
