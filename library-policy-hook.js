'use strict';

// Operational library policy: never rewrite a 70-minute session as 60.
// Non-long sessions >60 min remain in the source catalogue but are excluded from
// the selectable RunFlow library until a coherent <=60 min variant exists.
const http=require('http');
const fs=require('fs');
const path=require('path');
const zlib=require('zlib');
const {URL}=require('url');
const SUPABASE_URL=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_ANON_KEY=String(process.env.SUPABASE_ANON_KEY||'');
const SUPABASE_SERVICE_ROLE_KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
const IS_PROD=process.env.NODE_ENV==='production';
const DATA_DIR=path.join(__dirname,'data');

function parseCookies(req){const out={};String(req.headers.cookie||'').split(';').forEach(part=>{const i=part.indexOf('=');if(i<0)return;const k=part.slice(0,i).trim(),v=part.slice(i+1).trim();if(k)out[k]=decodeURIComponent(v)});return out}
function cookie(name,value,maxAge){return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${IS_PROD?'; Secure':''}; Max-Age=${maxAge}`}
function sendJson(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body)}
async function fetchJson(url,opt={}){const r=await fetch(url,opt),text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok){const msg=data&&typeof data==='object'?(data.message||data.error_description||data.error||data.details):data;throw Object.assign(new Error(msg||`HTTP ${r.status}`),{status:r.status,details:data})}return data}
async function sb(table,query=''){if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY)throw Object.assign(new Error('Supabase no está configurado.'),{status:503});return fetchJson(`${SUPABASE_URL}/rest/v1/${table}${query?`?${query}`:''}`,{headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`}})}
async function authUser(access){return fetchJson(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${access}`}})}
async function authRefresh(refresh){return fetchJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refresh})})}
async function requireCoach(req,res){const c=parseCookies(req);let access=c.rf_access,refresh=c.rf_refresh;if(!access)throw Object.assign(new Error('Debes iniciar sesión.'),{status:401});let user;try{user=await authUser(access)}catch{if(!refresh)throw Object.assign(new Error('Debes iniciar sesión.'),{status:401});const x=await authRefresh(refresh);access=x.access_token;refresh=x.refresh_token||refresh;user=x.user||await authUser(access);res.setHeader('Set-Cookie',[cookie('rf_access',access,Math.max(60,Number(x.expires_in)||3600)),cookie('rf_refresh',refresh,60*60*24*30)])}const roles=await sb('user_roles',`user_id=eq.${encodeURIComponent(user.id)}&select=role`);if(!roles.some(x=>x.role==='coach'))throw Object.assign(new Error('No tienes permiso para realizar esta acción.'),{status:403})}
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function isLongRun(row){const t=norm(`${row.Nombre||''} ${row.Familia||''} ${row.Objetivo_primario||''}`);return /tirada larga|long run|duracion larga|larga aerobica/.test(t)}
let cache=null;
function library(){
  if(cache)return cache;
  const files=fs.readdirSync(DATA_DIR).filter(name=>/^runflow-v9-library\.part\d+\.b64$/.test(name)).sort((a,b)=>Number(a.match(/part(\d+)/)[1])-Number(b.match(/part(\d+)/)[1]));
  const encoded=files.map(name=>fs.readFileSync(path.join(DATA_DIR,name),'utf8').trim()).join('');
  if(!encoded)throw Object.assign(new Error('Biblioteca V9 no disponible.'),{status:503});
  const compact=JSON.parse(zlib.gunzipSync(Buffer.from(encoded,'base64')).toString('utf8'));
  const keyMap={i:'ID',n:'Nombre',d:'Disciplina',f:'Familia',o:'Objetivo_primario',ph:'Fases',g:'Objetivos_prueba',lv:'Nivel_1_5',tm:'Tiempo_total_min',wu:'Calentamiento',bp:'Bloque_principal',cd:'Vuelta_calma',int:'Intensidad_prescrita',r:'RPE_sesion_estimado',ter:'Terreno',e:'Desnivel_requerido',mat:'Material',rec:'Recuperacion_recomendada_h',pr:'Progresion_anterior_ID',nx:'Progresion_siguiente_ID',cg:'Grupo_comparacion',cmp:'Comparabilidad',sel:'Condiciones_seleccion',no:'No_usar_si',ok:'Criterio_exito',adj:'Regla_ajuste',l:'Carga_sRPE_est',lr:'Carga_relativa_1_5'};
  const source=(compact.s||[]).map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[keyMap[k]||k,v])));
  const excluded=source.filter(row=>Number(row.Tiempo_total_min)>60&&!isLongRun(row));
  const sessions=source.filter(row=>!(Number(row.Tiempo_total_min)>60&&!isLongRun(row))).map(row=>({...row,Politica_duracion_RunFlow:isLongRun(row)&&Number(row.Tiempo_total_min)>60?'tirada_larga_exenta':'max_60'}));
  const nonLong=sessions.filter(row=>!isLongRun(row));
  const band45=nonLong.filter(row=>Number(row.Tiempo_total_min)>=40&&Number(row.Tiempo_total_min)<=50).length;
  const band60=nonLong.filter(row=>Number(row.Tiempo_total_min)>50&&Number(row.Tiempo_total_min)<=60).length;
  cache={version:'Biblioteca RunFlow de Sesiones v1 · política operativa 60 min',sessions,count:sessions.length,policy:{non_long_max_minutes:60,long_runs_exempt:true,selection_balance_targets_min:[45,60],source_count:source.length,excluded_over_60_non_long:excluded.length,band_45_count:band45,band_60_count:band60,note:'Los registros fuente >60 min que no son tirada larga se conservan pero no son seleccionables. No se recortan automáticamente.'}};
  return cache;
}

const previousCreateServer=http.createServer;
http.createServer=function policyCreateServer(listener){return previousCreateServer.call(http,async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname==='/api/v9/library'&&(req.method||'GET')==='GET'){try{await requireCoach(req,res);return sendJson(res,200,library())}catch(error){console.error('[library-policy-hook]',error);return sendJson(res,Number(error.status||500),{error:error.message||'Error interno.'})}}return listener(req,res)})};
