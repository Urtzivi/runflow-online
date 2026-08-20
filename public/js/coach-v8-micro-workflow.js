(() => {
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FLOW_STORE = 'runflow-v8-guided-flow-v2';
  let painting = false;
  let calendarSignature = '';

  const SESSIONS = {
    'Easy': ['30-90’ fácil según nivel y fase', 'Trail fácil por RPE/FC', 'Rodaje regenerativo'],
    'Fuerza': ['Fuerza general', 'Fuerza máxima', 'Fuerza-resistencia'],
    'Fuerza general': ['Fuerza general', 'Fuerza básica + core', 'Fuerza general de baja fatiga'],
    'Técnica': ['Técnica de carrera', 'Strides suaves', 'Técnica trail'],
    'Resistencia aeróbica': ['Easy', 'Long Easy', 'Progressive'],
    'Economía de carrera': ['Strides', 'Cuestas 10-15”', '100-200 m controlados', 'Carrera progresiva múltiple'],
    'Umbral': ['3×8’', '4×8’', '3×10’', '2×15’', 'Tempo continuo', 'Cruise intervals', 'Cuesta larga próxima a umbral'],
    'VO₂max': ['5-6×3’', '8×600 m', '5-6×1000 m', 'Cuestas VO₂'],
    'Velocidad / economía': ['Strides', 'Sprints cortos', 'Cuestas 10-15”', '100-200 m controlados'],
    'Ritmo 5K': ['5×1000', '4×1200', '3×1600', 'Escaleras', 'Bloques ritmo 5K'],
    'Ritmo 10K': ['3×2 km', '2×3 km', '5-6×1 km', 'Bloques ritmo 10K'],
    'Ritmo HM': ['3×3 km', '2×5 km', '3×15’ ritmo HM', 'Long Run con bloques HM'],
    'Ritmo maratón': ['Long Run con bloques RM', '2×6-8 km RM', 'Simulación de nutrición'],
    'Durability': ['Long progresivo', '90’ + 20’ tempo', 'Long Run + bloques finales', 'Bloques al final bajo fatiga'],
    'Durability específica': ['Long Trail con final específico', 'Subidas después de 60-90’', 'Bajadas técnicas con fatiga previa', 'Ensayo nutrición/hidratación/material'],
    'Capacidad de subida': ['6×2’ subida', '5×3’ subida', '4×5’ subida', 'Intervalos verticales', 'Cuestas largas'],
    'Power hiking': ['Power hiking en pendiente', 'Cuestas largas caminando fuerte', 'Bloques hiking bajo fatiga'],
    'Capacidad de bajada': ['Downhill progresivo', 'Downhill técnico', 'Bajada bajo fatiga'],
    'Fuerza específica': ['Fuerza-resistencia', 'Cuestas largas', 'Subida con fatiga'],
    'Técnica trail': ['Series triangulares', 'Trail intervals', 'Downhill técnico'],
    'Esfuerzo competitivo': ['Long Trail', 'Bloques race effort', 'Subida/bajada específica'],
    'Terreno / tecnicidad': ['Trail intervals', 'Series triangulares', 'Bloques en terreno objetivo'],
    'D+ / D-': ['Long Trail con D+/D- objetivo', 'Triangulares largas', 'Desnivel progresivo'],
    'Nutrición': ['Ensayo de nutrición', 'Long Trail con estrategia de hidratación', 'Simulación de material'],
    'Eliminar fatiga': ['Easy + strides', 'Race pace breve', 'Primer corto', 'Taper threshold bajo volumen'],
    'Mantener intensidad': ['Race pace corto', 'Strides', 'Activación', 'Pequeños bloques específicos']
  };

  function stateSafe() { try { return window.state || state; } catch { return null; } }
  function athleteId() { return q('#athleteSelect')?.value || q('#v8AthleteSelect')?.value || null; }
  function flowKey() { return `${FLOW_STORE}:${athleteId() || 'default'}`; }
  function readFlow() { try { return JSON.parse(localStorage.getItem(flowKey()) || '{}') || {}; } catch { return {}; } }
  function writeFlow(v) { try { localStorage.setItem(flowKey(), JSON.stringify(v)); } catch {} }
  function macros() { return stateSafe()?.plan?.macrocycles || []; }
  function mesos() { return macros().flatMap(m => (m.mesocycles || []).map(x => ({ ...x, _macro: m }))); }
  function micros() { return mesos().flatMap(m => (m.microcycles || []).map(x => ({ ...x, _meso: m, _macro: m._macro }))); }
  function selectedMeso(flow = readFlow()) { return mesos().find(m => String(m.id) === String(flow.mesoId)); }
  function selectedMicro(flow = readFlow()) { return micros().find(m => String(m.id) === String(flow.microId)); }

  function parseDate(value) { return value ? new Date(`${String(value).slice(0, 10)}T12:00:00`) : null; }
  function isoDate(d) { return d && Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : ''; }
  function monday(value) {
    const d = parseDate(value); if (!d) return '';
    const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return isoDate(d);
  }
  function addDays(value, n) { const d = parseDate(value); if (!d) return ''; d.setDate(d.getDate() + n); return isoDate(d); }
  function intersects(a1, a2, b1, b2) { return String(a1) <= String(b2) && String(a2) >= String(b1); }

  function guideMeta(notes) {
    const out = {};
    String(notes || '').split('\n').forEach(line => {
      const i = line.indexOf(':'); if (i < 0) return;
      const key = line.slice(0, i).trim(), value = line.slice(i + 1).trim();
      if (key === 'Fase') out.phase = value;
      if (key === 'Semanas') out.weeks = Number(value) || 0;
      if (key === 'P2') out.p2 = value === '—' ? '' : value;
      if (key === 'Mantener') out.maintain = value === '—' ? [] : value.split('|').map(x => x.trim()).filter(Boolean);
      if (key === 'Tipo') out.type = value;
      if (key === 'Carga %') out.loadPct = Number(value) || 0;
      if (key === 'Rango') out.range = value;
      if (key === 'Estímulo') out.stimulus = value === '—' ? '' : value;
    });
    return out;
  }

  function setGuideLine(notes, key, value) {
    const rows = String(notes || '').split('\n').filter(Boolean);
    const prefix = `${key}:`;
    const index = rows.findIndex(row => row.trim().startsWith(prefix));
    const next = `${key}: ${value || '—'}`;
    if (index >= 0) rows[index] = next; else rows.push(next);
    return rows.join('\n');
  }

  function microTypeLabel(micro) {
    const meta = guideMeta(micro?.notes);
    if (meta.type) return meta.type;
    return ({ adaptation: 'Introducción', development: 'Desarrollo', overload: 'Sobrecarga', load: 'Consolidación', deload: 'Descarga', taper: 'Taper', competition: 'Competición', recovery: 'Recuperación' })[String(micro?.type || '').toLowerCase()] || micro?.name || 'Microciclo';
  }

  function weekLoad(micro) {
    return Number(micro?.planned?.load ?? micro?.planned_load ?? 0) || 0;
  }

  function macroWeekStats(macro, excludeMesoId = null, draftWeeks = 0) {
    if (!macro?.start_date || !macro?.end_date) return { total: 0, assigned: 0, remaining: 0, afterDraft: 0 };
    const first = monday(macro.start_date), last = monday(macro.end_date);
    const weekStarts = [];
    for (let cursor = first; cursor && String(cursor) <= String(last); cursor = addDays(cursor, 7)) weekStarts.push(cursor);
    const rows = (macro.mesocycles || []).filter(m => String(m.id) !== String(excludeMesoId || ''));
    let assigned = 0;
    weekStarts.forEach(ws => {
      const we = addDays(ws, 6);
      if (rows.some(m => m.start_date && m.end_date && intersects(ws, we, m.start_date, m.end_date))) assigned += 1;
    });
    const total = weekStarts.length;
    const remaining = Math.max(0, total - assigned);
    return { total, assigned, remaining, afterDraft: Math.max(0, remaining - Math.max(0, Number(draftWeeks) || 0)) };
  }

  function stimuliFor(micro, meso) {
    const meta = guideMeta(meso?.notes), type = microTypeLabel(micro), p1 = meso?.primary_adaptation || '', p2 = meta.p2 || '';
    const maintain = meta.maintain || (Array.isArray(meso?.secondary_adaptations) ? meso.secondary_adaptations : []);
    let rows;
    if (type === 'Taper') rows = ['Eliminar fatiga', 'Mantener intensidad', p1, 'Easy'];
    else if (type === 'Descarga' || type === 'Recuperación') rows = ['Easy', p1, ...maintain, 'Fuerza'];
    else if (type === 'Consolidación') rows = [p1, 'Easy', ...maintain, 'Fuerza'];
    else rows = [p1, p2, ...maintain, 'Easy', 'Fuerza'];
    return [...new Set(rows.filter(x => x && SESSIONS[x]))];
  }

  function microGuidance(type) {
    return ({
      'Introducción': 'Presenta el estímulo y comprueba tolerancia. La dosis debe permitir observar la respuesta.',
      'Desarrollo': 'Progresa el estímulo si la semana previa se ha asimilado correctamente.',
      'Sobrecarga': 'Aumenta una sola variable relevante y solo si la respuesta previa lo permite.',
      'Consolidación': 'Mantén la adaptación con menor coste y deja espacio para asimilar el bloque.',
      'Descarga': 'Reduce carga y conserva únicamente el estímulo necesario para no perder la adaptación.',
      'Taper': 'Elimina fatiga manteniendo pequeñas dosis de intensidad y especificidad.',
      'Competición': 'Prioriza ejecución, estrategia y frescura.',
      'Recuperación': 'La prioridad es recuperar del coste real del bloque o la competición.'
    })[type] || 'El tipo de microciclo determina cómo dosificamos el estímulo de esta semana.';
  }

  function activeStep() {
    const active = q('#v8GuidedSteps .v8-guided-step-pill.active');
    return Math.max(0, Math.min(5, Number(active?.dataset.guideStep || 0)));
  }

  function macroCounterHtml(macro, draftWeeks = 0, excludeMesoId = null) {
    const stats = macroWeekStats(macro, excludeMesoId, draftWeeks);
    if (!stats.total) return '';
    const complete = stats.remaining === 0;
    return `<div class="v8-macro-week-counter ${complete ? 'complete' : ''}">
      <div><span>Macrociclo</span><strong>${stats.total} semanas</strong></div>
      <div><span>Ya asignadas</span><strong>${stats.assigned}</strong></div>
      <div><span>Faltan por cubrir</span><strong>${stats.remaining}</strong></div>
      ${draftWeeks ? `<div><span>Si guardas este meso</span><strong>quedarán ${stats.afterDraft}</strong></div>` : ''}
    </div>`;
  }

  function enhanceMacroCounters(step) {
    if (![1, 2].includes(step)) return;
    const body = q('#v8GuidedBody'); if (!body) return;
    const flow = readFlow(), macro = macros().find(m => String(m.id) === String(flow.macroId));
    if (!macro) return;
    const currentMeso = selectedMeso(flow);
    const draftWeeks = step === 2 ? Math.max(1, Number(q('#gfMesoWeeks')?.value || flow.mesoWeeks || 0)) : 0;
    const html = macroCounterHtml(macro, draftWeeks, step === 2 ? currentMeso?.id : null);
    let box = q('#v8MacroWeeksCounter', body);
    if (!box) { box = document.createElement('div'); box.id = 'v8MacroWeeksCounter'; const grid = q('.v8-flow-grid', body); (grid?.parentNode || body).insertBefore(box, grid || body.firstChild); }
    box.innerHTML = html;
    q('#gfMesoWeeks', body)?.addEventListener('input', () => enhanceMacroCounters(2), { once: true });
  }

  function microRowsForSelectedMeso(flow) {
    const meso = selectedMeso(flow);
    return meso ? (meso.microcycles || []) : [];
  }

  function selectMicro(id) {
    const flow = readFlow(); flow.microId = id;
    const micro = micros().find(m => String(m.id) === String(id)), meta = guideMeta(micro?.notes), meso = micro?._meso || selectedMeso(flow);
    const allowed = stimuliFor(micro, meso);
    flow.stimulus = meta.stimulus && allowed.includes(meta.stimulus) ? meta.stimulus : allowed[0] || '';
    writeFlow(flow); renderPlannerEnhancements(true);
  }

  async function apiCall(url, options = {}) {
    if (typeof api === 'function') return api(url, options);
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar.');
    return data;
  }

  async function refreshPlan() { if (typeof loadPlan === 'function') await loadPlan(stateSafe()?.selectedSeasonId || null); }
  function notify(text) { if (typeof showMessage === 'function') showMessage(text, 'success'); else alert(text); }

  async function saveStimulus(openCalendarAfter = false) {
    const flow = readFlow(), micro = selectedMicro(flow), meso = micro?._meso || selectedMeso(flow);
    if (!micro) return alert('Selecciona primero un microciclo real.');
    const allowed = stimuliFor(micro, meso);
    const stimulus = q('#v8MicroStimulus')?.value || flow.stimulus;
    if (!stimulus || !allowed.includes(stimulus)) return alert('Selecciona un estímulo compatible con este microciclo.');
    const planned = micro.planned || {};
    const payload = {
      name: micro.name || micro.week_type || 'Microciclo',
      start_date: micro.start_date,
      end_date: micro.end_date,
      type: micro.type || micro.microcycle_type || 'development',
      primary_objective: micro.primary_objective || meso?.primary_adaptation || '',
      planned: {
        hours: Number(planned.hours ?? micro.planned_hours ?? 0) || 0,
        distance_km: Number(planned.distance_km ?? micro.planned_distance_km ?? 0) || 0,
        elevation_m: Number(planned.elevation_m ?? micro.planned_elevation_m ?? 0) || 0,
        load: Number(planned.load ?? micro.planned_load ?? 0) || 0,
        strength_sessions: Number(planned.strength_sessions ?? micro.planned_strength_sessions ?? 0) || 0
      },
      lifecycle_status: micro.lifecycle_status || 'planned',
      publication_status: micro.publication_status || 'draft',
      recovery_target: micro.recovery_target || '',
      notes: setGuideLine(micro.notes, 'Estímulo', stimulus)
    };
    const button = q('#v8SaveMicroStimulus'); if (button) button.disabled = true;
    try {
      await apiCall(`/api/coach/athletes/${encodeURIComponent(athleteId())}/microcycles/${encodeURIComponent(micro.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
      flow.stimulus = stimulus; writeFlow(flow);
      await refreshPlan();
      window.RunFlowV8SeasonMap?.render?.();
      renderCalendarContext(true);
      notify(`Estímulo “${stimulus}” guardado en este microciclo.`);
      if (openCalendarAfter) openCalendarWeek(micro.start_date);
      else renderPlannerEnhancements(true);
    } catch (error) { alert(error.message || 'No se pudo guardar el estímulo.'); }
    finally { if (button) button.disabled = false; }
  }

  function renderStimulusStep() {
    const body = q('#v8GuidedBody'); if (!body) return;
    const flow = readFlow(), meso = selectedMeso(flow), rows = microRowsForSelectedMeso(flow);
    if (!meso || !rows.length) {
      body.innerHTML = `<div class="v8-guided-card"><div class="eyebrow">5 · Microciclo → estímulo</div><h3>Primero guarda los microciclos reales</h3><p>El estímulo se define semana a semana. Hasta que no existan los microciclos no hay una semana concreta a la que asignarlo.</p><div class="v8-flow-grid"></div></div>`;
      return;
    }
    if (!flow.microId || !rows.some(m => String(m.id) === String(flow.microId))) { flow.microId = rows[0].id; writeFlow(flow); }
    const micro = rows.find(m => String(m.id) === String(flow.microId)) || rows[0];
    const meta = guideMeta(micro.notes), allowed = stimuliFor(micro, meso);
    const stimulus = meta.stimulus && allowed.includes(meta.stimulus) ? meta.stimulus : (flow.stimulus && allowed.includes(flow.stimulus) ? flow.stimulus : allowed[0] || '');
    flow.stimulus = stimulus; writeFlow(flow);
    const type = microTypeLabel(micro), target = weekLoad(micro);
    body.innerHTML = `<div class="v8-guided-card v8-micro-stimulus-step"><div class="eyebrow">5 · Cada microciclo tiene su propio estímulo</div><h3>Elige la semana y define qué adaptación vas a estimular</h3><p>No definimos un estímulo general para todo el mesociclo. Pincha cada microciclo, elige su estímulo y guárdalo. Esa decisión viajará al Calendario.</p>
      <div class="v8-micro-selector">${rows.map((m, i) => { const mm = guideMeta(m.notes), active = String(m.id) === String(micro.id); return `<button type="button" data-v8-select-micro="${esc(m.id)}" class="${active ? 'active' : ''}"><span>S${i + 1}</span><b>${esc(microTypeLabel(m))}</b><small>${esc(m.start_date || '—')} · carga ${Math.round(weekLoad(m)) || '—'}${mm.stimulus ? ` · ${esc(mm.stimulus)}` : ' · sin estímulo'}</small></button>`; }).join('')}</div>
      <div class="v8-flow-grid"><label class="v8-flow-field"><span>Microciclo seleccionado</span><div class="v8-readonly-field"><b>${esc(type)}</b><small>${esc(micro.start_date || '—')} → ${esc(micro.end_date || '—')}</small></div></label><label class="v8-flow-field"><span>Estímulo de esta semana</span><select id="v8MicroStimulus">${allowed.map(x => `<option value="${esc(x)}" ${x === stimulus ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><small>Las opciones ya están filtradas por P1/P2, mantenimiento y tipo de microciclo.</small></label></div>
      <div class="v8-guided-context"><div><span>Mesociclo</span><b>${esc(meso.name || '—')}</b></div><div><span>P1</span><b>${esc(meso.primary_adaptation || '—')}</b></div><div><span>Carga objetivo semana</span><b>${target ? Math.round(target) : '—'}</b></div></div>
      <div class="v8-flow-guide"><strong>${esc(type)}</strong><p>${esc(microGuidance(type))}</p></div>
      <div class="v8-flow-inline-actions"><button class="btn primary small" id="v8SaveMicroStimulus" type="button">Guardar estímulo de esta semana</button><button class="btn secondary small" id="v8SaveAndCalendar" type="button">Guardar y abrir Calendario</button></div></div>
      <div class="v8-guided-warning"><strong>Secuencia correcta:</strong> tipo de microciclo → estímulo de esa semana → carga objetivo → sesiones compatibles.</div>`;
    qa('[data-v8-select-micro]', body).forEach(button => button.addEventListener('click', () => selectMicro(button.dataset.v8SelectMicro)));
    q('#v8MicroStimulus', body)?.addEventListener('change', event => { const f = readFlow(); f.stimulus = event.target.value; writeFlow(f); });
    q('#v8SaveMicroStimulus', body)?.addEventListener('click', () => saveStimulus(false));
    q('#v8SaveAndCalendar', body)?.addEventListener('click', () => saveStimulus(true));
    const footer = q('#v8GuidedAction'); if (footer) footer.style.display = 'none';
  }

  function loadedWeekFor(micro) {
    const map = stateSafe()?.calendar?.weeks;
    if (!map || typeof map.get !== 'function') return null;
    return map.get(micro?.start_date) || null;
  }

  function plannedSessionLoad(week) { return (week?.workouts || []).reduce((sum, w) => sum + Number(w.planned_load || 0), 0); }

  function renderSessionStep() {
    const body = q('#v8GuidedBody'); if (!body) return;
    const flow = readFlow(), micro = selectedMicro(flow), meso = micro?._meso || selectedMeso(flow);
    if (!micro) { body.innerHTML = `<div class="v8-guided-card"><h3>Selecciona primero un microciclo</h3><div class="v8-flow-grid"></div></div>`; return; }
    const meta = guideMeta(micro.notes), stimulus = meta.stimulus || flow.stimulus || '', type = microTypeLabel(micro), target = weekLoad(micro), week = loadedWeekFor(micro), planned = plannedSessionLoad(week), remaining = target ? target - planned : null;
    const options = SESSIONS[stimulus] || [];
    body.innerHTML = `<div class="v8-guided-card v8-session-filter-step"><div class="eyebrow">6 · Planificar la semana</div><h3>Sesiones compatibles con este microciclo</h3><p>La semana anterior entrarás aquí o desde Calendario. RunFlow ya conoce el tipo de micro, su estímulo y su carga objetivo; tú eliges las sesiones concretas.</p>
      <div class="v8-guided-context"><div><span>Semana</span><b>${esc(micro.start_date || '—')}</b></div><div><span>Tipo</span><b>${esc(type)}</b></div><div><span>Estímulo</span><b>${esc(stimulus || 'Sin definir')}</b></div><div><span>Carga objetivo</span><b>${target ? Math.round(target) : '—'}</b></div><div><span>Ya planificada</span><b>${week ? Math.round(planned) : 'al abrir calendario'}</b></div><div><span>Falta / sobra</span><b>${week && remaining !== null ? `${remaining >= 0 ? '' : '+'}${Math.abs(Math.round(remaining))}${remaining >= 0 ? ' por completar' : ' sobre objetivo'}` : '—'}</b></div></div>
      ${stimulus ? `<div class="v8-flow-guide"><strong>Filtro RunFlow</strong><p>${esc(microGuidance(type))}</p><small>Familias compatibles con el estímulo ${esc(stimulus)}:</small></div><div class="v8-filtered-sessions">${options.length ? options.map(x => `<article><b>${esc(x)}</b><small>${esc(stimulus)} · ${esc(type)}</small></article>`).join('') : '<p class="muted">No hay familias predefinidas para este estímulo. Usa Biblioteca filtrada.</p>'}</div>` : `<div class="v8-guided-warning"><strong>Falta el estímulo:</strong> vuelve al paso anterior y define el estímulo de este microciclo.</div>`}
      <div class="v8-flow-inline-actions"><button class="btn primary small" id="v8OpenWeekCalendar" type="button">Planificar sesiones en Calendario</button>${stimulus ? '<button class="btn secondary small" id="v8OpenFilteredLibrary" type="button">Abrir Biblioteca filtrada</button>' : ''}<button class="btn soft small" id="v8BackToStimulus" type="button">Cambiar estímulo</button></div></div>`;
    q('#v8OpenWeekCalendar', body)?.addEventListener('click', () => openCalendarWeek(micro.start_date));
    q('#v8OpenFilteredLibrary', body)?.addEventListener('click', () => openLibrary(stimulus));
    q('#v8BackToStimulus', body)?.addEventListener('click', () => q('#v8GuidedSteps [data-guide-step="4"]')?.click());
    const footer = q('#v8GuidedAction'); if (footer) footer.style.display = 'none';
  }

  function renderPlannerEnhancements(force = false) {
    if (painting || !q('#v8GuidedPlanner')) return;
    const panel = q('#v8GuidedPlanner'); if (!panel.classList.contains('open') && !force) return;
    painting = true;
    const step = activeStep(), footer = q('#v8GuidedAction'); if (footer) footer.style.display = '';
    if (step === 4) renderStimulusStep();
    else if (step === 5) renderSessionStep();
    else enhanceMacroCounters(step);
    painting = false;
  }

  function closePlanner() { window.RunFlowV8Planner?.close?.(); }
  function openCalendarWeek(start) {
    if (!start) return;
    closePlanner();
    q('main.shell>.tabs [data-view="week"]')?.click();
    setTimeout(() => {
      if (window.RunFlowV8SeasonMap?.openWeek) window.RunFlowV8SeasonMap.openWeek(start);
      else renderCalendarContext(true);
    }, 180);
  }

  function openLibrary(stimulus) {
    closePlanner(); q('main.shell>.tabs [data-view="library"]')?.click();
    setTimeout(() => {
      const filter = q('#libraryStimulusFilter');
      if (filter) {
        const match = [...filter.options].find(o => String(o.value).toLowerCase() === String(stimulus).toLowerCase() || String(o.textContent).toLowerCase().includes(String(stimulus).toLowerCase()));
        if (match) { filter.value = match.value; filter.dispatchEvent(new Event('change', { bubbles: true })); return; }
      }
      const search = q('#librarySearch'); if (search) { search.value = stimulus; search.dispatchEvent(new Event('input', { bubbles: true })); }
    }, 180);
  }

  function microForWeek(start) {
    return micros().find(m => m.start_date && m.end_date && String(m.start_date) <= String(start) && String(m.end_date) >= String(start));
  }

  function renderCalendarContext(force = false) {
    const host = q('#weekView'); if (!host) return;
    const state = stateSafe(), start = state?.calendar?.selectedWeekStart; if (!start) return;
    const micro = microForWeek(start), week = state.calendar?.weeks?.get?.(start) || null;
    let box = q('#v8MicroWeekContext');
    if (!micro) { if (box) box.remove(); calendarSignature = ''; return; }
    const meso = micro._meso, mesoMeta = guideMeta(meso?.notes), meta = guideMeta(micro.notes), type = microTypeLabel(micro), stimulus = meta.stimulus || '', target = weekLoad(micro) || Number(week?.target_load || 0), planned = plannedSessionLoad(week), remaining = target ? target - planned : null;
    const sig = [micro.id, start, stimulus, target, planned, week?.workouts?.length || 0].join('|'); if (!force && sig === calendarSignature) return; calendarSignature = sig;
    if (!box) { box = document.createElement('section'); box.id = 'v8MicroWeekContext'; box.className = 'card v8-micro-week-context'; const map = q('#v8SeasonMap', host), workspace = q('.calendar-workspace', host); if (map?.nextSibling) host.insertBefore(box, map.nextSibling); else host.insertBefore(box, workspace || host.firstChild); }
    box.innerHTML = `<div class="card-head"><div><p class="eyebrow">Contexto del microciclo</p><h2>${esc(micro.name || type)} · ${esc(start)}</h2><p>Esta es la referencia con la que planificas las sesiones de la semana.</p></div><div class="actions"><button class="btn soft small" id="v8EditWeekStimulus" type="button">${stimulus ? 'Editar estímulo' : 'Definir estímulo'}</button>${stimulus ? '<button class="btn primary small" id="v8PlanWeekSessions" type="button">Planificar sesiones</button>' : ''}</div></div><div class="card-body"><div class="v8-week-context-grid"><div><span>Fase</span><strong>${esc(mesoMeta.phase || meso?.name || '—')}</strong></div><div><span>P1 del meso</span><strong>${esc(meso?.primary_adaptation || '—')}</strong></div><div><span>Tipo micro</span><strong>${esc(type)}</strong></div><div><span>Estímulo semanal</span><strong>${esc(stimulus || 'Sin definir')}</strong></div><div><span>Carga objetivo</span><strong>${target ? Math.round(target) : '—'}</strong></div><div><span>Carga sesiones</span><strong>${Math.round(planned)}</strong></div><div class="${remaining !== null && remaining < 0 ? 'over' : ''}"><span>${remaining !== null && remaining < 0 ? 'Sobre objetivo' : 'Falta por planificar'}</span><strong>${remaining === null ? '—' : Math.abs(Math.round(remaining))}</strong></div></div>${stimulus ? `<div class="v8-week-plan-rule"><strong>${esc(type)} + ${esc(stimulus)}</strong><span>${esc(microGuidance(type))}</span><small>Mientras añades sesiones, RunFlow irá comparando su carga acumulada con la carga objetivo de este microciclo.</small></div>` : '<div class="v8-guided-warning"><strong>Antes de meter sesiones:</strong> define el estímulo de este microciclo en el Planificador Guiado.</div>'}</div>`;
    q('#v8EditWeekStimulus', box)?.addEventListener('click', () => openStimulusPlanner(micro.id, meso?.id));
    q('#v8PlanWeekSessions', box)?.addEventListener('click', () => openLibrary(stimulus));
    enhanceSeasonMapLabels();
  }

  function openStimulusPlanner(microId, mesoId) {
    const flow = readFlow(); flow.microId = microId; if (mesoId) flow.mesoId = mesoId; const micro = micros().find(m => String(m.id) === String(microId)); const meta = guideMeta(micro?.notes); if (meta.stimulus) flow.stimulus = meta.stimulus; writeFlow(flow);
    window.RunFlowV8Planner?.open?.(); setTimeout(() => q('#v8GuidedSteps [data-guide-step="4"]')?.click(), 240);
  }

  function enhanceSeasonMapLabels() {
    qa('#v8SeasonMap .v8-season-row').forEach((row, index) => {
      const macro = macros()[index]; if (!macro) return;
      const stats = macroWeekStats(macro); const label = q('.v8-season-label', row); if (!label) return;
      let line = q('.v8-macro-week-count-line', label); if (!line) { line = document.createElement('small'); line.className = 'v8-macro-week-count-line'; label.appendChild(line); }
      line.textContent = `${stats.total} sem · ${stats.assigned} asignadas · ${stats.remaining} por cubrir`;
    });
    qa('#v8SeasonMap [data-micro-id]').forEach(button => {
      const micro = micros().find(m => String(m.id) === String(button.dataset.microId)); if (!micro) return;
      const meta = guideMeta(micro.notes), small = q('small', button); if (!small) return;
      const load = meta.loadPct ? `${meta.loadPct}%` : (weekLoad(micro) ? `carga ${Math.round(weekLoad(micro))}` : '');
      small.textContent = [meta.stimulus, load].filter(Boolean).join(' · ') || 'estímulo pendiente';
    });
  }

  const observer = new MutationObserver(() => {
    if (q('#v8GuidedPlanner.open')) setTimeout(() => renderPlannerEnhancements(false), 0);
    if (q('#weekView')) setTimeout(() => { renderCalendarContext(false); enhanceSeasonMapLabels(); }, 40);
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('click', event => {
    if (event.target.closest('#v8GuidedSteps .v8-guided-step-pill')) setTimeout(() => renderPlannerEnhancements(true), 30);
    if (event.target.closest('[data-select-week]')) setTimeout(() => renderCalendarContext(true), 260);
  }, true);
  q('#athleteSelect')?.addEventListener('change', () => setTimeout(() => { renderPlannerEnhancements(true); renderCalendarContext(true); }, 180));
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => { renderPlannerEnhancements(false); renderCalendarContext(true); enhanceSeasonMapLabels(); }, 1000), { once: true });
  setInterval(() => { if (q('#weekView.active')) { renderCalendarContext(false); enhanceSeasonMapLabels(); } }, 1400);
})();
