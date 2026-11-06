const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../public/js/running-guided-plan.js');
const planner=require('../assistant-planner.js');
const {MCP_TOOLS}=require('../assistant-api-hook.js');

const TODAY='2026-11-05';
// Ficha: martes (correr + fuerza) y jueves 60', viernes 45', domingo 120' (day 0 = lunes).
const availability={configured:true,days:[1,2,3,4,5,6,7].map(day=>({day,can_train:[2,4,5,7].includes(day),activity_types:[2,4,5,7].includes(day)?(day===2?['run','strength']:['run']):['unavailable'],max_minutes:{2:60,4:60,5:45,7:120}[day]||null}))};
const days=P.daysFromProfile({availability});
const answers={race:'media',race_date:'2027-03-14',race_name:'Media de Gasteiz',level:'regular',long_day:6,strength:1,start_date:'2026-11-09'};

// Atleta que venía corriendo ≈ 150' por semana.
const runs=[];for(let w=1;w<=6;w++)for(const d of [0,2,5])runs.push({id:`a${w}${d}`,activity_date:P.addDays(P.addDays(P.mondayOf(TODAY),-7*w),d),sport:'Run',duration_sec:50*60,load:50});

function fakeDb(extra={}){
  const calls=[];
  const db=async(table,query)=>{calls.push([table,query]);
    if(extra[table])return typeof extra[table]==='function'?extra[table](query):extra[table];
    if(table==='athlete_profiles')return [{availability}];
    if(table==='activities')return runs;
    return [];
  };
  db.calls=calls;return db;
}

test('el plan que calcula RunFlow pasa siempre el Verificador',()=>{
  for(const race of Object.keys(P.RACES))for(const level of Object.keys(P.LEVELS))for(const race_date of ['2026-12-20','2027-03-14','2027-06-06'])for(const history_minutes of [null,90]){
    const a={...answers,race,level,race_date,days,history_minutes};
    const st=P.buildStructure(a);
    const v=P.verifySeason(a,st);
    assert.ok(v.ok,`${race} ${level} ${race_date}: ${JSON.stringify(v.failures)}`);
  }
});

test('la puesta a punto queda por debajo de la semana más alta aunque el historial frene el inicio',()=>{
  const st=P.buildStructure({...answers,race:'5K',race_date:'2026-12-20',days,history_minutes:90});
  const peak=Math.max(...st.weeks.filter(w=>!['taper','competition','deload','recovery'].includes(w.type)).map(w=>w.minutes));
  st.weeks.filter(w=>['taper','competition'].includes(w.type)).forEach(w=>assert.ok(w.minutes<peak,`${w.type} ${w.minutes} >= ${peak}`));
});

test('el Planificador puede retocar semanas con un porqué y dentro del ±15 %',()=>{
  const a={...answers,days};
  const base=P.buildStructure(a);
  const target=base.weeks.find(w=>w.type==='load'&&w.index>5);
  const plan=planner.seasonPlan(a,[{start:target.start,minutes:Math.round(target.minutes*0.9),why:'Viene de un catarro: semana algo más corta.'}]);
  assert.ok(plan.verification.ok,JSON.stringify(plan.verification.failures));
  const week=plan.structure.weeks.find(w=>w.start===target.start);
  assert.equal(week.agent.base_minutes,target.minutes);
  assert.match(week.why,/^Planificador: Viene de un catarro/);
  assert.equal(plan.applied.length,1);
});

test('el Verificador bloquea lo que rompe las reglas',()=>{
  const a={...answers,days};
  const base=P.buildStructure(a);
  const load=base.weeks.find(w=>w.type==='load'&&w.index>3);
  const deload=base.weeks.find(w=>w.type==='deload');
  const taper=base.weeks.find(w=>w.type==='taper'||w.type==='competition');
  const rules=adj=>planner.seasonPlan(a,adj).verification.failures.map(f=>f.rule);
  assert.ok(rules([{start:load.start,minutes:Math.round(load.minutes*1.3),why:'Va muy bien'}]).includes('cambio_maximo'));
  assert.ok(rules([{start:load.start,minutes:Math.round(load.minutes*0.9)}]).includes('justificacion'));
  assert.ok(rules([{start:deload.start,type:'overload',minutes:Math.round(deload.minutes*1.15),why:'Sin descarga'}]).includes('descarga'));
  assert.ok(rules([{start:taper.start,type:'load',why:'Cargar hasta el final'}]).includes('puesta_a_punto'));
  assert.ok(rules([{start:'2026-11-11',minutes:100,why:'miércoles'}]).includes('semana'));
  // Pasarse de la disponibilidad (285' para correr).
  const tight={...a,days:days.map(d=>({...d,minutes:d.minutes?40:0}))};
  const st=P.buildStructure(tight);
  const top=st.weeks.reduce((m,w)=>w.minutes>m.minutes?w:m);
  assert.ok(planner.seasonPlan(tight,[{start:top.start,minutes:Math.round(top.minutes*1.15),why:'más'}]).verification.failures.some(f=>['disponibilidad','progresion_10'].includes(f.rule)));
});

test('Verificador semanal: días libres, días duros seguidos y semáforo rojo',()=>{
  const ws='2026-11-16';
  const ok=[{workout_date:'2026-11-17',title:'Series 6x3',priority:'A',planned_duration_min:55},{workout_date:'2026-11-19',title:'Rodaje',priority:'C',planned_duration_min:40},{workout_date:'2026-11-22',title:'Tirada larga',priority:'A',planned_duration_min:100}];
  assert.ok(P.verifyWeek({weekStart:ws,workouts:ok,days}).ok);
  const rules=(list,extra={})=>P.verifyWeek({weekStart:ws,workouts:list,days,...extra}).failures.map(f=>f.rule);
  assert.ok(rules([{workout_date:'2026-11-16',title:'Rodaje',priority:'C',planned_duration_min:40}]).includes('dia_libre'));
  assert.ok(rules([{workout_date:'2026-11-24',title:'Rodaje',priority:'C',planned_duration_min:40}]).includes('fechas'));
  assert.ok(rules([{workout_date:'2026-11-20',title:'Rodaje',priority:'C',planned_duration_min:90}]).includes('minutos_dia'));
  assert.ok(rules([{...ok[0]},{workout_date:'2026-11-18',title:'Umbral 3x10',priority:'B',planned_duration_min:55}]).includes('dias_duros_seguidos')||rules([{...ok[0]},{workout_date:'2026-11-18',title:'Umbral 3x10',priority:'B',planned_duration_min:55}]).includes('dia_libre'));
  const back=[{workout_date:'2026-11-19',title:'Fartlek',priority:'B',planned_duration_min:45},{workout_date:'2026-11-20',title:'Tempo 20',priority:'B',planned_duration_min:45}];
  assert.ok(rules(back).includes('dias_duros_seguidos'));
  assert.ok(rules(ok,{semaforo:'rojo'}).includes('semaforo_rojo'));
  // Sin disponibilidad rellenada solo se comprueban fechas y días duros.
  assert.ok(P.verifyWeek({weekStart:ws,workouts:ok,days:null}).ok);
});

test('preview_season_plan usa la ficha y lo que venía corriendo',async()=>{
  const view=await planner.previewSeason(fakeDb(),'ath1',{answers},TODAY);
  assert.equal(view.answers.history_minutes,150);
  assert.equal(view.answers.days.filter(d=>d.minutes>0).length,4);
  assert.ok(view.verification.ok,JSON.stringify(view.verification.failures));
  assert.equal(view.weeks.at(-1).type,'competition');
  assert.ok(view.weeks.every(w=>w.base_minutes===w.minutes&&!w.changed));
  assert.ok(view.blocks.length>=3);
});

test('create_season_proposal guarda solo si pasa el Verificador y exige porqué',async()=>{
  await assert.rejects(planner.seasonProposal(fakeDb(),'ath1',{answers},TODAY),/justification/);
  const preview=await planner.previewSeason(fakeDb(),'ath1',{answers},TODAY);
  const load=preview.weeks.find((w,i)=>w.type==='load'&&i>5);
  const good=await planner.seasonProposal(fakeDb(),'ath1',{answers,justification:'Parto del plan de RunFlow.',adjustments:[{start:load.start,minutes:load.minutes-10,why:'Semana de exámenes.'}]},TODAY);
  assert.equal(good.ok,true);
  assert.equal(good.data.kind,'season');
  assert.equal(good.data.status,'proposed');
  assert.equal(good.data.adjustments[0].base_minutes,load.minutes);
  assert.equal(good.data.answers.race_date,'2027-03-14');
  // La tarjeta del coach recalcula lo mismo a partir de lo guardado.
  const again=planner.seasonPlan({...good.data.answers,days},good.data.adjustments);
  assert.ok(again.verification.ok);
  assert.equal(again.structure.weeks.find(w=>w.start===load.start).minutes,load.minutes-10);
  const badOne=await planner.seasonProposal(fakeDb(),'ath1',{answers,justification:'x',adjustments:[{start:load.start,minutes:load.minutes*2,why:'a tope'}]},TODAY);
  assert.equal(badOne.ok,false);
  assert.ok(badOne.verification.failures.length);
});

test('sin disponibilidad en la ficha no se planifica',async()=>{
  const db=fakeDb({athlete_profiles:[{availability:null}]});
  await assert.rejects(planner.previewSeason(db,'ath1',{answers},TODAY),/Disponibilidad/);
});

test('get_week_plan_base sale de la temporada guiada guardada y pasa el Verificador',async()=>{
  const a={...answers,days,start_date:'2026-11-02'};
  const st=P.buildStructure(a);
  const macro={id:'m1',season_id:'s1',name:'Camino',start_date:st.start,end_date:st.end,...P.macroPayload(a,st,null)};
  const mesos=st.mesos.map((m,i)=>({id:`me${i}`,macrocycle_id:'m1',...P.mesoPayload(m)}));
  const weeks=st.mesos.flatMap((m,i)=>m.weeks.map((w,j)=>{const micro=P.microPayload(m,w,null,a);return{id:`w${i}-${j}`,mesocycle_id:`me${i}`,week_start:w.start,end_date:w.end,microcycle_type:w.type,planned_hours:micro.planned.hours,target_load:micro.planned.load,planned_strength_sessions:micro.planned.strength_sessions,coach_comment:micro.notes,status:'draft'}}));
  const db=fakeDb({macrocycles:[macro],mesocycles:mesos,training_weeks:weeks});
  const ctx=await planner.planningContext(db,'ath1',TODAY);
  assert.equal(ctx.current_plan.macro.id,'m1');
  assert.equal(ctx.current_plan.current_week.start,'2026-11-02');
  assert.equal(ctx.history.avg_minutes,150);
  assert.ok(ctx.rules.length>=8);
  const base=await planner.weekBase(db,'ath1','2026-11-18',TODAY);
  assert.equal(base.week.start,'2026-11-16');
  assert.ok(base.workouts.length>=3);
  assert.ok(base.verification.ok,JSON.stringify(base.verification.failures));
  await assert.rejects(planner.weekBase(db,'ath1','2028-01-03',TODAY),/no está dentro/);
  await assert.rejects(planner.weekBase(fakeDb(),'ath1','2026-11-16',TODAY),/no tiene una temporada guiada/);
});

test('las herramientas del Planificador están en el conector MCP',()=>{
  const names=MCP_TOOLS.map(t=>t.name);
  for(const name of ['get_planning_context','preview_season_plan','create_season_proposal','get_week_plan_base','create_week_proposal'])assert.ok(names.includes(name),name);
  assert.ok(MCP_TOOLS.find(t=>t.name==='create_week_proposal').inputSchema.properties.semaforo);
});
