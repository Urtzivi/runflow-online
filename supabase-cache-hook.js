'use strict';

// RunFlow · caché corta de las consultas de acceso a Supabase.
//
// Cada petición del Coach (servidor y todos los hooks) comprueba antes de
// trabajar quién es el usuario (auth/v1/user), qué roles tiene (user_roles),
// su ficha (athletes) y si el atleta es suyo (coach_athletes). Son 3-4
// consultas en fila de ~0,2 s cada una, repetidas en cada petición. Este
// hook se carga el primero y envuelve fetch para:
//   - recordar esas respuestas durante CACHE_TTL_MS,
//   - compartir una misma consulta si llegan varias iguales a la vez,
//   - olvidar la tabla en cuanto se escribe en ella (POST/PATCH/PUT/DELETE).
// Solo afecta a GET de esas tablas y de auth/v1/user; todo lo demás pasa igual.

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const CACHE_TTL_MS = Math.max(0, Number(process.env.RUNFLOW_ACCESS_CACHE_MS || 60000));
const CACHED_TABLES = new Set(['user_roles', 'coach_athletes', 'athletes']);
const MAX_ENTRIES = 2000;

const nativeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
const cache = new Map(); // key -> { at, table, status, statusText, headers, body }
const inflight = new Map(); // key -> Promise<entry|null>
const stats = { hits: 0, shared: 0, misses: 0, invalidations: 0 };

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === wanted) return String(value || '');
  return '';
}

function classify(input, init) {
  if (!SUPABASE_URL) return null;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
  if (!url || !url.startsWith(`${SUPABASE_URL}/`)) return null;
  const method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
  const pathname = url.slice(SUPABASE_URL.length).split('?')[0];
  if (pathname === '/auth/v1/user') return { url, method, table: 'auth:user' };
  if (pathname === '/auth/v1/logout') return { url, method, table: 'auth:user' };
  const match = pathname.match(/^\/rest\/v1\/([^/]+)$/);
  if (match && CACHED_TABLES.has(match[1])) return { url, method, table: match[1] };
  return null;
}

function forgetTable(table) {
  for (const [key, entry] of cache) if (entry.table === table) cache.delete(key);
  for (const key of inflight.keys()) if (key.startsWith(`${table}|`)) inflight.delete(key);
  stats.invalidations += 1;
}

function toResponse(entry) {
  return new Response(entry.body, { status: entry.status, statusText: entry.statusText, headers: entry.headers });
}

function remember(key, entry) {
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, value] of cache) if (now - value.at > CACHE_TTL_MS) cache.delete(k);
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  }
  cache.set(key, entry);
}

async function cachedFetch(input, init) {
  const target = classify(input, init);
  if (!target || !CACHE_TTL_MS) return nativeFetch(input, init);
  if (target.method !== 'GET' && target.method !== 'HEAD') {
    forgetTable(target.table);
    const response = await nativeFetch(input, init);
    forgetTable(target.table);
    return response;
  }
  const prefer = headerValue(init && init.headers, 'prefer');
  const range = headerValue(init && init.headers, 'range');
  const auth = headerValue(init && init.headers, 'authorization') || headerValue(input && input.headers, 'authorization');
  const key = `${target.table}|${target.url}|${auth}|${prefer}|${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) { stats.hits += 1; return toResponse(hit); }
  if (hit) cache.delete(key);
  if (inflight.has(key)) {
    const shared = await inflight.get(key);
    if (shared) { stats.shared += 1; return toResponse(shared); }
    return nativeFetch(input, init);
  }
  stats.misses += 1;
  let settle;
  const pending = new Promise(resolve => { settle = resolve; });
  inflight.set(key, pending);
  try {
    const response = await nativeFetch(input, init);
    if (!response.ok) { settle(null); return response; }
    const body = await response.text();
    const entry = {
      at: Date.now(), table: target.table, status: response.status, statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()), body,
    };
    // Solo se guarda si nadie ha escrito en la tabla mientras llegaba la respuesta.
    if (inflight.get(key) === pending) remember(key, entry);
    settle(entry);
    return toResponse(entry);
  } catch (error) {
    settle(null);
    throw error;
  } finally {
    if (inflight.get(key) === pending) inflight.delete(key);
  }
}

if (nativeFetch && !globalThis.__runflowSupabaseCache) {
  globalThis.fetch = cachedFetch;
  globalThis.__runflowSupabaseCache = { stats, clear: () => { cache.clear(); inflight.clear(); }, ttl: CACHE_TTL_MS };
}

module.exports = { cachedFetch, classify, stats };
