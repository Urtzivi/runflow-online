/*
 * RunFlow Coach · Planificación (running).
 * Pantalla única para un coach sin mucha experiencia en planificación:
 *   1. Temporada: una barra con los bloques, las semanas y «estás aquí».
 *   2. Semana: RunFlow prepara la propuesta cuando toca (con la disponibilidad de ese momento),
 *      el coach la revisa y la publica en Intervals y en la app.
 * Sustituye a la planificación antigua (macro/meso/microciclos a mano), que sigue accesible
 * desde «Planificación antigua» mientras se hace el cambio.
 * El cálculo vive en running-guided-plan.js (RunFlowRunningPlan); la temporada se crea con
 * el asistente de coach-running-guided-plan.js.
 */
(() => {
  'use strict';
  const P = window.RunFlowRunningPlan;
  if (!P) return;
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const appState = () => { try { return state; } catch { return null; } };
  const athleteId = () => appState()?.athlete?.id || '';
  const plan = () => appState()?.plan || null;
  const notify = (message, type = 'success') => { try { showMessage(message, type); } catch { window.alert(message); } };
  const apiCall = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
    return data;
  };
  const base = () => `/api/coach/athletes/${encodeURIComponent(athleteId())}`;
  const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dayName = iso => ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][P.dayIndex(iso)];
  const fmt = iso => P.formatDate(iso);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const isOptional = workout => workout?.optional || /^Opcional\s*·/i.test(String(workout?.title || ''));

  const WEEK_TYPE_LABEL = { adaptation: 'Adaptación', load: 'Carga', development: 'Construcción', overload: 'Sobrecarga', deload: 'Descarga', recovery: 'Vuelta suave', taper: 'Afinamiento', competition: 'Carrera' };
  const MICRO_TYPE_LABEL = { ...WEEK_TYPE_LABEL };

  const ui = { installed: false, selected: null, busy: '', library: null, legacy: false };

  // ---------- Datos ----------
  function guidedMacro() {
    return (plan()?.macrocycles || []).find(macro => P.readAnswers(macro.notes)) || null;
  }
  function microById(id) {
    for (const macro of plan()?.macrocycles || []) for (const meso of macro.mesocycles || []) {
      const micro = (meso.microcycles || []).find(item => String(item.id) === String(id));
      if (micro) return micro;
    }
    return null;
  }
  function seasonModel() {
    const macro = guidedMacro();
    if (!macro) return null;
    const answers = P.readAnswers(macro.notes);
    let structure;
    try { structure = P.structureFromPlan(answers, macro); } catch { return null; }
    if (!structure.weeks.length) return null;
    const today = localToday();
    structure.weeks.forEach(week => {
      const micro = microById(week.micro_id);
      week.micro = micro;
      week.workouts = (micro?.workouts || []).slice().sort((a, b) => String(a.workout_date).localeCompare(String(b.workout_date)) || Number(Boolean(a.is_strength)) - Number(Boolean(b.is_strength)));
      week.published = micro?.publication_status === 'published';
      week.past = week.end < today;
      week.current = week.start <= today && week.end >= today;
      week.status = week.published ? 'published' : week.workouts.length ? 'draft' : 'empty';
    });
    const current = structure.weeks.find(week => week.current)
      || (today < structure.weeks[0].start ? null : structure.weeks[structure.weeks.length - 1]);
    return { macro, answers, structure, current, today };
  }
  // La semana que necesita al coach: la actual si no está publicada; si no, la siguiente sin publicar.
  function defaultWeek(model) {
    const upcoming = model.structure.weeks.filter(week => !week.past);
    return upcoming.find(week => !week.published) || upcoming[0] || model.structure.weeks[model.structure.weeks.length - 1];
  }
  async function loadLibrary() {
    if (ui.library) return ui.library;
    const data = await apiCall('/api/v9/library');
    ui.library = data.sessions || [];
    return ui.library;
  }
  async function loadProfile() {
    try { return window.RunFlowAvailability ? await window.RunFlowAvailability.load(true) : await apiCall(`/api/v9/coach/athletes/${encodeURIComponent(athleteId())}/dynamic-profile`); }
    catch { return null; }
  }
  function microPayload(micro, workouts, status) {
    const planned = micro.planned || {};
    return {
      name: micro.name, title: micro.name, week_start: micro.start_date, start_date: micro.start_date, end_date: micro.end_date,
      mesocycle_id: micro.mesocycle_id, microcycle_type: micro.type, type: micro.type, primary_objective: micro.primary_objective,
      week_type: MICRO_TYPE_LABEL[micro.type] || micro.week_type || 'Planificación', coach_comment: micro.notes || '', notes: micro.notes || '',
      target_load: Number(planned.load || 0), planned, planned_hours: Number(planned.hours || 0), planned_distance_km: Number(planned.distance_km || 0),
      planned_elevation_m: Number(planned.elevation_m || 0), planned_strength_sessions: Number(planned.strength_sessions || 0),
      recovery_target: micro.recovery_target || '', lifecycle_status: micro.lifecycle_status || 'planned',
      publication_status: status, status, workouts,
    };
  }
  async function reload() {
    if (typeof window.loadPlan === 'function') await window.loadPlan(appState()?.selectedSeasonId || plan()?.season?.id || null);
    render();
  }

  // ---------- Acciones ----------
  async function prepareWeek(week, model) {
    if (!week?.micro) return;
    if (week.published) return notify('Esta semana ya está publicada. Para cambiarla, edita sus sesiones.', 'error');
    if (week.workouts.length && !window.confirm('Esta semana ya tiene una propuesta. ¿Hacer una nueva? Se pierden los cambios que hayas hecho en ella.')) return;
    ui.busy = 'Preparando la semana…'; render();
    try {
      const [library, profile] = await Promise.all([loadLibrary(), loadProfile()]);
      // La disponibilidad de hoy manda: si ha cambiado desde que se creó el plan, la semana nueva la respeta.
      const days = P.daysFromProfile(profile) || model.answers.days;
      const answers = { ...model.answers, days };
      if (!days.some(day => Number(day.minutes) > 0 && (day.day === Number(answers.long_day)) && P.runsOn(day))) {
        const longest = days.filter(P.runsOn).sort((a, b) => b.minutes - a.minutes)[0];
        if (longest) answers.long_day = longest.day;
      }
      const workouts = P.buildWeekSessions(answers, model.structure, week, library);
      if (!workouts.length) throw new Error('No hay días para correr en su disponibilidad. Revisa la ficha del atleta.');
      const micro = { ...week.micro, planned: { ...(week.micro.planned || {}), load: workouts.filter(w => !w.optional).reduce((sum, w) => sum + (Number(w.planned_load) || 0), 0), strength_sessions: workouts.filter(w => w.is_strength).length } };
      await apiCall(`${base()}/microcycles/${encodeURIComponent(micro.id)}`, { method: 'PUT', headers: { 'X-RunFlow-Planning-Origin': 'guided' }, body: JSON.stringify(microPayload(micro, workouts, 'draft')) });
      ui.busy = '';
      await reload();
      notify('Semana preparada en borrador. Revísala y publícala cuando esté bien.', 'success');
    } catch (error) { ui.busy = ''; render(); notify(error.message, 'error'); }
  }
  async function removeWorkout(week, workoutId) {
    if (!week?.micro || week.published) return;
    const workouts = week.workouts.filter(item => String(item.id) !== String(workoutId));
    ui.busy = 'Guardando…'; render();
    try {
      await apiCall(`${base()}/microcycles/${encodeURIComponent(week.micro.id)}`, { method: 'PUT', headers: { 'X-RunFlow-Planning-Origin': 'guided' }, body: JSON.stringify(microPayload(week.micro, workouts, 'draft')) });
      ui.busy = ''; await reload();
    } catch (error) { ui.busy = ''; render(); notify(error.message, 'error'); }
  }
  async function publishWeek(week) {
    const workouts = week?.workouts || [];
    if (!workouts.length) return notify('Prepara la semana antes de publicarla.', 'error');
    if (window.RunFlowAvailability?.validateWorkout) {
      for (const workout of workouts) {
        const result = await window.RunFlowAvailability.validateWorkout(workout);
        if (!result.ok) return notify(result.error, 'error');
      }
    }
    if (!window.confirm(`¿Publicar ${plural(workouts.length, 'sesión', 'sesiones')} de la semana del ${fmt(week.start)}? Le llegarán al atleta en Intervals y en la app.`)) return;
    ui.busy = 'Publicando…'; render();
    try {
      const response = await apiCall(`${base()}/week/publish`, { method: 'POST', body: JSON.stringify(microPayload(week.micro, workouts, 'published')) });
      ui.busy = ''; await reload();
      const sync = response.intervals?.skipped ? ` ${response.intervals.reason || ''}` : ` ${response.intervals?.exported || 0} sesiones enviadas a Intervals.`;
      notify(`Semana publicada.${sync}`, 'success');
    } catch (error) { ui.busy = ''; render(); notify(error.message, 'error'); }
  }
  async function editWorkout(week, workoutId) {
    try {
      appState().calendar.month = new Date(`${week.start}T12:00:00`);
      await loadCalendarMonth(false);
      selectCalendarWeek(week.start, false);
      const workout = week.workouts.find(item => String(item.id) === String(workoutId));
      openSessionModal(workoutId || null, workout?.workout_date || week.start);
    } catch (error) { notify(error.message, 'error'); }
  }
  async function deleteSeason() {
    const season = plan()?.season;
    if (!season?.id) return;
    if (!window.confirm(`¿Borrar la temporada «${season.name}»?\n\nSe borra toda su planificación y las sesiones planificadas, también las enviadas a Intervals. Lo que el atleta ya ha hecho se conserva. No se puede deshacer.`)) return;
    ui.busy = 'Borrando…'; render();
    try {
      await apiCall(`${base()}/seasons/${encodeURIComponent(season.id)}`, { method: 'DELETE' });
      try { localStorage.removeItem(`runflow_plan_season_${athleteId()}`); } catch {}
      ui.busy = ''; ui.selected = null;
      appState().selectedSeasonId = null;
      if (typeof window.loadPlan === 'function') await window.loadPlan(null);
      render();
      notify('Temporada borrada. Lo realizado por el atleta se conserva.', 'success');
    } catch (error) { ui.busy = ''; render(); notify(error.message, 'error'); }
  }

  // ---------- Pintado ----------
  function seasonSelect() {
    const seasons = appState()?.seasons || [];
    if (seasons.length < 2) return '';
    const current = plan()?.season?.id;
    return `<label class="sp-select">Temporada <select data-sp-season>${seasons.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(current) ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>`;
  }
  function renderEmpty() {
    const season = plan()?.season;
    if (season) {
      return `<div class="sp-card sp-empty"><span class="sp-eyebrow">Planificación</span><h2>${esc(season.name)}</h2>
        <p>Esta temporada se creó con la planificación antigua, así que RunFlow no puede preparar sus semanas. Puedes seguir viéndola en la planificación antigua o crear una temporada nueva con el asistente.</p>
        <div class="sp-actions"><button class="btn primary" data-sp-act="create">Crear temporada nueva</button><button class="btn soft" data-sp-act="legacy">Ver en la planificación antigua</button>${seasonSelect()}</div></div>`;
    }
    return `<div class="sp-card sp-empty"><span class="sp-eyebrow">Planificación</span><h2>Todavía no hay temporada</h2>
      <p>Responde unas preguntas (carrera, fecha, cómo está el atleta y qué días puede entrenar) y RunFlow prepara la temporada entera hasta la carrera. Después, cada semana preparas y publicas la siguiente.</p>
      <div class="sp-actions"><button class="btn primary" data-sp-act="create">Crear temporada</button>${seasonSelect()}</div></div>`;
  }
  function renderHeader(model) {
    const { answers, structure, today } = model;
    const raceName = answers.race_name || structure.race.label;
    const left = Math.max(0, Math.ceil((new Date(`${answers.race_date}T12:00:00`) - new Date(`${today}T12:00:00`)) / (7 * 86400000)));
    const goal = answers.goal_mode === 'marca' && answers.target_time ? `Objetivo: bajar de ${answers.target_time}` : 'Objetivo: terminarla bien';
    const status = today > answers.race_date ? 'La carrera ya ha pasado' : today < structure.start ? `Empieza el ${fmt(structure.start)}` : `Faltan ${plural(left, 'semana', 'semanas')}`;
    return `<header class="sp-head">
      <div><span class="sp-eyebrow">Temporada</span><h2>${esc(raceName)} · ${esc(fmt(answers.race_date))}</h2>
      <p>${esc(structure.race.label)} · ${esc(goal)} · <b>${esc(status)}</b></p></div>
      <div class="sp-actions">${seasonSelect()}<button class="btn soft" data-sp-act="delete">Borrar temporada</button></div>
    </header>`;
  }
  function renderBar(model) {
    const { structure, current } = model;
    const max = Math.max(...structure.weeks.map(week => week.minutes || 0), 60);
    const cols = structure.weeks.length;
    const cells = structure.weeks.map((week, i) => {
      const h = Math.max(14, Math.round((week.minutes || 0) / max * 100));
      const selected = ui.selected === week.start;
      const light = ['deload', 'recovery', 'taper', 'competition'].includes(week.type);
      const label = `Semana ${week.index} · ${fmt(week.start)} – ${fmt(week.end)} · ${PHASE_NAME(week.phase)} · ${WEEK_TYPE_LABEL[week.type] || week.label} · ≈ ${week.minutes} min · ${STATUS_TEXT[week.status]}`;
      return `<button type="button" class="sp-wk p-${esc(week.phase)}${light ? ' light' : ''}${selected ? ' sel' : ''}${week.past ? ' past' : ''}" style="grid-column:${i + 1}" data-sp-week="${esc(week.start)}" title="${esc(label)}" aria-label="${esc(label)}">
        ${week === current ? '<span class="sp-here">Estás aquí</span>' : ''}${week.type === 'competition' ? '<span class="sp-flag">🏁</span>' : ''}
        <span class="sp-col"><i style="height:${h}%"></i></span><span class="sp-dot s-${week.status}"></span><small>${week.index}</small></button>`;
    }).join('');
    let col = 1;
    const phases = structure.mesos.map(meso => {
      const span = meso.weeks.length; const start = col; col += span;
      return `<div class="sp-phase p-${esc(meso.key)}" style="grid-column:${start} / span ${span}" title="${esc(meso.goal)}">${esc(span > 1 ? meso.name : meso.name.slice(0, 4) + '.')}</div>`;
    }).join('');
    return `<section class="sp-card"><div class="sp-card-head"><h3>La temporada, semana a semana</h3><span class="sp-muted">La altura es el tiempo de entrenamiento previsto. Toca una semana para verla.</span></div>
      <div class="sp-bar-scroll"><div class="sp-bar" style="--cols:${cols}">${cells}${phases}</div></div>
      <div class="sp-legend"><span><i class="s-published"></i>Publicada</span><span><i class="s-draft"></i>Preparada, sin publicar</span><span><i class="s-empty"></i>Por preparar</span><span><i class="light-key"></i>Semana suave</span></div>
    </section>`;
  }
  const PHASE_NAME = key => P.PHASES[key]?.name || key;
  const STATUS_TEXT = { published: 'publicada', draft: 'preparada, sin publicar', empty: 'por preparar' };
  function renderBlock(model, week) {
    const meso = model.structure.mesos.find(item => item.weeks.includes(week));
    if (!meso) return '';
    const position = meso.weeks.indexOf(week) + 1;
    const strength = model.answers.strength && meso.strength?.perWeek ? `<p><b>Fuerza · ${esc(meso.strength.name)}:</b> ${esc(meso.strength.goal)}</p>` : '';
    return `<section class="sp-card sp-block p-${esc(meso.key)}"><span class="sp-eyebrow">Bloque · semana ${position} de ${meso.weeks.length}</span><h3>${esc(meso.name)}</h3>
      <p>${esc(meso.goal)}</p><p class="sp-muted"><b>Por qué:</b> ${esc(meso.why)}</p><p class="sp-muted"><b>Funciona si:</b> ${esc(meso.success)}</p>${strength}</section>`;
  }
  function workoutRow(workout, week) {
    const optional = isOptional(workout);
    const tag = workout.is_strength ? 'Fuerza' : optional ? 'Opcional' : workout.priority === 'A' ? 'Clave' : workout.priority === 'B' ? 'Importante' : 'Suave';
    const title = String(workout.title || 'Sesión').replace(/^Opcional\s*·\s*/i, '');
    return `<li class="sp-session${optional ? ' optional' : ''}${workout.is_strength ? ' strength' : ''}">
      <div class="sp-day"><b>${esc(dayName(workout.workout_date).slice(0, 3))}</b><small>${esc(fmt(workout.workout_date))}</small></div>
      <div class="sp-session-main"><span class="sp-tag t-${esc(tag.toLowerCase())}">${esc(tag)}</span><strong>${esc(title)}</strong><small>${esc(workout.summary || '')}</small></div>
      <div class="sp-session-side"><span>${Number(workout.planned_duration_min) ? `${Number(workout.planned_duration_min)} min` : '—'}</span>
        <div class="sp-session-actions"><button class="btn soft small" data-sp-edit="${esc(workout.id)}" type="button">Editar</button>${week.published ? '' : `<button class="btn soft small" data-sp-remove="${esc(workout.id)}" type="button" title="Quitar de la semana">Quitar</button>`}</div></div>
    </li>`;
  }
  function renderWeek(model, week) {
    const minutes = week.workouts.filter(w => !isOptional(w)).reduce((sum, w) => sum + (Number(w.planned_duration_min) || 0), 0);
    const badge = `<span class="sp-badge s-${week.status}">${week.published ? 'Publicada' : week.status === 'draft' ? 'Borrador' : 'Por preparar'}</span>`;
    const busy = ui.busy ? `<div class="sp-busy">${esc(ui.busy)}</div>` : '';
    let body;
    if (week.status === 'empty') {
      body = week.past
        ? '<div class="sp-note">Esta semana ya ha pasado sin sesiones planificadas.</div>'
        : `<div class="sp-prepare"><p>RunFlow prepara las sesiones de esta semana con la biblioteca, el bloque en el que está y lo que el atleta puede hacer cada día según su ficha. Se guardan en borrador: tú decides cuándo se publican.</p>
          <button class="btn primary" data-sp-act="prepare" ${ui.busy ? 'disabled' : ''}>Preparar esta semana</button></div>`;
    } else {
      body = `<ul class="sp-sessions">${week.workouts.map(workout => workoutRow(workout, week)).join('')}</ul>
        <div class="sp-week-foot"><span class="sp-muted">${plural(week.workouts.filter(w => !isOptional(w)).length, 'sesión', 'sesiones')} · ≈ ${minutes} min${week.workouts.some(isOptional) ? ' · las opcionales no cuentan' : ''}</span>
        <div class="sp-actions">${week.published ? '<span class="sp-muted">Ya la tiene el atleta. Si editas una sesión, se actualiza al guardar.</span>' : `<button class="btn soft" data-sp-act="add" type="button">+ Añadir sesión</button><button class="btn soft" data-sp-act="prepare" type="button" ${ui.busy ? 'disabled' : ''}>Hacer otra propuesta</button><button class="btn primary" data-sp-act="publish" type="button" ${ui.busy ? 'disabled' : ''}>Publicar semana</button>`}</div></div>`;
    }
    const prev = model.structure.weeks[week.index - 2], next = model.structure.weeks[week.index];
    return `<section class="sp-card sp-week">
      <div class="sp-week-head"><div><span class="sp-eyebrow">Semana ${week.index} de ${model.structure.weeks.length}${week.current ? ' · esta semana' : ''}</span>
        <h3>${esc(dayName(week.start))} ${esc(fmt(week.start))} – ${esc(dayName(week.end))} ${esc(fmt(week.end))} ${badge}</h3>
        <p><b>${esc(WEEK_TYPE_LABEL[week.type] || week.label)}</b> · ≈ ${week.minutes} min previstos. ${esc(week.why)}${week.b_race ? ` Esta semana hay carrera de preparación (${esc(week.b_race.name || 'objetivo B')}).` : ''}</p></div>
        <div class="sp-nav"><button class="btn soft small" data-sp-week="${esc(prev?.start || '')}" ${prev ? '' : 'disabled'} aria-label="Semana anterior">←</button><button class="btn soft small" data-sp-week="${esc(next?.start || '')}" ${next ? '' : 'disabled'} aria-label="Semana siguiente">→</button></div></div>
      ${busy}${body}</section>`;
  }
  function render() {
    const root = q('#spRoot');
    if (!root) return;
    const planView = q('#planView');
    planView?.classList.toggle('sp-mode', !ui.legacy);
    // La planificación antigua oculta todo lo que no es suyo (v10-mode): solo se activa al abrirla.
    if (planView && !ui.legacy) planView.classList.remove('v10-mode');
    if (planView && ui.legacy && !planView.classList.contains('v10-mode')) { planView.classList.add('v10-mode'); q('#v10SeasonPlanner')?.classList.remove('hidden'); }
    if (ui.legacy) { root.innerHTML = ''; return; }
    if (!athleteId()) { root.innerHTML = '<div class="sp-card sp-empty"><h2>Selecciona un deportista</h2></div>'; return; }
    const model = seasonModel();
    if (!model) { root.innerHTML = renderEmpty() + legacyLink(); return; }
    let week = model.structure.weeks.find(item => item.start === ui.selected);
    if (!week) { week = defaultWeek(model); ui.selected = week.start; }
    root.innerHTML = `${renderHeader(model)}${renderBar(model)}<div class="sp-grid">${renderWeek(model, week)}${renderBlock(model, week)}</div>${legacyLink()}`;
  }
  const legacyLink = () => '<p class="sp-legacy"><button type="button" class="sp-link" data-sp-act="legacy">Abrir la planificación antigua</button></p>';

  // ---------- Eventos ----------
  function currentContext() {
    const model = seasonModel();
    const week = model?.structure.weeks.find(item => item.start === ui.selected);
    return { model, week };
  }
  function onClick(event) {
    const el = event.target.closest('[data-sp-act],[data-sp-week],[data-sp-edit],[data-sp-remove]');
    if (!el || !q('#spRoot')?.contains(el) && !el.matches('[data-sp-act="back"]')) return;
    if (el.dataset.spWeek !== undefined) { if (el.dataset.spWeek) { ui.selected = el.dataset.spWeek; render(); } return; }
    if (ui.busy) return;
    const { model, week } = currentContext();
    if (el.dataset.spEdit) return editWorkout(week, el.dataset.spEdit);
    if (el.dataset.spRemove) return removeWorkout(week, el.dataset.spRemove);
    const act = el.dataset.spAct;
    if (act === 'create') return window.RunFlowRunningGuidedPlan?.open();
    if (act === 'legacy') { ui.legacy = true; render(); return; }
    if (act === 'back') { ui.legacy = false; render(); return; }
    if (act === 'delete') return deleteSeason();
    if (act === 'prepare') return prepareWeek(week, model);
    if (act === 'publish') return publishWeek(week);
    if (act === 'add') return editWorkout(week, null);
  }
  function onChange(event) {
    const select = event.target.closest('[data-sp-season]');
    if (!select) return;
    ui.selected = null;
    appState().selectedSeasonId = select.value;
    window.loadPlan?.(select.value).then(render).catch(error => notify(error.message, 'error'));
  }

  function install() {
    const planView = q('#planView');
    if (ui.installed || !planView || !appState() || !q('#v10SeasonPlanner')) return false;
    ui.installed = true;
    const root = document.createElement('section');
    root.id = 'spRoot';
    root.className = 'sp-root';
    (planView.querySelector(':scope > .stack') || planView).prepend(root);
    const back = document.createElement('div');
    back.id = 'spBackBar';
    back.className = 'sp-back';
    back.innerHTML = '<span>Estás en la planificación antigua.</span><button type="button" class="btn primary small" data-sp-act="back">Volver a la nueva planificación</button>';
    planView.prepend(back);
    document.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    // Cada vez que se recarga el plan (cambio de atleta, de temporada, el asistente o el calendario), se repinta.
    const originalLoadPlan = window.loadPlan;
    if (typeof originalLoadPlan === 'function') window.loadPlan = async (...args) => { const result = await originalLoadPlan(...args); render(); return result; };
    const originalPersist = window.persistCalendarWeek;
    if (typeof originalPersist === 'function') window.persistCalendarWeek = async (...args) => {
      const result = await originalPersist(...args);
      if (!ui.legacy && q('#planView')?.classList.contains('active')) await window.loadPlan?.(appState()?.selectedSeasonId || plan()?.season?.id || null);
      return result;
    };
    window.addEventListener('runflow:v9-athlete-ready', () => { ui.selected = null; setTimeout(render, 60); });
    document.addEventListener('click', event => {
      const navigation = event.target.closest('[data-v8-view],[data-view]');
      const view = navigation?.dataset.v8View || navigation?.dataset.view;
      if (view === 'plan') setTimeout(async () => { if (!plan() && athleteId()) { try { await window.loadPlan?.(appState()?.selectedSeasonId || null); } catch {} } render(); }, 120);
    }, true);
    render();
    setTimeout(render, 400);
    return true;
  }
  function wait(attempt = 0) {
    if (install()) return;
    if (attempt < 300) setTimeout(() => wait(attempt + 1), 50);
  }
  wait();
  window.RunFlowSeasonPlan = { render };
})();
