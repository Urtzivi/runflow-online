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

  function textOf(workout) {
    const blocks = Array.isArray(workout?.blocks) ? workout.blocks : [];
    return [
      workout?.title,
      workout?.summary,
      workout?.structured_description,
      workout?.session_objective,
      workout?.adaptation_target,
      workout?.purpose,
      ...blocks.flatMap(block => [block?.name, block?.target, block?.recovery_target]),
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function localEstimate(workout) {
    const duration = Number(workout?.planned_duration_min || 0);
    if (!(duration > 0)) return 0;
    const sport = String(workout?.sport || '').toLowerCase();
    const text = textOf(workout);

    if (workout?.is_strength || /strength|fuerza|weight|gimnasio/.test(sport)) {
      let rate = 0.92;
      if (/máxima|pesad|heavy|potencia|salto|excéntric/.test(text)) rate = 1.02;
      if (/descarga|taper|activación|regener/.test(text)) rate = 0.72;
      return Math.max(1, Math.round(duration * rate));
    }

    if (/ride|bike|cycling|bici/.test(sport)) return Math.max(1, Math.round(duration * 0.58));

    let rate = 0.80;
    if (/regener|recovery|recuperación|z1/.test(text) && !/z2/.test(text)) rate = 0.62;
    else if (/competición|competition|bkt|apuko/.test(text)) rate = 1.08;
    else if (/vo2|vo₂|z5|intervalos rápidos|fuerte/.test(text)) rate = 1.00;
    else if (/umbral|threshold|lt2|z4/.test(text)) rate = 0.94;
    else if (/cuesta|subida|hill/.test(text)) rate = 0.92;
    else if (/tempo|z3|sostenido|específico/.test(text)) rate = 0.88;
    else if (/tirada|long|trail/.test(text)) rate = 0.76;
    else if (/easy|suave|z2|aeróbic|base/.test(text)) rate = 0.78;
    return Math.max(1, Math.round(duration * rate));
  }

  function localEstimates(workouts) {
    return (workouts || []).map(workout => ({
      id: workout?.id || null,
      key: workout?.key || null,
      workout_date: workout?.workout_date || null,
      title: workout?.title || '',
      planned_load: Number(workout?.planned_load || 0) > 0 ? Number(workout.planned_load) : localEstimate(workout),
      source: Number(workout?.planned_load || 0) > 0 ? 'existing' : 'browser_conservative_fallback',
      confidence: Number(workout?.planned_load || 0) > 0 ? 'high' : 'low',
      samples: 0,
    }));
  }

  async function remoteEstimate(athleteId, workouts) {
    const response = await nativeFetch(`/api/coach/athletes/${encodeURIComponent(athleteId)}/planned-load/estimate`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ workouts }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Estimador remoto HTTP ${response.status}`);
    return Array.isArray(data?.estimates) ? data.estimates : [];
  }

  function mergeEstimates(workouts, estimates) {
    const byId = new Map(estimates.filter(item => item?.id).map(item => [String(item.id), item]));
    const byKey = new Map(estimates.filter(item => item?.key).map(item => [String(item.key), item]));
    const bySignature = new Map(estimates.map(item => [`${item.workout_date || ''}|${item.title || ''}`, item]));

    return workouts.map(workout => {
      if (Number(workout?.planned_load || 0) > 0) return workout;
      const item = (workout?.id && byId.get(String(workout.id)))
        || (workout?.key && byKey.get(String(workout.key)))
        || bySignature.get(`${workout?.workout_date || ''}|${workout?.title || ''}`)
        || { planned_load: localEstimate(workout), source: 'browser_conservative_fallback', confidence: 'low', samples: 0 };
      const load = Number(item?.planned_load || 0) > 0 ? Number(item.planned_load) : localEstimate(workout);
      const blocks = Array.isArray(workout.blocks) ? workout.blocks.slice() : [];
      const filtered = blocks.filter(block => block?.type !== 'runflow_planned_load');
      filtered.push({
        type: 'runflow_planned_load',
        source: item.source || 'browser_conservative_fallback',
        confidence: item.confidence || 'low',
        samples: Number(item.samples || 0),
        estimated_at: new Date().toISOString(),
      });
      return { ...workout, planned_load: load, blocks: filtered };
    });
  }

  window.fetch = async function runflowPlannedLoadFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const match = url.match(publishPattern);
    const method = String(init?.method || 'GET').toUpperCase();
    if (!match || method !== 'POST') return nativeFetch(input, init);

    const body = bodyObject(init);
    const workouts = Array.isArray(body?.workouts) ? body.workouts : [];
    if (!workouts.length || !workouts.some(workout => !(Number(workout?.planned_load || 0) > 0))) {
      return nativeFetch(input, init);
    }

    const athleteId = decodeURIComponent(match[1]);
    let estimates;
    try {
      estimates = await remoteEstimate(athleteId, workouts);
      if (!estimates.length) throw new Error('El estimador remoto no devolvió resultados.');
    } catch (error) {
      console.warn('[RunFlow] Estimador remoto no disponible; se usa fallback local.', error);
      estimates = localEstimates(workouts);
    }

    body.workouts = mergeEstimates(workouts, estimates);
    body.target_load = body.workouts.reduce((sum, workout) => sum + Number(workout?.planned_load || 0), 0);
    body.planned_load = body.target_load;

    if (!(body.target_load > 0)) {
      throw new Error('RunFlow no ha podido calcular la carga planificada de esta semana. No se publicará con carga 0.');
    }

    return nativeFetch(input, { ...init, body: JSON.stringify(body) });
  };
})();
