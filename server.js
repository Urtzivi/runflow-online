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
const APP_VERSION = 'Online Pilot 1.9.3 - Dashboard Athlete tolerante a fallos';
const INTERVALS_API_BASE = 'https://intervals.icu/api/v1';

const RUNFLOW_PLAN_SCHEMA = 'runflow.plan.v1';

// Biblioteca base de sesiones. La carga es orientativa y siempre editable por el coach.
const SYSTEM_WORKOUT_TEMPLATES = [
  {
    id: 'system-run-z2-40', source: 'system', name: 'Rodaje Z2 · 40 min', category: 'Rodaje', sport: 'Run', stimulus: 'Base aeróbica',
    template_data: { sport: 'Run', priority: 'C', planned_load: 40, planned_duration_min: 40, planned_distance_km: 7, planned_elevation_m: 50, is_strength: false,
      title: 'Rodaje aeróbico suave', session_objective: 'Acumular trabajo aeróbico de baja intensidad sin generar fatiga relevante.', adaptation_target: 'Base aeróbica', purpose: 'Sumar volumen fácil y favorecer la continuidad del entrenamiento.', summary: '40 min de carrera suave en Z2 por terreno cómodo. Ritmo controlado y sensación de poder seguir al terminar.',
      blocks: [{ type: 'warmup', duration_min: 10, target: 'Z1' }, { type: 'central', name: 'Rodaje Z2', repetitions: 1, work_value: 20, work_unit: 'm', target: 'Z2', recovery_value: 0, recovery_unit: 'm', recovery_target: '' }, { type: 'cooldown', duration_min: 10, target: 'Z1' }], structured_description: 'Calentamiento\n- 10m Z1\n\nRodaje Z2\n- 20m Z2\n\nVuelta a la calma\n- 10m Z1' }
  },
  {
    id: 'system-run-recovery-30', source: 'system', name: 'Regenerativo · 30 min', category: 'Rodaje', sport: 'Run', stimulus: 'Recuperación',
    template_data: { sport: 'Run', priority: 'C', planned_load: 22, planned_duration_min: 30, planned_distance_km: 5, planned_elevation_m: 30, is_strength: false,
      title: 'Rodaje regenerativo', session_objective: 'Favorecer la recuperación manteniendo movimiento aeróbico muy suave.', adaptation_target: 'Recuperación activa', purpose: 'Facilitar la asimilación de la carga previa.', summary: '30 min muy suaves, respiración cómoda y sin buscar ritmo.',
      blocks: [{ type: 'warmup', duration_min: 5, target: 'Z1' }, { type: 'central', name: 'Rodaje regenerativo', repetitions: 1, work_value: 20, work_unit: 'm', target: 'Z1-Z2 baja', recovery_value: 0, recovery_unit: 'm', recovery_target: '' }, { type: 'cooldown', duration_min: 5, target: 'Z1' }] }
  },
  {
    id: 'system-run-threshold-3x8', source: 'system', name: 'Umbral · 3 × 8 min', category: 'Umbral', sport: 'Run', stimulus: 'Umbral',
    template_data: { sport: 'Run', priority: 'A', planned_load: 55, planned_duration_min: 60, planned_distance_km: 11, planned_elevation_m: 80, is_strength: false,
      title: '3 × 8 min umbral', session_objective: 'Acumular tiempo de calidad cerca del umbral manteniendo control técnico y metabólico.', adaptation_target: 'Umbral / LT2', purpose: 'Desarrollar la capacidad de sostener intensidades altas sin convertir la sesión en un esfuerzo máximo.', summary: '3 × 8 min a intensidad de umbral con 2 min de trote suave entre bloques.',
      blocks: [{ type: 'warmup', duration_min: 15, target: 'Z1-Z2' }, { type: 'activation', repetitions: 4, work_sec: 20, recovery_sec: 40, target: 'Progresivo', recovery_target: 'Z1' }, { type: 'central', name: 'Umbral', repetitions: 3, work_value: 8, work_unit: 'm', target: 'Z4 / umbral', recovery_value: 2, recovery_unit: 'm', recovery_target: 'Trote Z1' }, { type: 'cooldown', duration_min: 10, target: 'Z1' }] }
  },
  {
    id: 'system-run-threshold-4x6', source: 'system', name: 'Umbral · 4 × 6 min', category: 'Umbral', sport: 'Run', stimulus: 'Umbral',
    template_data: { sport: 'Run', priority: 'A', planned_load: 54, planned_duration_min: 60, planned_distance_km: 11, planned_elevation_m: 80, is_strength: false,
      title: '4 × 6 min umbral', session_objective: 'Trabajar el umbral con repeticiones controladas y consistentes.', adaptation_target: 'Umbral / LT2', purpose: 'Acumular 24 minutos de trabajo de calidad con menor fatiga por repetición.', summary: '4 × 6 min a intensidad de umbral, recuperando 2 min al trote.',
      blocks: [{ type: 'warmup', duration_min: 15, target: 'Z1-Z2' }, { type: 'central', name: 'Umbral', repetitions: 4, work_value: 6, work_unit: 'm', target: 'Z4 / umbral', recovery_value: 2, recovery_unit: 'm', recovery_target: 'Z1' }, { type: 'cooldown', duration_min: 10, target: 'Z1' }] }
  },
  {
    id: 'system-run-vo2-6x3', source: 'system', name: 'VO₂max · 6 × 3 min', category: 'VO₂max', sport: 'Run', stimulus: 'VO₂max',
    template_data: { sport: 'Run', priority: 'A', planned_load: 60, planned_duration_min: 58, planned_distance_km: 10.5, planned_elevation_m: 80, is_strength: false,
      title: '6 × 3 min VO₂max', session_objective: 'Elevar el consumo de oxígeno y la capacidad de repetir esfuerzos intensos manteniendo buena mecánica.', adaptation_target: 'VO₂max', purpose: 'Introducir un estímulo intenso y dosificado dentro del bloque.', summary: '6 × 3 min fuerte y controlado, con 2 min suaves entre repeticiones.',
      blocks: [{ type: 'warmup', duration_min: 15, target: 'Z1-Z2' }, { type: 'activation', repetitions: 4, work_sec: 20, recovery_sec: 40, target: 'Progresivo', recovery_target: 'Z1' }, { type: 'central', name: 'VO₂max', repetitions: 6, work_value: 3, work_unit: 'm', target: 'Z5 / VO₂max', recovery_value: 2, recovery_unit: 'm', recovery_target: 'Z1' }, { type: 'cooldown', duration_min: 10, target: 'Z1' }] }
  },
  {
    id: 'system-run-vo2-10x1', source: 'system', name: 'VO₂max · 10 × 1 min', category: 'VO₂max', sport: 'Run', stimulus: 'VO₂max',
    template_data: { sport: 'Run', priority: 'B', planned_load: 48, planned_duration_min: 45, planned_distance_km: 8, planned_elevation_m: 60, is_strength: false,
      title: '10 × 1 min rápido', session_objective: 'Trabajar velocidad aeróbica y economía a ritmos altos con baja duración por repetición.', adaptation_target: 'VO₂max / economía', purpose: 'Aportar intensidad sin acumular demasiado tiempo continuo de fatiga.', summary: '10 × 1 min rápido con 1 min suave. Técnica limpia y sin sprintar.',
      blocks: [{ type: 'warmup', duration_min: 12, target: 'Z1-Z2' }, { type: 'central', name: 'Repeticiones rápidas', repetitions: 10, work_value: 1, work_unit: 'm', target: 'Z5', recovery_value: 1, recovery_unit: 'm', recovery_target: 'Z1' }, { type: 'cooldown', duration_min: 10, target: 'Z1' }] }
  },
  {
    id: 'system-run-hills-10x45', source: 'system', name: 'Cuestas · 10 × 45 s', category: 'Cuestas', sport: 'Run', stimulus: 'Fuerza específica / VO₂',
    template_data: { sport: 'Run', priority: 'B', planned_load: 45, planned_duration_min: 48, planned_distance_km: 7.5, planned_elevation_m: 250, is_strength: false,
      title: '10 × 45 s en cuesta', session_objective: 'Mejorar fuerza específica, técnica y capacidad de producir potencia en subida.', adaptation_target: 'Fuerza específica de carrera', purpose: 'Transferir fuerza al gesto de carrera con un estímulo corto y controlado.', summary: '10 × 45 s en cuesta con recuperación bajando suave. Priorizar técnica y potencia estable.',
      blocks: [{ type: 'warmup', duration_min: 15, target: 'Z1-Z2' }, { type: 'central', name: 'Cuestas', repetitions: 10, work_value: 45, work_unit: 's', target: 'Fuerte controlado', recovery_value: 75, recovery_unit: 's', recovery_target: 'Bajada suave' }, { type: 'cooldown', duration_min: 10, target: 'Z1' }] }
  },
  {
    id: 'system-run-long-90', source: 'system', name: 'Tirada larga · 90 min', category: 'Tirada larga', sport: 'Run', stimulus: 'Resistencia aeróbica',
    template_data: { sport: 'Run', priority: 'A', planned_load: 65, planned_duration_min: 90, planned_distance_km: 15, planned_elevation_m: 500, is_strength: false,
      title: 'Tirada larga aeróbica', session_objective: 'Desarrollar resistencia y tolerancia al tiempo de apoyo manteniendo intensidad aeróbica.', adaptation_target: 'Resistencia aeróbica', purpose: 'Construir la base de duración necesaria para trail y esfuerzos prolongados.', summary: '90 min aeróbicos, controlando el esfuerzo en subida y recuperando en terreno favorable.',
      blocks: [{ type: 'warmup', duration_min: 10, target: 'Z1-Z2' }, { type: 'central', name: 'Tirada larga', repetitions: 1, work_value: 70, work_unit: 'm', target: 'Z2 / esfuerzo aeróbico', recovery_value: 0, recovery_unit: 'm', recovery_target: '' }, { type: 'cooldown', duration_min: 10, target: 'Z1' }] }
  },
  {
    id: 'system-run-trail-climb', source: 'system', name: 'Trail · subidas controladas', category: 'Trail específico', sport: 'Run', stimulus: 'Subida / resistencia',
    template_data: { sport: 'Run', priority: 'A', planned_load: 58, planned_duration_min: 70, planned_distance_km: 10, planned_elevation_m: 600, is_strength: false,
      title: 'Trail con subidas controladas', session_objective: 'Mejorar la capacidad de subir de forma eficiente sin disparar la fatiga.', adaptation_target: 'Resistencia específica trail', purpose: 'Acercar el estímulo al terreno objetivo manteniendo control de intensidad.', summary: '70 min de trail. Subidas a esfuerzo controlado, bajadas fluidas y sin buscar velocidad máxima.',
      blocks: [{ type: 'warmup', duration_min: 10, target: 'Suave' }, { type: 'central', name: 'Trail aeróbico', repetitions: 1, work_value: 50, work_unit: 'm', target: 'Z2-Z3 en subida', recovery_value: 0, recovery_unit: 'm', recovery_target: '' }, { type: 'cooldown', duration_min: 10, target: 'Suave' }] }
  },
  {
    id: 'system-strength-trail-low-fatigue', source: 'system', name: 'Fuerza trail · baja fatiga · 35 min', category: 'Fuerza trail', sport: 'Strength', stimulus: 'Fuerza específica trail',
    template_data: { sport: 'Strength', priority: 'B', planned_load: 40, planned_duration_min: 35, planned_distance_km: 0, planned_elevation_m: 0, is_strength: true,
      title: 'Fuerza específica trail', session_objective: 'Desarrollar fuerza útil para subida, bajada y estabilidad con baja fatiga residual.', adaptation_target: 'Fuerza específica trail', purpose: 'Mejorar la fuerza de piernas y estabilidad sin comprometer las sesiones de carrera.', summary: '35 min de fuerza específica. Calidad de ejecución, descansos amplios y sin llegar al fallo.',
      blocks: [{ type: 'warmup', duration_min: 6, target: 'Movilidad + activación' }, { type: 'strength', neuromuscular_cost: 'low', exercises: [
        { name: 'Split squat', sets: 3, reps: '6/6', weight_kg: null, rir: 3, rest_sec: 90, unilateral: true, notes: 'Control de rodilla y pelvis' },
        { name: 'Peso muerto rumano a una pierna', sets: 3, reps: '6/6', weight_kg: null, rir: 3, rest_sec: 90, unilateral: true, notes: 'Cadera estable' },
        { name: 'Step-up alto', sets: 2, reps: '8/8', weight_kg: null, rir: 3, rest_sec: 75, unilateral: true, notes: 'Empuje completo' },
        { name: 'Elevación de sóleo', sets: 3, reps: '10/10', weight_kg: null, rir: 3, rest_sec: 60, unilateral: false, notes: 'Pausa arriba' },
        { name: 'Plancha lateral', sets: 2, reps: '30 s/lado', weight_kg: null, rir: null, rest_sec: 45, unilateral: false, notes: 'Pelvis neutra' }
      ] }, { type: 'cooldown', duration_min: 4, target: 'Movilidad suave' }] }
  },
  {
    id: 'system-strength-general-functional', source: 'system', name: 'Funcional general · 40 min', category: 'Fuerza general', sport: 'Strength', stimulus: 'Fuerza general',
    template_data: { sport: 'Strength', priority: 'B', planned_load: 60, planned_duration_min: 40, planned_distance_km: 0, planned_elevation_m: 0, is_strength: true,
      title: 'Funcional general', session_objective: 'Desarrollar fuerza general mediante un trabajo global de intensidad moderada.', adaptation_target: 'Fuerza general', purpose: 'Mantener una base de fuerza global.', summary: '40 min de fuerza funcional general. Evitar el fallo y controlar la fatiga de piernas.',
      blocks: [{ type: 'warmup', duration_min: 6, target: 'Movilidad + activación' }, { type: 'strength', neuromuscular_cost: 'medium', exercises: [
        { name: 'Sentadilla goblet', sets: 3, reps: '10', weight_kg: null, rir: 2, rest_sec: 60, unilateral: false, notes: '' },
        { name: 'Peso muerto rumano', sets: 3, reps: '10', weight_kg: null, rir: 2, rest_sec: 60, unilateral: false, notes: '' },
        { name: 'Remo con mancuerna', sets: 3, reps: '10/10', weight_kg: null, rir: 2, rest_sec: 45, unilateral: true, notes: '' },
        { name: 'Press de hombro', sets: 3, reps: '8/8', weight_kg: null, rir: 2, rest_sec: 45, unilateral: true, notes: '' },
        { name: 'Farmer carry', sets: 3, reps: '30 s', weight_kg: null, rir: null, rest_sec: 45, unilateral: false, notes: '' }
      ] }, { type: 'cooldown', duration_min: 4, target: 'Movilidad suave' }] }
  },
  {
    id: 'system-strength-downhill-eccentric', source: 'system', name: 'Fuerza excéntrica · bajadas', category: 'Fuerza trail', sport: 'Strength', stimulus: 'Tolerancia excéntrica',
    template_data: { sport: 'Strength', priority: 'B', planned_load: 42, planned_duration_min: 35, planned_distance_km: 0, planned_elevation_m: 0, is_strength: true,
      title: 'Fuerza excéntrica para bajadas', session_objective: 'Mejorar la tolerancia excéntrica de cuádriceps y el control de apoyo para descensos.', adaptation_target: 'Fuerza excéntrica / descenso', purpose: 'Preparar la musculatura para el coste mecánico de las bajadas de trail.', summary: 'Trabajo excéntrico controlado, sin llegar al fallo y con especial atención a la técnica.',
      blocks: [{ type: 'warmup', duration_min: 6, target: 'Movilidad + activación' }, { type: 'strength', neuromuscular_cost: 'medium', exercises: [
        { name: 'Step-down lento', sets: 3, reps: '6/6', weight_kg: null, rir: 3, rest_sec: 75, unilateral: true, notes: '3-4 s de bajada' },
        { name: 'Split squat excéntrico', sets: 3, reps: '6/6', weight_kg: null, rir: 3, rest_sec: 90, unilateral: true, notes: '3 s de bajada' },
        { name: 'Sentadilla española isométrica', sets: 3, reps: '30-40 s', weight_kg: null, rir: null, rest_sec: 60, unilateral: false, notes: '' },
        { name: 'Gemelo excéntrico', sets: 3, reps: '8/8', weight_kg: null, rir: 3, rest_sec: 60, unilateral: true, notes: 'Bajada lenta' }
      ] }, { type: 'cooldown', duration_min: 4, target: 'Movilidad suave' }] }
  },
  {
    id: 'system-strength-soleus-calf', source: 'system', name: 'Sóleo + gemelo · 25 min', category: 'Fuerza trail', sport: 'Strength', stimulus: 'Pie / tobillo',
    template_data: { sport: 'Strength', priority: 'C', planned_load: 25, planned_duration_min: 25, planned_distance_km: 0, planned_elevation_m: 0, is_strength: true,
      title: 'Sóleo, gemelo y pie', session_objective: 'Reforzar la musculatura del tobillo y la capacidad de producir fuerza repetida.', adaptation_target: 'Sóleo / gemelo / pie', purpose: 'Mejorar robustez y transferencia de fuerza en carrera y subida.', summary: '25 min específicos de sóleo, gemelo y pie con ejecución controlada.',
      blocks: [{ type: 'warmup', duration_min: 4, target: 'Tobillo + pie' }, { type: 'strength', neuromuscular_cost: 'low', exercises: [
        { name: 'Sóleo sentado', sets: 4, reps: '10', weight_kg: null, rir: 3, rest_sec: 60, unilateral: false, notes: '' },
        { name: 'Gemelo de pie', sets: 3, reps: '8/8', weight_kg: null, rir: 3, rest_sec: 60, unilateral: true, notes: '' },
        { name: 'Tibial anterior', sets: 3, reps: '15', weight_kg: null, rir: 3, rest_sec: 45, unilateral: false, notes: '' },
        { name: 'Short foot', sets: 2, reps: '8/8', weight_kg: null, rir: null, rest_sec: 30, unilateral: true, notes: 'Control del arco plantar' }
      ] }, { type: 'cooldown', duration_min: 3, target: 'Movilidad suave' }] }
  }
];

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


function sendBuffer(res, status, buffer, type = 'application/octet-stream', filename = null) {
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  const headers = {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...securityHeaders(),
  };
  if (filename) headers['Content-Disposition'] = `attachment; filename="${String(filename).replace(/["\\\r\n]/g, '_')}"`;
  res.writeHead(status, headers);
  res.end(body);
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
    messages: [],
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
if (!Array.isArray(demo.messages)) demo.messages = [];
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

async function authMagicLink(email) {
  const redirect = `${APP_BASE_URL}/login.html?mode=athlete`;
  return supabaseFetch(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
    method: 'POST',
    body: JSON.stringify({ email, create_user: false }),
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
  const athlete = await prodRows('athletes', `user_id=eq.${encodeURIComponent(userId)}&lifecycle_status=eq.active&select=id,display_name,email,lifecycle_status&limit=1`);
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

async function primaryCoachForAthlete(athleteId) {
  if (DEMO_MODE) {
    const link = (demo.coach_athletes || []).find(item => item.athlete_id === athleteId);
    return link ? link.coach_user_id : null;
  }
  const rows = await prodRows('coach_athletes', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=coach_user_id&limit=1`);
  return rows[0] ? rows[0].coach_user_id : null;
}

async function enrichMessagesWithWorkoutTitles(rows) {
  const messages = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(messages.map(item => item.workout_id).filter(Boolean))];
  if (!ids.length) return messages;
  if (DEMO_MODE) {
    const titleById = new Map();
    for (const athlete of demo.athletes || []) for (const workout of athlete.week?.workouts || []) titleById.set(String(workout.id), workout.title);
    return messages.map(item => ({ ...item, workout_title: item.workout_id ? titleById.get(String(item.workout_id)) || null : null }));
  }
  const workouts = await prodRows('workouts', `id=in.(${ids.join(',')})&select=id,title`);
  const titleById = new Map(workouts.map(item => [String(item.id), item.title]));
  return messages.map(item => ({ ...item, workout_title: item.workout_id ? titleById.get(String(item.workout_id)) || null : null }));
}

async function listAthleteMessages(athleteId, coachUserId, viewerRole, limit = 100, markRead = false) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 100)));
  if (DEMO_MODE) {
    const rows = (demo.messages || []).filter(item => item.athlete_id === athleteId && item.coach_user_id === coachUserId).sort((a,b) => String(a.created_at).localeCompare(String(b.created_at))).slice(-safeLimit);
    if (markRead) {
      const now = new Date().toISOString();
      for (const item of rows) {
        if (viewerRole === 'athlete' && item.sender_role === 'coach' && !item.read_by_athlete_at) item.read_by_athlete_at = now;
        if (viewerRole === 'coach' && item.sender_role === 'athlete' && !item.read_by_coach_at) item.read_by_coach_at = now;
      }
      saveDemo();
    }
    const unread = rows.filter(item => viewerRole === 'athlete' ? item.sender_role === 'coach' && !item.read_by_athlete_at : item.sender_role === 'athlete' && !item.read_by_coach_at).length;
    return { messages: await enrichMessagesWithWorkoutTitles(rows), unread };
  }
  if (markRead) {
    const readColumn = viewerRole === 'athlete' ? 'read_by_athlete_at' : 'read_by_coach_at';
    const oppositeRole = viewerRole === 'athlete' ? 'coach' : 'athlete';
    await prodRows('athlete_messages', `athlete_id=eq.${encodeURIComponent(athleteId)}&coach_user_id=eq.${encodeURIComponent(coachUserId)}&sender_role=eq.${oppositeRole}&${readColumn}=is.null`, { method: 'PATCH', body: { [readColumn]: new Date().toISOString() } });
  }
  const rows = await prodRows('athlete_messages', `athlete_id=eq.${encodeURIComponent(athleteId)}&coach_user_id=eq.${encodeURIComponent(coachUserId)}&select=*&order=created_at.asc&limit=${safeLimit}`);
  const readColumn = viewerRole === 'athlete' ? 'read_by_athlete_at' : 'read_by_coach_at';
  const oppositeRole = viewerRole === 'athlete' ? 'coach' : 'athlete';
  const unread = rows.filter(item => item.sender_role === oppositeRole && !item[readColumn]).length;
  return { messages: await enrichMessagesWithWorkoutTitles(rows), unread };
}

async function createAthleteMessage({ athleteId, coachUserId, senderUserId, senderRole, workoutId, message }) {
  const row = {
    id: crypto.randomUUID(), athlete_id: athleteId, coach_user_id: coachUserId, sender_user_id: senderUserId,
    sender_role: senderRole, workout_id: sanitiseText(workoutId, 80) || null, message: sanitiseText(message, 2000),
    created_at: new Date().toISOString(),
    read_by_coach_at: senderRole === 'coach' ? new Date().toISOString() : null,
    read_by_athlete_at: senderRole === 'athlete' ? new Date().toISOString() : null,
  };
  if (!row.message) throw Object.assign(new Error('Escribe un mensaje antes de enviarlo.'), { status: 400 });
  if (DEMO_MODE) { demo.messages.push(row); saveDemo(); return row; }
  const rows = await prodRows('athlete_messages', '', { method: 'POST', body: row });
  return rows[0] || row;
}
function numberOrNull(value, min = -Infinity, max = Infinity) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}

function normaliseLoadToleranceProfile(value) {
  const source = safeObject(value);
  const profile = {
    habitual_min: numberOrNull(source.habitual_min, 0, 10000),
    habitual_max: numberOrNull(source.habitual_max, 0, 10000),
    development_min: numberOrNull(source.development_min, 0, 10000),
    development_max: numberOrNull(source.development_max, 0, 10000),
    high_min: numberOrNull(source.high_min, 0, 10000),
    high_max: numberOrNull(source.high_max, 0, 10000),
    provisional_ceiling: numberOrNull(source.provisional_ceiling, 0, 10000),
    confidence: ['provisional', 'observing', 'consolidated'].includes(source.confidence)
      ? source.confidence
      : 'provisional',
    notes: sanitiseText(source.notes, 3000),
    updated_at: new Date().toISOString(),
  };

  for (const [minKey, maxKey, label] of [
    ['habitual_min', 'habitual_max', 'habitual'],
    ['development_min', 'development_max', 'desarrollo'],
    ['high_min', 'high_max', 'alta'],
  ]) {
    if (profile[minKey] !== null && profile[maxKey] !== null && profile[maxKey] < profile[minKey]) {
      throw Object.assign(new Error(`El máximo del rango de carga ${label} no puede ser menor que el mínimo.`), { status: 400 });
    }
  }

  if (profile.provisional_ceiling !== null && profile.high_max !== null && profile.provisional_ceiling < profile.high_max) {
    throw Object.assign(new Error('El techo provisional no puede quedar por debajo del máximo de carga alta.'), { status: 400 });
  }

  return profile;
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
    ...(hasOwn(body, 'load_tolerance_profile') ? { load_tolerance_profile: normaliseLoadToleranceProfile(body.load_tolerance_profile) } : {}),
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

const TRAINING_DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function trainingDayNumber(dateValue) {
  const date = new Date(`${dateValue}T12:00:00Z`);
  return ((date.getUTCDay() + 6) % 7) + 1;
}

function workoutAvailabilityKind(workout) {
  const text = `${workout && workout.sport || ''} ${workout && workout.title || ''} ${workout && workout.adaptation_target || ''}`.toLowerCase();
  if (workout && workout.is_strength || /strength|fuerza|gimnasio/.test(text)) return 'strength';
  if (/ride|bike|cycling|bici/.test(text)) return 'bike';
  if (/trail|montaña|mountain|desnivel/.test(text)) return 'trail';
  return 'run';
}

function availabilityMode(day) {
  const explicit = sanitiseText(day && (day.activity_type || day.mode), 30);
  if (['unavailable', 'run', 'trail', 'bike', 'strength', 'gym', 'flexible'].includes(explicit)) return explicit;
  if (day && day.can_train === false) return 'unavailable';
  if (day && day.gym && day.strength && day.run === false) return 'gym';
  if (day && day.strength && day.run === false && day.bike !== true) return 'strength';
  if (day && day.bike && day.run === false && day.strength !== true) return 'bike';
  if (day && day.run && day.mountain) return 'trail';
  if (day && day.run && day.bike !== true && day.strength !== true) return 'run';
  return 'flexible';
}

function workoutAvailabilityError(availability, workout) {
  const config = safeObject(availability);
  const days = Array.isArray(config.days) ? config.days : [];
  const configured = config.configured === true || days.some(day => day && (day.activity_type || day.mode || hasOwn(day, 'can_train')));
  if (!configured || !validDate(workout && workout.workout_date)) return null;
  const dayNumber = trainingDayNumber(workout.workout_date);
  const day = days.find(item => Number(item && item.day) === dayNumber);
  const dayName = TRAINING_DAY_NAMES[dayNumber - 1];
  if (!day) return `La disponibilidad del ${dayName} no está definida en la ficha del deportista.`;
  const mode = availabilityMode(day);
  const title = sanitiseText(workout.title || 'Sesión', 160);
  if (mode === 'unavailable' || day.can_train === false) return `No puedes colocar “${title}” el ${dayName}: el deportista no puede entrenar ese día.`;
  const kind = workoutAvailabilityKind(workout);
  const allowed = mode === 'flexible'
    ? (kind === 'strength' ? day.strength !== false : kind === 'bike' ? day.bike === true : day.run !== false)
    : mode === 'run' ? kind === 'run'
      : mode === 'trail' ? kind === 'trail'
        : mode === 'bike' ? kind === 'bike'
          : (mode === 'strength' || mode === 'gym') ? kind === 'strength'
            : false;
  if (!allowed) {
    const labels = { run: 'correr', trail: 'trail/montaña', bike: 'bici', strength: 'fuerza', gym: 'gimnasio', flexible: 'actividad flexible' };
    return `No puedes colocar “${title}” el ${dayName}: ese día está reservado para ${labels[mode] || 'otra actividad'}.`;
  }
  const duration = numberOrNull(workout.planned_duration_min, 0, 2000);
  const maximum = numberOrNull(day.max_minutes, 0, 2000);
  if (duration !== null && maximum !== null && duration > maximum) {
    return `“${title}” dura ${duration} min, pero el ${dayName} solo dispone de ${maximum} min.`;
  }
  return null;
}

async function athleteTrainingAvailability(athleteId) {
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    return safeObject(athlete && athlete.profile && athlete.profile.availability);
  }
  const rows = await prodRows('athlete_profiles', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=availability&limit=1`);
  return safeObject(rows[0] && rows[0].availability);
}

async function assertWorkoutsFitAvailability(athleteId, workouts) {
  if (!Array.isArray(workouts) || !workouts.length) return;
  const availability = await athleteTrainingAvailability(athleteId);
  const errors = workouts.map(workout => workoutAvailabilityError(availability, workout)).filter(Boolean);
  if (errors.length) throw Object.assign(new Error(errors.slice(0, 3).join(' ')), { status: 409, code: 'ATHLETE_AVAILABILITY_CONFLICT' });
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

async function listCalendarWeeks(athleteId, oldest, newest, sync = false) {
  const rangeStart = validDate(oldest) || addDays(startOfWeek(), -35);
  const rangeEnd = validDate(newest) || addDays(startOfWeek(), 42);

  if (sync && !DEMO_MODE) await syncActivities(athleteId, rangeStart, rangeEnd);

  let weeks = [];
  let workouts = [];
  let activities = [];
  let manualLogs = [];

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    const candidates = [];
    if (athlete.week) candidates.push(athlete.week);
    if (Array.isArray(athlete.microcycles)) candidates.push(...athlete.microcycles);
    weeks = candidates
      .filter(item => rangesOverlap(item.week_start, item.end_date || addDays(item.week_start, 6), rangeStart, rangeEnd))
      .map(item => JSON.parse(JSON.stringify(item)))
      .sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)));
    workouts = weeks.flatMap(week => (week.workouts || []).map(workout => ({ ...workout, training_week_id: week.id })));
    activities = (demo.activities || []).filter(item => item.athlete_id === athleteId && String(item.activity_date).slice(0, 10) >= rangeStart && String(item.activity_date).slice(0, 10) <= rangeEnd);
    manualLogs = (demo.manual_logs || []).filter(item => item.athlete_id === athleteId);
  } else {
    weeks = await prodRows(
      'training_weeks',
      `athlete_id=eq.${encodeURIComponent(athleteId)}&week_start=gte.${rangeStart}&week_start=lte.${rangeEnd}&select=*&order=week_start.asc`
    );
    const ids = weeks.map(item => item.id);
    workouts = ids.length
      ? await prodRows('workouts', `training_week_id=in.(${ids.join(',')})&select=*&order=workout_date.asc`)
      : [];
    activities = await listStoredActivities(athleteId, rangeStart, rangeEnd);
    const workoutIds = workouts.map(item => item.id);
    manualLogs = workoutIds.length
      ? await prodRows('manual_session_logs', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=in.(${workoutIds.join(',')})&select=*`)
      : [];
  }

  const knownWeekStarts = new Set(weeks.map(item => item.week_start));
  for (const activity of activities) {
    const date = String(activity.activity_date || '').slice(0, 10);
    if (!validDate(date)) continue;
    const activityWeekStart = startOfWeek(new Date(`${date}T12:00:00Z`));
    if (activityWeekStart < rangeStart || activityWeekStart > rangeEnd || knownWeekStarts.has(activityWeekStart)) continue;
    weeks.push({
      id: null,
      athlete_id: athleteId,
      week_start: activityWeekStart,
      end_date: addDays(activityWeekStart, 6),
      week_type: 'Sin planificación',
      title: '',
      coach_comment: '',
      target_load: 0,
      status: 'draft',
      lifecycle_status: 'planned',
    });
    knownWeekStarts.add(activityWeekStart);
  }
  weeks.sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)));

  activities = await autoLinkActivitiesToWorkouts(athleteId, workouts, activities);
  return decorateCalendarWeeks(weeks, workouts, activities, manualLogs);
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
  const optionalRows = async (label, promise) => {
    try { return await promise; }
    catch (error) {
      console.error(`[athlete-dashboard] ${label}: ${error.message}`);
      return [];
    }
  };
  const [profiles, zones, goals, weeks, metrics, performance] = await Promise.all([
    optionalRows('perfil', prodRows('athlete_profiles', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`)),
    optionalRows('zonas', prodRows('training_zones', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&order=kind.asc,zone_order.asc`)),
    optionalRows('objetivos', prodRows('goals', `athlete_id=eq.${encodeURIComponent(athleteId)}&status=eq.active&select=*&order=goal_date.asc`)),
    optionalRows('semana', prodRows('training_weeks', `athlete_id=eq.${encodeURIComponent(athleteId)}&week_start=eq.${weekStart}&select=*&limit=1`)),
    optionalRows('metricas', prodRows('daily_metrics', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&order=metric_date.desc&limit=1`)),
    optionalRows('rendimiento', prodRows('performance_snapshots', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&order=snapshot_date.desc&limit=1`)),
  ]);
  const week = weeks[0] || { week_start: weekStart, week_type: '', title: '', coach_comment: '', target_load: 0, status: 'draft' };
  const workouts = week.id ? await optionalRows('sesiones', prodRows('workouts', `training_week_id=eq.${encodeURIComponent(week.id)}&select=*&order=workout_date.asc`)) : [];
  return {
    ...athleteRows[0],
    app_access_status: athleteRows[0].user_id ? 'active' : 'pending',
    profile: profiles[0] || {},
    zones: { hr: zones.filter(item => item.kind === 'hr'), pace: zones.filter(item => item.kind === 'pace') },
    goals,
    metrics: metrics[0] || { fitness: 0, fatigue: 0, form: 0, week_load: 0, planned_load: week.target_load || 0, readiness_score: 50, readiness_label: 'Sin datos suficientes' },
    performance: performance[0] || null,
    week: { ...week, workouts },
  };
}

async function listCoachAthletes(session, options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const detailed = Boolean(options.detailed);
  if (DEMO_MODE) {
    const ids = demo.coach_athletes.filter(item => item.coach_user_id === session.user.id).map(item => item.athlete_id);
    let rows = demo.athletes.filter(item => ids.includes(item.id)).map(item => ({
      id: item.id, display_name: item.display_name, email: item.email, intervals_status: item.intervals_status,
      user_id: item.user_id || null, app_access_status: item.user_id ? 'active' : 'pending',
      lifecycle_status: item.lifecycle_status || 'active', archived_at: item.archived_at || null,
      created_at: item.created_at || null, updated_at: item.updated_at || null,
    }));
    if (!includeInactive) rows = rows.filter(item => item.lifecycle_status !== 'inactive');
    if (detailed) rows = rows.map(item => {
      const athlete = demo.athletes.find(row => row.id === item.id) || {};
      const activities = (demo.activities || []).filter(row => row.athlete_id === item.id).sort((a,b) => String(b.activity_date).localeCompare(String(a.activity_date)));
      const goals = (athlete.goals || []).filter(goal => goal.status === 'active').sort((a,b) => String(a.goal_date).localeCompare(String(b.goal_date)));
      return { ...item, last_activity_date: activities[0]?.activity_date || null, active_goal_count: goals.length, next_goal: goals[0] ? { name: goals[0].name, goal_date: goals[0].goal_date } : null };
    });
    return rows.sort((a, b) => a.display_name.localeCompare(b.display_name, 'es'));
  }
  const joins = await prodRows('coach_athletes', `coach_user_id=eq.${encodeURIComponent(session.user.id)}&select=athlete_id`);
  const ids = joins.map(item => item.athlete_id);
  if (!ids.length) return [];
  let query = `id=in.(${ids.join(',')})&select=id,user_id,display_name,email,intervals_status,lifecycle_status,archived_at,created_at,updated_at&order=display_name.asc`;
  if (!includeInactive) query = `id=in.(${ids.join(',')})&lifecycle_status=eq.active&select=id,user_id,display_name,email,intervals_status,lifecycle_status,archived_at,created_at,updated_at&order=display_name.asc`;
  const rows = await prodRows('athletes', query);
  let result = rows.map(item => ({ ...item, lifecycle_status: item.lifecycle_status || 'active', app_access_status: item.user_id && item.lifecycle_status !== 'inactive' ? 'active' : item.user_id ? 'suspended' : 'pending' }));
  if (!detailed || !result.length) return result;
  const detailedRows = [];
  for (const item of result) {
    const [activityRows, goalRows] = await Promise.all([
      prodRows('activities', `athlete_id=eq.${encodeURIComponent(item.id)}&select=activity_date&order=activity_date.desc&limit=1`).catch(() => []),
      prodRows('goals', `athlete_id=eq.${encodeURIComponent(item.id)}&status=eq.active&select=name,goal_date,priority_code,priority&order=goal_date.asc`).catch(() => []),
    ]);
    detailedRows.push({
      ...item,
      last_activity_date: activityRows[0]?.activity_date || null,
      active_goal_count: goalRows.length,
      next_goal: goalRows[0] ? { name: goalRows[0].name, goal_date: goalRows[0].goal_date, priority_code: goalRows[0].priority_code || null, priority: goalRows[0].priority || null } : null,
    });
  }
  return detailedRows;
}

async function setAthleteLifecycle(session, athleteId, status) {
  await ensureCoachAccess(session, athleteId);
  const lifecycleStatus = status === 'inactive' ? 'inactive' : status === 'active' ? 'active' : null;
  if (!lifecycleStatus) throw Object.assign(new Error('Estado de deportista no válido.'), { status: 400 });
  const now = new Date().toISOString();
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    athlete.lifecycle_status = lifecycleStatus;
    athlete.archived_at = lifecycleStatus === 'inactive' ? now : null;
    athlete.updated_at = now;
    saveDemo();
    return { id: athlete.id, lifecycle_status: lifecycleStatus, archived_at: athlete.archived_at };
  }
  const rows = await prodRows('athletes', `id=eq.${encodeURIComponent(athleteId)}`, {
    method: 'PATCH',
    body: { lifecycle_status: lifecycleStatus, archived_at: lifecycleStatus === 'inactive' ? now : null, updated_at: now },
  });
  if (!rows.length) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
  return rows[0];
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

function athleteAccessEmail(value) {
  const email = sanitiseText(value, 200).toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    throw Object.assign(new Error('Introduce un correo de acceso Athlete válido.'), { status: 400 });
  }
  return email;
}

async function ensureAthleteEmailAvailable(athleteId, email) {
  if (DEMO_MODE) {
    if (demo.athletes.some(item => item.id !== athleteId && String(item.email || '').toLowerCase() === email)) {
      throw Object.assign(new Error('Ese correo ya pertenece a otro deportista.'), { status: 409 });
    }
    return;
  }
  const rows = await prodRows('athletes', `email=eq.${encodeURIComponent(email)}&select=id`);
  if (rows.some(item => item.id !== athleteId)) {
    throw Object.assign(new Error('Ese correo ya pertenece a otro deportista.'), { status: 409 });
  }
}

async function synchroniseAthleteAccessEmail(athlete, email) {
  const previous = String(athlete && athlete.email || '').toLowerCase();
  if (!athlete || previous === email) return;
  await ensureAthleteEmailAvailable(athlete.id, email);
  if (DEMO_MODE) {
    if (athlete.user_id) {
      const user = demo.users.find(item => item.id === athlete.user_id);
      if (user) {
        const conflict = demo.users.find(item => item.id !== user.id && String(item.email || '').toLowerCase() === email);
        if (conflict) throw Object.assign(new Error('Ese correo ya está utilizado por otra cuenta.'), { status: 409 });
        user.email = email;
      }
    }
    athlete.email = email;
    return;
  }
  if (athlete.user_id) {
    const authUser = await findAuthUserByEmail(email);
    if (authUser && String(authUser.id) !== String(athlete.user_id)) {
      throw Object.assign(new Error('Ese correo ya está utilizado por otra cuenta de acceso.'), { status: 409 });
    }
    await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(athlete.user_id)}`, {
      method: 'PUT',
      body: JSON.stringify({ email, email_confirm: true }),
    });
    await prodRows('profiles', `id=eq.${encodeURIComponent(athlete.user_id)}`, {
      method: 'PATCH',
      body: { email, updated_at: new Date().toISOString() },
      prefer: 'return=minimal',
    }).catch(() => []);
  }
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
  const email = athleteAccessEmail(body.email);
  if (!displayName) throw Object.assign(new Error('Introduce el nombre del deportista.'), { status: 400 });
  const intervalsStatus = ['pending', 'disabled'].includes(body.intervals_status) ? body.intervals_status : 'pending';
  if (DEMO_MODE) {
    if (demo.athletes.some(item => item.email.toLowerCase() === email)) throw Object.assign(new Error('Ya existe un deportista con ese correo.'), { status: 409 });
    const athleteId = `a-${crypto.randomUUID()}`;
    const athlete = {
      id: athleteId, user_id: null, display_name: displayName, email, intervals_status: intervalsStatus, lifecycle_status: 'active', archived_at: null,
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
  const created = await prodRows('athletes', '', { method: 'POST', body: { display_name: displayName, email, intervals_status: intervalsStatus, lifecycle_status: 'active' } });
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
  const incomingProfile = normaliseProfile(body);
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
    const email = hasOwn(body, 'email') ? athleteAccessEmail(body.email) : athlete.email;
    await synchroniseAthleteAccessEmail(athlete, email);
    const profile = {
      ...incomingProfile,
      availability: { ...safeObject(athlete.profile && athlete.profile.availability), ...safeObject(incomingProfile.availability) },
    };
    athlete.profile = { ...athlete.profile, ...profile };
    if (body.display_name) athlete.display_name = sanitiseText(body.display_name, 160);
    if (body.intervals_status) athlete.intervals_status = sanitiseText(body.intervals_status, 30);
    saveDemo();
    return demoAthleteBundle(athleteId);
  }
  const athleteRows = await prodRows('athletes', `id=eq.${encodeURIComponent(athleteId)}&select=id,user_id,email&limit=1`);
  const athlete = athleteRows[0];
  if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });
  const email = hasOwn(body, 'email') ? athleteAccessEmail(body.email) : athlete.email;
  await synchroniseAthleteAccessEmail(athlete, email);
  const existingProfiles = await prodRows('athlete_profiles', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=availability&limit=1`);
  const profile = {
    ...incomingProfile,
    availability: { ...safeObject(existingProfiles[0] && existingProfiles[0].availability), ...safeObject(incomingProfile.availability) },
  };
  if (body.display_name || body.email || body.intervals_status) {
    await prodRows('athletes', `id=eq.${encodeURIComponent(athleteId)}`, {
      method: 'PATCH',
      body: {
        ...(body.display_name ? { display_name: sanitiseText(body.display_name, 160) } : {}),
        ...(hasOwn(body, 'email') ? { email } : {}),
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


function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normaliseTemplateData(source) {
  const item = safeObject(source);
  return {
    sport: sanitiseText(item.sport || 'Run', 40),
    priority: ['A', 'B', 'C'].includes(item.priority) ? item.priority : 'B',
    planned_load: numberOrNull(item.planned_load, 0, 1000) ?? 0,
    planned_duration_min: numberOrNull(item.planned_duration_min, 0, 2000),
    planned_distance_km: numberOrNull(item.planned_distance_km, 0, 2000),
    planned_elevation_m: numberOrNull(item.planned_elevation_m, 0, 100000),
    is_strength: Boolean(item.is_strength || String(item.sport || '').toLowerCase() === 'strength'),
    title: sanitiseText(item.title || 'Sesión', 160),
    session_objective: sanitiseText(item.session_objective, 3000),
    adaptation_target: sanitiseText(item.adaptation_target, 1000),
    purpose: sanitiseText(item.purpose, 3000),
    summary: sanitiseText(item.summary, 3000),
    structured_description: sanitiseText(item.structured_description || item.summary, 10000),
    blocks: Array.isArray(item.blocks) ? cloneJson(item.blocks.slice(0, 30)) : [],
  };
}

async function listWorkoutTemplates(session, athleteId = null) {
  const system = SYSTEM_WORKOUT_TEMPLATES.map(item => ({ ...cloneJson(item), editable: false }));
  if (DEMO_MODE) {
    if (!Array.isArray(demo.workout_templates)) demo.workout_templates = [];
    const custom = demo.workout_templates
      .filter(item => item.coach_user_id === session.user.id && (!item.athlete_id || !athleteId || item.athlete_id === athleteId))
      .map(item => ({ ...cloneJson(item), source: 'custom', editable: true }));
    return [...custom, ...system];
  }
  const filters = [`coach_user_id=eq.${encodeURIComponent(session.user.id)}`];
  if (athleteId) filters.push(`or=(athlete_id.is.null,athlete_id.eq.${encodeURIComponent(athleteId)})`);
  const rows = await prodRows('workout_templates', `${filters.join('&')}&select=*&order=updated_at.desc`);
  return [
    ...rows.map(item => ({ ...item, source: 'custom', editable: true })),
    ...system,
  ];
}

async function createWorkoutTemplate(session, body) {
  const athleteId = sanitiseText(body && body.athlete_id, 80) || null;
  if (athleteId) await ensureCoachAccess(session, athleteId);
  const row = {
    id: crypto.randomUUID(),
    coach_user_id: session.user.id,
    athlete_id: athleteId,
    name: sanitiseText(body && body.name, 160),
    category: sanitiseText(body && body.category || 'Mi biblioteca', 80),
    sport: sanitiseText(body && body.sport || body && body.template_data && body.template_data.sport || 'Run', 40),
    stimulus: sanitiseText(body && body.stimulus || body && body.template_data && body.template_data.adaptation_target, 160),
    template_data: normaliseTemplateData(body && (body.template_data || body.workout || body)),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (!row.name) throw Object.assign(new Error('Pon un nombre a la plantilla.'), { status: 400 });
  if (DEMO_MODE) {
    if (!Array.isArray(demo.workout_templates)) demo.workout_templates = [];
    demo.workout_templates.unshift(row); saveDemo();
    return { ...row, source: 'custom', editable: true };
  }
  const rows = await prodRows('workout_templates', '', { method: 'POST', body: row });
  return { ...rows[0], source: 'custom', editable: true };
}

async function deleteWorkoutTemplate(session, templateId) {
  if (DEMO_MODE) {
    if (!Array.isArray(demo.workout_templates)) demo.workout_templates = [];
    const before = demo.workout_templates.length;
    demo.workout_templates = demo.workout_templates.filter(item => !(item.id === templateId && item.coach_user_id === session.user.id));
    if (demo.workout_templates.length === before) throw Object.assign(new Error('Plantilla no encontrada.'), { status: 404 });
    saveDemo(); return;
  }
  await prodRows('workout_templates', `id=eq.${encodeURIComponent(templateId)}&coach_user_id=eq.${encodeURIComponent(session.user.id)}`, { method: 'DELETE', prefer: 'return=minimal' });
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
  await assertWorkoutsFitAvailability(athleteId, week.workouts);
  if (publish) {
    week.status = 'published';
    week.published_at = new Date().toISOString();
  }

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    if (!athlete) throw Object.assign(new Error('Deportista no encontrado.'), { status: 404 });

    if (!Array.isArray(athlete.microcycles)) athlete.microcycles = [];
    const microcycleIndex = athlete.microcycles.findIndex(item => item.week_start === week.week_start);
    const previous = microcycleIndex >= 0 ? athlete.microcycles[microcycleIndex] : (athlete.week || {});
    const previousWorkouts = new Map((previous.workouts || []).map(item => [String(item.id), item]));
    const mergedWorkouts = week.workouts.map(item => ({
      ...(previousWorkouts.get(String(item.id)) || {}),
      ...item,
    }));
    const savedWeek = {
      ...previous,
      ...week,
      id: previous.id || crypto.randomUUID(),
      end_date: week.end_date || previous.end_date || addDays(week.week_start, 6),
      workouts: mergedWorkouts,
    };
    if (microcycleIndex >= 0) athlete.microcycles[microcycleIndex] = savedWeek;
    else athlete.week = savedWeek;
    if (athlete.metrics) athlete.metrics.planned_load = week.target_load;
    saveDemo();
    return savedWeek;
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

async function ensureMesocycleDatesAvailable(athleteId, macrocycle, mesocycle, excludeId = null) {
  let candidates = [];
  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const seasonMacroIds = new Set((athlete?.macrocycles || [])
      .filter(item => macrocycle.season_id ? item.season_id === macrocycle.season_id : item.id === macrocycle.id)
      .map(item => item.id));
    candidates = (athlete?.mesocycles || []).filter(item => seasonMacroIds.has(item.macrocycle_id));
  } else {
    const macroRows = macrocycle.season_id
      ? await prodRows('macrocycles', `athlete_id=eq.${encodeURIComponent(athleteId)}&season_id=eq.${encodeURIComponent(macrocycle.season_id)}&select=id`)
      : [{ id: macrocycle.id }];
    const macroIds = new Set(macroRows.map(item => item.id));
    candidates = await prodRows('mesocycles', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=id,name,start_date,end_date,macrocycle_id`);
    candidates = candidates.filter(item => macroIds.has(item.macrocycle_id));
  }
  const conflict = candidates.find(item => item.id !== excludeId && mesocycle.start_date <= item.end_date && mesocycle.end_date >= item.start_date);
  if (conflict) {
    throw Object.assign(new Error(`Las fechas se solapan con el mesociclo “${conflict.name || 'sin nombre'}” (${conflict.start_date} – ${conflict.end_date}).`), { status: 409 });
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
  await ensureMesocycleDatesAvailable(athleteId, macrocycle, data);

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
  await ensureMesocycleDatesAvailable(athleteId, macrocycle, data, mesocycleId);
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
    progress: cycleProgress({
      hours: Number(row.planned_hours || 0),
      distance_km: Number(row.planned_distance_km || 0),
      elevation_m: Number(row.planned_elevation_m || 0),
      load: Number(row.target_load || 0),
      strength_sessions: Number(row.planned_strength_sessions || 0),
    }, actualMetrics, row.week_start, row.end_date || addDays(row.week_start, 6), workouts),
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
    week_type: sanitiseText(
      (hasOwn(body || {}, 'week_type') ? body.week_type : '') || microcycleTypeLabel(type) || source.week_type || source.name || 'Planificación',
      80
    ),
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
  await assertWorkoutsFitAvailability(athleteId, workouts);

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
  const incomingWorkouts = Array.isArray(body && body.workouts)
    ? body.workouts.map((item, index) => normaliseWorkout(item, athleteId, data.week_start, index))
    : null;
  if (incomingWorkouts) await assertWorkoutsFitAvailability(athleteId, incomingWorkouts);

  if (DEMO_MODE) {
    const athlete = demo.athletes.find(item => item.id === athleteId);
    const candidates = [];
    if (athlete.week) candidates.push({ kind: 'week', item: athlete.week });
    if (Array.isArray(athlete.microcycles)) athlete.microcycles.forEach(item => candidates.push({ kind: 'array', item }));
    const found = candidates.find(entry => entry.item.id === microcycleId);
    const currentWorkouts = found.item.workouts || [];
    const workouts = incomingWorkouts || currentWorkouts;
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
  if (incomingWorkouts) {
    workouts = await persistWeekWorkouts(saved, athleteId, incomingWorkouts, saved.status);
  } else {
    workouts = await prodRows('workouts', `training_week_id=eq.${encodeURIComponent(saved.id)}&select=*&order=workout_date.asc`);
  }
  return microcycleFromRow(saved, workouts);
}

function microcycleTypeLabel(type) {
  return ({
    adaptation: 'Adaptación',
    load: 'Carga',
    development: 'Construcción',
    overload: 'Sobrecarga',
    deload: 'Descarga',
    taper: 'Afinamiento',
    recovery: 'Recuperación',
    competition: 'Competición',
  })[String(type || '').toLowerCase()] || '';
}

function matchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleSimilarity(a, b) {
  const stop = new Set(['run', 'running', 'trail', 'ride', 'strength', 'fuerza', 'sesion', 'entrenamiento', 'actividad']);
  const aa = new Set(matchText(a).split(/\s+/).filter(token => token.length > 2 && !stop.has(token)));
  const bb = new Set(matchText(b).split(/\s+/).filter(token => token.length > 2 && !stop.has(token)));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  aa.forEach(token => { if (bb.has(token)) intersection += 1; });
  return intersection / new Set([...aa, ...bb]).size;
}

async function autoLinkActivitiesToWorkouts(athleteId, workouts, activities) {
  const rows = (activities || []).map(item => ({ ...item }));
  const alreadyUsed = new Set(rows.filter(item => item.workout_id).map(item => String(item.workout_id)));
  const byDateSport = new Map();
  for (const workout of workouts || []) {
    const key = `${workout.workout_date}|${sportKey(workout.sport)}`;
    if (!byDateSport.has(key)) byDateSport.set(key, []);
    byDateSport.get(key).push(workout);
  }

  const updates = [];
  for (const activity of rows) {
    if (activity.workout_id) continue;
    const date = String(activity.activity_date || '').slice(0, 10);
    const key = `${date}|${sportKey(activity.sport)}`;
    let candidates = (byDateSport.get(key) || []).filter(workout => !alreadyUsed.has(String(workout.id)));
    if (!candidates.length) continue;

    let target = null;
    if (candidates.length === 1) {
      target = candidates[0];
    } else {
      const ranked = candidates
        .map(workout => ({ workout, score: titleSimilarity(activity.name, workout.title) }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0] && ranked[0].score >= 0.34 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.12)) target = ranked[0].workout;
    }
    if (!target) continue;

    activity.workout_id = target.id;
    alreadyUsed.add(String(target.id));
    updates.push({ activity, target });
  }

  if (!updates.length) return rows;
  if (DEMO_MODE) {
    for (const { activity, target } of updates) {
      const original = (demo.activities || []).find(item => String(item.id) === String(activity.id) || item.intervals_activity_id === activity.intervals_activity_id);
      if (original) original.workout_id = target.id;
    }
    saveDemo();
    return rows;
  }

  await Promise.all(updates.map(({ activity, target }) => prodRows(
    'activities',
    `id=eq.${encodeURIComponent(activity.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
    { method: 'PATCH', body: { workout_id: target.id }, prefer: 'return=minimal' }
  )));
  return rows;
}

function aggregateActivityMetrics(rows) {
  const activities = rows || [];
  return {
    activity_count: activities.length,
    load: roundOrNull(activities.reduce((sum, item) => sum + Number(item.load || 0), 0), 1) || 0,
    duration_min: roundOrNull(activities.reduce((sum, item) => sum + Number(item.duration_sec || 0), 0) / 60, 1) || 0,
    distance_km: roundOrNull(activities.reduce((sum, item) => sum + Number(item.distance_m || 0), 0) / 1000, 2) || 0,
    elevation_m: roundOrNull(activities.reduce((sum, item) => sum + Number(item.elevation_gain_m || 0), 0), 1) || 0,
  };
}

function decorateCalendarWeeks(weeks, workouts, activities, manualLogs) {
  const workoutsByWeek = new Map();
  for (const workout of workouts || []) {
    if (!workoutsByWeek.has(workout.training_week_id)) workoutsByWeek.set(workout.training_week_id, []);
    workoutsByWeek.get(workout.training_week_id).push(workout);
  }
  const activitiesByWorkout = new Map();
  for (const activity of activities || []) {
    if (!activity.workout_id) continue;
    if (!activitiesByWorkout.has(String(activity.workout_id))) activitiesByWorkout.set(String(activity.workout_id), []);
    activitiesByWorkout.get(String(activity.workout_id)).push(activity);
  }
  const logsByWorkout = new Map();
  for (const log of manualLogs || []) {
    if (!log.workout_id) continue;
    if (!logsByWorkout.has(String(log.workout_id))) logsByWorkout.set(String(log.workout_id), []);
    logsByWorkout.get(String(log.workout_id)).push(log);
  }
  const weekIds = new Set((weeks || []).map(item => String(item.id)));
  const workoutIds = new Set((workouts || []).filter(item => weekIds.has(String(item.training_week_id))).map(item => String(item.id)));

  return (weeks || []).map(week => {
    const rawWorkouts = workoutsByWeek.get(week.id) || week.workouts || [];
    const decoratedWorkouts = rawWorkouts.map(workout => {
      const linked = activitiesByWorkout.get(String(workout.id)) || [];
      const logs = (logsByWorkout.get(String(workout.id)) || []).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const log = logs[0] || null;
      let execution_status = 'planned';
      if (linked.length) execution_status = log && log.status === 'partial' ? 'partial' : 'completed';
      else if (log && ['completed', 'partial', 'skipped'].includes(log.status)) execution_status = log.status;
      const actual = linked.length ? aggregateActivityMetrics(linked) : {
        activity_count: 0,
        load: null,
        duration_min: log && ['completed', 'partial'].includes(log.status) ? Number(log.actual_duration_min || 0) : null,
        distance_km: null,
        elevation_m: null,
      };
      return {
        ...workout,
        execution_status,
        actual,
        manual_log: log ? { status: log.status, actual_duration_min: log.actual_duration_min, rpe: log.rpe, feeling: log.feeling || null, pain: log.pain, pain_area: log.pain_area || null, comment: log.comment, created_at: log.created_at } : null,
        activities: linked.map(publicActivitySummary),
      };
    });

    const start = week.week_start;
    const end = week.end_date || addDays(start, 6);
    const weekActivities = (activities || []).filter(item => {
      const date = String(item.activity_date || '').slice(0, 10);
      return date >= start && date <= end;
    });
    const unplanned = weekActivities.filter(item => !item.workout_id || !workoutIds.has(String(item.workout_id))).map(publicActivitySummary);
    const execution = calculateExecutionMetrics(rawWorkouts, weekActivities, manualLogs || []);
    const generated = rawWorkouts.reduce((sum, item) => sum + Number(item.planned_load || 0), 0);
    return {
      ...week,
      week_type: microcycleTypeLabel(week.microcycle_type) || week.week_type || '',
      workouts: decoratedWorkouts,
      unplanned_activities: unplanned,
      execution: {
        ...execution,
        planned_load: roundOrNull(generated, 1) || 0,
        target_load: Number(week.target_load || 0),
        load_adherence_pct: generated > 0 ? roundOrNull((Number(execution.linked_load || 0) / generated) * 100, 1) : null,
        target_load_pct: Number(week.target_load || 0) > 0 ? roundOrNull((Number(execution.load || 0) / Number(week.target_load)) * 100, 1) : null,
      },
    };
  });
}

function sportKey(value) {
  const sport = String(value || '').toLowerCase();
  if (sport.includes('strength') || sport.includes('fuerza')) return 'strength';
  if (sport.includes('ride') || sport.includes('cycle') || sport.includes('bike') || sport.includes('cicl')) return 'ride';
  if (sport.includes('run') || sport.includes('trail') || sport.includes('correr')) return 'run';
  return sport;
}

function calculateExecutionMetrics(workouts, activities, manualLogs) {
  const workoutIds = new Set((workouts || []).map(item => String(item.id)));
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
  for (const workout of workouts || []) {
    const key = `${workout.workout_date}|${sportKey(workout.sport)}`;
    if (!workoutsByDateSport.has(key)) workoutsByDateSport.set(key, []);
    workoutsByDateSport.get(key).push(workout);
  }

  const fallbackActivityIds = new Set();
  const completedWorkoutIds = new Set();
  for (const workout of workouts || []) {
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
  const relevantIds = new Set(relevantActivities.map(item => String(item.id || item.intervals_activity_id)));
  const extraActivities = (activities || []).filter(item => !relevantIds.has(String(item.id || item.intervals_activity_id)));
  const allActivities = [...relevantActivities, ...extraActivities];

  const linkedActivityWorkoutIds = new Set(relevantActivities.filter(item => item.workout_id).map(item => String(item.workout_id)));
  let manualDurationMin = 0;
  for (const [workoutId, logs] of logsByWorkout.entries()) {
    if (linkedActivityWorkoutIds.has(workoutId)) continue;
    const completed = logs.find(log => ['completed', 'partial'].includes(log.status));
    if (completed) manualDurationMin += Number(completed.actual_duration_min || 0);
  }

  const strengthWorkoutIds = new Set(
    (workouts || []).filter(item => item.is_strength || sportKey(item.sport) === 'strength').map(item => String(item.id))
  );
  const completedStrength = [...completedWorkoutIds].filter(id => strengthWorkoutIds.has(id)).length;
  const extraStrength = extraActivities.filter(item => sportKey(item.sport) === 'strength').length;
  const aWorkouts = (workouts || []).filter(item => item.priority === 'A');
  const completedA = aWorkouts.filter(item => completedWorkoutIds.has(String(item.id))).length;

  const linkedMetrics = aggregateActivityMetrics(relevantActivities);
  const extraMetrics = aggregateActivityMetrics(extraActivities);
  const totalMetrics = aggregateActivityMetrics(allActivities);

  return {
    hours: roundOrNull((totalMetrics.duration_min / 60) + (manualDurationMin / 60), 2) || 0,
    distance_km: totalMetrics.distance_km,
    elevation_m: totalMetrics.elevation_m,
    load: totalMetrics.load,
    linked_load: linkedMetrics.load,
    extra_load: extraMetrics.load,
    extra_sessions: extraActivities.length,
    strength_sessions: completedStrength + extraStrength,
    completion_rate: (workouts || []).length ? roundOrNull((completedWorkoutIds.size / workouts.length) * 100, 1) : 0,
    completed_sessions: completedWorkoutIds.size,
    planned_sessions: (workouts || []).length,
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

function clampPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 10) / 10) : null;
}

function dateElapsedRatio(startDate, endDate, today = new Date().toISOString().slice(0, 10)) {
  if (!startDate || !endDate) return 0;
  if (today < startDate) return 0;
  if (today >= endDate) return 1;
  const start = new Date(`${startDate}T12:00:00Z`).getTime();
  const end = new Date(`${endDate}T12:00:00Z`).getTime();
  const now = new Date(`${today}T12:00:00Z`).getTime();
  return Math.max(0, Math.min(1, (now - start + 86400000) / (end - start + 86400000)));
}

function workoutPlannedToDate(workouts, today) {
  const due = (workouts || []).filter(item => item.workout_date && item.workout_date <= today);
  return {
    hours: due.reduce((sum, item) => sum + Number(item.planned_duration_min || 0), 0) / 60,
    distance_km: due.reduce((sum, item) => sum + Number(item.planned_distance_km || 0), 0),
    elevation_m: due.reduce((sum, item) => sum + Number(item.planned_elevation_m || 0), 0),
    load: due.reduce((sum, item) => sum + Number(item.planned_load || 0), 0),
    strength_sessions: due.filter(item => item.is_strength || sportKey(item.sport) === 'strength').length,
  };
}

function cycleProgress(planned, actual, startDate, endDate, workouts = []) {
  const today = new Date().toISOString().slice(0, 10);
  const ratio = dateElapsedRatio(startDate, endDate, today);
  const workoutDue = workoutPlannedToDate(workouts, today);
  const workoutTotals = workoutPlannedToDate(workouts, '9999-12-31');
  const keys = ['hours', 'distance_km', 'elevation_m', 'load', 'strength_sessions'];
  const plannedToDate = {};
  for (const key of keys) {
    const total = Number(planned && planned[key] || 0);
    const workoutTotal = Number(workoutTotals[key] || 0);
    plannedToDate[key] = workoutTotal > 0 ? Number(workoutDue[key] || 0) : total * ratio;
    plannedToDate[key] = roundOrNull(plannedToDate[key], key === 'elevation_m' || key === 'strength_sessions' ? 0 : 2) || 0;
  }
  const adherence = {};
  for (const key of keys) {
    const due = Number(plannedToDate[key] || 0);
    adherence[`${key}_pct`] = due > 0 ? clampPct((Number(actual && actual[key] || 0) / due) * 100) : null;
  }
  const loadPct = adherence.load_pct;
  const status = ratio === 0 ? 'not_started' : loadPct == null ? 'no_target' : loadPct < 85 ? 'behind' : loadPct > 115 ? 'above' : 'on_track';
  return {
    as_of: today,
    elapsed_pct: clampPct(ratio * 100),
    planned_to_date: plannedToDate,
    adherence,
    status,
    completion_rate: actual && actual.completion_rate != null ? actual.completion_rate : null,
    a_sessions_completion_pct: actual && actual.a_sessions_completion_pct != null ? actual.a_sessions_completion_pct : null,
    extra_load: Number(actual && actual.extra_load || 0),
    extra_sessions: Number(actual && actual.extra_sessions || 0),
  };
}

function mesocycleApi(row, microcycles, actual) {
  const planned = {
    hours: Number(row.planned_hours || 0),
    distance_km: Number(row.planned_distance_km || 0),
    elevation_m: Number(row.planned_elevation_m || 0),
    load: Number(row.planned_load || 0),
    strength_sessions: Number(row.planned_strength_sessions || 0),
    intensity_distribution: safeObject(row.planned_intensity_distribution),
  };
  const actualMetrics = {
    ...(actual || {
      hours: Number(row.actual_hours || 0),
      distance_km: Number(row.actual_distance_km || 0),
      elevation_m: Number(row.actual_elevation_m || 0),
      load: Number(row.actual_load || 0),
      strength_sessions: Number(row.actual_strength_sessions || 0),
    }),
    intensity_distribution: safeObject(row.actual_intensity_distribution),
  };
  const workouts = (microcycles || []).flatMap(item => item.workouts || []);
  return {
    id: row.id,
    macrocycle_id: row.macrocycle_id,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    duration_weeks: row.duration_weeks,
    primary_adaptation: row.primary_adaptation,
    secondary_adaptations: Array.isArray(row.secondary_adaptations) ? row.secondary_adaptations : [],
    planned,
    actual: actualMetrics,
    progress: cycleProgress(planned, actualMetrics, row.start_date, row.end_date, workouts),
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
if (!Array.isArray(demo.messages)) demo.messages = [];
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
if (!Array.isArray(demo.messages)) demo.messages = [];
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
if (!Array.isArray(demo.messages)) demo.messages = [];
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

  const macrocycles = [];
  for (const row of macroRows) {
    const mesocycles = (mesoApiByMacro.get(row.id) || []).map(meso => ({
      ...meso,
      evaluation: latestEvaluation(meso.id),
      microcycles: (meso.microcycles || []).map(micro => ({ ...micro, evaluation: latestEvaluation(micro.id) })),
    }));
    const workouts = mesocycles.flatMap(meso => (meso.microcycles || []).flatMap(micro => micro.workouts || []));
    const planned = mesocycles.reduce((acc, meso) => {
      acc.hours += Number(meso.planned?.hours || 0);
      acc.distance_km += Number(meso.planned?.distance_km || 0);
      acc.elevation_m += Number(meso.planned?.elevation_m || 0);
      acc.load += Number(meso.planned?.load || 0);
      acc.strength_sessions += Number(meso.planned?.strength_sessions || 0);
      return acc;
    }, { hours: 0, distance_km: 0, elevation_m: 0, load: 0, strength_sessions: 0 });
    const actual = await loadExecutionForRange(athleteId, row.start_date, row.end_date, workouts);
    macrocycles.push({
      ...row,
      planned,
      actual,
      progress: cycleProgress(planned, actual, row.start_date, row.end_date, workouts),
      mesocycles,
      evaluation: latestEvaluation(row.id),
    });
  }

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

  const seasonPlanned = macrocycles.reduce((acc, macro) => {
    acc.hours += Number(macro.planned?.hours || 0);
    acc.distance_km += Number(macro.planned?.distance_km || 0);
    acc.elevation_m += Number(macro.planned?.elevation_m || 0);
    acc.load += Number(macro.planned?.load || 0);
    acc.strength_sessions += Number(macro.planned?.strength_sessions || 0);
    return acc;
  }, { hours: 0, distance_km: 0, elevation_m: 0, load: 0, strength_sessions: 0 });
  const seasonWorkouts = macrocycles.flatMap(macro => (macro.mesocycles || []).flatMap(meso => (meso.microcycles || []).flatMap(micro => micro.workouts || [])));
  const seasonActual = await loadExecutionForRange(athleteId, season.start_date, season.end_date, seasonWorkouts);

  return {
    season: { ...season, planned: seasonPlanned, actual: seasonActual, progress: cycleProgress(seasonPlanned, seasonActual, season.start_date, season.end_date, seasonWorkouts) },
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


function intervalsRunSportSettings(athletePayload) {
  const data = unwrapIntervalsObject(athletePayload || {});
  const settings = Array.isArray(data.sportSettings) ? data.sportSettings : Array.isArray(data.sport_settings) ? data.sport_settings : [];
  const hasType = (item, type) => (Array.isArray(item && item.types) ? item.types : []).some(value => String(value).toLowerCase() === String(type).toLowerCase());
  return settings.find(item => hasType(item, 'Run')) || settings.find(item => hasType(item, 'TrailRun')) || null;
}

function hrZoneRowsFromIntervalsSettings(settings) {
  const limits = Array.isArray(settings && settings.hr_zones) ? settings.hr_zones.map(optionalNumber).filter(value => value !== null && value > 0) : [];
  if (!limits.length) return [];
  let min = 0;
  return limits.map((max, index) => {
    const row = { kind: 'hr', zone_order: index + 1, zone_name: `Z${index + 1}`, min_value: min, max_value: max, source: 'intervals_run_profile' };
    min = max + 1;
    return row;
  });
}

async function intervalsRunProfile(athleteId) {
  if (DEMO_MODE) return null;
  const apiKey = await getIntervalsKey(athleteId);
  if (!apiKey) return null;
  try {
    const athletePayload = await intervalsFetch(apiKey, '/athlete/0');
    const settings = intervalsRunSportSettings(athletePayload);
    if (!settings) return null;
    return {
      source: 'Intervals.icu · perfil Run',
      threshold_pace_sec_per_km: roundOrNull(thresholdPaceSecondsFromIntervals(settings.threshold_pace), 1),
      threshold_pace_mps: roundOrNull(optionalNumber(settings.threshold_pace), 4),
      lthr: roundOrNull(optionalNumber(settings.lthr), 0),
      max_hr: roundOrNull(optionalNumber(settings.max_hr), 0),
      hr_zones: hrZoneRowsFromIntervalsSettings(settings),
      hr_zone_limits: Array.isArray(settings.hr_zones) ? settings.hr_zones : [],
      pace_zones: Array.isArray(settings.pace_zones) ? settings.pace_zones : [],
      pace_units: settings.pace_units || null,
      settings_id: settings.id || null,
      types: Array.isArray(settings.types) ? settings.types : [],
      fetched_at: new Date().toISOString(),
    };
  } catch (error) {
    console.warn(`[intervals-run-profile] athlete=${athleteId}: ${error.message}`);
    return null;
  }
}

function intervalsEventTypeForSport(sport) {
  const value = String(sport || 'Run');
  if (value === 'Strength') return 'WeightTraining';
  if (value === 'Rest') return null;
  return value;
}

function normaliseIntervalsTarget(target, sport = 'Run') {
  let value = sanitiseText(target, 120).replace(/\s+/g, ' ').trim();
  if (!value) return sport === 'Run' || sport === 'TrailRun' ? 'Z2 Pace' : 'Z2';

  const zone = value.match(/\bZ\s*([1-7])(?:\s*-\s*Z?\s*([1-7]))?/i);
  if (zone) {
    const label = zone[2] ? `Z${zone[1]}-Z${zone[2]}` : `Z${zone[1]}`;
    if (/\b(Pace|HR)\b/i.test(value)) return value;
    if (sport === 'Run' || sport === 'TrailRun') return `${label} Pace`;
    return label;
  }

  if (/\b(Pace|HR|FTP)\b/i.test(value) || /%/.test(value) || /\d:\d{2}/.test(value)) return value;
  if (/progresiv/i.test(value)) return sport === 'Run' || sport === 'TrailRun' ? 'Z3-Z4 Pace' : '';
  if (/suave|trote/i.test(value)) return sport === 'Run' || sport === 'TrailRun' ? 'Z1 Pace' : '';
  if (/aer[oó]bic/i.test(value)) return sport === 'Run' || sport === 'TrailRun' ? 'Z2 Pace' : '';
  return '';
}

function intervalsDurationToken(value, unit = 'm') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const cleaned = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  if (unit === 's') return `${cleaned}s`;
  if (unit === 'km') return `${cleaned}km`;
  if (unit === 'mtr') return `${cleaned}mtr`;
  return `${cleaned}m`;
}

function compileIntervalsWorkoutDescription(workout) {
  const sport = String(workout && workout.sport || 'Run');
  const blocks = Array.isArray(workout && workout.blocks) ? workout.blocks : [];
  if (sport === 'Strength') return sanitiseText(workout.structured_description || workout.summary, 10000);

  const lines = [];
  const pushStep = (duration, target) => {
    if (!duration) return;
    const normalised = normaliseIntervalsTarget(target, sport);
    lines.push(`- ${duration}${normalised ? ` ${normalised}` : ''}`);
  };

  blocks.forEach(block => {
    if (!block || typeof block !== 'object') return;
    if (block.type === 'warmup') {
      const duration = intervalsDurationToken(block.duration_min, 'm');
      if (duration) {
        if (lines.length) lines.push('');
        lines.push('Calentamiento');
        pushStep(duration, block.target || 'Z1');
      }
      return;
    }

    if (block.type === 'activation') {
      const reps = Math.max(1, Math.round(Number(block.repetitions || 1)));
      const work = intervalsDurationToken(block.work_sec, 's');
      const recovery = intervalsDurationToken(block.recovery_sec, 's');
      if (!work) return;
      if (lines.length) lines.push('');
      lines.push(reps > 1 ? `Activacion ${reps}x` : 'Activacion');
      pushStep(work, block.target || 'Z4');
      if (recovery) pushStep(recovery, block.recovery_target || 'Z1');
      return;
    }

    if (block.type === 'central') {
      const reps = Math.max(1, Math.round(Number(block.repetitions || 1)));
      const work = intervalsDurationToken(block.work_value, block.work_unit || 'm');
      const recovery = intervalsDurationToken(block.recovery_value, block.recovery_unit || 'm');
      if (!work) return;
      if (lines.length) lines.push('');
      const name = sanitiseText(block.name || 'Bloque principal', 100) || 'Bloque principal';
      if (reps > 1) lines.push(`${name} ${reps}x`);
      else lines.push(name);
      pushStep(work, block.target || 'Z2');
      if (recovery) pushStep(recovery, block.recovery_target || 'Z1');
      return;
    }

    if (block.type === 'steady') {
      const duration = intervalsDurationToken(block.duration_min || block.work_value, block.duration_min ? 'm' : (block.work_unit || 'm'));
      if (!duration) return;
      if (lines.length) lines.push('');
      lines.push(sanitiseText(block.name || 'Bloque principal', 100) || 'Bloque principal');
      pushStep(duration, block.target || 'Z2');
      return;
    }

    if (block.type === 'cooldown') {
      const duration = intervalsDurationToken(block.duration_min, 'm');
      if (duration) {
        if (lines.length) lines.push('');
        lines.push('Vuelta a la calma');
        pushStep(duration, block.target || 'Z1');
      }
    }
  });

  const compiled = lines.join('\n').trim();
  return compiled || sanitiseText(workout.structured_description || workout.summary, 10000);
}

function buildIntervalsEvent(workout) {
  const type = intervalsEventTypeForSport(workout.sport);
  if (!type) return null;
  const event = {
    category: 'WORKOUT',
    start_date_local: `${workout.workout_date}T00:00:00`,
    type,
    name: sanitiseText(workout.title || 'Sesion', 160),
    description: compileIntervalsWorkoutDescription(workout),
    external_id: `runflow-workout-${workout.id}`,
  };
  const load = numberOrNull(workout.planned_load, 0, 1000);
  const duration = numberOrNull(workout.planned_duration_min, 0, 2000);
  if (load !== null) event.icu_training_load = load;
  if (duration !== null) event.moving_time = Math.round(duration * 60);
  return event;
}

async function intervalsEventsForRange(apiKey, oldest, newest) {
  const query = `/athlete/0/events?oldest=${encodeURIComponent(oldest)}&newest=${encodeURIComponent(newest)}`;
  const rows = await intervalsFetch(apiKey, query);
  return Array.isArray(rows) ? rows : [];
}

function sameIntervalsLegacyEvent(candidate, workout, event) {
  if (!candidate || candidate.category !== 'WORKOUT') return false;
  if (candidate.external_id) return false;
  const localDate = String(candidate.start_date_local || '').slice(0, 10);
  return localDate === workout.workout_date
    && String(candidate.name || '') === String(event.name || '')
    && String(candidate.type || '') === String(event.type || '');
}

async function saveIntervalsEventId(athleteId, workoutId, eventId) {
  if (DEMO_MODE || !workoutId || eventId === null || eventId === undefined) return;
  await prodRows(
    'workouts',
    `id=eq.${encodeURIComponent(workoutId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,
    { method: 'PATCH', body: { intervals_event_id: String(eventId), updated_at: new Date().toISOString() }, prefer: 'return=minimal' }
  );
}

async function deleteIntervalsEvents(apiKey, workouts) {
  const rows = Array.isArray(workouts) ? workouts : [];
  let deleted = 0;
  for (const workout of rows) {
    if (!workout || intervalsEventTypeForSport(workout.sport) === null) continue;
    if (workout.intervals_event_id) {
      try {
        await intervalsFetch(apiKey, `/athlete/0/events/${encodeURIComponent(workout.intervals_event_id)}`, { method: 'DELETE' });
        deleted += 1;
      } catch (error) {
        if (Number(error.status) !== 404) throw error;
      }
      continue;
    }
    try {
      const result = await intervalsFetch(apiKey, '/athlete/0/events/bulk-delete', {
        method: 'PUT',
        body: JSON.stringify([{ external_id: `runflow-workout-${workout.id}` }]),
      });
      deleted += Number(result || 0);
    } catch (error) {
      if (Number(error.status) !== 404) throw error;
    }
  }
  return deleted;
}

async function syncWeekToIntervals(athleteId, week, deletedWorkouts = []) {
  if (DEMO_MODE) return { demo: true, exported: week.workouts.length, created: 0, updated: 0, deleted: 0, legacy_adopted: 0 };
  const apiKey = await getIntervalsKey(athleteId);
  if (!apiKey) return { skipped: true, reason: 'Intervals pendiente de conectar.' };

  const deleted = await deleteIntervalsEvents(apiKey, deletedWorkouts);
  const candidates = (week.workouts || [])
    .filter(item => intervalsEventTypeForSport(item.sport) !== null)
    .map(item => ({ workout: item, event: buildIntervalsEvent(item) }));
  if (!candidates.length) return { exported: 0, created: 0, updated: 0, deleted, legacy_adopted: 0, result: [] };

  const oldest = week.week_start || candidates.map(item => item.workout.workout_date).sort()[0];
  const newest = week.end_date || addDays(oldest, 6);
  let calendarEvents = [];
  try { calendarEvents = await intervalsEventsForRange(apiKey, oldest, newest); } catch { calendarEvents = []; }

  const results = [];
  const pendingCreate = [];
  let updated = 0;
  let legacyAdopted = 0;

  for (const entry of candidates) {
    const { workout, event } = entry;
    if (workout.intervals_event_id) {
      try {
        const result = await intervalsFetch(apiKey, `/athlete/0/events/${encodeURIComponent(workout.intervals_event_id)}`, {
          method: 'PUT',
          body: JSON.stringify(event),
        });
        results.push(result);
        await saveIntervalsEventId(athleteId, workout.id, result && result.id !== undefined ? result.id : workout.intervals_event_id);
        workout.intervals_event_id = String(result && result.id !== undefined ? result.id : workout.intervals_event_id);
        updated += 1;
        continue;
      } catch (error) {
        if (Number(error.status) !== 404) throw error;
        workout.intervals_event_id = null;
      }
    }

    const exactLegacy = calendarEvents.filter(candidate => sameIntervalsLegacyEvent(candidate, workout, event));
    if (exactLegacy.length === 1) {
      const legacy = exactLegacy[0];
      const result = await intervalsFetch(apiKey, `/athlete/0/events/${encodeURIComponent(legacy.id)}`, {
        method: 'PUT',
        body: JSON.stringify(event),
      });
      results.push(result);
      await saveIntervalsEventId(athleteId, workout.id, result && result.id !== undefined ? result.id : legacy.id);
      workout.intervals_event_id = String(result && result.id !== undefined ? result.id : legacy.id);
      updated += 1;
      legacyAdopted += 1;
      continue;
    }

    pendingCreate.push(entry);
  }

  let created = 0;
  if (pendingCreate.length) {
    const bulk = await intervalsFetch(apiKey, '/athlete/0/events/bulk?upsert=true', {
      method: 'POST',
      body: JSON.stringify(pendingCreate.map(item => item.event)),
    });
    const bulkRows = Array.isArray(bulk) ? bulk : [];
    for (let index = 0; index < pendingCreate.length; index += 1) {
      const entry = pendingCreate[index];
      const result = bulkRows[index] || null;
      results.push(result);
      if (result && result.id !== undefined) {
        await saveIntervalsEventId(athleteId, entry.workout.id, result.id);
        entry.workout.intervals_event_id = String(result.id);
      }
    }
    created = pendingCreate.length;
  }

  return {
    exported: candidates.length,
    created,
    updated,
    deleted,
    legacy_adopted: legacyAdopted,
    result: results,
  };
}



async function intervalsFetchBinary(apiKey, endpoint) {
  const response = await fetch(`${INTERVALS_API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`,
      Accept: 'application/octet-stream, application/gzip, */*',
    },
  });
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!response.ok) {
    const text = buffer.toString('utf8').slice(0, 1000);
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    throw Object.assign(new Error((data && (data.message || data.error)) || `Intervals.icu respondió con HTTP ${response.status}.`), { status: response.status, details: data });
  }
  return {
    buffer,
    content_type: response.headers.get('content-type') || 'application/octet-stream',
    content_disposition: response.headers.get('content-disposition') || '',
  };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | (Math.floor(date.getSeconds() / 2) & 31);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(String(entry.name || 'file').replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored, no compression
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function safeFilename(value, fallback = 'activity') {
  const cleaned = String(value || fallback).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 100) || fallback;
}

async function originalActivityDownload(athleteId, externalId) {
  if (DEMO_MODE) throw Object.assign(new Error('La descarga del archivo original solo está disponible con Intervals conectado.'), { status: 400 });
  const apiKey = await getIntervalsKey(athleteId);
  if (!apiKey) throw Object.assign(new Error('Este deportista todavía no tiene Intervals.icu conectado.'), { status: 409 });
  const activity = await activityRowByExternalId(athleteId, externalId);
  const result = await intervalsFetchBinary(apiKey, `/activity/${encodeURIComponent(externalId)}/file`);
  const fileType = String(activity && activity.raw_summary && activity.raw_summary.file_type || 'fit').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'fit';
  const base = safeFilename(`${String(activity && activity.activity_date || '').slice(0, 10)}_${activity && activity.name || externalId}`);
  return { ...result, filename: `${base}.${fileType}.gz` };
}

async function activityAnalysisPackage(session, athleteId, externalId) {
  const detail = await getActivityDetail(session, athleteId, externalId);
  const activity = detail.activity || {};
  const base = safeFilename(`${String(activity.activity_date || '').slice(0, 10)}_${activity.name || externalId}`);
  const manifest = {
    schema: 'runflow.activity-package.v1.1',
    generated_at: new Date().toISOString(),
    intervals_activity_id: externalId,
    athlete_id: athleteId,
    files: ['activity.json', 'intervals_raw_detail.json', 'README.txt'],
    note: 'Paquete de análisis. Incluye contexto RunFlow, recuperación sincronizada a la fecha de la actividad, streams temporales y, cuando Intervals lo permite, archivos binarios original y procesado.',
  };
  const context = {
    schema: 'runflow.activity-context.v1.1',
    generated_at: manifest.generated_at,
    activity: { ...activity, raw_summary: undefined },
    planned: detail.planned || null,
    recovery: detail.recovery || [],
    review: detail.review || null,
  };
  const entries = [
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    { name: 'activity.json', data: JSON.stringify(context, null, 2) },
    { name: 'intervals_raw_detail.json', data: JSON.stringify(activity.raw_summary || {}, null, 2) },
    { name: 'README.txt', data: 'RunFlow activity package v1.1\n\nSube este ZIP directamente a ChatGPT para analizar la sesión. Incluye el detalle recibido de Intervals.icu, contexto Plan vs Real, recuperación sincronizada hasta la fecha de la actividad, streams temporales en CSV/JSON cuando están disponibles y los archivos FIT originales/procesados.\n' },
  ];
  if (!DEMO_MODE) {
    const apiKey = await getIntervalsKey(athleteId);
    if (apiKey) {
      try {
        const original = await intervalsFetchBinary(apiKey, `/activity/${encodeURIComponent(externalId)}/file`);
        const fileType = String(activity.raw_summary && activity.raw_summary.file_type || 'fit').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'fit';
        entries.push({ name: `original_activity.${fileType}.gz`, data: original.buffer });
        manifest.files.push(`original_activity.${fileType}.gz`);
      } catch (error) {
        manifest.original_file_error = error.message;
      }
      try {
        const streamsCsv = await intervalsFetchBinary(apiKey, `/activity/${encodeURIComponent(externalId)}/streams.csv`);
        entries.push({ name: 'streams.csv', data: streamsCsv.buffer });
        manifest.files.push('streams.csv');
      } catch (error) {
        manifest.streams_csv_error = error.message;
      }
      try {
        const streamsJson = await intervalsFetch(apiKey, `/activity/${encodeURIComponent(externalId)}/streams.json`);
        entries.push({ name: 'streams.json', data: JSON.stringify(streamsJson, null, 2) });
        manifest.files.push('streams.json');
      } catch (error) {
        manifest.streams_json_error = error.message;
      }
      try {
        const processed = await intervalsFetchBinary(apiKey, `/activity/${encodeURIComponent(externalId)}/fit-file`);
        entries.push({ name: 'intervals_processed.fit.gz', data: processed.buffer });
        manifest.files.push('intervals_processed.fit.gz');
      } catch (error) {
        manifest.processed_fit_error = error.message;
      }
    }
  }
  entries[0] = { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) };
  return { buffer: buildZip(entries), filename: `${base}_runflow_analysis.zip` };
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
    const raw = object && object[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values) {
  const valid = (values || []).filter(value => value !== null && value !== undefined && value !== '').map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function standardDeviation(values) {
  const valid = (values || []).filter(value => value !== null && value !== undefined && value !== '').map(Number).filter(Number.isFinite);
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
  if (value === null || value === undefined || value === '') return null;
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
  return prodRows('activities', `athlete_id=eq.${encodeURIComponent(athleteId)}&activity_date=gte.${oldest}T00:00:00&activity_date=lte.${newest}T23:59:59&select=id,athlete_id,workout_id,intervals_activity_id,activity_date,sport,name,duration_sec,distance_m,elevation_gain_m,load,avg_hr,max_hr,avg_pace_sec_per_km,raw_summary&order=activity_date.desc`);
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

function percentile(values, p) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

async function loadToleranceSnapshot(athleteId, weeks = 12, sync = false) {
  const requestedWeeks = Math.max(4, Math.min(24, Number(weeks) || 12));
  const currentWeekStart = startOfWeek();
  const oldest = addDays(currentWeekStart, -7 * requestedWeeks);
  const newest = addDays(currentWeekStart, -1);
  const activities = sync
    ? await syncActivities(athleteId, oldest, newest)
    : await listStoredActivities(athleteId, oldest, newest);

  const weekly = [];
  for (let offset = requestedWeeks; offset >= 1; offset -= 1) {
    const weekStart = addDays(currentWeekStart, -7 * offset);
    const weekEnd = addDays(weekStart, 6);
    const rows = activities.filter(item => {
      const date = String(item.activity_date || '').slice(0, 10);
      return date >= weekStart && date <= weekEnd;
    });
    const load = rows.reduce((sum, item) => sum + Number(item.load || 0), 0);
    weekly.push({
      week_start: weekStart,
      week_end: weekEnd,
      load: roundOrNull(load, 1) || 0,
      activities: rows.length,
      has_data: rows.length > 0,
    });
  }

  const observed = weekly.filter(item => item.has_data).map(item => Number(item.load || 0));
  return {
    weeks: weekly,
    stats: {
      weeks_requested: requestedWeeks,
      weeks_with_data: observed.length,
      average_load: roundOrNull(average(observed), 1),
      median_load: roundOrNull(percentile(observed, 0.5), 1),
      p25_load: roundOrNull(percentile(observed, 0.25), 1),
      p75_load: roundOrNull(percentile(observed, 0.75), 1),
      min_load: observed.length ? roundOrNull(Math.min(...observed), 1) : null,
      max_load: observed.length ? roundOrNull(Math.max(...observed), 1) : null,
      oldest,
      newest,
    },
  };
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
    hrv: roundOrNull(firstFinite(item || {}, ['hrv', 'hrvRMSSD', 'hrvRmssd', 'hrv_rmssd', 'rmssd', 'rmssd_ms']), 2),
    source: 'intervals',
    updated_at: new Date().toISOString(),
  };
}

function readinessForRow(row, previousRows) {
  const baseline = previousRows.slice(-21);
  const sleepBase = average(baseline.map(item => { const sec = optionalNumber(item.sleep_sec); return sec === null ? null : sec / 3600; }));
  const rhrBase = average(baseline.map(item => item.resting_hr));
  const hrvBase = average(baseline.map(item => item.hrv));
  const sleepSec = optionalNumber(row.sleep_sec);
  const sleep = sleepSec === null ? null : sleepSec / 3600;
  const rhr = optionalNumber(row.resting_hr);
  const hrv = optionalNumber(row.hrv);
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



function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function localDateInTimeZone(timeZone = process.env.RUNFLOW_TIMEZONE || 'Europe/Madrid', date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localHourInTimeZone(timeZone = process.env.RUNFLOW_TIMEZONE || 'Europe/Madrid', date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  return Number.isFinite(hour) ? hour : 0;
}

async function listPerformanceSnapshots(athleteId, oldest, newest) {
  if (DEMO_MODE) return [];
  return prodRows('performance_snapshots', `athlete_id=eq.${encodeURIComponent(athleteId)}&snapshot_date=gte.${oldest}&snapshot_date=lte.${newest}&select=*&order=snapshot_date.asc`);
}

function sumActivityLoad(rows, oldest, newest) {
  return roundOrNull((rows || []).filter(item => {
    const date = String(item.activity_date || '').slice(0, 10);
    return date >= oldest && date <= newest;
  }).reduce((sum, item) => sum + Number(item.load || 0), 0), 1) || 0;
}

function nearestMetricRow(rows, targetDate) {
  const target = new Date(`${targetDate}T12:00:00Z`).getTime();
  let best = null;
  let bestDiff = Infinity;
  for (const row of rows || []) {
    if (!Number.isFinite(Number(row.fitness))) continue;
    const time = new Date(`${row.metric_date}T12:00:00Z`).getTime();
    const diff = Math.abs(time - target);
    if (diff < bestDiff) { best = row; bestDiff = diff; }
  }
  return best;
}

function fitnessIndexForRows(current, wellnessRows) {
  const currentFitness = optionalNumber(current && current.fitness);
  const fitnessValues = (wellnessRows || []).map(item => optionalNumber(item.fitness)).filter(Number.isFinite);
  if (currentFitness === null || fitnessValues.length < 2) {
    return { index: currentFitness, label: 'Aptitud todavía sin tendencia', trend: 'En construcción', change28: null };
  }
  const row28 = nearestMetricRow(wellnessRows, addDays(current.metric_date, -28));
  const fitness28 = optionalNumber(row28 && row28.fitness);
  const change28 = fitness28 === null ? null : currentFitness - fitness28;
  const trend = change28 === null ? 'En construcción' : change28 >= 1.5 ? 'Subiendo' : change28 <= -1.5 ? 'Bajando' : 'Estable';
  const label = change28 === null ? 'Aptitud actual' : change28 >= 1.5 ? 'Carga acumulada creciendo' : change28 <= -1.5 ? 'Carga acumulada descendiendo' : 'Carga acumulada estable';
  // 2.4.1: fitness_index conserva compatibilidad con la tabla, pero ya no es un índice 0–100.
  // Representa la Aptitud/CTL real recibida de Intervals.
  return { index: roundOrNull(currentFitness, 2), label, trend, change28: roundOrNull(change28, 1) };
}


function streamByType(streams, type) {
  return (Array.isArray(streams) ? streams : []).find(item => String(item && item.type || '').toLowerCase() === String(type).toLowerCase())?.data || [];
}

function median(values) {
  return percentile((values || []).map(Number).filter(Number.isFinite), 0.5);
}

function meanForIndexes(values, indexes) {
  const valid = (indexes || []).map(index => optionalNumber(values[index])).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function thresholdPaceSecondsFromIntervals(value) {
  const number = optionalNumber(value);
  if (number === null || number <= 0) return null;
  // Intervals.icu expone threshold_pace en m/s en la API, aunque la UI lo muestre como min/km.
  if (number >= 2 && number <= 8) return 1000 / number;
  // Fallback defensivo por si una integración futura ya entrega segundos/km.
  if (number >= 120 && number <= 600) return number;
  return null;
}

function normaliseRunCadence(value) {
  const number = optionalNumber(value);
  if (number === null) return null;
  // Algunos Garmin/Intervals entregan zancadas por minuto (una pierna). Mostramos pasos/min totales.
  return number >= 55 && number <= 110 ? number * 2 : number;
}

function rollingUphillBenchmark(time, altitude, hr, distance, windowSec, minNetGain) {
  const n = Math.min(time.length, altitude.length);
  if (n < 60) return null;
  let start = 0;
  let best = null;
  for (let end = 1; end < n; end += 1) {
    const endTime = optionalNumber(time[end]);
    if (endTime === null) continue;
    while (start < end && optionalNumber(time[start]) !== null && endTime - Number(time[start]) > windowSec) start += 1;
    const startTime = optionalNumber(time[start]);
    const startAlt = optionalNumber(altitude[start]);
    const endAlt = optionalNumber(altitude[end]);
    if (startTime === null || startAlt === null || endAlt === null) continue;
    const elapsed = endTime - startTime;
    if (elapsed < windowSec * 0.92) continue;
    const netGain = endAlt - startAlt;
    if (netGain < minNetGain) continue;
    let positiveGain = 0;
    for (let i = start + 1; i <= end; i += 1) {
      const a = optionalNumber(altitude[i - 1]), b = optionalNumber(altitude[i]);
      if (a === null || b === null) continue;
      const delta = b - a;
      if (delta > 0 && delta <= 8) positiveGain += delta;
    }
    if (positiveGain <= 0 || netGain / positiveGain < 0.68) continue;
    const startDist = optionalNumber(distance[start]);
    const endDist = optionalNumber(distance[end]);
    const distM = startDist !== null && endDist !== null ? endDist - startDist : null;
    if (distM !== null && distM < 600) continue;
    const vam = (netGain / elapsed) * 3600;
    if (!Number.isFinite(vam) || vam < 150 || vam > 2500) continue;
    const indexes = [];
    for (let i = start; i <= end; i += 1) indexes.push(i);
    const avgHr = meanForIndexes(hr, indexes);
    if (!best || vam > best.vam) best = { vam, avg_hr: avgHr, net_gain: netGain, positive_gain: positiveGain, elapsed, distance_m: distM };
  }
  return best;
}

function deriveActivityPerformanceMetric(activity, streams, hrZones = [], intervalsDetail = {}, runProfile = null) {
  const time = streamByType(streams, 'time');
  const hr = streamByType(streams, 'heartrate');
  const speed = streamByType(streams, 'velocity_smooth');
  const cadence = streamByType(streams, 'cadence');
  const distance = streamByType(streams, 'distance');
  const altitude = streamByType(streams, 'fixed_altitude').length ? streamByType(streams, 'fixed_altitude') : streamByType(streams, 'altitude');
  const points = Math.max(time.length, hr.length, speed.length, cadence.length, altitude.length);
  if (!points || hr.length < 30 || speed.length < 30) return null;
  const validIndexes = [];
  for (let i = 0; i < Math.min(hr.length, speed.length); i += 1) {
    const h = optionalNumber(hr[i]);
    const v = optionalNumber(speed[i]);
    if (h !== null && h >= 70 && v !== null && v > 0.8) validIndexes.push(i);
  }
  if (validIndexes.length < 120) return null;
  const avgHr = meanForIndexes(hr, validIndexes);
  const avgSpeedMs = meanForIndexes(speed, validIndexes);
  const aerobicEfficiency = avgHr && avgSpeedMs ? ((avgSpeedMs * 3.6) / avgHr) * 100 : null;
  const avgCadenceRaw = meanForIndexes(cadence, validIndexes);
  const avgCadence = normaliseRunCadence(avgCadenceRaw);

  const z2 = [...(hrZones || [])].sort((a, b) => Number(a.zone_order || 0) - Number(b.zone_order || 0))[1] || null;
  let z2Indexes = [];
  if (z2) {
    const minHr = optionalNumber(z2.min_value);
    const maxHr = optionalNumber(z2.max_value);
    if (minHr !== null && maxHr !== null) {
      z2Indexes = validIndexes.filter(index => {
        const value = optionalNumber(hr[index]);
        return value !== null && value >= minHr && value <= maxHr;
      });
    }
  }
  const z2Speed = z2Indexes.length >= 180 ? meanForIndexes(speed, z2Indexes) : null;
  const z2Hr = z2Indexes.length >= 180 ? meanForIndexes(hr, z2Indexes) : null;
  const z2Pace = z2Speed && z2Speed > 0 ? 1000 / z2Speed : null;
  const z2Efficiency = z2Speed && z2Hr ? ((z2Speed * 3.6) / z2Hr) * 100 : null;

  const distanceKm = optionalNumber(activity.distance_m) ? Number(activity.distance_m) / 1000 : null;
  const elevationPerKm = distanceKm && distanceKm > 0 ? Number(activity.elevation_gain_m || 0) / distanceKm : null;
  let cardiacDrift = null;
  const duration = optionalNumber(activity.duration_sec) || (time.length ? optionalNumber(time.at(-1)) : null);
  if (duration && duration >= 1800 && (elevationPerKm === null || elevationPerKm <= 12)) {
    const startCut = Math.floor(validIndexes.length * 0.10);
    const endCut = Math.ceil(validIndexes.length * 0.90);
    const core = validIndexes.slice(startCut, endCut);
    const half = Math.floor(core.length / 2);
    const first = core.slice(0, half);
    const second = core.slice(half);
    const hr1 = meanForIndexes(hr, first), hr2 = meanForIndexes(hr, second);
    const sp1 = meanForIndexes(speed, first), sp2 = meanForIndexes(speed, second);
    const eff1 = hr1 && sp1 ? sp1 / hr1 : null;
    const eff2 = hr2 && sp2 ? sp2 / hr2 : null;
    if (eff1 && eff2) cardiacDrift = ((eff1 - eff2) / eff1) * 100;
  }

  const zoneDistribution = {};
  const orderedZones = [...(hrZones || [])].sort((a, b) => Number(a.zone_order || 0) - Number(b.zone_order || 0));
  if (orderedZones.length) {
    const seconds = Object.fromEntries(orderedZones.map(zone => [`Z${zone.zone_order}`, 0]));
    for (let i = 0; i < hr.length; i += 1) {
      const value = optionalNumber(hr[i]);
      if (value === null) continue;
      const zone = orderedZones.find(item => {
        const min = optionalNumber(item.min_value), max = optionalNumber(item.max_value);
        return min !== null && max !== null && value >= min && value <= max;
      });
      if (!zone) continue;
      const currentTime = optionalNumber(time[i]);
      const nextTime = optionalNumber(time[i + 1]);
      const step = currentTime !== null && nextTime !== null ? clampNumber(nextTime - currentTime, 0, 10) : 1;
      seconds[`Z${zone.zone_order}`] = (seconds[`Z${zone.zone_order}`] || 0) + (step || 1);
    }
    const total = Object.values(seconds).reduce((sum, value) => sum + Number(value || 0), 0);
    for (const [zone, sec] of Object.entries(seconds)) zoneDistribution[zone] = { seconds: Math.round(sec), pct: total ? roundOrNull((sec / total) * 100, 1) : 0 };
  }

  const thresholdPaceSec = thresholdPaceSecondsFromIntervals(intervalsDetail && intervalsDetail.threshold_pace);
  const thresholdHr = optionalNumber(intervalsDetail && intervalsDetail.lthr);
  const currentProfileThreshold = optionalNumber(runProfile && runProfile.threshold_pace_sec_per_km);
  const currentProfileLthr = optionalNumber(runProfile && runProfile.lthr);
  const gapSpeed = optionalNumber(intervalsDetail && intervalsDetail.gap);
  const sportText = String(activity.sport || '').toLowerCase();
  const trailCandidate = sportText.includes('trail') || (elevationPerKm !== null && elevationPerKm >= 20);
  const trailGapEfficiency = trailCandidate && gapSpeed && avgHr ? ((gapSpeed * 3.6) / avgHr) * 100 : null;

  const best20 = trailCandidate && altitude.length && time.length ? rollingUphillBenchmark(time, altitude, hr, distance, 1200, 60) : null;
  const best30 = trailCandidate && altitude.length && time.length ? rollingUphillBenchmark(time, altitude, hr, distance, 1800, 90) : null;
  const uphillThresholdVam = best30 ? best30.vam : best20 ? best20.vam * 0.95 : null;
  const uphillWindow = best30 ? 30 : best20 ? 20 : null;
  const uphillHr = best30 ? best30.avg_hr : best20 ? best20.avg_hr : null;
  const markerConfidence = best30 ? 'Media' : best20 ? 'Provisional' : thresholdPaceSec !== null ? 'Media' : 'Provisional';

  return {
    athlete_id: activity.athlete_id,
    activity_id: activity.id || null,
    intervals_activity_id: String(activity.intervals_activity_id),
    activity_date: activity.activity_date,
    sport: activity.sport || null,
    aerobic_efficiency: roundOrNull(aerobicEfficiency, 3),
    z2_efficiency: roundOrNull(z2Efficiency, 3),
    z2_pace_sec_per_km: roundOrNull(z2Pace, 1),
    z2_avg_hr: roundOrNull(z2Hr, 1),
    cardiac_drift_pct: roundOrNull(cardiacDrift, 1),
    avg_cadence: roundOrNull(avgCadence, 1),
    moving_time_sec: roundOrNull(duration, 0),
    zone_distribution: zoneDistribution,
    threshold_pace_sec_per_km: roundOrNull(thresholdPaceSec, 1),
    threshold_hr: roundOrNull(thresholdHr, 0),
    threshold_source: thresholdPaceSec !== null ? 'Intervals.icu' : null,
    gap_speed_mps: roundOrNull(gapSpeed, 4),
    trail_gap_efficiency: roundOrNull(trailGapEfficiency, 3),
    uphill_vam_20m: roundOrNull(best20 && best20.vam, 0),
    uphill_vam_30m: roundOrNull(best30 && best30.vam, 0),
    uphill_threshold_vam: roundOrNull(uphillThresholdVam, 0),
    uphill_avg_hr: roundOrNull(uphillHr, 0),
    uphill_window_min: uphillWindow,
    trail_candidate: Boolean(trailCandidate),
    marker_confidence: markerConfidence,
    details: {
      metric_version: '2.4.2',
      stream_points: points,
      valid_moving_points: validIndexes.length,
      z2_points: z2Indexes.length,
      elevation_per_km: roundOrNull(elevationPerKm, 1),
      cadence_raw: roundOrNull(avgCadenceRaw, 1),
      cadence_normalised_to_steps_per_min: avgCadenceRaw !== null && avgCadence !== null && Math.abs(avgCadence - avgCadenceRaw) > 1,
      threshold_note: thresholdPaceSec !== null ? 'Valor de threshold_pace asociado a la actividad en Intervals.icu; se usa como estimación de campo, no como prueba de laboratorio.' : currentProfileThreshold !== null ? 'La actividad no trae threshold_pace histórico; el perfil Run actual de Intervals se conserva como referencia actual, sin atribuirlo retrospectivamente a esta fecha.' : 'Intervals no aportó threshold_pace para esta actividad.',
      current_run_profile_threshold: roundOrNull(currentProfileThreshold, 1),
      current_run_profile_lthr: roundOrNull(currentProfileLthr, 0),
      uphill_note: uphillWindow ? `Referencia de subida basada en el mejor tramo sostenido de ${uphillWindow} min con ascenso continuo suficiente.` : 'Sin tramo sostenido suficiente para estimar rendimiento de subida.',
      cardiac_drift_note: cardiacDrift === null ? 'Solo se estima en sesiones de al menos 30 min y con poco desnivel.' : 'Estimación comparando eficiencia FC/velocidad entre mitades de una sesión relativamente llana.',
    },
    calculated_at: new Date().toISOString(),
  };
}

async function listActivityPerformanceMetrics(athleteId, oldest, newest) {
  if (DEMO_MODE) return [];
  return prodRows('activity_performance_metrics', `athlete_id=eq.${encodeURIComponent(athleteId)}&activity_date=gte.${oldest}T00:00:00&activity_date=lte.${newest}T23:59:59&select=*&order=activity_date.asc`).catch(() => []);
}

async function syncActivityPerformanceMetrics(athleteId, activities, oldest, newest, options = {}) {
  if (DEMO_MODE) return [];
  const existing = await listActivityPerformanceMetrics(athleteId, oldest, newest);
  const existingById = new Map(existing.map(item => [String(item.intervals_activity_id), item]));
  const candidates = (activities || []).filter(item => {
    const id = String(item.intervals_activity_id || '');
    const sport = String(item.sport || '').toLowerCase();
    return id && (sport.includes('run') || sport.includes('trail'));
  });
  const forceRecent = Boolean(options.forceRecent);
  const forceIds = new Set(
    forceRecent
      ? [...candidates].sort((a, b) => String(b.activity_date).localeCompare(String(a.activity_date))).slice(0, 12).map(item => String(item.intervals_activity_id))
      : []
  );
  const toProcess = candidates.filter(item => {
    const id = String(item.intervals_activity_id || '');
    const row = existingById.get(id);
    const version = String(row && row.details && row.details.metric_version || '');
    return forceIds.has(id) || !row || version !== '2.4.2';
  }).sort((a, b) => String(b.activity_date).localeCompare(String(a.activity_date))).slice(0, 40);
  if (!toProcess.length) return existing;
  const apiKey = await getIntervalsKey(athleteId);
  if (!apiKey) return existing;
  const runProfile = await intervalsRunProfile(athleteId);
  const configuredHrZones = await prodRows('training_zones', `athlete_id=eq.${encodeURIComponent(athleteId)}&kind=eq.hr&select=*&order=zone_order.asc`).catch(() => []);
  const profileHrZones = runProfile && Array.isArray(runProfile.hr_zones) ? runProfile.hr_zones : [];
  const hrZones = profileHrZones.length ? profileHrZones : configuredHrZones;
  let processed = 0;
  let failed = 0;
  for (const activity of toProcess) {
    try {
      const [streams, detailResponse] = await Promise.all([
        intervalsFetch(apiKey, `/activity/${encodeURIComponent(activity.intervals_activity_id)}/streams.json`),
        intervalsFetch(apiKey, `/activity/${encodeURIComponent(activity.intervals_activity_id)}?intervals=true`).catch(() => activity.raw_summary || {}),
      ]);
      const detail = unwrapIntervalsObject(detailResponse || activity.raw_summary || {});
      const activityHrLimits = Array.isArray(detail && detail.icu_hr_zones) ? detail.icu_hr_zones : [];
      const activityHrZones = activityHrLimits.length ? hrZoneRowsFromIntervalsSettings({ hr_zones: activityHrLimits }) : hrZones;
      const metric = deriveActivityPerformanceMetric(activity, streams, activityHrZones, detail, runProfile);
      if (!metric) {
        failed += 1;
        console.warn(`[activity-performance] ${activity.intervals_activity_id}: metric could not be derived`);
        continue;
      }
      await prodRows('activity_performance_metrics', 'on_conflict=athlete_id,intervals_activity_id', { method: 'POST', body: metric, prefer: 'resolution=merge-duplicates,return=minimal' });
      processed += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[activity-performance] ${activity.intervals_activity_id}: ${error.message}`);
    }
  }
  console.log(`[activity-performance] athlete=${athleteId} processed=${processed} failed=${failed} requested=${toProcess.length} force=${forceRecent ? 1 : 0}`);
  return listActivityPerformanceMetrics(athleteId, oldest, newest);
}

function aggregateZoneDistribution(rows) {
  const totals = {};
  for (const row of rows || []) {
    for (const [zone, value] of Object.entries(row.zone_distribution || {})) totals[zone] = (totals[zone] || 0) + Number(value && value.seconds || 0);
  }
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(totals).sort(([a],[b]) => a.localeCompare(b)).map(([zone, seconds]) => [zone, { seconds: Math.round(seconds), pct: total ? roundOrNull((seconds / total) * 100, 1) : 0 }]));
}

function performanceActivitySummary(rows, runProfile = null) {
  const sorted = [...(rows || [])].sort((a, b) => String(a.activity_date).localeCompare(String(b.activity_date)));
  const recent = sorted.slice(-6);
  const previous = sorted.slice(-12, -6);
  const effRecent = median(recent.map(item => item.aerobic_efficiency));
  const effPrevious = median(previous.map(item => item.aerobic_efficiency));
  const z2RecentRows = sorted.filter(item => optionalNumber(item.z2_pace_sec_per_km) !== null).slice(-3);
  const z2PrevRows = sorted.filter(item => optionalNumber(item.z2_pace_sec_per_km) !== null).slice(-6, -3);
  const z2Pace = median(z2RecentRows.map(item => item.z2_pace_sec_per_km));
  const z2Prev = median(z2PrevRows.map(item => item.z2_pace_sec_per_km));
  const drift = median(sorted.map(item => item.cardiac_drift_pct).filter(value => optionalNumber(value) !== null).slice(-5));
  const cadence = median(recent.map(item => normaliseRunCadence(item.avg_cadence)));

  const thresholdRows = sorted.filter(item => optionalNumber(item.threshold_pace_sec_per_km) !== null);
  const thresholdLatest = thresholdRows.at(-1) || null;
  const thresholdCurrent = optionalNumber(thresholdLatest && thresholdLatest.threshold_pace_sec_per_km);
  let thresholdPrevious = null;
  if (thresholdRows.length >= 2) {
    const latestDate = String(thresholdLatest.activity_date || '').slice(0, 10);
    const targetDate = addDays(latestDate, -56);
    const candidates = thresholdRows.filter(item => String(item.activity_date || '').slice(0, 10) <= targetDate);
    thresholdPrevious = optionalNumber((candidates.at(-1) || thresholdRows[0]).threshold_pace_sec_per_km);
  }
  const thresholdChangeSec = thresholdCurrent !== null && thresholdPrevious !== null ? thresholdPrevious - thresholdCurrent : null;
  const profileThreshold = optionalNumber(runProfile && runProfile.threshold_pace_sec_per_km);
  const profileLthr = optionalNumber(runProfile && runProfile.lthr);
  const displayThreshold = profileThreshold !== null ? profileThreshold : thresholdCurrent;
  const thresholdHr = profileLthr !== null ? profileLthr : optionalNumber(thresholdLatest && thresholdLatest.threshold_hr);
  const thresholdAgeDays = thresholdLatest ? Math.max(0, Math.round((new Date(`${localDateInTimeZone()}T12:00:00Z`) - new Date(`${String(thresholdLatest.activity_date).slice(0,10)}T12:00:00Z`)) / 86400000)) : null;
  const thresholdConfidence = profileThreshold !== null ? 'Actual' : thresholdCurrent === null ? 'Sin datos' : thresholdAgeDays !== null && thresholdAgeDays <= 21 ? (thresholdRows.length >= 3 ? 'Alta' : 'Media') : 'Provisional';

  const trailRows = sorted.filter(item => item.trail_candidate);
  const uphillRows = trailRows.filter(item => optionalNumber(item.uphill_threshold_vam) !== null);
  const uphillRecentRows = uphillRows.slice(-3);
  const uphillPrevRows = uphillRows.slice(-6, -3);
  const uphillVam = median(uphillRecentRows.map(item => item.uphill_threshold_vam));
  const uphillPrev = median(uphillPrevRows.map(item => item.uphill_threshold_vam));
  const uphillChangePct = uphillVam && uphillPrev ? ((uphillVam - uphillPrev) / uphillPrev) * 100 : null;
  const uphillHr = median(uphillRecentRows.map(item => item.uphill_avg_hr));
  const trailEffRecent = median(trailRows.slice(-3).map(item => item.trail_gap_efficiency));
  const trailEffPrev = median(trailRows.slice(-6, -3).map(item => item.trail_gap_efficiency));
  const trailEffChangePct = trailEffRecent && trailEffPrev ? ((trailEffRecent - trailEffPrev) / trailEffPrev) * 100 : null;
  const trailConfidence = uphillRows.length >= 6 ? 'Alta' : uphillRows.length >= 3 ? 'Media' : uphillRows.length ? 'Provisional' : 'Sin datos';

  return {
    activities_with_streams: sorted.length,
    aerobic_efficiency: roundOrNull(effRecent, 3),
    aerobic_efficiency_change_pct: effRecent && effPrevious ? roundOrNull(((effRecent - effPrevious) / effPrevious) * 100, 1) : null,
    z2_pace_sec_per_km: roundOrNull(z2Pace, 1),
    z2_pace_change_pct: z2Pace && z2Prev ? roundOrNull(((z2Prev - z2Pace) / z2Prev) * 100, 1) : null,
    cardiac_drift_pct: roundOrNull(drift, 1),
    avg_cadence: roundOrNull(cadence, 1),
    zone_distribution: aggregateZoneDistribution(sorted),
    threshold_pace_sec_per_km: roundOrNull(displayThreshold, 1),
    threshold_pace_change_8w_sec: roundOrNull(thresholdChangeSec, 1),
    threshold_hr: roundOrNull(thresholdHr, 0),
    threshold_source: profileThreshold !== null ? (runProfile && runProfile.source || 'Intervals.icu · perfil Run') : thresholdLatest && thresholdLatest.threshold_source || null,
    threshold_confidence: thresholdConfidence,
    threshold_observations: thresholdRows.length,
    intervals_run_profile: runProfile || null,
    zones_source: runProfile && runProfile.hr_zones && runProfile.hr_zones.length ? 'Intervals.icu · perfil Run' : null,
    uphill_threshold_vam: roundOrNull(uphillVam, 0),
    uphill_vam_change_pct: roundOrNull(uphillChangePct, 1),
    uphill_avg_hr: roundOrNull(uphillHr, 0),
    trail_gap_efficiency: roundOrNull(trailEffRecent, 3),
    trail_gap_efficiency_change_pct: roundOrNull(trailEffChangePct, 1),
    trail_confidence: trailConfidence,
    trail_observations: uphillRows.length,
  };
}

function trajectoryPointsFromGoal(goal) {
  const metric = safeObject(goal && goal.target_metric);
  const raw = Array.isArray(metric.runflow_fitness_trajectory) ? metric.runflow_fitness_trajectory : [];
  return raw.map(item => ({ date: validDate(item && item.date), value: roundOrNull(item && item.value, 2) })).filter(item => item.date && item.value !== null).sort((a, b) => itemDateSort(a.date, b.date));
}

function itemDateSort(a, b) { return String(a).localeCompare(String(b)); }

function interpolateTrajectory(points, date) {
  const sorted = [...(points || [])].sort((a, b) => itemDateSort(a.date, b.date));
  if (!sorted.length) return null;
  if (date <= sorted[0].date) return Number(sorted[0].value);
  if (date >= sorted.at(-1).date) return Number(sorted.at(-1).value);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i], b = sorted[i + 1];
    if (date < a.date || date > b.date) continue;
    const start = new Date(`${a.date}T12:00:00Z`).getTime();
    const end = new Date(`${b.date}T12:00:00Z`).getTime();
    const current = new Date(`${date}T12:00:00Z`).getTime();
    const ratio = end === start ? 0 : (current - start) / (end - start);
    return Number(a.value) + (Number(b.value) - Number(a.value)) * ratio;
  }
  return null;
}

async function performanceTrajectoryForAthlete(athleteId, currentFitness = null, today = localDateInTimeZone()) {
  const goals = (await listGoals(athleteId)).filter(goal => goal.status === 'active' && String(goal.goal_date || '') >= today);
  const ordered = goals.sort((a, b) => {
    const pa = String(a.priority_code || a.priority || '').toUpperCase() === 'A' || a.priority === 'Principal' ? 0 : 1;
    const pb = String(b.priority_code || b.priority || '').toUpperCase() === 'A' || b.priority === 'Principal' ? 0 : 1;
    return pa - pb || String(a.goal_date).localeCompare(String(b.goal_date));
  });
  const configured = ordered.find(goal => trajectoryPointsFromGoal(goal).length >= 2);
  const goal = configured || ordered[0] || null;
  if (!goal) return { goal: null, points: [], today_target: null, delta: null, status: 'Sin objetivo activo' };
  const points = trajectoryPointsFromGoal(goal);
  const todayTarget = points.length >= 2 ? interpolateTrajectory(points, today) : null;
  const fitness = optionalNumber(currentFitness);
  const delta = todayTarget !== null && fitness !== null ? fitness - todayTarget : null;
  const status = delta === null ? 'Trayectoria sin configurar' : delta >= 1.5 ? 'Por encima de la trayectoria' : delta >= -1 ? 'En trayectoria' : delta >= -2.5 ? 'Ligeramente por debajo' : 'Por debajo de la trayectoria';
  return { goal: { id: goal.id, name: goal.name, goal_date: goal.goal_date, priority_code: goal.priority_code || null, priority: goal.priority || null }, points, today_target: roundOrNull(todayTarget, 2), delta: roundOrNull(delta, 2), status };
}

async function savePerformanceTrajectory(athleteId, body) {
  const goalId = sanitiseText(body && body.goal_id, 80);
  if (!goalId) throw Object.assign(new Error('Selecciona un objetivo.'), { status: 400 });
  const goal = await getGoalForAthlete(athleteId, goalId);
  const points = (Array.isArray(body && body.points) ? body.points : []).map(item => ({ date: validDate(item && item.date), value: roundOrNull(item && item.value, 2) })).filter(item => item.date && item.value !== null).sort((a, b) => itemDateSort(a.date, b.date));
  if (points.length < 2) throw Object.assign(new Error('La trayectoria necesita al menos dos puntos.'), { status: 400 });
  const targetMetric = { ...safeObject(goal.target_metric), runflow_fitness_trajectory: points };
  return updateGoal(goal.id, athleteId, { target_metric: targetMetric });
}

function feedbackAdjustment(logs) {
  const ordered = [...(logs || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const latest = ordered[0] || null;
  let delta = 0;
  const reasons = [];
  if (latest) {
    const pain = Number(latest.pain);
    const rpe = Number(latest.rpe);
    if (Number.isFinite(pain)) {
      if (pain >= 6) { delta -= 20; reasons.push('molestia elevada en la última sesión'); }
      else if (pain >= 3) { delta -= 10; reasons.push('molestia moderada en la última sesión'); }
      else if (pain >= 1) { delta -= 3; reasons.push('molestia leve registrada'); }
    }
    if (Number.isFinite(rpe)) {
      if (rpe >= 9) { delta -= 10; reasons.push('RPE muy alto en la última sesión'); }
      else if (rpe >= 8) { delta -= 6; reasons.push('RPE alto en la última sesión'); }
    }
    if (latest.feeling === 'mal') { delta -= 8; reasons.push('malas sensaciones registradas'); }
  }
  return { delta, reasons, latest };
}

async function dailyPerformanceSnapshot(athleteId, snapshotDate = localDateInTimeZone(), options = {}) {
  const oldest90 = addDays(snapshotDate, -89);
  const oldest42 = addDays(snapshotDate, -41);
  const oldest84 = addDays(snapshotDate, -83);
  const oldest28 = addDays(snapshotDate, -27);
  const oldest7 = addDays(snapshotDate, -6);

  let wellness = [];
  let activities = [];
  try { wellness = await syncRecovery(athleteId, oldest90, snapshotDate); }
  catch { wellness = await listRecoveryRows(athleteId, oldest90, snapshotDate); }
  try { activities = await syncActivities(athleteId, oldest90, snapshotDate); }
  catch { activities = await listStoredActivities(athleteId, oldest90, snapshotDate); }
  const runProfile = await intervalsRunProfile(athleteId);
  let activityPerformanceRows = [];
  try { activityPerformanceRows = await syncActivityPerformanceMetrics(athleteId, activities.filter(item => String(item.activity_date || '').slice(0, 10) >= oldest84), oldest84, snapshotDate, { forceRecent: Boolean(options.forceActivityMetrics) }); }
  catch (error) { console.warn(`[activity-performance] refresh failed: ${error.message}`); activityPerformanceRows = await listActivityPerformanceMetrics(athleteId, oldest84, snapshotDate); }
  const activityPerformance = performanceActivitySummary(activityPerformanceRows, runProfile);

  const calendar = await listCalendarWeeks(athleteId, oldest28, snapshotDate, false).catch(() => []);
  const published = (calendar || []).filter(week => week.status === 'published');
  const plannedWorkouts = published.flatMap(week => week.workouts || []).filter(workout => String(workout.workout_date || '').slice(0, 10) <= snapshotDate);
  const completedPoints = plannedWorkouts.reduce((sum, workout) => sum + (workout.execution_status === 'completed' ? 1 : workout.execution_status === 'partial' ? 0.5 : 0), 0);
  const firstPlannedDate = plannedWorkouts.length ? [...plannedWorkouts].map(item => String(item.workout_date || '').slice(0, 10)).sort()[0] : null;
  const plannedDays = firstPlannedDate ? Math.max(1, Math.round((new Date(`${snapshotDate}T12:00:00Z`) - new Date(`${firstPlannedDate}T12:00:00Z`)) / 86400000) + 1) : 0;
  const consistencyReady = plannedWorkouts.length >= 6 || plannedDays >= 14;
  const consistency = consistencyReady && plannedWorkouts.length ? (completedPoints / plannedWorkouts.length) * 100 : null;

  let recentLogs = [];
  if (!DEMO_MODE) {
    const from = `${oldest7}T00:00:00Z`;
    recentLogs = await prodRows('manual_session_logs', `athlete_id=eq.${encodeURIComponent(athleteId)}&created_at=gte.${encodeURIComponent(from)}&select=*&order=created_at.asc`).catch(() => []);
  } else recentLogs = (demo.manual_logs || []).filter(item => item.athlete_id === athleteId && String(item.created_at || '').slice(0, 10) >= oldest7);

  const currentWellness = [...wellness].filter(item => item.metric_date <= snapshotDate).sort((a, b) => String(a.metric_date).localeCompare(String(b.metric_date))).at(-1) || null;
  const baselineRows = currentWellness ? wellness.filter(item => item.metric_date < currentWellness.metric_date).slice(-21) : wellness.slice(-21);
  const baseReadiness = currentWellness ? readinessForRow(currentWellness, baselineRows) : { score: 50, label: 'Sin datos suficientes', explanation: 'Faltan datos de recuperación.', baseline: {} };
  const feedback = feedbackAdjustment(recentLogs);
  const readinessScore = Math.round(clampNumber(Number(baseReadiness.score || 50) + feedback.delta, 0, 100));
  const readinessLabel = readinessScore >= 80 ? 'Muy buena disposición' : readinessScore >= 65 ? 'Buena, con control de carga' : readinessScore >= 45 ? 'Conviene revisar antes de entrenar' : 'Recuperación comprometida';
  const readinessReasons = [];
  if (baseReadiness.explanation && !String(baseReadiness.explanation).startsWith('Los indicadores')) readinessReasons.push(String(baseReadiness.explanation).replace(/^Factores principales:\s*/i, '').replace(/\.$/, ''));
  readinessReasons.push(...feedback.reasons);
  const readinessExplanation = readinessReasons.length ? `Factores principales: ${readinessReasons.join(', ')}.` : 'Los indicadores están cerca de la línea base individual.';

  const fit = fitnessIndexForRows(currentWellness, wellness);
  const avgRpe = average(recentLogs.map(item => item.rpe));
  const maxPainValues = recentLogs.map(item => Number(item.pain)).filter(Number.isFinite);
  const maxPain = maxPainValues.length ? Math.max(...maxPainValues) : null;
  const latestPain = [...recentLogs].reverse().find(item => Number(item.pain) > 0 && item.pain_area) || null;

  const currentSleepSec = optionalNumber(currentWellness?.sleep_sec);
  const sleepHours = currentSleepSec === null ? null : currentSleepSec / 3600;
  const baseline = baseReadiness.baseline || {};
  const dataSignals = [currentWellness, wellness.length >= 14, optionalNumber(currentWellness?.hrv) !== null, optionalNumber(currentWellness?.resting_hr) !== null, optionalNumber(sleepHours) !== null, activities.length >= 6, plannedWorkouts.length >= 3, recentLogs.length > 0];
  const quality = Math.round((dataSignals.filter(Boolean).length / dataSignals.length) * 100);

  const snapshot = {
    athlete_id: athleteId,
    snapshot_date: snapshotDate,
    readiness_score: readinessScore,
    readiness_label: readinessLabel,
    readiness_explanation: readinessExplanation,
    fitness_index: fit.index,
    fitness_label: fit.label,
    fitness_trend: fit.trend,
    fitness_change_28d: fit.change28,
    raw_fitness: roundOrNull(currentWellness?.fitness, 2),
    raw_fatigue: roundOrNull(currentWellness?.fatigue, 2),
    raw_form: roundOrNull(currentWellness?.form, 2),
    load_7d: sumActivityLoad(activities, oldest7, snapshotDate),
    load_28d: sumActivityLoad(activities, oldest28, snapshotDate),
    load_42d: sumActivityLoad(activities, oldest42, snapshotDate),
    planned_sessions_28d: plannedWorkouts.length,
    completed_sessions_28d: roundOrNull(completedPoints, 1) || 0,
    consistency_28d: roundOrNull(consistency, 1),
    avg_rpe_7d: roundOrNull(avgRpe, 1),
    max_pain_7d: roundOrNull(maxPain, 1),
    latest_pain_area: latestPain?.pain_area || null,
    hrv_current: roundOrNull(currentWellness?.hrv, 2),
    hrv_baseline: roundOrNull(baseline.hrv, 2),
    resting_hr_current: roundOrNull(currentWellness?.resting_hr, 1),
    resting_hr_baseline: roundOrNull(baseline.resting_hr, 1),
    sleep_hours: roundOrNull(sleepHours, 2),
    sleep_baseline_hours: roundOrNull(baseline.sleep_hours, 2),
    data_quality: quality,
    details: {
      method: 'runflow-performance-v2',
      fitness_metric: 'Intervals Aptitud/CTL; no es un porcentaje ni una medición clínica.',
      consistency_status: consistencyReady ? 'ready' : 'building',
      consistency_days: plannedDays,
      consistency_minimum: '14 días o 6 sesiones planificadas',
      activity_performance: activityPerformance,
      intervals_run_profile: runProfile,
      wellness_days: wellness.length,
      activity_count_90d: activities.length,
      feedback_count_7d: recentLogs.length,
    },
    calculated_at: new Date().toISOString(),
  };

  if (!DEMO_MODE) {
    await prodRows('performance_snapshots', 'on_conflict=athlete_id,snapshot_date', { method: 'POST', body: snapshot, prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  return snapshot;
}


async function backfillPerformanceHistory(athleteId, days = 84) {
  if (DEMO_MODE) return;
  const today = localDateInTimeZone();
  const oldest = addDays(today, -(Math.max(28, Math.min(120, Number(days) || 84)) - 1));
  const wellnessOldest = addDays(oldest, -35);
  let wellness = [];
  let activities = [];
  try { wellness = await syncRecovery(athleteId, wellnessOldest, today); }
  catch { wellness = await listRecoveryRows(athleteId, wellnessOldest, today); }
  try { activities = await syncActivities(athleteId, wellnessOldest, today); }
  catch { activities = await listStoredActivities(athleteId, wellnessOldest, today); }
  const targetRows = wellness.filter(row => row.metric_date >= oldest && row.metric_date <= today);
  const payload = [];
  for (const row of targetRows) {
    const prior = wellness.filter(item => item.metric_date < row.metric_date);
    const readiness = readinessForRow(row, prior.slice(-21));
    const fit = fitnessIndexForRows(row, wellness.filter(item => item.metric_date <= row.metric_date).slice(-90));
    const rowSleepSec = optionalNumber(row.sleep_sec);
    const sleepHours = rowSleepSec === null ? null : rowSleepSec / 3600;
    const signals = [prior.length >= 14, optionalNumber(row.hrv) !== null, optionalNumber(row.resting_hr) !== null, optionalNumber(sleepHours) !== null, activities.some(item => String(item.activity_date || '').slice(0, 10) <= row.metric_date)];
    payload.push({
      athlete_id: athleteId,
      snapshot_date: row.metric_date,
      readiness_score: readiness.score,
      readiness_label: readiness.label,
      readiness_explanation: readiness.explanation,
      fitness_index: fit.index,
      fitness_label: fit.label,
      fitness_trend: fit.trend,
      fitness_change_28d: fit.change28,
      raw_fitness: roundOrNull(row.fitness, 2),
      raw_fatigue: roundOrNull(row.fatigue, 2),
      raw_form: roundOrNull(row.form, 2),
      load_7d: sumActivityLoad(activities, addDays(row.metric_date, -6), row.metric_date),
      load_28d: sumActivityLoad(activities, addDays(row.metric_date, -27), row.metric_date),
      load_42d: sumActivityLoad(activities, addDays(row.metric_date, -41), row.metric_date),
      planned_sessions_28d: 0,
      completed_sessions_28d: 0,
      consistency_28d: null,
      avg_rpe_7d: null,
      max_pain_7d: null,
      latest_pain_area: null,
      hrv_current: roundOrNull(row.hrv, 2),
      hrv_baseline: roundOrNull(readiness.baseline?.hrv, 2),
      resting_hr_current: roundOrNull(row.resting_hr, 1),
      resting_hr_baseline: roundOrNull(readiness.baseline?.resting_hr, 1),
      sleep_hours: roundOrNull(sleepHours, 2),
      sleep_baseline_hours: roundOrNull(readiness.baseline?.sleep_hours, 2),
      data_quality: Math.round((signals.filter(Boolean).length / signals.length) * 75),
      details: { method: 'runflow-performance-v2-backfill', fitness_metric: 'Intervals Aptitud/CTL', historical_backfill: true },
      calculated_at: new Date().toISOString(),
    });
  }
  if (payload.length) await prodRows('performance_snapshots', 'on_conflict=athlete_id,snapshot_date', { method: 'POST', body: payload, prefer: 'resolution=merge-duplicates,return=minimal' });
}

async function performanceBundle(athleteId, days = 84, refresh = false) {
  const today = localDateInTimeZone();
  if (refresh && !DEMO_MODE) await dailyPerformanceSnapshot(athleteId, today, { forceActivityMetrics: true });
  const oldest = addDays(today, -(Math.max(14, Math.min(180, Number(days) || 84)) - 1));
  let rows = DEMO_MODE ? [] : await listPerformanceSnapshots(athleteId, oldest, today);
  if (!DEMO_MODE && rows.length < 7) {
    await backfillPerformanceHistory(athleteId, Math.max(28, Math.min(120, Number(days) || 84))).catch(() => {});
    if (refresh) await dailyPerformanceSnapshot(athleteId, today, { forceActivityMetrics: true });
    rows = await listPerformanceSnapshots(athleteId, oldest, today);
  }
  if (!rows.length && !DEMO_MODE) { const current = await dailyPerformanceSnapshot(athleteId, today); rows = [current]; }
  const latest = rows.at(-1) || null;
  const trajectory = await performanceTrajectoryForAthlete(athleteId, latest?.raw_fitness, today).catch(() => ({ goal: null, points: [], today_target: null, delta: null, status: 'Trayectoria no disponible' }));
  const activityMetrics = DEMO_MODE ? [] : await listActivityPerformanceMetrics(athleteId, addDays(today, -83), today).catch(() => []);
  const runProfile = DEMO_MODE ? null : await intervalsRunProfile(athleteId);
  return { latest, history: rows, trajectory, activity_metrics: activityMetrics, activity_summary: performanceActivitySummary(activityMetrics, runProfile), intervals_run_profile: runProfile };
}

let dailyPerformanceLastDate = '';
let dailyPerformanceRunning = false;
async function refreshAllPerformanceSnapshots(reason = 'timer') {
  if (DEMO_MODE || dailyPerformanceRunning) return;
  const today = localDateInTimeZone();
  if (dailyPerformanceLastDate === today) return;
  dailyPerformanceRunning = true;
  try {
    const athletes = await prodRows('athletes', 'intervals_status=eq.connected&lifecycle_status=eq.active&select=id,display_name&order=display_name.asc');
    for (const athlete of athletes) {
      try { await dailyPerformanceSnapshot(athlete.id, today); }
      catch (error) { console.error(`[daily-performance] ${athlete.display_name || athlete.id}: ${error.message}`); }
    }
    dailyPerformanceLastDate = today;
    console.log(`[daily-performance] ${today} actualizado (${reason})`);
  } finally { dailyPerformanceRunning = false; }
}

function maybeRefreshDailyPerformance(reason = 'request') {
  if (DEMO_MODE) return;
  const hour = localHourInTimeZone();
  const today = localDateInTimeZone();
  if (dailyPerformanceLastDate !== today && (hour >= Number(process.env.RUNFLOW_DAILY_REFRESH_HOUR || 5) || reason === 'request')) {
    refreshAllPerformanceSnapshots(reason).catch(error => console.error(`[daily-performance] ${error.message}`));
  }
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
      syncRecovery(athleteId, addDays(date, -21), date).catch(() => listRecoveryRows(athleteId, addDays(date, -21), date)),
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

  if (pathname === '/api/auth/magic-link' && method === 'POST') {
    const body = await readJson(req);
    const email = athleteAccessEmail(body.email);
    if (DEMO_MODE) {
      const athlete = demo.athletes.find(item => item.lifecycle_status !== 'inactive' && String(item.email || '').toLowerCase() === email);
      const user = athlete?.user_id ? demo.users.find(item => item.id === athlete.user_id && item.roles.includes('athlete')) : null;
      if (!user) return sendJson(res, 200, { ok: true, message: 'Si el correo pertenece a un deportista activo, recibirá un enlace de acceso.' });
      res.setHeader('Set-Cookie', cookie('rf_demo_user', user.id, { maxAge: 60 * 60 * 24 * 7 }));
      return sendJson(res, 200, { ok: true, demo: true, user: { id: user.id, email: user.email, display_name: user.display_name, roles: user.roles, athlete_id: user.athlete_id } });
    }
    const athletes = await prodRows('athletes', `email=ilike.${encodeURIComponent(email)}&lifecycle_status=eq.active&select=id,user_id&limit=2`);
    if (athletes.length === 1 && athletes[0].user_id) {
      const roles = await prodRows('user_roles', `user_id=eq.${encodeURIComponent(athletes[0].user_id)}&role=eq.athlete&select=role&limit=1`);
      if (roles.length) await authMagicLink(email);
    }
    return sendJson(res, 200, { ok: true, message: 'Si el correo pertenece a un deportista activo, recibirá un enlace para entrar en RunFlow Athlete.' });
  }

  if (pathname === '/api/auth/session' && method === 'POST') {
    if (DEMO_MODE) throw Object.assign(new Error('No disponible en modo demostración.'), { status: 400 });
    const body = await readJson(req);
    const accessToken = String(body.access_token || '');
    const refreshToken = String(body.refresh_token || '');
    if (!accessToken || !refreshToken) throw Object.assign(new Error('El enlace de acceso no es válido o ha caducado.'), { status: 400 });
    const user = await authUser(accessToken);
    const context = await prodUserContext(user.id);
    if (!context.roles.includes('athlete') || !context.athlete_id) throw Object.assign(new Error('Esta cuenta no está vinculada a un deportista activo.'), { status: 403 });
    res.setHeader('Set-Cookie', authCookies(accessToken, refreshToken, body.expires_in));
    return sendJson(res, 200, { ok: true, user: { id: user.id, email: user.email, display_name: user.user_metadata && user.user_metadata.display_name, ...context } });
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
    return sendJson(res, 200, { athletes: await listCoachAthletes(session, { includeInactive: url.searchParams.get('include_inactive') === '1', detailed: url.searchParams.get('details') === '1' }) });
  }

  if (pathname === '/api/coach/athletes' && method === 'POST') {
    requireRole(session, 'coach');
    return sendJson(res, 201, { athlete: await createCoachAthlete(session, await readJson(req)) });
  }

  const inviteAthleteMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/invite$/);
  if (inviteAthleteMatch && method === 'POST') {
    return sendJson(res, 200, await inviteAthleteUser(session, inviteAthleteMatch[1]));
  }

  const athleteStatusMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/status$/);
  if (athleteStatusMatch && method === 'PATCH') {
    requireRole(session, 'coach');
    const body = await readJson(req);
    return sendJson(res, 200, { athlete: await setAthleteLifecycle(session, athleteStatusMatch[1], body.status) });
  }

  const athleteMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)$/);
  if (athleteMatch && method === 'GET') {
    const athleteId = athleteMatch[1];
    await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { athlete: DEMO_MODE ? await demoAthleteBundle(athleteId) : await prodAthleteBundle(athleteId, url.searchParams.get('week_start') || startOfWeek()) });
  }



  const templatesMatch = pathname.match(/^\/api\/coach\/templates$/);
  if (templatesMatch && method === 'GET') {
    requireRole(session, 'coach');
    const athleteId = sanitiseText(url.searchParams.get('athlete_id'), 80) || null;
    if (athleteId) await ensureCoachAccess(session, athleteId);
    return sendJson(res, 200, { templates: await listWorkoutTemplates(session, athleteId) });
  }
  if (templatesMatch && method === 'POST') {
    requireRole(session, 'coach');
    return sendJson(res, 201, { template: await createWorkoutTemplate(session, await readJson(req)) });
  }
  const templateDeleteMatch = pathname.match(/^\/api\/coach\/templates\/([^/]+)$/);
  if (templateDeleteMatch && method === 'DELETE') {
    requireRole(session, 'coach');
    await deleteWorkoutTemplate(session, templateDeleteMatch[1]);
    return sendJson(res, 200, { ok: true });
  }

  const calendarMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/calendar$/);
  if (calendarMatch && method === 'GET') {
    const athleteId = calendarMatch[1];
    await ensureCoachAccess(session, athleteId);
    const { oldest, newest } = dateRangeParams(url, 70);
    return sendJson(res, 200, { weeks: await listCalendarWeeks(athleteId, oldest, newest, url.searchParams.get('sync') === '1'), oldest, newest });
  }

  const profileMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/profile$/);
  if (profileMatch && method === 'PUT') {
    const athleteId = profileMatch[1];
    await ensureCoachAccess(session, athleteId);
    const body = await readJson(req);
    return sendJson(res, 200, { athlete: await saveProfile(athleteId, body) });
  }

  const loadToleranceMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/load-tolerance$/);
  if (loadToleranceMatch && method === 'GET') {
    const athleteId = loadToleranceMatch[1];
    await ensureCoachAccess(session, athleteId);
    const weeks = Math.max(4, Math.min(24, Number(url.searchParams.get('weeks') || 12)));
    const sync = url.searchParams.get('sync') === '1';
    return sendJson(res, 200, await loadToleranceSnapshot(athleteId, weeks, sync));
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

    let previousWorkouts = [];
    if (!DEMO_MODE) {
      const previousWeeks = await prodRows(
        'training_weeks',
        `athlete_id=eq.${encodeURIComponent(athleteId)}&week_start=eq.${weekStart}&select=id&limit=1`
      );
      if (previousWeeks[0]) {
        previousWorkouts = await prodRows(
          'workouts',
          `training_week_id=eq.${encodeURIComponent(previousWeeks[0].id)}&select=*`
        );
      }
    }

    let week = await saveWeek(athleteId, body, true);
    const savedIds = new Set((week.workouts || []).map(item => String(item.id)));
    const deletedWorkouts = previousWorkouts.filter(item => !savedIds.has(String(item.id)));
    const intervals = await syncWeekToIntervals(athleteId, week, deletedWorkouts);

    if (!DEMO_MODE && week.id) {
      const refreshed = await prodRows(
        'workouts',
        `training_week_id=eq.${encodeURIComponent(week.id)}&select=*&order=workout_date.asc`
      );
      week = { ...week, workouts: refreshed };
    }
    return sendJson(res, 200, { week, intervals, already_published: alreadyPublished });
  }

  const intervalsPreviewMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/intervals-preview$/);
  if (intervalsPreviewMatch && method === 'POST') {
    const athleteId = intervalsPreviewMatch[1];
    await ensureCoachAccess(session, athleteId);
    const body = await readJson(req);
    const source = Array.isArray(body.workouts) ? body.workouts : (body.workout ? [body.workout] : []);
    const weekStart = validDate(body.week_start) || startOfWeek();
    const workouts = source.slice(0, 30).map((item, index) => normaliseWorkout(item, athleteId, weekStart, index));
    await assertWorkoutsFitAvailability(athleteId, workouts);
    const events = workouts.map(buildIntervalsEvent).filter(Boolean);
    return sendJson(res, 200, { events });
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



  const performanceMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/performance$/);
  if (performanceMatch && method === 'GET') {
    const athleteId = performanceMatch[1];
    await ensureCoachAccess(session, athleteId);
    const refresh = url.searchParams.get('refresh') === '1';
    return sendJson(res, 200, await performanceBundle(athleteId, url.searchParams.get('days') || 84, refresh));
  }
  const performanceTrajectoryMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/performance-trajectory$/);
  if (performanceTrajectoryMatch && method === 'PUT') {
    const athleteId = performanceTrajectoryMatch[1];
    await ensureCoachAccess(session, athleteId);
    const goal = await savePerformanceTrajectory(athleteId, await readJson(req));
    return sendJson(res, 200, { goal, trajectory: await performanceTrajectoryForAthlete(athleteId, null) });
  }

  const activityOriginalMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/activities\/([^/]+)\/original-file$/);
  if (activityOriginalMatch && method === 'GET') {
    const athleteId = activityOriginalMatch[1];
    const externalId = decodeURIComponent(activityOriginalMatch[2]);
    await ensureCoachAccess(session, athleteId);
    const file = await originalActivityDownload(athleteId, externalId);
    return sendBuffer(res, 200, file.buffer, file.content_type, file.filename);
  }

  const activityPackageMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/activities\/([^/]+)\/analysis-package$/);
  if (activityPackageMatch && method === 'GET') {
    const athleteId = activityPackageMatch[1];
    const externalId = decodeURIComponent(activityPackageMatch[2]);
    await ensureCoachAccess(session, athleteId);
    const file = await activityAnalysisPackage(session, athleteId, externalId);
    return sendBuffer(res, 200, file.buffer, 'application/zip', file.filename);
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


  const coachMessagesMatch = pathname.match(/^\/api\/coach\/athletes\/([^/]+)\/messages$/);
  if (coachMessagesMatch && method === 'GET') {
    const athleteId = coachMessagesMatch[1];
    await ensureCoachAccess(session, athleteId);
    const result = await listAthleteMessages(athleteId, session.user.id, 'coach', url.searchParams.get('limit') || 100, url.searchParams.get('mark_read') === '1');
    return sendJson(res, 200, result);
  }
  if (coachMessagesMatch && method === 'POST') {
    const athleteId = coachMessagesMatch[1];
    await ensureCoachAccess(session, athleteId);
    const body = await readJson(req);
    const item = await createAthleteMessage({ athleteId, coachUserId: session.user.id, senderUserId: session.user.id, senderRole: 'coach', workoutId: body.workout_id, message: body.message });
    return sendJson(res, 201, { message: item });
  }

  if (pathname === '/api/athlete/messages' && method === 'GET') {
    requireRole(session, 'athlete');
    if (!session.athlete_id) throw Object.assign(new Error('Tu usuario todavía no está vinculado a una ficha de deportista.'), { status: 409 });
    const coachUserId = await primaryCoachForAthlete(session.athlete_id);
    if (!coachUserId) return sendJson(res, 200, { messages: [], unread: 0 });
    const result = await listAthleteMessages(session.athlete_id, coachUserId, 'athlete', url.searchParams.get('limit') || 100, url.searchParams.get('mark_read') === '1');
    return sendJson(res, 200, result);
  }
  if (pathname === '/api/athlete/messages' && method === 'POST') {
    requireRole(session, 'athlete');
    if (!session.athlete_id) throw Object.assign(new Error('Tu usuario todavía no está vinculado a una ficha de deportista.'), { status: 409 });
    const coachUserId = await primaryCoachForAthlete(session.athlete_id);
    if (!coachUserId) throw Object.assign(new Error('No hay un entrenador vinculado a tu perfil.'), { status: 409 });
    const body = await readJson(req);
    const item = await createAthleteMessage({ athleteId: session.athlete_id, coachUserId, senderUserId: session.user.id, senderRole: 'athlete', workoutId: body.workout_id, message: body.message });
    return sendJson(res, 201, { message: item });
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


  if (pathname === '/api/athlete/performance' && method === 'GET') {
    requireRole(session, 'athlete');
    if (!session.athlete_id) throw Object.assign(new Error('Tu usuario todavía no está vinculado a una ficha de deportista.'), { status: 409 });
    return sendJson(res, 200, await performanceBundle(session.athlete_id, url.searchParams.get('days') || 84, url.searchParams.get('refresh') === '1'));
  }

  if (pathname === '/api/athlete/dashboard' && method === 'GET') {
    requireRole(session, 'athlete');
    maybeRefreshDailyPerformance('request');
    if (!session.athlete_id) throw Object.assign(new Error('Tu usuario todavía no está vinculado a una ficha de deportista.'), { status: 409 });
    const weekStart = url.searchParams.get('week_start') || startOfWeek();
    const athlete = DEMO_MODE ? await demoAthleteBundle(session.athlete_id) : await prodAthleteBundle(session.athlete_id, weekStart);
    if (athlete.week && athlete.week.status === 'published') {
      try {
        const decorated = await listCalendarWeeks(session.athlete_id, weekStart, addDays(weekStart, 6), false);
        const published = decorated.find(item => item.week_start === weekStart && item.status === 'published');
        if (published) athlete.week = published;
      } catch (error) {
        console.error(`[athlete-dashboard] semana decorada: ${error.message}`);
      }
    } else athlete.week = null;
    return sendJson(res, 200, { athlete });
  }

  if (pathname === '/api/athlete/manual-log' && method === 'POST') {
    requireRole(session, 'athlete');
    const body = await readJson(req);
    const log = {
      id: crypto.randomUUID(), athlete_id: session.athlete_id, workout_id: sanitiseText(body.workout_id, 80) || null,
      status: ['completed', 'partial', 'skipped'].includes(body.status) ? body.status : 'completed',
      actual_duration_min: numberOrNull(body.actual_duration_min, 0, 1000), rpe: numberOrNull(body.rpe, 1, 10), pain: numberOrNull(body.pain, 0, 10),
      feeling: ['muy_bien', 'bien', 'normal', 'mal'].includes(body.feeling) ? body.feeling : null, pain_area: sanitiseText(body.pain_area, 180) || null,
      comment: sanitiseText(body.comment, 2000), created_at: new Date().toISOString(),
    };
    if (DEMO_MODE) { demo.manual_logs.push(log); saveDemo(); }
    else await prodRows('manual_session_logs', '', { method: 'POST', body: log });
    if (!DEMO_MODE) dailyPerformanceSnapshot(session.athlete_id, localDateInTimeZone()).catch(() => {});
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

setTimeout(() => maybeRefreshDailyPerformance('startup'), 12000);
setInterval(() => maybeRefreshDailyPerformance('timer'), 30 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`RunFlow ${APP_VERSION} · ${DEMO_MODE ? 'MODO DEMO' : 'ONLINE'} · ${APP_BASE_URL}`);
});
