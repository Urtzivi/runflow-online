'use strict';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const APP_ENCRYPTION_KEY = String(process.env.APP_ENCRYPTION_KEY || '');
const PREFIX = 'RF_FOOTBALL|';
const PROGRAM_CATEGORY = '__runflow_football_program__';
const DEMO_MODE = process.env.DEMO_MODE === '1';
const Schedule = require('./public/js/football-schedule.js');

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

// En DEMO_MODE las tablas viven en data/demo-football.json para poder probar el módulo en local.
const demoStore = (() => {
  if (!DEMO_MODE) return null;
  const fs = require('fs'), path = require('path');
  const file = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'demo-football.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
  const save = () => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (error) { console.warn('[football-api] demo', error.message); } };
  return {
    query(table, query, options) {
      const list = data[table] || (data[table] = []);
      const params = new URLSearchParams(query);
      const filters = [...params.entries()].filter(([k, v]) => !['select', 'order', 'limit'].includes(k) && v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
      const match = row => filters.every(([k, v]) => String(row[k]) === v);
      const method = options.method || 'GET';
      if (method === 'POST') { const row = { ...options.body }; list.push(row); save(); return [row]; }
      if (method === 'PATCH') { const out = []; list.forEach(row => { if (match(row)) { Object.assign(row, options.body); out.push(row); } }); save(); return out; }
      if (method === 'DELETE') { data[table] = list.filter(row => !match(row)); save(); return []; }
      let out = list.filter(match);
      const order = params.get('order');
      if (order) { const [col, dir] = order.split('.'); out = out.slice().sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1)); }
      const limit = Number(params.get('limit')); if (limit) out = out.slice(0, limit);
      return out;
    },
  };
})();
function demoUsers() {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(process.env.DATA_DIR || require('path').join(__dirname, 'data'), 'demo-state.json'), 'utf8')).users || []; } catch { return []; }
}
function demoUser(req) {
  const id = parseCookies(req).rf_demo_user;
  const fallback = { 'u-urtzi': { id: 'u-urtzi', roles: ['coach', 'athlete'], athlete_id: 'a-urtzi', email: 'urtzi@suibroker.es' }, 'u-ibon': { id: 'u-ibon', roles: ['athlete'], athlete_id: 'a-ibon', email: 'larri_hc@hotmail.es' } };
  return demoUsers().find(user => user.id === id) || fallback[id] || null;
}

async function rows(table, query = '', options = {}) {
  if (demoStore) return demoStore.query(table, query, options);
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
  if (DEMO_MODE) {
    const user = demoUser(req);
    if (!user?.athlete_id) throw Object.assign(new Error('Acceso no válido.'), { status: 401 });
    return { athleteId: user.athlete_id, email: user.email };
  }
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
  if (DEMO_MODE) {
    const user = demoUser(req);
    if (!user || !(user.roles || []).includes('coach')) throw Object.assign(new Error('Acceso Coach requerido.'), { status: 403 });
    return user;
  }
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
    req.on('data', chunk => { body += chunk; if (body.length > 400000) reject(Object.assign(new Error('Petición demasiado grande.'), { status: 413 })); });
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
  return fields.some(item => String(item?.key || item?.name || item?.label || '').toLowerCase() === 'sport' && String(item?.value || '').toLowerCase() === 'football');
}
function setFootballField(customFields, enabled) {
  const fields = Array.isArray(customFields) ? customFields.filter(item => String(item?.key || item?.name || item?.label || '').toLowerCase() !== 'sport') : [];
  if (enabled) fields.push({ key: 'sport', label: 'sport', value: 'football' });
  return fields;
}

// Programa de fútbol editable por el coach: una fila interna de workout_templates por deportista.
function programText(value, max = 300) { return cleanText(value, max).replace(/[<>"`]/g, ''); }
function programUrl(value) {
  const text = String(value || '').trim();
  return /^https?:\/\/[^\s"'<>`]+$/i.test(text) ? text.slice(0, 600) : '';
}
function programSteps(value) {
  const list = Array.isArray(value) ? value : String(value || '').split('\n');
  return list.map(step => programText(step, 300)).filter(Boolean).slice(0, 12);
}
function programId(value, fallback) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || fallback;
}
function sanitizeProgram(body) {
  const source = body && typeof body === 'object' ? body : {};
  const list = (value, max) => (Array.isArray(value) ? value : []).filter(item => item && typeof item === 'object').slice(0, max);
  const exercises = list(source.exercises, 40).map(item => ({
    group: programText(item.group, 80) || 'Sesión', name: programText(item.name, 120), detail: programText(item.detail, 80),
    sub: programText(item.sub, 300), steps: programSteps(item.steps), img: programUrl(item.img), video: programUrl(item.video),
  })).filter(item => item.name);
  const usedIds = new Set();
  const uniqueId = (value, prefix, index) => {
    let id = programId(value, `${prefix}${index + 1}`);
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    return id;
  };
  const drills = list(source.drills, 40).map((item, index) => ({
    id: uniqueId(item.id, 'drill', index), cat: ['conduccion', 'control', 'tiro'].includes(item.cat) ? item.cat : 'conduccion',
    name: programText(item.name, 120), time: programText(item.time, 40), space: programText(item.space, 160),
    objective: programText(item.objective, 300), steps: programSteps(item.steps), cues: programText(item.cues, 400),
    volume: programText(item.volume, 160), img: programUrl(item.img), video: programUrl(item.video),
  })).filter(item => item.name);
  const challenge = (type, prefix) => (item, index) => ({
    id: uniqueId(item.id, prefix, index), type, title: programText(item.title, 140), time: programText(item.time, 40),
    material: programText(item.material, 160), objective: programText(item.objective, 300), steps: programSteps(item.steps),
    cue: programText(item.cue, 300), result: programText(item.result, 120), img: programUrl(item.img),
  });
  const challenges = source.challenges && typeof source.challenges === 'object' ? source.challenges : {};
  const rawSession = source.session && typeof source.session === 'object' ? source.session : {};
  const session = {
    title: programText(rawSession.title, 120), duration_min: boundedNumber(rawSession.duration_min, 0, 300),
    focus: programText(rawSession.focus, 160), note: programText(rawSession.note, 300),
  };
  const program = {};
  const content = ['session', 'exercises', 'drills', 'challenges'].some(key => source[key] !== undefined);
  if (content) {
    Object.assign(program, {
      session, exercises, drills,
      challenges: {
        technical: list(challenges.technical, 30).map(challenge('Reto técnico', 'tech')).filter(item => item.title),
        quick: list(challenges.quick, 30).map(challenge('Reto rápido', 'quick')).filter(item => item.title),
      },
    });
    if (!program.exercises.length && !program.drills.length && !program.challenges.technical.length && !program.challenges.quick.length) {
      throw Object.assign(new Error('El programa está vacío.'), { status: 400 });
    }
  }
  // Semana del deportista (entrenos, partidos, cambios) y circuitos de fuerza.
  if (source.schedule !== undefined) program.schedule = Schedule.sanitizeSchedule(source.schedule);
  if (source.strength !== undefined) program.strength = Schedule.sanitizeStrength(source.strength);
  if (!Object.keys(program).length) throw Object.assign(new Error('El programa está vacío.'), { status: 400 });
  return program;
}
async function programRow(athleteId) {
  const found = await rows('workout_templates', `athlete_id=eq.${encodeURIComponent(athleteId)}&category=eq.${encodeURIComponent(PROGRAM_CATEGORY)}&select=id,template_data,updated_at&order=updated_at.desc&limit=1`);
  return found[0] || null;
}
function publicProgram(row) {
  return { program: row?.template_data || null, updated_at: row?.updated_at || null };
}
async function saveProgram(user, athleteId, body) {
  const now = new Date().toISOString(), existing = await programRow(athleteId);
  // Cada editor guarda solo sus partes (contenido, semana o fuerza); el resto se conserva.
  const program = { ...(existing?.template_data || {}), ...sanitizeProgram(body?.program || body) };
  if (program.schedule) program.schedule.start = existing?.template_data?.schedule?.start || program.schedule.start || Schedule.todayMadrid();
  if (existing) {
    const updated = await rows('workout_templates', `id=eq.${encodeURIComponent(existing.id)}`, { method: 'PATCH', body: { template_data: program, updated_at: now }, prefer: 'return=representation' });
    return publicProgram(updated[0] || { template_data: program, updated_at: now });
  }
  const row = {
    id: crypto.randomUUID(), coach_user_id: user.id, athlete_id: athleteId, name: 'Programa RunFlow Fútbol',
    category: PROGRAM_CATEGORY, sport: 'Internal', stimulus: 'football-program', template_data: program, created_at: now, updated_at: now,
  };
  const created = await rows('workout_templates', '', { method: 'POST', body: row, prefer: 'return=representation' });
  return publicProgram(created[0] || row);
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
    plan_key: meta.plan_key || null, plan_date: meta.plan_date || null, body_state: meta.body_state ?? null, mood: meta.mood ?? null,
    date: meta.plan_date || madridDate(log.created_at),
  };
}
function madridDate(value) {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
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
    plan_key: cleanText(body.plan_key, 80) || null,
    plan_date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.plan_date || '')) ? body.plan_date : null,
    body_state: ['football_training', 'strength', 'match'].includes(kind) ? boundedNumber(body.body_state, 1, 4) : null,
    mood: ['football_training', 'strength', 'match'].includes(kind) ? boundedNumber(body.mood, 1, 5) : null,
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

// Semana resuelta (plan + valoraciones) y datos de carga y estado.
async function footballWeek(athleteId, from, to) {
  const [row, logs] = await Promise.all([programRow(athleteId), footballRows(athleteId, 250)]);
  const program = row?.template_data || {};
  const today = Schedule.todayMadrid();
  const activity = logs.filter(log => Schedule.RATED_KINDS.includes(log.football?.kind)).map(publicLog);
  const days = Schedule.attachRatings(Schedule.resolvePlan(program, from, to), activity, today);
  const pending = days.filter(day => day.date >= Schedule.addDays(today, -7)).flatMap(day => day.items.filter(item => item.pending)).reverse();
  return { today, from, to, days, pending, strength: program.strength || [], schedule: program.schedule || null, logs: activity, updated_at: row?.updated_at || null };
}
function footballStats(week) {
  const today = week.today, logs = week.logs;
  const inRange = (from, to) => logs.filter(log => log.date && log.date >= from && log.date <= to);
  const sum = list => list.reduce((acc, log) => acc + Number(log.load || 0), 0);
  const avg = (list, key) => { const v = list.map(log => Number(log[key])).filter(n => Number.isFinite(n) && n > 0); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
  const monday = Schedule.mondayOf(today);
  const weekLogs = inRange(monday, Schedule.addDays(monday, 6));
  const acute = sum(inRange(Schedule.addDays(today, -6), today));
  const chronic = sum(inRange(Schedule.addDays(today, -27), today)) / 4;
  // La relación aguda/crónica solo tiene sentido con al menos 3 semanas de valoraciones.
  const firstDate = logs.map(log => log.date).filter(Boolean).sort()[0];
  const enoughHistory = !!firstDate && firstDate <= Schedule.addDays(today, -21);
  const weekItems = week.days.filter(day => day.date >= monday && day.date <= today).flatMap(day => day.items.filter(item => Schedule.RATED_KINDS.includes(item.kind)));
  const last14 = inRange(Schedule.addDays(today, -13), today);
  const daily = [];
  for (let date = Schedule.addDays(today, -27); date <= today; date = Schedule.addDays(date, 1)) {
    const list = inRange(date, date);
    daily.push({ date, football_training: sum(list.filter(l => l.kind === 'football_training')), match: sum(list.filter(l => l.kind === 'match')), strength: sum(list.filter(l => l.kind === 'strength')) });
  }
  return {
    week_load: sum(weekLogs), avg_week_load_4: enoughHistory ? Math.round(chronic) : null, history_days: firstDate ? Schedule.daysBetween(firstDate, today) + 1 : 0, acute_7d: acute, acwr: enoughHistory && chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null,
    rated: weekItems.filter(item => item.rating).length, planned: weekItems.length,
    body_avg: avg(last14, 'body_state'), mood_avg: avg(last14, 'mood'), daily,
  };
}
function weekRange(url, back, ahead) {
  const today = Schedule.todayMadrid();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : Schedule.addDays(today, -back);
  let to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : Schedule.addDays(today, ahead);
  if (Schedule.daysBetween(from, to) > 120) to = Schedule.addDays(from, 120);
  return [from, to];
}

async function handleFootballApi(req, res, url) {
  if (url.pathname === '/api/athlete/football/week' && req.method === 'GET') {
    const identity = await athleteIdentity(req), [from, to] = weekRange(url, 7, 14);
    const week = await footballWeek(identity.athleteId, from, to);
    const used = new Set(week.days.flatMap(day => day.items.map(item => item.strength_id)).filter(Boolean));
    return sendJson(res, 200, { ...week, schedule: undefined, logs: undefined, strength: week.strength.filter(block => used.has(block.id)) });
  }
  const weekMatch = url.pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/football-week$/);
  if (weekMatch && req.method === 'GET') {
    const athleteId = decodeURIComponent(weekMatch[1]); await coachIdentity(req, athleteId);
    const [from, to] = weekRange(url, 28, 35);
    const week = await footballWeek(athleteId, from, to);
    return sendJson(res, 200, { ...week, stats: footballStats(week), logs: week.logs.slice(0, 60) });
  }
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
  if (url.pathname === '/api/athlete/football/program' && method === 'GET') {
    const identity = await athleteIdentity(req);
    return sendJson(res, 200, publicProgram(await programRow(identity.athleteId)));
  }
  const programMatch = url.pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/football-program$/);
  if (programMatch && ['GET', 'PUT', 'DELETE'].includes(method)) {
    const athleteId = decodeURIComponent(programMatch[1]), user = await coachIdentity(req, athleteId);
    if (method === 'GET') return sendJson(res, 200, publicProgram(await programRow(athleteId)));
    if (method === 'PUT') return sendJson(res, 200, await saveProgram(user, athleteId, await readJson(req)));
    await rows('workout_templates', `athlete_id=eq.${encodeURIComponent(athleteId)}&category=eq.${encodeURIComponent(PROGRAM_CATEGORY)}`, { method: 'DELETE', prefer: 'return=minimal' });
    return sendJson(res, 200, publicProgram(null));
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
      const relevant = url.pathname.startsWith('/api/athlete/football/') || /^\/api\/coach\/athletes\/[^/]+\/football-(mode|summary|program|week)$/.test(url.pathname);
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
