(() => {
  const intensityClass = text => {
    const t = String(text || '').toLowerCase();
    if (/fuerza|strength|core|gimnas|estabilidad|cadena posterior/.test(t)) return 'v8-strength';
    if (/vo2|vo₂|z5|velocidad aeróbica|repeticiones rápidas/.test(t)) return 'v8-vo2';
    if (/umbral|lt2|threshold|z4/.test(t)) return 'v8-threshold';
    if (/sweet|z3 alta|maratón|ritmo específico/.test(t)) return 'v8-sweet';
    if (/tempo|z3|economía|400 m|400m/.test(t)) return 'v8-tempo';
    if (/z2|endurance|aeróbic|rodaje|tirada|trail|suave|regenerativo/.test(t)) return 'v8-z2';
    return '';
  };

  const esc = value => String(value ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const addDays = (iso, days) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return d.toISOString().slice(0,10); };
  const dayNum = iso => new Intl.DateTimeFormat('es-ES',{day:'numeric'}).format(new Date(`${iso}T12:00:00`));
  const dayNames = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const todayIso = () => new Date().toISOString().slice(0,10);

  function buildSidebar(){
    const sidebar = document.createElement('aside');
    sidebar.className = 'v8-sidebar';
    sidebar.innerHTML = `
      <div class="v8-brand"><div class="v8-brand-mark">RF</div><div><strong>runflow</strong><small>COACH · V8</small></div></div>
      <div class="v8-team"><div class="v8-avatar">RF</div><div><b>Equipo RunFlow</b><span id="v8AthleteCount">Cargando atletas…</span></div></div>
      <div class="v8-nav-title">Espacio de trabajo</div>
      <nav class="v8-nav">
        <button data-v8-view="summary" class="active"><span class="ico">▦</span><span>Resumen</span></button>
        <button data-v8-view="athletes"><span class="ico">♙</span><span>Atletas</span></button>
        <button data-v8-view="plan"><span class="ico">▤</span><span>Planificación</span></button>
        <button data-v8-view="performance"><span class="ico">⌁</span><span>Análisis</span></button>
        <button data-v8-view="library"><span class="ico">▥</span><span>Biblioteca</span></button>
        <button data-v8-view="week"><span class="ico">□</span><span>Calendario</span></button>
        <button data-v8-view="activities"><span class="ico">↗</span><span>Actividades</span></button>
        <button data-v8-view="messages"><span class="ico">☵</span><span>Mensajes</span><span id="v8MessageCount" class="count"></span></button>
        <button data-v8-view="recovery"><span class="ico">♡</span><span>Recuperación</span></button>
        <button data-v8-view="profile"><span class="ico">◎</span><span>Ficha y zonas</span></button>
        <button data-v8-view="goals"><span class="ico">◉</span><span>Objetivos</span></button>
        <button data-v8-view="connections"><span class="ico">⛓</span><span>Conexiones</span></button>
      </nav>
      <div class="v8-nav-title" style="margin-top:18px">Previsualización</div>
      <nav class="v8-nav"><button id="v8AthleteApp" type="button"><span class="ico">▯</span><span>App del atleta</span></button></nav>
      <div class="v8-sidebar-foot"><div class="v8-sync"><i></i><div><b style="color:#fff">Intervals.icu</b><br>Datos compartidos con Coach</div></div></div>`;
    document.body.prepend(sidebar);

    sidebar.querySelectorAll('[data-v8-view]').forEach(button => button.addEventListener('click', () => {
      const target = button.dataset.v8View;
      const original = document.querySelector(`main.shell>.tabs [data-view="${target}"]`);
      if (original) original.click();
      sidebar.querySelectorAll('[data-v8-view]').forEach(x => x.classList.toggle('active', x === button));
      setTimeout(() => { decorateIntensity(); if (target === 'plan') renderV8PlanWeek(); updateSidebarMeta(); }, 80);
    }));
    sidebar.querySelector('#v8AthleteApp')?.addEventListener('click', () => window.open('/athlete', '_blank'));
  }

  function updateSidebarMeta(){
    try {
      const count = Array.isArray(state?.athletes) ? state.athletes.length : 0;
      const el = document.getElementById('v8AthleteCount');
      if (el) el.textContent = `${count} atleta${count === 1 ? '' : 's'}`;
    } catch {}
    const sourceBadge = document.getElementById('coachMessagesTabUnread');
    const targetBadge = document.getElementById('v8MessageCount');
    if (targetBadge) targetBadge.textContent = sourceBadge && !sourceBadge.classList.contains('hidden') && sourceBadge.textContent !== '0' ? sourceBadge.textContent : '';
  }

  function addLegend(){
    const weekStrip = document.getElementById('weekStrip');
    if (!weekStrip || document.getElementById('v8IntensityLegend')) return;
    const legend = document.createElement('div');
    legend.id = 'v8IntensityLegend'; legend.className = 'v8-intensity-legend';
    legend.innerHTML = `<span><i style="background:var(--v8-z2)"></i>Z2 / Endurance</span><span><i style="background:var(--v8-tempo)"></i>Tempo</span><span><i style="background:var(--v8-sweet)"></i>Sweet Spot</span><span><i style="background:var(--v8-threshold)"></i>Umbral</span><span><i style="background:var(--v8-vo2)"></i>VO₂max</span><span><i style="background:var(--v8-strength)"></i>Fuerza</span>`;
    weekStrip.parentElement.insertBefore(legend, weekStrip);
  }

  function decorateIntensity(){
    document.querySelectorAll('#weekStrip .day-card').forEach(card => {
      card.classList.remove('v8-z2','v8-tempo','v8-sweet','v8-threshold','v8-vo2','v8-strength');
      const cls = intensityClass(card.textContent); if (cls) card.classList.add(cls);
    });
    document.querySelectorAll('.plan-workout-row,.template-card,.calendar-session,.workout-card').forEach(card => {
      card.classList.remove('v8-z2','v8-tempo','v8-sweet','v8-threshold','v8-vo2','v8-strength');
      const cls = intensityClass(card.textContent); if (cls) card.classList.add(cls);
    });
    addLegend();
  }

  function renderV8PlanWeek(){
    const planView = document.getElementById('planView');
    if (!planView) return;
    let week;
    try { week = state?.athlete?.week; } catch { week = null; }
    if (!week?.week_start) return;
    let panel = document.getElementById('v8LivePlanWeek');
    if (!panel){ panel = document.createElement('section'); panel.id='v8LivePlanWeek'; panel.className='v8-plan-week'; planView.querySelector('.stack')?.prepend(panel); }
    const workouts = Array.isArray(week.workouts) ? week.workouts : [];
    const byDate = new Map(); workouts.forEach(w => { if(!byDate.has(w.workout_date)) byDate.set(w.workout_date,[]); byDate.get(w.workout_date).push(w); });
    const total = workouts.reduce((sum,w)=>sum+Number(w.planned_load||0),0);
    panel.innerHTML = `<div class="v8-plan-week-head"><div><p class="eyebrow">Semana conectada · datos reales</p><h2>${esc(week.title || 'Semana seleccionada')}</h2><p>${esc(week.week_type || 'Planificación')} · carga prevista ${total}${week.target_load ? ` / objetivo ${Number(week.target_load)}` : ''}</p></div><div class="v8-intensity-legend"><span><i style="background:var(--v8-z2)"></i>Z2</span><span><i style="background:var(--v8-tempo)"></i>Tempo</span><span><i style="background:var(--v8-sweet)"></i>Sweet Spot</span><span><i style="background:var(--v8-threshold)"></i>Umbral</span><span><i style="background:var(--v8-vo2)"></i>VO₂</span><span><i style="background:var(--v8-strength)"></i>Fuerza</span></div></div>
      <div class="v8-week-grid">${Array.from({length:7},(_,i)=>{
        const date=addDays(week.week_start,i), list=byDate.get(date)||[], dayLoad=list.reduce((s,w)=>s+Number(w.planned_load||0),0);
        return `<article class="v8-week-day ${date===todayIso()?'today':''}"><div class="v8-week-day-head"><div><small>${dayNames[i]}</small><strong>${dayNum(date)}</strong></div><small>${dayLoad}</small></div>${list.length?list.map(w=>`<div class="v8-session ${intensityClass(`${w.title||''} ${w.summary||''} ${w.session_objective||''} ${w.sport||''}`)}"><span class="load">${Number(w.planned_load||0)}</span><span class="meta">${esc(w.sport==='Strength'?'🏋️ Fuerza':w.sport==='Ride'?'🚴 Bici':/trail/i.test(`${w.title||''} ${w.summary||''}`)?'⛰️ Trail':'🏃 Running')}</span><b>${esc(w.title||'Sesión')}</b><p>${esc(w.session_objective||w.summary||'Sesión programada')}</p></div>`).join(''):'<div class="v8-rest">Descanso / sin sesión</div>'}<div class="v8-week-total"><span>${list.length?`${list.length} sesión${list.length>1?'es':''}`:'Recuperación'}</span><b>${dayLoad}</b></div></article>`;
      }).join('')}</div>`;
  }

  function installObservers(){
    const root = document.querySelector('main.shell');
    if (root) new MutationObserver(() => { decorateIntensity(); updateSidebarMeta(); }).observe(root,{subtree:true,childList:true,characterData:true});
    document.getElementById('athleteSelect')?.addEventListener('change',()=>setTimeout(()=>{decorateIntensity();renderV8PlanWeek();updateSidebarMeta();},350));
    document.querySelectorAll('[data-go="week"]').forEach(b=>b.addEventListener('click',()=>setTimeout(decorateIntensity,100)));
  }

  async function boot(){
    try{
      const response = await fetch('/coach.html',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok) throw new Error('No se pudo cargar la base de Coach.');
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html,'text/html');
      doc.querySelectorAll('script').forEach(s=>s.remove());
      document.body.innerHTML = doc.body.innerHTML;
      document.body.className = 'coach-v8';
      buildSidebar();
      const coachScript=document.createElement('script'); coachScript.src='/js/coach.js?v=2.4.2.2';
      coachScript.onload=()=>{
        const sw=document.createElement('script'); sw.src='/js/register-sw.js?v=2.4.2.2'; document.body.appendChild(sw);
        setTimeout(()=>{ decorateIntensity(); renderV8PlanWeek(); updateSidebarMeta(); installObservers(); },400);
      };
      coachScript.onerror=()=>{throw new Error('No se pudo iniciar la lógica de Coach.')};
      document.body.appendChild(coachScript);
    }catch(error){
      document.body.className=''; document.body.innerHTML=`<main class="v8-loader"><div class="v8-loader-mark">!</div><strong>No se pudo iniciar Coach V8</strong><span>${esc(error.message)}</span><a href="/coach">Volver a Coach estable</a></main>`;
    }
  }
  boot();
})();
