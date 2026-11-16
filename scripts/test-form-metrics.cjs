const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../public/js/form-metrics.js');

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const RAW = { lthr: 154, threshold_pace: 1000 / 240, athlete_max_hr: 170, icu_resting_hr: 49 };
// Rodaje llano de 45 min a un ritmo (s/km) y pulso dados.
function run(date, paceSec, hr, extra = {}) {
  const moving = 45 * 60, distance = moving / paceSec * 1000;
  return { activity_date: `${date}T18:00:00Z`, sport: 'Run', name: 'Rodaje', duration_sec: moving, distance_m: distance, elevation_gain_m: 40, avg_hr: hr, max_hr: hr + 12, raw_summary: { ...RAW, moving_time: moving, type: 'Run', ...extra } };
}

test('fórmulas de Daniels: VDOT 50 da umbral 4:15/km y 5K ≈ 19:57', () => {
  assert.equal(F.fmtPace(F.thresholdPaceFor(50)), '4:15');
  const t = F.raceSeconds(50, 5000);
  assert.ok(Math.abs(t - (19 * 60 + 57)) < 15, F.fmtTime(t));
  assert.ok(Math.abs(F.vdotFromRace(5000, t) - 50) < 0.01);
});

test('caso real de Urtzi: 5:08/km a 131 ppm ≈ VO2máx 49 y umbral ~4:16', () => {
  const a = { activity_date: '2026-11-15T16:49:17Z', sport: 'Run', duration_sec: 2575, distance_m: 8353, elevation_gain_m: 76, avg_hr: 131, max_hr: 142, raw_summary: { ...RAW, gap: 3.2226, moving_time: 2575, type: 'Run' } };
  const e = F.runEstimate(a, {});
  assert.equal(e.ok, true);
  assert.ok(e.vdot > 48 && e.vdot < 51, String(e.vdot));
});

test('si corre más rápido con el mismo pulso, la forma mejora y propone umbral más rápido', () => {
  const acts = [];
  for (let i = 0; i < 8; i += 1) acts.push(run(addDays('2026-08-01', i * 4), 320, 130));      // antes: 5:20 a 130
  for (let i = 0; i < 8; i += 1) acts.push(run(addDays('2026-10-10', i * 4), 295, 130));      // ahora: 4:55 a 130
  const r = F.computeForm({ activities: acts, today: '2026-11-12' });
  assert.equal(r.has_data, true);
  assert.equal(r.easy_pace.ref_hr, 130);
  assert.equal(r.easy_pace.trend, 'mejora');
  assert.ok(Math.abs(r.easy_pace.pace_sec - 295) <= 3, String(r.easy_pace.pace_sec));
  assert.ok(r.easy_pace.change_sec >= 20);
  assert.ok(r.vo2max > r.vo2max_before);
  assert.equal(r.races.length, 3);
  assert.ok(r.races[0].seconds < r.races[1].seconds && r.races[1].seconds < r.races[2].seconds);
});

test('si el umbral estimado se aleja un 3 % o más del de Intervals, lo propone', () => {
  const acts = Array.from({ length: 6 }, (_, i) => run(addDays('2026-10-20', i * 4), 320, 135));
  const r = F.computeForm({ activities: acts, today: '2026-11-12' });
  assert.equal(r.threshold.in_use.pace_sec, 240);
  assert.ok(r.threshold.estimate.pace_sec > 247, String(r.threshold.estimate.pace_sec));
  assert.equal(r.threshold.suggest, true);
  assert.equal(r.threshold.changes.pace, true);
  assert.equal(r.threshold.changes.lthr, false);
});

test('si coincide con el de Intervals, no propone nada', () => {
  const probe = F.computeForm({ activities: Array.from({ length: 6 }, (_, i) => run(addDays('2026-10-20', i * 4), 300, 130)), today: '2026-11-12' });
  const inUse = probe.threshold.estimate.pace_sec;
  const r = F.computeForm({ activities: Array.from({ length: 6 }, (_, i) => run(addDays('2026-10-20', i * 4), 300, 130)), profile: { threshold_pace_sec_per_km: inUse + 2, lthr: 154, max_hr: 170 }, today: '2026-11-12' });
  assert.equal(r.threshold.suggest, false);
});

test('pulso máximo nuevo visto dos veces: propone pulso máximo y umbral de pulso nuevos', () => {
  const acts = Array.from({ length: 6 }, (_, i) => run(addDays('2026-10-20', i * 4), 300, 130));
  acts[1].max_hr = 176; acts[3].max_hr = 175;
  const r = F.computeForm({ activities: acts, today: '2026-11-12' });
  assert.equal(r.threshold.changes.max_hr, true);
  assert.equal(r.threshold.estimate.max_hr, 175);
  assert.equal(r.threshold.estimate.lthr, Math.round(154 * 175 / 170));
  const one = Array.from({ length: 6 }, (_, i) => run(addDays('2026-10-20', i * 4), 300, 130));
  one[1].max_hr = 182; // un pico aislado no cuenta
  assert.equal(F.computeForm({ activities: one, today: '2026-11-12' }).threshold.changes.max_hr, false);
});

test('no usa trail con mucho desnivel, paseos, sesiones cortas ni sin pulso', () => {
  const trail = run('2026-11-01', 400, 140); trail.elevation_gain_m = 450;
  const walk = run('2026-11-02', 600, 100); walk.sport = 'Walk'; walk.raw_summary.type = 'Walk';
  const short = run('2026-11-03', 300, 130); short.raw_summary.moving_time = 600; short.duration_sec = 600;
  const nohr = run('2026-11-04', 300, null);
  assert.equal(F.runEstimate(trail).reason, 'mucho desnivel');
  assert.equal(F.runEstimate(walk), null);
  assert.equal(F.runEstimate(short).reason, 'corta o sin pulso');
  assert.equal(F.runEstimate(nohr).reason, 'corta o sin pulso');
  const r = F.computeForm({ activities: [trail, walk, short, nohr], today: '2026-11-12' });
  assert.equal(r.has_data, false);
  assert.equal(r.races.length, 0);
  assert.equal(r.threshold.suggest, false);
});

test('zonas de pulso: mismas proporciones con el umbral nuevo y la última = pulso máximo', () => {
  assert.deepEqual(F.scaleHrZones([129, 137, 145, 153, 157, 162, 170], 154, 160, 177), [134, 142, 151, 159, 163, 168, 177]);
});

test('evolución semanal del umbral: refleja la mejora semana a semana', () => {
  const acts = [];
  for (let i = 0; i < 8; i += 1) acts.push(run(addDays('2026-08-03', i * 4), 320, 130));
  for (let i = 0; i < 10; i += 1) acts.push(run(addDays('2026-09-28', i * 4), 295, 130));
  const r = F.computeForm({ activities: acts, today: '2026-11-12' });
  assert.equal(r.weekly.length, 16);
  const filled = r.weekly.filter(w => w.threshold_pace_sec);
  assert.ok(filled.length >= 10);
  assert.ok(filled.at(-1).threshold_pace_sec < filled[0].threshold_pace_sec, 'umbral más rápido al final');
  assert.equal(filled.at(-1).threshold_pace_sec, r.threshold.estimate.pace_sec);
  assert.equal(new Date(`${r.weekly[0].week_start}T12:00:00Z`).getUTCDay(), 1);
});
