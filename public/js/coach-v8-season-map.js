(() => {
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stateSafe=()=>{try{return window.state||state}catch{return null}};
  const parse=s=>s?new Date(`${String(s).slice(0,10)}T12:00:00`):null;
  const iso=d=>d&&Number.isFinite(d.getTime())?d.toISOString().slice(0,10):'';
  const addDays=(s,n)=>{const d=parse(s);if(!d)return'';d.setDate(d.getDate()+n);return iso(d)};
  const spanDays=(a,b)=>{const x=parse(a),y=parse(b);return x&&y?Math.max(1,Math.round((y-x)/86400000)+1):1};
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));

  function allGoals(){const s=stateSafe();const rows=[...(s?.plan?.goals||[]),...(s?.plan?.unassigned?.goals||[]),...(s?.athlete?.goals||[])];const seen=new Set();return rows.filter(x=>{const id=String(x?.id||'');if(!id||seen.has(id))return false;seen.add(id);return true})}
  function allMacros(){return stateSafe()?.plan?.macrocycles||[]}
  function guideMeta(notes){const out={};String(notes||'').split('\n').forEach(line=>{const i=line.indexOf(':');if(i<0)return;const k=line.slice(0,i).trim(),v=line.slice(i+1).trim();if(k==='Fase')out.phase=v;if(k==='Tipo')out.type=v;if(k==='Carga %')out.loadPct=v});return out}
  function seasonRange(){const s=stateSafe()?.plan?.season,macros=allMacros(),goals=allGoals();let start=s?.start_date||macros.map(x=>x.start_date).filter(Boolean).sort()[0]||'';let end=s?.end_date||macros.map(x=>x.end_date).filter(Boolean).sort().slice(-1)[0]||goals.map(x=>x.goal_date).filter(Boolean).sort().slice(-1)[0]||'';if(!start){const d=new Date();start=iso(new Date(d.getFullYear(),d.getMonth(),1,12))}if(!end)end=addDays(start,364);if(String(end)<String(start))end=addDays(start,364);return{start,end}}
  function position(date,start,end){const total=spanDays(start,end),offset=spanDays(start,date)-1;return clamp(offset/Math.max(1,total-1)*100,0,100)}
  function width(a,b,start,end){const total=spanDays(start,end);return Math.max(.8,clamp(spanDays(a,b)/total*100,0,100))}
  function monthTicks(start,end){const a=parse(start),b=parse(end),out=[];if(!a||!b)return out;let d=new Date(a.getFullYear(),a.getMonth(),1,12);while(d<=b){out.push({date:iso(d),label:new Intl.DateTimeFormat('es-ES',{month:'short'}).format(d)});d=new Date(d.getFullYear(),d.getMonth()+1,1,12)}return out}
  function objectiveForMacro(m){const id=m.goal_id||m.goalId||m.associated_goal_id;return allGoals().find(g=>String(g.id)===String(id))}
  function priority(g){return g?.priority_code||({Principal:'A',Secundario:'B'}[g?.priority])||g?.priority||'B'}

  function render(){
    const host=q('#weekView');if(!host)return;
    let box=q('#v8SeasonMap');if(!box){box=document.createElement('section');box.id='v8SeasonMap';box.className='card v8-season-map';const workspace=q('.calendar-workspace',host);host.insertBefore(box,workspace||host.firstChild)}
    const s=stateSafe(),season=s?.plan?.season,macros=allMacros(),goals=allGoals();
    if(!season&&!macros.length){box.innerHTML='<div class="card-head"><div><p class="eyebrow">Mapa de temporada</p><h2>Lógica global</h2></div></div><div class="card-body"><div class="empty-state">Crea una temporada y sus bloques para ver aquí la lógica global.</div></div>';return}
    const range=seasonRange(),ticks=monthTicks(range.start,range.end),today=new Date().toISOString().slice(0,10);
    const goalMarkers=goals.filter(g=>g.goal_date&&String(g.goal_date)>=range.start&&String(g.goal_date)<=range.end).map(g=>`<button class="v8-season-goal" style="left:${position(g.goal_date,range.start,range.end)}%" data-goal-id="${esc(g.id)}" title="${esc(g.name||'Objetivo')}"><span>${esc(priority(g))}</span><b>🏁</b></button>`).join('');
    const rows=macros.map(m=>{const g=objectiveForMacro(m),mesos=m.mesocycles||[];const mesoBars=mesos.map(me=>{const meta=guideMeta(me.notes),label=meta.phase?`${meta.phase} · ${me.name||me.primary_adaptation||'Meso'}`:(me.name||me.primary_adaptation||'Meso');return `<button class="v8-season-meso" style="left:${position(me.start_date,range.start,range.end)}%;width:${width(me.start_date,me.end_date,range.start,range.end)}%" data-meso-id="${esc(me.id)}" title="${esc(label)}"><b>${esc(meta.phase||me.name||'Meso')}</b><small>P1 ${esc(me.primary_adaptation||'—')}</small></button>`}).join('');const microBars=mesos.flatMap(me=>(me.microcycles||[]).map(mc=>{const meta=guideMeta(mc.notes);return `<button class="v8-season-micro" style="left:${position(mc.start_date,range.start,range.end)}%;width:${width(mc.start_date,mc.end_date,range.start,range.end)}%" data-micro-id="${esc(mc.id)}" data-start="${esc(mc.start_date)}" title="${esc(mc.name||mc.week_type||'Microciclo')}"><b>${esc(meta.type||mc.name||mc.week_type||'Semana')}</b><small>${esc(meta.loadPct?meta.loadPct+'%':Math.round(Number(mc.planned?.load||0))||'')}</small></button>`})).join('');return `<div class="v8-season-row"><div class="v8-season-label"><span>MACRO</span><strong>${esc(m.name||'Macrociclo')}</strong><small>${esc(m.start_date||'—')} → ${esc(m.end_date||'—')}${g?` · ${esc(priority(g))} ${esc(g.name)}`:''}</small></div><div class="v8-season-track"><div class="v8-season-macro" style="left:${position(m.start_date,range.start,range.end)}%;width:${width(m.start_date,m.end_date,range.start,range.end)}%"><span>${esc(m.name||'Macrociclo')}</span></div>${mesoBars}${microBars}</div></div>`}).join('');
    box.innerHTML=`<div class="card-head"><div><p class="eyebrow">Mapa de temporada</p><h2>${esc(season?.name||'Lógica global')}</h2><p>Objetivos → macrociclos → fases/mesociclos → microciclos. Haz clic en una semana para abrirla debajo en el calendario.</p></div><div class="actions"><span class="badge">${esc(range.start)} → ${esc(range.end)}</span><button class="btn soft small" id="v8SeasonMapPlan">Editar bloques</button></div></div><div class="card-body"><div class="v8-season-timeline"><div class="v8-season-months"><div></div>${ticks.map(t=>`<span style="left:${position(t.date,range.start,range.end)}%">${esc(t.label)}</span>`).join('')}</div><div class="v8-season-objectives">${goalMarkers}${today>=range.start&&today<=range.end?`<i class="v8-season-today" style="left:${position(today,range.start,range.end)}%"><span>Hoy</span></i>`:''}</div>${rows||'<div class="empty-state">Todavía no hay macrociclos.</div>'}</div><div class="v8-season-legend"><span><i class="macro"></i>Macrociclo</span><span><i class="meso"></i>Fase / mesociclo</span><span><i class="micro"></i>Microciclo</span><span>🏁 Objetivo</span></div></div>`;bind(box)
  }

  function bind(box){q('#v8SeasonMapPlan',box)?.addEventListener('click',()=>q('main.shell>.tabs [data-view="plan"]')?.click());qa('[data-micro-id]',box).forEach(b=>b.addEventListener('click',()=>openWeek(b.dataset.start)));qa('[data-meso-id]',box).forEach(b=>b.addEventListener('click',()=>openPlanEntity('edit-meso',b.dataset.mesoId)));qa('[data-goal-id]',box).forEach(b=>b.addEventListener('click',()=>openPlanEntity('edit-goal',b.dataset.goalId)))}
  function openPlanEntity(action,id){q('main.shell>.tabs [data-view="plan"]')?.click();setTimeout(()=>q(`[data-plan-action="${action}"][data-id="${CSS.escape(String(id))}"]`)?.click(),160)}
  function openWeek(start){if(!start)return;try{const d=parse(start);stateSafe().calendar.month=new Date(d.getFullYear(),d.getMonth(),1,12);if(typeof loadCalendarMonth==='function'){loadCalendarMonth(false).then(()=>{if(typeof selectCalendarWeek==='function')selectCalendarWeek(start,true);q('.calendar-workspace')?.scrollIntoView({behavior:'smooth',block:'start'})})}}catch{}}

  document.addEventListener('click',e=>{if(e.target.closest('[data-view="week"]'))setTimeout(render,180)},true);
  q('#athleteSelect')?.addEventListener('change',()=>setTimeout(render,150));
  document.addEventListener('DOMContentLoaded',render,{once:true});
  setTimeout(render,1200);
  window.RunFlowV8SeasonMap={render,openWeek};
})();
