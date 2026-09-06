'use strict';

// RunFlow — safe season deletion V2.
// Handles DELETE /api/coach/athletes/:athleteId/seasons/:seasonId directly,
// without making recursive HTTP calls back into the same server.
// Planned hierarchy is removed; completed activity history is preserved.

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const APP_ENCRYPTION_KEY = String(process.env.APP_ENCRYPTION_KEY || '');
const INTERVALS_API_BASE = 'https://intervals.icu/api/v1';
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
}

function encryptionKey() {
  if (!APP_ENCRYPTION_KEY || APP_ENCRYPTION_KEY.length < 24) return null;
  try {
    const raw = Buffer.from(APP_ENCRYPTION_KEY, 'base64');
    if (raw.length === 32 && raw.toString('base64').replace(/=+$/, '') === APP_ENCRYPTION_KEY.replace(/=+$/, '')) return raw;
  } catch {}
  return crypto.createHash('sha256').update(APP_ENCRYPTION_KEY, 'utf8').digest();
}

function decryptSecret(record) {
  const key = encryptionKey();
  if (!key || !record) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.secret_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.secret_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.secret_ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function getIntervalsKey(athleteId) {
  try {
    const rows = await sb('athlete_integrations', `athlete_id=eq.${encodeURIComponent(athleteId)}&provider=eq.intervals&select=*&limit=1`);
    return rows[0] ? decryptSecret(rows[0]) : null;
  } catch {
    return null;
  }
}

async function deleteIntervalsEvent(apiKey, workout) {
  if (!apiKey || !workout?.intervals_event_id) return null;
  const response = await fetch(`${INTERVALS_API_BASE}/athlete/0/events/${encodeURIComponent(workout.intervals_event_id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}` },
  });
  if (!response.ok && response.status !== 404) return `Intervals HTTP ${response.status}`;
  return null;
}

function manualLoad(workout, log) {
  const planned = Number(workout.planned_load || 0);
  const plannedMin = Number(workout.planned_duration_min || 0);
  const actualMin = Number(log.actual_duration_min || 0);
  if (actualMin > 0 && plannedMin > 0) return Math.max(0, planned * actualMin / plannedMin);
  return log.status === 'completed' ? Math.max(0, planned) : 0;
}

async function preserveManualExecution(athleteId, workout, log) {
  if (!log || !['completed', 'partial'].includes(log.status)) return;
  const syntheticId = `runflow-manual-${log.id || workout.id}`;
  const actualMin = Number(log.actual_duration_min || 0) || (log.status === 'completed' ? Number(workout.planned_duration_min || 0) : 0);
  const row = {
    athlete_id: athleteId,
    workout_id: null,
    intervals_activity_id: syntheticId,
    activity_date: `${workout.workout_date}T12:00:00Z`,
    sport: workout.sport || 'Run',
    name: workout.title || 'Sesión realizada en RunFlow',
    duration_sec: actualMin > 0 ? Math.round(actualMin * 60) : null,
    distance_m: null,
    elevation_gain_m: null,
    load: Math.round(manualLoad(workout, log) * 10) / 10,
    avg_hr: null,
    max_hr: null,
    avg_pace_sec_per_km: null,
    raw_summary: {
      source: 'runflow_manual_preserved',
      removed_from_plan: true,
      original_workout_id: workout.id,
      manual_log: log,
    },
  };
  await sb('activities', 'on_conflict=athlete_id,intervals_activity_id', {
    method: 'POST',
    body: row,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

async function removeWorkout(athleteId, workout, intervalsKey, warnings) {
  const activities = await sb('activities', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=eq.${encodeURIComponent(workout.id)}&select=*`);
  const logs = await sb('manual_session_logs', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=eq.${encodeURIComponent(workout.id)}&select=*&order=created_at.desc`);
  const latestLog = logs[0] || null;

  if (activities.length) {
    if (latestLog) {
      const first = activities[0];
      const raw = first.raw_summary && typeof first.raw_summary === 'object' ? first.raw_summary : {};
      await sb('activities', `id=eq.${encodeURIComponent(first.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`, {
        method: 'PATCH',
        body: { raw_summary: { ...raw, runflow_manual_feedback: latestLog, removed_from_plan: true } },
        prefer: 'return=minimal',
      });
    }
    await sb('activities', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=eq.${encodeURIComponent(workout.id)}`, {
      method: 'PATCH', body: { workout_id: null }, prefer: 'return=minimal',
    });
  } else if (latestLog) {
    await preserveManualExecution(athleteId, workout, latestLog);
  }

  if (logs.length) {
    await sb('manual_session_logs', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=eq.${encodeURIComponent(workout.id)}`, {
      method: 'DELETE', prefer: 'return=minimal',
    });
  }

  await sb('athlete_messages', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=eq.${encodeURIComponent(workout.id)}`, {
    method: 'PATCH', body: { workout_id: null }, prefer: 'return=minimal',
  }).catch(() => []);

  const intervalsWarning = await deleteIntervalsEvent(intervalsKey, workout);
  if (intervalsWarning) warnings.push(intervalsWarning);

  await sb('workouts', `id=eq.${encodeURIComponent(workout.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`, {
    method: 'DELETE', prefer: 'return=minimal',
  });
}

async function deleteSeasonDirect(athleteId, seasonId) {
  const seasons = await sb('seasons', `id=eq.${encodeURIComponent(seasonId)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=id,name&limit=1`);
  if (!seasons.length) throw Object.assign(new Error('Temporada no encontrada.'), { status: 404 });

  const intervalsKey = await getIntervalsKey(athleteId);
  const warnings = [];
  const removed = { seasons: 1, goals: 0, macrocycles: 0, mesocycles: 0, microcycles: 0, workouts: 0 };
  const macros = await sb('macrocycles', `athlete_id=eq.${encodeURIComponent(athleteId)}&season_id=eq.${encodeURIComponent(seasonId)}&select=id`);

  for (const macro of macros) {
    const mesos = await sb('mesocycles', `athlete_id=eq.${encodeURIComponent(athleteId)}&macrocycle_id=eq.${encodeURIComponent(macro.id)}&select=id`);

    for (const meso of mesos) {
      const weeks = await sb('training_weeks', `athlete_id=eq.${encodeURIComponent(athleteId)}&mesocycle_id=eq.${encodeURIComponent(meso.id)}&select=id`);

      for (const week of weeks) {
        const workouts = await sb('workouts', `athlete_id=eq.${encodeURIComponent(athleteId)}&training_week_id=eq.${encodeURIComponent(week.id)}&select=*`);
        for (const workout of workouts) {
          await removeWorkout(athleteId, workout, intervalsKey, warnings);
          removed.workouts += 1;
        }
        await sb('cycle_evaluations', `athlete_id=eq.${encodeURIComponent(athleteId)}&microcycle_id=eq.${encodeURIComponent(week.id)}`, {
          method: 'DELETE', prefer: 'return=minimal',
        }).catch(() => []);
        await sb('training_weeks', `id=eq.${encodeURIComponent(week.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`, {
          method: 'DELETE', prefer: 'return=minimal',
        });
        removed.microcycles += 1;
      }

      await sb('cycle_evaluations', `athlete_id=eq.${encodeURIComponent(athleteId)}&mesocycle_id=eq.${encodeURIComponent(meso.id)}`, {
        method: 'DELETE', prefer: 'return=minimal',
      }).catch(() => []);
      await sb('mesocycles', `id=eq.${encodeURIComponent(meso.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`, {
        method: 'DELETE', prefer: 'return=minimal',
      });
      removed.mesocycles += 1;
    }

    await sb('goals', `athlete_id=eq.${encodeURIComponent(athleteId)}&associated_macrocycle_id=eq.${encodeURIComponent(macro.id)}`, {
      method: 'PATCH', body: { associated_macrocycle_id: null }, prefer: 'return=minimal',
    }).catch(() => []);
    await sb('cycle_evaluations', `athlete_id=eq.${encodeURIComponent(athleteId)}&macrocycle_id=eq.${encodeURIComponent(macro.id)}`, {
      method: 'DELETE', prefer: 'return=minimal',
    }).catch(() => []);
    await sb('macrocycles', `id=eq.${encodeURIComponent(macro.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`, {
      method: 'DELETE', prefer: 'return=minimal',
    });
    removed.macrocycles += 1;
  }

  const goals = await sb('goals', `athlete_id=eq.${encodeURIComponent(athleteId)}&season_id=eq.${encodeURIComponent(seasonId)}&select=id`);
  for (const goal of goals) {
    await sb('goals', `id=eq.${encodeURIComponent(goal.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`, {
      method: 'DELETE', prefer: 'return=minimal',
    });
    removed.goals += 1;
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
        await requireCoach(req, res, route.athleteId);
        const result = await deleteSeasonDirect(route.athleteId, route.seasonId);
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(res, Number(error.status) || 500, { error: error.message || 'No se pudo eliminar la temporada.' });
      }
    });
  };
}

module.exports = { seasonRoute, deleteSeasonDirect, manualLoad };
