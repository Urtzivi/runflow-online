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

test('biblioteca de fuerza: cada ejercicio trae para qué sirve, explicación y vídeo',()=>{
  const cats=S.STRENGTH_CATEGORIES.map(c=>c.id);
  S.STRENGTH_LIBRARY.forEach(e=>{
    assert.ok(cats.includes(e.cat),e.name);
    assert.ok(e.why&&e.steps.length&&e.cues,e.name);
    assert.match(e.video,/^https:\/\//,e.name);
  });
  S.TEMPLATES.forEach(t=>{
    const block=S.fromTemplate(t.id);
    assert.equal(block.stations.length,t.stations.length,t.id);
    block.stations.forEach(st=>{assert.ok(st.why&&st.video,st.name);assert.equal(st.cat,undefined);});
  });
  assert.equal(S.sanitizeStation({name:'X',why:'<b>Isquios</b>'}).why,'bIsquios/b');
});

test('sanea la biblioteca propia del coach',()=>{
  const lib=S.sanitizeLibrary([{name:'Mi nórdico',cat:'prevencion',video:'https://youtu.be/abcdefghijk'},{name:'mi nórdico'},{name:''},{name:'Raro',cat:'hack',video:'javascript:x'}]);
  assert.deepEqual(lib.map(e=>e.name),['Mi nórdico','Raro']);
  assert.equal(lib[0].cat,'prevencion');
  assert.equal(lib[1].cat,'otros');
  assert.equal(lib[1].video,'');
});

const P=require('../public/js/football-strength-program.js');
test('programa guiado: elige días lejos del partido con 48 h o más',()=>{
  assert.deepEqual(P.chooseDays({days_per_week:2,match_day:5}),[1,3]); // sábado: martes (MD-4) y jueves (MD-2)
  assert.deepEqual(P.chooseDays({days_per_week:1,match_day:5}),[1]);
  P.chooseDays({days_per_week:2,match_day:6}).forEach(d=>assert.ok(![6,5,0].includes(d)));
});
test('programa guiado: 8 semanas = 16 sesiones de 6 partes con fases y esfuerzo',()=>{
  const g=P.generate({weeks:8,days_per_week:2,match_day:5,start:'2026-10-26'});
  assert.equal(g.blocks.length,16);
  assert.equal(g.events.length,16);
  assert.deepEqual(g.phases.map(p=>p.key),['aprender','fuerza','potencia','explosivo','cierre']);
  assert.equal(g.events[0].date,'2026-10-27');
  g.blocks.forEach(b=>{
    assert.equal(new Set(b.stations.map(s=>s.section)).size,6,b.name);
    assert.ok(b.effort);
    b.stations.forEach(s=>{assert.ok(s.why&&s.steps.length&&s.video&&s.effort&&s.sets,`${b.name} ${s.name}`);});
  });
  const clean=S.sanitizeStrength(g.blocks);
  assert.equal(clean.length,16);
  assert.equal(clean[0].stations[0].sets,g.blocks[0].stations[0].sets);
});
test('programa guiado: regresiones por nivel y material, menos series a mitad de liga',()=>{
  const names=a=>P.generate({weeks:8,days_per_week:2,match_day:5,...a}).blocks.flatMap(b=>b.stations.map(s=>s.name));
  assert.ok(names({level:'avanzado',material:'gimnasio'}).includes('Sentadilla frontal'));
  assert.ok(!names({level:'inicial',material:'mancuernas'}).includes('Sentadilla frontal'));
  assert.ok(names({material:'corporal'}).includes('Sentadilla al cajón'));
  const sets=season=>P.generate({weeks:8,days_per_week:2,match_day:5,season}).blocks[2].stations.find(s=>s.section==='Fuerza principal').sets;
  assert.ok(sets('media')<sets('inicio'));
});

test('disponibilidad del deportista: entrenos de fútbol a la semana tipo y tiempo para fuerza',()=>{
  const a=S.sanitizeAvailability({strength_min:40,football:[{day:3,time:'19:30',duration_min:75},{day:9},{day:1,time:'25:00'}]});
  assert.equal(a.strength_min,45);
  assert.deepEqual(a.football.map(f=>[f.day,f.time,f.duration_min]),[[1,'',90],[3,'19:30',75]]);
  const week=[[],[{kind:'football_training',time:'18:00'}],[{kind:'rest'}],[{kind:'rest'}],[{kind:'strength',strength_id:'b1'}],[],[]];
  const sched=S.applyFootballAvailability({week,events:[{date:'2026-10-31',kind:'match'}]},a.football);
  assert.equal(sched.week[1].filter(i=>i.kind==='football_training').length,1);
  assert.equal(sched.week[3][0].time,'19:30');
  assert.ok(!sched.week[3].some(i=>i.kind==='rest'));
  assert.equal(sched.week[4][0].kind,'strength');
  assert.equal(sched.events.length,1);
  assert.deepEqual(S.footballFromSchedule(sched).map(f=>f.day),[1,3]);
});
test('programa guiado: sesiones de 45 y 30 minutos mantienen lo esencial',()=>{
  const g45=P.generate({weeks:8,days_per_week:2,match_day:5,minutes:45});
  assert.equal(g45.events[0].duration_min,45);
  g45.blocks.forEach(b=>{assert.ok(!b.stations.some(s=>s.section==='Transferencia'));assert.ok(b.stations.some(s=>s.section==='Fuerza principal'));});
  const g30=P.generate({weeks:8,days_per_week:2,match_day:5,minutes:30});
  g30.blocks.forEach(b=>{
    assert.ok(b.stations.length<=9,b.name);
    assert.ok(b.stations.some(s=>s.section==='Fuerza específica y core'));
    assert.ok(!b.stations.some(s=>s.section==='Tren superior y core'));
  });
  assert.ok(g30.blocks[4].stations.some(s=>s.name==='Nórdico asistido'));
});
