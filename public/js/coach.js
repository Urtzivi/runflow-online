const $ = id => document.getElementById(id);
const state = { user: null, config: null, athletes: [], athlete: null, editingSession: null, modalBlocks: [], strengthExercises: [], templates: [], pendingImportPackage: null, activities: [], recovery: [], loadToleranceSnapshot: null, currentActivityId: null, currentActivity: null, calendar: { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), weeks: new Map(), selectedWeekStart: isoMonday(), loading: false }, seasons: [], plan: null, planTab: 'season', selectedSeasonId: null, selectedMicrocycleId: null, planEditor: null, evaluationEditor: null };
const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) location.href = '/login';
    throw new Error(data.error || 'No se pudo completar la operación.');
  }
  return data;
}

function showMessage(text, type = '') {
  const el = $('globalMessage');
  el.textContent = text;
  el.className = `notice ${type}`;
  el.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => el.classList.add('hidden'), 4500);
}

function isoMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().slice(0, 10);
}
function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function dateLabel(dateString) {
  if (!dateString) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(`${dateString}T12:00:00`));
}
function microcycleTypeLabel(type) {
  return ({ adaptation: 'Adaptación', load: 'Carga', development: 'Construcción', overload: 'Sobrecarga', deload: 'Descarga', taper: 'Afinamiento', recovery: 'Recuperación', competition: 'Competición' })[String(type || '').toLowerCase()] || '';
}
function pctLabel(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n)}%` : '—';
}
function progressStatusLabel(status) {
  return ({ not_started: 'Aún no iniciado', no_target: 'Sin referencia', behind: 'Por debajo de lo previsto', on_track: 'En línea con el plan', above: 'Por encima de lo previsto' })[status] || 'Sin datos';
}
function daysUntil(dateString) {
  if (!dateString) return '—';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateString}T00:00:00`);
  return Math.max(0, Math.ceil((target - today) / 86400000));
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function newId() {
  return globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `rf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function switchView(name) {
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `${name}View`));
  if (name === 'plan' && state.athlete && !state.plan) loadPlan().catch(error => showMessage(error.message, 'error'));
  if (name === 'library' && state.athlete && !state.templates.length) loadTemplates().catch(error => showMessage(error.message, 'error'));
  if (name === 'profile' && state.athlete && !state.loadToleranceSnapshot) loadLoadTolerance(false).catch(error => { const el = $('loadToleranceHistoryStatus'); if (el) el.textContent = error.message; });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function ensureWeek() {
  const source = state.athlete.week || {};
  state.athlete.week = {
    id: source.id || null,
    week_start: source.week_start || isoMonday(),
    week_type: source.week_type || 'Carga controlada',
    title: source.title || '',
    coach_comment: source.coach_comment || '',
    target_load: Number(source.target_load ?? 0),
    status: source.status || 'draft',
    published_at: source.published_at || null,
    workouts: Array.isArray(source.workouts) ? source.workouts : [],
  };
}

function readinessCopy(metrics) {
  const score = Number(metrics?.readiness_score ?? 50);
  const form = Number(metrics?.form ?? 0);
  if (score >= 80) return 'El deportista llega fresco. Puede completar la sesión prevista, pero no necesita añadir trabajo extra.';
  if (score >= 65) return `Estado adecuado para entrenar. La forma actual es ${form >= 0 ? 'positiva' : 'ligeramente negativa'}; conviene respetar el volumen programado.`;
  if (score >= 45) return 'Estado intermedio. Revisa sueño, molestias y la respuesta al calentamiento antes de mantener la intensidad.';
  return 'Recuperación comprometida. Conviene revisar la sesión y evitar aumentar carga hasta entender la causa.';
}

function renderSummary() {
  const athlete = state.athlete;
  const metrics = athlete.metrics || {};
  const week = athlete.week || { week_start: isoMonday(), workouts: [], status: 'draft' };
  const goals = [...(athlete.goals || [])].sort((a, b) => String(a.goal_date).localeCompare(String(b.goal_date)));
  const principal = goals.find(goal => goal.priority === 'Principal') || goals[0];
  $('readinessScore').textContent = metrics.readiness_score ?? '—';
  $('readinessLabel').textContent = metrics.readiness_label || 'Sin datos suficientes';
  $('readinessText').textContent = readinessCopy(metrics);
  $('fitness').textContent = metrics.fitness ?? '—';
  $('fatigue').textContent = metrics.fatigue ?? '—';
  $('form').textContent = metrics.form ?? '—';
  $('weekLoad').textContent = metrics.week_load ?? 0;
  $('plannedLoadText').textContent = `Programada: ${metrics.planned_load ?? week.target_load ?? 0}`;
  $('goalDays').textContent = principal ? daysUntil(principal.goal_date) : '—';
  $('goalName').textContent = principal ? principal.name : 'objetivo principal';
  $('weekTypeLabel').textContent = week.week_type || 'Sin definir';
  $('weekTitlePreview').textContent = week.title || 'Pendiente de planificación';
  $('weekCommentPreview').textContent = week.coach_comment || 'Escribe un comentario que explique la intención de la semana.';
  $('weekStatus').textContent = week.status === 'published' ? 'Publicada' : 'Borrador';
  $('weekStatus').className = `badge ${week.status === 'published' ? '' : 'pending'}`;
  $('summaryWeekLabel').textContent = `${dateLabel(week.week_start)} – ${dateLabel(addDays(week.week_start, 6))}`;

  const today = new Date().toISOString().slice(0, 10);
  const byDate = new Map();
  (week.workouts || []).forEach(workout => {
    if (!byDate.has(workout.workout_date)) byDate.set(workout.workout_date, []);
    byDate.get(workout.workout_date).push(workout);
  });
  $('weekStrip').innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(week.week_start, index);
    const workouts = byDate.get(date) || [];
    const load = workouts.reduce((sum, item) => sum + Number(item.planned_load || 0), 0);
    return `<article class="day-card ${date === today ? 'today' : ''}">
      <span class="day">${dayNames[index]}</span><span class="date">${dateLabel(date)}</span>
      ${workouts.length ? workouts.map(item => `<h3>${escapeHtml(item.title)}</h3>`).join('') : '<h3>Sin sesión</h3>'}
      <p>${workouts.length ? escapeHtml(workouts.map(item => item.summary).filter(Boolean).join(' · ') || 'Sesión programada.') : 'Día todavía sin planificar.'}</p>
      <span class="load">Carga ${load}</span>
    </article>`;
  }).join('');

  $('goalPreview').innerHTML = goals.length ? goals.slice(0, 3).map(goalCard).join('') : '<p class="muted">Todavía no hay objetivos.</p>';
}

function goalCard(goal, removable = false) {
  return `<article class="goal">
    <div class="goal-days"><div><strong>${daysUntil(goal.goal_date)}</strong><small>días</small></div></div>
    <div><span class="badge ${goal.priority === 'Principal' ? '' : 'pending'}">${escapeHtml(goal.priority)}</span><h3 style="margin-top:7px">${escapeHtml(goal.name)}</h3><p>${dateLabel(goal.goal_date)}${goal.performance_target ? ` · ${escapeHtml(goal.performance_target)}` : ''}</p></div>
    ${removable ? `<button class="btn danger small" data-delete-goal="${goal.id}" type="button">Eliminar</button>` : ''}
  </article>`;
}

function parseLocalDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
}

function dateToIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addCalendarDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function monthCalendarRange(monthDate = state.calendar.month) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 12);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 12);
  const start = parseLocalDate(isoMonday(first));
  const endMonday = parseLocalDate(isoMonday(last));
  return { start, end: addCalendarDays(endMonday, 6) };
}

function emptyCalendarWeek(weekStart) {
  return {
    id: null,
    week_start: weekStart,
    week_type: 'Carga controlada',
    title: '',
    coach_comment: '',
    target_load: 0,
    status: 'draft',
    published_at: null,
    mesocycle_id: null,
    end_date: addDays(weekStart, 6),
    microcycle_type: null,
    primary_objective: '',
    planned_hours: 0,
    planned_distance_km: 0,
    planned_elevation_m: 0,
    planned_strength_sessions: 0,
    recovery_target: '',
    lifecycle_status: 'planned',
    workouts: [],
  };
}

function calendarWeek(weekStart, create = true) {
  let week = state.calendar.weeks.get(weekStart);
  if (!week && create) {
    week = emptyCalendarWeek(weekStart);
    state.calendar.weeks.set(weekStart, week);
  }
  return week || null;
}

function generatedLoad(week) {
  return (week?.workouts || []).reduce((sum, item) => sum + Number(item.planned_load || 0), 0);
}

function workoutVisualClass(workout) {
  const title = String(workout.title || '').toLowerCase();
  if (workout.sport === 'Rest') return 'rest';
  if (workout.sport === 'Strength') return 'strength';
  if (/tirada|larga|trail/.test(title)) return 'long';
  if (/umbral|tempo|vo2|serie|interval|calidad|cambio|rápid|rapid/.test(title)) return 'quality';
  return 'easy';
}

function selectCalendarWeek(weekStart, rerender = true) {
  state.calendar.selectedWeekStart = weekStart;
  localStorage.setItem(`runflow_calendar_week_${state.athlete?.id || 'default'}`, weekStart);
  const week = calendarWeek(weekStart);
  const execution = week.execution || {};
  $('weekStart').value = weekStart;
  const weekType = microcycleTypeLabel(week.microcycle_type) || week.week_type || 'Carga controlada';
  if (![...$('weekType').options].some(option => option.value === weekType)) {
    const option = document.createElement('option'); option.value = weekType; option.textContent = weekType; $('weekType').appendChild(option);
  }
  $('weekType').value = weekType;
  $('targetLoad').value = Number(week.target_load || 0);
  $('weekTitle').value = week.primary_objective || week.title || '';
  $('weekComment').value = week.coach_comment || '';
  $('selectedWeekLabel').textContent = `${dateLabel(weekStart)} – ${dateLabel(addDays(weekStart, 6))}`;
  $('selectedWeekStatus').textContent = week.status === 'published' ? 'Publicada' : 'Borrador';
  $('selectedWeekStatus').className = `badge ${week.status === 'published' ? '' : 'pending'}`;
  $('generatedWeekLoad').textContent = Math.round(Number(execution.planned_load ?? generatedLoad(week) ?? 0));
  $('targetWeekLoadText').textContent = `objetivo ${Number(week.target_load || 0) || '—'}`;
  $('actualWeekLoad').textContent = Math.round(Number(execution.load || 0));
  $('extraWeekLoad').textContent = Number(execution.extra_load || 0) > 0 ? `+${Math.round(Number(execution.extra_load))} extra` : 'sin carga extra';
  const hasPlannedSessions = (week.workouts || []).length > 0;
  $('weekCompletionRate').textContent = hasPlannedSessions ? pctLabel(execution.completion_rate ?? 0) : '—';
  $('weekPriorityCompliance').textContent = hasPlannedSessions ? `A: ${pctLabel(execution.a_sessions_completion_pct)}` : 'A: —';
  $('generatedSessionCount').textContent = (week.workouts || []).length;
  $('completedSessionCount').textContent = `${Number(execution.completed_sessions || 0)} realizadas${Number(execution.extra_sessions || 0) ? ` · ${Number(execution.extra_sessions)} extra` : ''}`;
  if ($('weekToleranceStatus')) $('weekToleranceStatus').innerHTML = selectedWeekToleranceHtml(week);
  $('saveWeek').textContent = week.status === 'published' ? 'Guardar y sincronizar' : 'Guardar borrador';
  $('publishWeek').textContent = week.status === 'published' ? 'Sincronizar con Intervals' : 'Publicar semana';
  if (rerender) renderCalendar();
}

function renderWeekEditor() {
  if (!state.athlete) return;
  $('weekConnectionBadge').textContent = state.athlete.intervals_status === 'connected' ? 'Intervals conectado' : 'Intervals pendiente';
  $('weekConnectionBadge').className = `badge ${state.athlete.intervals_status === 'connected' ? '' : 'pending'}`;
  renderCalendar();
}

function actualWorkoutLine(workout) {
  const actual = workout.actual || {};
  const status = workout.execution_status || 'planned';
  if (status === 'planned') return '<span class="session-real pending-real">Pendiente</span>';
  if (status === 'skipped') return '<span class="session-real skipped-real">No realizada</span>';
  const parts = [];
  if (actual.load !== null && actual.load !== undefined && Number.isFinite(Number(actual.load))) parts.push(`carga ${Math.round(Number(actual.load))}`);
  if (Number(actual.distance_km || 0) > 0) parts.push(`${Number(actual.distance_km).toFixed(1)} km`);
  if (Number(actual.duration_min || 0) > 0) parts.push(`${Math.round(Number(actual.duration_min))} min`);
  return `<span class="session-real ${status}">${status === 'partial' ? 'PARCIAL' : 'REAL'} ${escapeHtml(parts.join(' · ') || 'registrada')}</span>`;
}

function renderCalendar() {
  if (!state.athlete || !$('calendarGrid')) return;
  const month = state.calendar.month;
  $('calendarMonthLabel').textContent = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(month).replace(/^./, letter => letter.toUpperCase());
  const { start, end } = monthCalendarRange(month);
  const today = new Date().toISOString().slice(0, 10);
  const cells = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const weekStart = dateToIso(cursor);
    const week = calendarWeek(weekStart);
    const selected = weekStart === state.calendar.selectedWeekStart;
    const execution = week.execution || {};
    for (let index = 0; index < 7; index += 1) {
      const date = dateToIso(addCalendarDays(cursor, index));
      const dayDate = parseLocalDate(date);
      const workouts = (week.workouts || []).filter(item => item.workout_date === date);
      const extras = (week.unplanned_activities || []).filter(item => String(item.activity_date || '').slice(0, 10) === date);
      const dayPlan = workouts.reduce((sum, item) => sum + Number(item.planned_load || 0), 0);
      const dayReal = workouts.reduce((sum, item) => sum + Number(item.actual?.load || 0), 0) + extras.reduce((sum, item) => sum + Number(item.load || 0), 0);
      const plannedCards = workouts.map(workout => `<button class="calendar-session ${workoutVisualClass(workout)} priority-${String(workout.priority || 'B').toLowerCase()} execution-${escapeHtml(workout.execution_status || 'planned')}" data-session-id="${workout.id}" data-session-week="${weekStart}" type="button"><strong><i class="priority-chip">${escapeHtml(workout.priority || 'B')}</i>${escapeHtml(workout.title)}</strong><small><span>${escapeHtml(workout.sport || 'Run')} · PLAN</span><b>${Number(workout.planned_load || 0)}</b></small>${actualWorkoutLine(workout)}</button>`).join('');
      const extraCards = extras.map(activity => `<button class="calendar-actual-extra" data-extra-activity="${escapeHtml(activity.intervals_activity_id || '')}" type="button"><strong>EXTRA · ${escapeHtml(activity.name || activity.sport || 'Actividad')}</strong><small>${escapeHtml(activity.sport || '')} · REAL <b>${Number.isFinite(Number(activity.load)) ? Math.round(Number(activity.load)) : '—'}</b></small></button>`).join('');
      cells.push(`<article class="calendar-day ${dayDate.getMonth() !== month.getMonth() ? 'outside' : ''} ${date === today ? 'today' : ''} ${selected ? 'selected-week' : ''}" data-select-week="${weekStart}">
        <div class="calendar-day-head"><span class="calendar-day-number">${dayDate.getDate()}</span><button class="calendar-add" data-add-date="${date}" type="button" aria-label="Añadir sesión el ${date}">+</button></div>
        <div class="calendar-sessions">${plannedCards}${extraCards}</div>
        <div class="calendar-day-load"><span>${workouts.length} plan${extras.length ? ` · ${extras.length} extra` : ''}</span><b>Plan ${Math.round(dayPlan)} · Real ${Math.round(dayReal)}</b></div>
      </article>`);
    }
    const planLoad = Number(execution.planned_load ?? generatedLoad(week) ?? 0);
    const realLoad = Number(execution.load || 0);
    const target = Number(week.target_load || 0);
    const completion = Number(execution.completion_rate || 0);
    const completionText = (week.workouts || []).length ? `${Math.round(completion)}%` : '—';
    const loadPct = Number(execution.load_adherence_pct);
    const progressPct = Number.isFinite(loadPct) ? Math.min(100, Math.max(0, loadPct)) : (target > 0 ? Math.min(100, (planLoad / target) * 100) : 0);
    cells.push(`<button class="calendar-week-summary ${selected ? 'active' : ''}" data-select-week="${weekStart}" type="button">
      <strong>${dateLabel(weekStart)} – ${dateLabel(addDays(weekStart, 6))}</strong>
      <span>Plan <b>${Math.round(planLoad)}</b></span><span>Real <b>${Math.round(realLoad)}</b></span><span>Cumpl. <b>${completionText}</b></span>${Number(execution.extra_load || 0) > 0 ? `<span>Extra <b>+${Math.round(Number(execution.extra_load))}</b></span>` : ''}${toleranceBadgeHtml(target || planLoad)}<span>${week.status === 'published' ? 'Publicada' : 'Borrador'}</span>
      <i><em style="width:${progressPct}%"></em></i>
    </button>`);
    cursor = addCalendarDays(cursor, 7);
  }
  $('calendarGrid').innerHTML = cells.join('');
  $('calendarGrid').querySelectorAll('[data-add-date]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openSessionModal(null, button.dataset.addDate);
  }));
  $('calendarGrid').querySelectorAll('[data-session-id]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    selectCalendarWeek(button.dataset.sessionWeek, false);
    openSessionModal(button.dataset.sessionId, null);
  }));
  $('calendarGrid').querySelectorAll('[data-extra-activity]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const id = button.dataset.extraActivity;
    if (!id) return;
    switchView('activities');
    loadActivityDetail(id).catch(error => showMessage(error.message, 'error'));
  }));
  $('calendarGrid').querySelectorAll('[data-select-week]').forEach(element => element.addEventListener('click', () => selectCalendarWeek(element.dataset.selectWeek)));
  selectCalendarWeek(state.calendar.selectedWeekStart, false);
}

async function loadCalendarMonth(sync = false) {
  if (!state.athlete) return;
  state.calendar.loading = true;
  $('calendarGrid').innerHTML = `<div class="empty-state calendar-loading">${sync ? 'Actualizando realizados desde Intervals…' : 'Cargando sesiones…'}</div>`;
  const { start, end } = monthCalendarRange();
  const data = await api(`/api/coach/athletes/${state.athlete.id}/calendar?oldest=${dateToIso(start)}&newest=${dateToIso(end)}&sync=${sync ? '1' : '0'}`);
  state.calendar.weeks = new Map((data.weeks || []).map(week => [week.week_start, { ...emptyCalendarWeek(week.week_start), ...week, workouts: Array.isArray(week.workouts) ? week.workouts : [] }]));
  let selected = localStorage.getItem(`runflow_calendar_week_${state.athlete.id}`) || state.calendar.selectedWeekStart || isoMonday();
  if (parseLocalDate(selected) < start || parseLocalDate(selected) > end) selected = isoMonday(new Date(state.calendar.month.getFullYear(), state.calendar.month.getMonth(), 1, 12));
  calendarWeek(selected);
  state.calendar.selectedWeekStart = selected;
  state.calendar.loading = false;
  renderCalendar();
}

function renderSessionEditor() {
  renderCalendar();
}

function currentLoadToleranceProfile() {
  const value = state.athlete?.profile?.load_tolerance_profile;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toleranceNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function loadToleranceState(load, profile = currentLoadToleranceProfile()) {
  const value = toleranceNumber(load);
  if (value === null || value <= 0) return { key: 'none', label: 'Sin carga' };
  const habitualMin = toleranceNumber(profile.habitual_min);
  const habitualMax = toleranceNumber(profile.habitual_max);
  const developmentMin = toleranceNumber(profile.development_min);
  const developmentMax = toleranceNumber(profile.development_max);
  const highMin = toleranceNumber(profile.high_min);
  const highMax = toleranceNumber(profile.high_max);
  const ceiling = toleranceNumber(profile.provisional_ceiling);
  const hasReference = [habitualMin, habitualMax, developmentMin, developmentMax, highMin, highMax, ceiling].some(item => item !== null);
  if (!hasReference) return { key: 'unknown', label: 'Sin tolerancia definida' };
  if (ceiling !== null && value > ceiling) return { key: 'over', label: 'Supera techo' };
  if (highMin !== null && value >= highMin) return { key: 'high', label: 'Carga alta' };
  if (developmentMin !== null && value >= developmentMin) return { key: 'development', label: 'Desarrollo' };
  if (habitualMin !== null && value >= habitualMin) return { key: 'habitual', label: 'Habitual' };
  if (habitualMax !== null && value <= habitualMax && habitualMin === null) return { key: 'habitual', label: 'Habitual' };
  if (developmentMax !== null && value <= developmentMax && developmentMin === null) return { key: 'development', label: 'Desarrollo' };
  if (highMax !== null && value <= highMax && highMin === null) return { key: 'high', label: 'Carga alta' };
  if (ceiling !== null && value <= ceiling && highMin === null) return { key: 'high', label: 'Carga alta' };
  return { key: 'low', label: 'Por debajo del habitual' };
}

function toleranceBadgeHtml(load, prefix = '') {
  const stateInfo = loadToleranceState(load);
  if (stateInfo.key === 'none') return '';
  const text = prefix ? `${prefix}: ${stateInfo.label}` : stateInfo.label;
  return `<span class="load-tolerance-chip tolerance-${stateInfo.key}">${escapeHtml(text)}</span>`;
}

function confidenceLabel(value) {
  return ({ provisional: 'Provisional', observing: 'En observación', consolidated: 'Consolidado' })[value] || 'Provisional';
}

function renderLoadToleranceProfile() {
  const profile = currentLoadToleranceProfile();
  const pairs = [
    ['loadToleranceHabitualMin', 'habitual_min'], ['loadToleranceHabitualMax', 'habitual_max'],
    ['loadToleranceDevelopmentMin', 'development_min'], ['loadToleranceDevelopmentMax', 'development_max'],
    ['loadToleranceHighMin', 'high_min'], ['loadToleranceHighMax', 'high_max'],
    ['loadToleranceCeiling', 'provisional_ceiling'],
  ];
  pairs.forEach(([id, key]) => { if ($(id)) $(id).value = profile[key] ?? ''; });
  if ($('loadToleranceConfidence')) $('loadToleranceConfidence').value = profile.confidence || 'provisional';
  if ($('loadToleranceNotes')) $('loadToleranceNotes').value = profile.notes || '';
  if ($('loadToleranceConfidenceBadge')) {
    $('loadToleranceConfidenceBadge').textContent = confidenceLabel(profile.confidence);
    $('loadToleranceConfidenceBadge').className = `badge ${profile.confidence === 'consolidated' ? '' : 'pending'}`;
  }
}

function renderLoadToleranceSnapshot() {
  if (!$('loadToleranceMedian')) return;
  const data = state.loadToleranceSnapshot || {};
  const stats = data.stats || {};
  $('loadToleranceMedian').textContent = stats.median_load ?? '—';
  $('loadToleranceP75').textContent = stats.p75_load ?? '—';
  $('loadToleranceMaxObserved').textContent = stats.max_load ?? '—';
  $('loadToleranceWeeksData').textContent = stats.weeks_with_data ?? 0;
  const rows = (data.weeks || []).filter(item => item.has_data).slice(-8).reverse();
  $('loadToleranceRecentWeeks').innerHTML = rows.length
    ? rows.map(item => `<span class="tolerance-history-chip"><small>${dateLabel(item.week_start)}</small><b>${Math.round(Number(item.load || 0))}</b></span>`).join('')
    : '<span class="muted small">No hay semanas completas con actividades suficientes.</span>';
}

async function loadLoadTolerance(sync = false) {
  if (!state.athlete) return;
  const status = $('loadToleranceHistoryStatus');
  if (status) status.textContent = sync ? 'Actualizando actividades y referencia…' : 'Cargando referencia observada…';
  try {
    state.loadToleranceSnapshot = await api(`/api/coach/athletes/${state.athlete.id}/load-tolerance?weeks=12&sync=${sync ? '1' : '0'}`);
    renderLoadToleranceSnapshot();
    if (status) status.textContent = sync ? 'Referencia actualizada con las últimas semanas completas.' : 'Referencia calculada con los datos guardados.';
  } catch (error) {
    if (status) status.textContent = error.message;
    throw error;
  }
}

function numberInputOrNull(id) {
  const value = $(id)?.value;
  if (value === '' || value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function selectedWeekToleranceHtml(week) {
  const execution = week?.execution || {};
  const plan = Number(week?.target_load || execution.planned_load || generatedLoad(week) || 0);
  const actual = Number(execution.load || 0);
  const planState = loadToleranceState(plan);
  if (planState.key === 'unknown') return '<span class="muted small">Define la tolerancia de carga en «Ficha y zonas» para contextualizar esta semana.</span>';
  return `<div><strong>Tolerancia individual</strong><div class="tolerance-inline-row">${toleranceBadgeHtml(plan, 'Plan')}${actual > 0 ? toleranceBadgeHtml(actual, 'Real') : '<span class="load-tolerance-chip tolerance-none">Real: pendiente</span>'}</div></div>`;
}

function renderProfile() {
  const athlete = state.athlete;
  const profile = athlete.profile || {};
  $('displayName').value = athlete.display_name || '';
  $('athleteEmail').value = athlete.email || '';
  $('birthDate').value = profile.birth_date || '';
  $('sex').value = profile.sex || '';
  $('phone').value = profile.phone || '';
  $('weight').value = profile.weight_kg ?? '';
  $('height').value = profile.height_cm ?? '';
  $('level').value = profile.level || '';
  $('experience').value = profile.experience_years ?? '';
  $('weeklySessions').value = profile.weekly_sessions ?? '';
  $('weeklyKm').value = profile.weekly_km ?? '';
  $('weeklyHours').value = profile.weekly_hours ?? '';
  $('availability').value = profile.availability?.notes || '';
  $('restrictions').value = profile.restrictions || '';
  $('injuryHistory').value = profile.injury_history || '';
  $('currentIssues').value = profile.current_issues || '';
  $('objective').value = profile.objective || '';
  $('coachNotes').value = profile.coach_notes || '';
  renderLoadToleranceProfile();
  renderLoadToleranceSnapshot();
  const fields = ['display_name', 'email', 'birth_date', 'sex', 'weight_kg', 'watch_model', 'level', 'objective'];
  const values = { display_name: athlete.display_name, email: athlete.email, ...profile };
  const completed = fields.filter(field => values[field]).length;
  $('profileProgress').textContent = `${Math.round(completed / fields.length * 100)}% completa`;
  renderZones();
}

function renderZones() {
  renderZoneList('hrZones', state.athlete.zones?.hr || [], 'hr');
  renderZoneList('paceZones', state.athlete.zones?.pace || [], 'pace');
}

function renderZoneList(containerId, zones, kind) {
  const container = $(containerId);
  container.innerHTML = zones.length ? zones.map((zone, index) => `
    <div class="zone-row" data-zone-kind="${kind}" data-zone-index="${index}">
      <input class="zone-name" data-zone-field="name" value="${escapeHtml(zone.name || '')}" placeholder="Nombre">
      <input data-zone-field="${kind === 'hr' ? 'min_value' : 'slow_pace'}" value="${escapeHtml(kind === 'hr' ? zone.min_value ?? '' : zone.slow_pace || '')}" placeholder="${kind === 'hr' ? 'Mín.' : 'Lento'}">
      <input data-zone-field="${kind === 'hr' ? 'max_value' : 'fast_pace'}" value="${escapeHtml(kind === 'hr' ? zone.max_value ?? '' : zone.fast_pace || '')}" placeholder="${kind === 'hr' ? 'Máx.' : 'Rápido'}">
      <button class="btn danger small" data-remove-zone type="button">×</button>
    </div>`).join('') : '<p class="muted small">Todavía no hay zonas.</p>';
  container.querySelectorAll('[data-zone-field]').forEach(input => input.addEventListener('input', event => {
    const row = event.target.closest('[data-zone-index]');
    const list = row.dataset.zoneKind === 'hr' ? state.athlete.zones.hr : state.athlete.zones.pace;
    const field = event.target.dataset.zoneField;
    list[Number(row.dataset.zoneIndex)][field] = kind === 'hr' && field !== 'name' ? Number(event.target.value || 0) : event.target.value;
  }));
  container.querySelectorAll('[data-remove-zone]').forEach(button => button.addEventListener('click', event => {
    const row = event.target.closest('[data-zone-index]');
    const list = row.dataset.zoneKind === 'hr' ? state.athlete.zones.hr : state.athlete.zones.pace;
    list.splice(Number(row.dataset.zoneIndex), 1);
    renderZones();
  }));
}

function renderGoals() {
  const goals = [...(state.athlete.goals || [])].sort((a, b) => String(a.goal_date).localeCompare(String(b.goal_date)));
  $('goalList').innerHTML = goals.length ? goals.map(goal => goalCard(goal, true)).join('') : '<p class="muted">Añade el primer objetivo del deportista.</p>';
  $('goalList').querySelectorAll('[data-delete-goal]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este objetivo?')) return;
    await api(`/api/coach/athletes/${state.athlete.id}/goals/${button.dataset.deleteGoal}`, { method: 'DELETE' });
    state.athlete.goals = state.athlete.goals.filter(goal => goal.id !== button.dataset.deleteGoal);
    renderAll();
  }));
}

function renderConnections() {
  const connected = state.athlete.intervals_status === 'connected';
  $('intervalsBadge').textContent = connected ? 'Conectado' : (state.athlete.intervals_status === 'disabled' ? 'No utilizado' : 'Pendiente');
  $('intervalsBadge').className = `badge ${connected ? '' : 'pending'}`;
  const appActive = Boolean(state.athlete.user_id) || state.athlete.app_access_status === 'active';
  $('appAccessBadge').textContent = appActive ? 'Acceso activo' : 'Sin acceso';
  $('appAccessBadge').className = `badge ${appActive ? '' : 'pending'}`;
  $('appAccessText').textContent = appActive
    ? `${state.athlete.display_name} ya tiene una cuenta vinculada y podrá entrar desde la APK.`
    : `El perfil existe, pero ${state.athlete.display_name} todavía no tiene acceso a la app.`;
  $('inviteAthlete').disabled = appActive;
  $('inviteAthlete').textContent = appActive ? 'Acceso ya creado' : 'Enviar acceso a la app';
  $('inviteHint').textContent = state.config.demo && appActive ? 'En demo puede entrar con su correo y contraseña runflow.' : '';
  $('databaseState').textContent = state.config.demo ? 'Modo demostración local' : 'Supabase conectado';
  $('openaiState').textContent = state.config.openaiConfigured ? 'Configurado en el servidor' : 'Pendiente de configurar';
  $('modeBadge').textContent = state.config.demo ? 'Modo demo' : 'Piloto online';
  $('modeBadge').className = `badge ${state.config.demo ? 'pending' : ''}`;
}

function renderAll() {
  ensureWeek();
  renderSummary();
  renderWeekEditor();
  renderProfile();
  renderGoals();
  renderConnections();
  renderDataConnectionState();
}

async function loadAthlete(id) {
  const data = await api(`/api/coach/athletes/${id}?week_start=${isoMonday()}`);
  state.athlete = data.athlete;
  state.loadToleranceSnapshot = null;
  state.templates = [];
  state.pendingImportPackage = null;
  if (!state.athlete.zones) state.athlete.zones = { hr: [], pace: [] };
  state.calendar.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  state.calendar.weeks = new Map();
  state.calendar.selectedWeekStart = localStorage.getItem(`runflow_calendar_week_${id}`) || isoMonday();
  renderAll();
  resetActivityViews();
  state.plan = null; state.seasons = []; state.selectedSeasonId = null; state.selectedMicrocycleId = null;
  await Promise.allSettled([loadCalendarMonth(), loadActivities(false), loadRecovery(false), loadPlan(), loadLoadTolerance(false), loadTemplates()]);
}

function weekPayload(status, weekStart = state.calendar.selectedWeekStart) {
  const week = calendarWeek(weekStart);
  if (weekStart === state.calendar.selectedWeekStart) syncWeekStateFromInputs();
  return {
    week_start: week.week_start,
    week_type: week.week_type || 'Carga controlada',
    title: week.title || '',
    coach_comment: week.coach_comment || '',
    target_load: Number(week.target_load || 0),
    status,
    mesocycle_id: week.mesocycle_id || null,
    end_date: week.end_date || addDays(week.week_start, 6),
    microcycle_type: week.microcycle_type || null,
    primary_objective: week.primary_objective || '',
    planned_hours: Number(week.planned_hours || 0),
    planned_distance_km: Number(week.planned_distance_km || 0),
    planned_elevation_m: Number(week.planned_elevation_m || 0),
    planned_strength_sessions: Number(week.planned_strength_sessions || 0),
    recovery_target: week.recovery_target || '',
    lifecycle_status: week.lifecycle_status || 'planned',
    workouts: week.workouts || [],
  };
}

function syncWeekStateFromInputs() {
  const week = calendarWeek(state.calendar.selectedWeekStart);
  week.week_type = $('weekType').value;
  week.primary_objective = $('weekTitle').value;
  if (!week.title) week.title = $('weekTitle').value || 'Semana';
  week.coach_comment = $('weekComment').value;
  week.target_load = Number($('targetLoad').value || 0);
  return week;
}

async function persistCalendarWeek(weekStart, publish = false, quiet = false) {
  if (weekStart === state.calendar.selectedWeekStart) syncWeekStateFromInputs();
  const week = calendarWeek(weekStart);
  const shouldPublish = publish || week.status === 'published';
  const endpoint = shouldPublish ? `/api/coach/athletes/${state.athlete.id}/week/publish` : `/api/coach/athletes/${state.athlete.id}/week`;
  const data = await api(endpoint, { method: shouldPublish ? 'POST' : 'PUT', body: JSON.stringify(weekPayload(shouldPublish ? 'published' : 'draft', weekStart)) });
  state.calendar.weeks.set(weekStart, { ...emptyCalendarWeek(weekStart), ...data.week, workouts: Array.isArray(data.week.workouts) ? data.week.workouts : [] });
  if (weekStart === isoMonday()) {
    state.athlete.week = state.calendar.weeks.get(weekStart);
    renderSummary();
  }
  if (!quiet) {
    const extra = data.intervals?.skipped ? ` ${data.intervals.reason}` : (shouldPublish ? ` Intervals: ${data.intervals?.exported ?? 0} sincronizadas · ${data.intervals?.created ?? 0} nuevas · ${data.intervals?.updated ?? 0} actualizadas${Number(data.intervals?.deleted || 0) ? ` · ${data.intervals.deleted} eliminadas` : ''}.` : '');
    showMessage(`${shouldPublish ? 'Semana publicada.' : 'Semana guardada.'}${extra}`, 'success');
  }
  renderCalendar();
  return data;
}

function openSessionModal(workoutId = null, date = null) {
  const targetDate = date || state.calendar.selectedWeekStart;
  const weekStart = isoMonday(parseLocalDate(targetDate));
  selectCalendarWeek(weekStart, false);
  const week = calendarWeek(weekStart);
  const existing = workoutId ? (week.workouts || []).find(item => String(item.id) === String(workoutId)) : null;
  const workout = existing ? { ...existing, blocks: Array.isArray(existing.blocks) ? existing.blocks : [] } : {
    id: newId(), workout_date: date || weekStart, sport: 'Run', title: '', summary: '', structured_description: '', planned_load: 0, blocks: [],
  };
  state.editingSession = { weekStart, workoutId: existing ? existing.id : null, draft: workout };
  $('modalTitle').textContent = existing ? `Editar · ${dateLabel(workout.workout_date)}` : `Nueva sesión · ${dateLabel(workout.workout_date)}`;
  $('modalWorkoutDate').value = workout.workout_date;
  $('modalSport').value = workout.sport || 'Run';
  $('modalPriority').value = workout.priority || 'B';
  $('modalLoad').value = workout.planned_load || 0;
  $('modalDuration').value = workout.planned_duration_min ?? '';
  $('modalDistance').value = workout.planned_distance_km ?? '';
  $('modalElevation').value = workout.planned_elevation_m ?? '';
  $('modalIsStrength').checked = Boolean(workout.is_strength || workout.sport === 'Strength');
  $('modalSessionObjective').value = workout.session_objective || '';
  $('modalAdaptationTarget').value = workout.adaptation_target || '';
  $('modalPurpose').value = workout.purpose || '';
  $('modalWorkoutTitle').value = workout.title || '';
  $('modalSummary').value = workout.summary || '';
  $('structuredDescription').value = workout.structured_description || '';
  if ($('intervalsPreviewBox')) $('intervalsPreviewBox').classList.add('hidden');
  const blocks = workout.blocks || [];
  const warmup = blocks.find(block => block.type === 'warmup') || {};
  const activation = blocks.find(block => block.type === 'activation') || {};
  const cooldown = blocks.find(block => block.type === 'cooldown') || {};
  const strengthBlock = blocks.find(block => block.type === 'strength') || {};
  state.modalBlocks = blocks.filter(block => ['central', 'steady'].includes(block.type)).map(block => block.type === 'steady' ? ({ type: 'central', name: block.name || 'Bloque principal', repetitions: 1, work_value: Number(block.duration_min || block.work_value || 0), work_unit: block.duration_min ? 'm' : (block.work_unit || 'm'), target: block.target || 'Z2', recovery_value: 0, recovery_unit: 'm', recovery_target: 'Z1' }) : ({ ...block }));
  state.strengthExercises = Array.isArray(strengthBlock.exercises) ? strengthBlock.exercises.map(item => ({ ...item })) : [];
  $('strengthNeuromuscularCost').value = strengthBlock.neuromuscular_cost || 'low';
  $('strengthExecutionNote').value = strengthBlock.execution_note || '';
  $('warmupMinutes').value = warmup.duration_min ?? (workout.sport === 'Strength' ? 6 : 15);
  $('warmupTarget').value = warmup.target || 'Z2 Pace';
  $('activationReps').value = activation.repetitions ?? 0;
  $('activationWork').value = activation.work_sec ?? 20;
  $('activationRecovery').value = activation.recovery_sec ?? 40;
  $('activationTarget').value = activation.target || 'Z4 Pace';
  $('activationRecoveryTarget').value = activation.recovery_target || 'Z1 Pace';
  $('cooldownMinutes').value = cooldown.duration_min ?? 10;
  $('cooldownTarget').value = cooldown.target || 'Z1 Pace';
  $('deleteSessionModal').classList.toggle('hidden', !existing);
  renderCentralBlocks();
  renderStrengthExercises();
  updateSessionBuilderMode();
  $('sessionModal').classList.remove('hidden');
}

function renderCentralBlocks() {
  $('centralBlocks').innerHTML = state.modalBlocks.length ? state.modalBlocks.map((block, index) => `
    <div class="form-section" data-block="${index}">
      <div class="actions" style="justify-content:space-between"><strong>Bloque ${index + 1}</strong><button class="btn danger small" data-delete-block="${index}" type="button">Eliminar</button></div>
      <div class="field-row-3" style="margin-top:10px"><label>Repeticiones<input data-block-field="repetitions" type="number" min="1" value="${Number(block.repetitions || 1)}"></label><label>Trabajo<input data-block-field="work_value" type="number" min="1" value="${Number(block.work_value || 3)}"></label><label>Unidad<select data-block-field="work_unit"><option value="m" ${block.work_unit === 'm' ? 'selected' : ''}>min</option><option value="s" ${block.work_unit === 's' ? 'selected' : ''}>seg</option><option value="km" ${block.work_unit === 'km' ? 'selected' : ''}>km</option></select></label></div>
      <div class="field-row" style="margin-top:10px"><label>Objetivo trabajo<input data-block-field="target" value="${escapeHtml(block.target || 'Z4 Pace')}"></label><label>Nombre<input data-block-field="name" value="${escapeHtml(block.name || `Bloque ${index + 1}`)}"></label></div>
      <div class="field-row-3" style="margin-top:10px"><label>Recuperación<input data-block-field="recovery_value" type="number" min="0" value="${Number(block.recovery_value || 2)}"></label><label>Unidad<select data-block-field="recovery_unit"><option value="m" ${block.recovery_unit === 'm' ? 'selected' : ''}>min</option><option value="s" ${block.recovery_unit === 's' ? 'selected' : ''}>seg</option></select></label><label>Objetivo recuperación<input data-block-field="recovery_target" value="${escapeHtml(block.recovery_target || 'Z1 Pace')}"></label></div>
    </div>`).join('') : '<p class="muted small">Añade uno o varios bloques centrales.</p>';
  $('centralBlocks').querySelectorAll('[data-block-field]').forEach(input => input.addEventListener('input', event => {
    const row = event.target.closest('[data-block]');
    const field = event.target.dataset.blockField;
    state.modalBlocks[Number(row.dataset.block)][field] = ['repetitions', 'work_value', 'recovery_value'].includes(field) ? Number(event.target.value || 0) : event.target.value;
  }));
  $('centralBlocks').querySelectorAll('[data-delete-block]').forEach(button => button.addEventListener('click', () => {
    state.modalBlocks.splice(Number(button.dataset.deleteBlock), 1); renderCentralBlocks();
  }));
}

function buildBlocks() {
  const blocks = [];
  const warmup = Number($('warmupMinutes').value || 0);
  if (warmup > 0) blocks.push({ type: 'warmup', duration_min: warmup, target: $('warmupTarget').value });
  const reps = Number($('activationReps').value || 0);
  if (reps > 0) blocks.push({ type: 'activation', repetitions: reps, work_sec: Number($('activationWork').value || 20), recovery_sec: Number($('activationRecovery').value || 40), target: $('activationTarget').value, recovery_target: $('activationRecoveryTarget').value });
  const isStrength = $('modalSport').value === 'Strength' || $('modalIsStrength').checked;
  if (isStrength) {
    blocks.push({
      type: 'strength',
      neuromuscular_cost: $('strengthNeuromuscularCost').value || 'low',
      execution_note: $('strengthExecutionNote').value.trim(),
      exercises: state.strengthExercises.map(item => ({
        name: String(item.name || '').trim(),
        sets: Number(item.sets || 0) || null,
        reps: String(item.reps || '').trim(),
        weight_kg: item.weight_kg === '' || item.weight_kg === null || item.weight_kg === undefined ? null : Number(item.weight_kg),
        rir: item.rir === '' || item.rir === null || item.rir === undefined ? null : Number(item.rir),
        rest_sec: item.rest_sec === '' || item.rest_sec === null || item.rest_sec === undefined ? null : Number(item.rest_sec),
        unilateral: Boolean(item.unilateral),
        notes: String(item.notes || '').trim(),
      })).filter(item => item.name),
    });
  } else {
    blocks.push(...state.modalBlocks.map(block => ({ type: 'central', ...block })));
  }
  const cooldown = Number($('cooldownMinutes').value || 0);
  if (cooldown > 0) blocks.push({ type: 'cooldown', duration_min: cooldown, target: $('cooldownTarget').value });
  return blocks;
}

function intervalsTargetForBuilder(target, sport = 'Run') {
  const value = String(target || '').replace(/\s+/g, ' ').trim();
  const zone = value.match(/\bZ\s*([1-7])(?:\s*-\s*Z?\s*([1-7]))?/i);
  if (zone) {
    const label = zone[2] ? `Z${zone[1]}-Z${zone[2]}` : `Z${zone[1]}`;
    if (/\b(Pace|HR)\b/i.test(value)) return value;
    return ['Run', 'TrailRun'].includes(sport) ? `${label} Pace` : label;
  }
  if (/\b(Pace|HR|FTP)\b/i.test(value) || /%/.test(value) || /\d:\d{2}/.test(value)) return value;
  if (/progresiv/i.test(value)) return ['Run', 'TrailRun'].includes(sport) ? 'Z3-Z4 Pace' : '';
  if (/suave|trote/i.test(value)) return ['Run', 'TrailRun'].includes(sport) ? 'Z1 Pace' : '';
  if (/aer[oó]bic/i.test(value)) return ['Run', 'TrailRun'].includes(sport) ? 'Z2 Pace' : '';
  return '';
}

function builderDurationToken(value, unit = 'm') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const cleaned = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  if (unit === 's') return `${cleaned}s`;
  if (unit === 'km') return `${cleaned}km`;
  return `${cleaned}m`;
}

function generateStructuredDescription() {
  const lines = [];
  const blocks = buildBlocks();
  const sport = $('modalSport').value || 'Run';
  const isStrength = sport === 'Strength' || $('modalIsStrength').checked;

  blocks.forEach(block => {
    if (block.type === 'warmup') {
      const duration = builderDurationToken(block.duration_min, 'm');
      if (duration) { const target = intervalsTargetForBuilder(block.target, sport); lines.push('Calentamiento', `- ${duration}${target ? ` ${target}` : ''}`, ''); }
    }
    if (block.type === 'activation') {
      const work = builderDurationToken(block.work_sec, 's');
      const recovery = builderDurationToken(block.recovery_sec, 's');
      if (work) {
        lines.push(Number(block.repetitions || 1) > 1 ? `Activacion ${Number(block.repetitions)}x` : 'Activacion');
        { const target = intervalsTargetForBuilder(block.target, sport); lines.push(`- ${work}${target ? ` ${target}` : ''}`); }
        if (recovery) { const target = intervalsTargetForBuilder(block.recovery_target, sport); lines.push(`- ${recovery}${target ? ` ${target}` : ''}`); }
        lines.push('');
      }
    }
    if (block.type === 'central') {
      const work = builderDurationToken(block.work_value, block.work_unit || 'm');
      const recovery = builderDurationToken(block.recovery_value, block.recovery_unit || 'm');
      if (work) {
        const reps = Math.max(1, Number(block.repetitions || 1));
        lines.push(reps > 1 ? `${block.name || 'Bloque principal'} ${reps}x` : (block.name || 'Bloque principal'));
        { const target = intervalsTargetForBuilder(block.target, sport); lines.push(`- ${work}${target ? ` ${target}` : ''}`); }
        if (recovery) { const target = intervalsTargetForBuilder(block.recovery_target, sport); lines.push(`- ${recovery}${target ? ` ${target}` : ''}`); }
        lines.push('');
      }
    }
    if (block.type === 'strength') {
      const cost = ({ low: 'bajo', medium: 'medio', high: 'alto' })[block.neuromuscular_cost] || block.neuromuscular_cost || '—';
      lines.push(`Fuerza · coste neuromuscular ${cost}`);
      if (block.execution_note) lines.push(`- ${block.execution_note}`);
      (block.exercises || []).forEach(exercise => {
        const parts = [];
        if (exercise.sets) parts.push(`${exercise.sets}x${exercise.reps || '—'}`);
        else if (exercise.reps) parts.push(exercise.reps);
        if (exercise.weight_kg !== '' && exercise.weight_kg !== null && exercise.weight_kg !== undefined && Number.isFinite(Number(exercise.weight_kg))) parts.push(`${Number(exercise.weight_kg)} kg`);
        if (exercise.rir !== '' && exercise.rir !== null && exercise.rir !== undefined && Number.isFinite(Number(exercise.rir))) parts.push(`RIR ${Number(exercise.rir)}`);
        if (exercise.rest_sec !== '' && exercise.rest_sec !== null && exercise.rest_sec !== undefined && Number.isFinite(Number(exercise.rest_sec))) parts.push(`descanso ${Number(exercise.rest_sec)} s`);
        lines.push(`- ${exercise.name}${parts.length ? ` · ${parts.join(' · ')}` : ''}${exercise.notes ? ` · ${exercise.notes}` : ''}`);
      });
      lines.push('');
    }
    if (block.type === 'cooldown') {
      const duration = builderDurationToken(block.duration_min, 'm');
      if (duration) { const target = intervalsTargetForBuilder(block.target, sport); lines.push('Vuelta a la calma', `- ${duration}${target ? ` ${target}` : ''}`, ''); }
    }
  });
  $('structuredDescription').value = lines.join('\n').trim();
  if ($('intervalsPreviewBox')) $('intervalsPreviewBox').classList.add('hidden');
  return $('structuredDescription').value;
}


async function previewCurrentSessionInIntervals() {
  if (!state.editingSession) return;
  try {
    const workout = currentModalWorkout();
    $('previewIntervals').disabled = true;
    $('intervalsPreviewText').value = 'Generando vista previa…';
    $('intervalsPreviewBox').classList.remove('hidden');
    const data = await api(`/api/coach/athletes/${state.athlete.id}/intervals-preview`, {
      method: 'POST',
      body: JSON.stringify({ week_start: state.editingSession.weekStart, workouts: [workout] }),
    });
    const event = data.events && data.events[0];
    if (!event) {
      $('intervalsPreviewText').value = 'Esta sesión no se envía a Intervals.';
      $('intervalsPreviewMeta').textContent = '';
      return;
    }
    $('intervalsPreviewMeta').textContent = `${event.type} · carga ${event.icu_training_load ?? '—'} · ${event.moving_time ? `${Math.round(event.moving_time / 60)} min` : 'duración —'}`;
    $('intervalsPreviewText').value = event.description || '(sin descripción estructurada)';
  } catch (error) {
    $('intervalsPreviewText').value = error.message;
    showMessage(error.message, 'error');
  } finally {
    $('previewIntervals').disabled = false;
  }
}


function updateSessionBuilderMode() {
  const isStrength = $('modalSport').value === 'Strength' || $('modalIsStrength').checked;
  $('strengthBuilder').classList.toggle('hidden', !isStrength);
  $('enduranceBlocksSection').classList.toggle('hidden', isStrength);
  if (isStrength && !state.strengthExercises.length) {
    state.strengthExercises = [
      { name: 'Split squat', sets: 3, reps: '6/6', weight_kg: '', rir: 3, rest_sec: 90, unilateral: true, notes: '' },
      { name: 'Elevación de sóleo', sets: 3, reps: '10', weight_kg: '', rir: 3, rest_sec: 60, unilateral: false, notes: '' },
    ];
    renderStrengthExercises();
  }
}

function renderStrengthExercises() {
  const box = $('strengthExercises');
  if (!box) return;
  box.innerHTML = state.strengthExercises.length ? state.strengthExercises.map((exercise, index) => `
    <div class="strength-exercise" data-strength-index="${index}">
      <div class="strength-exercise-head"><strong>Ejercicio ${index + 1}</strong><button class="btn danger small" data-delete-strength="${index}" type="button">Eliminar</button></div>
      <div class="field-row-3"><label>Ejercicio<input data-strength-field="name" value="${escapeHtml(exercise.name || '')}" placeholder="Ej.: split squat"></label><label>Series<input data-strength-field="sets" type="number" min="1" value="${exercise.sets ?? ''}"></label><label>Repeticiones<input data-strength-field="reps" value="${escapeHtml(exercise.reps || '')}" placeholder="6/6, 10, 30 s…"></label></div>
      <div class="field-row-3" style="margin-top:10px"><label>Peso (kg)<input data-strength-field="weight_kg" type="number" min="0" step="0.5" value="${exercise.weight_kg ?? ''}" placeholder="Opcional"></label><label>RIR<input data-strength-field="rir" type="number" min="0" max="6" step="1" value="${exercise.rir ?? ''}" placeholder="Opcional"></label><label>Descanso (s)<input data-strength-field="rest_sec" type="number" min="0" step="5" value="${exercise.rest_sec ?? ''}"></label></div>
      <div class="field-row" style="margin-top:10px"><label class="checkbox-label"><input data-strength-field="unilateral" type="checkbox" ${exercise.unilateral ? 'checked' : ''}> Unilateral</label><label>Notas<input data-strength-field="notes" value="${escapeHtml(exercise.notes || '')}" placeholder="Técnica, tempo, rango…"></label></div>
    </div>`).join('') : '<p class="muted small">Añade los ejercicios de la sesión. El peso se puede completar más adelante.</p>';
  box.querySelectorAll('[data-strength-field]').forEach(input => {
    const handler = event => {
      const row = event.target.closest('[data-strength-index]');
      const item = state.strengthExercises[Number(row.dataset.strengthIndex)];
      const field = event.target.dataset.strengthField;
      if (field === 'unilateral') item[field] = event.target.checked;
      else if (['sets', 'weight_kg', 'rir', 'rest_sec'].includes(field)) item[field] = event.target.value === '' ? '' : Number(event.target.value);
      else item[field] = event.target.value;
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });
  box.querySelectorAll('[data-delete-strength]').forEach(button => button.addEventListener('click', () => {
    state.strengthExercises.splice(Number(button.dataset.deleteStrength), 1);
    renderStrengthExercises();
  }));
}

function applyTemplateToOpenSession(template) {
  const data = JSON.parse(JSON.stringify(template.template_data || {}));
  const currentDate = $('modalWorkoutDate').value || state.calendar.selectedWeekStart;
  state.editingSession.draft = { ...state.editingSession.draft, ...data, id: state.editingSession.draft.id || newId(), workout_date: currentDate };
  $('modalSport').value = data.sport || 'Run';
  $('modalPriority').value = data.priority || 'B';
  $('modalLoad').value = data.planned_load ?? 0;
  $('modalDuration').value = data.planned_duration_min ?? '';
  $('modalDistance').value = data.planned_distance_km ?? '';
  $('modalElevation').value = data.planned_elevation_m ?? '';
  $('modalIsStrength').checked = Boolean(data.is_strength || data.sport === 'Strength');
  $('modalSessionObjective').value = data.session_objective || '';
  $('modalAdaptationTarget').value = data.adaptation_target || '';
  $('modalPurpose').value = data.purpose || '';
  $('modalWorkoutTitle').value = data.title || template.name || '';
  $('modalSummary').value = data.summary || '';
  $('structuredDescription').value = data.structured_description || '';
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  const warmup = blocks.find(block => block.type === 'warmup') || {};
  const activation = blocks.find(block => block.type === 'activation') || {};
  const cooldown = blocks.find(block => block.type === 'cooldown') || {};
  const strength = blocks.find(block => block.type === 'strength') || {};
  state.modalBlocks = blocks.filter(block => ['central', 'steady'].includes(block.type)).map(block => block.type === 'steady' ? ({ type: 'central', name: block.name || 'Bloque principal', repetitions: 1, work_value: Number(block.duration_min || block.work_value || 0), work_unit: block.duration_min ? 'm' : (block.work_unit || 'm'), target: block.target || 'Z2', recovery_value: 0, recovery_unit: 'm', recovery_target: 'Z1' }) : ({ ...block }));
  state.strengthExercises = Array.isArray(strength.exercises) ? strength.exercises.map(item => ({ ...item })) : [];
  $('strengthNeuromuscularCost').value = strength.neuromuscular_cost || 'low';
  $('strengthExecutionNote').value = strength.execution_note || '';
  $('warmupMinutes').value = warmup.duration_min ?? (data.sport === 'Strength' ? 6 : 15);
  $('warmupTarget').value = warmup.target || (data.sport === 'Strength' ? 'Movilidad + activación' : 'Z2 Pace');
  $('activationReps').value = activation.repetitions ?? 0;
  $('activationWork').value = activation.work_sec ?? 20;
  $('activationRecovery').value = activation.recovery_sec ?? 40;
  $('activationTarget').value = activation.target || 'Z4 Pace';
  $('activationRecoveryTarget').value = activation.recovery_target || 'Z1 Pace';
  $('cooldownMinutes').value = cooldown.duration_min ?? (data.sport === 'Strength' ? 4 : 10);
  $('cooldownTarget').value = cooldown.target || (data.sport === 'Strength' ? 'Movilidad suave' : 'Z1 Pace');
  renderCentralBlocks(); renderStrengthExercises(); updateSessionBuilderMode();
  if (!$('structuredDescription').value) generateStructuredDescription();
}

function currentModalWorkout() {
  if (!state.editingSession) return null;
  const workoutDate = $('modalWorkoutDate').value;
  return {
    ...state.editingSession.draft,
    id: state.editingSession.draft.id || newId(),
    workout_date: workoutDate,
    sport: $('modalSport').value,
    priority: $('modalPriority').value,
    planned_load: Number($('modalLoad').value || 0),
    planned_duration_min: $('modalDuration').value === '' ? null : Number($('modalDuration').value),
    planned_distance_km: $('modalDistance').value === '' ? null : Number($('modalDistance').value),
    planned_elevation_m: $('modalElevation').value === '' ? null : Number($('modalElevation').value),
    is_strength: $('modalIsStrength').checked || $('modalSport').value === 'Strength',
    session_objective: $('modalSessionObjective').value.trim(),
    adaptation_target: $('modalAdaptationTarget').value.trim(),
    purpose: $('modalPurpose').value.trim(),
    title: $('modalWorkoutTitle').value.trim() || 'Sesión',
    summary: $('modalSummary').value.trim(),
    blocks: buildBlocks(),
    structured_description: $('structuredDescription').value || generateStructuredDescription(),
  };
}

function templateMetric(template) {
  const data = template.template_data || {};
  const strength = (data.blocks || []).find(block => block.type === 'strength');
  const exercises = strength && Array.isArray(strength.exercises) ? ` · ${strength.exercises.length} ejercicios` : '';
  return `${data.planned_duration_min ? `${data.planned_duration_min} min · ` : ''}carga ${Number(data.planned_load || 0)}${exercises}`;
}

function renderLibrary() {
  if (!$('libraryGrid')) return;
  const sport = $('librarySportFilter').value || 'all';
  const stimulus = $('libraryStimulusFilter').value || 'all';
  const search = String($('librarySearch').value || '').toLowerCase().trim();
  const rows = (state.templates || []).filter(template => {
    if (sport !== 'all' && template.sport !== sport) return false;
    if (stimulus !== 'all' && String(template.stimulus || template.category || '') !== stimulus) return false;
    if (search) {
      const haystack = `${template.name} ${template.category || ''} ${template.stimulus || ''} ${template.template_data?.title || ''} ${template.template_data?.adaptation_target || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  $('libraryStatus').textContent = `${rows.length} plantillas · ${state.templates.filter(item => item.source === 'custom').length} guardadas por ti`;
  $('libraryGrid').innerHTML = rows.length ? rows.map(template => {
    const data = template.template_data || {};
    const objective = data.session_objective || data.summary || 'Plantilla reutilizable.';
    return `<article class="template-card">
      <div class="template-card-head"><div><span class="badge ${template.source === 'custom' ? '' : 'pending'}">${template.source === 'custom' ? 'Mi biblioteca' : 'RunFlow'}</span><h3>${escapeHtml(template.name)}</h3></div><span class="template-sport">${escapeHtml(template.sport === 'Strength' ? 'Fuerza' : template.sport === 'Run' ? 'Carrera' : template.sport)}</span></div>
      <p class="template-category">${escapeHtml(template.category || '')}${template.stimulus ? ` · ${escapeHtml(template.stimulus)}` : ''}</p>
      <p>${escapeHtml(objective)}</p><small>${escapeHtml(templateMetric(template))}</small>
      <div class="actions" style="margin-top:12px"><button class="btn primary small" data-use-template="${escapeHtml(template.id)}" type="button">Usar plantilla</button>${template.editable ? `<button class="btn danger small" data-delete-template="${escapeHtml(template.id)}" type="button">Eliminar</button>` : ''}</div>
    </article>`;
  }).join('') : '<div class="empty-state">No hay plantillas con estos filtros.</div>';
}

function refreshLibraryStimuli() {
  if (!$('libraryStimulusFilter')) return;
  const current = $('libraryStimulusFilter').value || 'all';
  const values = [...new Set((state.templates || []).map(item => String(item.stimulus || item.category || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  $('libraryStimulusFilter').innerHTML = '<option value="all">Todos los estímulos</option>' + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  if (values.includes(current)) $('libraryStimulusFilter').value = current;
}

async function loadTemplates() {
  if (!state.athlete) return;
  const data = await api(`/api/coach/templates?athlete_id=${encodeURIComponent(state.athlete.id)}`);
  state.templates = data.templates || [];
  refreshLibraryStimuli(); renderLibrary();
}

async function saveCurrentSessionAsTemplate() {
  const workout = currentModalWorkout();
  if (!workout) return;
  const name = window.prompt('Nombre de la plantilla', workout.title || 'Nueva plantilla');
  if (!name) return;
  const category = window.prompt('Categoría', workout.is_strength ? 'Fuerza trail' : (workout.adaptation_target || 'Running')) || 'Mi biblioteca';
  try {
    await api('/api/coach/templates', { method: 'POST', body: JSON.stringify({ athlete_id: state.athlete.id, name, category, sport: workout.sport, stimulus: workout.adaptation_target, template_data: workout }) });
    await loadTemplates(); showMessage('Plantilla guardada en tu biblioteca.', 'success');
  } catch (error) { showMessage(error.message, 'error'); }
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSelectedWeek() {
  if (!state.athlete) return;
  syncWeekStateFromInputs();
  const week = JSON.parse(JSON.stringify(weekPayload(calendarWeek(state.calendar.selectedWeekStart).status || 'draft', state.calendar.selectedWeekStart)));
  const pkg = { schema: 'runflow.plan.v1', generated_at: new Date().toISOString(), athlete: { display_name: state.athlete.display_name, athlete_id: state.athlete.id }, weeks: [week] };
  const safeName = String(state.athlete.display_name || 'athlete').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  downloadJson(`RunFlow_${safeName}_${week.week_start}.json`, pkg);
  showMessage('Semana exportada en formato RunFlow.', 'success');
}

function validatePlanImport(value) {
  if (!value || value.schema !== 'runflow.plan.v1' || !Array.isArray(value.weeks) || !value.weeks.length) throw new Error('El archivo no es un paquete RunFlow plan.v1 válido.');
  if (value.weeks.length > 26) throw new Error('El paquete contiene demasiadas semanas.');
  const weeks = value.weeks.map(week => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week.week_start || ''))) throw new Error('Todas las semanas necesitan week_start en formato AAAA-MM-DD.');
    const workouts = Array.isArray(week.workouts) ? week.workouts.slice(0, 30).map(item => ({ ...item, id: item.id || newId(), workout_date: item.workout_date || week.week_start })) : [];
    return { ...week, workouts };
  });
  return { ...value, weeks };
}

function renderPlanImportPreview(pkg) {
  const sessions = pkg.weeks.reduce((sum, week) => sum + week.workouts.length, 0);
  const load = pkg.weeks.reduce((sum, week) => sum + week.workouts.reduce((a, item) => a + Number(item.planned_load || 0), 0), 0);
  $('planImportSummary').innerHTML = `<div class="grid grid-3"><article class="metric"><span>Semanas</span><strong>${pkg.weeks.length}</strong></article><article class="metric"><span>Sesiones</span><strong>${sessions}</strong></article><article class="metric"><span>Carga sesiones</span><strong>${Math.round(load)}</strong></article></div>`;
  $('planImportWeeks').innerHTML = pkg.weeks.map(week => `<div class="import-week"><strong>${dateLabel(week.week_start)} – ${dateLabel(addDays(week.week_start, 6))}</strong><span>${week.workouts.length} sesiones · ${Math.round(week.workouts.reduce((a, item) => a + Number(item.planned_load || 0), 0))} carga</span><small>${escapeHtml(week.primary_objective || week.title || '')}</small></div>`).join('');
  $('planImportStatus').textContent = '';
  $('planImportModal').classList.remove('hidden');
}

function mergeImportedWorkouts(existing, incoming) {
  const map = new Map((existing || []).map(item => [String(item.id), { ...item }]));
  (incoming || []).forEach(item => {
    const id = String(item.id || newId());
    map.set(id, { ...(map.get(id) || {}), ...item, id });
  });
  return [...map.values()].sort((a, b) => String(a.workout_date).localeCompare(String(b.workout_date)));
}

async function importPendingPlan() {
  const pkg = state.pendingImportPackage;
  if (!pkg || !state.athlete) return;
  const button = $('confirmPlanImport');
  try {
    button.disabled = true; $('planImportStatus').textContent = 'Importando…';
    for (const incoming of pkg.weeks) {
      const currentData = await api(`/api/coach/athletes/${state.athlete.id}?week_start=${encodeURIComponent(incoming.week_start)}`);
      const existing = currentData.athlete.week || { week_start: incoming.week_start, workouts: [] };
      const payload = {
        ...existing,
        ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined && value !== null)),
        week_start: incoming.week_start,
        status: existing.status || incoming.status || 'draft',
        workouts: mergeImportedWorkouts(existing.workouts, incoming.workouts),
      };
      await api(`/api/coach/athletes/${state.athlete.id}/week`, { method: 'PUT', body: JSON.stringify(payload) });
    }
    $('planImportModal').classList.add('hidden'); state.pendingImportPackage = null;
    await loadCalendarMonth(); await loadPlan();
    showMessage('Planificación importada. Revisa la semana antes de publicarla.', 'success');
  } catch (error) { $('planImportStatus').textContent = error.message; }
  finally { button.disabled = false; }
}

async function downloadBinaryFile(endpoint) {
  const response = await fetch(endpoint);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo descargar el archivo.');
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match ? match[1] : 'runflow-download';
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function athleteOption(item) {
  const connection = item.intervals_status === 'connected' ? '' : ' · Intervals pendiente';
  const app = item.app_access_status === 'active' || item.user_id ? '' : ' · sin app';
  return `<option value="${item.id}">${escapeHtml(item.display_name)}${connection}${app}</option>`;
}

async function refreshAthletes(selectId = null) {
  const data = await api('/api/coach/athletes');
  state.athletes = data.athletes;
  $('athleteSelect').innerHTML = state.athletes.map(athleteOption).join('');
  if (!state.athletes.length) {
    state.athlete = null;
    return;
  }
  const id = selectId && state.athletes.some(item => item.id === selectId) ? selectId : state.athletes[0].id;
  $('athleteSelect').value = id;
  await loadAthlete(id);
}

async function init() {
  try {
    const [me, config] = await Promise.all([api('/api/auth/me'), api('/api/config')]);
    state.user = me.user; state.config = config;
    if (!state.user.roles.includes('coach')) return location.href = '/login';
    $('userChip').textContent = state.user.display_name || state.user.email;
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(); start.setDate(start.getDate() - 35);
    $('activityNewest').value = today; $('activityOldest').value = start.toISOString().slice(0, 10);
    $('recoveryNewest').value = today; $('recoveryOldest').value = start.toISOString().slice(0, 10);
    await refreshAthletes();
    if (!state.athletes.length) {
      $('athleteModal').classList.remove('hidden');
      showMessage('Crea tu primer deportista para empezar.', 'success');
    }
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.go)));
$('athleteSelect').addEventListener('change', () => loadAthlete($('athleteSelect').value).catch(error => showMessage(error.message, 'error')));
$('logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login'; });
$('newAthlete').addEventListener('click', () => {
  ['newAthleteName','newAthleteEmail','newAthletePhone','newAthleteWatchBrand','newAthleteWatchModel','newAthleteObjective'].forEach(id => $(id).value = '');
  $('newAthleteIntervals').value = 'pending';
  $('newAthleteInvite').checked = false;
  $('createAthleteStatus').textContent = '';
  $('athleteModal').classList.remove('hidden');
});
$('closeAthleteModal').addEventListener('click', () => $('athleteModal').classList.add('hidden'));
$('athleteModal').addEventListener('click', event => { if (event.target === $('athleteModal')) $('athleteModal').classList.add('hidden'); });
$('createAthlete').addEventListener('click', async () => {
  const payload = {
    display_name: $('newAthleteName').value,
    email: $('newAthleteEmail').value,
    phone: $('newAthletePhone').value,
    intervals_status: $('newAthleteIntervals').value,
    watch_brand: $('newAthleteWatchBrand').value,
    watch_model: $('newAthleteWatchModel').value,
    objective: $('newAthleteObjective').value,
    invite: $('newAthleteInvite').checked,
  };
  try {
    $('createAthlete').disabled = true;
    $('createAthleteStatus').textContent = 'Creando…';
    const data = await api('/api/coach/athletes', { method: 'POST', body: JSON.stringify(payload) });
    $('athleteModal').classList.add('hidden');
    await refreshAthletes(data.athlete.id);
    showMessage(`${data.athlete.display_name} se ha añadido a tu cartera.`, 'success');
  } catch (error) {
    $('createAthleteStatus').textContent = error.message;
  } finally {
    $('createAthlete').disabled = false;
  }
});
$('inviteAthlete').addEventListener('click', async () => {
  if (!state.athlete) return;
  try {
    $('inviteAthlete').disabled = true;
    const data = await api(`/api/coach/athletes/${state.athlete.id}/invite`, { method: 'POST' });
    state.athlete.user_id = data.user_id || state.athlete.user_id || 'active';
    state.athlete.app_access_status = 'active';
    renderConnections();
    await refreshAthletes(state.athlete.id);
    showMessage(data.message || 'Acceso a la app preparado.', 'success');
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    renderConnections();
  }
});

$('previousMonth').addEventListener('click', async () => {
  state.calendar.month = new Date(state.calendar.month.getFullYear(), state.calendar.month.getMonth() - 1, 1);
  await loadCalendarMonth().catch(error => showMessage(error.message, 'error'));
});
$('nextMonth').addEventListener('click', async () => {
  state.calendar.month = new Date(state.calendar.month.getFullYear(), state.calendar.month.getMonth() + 1, 1);
  await loadCalendarMonth().catch(error => showMessage(error.message, 'error'));
});
$('currentMonth').addEventListener('click', async () => {
  const now = new Date();
  state.calendar.month = new Date(now.getFullYear(), now.getMonth(), 1);
  state.calendar.selectedWeekStart = isoMonday(now);
  await loadCalendarMonth().catch(error => showMessage(error.message, 'error'));
});
$('weekType').addEventListener('change', syncWeekStateFromInputs);
$('targetLoad').addEventListener('input', syncWeekStateFromInputs);
$('weekTitle').addEventListener('input', syncWeekStateFromInputs);
$('weekComment').addEventListener('input', syncWeekStateFromInputs);

$('saveWeek').addEventListener('click', async () => {
  try {
    $('saveWeek').disabled = true;
    $('saveWeekStatus').textContent = 'Guardando…';
    const week = calendarWeek(state.calendar.selectedWeekStart);
    await persistCalendarWeek(state.calendar.selectedWeekStart, week.status === 'published');
    $('saveWeekStatus').textContent = week.status === 'published' ? 'Cambios guardados y sincronizados' : 'Borrador guardado';
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    $('saveWeek').disabled = false;
  }
});

$('publishWeek').addEventListener('click', async () => {
  try {
    $('publishWeek').disabled = true;
    $('saveWeekStatus').textContent = 'Publicando…';
    await persistCalendarWeek(state.calendar.selectedWeekStart, true);
    $('saveWeekStatus').textContent = 'Semana publicada';
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    $('publishWeek').disabled = false;
  }
});

$('saveProfile').addEventListener('click', async () => {
  const payload = {
    display_name: $('displayName').value, email: $('athleteEmail').value, intervals_status: state.athlete.intervals_status,
    birth_date: $('birthDate').value, sex: $('sex').value, phone: $('phone').value, weight_kg: $('weight').value, height_cm: $('height').value,
    level: $('level').value, experience_years: $('experience').value, weekly_sessions: $('weeklySessions').value, weekly_km: $('weeklyKm').value, weekly_hours: $('weeklyHours').value,
    availability: { notes: $('availability').value }, restrictions: $('restrictions').value, injury_history: $('injuryHistory').value, current_issues: $('currentIssues').value,
    objective: $('objective').value, coach_notes: $('coachNotes').value, watch_brand: state.athlete.profile?.watch_brand || '', watch_model: state.athlete.profile?.watch_model || '', custom_fields: state.athlete.profile?.custom_fields || [],
    load_tolerance_profile: { habitual_min: numberInputOrNull('loadToleranceHabitualMin'), habitual_max: numberInputOrNull('loadToleranceHabitualMax'), development_min: numberInputOrNull('loadToleranceDevelopmentMin'), development_max: numberInputOrNull('loadToleranceDevelopmentMax'), high_min: numberInputOrNull('loadToleranceHighMin'), high_max: numberInputOrNull('loadToleranceHighMax'), provisional_ceiling: numberInputOrNull('loadToleranceCeiling'), confidence: $('loadToleranceConfidence').value, notes: $('loadToleranceNotes').value },
  };
  try {
    $('profileStatus').textContent = 'Guardando…';
    const data = await api(`/api/coach/athletes/${state.athlete.id}/profile`, { method: 'PUT', body: JSON.stringify(payload) });
    state.athlete = data.athlete; ensureWeek(); renderAll(); $('profileStatus').textContent = 'Ficha guardada'; showMessage('Ficha del deportista actualizada.', 'success');
  } catch (error) { showMessage(error.message, 'error'); }
});

$('addHrZone').addEventListener('click', () => { state.athlete.zones.hr.push({ name: `Z${state.athlete.zones.hr.length + 1}`, min_value: '', max_value: '' }); renderZones(); });
$('addPaceZone').addEventListener('click', () => { state.athlete.zones.pace.push({ name: `Z${state.athlete.zones.pace.length + 1}`, slow_pace: '', fast_pace: '' }); renderZones(); });
$('saveZones').addEventListener('click', async () => {
  try {
    const data = await api(`/api/coach/athletes/${state.athlete.id}/zones`, { method: 'PUT', body: JSON.stringify(state.athlete.zones) });
    state.athlete.zones = data.zones; renderZones(); showMessage('Zonas guardadas.', 'success');
  } catch (error) { showMessage(error.message, 'error'); }
});

$('addGoal').addEventListener('click', async () => {
  try {
    const payload = { name: $('goalInputName').value, goal_date: $('goalInputDate').value, priority: $('goalInputPriority').value, distance_km: $('goalDistance').value, elevation_m: $('goalElevation').value, performance_target: $('goalPerformance').value };
    const data = await api(`/api/coach/athletes/${state.athlete.id}/goals`, { method: 'POST', body: JSON.stringify(payload) });
    state.athlete.goals.push(data.goal); ['goalInputName','goalInputDate','goalDistance','goalElevation','goalPerformance'].forEach(id => $(id).value = ''); renderAll(); showMessage('Objetivo añadido.', 'success');
  } catch (error) { showMessage(error.message, 'error'); }
});

$('saveIntervalsKey').addEventListener('click', async () => {
  try {
    const key = $('intervalsKey').value.trim();
    await api(`/api/coach/athletes/${state.athlete.id}/integrations/intervals`, { method: 'PUT', body: JSON.stringify({ api_key: key }) });
    state.athlete.intervals_status = 'connected'; $('intervalsKey').value = ''; renderConnections(); renderWeekEditor(); showMessage('Intervals.icu conectado para este deportista.', 'success');
  } catch (error) { showMessage(error.message, 'error'); }
});

$('closeModal').addEventListener('click', () => $('sessionModal').classList.add('hidden'));
$('sessionModal').addEventListener('click', event => { if (event.target === $('sessionModal')) $('sessionModal').classList.add('hidden'); });
$('addBlock').addEventListener('click', () => { state.modalBlocks.push({ type: 'central', name: `Bloque ${state.modalBlocks.length + 1}`, repetitions: 4, work_value: 3, work_unit: 'm', target: 'Z4 Pace', recovery_value: 2, recovery_unit: 'm', recovery_target: 'Z1 Pace' }); renderCentralBlocks(); });
$('generateDescription').addEventListener('click', generateStructuredDescription);
$('previewIntervals').addEventListener('click', previewCurrentSessionInIntervals);
$('modalSport').addEventListener('change', () => { $('modalIsStrength').checked = $('modalSport').value === 'Strength'; updateSessionBuilderMode(); });
$('modalIsStrength').addEventListener('change', updateSessionBuilderMode);
$('addStrengthExercise').addEventListener('click', () => { state.strengthExercises.push({ name: '', sets: 3, reps: '8', weight_kg: '', rir: 3, rest_sec: 60, unilateral: false, notes: '' }); renderStrengthExercises(); });
$('saveAsTemplate').addEventListener('click', saveCurrentSessionAsTemplate);
$('chooseTemplateFromModal').addEventListener('click', () => { $('sessionModal').classList.add('hidden'); switchView('library'); });
$('saveSessionModal').addEventListener('click', async () => {
  if (!state.editingSession) return;
  const originalWeekStart = state.editingSession.weekStart;
  const originalWeek = calendarWeek(originalWeekStart);
  const workoutDate = $('modalWorkoutDate').value;
  if (!workoutDate) return showMessage('Selecciona la fecha de la sesión.', 'error');
  const targetWeekStart = isoMonday(parseLocalDate(workoutDate));
  const targetWeek = calendarWeek(targetWeekStart);
  const workout = currentModalWorkout();
  try {
    $('saveSessionModal').disabled = true;
    if (state.editingSession.workoutId) {
      originalWeek.workouts = (originalWeek.workouts || []).filter(item => String(item.id) !== String(state.editingSession.workoutId));
    }
    targetWeek.workouts = [...(targetWeek.workouts || []).filter(item => String(item.id) !== String(workout.id)), workout]
      .sort((a, b) => String(a.workout_date).localeCompare(String(b.workout_date)));
    $('sessionModal').classList.add('hidden');
    if (originalWeekStart !== targetWeekStart) await persistCalendarWeek(originalWeekStart, originalWeek.status === 'published', true);
    await persistCalendarWeek(targetWeekStart, targetWeek.status === 'published', true);
    selectCalendarWeek(targetWeekStart);
    showMessage(state.editingSession.workoutId ? 'Sesión actualizada.' : 'Sesión añadida.', 'success');
    state.editingSession = null;
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    $('saveSessionModal').disabled = false;
  }
});

$('deleteSessionModal').addEventListener('click', async () => {
  if (!state.editingSession?.workoutId) return;
  const week = calendarWeek(state.editingSession.weekStart);
  week.workouts = (week.workouts || []).filter(item => String(item.id) !== String(state.editingSession.workoutId));
  try {
    $('deleteSessionModal').disabled = true;
    $('sessionModal').classList.add('hidden');
    await persistCalendarWeek(week.week_start, week.status === 'published', true);
    showMessage('Sesión eliminada.', 'success');
    state.editingSession = null;
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    $('deleteSessionModal').disabled = false;
  }
});



function planStatusLabel(status) {
  return ({ planned: 'Planificado', active: 'Activo', completed: 'Completado', draft: 'Borrador', published: 'Publicado' })[status] || status || '—';
}

function priorityLabel(code) {
  return ({ A: 'A · Principal', B: 'B · Secundario', C: 'C · Apoyo' })[code] || code || 'B';
}

function metricValue(value, suffix = '') {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 10) / 10}${suffix}` : `—${suffix}`;
}

function planCompareItem(label, planned, actual, suffix = '') {
  return `<div class="plan-compare-item"><span>${escapeHtml(label)}</span><div><b>${metricValue(planned, suffix)}</b><small>plan</small></div><div><b>${metricValue(actual, suffix)}</b><small>real</small></div></div>`;
}
function progressPanel(progress, label = 'Cumplimiento a fecha de hoy') {
  if (!progress) return '<div class="muted small">Sin datos de seguimiento.</div>';
  const loadPct = progress.adherence?.load_pct;
  const completion = progress.completion_rate;
  const extra = Number(progress.extra_load || 0);
  return `<div class="cycle-progress-head"><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(progressStatusLabel(progress.status))}</strong></div><span class="badge ${progress.status === 'on_track' ? '' : 'pending'}">${loadPct == null ? '—' : pctLabel(loadPct)} carga</span></div><div class="cycle-progress-grid"><div><span>Plan hasta hoy</span><b>${metricValue(progress.planned_to_date?.load)}</b></div><div><span>Real</span><b>${metricValue(progress.actual_load ?? '')}</b></div><div><span>Sesiones</span><b>${completion == null ? '—' : pctLabel(completion)}</b></div><div><span>Extra</span><b>${extra ? `+${Math.round(extra)}` : '0'}</b></div></div>`;
}

function allPlanMesocycles() {
  return (state.plan?.macrocycles || []).flatMap(macro => macro.mesocycles || []);
}

function allPlanMicrocycles() {
  return allPlanMesocycles().flatMap(meso => meso.microcycles || []);
}

function findMacrocycle(id) {
  return (state.plan?.macrocycles || []).find(item => String(item.id) === String(id)) || null;
}

function findMesocycle(id) {
  return allPlanMesocycles().find(item => String(item.id) === String(id)) || null;
}

function findMicrocycle(id) {
  return allPlanMicrocycles().find(item => String(item.id) === String(id)) || null;
}

function findPlanGoal(id) {
  return [...(state.plan?.goals || []), ...(state.plan?.unassigned?.goals || [])].find(item => String(item.id) === String(id)) || null;
}

function setPlanTab(name) {
  state.planTab = name;
  
$('librarySportFilter').addEventListener('change', renderLibrary);
$('libraryStimulusFilter').addEventListener('change', renderLibrary);
$('librarySearch').addEventListener('input', renderLibrary);
$('libraryGrid').addEventListener('click', async event => {
  const use = event.target.closest('[data-use-template]');
  if (use) {
    const template = state.templates.find(item => String(item.id) === String(use.dataset.useTemplate));
    if (!template) return;
    openSessionModal(null, state.calendar.selectedWeekStart);
    applyTemplateToOpenSession(template);
    return;
  }
  const del = event.target.closest('[data-delete-template]');
  if (del) {
    if (!window.confirm('¿Eliminar esta plantilla de tu biblioteca?')) return;
    try { await api(`/api/coach/templates/${encodeURIComponent(del.dataset.deleteTemplate)}`, { method: 'DELETE' }); await loadTemplates(); showMessage('Plantilla eliminada.', 'success'); }
    catch (error) { showMessage(error.message, 'error'); }
  }
});
$('newBlankFromLibrary').addEventListener('click', () => openSessionModal(null, state.calendar.selectedWeekStart));
$('openLibraryFromCalendar').addEventListener('click', () => switchView('library'));
$('exportWeekButton').addEventListener('click', exportSelectedWeek);
$('importPlanButton').addEventListener('click', () => { $('planImportFile').value = ''; $('planImportFile').click(); });
$('planImportFile').addEventListener('change', async event => {
  const file = event.target.files && event.target.files[0]; if (!file) return;
  try { const pkg = validatePlanImport(JSON.parse(await file.text())); state.pendingImportPackage = pkg; renderPlanImportPreview(pkg); }
  catch (error) { showMessage(error.message, 'error'); }
});
$('closePlanImportModal').addEventListener('click', () => $('planImportModal').classList.add('hidden'));
$('planImportModal').addEventListener('click', event => { if (event.target === $('planImportModal')) $('planImportModal').classList.add('hidden'); });
$('confirmPlanImport').addEventListener('click', importPendingPlan);
$('downloadActivity').addEventListener('click', async () => {
  if (!state.currentActivityId) return;
  try { await downloadBinaryFile(`/api/coach/athletes/${state.athlete.id}/activities/${encodeURIComponent(state.currentActivityId)}/analysis-package`); }
  catch (error) { showMessage(error.message, 'error'); }
});
$('downloadActivityOriginal').addEventListener('click', async () => {
  if (!state.currentActivityId) return;
  try { await downloadBinaryFile(`/api/coach/athletes/${state.athlete.id}/activities/${encodeURIComponent(state.currentActivityId)}/original-file`); }
  catch (error) { showMessage(error.message, 'error'); }
});

document.querySelectorAll('.plan-tab').forEach(button => button.classList.toggle('active', button.dataset.planView === name));
  document.querySelectorAll('.plan-panel').forEach(panel => panel.classList.toggle('active', panel.id === `plan${name.charAt(0).toUpperCase()}${name.slice(1)}Panel`));
}

async function loadPlan(seasonId = state.selectedSeasonId) {
  if (!state.athlete) return;
  $('planLoading')?.classList.remove('hidden');
  try {
    const seasonsData = await api(`/api/coach/athletes/${state.athlete.id}/seasons`);
    state.seasons = seasonsData.seasons || [];
    const requested = seasonId && state.seasons.some(item => String(item.id) === String(seasonId)) ? seasonId : null;
    const query = requested ? `?season_id=${encodeURIComponent(requested)}` : '';
    state.plan = await api(`/api/coach/athletes/${state.athlete.id}/plan${query}`);
    state.selectedSeasonId = state.plan.season?.id || null;
    if (state.selectedMicrocycleId && !findMicrocycle(state.selectedMicrocycleId)) state.selectedMicrocycleId = null;
    renderPlan();
  } finally {
    $('planLoading')?.classList.add('hidden');
  }
}

function renderPlan() {
  if (!$('planSeasonSelect')) return;
  $('planSeasonSelect').innerHTML = state.seasons.length
    ? state.seasons.map(season => `<option value="${season.id}" ${String(season.id) === String(state.selectedSeasonId) ? 'selected' : ''}>${escapeHtml(season.name)} · ${dateLabel(season.start_date)}–${dateLabel(season.end_date)}</option>`).join('')
    : '<option value="">Sin temporada</option>';

  const season = state.plan?.season || null;
  $('planNoSeason').classList.toggle('hidden', Boolean(season));
  $('planSeasonPanel').classList.toggle('hidden', !season);
  $('planBlocksPanel').classList.toggle('hidden', !season);
  $('planWeekPanel').classList.toggle('hidden', !season);
  $('newPlanGoal').disabled = !season;
  $('newPlanGoalInline').disabled = !season;
  $('newMacrocycle').disabled = !season;
  $('editSeason').disabled = !season;
  if (!season) return;

  const macros = state.plan.macrocycles || [];
  const mesos = macros.flatMap(item => item.mesocycles || []);
  const micros = mesos.flatMap(item => item.microcycles || []);
  const sessions = micros.flatMap(item => item.workouts || []);
  $('planSeasonName').textContent = season.name || 'Temporada';
  $('planSeasonDates').textContent = `${dateLabel(season.start_date)} – ${dateLabel(season.end_date)}`;
  $('planGoalCount').textContent = (state.plan.goals || []).length;
  $('planMacroCount').textContent = macros.length;
  $('planMesoCount').textContent = `${mesos.length} mesociclo${mesos.length === 1 ? '' : 's'}`;
  $('planMicroCount').textContent = micros.length;
  $('planSessionCount').textContent = `${sessions.length} sesiones`;
  $('planSeasonStatusText').textContent = `${planStatusLabel(season.status)} · ${dateLabel(season.start_date)} – ${dateLabel(season.end_date)}`;
  $('planSeasonObjective').textContent = season.season_objective || 'Todavía no se ha definido la dirección principal de esta temporada.';
  if (season.progress) season.progress.actual_load = season.actual?.load;
  $('planSeasonProgress').innerHTML = progressPanel(season.progress, 'Temporada · cumplimiento a fecha de hoy');

  const goals = state.plan.goals || [];
  $('planGoalList').innerHTML = goals.length ? goals.map(goal => `
    <article class="plan-goal priority-${String(goal.priority_code || 'B').toLowerCase()}">
      <div class="plan-goal-main"><span class="priority-pill ${String(goal.priority_code || 'B').toLowerCase()}">${escapeHtml(goal.priority_code || 'B')}</span><div><h3>${escapeHtml(goal.name)}</h3><p>${dateLabel(goal.goal_date)}${goal.sport ? ` · ${escapeHtml(goal.sport)}` : ''}${goal.event_type ? ` · ${escapeHtml(goal.event_type)}` : ''}</p></div></div>
      <div class="plan-goal-target">${escapeHtml(goal.performance_target || (goal.target_time_sec ? `Tiempo objetivo ${Math.round(goal.target_time_sec / 60)} min` : 'Sin marca objetivo'))}</div>
      <button class="btn soft small" data-plan-action="edit-goal" data-id="${goal.id}" type="button">Editar</button>
    </article>`).join('') : '<div class="empty-state compact-empty">Todavía no hay objetivos asignados a esta temporada.</div>';

  const unassigned = state.plan.unassigned?.goals || [];
  $('unassignedGoalBox').classList.toggle('hidden', !unassigned.length);
  if (unassigned.length) $('unassignedGoalBox').innerHTML = `<strong>${unassigned.length} objetivo${unassigned.length === 1 ? '' : 's'} sin temporada</strong><p class="muted small" style="margin:5px 0 0">Edítalos para asignarlos a la temporada seleccionada.</p>`;

  renderPlanBlocks();
  renderSelectedPlanWeek();
  setPlanTab(state.planTab || 'season');
}

function evaluationBadge(evaluation) {
  if (!evaluation) return '<span class="badge pending">Sin evaluar</span>';
  const decision = evaluation.adjustment_decision && evaluation.adjustment_decision !== 'none' ? ` · ${evaluation.adjustment_decision}` : '';
  return `<span class="badge">${evaluation.evaluation_type === 'final' ? 'Evaluación final' : 'Evaluación'}${escapeHtml(decision)}</span>`;
}

function workoutPlanChip(workout) {
  return `<div class="plan-workout-row"><span class="priority-pill ${String(workout.priority || 'B').toLowerCase()}">${escapeHtml(workout.priority || 'B')}</span><div><strong>${escapeHtml(workout.title || 'Sesión')}</strong><small>${dateLabel(workout.workout_date)} · ${escapeHtml(workout.sport || 'Run')} · carga ${Number(workout.planned_load || 0)}</small>${workout.session_objective ? `<p>${escapeHtml(workout.session_objective)}</p>` : ''}</div></div>`;
}

function renderPlanBlocks() {
  const macros = state.plan?.macrocycles || [];
  $('macrocycleList').innerHTML = macros.length ? macros.map(macro => {
    const goal = (state.plan.goals || []).find(item => String(item.id) === String(macro.goal_id));
    return `<article class="macro-card">
      <div class="macro-head"><div><div class="plan-title-line"><span class="cycle-kicker">MACRO</span><h3>${escapeHtml(macro.name)}</h3><span class="badge ${macro.status === 'active' ? '' : 'pending'}">${planStatusLabel(macro.status)}</span></div><p>${dateLabel(macro.start_date)} – ${dateLabel(macro.end_date)}${goal ? ` · objetivo ${escapeHtml(goal.name)}` : ''}</p><strong class="cycle-objective">${escapeHtml(macro.primary_objective || 'Sin objetivo principal definido')}</strong></div><div class="actions"><button class="btn soft small" data-plan-action="evaluate" data-cycle="macrocycle" data-id="${macro.id}" type="button">Evaluar</button><button class="btn soft small" data-plan-action="edit-macro" data-id="${macro.id}" type="button">Editar</button><button class="btn primary small" data-plan-action="new-meso" data-id="${macro.id}" type="button">+ Mesociclo</button></div></div>
      <div class="cycle-progress-panel compact">${(() => { if (macro.progress) macro.progress.actual_load = macro.actual?.load; return progressPanel(macro.progress, 'Macrociclo · a fecha de hoy'); })()}</div>
      <div class="cycle-eval">${evaluationBadge(macro.evaluation)}</div>
      <div class="meso-list">${(macro.mesocycles || []).length ? macro.mesocycles.map(meso => `
        <article class="meso-card">
          <div class="meso-head"><div><div class="plan-title-line"><span class="cycle-kicker meso">MESO</span><h3>${escapeHtml(meso.name)}</h3><span class="badge ${meso.status === 'active' ? '' : 'pending'}">${planStatusLabel(meso.status)}</span></div><p>${dateLabel(meso.start_date)} – ${dateLabel(meso.end_date)} · ${escapeHtml(meso.primary_adaptation || '')}</p></div><div class="actions"><button class="btn soft small" data-plan-action="evaluate" data-cycle="mesocycle" data-id="${meso.id}" type="button">Evaluar</button><button class="btn soft small" data-plan-action="edit-meso" data-id="${meso.id}" type="button">Editar</button><button class="btn secondary small" data-plan-action="new-micro" data-id="${meso.id}" type="button">+ Semana</button></div></div>
          <div class="cycle-progress-panel compact">${(() => { if (meso.progress) meso.progress.actual_load = meso.actual?.load; return progressPanel(meso.progress, 'Mesociclo · a fecha de hoy'); })()}</div>
          <div class="plan-compare-grid compact">${planCompareItem('Horas', meso.planned?.hours, meso.actual?.hours, ' h')}${planCompareItem('Carga', meso.planned?.load, meso.actual?.load)}${planCompareItem('Distancia', meso.planned?.distance_km, meso.actual?.distance_km, ' km')}${planCompareItem('Desnivel', meso.planned?.elevation_m, meso.actual?.elevation_m, ' m')}</div>
          <div class="cycle-eval">${evaluationBadge(meso.evaluation)}</div>
          <div class="micro-list">${(meso.microcycles || []).length ? meso.microcycles.map(micro => `
            <article class="micro-card ${String(state.selectedMicrocycleId) === String(micro.id) ? 'selected' : ''}">
              <div class="micro-main"><div class="plan-title-line"><span class="cycle-kicker micro">SEM</span><strong>${escapeHtml(micro.name || 'Semana')}</strong><span class="badge pending">${escapeHtml(micro.type || micro.week_type || 'microciclo')}</span></div><small>${dateLabel(micro.start_date)} – ${dateLabel(micro.end_date)} · carga ${Number(micro.planned?.load || 0)} plan / ${Number(micro.actual?.load || 0)} real · ${micro.progress?.adherence?.load_pct == null ? '—' : Math.round(Number(micro.progress.adherence.load_pct)) + '%'} vs plan a fecha · ${Number(micro.actual?.completion_rate || 0)}% sesiones</small><div class="micro-tolerance">${toleranceBadgeHtml(micro.planned?.load || 0, 'Plan')}${Number(micro.actual?.load || 0) > 0 ? toleranceBadgeHtml(micro.actual?.load || 0, 'Real') : ''}</div><p>${escapeHtml(micro.primary_objective || '')}</p></div>
              <div class="micro-priority-summary">${(micro.workouts || []).filter(w => w.priority === 'A').length} A · ${(micro.workouts || []).filter(w => w.priority === 'B' || !w.priority).length} B · ${(micro.workouts || []).filter(w => w.priority === 'C').length} C</div>
              <div class="actions"><button class="btn soft small" data-plan-action="select-micro" data-id="${micro.id}" type="button">Ver</button><button class="btn soft small" data-plan-action="evaluate" data-cycle="microcycle" data-id="${micro.id}" type="button">Evaluar</button><button class="btn soft small" data-plan-action="edit-micro" data-id="${micro.id}" type="button">Editar</button></div>
            </article>`).join('') : '<div class="empty-state compact-empty">Este mesociclo todavía no tiene semanas.</div>'}</div>
        </article>`).join('') : '<div class="empty-state compact-empty">Este macrociclo todavía no tiene mesociclos.</div>'}</div>
    </article>`;
  }).join('') : '<div class="empty-state">Todavía no hay macrociclos en esta temporada.</div>';
}

function renderSelectedPlanWeek() {
  const micro = findMicrocycle(state.selectedMicrocycleId);
  $('planWeekEmpty').classList.toggle('hidden', Boolean(micro));
  $('planWeekDetail').classList.toggle('hidden', !micro);
  if (!micro) return;
  $('planWeekTitle').textContent = micro.name || 'Semana';
  $('planWeekDates').textContent = `${dateLabel(micro.start_date)} – ${dateLabel(micro.end_date)} · ${planStatusLabel(micro.lifecycle_status)} · ${planStatusLabel(micro.publication_status)}`;
  $('planWeekObjective').textContent = micro.primary_objective || 'Sin objetivo principal definido.';
  if (micro.progress) micro.progress.actual_load = micro.actual?.load;
  $('planWeekProgress').innerHTML = progressPanel(micro.progress, 'Semana · cumplimiento a fecha de hoy');
  if ($('planWeekTolerance')) $('planWeekTolerance').innerHTML = selectedWeekToleranceHtml({ target_load: micro.planned?.load, execution: { planned_load: micro.planned?.load, load: micro.actual?.load } });
  $('planWeekCompare').innerHTML = `${planCompareItem('Horas', micro.planned?.hours, micro.actual?.hours, ' h')}${planCompareItem('Carga', micro.planned?.load, micro.actual?.load)}${planCompareItem('Distancia', micro.planned?.distance_km, micro.actual?.distance_km, ' km')}${planCompareItem('Desnivel', micro.planned?.elevation_m, micro.actual?.elevation_m, ' m')}${planCompareItem('Fuerza', micro.planned?.strength_sessions, micro.actual?.strength_sessions)}`;
  $('planWeekSessions').innerHTML = (micro.workouts || []).length ? micro.workouts.map(workoutPlanChip).join('') : '<div class="empty-state compact-empty">No hay sesiones dentro de esta semana.</div>';
}

function textList(value) {
  return Array.isArray(value) ? value.join(', ') : '';
}

function fieldValue(id) {
  const el = $(id);
  return el ? el.value : '';
}

function numberField(id) {
  const value = fieldValue(id);
  return value === '' ? null : Number(value);
}

function openPlanForm(type, id = null, parentId = null) {
  if (!state.athlete) return;
  const season = state.plan?.season;
  let item = null;
  if (type === 'season') item = id ? state.seasons.find(row => String(row.id) === String(id)) : null;
  if (type === 'goal') item = id ? findPlanGoal(id) : null;
  if (type === 'macrocycle') item = id ? findMacrocycle(id) : null;
  if (type === 'mesocycle') item = id ? findMesocycle(id) : null;
  if (type === 'microcycle') item = id ? findMicrocycle(id) : null;
  state.planEditor = { type, id, parentId, item };
  $('planFormStatus').textContent = '';
  $('planModalEyebrow').textContent = ({ season: 'Temporada', goal: 'Objetivo', macrocycle: 'Macrociclo', mesocycle: 'Mesociclo', microcycle: 'Microciclo' })[type];
  $('planModalTitle').textContent = `${id ? 'Editar' : 'Crear'} ${({ season: 'temporada', goal: 'objetivo', macrocycle: 'macrociclo', mesocycle: 'mesociclo', microcycle: 'semana' })[type]}`;

  if (type === 'season') $('planFormFields').innerHTML = `
    <div class="field-row"><label>Nombre<input id="pfName" value="${escapeHtml(item?.name || '')}" placeholder="Temporada 2026/27"></label><label>Estado<select id="pfStatus"><option value="planned">Planificada</option><option value="active">Activa</option><option value="completed">Completada</option></select></label></div>
    <div class="field-row"><label>Inicio<input id="pfStart" type="date" value="${item?.start_date || ''}"></label><label>Fin<input id="pfEnd" type="date" value="${item?.end_date || ''}"></label></div>
    <label>Objetivo global<textarea id="pfObjective">${escapeHtml(item?.season_objective || '')}</textarea></label><label>Notas<textarea id="pfNotes">${escapeHtml(item?.notes || '')}</textarea></label>`;

  if (type === 'goal') $('planFormFields').innerHTML = `
    <div class="field-row"><label>Nombre<input id="pfName" value="${escapeHtml(item?.name || '')}"></label><label>Prioridad<select id="pfPriority"><option value="A">A · Principal</option><option value="B">B · Secundario</option><option value="C">C · Apoyo</option></select></label></div>
    <div class="field-row-3"><label>Fecha<input id="pfDate" type="date" value="${item?.goal_date || ''}"></label><label>Deporte<input id="pfSport" value="${escapeHtml(item?.sport || '')}" placeholder="Run / Trail / Ride"></label><label>Tipo de evento<input id="pfEventType" value="${escapeHtml(item?.event_type || '')}" placeholder="10K, trail, test…"></label></div>
    <div class="field-row-3"><label>Distancia km<input id="pfDistance" type="number" step="0.1" value="${item?.distance_km ?? ''}"></label><label>Desnivel m+<input id="pfElevation" type="number" value="${item?.elevation_m ?? ''}"></label><label>Tipo de objetivo<select id="pfGoalType"><option value="competition">Competición</option><option value="performance">Rendimiento</option><option value="volume">Volumen</option><option value="recovery">Recuperación</option><option value="physiological_development">Desarrollo fisiológico</option><option value="other">Otro</option></select></label></div>
    <label>Objetivo de rendimiento<input id="pfPerformance" value="${escapeHtml(item?.performance_target || '')}"></label><label>Notas<textarea id="pfNotes">${escapeHtml(item?.notes || '')}</textarea></label>`;

  if (type === 'macrocycle') {
    const goalOptions = (state.plan?.goals || []).map(goal => `<option value="${goal.id}">${escapeHtml(goal.priority_code || 'B')} · ${escapeHtml(goal.name)}</option>`).join('');
    $('planFormFields').innerHTML = `
      <div class="field-row"><label>Nombre<input id="pfName" value="${escapeHtml(item?.name || '')}" placeholder="Preparación específica"></label><label>Estado<select id="pfStatus"><option value="planned">Planificado</option><option value="active">Activo</option><option value="completed">Completado</option></select></label></div>
      <div class="field-row"><label>Inicio<input id="pfStart" type="date" value="${item?.start_date || season?.start_date || ''}"></label><label>Fin<input id="pfEnd" type="date" value="${item?.end_date || season?.end_date || ''}"></label></div>
      <label>Objetivo principal asociado<select id="pfGoal"><option value="">Sin objetivo específico</option>${goalOptions}</select></label>
      <label>Objetivo del macrociclo<textarea id="pfObjective">${escapeHtml(item?.primary_objective || '')}</textarea></label>
      <label>Restricciones<textarea id="pfConstraints">${escapeHtml(item?.constraints || '')}</textarea></label><label>Notas<textarea id="pfNotes">${escapeHtml(item?.notes || '')}</textarea></label>`;
  }

  if (type === 'mesocycle') $('planFormFields').innerHTML = `
    <div class="field-row"><label>Nombre<input id="pfName" value="${escapeHtml(item?.name || '')}" placeholder="Base II"></label><label>Estado<select id="pfStatus"><option value="planned">Planificado</option><option value="active">Activo</option><option value="completed">Completado</option></select></label></div>
    <div class="field-row"><label>Inicio<input id="pfStart" type="date" value="${item?.start_date || ''}"></label><label>Fin<input id="pfEnd" type="date" value="${item?.end_date || ''}"></label></div>
    <label>Adaptación principal<input id="pfAdaptation" value="${escapeHtml(item?.primary_adaptation || '')}" placeholder="Base aeróbica / LT2 / potencia…"></label>
    <label>Adaptaciones secundarias<input id="pfSecondary" value="${escapeHtml(textList(item?.secondary_adaptations))}" placeholder="Fuerza resistencia, técnica trail"></label>
    <div class="field-row-3"><label>Horas plan<input id="pfHours" type="number" step="0.1" value="${item?.planned?.hours ?? item?.planned_hours ?? ''}"></label><label>Distancia km<input id="pfDistance" type="number" step="0.1" value="${item?.planned?.distance_km ?? item?.planned_distance_km ?? ''}"></label><label>Desnivel m+<input id="pfElevation" type="number" value="${item?.planned?.elevation_m ?? item?.planned_elevation_m ?? ''}"></label></div>
    <div class="field-row"><label>Carga plan<input id="pfLoad" type="number" value="${item?.planned?.load ?? item?.planned_load ?? ''}"></label><label>Sesiones fuerza<input id="pfStrength" type="number" value="${item?.planned?.strength_sessions ?? item?.planned_strength_sessions ?? ''}"></label></div>
    <label>Criterio de éxito<textarea id="pfSuccess">${escapeHtml(item?.success_criteria || '')}</textarea></label><label>Patrón de progresión<input id="pfProgression" value="${escapeHtml(textList(item?.progression_pattern))}" placeholder="load, load, overload, deload"></label><label>Notas<textarea id="pfNotes">${escapeHtml(item?.notes || '')}</textarea></label>`;

  if (type === 'microcycle') $('planFormFields').innerHTML = `
    <div class="field-row"><label>Nombre<input id="pfName" value="${escapeHtml(item?.name || '')}" placeholder="Carga 1"></label><label>Tipo<select id="pfType"><option value="adaptation">Adaptación</option><option value="load">Carga</option><option value="development">Desarrollo</option><option value="overload">Sobrecarga</option><option value="deload">Descarga</option><option value="taper">Afinamiento</option><option value="recovery">Recuperación</option><option value="competition">Competición</option></select></label></div>
    <div class="field-row"><label>Inicio<input id="pfStart" type="date" value="${item?.start_date || ''}"></label><label>Fin<input id="pfEnd" type="date" value="${item?.end_date || ''}"></label></div>
    <label>Objetivo principal<textarea id="pfObjective">${escapeHtml(item?.primary_objective || '')}</textarea></label>
    <div class="field-row-3"><label>Horas plan<input id="pfHours" type="number" step="0.1" value="${item?.planned?.hours ?? ''}"></label><label>Distancia km<input id="pfDistance" type="number" step="0.1" value="${item?.planned?.distance_km ?? ''}"></label><label>Desnivel m+<input id="pfElevation" type="number" value="${item?.planned?.elevation_m ?? ''}"></label></div>
    <div class="field-row"><label>Carga plan<input id="pfLoad" type="number" value="${item?.planned?.load ?? ''}"></label><label>Sesiones fuerza<input id="pfStrength" type="number" value="${item?.planned?.strength_sessions ?? ''}"></label></div>
    <div class="field-row"><label>Estado deportivo<select id="pfLifecycle"><option value="planned">Planificado</option><option value="active">Activo</option><option value="completed">Completado</option></select></label><label>Publicación<select id="pfPublication"><option value="draft">Borrador</option><option value="published">Publicado</option></select></label></div>
    <label>Objetivo de recuperación<textarea id="pfRecovery">${escapeHtml(item?.recovery_target || '')}</textarea></label><label>Notas<textarea id="pfNotes">${escapeHtml(item?.notes || '')}</textarea></label>`;

  if ($('pfStatus')) $('pfStatus').value = item?.status || (type === 'season' ? 'planned' : 'planned');
  if ($('pfPriority')) $('pfPriority').value = item?.priority_code || 'B';
  if ($('pfGoalType')) $('pfGoalType').value = item?.goal_type || 'competition';
  if ($('pfGoal')) $('pfGoal').value = item?.goal_id || '';
  if ($('pfType')) $('pfType').value = item?.type || 'load';
  if ($('pfLifecycle')) $('pfLifecycle').value = item?.lifecycle_status || 'planned';
  if ($('pfPublication')) $('pfPublication').value = item?.publication_status || 'draft';
  $('planModal').classList.remove('hidden');
}

async function savePlanEntity() {
  const editor = state.planEditor;
  if (!editor) return;
  const { type, id, parentId } = editor;
  let payload = {};
  let url = '';
  let method = id ? 'PUT' : 'POST';
  const athleteBase = `/api/coach/athletes/${state.athlete.id}`;

  if (type === 'season') {
    payload = { name: fieldValue('pfName'), start_date: fieldValue('pfStart'), end_date: fieldValue('pfEnd'), status: fieldValue('pfStatus'), season_objective: fieldValue('pfObjective'), notes: fieldValue('pfNotes') };
    url = id ? `${athleteBase}/seasons/${id}` : `${athleteBase}/seasons`;
  }
  if (type === 'goal') {
    payload = { name: fieldValue('pfName'), goal_date: fieldValue('pfDate'), priority_code: fieldValue('pfPriority'), season_id: state.plan?.season?.id || null, sport: fieldValue('pfSport'), event_type: fieldValue('pfEventType'), goal_type: fieldValue('pfGoalType'), distance_km: numberField('pfDistance'), elevation_m: numberField('pfElevation'), performance_target: fieldValue('pfPerformance'), notes: fieldValue('pfNotes') };
    url = id ? `${athleteBase}/goals/${id}` : `${athleteBase}/goals`;
  }
  if (type === 'macrocycle') {
    payload = { name: fieldValue('pfName'), start_date: fieldValue('pfStart'), end_date: fieldValue('pfEnd'), status: fieldValue('pfStatus'), goal_id: fieldValue('pfGoal') || null, primary_objective: fieldValue('pfObjective'), constraints: fieldValue('pfConstraints'), notes: fieldValue('pfNotes') };
    url = id ? `${athleteBase}/macrocycles/${id}` : `${athleteBase}/seasons/${state.plan.season.id}/macrocycles`;
  }
  if (type === 'mesocycle') {
    payload = { name: fieldValue('pfName'), start_date: fieldValue('pfStart'), end_date: fieldValue('pfEnd'), status: fieldValue('pfStatus'), primary_adaptation: fieldValue('pfAdaptation'), secondary_adaptations: fieldValue('pfSecondary').split(',').map(v => v.trim()).filter(Boolean), planned_hours: numberField('pfHours'), planned_distance_km: numberField('pfDistance'), planned_elevation_m: numberField('pfElevation'), planned_load: numberField('pfLoad'), planned_strength_sessions: numberField('pfStrength'), success_criteria: fieldValue('pfSuccess'), progression_pattern: fieldValue('pfProgression').split(',').map(v => v.trim()).filter(Boolean), notes: fieldValue('pfNotes') };
    url = id ? `${athleteBase}/mesocycles/${id}` : `${athleteBase}/macrocycles/${parentId}/mesocycles`;
  }
  if (type === 'microcycle') {
    payload = { name: fieldValue('pfName'), start_date: fieldValue('pfStart'), end_date: fieldValue('pfEnd'), type: fieldValue('pfType'), primary_objective: fieldValue('pfObjective'), planned: { hours: numberField('pfHours') || 0, distance_km: numberField('pfDistance') || 0, elevation_m: numberField('pfElevation') || 0, load: numberField('pfLoad') || 0, strength_sessions: numberField('pfStrength') || 0 }, lifecycle_status: fieldValue('pfLifecycle'), publication_status: fieldValue('pfPublication'), recovery_target: fieldValue('pfRecovery'), notes: fieldValue('pfNotes') };
    url = id ? `${athleteBase}/microcycles/${id}` : `${athleteBase}/mesocycles/${parentId}/microcycles`;
  }

  try {
    $('savePlanEntity').disabled = true;
    $('planFormStatus').textContent = 'Guardando…';
    await api(url, { method, body: JSON.stringify(payload) });
    $('planModal').classList.add('hidden');
    state.planEditor = null;
    await loadPlan(type === 'season' && !id ? null : state.selectedSeasonId);
    showMessage('Planificación actualizada.', 'success');
  } catch (error) {
    $('planFormStatus').textContent = error.message;
  } finally {
    $('savePlanEntity').disabled = false;
  }
}

function cycleInfo(type, id) {
  if (type === 'macrocycle') return findMacrocycle(id);
  if (type === 'mesocycle') return findMesocycle(id);
  if (type === 'microcycle') return findMicrocycle(id);
  return null;
}

function openEvaluation(type, id) {
  const cycle = cycleInfo(type, id);
  if (!cycle) return;
  const evaluation = cycle.evaluation || null;
  state.evaluationEditor = { type, id, evaluation };
  $('evaluationTitle').textContent = `${evaluation ? 'Editar evaluación' : 'Evaluar'} · ${cycle.name || cycle.title || 'ciclo'}`;
  $('evaluationType').value = evaluation?.evaluation_type || 'final';
  $('evaluationStatus').value = evaluation?.evaluation_status || 'draft';
  $('evaluationCompletion').value = evaluation?.completion_rate ?? cycle.actual?.completion_rate ?? '';
  $('evaluationFatigue').value = evaluation?.fatigue ?? '';
  $('evaluationFeeling').value = evaluation?.subjective_feeling ?? '';
  $('evaluationFitnessChange').value = evaluation?.fitness_change ?? '';
  $('evaluationGoal').value = evaluation?.goal_achieved || '';
  $('evaluationInjury').value = evaluation?.injury_status || '';
  $('evaluationNotes').value = evaluation?.coach_notes || '';
  $('evaluationDecision').value = evaluation?.adjustment_decision || 'none';
  $('evaluationAdjustment').value = evaluation?.adjustment_notes || '';
  $('evaluationStatusText').textContent = '';
  $('evaluationModal').classList.remove('hidden');
}

async function saveEvaluation() {
  const editor = state.evaluationEditor;
  if (!editor) return;
  const idField = `${editor.type}_id`;
  const payload = {
    macrocycle_id: null, mesocycle_id: null, microcycle_id: null,
    [idField]: editor.id,
    evaluation_type: fieldValue('evaluationType'),
    evaluation_status: fieldValue('evaluationStatus'),
    completion_rate: numberField('evaluationCompletion'),
    fatigue: numberField('evaluationFatigue'),
    fitness_change: numberField('evaluationFitnessChange'),
    subjective_feeling: numberField('evaluationFeeling'),
    injury_status: fieldValue('evaluationInjury'),
    goal_achieved: fieldValue('evaluationGoal') || null,
    coach_notes: fieldValue('evaluationNotes'),
    adjustment_decision: fieldValue('evaluationDecision'),
    adjustment_notes: fieldValue('evaluationAdjustment'),
  };
  const base = `/api/coach/athletes/${state.athlete.id}/evaluations`;
  try {
    $('saveEvaluation').disabled = true;
    $('evaluationStatusText').textContent = 'Guardando…';
    await api(editor.evaluation?.id ? `${base}/${editor.evaluation.id}` : base, { method: editor.evaluation?.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    $('evaluationModal').classList.add('hidden');
    state.evaluationEditor = null;
    await loadPlan(state.selectedSeasonId);
    showMessage('Evaluación guardada. El plan no se modifica automáticamente.', 'success');
  } catch (error) {
    $('evaluationStatusText').textContent = error.message;
  } finally {
    $('saveEvaluation').disabled = false;
  }
}

function handlePlanAction(button) {
  const action = button.dataset.planAction;
  const id = button.dataset.id;
  if (action === 'edit-goal') openPlanForm('goal', id);
  if (action === 'edit-macro') openPlanForm('macrocycle', id);
  if (action === 'edit-meso') openPlanForm('mesocycle', id);
  if (action === 'edit-micro') openPlanForm('microcycle', id);
  if (action === 'new-meso') openPlanForm('mesocycle', null, id);
  if (action === 'new-micro') openPlanForm('microcycle', null, id);
  if (action === 'evaluate') openEvaluation(button.dataset.cycle, id);
  if (action === 'select-micro') {
    state.selectedMicrocycleId = id;
    renderPlanBlocks();
    renderSelectedPlanWeek();
    setPlanTab('week');
  }
}


function renderDataConnectionState() {
  if (!state.athlete) return;
  const connected = state.athlete.intervals_status === 'connected';
  if ($('syncActivities')) $('syncActivities').disabled = !connected;
  if ($('syncRecovery')) $('syncRecovery').disabled = !connected;
  if ($('activitiesStatus') && !connected) $('activitiesStatus').textContent = 'Intervals pendiente: puedes mantener el historial guardado, pero no actualizarlo todavía.';
  if ($('recoveryStatus') && !connected) $('recoveryStatus').textContent = 'Intervals pendiente: no se pueden recibir sueño, HRV ni pulso en reposo.';
}

function resetActivityViews() {
  state.activities = [];
  state.recovery = [];
  state.currentActivityId = null;
  state.currentActivity = null;
  if ($('activityList')) $('activityList').innerHTML = '<div class="empty-state">Cargando historial guardado…</div>';
  if ($('activityDetail')) $('activityDetail').classList.add('hidden');
  if ($('activityPlaceholder')) $('activityPlaceholder').classList.remove('hidden');
  if ($('recoveryRows')) $('recoveryRows').innerHTML = '<tr><td colspan="8" class="muted">Cargando datos guardados…</td></tr>';
}

function fullDateLabel(value) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function durationLabel(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '—';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.round(value % 60);
  return hours ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function paceLabel(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const rounded = Math.round(value);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function kmLabel(metres) {
  const value = Number(metres);
  return Number.isFinite(value) ? `${(value / 1000).toFixed(2)} km` : '—';
}

function activityCard(item) {
  const id = escapeHtml(item.intervals_activity_id || '');
  return `<button class="activity-item ${state.currentActivityId === item.intervals_activity_id ? 'active' : ''}" data-activity-id="${id}" type="button"><div><strong>${escapeHtml(item.name || item.sport || 'Actividad')}</strong><small>${fullDateLabel(item.activity_date)} · ${kmLabel(item.distance_m)} · ${durationLabel(item.duration_sec)}</small></div><span class="activity-load">${Number.isFinite(Number(item.load)) ? Math.round(Number(item.load)) : '—'}</span></button>`;
}

function renderActivityList() {
  $('activityCount').textContent = `${state.activities.length} actividades`;
  $('activityCount').className = `badge ${state.activities.length ? '' : 'pending'}`;
  $('activityList').innerHTML = state.activities.length ? state.activities.map(activityCard).join('') : '<div class="empty-state">No hay actividades guardadas en este periodo.</div>';
  $('activityList').querySelectorAll('[data-activity-id]').forEach(button => button.addEventListener('click', () => loadActivityDetail(button.dataset.activityId)));
}

async function loadActivities(sync = false) {
  if (!state.athlete) return;
  const oldest = $('activityOldest').value;
  const newest = $('activityNewest').value;
  $('activitiesStatus').textContent = sync ? 'Sincronizando con Intervals.icu…' : 'Cargando historial guardado…';
  try {
    const data = await api(`/api/coach/athletes/${state.athlete.id}/activities?oldest=${oldest}&newest=${newest}&sync=${sync ? '1' : '0'}`);
    state.activities = data.activities || [];
    renderActivityList();
    $('activitiesStatus').textContent = sync ? `Actualización completada: ${state.activities.length} actividades.` : `${state.activities.length} actividades disponibles.`;
  } catch (error) {
    $('activitiesStatus').textContent = error.message;
    if (!state.activities.length) renderActivityList();
  }
}

function intervalRows(intervals) {
  if (!intervals || !intervals.length) return '<tr><td colspan="7" class="muted">Intervals.icu no ha devuelto intervalos detallados para esta actividad.</td></tr>';
  return intervals.map(item => `<tr><td>${item.index}</td><td>${escapeHtml(item.type)}</td><td>${durationLabel(item.duration_seconds)}</td><td>${item.distance_m ? `${Math.round(item.distance_m)} m` : '—'}</td><td>${escapeHtml(item.pace || '—')}</td><td>${item.average_hr ?? '—'}</td><td>${item.max_hr ?? '—'}</td></tr>`).join('');
}

function analysisStatusLabel(status) {
  return ({ muy_bien_asimilada: 'Muy bien asimilada', bien_asimilada: 'Bien asimilada', cumplida_con_fatiga: 'Cumplida con fatiga', incompleta: 'Incompleta', revisar: 'Revisar', riesgo_por_dolor: 'Revisar dolor' })[status] || 'Análisis disponible';
}

function recommendationLabel(action) {
  return ({ mantener: 'Mantener', reducir: 'Reducir', progresar: 'Progresar', recuperar: 'Recuperar', revisar_dolor: 'Revisar dolor', repetir_prueba: 'Repetir prueba' })[action] || 'Revisar';
}

function renderAnalysis(analysis) {
  if (!analysis) {
    $('analysisSummary').className = 'analysis-empty';
    $('analysisSummary').innerHTML = state.config.openaiConfigured ? 'Pulsa «Analizar con IA» para cruzar la sesión con la planificación y la recuperación.' : 'OpenAI no está configurado. Al pulsar analizar, RunFlow generará un preanálisis mediante reglas objetivas.';
    $('analysisState').value = 'Pendiente';
    return;
  }
  const alerts = Array.isArray(analysis.alerts) ? analysis.alerts : [];
  const recommendation = analysis.recommendation || {};
  const meta = analysis.meta || {};
  $('analysisState').value = `${analysisStatusLabel(analysis.status)} · ${meta.source === 'openai' ? 'IA' : 'Reglas'}`;
  $('analysisSummary').className = 'analysis-result';
  $('analysisSummary').innerHTML = `<div class="analysis-score-row"><div class="analysis-score"><strong>${Number(analysis.score ?? 0)}</strong></div><div><span class="badge">${escapeHtml(analysisStatusLabel(analysis.status))}</span><h3 style="margin:9px 0 5px">${escapeHtml(analysis.headline || '')}</h3><p class="muted" style="margin:0">${escapeHtml(analysis.summary || '')}</p></div></div><div class="analysis-grid"><div class="analysis-section"><h4>Ejecución</h4><p>${escapeHtml(analysis.execution_analysis || '')}</p></div><div class="analysis-section"><h4>Respuesta fisiológica</h4><p>${escapeHtml(analysis.physiological_analysis || '')}</p></div><div class="analysis-section"><h4>Contexto y recuperación</h4><p>${escapeHtml(analysis.context_analysis || '')}</p></div></div>${alerts.map(alert => `<div class="analysis-alert ${escapeHtml(alert.level || 'info')}"><strong>${escapeHtml(alert.title || 'Aviso')}</strong><div>${escapeHtml(alert.detail || '')}</div></div>`).join('')}<div class="analysis-section"><h4>Recomendación: ${escapeHtml(recommendationLabel(recommendation.action))}</h4><p><strong>Próximas 24–48 h:</strong> ${escapeHtml(recommendation.next_24_48h || '')}</p><p style="margin-top:7px"><strong>Próxima calidad:</strong> ${escapeHtml(recommendation.next_quality_session || '')}</p></div><p class="muted small">Confianza: ${escapeHtml(analysis.confidence || '—')} · Motor: ${escapeHtml(meta.model || (meta.source === 'openai' ? state.config.openaiModel : 'RunFlow Rules'))}${meta.openai_error ? ` · OpenAI no respondió y se usaron reglas: ${escapeHtml(meta.openai_error)}` : ''}</p>`;
}

async function loadActivityWorkoutOptions(detail) {
  const activity = detail?.activity;
  if (!activity || !$('activityWorkoutLink')) return;
  const date = String(activity.activity_date || '').slice(0, 10);
  const weekStart = isoMonday(parseLocalDate(date));
  try {
    const data = await api(`/api/coach/athletes/${state.athlete.id}/calendar?oldest=${weekStart}&newest=${addDays(weekStart, 6)}`);
    const week = (data.weeks || []).find(item => item.week_start === weekStart);
    const workouts = week?.workouts || [];
    let selectedId = activity.workout_id || detail.planned?.id || '';
    if (!selectedId) {
      const linked = workouts.find(workout => (workout.activities || []).some(item => item.intervals_activity_id === activity.intervals_activity_id));
      if (linked) selectedId = linked.id;
    }
    $('activityWorkoutLink').innerHTML = `<option value="">Actividad no planificada</option>${workouts.map(workout => `<option value="${workout.id}" ${String(workout.id) === String(selectedId) ? 'selected' : ''}>${dateLabel(workout.workout_date)} · ${escapeHtml(workout.title)} · ${escapeHtml(workout.sport || '')}</option>`).join('')}`;
    $('activityWorkoutLinkStatus').textContent = selectedId ? 'Actividad vinculada a una sesión del plan.' : 'Sin vínculo: esta carga contará como actividad extra.';
  } catch (error) {
    $('activityWorkoutLinkStatus').textContent = `No se pudieron cargar las sesiones candidatas: ${error.message}`;
  }
}

async function saveActivityWorkoutLink() {
  if (!state.currentActivityId) return showMessage('Selecciona primero una actividad.', 'error');
  const workoutId = $('activityWorkoutLink').value || null;
  try {
    await api(`/api/coach/athletes/${state.athlete.id}/activities/${encodeURIComponent(state.currentActivityId)}/workout`, { method: 'PUT', body: JSON.stringify({ workout_id: workoutId }) });
    showMessage(workoutId ? 'Actividad vinculada a la sesión planificada.' : 'Actividad marcada como no planificada.', 'success');
    await Promise.all([loadActivityDetail(state.currentActivityId), loadCalendarMonth(false), loadPlan()]);
  } catch (error) { showMessage(error.message, 'error'); }
}

function renderActivityDetail(detail) {
  state.currentActivity = detail;
  const activity = detail.activity;
  $('activityPlaceholder').classList.add('hidden');
  $('activityDetail').classList.remove('hidden');
  $('activityDate').textContent = fullDateLabel(activity.activity_date);
  $('activityName').textContent = activity.name || 'Actividad';
  $('activitySport').textContent = `${activity.sport || 'Run'}${detail.planned ? ` · Programada: ${detail.planned.title}` : ' · Sin sesión programada vinculada'}`;
  $('activityLoadBadge').textContent = `Carga ${Number.isFinite(Number(activity.load)) ? Math.round(Number(activity.load)) : '—'}`;
  $('activityDuration').textContent = durationLabel(activity.duration_sec);
  $('activityDistance').textContent = kmLabel(activity.distance_m);
  $('activityPace').textContent = paceLabel(activity.avg_pace_sec_per_km);
  $('activityHr').textContent = activity.avg_hr ? `${Math.round(activity.avg_hr)} / ${Math.round(activity.max_hr || activity.avg_hr)}` : '—';
  $('intervalRows').innerHTML = intervalRows(activity.intervals || []);
  $('coachDecision').value = detail.review?.decision || '';
  $('coachReviewComment').value = detail.review?.coach_comment || '';
  renderAnalysis(detail.review?.ai_analysis || null);
}

async function loadActivityDetail(externalId) {
  if (!state.athlete) return;
  state.currentActivityId = externalId;
  renderActivityList();
  $('activityPlaceholder').textContent = 'Cargando detalle…';
  try {
    const data = await api(`/api/coach/athletes/${state.athlete.id}/activities/${encodeURIComponent(externalId)}`);
    renderActivityDetail(data);
    await loadActivityWorkoutOptions(data);
  } catch (error) {
    $('activityPlaceholder').classList.remove('hidden');
    $('activityDetail').classList.add('hidden');
    $('activityPlaceholder').textContent = error.message;
  }
}

async function analyzeCurrentActivity() {
  if (!state.currentActivityId) return showMessage('Selecciona primero una actividad.', 'error');
  const button = $('analyzeActivity');
  const original = button.textContent;
  try {
    button.disabled = true; button.textContent = 'Analizando…';
    const data = await api(`/api/coach/athletes/${state.athlete.id}/activities/${encodeURIComponent(state.currentActivityId)}/analyze`, { method: 'POST', body: JSON.stringify({ context: $('analysisContext').value }) });
    state.currentActivity.review = data.review;
    renderAnalysis(data.analysis);
    showMessage(data.analysis?.meta?.source === 'openai' ? 'Análisis de IA completado.' : 'Preanálisis por reglas completado.', 'success');
  } catch (error) { showMessage(error.message, 'error'); }
  finally { button.disabled = false; button.textContent = original; }
}

async function saveCurrentReview() {
  if (!state.currentActivityId) return showMessage('Selecciona primero una actividad.', 'error');
  try {
    const data = await api(`/api/coach/athletes/${state.athlete.id}/activities/${encodeURIComponent(state.currentActivityId)}/review`, { method: 'PUT', body: JSON.stringify({ decision: $('coachDecision').value, coach_comment: $('coachReviewComment').value }) });
    state.currentActivity.review = data.review;
    showMessage('Revisión del entrenador guardada.', 'success');
  } catch (error) { showMessage(error.message, 'error'); }
}

function sleepHours(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return seconds / 3600;
}

function avgRows(rows, getter) {
  const values = rows.map(getter).map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function recoveryState(row, baselineRows) {
  if (!row) return { score: null, label: 'Sin datos', explanation: 'No hay registros disponibles.', baseline: {} };
  const baseline = baselineRows.slice(-21);
  const sleepBase = avgRows(baseline, item => sleepHours(item.sleep_sec));
  const rhrBase = avgRows(baseline, item => item.resting_hr);
  const hrvBase = avgRows(baseline, item => item.hrv);
  const score = Number.isFinite(Number(row.readiness_score)) ? Number(row.readiness_score) : 70;
  const label = row.readiness_label || (score >= 80 ? 'Muy buena disposición' : score >= 65 ? 'Buena, con control de carga' : score >= 45 ? 'Conviene revisar' : 'Recuperación comprometida');
  const reasons = [];
  const sleep = sleepHours(row.sleep_sec);
  if (Number.isFinite(sleep) && Number.isFinite(sleepBase) && sleep < sleepBase - .6) reasons.push('sueño por debajo de la media');
  if (Number.isFinite(Number(row.resting_hr)) && Number.isFinite(rhrBase) && Number(row.resting_hr) >= rhrBase + 4) reasons.push('pulso en reposo elevado');
  if (Number.isFinite(Number(row.hrv)) && Number.isFinite(hrvBase) && Number(row.hrv) < hrvBase * .88) reasons.push('HRV reducida');
  return { score, label, explanation: reasons.length ? `Atención a: ${reasons.join(', ')}.` : 'Los indicadores están cerca de la línea base individual.', baseline: { sleepBase, rhrBase, hrvBase } };
}

function drawMiniChart(svgId, rows, getter, formatter = value => String(Math.round(value))) {
  const svg = $(svgId);
  const points = rows.slice(-21).map((row, index) => ({ x: index, value: Number(getter(row)) })).filter(item => Number.isFinite(item.value));
  if (!points.length) { svg.innerHTML = '<text x="180" y="80" text-anchor="middle" class="chart-label">Sin datos</text>'; return; }
  const min = Math.min(...points.map(item => item.value));
  const max = Math.max(...points.map(item => item.value));
  const range = max - min || 1;
  const x = index => 24 + (index / Math.max(1, points.length - 1)) * 312;
  const y = value => 130 - ((value - min) / range) * 92;
  const path = points.map((item, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(item.value).toFixed(1)}`).join(' ');
  svg.innerHTML = `<line x1="24" y1="130" x2="336" y2="130" class="chart-axis"/><path d="${path}" class="chart-line"/>${points.map((item, index) => `<circle cx="${x(index)}" cy="${y(item.value)}" r="3.5" class="chart-dot"><title>${formatter(item.value)}</title></circle>`).join('')}<text x="24" y="151" class="chart-label">${escapeHtml(formatter(points[0].value))}</text><text x="336" y="151" text-anchor="end" class="chart-label">${escapeHtml(formatter(points[points.length - 1].value))}</text>`;
}

function renderRecovery() {
  const rows = state.recovery || [];
  $('recoveryDays').textContent = `${rows.length} días`;
  $('recoveryDays').className = `badge ${rows.length ? '' : 'pending'}`;
  const latest = rows[rows.length - 1];
  const stateInfo = recoveryState(latest, rows.slice(0, -1));
  $('recoveryScore').textContent = stateInfo.score ?? '—';
  $('recoveryLabel').textContent = stateInfo.label;
  $('recoveryExplanation').textContent = stateInfo.explanation;
  $('recoverySleep').textContent = latest && Number.isFinite(sleepHours(latest.sleep_sec)) ? `${sleepHours(latest.sleep_sec).toFixed(1)} h` : '—';
  $('recoverySleepBase').textContent = `Media 21 días: ${Number.isFinite(stateInfo.baseline.sleepBase) ? `${stateInfo.baseline.sleepBase.toFixed(1)} h` : '—'}`;
  $('recoveryRhr').textContent = latest?.resting_hr ?? '—';
  $('recoveryRhrBase').textContent = `Media 21 días: ${Number.isFinite(stateInfo.baseline.rhrBase) ? `${stateInfo.baseline.rhrBase.toFixed(1)} ppm` : '—'}`;
  $('recoveryHrv').textContent = latest?.hrv ?? '—';
  $('recoveryHrvBase').textContent = `Media 21 días: ${Number.isFinite(stateInfo.baseline.hrvBase) ? stateInfo.baseline.hrvBase.toFixed(1) : '—'}`;
  $('recoveryForm').textContent = latest?.form ?? '—';
  drawMiniChart('sleepChart', rows, row => sleepHours(row.sleep_sec), value => `${value.toFixed(1)} h`);
  drawMiniChart('rhrChart', rows, row => row.resting_hr, value => `${Math.round(value)} ppm`);
  drawMiniChart('hrvChart', rows, row => row.hrv, value => `${value.toFixed(1)} ms`);
  $('recoveryRows').innerHTML = rows.length ? rows.slice().reverse().slice(0, 21).map((row, index, reversed) => {
    const originalIndex = rows.length - 1 - index;
    const info = recoveryState(row, rows.slice(0, originalIndex));
    const statusClass = info.score >= 65 ? 'status-good' : info.score >= 45 ? 'status-watch' : 'status-low';
    return `<tr><td>${dateLabel(row.metric_date)}</td><td>${Number.isFinite(sleepHours(row.sleep_sec)) ? `${sleepHours(row.sleep_sec).toFixed(1)} h` : '—'}</td><td>${row.resting_hr ?? '—'}</td><td>${row.hrv ?? '—'}</td><td>${row.fitness ?? '—'}</td><td>${row.fatigue ?? '—'}</td><td>${row.form ?? '—'}</td><td class="${statusClass}">${info.score ?? '—'}/100</td></tr>`;
  }).join('') : '<tr><td colspan="8" class="muted">No hay datos de recuperación en este periodo.</td></tr>';
  if (latest) {
    state.athlete.metrics = { ...(state.athlete.metrics || {}), fitness: latest.fitness, fatigue: latest.fatigue, form: latest.form, readiness_score: stateInfo.score, readiness_label: stateInfo.label };
    renderSummary();
  }
}

async function loadRecovery(sync = false) {
  if (!state.athlete) return;
  const oldest = $('recoveryOldest').value;
  const newest = $('recoveryNewest').value;
  $('recoveryStatus').textContent = sync ? 'Sincronizando con Intervals.icu…' : 'Cargando datos guardados…';
  try {
    const data = await api(`/api/coach/athletes/${state.athlete.id}/recovery?oldest=${oldest}&newest=${newest}&sync=${sync ? '1' : '0'}`);
    state.recovery = data.rows || [];
    renderRecovery();
    $('recoveryStatus').textContent = sync ? `Actualización completada: ${state.recovery.length} días.` : `${state.recovery.length} días disponibles.`;
  } catch (error) {
    $('recoveryStatus').textContent = error.message;
    renderRecovery();
  }
}


document.querySelectorAll('.plan-tab').forEach(button => button.addEventListener('click', () => setPlanTab(button.dataset.planView)));
$('planSeasonSelect').addEventListener('change', () => loadPlan($('planSeasonSelect').value).catch(error => showMessage(error.message, 'error')));
$('newSeason').addEventListener('click', () => openPlanForm('season'));
$('createFirstSeason').addEventListener('click', () => openPlanForm('season'));
$('editSeason').addEventListener('click', () => state.plan?.season && openPlanForm('season', state.plan.season.id));
$('newPlanGoal').addEventListener('click', () => openPlanForm('goal'));
$('newPlanGoalInline').addEventListener('click', () => openPlanForm('goal'));
$('newMacrocycle').addEventListener('click', () => openPlanForm('macrocycle'));
$('macrocycleList').addEventListener('click', event => { const button = event.target.closest('[data-plan-action]'); if (button) handlePlanAction(button); });
$('planGoalList').addEventListener('click', event => { const button = event.target.closest('[data-plan-action]'); if (button) handlePlanAction(button); });
$('closePlanModal').addEventListener('click', () => $('planModal').classList.add('hidden'));
$('planModal').addEventListener('click', event => { if (event.target === $('planModal')) $('planModal').classList.add('hidden'); });
$('savePlanEntity').addEventListener('click', savePlanEntity);
$('closeEvaluationModal').addEventListener('click', () => $('evaluationModal').classList.add('hidden'));
$('evaluationModal').addEventListener('click', event => { if (event.target === $('evaluationModal')) $('evaluationModal').classList.add('hidden'); });
$('saveEvaluation').addEventListener('click', saveEvaluation);
$('openSelectedWeekCalendar').addEventListener('click', async () => {
  const micro = findMicrocycle(state.selectedMicrocycleId);
  if (!micro) return;
  state.calendar.month = new Date(parseLocalDate(micro.start_date).getFullYear(), parseLocalDate(micro.start_date).getMonth(), 1);
  await loadCalendarMonth();
  selectCalendarWeek(micro.start_date);
  switchView('week');
});
$('evaluateSelectedWeek').addEventListener('click', () => state.selectedMicrocycleId && openEvaluation('microcycle', state.selectedMicrocycleId));

$('syncCalendarActuals').addEventListener('click', async () => {
  const button = $('syncCalendarActuals'); const original = button.textContent;
  try { button.disabled = true; button.textContent = 'Actualizando…'; await loadCalendarMonth(true); await loadPlan(); showMessage('Realizados actualizados y comparados con el plan.', 'success'); }
  catch (error) { showMessage(error.message, 'error'); }
  finally { button.disabled = false; button.textContent = original; }
});
$('syncActivities').addEventListener('click', () => loadActivities(true));
$('saveActivityWorkoutLink').addEventListener('click', saveActivityWorkoutLink);
$('syncRecovery').addEventListener('click', () => loadRecovery(true));
$('refreshLoadTolerance').addEventListener('click', async () => {
  const button = $('refreshLoadTolerance'); const original = button.textContent;
  try { button.disabled = true; button.textContent = 'Actualizando…'; await loadLoadTolerance(true); showMessage('Referencia de carga actualizada.', 'success'); }
  catch (error) { showMessage(error.message, 'error'); }
  finally { button.disabled = false; button.textContent = original; }
});
$('analyzeActivity').addEventListener('click', analyzeCurrentActivity);
$('saveActivityReview').addEventListener('click', saveCurrentReview);


init();
