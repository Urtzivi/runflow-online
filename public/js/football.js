(()=>{
  const $=id=>document.getElementById(id);
  const $$=s=>[...document.querySelectorAll(s)];
  const state={dashboard:null,football:null,today:null,feeling:null};

  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){if(response.status===401)location.href='/login?mode=athlete';throw new Error(data.error||'No se pudo completar la operación.');}
    return data;
  }
  function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(window.__rfFootballToast);window.__rfFootballToast=setTimeout(()=>el.classList.remove('show'),1500);}
  function view(name){$$('.view').forEach(v=>v.classList.toggle('active',v.id===`${name}View`));$$('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));window.scrollTo({top:0,behavior:'smooth'});}
  function feelingLabel(value){return({muy_bien:'Genial',bien:'Bien',normal:'Regular',mal:'Mal'})[value]||'Sin registrar';}
  function formatDate(value){try{return new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short'}).format(new Date(value));}catch{return ''}}

  function renderDashboard(){
    const athlete=state.dashboard?.athlete||{};
    const first=String(athlete.display_name||'').trim().split(/\s+/)[0]||'';
    $('hello').textContent=`¡Buenos días${first?`, ${first}`:''}!`;
    const week=athlete.week;
    const todayKey=new Date().toISOString().slice(0,10);
    const workouts=Array.isArray(week?.workouts)?week.workouts:[];
    state.today=workouts.find(w=>String(w.workout_date).slice(0,10)===todayKey)||workouts[0]||null;
    if(state.today){
      $('todayTitle').textContent=state.today.title||'Sesión programada';
      $('todaySummary').textContent=state.today.summary||'Sesión publicada desde RunFlow Coach.';
      $('trainingTitle').textContent=state.today.title||'Sesión';
      $('trainingSummary').textContent=state.today.summary||state.today.structured_description||'Sigue las indicaciones publicadas por tu entrenador.';
      renderBlocks(state.today);
    }else{
      $('todayTitle').textContent='Sin sesión publicada';
      $('todaySummary').textContent='Hoy no hay una sesión programada en RunFlow Coach.';
      $('trainingTitle').textContent='Sin sesión';
      $('trainingSummary').textContent='No hay entrenamiento publicado para hoy.';
      $('trainingBlocks').innerHTML='';
    }
  }

  function renderBlocks(workout){
    const root=$('trainingBlocks');root.innerHTML='';
    let blocks=[];
    if(Array.isArray(workout.blocks))blocks=workout.blocks;
    if(!blocks.length&&workout.structured_description){
      blocks=String(workout.structured_description).split(/\n\n+/).filter(Boolean).map((x,i)=>({name:`Bloque ${i+1}`,text:x}));
    }
    if(!blocks.length){root.innerHTML='<div class="block"><strong>Sesión</strong><span>Consulta el resumen y las indicaciones del entrenador.</span></div>';return;}
    blocks.forEach((block,i)=>{
      const el=document.createElement('div');el.className='block';
      const title=block.name||block.type||`Bloque ${i+1}`;
      const text=block.text||block.target||block.notes||block.summary||[block.repetitions&&`${block.repetitions} rep.`,block.work_value&&`${block.work_value}${block.work_unit||''}`].filter(Boolean).join(' · ');
      el.innerHTML=`<strong>${title}</strong><span>${text||'Trabajo programado'}</span>`;root.appendChild(el);
    });
  }

  function renderFootball(){
    const data=state.football||{};
    const last=data.last_wellbeing;
    $('wellbeingState').textContent=last?`${feelingLabel(last.feeling)} · ${formatDate(last.created_at)}`:'Sin registrar';
    $$('.moods button').forEach(b=>b.classList.toggle('selected',last?.feeling===b.dataset.feeling));
    const w=data.week||{};
    $('weekLoad').textContent=Math.round(Number(w.load||0));
    $('weekRpe').textContent=w.avg_rpe??'—';
    $('weekFootball').textContent=w.football||0;
    $('weekStrength').textContent=w.strength||0;
    $('weekMatches').textContent=w.matches||0;
    $('weekMinutes').textContent=Math.round(Number(w.minutes||0));
    const root=$('recentList');root.innerHTML='';
    const recent=(data.recent||[]).filter(x=>x.kind!=='wellbeing').slice(0,10);
    if(!recent.length){root.innerHTML='<p class="muted">Todavía no hay actividades registradas.</p>';return;}
    recent.forEach(item=>{
      const type=({football_training:'Fútbol',strength:'Fuerza',match:'Partido',challenge:'Reto'})[item.kind]||item.kind;
      const minutes=item.kind==='match'?item.minutes_played:item.duration_min;
      const el=document.createElement('div');el.className='recent';
      el.innerHTML=`<div><strong>${type}${item.title?` · ${item.title}`:''}</strong><span>${formatDate(item.created_at)}${minutes?` · ${minutes} min`:''}${item.rpe?` · RPE ${item.rpe}`:''}</span></div><b>${item.load?`${item.load} AU`:''}</b>`;
      root.appendChild(el);
    });
  }

  async function saveWellbeing(feeling){
    state.feeling=feeling;
    $$('.moods button').forEach(b=>b.classList.toggle('selected',b.dataset.feeling===feeling));
    try{
      await api('/api/athlete/football/wellbeing',{method:'POST',body:JSON.stringify({feeling,energy:Number($('energy').value),soreness:Number($('soreness').value),title:'Bienestar diario'})});
      toast('Bienestar guardado');await refreshFootball();
    }catch(error){toast(error.message);}
  }

  async function saveActivity(){
    const kind=$('activityKind').value;
    const payload={kind,rpe:Number($('activityRpe').value),pain:Number($('activityPain').value||0),note:$('activityNote').value,workout_id:state.today?.id||null,title:state.today?.title||''};
    if(kind==='match')payload.minutes_played=Number($('matchMinutes').value);else payload.duration_min=Number($('activityDuration').value);
    if(!payload.rpe){$('saveStatus').textContent='Introduce el RPE.';return;}
    if(kind==='match'&&!Number.isFinite(payload.minutes_played)){ $('saveStatus').textContent='Introduce los minutos jugados.';return; }
    if(kind!=='match'&&!Number.isFinite(payload.duration_min)){ $('saveStatus').textContent='Introduce la duración.';return; }
    try{
      $('saveActivity').disabled=true;$('saveStatus').textContent='Guardando en RunFlow…';
      const data=await api('/api/athlete/football/activity',{method:'POST',body:JSON.stringify(payload)});
      $('saveStatus').textContent=`Guardado · carga ${data.log.load} AU`;toast('Actividad guardada');
      $('activityDuration').value='';$('matchMinutes').value='';$('activityRpe').value='';$('activityNote').value='';
      await refreshFootball();
    }catch(error){$('saveStatus').textContent=error.message;}finally{$('saveActivity').disabled=false;}
  }

  async function completeChallenge(){
    try{
      await api('/api/athlete/football/challenge',{method:'POST',body:JSON.stringify({challenge_id:'first-touch-20',title:$('challengeTitle').textContent,challenge_result:'completado'})});
      $('completeChallenge').textContent='Conseguido ✓';toast('Reto guardado');await refreshFootball();
    }catch(error){toast(error.message);}
  }

  async function refreshFootball(){state.football=await api('/api/athlete/football/summary');renderFootball();}

  async function init(){
    try{
      const me=await api('/api/auth/me');
      if(!Array.isArray(me?.user?.roles)||!me.user.roles.includes('athlete'))return location.replace('/login?mode=athlete');
      const [dashboard,football]=await Promise.all([api('/api/athlete/dashboard'),api('/api/athlete/football/summary')]);
      state.dashboard=dashboard;state.football=football;renderDashboard();renderFootball();
    }catch(error){console.error('[RunFlow Football]',error);toast(error.message);}
  }

  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
  $$('.moods button').forEach(b=>b.addEventListener('click',()=>saveWellbeing(b.dataset.feeling)));
  $('activityKind').addEventListener('change',()=>{const match=$('activityKind').value==='match';$('durationField').classList.toggle('hidden',match);$('minutesField').classList.toggle('hidden',!match);});
  $('saveActivity').addEventListener('click',saveActivity);
  $('completeChallenge').addEventListener('click',completeChallenge);
  $('openToday').addEventListener('click',()=>view('training'));
  $('videoPlaceholder').addEventListener('click',()=>toast('Aquí conectaremos el vídeo explicativo de la sesión.'));
  $('logout').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});}catch{}location.href='/login?mode=athlete';});
  init();
})();
