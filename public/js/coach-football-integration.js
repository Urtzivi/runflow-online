(()=>{
  const byId=id=>document.getElementById(id);
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo completar la operación.');return d;}
  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const catalog=()=>window.RunFlowFootballCatalog||null;
  function selectedAthleteId(){return byId('athleteSelect')?.value||'';}
  function addDays(day,amount){const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);}
  function dayLabel(day){return new Intl.DateTimeFormat('es-ES',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));}
  let photoUrl=null;

  function ensurePanel(){
    if(byId('footballCoachPanel'))return;
    const summary=document.getElementById('summaryView');
    if(!summary)return;
    const panel=document.createElement('section');panel.id='footballCoachPanel';panel.className='card';panel.style.marginTop='18px';
    panel.innerHTML=`<div class="card-head"><div style="display:flex;gap:14px;align-items:center"><img id="footballCoachPhoto" alt="" style="display:none;width:64px;height:64px;border-radius:50%;object-fit:cover"><div><p class="eyebrow">Módulo específico</p><h2>Fútbol</h2><p id="footballCoachProfile">Bienestar, carga, RPE, partidos y fuerza del deportista.</p></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><a id="footballAthleteLink" class="btn soft hidden" href="/football" target="_blank" rel="noopener">Abrir Athlete Fútbol</a><button id="footballModeButton" class="btn secondary" type="button">Activar Fútbol</button></div></div>
<div class="card-body">
  <div class="grid grid-4"><article class="metric"><span>Carga 7 días</span><strong id="footballCoachLoad">—</strong><small>min × RPE</small></article><article class="metric"><span>Agudo : crónico</span><strong id="footballCoachAcwr">—</strong><small id="footballCoachAcwrNote">7 días vs media 28</small></article><article class="metric"><span>RPE medio</span><strong id="footballCoachRpe">—</strong><small>7 días</small></article><article class="metric"><span>Fútbol · partidos</span><strong id="footballCoachSessions">—</strong><small>7 días</small></article></div>
  <p id="footballCoachStatus" class="muted small" style="margin:12px 0 0">Selecciona un deportista.</p>
  <p class="muted small" style="margin:6px 0 0">Los entrenamientos que publiques en el plan semanal aparecen en “Sesión de hoy” de su app.</p>
  <div id="footballCoachDetails" class="hidden"><div style="display:grid;gap:18px;margin-top:18px">
    <div><h3 style="margin:0 0 8px">Juegos del día</h3><div id="footballCoachGames" class="table-wrap"></div></div>
    <div><h3 style="margin:0 0 8px">Actividad reciente</h3><div id="footballCoachActivity" class="table-wrap"></div></div>
    <div><h3 style="margin:0 0 8px">Tests y métricas</h3><div id="footballCoachTests" class="table-wrap"></div></div>
    <div><h3 style="margin:0 0 8px">Bienestar (14 días)</h3><div id="footballCoachWellness"></div></div>
  </div></div>
</div>`;
    summary.appendChild(panel);
    byId('footballModeButton').addEventListener('click',toggleMode);
  }

  function table(head,rows,empty){
    if(!rows.length)return `<p class="muted small">${esc(empty)}</p>`;
    return `<table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  function renderGames(state,recent){
    const cat=catalog();if(!cat){byId('footballCoachGames').innerHTML='<p class="muted small">Catálogo de juegos no disponible.</p>';return;}
    const today=cat.localDay(),challenges=state?.challenges||{};
    const logged=new Map((recent||[]).filter(item=>item.kind==='challenge').map(item=>[`${item.activity_date}|${item.challenge_id}`,item]));
    const rows=[];
    for(let offset=-6;offset<=3;offset+=1){
      const day=addDays(today,offset);
      cat.dailyChallenges(day).forEach((game,index)=>{
        const key=`${day}|${game.id}`,done=challenges[key]?.done||logged.has(key),result=challenges[key]?.result||logged.get(key)?.challenge_result||'';
        const status=day>today?'<span class="muted">Próximo</span>':done?'<strong>✓ Hecho</strong>':day===today?'Pendiente':'<span class="muted">No hecho</span>';
        rows.push([index?'':`<strong>${esc(dayLabel(day))}</strong>${day===today?' · hoy':''}`,esc(game.type),`${esc(game.title)}<br><small class="muted">${esc(game.time)} · ${esc(game.material)}</small>`,status,esc(result)]);
      });
    }
    byId('footballCoachGames').innerHTML=table(['Día','Tipo','Juego','Estado','Resultado'],rows,'');
  }
  function renderActivity(recent){
    const labels={football_training:'Fútbol',strength:'Fuerza',match:'Partido',challenge:'Reto',wellbeing:'Bienestar'};
    const rows=(recent||[]).filter(item=>item.kind!=='wellbeing').slice(0,12).map(item=>{
      const minutes=item.kind==='match'?item.minutes_played:item.duration_min;
      return [esc(dayLabel(item.activity_date||String(item.created_at).slice(0,10))),esc(labels[item.kind]||item.kind),esc(item.title||''),minutes?esc(`${minutes} min`):'—',item.rpe??'—',item.load||'—',esc(item.note||item.challenge_result||'')];
    });
    byId('footballCoachActivity').innerHTML=table(['Fecha','Tipo','Sesión','Minutos','RPE','Carga','Nota'],rows,'Todavía no hay actividad registrada.');
  }
  function renderTests(state){
    const cat=catalog(),results=state?.results||{};
    const rows=(cat?.TESTS||[]).flatMap(test=>{
      const list=results[test.id]||[];if(!list.length)return [];
      const last=list[list.length-1],previous=list.length>1?list[list.length-2]:null;
      const values=test.fields.map(([key,label])=>Number.isFinite(Number(last.values?.[key]))?`${esc(label)}: <strong>${esc(last.values[key])}</strong>${previous&&Number.isFinite(Number(previous.values?.[key]))?` <small class="muted">(antes ${esc(previous.values[key])})</small>`:''}`:'').filter(Boolean).join('<br>');
      return [[esc(test.area),esc(test.name),esc(dayLabel(last.date)),values,String(list.length)]];
    });
    byId('footballCoachTests').innerHTML=table(['Área','Test','Último','Valores','Registros'],rows,'Todavía no ha registrado tests.');
  }
  function renderWellness(state){
    const cat=catalog(),today=cat?cat.localDay():new Date().toISOString().slice(0,10),wellness=state?.wellness||{};
    const colors={Genial:'#20a464',Bien:'#6cc04a',Regular:'#e0a400',Mal:'#d9534f'};
    const cells=[];for(let offset=-13;offset<=0;offset+=1){const day=addDays(today,offset),mood=wellness[day]?.mood||'';cells.push(`<div title="${esc(dayLabel(day))}${mood?` · ${esc(mood)}`:''}" style="flex:1;min-width:0;text-align:center"><div style="height:26px;border-radius:6px;background:${colors[mood]||'rgba(127,127,127,.18)'}"></div><small class="muted">${esc(day.slice(8))}</small></div>`);}
    byId('footballCoachWellness').innerHTML=`<div style="display:flex;gap:4px">${cells.join('')}</div><p class="muted small" style="margin:6px 0 0">Verde: genial/bien · amarillo: regular · rojo: mal · gris: sin respuesta.</p>`;
  }
  async function loadPhoto(athleteId,hasPhoto){
    const img=byId('footballCoachPhoto');if(!img)return;
    if(photoUrl){URL.revokeObjectURL(photoUrl);photoUrl=null;}
    img.style.display='none';
    if(!hasPhoto)return;
    const response=await fetch(`/api/coach/athletes/${encodeURIComponent(athleteId)}/football-photo`,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok||selectedAthleteId()!==athleteId)return;
    photoUrl=URL.createObjectURL(await response.blob());img.src=photoUrl;img.style.display='';
  }
  async function load(){
    ensurePanel();const athleteId=selectedAthleteId();if(!athleteId)return;
    try{
      const data=await api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/football-summary`);
      if(selectedAthleteId()!==athleteId)return;
      byId('footballModeButton').textContent=data.mode?'Fútbol activado ✓':'Activar Fútbol';
      byId('footballModeButton').className=`btn ${data.mode?'soft':'secondary'}`;
      byId('footballAthleteLink')?.classList.toggle('hidden',!data.mode);
      byId('footballCoachDetails')?.classList.toggle('hidden',!data.mode);
      const weekLoad=Number(data.week?.load||0),chronic=Number(data.days28?.load||0)/4;
      byId('footballCoachLoad').textContent=Math.round(weekLoad);
      byId('footballCoachAcwr').textContent=chronic>0?(weekLoad/chronic).toFixed(2):'—';
      byId('footballCoachAcwrNote').textContent=chronic>0?(weekLoad/chronic>1.5?'Pico de carga':weekLoad/chronic<0.8?'Carga baja':'Zona estable'):'Sin datos de 28 días';
      byId('footballCoachRpe').textContent=data.week?.avg_rpe??'—';
      byId('footballCoachSessions').textContent=`${data.week?.football??0} · ${data.week?.matches??0}`;
      const last=data.last_wellbeing;byId('footballCoachStatus').textContent=last?`Último bienestar: ${last.feeling||'—'} · ${new Date(last.created_at).toLocaleDateString('es-ES')}`:'Sin bienestar registrado todavía.';
      const profile=data.state?.profile||{};
      byId('footballCoachProfile').textContent=[profile.position,profile.team,profile.category].filter(Boolean).join(' · ')||'Bienestar, carga, RPE, partidos y fuerza del deportista.';
      if(data.mode){renderGames(data.state,data.recent);renderActivity(data.recent);renderTests(data.state);renderWellness(data.state);}
      loadPhoto(athleteId,data.has_photo).catch(()=>{});
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
