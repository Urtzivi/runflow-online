const { test } = require('node:test');
const assert = require('node:assert/strict');
const LS = require('../public/js/load-scale.js');
const { plan } = require('../load-scale-hook.js');
const T = require('../public/js/coach-training-model.js');

test('la regla se parece a lo que da Intervals', () => {
  assert.ok(Math.abs(LS.fromRpe(45, 3, 'Run') - 40) <= 4, 'rodaje suave 45 min ≈ 40');
  assert.equal(LS.fromRpe(60, 9, 'Run'), Math.round(0.98 * 0.98 * 100), '1 h casi al umbral ≈ 96');
  const gym = LS.fromRpe(60, 5, 'Strength');
  assert.ok(gym >= 40 && gym <= 50, `fuerza ligera 60 min entre 40 y 50 (${gym})`);
});

test('una carga sRPE se convierte y una de Intervals se deja igual', () => {
  assert.equal(LS.toIntervals(300, 60, 'Strength'), LS.fromRpe(60, 5, 'Strength'));
  assert.equal(LS.toIntervals(60, 30, 'Run'), LS.fromRpe(30, 2, 'Run'));
  assert.equal(LS.toIntervals(40, 45, 'Run'), 40);
  assert.equal(LS.toIntervals(100, 60, 'Run'), 100);
  assert.equal(LS.toIntervals(300, null, 'Strength'), 300, 'sin minutos no se puede saber: se deja');
  const once = LS.toIntervals(300, 60, 'Strength');
  assert.equal(LS.toIntervals(once, 60, 'Strength'), once, 'aplicarlo dos veces no cambia nada');
});

test('la semana del 9 nov de Urtzi baja de 1080 a una cifra comparable con Intervals', () => {
  const workouts = [
    ...[1, 2, 3].map(i => ({ id: `f${i}`, training_week_id: 'w', sport: 'Strength', is_strength: true, planned_load: 300, planned_duration_min: 60 })),
    ...[1, 2, 3].map(i => ({ id: `r${i}`, training_week_id: 'w', sport: 'Run', planned_load: 60, planned_duration_min: 30 })),
  ];
  const out = plan({ workouts, weeks: [{ id: 'w', target_load: 1080, planned_hours: 4.5 }] });
  assert.equal(out.workouts.length, 6);
  const week = out.weeks[0];
  const sum = out.workouts.reduce((s, c) => s + c.to, 0);
  assert.equal(week.to, sum);
  assert.ok(sum > 150 && sum < 220, `total ${sum}`);
  // Segunda pasada: nada que cambiar.
  const again = plan({ workouts: workouts.map(w => ({ ...w, planned_load: out.workouts.find(c => c.id === w.id).to })), weeks: [{ id: 'w', target_load: week.to, planned_hours: 4.5 }] });
  assert.equal(again.workouts.length + again.weeks.length, 0);
});

test('el plan guiado ya genera la fuerza en escala Intervals', () => {
  const src = require('fs').readFileSync(require.resolve('../public/js/running-guided-plan.js'), 'utf8');
  assert.ok(!/duration \* 5\b/.test(src), 'sin minutos × 5');
  assert.ok(!/minutes \* (info|WEEK_TYPES\[[^\]]+\])\.rpe/.test(src), 'semanas sin minutos × RPE');
});

test('fuerza hecha sin reloj: carga con sus minutos y su RPE', () => {
  const weeks = [{ week_start: '2026-11-09', workouts: [
    { id: 'a', workout_date: '2026-11-09', sport: 'Strength', is_strength: true, planned_load: 300, planned_duration_min: 60, manual_log: { status: 'completed', actual_duration_min: 60, rpe: 5 } },
    { id: 'b', workout_date: '2026-11-13', sport: 'Strength', is_strength: true, planned_load: 300, planned_duration_min: 60, manual_log: { status: 'completed', actual_duration_min: 30 } },
  ] }];
  const rows = T.records({ athlete: {}, weeks });
  assert.equal(rows[0].load, LS.fromRpe(60, 5, 'Strength'));
  assert.equal(Math.round(rows[1].load), Math.round(LS.toIntervals(300, 60, 'Strength') / 2));
});
