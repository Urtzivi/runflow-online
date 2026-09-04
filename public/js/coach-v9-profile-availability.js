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
    flexible: 'Flexible',
  };
  let current = null;
  let currentAthleteId = '';

  const athleteId = () => q('#athleteSelect')?.value || (() => {
    try { return state?.athlete?.id || ''; } catch { return ''; }
  })();
  const apiCall = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
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

  function dayRow(day, stored = {}, strengthMode = 'runflow') {
    const mode = modeFromStored(stored, strengthMode);
    const disabled = mode === 'unavailable' || mode === 'undefined';
    return `<div class="v9-h-availability-row" data-v9h-day="${day[0]}">
      <b>${day[1]}</b>
      <label class="v9h-mode">Qué puede hacer
        <select data-v9h-mode>
          ${Object.entries(MODES).map(([value, label]) => `<option value="${value}" ${mode === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      <label>Tiempo máximo
        <span class="v9h-minutes"><input type="number" min="5" max="1440" step="5" data-v9h-minutes value="${stored.max_minutes ?? ''}" ${disabled ? 'disabled' : ''}><i>min</i></span>
      </label>
      <span class="v9h-rule">${ruleText(mode, stored.max_minutes)}</span>
    </div>`;
  }

  function ruleText(mode, minutes) {
    if (mode === 'undefined') return 'Completa este día';
    if (mode === 'unavailable') return 'RunFlow no colocará ninguna sesión';
    if (mode === 'gym') return 'Reserva exclusiva: no admite carrera ni series';
    if (mode === 'strength') return 'Solo fuerza creada por RunFlow';
    if (mode === 'trail') return 'Solo carrera con acceso a montaña';
    if (mode === 'run') return 'Solo sesiones de carrera';
    if (mode === 'bike') return 'Solo sesiones de bici';
    return minutes ? `Cualquier actividad compatible hasta ${minutes} min` : 'Cualquier actividad compatible';
  }

  function modeToDay(day, mode, maxMinutes) {
    const base = {
      day,
      activity_type: mode,
      can_train: mode !== 'unavailable',
      run: ['run', 'trail', 'flexible'].includes(mode),
      bike: ['bike', 'flexible'].includes(mode),
      strength: ['strength', 'gym', 'flexible'].includes(mode),
      gym: mode === 'gym',
      mountain: mode === 'trail',
      max_minutes: mode === 'unavailable' ? null : maxMinutes,
    };
    return base;
  }

  function dayForDate(dateValue, data = current) {
    const date = new Date(`${dateValue}T12:00:00`);
    const dayNumber = ((date.getDay() + 6) % 7) + 1;
    return (data?.availability?.days || []).find(item => Number(item.day) === dayNumber) || null;
  }

  function workoutKind(workout) {
    const text = `${workout?.sport || ''} ${workout?.title || ''} ${workout?.adaptation_target || ''}`.toLowerCase();
    if (workout?.is_strength || /strength|fuerza|gimnasio/.test(text)) return 'strength';
    if (/ride|bike|cycling|bici/.test(text)) return 'bike';
    if (/trail|montaña|mountain|desnivel/.test(text)) return 'trail';
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
    const mode = modeFromStored(day, data?.strength_mode);
    const title = workout?.title || 'La sesión';
    if (mode === 'unavailable' || day.can_train === false) return { ok: false, error: `No puedes colocar “${title}” el ${dayName}: el deportista no entrena ese día.` };
    const kind = workoutKind(workout);
    const allowed = mode === 'flexible'
      ? (kind === 'strength' ? day.strength !== false : kind === 'bike' ? day.bike === true : day.run !== false)
      : mode === 'run' ? kind === 'run'
        : mode === 'trail' ? kind === 'trail'
          : mode === 'bike' ? kind === 'bike'
            : ['strength', 'gym'].includes(mode) ? kind === 'strength'
              : false;
    if (!allowed) return { ok: false, error: `No puedes colocar “${title}” el ${dayName}: ese día está reservado para ${MODES[mode].toLowerCase()}.` };
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
    if (!id || !root) return;
    let card = q('#v9HierarchyAvailability');
    if (!card) {
      card = document.createElement('section');
      card.id = 'v9HierarchyAvailability';
      card.className = 'card v9-h-availability-card';
      const experience = [...root.querySelectorAll('.form-section')].find(section => section.querySelector('#availability'));
      if (experience) experience.insertAdjacentElement('afterend', card);
      else root.prepend(card);
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
        <p class="v9-h-profile-note">Elige una opción para los siete días. Si un lunes está reservado para gimnasio, RunFlow bloqueará una sesión de carrera o series ese lunes. El tiempo máximo se comprueba también en sesiones manuales, importadas y antes de publicar.</p>
        <div class="v9-av-head"><span>Día</span><span>Actividad permitida</span><span>Tiempo máximo</span><span>Regla aplicada</span></div>
        ${DAYS.map(day => dayRow(day, map.get(day[0]) || {}, data.strength_mode)).join('')}
        <div class="v9-load-ceiling"><label>Carga máxima semanal actual<input id="v9hMaxLoad" type="number" min="0" value="${data.max_load ?? ''}"></label><label>Fecha efectiva<input id="v9hEffectiveDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
        <div class="actions" style="margin-top:14px"><button id="v9hSaveAvailability" class="btn primary" type="button">Guardar disponibilidad</button><span id="v9hAvailabilityStatus" class="muted small"></span></div>
      </div>`;
    q('#v9DynamicProfile')?.classList.add('hidden');
    qa('[data-v9h-mode]', card).forEach(select => {
      select.addEventListener('change', () => {
        const row = select.closest('[data-v9h-day]');
        const input = q('[data-v9h-minutes]', row);
        const disabled = ['undefined', 'unavailable'].includes(select.value);
        input.disabled = disabled;
        if (select.value === 'unavailable') input.value = '';
        q('.v9h-rule', row).textContent = ruleText(select.value, input.value);
      });
    });
    qa('[data-v9h-minutes]', card).forEach(input => input.addEventListener('input', () => {
      const row = input.closest('[data-v9h-day]');
      q('.v9h-rule', row).textContent = ruleText(q('[data-v9h-mode]', row).value, input.value);
    }));
    q('#v9hSaveAvailability').onclick = save;
  }

  async function save() {
    const id = athleteId();
    if (!id) return;
    const rows = qa('[data-v9h-day]', q('#v9HierarchyAvailability'));
    const incomplete = rows.find(row => q('[data-v9h-mode]', row).value === 'undefined');
    if (incomplete) return notify(`Define qué ocurre el ${DAYS[Number(incomplete.dataset.v9hDay) - 1][1].toLowerCase()}.`, 'error');
    for (const row of rows) {
      const mode = q('[data-v9h-mode]', row).value;
      const value = q('[data-v9h-minutes]', row).value;
      if (mode !== 'unavailable' && (!value || Number(value) <= 0)) {
        return notify(`Indica el tiempo disponible del ${DAYS[Number(row.dataset.v9hDay) - 1][1].toLowerCase()}.`, 'error');
      }
    }
    const days = rows.map(row => {
      const mode = q('[data-v9h-mode]', row).value;
      const minutes = q('[data-v9h-minutes]', row).value === '' ? null : Number(q('[data-v9h-minutes]', row).value);
      return modeToDay(Number(row.dataset.v9hDay), mode, minutes);
    });
    const externalStrengthDays = days.filter(item => item.activity_type === 'gym').map(item => item.day);
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
    if (event.detail?.view === 'profileView') render();
  });
  window.addEventListener('runflow:v9-dynamic-ready', () => setTimeout(render, 0));
  window.addEventListener('runflow:v9-athlete-ready', () => {
    current = null;
    currentAthleteId = '';
    if (q('#profileView')?.classList.contains('active')) setTimeout(render, 50);
  });
  setTimeout(onView, 600);
})();
