'use strict';

// RunFlow V9 / Athlete V2 isolated API layer.
// Loaded before server.js. It only handles /api/v9/* and /api/v2/* routes.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const APP_ENCRYPTION_KEY = String(process.env.APP_ENCRYPTION_KEY || '');
const INTERVALS_API_BASE = 'https://intervals.icu/api/v1';
const IS_PROD = process.env.NODE_ENV === 'production';
const DEMO_MODE = process.env.DEMO_MODE === '1';
const DATA_DIR = path.join(__dirname, 'data');
const BANNER_FIELD = 'RUNFLOW_MOTIVATION_BANNER';
const LOAD_HISTORY_FIELD = 'RUNFLOW_MAX_LOAD_HISTORY';

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
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
    if (body.length > 2_000_000) throw Object.assign(new Error('Solicitud demasiado grande.'), { status: 413 });
  }
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('JSON no válido.'), { status: 400 }); }
}
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const msg = data && typeof data === 'object' ? (data.message || data.error_description || data.error || data.details) : data;
    throw Object.assign(new Error(msg || `HTTP ${response.status}`), { status: response.status, details: data });
  }
  return data;
}
async function sb(table, query = '', options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw Object.assign(new Error('Supabase no está configurado.'), { status: 503 });
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.prefer ? { Prefer: options.prefer } : {}),
  };
  return fetchJson(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}
async function authUser(access) {
  return fetchJson(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${access}` } });
}
async function authRefresh(refresh) {
  return fetchJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }),
  });
}
async function requireSession(req, res) {
  const cookies = parseCookies(req);
  let access = cookies.rf_access, refresh = cookies.rf_refresh;
  if (!access) throw Object.assign(new Error('Debes iniciar sesión.'), { status: 401 });
  let user;
  try { user = await authUser(access); }
  catch {
    if (!refresh) throw Object.assign(new Error('Debes iniciar sesión.'), { status: 401 });
    const renewed = await authRefresh(refresh);
    access = renewed.access_token; refresh = renewed.refresh_token || refresh;
    user = renewed.user || await authUser(access);
    res.setHeader('Set-Cookie', [cookie('rf_access', access, Math.max(60, Number(renewed.expires_in) || 3600)), cookie('rf_refresh', refresh, 60 * 60 * 24 * 30)]);
  }
  const roles = await sb('user_roles', `user_id=eq.${encodeURIComponent(user.id)}&select=role`);
  const athletes = await sb('athletes', `user_id=eq.${encodeURIComponent(user.id)}&lifecycle_status=eq.active&select=id&limit=1`);
  return { user, roles: roles.map(r => r.role), athlete_id: athletes[0]?.id || null };
}
function requireRole(session, role) {
  if (!session.roles.includes(role)) throw Object.assign(new Error('No tienes permiso para realizar esta acción.'), { status: 403 });
}
async function ensureCoachAccess(session, athleteId) {
  requireRole(session, 'coach');
  const rows = await sb('coach_athletes', `coach_user_id=eq.${encodeURIComponent(session.user.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=athlete_id&limit=1`);
  if (!rows.length) throw Object.assign(new Error('No tienes acceso a este deportista.'), { status: 403 });
}
function safeText(v, max = 2000) { return String(v ?? '').trim().slice(0, max); }
function num(v, min = -Infinity, max = Infinity) { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; }
function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null; }
function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function localDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.RUNFLOW_TIMEZONE || 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function safeObj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

function encryptionKey() {
  if (!APP_ENCRYPTION_KEY || APP_ENCRYPTION_KEY.length < 24) return null;
  try { const raw = Buffer.from(APP_ENCRYPTION_KEY, 'base64'); if (raw.length === 32) return raw; } catch {}
  return crypto.createHash('sha256').update(APP_ENCRYPTION_KEY, 'utf8').digest();
}
function decryptSecret(record) {
  const key = encryptionKey(); if (!key || !record) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.secret_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.secret_tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.secret_ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
async function intervalsKey(athleteId) {
  const rows = await sb('athlete_integrations', `athlete_id=eq.${encodeURIComponent(athleteId)}&provider=eq.intervals&select=*&limit=1`).catch(() => []);
  return rows[0] ? decryptSecret(rows[0]) : null;
}
async function intervalsFetch(apiKey, endpoint, options = {}) {
  return fetchJson(`${INTERVALS_API_BASE}${endpoint}`, {
    ...options,
    headers: { Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
}

let libraryCache = null;
function loadLibrary() {
  if (libraryCache) return libraryCache;
  const single = path.join(DATA_DIR, 'runflow-v9-library.b64');
  let encoded = '';
  if (fs.existsSync(single)) encoded = fs.readFileSync(single, 'utf8').trim();
  else {
    const candidates = fs.readdirSync(DATA_DIR).filter(n => /^runflow-v9-library\.part\d+\.b64$/.test(n)).sort((a,b) => Number(a.match(/part(\d+)/)[1]) - Number(b.match(/part(\d+)/)[1]));
    encoded = candidates.map(n => fs.readFileSync(path.join(DATA_DIR, n), 'utf8').trim()).join('');
  }
  if (!encoded) throw Object.assign(new Error('Biblioteca V9 no disponible.'), { status: 503 });
  const raw = zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
  const compact = JSON.parse(raw);
  const keyMap = { i:'ID',n:'Nombre',d:'Disciplina',f:'Familia',o:'Objetivo_primario',ph:'Fases',g:'Objetivos_prueba',lv:'Nivel_1_5',tm:'Tiempo_total_min',wu:'Calentamiento',bp:'Bloque_principal',cd:'Vuelta_calma',int:'Intensidad_prescrita',r:'RPE_sesion_estimado',ter:'Terreno',e:'Desnivel_requerido',mat:'Material',rec:'Recuperacion_recomendada_h',pr:'Progresion_anterior_ID',nx:'Progresion_siguiente_ID',cg:'Grupo_comparacion',cmp:'Comparabilidad',sel:'Condiciones_seleccion',no:'No_usar_si',ok:'Criterio_exito',adj:'Regla_ajuste',l:'Carga_sRPE_est',lr:'Carga_relativa_1_5' };
  libraryCache = { version: 'Biblioteca RunFlow de Sesiones v1', sessions: (compact.s || []).map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [keyMap[k] || k, v]))) };
  return libraryCache;
}

function activityDurationMin(a) {
  const sec = num(a.duration_sec, 0); if (sec !== null) return sec / 60;
  const km = num(a.distance_m, 0) !== null ? Number(a.distance_m) / 1000 : null;
  const speed = activitySpeedKmh(a); return km && speed ? (km / speed) * 60 : null;
}
function activitySpeedKmh(a) {
  const raw = safeObj(a.raw_summary);
  const mps = num(raw.average_speed, 0) ?? num(raw.avg_speed, 0);
  if (mps !== null && mps > 0) return mps * 3.6;
  const km = num(a.distance_m, 0) !== null ? Number(a.distance_m) / 1000 : null;
  const min = num(a.duration_sec, 0) !== null ? Number(a.duration_sec) / 60 : null;
  return km && min ? km / (min / 60) : null;
}
function isBike(a) { return /ride|bike|cycling|virtualride|ebike/i.test(String(a.sport || safeObj(a.raw_summary).type || '')); }
async function pairedSrpeRatios(athleteId,sport){
  const logs=await sb('manual_session_logs',`athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=not.is.null&rpe=not.is.null&actual_duration_min=gt.0&select=workout_id,rpe,actual_duration_min&order=created_at.desc&limit=120`).catch(()=>[]);
  if(!logs.length)return[];
  const ids=[...new Set(logs.map(x=>x.workout_id).filter(Boolean))];
  const [activities,workouts]=await Promise.all([
    sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=in.(${ids.join(',')})&load=gt.0&select=workout_id,load,sport`).catch(()=>[]),
    sb('workouts',`athlete_id=eq.${encodeURIComponent(athleteId)}&id=in.(${ids.join(',')})&select=id,sport`).catch(()=>[]),
  ]);
  const wk=new Map(workouts.map(x=>[String(x.id),sportKey(x.sport)]));
  const byWorkout=new Map();activities.forEach(x=>{if(!byWorkout.has(String(x.workout_id)))byWorkout.set(String(x.workout_id),[]);byWorkout.get(String(x.workout_id)).push(x)});
  const ratios=[];
  logs.forEach(log=>{const key=String(log.workout_id);if(sport&&wk.get(key)!==sport)return;const load=(byWorkout.get(key)||[]).reduce((sum,x)=>sum+Number(x.load||0),0);const srpe=Number(log.actual_duration_min||0)*Number(log.rpe||0);if(load>0&&srpe>0)ratios.push(load/srpe);});
  return ratios;
}
function percentile(values,p){const a=(values||[]).map(Number).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;if(a.length===1)return a[0];const pos=(a.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo);}
function clamp(v,min,max){return Math.min(max,Math.max(min,v));}
function sportKey(value){const v=String(value||'').toLowerCase();if(/ride|bike|cycling|bici/.test(v))return'bike';if(/trail/.test(v))return'trail';if(/run|carrera/.test(v))return'run';if(/strength|weight|fuerza/.test(v))return'strength';if(/walk|hike|paseo|sender/.test(v))return'walk';return'other';}
async function estimateManualLoad(athleteId,payload){
  const duration=num(payload.duration_min,1,2000),rpe=num(payload.rpe,1,10),sport=sportKey(payload.sport);
  if(duration===null||rpe===null)return{load:null,source:'insufficient',confidence:'none',explanation:'Faltan duración o RPE.'};
  const srpe=duration*rpe;
  const ratios=await pairedSrpeRatios(athleteId,sport);
  if(ratios.length>=3){const ratio=percentile(ratios,0.35);return{load:Math.max(1,Math.round(srpe*ratio)),srpe,source:'estimated_athlete_srpe',confidence:ratios.length>=8?'high':'medium',samples:ratios.length,explanation:'Estimación calibrada con sesiones del mismo deportista que tienen RPE y carga objetiva.'};}
  const recent=await sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&load=gt.0&select=load,duration_sec,sport&order=activity_date.desc&limit=120`).catch(()=>[]);
  const perMin=recent.filter(x=>sportKey(x.sport)===sport&&Number(x.duration_sec)>0).map(x=>Number(x.load)/(Number(x.duration_sec)/60)).filter(x=>Number.isFinite(x)&&x>0);
  if(perMin.length>=3){const base=percentile(perMin,0.25);const intensity=clamp(0.75+(rpe-5)*0.06,0.55,1.05);return{load:Math.max(1,Math.round(duration*base*intensity)),srpe,source:'estimated_athlete_sport_history',confidence:perMin.length>=8?'medium':'low',samples:perMin.length,explanation:'Estimación conservadora con el cuartil bajo de carga/minuto del mismo deporte y ajuste moderado por RPE.'};}
  return{load:Math.max(1,Math.round(srpe/10)),srpe,source:'estimated_conservative_fallback',confidence:'low',samples:0,explanation:'Estimación provisional conservadora mientras RunFlow reúne historial propio del atleta.'};
}
function similarity(a,b){const terms=[];const da=activityDurationMin(a),db=activityDurationMin(b);if(da&&db)terms.push(Math.abs(Math.log(da/db)));const xa=Number(a.distance_m||0),xb=Number(b.distance_m||0);if(xa>0&&xb>0)terms.push(Math.abs(Math.log(xa/xb)));const sa=activitySpeedKmh(a),sb=activitySpeedKmh(b);if(sa&&sb)terms.push(Math.abs(Math.log(sa/sb)));const ea=Number(a.elevation_gain_m||0),eb=Number(b.elevation_gain_m||0),kma=xa/1000,kmb=xb/1000;if(kma>0&&kmb>0&&(ea>0||eb>0))terms.push(Math.abs(Math.log((1+ea/kma)/(1+eb/kmb))));return terms.length?terms.reduce((sum,x)=>sum+x,0)/terms.length:999;}
async function estimateZeroImportedLoad(athleteId,row,history=null){
  const sport=sportKey(row.sport),duration=activityDurationMin(row);
  if(!duration)return{load:null,source:'insufficient',confidence:'none',explanation:'Actividad sin duración suficiente.'};
  const sourceRows=history||await sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&load=gt.0&select=id,load,duration_sec,distance_m,elevation_gain_m,sport,activity_date&order=activity_date.desc&limit=200`).catch(()=>[]);
  const candidates=sourceRows.filter(x=>sportKey(x.sport)===sport&&Number(x.duration_sec)>0&&String(x.id)!==String(row.id)).map(x=>({...x,_score:similarity(row,x)})).sort((a,b)=>a._score-b._score).slice(0,7);
  if(candidates.length>=3){const perHour=candidates.map(x=>Number(x.load)/(Number(x.duration_sec)/3600)).filter(x=>Number.isFinite(x)&&x>0);const conservative=percentile(perHour,0.35);return{load:Math.max(1,Math.round(conservative*(duration/60)*0.95)),source:'estimated_comparable_history',confidence:candidates.length>=5?'medium':'low',samples:candidates.length,explanation:'Estimación con actividades comparables del mismo deporte. Duración, distancia, desnivel relativo y velocidad media intervienen en la selección; se aplica un sesgo conservador.'};}
  const speed=activitySpeedKmh(row)||0,km=Number(row.distance_m||0)/1000,elev=Number(row.elevation_gain_m||0),density=km>0?elev/km:0;
  let perMin=0.25;if(sport==='bike')perMin=0.28+clamp((speed-12)/60,0,0.32)+clamp(density/300,0,0.12);else if(sport==='walk')perMin=0.16+clamp((speed-3)/25,0,0.12)+clamp(density/450,0,0.10);else if(sport==='run'||sport==='trail')perMin=0.38+clamp((speed-7)/35,0,0.22)+clamp(density/300,0,0.15);else if(sport==='strength')perMin=0.35;
  return{load:Math.max(1,Math.round(duration*clamp(perMin,0.15,0.85))),source:'estimated_conservative_activity',confidence:'low',samples:candidates.length,explanation:'Estimación conservadora de respaldo basada en duración, velocidad media, distancia y densidad de desnivel. Se sustituirá cuando exista una carga objetiva o mejor calibración.'};
}
async function reconcileAndEstimateLoads(athleteId){
  const rows=await athleteActivities(athleteId,null,null);const imported=rows.filter(x=>!String(x.intervals_activity_id||'').startsWith('runflow-manual-'));const manual=rows.filter(x=>String(x.intervals_activity_id||'').startsWith('runflow-manual-'));let deduplicated=0,estimated=0;
  for(const m of manual){const md=safeObj(m.raw_summary).runflow_manual||safeObj(m.raw_summary);const same=imported.find(x=>{if(String(x.activity_date||'').slice(0,10)!==String(m.activity_date||'').slice(0,10))return false;if(sportKey(x.sport)!==sportKey(m.sport))return false;const dm=activityDurationMin(m),di=activityDurationMin(x);if(dm&&di&&Math.abs(dm-di)>Math.max(8,dm*0.15))return false;const manualKm=Number(md.distance_km||0),importKm=Number(x.distance_m||0)/1000;if(manualKm>0&&importKm>0&&Math.abs(manualKm-importKm)>Math.max(1,manualKm*0.2))return false;return true;});if(same){await sb('activities',`id=eq.${encodeURIComponent(m.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,{method:'DELETE',prefer:'return=minimal'}).catch(()=>[]);deduplicated++;}}
  const after=deduplicated?await athleteActivities(athleteId,null,null):rows;const history=after.filter(x=>Number(x.load)>0);
  for(const row of after){if(Number(row.load)>0||String(row.intervals_activity_id||'').startsWith('runflow-manual-'))continue;const estimate=await estimateZeroImportedLoad(athleteId,row,history);if(estimate.load===null)continue;const raw=safeObj(row.raw_summary);await sb('activities',`id=eq.${encodeURIComponent(row.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,{method:'PATCH',body:{load:estimate.load,raw_summary:{...raw,runflow_load:{...estimate,original_imported_load:Number(row.load||0),estimated_at:new Date().toISOString()}}},prefer:'return=minimal'}).catch(()=>[]);row.load=estimate.load;history.push(row);estimated++;}
  return{deduplicated,estimated};
}
function effectiveLoad(a) {
  const raw = Number(a.load || 0);
  if (raw > 0) return { load: raw, source: 'imported', confidence: 'high' };
  if (isBike(a)) {
    const est = conservativeZeroLoad(a);
    if (est !== null) return { load: est, source: 'runflow_estimated_zero_load', confidence: 'low' };
  }
  const summary = safeObj(a.raw_summary);
  if (summary.runflow_estimated_load > 0) return { load: Number(summary.runflow_estimated_load), source: 'runflow_estimated_manual', confidence: summary.runflow_load_confidence || 'low' };
  return { load: 0, source: raw === 0 ? 'zero_unestimated' : 'missing', confidence: 'low' };
}
async function athleteActivities(athleteId, oldest, newest) {
  const query = [`athlete_id=eq.${encodeURIComponent(athleteId)}`];
  if (oldest) query.push(`activity_date=gte.${encodeURIComponent(oldest)}`);
  if (newest) query.push(`activity_date=lte.${encodeURIComponent(`${newest}T23:59:59`)}`);
  query.push('select=*','order=activity_date.asc');
  return sb('activities', query.join('&'));
}
function computeLoadMetrics(activities, endDate = localDate()) {
  const byDate = new Map();
  for (const a of activities) {
    const d = String(a.activity_date || '').slice(0,10); if (!validDate(d)) continue;
    const eff = effectiveLoad(a); byDate.set(d, (byDate.get(d) || 0) + Number(eff.load || 0));
  }
  const dates = [...byDate.keys()].sort();
  const start = dates[0] || addDays(endDate, -180);
  let fitness = 0, fatigue = 0;
  const wf = Math.exp(-1/42), wa = Math.exp(-1/7);
  const history = [];
  for (let d = start; d <= endDate; d = addDays(d,1)) {
    const load = byDate.get(d) || 0;
    fitness = fitness * wf + load * (1-wf);
    fatigue = fatigue * wa + load * (1-wa);
    history.push({ date:d, load:Math.round(load*10)/10, fitness:Math.round(fitness*100)/100, fatigue:Math.round(fatigue*100)/100, form:Math.round((fitness-fatigue)*100)/100 });
  }
  return { latest: history.at(-1) || { date:endDate,load:0,fitness:0,fatigue:0,form:0 }, history };
}

function customFieldGet(fields, label) {
  const row = (Array.isArray(fields) ? fields : []).find(x => x && x.label === label);
  if (!row) return null; try { return JSON.parse(row.value); } catch { return row.value; }
}
function customFieldSet(fields, label, value) {
  const rows = Array.isArray(fields) ? fields.filter(x => x && x.label !== label) : [];
  rows.push({ label, value: typeof value === 'string' ? value : JSON.stringify(value) }); return rows.slice(0,50);
}
async function profileRow(athleteId) {
  const rows = await sb('athlete_profiles', `athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`); return rows[0] || null;
}
async function saveProfileFields(athleteId, patch) {
  const current = await profileRow(athleteId);
  const body = { athlete_id: athleteId, ...(current || {}), ...patch, updated_at: new Date().toISOString() };
  delete body.id;
  const rows = await sb('athlete_profiles', 'on_conflict=athlete_id', { method:'POST', body, prefer:'resolution=merge-duplicates,return=representation' });
  return rows[0] || body;
}

async function listManualActivities(athleteId, oldest, newest) {
  const rows = await athleteActivities(athleteId, oldest, newest);
  return rows.filter(a => String(a.intervals_activity_id || '').startsWith('runflow-manual-'));
}
async function createManualActivity(athleteId, body) {
  const date = validDate(body.activity_date || body.date);
  const sport = safeText(body.sport || body.type, 40) || 'Other';
  const duration = num(body.duration_min,1,2000), rpe = num(body.rpe,1,10);
  if (!date || duration === null || rpe === null) throw Object.assign(new Error('Fecha, duración y RPE son obligatorios.'), { status:400 });
  const estimate=await estimateManualLoad(athleteId,{duration_min:duration,rpe,sport});
  const load=estimate.load;
  const id = crypto.randomUUID();
  const row = {
    id,
    athlete_id: athleteId,
    workout_id: null,
    intervals_activity_id: `runflow-manual-${id}`,
    activity_date: `${date}T12:00:00Z`,
    sport,
    name: safeText(body.name || `Actividad manual · ${sport}`,160),
    duration_sec: Math.round(duration*60),
    distance_m: num(body.distance_km,0,5000) === null ? null : Math.round(Number(body.distance_km)*1000),
    elevation_gain_m: num(body.elevation_m,0,100000),
    load,
    avg_hr: null,
    max_hr: null,
    avg_pace_sec_per_km: null,
    raw_summary: {
      source:'athlete_v2_manual', rpe, pain:num(body.pain,0,10), feeling:safeText(body.feeling,40)||null, comment:safeText(body.comment,2000),
      runflow_estimated_load:load, runflow_load_method:estimate.source, runflow_load_confidence:estimate.confidence, runflow_load_explanation:estimate.explanation, runflow_manual:{sport,distance_km:num(body.distance_km,0,5000),elevation_m:num(body.elevation_m,0,100000),rpe,pain:num(body.pain,0,10),feeling:safeText(body.feeling,40)||null,comment:safeText(body.comment,2000),srpe:estimate.srpe,load_source:estimate.source,confidence:estimate.confidence},
    },
  };
  const rows = await sb('activities','',{ method:'POST',body:row,prefer:'return=representation' }); return rows[0] || row;
}

async function findWorkoutForAthlete(athleteId, workoutId) {
  const rows = await sb('workouts', `id=eq.${encodeURIComponent(workoutId)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`);
  if (!rows.length) throw Object.assign(new Error('Sesión no encontrada.'), { status:404 }); return rows[0];
}
async function conflictsForDate(athleteId, workoutId, date) {
  const rows = await sb('workouts', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_date=eq.${date}&select=id,title,sport,planned_load,planned_duration_min`);
  return rows.filter(x => String(x.id) !== String(workoutId));
}
async function rescheduleWorkout(athleteId, workoutId, newDate, doUpdate) {
  const workout = await findWorkoutForAthlete(athleteId, workoutId);
  const date = validDate(newDate); if (!date) throw Object.assign(new Error('Fecha no válida.'), { status:400 });
  const conflicts = await conflictsForDate(athleteId, workoutId, date);
  if (!doUpdate) return { workout, conflicts };
  const oldDate = workout.workout_date;
  const blocks = Array.isArray(workout.blocks) ? workout.blocks.slice() : [];
  let meta = blocks.find(b => b && b.type === 'runflow_meta');
  if (!meta) { meta = { type:'runflow_meta', reschedule_history:[] }; blocks.push(meta); }
  if (!Array.isArray(meta.reschedule_history)) meta.reschedule_history=[];
  meta.reschedule_history.push({ from:oldDate,to:date,by:'athlete',at:new Date().toISOString() });
  const updatedRows = await sb('workouts', `id=eq.${encodeURIComponent(workoutId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`, { method:'PATCH', body:{ workout_date:date, blocks, updated_at:new Date().toISOString() }, prefer:'return=representation' });
  let intervals = { synced:false, reason:'Sin evento de Intervals enlazado.' };
  const key = await intervalsKey(athleteId);
  if (key) {
    let eventId = workout.intervals_event_id || null;
    if (!eventId) {
      try {
        const oldest = oldDate < date ? oldDate : date, newest = oldDate > date ? oldDate : date;
        const events = await intervalsFetch(key, `/athlete/0/events?oldest=${oldest}&newest=${newest}`);
        const match = (Array.isArray(events)?events:[]).find(e => e && e.external_id === `runflow-workout-${workout.id}`);
        eventId = match?.id || null;
      } catch {}
    }
    if (eventId) {
      try {
        const event = await intervalsFetch(key, `/athlete/0/events/${encodeURIComponent(eventId)}`);
        const payload = { ...event, start_date_local:`${date}T00:00:00` };
        delete payload.id;
        await intervalsFetch(key, `/athlete/0/events/${encodeURIComponent(eventId)}`, { method:'PUT', body:JSON.stringify(payload) });
        intervals = { synced:true,event_id:String(eventId) };
        if (!workout.intervals_event_id) await sb('workouts', `id=eq.${encodeURIComponent(workoutId)}`, { method:'PATCH',body:{intervals_event_id:String(eventId)},prefer:'return=minimal' });
      } catch (e) { intervals = { synced:false, reason:e.message }; }
    }
  }
  return { workout:updatedRows[0] || { ...workout,workout_date:date,blocks }, old_date:oldDate,new_date:date,conflicts,intervals };
}

async function missedAlerts(athleteId) {
  const today = localDate();
  const weeks = await sb('training_weeks', `athlete_id=eq.${encodeURIComponent(athleteId)}&status=eq.published&week_start=lte.${today}&select=id,week_start,end_date`);
  if (!weeks.length) return [];
  const ids = weeks.map(w=>w.id);
  const workouts = await sb('workouts', `training_week_id=in.(${ids.join(',')})&athlete_id=eq.${encodeURIComponent(athleteId)}&workout_date=lt.${today}&select=id,title,workout_date,sport,planned_load,planned_duration_min,training_week_id`);
  if (!workouts.length) return [];
  const wids = workouts.map(w=>w.id);
  const [acts,logs] = await Promise.all([
    sb('activities', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=in.(${wids.join(',')})&select=workout_id`),
    sb('manual_session_logs', `athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=in.(${wids.join(',')})&select=workout_id,status,created_at`),
  ]);
  const done = new Set(acts.map(a=>String(a.workout_id)));
  for (const l of logs) if (['completed','partial','skipped'].includes(l.status)) done.add(String(l.workout_id));
  return workouts.filter(w=>!done.has(String(w.id))).map(w=>({ id:`missed-${w.id}`,type:'missed_session',severity:'warning',workout_id:w.id,date:w.workout_date,title:w.title,message:`Sesión prevista no realizada: ${w.title}` }));
}

async function getBanner(athleteId) {
  const profile = await profileRow(athleteId); return customFieldGet(profile?.custom_fields, BANNER_FIELD);
}
async function setBanner(athleteId, body) {
  const profile = await profileRow(athleteId);
  const banner = body && body.active === false ? null : { text:safeText(body.text,500), tone:safeText(body.tone,30)||'motivation', active:true, updated_at:new Date().toISOString() };
  if (banner && !banner.text) throw Object.assign(new Error('Escribe el mensaje motivacional.'), { status:400 });
  const fields = customFieldSet(profile?.custom_fields, BANNER_FIELD, banner);
  await saveProfileFields(athleteId,{custom_fields:fields}); return banner;
}
async function maxLoadHistory(athleteId) {
  const profile=await profileRow(athleteId); return customFieldGet(profile?.custom_fields,LOAD_HISTORY_FIELD)||[];
}
async function addMaxLoadHistory(athleteId, body) {
  const value=num(body.value,0,10000), effective=validDate(body.effective_date)||localDate();
  if (value===null) throw Object.assign(new Error('Carga máxima no válida.'),{status:400});
  const profile=await profileRow(athleteId); const history=Array.isArray(customFieldGet(profile?.custom_fields,LOAD_HISTORY_FIELD))?customFieldGet(profile?.custom_fields,LOAD_HISTORY_FIELD):[];
  history.push({value,effective_date:effective,created_at:new Date().toISOString()}); history.sort((a,b)=>String(a.effective_date).localeCompare(String(b.effective_date)));
  const fields=customFieldSet(profile?.custom_fields,LOAD_HISTORY_FIELD,history);
  const tolerance={...safeObj(profile?.load_tolerance_profile),provisional_ceiling:value,updated_at:new Date().toISOString()};
  await saveProfileFields(athleteId,{custom_fields:fields,load_tolerance_profile:tolerance}); return history;
}

async function handle(req,res,url) {
  const method=req.method||'GET', p=url.pathname;
  if (!p.startsWith('/api/v9/') && !p.startsWith('/api/v2/')) return false;
  const session=await requireSession(req,res);

  if (p==='/api/v9/library' && method==='GET') { requireRole(session,'coach'); const lib=loadLibrary(); return sendJson(res,200,{...lib,count:lib.sessions.length}),true; }

  let m=p.match(/^\/api\/v9\/coach\/athletes\/([^/]+)\/alerts$/);
  if (m && method==='GET') { const id=decodeURIComponent(m[1]); await ensureCoachAccess(session,id); return sendJson(res,200,{alerts:await missedAlerts(id)}),true; }
  m=p.match(/^\/api\/v9\/coach\/athletes\/([^/]+)\/banner$/);
  if (m) { const id=decodeURIComponent(m[1]); await ensureCoachAccess(session,id); if(method==='GET')return sendJson(res,200,{banner:await getBanner(id)}),true; if(method==='PUT')return sendJson(res,200,{banner:await setBanner(id,await readJson(req))}),true; }
  m=p.match(/^\/api\/v9\/coach\/athletes\/([^/]+)\/load-metrics$/);
  if (m && method==='GET') { const id=decodeURIComponent(m[1]); await ensureCoachAccess(session,id); const oldest=validDate(url.searchParams.get('oldest'))||addDays(localDate(),-365); const newest=validDate(url.searchParams.get('newest'))||localDate(); await reconcileAndEstimateLoads(id); const acts=await athleteActivities(id,oldest,newest); const metrics=computeLoadMetrics(acts,newest); return sendJson(res,200,{...metrics,activities:acts.map(a=>({...a,runflow_load:effectiveLoad(a)}))}),true; }
  m=p.match(/^\/api\/v9\/coach\/athletes\/([^/]+)\/max-load-history$/);
  if (m) { const id=decodeURIComponent(m[1]); await ensureCoachAccess(session,id); if(method==='GET')return sendJson(res,200,{history:await maxLoadHistory(id)}),true; if(method==='POST')return sendJson(res,201,{history:await addMaxLoadHistory(id,await readJson(req))}),true; }

  if (p==='/api/v2/athlete/banner' && method==='GET') { requireRole(session,'athlete'); return sendJson(res,200,{banner:await getBanner(session.athlete_id)}),true; }
  if (p==='/api/v2/athlete/manual-activities') { requireRole(session,'athlete'); if(method==='GET'){ const oldest=validDate(url.searchParams.get('oldest'))||addDays(localDate(),-180); const newest=validDate(url.searchParams.get('newest'))||localDate(); return sendJson(res,200,{activities:await listManualActivities(session.athlete_id,oldest,newest)}),true; } if(method==='POST') return sendJson(res,201,{activity:await createManualActivity(session.athlete_id,await readJson(req))}),true; }
  if (p==='/api/v2/athlete/load-metrics' && method==='GET') { requireRole(session,'athlete'); const oldest=validDate(url.searchParams.get('oldest'))||addDays(localDate(),-365); const newest=validDate(url.searchParams.get('newest'))||localDate(); await reconcileAndEstimateLoads(session.athlete_id); const acts=await athleteActivities(session.athlete_id,oldest,newest); return sendJson(res,200,computeLoadMetrics(acts,newest)),true; }
  m=p.match(/^\/api\/v2\/athlete\/workouts\/([^/]+)\/reschedule$/);
  if (m && method==='POST') { requireRole(session,'athlete'); const body=await readJson(req); const result=await rescheduleWorkout(session.athlete_id,decodeURIComponent(m[1]),body.new_date,body.preview!==true); return sendJson(res,body.preview===true?200:201,result),true; }

  return sendJson(res,404,{error:'Ruta V9/V2 no encontrada.'}),true;
}

const originalCreateServer=http.createServer;
http.createServer=function patchedCreateServer(listener){
  return originalCreateServer.call(http,async(req,res)=>{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(!url.pathname.startsWith('/api/v9/')&&!url.pathname.startsWith('/api/v2/')) return listener(req,res);
    try{await handle(req,res,url);}catch(error){console.error('[v9-hook]',error);sendJson(res,Number(error.status||500),{error:error.message||'Error interno.',details:error.details||null});}
  });
};
