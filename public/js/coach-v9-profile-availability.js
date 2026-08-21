(() => {
  'use strict';
  const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const DAYS=[[1,'Lun'],[2,'Mar'],[3,'Mié'],[4,'Jue'],[5,'Vie'],[6,'Sáb'],[7,'Dom']];
  const athleteId=()=>q('#athleteSelect')?.value||'';
  const api=async(url,opt={})=>{const r=await fetch(url,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo completar la operación.');return d};
  function notify(text,type='success'){try{showMessage(text,type)}catch{alert(text)}}
  function dayRow(day,stored={},externalDays=[],strengthMode='runflow'){
    const strength=stored.strength===true||(strengthMode==='external'&&externalDays.includes(day[0]));
    const can=stored.can_train!==false;
    const run=stored.run!==false&&can;
    const bike=stored.bike===true&&can;
    return `<div class="v9-h-availability-row" data-v9h-day="${day[0]}"><b>${day[1]}</b><label><input type="checkbox" data-v9h-run ${run?'checked':''}> Correr</label><label><input type="checkbox" data-v9h-bike ${bike?'checked':''}> Bici</label><label class="wide">Tiempo máx. <input type="number" min="0" step="5" data-v9h-minutes value="${stored.max_minutes??''}" placeholder="min"></label><label><input type="checkbox" data-v9h-strength ${strength?'checked':''}> Fuerza</label><label><input type="checkbox" data-v9h-mountain ${stored.mountain?'checked':''}> Montaña</label></div>`;
  }
  async function render(){
    const id=athleteId(),root=q('#profileView .stack')||q('#profileView');if(!id||!root)return;
    let data;try{data=await api(`/api/v9/coach/athletes/${encodeURIComponent(id)}/dynamic-profile`)}catch(e){console.warn(e);return}
    let card=q('#v9HierarchyAvailability');if(!card){card=document.createElement('section');card.id='v9HierarchyAvailability';card.className='card v9-h-availability-card';root.prepend(card)}
    const map=new Map((data.availability?.days||[]).map(x=>[Number(x.day),x]));
    card.innerHTML=`<div class="card-head"><div><p class="eyebrow">V9 · Disponibilidad semanal</p><h2>Qué puede hacer cada día</h2><p>Esta matriz condiciona la generación de sesiones de cada microciclo.</p></div></div><div class="card-body"><p class="v9-h-profile-note">Marca correr, bici y/o fuerza. El tiempo máximo se respeta para cualquier sesión automática. Montaña indica que ese día admite sesiones que requieren terreno trail.</p><div class="v9-av-head"><span>Día</span><span>Correr</span><span>Bici</span><span>Tiempo máximo</span><span>Fuerza</span><span>Montaña</span></div>${DAYS.map(d=>dayRow(d,map.get(d[0])||{},data.external_strength_days||[],data.strength_mode)).join('')}<div class="v9-strength-mode" style="margin-top:14px"><strong>Quién programa la fuerza</strong><label><input type="radio" name="v9hStrengthMode" value="runflow" ${data.strength_mode!=='external'?'checked':''}> RunFlow selecciona la sesión de fuerza</label><label><input type="radio" name="v9hStrengthMode" value="external" ${data.strength_mode==='external'?'checked':''}> Fuerza externa / gimnasio: RunFlow reserva el hueco, sin prescribir ejercicios</label></div><div class="v9-load-ceiling" style="margin-top:14px"><label>Carga máxima semanal actual<input id="v9hMaxLoad" type="number" min="0" value="${data.max_load??''}"></label><label>Fecha efectiva<input id="v9hEffectiveDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label></div><div class="actions" style="margin-top:14px"><button id="v9hSaveAvailability" class="btn primary" type="button">Guardar disponibilidad</button></div></div>`;
    q('#v9DynamicProfile')?.classList.add('hidden');
    q('#v9hSaveAvailability').onclick=save;
  }
  async function save(){
    const id=athleteId();if(!id)return;
    const mode=q('input[name="v9hStrengthMode"]:checked')?.value||'runflow';
    const rows=qa('[data-v9h-day]',q('#v9HierarchyAvailability'));
    const days=rows.map(r=>{const run=q('[data-v9h-run]',r).checked,bike=q('[data-v9h-bike]',r).checked,strength=q('[data-v9h-strength]',r).checked;return{day:Number(r.dataset.v9hDay),can_train:run||bike||strength,run,bike,strength,max_minutes:q('[data-v9h-minutes]',r).value===''?null:Number(q('[data-v9h-minutes]',r).value),mountain:q('[data-v9h-mountain]',r).checked,gym:strength}});
    const external_strength_days=mode==='external'?days.filter(x=>x.strength).map(x=>x.day):[];
    const payload={availability:{days,strength_mode:mode,external_strength_days},strength_mode:mode,external_strength_days,max_load:q('#v9hMaxLoad').value===''?null:Number(q('#v9hMaxLoad').value),effective_date:q('#v9hEffectiveDate').value};
    try{await api(`/api/v9/coach/athletes/${encodeURIComponent(id)}/dynamic-profile`,{method:'PUT',body:JSON.stringify(payload)});notify('Disponibilidad semanal guardada. El planificador V9 la usará al generar sesiones.');window.dispatchEvent(new CustomEvent('runflow:v9-availability-saved',{detail:{athleteId:id}}));await render()}catch(e){notify(e.message,'error')}
  }
  function onView(){if(q('#profileView')?.classList.contains('active'))render()}
  document.addEventListener('click',e=>{if(e.target.closest('[data-v8-view="profile"],[data-view="profile"]'))setTimeout(onView,100)},true);
  window.addEventListener('runflow:v9-view',e=>{if(e.detail?.view==='profileView')render()});
  window.addEventListener('runflow:v9-dynamic-ready',()=>setTimeout(render,0));
})();
