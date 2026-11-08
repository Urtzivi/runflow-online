// Carreras del asistente (list_races / remove_race) con una base de datos simulada.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const races=require('../assistant-races');

function fakeDb(){
  const answers={v:1,race:'trail_largo',race_date:'2027-06-05',other_races:[{name:'BKT Larrabetzu 20K',date:'2026-11-21',km:19},{name:'Amurrio Trail',date:'2027-03-14',km:32.5}]};
  const state={
    goals:[{id:'g1',name:'BKT Larrabetzu 20K',goal_date:'2026-11-21',status:'active'},{id:'g2',name:'EHMe',goal_date:'2027-06-05',status:'active'}],
    macros:[{id:'m1',name:'Camino al trail largo',notes:`RUNFLOW_GUIDED_RUN_PLAN\n${JSON.stringify(answers)}\nRUNFLOW_GUIDED_INCIDENTS []`}],
    calls:[],
  };
  const db=async(table,query,options={})=>{
    const method=options.method||'GET';state.calls.push({table,query,method,body:options.body});
    if(table==='goals'&&method==='DELETE'){state.goals=state.goals.filter(g=>!query.includes(`id=eq.${g.id}&`));return[]}
    if(table==='goals'){const m=query.match(/^id=eq\.([^&]+)/);return m?state.goals.filter(g=>g.id===m[1]):state.goals}
    if(table==='macrocycles'&&method==='PATCH'){if(options.body.notes){state.macros[0].notes=options.body.notes}return[]}
    if(table==='macrocycles')return state.macros;
    if(table==='mesocycles')return[{id:'me1'}];
    if(table==='training_weeks')return[{id:'w1'}];
    if(table==='workouts')return[{id:'x1',workout_date:'2026-11-10',title:'Rodaje',training_week_id:'w1'},{id:'x2',workout_date:'2027-04-12',title:'Apuko Igoera',training_week_id:'old'}];
    return[];
  };
  return {db,state};
}

test('list_races enseña objetivos, carreras de la temporada y sesiones fuera del plan',async()=>{
  const {db}=fakeDb();
  const r=await races.listRaces(db,'a1','2026-11-08');
  assert.equal(r.goals.length,2);
  assert.equal(r.season_races.length,2);
  assert.deepEqual(r.sessions_outside_plan.map(x=>x.workout_id),['x2']);
});

test('remove_race borra el objetivo y la carrera de la temporada, sin tocar el resto de notas',async()=>{
  const {db,state}=fakeDb();
  const r=await races.removeRace(db,'a1',{goal_id:'g1'},'2026-11-08');
  assert.equal(r.removed.goals.length,1);
  assert.equal(r.removed.season_races.length,1);
  assert.deepEqual(state.goals.map(g=>g.id),['g2']);
  const answers=races.readAnswers(state.macros[0].notes);
  assert.deepEqual(answers.other_races.map(x=>x.name),['Amurrio Trail']);
  assert.equal(answers.race_date,'2027-06-05');
  assert.match(state.macros[0].notes,/RUNFLOW_GUIDED_INCIDENTS \[\]/);
});

test('remove_race por nombre solo quita la carrera de la temporada',async()=>{
  const {db,state}=fakeDb();
  const r=await races.removeRace(db,'a1',{name:'bkt larrabetzu'},'2026-11-08');
  assert.equal(r.removed.goals.length,0);
  assert.equal(r.removed.season_races.length,1);
  assert.equal(state.goals.length,2);
});

test('remove_race sin coincidencias avisa',async()=>{
  const {db}=fakeDb();
  await assert.rejects(()=>races.removeRace(db,'a1',{name:'Apuko'},'2026-11-08'),/No he encontrado/);
});
