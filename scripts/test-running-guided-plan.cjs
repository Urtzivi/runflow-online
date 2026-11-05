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

test('respeta lo que se puede hacer cada día y deja como propuesta lo que no es obligatorio',()=>{
  const a={...answers,strength:2,equipment:'gimnasio',other_races:[],long_day:6,days:[
    {day:0,minutes:60,types:['strength']},{day:1,minutes:60,types:['run']},{day:2,minutes:45,types:['run','strength']},
    {day:3,minutes:60,types:['run','trail']},{day:4,minutes:60,types:['bike']},{day:5,minutes:45,types:['walk']},{day:6,minutes:120,types:['trail']}]};
  const st=P.buildStructure(a);
  assert.ok(Math.max(...st.weeks.map(w=>w.minutes))<=60+45+60+120,'el volumen solo cuenta los días de correr');
  const allowed=d=>a.days.find(x=>x.day===d).types;
  for(const week of st.weeks.filter(w=>w.type!=='competition').slice(0,8)){
    const sessions=P.buildWeekSessions(a,st,week,library);
    for(const s of sessions){
      const types=allowed(P.dayIndex(s.workout_date));
      if(s.is_strength) assert.ok(types.includes('strength'),`${s.title}: fuerza en un día de fuerza`);
      else if(s.sport==='Ride') assert.ok(types.includes('bike')&&s.optional);
      else if(s.sport==='Walk') assert.ok(types.includes('walk')&&s.optional);
      else assert.ok(types.includes('run')||types.includes('trail'),`${s.title}: carrera en un día de correr`);
      if(P.dayIndex(s.workout_date)===6&&!s.is_strength) assert.match(s.title,/trail|montaña|desnivel/i,'solo trail ese día: por montaña');
    }
    const strengthDays=sessions.filter(s=>s.is_strength).map(s=>s.workout_date);
    sessions.filter(s=>!s.is_strength&&strengthDays.includes(s.workout_date)&&/Rodaje/.test(s.summary)).forEach(s=>assert.ok(s.optional&&/^Opcional/.test(s.title),'rodaje en día de fuerza: opcional'));
  }
  const week=st.weeks.find(w=>w.phase==='base'&&w.type!=='deload');
  const guided=P.buildWeekSessions({...a,equipment:'gimnasio_guiado'},st,week,library).filter(s=>s.is_strength);
  assert.ok(guided.length);
  guided.forEach(s=>{assert.match(s.title,/Fuerza guiada en el gimnasio · Ganar fuerza/);assert.match(s.structured_description,/entrenador/);assert.equal(s.runflow_library_id,null)});
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
  assert.deepEqual(P.readAnswers(macro.notes).days,answers.days.map(d=>({...d,types:P.dayTypes(d)})));
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
  assert.equal(micro.planned.load,workouts.filter(w=>!w.optional).reduce((s,w)=>s+w.planned_load,0));
});

test('structureFromPlan rehace la temporada guardada para preparar cualquier semana',()=>{
  const st=P.buildStructure(answers);
  // Simula lo que guarda la API: mesociclos con sus notas y microciclos con horas previstas.
  const macro={notes:`${P.MARKER}\n${JSON.stringify(P.compactAnswers(answers))}`,mesocycles:st.mesos.map((meso,i)=>{
    const payload=P.mesoPayload(meso);
    return {id:`m${i}`,name:payload.name,notes:payload.notes,start_date:meso.start,microcycles:meso.weeks.map((week,j)=>{const mp=P.microPayload(meso,week,null,answers);return {id:`w${i}-${j}`,start_date:week.start,type:mp.type,planned:mp.planned};}).reverse()};
  }).reverse()};
  const saved=P.readAnswers(macro.notes);
  const rebuilt=P.structureFromPlan(saved,macro);
  assert.equal(rebuilt.weeks.length,st.weeks.length);
  assert.deepEqual(rebuilt.mesos.map(m=>m.key),st.mesos.map(m=>m.key));
  rebuilt.weeks.forEach((w,i)=>{
    assert.equal(w.index,i+1);
    assert.equal(w.start,st.weeks[i].start);
    assert.equal(w.phase,st.weeks[i].phase);
    assert.equal(w.type,st.weeks[i].type);
    assert.ok(Math.abs(w.minutes-st.weeks[i].minutes)<=5,'mismos minutos (redondeo de horas)');
  });
  assert.equal(rebuilt.weeks.find(w=>w.start<='2026-12-31'&&w.end>='2026-12-31').b_race.name,'San Silvestre');
  // Una semana del medio sale igual que si se hubiera preparado al crear el plan.
  const i=6;
  const a=P.buildWeekSessions(saved,rebuilt,rebuilt.weeks[i],library).map(s=>`${s.workout_date} ${s.title}`);
  assert.ok(a.length>=3,'la semana tiene sesiones');
  a.forEach(line=>assert.ok(line.slice(0,10)>=rebuilt.weeks[i].start&&line.slice(0,10)<=rebuilt.weeks[i].end,'dentro de la semana'));
});

test('daysFromProfile lee la disponibilidad de la ficha (gym cuenta como fuerza)',()=>{
  assert.equal(P.daysFromProfile({availability:{days:[]}}),null);
  const days=P.daysFromProfile({availability:{configured:true,days:[
    {day:1,activity_types:['run','gym'],can_train:true,max_minutes:60},
    {day:3,activity_types:['unavailable'],can_train:false},
    {day:7,activity_type:'flexible',can_train:true,max_minutes:120},
  ]}});
  assert.equal(days.length,7);
  assert.deepEqual(days[0],{day:0,minutes:60,types:['run','strength']});
  assert.deepEqual(days[2],{day:2,minutes:0,types:[]});
  assert.deepEqual(days[6],{day:6,minutes:120,types:['run','strength']});
});

// ---------- «Ha pasado algo» ----------
const injuryDays=[{day:1,minutes:60,types:['run','bike','walk','strength']},{day:3,minutes:60,types:['run','bike','walk','strength']},{day:4,minutes:45,types:['run','bike','walk','strength']},{day:6,minutes:120,types:['run','bike','walk','strength']}];
const pubis={kind:'lesion',zone:'pubis',from:'2026-11-04',pain:4,can_run:false,can:['bike','walk','strength']};
const week={start:'2026-11-09',end:'2026-11-15'};

test('el estado inicial depende del dolor y del tipo de problema',()=>{
  assert.equal(P.initialState(pubis),'sin_correr');
  assert.equal(P.initialState({...pubis,pain:6}),'parado');
  assert.equal(P.initialState({...pubis,pain:2,can_run:true}),'vuelta');
  assert.equal(P.initialState({kind:'enfermedad'}),'parado');
  assert.equal(P.initialState({kind:'viaje'}),'parado');
});

test('pubis sin correr: bici en lugar de carrera y 2 sesiones de recuperación, nada de correr',()=>{
  const s=P.buildAdaptedWeek({...pubis,state:'sin_correr'},week,injuryDays);
  assert.ok(!s.some(x=>x.sport==='Run'),'no corre');
  assert.equal(s.filter(x=>x.sport==='Ride').length,4);
  const rehab=s.filter(x=>x.is_strength);
  assert.equal(rehab.length,2);
  assert.match(rehab[0].structured_description,/Copenhagen/);
  rehab.forEach((r,i)=>{ if(i) assert.ok(P.dayIndex(r.workout_date)-P.dayIndex(rehab[i-1].workout_date)>=2,'separadas'); });
  s.forEach(x=>{ const d=injuryDays.find(d=>d.day===P.dayIndex(x.workout_date)); assert.ok(d,'en un día disponible'); });
  // Por día, lo programado cabe en el tiempo del día.
  for(const d of injuryDays){ const total=s.filter(x=>P.dayIndex(x.workout_date)===d.day).reduce((a,x)=>a+x.planned_duration_min,0); assert.ok(total<=d.minutes,`cabe el ${d.day}`); }
});

test('vuelta progresiva: 3 salidas separadas con el paso que toca y la regla del dolor',()=>{
  const s=P.buildAdaptedWeek({...pubis,state:'vuelta',step:1},week,injuryDays);
  const runs=s.filter(x=>x.sport==='Run');
  assert.equal(runs.length,3);
  runs.forEach(r=>{ assert.match(r.title,/paso 2 de 6/); assert.match(r.structured_description,/Manda el dolor/); });
  for(let i=1;i<runs.length;i++) assert.ok(P.dayIndex(runs[i].workout_date)-P.dayIndex(runs[i-1].workout_date)>=2);
  assert.deepEqual(P.nextReturnStep({step:1},'green'),{state:'vuelta',step:2,ready:false});
  assert.deepEqual(P.nextReturnStep({step:1},'amber'),{state:'vuelta',step:1});
  assert.deepEqual(P.nextReturnStep({step:1},'red'),{state:'vuelta',step:0});
  assert.deepEqual(P.nextReturnStep({step:0},'red'),{state:'sin_correr',step:0});
  assert.equal(P.nextReturnStep({step:5},'green').ready,true);
});

test('no programa nada antes de hoy y enfermedad/viaje en parado no llevan sesiones',()=>{
  const s=P.buildAdaptedWeek({...pubis,state:'sin_correr'},week,injuryDays,{fromDate:'2026-11-12'});
  assert.ok(s.every(x=>x.workout_date>='2026-11-12'));
  assert.equal(P.buildAdaptedWeek({kind:'enfermedad',state:'parado',can:['walk']},week,injuryDays).length,0);
  assert.equal(P.buildAdaptedWeek({kind:'viaje',state:'parado'},week,injuryDays).length,0);
});

test('las incidencias se guardan en las notas sin tocar las respuestas del plan',()=>{
  const notes=`${P.MARKER}\n${JSON.stringify(P.compactAnswers(answers))}`;
  const one=P.writeIncidents(notes,[{id:'a',kind:'lesion',from:'2026-11-04',state:'sin_correr'}]);
  assert.deepEqual(P.readAnswers(one),P.readAnswers(notes));
  assert.equal(P.activeIncident(P.readIncidents(one)).id,'a');
  const two=P.writeIncidents(one,[{id:'a',kind:'lesion',from:'2026-11-04',state:'normal',closed:'2026-12-01'}]);
  assert.equal(P.readIncidents(two).length,1);
  assert.equal(P.activeIncident(P.readIncidents(two)),null);
  assert.deepEqual(P.readAnswers(two),P.readAnswers(notes));
});

test('al volver se recalcula hasta la carrera sin moverla y contando las semanas perdidas',()=>{
  const st=P.buildStructure(answers);
  const r=P.returnPlan(answers,{...pubis,from:'2026-11-25',log:[{s:'sin_correr'},{s:'vuelta'}]},st,'2027-01-06');
  assert.equal(r.start,'2027-01-11');
  assert.equal(r.end,'2027-02-14');
  assert.equal(r.weeks.at(-1).type,'competition');
  assert.equal(r.lost_weeks,7);
  assert.equal(r.weeks[0].type,'adaptation','tras la vuelta progresiva, semana de adaptación');
  assert.notEqual(r.mesos[0].key,'prep');
  // Las semanas casan con las ya guardadas (mismos lunes).
  const old=new Set(st.weeks.map(w=>w.start));
  r.weeks.forEach(w=>assert.ok(old.has(w.start)));
});

test('structureFromPlan respeta la fase guardada en cada semana tras recalcular',()=>{
  const st=P.buildStructure(answers);
  const macro={mesocycles:[{id:'m',name:'Base',notes:'RUNFLOW_GUIDED_PHASE:base',microcycles:st.weeks.map((w,i)=>({id:'w'+i,start_date:w.start,type:w.type,planned:{hours:w.hours},notes:i>=10?`${P.PHASE_PREFIX}especifico`:''}))}]};
  const r=P.structureFromPlan(answers,macro);
  assert.deepEqual(r.mesos.map(m=>m.key),['base','especifico']);
  assert.equal(r.mesos[1].weeks.length,st.weeks.length-10);
});

test('guarda km y desnivel de la carrera principal y de las otras, y los manda en los objetivos',()=>{
  const a={...answers,race_km:'21.3',race_elevation:'350',other_races:[{name:'San Silvestre',date:'2026-12-31',km:'10',elevation:''}]};
  const notes=P.macroPayload(a,P.buildStructure(a),'g').notes;
  const back=P.readAnswers(notes);
  assert.equal(back.race_km,21.3); assert.equal(back.race_elevation,350);
  assert.deepEqual(back.other_races,[{name:'San Silvestre',date:'2026-12-31',km:10,elevation:null}]);
  const goals=P.goalPayloads(a,P.buildStructure(a),'s');
  assert.equal(goals[0].distance_km,21.3); assert.equal(goals[0].elevation_m,350);
  assert.equal(goals[1].distance_km,10); assert.equal(goals[1].elevation_m,null);
  // Sin km, los del tipo de carrera.
  assert.equal(P.goalPayloads(answers,P.buildStructure(answers),'s')[0].distance_km,21.1);
  assert.match(P.buildStructure(a).summary,/21,3 km y 350 m de desnivel/);
});

test('con mucho desnivel, la tirada larga de las fases fuertes va con cuestas y la fuerza trabaja bajadas',()=>{
  const flat=P.buildStructure(answers);
  assert.ok(!P.courseOf(answers).hilly);
  const a={...answers,race_elevation:'400'};
  const st=P.buildStructure(a);
  assert.ok(P.courseOf(a).hilly);
  const week=st.weeks.find(w=>['resistencia','especifico'].includes(w.phase)&&w.type==='load');
  const long=P.buildWeekSessions(a,st,week,library).find(s=>/Tirada larga/.test(s.summary));
  assert.match(long.title,/cuestas/); assert.match(long.structured_description,/400 m de desnivel/);
  const flatLong=P.buildWeekSessions(answers,flat,flat.weeks.find(w=>w.start===week.start),library).find(s=>/Tirada larga/.test(s.summary));
  assert.doesNotMatch(flatLong.title,/cuestas/);
  assert.ok(st.mesos.find(m=>m.key==='umbral').strength.families.includes('Trail Eccentric'));
});
