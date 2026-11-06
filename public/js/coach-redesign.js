// RunFlow Coach · Estructura nueva (rediseño 2026-11).
// Menú: Para revisar · Atletas · Biblioteca · Mensajes · Ajustes.
// Cada atleta tiene su ficha con pestañas: Datos · Planificación · Calendario · Sesiones · Evolución.
// Es una capa encima de coach-v8-runtime.js: reutiliza sus vistas y botones (ocultos) y no cambia datos.
// Vuelta a la versión anterior: Ajustes › «Usar la versión anterior» o ?ui=clasica.
(function () {
  'use strict';
  const STORE = 'runflow_coach_ui';
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = () => iso(new Date());
  const addDays = (date, days) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return iso(d); };
  const monday = (date = todayIso()) => { const d = new Date(`${date}T12:00:00`); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return iso(d); };
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const shortDate = date => { if (!date) return '—'; const d = new Date(`${String(date).slice(0, 10)}T12:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const relDate = date => {
    if (!date) return '—';
    const diff = Math.round((new Date(`${todayIso()}T12:00:00`) - new Date(`${String(date).slice(0, 10)}T12:00:00`)) / 86400000);
    if (diff === 0) return 'Hoy'; if (diff === 1) return 'Ayer';
    if (diff > 1 && diff < 7) { const d = new Date(`${String(date).slice(0, 10)}T12:00:00`); return DAYS[d.getDay()][0].toUpperCase() + DAYS[d.getDay()].slice(1); }
    return shortDate(date);
  };
  const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase();
  const PALETTE = [['#e3ecf8', '#2c5f99'], ['#e5f3e2', '#2f7a3b'], ['#efe7fb', '#6a4bc2'], ['#fdf0d8', '#9a6312'], ['#fbe5dc', '#a24a2c'], ['#e1f1f2', '#2b7479']];
  const avatarColor = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const avatar = (athlete, size = '') => { const [bg, fg] = avatarColor(athlete.id); return `<div class="rd-av ${size}" style="background:${bg};color:${fg}">${esc(initials(athlete.display_name))}</div>`; };
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  function classicRequested() {
    try {
      const p = new URLSearchParams(location.search).get('ui');
      if (p === 'clasica') localStorage.setItem(STORE, 'clasica');
      if (p === 'nueva') localStorage.removeItem(STORE);
      return localStorage.getItem(STORE) === 'clasica';
    } catch { return false; }
  }

  async function api(url) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
    return data;
  }

  // ---------- Datos del equipo (una carga compartida por Para revisar, Atletas y Ajustes) ----------
  let teamCache = null, teamPromise = null;
  async function loadTeam(force = false) {
    if (!force && teamCache && Date.now() - teamCache.at < 90000) return teamCache;
    if (!force && teamPromise) return teamPromise;
    teamPromise = (async () => {
      const list = await api('/api/coach/athletes?include_inactive=0&details=1');
      const athletes = list.athletes || [];
      const mon = monday(), oldest = addDays(mon, -14), newest = addDays(mon, 13), now = todayIso();
      const rows = await Promise.all(athletes.map(async athlete => {
        const id = encodeURIComponent(athlete.id);
        const [calendar, recovery, football] = await Promise.all([
          api(`/api/coach/athletes/${id}/calendar?oldest=${oldest}&newest=${newest}`).catch(() => ({ weeks: [] })),
          api(`/api/coach/athletes/${id}/recovery?oldest=${addDays(now, -6)}&newest=${now}`).catch(() => ({})),
          api(`/api/coach/athletes/${id}/football-summary`).catch(() => ({})),
        ]);
        const plan = football && football.mode ? null : await api(`/api/coach/athletes/${id}/plan`).catch(() => undefined);
        return summarise(athlete, calendar.weeks || [], recovery, football, plan);
      }));
      teamCache = { at: Date.now(), athletes: rows };
      return teamCache;
    })();
    try { return await teamPromise; } finally { teamPromise = null; }
  }

  const isPublished = week => (week.publication_status || week.status) === 'published';
  const recoveryRows = data => (Array.isArray(data) ? data : data.metrics || data.rows || data.recovery || data.daily_metrics || []);

  function summarise(athlete, weeks, recovery, football, planData) {
    const mon = monday(), next = addDays(mon, 7), now = todayIso();
    const weekOf = start => weeks.find(w => String(w.week_start || '').slice(0, 10) === start);
    const thisWeek = weekOf(mon), nextWeek = weekOf(next);
    const workouts = w => (w?.workouts || []).filter(x => !/^Opcional/i.test(x.title || ''));
    const done = w => workouts(w).filter(x => ['completed', 'partial'].includes(x.execution_status)).length;
    const allWorkouts = weeks.flatMap(w => w.workouts || []);
    const futureWorkouts = allWorkouts.filter(w => w.workout_date >= now);
    const rec = recoveryRows(recovery).filter(r => r && r.metric_date).sort((a, b) => String(a.metric_date).localeCompare(String(b.metric_date)));
    const lastRec = [...rec].reverse().find(r => num(r.readiness_score) !== null);
    const readiness = lastRec ? Math.round(num(lastRec.readiness_score)) : null;
    const painLogs = allWorkouts.filter(w => w.workout_date >= addDays(now, -3) && w.workout_date <= now && num(w.manual_log?.pain) >= 5)
      .sort((a, b) => b.workout_date.localeCompare(a.workout_date));
    const footballMode = Boolean(football && football.mode);
    const goal = athlete.next_goal || null;
    let plan;
    if (footballMode) plan = { state: 'ok', text: 'Programa de fútbol' };
    else if (planData !== undefined && !planData?.season) plan = { state: 'none', text: 'Pendiente de crear' };
    else if (planData === undefined && !goal && !futureWorkouts.length) plan = { state: 'none', text: 'Pendiente de crear' };
    else if (!workouts(nextWeek).length && goal && goal.goal_date > next) plan = { state: 'prepare', text: 'Falta preparar la semana que viene' };
    else if (thisWeek && !isPublished(thisWeek) && workouts(thisWeek).length) plan = { state: 'prepare', text: 'Semana sin publicar' };
    else plan = { state: 'ok', text: workouts(thisWeek).length ? 'Semana publicada' : 'Sin sesiones esta semana' };
    const alerts = [];
    if (painLogs.length) alerts.push({ level: 'r', title: `Dolor ${num(painLogs[0].manual_log.pain)}/10`, text: `En «${painLogs[0].title || 'sesión'}» (${relDate(painLogs[0].workout_date).toLowerCase()}). Si sigue, usa «Ha pasado algo».`, action: 'incident' });
    if (readiness !== null && readiness < 50) alerts.push({ level: 'a', title: `Readiness ${readiness}`, text: lastRec.readiness_explanation || lastRec.readiness_label || 'Recuperación por debajo de lo normal.', action: 'evolution' });
    const today = (thisWeek?.workouts || []).filter(w => w.workout_date === now && isPublished(thisWeek));
    return {
      ...athlete, footballMode, plan, readiness, readinessLabel: lastRec?.readiness_label || '', alerts, today,
      week: { planned: workouts(thisWeek).length, done: done(thisWeek) },
      football: football?.week || null,
    };
  }

  // ---------- Navegación ----------
  let current = 'review';
  let fichaTab = 'plan';
  const legacy = target => q(`#v8GeneralNav [data-v8="${target}"], #v8AthleteNav [data-v8="${target}"]`);
  const clickLegacy = target => { const b = legacy(target) || q(`main.shell>.tabs [data-view="${target}"]`); b?.click(); return Boolean(b); };

  function setActive(section) {
    current = section;
    qa('.rd-nav [data-rd]').forEach(b => b.classList.toggle('active', b.dataset.rd === section));
    document.body.classList.toggle('rd-in-ficha', section === 'athletes' && fichaOpen);
    document.body.classList.toggle('rd-in-review', section === 'review');
  }

  let fichaOpen = false;
  function go(section) {
    fichaOpen = false;
    setActive(section);
    if (section === 'review') { clickLegacy('summary'); setTimeout(renderReview, 60); }
    if (section === 'athletes') { window.switchView('rdAthletes'); renderAthletes(); }
    if (section === 'library') clickLegacy('library');
    if (section === 'messages') clickLegacy('globalMessages');
    if (section === 'settings') { window.switchView('rdSettings'); renderSettings(); }
  }

  function selectAthlete(id) {
    const select = q('#athleteSelect');
    if (!select || select.value === String(id)) return false;
    select.value = String(id);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  const selectedId = () => q('#athleteSelect')?.value || '';

  async function openFicha(id, tab = 'plan') {
    const changed = selectAthlete(id);
    fichaOpen = true;
    setActive('athletes');
    renderFichaHead();
    setTimeout(() => openTab(tab), changed ? 450 : 0);
  }

  function openTab(tab) {
    fichaTab = tab;
    const a = teamAthlete(selectedId());
    qa('#rdFicha [data-rd-tab]').forEach(b => b.classList.toggle('on', b.dataset.rdTab === tab));
    if (tab === 'data' || tab === 'goals' || tab === 'connections') {
      q(`main.shell>.tabs [data-view="${tab === 'data' ? 'profile' : tab}"]`)?.click();
      qa('#rdFicha [data-rd-tab="data"]').forEach(b => b.classList.add('on'));
    }
    const sub = q('#rdFicha .rd-subtabs');
    if (sub) { sub.hidden = !['data', 'goals', 'connections'].includes(tab); qa('[data-rd-tab]', sub).forEach(b => b.classList.toggle('on', b.dataset.rdTab === tab)); }
    if (tab === 'plan') { if (a?.footballMode && q('#v8FootballNav')) q('#v8FootballNav').click(); else clickLegacy('plan'); }
    if (tab === 'calendar') clickLegacy('week');
    if (tab === 'sessions') clickLegacy('activities');
    if (tab === 'evolution') { if (q('#v8EvolutionNav')) q('#v8EvolutionNav').click(); else clickLegacy('recovery'); }
    if (tab === 'messages') clickLegacy('messages');
    setTimeout(() => document.body.classList.add('rd-in-ficha'), 0);
  }

  const teamAthlete = id => (teamCache?.athletes || []).find(a => String(a.id) === String(id));

  function renderFichaHead() {
    const host = q('#rdFicha'); if (!host) return;
    const id = selectedId();
    const option = q('#athleteSelect')?.selectedOptions?.[0];
    const a = teamAthlete(id) || { id, display_name: option ? option.textContent.replace(/\s*·.*$/, '').trim() : 'Atleta' };
    const sub = a.footballMode ? 'Fútbol' : a.next_goal ? `${esc(a.next_goal.name)} · ${shortDate(a.next_goal.goal_date)}` : 'Sin objetivo todavía';
    host.innerHTML = `
      <div class="rd-crumb"><button type="button" data-rd-back>Atletas</button> › <b>${esc(a.display_name)}</b></div>
      <div class="rd-ficha-head">
        <div class="rd-ficha-id">${avatar(a, 'big')}<div><h1>${esc(a.display_name)}</h1><p>${sub}</p></div></div>
        <div class="rd-ficha-actions">
          <button type="button" class="btn secondary" data-rd-tab-go="messages">Mensaje</button>
          <button type="button" class="btn secondary" data-rd-app>Ver su app</button>
          ${a.footballMode || a.plan?.state === 'none' ? '' : '<button type="button" class="btn rd-btn-danger" data-rd-incident>Ha pasado algo</button>'}
        </div>
      </div>
      <div class="rd-tabs" role="tablist">
        ${[['data', 'Datos'], ['plan', 'Planificación'], ['calendar', 'Calendario'], ['sessions', 'Sesiones'], ['evolution', 'Evolución']].map(([k, label]) =>
          `<button type="button" role="tab" data-rd-tab="${k}" class="${k === fichaTab ? 'on' : ''}">${label}${k === 'plan' && a.plan?.state === 'none' ? '<i class="rd-dot r"></i>' : ''}</button>`).join('')}
      </div>
      <div class="rd-subtabs" ${['data', 'goals', 'connections'].includes(fichaTab) ? '' : 'hidden'}>
        <button type="button" data-rd-tab="data">Ficha y zonas</button><button type="button" data-rd-tab="goals">Objetivos</button><button type="button" data-rd-tab="connections">Conexiones y acceso a la app</button>
      </div>`;
  }

  function onFichaClick(event) {
    const t = event.target.closest('button'); if (!t) return;
    if (t.dataset.rdTab) openTab(t.dataset.rdTab);
    if (t.dataset.rdTabGo) openTab(t.dataset.rdTabGo);
    if (t.hasAttribute('data-rd-back')) go('athletes');
    if (t.hasAttribute('data-rd-app')) window.open('/athlete', '_blank');
    if (t.hasAttribute('data-rd-incident')) {
      openTab('plan');
      let tries = 0;
      const timer = setInterval(() => { const b = q('#planView [data-sp-act="incident"]'); if (b || ++tries > 30) { clearInterval(timer); b?.click(); } }, 150);
    }
  }

  // ---------- Para revisar ----------
  function greeting() { const h = new Date().getHours(); return h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'; }
  async function renderReview() {
    const view = q('#summaryView'); if (!view) return;
    let head = q('#rdReviewHead');
    if (!head) { head = document.createElement('div'); head.id = 'rdReviewHead'; view.prepend(head); }
    let side = q('#rdReviewSide');
    const pendingCount = () => qa('#v8ValidationQueue .v8-validation-row').length;
    const paint = team => {
      const athletes = team?.athletes || [];
      const alerts = athletes.flatMap(a => a.alerts.map(x => ({ ...x, athlete: a })));
      const prepare = athletes.filter(a => a.plan.state === 'prepare' || a.plan.state === 'none');
      const planned = athletes.reduce((s, a) => s + a.week.planned, 0), done = athletes.reduce((s, a) => s + a.week.done, 0);
      const pending = pendingCount();
      const total = pending + alerts.length + prepare.length;
      const d = new Date();
      head.innerHTML = `
        <div class="rd-head"><div><p class="rd-eyebrow">${DAYS[d.getDay()]} ${d.getDate()} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][d.getMonth()]}</p>
          <h1>${greeting()}. ${total ? `Tienes ${total} cosa${total === 1 ? '' : 's'} para hoy` : 'Todo al día'}</h1>
          <p class="rd-sub">${pending} sesi${pending === 1 ? 'ón' : 'ones'} por validar, ${alerts.length} alerta${alerts.length === 1 ? '' : 's'} y ${prepare.length} atleta${prepare.length === 1 ? '' : 's'} con la planificación por preparar.</p></div>
          <button type="button" class="btn secondary" data-rd-refresh>↻ Actualizar</button></div>
        <div class="rd-kpis">
          <div class="rd-kpi"><b>${pending}</b><span>Sesiones por validar</span></div>
          <div class="rd-kpi ${alerts.some(a => a.level === 'r') ? 'bad' : ''}"><b>${alerts.length}</b><span>Alertas</span></div>
          <div class="rd-kpi"><b>${prepare.length}</b><span>Planificación por preparar</span></div>
          <div class="rd-kpi"><b>${done} / ${planned}</b><span>Sesiones cumplidas esta semana</span></div>
        </div>`;
      if (!side) return;
      side.innerHTML = `
        <section class="rd-card"><p class="rd-eyebrow ${alerts.length ? 'red' : ''}">Alertas</p>${alerts.length ? alerts.map((x, i) => `
          <button type="button" class="rd-alert" data-rd-alert="${i}"><i class="rd-dot ${x.level}"></i><span><b>${esc(x.athlete.display_name)} · ${esc(x.title)}</b><small>${esc(x.text)}</small></span></button>`).join('') : '<p class="rd-muted">Sin alertas: nadie con dolor ni con la recuperación baja.</p>'}</section>
        <section class="rd-card"><p class="rd-eyebrow">Por preparar</p>${prepare.length ? prepare.map(a => `
          <div class="rd-prep"><span><b>${esc(a.display_name)}</b><small>${esc(a.plan.text)}</small></span><button type="button" class="btn rd-btn-lime small" data-rd-prepare="${esc(a.id)}">${a.plan.state === 'none' ? 'Crear plan' : 'Preparar'}</button></div>`).join('') : '<p class="rd-muted">Todas las planificaciones están al día.</p>'}</section>
        <section class="rd-card"><p class="rd-eyebrow">Hoy entrenan</p>${athletes.flatMap(a => a.today.map(w => ({ a, w }))).map(({ a, w }) => `<p class="rd-today"><i class="rd-dot ${w.execution_status === 'completed' ? 'g' : 'n'}"></i>${esc(a.display_name)} · ${esc(w.title || w.sport || 'Sesión')}</p>`).join('') || '<p class="rd-muted">Nadie tiene sesión hoy.</p>'}</section>`;
      qa('[data-rd-alert]', side).forEach(b => b.onclick = () => { const x = alerts[Number(b.dataset.rdAlert)]; openFicha(x.athlete.id, x.action === 'evolution' ? 'evolution' : 'plan'); });
      qa('[data-rd-prepare]', side).forEach(b => b.onclick = () => openFicha(b.dataset.rdPrepare, 'plan'));
    };
    // Coloca la cola de validación a la izquierda y la columna de alertas a la derecha.
    const layout = () => {
      const dash = q('#v8TeamDashboard'); if (!dash) return false;
      if (!q('#rdReviewGrid')) {
        const grid = document.createElement('div'); grid.id = 'rdReviewGrid';
        grid.innerHTML = '<div id="rdReviewMain"></div><aside id="rdReviewSide"></aside>';
        dash.before(grid); q('#rdReviewMain').appendChild(dash);
      }
      side = q('#rdReviewSide');
      return true;
    };
    layout();
    paint(teamCache);
    head.onclick = e => { if (e.target.closest('[data-rd-refresh]')) { q('#v8RefreshDashboard')?.click(); loadTeam(true).then(paint).catch(() => {}); } };
    try { paint(await loadTeam()); } catch (error) { if (side) side.innerHTML = `<section class="rd-card"><p class="rd-muted">${esc(error.message)}</p></section>`; }
    // La cola de validación se rellena aparte (coach-v8-runtime): actualizamos los números cuando cambia.
    const queue = q('#v8TeamDashboard');
    if (queue && !queue.dataset.rdObserved) { queue.dataset.rdObserved = '1'; new MutationObserver(() => { layout(); if (current === 'review') paint(teamCache); }).observe(queue, { childList: true, subtree: true }); }
  }

  // ---------- Atletas ----------
  let athleteFilter = 'all';
  async function renderAthletes() {
    const root = q('#rdAthletesRoot'); if (!root) return;
    const draw = team => {
      const all = team?.athletes || [];
      const counts = { all: all.length, running: all.filter(a => !a.footballMode).length, football: all.filter(a => a.footballMode).length, none: all.filter(a => a.plan.state === 'none').length };
      const shown = all.filter(a => athleteFilter === 'all' || (athleteFilter === 'running' && !a.footballMode) || (athleteFilter === 'football' && a.footballMode) || (athleteFilter === 'none' && a.plan.state === 'none'));
      root.innerHTML = `
        <div class="rd-head"><div><p class="rd-eyebrow">Tu equipo</p><h1>Atletas</h1><p class="rd-sub">Pincha en un atleta para ver sus datos, su planificación, su calendario, sus sesiones y su evolución.</p></div>
          <div class="rd-filters">${[['all', 'Todos'], ['running', 'Running'], ['football', 'Fútbol'], ['none', 'Sin plan']].map(([k, l]) => `<button type="button" class="rd-chip ${athleteFilter === k ? 'on' : ''}" data-rd-filter="${k}">${l} ${counts[k]}</button>`).join('')}
          <button type="button" class="btn primary" data-rd-new>+ Nuevo atleta</button></div></div>
        ${team ? `<div class="rd-grid">${shown.map(card).join('')}<button type="button" class="rd-card rd-add" data-rd-manage><b>Gestionar atletas</b><small>Archivar, accesos a la app y conexiones</small></button></div>` : '<div class="rd-card rd-muted">Cargando atletas…</div>'}`;
    };
    draw(teamCache);
    try { draw(await loadTeam()); } catch (error) { root.innerHTML = `<div class="rd-card">${esc(error.message)}</div>`; }
  }

  function card(a) {
    const badge = a.alerts.some(x => x.level === 'r') ? ['r', 'Dolor'] : a.plan.state === 'none' ? ['n', 'Sin plan'] : a.plan.state === 'prepare' ? ['a', 'Por preparar'] : ['g', 'Al día'];
    const rd = a.readiness;
    const rdDot = rd === null ? '' : `<i class="rd-dot ${rd >= 65 ? 'g' : rd >= 45 ? 'a' : 'r'}"></i> `;
    const sub = a.footballMode ? 'Fútbol' : a.next_goal ? `Running · ${esc(a.next_goal.name)} ${shortDate(a.next_goal.goal_date)}` : 'Running · sin objetivo';
    return `<button type="button" class="rd-acard" data-rd-athlete="${esc(a.id)}">
      <div class="rd-acard-top">${avatar(a)}<span><b>${esc(a.display_name)}</b><small>${sub}</small></span><em class="rd-pill ${badge[0]}">${badge[1]}</em></div>
      <div class="rd-st"><span>Planificación</span><b class="${a.plan.state === 'none' ? 'red' : ''}">${esc(a.plan.text)}</b></div>
      <div class="rd-st"><span>Readiness hoy</span><b>${rd === null ? 'Sin dato' : rdDot + rd}</b></div>
      <div class="rd-st"><span>Esta semana</span><b>${a.footballMode && a.football ? `${a.football.football ?? 0} entrenos · ${a.football.matches ?? 0} partidos` : `${a.week.done} de ${a.week.planned} sesiones`}</b></div>
      <div class="rd-st"><span>Última actividad</span><b>${relDate(a.last_activity_date)}</b></div>
    </button>`;
  }

  function onAthletesClick(event) {
    const t = event.target.closest('button'); if (!t) return;
    if (t.dataset.rdAthlete) openFicha(t.dataset.rdAthlete, 'plan');
    if (t.dataset.rdFilter) { athleteFilter = t.dataset.rdFilter; renderAthletes(); }
    if (t.hasAttribute('data-rd-new')) q('#newAthlete')?.click();
    if (t.hasAttribute('data-rd-manage')) { fichaOpen = false; setActive('athletes'); clickLegacy('athletes'); }
  }

  // ---------- Ajustes ----------
  let settingsTab = 'general';
  async function renderSettings() {
    const root = q('#rdSettingsRoot'); if (!root) return;
    let me = null; try { me = (await api('/api/auth/me')).user; } catch {}
    let team = teamCache; try { team = await loadTeam(); } catch {}
    const athletes = team?.athletes || [];
    const connected = athletes.filter(a => /connect|ok|active/i.test(a.intervals_status || ''));
    const notConnected = athletes.filter(a => !connected.includes(a));
    const appPending = athletes.filter(a => a.app_access_status === 'pending');
    const tabs = `<div class="rd-tabs rd-settings-tabs" role="tablist">${[['general', 'General'], ['connections', 'Conexiones']].map(([k, label]) => `<button type="button" role="tab" data-rd-settings-tab="${k}" class="${settingsTab === k ? 'on' : ''}">${label}</button>`).join('')}</div>`;
    const head = `<div class="rd-head"><div><p class="rd-eyebrow">Tu cuenta</p><h1>Ajustes</h1><p class="rd-sub">Lo que se toca poco, en un solo sitio.</p></div></div>${tabs}`;
    if (settingsTab === 'connections') {
      root.innerHTML = `${head}
      <div class="rd-settings-connections">
        <section class="rd-card"><p class="rd-eyebrow">Intervals.icu</p>
          <p class="rd-muted">De aquí salen las actividades, la carga y la recuperación de cada atleta. Cada atleta tiene su propia clave.</p>
          ${athletes.map(a => `<div class="rd-st"><span>${esc(a.display_name)}</span><b>${connected.includes(a) ? 'Conectado' : `<span class="amber">Sin conectar</span>`} · <button type="button" class="rd-link" data-rd-connect-athlete="${esc(a.id)}">${connected.includes(a) ? 'Cambiar la clave' : 'Conectar'}</button></b></div>`).join('') || '<p class="rd-muted">Todavía no hay atletas.</p>'}</section>
        <div id="rdAssistantHost"></div>
      </div>`;
      window.RunFlowAssistantPanel?.mount(q('#rdAssistantHost'));
      return;
    }
    root.innerHTML = `${head}
      <div class="rd-two">
        <section class="rd-card"><p class="rd-eyebrow">Mi cuenta</p>
          <div class="rd-st"><span>Nombre</span><b>${esc(me?.display_name || me?.name || '—')}</b></div>
          <div class="rd-st"><span>Email</span><b>${esc(me?.email || '—')}</b></div>
          <div class="rd-st"><span>Sesión</span><b><button type="button" class="rd-link" data-rd-logout>Cerrar sesión</button></b></div></section>
        <section class="rd-card"><p class="rd-eyebrow">Intervals.icu</p>
          <div class="rd-st"><span>Atletas conectados</span><b>${connected.length} de ${athletes.length}</b></div>
          <div class="rd-st"><span>Sin conectar</span><b class="${notConnected.length ? 'amber' : ''}">${notConnected.map(a => esc(a.display_name)).join(', ') || 'Ninguno'}</b></div>
          <div class="rd-st"><span>Conectar o cambiar la clave</span><b><button type="button" class="rd-link" data-rd-settings-tab="connections">Abrir conexiones</button></b></div></section>
        <section class="rd-card"><p class="rd-eyebrow">Atletas</p>
          <div class="rd-st"><span>Activos</span><b>${athletes.length}</b></div>
          <div class="rd-st"><span>Sin acceso a la app todavía</span><b>${appPending.map(a => esc(a.display_name)).join(', ') || 'Ninguno'}</b></div>
          <div class="rd-st"><span>Altas, bajas y accesos</span><b><button type="button" class="rd-link" data-rd-manage>Gestionar atletas</button></b></div></section>
        <section class="rd-card"><p class="rd-eyebrow">Cuándo te avisamos en «Para revisar»</p>
          <div class="rd-st"><span>Dolor</span><b>A partir de 5 / 10 (últimos 3 días)</b></div>
          <div class="rd-st"><span>Readiness bajo</span><b>Por debajo de 50</b></div>
          <div class="rd-st"><span>Planificación</span><b>Sin plan o semana que viene vacía</b></div></section>
        <section class="rd-card"><p class="rd-eyebrow">Aspecto de la web</p>
          <p class="rd-muted">Si necesitas algo de la versión anterior del menú, puedes volver a ella y regresar cuando quieras.</p>
          <button type="button" class="btn secondary" data-rd-classic>Usar la versión anterior</button></section>
      </div>`;
  }

  function onSettingsClick(event) {
    const t = event.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-rd-classic')) { try { localStorage.setItem(STORE, 'clasica'); } catch {} location.reload(); }
    if (t.hasAttribute('data-rd-manage')) { setActive('athletes'); clickLegacy('athletes'); }
    if (t.hasAttribute('data-rd-connections')) { const first = (teamCache?.athletes || []).find(a => !/connect/i.test(a.intervals_status || '')) || { id: selectedId() }; openFicha(first.id, 'connections'); }
    if (t.dataset.rdSettingsTab) { settingsTab = t.dataset.rdSettingsTab; renderSettings(); }
    if (t.dataset.rdConnectAthlete) openFicha(t.dataset.rdConnectAthlete, 'connections');
    if (t.hasAttribute('data-rd-logout')) q('#rfSessionLogout')?.click();
  }

  // Iconos de línea (Lucide, licencia ISC): 24×24, trazo 2, puntas redondas.
  const ICONS = {
    review: '<path d="M20 6 9 17l-5-5"/>',
    athletes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    messages: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  };
  const icon = name => `<span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg></span>`;

  // ---------- Montaje ----------
  function buildSidebar() {
    const sidebar = q('.v8-sidebar'); if (!sidebar || q('.rd-nav', sidebar)) return;
    const nav = document.createElement('nav'); nav.className = 'v8-nav rd-nav'; nav.setAttribute('aria-label', 'Menú principal');
    nav.innerHTML = `
      <button type="button" data-rd="review">${icon('review')}<span>Para revisar</span><span class="rd-count" id="rdReviewCount"></span></button>
      <button type="button" data-rd="athletes">${icon('athletes')}<span>Atletas</span><span class="rd-count g" id="rdAthleteCount"></span></button>
      <button type="button" data-rd="library">${icon('library')}<span>Biblioteca</span></button>
      <button type="button" data-rd="messages">${icon('messages')}<span>Mensajes</span></button>`;
    (q('.rf-session-box', sidebar) || q('.v8-team', sidebar) || q('.v8-brand', sidebar)).after(nav);
    const bottom = document.createElement('nav'); bottom.className = 'v8-nav rd-nav rd-nav-bottom';
    bottom.innerHTML = `<button type="button" data-rd="settings">${icon('settings')}<span>Ajustes</span></button>`;
    const foot = q('.v8-sidebar-foot', sidebar); if (foot) foot.before(bottom); else sidebar.appendChild(bottom);
    qa('[data-rd]', sidebar).forEach(b => b.addEventListener('click', () => go(b.dataset.rd)));
  }

  function buildViews() {
    const shell = q('main.shell'); if (!shell || q('#rdAthletesView')) return;
    const fichaHost = document.createElement('div'); fichaHost.id = 'rdFicha';
    (q('#globalMessage', shell) || q('.page-head', shell)).after(fichaHost);
    fichaHost.addEventListener('click', onFichaClick);
    const athletes = document.createElement('section'); athletes.id = 'rdAthletesView'; athletes.className = 'view';
    athletes.innerHTML = '<div id="rdAthletesRoot"></div>'; shell.appendChild(athletes);
    athletes.addEventListener('click', onAthletesClick);
    const settings = document.createElement('section'); settings.id = 'rdSettingsView'; settings.className = 'view';
    settings.innerHTML = '<div id="rdSettingsRoot"></div>'; shell.appendChild(settings);
    settings.addEventListener('click', onSettingsClick);
  }

  function counters() {
    const pending = qa('#v8ValidationQueue .v8-validation-row').length;
    const set = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
    set(q('#rdReviewCount'), pending ? String(pending) : '');
    const n = q('#athleteSelect')?.options.length || 0;
    set(q('#rdAthleteCount'), n ? String(n) : '');
  }

  function mount() {
    if (!q('#v8GeneralNav') || !q('#v8AthleteNav') || typeof window.switchView !== 'function') return false;
    document.body.classList.add('rd-mode');
    buildSidebar(); buildViews();
    // Si otra parte de la web cambia de atleta, la cabecera de la ficha lo sigue.
    q('#athleteSelect')?.addEventListener('change', () => setTimeout(() => { if (fichaOpen) renderFichaHead(); }, 300));
    // Si coach-v8-runtime vuelve a pintar el menú (cambio de atleta), recolocamos el nuestro.
    new MutationObserver(() => { if (!q('.v8-sidebar .rd-nav')) { buildSidebar(); setActive(current); } counters(); }).observe(q('.v8-sidebar'), { childList: true, subtree: true });
    new MutationObserver(counters).observe(q('main.shell'), { childList: true, subtree: true });
    go('review');
    loadTeam().then(counters).catch(() => {});
    return true;
  }

  if (classicRequested()) {
    // Versión anterior: añadimos solo un acceso para volver a la nueva.
    const addBack = () => {
      const s = q('.v8-sidebar-foot'); if (!s || q('#rdBackToNew')) return;
      const b = document.createElement('button'); b.id = 'rdBackToNew'; b.type = 'button'; b.className = 'btn soft small'; b.style.marginBottom = '10px'; b.textContent = 'Probar el menú nuevo';
      b.onclick = () => { try { localStorage.removeItem(STORE); } catch {} location.href = location.pathname; };
      s.prepend(b);
    };
    // El menú se reconstruye varias veces al arrancar: lo volvemos a poner cuando falta.
    setInterval(addBack, 1000);
    return;
  }
  let tries = 0;
  // Esperamos además a que Evolución y Fútbol hayan montado su vista (o a ~3 s).
  const timer = setInterval(() => {
    tries++;
    const ready = q('#v8AthleteNav') && ((q('#v8EvolutionNav') && q('#v8FootballNav')) || tries > 30);
    if (ready && mount()) clearInterval(timer);
    else if (tries > 150) clearInterval(timer);
  }, 100);
  window.RunFlowCoachRedesign = { go, openFicha, reload: () => loadTeam(true) };
})();
