const $ = id => document.getElementById(id);
const state = { user: null, athlete: null, selectedWorkout: null, selectedWeekStart: isoMonday(), activities: [] };
const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) location.href = localStorage.getItem('runflow_client') === 'athlete' ? '/login?mode=athlete' : '/login';
    throw new Error(data.error || 'No se pudo completar la operación.');
  }
  return data;
}

function isoMonday(date = new Date()) {
  const value = new Date(date);
  const day = value.getDay() || 7;
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() - day + 1);
  return value.toISOString().slice(0, 10);
}
function addDays(dateString, days) { const date = new Date(`${dateString}T12:00:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char])); }
function dateLabel(dateString, long = false) { return new Intl.DateTimeFormat('es-ES', long ? { weekday:'long', day:'numeric', month:'long' } : { day:'numeric', month:'short' }).format(new Date(`${String(dateString).slice(0, 10)}T12:00:00`)); }
function fullDateLabel(value) { return value ? new Intl.DateTimeFormat('es-ES', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(new Date(value)) : 'Sin fecha'; }
function daysUntil(dateString) { const a = new Date(); a.setHours(0,0,0,0); const b = new Date(`${dateString}T00:00:00`); return Math.max(0, Math.ceil((b-a)/86400000)); }
function message(text, type='') { const el=$('athleteMessage'); el.textContent=text; el.className=`notice ${type}`; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),4000); }
function readinessText(metrics) { const score=Number(metrics.readiness_score||50); if(score>=80)return 'Llegas fresco. Completa la sesión prevista, pero no necesitas añadir más carga.'; if(score>=65)return 'Puedes entrenar con normalidad. Respeta la intensidad y el volumen que ha marcado tu entrenador.'; if(score>=45)return 'Estado intermedio. Escucha las sensaciones del calentamiento y avisa si aparece fatiga o dolor.'; return 'La recuperación parece comprometida. No fuerces y consulta con tu entrenador antes de aumentar la intensidad.'; }
function durationLabel(seconds) { const value=Number(seconds); if(!Number.isFinite(value))return '—'; const h=Math.floor(value/3600),m=Math.floor((value%3600)/60),s=Math.round(value%60); return h?`${h} h ${String(m).padStart(2,'0')} min`:`${m}:${String(s).padStart(2,'0')}`; }
function distanceLabel(metres) { const value=Number(metres); return Number.isFinite(value)?`${(value/1000).toFixed(value>=10000?1:2)} km`:'—'; }
function paceLabel(seconds) { const value=Number(seconds); if(!Number.isFinite(value)||value<=0)return '—'; const rounded=Math.round(value); return `${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,'0')}/km`; }
function numberLabel(value, suffix='') { const number=Number(value); return Number.isFinite(number)?`${Math.round(number*10)/10}${suffix}`:'—'; }

function goalCard(goal) { return `<article class="goal"><div class="goal-days"><div><strong>${daysUntil(goal.goal_date)}</strong><small>días</small></div></div><div><span class="badge ${goal.priority==='Principal'?'':'pending'}">${escapeHtml(goal.priority)}</span><h3 style="margin-top:7px">${escapeHtml(goal.name)}</h3><p>${dateLabel(goal.goal_date)}${goal.performance_target?` · ${escapeHtml(goal.performance_target)}`:''}</p></div></article>`; }

function render() {
  const athlete=state.athlete, metrics=athlete.metrics||{}, week=athlete.week;
  $('hello').textContent=`Hola, ${athlete.display_name}`;
  $('coachButton').classList.toggle('hidden', localStorage.getItem('runflow_client') === 'athlete' || !state.user.roles.includes('coach'));
  $('score').textContent=metrics.readiness_score??'—'; $('scoreLabel').textContent=metrics.readiness_label||'Sin datos suficientes'; $('scoreText').textContent=readinessText(metrics);
  $('fitness').textContent=metrics.fitness??'—'; $('fatigue').textContent=metrics.fatigue??'—'; $('form').textContent=metrics.form??'—'; $('load').textContent=metrics.week_load??0;
  const goals=[...(athlete.goals||[])].sort((a,b)=>String(a.goal_date).localeCompare(String(b.goal_date))); const main=goals.find(goal=>goal.priority==='Principal')||goals[0];
  $('days').textContent=main?daysUntil(main.goal_date):'—'; $('mainGoal').textContent=main?main.name:'objetivo';
  $('athleteGoals').innerHTML=goals.length?goals.map(goalCard).join(''):'<p class="muted">Todavía no hay objetivos definidos.</p>';

  if(!week){
    $('weekDates').textContent=`${dateLabel(state.selectedWeekStart)} – ${dateLabel(addDays(state.selectedWeekStart,6))}`;
    $('weekBadge').textContent='Sin publicar'; $('weekBadge').className='badge pending';
    $('weekTitle').textContent='Semana sin publicar'; $('weekType').textContent='Planificación';
    $('weekComment').textContent='Tu entrenador todavía no ha publicado esta semana.';
    $('planned').textContent='Programada: 0';
    $('athleteWeek').innerHTML='<div class="empty-state">No hay sesiones publicadas para esta semana.</div>';
    return;
  }
  state.selectedWeekStart=week.week_start;
  $('weekDates').textContent=`${dateLabel(week.week_start)} – ${dateLabel(addDays(week.week_start,6))}`;
  $('weekBadge').textContent='Publicada'; $('weekBadge').className='badge';
  $('planned').textContent=`Programada: ${week.target_load??metrics.planned_load??0}`;
  $('weekTitle').textContent=week.title||'Objetivo de la semana'; $('weekType').textContent=week.week_type||'Planificación'; $('weekComment').textContent=week.coach_comment||'Sigue las sesiones programadas.';
  $('athleteWeek').innerHTML=(week.workouts||[]).length?(week.workouts||[]).map(workout=>{
    const date=new Date(`${workout.workout_date}T12:00:00`);
    return `<article class="athlete-session"><div class="calendar-day"><div><small>${dayNames[date.getDay()]}</small><strong>${date.getDate()}</strong></div></div><div><h3>${escapeHtml(workout.title)}</h3><p>${escapeHtml(workout.summary||'Sin indicaciones adicionales.')}</p><span class="badge" style="margin-top:7px">Carga ${Number(workout.planned_load||0)}</span></div><button class="btn soft small" data-workout="${workout.id}" type="button">Ver</button></article>`;
  }).join(''):'<div class="empty-state">La semana está publicada, pero no contiene sesiones.</div>';
  document.querySelectorAll('[data-workout]').forEach(button=>button.addEventListener('click',()=>openWorkout(button.dataset.workout)));
}

function openWorkout(id){ const workout=state.athlete.week.workouts.find(item=>String(item.id)===String(id)); state.selectedWorkout=workout; $('detailTitle').textContent=workout.title; $('detailSummary').textContent=workout.summary||''; $('detailStructured').textContent=workout.structured_description||workout.summary||'Sin estructura adicional.'; $('sessionDetail').classList.remove('hidden'); }

function renderActivities() {
  const holder=$('athleteActivities');
  if(!state.activities.length){ holder.innerHTML='<div class="empty-state">Todavía no hay actividades guardadas. Pulsa «Actualizar» para recibirlas desde Intervals.</div>'; return; }
  holder.innerHTML=state.activities.map(activity=>`<button class="athlete-activity-card" data-activity="${escapeHtml(activity.intervals_activity_id)}" type="button"><div><span class="eyebrow">${dateLabel(String(activity.activity_date).slice(0,10),true)}</span><h3>${escapeHtml(activity.name)}</h3><p>${escapeHtml(activity.sport||'Actividad')} · ${distanceLabel(activity.distance_m)} · ${durationLabel(activity.duration_sec)}</p></div><div class="athlete-activity-load"><strong>${numberLabel(activity.load)}</strong><small>carga</small></div></button>`).join('');
  holder.querySelectorAll('[data-activity]').forEach(button=>button.addEventListener('click',()=>openActivity(button.dataset.activity)));
}

async function loadActivities(sync=false){
  try{
    $('refreshAthleteActivities').disabled=true;
    $('athleteActivitiesStatus').textContent=sync?'Actualizando desde Intervals…':'Cargando historial…';
    const data=await api(`/api/athlete/activities?limit=5${sync?'&sync=1':''}`);
    state.activities=data.activities||[];
    renderActivities();
    $('athleteActivitiesStatus').textContent=state.activities.length?`${state.activities.length} actividades recientes`:'Sin actividades recientes';
  }catch(error){
    $('athleteActivitiesStatus').textContent=error.message;
  }finally{$('refreshAthleteActivities').disabled=false;}
}

function scalarRawEntries(raw) {
  const ignored=new Set(['id','name','type','start_date','start_date_local','moving_time','elapsed_time','distance','icu_training_load','training_load','load','average_heartrate','max_heartrate','average_speed','total_elevation_gain','elevation_gain','icu_elevation_gain','calories','average_watts','icu_average_watts','max_watts','average_cadence','icu_intervals']);
  return Object.entries(raw||{}).filter(([key,value])=>!ignored.has(key)&&value!==null&&value!==''&&['string','number','boolean'].includes(typeof value)&&String(value).length<180).slice(0,30);
}
function prettyKey(key){return String(key).replace(/^icu_/,'').replace(/_/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());}

async function openActivity(externalId){
  try{
    const data=await api(`/api/athlete/activities/${encodeURIComponent(externalId)}`);
    const activity=data.activity||{},raw=activity.raw_summary||{};
    $('athleteActivityDate').textContent=fullDateLabel(activity.activity_date);
    $('athleteActivityName').textContent=activity.name||'Actividad';
    $('athleteActivityPlan').textContent=data.planned?`Planificada como: ${data.planned.title} · carga prevista ${Number(data.planned.planned_load||0)}`:'No se ha encontrado una sesión programada vinculada en esa fecha.';
    const elevation=raw.total_elevation_gain??raw.elevation_gain??raw.icu_elevation_gain;
    const watts=raw.average_watts??raw.icu_average_watts;
    const primary=[
      ['Duración',durationLabel(activity.duration_sec)],['Distancia',distanceLabel(activity.distance_m)],['Ritmo medio',paceLabel(activity.avg_pace_sec_per_km)],['Carga',numberLabel(activity.load)],
      ['FC media',numberLabel(activity.avg_hr,' ppm')],['FC máxima',numberLabel(activity.max_hr,' ppm')],['Desnivel +',numberLabel(elevation,' m')],['Calorías',numberLabel(raw.calories,' kcal')],
      ['Potencia media',numberLabel(watts,' W')],['Potencia máxima',numberLabel(raw.max_watts,' W')],['Cadencia',numberLabel(raw.average_cadence,' spm')],['Deporte',escapeHtml(activity.sport||raw.type||'—')],
    ];
    $('athleteActivityMetrics').innerHTML=primary.map(([label,value])=>`<article class="metric"><span>${label}</span><strong>${value}</strong></article>`).join('');
    const intervals=activity.intervals||[];
    $('athleteActivityIntervals').innerHTML=intervals.length?`<table><thead><tr><th>#</th><th>Bloque</th><th>Tiempo</th><th>Distancia</th><th>Ritmo</th><th>FC med.</th><th>FC máx.</th></tr></thead><tbody>${intervals.map(item=>`<tr><td>${item.index}</td><td>${escapeHtml(item.type)}</td><td>${durationLabel(item.duration_seconds)}</td><td>${item.distance_m?`${item.distance_m} m`:'—'}</td><td>${escapeHtml(item.pace||'—')}</td><td>${item.average_hr??'—'}</td><td>${item.max_hr??'—'}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">Intervals no ha devuelto parciales detallados para esta actividad.</p>';
    const extras=scalarRawEntries(raw);
    $('athleteActivityExtra').innerHTML=extras.length?extras.map(([key,value])=>`<div><span>${escapeHtml(prettyKey(key))}</span><strong>${escapeHtml(value)}</strong></div>`).join(''):'<p class="muted">No hay más métricas de resumen disponibles.</p>';
    $('athleteActivityModal').classList.remove('hidden');
  }catch(error){message(error.message,'error');}
}

async function loadDashboard(weekStart=state.selectedWeekStart){
  const data=await api(`/api/athlete/dashboard?week_start=${weekStart}`);
  state.athlete=data.athlete;
  state.selectedWeekStart=weekStart;
  render();
}

async function init(){
  try{
    const me=await api('/api/auth/me'); state.user=me.user;
    if(!state.user.roles.includes('athlete')) return location.href='/coach';
    state.selectedWeekStart=isoMonday();
    await loadDashboard(state.selectedWeekStart);
    await loadActivities(false);
  }catch(error){message(error.message,'error');}
}

$('logout').addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST'});location.href=localStorage.getItem('runflow_client')==='athlete'?'/login?mode=athlete':'/login';});
$('coachButton').addEventListener('click',()=>location.href='/coach');
$('athletePreviousWeek').addEventListener('click',()=>loadDashboard(addDays(state.selectedWeekStart,-7)).catch(error=>message(error.message,'error')));
$('athleteCurrentWeek').addEventListener('click',()=>loadDashboard(isoMonday()).catch(error=>message(error.message,'error')));
$('athleteNextWeek').addEventListener('click',()=>loadDashboard(addDays(state.selectedWeekStart,7)).catch(error=>message(error.message,'error')));
$('refreshAthleteActivities').addEventListener('click',()=>loadActivities(true));
$('closeDetail').addEventListener('click',()=>$('sessionDetail').classList.add('hidden'));
$('sessionDetail').addEventListener('click',event=>{if(event.target===$('sessionDetail'))$('sessionDetail').classList.add('hidden');});
$('openLog').addEventListener('click',()=>{$('sessionDetail').classList.add('hidden');$('logModal').classList.remove('hidden');});
$('closeLog').addEventListener('click',()=>$('logModal').classList.add('hidden'));
$('closeAthleteActivity').addEventListener('click',()=>$('athleteActivityModal').classList.add('hidden'));
$('athleteActivityModal').addEventListener('click',event=>{if(event.target===$('athleteActivityModal'))$('athleteActivityModal').classList.add('hidden');});
$('saveLog').addEventListener('click',async()=>{try{await api('/api/athlete/manual-log',{method:'POST',body:JSON.stringify({workout_id:state.selectedWorkout?.id,status:$('logStatus').value,actual_duration_min:$('logDuration').value,rpe:$('logRpe').value,pain:$('logPain').value,comment:$('logComment').value})});$('logModal').classList.add('hidden');message('Registro guardado. Tu entrenador podrá verlo.','success');}catch(error){message(error.message,'error');}});
init();
