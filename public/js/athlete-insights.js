/* RunFlow · Lecturas para el atleta (app nueva cara).
 * Funciones puras, sin DOM: tipo de sesión y para qué sirve, ritmos y pulso de cada bloque
 * a partir de las zonas del atleta, el dibujo de la sesión, la lectura de una actividad
 * en frases y el resumen semanal de la evolución. Se usa en la app (window.RunflowInsights)
 * y en el servidor (require) para /api/athlete/evolution. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunflowInsights = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; };
  const norm = value => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const fmtPace = sec => { const v = num(sec); if (!v || v <= 0) return '—'; const r = Math.round(v); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };
  const paceToSec = text => { const m = String(text || '').match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

  // ---------- Tipo de sesión ----------
  const SESSION_INFO = {
    rest: { label: 'Descanso', effort: 'Ninguno', rpe: null, purpose: 'Descansar también es entrenar: el cuerpo asimila el trabajo de los días anteriores y vuelve más fuerte.', improves: 'Recuperación', recover: '—', feel: 'Día libre. Si te apetece moverte, paseo o movilidad suave.', tips: ['Duerme bien y come suficiente.', 'Un poco de movilidad ayuda, sin forzar.'] },
    recovery: { label: 'Recuperación', effort: 'Muy suave', rpe: [2, 3], purpose: 'Mueve las piernas y activa la circulación sin añadir cansancio. Ayuda a asimilar la sesión dura de ayer y a llegar fresco a la próxima.', improves: 'Recuperación activa', recover: '12 h', feel: 'Tan suave que podrías charlar sin esfuerzo. Si dudas, más despacio.', tips: ['Sin mirar el ritmo: manda la respiración.', 'Terreno llano y cómodo.', 'Si notas molestias, camina o para.'] },
    easy: { label: 'Rodaje suave', effort: 'Suave', rpe: [3, 4], purpose: 'Construye tu base aeróbica: más capilares, más mitocondrias y un corazón más eficiente. Es lo que te deja correr más tiempo con menos esfuerzo.', improves: 'Base aeróbica', recover: '24 h', feel: 'Cómodo, puedes hablar con frases completas. Al terminar, podrías seguir.', tips: ['El rodaje suave tiene que ser suave de verdad.', 'Si el pulso sube por calor o cuestas, baja el ritmo.', 'Cadencia ágil, pasos cortos.'] },
    long: { label: 'Tirada larga', effort: 'Suave y largo', rpe: [4, 5], purpose: 'Entrena la resistencia: aguantar muchas horas, gastar mejor la energía y que piernas y tendones toleren el tiempo de carrera.', improves: 'Resistencia', recover: '36–48 h', feel: 'Controlado todo el rato. La última media hora debería costar algo, no ser una lucha.', tips: ['Lleva agua y, si pasa de 75 min, algo de comer.', 'Sal más lento de lo que te pide el cuerpo.', 'En subida, camina si el pulso se dispara.'] },
    progressive: { label: 'Progresivo', effort: 'De suave a vivo', rpe: [4, 7], purpose: 'Enseña a acelerar con las piernas cansadas, como en el final de una carrera, sin el coste de unas series.', improves: 'Ritmo y control', recover: '24–36 h', feel: 'Empiezas cómodo y terminas a ritmo vivo, pero controlado.', tips: ['Cada tramo un poco más rápido que el anterior.', 'El último tramo nunca a tope.'] },
    tempo: { label: 'Ritmo medio', effort: 'Moderado', rpe: [5, 6], purpose: 'Acostumbra al cuerpo a ritmos de carrera larga (media maratón, maratón o trail) y mejora la economía.', improves: 'Ritmo de carrera', recover: '36 h', feel: 'Exigente pero sostenible. Puedes decir frases cortas.', tips: ['Ritmo constante, sin acelerones.', 'Si te cuesta hablar, vas demasiado rápido.'] },
    threshold: { label: 'Umbral', effort: 'Alto controlado', rpe: [6, 7], purpose: 'Sube tu umbral: el ritmo más rápido que aguantas sin acumular fatiga. Es lo que más mejora tus marcas de 10 km a media maratón.', improves: 'Umbral', recover: '48 h', feel: 'Duro pero controlado. Solo podrías decir 3 o 4 palabras seguidas.', tips: ['No empieces más rápido de lo indicado.', 'Todos los bloques al mismo ritmo.', 'Si no puedes mantenerlo, acorta el último bloque.'] },
    vo2: { label: 'Series de VO₂máx', effort: 'Alto', rpe: [7, 8], purpose: 'Sube tu techo aeróbico (VO₂máx): el motor que te deja correr más rápido sin ahogarte. En 3 o 4 semanas se nota en las subidas y en el ritmo de 5 y 10 km.', improves: 'Potencia aeróbica', recover: '48 h', feel: 'Duro: respiración intensa, solo palabras sueltas. La última serie igual de rápida que la primera.', tips: ['Sal en la primera serie algo más lento de lo que te pide el cuerpo.', 'En la recuperación, trota, no camines.', 'Si en una serie no llegas al ritmo, para ahí.'] },
    speed: { label: 'Velocidad', effort: 'Rápido y corto', rpe: [7, 8], purpose: 'Mejora la economía y la técnica a ritmos altos: correr rápido gastando menos.', improves: 'Economía y técnica', recover: '36–48 h', feel: 'Rápido y suelto, sin llegar a sprint. Técnica limpia.', tips: ['Recupera bien entre repeticiones.', 'Brazos activos y pisada ágil.'] },
    hills: { label: 'Cuestas', effort: 'Fuerte controlado', rpe: [7, 8], purpose: 'Fuerza específica de carrera: más potencia en cada zancada y mejor técnica. Se nota en las subidas y en la velocidad.', improves: 'Fuerza y potencia', recover: '48 h', feel: 'Potente en subida, bajada muy suave para recuperar.', tips: ['Cuerpo un poco inclinado hacia delante.', 'Pasos cortos y rápidos.', 'Baja trotando, sin frenar.'] },
    fartlek: { label: 'Cambios de ritmo', effort: 'Variable', rpe: [5, 7], purpose: 'Juega con el ritmo para mejorar la capacidad de cambiar de marcha y recuperar en movimiento.', improves: 'Ritmo y recuperación', recover: '36 h', feel: 'Tramos alegres y tramos suaves. Divertido, no agónico.', tips: ['Los tramos suaves sirven para recuperar: aprovéchalos.'] },
    strength: { label: 'Fuerza', effort: 'Moderado', rpe: [5, 7], purpose: 'Hace piernas y tendones más fuertes: menos lesiones y una zancada más potente y económica.', improves: 'Fuerza y prevención', recover: '48 h', feel: 'Las últimas repeticiones cuestan, pero con buena técnica.', tips: ['La técnica antes que el peso.', 'Descansa lo indicado entre series.'] },
    bike: { label: 'Bici', effort: 'Suave', rpe: [3, 4], purpose: 'Suma trabajo aeróbico sin el impacto de correr. Ideal para descargar las piernas.', improves: 'Base aeróbica', recover: '12–24 h', feel: 'Cómodo, sin piernas cargadas al terminar.', tips: ['Cadencia alta, desarrollo suave.'] },
    walk: { label: 'Paseo', effort: 'Muy suave', rpe: [1, 2], purpose: 'Movimiento suave que ayuda a recuperar y suma actividad sin cansar.', improves: 'Recuperación', recover: '—', feel: 'Relajado.', tips: ['Mejor por terreno variado si puedes.'] },
    other: { label: 'Sesión', effort: 'Según indicaciones', rpe: null, purpose: 'Sesión preparada por tu entrenador para esta semana.', improves: 'Forma general', recover: '24 h', feel: 'Sigue las indicaciones de tu entrenador.', tips: [] },
  };

  function workoutText(workout) {
    const blocks = Array.isArray(workout && workout.blocks) ? workout.blocks : [];
    return norm([workout && workout.title, workout && workout.summary, workout && workout.adaptation_target, workout && workout.session_objective, ...blocks.map(b => `${b.name || ''} ${b.target || ''}`)].join(' '));
  }

  function classifySession(workout) {
    if (!workout) return 'rest';
    const sport = norm(workout.sport);
    const text = workoutText(workout);
    if (sport.includes('strength') || sport.includes('weight') || /\bfuerza\b|gimnasio|gym/.test(norm(workout.title))) return 'strength';
    if (sport.includes('ride') || sport.includes('bike') || /\bbici\b|ciclismo/.test(text)) return 'bike';
    if (sport.includes('walk') || /\bpaseo\b|caminar/.test(norm(workout.title))) return 'walk';
    if (sport.includes('rest') || /^descanso/.test(norm(workout.title))) return 'rest';
    if (/cuesta|hill/.test(text)) return 'hills';
    if (/vo2|vo₂|ritmo 5 ?k|\bz5\b|series cortas/.test(text)) return 'vo2';
    if (/umbral|threshold|lt2|\bz4\b/.test(text)) return 'threshold';
    if (/fartlek|cambios/.test(text)) return 'fartlek';
    if (/progresiv/.test(text)) return 'progressive';
    if (/rapid|velocidad|strides|rectas|economia/.test(text)) return 'speed';
    if (/tempo|ritmo medio|ritmo maraton|ritmo media|\bz3\b/.test(text)) return 'tempo';
    if (/recupera|regenera|muy suave|soltar/.test(text)) return 'recovery';
    if (/tirada|larga|largo|long/.test(text)) return 'long';
    if (/rodaje|aerobic|suave|\bz2\b|\bz1\b|base/.test(text)) return 'easy';
    const minutes = num(workout.planned_duration_min) || 0;
    if (minutes >= 80) return 'long';
    return 'other';
  }

  const HARD = new Set(['threshold', 'vo2', 'speed', 'hills', 'tempo', 'fartlek', 'progressive']);
  const isHard = key => HARD.has(key);
  const isQualityOrLong = key => HARD.has(key) || key === 'long';

  // ---------- Zonas ----------
  function zoneRange(target) {
    const t = norm(target);
    if (!t) return null;
    const pace = String(target || '').match(/(\d{1,2}:\d{2})\s*[-–a]\s*(\d{1,2}:\d{2})/);
    if (pace) { const a = paceToSec(pace[1]), b = paceToSec(pace[2]); return { pace: [Math.max(a, b), Math.min(a, b)], zones: null }; }
    const zones = [...t.matchAll(/z\s?([1-7])/g)].map(m => Number(m[1]));
    if (zones.length) return { zones: [Math.min(...zones), Math.max(...zones)] };
    if (/vo2|vo₂|5 ?k/.test(t)) return { zones: [5, 5] };
    if (/umbral|threshold/.test(t)) return { zones: [4, 4] };
    if (/tempo|ritmo medio|maraton/.test(t)) return { zones: [3, 3] };
    if (/fuerte|rapid/.test(t)) return { zones: [4, 5] };
    if (/trote|suave|bajada|recupera/.test(t)) return { zones: [1, 1] };
    if (/aerobic/.test(t)) return { zones: [2, 2] };
    return null;
  }

  function zoneRow(list, index) {
    const rows = Array.isArray(list) ? list : [];
    const byOrder = rows.find(z => Number(z.zone_order) === index);
    return byOrder || rows[index - 1] || null;
  }

  function rangeTexts(range, athleteZones) {
    if (!range) return { pace: '', hr: '' };
    if (range.pace) return { pace: `${fmtPace(range.pace[0])}–${fmtPace(range.pace[1])}`, hr: '' };
    const [lo, hi] = range.zones;
    const zp = athleteZones && athleteZones.pace, zh = athleteZones && athleteZones.hr;
    const pLo = zoneRow(zp, lo), pHi = zoneRow(zp, hi), hLo = zoneRow(zh, lo), hHi = zoneRow(zh, hi);
    const pace = pLo && pHi && (pLo.slow_pace || pHi.fast_pace) ? `${pLo.slow_pace || '—'}–${pHi.fast_pace || '—'}` : '';
    const hr = hLo && hHi && (num(hLo.min_value) !== null || num(hHi.max_value) !== null) ? `${num(hLo.min_value) ?? '—'}–${num(hHi.max_value) ?? '—'}` : '';
    return { pace, hr };
  }

  // ---------- Bloques ----------
  function minutesOf(value, unit) { const v = num(value) || 0; if (unit === 's') return v / 60; if (unit === 'km') return v * 5.5; return v; }

  function blockLabel(block) {
    return ({ warmup: 'Calentar', activation: 'Activación', cooldown: 'Soltar' })[block.type] || block.name || 'Bloque principal';
  }

  // Filas del paso a paso y segmentos para el dibujo de la sesión.
  function sessionPlan(workout, athleteZones) {
    const blocks = (Array.isArray(workout && workout.blocks) ? workout.blocks : []).filter(b => b && b.type !== 'runflow_meta' && b.type !== 'strength');
    const rows = [], segments = [];
    const push = (minutes, range, kind) => { if (minutes > 0) segments.push({ minutes, zone: range && range.zones ? range.zones[1] : (range && range.pace ? 5 : 2), kind }); };
    for (const block of blocks) {
      const range = zoneRange(block.target);
      const texts = rangeTexts(range, athleteZones);
      const recRange = zoneRange(block.recovery_target) || { zones: [1, 1] };
      const recTexts = rangeTexts(recRange, athleteZones);
      const reps = Math.max(1, num(block.repetitions) || 1);
      if (block.type === 'activation') {
        const work = (num(block.work_sec) || 0) / 60, rec = (num(block.recovery_sec) || 0) / 60;
        rows.push({ label: `${reps} × ${num(block.work_sec) || 0}" ${block.target ? norm(block.target) === 'progresivo' ? 'progresivos' : block.target : ''}`.trim(), pace: '', hr: '', kind: 'easy', zone: 3 });
        for (let i = 0; i < reps; i += 1) { push(work, { zones: [3, 3] }, 'work'); push(rec, { zones: [1, 1] }, 'rec'); }
        continue;
      }
      const work = num(block.duration_min) || minutesOf(block.work_value, block.work_unit) || (num(block.work_sec) || 0) / 60;
      const rec = minutesOf(block.recovery_value, block.recovery_unit);
      const workText = num(block.duration_min) ? `${num(block.duration_min)}'` : block.work_unit === 's' ? `${num(block.work_value)}"` : block.work_unit === 'km' ? `${num(block.work_value)} km` : `${num(block.work_value) || Math.round(work)}'`;
      const hardBlock = range && range.zones ? range.zones[1] >= 3 : !!(range && range.pace);
      const kind = ['warmup', 'cooldown'].includes(block.type) ? 'easy' : hardBlock && reps > 1 ? 'work' : hardBlock ? 'work' : 'easy';
      rows.push({ label: reps > 1 ? `${reps} × ${workText} ${blockLabel(block).toLowerCase()}` : `${workText} ${blockLabel(block).toLowerCase()}`, pace: texts.pace, hr: texts.hr, kind, zone: range && range.zones ? range.zones[1] : (range && range.pace ? 5 : 2), target: block.target || '' });
      if (reps > 1 && rec > 0) rows.push({ label: `${block.recovery_value}${block.recovery_unit === 's' ? '"' : "'"} entre series`, pace: recTexts.pace, hr: recTexts.hr, kind: 'rec', zone: 1, target: block.recovery_target || '' });
      for (let i = 0; i < reps; i += 1) { push(work, range, kind); if (i < reps - 1 && rec > 0) push(rec, recRange, 'rec'); }
    }
    if (!segments.length) {
      const minutes = num(workout && workout.planned_duration_min) || 0;
      const key = classifySession(workout);
      if (minutes > 0) segments.push({ minutes, zone: key === 'recovery' ? 1 : isHard(key) ? 4 : 2, kind: isHard(key) ? 'work' : 'easy' });
    }
    const total = segments.reduce((s, x) => s + x.minutes, 0);
    return { rows, segments, total };
  }

  // ---------- Por qué hoy ----------
  function weekdayName(dateString) {
    return ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][new Date(`${String(dateString).slice(0, 10)}T12:00:00`).getDay()];
  }

  function whyToday(today, workouts) {
    if (!today) return '';
    const key = classifySession(today);
    const date = String(today.workout_date).slice(0, 10);
    const sorted = [...(workouts || [])].sort((a, b) => String(a.workout_date).localeCompare(String(b.workout_date)));
    const prev = sorted.filter(w => String(w.workout_date).slice(0, 10) < date).pop();
    const next = sorted.find(w => String(w.workout_date).slice(0, 10) > date && isQualityOrLong(classifySession(w)));
    const prevKey = prev ? classifySession(prev) : null;
    const prevIsYesterday = prev && (new Date(`${date}T12:00:00`) - new Date(`${String(prev.workout_date).slice(0, 10)}T12:00:00`)) / 86400000 === 1;
    const nextText = next ? `${SESSION_INFO[classifySession(next)].label.toLowerCase()} del ${weekdayName(next.workout_date)}` : '';
    if (['recovery', 'easy', 'walk', 'bike', 'rest'].includes(key)) {
      if (prevIsYesterday && isQualityOrLong(prevKey)) return `Ayer hiciste ${SESSION_INFO[prevKey].label.toLowerCase()}. Hoy toca mover las piernas sin cansarlas${nextText ? ` para llegar fresco a la ${nextText}` : ''}.`;
      if (nextText) return `Suma base aeróbica sin gastar: el ${weekdayName(next.workout_date)} llega la ${SESSION_INFO[classifySession(next)].label.toLowerCase()} y quieres llegar con piernas.`;
      return SESSION_INFO[key].purpose;
    }
    if (isHard(key)) return `Es la sesión clave de la semana. ${prevKey && !isQualityOrLong(prevKey) ? 'Vienes de días suaves, así que hoy tienes piernas para hacerla bien. ' : ''}${SESSION_INFO[key].purpose.split('.')[0]}.`;
    if (key === 'long') return 'La tirada larga es la base para aguantar el día de la carrera. Hazla tranquila: lo importante es el tiempo, no el ritmo.';
    if (key === 'strength') return 'La fuerza te protege de lesiones y hace tu zancada más potente. Hoy toca, lejos de la sesión dura.';
    return SESSION_INFO[key].purpose;
  }

  // ---------- Actividad ----------
  function zoneTimes(raw) {
    const list = Array.isArray(raw && raw.icu_hr_zone_times) && raw.icu_hr_zone_times.some(v => num(v) > 0) ? raw.icu_hr_zone_times
      : Array.isArray(raw && raw.pace_zone_times) && raw.pace_zone_times.some(v => num(v) > 0) ? raw.pace_zone_times
        : Array.isArray(raw && raw.gap_zone_times) ? raw.gap_zone_times : [];
    const values = list.map(v => Math.max(0, num(v) || 0));
    const total = values.reduce((s, v) => s + v, 0);
    if (!total) return null;
    // Intervals usa 5 a 7 zonas: Z1-Z2 suave, Z3 medio, Z4+ fuerte.
    return { values, total, easy: (values[0] || 0) + (values[1] || 0), mid: values[2] || 0, hard: values.slice(3).reduce((s, v) => s + v, 0) };
  }

  function hrZoneOf(hr, athleteZones) {
    const h = num(hr); const list = (athleteZones && athleteZones.hr) || [];
    if (!h || !list.length) return null;
    for (let i = 0; i < list.length; i += 1) { const z = zoneRow(list, i + 1); if (z && h <= (num(z.max_value) ?? Infinity)) return i + 1; }
    return list.length;
  }

  function cadenceSpm(raw) { const c = num(raw && raw.average_cadence); if (!c) return null; return Math.round(c < 120 ? c * 2 : c); }

  function contextChips(activity, feedback) {
    const raw = (activity && activity.raw_summary) || {};
    const chips = [];
    const temp = num(raw.average_temp); if (temp !== null) chips.push({ label: `${Math.round(temp)} °C`, hint: 'Temperatura' });
    const dec = num(raw.decoupling); if (dec !== null) chips.push({ label: `Desacople ${String(Math.round(dec * 10) / 10).replace('.', ',')} %`, hint: dec <= 5 ? 'Pulso estable para el mismo ritmo' : 'El pulso fue subiendo con el mismo ritmo' });
    const cad = cadenceSpm(raw); if (cad && /run|trail|carrera/i.test(String(activity.sport || raw.type || 'run'))) chips.push({ label: `Cadencia ${cad}`, hint: 'Pasos por minuto' });
    const up = num(activity.elevation_gain_m ?? raw.total_elevation_gain); if (up && up >= 20) chips.push({ label: `+${Math.round(up)} m`, hint: 'Desnivel positivo' });
    const down = num(raw.total_elevation_loss ?? raw.elevation_loss); if (down && down >= 20) chips.push({ label: `−${Math.round(down)} m`, hint: 'Desnivel negativo' });
    const kcal = num(raw.calories); if (kcal) chips.push({ label: `${Math.round(kcal)} kcal`, hint: 'Gasto estimado' });
    const gear = raw.gear && (raw.gear.name || raw.gear.id) ? raw.gear : null;
    if (gear && gear.name) chips.push({ label: `${gear.name}${num(gear.distance) ? ` · ${Math.round(num(gear.distance) / 1000)} km` : ''}`, hint: 'Zapatillas' });
    const rpe = num(feedback && feedback.rpe) ?? num(raw.icu_rpe) ?? num(raw.session_rpe);
    if (rpe) chips.push({ label: `Tu esfuerzo: ${rpe}/10`, hint: feedback && feedback.rpe ? 'Tu valoración' : 'Desde tu reloj' });
    if (raw.trainer) chips.push({ label: 'Cinta', hint: 'Interior' });
    if (raw.race) chips.push({ label: 'Competición', hint: '' });
    return chips;
  }

  const ZONE_WORD = { 1: 'muy suave (Z1)', 2: 'suave (Z2)', 3: 'medio (Z3)', 4: 'umbral (Z4)', 5: 'muy alto (Z5)' };

  // Frases cortas para entender la sesión de un vistazo. `analysis` es block_analysis si existe.
  function activityReading({ activity, planned, athleteZones, analysis } = {}) {
    const out = [];
    if (!activity) return out;
    const raw = activity.raw_summary || {};
    const km = (num(activity.distance_m) || 0) / 1000;
    const pace = num(activity.avg_pace_sec_per_km);
    const zt = zoneTimes(raw);
    const s = analysis && analysis.summary;
    if (s && s.work_count) {
      const reading = (Array.isArray(analysis.reading) ? analysis.reading.map(r => r && r.text).filter(Boolean) : [])
        .filter(text => !/no tiene un objetivo|no se puede comparar|segment/i.test(text));
      if (s.with_target) out.push(`${s.in_target} de ${s.with_target} series en objetivo.`);
      else if (!reading.length || !/^\d+ series/.test(reading[0])) out.push(`${s.work_count} series completadas.`);
      reading.slice(0, 2).forEach(text => out.push(text));
    } else {
      const zone = hrZoneOf(activity.avg_hr, athleteZones);
      const plannedKey = planned ? classifySession(planned) : null;
      let first = `${km >= 1 ? `${String(Math.round(km * 10) / 10).replace('.', ',')} km` : 'Sesión'}${pace && km >= 1 ? ` a ${fmtPace(pace)}/km` : ''}`;
      if (zone) first += ` con pulso medio de ${Math.round(num(activity.avg_hr))} ppm, ${ZONE_WORD[Math.min(5, zone)] || `Z${zone}`}`;
      out.push(`${first}.`);
      if (plannedKey && ['easy', 'recovery', 'long'].includes(plannedKey) && zt) {
        const easyPct = Math.round((zt.easy / zt.total) * 100);
        if (easyPct >= 80) out.push(`El ${easyPct} % del tiempo en zona suave: justo lo que pedía la sesión.`);
        else if (easyPct >= 60) out.push(`El ${easyPct} % del tiempo en zona suave. Algo por encima de lo previsto: la próxima, un poco más despacio.`);
        else out.push(`Solo el ${easyPct} % en zona suave: hoy tocaba suave y fue más bien una sesión media. Ojo con acumular cansancio.`);
      } else if (zt && zt.hard / zt.total >= 0.2) out.push(`${Math.round(zt.hard / 60)} min en zona alta: sesión exigente.`);
    }
    const dec = num(raw.decoupling);
    if (dec !== null && (!s || !s.work_count) && km >= 6) out.push(dec <= 5 ? `Pulso estable de principio a fin (desacople ${String(Math.round(dec * 10) / 10).replace('.', ',')} %): buena base aeróbica.` : `El pulso subió un ${String(Math.round(dec * 10) / 10).replace('.', ',')} % con el mismo ritmo al final. Puede ser calor, poca hidratación o cansancio.`);
    const temp = num(raw.average_temp);
    if (temp !== null && temp >= 25) out.push(`Hizo calor (${Math.round(temp)} °C): es normal que el pulso fuera más alto.`);
    if (planned) {
      const pl = num(planned.planned_load), real = num(activity.load);
      if (pl && real) { const pct = Math.round((real / pl) * 100); if (pct > 125) out.push(`Carga un ${pct - 100} % por encima de lo planificado.`); else if (pct < 75) out.push(`Carga un ${100 - pct} % por debajo de lo planificado.`); }
    }
    return out.slice(0, 4);
  }

  function compliance(activity, planned) {
    if (!activity || !planned) return null;
    const pairs = [];
    const pm = num(planned.planned_duration_min), am = num(activity.duration_sec);
    if (pm && am) pairs.push(Math.min(am / 60, pm) / Math.max(am / 60, pm));
    const pk = num(planned.planned_distance_km), ak = num(activity.distance_m);
    if (pk && ak) pairs.push(Math.min(ak / 1000, pk) / Math.max(ak / 1000, pk));
    const pl = num(planned.planned_load), al = num(activity.load);
    if (pl && al) pairs.push(Math.min(al, pl) / Math.max(al, pl));
    if (!pairs.length) return null;
    return Math.round((pairs.reduce((s, v) => s + v, 0) / pairs.length) * 100);
  }

  // ---------- Evolución ----------
  function isoMonday(dateString) {
    const d = new Date(`${String(dateString).slice(0, 10)}T12:00:00Z`);
    const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1);
    return d.toISOString().slice(0, 10);
  }
  function addDaysIso(dateString, days) { const d = new Date(`${String(dateString).slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

  function weeklyEvolution(activities, today, weeks = 12) {
    const lastMonday = isoMonday(today);
    const firstMonday = addDaysIso(lastMonday, -7 * (weeks - 1));
    const rows = Array.from({ length: weeks }, (_, i) => ({ week_start: addDaysIso(firstMonday, i * 7), km: 0, run_km: 0, duration_sec: 0, elevation_m: 0, sessions: 0, load: 0, zone_easy_sec: 0, zone_mid_sec: 0, zone_hard_sec: 0 }));
    const days = new Map();
    for (const activity of activities || []) {
      const date = String(activity.activity_date || '').slice(0, 10);
      if (!date || date < firstMonday || date > addDaysIso(lastMonday, 6)) continue;
      const idx = Math.floor((new Date(`${isoMonday(date)}T12:00:00Z`) - new Date(`${firstMonday}T12:00:00Z`)) / (7 * 86400000));
      const row = rows[idx]; if (!row) continue;
      const raw = activity.raw_summary || {};
      const km = (num(activity.distance_m) || 0) / 1000;
      row.km += km;
      if (/run/i.test(String(activity.sport || raw.type || ''))) row.run_km += km;
      row.duration_sec += num(activity.duration_sec) || 0;
      row.elevation_m += num(activity.elevation_gain_m ?? raw.total_elevation_gain) || 0;
      row.load += num(activity.load) || 0;
      row.sessions += 1;
      const zt = zoneTimes(raw);
      if (zt) { row.zone_easy_sec += zt.easy; row.zone_mid_sec += zt.mid; row.zone_hard_sec += zt.hard; }
      const day = days.get(date) || { date, km: 0, sessions: 0, duration_sec: 0 }; day.km += km; day.sessions += 1; day.duration_sec += num(activity.duration_sec) || 0; days.set(date, day);
    }
    rows.forEach(r => { r.km = Math.round(r.km * 10) / 10; r.run_km = Math.round(r.run_km * 10) / 10; r.elevation_m = Math.round(r.elevation_m); r.load = Math.round(r.load); });
    const dayRows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ ...d, km: Math.round(d.km * 10) / 10 }));
    return { weeks: rows, days: dayRows, oldest: firstMonday, newest: addDaysIso(lastMonday, 6) };
  }

  return { SESSION_INFO, classifySession, isHard, zoneRange, rangeTexts, sessionPlan, whyToday, zoneTimes, hrZoneOf, contextChips, activityReading, compliance, weeklyEvolution, fmtPace, isoMonday, addDaysIso };
});
