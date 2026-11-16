// Forma automática: RunFlow aprende de cada carrera cómo está el atleta.
//
// Cada carrera de al menos 20 min con pulso se convierte en una estimación de VO2máx (método de
// Daniels + reserva de pulso de Swain): el coste de oxígeno de su ritmo (ajustado a pendiente, GAP)
// dividido por el % de reserva de pulso al que lo corrió. Con la mediana de las últimas carreras salen:
//   1. Ritmo a pulso fijo: a qué ritmo corre con el mismo pulso (≈85 % del umbral). Más rápido = mejor forma.
//   2. Umbral estimado: el ritmo al ~88 % del VO2máx (ritmo umbral de Daniels). Si se aleja ≥3 % del
//      que hay en Intervals se propone cambiarlo (el entrenador lo acepta con un botón).
//      El pulso umbral apenas cambia con la forma: solo se propone si el reloj ve un pulso máximo nuevo.
//   3. Estimación de 5K, 10K y media maratón (fórmula de Daniels), si se prepara la distancia y en llano.
// Es una estimación de campo, no una prueba de laboratorio.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunflowFormMetrics = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RULE = {
    minMinutes: 20,
    maxElevationPerKm: 25,     // más desnivel = trail técnico o andando: el pulso no refleja el ritmo
    minHrr: 0.45,              // muy suave (o paradas): poco fiable
    maxHrr: 0.97,
    windowDays: 42,            // forma actual: carreras de las últimas 6 semanas
    fallbackDays: 90,
    minRuns: 3,
    rollingRuns: 5,
    compareDays: 42,           // cambio frente a hace 6 semanas
    thresholdFraction: 0.88,   // ritmo umbral de Daniels ≈ 88 % del VO2máx
    suggestPct: 3,             // proponer cambiar el umbral si se aleja un 3 % o más
    refHrFraction: 0.85,       // pulso de referencia = 85 % del pulso umbral, redondeado a 5
    maxHrMargin: 2,            // pulso máximo nuevo: el 2.º más alto de 180 días supera el actual en 2+
    races: [
      { key: '5k', label: '5K', meters: 5000 },
      { key: '10k', label: '10K', meters: 10000 },
      { key: 'media', label: 'Media maratón', meters: 21097.5 },
    ],
  };

  const RUN = /run|carrera|correr|treadmill/i;
  const NOT_RUN = /walk|hike|caminar|andar|paseo|senderismo|bike|ride|ciclismo|swim/i;

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
  const round = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

  // Daniels: coste de oxígeno (ml/kg/min) a una velocidad en m/min, y su inversa.
  function vo2OfSpeed(v) { return -4.6 + 0.182258 * v + 0.000104 * v * v; }
  function speedOfVo2(vo2) { return (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (vo2 + 4.6))) / (2 * 0.000104); }
  // % del VO2máx que se aguanta durante t minutos.
  function pctForMinutes(t) { return 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t); }
  function vdotFromRace(meters, seconds) { const t = seconds / 60; return vo2OfSpeed(meters / t) / pctForMinutes(t); }
  function raceSeconds(vdot, meters) {
    let lo = 60, hi = 60 * 60 * 8;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (vdotFromRace(meters, mid) > vdot) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  const paceFromSpeed = v => (v > 0 ? 60000 / v : null); // m/min → s/km

  function isRun(activity) {
    const text = `${activity?.sport || ''} ${activity?.raw_summary?.type || ''}`;
    return RUN.test(text) && !NOT_RUN.test(text);
  }

  // Referencias del atleta: las que hay en Intervals (perfil Run) o, si no, las que trae cada actividad.
  function referencesFrom(profile, activities) {
    const latest = [...(activities || [])].sort((a, b) => String(b.activity_date).localeCompare(String(a.activity_date)))
      .find(a => isRun(a) && a.raw_summary && (num(a.raw_summary.lthr) || num(a.raw_summary.athlete_max_hr)));
    const raw = latest?.raw_summary || {};
    const thrMps = num(profile?.threshold_pace_mps) || num(raw.threshold_pace);
    return {
      lthr: num(profile?.lthr) || num(raw.lthr),
      max_hr: num(profile?.max_hr) || num(raw.athlete_max_hr),
      threshold_pace_sec: num(profile?.threshold_pace_sec_per_km) || (thrMps ? 1000 / thrMps : null),
      resting_hr: num(profile?.resting_hr) || num(raw.icu_resting_hr),
    };
  }

  // Una carrera → estimación de VO2máx. null si no sirve (motivo en reason).
  function runEstimate(activity, refs = {}) {
    if (!activity || !isRun(activity)) return null;
    const raw = activity.raw_summary || {};
    const moving = num(raw.moving_time) || num(activity.duration_sec);
    const distance = num(activity.distance_m) || num(raw.distance);
    const hr = num(activity.avg_hr) || num(raw.average_heartrate);
    const date = String(activity.activity_date || '').slice(0, 10);
    const out = { date, id: activity.intervals_activity_id || activity.id || null, name: activity.name || null };
    if (!moving || moving < RULE.minMinutes * 60 || !distance || !hr) return { ...out, ok: false, reason: 'corta o sin pulso' };
    const km = distance / 1000;
    const elevation = num(activity.elevation_gain_m) ?? num(raw.total_elevation_gain) ?? 0;
    if (elevation / km > RULE.maxElevationPerKm) return { ...out, ok: false, reason: 'mucho desnivel' };
    const rest = num(raw.icu_resting_hr) || num(refs.resting_hr);
    const max = num(refs.max_hr) || num(raw.athlete_max_hr);
    if (!rest || !max || max <= rest + 40) return { ...out, ok: false, reason: 'sin pulso en reposo o máximo' };
    const hrr = (hr - rest) / (max - rest);
    if (hrr < RULE.minHrr || hrr > RULE.maxHrr) return { ...out, ok: false, reason: 'pulso fuera de rango' };
    const gap = num(raw.gap);
    const speed = (gap && gap > 1 && gap < 8 ? gap * 60 : distance / (moving / 60)); // m/min
    const vdot = (vo2OfSpeed(speed) - 3.5) / hrr + 3.5;
    if (!Number.isFinite(vdot) || vdot < 15 || vdot > 90) return { ...out, ok: false, reason: 'valor anómalo' };
    return { ...out, ok: true, vdot, hr, hrr, rest, max, speed, pace_sec: paceFromSpeed(speed), km: round(km, 1), minutes: Math.round(moving / 60) };
  }

  // Ritmo (s/km) al que correría con un pulso dado, con un VO2máx dado.
  function paceAtHr(vdot, hr, rest, max) {
    const hrr = (hr - rest) / (max - rest);
    if (!(hrr > 0)) return null;
    return paceFromSpeed(speedOfVo2((vdot - 3.5) * hrr + 3.5));
  }
  function thresholdPaceFor(vdot) { return paceFromSpeed(speedOfVo2(vdot * RULE.thresholdFraction)); }

  function secondMax(values) {
    const list = values.filter(v => Number.isFinite(v)).sort((a, b) => b - a);
    return list.length >= 2 ? list[1] : null;
  }

  // activities: actividades guardadas (con raw_summary de Intervals). profile: perfil Run de Intervals (opcional).
  function computeForm({ activities = [], profile = null, today } = {}) {
    const day = today || new Date().toISOString().slice(0, 10);
    const refs = referencesFrom(profile, activities);
    const sorted = [...activities].filter(a => String(a.activity_date || '').slice(0, 10) <= day)
      .sort((a, b) => String(a.activity_date).localeCompare(String(b.activity_date)));
    const estimates = sorted.map(a => runEstimate(a, refs)).filter(Boolean);
    const valid = estimates.filter(e => e.ok);

    // Serie: media móvil (mediana de las últimas 5) para ver la tendencia sin ruido.
    const series = valid.map((e, i) => ({
      date: e.date, vdot: round(e.vdot, 1),
      trend: round(median(valid.slice(Math.max(0, i - RULE.rollingRuns + 1), i + 1).map(x => x.vdot)), 1),
    }));

    let windowDays = RULE.windowDays;
    let recent = valid.filter(e => e.date > addDays(day, -windowDays));
    if (recent.length < RULE.minRuns) { windowDays = RULE.fallbackDays; recent = valid.filter(e => e.date > addDays(day, -windowDays)); }
    const vdot = recent.length >= RULE.minRuns ? median(recent.slice(-8).map(e => e.vdot)) : null;
    const compareDate = addDays(day, -RULE.compareDays);
    const before = valid.filter(e => e.date <= compareDate && e.date > addDays(compareDate, -RULE.windowDays));
    const vdotBefore = before.length >= RULE.minRuns ? median(before.slice(-8).map(e => e.vdot)) : null;

    const last = recent.at(-1) || valid.at(-1) || null;
    const rest = median(recent.slice(-8).map(e => e.rest)) || num(refs.resting_hr) || (last && last.rest) || null;
    const maxInUse = num(refs.max_hr);
    const confidence = !vdot ? 'Sin datos' : recent.length >= 6 && windowDays === RULE.windowDays ? 'Alta' : recent.length >= 4 ? 'Media' : 'Baja';

    // Pulso máximo: solo cambia si el reloj ve uno nuevo (dos veces) en los últimos 180 días.
    const seenMax = secondMax(sorted.filter(a => String(a.activity_date).slice(0, 10) > addDays(day, -180)).map(a => num(a.max_hr)).filter(v => v && v < 230));
    const newMax = maxInUse && seenMax && seenMax >= maxInUse + RULE.maxHrMargin ? seenMax : null;
    const maxHr = newMax || maxInUse;
    const lthrInUse = num(refs.lthr);
    const lthrSuggested = newMax && lthrInUse ? Math.round(lthrInUse * newMax / maxInUse) : null;
    const lthr = lthrSuggested || lthrInUse;

    // 1. Ritmo a pulso fijo
    const refHr = lthr ? Math.round((lthr * RULE.refHrFraction) / 5) * 5 : (maxHr ? Math.round((maxHr * 0.75) / 5) * 5 : null);
    const canPace = vdot && refHr && rest && maxHr;
    const easyNow = canPace ? paceAtHr(vdot, refHr, rest, maxHr) : null;
    const easyBefore = canPace && vdotBefore ? paceAtHr(vdotBefore, refHr, rest, maxHr) : null;
    const easySeries = canPace ? series.map(p => ({ date: p.date, pace_sec: round(paceAtHr(p.trend, refHr, rest, maxHr), 0), run_pace_sec: round(paceAtHr(p.vdot, refHr, rest, maxHr), 0) })) : [];
    const easyChange = easyNow && easyBefore ? easyBefore - easyNow : null; // + = más rápido = mejor
    const trend = easyChange === null ? 'sin_datos' : easyChange >= 5 ? 'mejora' : easyChange <= -5 ? 'empeora' : 'estable';

    // 2. Umbral
    const thrEst = vdot ? thresholdPaceFor(vdot) : null;
    const thrInUse = num(refs.threshold_pace_sec);
    const diffPct = thrEst && thrInUse ? ((thrInUse - thrEst) / thrInUse) * 100 : null; // + = estimado más rápido
    const paceSuggest = thrEst && recent.length >= RULE.minRuns && (thrInUse === null || Math.abs(diffPct) >= RULE.suggestPct);
    const suggest = Boolean(paceSuggest || lthrSuggested);

    // 3. Carreras
    const races = vdot ? RULE.races.map(r => {
      const sec = raceSeconds(vdot, r.meters);
      return { key: r.key, label: r.label, km: round(r.meters / 1000, 1), seconds: Math.round(sec), pace_sec: Math.round(sec / (r.meters / 1000)) };
    }) : [];

    return {
      version: 1,
      today: day,
      has_data: Boolean(vdot),
      confidence,
      runs_used: recent.length,
      window_days: windowDays,
      vo2max: round(vdot, 1),
      vo2max_before: round(vdotBefore, 1),
      easy_pace: {
        ref_hr: refHr,
        pace_sec: round(easyNow, 0),
        before_pace_sec: round(easyBefore, 0),
        change_sec: round(easyChange, 0),
        trend,
        series: easySeries,
      },
      threshold: {
        in_use: { pace_sec: round(thrInUse, 0), lthr: lthrInUse, max_hr: maxInUse },
        estimate: { pace_sec: round(thrEst, 0), lthr, max_hr: maxHr },
        diff_pct: round(diffPct, 1),
        suggest,
        changes: {
          pace: Boolean(paceSuggest),
          lthr: Boolean(lthrSuggested),
          max_hr: Boolean(newMax),
        },
      },
      races,
      resting_hr: round(rest, 0),
      runs: estimates.slice(-30).map(e => (e.ok
        ? { date: e.date, id: e.id, name: e.name, ok: true, vdot: round(e.vdot, 1), hr: e.hr, pace_sec: round(e.pace_sec, 0), km: e.km, minutes: e.minutes }
        : { date: e.date, id: e.id, name: e.name, ok: false, reason: e.reason })),
      rule: RULE,
    };
  }

  // Zonas de pulso nuevas: mismas proporciones que las actuales respecto al umbral, y la última = pulso máximo.
  function scaleHrZones(limits, oldLthr, newLthr, newMax) {
    const list = (limits || []).map(num).filter(v => v && v > 0);
    if (!list.length || !oldLthr || !newLthr) return null;
    const scaled = list.map(v => Math.round(v * newLthr / oldLthr));
    if (newMax) scaled[scaled.length - 1] = Math.round(newMax);
    for (let i = 1; i < scaled.length; i += 1) if (scaled[i] <= scaled[i - 1]) scaled[i] = scaled[i - 1] + 1;
    return scaled;
  }

  function fmtPace(sec) {
    if (!Number.isFinite(sec)) return '—';
    const s = Math.round(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function fmtTime(sec) {
    if (!Number.isFinite(sec)) return '—';
    const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  }

  return { RULE, computeForm, runEstimate, referencesFrom, vo2OfSpeed, speedOfVo2, vdotFromRace, raceSeconds, thresholdPaceFor, paceAtHr, scaleHrZones, fmtPace, fmtTime, isRun };
}));
