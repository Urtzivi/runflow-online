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

module.exports = { footballMatches, matchesFromProgram, PROGRAM_CATEGORY };
