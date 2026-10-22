/*
 * RunFlow Coach · Planificación › "Crear plan guiado" (running).
 * Asistente de pocas preguntas que crea temporada, objetivo, macrociclo,
 * mesociclos, microciclos y las sesiones de las 2 primeras semanas en borrador.
 * El cálculo vive en running-guided-plan.js (RunFlowRunningPlan).
 */
(() => {
  'use strict';
  const P = window.RunFlowRunningPlan;
  if (!P) return;
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const appState = () => { try { return state; } catch { return null; } };
  const athleteId = () => appState()?.athlete?.id || '';
  const notify = (message, type = 'success') => { try { showMessage(message, type); } catch { window.alert(message); } };
  const apiCall = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
    return data;
  };
  const base = () => `/api/coach/athletes/${encodeURIComponent(athleteId())}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const SESSION_WEEKS = 2; // sesiones que se crean al principio; el resto, semana a semana

  const STEPS = [
    { key: 'race', q: '¿Qué carrera vais a preparar?', help: 'Es el objetivo principal de la temporada. Todo el plan se construye hacia atrás desde ese día.' },
    { key: 'date', q: '¿Cuándo es y qué queréis conseguir?', help: 'Si no tenéis una marca en mente, elige "Terminarla bien": el plan será algo más prudente.' },
    { key: 'athlete', q: '¿Cómo está el atleta ahora?', help: 'Si dudas, elige el nivel más bajo. Es mejor quedarse corto al principio que lesionarse.' },
    { key: 'week', q: '¿Qué días puede entrenar?', help: 'Marca los días y el tiempo máximo de cada uno. La tirada larga va el día con más tiempo.' },
    { key: 'summary', q: 'Así quedaría la temporada', help: 'Revisa el plan. Se crea como borrador: nada llega al atleta hasta que publiques cada semana.' },
  ];
  const MINUTES = [0, 30, 45, 60, 75, 90, 120, 150, 180];
  const ui = { open: false, step: 0, a: null, profile: null, library: null, busy: false, status: '', preview: null };

  // ---------- Datos ----------
  async function loadLibrary() {
    if (ui.library) return ui.library;
    const data = await apiCall('/api/v9/library');
    ui.library = data.sessions || [];
    return ui.library;
  }
  async function loadProfile() {
    try { ui.profile = window.RunFlowAvailability ? await window.RunFlowAvailability.load(true) : await apiCall(`/api/v9/coach/athletes/${encodeURIComponent(athleteId())}/dynamic-profile`); }
    catch { ui.profile = null; }
    return ui.profile;
  }
  // Ficha → días del asistente. La ficha guarda 'gym' para la fuerza con entrenador.
  const FROM_PROFILE = { run: 'run', trail: 'trail', bike: 'bike', strength: 'strength', gym: 'strength', walk: 'walk' };
  function profileDays(profile) {
    const days = profile?.availability?.days || [];
    const configured = profile?.availability?.configured || days.some(day => day && (day.activity_type || Object.prototype.hasOwnProperty.call(day, 'can_train')));
    if (!configured) return null;
    return [0, 1, 2, 3, 4, 5, 6].map(index => {
      const stored = days.find(day => Number(day.day) === index + 1) || {};
      const listed = Array.isArray(stored.activity_types) && stored.activity_types.length ? stored.activity_types : [stored.activity_type || (stored.can_train === false ? 'unavailable' : 'flexible')];
      let types = [...new Set(listed.flatMap(type => type === 'flexible' ? ['run', 'strength'] : FROM_PROFILE[type] ? [FROM_PROFILE[type]] : []))];
      if (stored.can_train === false) types = [];
      return { day: index, minutes: types.length ? Number(stored.max_minutes) || 60 : 0, types };
    });
  }
  const guidedGym = profile => (profile?.availability?.days || []).some(day => (day.activity_types || []).includes('gym') || day.activity_type === 'gym');
  function defaults() {
    const fromProfile = profileDays(ui.profile);
    const days = fromProfile || [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, minutes: [1, 3, 6].includes(day) ? (day === 6 ? 90 : 60) : 0, types: [1, 3].includes(day) ? ['run', 'strength'] : day === 6 ? ['run'] : [] }));
    const longest = days.filter(P.runsOn).sort((a, b) => b.minutes - a.minutes)[0];
    return {
      race: '', race_date: '', race_name: '', goal_mode: 'terminar', target_time: '', other_races: [],
      level: 'regular', injuries: '', days, long_day: longest ? longest.day : 6, strength: 2, equipment: guidedGym(ui.profile) ? 'gimnasio_guiado' : 'gimnasio',
      start_date: P.nextMonday(P.addDays(today(), 1)), from_profile: Boolean(fromProfile),
    };
  }

  // ---------- Pintado ----------
  function shell() {
    let root = q('#rgpModal');
    if (root) return root;
    document.body.insertAdjacentHTML('beforeend', '<div id="rgpModal" class="rgp-backdrop hidden" role="dialog" aria-modal="true" aria-label="Crear plan guiado"><section class="rgp-shell" id="rgpBody"></section></div>');
    root = q('#rgpModal');
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    return root;
  }
  function option(key, value, label, hint, current, extra = '') {
    return `<button type="button" class="rgp-opt${String(current) === String(value) ? ' on' : ''}" data-rgp-set="${key}" data-value="${esc(value)}"><b>${esc(label)}${extra}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</button>`;
  }
  function render() {
    const root = shell();
    root.classList.toggle('hidden', !ui.open);
    if (!ui.open) return;
    const step = STEPS[ui.step], a = ui.a;
    let body = '';
    if (step.key === 'race') {
      body = `<div class="rgp-opts">${Object.entries(P.RACES).map(([key, race]) => option('race', key, race.label, raceHint(key), a.race)).join('')}</div>`;
    } else if (step.key === 'date') {
      body = `<div class="rgp-grid2">
          <label class="rgp-f">Fecha de la carrera<input type="date" data-rgp-field="race_date" value="${esc(a.race_date)}" min="${esc(P.addDays(a.start_date, 7))}"></label>
          <label class="rgp-f">Nombre de la carrera (opcional)<input type="text" data-rgp-field="race_name" value="${esc(a.race_name)}" placeholder="Behobia, Media de Bilbao…"></label>
        </div>
        <h3>Objetivo</h3>
        <div class="rgp-opts">${option('goal_mode', 'terminar', 'Terminarla bien', 'Llegar sano y disfrutarla. Menos series duras.', a.goal_mode)}${option('goal_mode', 'marca', 'Hacer una marca', 'Busca un tiempo concreto. Más trabajo de ritmo.', a.goal_mode)}</div>
        ${a.goal_mode === 'marca' ? `<label class="rgp-f rgp-narrow">Tiempo objetivo (h:mm:ss o mm:ss)<input type="text" data-rgp-field="target_time" value="${esc(a.target_time)}" placeholder="1:45:00"></label>` : ''}
        <h3>Otras carreras antes (opcional)</h3>
        <div class="rgp-sub">Carreras que sirven de entrenamiento. Esa semana no se pone otra sesión dura.</div>
        ${a.other_races.map((race, i) => `<div class="rgp-row"><input type="text" data-rgp-other="${i}" data-key="name" value="${esc(race.name)}" placeholder="Nombre"><input type="date" data-rgp-other="${i}" data-key="date" value="${esc(race.date)}"><button type="button" class="rgp-btn small" data-rgp-act="other-remove" data-index="${i}">Quitar</button></div>`).join('')}
        <button type="button" class="rgp-btn" data-rgp-act="other-add">＋ Añadir carrera</button>`;
    } else if (step.key === 'athlete') {
      body = `<div class="rgp-opts">${Object.entries(P.LEVELS).map(([key, level]) => option('level', key, level.label, levelHint(key), a.level)).join('')}</div>
        <label class="rgp-f">¿Alguna molestia o lesión a vigilar? (opcional)<input type="text" data-rgp-field="injuries" value="${esc(a.injuries)}" placeholder="Fascitis el año pasado, rodilla derecha…"></label>`;
    } else if (step.key === 'week') {
      body = `${a.from_profile ? '<div class="rgp-info">Rellenado con la disponibilidad de su ficha. Si lo cambias aquí, también se actualizará la ficha.</div>' : '<div class="rgp-info">Su ficha todavía no tiene disponibilidad: lo que marques aquí se guardará en ella.</div>'}
        <h3>¿Qué puede hacer cada día?</h3>
        <div class="rgp-sub">Marca una o varias cosas por día y el tiempo que tiene. RunFlow solo pone carrera donde marques correr o trail, y fuerza donde marques fuerza. Bici y paseo quedan como propuesta.</div>
        <div class="rgp-days">${a.days.map(day => `<div class="rgp-day${day.minutes ? ' on' : ''}"><b>${P.DAYS[day.day]}</b>
          <div class="rgp-acts">${Object.entries(P.ACTIVITIES).map(([type, label]) => `<button type="button" class="rgp-act${P.canDo(day, type) ? ' on' : ''}" data-rgp-type="${type}" data-day="${day.day}" aria-pressed="${P.canDo(day, type)}">${label}</button>`).join('')}</div>
          <select data-rgp-day="${day.day}" aria-label="Tiempo del ${P.DAYS[day.day].toLowerCase()}">${MINUTES.map(m => `<option value="${m}" ${Number(day.minutes) === m ? 'selected' : ''}>${m ? `${m} min` : 'Descansa'}</option>`).join('')}</select>
          ${P.runsOn(day) ? `<button type="button" class="rgp-long${Number(a.long_day) === day.day ? ' on' : ''}" data-rgp-long="${day.day}">${Number(a.long_day) === day.day ? '★ Tirada larga' : 'Tirada larga aquí'}</button>` : ''}</div>`).join('')}</div>
        <h3>Fuerza</h3>
        <div class="rgp-sub">La fuerza va dentro del plan: cambia en cada bloque (aprender, ganar fuerza, potencia, mantener) y se coloca sola para no quitar piernas a las sesiones importantes.</div>
        <div class="rgp-opts rgp-opts3" style="margin-top:8px">${option('strength', 0, 'Ninguna', 'La hace por su cuenta. Corre más riesgo de lesión.', a.strength)}${option('strength', 1, '1 a la semana', 'Lo mínimo para prevenir lesiones.', a.strength)}${option('strength', 2, '2 a la semana', 'Lo ideal: mejora la economía de carrera.', a.strength, ' <span class="rgp-tag">Recomendado</span>')}</div>
        ${a.strength && strengthDayCount(a) < a.strength ? `<div class="rgp-warn">${strengthDayCount(a) ? `Solo hay ${strengthDayCount(a)} ${strengthDayCount(a) === 1 ? 'día' : 'días'} con Fuerza marcada: RunFlow pondrá como mucho ${strengthDayCount(a) === 1 ? 'una sesión' : 'esas'}.` : 'Marca Fuerza en algún día para que RunFlow la pueda colocar.'}</div>` : ''}
        ${a.strength ? `<h3>¿Dónde la hace?</h3><div class="rgp-opts rgp-opts3">${Object.entries(P.EQUIPMENT).map(([key, item]) => option('equipment', key, item.label, item.hint, a.equipment)).join('')}</div>` : ''}
        <label class="rgp-f rgp-narrow">El plan empieza el lunes<input type="date" data-rgp-field="start_date" value="${esc(a.start_date)}" step="7"></label>`;
    } else body = renderSummary();
    const last = ui.step === STEPS.length - 1;
    const blocked = stepError();
    q('#rgpBody').innerHTML = `
      <header class="rgp-head"><div><div class="rgp-eyebrow">Plan guiado de running · paso ${ui.step + 1} de ${STEPS.length}</div><h2>${esc(step.q)}</h2><div class="rgp-sub">${esc(step.help)}</div></div><button type="button" class="rgp-btn" data-rgp-act="close" ${ui.busy ? 'disabled' : ''}>Cerrar</button></header>
      <div class="rgp-progress"><i style="width:${Math.round((ui.step + 1) / STEPS.length * 100)}%"></i></div>
      <div class="rgp-content">${body}</div>
      <footer class="rgp-actions">${ui.step ? `<button type="button" class="rgp-btn" data-rgp-act="back" ${ui.busy ? 'disabled' : ''}>‹ Atrás</button>` : ''}<span class="rgp-status ${ui.status.startsWith('Error') ? 'err' : ''}">${esc(blocked && !last ? blocked : ui.status)}</span>
        ${last ? `<button type="button" class="rgp-btn lime" data-rgp-act="create" ${ui.busy || ui.preview?.error ? 'disabled' : ''}>${ui.busy ? 'Creando…' : 'Crear plan en borrador'}</button>` : `<button type="button" class="rgp-btn dark" data-rgp-act="next" ${blocked ? 'disabled' : ''}>Siguiente ›</button>`}</footer>`;
  }
  function raceHint(key) {
    return ({ '5K': 'Velocidad y ritmo alto.', '10K': 'Umbral y velocidad.', media: 'Resistencia y umbral.', maraton: 'Mucha base y tiradas largas.', trail_corto: 'Cuestas y ritmo en montaña.', trail_largo: 'Horas en montaña, subir y bajar.' })[key] || '';
  }
  function levelHint(key) {
    return ({ nuevo: 'Corre poco o lleva menos de 6 meses. Sesiones suaves y una sola de calidad.', regular: 'Corre 3-4 días por semana desde hace tiempo.', experto: 'Ha preparado carreras antes y aguanta 2 sesiones de calidad.' })[key] || '';
  }
  const strengthDayCount = a => a.days.filter(day => P.canDo(day, 'strength')).length;
  function stepError() {
    const a = ui.a, key = STEPS[ui.step].key;
    if (key === 'race' && !a.race) return 'Elige una carrera.';
    if (key === 'date') {
      if (!a.race_date) return 'Indica la fecha de la carrera.';
      if (a.race_date < P.addDays(a.start_date, 6)) return 'La carrera tiene que ser después de la primera semana del plan.';
      if (a.goal_mode === 'marca' && a.target_time && !P.parseTime(a.target_time)) return 'Escribe el tiempo como 1:45:00 o 45:00.';
    }
    if (key === 'week') {
      const days = a.days.filter(P.runsOn).length;
      if (days < 2) return 'Marca correr o trail en al menos 2 días.';
      if (a.strength && !strengthDayCount(a)) return 'Marca Fuerza en algún día, o elige "Ninguna" en fuerza.';
    }
    return '';
  }

  function renderSummary() {
    const a = ui.a;
    let structure;
    try { structure = P.buildStructure(a); }
    catch (error) { ui.preview = { error: error.message }; return `<div class="rgp-warn">${esc(error.message)}</div>`; }
    const sessions = structure.weeks.slice(0, SESSION_WEEKS).map(week => ({ week, items: P.buildWeekSessions(a, structure, week, ui.library || []) }));
    ui.preview = { structure, sessions };
    const seasons = (appState()?.seasons || []).filter(season => season.start_date <= structure.end && season.end_date >= structure.start);
    const total = structure.weeks.length;
    const trainDays = a.days.filter(P.runsOn).map(day => P.DAYS_SHORT[day.day]).join(', ');
    return `<div class="rgp-lead">${esc(structure.summary)}</div>
      ${structure.warnings.map(text => `<div class="rgp-warn">${esc(text)}</div>`).join('')}
      ${seasons.length ? `<div class="rgp-warn">Ya tiene ${seasons.length === 1 ? `la temporada “${esc(seasons[0].name)}”` : `${seasons.length} temporadas`} en esas fechas. Si alguna semana ya está planificada, RunFlow no la pisará y te avisará.</div>` : ''}
      <h3>Macrociclo y mesociclos</h3>
      <div class="rgp-sub">Cada fila es un bloque (mesociclo) y cada cuadro una semana (microciclo). Pasa el ratón por un cuadro para ver por qué es así.</div>
      <div class="rgp-map" style="--weeks:${total}">
        <div class="rgp-map-head"><span></span><div class="rgp-map-weeks">${structure.weeks.map(week => `<i>${week.index}</i>`).join('')}</div></div>
        ${structure.mesos.map(meso => `<div class="rgp-map-row"><div><b>${esc(meso.name)} · ${meso.weeks.length} ${meso.weeks.length === 1 ? 'semana' : 'semanas'}</b><small>${esc(meso.goal)}</small>${a.strength && meso.strength.perWeek ? `<small class="rgp-str">Fuerza: ${esc(meso.strength.name.toLowerCase())} · ${meso.strength.perWeek}/semana</small>` : ''}</div>
          <div class="rgp-map-weeks">${structure.weeks.map(week => meso.weeks.includes(week) ? `<span class="rgp-wk t-${week.type}" title="Semana ${week.index} · ${esc(P.formatDate(week.start))} · ${esc(week.label)} · ${week.minutes} min${week.strength_sessions ? ` + ${week.strength_sessions} de fuerza` : ''}. ${esc(week.why)}"></span>` : '<span></span>').join('')}</div></div>`).join('')}
        <div class="rgp-legend"><span><i class="t-load"></i>Carga</span><span><i class="t-overload"></i>Semana más exigente</span><span><i class="t-deload"></i>Descarga</span><span><i class="t-competition"></i>Puesta a punto y carrera</span></div>
      </div>
      ${a.strength ? `<h3>Fuerza a lo largo de la temporada</h3>
      <div class="rgp-strength">${structure.mesos.filter(meso => meso.strength.perWeek).map(meso => `<div><b>${esc(meso.name)} → ${esc(meso.strength.name)}</b><span>${esc(meso.strength.goal)}</span><small>${esc(meso.strength.effort)}</small></div>`).join('')}</div>
      <ul class="rgp-rules">${P.STRENGTH_RULES.map(rule => `<li>${esc(rule)}</li>`).join('')}</ul>` : '<div class="rgp-warn">Sin fuerza en el plan. Si la hace por su cuenta, que no sea el día antes de las sesiones de calidad ni de la tirada larga.</div>'}
      <details class="rgp-why"><summary>¿Por qué este orden?</summary>${structure.mesos.map(meso => `<p><b>${esc(meso.name)}.</b> ${esc(meso.why)} <em>Ha funcionado si: ${esc(meso.success.charAt(0).toLowerCase() + meso.success.slice(1))}</em></p>`).join('')}</details>
      <h3>Las ${SESSION_WEEKS} primeras semanas</h3>
      <div class="rgp-sub">Sesiones de la biblioteca RunFlow con la intensidad en RPE (del 1 al 10). El resto de semanas se preparan más adelante, según cómo vaya.</div>
      ${!ui.library ? '<div class="rgp-info">Cargando la biblioteca de sesiones…</div>' : sessions.map(({ week, items }) => `<div class="rgp-week"><div class="rgp-week-head"><b>Semana ${week.index} · ${esc(P.formatDate(week.start))} – ${esc(P.formatDate(week.end))}</b><span>${esc(week.label)} · ≈ ${week.minutes} min</span></div>
        ${items.length ? `<table class="rgp-table"><tbody>${items.map(item => `<tr${item.optional ? ' class="rgp-optional"' : ''}><td>${P.DAYS_SHORT[P.dayIndex(item.workout_date)]}</td><td><b>${esc(item.title)}</b><small>${esc(item.summary)}</small></td><td>${item.planned_duration_min || '—'} min</td></tr>`).join('')}</tbody></table>` : '<div class="rgp-sub">Sin sesiones: revisa los días disponibles.</div>'}</div>`).join('')}
      <div class="rgp-info">Se guardará en su ficha lo que puede hacer cada día: corre ${esc(trainDays)}${strengthDayCount(a) ? `, fuerza ${esc(a.days.filter(day => P.canDo(day, 'strength')).map(day => P.DAYS_SHORT[day.day]).join(', '))}` : ''}${a.strength ? `, con hasta ${a.strength} ${a.strength === 1 ? 'sesión' : 'sesiones'} de fuerza a la semana (${esc(P.EQUIPMENT[a.equipment]?.label.toLowerCase() || '')})` : ''}. Si pierde días o semanas, el plan se podrá recalcular desde ese punto sin mover la carrera.</div>`;
  }

  // ---------- Eventos ----------
  async function open() {
    if (!athleteId()) return notify('Selecciona primero un deportista.', 'error');
    ui.open = true; ui.step = 0; ui.status = ''; ui.preview = null; ui.busy = false;
    ui.a = defaults(); render();
    await loadProfile();
    ui.a = { ...defaults(), race: ui.a.race };
    render();
    loadLibrary().then(() => { if (ui.open && STEPS[ui.step].key === 'summary') render(); }).catch(error => { ui.status = `Error: no se pudo cargar la biblioteca (${error.message}).`; render(); });
  }
  function onClick(event) {
    const el = event.target.closest('[data-rgp-set],[data-rgp-act],[data-rgp-long],[data-rgp-type]');
    if (!el || ui.busy) return;
    const a = ui.a;
    if (el.dataset.rgpSet) {
      const key = el.dataset.rgpSet, raw = el.dataset.value;
      a[key] = key === 'strength' ? Number(raw) : raw;
      if (['race', 'level'].includes(key) && !stepError()) ui.step = Math.min(STEPS.length - 1, ui.step + 1);
      render(); return;
    }
    if (el.dataset.rgpLong) { a.long_day = Number(el.dataset.rgpLong); render(); return; }
    if (el.dataset.rgpType) {
      const day = a.days.find(item => item.day === Number(el.dataset.day)), type = el.dataset.rgpType;
      const types = P.dayTypes(day);
      day.types = types.includes(type) && day.minutes ? types.filter(item => item !== type) : [...new Set([...(day.minutes ? types : []), type])];
      if (day.types.length && !day.minutes) day.minutes = 60;
      if (!day.types.length) day.minutes = 0;
      fixLongDay(a); render(); return;
    }
    const act = el.dataset.rgpAct;
    if (act === 'close') { ui.open = false; render(); return; }
    if (act === 'back') { ui.step = Math.max(0, ui.step - 1); ui.status = ''; render(); return; }
    if (act === 'next') { if (!stepError()) { ui.step = Math.min(STEPS.length - 1, ui.step + 1); ui.status = ''; } render(); return; }
    if (act === 'other-add') { a.other_races.push({ name: '', date: '' }); render(); return; }
    if (act === 'other-remove') { a.other_races.splice(Number(el.dataset.index), 1); render(); return; }
    if (act === 'create') create();
  }
  function onChange(event) {
    const el = event.target, a = ui.a;
    if (el.type === 'text') return; // los textos se guardan al escribir; repintar aquí se come el siguiente clic
    if (el.dataset.rgpField) { a[el.dataset.rgpField] = el.dataset.rgpField === 'start_date' && el.value ? P.nextMonday(el.value) : el.value; render(); return; }
    if (el.dataset.rgpDay !== undefined) {
      const day = a.days.find(item => item.day === Number(el.dataset.rgpDay));
      day.minutes = Number(el.value);
      if (!day.minutes) day.types = [];
      else if (!P.dayTypes(day).length) day.types = ['run'];
      fixLongDay(a); render(); return;
    }
    if (el.dataset.rgpOther !== undefined) { a.other_races[Number(el.dataset.rgpOther)][el.dataset.key] = el.value; render(); }
  }
  function fixLongDay(a) {
    if (a.days.some(day => day.day === Number(a.long_day) && P.runsOn(day))) return;
    const longest = a.days.filter(P.runsOn).sort((x, y) => y.minutes - x.minutes)[0];
    a.long_day = longest ? longest.day : 6;
  }
  function onInput(event) {
    const el = event.target;
    if (el.dataset.rgpField && el.type === 'text') ui.a[el.dataset.rgpField] = el.value;
    if (el.dataset.rgpOther !== undefined && el.type === 'text') ui.a.other_races[Number(el.dataset.rgpOther)][el.dataset.key] = el.value;
  }

  // ---------- Crear ----------
  // Asistente → ficha. Mismo formato que la disponibilidad de la ficha (activity_types + banderas antiguas).
  function availabilityPayload(a) {
    const days = a.days.map(day => {
      const types = P.dayTypes(day).map(type => type === 'strength' && a.equipment === 'gimnasio_guiado' ? 'gym' : type);
      if (!day.minutes || !types.length) return { day: day.day + 1, activity_types: ['unavailable'], activity_type: 'unavailable', can_train: false, run: false, bike: false, strength: false, gym: false, mountain: false, walk: false, max_minutes: null };
      return {
        day: day.day + 1, activity_types: types, activity_type: types.length > 1 ? 'flexible' : types[0], can_train: true,
        run: types.some(type => ['run', 'trail'].includes(type)), bike: types.includes('bike'), strength: types.some(type => ['strength', 'gym'].includes(type)),
        gym: types.includes('gym'), mountain: types.includes('trail'), walk: types.includes('walk'), max_minutes: day.minutes,
      };
    });
    const external = days.filter(day => day.gym).map(day => day.day);
    const strengthMode = external.length ? 'external' : 'runflow';
    return { availability: { ...(ui.profile?.availability || {}), configured: true, days, strength_mode: strengthMode, external_strength_days: external }, strength_mode: strengthMode, external_strength_days: external };
  }
  async function takenWeeks(structure) {
    const seasons = (appState()?.seasons || []).filter(item => item.start_date <= structure.end && item.end_date >= structure.start);
    const starts = new Set(structure.weeks.map(week => week.start));
    const taken = [];
    for (const item of seasons) {
      const plan = await apiCall(`${base()}/plan?season_id=${encodeURIComponent(item.id)}`);
      (plan.macrocycles || []).forEach(macro => (macro.mesocycles || []).forEach(meso => (meso.microcycles || []).forEach(micro => {
        if (starts.has(micro.start_date)) taken.push({ start: micro.start_date, season: item.name });
      })));
    }
    return taken.sort((a, b) => a.start.localeCompare(b.start));
  }
  async function create() {
    const a = ui.a, preview = ui.preview;
    if (!preview?.structure || !ui.library) return;
    const structure = preview.structure;
    ui.busy = true; ui.status = 'Comprobando que no pisa semanas ya planificadas…'; render();
    let season = null;
    try {
      const taken = await takenWeeks(structure);
      if (taken.length) {
        ui.busy = false;
        ui.status = `Error: ${taken.length === 1 ? 'la semana' : 'las semanas'} del ${taken.slice(0, 3).map(item => P.formatDate(item.start)).join(', ')} ya ${taken.length === 1 ? 'está planificada' : 'están planificadas'} en “${taken[0].season}”. Borra esa temporada o empieza el plan después.`;
        render(); return;
      }
    } catch { /* si no se puede comprobar, el servidor lo impedirá igualmente */ }
    ui.status = 'Guardando la disponibilidad…'; render();
    const step = text => { ui.status = text; const status = q('#rgpBody .rgp-status'); if (status) status.textContent = text; };
    try {
      await apiCall(`/api/v9/coach/athletes/${encodeURIComponent(athleteId())}/dynamic-profile`, { method: 'PUT', body: JSON.stringify(availabilityPayload(a)) });
      window.RunFlowAvailability?.invalidate?.();
      step('Creando la temporada y el objetivo…');
      season = (await apiCall(`${base()}/seasons`, { method: 'POST', body: JSON.stringify(P.seasonPayload(a, structure)) })).season;
      const goals = [];
      for (const goal of P.goalPayloads(a, structure, season.id)) goals.push((await apiCall(`${base()}/goals`, { method: 'POST', body: JSON.stringify(goal) })).goal);
      step('Creando el macrociclo…');
      const macro = (await apiCall(`${base()}/seasons/${encodeURIComponent(season.id)}/macrocycles`, { method: 'POST', body: JSON.stringify(P.macroPayload(a, structure, goals[0]?.id)) })).macrocycle;
      let done = 0;
      for (const meso of structure.mesos) {
        step(`Creando ${meso.name} (${++done} de ${structure.mesos.length})…`);
        const saved = (await apiCall(`${base()}/macrocycles/${encodeURIComponent(macro.id)}/mesocycles`, { method: 'POST', headers: { 'X-RunFlow-Planning-Origin': 'guided' }, body: JSON.stringify(P.mesoPayload(meso)) })).mesocycle;
        for (const week of meso.weeks) {
          const planned = preview.sessions.find(item => item.week === week);
          const workouts = planned ? planned.items : null;
          await apiCall(`${base()}/mesocycles/${encodeURIComponent(saved.id)}/microcycles`, { method: 'POST', headers: { 'X-RunFlow-Planning-Origin': 'guided' }, body: JSON.stringify(P.microPayload(meso, week, workouts, a)) });
        }
      }
      step('Plan creado.');
      ui.busy = false; ui.open = false; render();
      appState().selectedSeasonId = season.id;
      if (typeof window.loadPlan === 'function') await window.loadPlan(season.id);
      notify(`Plan creado: ${structure.weeks.length} semanas en ${structure.mesos.length} bloques, con las sesiones de las ${SESSION_WEEKS} primeras semanas en borrador.`, 'success');
    } catch (error) {
      let message = error.message;
      if (season) {
        try { await apiCall(`${base()}/seasons/${encodeURIComponent(season.id)}`, { method: 'DELETE' }); message += ' No se ha guardado nada del plan.'; }
        catch { message += ` Ha quedado a medias la temporada “${season.name}”: bórrala desde Planificación antes de reintentar.`; }
      }
      ui.busy = false; ui.status = `Error: ${message}`; render();
    }
  }

  // ---------- Entrada en Planificación ----------
  function injectEntry() {
    const body = q('#v10PlannerBody');
    if (!body || q('#rgpEntry', body)) return;
    const atSeason = q('[data-v10-action="new-macro"]', body) || q('.v10-empty [data-v10-action="new-season"]', body);
    if (!atSeason) return;
    const guided = (appState()?.plan?.macrocycles || []).find(macro => P.readAnswers(macro.notes));
    const card = document.createElement('section');
    card.id = 'rgpEntry';
    card.className = 'rgp-entry';
    card.innerHTML = guided
      ? `<div><span class="rgp-eyebrow">Plan guiado</span><strong>${esc(guided.name)}</strong><p>Esta temporada se creó con el asistente. Puedes editar cualquier bloque, semana o sesión como siempre.</p></div><button type="button" class="btn secondary" data-rgp-open>Crear otro plan guiado</button>`
      : `<div><span class="rgp-eyebrow">¿No sabes por dónde empezar?</span><strong>Crear plan guiado</strong><p>Responde 4 preguntas (carrera, fecha, nivel y días libres) y RunFlow prepara la temporada entera: bloques, semanas y las primeras sesiones.</p></div><button type="button" class="btn primary" data-rgp-open>Crear plan guiado</button>`;
    body.prepend(card);
  }
  document.addEventListener('click', event => { if (event.target.closest('[data-rgp-open]')) open(); });
  const observer = new MutationObserver(() => injectEntry());
  function watch() {
    const panel = q('#v10SeasonPlanner');
    if (!panel) return setTimeout(watch, 400);
    observer.observe(panel, { childList: true, subtree: true });
    injectEntry();
  }
  watch();
  window.RunFlowRunningGuidedPlan = { open };
})();
