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

  const ui = { installed: false, selected: null, busy: '', library: null, legacy: false, modal: null, advice: {} };

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
    const incidents = P.readIncidents(macro.notes);
    const active = P.activeIncident(incidents);
    // Mientras dura el problema, las semanas desde que empezó (y que no han pasado) se preparan adaptadas.
    structure.weeks.forEach(week => { week.inIncident = Boolean(active) && !week.past && week.end >= P.mondayOf(active.from); });
    return { macro, answers, structure, current, today, incidents, active };
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
  // Notas de la semana: se marca si es una semana adaptada (lesión, enfermedad…) para pintarla distinta.
  function weekNotes(micro, adaptedState, adjust = '') {
    const clean = String(micro.notes || '').split('\n').filter(line => !line.startsWith(P.ADAPTED_PREFIX) && !line.startsWith(P.ADJUST_PREFIX)).join('\n').trim();
    return [clean, adaptedState ? `${P.ADAPTED_PREFIX}${adaptedState}` : '', adjust].filter(Boolean).join('\n');
  }
  // Guarda las sesiones de una semana. Si ya estaba publicada, se vuelve a publicar (así Intervals
  // borra las sesiones que ya no están); si no, queda en borrador.
  async function saveWeekWorkouts(week, workouts, { notes, type, planned, republish } = {}) {
    const micro = { ...week.micro, notes: notes ?? week.micro.notes, type: type || week.micro.type, planned: { ...(week.micro.planned || {}), ...(planned || {}) } };
    micro.planned.load = workouts.filter(w => !isOptional(w)).reduce((sum, w) => sum + (Number(w.planned_load) || 0), 0);
    micro.planned.strength_sessions = workouts.filter(w => w.is_strength).length;
    if (week.published && republish) {
      const response = await apiCall(`${base()}/week/publish`, { method: 'POST', body: JSON.stringify(microPayload(micro, workouts, 'published')) });
      return response;
    }
    await apiCall(`${base()}/microcycles/${encodeURIComponent(micro.id)}`, { method: 'PUT', headers: { 'X-RunFlow-Planning-Origin': 'guided' }, body: JSON.stringify(microPayload(micro, workouts, week.published ? 'published' : 'draft')) });
    return null;
  }
  async function currentDays(model) {
    const profile = await loadProfile();
    return { profile, days: P.daysFromProfile(profile) || model.answers.days };
  }
  // Propuesta de la semana: la del plan o, si hay un problema activo, la adaptada a su estado.
  async function proposalFor(model, week, overrides = {}) {
    const { days } = await currentDays(model);
    const incident = overrides.incident || (week.inIncident ? model.active : null);
    if (incident) {
      const fromDate = week.start <= model.today ? model.today : week.start;
      // Lo que puede hacer mientras tanto ya se añadió a su ficha; si la ficha no está rellena, se añade aquí.
      return { workouts: P.buildAdaptedWeek(incident, week, withTypes(days, incident.can || []), { fromDate }), adapted: incident.state || P.initialState(incident), fromDate };
    }
    const library = await loadLibrary();
    const answers = { ...model.answers, days };
    if (!days.some(day => day.day === Number(answers.long_day) && P.runsOn(day))) {
      const longest = days.filter(P.runsOn).sort((a, b) => b.minutes - a.minutes)[0];
      if (longest) answers.long_day = longest.day;
    }
    // Ajuste según cómo viene el atleta (más o menos minutos; al bajar, una sola sesión dura).
    const target = overrides.adjust ? P.adjustWeek(overrides.week || week, overrides.adjust) : overrides.week || week;
    // Una semana cambiada (p. ej. a descarga) ocupa el sitio de la original en la temporada.
    const structure = target === week ? model.structure : { ...model.structure, weeks: model.structure.weeks.map(item => item === week ? target : item) };
    const workouts = P.buildWeekSessions(answers, structure, target, library);
    if (!workouts.length) throw new Error('No hay días para correr en su disponibilidad. Revisa la ficha del atleta.');
    return { workouts, adapted: null, fromDate: null, adjust: overrides.adjust ? P.adjustNote(overrides.adjust) : '' };
  }
  // Lo ya pasado de la semana no se toca.
  const keepPast = (week, fromDate, workouts) => fromDate ? [...week.workouts.filter(w => String(w.workout_date) < fromDate), ...workouts] : workouts;
  async function prepareWeek(week, model, overrides = {}) {
    if (!week?.micro) return;
    if (week.published && !week.inIncident) return notify('Esta semana ya está publicada. Para cambiarla, edita sus sesiones.', 'error');
    if (week.published && !window.confirm('Esta semana ya está publicada. Se cambiarán sus sesiones (a partir de hoy) y se volverá a publicar en Intervals y en la app. ¿Seguir?')) return;
    if (!week.published && week.workouts.length && !overrides.silent && !window.confirm('Esta semana ya tiene una propuesta. ¿Hacer una nueva? Se pierden los cambios que hayas hecho en ella.')) return;
    ui.busy = 'Preparando la semana…'; render();
    try {
      const proposal = await proposalFor(model, week, overrides);
      const workouts = keepPast(week, proposal.fromDate, proposal.workouts);
      const response = await saveWeekWorkouts(week, workouts, { notes: weekNotes(week.micro, proposal.adapted, proposal.adjust), republish: true });
      ui.busy = '';
      await reload();
      if (response) notify(`Semana cambiada y publicada de nuevo.${response.intervals?.skipped ? ` ${response.intervals.reason || ''}` : ''}`, 'success');
      else notify(proposal.adapted ? 'Semana adaptada en borrador. Revísala y publícala.' : proposal.adjust ? 'Semana preparada con el ajuste, en borrador. Revísala y publícala cuando esté bien.' : 'Semana preparada en borrador. Revísala y publícala cuando esté bien.', 'success');
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
        <div class="sp-actions"><button class="btn primary" data-sp-act="create">Crear temporada nueva</button><button class="btn soft" data-sp-act="legacy">Ver en la planificación antigua</button><button class="btn soft" data-sp-act="delete">Borrar temporada</button>${seasonSelect()}</div></div>`;
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
      <p>${esc(structure.race.label)} · ${esc(P.courseText(P.courseOf(answers)))} · ${esc(goal)} · <b>${esc(status)}</b></p></div>
      <div class="sp-actions">${seasonSelect()}${model.active ? '' : '<button class="btn primary" data-sp-act="incident">Ha pasado algo</button>'}<button class="btn soft" data-sp-act="delete">Borrar temporada</button></div>
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
      const label = `Semana ${week.index} · ${fmt(week.start)} – ${fmt(week.end)} · ${PHASE_NAME(week.phase)} · ${week.adapted ? 'adaptada' : WEEK_TYPE_LABEL[week.type] || week.label} · ≈ ${week.minutes} min · ${STATUS_TEXT[week.status]}`;
      const pending = model.active && current && week.start > current.end;
      return `<button type="button" class="sp-wk p-${esc(week.phase)}${light ? ' light' : ''}${selected ? ' sel' : ''}${week.past ? ' past' : ''}${week.adapted ? ' adapted' : ''}${pending ? ' pending' : ''}" style="grid-column:${i + 1}" data-sp-week="${esc(week.start)}" title="${esc(label)}" aria-label="${esc(label)}">
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
      <div class="sp-legend"><span><i class="s-published"></i>Publicada</span><span><i class="s-draft"></i>Preparada, sin publicar</span><span><i class="s-empty"></i>Por preparar</span><span><i class="light-key"></i>Semana suave</span>${model.structure.weeks.some(w => w.adapted) || model.active ? '<span><i class="adapted-key"></i>Adaptada (lesión, enfermedad…)</span>' : ''}${model.active ? '<span><i class="pending-key"></i>Se recalcula al volver</span>' : ''}</div>
    </section>`;
  }
  const PHASE_NAME = key => P.PHASES[key]?.name || key;
  const STATUS_TEXT = { published: 'publicada', draft: 'preparada, sin publicar', empty: 'por preparar' };
  // ---------- Cómo viene el atleta (historial) ----------
  const adviceKey = week => `${athleteId()}|${week.start}`;
  const adviceApplies = (model, week) => week.status === 'empty' && !week.past && !week.inIncident && week.start <= P.addDays(model.today, 13);
  async function loadAdvice(model, week) {
    const key = adviceKey(week);
    if (ui.advice[key]) return;
    ui.advice[key] = { loading: true };
    const today = model.today;
    try {
      const [calendar, recovery] = await Promise.all([
        apiCall(`${base()}/calendar?oldest=${P.addDays(today, -28)}&newest=${today}`),
        apiCall(`${base()}/recovery?oldest=${P.addDays(today, -40)}&newest=${today}`).catch(() => ({ rows: [] })),
      ]);
      ui.advice[key] = { result: P.weekAdvice({ week, calendarWeeks: calendar.weeks || [], recovery: recovery.rows || [], today }) };
    } catch (error) { ui.advice[key] = { error: error.message }; }
    if (ui.selected === week.start) render();
  }
  const SIGN_ICON = { ok: '✓', mid: '•', bad: '!' };
  function renderAdvice(model, week) {
    const state = ui.advice[adviceKey(week)];
    const prepareBtn = (label, cls = 'primary') => `<button class="btn ${cls}" data-sp-act="prepare" ${ui.busy ? 'disabled' : ''}>${label}</button>`;
    const intro = '<p>RunFlow prepara las sesiones de esta semana con la biblioteca, el bloque en el que está y lo que el atleta puede hacer cada día según su ficha. Se guardan en borrador: tú decides cuándo se publican.</p>';
    if (!state || state.loading) return `<div class="sp-prepare">${intro}<div class="sp-advice loading">Mirando cómo viene el atleta (últimas 2 semanas)…</div>${prepareBtn('Preparar esta semana')}</div>`;
    if (state.error) return `<div class="sp-prepare">${intro}<div class="sp-note">No se ha podido leer su historial (${esc(state.error)}).</div>${prepareBtn('Preparar esta semana')}</div>`;
    const r = state.result;
    const pct = Math.round((r.factor - 1) * 100);
    const list = r.reasons.length ? `<ul class="sp-reasons">${r.reasons.map(item => `<li class="r-${item.sign}"><span>${SIGN_ICON[item.sign]}</span>${esc(item.text)}</li>`).join('')}</ul>` : '';
    const buttons = r.decision === 'mantener'
      ? prepareBtn('Preparar esta semana')
      : `<button class="btn primary" data-sp-act="prepare-adjusted" ${ui.busy ? 'disabled' : ''}>Preparar con el ajuste (${pct > 0 ? '+' : ''}${pct} %${r.lessQuality ? ', 1 sesión dura' : ''})</button>${prepareBtn('Preparar como estaba', 'soft')}`;
    return `<div class="sp-prepare">${intro}
      <div class="sp-advice a-${esc(r.decision)}"><span class="sp-eyebrow">Cómo viene el atleta</span><h4>${esc(r.label)}</h4><p>${esc(r.why)}</p>${list}
        ${r.suggest_incident ? '<p><button class="btn soft small" data-sp-act="incident" type="button">Ha pasado algo</button></p>' : ''}</div>
      <div class="sp-actions">${buttons}</div></div>`;
  }
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
  function adjustText(week) {
    const adj = P.readAdjust(week.micro?.notes);
    return adj ? ` <b class="sp-adjusted a-${esc(adj.decision)}">Ajustada: ${esc(adj.label.toLowerCase())} (${adj.pct > 0 ? '+' : ''}${adj.pct} %)</b>` : '';
  }
  function renderWeek(model, week) {
    const minutes = week.workouts.filter(w => !isOptional(w)).reduce((sum, w) => sum + (Number(w.planned_duration_min) || 0), 0);
    const badge = `<span class="sp-badge s-${week.status}">${week.published ? 'Publicada' : week.status === 'draft' ? 'Borrador' : 'Por preparar'}</span>`;
    const busy = ui.busy ? `<div class="sp-busy">${esc(ui.busy)}</div>` : '';
    let body;
    if (week.status === 'empty') {
      body = week.past
        ? '<div class="sp-note">Esta semana ya ha pasado sin sesiones planificadas.</div>'
        : week.inIncident ? renderAdaptedPrepare(model, week)
        : adviceApplies(model, week) ? renderAdvice(model, week)
        : `<div class="sp-prepare"><p>RunFlow prepara las sesiones de esta semana con la biblioteca, el bloque en el que está y lo que el atleta puede hacer cada día según su ficha. Se guardan en borrador: tú decides cuándo se publican.</p>
          <button class="btn primary" data-sp-act="prepare" ${ui.busy ? 'disabled' : ''}>Preparar esta semana</button></div>`;
    } else {
      body = `<ul class="sp-sessions">${week.workouts.map(workout => workoutRow(workout, week)).join('')}</ul>
        <div class="sp-week-foot"><span class="sp-muted">${plural(week.workouts.filter(w => !isOptional(w)).length, 'sesión', 'sesiones')} · ≈ ${minutes} min${week.workouts.some(isOptional) ? ' · las opcionales no cuentan' : ''}</span>
        <div class="sp-actions">${week.published ? `<span class="sp-muted">Ya la tiene el atleta. Si editas una sesión, se actualiza al guardar.</span>${week.inIncident && !week.adapted ? `<button class="btn primary" data-sp-act="prepare" type="button" ${ui.busy ? 'disabled' : ''}>Adaptarla y volver a publicar</button>` : ''}` : `<button class="btn soft" data-sp-act="add" type="button">+ Añadir sesión</button><button class="btn soft" data-sp-act="prepare" type="button" ${ui.busy ? 'disabled' : ''}>${week.inIncident ? 'Rehacer adaptada' : 'Hacer otra propuesta'}</button><button class="btn primary" data-sp-act="publish" type="button" ${ui.busy ? 'disabled' : ''}>Publicar semana</button>`}</div></div>`;
      if (week.inIncident && !week.adapted) body = `<div class="sp-warn">Esta semana se preparó con el plan normal, antes del problema. ${week.published ? 'Adáptala y vuelve a publicarla.' : 'Rehazla adaptada antes de publicarla.'}</div>${body}`;
    }
    const prev = model.structure.weeks[week.index - 2], next = model.structure.weeks[week.index];
    return `<section class="sp-card sp-week">
      <div class="sp-week-head"><div><span class="sp-eyebrow">Semana ${week.index} de ${model.structure.weeks.length}${week.current ? ' · esta semana' : ''}</span>
        <h3>${esc(dayName(week.start))} ${esc(fmt(week.start))} – ${esc(dayName(week.end))} ${esc(fmt(week.end))} ${badge}</h3>
        <p>${week.inIncident || week.adapted ? `<b>Semana adaptada</b> · ${esc(P.STATES[model.active?.state]?.label || 'mientras dura el problema')}. ` : ''}<b>${esc(WEEK_TYPE_LABEL[week.type] || week.label)}</b> · ≈ ${week.minutes} min previstos${week.inIncident ? ' en el plan' : ''}.${adjustText(week)} ${esc(week.why)}${week.b_race ? ` Esta semana hay carrera de preparación (${esc(week.b_race.name || 'objetivo B')}).` : ''}</p></div>
        <div class="sp-nav"><button class="btn soft small" data-sp-week="${esc(prev?.start || '')}" ${prev ? '' : 'disabled'} aria-label="Semana anterior">←</button><button class="btn soft small" data-sp-week="${esc(next?.start || '')}" ${next ? '' : 'disabled'} aria-label="Semana siguiente">→</button></div></div>
      ${busy}${body}</section>`;
  }
  // ---------- «Ha pasado algo» ----------
  const KIND_ICON = { lesion: '🩹', enfermedad: '🤒', viaje: '🧳', cansancio: '😮‍💨' };
  const stateWhy = (incident, key) => incident?.kind !== 'lesion' && key === 'parado' ? 'Descanso hasta que esté bien: no se programa nada.' : P.STATES[key]?.why || '';
  const vueltaSince = incident => (incident.log || []).filter(entry => entry.s === 'vuelta').map(entry => entry.d).sort()[0] || null;
  function renderAdaptedPrepare(model, week) {
    const incident = model.active;
    const since = vueltaSince(incident);
    const intro = `<p>${esc(P.STATES[incident.state]?.label || '')}: ${esc(stateWhy(incident, incident.state))} RunFlow prepara la semana con lo que puede hacer y la deja en borrador.</p>`;
    if (incident.state === 'vuelta' && since && since < week.start) {
      const step = Number(incident.step) || 0;
      return `<div class="sp-prepare">${intro}<p><b>¿Cómo respondió al correr la última semana?</b> Dolor durante y a la mañana siguiente. Ahora está en el paso ${step + 1} de ${P.RETURN_STEPS.length}: ${esc(P.RETURN_STEPS[step].text)}.</p>
        <div class="sp-lights"><button class="sp-light green" data-sp-light="green" ${ui.busy ? 'disabled' : ''}><b>Sin dolor (0-2)</b><small>Sube un paso</small></button><button class="sp-light amber" data-sp-light="amber" ${ui.busy ? 'disabled' : ''}><b>Algo de dolor (3-4)</b><small>Repite el paso</small></button><button class="sp-light red" data-sp-light="red" ${ui.busy ? 'disabled' : ''}><b>Dolor 5 o más</b><small>Baja un paso</small></button></div></div>`;
    }
    return `<div class="sp-prepare">${intro}<button class="btn primary" data-sp-act="prepare" ${ui.busy ? 'disabled' : ''}>Preparar semana adaptada</button></div>`;
  }
  function renderIncident(model) {
    const incident = model.active;
    if (!incident) return '';
    const kind = P.INCIDENT_KINDS[incident.kind] || {};
    const zone = incident.kind === 'lesion' ? P.INJURY_ZONES[incident.zone] || P.INJURY_ZONES.otra : null;
    const state = P.STATES[incident.state] || {};
    const order = ['parado', 'sin_correr', 'vuelta', 'normal'];
    const flow = incident.kind === 'lesion' ? order : ['parado', 'normal'];
    const steps = flow.map(key => `<li class="${key === incident.state ? 'on' : flow.indexOf(key) < flow.indexOf(incident.state) ? 'done' : ''}">${esc(P.STATES[key].label)}</li>`).join('');
    const step = Number(incident.step) || 0;
    const actions = [];
    if (incident.kind === 'lesion') {
      if (incident.state === 'parado') actions.push('<button class="btn primary" data-sp-state="sin_correr">Ya se mueve sin dolor: entrenar sin correr</button>');
      if (incident.state === 'sin_correr') actions.push("<button class=\"btn primary\" data-sp-state=\"vuelta\">Camina 30' sin dolor: empezar a correr</button>", '<button class="btn soft" data-sp-state="parado">Ha empeorado: parar</button>');
      if (incident.state === 'vuelta') actions.push('<button class="btn primary" data-sp-act="return">Ya está bien: volver al plan</button>', '<button class="btn soft" data-sp-state="sin_correr">Ha empeorado: dejar de correr</button>');
    } else actions.push('<button class="btn primary" data-sp-act="return">Ya puede entrenar: volver al plan</button>');
    actions.push('<button class="btn soft" data-sp-act="incident-cancel" title="Si se marcó por error: quita el aviso sin recalcular nada">Quitar aviso</button>');
    const ready = incident.state === 'vuelta' && step >= P.RETURN_STEPS.length - 1 && incident.ready;
    return `<section class="sp-card sp-incident">
      <div class="sp-incident-head"><div><span class="sp-eyebrow">Ha pasado algo · desde el ${esc(fmt(incident.from))}</span>
        <h3>${KIND_ICON[incident.kind] || ''} ${esc(kind.label || '')}${zone ? ` · ${esc(zone.label)}` : ''}${incident.pain !== undefined && incident.kind === 'lesion' ? ` · dolor ${Number(incident.pain)}/10` : ''}</h3>
        <p><b>${esc(state.label || '')}.</b> ${esc(stateWhy(incident, incident.state))}${incident.state === 'vuelta' ? ` Paso ${step + 1} de ${P.RETURN_STEPS.length}: ${esc(P.RETURN_STEPS[step].text)}.` : ''}${incident.until ? ` Vuelve el ${esc(fmt(incident.until))}.` : ''}</p>
        ${incident.note ? `<p class="sp-muted">Nota: ${esc(incident.note)}</p>` : ''}</div>
        <ol class="sp-states">${steps}</ol></div>
      ${ready ? '<div class="sp-ok">Ha completado la vuelta a correr sin dolor. Ya puede volver al plan.</div>' : ''}
      ${zone ? `<div class="sp-avoid"><b>Mientras tanto, evitar:</b> ${esc(zone.avoid.join(' · '))}</div>` : ''}
      <p class="sp-muted">Las semanas se preparan adaptadas. Al volver, RunFlow recalcula el resto de la temporada sin mover la carrera. RunFlow no diagnostica: ajusta con lo que diga el fisio o el médico.</p>
      <div class="sp-actions">${actions.join('')}</div></section>`;
  }

  // Ventana del asistente (se cierra solo con su botón).
  function modalShell() {
    let root = q('#spModal');
    if (root) return root;
    document.body.insertAdjacentHTML('beforeend', '<div id="spModal" class="sp-backdrop hidden" role="dialog" aria-modal="true" aria-label="Ha pasado algo"><section class="sp-modal" id="spModalBody"></section></div>');
    root = q('#spModal');
    root.addEventListener('click', onModalClick);
    root.addEventListener('change', onModalChange);
    root.addEventListener('input', onModalInput);
    return root;
  }
  function renderModal(model) {
    const root = modalShell();
    const m = ui.modal;
    root.classList.toggle('hidden', !m);
    if (!m) return;
    const body = q('#spModalBody');
    const close = `<button type="button" class="btn soft" data-spm="close" ${ui.busy ? 'disabled' : ''}>Cerrar</button>`;
    if (m.type === 'return') { body.innerHTML = renderReturnModal(model, m, close); return; }
    const a = m.a;
    const titles = ['¿Qué ha pasado?', a.kind === 'cansancio' ? 'Semana de descarga' : 'Cuéntame un poco más', 'Esto es lo que va a pasar'];
    let content = '';
    if (m.step === 0) {
      content = `<div class="sp-opts">${Object.entries(P.INCIDENT_KINDS).map(([key, item]) => `<button type="button" class="sp-opt${a.kind === key ? ' on' : ''}" data-spm-kind="${key}"><b>${KIND_ICON[key]} ${esc(item.label)}</b><small>${esc(item.hint)}</small></button>`).join('')}</div>`;
    } else if (m.step === 1) {
      if (a.kind === 'lesion') {
        const zone = P.INJURY_ZONES[a.zone];
        content = `<h4>¿Dónde?</h4><div class="sp-chips">${Object.entries(P.INJURY_ZONES).map(([key, item]) => `<button type="button" class="sp-chip${a.zone === key ? ' on' : ''}" data-spm-zone="${key}">${esc(item.label)}</button>`).join('')}</div>
          <div class="sp-fields"><label>¿Desde cuándo?<input type="date" data-spm-field="from" value="${esc(a.from)}" max="${esc(model.today)}"></label></div>
          <h4>¿Cuánto le duele ahora al moverse? (0 nada · 10 muchísimo)</h4><div class="sp-chips sp-pain">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button type="button" class="sp-chip${Number(a.pain) === n ? ' on' : ''}${n >= 5 ? ' hi' : n >= 3 ? ' mid' : ''}" data-spm-pain="${n}">${n}</button>`).join('')}</div>
          <h4>¿Puede trotar suave sin dolor?</h4><div class="sp-chips"><button type="button" class="sp-chip${a.can_run ? '' : ' on'}" data-spm-run="0">No</button><button type="button" class="sp-chip${a.can_run ? ' on' : ''}" data-spm-run="1">Sí, suave y sin dolor</button></div>
          <h4>¿Qué puede hacer mientras tanto?</h4><div class="sp-chips">${Object.entries(P.ALTERNATIVES).map(([key, label]) => `<button type="button" class="sp-chip${a.can.includes(key) ? ' on' : ''}" data-spm-can="${key}">${a.can.includes(key) ? '✓ ' : ''}${esc(label)}</button>`).join('')}</div>
          ${zone ? `<div class="sp-avoid"><b>Con ${esc(zone.label.toLowerCase())} se suele evitar:</b> ${esc(zone.avoid.join(' · '))}. Lo que diga el fisio manda.</div>` : ''}
          <div class="sp-fields"><label>Lo que ha dicho el fisio o el médico (opcional)<input type="text" data-spm-field="note" value="${esc(a.note)}" maxlength="200" placeholder="Ej.: pubalgia, nada de cambios de dirección 3 semanas"></label></div>`;
      } else if (a.kind === 'cansancio') {
        const week = targetWeek(model);
        content = week ? `<p>La semana del <b>${esc(fmt(week.start))}</b> pasa a ser de <b>descarga</b>: menos volumen y sin apretar, para que asimile. Se rehace su propuesta${week.published ? ' y se vuelve a publicar' : ''}.</p><p class="sp-muted">Si el cansancio sigue después, puede ser algo más (enfermedad, falta de sueño…): vuelve a «Ha pasado algo».</p>` : '<p>No hay ninguna semana que cambiar.</p>';
      } else {
        content = `<div class="sp-fields"><label>¿Desde cuándo?<input type="date" data-spm-field="from" value="${esc(a.from)}"></label>${a.kind === 'viaje' ? `<label>¿Hasta cuándo? (si lo sabes)<input type="date" data-spm-field="until" value="${esc(a.until)}"></label>` : ''}
          <label>Nota (opcional)<input type="text" data-spm-field="note" value="${esc(a.note)}" maxlength="200"></label></div>
          ${a.kind === 'enfermedad' ? '<p class="sp-muted">Mientras esté enfermo no se programa nada. Cuando esté bien, pulsa «Volver al plan» y RunFlow empezará con una semana suave.</p>' : '<p class="sp-muted">Mientras esté fuera no se programa nada. A la vuelta, RunFlow recalcula la temporada.</p>'}`;
      }
    } else {
      content = m.preview ? renderIncidentPreview(model, m) : '<div class="sp-busy">Preparando la propuesta…</div>';
    }
    const last = m.step === 2;
    const nextOk = m.step === 1 && (a.kind !== 'lesion' || a.zone);
    body.innerHTML = `<header class="sp-modal-head"><div><span class="sp-eyebrow">Ha pasado algo · paso ${m.step + 1} de 3</span><h2>${esc(titles[m.step])}</h2></div>${close}</header>
      <div class="sp-modal-body">${content}</div>
      ${m.status ? `<div class="sp-warn">${esc(m.status)}</div>` : ''}
      <footer class="sp-modal-foot">${m.step ? `<button type="button" class="btn soft" data-spm="back" ${ui.busy ? 'disabled' : ''}>Atrás</button>` : '<span></span>'}
        ${m.step === 1 ? `<button type="button" class="btn primary" data-spm="next" ${nextOk ? '' : 'disabled'}>Siguiente</button>` : ''}
        ${last && m.preview ? `<button type="button" class="btn primary" data-spm="apply" ${ui.busy ? 'disabled' : ''}>${m.preview.week?.published ? 'Aplicar y volver a publicar la semana' : 'Aplicar'}</button>` : ''}</footer>`;
  }
  function renderIncidentPreview(model, m) {
    const p = m.preview;
    const state = P.STATES[p.state] || {};
    const list = p.workouts.length
      ? `<ul class="sp-mini">${p.workouts.map(w => `<li><b>${esc(dayName(w.workout_date).slice(0, 3))} ${esc(fmt(w.workout_date))}</b> ${esc(w.title)} <small>${Number(w.planned_duration_min) || '—'} min</small></li>`).join('')}</ul>`
      : '<p class="sp-muted">Sin sesiones esta semana: descanso.</p>';
    return `${p.kind === 'cansancio' ? '' : `<div class="sp-state-pill">Estado: <b>${esc(state.label)}</b></div><p>${esc(stateWhy(p.incident, p.state))}</p>`}
      ${p.week ? `<h4>Semana del ${esc(fmt(p.week.start))}${p.fromDate && p.fromDate > p.week.start ? ` (desde el ${esc(fmt(p.fromDate))})` : ''}</h4>${list}` : '<p>La semana actual ya ha terminado: se adaptarán las siguientes.</p>'}
      ${p.week?.published ? '<div class="sp-warn">Esta semana ya estaba publicada: al aplicar se cambia y se vuelve a publicar en Intervals y en la app.</div>' : p.week ? '<p class="sp-muted">Queda en borrador para que la revises y la publiques.</p>' : ''}
      ${p.fichaChanges.length ? `<p class="sp-muted">Se añade a su ficha ${esc(p.fichaChanges.length > 1 ? `${p.fichaChanges.slice(0, -1).join(', ')} y ${p.fichaChanges[p.fichaChanges.length - 1]}` : p.fichaChanges[0])} en los días que corre, para poder programarlo.</p>` : ''}
      ${p.kind === 'cansancio' ? '' : '<p class="sp-muted">Cada semana preparas la siguiente según cómo vaya. Cuando esté bien, pulsa «Volver al plan» y RunFlow recalcula el resto de la temporada sin mover la carrera.</p>'}`;
  }
  function renderReturnModal(model, m, close) {
    let content;
    if (m.result?.error) content = `<div class="sp-warn">${esc(m.result.error)}</div>`;
    else if (m.result) {
      const r = m.result;
      const blocks = r.mesos.map(meso => `<li><span class="sp-swatch p-${esc(meso.key)}"></span><b>${esc(meso.name)}</b> · ${plural(meso.weeks.length, 'semana', 'semanas')} <small>${esc(fmt(meso.start))} – ${esc(fmt(meso.end))}</small></li>`).join('');
      content = `<p>${esc(r.explanation)}</p>${r.warnings.map(text => `<div class="sp-warn">${esc(text)}</div>`).join('')}
        <h4>Así queda el resto de la temporada</h4><ul class="sp-blocks">${blocks}</ul>
        ${model.answers.goal_mode === 'marca' ? `<label class="sp-check"><input type="checkbox" data-spm-finish ${m.finish ? 'checked' : ''}> Cambiar el objetivo a «terminarla bien» (plan más prudente)</label>` : ''}
        <p class="sp-muted">Si aun así no da tiempo, otra salida es elegir una carrera más adelante: borra esta temporada y crea otra con el asistente.</p>
        <p class="sp-muted">Las semanas que quedan sin publicar se vacían para prepararlas de nuevo con el plan nuevo. Las publicadas no se tocan.</p>`;
    } else content = '<div class="sp-busy">Calculando…</div>';
    return `<header class="sp-modal-head"><div><span class="sp-eyebrow">Volver al plan</span><h2>Recalcular la temporada</h2></div>${close}</header>
      <div class="sp-modal-body"><div class="sp-fields"><label>¿Qué día vuelve a entrenar normal?<input type="date" data-spm-field="return" value="${esc(m.date)}"></label></div>${content}</div>
      <footer class="sp-modal-foot"><span></span><button type="button" class="btn primary" data-spm="apply-return" ${ui.busy || !m.result || m.result.error ? 'disabled' : ''}>Recalcular y volver al plan</button></footer>`;
  }
  // Semana que se toca al aplicar: la actual si aún queda algo de ella, si no la siguiente.
  function targetWeek(model, from) {
    const weeks = model.structure.weeks.filter(week => !week.past && (!from || week.end >= from));
    return weeks[0] || null;
  }
  function openIncident() {
    const model = seasonModel();
    if (!model) return;
    ui.modal = { type: 'incident', step: 0, a: { kind: '', zone: '', from: model.today, until: '', pain: 3, can_run: false, can: [], note: '' }, preview: null, status: '' };
    render();
  }
  async function buildPreview() {
    const model = seasonModel(), m = ui.modal, a = m.a;
    m.preview = null; m.status = ''; render();
    try {
      const week = targetWeek(model, a.kind === 'cansancio' ? null : a.from);
      if (!week) throw new Error('No quedan semanas por delante en esta temporada.');
      if (a.kind === 'cansancio') {
        const info = P.WEEK_TYPES.deload, from = P.WEEK_TYPES[week.type] || P.WEEK_TYPES.load;
        const deload = { ...week, type: 'deload', label: info.label, why: info.why, minutes: Math.round(week.minutes * info.pct / from.pct / 5) * 5 };
        const { workouts } = await proposalFor(model, week, { week: deload });
        const fromDate = week.start <= model.today ? model.today : null;
        m.preview = { kind: 'cansancio', week, deload, workouts: workouts.filter(w => !fromDate || w.workout_date >= fromDate), fromDate, fichaChanges: [] };
      } else {
        const incident = { kind: a.kind, zone: a.zone, from: a.from, pain: Number(a.pain), can_run: a.can_run, can: a.kind === 'lesion' ? a.can : [], note: a.note, until: a.until };
        incident.state = P.initialState(incident);
        const { profile, days } = await currentDays(model);
        const extended = withTypes(days, incident.can);
        const fichaChanges = P.daysFromProfile(profile) ? fichaAdds(days, incident.can) : [];
        const fromDate = week && week.start <= model.today ? model.today : week?.start;
        const workouts = week ? P.buildAdaptedWeek(incident, week, extended, { fromDate }) : [];
        m.preview = { kind: a.kind, state: incident.state, incident, week, workouts, fromDate, fichaChanges, profile };
      }
    } catch (error) { m.status = error.message; }
    render();
  }
  // Añade a los días que corre lo que puede hacer mientras tanto (bici, caminar, fuerza).
  const TYPE_LABEL = { bike: 'bici', walk: 'caminar', strength: 'fuerza' };
  function withTypes(days, can) {
    return days.map(day => P.runsOn(day) ? { ...day, types: [...new Set([...P.dayTypes(day), ...can])] } : day);
  }
  function fichaAdds(days, can) {
    return can.filter(type => days.some(day => P.runsOn(day) && !P.dayTypes(day).includes(type))).map(type => TYPE_LABEL[type]);
  }
  async function extendFicha(profile, can) {
    const availability = profile?.availability;
    if (!availability?.days?.length || !can.length) return;
    let changed = false;
    const days = availability.days.map(day => {
      const types = Array.isArray(day.activity_types) && day.activity_types.length ? day.activity_types : [day.activity_type].filter(Boolean);
      const runs = day.can_train !== false && (types.some(type => ['run', 'trail', 'flexible'].includes(type)) || day.run === true);
      if (!runs) return day;
      const add = can.filter(type => !(type === 'strength' ? types.includes('strength') || types.includes('gym') : types.includes(type)));
      if (!add.length) return day;
      changed = true;
      const next = [...types.filter(type => type !== 'flexible'), ...(types.includes('flexible') ? ['run', 'strength'] : []), ...add];
      const unique = [...new Set(next)];
      return { ...day, activity_types: unique, activity_type: unique.length > 1 ? 'flexible' : unique[0], bike: unique.includes('bike'), walk: unique.includes('walk'), strength: unique.some(type => ['strength', 'gym'].includes(type)), run: unique.some(type => ['run', 'trail'].includes(type)) };
    });
    if (!changed) return;
    await apiCall(`/api/v9/coach/athletes/${encodeURIComponent(athleteId())}/dynamic-profile`, { method: 'PUT', body: JSON.stringify({ availability: { ...availability, days, configured: true }, strength_mode: profile.strength_mode, external_strength_days: profile.external_strength_days }) });
    window.RunFlowAvailability?.invalidate?.();
  }
  async function saveIncidents(model, incidents, answers = model.answers) {
    const notes = P.writeIncidents(`${P.MARKER}\n${JSON.stringify(answers)}`, incidents);
    await apiCall(`${base()}/macrocycles/${encodeURIComponent(model.macro.id)}`, { method: 'PUT', body: JSON.stringify({ notes }) });
  }
  async function applyIncident() {
    const model = seasonModel(), m = ui.modal, p = m?.preview;
    if (!p) return;
    ui.busy = 'Aplicando…'; render();
    try {
      if (p.kind === 'cansancio') {
        const week = p.week;
        await saveWeekWorkouts(week, keepPast(week, p.fromDate, p.workouts), { type: 'deload', planned: { hours: Math.round(p.deload.minutes / 6) / 10 }, notes: `${P.WEEK_TYPES.deload.label}: ${P.WEEK_TYPES.deload.why} (por cansancio)`, republish: true });
      } else {
        const incident = { id: `i${Date.now().toString(36)}`, ...p.incident, step: 0, log: [{ d: model.today, s: p.state, p: Number(p.incident.pain) || 0 }], closed: null };
        await saveIncidents(model, [...model.incidents.filter(item => item.closed), incident]);
        if (p.incident.kind === 'lesion') await extendFicha(p.profile, p.incident.can);
        if (p.week) await saveWeekWorkouts(p.week, keepPast(p.week, p.fromDate, p.workouts), { notes: weekNotes(p.week.micro, p.state), republish: true });
      }
      ui.busy = ''; ui.modal = null;
      if (p.week) ui.selected = p.week.start;
      await reload();
      notify(p.kind === 'cansancio' ? 'Semana cambiada a descarga.' : 'Guardado. Las próximas semanas se preparan adaptadas.', 'success');
    } catch (error) { ui.busy = ''; if (ui.modal) ui.modal.status = error.message; render(); }
  }
  async function changeState(next) {
    const model = seasonModel(), incident = model?.active;
    if (!incident) return;
    const updated = { ...incident, state: next, step: next === 'vuelta' && incident.state !== 'vuelta' ? 0 : incident.step, ready: false, log: [...(incident.log || []), { d: model.today, s: next }] };
    ui.busy = 'Guardando…'; render();
    try {
      await saveIncidents(model, model.incidents.map(item => item.id === incident.id ? updated : item));
      ui.busy = ''; await reload();
      notify(`Ahora: ${P.STATES[next].label}. Prepara la semana para adaptarla a este cambio.`, 'success');
    } catch (error) { ui.busy = ''; render(); notify(error.message, 'error'); }
  }
  async function applyLight(light) {
    const model = seasonModel(), incident = model?.active;
    const week = model?.structure.weeks.find(item => item.start === ui.selected);
    if (!incident || !week) return;
    const result = P.nextReturnStep(incident, light);
    const updated = { ...incident, state: result.state, step: result.step, ready: Boolean(result.ready), log: [...(incident.log || []), { d: model.today, s: result.state, l: light }] };
    ui.busy = 'Guardando…'; render();
    try {
      await saveIncidents(model, model.incidents.map(item => item.id === incident.id ? updated : item));
      ui.busy = '';
      await reload();
      const fresh = seasonModel();
      const target = fresh.structure.weeks.find(item => item.start === week.start);
      await prepareWeek(target, fresh, { silent: true });
    } catch (error) { ui.busy = ''; render(); notify(error.message, 'error'); }
  }
  async function cancelIncident() {
    const model = seasonModel(), incident = model?.active;
    if (!incident || !window.confirm('¿Quitar el aviso? Las semanas ya adaptadas se quedan como están y no se recalcula la temporada.')) return;
    ui.busy = 'Guardando…'; render();
    try {
      await saveIncidents(model, model.incidents.filter(item => item.id !== incident.id));
      ui.busy = ''; await reload();
    } catch (error) { ui.busy = ''; render(); notify(error.message, 'error'); }
  }
  function openReturn() {
    const model = seasonModel();
    if (!model?.active) return;
    ui.modal = { type: 'return', date: model.today, finish: false, result: null };
    computeReturn();
  }
  function computeReturn() {
    const model = seasonModel(), m = ui.modal;
    try {
      const answers = m.finish ? { ...model.answers, goal_mode: 'terminar' } : model.answers;
      m.result = P.returnPlan(answers, model.active, model.structure, m.date);
    } catch (error) { m.result = { error: error.message }; }
    render();
  }
  async function applyReturn() {
    const model = seasonModel(), m = ui.modal, r = m?.result;
    if (!r || r.error) return;
    ui.busy = 'Recalculando la temporada…'; render();
    try {
      const byStart = new Map(model.structure.weeks.map(week => [week.start, week]));
      const counts = {};
      for (const week of r.weeks) {
        const old = byStart.get(week.start);
        if (!old?.micro) continue;
        counts[week.phase] = (counts[week.phase] || 0) + 1;
        const phase = P.PHASES[week.phase];
        const micro = {
          ...old.micro, type: week.type, name: `${phase.name} · semana ${counts[week.phase]}`, primary_objective: phase.goal,
          planned: { ...(old.micro.planned || {}), hours: week.hours, load: week.load, strength_sessions: week.strength_sessions || 0 },
          notes: `${week.label}: ${week.why}\n${P.PHASE_PREFIX}${week.phase}`,
          recovery_target: ['deload', 'recovery', 'taper', 'competition'].includes(week.type) ? week.why : '',
        };
        // Lo publicado no se toca; lo demás se vacía para prepararlo con el plan nuevo.
        const workouts = old.published ? old.workouts : [];
        await apiCall(`${base()}/microcycles/${encodeURIComponent(micro.id)}`, { method: 'PUT', headers: { 'X-RunFlow-Planning-Origin': 'guided' }, body: JSON.stringify(microPayload(micro, workouts, old.published ? 'published' : 'draft')) });
      }
      const incident = model.active;
      const closed = { ...incident, state: 'normal', closed: model.today, back: r.start, log: [...(incident.log || []), { d: model.today, s: 'normal' }] };
      const answers = m.finish ? { ...model.answers, goal_mode: 'terminar' } : model.answers;
      await saveIncidents(model, model.incidents.map(item => item.id === incident.id ? closed : item), answers);
      ui.busy = ''; ui.modal = null; ui.selected = r.start;
      await reload();
      notify(`Temporada recalculada desde el ${fmt(r.start)}. Prepara esa semana cuando toque.`, 'success');
    } catch (error) { ui.busy = ''; if (ui.modal) ui.modal.result = { ...r, warnings: [...r.warnings, `Error: ${error.message}`] }; render(); }
  }
  function onModalClick(event) {
    const el = event.target.closest('[data-spm],[data-spm-kind],[data-spm-zone],[data-spm-pain],[data-spm-run],[data-spm-can]');
    const m = ui.modal;
    if (!el || !m || ui.busy) return;
    const a = m.a;
    if (el.dataset.spmKind) { a.kind = el.dataset.spmKind; m.step = 1; m.status = ''; render(); return; }
    if (el.dataset.spmZone) { a.zone = el.dataset.spmZone; a.can = [...(P.INJURY_ZONES[a.zone]?.can || [])]; render(); return; }
    if (el.dataset.spmPain) { a.pain = Number(el.dataset.spmPain); render(); return; }
    if (el.dataset.spmRun) { a.can_run = el.dataset.spmRun === '1'; render(); return; }
    if (el.dataset.spmCan) { const key = el.dataset.spmCan; a.can = a.can.includes(key) ? a.can.filter(item => item !== key) : [...a.can, key]; render(); return; }
    const act = el.dataset.spm;
    if (act === 'close') { ui.modal = null; render(); return; }
    if (act === 'back') { m.step = Math.max(0, m.step - 1); m.preview = null; m.status = ''; render(); return; }
    if (act === 'next') { m.step = 2; buildPreview(); return; }
    if (act === 'apply') return applyIncident();
    if (act === 'apply-return') return applyReturn();
  }
  function onModalChange(event) {
    const el = event.target, m = ui.modal;
    if (!m) return;
    if (el.dataset.spmField === 'return') { m.date = el.value || seasonModel()?.today; computeReturn(); return; }
    if (el.dataset.spmFinish !== undefined) { m.finish = el.checked; computeReturn(); return; }
    if (el.dataset.spmField && el.type === 'date') { m.a[el.dataset.spmField] = el.value; render(); }
  }
  function onModalInput(event) {
    const el = event.target, m = ui.modal;
    if (m?.a && el.dataset.spmField && el.type === 'text') m.a[el.dataset.spmField] = el.value;
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
    const slot = '<div id="spAgentSlot"></div>'; // propuesta del agente Planificador (coach-running-guided-plan.js)
    if (!model) { root.innerHTML = slot + renderEmpty() + legacyLink(); return; }
    let week = model.structure.weeks.find(item => item.start === ui.selected);
    if (!week) { week = defaultWeek(model); ui.selected = week.start; }
    if (adviceApplies(model, week) && !ui.advice[adviceKey(week)]) loadAdvice(model, week);
    root.innerHTML = `${slot}${renderHeader(model)}${renderIncident(model)}${renderBar(model)}<div class="sp-grid">${renderWeek(model, week)}${renderBlock(model, week)}</div>${legacyLink()}`;
    renderModal(model);
  }
  const legacyLink = () => '<p class="sp-legacy"><button type="button" class="sp-link" data-sp-act="legacy">Abrir la planificación antigua</button></p>';

  // ---------- Eventos ----------
  function currentContext() {
    const model = seasonModel();
    const week = model?.structure.weeks.find(item => item.start === ui.selected);
    return { model, week };
  }
  function onClick(event) {
    const el = event.target.closest('[data-sp-act],[data-sp-week],[data-sp-edit],[data-sp-remove],[data-sp-state],[data-sp-light]');
    if (!el || !q('#spRoot')?.contains(el) && !el.matches('[data-sp-act="back"]')) return;
    if (el.dataset.spWeek !== undefined) { if (el.dataset.spWeek) { ui.selected = el.dataset.spWeek; render(); } return; }
    if (ui.busy) return;
    const { model, week } = currentContext();
    if (el.dataset.spState) return changeState(el.dataset.spState);
    if (el.dataset.spLight) return applyLight(el.dataset.spLight);
    if (el.dataset.spEdit) return editWorkout(week, el.dataset.spEdit);
    if (el.dataset.spRemove) return removeWorkout(week, el.dataset.spRemove);
    const act = el.dataset.spAct;
    if (act === 'create') return window.RunFlowRunningGuidedPlan?.open();
    if (act === 'legacy') { ui.legacy = true; render(); return; }
    if (act === 'back') { ui.legacy = false; render(); return; }
    if (act === 'delete') return deleteSeason();
    if (act === 'incident') return openIncident();
    if (act === 'incident-cancel') return cancelIncident();
    if (act === 'return') return openReturn();
    if (act === 'prepare-adjusted') return prepareWeek(week, model, { adjust: ui.advice[adviceKey(week)]?.result });
    // «Hacer otra propuesta» mantiene el ajuste que ya tenía la semana.
    if (act === 'prepare') { const adj = P.readAdjust(week?.micro?.notes); return prepareWeek(week, model, adj && !week.inIncident ? { adjust: { ...adj, lessQuality: adj.decision === 'bajar' } } : {}); }
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
