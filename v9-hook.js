'use strict';

// RunFlow V9 / Athlete V2 isolated API layer.
// Preloaded before server.js. Stable routes are passed through untouched.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { URL } = require('url');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const APP_ENCRYPTION_KEY = String(process.env.APP_ENCRYPTION_KEY || '');
const INTERVALS_API_BASE = 'https://intervals.icu/api/v1';
const IS_PROD = process.env.NODE_ENV === 'production';
const DEMO_MODE = process.env.DEMO_MODE === '1';
const LIBRARY_FILE = path.join(__dirname, 'data', 'runflow-library-v1.json.gz.b64');
const MANUAL_PREFIX = 'RUNFLOW_V2_MANUAL_ACTIVITY ';
const BANNER_FIELD = 'RUNFLOW_V9_BANNER';
const LOAD_HISTORY_FIELD = 'RUNFLOW_V9_LOAD_CEILING_HISTORY';
const PLAN_CHANGE_FIELD = 'RUNFLOW_V9_PLAN_CHANGE_HISTORY';

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
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON no válido.'), { status: 400 }); }
}
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const msg = data && typeof data === 'object' ? (data.message || data.error_description || data.error || data.details) : data;
    throw Object.assign(new Error(msg || `HTTP ${response.status}`), { status: response.status });
  }
  return data;
}
async function sb(table, query = '', options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw Object.assign(new Error('Supabase no está configurado.'), { status: 503 });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = [];
  try { data = text ? JSON.parse(text) : []; } catch { data = text; }
  if (!response.ok) {
    const msg = data && typeof data === 'object' ? [data.message, data.details, data.hint].filter(Boolean).join(' · ') : data;
    throw Object.assign(new Error(msg || `Supabase HTTP ${response.status}`), { status: response.status });
  }
  return data || [];
}
async function authUser(accessToken) {
  return fetchJson(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } });
}
async function refreshAuth(refreshToken) {
  return fetchJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) });
}
async function session(req, res) {
  if (DEMO_MODE) throw Object.assign(new Error('Las APIs V9 de escritura requieren el modo online.'), { status: 409 });
  const cookies = parseCookies(req);
  let access = cookies.rf_access;
  let refresh = cookies.rf_refresh;
  if (!access) throw Object.assign(new Error('Debes iniciar sesión.'), { status: 401 });
  let user;
  try { user = await authUser(access); }
  catch {
    if (!refresh) throw Object.assign(new Error('Debes iniciar sesión.'), { status: 401 });
    const renewed = await refreshAuth(refresh);
    access = renewed.access_token;
    refresh = renewed.refresh_token || refresh;
    user = renewed.user || await authUser(access);
    res.setHeader('Set-Cookie', [cookie('rf_access', access, Math.max(60, Number(renewed.expires_in) || 3600)), cookie('rf_refresh', refresh, 60 * 60 * 24 * 30)]);
  }
  const roles = await sb('user_roles', `user_id=eq.${encodeURIComponent(user.id)}&select=role`);
  const athleteRows = await sb('athletes', `user_id=eq.${encodeURIComponent(user.id)}&lifecycle_status=eq.active&select=id&limit=1`);
  return { user, roles: roles.map(row => row.role), athlete_id: athleteRows[0]?.id || null };
}
function requireRole(ctx, role) {
  if (!ctx.roles.includes(role)) throw Object.assign(new Error('No tienes permiso para realizar esta acción.'), { status: 403 });
}
async function coachAccess(ctx, athleteId) {
  requireRole(ctx, 'coach');
  const rows = await sb('coach_athletes', `coach_user_id=eq.${encodeURIComponent(ctx.user.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=athlete_id&limit=1`);
  if (!rows.length) throw Object.assign(new Error('No tienes acceso a este deportista.'), { status: 403 });
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null; }
function num(value, min = -Infinity, max = Infinity) { const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? n : null; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function median(values) { const a = values.map(Number).filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length)return null; const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
function percentile(values, p) { const a=values.map(Number).filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length)return null; if(a.length===1)return a[0]; const x=(a.length-1)*p, lo=Math.floor(x), hi=Math.ceil(x); return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(x-lo); }
function dayDiff(a,b){return Math.round((new Date(`${b}T12:00:00Z`)-new Date(`${a}T12:00:00Z`))/86400000);}
function addDays(iso, days){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function isoMonday(value){const d=value?new Date(`${String(value).slice(0,10)}T12:00:00Z`):new Date();const day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()-day+1);return d.toISOString().slice(0,10);}
function sportKey(value){const v=String(value||'').toLowerCase();if(/ride|bike|cycling|bici/.test(v))return'bike';if(/trail/.test(v))return'trail';if(/run|carrera/.test(v))return'run';if(/strength|weight|fuerza/.test(v))return'strength';if(/walk|hike|paseo|sender/.test(v))return'walk';return'other';}
function activitySpeedKmh(row){const sec=Number(row.duration_sec||0),m=Number(row.distance_m||0);return sec>0&&m>0?(m/1000)/(sec/3600):null;}
function activityDurationMin(row){const sec=Number(row.duration_sec||0);return sec>0?sec/60:null;}
function parseManualMarker(comment){const text=String(comment||'');if(!text.startsWith(MANUAL_PREFIX))return null;try{return JSON.parse(text.slice(MANUAL_PREFIX.length));}catch{return null;}}
function safeFields(value){return Array.isArray(value)?value.filter(x=>x&&typeof x==='object').slice(0,50):[];}
function upsertField(fields,label,value){const rows=safeFields(fields).filter(x=>x.label!==label);rows.push({label,value:typeof value==='string'?value:JSON.stringify(value)});return rows;}
function readField(fields,label,fallback=null){const row=safeFields(fields).find(x=>x.label===label);if(!row)return fallback;try{return JSON.parse(row.value);}catch{return row.value??fallback;}}

function loadLibrary(){
  const encoded=fs.readFileSync(LIBRARY_FILE,'utf8').trim();
  return JSON.parse(zlib.gunzipSync(Buffer.from(encoded,'base64')).toString('utf8'));
}
let libraryCache=null;
function library(){if(!libraryCache)libraryCache=loadLibrary();return libraryCache;}

function encryptionKey(){
  if(!APP_ENCRYPTION_KEY||APP_ENCRYPTION_KEY.length<24)return null;
  try{const raw=Buffer.from(APP_ENCRYPTION_KEY,'base64');if(raw.length===32&&raw.toString('base64').replace(/=+$/,'')===APP_ENCRYPTION_KEY.replace(/=+$/,''))return raw;}catch{}
  return crypto.createHash('sha256').update(APP_ENCRYPTION_KEY,'utf8').digest();
}
function decryptSecret(record){const key=encryptionKey();if(!key||!record)return null;const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(record.secret_iv,'base64'));decipher.setAuthTag(Buffer.from(record.secret_tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(record.secret_ciphertext,'base64')),decipher.final()]).toString('utf8');}
async function intervalsKey(athleteId){const rows=await sb('athlete_integrations',`athlete_id=eq.${encodeURIComponent(athleteId)}&provider=eq.intervals&select=*&limit=1`).catch(()=>[]);return rows[0]?decryptSecret(rows[0]):null;}
async function intervalsFetch(apiKey,endpoint,options={}){const response=await fetch(`${INTERVALS_API_BASE}${endpoint}`,{...options,headers:{Authorization:`Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`,Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});const text=await response.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!response.ok)throw Object.assign(new Error((data&&(data.message||data.error))||`Intervals.icu HTTP ${response.status}`),{status:response.status});return data;}

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
  logs.forEach(log=>{
    const key=String(log.workout_id);if(sport&&wk.get(key)!==sport)return;
    const load=(byWorkout.get(key)||[]).reduce((s,x)=>s+Number(x.load||0),0);
    const srpe=Number(log.actual_duration_min||0)*Number(log.rpe||0);
    if(load>0&&srpe>0)ratios.push(load/srpe);
  });
  return ratios;
}
async function estimateManualLoad(athleteId,payload){
  const duration=num(payload.duration_min,1,1440),rpe=num(payload.rpe,1,10),sport=sportKey(payload.sport);
  if(!duration||!rpe)return{load:null,source:'insufficient',confidence:'none',explanation:'Faltan duración o RPE.'};
  const srpe=duration*rpe;
  const ratios=await pairedSrpeRatios(athleteId,sport);
  if(ratios.length>=3){const ratio=percentile(ratios,0.35);return{load:Math.max(1,Math.round(srpe*ratio)),srpe,source:'estimated_athlete_srpe',confidence:ratios.length>=8?'high':'medium',samples:ratios.length,explanation:'Estimación calibrada con sesiones del mismo deportista que tienen RPE y carga objetiva.'};}
  const recent=await sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&load=gt.0&select=load,duration_sec,sport&order=activity_date.desc&limit=120`).catch(()=>[]);
  const perMin=recent.filter(x=>sportKey(x.sport)===sport&&Number(x.duration_sec)>0).map(x=>Number(x.load)/(Number(x.duration_sec)/60)).filter(x=>Number.isFinite(x)&&x>0);
  if(perMin.length>=3){const base=percentile(perMin,0.25);const intensity=clamp(0.75+(rpe-5)*0.06,0.55,1.05);return{load:Math.max(1,Math.round(duration*base*intensity)),srpe,source:'estimated_athlete_sport_history',confidence:perMin.length>=8?'medium':'low',samples:perMin.length,explanation:'Estimación conservadora con el cuartil bajo de carga/minuto del mismo deporte y ajuste moderado por RPE.'};}
  // Low-confidence fallback only when the athlete has no usable calibration history.
  const fallback=Math.max(1,Math.round(srpe/10));
  return{load:fallback,srpe,source:'estimated_conservative_fallback',confidence:'low',samples:0,explanation:'Estimación conservadora provisional: sRPE normalizada mientras RunFlow reúne historial propio del atleta.'};
}

function similarity(a,b){
  const terms=[];
  const da=activityDurationMin(a),db=activityDurationMin(b);if(da&&db)terms.push(Math.abs(Math.log(da/db)));
  const xa=Number(a.distance_m||0),xb=Number(b.distance_m||0);if(xa>0&&xb>0)terms.push(Math.abs(Math.log(xa/xb)));
  const sa=activitySpeedKmh(a),sb=activitySpeedKmh(b);if(sa&&sb)terms.push(Math.abs(Math.log(sa/sb)));
  const ea=Number(a.elevation_gain_m||0),eb=Number(b.elevation_gain_m||0);const kma=xa/1000,kmb=xb/1000;if(kma>0&&kmb>0&&(ea>0||eb>0))terms.push(Math.abs(Math.log((1+ea/kma)/(1+eb/kmb))));
  return terms.length?terms.reduce((s,x)=>s+x,0)/terms.length:999;
}
async function estimateZeroImportedLoad(athleteId,row,history=null){
  const sport=sportKey(row.sport),duration=activityDurationMin(row);
  if(!duration)return{load:null,source:'insufficient',confidence:'none',explanation:'Actividad sin duración suficiente.'};
  const candidates=(history||await sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&load=gt.0&select=id,load,duration_sec,distance_m,elevation_gain_m,sport,avg_pace_sec_per_km,activity_date&order=activity_date.desc&limit=200`).catch(()=>[]))
    .filter(x=>sportKey(x.sport)===sport&&Number(x.duration_sec)>0&&String(x.id)!==String(row.id))
    .map(x=>({...x,_score:similarity(row,x)})).sort((a,b)=>a._score-b._score).slice(0,7);
  if(candidates.length>=3){const perHour=candidates.map(x=>Number(x.load)/(Number(x.duration_sec)/3600)).filter(x=>Number.isFinite(x)&&x>0);const conservative=percentile(perHour,0.35);return{load:Math.max(1,Math.round(conservative*(duration/60)*0.95)),source:'estimated_comparable_history',confidence:candidates.length>=5?'medium':'low',samples:candidates.length,explanation:'Carga estimada con actividades comparables del mismo deporte; distancia, duración, desnivel relativo y velocidad intervienen en la selección. Se aplica un sesgo conservador.'};}
  const speed=activitySpeedKmh(row)||0,km=Number(row.distance_m||0)/1000,elev=Number(row.elevation_gain_m||0),density=km>0?elev/km:0;
  let perMin=0.25;
  if(sport==='bike') perMin=0.28+clamp((speed-12)/60,0,0.32)+clamp(density/300,0,0.12);
  else if(sport==='walk') perMin=0.16+clamp((speed-3)/25,0,0.12)+clamp(density/450,0,0.10);
  else if(sport==='run'||sport==='trail') perMin=0.38+clamp((speed-7)/35,0,0.22)+clamp(density/300,0,0.15);
  else if(sport==='strength') perMin=0.35;
  return{load:Math.max(1,Math.round(duration*clamp(perMin,0.15,0.85))),source:'estimated_conservative_activity',confidence:'low',samples:candidates.length,explanation:'Estimación conservadora de respaldo basada en duración, velocidad media, distancia y densidad de desnivel. Se sustituirá cuando exista una carga objetiva o mejor calibración.'};
}

async function reconcileAndEstimateLoads(athleteId){
  const rows=await sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&order=activity_date.asc&limit=2000`).catch(()=>[]);
  const imported=rows.filter(x=>!String(x.intervals_activity_id||'').startsWith('runflow-manual-'));
  const manual=rows.filter(x=>String(x.intervals_activity_id||'').startsWith('runflow-manual-'));
  let deduplicated=0,estimated=0;
  for(const m of manual){
    const md=(m.raw_summary&&m.raw_summary.runflow_manual)||m.raw_summary||{};
    const same=imported.find(x=>{
      if(String(x.activity_date||'').slice(0,10)!==String(m.activity_date||'').slice(0,10))return false;
      if(sportKey(x.sport)!==sportKey(m.sport))return false;
      const dm=activityDurationMin(m),di=activityDurationMin(x);if(dm&&di&&Math.abs(dm-di)>Math.max(8,dm*0.15))return false;
      const manualKm=Number(md.distance_km||0),importKm=Number(x.distance_m||0)/1000;if(manualKm>0&&importKm>0&&Math.abs(manualKm-importKm)>Math.max(1,manualKm*0.2))return false;
      return true;
    });
    if(same){await sb('activities',`id=eq.${encodeURIComponent(m.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,{method:'DELETE',prefer:'return=minimal'}).catch(()=>[]);deduplicated+=1;}
  }
  const after=deduplicated?await sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&order=activity_date.asc&limit=2000`).catch(()=>[]):rows;
  const history=after.filter(x=>Number(x.load)>0);
  for(const row of after){
    if(Number(row.load)>0)continue;
    if(String(row.intervals_activity_id||'').startsWith('runflow-manual-'))continue;
    const estimate=await estimateZeroImportedLoad(athleteId,row,history);
    if(estimate.load===null)continue;
    const raw=row.raw_summary&&typeof row.raw_summary==='object'?row.raw_summary:{};
    await sb('activities',`id=eq.${encodeURIComponent(row.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,{method:'PATCH',body:{load:estimate.load,raw_summary:{...raw,runflow_load:{...estimate,original_imported_load:Number(row.load||0),estimated_at:new Date().toISOString()}}},prefer:'return=minimal'}).catch(()=>[]);
    row.load=estimate.load;history.push(row);estimated+=1;
  }
  return{deduplicated,estimated};
}

async function runflowLoadModel(athleteId,refresh=true){
  if(refresh)await reconcileAndEstimateLoads(athleteId);
  const rows=await sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&select=id,intervals_activity_id,activity_date,sport,name,duration_sec,distance_m,elevation_gain_m,load,raw_summary&order=activity_date.asc&limit=2000`).catch(()=>[]);
  const usable=rows.filter(x=>Number(x.load)>=0&&validDate(String(x.activity_date||'').slice(0,10)));
  if(!usable.length)return{fitness:0,fatigue:0,form:0,week_load:0,daily:[],activities:[],source:'runflow',constants:{fitness_days:42,fatigue_days:7}};
  const byDay=new Map();usable.forEach(x=>{const d=String(x.activity_date).slice(0,10);byDay.set(d,(byDay.get(d)||0)+Number(x.load||0));});
  const first=[...byDay.keys()].sort()[0],today=new Date().toISOString().slice(0,10),wf=Math.exp(-1/42),wa=Math.exp(-1/7);let fitness=0,fatigue=0;const daily=[];
  for(let d=first;d<=today;d=addDays(d,1)){const load=byDay.get(d)||0;fitness=fitness*wf+load*(1-wf);fatigue=fatigue*wa+load*(1-wa);daily.push({date:d,load:Math.round(load*10)/10,fitness:Math.round(fitness*100)/100,fatigue:Math.round(fatigue*100)/100,form:Math.round((fitness-fatigue)*100)/100});}
  const weekStart=isoMonday(today),weekLoad=usable.filter(x=>String(x.activity_date).slice(0,10)>=weekStart&&String(x.activity_date).slice(0,10)<=today).reduce((s,x)=>s+Number(x.load||0),0);
  const activitySummary=usable.slice(-120).reverse().map(x=>{const rf=x.raw_summary&&x.raw_summary.runflow_load;return{id:x.id,intervals_activity_id:x.intervals_activity_id,date:String(x.activity_date).slice(0,10),sport:x.sport,name:x.name,load:Number(x.load||0),load_source:rf?.source||String(x.intervals_activity_id||'').startsWith('runflow-manual-')?'runflow_manual_estimated':'imported',confidence:rf?.confidence||null};});
  return{fitness:Math.round(fitness*100)/100,fatigue:Math.round(fatigue*100)/100,form:Math.round((fitness-fatigue)*100)/100,week_load:Math.round(weekLoad*10)/10,daily:daily.slice(-120),activities:activitySummary,source:'runflow',constants:{fitness_days:42,fatigue_days:7},updated_at:new Date().toISOString()};
}

async function manualActivities(athleteId){
  const rows=await sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&intervals_activity_id=like.runflow-manual-*&select=*&order=activity_date.desc&limit=200`).catch(()=>[]);
  return rows.map(row=>{const meta=(row.raw_summary&&row.raw_summary.runflow_manual)||{};return{id:row.id,external_id:row.intervals_activity_id,activity_date:String(row.activity_date).slice(0,10),sport:meta.sport||sportKey(row.sport),name:row.name,duration_min:Number(row.duration_sec||0)/60,rpe:meta.rpe??null,distance_km:row.distance_m==null?null:Number(row.distance_m)/1000,elevation_m:row.elevation_gain_m??null,pain:meta.pain??null,feeling:meta.feeling??null,comment:meta.comment||'',load:Number(row.load||0),load_source:meta.load_source||'estimated',confidence:meta.confidence||null,srpe:meta.srpe??null};});
}
async function createManualActivity(athleteId,body){
  const date=validDate(body.activity_date||body.date),duration=num(body.duration_min,1,1440),rpe=num(body.rpe,1,10),sport=sportKey(body.sport),distance=num(body.distance_km,0,10000),elevation=num(body.elevation_m,0,100000),pain=num(body.pain,0,10),feeling=['muy_bien','bien','normal','mal'].includes(body.feeling)?body.feeling:null,comment=String(body.comment||'').slice(0,2000);
  if(!date||!duration||!rpe)throw Object.assign(new Error('La actividad manual necesita fecha, duración y RPE.'),{status:400});
  const estimate=await estimateManualLoad(athleteId,{duration_min:duration,rpe,sport});
  const id=crypto.randomUUID(),external=`runflow-manual-${id}`;
  const sportStored=({bike:'Ride',run:'Run',trail:'TrailRun',strength:'Strength',walk:'Walk',other:'Other'})[sport]||'Other';
  const meta={source:'athlete_v2_manual_activity',activity_date:date,sport,distance_km:distance,elevation_m:elevation,rpe,pain,feeling,comment,srpe:estimate.srpe,load_source:estimate.source,confidence:estimate.confidence,load_explanation:estimate.explanation};
  const log={id,athlete_id:athleteId,workout_id:null,status:'completed',actual_duration_min:duration,rpe,pain,feeling,pain_area:null,comment:`${MANUAL_PREFIX}${JSON.stringify(meta)}`,created_at:new Date().toISOString()};
  await sb('manual_session_logs','',{method:'POST',body:log,prefer:'return=minimal'});
  const row={athlete_id:athleteId,workout_id:null,intervals_activity_id:external,activity_date:`${date}T12:00:00Z`,sport:sportStored,name:body.name?String(body.name).slice(0,160):({bike:'Bici manual',run:'Running manual',trail:'Trail manual',strength:'Fuerza externa',walk:'Paseo manual',other:'Actividad manual'})[sport],duration_sec:Math.round(duration*60),distance_m:distance==null?null:Math.round(distance*1000),elevation_gain_m:elevation,load:estimate.load,avg_hr:null,max_hr:null,avg_pace_sec_per_km:distance&&distance>0?Math.round(duration*60/distance):null,raw_summary:{source:'runflow_manual',runflow_manual:meta,runflow_load:{...estimate,estimated_at:new Date().toISOString()}}};
  await sb('activities','on_conflict=athlete_id,intervals_activity_id',{method:'POST',body:row,prefer:'resolution=merge-duplicates,return=minimal'});
  return{...meta,id,external_id:external,duration_min:duration,load:estimate.load};
}

async function missedSessionAlerts(athleteId){
  const today=new Date().toISOString().slice(0,10),oldest=addDays(today,-21);
  const weeks=await sb('training_weeks',`athlete_id=eq.${encodeURIComponent(athleteId)}&status=eq.published&week_start=gte.${isoMonday(oldest)}&select=id,week_start,title&order=week_start.desc`).catch(()=>[]);
  if(!weeks.length)return[];
  const ids=weeks.map(x=>x.id);const workouts=await sb('workouts',`athlete_id=eq.${encodeURIComponent(athleteId)}&training_week_id=in.(${ids.join(',')})&workout_date=lt.${today}&select=id,training_week_id,workout_date,title,sport,planned_load,planned_duration_min&order=workout_date.desc`).catch(()=>[]);
  if(!workouts.length)return[];
  const wids=workouts.map(x=>x.id);const [acts,logs]=await Promise.all([sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=in.(${wids.join(',')})&select=workout_id,intervals_activity_id`).catch(()=>[]),sb('manual_session_logs',`athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=in.(${wids.join(',')})&select=workout_id,status,created_at`).catch(()=>[])]);
  const done=new Set(acts.map(x=>String(x.workout_id)));logs.forEach(x=>{if(['completed','partial'].includes(x.status))done.add(String(x.workout_id));});
  return workouts.filter(w=>!done.has(String(w.id))).map(w=>{const log=logs.find(x=>String(x.workout_id)===String(w.id));return{id:`missed-${w.id}`,type:'missed_session',severity:'attention',workout_id:w.id,date:w.workout_date,title:w.title,message:log?.status==='skipped'?`El atleta marcó «${w.title}» como no realizada.`:`No consta que «${w.title}» se haya realizado ni se ha recibido una actividad vinculada.`,action:'review_workout'};});
}

async function currentProfile(athleteId){const rows=await sb('athlete_profiles',`athlete_id=eq.${encodeURIComponent(athleteId)}&select=*&limit=1`);return rows[0]||{};}
async function dynamicProfile(athleteId){const p=await currentProfile(athleteId);const availability=p.availability&&typeof p.availability==='object'?p.availability:{};const tolerance=p.load_tolerance_profile&&typeof p.load_tolerance_profile==='object'?p.load_tolerance_profile:{};return{availability,strength_mode:availability.strength_mode||'runflow',external_strength_days:Array.isArray(availability.external_strength_days)?availability.external_strength_days:[],max_load:tolerance.provisional_ceiling??null,load_tolerance_profile:tolerance,load_ceiling_history:readField(p.custom_fields,LOAD_HISTORY_FIELD,[]),change_history:readField(p.custom_fields,PLAN_CHANGE_FIELD,[]),updated_at:p.updated_at||null};}
async function saveDynamicProfile(athleteId,body,coachUserId){
  const existing=await currentProfile(athleteId),previous=await dynamicProfile(athleteId);const availability={...(existing.availability&&typeof existing.availability==='object'?existing.availability:{}),...(body.availability&&typeof body.availability==='object'?body.availability:{})};
  if(['runflow','external'].includes(body.strength_mode))availability.strength_mode=body.strength_mode;
  if(Array.isArray(body.external_strength_days))availability.external_strength_days=body.external_strength_days.map(x=>Number(x)).filter(x=>Number.isInteger(x)&&x>=1&&x<=7);
  const tolerance={...(existing.load_tolerance_profile&&typeof existing.load_tolerance_profile==='object'?existing.load_tolerance_profile:{})};const ceiling=num(body.max_load,0,10000);if(body.max_load!==undefined)tolerance.provisional_ceiling=ceiling;
  let fields=safeFields(existing.custom_fields);let loadHistory=readField(fields,LOAD_HISTORY_FIELD,[]);if(!Array.isArray(loadHistory))loadHistory=[];
  if(body.max_load!==undefined&&Number(previous.max_load)!==Number(ceiling)){loadHistory.push({effective_date:validDate(body.effective_date)||new Date().toISOString().slice(0,10),from:previous.max_load??null,to:ceiling,coach_user_id:coachUserId,created_at:new Date().toISOString()});fields=upsertField(fields,LOAD_HISTORY_FIELD,loadHistory.slice(-100));}
  const rows=await sb('athlete_profiles','on_conflict=athlete_id',{method:'POST',body:{...existing,athlete_id:athleteId,availability,load_tolerance_profile:tolerance,custom_fields:fields,updated_at:new Date().toISOString()},prefer:'resolution=merge-duplicates,return=representation'});
  return{profile:rows[0]||{},dynamic:await dynamicProfile(athleteId)};
}

async function getBanner(athleteId){const p=await currentProfile(athleteId);return readField(p.custom_fields,BANNER_FIELD,null);}
async function saveBanner(athleteId,text,coachUserId){const p=await currentProfile(athleteId);let fields=safeFields(p.custom_fields);const banner=String(text||'').trim()?{text:String(text).trim().slice(0,500),active:true,created_at:new Date().toISOString(),coach_user_id:coachUserId}:{text:'',active:false,created_at:new Date().toISOString(),coach_user_id:coachUserId};fields=upsertField(fields,BANNER_FIELD,banner);await sb('athlete_profiles',`athlete_id=eq.${encodeURIComponent(athleteId)}`,{method:'PATCH',body:{custom_fields:fields,updated_at:new Date().toISOString()},prefer:'return=minimal'});return banner;}

async function rescheduleWorkout(athleteId,workoutId,body){
  const newDate=validDate(body.workout_date||body.date);if(!newDate)throw Object.assign(new Error('Selecciona una fecha válida.'),{status:400});
  const rows=await sb('workouts',`id=eq.${encodeURIComponent(workoutId)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=*`);if(!rows.length)throw Object.assign(new Error('Sesión no encontrada.'),{status:404});const workout=rows[0],oldDate=String(workout.workout_date).slice(0,10);if(oldDate===newDate)return{workout,conflicts:[],intervals:{updated:false}};
  const week=await sb('training_weeks',`id=eq.${encodeURIComponent(workout.training_week_id)}&athlete_id=eq.${encodeURIComponent(athleteId)}&select=*`);if(!week.length||week[0].status!=='published')throw Object.assign(new Error('El atleta solo puede mover sesiones de una semana publicada.'),{status:409});
  const conflicts=await sb('workouts',`athlete_id=eq.${encodeURIComponent(athleteId)}&workout_date=eq.${newDate}&id=neq.${encodeURIComponent(workoutId)}&select=id,title,sport,planned_load,planned_duration_min`).catch(()=>[]);
  await sb('workouts',`id=eq.${encodeURIComponent(workoutId)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,{method:'PATCH',body:{workout_date:newDate,updated_at:new Date().toISOString()},prefer:'return=minimal'});
  let intervals={updated:false,reason:'Sin evento de Intervals enlazado.'};
  if(workout.intervals_event_id){const key=await intervalsKey(athleteId);if(key){const event={category:'WORKOUT',start_date_local:`${newDate}T00:00:00`,type:String(workout.sport||'Run')==='Strength'?'WeightTraining':String(workout.sport||'Run'),name:String(workout.title||'Sesión').slice(0,160),description:String(workout.structured_description||workout.summary||'').slice(0,10000),external_id:`runflow-workout-${workout.id}`};if(workout.planned_load!=null)event.icu_training_load=Number(workout.planned_load);if(workout.planned_duration_min!=null)event.moving_time=Math.round(Number(workout.planned_duration_min)*60);await intervalsFetch(key,`/athlete/0/events/${encodeURIComponent(workout.intervals_event_id)}`,{method:'PUT',body:JSON.stringify(event)});intervals={updated:true,event_id:String(workout.intervals_event_id)};}}
  // Trace without changing the workout prescription.
  const coachLinks=await sb('coach_athletes',`athlete_id=eq.${encodeURIComponent(athleteId)}&select=coach_user_id&limit=1`).catch(()=>[]);if(coachLinks[0])await sb('athlete_messages','',{method:'POST',body:{id:crypto.randomUUID(),athlete_id:athleteId,coach_user_id:coachLinks[0].coach_user_id,sender_user_id:null,sender_role:'athlete',workout_id:workoutId,message:`[RUNFLOW_REPROGRAMADO] ${oldDate} → ${newDate}`,created_at:new Date().toISOString(),read_by_athlete_at:new Date().toISOString(),read_by_coach_at:null},prefer:'return=minimal'}).catch(()=>[]);
  return{workout:{...workout,workout_date:newDate},old_date:oldDate,new_date:newDate,conflicts,intervals};
}

function dayAvailability(profile,iso){const days=profile?.availability?.days;const weekday=((new Date(`${iso}T12:00:00Z`).getUTCDay()+6)%7)+1;if(Array.isArray(days)){const row=days.find(x=>Number(x.day)===weekday);return row||null;}return null;}
async function replanFuture(athleteId,body,coachUserId){
  const effective=validDate(body.effective_date)||new Date().toISOString().slice(0,10),profile=await dynamicProfile(athleteId);const weeks=await sb('training_weeks',`athlete_id=eq.${encodeURIComponent(athleteId)}&status=eq.draft&week_start=gte.${isoMonday(effective)}&select=*&order=week_start.asc`).catch(()=>[]);let moved=0,unchanged=0;const changes=[];
  for(const week of weeks){const workouts=await sb('workouts',`athlete_id=eq.${encodeURIComponent(athleteId)}&training_week_id=eq.${encodeURIComponent(week.id)}&select=*&order=workout_date.asc`).catch(()=>[]);const occupied=new Set();for(const w of workouts){const original=String(w.workout_date).slice(0,10);if(original<effective){occupied.add(original);unchanged++;continue;}const availability=profile.availability||{};const current=dayAvailability(profile,original);const allowed=current?current.can_train!==false:true;const maxMin=current?num(current.max_minutes,0,1440):null;const duration=num(w.planned_duration_min,0,2000);const externalStrength=profile.strength_mode==='external'&&sportKey(w.sport)==='strength';if((allowed&&(maxMin===null||duration===null||duration<=maxMin))||externalStrength){occupied.add(original);unchanged++;continue;}let chosen=null;for(let offset=0;offset<7;offset++){const d=addDays(week.week_start,offset);if(d<effective||occupied.has(d))continue;const a=dayAvailability(profile,d);if(a&&a.can_train===false)continue;const m=a?num(a.max_minutes,0,1440):null;if(duration!==null&&m!==null&&duration>m)continue;if(externalStrength&&Array.isArray(profile.external_strength_days)){const wd=((new Date(`${d}T12:00:00Z`).getUTCDay()+6)%7)+1;if(!profile.external_strength_days.includes(wd))continue;}chosen=d;break;}if(chosen&&chosen!==original){await sb('workouts',`id=eq.${encodeURIComponent(w.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,{method:'PATCH',body:{workout_date:chosen,updated_at:new Date().toISOString()},prefer:'return=minimal'});occupied.add(chosen);moved++;changes.push({workout_id:w.id,title:w.title,from:original,to:chosen});}else{occupied.add(original);unchanged++;}}
  }
  const p=await currentProfile(athleteId);let fields=safeFields(p.custom_fields),history=readField(fields,PLAN_CHANGE_FIELD,[]);if(!Array.isArray(history))history=[];history.push({effective_date:effective,type:String(body.reason||'profile_update'),moved,changes,coach_user_id:coachUserId,created_at:new Date().toISOString()});fields=upsertField(fields,PLAN_CHANGE_FIELD,history.slice(-50));await sb('athlete_profiles',`athlete_id=eq.${encodeURIComponent(athleteId)}`,{method:'PATCH',body:{custom_fields:fields,updated_at:new Date().toISOString()},prefer:'return=minimal'}).catch(()=>[]);
  return{effective_date:effective,weeks:weeks.length,moved,unchanged,changes,note:'Solo se han modificado semanas futuras en borrador. Semanas realizadas y publicadas no se reescriben.'};
}

async function route(req,res,url){
  const method=req.method||'GET',pathname=url.pathname;
  if(pathname==='/api/v9/library'&&method==='GET'){return sendJson(res,200,library());}
  const ctx=await session(req,res);

  if(pathname==='/api/v9/athlete/manual-activities'&&method==='GET'){requireRole(ctx,'athlete');if(!ctx.athlete_id)throw Object.assign(new Error('Usuario sin ficha de atleta.'),{status:409});await reconcileAndEstimateLoads(ctx.athlete_id);return sendJson(res,200,{activities:await manualActivities(ctx.athlete_id)});}
  if(pathname==='/api/v9/athlete/manual-activities'&&method==='POST'){requireRole(ctx,'athlete');if(!ctx.athlete_id)throw Object.assign(new Error('Usuario sin ficha de atleta.'),{status:409});return sendJson(res,201,{activity:await createManualActivity(ctx.athlete_id,await readJson(req))});}
  if(pathname==='/api/v9/athlete/load-model'&&method==='GET'){requireRole(ctx,'athlete');return sendJson(res,200,await runflowLoadModel(ctx.athlete_id,url.searchParams.get('refresh')!=='0'));}
  if(pathname==='/api/v9/athlete/banner'&&method==='GET'){requireRole(ctx,'athlete');return sendJson(res,200,{banner:await getBanner(ctx.athlete_id)});}
  if(pathname==='/api/v9/athlete/alerts'&&method==='GET'){requireRole(ctx,'athlete');return sendJson(res,200,{alerts:await missedSessionAlerts(ctx.athlete_id)});}
  const reschedule=pathname.match(/^\/api\/v9\/athlete\/workouts\/([^/]+)\/reschedule$/);if(reschedule&&method==='POST'){requireRole(ctx,'athlete');return sendJson(res,200,await rescheduleWorkout(ctx.athlete_id,decodeURIComponent(reschedule[1]),await readJson(req)));}

  const coach=pathname.match(/^\/api\/v9\/coach\/athletes\/([^/]+)\/(.+)$/);if(coach){const athleteId=decodeURIComponent(coach[1]),action=coach[2];await coachAccess(ctx,athleteId);
    if(action==='load-model'&&method==='GET')return sendJson(res,200,await runflowLoadModel(athleteId,url.searchParams.get('refresh')!=='0'));
    if(action==='alerts'&&method==='GET')return sendJson(res,200,{alerts:await missedSessionAlerts(athleteId)});
    if(action==='dynamic-profile'&&method==='GET')return sendJson(res,200,await dynamicProfile(athleteId));
    if(action==='dynamic-profile'&&method==='PUT')return sendJson(res,200,await saveDynamicProfile(athleteId,await readJson(req),ctx.user.id));
    if(action==='replan'&&method==='POST')return sendJson(res,200,await replanFuture(athleteId,await readJson(req),ctx.user.id));
    if(action==='banner'&&method==='GET')return sendJson(res,200,{banner:await getBanner(athleteId)});
    if(action==='banner'&&method==='POST'){const body=await readJson(req);return sendJson(res,200,{banner:await saveBanner(athleteId,body.text,ctx.user.id)});}
  }
  throw Object.assign(new Error('Ruta V9 no encontrada.'),{status:404});
}

const originalCreate=http.createServer.bind(http);
http.createServer=function patchedCreateServer(listener){
  return originalCreate((req,res)=>{
    let url;try{url=new URL(req.url,`http://${req.headers.host||'localhost'}`);}catch{return listener(req,res);}
    if(!url.pathname.startsWith('/api/v9/'))return listener(req,res);
    route(req,res,url).catch(error=>{console.error('[v9-hook]',error);if(!res.headersSent)sendJson(res,Number(error.status||500),{error:error.message||'Error V9 interno.'});else res.end();});
  });
};
