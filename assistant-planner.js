'use strict';

// Agente Planificador (Claude vía MCP). Todo lo que calcula sale del motor de
// planificación (public/js/running-guided-plan.js): el agente parte del plan
// base de RunFlow, lo retoca con un porqué y el Verificador (reglas duras del
// motor) decide si la propuesta se puede guardar. Nada llega al calendario
// hasta que el entrenador la aprueba en Planificación.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const P = require('./public/js/running-guided-plan.js');

const DATA_DIR = path.join(__dirname, 'data');
let libraryCache = null;
function libraryRows() {
  if (libraryCache) return libraryCache;
  const single = path.join(DATA_DIR, 'runflow-v9-library.b64');
  let encoded = '';
  if (fs.existsSync(single)) encoded = fs.readFileSync(single, 'utf8').trim();
  else encoded = fs.readdirSync(DATA_DIR).filter(n => /^runflow-v9-library\.part\d+\.b64$/.test(n))
    .sort((a, b) => Number(a.match(/part(\d+)/)[1]) - Number(b.match(/part(\d+)/)[1]))
    .map(n => fs.readFileSync(path.join(DATA_DIR, n), 'utf8').trim()).join('');
  libraryCache = encoded ? JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8')).s || [] : [];
  return libraryCache;
}

const bad = message => Object.assign(new Error(message), { status: 400 });
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const enc = encodeURIComponent;

const RULES = [
  'Parte SIEMPRE del plan base que calcula RunFlow (preview_season_plan sin ajustes). Solo puedes retocar semanas concretas.',
  'Cada ajuste: start (lunes de la semana), type y/o minutes, y why (obligatorio, en lenguaje sencillo para el entrenador).',
  `Los minutos de una semana no se alejan más de un ±${Math.round(P.AGENT_MAX_CHANGE * 100)} % del cálculo de RunFlow.`,
  'La fecha de la carrera no se mueve: la última semana es de competición.',
  'Las últimas semanas son de puesta a punto (1 en 5K, 10K, media y trail corto; 2 en maratón y trail largo) y siempre por debajo de la semana más alta.',
  'El volumen no sube más de un 10 % sobre la semana más alta anterior.',
  'Descarga obligatoria: como mucho 3 semanas seguidas de carga (nivel nuevo) o 4 (regular y experto).',
  'Ninguna semana pide más minutos de los que el atleta tiene libres para correr.',
  'Si hay historial, la primera semana de carga sale como mucho un 10 % por encima de lo que venía corriendo.',
  'Semana: sesiones dentro de la semana, solo en días libres, sin pasar los minutos de cada día, nunca dos días duros seguidos (tirada larga o calidad), y con semáforo rojo ninguna sesión dura.',
  'Días con fuerza en la ficha: strength_minutes son los minutos de fuerza; guided_gym = fuerza guiada en el gimnasio (cita fija), si no es libre y la planifica RunFlow. can_double = puede doblar, pero no es obligatorio: como mucho una salida regenerativa opcional (regenerative: tipos y minutos) y solo cuando ayude; nunca otra sesión obligatoria el mismo día de la fuerza.',
  'La disponibilidad sale de la ficha del atleta: no la cambies; si no cuadra, díselo al entrenador.',
];
const WEEK_TYPE_LIST = Object.entries(P.WEEK_TYPES).map(([key, info]) => ({ key, label: info.label, why: info.why }));

// ---------- Lectura de datos ----------
async function profileDays(db, athleteId) {
  const rows = await db('athlete_profiles', `athlete_id=eq.${enc(athleteId)}&select=availability&limit=1`).catch(() => []);
  return P.daysFromProfile({ availability: rows[0]?.availability || null });
}
async function guidedPlan(db, athleteId, today) {
  const macros = await db('macrocycles', `athlete_id=eq.${enc(athleteId)}&end_date=gte.${today}&select=*&order=start_date.asc`).catch(() => []);
  const macro = macros.find(item => P.readAnswers(item.notes));
  if (!macro) return null;
  const answers = P.readAnswers(macro.notes);
  const mesos = await db('mesocycles', `athlete_id=eq.${enc(athleteId)}&macrocycle_id=eq.${enc(macro.id)}&select=*&order=start_date.asc`);
  const ids = mesos.map(item => item.id);
  const weeks = ids.length ? await db('training_weeks', `athlete_id=eq.${enc(athleteId)}&mesocycle_id=in.(${ids.join(',')})&select=id,mesocycle_id,week_start,end_date,microcycle_type,planned_hours,target_load,planned_strength_sessions,coach_comment,status&order=week_start.asc`) : [];
  const shaped = {
    ...macro,
    mesocycles: mesos.map(meso => ({
      ...meso,
      microcycles: weeks.filter(w => w.mesocycle_id === meso.id).map(w => ({
        id: w.id, start_date: w.week_start, type: w.microcycle_type, notes: w.coach_comment || '', status: w.status,
        planned: { hours: Number(w.planned_hours) || 0, load: Number(w.target_load) || 0, strength_sessions: Number(w.planned_strength_sessions) || 0 },
      })),
    })),
  };
  return { macro: { id: macro.id, season_id: macro.season_id, name: macro.name }, answers, structure: P.structureFromPlan(answers, shaped), published: new Set(weeks.filter(w => w.status === 'published').map(w => w.week_start)) };
}
// Lo mismo que /calendar, en pequeño: lo justo para weekAdvice (cumplimiento, RPE, dolor, carga).
function calendarWeeks(workouts, activities, logs) {
  const byWorkout = new Map();
  (activities || []).forEach(a => { if (a.workout_id) byWorkout.set(String(a.workout_id), [...(byWorkout.get(String(a.workout_id)) || []), a]); });
  const logBy = new Map();
  [...(logs || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).forEach(l => { if (l.workout_id && !logBy.has(String(l.workout_id))) logBy.set(String(l.workout_id), l); });
  const ids = new Set((workouts || []).map(w => String(w.id)));
  const decorated = (workouts || []).map(w => {
    const linked = byWorkout.get(String(w.id)) || [], log = logBy.get(String(w.id)) || null;
    let status = 'planned';
    if (linked.length) status = log && log.status === 'partial' ? 'partial' : 'completed';
    else if (log && ['completed', 'partial', 'skipped'].includes(log.status)) status = log.status;
    return { ...w, execution_status: status, actual: { load: linked.length ? linked.reduce((s, a) => s + (Number(a.load) || 0), 0) : null }, manual_log: log ? { status: log.status, rpe: log.rpe, feeling: log.feeling || null, pain: log.pain, pain_area: log.pain_area || null } : null };
  });
  return [{ workouts: decorated, unplanned_activities: (activities || []).filter(a => !a.workout_id || !ids.has(String(a.workout_id))) }];
}
async function recentState(db, athleteId, today) {
  const from = P.addDays(today, -49);
  const [activities, recovery, workouts, logs] = await Promise.all([
    db('activities', `athlete_id=eq.${enc(athleteId)}&activity_date=gte.${from}&select=id,workout_id,activity_date,sport,duration_sec,distance_m,load&order=activity_date.asc`).catch(() => []),
    db('daily_metrics', `athlete_id=eq.${enc(athleteId)}&metric_date=gte.${P.addDays(today, -40)}&select=*&order=metric_date.asc`).catch(() => []),
    db('workouts', `athlete_id=eq.${enc(athleteId)}&workout_date=gte.${P.addDays(today, -28)}&workout_date=lt.${today}&select=id,workout_date,title,sport,priority,summary,structured_description,planned_duration_min,planned_load&order=workout_date.asc`).catch(() => []),
    db('manual_session_logs', `athlete_id=eq.${enc(athleteId)}&created_at=gte.${P.addDays(today, -28)}T00:00:00Z&select=workout_id,status,rpe,feeling,pain,pain_area,created_at`).catch(() => []),
  ]);
  return { activities, recovery, calendar: calendarWeeks(workouts, activities.filter(a => a.activity_date >= P.addDays(today, -28)), logs) };
}

// ---------- Respuestas del plan (lo que el agente puede tocar) ----------
function cleanAnswers(raw = {}, days, history) {
  const a = raw || {};
  if (!P.RACES[a.race]) throw bad(`race debe ser una de: ${Object.keys(P.RACES).join(', ')}.`);
  if (!isDate(a.race_date)) throw bad('race_date debe ser YYYY-MM-DD.');
  if (!days || !days.some(P.runsOn)) throw bad('El atleta no tiene días para correr en su ficha (Disponibilidad). Pide al entrenador que la rellene antes de planificar.');
  const num = value => (Number(value) > 0 ? Number(value) : '');
  const longest = [...days].filter(P.runsOn).sort((x, y) => y.minutes - x.minutes)[0];
  const longDay = Number.isInteger(Number(a.long_day)) && days.some(d => d.day === Number(a.long_day) && P.runsOn(d)) ? Number(a.long_day) : longest.day;
  return {
    race: a.race, race_date: a.race_date, race_name: text(a.race_name, 120), race_km: num(a.race_km), race_elevation: num(a.race_elevation),
    goal_mode: a.goal_mode === 'marca' ? 'marca' : 'terminar', target_time: a.goal_mode === 'marca' ? text(a.target_time, 12) : '',
    level: P.LEVELS[a.level] ? a.level : 'regular', injuries: text(a.injuries, 500),
    days, long_day: longDay, strength: Math.max(0, Math.min(3, Number.isFinite(Number(a.strength)) ? Number(a.strength) : 2)),
    equipment: P.EQUIPMENT[a.equipment] ? a.equipment : 'gimnasio',
    start_date: P.nextMonday(isDate(a.start_date) ? a.start_date : P.addDays(new Date().toISOString().slice(0, 10), 1)),
    history_minutes: a.ignore_history ? null : (num(a.history_minutes) || history?.avg_minutes || null),
    other_races: (Array.isArray(a.other_races) ? a.other_races : []).slice(0, 6).filter(r => isDate(r?.date)).map(r => ({ name: text(r.name, 120), date: r.date, km: num(r.km), elevation: num(r.elevation) })),
  };
}
// Plan base de RunFlow + ajustes del agente + Verificador. Lo usa la vista previa, la propuesta y la tarjeta del coach.
function seasonPlan(answers, adjustments) {
  const structure = P.buildStructure(answers);
  const base = structure.weeks.map(w => ({ start: w.start, type: w.type, minutes: w.minutes }));
  const { applied, ignored } = P.applySeasonAdjustments(structure, adjustments);
  const verification = P.verifySeason(answers, structure);
  ignored.forEach(item => verification.failures.push({ rule: 'semana', text: `${item.start || '¿?'}: ${item.why}` }));
  verification.ok = verification.failures.length === 0;
  return { structure, base, applied, verification };
}
function seasonView({ structure, base, applied, verification }) {
  return {
    summary: structure.summary, start: structure.start, end: structure.end, total_weeks: structure.totalWeeks, warnings: structure.warnings,
    blocks: structure.mesos.map(m => ({ phase: m.key, name: m.name, start: m.start, end: m.end, weeks: m.weeks.length, goal: m.goal })),
    weeks: structure.weeks.map((w, i) => ({ start: w.start, phase: w.phase, type: w.type, label: w.label, minutes: w.minutes, base_type: base[i].type, base_minutes: base[i].minutes, changed: Boolean(w.agent), why: w.why, ...(w.b_race ? { b_race: w.b_race } : {}) })),
    adjustments: applied, verification,
  };
}

// ---------- Herramientas ----------
async function planningContext(db, athleteId, today) {
  const [days, plan, recent, seasons, goals] = await Promise.all([
    profileDays(db, athleteId), guidedPlan(db, athleteId, today), recentState(db, athleteId, today),
    db('seasons', `athlete_id=eq.${enc(athleteId)}&select=id,name,start_date,end_date,status&order=start_date.desc&limit=10`).catch(() => []),
    db('goals', `athlete_id=eq.${enc(athleteId)}&status=eq.active&select=name,goal_date,event_type,priority_code,distance_km,elevation_m,performance_target&order=goal_date.asc`).catch(() => []),
  ]);
  const history = P.historyFromActivities(recent.activities, P.mondayOf(today));
  const current = plan?.structure.weeks.find(w => w.start <= today && w.end >= today) || null;
  const advice = P.weekAdvice({ week: current, calendarWeeks: recent.calendar, recovery: recent.recovery, today });
  return {
    today,
    availability: days ? days.map(d => ({
      day: d.day, day_name: P.DAYS[d.day], minutes: d.minutes, types: P.dayTypes(d), text: P.dayText(d),
      ...(d.strength_minutes ? { strength_minutes: d.strength_minutes, guided_gym: Boolean(d.gym), can_double: Boolean(d.double), ...(d.double ? { regenerative: d.extra } : {}) } : {}),
    })) : null,
    availability_note: days ? 'day: 0 = lunes … 6 = domingo. Es la disponibilidad de la ficha; el plan la usa tal cual.' : 'El atleta no tiene la disponibilidad rellenada: no se puede planificar hasta que el entrenador la complete.',
    history,
    seasons, goals,
    current_plan: plan ? {
      macro: plan.macro, answers: plan.answers, start: plan.structure.start, end: plan.structure.end,
      current_week: current ? { start: current.start, phase: current.phase, type: current.type, label: current.label, minutes: current.minutes } : null,
      weeks: plan.structure.weeks.map(w => ({ start: w.start, phase: w.phase, type: w.type, minutes: w.minutes, published: plan.published.has(w.start) })),
    } : null,
    advice: { decision: advice.decision, label: advice.label, why: advice.why, reasons: advice.reasons, has_data: advice.has_data, suggest_incident: advice.suggest_incident },
    options: { races: Object.entries(P.RACES).map(([key, r]) => ({ key, label: r.label, taper_weeks: r.taper })), levels: Object.entries(P.LEVELS).map(([key, l]) => ({ key, label: l.label, max_weeks_without_deload: l.cycle })), week_types: WEEK_TYPE_LIST, equipment: Object.keys(P.EQUIPMENT) },
    rules: RULES,
  };
}
async function previewSeason(db, athleteId, args, today) {
  const [days, recent] = await Promise.all([profileDays(db, athleteId), recentState(db, athleteId, today)]);
  const answers = cleanAnswers(args.answers, days, P.historyFromActivities(recent.activities, P.mondayOf(today)));
  return { answers: P.compactAnswers(answers), ...seasonView(seasonPlan(answers, args.adjustments)) };
}
// Devuelve lo que se guarda como propuesta, o los fallos del Verificador (y entonces no se guarda nada).
async function seasonProposal(db, athleteId, args, today) {
  const justification = text(args.justification, 4000);
  if (!justification) throw bad('Falta justification: explica al entrenador por qué propones este plan.');
  const [days, recent] = await Promise.all([profileDays(db, athleteId), recentState(db, athleteId, today)]);
  const answers = cleanAnswers(args.answers, days, P.historyFromActivities(recent.activities, P.mondayOf(today)));
  const plan = seasonPlan(answers, args.adjustments), view = seasonView(plan);
  if (!plan.verification.ok) return { ok: false, verification: plan.verification, preview: view };
  return {
    ok: true,
    data: {
      kind: 'season', status: 'proposed', origin: 'assistant', agent: 'planificador',
      title: text(args.title, 200) || P.seasonPayload(answers, plan.structure).name,
      justification, answers: P.compactAnswers(answers), adjustments: plan.applied,
      start: plan.structure.start, end: plan.structure.end, total_weeks: plan.structure.totalWeeks,
      summary: plan.structure.summary, verification: plan.verification, created_at: new Date().toISOString(),
    },
    preview: view,
  };
}
const workoutView = w => ({ workout_date: w.workout_date, sport: w.sport, title: w.title, priority: w.priority, planned_duration_min: w.planned_duration_min, planned_load: w.planned_load, summary: w.summary, structured_description: w.structured_description, optional: Boolean(w.optional), hard: P.isHardWorkout(w), runflow_library_id: w.runflow_library_id || null });
async function weekBase(db, athleteId, weekStart, today) {
  if (!isDate(weekStart)) throw bad('week_start debe ser YYYY-MM-DD (lunes).');
  const start = P.mondayOf(weekStart);
  const [plan, recent] = await Promise.all([guidedPlan(db, athleteId, today), recentState(db, athleteId, today)]);
  if (!plan) throw Object.assign(new Error('El atleta no tiene una temporada guiada en curso: propón primero la temporada (create_season_proposal).'), { status: 404 });
  const week = plan.structure.weeks.find(w => w.start === start);
  if (!week) throw Object.assign(new Error(`La semana ${start} no está dentro de la temporada (${plan.structure.start} – ${plan.structure.end}).`), { status: 404 });
  const advice = P.weekAdvice({ week, calendarWeeks: recent.calendar, recovery: recent.recovery, today });
  const adjusted = advice.has_data && advice.decision !== 'mantener' ? P.adjustWeek(week, advice) : week;
  const answers = { ...plan.answers, days: (await profileDays(db, athleteId)) || plan.answers.days };
  const sessions = P.buildWeekSessions(answers, plan.structure, adjusted, libraryRows());
  return {
    week: { start: week.start, end: week.end, phase: week.phase, phase_name: P.PHASES[week.phase]?.name, type: week.type, label: week.label, minutes: week.minutes, adjusted_minutes: adjusted.minutes, why: week.why, published: plan.published.has(week.start) },
    advice: { decision: advice.decision, label: advice.label, why: advice.why, reasons: advice.reasons, has_data: advice.has_data, suggest_incident: advice.suggest_incident },
    workouts: sessions.map(workoutView),
    verification: P.verifyWeek({ weekStart: week.start, workouts: sessions, days: answers.days }),
    note: 'Este es el plan base de RunFlow para la semana. Si lo cambias, mantén las reglas y explica el porqué en reason; create_week_proposal pasa el Verificador.',
  };
}
async function verifyWeekProposal(db, athleteId, weekStart, workouts, semaforo) {
  const days = await profileDays(db, athleteId);
  return P.verifyWeek({ weekStart, workouts, days, semaforo });
}

module.exports = { RULES, cleanAnswers, seasonPlan, seasonView, calendarWeeks, planningContext, previewSeason, seasonProposal, weekBase, verifyWeekProposal, libraryRows };
