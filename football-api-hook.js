'use strict';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const APP_ENCRYPTION_KEY = String(process.env.APP_ENCRYPTION_KEY || '');
const PREFIX = 'RF_FOOTBALL|';

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

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw Object.assign(new Error((data && data.message) || `HTTP ${response.status}`), { status: response.status, data });
  return data;
}

async function rows(table, query = '', options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw Object.assign(new Error('Supabase no configurado.'), { status: 503 });
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.prefer ? { Prefer: options.prefer } : {}),
  };
  return jsonFetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function authUser(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken) return null;
  try {
    return await jsonFetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
  } catch { return null; }
}

function athleteSessionSecret() { return APP_ENCRYPTION_KEY || SUPABASE_SERVICE_ROLE_KEY; }

function readAthleteSessionToken(token) {
  const secret = athleteSessionSecret();
  if (!secret || !token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let received;
  try { received = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.athlete_id || !data.email || Number(data.exp) <= Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

async function athleteIdentity(req) {
  const cookies = parseCookies(req);
  const direct = readAthleteSessionToken(cookies.rf_athlete);
  if (direct) return { athleteId: direct.athlete_id, email: direct.email };
  const user = await authUser(cookies.rf_access);
  if (!user?.id) throw Object.assign(new Error('Acceso no válido.'), { status: 401 });
  const roles = await rows('user_roles', `user_id=eq.${encodeURIComponent(user.id)}&role=eq.athlete&select=role&limit=1`).catch(() => []);
  if (!roles.length) throw Object.assign(new Error('Acceso Athlete requerido.'), { status: 403 });
  const athletes = await rows('athletes', `user_id=eq.${encodeURIComponent(user.id)}&lifecycle_status=eq.active&select=id,email&limit=1`).catch(() => []);
  if (!athletes.length) throw Object.assign(new Error('Tu usuario no está vinculado a un deportista.'), { status: 409 });
  return { athleteId: athletes[0].id, email: athletes[0].email || user.email };
}

async function coachIdentity(req, athleteId) {
  const cookies = parseCookies(req);
  const user = await authUser(cookies.rf_access);
  if (!user?.id) throw Object.assign(new Error('Acceso no válido.'), { status: 401 });
  const roles = await rows('user_roles', `user_id=eq.${encodeURIComponent(user.id)}&role=eq.coach&select=role&limit=1`).catch(() => []);
  if (!roles.length) throw Object.assign(new Error('Acceso Coach requerido.'), { status: 403 });
  const links = await rows('coach_athletes', `coach_user_id=eq.${encodeURIComponent(user.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=athlete_id&limit=1`).catch(() => []);
  if (!links.length) throw Object.assign(new Error('No tienes acceso a este deportista.'), { status: 403 });
  return user;
}

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 100000) reject(Object.assign(new Error('Petición demasiado grande.'), { status: 413 })); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(Object.assign(new Error('JSON no válido.'), { status: 400 })); } });
    req.on('error', reject);
  });
}

function boundedNumber(value, min, max, nullable = true) {
  if (value === '' || value === null || value === undefined) return nullable ? null : min;
  const n = Number(value);
  if (!Number.isFinite(n)) return nullable ? null : min;
  return Math.min(max, Math.max(min, n));
}
function cleanText(value, max = 1000) { return String(value || '').trim().slice(0, max); }
function parseMeta(comment) {
  const text = String(comment || '');
  if (!text.startsWith(PREFIX)) return null;
  try { return JSON.parse(text.slice(PREFIX.length)); } catch { return null; }
}
function serializeMeta(meta) { return `${PREFIX}${JSON.stringify(meta)}`; }
function isFootballMode(profile) {
  const fields = Array.isArray(profile?.custom_fields) ? profile.custom_fields : [];
  return fields.some(item => String(item?.key || item?.name || '').toLowerCase() === 'sport' && String(item?.value || '').toLowerCase() === 'football');
}
function setFootballField(customFields, enabled) {
  const fields = Array.isArray(customFields) ? customFields.filter(item => String(item?.key || item?.name || '').toLowerCase() !== 'sport') : [];
  if (enabled) fields.push({ key: 'sport', value: 'football' });
  return fields;
}

async function profileForAthlete(athleteId) {
  const profiles = await rows('athlete_profiles', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=athlete_id,custom_fields,objective&limit=1`).catch(() => []);
  return profiles[0] || { athlete_id: athleteId, custom_fields: [], objective: '' };
}
async function footballRows(athleteId, limit = 120) {
  const logs = await rows('manual_session_logs', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&order=created_at.desc&limit=${Math.max(1, Math.min(250, Number(limit) || 120))}`).catch(() => []);
  return logs.map(log => ({ ...log, football: parseMeta(log.comment) })).filter(log => log.football);
}
function sessionMinutes(log) {
  const meta = log.football || {};
  if (meta.kind === 'match' && Number.isFinite(Number(meta.minutes_played))) return Number(meta.minutes_played);
  return Number(log.actual_duration_min || 0);
}
function publicLog(log) {
  const meta = log.football || parseMeta(log.comment) || {};
  const minutes = sessionMinutes({ ...log, football: meta });
  const rpe = Number(log.rpe || 0);
  return {
    id: log.id, created_at: log.created_at, workout_id: log.workout_id || null,
    kind: meta.kind || 'unknown', title: meta.title || '', duration_min: Number(log.actual_duration_min || 0),
    minutes_played: meta.minutes_played ?? null, rpe: log.rpe ?? null, load: minutes && rpe ? Math.round(minutes * rpe) : 0,
    feeling: log.feeling || null, pain: log.pain ?? null, pain_area: log.pain_area || null,
    energy: meta.energy ?? null, soreness: meta.soreness ?? null, note: meta.note || '',
    challenge_id: meta.challenge_id || null, challenge_result: meta.challenge_result || null,
  };
}
function summaryFromLogs(logs) {
  const now = Date.now(), seven = now - 7 * 86400000, twentyEight = now - 28 * 86400000;
  const activities = logs.filter(log => ['football_training', 'strength', 'match'].includes(log.football?.kind));
  const wellness = logs.filter(log => log.football?.kind === 'wellbeing');
  const challenges = logs.filter(log => log.football?.kind === 'challenge');
  const aggregate = cutoff => {
    const selected = activities.filter(log => new Date(log.created_at).getTime() >= cutoff);
    const output = { load: 0, minutes: 0, sessions: 0, football: 0, strength: 0, matches: 0, avg_rpe: null };
    let rpeSum = 0, rpeCount = 0;
    selected.forEach(log => {
      const item = publicLog(log);
      output.load += item.load;
      output.minutes += item.kind === 'match' ? Number(item.minutes_played || 0) : Number(item.duration_min || 0);
      output.sessions += 1;
      if (item.kind === 'football_training') output.football += 1;
      if (item.kind === 'strength') output.strength += 1;
      if (item.kind === 'match') output.matches += 1;
      if (Number.isFinite(Number(item.rpe))) { rpeSum += Number(item.rpe); rpeCount += 1; }
    });
    output.avg_rpe = rpeCount ? Math.round((rpeSum / rpeCount) * 10) / 10 : null;
    return output;
  };
  return {
    last_wellbeing: wellness.length ? publicLog(wellness[0]) : null,
    week: aggregate(seven), days28: aggregate(twentyEight), recent: logs.slice(0, 20).map(publicLog),
    challenges_28d: challenges.filter(log => new Date(log.created_at).getTime() >= twentyEight).length,
  };
}

async function saveFootballLog(athleteId, body, kind) {
  const meta = {
    kind, title: cleanText(body.title, 160), note: cleanText(body.note, 1000),
    minutes_played: kind === 'match' ? boundedNumber(body.minutes_played, 0, 180) : null,
    energy: kind === 'wellbeing' ? boundedNumber(body.energy, 1, 5) : null,
    soreness: kind === 'wellbeing' ? boundedNumber(body.soreness, 1, 5) : null,
    challenge_id: kind === 'challenge' ? cleanText(body.challenge_id, 120) : null,
    challenge_result: kind === 'challenge' ? cleanText(body.challenge_result, 300) : null,
    source: 'runflow-football',
  };
  const duration = kind === 'match' ? boundedNumber(body.minutes_played, 0, 180)
    : kind === 'wellbeing' || kind === 'challenge' ? 0 : boundedNumber(body.duration_min, 0, 360);
  const row = {
    id: crypto.randomUUID(), athlete_id: athleteId, workout_id: cleanText(body.workout_id, 80) || null, status: 'completed',
    actual_duration_min: duration,
    rpe: ['football_training', 'strength', 'match'].includes(kind) ? boundedNumber(body.rpe, 1, 10) : null,
    pain: boundedNumber(body.pain, 0, 10),
    feeling: ['muy_bien', 'bien', 'normal', 'mal'].includes(body.feeling) ? body.feeling : null,
    pain_area: cleanText(body.pain_area, 180) || null,
    comment: serializeMeta(meta), created_at: new Date().toISOString(),
  };
  await rows('manual_session_logs', '', { method: 'POST', body: row, prefer: 'return=representation' });
  return publicLog({ ...row, football: meta });
}

async function handleFootballApi(req, res, url) {
  const method = String(req.method || 'GET').toUpperCase();
  if (url.pathname === '/api/athlete/football/summary' && method === 'GET') {
    const identity = await athleteIdentity(req), profile = await profileForAthlete(identity.athleteId), logs = await footballRows(identity.athleteId, 160);
    return sendJson(res, 200, { mode: isFootballMode(profile), profile, ...summaryFromLogs(logs) });
  }
  if (url.pathname === '/api/athlete/football/wellbeing' && method === 'POST') {
    const identity = await athleteIdentity(req), body = await readJson(req);
    return sendJson(res, 201, { log: await saveFootballLog(identity.athleteId, body, 'wellbeing') });
  }
  if (url.pathname === '/api/athlete/football/activity' && method === 'POST') {
    const identity = await athleteIdentity(req), body = await readJson(req);
    const kind = ['football_training', 'strength', 'match'].includes(body.kind) ? body.kind : null;
    if (!kind) throw Object.assign(new Error('Tipo de actividad no válido.'), { status: 400 });
    if (!body.rpe) throw Object.assign(new Error('RPE obligatorio.'), { status: 400 });
    if (kind === 'match' && body.minutes_played === undefined) throw Object.assign(new Error('Minutos jugados obligatorios.'), { status: 400 });
    if (kind !== 'match' && body.duration_min === undefined) throw Object.assign(new Error('Duración obligatoria.'), { status: 400 });
    return sendJson(res, 201, { log: await saveFootballLog(identity.athleteId, body, kind) });
  }
  if (url.pathname === '/api/athlete/football/challenge' && method === 'POST') {
    const identity = await athleteIdentity(req), body = await readJson(req);
    return sendJson(res, 201, { log: await saveFootballLog(identity.athleteId, body, 'challenge') });
  }
  const modeMatch = url.pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/football-mode$/);
  if (modeMatch && method === 'POST') {
    const athleteId = decodeURIComponent(modeMatch[1]); await coachIdentity(req, athleteId);
    const body = await readJson(req), profile = await profileForAthlete(athleteId), custom_fields = setFootballField(profile.custom_fields, body.enabled !== false);
    const updated = await rows('athlete_profiles', `athlete_id=eq.${encodeURIComponent(athleteId)}`, { method: 'PATCH', body: { custom_fields, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
    return sendJson(res, 200, { enabled: isFootballMode(updated[0] || { custom_fields }), profile: updated[0] || { custom_fields } });
  }
  const summaryMatch = url.pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/football-summary$/);
  if (summaryMatch && method === 'GET') {
    const athleteId = decodeURIComponent(summaryMatch[1]); await coachIdentity(req, athleteId);
    const profile = await profileForAthlete(athleteId), logs = await footballRows(athleteId, 200);
    return sendJson(res, 200, { mode: isFootballMode(profile), profile, ...summaryFromLogs(logs) });
  }
  return false;
}

const previousCreateServer = http.createServer;
http.createServer = function footballApiCreateServer(listener) {
  return previousCreateServer.call(http, async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const relevant = url.pathname.startsWith('/api/athlete/football/') || /^\/api\/coach\/athletes\/[^/]+\/football-(mode|summary)$/.test(url.pathname);
      if (relevant) {
        const handled = await handleFootballApi(req, res, url);
        if (handled !== false) return;
      }
    } catch (error) {
      console.error('[football-api]', error);
      return sendJson(res, Number(error.status || 500), { error: error.message || 'Error interno.' });
    }
    return listener(req, res);
  });
};
