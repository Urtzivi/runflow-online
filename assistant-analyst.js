'use strict';

// Agente Analista (Claude vía MCP). Aquí solo se juntan y calculan los datos
// (con el mismo motor que usa el Coach: efecto del entrenamiento, bloques,
// cumplimiento). El agente los interpreta y redacta el informe; nunca inventa
// números, todo lo que cita sale de aquí.
const I = require('./public/js/athlete-insights.js');
const TE = require('./public/js/training-effect.js');

const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const r1 = v => (v === null ? null : Math.round(v * 10) / 10);
const r0 = v => (v === null ? null : Math.round(v));
const enc = encodeURIComponent;
function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function monday(iso) { return I.isoMonday(iso); }
function clock(sec) { const s = num(sec); if (!s) return null; const t = Math.round(s); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; }
function pace(secPerKm) { const v = num(secPerKm); return v && v > 0 ? `${I.fmtPace(v)}/km` : null; }
function clean(obj) { return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))); }

const FEELING = { muy_bien: 'Muy bien', bien: 'Bien', normal: 'Normal', regular: 'Regular', mal: 'Mal', muy_mal: 'Muy mal' };

// Marcas internas que la app guarda en manual_session_logs.comment.
function payloadOf(comment, prefix) { const text = String(comment || ''); if (!text.startsWith(prefix)) return null; try { return JSON.parse(text.slice(prefix.length)); } catch { return null; } }
function checkinOf(log) { const p = payloadOf(log && log.comment, 'RUNFLOW_DAILY_CHECKIN:'); return p ? clean({ date: p.date, recuperacion_1a5: num(p.recovery_score), comentario: p.comment || null }) : null; }
function isInternalLog(log) { return /^RUNFLOW_[A-Z_]+:/.test(String(log && log.comment || '')); }

function plannedView(w) {
  if (!w) return null;
  const key = I.classifySession(w);
  return clean({
    workout_id: w.id, fecha: String(w.workout_date || '').slice(0, 10), titulo: w.title, deporte: w.sport, prioridad: w.priority,
    objetivo_sesion: w.session_objective || null, adaptacion_buscada: w.adaptation_target || null, para_que: w.purpose || null,
    resumen: w.summary || null, estructura: w.structured_description || null,
    minutos: num(w.planned_duration_min), km: num(w.planned_distance_km) || null, desnivel_m: num(w.planned_elevation_m) || null, carga: num(w.planned_load) || null,
    tipo_detectado: key, tipo_explicado: I.SESSION_INFO && I.SESSION_INFO[key] ? I.SESSION_INFO[key].label || null : null,
    para_que_sirve_este_tipo: I.SESSION_INFO && I.SESSION_INFO[key] ? I.SESSION_INFO[key].purpose || null : null,
    rpe_esperado: I.SESSION_INFO && I.SESSION_INFO[key] && Array.isArray(I.SESSION_INFO[key].rpe) ? I.SESSION_INFO[key].rpe.join('–') : null,
  });
}

function effectView(effect) {
  if (!effect) return null;
  if (!effect.available) return { disponible: false, motivo: effect.reason };
  return clean({
    disponible: true, titular: effect.headline, tipo: effect.kind, explicacion: effect.lines,
    respecto_al_plan: effect.plan ? { cumple: effect.plan.ok, texto: effect.plan.text } : null,
    estimulos: effect.stimuli.map(s => clean({ estimulo: s.label, que_mejora: s.what, minutos: r1(s.minutes), nivel: s.levelLabel, exceso: s.excess || null, maximo_util_min: s.max })),
    minutos_por_dominio: Object.fromEntries(TE.DOMAINS.map(d => [TE.DOMAIN_LABEL[d], r1(effect.minutes[d])])),
    tiempo: effect.timeline ? { total_min: r1(effect.timeline.elapsed), parado_min: r1(effect.timeline.stopped), sin_datos_min: r1(effect.timeline.noData) } : null,
    cortes_pulso_ppm: effect.cuts && effect.cuts.hr, cortes_ritmo: effect.cuts && effect.cuts.pace, metodo: effect.methodText,
  });
}

function blockView(b, run = true) {
  const cad = num(b.average_cadence);
  return clean({
    n: b.index, bloque: b.label, fase: b.phase, repeticion: b.repetition,
    plan: clean({ min: b.planned_duration_seconds ? r1(b.planned_duration_seconds / 60) : null, m: b.planned_distance_m, objetivo: b.planned_target }),
    hecho: clean({ min: b.duration_seconds ? r1(b.duration_seconds / 60) : null, m: r0(num(b.distance_m)), ritmo: b.pace || pace(b.pace_sec_per_km), pulso_medio: r0(num(b.average_hr)), pulso_max: r0(num(b.max_hr)), desnivel_m: r0(num(b.elevation_gain_m)), pendiente_media_pct: r1(num(b.average_gradient_percent)), cadencia: r0(cad && run && cad < 120 ? cad * 2 : cad) }),
    cumplido: b.completion_status, pct: b.completion_ratio != null ? Math.round(b.completion_ratio * 100) : null,
    pulso_inicio_fin: b.start_hr != null && b.end_hr != null ? `${r0(b.start_hr)} → ${r0(b.end_hr)}` : null,
    ritmo_1a_2a_mitad: b.first_half_pace_sec_per_km && b.second_half_pace_sec_per_km ? `${pace(b.first_half_pace_sec_per_km)} → ${pace(b.second_half_pace_sec_per_km)}` : null,
    pulso_1a_2a_mitad: b.first_half_hr && b.second_half_hr ? `${r0(b.first_half_hr)} → ${r0(b.second_half_hr)}` : null,
    variabilidad_ritmo_pct: r1(num(b.pace_variability_percent)),
  });
}

function blocksOf(analysis, run = true) {
  if (!analysis) return null;
  const list = Array.isArray(analysis) ? analysis : Array.isArray(analysis.blocks) ? analysis.blocks : [];
  if (!list.length) return null;
  return clean({ segmentacion: analysis.segmentation || null, bloques: list.map(b => blockView(b, run)), resumen: analysis.summary || null, lectura: Array.isArray(analysis.reading) ? analysis.reading : null });
}

function feedbackView(f) {
  if (!f) return null;
  return clean({ esfuerzo_rpe_1a10: num(f.rpe), sensacion: f.feeling ? FEELING[f.feeling] || String(f.feeling) : null, molestias_0a10: num(f.pain), zona_molestia: f.pain_area || null, comentario: f.comment || null, valorado_el: f.created_at || null });
}

function recoveryView(rows, date) {
  const list = (rows || []).filter(r => r && r.metric_date && String(r.metric_date).slice(0, 10) <= date).slice(-7);
  if (!list.length) return null;
  return list.map(r => clean({ fecha: String(r.metric_date).slice(0, 10), sueno_h: r1(num(r.sleep_hours)), vfc: r0(num(r.hrv)), pulso_reposo: r0(num(r.resting_hr)), forma_tsb: r0(num(r.form)), disposicion: r.readiness_score != null ? `${r.readiness_score} · ${r.readiness_label || ''}`.trim() : null }));
}

// Datos de una sesión para el informe. `detail` es lo que devuelve getActivityDetail.
function sessionFacts(detail, extra = {}) {
  const activity = detail.activity || {}; const raw = activity.raw_summary || {};
  const planned = detail.planned || null;
  const zones = detail.athlete_zones || { hr: [], pace: [] };
  const plannedKey = planned ? I.classifySession(planned) : null;
  let effect = null;
  try { effect = TE.analyse({ activity, athleteZones: zones, plannedKey }); } catch (error) { effect = { available: false, reason: `No se pudo calcular: ${error.message}` }; }
  const analysis = detail.block_analysis && Array.isArray(detail.block_analysis.blocks) && detail.block_analysis.blocks.length ? detail.block_analysis : null;
  let reading = [];
  try { reading = I.activityReading({ activity, planned, athleteZones: zones, analysis }); } catch { reading = []; }
  const moving = num(raw.moving_time), elapsed = num(raw.elapsed_time) || num(activity.duration_sec);
  const distance = num(activity.distance_m);
  const movingPace = moving && distance > 500 ? moving / (distance / 1000) : num(activity.avg_pace_sec_per_km);
  const gaps = [];
  if (!planned) gaps.push('Actividad sin sesión planificada asociada: no hay objetivo con el que comparar.');
  if (!detail.feedback) gaps.push('El atleta todavía no ha valorado esta actividad (sin RPE ni comentario).');
  if (effect && !effect.available) gaps.push(`Efecto del entrenamiento no disponible: ${effect.reason}`);
  if (!analysis) gaps.push('Sin análisis por bloques (sin estructura planificada o sin datos segundo a segundo).');
  return {
    atleta: extra.athlete || null,
    actividad: clean({
      id: activity.id, intervals_id: activity.intervals_activity_id, fecha: String(activity.activity_date || '').slice(0, 10), hora_inicio: raw.start_date_local ? String(raw.start_date_local).slice(11, 16) : null,
      nombre: activity.name, deporte: activity.sport || raw.type,
      km: distance ? r1(distance / 1000) : null, tiempo_total: clock(elapsed), tiempo_en_movimiento: clock(moving), parado_min: moving && elapsed && elapsed - moving >= 60 ? r1((elapsed - moving) / 60) : null,
      ritmo_medio_en_movimiento: pace(movingPace), ritmo_ajustado_pendiente_gap: pace(num(raw.gap) ? 1000 / num(raw.gap) : null),
      pulso_medio: r0(num(activity.avg_hr)), pulso_max: r0(num(activity.max_hr)), desnivel_m: r0(num(activity.elevation_gain_m ?? raw.total_elevation_gain)),
      carga_intervals: r0(num(activity.load)), trimp: r0(num(raw.trimp)), desacople_pct: r1(num(raw.decoupling)), eficiencia_ef: r1(num(raw.icu_efficiency_factor)),
      cadencia_media: r0(num(raw.average_cadence) ? num(raw.average_cadence) * (num(raw.average_cadence) < 120 ? 2 : 1) : null),
      temperatura_media: r0(num(raw.average_temp)), umbral_pulso_lthr: r0(num(raw.lthr)), ritmo_umbral: pace(num(raw.threshold_pace) ? 1000 / num(raw.threshold_pace) : null),
      rpe_reloj: num(raw.icu_rpe) ?? num(raw.session_rpe), sensacion_reloj_1a5: num(raw.feel), cumplimiento_intervals_pct: r0(num(raw.compliance)),
      fitness_ctl: r0(num(raw.icu_ctl)), fatiga_atl: r0(num(raw.icu_atl)), descripcion: raw.description || null,
    }),
    planificado: plannedView(planned),
    semana: extra.week || null,
    cumplimiento_pct: I.compliance(activity, planned),
    efecto_entrenamiento: effectView(effect),
    bloques: blocksOf(analysis, /run/i.test(String(activity.sport || raw.type || ''))),
    lectura_automatica: reading,
    valoracion_atleta: feedbackView(detail.feedback),
    chequeo_del_dia: extra.checkin || null,
    recuperacion_ultimos_dias: recoveryView(detail.recovery, String(activity.activity_date || '').slice(0, 10)),
    validacion_coach: detail.review ? clean({ estado: detail.review.status, comentario: detail.review.comment || detail.review.coach_comment || null }) : null,
    datos_que_faltan: gaps,
    _effect: effect,
  };
}

// Semana a la que pertenece una fecha + el objetivo que dejó el Planificador.
async function weekContext(sb, athleteId, date, proposals = null) {
  const weeks = await sb('training_weeks', `athlete_id=eq.${enc(athleteId)}&week_start=lte.${date}&end_date=gte.${date}&select=id,week_start,end_date,title,week_type,coach_comment,target_load,status&limit=1`);
  const week = weeks[0] || null;
  const weekStart = week ? String(week.week_start).slice(0, 10) : monday(date);
  const objective = proposals ? proposals.find(p => p.athlete_id === athleteId && String(p.week_start || '').slice(0, 10) === weekStart && p.kind !== 'season' && p.kind !== 'week_edit' && ['approved', 'applied', 'proposed'].includes(p.status)) : null;
  return clean({
    lunes: weekStart, id: week && week.id, titulo: week && week.title, tipo: week && week.week_type, estado: week && week.status, carga_objetivo: week && num(week.target_load),
    objetivo_que_ve_el_atleta: week && week.coach_comment || null,
    objetivo_del_planificador: objective ? clean({ para_el_atleta: objective.objetivo_atleta, explicacion: objective.objetivo_coach || objective.reason, estado_propuesta: objective.status }) : null,
  });
}

function checkinFor(logs, date) {
  for (const log of logs || []) { const c = checkinOf(log); if (c && c.date === date) return c; }
  return null;
}

async function logsBetween(sb, athleteId, oldest, newest) {
  return sb('manual_session_logs', `athlete_id=eq.${enc(athleteId)}&created_at=gte.${oldest}T00:00:00Z&created_at=lt.${addDays(newest, 1)}T12:00:00Z&select=*&order=created_at.asc`);
}

async function sessionAnalysis({ sb, detail, proposals }, coachId, athleteId, activityRef) {
  const ref = String(activityRef || '').trim();
  const column = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref) ? 'id' : 'intervals_activity_id';
  const rows = await sb('activities', `athlete_id=eq.${enc(athleteId)}&${column}=eq.${enc(ref)}&select=id,intervals_activity_id,activity_date&limit=1`);
  const row = rows[0];
  if (!row) throw Object.assign(new Error('Actividad no encontrada para este deportista.'), { status: 404 });
  if (!row.intervals_activity_id) throw Object.assign(new Error('La actividad no viene de Intervals: no hay datos para analizarla a fondo.'), { status: 409 });
  const date = String(row.activity_date).slice(0, 10);
  const [d, athlete, props, logs] = await Promise.all([
    detail(coachId, athleteId, row.intervals_activity_id),
    sb('athletes', `id=eq.${enc(athleteId)}&select=id,display_name&limit=1`),
    proposals(coachId).catch(() => []),
    logsBetween(sb, athleteId, date, date).catch(() => []),
  ]);
  const week = await weekContext(sb, athleteId, date, props);
  const facts = sessionFacts(d, { athlete: athlete[0] || { id: athleteId }, week, checkin: checkinFor(logs, date) });
  delete facts._effect;
  return facts;
}

// Actividades recientes de todos los atletas y si ya tienen informe del Analista.
async function sessionsToAnalyze({ sb, listDrafts }, coachId, athletes, days, today) {
  const span = Math.max(1, Math.min(14, Number(days) || 2));
  const oldest = addDays(today, -(span - 1));
  if (!athletes.length) return { desde: oldest, hasta: today, pendientes: [], ya_analizadas: 0 };
  const ids = athletes.map(a => a.id);
  const [acts, drafts] = await Promise.all([
    sb('activities', `athlete_id=in.(${ids.join(',')})&activity_date=gte.${oldest}&activity_date=lt.${addDays(today, 1)}&select=id,athlete_id,intervals_activity_id,activity_date,name,sport,duration_sec,distance_m,workout_id&order=activity_date.asc`),
    listDrafts(coachId, { status: 'all', kind: 'session', limit: 200 }),
  ]);
  const done = new Set(drafts.filter(d => d.informe_coach).flatMap(d => [String(d.activity_id)]));
  const names = Object.fromEntries(athletes.map(a => [a.id, a.display_name]));
  const pending = [], analysed = [];
  for (const a of acts) {
    const item = clean({ athlete_id: a.athlete_id, atleta: names[a.athlete_id], activity_id: a.intervals_activity_id || a.id, fecha: String(a.activity_date).slice(0, 10), nombre: a.name, deporte: a.sport, minutos: a.duration_sec ? Math.round(a.duration_sec / 60) : null, km: a.distance_m ? r1(a.distance_m / 1000) : null, planificada: Boolean(a.workout_id), analizable: Boolean(a.intervals_activity_id) });
    if (done.has(String(a.intervals_activity_id)) || done.has(String(a.id))) analysed.push(item); else pending.push(item);
  }
  return { desde: oldest, hasta: today, pendientes: pending, ya_analizadas: analysed.length };
}

// Semana completa: plan vs hecho, efecto acumulado, sensaciones y recuperación.
async function weekReview({ sb, detail, proposals, listDrafts }, coachId, athleteId, weekStartRaw) {
  const weekStart = monday(String(weekStartRaw || '').slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw Object.assign(new Error('week_start debe ser YYYY-MM-DD.'), { status: 400 });
  const weekEnd = addDays(weekStart, 6);
  const [athlete, weekRows, acts, logs, props, drafts, history, metrics] = await Promise.all([
    sb('athletes', `id=eq.${enc(athleteId)}&select=id,display_name&limit=1`),
    sb('training_weeks', `athlete_id=eq.${enc(athleteId)}&week_start=eq.${weekStart}&select=id,week_start,title,week_type,coach_comment,target_load,status&limit=1`),
    sb('activities', `athlete_id=eq.${enc(athleteId)}&activity_date=gte.${weekStart}&activity_date=lt.${addDays(weekEnd, 1)}&select=*&order=activity_date.asc`),
    logsBetween(sb, athleteId, weekStart, weekEnd).catch(() => []),
    proposals(coachId).catch(() => []),
    listDrafts(coachId, { status: 'all', athlete_id: athleteId, kind: 'session', limit: 200 }).catch(() => []),
    sb('activities', `athlete_id=eq.${enc(athleteId)}&activity_date=gte.${addDays(weekStart, -28)}&activity_date=lt.${addDays(weekEnd, 1)}&select=activity_date,sport,duration_sec,distance_m,elevation_gain_m,load,raw_summary&order=activity_date.asc`).catch(() => []),
    sb('daily_metrics', `athlete_id=eq.${enc(athleteId)}&metric_date=gte.${addDays(weekStart, -28)}&metric_date=lte.${weekEnd}&select=*&order=metric_date.asc`).catch(() => []),
  ]);
  const week = weekRows[0] || null;
  const workouts = week ? await sb('workouts', `training_week_id=eq.${enc(week.id)}&select=*&order=workout_date.asc`) : [];
  const context = await weekContext(sb, athleteId, weekStart, props);

  const sessions = [];
  const domainMin = Object.fromEntries(TE.DOMAINS.map(d => [d, 0]));
  for (const a of acts) {
    let facts = null;
    if (a.intervals_activity_id) {
      try { facts = sessionFacts(await detail(coachId, athleteId, a.intervals_activity_id)); } catch (error) { facts = { error: error.message }; }
    }
    const effect = facts && facts._effect;
    if (effect && effect.available) TE.DOMAINS.forEach(d => { domainMin[d] += effect.minutes[d] || 0; });
    const report = drafts.find(d => String(d.activity_id) === String(a.intervals_activity_id) || String(d.activity_id) === String(a.id));
    sessions.push(clean({
      fecha: String(a.activity_date).slice(0, 10), nombre: a.name, deporte: a.sport, workout_id: a.workout_id,
      km: a.distance_m ? r1(a.distance_m / 1000) : null, minutos: a.duration_sec ? Math.round(a.duration_sec / 60) : null, desnivel_m: r0(num(a.elevation_gain_m)), carga: r0(num(a.load)), pulso_medio: r0(num(a.avg_hr)),
      cumplimiento_pct: facts && facts.cumplimiento_pct, efecto: facts && facts.efecto_entrenamiento ? clean({ titular: facts.efecto_entrenamiento.titular, respecto_al_plan: facts.efecto_entrenamiento.respecto_al_plan, estimulos: (facts.efecto_entrenamiento.estimulos || []).filter(s => s.nivel && s.nivel !== 'Sin efecto') }) : null,
      valoracion_atleta: facts && facts.valoracion_atleta, informe_analista: report ? clean({ semaforo: report.semaforo, objetivo_cumplido: report.objetivo_cumplido, efecto_principal: report.efecto_principal, resumen: report.resumen }) : null,
      error: facts && facts.error,
    }));
  }

  const planned = workouts.map(w => {
    const date = String(w.workout_date).slice(0, 10);
    const done = acts.find(a => String(a.workout_id) === String(w.id)) || null;
    return clean({ ...plannedView(w), hecha: Boolean(done), actividad: done ? done.name : null, cumplimiento_pct: done ? I.compliance(done, w) : null, dia_pasado: date < I.addDaysIso(weekEnd, 1) });
  });
  const plannedMin = workouts.reduce((s, w) => s + (num(w.planned_duration_min) || 0), 0);
  const doneMin = acts.reduce((s, a) => s + (num(a.duration_sec) || 0) / 60, 0);
  const rpes = [], pains = [], comments = [], checkins = [];
  for (const log of logs) {
    const c = checkinOf(log); if (c) { if (c.date >= weekStart && c.date <= weekEnd) checkins.push(c); continue; }
    if (isInternalLog(log)) continue;
    if (num(log.rpe)) rpes.push(num(log.rpe));
    if (num(log.pain) !== null) pains.push(num(log.pain));
    const text = String(log.comment || '').replace(/^RUNFLOW_[A-Z_]+:.*/, '').trim();
    if (text) comments.push(clean({ fecha: String(log.created_at).slice(0, 10), rpe: num(log.rpe), molestias: num(log.pain), zona: log.pain_area || null, comentario: text.slice(0, 600) }));
  }
  const evo = I.weeklyEvolution(history, weekEnd, 5).weeks.map(w => ({ lunes: w.week_start, km: w.km, minutos: Math.round(w.duration_sec / 60), desnivel_m: w.elevation_m, carga: w.load, sesiones: w.sessions, min_suave: Math.round(w.zone_easy_sec / 60), min_medio: Math.round(w.zone_mid_sec / 60), min_duro: Math.round(w.zone_hard_sec / 60) }));
  const weekMetrics = metrics.filter(m => String(m.metric_date).slice(0, 10) >= weekStart);
  const baseMetrics = metrics.filter(m => String(m.metric_date).slice(0, 10) < weekStart);
  const avg = (rows, k) => { const v = rows.map(r => num(r[k])).filter(x => x !== null); return v.length ? r1(v.reduce((s, x) => s + x, 0) / v.length) : null; };

  const gaps = [];
  if (!week) gaps.push('No hay semana planificada en el calendario para estas fechas.');
  if (!acts.length) gaps.push('No hay actividades registradas esta semana.');
  if (!rpes.length) gaps.push('El atleta no ha valorado ninguna sesión esta semana.');

  return {
    atleta: athlete[0] || { id: athleteId },
    semana: { ...context, del: weekStart, al: weekEnd },
    totales: clean({
      sesiones_planificadas: workouts.length, sesiones_hechas_del_plan: planned.filter(p => p.hecha).length, actividades: acts.length,
      minutos_planificados: Math.round(plannedMin), minutos_hechos: Math.round(doneMin), cumplimiento_minutos_pct: plannedMin ? Math.round((doneMin / plannedMin) * 100) : null,
      km: r1(acts.reduce((s, a) => s + (num(a.distance_m) || 0), 0) / 1000), desnivel_m: r0(acts.reduce((s, a) => s + (num(a.elevation_gain_m) || 0), 0)), carga: r0(acts.reduce((s, a) => s + (num(a.load) || 0), 0)),
    }),
    efecto_acumulado_min: Object.fromEntries(TE.DOMAINS.map(d => [TE.DOMAIN_LABEL[d], r1(domainMin[d])])),
    sesiones_planificadas: planned,
    actividades: sessions,
    sensaciones: clean({ rpe_medio: rpes.length ? r1(rpes.reduce((s, x) => s + x, 0) / rpes.length) : null, molestias_max: pains.length ? Math.max(...pains) : null, comentarios: comments }),
    chequeos_diarios: checkins,
    recuperacion: clean({ sueno_h_semana: avg(weekMetrics, 'sleep_hours'), sueno_h_4_semanas_antes: avg(baseMetrics, 'sleep_hours'), vfc_semana: avg(weekMetrics, 'hrv'), vfc_4_semanas_antes: avg(baseMetrics, 'hrv'), pulso_reposo_semana: avg(weekMetrics, 'resting_hr'), pulso_reposo_antes: avg(baseMetrics, 'resting_hr'), forma_tsb_final: weekMetrics.length ? r0(num(weekMetrics[weekMetrics.length - 1].form)) : null }),
    ultimas_5_semanas: evo,
    datos_que_faltan: gaps,
  };
}

module.exports = { sessionFacts, sessionAnalysis, sessionsToAnalyze, weekReview, weekContext, checkinOf, addDays, monday };
