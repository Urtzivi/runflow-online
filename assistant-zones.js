'use strict';

// Zonas de carrera de un atleta (perfil Run de Intervals.icu) para el asistente.
// - readZones: lo que hay ahora en Intervals (pulso umbral, pulso máximo, ritmo umbral,
//   límites de las zonas de pulso y de ritmo), en lenguaje sencillo.
// - buildZonesPatch: valida lo que manda el entrenador (por ejemplo, las zonas de una
//   prueba de esfuerzo) y lo traduce al formato de Intervals:
//     · hr_zones = límite superior de cada zona, en ppm, de menor a mayor.
//     · threshold_pace = m/s.
//     · pace_zones = límite superior de cada zona en % de la velocidad umbral (la última 999).
// RunFlow no recalcula zonas: las lee de Intervals. Escribirlas aquí es la única forma
// de que las actividades nuevas lleguen con ellas y el efecto de entrenamiento se adapte.

const HISTORY_LABEL = 'RunFlow · Zonas cargadas';

function bad(message, status = 400) { return Object.assign(new Error(message), { status }); }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function safe(value, max = 300) { return String(value ?? '').trim().slice(0, max); }

// "5:21", "05:21" o 321 → segundos por km.
function paceSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value >= 120 && value <= 900 ? value : null;
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return sec >= 120 && sec <= 900 ? sec : null;
}
function fmtPace(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function paceFromMps(mps) { const v = num(mps); return v && v > 0 ? 1000 / v : null; }

function hrRows(limits) {
  const list = (Array.isArray(limits) ? limits : []).map(num).filter(v => v && v > 0);
  let min = 0;
  return list.map((max, i) => { const row = { zona: `Z${i + 1}`, desde: min, hasta: max }; min = max + 1; return row; });
}
function paceRows(percents, thresholdSec) {
  const list = (Array.isArray(percents) ? percents : []).map(num).filter(v => v && v > 0);
  if (!thresholdSec) return list.map((p, i) => ({ zona: `Z${i + 1}`, hasta_pct: p }));
  let slow = null;
  return list.map((p, i) => {
    const fast = p >= 900 ? null : thresholdSec * 100 / p;
    const row = { zona: `Z${i + 1}`, desde: slow ? fmtPace(slow) : null, hasta: fast ? fmtPace(fast) : 'más rápido', hasta_pct: p };
    slow = fast;
    return row;
  });
}

function readable(settings) {
  const s = settings || {};
  const thresholdSec = paceFromMps(s.threshold_pace);
  return {
    perfil: Array.isArray(s.types) ? s.types.join(', ') : 'Run',
    pulso_umbral: num(s.lthr),
    pulso_max: num(s.max_hr),
    ritmo_umbral: thresholdSec ? `${fmtPace(thresholdSec)}/km` : null,
    zonas_pulso: hrRows(s.hr_zones),
    zonas_ritmo: paceRows(s.pace_zones, thresholdSec),
  };
}

// args: { lthr, max_hr, hr_zones:[límites superiores ppm], threshold_pace:"m:ss",
//         pace_zones:["m:ss" límite rápido de cada zona salvo la última] }
function buildZonesPatch(args) {
  const patch = {};
  const errors = [];
  const lthr = args.lthr === undefined || args.lthr === null ? null : num(args.lthr);
  const maxHr = args.max_hr === undefined || args.max_hr === null ? null : num(args.max_hr);
  if (lthr !== null) { if (lthr < 100 || lthr > 220) errors.push('pulso umbral fuera de rango (100-220).'); else patch.lthr = Math.round(lthr); }
  if (maxHr !== null) { if (maxHr < 120 || maxHr > 230) errors.push('pulso máximo fuera de rango (120-230).'); else patch.max_hr = Math.round(maxHr); }
  if (patch.lthr && patch.max_hr && patch.lthr > patch.max_hr) errors.push('el pulso umbral no puede ser mayor que el máximo.');

  if (args.hr_zones !== undefined && args.hr_zones !== null) {
    const zones = (Array.isArray(args.hr_zones) ? args.hr_zones : []).map(num);
    if (zones.length < 3 || zones.length > 7 || zones.some(v => !v || v < 60 || v > 230)) errors.push('hr_zones: de 3 a 7 límites superiores en ppm (60-230).');
    else if (zones.some((v, i) => i && v <= zones[i - 1])) errors.push('hr_zones: cada límite tiene que ser mayor que el anterior.');
    else {
      patch.hr_zones = zones.map(v => Math.round(v));
      const top = patch.max_hr || maxHr;
      if (top && patch.hr_zones[patch.hr_zones.length - 1] > top) errors.push('hr_zones: la última zona no puede pasar del pulso máximo.');
    }
  }

  const thresholdSec = paceSeconds(args.threshold_pace);
  if (args.threshold_pace !== undefined && args.threshold_pace !== null && args.threshold_pace !== '') {
    if (!thresholdSec) errors.push('threshold_pace: escribe el ritmo umbral como m:ss por km (por ejemplo 5:21).');
    else patch.threshold_pace = Math.round((1000 / thresholdSec) * 10000) / 10000;
  }
  if (args.pace_zones !== undefined && args.pace_zones !== null) {
    const paces = (Array.isArray(args.pace_zones) ? args.pace_zones : []).map(paceSeconds);
    if (!thresholdSec) errors.push('pace_zones necesita threshold_pace.');
    else if (paces.length < 2 || paces.length > 7 || paces.some(v => !v)) errors.push('pace_zones: de 2 a 7 ritmos m:ss (el límite rápido de cada zona, de más lento a más rápido).');
    else if (paces.some((v, i) => i && v >= paces[i - 1])) errors.push('pace_zones: cada ritmo tiene que ser más rápido que el anterior.');
    else patch.pace_zones = [...paces.map(sec => Math.round((thresholdSec * 1000 / sec)) / 10), 999];
  }
  if (!errors.length && !Object.keys(patch).length) errors.push('No hay nada que cambiar.');
  return { patch, errors };
}

module.exports = { HISTORY_LABEL, buildZonesPatch, readable, paceSeconds, fmtPace };
