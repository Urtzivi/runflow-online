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
const APP_VERSION = 'Online Pilot 1.3';
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
if (!Array.isArray(demo.cycle_evaluations)) demo.cycle_evaluations = [];
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

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeStringArray(value, maxItems = 30, maxLength = 120) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map(item => sanitiseText(item, maxLength)).filter(Boolean)
    : [];
}

function normaliseWorkout(item, athleteId, weekStart, index) {
  const source = item && typeof item === 'object' ? item : {};
  const sport = sanitiseText(source.sport || 'Run', 40);
  const workout = {
    id: source.id || crypto.randomUUID(),
    athlete_id: athleteId,
    workout_date: validDate(source.workout_date) || addDays(weekStart, Math.min(index, 6)),
    sport,
    title: sanitiseText(source.title || 'Sesión', 160),
    summary: sanitiseText(source.summary, 3000),
    structured_description: sanitiseText(source.structured_description || source.summary, 10000),
    planned_load: numberOrNull(source.planned_load, 0, 1000) || 0,
    blocks: Array.isArray(source.blocks) ? source.blocks.slice(0, 30) : [],
  };

  if (['A', 'B', 'C'].includes(source.priority)) workout.priority = source.priority;
  if (hasOwn(source, 'session_objective')) workout.session_objective = sanitiseText(source.session_objective, 3000);
  if (hasOwn(source, 'adaptation_target')) workout.adaptation_target = sanitiseText(source.adaptation_target, 1000);
  if (hasOwn(source, 'purpose')) workout.purpose = sanitiseText(source.purpose, 3000);
  if (hasOwn(source, 'planned_duration_min')) workout.planned_duration_min = numberOrNull(source.planned_duration_min, 0, 2000);
  if (hasOwn(source, 'planned_distance_km')) workout.planned_distance_km = numberOrNull(source.planned_distance_km, 0, 2000);
  if (hasOwn(source, 'planned_elevation_m')) workout.planned_elevation_m = numberOrNull(source.planned_elevation_m, 0, 100000);
  if (typeof source.is_strength === 'boolean') workout.is_strength = source.is_strength;

  return workout;
}

function normaliseWeek(body, athleteId) {
  const source = body && typeof body === 'object' ? body : {};
  const weekStart = validDate(source.week_start || source.start_date) || startOfWeek();
  const workouts = Array.isArray(source.workouts)
    ? source.workouts.slice(0, 30).map((item, index) => normaliseWorkout(item, athleteId, weekStart, index))
    : [];

  const explicitLoad = hasOwn(source, 'target_load') ? source.target_load : source.planned_load;
  const week = {
    week_start: weekStart,
    week_type: sanitiseText(source.week_type || source.microcycle_type || 'Carga controlada', 80),
    title: sanitiseText(source.title || source.name, 250),
    coach_comment: sanitiseText(source.coach_comment || source.notes, 4000),
    target_load: numberOrNull(explicitLoad, 0, 5000) ?? workouts.reduce((sum, item) => sum + Number(item.planned_load || 0), 0),
    status: source.status === 'published' || source.publication_status === 'published' ? 'published' : 'draft',
    workouts,
  };

  if (hasOwn(source, 'mesocycle_id')) week.mesocycle_id = sanitiseText(source.mesocycle_id, 80) || null;
  if (hasOwn(source, 'end_date')) week.end_date = validDate(source.end_date);
  if (hasOwn(source, 'microcycle_type') || hasOwn(source, 'type')) {
    const type = source.microcycle_type || source.type;
    week.microcycle_type = ['adaptation', 'load', 'development', 'overload', 'deload', 'taper', 'recovery', 'competition'].includes(type)
      ? type
      : null;
  }
  if (hasOwn(source, 'primary_objective')) week.primary_objective = sanitiseText(source.primary_objective, 3000);
  if (hasOwn(source, 'planned_hours')) week.planned_hours = numberOrNull(source.planned_hours, 0, 10000) ?? 0;
  if (hasOwn(source, 'planned_distance_km') || hasOwn(source, 'planned_distance')) {
    week.planned_distance_km = numberOrNull(source.planned_distance_km ?? source.planned_distance, 0, 100000) ?? 0;
  }
  if (hasOwn(source, 'planned_elevation_m') || hasOwn(source, 'planned_elevation')) {
    week.planned_elevation_m = numberOrNull(source.planned_elevation_m ?? source.planned_elevation, 0, 1000000) ?? 0;
  }
  if (hasOwn(source, 'planned_strength_sessions')) {
    week.planned_strength_sessions = Math.round(numberOrNull(source.planned_strength_sessions, 0, 1000) ?? 0);
  }
  if (hasOwn(source, 'recovery_target')) week.recovery_target = sanitiseText(source.recovery_target, 3000);
  if (hasOwn(source, 'lifecycle_status')) {
    week.lifecycle_status = ['planned', 'active', 'completed'].includes(source.lifecycle_status)
      ? source.lifecycle_status
      : 'planned';
  }

  if (week.end_date && week.end_date < week.week_start) {
    throw Object.assign(new Error('La fecha de fin del microciclo no puede ser anterior a la fecha de inicio.'), { status: 400 });
  }

  return week;
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
      week: { id: `w-${crypto.randomUUID()}`, week_start: startOfWeek(), end_date: addDays(startOfWeek(), 6), week_type: 'Planificación inicial', title: '', coach_comment: '', target_load: 0, status: 'draft', lifecycle_status: 'planned', workouts: [] },
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
    prodRows('training_weeks', 'on_conflict=athlete_id,week_start', { method: 'POST', body: { athlete_id: athlete.id, week_start: startOfWeek(), end_date: addDays(startOfWeek(), 6), week_type: 'Planificación inicial', title: '', coach_comment: '', target_load: 0, status: 'draft', lifecycle_status: 'planned', updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=representation' }),
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

async function persistWeekWorkouts(savedWeek, athleteId, workouts, publicationStatus) {
  const existingWorkouts = await prodRows(
    'workouts',
    `training_week_id=eq.${encodeURIComponent(savedWeek.id)}&select=id`
  );

  const existingIds = new Set(existingWorkouts.map(item => String(item.id)));
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const incomingWorkouts = workouts.map(item => ({
    ...item,
    id: uuidPattern.test(String(item.id || '')) ? String(item.id) : crypto.randomUUID(),
  }));
  const incomingIds = new Set(incomingWorkouts.map(item => item.id));

  const newIds = incomingWorkouts
    .filter(item => !existingIds.has(item.id))
    .map(item => item.id);

  if (newIds.length) {
    const conflicts = await prodRows('workouts', `id=in.(${newIds.join(',')})&select=id`);
    if (conflicts.length) {
      throw Object.assign(
        new Error('Una de las sesiones utiliza un identificador que ya pertenece a otra sesión.'),
        { status: 409 }
      );
    }
  }

  await Promise.all(incomingWorkouts.map(item => {
    const isExisting = existingIds.has(item.id);
    const payload = {
      training_week_id: savedWeek.id,
      athlete_id: athleteId,
      workout_date: item.workout_date,
      sport: item.sport,
      title: item.title,
      summary: item.summary,
      structured_description: item.structured_description,
      planned_load: item.planned_load,
      blocks: item.blocks,
      visible_to_athlete: publicationStatus === 'published',
      updated_at: new Date().toISOString(),
    };

    if (item.priority) payload.priority = item.priority;
    else if (!isExisting) payload.priority = 'B';

    if (hasOwn(item, 'session_objective')) payload.session_objective = item.session_objective;
    if (hasOwn(item, 'adaptation_target')) payload.adaptation_target = item.adaptation_target;
    if (hasOwn(item, 'purpose')) payload.purpose = item.purpose;
    if (hasOwn(item, 'planned_duration_min')) payload.planned_duration_min = item.planned_duration_min;
    if (hasOwn(item, 'planned_distance_km')) payload.planned_distance_km = item.planned_distance_km;
    if (hasOwn(item, 'planned_elevation_m')) payload.planned_elevation_m = item.planned_elevation_m;
    if (hasOwn(item, 'is_strength')) payload.is_strength = item.is_strength;
    else if (!isExisting) payload.is_strength = String(item.sport || '').toLowerCase() === 'strength';

    if (isExisting) {
      return prodRows(
        'workouts',
        `id=eq.${encodeURIComponent(item.id)}&training_week_id=eq.${encodeURIComponent(savedWeek.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
        { method: 'PATCH', body: payload, prefer: 'return=minimal' }
      );
    }

    return prodRows('workouts', '', {
      method: 'POST',
      body: { id: item.id, ...payload },
      prefer: 'return=minimal',
    });
  }));

  const deletedIds = existingWorkouts
    .map(item => String(item.id))
    .filter(id => !incomingIds.has(id));

  await Promise.all(deletedIds.map(id =>
    prodRows(
      'workouts',
      `id=eq.${encodeURIComponent(id)}&training_week_id=eq.${encodeURIComponent(savedWeek.id)}`,
      { method: 'DELETE', prefer: 'return=minimal' }
    )
  ));

  return prodRows(
    'workouts',
    `training_week_id=eq.${encodeURIComponent(savedWeek.id)}&select=*&order=workout_date.asc`
  );
}

async function saveWeek(athleteId, body, publish = false) {
  const week = normaliseWeek(body, athleteId);
  if (publish) {
    week.status = 'published';
    week.published_at = new Date().toISOString();
  }

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });

    const previous = athlete.week || {};
    const previousWorkouts = new Map((previous.workouts || []).map(item => [String(item.id), item]));
    const mergedWorkouts = week.workouts.map(item => ({
      ...(previousWorkouts.get(String(item.id)) || {}),
      ...item,
    }));
    athlete.week = {
      ...previous,
      ...week,
      id: previous.id || crypto.randomUUID(),
      end_date: week.end_date || previous.end_date || addDays(week.week_start, 6),
      workouts: mergedWorkouts,
    };
    if (athlete.metrics) athlete.metrics.planned_load = week.target_load;
    saveDemo();
    return athlete.week;
  }

  const existingRows = await prodRows(
    'training_weeks',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&week_start=eq.${week.week_start}&select=id,end_date&limit=1`
  );
  const isNewWeek = !existingRows.length;

  const weekPayload = {
    athlete_id: athleteId,
    week_start: week.week_start,
    week_type: week.week_type,
    title: week.title,
    coach_comment: week.coach_comment,
    target_load: week.target_load,
    status: week.status,
    published_at: week.published_at || null,
    updated_at: new Date().toISOString(),
  };

  if (hasOwn(week, 'mesocycle_id')) weekPayload.mesocycle_id = week.mesocycle_id;
  if (hasOwn(week, 'end_date')) weekPayload.end_date = week.end_date;
  else if (isNewWeek) weekPayload.end_date = addDays(week.week_start, 6);
  if (hasOwn(week, 'microcycle_type')) weekPayload.microcycle_type = week.microcycle_type;
  if (hasOwn(week, 'primary_objective')) weekPayload.primary_objective = week.primary_objective;
  if (hasOwn(week, 'planned_hours')) weekPayload.planned_hours = week.planned_hours;
  if (hasOwn(week, 'planned_distance_km')) weekPayload.planned_distance_km = week.planned_distance_km;
  if (hasOwn(week, 'planned_elevation_m')) weekPayload.planned_elevation_m = week.planned_elevation_m;
  if (hasOwn(week, 'planned_strength_sessions')) weekPayload.planned_strength_sessions = week.planned_strength_sessions;
  if (hasOwn(week, 'recovery_target')) weekPayload.recovery_target = week.recovery_target;
  if (hasOwn(week, 'lifecycle_status')) weekPayload.lifecycle_status = week.lifecycle_status;

  const weekRows = await prodRows('training_weeks', 'on_conflict=athlete_id,week_start', {
    method: 'POST',
    body: weekPayload,
    prefer: 'resolution=merge-duplicates,return=representation',
  });

  const savedWeek = weekRows[0];
  const savedWorkouts = await persistWeekWorkouts(savedWeek, athleteId, week.workouts, week.status);
  return { ...savedWeek, workouts: savedWorkouts };
}

function normaliseSeason(body, athleteId, existing = {}) {
  const source = { ...existing, ...(body || {}) };
  const startDate = validDate(source.start_date);
  const endDate = validDate(source.end_date);

  const season = {
    athlete_id: athleteId,
    name: sanitiseText(source.name, 200),
    start_date: startDate,
    end_date: endDate,
    status: ['planned', 'active', 'completed'].includes(source.status) ? source.status : 'planned',
    season_objective: sanitiseText(source.season_objective, 3000),
    notes: sanitiseText(source.notes, 5000),
    updated_at: new Date().toISOString(),
  };

  if (!season.name || !season.start_date || !season.end_date) {
    throw Object.assign(new Error('La temporada necesita nombre, fecha de inicio y fecha de fin.'), { status: 400 });
  }
  if (season.end_date < season.start_date) {
    throw Object.assign(new Error('La fecha de fin de la temporada no puede ser anterior a la fecha de inicio.'), { status: 400 });
  }
  return season;
}

async function listSeasons(athleteId) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    if (!Array.isArray(athlete.seasons)) athlete.seasons = [];
    return athlete.seasons.slice().sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
  }
  return prodRows('seasons', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&order=start_date.desc`);
}

async function getSeasonForAthlete(athleteId, seasonId) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    if (!Array.isArray(athlete.seasons)) athlete.seasons = [];
    const season = athlete.seasons.find(item => item.id === seasonId);
    if (!season) throw Object.assign(new Error('Temporada no encontrada.'), { status: 404 });
    return season;
  }
  const rows = await prodRows(
    'seasons',
    `id=eq.${encodeURIComponent(seasonId)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`
  );
  if (!rows.length) throw Object.assign(new Error('Temporada no encontrada.'), { status: 404 });
  return rows[0];
}

async function validateSeasonChildrenInside(athleteId, seasonId, season) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const macros = Array.isArray(athlete && athlete.macrocycles) ? athlete.macrocycles.filter(item => item.season_id === seasonId) : [];
    if (macros.some(item => item.start_date < season.start_date || item.end_date > season.end_date)) {
      throw Object.assign(new Error('No puedes acortar la temporada dejando macrociclos fuera de sus fechas.'), { status: 409 });
    }
    return;
  }
  const macros = await prodRows(
    'macrocycles',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&season_id=eq.${encodeURIComponent(seasonId)}&select=id,start_date,end_date`
  );
  if (macros.some(item => item.start_date < season.start_date || item.end_date > season.end_date)) {
    throw Object.assign(new Error('No puedes acortar la temporada dejando macrociclos fuera de sus fechas.'), { status: 409 });
  }
}

async function addSeason(athleteId, body) {
  const season = { id: crypto.randomUUID(), ...normaliseSeason(body, athleteId) };
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    if (!Array.isArray(athlete.seasons)) athlete.seasons = [];
    athlete.seasons.push(season);
    saveDemo();
    return season;
  }
  const rows = await prodRows('seasons', '', { method: 'POST', body: season });
  return rows[0];
}

async function updateSeason(seasonId, athleteId, body) {
  const existing = await getSeasonForAthlete(athleteId, seasonId);
  const season = normaliseSeason(body, athleteId, existing);
  await validateSeasonChildrenInside(athleteId, seasonId, season);

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const index = athlete.seasons.findIndex(item => item.id === seasonId);
    athlete.seasons[index] = { ...existing, ...season, id: seasonId };
    saveDemo();
    return athlete.seasons[index];
  }

  const rows = await prodRows(
    'seasons',
    `id=eq.${encodeURIComponent(seasonId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
    { method: 'PATCH', body: season }
  );
  if (!rows.length) throw Object.assign(new Error('Temporada no encontrada.'), { status: 404 });
  return rows[0];
}

function normaliseGoal(body, athleteId, existing = {}) {
  const source = { ...existing, ...(body || {}) };
  const priorityCode = ['A', 'B', 'C'].includes(source.priority_code)
    ? source.priority_code
    : source.priority === 'Principal' ? 'A' : source.priority === 'Secundario' ? 'B' : 'B';
  const legacyPriority = ['Principal', 'Secundario'].includes(source.priority)
    ? source.priority
    : priorityCode === 'A' ? 'Principal' : 'Secundario';
  const goalType = ['competition', 'performance', 'volume', 'recovery', 'physiological_development', 'other'].includes(source.goal_type)
    ? source.goal_type
    : null;

  const goal = {
    athlete_id: athleteId,
    season_id: sanitiseText(source.season_id, 80) || null,
    associated_macrocycle_id: sanitiseText(source.associated_macrocycle_id, 80) || null,
    name: sanitiseText(source.name, 200),
    goal_date: validDate(source.goal_date || source.date),
    sport: sanitiseText(source.sport, 60) || null,
    event_type: sanitiseText(source.event_type, 100) || null,
    goal_type: goalType,
    priority: legacyPriority,
    priority_code: priorityCode,
    distance_km: numberOrNull(source.distance_km ?? source.distance, 0, 5000),
    elevation_m: numberOrNull(source.elevation_m ?? source.elevation_gain, 0, 100000),
    target_time_sec: numberOrNull(source.target_time_sec, 0, 1_000_000),
    target_position: numberOrNull(source.target_position, 1, 1_000_000),
    target_metric: safeObject(source.target_metric),
    performance_target: sanitiseText(source.performance_target, 1000),
    notes: sanitiseText(source.notes, 4000),
    status: ['active', 'completed', 'cancelled'].includes(source.status) ? source.status : 'active',
  };

  if (!goal.name || !goal.goal_date) {
    throw Object.assign(new Error('El objetivo necesita nombre y fecha.'), { status: 400 });
  }
  return goal;
}

async function listGoals(athleteId) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    return (athlete.goals || []).slice().sort((a, b) => String(a.goal_date).localeCompare(String(b.goal_date)));
  }
  return prodRows('goals', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&order=goal_date.asc`);
}

async function getGoalForAthlete(athleteId, goalId) {
  if (!goalId) return null;
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const goal = athlete && Array.isArray(athlete.goals) ? athlete.goals.find(item => item.id === goalId) : null;
    if (!goal) throw Object.assign(new Error('Objetivo no encontrado.'), { status: 404 });
    return goal;
  }
  const rows = await prodRows(
    'goals',
    `id=eq.${encodeURIComponent(goalId)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`
  );
  if (!rows.length) throw Object.assign(new Error('Objetivo no encontrado.'), { status: 404 });
  return rows[0];
}

async function ensureGoalRelations(athleteId, goal, currentGoalId = null) {
  if (goal.season_id) await getSeasonForAthlete(athleteId, goal.season_id);
  if (goal.associated_macrocycle_id) {
    const macro = await getMacrocycleForAthlete(athleteId, goal.associated_macrocycle_id);
    if (goal.season_id && macro.season_id !== goal.season_id) {
      throw Object.assign(new Error('El macrociclo asociado no pertenece a la temporada del objetivo.'), { status: 400 });
    }
    if (currentGoalId && macro.goal_id && macro.goal_id !== currentGoalId) {
      throw Object.assign(new Error('Ese macrociclo ya está asociado como objetivo principal a otro objetivo.'), { status: 409 });
    }
  }
}

async function addGoal(athleteId, body) {
  const goal = { id: crypto.randomUUID(), ...normaliseGoal(body, athleteId) };
  await ensureGoalRelations(athleteId, goal);

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    athlete.goals.push(goal);
    saveDemo();
    return goal;
  }
  const rows = await prodRows('goals', '', { method: 'POST', body: goal });
  return rows[0];
}

async function updateGoal(goalId, athleteId, body) {
  const existing = await getGoalForAthlete(athleteId, goalId);
  const goal = normaliseGoal(body, athleteId, existing);
  await ensureGoalRelations(athleteId, goal, goalId);

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const index = athlete.goals.findIndex(item => item.id === goalId);
    athlete.goals[index] = { ...existing, ...goal, id: goalId };
    saveDemo();
    return athlete.goals[index];
  }

  const rows = await prodRows(
    'goals',
    `id=eq.${encodeURIComponent(goalId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
    { method: 'PATCH', body: goal }
  );
  if (!rows.length) throw Object.assign(new Error('Objetivo no encontrado.'), { status: 404 });
  return rows[0];
}

async function deleteGoal(goalId, athleteId) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    athlete.goals = athlete.goals.filter(item => item.id !== goalId);
    if (Array.isArray(athlete.macrocycles)) {
      athlete.macrocycles = athlete.macrocycles.map(item => item.goal_id === goalId ? { ...item, goal_id: null } : item);
    }
    saveDemo();
    return;
  }
  await prodRows(
    'goals',
    `id=eq.${encodeURIComponent(goalId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
    { method: 'DELETE', prefer: 'return=minimal' }
  );
}

function normaliseMacrocycle(body, existing = {}) {
  const source = { ...existing, ...(body || {}) };
  const macrocycle = {
    goal_id: sanitiseText(source.goal_id, 80) || null,
    name: sanitiseText(source.name, 200),
    start_date: validDate(source.start_date),
    end_date: validDate(source.end_date),
    primary_objective: sanitiseText(source.primary_objective, 3000),
    initial_state: safeObject(source.initial_state),
    target_state: safeObject(source.target_state),
    constraints: sanitiseText(source.constraints, 5000),
    status: ['planned', 'active', 'completed'].includes(source.status) ? source.status : 'planned',
    notes: sanitiseText(source.notes, 5000),
    updated_at: new Date().toISOString(),
  };
  if (!macrocycle.name || !macrocycle.start_date || !macrocycle.end_date) {
    throw Object.assign(new Error('El macrociclo necesita nombre, fecha de inicio y fecha de fin.'), { status: 400 });
  }
  if (macrocycle.end_date < macrocycle.start_date) {
    throw Object.assign(new Error('La fecha de fin del macrociclo no puede ser anterior a la fecha de inicio.'), { status: 400 });
  }
  return macrocycle;
}

async function getMacrocycleForAthlete(athleteId, macrocycleId) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    if (!Array.isArray(athlete.macrocycles)) athlete.macrocycles = [];
    const macrocycle = athlete.macrocycles.find(item => item.id === macrocycleId);
    if (!macrocycle) throw Object.assign(new Error('Macrociclo no encontrado.'), { status: 404 });
    return macrocycle;
  }
  const rows = await prodRows(
    'macrocycles',
    `id=eq.${encodeURIComponent(macrocycleId)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`
  );
  if (!rows.length) throw Object.assign(new Error('Macrociclo no encontrado.'), { status: 404 });
  return rows[0];
}

async function listMacrocycles(athleteId, seasonId) {
  await getSeasonForAthlete(athleteId, seasonId);
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!Array.isArray(athlete.macrocycles)) athlete.macrocycles = [];
    return athlete.macrocycles.filter(item => item.season_id === seasonId).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  }
  return prodRows(
    'macrocycles',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&season_id=eq.${encodeURIComponent(seasonId)}&select=*&order=start_date.asc`
  );
}

function validateMacrocycleInsideSeason(macrocycle, season) {
  if (macrocycle.start_date < season.start_date || macrocycle.end_date > season.end_date) {
    throw Object.assign(new Error('Las fechas del macrociclo deben estar dentro de la temporada.'), { status: 400 });
  }
}

async function validateMacrocycleGoal(athleteId, macrocycle, seasonId) {
  if (!macrocycle.goal_id) return null;
  const goal = await getGoalForAthlete(athleteId, macrocycle.goal_id);
  if (goal.season_id && goal.season_id !== seasonId) {
    throw Object.assign(new Error('El objetivo principal del macrociclo pertenece a otra temporada.'), { status: 400 });
  }
  return goal;
}

async function validateMacrocycleChildrenInside(athleteId, macrocycleId, macrocycle) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const mesos = Array.isArray(athlete && athlete.mesocycles) ? athlete.mesocycles.filter(item => item.macrocycle_id === macrocycleId) : [];
    if (mesos.some(item => item.start_date < macrocycle.start_date || item.end_date > macrocycle.end_date)) {
      throw Object.assign(new Error('No puedes acortar el macrociclo dejando mesociclos fuera de sus fechas.'), { status: 409 });
    }
    return;
  }
  const mesos = await prodRows(
    'mesocycles',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&macrocycle_id=eq.${encodeURIComponent(macrocycleId)}&select=id,start_date,end_date`
  );
  if (mesos.some(item => item.start_date < macrocycle.start_date || item.end_date > macrocycle.end_date)) {
    throw Object.assign(new Error('No puedes acortar el macrociclo dejando mesociclos fuera de sus fechas.'), { status: 409 });
  }
}

async function addMacrocycle(athleteId, seasonId, body) {
  const season = await getSeasonForAthlete(athleteId, seasonId);
  const data = normaliseMacrocycle(body);
  validateMacrocycleInsideSeason(data, season);
  const goal = await validateMacrocycleGoal(athleteId, data, seasonId);

  const macrocycle = {
    id: crypto.randomUUID(),
    athlete_id: athleteId,
    season_id: seasonId,
    ...data,
  };

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!Array.isArray(athlete.macrocycles)) athlete.macrocycles = [];
    athlete.macrocycles.push(macrocycle);
    if (goal) {
      const goalIndex = athlete.goals.findIndex(item => item.id === goal.id);
      if (goalIndex >= 0) athlete.goals[goalIndex] = { ...athlete.goals[goalIndex], season_id: goal.season_id || seasonId, associated_macrocycle_id: macrocycle.id };
    }
    saveDemo();
    return macrocycle;
  }

  const rows = await prodRows('macrocycles', '', { method: 'POST', body: macrocycle });
  if (goal) {
    await prodRows(
      'goals',
      `id=eq.${encodeURIComponent(goal.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
      { method: 'PATCH', body: { season_id: goal.season_id || seasonId, associated_macrocycle_id: macrocycle.id } }
    );
  }
  return rows[0];
}

async function updateMacrocycle(macrocycleId, athleteId, body) {
  const existing = await getMacrocycleForAthlete(athleteId, macrocycleId);
  const season = await getSeasonForAthlete(athleteId, existing.season_id);
  const data = normaliseMacrocycle(body, existing);
  validateMacrocycleInsideSeason(data, season);
  const newGoal = await validateMacrocycleGoal(athleteId, data, existing.season_id);
  await validateMacrocycleChildrenInside(athleteId, macrocycleId, data);

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const index = athlete.macrocycles.findIndex(item => item.id === macrocycleId);
    athlete.macrocycles[index] = { ...existing, ...data, id: macrocycleId, athlete_id: athleteId, season_id: existing.season_id };

    if (existing.goal_id && existing.goal_id !== data.goal_id) {
      const oldIndex = athlete.goals.findIndex(item => item.id === existing.goal_id);
      if (oldIndex >= 0 && athlete.goals[oldIndex].associated_macrocycle_id === macrocycleId) {
        athlete.goals[oldIndex] = { ...athlete.goals[oldIndex], associated_macrocycle_id: null };
      }
    }
    if (newGoal) {
      const newIndex = athlete.goals.findIndex(item => item.id === newGoal.id);
      if (newIndex >= 0) {
        athlete.goals[newIndex] = {
          ...athlete.goals[newIndex],
          season_id: athlete.goals[newIndex].season_id || existing.season_id,
          associated_macrocycle_id: macrocycleId,
        };
      }
    }

    saveDemo();
    return athlete.macrocycles[index];
  }

  const rows = await prodRows(
    'macrocycles',
    `id=eq.${encodeURIComponent(macrocycleId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
    { method: 'PATCH', body: data }
  );
  if (!rows.length) throw Object.assign(new Error('Macrociclo no encontrado.'), { status: 404 });

  if (existing.goal_id && existing.goal_id !== data.goal_id) {
    await prodRows(
      'goals',
      `id=eq.${encodeURIComponent(existing.goal_id)}&athlete_id=eq.${encodeURIComponent(athleteId)}&associated_macrocycle_id=eq.${encodeURIComponent(macrocycleId)}`,
      { method: 'PATCH', body: { associated_macrocycle_id: null } }
    );
  }
  if (newGoal) {
    await prodRows(
      'goals',
      `id=eq.${encodeURIComponent(newGoal.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
      { method: 'PATCH', body: { season_id: newGoal.season_id || existing.season_id, associated_macrocycle_id: macrocycleId } }
    );
  }

  return rows[0];
}

function inclusiveDays(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function normaliseMesocycle(body, existing = {}) {
  const source = { ...existing, ...(body || {}) };
  const startDate = validDate(source.start_date);
  const endDate = validDate(source.end_date);
  const durationWeeks = startDate && endDate
    ? Math.max(1, Math.ceil(inclusiveDays(startDate, endDate) / 7))
    : numberOrNull(source.duration_weeks, 1, 200);

  const mesocycle = {
    name: sanitiseText(source.name, 200),
    start_date: startDate,
    end_date: endDate,
    duration_weeks: Math.round(numberOrNull(source.duration_weeks, 1, 200) ?? durationWeeks ?? 1),
    primary_adaptation: sanitiseText(source.primary_adaptation, 200),
    secondary_adaptations: safeStringArray(source.secondary_adaptations, 30, 200),
    planned_hours: numberOrNull(source.planned_hours, 0, 10000) ?? 0,
    planned_distance_km: numberOrNull(source.planned_distance_km ?? source.planned_distance, 0, 100000) ?? 0,
    planned_elevation_m: numberOrNull(source.planned_elevation_m ?? source.planned_elevation, 0, 1000000) ?? 0,
    planned_load: numberOrNull(source.planned_load, 0, 1_000_000) ?? 0,
    planned_strength_sessions: Math.round(numberOrNull(source.planned_strength_sessions, 0, 10000) ?? 0),
    planned_intensity_distribution: safeObject(source.planned_intensity_distribution || source.intensity_distribution),
    progression_pattern: safeStringArray(source.progression_pattern, 30, 100),
    success_criteria: sanitiseText(source.success_criteria, 5000),
    success_criteria_rules: Array.isArray(source.success_criteria_rules) ? source.success_criteria_rules.slice(0, 50) : [],
    status: ['planned', 'active', 'completed'].includes(source.status) ? source.status : 'planned',
    notes: sanitiseText(source.notes, 5000),
    updated_at: new Date().toISOString(),
  };

  if (!mesocycle.name || !mesocycle.start_date || !mesocycle.end_date || !mesocycle.primary_adaptation) {
    throw Object.assign(new Error('El mesociclo necesita nombre, fechas y adaptación principal.'), { status: 400 });
  }
  if (mesocycle.end_date < mesocycle.start_date) {
    throw Object.assign(new Error('La fecha de fin del mesociclo no puede ser anterior a la fecha de inicio.'), { status: 400 });
  }
  return mesocycle;
}

async function getMesocycleForAthlete(athleteId, mesocycleId) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    if (!Array.isArray(athlete.mesocycles)) athlete.mesocycles = [];
    const mesocycle = athlete.mesocycles.find(item => item.id === mesocycleId);
    if (!mesocycle) throw Object.assign(new Error('Mesociclo no encontrado.'), { status: 404 });
    return mesocycle;
  }
  const rows = await prodRows(
    'mesocycles',
    `id=eq.${encodeURIComponent(mesocycleId)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`
  );
  if (!rows.length) throw Object.assign(new Error('Mesociclo no encontrado.'), { status: 404 });
  return rows[0];
}

async function listMesocycles(athleteId, macrocycleId) {
  await getMacrocycleForAthlete(athleteId, macrocycleId);
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!Array.isArray(athlete.mesocycles)) athlete.mesocycles = [];
    return athlete.mesocycles.filter(item => item.macrocycle_id === macrocycleId).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  }
  return prodRows(
    'mesocycles',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&macrocycle_id=eq.${encodeURIComponent(macrocycleId)}&select=*&order=start_date.asc`
  );
}

function validateMesocycleInsideMacrocycle(mesocycle, macrocycle) {
  if (mesocycle.start_date < macrocycle.start_date || mesocycle.end_date > macrocycle.end_date) {
    throw Object.assign(new Error('Las fechas del mesociclo deben estar dentro del macrociclo.'), { status: 400 });
  }
}

async function validateMesocycleChildrenInside(athleteId, mesocycleId, mesocycle) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const micros = [];
    if (athlete && athlete.week && athlete.week.mesocycle_id === mesocycleId) micros.push(athlete.week);
    if (Array.isArray(athlete && athlete.microcycles)) micros.push(...athlete.microcycles.filter(item => item.mesocycle_id === mesocycleId));
    if (micros.some(item => (item.week_start || item.start_date) < mesocycle.start_date || (item.end_date || addDays(item.week_start, 6)) > mesocycle.end_date)) {
      throw Object.assign(new Error('No puedes acortar el mesociclo dejando microciclos fuera de sus fechas.'), { status: 409 });
    }
    return;
  }
  const micros = await prodRows(
    'training_weeks',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&mesocycle_id=eq.${encodeURIComponent(mesocycleId)}&select=id,week_start,end_date`
  );
  if (micros.some(item => item.week_start < mesocycle.start_date || (item.end_date || addDays(item.week_start, 6)) > mesocycle.end_date)) {
    throw Object.assign(new Error('No puedes acortar el mesociclo dejando microciclos fuera de sus fechas.'), { status: 409 });
  }
}

async function addMesocycle(athleteId, macrocycleId, body) {
  const macrocycle = await getMacrocycleForAthlete(athleteId, macrocycleId);
  const data = normaliseMesocycle(body);
  validateMesocycleInsideMacrocycle(data, macrocycle);

  const mesocycle = {
    id: crypto.randomUUID(),
    athlete_id: athleteId,
    macrocycle_id: macrocycleId,
    ...data,
  };

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!Array.isArray(athlete.mesocycles)) athlete.mesocycles = [];
    athlete.mesocycles.push(mesocycle);
    saveDemo();
    return mesocycle;
  }

  const rows = await prodRows('mesocycles', '', { method: 'POST', body: mesocycle });
  return rows[0];
}

async function updateMesocycle(mesocycleId, athleteId, body) {
  const existing = await getMesocycleForAthlete(athleteId, mesocycleId);
  const macrocycle = await getMacrocycleForAthlete(athleteId, existing.macrocycle_id);
  const data = normaliseMesocycle(body, existing);
  validateMesocycleInsideMacrocycle(data, macrocycle);
  await validateMesocycleChildrenInside(athleteId, mesocycleId, data);

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const index = athlete.mesocycles.findIndex(item => item.id === mesocycleId);
    athlete.mesocycles[index] = { ...existing, ...data, id: mesocycleId, athlete_id: athleteId, macrocycle_id: existing.macrocycle_id };
    saveDemo();
    return athlete.mesocycles[index];
  }

  const rows = await prodRows(
    'mesocycles',
    `id=eq.${encodeURIComponent(mesocycleId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
    { method: 'PATCH', body: data }
  );
  if (!rows.length) throw Object.assign(new Error('Mesociclo no encontrado.'), { status: 404 });
  return rows[0];
}

function microcycleFromRow(row, workouts = [], actual = null) {
  const actualMetrics = actual || {
    hours: Number(row.actual_hours || 0),
    distance_km: Number(row.actual_distance_km || 0),
    elevation_m: Number(row.actual_elevation_m || 0),
    load: Number(row.actual_load || 0),
    strength_sessions: Number(row.actual_strength_sessions || 0),
    completion_rate: null,
    a_sessions_completion_pct: null,
  };
  return {
    id: row.id,
    mesocycle_id: row.mesocycle_id || null,
    name: row.title || '',
    start_date: row.week_start,
    end_date: row.end_date || addDays(row.week_start, 6),
    type: row.microcycle_type || null,
    primary_objective: row.primary_objective || '',
    planned: {
      hours: Number(row.planned_hours || 0),
      distance_km: Number(row.planned_distance_km || 0),
      elevation_m: Number(row.planned_elevation_m || 0),
      load: Number(row.target_load || 0),
      strength_sessions: Number(row.planned_strength_sessions || 0),
    },
    actual: actualMetrics,
    recovery_target: row.recovery_target || '',
    lifecycle_status: row.lifecycle_status || 'planned',
    publication_status: row.status || 'draft',
    notes: row.coach_comment || '',
    week_type: row.week_type || '',
    published_at: row.published_at || null,
    workouts,
  };
}

async function getMicrocycleForAthlete(athleteId, microcycleId) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    const candidates = [];
    if (athlete.week) candidates.push(athlete.week);
    if (Array.isArray(athlete.microcycles)) candidates.push(...athlete.microcycles);
    const row = candidates.find(item => item.id === microcycleId);
    if (!row) throw Object.assign(new Error('Microciclo no encontrado.'), { status: 404 });
    return row;
  }
  const rows = await prodRows(
    'training_weeks',
    `id=eq.${encodeURIComponent(microcycleId)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`
  );
  if (!rows.length) throw Object.assign(new Error('Microciclo no encontrado.'), { status: 404 });
  return rows[0];
}

async function listMicrocycles(athleteId, mesocycleId) {
  const mesocycle = await getMesocycleForAthlete(athleteId, mesocycleId);
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const rows = [];
    if (athlete.week && athlete.week.mesocycle_id === mesocycleId) rows.push(athlete.week);
    if (Array.isArray(athlete.microcycles)) rows.push(...athlete.microcycles.filter(item => item.mesocycle_id === mesocycleId));
    return rows.sort((a, b) => String(a.week_start).localeCompare(String(b.week_start))).map(row => microcycleFromRow(row, row.workouts || []));
  }
  const rows = await prodRows(
    'training_weeks',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&mesocycle_id=eq.${encodeURIComponent(mesocycleId)}&select=*&order=week_start.asc`
  );
  if (!rows.length) return [];
  const ids = rows.map(item => item.id);
  const workouts = await prodRows('workouts', `training_week_id=in.(${ids.join(',')})&select=*&order=workout_date.asc`);
  const grouped = new Map();
  workouts.forEach(item => {
    if (!grouped.has(item.training_week_id)) grouped.set(item.training_week_id, []);
    grouped.get(item.training_week_id).push(item);
  });
  return rows.map(row => microcycleFromRow(row, grouped.get(row.id) || []));
}

function normaliseMicrocycle(body, existing = {}) {
  const source = { ...existing, ...(body || {}) };
  const startDate = validDate(source.start_date || source.week_start);
  const endDate = validDate(source.end_date) || (startDate ? addDays(startDate, 6) : null);
  const type = source.type || source.microcycle_type;
  const publicationStatus = source.publication_status || source.status;
  const plannedLoad = source.planned && typeof source.planned === 'object' ? source.planned.load : (source.planned_load ?? source.target_load);
  const plannedHours = source.planned && typeof source.planned === 'object' ? source.planned.hours : source.planned_hours;
  const plannedDistance = source.planned && typeof source.planned === 'object' ? source.planned.distance_km : (source.planned_distance_km ?? source.planned_distance);
  const plannedElevation = source.planned && typeof source.planned === 'object' ? source.planned.elevation_m : (source.planned_elevation_m ?? source.planned_elevation);
  const plannedStrength = source.planned && typeof source.planned === 'object' ? source.planned.strength_sessions : source.planned_strength_sessions;

  const microcycle = {
    title: sanitiseText(source.name || source.title, 250),
    week_start: startDate,
    end_date: endDate,
    microcycle_type: ['adaptation', 'load', 'development', 'overload', 'deload', 'taper', 'recovery', 'competition'].includes(type) ? type : null,
    primary_objective: sanitiseText(source.primary_objective, 3000),
    week_type: sanitiseText(source.week_type || source.name || 'Planificación', 80),
    coach_comment: sanitiseText(source.notes || source.coach_comment, 4000),
    target_load: numberOrNull(plannedLoad, 0, 1_000_000) ?? 0,
    planned_hours: numberOrNull(plannedHours, 0, 10000) ?? 0,
    planned_distance_km: numberOrNull(plannedDistance, 0, 100000) ?? 0,
    planned_elevation_m: numberOrNull(plannedElevation, 0, 1000000) ?? 0,
    planned_strength_sessions: Math.round(numberOrNull(plannedStrength, 0, 10000) ?? 0),
    recovery_target: sanitiseText(source.recovery_target, 3000),
    lifecycle_status: ['planned', 'active', 'completed'].includes(source.lifecycle_status) ? source.lifecycle_status : 'planned',
    status: publicationStatus === 'published' ? 'published' : 'draft',
    updated_at: new Date().toISOString(),
  };

  if (!microcycle.title || !microcycle.week_start || !microcycle.end_date) {
    throw Object.assign(new Error('El microciclo necesita nombre, fecha de inicio y fecha de fin.'), { status: 400 });
  }
  if (microcycle.end_date < microcycle.week_start) {
    throw Object.assign(new Error('La fecha de fin del microciclo no puede ser anterior a la fecha de inicio.'), { status: 400 });
  }
  return microcycle;
}

function validateMicrocycleInsideMesocycle(microcycle, mesocycle) {
  if (microcycle.week_start < mesocycle.start_date || microcycle.end_date > mesocycle.end_date) {
    throw Object.assign(new Error('Las fechas del microciclo deben estar dentro del mesociclo.'), { status: 400 });
  }
}

async function ensureMicrocycleStartAvailable(athleteId, weekStart, excludeId = null) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const candidates = [];
    if (athlete && athlete.week) candidates.push(athlete.week);
    if (Array.isArray(athlete && athlete.microcycles)) candidates.push(...athlete.microcycles);
    if (candidates.some(item => item.week_start === weekStart && item.id !== excludeId)) {
      throw Object.assign(new Error('Ya existe un microciclo con esa fecha de inicio.'), { status: 409 });
    }
    return;
  }
  const rows = await prodRows(
    'training_weeks',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&week_start=eq.${weekStart}&select=id`
  );
  if (rows.some(item => item.id !== excludeId)) {
    throw Object.assign(new Error('Ya existe un microciclo con esa fecha de inicio.'), { status: 409 });
  }
}

async function addMicrocycle(athleteId, mesocycleId, body) {
  const mesocycle = await getMesocycleForAthlete(athleteId, mesocycleId);
  const data = normaliseMicrocycle(body);
  validateMicrocycleInsideMesocycle(data, mesocycle);
  await ensureMicrocycleStartAvailable(athleteId, data.week_start);

  const row = {
    id: crypto.randomUUID(),
    athlete_id: athleteId,
    mesocycle_id: mesocycleId,
    ...data,
    published_at: data.status === 'published' ? new Date().toISOString() : null,
  };
  const sourceWorkouts = Array.isArray(body && body.workouts) ? body.workouts : [];
  const workouts = sourceWorkouts.map((item, index) => normaliseWorkout(item, athleteId, data.week_start, index));

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!Array.isArray(athlete.microcycles)) athlete.microcycles = [];
    row.workouts = workouts;
    athlete.microcycles.push(row);
    saveDemo();
    return microcycleFromRow(row, workouts);
  }

  const rows = await prodRows('training_weeks', '', { method: 'POST', body: row });
  const saved = rows[0];
  const savedWorkouts = workouts.length ? await persistWeekWorkouts(saved, athleteId, workouts, saved.status) : [];
  return microcycleFromRow(saved, savedWorkouts);
}

async function updateMicrocycle(microcycleId, athleteId, body) {
  const existing = await getMicrocycleForAthlete(athleteId, microcycleId);
  const mesocycleId = sanitiseText(body && body.mesocycle_id, 80) || existing.mesocycle_id;
  if (!mesocycleId) throw Object.assign(new Error('El microciclo debe pertenecer a un mesociclo.'), { status: 400 });
  const mesocycle = await getMesocycleForAthlete(athleteId, mesocycleId);
  const existingShape = {
    ...existing,
    start_date: existing.week_start,
    name: existing.title,
    type: existing.microcycle_type,
    notes: existing.coach_comment,
    planned_load: existing.target_load,
    publication_status: existing.status,
  };
  const data = normaliseMicrocycle(body, existingShape);
  validateMicrocycleInsideMesocycle(data, mesocycle);
  await ensureMicrocycleStartAvailable(athleteId, data.week_start, microcycleId);

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const candidates = [];
    if (athlete.week) candidates.push({ kind: 'week', item: athlete.week });
    if (Array.isArray(athlete.microcycles)) athlete.microcycles.forEach(item => candidates.push({ kind: 'array', item }));
    const found = candidates.find(entry => entry.item.id === microcycleId);
    const currentWorkouts = found.item.workouts || [];
    const workouts = Array.isArray(body && body.workouts)
      ? body.workouts.map((item, index) => normaliseWorkout(item, athleteId, data.week_start, index))
      : currentWorkouts;
    const updated = { ...found.item, ...data, mesocycle_id: mesocycleId, workouts };
    if (found.kind === 'week') athlete.week = updated;
    else {
      const index = athlete.microcycles.findIndex(item => item.id === microcycleId);
      athlete.microcycles[index] = updated;
    }
    saveDemo();
    return microcycleFromRow(updated, workouts);
  }

  const payload = { ...data, mesocycle_id: mesocycleId };
  if (data.status === 'published' && !existing.published_at) payload.published_at = new Date().toISOString();
  const rows = await prodRows(
    'training_weeks',
    `id=eq.${encodeURIComponent(microcycleId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
    { method: 'PATCH', body: payload }
  );
  if (!rows.length) throw Object.assign(new Error('Microciclo no encontrado.'), { status: 404 });
  const saved = rows[0];

  let workouts;
  if (Array.isArray(body && body.workouts)) {
    const normalised = body.workouts.map((item, index) => normaliseWorkout(item, athleteId, data.week_start, index));
    workouts = await persistWeekWorkouts(saved, athleteId, normalised, saved.status);
  } else {
    workouts = await prodRows('workouts', `training_week_id=eq.${encodeURIComponent(saved.id)}&select=*&order=workout_date.asc`);
  }
  return microcycleFromRow(saved, workouts);
}

function sportKey(value) {
  const sport = String(value || '').toLowerCase();
  if (sport.includes('strength') || sport.includes('fuerza')) return 'strength';
  if (sport.includes('ride') || sport.includes('cycle') || sport.includes('bike') || sport.includes('cicl')) return 'ride';
  if (sport.includes('run') || sport.includes('trail') || sport.includes('correr')) return 'run';
  return sport;
}

function calculateExecutionMetrics(workouts, activities, manualLogs) {
  const workoutIds = new Set(workouts.map(item => String(item.id)));
  const logsByWorkout = new Map();
  for (const log of manualLogs || []) {
    if (!log.workout_id || !workoutIds.has(String(log.workout_id))) continue;
    if (!logsByWorkout.has(String(log.workout_id))) logsByWorkout.set(String(log.workout_id), []);
    logsByWorkout.get(String(log.workout_id)).push(log);
  }

  const linkedActivities = new Map();
  for (const activity of activities || []) {
    if (activity.workout_id && workoutIds.has(String(activity.workout_id))) {
      if (!linkedActivities.has(String(activity.workout_id))) linkedActivities.set(String(activity.workout_id), []);
      linkedActivities.get(String(activity.workout_id)).push(activity);
    }
  }

  const workoutsByDateSport = new Map();
  for (const workout of workouts) {
    const key = `${workout.workout_date}|${sportKey(workout.sport)}`;
    if (!workoutsByDateSport.has(key)) workoutsByDateSport.set(key, []);
    workoutsByDateSport.get(key).push(workout);
  }

  const fallbackActivityIds = new Set();
  const completedWorkoutIds = new Set();
  for (const workout of workouts) {
    const id = String(workout.id);
    const logs = logsByWorkout.get(id) || [];
    const explicitActivity = linkedActivities.get(id) || [];
    if (explicitActivity.length || logs.some(log => ['completed', 'partial'].includes(log.status))) {
      completedWorkoutIds.add(id);
      continue;
    }

    const key = `${workout.workout_date}|${sportKey(workout.sport)}`;
    const candidates = workoutsByDateSport.get(key) || [];
    if (candidates.length !== 1) continue;
    const activity = (activities || []).find(item =>
      !item.workout_id &&
      String(item.activity_date || '').slice(0, 10) === workout.workout_date &&
      sportKey(item.sport) === sportKey(workout.sport)
    );
    if (activity) {
      completedWorkoutIds.add(id);
      fallbackActivityIds.add(String(activity.id || activity.intervals_activity_id));
    }
  }

  const relevantActivities = (activities || []).filter(item => {
    if (item.workout_id) return workoutIds.has(String(item.workout_id));
    return fallbackActivityIds.has(String(item.id || item.intervals_activity_id));
  });

  const activityDurationSec = relevantActivities.reduce((sum, item) => sum + Number(item.duration_sec || 0), 0);
  const linkedActivityWorkoutIds = new Set(relevantActivities.filter(item => item.workout_id).map(item => String(item.workout_id)));
  let manualDurationMin = 0;
  for (const [workoutId, logs] of logsByWorkout.entries()) {
    if (linkedActivityWorkoutIds.has(workoutId)) continue;
    const completed = logs.find(log => ['completed', 'partial'].includes(log.status));
    if (completed) manualDurationMin += Number(completed.actual_duration_min || 0);
  }

  const strengthWorkoutIds = new Set(
    workouts.filter(item => item.is_strength || sportKey(item.sport) === 'strength').map(item => String(item.id))
  );
  const completedStrength = [...completedWorkoutIds].filter(id => strengthWorkoutIds.has(id)).length;
  const aWorkouts = workouts.filter(item => item.priority === 'A');
  const completedA = aWorkouts.filter(item => completedWorkoutIds.has(String(item.id))).length;

  return {
    hours: roundOrNull((activityDurationSec / 3600) + (manualDurationMin / 60), 2) || 0,
    distance_km: roundOrNull(relevantActivities.reduce((sum, item) => sum + Number(item.distance_m || 0), 0) / 1000, 2) || 0,
    elevation_m: roundOrNull(relevantActivities.reduce((sum, item) => sum + Number(item.elevation_gain_m || 0), 0), 1) || 0,
    load: roundOrNull(relevantActivities.reduce((sum, item) => sum + Number(item.load || 0), 0), 2) || 0,
    strength_sessions: completedStrength,
    completion_rate: workouts.length ? roundOrNull((completedWorkoutIds.size / workouts.length) * 100, 1) : 0,
    a_sessions_completion_pct: aWorkouts.length ? roundOrNull((completedA / aWorkouts.length) * 100, 1) : null,
  };
}

async function loadExecutionForRange(athleteId, oldest, newest, workouts) {
  if (DEMO_MODE) {
    const activities = (demo.activities || []).filter(item => item.athlete_id === athleteId && String(item.activity_date).slice(0, 10) >= oldest && String(item.activity_date).slice(0, 10) <= newest);
    const manualLogs = (demo.manual_logs || []).filter(item => item.athlete_id === athleteId);
    return calculateExecutionMetrics(workouts, activities, manualLogs);
  }

  const workoutIds = workouts.map(item => item.id);
  const [activities, manualLogs] = await Promise.all([
    prodRows(
      'activities',
      `athlete_id=eq.${encodeURIComponent(athleteId)}&activity_date=gte.${oldest}T00:00:00&activity_date=lte.${newest}T23:59:59&select=id,workout_id,activity_date,sport,duration_sec,distance_m,elevation_gain_m,load`
    ),
    workoutIds.length
      ? prodRows('manual_session_logs', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=in.(${workoutIds.join(',')})&select=*`)
      : Promise.resolve([]),
  ]);
  return calculateExecutionMetrics(workouts, activities, manualLogs);
}

function mesocycleApi(row, microcycles, actual) {
  return {
    id: row.id,
    macrocycle_id: row.macrocycle_id,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    duration_weeks: row.duration_weeks,
    primary_adaptation: row.primary_adaptation,
    secondary_adaptations: Array.isArray(row.secondary_adaptations) ? row.secondary_adaptations : [],
    planned: {
      hours: Number(row.planned_hours || 0),
      distance_km: Number(row.planned_distance_km || 0),
      elevation_m: Number(row.planned_elevation_m || 0),
      load: Number(row.planned_load || 0),
      strength_sessions: Number(row.planned_strength_sessions || 0),
      intensity_distribution: safeObject(row.planned_intensity_distribution),
    },
    actual: {
      ...(actual || {
        hours: Number(row.actual_hours || 0),
        distance_km: Number(row.actual_distance_km || 0),
        elevation_m: Number(row.actual_elevation_m || 0),
        load: Number(row.actual_load || 0),
        strength_sessions: Number(row.actual_strength_sessions || 0),
      }),
      intensity_distribution: safeObject(row.actual_intensity_distribution),
    },
    progression_pattern: Array.isArray(row.progression_pattern) ? row.progression_pattern : [],
    success_criteria: row.success_criteria || '',
    success_criteria_rules: Array.isArray(row.success_criteria_rules) ? row.success_criteria_rules : [],
    status: row.status,
    notes: row.notes || '',
    metrics_updated_at: row.metrics_updated_at || null,
    microcycles,
  };
}

async function getCycleEvaluations(athleteId, filters = {}) {
  if (DEMO_MODE) {
    if (!Array.isArray(demo.cycle_evaluations)) demo.cycle_evaluations = [];
    return demo.cycle_evaluations
      .filter(item => item.athlete_id === athleteId)
      .filter(item => !filters.macrocycle_id || item.macrocycle_id === filters.macrocycle_id)
      .filter(item => !filters.mesocycle_id || item.mesocycle_id === filters.mesocycle_id)
      .filter(item => !filters.microcycle_id || item.microcycle_id === filters.microcycle_id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  const query = [`athlete_id=eq.${encodeURIComponent(athleteId)}`];
  if (filters.macrocycle_id) query.push(`macrocycle_id=eq.${encodeURIComponent(filters.macrocycle_id)}`);
  if (filters.mesocycle_id) query.push(`mesocycle_id=eq.${encodeURIComponent(filters.mesocycle_id)}`);
  if (filters.microcycle_id) query.push(`microcycle_id=eq.${encodeURIComponent(filters.microcycle_id)}`);
  query.push('select=*', 'order=created_at.desc');
  return prodRows('cycle_evaluations', query.join('&'));
}

async function validateEvaluationCycle(athleteId, body) {
  const ids = ['macrocycle_id', 'mesocycle_id', 'microcycle_id']
    .map(key => sanitiseText(body && body[key], 80) || null);
  if (ids.filter(Boolean).length !== 1) {
    throw Object.assign(new Error('La evaluación debe pertenecer exactamente a un macrociclo, mesociclo o microciclo.'), { status: 400 });
  }
  if (ids[0]) await getMacrocycleForAthlete(athleteId, ids[0]);
  if (ids[1]) await getMesocycleForAthlete(athleteId, ids[1]);
  if (ids[2]) await getMicrocycleForAthlete(athleteId, ids[2]);
  return { macrocycle_id: ids[0], mesocycle_id: ids[1], microcycle_id: ids[2] };
}

function normaliseEvaluation(body, existing = {}) {
  const source = { ...existing, ...(body || {}) };
  return {
    evaluation_type: ['interim', 'final'].includes(source.evaluation_type) ? source.evaluation_type : 'final',
    evaluation_status: ['draft', 'final'].includes(source.evaluation_status) ? source.evaluation_status : 'draft',
    completion_rate: numberOrNull(source.completion_rate, 0, 100),
    fatigue: numberOrNull(source.fatigue, 0, 10),
    fitness_change: numberOrNull(source.fitness_change, -100000, 100000),
    subjective_feeling: numberOrNull(source.subjective_feeling, 1, 10),
    injury_status: sanitiseText(source.injury_status, 3000),
    goal_achieved: ['yes', 'partial', 'no'].includes(source.goal_achieved) ? source.goal_achieved : null,
    coach_notes: sanitiseText(source.coach_notes, 5000),
    adjustment_decision: ['advance', 'prolong', 'deload', 'modify', 'repeat', 'none'].includes(source.adjustment_decision)
      ? source.adjustment_decision
      : null,
    adjustment_notes: sanitiseText(source.adjustment_notes, 5000),
    metrics_snapshot: safeObject(source.metrics_snapshot),
    updated_at: new Date().toISOString(),
  };
}

async function addCycleEvaluation(session, athleteId, body) {
  const cycle = await validateEvaluationCycle(athleteId, body);
  const evaluation = {
    id: crypto.randomUUID(),
    athlete_id: athleteId,
    coach_user_id: session.user.id,
    ...cycle,
    ...normaliseEvaluation(body),
    created_at: new Date().toISOString(),
  };

  if (DEMO_MODE) {
    if (!Array.isArray(demo.cycle_evaluations)) demo.cycle_evaluations = [];
    if (evaluation.evaluation_type === 'final') {
      const duplicate = demo.cycle_evaluations.find(item =>
        item.athlete_id === athleteId &&
        item.evaluation_type === 'final' &&
        ((evaluation.macrocycle_id && item.macrocycle_id === evaluation.macrocycle_id) ||
         (evaluation.mesocycle_id && item.mesocycle_id === evaluation.mesocycle_id) ||
         (evaluation.microcycle_id && item.microcycle_id === evaluation.microcycle_id))
      );
      if (duplicate) throw Object.assign(new Error('Ya existe una evaluación final para este ciclo.'), { status: 409 });
    }
    demo.cycle_evaluations.push(evaluation);
    saveDemo();
    return evaluation;
  }

  const rows = await prodRows('cycle_evaluations', '', { method: 'POST', body: evaluation });
  return rows[0];
}

async function getEvaluationForAthlete(athleteId, evaluationId) {
  if (DEMO_MODE) {
    if (!Array.isArray(demo.cycle_evaluations)) demo.cycle_evaluations = [];
    const evaluation = demo.cycle_evaluations.find(item => item.id === evaluationId && item.athlete_id === athleteId);
    if (!evaluation) throw Object.assign(new Error('Evaluación no encontrada.'), { status: 404 });
    return evaluation;
  }
  const rows = await prodRows(
    'cycle_evaluations',
    `id=eq.${encodeURIComponent(evaluationId)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`
  );
  if (!rows.length) throw Object.assign(new Error('Evaluación no encontrada.'), { status: 404 });
  return rows[0];
}

async function updateCycleEvaluation(session, evaluationId, athleteId, body) {
  const existing = await getEvaluationForAthlete(athleteId, evaluationId);
  const cycleInput = {
    macrocycle_id: hasOwn(body, 'macrocycle_id') ? body.macrocycle_id : existing.macrocycle_id,
    mesocycle_id: hasOwn(body, 'mesocycle_id') ? body.mesocycle_id : existing.mesocycle_id,
    microcycle_id: hasOwn(body, 'microcycle_id') ? body.microcycle_id : existing.microcycle_id,
  };
  const cycle = await validateEvaluationCycle(athleteId, cycleInput);
  const data = {
    ...cycle,
    ...normaliseEvaluation(body, existing),
    coach_user_id: session.user.id,
  };

  if (DEMO_MODE) {
    const index = demo.cycle_evaluations.findIndex(item => item.id === evaluationId && item.athlete_id === athleteId);
    demo.cycle_evaluations[index] = { ...existing, ...data, id: evaluationId };
    saveDemo();
    return demo.cycle_evaluations[index];
  }

  const rows = await prodRows(
    'cycle_evaluations',
    `id=eq.${encodeURIComponent(evaluationId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
    { method: 'PATCH', body: data }
  );
  if (!rows.length) throw Object.assign(new Error('Evaluación no encontrada.'), { status: 404 });
  return rows[0];
}

async function getPlan(athleteId, requestedSeasonId = null) {
  const seasons = await listSeasons(athleteId);
  const season = requestedSeasonId
    ? await getSeasonForAthlete(athleteId, requestedSeasonId)
    : seasons.find(item => item.status === 'active') || seasons[0] || null;

  const allGoals = await listGoals(athleteId);
  if (!season) {
    return {
      season: null,
      goals: [],
      macrocycles: [],
      unassigned: {
        goals: allGoals,
        microcycles: [],
      },
    };
  }

  let macroRows;
  let mesoRows;
  let microRows;
  let workoutRows;

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    macroRows = (athlete.macrocycles || []).filter(item => item.season_id === season.id).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    const macroIds = new Set(macroRows.map(item => item.id));
    mesoRows = (athlete.mesocycles || []).filter(item => macroIds.has(item.macrocycle_id)).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    const mesoIds = new Set(mesoRows.map(item => item.id));
    microRows = [];
    if (athlete.week && mesoIds.has(athlete.week.mesocycle_id)) microRows.push(athlete.week);
    if (Array.isArray(athlete.microcycles)) microRows.push(...athlete.microcycles.filter(item => mesoIds.has(item.mesocycle_id)));
    workoutRows = microRows.flatMap(item => (item.workouts || []).map(workout => ({ ...workout, training_week_id: item.id })));
  } else {
    macroRows = await prodRows(
      'macrocycles',
      `athlete_id=eq.${encodeURIComponent(athleteId)}&season_id=eq.${encodeURIComponent(season.id)}&select=*&order=start_date.asc`
    );
    const macroIds = macroRows.map(item => item.id);
    mesoRows = macroIds.length
      ? await prodRows('mesocycles', `athlete_id=eq.${encodeURIComponent(athleteId)}&macrocycle_id=in.(${macroIds.join(',')})&select=*&order=start_date.asc`)
      : [];
    const mesoIds = mesoRows.map(item => item.id);
    microRows = mesoIds.length
      ? await prodRows('training_weeks', `athlete_id=eq.${encodeURIComponent(athleteId)}&mesocycle_id=in.(${mesoIds.join(',')})&select=*&order=week_start.asc`)
      : [];
    const microIds = microRows.map(item => item.id);
    workoutRows = microIds.length
      ? await prodRows('workouts', `training_week_id=in.(${microIds.join(',')})&select=*&order=workout_date.asc`)
      : [];
  }

  const workoutsByMicro = new Map();
  workoutRows.forEach(workout => {
    if (!workoutsByMicro.has(workout.training_week_id)) workoutsByMicro.set(workout.training_week_id, []);
    workoutsByMicro.get(workout.training_week_id).push(workout);
  });

  const microApiByMeso = new Map();
  for (const row of microRows) {
    const workouts = workoutsByMicro.get(row.id) || row.workouts || [];
    const actual = await loadExecutionForRange(athleteId, row.week_start, row.end_date || addDays(row.week_start, 6), workouts);
    const shaped = microcycleFromRow(row, workouts, actual);
    if (!microApiByMeso.has(row.mesocycle_id)) microApiByMeso.set(row.mesocycle_id, []);
    microApiByMeso.get(row.mesocycle_id).push(shaped);
  }

  const mesoApiByMacro = new Map();
  for (const row of mesoRows) {
    const microcycles = microApiByMeso.get(row.id) || [];
    const workouts = microcycles.flatMap(item => item.workouts || []);
    const actual = await loadExecutionForRange(athleteId, row.start_date, row.end_date, workouts);
    const shaped = mesocycleApi(row, microcycles, actual);
    if (!mesoApiByMacro.has(row.macrocycle_id)) mesoApiByMacro.set(row.macrocycle_id, []);
    mesoApiByMacro.get(row.macrocycle_id).push(shaped);
  }

  const evaluations = await getCycleEvaluations(athleteId);
  const latestEvaluation = cycleId => evaluations.find(item =>
    item.macrocycle_id === cycleId || item.mesocycle_id === cycleId || item.microcycle_id === cycleId
  ) || null;

  const macrocycles = macroRows.map(row => ({
    ...row,
    mesocycles: (mesoApiByMacro.get(row.id) || []).map(meso => ({
      ...meso,
      evaluation: latestEvaluation(meso.id),
      microcycles: (meso.microcycles || []).map(micro => ({ ...micro, evaluation: latestEvaluation(micro.id) })),
    })),
    evaluation: latestEvaluation(row.id),
  }));

  const goals = allGoals.filter(goal => goal.season_id === season.id);
  let unassignedMicrocycles = [];
  if (!DEMO_MODE) {
    const rows = await prodRows(
      'training_weeks',
      `athlete_id=eq.${encodeURIComponent(athleteId)}&mesocycle_id=is.null&week_start=gte.${season.start_date}&week_start=lte.${season.end_date}&select=*&order=week_start.asc`
    );
    if (rows.length) {
      const ids = rows.map(item => item.id);
      const workouts = await prodRows('workouts', `training_week_id=in.(${ids.join(',')})&select=*&order=workout_date.asc`);
      const grouped = new Map();
      workouts.forEach(item => {
        if (!grouped.has(item.training_week_id)) grouped.set(item.training_week_id, []);
        grouped.get(item.training_week_id).push(item);
      });
      unassignedMicrocycles = rows.map(row => microcycleFromRow(row, grouped.get(row.id) || []));
    }
  }

  return {
    season,
    goals,
    macrocycles,
    unassigned: {
      goals: allGoals.filter(goal => !goal.season_id),
      microcycles: unassignedMicrocycles,
    },
  };
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
    elevation_gain_m: roundOrNull(firstFinite(item || {}, ['total_elevation_gain', 'elevation_gain', 'icu_elevation_gain']), 1),
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
  return prodRows('activities', `athlete_id=eq.${encodeURIComponent(athleteId)}&activity_date=gte.${oldest}T00:00:00&activity_date=lte.${newest}T23:59:59&select=id,athlete_id,workout_id,intervals_activity_id,activity_date,sport,name,duration_sec,distance_m,elevation_gain_m,load,avg_hr,max_hr,avg_pace_sec_per_km&order=activity_date.desc`);
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

async function linkActivityToWorkout(athleteId, externalId, workoutId) {
  const targetWorkoutId = sanitiseText(workoutId, 80) || null;

  if (DEMO_MODE) {
    const activity = demo.activities.find(item => item.athlete_id === athleteId && item.intervals_activity_id === externalId);
    if (!activity) throw Object.assign(new Error('Actividad no encontrada.'), { status: 404 });

    if (targetWorkoutId) {
      const athlete = demo.athletes.find(item => item.id === athleteId);
      const workouts = [];
      if (athlete && athlete.week) workouts.push(...(athlete.week.workouts || []));
      if (athlete && Array.isArray(athlete.microcycles)) athlete.microcycles.forEach(item => workouts.push(...(item.workouts || [])));
      if (!workouts.some(item => item.id === targetWorkoutId)) {
        throw Object.assign(new Error('La sesión no pertenece a este deportista.'), { status: 400 });
      }
    }

    activity.workout_id = targetWorkoutId;
    saveDemo();
    return publicActivitySummary(activity);
  }

  const activity = await activityRowByExternalId(athleteId, externalId);
  if (!activity) throw Object.assign(new Error('Actividad no encontrada.'), { status: 404 });

  if (targetWorkoutId) {
    const workouts = await prodRows(
      'workouts',
      `id=eq.${encodeURIComponent(targetWorkoutId)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=id&limit=1`
    );
    if (!workouts.length) throw Object.assign(new Error('La sesión no pertenece a este deportista.'), { status: 400 });
  }

  const rows = await prodRows(
    'activities',
    `id=eq.${encodeURIComponent(activity.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
    { method: 'PATCH', body: { workout_id: targetWorkoutId } }
  );
  return publicActivitySummary(rows[0]);
}

async function activityReview(session, athleteId, activityId) {
  if (DEMO_MODE) {
    return demo.activity_reviews.find(
      item => item.athlete_id === athleteId && item.activity_id === activityId && item.coach_user_id === session.user.id
    ) || null;
  }
  const rows = await prodRows(
    'activity_reviews',
    `athlete_id=eq.${encodeURIComponent(athleteId)}&activity_id=eq.${encodeURIComponent(activityId)}&coach_user_id=eq.${encodeURIComponent(session.user.id)}&select=*&limit=1`
  );
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
      await prodRows('activities', 'on_conflict=athlete_id,intervals_activity_id', {
        method: 'POST',
        body: normalised,
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
      stored = await activityRowByExternalId(athleteId, externalId);
    }
  }

  if (!stored) throw Object.assign(new Error('Actividad no encontrada.'), { status: 404 });
  const date = String(stored.activity_date).slice(0, 10);
  let planned = null;
  let recovery = [];

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const allWorkouts = [];
    if (athlete && athlete.week) allWorkouts.push(...(athlete.week.workouts || []));
    if (athlete && Array.isArray(athlete.microcycles)) {
      athlete.microcycles.forEach(item => allWorkouts.push(...(item.workouts || [])));
    }
    planned = stored.workout_id
      ? allWorkouts.find(item => item.id === stored.workout_id) || null
      : allWorkouts.find(item => item.workout_date === date) || null;
    recovery = await listRecoveryRows(athleteId, addDays(date, -21), date);
  } else {
    const [plannedRows, recoveryRows] = await Promise.all([
      stored.workout_id
        ? prodRows(
            'workouts',
            `id=eq.${encodeURIComponent(stored.workout_id)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`
          )
        : prodRows(
            'workouts',
            `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_date=eq.${date}&select=*&order=planned_load.desc&limit=1`
          ),
      listRecoveryRows(athleteId, addDays(date, -21), date),
    ]);
    planned = plannedRows[0] || null;
    recovery = recoveryRows;
  }

  return {
    activity: { ...stored, raw_summary: raw, intervals: summariseIntervals(raw) },
    planned,
    recovery,
    review: await activityReview(session, athleteId, stored.id),
  };
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

  const planMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/plan$/);
  if (planMatch && method === 'GET') {
    const athleteId = planMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, await getPlan(athleteId, url.searchParams.get('season_id')));
  }

  const seasonsMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/seasons$/);
  if (seasonsMatch && method === 'GET') {
    const athleteId = seasonsMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { seasons: await listSeasons(athleteId) });
  }
  if (seasonsMatch && method === 'POST') {
    const athleteId = seasonsMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 201, { season: await addSeason(athleteId, await readJson(req)) });
  }

  const seasonMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/seasons\/([^/]+)$/);
  if (seasonMatch && method === 'PUT') {
    const athleteId = seasonMatch[1];
    const seasonId = seasonMatch[2];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { season: await updateSeason(seasonId, athleteId, await readJson(req)) });
  }

  const seasonMacrocyclesMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/seasons\/([^/]+)\/macrocycles$/);
  if (seasonMacrocyclesMatch && method === 'GET') {
    const athleteId = seasonMacrocyclesMatch[1];
    const seasonId = seasonMacrocyclesMatch[2];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { macrocycles: await listMacrocycles(athleteId, seasonId) });
  }
  if (seasonMacrocyclesMatch && method === 'POST') {
    const athleteId = seasonMacrocyclesMatch[1];
    const seasonId = seasonMacrocyclesMatch[2];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 201, { macrocycle: await addMacrocycle(athleteId, seasonId, await readJson(req)) });
  }

  const macrocycleMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/macrocycles\/([^/]+)$/);
  if (macrocycleMatch && method === 'PUT') {
    const athleteId = macrocycleMatch[1];
    const macrocycleId = macrocycleMatch[2];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { macrocycle: await updateMacrocycle(macrocycleId, athleteId, await readJson(req)) });
  }

  const macroMesocyclesMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/macrocycles\/([^/]+)\/mesocycles$/);
  if (macroMesocyclesMatch && method === 'GET') {
    const athleteId = macroMesocyclesMatch[1];
    const macrocycleId = macroMesocyclesMatch[2];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { mesocycles: await listMesocycles(athleteId, macrocycleId) });
  }
  if (macroMesocyclesMatch && method === 'POST') {
    const athleteId = macroMesocyclesMatch[1];
    const macrocycleId = macroMesocyclesMatch[2];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 201, { mesocycle: await addMesocycle(athleteId, macrocycleId, await readJson(req)) });
  }

  const mesocycleMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/mesocycles\/([^/]+)$/);
  if (mesocycleMatch && method === 'PUT') {
    const athleteId = mesocycleMatch[1];
    const mesocycleId = mesocycleMatch[2];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { mesocycle: await updateMesocycle(mesocycleId, athleteId, await readJson(req)) });
  }

  const mesoMicrocyclesMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/mesocycles\/([^/]+)\/microcycles$/);
  if (mesoMicrocyclesMatch && method === 'GET') {
    const athleteId = mesoMicrocyclesMatch[1];
    const mesocycleId = mesoMicrocyclesMatch[2];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { microcycles: await listMicrocycles(athleteId, mesocycleId) });
  }
  if (mesoMicrocyclesMatch && method === 'POST') {
    const athleteId = mesoMicrocyclesMatch[1];
    const mesocycleId = mesoMicrocyclesMatch[2];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 201, { microcycle: await addMicrocycle(athleteId, mesocycleId, await readJson(req)) });
  }

  const microcycleMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/microcycles\/([^/]+)$/);
  if (microcycleMatch && method === 'PUT') {
    const athleteId = microcycleMatch[1];
    const microcycleId = microcycleMatch[2];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { microcycle: await updateMicrocycle(microcycleId, athleteId, await readJson(req)) });
  }

  const goalsMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/goals$/);
  if (goalsMatch && method === 'GET') {
    const athleteId = goalsMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { goals: await listGoals(athleteId) });
  }
  if (goalsMatch && method === 'POST') {
    const athleteId = goalsMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 201, { goal: await addGoal(athleteId, await readJson(req)) });
  }

  const goalMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/goals\/([^/]+)$/);
  if (goalMatch && method === 'PUT') {
    const athleteId = goalMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { goal: await updateGoal(goalMatch[2], athleteId, await readJson(req)) });
  }
  if (goalMatch && method === 'DELETE') {
    const athleteId = goalMatch[1];
    await ensureCoachAccess(session, athleteId);
    await deleteGoal(goalMatch[2], athleteId);
    return sendJson(res, 200, { ok: true });
  }

  const evaluationsMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/evaluations$/);
  if (evaluationsMatch && method === 'GET') {
    const athleteId = evaluationsMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, {
      evaluations: await getCycleEvaluations(athleteId, {
        macrocycle_id: url.searchParams.get('macrocycle_id'),
        mesocycle_id: url.searchParams.get('mesocycle_id'),
        microcycle_id: url.searchParams.get('microcycle_id'),
      }),
    });
  }
  if (evaluationsMatch && method === 'POST') {
    const athleteId = evaluationsMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 201, { evaluation: await addCycleEvaluation(session, athleteId, await readJson(req)) });
  }

  const evaluationMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/evaluations\/([^/]+)$/);
  if (evaluationMatch && method === 'PUT') {
    const athleteId = evaluationMatch[1];
    const evaluationId = evaluationMatch[2];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, {
      evaluation: await updateCycleEvaluation(session, evaluationId, athleteId, await readJson(req)),
    });
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

  const activityWorkoutLinkMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/activities\/([^/]+)\/workout$/);
  if (activityWorkoutLinkMatch && method === 'PUT') {
    const athleteId = activityWorkoutLinkMatch[1];
    const externalId = decodeURIComponent(activityWorkoutLinkMatch[2]);
    await ensureCoachAccess(session, athleteId);
    const body = await readJson(req);
    return sendJson(res, 200, {
      activity: await linkActivityToWorkout(athleteId, externalId, body.workout_id),
    });
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
