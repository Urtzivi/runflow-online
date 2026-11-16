/*
 * RunFlow · resumen de la semana para la tarjeta de compartir del atleta.
 * Junta todo lo hecho en la semana: carreras, fuerza, fútbol, bici/natación, paseos (los registrados y los
 * estimados con los pasos del reloj) y otras actividades, con minutos y carga en la escala de Intervals.
 * UMD: lo usa server.js (GET /api/athlete/share-week) y scripts/test-week-share.cjs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunFlowWeekShare = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const addDays = (iso, days) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

  // Orden en el que salen en la tarjeta.
  const KINDS = [
    { key: 'run', label: 'Carrera', color: '#4F8FC0' },
    { key: 'strength', label: 'Fuerza', color: '#7A5BB5' },
    { key: 'football', label: 'Fútbol', color: '#E3B341' },
    { key: 'bike', label: 'Bici', color: '#5FA58C' },
    { key: 'swim', label: 'Natación', color: '#2F6FA3' },
    { key: 'walk', label: 'Paseos', color: '#A6C98A' },
    { key: 'other', label: 'Otros', color: '#8A938C' },
  ];
  const KIND_BY_KEY = Object.fromEntries(KINDS.map(k => [k.key, k]));

  // Tipo de deporte de Intervals (o de la sesión de RunFlow) → grupo de la tarjeta.
  function kindOf(sport, workout) {
    const s = String(sport || '').toLowerCase();
    if (workout && workout.is_strength) return 'strength';
    if (/soccer|football|f[uú]tbol|futsal/.test(s)) return 'football';
    if (/walk|hike|paseo|camin|senderismo/.test(s)) return 'walk';
    if (/ride|bike|cycl|cicl|bici|spin/.test(s)) return 'bike';
    if (/swim|nata|nado/.test(s)) return 'swim';
    if (/run|trail|carrera|treadmill|cinta/.test(s)) return 'run';
    if (/weight|strength|fuerza|gym|gimnas|crossfit|workout|hiit|functional|core/.test(s)) return 'strength';
    return s ? 'other' : null;
  }

  function emptyKind(key) { return { ...KIND_BY_KEY[key], sessions: 0, minutes: 0, km: 0, load: 0, elevation_m: 0, estimated_min: 0, matches: 0, longest_km: 0, longest_min: 0 }; }

  /*
   * weekStart: lunes (YYYY-MM-DD).
   * records: los de RunFlowTraining.records() (actividades de Intervals + sesiones hechas sin reloj).
   * footballLogs: valoraciones de RunFlow Fútbol sin sesión vinculada [{ kind, date, minutes, rpe }].
   * walks: respuesta de walkLoadFor() (paseos estimados por pasos).
   * loadScale: public/js/load-scale.js (para pasar fútbol y sesiones sin reloj a la escala de Intervals).
   */
  function summarizeWeek({ weekStart, records = [], footballLogs = [], walks = null, loadScale = null } = {}) {
    const end = addDays(weekStart, 6);
    const inWeek = date => date && date >= weekStart && date <= end;
    const kinds = new Map();
    const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(weekStart, i), load: 0, minutes: 0, parts: {} }));
    const dayOf = date => days[Math.round((new Date(`${date}T12:00:00Z`) - new Date(`${weekStart}T12:00:00Z`)) / 86400000)];
    const add = (key, date, { minutes = 0, km = 0, load = 0, elevation = 0, session = true, estimated = false, match = false } = {}) => {
      if (!inWeek(date)) return;
      const k = kinds.get(key) || emptyKind(key);
      if (session) k.sessions += 1;
      if (match) k.matches += 1;
      k.minutes += minutes; k.km += km; k.load += load; k.elevation_m += elevation;
      if (estimated) k.estimated_min += minutes;
      k.longest_km = Math.max(k.longest_km, km); k.longest_min = Math.max(k.longest_min, session ? minutes : 0);
      kinds.set(key, k);
      const day = dayOf(date);
      day.load += load; day.minutes += minutes;
      day.parts[key] = (day.parts[key] || 0) + (load || minutes / 10);
    };

    for (const r of records) {
      const date = String(r.date || '').slice(0, 10);
      if (r.type === 'intervals' && r.activity) {
        const a = r.activity, raw = a.raw_summary || {};
        const key = kindOf(a.sport || raw.type, null) || kindOf(r.workout && r.workout.sport, r.workout) || 'other';
        add(key, date, {
          minutes: (num(a.duration_sec) || num(raw.moving_time) || 0) / 60,
          km: key === 'run' || key === 'bike' || key === 'walk' || key === 'swim' ? (num(a.distance_m) || 0) / 1000 : 0,
          load: num(r.load) || 0,
          elevation: key === 'run' || key === 'walk' ? (num(a.elevation_gain_m ?? raw.total_elevation_gain) || 0) : 0,
        });
      } else if (r.type === 'manual') {
        const w = r.workout || {}, log = w.manual_log || {};
        const key = kindOf(w.sport, w) || 'other';
        const minutes = num(log.actual_duration_min) || num(w.planned_duration_min) || 0;
        add(key, date, { minutes, km: key === 'run' ? (num(w.planned_distance_km) || 0) * (log.status === 'partial' ? 0.5 : 1) : 0, load: num(r.load) || 0 });
      }
    }

    for (const log of footballLogs) {
      const minutes = num(log.minutes) || 0;
      const key = log.kind === 'strength' ? 'strength' : 'football';
      const load = loadScale && minutes > 0 && num(log.rpe) > 0 ? loadScale.fromRpe(minutes, num(log.rpe), key === 'strength' ? 'Strength' : 'Soccer') : 0;
      add(key, log.date, { minutes, load: load || 0, match: log.kind === 'match' });
    }

    for (const d of (walks && walks.days) || []) {
      if (!d.walk) continue;
      add('walk', d.date, { minutes: num(d.walk_min) || 0, load: num(d.load) || 0, session: false, estimated: true });
    }

    const list = KINDS.map(k => kinds.get(k.key)).filter(Boolean).filter(k => k.minutes > 0 || k.load > 0 || k.sessions > 0).map(k => ({
      key: k.key, label: k.label, color: k.color,
      sessions: k.sessions, matches: k.matches,
      minutes: Math.round(k.minutes), km: Math.round(k.km * 10) / 10, load: Math.round(k.load), elevation_m: Math.round(k.elevation_m),
      estimated_min: Math.round(k.estimated_min), longest_km: Math.round(k.longest_km * 10) / 10, longest_min: Math.round(k.longest_min),
    }));
    const total = {
      sessions: list.reduce((s, k) => s + k.sessions, 0),
      minutes: list.reduce((s, k) => s + k.minutes, 0),
      load: list.reduce((s, k) => s + k.load, 0),
      run_km: (list.find(k => k.key === 'run') || {}).km || 0,
      active_days: days.filter(d => d.minutes > 0 && Object.keys(d.parts).some(p => p !== 'walk')).length,
    };
    const dayRows = days.map(d => ({ date: d.date, load: Math.round(d.load), minutes: Math.round(d.minutes), parts: Object.fromEntries(Object.entries(d.parts).map(([k, v]) => [k, Math.round(v * 10) / 10])) }));
    return { week_start: weekStart, week_end: end, kinds: list, days: dayRows, total, best: bestOf(list) };
  }

  function bestOf(list) {
    const run = list.find(k => k.key === 'run');
    if (run && run.longest_km >= 3) return { label: 'Lo mejor de la semana', text: `Carrera más larga: ${String(run.longest_km).replace('.', ',')} km` };
    const fb = list.find(k => k.key === 'football');
    if (fb && fb.matches) return { label: 'Lo mejor de la semana', text: fb.matches === 1 ? 'Partido jugado' : `${fb.matches} partidos jugados` };
    const longest = list.filter(k => k.key !== 'walk').sort((a, b) => b.longest_min - a.longest_min)[0];
    if (longest && longest.longest_min >= 20) return { label: 'Lo mejor de la semana', text: `Sesión más larga: ${longest.longest_min} min de ${longest.label.toLowerCase()}` };
    return null;
  }

  return { KINDS, kindOf, summarizeWeek };
});
