const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../public/js/football-schedule.js');

// Semana del 5 al 11 de octubre de 2026: entreno mar y jue 19:00, fuerza A mar y vie; partido el sábado 10.
const block={id:'a',name:'Fuerza A',format:'circuit',rounds:3,transition_sec:15,rest_sec:120,stations:[
  {name:'Sentadilla goblet',work:'10 reps'},{name:'Zancada atrás',work:'6 / pierna'},{name:'Puente',work:'40 s'}]};
const program={
  strength:[block],
  schedule:{week:[[],[{kind:'football_training',time:'19:00',duration_min:90},{kind:'strength',strength_id:'a'}],[],[{kind:'football_training',time:'19:00',duration_min:90}],[{kind:'strength',strength_id:'a'}],[],[{kind:'rest'}]],
    events:[{id:'m1',date:'2026-10-10',kind:'match',time:'11:00',rival:'Ariznabarra',home:false},
      {id:'c1',date:'2026-10-08',kind:'cancel',cancel_kind:'football_training'}]},
};

test('resuelve la semana con partido, cancelaciones y etiquetas MD',()=>{
  const days=S.resolvePlan(program,'2026-10-05','2026-10-12');
  const byDate=Object.fromEntries(days.map(d=>[d.date,d]));
  assert.equal(byDate['2026-10-06'].items.length,2);
  assert.equal(byDate['2026-10-06'].md,'MD-4');
  assert.equal(byDate['2026-10-08'].items.length,0,'el entreno del jueves está cancelado');
  assert.equal(byDate['2026-10-10'].md,'MD');
  assert.equal(byDate['2026-10-10'].items[0].title,'Partido vs Ariznabarra');
  assert.equal(byDate['2026-10-10'].items[0].duration_min,70);
  assert.equal(byDate['2026-10-11'].md,'MD+1');
  assert.equal(byDate['2026-10-11'].items[0].kind,'rest');
  assert.deepEqual(byDate['2026-10-09'].warnings,['Fuerza el día antes del partido.']);
  assert.equal(byDate['2026-10-06'].items[1].duration_min,S.blockMinutes(block));
});

test('marca las sesiones valoradas y las pendientes',()=>{
  const days=S.resolvePlan(program,'2026-10-05','2026-10-12');
  const key=days[1].items[0].key;
  S.attachRatings(days,[{plan_key:key,rpe:6}],'2026-10-10');
  assert.ok(days[1].items[0].rating);
  assert.equal(days[1].items[0].pending,false);
  assert.equal(days[1].items[1].pending,true,'la fuerza del martes sigue sin valorar');
  assert.equal(days[5].items[0].pending,true,'el partido de hoy se puede valorar');
  assert.equal(days[6].items[0].pending,undefined,'el descanso no se valora');
});

test('estima la duración de un circuito',()=>{
  // 10 reps ≈ 35 s, 6/pierna ≈ 42 s, 40 s; + 3 × 15 s de cambio = 162 s por vuelta; 3 vueltas + 2 × 120 s.
  assert.equal(S.blockMinutes(block),Math.round((162*3+240)/60));
  assert.equal(S.timedSeconds('40 s'),40);
  assert.equal(S.timedSeconds('30 s / lado'),30);
  assert.equal(S.timedSeconds('10 reps'),null);
});

test('sanea la semana y los bloques',()=>{
  const clean=S.sanitizeSchedule({week:[[{kind:'hack',time:'25:00'}],[{kind:'football_training',time:'9:30',duration_min:999}]],events:[{date:'2026-13-01',kind:'match'},{date:'2026-10-11',kind:'match',rival:'<b>X</b>',importance:'final'}]});
  assert.equal(clean.week[0].length,0);
  assert.equal(clean.week[1][0].time,'09:30');
  assert.equal(clean.week[1][0].duration_min,300);
  assert.equal(clean.events.length,1);
  assert.equal(clean.events[0].rival,'bX/b');
  assert.equal(clean.events[0].importance,'league');
  const blocks=S.sanitizeStrength([{id:'a',name:'A',stations:[{name:'Sentadilla',video:'javascript:alert(1)'}]},{id:'a',name:'B'}]);
  assert.equal(blocks[0].stations[0].video,'');
  assert.notEqual(blocks[0].id,blocks[1].id);
});
