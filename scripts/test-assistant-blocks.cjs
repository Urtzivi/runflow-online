'use strict';
const test = require('node:test');
const assert = require('node:assert');
const B = require('../assistant-blocks');

const mk = w => B.markForCheck({ workout_date: '2026-11-10', sport: 'Run', title: 'Sesión', ...w });

test('normaliza los nombres de bloque que suele usar el agente', () => {
  const blocks = B.normaliseBlocks([{ type: 'Calentamiento', minutes: 10 }, { type: 'main', reps: 3, work_value: 6, work_unit: 'm', recovery_value: 2 }, { type: 'easy', minutes: 25 }, { type: 'cool_down', duration: 5 }]);
  assert.deepEqual(blocks.map(b => b.type), ['warmup', 'central', 'steady', 'cooldown']);
  assert.equal(blocks[0].duration_min, 10);
  assert.equal(blocks[1].repetitions, 3);
  assert.equal(blocks[2].duration_min, 25);
  assert.equal(blocks[3].duration_min, 5);
});

test('sin bloque principal no pasa (caso Saioa 9-11-2026)', () => {
  const f = B.blockFailures([mk({ title: "Tirada suave 40'", planned_duration_min: 40, blocks: [{ type: 'warmup', duration_min: 10 }, { type: 'cooldown', duration_min: 10 }] })]);
  assert.deepEqual(f.map(x => x.rule), ['bloques']);
});

test('los bloques deben sumar la duración prevista', () => {
  const ok = mk({ planned_duration_min: 52, blocks: [{ type: 'warmup', duration_min: 15 }, { type: 'activation', repetitions: 3, work_sec: 15, recovery_sec: 45 }, { type: 'central', repetitions: 3, work_value: 6, work_unit: 'm', recovery_value: 2, recovery_unit: 'm' }, { type: 'cooldown', duration_min: 10 }] });
  assert.equal(B.blocksMinutes(ok.blocks), 52);
  assert.deepEqual(B.blockFailures([ok]), []);
  const bad = mk({ planned_duration_min: 70, blocks: [{ type: 'warmup', duration_min: 10 }, { type: 'steady', duration_min: 25 }, { type: 'cooldown', duration_min: 5 }] });
  assert.deepEqual(B.blockFailures([bad]).map(x => x.rule), ['bloques_duracion']);
});

test('fuerza y sesiones no marcadas no se comprueban', () => {
  assert.deepEqual(B.blockFailures([mk({ sport: 'Strength', blocks: [] })]), []);
  assert.deepEqual(B.blockFailures([{ workout_date: '2026-11-10', sport: 'Run', blocks: [] }]), []);
});
