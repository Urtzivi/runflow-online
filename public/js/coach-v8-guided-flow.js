(() => {
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STORE='runflow-v8-guided-flow-v2';
  const STEP_LABELS=['Objetivo','Macro','Meso','Micro','Estímulo','Sesión'];
  let painting=false;

  // Exact planning routes recovered from Plan Lab v6.
  const ROUTES={
    '5K':{note:'Base → Umbral → VO₂max → Ritmo 5K → Taper. Pesan VO₂max, velocidad, economía, umbral y tolerancia al ritmo.',phases:[
      ['Preparación','Adaptación','Continuidad + fuerza',['Easy','Fuerza general','Técnica','Velocidad / economía']],
      ['Base','Aeróbico / Fuerza','Motor aeróbico + estructura',['Resistencia aeróbica','Fuerza','Economía de carrera']],
      ['Desarrollo I','Umbral','Umbral + economía',['Umbral','Economía de carrera']],
      ['Desarrollo II','VO₂max','Techo aeróbico',['VO₂max','Velocidad / economía']],
      ['Específica','Ritmo 5K','Ritmo + tolerancia + velocidad',['Ritmo 5K','Velocidad / economía','VO₂max']],
      ['Taper','Puesta a punto','Frescura + activación',['Eliminar fatiga','Mantener intensidad']]
    ]},
    '10K':{note:'Base → Umbral → Umbral + VO₂ → Ritmo 10K → Taper. El umbral gana protagonismo.',phases:[
      ['Preparación','Adaptación','Continuidad + fuerza',['Easy','Fuerza','Técnica']],
      ['Base','Aeróbico / Fuerza','Base + economía',['Resistencia aeróbica','Fuerza','Economía de carrera']],
      ['Desarrollo I','Umbral','Umbral',['Umbral','Economía de carrera']],
      ['Desarrollo II','Umbral + VO₂','Elevar techo sin perder sostén',['Umbral','VO₂max']],
      ['Específica','Ritmo 10K','Sostener ritmo de carrera',['Ritmo 10K','Umbral','Durability']],
      ['Taper','Puesta a punto','Frescura + intensidad',['Eliminar fatiga','Mantener intensidad']]
    ]},
    'Media maratón':{note:'Base → Umbral → Umbral + Durability → Específico HM → Taper. La durability empieza a ser decisiva.',phases:[
      ['Preparación','Adaptación','Continuidad + fuerza',['Easy','Fuerza','Técnica']],
      ['Base','Aeróbico / Fuerza','Volumen + estructura',['Resistencia aeróbica','Fuerza','Economía de carrera']],
      ['Desarrollo I','Umbral','Umbral',['Umbral','Economía de carrera']],
      ['Desarrollo II','Durability','Mantener rendimiento bajo fatiga',['Durability','Resistencia aeróbica']],
      ['Específica','Ritmo HM','Umbral específico + durability',['Ritmo HM','Umbral','Durability']],
      ['Taper','Puesta a punto','Frescura + ritmo',['Eliminar fatiga','Mantener intensidad']]
    ]},
    'Maratón':{note:'Base extensa → Volumen/Durability → Umbral → Específico maratón → Taper.',phases:[
      ['Preparación','Adaptación','Continuidad + fuerza',['Easy','Fuerza','Técnica']],
      ['Base extensa','Aeróbico / Fuerza','Volumen tolerable + economía',['Resistencia aeróbica','Fuerza','Economía de carrera']],
      ['Desarrollo I','Durability','Tiempo sobre pies + estabilidad',['Durability','Resistencia aeróbica']],
      ['Desarrollo II','Umbral soporte','Elevar capacidad de soporte',['Umbral','Economía de carrera']],
      ['Específica','Ritmo maratón','Ritmo + nutrición + fatiga',['Ritmo maratón','Durability','Nutrición']],
      ['Taper','Puesta a punto','Bajar fatiga manteniendo RM',['Eliminar fatiga','Mantener intensidad']]
    ]},
    'Trail corto':{note:'Base → Desarrollo fisiológico → Fuerza/Umbral subida → Trail específico → Taper.',phases:[
      ['Preparación','Adaptación','Fuerza + continuidad',['Easy','Fuerza','Técnica']],
      ['Base','Aeróbico / Fuerza','Motor + estructura',['Resistencia aeróbica','Fuerza','Economía de carrera']],
      ['Desarrollo','Umbral / VO₂ subida','Techo + fuerza específica',['Umbral','VO₂max','Capacidad de subida','Fuerza específica']],
      ['Específica I','Subida-bajada','Transiciones + técnica',['Capacidad de subida','Capacidad de bajada','Técnica trail']],
      ['Específica II','Ritmo de prueba','Rendimiento en terreno objetivo',['Esfuerzo competitivo','Durability específica','Terreno / tecnicidad']],
      ['Taper','Puesta a punto','Frescura + activación',['Eliminar fatiga','Mantener intensidad']]
    ]},
    'Trail largo':{note:'Base extensa → Fuerza/Durability → Desarrollo montaña → Volumen específico → Trail específico largo → Taper.',phases:[
      ['Preparación','Adaptación','Fuerza + continuidad',['Easy','Fuerza','Técnica']],
      ['Base extensa','Aeróbico / Fuerza','Volumen + estructura',['Resistencia aeróbica','Fuerza','Durability']],
      ['Desarrollo I','Durability','Tiempo sobre pies',['Durability','Resistencia aeróbica']],
      ['Desarrollo II','Fuerza montaña','Subida + power hiking + bajada',['Capacidad de subida','Power hiking','Capacidad de bajada','Fuerza específica']],
      ['Específica','Volumen específico','D+/D- + nutrición + terreno',['Durability específica','D+ / D-','Nutrición','Terreno / tecnicidad']],
      ['Taper','Puesta a punto','Recuperar sin perder especificidad',['Eliminar fatiga','Mantener intensidad']]
    ]}
  };

  // Exact session-family clues recovered from Plan Lab v6.
  const SESSIONS={
    'Easy':['30-90’ fácil según nivel y fase','Trail fácil por RPE/FC','Rodaje regenerativo'],
    'Fuerza':['Fuerza general','Fuerza máxima','Fuerza-resistencia'],
    'Fuerza general':['Fuerza general','Fuerza básica + core','Fuerza general de baja fatiga'],
    'Técnica':['Técnica de carrera','Strides suaves','Técnica trail'],
    'Resistencia aeróbica':['Easy','Long Easy','Progressive'],
    'Economía de carrera':['Strides','Cuestas 10-15”','100-200 m controlados','Carrera progresiva múltiple'],
    'Umbral':["3×8’","4×8’","3×10’","2×15’",'Tempo continuo','Cruise intervals','Cuesta larga próxima a umbral'],
    'VO₂max':["5-6×3’",'8×600 m','5-6×1000 m','Cuestas VO₂'],
    'Velocidad / economía':['Strides','Sprints cortos','Cuestas 10-15”','100-200 m controlados'],
    'Ritmo 5K':['5×1000','4×1200','3×1600','Escaleras','Bloques ritmo 5K'],
    'Ritmo 10K':['3×2 km','2×3 km','5-6×1 km','Bloques ritmo 10K'],
    'Ritmo HM':['3×3 km','2×5 km',"3×15’ ritmo HM",'Long Run con bloques HM'],
    'Ritmo maratón':['Long Run con bloques RM','2×6-8 km RM','Simulación de nutrición'],
    'Durability':['Long progresivo',"90’ + 20’ tempo",'Long Run + bloques finales','Bloques al final bajo fatiga'],
    'Durability específica':['Long Trail con final específico','Subidas después de 60-90’','Bajadas técnicas con fatiga previa','Ensayo nutrición/hidratación/material'],
    'Capacidad de subida':["6×2’ subida","5×3’ subida","4×5’ subida",'Intervalos verticales','Cuestas largas'],
    'Power hiking':['Power hiking en pendiente','Cuestas largas caminando fuerte','Bloques hiking bajo fatiga'],
    'Capacidad de bajada':['Downhill progresivo','Downhill técnico','Bajada bajo fatiga'],
    'Fuerza específica':['Fuerza-resistencia','Cuestas largas','Subida con fatiga'],
    'Técnica trail':['Series triangulares','Trail intervals','Downhill técnico'],
    'Esfuerzo competitivo':['Long Trail','Bloques race effort','Subida/bajada específica'],
    'Terreno / tecnicidad':['Trail intervals','Series triangulares','Bloques en terreno objetivo'],
    'D+ / D-':['Long Trail con D+/D- objetivo','Triangulares largas','Desnivel progresivo'],
    'Nutrición':['Ensayo de nutrición','Long Trail con estrategia de hidratación','Simulación de material'],
    'Eliminar fatiga':['Easy + strides','Race pace breve','Primer corto','Taper threshold bajo volumen'],
    'Mantener intensidad':['Race pace corto','Strides','Activación','Pequeños bloques específicos']
  };
  const PCT={Introducción:[65,60,70],Desarrollo:[75,70,82],Sobrecarga:[90,85,95],Consolidación:[65,60,72],Descarga:[50,45,55],Taper:[45,35,55],Competición:[75,60,90],Recuperación:[35,25,45]};
  const MICRO_API={Introducción:'adaptation',Desarrollo:'development',Sobrecarga:'overload',Consolidación:'load',Descarga:'deload',Taper:'taper',Competición:'competition',Recuperación:'recovery'};

  function stateSafe(){try{return window.state||state}catch{return null}}
  function athleteId(){return q('#athleteSelect')?.value||q('#v8AthleteSelect')?.value||null}
  function unique(rows){const seen=new Set();return (rows||[]).filter(x=>{const id=String(x?.id||'');if(!id||seen.has(id))return false;seen.add(id);return true})}
  function goals(){const s=stateSafe();const plan=[...(s?.plan?.goals||[]),...(s?.plan?.unassigned?.goals||[])];return unique(plan.length?plan:(s?.athlete?.goals||[]))}
  function macros(){return stateSafe()?.plan?.macrocycles||[]}
  function mesos(){return macros().flatMap(m=>(m.mesocycles||[]).map(x=>({...x,_macro:m}))) }
  function micros(){return mesos().flatMap(m=>(m.microcycles||[]).map(x=>({...x,_meso:m,_macro:m._macro}))) }
  function season(){return stateSafe()?.plan?.season||null}
  function key(){return `${STORE}:${athleteId()||'default'}`}
  function read(){try{return JSON.parse(localStorage.getItem(key())||'{}')||{}}catch{return{}}}
  function write(v){try{localStorage.setItem(key(),JSON.stringify(v))}catch{}}
  function dateObj(s){return s?new Date(`${String(s).slice(0,10)}T12:00:00`):null}
  function isoDate(d){return d&&Number.isFinite(d.getTime())?d.toISOString().slice(0,10):''}
  function addDays(s,n){const d=dateObj(s);if(!d)return'';d.setDate(d.getDate()+n);return isoDate(d)}
  function after(a,b){return a&&b&&String(a)>String(b)}
  function goalPriority(g){return g?.priority_code||({Principal:'A',Secundario:'B'}[g?.priority])||g?.priority||'B'}
  function macroGoal(m){return m?.goal_id||m?.goalId||m?.associated_goal_id||''}
  function selectedGoal(f){return goals().find(g=>String(g.id)===String(f.goalId))}
  function selectedMacro(f){return macros().find(m=>String(m.id)===String(f.macroId))}
  function selectedMeso(f){return mesos().find(m=>String(m.id)===String(f.mesoId))}
  function selectedMicro(f){return micros().find(m=>String(m.id)===String(f.microId))}
  function route(f){return ROUTES[f.guideType]||ROUTES['10K']}
  function phase(f){const r=route(f);return r.phases.find(p=>p[0]===f.phase)||r.phases[0]}

  function inferGuideType(g){
    if(!g)return'10K';
    const t=[g.name,g.race_type,g.raceType,g.type,g.sport,g.surface].filter(Boolean).join(' ').toLowerCase();
    const km=Number(g.distance_km||g.distance||0),up=Number(g.elevation_m||g.elevation||0);
    const trail=/trail|ultra|monta|mountain/.test(t)||up>=500;
    if(trail)return /ultra/.test(t)||km>=30?'Trail largo':'Trail corto';
    if(/marat[oó]n/.test(t)&&!/media|half/.test(t))return'Maratón';
    if(/media|half/.test(t))return'Media maratón';
    if(/10\s?k/.test(t))return'10K';
    if(/5\s?k/.test(t))return'5K';
    if(km>0&&km<=6)return'5K';if(km>0&&km<=12)return'10K';if(km>0&&km<=25)return'Media maratón';if(km>25)return'Maratón';
    return'10K';
  }
  function demands(f){
    const g=selectedGoal(f),road={
      '5K':['VO₂max','Ritmo 5K','Velocidad','Economía de carrera','Tolerancia al ritmo'],
      '10K':['Umbral','Ritmo 10K','VO₂max','Economía de carrera','Durability'],
      'Media maratón':['Umbral','Ritmo media maratón','Economía de carrera','Durability','Tirada larga'],
      'Maratón':['Resistencia aeróbica','Ritmo maratón','Durability','Nutrición','Volumen específico']
    };
    if(road[f.guideType])return road[f.guideType];
    if(/^Trail/.test(f.guideType)){const a=['Resistencia aeróbica','Resistencia específica trail','Capacidad de subida','Capacidad de bajada','Durability específica','Fuerza específica','Economía de carrera','D+ / D-','Terreno / tecnicidad','Nutrición / hidratación','Esfuerzo competitivo'];const km=Number(g?.distance_km||g?.distance||0),up=Number(g?.elevation_m||g?.elevation||0);if(km&&up/km>45)a.push('Power hiking');return a}
    return['Resistencia aeróbica','Umbral','Economía de carrera'];
  }
  function compatibleMacros(f){const linked=macros().filter(m=>String(macroGoal(m))===String(f.goalId));return linked.length?linked:macros()}
  function compatibleMesos(f){return f.macroId?mesos().filter(m=>String(m._macro?.id||m.macrocycle_id||'')===String(f.macroId)):mesos()}
  function compatibleMicros(f){return f.mesoId?micros().filter(m=>String(m._meso?.id||m.mesocycle_id||'')===String(f.mesoId)):micros()}
  function maintainOptions(f){return [...new Set([...phase(f)[3],...demands(f),'Resistencia aeróbica','Fuerza','Economía de carrera','Durability','Velocidad / economía','Técnica trail'])].filter(x=>x&&x!==f.p1&&x!==f.p2)}
  function stimuli(f){return [...new Set([f.p1,f.p2,...(f.maintain||[]),'Easy','Fuerza'].filter(x=>x&&SESSIONS[x]))]}
  function microSequence(f){const n=Math.max(1,Math.min(12,Number(f.mesoWeeks)||4));const p=phase(f);if(/Taper/i.test(p[0])||p[1]==='Puesta a punto')return Array(n).fill('Taper');if(n===1)return['Consolidación'];if(n===2)return['Introducción','Consolidación'];if(n===3)return['Introducción','Desarrollo','Consolidación'];return Array.from({length:n},(_,i)=>i===0?'Introducción':i===n-1?'Consolidación':i===n-2?'Sobrecarga':'Desarrollo')}
  function freshDrafts(f){return microSequence(f).map((type,i)=>{const p=PCT[type]||PCT.Desarrollo;return{index:i+1,type,objective:i===microSequence(f).length-1?'Consolidar y revisar adaptación':f.p1,loadPct:p[0],low:p[1],high:p[2]}})}
  function ensureDrafts(f,force=false){const seq=microSequence(f);if(force||!Array.isArray(f.microDrafts)||f.microDrafts.length!==seq.length){f.microDrafts=freshDrafts(f);write(f)}return f.microDrafts}

  function hydrate(){
    const f=read(),gs=goals();
    if(!f.goalId||!gs.some(g=>String(g.id)===String(f.goalId)))f.goalId=gs[0]?.id||'';
    const g=selectedGoal(f);if(!f.guideType||!ROUTES[f.guideType])f.guideType=inferGuideType(g);
    const r=route(f);if(!f.phase||!r.phases.some(p=>p[0]===f.phase))f.phase=r.phases[0]?.[0]||'';
    if(!Number(f.maxLoad))f.maxLoad=Number(f.maxLoad)||0;
    const ms=compatibleMacros(f);if(f.macroId&&!macros().some(m=>String(m.id)===String(f.macroId)))f.macroId='';if(!f.macroId&&ms.length)f.macroId=ms[0].id;
    const p=phase(f);if(!f.p1||!p[3].includes(f.p1))f.p1=p[3][0]||'';if(f.p2===f.p1)f.p2='';
    f.mesoWeeks=Math.max(1,Math.min(12,Number(f.mesoWeeks)||4));
    if(!Array.isArray(f.maintain))f.maintain=[];f.maintain=f.maintain.filter(x=>x!==f.p1&&x!==f.p2);
    const mes=compatibleMesos(f);if(f.mesoId&&!mesos().some(m=>String(m.id)===String(f.mesoId)))f.mesoId='';
    const mic=compatibleMicros(f);if(f.microId&&!micros().some(m=>String(m.id)===String(f.microId)))f.microId='';if(!f.microId&&mic.length)f.microId=mic[0].id;
    ensureDrafts(f,false);
    const st=stimuli(f);if(!f.stimulus||!st.includes(f.stimulus))f.stimulus=st[0]||'Easy';const ss=SESSIONS[f.stimulus]||[];if(!f.session||!ss.includes(f.session))f.session=ss[0]||'';
    write(f);return f;
  }

  function opt(value,label,selected){return `<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label??value)}</option>`}
  function field(label,id,content,help=''){return `<label class="v8-flow-field"><span>${esc(label)}</span>${content}${help?`<small>${esc(help)}</small>`:''}</label>`}
  function sel(label,id,options,help=''){return field(label,id,`<select id="${id}">${options}</select>`,help)}
  function inp(label,id,value,type='text',help=''){return field(label,id,`<input id="${id}" type="${type}" value="${esc(value??'')}">`,help)}
  function ta(label,id,value,help=''){return field(label,id,`<textarea id="${id}">${esc(value??'')}</textarea>`,help)}
  function ctx(label,value){return `<div><span>${esc(label)}</span><b>${esc(value??'—')}</b></div>`}
  function chips(items){return `<div class="v8-flow-chips">${items.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`}
  function entityList(type,rows){if(!rows.length)return'<div class="v8-guided-empty">Todavía no hay elementos reales creados.</div>';return `<div class="v8-guided-real-list">${rows.map(x=>`<div class="v8-guided-real-row"><div><b>${esc(x.name||x.primary_adaptation||x.week_type||'Sin nombre')}</b><small>${esc(x.start_date||x.goal_date||'—')}${x.end_date?` → ${esc(x.end_date)}`:''}</small></div><button class="btn secondary small" type="button" data-guide-edit="${type}" data-id="${esc(x.id)}">Editar</button></div>`).join('')}</div>`}
  function routeBox(f){const r=route(f);return `<div class="v8-flow-route">${r.phases.map((p,i)=>`<button type="button" class="v8-flow-route-row ${p[0]===f.phase?'active':''}" data-flow-phase="${esc(p[0])}"><span>${i+1}</span><div><b>${esc(p[0])}</b><small>${esc(p[1])} · ${esc(p[2])}</small><em>${esc(p[3].join(' · '))}</em></div></button>`).join('')}</div>`}

  function objectiveBody(f){const gs=goals(),g=selectedGoal(f),r=route(f);if(!gs.length)return `<div class="v8-guided-card"><div class="eyebrow">1 · Objetivo y demanda</div><h3>Crea primero una competición u objetivo</h3><p>La guía no puede proponer fases ni capacidades si todavía no sabe qué exige la prueba.</p></div>`;return `<div class="v8-guided-card"><div class="eyebrow">1 · Competición → necesidades</div><h3>Objetivo y demanda real</h3><p>Este es el punto de partida del Lab v6: primero entendemos la prueba; después aparece la arquitectura compatible.</p><div class="v8-flow-grid">${sel('Objetivo existente','gfGoal',gs.map(x=>opt(x.id,`${goalPriority(x)} · ${x.name||'Objetivo'} · ${x.goal_date||'sin fecha'}`,f.goalId)).join(''))}${sel('Clasificación para la guía','gfGuideType',Object.keys(ROUTES).map(x=>opt(x,x,f.guideType)).join(''),'Corrígela si la propuesta automática no representa bien la prueba.')}${inp('100% carga semanal','gfMaxLoad',f.maxLoad||'','number','Referencia individual para convertir los porcentajes de microciclo en carga absoluta.')}</div><div class="v8-guided-context">${ctx('Prioridad',goalPriority(g))}${ctx('Distancia',g?.distance_km?`${g.distance_km} km`:'—')}${ctx('Desnivel',g?.elevation_m?`${g.elevation_m} m+`:'—')}</div><div class="v8-flow-guide"><strong>Demandas a considerar</strong>${chips(demands(f))}</div><div class="v8-flow-guide"><strong>La guía recomienda</strong><p>${esc(r.note)}</p></div>${routeBox(f)}<div class="v8-guided-section-title">Objetivos reales</div>${entityList('goal',gs)}</div><div class="v8-guided-warning"><strong>Regla maestra:</strong> nunca empezamos preguntándonos qué entrenamiento hacer esta semana. Primero definimos qué queremos conseguir.</div>`}

  function macroDefaults(f){const g=selectedGoal(f),s=season(),m=selectedMacro(f);if(m)return{name:m.name||'',start:m.start_date||'',end:m.end_date||'',objective:m.primary_objective||''};return{name:g?`Camino hacia ${g.name}`:'Macrociclo principal',start:s?.start_date||new Date().toISOString().slice(0,10),end:g?.goal_date||s?.end_date||'',objective:g?`Preparar ${g.name}`:''}}
  function macroBody(f){const rows=compatibleMacros(f),d=macroDefaults(f),r=route(f);return `<div class="v8-guided-card"><div class="eyebrow">2 · Objetivo → macrociclo</div><h3>Ruta completa hasta la competición</h3><p>El macrociclo es el camino global. La ruta del Lab sirve como arquitectura inicial editable, no como una obligación.</p><div class="v8-flow-grid">${sel('Macrociclo real','gfMacro',['<option value="">Nuevo macrociclo</option>',...rows.map(x=>opt(x.id,x.name||'Macrociclo',f.macroId))].join(''))}${inp('Nombre','gfMacroName',f.macroName??d.name)}${inp('Inicio','gfMacroStart',f.macroStart??d.start,'date')}${inp('Fin','gfMacroEnd',f.macroEnd??d.end,'date')}${inp('Objetivo principal','gfMacroObjective',f.macroObjective??d.objective)}</div><div class="v8-flow-guide"><strong>Ruta recomendada</strong><p>${esc(r.note)}</p></div>${routeBox(f)}<div class="v8-guided-section-title">Macrociclos reales</div>${entityList('macro',rows)}</div><div class="v8-guided-warning"><strong>Guía del macrociclo:</strong> puedes modificar duración y orden de fases, pero cada cambio debe seguir respondiendo a las demandas de la prueba.</div>`}

  function mesoBody(f){const p=phase(f),rows=compatibleMesos(f),maintain=maintainOptions(f),chosen=new Set(f.maintain||[]);return `<div class="v8-guided-card"><div class="eyebrow">3 · Fase → mesociclo → capacidad</div><h3>Crear / editar mesociclo</h3><p>Recuperamos aquí todas las pistas del Lab v6. Cada elección filtra la siguiente.</p><div class="v8-flow-grid">${sel('Mesociclo real','gfMeso',['<option value="">Nuevo mesociclo</option>',...rows.map(x=>opt(x.id,`${x.name||'Mesociclo'} · ${x.primary_adaptation||'—'}`,f.mesoId))].join(''))}${sel('Fase de la guía','gfPhase',route(f).phases.map(x=>opt(x[0],x[0],f.phase)).join(''))}${sel('Mesociclo recomendado','gfMesoType',opt(p[1],p[1],p[1]))}${inp('Duración prevista (semanas)','gfMesoWeeks',f.mesoWeeks,'number')}${sel('Prioridad 1','gfP1',p[3].map(x=>opt(x,x,f.p1)).join(''))}${sel('Prioridad 2','gfP2',['<option value="">Sin P2</option>',...p[3].filter(x=>x!==f.p1).map(x=>opt(x,x,f.p2))].join(''),'Opcional: solo si no interfiere con P1.')}</div><label class="v8-flow-field v8-flow-full"><span>Mantener</span><select id="gfMaintain" multiple size="6">${maintain.map(x=>`<option value="${esc(x)}" ${chosen.has(x)?'selected':''}>${esc(x)}</option>`).join('')}</select><small>Capacidades que no queremos perder durante este bloque.</small></label><div class="v8-flow-grid v8-flow-text-grid">${ta('Cambio esperado','gfExpected',f.expectedChange||'','Qué debería mejorar si el bloque funciona.')}${ta('Indicadores','gfIndicators',f.indicators||'','Qué observaremos para comprobar la adaptación.')}${ta('Criterio de éxito','gfSuccess',f.successCriteria||'','Qué tendría que ocurrir para considerar el mesociclo suficientemente conseguido.')}</div><div class="v8-flow-guide"><strong>${esc(p[0])} · ${esc(p[1])}</strong><p>Prioridad sugerida: ${esc(p[2])}.</p><small>Capacidades disponibles: ${esc(p[3].join(' · '))}</small></div><div class="v8-guided-section-title">Mesociclos reales del macro</div>${entityList('meso',rows)}</div><div class="v8-guided-warning"><strong>Regla del Lab:</strong> un mesociclo tiene P1, P2 opcional y capacidades a mantener. Duración prevista, nunca obligatoria.</div>`}

  function microBody(f){const rows=compatibleMicros(f),drafts=ensureDrafts(f,false),m=selectedMeso(f);return `<div class="v8-guided-card"><div class="eyebrow">4 · Mesociclo → microciclos</div><h3>Propuesta de semanas</h3><p>La propuesta sigue la lógica validada: presentar → desarrollar → sobrecargar solo si la respuesta lo permite → consolidar/absorber. No obliga a usar siempre 3+1.</p>${m?`<div class="v8-guided-context">${ctx('Mesociclo',m.name||m.primary_adaptation)}${ctx('P1',f.p1||m.primary_adaptation||'—')}${ctx('Semanas',f.mesoWeeks)}</div>`:'<div class="v8-guided-warning">Guarda o selecciona primero un mesociclo real.</div>'}<div class="v8-flow-micro-head"><span>Sem.</span><span>Tipo</span><span>Objetivo semanal</span><span>%</span><span>Mín</span><span>Máx</span></div><div id="gfMicroDrafts" class="v8-flow-micro-list">${drafts.map((d,i)=>`<div class="v8-flow-micro-row" data-draft="${i}"><b>S${d.index}</b><select data-df="type">${Object.keys(PCT).map(t=>opt(t,t,d.type)).join('')}</select><input data-df="objective" value="${esc(d.objective)}"><input data-df="loadPct" type="number" value="${d.loadPct}"><input data-df="low" type="number" value="${d.low}"><input data-df="high" type="number" value="${d.high}"></div>`).join('')}</div><div class="v8-flow-inline-actions"><button class="btn secondary small" type="button" id="gfRegenerateMicros">Regenerar propuesta guía</button></div><div class="v8-flow-guide"><strong>Referencia individual</strong><p>${f.maxLoad?`100% = ${esc(f.maxLoad)} de carga semanal. Ejemplo S1: ${Math.round(f.maxLoad*(drafts[0]?.loadPct||0)/100)} de carga objetivo.`:'El porcentaje puede planificarse aunque el 100% absoluto todavía no esté definido.'}</p></div><div class="v8-guided-section-title">Microciclos reales</div>${entityList('micro',rows)}</div><div class="v8-guided-warning"><strong>Progresión:</strong> no aumentamos simultáneamente volumen + intensidad + frecuencia + desnivel + dificultad.</div>`}

  function stimulusWhy(f){if(f.stimulus===f.p1)return`Es la P1 del mesociclo (${f.p1}), por eso recibe la mayor intención del bloque.`;if(f.stimulus===f.p2)return`Es la P2 (${f.p2}); solo debe trabajarse si no interfiere con P1.`;if(f.stimulus==='Easy')return'El EASY no es relleno: acumula volumen, consolida adaptaciones y permite que los días importantes sean productivos.';if(f.stimulus==='Fuerza')return'La fuerza se añade minimizando interferencias con las sesiones clave.';return'Es una capacidad de mantenimiento elegida para no perderla durante el bloque.'}
  function stimulusBody(f){const ms=compatibleMicros(f),st=stimuli(f),mc=selectedMicro(f);return `<div class="v8-guided-card"><div class="eyebrow">5 · Microciclo → estímulo</div><h3>Primero la necesidad semanal</h3><p>Selecciona el micro y el estímulo. RunFlow oculta el resto de la biblioteca y muestra solo familias compatibles.</p><div class="v8-flow-grid">${sel('Microciclo real','gfMicro',['<option value="">Selecciona microciclo</option>',...ms.map(x=>opt(x.id,`${x.name||x.week_type||'Semana'} · ${x.start_date||'—'}`,f.microId))].join(''))}${sel('Estímulo necesario','gfStimulus',st.map(x=>opt(x,x,f.stimulus)).join(''))}</div><div class="v8-flow-guide"><strong>Por qué aparece</strong><p>${esc(stimulusWhy(f))}</p></div><div class="v8-flow-session-cards">${(SESSIONS[f.stimulus]||[]).map(x=>`<button type="button" data-session-choice="${esc(x)}" class="${x===f.session?'active':''}"><b>${esc(x)}</b><small>Compatible con ${esc(phase(f)[1])} · ${esc(mc?.name||mc?.week_type||'micro')}.</small></button>`).join('')}</div><div class="v8-flow-guide"><strong>Orden de construcción del Lab</strong><p>1. P1 · 2. estímulo clave nº1 · 3. segundo estímulo si procede · 4. long/durability · 5. fuerza · 6. easy/recovery · 7. comprobar recuperación entre estímulos agresivos.</p></div></div>`}

  function sessionBody(f){const mc=selectedMicro(f),m=selectedMeso(f),d=(f.microDrafts||[]).find(x=>x.index===1)||{};return `<div class="v8-guided-card"><div class="eyebrow">6 · Estímulo → sesión</div><h3>Elegir una sesión compatible</h3><p>Ahora sí elegimos una sesión. Ha quedado filtrada por objetivo, fase, P1/P2, microciclo y estímulo.</p><div class="v8-flow-grid">${sel('Estímulo','gfSessionStimulus',stimuli(f).map(x=>opt(x,x,f.stimulus)).join(''))}${sel('Familia de sesión','gfSession',(SESSIONS[f.stimulus]||[]).map(x=>opt(x,x,f.session)).join(''))}</div><div class="v8-guided-context">${ctx('Objetivo',selectedGoal(f)?.name||'—')}${ctx('Fase',f.phase)}${ctx('Mesociclo',m?.name||phase(f)[1])}${ctx('P1',f.p1)}${ctx('Micro',mc?.name||mc?.week_type||'—')}${ctx('Carga guía',f.maxLoad&&d.loadPct?`${d.loadPct}% de ${f.maxLoad}`:'% editable')}</div><div class="v8-flow-final"><span>Necesidad</span><strong>${esc(f.stimulus)}</strong><span>Sesión elegida</span><strong>${esc(f.session||'—')}</strong><p><b>¿Por qué he elegido esta sesión concreta para producir la adaptación que necesito ahora?</b> Si no podemos responderlo, todavía no deberíamos colocarla.</p></div><div class="v8-flow-inline-actions"><button class="btn secondary small" type="button" id="gfOpenMicroCalendar">Abrir esta semana en calendario</button><button class="btn soft small" type="button" id="gfOpenLibrary">Abrir biblioteca filtrada</button><button class="btn primary small" type="button" id="gfOpenSeasonMap">Ver lógica global de temporada</button></div></div><div class="v8-guided-warning"><strong>Planificación bidireccional:</strong> PLAN → entrenamiento → respuesta del deportista → análisis → decisión → nuevo plan.</div>`}

  const bodies=[objectiveBody,macroBody,mesoBody,microBody,stimulusBody,sessionBody];
  function activeStep(){const b=q('#v8GuidedSteps .v8-guided-step-pill.active');return Math.max(0,Math.min(5,Number(b?.dataset.guideStep||0)))}
  function saveField(id,key,transform=(v)=>v){const e=q(`#${id}`);if(!e)return;e.addEventListener('change',()=>{const f=hydrate();f[key]=transform(e.value,f);write(f);paint()})}
  function collectDrafts(){const f=hydrate();qa('#gfMicroDrafts [data-draft]').forEach(row=>{const i=Number(row.dataset.draft),d=f.microDrafts[i];if(!d)return;const v=k=>row.querySelector(`[data-df="${k}"]`)?.value;d.type=v('type');d.objective=v('objective');d.loadPct=Number(v('loadPct'))||0;d.low=Number(v('low'))||0;d.high=Number(v('high'))||0});write(f);return f}

  function bind(index){
    saveField('gfGoal','goalId',(v,f)=>{f.guideType=inferGuideType(goals().find(g=>String(g.id)===String(v)));f.phase=ROUTES[f.guideType].phases[0][0];f.macroId='';f.mesoId='';f.microId='';f.microDrafts=[];return v});
    saveField('gfGuideType','guideType',(v,f)=>{f.phase=ROUTES[v].phases[0][0];f.p1='';f.p2='';f.maintain=[];f.mesoId='';f.microId='';f.microDrafts=[];return v});
    saveField('gfMaxLoad','maxLoad',v=>Number(v)||0);
    saveField('gfMacro','macroId',(v,f)=>{const m=macros().find(x=>String(x.id)===String(v));if(m){f.macroName=m.name||'';f.macroStart=m.start_date||'';f.macroEnd=m.end_date||'';f.macroObjective=m.primary_objective||''}else{delete f.macroName;delete f.macroStart;delete f.macroEnd;delete f.macroObjective}f.mesoId='';f.microId='';return v});
    saveField('gfMacroName','macroName');saveField('gfMacroStart','macroStart');saveField('gfMacroEnd','macroEnd');saveField('gfMacroObjective','macroObjective');
    saveField('gfMeso','mesoId',(v,f)=>{const m=mesos().find(x=>String(x.id)===String(v));if(m){f.p1=m.primary_adaptation||f.p1;const meta=parseGuideNotes(m.notes);if(meta.phase&&route(f).phases.some(p=>p[0]===meta.phase))f.phase=meta.phase;if(meta.weeks)f.mesoWeeks=meta.weeks;if(meta.p2)f.p2=meta.p2;if(meta.maintain)f.maintain=meta.maintain;if(meta.expected)f.expectedChange=meta.expected;if(meta.indicators)f.indicators=meta.indicators;if(m.success_criteria)f.successCriteria=m.success_criteria}f.microId='';f.microDrafts=[];return v});
    saveField('gfPhase','phase',(v,f)=>{f.p1='';f.p2='';f.maintain=[];f.microDrafts=[];return v});
    saveField('gfMesoWeeks','mesoWeeks',(v,f)=>{f.microDrafts=[];return Math.max(1,Math.min(12,Number(v)||4))});
    saveField('gfP1','p1',(v,f)=>{if(f.p2===v)f.p2='';f.microDrafts=[];return v});saveField('gfP2','p2',(v,f)=>{f.microDrafts=[];return v});
    saveField('gfExpected','expectedChange');saveField('gfIndicators','indicators');saveField('gfSuccess','successCriteria');
    q('#gfMaintain')?.addEventListener('change',()=>{const f=hydrate();f.maintain=qa('#gfMaintain option:checked').map(o=>o.value);f.microDrafts=[];write(f);paint()});
    qa('[data-flow-phase]').forEach(b=>b.addEventListener('click',()=>{const f=hydrate();f.phase=b.dataset.flowPhase;f.p1='';f.p2='';f.maintain=[];f.microDrafts=[];write(f);paint()}));
    qa('#gfMicroDrafts [data-df]').forEach(e=>e.addEventListener('change',()=>{if(e.dataset.df==='type'){const row=e.closest('[data-draft]'),p=PCT[e.value]||PCT.Desarrollo;row.querySelector('[data-df="loadPct"]').value=p[0];row.querySelector('[data-df="low"]').value=p[1];row.querySelector('[data-df="high"]').value=p[2]}collectDrafts()}));
    q('#gfRegenerateMicros')?.addEventListener('click',()=>{const f=hydrate();ensureDrafts(f,true);write(f);paint()});
    saveField('gfMicro','microId');saveField('gfStimulus','stimulus',(v,f)=>{f.session='';return v});
    qa('[data-session-choice]').forEach(b=>b.addEventListener('click',()=>{const f=hydrate();f.session=b.dataset.sessionChoice;write(f);paint()}));
    saveField('gfSessionStimulus','stimulus',(v,f)=>{f.session='';return v});saveField('gfSession','session');
    q('#gfOpenMicroCalendar')?.addEventListener('click',()=>openCalendarForMicro(hydrate().microId));
    q('#gfOpenLibrary')?.addEventListener('click',()=>openLibrary(hydrate().stimulus));
    q('#gfOpenSeasonMap')?.addEventListener('click',openSeasonMap);
    qa('[data-guide-edit]').forEach(b=>b.addEventListener('click',()=>openPlanEdit(b.dataset.guideEdit,b.dataset.id)));
  }

  function parseGuideNotes(notes){const out={};String(notes||'').split('\n').forEach(line=>{const [k,...rest]=line.split(':');const v=rest.join(':').trim();if(!v)return;if(k==='Fase')out.phase=v;if(k==='Semanas')out.weeks=Number(v)||0;if(k==='P2')out.p2=v==='—'?'':v;if(k==='Mantener')out.maintain=v==='—'?[]:v.split('|').map(x=>x.trim()).filter(Boolean);if(k==='Cambio esperado')out.expected=v;if(k==='Indicadores')out.indicators=v});return out}
  function guideNotes(f){return ['RUNFLOW_GUIDE_V6',`Tipo guía: ${f.guideType}`,`Fase: ${f.phase}`,`Semanas: ${f.mesoWeeks}`,`P2: ${f.p2||'—'}`,`Mantener: ${(f.maintain||[]).join(' | ')||'—'}`,`Cambio esperado: ${f.expectedChange||'—'}`,`Indicadores: ${f.indicators||'—'}`].join('\n')}
  function originalView(name){return q(`main.shell>.tabs [data-view="${name}"]`)}
  function close(){window.RunFlowV8Planner?.close?.()}
  async function callApi(url,options={}){if(typeof api==='function')return api(url,options);const r=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo guardar.');return d}
  async function refreshPlan(){if(typeof loadPlan==='function')await loadPlan(stateSafe()?.selectedSeasonId||null)}
  function notify(msg){if(typeof showMessage==='function')showMessage(msg,'success');else alert(msg)}

  async function saveMacro(){const f=hydrate(),s=season();if(!s){close();originalView('plan')?.click();setTimeout(()=>q('#createFirstSeason')?.click(),150);return}const g=selectedGoal(f),d=macroDefaults(f);const payload={name:f.macroName||d.name,start_date:f.macroStart||d.start,end_date:f.macroEnd||d.end,status:'planned',goal_id:f.goalId||null,primary_objective:f.macroObjective||d.objective,constraints:'',notes:`RUNFLOW_GUIDE_V6\nTipo guía: ${f.guideType}\nRuta: ${route(f).note}`};if(!payload.name||!payload.start_date||!payload.end_date){alert('Completa nombre, inicio y fin del macrociclo.');return}const base=`/api/coach/athletes/${encodeURIComponent(athleteId())}`;const data=await callApi(f.macroId?`${base}/macrocycles/${encodeURIComponent(f.macroId)}`:`${base}/seasons/${encodeURIComponent(s.id)}/macrocycles`,{method:f.macroId?'PUT':'POST',body:JSON.stringify(payload)});await refreshPlan();f.macroId=data?.macrocycle?.id||f.macroId;write(f);notify('Macrociclo guardado en el Plan real.');paint()}

  function suggestedMesoDates(f){const ma=selectedMacro(f);if(!ma)return{start:'',end:''};const rows=compatibleMesos(f).filter(x=>String(x.id)!==String(f.mesoId)).sort((a,b)=>String(a.end_date).localeCompare(String(b.end_date)));let start=rows.length?addDays(rows[rows.length-1].end_date,1):ma.start_date;const existing=selectedMeso(f);if(existing)start=existing.start_date||start;let end=addDays(start,f.mesoWeeks*7-1);if(ma.end_date&&after(end,ma.end_date))end=ma.end_date;return{start,end}}
  async function saveMeso(){const f=collectDrafts(),ma=selectedMacro(f);if(!ma){alert('Selecciona o crea primero un macrociclo real.');return}const p=phase(f),dates=suggestedMesoDates(f),secondary=[f.p2,...(f.maintain||[])].filter(Boolean);const avg=(f.microDrafts||[]).reduce((s,x)=>s+Number(x.loadPct||0),0)/Math.max(1,(f.microDrafts||[]).length);const payload={name:p[1],start_date:dates.start,end_date:dates.end,status:'planned',primary_adaptation:f.p1,secondary_adaptations:secondary,planned_hours:null,planned_distance_km:null,planned_elevation_m:null,planned_load:f.maxLoad?Math.round(f.maxLoad*avg/100*f.mesoWeeks):null,planned_strength_sessions:null,success_criteria:f.successCriteria||'',progression_pattern:(f.microDrafts||[]).map(x=>MICRO_API[x.type]||'development'),notes:guideNotes(f)};if(!dates.start||!dates.end){alert('No puedo calcular las fechas del mesociclo. Revisa las fechas del macrociclo.');return}const base=`/api/coach/athletes/${encodeURIComponent(athleteId())}`;const data=await callApi(f.mesoId?`${base}/mesocycles/${encodeURIComponent(f.mesoId)}`:`${base}/macrocycles/${encodeURIComponent(ma.id)}/mesocycles`,{method:f.mesoId?'PUT':'POST',body:JSON.stringify(payload)});await refreshPlan();f.mesoId=data?.mesocycle?.id||f.mesoId;f.microDrafts=freshDrafts(f);write(f);notify('Mesociclo guardado con la lógica del Planificador guiado.');paint()}

  async function saveMicros(){const f=collectDrafts(),m=selectedMeso(f);if(!m){alert('Selecciona o crea primero un mesociclo real.');return}const existing=compatibleMicros(f).slice().sort((a,b)=>String(a.start_date).localeCompare(String(b.start_date)));if(existing.length&&!confirm(`Ya existen ${existing.length} microciclo(s). RunFlow actualizará los que coincidan por posición y creará los que falten. No borrará semanas adicionales. ¿Continuar?`))return;const base=`/api/coach/athletes/${encodeURIComponent(athleteId())}`;for(let i=0;i<f.microDrafts.length;i++){const d=f.microDrafts[i],start=addDays(m.start_date,i*7),end=i===f.microDrafts.length-1?(m.end_date||addDays(start,6)):addDays(start,6),real=existing[i];const load=f.maxLoad?Math.round(f.maxLoad*d.loadPct/100):0;const payload={name:`S${i+1} · ${d.type}`,start_date:start,end_date:end,type:MICRO_API[d.type]||'development',primary_objective:d.objective||f.p1,planned:{hours:0,distance_km:0,elevation_m:0,load,strength_sessions:0},lifecycle_status:'planned',publication_status:'draft',recovery_target:d.type==='Consolidación'||d.type==='Descarga'?'Priorizar asimilación y recuperación':'',notes:`RUNFLOW_GUIDE_V6\nFase: ${f.phase}\nTipo: ${d.type}\nCarga %: ${d.loadPct}\nRango: ${d.low}-${d.high}\nP1: ${f.p1}`};await callApi(real?`${base}/microcycles/${encodeURIComponent(real.id)}`:`${base}/mesocycles/${encodeURIComponent(m.id)}/microcycles`,{method:real?'PUT':'POST',body:JSON.stringify(payload)})}await refreshPlan();const updated=compatibleMicros(f);f.microId=updated[0]?.id||f.microId;write(f);notify('Microciclos guardados en el Plan real y disponibles en Calendario.');paint()}

  function openPlanEdit(type,id){close();originalView('plan')?.click();setTimeout(()=>{const action={goal:'edit-goal',macro:'edit-macro',meso:'edit-meso',micro:'edit-micro'}[type];q(`[data-plan-action="${action}"][data-id="${CSS.escape(String(id))}"]`)?.click()},180)}
  function openCalendarForMicro(id){const mc=micros().find(x=>String(x.id)===String(id));close();originalView('week')?.click();if(mc&&typeof parseLocalDate==='function'){try{const d=parseLocalDate(mc.start_date);stateSafe().calendar.month=new Date(d.getFullYear(),d.getMonth(),1,12);if(typeof loadCalendarMonth==='function')loadCalendarMonth(false).then(()=>{if(typeof selectCalendarWeek==='function')selectCalendarWeek(mc.start_date,true)})}catch{}}}
  function openLibrary(stim){close();originalView('library')?.click();setTimeout(()=>{const f=q('#libraryStimulusFilter');if(f){const o=[...f.options].find(x=>String(x.value).toLowerCase()===String(stim).toLowerCase()||String(x.textContent).toLowerCase().includes(String(stim).toLowerCase()));if(o){f.value=o.value;f.dispatchEvent(new Event('change',{bubbles:true}));return}}const s=q('#librarySearch');if(s){s.value=stim;s.dispatchEvent(new Event('input',{bubbles:true}))}},180)}
  function openSeasonMap(){close();originalView('week')?.click();setTimeout(()=>q('#v8SeasonMap')?.scrollIntoView({behavior:'smooth',block:'start'}),220)}

  async function footerAction(){const i=activeStep();try{const button=q('#v8GuidedAction');if(button)button.disabled=true;if(i===0){close();q('#newPlanGoal')?.click();return}if(i===1){await saveMacro();return}if(i===2){await saveMeso();return}if(i===3){await saveMicros();return}if(i===4){openCalendarForMicro(hydrate().microId);return}if(i===5){openSeasonMap()}}catch(e){alert(e.message||'No se pudo completar la acción.')}finally{const button=q('#v8GuidedAction');if(button)button.disabled=false}}
  function footerLabel(i,f){return ['+ Crear / editar objetivo',f.macroId?'Guardar cambios del macrociclo':'Crear macrociclo real',f.mesoId?'Guardar cambios del mesociclo':'Crear mesociclo real',compatibleMicros(f).length?'Actualizar microciclos reales':'Crear propuesta de microciclos','Abrir microciclo en calendario','Ver temporada en calendario'][i]}

  function paint(){const body=q('#v8GuidedBody');if(!body||painting)return;painting=true;const i=activeStep(),f=hydrate();qa('#v8GuidedSteps .v8-guided-step-pill').forEach((b,n)=>{if(STEP_LABELS[n])b.textContent=`${n+1} · ${STEP_LABELS[n]}`});body.innerHTML=bodies[i](f);const action=q('#v8GuidedAction');if(action)action.textContent=footerLabel(i,f);bind(i);painting=false}
  function install(){const panel=q('#v8GuidedPlanner');if(!panel)return;const action=q('#v8GuidedAction');if(action&&!action.dataset.fullLab){action.dataset.fullLab='1';action.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();footerAction()},true)}const steps=q('#v8GuidedSteps');if(steps&&!steps.dataset.fullLab){steps.dataset.fullLab='1';steps.addEventListener('click',()=>setTimeout(paint,0),true)}paint()}

  const observer=new MutationObserver(muts=>{if(!q('#v8GuidedPlanner'))return;const body=q('#v8GuidedBody');if(body&&!body.querySelector('.v8-flow-grid,.v8-flow-micro-list')&&!painting)install()});
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  q('#athleteSelect')?.addEventListener('change',()=>setTimeout(paint,80));
  document.addEventListener('DOMContentLoaded',install,{once:true});setTimeout(install,900);
})();
