const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../assistant-analyst.js');
const {cleanDraft}=require('../assistant-api-hook.js');
const fx=require('./fixtures-analyst-session.json');

const detail=(over={})=>({activity:fx.activity,planned:fx.planned,block_analysis:{blocks:fx.blocks},athlete_zones:{hr:[],pace:[]},feedback:{rpe:7,feeling:'bien',pain:0,comment:'Bien las series'},recovery:[],...over});

test('sessionFacts: series de umbral reales → efecto umbral que coincide con el plan',()=>{
  const f=A.sessionFacts(detail());
  assert.equal(f.efecto_entrenamiento.titular,'Umbral');
  assert.equal(f.efecto_entrenamiento.respecto_al_plan.cumple,true);
  assert.equal(f.planificado.tipo_detectado,'threshold');
  assert.equal(f.cumplimiento_pct,85);
  assert.equal(f.bloques.bloques.filter(b=>b.fase==='work').length,4);
  assert.equal(f.valoracion_atleta.esfuerzo_rpe_1a10,7);
  assert.equal(f.actividad.cadencia_media,157);
  assert.deepEqual(f.datos_que_faltan,[]);
});

test('sessionFacts: sin plan ni valoración lo dice en datos_que_faltan',()=>{
  const f=A.sessionFacts(detail({planned:null,feedback:null,block_analysis:null}));
  assert.equal(f.planificado,null);
  assert.equal(f.efecto_entrenamiento.respecto_al_plan,undefined);
  assert.equal(f.datos_que_faltan.length,3);
});

test('checkinOf lee el chequeo diario de la app',()=>{
  const c=A.checkinOf({comment:'RUNFLOW_DAILY_CHECKIN:{"kind":"daily_checkin","date":"2026-11-07","recovery_score":1,"comment":"Sigo enfermo"}'});
  assert.deepEqual(c,{date:'2026-11-07',recuperacion_1a5:1,comentario:'Sigo enfermo'});
  assert.equal(A.checkinOf({comment:'Hola'}),null);
});

test('sessionsToAnalyze separa las actividades que ya tienen informe',async()=>{
  const sb=async(table)=>{assert.equal(table,'activities');return[{id:'u1',athlete_id:'a1',intervals_activity_id:'i1',activity_date:'2026-11-06T10:00:00Z',name:'Series',duration_sec:2400,workout_id:'w'},{id:'u2',athlete_id:'a1',intervals_activity_id:'i2',activity_date:'2026-11-07T10:00:00Z',name:'Rodaje',duration_sec:1800}]};
  const listDrafts=async()=>[{activity_id:'i1',informe_coach:'## Informe'},{activity_id:'i2'}];
  const r=await A.sessionsToAnalyze({sb,listDrafts},'c',[{id:'a1',display_name:'Ana'}],2,'2026-11-07');
  assert.equal(r.ya_analizadas,1);
  assert.deepEqual(r.pendientes.map(x=>x.activity_id),['i2']);
  assert.equal(r.pendientes[0].atleta,'Ana');
});

test('cleanDraft guarda el informe completo y valida objetivo_cumplido',()=>{
  const d=cleanDraft('ath',{kind:'session',activity_id:'i1',date:'2026-11-06',semaforo:'verde',mensaje_atleta:'Bien',informe_coach:'## Qué pasó\n…',objetivo_cumplido:'SI',efecto_principal:'Umbral (mejora)',resumen:'Cumplida.'});
  assert.equal(d.objetivo_cumplido,'si');assert.match(d.informe_coach,/Qué pasó/);assert.equal(d.resumen,'Cumplida.');
  assert.throws(()=>cleanDraft('ath',{kind:'week',week_start:'2026-11-02',semaforo:'verde',mensaje_atleta:'x',objetivo_cumplido:'quizá'}),e=>e.status===400);
});
