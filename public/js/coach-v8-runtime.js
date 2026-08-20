(() => {
  const q = (s, r=document) => r.querySelector(s);
  const qa = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api = async (url, options={}) => {
    const response = await fetch(url, { credentials:'same-origin', ...options, headers:{'Content-Type':'application/json',...(options.headers||{})} });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
    return data;
  };
  const isoMonday = (date=new Date()) => { const d=new Date(date); const day=d.getDay()||7; d.setHours(12,0,0,0); d.setDate(d.getDate()-day+1); return d.toISOString().slice(0,10); };
  const addDays = (iso, days) => { const d=new Date(`${iso}T12:00:00`); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); };
  const dateLabel = iso => iso ? new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short'}).format(new Date(`${String(iso).slice(0,10)}T12:00:00`)) : '—';
  const shortWeek = iso => `${dateLabel(iso)}–${dateLabel(addDays(iso,6))}`;
  const pace = sec => { const n=Number(sec); if(!Number.isFinite(n)||n<=0)return '—'; const r=Math.round(n); return `${Math.floor(r/60)}:${String(r%60).padStart(2,'0')}/km`; };
  const num = (v, digits=0) => Number.isFinite(Number(v)) ? Number(v).toFixed(digits).replace('.',',') : '—';
  const initials = name => String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  const currentAthleteId = () => q('#athleteSelect')?.value || null;
  const currentAthleteName = () => q('#athleteSelect')?.selectedOptions?.[0]?.textContent?.trim() || 'Atleta';
  const manualValidationKey = (athleteId, workout) => `rf_v8_manual_validation:${athleteId}:${workout.id}:${workout.manual_log?.created_at||''}`;

  function correctedManualLoad(workout){
    const log=workout?.manual_log;
    if(!log || !['completed','partial'].includes(log.status) || (workout.activities||[]).length) return 0;
    const planned=Number(workout.planned_load||0);
    const plannedMin=Number(workout.planned_duration_min||0);
    const actualMin=Number(log.actual_duration_min||0);
    if(actualMin>0 && plannedMin>0) return Math.max(0, planned*(actualMin/plannedMin));
    if(log.status==='completed') return Math.max(0,planned);
    return 0;
  }
  function correctedWeekLoad(week){
    const activityLoad=Number(week?.execution?.load||0);
    const manual=(week?.workouts||[]).reduce((sum,w)=>sum+correctedManualLoad(w),0);
    return { total:activityLoad+manual, manual, activities:activityLoad };
  }

  function replaceSidebar(){
    const sidebar=q('.v8-sidebar'); if(!sidebar)return;
    sidebar.innerHTML=`
      <div class="v8-brand"><div class="v8-brand-mark">RF</div><div><strong>runflow</strong><small>COACH · V8.4</small></div></div>
      <div class="v8-team"><div class="v8-avatar">RF</div><div><b>Equipo RunFlow</b><span id="v8AthleteCount">Cargando atletas…</span></div></div>
      <div class="v8-nav-title">General</div>
      <nav class="v8-nav" id="v8GeneralNav">
        <button data-v8="summary" class="active"><span class="ico">▦</span><span>Resumen</span></button>
        <button data-v8="athletes"><span class="ico">♙</span><span>Atletas</span></button>
        <button data-v8="library"><span class="ico">▥</span><span>Biblioteca</span></button>
        <button data-v8="globalMessages"><span class="ico">☵</span><span>Mensajes</span><span id="v8GlobalMessageCount" class="count"></span></button>
      </nav>
      <div class="v8-selected-athlete"><small>Atleta seleccionado</small><select id="v8AthleteSelect"></select></div>
      <div class="v8-nav-title" id="v8AthleteTitle">Atleta</div>
      <nav class="v8-nav" id="v8AthleteNav">
        <button data-v8="plan"><span class="ico">▤</span><span>Planificación</span></button>
        <button data-v8="performance"><span class="ico">⌁</span><span>Análisis</span></button>
        <button data-v8="week"><span class="ico">□</span><span>Calendario</span></button>
        <button data-v8="activities"><span class="ico">↗</span><span>Actividades</span></button>
        <button data-v8="messages"><span class="ico">☵</span><span>Mensajes</span><span id="v8AthleteMessageCount" class="count"></span></button>
        <button data-v8="recovery"><span class="ico">♡</span><span>Recuperación</span></button>
      </nav>
      <div class="v8-nav-title" style="margin-top:18px">Previsualización</div>
      <nav class="v8-nav"><button id="v8AthleteApp" type="button"><span class="ico">▯</span><span>App del atleta</span></button></nav>
      <div class="v8-sidebar-foot"><div class="v8-sync"><i></i><div><b style="color:#fff">Intervals.icu</b><br>Datos compartidos con Coach</div></div></div>`;
    syncAthleteSelector();
    qa('[data-v8]',sidebar).forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.v8,button)));
    q('#v8AthleteApp',sidebar)?.addEventListener('click',()=>window.open('/athlete','_blank'));
    q('#v8AthleteSelect',sidebar)?.addEventListener('change', event=>{
      const original=q('#athleteSelect'); if(!original)return;
      original.value=event.target.value; original.dispatchEvent(new Event('change',{bubbles:true}));
      setTimeout(()=>{syncAthleteSelector(); renderAnalysis().catch(()=>{}); patchCalendarLoad().catch(()=>{});},500);
    });
  }

  function syncAthleteSelector(){
    const original=q('#athleteSelect'), target=q('#v8AthleteSelect'); if(!original||!target)return;
    const selected=original.value;
    target.innerHTML=[...original.options].map(o=>`<option value="${esc(o.value)}" ${o.value===selected?'selected':''}>${esc(o.textContent)}</option>`).join('');
    q('#v8AthleteTitle').textContent=currentAthleteName();
    q('#v8AthleteCount').textContent=`${original.options.length} atleta${original.options.length===1?'':'s'}`;
    const unread=q('#coachMessagesTabUnread');
    q('#v8AthleteMessageCount').textContent=unread && !unread.classList.contains('hidden') && unread.textContent!=='0' ? unread.textContent : '';
  }

  function setSidebarActive(button){ qa('.v8-nav button').forEach(b=>b.classList.toggle('active',b===button)); }
  function showSynthetic(id){
    qa('main.shell .view').forEach(v=>v.classList.remove('active'));
    q(`#${id}`)?.classList.add('active');
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function navigate(target, button){
    setSidebarActive(button);
    if(target==='globalMessages'){ showSynthetic('v8GlobalMessagesView'); renderGlobalMessages().catch(showRuntimeError); return; }
    const original=q(`main.shell>.tabs [data-view="${target}"]`);
    if(original) original.click();
    setTimeout(()=>{
      if(target==='summary') renderTeamDashboard().catch(showRuntimeError);
      if(target==='performance') renderAnalysis().catch(showRuntimeError);
      if(target==='week') patchCalendarLoad().catch(()=>{});
      if(target==='plan') installGuidedPlannerButton();
      syncAthleteSelector();
    },180);
  }

  function createSyntheticViews(){
    const main=q('main.shell'); if(!main)return;
    if(!q('#v8GlobalMessagesView')){
      const section=document.createElement('section'); section.id='v8GlobalMessagesView'; section.className='view'; section.style.marginTop='18px';
      section.innerHTML='<div class="v8-team-card"><div class="v8-team-card-head"><div><div class="v8-team-kicker">Equipo</div><h3>Mensajes</h3><p class="muted">Conversaciones de todos los atletas.</p></div></div><div class="v8-team-card-body" id="v8GlobalMessagesBody"><div class="v8-empty">Cargando mensajes…</div></div></div>';
      main.appendChild(section);
    }
  }

  async function athleteCalendars(weeksBack=6){
    const athletesData=await api('/api/coach/athletes?include_inactive=0&details=1');
    const athletes=athletesData.athletes||[];
    const current=isoMonday(); const oldest=addDays(current,-7*(weeksBack-1)), newest=addDays(current,6);
    const results=await Promise.all(athletes.map(async athlete=>{
      try{ const data=await api(`/api/coach/athletes/${encodeURIComponent(athlete.id)}/calendar?oldest=${oldest}&newest=${newest}`); return {athlete,weeks:data.weeks||[]}; }
      catch(error){ return {athlete,weeks:[],error:error.message}; }
    }));
    return {athletes,results,current,oldest,newest};
  }

  async function pendingForResult(result, lookbackDays=21){
    const minDate=addDays(new Date().toISOString().slice(0,10),-lookbackDays);
    const candidates=[];
    for(const week of result.weeks||[]){
      for(const workout of week.workouts||[]){
        if(String(workout.workout_date||'')<minDate) continue;
        if(!['completed','partial'].includes(workout.execution_status)) continue;
        const activities=workout.activities||[];
        if(activities.length){
          for(const activity of activities){ candidates.push({type:'intervals',athlete:result.athlete,workout,activity,date:String(activity.activity_date||workout.workout_date).slice(0,10)}); }
        }else if(workout.manual_log){
          if(localStorage.getItem(manualValidationKey(result.athlete.id,workout))!=='1') candidates.push({type:'manual',athlete:result.athlete,workout,date:workout.workout_date});
        }
      }
    }
    const recent=candidates.sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,50);
    const checked=[];
    for(const item of recent){
      if(item.type==='manual'){checked.push(item);continue;}
      try{
        const detail=await api(`/api/coach/athletes/${encodeURIComponent(item.athlete.id)}/activities/${encodeURIComponent(item.activity.intervals_activity_id)}`);
        if(!detail.review?.decision) checked.push({...item,review:detail.review||null});
      }catch{checked.push(item);}
    }
    return checked;
  }

  function teamChartSvg(values){
    const max=Math.max(1,...values); const w=650,h=150,p=15;
    const pts=values.map((v,i)=>`${p+(i/Math.max(1,values.length-1))*(w-2*p)},${h-p-(v/max)*(h-2*p)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#a9df58" stroke-width="4"/></svg>`;
  }

  async function renderTeamDashboard(){
    const summary=q('#summaryView'); if(!summary)return;
    let dashboard=q('#v8TeamDashboard');
    if(!dashboard){ dashboard=document.createElement('div'); dashboard.id='v8TeamDashboard'; summary.prepend(dashboard); const legacy=[...summary.children].find(x=>x!==dashboard); if(legacy) legacy.style.display='none'; }
    dashboard.innerHTML='<div class="v8-empty">Cargando visión del equipo…</div>';
    const {athletes,results,current}=await athleteCalendars(6);
    const currentWeeks=results.map(r=>({r,week:(r.weeks||[]).find(w=>w.week_start===current)})).filter(x=>x.week);
    const planned=currentWeeks.reduce((s,x)=>s+(x.week.workouts||[]).length,0);
    const completed=currentWeeks.reduce((s,x)=>s+Number(x.week.execution?.completed_sessions||0),0);
    const compliance=planned?Math.round((completed/planned)*100):0;
    const pendingLists=await Promise.all(results.map(r=>pendingForResult(r,21)));
    const pending=pendingLists.flat().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const weekStarts=Array.from({length:6},(_,i)=>addDays(current,-7*(5-i)));
    const weeklyLoads=weekStarts.map(ws=>results.reduce((sum,r)=>{const w=(r.weeks||[]).find(x=>x.week_start===ws);return sum+(w?correctedWeekLoad(w).total:0)},0));
    const recent=[];
    for(const r of results){ for(const w of r.weeks||[]){ for(const workout of w.workouts||[]){ if(['completed','partial'].includes(workout.execution_status)) recent.push({athlete:r.athlete,workout,date:workout.workout_date}); } } }
    recent.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    dashboard.innerHTML=`
      <section class="v8-team-hero"><div class="v8-team-hero-copy"><span class="v8-team-chip"><i></i> SEMANA EN CURSO</span><h2>Tu equipo está<br>entrenando.</h2><p>Hay <strong class="accent">${pending.length} sesión${pending.length===1?'':'es'} pendiente${pending.length===1?'':'s'} de validar</strong>. El cumplimiento de las sesiones planificadas esta semana es del <strong class="accent">${compliance}%</strong>.</p><div class="v8-team-hero-actions"><button class="btn soft" id="v8ScrollValidation">Revisar sesiones →</button><button class="btn secondary" id="v8RefreshDashboard">↻ Actualizar</button></div></div><div class="v8-team-ring-wrap"><div><div class="v8-team-ring" style="--v8-team-compliance:${Math.min(100,compliance)}%"><div><strong>${compliance}%</strong><small>cumplimiento</small></div></div><div style="font-size:10px;text-align:center;margin-top:7px">${completed} / ${planned} sesiones</div></div></div><div class="v8-team-runner"><span>🏃</span></div></section>
      <div class="v8-team-grid"><section class="v8-team-card"><div class="v8-team-card-head"><div><div class="v8-team-kicker">Carga del equipo</div><h3>Últimas 6 semanas</h3></div><span class="badge">${athletes.length} atletas</span></div><div class="v8-team-card-body"><strong style="font-size:30px">${Math.round(weeklyLoads.at(-1)||0)}</strong><span class="muted" style="font-size:10px"> carga real acumulada esta semana</span><div class="v8-team-load-chart">${teamChartSvg(weeklyLoads)}</div></div></section><section class="v8-team-card"><div class="v8-team-card-head"><div><div class="v8-team-kicker">Atención necesaria</div><h3>Revisar hoy</h3></div></div><div class="v8-team-card-body v8-attention-list">${pending.slice(0,5).map(item=>`<div class="v8-attention-item"><div class="v8-attention-avatar">${esc(initials(item.athlete.display_name))}</div><div><b>${esc(item.athlete.display_name)}</b><small>${esc(item.workout.title||'Sesión')} · ${item.type==='manual'?'RunFlow manual':'Intervals'}</small></div><span class="v8-priority">PENDIENTE</span></div>`).join('')||'<div class="v8-empty">No hay sesiones pendientes.</div>'}</div></section></div>
      <div class="v8-dashboard-two"><section class="v8-team-card"><div class="v8-team-card-head"><div><div class="v8-team-kicker">Programación</div><h3>Sesiones de hoy</h3></div></div><div class="v8-team-card-body v8-live-list">${results.flatMap(r=>(r.weeks||[]).flatMap(w=>(w.workouts||[]).filter(x=>x.workout_date===new Date().toISOString().slice(0,10)).map(workout=>({athlete:r.athlete,workout})))).slice(0,8).map(x=>`<div class="v8-live-item"><div class="v8-attention-avatar">${esc(initials(x.athlete.display_name))}</div><div><b>${esc(x.athlete.display_name)} · ${esc(x.workout.title||'Sesión')}</b><small>${esc(x.workout.sport||'')} · carga ${Math.round(Number(x.workout.planned_load||0))}</small></div><span class="badge pending">${x.workout.execution_status==='completed'?'Hecha':'Plan'}</span></div>`).join('')||'<div class="v8-empty">Sin sesiones hoy.</div>'}</div></section><section class="v8-team-card"><div class="v8-team-card-head"><div><div class="v8-team-kicker">En directo</div><h3>Actividad reciente</h3></div></div><div class="v8-team-card-body v8-live-list">${recent.slice(0,8).map(x=>`<div class="v8-live-item"><div class="v8-attention-avatar">${esc(initials(x.athlete.display_name))}</div><div><b>${esc(x.athlete.display_name)} · ${esc(x.workout.title||'Sesión')}</b><small>${dateLabel(x.date)}${x.workout.manual_log?.rpe?` · RPE ${x.workout.manual_log.rpe}`:''}</small></div><span>${x.workout.execution_status==='partial'?'Parcial':'✓'}</span></div>`).join('')||'<div class="v8-empty">Todavía no hay actividad reciente.</div>'}</div></section></div>
      <section class="v8-team-card" id="v8ValidationQueue"><div class="v8-team-card-head"><div><div class="v8-team-kicker">Control del entrenador</div><h3>Sesiones pendientes de validar</h3><p class="muted" style="font-size:11px;margin:3px 0 0">Una sesión realizada cuenta para la carga, pero permanece aquí hasta que el entrenador la revisa.</p></div><span class="badge pending">${pending.length} pendientes</span></div><div class="v8-team-card-body"><div class="v8-validation-list">${pending.map(validationRow).join('')||'<div class="v8-empty">✓ Todas las sesiones recientes están revisadas.</div>'}</div></div></section>`;
    q('#v8ScrollValidation')?.addEventListener('click',()=>q('#v8ValidationQueue')?.scrollIntoView({behavior:'smooth'}));
    q('#v8RefreshDashboard')?.addEventListener('click',()=>renderTeamDashboard().catch(showRuntimeError));
    qa('[data-v8-validate]').forEach(b=>b.addEventListener('click',()=>validateItem(b,pending).catch(showRuntimeError)));
  }

  function validationRow(item,index){
    const w=item.workout, log=w.manual_log||{}; const actual=item.type==='manual'?correctedManualLoad(w):Number(item.activity?.load||w.actual?.load||0);
    return `<article class="v8-validation-row ${item.type}" data-vrow="${index}"><div class="v8-validation-avatar">${esc(initials(item.athlete.display_name))}</div><div class="v8-validation-main"><b>${esc(item.athlete.display_name)} · ${esc(w.title||'Sesión')}</b><span>${dateLabel(item.date)} · ${item.type==='manual'?`${Number(log.actual_duration_min||0)} min realizados`:esc(item.activity?.name||'Actividad')}</span><span class="v8-source-pill ${item.type==='intervals'?'intervals':''}">${item.type==='manual'?'RunFlow manual':'Intervals.icu'}</span></div><div class="v8-validation-stat"><span>Carga real</span><b>${Math.round(actual||0)}</b></div><div class="v8-validation-stat"><span>Feedback</span><b>${log.rpe?`RPE ${log.rpe}`:'—'}${log.feeling?` · ${esc(log.feeling.replace('_',' '))}`:''}</b></div><div class="v8-validation-actions"><button class="btn soft small" data-v8-validate="${index}">✓ Validar</button><button class="btn secondary small" data-v8-open-athlete="${esc(item.athlete.id)}">Revisar</button></div></article>`;
  }

  async function validateItem(button,pending){
    const index=Number(button.dataset.v8Validate), item=pending[index]; if(!item)return;
    button.disabled=true; button.textContent='Guardando…';
    if(item.type==='intervals'){
      await api(`/api/coach/athletes/${encodeURIComponent(item.athlete.id)}/activities/${encodeURIComponent(item.activity.intervals_activity_id)}/review`,{method:'PUT',body:JSON.stringify({decision:'validated',coach_comment:'Validada desde el Resumen V8.'})});
    }else{
      /* manual_session_logs no tiene todavía una columna de revisión del coach. Guardamos la validación en este navegador sin alterar el comentario del atleta. */
      localStorage.setItem(manualValidationKey(item.athlete.id,item.workout),'1');
    }
    await renderTeamDashboard();
  }

  async function renderGlobalMessages(){
    const body=q('#v8GlobalMessagesBody'); if(!body)return; body.innerHTML='<div class="v8-empty">Cargando conversaciones…</div>';
    const data=await api('/api/coach/athletes?include_inactive=0&details=1'); const athletes=data.athletes||[];
    const rows=await Promise.all(athletes.map(async athlete=>{try{const r=await api(`/api/coach/athletes/${encodeURIComponent(athlete.id)}/messages?limit=1&mark_read=0`);return {athlete,message:(r.messages||[]).at(-1)||null,unread:Number(r.unread||0)}}catch{return {athlete,message:null,unread:0}}}));
    const total=rows.reduce((s,r)=>s+r.unread,0); q('#v8GlobalMessageCount').textContent=total||'';
    body.innerHTML=rows.sort((a,b)=>String(b.message?.created_at||'').localeCompare(String(a.message?.created_at||''))).map(r=>`<button class="v8-live-item" style="width:100%;border:1px solid #e4e7e1;text-align:left" data-message-athlete="${esc(r.athlete.id)}"><div class="v8-attention-avatar">${esc(initials(r.athlete.display_name))}</div><div><b>${esc(r.athlete.display_name)}</b><small>${esc(r.message?.message||'Sin mensajes todavía')}</small></div><span class="${r.unread?'badge':'muted'}">${r.unread?`${r.unread} nuevo${r.unread===1?'':'s'}`:dateLabel(r.message?.created_at)}</span></button>`).join('')||'<div class="v8-empty">No hay conversaciones.</div>';
    qa('[data-message-athlete]',body).forEach(btn=>btn.addEventListener('click',()=>{selectAthlete(btn.dataset.messageAthlete); setTimeout(()=>navigate('messages',q('[data-v8="messages"]')),350);}));
  }

  function selectAthlete(id){ const original=q('#athleteSelect'); if(!original)return; original.value=id; original.dispatchEvent(new Event('change',{bubbles:true})); setTimeout(syncAthleteSelector,250); }

  async function fourWeekCalendar(athleteId){
    const current=isoMonday(); const oldest=addDays(current,-21), newest=addDays(current,6);
    const data=await api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/calendar?oldest=${oldest}&newest=${newest}`);
    return Array.from({length:4},(_,i)=>{const ws=addDays(current,-7*(3-i));const week=(data.weeks||[]).find(w=>w.week_start===ws)||{week_start:ws,workouts:[],execution:{}}; const plan=(week.workouts||[]).reduce((s,w)=>s+Number(w.planned_load||0),0); const real=correctedWeekLoad(week); return {week,ws,plan,real:real.total,manual:real.manual};});
  }

  async function activityElevationTrend(athleteId){
    const newest=new Date().toISOString().slice(0,10), oldest=addDays(newest,-55);
    try{
      const data=await api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/activities?oldest=${oldest}&newest=${newest}&sync=0`); const acts=data.activities||[];
      const midpoint=addDays(newest,-27); const prev=acts.filter(a=>String(a.activity_date).slice(0,10)<midpoint), recent=acts.filter(a=>String(a.activity_date).slice(0,10)>=midpoint);
      const recentMax=Math.max(0,...recent.map(a=>Number(a.elevation_gain_m||0))); const prevMax=Math.max(0,...prev.map(a=>Number(a.elevation_gain_m||0)));
      return {value:recentMax||null,change:recentMax&&prevMax?((recentMax-prevMax)/prevMax)*100:null};
    }catch{return {value:null,change:null};}
  }

  function trendClass(value, inverse=false){const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)<.2)return 'flat';const good=inverse?n<0:n>0;return good?'up':'down'}
  function trendText(value,{suffix='%',inverse=false,absolute=false}={}){const n=Number(value);if(!Number.isFinite(n))return 'Sin tendencia consolidada';const good=inverse?n<0:n>0;const arrow=good?'↗':n===0?'→':'↘';return `${arrow} ${n>0?'+':''}${absolute?Math.abs(n).toFixed(1):n.toFixed(1)}${suffix}`}
  function spark(values){const clean=(values||[]).map(Number).filter(Number.isFinite);if(clean.length<2)return '<div class="v8-spark"></div>';const min=Math.min(...clean),max=Math.max(...clean),range=max-min||1;const pts=clean.map((v,i)=>`${(i/(clean.length-1))*220},${38-((v-min)/range)*28}`).join(' ');return `<div class="v8-spark"><svg viewBox="0 0 220 44" preserveAspectRatio="none"><line x1="0" y1="38" x2="220" y2="38"/><polyline points="${pts}"/></svg></div>`}
  function perfCard(label,value,sub,trend,trendValue,values,inverse=false){return `<article class="v8-perf-card"><span class="v8-perf-label">${esc(label)}</span><strong class="v8-perf-value">${esc(value)}</strong><span class="v8-perf-sub">${esc(sub)}</span><span class="v8-perf-trend ${trendClass(trendValue,inverse)}">${esc(trend)}</span>${spark(values)}</article>`}

  async function renderAnalysis(){
    const view=q('#performanceView'), athleteId=currentAthleteId(); if(!view||!athleteId)return;
    let panel=q('#v8AnalysisPanel'); if(!panel){panel=document.createElement('div');panel.id='v8AnalysisPanel';view.prepend(panel);} panel.innerHTML='<div class="v8-empty">Cargando análisis completo…</div>';
    const [bundle,weeks,elevation]=await Promise.all([
      api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/performance?days=84`), fourWeekCalendar(athleteId), activityElevationTrend(athleteId)
    ]);
    const latest=bundle.latest||{}, summary=bundle.activity_summary||{}, hist=bundle.history||[], metrics=bundle.activity_metrics||[], profile=bundle.intervals_run_profile||summary.intervals_run_profile||{};
    const maxLoad=Math.max(1,...weeks.flatMap(w=>[w.plan,w.real]));
    const bars=weeks.map(w=>{const pct=w.plan?Math.round((w.real/w.plan)*100):null;const cls=pct===null?'ok':pct<90?'low':pct>110?'high':'ok';return `<div class="v8-load-week"><div class="v8-load-bars"><div class="v8-load-bar plan" style="height:${Math.max(5,(w.plan/maxLoad)*150)}px"><span>${Math.round(w.plan)}</span></div><div class="v8-load-bar real" style="height:${Math.max(5,(w.real/maxLoad)*150)}px"><span>${Math.round(w.real)}</span></div></div><div class="v8-load-week-label">${shortWeek(w.ws)}</div><span class="v8-compliance ${cls}">${pct===null?'Sin plan':`${pct}% · ${cls==='low'?'De menos':cls==='high'?'De más':'Cumple'}`}${w.manual?` · +${Math.round(w.manual)} manual`:''}</span></div>`}).join('');
    const threshold=summary.threshold_pace_sec_per_km; const thresholdChange=Number(summary.threshold_pace_change_8w_sec);
    const z2=summary.z2_pace_sec_per_km, z2Change=Number(summary.z2_pace_change_pct);
    const vam=summary.uphill_threshold_vam, vamChange=Number(summary.uphill_vam_change_pct);
    const aero=summary.aerobic_efficiency, aeroChange=Number(summary.aerobic_efficiency_change_pct);
    const trailEff=summary.trail_gap_efficiency, trailEffChange=Number(summary.trail_gap_efficiency_change_pct);
    const vo2=[profile.vo2max,profile.vo2_max,profile.vo2max_estimate,profile.vo2_max_estimate].map(Number).find(Number.isFinite);
    const vo2Trend=Number(profile.vo2max_change_pct ?? profile.vo2_max_change_pct);
    const durability=Number(summary.trail_durability_pct ?? summary.durability_trail_pct ?? profile.trail_durability_pct);
    const durabilityChange=Number(summary.trail_durability_change_pct ?? summary.durability_trail_change_pct);
    const thresholdSeries=metrics.map(m=>m.threshold_pace_sec_per_km).filter(Boolean).slice(-8).map(v=>-Number(v));
    const z2Series=metrics.map(m=>m.z2_pace_sec_per_km).filter(Boolean).slice(-8).map(v=>-Number(v));
    const vamSeries=metrics.map(m=>m.uphill_threshold_vam).filter(Boolean).slice(-8);
    const aeroSeries=metrics.map(m=>m.aerobic_efficiency).filter(Boolean).slice(-8);
    const trailSeries=metrics.map(m=>m.trail_gap_efficiency).filter(Boolean).slice(-8);
    const feelingLatest=Number(latest.subjective_feeling_7d ?? latest.feeling_7d ?? NaN);
    const baselineFeeling=Number(latest.subjective_feeling_baseline ?? latest.feeling_baseline ?? NaN);
    panel.innerHTML=`
      <div class="v8-analysis-head"><div><div class="v8-team-kicker">Análisis del atleta</div><h2>${esc(currentAthleteName())}</h2><p>Carga, recuperación, cumplimiento y rendimiento específico en una única lectura.</p></div><button class="btn soft" id="v8RefreshAnalysis">↻ Actualizar métricas</button></div>
      <div class="v8-analysis-kpis"><div class="v8-analysis-kpi"><span>Aptitud</span><strong>${latest.raw_fitness??latest.fitness_index??'—'}</strong><small>${esc(latest.fitness_trend||'')}</small></div><div class="v8-analysis-kpi"><span>Fatiga</span><strong>${latest.raw_fatigue??'—'}</strong><small>Carga aguda</small></div><div class="v8-analysis-kpi"><span>Forma</span><strong>${latest.raw_form??'—'}</strong><small>Balance de carga</small></div><div class="v8-analysis-kpi"><span>Readiness</span><strong>${latest.readiness_score??'—'}</strong><small>${esc(latest.readiness_label||'')}</small></div></div>
      <section class="v8-analysis-section"><div class="v8-analysis-section-head"><div><div class="v8-team-kicker">Cumplimiento de carga</div><h3>Planificada vs. real · últimas 4 semanas</h3><p>Incluye la carga de Intervals y la carga estimada de sesiones marcadas como realizadas en RunFlow cuando no existe actividad equivalente.</p></div><div class="v8-intensity-legend"><span><i style="background:#d7ddd6"></i>Planificada</span><span><i style="background:#202720"></i>Real</span></div></div><div class="v8-load4-grid">${bars}</div></section>
      <section class="v8-analysis-section"><div class="v8-analysis-section-head"><div><div class="v8-team-kicker">Rendimiento específico</div><h3>Marcadores validados y evolución</h3><p>El objetivo principal decide cuáles se destacan primero; los marcadores validados no se eliminan.</p></div><span class="badge">Histórico comparable</span></div><div class="v8-performance-grid">
        ${perfCard('Zona umbral · ritmo',pace(threshold),'Referencia LT2',Number.isFinite(thresholdChange)?`${thresholdChange>=0?'↗':'↘'} ${Math.abs(thresholdChange).toFixed(0)} s/km en 8 semanas`:'Sin tendencia consolidada',thresholdChange,thresholdSeries)}
        ${perfCard('Z2 · ritmo eficiente',pace(z2),'Ritmo comparable en zona aeróbica',Number.isFinite(z2Change)?trendText(z2Change):'Sin tendencia consolidada',z2Change,z2Series)}
        ${perfCard('VO₂max · referencia',Number.isFinite(vo2)?num(vo2,1):'—',Number.isFinite(vo2)?'Referencia disponible del perfil':'Sin dato consolidado; se mantiene el marcador',Number.isFinite(vo2Trend)?trendText(vo2Trend):'Pendiente de histórico comparable',vo2Trend,[])}
        ${perfCard('Durabilidad trail',Number.isFinite(durability)?`${num(durability,0)}%`:'—','Capacidad de mantener rendimiento al final de esfuerzos largos',Number.isFinite(durabilityChange)?trendText(durabilityChange,{suffix:' pp'}):'Pendiente de cálculo consolidado',durabilityChange,[])}
        ${perfCard('Desnivel + · evolución',elevation.value?`${Math.round(elevation.value)} m+`:'—','Máximo desnivel realizado en sesión durante las últimas 4 semanas',Number.isFinite(elevation.change)?trendText(elevation.change):'Sin comparación suficiente',elevation.change,[])}
        ${perfCard('VAM subida',vam?`${Math.round(vam)} m+/h`:'—','Referencia sostenida en ascenso',Number.isFinite(vamChange)?trendText(vamChange):'Sin tendencia consolidada',vamChange,vamSeries)}
        ${perfCard('Eficiencia aeróbica',aero?num(aero,2):'—','Velocidad relativa al coste cardiovascular',Number.isFinite(aeroChange)?trendText(aeroChange):'Sin tendencia consolidada',aeroChange,aeroSeries)}
        ${perfCard('Eficiencia trail',trailEff?num(trailEff,2):'—','GAP / FC en sesiones con desnivel',Number.isFinite(trailEffChange)?trendText(trailEffChange):'Sin tendencia consolidada',trailEffChange,trailSeries)}
        ${perfCard('Sensación subjetiva',Number.isFinite(feelingLatest)?`${num(feelingLatest,2)} / 5`:'—',Number.isFinite(baselineFeeling)?`Media histórica ${num(baselineFeeling,2)}`:'Media móvil 7d / baseline individual','La escala 1–5 se mostrará al consolidar el histórico diario',Number.isFinite(feelingLatest)&&Number.isFinite(baselineFeeling)?feelingLatest-baselineFeeling:NaN,[])}
      </div><div class="v8-analysis-note" style="margin-top:11px"><strong>Criterio RunFlow:</strong> cuando todavía no existe un cálculo consolidado para un marcador validado, la tarjeta permanece visible con “—”. No se sustituye por una estimación inventada.</div></section>`;
    q('#v8RefreshAnalysis')?.addEventListener('click',async()=>{await api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/performance?days=84&refresh=1`);renderAnalysis().catch(showRuntimeError);});
  }

  async function patchCalendarLoad(){
    const athleteId=currentAthleteId(), weekStart=q('#weekStart')?.value; if(!athleteId||!weekStart||!q('#actualWeekLoad'))return;
    try{const data=await api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/calendar?oldest=${weekStart}&newest=${addDays(weekStart,6)}`);const week=(data.weeks||[]).find(w=>w.week_start===weekStart);if(!week)return;const corrected=correctedWeekLoad(week);q('#actualWeekLoad').textContent=Math.round(corrected.total);const extra=q('#extraWeekLoad');if(extra&&corrected.manual>0)extra.textContent=`+${Math.round(corrected.manual)} RunFlow manual${Number(week.execution?.extra_load||0)>0?` · +${Math.round(Number(week.execution.extra_load))} extra`:''}`;}catch{}
  }

  function installGuidedPlannerButton(){
    const actions=q('#planView .plan-season-actions')||q('#planView .plan-command .actions'); if(!actions||q('#v8GuidedPlannerButton'))return;
    const button=document.createElement('button');button.id='v8GuidedPlannerButton';button.type='button';button.className='btn soft';button.textContent='🧭 Planificador guiado';actions.appendChild(button);button.addEventListener('click',()=>window.RunFlowV8Planner?.open());
  }

  function addAthleteManagementShortcuts(){
    const view=q('#athletesView'); if(!view||q('#v8AthleteConfigNote'))return;
    const note=document.createElement('section');note.id='v8AthleteConfigNote';note.className='notice';note.innerHTML='<strong>Configuración por atleta.</strong> Objetivos, ficha, zonas y conexiones se mantienen en RunFlow, pero salen de la navegación diaria. Selecciona un atleta y usa estos accesos cuando necesites configurarlo.<div class="v8-config-shortcuts"><button class="btn secondary small" data-config-view="profile">Ficha y zonas</button><button class="btn secondary small" data-config-view="goals">Objetivos</button><button class="btn secondary small" data-config-view="connections">Conexiones / acceso app</button></div>';view.querySelector('.stack')?.prepend(note);qa('[data-config-view]',note).forEach(b=>b.addEventListener('click',()=>q(`main.shell>.tabs [data-view="${b.dataset.configView}"]`)?.click()));
  }

  function showRuntimeError(error){console.error('[V8]',error);}

  function installObservers(){
    q('#athleteSelect')?.addEventListener('change',()=>setTimeout(()=>{syncAthleteSelector(); if(q('#performanceView.active'))renderAnalysis().catch(()=>{}); if(q('#summaryView.active'))renderTeamDashboard().catch(()=>{});},400));
    q('#weekStart')?.addEventListener('change',()=>setTimeout(()=>patchCalendarLoad(),100));
    const main=q('main.shell'); if(main)new MutationObserver(()=>{syncAthleteSelector();installGuidedPlannerButton();addAthleteManagementShortcuts();if(q('#weekView.active'))patchCalendarLoad().catch(()=>{});}).observe(main,{subtree:true,childList:true});
  }

  async function boot(){
    let attempts=0;
    const timer=setInterval(async()=>{
      attempts++;
      if(q('.v8-sidebar') && q('#athleteSelect') && q('main.shell>.tabs')){
        clearInterval(timer);replaceSidebar();createSyntheticViews();installGuidedPlannerButton();addAthleteManagementShortcuts();installObservers();
        renderTeamDashboard().catch(showRuntimeError);
      }else if(attempts>80) clearInterval(timer);
    },100);
  }
  boot();
})();