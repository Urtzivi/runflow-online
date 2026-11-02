/* RunFlow · Efecto del entrenamiento de una actividad.
 * Funciones puras, sin DOM. Se usa en la web del Coach (window.RunflowTrainingEffect)
 * y se puede requerir desde Node para pruebas.
 *
 * Cómo se calcula
 * 1. Referencias del atleta: umbral de pulso (LTHR) y ritmo umbral que Intervals asocia a la
 *    actividad (`lthr`, `threshold_pace` en m/s). Si faltan, las zonas de FC del atleta.
 * 2. Segundo a segundo (streams de Intervals) se decide en qué "dominio" está el atleta:
 *    recuperación, aeróbico, tempo, umbral, VO2máx o velocidad. Se mira el pulso (% del LTHR)
 *    y, en carrera y terreno llano, el ritmo (% de la velocidad umbral), porque el pulso tarda
 *    1–2 min en subir y en series cortas se queda corto. Se toma el más alto de los dos.
 * 3. Sin streams, se usa el tiempo en zonas que calcula Intervals (`icu_hr_zone_times`,
 *    `pace_zone_times`).
 * 4. Con los minutos en cada dominio se puntúa cada estímulo (sin efecto, mantiene, mejora,
 *    mejora mucho) con umbrales de tiempo habituales en la literatura de entrenamiento
 *    (p. ej. ≥ 6–8 min acumulados cerca del VO2máx para que haya estímulo de VO2máx). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunflowTrainingEffect = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; };
  const fmtPace = sec => { const v = num(sec); if (!v || v <= 0) return '—'; const r = Math.round(v); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };

  // Dominios de intensidad, de menos a más.
  const DOMAINS = ['rec', 'aer', 'tempo', 'thr', 'vo2', 'speed'];
  const DOMAIN_LABEL = { rec: 'Recuperación', aer: 'Aeróbico', tempo: 'Tempo', thr: 'Umbral', vo2: 'VO₂máx', speed: 'Velocidad' };

  // Cortes en % del LTHR (zonas de pulso de Friel que usa Intervals para carrera).
  const HR_CUTS = [0.80, 0.90, 0.95, 1.02]; // <80 rec · 80–90 aer · 90–95 tempo · 95–102 umbral · ≥102 VO2
  // Cortes en % de la velocidad umbral (zonas de ritmo de Intervals).
  const SPEED_CUTS = [0.78, 0.88, 0.95, 1.03, 1.15]; // … · 103–115 VO2 · ≥115 velocidad

  // Estímulos y minutos necesarios para: mantiene, mejora, mejora mucho.
  const STIMULI = {
    speed: { label: 'Velocidad', what: 'potencia anaeróbica y economía a ritmos muy altos', steps: [0.75, 2, 4] },
    vo2: { label: 'VO₂máx', what: 'el techo aeróbico (potencia aeróbica máxima)', steps: [3, 6, 12] },
    thr: { label: 'Umbral', what: 'el umbral (el ritmo más rápido que se aguanta sin acumular fatiga)', steps: [8, 15, 30] },
    tempo: { label: 'Tempo / ritmo de carrera', what: 'el ritmo sostenido de media maratón o maratón', steps: [15, 25, 45] },
    aer: { label: 'Base aeróbica', what: 'la base aeróbica y la resistencia', steps: [25, 45, 90] },
  };
  const LEVEL = ['Sin efecto', 'Mantiene', 'Mejora', 'Mejora mucho'];

  function streamOf(streams, type) {
    const row = (Array.isArray(streams) ? streams : []).find(s => String(s && s.type || '').toLowerCase() === type);
    return Array.isArray(row && row.data) ? row.data : [];
  }

  function isRun(activity) {
    const raw = (activity && activity.raw_summary) || {};
    return /run|trail|carrera/i.test(String((activity && activity.sport) || raw.type || ''));
  }

  function domainByCuts(ratio, cuts) {
    if (ratio === null) return -1;
    let d = 0; while (d < cuts.length && ratio >= cuts[d]) d += 1; return d;
  }

  // Domínio de una zona según cuántas zonas tiene el atleta (Intervals usa 5, 6 o 7).
  function zoneIndexToDomain(index, count) {
    const maps = {
      5: [0, 1, 2, 3, 4],
      6: [0, 1, 2, 3, 4, 5],
      7: [0, 1, 2, 3, 3, 4, 5], // Z4 subumbral y Z5 supraumbral cuentan como umbral
    };
    const map = maps[count] || maps[Math.min(7, Math.max(5, count))] || maps[5];
    return map[Math.min(map.length - 1, Math.max(0, index))];
  }

  function references(activity, athleteZones) {
    const raw = (activity && activity.raw_summary) || {};
    let lthr = num(raw.lthr) || num(raw.icu_lthr);
    const thrSpeed = (() => { const v = num(raw.threshold_pace); return v && v > 1.5 && v < 7 ? v : null; })();
    const hrZones = Array.isArray(athleteZones && athleteZones.hr) ? athleteZones.hr : [];
    const hrUpper = hrZones.map(z => num(z.max_value)).filter(v => v && v < 250);
    const activityHrUpper = Array.isArray(raw.icu_hr_zones) ? raw.icu_hr_zones.map(num).filter(Boolean) : [];
    return { lthr, thrSpeed, hrUpper: activityHrUpper.length ? activityHrUpper : hrUpper };
  }

  function hrDomain(hr, ref) {
    if (!hr || hr < 60) return -1;
    if (ref.lthr) return domainByCuts(hr / ref.lthr, HR_CUTS);
    if (ref.hrUpper.length >= 5) {
      let i = 0; while (i < ref.hrUpper.length - 1 && hr > ref.hrUpper[i]) i += 1;
      return Math.min(4, zoneIndexToDomain(i, ref.hrUpper.length)); // el pulso solo no distingue la velocidad
    }
    return -1;
  }

  // Minutos en cada dominio a partir de los streams.
  function fromStreams(activity, ref) {
    const time = streamOf(activity.streams, 'time');
    if (time.length < 60) return null;
    const hr = streamOf(activity.streams, 'heartrate');
    let speed = streamOf(activity.streams, 'velocity_smooth');
    const dist = streamOf(activity.streams, 'distance');
    if (!speed.length && dist.length) speed = dist.map((d, i) => i ? (d - dist[i - 1]) / Math.max(1, time[i] - time[i - 1]) : 0);
    const grade = streamOf(activity.streams, 'grade_smooth');
    const usePace = isRun(activity) && ref.thrSpeed && speed.length;
    const usableHr = hr.some(v => num(v) > 60) && (ref.lthr || ref.hrUpper.length >= 5);
    if (!usePace && !usableHr) return null;
    // Velocidad media de 15 s para quitar picos del GPS (y para saber cuándo está parado).
    const smooth = [];
    if (speed.length) {
      let sum = 0, q = [];
      for (let i = 0; i < speed.length; i += 1) { const v = Math.max(0, num(speed[i]) || 0); q.push(v); sum += v; if (q.length > 15) sum -= q.shift(); smooth.push(sum / q.length); }
    }
    const sec = [0, 0, 0, 0, 0, 0];
    let counted = 0, byPace = 0, byHr = 0, stopped = 0;
    for (let i = 1; i < time.length; i += 1) {
      const dt = Math.min(10, Math.max(0, (num(time[i]) || 0) - (num(time[i - 1]) || 0)));
      if (!dt) continue;
      // Parado (semáforo, descanso, reloj sin pausar): no cuenta como entrenamiento.
      if (smooth.length && (num(speed[i]) || 0) < 0.5 && (smooth[i] || 0) < 0.8) { stopped += dt; continue; }
      const h = usableHr ? hrDomain(num(hr[i]), ref) : -1;
      let p = -1;
      if (usePace) {
        const g = num(grade[i]);
        const flat = g === null || Math.abs(g) < 3;
        if (flat && smooth[i] > 1) p = domainByCuts(smooth[i] / ref.thrSpeed, SPEED_CUTS);
      }
      const d = Math.max(h, p);
      if (d < 0) continue;
      if (p > h) byPace += dt; else byHr += dt;
      sec[d] += dt; counted += dt;
    }
    if (counted < 120) return null;
    return { sec, counted, method: 'streams', byPace, byHr, stopped };
  }

  // Minutos en cada dominio a partir del tiempo en zonas de Intervals.
  function fromZoneTimes(activity) {
    const raw = (activity && activity.raw_summary) || {};
    const pick = list => Array.isArray(list) && list.some(v => num(v) > 0) ? list.map(v => Math.max(0, num(v) || 0)) : null;
    const hrZ = pick(raw.icu_hr_zone_times);
    const paceZ = isRun(activity) ? (pick(raw.gap_zone_times) || pick(raw.pace_zone_times)) : null;
    if (!hrZ && !paceZ) return null;
    const toDomains = list => { const out = [0, 0, 0, 0, 0, 0]; if (!list) return out; list.forEach((v, i) => { out[zoneIndexToDomain(i, list.length)] += v; }); return out; };
    const h = toDomains(hrZ), p = toDomains(paceZ);
    // Lo fácil por pulso; lo intenso, el máximo de pulso y ritmo (el pulso se queda corto en series).
    const sec = hrZ && paceZ ? [h[0], h[1], Math.max(h[2], p[2]), Math.max(h[3], p[3]), Math.max(h[4], p[4]), Math.max(h[5], p[5])] : (hrZ ? h : p);
    // Al mezclar pulso y ritmo no se puede pasar del tiempo total que registró Intervals.
    const base = (hrZ || paceZ).reduce((a, v) => a + v, 0);
    return { sec, counted: sec.reduce((a, v) => a + v, 0), base, method: hrZ && paceZ ? 'zones' : hrZ ? 'hr-zones' : 'pace-zones' };
  }

  // Nunca más minutos que el tiempo en movimiento (o el total) de la actividad.
  function capToActivity(data, activity) {
    const raw = (activity && activity.raw_summary) || {};
    const moving = num(raw.moving_time) || num(raw.icu_recording_time) || num(activity && activity.duration_sec) || num(raw.elapsed_time);
    const limit = Math.min(...[moving, data.base].filter(v => v && v > 0));
    if (!Number.isFinite(limit) || data.counted <= limit) return data;
    const k = limit / data.counted;
    return { ...data, sec: data.sec.map(v => v * k), counted: limit, capped: true };
  }

  // Reparto del tiempo total de la actividad: entrenamiento + parado + sin datos útiles = total.
  function timeline(activity, data) {
    const raw = (activity && activity.raw_summary) || {};
    const elapsed = num(raw.elapsed_time) || num(activity && activity.duration_sec);
    if (!elapsed) return null;
    const moving = Math.min(elapsed, num(raw.moving_time) || elapsed);
    const counted = Math.min(data.counted, moving);
    return { elapsed: elapsed / 60, stopped: (elapsed - moving) / 60, noData: Math.max(0, moving - counted) / 60 };
  }

  const lc = text => String(text).replace(/^[A-ZÁÉÍÓÚ](?![A-Z₂])/, c => c.toLowerCase()).replace(/ \/ R/, ' / r');

  function levelFor(minutes, steps) { let l = 0; while (l < steps.length && minutes >= steps[l]) l += 1; return l; }

  // Qué efecto se esperaba según el tipo de sesión planificada (claves de RunflowInsights).
  const EXPECTED = { vo2: 'vo2', threshold: 'thr', tempo: 'tempo', progressive: 'tempo', fartlek: 'thr', hills: 'vo2', speed: 'speed', easy: 'aer', long: 'aer', recovery: 'rec', bike: 'aer', walk: 'rec' };

  function analyse({ activity, athleteZones, plannedKey } = {}) {
    if (!activity) return null;
    const ref = references(activity, athleteZones);
    const rawData = fromStreams(activity, ref) || fromZoneTimes(activity);
    const data = rawData ? capToActivity(rawData, activity) : null;
    if (!data) {
      return { available: false, reason: ref.lthr || ref.thrSpeed ? 'La actividad no tiene pulso, ritmo ni tiempo en zonas.' : 'Faltan el umbral de pulso o de ritmo del atleta en Intervals.', refs: ref };
    }
    const min = {}; DOMAINS.forEach((d, i) => { min[d] = data.sec[i] / 60; });
    const total = data.counted / 60;
    const stimMinutes = {
      speed: min.speed,
      vo2: min.vo2,
      thr: min.thr,
      tempo: min.tempo,
      aer: total - min.rec,
    };
    const stimuli = Object.keys(STIMULI).map(key => ({ key, label: STIMULI[key].label, what: STIMULI[key].what, minutes: stimMinutes[key], level: levelFor(stimMinutes[key], STIMULI[key].steps), levelLabel: LEVEL[levelFor(stimMinutes[key], STIMULI[key].steps)] }));
    const byKey = Object.fromEntries(stimuli.map(s => [s.key, s]));

    // Efecto principal: el estímulo más intenso que llega a "mejora".
    let primary = ['vo2', 'thr', 'tempo'].find(k => byKey[k].level >= 2) || (byKey.speed.level >= 2 && byKey.aer.level < 3 ? 'speed' : null);
    if (!primary && byKey.aer.level >= 2) primary = 'aer';
    let headline, kind;
    if (primary) {
      const s = byKey[primary];
      kind = primary;
      headline = primary === 'aer' && byKey.aer.level >= 3 ? 'Resistencia aeróbica' : s.label;
    } else if (total < 50 && min.rec / Math.max(1, total) >= 0.6) {
      kind = 'rec'; headline = 'Recuperación activa';
    } else if (stimuli.some(s => s.level >= 1)) {
      const s = ['vo2', 'thr', 'tempo', 'speed', 'aer'].map(k => byKey[k]).find(x => x.level >= 1);
      kind = 'maintain'; headline = `Mantenimiento (${lc(s.label)})`;
    } else {
      kind = 'none'; headline = 'Sin efecto de entrenamiento relevante';
    }

    const secondary = stimuli.filter(s => s.key !== primary && s.level >= 1 && !(s.key === 'aer' && primary && primary !== 'aer'));
    const fmtMin = m => m >= 10 ? `${Math.round(m)} min` : `${String(Math.round(m * 10) / 10).replace('.', ',')} min`;
    const lines = [];
    if (kind === 'vo2') lines.push(`${fmtMin(byKey.vo2.minutes)} cerca del VO₂máx: suficiente para estimular ${STIMULI.vo2.what}.`);
    else if (kind === 'thr') lines.push(`${fmtMin(byKey.thr.minutes)} en la zona de umbral: trabaja ${STIMULI.thr.what}.`);
    else if (kind === 'tempo') lines.push(`${fmtMin(byKey.tempo.minutes)} a ritmo tempo: trabaja ${STIMULI.tempo.what}.`);
    else if (kind === 'speed') lines.push(`${fmtMin(byKey.speed.minutes)} a ritmos de velocidad: trabaja ${STIMULI.speed.what}.`);
    else if (kind === 'aer') lines.push(`${fmtMin(byKey.aer.minutes)} de trabajo aeróbico sin apenas intensidad: ${byKey.aer.level >= 3 ? 'desarrolla la resistencia' : 'suma base aeróbica'}.`);
    else if (kind === 'rec') lines.push('Sesión muy suave y corta: ayuda a recuperar, no busca mejorar nada.');
    else if (kind === 'maintain') lines.push('Algo de estímulo, pero poco tiempo para provocar una mejora clara. Sirve para mantener.');
    else lines.push(`${fmtMin(total)} de entrenamiento y casi todo muy suave: no hay estímulo suficiente para mejorar nada.`);
    const hardShare = (min.tempo + min.thr) / Math.max(1, total);

    let plan = null;
    const expected = plannedKey ? EXPECTED[plannedKey] : null;
    if (expected) {
      const reached = expected === 'rec' ? (kind === 'rec' || (kind === 'aer' && hardShare < 0.1) || kind === 'maintain' && byKey.aer.level >= 1 && hardShare < 0.1) : expected === kind || (expected === 'thr' && kind === 'vo2') || (expected === 'vo2' && kind === 'speed');
      const label = expected === 'rec' ? 'Recuperación' : STIMULI[expected].label;
      if (reached) plan = { ok: true, text: `Coincide con lo previsto (${lc(label)}).` };
      else if (['aer', 'rec'].includes(expected) && ['tempo', 'thr', 'vo2', 'speed'].includes(kind)) plan = { ok: false, text: `Se planificó ${lc(label)} y salió una sesión de ${lc(headline)}: más intensa de lo previsto.` };
      else if (['aer', 'rec'].includes(expected) && hardShare >= 0.2) plan = { ok: false, text: `Se planificó suave pero el ${Math.round(hardShare * 100)} % del tiempo fue a tempo o umbral (zona gris).` };
      else plan = { ok: false, text: `Se planificó ${lc(label)} pero el efecto principal fue ${lc(headline)}${byKey[expected] && byKey[expected].minutes > 0.5 ? ` (solo ${fmtMin(byKey[expected].minutes)} en ${lc(label)})` : ''}.` };
    }

    const methodText = {
      streams: `Calculado segundo a segundo con los datos de Intervals${ref.lthr ? `, umbral de pulso ${Math.round(ref.lthr)} ppm` : ''}${ref.thrSpeed && isRun(activity) ? `${ref.lthr ? ' y' : ','} ritmo umbral ${fmtPace(1000 / ref.thrSpeed)}/km` : ''}.`,
      zones: 'Estimado con el tiempo en zonas de pulso y de ritmo que calcula Intervals.',
      'hr-zones': 'Estimado con el tiempo en zonas de pulso que calcula Intervals.',
      'pace-zones': 'Estimado con el tiempo en zonas de ritmo que calcula Intervals.',
    }[data.method] + ' El tiempo parado no cuenta como entrenamiento.';

    return {
      available: true, kind, headline, primary, lines, secondary, stimuli, plan,
      minutes: min, total, method: data.method, methodText, refs: ref, timeline: timeline(activity, data),
      cuts: {
        hr: ref.lthr ? HR_CUTS.map(c => Math.round(c * ref.lthr)) : null,
        pace: ref.thrSpeed ? SPEED_CUTS.map(c => fmtPace(1000 / (c * ref.thrSpeed))) : null,
      },
    };
  }

  return { analyse, DOMAINS, DOMAIN_LABEL, STIMULI, LEVEL, zoneIndexToDomain };
});
