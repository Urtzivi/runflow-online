'use strict';
// Prueba de la caché corta de consultas de acceso (supabase-cache-hook.js).
const test = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_URL = 'https://demo.supabase.test';
const calls = [];
let delay = 0;
globalThis.fetch = async (input, init = {}) => {
  calls.push({ url: String(input), method: init.method || 'GET' });
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  if (String(input).includes('fail')) return new Response('{"message":"no"}', { status: 401 });
  return new Response(JSON.stringify([{ n: calls.length }]), { status: 200, headers: { 'content-type': 'application/json' } });
};
require('../supabase-cache-hook.js');
const base = process.env.SUPABASE_URL;
const get = (path, token = 'A') => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
const reset = () => { calls.length = 0; globalThis.__runflowSupabaseCache.clear(); };

test('repite consultas de acceso desde la memoria', async () => {
  reset();
  const first = await get('/rest/v1/user_roles?user_id=eq.1');
  const second = await get('/rest/v1/user_roles?user_id=eq.1');
  assert.deepStrictEqual(first, second);
  assert.strictEqual(calls.length, 1);
});

test('no mezcla usuarios distintos', async () => {
  reset();
  await get('/auth/v1/user', 'A');
  await get('/auth/v1/user', 'B');
  assert.strictEqual(calls.length, 2);
});

test('comparte consultas iguales que llegan a la vez', async () => {
  reset(); delay = 30;
  await Promise.all([1, 2, 3, 4, 5].map(() => get('/rest/v1/coach_athletes?athlete_id=eq.9')));
  delay = 0;
  assert.strictEqual(calls.length, 1);
});

test('olvida la tabla al escribir en ella', async () => {
  reset();
  await get('/rest/v1/athletes?id=eq.1');
  await fetch(`${base}/rest/v1/athletes?id=eq.1`, { method: 'PATCH', body: '{}' });
  await get('/rest/v1/athletes?id=eq.1');
  assert.strictEqual(calls.filter(c => c.method === 'GET').length, 2);
});

test('no guarda errores ni toca otras tablas', async () => {
  reset();
  await fetch(`${base}/auth/v1/user?fail=1`, { headers: { Authorization: 'Bearer X' } });
  await fetch(`${base}/auth/v1/user?fail=1`, { headers: { Authorization: 'Bearer X' } });
  await get('/rest/v1/workouts?id=eq.1');
  await get('/rest/v1/workouts?id=eq.1');
  assert.strictEqual(calls.length, 4);
});
