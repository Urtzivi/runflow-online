(() => {
  const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const st=()=>{try{return state}catch{return null}};
  const athleteId=()=>q('#athleteSelect')?.value||q('#v8AthleteSelect')?.value||'';
  const apiV9=async(url,opt={})=>{const r=await fetch(url,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo completar la operación.');return d;};
  let library=null,dynamic=null;
  const days=[['1','Lun'],['2','Mar'],['3','Mié'],['4','Jue'],['5','Vie'],['6','Sáb'],['7','Dom']];
  function notify(text,type='success'){try{showMessage(text,type)}catch{alert(text)}}

  function installPlannerButton(){
    if(q('#v9PlannerButton'))return;
    const host=q('#planView .plan-season-actions')||q('#planView .plan-command-inner');if(!host)return;
    const b=document.createElement('button');b.id='v9PlannerButton';b.className='btn primary';b.type='button';b.textContent='Planificador guiado V9';host.appendChild(b);
    b.addEventListener('click',()=>{if(window.RunFlowV8Planner?.open)return window.RunFlowV8Planner.open();const panel=q('#v8GuidedPlanner'),back=q('#v8GuidedBackdrop');if(panel){panel.classList.add('open');back?.classList.add('open');}else notify('El planificador guiado todavía no ha terminado de cargar.','error');});
  }

  function libraryTemplate(row){const strength=/strength|fuerza/i.test(String(row.Disciplina||row.Familia||''));return{id:`v9-${row.ID}`,source:'system',name:row.Nombre,category:row.Familia||'RunFlow V9',sport:strength?'Strength':'Run',stimulus:row.Objetivo_primario||row.Familia,template_data:{sport:strength?'Strength':'Run',priority:'B',planned_load:0,planned_duration_min:Number(row.Tiempo_total_min)||null,planned_distance_km:null,planned_elevation_m:null,is_strength:strength,title:row.Nombre,session_objective:row.Objetivo_primario||'',adaptation_target:row.Familia||'',purpose:row.Criterio_exito||'',summary:[row.Intensidad_prescrita,row.Bloque_principal,`Coste planificado sRPE: ${row.Carga_sRPE_est??'—'}`].filter(Boolean).join(' · '),structured_description:[row.Calentamiento&&`Calentamiento: ${row.Calentamiento}`,row.Bloque_principal&&`Bloque principal: ${row.Bloque_principal}`,row.Vuelta_calma&&`Vuelta a la calma: ${row.Vuelta_calma}`,row.Intensidad_prescrita&&`Intensidad: ${row.Intensidad_prescrita}`].filter(Boolean).join('\n'),blocks:[],v9_library:row}}}
  async function loadLibrary(){if(library)return library;library=await apiV9('/api/v9/library');return library;}
  async function installLibrary(){
    if(!q('#libraryView'))return;try{const data=await loadLibrary();const base=st();if(base){base.templates=(base.templates||[]).filter(x=>!String(x.id||'').startsWith('v9-'));base.templates.push(...data.sessions.map(libraryTemplate));if(typeof renderLibrary==='function')renderLibrary();}
      const status=q('#libraryStatus');if(status)status.textContent=`${data.count} sesiones oficiales · Biblioteca RunFlow V9 v1`;
    }catch(e){const status=q('#libraryStatus');if(status)status.textContent=`No se pudo cargar Biblioteca V9: ${e.message}`;}
  }

  async function loadRunFlowMetrics(){const id=athleteId();if(!id)return;try{const data=await apiV9(`/api/v9/coach/athletes/${encodeURIComponent(id)}/load-metrics`),m=data.latest||{};const s=st();if(s?.athlete){s.athlete.metrics={...(s.athlete.metrics||{}),fitness:m.fitness,fatigue:m.fatigue,form:m.form};}
    ['fitness','fatigue','form'].forEach(k=>{const el=q(`#${k}`);if(el)el.textContent=Number.isFinite(Number(m[k]))?Number(m[k]).toFixed(1):'—'});
    let badge=q('#v9LoadSource');if(!badge){badge=document.createElement('div');badge.id='v9LoadSource';badge.className='v9-load-source';const hero=q('#summaryView .hero');hero?.after(badge);}if(badge)badge.innerHTML=`<strong>Métricas RunFlow</strong><span>Aptitud ${Number(m.fitness||0).toFixed(1)} · Fatiga ${Number(m.fatigue||0).toFixed(1)} · Forma ${Number(m.form||0).toFixed(1)}</span><small>Calculadas por RunFlow con toda la carga registrada. Las cargas estimadas se identifican como tales.</small>`;
  }catch(e){console.warn('V9 load',e.message)}}

  async function loadAlerts(){const id=athleteId();if(!id)return;try{const {alerts}=await apiV9(`/api/v9/coach/athletes/${encodeURIComponent(id)}/alerts`);let box=q('#v9MissedAlerts');if(!box){box=document.createElement('section');box.id='v9MissedAlerts';box.className='v9-alert-panel';const root=q('#summaryView .stack')||q('#summaryView');root?.prepend(box);}box.innerHTML=(alerts||[]).length?`<div class="v9-panel-head"><div><span>ALERTAS RUNFLOW</span><h3>Sesiones no realizadas</h3></div><b>${alerts.length}</b></div>${alerts.map(a=>`<button type="button" data-v9-missed="${esc(a.workout_id)}" data-v9-date="${esc(a.date)}"><strong>⚠ ${esc(a.title)}</strong><span>${esc(a.date)} · prevista y sin actividad/feedback realizado</span><em>Revisar sesión →</em></button>`).join('')}`:`<div class="v9-panel-head"><div><span>ALERTAS RUNFLOW</span><h3>Sin sesiones omitidas pendientes</h3></div><b>✓</b></div>`;}catch(e){console.warn('alerts',e.message)}}
  function openWorkoutInCalendar(date,id){try{if(typeof switchView==='function')switchView('week');if(typeof selectCalendarWeek==='function')selectCalendarWeek(isoMonday(new Date(`${date}T12:00:00`)),true);setTimeout(()=>{const node=q(`[data-session-id="${CSS.escape(String(id))}"]`);if(node)node.click();else if(typeof openSessionModal==='function')openSessionModal(id,date);},400);}catch(e){console.warn(e)}}

  function installReviewFix(){document.addEventListener('click',e=>{const missed=e.target.closest('[data-v9-missed]');if(missed){e.preventDefault();openWorkoutInCalendar(missed.dataset.v9Date,missed.dataset.v9Missed);return;}const b=e.target.closest('[data-v8-open-athlete]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();const id=b.dataset.v8OpenAthlete,original=q('#athleteSelect');if(original&&id){original.value=id;original.dispatchEvent(new Event('change',{bubbles:true}));}const row=b.closest('.v8-validation-row');const title=row?.querySelector('.v8-validation-main b')?.textContent?.split(' · ').slice(1).join(' · ').trim();const dateText=row?.querySelector('.v8-validation-main span')?.textContent?.split(' · ')[0]?.trim();setTimeout(()=>{const tab=q('main.shell>.tabs [data-view="activities"]');tab?.click();setTimeout(()=>{const cards=qa('#activitiesView [data-activity-id],#activitiesView article,#activitiesView tr');const match=cards.find(x=>(!title||x.textContent.includes(title))&&(!dateText||x.textContent.includes(dateText)));match?.querySelector('button,[data-activity-id]')?.click?.();match?.click?.();},500);},450);},true)}

  async function loadBannerEditor(){const id=athleteId();if(!id)return;let card=q('#v9BannerEditor');if(!card){card=document.createElement('section');card.id='v9BannerEditor';card.className='card v9-banner-editor';card.innerHTML=`<div class="card-head"><div><p class="eyebrow">Motivación</p><h2>Banner para el atleta</h2><p>Mensaje visible en la pantalla inicial, separado del chat.</p></div></div><div class="card-body"><textarea id="v9BannerText" maxlength="500" placeholder="Ej.: Muy buena semana. Confía en el proceso y disfruta del trail del sábado."></textarea><div class="actions"><button id="v9SaveBanner" class="btn primary" type="button">Enviar banner</button><button id="v9ClearBanner" class="btn secondary" type="button">Quitar banner</button></div></div>`;const messages=q('#messagesView .stack')||q('#messagesView');messages?.prepend(card);q('#v9SaveBanner').onclick=saveBanner;q('#v9ClearBanner').onclick=()=>saveBanner(true);}try{const d=await apiV9(`/api/v9/coach/athletes/${encodeURIComponent(id)}/banner`);q('#v9BannerText').value=d.banner?.text||'';}catch{}}
  async function saveBanner(clear=false){const id=athleteId();if(!id)return;try{await apiV9(`/api/v9/coach/athletes/${encodeURIComponent(id)}/banner`,{method:'PUT',body:JSON.stringify(clear?{active:false}:{text:q('#v9BannerText').value,active:true})});if(clear)q('#v9BannerText').value='';notify(clear?'Banner retirado.':'Banner motivacional enviado al atleta.');}catch(e){notify(e.message,'error')}}

  function availabilityRow(day,stored={}){return `<div class="v9-day-row" data-day="${day[0]}"><b>${day[1]}</b><label><input type="checkbox" data-v9-can ${stored.can_train!==false?'checked':''}> entrenar</label><label>Máx. <input type="number" min="0" step="5" data-v9-minutes value="${stored.max_minutes??''}"> min</label><label><input type="checkbox" data-v9-mountain ${stored.mountain?'checked':''}> montaña</label><label><input type="checkbox" data-v9-gym ${stored.gym?'checked':''}> gimnasio</label><label><input type="checkbox" data-v9-bike ${stored.bike?'checked':''}> bici</label></div>`}
  async function loadDynamicProfile(){const id=athleteId();if(!id)return;try{dynamic=await apiV9(`/api/v9/coach/athletes/${encodeURIComponent(id)}/dynamic-profile`);installDynamicProfile();}catch(e){console.warn('dynamic profile',e.message)}}
  function installDynamicProfile(){const root=q('#profileView .stack')||q('#profileView');if(!root||!dynamic)return;let card=q('#v9DynamicProfile');if(!card){card=document.createElement('section');card.id='v9DynamicProfile';card.className='card v9-dynamic-profile';root.prepend(card);}const dayData=new Map((dynamic.availability?.days||[]).map(x=>[String(x.day),x]));card.innerHTML=`<div class="card-head"><div><p class="eyebrow">V9 · Perfil dinámico</p><h2>Disponibilidad, fuerza y capacidad de carga</h2><p>Los cambios se aplican hacia delante. El histórico realizado no se reescribe.</p></div></div><div class="card-body"><div class="v9-days">${days.map(d=>availabilityRow(d,dayData.get(d[0])||{})).join('')}</div><div class="v9-strength-mode"><strong>Fuerza</strong><label><input type="radio" name="v9StrengthMode" value="runflow" ${dynamic.strength_mode!=='external'?'checked':''}> RunFlow programa la fuerza</label><label><input type="radio" name="v9StrengthMode" value="external" ${dynamic.strength_mode==='external'?'checked':''}> La hace por su cuenta / gimnasio</label><div class="v9-external-days">Días de fuerza externa: ${days.map(d=>`<label><input type="checkbox" data-v9-ext-day="${d[0]}" ${(dynamic.external_strength_days||[]).includes(Number(d[0]))?'checked':''}> ${d[1]}</label>`).join('')}</div></div><div class="v9-load-ceiling"><label>Carga máxima actual<input id="v9MaxLoad" type="number" min="0" value="${dynamic.max_load??''}"></label><label>Fecha efectiva<input id="v9EffectiveDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label></div><div class="actions"><button id="v9SaveDynamic" class="btn primary" type="button">Guardar cambios</button><button id="v9ReplanFuture" class="btn secondary" type="button">Actualizar planificación futura</button></div><div id="v9ReplanResult" class="notice hidden"></div></div>`;q('#v9SaveDynamic').onclick=saveDynamic;q('#v9ReplanFuture').onclick=replanFuture;}
  async function saveDynamic(){
    const id=athleteId();
    const rows=qa('#v9DynamicProfile [data-day]');
    const availability={
      ...(dynamic?.availability||{}),
      days:rows.map(r=>({
        day:Number(r.dataset.day),
        can_train:q('[data-v9-can]',r).checked,
        max_minutes:q('[data-v9-minutes]',r).value===''?null:Number(q('[data-v9-minutes]',r).value),
        mountain:q('[data-v9-mountain]',r).checked,
        gym:q('[data-v9-gym]',r).checked,
        bike:q('[data-v9-bike]',r).checked
      }))
    };
    const strength_mode=q('input[name="v9StrengthMode"]:checked')?.value||'runflow';
    const external_strength_days=qa('[data-v9-ext-day]:checked').map(x=>Number(x.dataset.v9ExtDay));
    const max_load=q('#v9MaxLoad').value===''?null:Number(q('#v9MaxLoad').value);
    const effective_date=q('#v9EffectiveDate').value;
    try{
      const d=await apiV9(`/api/v9/coach/athletes/${encodeURIComponent(id)}/dynamic-profile`,{method:'PUT',body:JSON.stringify({availability,strength_mode,external_strength_days,max_load,effective_date})});
      dynamic=d.dynamic;
      notify('Perfil dinámico guardado. RunFlow ha registrado el cambio para la planificación futura.');
    }catch(e){notify(e.message,'error')}
  }
  async function replanFuture(){const id=athleteId(),box=q('#v9ReplanResult');try{const d=await apiV9(`/api/v9/coach/athletes/${encodeURIComponent(id)}/replan`,{method:'POST',body:JSON.stringify({effective_date:q('#v9EffectiveDate').value,reason:'profile_change'})});box.className='notice success';box.innerHTML=`<strong>Actualización futura realizada</strong><br>${d.moved} sesiones recolocadas · ${d.blocked} sin hueco compatible · ${d.weeks} semanas revisadas.<br><small>${esc(d.note||'')}</small>`;box.classList.remove('hidden');if(typeof loadPlan==='function')await loadPlan();}catch(e){box.className='notice error';box.textContent=e.message;box.classList.remove('hidden')}}

  function onView(){const active=q('main.shell>.view.active')?.id||'';if(active==='libraryView')installLibrary();if(active==='messagesView')loadBannerEditor();if(active==='profileView')loadDynamicProfile();if(active==='summaryView'){loadAlerts();loadRunFlowMetrics();}if(active==='planView')installPlannerButton();}
  function boot(){installPlannerButton();installReviewFix();installLibrary();loadAlerts();loadRunFlowMetrics();loadBannerEditor();loadDynamicProfile();const select=q('#athleteSelect');select?.addEventListener('change',()=>setTimeout(()=>{dynamic=null;loadAlerts();loadRunFlowMetrics();loadBannerEditor();loadDynamicProfile();},500));new MutationObserver(()=>{installPlannerButton();onView();}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});}
  setTimeout(boot,1200);
})();
