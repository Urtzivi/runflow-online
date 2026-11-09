'use strict';

// Agente Prepartido: lee (solo lectura) los partidos de un futbolista desde su
// programa de fútbol, con lo que tiene el día antes y el mismo día, para que el
// asistente compruebe que la hora del partido está metida y prepare las comidas.
const Schedule = require('./public/js/football-schedule.js');

const PROGRAM_CATEGORY = '__runflow_football_program__';
const DAYS_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null; }
function clampDays(value) { const n = Number(value); return Number.isFinite(n) ? Math.min(28, Math.max(1, Math.round(n))) : 10; }

function dayItems(days, date) {
  const day = days.find(d => d.date === date);
  return (day?.items || []).filter(i => i.kind !== 'rest').map(i => ({
    tipo: Schedule.KIND_LABEL[i.kind] || i.kind, titulo: i.title, hora: i.time || null, duracion_min: i.duration_min || null,
  }));
}

// program: template_data del programa de fútbol (o null). today: YYYY-MM-DD en Madrid.
function matchesFromProgram(program, today, daysAhead) {
  const to = Schedule.addDays(today, clampDays(daysAhead) - 1);
  if (!program) return { tiene_programa_futbol: false, desde: today, hasta: to, partidos: [], proximo_partido: null };
  const days = Schedule.resolvePlan(program, Schedule.addDays(today, -1), Schedule.addDays(to, 1));
  const partidos = Schedule.sanitizeSchedule(program.schedule).events
    .filter(e => e.kind === 'match' && e.date >= today && e.date <= to)
    .map(e => ({
      fecha: e.date, dia: DAYS_ES[Schedule.dayIndex(e.date)], dias_hasta: Schedule.daysBetween(today, e.date),
      hora: e.time || null, hora_metida: Boolean(e.time), duracion_min: e.duration_min || 70,
      rival: e.rival || null, en_casa: e.home !== false, importancia: Schedule.IMPORTANCE[e.importance] || null,
      lugar: e.place || null, nota: e.note || null,
      dia_anterior: dayItems(days, Schedule.addDays(e.date, -1)),
      mismo_dia: dayItems(days, e.date).filter(i => i.tipo !== Schedule.KIND_LABEL.match),
    }));
  return { tiene_programa_futbol: true, desde: today, hasta: to, partidos, proximo_partido: partidos[0] || null };
}

async function footballMatches(sb, athleteId, args, today) {
  const from = validDate(args?.from) || today;
  const found = await sb('workout_templates', `athlete_id=eq.${encodeURIComponent(athleteId)}&category=eq.${encodeURIComponent(PROGRAM_CATEGORY)}&select=template_data,updated_at&order=updated_at.desc&limit=1`);
  return { hoy: today, ...matchesFromProgram(found[0]?.template_data || null, from, args?.days) };
}

// ---------- valoraciones de fútbol (lo que el futbolista escribe después) ----------
const LOG_PREFIX = 'RF_FOOTBALL|';
const FEEDBACK_KINDS = ['match', 'football_training', 'strength', 'wellbeing'];
const RESULT_ES = { win: 'ganado', draw: 'empate', loss: 'perdido' };
const ROLE_ES = { starter: 'titular', sub: 'suplente' };
function parseLogMeta(comment) {
  const text = String(comment || '');
  if (!text.startsWith(LOG_PREFIX)) return null;
  try { return JSON.parse(text.slice(LOG_PREFIX.length)); } catch { return null; }
}
function madridDate(value) {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const keep = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''));
function matchDetail(m) {
  if (!m || typeof m !== 'object') return null;
  const preguntas = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`q${i + 1}`, m[`q${i + 1}`]]).filter(([, v]) => v));
  return keep({
    resultado: RESULT_ES[m.result] || null, goles_a_favor: m.goals_for, goles_en_contra: m.goals_against,
    rol: ROLE_ES[m.role] || null, posicion: m.position, nota_que_se_pone: m.rating,
    tecnica: m.technique, decisiones: m.decisions, defensa: m.defense, confianza: m.confidence, disfrute: m.enjoyment,
    goles: m.goals, asistencias: m.assists, lo_mejor: m.best, a_mejorar: m.improve, su_relato: m.story,
    esfuerzo_0_10: m.effort, piernas_0_10: m.legs, energia_antes_0_10: m.energy_pre, se_sintio_bien_en: m.felt_good, probara_la_proxima: m.try_next,
    mi_partido_por_dentro: Object.keys(preguntas).length ? preguntas : null,
  });
}
function feedbackFromLog(log) {
  const meta = log.football || parseLogMeta(log.comment);
  if (!meta || !FEEDBACK_KINDS.includes(meta.kind)) return null;
  return keep({
    id: log.id, tipo: Schedule.KIND_LABEL[meta.kind] || (meta.kind === 'wellbeing' ? 'Bienestar' : meta.kind), kind: meta.kind,
    fecha: meta.plan_date || madridDate(log.created_at), escrito_el: log.created_at, titulo: meta.title,
    minutos_jugados: meta.minutes_played, duracion_min: meta.kind === 'match' ? null : log.actual_duration_min,
    rpe_1_10: log.rpe, sensacion: log.feeling, dolor_0_10: log.pain, zona_dolor: log.pain_area,
    cuerpo_1_4: meta.body_state, animo_1_5: meta.mood, energia_1_5: meta.energy, agujetas_1_5: meta.soreness,
    comentario: meta.note, partido: meta.kind === 'match' ? matchDetail(meta.match) : null,
  });
}
// logs: filas de manual_session_logs; program: programa de fútbol (para saber qué partidos faltan por valorar).
function feedbackSummary(logs, program, from, to) {
  const valoraciones = (logs || []).map(feedbackFromLog).filter(f => f && f.fecha >= from && f.fecha <= to)
    .sort((a, b) => String(a.escrito_el).localeCompare(String(b.escrito_el)));
  const matches = program ? Schedule.sanitizeSchedule(program.schedule).events.filter(e => e.kind === 'match' && e.date >= from && e.date <= to) : [];
  const partidos = matches.map(e => {
    const v = valoraciones.filter(f => f.kind === 'match' && f.fecha === e.date);
    return { fecha: e.date, hora: e.time || null, rival: e.rival || null, en_casa: e.home !== false, valorado: v.length > 0 };
  });
  const alertas = valoraciones.filter(f => Number(f.dolor_0_10) >= 4).map(f => `Dolor ${f.dolor_0_10}/10${f.zona_dolor ? ` en ${f.zona_dolor}` : ''} (${f.tipo}, ${f.fecha}).`);
  return { desde: from, hasta: to, partidos, partidos_sin_valorar: partidos.filter(p => !p.valorado), valoraciones, alertas };
}
async function footballFeedback(sb, athleteId, args, today) {
  const to = validDate(args?.to) || today;
  const n = Number(args?.days); const days = Number.isFinite(n) ? Math.min(28, Math.max(1, Math.round(n))) : 3;
  const from = validDate(args?.from) || Schedule.addDays(to, -(days - 1));
  const [program, logs] = await Promise.all([
    sb('workout_templates', `athlete_id=eq.${encodeURIComponent(athleteId)}&category=eq.${encodeURIComponent(PROGRAM_CATEGORY)}&select=template_data,updated_at&order=updated_at.desc&limit=1`),
    sb('manual_session_logs', `athlete_id=eq.${encodeURIComponent(athleteId)}&created_at=gte.${Schedule.addDays(from, -1)}T00:00:00Z&select=*&order=created_at.asc&limit=200`),
  ]);
  return { hoy: today, ...feedbackSummary(logs, program[0]?.template_data || null, from, to) };
}

module.exports = { footballMatches, matchesFromProgram, footballFeedback, feedbackSummary, feedbackFromLog, PROGRAM_CATEGORY };
