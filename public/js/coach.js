const $ = id => document.getElementById(id);
const state = { user: null, config: null, athletes: [], athlete: null, editingSession: null, modalBlocks: [], activities: [], recovery: [], currentActivityId: null, currentActivity: null, calendar: { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), weeks: new Map(), selectedWeekStart: isoMonday(), loading: false } };
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
    ? globalThis.newId()
    : `rf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function switchView(name) {
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `${name}View`));
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
  $('weekStart').value = weekStart;
  $('weekType').value = week.week_type || 'Carga controlada';
  $('targetLoad').value = Number(week.target_load || 0);
  $('weekTitle').value = week.title || '';
  $('weekComment').value = week.coach_comment || '';
  $('selectedWeekLabel').textContent = `${dateLabel(weekStart)} – ${dateLabel(addDays(weekStart, 6))}`;
  $('selectedWeekStatus').textContent = week.status === 'published' ? 'Publicada' : 'Borrador';
  $('selectedWeekStatus').className = `badge ${week.status === 'published' ? '' : 'pending'}`;
  $('generatedWeekLoad').textContent = generatedLoad(week);
  $('generatedSessionCount').textContent = (week.workouts || []).length;
  $('saveWeek').textContent = week.status === 'published' ? 'Guardar cambios' : 'Guardar borrador';
  $('publishWeek').textContent = week.status === 'published' ? 'Actualizar en la app' : 'Publicar semana';
  if (rerender) renderCalendar();
}

function renderWeekEditor() {
  if (!state.athlete) return;
  $('weekConnectionBadge').textContent = state.athlete.intervals_status === 'connected' ? 'Intervals conectado' : 'Intervals pendiente';
  $('weekConnectionBadge').className = `badge ${state.athlete.intervals_status === 'connected' ? '' : 'pending'}`;
  renderCalendar();
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
    for (let index = 0; index < 7; index += 1) {
      const date = dateToIso(addCalendarDays(cursor, index));
      const dayDate = parseLocalDate(date);
      const workouts = (week.workouts || []).filter(item => item.workout_date === date);
      const dayLoad = workouts.reduce((sum, item) => sum + Number(item.planned_load || 0), 0);
      cells.push(`<article class="calendar-day ${dayDate.getMonth() !== month.getMonth() ? 'outside' : ''} ${date === today ? 'today' : ''} ${selected ? 'selected-week' : ''}" data-select-week="${weekStart}">
        <div class="calendar-day-head"><span class="calendar-day-number">${dayDate.getDate()}</span><button class="calendar-add" data-add-date="${date}" type="button" aria-label="Añadir sesión el ${date}">+</button></div>
        <div class="calendar-sessions">${workouts.map(workout => `<button class="calendar-session ${workoutVisualClass(workout)}" data-session-id="${workout.id}" data-session-week="${weekStart}" type="button"><strong>${escapeHtml(workout.title)}</strong><small><span>${escapeHtml(workout.sport || 'Run')}</span><b>${Number(workout.planned_load || 0)}</b></small></button>`).join('')}</div>
        <div class="calendar-day-load"><span>${workouts.length} sesión${workouts.length === 1 ? '' : 'es'}</span><b>Carga ${dayLoad}</b></div>
      </article>`);
    }
    const load = generatedLoad(week);
    const target = Number(week.target_load || 0);
    const percentage = target > 0 ? Math.round((load / target) * 100) : 0;
    cells.push(`<button class="calendar-week-summary ${selected ? 'active' : ''}" data-select-week="${weekStart}" type="button">
      <strong>${dateLabel(weekStart)} – ${dateLabel(addDays(weekStart, 6))}</strong>
      <span>Programada <b>${load}</b></span><span>Objetivo <b>${target || '—'}</b></span><span>${week.status === 'published' ? 'Publicada' : 'Borrador'}</span>
      <i><em style="width:${Math.min(100, percentage)}%"></em></i>
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
  $('calendarGrid').querySelectorAll('[data-select-week]').forEach(element => element.addEventListener('click', () => selectCalendarWeek(element.dataset.selectWeek)));
  selectCalendarWeek(state.calendar.selectedWeekStart, false);
}

async function loadCalendarMonth() {
  if (!state.athlete) return;
  state.calendar.loading = true;
  $('calendarGrid').innerHTML = '<div class="empty-state calendar-loading">Cargando sesiones…</div>';
  const { start, end } = monthCalendarRange();
  const data = await api(`/api/coach/athletes/${state.athlete.id}/calendar?oldest=${dateToIso(start)}&newest=${dateToIso(end)}`);
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
  if (!state.athlete.zones) state.athlete.zones = { hr: [], pace: [] };
  state.calendar.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  state.calendar.weeks = new Map();
  state.calendar.selectedWeekStart = localStorage.getItem(`runflow_calendar_week_${id}`) || isoMonday();
  renderAll();
  resetActivityViews();
  await Promise.allSettled([loadCalendarMonth(), loadActivities(false), loadRecovery(false)]);
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
    workouts: week.workouts || [],
  };
}

function syncWeekStateFromInputs() {
  const week = calendarWeek(state.calendar.selectedWeekStart);
  week.week_type = $('weekType').value;
  week.title = $('weekTitle').value;
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
    const extra = data.intervals?.skipped ? ` ${data.intervals.reason}` : (shouldPublish ? ` Se han preparado ${data.intervals?.exported ?? 0} sesiones para Intervals.` : '');
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
  $('modalLoad').value = workout.planned_load || 0;
  $('modalWorkoutTitle').value = workout.title || '';
  $('modalSummary').value = workout.summary || '';
  $('structuredDescription').value = workout.structured_description || '';
  const blocks = workout.blocks || [];
  const warmup = blocks.find(block => block.type === 'warmup') || {};
  const activation = blocks.find(block => block.type === 'activation') || {};
  const cooldown = blocks.find(block => block.type === 'cooldown') || {};
  state.modalBlocks = blocks.filter(block => block.type === 'central').map(block => ({ ...block }));
  $('warmupMinutes').value = warmup.duration_min ?? 15;
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
  blocks.push(...state.modalBlocks.map(block => ({ type: 'central', ...block })));
  const cooldown = Number($('cooldownMinutes').value || 0);
  if (cooldown > 0) blocks.push({ type: 'cooldown', duration_min: cooldown, target: $('cooldownTarget').value });
  return blocks;
}

function generateStructuredDescription() {
  const lines = [];
  const blocks = buildBlocks();
  blocks.forEach(block => {
    if (block.type === 'warmup') lines.push('Calentamiento', `- ${block.duration_min}m ${block.target}`, '');
    if (block.type === 'activation') lines.push(`Activación ${block.repetitions}x`, `- ${block.work_sec}s ${block.target}`, `- ${block.recovery_sec}s ${block.recovery_target}`, '');
    if (block.type === 'central') lines.push(`${block.name || 'Bloque central'} ${block.repetitions}x`, `- ${block.work_value}${block.work_unit} ${block.target}`, `- ${block.recovery_value}${block.recovery_unit} ${block.recovery_target}`, '');
    if (block.type === 'cooldown') lines.push('Vuelta a la calma', `- ${block.duration_min}m ${block.target}`, '');
  });
  $('structuredDescription').value = lines.join('\n').trim();
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
    $('saveWeekStatus').textContent = week.status === 'published' ? 'Cambios guardados en la app' : 'Borrador guardado';
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
$('saveSessionModal').addEventListener('click', async () => {
  if (!state.editingSession) return;
  const originalWeekStart = state.editingSession.weekStart;
  const originalWeek = calendarWeek(originalWeekStart);
  const workoutDate = $('modalWorkoutDate').value;
  if (!workoutDate) return showMessage('Selecciona la fecha de la sesión.', 'error');
  const targetWeekStart = isoMonday(parseLocalDate(workoutDate));
  const targetWeek = calendarWeek(targetWeekStart);
  const workout = {
    ...state.editingSession.draft,
    id: state.editingSession.draft.id || newId(),
    workout_date: workoutDate,
    sport: $('modalSport').value,
    planned_load: Number($('modalLoad').value || 0),
    title: $('modalWorkoutTitle').value.trim() || 'Sesión',
    summary: $('modalSummary').value.trim(),
    blocks: buildBlocks(),
    structured_description: $('structuredDescription').value || (generateStructuredDescription(), $('structuredDescription').value),
  };
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

$('syncActivities').addEventListener('click', () => loadActivities(true));
$('syncRecovery').addEventListener('click', () => loadRecovery(true));
$('analyzeActivity').addEventListener('click', analyzeCurrentActivity);
$('saveActivityReview').addEventListener('click', saveCurrentReview);


init();
