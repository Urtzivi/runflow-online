'use strict';

// Carreras de un atleta para el asistente (Planificador).
// - listRaces: objetivos (tabla goals, en cualquier estado), carreras intermedias
//   de la temporada guiada (other_races en las notas del macrociclo) y sesiones
//   futuras que se quedaron fuera de la temporada en curso (restos de planes viejos).
// - removeRace: quita una carrera que el entrenador ha pedido borrar: el objetivo
//   (goals) y, si está, su entrada en other_races de la temporada guiada, para que
//   el motor deje de tenerla en cuenta. Las sesiones sueltas se quitan con
//   apply_week_changes (action remove), que también limpia Intervals.

const MARKER = 'RUNFLOW_GUIDED_RUN_PLAN';

const enc = encodeURIComponent;
function safe(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null; }
function bad(message, status = 400) { return Object.assign(new Error(message), { status }); }
function norm(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }

function readAnswers(notes) {
  const text = String(notes || '');
  const index = text.indexOf(MARKER);
  if (index < 0) return null;
  try { return JSON.parse(text.slice(index + MARKER.length).trim().split('\n')[0]); } catch { return null; }
}
// Reescribe solo la línea JSON que va detrás del marcador; el resto de notas (incidencias, etc.) se queda igual.
function writeAnswers(notes, answers) {
  const text = String(notes || '');
  const index = text.indexOf(MARKER);
  if (index < 0) return text;
  const head = text.slice(0, index + MARKER.length);
  const rest = text.slice(index + MARKER.length).replace(/^\s*\n?/, '');
  const newline = rest.indexOf('\n');
  const tail = newline < 0 ? '' : rest.slice(newline);
  return `${head}\n${JSON.stringify(answers)}${tail}`;
}
function sameRace(a, b) {
  const na = norm(a.name), nb = norm(b.name);
  const nameMatch = na && nb && (na === nb || na.includes(nb) || nb.includes(na));
  const dateMatch = a.date && b.date && a.date === b.date;
  return Boolean(nameMatch || dateMatch);
}

async function guidedMacros(db, athleteId, today) {
  const macros = await db('macrocycles', `athlete_id=eq.${enc(athleteId)}&end_date=gte.${today}&select=id,season_id,name,notes,goal_id,start_date,end_date&order=start_date.asc`).catch(() => []);
  return macros.filter(m => readAnswers(m.notes));
}

async function listRaces(db, athleteId, today) {
  const [goals, macros] = await Promise.all([
    db('goals', `athlete_id=eq.${enc(athleteId)}&select=id,name,goal_date,status,priority_code,event_type,season_id,distance_km,elevation_m&order=goal_date.asc`).catch(() => []),
    guidedMacros(db, athleteId, today),
  ]);
  const seasonRaces = macros.flatMap(m => (readAnswers(m.notes)?.other_races || []).map(r => ({ macro_id: m.id, plan: m.name, name: r.name, date: r.date, km: r.km, elevation: r.elevation })));
  // Sesiones futuras que no cuelgan de la temporada guiada en curso.
  let outside = [];
  try {
    const mesos = macros.length ? await db('mesocycles', `athlete_id=eq.${enc(athleteId)}&macrocycle_id=in.(${macros.map(m => m.id).join(',')})&select=id`) : [];
    const weeks = mesos.length ? await db('training_weeks', `athlete_id=eq.${enc(athleteId)}&mesocycle_id=in.(${mesos.map(m => m.id).join(',')})&select=id`) : [];
    const own = new Set(weeks.map(w => String(w.id)));
    const future = await db('workouts', `athlete_id=eq.${enc(athleteId)}&workout_date=gte.${today}&select=id,workout_date,title,sport,training_week_id&order=workout_date.asc&limit=200`);
    outside = future.filter(w => !own.has(String(w.training_week_id || ''))).slice(0, 40)
      .map(w => ({ workout_id: w.id, workout_date: w.workout_date, title: w.title, sport: w.sport }));
  } catch { outside = []; }
  return {
    goals: goals.map(g => ({ goal_id: g.id, name: g.name, date: g.goal_date, status: g.status, priority: g.priority_code, type: g.event_type, km: g.distance_km, elevation: g.elevation_m })),
    season_races: seasonRaces,
    sessions_outside_plan: outside,
    note: 'Para borrar una carrera: remove_race con goal_id (objetivo) y/o name+date (carrera de la temporada). Las sesiones sueltas se quitan con apply_week_changes (action remove).',
  };
}

async function removeRace(db, athleteId, body, today) {
  const goalId = safe(body.goal_id, 80);
  let name = safe(body.name, 160), date = validDate(body.date);
  if (!goalId && !name && !date) throw bad('Indica goal_id o el nombre/fecha de la carrera.');
  const removed = { goals: [], season_races: [] };
  if (goalId) {
    const rows = await db('goals', `id=eq.${enc(goalId)}&athlete_id=eq.${enc(athleteId)}&select=id,name,goal_date,priority_code`);
    if (!rows.length) throw bad('Objetivo no encontrado.', 404);
    const goal = rows[0];
    if (!name) name = goal.name || '';
    if (!date) date = validDate(goal.goal_date);
    await db('macrocycles', `athlete_id=eq.${enc(athleteId)}&goal_id=eq.${enc(goalId)}`, { method: 'PATCH', body: { goal_id: null }, prefer: 'return=minimal' }).catch(() => []);
    await db('goals', `id=eq.${enc(goalId)}&athlete_id=eq.${enc(athleteId)}`, { method: 'DELETE', prefer: 'return=minimal' });
    removed.goals.push({ goal_id: goal.id, name: goal.name, date: goal.goal_date });
  }
  const target = { name, date };
  for (const macro of await guidedMacros(db, athleteId, today)) {
    const answers = readAnswers(macro.notes);
    const races = Array.isArray(answers.other_races) ? answers.other_races : [];
    const keep = races.filter(r => !sameRace(r, target));
    if (keep.length === races.length) continue;
    const notes = writeAnswers(macro.notes, { ...answers, other_races: keep });
    await db('macrocycles', `id=eq.${enc(macro.id)}&athlete_id=eq.${enc(athleteId)}`, { method: 'PATCH', body: { notes }, prefer: 'return=minimal' });
    races.filter(r => sameRace(r, target)).forEach(r => removed.season_races.push({ macro_id: macro.id, name: r.name, date: r.date }));
  }
  if (!removed.goals.length && !removed.season_races.length) throw bad('No he encontrado esa carrera en los objetivos ni en la temporada.', 404);
  return { removed };
}

module.exports = { listRaces, removeRace, readAnswers, writeAnswers, sameRace };
