(() => {
'use strict';
const $=id=>document.getElementById(id);
let checkinBundle=null,feedbackPrompted=false,booted=false,lastCheckinFetchDay=null;

async function rfApi(url,opt={}){
  const response=await fetch(url,{credentials:'same-origin',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'No se pudo completar la operación.');
  return data;
}
function localDay(){
  const d=new Date();
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function subjectiveLabel(score){return({1:'Muy fatigado',2:'Fatigado',3:'Normal',4:'Recuperado',5:'Muy recuperado'})[Number(score)]||'—'}
function modal(){
  let el=$('runflowMorningCheckin');
  if(el)return el;
  el=document.createElement('div');
  el.id='runflowMorningCheckin';
  el.className='modal-backdrop hidden rf-learning-backdrop';
  el.innerHTML=`<div class="modal rf-morning-modal">
    <div class="rf-morning-head"><div><p>CHECK-IN DE LA MAÑANA</p><h2>¿Cómo te encuentras hoy?</h2><span>Tu percepción nos ayuda a entender cómo respondes al entrenamiento.</span></div><button id="rfMorningLater" type="button" aria-label="Ahora no">×</button></div>
    <div class="modal-body">
      <p class="rf-morning-question">Valora tu recuperación / fatiga de hoy.</p>
      <div class="rf-recovery-scale">
        <button type="button" data-rf-score="1"><b>1</b><span>Muy fatigado</span></button>
        <button type="button" data-rf-score="2"><b>2</b><span>Fatigado</span></button>
        <button type="button" data-rf-score="3"><b>3</b><span>Normal</span></button>
        <button type="button" data-rf-score="4"><b>4</b><span>Recuperado</span></button>
        <button type="button" data-rf-score="5"><b>5</b><span>Muy recuperado</span></button>
      </div>
      <label class="rf-morning-comment">Comentario <small>opcional</small><textarea id="rfMorningComment" rows="3" maxlength="1200" placeholder="Ej.: he dormido mal, piernas cargadas, me encuentro muy bien…"></textarea></label>
      <div id="rfMorningBaseline" class="rf-baseline-note"></div>
      <button id="rfMorningSave" class="athlete-primary-cta full" type="button" disabled>Guardar cómo me encuentro</button>
      <button id="rfMorningSkip" class="rf-later-button" type="button">Ahora no</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  el._rfSelected=null;
  el.querySelectorAll('[data-rf-score]').forEach(button=>button.addEventListener('click',()=>{
    el._rfSelected=Number(button.dataset.rfScore);
    el.querySelectorAll('[data-rf-score]').forEach(x=>x.classList.toggle('active',x===button));
    $('rfMorningSave').disabled=false;
  }));
  const close=()=>{el.classList.add('hidden');setTimeout(checkPendingFeedback,400)};
  $('rfMorningLater').addEventListener('click',close);
  $('rfMorningSkip').addEventListener('click',close);
  $('rfMorningSave').addEventListener('click',async()=>{
    if(!el._rfSelected)return;
    const save=$('rfMorningSave');save.disabled=true;save.textContent='Guardando…';
    try{
      checkinBundle=await rfApi('/api/v2/athlete/daily-checkin',{method:'POST',body:JSON.stringify({recovery_score:el._rfSelected,comment:$('rfMorningComment').value})});
      lastCheckinFetchDay=localDay();
      renderSubjective();
      el.classList.add('hidden');
      document.dispatchEvent(new CustomEvent('runflow:daily-checkin-saved',{detail:{day:lastCheckinFetchDay}}));
      try{if(typeof message==='function')message('Sensación de hoy guardada.','success')}catch{}
      setTimeout(checkPendingFeedback,400);
    }catch(error){save.disabled=false;try{if(typeof message==='function')message(error.message,'error')}catch{alert(error.message)}}
    finally{save.textContent='Guardar cómo me encuentro'}
  });
  return el;
}
function installCheckinAction(){
  const card=document.querySelector('.athlete-mini-card.recovery');
  if(!card)return;
  let button=$('runflowOpenDailyCheckin');
  if(!button){
    button=document.createElement('button');
    button.id='runflowOpenDailyCheckin';
    button.className='rf-open-checkin';
    button.type='button';
    card.appendChild(button);
  }
  if(button.dataset.rfBound!=='true'){
    button.dataset.rfBound='true';
    button.addEventListener('click',event=>{event.stopPropagation();refreshDailyCheckin(true)});
  }
  if(card.dataset.rfBound!=='true'){
    card.dataset.rfBound='true';
    card.tabIndex=0;
    card.setAttribute('role','button');
    card.setAttribute('aria-label','Cumplimentar readiness diario');
    card.addEventListener('click',()=>refreshDailyCheckin(true));
    card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();refreshDailyCheckin(true)}});
  }
  button.textContent=checkinBundle?.today?'Editar readiness diario':'Cumplimentar readiness diario';
  button.dataset.completed=checkinBundle?.today?'true':'false';
}
function renderSubjective(){
  if(!checkinBundle)return;
  const card=document.querySelector('.athlete-mini-card.recovery');
  if(!card)return;
  let line=$('runflowSubjectiveRecovery');
  if(!line){line=document.createElement('div');line.id='runflowSubjectiveRecovery';line.className='rf-subjective-line';card.appendChild(line)}
  const today=checkinBundle.today,stats=checkinBundle.stats||{};
  installCheckinAction();
  if(!today){line.innerHTML='<span>Tu sensación</span><strong>Sin registrar hoy</strong>';return}
  const delta=Number(stats.delta_vs_baseline),deltaText=Number.isFinite(delta)&&Number(stats.count)>1?` · ${delta>0?'+':''}${delta.toFixed(1)} vs tu media`:'';
  line.innerHTML=`<span>Tu sensación</span><strong>${today.recovery_score}/5 · ${esc(subjectiveLabel(today.recovery_score))}</strong><small>${Number.isFinite(Number(stats.baseline_mean))?`Media personal ${Number(stats.baseline_mean).toFixed(1)}${deltaText}`:'Construyendo tu referencia personal'}</small>`;
}
function showMorning(){
  const el=modal(),stats=checkinBundle?.stats||{};
  const today=checkinBundle?.today||null;
  el._rfSelected=today?Number(today.recovery_score):null;
  el.querySelectorAll('[data-rf-score]').forEach(x=>x.classList.toggle('active',Number(x.dataset.rfScore)===el._rfSelected));
  if($('rfMorningSave')){
    $('rfMorningSave').disabled=!el._rfSelected;
    $('rfMorningSave').textContent=today?'Actualizar cómo me encuentro':'Guardar cómo me encuentro';
  }
  if($('rfMorningComment'))$('rfMorningComment').value=today?.comment||'';
  const note=$('rfMorningBaseline');
  if(note)note.textContent=Number(stats.count)>0&&Number.isFinite(Number(stats.baseline_mean))?`Tu media personal hasta ahora es ${Number(stats.baseline_mean).toFixed(1)}/5. RunFlow comparará cada día contigo mismo, no con una media genérica.`:'Con tus respuestas iremos construyendo tu nivel habitual de recuperación.';
  el.classList.remove('hidden');
}
async function refreshDailyCheckin(forcePrompt=false){
  try{
    checkinBundle=await rfApi('/api/v2/athlete/daily-checkin');
    lastCheckinFetchDay=localDay();
    renderSubjective();
    document.dispatchEvent(new CustomEvent('runflow:daily-checkin-state',{detail:{day:lastCheckinFetchDay,completed:Boolean(checkinBundle?.today)}}));
    if(checkinBundle?.today&&!forcePrompt){
      const el=$('runflowMorningCheckin');if(el)el.classList.add('hidden');
      return true;
    }
    if(forcePrompt||document.visibilityState==='visible')showMorning();
    return Boolean(checkinBundle?.today);
  }catch(error){console.warn('[RunFlow Learning] check-in',error.message);return null}
}
async function checkPendingFeedback(){
  if(feedbackPrompted)return;
  try{
    const data=await rfApi('/api/v2/athlete/pending-feedback');
    const pending=data.pending;
    if(!pending?.workout)return;
    feedbackPrompted=true;
    try{
      state.selectedWorkout=pending.workout;
      if(typeof resetFeedbackForm==='function')resetFeedbackForm();
      if($('logDuration')&&pending.activity?.duration_min)$('logDuration').value=pending.activity.duration_min;
      if($('logModal'))$('logModal').classList.remove('hidden');
      const kicker=$('logModal')?.querySelector('.athlete-kicker');
      if(kicker)kicker.textContent='SESIÓN RECIBIDA DE INTERVALS · CUÉNTANOS CÓMO FUE';
    }catch(error){console.warn('[RunFlow Learning] No se pudo abrir feedback',error)}
  }catch(error){console.warn('[RunFlow Learning] pending feedback',error.message)}
}
async function refreshIntervalsThenFeedback(){
  try{await rfApi('/api/athlete/activities?limit=12&sync=1')}catch{}
  await checkPendingFeedback();
}
async function boot(){
  if(booted)return;booted=true;
  const completed=await refreshDailyCheckin(true);
  if(completed)setTimeout(checkPendingFeedback,500);
  setTimeout(refreshIntervalsThenFeedback,1800);
  const refresh=$('refreshAthleteActivities');if(refresh)refresh.addEventListener('click',()=>setTimeout(checkPendingFeedback,2500));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible')return;
    const newDay=lastCheckinFetchDay!==localDay();
    if(newDay)setTimeout(()=>refreshDailyCheckin(true),250);
    else setTimeout(checkPendingFeedback,800);
  });
  document.addEventListener('runflow:open-morning-checkin',()=>refreshDailyCheckin(true));
  setInterval(()=>{
    if(lastCheckinFetchDay!==localDay()&&document.visibilityState==='visible')refreshDailyCheckin(true);
    else checkPendingFeedback();
  },5*60*1000);
}
function wait(){
  let ready=false;try{ready=Boolean(state?.athlete&&$('todayView'))}catch{}
  if(ready)boot();else if(!booted)setTimeout(wait,500);
}
document.addEventListener('runflow:athlete-dashboard-ready',boot);
installCheckinAction();
boot();
})();
