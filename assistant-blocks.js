'use strict';

// Bloques de una sesión que escribe el Asistente (Planificador). Intervals y la
// app construyen la sesión SOLO con los bloques: si falta el bloque principal,
// a Intervals llega "calentamiento + vuelta a la calma" y la duración sale mal
// (le pasó a Saioa el 9-11-2026). Aquí se normalizan los nombres que el agente
// suele usar y el Verificador comprueba que la sesión está completa.

const TYPE_ALIASES = {
  warmup: 'warmup', warm_up: 'warmup', 'warm-up': 'warmup', calentamiento: 'warmup',
  cooldown: 'cooldown', cool_down: 'cooldown', 'cool-down': 'cooldown', vuelta_calma: 'cooldown', 'vuelta a la calma': 'cooldown', enfriamiento: 'cooldown',
  activation: 'activation', activacion: 'activation', 'activación': 'activation', strides: 'activation', aceleraciones: 'activation', progresivos: 'activation',
  central: 'central', main: 'central', interval: 'central', intervals: 'central', series: 'central', repeats: 'central', work: 'central', principal: 'central', bloque_principal: 'central', 'bloque principal': 'central',
  steady: 'steady', easy: 'steady', continuous: 'steady', continuo: 'steady', rodaje: 'steady', run: 'steady', tempo: 'steady',
};
const MAIN_TYPES = ['central', 'steady'];
const MAX_DESCRIPTION = 450;

// Solo se comprueban las sesiones que escribe el asistente en esta llamada
// (las que ya estaban en el calendario no bloquean un cambio que no las toca).
const TO_CHECK = new WeakSet();
function markForCheck(workout) { if (workout && typeof workout === 'object') TO_CHECK.add(workout); return workout; }

const num = value => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const isStrength = w => Boolean(w?.is_strength) || /strength|fuerza|weight|gym/i.test(String(w?.sport || ''));

function normaliseBlock(block) {
  if (!block || typeof block !== 'object') return null;
  const raw = String(block.type || '').trim().toLowerCase();
  const type = TYPE_ALIASES[raw] || raw;
  const out = { ...block, type };
  const minutes = num(block.duration_min) ?? num(block.minutes) ?? num(block.duration_minutes) ?? num(block.duration);
  if (['warmup', 'cooldown'].includes(type) && minutes !== null) out.duration_min = minutes;
  if (type === 'steady' && out.duration_min == null && out.work_value == null && minutes !== null) out.duration_min = minutes;
  if (type === 'central') {
    if (out.repetitions == null && block.reps != null) out.repetitions = num(block.reps);
    if (out.work_value == null && minutes !== null && block.work_value == null) { out.work_value = minutes; out.work_unit = out.work_unit || 'm'; }
  }
  if (type === 'activation') {
    if (out.repetitions == null && block.reps != null) out.repetitions = num(block.reps);
  }
  delete out.minutes; delete out.duration_minutes; delete out.reps;
  if (type !== 'steady' && type !== 'central' && out.duration !== undefined && out.duration_min !== undefined) delete out.duration;
  return out;
}

function normaliseBlocks(blocks) {
  return Array.isArray(blocks) ? blocks.slice(0, 30).map(normaliseBlock).filter(Boolean) : [];
}

// Minutos que suman los bloques (misma cuenta que server.js structuredWorkoutDurationMin).
// null si no se puede calcular (por ejemplo, series en km).
function blocksMinutes(blocks) {
  let seconds = 0;
  for (const block of blocks || []) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'warmup' || block.type === 'cooldown') seconds += (num(block.duration_min) || 0) * 60;
    else if (block.type === 'activation') {
      const reps = Math.max(1, Math.round(Number(block.repetitions || 1)));
      seconds += reps * ((num(block.work_sec) || 0) + (num(block.recovery_sec) || 0));
    } else if (block.type === 'central') {
      if (String(block.work_unit || 'm') === 'km') return null;
      const reps = Math.max(1, Math.round(Number(block.repetitions || 1)));
      seconds += reps * (num(block.work_value) || 0) * (String(block.work_unit || 'm') === 's' ? 1 : 60);
      if (reps > 1) seconds += reps * (num(block.recovery_value) || 0) * (String(block.recovery_unit || 'm') === 's' ? 1 : 60);
    } else if (block.type === 'steady') {
      if (!block.duration_min && String(block.work_unit || 'm') === 'km') return null;
      seconds += (num(block.duration_min) ?? num(block.work_value) ?? 0) * (block.duration_min || String(block.work_unit || 'm') !== 's' ? 60 : 1);
    }
  }
  return seconds > 0 ? Math.round(seconds / 60) : null;
}

// Fallos del Verificador por sesión: bloques incompletos y duración que no cuadra.
// (El largo del texto va como pauta en la descripción de las herramientas: la biblioteca
// de RunFlow ya tiene textos de ~500 caracteres y no queremos bloquearlos.)
function blockFailures(workouts) {
  const failures = [];
  for (const w of workouts || []) {
    if (!w || !TO_CHECK.has(w) || isStrength(w)) continue;
    const label = `${w.workout_date || ''} “${w.title || 'Sesión'}”`;
    const blocks = (w.blocks || []).filter(b => b && b.type !== 'runflow_meta');
    if (!blocks.some(b => MAIN_TYPES.includes(b.type))) {
      failures.push({ rule: 'bloques', date: w.workout_date, text: `${label}: falta el bloque principal en blocks (type "central" para series o "steady" para rodaje continuo). Sin él, a Intervals solo llega el calentamiento y la vuelta a la calma.` });
      continue;
    }
    const minutes = blocksMinutes(blocks);
    const planned = num(w.planned_duration_min);
    if (minutes !== null && planned && Math.abs(minutes - planned) > Math.max(5, planned * 0.15)) {
      failures.push({ rule: 'bloques_duracion', date: w.workout_date, text: `${label}: los bloques suman ${minutes} min y planned_duration_min dice ${planned} min. Deben cuadrar (Intervals usa los bloques).` });
    }
  }
  return failures;
}

const BLOCKS_HELP = 'Cada sesión de carrera necesita blocks completos: Intervals y la app se construyen SOLO con ellos. Formato: {type:"warmup",duration_min,target:"Z1 Pace"}; opcional {type:"activation",repetitions,work_sec,recovery_sec,target}; el bloque principal es {type:"central",name,repetitions,work_value,work_unit:"m"|"s"|"km",recovery_value,recovery_unit,target:"Z4 Pace",recovery_target:"Z1 Pace"} para series o {type:"steady",name,duration_min,target:"Z2 Pace"} para rodaje continuo; {type:"cooldown",duration_min,target}. Los bloques deben sumar planned_duration_min. structured_description: 2-3 líneas cortas (máx. 450 caracteres), sin repetir lo que ya dicen los bloques.';

module.exports = { markForCheck, normaliseBlocks, blocksMinutes, blockFailures, BLOCKS_HELP, MAX_DESCRIPTION };
