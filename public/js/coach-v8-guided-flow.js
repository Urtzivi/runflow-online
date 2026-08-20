(() => {
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Recovered from Plan Lab v6 and kept aligned with the validated RunFlow guide.
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

  const SESSIONS={
    'Easy':['30–90 min fácil según nivel y fase','Trail fácil por RPE/FC','Rodaje regenerativo'],
    'Fuerza':['Fuerza general','Fuerza máxima','Fuerza-resistencia'],
    'Fuerza general':['Fuerza general','Fuerza básica + core','Fuerza general de baja fatiga'],
    'Técnica':['Técnica de carrera','Strides suaves','Técnica trail'],
    'Resistencia aeróbica':['Easy','Long Easy','Progressive'],
    'Economía de carrera':['Strides','Cuestas 10–15 s','100–200 m controlados','Carrera progresiva múltiple'],
    'Umbral':['3×8 min','4×8 min','3×10 min','2×15 min','Tempo continuo','Cruise intervals','Cuesta larga próxima a umbral'],
    'VO₂max':['5–6×3 min','8×600 m','5–6×1000 m','Cuestas VO₂'],
    'Velocidad / economía':['Strides','Sprints cortos','Cuestas 10–15 s','100–200 m controlados'],
    'Ritmo 5K':['5×1000','4×1200','3×1600','Escaleras','Bloques ritmo 5K'],
    'Ritmo 10K':['3×2 km','2×3 km','5–6×1 km','Bloques ritmo 10K'],
    'Ritmo HM':['3×3 km','2×5 km','3×15 min ritmo HM','Long Run con bloques HM'],
    'Ritmo maratón':['Long Run con bloques RM','2×6–8 km RM','Simulación de nutrición'],
    'Durability':['Long progresivo','90 min + 20 min tempo','Long Run + bloques finales','Bloques al final bajo fatiga'],
    'Durability específica':['Long Trail con final específico','Subidas después de 60–90 min','Bajadas técnicas con fatiga previa','Ensayo nutrición/hidratación/material'],
    'Capacidad de subida':['6×2 min subida','5×3 min subida','4×5 min subida','Intervalos verticales','Cuestas largas'],
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

  const LOAD_PRESET={
    'Introducción':[65,60,70], 'Desarrollo':[75,70,82], 'Sobrecarga':[90,85,95],
    'Consolidación':[65,60,72], 'Descarga':[50,45,55], 'Taper':[45,35,55],
    'Competición':[75,60,90], 'Recuperación':[35,25,45]
  };
  const STEP_LABELS=['Objetivo','Macro','Meso','Micro','Estímulo','Sesión'];
  const GUIDE_TYPES=Object.keys(ROUTES);
  const STORE='runflow-v8-guided-flow-v1';
  let applying=false;

  function stateSafe(){try{return window.state||state}catch{return null}}
  function uniqueById(rows){const seen=new Set();return (rows||[]).filter(item=>{const id=String(item?.id||'');if(!id||seen.has(id))return false;seen.add(id);return true;});}
  function allGoals(){const s=stateSafe();const planGoals=[...(s?.plan?.goals||[]),...(s?.plan?.unassigned?.goals||[])];return uniqueById(planGoals.length?planGoals:(s?.athlete?.goals||[]));}
  function allMacros(){return stateSafe()?.plan?.macrocycles||[]}
  function allMesos(){return allMacros().flatMap(m=>(m.mesocycles||[]).map(x=>({...x,_macro:m}))) }
  function allMicros(){return allMesos().flatMap(m=>(m.microcycles||[]).map(x=>({...x,_meso:m,_macro:m._macro}))) }
  function athleteId(){return q('#athleteSelect')?.value||q('#v8AthleteSelect')?.value||'default'}
  function flowKey(){return `${STORE}:${athleteId()}`}
  function loadFlow(){try{return JSON.parse(localStorage.getItem(flowKey())||'{}')||{}}catch{return{}}}
  function saveFlow(data){try{localStorage.setItem(flowKey(),JSON.stringify(data))}catch{}}
  function flow(){const f=loadFlow();const goals=allGoals();if(!f.goalId||!goals.some(g=>String(g.id)===String(f.goalId)))f.goalId=goals[0]?.id||'';const goal=goals.find(g=>String(g.id)===String(f.goalId));if(!f.guideType||!ROUTES[f.guideType])f.guideType=inferGuideType(goal);const route=ROUTES[f.guideType]||ROUTES['10K'];if(!f.phase||!route.phases.some(p=>p[0]===f.phase))f.phase=route.phases[0]?.[0]||'';const macros=allMacros();if(f.macroId&&!macros.some(m=>String(m.id)===String(f.macroId)))f.macroId='';if(!f.macroId&&macros.length)f.macroId=macros[0].id;const mesos=filteredMesos(f);if(f.mesoId&&!mesos.some(m=>String(m.id)===String(f.mesoId)))f.mesoId='';if(!f.mesoId&&mesos.length)f.mesoId=mesos[0].id;const phase=phaseData(f);if(!f.p1||!phase[3].includes(f.p1))f.p1=phase[3][0]||'';if(f.p2===f.p1)f.p2='';const micros=filteredMicros(f);if(f.microId&&!micros.some(m=>String(m.id)===String(f.microId)))f.microId='';if(!f.microId&&micros.length)f.microId=micros[0].id;if(!f.microType)f.microType=microOptions(f)[0]||'Desarrollo';const stimuli=stimulusOptions(f);if(!f.stimulus||!stimuli.includes(f.stimulus))f.stimulus=stimuli[0]||f.p1||'Easy';const sessions=SESSIONS[f.stimulus]||[];if(!f.session||!sessions.includes(f.session))f.session=sessions[0]||'';saveFlow(f);return f;}

  function inferGuideType(goal){
    if(!goal)return'10K';
    const text=[goal.name,goal.race_type,goal.raceType,goal.type,goal.sport,goal.surface].filter(Boolean).join(' ').toLowerCase();
    const distance=Number(goal.distance_km||goal.distance||0);
    const elevation=Number(goal.elevation_m||goal.elevation||0);
    const trail=/trail|ultra|monta|mountain/.test(text)||elevation>=500;
    if(trail)return /ultra/.test(text)||distance>=30?'Trail largo':'Trail corto';
    if(/marat[oó]n/.test(text)&&!/media|half/.test(text))return'Maratón';
    if(/media|half/.test(text))return'Media maratón';
    if(/10\s?k/.test(text))return'10K';
    if(/5\s?k/.test(text))return'5K';
    if(distance>0&&distance<=6)return'5K';
    if(distance<=12&&distance>0)return'10K';
    if(distance<=25&&distance>0)return'Media maratón';
    if(distance>25)return'Maratón';
    return'10K';
  }

  function routeData(f){return ROUTES[f.guideType]||ROUTES['10K']}
  function phaseData(f){const route=routeData(f);return route.phases.find(p=>p[0]===f.phase)||route.phases[0]}
  function macroGoalId(m){return m?.goal_id||m?.goalId||m?.associated_goal_id||''}
  function filteredMacros(f){const rows=allMacros();const linked=rows.filter(m=>String(macroGoalId(m))===String(f.goalId));return linked.length?linked:rows}
  function filteredMesos(f){const rows=allMesos();if(!f.macroId)return rows;return rows.filter(m=>String(m._macro?.id)===String(f.macroId)||String(m.macrocycle_id||m.macroId||'')===String(f.macroId))}
  function filteredMicros(f){const rows=allMicros();if(!f.mesoId)return rows;return rows.filter(m=>String(m._meso?.id)===String(f.mesoId)||String(m.mesocycle_id||m.mesoId||'')===String(f.mesoId))}
  function selectedGoal(f){return allGoals().find(g=>String(g.id)===String(f.goalId))}
  function selectedMacro(f){return allMacros().find(m=>String(m.id)===String(f.macroId))}
  function selectedMeso(f){return allMesos().find(m=>String(m.id)===String(f.mesoId))}
  function selectedMicro(f){return allMicros().find(m=>String(m.id)===String(f.microId))}
  function microOptions(f){
    const phase=String(f.phase||'');
    if(/taper/i.test(phase))return['Taper'];
    if(/competici/i.test(phase))return['Competición'];
    if(/recuper|transici/i.test(phase))return['Recuperación','Descarga'];
    return['Introducción','Desarrollo','Sobrecarga','Consolidación','Descarga'];
  }
  function maintainOptions(f){
    const phase=phaseData(f);const base=[...phase[3],'Resistencia aeróbica','Fuerza','Economía de carrera','Durability','Velocidad / economía','Técnica trail'];
    return [...new Set(base)].filter(x=>x&&x!==f.p1&&x!==f.p2);
  }
  function stimulusOptions(f){
    const items=[f.p1,f.p2,...(Array.isArray(f.maintain)?f.maintain:[]),'Easy'];
    if(!/Taper/i.test(f.phase))items.push('Fuerza');
    return [...new Set(items.filter(x=>x&&SESSIONS[x]))];
  }
  function option(value,label,selected){return `<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label??value)}</option>`}
  function selectField(label,id,html,help=''){return `<label class="v8-flow-field"><span>${esc(label)}</span><select id="${id}">${html}</select>${help?`<small>${esc(help)}</small>`:''}</label>`}
  function contextRow(label,value){return `<div><span>${esc(label)}</span><b>${esc(value??'—')}</b></div>`}
  function routePreview(f){const route=routeData(f);return `<div class="v8-flow-route">${route.phases.map((p,i)=>`<button type="button" class="v8-flow-route-row ${p[0]===f.phase?'active':''}" data-flow-phase="${esc(p[0])}"><span>${i+1}</span><div><b>${esc(p[0])}</b><small>${esc(p[1])} · ${esc(p[2])}</small></div></button>`).join('')}</div>`}
  function selectedValues(id){return qa(`#${id} option:checked`).map(o=>o.value)}

  function objectiveBody(f){
    const goals=allGoals(),goal=selectedGoal(f),route=routeData(f);
    const goalOptions=goals.map(g=>option(g.id,`${g.name||'Objetivo'} · ${g.goal_date||'sin fecha'}`,f.goalId)).join('');
    if(!goals.length)return `<div class="v8-guided-card"><div class="eyebrow">1 · Empieza por el objetivo</div><h3>No hay ningún objetivo creado</h3><p>El planificador necesita una competición u objetivo real para poder filtrar el resto de decisiones.</p></div><div class="v8-guided-warning"><strong>Guía RunFlow:</strong> primero definimos qué queremos conseguir; después decidimos cómo entrenarlo.</div>`;
    return `<div class="v8-guided-card"><div class="eyebrow">1 · Competición → necesidades</div><h3>¿Para qué estamos preparando al deportista?</h3><p>Selecciona el objetivo real. RunFlow propone una clasificación inicial y, a partir de ella, filtra la ruta de fases.</p><div class="v8-flow-grid">${selectField('Objetivo real','v8FlowGoal',goalOptions)}${selectField('Clasificación para la guía','v8FlowType',GUIDE_TYPES.map(x=>option(x,x,f.guideType)).join(''),'Puedes corregirla si la propuesta no representa bien la prueba.')}</div><div class="v8-guided-context">${contextRow('Prioridad',goal?.priority_code||goal?.priority||'—')}${contextRow('Distancia',goal?.distance_km?`${goal.distance_km} km`:'—')}${contextRow('Desnivel',goal?.elevation_m?`${goal.elevation_m} m+`:'—')}</div><div class="v8-flow-guide"><strong>Ruta recomendada por la guía</strong><p>${esc(route.note)}</p></div>${routePreview(f)}</div><div class="v8-guided-warning"><strong>Por qué:</strong> la competición determina las necesidades. No elegimos todavía sesiones.</div>`;
  }

  function macroBody(f){
    const macros=filteredMacros(f),route=routeData(f),phase=phaseData(f),metrics=stateSafe()?.athlete?.metrics||{};
    const macroOptions=['<option value="">Selecciona un macrociclo</option>',...macros.map(m=>option(m.id,m.name||'Macrociclo',f.macroId))].join('');
    return `<div class="v8-guided-card"><div class="eyebrow">2 · Necesidades → fase</div><h3>¿En qué parte del camino estamos?</h3><p>El macrociclo es el camino completo hasta el objetivo. La clasificación elegida en el paso anterior determina las fases coherentes que puedes seleccionar aquí.</p><div class="v8-flow-grid">${selectField('Macrociclo real','v8FlowMacro',macroOptions)}${selectField('Fase de la guía','v8FlowPhase',route.phases.map(p=>option(p[0],p[0],f.phase)).join(''))}</div><div class="v8-guided-context">${contextRow('Readiness',metrics.readiness_score??'—')}${contextRow('Aptitud / fatiga',`${metrics.fitness??'—'} / ${metrics.fatigue??'—'}`)}${contextRow('Forma',metrics.form??'—')}</div><div class="v8-flow-guide"><strong>${esc(phase[0])} · ${esc(phase[1])}</strong><p>${esc(phase[2])}</p><small>Capacidades compatibles: ${esc(phase[3].join(' · '))}</small></div>${routePreview(f)}</div><div class="v8-guided-warning"><strong>Guía RunFlow:</strong> las fases no son compartimentos rígidos. Cambia la prioridad, no desaparecen necesariamente las demás capacidades.</div>`;
  }

  function mesoBody(f){
    const phase=phaseData(f),macros=filteredMacros(f),maintain=maintainOptions(f);
    const macroOptions=['<option value="">Selecciona un macrociclo</option>',...macros.map(m=>option(m.id,m.name||'Macrociclo',f.macroId))].join('');
    const p2=['<option value="">Sin P2</option>',...phase[3].filter(x=>x!==f.p1).map(x=>option(x,x,f.p2))].join('');
    const maintained=new Set(Array.isArray(f.maintain)?f.maintain:[]);
    return `<div class="v8-guided-card"><div class="eyebrow">3 · Fase → mesociclo → capacidad</div><h3>¿Qué adaptación queremos producir ahora?</h3><p>Aquí aparece la lógica dependiente del prototipo: la fase filtra el mesociclo; el mesociclo filtra las capacidades posibles; P1 filtra P2 y mantenimiento.</p><div class="v8-flow-grid">${selectField('Macrociclo','v8FlowMesoMacro',macroOptions)}${selectField('Fase','v8FlowMesoPhase',routeData(f).phases.map(p=>option(p[0],p[0],f.phase)).join(''))}${selectField('Mesociclo recomendado','v8FlowMesoType',option(phase[1],phase[1],phase[1]))}${selectField('Prioridad 1','v8FlowP1',phase[3].map(x=>option(x,x,f.p1)).join(''))}${selectField('Prioridad 2','v8FlowP2',p2,'Opcional. Solo si no interfiere con P1.')}</div><label class="v8-flow-field v8-flow-full"><span>Mantener</span><select id="v8FlowMaintain" multiple size="${Math.min(6,Math.max(3,maintain.length))}">${maintain.map(x=>`<option value="${esc(x)}" ${maintained.has(x)?'selected':''}>${esc(x)}</option>`).join('')}</select><small>Selecciona capacidades que no quieres perder durante este bloque.</small></label><div class="v8-flow-guide"><strong>Decisión resultante</strong><p>P1: <b>${esc(f.p1||'—')}</b>${f.p2?` · P2: <b>${esc(f.p2)}</b>`:''}</p><small>${esc(phase[2])}</small></div></div><div class="v8-guided-warning"><strong>Regla:</strong> un mesociclo desarrolla principalmente una capacidad y, como máximo, una segunda prioridad importante. Duración prevista habitual: 2–6 semanas.</div>`;
  }

  function microBody(f){
    const mesos=filteredMesos(f),meso=selectedMeso(f),micros=filteredMicros(f),types=microOptions(f),preset=LOAD_PRESET[f.microType]||LOAD_PRESET.Desarrollo;
    const mesoOptions=['<option value="">Selecciona un mesociclo real</option>',...mesos.map(m=>option(m.id,m.name||m.primary_adaptation||'Mesociclo',f.mesoId))].join('');
    const microOptionsHtml=['<option value="">Todavía no creado</option>',...micros.map(m=>option(m.id,m.name||m.week_type||'Microciclo',f.microId))].join('');
    return `<div class="v8-guided-card"><div class="eyebrow">4 · Capacidad → microciclo</div><h3>¿Qué tipo de semana necesitamos?</h3><p>La prioridad del mesociclo ya está decidida. Ahora elegimos cómo presentar o progresar el estímulo durante esta semana.</p><div class="v8-flow-grid">${selectField('Mesociclo real','v8FlowMeso',mesoOptions)}${selectField('Microciclo real','v8FlowMicro',microOptionsHtml)}${selectField('Tipo de microciclo','v8FlowMicroType',types.map(x=>option(x,x,f.microType)).join(''))}</div><div class="v8-guided-context">${contextRow('P1',f.p1||meso?.primary_adaptation||'—')}${contextRow('P2',f.p2||'—')}${contextRow('Carga orientativa',`${preset[0]}% · rango ${preset[1]}–${preset[2]}%`)}</div><div class="v8-flow-guide"><strong>${esc(f.microType)}</strong><p>${microExplanation(f.microType)}</p></div></div><div class="v8-guided-warning"><strong>Progresión:</strong> no aumentes simultáneamente volumen + intensidad + frecuencia + desnivel + dificultad. Elige normalmente una variable y observa la respuesta.</div>`;
  }

  function microExplanation(type){return ({'Introducción':'Presentar el estímulo y comprobar tolerancia.','Desarrollo':'Aumentar el estímulo si la respuesta previa ha sido adecuada.','Sobrecarga':'Mayor estímulo solo si la respuesta es buena y la recuperación lo permite.','Consolidación':'Absorber lo realizado sin necesidad de seguir aumentando carga.','Descarga':'Reducir carga cuando la fatiga o la respuesta aconsejan recuperar.','Taper':'Eliminar fatiga manteniendo pequeñas dosis de intensidad y especificidad.','Competición':'Priorizar ejecución, estrategia y frescura.','Recuperación':'Recuperar según el coste real de la competición o del bloque.'})[type]||''}

  function stimulusBody(f){
    const micros=filteredMicros(f),stimuli=stimulusOptions(f),microOptionsHtml=['<option value="">Selecciona un microciclo real</option>',...micros.map(m=>option(m.id,m.name||m.week_type||'Microciclo',f.microId))].join('');
    return `<div class="v8-guided-card"><div class="eyebrow">5 · Microciclo → estímulo</div><h3>¿Qué estímulo necesita esta semana?</h3><p>Primero eliges la necesidad. Solo después RunFlow enseña familias de sesiones compatibles.</p><div class="v8-flow-grid">${selectField('Microciclo','v8FlowStimulusMicro',microOptionsHtml)}${selectField('Estímulo necesario','v8FlowStimulus',stimuli.map(x=>option(x,x,f.stimulus)).join(''))}</div><div class="v8-flow-guide"><strong>Por qué aparece ${esc(f.stimulus)}</strong><p>${stimulusWhy(f)}</p></div><div class="v8-flow-session-preview">${(SESSIONS[f.stimulus]||[]).slice(0,4).map(x=>`<span>${esc(x)}</span>`).join('')}</div></div><div class="v8-guided-warning"><strong>Orden RunFlow:</strong> prioridad del mesociclo → sesión clave nº1 → segundo estímulo si procede → fuerza minimizando interferencias → easy/recuperación.</div>`;
  }

  function stimulusWhy(f){
    if(f.stimulus===f.p1)return'Es la Prioridad 1 del mesociclo: debe recibir el estímulo de mayor intención del bloque.';
    if(f.stimulus===f.p2)return'Es la Prioridad 2: se trabaja solo si no compromete la adaptación principal.';
    if(f.stimulus==='Easy')return'El EASY permite acumular volumen, recuperar y hacer productivos los días importantes.';
    if(f.stimulus==='Fuerza')return'La fuerza se coloca minimizando interferencias con las sesiones clave.';
    return'Es una capacidad de mantenimiento seleccionada para evitar perderla durante el mesociclo.';
  }

  function sessionBody(f){
    const options=SESSIONS[f.stimulus]||[],sessionOptions=options.map(x=>option(x,x,f.session)).join('');
    return `<div class="v8-guided-card"><div class="eyebrow">6 · Estímulo → sesión</div><h3>Ahora sí: elige una familia de sesión</h3><p>Las opciones ya están filtradas por objetivo, fase, P1/P2, tipo de microciclo y estímulo semanal.</p><div class="v8-flow-grid">${selectField('Estímulo','v8FlowSessionStimulus',stimulusOptions(f).map(x=>option(x,x,f.stimulus)).join(''))}${selectField('Sesión compatible','v8FlowSession',sessionOptions)}</div><div class="v8-guided-context">${contextRow('Objetivo',selectedGoal(f)?.name||'—')}${contextRow('Fase',f.phase)}${contextRow('P1',f.p1)}${contextRow('Micro',f.microType)}</div><div class="v8-flow-final"><span>Necesidad</span><strong>${esc(f.stimulus)}</strong><span>Sesión elegida</span><strong>${esc(f.session||'—')}</strong><p>Antes de prescribirla, responde: <b>¿por qué esta sesión concreta debería producir la adaptación que necesito ahora?</b></p></div><div class="v8-flow-inline-actions"><button type="button" class="btn secondary small" data-flow-inline="calendar">Abrir microciclo en calendario</button><button type="button" class="btn soft small" data-flow-inline="restart">Revisar desde el objetivo</button></div></div><div class="v8-guided-warning"><strong>Después de entrenar:</strong> respuesta del deportista → análisis → decisión → nuevo plan. El calendario marca cuándo revisamos; la respuesta decide si avanzamos.</div>`;
  }

  function bodyFor(index,f){return [objectiveBody,macroBody,mesoBody,microBody,stimulusBody,sessionBody][index]?.(f)||''}
  function activeStep(){const active=q('#v8GuidedSteps .v8-guided-step-pill.active');return Math.max(0,Math.min(5,Number(active?.dataset.guideStep||0)))}
  function setField(id,key,transform=v=>v){const el=q(`#${id}`);if(!el)return;el.addEventListener('change',()=>{const f=flow();f[key]=transform(el.value,f);saveFlow(f);renderFlow();});}

  function bindBody(index){
    setField('v8FlowGoal','goalId',(v,f)=>{const g=allGoals().find(x=>String(x.id)===String(v));f.guideType=inferGuideType(g);f.phase=ROUTES[f.guideType].phases[0][0];f.macroId='';f.mesoId='';f.microId='';return v});
    setField('v8FlowType','guideType',(v,f)=>{f.phase=ROUTES[v].phases[0][0];f.p1='';f.p2='';f.mesoId='';f.microId='';return v});
    setField('v8FlowMacro','macroId');
    setField('v8FlowPhase','phase',(v,f)=>{f.p1='';f.p2='';f.maintain=[];f.mesoId='';f.microId='';f.microType='';f.stimulus='';return v});
    setField('v8FlowMesoMacro','macroId',(v,f)=>{f.mesoId='';f.microId='';return v});
    setField('v8FlowMesoPhase','phase',(v,f)=>{f.p1='';f.p2='';f.maintain=[];f.mesoId='';f.microId='';f.microType='';f.stimulus='';return v});
    setField('v8FlowP1','p1',(v,f)=>{if(f.p2===v)f.p2='';f.stimulus='';return v});
    setField('v8FlowP2','p2',(v,f)=>{f.stimulus='';return v});
    const maintain=q('#v8FlowMaintain');if(maintain)maintain.addEventListener('change',()=>{const f=flow();f.maintain=selectedValues('v8FlowMaintain');f.stimulus='';saveFlow(f);renderFlow()});
    setField('v8FlowMeso','mesoId',(v,f)=>{f.microId='';return v});
    setField('v8FlowMicro','microId');
    setField('v8FlowMicroType','microType',(v,f)=>{f.stimulus='';return v});
    setField('v8FlowStimulusMicro','microId');
    setField('v8FlowStimulus','stimulus',(v,f)=>{f.session='';return v});
    setField('v8FlowSessionStimulus','stimulus',(v,f)=>{f.session='';return v});
    setField('v8FlowSession','session');
    qa('[data-flow-phase]').forEach(button=>button.addEventListener('click',()=>{const f=flow();f.phase=button.dataset.flowPhase;f.p1='';f.p2='';f.maintain=[];f.mesoId='';f.microId='';f.microType='';f.stimulus='';saveFlow(f);renderFlow()}));
    q('[data-flow-inline="calendar"]')?.addEventListener('click',()=>openMicroCalendar(flow().microId));
    q('[data-flow-inline="restart"]')?.addEventListener('click',()=>q('#v8GuidedSteps [data-guide-step="0"]')?.click());
  }

  function relabelSteps(){qa('#v8GuidedSteps .v8-guided-step-pill').forEach((pill,i)=>{if(STEP_LABELS[i])pill.textContent=`${i+1} · ${STEP_LABELS[i]}`})}
  function updateFooter(index,f){const action=q('#v8GuidedAction');if(!action)return;const labels=[allGoals().length?'+ Crear otro objetivo':'+ Crear objetivo',f.macroId?'Editar / crear macrociclo':'+ Crear macrociclo','Crear mesociclo con esta decisión','Crear / editar microciclo','Abrir microciclo en calendario','Abrir Biblioteca con este estímulo'];action.textContent=labels[index]||'Continuar';}
  function renderFlow(){
    const body=q('#v8GuidedBody');if(!body||applying)return;
    applying=true;
    const index=activeStep(),f=flow();
    relabelSteps();
    body.innerHTML=bodyFor(index,f);
    updateFooter(index,f);
    bindBody(index);
    body.dataset.v8FlowStep=String(index);
    applying=false;
  }

  function originalView(name){return q(`main.shell>.tabs [data-view="${name}"]`)}
  function closePlanner(){window.RunFlowV8Planner?.close?.()}
  function openPlanAction(action,id){
    closePlanner();originalView('plan')?.click();
    setTimeout(()=>{
      const idSelector=id?`[data-id="${CSS.escape(String(id))}"]`:'';
      const button=q(`[data-plan-action="${action}"]${idSelector}`)||q(`[data-plan-action="${action}"]`);
      if(button)button.click();
      else alert('No encuentro todavía ese nivel en el Plan real. Crea primero el nivel anterior y vuelve al planificador guiado.');
    },180);
  }
  function openMicroCalendar(id){
    if(!id){alert('Selecciona o crea primero un microciclo real.');return;}
    closePlanner();originalView('plan')?.click();
    setTimeout(()=>{const select=q(`[data-plan-action="select-micro"][data-id="${CSS.escape(String(id))}"]`);if(!select){alert('No he encontrado ese microciclo en el Plan real.');return;}select.click();setTimeout(()=>q('#openSelectedWeekCalendar')?.click(),120);},180);
  }
  function openLibrary(stimulus){
    closePlanner();originalView('library')?.click();
    setTimeout(()=>{
      const filter=q('#libraryStimulusFilter');
      if(filter){const match=[...filter.options].find(o=>String(o.value).toLowerCase()===String(stimulus).toLowerCase()||String(o.textContent).toLowerCase().includes(String(stimulus).toLowerCase()));if(match){filter.value=match.value;filter.dispatchEvent(new Event('change',{bubbles:true}));return;}}
      const search=q('#librarySearch');if(search){search.value=stimulus;search.dispatchEvent(new Event('input',{bubbles:true}));}
    },180);
  }
  function runFooterAction(){
    const index=activeStep(),f=flow();
    if(index===0){closePlanner();q('#newPlanGoal')?.click();return;}
    if(index===1){openPlanAction(f.macroId?'edit-macro':'new-macro',f.macroId);return;}
    if(index===2){openPlanAction('new-meso',f.macroId);return;}
    if(index===3){openPlanAction(f.microId?'edit-micro':'new-micro',f.microId||f.mesoId);return;}
    if(index===4){openMicroCalendar(f.microId);return;}
    if(index===5){openLibrary(f.stimulus);}
  }

  function installControls(){
    const panel=q('#v8GuidedPlanner');if(!panel)return;
    const action=q('#v8GuidedAction');
    if(action&&!action.dataset.v8FlowCapture){action.dataset.v8FlowCapture='1';action.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();runFooterAction();},true);}
    renderFlow();
  }

  new MutationObserver(()=>{if(q('#v8GuidedPlanner'))installControls()}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('DOMContentLoaded',installControls,{once:true});
  q('#athleteSelect')?.addEventListener('change',()=>setTimeout(renderFlow,50));
  setTimeout(installControls,900);
})();
