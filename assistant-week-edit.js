'use strict';

// Agente Planificador: cambios sobre semanas y sesiones que YA están en el
// calendario (añadir, cambiar, mover, quitar una sesión o vaciar la semana).
// El asistente nunca toca el calendario: guarda una propuesta "week_edit" que
// el entrenador aprueba en Ajustes › Conexiones › Propuestas pendientes.
// El Verificador revisa la semana resultante y bloquea la propuesta si el
// cambio introduce un fallo nuevo (los fallos que la semana ya tenía se avisan
// pero no bloquean, para poder corregir semanas que ya estaban mal).

const ACTIONS = ['add', 'modify', 'move', 'remove'];
// Campos de una sesión que se conservan al reescribir la semana completa.
const WORKOUT_FIELDS = ['workout_date', 'sport', 'title', 'summary', 'structured_description', 'planned_load', 'priority', 'planned_duration_min', 'planned_distance_km', 'planned_elevation_m', 'blocks', 'session_objective', 'adaptation_target', 'purpose', 'is_strength'];
const WEEK_FIELDS = ['week_type', 'title', 'coach_comment'];
const DONE_STATUSES = ['completed', 'partial', 'skipped', 'changed'];

function safe(value, max = 5000) { return String(value ?? '').trim().slice(0, max); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null; }
function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function isMonday(iso) { return new Date(`${iso}T12:00:00Z`).getUTCDay() === 1; }
function bad(message, status = 400) { return Object.assign(new Error(message), { status }); }
function num(value, max) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : null; }
function minutesOf(w) { return Number(w.planned_duration_min) > 0 ? `${Math.round(Number(w.planned_duration_min))} min` : ''; }
function label(w) { return [w.workout_date, w.title || 'Sesión', minutesOf(w)].filter(Boolean).join(' · '); }

function pickWorkout(row) {
  const out = { id: String(row.id) };
  for (const key of WORKOUT_FIELDS) if (row[key] !== undefined && row[key] !== null) out[key] = row[key];
  if (row.optional) out.optional = true;
  return out;
}

// Campos que el asistente puede escribir en una sesión (nueva o cambiada).
function cleanFields(source = {}) {
  const out = {};
  if (source.workout_date !== undefined) out.workout_date = validDate(source.workout_date);
  if (source.sport !== undefined) out.sport = safe(source.sport, 40) || 'Run';
  if (source.title !== undefined) out.title = safe(source.title, 160) || 'Sesión';
  if (source.summary !== undefined) out.summary = safe(source.summary, 3000);
  if (source.structured_description !== undefined) out.structured_description = safe(source.structured_description, 10000);
  if (source.planned_load !== undefined) out.planned_load = num(source.planned_load, 1000) || 0;
  if (source.priority !== undefined && ['A', 'B', 'C'].includes(source.priority)) out.priority = source.priority;
  if (source.planned_duration_min !== undefined) out.planned_duration_min = num(source.planned_duration_min, 2000);
  if (source.planned_distance_km !== undefined) out.planned_distance_km = num(source.planned_distance_km, 2000);
  if (source.planned_elevation_m !== undefined) out.planned_elevation_m = num(source.planned_elevation_m, 100000);
  if (Array.isArray(source.blocks)) out.blocks = source.blocks.slice(0, 30);
  for (const key of ['session_objective', 'adaptation_target', 'purpose']) if (source[key] !== undefined) out[key] = safe(source[key], 3000);
  if (typeof source.is_strength === 'boolean') out.is_strength = source.is_strength;
  if (source.optional !== undefined) out.optional = Boolean(source.optional);
  return out;
}

// Firma de la semana tal y como está: si cambia antes de aprobar, la propuesta caduca.
function signature(workouts) {
  return (workouts || []).map(w => `${w.id}@${w.updated_at || ''}`).sort().join('|');
}

function isDone(workout, doneIds) {
  return doneIds.has(String(workout.id)) || DONE_STATUSES.includes(workout.execution_status);
}

// Puro: aplica la lista de cambios a las sesiones actuales de la semana.
// current: filas de workouts (con id). Devuelve la semana resultante y un resumen legible.
function applyChanges({ weekStart, today, current = [], doneIds = new Set(), changes = [], clearWeek = false }) {
  const end = addDays(weekStart, 6);
  const errors = [];
  const summary = [];
  let workouts = current.map(pickWorkout);
  const byId = id => workouts.find(w => w.id === String(id));
  const locked = w => {
    if (isDone(w, doneIds)) return `“${label(w)}” ya está hecha (tiene actividad o registro). No se puede cambiar ni quitar.`;
    if (today && w.workout_date < today) return `“${label(w)}” es de un día pasado. No se puede cambiar ni quitar.`;
    return null;
  };
  const checkDate = (date, what) => {
    if (!date) { errors.push(`${what}: falta workout_date (YYYY-MM-DD).`); return false; }
    if (date < weekStart || date > end) { errors.push(`${what}: ${date} está fuera de la semana ${weekStart} – ${end}.`); return false; }
    if (today && date < today) { errors.push(`${what}: ${date} ya ha pasado.`); return false; }
    return true;
  };

  if (clearWeek) {
    const keep = [];
    for (const w of workouts) {
      if (locked(w)) { keep.push(w); continue; }
      summary.push(`Quitar: ${label(w)}`);
    }
    if (keep.length) summary.push(`Se mantienen ${keep.length} sesión(es) ya hechas o pasadas.`);
    workouts = keep;
  }

  (Array.isArray(changes) ? changes : []).slice(0, 30).forEach((raw, index) => {
    const change = raw && typeof raw === 'object' ? raw : {};
    const action = safe(change.action, 10).toLowerCase();
    const what = `Cambio ${index + 1}`;
    const why = safe(change.reason, 500);
    const suffix = why ? ` (${why})` : '';
    if (!ACTIONS.includes(action)) { errors.push(`${what}: action debe ser add, modify, move o remove.`); return; }
    if (action === 'add') {
      const fields = cleanFields({ ...(change.workout || {}), ...(change.workout_date ? { workout_date: change.workout_date } : {}) });
      if (!checkDate(fields.workout_date, what)) return;
      const added = { sport: 'Run', title: 'Sesión', summary: '', planned_load: 0, blocks: [], ...fields, id: `new-${index + 1}` };
      if (!added.structured_description) added.structured_description = added.summary;
      workouts.push(added);
      summary.push(`Añadir: ${label(added)}${suffix}`);
      return;
    }
    const target = byId(change.workout_id);
    if (!target) { errors.push(`${what}: no hay ninguna sesión con workout_id ${safe(change.workout_id, 80) || '(vacío)'} en esta semana. Usa get_week_sessions.`); return; }
    const lock = locked(target);
    if (lock) { errors.push(`${what}: ${lock}`); return; }
    if (action === 'remove') {
      workouts = workouts.filter(w => w !== target);
      summary.push(`Quitar: ${label(target)}${suffix}`);
      return;
    }
    const fields = action === 'move'
      ? cleanFields({ workout_date: change.workout_date ?? change.workout?.workout_date })
      : cleanFields({ ...(change.workout || {}), ...(change.workout_date ? { workout_date: change.workout_date } : {}) });
    if (fields.workout_date !== undefined && !checkDate(fields.workout_date, what)) return;
    if (!Object.keys(fields).length) { errors.push(`${what}: no dice qué cambiar de “${label(target)}”.`); return; }
    const before = label(target);
    Object.assign(target, fields);
    // Si cambia el texto pero no la descripción estructurada, que no quede la antigua.
    if (fields.summary !== undefined && fields.structured_description === undefined) target.structured_description = fields.summary;
    summary.push(`${action === 'move' ? 'Mover' : 'Cambiar'}: ${before} → ${label(target)}${suffix}`);
  });

  workouts.sort((a, b) => String(a.workout_date).localeCompare(String(b.workout_date)));
  return { workouts, summary, errors };
}

function failureKey(f) { return `${f.rule}|${f.date || ''}|${f.text}`; }
// Fallos que aparecen con el cambio y no estaban antes.
function newFailures(before, after) {
  const known = new Set((before?.failures || []).map(failureKey));
  return (after?.failures || []).filter(f => !known.has(failureKey(f)));
}

async function loadWeek(db, athleteId, weekStart) {
  const weeks = await db('training_weeks', `athlete_id=eq.${encodeURIComponent(athleteId)}&week_start=eq.${weekStart}&select=*&limit=1`);
  const week = weeks[0] || null;
  if (!week) return { week: null, workouts: [], doneIds: new Set() };
  const workouts = await db('workouts', `training_week_id=eq.${encodeURIComponent(week.id)}&select=*&order=workout_date.asc`);
  const ids = workouts.map(w => w.id);
  const doneIds = new Set();
  if (ids.length) {
    const [activities, logs] = await Promise.all([
      db('activities', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=in.(${ids.join(',')})&select=workout_id`),
      db('manual_session_logs', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=in.(${ids.join(',')})&select=workout_id,status`),
    ]);
    activities.forEach(a => doneIds.add(String(a.workout_id)));
    logs.filter(l => ['completed', 'partial', 'skipped'].includes(l.status)).forEach(l => doneIds.add(String(l.workout_id)));
  }
  return { week, workouts, doneIds };
}

function weekStartOf(value) {
  const date = validDate(value);
  if (!date) throw bad('Falta week_start (YYYY-MM-DD, el lunes de la semana).');
  if (!isMonday(date)) throw bad('week_start tiene que ser un lunes.');
  return date;
}

// Lectura para el asistente: la semana tal como está, con lo que se puede tocar.
async function weekSessions(db, athleteId, weekStartValue, today) {
  const weekStart = weekStartOf(weekStartValue);
  const { week, workouts, doneIds } = await loadWeek(db, athleteId, weekStart);
  return {
    week_start: weekStart,
    exists: Boolean(week),
    week: week ? { title: week.title, week_type: week.week_type, coach_comment: week.coach_comment, status: week.status, published: week.status === 'published' } : null,
    sessions: workouts.map(w => {
      const done = doneIds.has(String(w.id));
      const past = w.workout_date < today;
      return { workout_id: w.id, workout_date: w.workout_date, sport: w.sport, title: w.title, summary: w.summary, planned_duration_min: w.planned_duration_min, planned_distance_km: w.planned_distance_km, planned_elevation_m: w.planned_elevation_m, priority: w.priority, done, editable: !done && !past };
    }),
    how_to_change: 'Para cambiar la semana usa propose_week_changes con workout_id de esta lista. Las sesiones con editable=false (hechas o de días pasados) no se pueden tocar.',
  };
}

// Construye la propuesta. verify(workouts) => {ok, failures} con el Verificador de RunFlow.
async function buildWeekEdit(db, athleteId, body, today, verify) {
  const weekStart = weekStartOf(body.week_start);
  if (addDays(weekStart, 6) < today) throw bad('Esa semana ya ha terminado: no se puede cambiar.');
  const reason = safe(body.reason, 4000);
  if (!reason) throw bad('Explica en reason por qué se cambia la semana (lo leerá el entrenador).');
  const { week, workouts: current, doneIds } = await loadWeek(db, athleteId, weekStart);
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const clearWeek = body.clear_week === true;
  const weekChanges = {};
  for (const key of WEEK_FIELDS) if (body.week && body.week[key] !== undefined) weekChanges[key] = safe(body.week[key], key === 'coach_comment' ? 4000 : key === 'title' ? 250 : 80);
  if (!changes.length && !clearWeek && !Object.keys(weekChanges).length) throw bad('No hay cambios: usa changes, clear_week o week.');
  if (!week && current.length === 0 && changes.some(c => c && c.action && c.action !== 'add')) throw bad('Esa semana todavía no está en el calendario: solo se pueden añadir sesiones (o usa create_week_proposal).');

  const result = applyChanges({ weekStart, today, current, doneIds, changes, clearWeek });
  if (result.errors.length) return { rejected: true, errors: result.errors };

  const before = await verify(current.map(pickWorkout));
  const after = await verify(result.workouts);
  const blocking = newFailures(before, after);
  const verification = { ok: blocking.length === 0, failures: blocking, already_failing: before.failures || [] };
  if (!verification.ok) return { rejected: true, verification };

  const summary = [...result.summary];
  for (const [key, value] of Object.entries(weekChanges)) summary.push(`Semana · ${key === 'coach_comment' ? 'comentario' : key === 'week_type' ? 'tipo' : 'título'}: ${value || '(vacío)'}`);
  const published = week?.status === 'published';
  const weekData = {
    week_start: weekStart,
    week_type: week?.week_type || 'Carga controlada',
    title: week?.title || '',
    coach_comment: week?.coach_comment || '',
    ...weekChanges,
    workouts: result.workouts.map(w => (String(w.id).startsWith('new-') ? (({ id, ...rest }) => rest)(w) : w)),
  };
  weekData.target_load = weekData.workouts.reduce((sum, w) => sum + Number(w.planned_load || 0), 0);
  return {
    data: {
      kind: 'week_edit',
      status: 'proposed',
      origin: 'assistant',
      week_start: weekStart,
      title: safe(body.title, 250) || `Cambios en la semana del ${weekStart}`,
      reason,
      changes: summary,
      verification,
      base: { week_id: week?.id || null, published, signature: signature(current) },
      week: weekData,
      created_at: new Date().toISOString(),
    },
  };
}

module.exports = { ACTIONS, applyChanges, newFailures, signature, cleanFields, weekSessions, buildWeekEdit, loadWeek };
