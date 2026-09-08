(()=>{
  const byId=id=>document.getElementById(id);
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo completar la operación.');return d;}
  function selectedAthleteId(){return byId('athleteSelect')?.value||'';}
  function ensurePanel(){
    if(byId('footballCoachPanel'))return;
    const summary=document.getElementById('summaryView');
    if(!summary)return;
    const panel=document.createElement('section');panel.id='footballCoachPanel';panel.className='card';panel.style.marginTop='18px';
    panel.innerHTML=`<div class="card-head"><div><p class="eyebrow">Módulo específico</p><h2>Fútbol</h2><p>Bienestar, carga, RPE, partidos y fuerza del deportista.</p></div><button id="footballModeButton" class="btn secondary" type="button">Activar Fútbol</button></div><div class="card-body"><div class="grid grid-4"><article class="metric"><span>Carga 7 días</span><strong id="footballCoachLoad">—</strong><small>min × RPE</small></article><article class="metric"><span>RPE medio</span><strong id="footballCoachRpe">—</strong><small>7 días</small></article><article class="metric"><span>Fútbol</span><strong id="footballCoachSessions">—</strong><small>sesiones</small></article><article class="metric"><span>Partidos</span><strong id="footballCoachMatches">—</strong><small>7 días</small></article></div><p id="footballCoachStatus" class="muted small" style="margin:12px 0 0">Selecciona un deportista.</p></div>`;
    summary.appendChild(panel);
    byId('footballModeButton').addEventListener('click',toggleMode);
  }
  async function load(){
    ensurePanel();const athleteId=selectedAthleteId();if(!athleteId)return;
    try{
      const data=await api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/football-summary`);
      byId('footballModeButton').textContent=data.mode?'Fútbol activado ✓':'Activar Fútbol';
      byId('footballModeButton').className=`btn ${data.mode?'soft':'secondary'}`;
      byId('footballCoachLoad').textContent=Math.round(Number(data.week?.load||0));
      byId('footballCoachRpe').textContent=data.week?.avg_rpe??'—';
      byId('footballCoachSessions').textContent=data.week?.football??0;
      byId('footballCoachMatches').textContent=data.week?.matches??0;
      const last=data.last_wellbeing;byId('footballCoachStatus').textContent=last?`Último bienestar: ${last.feeling||'—'} · ${new Date(last.created_at).toLocaleDateString('es-ES')}`:'Sin bienestar registrado todavía.';
    }catch(error){byId('footballCoachStatus').textContent=error.message;}
  }
  async function toggleMode(){
    const athleteId=selectedAthleteId();if(!athleteId)return;
    const currently=byId('footballModeButton').textContent.includes('activado');
    try{await api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/football-mode`,{method:'POST',body:JSON.stringify({enabled:!currently})});await load();}catch(error){byId('footballCoachStatus').textContent=error.message;}
  }
  const start=()=>{ensurePanel();const select=byId('athleteSelect');if(select){select.addEventListener('change',()=>setTimeout(load,250));load();}else setTimeout(start,300);};
  start();
})();
