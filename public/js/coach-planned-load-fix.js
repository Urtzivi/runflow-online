(() => {
  'use strict';

  if (window.__runflowPlannedLoadFixInstalled) return;
  window.__runflowPlannedLoadFixInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const publishPattern = /^\/api\/coach\/athletes\/([^/]+)\/week\/publish(?:\?.*)?$/;

  function bodyObject(init) {
    try { return JSON.parse(init?.body || '{}'); }
    catch { return null; }
  }

  async function estimate(athleteId, workouts) {
    const response = await nativeFetch(`/api/coach/athletes/${encodeURIComponent(athleteId)}/planned-load/estimate`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ workouts }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo estimar la carga planificada.');
    return data;
  }

  window.fetch = async function runflowPlannedLoadFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const match = url.match(publishPattern);
    const method = String(init?.method || 'GET').toUpperCase();
    if (!match || method !== 'POST') return nativeFetch(input, init);

    const body = bodyObject(init);
    const workouts = Array.isArray(body?.workouts) ? body.workouts : [];
    const missing = workouts.some(workout => !(Number(workout?.planned_load || 0) > 0));
    if (!missing) return nativeFetch(input, init);

    try {
      const athleteId = decodeURIComponent(match[1]);
      const result = await estimate(athleteId, workouts);
      const estimates = Array.isArray(result?.estimates) ? result.estimates : [];
      const byId = new Map(estimates.filter(item => item?.id).map(item => [String(item.id), item]));
      const byKey = new Map(estimates.filter(item => item?.key).map(item => [String(item.key), item]));
      const bySignature = new Map(estimates.map(item => [`${item.workout_date || ''}|${item.title || ''}`, item]));

      body.workouts = workouts.map(workout => {
        if (Number(workout?.planned_load || 0) > 0) return workout;
        const item = (workout?.id && byId.get(String(workout.id)))
          || (workout?.key && byKey.get(String(workout.key)))
          || bySignature.get(`${workout?.workout_date || ''}|${workout?.title || ''}`);
        if (!item || !(Number(item.planned_load) > 0)) return workout;
        const blocks = Array.isArray(workout.blocks) ? workout.blocks.slice() : [];
        const filtered = blocks.filter(block => block?.type !== 'runflow_planned_load');
        filtered.push({
          type: 'runflow_planned_load',
          source: item.source || 'runflow_estimate',
          confidence: item.confidence || 'low',
          samples: Number(item.samples || 0),
          estimated_at: new Date().toISOString(),
        });
        return { ...workout, planned_load: Number(item.planned_load), blocks: filtered };
      });

      body.target_load = body.workouts.reduce((sum, workout) => sum + Number(workout?.planned_load || 0), 0);
      body.planned_load = body.target_load;

      return nativeFetch(input, { ...init, body: JSON.stringify(body) });
    } catch (error) {
      console.warn('[RunFlow] Planned-load estimation failed; publishing original payload.', error);
      return nativeFetch(input, init);
    }
  };
})();
