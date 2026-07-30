const $ = id => document.getElementById(id);
const state = { user: null, athlete: null, selectedWorkout: null };
const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401) location.href = '/login'; throw new Error(data.error || 'No se pudo completar la operación.'); }
  return data;
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
function dateLabel(dateString, long = false) { return new Intl.DateTimeFormat('es-ES', long ? { weekday:'long', day:'numeric', month:'long' } : { day:'numeric', month:'short' }).format(new Date(`${dateString}T12:00:00`)); }
function daysUntil(dateString) { const a = new Date(); a.setHours(0,0,0,0); const b = new Date(`${dateString}T00:00:00`); return Math.max(0, Math.ceil((b-a)/86400000)); }
function message(text, type='') { const el=$('athleteMessage'); el.textContent=text; el.className=`notice ${type}`; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),4000); }
function readinessText(metrics) { const s=Number(metrics.readiness_score||50); if(s>=80)return 'Llegas fresco. Completa la sesión prevista, pero no necesitas añadir más carga.'; if(s>=65)return 'Puedes entrenar con normalidad. Respeta la intensidad y el volumen que ha marcado tu entrenador.'; if(s>=45)return 'Estado intermedio. Escucha las sensaciones del calentamiento y avisa si aparece fatiga o dolor.'; return 'La recuperación parece comprometida. No fuerces y consulta con tu entrenador antes de aumentar la intensidad.'; }

function goalCard(goal) { return `<article class="goal"><div class="goal-days"><div><strong>${daysUntil(goal.goal_date)}</strong><small>días</small></div></div><div><span class="badge ${goal.priority==='Principal'?'':'pending'}">${escapeHtml(goal.priority)}</span><h3 style="margin-top:7px">${escapeHtml(goal.name)}</h3><p>${dateLabel(goal.goal_date)}${goal.performance_target?` · ${escapeHtml(goal.performance_target)}`:''}</p></div></article>`; }

function render() {
  const athlete=state.athlete, metrics=athlete.metrics||{}, week=athlete.week;
  $('hello').textContent=`Hola, ${athlete.display_name}`;
  $('coachButton').classList.toggle('hidden', !state.user.roles.includes('coach'));
  if(!week){ $('weekBadge').textContent='Sin publicar'; $('weekBadge').className='badge pending'; $('weekComment').textContent='Tu entrenador todavía no ha publicado esta semana.'; return; }
  const end=new Date(`${week.week_start}T12:00:00`); end.setDate(end.getDate()+6);
  $('weekDates').textContent=`${dateLabel(week.week_start)} – ${new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short'}).format(end)}`;
  $('weekBadge').textContent='Publicada'; $('weekBadge').className='badge';
  $('score').textContent=metrics.readiness_score??'—'; $('scoreLabel').textContent=metrics.readiness_label||'Sin datos suficientes'; $('scoreText').textContent=readinessText(metrics);
  $('fitness').textContent=metrics.fitness??'—'; $('fatigue').textContent=metrics.fatigue??'—'; $('form').textContent=metrics.form??'—'; $('load').textContent=metrics.week_load??0; $('planned').textContent=`Programada: ${metrics.planned_load??week.target_load??0}`;
  $('weekTitle').textContent=week.title||'Objetivo de la semana'; $('weekType').textContent=week.week_type||'Planificación'; $('weekComment').textContent=week.coach_comment||'Sigue las sesiones programadas.';
  const goals=[...(athlete.goals||[])].sort((a,b)=>String(a.goal_date).localeCompare(String(b.goal_date))); const main=goals.find(g=>g.priority==='Principal')||goals[0]; $('days').textContent=main?daysUntil(main.goal_date):'—'; $('mainGoal').textContent=main?main.name:'objetivo';
  $('athleteGoals').innerHTML=goals.length?goals.map(goalCard).join(''):'<p class="muted">Todavía no hay objetivos definidos.</p>';
  $('athleteWeek').innerHTML=(week.workouts||[]).map((workout,index)=>`<article class="athlete-session"><div class="calendar-day"><div><small>${dayNames[index]||''}</small><strong>${new Date(`${workout.workout_date}T12:00:00`).getDate()}</strong></div></div><div><h3>${escapeHtml(workout.title)}</h3><p>${escapeHtml(workout.summary||'Sin indicaciones adicionales.')}</p><span class="badge" style="margin-top:7px">Carga ${Number(workout.planned_load||0)}</span></div><button class="btn soft small" data-workout="${workout.id}" type="button">Ver</button></article>`).join('');
  document.querySelectorAll('[data-workout]').forEach(button=>button.addEventListener('click',()=>openWorkout(button.dataset.workout)));
}

function openWorkout(id){ const w=state.athlete.week.workouts.find(item=>item.id===id); state.selectedWorkout=w; $('detailTitle').textContent=w.title; $('detailSummary').textContent=w.summary||''; $('detailStructured').textContent=w.structured_description||w.summary||'Sin estructura adicional.'; $('sessionDetail').classList.remove('hidden'); }

async function init(){ try{ const me=await api('/api/auth/me'); state.user=me.user; if(!state.user.roles.includes('athlete')) return location.href='/coach'; const data=await api('/api/athlete/dashboard'); state.athlete=data.athlete; render(); }catch(error){ message(error.message,'error'); } }
$('logout').addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST'});location.href='/login';});
$('coachButton').addEventListener('click',()=>location.href='/coach');
$('closeDetail').addEventListener('click',()=>$('sessionDetail').classList.add('hidden'));
$('sessionDetail').addEventListener('click',e=>{if(e.target===$('sessionDetail'))$('sessionDetail').classList.add('hidden');});
$('openLog').addEventListener('click',()=>{$('sessionDetail').classList.add('hidden');$('logModal').classList.remove('hidden');});
$('closeLog').addEventListener('click',()=>$('logModal').classList.add('hidden'));
$('saveLog').addEventListener('click',async()=>{try{await api('/api/athlete/manual-log',{method:'POST',body:JSON.stringify({workout_id:state.selectedWorkout?.id,status:$('logStatus').value,actual_duration_min:$('logDuration').value,rpe:$('logRpe').value,pain:$('logPain').value,comment:$('logComment').value})});$('logModal').classList.add('hidden');message('Registro guardado. Tu entrenador podrá verlo.','success');}catch(error){message(error.message,'error');}});
init();
