(() => {
'use strict';
const originalFetch=window.fetch.bind(window);
const WRITE=new Set(['POST','PUT','PATCH','DELETE']);
const PLAN_PATH=/^\/api\/coach\/athletes\/([^/]+)\/(?:seasons|goals|macrocycles|mesocycles|microcycles)(?:\/|$)/;

function headerValue(headers,name){
  if(!headers)return'';
  if(headers instanceof Headers)return headers.get(name)||'';
  if(Array.isArray(headers)){const row=headers.find(x=>String(x?.[0]).toLowerCase()===name.toLowerCase());return row?.[1]||''}
  const key=Object.keys(headers).find(k=>k.toLowerCase()===name.toLowerCase());return key?headers[key]:'';
}
function parseBody(body){if(!body)return{};if(typeof body==='string'){try{return JSON.parse(body)}catch{return{}}}return body&&typeof body==='object'&&!('append' in body)?body:{}}
function libId(workout){
  if(workout?.runflow_library_id)return workout.runflow_library_id;
  return (Array.isArray(workout?.blocks)?workout.blocks:[]).find(x=>x?.type==='runflow_meta'&&x.library_id)?.library_id||null;
}
function compact(payload){
  if(!payload||typeof payload!=='object')return{};
  const keys=['id','name','title','start_date','end_date','week_start','goal_id','season_id','macrocycle_id','mesocycle_id','microcycle_id','type','status','lifecycle_status','publication_status','primary_objective','primary_adaptation','planned_load','planned_duration_min','planned_distance_km','planned_elevation_m'];
  const out={};keys.forEach(k=>{if(payload[k]!==undefined)out[k]=payload[k]});
  if(payload.planned&&typeof payload.planned==='object')out.planned=payload.planned;
  if(payload.notes)out.notes=String(payload.notes).slice(0,1600);
  if(Array.isArray(payload.workouts)){
    out.workout_count=payload.workouts.length;
    out.workouts=payload.workouts.slice(0,20).map(w=>({id:w.id||null,date:w.workout_date||null,title:w.title||null,sport:w.sport||null,priority:w.priority||null,duration:w.planned_duration_min??null,library_id:libId(w)}));
  }
  return out;
}
function entityType(path){for(const x of ['microcycles','mesocycles','macrocycles','goals','seasons'])if(path.includes(`/${x}`))return x.slice(0,-1);return'planning'}
function origin(path,payload,headers){
  const explicit=String(headerValue(headers,'X-RunFlow-Planning-Origin')||'').toLowerCase();
  if(['manual','imported','runflow_generated','ai_accepted','ai_modified'].includes(explicit))return explicit;
  const text=`${path} ${payload?.notes||''} ${payload?.source||''} ${payload?.origin||''}`.toLowerCase();
  if(/plan[_ -]?v2|importad|import_/.test(text))return'imported';
  if(/runflow_v9_final|runflow_generated|v9_final/.test(text))return'runflow_generated';
  return'manual';
}
function seasonId(){try{return state?.selectedSeasonId||state?.plan?.season?.id||null}catch{return null}}
async function record(athleteId,path,method,payload,headers){
  const body={origin:origin(path,payload,headers),entity_type:entityType(path),action:method.toLowerCase(),path,season_id:seasonId(),context:{captured_from:'coach_web',captured_at:new Date().toISOString()},payload:compact(payload)};
  try{await originalFetch(`/api/v9/coach/athletes/${encodeURIComponent(athleteId)}/learning-event`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}catch(error){console.warn('[RunFlow Learning] No se pudo registrar decisión',error)}
}
window.fetch=async function runflowLearningFetch(input,init={}){
  const raw=typeof input==='string'?input:input?.url||'';
  let url;try{url=new URL(raw,location.origin)}catch{return originalFetch(input,init)}
  const method=String(init.method||(typeof input!=='string'&&input?.method)||'GET').toUpperCase();
  const match=url.origin===location.origin&&WRITE.has(method)?url.pathname.match(PLAN_PATH):null;
  const response=await originalFetch(input,init);
  if(match&&response.ok){
    const payload=parseBody(init.body);
    record(decodeURIComponent(match[1]),url.pathname,method,payload,init.headers).catch(()=>{});
  }
  return response;
};
window.RunFlowLearning={recordPlanningEvent:record};
})();
