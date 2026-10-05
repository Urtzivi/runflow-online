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
    if(duration>0&&rpe>=1&&rpe<=10)saveFootballActivity({kind:'strength',duration_min:duration,rpe,activity_date:todayKey(),workout_id:live.today?.id||null,title:live.today?.title||'Sesión de fuerza'});
  },true);
  $('#saveActivity')?.addEventListener('click',()=>{
    const selected=$('.log-kind button.active')?.dataset.logKind||'Fútbol';
    const kind={Fútbol:'football_training',Fuerza:'strength',Partido:'match'}[selected];
    const rpe=Number($('#logRpe')?.value),note=$('#logNote')?.value||'';
    const activityDate=$('#logDate')?.value||todayKey();
    const payload={kind,rpe,note,activity_date:activityDate,workout_id:activityDate===todayKey()?live.today?.id||null:null,title:activityDate===todayKey()&&live.today?.title?live.today.title:selected};
    if(kind==='match')payload.minutes_played=Number($('#logMinutes')?.value);else payload.duration_min=Number($('#logDuration')?.value);
    const minutesValue=kind==='match'?payload.minutes_played:payload.duration_min;
    if(rpe>=1&&rpe<=10&&minutesValue>0)saveFootballActivity(payload);
  },true);
  // Reto del día: además del estado local, queda en el historial que ve el coach.
  $('#completeChallenge')?.addEventListener('click',()=>{
    const bridge=window.RunFlowFootball,challenge=bridge?.activeChallenge?.();
    if(!challenge)return;
    if(bridge.state().challenges?.[`${todayKey()}|${challenge.id}`]?.done)return;
    api('/api/athlete/football/challenge',{method:'POST',body:JSON.stringify({challenge_id:challenge.id,title:challenge.title,challenge_result:$('#challengeResult')?.value||'',activity_date:todayKey()})})
      .then(refreshSummary).catch(error=>liveToast(error.message));
  },true);

  // Estado de fútbol (perfil, tests, retos, ejercicios, bienestar) guardado en RunFlow.
  const SEEDED_DEMO={sprint:{date:'2026-08-10',m5:1.11},growth:{date:'2026-06-29',height:164}};
  let stateReady=false,stateTimer=null;
  function withoutDemoSeed(local,displayName){
    const state=structuredClone(local||{});
    if(/^liher\b/i.test(String(displayName||'').trim()))return state;
    const results=state.results||{};
    results.sprint=(results.sprint||[]).filter(entry=>!(entry.date===SEEDED_DEMO.sprint.date&&entry.values?.m5===SEEDED_DEMO.sprint.m5));
    results.growth=(results.growth||[]).filter(entry=>!(entry.date===SEEDED_DEMO.growth.date&&entry.values?.height===SEEDED_DEMO.growth.height));
    state.results=results;
    if(state.profile?.name==='Liher')state.profile={name:'',position:'',team:'',category:''};
    return state;
  }
  async function pushState(){
    const bridge=window.RunFlowFootball;if(!bridge||!stateReady)return;
    try{await api('/api/athlete/football/state',{method:'PUT',body:JSON.stringify({state:bridge.state()})});}
    catch(error){liveToast(`No se pudo guardar en RunFlow: ${error.message}`);}
  }
  document.addEventListener('runflow:football-state-changed',()=>{if(!stateReady)return;clearTimeout(stateTimer);stateTimer=setTimeout(pushState,1200);});
  async function loadState(){
    const bridge=window.RunFlowFootball;if(!bridge)return;
    const displayName=live.dashboard?.athlete?.display_name||'';
    const remote=(await api('/api/athlete/football/state')).state;
    const next=remote||withoutDemoSeed(bridge.state(),displayName);
    next.profile={name:'',position:'',team:'',category:'',...(next.profile||{})};
    if(!next.profile.name)next.profile.name=displayName;
    bridge.replace(next);
    renderIdentity();
    stateReady=true;
    if(!remote)await pushState();
  }

  // Foto del deportista en el inicio. Se reduce en el móvil antes de subirla.
  function showPhoto(url){
    const img=$('#heroPhoto');if(!img)return;
    if(url){img.src=url;img.classList.remove('hidden-photo');}else{img.removeAttribute('src');img.classList.add('hidden-photo');}
    const label=$('#heroPhotoLabel');if(label)label.textContent=url?'Cambiar foto':'Añadir mi foto';
  }
  async function loadPhoto(){
    const response=await fetch('/api/athlete/football/photo',{credentials:'same-origin',cache:'no-store'});
    if(response.ok)showPhoto(URL.createObjectURL(await response.blob()));else showPhoto(null);
  }
  function resizePhoto(file,maxSide=1080){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file),img=new Image();
      img.onload=()=>{
        const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);URL.revokeObjectURL(url);
        canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo preparar la foto.')),'image/jpeg',0.85);
      };
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('No se pudo leer la foto.'));};
      img.src=url;
    });
  }
  $('#heroPhotoButton')?.addEventListener('click',()=>$('#heroPhotoInput')?.click());
  $('#heroPhotoInput')?.addEventListener('change',async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    try{
      liveToast('Subiendo foto…');
      const blob=await resizePhoto(file);
      const response=await fetch('/api/athlete/football/photo',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'image/jpeg'},body:blob});
      if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'No se pudo guardar la foto.');
      showPhoto(URL.createObjectURL(blob));liveToast('Foto guardada');
    }catch(error){liveToast(error.message);}
  });

  $$('[data-go="training"]').forEach(button=>button.addEventListener('click',()=>setTimeout(renderRealTraining,0)));
  $$('[data-go="calendar"]').forEach(button=>button.addEventListener('click',()=>setTimeout(renderHistory,0)));

  (async()=>{
    try{
      const me=await api('/api/auth/me');
      if(!Array.isArray(me?.user?.roles)||!me.user.roles.includes('athlete'))return location.replace('/login?mode=athlete');
      [live.dashboard,live.summary]=await Promise.all([api('/api/athlete/dashboard'),api('/api/athlete/football/summary')]);
      renderIdentity();renderHistory();
      await Promise.all([loadState().catch(error=>{console.warn('[RunFlow Fútbol] estado',error);liveToast('Tus datos de fútbol no se han podido sincronizar ahora.');}),loadPhoto().catch(()=>showPhoto(null))]);
    }catch(error){console.error('[RunFlow Fútbol Live]',error);liveToast(error.message);}
  })();
})();
