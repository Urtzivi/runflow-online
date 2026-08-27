(() => {
'use strict';
const $=id=>document.getElementById(id);
let checkinBundle=null,feedbackPrompted=false,booted=false;

async function rfApi(url,opt={}){
  const response=await fetch(url,{credentials:'same-origin',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'No se pudo completar la operación.');
  return data;
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
  let selected=null;
  el.querySelectorAll('[data-rf-score]').forEach(button=>button.addEventListener('click',()=>{
    selected=Number(button.dataset.rfScore);
    el.querySelectorAll('[data-rf-score]').forEach(x=>x.classList.toggle('active',x===button));
    $('rfMorningSave').disabled=false;
  }));
  const close=()=>{el.classList.add('hidden');setTimeout(checkPendingFeedback,400)};
  $('rfMorningLater').addEventListener('click',close);
  $('rfMorningSkip').addEventListener('click',close);
  $('rfMorningSave').addEventListener('click',async()=>{
    if(!selected)return;
    const save=$('rfMorningSave');save.disabled=true;save.textContent='Guardando…';
    try{
      checkinBundle=await rfApi('/api/v2/athlete/daily-checkin',{method:'POST',body:JSON.stringify({recovery_score:selected,comment:$('rfMorningComment').value})});
      renderSubjective();
      el.classList.add('hidden');
      try{if(typeof message==='function')message('Sensación de hoy guardada.','success')}catch{}
      setTimeout(checkPendingFeedback,400);
    }catch(error){save.disabled=false;try{if(typeof message==='function')message(error.message,'error')}catch{alert(error.message)}}
    finally{save.textContent='Guardar cómo me encuentro'}
  });
  return el;
}
function renderSubjective(){
  if(!checkinBundle)return;
  const card=document.querySelector('.athlete-mini-card.recovery');
  if(!card)return;
  let line=$('runflowSubjectiveRecovery');
  if(!line){line=document.createElement('div');line.id='runflowSubjectiveRecovery';line.className='rf-subjective-line';card.appendChild(line)}
  const today=checkinBundle.today,stats=checkinBundle.stats||{};
  if(!today){line.innerHTML='<span>Tu sensación</span><strong>Sin registrar hoy</strong>';return}
  const delta=Number(stats.delta_vs_baseline),deltaText=Number.isFinite(delta)&&Number(stats.count)>1?` · ${delta>0?'+':''}${delta.toFixed(1)} vs tu media`:'';
  line.innerHTML=`<span>Tu sensación</span><strong>${today.recovery_score}/5 · ${esc(subjectiveLabel(today.recovery_score))}</strong><small>${Number.isFinite(Number(stats.baseline_mean))?`Media personal ${Number(stats.baseline_mean).toFixed(1)}${deltaText}`:'Construyendo tu referencia personal'}</small>`;
}
function showMorning(){
  const el=modal(),stats=checkinBundle?.stats||{};
  const note=$('rfMorningBaseline');
  if(note)note.textContent=Number(stats.count)>0&&Number.isFinite(Number(stats.baseline_mean))?`Tu media personal hasta ahora es ${Number(stats.baseline_mean).toFixed(1)}/5. RunFlow comparará cada día contigo mismo, no con una media genérica.`:'Con tus respuestas iremos construyendo tu nivel habitual de recuperación.';
  el.classList.remove('hidden');
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
  try{
    checkinBundle=await rfApi('/api/v2/athlete/daily-checkin');
    renderSubjective();
    if(!checkinBundle.today)showMorning();
    else setTimeout(checkPendingFeedback,500);
    setTimeout(refreshIntervalsThenFeedback,1800);
  }catch(error){console.warn('[RunFlow Learning] check-in',error.message)}
  const refresh=$('refreshAthleteActivities');if(refresh)refresh.addEventListener('click',()=>setTimeout(checkPendingFeedback,2500));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(checkPendingFeedback,800)});
  setInterval(checkPendingFeedback,5*60*1000);
}
function wait(attempt=0){
  let ready=false;try{ready=Boolean(state?.athlete&&$('todayView'))}catch{}
  if(ready)boot();else if(attempt<100)setTimeout(()=>wait(attempt+1),100);
}
wait();
})();
