'use strict';

// Football API against a fake Supabase (REST + Storage): state sync, photo,
// activity dates, coach access and the football-mode flag.
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.APP_ENCRYPTION_KEY = 'test-encryption-key-0123456789';

const db = {
  user_roles: [{ user_id: 'coach1', role: 'coach' }, { user_id: 'coach2', role: 'coach' }],
  coach_athletes: [{ coach_user_id: 'coach1', athlete_id: 'a1' }],
  athlete_profiles: [{ athlete_id: 'a1', custom_fields: [] }],
  manual_session_logs: [],
};
const storage = new Map();
const nativeFetch = globalThis.fetch;

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname !== 'fake.supabase.co') return nativeFetch(input, init);
  const method = init.method || 'GET';
  if (url.pathname === '/auth/v1/user') {
    const token = String(init.headers?.Authorization || '').replace('Bearer ', '');
    return ['coach1', 'coach2'].includes(token) ? json({ id: token, email: `${token}@runflow.demo` }) : json({ msg: 'bad' }, 401);
  }
  if (url.pathname === '/storage/v1/bucket') return json({ name: 'runflow-football' });
  if (url.pathname.startsWith('/storage/v1/object/')) {
    const key = decodeURIComponent(url.pathname.replace('/storage/v1/object/', ''));
    if (method === 'POST') { storage.set(key, { type: init.headers['Content-Type'], body: Buffer.from(typeof init.body === 'string' ? init.body : await new Response(init.body).arrayBuffer()) }); return json({ Key: key }); }
    if (method === 'DELETE') { JSON.parse(init.body).prefixes.forEach(prefix => storage.delete(`runflow-football/${prefix}`)); return json([]); }
    const object = storage.get(key);
    return object ? new Response(object.body, { status: 200, headers: { 'Content-Type': object.type } }) : json({ error: 'not_found' }, 400);
  }
  const table = url.pathname.split('/').pop();
  if (method === 'POST') { db[table].push(JSON.parse(init.body)); return json([JSON.parse(init.body)]); }
  let rows = db[table] || [];
  for (const [key, value] of url.searchParams) {
    if (['select', 'order', 'limit'].includes(key)) continue;
    const [op, ...rest] = value.split('.'); const arg = rest.join('.');
    rows = rows.filter(row => op === 'eq' ? String(row[key]) === arg : op === 'like' ? String(row[key] || '').startsWith(arg.replace(/\*$/, '')) : true);
  }
  if (method === 'PATCH') { rows.forEach(row => Object.assign(row, JSON.parse(init.body))); return json(rows); }
  return json(rows);
};

require('../football-api-hook.js');
const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });

function athleteCookie(athleteId) {
  const payload = Buffer.from(JSON.stringify({ athlete_id: athleteId, user_id: 'u1', email: 'a@runflow.demo', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  return `rf_athlete=${payload}.${crypto.createHmac('sha256', process.env.APP_ENCRYPTION_KEY).update(payload).digest('base64url')}`;
}
let base;
async function call(path, { cookie, method = 'GET', body, type = 'application/json' } = {}) {
  const response = await nativeFetch(`${base}${path}`, { method, headers: { Cookie: cookie || '', ...(body !== undefined ? { 'Content-Type': type } : {}) }, body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
  const raw = Buffer.from(await response.arrayBuffer());
  let data = null; try { data = JSON.parse(raw.toString('utf8')); } catch {}
  return { status: response.status, data, raw };
}
const ok = name => console.log(`OK   ${name}`);
const day = offset => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const athlete = athleteCookie('a1');
  try {
    let r = await call('/api/athlete/football/state', { cookie: athlete });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.state, null);
    r = await call('/api/athlete/football/state', { cookie: athlete, method: 'PUT', body: { state: {
      profile: { name: 'Ane', position: 'Lateral', extra: 'x' },
      results: { sprint: [{ date: day(-1), values: { m5: '1.2', bad: 'abc' } }] },
      challenges: { [`${day(0)}|touch30`]: { date: day(0), id: 'touch30', title: 'Toques', result: '42', done: true } },
      wellness: { [day(0)]: { date: day(0), mood: 'Bien' } }, hacker: true,
    } } });
    assert.strictEqual(r.status, 200);
    r = await call('/api/athlete/football/state', { cookie: athlete });
    assert.deepStrictEqual(r.data.state.profile, { name: 'Ane', position: 'Lateral', team: '', category: '' });
    assert.deepStrictEqual(r.data.state.results.sprint[0].values, { m5: 1.2 });
    assert.strictEqual(r.data.state.hacker, undefined);
    ok('el estado de fútbol se guarda limpio y se recupera');

    r = await call('/api/athlete/football/photo', { cookie: athlete, method: 'PUT', body: Buffer.from('not an image'), type: 'text/plain' });
    assert.strictEqual(r.status, 415);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    r = await call('/api/athlete/football/photo', { cookie: athlete, method: 'PUT', body: jpeg, type: 'image/jpeg' });
    assert.strictEqual(r.status, 200);
    r = await call('/api/athlete/football/photo', { cookie: athlete });
    assert.strictEqual(r.status, 200); assert.ok(r.raw.equals(jpeg));
    ok('la foto se sube, se valida el tipo y se descarga igual');

    assert.strictEqual((await call('/api/coach/athletes/a1/football-photo', { cookie: 'rf_access=coach1' })).status, 200);
    assert.strictEqual((await call('/api/coach/athletes/a1/football-photo', { cookie: 'rf_access=coach2' })).status, 403);
    assert.strictEqual((await call('/api/athlete/football/state')).status, 401);
    ok('solo su coach ve la foto; sin sesión no hay acceso');

    r = await call('/api/athlete/football/activity', { cookie: athlete, method: 'POST', body: { kind: 'match', minutes_played: 50, rpe: 7, activity_date: day(-2) } });
    assert.strictEqual(r.status, 201); assert.strictEqual(r.data.log.activity_date, day(-2));
    r = await call('/api/athlete/football/activity', { cookie: athlete, method: 'POST', body: { kind: 'football_training', duration_min: 60, rpe: 5, activity_date: '2001-01-01' } });
    assert.strictEqual(r.data.log.activity_date, new Date().toISOString().slice(0, 10));
    ok('la actividad guarda la fecha elegida y rechaza fechas absurdas');

    r = await call('/api/coach/athletes/a1/football-mode', { cookie: 'rf_access=coach1', method: 'POST', body: { enabled: true } });
    assert.strictEqual(r.data.enabled, true);
    // Simula que el coach guarda la ficha: server.js reescribe los campos como { label, value }.
    db.athlete_profiles[0].custom_fields = db.athlete_profiles[0].custom_fields.map(item => ({ label: item.label || '', value: item.value }));
    r = await call('/api/coach/athletes/a1/football-summary', { cookie: 'rf_access=coach1' });
    assert.strictEqual(r.data.mode, true);
    assert.strictEqual(r.data.has_photo, true);
    assert.strictEqual(r.data.state.profile.name, 'Ane');
    assert.strictEqual(r.data.week.matches, 1);
    assert.strictEqual(r.data.week.load, 50 * 7 + 60 * 5);
    ok('el modo fútbol sobrevive a guardar la ficha y el coach ve estado, foto y carga');
  } finally {
    server.close();
  }
  console.log('API de Fútbol validada.');
})().catch(error => { console.error(error); process.exit(1); });
