// Tarjeta "Mi semana": debe juntar carreras, fuerza, fútbol y paseos con su carga.
const assert = require('assert');
const WS = require('../public/js/week-share.js');
const LS = require('../public/js/load-scale.js');

assert.strictEqual(WS.kindOf('Run'), 'run');
assert.strictEqual(WS.kindOf('TrailRun'), 'run');
assert.strictEqual(WS.kindOf('WeightTraining'), 'strength');
assert.strictEqual(WS.kindOf('Soccer'), 'football');
assert.strictEqual(WS.kindOf('Walk'), 'walk');
assert.strictEqual(WS.kindOf('Hike'), 'walk');
assert.strictEqual(WS.kindOf('VirtualRide'), 'bike');
assert.strictEqual(WS.kindOf('Run', { is_strength: true }), 'strength');

const act = (date, sport, min, km, load) => ({ type: 'intervals', date, load, activity: { sport, duration_sec: min * 60, distance_m: km * 1000, activity_date: date } });
const records = [
  act('2026-11-09', 'Run', 50, 10, 45),
  act('2026-11-11', 'Run', 70, 14.2, 80),
  act('2026-11-12', 'WeightTraining', 45, 0, 25),
  act('2026-11-16', 'Run', 30, 6, 20), // otra semana: fuera
  { type: 'manual', date: '2026-11-13', load: 30, workout: { is_strength: true, sport: 'Strength', planned_duration_min: 60, manual_log: { status: 'completed', actual_duration_min: 55, rpe: 6 } } },
];
const footballLogs = [{ kind: 'match', date: '2026-11-15', minutes: 70, rpe: 8 }];
const walks = { days: [{ date: '2026-11-14', walk: true, walk_min: 60, load: 12 }, { date: '2026-11-10', walk: false, walk_min: 0, load: 0 }] };
const s = WS.summarizeWeek({ weekStart: '2026-11-09', records, footballLogs, walks, loadScale: LS });
const by = Object.fromEntries(s.kinds.map(k => [k.key, k]));
assert.deepStrictEqual(s.kinds.map(k => k.key), ['run', 'strength', 'football', 'walk']);
assert.strictEqual(by.run.sessions, 2); assert.strictEqual(by.run.km, 24.2); assert.strictEqual(by.run.load, 125); assert.strictEqual(by.run.longest_km, 14.2);
assert.strictEqual(by.strength.sessions, 2); assert.strictEqual(by.strength.minutes, 100); assert.strictEqual(by.strength.load, 55);
assert.strictEqual(by.football.matches, 1); assert.strictEqual(by.football.minutes, 70); assert.ok(by.football.load > 50 && by.football.load < 120, `fútbol ${by.football.load}`);
assert.strictEqual(by.walk.sessions, 0); assert.strictEqual(by.walk.minutes, 60); assert.strictEqual(by.walk.estimated_min, 60); assert.strictEqual(by.walk.load, 12);
assert.strictEqual(s.total.sessions, 5);
assert.strictEqual(s.total.minutes, 50 + 70 + 45 + 55 + 70 + 60);
assert.strictEqual(s.total.load, 125 + 55 + by.football.load + 12);
assert.strictEqual(s.total.active_days, 5); // el sábado solo hay paseo: no cuenta como día de entreno
assert.strictEqual(s.days.length, 7);
assert.ok(s.days[5].parts.walk > 0);
assert.ok(/14,2 km/.test(s.best.text));

const empty = WS.summarizeWeek({ weekStart: '2026-11-16' });
assert.strictEqual(empty.total.minutes, 0); assert.strictEqual(empty.kinds.length, 0); assert.strictEqual(empty.best, null);
console.log('week-share OK');
