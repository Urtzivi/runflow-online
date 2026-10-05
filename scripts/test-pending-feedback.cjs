'use strict';

// Checks /api/v2/athlete/pending-feedback against a fake Supabase: planned and
// unplanned Intervals activities both ask for feedback, newest first, and
// already rated or manually entered activities are skipped.
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.APP_ENCRYPTION_KEY = 'test-encryption-key-0123456789';

const PREFIX = 'RUNFLOW_ACTIVITY_FEEDBACK ';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.RUNFLOW_TIMEZONE || 'Europe/Madrid' }).format(new Date());
let db;

function reply(rows) { return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } }); }

// Minimal PostgREST: only the filters pendingFeedback uses.
globalThis.fetch = async input => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const table = url.pathname.split('/').pop();
  let rows = [...(db[table] || [])];
  for (const [key, value] of url.searchParams) {
    if (['select', 'order', 'limit'].includes(key)) continue;
    const [op, ...rest] = value.split('.');
    const arg = rest.join('.');
    rows = rows.filter(row => {
      const field = row[key];
      if (op === 'eq') return String(field) === arg;
      if (op === 'gte') return String(field) >= arg;
      if (op === 'is') return field == null;
      if (op === 'in') return arg.slice(1, -1).split(',').includes(String(field));
      if (op === 'not' && arg === 'is.null') return field != null;
      if (op === 'not' && arg.startsWith('like.')) return !String(field || '').startsWith(arg.slice(5).replace(/\*$/, ''));
      throw new Error(`Filtro no soportado: ${key}=${value}`);
    });
  }
  rows.sort((a, b) => String(b.activity_date || '').localeCompare(String(a.activity_date || '')));
  return reply(rows);
};

require('../learning-api-hook.js');
const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });

function athleteCookie(athleteId) {
  const payload = Buffer.from(JSON.stringify({ athlete_id: athleteId, user_id: 'u1', email: 'a@runflow.demo', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.APP_ENCRYPTION_KEY).update(payload).digest('base64url');
  return `rf_athlete=${payload}.${signature}`;
}

async function pending(port) {
  const response = await fetchReal(`http://127.0.0.1:${port}/api/v2/athlete/pending-feedback`, { headers: { Cookie: athleteCookie('a1') } });
  assert.strictEqual(response.status, 200);
  return (await response.json()).pending;
}

const fetchReal = (...args) => new Promise((resolve, reject) => {
  const [url, options] = args;
  http.get(url, { headers: options.headers }, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(body) }));
  }).on('error', reject);
});

const activity = (id, extra) => ({ id, athlete_id: 'a1', intervals_activity_id: `i${id}`, activity_date: `${today}T08:00:00`, name: `Act ${id}`, sport: 'Run', duration_sec: 1800, workout_id: null, ...extra });

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    db = { activities: [activity(1)], manual_session_logs: [], workouts: [] };
    let result = await pending(port);
    assert.strictEqual(result.workout, null);
    assert.strictEqual(result.activity.intervals_activity_id, 'i1');
    assert.strictEqual(result.activity.duration_min, 30);
    console.log('OK   una actividad no programada pide feedback');

    db.manual_session_logs = [{ athlete_id: 'a1', workout_id: null, created_at: `${today}T09:00:00`, comment: `${PREFIX}${JSON.stringify({ activity_id: 'i1', comment: '' })}` }];
    assert.strictEqual(await pending(port), null);
    console.log('OK   una actividad ya valorada no vuelve a pedirlo');

    db = { activities: [activity(2, { intervals_activity_id: 'runflow-manual-2' })], manual_session_logs: [], workouts: [] };
    assert.strictEqual(await pending(port), null);
    console.log('OK   las actividades manuales no piden feedback');

    db = {
      activities: [activity(3, { activity_date: `${today}T07:00:00`, workout_id: 'w1' }), activity(4, { activity_date: `${today}T19:00:00` })],
      manual_session_logs: [],
      workouts: [{ id: 'w1', athlete_id: 'a1', title: 'Rodaje' }],
    };
    result = await pending(port);
    assert.strictEqual(result.activity.intervals_activity_id, 'i4');
    console.log('OK   se pide primero la actividad más reciente');

    db.activities[1].activity_date = `${today}T06:00:00`;
    result = await pending(port);
    assert.strictEqual(result.workout.id, 'w1');
    console.log('OK   las sesiones planificadas siguen pidiendo feedback');
  } finally {
    server.close();
  }
  console.log('Feedback pendiente validado.');
})().catch(error => { console.error(error); process.exit(1); });
