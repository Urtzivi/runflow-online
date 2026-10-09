// RunFlow Coach · Evolución del atleta.
// Vista completa de un deportista: últimas semanas, sesiones, readiness y datos fisiológicos.
// Solo lectura: usa los endpoints existentes de Coach y no modifica datos.
(() => {
  const VIEW = 'evolution';
  const PERIODS = [4, 8, 12];
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const pad = n => String(n).padStart(2, '0');
  const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoLocal(new Date());
  const addDays = (iso, days) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return isoLocal(d); };
  const mondayOf = iso => { const d = new Date(`${iso}T12:00:00`); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return isoLocal(d); };
  const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
  const shortDate = iso => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(`${iso}T12:00:00`)).replace('.', '');
  const dayDate = iso => { const s = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T12:00:00`)).replace(/\./g, '').replace(',', ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  const fmtNum = (value, digits = 0) => value === null ? '—' : Number(value).toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const fmtPace = sec => { const s = num(sec); if (s === null || s <= 0) return '—'; const r = Math.round(s); return `${Math.floor(r / 60)}:${pad(r % 60)}`; };
  const fmtDuration = sec => { const s = num(sec); if (s === null || s <= 0) return '—'; const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)}` : `${m} min`; };
  const fmtHours = hours => { const h = num(hours); if (h === null) return '—'; const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${pad(m % 60)}`; };
  const avg = values => { const list = values.map(num).filter(v => v !== null); return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null; };
  const signed = (value, digits = 0, suffix = '') => value === null ? '' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmtNum(Math.abs(value), digits)}${suffix}`;
  const training = () => window.RunFlowTraining;

  const intensityColor = text => {
    const t = String(text || '').toLowerCase();
    if (/fuerza|strength|core|gimnas|estabilidad|cadena posterior/.test(t)) return 'var(--v8-strength)';
    if (/vo2|vo₂|z5|velocidad aeróbica|repeticiones rápidas|ritmo 5k/.test(t)) return 'var(--v8-vo2)';
    if (/umbral|lt2|threshold|z4/.test(t)) return 'var(--v8-threshold)';
    if (/sweet|z3 alta|maratón|ritmo específico/.test(t)) return 'var(--v8-sweet)';
    if (/tempo|z3|economía/.test(t)) return 'var(--v8-tempo)';
    if (/z2|endurance|aeróbic|rodaje|tirada|trail|suave|regenerativo|recuperación/.test(t)) return 'var(--v8-z2)';
    return 'var(--v8-rest)';
  };
  const feelingLabel = value => ({ muy_bien: 'muy buenas', bien: 'buenas', normal: 'normales', mal: 'malas' }[value] || '');
  const isRest = workout => /rest|descanso/i.test(`${workout.sport || ''}`) || /^descanso/i.test(workout.title || '');
  const manualValidationKey = (athleteId, workout) => `rf_v8_manual_validation:${athleteId}:${workout.id}:${workout.manual_log?.created_at || ''}`;

  const ui = { weeks: Number(localStorageGet('rf_evolution_weeks')) || 8, data: null, loadingFor: '', reviewCache: new Map() };
  if (!PERIODS.includes(ui.weeks)) ui.weeks = 8;
  function localStorageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function localStorageSet(key, value) { try { localStorage.setItem(key, value); } catch {} }

  async function api(url) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar la información.');
    return data;
  }

  const selectedAthleteId = () => byId('athleteSelect')?.value || '';
  const isActive = () => byId('evolutionView')?.classList.contains('active');

  // ---------- Montaje en Coach ----------
  function mount() {
    const shell = document.querySelector('main.shell');
    const tabs = shell?.querySelector('.tabs');
    // El menú definitivo lo construye coach-v8-runtime.js (#v8AthleteNav): esperamos a que exista.
    const athleteNav = document.getElementById('v8AthleteNav');
    if (!shell || !tabs || !athleteNav || typeof window.switchView !== 'function') return false;
    if (byId('evolutionView')) return true;

    const tab = document.createElement('button');
    tab.className = 'tab'; tab.dataset.view = VIEW; tab.type = 'button'; tab.textContent = 'Evolución';
    tab.addEventListener('click', () => window.switchView(VIEW));
    const athletesTab = tabs.querySelector('[data-view="athletes"]');
    if (athletesTab) athletesTab.after(tab); else tabs.appendChild(tab);

    const view = document.createElement('section');
    view.id = 'evolutionView'; view.className = 'view'; view.style.marginTop = '18px';
    view.innerHTML = '<div id="evoRoot" class="evo"></div>';
    (byId('athletesView') || shell.querySelector('.view:last-of-type')).after(view);

    const navButton = document.createElement('button');
    navButton.type = 'button'; navButton.dataset.v8 = VIEW; navButton.id = 'v8EvolutionNav';
    navButton.innerHTML = '<span class="ico">↗</span><span>Evolución</span>';
    navButton.addEventListener('click', () => {
      document.querySelectorAll('.v8-nav button').forEach(button => button.classList.toggle('active', button === navButton));
      tab.click();
    });
    athleteNav.prepend(navButton);

    new MutationObserver(() => { if (isActive()) ensureLoaded(); }).observe(view, { attributes: true, attributeFilter: ['class'] });
    byId('athleteSelect')?.addEventListener('change', () => { ui.data = null; if (isActive()) ensureLoaded(); });
    let resizeTimer = null;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (isActive() && ui.data) render(); }, 150); });
    return true;
  }

  function ensureLoaded(force = false) {
    const athleteId = selectedAthleteId();
    if (!athleteId) { renderMessage('Selecciona un deportista para ver su evolución.'); return; }
    const key = `${athleteId}:${ui.weeks}`;
    if (!force && ui.data && ui.data.key === key) return;
    if (!force && ui.loadingFor === key) return;
    load(athleteId, force).catch(error => renderMessage(error.message));
  }

  // ---------- Datos ----------
  async function load(athleteId, sync) {
    const key = `${athleteId}:${ui.weeks}`;
    ui.loadingFor = key;
    if (!ui.data || ui.data.key !== key) renderMessage(sync ? 'Sincronizando con Intervals.icu…' : 'Cargando la evolución del atleta…');
    else setSyncing(true);
    const now = today();
    const monday = mondayOf(now);
    const firstWeek = addDays(monday, -7 * (ui.weeks - 1));
    const recoveryDays = Math.max(ui.weeks * 7, 28) + 21;
    const id = encodeURIComponent(athleteId);
    const syncParam = sync ? '&sync=1' : '';
    const [athleteRes, calendarRes, recoveryRes, performanceRes] = await Promise.allSettled([
      api(`/api/coach/athletes/${id}?week_start=${monday}`),
      api(`/api/coach/athletes/${id}/calendar?oldest=${firstWeek}&newest=${addDays(monday, 6)}${syncParam}`),
      api(`/api/coach/athletes/${id}/recovery?oldest=${addDays(now, -recoveryDays)}&newest=${now}${syncParam}`),
      api(`/api/coach/athletes/${id}/performance?days=${Math.max(84, ui.weeks * 7)}`),
    ]);
    if (ui.loadingFor !== key) return;
    ui.loadingFor = '';
    if (athleteRes.status !== 'fulfilled') throw athleteRes.reason;
    const errors = [calendarRes, recoveryRes, performanceRes].filter(r => r.status === 'rejected').map(r => r.reason?.message).filter(Boolean);
    ui.data = {
      key, athleteId, now, monday, firstWeek,
      athlete: athleteRes.value.athlete || {},
      weeks: calendarRes.status === 'fulfilled' ? calendarRes.value.weeks || [] : [],
      recovery: recoveryRes.status === 'fulfilled' ? (recoveryRes.value.rows || []).slice().sort((a, b) => String(a.metric_date).localeCompare(String(b.metric_date))) : [],
      performance: performanceRes.status === 'fulfilled' ? performanceRes.value || {} : {},
      errors: [...new Set(errors)],
    };
    ui.data.model = buildModel(ui.data);
    if (isActive()) render();
    loadReviewStates(ui.data);
  }

  function buildModel(data) {
    const { athlete, weeks, recovery, performance, now, monday, firstWeek } = data;
    const model = training();
    const result = { athlete, weeks };
    const records = model ? model.records(result).filter(r => r.date && r.date <= now) : [];
    const published = weeks.filter(w => (w.publication_status || w.status) === 'published');
    const plannedWorkouts = published.flatMap(w => w.workouts || []).filter(w => !isRest(w));
    const done = w => ['completed', 'partial'].includes(w.execution_status) && !(w.activities || []).some(a => model?.mismatch(w.sport, a.sport));

    const weekRows = [];
    for (let start = firstWeek; start <= monday; start = addDays(start, 7)) {
      const end = addDays(start, 6);
      const planned = plannedWorkouts.filter(w => w.workout_date >= start && w.workout_date <= end);
      const recs = records.filter(r => r.date >= start && r.date <= end);
      const typeWeek = weeks.find(w => w.week_start === start && (w.publication_status || w.status) === 'published') || weeks.find(w => w.week_start === start);
      const ctlRow = [...recovery].reverse().find(r => r.metric_date <= end && num(r.fitness) !== null);
      weekRows.push({
        start, end, current: start === monday,
        type: typeWeek?.week_type || '',
        plannedLoad: planned.reduce((s, w) => s + (num(w.planned_load) || 0), 0),
        doneLoad: recs.reduce((s, r) => s + (r.load ?? 0), 0),
        plannedCount: planned.length,
        doneCount: planned.filter(done).length,
        km: recs.reduce((s, r) => s + (num(r.activity?.distance_m) || 0), 0) / 1000,
        ctl: ctlRow ? num(ctlRow.fitness) : null,
      });
    }

    // Sesiones: actividades y registros realizados + sesiones publicadas que ya pasaron sin hacerse.
    const sessions = records.map(r => ({ ...r, status: 'done' }));
    for (const w of plannedWorkouts) {
      if (w.workout_date >= now) continue;
      if (['planned', 'skipped'].includes(w.execution_status) && !(w.activities || []).length) sessions.push({ type: 'missed', workout: w, date: w.workout_date, status: w.execution_status === 'skipped' ? 'skipped' : 'missed' });
    }
    sessions.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.activity?.activity_date || '').localeCompare(String(a.activity?.activity_date || '')));

    const latestWell = [...recovery].reverse().find(r => num(r.fitness) !== null) || null;
    const well28 = latestWell ? [...recovery].reverse().find(r => r.metric_date <= addDays(latestWell.metric_date, -28) && num(r.fitness) !== null) : null;
    const snapshot = performance.latest || null;
    const snapshotFresh = snapshot && daysBetween(String(snapshot.snapshot_date).slice(0, 10), now) <= 2;

    const last28 = addDays(now, -27), last7 = addDays(now, -6);
    const planned28 = plannedWorkouts.filter(w => w.workout_date >= last28 && w.workout_date <= now);
    const logs = weeks.flatMap(w => w.workouts || []).filter(w => w.manual_log).map(w => ({ ...w.manual_log, workout_date: w.workout_date })).sort((a, b) => String(b.created_at || b.workout_date).localeCompare(String(a.created_at || a.workout_date)));
    const logs7 = logs.filter(l => String(l.created_at || l.workout_date).slice(0, 10) >= last7);
    const painLogs = logs7.filter(l => num(l.pain) !== null);
    const maxPainLog = painLogs.sort((a, b) => num(b.pain) - num(a.pain))[0] || null;

    return {
      weekRows, sessions, latestWell, snapshot, snapshotFresh,
      fitnessChange28: latestWell && well28 ? num(latestWell.fitness) - num(well28.fitness) : num(snapshot?.fitness_change_28d),
      thisWeek: weekRows.at(-1) || null,
      load28: records.filter(r => r.date >= last28).reduce((s, r) => s + (r.load ?? 0), 0),
      compliance: snapshotFresh && num(snapshot.consistency_28d) !== null
        ? { pct: num(snapshot.consistency_28d), done: num(snapshot.completed_sessions_28d), planned: num(snapshot.planned_sessions_28d) }
        : planned28.length ? { pct: planned28.filter(done).length / planned28.length * 100, done: planned28.filter(done).length, planned: planned28.length } : null,
      perception: {
        rpe: snapshotFresh && num(snapshot.avg_rpe_7d) !== null ? num(snapshot.avg_rpe_7d) : avg(logs7.map(l => l.rpe)),
        pain: snapshotFresh && num(snapshot.max_pain_7d) !== null ? num(snapshot.max_pain_7d) : (maxPainLog ? num(maxPainLog.pain) : null),
        painArea: (snapshotFresh && snapshot.latest_pain_area) || maxPainLog?.pain_area || '',
        count: snapshotFresh && num(snapshot.details?.feedback_count_7d) !== null ? num(snapshot.details.feedback_count_7d) : logs7.length,
      },
      lastLog: logs[0] || null,
    };
  }

  async function loadReviewStates(data) {
    const pending = data.model.sessions.slice(0, 8).filter(s => s.type === 'intervals' && s.activity?.intervals_activity_id);
    await Promise.all(pending.map(async s => {
      const key = `${data.athleteId}:${s.activity.intervals_activity_id}`;
      if (ui.reviewCache.has(key)) return;
      try {
        const detail = await api(`/api/coach/athletes/${encodeURIComponent(data.athleteId)}/activities/${encodeURIComponent(s.activity.intervals_activity_id)}/review`);
        ui.reviewCache.set(key, detail.review?.decision ? 'validated' : 'pending');
      } catch { ui.reviewCache.set(key, 'unknown'); }
    }));
    if (ui.data === data && isActive()) renderSessions();
  }

  // ---------- Render ----------
  function renderMessage(text) {
    const root = byId('evoRoot'); if (!root) return;
    root.innerHTML = `<div class="evo-card evo-empty-state">${esc(text)}</div>`;
  }

  function setSyncing(on) {
    const button = byId('evoSync');
    if (button) { button.disabled = on; button.textContent = on ? 'Sincronizando…' : '↻ Sincronizar'; }
  }

  function render() {
    const root = byId('evoRoot'); const data = ui.data;
    if (!root || !data) return;
    root.innerHTML = `
      <div class="evo-head">
        <div><p class="evo-eyebrow">Evolución del atleta</p><h2>${esc(data.athlete.display_name || 'Deportista')}</h2><p class="evo-muted">Cómo llega, cómo ha entrenado y cómo responde su cuerpo.</p></div>
        <div class="evo-controls">
          <div><span class="evo-label">Periodo</span><div class="evo-seg" role="group" aria-label="Periodo">${PERIODS.map(p => `<button type="button" data-evo-weeks="${p}" class="${p === ui.weeks ? 'on' : ''}">${p} sem</button>`).join('')}</div></div>
          <button type="button" id="evoSync" class="evo-btn">↻ Sincronizar</button>
        </div>
      </div>
      ${data.errors.length ? `<div class="evo-warning">Algunos datos no se han podido cargar: ${esc(data.errors.join(' · '))}</div>` : ''}
      ${athleteStrip(data)}
      <div class="evo-grid evo-kpis">${kpis(data)}</div>
      <div class="evo-grid evo-row2">
        <section class="evo-card"><div class="evo-card-head"><div><h3>Últimas semanas</h3><p class="evo-sub">Carga planificada frente a realizada y evolución de la aptitud</p></div>
          <div class="evo-legend"><span><i style="background:#dfe3db"></i>Planificada</span><span><i style="background:var(--v8-lime)"></i>Realizada</span><span><i class="line"></i>Aptitud</span></div></div>
          <svg id="evoWeeksChart" class="evo-chart" height="200" role="img" aria-label="Carga semanal planificada y realizada"></svg>
          <div class="evo-table-wrap">${weeksTable(data)}</div>
        </section>
        <section class="evo-card"><div class="evo-card-head"><div><h3>Readiness y recuperación</h3><p class="evo-sub">Últimos 28 días · línea discontinua = su media de 21 días</p></div></div>
          ${recoveryBlock(data)}
        </section>
      </div>
      <div class="evo-grid evo-row3">
        <section class="evo-card">${physiology(data)}</section>
        <section class="evo-card"><div class="evo-card-head"><div><h3>Últimas sesiones</h3><p class="evo-sub">Plan frente a lo realizado, con el feedback del atleta</p></div><button type="button" class="evo-btn small" data-evo-go="activities">Ver todas en Actividades →</button></div>
          <div class="evo-table-wrap" id="evoSessions"></div>
        </section>
      </div>`;
    root.querySelectorAll('[data-evo-weeks]').forEach(button => button.addEventListener('click', () => {
      ui.weeks = Number(button.dataset.evoWeeks); localStorageSet('rf_evolution_weeks', String(ui.weeks)); ensureLoaded();
    }));
    byId('evoSync')?.addEventListener('click', () => ensureLoaded(true));
    root.querySelector('[data-evo-go="activities"]')?.addEventListener('click', () => {
      const nav = document.querySelector('#v8AthleteNav [data-v8="activities"]');
      if (nav) nav.click(); else window.switchView('activities');
    });
    drawGauge(data); drawWeeksChart(data); drawReadiness(data); drawSparks(data);
    renderSessions();
  }

  function athleteStrip(data) {
    const a = data.athlete, p = a.profile || {};
    const age = p.birth_date ? Math.floor(daysBetween(p.birth_date, data.now) / 365.25) : null;
    const chips = [
      [age !== null ? `${age} años` : '', p.sex === 'M' ? 'H' : p.sex === 'F' ? 'M' : ''].filter(Boolean).join(' · '),
      [num(p.weight_kg) ? `${fmtNum(num(p.weight_kg), num(p.weight_kg) % 1 ? 1 : 0)} kg` : '', num(p.height_cm) ? `${fmtNum(num(p.height_cm))} cm` : ''].filter(Boolean).join(' · '),
      [p.watch_brand, p.watch_model].filter(Boolean).join(' '),
    ].filter(Boolean).map(t => `<span class="evo-chip">${esc(t)}</span>`);
    chips.push(a.intervals_status === 'connected' ? '<span class="evo-chip ok">Intervals.icu conectado</span>' : '<span class="evo-chip warn">Intervals.icu sin conectar</span>');
    if (a.week?.week_type) chips.push(`<span class="evo-chip">Bloque: ${esc(a.week.week_type)}</span>`);
    if (p.objective) chips.push(`<span class="evo-chip">Objetivo: ${esc(p.objective)}</span>`);
    const goals = (a.goals || []).filter(g => g.goal_date && g.goal_date >= data.now && (g.status || 'active') === 'active')
      .sort((x, y) => String(x.goal_date).localeCompare(String(y.goal_date))).slice(0, 2);
    const initials = String(a.display_name || '?').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
    return `<section class="evo-card evo-athlete">
      <div class="evo-avatar">${esc(initials)}</div>
      <div><h3>${esc(a.display_name || 'Deportista')}${p.level ? ` · ${esc(p.level)}` : ''}</h3><div class="evo-chips">${chips.join('')}</div></div>
      <div class="evo-goals">${goals.length ? goals.map(g => `<div class="evo-goal ${/principal/i.test(g.priority || '') ? 'main' : ''}"><strong>${daysBetween(data.now, g.goal_date)}</strong><div><b>${esc(g.name)}</b><small>${esc(g.priority || 'Objetivo')} · ${shortDate(g.goal_date)}</small></div></div>`).join('') : '<div class="evo-goal"><div><b>Sin objetivos activos</b><small>Añádelos en Objetivos</small></div></div>'}</div>
    </section>`;
  }

  function readinessInfo(data) {
    const s = data.model.snapshot, m = data.athlete.metrics || {};
    const score = num(s?.readiness_score) ?? num(m.readiness_score);
    const label = s?.readiness_label || m.readiness_label || 'Sin datos suficientes';
    const explanation = s?.readiness_explanation || (score !== null && typeof window.readinessCopy === 'function' ? window.readinessCopy({ ...m, readiness_score: score }) : '');
    return { score, label, explanation, date: s?.snapshot_date || m.metric_date || null };
  }

  function kpis(data) {
    const r = readinessInfo(data), md = data.model;
    const log = md.lastLog;
    const logText = log ? `Último feedback: ${[num(log.rpe) !== null ? `RPE ${fmtNum(num(log.rpe))}` : '', feelingLabel(log.feeling) ? `sensaciones ${feelingLabel(log.feeling)}` : '', num(log.pain) ? `dolor ${fmtNum(num(log.pain))}/10${log.pain_area ? ` (${log.pain_area})` : ''}` : (num(log.pain) === 0 ? 'sin dolor' : '')].filter(Boolean).join(', ')}.` : '';
    const w = md.latestWell;
    const form = w ? num(w.form) ?? (num(w.fitness) - num(w.fatigue)) : null;
    const tw = md.thisWeek;
    const loadPct = tw && tw.plannedLoad ? Math.min(100, tw.doneLoad / tw.plannedLoad * 100) : 0;
    const comp = md.compliance, perc = md.perception;
    return `
      <section class="evo-card evo-ready">
        <svg id="evoGauge" width="104" height="104" aria-hidden="true"></svg>
        <div><p class="evo-eyebrow">Readiness ${r.date && r.date.slice(0, 10) !== data.now ? `· ${shortDate(r.date.slice(0, 10))}` : 'hoy'}</p><h4>${esc(r.label)}</h4>
          <p>${esc([r.explanation, logText].filter(Boolean).join(' ') || 'Sin datos de recuperación recientes.')}</p></div>
      </section>
      <section class="evo-card evo-kpi"><p class="evo-eyebrow">Aptitud · Fatiga · Forma</p>
        ${w ? `<div class="evo-triplet"><div><b>${fmtNum(num(w.fitness))}</b><span>Aptitud</span></div><div><b>${fmtNum(num(w.fatigue))}</b><span>Fatiga</span></div><div><b class="${form < -20 ? 'down' : form < -5 ? 'mid' : 'up'}">${signed(Math.round(form)) || '0'}</b><span>Forma</span></div></div>
        <p class="evo-note">${md.fitnessChange28 !== null ? `<span class="${md.fitnessChange28 >= 0 ? 'up' : 'down'}">${signed(md.fitnessChange28, 0)}</span> de aptitud en 28 días` : 'Tendencia en construcción'}</p>` : '<p class="evo-note">Sin datos de Intervals.icu todavía.</p>'}
      </section>
      <section class="evo-card evo-kpi"><p class="evo-eyebrow">Carga esta semana</p>
        <div class="evo-val">${fmtNum(tw ? Math.round(tw.doneLoad) : null)} <small>/ ${fmtNum(tw ? Math.round(tw.plannedLoad) : null)} plan.</small></div>
        <div class="evo-bar"><i style="width:${loadPct}%"></i></div><p class="evo-note">28 días: ${fmtNum(Math.round(md.load28))} puntos</p>
      </section>
      <section class="evo-card evo-kpi"><p class="evo-eyebrow">Cumplimiento 28 d</p>
        ${comp ? `<div class="evo-val">${fmtNum(Math.round(comp.pct))}<small>%</small></div><div class="evo-bar"><i style="width:${Math.min(100, comp.pct)}%"></i></div><p class="evo-note">${fmtNum(comp.done, comp.done % 1 ? 1 : 0)} de ${fmtNum(comp.planned)} sesiones hechas</p>` : '<div class="evo-val">—</div><p class="evo-note">Sin sesiones publicadas en 28 días.</p>'}
      </section>
      <section class="evo-card evo-kpi"><p class="evo-eyebrow">Percepción 7 d</p>
        <div class="evo-val">${perc.rpe !== null ? fmtNum(perc.rpe, 1) : '—'} <small>RPE medio</small></div>
        <p class="evo-note">${perc.pain !== null ? `Dolor máx. <b>${fmtNum(perc.pain)}/10</b>${perc.painArea ? ` · ${esc(perc.painArea)}` : ''}` : 'Sin dolor registrado'}</p>
        <p class="evo-note">${fmtNum(perc.count)} feedback${perc.count === 1 ? '' : 's'} registrado${perc.count === 1 ? '' : 's'}</p>
      </section>`;
  }

  function weeksTable(data) {
    const rows = data.model.weekRows;
    const pill = w => { if (!w.plannedCount) return '<span class="evo-pill n">—</span>'; const ratio = w.doneCount / w.plannedCount; return `<span class="evo-pill ${ratio >= 1 ? 'ok' : ratio >= .75 ? 'mid' : 'bad'}">${w.doneCount}/${w.plannedCount}</span>`; };
    const line = (label, fn) => `<tr><td>${label}</td>${rows.map(w => `<td>${fn(w)}</td>`).join('')}</tr>`;
    return `<table class="evo-weeks"><tbody>
      ${line('Tipo', w => esc(w.type || '—'))}
      ${line('Sesiones', pill)}
      ${line('Km', w => w.km ? fmtNum(w.km) : '—')}
      ${line('Cumpl. carga', w => w.plannedLoad ? `${fmtNum(Math.round(w.doneLoad / w.plannedLoad * 100))}%` : '—')}
    </tbody></table>`;
  }

  function recoveryBlock(data) {
    const rows = data.recovery;
    if (!rows.length) return '<div class="evo-empty">Sin datos de recuperación. Conecta Intervals.icu o pulsa Sincronizar.</div>';
    const s = recoveryStats(data);
    const line = (label, key, current, sub) => `<div class="evo-rec-line"><div class="evo-label">${label}</div><svg class="evo-spark" data-evo-spark="${key}" height="34" aria-hidden="true"></svg><div class="evo-rec-num">${current}<small>${sub}</small></div></div>`;
    const pct = (cur, base) => cur !== null && base ? (cur - base) / base * 100 : null;
    const hrvDelta = pct(s.hrv.current, s.hrv.base), rhrDelta = s.rhr.current !== null && s.rhr.base !== null ? s.rhr.current - s.rhr.base : null;
    return `<svg id="evoReadyChart" class="evo-chart" height="104" role="img" aria-label="Readiness de los últimos 28 días"></svg>
      <div class="evo-rec">
        ${line('HRV', 'hrv', s.hrv.current !== null ? `${fmtNum(s.hrv.current)} ms` : '—', s.hrv.base !== null ? `media ${fmtNum(s.hrv.base)}${hrvDelta !== null ? ` · <span class="${hrvDelta <= -10 ? 'down' : hrvDelta < 0 ? 'mid' : 'up'}">${signed(hrvDelta, 0, '%')}</span>` : ''}` : 'sin media')}
        ${line('Pulso reposo', 'rhr', s.rhr.current !== null ? `${fmtNum(s.rhr.current)} ppm` : '—', s.rhr.base !== null ? `media ${fmtNum(s.rhr.base)}${rhrDelta !== null ? ` · <span class="${rhrDelta >= 3 ? 'down' : rhrDelta > 0 ? 'mid' : 'up'}">${signed(Math.round(rhrDelta))}</span>` : ''}` : 'sin media')}
        ${line('Sueño', 'sleep', fmtHours(s.sleep.current), s.sleep.base !== null ? `media ${fmtHours(s.sleep.base)}` : 'sin media')}
      </div>`;
  }

  function recoveryStats(data) {
    const rows = data.recovery;
    const from = addDays(data.now, -27);
    const series = key => rows.filter(r => r.metric_date >= from).map(r => ({ date: r.metric_date, v: key === 'sleep' ? (num(r.sleep_sec) === null ? null : num(r.sleep_sec) / 3600) : num(r[key === 'rhr' ? 'resting_hr' : key]) }));
    const stat = key => {
      const all = rows.map(r => ({ date: r.metric_date, v: key === 'sleep' ? (num(r.sleep_sec) === null ? null : num(r.sleep_sec) / 3600) : num(r[key === 'rhr' ? 'resting_hr' : key]) })).filter(p => p.v !== null);
      const last = all.at(-1) || null;
      const base = last ? avg(all.filter(p => p.date < last.date).slice(-21).map(p => p.v)) : null;
      return { current: last ? last.v : null, base, series: series(key) };
    };
    return { hrv: stat('hrv'), rhr: stat('rhr'), sleep: stat('sleep') };
  }

  function physiology(data) {
    const perf = data.performance || {};
    const sum = perf.activity_summary || {};
    const profile = perf.intervals_run_profile || sum.intervals_run_profile || {};
    const zonesHr = (data.athlete.zones?.hr || []).slice().sort((a, b) => (num(a.zone_order) || 0) - (num(b.zone_order) || 0) || (num(a.min_value) || 0) - (num(b.min_value) || 0));
    const maxHr = num(profile.max_hr) ?? (zonesHr.length ? Math.max(...zonesHr.map(z => num(z.max_value) || 0)) || null : null);
    const lthr = num(profile.lthr) ?? num(sum.threshold_hr);
    const tiles = [];
    const tile = (label, value, note) => tiles.push(`<div class="evo-ph"><span>${label}</span><b>${value}</b><small>${note}</small></div>`);
    const change = (value, unit, betterWhenPositive = true, digits = 0) => value === null ? '' : `<span class="${(value >= 0) === betterWhenPositive ? 'up' : 'down'}">${signed(value, digits, unit)}</span>`;
    if (num(sum.threshold_pace_sec_per_km) !== null) {
      const ch = num(sum.threshold_pace_change_8w_sec);
      tile('Ritmo umbral', `${fmtPace(sum.threshold_pace_sec_per_km)} /km`, ch !== null ? `${ch > 0 ? `<span class="up">−${fmtNum(Math.abs(ch))} s</span>` : ch < 0 ? `<span class="down">+${fmtNum(Math.abs(ch))} s</span>` : 'sin cambios'} en 8 semanas` : esc(sum.threshold_confidence ? `Confianza: ${sum.threshold_confidence}` : ''));
    }
    if (lthr !== null || maxHr !== null) tile('FC umbral · FC máx', `${lthr !== null ? fmtNum(lthr) : '—'} · ${maxHr !== null ? fmtNum(maxHr) : '—'}`, profile.lthr ? 'ppm · perfil de Intervals' : 'ppm');
    if (num(sum.z2_pace_sec_per_km) !== null) tile('Ritmo en Z2', `${fmtPace(sum.z2_pace_sec_per_km)} /km`, num(sum.z2_pace_change_pct) !== null ? `${change(num(sum.z2_pace_change_pct), '%', true, 1)} vs sesiones anteriores` : 'mediana reciente');
    if (num(sum.aerobic_efficiency) !== null) tile('Eficiencia aeróbica', fmtNum(num(sum.aerobic_efficiency), 2), num(sum.aerobic_efficiency_change_pct) !== null ? `${change(num(sum.aerobic_efficiency_change_pct), '%', true, 1)} últimas 6 sesiones` : 'últimas sesiones');
    if (num(sum.cardiac_drift_pct) !== null) tile('Deriva cardiaca', `${fmtNum(num(sum.cardiac_drift_pct), 1)} %`, 'mediana de las últimas sesiones');
    if (num(sum.avg_cadence) !== null) tile('Cadencia', `${fmtNum(num(sum.avg_cadence))} ppm`, 'mediana reciente');

    // Tiempo por zona de FC en los últimos 28 días, a partir de las métricas por actividad.
    const from = addDays(data.now, -27);
    const totals = {};
    for (const row of perf.activity_metrics || []) {
      if (String(row.activity_date || '').slice(0, 10) < from) continue;
      for (const [zone, value] of Object.entries(row.zone_distribution || {})) totals[zone] = (totals[zone] || 0) + (num(value?.seconds) || 0);
    }
    const zoneKeys = Object.keys(totals).sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
    const totalSec = zoneKeys.reduce((s, k) => s + totals[k], 0);
    const zoneColors = ['var(--v8-rest)', 'var(--v8-z2)', 'var(--v8-tempo)', 'var(--v8-threshold)', 'var(--v8-vo2)', '#6a5bd6', '#4b3fb0'];
    const zonesHtml = totalSec > 0 ? `<div class="evo-zones"><p class="evo-eyebrow">Zonas de FC · tiempo en los últimos 28 días</p>${zoneKeys.map((k, i) => {
      const n = Number(k.replace(/\D/g, '')) || i + 1;
      const z = zonesHr[n - 1];
      const range = z && num(z.min_value) !== null && num(z.max_value) !== null ? ` ${fmtNum(num(z.min_value))}–${fmtNum(num(z.max_value))}` : '';
      return `<div class="evo-zone"><span class="z">${esc(k)}${range}</span><span class="zb"><i style="width:${(totals[k] / totalSec * 100).toFixed(1)}%;background:${zoneColors[n - 1] || 'var(--v8-rest)'}"></i></span><span class="r">${fmtDuration(totals[k])}</span></div>`;
    }).join('')}</div>` : '';

    return `<div class="evo-card-head"><div><h3>Datos fisiológicos</h3><p class="evo-sub">Perfil Run de Intervals.icu y métricas calculadas por sesión</p></div></div>
      ${tiles.length ? `<div class="evo-phys">${tiles.join('')}</div>` : '<div class="evo-empty">Todavía no hay métricas fisiológicas. Se calculan a partir de actividades con FC sincronizadas desde Intervals.icu.</div>'}
      ${zonesHtml}`;
  }

  function sessionStatus(data, s) {
    if (s.status === 'missed') return '<span class="evo-pill bad">No realizada</span>';
    if (s.status === 'skipped') return '<span class="evo-pill bad">Saltada</span>';
    if (s.type === 'manual') return localStorageGet(manualValidationKey(data.athleteId, s.workout)) === '1' ? '<span class="evo-pill ok">Validada</span>' : '<span class="evo-pill mid">Por validar</span>';
    const state = ui.reviewCache.get(`${data.athleteId}:${s.activity?.intervals_activity_id}`);
    if (state === 'validated') return '<span class="evo-pill ok">Validada</span>';
    if (state === 'pending') return '<span class="evo-pill mid">Por validar</span>';
    return '<span class="evo-pill n">…</span>';
  }

  // Solo las sesiones con series tienen análisis por bloques.
  function looksStructured(w, a) {
    if ((w.blocks || []).some(b => ['central', 'activation'].includes(String(b?.type || '').toLowerCase()) && Number(b.repetitions || 1) > 1)) return true;
    return /\d+\s*[x×]\s*\d+|umbral|threshold|vo2|vo₂|series|intervalos|fartlek|cuestas/i.test(`${w.title || ''} ${a?.name || ''}`);
  }

  function renderSessions() {
    const target = byId('evoSessions'); const data = ui.data;
    if (!target || !data) return;
    const list = data.model.sessions.slice(0, 8);
    if (!list.length) { target.innerHTML = '<div class="evo-empty">No hay sesiones registradas en este periodo.</div>'; return; }
    target.innerHTML = `<table class="evo-sessions"><thead><tr><th>Fecha</th><th>Sesión</th><th class="n">Duración</th><th class="n">Distancia</th><th class="n">Ritmo</th><th class="n">FC media</th><th class="n">Carga</th><th>Sensaciones</th><th>Estado</th></tr></thead><tbody>${list.map(s => {
      const w = s.workout || {}, a = s.activity || null, log = w.manual_log || null;
      const title = a?.name || w.title || 'Sesión';
      const planned = w.id ? [w.title && a?.name && a.name !== w.title ? w.title : '', num(w.planned_duration_min) ? `${fmtNum(num(w.planned_duration_min))} min` : '', num(w.planned_load) !== null ? `plan ${fmtNum(num(w.planned_load))}` : ''].filter(Boolean).join(' · ') : 'Sin sesión planificada';
      const isRun = /run|trail/i.test(a?.sport || w.sport || '');
      const duration = a ? fmtDuration(a.duration_sec) : s.type === 'manual' && num(log?.actual_duration_min) ? fmtDuration(num(log.actual_duration_min) * 60) : '—';
      const feel = log ? [num(log.rpe) !== null ? `RPE ${fmtNum(num(log.rpe))}` : '', feelingLabel(log.feeling), num(log.pain) ? `${log.pain_area ? esc(log.pain_area) + ' ' : 'dolor '}${fmtNum(num(log.pain))}/10` : ''].filter(Boolean).join(' · ') : '—';
      const doneRow = s.status === 'done';
      return `<tr><td class="d">${esc(dayDate(s.date))}</td>
        <td><div class="evo-sname"><i style="background:${intensityColor(`${w.title || ''} ${w.summary || ''} ${w.session_objective || ''} ${w.sport || ''} ${a?.name || ''} ${a?.sport || ''}`)}"></i><div><b>${esc(title)}</b><small>${esc(planned)}</small></div>${s.type === 'intervals' && a?.intervals_activity_id && window.RunflowSessionBlocks && looksStructured(w, a) ? `<button type="button" class="sb-blocks-btn" data-blocks="${esc(a.intervals_activity_id)}" data-title="${esc(title)}">Ver bloques</button>` : ''}</div></td>
        <td class="n">${doneRow ? duration : '—'}</td>
        <td class="n">${a && num(a.distance_m) ? `${fmtNum(num(a.distance_m) / 1000, 1)} km` : '—'}</td>
        <td class="n">${a && isRun ? fmtPace(a.avg_pace_sec_per_km) : '—'}</td>
        <td class="n">${a && num(a.avg_hr) ? fmtNum(num(a.avg_hr)) : '—'}</td>
        <td class="n"><b>${doneRow && s.load !== null && s.load !== undefined ? fmtNum(Math.round(s.load)) : '—'}</b>${s.estimated ? '<small title="Carga estimada a partir de la duración registrada">*</small>' : ''}</td>
        <td class="feel">${feel}</td><td>${sessionStatus(data, s)}</td></tr>`;
    }).join('')}</tbody></table>`;
    target.querySelectorAll('[data-blocks]').forEach(button => {
      button.onclick = () => window.RunflowSessionBlocks.open({ athleteId: data.athleteId, activityId: button.dataset.blocks, title: button.dataset.title });
    });
  }

  // ---------- Gráficos SVG ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent, text) { const node = document.createElementNS(SVGNS, tag); for (const k in attrs) node.setAttribute(k, attrs[k]); if (text !== undefined) node.textContent = text; parent?.appendChild(node); return node; }
  const widthOf = svg => Math.max(200, svg.getBoundingClientRect().width || svg.parentElement?.clientWidth || 600);

  function drawGauge(data) {
    const svg = byId('evoGauge'); if (!svg) return;
    const { score } = readinessInfo(data);
    const r = 42, c = 2 * Math.PI * r;
    el('circle', { cx: 52, cy: 52, r, fill: 'none', stroke: 'rgba(255,255,255,.14)', 'stroke-width': 10 }, svg);
    if (score !== null) el('circle', { cx: 52, cy: 52, r, fill: 'none', stroke: score >= 65 ? '#b9f34d' : score >= 45 ? '#efb36a' : '#e07c74', 'stroke-width': 10, 'stroke-linecap': 'round', 'stroke-dasharray': `${c * score / 100} ${c}`, transform: 'rotate(-90 52 52)' }, svg);
    el('text', { x: 52, y: 58, 'text-anchor': 'middle', 'font-size': 28, 'font-weight': 900, fill: '#fff' }, svg, score === null ? '—' : String(Math.round(score)));
    el('text', { x: 52, y: 74, 'text-anchor': 'middle', 'font-size': 9, fill: '#cfd8c8', 'font-weight': 700 }, svg, '/ 100');
  }

  function drawWeeksChart(data) {
    const svg = byId('evoWeeksChart'); if (!svg) return;
    const weeks = data.model.weekRows;
    const W = widthOf(svg), H = 200, pl = 34, pr = 34, pt = 10, pb = 24, iw = W - pl - pr, ih = H - pt - pb;
    const maxLoad = Math.max(100, ...weeks.map(w => Math.max(w.plannedLoad, w.doneLoad)));
    const step = maxLoad > 600 ? 200 : maxLoad > 300 ? 100 : 50;
    const max = Math.ceil(maxLoad / step) * step;
    for (let v = 0; v <= max; v += step) { const y = pt + ih - ih * v / max; el('line', { x1: pl, x2: W - pr, y1: y, y2: y, stroke: '#e6e9e3' }, svg); el('text', { x: pl - 6, y: y + 3, 'text-anchor': 'end', 'font-size': 9, fill: '#9aa19a' }, svg, String(v)); }
    const bw = iw / weeks.length, b = Math.min(28, bw * .3);
    weeks.forEach((w, i) => {
      const cx = pl + i * bw + bw / 2;
      const hp = ih * w.plannedLoad / max, hd = ih * w.doneLoad / max;
      el('rect', { x: cx - b - 1.5, y: pt + ih - hp, width: b, height: hp, rx: 4, fill: '#dfe3db' }, svg);
      el('rect', { x: cx + 1.5, y: pt + ih - hd, width: b, height: hd, rx: 4, fill: w.current ? '#d6f59a' : '#b9f34d', stroke: w.current ? '#9ccf3c' : 'none', 'stroke-dasharray': w.current ? '3 2' : '' }, svg);
      const t = el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 10, fill: w.current ? '#181d19' : '#858c86', 'font-weight': w.current ? 800 : 600 }, svg, w.current ? 'Esta sem.' : shortDate(w.start));
      el('title', {}, t, `Semana del ${shortDate(w.start)}: ${Math.round(w.doneLoad)} realizada / ${Math.round(w.plannedLoad)} planificada`);
    });
    const ctl = weeks.map((w, i) => ({ x: pl + i * bw + bw / 2, v: w.ctl })).filter(p => p.v !== null);
    if (ctl.length) {
      const lo = Math.floor(Math.min(...ctl.map(p => p.v)) / 5) * 5 - 5, hi = Math.ceil(Math.max(...ctl.map(p => p.v)) / 5) * 5 + 5;
      const y = v => pt + ih - ih * (v - lo) / (hi - lo);
      el('polyline', { points: ctl.map(p => `${p.x},${y(p.v)}`).join(' '), fill: 'none', stroke: '#181d19', 'stroke-width': 2.2 }, svg);
      ctl.forEach(p => { const c = el('circle', { cx: p.x, cy: y(p.v), r: 3.2, fill: '#fff', stroke: '#181d19', 'stroke-width': 2 }, svg); el('title', {}, c, `Aptitud ${fmtNum(p.v)}`); });
      [lo, (lo + hi) / 2, hi].forEach(v => el('text', { x: W - pr + 6, y: y(v) + 3, 'font-size': 9, fill: '#9aa19a' }, svg, fmtNum(v)));
    }
  }

  function drawReadiness(data) {
    const svg = byId('evoReadyChart'); if (!svg) return;
    const from = addDays(data.now, -27);
    const byDate = new Map(data.recovery.filter(r => r.metric_date >= from).map(r => [r.metric_date, num(r.readiness_score)]));
    const days = Array.from({ length: 28 }, (_, i) => addDays(from, i));
    const W = widthOf(svg), H = 104, pt = 6, pb = 16, pl = 22, iw = W - pl, ih = H - pt - pb, bw = iw / days.length;
    [[0, 45, '#fbe7e5'], [45, 65, '#fdf0e1'], [65, 80, '#f1f8e3'], [80, 100, '#e4f5c4']].forEach(([a, b, c]) => el('rect', { x: pl, y: pt + ih - ih * b / 100, width: iw, height: ih * (b - a) / 100, fill: c, opacity: .6 }, svg));
    [45, 65, 80].forEach(v => el('text', { x: pl - 4, y: pt + ih - ih * v / 100 + 3, 'text-anchor': 'end', 'font-size': 9, fill: '#9aa19a' }, svg, String(v)));
    days.forEach((d, i) => {
      const v = byDate.get(d);
      if (v === null || v === undefined) return;
      const h = ih * v / 100;
      const rect = el('rect', { x: pl + i * bw + 1.5, y: pt + ih - h, width: Math.max(1, bw - 3), height: h, rx: 2, fill: v >= 80 ? '#7fb52a' : v >= 65 ? '#b9f34d' : v >= 45 ? '#efb36a' : '#e07c74' }, svg);
      el('title', {}, rect, `${shortDate(d)}: ${Math.round(v)}`);
    });
    const last = [...days].reverse().find(d => byDate.get(d) !== null && byDate.get(d) !== undefined);
    el('text', { x: pl, y: H - 3, 'font-size': 9, fill: '#9aa19a' }, svg, shortDate(from));
    el('text', { x: W, y: H - 3, 'text-anchor': 'end', 'font-size': 9, fill: '#181d19', 'font-weight': 800 }, svg, last ? `${last === data.now ? 'Hoy' : shortDate(last)} ${Math.round(byDate.get(last))}` : 'Sin readiness');
  }

  function drawSparks(data) {
    if (!data.recovery.length) return;
    const stats = recoveryStats(data);
    document.querySelectorAll('[data-evo-spark]').forEach(svg => {
      const s = stats[svg.dataset.evoSpark];
      const points = s.series.map((p, i) => ({ i, v: p.v })).filter(p => p.v !== null);
      if (!points.length) return;
      const W = widthOf(svg), H = 34, n = Math.max(1, s.series.length - 1);
      const values = points.map(p => p.v).concat(s.base !== null ? [s.base] : []);
      const range = Math.max(...values) - Math.min(...values) || 1;
      const mn = Math.min(...values) - range * .15, mx = Math.max(...values) + range * .15;
      const y = v => H - 3 - (H - 6) * (v - mn) / (mx - mn), x = i => 2 + i * (W - 6) / n;
      if (s.base !== null) el('line', { x1: 0, x2: W, y1: y(s.base), y2: y(s.base), stroke: '#a8afa8', 'stroke-dasharray': '3 3' }, svg);
      el('polyline', { points: points.map(p => `${x(p.i)},${y(p.v)}`).join(' '), fill: 'none', stroke: '#4d554e', 'stroke-width': 1.8 }, svg);
      const last = points.at(-1);
      el('circle', { cx: x(last.i), cy: y(last.v), r: 3, fill: '#b9f34d', stroke: '#181d19', 'stroke-width': 1.5 }, svg);
    });
  }

  const start = () => { if (!mount()) setTimeout(start, 300); };
  start();
})();
