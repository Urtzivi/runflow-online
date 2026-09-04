(() => {
  'use strict';

  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const iso = value => new Date(`${value}T12:00:00`);
  const toIso = date => date.toISOString().slice(0, 10);
  const add = (value, days) => { const date = iso(value); date.setDate(date.getDate() + days); return toIso(date); };
  const mondayIndex = date => (date.getDay() + 6) % 7;
  const formatDate = value => value ? new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(iso(value)) : '—';
  const monthLabel = date => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(date);
  const daysInclusive = (start, end) => Math.max(1, Math.round((iso(end) - iso(start)) / 86400000) + 1);
  const weeksInclusive = (start, end) => Math.max(1, Math.ceil(daysInclusive(start, end) / 7));
  const apiCall = (url, options = {}) => typeof api === 'function'
    ? api(url, options)
    : fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
      return data;
    });
  const notify = (message, type = 'success') => { try { showMessage(message, type); } catch { window.alert(message); } };

  const MESO_TYPES = {
    base: 'Base aeróbica', development: 'Desarrollo', strength: 'Fuerza', threshold: 'Umbral',
    vo2max: 'VO₂max', specific: 'Específico', taper: 'Afinamiento', recovery: 'Recuperación',
    competition: 'Competición', other: 'Otro',
  };
  const MICRO_TYPES = {
    adaptation: 'Adaptación', load: 'Carga', development: 'Desarrollo', overload: 'Sobrecarga',
    deload: 'Descarga', taper: 'Afinamiento', recovery: 'Recuperación', competition: 'Competición',
  };
  const TECHNICAL_MACRO_MARKER = 'RUNFLOW_V10_TECHNICAL_MACRO';
  const MESO_TYPE_PREFIX = 'RUNFLOW_MESO_TYPE:';
  const planner = { level: 'season', seasonMode: 'calendar', mesocycleId: null, microcycleId: null, importContext: null, installed: false };

  function appState() { try { return state; } catch { return null; } }
  function athleteId() { return appState()?.athlete?.id || ''; }
  function plan() { return appState()?.plan || null; }
  function macros() { return plan()?.macrocycles || []; }
  function mesocycles() {
    return macros().flatMap((macro, macroIndex) => (macro.mesocycles || []).map((meso, index) => ({ ...meso, _macro: macro, _colour: (macroIndex + index) % 6 })));
  }
  function microcycles(meso) { return meso?.microcycles || []; }
  function datesOverlap(firstStart, firstEnd, secondStart, secondEnd) {
    return firstStart <= secondEnd && firstEnd >= secondStart;
  }
  function mesocycleConflict(start, end, excludeId = '') {
    return mesocycles().find(item => String(item.id) !== String(excludeId || '') && datesOverlap(start, end, item.start_date, item.end_date));
  }
  function nextAvailableStart(items, rangeStart, rangeEnd) {
    const ordered = [...items].filter(item => item?.start_date && item?.end_date).sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)));
    if (!ordered.length) return rangeStart;
    const candidate = add(ordered[ordered.length - 1].end_date, 1);
    return candidate <= rangeEnd ? candidate : rangeStart;
  }
  function mesocycleById(id) { return mesocycles().find(item => String(item.id) === String(id)); }
  function microcycleById(id) {
    for (const meso of mesocycles()) {
      const micro = microcycles(meso).find(item => String(item.id) === String(id));
      if (micro) return { ...micro, _meso: meso };
    }
    return null;
  }
  function mesoType(meso) {
    const line = String(meso?.notes || '').split('\n').find(item => item.startsWith(MESO_TYPE_PREFIX));
    return line ? line.slice(MESO_TYPE_PREFIX.length).trim() : 'other';
  }
  function visibleNotes(meso) {
    return String(meso?.notes || '').split('\n').filter(line => !line.startsWith(MESO_TYPE_PREFIX)).join('\n').trim();
  }
  function microStatus(micro) { return micro?.publication_status === 'published' ? 'Publicado' : 'Borrador'; }
  function statusClass(micro) { return micro?.publication_status === 'published' ? 'published' : 'draft'; }

  function seasonMonths(season) {
    if (!season?.start_date || !season?.end_date) return [];
    const cursor = iso(season.start_date); cursor.setDate(1);
    const end = iso(season.end_date); end.setDate(1);
    const months = [];
    while (cursor <= end && months.length < 60) {
      months.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }

  function monthCalendar(date, season, mesos, goals) {
    const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
    const gridStart = new Date(first); gridStart.setDate(first.getDate() - mondayIndex(first));
    const gridEnd = new Date(last); gridEnd.setDate(last.getDate() + (6 - mondayIndex(last)));
    const cells = [];
    for (const cursor = new Date(gridStart); cursor <= gridEnd; cursor.setDate(cursor.getDate() + 1)) {
      const day = toIso(cursor);
      const inMonth = cursor.getMonth() === date.getMonth();
      const inSeason = day >= season.start_date && day <= season.end_date;
      const activeMesos = mesos.filter(meso => day >= meso.start_date && day <= meso.end_date);
      const dayGoals = goals.filter(goal => goal.goal_date === day);
      cells.push(`<button class="v10-day ${inMonth ? '' : 'outside'} ${inSeason ? '' : 'outside-season'}" type="button" data-v10-date="${day}" ${inSeason ? '' : 'disabled'}>
        <span class="v10-day-number">${cursor.getDate()}</span>
        <span class="v10-day-content">
          ${activeMesos.map(meso => {
            const showLabel = day === meso.start_date || cursor.getDay() === 1 || cursor.getDate() === 1;
            return `<span class="v10-meso-strip colour-${meso._colour}" data-v10-open-meso="${esc(meso.id)}" title="${esc(meso.name)} · ${formatDate(meso.start_date)}–${formatDate(meso.end_date)}">${showLabel ? esc(meso.name) : '&nbsp;'}</span>`;
          }).join('')}
          ${dayGoals.map(goal => `<span class="v10-goal-pin priority-${String(goal.priority_code || 'B').toLowerCase()}" title="Objetivo ${esc(goal.name)}">◆ ${esc(goal.name)}</span>`).join('')}
        </span>
      </button>`);
    }
    return `<article class="v10-month-card">
      <h3>${esc(monthLabel(date))}</h3>
      <div class="v10-weekdays"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div class="v10-month-grid">${cells.join('')}</div>
    </article>`;
  }

  function renderProfileSeason() {
    const card = q('#v10ProfileSeason');
    if (!card) return;
    const currentPlan = plan();
    const season = currentPlan?.season;
    const seasons = appState()?.seasons || [];
    if (!season) {
      card.innerHTML = `<div class="card-head"><div><p class="eyebrow">Paso 1 · Planificación</p><h2>Temporada y objetivos</h2><p>Da de alta la temporada antes de abrir el calendario.</p></div><button class="btn primary" data-v10-action="new-season" type="button">+ Crear temporada</button></div>`;
      return;
    }
    const goals = currentPlan.goals || [];
    card.innerHTML = `<div class="card-head"><div><p class="eyebrow">Paso 1 · Planificación</p><h2>${esc(season.name)}</h2><p>${formatDate(season.start_date)} – ${formatDate(season.end_date)} · ${goals.length} objetivo${goals.length === 1 ? '' : 's'}</p></div><div class="actions"><button class="btn soft" data-v10-action="edit-season" type="button">Editar temporada</button><button class="btn primary" data-v10-action="new-goal" type="button">+ Objetivo</button></div></div>
      <div class="card-body v10-profile-season-body">
        <p><strong>Dirección:</strong> ${esc(season.season_objective || 'Sin objetivo global definido.')}</p>
        <div class="v10-profile-goals">${goals.length ? goals.map(goal => `<button type="button" data-v10-edit-goal="${esc(goal.id)}"><span class="priority-${String(goal.priority_code || 'B').toLowerCase()}">${esc(goal.priority_code || 'B')}</span><strong>${esc(goal.name)}</strong><small>${formatDate(goal.goal_date)}</small></button>`).join('') : '<span class="muted">Todavía no hay objetivos dentro de esta temporada.</span>'}</div>
        <button class="btn secondary" data-v10-action="open-planner" type="button">Abrir planificador mensual →</button>
        ${seasons.length > 1 ? `<small class="muted">Hay ${seasons.length} temporadas guardadas. La selección se gestiona dentro del planificador.</small>` : ''}
      </div>`;
  }

  function renderMesocycleList(mesos) {
    if (!mesos.length) return '<div class="v10-empty compact"><h3>Todavía no hay mesociclos</h3><p>Crea el primero para empezar a estructurar la temporada.</p><button class="btn primary" data-v10-action="new-meso" type="button">+ Primer mesociclo</button></div>';
    const ordered = [...mesos].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    return `<div class="v10-meso-overview">
      <div class="v10-meso-overview-head"><span>Orden</span><span>Mesociclo y objetivo</span><span>Tipo</span><span>Fechas</span><span>Microciclos</span><span></span></div>
      ${ordered.map((meso, index) => {
        const conflict = ordered.find(other => String(other.id) !== String(meso.id) && datesOverlap(meso.start_date, meso.end_date, other.start_date, other.end_date));
        return `<article class="v10-meso-overview-row ${conflict ? 'conflict' : ''}">
          <span class="v10-meso-order">${index + 1}</span>
          <div><strong>${esc(meso.name || `Mesociclo ${index + 1}`)}</strong><p>${esc(meso.primary_adaptation || 'Sin objetivo principal definido')}</p>${conflict ? `<small class="v10-conflict-note">Se solapa con “${esc(conflict.name)}”. Edita las fechas para corregirlo.</small>` : ''}</div>
          <span>${esc(MESO_TYPES[mesoType(meso)] || MESO_TYPES.other)}</span>
          <span>${formatDate(meso.start_date)}<br>${formatDate(meso.end_date)}</span>
          <span>${microcycles(meso).length}</span>
          <div class="actions"><button class="btn soft small" data-v10-edit-meso="${esc(meso.id)}" type="button">Editar</button><button class="btn secondary small" data-v10-open-meso="${esc(meso.id)}" type="button">Abrir →</button></div>
        </article>`;
      }).join('')}
    </div>`;
  }

  function renderSeason() {
    const currentPlan = plan();
    const season = currentPlan?.season;
    if (!season) {
      return `<div class="v10-empty"><h2>Primero crea la temporada</h2><p>La temporada y sus objetivos se dan de alta en la ficha del atleta.</p><div class="actions"><button class="btn primary" data-v10-action="new-season">+ Crear temporada</button><button class="btn secondary" data-v10-action="open-profile">Ir a la ficha</button></div></div>`;
    }
    const mesos = mesocycles();
    const goals = currentPlan.goals || [];
    return `<header class="v10-planner-head">
      <div><p class="eyebrow">Paso 2 · Calendario mensual de temporada</p><h2>${esc(season.name)}</h2><p>${formatDate(season.start_date)} – ${formatDate(season.end_date)} · ${mesos.length} mesociclo${mesos.length === 1 ? '' : 's'}</p></div>
      <div class="actions"><label class="v10-season-select">Temporada<select id="v10SeasonSelect">${(appState()?.seasons || []).map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(season.id) ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label><button class="btn soft" data-v10-action="open-profile">Temporada y objetivos</button><button class="btn soft" data-v10-action="legacy-view" title="Acceso a funciones antiguas que siguen conservadas">Vista técnica</button><button class="btn primary" data-v10-action="new-meso">+ Mesociclo</button></div>
    </header>
    <div class="v10-season-summary">
      <span><strong>${goals.length}</strong> objetivos</span><span><strong>${mesos.length}</strong> mesociclos</span><span><strong>${mesos.reduce((sum, meso) => sum + microcycles(meso).length, 0)}</strong> microciclos</span><span><strong>${mesos.reduce((sum, meso) => sum + microcycles(meso).reduce((inner, micro) => inner + (micro.workouts || []).length, 0), 0)}</strong> sesiones</span>
    </div>
    ${goals.length ? `<div class="v10-goal-legend">${goals.map(goal => `<span><i class="priority-${String(goal.priority_code || 'B').toLowerCase()}">${esc(goal.priority_code || 'B')}</i>${esc(goal.name)} · ${formatDate(goal.goal_date)}</span>`).join('')}</div>` : ''}
    <div class="v10-view-switch" role="group" aria-label="Vista del planificador"><button class="${planner.seasonMode === 'calendar' ? 'active' : ''}" data-v10-action="calendar-view" type="button">Calendario mensual</button><button class="${planner.seasonMode === 'list' ? 'active' : ''}" data-v10-action="meso-list-view" type="button">Lista de mesociclos</button></div>
    ${planner.seasonMode === 'list'
      ? renderMesocycleList(mesos)
      : `<p class="v10-calendar-help">Pulsa un día libre para crear un mesociclo desde esa fecha. Pulsa un mesociclo para entrar y añadir sus microciclos.</p><div class="v10-season-months">${seasonMonths(season).map(month => monthCalendar(month, season, mesos, goals)).join('')}</div>`}`;
  }

  function renderMeso(meso) {
    if (!meso) { planner.level = 'season'; return renderSeason(); }
    const micros = microcycles(meso);
    return `<div class="v10-breadcrumb"><button data-v10-action="back-season">Temporada</button><span>›</span><strong>${esc(meso.name)}</strong></div>
      <header class="v10-planner-head"><div><p class="eyebrow">Paso 3 · Mesociclo</p><h2>${esc(meso.name)}</h2><p>${formatDate(meso.start_date)} – ${formatDate(meso.end_date)} · ${weeksInclusive(meso.start_date, meso.end_date)} semanas · ${esc(MESO_TYPES[mesoType(meso)] || MESO_TYPES.other)}</p></div><div class="actions"><button class="btn soft" data-v10-edit-meso="${esc(meso.id)}">Editar ficha</button><button class="btn primary" data-v10-new-micro="${esc(meso.id)}">+ Microciclo</button></div></header>
      <section class="v10-objective-card"><span>Objetivo principal</span><strong>${esc(meso.primary_adaptation || 'Sin definir')}</strong>${(meso.secondary_adaptations || []).length ? `<p>Secundarios: ${esc(meso.secondary_adaptations.join(' · '))}</p>` : ''}${meso.success_criteria ? `<p>Criterio de éxito: ${esc(meso.success_criteria)}</p>` : ''}</section>
      <div class="v10-micro-list">${micros.length ? micros.map((micro, index) => `<button class="v10-micro-card" type="button" data-v10-open-micro="${esc(micro.id)}"><span class="v10-micro-number">${index + 1}</span><div><strong>${esc(micro.name || `Microciclo ${index + 1}`)}</strong><small>${formatDate(micro.start_date)} – ${formatDate(micro.end_date)} · ${esc(MICRO_TYPES[micro.type] || micro.type || 'Planificado')}</small><p>${esc(micro.primary_objective || 'Sin objetivo definido')}</p></div><span class="v10-publication ${statusClass(micro)}">${microStatus(micro)}</span><span>${(micro.workouts || []).length} sesiones →</span></button>`).join('') : `<div class="v10-empty compact"><h3>Añade los microciclos de este mesociclo</h3><p>Cada microciclo tendrá su ficha, fechas, tipo y objetivo.</p><button class="btn primary" data-v10-new-micro="${esc(meso.id)}">+ Primer microciclo</button></div>`}</div>`;
  }

  function sessionDescription(session) {
    return session.session_objective || session.summary || session.structured_description || 'Sesión programada';
  }
  function renderMicro(micro) {
    if (!micro) { planner.level = 'season'; return renderSeason(); }
    const meso = micro._meso;
    const workouts = micro.workouts || [];
    return `<div class="v10-breadcrumb"><button data-v10-action="back-season">Temporada</button><span>›</span><button data-v10-open-meso="${esc(meso.id)}">${esc(meso.name)}</button><span>›</span><strong>${esc(micro.name || 'Microciclo')}</strong></div>
      <header class="v10-planner-head"><div><p class="eyebrow">Paso 4 · Microciclo y sesiones</p><h2>${esc(micro.name || 'Microciclo')}</h2><p>${formatDate(micro.start_date)} – ${formatDate(micro.end_date)} · ${esc(MICRO_TYPES[micro.type] || micro.type || 'Planificado')} · ${microStatus(micro)}</p></div><div class="actions"><button class="btn soft" data-v10-edit-micro="${esc(micro.id)}">Editar ficha</button><button class="btn primary" data-v10-manual-session="${esc(micro.id)}">+ Sesión manual</button><button class="btn secondary" data-v10-import="${esc(micro.id)}">Importar archivo</button><button class="btn soft" data-v10-template="${esc(micro.id)}">Descargar plantilla</button></div></header>
      <section class="v10-objective-card"><span>Objetivo del microciclo</span><strong>${esc(micro.primary_objective || 'Sin definir')}</strong><p>Carga planificada: ${Number(micro.planned?.load || 0)} · ${workouts.length} sesiones</p></section>
      <section id="v10AvailabilityStatus" class="v10-availability-status"><span>Comprobando disponibilidad del deportista…</span></section>
      <div class="v10-session-list">${workouts.length ? workouts.map(session => `<article class="v10-session-card"><div class="v10-session-date"><strong>${new Intl.DateTimeFormat('es-ES', { weekday: 'short' }).format(iso(session.workout_date || micro.start_date))}</strong><span>${formatDate(session.workout_date || micro.start_date)}</span></div><div><span class="v10-sport">${esc(session.sport || 'Run')} · prioridad ${esc(session.priority || 'B')}</span><h3>${esc(session.title || 'Sesión')}</h3><p>${esc(sessionDescription(session))}</p></div><div class="v10-session-metrics"><span>${Number(session.planned_duration_min || 0) ? `${Number(session.planned_duration_min)} min` : 'Duración —'}</span><span>Carga ${Number(session.planned_load || 0)}</span><button class="btn soft small" data-v10-edit-session="${esc(session.id)}" data-date="${esc(session.workout_date)}">Editar</button></div></article>`).join('') : '<div class="v10-empty compact"><h3>Este microciclo todavía no tiene sesiones</h3><p>Añádelas manualmente o importa el archivo JSON que preparemos.</p></div>'}</div>
      <footer class="v10-publish-bar"><div><strong>${micro.publication_status === 'published' ? 'Microciclo publicado' : 'Microciclo en borrador'}</strong><p>${micro.publication_status === 'published' ? 'Las sesiones están visibles para el atleta y sincronizadas con Intervals.' : 'Revisa todas las sesiones antes de enviarlas al atleta.'}</p></div><button class="btn primary" data-v10-publish="${esc(micro.id)}">${micro.publication_status === 'published' ? 'Actualizar en Intervals' : 'Publicar en Intervals'}</button></footer>`;
  }

  function renderPlanner() {
    const body = q('#v10PlannerBody');
    if (!body) return;
    if (planner.level === 'meso') body.innerHTML = renderMeso(mesocycleById(planner.mesocycleId));
    else if (planner.level === 'micro') body.innerHTML = renderMicro(microcycleById(planner.microcycleId));
    else body.innerHTML = renderSeason();
    renderProfileSeason();
    if (planner.level === 'micro') renderAvailabilityStatus(microcycleById(planner.microcycleId));
  }

  async function renderAvailabilityStatus(micro) {
    const root = q('#v10AvailabilityStatus');
    if (!root || !micro || !window.RunFlowAvailability) return;
    try {
      const profile = await window.RunFlowAvailability.load();
      const availability = profile?.availability || {};
      if (!availability.configured && !(availability.days || []).length) {
        root.classList.add('warning');
        root.innerHTML = '<div><strong>Disponibilidad semanal pendiente</strong><p>Complétala antes de programar sesiones para que RunFlow pueda bloquear días y duraciones incompatibles.</p></div><button class="btn secondary small" data-v10-action="edit-availability">Completar en la ficha</button>';
        return;
      }
      const conflicts = (micro.workouts || []).map(workout => window.RunFlowAvailability.validateWithProfile(workout, profile)).filter(result => !result.ok);
      root.classList.toggle('warning', conflicts.length > 0);
      root.classList.toggle('ok', conflicts.length === 0);
      root.innerHTML = conflicts.length
        ? `<div><strong>${conflicts.length} conflicto${conflicts.length === 1 ? '' : 's'} con la disponibilidad</strong><p>${esc(conflicts.map(item => item.error).join(' '))}</p></div><button class="btn secondary small" data-v10-action="edit-availability">Editar disponibilidad</button>`
        : '<div><strong>Disponibilidad comprobada</strong><p>Todos los días, tipos de sesión y duraciones de este microciclo son compatibles con la ficha.</p></div><button class="btn secondary small" data-v10-action="edit-availability">Ver disponibilidad</button>';
    } catch (error) {
      root.classList.add('warning');
      root.innerHTML = `<div><strong>No se pudo comprobar la disponibilidad</strong><p>${esc(error.message)}</p></div>`;
    }
  }

  async function ensurePlanLoaded() {
    if (!appState()?.athlete || plan()) return;
    try { await loadPlan(appState()?.selectedSeasonId || null); renderPlanner(); }
    catch (error) { notify(error.message, 'error'); }
  }

  function openCycleForm(kind, item = null, parentId = null, initialDate = '') {
    const season = plan()?.season;
    if (!season) return notify('Primero crea una temporada.', 'error');
    const modal = q('#v10CycleModal');
    const isMeso = kind === 'mesocycle';
    const parentMeso = !isMeso ? (item?._meso || mesocycleById(parentId)) : null;
    const existingSiblings = isMeso ? mesocycles() : microcycles(parentMeso);
    let suggestedStart = item?.start_date || initialDate || nextAvailableStart(existingSiblings, parentMeso?.start_date || season.start_date, parentMeso?.end_date || season.end_date);
    if (!isMeso && !item) {
      const cursor = iso(suggestedStart);
      const daysToMonday = (8 - cursor.getDay()) % 7;
      suggestedStart = add(suggestedStart, daysToMonday);
      if (suggestedStart > (parentMeso?.end_date || season.end_date)) suggestedStart = parentMeso?.start_date || season.start_date;
    }
    const limitEnd = isMeso ? season.end_date : (parentMeso?.end_date || season.end_date);
    const start = suggestedStart;
    const suggestedEnd = item?.end_date || (isMeso ? add(start, 27) : add(start, 6));
    const end = suggestedEnd > limitEnd ? limitEnd : suggestedEnd;
    modal.dataset.kind = kind; modal.dataset.id = item?.id || ''; modal.dataset.parentId = parentId || '';
    q('#v10CycleEyebrow').textContent = isMeso ? 'Ficha de mesociclo' : 'Ficha de microciclo';
    q('#v10CycleTitle').textContent = `${item ? 'Editar' : 'Crear'} ${isMeso ? 'mesociclo' : 'microciclo'}`;
    q('#v10CycleFields').innerHTML = isMeso ? `
      <div class="field-row"><label>Nombre<input id="v10Name" value="${esc(item?.name || '')}" placeholder="Base aeróbica I"></label><label>Tipo de mesociclo<select id="v10Type">${Object.entries(MESO_TYPES).map(([value, label]) => `<option value="${value}" ${(item ? mesoType(item) : 'base') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
      <div class="field-row-3"><label>Desde<input id="v10Start" type="date" value="${start}" min="${season.start_date}" max="${season.end_date}"></label><label>Hasta<input id="v10End" type="date" value="${end}" min="${season.start_date}" max="${season.end_date}"></label><label>Duración<input id="v10Duration" value="${weeksInclusive(start, end)} semanas" readonly></label></div>
      <label>Objetivo principal<textarea id="v10Objective" placeholder="Adaptación principal que buscamos">${esc(item?.primary_adaptation || '')}</textarea></label>
      <label>Objetivos secundarios<input id="v10Secondary" value="${esc((item?.secondary_adaptations || []).join(', '))}" placeholder="Separados por comas"></label>
      <label>Criterio para darlo por conseguido<textarea id="v10Success">${esc(item?.success_criteria || '')}</textarea></label>
      <label>Notas internas<textarea id="v10Notes">${esc(visibleNotes(item))}</textarea></label>` : `
      <div class="field-row"><label>Nombre<input id="v10Name" value="${esc(item?.name || '')}" placeholder="Carga 1"></label><label>Tipo de microciclo<select id="v10Type">${Object.entries(MICRO_TYPES).map(([value, label]) => `<option value="${value}" ${String(item?.type || 'load') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
      <div class="field-row-3"><label>Desde<input id="v10Start" type="date" value="${start}" min="${parentMeso?.start_date || season.start_date}" max="${limitEnd}"></label><label>Hasta<input id="v10End" type="date" value="${end}" min="${parentMeso?.start_date || season.start_date}" max="${limitEnd}"></label><label>Duración<input id="v10Duration" value="${daysInclusive(start, end)} días" readonly></label></div>
      <label>Objetivo del microciclo<textarea id="v10Objective">${esc(item?.primary_objective || '')}</textarea></label>
      <div class="field-row-3"><label>Carga prevista<input id="v10Load" type="number" min="0" value="${item?.planned?.load ?? ''}"></label><label>Horas previstas<input id="v10Hours" type="number" step="0.1" min="0" value="${item?.planned?.hours ?? ''}"></label><label>Sesiones de fuerza<input id="v10Strength" type="number" min="0" value="${item?.planned?.strength_sessions ?? ''}"></label></div>
      <label>Objetivo de recuperación<textarea id="v10Recovery">${esc(item?.recovery_target || '')}</textarea></label><label>Notas internas<textarea id="v10Notes">${esc(item?.notes || '')}</textarea></label>`;
    q('#v10CycleStatus').textContent = '';
    modal.classList.remove('hidden');
    const refreshDuration = () => {
      const a = q('#v10Start')?.value; const b = q('#v10End')?.value;
      if (a && b && b >= a) q('#v10Duration').value = isMeso ? `${weeksInclusive(a, b)} semanas` : `${daysInclusive(a, b)} días`;
    };
    q('#v10Start').addEventListener('change', refreshDuration); q('#v10End').addEventListener('change', refreshDuration);
  }

  async function technicalMacro(start, end) {
    const currentPlan = plan(); const season = currentPlan?.season;
    const containing = macros().find(macro => macro.start_date <= start && macro.end_date >= end);
    if (containing) return containing;
    const existingTechnical = macros().find(macro => String(macro.notes || '').includes(TECHNICAL_MACRO_MARKER));
    if (existingTechnical) {
      const response = await apiCall(`/api/coach/athletes/${encodeURIComponent(athleteId())}/macrocycles/${encodeURIComponent(existingTechnical.id)}`, { method: 'PUT', body: JSON.stringify({ ...existingTechnical, start_date: season.start_date, end_date: season.end_date }) });
      return response.macrocycle;
    }
    const response = await apiCall(`/api/coach/athletes/${encodeURIComponent(athleteId())}/seasons/${encodeURIComponent(season.id)}/macrocycles`, {
      method: 'POST', body: JSON.stringify({ name: 'Estructura de temporada', start_date: season.start_date, end_date: season.end_date, status: 'planned', primary_objective: season.season_objective || 'Estructura operativa de la temporada', notes: TECHNICAL_MACRO_MARKER }),
    });
    return response.macrocycle;
  }

  async function saveCycle() {
    const modal = q('#v10CycleModal'); const kind = modal.dataset.kind; const id = modal.dataset.id; const parentId = modal.dataset.parentId;
    const start = q('#v10Start').value; const end = q('#v10End').value; const name = q('#v10Name').value.trim(); const objective = q('#v10Objective').value.trim();
    if (!name || !start || !end || !objective) { q('#v10CycleStatus').textContent = 'Completa nombre, fechas y objetivo.'; return; }
    if (end < start) { q('#v10CycleStatus').textContent = 'La fecha final no puede ser anterior a la inicial.'; return; }
    if (kind === 'mesocycle') {
      const conflict = mesocycleConflict(start, end, id);
      if (conflict) { q('#v10CycleStatus').textContent = `Estas fechas se solapan con “${conflict.name}” (${formatDate(conflict.start_date)} – ${formatDate(conflict.end_date)}).`; return; }
    }
    const button = q('#v10SaveCycle');
    try {
      button.disabled = true; q('#v10CycleStatus').textContent = 'Guardando…';
      if (kind === 'mesocycle') {
        const existing = id ? mesocycleById(id) : null;
        let macro = existing?._macro || await technicalMacro(start, end);
        if ((start < macro.start_date || end > macro.end_date) && String(macro.notes || '').includes(TECHNICAL_MACRO_MARKER)) {
          await apiCall(`/api/coach/athletes/${encodeURIComponent(athleteId())}/macrocycles/${encodeURIComponent(macro.id)}`, { method: 'PUT', body: JSON.stringify({ ...macro, start_date: plan().season.start_date, end_date: plan().season.end_date }) });
          macro = { ...macro, start_date: plan().season.start_date, end_date: plan().season.end_date };
        }
        if (start < macro.start_date || end > macro.end_date) throw new Error('Estas fechas quedan fuera de la estructura existente. Ajusta las fechas dentro de la temporada.');
        const type = q('#v10Type').value;
        const payload = { name, start_date: start, end_date: end, duration_weeks: weeksInclusive(start, end), status: existing?.status || 'planned', primary_adaptation: objective, secondary_adaptations: q('#v10Secondary').value.split(',').map(value => value.trim()).filter(Boolean), planned_hours: existing?.planned?.hours || 0, planned_distance_km: existing?.planned?.distance_km || 0, planned_elevation_m: existing?.planned?.elevation_m || 0, planned_load: existing?.planned?.load || 0, planned_strength_sessions: existing?.planned?.strength_sessions || 0, success_criteria: q('#v10Success').value.trim(), progression_pattern: existing?.progression_pattern || [], notes: `${MESO_TYPE_PREFIX}${type}${q('#v10Notes').value.trim() ? `\n${q('#v10Notes').value.trim()}` : ''}` };
        await apiCall(id ? `/api/coach/athletes/${encodeURIComponent(athleteId())}/mesocycles/${encodeURIComponent(id)}` : `/api/coach/athletes/${encodeURIComponent(athleteId())}/macrocycles/${encodeURIComponent(macro.id)}/mesocycles`, { method: id ? 'PUT' : 'POST', headers: { 'X-RunFlow-Planning-Origin': 'manual' }, body: JSON.stringify(payload) });
      } else {
        const existing = id ? microcycleById(id) : null;
        const payload = { name, start_date: start, end_date: end, type: q('#v10Type').value, primary_objective: objective, planned: { hours: Number(q('#v10Hours').value || 0), distance_km: Number(existing?.planned?.distance_km || 0), elevation_m: Number(existing?.planned?.elevation_m || 0), load: Number(q('#v10Load').value || 0), strength_sessions: Number(q('#v10Strength').value || 0) }, lifecycle_status: existing?.lifecycle_status || 'planned', publication_status: existing?.publication_status || 'draft', recovery_target: q('#v10Recovery').value.trim(), notes: q('#v10Notes').value.trim() };
        await apiCall(id ? `/api/coach/athletes/${encodeURIComponent(athleteId())}/microcycles/${encodeURIComponent(id)}` : `/api/coach/athletes/${encodeURIComponent(athleteId())}/mesocycles/${encodeURIComponent(parentId)}/microcycles`, { method: id ? 'PUT' : 'POST', headers: { 'X-RunFlow-Planning-Origin': 'manual' }, body: JSON.stringify(payload) });
      }
      modal.classList.add('hidden');
      await loadPlan(appState()?.selectedSeasonId || null); renderPlanner();
      notify(`${kind === 'mesocycle' ? 'Mesociclo' : 'Microciclo'} guardado.`, 'success');
    } catch (error) { q('#v10CycleStatus').textContent = error.message; }
    finally { button.disabled = false; }
  }

  function microPayload(micro, workouts = micro.workouts || []) {
    return { name: micro.name, title: micro.name, week_start: micro.start_date, start_date: micro.start_date, end_date: micro.end_date, mesocycle_id: micro.mesocycle_id, microcycle_type: micro.type, type: micro.type, primary_objective: micro.primary_objective, week_type: MICRO_TYPES[micro.type] || micro.week_type || 'Planificación', coach_comment: micro.notes || '', notes: micro.notes || '', target_load: Number(micro.planned?.load || 0), planned: micro.planned || {}, planned_hours: Number(micro.planned?.hours || 0), planned_distance_km: Number(micro.planned?.distance_km || 0), planned_elevation_m: Number(micro.planned?.elevation_m || 0), planned_strength_sessions: Number(micro.planned?.strength_sessions || 0), recovery_target: micro.recovery_target || '', lifecycle_status: micro.lifecycle_status || 'planned', publication_status: micro.publication_status || 'draft', status: micro.publication_status || 'draft', workouts };
  }

  async function openManualSession(micro, workoutId = null, date = null) {
    if (!micro) return;
    try {
      appState().calendar.month = new Date(`${micro.start_date}T12:00:00`);
      await loadCalendarMonth(false);
      selectCalendarWeek(micro.start_date, false);
      openSessionModal(workoutId, date || micro.start_date);
    } catch (error) { notify(error.message, 'error'); }
  }

  function templateFor(micro) {
    return {
      schema: 'runflow.microcycle.v1',
      athlete: { athlete_id: athleteId(), display_name: appState()?.athlete?.display_name || '' },
      microcycle: { id: micro.id, name: micro.name, start_date: micro.start_date, end_date: micro.end_date },
      sessions: [{ workout_date: micro.start_date, sport: 'Run', title: 'Nombre de la sesión', priority: 'A', session_objective: 'Objetivo concreto de la sesión', summary: 'Indicaciones breves para el atleta', planned_duration_min: 45, planned_distance_km: null, planned_elevation_m: 0, planned_load: 0, structured_description: 'Calentamiento\n- 10m Z1\n\nBloque principal\n- 25m Z2\n\nVuelta a la calma\n- 10m Z1', blocks: [{ type: 'warmup', duration_min: 10, target: 'Z1' }, { type: 'central', name: 'Bloque principal', repetitions: 1, work_value: 25, work_unit: 'm', target: 'Z2', recovery_value: 0, recovery_unit: 'm', recovery_target: 'Z1' }, { type: 'cooldown', duration_min: 10, target: 'Z1' }] }],
    };
  }
  function downloadTemplate(micro) {
    const blob = new Blob([JSON.stringify(templateFor(micro), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `RunFlow_${String(micro.name || 'microciclo').replace(/[^a-z0-9]+/gi, '_')}.json`; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function sessionsFromFile(value, micro) {
    let sessions;
    if (value?.schema === 'runflow.microcycle.v1') sessions = value.sessions;
    else if (value?.schema === 'runflow.week.v1') sessions = value.sessions || value.workouts;
    else if (value?.schema === 'runflow.plan.v1' && Array.isArray(value.weeks)) {
      const week = value.weeks.find(item => item.week_start === micro.start_date) || (value.weeks.length === 1 ? value.weeks[0] : null);
      sessions = week?.workouts;
    }
    if (!Array.isArray(sessions) || !sessions.length) throw new Error('El archivo no contiene sesiones RunFlow válidas. Usa la plantilla descargable del microciclo.');
    if (sessions.length > 30) throw new Error('Un microciclo no puede importar más de 30 sesiones.');
    return sessions.map((session, index) => {
      const workoutDate = session.workout_date || session.date || add(micro.start_date, Math.min(index, daysInclusive(micro.start_date, micro.end_date) - 1));
      if (workoutDate < micro.start_date || workoutDate > micro.end_date) throw new Error(`La sesión “${session.title || index + 1}” queda fuera de las fechas del microciclo.`);
      if (!String(session.title || '').trim()) throw new Error(`La sesión ${index + 1} necesita título.`);
      if (!String(session.structured_description || session.summary || '').trim() && !(Array.isArray(session.blocks) && session.blocks.length)) throw new Error(`La sesión “${session.title}” necesita descripción estructurada o bloques para poder publicarse en Intervals.`);
      return { ...session, id: crypto.randomUUID(), workout_date: workoutDate, sport: session.sport || 'Run', title: String(session.title).trim(), priority: ['A', 'B', 'C'].includes(session.priority) ? session.priority : 'B', structured_description: session.structured_description || session.summary || '', summary: session.summary || session.session_objective || '', blocks: Array.isArray(session.blocks) ? session.blocks : [], planned_load: Number(session.planned_load || 0) };
    });
  }

  async function previewImport(file, micro) {
    const value = JSON.parse(await file.text());
    const sessions = sessionsFromFile(value, micro);
    if (window.RunFlowAvailability?.validateWorkout) {
      const conflicts = [];
      for (const session of sessions) {
        const result = await window.RunFlowAvailability.validateWorkout(session);
        if (!result.ok) conflicts.push(result.error);
      }
      if (conflicts.length) throw new Error(`El archivo no respeta la disponibilidad: ${conflicts.slice(0, 3).join(' ')}`);
    }
    planner.importContext = { microId: micro.id, sessions };
    q('#v10ImportTitle').textContent = `${sessions.length} sesiones para ${micro.name}`;
    q('#v10ImportRows').innerHTML = sessions.map(session => `<div><strong>${formatDate(session.workout_date)} · ${esc(session.title)}</strong><span>${esc(session.sport)} · ${Number(session.planned_duration_min || 0) || '—'} min · carga ${Number(session.planned_load || 0)}</span></div>`).join('');
    q('#v10ImportStatus').textContent = 'Se guardarán como borrador. La publicación en Intervals será siempre una acción aparte.';
    q('#v10ImportModal').classList.remove('hidden');
  }

  async function confirmImport(replace) {
    const context = planner.importContext; const micro = microcycleById(context?.microId);
    if (!micro) return;
    if (micro.publication_status === 'published') { q('#v10ImportStatus').textContent = 'No se sustituye automáticamente un microciclo ya publicado. Añade o edita las sesiones manualmente.'; return; }
    const button = replace ? q('#v10ReplaceImport') : q('#v10MergeImport');
    try {
      button.disabled = true; q('#v10ImportStatus').textContent = 'Importando…';
      const workouts = replace ? context.sessions : [...(micro.workouts || []), ...context.sessions];
      await apiCall(`/api/coach/athletes/${encodeURIComponent(athleteId())}/microcycles/${encodeURIComponent(micro.id)}`, { method: 'PUT', headers: { 'X-RunFlow-Planning-Origin': 'imported' }, body: JSON.stringify({ ...microPayload(micro, workouts), publication_status: 'draft', status: 'draft' }) });
      q('#v10ImportModal').classList.add('hidden'); planner.importContext = null;
      await loadPlan(appState()?.selectedSeasonId || null); renderPlanner(); notify('Sesiones importadas en borrador. Revísalas antes de publicar.', 'success');
    } catch (error) { q('#v10ImportStatus').textContent = error.message; }
    finally { button.disabled = false; }
  }

  async function publishMicro(micro) {
    if (!micro) return;
    if (!(micro.workouts || []).length) return notify('Añade al menos una sesión antes de publicar.', 'error');
    if (window.RunFlowAvailability?.validateWorkout) {
      for (const workout of micro.workouts) {
        const result = await window.RunFlowAvailability.validateWorkout(workout);
        if (!result.ok) return notify(result.error, 'error');
      }
    }
    if (!window.confirm(`¿Publicar ${micro.workouts.length} sesiones de “${micro.name}” y sincronizarlas con Intervals?`)) return;
    const button = q('[data-v10-publish]');
    try {
      if (button) { button.disabled = true; button.textContent = 'Publicando…'; }
      const response = await apiCall(`/api/coach/athletes/${encodeURIComponent(athleteId())}/week/publish`, { method: 'POST', body: JSON.stringify({ ...microPayload(micro), status: 'published', publication_status: 'published' }) });
      await loadPlan(appState()?.selectedSeasonId || null); renderPlanner();
      const sync = response.intervals?.skipped ? ` ${response.intervals.reason || ''}` : ` ${response.intervals?.exported || 0} sesiones enviadas a Intervals.`;
      notify(`Microciclo publicado.${sync}`, 'success');
    } catch (error) { notify(error.message, 'error'); }
    finally { if (button) button.disabled = false; }
  }

  function handleClick(event) {
    const target = event.target.closest('[data-v10-action],[data-v10-date],[data-v10-open-meso],[data-v10-edit-meso],[data-v10-new-micro],[data-v10-open-micro],[data-v10-edit-micro],[data-v10-manual-session],[data-v10-edit-session],[data-v10-import],[data-v10-template],[data-v10-publish],[data-v10-edit-goal]');
    if (!target) return;
    if (target.dataset.v10OpenMeso) { event.stopPropagation(); planner.level = 'meso'; planner.mesocycleId = target.dataset.v10OpenMeso; renderPlanner(); q('#v10SeasonPlanner')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (target.dataset.v10OpenMicro) { planner.level = 'micro'; planner.microcycleId = target.dataset.v10OpenMicro; renderPlanner(); return; }
    if (target.dataset.v10EditMeso) return openCycleForm('mesocycle', mesocycleById(target.dataset.v10EditMeso));
    if (target.dataset.v10NewMicro) return openCycleForm('microcycle', null, target.dataset.v10NewMicro, mesocycleById(target.dataset.v10NewMicro)?.start_date || '');
    if (target.dataset.v10EditMicro) { const micro = microcycleById(target.dataset.v10EditMicro); return openCycleForm('microcycle', micro, micro?._meso?.id); }
    if (target.dataset.v10ManualSession) return openManualSession(microcycleById(target.dataset.v10ManualSession));
    if (target.dataset.v10EditSession) return openManualSession(microcycleById(planner.microcycleId), target.dataset.v10EditSession, target.dataset.date);
    if (target.dataset.v10Import) { planner.microcycleId = target.dataset.v10Import; q('#v10ImportFile').value = ''; q('#v10ImportFile').click(); return; }
    if (target.dataset.v10Template) return downloadTemplate(microcycleById(target.dataset.v10Template));
    if (target.dataset.v10Publish) return publishMicro(microcycleById(target.dataset.v10Publish));
    if (target.dataset.v10EditGoal) return openPlanForm('goal', target.dataset.v10EditGoal);
    if (target.dataset.v10Date) return openCycleForm('mesocycle', null, null, target.dataset.v10Date);
    const action = target.dataset.v10Action;
    if (action === 'new-season') return openPlanForm('season');
    if (action === 'edit-season') return openPlanForm('season', plan()?.season?.id);
    if (action === 'new-goal') return openPlanForm('goal');
    if (action === 'open-profile') { switchView('profile'); ensurePlanLoaded(); return; }
    if (action === 'edit-availability') {
      switchView('profile');
      setTimeout(() => q('#v9HierarchyAvailability')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 180);
      return;
    }
    if (action === 'open-planner') { switchView('plan'); planner.level = 'season'; renderPlanner(); return; }
    if (action === 'legacy-view') { q('#planView')?.classList.remove('v10-mode'); q('#v10SeasonPlanner')?.classList.add('hidden'); return; }
    if (action === 'return-planner') { q('#planView')?.classList.add('v10-mode'); q('#v10SeasonPlanner')?.classList.remove('hidden'); planner.level = 'season'; renderPlanner(); return; }
    if (action === 'new-meso') return openCycleForm('mesocycle');
    if (action === 'calendar-view') { planner.seasonMode = 'calendar'; renderPlanner(); return; }
    if (action === 'meso-list-view') { planner.seasonMode = 'list'; renderPlanner(); return; }
    if (action === 'back-season') { planner.level = 'season'; planner.mesocycleId = null; planner.microcycleId = null; renderPlanner(); }
  }

  function install() {
    if (planner.installed || !q('#planView') || !appState()) return false;
    planner.installed = true;
    const planView = q('#planView'); planView.classList.add('v10-mode');
    const panel = document.createElement('section'); panel.id = 'v10SeasonPlanner'; panel.className = 'v10-season-planner'; panel.innerHTML = '<div id="v10PlannerBody"><div class="v10-empty">Cargando temporada…</div></div>';
    planView.querySelector(':scope > .stack')?.prepend(panel);
    const legacyActions = q('#planView .plan-season-actions');
    if (legacyActions) legacyActions.insertAdjacentHTML('beforeend', '<button id="v10ReturnPlanner" class="btn primary" data-v10-action="return-planner" type="button">Volver al calendario de temporada</button>');
    const profileCard = document.createElement('section'); profileCard.id = 'v10ProfileSeason'; profileCard.className = 'card v10-profile-season';
    q('#profileView')?.prepend(profileCard);
    document.body.insertAdjacentHTML('beforeend', `
      <div id="v10CycleModal" class="modal-backdrop hidden"><section class="modal-card v10-cycle-modal"><div class="modal-head"><div><p class="eyebrow" id="v10CycleEyebrow">Ficha</p><h2 id="v10CycleTitle">Editar ciclo</h2></div><button class="btn secondary" data-v10-close="cycle" type="button">Cerrar</button></div><div id="v10CycleFields" class="modal-body stack"></div><div class="modal-actions"><span id="v10CycleStatus" class="muted small"></span><button id="v10SaveCycle" class="btn primary" type="button">Guardar ficha</button></div></section></div>
      <div id="v10ImportModal" class="modal-backdrop hidden"><section class="modal-card v10-import-modal"><div class="modal-head"><div><p class="eyebrow">Importar archivo RunFlow</p><h2 id="v10ImportTitle">Revisar sesiones</h2></div><button class="btn secondary" data-v10-close="import" type="button">Cerrar</button></div><div class="modal-body"><div id="v10ImportRows" class="v10-import-rows"></div><p id="v10ImportStatus" class="notice"></p></div><div class="modal-actions"><button id="v10MergeImport" class="btn secondary" type="button">Añadir a las existentes</button><button id="v10ReplaceImport" class="btn primary" type="button">Sustituir borrador</button></div></section></div>
      <input id="v10ImportFile" type="file" accept="application/json,.json" hidden>`);
    document.addEventListener('click', handleClick);
    qa('[data-v10-close]').forEach(button => button.addEventListener('click', () => q(button.dataset.v10Close === 'cycle' ? '#v10CycleModal' : '#v10ImportModal').classList.add('hidden')));
    q('#v10SaveCycle').addEventListener('click', saveCycle);
    q('#v10MergeImport').addEventListener('click', () => confirmImport(false)); q('#v10ReplaceImport').addEventListener('click', () => confirmImport(true));
    q('#v10ImportFile').addEventListener('change', async event => { const file = event.target.files?.[0]; if (!file) return; try { await previewImport(file, microcycleById(planner.microcycleId)); } catch (error) { notify(error.message, 'error'); } });
    q('#v10SeasonPlanner').addEventListener('change', event => { if (event.target.id === 'v10SeasonSelect') loadPlan(event.target.value).then(() => { planner.level = 'season'; renderPlanner(); }).catch(error => notify(error.message, 'error')); });
    document.addEventListener('click', event => {
      const navigation = event.target.closest('[data-v8-view],[data-view]');
      const view = navigation?.dataset.v8View || navigation?.dataset.view;
      if (view === 'profile' || view === 'plan') setTimeout(ensurePlanLoaded, 80);
    }, true);
    window.addEventListener('runflow:v9-athlete-ready', () => {
      planner.level = 'season'; planner.mesocycleId = null; planner.microcycleId = null;
      setTimeout(() => { renderPlanner(); renderProfileSeason(); }, 50);
    });

    const originalLoadPlan = window.loadPlan;
    if (typeof originalLoadPlan === 'function') window.loadPlan = async (...args) => { const result = await originalLoadPlan(...args); renderPlanner(); return result; };
    const originalPersist = window.persistCalendarWeek;
    if (typeof originalPersist === 'function') window.persistCalendarWeek = async (...args) => { const result = await originalPersist(...args); if (planner.level === 'micro') await window.loadPlan(appState()?.selectedSeasonId || null); return result; };
    setTimeout(() => { renderPlanner(); renderProfileSeason(); }, 350);
    return true;
  }

  function wait(attempt = 0) {
    if (install()) return;
    if (attempt < 200) setTimeout(() => wait(attempt + 1), 50);
  }
  wait();
})();
