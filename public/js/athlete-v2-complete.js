(() => {
  const q=(s,r=document)=>r.querySelector(s);
  const apiV2=async(url,options={})=>{const r=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo completar la operación.');return d;};
  const st=()=>{try{return state}catch{return null}};
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  let manualRows=[];

  function toast(text,type='success'){try{message(text,type)}catch{const el=q('#athleteMessage');if(el){el.textContent=text;el.className=`notice athlete-toast ${type}`;el.classList.remove('hidden');}}}
  function openManual(){q('#v2AddManualActivity')?.click();}

  function installHomeAdd(){
    if(q('#v2HomeAddActivity'))return;
    const card=q('#todayWorkoutCard'); if(!card)return;
    const btn=document.createElement('button');btn.id='v2HomeAddActivity';btn.type='button';btn.className='v2-home-add-activity';btn.textContent='+ Añadir actividad';btn.addEventListener('click',openManual);
    card.parentNode.insertBefore(btn,card);
  }
  async function loadBanner(){
    try{const {banner}=await apiV2('/api/v2/athlete/banner');let el=q('#v2MotivationBanner');if(!banner?.active||!banner.text){el?.remove();return;}if(!el){el=document.createElement('section');el.id='v2MotivationBanner';el.className='v2-motivation-banner';const content=q('#todayView .athlete-v2-content');content?.prepend(el);}el.innerHTML=`<span>DE TU COACH</span><strong>${escapeHtml(banner.text)}</strong>`;}catch(e){console.warn('banner',e.message);}
  }
  async function loadMetrics(){
    try{const data=await apiV2('/api/v2/athlete/load-metrics');const m=data.latest||{};const s=st();if(s?.athlete){s.athlete.metrics={...(s.athlete.metrics||{}),fitness:m.fitness,fatigue:m.fatigue,form:m.form,week_load:(data.history||[]).filter(x=>x.date>=isoMonday(new Date())).reduce((a,x)=>a+Number(x.load||0),0)};}
      q('#profileFitness')&&(q('#profileFitness').textContent=Number.isFinite(Number(m.fitness))?Number(m.fitness).toFixed(1):'—');
      q('#profileFatigue')&&(q('#profileFatigue').textContent=Number.isFinite(Number(m.fatigue))?Number(m.fatigue).toFixed(1):'—');
      q('#profileForm')&&(q('#profileForm').textContent=Number.isFinite(Number(m.form))?Number(m.form).toFixed(1):'—');
      q('#athleteFitnessIndex')&&(q('#athleteFitnessIndex').textContent=Number.isFinite(Number(m.fitness))?`Aptitud RunFlow ${Number(m.fitness).toFixed(1)}`:'Aptitud RunFlow —');
      q('#athleteFitnessQuality')&&(q('#athleteFitnessQuality').textContent='RunFlow');
    }catch(e){console.warn('load metrics',e.message);}
  }

  function sportIcon(v){return ({walk:'🚶',strength:'🏋️',bike:'🚴',run:'🏃',trail:'⛰️',other:'●'})[v]||'●'}
  function sportLabel(v){return ({walk:'Caminar',strength:'Fuerza',bike:'Bici',run:'Running',trail:'Trail',other:'Otro'})[v]||v||'Actividad'}
  function renderServerManual(){
    const holder=q('#athleteActivities');if(!holder)return;
    holder.querySelectorAll('[data-v2-server-manual]').forEach(x=>x.remove());
    manualRows.forEach(row=>{const meta=row.raw_summary?.runflow_manual||{};const card=document.createElement('article');card.className='athlete-activity-card-v2 v2-manual-activity-card';card.dataset.v2ServerManual=row.id;const duration=Math.round(Number(row.duration_sec||0)/60);const km=Number(row.distance_m||0)/1000;const load=Number(row.load||0);card.innerHTML=`<div class="athlete-activity-icon">${sportIcon(meta.sport)}</div><div><span>${escapeHtml(String(row.activity_date||'').slice(0,10))} · MANUAL</span><h3>${escapeHtml(row.name||sportLabel(meta.sport))}</h3><p>${km>0?`${km.toFixed(1)} km · `:''}${duration} min${Number(row.elevation_gain_m)>0?` · ${Math.round(row.elevation_gain_m)} m+`:''}</p></div><div class="athlete-activity-load-v2"><strong>${Number.isFinite(load)?Math.round(load):'—'}</strong><small>carga RunFlow · estimada</small><em>${meta.confidence||row.raw_summary?.runflow_load_confidence||'baja'}</em></div>`;holder.prepend(card);});
  }
  async function loadManual(){try{const d=await apiV2('/api/v2/athlete/manual-activities');manualRows=d.activities||[];renderServerManual();}catch(e){console.warn('manual',e.message);}}

  function installManualSaveOverride(){
    document.addEventListener('click',async e=>{
      const btn=e.target.closest('#v2SaveManual');if(!btn)return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      const sport=q('#v2ManualSport')?.value,date=q('#v2ManualDate')?.value,duration=Number(q('#v2ManualDuration')?.value),rpe=Number(q('#v2ManualRpe')?.value);
      if(!sport||!date||!duration||!rpe)return toast('Completa tipo, fecha, duración y RPE.','error');
      btn.disabled=true;btn.textContent='Guardando…';
      try{const d=await apiV2('/api/v2/athlete/manual-activities',{method:'POST',body:JSON.stringify({sport,activity_date:date,duration_min:duration,rpe,distance_km:q('#v2ManualDistance')?.value||null,elevation_m:q('#v2ManualElevation')?.value||null,pain:q('#v2ManualPain')?.value||0,feeling:q('#v2ManualFeeling')?.value||null,comment:q('#v2ManualComment')?.value||''})});q('#v2ManualActivityModal')?.classList.add('hidden');toast(`Actividad guardada · carga RunFlow estimada ${Math.round(Number(d.activity?.load||0))}.`);await Promise.all([loadManual(),loadMetrics()]);}
      catch(err){toast(err.message,'error');}finally{btn.disabled=false;btn.textContent='Guardar actividad';}
    },true);
  }

  function installReschedule(){
    const actions=q('#sessionDetail .athlete-session-actions');if(actions&&!q('#v2RescheduleWorkout')){const b=document.createElement('button');b.id='v2RescheduleWorkout';b.className='athlete-secondary-cta';b.type='button';b.textContent='Cambiar día';actions.prepend(b);b.addEventListener('click',openReschedule);}
    if(q('#v2RescheduleModal'))return;
    const modal=document.createElement('div');modal.id='v2RescheduleModal';modal.className='modal-backdrop hidden';modal.innerHTML=`<div class="modal athlete-feedback-modal"><div class="athlete-session-modal-head"><button id="v2CloseReschedule" class="athlete-modal-close" type="button">←</button><div><p class="athlete-kicker">REPROGRAMAR</p><h2>Cambiar día</h2></div></div><div class="modal-body"><p id="v2RescheduleWorkoutName" class="athlete-session-lead"></p><label>Nueva fecha<input id="v2RescheduleDate" type="date"></label><div id="v2RescheduleWarning" class="notice hidden" style="margin-top:12px"></div><button id="v2ConfirmReschedule" class="athlete-primary-cta full" type="button">Comprobar cambio</button></div></div>`;document.body.appendChild(modal);q('#v2CloseReschedule').onclick=()=>modal.classList.add('hidden');q('#v2ConfirmReschedule').onclick=confirmReschedule;
  }
  function selectedWorkout(){return st()?.selectedWorkout||null;}
  function openReschedule(){const w=selectedWorkout();if(!w)return toast('No he podido identificar la sesión.','error');q('#v2RescheduleWorkoutName').textContent=w.title||'Sesión';q('#v2RescheduleDate').value=String(w.workout_date||today()).slice(0,10);q('#v2RescheduleWarning').classList.add('hidden');q('#v2ConfirmReschedule').dataset.stage='preview';q('#v2ConfirmReschedule').textContent='Comprobar cambio';q('#v2RescheduleModal').classList.remove('hidden');}
  async function confirmReschedule(){const w=selectedWorkout(),date=q('#v2RescheduleDate').value,btn=q('#v2ConfirmReschedule');if(!w||!date)return;btn.disabled=true;try{if(btn.dataset.stage!=='confirm'){const d=await apiV2(`/api/v2/athlete/workouts/${encodeURIComponent(w.id)}/reschedule`,{method:'POST',body:JSON.stringify({new_date:date,preview:true})});const warn=q('#v2RescheduleWarning');if((d.conflicts||[]).length){warn.className='notice warning';warn.innerHTML=`<strong>Atención:</strong> ese día ya tienes ${d.conflicts.map(x=>escapeHtml(x.title)).join(', ')}. Puedes confirmar igualmente o elegir otra fecha.`;warn.classList.remove('hidden');}else{warn.className='notice success';warn.textContent='No se han detectado otras sesiones ese día.';warn.classList.remove('hidden');}btn.dataset.stage='confirm';btn.textContent='Confirmar y sincronizar con Intervals';}else{const d=await apiV2(`/api/v2/athlete/workouts/${encodeURIComponent(w.id)}/reschedule`,{method:'POST',body:JSON.stringify({new_date:date,preview:false})});q('#v2RescheduleModal').classList.add('hidden');toast(d.intervals?.synced?'Sesión movida y actualizada en Intervals.':'Sesión movida en RunFlow. Revisa la sincronización con Intervals.');setTimeout(()=>location.reload(),700);}}catch(err){toast(err.message,'error');}finally{btn.disabled=false;}}

  function boot(){installHomeAdd();installReschedule();loadBanner();loadMetrics();loadManual();}
  installManualSaveOverride();
  const obs=new MutationObserver(()=>{installHomeAdd();installReschedule();if(q('#activitiesView.active'))renderServerManual();});obs.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(boot,600);setInterval(()=>{loadBanner();loadMetrics();},60000);
})();
