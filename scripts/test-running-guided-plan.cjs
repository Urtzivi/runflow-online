const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const zlib=require('zlib');
const P=require('../public/js/running-guided-plan.js');

// Biblioteca real (la misma que sirve /api/v9/library).
const dataDir=path.join(__dirname,'..','data');
const encoded=fs.readdirSync(dataDir).filter(n=>/^runflow-v9-library\.part\d+\.b64$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0])).map(n=>fs.readFileSync(path.join(dataDir,n),'utf8').trim()).join('');
const library=JSON.parse(zlib.gunzipSync(Buffer.from(encoded,'base64'))).s;

const answers={race:'media',race_date:'2027-02-14',race_name:'Media de Gasteiz',goal_mode:'marca',target_time:'1:45:00',level:'regular',long_day:6,strength:1,start_date:'2026-10-26',
  days:[{day:1,minutes:60},{day:3,minutes:60},{day:4,minutes:45},{day:6,minutes:120}],other_races:[{name:'San Silvestre',date:'2026-12-31'}]};

test('reparte las semanas hasta la carrera sin huecos ni solapes',()=>{
  const st=P.buildStructure(answers);
  assert.equal(st.totalWeeks,16);
  assert.equal(st.weeks.length,16);
  assert.equal(st.start,'2026-10-26');
  assert.equal(st.end,'2027-02-14');
  st.weeks.forEach((w,i)=>{ if(i) assert.equal(w.start,P.addDays(st.weeks[i-1].start,7)); assert.equal(w.end,P.addDays(w.start,6)); });
  assert.deepEqual(st.mesos.map(m=>m.key),['prep','base','umbral','resistencia','especifico','taper']);
  for(let i=1;i<st.mesos.length;i++) assert.equal(st.mesos[i].start,P.addDays(st.mesos[i-1].end,1));
  assert.equal(st.weeks.at(-1).type,'competition');
  assert.equal(st.weeks[0].type,'adaptation');
  assert.ok(st.weeks.some(w=>w.type==='deload'),'hay semanas de descarga');
  assert.equal(st.weeks.find(w=>w.start<='2026-12-31'&&w.end>='2026-12-31').b_race.name,'San Silvestre');
  assert.match(st.summary,/16 semanas hasta la media maratón/);
});

test('con poco tiempo protege el específico y la puesta a punto y avisa',()=>{
  const st=P.buildStructure({...answers,race:'maraton',race_date:'2026-12-27'});
  assert.equal(st.totalWeeks,9);
  assert.equal(st.mesos.at(-1).key,'taper');
  assert.equal(st.mesos.at(-1).weeks.length,2);
  assert.ok(st.mesos.find(m=>m.key==='especifico').weeks.length>=2);
  assert.ok(st.warnings.some(w=>/No da tiempo a todo/.test(w)));
  const tiny=P.buildStructure({...answers,race:'10K',race_date:'2026-11-15'});
  assert.ok(tiny.warnings.some(w=>/es poco/.test(w)));
});

test('un atleta que empieza tiene semanas más suaves y descarga cada 3',()=>{
  const st=P.buildStructure({...answers,level:'nuevo'});
  const firstDeload=st.weeks.findIndex(w=>w.type==='deload');
  assert.equal(firstDeload,2);
  assert.ok(Math.max(...st.weeks.map(w=>w.minutes))<=210);
});

test('las sesiones respetan los días, los minutos y la carrera',()=>{
  const st=P.buildStructure(answers);
  for(const week of st.weeks){
    const sessions=P.buildWeekSessions(answers,st,week,library);
    assert.ok(sessions.length,`semana ${week.index} con sesiones`);
    for(const s of sessions){
      const day=answers.days.find(d=>d.day===P.dayIndex(s.workout_date));
      assert.ok(day,`${s.title} cae en un día disponible`);
      if(!s.is_strength) assert.ok(s.planned_duration_min<=day.minutes,`${s.title} cabe en ${day.minutes} min`);
      assert.ok(s.workout_date>=week.start&&s.workout_date<=week.end);
      assert.ok(s.blocks.length);
      assert.ok(s.workout_date<answers.race_date);
    }
    const quality=sessions.filter(s=>s.summary.startsWith('Sesión de calidad'));
    if(week.type==='recovery') assert.equal(quality.length,0);
    if(week.b_race) assert.equal(quality.length,0,'la semana con carrera B no lleva otra sesión dura');
  }
  const week1=P.buildWeekSessions(answers,st,st.weeks[1],library);
  assert.equal(week1.filter(s=>s.is_strength).length,1);
  assert.ok(week1.some(s=>/Tirada larga/.test(s.summary)&&P.dayIndex(s.workout_date)===6));
});

test('con la biblioteca filtrada de producción (máx. 60 min salvo tiradas largas) sigue habiendo calidad',()=>{
  const isLong=r=>/tirada larga|long run|duracion larga|larga aerobica/.test(`${r.n} ${r.f} ${r.o}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());
  const filtered=library.filter(r=>!(Number(r.tm)>60&&!isLong(r)));
  for(const race of Object.keys(P.RACES)){
    const a={...answers,race,other_races:[]};
    const st=P.buildStructure(a);
    const spec=st.weeks.find(w=>w.phase==='especifico'&&w.type!=='deload');
    const sessions=P.buildWeekSessions(a,st,spec,filtered);
    assert.ok(sessions.some(s=>s.summary.startsWith('Sesión de calidad')),`${race}: calidad en el específico`);
    assert.ok(sessions.every(s=>s.is_strength||s.planned_duration_min<=60||/Tirada larga/.test(s.summary)));
  }
});

test('la fuerza va periodizada y colocada lejos de las sesiones duras',()=>{
  const a={...answers,strength:2,equipment:'gimnasio',days:[{day:1,minutes:60},{day:2,minutes:45},{day:3,minutes:60},{day:4,minutes:45},{day:6,minutes:120}],other_races:[]};
  const st=P.buildStructure(a);
  const lib=Object.fromEntries(library.map(r=>[r.i,r]));
  const families={};
  for(const week of st.weeks){
    const sessions=P.buildWeekSessions(a,st,week,library);
    const strength=sessions.filter(s=>s.is_strength);
    const hardDays=sessions.filter(s=>/Sesión de calidad|Tirada larga/.test(s.summary)).map(s=>P.dayIndex(s.workout_date));
    strength.forEach(s=>{
      assert.ok(!hardDays.includes(P.dayIndex(s.workout_date)+1),`semana ${week.index}: ${s.title} no va el día antes de una sesión dura`);
      (families[week.phase]=families[week.phase]||new Set()).add(lib[s.runflow_library_id].f);
    });
    if(week.type==='competition') assert.equal(strength.length,0,'semana de carrera sin fuerza');
    if(week.type==='deload'||week.phase==='especifico') assert.ok(strength.length<=1);
    else if(week.phase!=='taper') assert.equal(strength.length,2,`semana ${week.index} con 2 de fuerza`);
    const days=strength.map(s=>P.dayIndex(s.workout_date)).sort();
    if(days.length===2) assert.ok(days[1]-days[0]>=2,'un día entre sesiones de fuerza');
    assert.equal(P.microPayload(st.mesos.find(m=>m.weeks.includes(week)),week,null,a).planned.strength_sessions,week.strength_sessions);
  }
  assert.ok(families.base.has('Max Strength'),'en base se gana fuerza');
  assert.ok([...families.especifico].every(f=>['Maintenance','Plyometric'].includes(f)),'en el específico se mantiene');
  assert.match(P.mesoPayload(st.mesos[1]).notes,/Fuerza \(Ganar fuerza\)/);
  const home=P.buildStructure({...a,equipment:'sin_material'});
  for(const week of home.weeks.slice(0,6)) P.buildWeekSessions({...a,equipment:'sin_material'},home,week,library).filter(s=>s.is_strength)
    .forEach(s=>assert.match(lib[s.runflow_library_id].mat,/^(Peso corporal|Gomas|Escalon|Suelo)/,`${s.title} sin material`));
});

test('traduce el bloque principal de la biblioteca a pasos para Intervals',()=>{
  assert.deepEqual(P.parseMain("3x8' a umbral, rec 2'"),{repetitions:3,work_value:8,work_unit:'m',recovery_value:2,recovery_unit:'m'});
  assert.deepEqual(P.parseMain('6x800m @ ritmo 5K, rec 2\''),{repetitions:6,work_value:0.8,work_unit:'km',recovery_value:2,recovery_unit:'m'});
  assert.deepEqual(P.parseMain('8x15" rapido controlado, recuperacion 60-90" caminando'),{repetitions:8,work_value:15,work_unit:'s',recovery_value:60,recovery_unit:'s'});
  assert.equal(P.parseMain("20' easy + 15' aerobico"),null);
  assert.equal(P.rpeExplain('Z1-Z2 / RPE 3-4; sin forzar'),'RPE 3-4 de 10: puedes hablar con frases completas');
});

test('recalcula tras semanas perdidas sin mover la carrera',()=>{
  const lesion=P.replan(answers,{from_date:'2026-12-14',current_phase:'umbral',lost_weeks:3,reason:'dolor'});
  assert.equal(lesion.end,'2027-02-14');
  assert.equal(lesion.weeks[0].type,'recovery');
  assert.equal(lesion.mesos[0].key,'base','3 semanas fuera: un paso atrás');
  assert.equal(lesion.mesos.at(-1).key,'taper');
  assert.match(lesion.explanation,/dolor/);
  const trabajo=P.replan(answers,{from_date:'2026-12-14',current_phase:'umbral',lost_weeks:1,reason:'trabajo'});
  assert.equal(trabajo.weeks[0].type,'adaptation');
  assert.equal(trabajo.mesos[0].key,'umbral');
  const sesiones=P.buildWeekSessions(answers,lesion,lesion.weeks[0],library);
  assert.equal(sesiones.filter(s=>s.summary.startsWith('Sesión de calidad')).length,0,'semana de vuelta sin intensidad');
});

test('cargas para la API y respuestas guardadas en el macrociclo',()=>{
  const st=P.buildStructure(answers);
  const macro=P.macroPayload(answers,st,'g1');
  assert.equal(macro.name,'Camino a la media maratón');
  assert.deepEqual(P.readAnswers(macro.notes).days,answers.days);
  const goals=P.goalPayloads(answers,st,'s1');
  assert.equal(goals.length,2);
  assert.equal(goals[0].target_time_sec,6300);
  assert.equal(goals[1].priority_code,'B');
  const meso=P.mesoPayload(st.mesos[1]);
  assert.match(meso.notes,/^RUNFLOW_MESO_TYPE:base/);
  assert.ok(meso.primary_adaptation.length<=200);
  const workouts=P.buildWeekSessions(answers,st,st.weeks[0],library);
  const micro=P.microPayload(st.mesos[0],st.weeks[0],workouts,answers);
  assert.equal(micro.publication_status,'draft');
  assert.equal(micro.planned.load,workouts.reduce((s,w)=>s+w.planned_load,0));
});
