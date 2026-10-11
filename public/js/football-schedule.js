// RunFlow Fútbol · semana del deportista, partidos y circuitos de fuerza.
// Módulo compartido: lo usan el servidor (football-api-hook.js), el Coach y la app del deportista.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunFlowFootballSchedule = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const WEEK_KINDS = ['football_training', 'strength', 'rest'];
  const EVENT_KINDS = ['match', 'football_training', 'strength', 'rest', 'cancel'];
  const RATED_KINDS = ['football_training', 'strength', 'match'];
  const KIND_LABEL = { football_training: 'Entreno fútbol', strength: 'Fuerza', match: 'Partido', rest: 'Descanso', cancel: 'Cancelado' };
  const IMPORTANCE = { friendly: 'Amistoso', league: 'Liga', tournament: 'Torneo' };
  const BODY = [
    { value: 1, label: 'Fresco', icon: '🔋' },
    { value: 2, label: 'Normal', icon: '👍' },
    { value: 3, label: 'Cargado', icon: '🦵' },
    { value: 4, label: 'Muy cargado', icon: '🪫' },
  ];
  const MOOD = [
    { value: 1, icon: '😞' }, { value: 2, icon: '😕' }, { value: 3, icon: '😐' }, { value: 4, icon: '🙂' }, { value: 5, icon: '😀' },
  ];

  const yt = query => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  // Biblioteca de ejercicios de fuerza para montar circuitos. El coach puede cambiar texto y vídeo en cada estación.
  const STRENGTH_LIBRARY = [
    { name: 'Sentadilla goblet', work: '10 reps', note: 'Kettlebell o mancuerna, bajar controlado', steps: ['Sujeta la pesa pegada al pecho.', 'Pies a la anchura de los hombros.', 'Baja con la espalda recta hasta que la cadera pase la rodilla.', 'Sube empujando el suelo.'], cues: 'Las rodillas siguen la dirección de los pies.', video: yt('sentadilla goblet técnica') },
    { name: 'Zancada atrás', work: '6 / pierna', note: 'Rodilla alineada con el pie', steps: ['De pie, pies a la anchura de la cadera.', 'Paso largo atrás y baja hasta que la rodilla casi toque el suelo.', 'Empuja con el talón de delante para volver.'], cues: 'El tronco se queda recto, sin irse hacia delante.', video: yt('zancada atrás reverse lunge técnica') },
    { name: 'Puente de glúteo a 1 pierna', work: '40 s', note: 'Pausa de 2 s arriba', steps: ['Túmbate boca arriba, rodillas dobladas y pies apoyados.', 'Estira una pierna y deja la otra en el suelo.', 'Sube la cadera empujando con el talón hasta alinear rodilla, cadera y hombro.', 'Aguanta 2 s arriba y baja despacio.'], cues: 'La cadera no se cae hacia el lado de la pierna estirada.', video: yt('single leg glute bridge técnica') },
    { name: 'Nórdico asistido', work: '5 reps', note: 'Prevención de isquios', steps: ['De rodillas, con alguien o algo sujetando los tobillos.', 'Déjate caer hacia delante lo más lento que puedas.', 'Frena con las manos al final y vuelve ayudándote.'], cues: 'Cuerpo recto de rodillas a cabeza, sin doblar la cadera.', video: yt('nordic hamstring curl asistido') },
    { name: 'Salto al cajón', work: '5 reps', note: 'Máxima calidad, aterrizar suave', steps: ['De pie frente a un cajón estable.', 'Brazos atrás, flexiona y salta arriba.', 'Aterriza suave con las dos piernas.', 'Baja andando, no saltando.'], cues: 'Calidad antes que altura: si el aterrizaje es ruidoso, baja el cajón.', video: yt('box jump técnica futbol') },
    { name: 'Plancha lateral', work: '30 s / lado', note: '', steps: ['Apoya el antebrazo bajo el hombro.', 'Sube la cadera hasta formar una línea recta.', 'Aguanta y cambia de lado.'], cues: 'No dejes caer la cadera.', video: yt('plancha lateral técnica') },
    { name: 'Pogos reactivos', work: '2 × 10', note: 'Contacto corto con el suelo', steps: ['Saltos pequeños con las piernas casi rectas.', 'Rebota con la parte delantera del pie.', 'Brazos relajados.'], cues: 'Toca el suelo lo menos posible.', video: yt('pogo jumps futbol') },
    { name: 'Peso muerto rumano', work: '8 reps', note: 'Espalda neutra', steps: ['Pesas delante de los muslos.', 'Lleva la cadera atrás con las rodillas un poco dobladas.', 'Baja hasta notar los isquios y sube apretando glúteo.'], cues: 'La pesa va pegada a las piernas.', video: yt('peso muerto rumano técnica') },
    { name: 'Copenhague corto', work: '20 s / lado', note: 'Prevención de aductores', steps: ['Plancha lateral con la rodilla de arriba apoyada en un banco.', 'Sube la cadera y aguanta.', 'Cambia de lado.'], cues: 'Si molesta, apoya también la rodilla de abajo.', video: yt('copenhagen plank short lever') },
    { name: 'Elevación de gemelos a 1 pierna', work: '12 / pierna', note: 'Lento al bajar', steps: ['De pie en un escalón, apoyando la punta.', 'Sube al máximo y baja en 3 s.'], cues: 'Sin rebotar abajo.', video: yt('single leg calf raise técnica') },
    { name: 'Skipping', work: '20 s', note: 'Rodillas arriba, rápido', steps: ['Carrera en el sitio subiendo rodillas.', 'Brazos coordinados.'], cues: 'Apoyos rápidos y tronco alto.', video: yt('skipping futbol técnica') },
    { name: 'Dead bug', work: '8 / lado', note: 'Zona lumbar pegada al suelo', steps: ['Boca arriba, brazos y piernas arriba.', 'Estira brazo y pierna contrarios sin despegar la zona lumbar.', 'Vuelve y cambia de lado.'], cues: 'Respira y no arquees la espalda.', video: yt('dead bug ejercicio core') },
  ];

  const TEMPLATES = [
    { id: 'tpl-inferior', name: 'Fuerza A · Tren inferior', objective: 'Fuerza y potencia de piernas sin llegar cargado al partido', format: 'circuit', rounds: 3, transition_sec: 15, rest_sec: 120,
      stations: ['Sentadilla goblet', 'Zancada atrás', 'Puente de glúteo a 1 pierna', 'Nórdico asistido', 'Salto al cajón', 'Plancha lateral'] },
    { id: 'tpl-prevencion', name: 'Fuerza B · Prevención', objective: 'Isquios, aductores y gemelos fuertes para prevenir lesiones', format: 'circuit', rounds: 2, transition_sec: 15, rest_sec: 90,
      stations: ['Nórdico asistido', 'Copenhague corto', 'Elevación de gemelos a 1 pierna', 'Dead bug', 'Plancha lateral'] },
    { id: 'tpl-activacion', name: 'Activación pre-partido', objective: 'Despertar el cuerpo el día antes, sin cansar', format: 'circuit', rounds: 2, transition_sec: 15, rest_sec: 60,
      stations: ['Skipping', 'Pogos reactivos', 'Puente de glúteo a 1 pierna', 'Dead bug'] },
  ];

  // ---------- utilidades ----------
  const text = (value, max = 200) => String(value ?? '').trim().replace(/[<>"`]/g, '').slice(0, max);
  const url = value => { const s = String(value || '').trim(); return /^https?:\/\/[^\s"'<>`]+$/i.test(s) ? s.slice(0, 600) : ''; };
  const num = (value, min, max, fallback = null) => {
    if (value === '' || value === null || value === undefined) return fallback;
    const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const time = value => { const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
  const isoDate = value => { const s = String(value || ''); return /^\d{4}-\d{2}-\d{2}$/.test(s) && isoFromDate(dateFromIso(s)) === s ? s : ''; };
  const id = (value, fallback) => String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || fallback;
  const steps = value => (Array.isArray(value) ? value : String(value || '').split('\n')).map(s => text(s, 300)).filter(Boolean).slice(0, 12);
  const randomId = prefix => `${prefix}${Math.random().toString(36).slice(2, 9)}`;

  const pad = n => String(n).padStart(2, '0');
  const dateFromIso = iso => new Date(`${iso}T12:00:00Z`);
  const isoFromDate = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const addDays = (iso, days) => { const d = dateFromIso(iso); d.setUTCDate(d.getUTCDate() + days); return isoFromDate(d); };
  const dayIndex = iso => (dateFromIso(iso).getUTCDay() + 6) % 7; // 0 = lunes
  const mondayOf = iso => addDays(iso, -dayIndex(iso));
  const daysBetween = (a, b) => Math.round((dateFromIso(b) - dateFromIso(a)) / 86400000);
  const todayMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  // ---------- saneado ----------
  function sanitizeStation(item) {
    const s = item && typeof item === 'object' ? item : {};
    return {
      name: text(s.name, 120), work: text(s.work, 40), note: text(s.note, 200), steps: steps(s.steps),
      cues: text(s.cues, 400), video: url(s.video), img: url(s.img),
    };
  }
  function sanitizeStrength(list) {
    const used = new Set();
    return (Array.isArray(list) ? list : []).filter(b => b && typeof b === 'object').slice(0, 20).map((b, index) => {
      let blockId = id(b.id, `b${index + 1}`);
      while (used.has(blockId)) blockId = `${blockId}-${index + 1}`;
      used.add(blockId);
      return {
        id: blockId, name: text(b.name, 120) || `Bloque ${index + 1}`, objective: text(b.objective, 200),
        format: b.format === 'sets' ? 'sets' : 'circuit',
        rounds: num(b.rounds, 1, 10, 3), transition_sec: num(b.transition_sec, 0, 300, 15), rest_sec: num(b.rest_sec, 0, 900, 120),
        stations: (Array.isArray(b.stations) ? b.stations : []).slice(0, 15).map(sanitizeStation).filter(s => s.name),
      };
    });
  }
  function sanitizeItem(item, kinds) {
    const s = item && typeof item === 'object' ? item : {};
    const kind = kinds.includes(s.kind) ? s.kind : null;
    if (!kind) return null;
    const out = { kind, time: time(s.time), duration_min: num(s.duration_min, 0, 300, null), place: text(s.place, 80), note: text(s.note, 200) };
    if (kind === 'strength') out.strength_id = id(s.strength_id, '');
    return out;
  }
  function sanitizeSchedule(value) {
    const source = value && typeof value === 'object' ? value : {};
    const week = Array.from({ length: 7 }, (_, d) => (Array.isArray(source.week?.[d]) ? source.week[d] : [])
      .slice(0, 6).map(item => sanitizeItem(item, WEEK_KINDS)).filter(Boolean));
    const used = new Set();
    const events = (Array.isArray(source.events) ? source.events : []).slice(0, 300).map((e, index) => {
      const base = sanitizeItem(e, EVENT_KINDS);
      const date = isoDate(e?.date);
      if (!base || !date) return null;
      let eventId = id(e.id, `e${index + 1}`);
      while (used.has(eventId)) eventId = `${eventId}-${index + 1}`;
      used.add(eventId);
      const out = { id: eventId, date, ...base };
      if (base.kind === 'match') {
        out.rival = text(e.rival, 80); out.home = e.home !== false;
        out.importance = Object.prototype.hasOwnProperty.call(IMPORTANCE, e.importance) ? e.importance : 'league';
      }
      if (base.kind === 'cancel') out.cancel_kind = ['football_training', 'strength', 'all'].includes(e.cancel_kind) ? e.cancel_kind : 'football_training';
      return out;
    }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    // Desde cuándo vale la semana tipo: antes de esa fecha no se piden valoraciones de sesiones que no existían.
    return { start: isoDate(source.start), week, events };
  }

  // ---------- duración de un circuito ----------
  function stationSeconds(work) {
    const t = String(work || '').toLowerCase();
    const perSide = /\/\s*(lado|pierna|brazo)|por (lado|pierna)/.test(t) ? 2 : 1;
    const sets = t.match(/^(\d+)\s*[×x]\s*/);
    const mult = sets ? Number(sets[1]) : 1;
    const rest = sets ? t.slice(sets[0].length) : t;
    const secs = rest.match(/(\d+)\s*(s|seg)/);
    if (secs) return Number(secs[1]) * perSide * mult;
    const mins = rest.match(/(\d+)\s*min/);
    if (mins) return Number(mins[1]) * 60 * mult;
    const reps = rest.match(/(\d+)/);
    return Math.max(20, (reps ? Number(reps[1]) : 8) * 3.5) * perSide * mult;
  }
  function timedSeconds(work) {
    const t = String(work || '').toLowerCase();
    if (/^\d+\s*[×x]/.test(t)) return null;
    const secs = t.match(/^(\d+)\s*(s|seg)\b/);
    if (secs) return Number(secs[1]);
    const mins = t.match(/^(\d+)\s*min\b/);
    return mins ? Number(mins[1]) * 60 : null;
  }
  function blockMinutes(block) {
    if (!block || !Array.isArray(block.stations) || !block.stations.length) return 0;
    const rounds = Number(block.rounds || 1);
    const perRound = block.stations.reduce((sum, s) => sum + stationSeconds(s.work), 0) + Number(block.transition_sec || 0) * block.stations.length;
    return Math.max(1, Math.round((perRound * rounds + Number(block.rest_sec || 0) * Math.max(0, rounds - 1)) / 60));
  }
  function fromTemplate(templateId) {
    const tpl = TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return null;
    return {
      id: randomId('b'), name: tpl.name, objective: tpl.objective, format: tpl.format, rounds: tpl.rounds, transition_sec: tpl.transition_sec, rest_sec: tpl.rest_sec,
      stations: tpl.stations.map(name => ({ ...STRENGTH_LIBRARY.find(e => e.name === name), img: '' })),
    };
  }

  // ---------- plan resuelto día a día ----------
  function mdLabel(date, matchDates) {
    let next = null, prev = null;
    matchDates.forEach(m => {
      const d = daysBetween(date, m);
      if (d >= 0 && (next === null || d < next)) next = d;
      if (d < 0 && (prev === null || -d < prev)) prev = -d;
    });
    if (next === 0) return 'MD';
    if (prev !== null && prev <= 2 && (next === null || next > 3)) return `MD+${prev}`;
    if (next !== null && next <= 6) return `MD-${next}`;
    if (prev !== null && prev <= 3) return `MD+${prev}`;
    return '';
  }
  function itemTitle(item, strengthById) {
    if (item.kind === 'strength') return strengthById[item.strength_id]?.name || 'Fuerza';
    if (item.kind === 'match') return item.rival ? `Partido vs ${item.rival}` : 'Partido';
    return KIND_LABEL[item.kind] || item.kind;
  }
  function resolvePlan(program, from, to) {
    const schedule = sanitizeSchedule(program?.schedule);
    const strength = Array.isArray(program?.strength) ? program.strength : [];
    const strengthById = Object.fromEntries(strength.map(b => [b.id, b]));
    const matchDates = schedule.events.filter(e => e.kind === 'match').map(e => e.date);
    const days = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const dayEvents = schedule.events.filter(e => e.date === date);
      const cancels = dayEvents.filter(e => e.kind === 'cancel').map(e => e.cancel_kind);
      const hasMatch = dayEvents.some(e => e.kind === 'match');
      const template = (schedule.start && date < schedule.start ? [] : schedule.week[dayIndex(date)]).map((item, index) => ({ ...item, key: `${date}|w${index}`, source: 'week' }))
        .filter(item => !cancels.includes('all') && !cancels.includes(item.kind))
        .filter(item => !(hasMatch && item.kind === 'football_training'));
      const extra = dayEvents.filter(e => e.kind !== 'cancel').map(e => ({ ...e, key: `${date}|e${e.id}`, source: 'event' }));
      let items = [...template, ...extra];
      if (items.some(i => i.kind !== 'rest')) items = items.filter(i => i.kind !== 'rest');
      items = items.map(item => {
        const block = item.kind === 'strength' ? strengthById[item.strength_id] : null;
        return { ...item, date, title: itemTitle(item, strengthById), duration_min: item.duration_min || (block ? blockMinutes(block) : item.kind === 'match' ? 70 : null) };
      }).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
      const md = mdLabel(date, matchDates);
      const warnings = [];
      if (items.some(i => i.kind === 'strength') && (md === 'MD-1' || md === 'MD')) warnings.push(md === 'MD' ? 'Fuerza el mismo día del partido.' : 'Fuerza el día antes del partido.');
      days.push({ date, day: dayIndex(date), md, items, warnings, cancelled: cancels });
    }
    return days;
  }

  // Valoraciones: qué sesiones planificadas (pasadas o de hoy) aún no tienen valoración.
  function logPlanKey(log) { return log?.plan_key || log?.football?.plan_key || null; }
  function attachRatings(days, logs, today) {
    const byKey = new Map();
    (logs || []).forEach(log => { const key = logPlanKey(log); if (key && !byKey.has(key)) byKey.set(key, log); });
    days.forEach(day => day.items.forEach(item => {
      if (!RATED_KINDS.includes(item.kind)) return;
      item.rating = byKey.get(item.key) || null;
      item.pending = !item.rating && day.date <= today;
    }));
    return days;
  }

  return {
    DAYS, DAYS_SHORT, WEEK_KINDS, EVENT_KINDS, RATED_KINDS, KIND_LABEL, IMPORTANCE, BODY, MOOD, STRENGTH_LIBRARY, TEMPLATES,
    sanitizeSchedule, sanitizeStrength, sanitizeStation, resolvePlan, attachRatings, blockMinutes, stationSeconds, timedSeconds, fromTemplate, mdLabel,
    addDays, dayIndex, mondayOf, daysBetween, todayMadrid, randomId,
  };
}));
