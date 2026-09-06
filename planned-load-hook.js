'use strict';

// RunFlow planned-load estimator.
// Imported plans may intentionally omit/zero planned_load. This endpoint
// estimates missing planned load from the athlete's own recent load/minute
// history, then falls back to conservative RunFlow session-type rates.

const http = require('http');
const { URL } = require('url');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const IS_PROD = process.env.NODE_ENV === 'production';
const DEMO_MODE = process.env.DEMO_MODE === '1';

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
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

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2000000) throw Object.assign(new Error('Solicitud demasiado grande.'), { status: 413 });
  }
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('JSON no válido.'), { status: 400 }); }
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
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}

async function sb(table, query = '') {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return [];
  return fetchJson(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
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
  } catch {
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
  if (!roles.some(row => row.role === 'coach')) throw Object.assign(new Error('No tienes permiso.'), { status: 403 });
  const joins = await sb('coach_athletes', `coach_user_id=eq.${encodeURIComponent(user.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=athlete_id&limit=1`);
  if (!joins.length) throw Object.assign(new Error('No tienes acceso a este deportista.'), { status: 403 });
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function percentile(values, p) {
  const arr = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return null;
  if (arr.length === 1) return arr[0];
  const pos = (arr.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? arr[lo] : arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
}

function textOf(workout) {
  const blocks = Array.isArray(workout?.blocks) ? workout.blocks : [];
  return [
    workout?.title, workout?.summary, workout?.structured_description,
    workout?.session_objective, workout?.adaptation_target, workout?.purpose,
    ...blocks.flatMap(block => [block?.name, block?.target, block?.recovery_target, block?.neuromuscular_cost]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function sportKey(workout) {
  const sport = String(workout?.sport || '').toLowerCase();
  const text = textOf(workout);
  if (workout?.is_strength || /strength|weight|fuerza|gimnasio/.test(sport)) return 'strength';
  if (/ride|bike|cycling|bici|ciclismo/.test(sport)) return 'bike';
  if (/trail/.test(sport) || /trail|montaña|desnivel/.test(text)) return 'run';
  if (/run|running|carrera|correr/.test(sport)) return 'run';
  return 'other';
}

function intensityClass(workout) {
  const text = textOf(workout);
  if (/competición|competition|carrera objetivo|bkt|apuko/.test(text)) return 'race';
  if (/vo2|vo₂|z5|máxim|fuerte|intervalos rápidos/.test(text)) return 'vo2';
  if (/umbral|threshold|lt2|z4/.test(text)) return 'threshold';
  if (/cuesta|subida|hill/.test(text)) return 'hills';
  if (/tempo|z3|sostenido|específico/.test(text)) return 'tempo';
  if (/regener|recovery|recuperación|z1/.test(text) && !/z2/.test(text)) return 'recovery';
  if (/tirada|long|trail/.test(text)) return 'long';
  if (/easy|suave|z2|aeróbic|base/.test(text)) return 'easy';
  return 'steady';
}

function strengthFactor(workout) {
  const blocks = Array.isArray(workout?.blocks) ? workout.blocks : [];
  const exercises = blocks.filter(b => b?.type === 'strength').flatMap(b => Array.isArray(b.exercises) ? b.exercises : []);
  const rirs = exercises.map(e => Number(e?.rir)).filter(Number.isFinite);
  const avgRir = rirs.length ? rirs.reduce((a, b) => a + b, 0) / rirs.length : 3;
  const cost = textOf(workout);
  let factor = avgRir <= 2 ? 1.08 : avgRir <= 3 ? 1.0 : 0.9;
  if (/potencia|salto|excéntric|eccentric|heavy|pesad/.test(cost)) factor += 0.05;
  if (/descarga|taper|activación|regener/.test(cost)) factor -= 0.12;
  return clamp(factor, 0.72, 1.16);
}

const FALLBACK_PER_MIN = {
  recovery: 0.68,
  easy: 0.82,
  long: 0.76,
  steady: 0.84,
  tempo: 0.90,
  hills: 0.94,
  threshold: 0.94,
  vo2: 1.02,
  race: 1.08,
};

const HISTORY_FACTOR = {
  recovery: 0.72,
  easy: 0.88,
  long: 0.84,
  steady: 0.92,
  tempo: 1.00,
  hills: 1.06,
  threshold: 1.08,
  vo2: 1.15,
  race: 1.20,
};

function historySport(sport) {
  const value = String(sport || '').toLowerCase();
  if (/strength|weight|fuerza/.test(value)) return 'strength';
  if (/ride|bike|cycling|bici/.test(value)) return 'bike';
  if (/run|trail|carrera/.test(value)) return 'run';
  return 'other';
}

function estimateWorkout(workout, historyBySport) {
  const duration = Number(workout?.planned_duration_min || 0);
  if (!(duration > 0)) return { planned_load: 0, source: 'insufficient', confidence: 'none' };
  const kind = sportKey(workout);

  if (kind === 'strength') {
    const samples = historyBySport.get('strength') || [];
    const base = samples.length >= 3 ? percentile(samples, 0.35) : 1.10;
    const load = Math.max(1, Math.round(duration * clamp(base * strengthFactor(workout), 0.65, 1.55)));
    return {
      planned_load: load,
      source: samples.length >= 3 ? 'athlete_strength_history' : 'runflow_strength_fallback',
      confidence: samples.length >= 8 ? 'medium' : 'low',
      samples: samples.length,
    };
  }

  const intensity = intensityClass(workout);
  const samples = historyBySport.get(kind) || [];
  if (samples.length >= 3) {
    const base = percentile(samples, 0.35);
    const load = Math.max(1, Math.round(duration * clamp(base * (HISTORY_FACTOR[intensity] || 0.92), 0.35, 1.50)));
    return {
      planned_load: load,
      source: 'athlete_sport_history',
      confidence: samples.length >= 8 ? 'medium' : 'low',
      samples: samples.length,
      intensity,
    };
  }

  const rate = kind === 'bike' ? 0.58 : (FALLBACK_PER_MIN[intensity] || FALLBACK_PER_MIN.steady);
  return {
    planned_load: Math.max(1, Math.round(duration * rate)),
    source: 'runflow_conservative_fallback',
    confidence: 'low',
    samples: samples.length,
    intensity,
  };
}

async function estimateLoads(athleteId, workouts) {
  const recent = DEMO_MODE ? [] : await sb('activities', `athlete_id=eq.${encodeURIComponent(athleteId)}&load=gt.0&duration_sec=gt.0&select=load,duration_sec,sport,activity_date&order=activity_date.desc&limit=200`).catch(() => []);
  const historyBySport = new Map();
  for (const activity of recent) {
    const minutes = Number(activity.duration_sec || 0) / 60;
    const load = Number(activity.load || 0);
    if (!(minutes > 0) || !(load > 0)) continue;
    const key = historySport(activity.sport);
    if (!historyBySport.has(key)) historyBySport.set(key, []);
    historyBySport.get(key).push(load / minutes);
  }

  return (workouts || []).slice(0, 250).map(workout => {
    const existing = Number(workout?.planned_load || 0);
    if (existing > 0) return {
      id: workout?.id || null,
      key: workout?.key || null,
      workout_date: workout?.workout_date || null,
      title: workout?.title || '',
      planned_load: Math.round(existing),
      source: 'existing',
      confidence: 'high',
    };
    return {
      id: workout?.id || null,
      key: workout?.key || null,
      workout_date: workout?.workout_date || null,
      title: workout?.title || '',
      ...estimateWorkout(workout, historyBySport),
    };
  });
}

function route(pathname) {
  const match = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/planned-load\/estimate$/);
  return match ? { athleteId: decodeURIComponent(match[1]) } : null;
}

if (!DEMO_MODE) {
  const originalCreateServer = http.createServer;
  http.createServer = function plannedLoadCreateServer(listener) {
    return originalCreateServer.call(http, async (req, res) => {
      const url = new URL(req.url, 'http://runflow.local');
      const match = req.method === 'POST' ? route(url.pathname) : null;
      if (!match) return listener(req, res);
      try {
        await requireCoach(req, res, match.athleteId);
        const body = await readJson(req);
        const workouts = Array.isArray(body.workouts) ? body.workouts : [];
        if (!workouts.length) throw Object.assign(new Error('No hay sesiones para estimar.'), { status: 400 });
        const estimates = await estimateLoads(match.athleteId, workouts);
        sendJson(res, 200, {
          estimates,
          total_load: estimates.reduce((sum, item) => sum + Number(item.planned_load || 0), 0),
          method: 'athlete_history_then_conservative_fallback',
        });
      } catch (error) {
        sendJson(res, Number(error.status) || 500, { error: error.message || 'No se pudo estimar la carga planificada.' });
      }
    });
  };
}

module.exports = { estimateWorkout, intensityClass, sportKey };
