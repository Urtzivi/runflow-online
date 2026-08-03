'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DEMO_FILE = path.join(DATA_DIR, 'demo-state.json');
const DEMO_MODE = process.env.DEMO_MODE === '1';
const IS_PROD = process.env.NODE_ENV === 'production';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const APP_BASE_URL = String(process.env.APP_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const APP_ENCRYPTION_KEY = String(process.env.APP_ENCRYPTION_KEY || '');
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '');
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-5.6-terra');
const OPENAI_API_BASE = 'https://api.openai.com/v1';
const APP_VERSION = 'Online Pilot 1.2';
const INTERVALS_API_BASE = 'https://intervals.icu/api/v1';

function validateRuntimeConfig() {
  if (DEMO_MODE) return;
  const missing = [];
  for (const [key, value] of [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_ANON_KEY', SUPABASE_ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY],
    ['APP_ENCRYPTION_KEY', APP_ENCRYPTION_KEY],
    ['APP_BASE_URL', APP_BASE_URL],
  ]) {
    if (!value) missing.push(key);
  }
  if (missing.length) {
    throw new Error(`Faltan variables obligatorias: ${missing.join(', ')}`);
  }
  if (IS_PROD && !APP_BASE_URL.startsWith('https://')) {
    throw new Error('En producción APP_BASE_URL debe comenzar por https://');
  }
  // Valida la clave de cifrado antes de aceptar tráfico.
  encryptionKey();
}

function securityHeaders() {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (IS_PROD) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(DATA_DIR);

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...securityHeaders(),
    ...headers,
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(text),
    ...securityHeaders(),
  });
  res.end(text);
}

function readJson(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(Object.assign(new Error('La solicitud es demasiado grande.'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error('JSON no válido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.sameSite !== false) parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure || IS_PROD) parts.push('Secure');
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join('; ');
}

function authCookies(accessToken, refreshToken, expiresIn = 3600) {
  return [
    cookie('rf_access', accessToken, { maxAge: Math.max(60, Number(expiresIn) || 3600) }),
    cookie('rf_refresh', refreshToken, { maxAge: 60 * 60 * 24 * 30 }),
  ];
}

function clearAuthCookies() {
  return [cookie('rf_access', '', { maxAge: 0 }), cookie('rf_refresh', '', { maxAge: 0 })];
}

function startOfWeek(input = new Date()) {
  const date = new Date(input);
  const day = date.getDay() || 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function demoSeed() {
  const weekStart = startOfWeek();
  const workout = (day, title, summary, load, sport = 'Run') => ({
    id: crypto.randomUUID(),
    workout_date: addDays(weekStart, day),
    sport,
    title,
    summary,
    planned_load: load,
    structured_description: summary,
    blocks: [],
  });
  const demoIntervals = (paces, hrs) => paces.map((pace, index) => ({
    type: 'WORK', name: `Serie ${index + 1}`, moving_time: 180, distance: Math.round(180 / (pace / 1000)),
    average_speed: 1000 / pace, average_heartrate: hrs[index], max_heartrate: hrs[index] + 5,
  }));
  const activity = (athleteId, day, name, load, distance, duration, avgHr, maxHr, paces = []) => ({
    id: crypto.randomUUID(), athlete_id: athleteId, intervals_activity_id: `demo-${athleteId}-${day}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    activity_date: `${addDays(weekStart, day)}T18:00:00Z`, sport: 'Run', name, duration_sec: duration, distance_m: distance, load, avg_hr: avgHr, max_hr: maxHr,
    avg_pace_sec_per_km: distance > 0 ? duration / (distance / 1000) : null,
    raw_summary: { id: `demo-${athleteId}-${day}`, name, type: 'Run', start_date_local: `${addDays(weekStart, day)}T18:00:00`, moving_time: duration, distance, icu_training_load: load, average_heartrate: avgHr, max_heartrate: maxHr, average_speed: distance / duration, icu_intervals: demoIntervals(paces, paces.map((_, i) => avgHr - 5 + i * 2)) },
  });
  const wellnessRows = (athleteId, baseFitness, baseRhr, baseHrv) => Array.from({ length: 24 }, (_, index) => {
    const date = addDays(weekStart, index - 20);
    const fitness = baseFitness + Math.round(index / 8);
    const fatigue = Math.max(10, fitness + ((index % 5) - 2) * 3);
    const sleep = 6.6 + ((index % 6) * .18);
    const rhr = baseRhr + ((index % 5) - 2);
    const hrv = baseHrv + ((index % 7) - 3) * 1.8;
    return { id: crypto.randomUUID(), athlete_id: athleteId, metric_date: date, fitness, fatigue, form: fitness - fatigue, load: index % 3 ? 38 : 0, week_load: 190 + index * 2, planned_load: 225, sleep_sec: Math.round(sleep * 3600), resting_hr: rhr, hrv, readiness_score: 72 + ((index % 5) - 2) * 3, readiness_label: 'Buena, con carga controlada', source: 'demo' };
  });

  return {
    users: [
      { id: 'u-urtzi', email: 'urtzi@suibroker.es', password: 'runflow', display_name: 'Urtzi', roles: ['coach', 'athlete'], athlete_id: 'a-urtzi' },
      { id: 'u-ibon', email: 'larri_hc@hotmail.es', password: 'runflow', display_name: 'Ibon Larrinaga', roles: ['athlete'], athlete_id: 'a-ibon' },
    ],
    athletes: [
      {
        id: 'a-urtzi', user_id: 'u-urtzi', display_name: 'Urtzi', email: 'urtzi@suibroker.es', intervals_status: 'connected',
        profile: { birth_date: '1979-07-17', sex: 'M', weight_kg: 73, height_cm: 175, watch_brand: 'Garmin', watch_model: 'Fénix 5', level: 'Avanzado', objective: 'Mejorar rendimiento en running y trail', coach_notes: '', custom_fields: [] },
        zones: {
          hr: [
            { name: 'Z1 Recuperación', min_value: 95, max_value: 119 },
            { name: 'Z2 Aeróbica', min_value: 120, max_value: 139 },
            { name: 'Z3 Tempo', min_value: 140, max_value: 149 },
            { name: 'Z4 Umbral', min_value: 150, max_value: 158 },
            { name: 'Z5 Alta intensidad', min_value: 159, max_value: 180 },
          ],
          pace: [
            { name: 'Z1 Recuperación', slow_pace: '06:00', fast_pace: '05:15' },
            { name: 'Z2 Aeróbica', slow_pace: '05:10', fast_pace: '04:40' },
            { name: 'Z3 Tempo', slow_pace: '04:35', fast_pace: '04:10' },
            { name: 'Z4 Umbral', slow_pace: '04:09', fast_pace: '03:52' },
            { name: 'Z5 VO2', slow_pace: '03:51', fast_pace: '03:20' },
          ],
        },
        goals: [
          { id: crypto.randomUUID(), name: 'Trail 27 km', goal_date: addDays(weekStart, 54), priority: 'Principal', status: 'active' },
          { id: crypto.randomUUID(), name: '10 km de control', goal_date: addDays(weekStart, 19), priority: 'Secundario', status: 'active' },
        ],
        metrics: { fitness: 43, fatigue: 51, form: -8, week_load: 216, planned_load: 245, readiness_score: 72, readiness_label: 'Buena, con carga controlada' },
        week: {
          id: 'w-urtzi', week_start: weekStart, week_type: 'Carga controlada', title: 'Consolidar la calidad sin acumular fatiga',
          coach_comment: 'Buscamos mantener el estímulo de calidad y llegar con buenas piernas al fin de semana. Respeta los rodajes suaves y no añadas intensidad.',
          target_load: 245, status: 'published', published_at: new Date().toISOString(),
          workouts: [
            workout(0, 'Descanso y movilidad', '15 min de movilidad suave', 5),
            workout(1, '6 × 3 min ritmo 5K', '15 min suave + 6 × 3 min Z5 con 2 min suaves + 10 min enfriamiento', 68),
            workout(2, 'Rodaje aeróbico', '45 min en Z2', 38),
            workout(3, 'Fuerza funcional', '35 min de fuerza general', 30, 'Strength'),
            workout(4, 'Umbral controlado', '3 × 8 min en Z4 con 2 min suaves', 58),
            workout(5, 'Recuperación', '35 min muy suaves', 24),
            workout(6, 'Trail largo', '1 h 35 min con 650 m+', 72),
          ],
        },
      },
      {
        id: 'a-ibon', user_id: 'u-ibon', display_name: 'Ibon Larrinaga', email: 'larri_hc@hotmail.es', intervals_status: 'pending',
        profile: { birth_date: '', sex: '', weight_kg: '', height_cm: '', watch_brand: 'Suunto', watch_model: 'Suunto Run', level: '', objective: '', coach_notes: 'Completar la ficha inicial desde la web del coach.', custom_fields: [] },
        zones: { hr: [], pace: [] },
        goals: [
          { id: crypto.randomUUID(), name: 'Definir primer objetivo', goal_date: addDays(weekStart, 80), priority: 'Principal', status: 'active' },
        ],
        metrics: { fitness: 24, fatigue: 18, form: 6, week_load: 0, planned_load: 142, readiness_score: 80, readiness_label: 'Fresco para entrenar' },
        week: {
          id: 'w-ibon', week_start: weekStart, week_type: 'Adaptación', title: 'Conocer su respuesta y crear regularidad',
          coach_comment: 'Esta primera semana busca establecer una rutina sostenible. No añadas intensidad ni volumen fuera de lo programado.',
          target_load: 142, status: 'published', published_at: new Date().toISOString(),
          workouts: [
            workout(0, 'Descanso', 'Descanso completo', 0),
            workout(1, 'Rodaje suave', '35 min cómodos, respiración controlada', 28),
            workout(2, 'Fuerza general', '30 min de fuerza técnica', 22, 'Strength'),
            workout(3, 'Cambios cortos', '15 min suave + 6 × 1 min alegre / 2 min suave + 10 min suave', 38),
            workout(4, 'Descanso', 'Descanso o paseo', 0),
            workout(5, 'Rodaje progresivo', '45 min terminando algo más vivo', 34),
            workout(6, 'Tirada cómoda', '55 min en terreno sencillo', 42),
          ],
        },
      },
    ],
    coach_athletes: [{ coach_user_id: 'u-urtzi', athlete_id: 'a-urtzi' }, { coach_user_id: 'u-urtzi', athlete_id: 'a-ibon' }],
    manual_logs: [],
    activities: [
      activity('a-urtzi', -5, 'Rodaje aeróbico', 44, 10120, 3010, 132, 146),
      activity('a-urtzi', -2, '6 × 3 min ritmo 5K', 69, 11250, 3375, 151, 164, [218, 216, 217, 219, 221, 222]),
      activity('a-ibon', -4, 'Rodaje suave', 31, 6500, 2450, 139, 153),
    ],
    daily_metrics: [...wellnessRows('a-urtzi', 42, 47, 44), ...wellnessRows('a-ibon', 23, 52, 38)],
    activity_reviews: [],
  };
}

function loadDemo() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DEMO_FILE, 'utf8'));
    if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.athletes)) return parsed;
  } catch {}
  const seed = demoSeed();
  fs.writeFileSync(DEMO_FILE, JSON.stringify(seed, null, 2), 'utf8');
  return seed;
}

let demo = loadDemo();
if (!Array.isArray(demo.activities)) demo.activities = [];
if (!Array.isArray(demo.daily_metrics)) demo.daily_metrics = [];
if (!Array.isArray(demo.activity_reviews)) demo.activity_reviews = [];
function saveDemo() {
  fs.writeFileSync(DEMO_FILE, JSON.stringify(demo, null, 2), 'utf8');
}

async function supabaseFetch(endpoint, options = {}, key = SUPABASE_SERVICE_ROLE_KEY) {
  if (!SUPABASE_URL || !key) throw Object.assign(new Error('Supabase no está configurado.'), { status: 503 });
  const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${options.accessToken || key}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data && typeof data === 'object' ? (data.msg || data.message || data.error_description || data.error) : data;
    throw Object.assign(new Error(message || `Supabase respondió con HTTP ${response.status}.`), { status: response.status, details: data });
  }
  return data;
}

async function authLogin(email, password) {
  return supabaseFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, SUPABASE_ANON_KEY);
}

async function authRefresh(refreshToken) {
  return supabaseFetch('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  }, SUPABASE_ANON_KEY);
}

async function authUser(accessToken) {
  return supabaseFetch('/auth/v1/user', { method: 'GET', accessToken }, SUPABASE_ANON_KEY);
}

async function getProductionSession(req, res) {
  const cookies = parseCookies(req);
  let access = cookies.rf_access;
  let refresh = cookies.rf_refresh;
  if (!access) return null;
  try {
    const user = await authUser(access);
    return { user, access, refresh };
  } catch (error) {
    if (!refresh) return null;
    try {
      const refreshed = await authRefresh(refresh);
      access = refreshed.access_token;
      refresh = refreshed.refresh_token || refresh;
      res.setHeader('Set-Cookie', authCookies(access, refresh, refreshed.expires_in));
      return { user: refreshed.user || await authUser(access), access, refresh };
    } catch {
      return null;
    }
  }
}

function demoSession(req) {
  const cookies = parseCookies(req);
  const id = cookies.rf_demo_user;
  const user = demo.users.find(item => item.id === id);
  return user ? { user } : null;
}

async function getSession(req, res) {
  return DEMO_MODE ? demoSession(req) : getProductionSession(req, res);
}

async function prodRows(table, query = '', options = {}) {
  return supabaseFetch(`/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method: options.method || 'GET',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      Prefer: options.prefer || (options.method && options.method !== 'GET' ? 'return=representation' : ''),
      ...(options.headers || {}),
    },
  });
}

async function prodUserContext(userId) {
  const roles = await prodRows('user_roles', `user_id=eq.${encodeURIComponent(userId)}&select=role`);
  const athlete = await prodRows('athletes', `user_id=eq.${encodeURIComponent(userId)}&select=id,display_name,email&limit=1`);
  return { roles: roles.map(item => item.role), athlete_id: athlete[0] ? athlete[0].id : null };
}

async function requireSession(req, res) {
  const session = await getSession(req, res);
  if (!session) throw Object.assign(new Error('Debes iniciar sesión.'), { status: 401 });
  if (DEMO_MODE) return { ...session, roles: session.user.roles, athlete_id: session.user.athlete_id };
  const context = await prodUserContext(session.user.id);
  return { ...session, ...context };
}

function requireRole(session, role) {
  if (!session.roles.includes(role)) throw Object.assign(new Error('No tienes permiso para realizar esta acción.'), { status: 403 });
}

async function ensureCoachAccess(session, athleteId) {
  requireRole(session, 'coach');
  if (DEMO_MODE) {
    const allowed = demo.coach_athletes.some(item => item.coach_user_id === session.user.id && item.athlete_id === athleteId);
    if (!allowed) throw Object.assign(new Error('No tienes acceso a este deportista.'), { status: 403 });
    return;
  }
  const rows = await prodRows('coach_athletes', `coach_user_id=eq.${encodeURIComponent(session.user.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=athlete_id&limit=1`);
  if (!rows.length) throw Object.assign(new Error('No tienes acceso a este deportista.'), { status: 403 });
}

function sanitiseText(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}
function numberOrNull(value, min = -Infinity, max = Infinity) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}

function normaliseProfile(body) {
  return {
    birth_date: validDate(body.birth_date),
    sex: ['M', 'F', 'X', ''].includes(String(body.sex || '')) ? String(body.sex || '') || null : null,
    weight_kg: numberOrNull(body.weight_kg, 20, 300),
    height_cm: numberOrNull(body.height_cm, 80, 250),
    phone: sanitiseText(body.phone, 50),
    watch_brand: sanitiseText(body.watch_brand, 80),
    watch_model: sanitiseText(body.watch_model, 120),
    level: sanitiseText(body.level, 80),
    experience_years: numberOrNull(body.experience_years, 0, 80),
    weekly_km: numberOrNull(body.weekly_km, 0, 500),
    weekly_hours: numberOrNull(body.weekly_hours, 0, 100),
    weekly_sessions: numberOrNull(body.weekly_sessions, 0, 30),
    availability: body.availability && typeof body.availability === 'object' ? body.availability : {},
    restrictions: sanitiseText(body.restrictions, 3000),
    injury_history: sanitiseText(body.injury_history, 4000),
    current_issues: sanitiseText(body.current_issues, 2000),
    objective: sanitiseText(body.objective, 2000),
    coach_notes: sanitiseText(body.coach_notes, 8000),
    custom_fields: Array.isArray(body.custom_fields) ? body.custom_fields.slice(0, 50).map(item => ({ label: sanitiseText(item.label, 100), value: sanitiseText(item.value, 1000) })) : [],
    updated_at: new Date().toISOString(),
  };
}

function normaliseZones(body) {
  const hr = Array.isArray(body.hr) ? body.hr.slice(0, 12).map((item, index) => ({
    kind: 'hr', zone_order: index + 1, name: sanitiseText(item.name || `Zona ${index + 1}`, 80),
    min_value: numberOrNull(item.min_value, 20, 260), max_value: numberOrNull(item.max_value, 20, 260),
    slow_pace: null, fast_pace: null,
  })) : [];
  const pace = Array.isArray(body.pace) ? body.pace.slice(0, 12).map((item, index) => ({
    kind: 'pace', zone_order: index + 1, name: sanitiseText(item.name || `Zona ${index + 1}`, 80),
    min_value: null, max_value: null, slow_pace: sanitiseText(item.slow_pace, 10), fast_pace: sanitiseText(item.fast_pace, 10),
  })) : [];
  return { hr, pace };
}

function normaliseWeek(body, athleteId) {
  const weekStart = validDate(body.week_start) || startOfWeek();
  const workouts = Array.isArray(body.workouts) ? body.workouts.slice(0, 14).map((item, index) => ({
    id: item.id || crypto.randomUUID(),
    athlete_id: athleteId,
    workout_date: validDate(item.workout_date) || addDays(weekStart, Math.min(index, 6)),
    sport: sanitiseText(item.sport || 'Run', 40),
    title: sanitiseText(item.title || 'Sesión', 160),
    summary: sanitiseText(item.summary, 3000),
    structured_description: sanitiseText(item.structured_description || item.summary, 10000),
    planned_load: numberOrNull(item.planned_load, 0, 1000) || 0,
    blocks: Array.isArray(item.blocks) ? item.blocks.slice(0, 30) : [],
  })) : [];
  return {
    week_start: weekStart,
    week_type: sanitiseText(body.week_type || 'Carga controlada', 80),
    title: sanitiseText(body.title, 250),
    coach_comment: sanitiseText(body.coach_comment, 4000),
    target_load: numberOrNull(body.target_load, 0, 5000) || workouts.reduce((sum, item) => sum + Number(item.planned_load || 0), 0),
    status: body.status === 'published' ? 'published' : 'draft',
    workouts,
  };
}


function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

async function listCalendarWeeks(athleteId, oldest, newest) {
  const rangeStart = validDate(oldest) || addDays(startOfWeek(), -35);
  const rangeEnd = validDate(newest) || addDays(startOfWeek(), 42);
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    const candidates = [];
    if (athlete.week && rangesOverlap(athlete.week.week_start, addDays(athlete.week.week_start, 6), rangeStart, rangeEnd)) {
      candidates.push(JSON.parse(JSON.stringify(athlete.week)));
    }
    return candidates.sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)));
  }
  const weeks = await prodRows(
    'training_weeks',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&week_start=gte.${rangeStart}&week_start=lte.${rangeEnd}&select=*&order=week_start.asc`
  );
  if (!weeks.length) return [];
  const ids = weeks.map(item => item.id);
  const workouts = await prodRows(
    'workouts',
    `training_week_id=in.(${ids.join(',')})&select=*&order=workout_date.asc`
  );
  const grouped = new Map();
  workouts.forEach(item => {
    if (!grouped.has(item.training_week_id)) grouped.set(item.training_week_id, []);
    grouped.get(item.training_week_id).push(item);
  });
  return weeks.map(week => ({ ...week, workouts: grouped.get(week.id) || [] }));
}

async function publishedWeekExists(athleteId, weekStart) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    return Boolean(athlete && athlete.week && athlete.week.week_start === weekStart && athlete.week.status === 'published');
  }
  const rows = await prodRows(
    'training_weeks',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&week_start=eq.${weekStart}&status=eq.published&select=id&limit=1`
  );
  return rows.length > 0;
}

async function demoAthleteBundle(athleteId) {
  const athlete = demo.athletes.find(item => item.id === athleteId);
  if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
  const clone = JSON.parse(JSON.stringify(athlete));
  clone.app_access_status = clone.user_id ? 'active' : 'pending';
  return clone;
}

async function prodAthleteBundle(athleteId, weekStart = startOfWeek()) {
  const athleteRows = await prodRows('athletes', `id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`);
  if (!athleteRows.length) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
  const [profiles, zones, goals, weeks, metrics] = await Promise.all([
    prodRows('athlete_profiles', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`),
    prodRows('training_zones', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&order=kind.asc,zone_order.asc`),
    prodRows('goals', `athlete_id=eq.${encodeURIComponent(athleteId)}&status=eq.active&select=*&order=goal_date.asc`),
    prodRows('training_weeks', `athlete_id=eq.${encodeURIComponent(athleteId)}&week_start=eq.${weekStart}&select=*&limit=1`),
    prodRows('daily_metrics', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&order=metric_date.desc&limit=1`),
  ]);
  const week = weeks[0] || { week_start: weekStart, week_type: '', title: '', coach_comment: '', target_load: 0, status: 'draft' };
  const workouts = week.id ? await prodRows('workouts', `training_week_id=eq.${encodeURIComponent(week.id)}&select=*&order=workout_date.asc`) : [];
  return {
    ...athleteRows[0],
    app_access_status: athleteRows[0].user_id ? 'active' : 'pending',
    profile: profiles[0] || {},
    zones: { hr: zones.filter(item => item.kind === 'hr'), pace: zones.filter(item => item.kind === 'pace') },
    goals,
    metrics: metrics[0] || { fitness: 0, fatigue: 0, form: 0, week_load: 0, planned_load: week.target_load || 0, readiness_score: 50, readiness_label: 'Sin datos suficientes' },
    week: { ...week, workouts },
  };
}

async function listCoachAthletes(session) {
  if (DEMO_MODE) {
    const ids = demo.coach_athletes.filter(item => item.coach_user_id === session.user.id).map(item => item.athlete_id);
    return demo.athletes.filter(item => ids.includes(item.id)).map(item => ({
      id: item.id, display_name: item.display_name, email: item.email, intervals_status: item.intervals_status,
      user_id: item.user_id || null, app_access_status: item.user_id ? 'active' : 'pending',
    })).sort((a, b) => a.display_name.localeCompare(b.display_name, 'es'));
  }
  const joins = await prodRows('coach_athletes', `coach_user_id=eq.${encodeURIComponent(session.user.id)}&select=athlete_id`);
  const ids = joins.map(item => item.athlete_id);
  if (!ids.length) return [];
  const rows = await prodRows('athletes', `id=in.(${ids.join(',')})&select=id,user_id,display_name,email,intervals_status&order=display_name.asc`);
  return rows.map(item => ({ ...item, app_access_status: item.user_id ? 'active' : 'pending' }));
}

async function findAuthUserByEmail(email) {
  for (let page = 1; page <= 20; page += 1) {
    const data = await supabaseFetch(`/auth/v1/admin/users?page=${page}&per_page=100`);
    const users = Array.isArray(data.users) ? data.users : [];
    const found = users.find(user => String(user.email || '').toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (users.length < 100) break;
  }
  return null;
}

async function inviteAthleteUser(session, athleteId) {
  await ensureCoachAccess(session, athleteId);
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    if (athlete.user_id) return { user_id: athlete.user_id, app_access_status: 'active', message: 'El acceso ya estaba creado.' };
    let user = demo.users.find(item => item.email.toLowerCase() === athlete.email.toLowerCase());
    if (!user) {
      user = { id: `u-${crypto.randomUUID()}`, email: athlete.email, password: 'runflow', display_name: athlete.display_name, roles: ['athlete'], athlete_id: athlete.id };
      demo.users.push(user);
    } else {
      if (!user.roles.includes('athlete')) user.roles.push('athlete');
      user.athlete_id = athlete.id;
    }
    athlete.user_id = user.id;
    saveDemo();
    return { user_id: user.id, app_access_status: 'active', message: `Acceso demo activado para ${athlete.email}. Contraseña: runflow` };
  }
  const rows = await prodRows('athletes', `id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`);
  const athlete = rows[0];
  if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
  if (athlete.user_id) return { user_id: athlete.user_id, app_access_status: 'active', message: 'El acceso ya estaba creado.' };
  let user = await findAuthUserByEmail(athlete.email);
  if (!user) {
    user = await supabaseFetch('/auth/v1/invite', {
      method: 'POST',
      body: JSON.stringify({ email: athlete.email, data: { display_name: athlete.display_name }, redirect_to: `${APP_BASE_URL}/activate` }),
    });
  }
  await prodRows('profiles', 'on_conflict=id', {
    method: 'POST', body: { id: user.id, email: athlete.email, display_name: athlete.display_name, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  await prodRows('user_roles', 'on_conflict=user_id,role', {
    method: 'POST', body: { user_id: user.id, role: 'athlete' }, prefer: 'resolution=ignore-duplicates,return=minimal',
  });
  await prodRows('athletes', `id=eq.${encodeURIComponent(athleteId)}`, { method: 'PATCH', body: { user_id: user.id, updated_at: new Date().toISOString() } });
  return { user_id: user.id, app_access_status: 'active', message: `Invitación enviada a ${athlete.email}.` };
}

async function createCoachAthlete(session, body) {
  requireRole(session, 'coach');
  const displayName = sanitiseText(body.display_name, 160);
  const email = sanitiseText(body.email, 200).toLowerCase();
  if (!displayName) throw Object.assign(new Error('Introduce el nombre del deportista.'), { status: 400 });
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error('Introduce un correo válido.'), { status: 400 });
  const intervalsStatus = ['pending', 'disabled'].includes(body.intervals_status) ? body.intervals_status : 'pending';
  if (DEMO_MODE) {
    if (demo.athletes.some(item => item.email.toLowerCase() === email)) throw Object.assign(new Error('Ya existe un deportista con ese correo.'), { status: 409 });
    const athleteId = `a-${crypto.randomUUID()}`;
    const athlete = {
      id: athleteId, user_id: null, display_name: displayName, email, intervals_status: intervalsStatus,
      profile: {
        birth_date: '', sex: '', weight_kg: '', height_cm: '', phone: sanitiseText(body.phone, 50),
        watch_brand: sanitiseText(body.watch_brand, 80), watch_model: sanitiseText(body.watch_model, 120),
        level: '', objective: sanitiseText(body.objective, 2000), coach_notes: '', custom_fields: [], availability: {},
      },
      zones: { hr: [], pace: [] }, goals: [],
      metrics: { fitness: 0, fatigue: 0, form: 0, week_load: 0, planned_load: 0, readiness_score: 50, readiness_label: 'Sin datos suficientes' },
      week: { id: `w-${crypto.randomUUID()}`, week_start: startOfWeek(), week_type: 'Planificación inicial', title: '', coach_comment: '', target_load: 0, status: 'draft', workouts: [] },
    };
    demo.athletes.push(athlete);
    demo.coach_athletes.push({ coach_user_id: session.user.id, athlete_id: athleteId });
    saveDemo();
    if (body.invite) await inviteAthleteUser(session, athleteId);
    return demoAthleteBundle(athleteId);
  }
  const duplicate = await prodRows('athletes', `email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
  if (duplicate.length) throw Object.assign(new Error('Ya existe un deportista con ese correo.'), { status: 409 });
  const created = await prodRows('athletes', '', { method: 'POST', body: { display_name: displayName, email, intervals_status: intervalsStatus } });
  const athlete = created[0];
  await Promise.all([
    prodRows('coach_athletes', 'on_conflict=coach_user_id,athlete_id', { method: 'POST', body: { coach_user_id: session.user.id, athlete_id: athlete.id }, prefer: 'resolution=ignore-duplicates,return=minimal' }),
    prodRows('athlete_profiles', 'on_conflict=athlete_id', { method: 'POST', body: { athlete_id: athlete.id, phone: sanitiseText(body.phone, 50), watch_brand: sanitiseText(body.watch_brand, 80), watch_model: sanitiseText(body.watch_model, 120), objective: sanitiseText(body.objective, 2000), availability: {}, custom_fields: [], updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=representation' }),
    prodRows('daily_metrics', 'on_conflict=athlete_id,metric_date', { method: 'POST', body: { athlete_id: athlete.id, metric_date: new Date().toISOString().slice(0, 10), fitness: 0, fatigue: 0, form: 0, week_load: 0, planned_load: 0, readiness_score: 50, readiness_label: 'Sin datos suficientes', source: 'runflow' }, prefer: 'resolution=merge-duplicates,return=representation' }),
    prodRows('training_weeks', 'on_conflict=athlete_id,week_start', { method: 'POST', body: { athlete_id: athlete.id, week_start: startOfWeek(), week_type: 'Planificación inicial', title: '', coach_comment: '', target_load: 0, status: 'draft', updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=representation' }),
  ]);
  if (body.invite) await inviteAthleteUser(session, athlete.id);
  return prodAthleteBundle(athlete.id, startOfWeek());
}

async function saveProfile(athleteId, body) {
  const profile = normaliseProfile(body);
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    athlete.profile = { ...athlete.profile, ...profile };
    if (body.display_name) athlete.display_name = sanitiseText(body.display_name, 160);
    if (body.email) athlete.email = sanitiseText(body.email, 200).toLowerCase();
    if (body.intervals_status) athlete.intervals_status = sanitiseText(body.intervals_status, 30);
    saveDemo();
    return demoAthleteBundle(athleteId);
  }
  if (body.display_name || body.email || body.intervals_status) {
    await prodRows('athletes', `id=eq.${encodeURIComponent(athleteId)}`, {
      method: 'PATCH',
      body: {
        ...(body.display_name ? { display_name: sanitiseText(body.display_name, 160) } : {}),
        ...(body.email ? { email: sanitiseText(body.email, 200).toLowerCase() } : {}),
        ...(body.intervals_status ? { intervals_status: sanitiseText(body.intervals_status, 30) } : {}),
      },
    });
  }
  await prodRows('athlete_profiles', 'on_conflict=athlete_id', { method: 'POST', body: { athlete_id: athleteId, ...profile }, prefer: 'resolution=merge-duplicates,return=representation' });
  return prodAthleteBundle(athleteId);
}

async function saveZones(athleteId, body) {
  const zones = normaliseZones(body);
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    athlete.zones = zones;
    saveDemo();
    return zones;
  }
  await prodRows('training_zones', `athlete_id=eq.${encodeURIComponent(athleteId)}`, { method: 'DELETE', prefer: 'return=minimal' });
  const rows = [...zones.hr, ...zones.pace].map(item => ({ athlete_id: athleteId, ...item }));
  if (rows.length) await prodRows('training_zones', '', { method: 'POST', body: rows });
  return zones;
}

async function saveWeek(athleteId, body, publish = false) {
  const week = normaliseWeek(body, athleteId);
  if (publish) {
    week.status = 'published';
    week.published_at = new Date().toISOString();
  }
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    athlete.week = { ...(athlete.week || {}), ...week, id: athlete.week && athlete.week.id ? athlete.week.id : crypto.randomUUID() };
    athlete.metrics.planned_load = week.target_load;
    saveDemo();
    return athlete.week;
  }
  const weekRows = await prodRows('training_weeks', 'on_conflict=athlete_id,week_start', {
    method: 'POST',
    body: {
      athlete_id: athleteId,
      week_start: week.week_start,
      week_type: week.week_type,
      title: week.title,
      coach_comment: week.coach_comment,
      target_load: week.target_load,
      status: week.status,
      published_at: week.published_at || null,
      updated_at: new Date().toISOString(),
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  const savedWeek = weekRows[0];
  await prodRows('workouts', `training_week_id=eq.${encodeURIComponent(savedWeek.id)}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (week.workouts.length) {
    await prodRows('workouts', '', {
      method: 'POST',
      body: week.workouts.map(item => ({
        training_week_id: savedWeek.id,
        athlete_id: athleteId,
        workout_date: item.workout_date,
        sport: item.sport,
        title: item.title,
        summary: item.summary,
        structured_description: item.structured_description,
        planned_load: item.planned_load,
        blocks: item.blocks,
        visible_to_athlete: week.status === 'published',
      })),
    });
  }
  return { ...savedWeek, workouts: week.workouts };
}

async function addGoal(athleteId, body) {
  const goal = {
    id: crypto.randomUUID(), athlete_id: athleteId,
    name: sanitiseText(body.name, 200),
    goal_date: validDate(body.goal_date),
    priority: ['Principal', 'Secundario'].includes(body.priority) ? body.priority : 'Secundario',
    distance_km: numberOrNull(body.distance_km, 0, 1000), elevation_m: numberOrNull(body.elevation_m, 0, 50000),
    performance_target: sanitiseText(body.performance_target, 500), notes: sanitiseText(body.notes, 2000), status: 'active',
  };
  if (!goal.name || !goal.goal_date) throw Object.assign(new Error('El objetivo necesita nombre y fecha.'), { status: 400 });
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    athlete.goals.push(goal); saveDemo(); return goal;
  }
  const rows = await prodRows('goals', '', { method: 'POST', body: goal });
  return rows[0];
}

async function deleteGoal(goalId, athleteId) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    athlete.goals = athlete.goals.filter(item => item.id !== goalId); saveDemo(); return;
  }
  await prodRows('goals', `id=eq.${encodeURIComponent(goalId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`, { method: 'DELETE', prefer: 'return=minimal' });
}

function encryptionKey() {
  if (!APP_ENCRYPTION_KEY || APP_ENCRYPTION_KEY.length < 24) {
    throw Object.assign(new Error('Falta APP_ENCRYPTION_KEY o es demasiado corta.'), { status: 503 });
  }
  // Acepta una clave base64 de 32 bytes o deriva una clave AES estable con SHA-256.
  try {
    const raw = Buffer.from(APP_ENCRYPTION_KEY, 'base64');
    if (raw.length === 32 && raw.toString('base64').replace(/=+$/, '') === APP_ENCRYPTION_KEY.replace(/=+$/, '')) return raw;
  } catch {}
  return crypto.createHash('sha256').update(APP_ENCRYPTION_KEY, 'utf8').digest();
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64') };
}

function decryptSecret(record) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(record.secret_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.secret_tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.secret_ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

async function setIntervalsKey(athleteId, apiKey) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    athlete.intervals_status = apiKey ? 'connected' : 'pending';
    saveDemo();
    return { status: athlete.intervals_status };
  }
  const encrypted = encryptSecret(apiKey.trim());
  await prodRows('athlete_integrations', 'on_conflict=athlete_id,provider', {
    method: 'POST',
    body: { athlete_id: athleteId, provider: 'intervals', status: 'connected', secret_ciphertext: encrypted.ciphertext, secret_iv: encrypted.iv, secret_tag: encrypted.tag, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  await prodRows('athletes', `id=eq.${encodeURIComponent(athleteId)}`, { method: 'PATCH', body: { intervals_status: 'connected' } });
  return { status: 'connected' };
}

async function getIntervalsKey(athleteId) {
  if (DEMO_MODE) return null;
  const rows = await prodRows('athlete_integrations', `athlete_id=eq.${encodeURIComponent(athleteId)}&provider=eq.intervals&select=*&limit=1`);
  return rows[0] ? decryptSecret(rows[0]) : null;
}

async function intervalsFetch(apiKey, endpoint, options = {}) {
  const response = await fetch(`${INTERVALS_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw Object.assign(new Error((data && (data.message || data.error)) || `Intervals.icu respondió con HTTP ${response.status}.`), { status: response.status, details: data });
  return data;
}

async function syncWeekToIntervals(athleteId, week) {
  if (DEMO_MODE) return { demo: true, exported: week.workouts.length };
  const apiKey = await getIntervalsKey(athleteId);
  if (!apiKey) return { skipped: true, reason: 'Intervals pendiente de conectar.' };
  const events = week.workouts.filter(item => !['Strength', 'Rest'].includes(item.sport)).map(item => ({
    category: 'WORKOUT',
    start_date_local: `${item.workout_date}T00:00:00`,
    type: item.sport || 'Run',
    name: item.title,
    description: item.structured_description || item.summary || '',
  }));
  if (!events.length) return { exported: 0 };
  const result = await intervalsFetch(apiKey, '/athlete/0/events/bulk', { method: 'POST', body: JSON.stringify(events) });
  return { exported: events.length, result };
}


function unwrapIntervalsData(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && Array.isArray(value.activities)) return value.activities;
  if (value && Array.isArray(value.wellness)) return value.wellness;
  if (value && Array.isArray(value.events)) return value.events;
  return [];
}

function unwrapIntervalsObject(value) {
  return value && value.data && !Array.isArray(value.data) ? value.data : (value || {});
}

function firstFinite(object, keys) {
  for (const key of keys) {
    const value = Number(object && object[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function average(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function standardDeviation(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (valid.length < 2) return null;
  const mean = average(valid);
  return Math.sqrt(valid.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / valid.length);
}

function paceSecondsFromSpeed(speed) {
  const value = Number(speed);
  return Number.isFinite(value) && value > 0 ? 1000 / value : null;
}

function secondsToPace(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}/km`;
}

function roundOrNull(value, decimals = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function activityDate(value) {
  return String(value && (value.start_date_local || value.start_date || value.activity_date) || '').slice(0, 10);
}

function summariseIntervals(activity) {
  const intervals = Array.isArray(activity && activity.icu_intervals) ? activity.icu_intervals : [];
  return intervals.slice(0, 50).map((item, index) => ({
    index: index + 1,
    type: String(item && (item.name || item.type) || 'Intervalo'),
    duration_seconds: roundOrNull(firstFinite(item || {}, ['moving_time', 'elapsed_time']), 0),
    distance_m: roundOrNull(item && item.distance, 0),
    pace: secondsToPace(paceSecondsFromSpeed(item && item.average_speed)),
    average_hr: roundOrNull(item && item.average_heartrate, 0),
    max_hr: roundOrNull(item && item.max_heartrate, 0),
  }));
}

function normaliseActivityRow(athleteId, item) {
  const id = String(item && item.id || item && item.activity_id || '');
  const start = item && (item.start_date || item.start_date_local);
  return {
    athlete_id: athleteId,
    intervals_activity_id: id,
    activity_date: start || new Date().toISOString(),
    sport: sanitiseText(item && item.type || 'Run', 60),
    name: sanitiseText(item && item.name || item && item.type || 'Actividad', 240),
    duration_sec: roundOrNull(firstFinite(item || {}, ['moving_time', 'elapsed_time']), 0),
    distance_m: roundOrNull(item && item.distance, 2),
    load: roundOrNull(firstFinite(item || {}, ['icu_training_load', 'training_load', 'load']), 1),
    avg_hr: roundOrNull(item && item.average_heartrate, 0),
    max_hr: roundOrNull(item && item.max_heartrate, 0),
    avg_pace_sec_per_km: roundOrNull(paceSecondsFromSpeed(item && item.average_speed), 1),
    raw_summary: item || {},
  };
}

function dateRangeParams(url, defaultDays = 30) {
  const newest = validDate(url.searchParams.get('newest')) || new Date().toISOString().slice(0, 10);
  const fallback = new Date(`${newest}T12:00:00`);
  fallback.setDate(fallback.getDate() - defaultDays);
  const oldest = validDate(url.searchParams.get('oldest')) || fallback.toISOString().slice(0, 10);
  return { oldest, newest };
}

function publicActivitySummary(item) {
  const { raw_summary, ...summary } = item;
  return summary;
}

function demoActivitiesFor(athleteId, oldest, newest) {
  return demo.activities
    .filter(item => item.athlete_id === athleteId && String(item.activity_date).slice(0, 10) >= oldest && String(item.activity_date).slice(0, 10) <= newest)
    .sort((a, b) => String(b.activity_date).localeCompare(String(a.activity_date)))
    .map(publicActivitySummary);
}

async function listStoredActivities(athleteId, oldest, newest) {
  if (DEMO_MODE) return demoActivitiesFor(athleteId, oldest, newest);
  return prodRows('activities', `athlete_id=eq.${encodeURIComponent(athleteId)}&activity_date=gte.${oldest}T00:00:00&activity_date=lte.${newest}T23:59:59&select=id,athlete_id,intervals_activity_id,activity_date,sport,name,duration_sec,distance_m,load,avg_hr,max_hr,avg_pace_sec_per_km&order=activity_date.desc`);
}

async function syncActivities(athleteId, oldest, newest) {
  if (DEMO_MODE) return demoActivitiesFor(athleteId, oldest, newest);
  const apiKey = await getIntervalsKey(athleteId);
  if (!apiKey) throw Object.assign(new Error('Este deportista todavía no tiene Intervals.icu conectado.'), { status: 409 });
  const response = await intervalsFetch(apiKey, `/athlete/0/activities?oldest=${oldest}&newest=${newest}`);
  const rows = unwrapIntervalsData(response).filter(item => item && item.id).map(item => normaliseActivityRow(athleteId, item));
  if (rows.length) {
    await prodRows('activities', 'on_conflict=athlete_id,intervals_activity_id', {
      method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }
  return listStoredActivities(athleteId, oldest, newest);
}

function normaliseWellnessRow(athleteId, item) {
  const date = validDate(item && item.id) || validDate(item && item.date) || new Date().toISOString().slice(0, 10);
  const fitness = firstFinite(item || {}, ['ctl', 'fitness']);
  const fatigue = firstFinite(item || {}, ['atl', 'fatigue']);
  const formValue = firstFinite(item || {}, ['form', 'tsb']);
  return {
    athlete_id: athleteId,
    metric_date: date,
    fitness: roundOrNull(fitness, 2),
    fatigue: roundOrNull(fatigue, 2),
    form: roundOrNull(Number.isFinite(formValue) ? formValue : (Number.isFinite(fitness) && Number.isFinite(fatigue) ? fitness - fatigue : null), 2),
    load: roundOrNull(firstFinite(item || {}, ['icu_training_load', 'training_load', 'load']), 2),
    sleep_sec: roundOrNull(firstFinite(item || {}, ['sleepSecs', 'sleep_seconds', 'sleep']), 0),
    resting_hr: roundOrNull(firstFinite(item || {}, ['restingHR', 'resting_hr', 'restingHeartRate']), 1),
    hrv: roundOrNull(firstFinite(item || {}, ['hrv', 'hrvRMSSD', 'rmssd']), 2),
    source: 'intervals',
    updated_at: new Date().toISOString(),
  };
}

function readinessForRow(row, previousRows) {
  const baseline = previousRows.slice(-21);
  const sleepBase = average(baseline.map(item => Number(item.sleep_sec) / 3600));
  const rhrBase = average(baseline.map(item => item.resting_hr));
  const hrvBase = average(baseline.map(item => item.hrv));
  const sleep = Number(row.sleep_sec) / 3600;
  const rhr = Number(row.resting_hr);
  const hrv = Number(row.hrv);
  let score = 75;
  const reasons = [];
  if (Number.isFinite(sleep) && Number.isFinite(sleepBase)) {
    if (sleep < sleepBase - 1) { score -= 16; reasons.push('sueño claramente inferior a su media'); }
    else if (sleep < sleepBase - .45) { score -= 8; reasons.push('sueño algo inferior a su media'); }
    else if (sleep > sleepBase + .35) score += 4;
  }
  if (Number.isFinite(rhr) && Number.isFinite(rhrBase)) {
    if (rhr >= rhrBase + 6) { score -= 16; reasons.push('pulso en reposo elevado'); }
    else if (rhr >= rhrBase + 3) { score -= 7; reasons.push('pulso en reposo algo elevado'); }
  }
  if (Number.isFinite(hrv) && Number.isFinite(hrvBase) && hrvBase > 0) {
    const delta = (hrv - hrvBase) / hrvBase;
    if (delta <= -.2) { score -= 16; reasons.push('HRV reducida'); }
    else if (delta <= -.1) { score -= 7; reasons.push('HRV algo reducida'); }
    else if (delta >= .1) score += 4;
  }
  const form = Number(row.form);
  if (Number.isFinite(form)) {
    if (form < -25) { score -= 12; reasons.push('fatiga de carga alta'); }
    else if (form < -15) { score -= 6; reasons.push('carga acumulada relevante'); }
    else if (form > 8) score += 3;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 80 ? 'Muy buena disposición' : score >= 65 ? 'Buena, con control de carga' : score >= 45 ? 'Conviene revisar antes de entrenar' : 'Recuperación comprometida';
  const explanation = reasons.length ? `Factores principales: ${reasons.join(', ')}.` : 'Los indicadores están cerca de la línea base individual.';
  return { score, label, explanation, baseline: { sleep_hours: sleepBase, resting_hr: rhrBase, hrv: hrvBase } };
}

async function listRecoveryRows(athleteId, oldest, newest) {
  if (DEMO_MODE) return demo.daily_metrics.filter(item => item.athlete_id === athleteId && item.metric_date >= oldest && item.metric_date <= newest).sort((a, b) => String(a.metric_date).localeCompare(String(b.metric_date)));
  return prodRows('daily_metrics', `athlete_id=eq.${encodeURIComponent(athleteId)}&metric_date=gte.${oldest}&metric_date=lte.${newest}&select=*&order=metric_date.asc`);
}

async function syncRecovery(athleteId, oldest, newest) {
  if (DEMO_MODE) return listRecoveryRows(athleteId, oldest, newest);
  const apiKey = await getIntervalsKey(athleteId);
  if (!apiKey) throw Object.assign(new Error('Este deportista todavía no tiene Intervals.icu conectado.'), { status: 409 });
  const response = await intervalsFetch(apiKey, `/athlete/0/wellness?oldest=${oldest}&newest=${newest}`);
  const imported = unwrapIntervalsData(response).map(item => normaliseWellnessRow(athleteId, item));
  const running = [];
  for (const row of imported.sort((a, b) => String(a.metric_date).localeCompare(String(b.metric_date)))) {
    const readiness = readinessForRow(row, running);
    row.readiness_score = readiness.score;
    row.readiness_label = readiness.label;
    running.push(row);
  }
  if (imported.length) await prodRows('daily_metrics', 'on_conflict=athlete_id,metric_date', { method: 'POST', body: imported, prefer: 'resolution=merge-duplicates,return=minimal' });
  return listRecoveryRows(athleteId, oldest, newest);
}

async function activityRowByExternalId(athleteId, externalId) {
  if (DEMO_MODE) return demo.activities.find(item => item.athlete_id === athleteId && item.intervals_activity_id === externalId) || null;
  const rows = await prodRows('activities', `athlete_id=eq.${encodeURIComponent(athleteId)}&intervals_activity_id=eq.${encodeURIComponent(externalId)}&select=*&limit=1`);
  return rows[0] || null;
}

async function activityReview(session, athleteId, activityId) {
  if (DEMO_MODE) return demo.activity_reviews.find(item => item.athlete_id === athleteId && item.activity_id === activityId && item.coach_user_id === session.user.id) || null;
  const rows = await prodRows('activity_reviews', `athlete_id=eq.${encodeURIComponent(athleteId)}&activity_id=eq.${encodeURIComponent(activityId)}&coach_user_id=eq.${encodeURIComponent(session.user.id)}&select=*&limit=1`);
  return rows[0] || null;
}

async function getActivityDetail(session, athleteId, externalId) {
  let stored = await activityRowByExternalId(athleteId, externalId);
  let raw = stored && stored.raw_summary ? stored.raw_summary : {};
  if (!DEMO_MODE) {
    const apiKey = await getIntervalsKey(athleteId);
    if (apiKey) {
      const response = await intervalsFetch(apiKey, `/activity/${encodeURIComponent(externalId)}?intervals=true`);
      raw = unwrapIntervalsObject(response);
      const normalised = normaliseActivityRow(athleteId, raw);
      await prodRows('activities', 'on_conflict=athlete_id,intervals_activity_id', { method: 'POST', body: normalised, prefer: 'resolution=merge-duplicates,return=minimal' });
      stored = await activityRowByExternalId(athleteId, externalId);
    }
  }
  if (!stored) throw Object.assign(new Error('Actividad no encontrada.'), { status: 404 });
  const date = String(stored.activity_date).slice(0, 10);
  let planned = null;
  let recovery = [];
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    planned = athlete && athlete.week && athlete.week.workouts.find(item => item.workout_date === date) || null;
    recovery = await listRecoveryRows(athleteId, addDays(date, -21), date);
  } else {
    const [plannedRows, recoveryRows] = await Promise.all([
      prodRows('workouts', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_date=eq.${date}&select=*&limit=1`),
      listRecoveryRows(athleteId, addDays(date, -21), date),
    ]);
    planned = plannedRows[0] || null;
    recovery = recoveryRows;
  }
  return { activity: { ...stored, raw_summary: raw, intervals: summariseIntervals(raw) }, planned, recovery, review: await activityReview(session, athleteId, stored.id) };
}

function ruleBasedAnalysis(detail) {
  const activity = detail.activity || {};
  const hasPlanned = Boolean(detail.planned);
  const planned = detail.planned || {};
  const intervals = activity.intervals || [];
  const paces = intervals.map(item => {
    const match = String(item.pace || '').match(/^(\d+):(\d+)/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }).filter(Number.isFinite);
  const variability = paces.length > 1 ? (standardDeviation(paces) / average(paces)) * 100 : null;
  const actualLoad = Number(activity.load);
  const plannedLoad = Number(planned.planned_load);
  const loadDelta = Number.isFinite(actualLoad) && Number.isFinite(plannedLoad) && plannedLoad > 0 ? ((actualLoad - plannedLoad) / plannedLoad) * 100 : null;
  const latestRecovery = detail.recovery && detail.recovery[detail.recovery.length - 1];
  let score = 80;
  const alerts = [];
  if (Number.isFinite(loadDelta) && loadDelta > 20) { score -= 10; alerts.push({ level: 'warning', title: 'Carga por encima de lo previsto', detail: `La carga realizada supera en ${Math.round(loadDelta)} % la programada.` }); }
  if (Number.isFinite(variability) && variability > 5) { score -= 8; alerts.push({ level: 'warning', title: 'Ritmos poco regulares', detail: 'Las repeticiones muestran una variabilidad superior a la deseable.' }); }
  if (latestRecovery && Number(latestRecovery.readiness_score) < 50) { score -= 10; alerts.push({ level: 'warning', title: 'Recuperación previa baja', detail: 'Los indicadores previos aconsejaban revisar la intensidad.' }); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    status: score >= 85 ? 'muy_bien_asimilada' : score >= 70 ? 'bien_asimilada' : score >= 50 ? 'cumplida_con_fatiga' : 'revisar',
    headline: score >= 85 ? 'Sesión muy bien ejecutada' : score >= 70 ? 'Sesión bien asimilada' : score >= 50 ? 'Sesión cumplida con fatiga' : 'Sesión que requiere revisión',
    summary: hasPlanned ? 'La actividad se ha comparado con la sesión programada, la carga y los datos de recuperación disponibles.' : 'No se ha encontrado una sesión programada equivalente; la valoración se apoya en la ejecución y la carga disponible.',
    execution_analysis: intervals.length ? `Se han detectado ${intervals.length} intervalos. ${Number.isFinite(variability) ? `La variabilidad aproximada del ritmo es del ${variability.toFixed(1)} %.` : 'No hay suficientes ritmos para estimar su regularidad.'}` : 'No se han recibido intervalos detallados para esta actividad.',
    physiological_analysis: activity.avg_hr ? `La frecuencia cardiaca media fue de ${Math.round(activity.avg_hr)} ppm y la máxima de ${Math.round(activity.max_hr || activity.avg_hr)} ppm.` : 'No hay datos suficientes de frecuencia cardiaca.',
    context_analysis: latestRecovery ? `El estado de recuperación previo figura con una nota de ${latestRecovery.readiness_score ?? '—'}/100.` : 'No hay datos recientes de sueño, HRV y pulso en reposo.',
    alerts,
    recommendation: { action: score >= 70 ? 'mantener' : 'recuperar', next_24_48h: score >= 70 ? 'Mantener la sesión suave o de recuperación prevista, sin añadir carga.' : 'Priorizar recuperación y revisar molestias antes de la siguiente intensidad.', next_quality_session: score >= 80 ? 'Mantener el siguiente estímulo de calidad previsto.' : 'No progresar la siguiente sesión de calidad hasta revisar la respuesta.' },
    confidence: intervals.length && latestRecovery ? 'alta' : intervals.length || latestRecovery ? 'media' : 'baja',
    coach_questions: ['¿Cuál fue el RPE final?', '¿Apareció dolor o una molestia nueva durante las horas posteriores?'],
    disclaimer: 'Análisis orientativo para apoyar al entrenador; no sustituye una valoración médica ni la decisión profesional.',
  };
}

const AI_ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    status: { type: 'string', enum: ['muy_bien_asimilada', 'bien_asimilada', 'cumplida_con_fatiga', 'incompleta', 'revisar', 'riesgo_por_dolor'] },
    headline: { type: 'string' }, summary: { type: 'string' }, execution_analysis: { type: 'string' }, physiological_analysis: { type: 'string' }, context_analysis: { type: 'string' },
    alerts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { level: { type: 'string', enum: ['info', 'warning', 'critical'] }, title: { type: 'string' }, detail: { type: 'string' } }, required: ['level', 'title', 'detail'] } },
    recommendation: { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: ['mantener', 'reducir', 'progresar', 'recuperar', 'revisar_dolor', 'repetir_prueba'] }, next_24_48h: { type: 'string' }, next_quality_session: { type: 'string' } }, required: ['action', 'next_24_48h', 'next_quality_session'] },
    confidence: { type: 'string', enum: ['baja', 'media', 'alta'] }, coach_questions: { type: 'array', items: { type: 'string' } }, disclaimer: { type: 'string' },
  },
  required: ['score', 'status', 'headline', 'summary', 'execution_analysis', 'physiological_analysis', 'context_analysis', 'alerts', 'recommendation', 'confidence', 'coach_questions', 'disclaimer'],
};

function extractOpenAiText(data) {
  if (data && typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of Array.isArray(data && data.output) ? data.output : []) {
    for (const content of Array.isArray(item && item.content) ? item.content : []) if (content && typeof content.text === 'string') chunks.push(content.text);
  }
  return chunks.join('\n').trim();
}

async function openAiAnalysis(context) {
  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL, store: false, reasoning: { effort: 'low' }, max_output_tokens: 2200,
      instructions: 'Eres el módulo de análisis de RunFlow Coach para running y trail. Compara lo programado, lo realizado, la carga, la recuperación y los parámetros individuales. No inventes datos ni diagnostiques. Explica las limitaciones y recuerda que la decisión final es del entrenador. Responde en castellano claro.',
      input: JSON.stringify(context),
      text: { format: { type: 'json_schema', name: 'runflow_session_analysis', strict: true, schema: AI_ANALYSIS_SCHEMA } },
    }),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw Object.assign(new Error(data && data.error && data.error.message || `OpenAI respondió con HTTP ${response.status}.`), { status: response.status, details: data });
  const output = extractOpenAiText(data);
  if (!output) throw Object.assign(new Error('OpenAI no devolvió un análisis legible.'), { status: 502 });
  return { analysis: JSON.parse(output), usage: data.usage || null, response_id: data.id || null };
}

async function saveReview(session, athleteId, activityId, body) {
  const row = {
    id: body.id || crypto.randomUUID(), athlete_id: athleteId, activity_id: activityId, coach_user_id: session.user.id,
    decision: sanitiseText(body.decision, 80), coach_comment: sanitiseText(body.coach_comment, 5000),
    ai_analysis: body.ai_analysis && typeof body.ai_analysis === 'object' ? body.ai_analysis : null,
    updated_at: new Date().toISOString(),
  };
  if (DEMO_MODE) {
    const index = demo.activity_reviews.findIndex(item => item.athlete_id === athleteId && item.activity_id === activityId && item.coach_user_id === session.user.id);
    if (index >= 0) demo.activity_reviews[index] = { ...demo.activity_reviews[index], ...row };
    else demo.activity_reviews.push({ ...row, created_at: new Date().toISOString() });
    saveDemo();
    return index >= 0 ? demo.activity_reviews[index] : demo.activity_reviews[demo.activity_reviews.length - 1];
  }
  const { id, ...prodRow } = row;
  const rows = await prodRows('activity_reviews', 'on_conflict=activity_id,coach_user_id', { method: 'POST', body: prodRow, prefer: 'resolution=merge-duplicates,return=representation' });
  return rows[0];
}

function publicUser(session) {
  return {
    id: session.user.id,
    email: session.user.email,
    display_name: session.user.display_name || (session.user.user_metadata && session.user.user_metadata.display_name) || session.user.email,
    roles: session.roles,
    athlete_id: session.athlete_id,
  };
}

async function api(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname;

  if (pathname === '/api/config' && method === 'GET') {
    return sendJson(res, 200, { demo: DEMO_MODE, version: APP_VERSION, openaiConfigured: Boolean(OPENAI_API_KEY), openaiModel: OPENAI_MODEL });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req);
    const email = sanitiseText(body.email, 200).toLowerCase();
    const password = String(body.password || '');
    if (DEMO_MODE) {
      const user = demo.users.find(item => item.email.toLowerCase() === email && item.password === password);
      if (!user) throw Object.assign(new Error('Correo o contraseña incorrectos. En demo usa contraseña: runflow'), { status: 401 });
      res.setHeader('Set-Cookie', cookie('rf_demo_user', user.id, { maxAge: 60 * 60 * 24 * 7 }));
      return sendJson(res, 200, { ok: true, user: { id: user.id, email: user.email, display_name: user.display_name, roles: user.roles, athlete_id: user.athlete_id } });
    }
    const data = await authLogin(email, password);
    res.setHeader('Set-Cookie', authCookies(data.access_token, data.refresh_token, data.expires_in));
    const context = await prodUserContext(data.user.id);
    return sendJson(res, 200, { ok: true, user: { id: data.user.id, email: data.user.email, display_name: data.user.user_metadata && data.user.user_metadata.display_name, ...context } });
  }

  if (pathname === '/api/auth/accept-invite' && method === 'POST') {
    if (DEMO_MODE) throw Object.assign(new Error('No disponible en modo demostración.'), { status: 400 });
    const body = await readJson(req);
    const accessToken = String(body.access_token || '');
    const password = String(body.password || '');
    if (!accessToken || password.length < 8) throw Object.assign(new Error('La contraseña debe tener al menos 8 caracteres.'), { status: 400 });
    const user = await supabaseFetch('/auth/v1/user', { method: 'PUT', accessToken, body: JSON.stringify({ password }) }, SUPABASE_ANON_KEY);
    return sendJson(res, 200, { ok: true, email: user.email });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', DEMO_MODE ? cookie('rf_demo_user', '', { maxAge: 0 }) : clearAuthCookies());
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const session = await requireSession(req, res);
    return sendJson(res, 200, { user: publicUser(session), demo: DEMO_MODE });
  }

  const session = await requireSession(req, res);

  if (pathname === '/api/coach/athletes' && method === 'GET') {
    requireRole(session, 'coach');
    return sendJson(res, 200, { athletes: await listCoachAthletes(session) });
  }

  if (pathname === '/api/coach/athletes' && method === 'POST') {
    requireRole(session, 'coach');
    return sendJson(res, 201, { athlete: await createCoachAthlete(session, await readJson(req)) });
  }

  const inviteAthleteMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/invite$/);
  if (inviteAthleteMatch && method === 'POST') {
    return sendJson(res, 200, await inviteAthleteUser(session, inviteAthleteMatch[1]));
  }

  const athleteMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)$/);
  if (athleteMatch && method === 'GET') {
    const athleteId = athleteMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { athlete: DEMO_MODE ? await demoAthleteBundle(athleteId) : await prodAthleteBundle(athleteId, url.searchParams.get('week_start') || startOfWeek()) });
  }


  const calendarMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/calendar$/);
  if (calendarMatch && method === 'GET') {
    const athleteId = calendarMatch[1];
    await ensureCoachAccess(session, athleteId);
    const { oldest, newest } = dateRangeParams(url, 70);
    return sendJson(res, 200, { weeks: await listCalendarWeeks(athleteId, oldest, newest), oldest, newest });
  }

  const profileMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/profile$/);
  if (profileMatch && method === 'PUT') {
    const athleteId = profileMatch[1];
    await ensureCoachAccess(session, athleteId);
    const body = await readJson(req);
    return sendJson(res, 200, { athlete: await saveProfile(athleteId, body) });
  }

  const zonesMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/zones$/);
  if (zonesMatch && method === 'PUT') {
    const athleteId = zonesMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { zones: await saveZones(athleteId, await readJson(req)) });
  }

  const weekMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/week$/);
  if (weekMatch && method === 'PUT') {
    const athleteId = weekMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { week: await saveWeek(athleteId, await readJson(req), false) });
  }

  const publishMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/week\/publish$/);
  if (publishMatch && method === 'POST') {
    const athleteId = publishMatch[1];
    await ensureCoachAccess(session, athleteId);
    const body = await readJson(req);
    const weekStart = validDate(body.week_start) || startOfWeek();
    const alreadyPublished = await publishedWeekExists(athleteId, weekStart);
    const week = await saveWeek(athleteId, body, true);
    const intervals = alreadyPublished
      ? { skipped: true, reason: 'La semana se ha actualizado en la app. No se ha reenviado a Intervals para evitar sesiones duplicadas.' }
      : await syncWeekToIntervals(athleteId, week);
    return sendJson(res, 200, { week, intervals, already_published: alreadyPublished });
  }

  const goalsMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/goals$/);
  if (goalsMatch && method === 'POST') {
    const athleteId = goalsMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 201, { goal: await addGoal(athleteId, await readJson(req)) });
  }

  const goalDeleteMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/goals\/([^/]+)$/);
  if (goalDeleteMatch && method === 'DELETE') {
    const athleteId = goalDeleteMatch[1];
    await ensureCoachAccess(session, athleteId);
    await deleteGoal(goalDeleteMatch[2], athleteId);
    return sendJson(res, 200, { ok: true });
  }

  const intervalsKeyMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/integrations\/intervals$/);
  if (intervalsKeyMatch && method === 'PUT') {
    const athleteId = intervalsKeyMatch[1];
    await ensureCoachAccess(session, athleteId);
    const body = await readJson(req);
    const apiKey = String(body.api_key || '').trim();
    if (!apiKey) throw Object.assign(new Error('Introduce una API key válida.'), { status: 400 });
    return sendJson(res, 200, await setIntervalsKey(athleteId, apiKey));
  }


  const activitiesMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/activities$/);
  if (activitiesMatch && method === 'GET') {
    const athleteId = activitiesMatch[1];
    await ensureCoachAccess(session, athleteId);
    const { oldest, newest } = dateRangeParams(url, 35);
    const rows = url.searchParams.get('sync') === '1' ? await syncActivities(athleteId, oldest, newest) : await listStoredActivities(athleteId, oldest, newest);
    return sendJson(res, 200, { activities: rows, oldest, newest });
  }

  const recoveryMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/recovery$/);
  if (recoveryMatch && method === 'GET') {
    const athleteId = recoveryMatch[1];
    await ensureCoachAccess(session, athleteId);
    const { oldest, newest } = dateRangeParams(url, 35);
    const rows = url.searchParams.get('sync') === '1' ? await syncRecovery(athleteId, oldest, newest) : await listRecoveryRows(athleteId, oldest, newest);
    return sendJson(res, 200, { rows, oldest, newest });
  }

  const activityDetailMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/activities\/([^/]+)$/);
  if (activityDetailMatch && method === 'GET') {
    const athleteId = activityDetailMatch[1];
    const externalId = decodeURIComponent(activityDetailMatch[2]);
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, await getActivityDetail(session, athleteId, externalId));
  }

  const analyzeActivityMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/activities\/([^/]+)\/analyze$/);
  if (analyzeActivityMatch && method === 'POST') {
    const athleteId = analyzeActivityMatch[1];
    const externalId = decodeURIComponent(analyzeActivityMatch[2]);
    await ensureCoachAccess(session, athleteId);
    const body = await readJson(req);
    const detail = await getActivityDetail(session, athleteId, externalId);
    const athlete = DEMO_MODE ? await demoAthleteBundle(athleteId) : await prodAthleteBundle(athleteId, startOfWeek(new Date(detail.activity.activity_date)));
    const rules = ruleBasedAnalysis(detail);
    let generated = { analysis: rules, source: 'rules', usage: null, response_id: null };
    if (OPENAI_API_KEY && !DEMO_MODE) {
      const context = {
        athlete: {
          display_name: athlete.display_name,
          birth_date: athlete.profile && athlete.profile.birth_date,
          sex: athlete.profile && athlete.profile.sex,
          weight_kg: athlete.profile && athlete.profile.weight_kg,
          objective: athlete.profile && athlete.profile.objective,
          heart_rate_zones: athlete.zones && athlete.zones.hr || [],
          pace_zones: athlete.zones && athlete.zones.pace || [],
        },
        planned_session: detail.planned,
        completed_session: {
          name: detail.activity.name,
          date: String(detail.activity.activity_date).slice(0, 10),
          sport: detail.activity.sport,
          duration_sec: detail.activity.duration_sec,
          distance_m: detail.activity.distance_m,
          load: detail.activity.load,
          avg_hr: detail.activity.avg_hr,
          max_hr: detail.activity.max_hr,
          avg_pace: secondsToPace(detail.activity.avg_pace_sec_per_km),
          intervals: detail.activity.intervals,
        },
        recovery_history: detail.recovery,
        rule_based_preanalysis: rules,
        coach_context: sanitiseText(body.context, 3000),
      };
      try {
        generated = { ...(await openAiAnalysis(context)), source: 'openai' };
      } catch (error) {
        generated = { analysis: rules, source: 'rules', usage: null, response_id: null, openai_error: error.message };
      }
    }
    const review = await saveReview(session, athleteId, detail.activity.id, {
      id: detail.review && detail.review.id,
      decision: detail.review && detail.review.decision,
      coach_comment: detail.review && detail.review.coach_comment,
      ai_analysis: { ...generated.analysis, meta: { source: generated.source, model: generated.source === 'openai' ? OPENAI_MODEL : 'runflow-rules', usage: generated.usage, response_id: generated.response_id, openai_error: generated.openai_error || null, generated_at: new Date().toISOString() } },
    });
    return sendJson(res, 200, { analysis: review.ai_analysis, review });
  }

  const reviewActivityMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/activities\/([^/]+)\/review$/);
  if (reviewActivityMatch && method === 'PUT') {
    const athleteId = reviewActivityMatch[1];
    const externalId = decodeURIComponent(reviewActivityMatch[2]);
    await ensureCoachAccess(session, athleteId);
    const body = await readJson(req);
    const detail = await getActivityDetail(session, athleteId, externalId);
    const review = await saveReview(session, athleteId, detail.activity.id, {
      id: detail.review && detail.review.id,
      decision: body.decision,
      coach_comment: body.coach_comment,
      ai_analysis: detail.review && detail.review.ai_analysis,
    });
    return sendJson(res, 200, { review });
  }


  if (pathname === '/api/athlete/activities' && method === 'GET') {
    requireRole(session, 'athlete');
    if (!session.athlete_id) throw Object.assign(new Error('Tu usuario todavía no está vinculado a una ficha de deportista.'), { status: 409 });
    const { oldest, newest } = dateRangeParams(url, 120);
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit') || 5)));
    const rows = url.searchParams.get('sync') === '1'
      ? await syncActivities(session.athlete_id, oldest, newest)
      : await listStoredActivities(session.athlete_id, oldest, newest);
    return sendJson(res, 200, { activities: rows.slice(0, limit), oldest, newest });
  }

  const athleteActivityDetailMatch = pathname.match(/^\/api\/athlete\/activities\/([^/]+)$/);
  if (athleteActivityDetailMatch && method === 'GET') {
    requireRole(session, 'athlete');
    if (!session.athlete_id) throw Object.assign(new Error('Tu usuario todavía no está vinculado a una ficha de deportista.'), { status: 409 });
    const detail = await getActivityDetail(session, session.athlete_id, decodeURIComponent(athleteActivityDetailMatch[1]));
    return sendJson(res, 200, { activity: detail.activity, planned: detail.planned, recovery: detail.recovery });
  }

  if (pathname === '/api/athlete/dashboard' && method === 'GET') {
    requireRole(session, 'athlete');
    if (!session.athlete_id) throw Object.assign(new Error('Tu usuario todavía no está vinculado a una ficha de deportista.'), { status: 409 });
    const athlete = DEMO_MODE ? await demoAthleteBundle(session.athlete_id) : await prodAthleteBundle(session.athlete_id, url.searchParams.get('week_start') || startOfWeek());
    if (athlete.week && athlete.week.status !== 'published') athlete.week = null;
    return sendJson(res, 200, { athlete });
  }

  if (pathname === '/api/athlete/manual-log' && method === 'POST') {
    requireRole(session, 'athlete');
    const body = await readJson(req);
    const log = {
      id: crypto.randomUUID(), athlete_id: session.athlete_id, workout_id: sanitiseText(body.workout_id, 80) || null,
      status: ['completed', 'partial', 'skipped'].includes(body.status) ? body.status : 'completed',
      actual_duration_min: numberOrNull(body.actual_duration_min, 0, 1000), rpe: numberOrNull(body.rpe, 1, 10), pain: numberOrNull(body.pain, 0, 10),
      comment: sanitiseText(body.comment, 2000), created_at: new Date().toISOString(),
    };
    if (DEMO_MODE) { demo.manual_logs.push(log); saveDemo(); }
    else await prodRows('manual_session_logs', '', { method: 'POST', body: log });
    return sendJson(res, 201, { log });
  }

  throw Object.assign(new Error('Ruta no encontrada.'), { status: 404 });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/coach') pathname = '/coach.html';
  if (pathname === '/athlete') pathname = '/athlete.html';
  if (pathname === '/login') pathname = '/login.html';
  if (pathname === '/activate') pathname = '/activate.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Acceso denegado.');
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) return sendText(res, 404, 'Archivo no encontrado.');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': pathname.endsWith('.html') ? 'no-store' : 'public, max-age=300',
      ...securityHeaders(),
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, version: APP_VERSION, mode: DEMO_MODE ? 'demo' : 'online' });
    }
    if (DEMO_MODE && (url.pathname === '/demo/coach' || url.pathname === '/demo/athlete')) {
      const demoUser = url.pathname.endsWith('/coach') ? 'u-urtzi' : 'u-ibon';
      res.writeHead(302, { 'Set-Cookie': cookie('rf_demo_user', demoUser, { maxAge: 60 * 60 * 24 * 7 }), Location: url.pathname.endsWith('/coach') ? '/coach' : '/athlete' });
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, Number(error.status || 500), { error: error.message || 'Error interno.', details: error.details || null });
  }
});

validateRuntimeConfig();

server.listen(PORT, HOST, () => {
  console.log(`RunFlow ${APP_VERSION} · ${DEMO_MODE ? 'MODO DEMO' : 'ONLINE'} · ${APP_BASE_URL}`);
});
