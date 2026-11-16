'use strict';
// RunFlow · pasa a la escala de Intervals la carga ya guardada (una sola regla: public/js/load-scale.js).
//
// Antes parte de la carga planificada se guardaba en sRPE (minutos × RPE): 60' de fuerza = 300, 30' de trote = 60,
// mientras que lo hecho viene de Intervals (1 h al umbral ≈ 100). Al arrancar el servidor, este hook revisa una vez:
//   - workouts.planned_load (y las plantillas de sesiones),
//   - training_weeks.target_load (se escala igual que sus sesiones; sin sesiones, con sus horas),
//   - mesocycles.planned_load (con sus horas),
//   - actividades creadas por RunFlow a partir del feedback (runflow-feedback-*), con su RPE.
// Solo toca valores de 1,9 o más por minuto, que no pueden ser de Intervals, así que repetirlo no cambia nada.
// Se desactiva con RUNFLOW_LOAD_SCALE_MIGRATION=off.

const LoadScale = require('./public/js/load-scale.js');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const ENABLED = process.env.DEMO_MODE !== '1' && process.env.RUNFLOW_LOAD_SCALE_MIGRATION !== 'off' && SUPABASE_URL && KEY;
const PAGE = 1000;

async function sb(table, query, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method: options.method || 'GET',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: options.method ? 'return=minimal' : '' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  return options.method ? null : response.json();
}

async function all(table, select, filter = '') {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await sb(table, `select=${select}${filter ? `&${filter}` : ''}&order=id.asc&limit=${PAGE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const patch = (table, id, body) => sb(table, `id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body });
const kindOf = row => (row.is_strength ? 'Strength' : row.sport);

// Cálculo puro (también para los tests): qué filas cambian y a qué valor.
function plan({ workouts = [], weeks = [], mesocycles = [], templates = [], activities = [] }) {
  const out = { workouts: [], weeks: [], mesocycles: [], templates: [], activities: [] };
  const sums = new Map(); // training_week_id -> { before, after }
  for (const w of workouts) {
    const before = Number(w.planned_load) || 0;
    const after = Math.round(LoadScale.toIntervals(before, w.planned_duration_min, kindOf(w)) || 0);
    if (after !== before) out.workouts.push({ id: w.id, from: before, to: after });
    if (w.training_week_id) {
      const s = sums.get(String(w.training_week_id)) || { before: 0, after: 0 };
      s.before += before; s.after += after;
      sums.set(String(w.training_week_id), s);
    }
  }
  for (const week of weeks) {
    const target = Number(week.target_load) || 0;
    if (!target) continue;
    const s = sums.get(String(week.id));
    const to = s && s.before > 0
      ? Math.round(target * s.after / s.before)
      : Math.round(LoadScale.toIntervals(target, (Number(week.planned_hours) || 0) * 60) || 0);
    if (to !== target) out.weeks.push({ id: week.id, from: target, to });
  }
  for (const m of mesocycles) {
    const load = Number(m.planned_load) || 0;
    const to = Math.round(LoadScale.toIntervals(load, (Number(m.planned_hours) || 0) * 60) || 0);
    if (load && to !== load) out.mesocycles.push({ id: m.id, from: load, to });
  }
  for (const t of templates) {
    const data = t.template_data && typeof t.template_data === 'object' ? t.template_data : null;
    const load = Number(data?.planned_load);
    if (!data || !(load > 0)) continue;
    const to = Math.round(LoadScale.toIntervals(load, data.planned_duration_min, data.is_strength ? 'Strength' : data.sport) || 0);
    if (to !== load) out.templates.push({ id: t.id, from: load, to, template_data: { ...data, planned_load: to } });
  }
  for (const a of activities) {
    const load = Number(a.load), minutes = Number(a.duration_sec) / 60;
    if (!LoadScale.looksLikeSrpe(load, minutes)) continue;
    const rpe = Number(a.raw_summary?.rpe);
    const to = rpe > 0 ? LoadScale.fromRpe(minutes, rpe, a.sport) : Math.round(LoadScale.toIntervals(load, minutes, a.sport));
    if (to && to !== load) out.activities.push({ id: a.id, from: load, to });
  }
  return out;
}

async function migrate() {
  const [workouts, weeks, mesocycles, templates, activities] = await Promise.all([
    all('workouts', 'id,training_week_id,planned_load,planned_duration_min,sport,is_strength', 'planned_load=gt.0'),
    all('training_weeks', 'id,target_load,planned_hours', 'target_load=gt.0'),
    all('mesocycles', 'id,planned_load,planned_hours', 'planned_load=gt.0').catch(() => []),
    all('workout_templates', 'id,template_data').catch(() => []),
    all('activities', 'id,load,duration_sec,sport,raw_summary', 'intervals_activity_id=like.runflow-feedback-*&load=gt.0').catch(() => []),
  ]);
  const changes = plan({ workouts, weeks, mesocycles, templates, activities });
  for (const c of changes.workouts) await patch('workouts', c.id, { planned_load: c.to });
  for (const c of changes.weeks) await patch('training_weeks', c.id, { target_load: c.to });
  for (const c of changes.mesocycles) await patch('mesocycles', c.id, { planned_load: c.to });
  for (const c of changes.templates) await patch('workout_templates', c.id, { template_data: c.template_data });
  for (const c of changes.activities) await patch('activities', c.id, { load: c.to });
  const counts = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.length]));
  console.log(`[load-scale] carga pasada a escala Intervals: ${JSON.stringify(counts)}`);
  return changes;
}

if (ENABLED) {
  setTimeout(() => migrate().catch(error => console.error('[load-scale] no se pudo revisar la carga:', error.message)), 15000).unref?.();
}

module.exports = { plan, migrate };
