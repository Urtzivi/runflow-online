const $ = id => document.getElementById(id);
const state = {
  user: null,
  athlete: null,
  selectedWorkout: null,
  selectedWeekStart: isoMonday(),
  activities: [],
  messages: [],
  performance: { latest: null, history: [] },
  activeView: 'today',
  messageWorkoutId: '',
};
const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) location.href = localStorage.getItem('runflow_client') === 'athlete' ? '/login?mode=athlete' : '/login';
    throw new Error(data.error || 'No se pudo completar la operación.');
  }
  return data;
}

function localIso(date = new Date()) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function isoMonday(date = new Date()) {
  const value = new Date(date);
  const day = value.getDay() || 7;
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() - day + 1);
  return localIso(value);
}
function addDays(dateString, days) { const date = new Date(`${dateString}T12:00:00`); date.setDate(date.getDate() + days); return localIso(date); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char])); }
function dateLabel(dateString, long = false) { return new Intl.DateTimeFormat('es-ES', long ? { weekday:'long', day:'numeric', month:'long' } : { day:'numeric', month:'short' }).format(new Date(`${String(dateString).slice(0, 10)}T12:00:00`)); }
function fullDateLabel(value) { return value ? new Intl.DateTimeFormat('es-ES', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(new Date(value)) : 'Sin fecha'; }
function daysUntil(dateString) { const a = new Date(); a.setHours(0,0,0,0); const b = new Date(`${dateString}T00:00:00`); return Math.max(0, Math.ceil((b-a)/86400000)); }
function message(text, type='') { const el=$('athleteMessage'); el.textContent=text; el.className=`notice athlete-toast ${type}`; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),4000); }
function durationLabel(seconds) { const value=Number(seconds); if(!Number.isFinite(value))return '—'; const h=Math.floor(value/3600),m=Math.floor((value%3600)/60),s=Math.round(value%60); return h?`${h} h ${String(m).padStart(2,'0')} min`:`${m}:${String(s).padStart(2,'0')}`; }
function distanceLabel(metres) { const value=Number(metres); return Number.isFinite(value)?`${(value/1000).toFixed(value>=10000?1:2)} km`:'—'; }
function paceLabel(seconds) { const value=Number(seconds); if(!Number.isFinite(value)||value<=0)return '—'; const rounded=Math.round(value); return `${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,'0')}/km`; }
function numberLabel(value, suffix='') { const number=Number(value); return Number.isFinite(number)?`${Math.round(number*10)/10}${suffix}`:'—'; }
function initials(name) { return String(name || 'A').trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase() || 'A'; }
function sportKey(value) { const sport=String(value||'').toLowerCase(); if(sport.includes('strength')||sport.includes('fuerza'))return 'strength'; if(sport.includes('ride')||sport.includes('bike')||sport.includes('cicl'))return 'ride'; if(sport.includes('rest')||sport.includes('descanso'))return 'rest'; return 'run'; }
function sportIcon(value) { return ({ run:'🏃', strength:'🏋', ride:'🚴', rest:'◌' })[sportKey(value)] || '●'; }
function sportLabel(value) { return ({ run:'Running', strength:'Fuerza', ride:'Ciclismo', rest:'Descanso' })[sportKey(value)] || value || 'Sesión'; }
function executionLabel(status) { return ({ completed:'Realizada', partial:'Parcial', skipped:'No realizada', planned:'Pendiente' })[status] || 'Pendiente'; }
function readinessVisual(metrics) {
  const score=Number(metrics?.readiness_score ?? 50);
  if(score>=75)return { label:'Buena', detail:'Listo para entrenar', cls:'good' };
  if(score>=55)return { label:'Normal', detail:'Carga controlada', cls:'normal' };
  return { label:'Vigilancia', detail:'Escucha sensaciones', cls:'watch' };
}
function todayWorkout() {
  const today=localIso();
  return (state.athlete?.week?.workouts || []).find(item=>String(item.workout_date).slice(0,10)===today) || null;
}
function nextWorkout(afterDate=localIso()) {
  return [...(state.athlete?.week?.workouts || [])].filter(item=>String(item.workout_date).slice(0,10)>afterDate).sort((a,b)=>String(a.workout_date).localeCompare(String(b.workout_date)))[0] || null;
}

function switchView(name) {
  state.activeView=name;
  document.querySelectorAll('.athlete-v2-view').forEach(view=>view.classList.toggle('active', view.id===`${name}View`));
  document.querySelectorAll('[data-athlete-nav]').forEach(button=>button.classList.toggle('active', button.dataset.athleteNav===name));
  if(name==='messages') loadMessages(true).catch(error=>message(error.message,'error'));
  if(name==='activities' && !state.activities.length) loadActivities(false);
  window.scrollTo({top:0,behavior:'smooth'});
}


function fitnessSparkline(rows) {
  const values=(rows||[]).map(item=>Number(item.fitness_index)).filter(Number.isFinite);
  if(values.length<2)return '<div class="athlete-fitness-empty">La evolución aparecerá aquí cuando haya varios días calculados.</div>';
  const recent=(rows||[]).filter(item=>Number.isFinite(Number(item.fitness_index))).slice(-56);
  const nums=recent.map(item=>Number(item.fitness_index));
  const min=Math.min(...nums,40), max=Math.max(...nums,80), span=Math.max(1,max-min);
  const width=600,height=92,pad=8;
  const points=nums.map((value,index)=>{
    const x=pad+(index/Math.max(1,nums.length-1))*(width-pad*2);
    const y=height-pad-((value-min)/span)*(height-pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" role="img"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" class="baseline"/></svg>`;
}

function renderPerformance() {
  const perf=state.performance?.latest || state.athlete?.performance || null;
  const history=state.performance?.history || [];
  if(!perf){
    $('athleteFitnessIndex').textContent='—'; $('athleteFitnessTrend').textContent='En construcción'; $('athleteFitnessQuality').textContent='Provisional';
    $('athleteFitnessSpark').innerHTML=fitnessSparkline([]); $('athleteFitnessChange').textContent='Necesitamos más datos para estimar tu evolución.'; $('athleteConsistency').textContent='Consistencia —';
    return;
  }
  $('athleteFitnessIndex').textContent=Number.isFinite(Number(perf.fitness_index))?`${Math.round(Number(perf.fitness_index))}/100`:'—';
  const trend=perf.fitness_trend||'En construcción'; $('athleteFitnessTrend').textContent=`· ${trend}${trend==='Mejorando'?' ↗':trend==='Bajando'?' ↘':' →'}`;
  const quality=Number(perf.data_quality||0); $('athleteFitnessQuality').textContent=quality>=80?'Consolidado':quality>=55?'En observación':'Provisional';
  $('athleteFitnessSpark').innerHTML=fitnessSparkline(history);
  const change=Number(perf.fitness_change_28d); $('athleteFitnessChange').textContent=Number.isFinite(change)?`${change>=0?'+':''}${change.toFixed(1)} de aptitud en 28 días · ${perf.fitness_label||''}`:'Histórico de 28 días todavía insuficiente.';
  const consistency=Number(perf.consistency_28d); $('athleteConsistency').textContent=Number.isFinite(consistency)?`Consistencia ${Math.round(consistency)}%`:'Consistencia —';

  if(Number.isFinite(Number(perf.readiness_score))){
    const metrics=state.athlete.metrics||{}; metrics.readiness_score=Number(perf.readiness_score); metrics.readiness_label=perf.readiness_label||metrics.readiness_label; state.athlete.metrics=metrics;
  }
}

async function loadPerformance(refresh=false){
  try{state.performance=await api(`/api/athlete/performance?days=84${refresh?'&refresh=1':''}`); renderPerformance(); renderToday();}
  catch(error){console.warn('performance',error.message); renderPerformance();}
}

function renderToday() {
  const athlete=state.athlete; if(!athlete)return;
  const metrics=athlete.metrics||{};
  const week=athlete.week;
  const today=new Date();
  $('todayDate').textContent=new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long'}).format(today).replace(/^./,c=>c.toUpperCase());
  $('hello').textContent=`Hola, ${athlete.display_name}`;
  $('athleteAvatar').textContent=initials(athlete.display_name);
  $('profileAvatar').textContent=initials(athlete.display_name);
  $('profileName').textContent=athlete.display_name;
  $('profileAthleteName').textContent=athlete.display_name;
  $('profileObjective').textContent=athlete.profile?.objective || 'Entrenamiento guiado con RunFlow';
  $('coachButton').classList.toggle('hidden', localStorage.getItem('runflow_client')==='athlete' || !state.user?.roles?.includes('coach'));

  const recovery=readinessVisual(metrics);
  $('recoveryLabel').textContent=recovery.label;
  $('recoveryDetail').textContent=metrics.readiness_label || recovery.detail;
  document.querySelector('.athlete-mini-card.recovery').dataset.state=recovery.cls;

  const real=Number(week?.execution?.load ?? metrics.week_load ?? 0);
  const plan=Number(week?.execution?.planned_load ?? week?.target_load ?? metrics.planned_load ?? 0);
  $('weekLoadText').textContent=`${Math.round(real)} / ${Math.round(plan || 0)}`;
  $('weekLoadDetail').textContent=plan>0?`${Math.round((real/plan)*100)}% del plan`:'Sin objetivo de carga';
  $('weekLoadBar').style.width=`${plan>0?Math.min(100,Math.max(0,(real/plan)*100)):0}%`;

  const todaySession=todayWorkout();
  if(todaySession){
    $('todayWorkoutCard').className=`today-workout-card sport-${sportKey(todaySession.sport)}`;
    $('todayWorkoutIcon').textContent=sportIcon(todaySession.sport);
    $('todayWorkoutTitle').textContent=todaySession.title;
    $('todayWorkoutSummary').textContent=todaySession.summary || todaySession.session_objective || 'Sesión programada';
    const meta=[];
    if(Number(todaySession.planned_duration_min||0)>0)meta.push(`${Number(todaySession.planned_duration_min)} min`);
    if(Number(todaySession.planned_distance_km||0)>0)meta.push(`${Number(todaySession.planned_distance_km).toFixed(1)} km`);
    meta.push(`Carga ${Number(todaySession.planned_load||0)}`);
    meta.push(`Prioridad ${todaySession.priority||'C'}`);
    $('todayWorkoutMeta').innerHTML=meta.map(item=>`<span>${escapeHtml(item)}</span>`).join('');
    $('openTodayWorkout').classList.remove('hidden');
    $('openTodayWorkout').onclick=()=>openWorkout(todaySession.id);
  } else {
    $('todayWorkoutCard').className='today-workout-card sport-rest';
    $('todayWorkoutIcon').textContent='◌';
    $('todayWorkoutTitle').textContent=week?'Sin sesión programada hoy':'Semana aún sin publicar';
    $('todayWorkoutSummary').textContent=week?'Aprovecha para recuperar y seguir el contexto que haya dejado tu entrenador.':'Tu entrenador todavía no ha publicado esta semana.';
    $('todayWorkoutMeta').innerHTML='';
    $('openTodayWorkout').classList.add('hidden');
  }

  const next=nextWorkout();
  $('nextWorkoutTitle').textContent=next?next.title:'Sin otra sesión esta semana';
  $('nextWorkoutIcon').textContent=next?sportIcon(next.sport):'✓';
  $('nextWorkoutDetail').textContent=next?`${dateLabel(next.workout_date,true)} · ${Number(next.planned_duration_min||0)||'—'} min · carga ${Number(next.planned_load||0)}`:'Semana completada o sin más sesiones publicadas.';

  if(week){
    $('weekRange').textContent=`${dateLabel(week.week_start)} — ${dateLabel(addDays(week.week_start,6))}`;
    const byDate=new Map((week.workouts||[]).map(item=>[String(item.workout_date).slice(0,10),item]));
    const todayIso=localIso();
    $('weekVisual').innerHTML=Array.from({length:7},(_,index)=>{
      const date=addDays(week.week_start,index); const workout=byDate.get(date); const cls=workout?`has-session sport-${sportKey(workout.sport)}`:'rest';
      return `<button class="athlete-week-day ${cls} ${date===todayIso?'today':''}" data-week-workout="${workout?.id||''}" type="button"><small>${dayNames[index]}</small><span>${new Date(`${date}T12:00:00`).getDate()}</span><i>${workout?sportIcon(workout.sport):'·'}</i></button>`;
    }).join('');
    $('weekVisual').querySelectorAll('[data-week-workout]').forEach(button=>button.addEventListener('click',()=>button.dataset.weekWorkout&&openWorkout(button.dataset.weekWorkout)));
    $('coachWeekMessage').textContent=week.coach_comment || week.primary_objective || 'Sigue la planificación y avísame si necesitas adaptar algo.';
  } else {
    $('weekRange').textContent='Sin semana publicada';
    $('weekVisual').innerHTML='';
    $('coachWeekMessage').textContent='Tu entrenador todavía no ha publicado esta semana.';
  }

  const goals=[...(athlete.goals||[])].sort((a,b)=>String(a.goal_date).localeCompare(String(b.goal_date)));
  const main=goals.find(goal=>['A','Principal'].includes(goal.priority_code||goal.priority))||goals[0];
  $('mainGoalName').textContent=main?main.name:'Sin objetivo definido';
  $('mainGoalDays').textContent=main?daysUntil(main.goal_date):'—';
  $('mainGoalDate').textContent=main?`${dateLabel(main.goal_date,true)}${main.performance_target?` · ${main.performance_target}`:''}`:'Tu entrenador puede definir aquí tu próximo objetivo.';
}

function renderWeek() {
  const week=state.athlete?.week;
  if(!week){
    $('weekPageDates').textContent=`${dateLabel(state.selectedWeekStart)} – ${dateLabel(addDays(state.selectedWeekStart,6))}`;
    $('weekBadge').textContent='Sin publicar';
    $('weekTitle').textContent='Semana sin publicar';
    $('weekType').textContent='Planificación';
    $('weekComment').textContent='Tu entrenador todavía no ha publicado esta semana.';
    $('athleteWeek').innerHTML='<div class="empty-state">No hay sesiones publicadas para esta semana.</div>';
    return;
  }
  state.selectedWeekStart=week.week_start;
  $('weekPageDates').textContent=`${dateLabel(week.week_start)} – ${dateLabel(addDays(week.week_start,6))}`;
  $('weekBadge').textContent='Publicada';
  $('weekType').textContent=week.week_type||'Planificación';
  $('weekTitle').textContent=week.primary_objective||week.title||'Objetivo semanal';
  $('weekComment').textContent=week.coach_comment||'Sigue las sesiones programadas.';
  const byDate=new Map(); (week.workouts||[]).forEach(item=>{if(!byDate.has(item.workout_date))byDate.set(item.workout_date,[]);byDate.get(item.workout_date).push(item);});
  $('athleteWeek').innerHTML=Array.from({length:7},(_,index)=>{
    const date=addDays(week.week_start,index); const sessions=byDate.get(date)||[];
    if(!sessions.length)return `<article class="athlete-day-v2 rest-day"><div class="athlete-day-date"><small>${dayNames[index]}</small><strong>${new Date(`${date}T12:00:00`).getDate()}</strong></div><div><h3>Recuperación / sin sesión</h3><p>Día sin entrenamiento programado.</p></div></article>`;
    return sessions.map(workout=>`<button class="athlete-day-v2 sport-${sportKey(workout.sport)}" data-workout="${workout.id}" type="button"><div class="athlete-day-date"><small>${dayNames[index]}</small><strong>${new Date(`${date}T12:00:00`).getDate()}</strong></div><div class="athlete-day-copy"><span>${sportIcon(workout.sport)} ${sportLabel(workout.sport)} · ${executionLabel(workout.execution_status)}</span><h3>${escapeHtml(workout.title)}</h3><p>${escapeHtml(workout.summary||'Sesión programada')}</p><div><b>${Number(workout.planned_duration_min||0)||'—'} min</b><b>Carga ${Number(workout.planned_load||0)}</b>${workout.manual_log?.rpe?`<b>RPE ${workout.manual_log.rpe}</b>`:''}</div></div><span class="athlete-chevron">›</span></button>`).join('');
  }).join('');
  $('athleteWeek').querySelectorAll('[data-workout]').forEach(button=>button.addEventListener('click',()=>openWorkout(button.dataset.workout)));
}

function renderProfile(){
  const athlete=state.athlete;if(!athlete)return;
  $('profileFitness').textContent=athlete.metrics?.fitness??'—';
  $('profileFatigue').textContent=athlete.metrics?.fatigue??'—';
  $('profileForm').textContent=athlete.metrics?.form??'—';
  const zones=[...(athlete.zones?.pace||[]).slice(0,6),...(athlete.zones?.hr||[]).slice(0,6)];
  $('profileZones').innerHTML=zones.length?zones.map(zone=>`<div><span>${escapeHtml(zone.name||'Zona')}</span><strong>${zone.fast_pace||zone.slow_pace?`${escapeHtml(zone.fast_pace||'')}–${escapeHtml(zone.slow_pace||'')}`:`${zone.min_value??'—'}–${zone.max_value??'—'}`}</strong></div>`).join(''):'<p class="muted">Sin zonas configuradas.</p>';
}

function blockDuration(block){
  if(block.duration_min)return `${block.duration_min} min`;
  if(block.work_value)return `${block.work_value}${block.work_unit==='s'?' s':block.work_unit==='km'?' km':' min'}`;
  if(block.work_sec)return `${block.work_sec} s`;
  return '';
}
function renderWorkoutBlocks(workout){
  const blocks=Array.isArray(workout.blocks)?workout.blocks:[];
  if(!blocks.length)return `<article class="athlete-block-card"><span>Indicaciones</span><p>${escapeHtml(workout.structured_description||workout.summary||'Sin estructura adicional.')}</p></article>`;
  return blocks.map(block=>{
    if(block.type==='strength'){
      const exercises=Array.isArray(block.exercises)?block.exercises:[];
      return `<article class="athlete-block-card strength"><div class="athlete-block-title"><span>FUERZA</span><b>${escapeHtml(({low:'Coste bajo',medium:'Coste medio',high:'Coste alto'})[block.neuromuscular_cost]||'')}</b></div>${block.execution_note?`<p>${escapeHtml(block.execution_note)}</p>`:''}<div class="athlete-exercise-list">${exercises.map((exercise,index)=>`<div class="athlete-exercise"><i>${index+1}</i><div><strong>${escapeHtml(exercise.name||'Ejercicio')}</strong><span>${exercise.sets||'—'} × ${escapeHtml(exercise.reps||'—')}${exercise.weight_kg?` · ${exercise.weight_kg} kg`:''}${exercise.rir!=null?` · RIR ${exercise.rir}`:''}</span>${exercise.notes?`<small>${escapeHtml(exercise.notes)}</small>`:''}</div><b>${exercise.rest_sec?`${exercise.rest_sec}s`:'—'}</b></div>`).join('')}</div></article>`;
    }
    const label=({warmup:'Calentamiento',activation:'Activación',central:block.name||'Bloque principal',steady:block.name||'Bloque principal',cooldown:'Vuelta a la calma'})[block.type]||block.name||'Bloque';
    let detail='';
    if(block.type==='activation')detail=`${block.repetitions||1} × ${block.work_sec||0}s ${block.target||''}${block.recovery_sec?` / ${block.recovery_sec}s ${block.recovery_target||''}`:''}`;
    else if(['central','steady'].includes(block.type)&&Number(block.repetitions||1)>1)detail=`${block.repetitions} × ${blockDuration(block)} · ${block.target||''}${Number(block.recovery_value||0)>0?` · rec. ${block.recovery_value}${block.recovery_unit==='s'?'s':'m'} ${block.recovery_target||''}`:''}`;
    else detail=`${blockDuration(block)} ${block.target||''}`.trim();
    return `<article class="athlete-block-card"><div class="athlete-block-title"><span>${escapeHtml(label)}</span><b>${escapeHtml(detail)}</b></div></article>`;
  }).join('');
}

function openWorkout(id){
  const workout=state.athlete?.week?.workouts?.find(item=>String(item.id)===String(id)); if(!workout)return;
  state.selectedWorkout=workout;
  $('detailDate').textContent=dateLabel(workout.workout_date,true).toUpperCase();
  $('detailTitle').textContent=workout.title;
  $('detailStatus').textContent=executionLabel(workout.execution_status);
  $('detailSummary').textContent=workout.summary||workout.session_objective||'';
  const meta=[['Deporte',sportLabel(workout.sport)],['Duración',Number(workout.planned_duration_min||0)?`${workout.planned_duration_min} min`:'—'],['Carga',Number(workout.planned_load||0)],['Prioridad',workout.priority||'C']];
  if(Number(workout.planned_distance_km||0)>0)meta.splice(2,0,['Distancia',`${Number(workout.planned_distance_km).toFixed(1)} km`]);
  $('detailMeta').innerHTML=meta.map(([label,value])=>`<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  $('detailBlocks').innerHTML=renderWorkoutBlocks(workout);
  const feedback=workout.manual_log;
  if(feedback){
    $('detailFeedbackExisting').classList.remove('hidden');
    $('detailFeedbackExisting').innerHTML=`<strong>Tu feedback</strong><span>${feedback.rpe?`RPE ${feedback.rpe}`:'Sin RPE'}${feedback.feeling?` · ${escapeHtml(feelingLabel(feedback.feeling))}`:''}${feedback.pain!=null?` · molestia ${feedback.pain}/10`:''}</span>${feedback.comment?`<p>${escapeHtml(feedback.comment)}</p>`:''}`;
    $('openLog').textContent='Actualizar feedback';
  } else {
    $('detailFeedbackExisting').classList.add('hidden');
    $('openLog').textContent='Registrar cómo ha ido';
  }
  $('sessionDetail').classList.remove('hidden');
}

function feelingLabel(value){return ({muy_bien:'Muy buenas sensaciones',bien:'Buenas sensaciones',normal:'Sensaciones normales',mal:'Malas sensaciones'})[value]||value||'';}
function resetFeedbackForm(){
  const current=state.selectedWorkout?.manual_log||{};
  $('logStatus').value=current.status||'completed';
  document.querySelectorAll('[data-log-status]').forEach(button=>button.classList.toggle('active',button.dataset.logStatus===$('logStatus').value));
  $('logDuration').value=current.actual_duration_min??state.selectedWorkout?.planned_duration_min??'';
  $('logRpe').value=current.rpe??'';
  $('rpeValue').textContent=current.rpe?`${current.rpe}/10`:'—';
  document.querySelectorAll('[data-rpe]').forEach(button=>button.classList.toggle('active',String(button.dataset.rpe)===String(current.rpe||'')));
  $('logFeeling').value=current.feeling||'';
  document.querySelectorAll('[data-feeling]').forEach(button=>button.classList.toggle('active',button.dataset.feeling===current.feeling));
  $('logPain').value=current.pain??0;
  $('logPainArea').value=current.pain_area||'';
  $('logComment').value=current.comment||'';
  updateSrpePreview();
}
function updateSrpePreview(){
  const duration=Number($('logDuration').value||0),rpe=Number($('logRpe').value||0);
  $('srpePreview').textContent=duration>0&&rpe>0?`Carga interna sRPE: ${Math.round(duration*rpe)} (${duration} min × RPE ${rpe})`:'Carga interna sRPE: —';
}

function renderActivities() {
  const holder=$('athleteActivities');
  if(!state.activities.length){holder.innerHTML='<div class="empty-state">Todavía no hay actividades guardadas. Pulsa actualizar para recibirlas desde Intervals.</div>';return;}
  holder.innerHTML=state.activities.map(activity=>`<button class="athlete-activity-card-v2" data-activity="${escapeHtml(activity.intervals_activity_id)}" type="button"><div class="athlete-activity-icon">${sportIcon(activity.sport)}</div><div><span>${dateLabel(String(activity.activity_date).slice(0,10),true)}</span><h3>${escapeHtml(activity.name)}</h3><p>${distanceLabel(activity.distance_m)} · ${durationLabel(activity.duration_sec)}</p></div><div class="athlete-activity-load-v2"><strong>${numberLabel(activity.load)}</strong><small>carga</small></div></button>`).join('');
  holder.querySelectorAll('[data-activity]').forEach(button=>button.addEventListener('click',()=>openActivity(button.dataset.activity)));
}
async function loadActivities(sync=false){
  try{
    $('refreshAthleteActivities').disabled=true;
    $('athleteActivitiesStatus').textContent=sync?'Actualizando desde Intervals…':'Cargando historial…';
    const data=await api(`/api/athlete/activities?limit=12${sync?'&sync=1':''}`);
    state.activities=data.activities||[]; renderActivities();
    $('athleteActivitiesStatus').textContent=state.activities.length?`${state.activities.length} actividades recientes`:'Sin actividades recientes';
  }catch(error){$('athleteActivitiesStatus').textContent=error.message;}finally{$('refreshAthleteActivities').disabled=false;}
}
function scalarRawEntries(raw) {
  const ignored=new Set(['id','name','type','start_date','start_date_local','moving_time','elapsed_time','distance','icu_training_load','training_load','load','average_heartrate','max_heartrate','average_speed','total_elevation_gain','elevation_gain','icu_elevation_gain','calories','average_watts','icu_average_watts','max_watts','average_cadence','icu_intervals']);
  return Object.entries(raw||{}).filter(([key,value])=>!ignored.has(key)&&value!==null&&value!==''&&['string','number','boolean'].includes(typeof value)&&String(value).length<180).slice(0,30);
}
function prettyKey(key){return String(key).replace(/^icu_/,'').replace(/_/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());}
async function openActivity(externalId){
  try{
    const data=await api(`/api/athlete/activities/${encodeURIComponent(externalId)}`); const activity=data.activity||{},raw=activity.raw_summary||{};
    $('athleteActivityDate').textContent=fullDateLabel(activity.activity_date).toUpperCase(); $('athleteActivityName').textContent=activity.name||'Actividad';
    $('athleteActivityPlan').textContent=data.planned?`Planificada como: ${data.planned.title} · carga prevista ${Number(data.planned.planned_load||0)}`:'Actividad no vinculada a una sesión planificada.';
    const elevation=raw.total_elevation_gain??raw.elevation_gain??raw.icu_elevation_gain; const watts=raw.average_watts??raw.icu_average_watts;
    const primary=[['Duración',durationLabel(activity.duration_sec)],['Distancia',distanceLabel(activity.distance_m)],['Ritmo medio',paceLabel(activity.avg_pace_sec_per_km)],['Carga',numberLabel(activity.load)],['FC media',numberLabel(activity.avg_hr,' ppm')],['FC máxima',numberLabel(activity.max_hr,' ppm')],['Desnivel +',numberLabel(elevation,' m')],['Calorías',numberLabel(raw.calories,' kcal')],['Potencia media',numberLabel(watts,' W')],['Cadencia',numberLabel(raw.average_cadence,' spm')]];
    $('athleteActivityMetrics').innerHTML=primary.map(([label,value])=>`<article class="metric"><span>${label}</span><strong>${value}</strong></article>`).join('');
    const intervals=activity.intervals||[];
    $('athleteActivityIntervals').innerHTML=intervals.length?`<table><thead><tr><th>#</th><th>Bloque</th><th>Tiempo</th><th>Distancia</th><th>Ritmo</th><th>FC med.</th><th>FC máx.</th></tr></thead><tbody>${intervals.map(item=>`<tr><td>${item.index}</td><td>${escapeHtml(item.type)}</td><td>${durationLabel(item.duration_seconds)}</td><td>${item.distance_m?`${item.distance_m} m`:'—'}</td><td>${escapeHtml(item.pace||'—')}</td><td>${item.average_hr??'—'}</td><td>${item.max_hr??'—'}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">Intervals no ha devuelto parciales detallados.</p>';
    const extras=scalarRawEntries(raw); $('athleteActivityExtra').innerHTML=extras.length?extras.map(([key,value])=>`<div><span>${escapeHtml(prettyKey(key))}</span><strong>${escapeHtml(value)}</strong></div>`).join(''):'<p class="muted">No hay más métricas de resumen disponibles.</p>';
    $('athleteActivityModal').classList.remove('hidden');
  }catch(error){message(error.message,'error');}
}

function messageWorkoutTitle(messageItem){
  if(!messageItem.workout_id)return '';
  const workout=state.athlete?.week?.workouts?.find(item=>String(item.id)===String(messageItem.workout_id));
  return workout?.title||messageItem.workout_title||'Sesión';
}
function renderMessages(){
  const holder=$('athleteConversation');
  if(!state.messages.length){holder.innerHTML='<div class="athlete-chat-empty"><strong>Empieza la conversación</strong><p>Puedes avisar de una molestia, pedir un cambio de día o comentar cualquier aspecto de tu entrenamiento.</p></div>';return;}
  holder.innerHTML=state.messages.map(item=>`<article class="athlete-message-bubble ${item.sender_role==='athlete'?'mine':'theirs'}">${item.workout_id?`<span class="athlete-message-context">${escapeHtml(messageWorkoutTitle(item))}</span>`:''}<p>${escapeHtml(item.message)}</p><small>${new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(item.created_at))}</small></article>`).join('');
  holder.scrollTop=holder.scrollHeight;
}
async function loadMessages(markRead=false){
  const data=await api(`/api/athlete/messages?limit=100${markRead?'&mark_read=1':''}`);
  state.messages=data.messages||[]; renderMessages();
  const unread=Number(data.unread||0); $('bottomUnread').classList.toggle('hidden',!unread); $('bottomUnread').textContent=unread||''; $('messageUnreadBadge').classList.toggle('hidden',!unread); $('messageUnreadBadge').textContent=unread||'';
}
function populateMessageWorkoutOptions(){
  const workouts=state.athlete?.week?.workouts||[];
  $('athleteMessageWorkout').innerHTML='<option value="">Mensaje general</option>'+workouts.map(item=>`<option value="${item.id}">${dateLabel(item.workout_date)} · ${escapeHtml(item.title)}</option>`).join('');
  if(state.messageWorkoutId)$('athleteMessageWorkout').value=state.messageWorkoutId;
}

function renderAll(){renderToday();renderWeek();renderProfile();renderPerformance();populateMessageWorkoutOptions();}
async function loadDashboard(weekStart=state.selectedWeekStart){
  const data=await api(`/api/athlete/dashboard?week_start=${weekStart}`); state.athlete=data.athlete; state.selectedWeekStart=weekStart; renderAll();
}
async function init(){
  try{
    const me=await api('/api/auth/me'); state.user=me.user; if(!state.user.roles.includes('athlete'))return location.href='/coach';
    state.selectedWeekStart=isoMonday();
    await loadDashboard(state.selectedWeekStart);
    await Promise.allSettled([loadActivities(false),loadMessages(false),loadPerformance(true)]);
  }catch(error){message(error.message,'error');}
}

// RPE 1-10
$('rpeScale').innerHTML=Array.from({length:10},(_,index)=>`<button data-rpe="${index+1}" type="button">${index+1}</button>`).join('');
document.querySelectorAll('[data-rpe]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-rpe]').forEach(item=>item.classList.remove('active'));button.classList.add('active');$('logRpe').value=button.dataset.rpe;$('rpeValue').textContent=`${button.dataset.rpe}/10`;updateSrpePreview();}));
document.querySelectorAll('[data-log-status]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-log-status]').forEach(item=>item.classList.remove('active'));button.classList.add('active');$('logStatus').value=button.dataset.logStatus;}));
document.querySelectorAll('[data-feeling]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-feeling]').forEach(item=>item.classList.remove('active'));button.classList.add('active');$('logFeeling').value=button.dataset.feeling;}));
$('logDuration').addEventListener('input',updateSrpePreview);

document.querySelectorAll('[data-athlete-nav]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.athleteNav)));
$('athleteAvatar').addEventListener('click',()=>switchView('profile'));
$('logout').addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST'});location.href=localStorage.getItem('runflow_client')==='athlete'?'/login?mode=athlete':'/login';});
$('coachButton').addEventListener('click',()=>location.href='/coach');
$('athletePreviousWeek').addEventListener('click',()=>loadDashboard(addDays(state.selectedWeekStart,-7)).catch(error=>message(error.message,'error')));
$('athleteCurrentWeek').addEventListener('click',()=>loadDashboard(isoMonday()).catch(error=>message(error.message,'error')));
$('athleteNextWeek').addEventListener('click',()=>loadDashboard(addDays(state.selectedWeekStart,7)).catch(error=>message(error.message,'error')));
$('refreshAthleteActivities').addEventListener('click',()=>loadActivities(true));
$('closeDetail').addEventListener('click',()=>$('sessionDetail').classList.add('hidden'));
$('sessionDetail').addEventListener('click',event=>{if(event.target===$('sessionDetail'))$('sessionDetail').classList.add('hidden');});
$('openLog').addEventListener('click',()=>{resetFeedbackForm();$('sessionDetail').classList.add('hidden');$('logModal').classList.remove('hidden');});
$('closeLog').addEventListener('click',()=>$('logModal').classList.add('hidden'));
$('closeAthleteActivity').addEventListener('click',()=>$('athleteActivityModal').classList.add('hidden'));
$('athleteActivityModal').addEventListener('click',event=>{if(event.target===$('athleteActivityModal'))$('athleteActivityModal').classList.add('hidden');});
$('messageCoachFromWorkout').addEventListener('click',()=>{state.messageWorkoutId=state.selectedWorkout?.id||'';populateMessageWorkoutOptions();$('sessionDetail').classList.add('hidden');switchView('messages');setTimeout(()=>$('athleteMessageText').focus(),150);});
$('saveLog').addEventListener('click',async()=>{
  try{
    if(!$('logRpe').value && $('logStatus').value!=='skipped') throw new Error('Indica el RPE de la sesión.');
    const data=await api('/api/athlete/manual-log',{method:'POST',body:JSON.stringify({workout_id:state.selectedWorkout?.id,status:$('logStatus').value,actual_duration_min:$('logDuration').value,rpe:$('logRpe').value,pain:$('logPain').value,feeling:$('logFeeling').value,pain_area:$('logPainArea').value,comment:$('logComment').value})});
    if(state.selectedWorkout)state.selectedWorkout.manual_log=data.log;
    $('logModal').classList.add('hidden'); message('Feedback guardado. Tu entrenador ya puede verlo.','success'); await loadDashboard(state.selectedWeekStart);
  }catch(error){message(error.message,'error');}
});
$('athleteMessageForm').addEventListener('submit',async event=>{
  event.preventDefault(); const text=$('athleteMessageText').value.trim(); if(!text)return;
  try{
    await api('/api/athlete/messages',{method:'POST',body:JSON.stringify({message:text,workout_id:$('athleteMessageWorkout').value||null})});
    $('athleteMessageText').value=''; state.messageWorkoutId=''; $('athleteMessageWorkout').value=''; await loadMessages(true);
  }catch(error){message(error.message,'error');}
});
setInterval(()=>{if(state.user?.roles?.includes('athlete'))loadMessages(state.activeView==='messages').catch(()=>{});},30000);
init();
