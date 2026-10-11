// RunFlow Coach · Fútbol: semana del deportista, partidos, circuitos de fuerza y carga y estado.
// Guarda en el mismo programa de fútbol del deportista (football-program) solo las partes schedule y strength.
(() => {
  const VIEW = 'football';
  const S = window.RunFlowFootballSchedule;
  if (!S) return;
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const fmt = n => n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Math.round(Number(n)).toLocaleString('es-ES');
  const dayDate = iso => { const s = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00`)).replace(/\./g, '').replace(',', ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  const shortDate = iso => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(`${iso}T12:00:00`)).replace('.', '');
  const longDate = iso => { const s = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${iso}T12:00:00`)).replace('.', ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  const COLORS = { football_training: '#2f6fb0', match: '#c2413b', strength: '#b8661a' };

  const ui = {
    tab: 'week', athleteId: '', loading: false, data: null, program: null, saveTimer: null, saving: false, status: '', statusKind: '',
    edit: null, // { day, index } en la semana tipo
    eventForm: { kind: 'match', date: '', time: '', rival: '', home: true, duration_min: 70, importance: 'league', cancel_kind: 'football_training', strength_id: '', note: '' },
    block: null, station: 0, newMenu: false, copyMenu: null, mode: null,
  };

  async function api(url, options = {}) {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo completar la operación.');
    return d;
  }
  const selectedAthleteId = () => byId('athleteSelect')?.value || '';
  const athleteName = () => { const o = byId('athleteSelect')?.selectedOptions?.[0]; return o ? o.textContent.trim() : ''; };
  const isActive = () => byId('footballView')?.classList.contains('active');

  // ---------- montaje ----------
  function mount() {
    const shell = document.querySelector('main.shell');
    const tabs = shell?.querySelector('.tabs');
    const athleteNav = byId('v8AthleteNav');
    if (!shell || !tabs || !athleteNav || typeof window.switchView !== 'function') return false;
    if (byId('footballView')) return true;
    if (!document.querySelector('link[href^="/css/coach-football-week.css"]')) {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/coach-football-week.css?v=1.0.0'; document.head.appendChild(link);
    }
    const tab = document.createElement('button');
    tab.className = 'tab'; tab.dataset.view = VIEW; tab.type = 'button'; tab.textContent = 'Fútbol';
    tab.addEventListener('click', () => window.switchView(VIEW));
    tabs.appendChild(tab);
    const view = document.createElement('section');
    view.id = 'footballView'; view.className = 'view'; view.style.marginTop = '18px';
    view.innerHTML = '<div id="fwRoot" class="fw"></div>';
    (byId('evolutionView') || byId('athletesView') || shell.querySelector('.view:last-of-type')).after(view);
    const navButton = document.createElement('button');
    navButton.type = 'button'; navButton.dataset.v8 = VIEW; navButton.id = 'v8FootballNav';
    navButton.innerHTML = '<span class="ico">⚽</span><span>Fútbol</span>';
    navButton.addEventListener('click', () => {
      document.querySelectorAll('.v8-nav button').forEach(button => button.classList.toggle('active', button === navButton));
      tab.click();
    });
    const evo = byId('v8EvolutionNav');
    if (evo) evo.after(navButton); else athleteNav.prepend(navButton);
    new MutationObserver(() => { if (isActive()) ensureLoaded(); }).observe(view, { attributes: true, attributeFilter: ['class'] });
    byId('athleteSelect')?.addEventListener('change', () => { if (isActive()) ensureLoaded(); else ui.data = null; });
    root().addEventListener('click', onClick);
    root().addEventListener('input', onInput);
    root().addEventListener('change', onChange);
    return true;
  }
  const root = () => byId('fwRoot');

  async function ensureLoaded(force = false) {
    const athleteId = selectedAthleteId();
    if (!athleteId) { root().innerHTML = '<div class="fw-card fw-empty">Selecciona un deportista.</div>'; return; }
    if (!force && ui.data && ui.athleteId === athleteId) return;
    if (ui.loading === athleteId) return;
    if (ui.saveTimer) await flushSave();
    ui.loading = athleteId; ui.athleteId = athleteId;
    if (!ui.data) root().innerHTML = '<div class="fw-card fw-empty">Cargando la semana de fútbol…</div>';
    try {
      const id = encodeURIComponent(athleteId);
      const [week, summary] = await Promise.all([api(`/api/coach/athletes/${id}/football-week`), api(`/api/coach/athletes/${id}/football-summary`).catch(() => null)]);
      if (ui.athleteId !== athleteId) return;
      ui.data = week; ui.mode = summary ? !!summary.mode : null;
      ui.program = { schedule: week.schedule || { week: [[], [], [], [], [], [], []], events: [] }, strength: clone(week.strength || []) };
      if (!ui.program.schedule.week) ui.program.schedule.week = [[], [], [], [], [], [], []];
      if (!ui.program.schedule.events) ui.program.schedule.events = [];
      ui.block = ui.program.strength[0]?.id || null; ui.station = 0; ui.edit = null; ui.status = ''; ui.newMenu = false; ui.copyMenu = null;
      render();
    } catch (error) {
      root().innerHTML = `<div class="fw-card fw-empty">${esc(error.message)}</div>`;
    } finally { if (ui.loading === athleteId) ui.loading = false; }
  }

  // ---------- guardado automático ----------
  function changed(rerender = true) {
    ui.status = 'Guardando…'; ui.statusKind = '';
    clearTimeout(ui.saveTimer);
    ui.saveTimer = setTimeout(flushSave, 700);
    if (rerender) render(); else paintStatus();
  }
  async function flushSave() {
    clearTimeout(ui.saveTimer); ui.saveTimer = null;
    if (!ui.athleteId || !ui.program) return;
    const athleteId = ui.athleteId;
    try {
      ui.saving = true;
      await api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/football-program`, { method: 'PUT', body: JSON.stringify({ program: { schedule: ui.program.schedule, strength: ui.program.strength } }) });
      if (ui.athleteId !== athleteId) return;
      ui.status = `Guardado ✓ El deportista ya lo ve en su app.`; ui.statusKind = 'ok';
      const week = await api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/football-week`);
      if (ui.athleteId === athleteId && week.schedule?.start) ui.program.schedule.start = week.schedule.start;
      if (ui.athleteId === athleteId && !ui.saveTimer) { ui.data = week; render(); }
    } catch (error) { ui.status = error.message; ui.statusKind = 'err'; paintStatus(); }
    finally { ui.saving = false; }
  }
  function paintStatus() { const el = byId('fwStatus'); if (el) { el.textContent = ui.status; el.className = `fw-status ${ui.statusKind}`; } }
  window.addEventListener('beforeunload', event => { if (ui.saveTimer) { flushSave(); event.preventDefault(); event.returnValue = ''; } });

  // Plan resuelto en el navegador con el programa que se está editando (para ver los cambios al momento).
  function plan(from, to) {
    const days = S.resolvePlan(ui.program, from, to);
    return S.attachRatings(days, ui.data?.logs || [], ui.data?.today || S.todayMadrid());
  }
  const blockById = id => ui.program.strength.find(b => b.id === id);
  const blockDays = id => ui.program.schedule.week.map((items, d) => items.some(i => i.kind === 'strength' && i.strength_id === id) ? d : -1).filter(d => d >= 0);

  // ---------- render ----------
  const TITLES = {
    week: ['Semana de fútbol', 'Marca cuándo entrena con su equipo, cuándo juega y qué día hace fuerza. La app del deportista se monta sola con esto.'],
    strength: ['Bloques de fuerza', 'Crea los circuitos de fuerza y decide en qué día de la semana va cada uno. El deportista los ve en su app el día que toca.'],
    load: ['Carga y estado', 'Lo que el deportista valora después de cada entreno, partido o fuerza. Carga = minutos × esfuerzo (RPE).'],
  };
  function render() {
    if (!root() || !ui.program) return;
    const [title, sub] = TITLES[ui.tab];
    const modeHtml = ui.mode === null ? '' : ui.mode
      ? '<span class="fw-tag good">Fútbol activado</span> <a class="fw-btn small" href="/football" target="_blank" rel="noopener">Abrir app de fútbol</a>'
      : '<button class="fw-btn lime small" data-act="mode-on">Activar módulo de fútbol</button>';
    root().innerHTML = `
      <div class="fw-head"><div><div class="fw-eyebrow">Módulo fútbol · ${esc(athleteName())}</div><h1>${title}</h1><p>${sub}</p></div>
        <div class="fw-mode">${modeHtml}</div></div>
      <div class="fw-head" style="align-items:center"><div class="fw-tabs">
        ${[['week', 'Semana'], ['strength', 'Fuerza'], ['load', 'Carga y estado']].map(([k, l]) => `<button data-tab="${k}" class="${ui.tab === k ? 'on' : ''}">${l}</button>`).join('')}
        <button data-act="content">Contenido (Entreno, Terraza, Retos)</button></div>
        <span id="fwStatus" class="fw-status ${ui.statusKind}">${esc(ui.status)}</span></div>
      ${ui.tab === 'week' ? renderWeek() : ui.tab === 'strength' ? renderStrength() : renderLoad()}`;
    if (ui.tab === 'load') drawCharts();
  }

  // ---------- Semana ----------
  function itemMeta(item) {
    const parts = [];
    if (item.kind === 'strength') { const b = blockById(item.strength_id); parts.push(b ? `${S.blockMinutes(b)} min` : 'Elige un bloque'); }
    if (item.time) parts.push(item.time);
    if (item.duration_min && item.kind !== 'strength') parts.push(`${item.duration_min} min`);
    if (item.place) parts.push(item.place);
    if (item.note) parts.push(item.note);
    return parts.join(' · ');
  }
  function itemName(item) {
    if (item.kind === 'strength') return blockById(item.strength_id)?.name || 'Fuerza';
    return S.KIND_LABEL[item.kind];
  }
  function renderWeek() {
    const today = ui.data.today, monday = S.mondayOf(today);
    const thisWeek = plan(monday, S.addDays(monday, 6));
    const days = ui.program.schedule.week.map((items, d) => `
      <div class="fw-day"><div class="fw-dn">${S.DAYS[d]} <span class="fw-md">${esc(thisWeek[d].md)}</span></div>
        ${items.map((item, i) => `<button class="fw-item ${item.kind}${ui.edit && ui.edit.day === d && ui.edit.index === i ? ' sel' : ''}" data-act="edit-item" data-day="${d}" data-index="${i}"><b>${esc(itemName(item))}</b><small>${esc(itemMeta(item))}</small></button>`).join('')}
        <button class="fw-add" data-act="add-item" data-day="${d}">＋ Añadir</button></div>`).join('');
    return `
      <div class="fw-card"><div class="fw-card-head"><div><h2>Semana tipo</h2><div class="fw-sub">Se repite cada semana. Los partidos y los cambios puntuales se ponen en el calendario de abajo.</div></div>
        <div class="fw-legend"><span><i style="background:${COLORS.football_training}"></i>Entreno fútbol</span><span><i style="background:${COLORS.match}"></i>Partido</span><span><i style="background:${COLORS.strength}"></i>Fuerza</span><span><i style="background:#cfd4cc"></i>Descanso</span></div></div>
        <div class="fw-week">${days}</div>
        ${ui.edit ? renderItemEditor() : ''}
        <div class="fw-info"><b>MD</b> es el día de partido: MD-1 es el día antes y MD+1 el día después. Las etiquetas de arriba son las de esta semana. RunFlow avisa si pones fuerza a MD-1 o el mismo día del partido.</div>
      </div>
      <div class="fw-row2">${renderUpcoming()}${renderEventForm()}</div>`;
  }
  function renderItemEditor() {
    const { day, index } = ui.edit;
    const item = index === null ? ui.edit.draft : ui.program.schedule.week[day][index];
    const kinds = [['football_training', 'Entreno fútbol'], ['strength', 'Fuerza'], ['rest', 'Descanso']];
    const blocks = ui.program.strength;
    return `<div class="fw-editor"><div class="fw-card-head"><h3>${index === null ? 'Añadir' : 'Editar'} · ${S.DAYS[day]}</h3></div>
      <div class="fw-form">
        <div class="fw-f full"><label>Tipo</label><div class="fw-seg">${kinds.map(([k, l]) => `<button data-act="item-kind" data-kind="${k}" class="${item.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${item.kind === 'strength' ? `<div class="fw-f full"><label>Bloque de fuerza</label>${blocks.length ? `<select data-item="strength_id"><option value="">Elige un bloque…</option>${blocks.map(b => `<option value="${esc(b.id)}"${b.id === item.strength_id ? ' selected' : ''}>${esc(b.name)} · ${S.blockMinutes(b)} min</option>`).join('')}</select>` : '<div class="fw-sub">Aún no hay bloques. Créalos en la pestaña Fuerza.</div>'}</div>` : ''}
        ${item.kind !== 'rest' ? `<div class="fw-f"><label>Hora</label><input type="time" data-item="time" value="${esc(item.time)}"></div>` : ''}
        ${item.kind === 'football_training' ? `<div class="fw-f"><label>Duración (min)</label><input type="number" min="0" max="300" data-item="duration_min" value="${esc(item.duration_min ?? '')}"></div>
          <div class="fw-f"><label>Lugar</label><input type="text" data-item="place" value="${esc(item.place)}" placeholder="Club, campo…"></div>` : ''}
        <div class="fw-f ${item.kind === 'football_training' ? '' : 'full'}"><label>Nota</label><input type="text" data-item="note" value="${esc(item.note)}" placeholder="${item.kind === 'strength' ? 'Antes del entreno, en casa…' : ''}"></div>
      </div>
      <div class="fw-actions">${index !== null ? '<button class="fw-btn danger" data-act="item-delete">Quitar</button>' : ''}<span style="flex:1"></span>
        <button class="fw-btn" data-act="item-cancel">${index === null ? 'Cancelar' : 'Cerrar'}</button>${index === null ? '<button class="fw-btn lime" data-act="item-save">Añadir a la semana</button>' : ''}</div></div>`;
  }
  function renderUpcoming() {
    const today = ui.data.today, monday = S.mondayOf(today);
    const days = plan(monday, S.addDays(monday, 34));
    const weeks = [0, 1, 2, 3, 4].map(w => days.slice(w * 7, w * 7 + 7));
    const rows = weeks.map(week => {
      const items = week.flatMap(d => d.items.map(i => ({ ...i, day: d })));
      const matches = items.filter(i => i.kind === 'match');
      const trainings = [...new Set(items.filter(i => i.kind === 'football_training').map(i => S.DAYS_SHORT[i.day.day]))];
      const strength = items.filter(i => i.kind === 'strength').map(i => `${S.DAYS_SHORT[i.day.day]}: ${i.title}`);
      const changes = ui.program.schedule.events.filter(e => e.kind !== 'match' && e.date >= week[0].date && e.date <= week[6].date);
      const warnings = week.flatMap(d => d.warnings.map(w => `${S.DAYS_SHORT[d.day]}: ${w}`));
      return `<tr><td><b>${shortDate(week[0].date)}–${shortDate(week[6].date)}</b></td>
        <td>${matches.length ? matches.map(m => `<span class="fw-tag match">${S.DAYS_SHORT[m.day.day]}${m.time ? ` · ${esc(m.time)}` : ''}</span> ${esc(m.rival ? `vs ${m.rival}` : 'Partido')}${m.home === false ? ' · fuera' : ''}`).join('<br>') : '<span class="fw-tag muted">Sin partido</span>'}</td>
        <td>${trainings.join(', ') || '—'}</td><td>${esc(strength.join(', ')) || '—'}</td>
        <td>${changes.map(c => `<span class="fw-tag warn">${S.DAYS_SHORT[S.dayIndex(c.date)]}: ${esc(eventLabel(c))}</span>`).join(' ')}${warnings.map(w => `<div class="fw-tag bad" style="margin-top:3px">${esc(w)}</div>`).join('')}${!changes.length && !warnings.length ? '<span class="fw-tag muted">Semana tipo</span>' : ''}</td></tr>`;
    }).join('');
    const upcoming = ui.program.schedule.events.filter(e => e.date >= S.addDays(today, -7)).slice(0, 30);
    return `<div class="fw-card"><div class="fw-card-head"><div><h2>Próximas semanas</h2><div class="fw-sub">La semana tipo con los partidos y cambios de cada semana</div></div></div>
      <div class="fw-scroll"><table class="fw-table"><thead><tr><th>Semana</th><th>Partido</th><th>Entrenos</th><th>Fuerza</th><th>Cambios y avisos</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3 style="margin-top:14px">Partidos y cambios guardados</h3>
      <div class="fw-events">${upcoming.length ? upcoming.map(e => `<div class="fw-ev"><span class="fw-tag ${e.kind === 'cancel' ? 'warn' : e.kind}">${esc(S.KIND_LABEL[e.kind])}</span><div><b>${esc(longDate(e.date))}${e.time ? ` · ${esc(e.time)}` : ''}</b> <small>${esc(eventDetail(e))}</small></div><button class="fw-btn small danger" data-act="event-delete" data-id="${esc(e.id)}">Quitar</button></div>`).join('') : '<div class="fw-sub">Aún no hay partidos. Añádelos con el formulario.</div>'}</div></div>`;
  }
  function eventLabel(e) {
    if (e.kind === 'cancel') return e.cancel_kind === 'all' ? 'día libre' : e.cancel_kind === 'strength' ? 'sin fuerza' : 'sin entreno';
    if (e.kind === 'football_training') return 'entreno extra';
    if (e.kind === 'strength') return `fuerza extra${blockById(e.strength_id) ? `: ${blockById(e.strength_id).name}` : ''}`;
    if (e.kind === 'rest') return 'descanso';
    return S.KIND_LABEL[e.kind];
  }
  function eventDetail(e) {
    if (e.kind === 'match') return [e.rival ? `vs ${e.rival}` : '', e.home === false ? 'fuera' : 'casa', S.IMPORTANCE[e.importance], e.duration_min ? `${e.duration_min} min` : '', e.note].filter(Boolean).join(' · ');
    return [eventLabel(e), e.duration_min ? `${e.duration_min} min` : '', e.note].filter(Boolean).join(' · ');
  }
  function renderEventForm() {
    const f = ui.eventForm;
    if (!f.date) f.date = S.addDays(ui.data.today, 1);
    const kinds = [['match', 'Partido'], ['football_training', 'Entreno extra'], ['strength', 'Fuerza extra'], ['cancel', 'Quitar sesión']];
    return `<div class="fw-card"><div class="fw-card-head"><div><h2>Añadir partido o cambio</h2><div class="fw-sub">Partidos, entrenos extra, festivos o sesiones que no se hacen esa semana.</div></div></div>
      <div class="fw-form">
        <div class="fw-f full"><label>Tipo</label><div class="fw-seg">${kinds.map(([k, l]) => `<button data-act="ev-kind" data-kind="${k}" class="${f.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="fw-f"><label>Fecha</label><input type="date" data-ev="date" value="${esc(f.date)}"></div>
        ${f.kind !== 'cancel' ? `<div class="fw-f"><label>Hora</label><input type="time" data-ev="time" value="${esc(f.time)}"></div>` : `<div class="fw-f"><label>Qué se quita</label><select data-ev="cancel_kind">${[['football_training', 'El entreno de fútbol'], ['strength', 'La fuerza'], ['all', 'Todo (día libre)']].map(([k, l]) => `<option value="${k}"${f.cancel_kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`}
        ${f.kind === 'match' ? `<div class="fw-f"><label>Rival</label><input type="text" data-ev="rival" value="${esc(f.rival)}"></div>
          <div class="fw-f"><label>Lugar</label><div class="fw-seg"><button data-act="ev-home" data-home="1" class="${f.home ? 'on' : ''}">Casa</button><button data-act="ev-home" data-home="0" class="${!f.home ? 'on' : ''}">Fuera</button></div></div>
          <div class="fw-f"><label>Duración prevista (min)</label><input type="number" min="0" max="180" data-ev="duration_min" value="${esc(f.duration_min ?? '')}"></div>
          <div class="fw-f"><label>Importancia</label><div class="fw-seg">${Object.entries(S.IMPORTANCE).map(([k, l]) => `<button data-act="ev-imp" data-imp="${k}" class="${f.importance === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}
        ${f.kind === 'football_training' ? `<div class="fw-f"><label>Duración (min)</label><input type="number" min="0" max="300" data-ev="duration_min" value="${esc(f.duration_min ?? '')}"></div>` : ''}
        ${f.kind === 'strength' ? `<div class="fw-f"><label>Bloque</label><select data-ev="strength_id"><option value="">Elige un bloque…</option>${ui.program.strength.map(b => `<option value="${esc(b.id)}"${b.id === f.strength_id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>` : ''}
        <div class="fw-f full"><label>Nota</label><input type="text" data-ev="note" value="${esc(f.note)}" placeholder="${f.kind === 'cancel' ? 'Festivo, viaje…' : ''}"></div>
      </div>
      <div class="fw-actions"><button class="fw-btn lime" data-act="ev-save">Guardar en el calendario</button></div></div>`;
  }

  // ---------- Fuerza ----------
  function renderStrength() {
    const blocks = ui.program.strength;
    const list = blocks.map(b => {
      const days = blockDays(b.id);
      return `<button class="fw-blk${b.id === ui.block ? ' on' : ''}" data-act="pick-block" data-id="${esc(b.id)}"><b>${esc(b.name)}</b>${days.length ? `<span class="fw-tag strength">${days.map(d => S.DAYS_SHORT[d]).join(', ')}</span>` : '<span class="fw-tag muted">Sin día</span>'}<small>${b.format === 'circuit' ? 'Circuito' : 'Series'} · ${b.stations.length} ${b.format === 'circuit' ? 'estaciones' : 'ejercicios'} × ${b.rounds} ${b.format === 'circuit' ? 'vueltas' : 'series'} · ${S.blockMinutes(b)} min</small></button>`;
    }).join('');
    const others = [...(byId('athleteSelect')?.options || [])].filter(o => o.value && o.value !== ui.athleteId);
    const menu = ui.newMenu ? `<div class="fw-menu"><button class="fw-btn" data-act="new-block" data-tpl="">Bloque vacío</button>${S.TEMPLATES.map(t => `<button class="fw-btn" data-act="new-block" data-tpl="${t.id}">Plantilla: ${esc(t.name)}</button>`).join('')}</div>` : '';
    const copy = ui.copyMenu ? `<div class="fw-menu">${ui.copyMenu.loading ? '<div class="fw-sub">Cargando…</div>' : ui.copyMenu.blocks ? (ui.copyMenu.blocks.length ? ui.copyMenu.blocks.map((b, i) => `<button class="fw-btn" data-act="copy-block" data-index="${i}">${esc(b.name)}</button>`).join('') : '<div class="fw-sub">Ese deportista no tiene bloques.</div>') : `<select data-copy="athlete"><option value="">¿De qué deportista?</option>${others.map(o => `<option value="${esc(o.value)}">${esc(o.textContent.trim())}</option>`).join('')}</select>`}</div>` : '';
    return `<div class="fw-side">
      <div class="fw-card"><div class="fw-card-head"><div><h2>Bloques de ${esc(athleteName().split(' ')[0] || 'fuerza')}</h2><div class="fw-sub">Toca un bloque para editarlo</div></div></div>
        <div class="fw-blocks">${list || '<div class="fw-sub">Aún no hay bloques de fuerza.</div>'}</div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="fw-btn dark" data-act="new-menu">＋ Nuevo bloque</button><button class="fw-btn" data-act="copy-menu">Copiar de otro deportista</button></div>
        ${menu}${copy}</div>
      ${renderBlockEditor()}</div>`;
  }
  function renderBlockEditor() {
    const b = blockById(ui.block);
    if (!b) return '<div class="fw-card fw-empty">Crea un bloque nuevo o elige uno de la lista.</div>';
    const circuit = b.format === 'circuit';
    const lib = [...S.STRENGTH_LIBRARY, ...((window.RF_FOOTBALL_DEFAULT_PROGRAM?.exercises) || []).map(e => ({ name: e.name, work: e.detail, note: e.sub, steps: e.steps, video: e.video, img: e.img }))];
    const st = b.stations[ui.station];
    const today = ui.data.today, monday = S.mondayOf(today), week = plan(monday, S.addDays(monday, 6));
    const days = blockDays(b.id);
    return `<div class="fw-card">
      <div class="fw-card-head"><div style="flex:1;min-width:220px"><input type="text" data-block="name" value="${esc(b.name)}" style="font-size:15px;font-weight:800"><input type="text" data-block="objective" value="${esc(b.objective)}" placeholder="Objetivo del bloque" style="margin-top:6px"></div>
        <button class="fw-btn danger" data-act="block-delete">Borrar bloque</button></div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span class="fw-eyebrow">Formato</span><div class="fw-seg" style="width:260px"><button data-act="format" data-format="circuit" class="${circuit ? 'on' : ''}">Circuito</button><button data-act="format" data-format="sets" class="${!circuit ? 'on' : ''}">Series clásicas</button></div>
        <span class="fw-sub">${circuit ? 'Las estaciones se hacen seguidas y se repite la vuelta.' : 'Cada ejercicio se termina antes de pasar al siguiente.'}</span></div>
      <div class="fw-circ">
        <div><label>${circuit ? 'Vueltas' : 'Series'}</label><input type="number" min="1" max="10" data-block="rounds" value="${b.rounds}"></div>
        <div><label>${circuit ? 'Cambio de estación (s)' : 'Descanso entre series (s)'}</label><input type="number" min="0" max="300" data-block="transition_sec" value="${b.transition_sec}"></div>
        <div><label>${circuit ? 'Descanso entre vueltas (s)' : 'Descanso entre ejercicios (s)'}</label><input type="number" min="0" max="900" data-block="rest_sec" value="${b.rest_sec}"></div>
        <div><label>Duración total</label><b id="fwBlockMin">≈ ${S.blockMinutes(b)} min</b></div>
      </div>
      <div class="fw-ex h"><span></span><span>${circuit ? 'Estación' : 'Ejercicio'}</span><span>Trabajo</span><span>Nota para el deportista</span><span>Explicación y vídeo</span><span></span></div>
      ${b.stations.map((s, i) => `<div class="fw-ex${i === ui.station ? ' sel' : ''}"><span class="num">${i + 1}</span><input type="text" data-st="name" data-index="${i}" value="${esc(s.name)}"><input type="text" data-st="work" data-index="${i}" value="${esc(s.work)}" placeholder="10 reps / 40 s"><input type="text" data-st="note" data-index="${i}" value="${esc(s.note)}">
        <button class="fw-vid ${s.video || s.steps.length ? 'ok' : 'no'}" data-act="pick-station" data-index="${i}">${s.video ? '▶ Vídeo ✓' : s.steps.length ? 'Explicación ✓' : '＋ Añadir'}</button>
        <span class="fw-tools"><button class="fw-btn small" data-act="st-move" data-index="${i}" data-dir="-1" title="Subir">↑</button><button class="fw-btn small" data-act="st-move" data-index="${i}" data-dir="1" title="Bajar">↓</button><button class="fw-btn small danger" data-act="st-delete" data-index="${i}" title="Quitar">×</button></span></div>`).join('') || '<div class="fw-sub" style="padding:10px 0">Añade la primera estación.</div>'}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center"><select data-act-select="lib" style="max-width:280px"><option value="">＋ Ejercicio de la biblioteca…</option>${lib.map((e, i) => `<option value="${i}">${esc(e.name)}</option>`).join('')}</select><button class="fw-btn" data-act="st-new">＋ Ejercicio nuevo</button></div>
      ${st ? `<div class="fw-ficha">
        <div><a class="fw-thumb" ${st.video ? `href="${esc(st.video)}" target="_blank" rel="noopener"` : ''}>${st.img ? `<img src="${esc(st.img)}" alt="">` : ''}<span>${st.video ? '▶' : '—'}</span><small>${esc(st.name)}</small></a>
          <div class="fw-f" style="margin-top:8px"><label>Vídeo (YouTube o enlace)</label><input type="url" data-st="video" data-index="${ui.station}" value="${esc(st.video)}" placeholder="https://…"></div>
          <div class="fw-f" style="margin-top:8px"><label>Imagen (opcional)</label><input type="url" data-st="img" data-index="${ui.station}" value="${esc(st.img)}" placeholder="https://…"></div></div>
        <div><b style="font-size:13px">Ficha de la estación ${ui.station + 1} · lo que verá el deportista</b><div class="fw-sub">Paso a paso y en qué fijarse. Si viene de la biblioteca puedes cambiar el texto.</div>
          <div class="fw-f" style="margin-top:8px"><label>Paso a paso (uno por línea)</label><textarea data-st="steps" data-index="${ui.station}">${esc(st.steps.join('\n'))}</textarea></div>
          <div class="fw-f" style="margin-top:8px"><label>En qué fijarse</label><input type="text" data-st="cues" data-index="${ui.station}" value="${esc(st.cues)}"></div></div></div>` : ''}
      <div style="margin-top:18px"><h3>¿Qué día de la semana?</h3><div class="fw-sub">Toca un día para ponerlo o quitarlo de la semana tipo. Las etiquetas MD son las de esta semana.</div></div>
      <div class="fw-ruler">${week.map((d, i) => {
        const on = days.includes(i); const isMatch = d.items.some(x => x.kind === 'match'); const foot = ui.program.schedule.week[i].some(x => x.kind === 'football_training');
        return `<button data-act="toggle-day" data-day="${i}" class="${on ? 's' : isMatch ? 'm' : foot ? 'f' : ''}">${S.DAYS_SHORT[i]}${on ? ' ✓' : ''}<small>${esc(d.md || '—')}${foot && !on ? ' · fútbol' : ''}${isMatch ? ' · partido' : ''}</small></button>`;
      }).join('')}</div>
      ${days.some(d => ['MD-1', 'MD'].includes(week[d].md)) ? '<div class="fw-warnbox">Esta semana el bloque cae a MD-1 o el mismo día del partido. Mejor ponerlo a MD-4 o MD-3, o quitarlo esa semana desde el calendario.</div>' : '<div class="fw-info">Lo ideal para un bloque de fuerza es MD-4 o MD-3. La activación pre-partido puede ir a MD-1.</div>'}
    </div>`;
  }

  // ---------- Carga y estado ----------
  function renderLoad() {
    const st = ui.data.stats || {};
    const acwr = st.acwr;
    const zone = acwr === null || acwr === undefined ? ['muted', 'Faltan 3 semanas de datos'] : acwr < 0.8 ? ['warn', 'Por debajo'] : acwr <= 1.3 ? ['good', 'Zona segura'] : acwr <= 1.5 ? ['warn', 'Vigilar'] : ['bad', 'Pico de carga'];
    const bodyLabel = v => v === null || v === undefined ? '—' : S.BODY[Math.min(3, Math.max(0, Math.round(v) - 1))].label;
    const today = ui.data.today;
    const recentDays = plan(S.addDays(today, -21), today).slice().reverse();
    const rows = [];
    recentDays.forEach(day => day.items.filter(i => S.RATED_KINDS.includes(i.kind)).forEach(i => rows.push({ date: day.date, item: i, log: i.rating })));
    const planned = new Set(rows.map(r => r.log?.id).filter(Boolean));
    (ui.data.logs || []).filter(l => !planned.has(l.id) && l.date >= S.addDays(today, -21)).forEach(l => rows.push({ date: l.date, item: { kind: l.kind, title: l.title || S.KIND_LABEL[l.kind] }, log: l }));
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const pains = (ui.data.logs || []).filter(l => l.date >= S.addDays(today, -14) && Number(l.pain) > 0);
    const tableRows = rows.slice(0, 25).map(({ date, item, log }) => {
      const mins = log ? (log.kind === 'match' ? log.minutes_played : log.duration_min) : null;
      return `<tr><td><b>${esc(dayDate(date))}</b></td><td><span class="fw-tag ${item.kind}">${esc(S.KIND_LABEL[item.kind])}</span> ${esc(item.kind === 'match' && item.rival ? `vs ${item.rival}` : item.kind === 'strength' ? item.title : '')}</td>
        ${log ? `<td>${fmt(mins)}</td><td>${fmt(log.rpe)}</td><td><b>${fmt(log.load)}</b></td><td>${log.body_state ? esc(S.BODY[log.body_state - 1].label) : '—'}</td><td class="fw-face">${log.mood ? S.MOOD[log.mood - 1].icon : '—'}</td><td>${esc([log.pain > 0 ? `Dolor ${log.pain}/10${log.pain_area ? ` (${log.pain_area})` : ''}` : '', log.note].filter(Boolean).join(' · '))}</td>`
        : `<td colspan="6"><span class="fw-tag warn">Sin valorar</span></td>`}</tr>`;
    }).join('');
    return `<div class="fw-kpis">
        <div class="fw-kpi"><span>Carga esta semana</span><b>${fmt(st.week_load)}</b><small>${st.avg_week_load_4 === null || st.avg_week_load_4 === undefined ? 'La media de 4 semanas sale con más datos' : `Media de 4 semanas: ${fmt(st.avg_week_load_4)}`}</small></div>
        <div class="fw-kpi"><span>Relación aguda/crónica</span><b>${acwr === null || acwr === undefined ? '—' : Number(acwr).toLocaleString('es-ES')}</b><small><span class="fw-tag ${zone[0]}">${zone[1]}</span> (0,8–1,3)</small></div>
        <div class="fw-kpi"><span>Sesiones valoradas</span><b>${st.rated ?? 0}<small>/${st.planned ?? 0}</small></b><small>Esta semana hasta hoy</small></div>
        <div class="fw-kpi"><span>Estado físico</span><b style="font-size:20px">${esc(bodyLabel(st.body_avg))}</b><small>Media de las últimas 2 semanas</small></div>
        <div class="fw-kpi"><span>Ánimo</span><b>${st.mood_avg === null || st.mood_avg === undefined ? '—' : Number(st.mood_avg).toLocaleString('es-ES')}<small>/5</small></b><small>Media de las últimas 2 semanas</small></div>
      </div>
      <div class="fw-card"><div class="fw-card-head"><div><h2>Carga diaria · últimas 4 semanas</h2><div class="fw-sub">Cada barra es un día; el color dice de dónde viene la carga</div></div>
        <div class="fw-legend"><span><i style="background:${COLORS.football_training}"></i>Entreno fútbol</span><span><i style="background:${COLORS.match}"></i>Partido</span><span><i style="background:${COLORS.strength}"></i>Fuerza</span></div></div>
        <div class="fw-chart" id="fwLoadChart"></div></div>
      <div class="fw-row2">
        <div class="fw-card"><div class="fw-card-head"><div><h2>Últimas valoraciones</h2><div class="fw-sub">Lo que ha rellenado el deportista después de cada sesión</div></div></div>
          <div class="fw-scroll">${tableRows ? `<table class="fw-table"><thead><tr><th>Día</th><th>Sesión</th><th>Min</th><th>RPE</th><th>Carga</th><th>Físico</th><th>Ánimo</th><th>Nota</th></tr></thead><tbody>${tableRows}</tbody></table>` : '<div class="fw-empty">Todavía no hay sesiones ni valoraciones.</div>'}</div></div>
        <div class="fw-card"><div class="fw-card-head"><div><h2>Estado físico y ánimo</h2><div class="fw-sub">Después de cada sesión, últimas 4 semanas</div></div></div>
          <div class="fw-chart" id="fwBodyChart"></div><div class="fw-chart" id="fwMoodChart" style="margin-top:8px"></div>
          ${pains.length ? `<div class="fw-warnbox"><b>Para revisar:</b> ${pains.slice(0, 3).map(p => `${esc(dayDate(p.date))}, dolor ${p.pain}/10${p.pain_area ? ` en ${esc(p.pain_area)}` : ''}`).join('; ')}.</div>` : ''}</div>
      </div>`;
  }
  function drawCharts() {
    const st = ui.data.stats || {};
    const host = byId('fwLoadChart');
    if (host) {
      const daily = st.daily || [];
      const W = Math.max(320, host.clientWidth || 800), H = 220, L = 40, R = 8, T = 10, B = 24;
      const max = Math.max(300, ...daily.map(d => d.football_training + d.match + d.strength));
      const step = max > 1200 ? 500 : max > 600 ? 300 : 150, top = Math.ceil(max / step) * step;
      const y = v => T + (H - T - B) * (1 - v / top), bw = (W - L - R) / Math.max(1, daily.length);
      let svg = '';
      for (let v = 0; v <= top; v += step) svg += `<line class="fw-gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="fw-tick" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
      daily.forEach((d, i) => {
        let base = 0; const x = L + i * bw + bw * 0.18, w = bw * 0.64;
        ['football_training', 'match', 'strength'].forEach(k => { if (d[k] > 0) { svg += `<rect x="${x}" y="${y(base + d[k])}" width="${w}" height="${y(base) - y(base + d[k])}" fill="${COLORS[k]}" rx="2"><title>${dayDate(d.date)} · ${S.KIND_LABEL[k]}: ${d[k]}</title></rect>`; base += d[k]; } });
        if (S.dayIndex(d.date) === 0) svg += `<text class="fw-tick" x="${x}" y="${H - 6}">${shortDate(d.date)}</text>`;
      });
      host.innerHTML = daily.some(d => d.football_training + d.match + d.strength > 0) ? `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>` : '<div class="fw-empty">Sin carga registrada en las últimas 4 semanas.</div>';
    }
    const logs = (ui.data.logs || []).filter(l => l.date >= S.addDays(ui.data.today, -27)).slice().sort((a, b) => a.date.localeCompare(b.date));
    line('fwBodyChart', 'Estado físico', logs.filter(l => l.body_state).map(l => ({ date: l.date, v: 5 - l.body_state })), [1, 4], v => S.BODY[4 - v]?.label || '', '#2f6fb0');
    line('fwMoodChart', 'Ánimo (1–5)', logs.filter(l => l.mood).map(l => ({ date: l.date, v: l.mood })), [1, 5], v => String(v), '#638e16');
  }
  function line(id, label, points, [min, max], tick, color) {
    const host = byId(id); if (!host) return;
    if (points.length < 2) { host.innerHTML = `<div class="fw-sub" style="padding:6px 0"><b>${label}:</b> faltan valoraciones para dibujar la evolución.</div>`; return; }
    const W = Math.max(280, host.clientWidth || 400), H = 140, L = 78, R = 8, T = 28, B = 18;
    const x = i => L + (W - L - R) * (points.length === 1 ? 0.5 : i / (points.length - 1)), y = v => T + (H - T - B) * (1 - (v - min) / (max - min));
    let svg = `<text class="fw-tick" x="0" y="11" style="font-weight:800">${label}</text>`;
    for (let v = min; v <= max; v++) svg += `<line class="fw-gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="fw-tick" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${esc(tick(v))}</text>`;
    svg += `<polyline fill="none" stroke="${color}" stroke-width="2" points="${points.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')}"/>`;
    points.forEach((p, i) => { svg += `<circle cx="${x(i)}" cy="${y(p.v)}" r="3" fill="${color}"><title>${dayDate(p.date)}: ${esc(tick(p.v))}</title></circle>`; });
    svg += `<text class="fw-tick" x="${L}" y="${H - 3}">${shortDate(points[0].date)}</text><text class="fw-tick" x="${W - R}" y="${H - 3}" text-anchor="end">${shortDate(points[points.length - 1].date)}</text>`;
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`;
  }

  // ---------- eventos ----------
  function onClick(event) {
    const el = event.target.closest('[data-tab],[data-act]'); if (!el) return;
    if (el.dataset.tab) { ui.tab = el.dataset.tab; render(); return; }
    const act = el.dataset.act, week = ui.program.schedule.week;
    const b = blockById(ui.block);
    switch (act) {
      case 'content': openContentEditor(); break;
      case 'mode-on': setMode(true); break;
      case 'add-item': ui.edit = { day: Number(el.dataset.day), index: null, draft: { kind: 'football_training', time: '19:00', duration_min: 90, place: '', note: '' } }; render(); break;
      case 'edit-item': ui.edit = { day: Number(el.dataset.day), index: Number(el.dataset.index) }; render(); break;
      case 'item-kind': {
        const item = ui.edit.index === null ? ui.edit.draft : week[ui.edit.day][ui.edit.index];
        item.kind = el.dataset.kind;
        if (item.kind === 'strength') { item.strength_id = item.strength_id || ui.program.strength[0]?.id || ''; item.duration_min = null; item.place = ''; }
        if (item.kind === 'rest') { item.time = ''; item.duration_min = null; item.place = ''; }
        if (item.kind === 'football_training' && !item.duration_min) item.duration_min = 90;
        if (ui.edit.index === null) render(); else changed();
        break;
      }
      case 'item-save': week[ui.edit.day].push(ui.edit.draft); ui.edit = null; changed(); break;
      case 'item-delete': week[ui.edit.day].splice(ui.edit.index, 1); ui.edit = null; changed(); break;
      case 'item-cancel': ui.edit = null; render(); break;
      case 'ev-kind': ui.eventForm.kind = el.dataset.kind; if (el.dataset.kind === 'football_training') ui.eventForm.duration_min = 90; if (el.dataset.kind === 'match') ui.eventForm.duration_min = 70; render(); break;
      case 'ev-home': ui.eventForm.home = el.dataset.home === '1'; render(); break;
      case 'ev-imp': ui.eventForm.importance = el.dataset.imp; render(); break;
      case 'ev-save': saveEvent(); break;
      case 'event-delete': ui.program.schedule.events = ui.program.schedule.events.filter(e => e.id !== el.dataset.id); changed(); break;
      case 'pick-block': ui.block = el.dataset.id; ui.station = 0; render(); break;
      case 'new-menu': ui.newMenu = !ui.newMenu; ui.copyMenu = null; render(); break;
      case 'new-block': {
        const block = el.dataset.tpl ? S.fromTemplate(el.dataset.tpl) : { id: S.randomId('b'), name: 'Nuevo bloque', objective: '', format: 'circuit', rounds: 3, transition_sec: 15, rest_sec: 120, stations: [] };
        ui.program.strength.push(block); ui.block = block.id; ui.station = 0; ui.newMenu = false; changed(); break;
      }
      case 'copy-menu': ui.copyMenu = ui.copyMenu ? null : {}; ui.newMenu = false; render(); break;
      case 'copy-block': {
        const src = clone(ui.copyMenu.blocks[Number(el.dataset.index)]); src.id = S.randomId('b');
        ui.program.strength.push(src); ui.block = src.id; ui.station = 0; ui.copyMenu = null; changed(); break;
      }
      case 'block-delete':
        if (!b || !confirm(`¿Borrar el bloque “${b.name}”? También se quitará de la semana tipo.`)) return;
        ui.program.strength = ui.program.strength.filter(x => x.id !== b.id);
        week.forEach((items, d) => { week[d] = items.filter(i => !(i.kind === 'strength' && i.strength_id === b.id)); });
        ui.block = ui.program.strength[0]?.id || null; changed(); break;
      case 'format': b.format = el.dataset.format; changed(); break;
      case 'pick-station': ui.station = Number(el.dataset.index); render(); break;
      case 'st-new': b.stations.push({ name: 'Nuevo ejercicio', work: '10 reps', note: '', steps: [], cues: '', video: '', img: '' }); ui.station = b.stations.length - 1; changed(); break;
      case 'st-move': {
        const i = Number(el.dataset.index), j = i + Number(el.dataset.dir);
        if (j < 0 || j >= b.stations.length) return;
        [b.stations[i], b.stations[j]] = [b.stations[j], b.stations[i]]; ui.station = j; changed(); break;
      }
      case 'st-delete': b.stations.splice(Number(el.dataset.index), 1); ui.station = Math.max(0, Math.min(ui.station, b.stations.length - 1)); changed(); break;
      case 'toggle-day': {
        const d = Number(el.dataset.day);
        const idx = week[d].findIndex(i => i.kind === 'strength' && i.strength_id === b.id);
        if (idx >= 0) week[d].splice(idx, 1);
        else { week[d] = week[d].filter(i => i.kind !== 'rest'); week[d].push({ kind: 'strength', strength_id: b.id, time: '', duration_min: null, place: '', note: '' }); }
        changed(); break;
      }
      default: break;
    }
  }
  function onInput(event) {
    const el = event.target;
    if (el.dataset.item !== undefined && ui.edit) {
      const item = ui.edit.index === null ? ui.edit.draft : ui.program.schedule.week[ui.edit.day][ui.edit.index];
      item[el.dataset.item] = el.dataset.item === 'duration_min' ? (el.value === '' ? null : Number(el.value)) : el.value;
      if (ui.edit.index !== null) changed(false);
    } else if (el.dataset.ev !== undefined) {
      ui.eventForm[el.dataset.ev] = el.dataset.ev === 'duration_min' ? (el.value === '' ? null : Number(el.value)) : el.value;
    } else if (el.dataset.block !== undefined) {
      const b = blockById(ui.block); const key = el.dataset.block;
      b[key] = ['rounds', 'transition_sec', 'rest_sec'].includes(key) ? Number(el.value || 0) : el.value;
      const m = byId('fwBlockMin'); if (m) m.textContent = `≈ ${S.blockMinutes(b)} min`;
      changed(false);
    } else if (el.dataset.st !== undefined) {
      const b = blockById(ui.block), s = b.stations[Number(el.dataset.index)], key = el.dataset.st;
      s[key] = key === 'steps' ? el.value.split('\n').map(x => x.trim()).filter(Boolean) : el.value;
      if (key === 'work') { const m = byId('fwBlockMin'); if (m) m.textContent = `≈ ${S.blockMinutes(b)} min`; }
      changed(false);
    }
  }
  function onChange(event) {
    const el = event.target;
    // Se actualiza solo el texto afectado: re-renderizar aquí se comería el clic en el siguiente botón.
    if (el.dataset.item !== undefined && ui.edit && ui.edit.index !== null) {
      const item = ui.program.schedule.week[ui.edit.day][ui.edit.index], card = root().querySelector('.fw-item.sel');
      if (card) card.innerHTML = `<b>${esc(itemName(item))}</b><small>${esc(itemMeta(item))}</small>`;
      return;
    }
    if (el.dataset.block === 'name') { const card = root().querySelector('.fw-blk.on b'); if (card) card.textContent = el.value; return; }
    if (el.dataset.st === 'video' || el.dataset.st === 'steps') {
      const s = blockById(ui.block).stations[Number(el.dataset.index)], chip = root().querySelector(`.fw-vid[data-index="${el.dataset.index}"]`);
      if (chip) { chip.className = `fw-vid ${s.video || s.steps.length ? 'ok' : 'no'}`; chip.textContent = s.video ? '▶ Vídeo ✓' : s.steps.length ? 'Explicación ✓' : '＋ Añadir'; }
      return;
    }
    if (el.dataset.actSelect === 'lib' && el.value !== '') {
      const lib = [...S.STRENGTH_LIBRARY, ...((window.RF_FOOTBALL_DEFAULT_PROGRAM?.exercises) || []).map(e => ({ name: e.name, work: e.detail, note: e.sub, steps: e.steps, video: e.video, img: e.img }))];
      const e = lib[Number(el.value)]; const b = blockById(ui.block);
      b.stations.push({ name: e.name, work: e.work || '', note: e.note || '', steps: (e.steps || []).slice(), cues: e.cues || '', video: e.video || '', img: e.img || '' });
      ui.station = b.stations.length - 1; changed(); return;
    }
    if (el.dataset.copy === 'athlete' && el.value) loadCopySource(el.value);
  }
  function saveEvent() {
    const f = ui.eventForm;
    if (!f.date) { ui.status = 'Pon una fecha.'; ui.statusKind = 'err'; paintStatus(); return; }
    if (f.kind === 'strength' && !f.strength_id) { ui.status = 'Elige el bloque de fuerza.'; ui.statusKind = 'err'; paintStatus(); return; }
    const event = { id: S.randomId('e'), date: f.date, kind: f.kind, time: f.kind === 'cancel' ? '' : f.time, duration_min: ['match', 'football_training'].includes(f.kind) ? f.duration_min : null, note: f.note, place: '' };
    if (f.kind === 'match') Object.assign(event, { rival: f.rival, home: f.home, importance: f.importance });
    if (f.kind === 'cancel') event.cancel_kind = f.cancel_kind;
    if (f.kind === 'strength') event.strength_id = f.strength_id;
    ui.program.schedule.events.push(event);
    ui.program.schedule.events.sort((a, b) => a.date.localeCompare(b.date));
    Object.assign(ui.eventForm, { rival: '', note: '', time: '' });
    changed();
  }
  async function loadCopySource(athleteId) {
    ui.copyMenu = { loading: true }; render();
    try {
      const data = await api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/football-program`);
      ui.copyMenu = { blocks: data.program?.strength || [] };
    } catch (error) { ui.copyMenu = null; ui.status = error.message; ui.statusKind = 'err'; }
    render();
  }
  async function setMode(enabled) {
    try { await api(`/api/coach/athletes/${encodeURIComponent(ui.athleteId)}/football-mode`, { method: 'POST', body: JSON.stringify({ enabled }) }); ui.mode = enabled; render(); }
    catch (error) { ui.status = error.message; ui.statusKind = 'err'; paintStatus(); }
  }
  function openContentEditor() {
    const nav = document.querySelector('#v8AthleteNav [data-v8="summary"]');
    if (nav) nav.click(); else window.switchView('summary');
    setTimeout(() => {
      const toggle = byId('footballProgramToggle'), body = byId('footballProgramBody');
      if (toggle && body?.hidden) toggle.click();
      byId('footballProgramEditor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (isActive() && ui.tab === 'load' && ui.data) drawCharts(); }, 150); });
  const start = () => { if (!mount()) setTimeout(start, 400); };
  start();
})();
