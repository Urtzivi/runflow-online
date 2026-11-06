// Modo directo (apply_week_changes) de punta a punta por /mcp, con Supabase simulado.
process.env.SUPABASE_URL='http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY='service-test';
process.env.APP_ENCRYPTION_KEY='test-key-de-al-menos-24-caracteres';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');

const COACH='coach-1',ATH='ath-1',CRED='cred-1';
const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
const now=new Date();const monday=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+7));monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
const day=n=>{const d=new Date(monday);d.setUTCDate(d.getUTCDate()+n);return iso(d)};
const WEEK=day(0);
const id=n=>`00000000-0000-4000-8000-00000000000${n}`;
const availability={configured:true,days:[1,2,3,4,5,6,7].map(d=>({day:d,can_train:[2,4,7].includes(d),activity_types:[2,4,7].includes(d)?['run']:['unavailable'],max_minutes:{2:60,4:60,7:120}[d]||null}))};

const token=(()=>{const payload=Buffer.from(JSON.stringify({id:CRED,coach_user_id:COACH,scopes:['read','draft'],exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `rfa1.${payload}.${crypto.createHmac('sha256',process.env.APP_ENCRYPTION_KEY).update(payload).digest('base64url')}`})();
const db={scopes:['read','draft'],applyDisabled:true,weekStatus:'published',posted:[]};
const workouts=()=>[
  {id:id(1),workout_date:day(1),sport:'Run',title:'Rodaje',summary:'40 min',planned_duration_min:40,planned_load:30,blocks:[],updated_at:'a'},
  {id:id(2),workout_date:day(6),sport:'Run',title:'Tirada larga',summary:'90 min',planned_duration_min:90,planned_load:80,blocks:[],updated_at:'b'},
];
global.fetch=async(url,options={})=>{
  const u=new URL(url),table=u.pathname.split('/').pop(),method=options.method||'GET',q=decodeURIComponent(u.search);
  const ok=data=>({ok:true,status:200,text:async()=>JSON.stringify(data)});
  if(method==='POST'){const body=JSON.parse(options.body);db.posted.push(body);return ok([body])}
  if(method==='PATCH')return ok([]);
  if(table==='workout_templates'&&q.includes(CRED))return ok([{id:CRED,template_data:{status:'active',scopes:db.scopes,apply_disabled:db.applyDisabled,token_hash:crypto.createHash('sha256').update(token).digest('hex')}}]);
  if(table==='workout_templates')return ok([]);
  if(table==='coach_athletes')return ok([{athlete_id:ATH}]);
  if(table==='training_weeks')return ok([{id:'w-1',week_start:WEEK,title:'Semana',week_type:'Carga',coach_comment:'',status:db.weekStatus}]);
  if(table==='workouts')return ok(workouts());
  if(table==='athlete_profiles')return ok([{availability}]);
  return ok([]);
};
const writes=[];
globalThis.__runflowWeekWriter={
  publish:async(athleteId,body)=>{writes.push(['publish',athleteId,body]);return{week:{...body,workouts:body.workouts.map((w,i)=>({id:w.id||`n${i}`,...w}))},intervals:{created:1}}},
  saveDraft:async(athleteId,body)=>{writes.push(['draft',athleteId,body]);return{...body}},
};
const {handleMcp}=require('../assistant-api-hook.js');

async function call(name,args){
  let status,body;const res={writeHead(s){status=s},end(b){body=b}};
  const req={method:'POST',headers:{authorization:`Bearer ${token}`},async *[Symbol.asyncIterator](){yield JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}};
  try{await handleMcp(req,res,new URL('http://x/mcp'))}catch(error){return{error}}
  return{status,data:JSON.parse(body)};
}
const change={athlete_id:ATH,week_start:WEEK,reason:'Pubis cargado',coach_confirmation:'sí, cámbialo',changes:[{action:'modify',workout_id:id(2),workout:{title:'Rodaje largo suave',planned_duration_min:60}}]};

test('si el entrenador apaga el modo directo no aplica nada',async()=>{
  const r=await call('apply_week_changes',change);
  assert.equal(r.error.status,403);
  assert.match(r.error.message,/modo directo/i);
  assert.equal(writes.length,0);
});

test('por defecto (modo directo), una semana publicada se publica (llega al atleta) y queda en el historial',async()=>{
  db.applyDisabled=undefined;db.posted=[];
  const r=await call('apply_week_changes',change);
  assert.equal(r.data.result.isError,false,JSON.stringify(r.data));
  const out=r.data.result.structuredContent;
  assert.equal(out.applied,true);assert.equal(out.published,true);
  assert.equal(writes.at(-1)[0],'publish');
  const sent=writes.at(-1)[2].workouts;
  assert.equal(sent.find(w=>w.id===id(2)).planned_duration_min,60);
  assert.equal(sent.find(w=>w.id===id(1)).summary,'40 min');
  const record=db.posted.find(x=>x.template_data?.status==='applied');
  assert.ok(record,'guarda el cambio aplicado');
  assert.equal(record.template_data.coach_confirmation,'sí, cámbialo');
  assert.equal(record.template_data.previous.workouts.length,2);
});

test('una semana en borrador queda en borrador salvo publish=true',async()=>{
  db.weekStatus='draft';
  await call('apply_week_changes',change);
  assert.equal(writes.at(-1)[0],'draft');
  await call('apply_week_changes',{...change,publish:true});
  assert.equal(writes.at(-1)[0],'publish');
  db.weekStatus='published';
});

test('el Verificador sigue mandando y la frase del entrenador es opcional',async()=>{
  const before=writes.length;
  const blocked=await call('apply_week_changes',{...change,changes:[{action:'move',workout_id:id(1),workout_date:day(2)}]});
  assert.equal(blocked.data.result.isError,true);
  assert.match(blocked.data.result.content[0].text,/no puede entrenar/);
  assert.equal(writes.length,before);
  const sinFrase=await call('apply_week_changes',{...change,coach_confirmation:''});
  assert.equal(sinFrase.data.result.structuredContent.applied,true);
});
