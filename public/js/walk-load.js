// Paseos no registrados contados como carga pequeña a partir de los pasos diarios del reloj (Intervals wellness).
// Regla: pasos del día − pasos de las actividades registradas − pasos normales del atleta (mediana de los 28 días
// anteriores, ya sin actividades). Si sobran 3.000 pasos o más (unos 30 min andando), es un paseo: ≈1,7 de carga por cada 1.000 pasos
// extra (lo que Intervals suele dar a un paseo de 10.000 pasos), con un máximo de 25 al día. Es solo informativo:
// no toca la aptitud, la fatiga ni la forma, que siguen viniendo de Intervals.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunflowWalkLoad = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RULE = {
    baselineDays: 28,
    minBaselineDays: 7,
    minExtraSteps: 3000,
    loadPer1000: 1.7,
    maxLoadPerDay: 25,
    stepsPerMinute: 100,
  };

  const FOOT = /run|walk|hike|trail|treadmill|snowshoe|footsal|carrera|andar|paseo|caminar|senderismo/i;
  const WALKISH = /walk|hike|snowshoe|andar|paseo|caminar|senderismo/i;

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function addDays(iso, days) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function median(values) {
    const list = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
    if (!list.length) return null;
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  // Pasos diarios de una fila de wellness de Intervals (o de daily_metrics si algún día se guardan).
  function stepsOf(row) {
    if (!row) return null;
    const value = num(row.steps ?? row.step_count ?? row.daily_steps);
    return value !== null && value >= 0 ? value : null;
  }

  function dateOf(row) {
    return String((row && (row.metric_date || row.date || row.id || row.activity_date || row.start_date_local)) || '').slice(0, 10);
  }

  // Pasos aproximados de una actividad registrada, para no contar dos veces la misma carrera o el mismo paseo.
  function activitySteps(activity) {
    if (!activity) return 0;
    const raw = activity.raw_summary || {};
    const sport = `${activity.sport || raw.type || ''} ${activity.name || raw.name || ''}`;
    if (!FOOT.test(sport)) return 0;
    const direct = num(raw.steps ?? raw.total_steps);
    if (direct !== null && direct > 0) return direct;
    const minutes = (num(raw.moving_time) ?? num(activity.duration_sec) ?? num(raw.elapsed_time) ?? 0) / 60;
    let cadence = num(raw.average_cadence ?? raw.avg_cadence);
    if (cadence !== null && cadence >= 55 && cadence <= 110) cadence *= 2; // zancadas por minuto → pasos por minuto
    if (cadence !== null && cadence >= 80 && cadence <= 230 && minutes > 0) return Math.round(cadence * minutes);
    const walking = WALKISH.test(sport);
    const distance = num(activity.distance_m ?? raw.distance);
    if (distance !== null && distance > 0) return Math.round(distance / (walking ? 0.75 : 1.1));
    return Math.round(minutes * (walking ? 110 : 165));
  }

  // wellness: filas con fecha y pasos (desde oldest − 28 días). activities: actividades registradas del mismo rango.
  function computeWalks({ wellness = [], activities = [], oldest, newest, rule = {} } = {}) {
    const r = { ...RULE, ...rule };
    const stepsByDate = new Map();
    for (const row of wellness) {
      const date = dateOf(row), steps = stepsOf(row);
      if (date && steps !== null) stepsByDate.set(date, steps);
    }
    const activityByDate = new Map();
    for (const activity of activities) {
      const date = dateOf(activity);
      if (!date) continue;
      activityByDate.set(date, (activityByDate.get(date) || 0) + activitySteps(activity));
    }
    const residual = date => {
      const steps = stepsByDate.get(date);
      if (steps === undefined) return null;
      return Math.max(0, steps - (activityByDate.get(date) || 0));
    };
    const days = [];
    let lastBaseline = null;
    for (let date = oldest; date && date <= newest; date = addDays(date, 1)) {
      const steps = stepsByDate.has(date) ? stepsByDate.get(date) : null;
      const previous = [];
      for (let i = 1; i <= r.baselineDays; i += 1) {
        const value = residual(addDays(date, -i));
        if (value !== null && value > 0) previous.push(value);
      }
      const baseline = previous.length >= r.minBaselineDays ? Math.round(median(previous)) : null;
      if (baseline !== null) lastBaseline = baseline;
      const fromActivities = activityByDate.get(date) || 0;
      const extra = steps !== null && baseline !== null ? Math.max(0, Math.round(steps - fromActivities - baseline)) : null;
      const isWalk = extra !== null && extra >= r.minExtraSteps;
      days.push({
        date,
        steps,
        activity_steps: fromActivities,
        baseline,
        extra_steps: extra,
        walk: isWalk,
        walk_min: isWalk ? Math.round(extra / r.stepsPerMinute) : 0,
        load: isWalk ? Math.min(r.maxLoadPerDay, Math.round(r.loadPer1000 * extra / 1000)) : 0,
      });
    }
    const walks = days.filter(d => d.walk);
    return {
      days,
      has_steps: days.some(d => d.steps !== null),
      baseline: lastBaseline,
      total_load: walks.reduce((s, d) => s + d.load, 0),
      total_min: walks.reduce((s, d) => s + d.walk_min, 0),
      walk_days: walks.length,
      rule: r,
    };
  }

  function weekSummary(result, start, end) {
    const days = (result?.days || []).filter(d => d.date >= start && d.date <= end);
    const walks = days.filter(d => d.walk);
    return { days, walks, load: walks.reduce((s, d) => s + d.load, 0), minutes: walks.reduce((s, d) => s + d.walk_min, 0) };
  }

  return { RULE, computeWalks, activitySteps, weekSummary, median };
}));
