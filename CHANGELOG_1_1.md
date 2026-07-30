import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  for (const filename of ['.env', '.env.local']) {
    const file = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index < 0) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  }
}
loadEnv();

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const APP_BASE_URL = String(process.env.APP_BASE_URL || '').replace(/\/$/, '');
const COACH_EMAIL = String(process.env.COACH_EMAIL || 'urtzi@suibroker.es').toLowerCase();
const COACH_NAME = String(process.env.COACH_NAME || 'Urtzi');
const SECOND_ATHLETE_NAME = String(process.env.SECOND_ATHLETE_NAME || 'Ibon Larrinaga');
const SECOND_ATHLETE_EMAIL = String(process.env.SECOND_ATHLETE_EMAIL || 'larri_hc@hotmail.es').toLowerCase();

if (!SUPABASE_URL || !SERVICE_KEY || !APP_BASE_URL) {
  console.error('Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o APP_BASE_URL.');
  process.exit(1);
}

async function call(endpoint, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${endpoint}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function findUser(email) {
  for (let page = 1; page <= 20; page += 1) {
    const data = await call(`/auth/v1/admin/users?page=${page}&per_page=100`);
    const users = Array.isArray(data.users) ? data.users : [];
    const found = users.find(user => String(user.email || '').toLowerCase() === email);
    if (found) return found;
    if (users.length < 100) break;
  }
  return null;
}

async function ensureCoachUser() {
  let user = await findUser(COACH_EMAIL);
  if (user) return user;
  console.log(`Enviando invitación de coach a ${COACH_EMAIL}...`);
  return call('/auth/v1/invite', {
    method: 'POST',
    body: JSON.stringify({
      email: COACH_EMAIL,
      data: { display_name: COACH_NAME },
      redirect_to: `${APP_BASE_URL}/activate`,
    }),
  });
}

async function rest(table, query = '', options = {}) {
  return call(`/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method: options.method || 'GET',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: { Prefer: options.prefer || (options.method && options.method !== 'GET' ? 'return=representation' : '') },
  });
}

async function ensureProfile(user, displayName) {
  await rest('profiles', 'on_conflict=id', {
    method: 'POST',
    body: { id: user.id, email: user.email, display_name: displayName, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}

async function ensureRole(userId, role) {
  await rest('user_roles', 'on_conflict=user_id,role', {
    method: 'POST',
    body: { user_id: userId, role },
    prefer: 'resolution=ignore-duplicates,return=minimal',
  });
}

async function ensureAthlete({ userId = null, email, displayName, watchBrand = '', watchModel = '', intervalsStatus = 'pending' }) {
  const existing = await rest('athletes', `email=eq.${encodeURIComponent(email)}&select=*`);
  let athlete;
  if (existing.length) {
    const updated = await rest('athletes', `id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: { user_id: userId, display_name: displayName, intervals_status: intervalsStatus, updated_at: new Date().toISOString() },
    });
    athlete = updated[0];
  } else {
    const created = await rest('athletes', '', {
      method: 'POST',
      body: { user_id: userId, display_name: displayName, email, intervals_status: intervalsStatus },
    });
    athlete = created[0];
  }
  await rest('athlete_profiles', 'on_conflict=athlete_id', {
    method: 'POST',
    body: {
      athlete_id: athlete.id,
      watch_brand: watchBrand,
      watch_model: watchModel,
      custom_fields: [],
      availability: {},
      updated_at: new Date().toISOString(),
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return athlete;
}

async function ensureCoachLink(coachId, athleteId) {
  await rest('coach_athletes', 'on_conflict=coach_user_id,athlete_id', {
    method: 'POST',
    body: { coach_user_id: coachId, athlete_id: athleteId },
    prefer: 'resolution=ignore-duplicates,return=minimal',
  });
}

function monday() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

async function ensureInitialWeek(athleteId) {
  const weekStart = monday();
  await rest('training_weeks', 'on_conflict=athlete_id,week_start', {
    method: 'POST',
    body: {
      athlete_id: athleteId,
      week_start: weekStart,
      week_type: 'Planificación inicial',
      title: 'Primera semana del piloto',
      coach_comment: 'Semana pendiente de completar desde la web del coach.',
      target_load: 0,
      status: 'draft',
      updated_at: new Date().toISOString(),
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  await rest('daily_metrics', 'on_conflict=athlete_id,metric_date', {
    method: 'POST',
    body: {
      athlete_id: athleteId,
      metric_date: new Date().toISOString().slice(0, 10),
      fitness: 0,
      fatigue: 0,
      form: 0,
      week_load: 0,
      planned_load: 0,
      readiness_score: 50,
      readiness_label: 'Sin datos suficientes',
      source: 'runflow',
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}

const coach = await ensureCoachUser();
await ensureProfile(coach, COACH_NAME);
await ensureRole(coach.id, 'coach');
await ensureRole(coach.id, 'athlete');

const urtziAthlete = await ensureAthlete({
  userId: coach.id,
  email: COACH_EMAIL,
  displayName: COACH_NAME,
  watchBrand: 'Garmin',
  watchModel: 'Fénix 5',
});

// Ibon se crea como ficha gestionable, pero sin acceso a la app todavía.
const ibonAthlete = await ensureAthlete({
  userId: null,
  email: SECOND_ATHLETE_EMAIL,
  displayName: SECOND_ATHLETE_NAME,
  watchBrand: 'Suunto',
  watchModel: 'Suunto Run',
});

for (const athlete of [urtziAthlete, ibonAthlete]) {
  await ensureCoachLink(coach.id, athlete.id);
  await ensureInitialWeek(athlete.id);
}

console.log('RunFlow Online Pilot inicializado correctamente.');
console.log(`Coach invitado: ${COACH_EMAIL}`);
console.log(`Perfil sin acceso a app: ${SECOND_ATHLETE_NAME} (${SECOND_ATHLETE_EMAIL})`);
console.log('Ibon podrá recibir su invitación más adelante desde Conexiones > Acceso a la app.');
