'use strict';

const http=require('http');
const crypto=require('crypto');
const {URL}=require('url');
const {activityIntervals,findPreviousComparable,identity,metricForSession}=require('./session-comparison-metrics');
const SUPABASE_URL=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_ANON_KEY=String(process.env.SUPABASE_ANON_KEY||'');
const SUPABASE_SERVICE_ROLE_KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
const APP_ENCRYPTION_KEY=String(process.env.APP_ENCRYPTION_KEY||'');
const INTERVALS_API_BASE='https://intervals.icu/api/v1';
const IS_PROD=process.env.NODE_ENV==='production';

function cookies(req){const o={};String(req.headers.cookie||'').split(';').forEach(p=>{const i=p.indexOf('=');if(i>=0)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())});return o}
function cookie(n,v,a){return `${n}=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax${IS_PROD?'; Secure':''}; Max-Age=${a}`}
function json(res,status,data){const b=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(b),'Cache-Control':'no-store'});res.end(b)}
async function read(req){let b='';for await(const c of req)b+=c;return b?JSON.parse(b):{}}
async function fetchJson(url,opt={}){const r=await fetch(url,opt),t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw Object.assign(new Error(d?.message||d?.error||`HTTP ${r.status}`),{status:r.status});return d}
async function sb(table,query='',opt={}){return fetchJson(`${SUPABASE_URL}/rest/v1/${table}${query?`?${query}`:''}`,{method:opt.method||'GET',headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,...(opt.body!==undefined?{'Content-Type':'application/json'}:{}),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)})}
async function session(req,res){const c=cookies(req);let access=c.rf_access,refresh=c.rf_refresh;if(!access)throw Object.assign(new Error('Debes iniciar sesión.'),{status:401});let user;try{user=await fetchJson(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${access}`}})}catch{if(!refresh)throw Object.assign(new Error('Debes iniciar sesión.'),{status:401});const r=await fetchJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refresh})});access=r.access_token;refresh=r.refresh_token||refresh;user=r.user;res.setHeader('Set-Cookie',[cookie('rf_access',access,Math.max(60,Number(r.expires_in)||3600)),cookie('rf_refresh',refresh,2592000)])}const roles=(await sb('user_roles',`user_id=eq.${encodeURIComponent(user.id)}&select=role`)).map(x=>x.role),ath=(await sb('athletes',`user_id=eq.${encodeURIComponent(user.id)}&lifecycle_status=eq.active&select=id&limit=1`))[0];return{user,roles,athlete_id:ath?.id||null}}
function role(s,r){if(!s.roles.includes(r))throw Object.assign(new Error('No tienes permiso.'),{status:403})}
async function coach(s,id){role(s,'coach');if(!(await sb('coach_athletes',`coach_user_id=eq.${encodeURIComponent(s.user.id)}&athlete_id=eq.${encodeURIComponent(id)}&select=athlete_id&limit=1`)).length)throw Object.assign(new Error('Sin acceso al atleta.'),{status:403})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):null}
function addDays(iso,n){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function sportKey(v){v=String(v||'').toLowerCase();if(/strength|weight|fuerza/.test(v))return'strength';if(/trail/.test(v))return'trail';if(/run/.test(v))return'run';if(/ride|bike|cycl/.test(v))return'bike';if(/walk|hike/.test(v))return'walk';return'other'}
function pctl(v,p){const a=v.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return null;const x=(a.length-1)*p,l=Math.floor(x),h=Math.ceil(x);return l===h?a[l]:a[l]+(a[h]-a[l])*(x-l)}
function obj(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}
function encryptionKey(){if(!APP_ENCRYPTION_KEY||APP_ENCRYPTION_KEY.length<24)return null;try{const raw=Buffer.from(APP_ENCRYPTION_KEY,'base64');if(raw.length===32)return raw}catch{}return crypto.createHash('sha256').update(APP_ENCRYPTION_KEY,'utf8').digest()}
function decryptSecret(record){const key=encryptionKey();if(!key||!record)return null;const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(record.secret_iv,'base64'));decipher.setAuthTag(Buffer.from(record.secret_tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(record.secret_ciphertext,'base64')),decipher.final()]).toString('utf8')}
async function intervalsKey(athleteId){const rows=await sb('athlete_integrations',`athlete_id=eq.${encodeURIComponent(athleteId)}&provider=eq.intervals&select=*&limit=1`).catch(()=>[]);return rows[0]?decryptSecret(rows[0]):null}
async function intervalsDetail(apiKey,externalId){const data=await fetchJson(`${INTERVALS_API_BASE}/activity/${encodeURIComponent(externalId)}?intervals=true`,{headers:{Authorization:`Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`,Accept:'application/json'}});return data&&data.activity&&typeof data.activity==='object'?data.activity:data}
async function ensureIntervals(athleteId,activity,apiKey){if(activityIntervals(activity).length||!apiKey||!activity?.intervals_activity_id||String(activity.intervals_activity_id).startsWith('runflow-'))return activity;try{const detail=await intervalsDetail(apiKey,activity.intervals_activity_id);if(!detail||typeof detail!=='object')return activity;await sb('activities',`id=eq.${encodeURIComponent(activity.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}`,{method:'PATCH',body:{raw_summary:detail},prefer:'return=minimal'}).catch(()=>[]);return{...activity,raw_summary:detail}}catch{return activity}}
function paceText(seconds){const value=Math.round(Number(seconds)||0);return value>0?`${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}/km`:'—'}

async function externalStrengthSync(athleteId,body){
  const effective=validDate(body.effective_date)||today();
  const profile=(await sb('athlete_profiles',`athlete_id=eq.${encodeURIComponent(athleteId)}&select=availability&limit=1`))[0]||{};
  const av=obj(profile.availability);if(av.strength_mode!=='external')return{created:0,removed:0,note:'Fuerza gestionada por RunFlow; no se crean huecos externos.'};
  const days=(Array.isArray(av.external_strength_days)?av.external_strength_days:[]).map(Number).filter(x=>x>=1&&x<=7);
  const weeks=await sb('training_weeks',`athlete_id=eq.${encodeURIComponent(athleteId)}&status=eq.draft&end_date=gte.${effective}&select=id,week_start,end_date,status&order=week_start.asc`);
  let created=0,removed=0;
  for(const week of weeks){
    const rows=await sb('workouts',`athlete_id=eq.${encodeURIComponent(athleteId)}&training_week_id=eq.${encodeURIComponent(week.id)}&select=*`);
    const ext=rows.filter(w=>Array.isArray(w.blocks)&&w.blocks.some(b=>b?.type==='runflow_external_strength'));
    for(const w of ext){const wd=((new Date(`${String(w.workout_date).slice(0,10)}T12:00:00Z`).getUTCDay()+6)%7)+1;if(!days.includes(wd)){await sb('workouts',`id=eq.${encodeURIComponent(w.id)}`,{method:'DELETE',prefer:'return=minimal'});removed++;}}
    for(const day of days){const date=addDays(week.week_start,day-1);if(date<effective||date>week.end_date)continue;const exists=rows.some(w=>String(w.workout_date).slice(0,10)===date&&sportKey(w.sport)==='strength');if(exists)continue;
      const id=crypto.randomUUID();const row={id,athlete_id:athleteId,training_week_id:week.id,workout_date:date,sport:'Strength',title:'Fuerza externa',summary:'Sesión de fuerza realizada por el atleta en su gimnasio. RunFlow reserva el día y el atleta completa después duración real y RPE.',structured_description:'Fuerza externa. Contenido definido fuera de RunFlow. Tras realizarla: registrar duración real y RPE.',planned_load:0,planned_duration_min:null,planned_distance_km:null,planned_elevation_m:null,is_strength:true,priority:'B',blocks:[{type:'runflow_external_strength',source:'athlete_profile'}],publication_status:'draft'};
      await sb('workouts','',{method:'POST',body:row,prefer:'return=minimal'});created++;
    }
  }
  return{created,removed,weeks:weeks.length,effective_date:effective};
}

async function athleteLoadEstimate(athleteId,sport,duration,rpe,plannedLoad=0,plannedDuration=0){
  const acts=await sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&load=gt.0&select=load,duration_sec,sport&order=activity_date.desc&limit=100`).catch(()=>[]);
  const pm=acts.filter(a=>sportKey(a.sport)===sport&&Number(a.duration_sec)>0).map(a=>Number(a.load)/(Number(a.duration_sec)/60)).filter(x=>Number.isFinite(x)&&x>0);
  if(pm.length>=3){const base=pctl(pm,.25),factor=Math.min(1.05,Math.max(.6,.75+(Number(rpe||5)-5)*.06));return{load:Math.max(1,Math.round(duration*base*factor)),source:'estimated_athlete_sport_history',confidence:pm.length>=8?'medium':'low'}}
  if(plannedLoad>0&&plannedDuration>0)return{load:Math.max(1,Math.round(plannedLoad*duration/plannedDuration)),source:'estimated_from_planned_load',confidence:'low'};
  if(rpe>0)return{load:Math.max(1,Math.round(duration*rpe/10)),source:'estimated_conservative_fallback',confidence:'low'};
  return{load:null,source:'insufficient',confidence:'none'};
}
async function reconcileFeedback(athleteId){
  const logs=await sb('manual_session_logs',`athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=not.is.null&status=in.(completed,partial)&select=*&order=created_at.asc`).catch(()=>[]);if(!logs.length)return{created:0,replaced:0};
  const ids=[...new Set(logs.map(x=>x.workout_id).filter(Boolean))],workouts=await sb('workouts',`athlete_id=eq.${encodeURIComponent(athleteId)}&id=in.(${ids.join(',')})&select=*`).catch(()=>[]),wk=new Map(workouts.map(x=>[String(x.id),x]));
  const acts=await sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=in.(${ids.join(',')})&select=*`).catch(()=>[]);let created=0,replaced=0;
  for(const log of logs){const w=wk.get(String(log.workout_id));if(!w)continue;const linked=acts.filter(a=>String(a.workout_id)===String(w.id)),objective=linked.find(a=>!String(a.intervals_activity_id||'').startsWith('runflow-feedback-'));
    const synthetic=linked.filter(a=>String(a.intervals_activity_id||'').startsWith('runflow-feedback-'));if(objective&&synthetic.length){for(const s of synthetic){await sb('activities',`id=eq.${encodeURIComponent(s.id)}`,{method:'DELETE',prefer:'return=minimal'});replaced++;}continue}if(linked.length)continue;
    const duration=Number(log.actual_duration_min||w.planned_duration_min||0);if(!duration)continue;const est=await athleteLoadEstimate(athleteId,sportKey(w.sport),duration,Number(log.rpe||0),Number(w.planned_load||0),Number(w.planned_duration_min||0));if(est.load==null)continue;const id=crypto.randomUUID();await sb('activities','',{method:'POST',body:{id,athlete_id:athleteId,workout_id:w.id,intervals_activity_id:`runflow-feedback-${log.id||id}`,activity_date:`${String(w.workout_date).slice(0,10)}T12:00:00Z`,sport:w.sport||'Other',name:w.title||'Sesión realizada en RunFlow',duration_sec:Math.round(duration*60),distance_m:null,elevation_gain_m:null,load:est.load,avg_hr:null,max_hr:null,avg_pace_sec_per_km:null,raw_summary:{source:'runflow_manual_feedback',rpe:log.rpe,pain:log.pain,feeling:log.feeling,runflow_load:{...est,estimated_at:new Date().toISOString()}}},prefer:'return=minimal'});created++;
  }
  return{created,replaced};
}

async function comparisons(athleteId){
  const activities=await sb('activities',`athlete_id=eq.${encodeURIComponent(athleteId)}&workout_id=not.is.null&select=*&order=activity_date.asc&limit=240`).catch(()=>[]);if(activities.length<2)return{comparisons:[],metric:'pace_sec_per_km_div_avg_hr'};
  const ids=[...new Set(activities.map(a=>a.workout_id).filter(Boolean))],workouts=await sb('workouts',`athlete_id=eq.${encodeURIComponent(athleteId)}&id=in.(${ids.join(',')})&select=id,title,summary,structured_description,session_objective,adaptation_target,blocks,sport`).catch(()=>[]),wk=new Map(workouts.map(w=>[String(w.id),w]));
  const rows=activities.map(a=>{const w=wk.get(String(a.workout_id));return w?{a,w,identity:identity(w)}:null}).filter(Boolean);
  const pairs=[];for(let index=1;index<rows.length;index++){const previous=findPreviousComparable(rows,index);if(previous)pairs.push({previous:previous.row,current:rows[index],match:previous.match})}
  const recent=pairs.slice(-6),key=await intervalsKey(athleteId),cache=new Map();
  async function hydrated(row){const id=String(row.a.id);if(!cache.has(id))cache.set(id,ensureIntervals(athleteId,row.a,key));return{...row,a:await cache.get(id)}}
  const ready=await Promise.all(recent.map(async pair=>({match:pair.match,previous:await hydrated(pair.previous),current:await hydrated(pair.current)})));
  const out=[];let unavailable=0;for(const pair of ready){const prev=pair.previous,cur=pair.current,p=metricForSession(prev.a,prev.w),c=metricForSession(cur.a,cur.w);if(!p.available||!c.available){unavailable++;continue}const delta=Math.round((c.ratio-p.ratio)*10000)/10000,deltaPct=p.ratio?Math.round((delta/p.ratio)*1000)/10:null,result=delta<0?'MEJORA':delta>0?'EMPEORA':'IGUAL',type=cur.identity.type||cur.identity.comparison_group||cur.identity.name;
    out.push({group:type,session_type:type,match:pair.match,result,metric:'pace_sec_per_km_div_avg_hr',delta,delta_pct:deltaPct,previous:{activity_id:prev.a.id,workout_id:prev.w.id,date:String(prev.a.activity_date).slice(0,10),title:prev.w.title,...p},current:{activity_id:cur.a.id,workout_id:cur.w.id,date:String(cur.a.activity_date).slice(0,10),title:cur.w.title,...c},explanation:`${paceText(p.pace_sec_per_km)} a ${p.avg_hr.toFixed(1)} ppm = ${p.ratio.toFixed(4)} → ${paceText(c.pace_sec_per_km)} a ${c.avg_hr.toFixed(1)} ppm = ${c.ratio.toFixed(4)} (${deltaPct>0?'+':''}${deltaPct?.toFixed(1)||'0.0'}%). ${c.scope==='work_blocks'?`Media de ${c.work_blocks} bloques de trabajo.`:'Actividad completa.'}`});
  }return{comparisons:out.sort((a,b)=>String(b.current.date).localeCompare(String(a.current.date))),metric:'pace_sec_per_km_div_avg_hr',unavailable};
}

async function handle(req,res,url){const p=url.pathname,meth=req.method||'GET';let m=p.match(/^\/api\/v9\/coach\/athletes\/([^/]+)\/external-strength-sync$/);if(m&&meth==='POST'){const s=await session(req,res),id=decodeURIComponent(m[1]);await coach(s,id);json(res,200,await externalStrengthSync(id,await read(req)));return true}m=p.match(/^\/api\/v9\/coach\/athletes\/([^/]+)\/comparisons$/);if(m&&meth==='GET'){const s=await session(req,res),id=decodeURIComponent(m[1]);await coach(s,id);json(res,200,await comparisons(id));return true}if(p==='/api/v2/athlete/reconcile-feedback'&&meth==='POST'){const s=await session(req,res);role(s,'athlete');json(res,200,await reconcileFeedback(s.athlete_id));return true}return false}
const original=http.createServer;http.createServer=function(listener){return original.call(http,async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(!(/^\/api\/v9\/coach\/athletes\/[^/]+\/(external-strength-sync|comparisons)$/.test(url.pathname)||url.pathname==='/api/v2/athlete/reconcile-feedback'))return listener(req,res);try{if(!(await handle(req,res,url)))return listener(req,res)}catch(e){console.error('[v9-supplement]',e);json(res,Number(e.status||500),{error:e.message||'Error interno.'})}})};
