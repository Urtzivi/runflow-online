const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../public/js/walk-load.js');

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function wellness(from, days, stepsFor) { return Array.from({ length: days }, (_, i) => ({ id: addDays(from, i), steps: stepsFor(addDays(from, i), i) })); }

test('un paseo de 10.000 pasos en un día sin correr cuenta como ~17 de carga', () => {
  const rows = wellness('2026-10-01', 40, d => d === '2026-11-04' ? 17400 : 7800);
  const r = W.computeWalks({ wellness: rows, activities: [], oldest: '2026-11-02', newest: '2026-11-08' });
  const wed = r.days.find(d => d.date === '2026-11-04');
  assert.equal(wed.baseline, 7800);
  assert.equal(wed.extra_steps, 9600);
  assert.equal(wed.walk, true);
  assert.equal(wed.load, 16);
  assert.equal(wed.walk_min, 96);
  assert.equal(r.walk_days, 1);
});

test('los pasos de una carrera registrada no cuentan como paseo', () => {
  const rows = wellness('2026-10-01', 40, d => d === '2026-11-05' ? 18000 : 7800);
  const run = { activity_date: '2026-11-05T18:00:00Z', sport: 'Run', duration_sec: 3600, distance_m: 11000, raw_summary: { moving_time: 3600, average_cadence: 84 } };
  assert.equal(W.activitySteps(run), 10080); // 84 zancadas/min = 168 pasos/min × 60
  const r = W.computeWalks({ wellness: rows, activities: [run], oldest: '2026-11-02', newest: '2026-11-08' });
  assert.equal(r.days.find(d => d.date === '2026-11-05').walk, false);
});

test('tirada larga más paseo: solo cuenta lo que sobra', () => {
  const rows = wellness('2026-10-01', 40, d => d === '2026-11-07' ? 27000 : 7800);
  const long = { activity_date: '2026-11-07T09:00:00Z', sport: 'Run', distance_m: 12100, raw_summary: {} };
  const r = W.computeWalks({ wellness: rows, activities: [long], oldest: '2026-11-02', newest: '2026-11-08' });
  const sat = r.days.find(d => d.date === '2026-11-07');
  assert.equal(sat.activity_steps, 11000);
  assert.equal(sat.extra_steps, 8200);
  assert.equal(sat.load, 14);
});

test('poco movimiento extra (menos de 3.000 pasos) no cuenta', () => {
  const rows = wellness('2026-10-01', 40, d => d === '2026-11-03' ? 10500 : 7800);
  const r = W.computeWalks({ wellness: rows, activities: [], oldest: '2026-11-02', newest: '2026-11-08' });
  assert.equal(r.total_load, 0);
});

test('máximo 25 de carga al día y sin datos suficientes no inventa nada', () => {
  const rows = wellness('2026-10-01', 40, d => d === '2026-11-04' ? 40000 : 7800);
  assert.equal(W.computeWalks({ wellness: rows, oldest: '2026-11-04', newest: '2026-11-04' }).days[0].load, 25);
  const few = wellness('2026-11-01', 4, () => 20000);
  const r = W.computeWalks({ wellness: few, oldest: '2026-11-04', newest: '2026-11-04' });
  assert.equal(r.days[0].baseline, null);
  assert.equal(r.days[0].walk, false);
});

test('la fuerza o la bici no restan pasos', () => {
  assert.equal(W.activitySteps({ sport: 'WeightTraining', duration_sec: 3600 }), 0);
  assert.equal(W.activitySteps({ sport: 'Ride', duration_sec: 3600, raw_summary: { average_cadence: 85 } }), 0);
  assert.equal(W.activitySteps({ sport: 'Walk', distance_m: 7500 }), 10000);
});

test('caso de Ur: día normal de 5.500 pasos y 10.000 con un paseo de ~40 min', () => {
  const rows = wellness('2026-10-01', 40, d => d === '2026-11-09' ? 10000 : 5500);
  const day = W.computeWalks({ wellness: rows, oldest: '2026-11-09', newest: '2026-11-09' }).days[0];
  assert.equal(day.extra_steps, 4500);
  assert.equal(day.walk, true);
  assert.equal(day.walk_min, 45);
  assert.equal(day.load, 8);
});
