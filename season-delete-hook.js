'use strict';

// RunFlow — safe season deletion.
// This hook handles DELETE /api/coach/athletes/:athleteId/seasons/:seasonId.
// Nested planning entities are removed through the existing plan-delete-hook,
// so completed activity history, manual execution data and Intervals cleanup
// keep the same guarantees as deleting a macro/meso/micro directly.

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8787);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const IS_PROD = process.env.NODE_ENV === 'production';
const DEMO_MODE = process.env.DEMO_MODE === '1';

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${IS_PROD ? '; Secure' : ''}; Max-Age=${maxAge}`;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = text; }
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' && (data.message || data.error_description || data.error)
      ? (data.message || data.error_description || data.error)
      : `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function sb(table, query = '', options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(new Error('Supabase no está configurado.'), { status: 503 });
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.prefer ? { Prefer: options.prefer } : {}),
  };
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = [];
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = text; }
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' && (data.message || data.details || data.hint)
      ? [data.message, data.details, data.hint].filter(Boolean).join(' · ')
      : `Supabase HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data || [];
}

async function authUser(accessToken) {
  return fetchJson(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
}

async function refreshAuth(refreshToken) {
  return fetchJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

async function requireCoach(req, res, athleteId) {
  const cookies = parseCookies(req);
  let access = cookies.rf_access;
  let refresh = cookies.rf_refresh;
  if (!access) throw Object.assign(new Error('Debes iniciar sesión.'), { status: 401 });

  let user;
  try {
    user = await authUser(access);
  } catch (error) {
    if (!refresh) throw Object.assign(new Error('Debes iniciar sesión.'), { status: 401 });
    const renewed = await refreshAuth(refresh);
    access = renewed.access_token;
    refresh = renewed.refresh_token || refresh;
    user = renewed.user || await authUser(access);
    res.setHeader('Set-Cookie', [
      cookie('rf_access', access, Math.max(60, Number(renewed.expires_in) || 3600)),
      cookie('rf_refresh', refresh, 60 * 60 * 24 * 30),
    ]);
  }

  const roles = await sb('user_roles', `user_id=eq.${encodeURIComponent(user.id)}&select=role`);
  if (!roles.some(row => row.role === 'coach')) {
    throw Object.assign(new Error('No tienes permiso para realizar esta acción.'), { status: 403 });
  }
  const joins = await sb('coach_athletes', `coach_user_id=eq.${encodeURIComponent(user.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=athlete_id&limit=1`);
  if (!joins.length) throw Object.assign(new Error('No tienes acceso a este deportista.'), { status: 403 });

  return `rf_access=${encodeURIComponent(access)}; rf_refresh=${encodeURIComponent(refresh || '')}`;
}

async function callExistingDelete(cookieHeader, athleteId, entity, id) {
  const response = await fetch(`http://127.0.0.1:${PORT}/api/coach/athletes/${encodeURIComponent(athleteId)}/${entity}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Cookie: cookieHeader, Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `No se pudo eliminar ${entity}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function mergeRemoved(target, removed = {}) {
  Object.entries(removed).forEach(([key, value]) => {
    target[key] = Number(target[key] || 0) + Number(value || 0);
  });
}

async function deleteSeason(req, res, athleteId, seasonId) {
  const cookieHeader = await requireCoach(req, res, athleteId);
  const seasons = await sb('seasons', `id=eq.${encodeURIComponent(seasonId)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=id,name&limit=1`);
  if (!seasons.length) throw Object.assign(new Error('Temporada no encontrada.'), { status: 404 });

  const macros = await sb('macrocycles', `athlete_id=eq.${encodeURIComponent(athleteId)}&season_id=eq.${encodeURIComponent(seasonId)}&select=id`);
  const goals = await sb('goals', `athlete_id=eq.${encodeURIComponent(athleteId)}&season_id=eq.${encodeURIComponent(seasonId)}&select=id`);
  const removed = { seasons: 1, goals: 0, macrocycles: 0, mesocycles: 0, microcycles: 0, workouts: 0 };
  const warnings = [];

  for (const macro of macros) {
    const result = await callExistingDelete(cookieHeader, athleteId, 'macrocycles', macro.id);
    mergeRemoved(removed, result.removed);
    warnings.push(...(result.warnings || []));
  }

  for (const goal of goals) {
    const result = await callExistingDelete(cookieHeader, athleteId, 'goals', goal.id);
    mergeRemoved(removed, result.removed);
    warnings.push(...(result.warnings || []));
  }

  await sb('seasons', `id=eq.${encodeURIComponent(seasonId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`, {
    method: 'DELETE', prefer: 'return=minimal',
  });

  return { removed, warnings, season_name: seasons[0].name, history_preserved: true };
}

function seasonRoute(pathname) {
  const match = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/seasons\/([^/]+)$/);
  return match ? { athleteId: match[1], seasonId: match[2] } : null;
}

if (!DEMO_MODE) {
  const originalCreateServer = http.createServer;
  http.createServer = function patchedSeasonDeleteCreateServer(listener) {
    return originalCreateServer.call(http, async (req, res) => {
      const url = new URL(req.url, 'http://runflow.local');
      const route = req.method === 'DELETE' ? seasonRoute(url.pathname) : null;
      if (!route) return listener(req, res);
      try {
        const result = await deleteSeason(req, res, route.athleteId, route.seasonId);
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(res, Number(error.status) || 500, { error: error.message || 'No se pudo eliminar la temporada.' });
      }
    });
  };
}

module.exports = { seasonRoute };
