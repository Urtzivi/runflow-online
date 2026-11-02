const {test}=require('node:test');
const assert=require('node:assert/strict');
const I=require('../public/js/athlete-insights.js');

const zones={hr:[{zone_order:1,min_value:95,max_value:119},{zone_order:2,min_value:120,max_value:139},{zone_order:3,min_value:140,max_value:149},{zone_order:4,min_value:150,max_value:158},{zone_order:5,min_value:159,max_value:180}],
  pace:[{slow_pace:'06:00',fast_pace:'05:15'},{slow_pace:'05:10',fast_pace:'04:40'},{slow_pace:'04:35',fast_pace:'04:10'},{slow_pace:'04:09',fast_pace:'03:52'},{slow_pace:'03:51',fast_pace:'03:20'}]};
const vo2={title:'6 × 3 min VO₂max',sport:'Run',workout_date:'2026-10-27',blocks:[{type:'warmup',duration_min:15,target:'Z1-Z2'},{type:'central',name:'VO₂max',repetitions:6,work_value:3,work_unit:'m',target:'Z5 / VO₂max',recovery_value:2,recovery_unit:'m',recovery_target:'Z1'},{type:'cooldown',duration_min:10,target:'Z1'}]};

test('clasifica sesiones por título y bloques',()=>{
  assert.equal(I.classifySession(vo2),'vo2');
  assert.equal(I.classifySession({title:'3 × 8 min umbral',sport:'Run'}),'threshold');
  assert.equal(I.classifySession({title:'Rodaje regenerativo',summary:'30 min muy suaves',sport:'Run'}),'recovery');
  assert.equal(I.classifySession({title:'Tirada larga aeróbica',sport:'Run'}),'long');
  assert.equal(I.classifySession({title:'Fuerza general',sport:'Strength'}),'strength');
  assert.equal(I.classifySession(null),'rest');
});

test('el paso a paso usa las zonas del atleta',()=>{
  const plan=I.sessionPlan(vo2,zones);
  const work=plan.rows.find(r=>r.kind==='work');
  assert.equal(work.pace,'03:51–03:20');
  assert.equal(work.hr,'159–180');
  assert.equal(plan.rows.find(r=>r.kind==='rec').hr,'95–119');
  assert.equal(Math.round(plan.total),15+6*3+5*2+10);
  assert.equal(plan.segments.filter(s=>s.kind==='work').length,6);
});

test('explica por qué toca hoy un rodaje suave tras una sesión dura',()=>{
  const week=[{title:'Umbral',sport:'Run',workout_date:'2026-10-30'},{title:'Recuperación',summary:'muy suave',sport:'Run',workout_date:'2026-10-31'},{title:'Tirada larga',sport:'Run',workout_date:'2026-11-01'}];
  const text=I.whyToday(week[1],week);
  assert.match(text,/^Ayer hiciste umbral/);
  assert.match(text,/tirada larga del domingo/);
});

test('lectura de un rodaje suave con zonas de Intervals',()=>{
  const activity={distance_m:10100,duration_sec:3010,avg_hr:132,avg_pace_sec_per_km:298,load:44,raw_summary:{icu_hr_zone_times:[780,1860,300,70,0],decoupling:3.1}};
  const reading=I.activityReading({activity,planned:{title:'Rodaje aeróbico',planned_load:40},athleteZones:zones});
  assert.match(reading[0],/10,1 km a 4:58\/km con pulso medio de 132 ppm, suave \(Z2\)/);
  assert.ok(reading.some(t=>/88 % del tiempo en zona suave/.test(t)));
  assert.ok(reading.some(t=>/desacople 3,1 %/.test(t)));
  assert.equal(I.compliance(activity,{planned_load:44}),100);
});

test('resumen semanal para la evolución',()=>{
  const acts=[{activity_date:'2026-10-27T18:00:00Z',sport:'Run',distance_m:10000,duration_sec:3000,load:50,raw_summary:{icu_hr_zone_times:[600,1800,300,200,100]}},{activity_date:'2026-10-20T18:00:00Z',sport:'Run',distance_m:5000,duration_sec:1500,load:20,raw_summary:{}}];
  const evo=I.weeklyEvolution(acts,'2026-10-31',4);
  assert.equal(evo.weeks.length,4);
  assert.equal(evo.weeks[3].week_start,'2026-10-26');
  assert.equal(evo.weeks[3].km,10);
  assert.equal(evo.weeks[3].zone_easy_sec,2400);
  assert.equal(evo.weeks[2].sessions,1);
  assert.deepEqual(evo.days.map(d=>d.date),['2026-10-20','2026-10-27']);
});
