(() => {
  'use strict';

  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const DAYS = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [7, 'Domingo']];
  const MODES = {
    undefined: 'Sin definir',
    unavailable: 'No entrena',
    run: 'Correr',
    trail: 'Trail / montaña',
    bike: 'Bici',
    strength: 'Fuerza programada por RunFlow',
    gym: 'Gimnasio / fuerza externa',
    walk: 'Paseo',
    flexible: 'Flexible',
  };
  // Opciones que se pueden marcar a la vez en cada día.
  const CHOICES = ['run', 'trail', 'bike', 'strength', 'gym', 'walk'];
  const CHIP = { run: 'Correr', trail: 'Trail', bike: 'Bici', strength: 'Fuerza RunFlow', gym: 'Fuerza en gimnasio (guiada)', walk: 'Paseo' };
  let current = null;
  let currentAthleteId = '';

  const athleteId = () => q('#athleteSelect')?.value || (() => {
    try { return state?.athlete?.id || ''; } catch { return ''; }
  })();
  const apiCall = async (url, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('La ficha está tardando demasiado en responder. Pulsa Reintentar.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
    return data;
  };
  const notify = (text, type = 'success') => {
    try { showMessage(text, type); } catch { window.alert(text); }
  };

  function modeFromStored(stored = {}, strengthMode = 'runflow') {
    const explicit = stored.activity_type || stored.mode;
    if (MODES[explicit]) return explicit;
    if (stored.can_train === false) return 'unavailable';
    if (stored.gym && stored.strength && stored.run === false) return 'gym';
    if (stored.strength && stored.run === false && stored.bike !== true) return strengthMode === 'external' ? 'gym' : 'strength';
    if (stored.bike && stored.run === false && stored.strength !== true) return 'bike';
    if (stored.run && stored.mountain) return 'trail';
    if (stored.run && stored.bike !== true && stored.strength !== true) return 'run';
    if (stored.can_train === true || stored.run || stored.bike || stored.strength) return 'flexible';
    return 'undefined';
  }

  function modesFromStored(stored = {}, strengthMode = 'runflow') {
    const explicit = Array.isArray(stored.activity_types) ? stored.activity_types.filter(mode => MODES[mode] && !['undefined', 'unavailable', 'flexible'].includes(mode)) : [];
    if (explicit.length) return explicit;
    const legacy = modeFromStored(stored, strengthMode);
    return ['undefined', 'unavailable', 'flexible'].includes(legacy) ? [legacy] : [legacy];
  }

  function selectedChoices(modes) {
    if (modes[0] === 'flexible') return ['run', 'bike', 'strength'];
    return modes.filter(mode => CHOICES.includes(mode));
  }

  function dayRow(day, stored = {}, strengthMode = 'runflow') {
    const modes = modesFromStored(stored, strengthMode);
    const selected = selectedChoices(modes);
    const state = selected.length ? selected : [modes[0] === 'undefined' ? 'undefined' : 'unavailable'];
    return `<div class="v9-h-availability-row" data-v9h-day="${day[0]}" data-v9h-defined="${modes[0] === 'undefined' ? 'no' : 'yes'}">
      <b>${day[1]}</b>
      <div class="v9h-mode v9h-chips" role="group" aria-label="Qué puede hacer el ${day[1].toLowerCase()}">
        ${CHOICES.map(value => `<label class="v9h-chip"><input type="checkbox" data-v9h-type value="${value}" ${selected.includes(value) ? 'checked' : ''}><span>${CHIP[value]}</span></label>`).join('')}
      </div>
      <label>Tiempo máximo
        <span class="v9h-minutes"><input type="number" min="5" max="1440" step="5" data-v9h-minutes value="${stored.max_minutes ?? ''}" ${selected.length ? '' : 'disabled'}><i>min</i></span>
      </label>
      <span class="v9h-rule">${ruleText(state, stored.max_minutes)}</span>
    </div>`;
  }

  const rowChoices = row => qa('[data-v9h-type]:checked', row).map(input => input.value);

  function ruleText(value, minutes) {
    const modes = Array.isArray(value) ? value.filter(Boolean) : [value];
    const mode = modes[0];
    if (mode === 'undefined') return 'Completa este día';
    if (!mode || mode === 'unavailable') return 'No entrena: RunFlow no colocará ninguna sesión';
    if (modes.length > 1) return `${modes.map(item => MODES[item]).join(' o ')}${minutes ? ` · máximo ${minutes} min` : ''}`;
    if (mode === 'gym') return 'Reserva exclusiva: no admite carrera ni series';
    if (mode === 'strength') return 'Solo fuerza creada por RunFlow';
    if (mode === 'trail') return 'Solo carrera con acceso a montaña';
    if (mode === 'run') return 'Solo sesiones de carrera';
    if (mode === 'bike') return 'Solo sesiones de bici';
    if (mode === 'walk') return 'Solo paseo (recuperación)';
    return minutes ? `Cualquier actividad compatible hasta ${minutes} min` : 'Cualquier actividad compatible';
  }

  function modesToDay(day, modes, maxMinutes) {
    const clean = [...new Set(modes.filter(Boolean))];
    const exclusive = !clean.length || clean[0] === 'unavailable' || clean[0] === 'undefined';
    const allowed = exclusive ? ['unavailable'] : clean;
    const legacyMode = allowed.length > 1 ? 'flexible' : allowed[0];
    const base = {
      day,
      activity_types: allowed,
      activity_type: legacyMode,
      can_train: legacyMode !== 'unavailable',
      run: allowed.some(mode => ['run', 'trail', 'flexible'].includes(mode)),
      bike: allowed.some(mode => ['bike', 'flexible'].includes(mode)),
      strength: allowed.some(mode => ['strength', 'gym', 'flexible'].includes(mode)),
      gym: allowed.includes('gym'),
      mountain: allowed.includes('trail'),
      walk: allowed.includes('walk'),
      max_minutes: legacyMode === 'unavailable' ? null : maxMinutes,
    };
    return base;
  }

  function dayForDate(dateValue, data = current) {
    const date = new Date(`${dateValue}T12:00:00`);
    const dayNumber = ((date.getDay() + 6) % 7) + 1;
    return (data?.availability?.days || []).find(item => Number(item.day) === dayNumber) || null;
  }

  function workoutKind(workout) {
    const declaredSport = String(workout?.sport || workout?.type || '').toLowerCase();
    const title = String(workout?.title || '').toLowerCase();
    if (workout?.is_strength || /strength|fuerza|gym|gimnasio/.test(declaredSport)) return 'strength';
    if (/walk|paseo|caminar/.test(declaredSport)) return 'walk';
    if (/ride|bike|cycling|bici|ciclismo/.test(declaredSport)) return 'bike';
    if (/trail|mountain|montaña/.test(declaredSport)) return 'trail';
    if (/run|running|correr|carrera/.test(declaredSport)) return /trail|montaña|mountain|desnivel/.test(title) ? 'trail' : 'run';
    if (/strength|fuerza|gimnasio/.test(title)) return 'strength';
    if (/ride|bike|cycling|bici|ciclismo/.test(title)) return 'bike';
    if (/trail|montaña|mountain|desnivel/.test(title)) return 'trail';
    return 'run';
  }

  function validateWithProfile(workout, data = current) {
    const availability = data?.availability || {};
    const days = Array.isArray(availability.days) ? availability.days : [];
    if (!availability.configured && !days.some(item => item?.activity_type || Object.prototype.hasOwnProperty.call(item || {}, 'can_train'))) return { ok: true };
    const day = dayForDate(workout?.workout_date, data);
    const date = new Date(`${workout?.workout_date}T12:00:00`);
    const dayName = DAYS[((date.getDay() + 6) % 7)]?.[1]?.toLowerCase() || 'día seleccionado';
    if (!day) return { ok: false, error: `La disponibilidad del ${dayName} no está definida en la ficha.` };
    const modes = modesFromStored(day, data?.strength_mode);
    const mode = modes[0];
    const multiple = Array.isArray(day.activity_types) && day.activity_types.length;
    const title = workout?.title || 'La sesión';
    if (mode === 'unavailable' || day.can_train === false) return { ok: false, error: `No puedes colocar “${title}” el ${dayName}: el deportista no entrena ese día.` };
    const kind = workoutKind(workout);
    const allowed = modes.length > 1 || multiple
      ? modes.some(item => item === kind || (kind === 'strength' && item === 'gym'))
      : mode === 'flexible'
      ? (kind === 'strength' ? day.strength !== false : kind === 'bike' ? day.bike === true : day.run !== false)
      : mode === 'run' ? kind === 'run'
        : mode === 'trail' ? kind === 'trail'
          : mode === 'bike' ? kind === 'bike'
            : ['strength', 'gym'].includes(mode) ? kind === 'strength'
              : mode === 'walk' ? kind === 'walk'
              : false;
    if (!allowed) return { ok: false, error: `No puedes colocar “${title}” el ${dayName}: ese día admite ${modes.map(item => MODES[item].toLowerCase()).join(' o ')}.` };
    const duration = Number(workout?.planned_duration_min);
    const maximum = Number(day.max_minutes);
    if (Number.isFinite(duration) && Number.isFinite(maximum) && maximum > 0 && duration > maximum) {
      return { ok: false, error: `“${title}” dura ${duration} min, pero el ${dayName} solo dispone de ${maximum} min.` };
    }
    return { ok: true };
  }

  async function load(force = false) {
    const id = athleteId();
    if (!id) return null;
    if (!force && current && currentAthleteId === id) return current;
    current = await apiCall(`/api/v9/coach/athletes/${encodeURIComponent(id)}/dynamic-profile`);
    currentAthleteId = id;
    return current;
  }

  async function validateWorkout(workout) {
    const data = await load();
    return validateWithProfile(workout, data);
  }

  async function render() {
    const id = athleteId();
    const root = q('#profileView .layout > .card .card-body') || q('#profileView');
    if (!root) return;
    let card = q('#v9HierarchyAvailability');
    if (!card) {
      card = document.createElement('section');
      card.id = 'v9HierarchyAvailability';
      card.className = 'card v9-h-availability-card';
      const experience = [...root.querySelectorAll('.form-section')].find(section => section.querySelector('#availability'));
      if (experience) experience.insertAdjacentElement('afterend', card);
      else root.prepend(card);
    }
    if (!id) {
      card.innerHTML = '<div class="notice">Selecciona un deportista para cargar su disponibilidad semanal.</div>';
      return;
    }
    let data;
    try {
      data = await load(true);
    } catch (error) {
      console.warn(error);
      card.innerHTML = `<div class="card-head"><div><p class="eyebrow">Disponibilidad semanal</p><h2>No se pudo cargar</h2><p>${String(error.message || 'Error al consultar la ficha del deportista.').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))}</p></div></div><div class="card-body"><button id="v9hRetryAvailability" class="btn secondary" type="button">Reintentar</button></div>`;
      q('#v9hRetryAvailability')?.addEventListener('click', render);
      return;
    }
    const map = new Map((data.availability?.days || []).map(item => [Number(item.day), item]));
    const complete = DAYS.every(day => modeFromStored(map.get(day[0]) || {}, data.strength_mode) !== 'undefined');
    card.innerHTML = `<div class="card-head"><div><p class="eyebrow">Disponibilidad semanal</p><h2>Qué puede hacer y cuánto tiempo tiene cada día</h2><p>Es una restricción del planificador, no una simple nota.</p></div><span class="badge ${complete ? '' : 'pending'}">${complete ? 'Completa' : 'Pendiente'}</span></div>
      <div class="card-body">
        <p class="v9-h-profile-note">Marca todo lo que puede hacer cada día (una o varias opciones). Si no marcas nada, ese día no entrena. Lo que no esté marcado quedará bloqueado. El tiempo máximo se comprueba también en sesiones manuales, importadas y antes de publicar.</p>
        <div class="v9-av-head"><span>Día</span><span>Qué puede hacer</span><span>Tiempo máximo</span><span>Regla aplicada</span></div>
        ${DAYS.map(day => dayRow(day, map.get(day[0]) || {}, data.strength_mode)).join('')}
        <div class="v9-load-ceiling"><label>Carga máxima semanal actual<input id="v9hMaxLoad" type="number" min="0" value="${data.max_load ?? ''}"></label><label>Fecha efectiva<input id="v9hEffectiveDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
        <div class="actions" style="margin-top:14px"><button id="v9hSaveAvailability" class="btn primary" type="button">Guardar disponibilidad</button><span id="v9hAvailabilityStatus" class="muted small"></span></div>
      </div>`;
    q('#v9DynamicProfile')?.classList.add('hidden');
    qa('[data-v9h-type]', card).forEach(input => input.addEventListener('change', () => {
      const row = input.closest('[data-v9h-day]');
      const minutes = q('[data-v9h-minutes]', row);
      // Fuerza RunFlow y fuerza guiada en gimnasio son dos formas de lo mismo: solo una por día.
      if (input.checked && ['strength', 'gym'].includes(input.value)) qa('[data-v9h-type]', row).forEach(other => { if (other !== input && ['strength', 'gym'].includes(other.value)) other.checked = false; });
      const choices = rowChoices(row);
      row.dataset.v9hDefined = 'yes';
      minutes.disabled = !choices.length;
      if (!choices.length) minutes.value = '';
      q('.v9h-rule', row).textContent = ruleText(choices.length ? choices : ['unavailable'], minutes.value);
    }));
    qa('[data-v9h-minutes]', card).forEach(input => input.addEventListener('input', () => {
      const row = input.closest('[data-v9h-day]');
      const choices = rowChoices(row);
      q('.v9h-rule', row).textContent = ruleText(choices.length ? choices : ['unavailable'], input.value);
    }));
    q('#v9hSaveAvailability').onclick = save;
  }

  async function save() {
    const id = athleteId();
    if (!id) return;
    const rows = qa('[data-v9h-day]', q('#v9HierarchyAvailability'));
    for (const row of rows) {
      const value = q('[data-v9h-minutes]', row).value;
      if (rowChoices(row).length && (!value || Number(value) <= 0)) {
        return notify(`Indica el tiempo disponible del ${DAYS[Number(row.dataset.v9hDay) - 1][1].toLowerCase()}.`, 'error');
      }
    }
    const days = rows.map(row => {
      const minutes = q('[data-v9h-minutes]', row).value === '' ? null : Number(q('[data-v9h-minutes]', row).value);
      return modesToDay(Number(row.dataset.v9hDay), rowChoices(row), minutes);
    });
    const externalStrengthDays = days.filter(item => item.activity_types?.includes('gym')).map(item => item.day);
    const payload = {
      availability: { configured: true, days, strength_mode: externalStrengthDays.length ? 'external' : 'runflow', external_strength_days: externalStrengthDays },
      strength_mode: externalStrengthDays.length ? 'external' : 'runflow',
      external_strength_days: externalStrengthDays,
      max_load: q('#v9hMaxLoad').value === '' ? null : Number(q('#v9hMaxLoad').value),
      effective_date: q('#v9hEffectiveDate').value,
    };
    const status = q('#v9hAvailabilityStatus');
    try {
      q('#v9hSaveAvailability').disabled = true;
      status.textContent = 'Guardando…';
      const response = await apiCall(`/api/v9/coach/athletes/${encodeURIComponent(id)}/dynamic-profile`, { method: 'PUT', body: JSON.stringify(payload) });
      current = response.dynamic;
      currentAthleteId = id;
      notify('Disponibilidad guardada. Desde ahora limita toda la planificación futura.');
      window.dispatchEvent(new CustomEvent('runflow:v9-availability-saved', { detail: { athleteId: id } }));
      await render();
    } catch (error) {
      status.textContent = error.message;
      notify(error.message, 'error');
    } finally {
      const button = q('#v9hSaveAvailability');
      if (button) button.disabled = false;
    }
  }

  function onView() {
    if (q('#profileView')?.classList.contains('active')) render();
  }

  function invalidateAndRender() {
    current = null;
    currentAthleteId = '';
    if (q('#profileView')?.classList.contains('active')) setTimeout(render, 0);
  }

  window.RunFlowAvailability = {
    load,
    validateWorkout,
    validateWithProfile,
    invalidate() { current = null; currentAthleteId = ''; },
  };
  document.addEventListener('click', event => {
    if (event.target.closest('[data-v8-view="profile"],[data-view="profile"]')) setTimeout(onView, 100);
  }, true);
  window.addEventListener('runflow:v9-view', event => {
    if (['profile', 'profileView'].includes(event.detail?.view)) render();
  });
  window.addEventListener('runflow:v9-dynamic-ready', () => setTimeout(render, 0));
  window.addEventListener('runflow:v9-athlete-ready', invalidateAndRender);
  q('#athleteSelect')?.addEventListener('change', invalidateAndRender);
  const profileView = q('#profileView');
  if (profileView) new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.attributeName === 'class') && profileView.classList.contains('active')) render();
  }).observe(profileView, { attributes: true, attributeFilter: ['class'] });
  setTimeout(onView, 600);
})();
