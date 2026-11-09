const {test}=require('node:test');
const assert=require('node:assert/strict');
const planner=require('../assistant-planner.js');
const W=require('../assistant-week-edit.js');
const {MCP_TOOLS}=require('../assistant-api-hook.js');

// Semana del lunes 9/11. Hoy es miércoles 11/11.
const WEEK='2026-11-09',TODAY='2026-11-11';
// Ficha: martes y jueves 60', viernes 45', domingo 120' (day 1 = lunes).
const availability={configured:true,days:[1,2,3,4,5,6,7].map(day=>({day,can_train:[2,4,5,7].includes(day),activity_types:[2,4,5,7].includes(day)?['run']:['unavailable'],max_minutes:{2:60,4:60,5:45,7:120}[day]||null}))};
const id=n=>`00000000-0000-4000-8000-00000000000${n}`;
const current=[
  {id:id(1),workout_date:'2026-11-10',sport:'Run',title:'Rodaje suave',summary:'40 min suave',planned_duration_min:40,planned_load:30,blocks:[],updated_at:'t1'},
  {id:id(2),workout_date:'2026-11-12',sport:'Run',title:'Rodaje con cambios',summary:'45 min',planned_duration_min:45,planned_load:45,blocks:[],updated_at:'t2'},
  {id:id(3),workout_date:'2026-11-15',sport:'Run',title:'Tirada larga',summary:'90 min',planned_duration_min:90,planned_load:80,blocks:[],updated_at:'t3'},
];
function fakeDb({published=true,workouts=current,activities=[]}={}){
  return async(table)=>{
    if(table==='training_weeks')return [{id:'week-1',week_start:WEEK,title:'Semana 3',week_type:'Carga',coach_comment:'Ojo al pubis',status:published?'published':'draft'}];
    if(table==='workouts')return workouts.map(w=>({...w}));
    if(table==='activities')return activities;
    if(table==='manual_session_logs')return [];
    if(table==='athlete_profiles')return [{availability}];
    return [];
  };
}
const verifyWith=db=>w=>planner.verifyWeekProposal(db,'ath',WEEK,w);

test('quitar, mover, cambiar y añadir sesiones deja una propuesta con la semana completa',async()=>{
  const db=fakeDb();
  const result=await W.buildWeekEdit(db,'ath',{week_start:WEEK,reason:'Molestias en el pubis',changes:[
    {action:'modify',workout_id:id(2),workout:{title:'Rodaje suave',summary:'40 min muy suave',planned_duration_min:40}},
    {action:'move',workout_id:id(3),workout_date:'2026-11-14'},
    {action:'remove',workout_id:id(3)},
    {action:'add',workout_date:'2026-11-15',workout:{title:'Rodaje largo suave',planned_duration_min:70,blocks:[{type:'warmup',duration_min:10},{type:'main',name:'Rodaje',minutes:55},{type:'cooldown',duration_min:5}]}},
  ]},TODAY,verifyWith(db));
  assert.ok(result.data,JSON.stringify(result));
  const d=result.data;
  assert.equal(d.kind,'week_edit');
  assert.equal(d.status,'proposed');
  assert.equal(d.base.published,true);
  assert.equal(d.base.signature,W.signature(current));
  assert.equal(d.changes.length,4);
  // La sesión del martes (pasada) se conserva entera para no perder nada al reescribir la semana.
  const kept=d.week.workouts.find(w=>w.id===id(1));
  assert.equal(kept.summary,'40 min suave');
  assert.equal(d.week.workouts.find(w=>w.id===id(2)).structured_description,'40 min muy suave');
  assert.ok(!d.week.workouts.some(w=>w.id===id(3)));
  const added=d.week.workouts.find(w=>w.title==='Rodaje largo suave');
  assert.ok(added&&!('id' in added));
  // Los datos de la semana se mantienen.
  assert.equal(d.week.coach_comment,'Ojo al pubis');
  assert.equal(d.week.week_type,'Carga');
});

test('no deja tocar sesiones hechas ni de días pasados',async()=>{
  const db=fakeDb({activities:[{workout_id:id(2)}]});
  const result=await W.buildWeekEdit(db,'ath',{week_start:WEEK,reason:'x',changes:[{action:'remove',workout_id:id(1)},{action:'modify',workout_id:id(2),workout:{planned_duration_min:30}},{action:'add',workout_date:'2026-11-10',workout:{title:'Tarde'}}]},TODAY,verifyWith(db));
  assert.equal(result.rejected,true);
  assert.equal(result.errors.length,3,JSON.stringify(result.errors));
});

test('vaciar la semana quita solo lo que aún no se ha hecho',async()=>{
  const db=fakeDb({published:false});
  const result=await W.buildWeekEdit(db,'ath',{week_start:WEEK,reason:'Viaje',clear_week:true},TODAY,verifyWith(db));
  assert.deepEqual(result.data.week.workouts.map(w=>w.id),[id(1)]);
  assert.equal(result.data.base.published,false);
});

test('el Verificador bloquea un fallo nuevo (día libre, minutos)',async()=>{
  const db=fakeDb();
  const libre=await W.buildWeekEdit(db,'ath',{week_start:WEEK,reason:'x',changes:[{action:'move',workout_id:id(2),workout_date:'2026-11-13'},{action:'add',workout_date:'2026-11-14',workout:{title:'Rodaje',planned_duration_min:30}}]},TODAY,verifyWith(db));
  assert.equal(libre.rejected,true);
  assert.ok(libre.verification.failures.some(f=>f.rule==='dia_libre'));
  const largo=await W.buildWeekEdit(db,'ath',{week_start:WEEK,reason:'x',changes:[{action:'modify',workout_id:id(2),workout:{planned_duration_min:90}}]},TODAY,verifyWith(db));
  assert.ok(largo.verification.failures.some(f=>f.rule==='minutos_dia'));
});

test('un fallo que la semana ya tenía avisa pero no bloquea',async()=>{
  const bad=[...current.slice(0,2),{...current[2],workout_date:'2026-11-14'}];
  const db=fakeDb({workouts:bad});
  const result=await W.buildWeekEdit(db,'ath',{week_start:WEEK,reason:'x',week:{coach_comment:'Semana más tranquila'}},TODAY,verifyWith(db));
  assert.ok(result.data,JSON.stringify(result));
  assert.ok(result.data.verification.already_failing.some(f=>f.rule==='dia_libre'));
  assert.equal(result.data.week.coach_comment,'Semana más tranquila');
});

test('pide reason, un lunes y algún cambio; workout_id desconocido se explica',async()=>{
  const db=fakeDb();
  await assert.rejects(W.buildWeekEdit(db,'ath',{week_start:WEEK,changes:[{action:'remove',workout_id:id(2)}]},TODAY,verifyWith(db)),/reason/);
  await assert.rejects(W.buildWeekEdit(db,'ath',{week_start:'2026-11-10',reason:'x',clear_week:true},TODAY,verifyWith(db)),/lunes/);
  await assert.rejects(W.buildWeekEdit(db,'ath',{week_start:WEEK,reason:'x'},TODAY,verifyWith(db)),/No hay cambios/);
  await assert.rejects(W.buildWeekEdit(db,'ath',{week_start:'2026-11-02',reason:'x',clear_week:true},TODAY,verifyWith(db)),/terminado/);
  const r=await W.buildWeekEdit(db,'ath',{week_start:WEEK,reason:'x',changes:[{action:'remove',workout_id:'nope'}]},TODAY,verifyWith(db));
  assert.match(r.errors[0],/get_week_sessions/);
});

test('get_week_sessions marca qué se puede tocar',async()=>{
  const week=await W.weekSessions(fakeDb({activities:[{workout_id:id(2)}]}),'ath',WEEK,TODAY);
  assert.equal(week.week.published,true);
  assert.deepEqual(week.sessions.map(s=>s.editable),[false,false,true]);
  assert.equal(week.sessions[1].done,true);
});

test('las herramientas nuevas están en el conector',()=>{
  const names=MCP_TOOLS.map(t=>t.name);
  assert.ok(names.includes('get_week_sessions'));
  assert.ok(names.includes('propose_week_changes'));
  assert.equal(MCP_TOOLS.find(t=>t.name==='get_week_sessions').annotations.readOnlyHint,true);
});
