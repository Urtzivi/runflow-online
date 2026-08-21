(() => {
  document.documentElement.dataset.runflowAthleteVersion='2-beta';

  const STORAGE_KEY='runflow_v2_manual_activities';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const todayIso=()=>{const d=new Date();const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;};
  const sportIcon=value=>({walk:'🚶',strength:'🏋️',bike:'🚴',run:'🏃',trail:'⛰️',other:'●'})[value]||'●';
  const sportLabel=value=>({walk:'Caminar',strength:'Fuerza',bike:'Bici',run:'Running',trail:'Trail',other:'Otro'})[value]||'Actividad';
  const srpeLoad=(duration,rpe)=>{const d=Number(duration),r=Number(rpe);return Number.isFinite(d)&&d>0&&Number.isFinite(r)&&r>=1&&r<=10?Math.round(d*r):null;};

  function readLocal(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]')}catch{return []}}
  function writeLocal(rows){localStorage.setItem(STORAGE_KEY,JSON.stringify(rows.slice(0,100)));}
  function athleteKey(){try{return state?.athlete?.id||state?.user?.athlete_id||'athlete'}catch{return 'athlete'}}
  function mine(){const key=athleteKey();return readLocal().filter(x=>x.athlete_key===key).sort((a,b)=>String(b.activity_date).localeCompare(String(a.activity_date)));}

  function installBadge(){
    if(document.querySelector('.athlete-v2-beta-chip'))return;
    const badge=document.createElement('div');
    badge.className='athlete-v2-beta-chip';
    badge.textContent='V2 beta';
    document.body.appendChild(badge);
  }

  function installButton(){
    const activitiesView=document.getElementById('activitiesView');
    if(!activitiesView||document.getElementById('v2AddManualActivity'))return false;
    const title=activitiesView.querySelector('.athlete-page-title');
    const refresh=document.getElementById('refreshAthleteActivities');
    if(!title||!refresh)return false;
    const actions=document.createElement('div');
    actions.className='v2-activity-head-actions';
    const add=document.createElement('button');
    add.id='v2AddManualActivity';
    add.className='athlete-primary-cta v2-add-activity-btn';
    add.type='button';
    add.textContent='+ Añadir actividad';
    refresh.parentNode.insertBefore(actions,refresh);
    actions.append(add,refresh);
    add.addEventListener('click',openModal);
    return true;
  }

  function installModal(){
    if(document.getElementById('v2ManualActivityModal'))return;
    const modal=document.createElement('div');
    modal.id='v2ManualActivityModal';
    modal.className='modal-backdrop hidden';
    modal.innerHTML=`<div class="modal athlete-feedback-modal v2-manual-modal">
      <div class="athlete-session-modal-head"><button id="v2CloseManual" class="athlete-modal-close" type="button">←</button><div><p class="athlete-kicker">ACTIVIDAD NO PROGRAMADA</p><h2>Añadir actividad</h2></div></div>
      <div class="modal-body">
        <p class="v2-manual-help">RunFlow calcula desde ahora la carga interna sRPE de la actividad como duración real × RPE. La conversión a la carga RunFlow definitiva que alimentará Aptitud, Fatiga y Forma se incorporará con el motor V9.</p>
        <label class="athlete-field-label">Tipo de actividad</label>
        <div class="v2-sport-grid">
          <button type="button" data-v2-sport="walk">🚶<span>Caminar</span></button>
          <button type="button" data-v2-sport="strength">🏋️<span>Fuerza</span></button>
          <button type="button" data-v2-sport="bike">🚴<span>Bici</span></button>
          <button type="button" data-v2-sport="run">🏃<span>Running</span></button>
          <button type="button" data-v2-sport="trail">⛰️<span>Trail</span></button>
          <button type="button" data-v2-sport="other">●<span>Otro</span></button>
        </div>
        <input id="v2ManualSport" type="hidden">
        <div class="field-row v2-manual-row">
          <label>Fecha<input id="v2ManualDate" type="date"></label>
          <label>Duración real (min)<input id="v2ManualDuration" type="number" min="1" max="1000" inputmode="numeric"></label>
        </div>
        <label class="athlete-field-label">RPE · esfuerzo percibido <strong id="v2ManualRpeValue">—</strong></label>
        <div id="v2ManualRpeScale" class="athlete-rpe-scale">${Array.from({length:10},(_,i)=>`<button data-v2-rpe="${i+1}" type="button">${i+1}</button>`).join('')}</div>
        <input id="v2ManualRpe" type="hidden">
        <div class="field-row v2-manual-row">
          <label>Distancia (km) · opcional<input id="v2ManualDistance" type="number" min="0" step="0.1" inputmode="decimal"></label>
          <label>Desnivel + (m) · opcional<input id="v2ManualElevation" type="number" min="0" step="1" inputmode="numeric"></label>
        </div>
        <div class="field-row v2-manual-row">
          <label>Molestia / dolor (0–10)<input id="v2ManualPain" type="number" min="0" max="10" value="0"></label>
          <label>Sensación<select id="v2ManualFeeling"><option value="">Sin indicar</option><option value="muy_bien">Muy buenas</option><option value="bien">Buenas</option><option value="normal">Normales</option><option value="mal">Malas</option></select></label>
        </div>
        <label style="margin-top:12px">Comentario<textarea id="v2ManualComment" placeholder="Opcional"></textarea></label>
        <div id="v2LoadPreview" class="v2-load-pending"><span>Carga interna sRPE</span><strong>—</strong><small>duración × RPE</small></div>
        <button id="v2SaveManual" class="athlete-primary-cta full" type="button">Guardar actividad</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    document.getElementById('v2CloseManual').addEventListener('click',closeModal);
    modal.addEventListener('click',e=>{if(e.target===modal)closeModal();});
    modal.querySelectorAll('[data-v2-sport]').forEach(btn=>btn.addEventListener('click',()=>{
      modal.querySelectorAll('[data-v2-sport]').forEach(x=>x.classList.toggle('active',x===btn));
      document.getElementById('v2ManualSport').value=btn.dataset.v2Sport;
    }));
    modal.querySelectorAll('[data-v2-rpe]').forEach(btn=>btn.addEventListener('click',()=>{
      modal.querySelectorAll('[data-v2-rpe]').forEach(x=>x.classList.toggle('active',x===btn));
      document.getElementById('v2ManualRpe').value=btn.dataset.v2Rpe;
      document.getElementById('v2ManualRpeValue').textContent=`${btn.dataset.v2Rpe}/10`;
      updateLoadPreview();
    }));
    document.getElementById('v2ManualDuration').addEventListener('input',updateLoadPreview);
    document.getElementById('v2SaveManual').addEventListener('click',saveManual);
  }

  function updateLoadPreview(){
    const preview=document.getElementById('v2LoadPreview');
    if(!preview)return;
    const load=srpeLoad(document.getElementById('v2ManualDuration')?.value,document.getElementById('v2ManualRpe')?.value);
    const strong=preview.querySelector('strong');
    const small=preview.querySelector('small');
    if(strong)strong.textContent=load===null?'—':String(load);
    if(small)small.textContent=load===null?'duración × RPE':`${document.getElementById('v2ManualDuration').value} min × RPE ${document.getElementById('v2ManualRpe').value}`;
  }

  function resetModal(){
    document.getElementById('v2ManualSport').value='';
    document.getElementById('v2ManualDate').value=todayIso();
    document.getElementById('v2ManualDuration').value='';
    document.getElementById('v2ManualRpe').value='';
    document.getElementById('v2ManualRpeValue').textContent='—';
    document.getElementById('v2ManualDistance').value='';
    document.getElementById('v2ManualElevation').value='';
    document.getElementById('v2ManualPain').value='0';
    document.getElementById('v2ManualFeeling').value='';
    document.getElementById('v2ManualComment').value='';
    document.querySelectorAll('[data-v2-sport],[data-v2-rpe]').forEach(x=>x.classList.remove('active'));
    updateLoadPreview();
  }
  function openModal(){resetModal();document.getElementById('v2ManualActivityModal').classList.remove('hidden');}
  function closeModal(){document.getElementById('v2ManualActivityModal').classList.add('hidden');}

  async function postManual(payload){
    const response=await fetch('/api/athlete/manual-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'No se pudo guardar la actividad.');
    return data;
  }

  async function saveManual(){
    const sport=document.getElementById('v2ManualSport').value;
    const date=document.getElementById('v2ManualDate').value;
    const duration=Number(document.getElementById('v2ManualDuration').value);
    const rpe=Number(document.getElementById('v2ManualRpe').value);
    if(!sport) return window.message?.('Selecciona el tipo de actividad.','error');
    if(!date) return window.message?.('Indica la fecha.','error');
    if(!Number.isFinite(duration)||duration<=0) return window.message?.('Indica la duración real.','error');
    if(!Number.isFinite(rpe)||rpe<1||rpe>10) return window.message?.('Indica el RPE de la actividad.','error');
    const load=srpeLoad(duration,rpe);
    const distance=document.getElementById('v2ManualDistance').value;
    const elevation=document.getElementById('v2ManualElevation').value;
    const pain=Number(document.getElementById('v2ManualPain').value||0);
    const feeling=document.getElementById('v2ManualFeeling').value;
    const comment=document.getElementById('v2ManualComment').value.trim();
    const metadata={source:'athlete_v2_manual_activity',activity_date:date,sport,distance_km:distance===''?null:Number(distance),elevation_m:elevation===''?null:Number(elevation),srpe_load:load,comment};
    const save=document.getElementById('v2SaveManual');
    save.disabled=true;save.textContent='Guardando…';
    try{
      const result=await postManual({
        workout_id:null,
        status:'completed',
        actual_duration_min:duration,
        rpe,
        pain,
        feeling:feeling||null,
        pain_area:null,
        comment:`RUNFLOW_V2_MANUAL_ACTIVITY ${JSON.stringify(metadata)}`
      });
      const rows=readLocal();
      rows.unshift({
        id:result.log?.id||`local-${Date.now()}`,
        athlete_key:athleteKey(),
        activity_date:date,
        sport,
        duration_min:duration,
        rpe,
        srpe_load:load,
        distance_km:metadata.distance_km,
        elevation_m:metadata.elevation_m,
        pain,
        feeling:feeling||null,
        comment,
        created_at:new Date().toISOString()
      });
      writeLocal(rows);
      closeModal();
      renderManualCards();
      window.message?.(`Actividad guardada · carga sRPE ${load}.`,'success');
    }catch(error){window.message?.(error.message,'error');}
    finally{save.disabled=false;save.textContent='Guardar actividad';}
  }

  function dateText(iso){try{return new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long'}).format(new Date(`${iso}T12:00:00`));}catch{return iso}}
  function renderManualCards(){
    const holder=document.getElementById('athleteActivities');
    if(!holder)return;
    holder.querySelectorAll('[data-v2-manual-card]').forEach(x=>x.remove());
    const rows=mine();
    if(!rows.length)return;
    const fragment=document.createDocumentFragment();
    rows.forEach(row=>{
      const card=document.createElement('article');
      card.className='athlete-activity-card-v2 v2-manual-activity-card';
      card.dataset.v2ManualCard=row.id;
      const details=[];
      if(Number.isFinite(Number(row.distance_km)))details.push(`${Number(row.distance_km).toFixed(1)} km`);
      details.push(`${Number(row.duration_min)} min`);
      if(Number.isFinite(Number(row.elevation_m))&&Number(row.elevation_m)>0)details.push(`${Math.round(Number(row.elevation_m))} m+`);
      const load=Number.isFinite(Number(row.srpe_load))?Number(row.srpe_load):srpeLoad(row.duration_min,row.rpe);
      card.innerHTML=`<div class="athlete-activity-icon">${sportIcon(row.sport)}</div><div><span>${esc(dateText(row.activity_date))} · MANUAL</span><h3>${esc(sportLabel(row.sport))}</h3><p>${esc(details.join(' · '))}</p></div><div class="athlete-activity-load-v2"><strong>${load===null?'—':load}</strong><small>carga sRPE</small><em>RPE ${Number(row.rpe)}</em></div>`;
      fragment.appendChild(card);
    });
    holder.prepend(fragment);
    const status=document.getElementById('athleteActivitiesStatus');
    if(status)status.textContent=`${rows.length} manual${rows.length===1?'':'es'} · ${status.textContent||''}`;
  }

  function observeActivities(){
    const holder=document.getElementById('athleteActivities');
    if(!holder||holder.dataset.v2Observed)return;
    holder.dataset.v2Observed='1';
    let busy=false;
    new MutationObserver(()=>{
      if(busy)return;busy=true;
      requestAnimationFrame(()=>{renderManualCards();busy=false;});
    }).observe(holder,{childList:true});
  }

  function boot(){
    installBadge();
    installModal();
    if(!installButton())return setTimeout(boot,120);
    observeActivities();
    setTimeout(renderManualCards,350);
  }
  boot();
})();
