const {test}=require('node:test');
const assert=require('node:assert/strict');
const football=require('../assistant-football.js');
const {MCP_TOOLS}=require('../assistant-api-hook.js');

// Semana tipo: entreno martes y jueves 19:30, fuerza viernes. Partido sábado 16:30 y otro sábado sin hora.
const program={
  schedule:{week:[[],[{kind:'football_training',time:'19:30',duration_min:90}],[],[{kind:'football_training',time:'19:30',duration_min:90}],[{kind:'strength',strength_id:'a',time:'18:00'}],[],[]],
    events:[{id:'p1',date:'2026-11-14',kind:'match',time:'16:30',rival:'Aurrera',home:false,importance:'league',place:'Olaranbe'},
            {id:'p2',date:'2026-11-21',kind:'match',rival:'Sesto'}]},
  strength:[{id:'a',name:'Fuerza A',stations:[{name:'Sentadilla',work:'40s'}]}],
};

test('devuelve el próximo partido con hora y lo que hay el día antes',()=>{
  const r=football.matchesFromProgram(program,'2026-11-08',10);
  assert.equal(r.partidos.length,1);
  const p=r.proximo_partido;
  assert.equal(p.fecha,'2026-11-14');assert.equal(p.dia,'sábado');assert.equal(p.dias_hasta,6);
  assert.equal(p.hora,'16:30');assert.equal(p.hora_metida,true);assert.equal(p.en_casa,false);assert.equal(p.rival,'Aurrera');
  assert.deepEqual(p.dia_anterior.map(i=>i.titulo),['Fuerza A']);
  assert.deepEqual(p.mismo_dia,[]);
});

test('marca el partido sin hora',()=>{
  const r=football.matchesFromProgram(program,'2026-11-15',10);
  assert.equal(r.proximo_partido.fecha,'2026-11-21');
  assert.equal(r.proximo_partido.hora,null);assert.equal(r.proximo_partido.hora_metida,false);
});

test('sin programa de fútbol no falla',()=>{
  const r=football.matchesFromProgram(null,'2026-11-08');
  assert.equal(r.tiene_programa_futbol,false);assert.equal(r.proximo_partido,null);
});

test('lee el programa más reciente del atleta y respeta from/days',async()=>{
  const calls=[];
  const sb=async(table,query)=>{calls.push([table,query]);return [{template_data:program}]};
  const r=await football.footballMatches(sb,'ath-1',{from:'2026-11-13',days:2},'2026-11-08');
  assert.equal(calls[0][0],'workout_templates');assert.match(calls[0][1],/athlete_id=eq\.ath-1/);assert.match(calls[0][1],/__runflow_football_program__/);
  assert.equal(r.hoy,'2026-11-08');assert.equal(r.desde,'2026-11-13');assert.equal(r.hasta,'2026-11-14');assert.equal(r.partidos.length,1);
});

test('la herramienta MCP es de solo lectura',()=>{
  const tool=MCP_TOOLS.find(t=>t.name==='get_football_matches');
  assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.deepEqual(tool.inputSchema.required,['athlete_id']);
});

const meta=m=>'RF_FOOTBALL|'+JSON.stringify(m);
const logs=[
  {id:'l1',created_at:'2026-11-14T19:00:00Z',rpe:8,pain:5,pain_area:'rodilla derecha',feeling:'bien',actual_duration_min:60,
   comment:meta({kind:'match',plan_date:'2026-11-14',minutes_played:60,note:'Cansado al final',body_state:2,mood:4,match:{result:'win',goals_for:3,goals_against:1,role:'starter',rating:7,best:'Presión',improve:'Pase largo',q1:'Bien'}})},
  {id:'l2',created_at:'2026-11-13T18:00:00Z',rpe:5,comment:meta({kind:'wellbeing',energy:4,soreness:2})},
  {id:'l3',created_at:'2026-11-13T18:00:00Z',comment:'texto libre de running'},
];

test('valoraciones: resume el partido, avisa del dolor y marca lo que falta por valorar',()=>{
  const r=football.feedbackSummary(logs,program,'2026-11-13','2026-11-21');
  assert.equal(r.valoraciones.length,2);
  const p=r.valoraciones.find(v=>v.kind==='match');
  assert.equal(p.minutos_jugados,60);assert.equal(p.rpe_1_10,8);assert.equal(p.comentario,'Cansado al final');
  assert.equal(p.partido.resultado,'ganado');assert.equal(p.partido.rol,'titular');assert.equal(p.partido.a_mejorar,'Pase largo');assert.deepEqual(p.partido.mi_partido_por_dentro,{q1:'Bien'});
  assert.deepEqual(r.alertas,['Dolor 5/10 en rodilla derecha (Partido, 2026-11-14).']);
  assert.deepEqual(r.partidos.map(x=>[x.fecha,x.valorado]),[['2026-11-14',true],['2026-11-21',false]]);
  assert.equal(r.partidos_sin_valorar.length,1);
});

test('valoraciones: lee logs y programa del atleta',async()=>{
  const calls=[];
  const sb=async(table,query)=>{calls.push([table,query]);return table==='workout_templates'?[{template_data:program}]:logs};
  const r=await football.footballFeedback(sb,'ath-1',{},'2026-11-14');
  assert.equal(r.desde,'2026-11-12');assert.equal(r.hasta,'2026-11-14');
  assert.ok(calls.some(([t,q])=>t==='manual_session_logs'&&/athlete_id=eq\.ath-1/.test(q)));
  assert.equal(r.partidos_sin_valorar.length,0);
  const tool=MCP_TOOLS.find(t=>t.name==='get_football_feedback');assert.equal(tool.annotations.readOnlyHint,true);
});
