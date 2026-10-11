(()=>{
  'use strict';
  // Readiness diario en RunFlow Fútbol: mismo check-in que la app de running (/api/v2/athlete/daily-checkin),
  // que se pregunta al abrir la app cada día hasta que el deportista lo rellena.
  if(window.__rfFootballReadinessInstalled)return;
  window.__rfFootballReadinessInstalled=true;

  const $=selector=>document.querySelector(selector);
  const LABELS={1:'Muy fatigado',2:'Fatigado',3:'Normal',4:'Recuperado',5:'Muy recuperado'};
  const FEELING={5:'muy_bien',4:'bien',3:'normal',2:'mal',1:'mal'};
  const MOOD={5:'Genial',4:'Bien',3:'Regular',2:'Mal',1:'Mal'};
  let bundle=null,lastFetchDay=null,selected=null,dismissedDay=null;

  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'No se pudo conectar con RunFlow.');
    return data;
  }
  function localDay(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function toast(text){const el=$('#toast');if(!el)return;el.textContent=text;el.classList.add('show');clearTimeout(window.__rfReadinessToast);window.__rfReadinessToast=setTimeout(()=>el.classList.remove('show'),2200);}

  function modal(){
    let el=$('#footballReadiness');
    if(el)return el;
    const style=document.createElement('style');
    style.textContent=`#footballReadiness .rf-scale{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:12px 0}
#footballReadiness .rf-scale button{border:1px solid var(--line);border-radius:14px;background:#071724;color:#c8d8e3;min-height:74px;padding:8px 2px;font-size:10px;font-weight:800}
#footballReadiness .rf-scale b{display:block;font-size:20px;margin-bottom:4px;color:white}
#footballReadiness .rf-scale button.active{outline:2px solid var(--blue);background:#0b2739;color:white}
#footballReadiness textarea{width:100%;min-height:70px;border-radius:12px;border:1px solid var(--line);background:#071724;color:white;padding:9px;resize:vertical}
#footballReadiness .eyebrow{margin-bottom:4px}
#footballReadiness .rf-note{font-size:11px;color:var(--muted);margin-top:8px}`;
    document.head.appendChild(style);
    el=document.createElement('div');el.id='footballReadiness';el.className='modal';
    el.innerHTML=`<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="footballReadinessTitle">
  <div class="eyebrow">Readiness diario</div><h2 id="footballReadinessTitle">¿Cómo te encuentras hoy?</h2>
  <div class="muted">Valora tu recuperación / fatiga de hoy. Tu entrenador lo verá en RunFlow.</div>
  <div class="rf-scale">${[1,2,3,4,5].map(n=>`<button type="button" data-score="${n}"><b>${n}</b>${LABELS[n]}</button>`).join('')}</div>
  <label class="muted" for="footballReadinessComment">Comentario opcional</label>
  <textarea id="footballReadinessComment" maxlength="1200" placeholder="Ej.: he dormido mal, piernas cargadas, me encuentro muy bien…"></textarea>
  <div class="rf-note" id="footballReadinessNote"></div>
  <div class="sheet-actions"><button class="secondary" id="footballReadinessLater" type="button">Ahora no</button><button class="primary" id="footballReadinessSave" type="button" disabled>Guardar</button></div>
</div>`;
    document.body.appendChild(el);
    el.querySelectorAll('[data-score]').forEach(button=>button.addEventListener('click',()=>{selected=Number(button.dataset.score);paintSelection();}));
    $('#footballReadinessLater').addEventListener('click',()=>{dismissedDay=localDay();el.classList.remove('show');});
    $('#footballReadinessSave').addEventListener('click',save);
    return el;
  }
  function paintSelection(){
    const el=modal();
    el.querySelectorAll('[data-score]').forEach(button=>button.classList.toggle('active',Number(button.dataset.score)===selected));
    $('#footballReadinessSave').disabled=!selected;
  }
  function open(){
    const el=modal(),today=bundle?.today||null,stats=bundle?.stats||{};
    selected=today?Number(today.recovery_score):null;
    $('#footballReadinessComment').value=today?.comment||'';
    $('#footballReadinessSave').textContent=today?'Actualizar':'Guardar';
    $('#footballReadinessNote').textContent=Number(stats.count)>0&&Number.isFinite(Number(stats.baseline_mean))
      ?`Tu media personal es ${Number(stats.baseline_mean).toFixed(1)}/5.`:'Con tus respuestas iremos construyendo tu nivel habitual.';
    paintSelection();el.classList.add('show');
  }

  function renderHome(){
    const today=bundle?.today;if(!today)return;
    const score=Number(today.recovery_score),value=$('#moodValue');
    if(value)value.textContent=`${score}/5 · ${LABELS[score]||''}`;
    document.querySelectorAll('.mood').forEach(button=>button.classList.toggle('selected',button.dataset.label===MOOD[score]));
  }

  async function save(){
    if(!selected)return;
    const button=$('#footballReadinessSave');button.disabled=true;button.textContent='Guardando…';
    try{
      const score=selected;
      bundle=await api('/api/v2/athlete/daily-checkin',{method:'POST',body:JSON.stringify({recovery_score:score,comment:$('#footballReadinessComment').value})});
      // También queda en el bienestar de fútbol que ve el coach en el panel Fútbol.
      api('/api/athlete/football/wellbeing',{method:'POST',body:JSON.stringify({feeling:FEELING[score],energy:score,soreness:6-score,title:'Readiness diario'})}).catch(error=>console.warn('[RunFlow Fútbol] bienestar',error));
      lastFetchDay=localDay();
      modal().classList.remove('show');renderHome();toast('Readiness de hoy guardado');
      document.dispatchEvent(new CustomEvent('runflow:daily-checkin-saved',{detail:{day:lastFetchDay}}));
    }catch(error){toast(error.message);button.disabled=false;}
    finally{button.textContent=bundle?.today?'Actualizar':'Guardar';}
  }

  async function refresh(forcePrompt=false){
    try{
      bundle=await api('/api/v2/athlete/daily-checkin');
      lastFetchDay=localDay();
      document.dispatchEvent(new CustomEvent('runflow:daily-checkin-state',{detail:{day:lastFetchDay,completed:Boolean(bundle?.today)}}));
      renderHome();
      if(forcePrompt||(!bundle?.today&&dismissedDay!==localDay()&&document.visibilityState==='visible'))open();
    }catch(error){console.warn('[RunFlow Fútbol] readiness',error.message);}
  }

  // Las respuestas rápidas de la tarjeta "¿Cómo estás hoy?" también cuentan como readiness del día.
  document.addEventListener('runflow:daily-checkin-saved',event=>{if(event.detail?.source==='mood-card')setTimeout(()=>refresh(false),300);});
  document.addEventListener('runflow:open-morning-checkin',()=>refresh(true));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&lastFetchDay!==localDay())setTimeout(()=>refresh(false),250);});
  setInterval(()=>{if(lastFetchDay!==localDay()&&document.visibilityState==='visible')refresh(false);},5*60*1000);
  window.RunFlowFootballReadiness={open:()=>refresh(true)};
  setTimeout(()=>refresh(false),600);
})();
