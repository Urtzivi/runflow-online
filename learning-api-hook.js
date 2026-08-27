'use strict';

// RunFlow Learning V1.
// Captures what the coach actually plans and how the athlete actually responds.
// It does not modify planning methodology or the official library automatically.
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const IS_PROD = process.env.NODE_ENV === 'production';
const CHECKIN_PREFIX = 'RUNFLOW_DAILY_CHECKIN:';
const EVENT_PREFIX = 'RUNFLOW_LEARNING_EVENT:';

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
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

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1000000) throw Object.assign(new Error('Solicitud demasiado grande.'), { status: 413 });
  }
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('JSON no válido.'), { status: 400 }); }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = text; }
  if (!response.ok) {
    const message = data && typeof data === 'object'
      ? data.message || data.error_description || data.error || data.details
      : data;
    throw Object.assign(new Error(message || `HTTP ${response.status}`), { status: response.status, details: data });
  }
  return data;
}

async function sb(table, query = '', options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(new Error('Supabase no está configurado.'), { status: 503 });
  }
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.prefer ? { Prefer: options.prefer } : {}),
  };
  return fetchJson(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function authUser(access) {
  return fetchJson(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${access}` },
  });
}

async function authRefresh(refresh) {
  return fetchJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });
}

async function requireSession(req, res) {
  const cookies = parseCookies(req);
  let access = cookies.rf_access;
  let refresh = cookies.rf_refresh;
  if (!access) throw Object.assign(new Error('Debes iniciar sesión.'), { status: 401 });

  let user;
  try {
    user = await authUser(access);
  } catch {
    if (!refresh) throw Object.assign(new Error('Debes iniciar sesión.'), { status: 401 });
    const renewed = await authRefresh(refresh);
    access = renewed.access_token;
    refresh = renewed.refresh_token || refresh;
    user = renewed.user || await authUser(access);
    res.setHeader('Set-Cookie', [
      cookie('rf_access', access, Math.max(60, Number(renewed.expires_in) || 3600)),
      cookie('rf_refresh', refresh, 60 * 60 * 24 * 30),
    ]);
  }

  const [roles, athletes] = await Promise.all([
    sb('user_roles', `user_id=eq.${encodeURIComponent(user.id)}&select=role`),
    sb('athletes', `user_id=eq.${encodeURIComponent(user.id)}&lifecycle_status=eq.active&select=id&limit=1`),
  ]);
  return { user, roles: roles.map(row => row.role), athlete_id: athletes[0]?.id || null };
}

function requireRole(session, role) {
  if (!session.roles.includes(role)) throw Object.assign(new Error('No tienes permiso para realizar esta acción.'), { status: 403 });
}

async function ensureCoach(session, athleteId) {
  requireRole(session, 'coach');
  const rows = await sb('coach_athletes', `coach_user_id=eq.${encodeURIComponent(session.user.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=athlete_id&limit=1`);
  if (!rows.length) throw Object.assign(new Error('No tienes acceso a este deportista.'), { status: 403 });
}

function safeText(value, max = 5000) { return String(value ?? '').trim().slice(0, max); }
function numberInRange(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null; }
function localDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.RUNFLOW_TIMEZONE || 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function addDays(iso, amount) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function average(values) {
  const rows = values.map(Number).filter(Number.isFinite);
  return rows.length ? Math.round((rows.reduce((sum, value) => sum + value, 0) / rows.length) * 100) / 100 : null;
}

function parseTagged(row, prefix) {
  const raw = String(row?.comment || '');
  if (!raw.startsWith(prefix)) return null;
  try { return { ...JSON.parse(raw.slice(prefix.length)), _row_id: row.id }; }
  catch { return null; }
}

async function unlinkedLogs(athleteId, limit = 900) {
  return sb(
    'manual_session_logs',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=is.null&select=id,rpe,comment,created_at&order=created_at.desc&limit=${Math.min(1000, Math.max(20, limit))}`
  ).catch(() => []);
}

async function listCheckins(athleteId) {
  const rows = await unlinkedLogs(athleteId, 500);
  return rows.map(row => parseTagged(row, CHECKIN_PREFIX)).filter(Boolean).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function checkinStats(rows, today = localDate()) {
  const current = rows.find(row => row.date === today) || null;
  const prior = rows.filter(row => row.date < today).map(row => row.recovery_score);
  const baseline = average(prior.length ? prior : rows.map(row => row.recovery_score));
  const recent = rows.filter(row => row.date >= addDays(today, -6) && row.date <= today).map(row => row.recovery_score);
  return {
    count: rows.length,
    baseline_mean: baseline,
    rolling_7_mean: average(recent),
    today_score: current?.recovery_score ?? null,
    delta_vs_baseline: current && baseline !== null
      ? Math.round((Number(current.recovery_score) - baseline) * 100) / 100
      : null,
  };
}

async function checkinBundle(athleteId) {
  const rows = await listCheckins(athleteId);
  const today = localDate();
  return {
    today: rows.find(row => row.date === today) || null,
    stats: checkinStats(rows, today),
    history: rows.slice(-90),
  };
}

async function saveCheckin(athleteId, body) {
  const recoveryScore = numberInRange(body.recovery_score, 1, 5);
  if (recoveryScore === null) throw Object.assign(new Error('La sensación debe estar entre 1 y 5.'), { status: 400 });
  const date = validDate(body.date) || localDate();
  const payload = {
    kind: 'daily_checkin',
    date,
    recovery_score: recoveryScore,
    comment: safeText(body.comment, 1200),
    source: 'athlete',
    recorded_at: new Date().toISOString(),
  };
  const rows = await unlinkedLogs(athleteId, 500);
  const existing = rows.map(row => ({ row, data: parseTagged(row, CHECKIN_PREFIX) })).find(item => item.data?.date === date);
  const record = {
    status: 'completed',
    actual_duration_min: null,
    rpe: recoveryScore,
    pain: null,
    feeling: null,
    pain_area: null,
    comment: `${CHECKIN_PREFIX}${JSON.stringify(payload)}`,
    created_at: new Date().toISOString(),
  };
  if (existing) {
    await sb('manual_session_logs', `id=eq.${encodeURIComponent(existing.row.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`, {
      method: 'PATCH', body: record, prefer: 'return=minimal',
    });
  } else {
    await sb('manual_session_logs', '', {
      method: 'POST',
      body: { id: crypto.randomUUID(), athlete_id: athleteId, workout_id: null, ...record },
      prefer: 'return=minimal',
    });
  }
  return checkinBundle(athleteId);
}

async function listPlanningEvents(athleteId) {
  const rows = await unlinkedLogs(athleteId, 900);
  return rows.map(row => parseTagged(row, EVENT_PREFIX)).filter(Boolean).sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
}

async function savePlanningEvent(athleteId, coachUserId, body) {
  const allowedOrigins = ['manual', 'imported', 'runflow_generated', 'ai_accepted', 'ai_modified'];
  const origin = allowedOrigins.includes(body.origin) ? body.origin : 'manual';
  const event = {
    kind: 'planning_event',
    event_id: crypto.randomUUID(),
    origin,
    entity_type: safeText(body.entity_type, 80) || 'planning',
    action: safeText(body.action, 40) || 'write',
    path: safeText(body.path, 500),
    season_id: safeText(body.season_id, 100) || null,
    context: body.context && typeof body.context === 'object' ? body.context : {},
    payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
    coach_user_id: coachUserId,
    recorded_at: new Date().toISOString(),
  };
  await sb('manual_session_logs', '', {
    method: 'POST',
    body: {
      id: crypto.randomUUID(), athlete_id: athleteId, workout_id: null,
      status: 'completed', actual_duration_min: null, rpe: null, pain: null,
      feeling: null, pain_area: null,
      comment: `${EVENT_PREFIX}${JSON.stringify(event)}`.slice(0, 12000),
      created_at: event.recorded_at,
    },
    prefer: 'return=minimal',
  });
  return event;
}

function libraryId(workout) {
  const direct = safeText(workout?.runflow_library_id, 120);
  if (direct) return direct;
  const meta = (Array.isArray(workout?.blocks) ? workout.blocks : []).find(block => block?.type === 'runflow_meta' && block.library_id);
  return meta ? String(meta.library_id) : null;
}

async function pendingFeedback(athleteId) {
  const oldest = addDays(localDate(), -14);
  const activities = await sb(
    'activities',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&activity_date=gte.${oldest}T00:00:00&workout_id=not.is.null&select=id,workout_id,activity_date,name,sport,duration_sec,distance_m,elevation_gain_m,load&order=activity_date.desc`
  ).catch(() => []);
  if (!activities.length) return { pending: null };

  const workoutIds = [...new Set(activities.map(row => row.workout_id).filter(Boolean))];
  const logs = workoutIds.length
    ? await sb('manual_session_logs', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=in.(${workoutIds.join(',')})&select=workout_id,created_at`).catch(() => [])
    : [];
  const completedFeedback = new Set(logs.map(row => String(row.workout_id)));
  const activity = activities.find(row => !completedFeedback.has(String(row.workout_id)));
  if (!activity) return { pending: null };

  const workouts = await sb(
    'workouts',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&id=eq.${encodeURIComponent(activity.workout_id)}&select=*&limit=1`
  ).catch(() => []);
  const workout = workouts[0] || null;
  if (!workout) return { pending: null };

  return {
    pending: {
      workout: { ...workout, manual_log: null, execution_status: 'completed' },
      activity: {
        ...activity,
        duration_min: Number(activity.duration_sec) > 0 ? Math.round(Number(activity.duration_sec) / 60) : null,
      },
      detected_at: new Date().toISOString(),
    },
  };
}

function groupByWorkout(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.workout_id) continue;
    const key = String(row.workout_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function learningSummary(athleteId) {
  const newest = localDate();
  const oldest = addDays(newest, -180);
  const [subjective, events, workouts, activities, feedback, objective] = await Promise.all([
    listCheckins(athleteId),
    listPlanningEvents(athleteId),
    sb('workouts', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_date=gte.${oldest}&workout_date=lte.${newest}&select=*&order=workout_date.asc`).catch(() => []),
    sb('activities', `athlete_id=eq.${encodeURIComponent(athleteId)}&activity_date=gte.${oldest}T00:00:00&activity_date=lte.${newest}T23:59:59&select=*&order=activity_date.asc`).catch(() => []),
    sb('manual_session_logs', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=not.is.null&select=*&order=created_at.asc`).catch(() => []),
    sb('daily_metrics', `athlete_id=eq.${encodeURIComponent(athleteId)}&metric_date=gte.${oldest}&metric_date=lte.${newest}&select=*&order=metric_date.asc`).catch(() => []),
  ]);

  const subjectiveByDate = new Map(subjective.map(row => [row.date, row]));
  const objectiveByDate = new Map(objective.map(row => [row.metric_date, row]));
  const activitiesByWorkout = groupByWorkout(activities);
  const feedbackByWorkout = groupByWorkout(feedback);

  const episodes = workouts.map(workout => {
    const date = String(workout.workout_date || '').slice(0, 10);
    const actualRows = activitiesByWorkout.get(String(workout.id)) || [];
    const feedbackRows = (feedbackByWorkout.get(String(workout.id)) || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const athleteFeedback = feedbackRows[0] || null;
    const durationSeconds = actualRows.reduce((sum, row) => sum + Number(row.duration_sec || 0), 0);
    const load = actualRows.reduce((sum, row) => sum + Number(row.load || 0), 0);
    const distanceMeters = actualRows.reduce((sum, row) => sum + Number(row.distance_m || 0), 0);
    const elevation = actualRows.reduce((sum, row) => sum + Number(row.elevation_gain_m || 0), 0);

    return {
      date,
      workout_id: workout.id,
      library_id: libraryId(workout),
      planning: {
        title: workout.title,
        sport: workout.sport,
        priority: workout.priority || null,
        planned_duration_min: workout.planned_duration_min ?? null,
        planned_load: workout.planned_load ?? null,
        session_objective: workout.session_objective || null,
        adaptation_target: workout.adaptation_target || null,
      },
      pre_state: {
        subjective: subjectiveByDate.get(date) || null,
        objective: objectiveByDate.get(date) || null,
      },
      actual: {
        duration_min: actualRows.length ? Math.round(durationSeconds / 60) : athleteFeedback?.actual_duration_min ?? null,
        load: actualRows.length ? Math.round(load * 10) / 10 : null,
        distance_km: actualRows.length ? Math.round(distanceMeters / 100) / 10 : null,
        elevation_m: actualRows.length ? Math.round(elevation) : null,
      },
      feedback: athleteFeedback ? {
        status: athleteFeedback.status,
        rpe: athleteFeedback.rpe,
        feeling: athleteFeedback.feeling,
        pain: athleteFeedback.pain,
        pain_area: athleteFeedback.pain_area,
        comment: athleteFeedback.comment,
      } : null,
      has_activity: actualRows.length > 0,
    };
  }).filter(row => row.has_activity || row.feedback);

  return {
    range: { oldest, newest },
    checkins: { stats: checkinStats(subjective, newest), count: subjective.length },
    planning_events: {
      count: events.length,
      by_origin: events.reduce((out, event) => {
        out[event.origin] = (out[event.origin] || 0) + 1;
        return out;
      }, {}),
      recent: events.slice(-50),
    },
    episodes: episodes.slice(-180),
  };
}

async function handle(req, res, url) {
  const path = url.pathname;
  const method = req.method || 'GET';
  const coachRoute = /\/api\/v9\/coach\/athletes\/[^/]+\/(daily-checkins|learning-event|learning-events|learning-summary)$/.test(path);
  const isLearning = path === '/api/v2/athlete/daily-checkin' || path === '/api/v2/athlete/pending-feedback' || coachRoute;
  if (!isLearning) return false;

  const session = await requireSession(req, res);

  if (path === '/api/v2/athlete/daily-checkin') {
    requireRole(session, 'athlete');
    if (!session.athlete_id) throw Object.assign(new Error('Tu usuario no está vinculado a una ficha de deportista.'), { status: 409 });
    if (method === 'GET') { sendJson(res, 200, await checkinBundle(session.athlete_id)); return true; }
    if (method === 'POST') { sendJson(res, 201, await saveCheckin(session.athlete_id, await readJson(req))); return true; }
  }

  if (path === '/api/v2/athlete/pending-feedback' && method === 'GET') {
    requireRole(session, 'athlete');
    if (!session.athlete_id) throw Object.assign(new Error('Tu usuario no está vinculado a una ficha de deportista.'), { status: 409 });
    sendJson(res, 200, await pendingFeedback(session.athlete_id));
    return true;
  }

  let match = path.match(/^\/api\/v9\/coach\/athletes\/([^/]+)\/daily-checkins$/);
  if (match && method === 'GET') {
    const athleteId = decodeURIComponent(match[1]);
    await ensureCoach(session, athleteId);
    sendJson(res, 200, await checkinBundle(athleteId));
    return true;
  }

  match = path.match(/^\/api\/v9\/coach\/athletes\/([^/]+)\/learning-event$/);
  if (match && method === 'POST') {
    const athleteId = decodeURIComponent(match[1]);
    await ensureCoach(session, athleteId);
    sendJson(res, 201, { event: await savePlanningEvent(athleteId, session.user.id, await readJson(req)) });
    return true;
  }

  match = path.match(/^\/api\/v9\/coach\/athletes\/([^/]+)\/learning-events$/);
  if (match && method === 'GET') {
    const athleteId = decodeURIComponent(match[1]);
    await ensureCoach(session, athleteId);
    sendJson(res, 200, { events: await listPlanningEvents(athleteId) });
    return true;
  }

  match = path.match(/^\/api\/v9\/coach\/athletes\/([^/]+)\/learning-summary$/);
  if (match && method === 'GET') {
    const athleteId = decodeURIComponent(match[1]);
    await ensureCoach(session, athleteId);
    sendJson(res, 200, await learningSummary(athleteId));
    return true;
  }

  sendJson(res, 405, { error: 'Método no permitido.' });
  return true;
}

const originalCreateServer = http.createServer;
http.createServer = function patchedLearningServer(listener) {
  return originalCreateServer.call(http, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (await handle(req, res, url)) return;
    } catch (error) {
      console.error('[learning-api-hook]', error);
      return sendJson(res, Number(error.status || 500), { error: error.message || 'Error interno.', details: error.details || null });
    }
    return listener(req, res);
  });
};
