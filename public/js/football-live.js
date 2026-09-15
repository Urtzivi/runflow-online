(()=>{
  'use strict';
  const $=selector=>document.querySelector(selector);
  const $$=selector=>[...document.querySelectorAll(selector)];
  const live={dashboard:null,summary:null,today:null};

  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      if(response.status===401)return location.replace('/login?mode=athlete');
      throw new Error(data.error||'No se pudo conectar con RunFlow.');
    }
    return data;
  }
  function todayKey(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
  function firstName(value){return String(value||'').trim().split(/\s+/)[0]||'Futbolista';}
  function minutes(workout){return Number(workout?.planned_duration_min||0);}
  function liveToast(text){const el=$('#toast');if(!el)return;el.textContent=text;el.classList.add('show');clearTimeout(window.__rfFootballLiveToast);window.__rfFootballLiveToast=setTimeout(()=>el.classList.remove('show'),2200);}
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

  function workoutExercises(workout){
    return (Array.isArray(workout?.blocks)?workout.blocks:[]).flatMap(block=>Array.isArray(block?.exercises)?block.exercises:[]);
  }
  function renderRealTraining(){
    const workout=live.today;
    const homeTitle=$('#home .session-card h2'),sub=$('#sessionSub');
    const detailTitle=$('#training .cover-copy h2'),detailMeta=$('#training .cover-copy .muted'),detailNote=$('#training .cover-copy div:last-child');
    if(!workout){
      if(homeTitle)homeTitle.textContent='Sin sesión publicada';
      if(sub)sub.textContent='Hoy no hay entrenamiento programado';
      if(detailTitle)detailTitle.textContent='Sin sesión publicada';
      if(detailMeta)detailMeta.textContent='Día libre o pendiente de planificación';
      if(detailNote)detailNote.textContent='Consulta con tu entrenador si esperabas una sesión.';
      const list=$('#exerciseList');if(list)list.innerHTML='<div class="card empty">Hoy no hay ejercicios publicados en RunFlow Coach.</div>';
      return;
    }
    const duration=minutes(workout);
    const title=workout.title||'Sesión programada';
    const summary=workout.session_objective||workout.summary||workout.structured_description||'Sigue las indicaciones de tu entrenador.';
    if(homeTitle)homeTitle.textContent=title;
    if(sub)sub.textContent=`${duration||'—'} min · sesión publicada`;
    if(detailTitle)detailTitle.textContent=title;
    if(detailMeta)detailMeta.textContent=`${duration||'—'} min · ${workout.sport||'Fútbol'}`;
    if(detailNote)detailNote.textContent=summary;
    const exercises=workoutExercises(workout),list=$('#exerciseList');
    if(!list||!exercises.length)return;
    list.innerHTML=exercises.map((exercise,index)=>`<div class="card exercise"><span style="width:59px;height:57px;border-radius:10px;background:#10283a;display:grid;place-items:center;font-size:20px">${index+1}</span><span><strong>${escapeHtml(exercise.name||'Ejercicio')}</strong><span>${escapeHtml(`${exercise.sets||'—'} × ${exercise.reps||'—'}${exercise.rir!=null?` · RIR ${exercise.rir}`:''}`)}</span>${exercise.notes?`<span>${escapeHtml(exercise.notes)}</span>`:''}</span><span class="check"></span></div>`).join('');
  }

  function renderIdentity(){
    const athlete=live.dashboard?.athlete||{};
    const name=firstName(athlete.display_name);
    const greeting=$('#greeting');if(greeting)greeting.textContent=`¡Buenos días, ${name}!`;
    const profileName=$('#profileName');if(profileName)profileName.value=athlete.display_name||name;
    const week=athlete.week,workouts=Array.isArray(week?.workouts)?week.workouts:[];
    live.today=workouts.find(item=>String(item.workout_date).slice(0,10)===todayKey())||null;
    renderRealTraining();
  }

  function renderHistory(){
    const root=$('#activityList');if(!root)return;
    const rows=(live.summary?.recent||[]).filter(item=>item.kind!=='wellbeing').slice(0,40);
    if(!rows.length){root.innerHTML='<div class="card empty">Aún no hay actividad guardada en RunFlow.</div>';return;}
    const labels={football_training:'Fútbol',strength:'Fuerza',match:'Partido',challenge:'Reto'};
    root.innerHTML=rows.map(item=>{const mins=item.kind==='match'?item.minutes_played:item.duration_min;return `<div class="card activity-item"><strong>${escapeHtml(labels[item.kind]||item.kind)}${item.title?` · ${escapeHtml(item.title)}`:''}</strong><span>${new Date(item.created_at).toLocaleString('es-ES')}${mins!=null?` · ${mins} min`:''}${item.rpe?` · RPE ${item.rpe}`:''}${item.load?` · carga ${item.load}`:''}</span></div>`}).join('');
  }
  async function refreshSummary(){live.summary=await api('/api/athlete/football/summary');renderHistory();}

  async function saveReadiness(button){
    const score={Genial:5,Bien:4,Regular:3,Mal:1}[button.dataset.label];
    if(!score)return;
    try{
      await Promise.all([
        api('/api/v2/athlete/daily-checkin',{method:'POST',body:JSON.stringify({recovery_score:score})}),
        api('/api/athlete/football/wellbeing',{method:'POST',body:JSON.stringify({feeling:{5:'muy_bien',4:'bien',3:'normal',1:'mal'}[score],energy:score,soreness:6-score,title:'Bienestar diario'})})
      ]);
      liveToast('Estado guardado en RunFlow');
      await refreshSummary();
    }catch(error){liveToast(error.message);}
  }
  async function saveFootballActivity(payload){
    try{await api('/api/athlete/football/activity',{method:'POST',body:JSON.stringify(payload)});liveToast('Actividad guardada en RunFlow');await refreshSummary();}
    catch(error){liveToast(error.message);}
  }

  $$('.mood').forEach(button=>button.addEventListener('click',()=>saveReadiness(button)));
  $('#confirmFinish')?.addEventListener('click',()=>{
    const duration=Number($('#finishDuration')?.value),rpe=Number($('#finishRpe')?.value);
    if(duration>0&&rpe>=1&&rpe<=10)saveFootballActivity({kind:'strength',duration_min:duration,rpe,workout_id:live.today?.id||null,title:live.today?.title||'Sesión de fuerza'});
  },true);
  $('#saveActivity')?.addEventListener('click',()=>{
    const selected=$('.log-kind button.active')?.dataset.logKind||'Fútbol';
    const kind={Fútbol:'football_training',Fuerza:'strength',Partido:'match'}[selected];
    const rpe=Number($('#logRpe')?.value),note=$('#logNote')?.value||'';
    const payload={kind,rpe,note,workout_id:live.today?.id||null,title:live.today?.title||selected};
    if(kind==='match')payload.minutes_played=Number($('#logMinutes')?.value);else payload.duration_min=Number($('#logDuration')?.value);
    if(rpe>=1&&rpe<=10)saveFootballActivity(payload);
  },true);
  $$('[data-go="training"]').forEach(button=>button.addEventListener('click',()=>setTimeout(renderRealTraining,0)));
  $$('[data-go="calendar"]').forEach(button=>button.addEventListener('click',()=>setTimeout(renderHistory,0)));

  (async()=>{
    try{
      const me=await api('/api/auth/me');
      if(!Array.isArray(me?.user?.roles)||!me.user.roles.includes('athlete'))return location.replace('/login?mode=athlete');
      [live.dashboard,live.summary]=await Promise.all([api('/api/athlete/dashboard'),api('/api/athlete/football/summary')]);
      renderIdentity();renderHistory();
    }catch(error){console.error('[RunFlow Fútbol Live]',error);liveToast(error.message);}
  })();
})();
