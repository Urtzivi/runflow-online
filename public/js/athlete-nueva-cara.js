/* RunFlow Athlete · nueva cara (oct 2026).
 * Capa visual sobre athlete.js: Hoy rediseñado, explicación de cada sesión, resumen de la
 * actividad con lectura en frases, pestaña Evolución y tarjeta semanal para compartir.
 * Se puede volver al diseño anterior desde Perfil (o con ?ui=clasica). Usa RunflowInsights. */
(() => {
  'use strict';
  const UI_KEY = 'runflow_ui';
  const q = (sel, root = document) => root.querySelector(sel);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; };
  const comma = (value, decimals = 1) => String(Math.round(value * 10 ** decimals) / 10 ** decimals).replace('.', ',');

  function readUiChoice() {
    try {
      const param = new URLSearchParams(location.search).get('ui');
      if (param === 'clasica') localStorage.setItem(UI_KEY, 'clasica');
      if (param === 'nueva') localStorage.removeItem(UI_KEY);
      return localStorage.getItem(UI_KEY) === 'clasica' ? 'clasica' : 'nueva';
    } catch { return 'nueva'; }
  }
  const choice = readUiChoice();

  function installDesignSwitch() {
    const profile = q('#profileView .athlete-inner-page') || q('#profileView');
    if (!profile || q('#ncDesignSwitch')) return;
    const card = document.createElement('section');
    card.id = 'ncDesignSwitch';
    card.className = 'athlete-section-card nc-design-switch';
    const isNew = choice === 'nueva';
    card.innerHTML = `<div class="athlete-section-head"><div><span>Aspecto de la app</span><h3>${isNew ? 'Diseño nuevo' : 'Diseño anterior'}</h3></div></div><p class="athlete-subtle">${isNew ? 'Si algo no te funciona bien, puedes volver al diseño anterior cuando quieras.' : 'Estás usando el diseño anterior. Prueba el nuevo: resúmenes más claros, tu evolución y la tarjeta para compartir.'}</p><button type="button" class="athlete-secondary-cta" id="ncDesignToggle">${isNew ? 'Volver al diseño anterior' : 'Usar el diseño nuevo'}</button>`;
    const logoutCard = q('#coachButton');
    if (logoutCard && logoutCard.parentNode === profile) profile.insertBefore(card, logoutCard); else profile.appendChild(card);
    q('#ncDesignToggle').addEventListener('click', () => {
      try { if (isNew) localStorage.setItem(UI_KEY, 'clasica'); else localStorage.removeItem(UI_KEY); } catch {}
      location.replace(location.pathname);
    });
  }

  installDesignSwitch();
  if (choice === 'clasica' || !window.RunflowInsights) return;

  const I = window.RunflowInsights;
  document.body.classList.add('nc-on');
  document.documentElement.dataset.runflowAthleteUi = 'nueva-cara-1';

  const ZONE_COLOR = { 1: '#9DC1DD', 2: '#4F8FC0', 3: '#E3B341', 4: '#E07B39', 5: '#C8402F' };
  const KIND_COLOR = { rest: '#D5D9D0', recovery: '#9DC1DD', easy: '#4F8FC0', long: '#2F6FA3', strength: '#7A5BB5', bike: '#5FA58C', walk: '#5FA58C', other: '#8A938C' };
  const kindColor = key => I.isHard(key) ? '#E07B39' : KIND_COLOR[key] || KIND_COLOR.other;
  const st = () => { try { return state; } catch { return null; } };
  const athlete = () => st()?.athlete || null;
  const cache = { evolution: null, evolutionAt: 0, lastActivity: undefined, activityDetail: null };

  async function getJson(url) {
    const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar.');
    return data;
  }
  async function loadEvolution(force = false) {
    if (!force && cache.evolution && Date.now() - cache.evolutionAt < 120000) return cache.evolution;
    try { cache.evolution = await getJson('/api/athlete/evolution?weeks=12'); cache.evolutionAt = Date.now(); }
    catch (error) { console.warn('[nueva cara] evolución', error.message); }
    return cache.evolution;
  }
  async function loadLastActivity() {
    if (cache.lastActivity !== undefined) return cache.lastActivity;
    const known = st()?.activities;
    if (Array.isArray(known) && known.length) return (cache.lastActivity = known[0]);
    try { const data = await getJson('/api/athlete/activities?limit=1'); cache.lastActivity = (data.activities || [])[0] || null; }
    catch { cache.lastActivity = null; }
    return cache.lastActivity;
  }

  const localIso = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dayLabel = (iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('es-ES', opts).format(new Date(`${String(iso).slice(0, 10)}T12:00:00`));
  const minutesLabel = sec => { const m = Math.round((num(sec) || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
  const clockLabel = sec => { const v = Math.round(num(sec) || 0); const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), s = v % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
  const kmLabel = metres => `${comma((num(metres) || 0) / 1000, (num(metres) || 0) >= 10000 ? 1 : 2)} km`;
  const icon = {
    check: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l4 4L19 6"/></svg>',
    chevron: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    share: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>',
    trophy: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/></svg>',
  };

  // Dibujo de la sesión: barras por bloque, alto y color según la zona.
  function profileBars(segments, height = 44) {
    const total = segments.reduce((s, x) => s + x.minutes, 0);
    if (!total) return '';
    return `<div class="nc-profile" style="height:${height}px" aria-hidden="true">${segments.map(s => `<i style="flex:${Math.max(0.6, s.minutes)};height:${[0, 34, 50, 66, 82, 100][Math.min(5, s.zone || 2)]}%;background:${ZONE_COLOR[Math.min(5, s.zone || 2)]}"></i>`).join('')}</div>`;
  }
  function zonePill(plan) {
    const zones = plan.segments.map(s => s.zone).filter(Boolean);
    if (!zones.length) return '';
    const hi = Math.max(...zones), lo = Math.min(...zones);
    return `<span class="nc-pill nc-pill-z" style="--z:${ZONE_COLOR[hi]}">${lo === hi ? `Z${hi}` : `Z${lo}–Z${hi}`}</span>`;
  }

  // ---------- HOY ----------
  function hideClassicToday() {
    ['athleteFitnessIndex', 'athleteMarkerConfidence', 'nextWorkoutTitle', 'weekRange', 'mainGoalName'].forEach(id => { const el = document.getElementById(id); el?.closest('section')?.classList.add('nc-hide'); });
    q('#todayView .athlete-two-cards')?.classList.add('nc-hide');
    q('#todayWorkoutCard')?.classList.add('nc-hide');
  }

  function baselines(daily) {
    const rows = (daily || []).slice(0, -1).slice(-28);
    const avg = key => { const v = rows.map(r => num(r[key])).filter(x => x !== null && x > 0); return v.length >= 5 ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    return { sleep: avg('sleep_sec'), hrv: avg('hrv'), rhr: avg('resting_hr') };
  }

  function readinessCard(metrics, evolution, today) {
    const score = num(metrics?.readiness_score);
    const base = baselines(evolution?.daily);
    const latest = (evolution?.daily || []).at(-1) || {};
    const sleep = num(metrics?.sleep_sec) ?? num(latest.sleep_sec), hrv = num(metrics?.hrv) ?? num(latest.hrv), rhr = num(metrics?.resting_hr) ?? num(latest.resting_hr);
    const stats = [];
    if (sleep) { const d = base.sleep ? Math.round((sleep - base.sleep) / 60) : null; stats.push({ k: 'Sueño', v: minutesLabel(sleep), d: d === null ? '' : Math.abs(d) < 10 ? 'lo normal' : `${d > 0 ? '+' : '−'}${Math.abs(d)} min`, good: d === null || d > -30 }); }
    if (hrv) { const d = base.hrv ? (hrv - base.hrv) / base.hrv : null; stats.push({ k: 'VFC', v: `${Math.round(hrv)} ms`, d: d === null ? '' : d <= -0.1 ? 'más baja' : 'en tu rango', good: d === null || d > -0.1 }); }
    if (rhr) { const d = base.rhr ? Math.round(rhr - base.rhr) : null; stats.push({ k: 'Pulso reposo', v: `${Math.round(rhr)} ppm`, d: d === null ? '' : d === 0 ? 'lo normal' : `${d > 0 ? '+' : '−'}${Math.abs(d)} ppm`, good: d === null || d < 3 }); }
    const key = today ? I.classifySession(today) : 'rest';
    let headline = 'Cuéntanos cómo estás hoy';
    if (score !== null) {
      if (score >= 75) headline = ['recovery', 'easy', 'rest'].includes(key) ? 'Con energía. Hoy, sin pasarte' : 'Con energía. Buen día para apretar';
      else if (score >= 55) headline = ['recovery', 'easy', 'rest', 'walk'].includes(key) ? 'Bien. Día perfecto para soltar piernas' : 'Bien. Entrena según lo previsto';
      else headline = 'Hoy, con cuidado. Escucha tus sensaciones';
    }
    const dash = score === null ? 0 : Math.round(Math.max(0, Math.min(100, score)) * 2.513);
    return `<section class="nc-dark nc-ready">
      <div class="nc-ready-top">
        <svg width="92" height="92" viewBox="0 0 96 96" role="img" aria-label="Disposición ${score ?? 'sin datos'} sobre 100"><circle cx="48" cy="48" r="40" fill="none" stroke="#36403B" stroke-width="10"/><circle cx="48" cy="48" r="40" fill="none" stroke="#C6F24E" stroke-width="10" stroke-linecap="round" stroke-dasharray="${dash} 252" transform="rotate(-90 48 48)"/><text x="48" y="56" text-anchor="middle" class="nc-ring-num">${score ?? '—'}</text></svg>
        <div><span class="nc-k nc-k-light">Cómo estás hoy</span><strong class="nc-ready-title">${esc(headline)}</strong></div>
      </div>
      ${stats.length ? `<div class="nc-grid3">${stats.map(s => `<div class="nc-dstat"><span>${s.k}</span><b>${esc(s.v)}</b>${s.d ? `<small class="${s.good ? 'ok' : 'warn'}">${esc(s.d)}</small>` : ''}</div>`).join('')}</div>` : ''}
      ${q('#runflowOpenDailyCheckin') ? '<button type="button" class="nc-ghost-btn" data-nc-checkin>Contar cómo me encuentro</button>' : ''}
    </section>`;
  }

  function todayCard(today, workouts) {
    if (!today) {
      const info = I.SESSION_INFO.rest;
      return `<section class="nc-card"><span class="nc-k nc-k-green">Hoy</span><h2 class="nc-h2">Día de descanso</h2><div class="nc-note">${esc(info.purpose)}</div></section>`;
    }
    const plan = I.sessionPlan(today, athlete()?.zones);
    const key = I.classifySession(today);
    const info = I.SESSION_INFO[key];
    const meta = [];
    const minutes = num(today.planned_duration_min) || (plan.total ? Math.round(plan.total) : null);
    if (minutes) meta.push(`${minutes} min`);
    if (num(today.planned_distance_km)) meta.push(`${comma(num(today.planned_distance_km))} km aprox.`);
    meta.push(info.effort.toLowerCase());
    const why = I.whyToday(today, workouts) || today.session_objective || '';
    return `<section class="nc-card">
      <div class="nc-row nc-top"><div><span class="nc-k nc-k-green">Sesión de hoy</span><h2 class="nc-h2">${esc(today.title)}</h2><span class="nc-mut">${esc(meta.join(' · '))}</span></div>${zonePill(plan)}</div>
      ${profileBars(plan.segments)}
      ${why ? `<div class="nc-note"><b>Por qué hoy:</b> ${esc(why)}</div>` : ''}
      <button type="button" class="nc-btn" data-nc-open-workout="${esc(today.id)}">Ver cómo hacerla</button>
    </section>`;
  }

  function lastActivityCard(activity) {
    if (!activity) return '';
    const parts = [kmLabel(activity.distance_m), minutesLabel(activity.duration_sec)];
    return `<button type="button" class="nc-card nc-last" data-nc-open-activity="${esc(activity.intervals_activity_id)}">
      <span class="nc-last-ico">${icon.check}</span>
      <span class="nc-last-txt"><small>Tu última sesión · ${esc(dayLabel(activity.activity_date, { weekday: 'long' }))}</small><b>${esc(activity.name || 'Actividad')}</b><small>${esc(parts.join(' · '))}${num(activity.load) ? ` · carga ${Math.round(num(activity.load))}` : ''}</small></span>
      <span class="nc-mut">${icon.chevron}</span>
    </button>`;
  }

  function weekCard(week, evolution) {
    if (!week) return '';
    const workouts = week.workouts || [];
    const todayIso = localIso();
    const done = workouts.filter(w => ['completed', 'partial'].includes(w.execution_status)).length;
    const total = workouts.filter(w => I.classifySession(w) !== 'rest').length;
    const plannedKm = workouts.reduce((s, w) => s + (num(w.planned_distance_km) || 0), 0);
    const weekRow = (evolution?.weeks || []).find(r => r.week_start === week.week_start);
    const realKm = weekRow ? weekRow.km : null;
    const progress = plannedKm && realKm !== null ? realKm / plannedKm : total ? done / total : 0;
    const right = plannedKm && realKm !== null ? `<b class="nc-big">${comma(realKm)} km</b><small>de ${comma(plannedKm, 0)} previstos</small>` : `<b class="nc-big">${done} de ${total}</b><small>sesiones hechas</small>`;
    const byDate = new Map();
    workouts.forEach(w => { const d = String(w.workout_date).slice(0, 10); if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(w); });
    const maxLoad = Math.max(30, ...workouts.map(w => num(w.planned_load) || 0));
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = I.addDaysIso(week.week_start, i);
      const list = byDate.get(date) || [];
      const main = list.find(w => I.isHard(I.classifySession(w))) || list[0];
      const key = main ? I.classifySession(main) : 'rest';
      const color = kindColor(key);
      const isDone = list.some(w => ['completed', 'partial'].includes(w.execution_status));
      const cls = date === todayIso ? 'today' : isDone ? 'done' : date < todayIso && main && key !== 'rest' ? 'missed' : '';
      const load = list.reduce((s, w) => s + (num(w.planned_load) || 0), 0);
      return `<button type="button" class="nc-day ${cls}" ${main ? `data-nc-open-workout="${esc(main.id)}"` : 'disabled'} style="--c:${color}" aria-label="${esc(dayLabel(date))}${main ? `: ${esc(main.title)}` : ': descanso'}"><small>${'LMXJVSD'[i]}</small><span>${new Date(`${date}T12:00:00`).getDate()}</span><i style="height:${Math.max(4, Math.round((load / maxLoad) * 34))}px"></i></button>`;
    }).join('');
    return `<section class="nc-card">
      <div class="nc-row"><div><span class="nc-k">Esta semana</span><h3 class="nc-h3">${esc(week.week_type || week.title || 'Tu semana')}</h3></div><div class="nc-right">${right}</div></div>
      <div class="nc-bar"><i style="width:${Math.round(Math.min(1, progress) * 100)}%"></i></div>
      <div class="nc-week">${days}</div>
      <div class="nc-legend"><span><i style="background:#4F8FC0"></i>suave</span><span><i style="background:#E07B39"></i>calidad</span><span><i style="background:#2F6FA3"></i>larga</span><span><i style="background:#7A5BB5"></i>fuerza</span></div>
      <button type="button" class="nc-link" data-nc-share>${icon.share} Compartir mi semana</button>
    </section>`;
  }

  function progressCard() {
    const perf = st()?.performance || {};
    const summary = perf.activity_summary || perf.latest?.details?.activity_performance || {};
    const history = (perf.history || []).map(r => num(r.raw_fitness)).filter(v => v !== null).slice(-42);
    const pace = num(summary.threshold_pace_sec_per_km), change = num(summary.threshold_pace_change_8w_sec);
    const fit = num(perf.latest?.fitness_change_28d);
    let title, value, detail;
    if (pace) { title = 'Ritmo de umbral'; value = `${I.fmtPace(pace)}<small>/km</small>`; detail = change !== null && Math.abs(change) >= 1 ? (change > 0 ? `${Math.round(change)} s más rápido que hace 8 semanas` : `${Math.round(-change)} s más lento que hace 8 semanas`) : 'Estable en las últimas semanas'; }
    else if (fit !== null) { title = 'Nivel de forma'; value = comma(num(perf.latest?.raw_fitness) || 0); detail = `${fit >= 0 ? '+' : ''}${comma(fit)} en 28 días`; }
    else return '';
    let spark = '';
    if (history.length >= 4) {
      const min = Math.min(...history), max = Math.max(...history), span = Math.max(1, max - min);
      const pts = history.map((v, i) => `${(2 + (i / (history.length - 1)) * 114).toFixed(1)},${(50 - ((v - min) / span) * 40).toFixed(1)}`);
      const last = pts.at(-1).split(',');
      spark = `<svg width="120" height="56" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="#2F6B1F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="5" fill="#C6F24E" stroke="#2F6B1F" stroke-width="2"/></svg>`;
    }
    const improving = pace ? change !== null && change > 0 : fit > 0;
    return `<button type="button" class="nc-card nc-progress" data-nc-nav="evolution">
      <span class="nc-k">${improving ? 'Estás mejorando' : 'Tu progreso'}</span>
      <span class="nc-row nc-bottom"><span><small class="nc-mut">${title}</small><b class="nc-huge">${value}</b><small class="${improving ? 'nc-green' : 'nc-mut'}">${esc(detail)}</small></span>${spark}</span>
    </button>`;
  }

  function goalCard(goals) {
    const sorted = [...(goals || [])].filter(g => g.goal_date && String(g.goal_date) >= localIso()).sort((a, b) => String(a.goal_date).localeCompare(String(b.goal_date)));
    const main = sorted.find(g => ['A', 'Principal'].includes(g.priority_code || g.priority)) || sorted[0];
    if (!main) return '';
    const days = Math.max(0, Math.ceil((new Date(`${main.goal_date}T00:00:00`) - new Date(new Date().toDateString())) / 86400000));
    const weeks = Math.ceil(days / 7);
    return `<section class="nc-card">
      <div class="nc-row"><div><span class="nc-k">Tu objetivo</span><h3 class="nc-h3">${esc(main.name)}</h3><span class="nc-mut">${esc(dayLabel(main.goal_date))}${main.performance_target ? ` · ${esc(main.performance_target)}` : ''}</span></div><div class="nc-count"><b>${days}</b><small>días</small></div></div>
      <div class="nc-mut nc-small">${weeks > 1 ? `Quedan ${weeks} semanas de preparación. Cada sesión cuenta.` : 'Ya casi está. Descansa y confía en lo entrenado.'}</div>
    </section>`;
  }

  function greetingLine(week, evolution) {
    const rows = (evolution?.weeks || []).slice(0, -1).reverse();
    let streak = 0; for (const r of rows) { if (r.sessions >= 3) streak += 1; else break; }
    if (streak >= 2) return `Llevas <b>${streak} semanas seguidas</b> entrenando con constancia. Así se llega bien al objetivo.`;
    const workouts = week?.workouts || [];
    const done = workouts.filter(w => ['completed', 'partial'].includes(w.execution_status)).length;
    const total = workouts.filter(w => I.classifySession(w) !== 'rest').length;
    if (total) return done ? `Esta semana llevas <b>${done} de ${total}</b> sesiones. ¡Sigue así!` : `Esta semana tienes <b>${total} sesiones</b>. Vamos a por la primera.`;
    return 'Tu entrenamiento, de un vistazo.';
  }

  let todayRender = 0;
  async function renderHoy() {
    const a = athlete(); if (!a) return;
    const content = q('#todayView .athlete-v2-content'); if (!content) return;
    hideClassicToday();
    const ticket = ++todayRender;
    let host = q('#ncToday');
    if (!host) { host = document.createElement('div'); host.id = 'ncToday'; host.className = 'nc-stack'; content.prepend(host); }
    const paint = (evolution, last) => {
      if (ticket !== todayRender) return;
      const week = a.week; const workouts = week?.workouts || [];
      const today = workouts.find(w => String(w.workout_date).slice(0, 10) === localIso()) || null;
      const sub = q('#todaySubtitle'); if (sub) sub.innerHTML = greetingLine(week, evolution);
      host.innerHTML = readinessCard(a.metrics || {}, evolution, today) + todayCard(today, workouts) + lastActivityCard(last) + weekCard(week, evolution) + progressCard() + goalCard(a.goals);
      const coach = q('#coachMessageCard'); if (coach && coach.previousElementSibling !== host) host.after(coach);
    };
    paint(cache.evolution, cache.lastActivity || null);
    const [evolution, last] = await Promise.all([loadEvolution(), loadLastActivity()]);
    paint(evolution, last);
  }

  // ---------- SESIÓN ----------
  function sessionExplanation(workout) {
    const key = I.classifySession(workout);
    const info = I.SESSION_INFO[key];
    const plan = I.sessionPlan(workout, athlete()?.zones);
    const purpose = workout.purpose || workout.session_objective || '';
    const hasPace = plan.rows.some(r => r.pace), hasHr = plan.rows.some(r => r.hr);
    const rpe = info.rpe;
    const steps = plan.rows.length ? `<section class="nc-card nc-flat"><span class="nc-k">Paso a paso</span>
      <table class="nc-table"><thead><tr><th>Bloque</th>${hasPace ? '<th>Ritmo</th>' : ''}${hasHr ? '<th>Pulso</th>' : ''}${!hasPace && !hasHr ? '<th>Intensidad</th>' : ''}</tr></thead><tbody>
      ${plan.rows.map(r => `<tr><td><i class="nc-dot" style="background:${ZONE_COLOR[Math.min(5, r.zone || 2)]}"></i>${esc(r.label)}</td>${hasPace ? `<td>${r.kind === 'work' ? `<b>${esc(r.pace || '—')}</b>` : esc(r.pace || '—')}</td>` : ''}${hasHr ? `<td>${esc(r.hr || '—')}</td>` : ''}${!hasPace && !hasHr ? `<td>${esc(r.target || '—')}</td>` : ''}</tr>`).join('')}
      </tbody></table>${hasPace || hasHr ? '<small class="nc-mut">Ritmos (min/km) y pulso (ppm) calculados con tus zonas.</small>' : '<small class="nc-mut">Cuando tu entrenador configure tus zonas verás aquí tus ritmos y pulsos.</small>'}</section>` : '';
    return `<div class="nc-stack nc-session">
      ${plan.segments.length ? `<section class="nc-card nc-flat"><span class="nc-k">Así es la sesión</span>${profileBars(plan.segments, 84)}<div class="nc-row nc-mut nc-small"><span>0'</span><span>${Math.round(plan.total)}'</span></div><div class="nc-legend"><span><i style="background:${ZONE_COLOR[1]}"></i>muy suave</span><span><i style="background:${ZONE_COLOR[2]}"></i>suave</span><span><i style="background:${ZONE_COLOR[4]}"></i>fuerte</span><span><i style="background:${ZONE_COLOR[5]}"></i>muy fuerte</span></div></section>` : ''}
      <section class="nc-card nc-flat"><span class="nc-k">Para qué sirve</span><p class="nc-p">${esc(purpose || info.purpose)}</p>${purpose && purpose !== info.purpose ? `<p class="nc-p nc-mut">${esc(info.purpose)}</p>` : ''}
        <div class="nc-grid2"><div class="nc-stat"><span>Mejora</span><b>${esc(workout.adaptation_target || info.improves)}</b></div><div class="nc-stat"><span>Recuperas en</span><b>${esc(info.recover)}</b></div></div></section>
      ${steps}
      ${rpe ? `<section class="nc-card nc-flat"><span class="nc-k">Cómo debe sentirse</span><div class="nc-rpe">${Array.from({ length: 10 }, (_, i) => `<i class="${i + 1 >= rpe[0] && i + 1 <= rpe[1] ? 'on' : ''}" style="${i + 1 >= rpe[0] && i + 1 <= rpe[1] ? `background:${ZONE_COLOR[Math.min(5, Math.max(1, Math.ceil(rpe[1] / 2)))]}` : ''}">${i + 1}</i>`).join('')}</div><p class="nc-p">${esc(info.feel)}</p></section>` : ''}
      ${info.tips.length ? `<section class="nc-card nc-flat"><span class="nc-k">Consejos</span><ul class="nc-tips">${info.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}
    </div>`;
  }

  function enhanceSession() {
    const workout = st()?.selectedWorkout; if (!workout) return;
    const body = q('#sessionDetail .modal-body'); if (!body) return;
    q('#ncSession')?.remove();
    const holder = document.createElement('div'); holder.id = 'ncSession';
    holder.innerHTML = sessionExplanation(workout);
    const meta = q('#detailMeta'); (meta || body.firstChild)?.after(holder);
    const blocks = Array.isArray(workout.blocks) ? workout.blocks.filter(b => b && b.type !== 'runflow_meta') : [];
    q('#detailBlocks')?.classList.toggle('nc-hide', blocks.length > 0 && blocks.every(b => b.type !== 'strength'));
  }

  // ---------- ACTIVIDAD ----------
  function streamOf(streams, type) { const row = (Array.isArray(streams) ? streams : []).find(s => String(s?.type || '').toLowerCase() === type); return Array.isArray(row?.data) ? row.data : []; }

  function activityChart(activity) {
    const time = streamOf(activity.streams, 'time');
    if (time.length < 60) return '';
    const hr = streamOf(activity.streams, 'heartrate');
    let speed = streamOf(activity.streams, 'velocity_smooth');
    const dist = streamOf(activity.streams, 'distance');
    if (!speed.length && dist.length) speed = dist.map((d, i) => i ? (d - dist[i - 1]) / Math.max(1, time[i] - time[i - 1]) : 0);
    const n = 160, step = Math.max(1, Math.floor(time.length / n));
    const pts = [];
    for (let i = 0; i < time.length; i += step) {
      let hs = 0, hn = 0, ss = 0, sn = 0;
      for (let j = Math.max(0, i - 10); j < Math.min(time.length, i + 10); j += 1) { if (num(hr[j]) > 40) { hs += hr[j]; hn += 1; } if (num(speed[j]) > 0.8) { ss += speed[j]; sn += 1; } }
      pts.push({ t: time[i] - time[0], hr: hn ? hs / hn : null, pace: sn ? 1000 / (ss / sn) : null });
    }
    const W = 340, H = 150, T = Math.max(1, pts.at(-1).t);
    const paces = pts.map(p => p.pace).filter(Boolean).sort((a, b) => a - b), hrs = pts.map(p => p.hr).filter(Boolean).sort((a, b) => a - b);
    if (!paces.length && !hrs.length) return '';
    const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)))];
    const pMin = paces.length ? pct(paces, 0.02) : 0, pMax = paces.length ? pct(paces, 0.95) : 1;
    const hMin = hrs.length ? pct(hrs, 0.02) - 5 : 0, hMax = hrs.length ? pct(hrs, 0.99) + 3 : 1;
    const x = t => (t / T) * W;
    const yP = p => 10 + ((Math.min(pMax, Math.max(pMin, p)) - pMin) / Math.max(1, pMax - pMin)) * (H - 40);
    const yH = h => H - 22 - ((Math.min(hMax, Math.max(hMin, h)) - hMin) / Math.max(1, hMax - hMin)) * (H - 40);
    const line = (key, y) => pts.filter(p => p[key]).map(p => `${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => `<text x="${Math.min(W - 18, x(T * f)).toFixed(0)}" y="${H - 4}" class="nc-axis">${Math.round((T * f) / 60)}'</text>`).join('');
    return `<section class="nc-card nc-flat"><div class="nc-row"><span class="nc-k">Ritmo y pulso</span><div class="nc-legend"><span><i style="background:#C8402F"></i>pulso</span><span><i style="background:#17201C"></i>ritmo</span></div></div>
      <svg viewBox="0 0 ${W} ${H}" class="nc-chart" role="img" aria-label="Ritmo y pulso durante la actividad">${paces.length ? `<polyline points="${line('pace', yP)}" fill="none" stroke="#17201C" stroke-width="1.6" stroke-linejoin="round"/>` : ''}${hrs.length ? `<polyline points="${line('hr', yH)}" fill="none" stroke="#C8402F" stroke-width="2" stroke-linejoin="round"/>` : ''}${ticks}</svg>
      <small class="nc-mut">Ritmo: más arriba es más rápido.${hrs.length ? ` Pulso entre ${Math.round(pct(hrs, 0.02))} y ${Math.round(pct(hrs, 0.99))} ppm.` : ''}</small></section>`;
  }

  function zonesCard(raw) {
    const zt = I.zoneTimes(raw); if (!zt) return '';
    const colors = [ZONE_COLOR[1], ZONE_COLOR[2], ZONE_COLOR[3], ZONE_COLOR[4], ZONE_COLOR[5], '#9E2A1F', '#6E1A12'];
    const shown = zt.values.map((v, i) => ({ v, i })).filter(z => z.v > 0);
    return `<section class="nc-card nc-flat"><span class="nc-k">Tiempo en cada zona</span>
      <div class="nc-zbar">${shown.map(z => `<i style="width:${((z.v / zt.total) * 100).toFixed(1)}%;background:${colors[z.i] || colors[6]}"></i>`).join('')}</div>
      <div class="nc-legend">${shown.map(z => `<span><i style="background:${colors[z.i] || colors[6]}"></i>Z${z.i + 1} ${Math.round(z.v / 60)}'</span>`).join('')}</div>
      <small class="nc-mut">${Math.round((zt.easy / zt.total) * 100)} % suave · ${Math.round((zt.hard / zt.total) * 100)} % fuerte</small></section>`;
  }

  function enhanceActivity() {
    const modal = q('#athleteActivityModal'); const body = q('#athleteActivityModal .modal-body');
    const detail = cache.activityDetail; const activity = detail?.activity || st()?.selectedActivity;
    if (!modal || !body || !activity) return;
    q('#ncActivity')?.remove(); q('#ncActivityAfter')?.remove();
    const planned = detail?.planned || null;
    const analysis = detail?.block_analysis && Array.isArray(detail.block_analysis.blocks) && detail.block_analysis.blocks.some(b => b.main_work) ? detail.block_analysis : null;
    const raw = activity.raw_summary || {};
    const comp = I.compliance(activity, planned);
    const reading = I.activityReading({ activity, planned, athleteZones: athlete()?.zones, analysis });
    const pace = num(activity.avg_pace_sec_per_km);
    const stats = [['Distancia', num(activity.distance_m) ? kmLabel(activity.distance_m) : '—'], ['Tiempo', clockLabel(activity.duration_sec)], pace && num(activity.distance_m) > 500 ? ['Ritmo', `${I.fmtPace(pace)}/km`] : ['Carga', num(activity.load) ? String(Math.round(num(activity.load))) : '—']];
    const extra = [num(activity.avg_hr) ? `Pulso medio ${Math.round(num(activity.avg_hr))}` : '', num(activity.max_hr) ? `máx. ${Math.round(num(activity.max_hr))}` : '', num(activity.load) && stats[2][0] !== 'Carga' ? `carga ${Math.round(num(activity.load))}` : ''].filter(Boolean).join(' · ');
    const top = document.createElement('div'); top.id = 'ncActivity'; top.className = 'nc-stack';
    top.innerHTML = `<section class="nc-dark">
        <div class="nc-row">${planned ? `<span class="nc-pill nc-pill-lime">${comp !== null && comp >= 85 ? 'Sesión cumplida' : 'Sesión hecha'}${comp !== null ? ` · ${comp} %` : ''}</span><small class="nc-k-light">vs ${esc(planned.title || 'plan')}</small>` : '<span class="nc-pill nc-pill-soft">Actividad libre</span>'}</div>
        <div class="nc-grid3">${stats.map(([k, v]) => `<div><small class="nc-k-light">${k}</small><b class="nc-hero-num">${esc(v)}</b></div>`).join('')}</div>
        ${extra ? `<small class="nc-k-light">${esc(extra)}</small>` : ''}
      </section>
      ${reading.length ? `<section class="nc-card nc-flat"><span class="nc-k">Lectura de la sesión</span><p class="nc-p nc-reading">${reading.map((t, i) => i === 0 ? `<b>${esc(t)}</b>` : esc(t)).join(' ')}</p></section>` : ''}
      ${analysis ? '' : activityChart(activity)}`;
    body.prepend(top);
    const after = document.createElement('div'); after.id = 'ncActivityAfter'; after.className = 'nc-stack';
    const chips = I.contextChips(activity, detail?.feedback);
    after.innerHTML = zonesCard(raw) + (chips.length ? `<section class="nc-card nc-flat"><span class="nc-k">Contexto</span><div class="nc-chips">${chips.map(c => `<span class="nc-chip" title="${esc(c.hint)}">${esc(c.label)}</span>`).join('')}</div></section>` : '');
    const blocksHost = q('#athleteActivityBlocks');
    const intervalsSection = q('#athleteActivityIntervals')?.closest('section');
    (blocksHost && !blocksHost.hidden ? blocksHost : top).after(after);
    q('#athleteActivityMetrics')?.classList.add('nc-hide');
    q('#athleteActivityExtra')?.closest('section')?.classList.add('nc-hide');
    if (intervalsSection) { intervalsSection.classList.toggle('nc-hide', !!analysis || !(activity.intervals || []).length); const h = intervalsSection.querySelector('h3'); if (h) h.textContent = 'Parciales'; }
  }

  // ---------- EVOLUCIÓN ----------
  function installEvolutionView() {
    if (q('#evolutionView')) return;
    const shell = q('main.athlete-v2-shell'); if (!shell) return;
    const section = document.createElement('section');
    section.id = 'evolutionView'; section.className = 'athlete-v2-view';
    section.innerHTML = '<div class="athlete-inner-page nc-page"><div class="athlete-page-title"><div><p>ÚLTIMAS 12 SEMANAS</p><h1>Tu evolución</h1><span>Cómo vas mejorando</span></div><button type="button" class="athlete-icon-button nc-share-btn" data-nc-share aria-label="Compartir mi semana">' + icon.share + '</button></div><div id="ncEvolution" class="nc-stack"><div class="empty-state">Cargando tu evolución…</div></div></div>';
    const profile = q('#profileView'); shell.insertBefore(section, profile || null);
    const nav = q('nav.athlete-bottom-nav');
    if (nav && !nav.querySelector('[data-athlete-nav="evolution"]')) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.athleteNav = 'evolution';
      button.innerHTML = '<span aria-hidden="true">↗</span><small>Evolución</small>';
      button.addEventListener('click', () => switchView('evolution'));
      const activities = nav.querySelector('[data-athlete-nav="activities"]');
      activities?.after(button);
      nav.querySelector('[data-athlete-nav="profile"]')?.classList.add('nc-hide');
      const actIcon = activities?.querySelector('span'); if (actIcon) actIcon.textContent = '◷';
    }
  }

  function svgLine(values, { W = 340, H = 130, color = '#2F6B1F', fill = true, thin = null } = {}) {
    const all = [...values, ...(thin || [])].filter(v => v !== null);
    if (values.filter(v => v !== null).length < 2) return '';
    const min = Math.min(...all), max = Math.max(...all), span = Math.max(1, max - min);
    const x = i => (i / (values.length - 1)) * W, y = v => H - 12 - ((v - min) / span) * (H - 28);
    const pts = values.map((v, i) => v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean);
    const thinPts = thin ? thin.map((v, i) => v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean) : [];
    const first = values.find(v => v !== null), last = [...values].reverse().find(v => v !== null);
    return `<svg viewBox="0 0 ${W} ${H}" class="nc-chart" aria-hidden="true">${fill ? `<path d="M${pts[0].split(',')[0]},${H - 12} L${pts.join(' L')} L${pts.at(-1).split(',')[0]},${H - 12} Z" fill="#C6F24E" opacity=".35"/>` : ''}${thinPts.length ? `<polyline points="${thinPts.join(' ')}" fill="none" stroke="#9AA39C" stroke-width="1"/>` : ''}<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><text x="2" y="${(y(first) - 8).toFixed(0)}" class="nc-axis">${Math.round(first)}</text><text x="${W - 24}" y="${Math.max(12, y(last) - 10).toFixed(0)}" class="nc-axis nc-axis-b">${Math.round(last)}</text></svg>`;
  }

  function monthShort(iso) { return new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(new Date(`${iso}T12:00:00`)).replace('.', ''); }

  function evolutionHtml(evo) {
    const perf = st()?.performance || {};
    const weeks = evo?.weeks || [];
    const daily = evo?.daily || [];
    const hist = (perf.history || []).filter(r => num(r.raw_fitness) !== null);
    const fitnessSeries = hist.length >= 7 ? hist.map(r => num(r.raw_fitness)) : daily.map(r => num(r.fitness));
    const fatigueSeries = hist.length >= 7 ? null : daily.map(r => num(r.fatigue));
    const fitDelta = fitnessSeries.filter(v => v !== null).length >= 2 ? fitnessSeries.filter(v => v !== null).at(-1) - fitnessSeries.filter(v => v !== null)[0] : null;
    const summary = perf.activity_summary || {};
    const pace = num(summary.threshold_pace_sec_per_km), paceChange = num(summary.threshold_pace_change_8w_sec);
    const vam = num(summary.uphill_threshold_vam), vamChange = num(summary.uphill_vam_change_pct);
    const eff = num(summary.aerobic_efficiency), effChange = num(summary.aerobic_efficiency_change_pct);
    const totalKm = weeks.reduce((s, w) => s + w.km, 0), activeWeeks = weeks.filter(w => w.sessions).length;
    const zEasy = weeks.reduce((s, w) => s + w.zone_easy_sec, 0), zMid = weeks.reduce((s, w) => s + w.zone_mid_sec, 0), zHard = weeks.reduce((s, w) => s + w.zone_hard_sec, 0), zTot = zEasy + zMid + zHard;
    const sessions = weeks.reduce((s, w) => s + w.sessions, 0);

    const lines = [];
    if (fitDelta !== null && fitDelta >= 2) lines.push('Estás más en forma que hace tres meses');
    else if (fitDelta !== null && fitDelta <= -2) lines.push('Has bajado algo de forma: normal tras un descanso o una carrera');
    if (pace && paceChange !== null && paceChange >= 2) lines.push(`tu ritmo de umbral ha mejorado ${Math.round(paceChange)} s/km`);
    if (activeWeeks >= 8) lines.push(`has entrenado ${activeWeeks} de las últimas 12 semanas`);
    const headline = lines.length ? `${lines.join(', ').replace(/^./, c => c.toUpperCase())}.` : sessions ? `${sessions} sesiones y ${comma(totalKm, 0)} km en 12 semanas. Sigue sumando: la constancia es lo que más mejora.` : 'Cuando tengas unas semanas de entrenamientos verás aquí cómo mejoras.';

    const markers = [
      pace ? { k: 'Ritmo de umbral', v: `${I.fmtPace(pace)}/km`, d: paceChange !== null ? (paceChange >= 0 ? `▲ ${Math.round(paceChange)} s en 8 sem.` : `▼ ${Math.round(-paceChange)} s en 8 sem.`) : '', good: paceChange === null || paceChange >= 0 } : null,
      vam ? { k: 'Subida (VAM)', v: `${Math.round(vam)} m/h`, d: vamChange !== null ? `${vamChange >= 0 ? '▲' : '▼'} ${comma(Math.abs(vamChange))} %` : '', good: vamChange === null || vamChange >= 0 } : null,
      eff ? { k: 'Eficiencia aeróbica', v: comma(eff, 2), d: effChange !== null ? `${effChange >= 0 ? '▲' : '▼'} ${comma(Math.abs(effChange))} %` : '', good: effChange === null || effChange >= 0 } : null,
    ].filter(Boolean);

    const maxKm = Math.max(10, ...weeks.map(w => w.km));
    const kmAvg = weeks.length ? totalKm / Math.max(1, activeWeeks) : 0;
    const bars = weeks.map((w, i) => { const h = Math.round((w.km / maxKm) * 96); const label = i === 0 || monthShort(w.week_start) !== monthShort(weeks[i - 1].week_start) ? monthShort(w.week_start) : ''; return `<div class="nc-kmcol"><small>${w.km ? Math.round(w.km) : ''}</small><i style="height:${Math.max(3, h)}px;background:${i === weeks.length - 1 ? '#C6F24E' : '#4F8FC0'}"></i><span>${label}</span></div>`; }).join('');

    const dayMap = new Map((evo?.days || []).map(d => [d.date, d]));
    const todayIso = localIso();
    const heat = weeks.map(w => `<div class="nc-heatcol">${Array.from({ length: 7 }, (_, d) => { const date = I.addDaysIso(w.week_start, d); const day = dayMap.get(date); const cls = date > todayIso ? 'future' : day ? (day.km >= 15 || day.duration_sec >= 4800 ? 'big' : 'on') : ''; return `<i class="${cls}" title="${date}"></i>`; }).join('')}</div>`).join('');
    const activeDays = (evo?.days || []).length;

    const base = rows => { const v = r => rows.map(x => num(x[r])).filter(x => x !== null && x > 0); const avg = arr => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null; return { hrv: avg(v('hrv')), rhr: avg(v('resting_hr')), sleep: avg(v('sleep_sec')) }; };
    const recent = base(daily.slice(-28)), before = base(daily.slice(-56, -28));
    const body = [
      recent.hrv ? { k: 'VFC media', v: `${Math.round(recent.hrv)} ms`, d: before.hrv ? Math.round(recent.hrv - before.hrv) : null, good: d => d >= 0 } : null,
      recent.rhr ? { k: 'Pulso reposo', v: `${Math.round(recent.rhr)}`, d: before.rhr ? Math.round(recent.rhr - before.rhr) : null, good: d => d <= 0 } : null,
      recent.sleep ? { k: 'Sueño', v: minutesLabel(recent.sleep), d: before.sleep ? Math.round((recent.sleep - before.sleep) / 60) : null, good: d => d >= 0, unit: ' min' } : null,
    ].filter(Boolean);

    return `
      <section class="nc-dark"><span class="nc-k nc-k-light">En resumen</span><strong class="nc-ready-title">${esc(headline)}</strong></section>
      ${fitnessSeries.filter(v => v !== null).length >= 2 ? `<section class="nc-card"><div class="nc-row"><span class="nc-k">Nivel de forma</span>${fitDelta !== null ? `<span class="nc-pill ${fitDelta >= 0 ? 'nc-pill-green' : 'nc-pill-soft'}">${fitDelta >= 0 ? '+' : ''}${comma(fitDelta, 0)} puntos</span>` : ''}</div>${svgLine(fitnessSeries, { thin: fatigueSeries })}<small class="nc-mut">Sube cuando entrenas con constancia${fatigueSeries ? '. La línea fina es el cansancio de cada día' : ''}.</small></section>` : ''}
      ${markers.length ? `<section class="nc-card"><span class="nc-k">Tus marcadores</span><div class="nc-markers">${markers.map(m => `<div class="nc-stat"><span>${m.k}</span><b>${esc(m.v)}</b>${m.d ? `<small class="${m.good ? 'nc-green' : 'nc-warn'}">${esc(m.d)}</small>` : ''}</div>`).join('')}</div><small class="nc-mut">Estimados con tus entrenamientos. Lo importante es la tendencia.</small></section>` : ''}
      ${weeks.length ? `<section class="nc-card"><div class="nc-row"><span class="nc-k">Kilómetros por semana</span><small class="nc-mut">media ${comma(kmAvg, 0)} km</small></div><div class="nc-km">${bars}</div></section>` : ''}
      ${zTot > 0 ? `<section class="nc-card"><span class="nc-k">¿Haces el suave suave?</span><div class="nc-zbar"><i style="width:${(zEasy / zTot * 100).toFixed(1)}%;background:#4F8FC0"><em>${Math.round(zEasy / zTot * 100)} % suave</em></i><i style="width:${(zMid / zTot * 100).toFixed(1)}%;background:#E3B341"></i><i style="width:${(zHard / zTot * 100).toFixed(1)}%;background:#C8402F"></i></div><p class="nc-p">${zEasy / zTot >= 0.75 ? 'Muy bien repartido. Lo ideal es cerca de un 80 % suave y un 20 % fuerte, con poco tiempo en la zona media.' : zMid / zTot >= 0.25 ? `Pasas un ${Math.round(zMid / zTot * 100)} % en la zona media ("zona gris"). Haz los días suaves más suaves y los duros, duros.` : 'Hay bastante intensidad. Asegúrate de que los días suaves sean suaves de verdad.'}</p></section>` : ''}
      ${weeks.length ? `<section class="nc-card"><div class="nc-row"><span class="nc-k">Constancia</span><b class="nc-h3s">${activeDays} días entrenados</b></div><div class="nc-heat">${heat}</div><small class="nc-mut">Cada columna es una semana, de lunes (arriba) a domingo. Verde oscuro: sesión larga.</small></section>` : ''}
      ${body.length ? `<section class="nc-card"><span class="nc-k">Tu cuerpo (últimas 4 semanas)</span><div class="nc-grid3">${body.map(b => `<div class="nc-stat"><span>${b.k}</span><b>${esc(b.v)}</b>${b.d !== null ? `<small class="${b.good(b.d) ? 'nc-green' : 'nc-warn'}">${b.d === 0 ? '=' : `${b.d > 0 ? '▲' : '▼'} ${Math.abs(b.d)}${b.unit || ''}`}</small>` : ''}</div>`).join('')}</div></section>` : ''}
      <button type="button" class="nc-btn nc-btn-lime" data-nc-share>${icon.share} Compartir mi semana</button>`;
  }

  async function renderEvolution() {
    const host = q('#ncEvolution'); if (!host) return;
    if (cache.evolution) host.innerHTML = evolutionHtml(cache.evolution);
    const evo = await loadEvolution();
    if (!evo && !cache.evolution) { host.innerHTML = '<div class="empty-state">No se pudo cargar tu evolución. Prueba de nuevo en un rato.</div>'; return; }
    host.innerHTML = evolutionHtml(evo);
  }

  // ---------- TARJETA PARA COMPARTIR ----------
  async function shareCard() {
    const evo = await loadEvolution();
    const weeks = evo?.weeks || [];
    let week = weeks.at(-1);
    if (week && !week.sessions && weeks.length > 1) week = weeks.at(-2);
    if (!week) { try { message('Todavía no hay actividades para compartir.', 'error'); } catch {} return; }
    const a = athlete();
    const dayMap = new Map((evo.days || []).map(d => [d.date, d]));
    const perDay = Array.from({ length: 7 }, (_, i) => dayMap.get(I.addDaysIso(week.week_start, i))?.km || 0);
    const longest = Math.max(...perDay);
    const goals = [...(a?.goals || [])].filter(g => g.goal_date >= localIso()).sort((x, y) => String(x.goal_date).localeCompare(String(y.goal_date)));
    const goal = goals[0];
    try { await document.fonts?.ready; } catch {}
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
    const c = canvas.getContext('2d');
    const F = (w, s) => `${w} ${s}px Manrope, Inter, system-ui, sans-serif`;
    c.fillStyle = '#1E2622'; c.fillRect(0, 0, 1080, 1920);
    c.fillStyle = '#C6F24E'; roundRect(c, 90, 110, 96, 96, 26); c.fill();
    c.fillStyle = '#17201C'; c.font = F(800, 40); c.textAlign = 'center'; c.fillText('RF', 138, 172);
    c.textAlign = 'left'; c.fillStyle = '#F3F4EF'; c.font = F(800, 40); c.fillText('RUNFLOW', 214, 172);
    c.fillStyle = '#B9C4BC'; c.font = F(500, 34); c.textAlign = 'right';
    c.fillText(`${dayLabel(week.week_start, { day: 'numeric', month: 'short' })} – ${dayLabel(I.addDaysIso(week.week_start, 6), { day: 'numeric', month: 'short' })}`, 990, 172);
    c.textAlign = 'left'; c.fillStyle = '#C6F24E'; c.font = F(700, 38); c.fillText('MI SEMANA', 90, 380);
    c.fillStyle = '#F3F4EF'; c.font = F(800, 210); const kmText = comma(week.km); c.fillText(kmText, 80, 590);
    const kmWidth = c.measureText(kmText).width; c.font = F(800, 80); c.fillText(' km', 80 + kmWidth, 590);
    const stats = [['Sesiones', String(week.sessions)], ['Tiempo', minutesLabel(week.duration_sec)], week.elevation_m >= 50 ? ['Desnivel', `${week.elevation_m} m`] : ['Carga', String(week.load)]];
    stats.forEach(([k, v], i) => { c.fillStyle = '#B9C4BC'; c.font = F(500, 34); c.fillText(k, 90 + i * 320, 720); c.fillStyle = '#F3F4EF'; c.font = F(800, 64); c.fillText(v, 90 + i * 320, 800); });
    const maxDay = Math.max(1, ...perDay); const colW = 108, gap = 33;
    perDay.forEach((km, i) => { const h = Math.max(10, (km / maxDay) * 360); const x = 90 + i * (colW + gap); c.fillStyle = km === longest && km > 0 ? '#C6F24E' : km ? '#4F8FC0' : '#36403B'; roundRect(c, x, 1260 - h, colW, h, 22); c.fill(); c.fillStyle = '#B9C4BC'; c.font = F(600, 32); c.textAlign = 'center'; c.fillText('LMXJVSD'[i], x + colW / 2, 1310); c.textAlign = 'left'; });
    c.fillStyle = '#2A332E'; roundRect(c, 90, 1390, 900, 190, 40); c.fill();
    c.fillStyle = '#C6F24E'; roundRect(c, 130, 1435, 100, 100, 28); c.fill();
    c.strokeStyle = '#17201C'; c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(160, 1500); c.lineTo(200, 1500); c.moveTo(180, 1485); c.lineTo(180, 1500); c.moveTo(157, 1455); c.lineTo(203, 1455); c.lineTo(203, 1470); c.arc(180, 1470, 23, 0, Math.PI); c.closePath(); c.stroke();
    c.fillStyle = '#B9C4BC'; c.font = F(500, 32); c.fillText('Lo mejor de la semana', 270, 1470);
    c.fillStyle = '#F3F4EF'; c.font = F(800, 48); c.fillText(longest ? `Sesión más larga: ${comma(longest)} km` : `${week.sessions} sesiones hechas`, 270, 1535);
    c.fillStyle = '#B9C4BC'; c.font = F(500, 34);
    if (goal) c.fillText(`Preparando ${goal.name} · faltan ${Math.max(0, Math.ceil((new Date(`${goal.goal_date}T00:00:00`) - new Date(new Date().toDateString())) / 86400000))} días`.slice(0, 60), 90, 1760);
    c.fillText('Entreno con RunFlow', 90, 1830);
    const url = canvas.toDataURL('image/png');
    openShareModal(url, canvas);
  }
  function roundRect(c, x, y, w, h, r) { r = Math.min(r, h / 2, w / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function openShareModal(url, canvas) {
    let modal = q('#ncShareModal');
    if (!modal) {
      modal = document.createElement('div'); modal.id = 'ncShareModal'; modal.className = 'modal-backdrop hidden';
      modal.innerHTML = '<div class="modal nc-share-modal"><div class="athlete-session-modal-head"><button type="button" class="athlete-modal-close" data-nc-close aria-label="Cerrar">←</button><div><p class="athlete-kicker">PARA COMPARTIR</p><h2>Tu semana</h2></div></div><div class="modal-body"><img alt="Resumen de tu semana" class="nc-share-img"><div class="nc-share-actions"><button type="button" class="nc-btn nc-btn-lime" data-nc-do-share>Compartir</button><a class="nc-btn" data-nc-download download="runflow-mi-semana.png">Guardar imagen</a></div><small class="nc-mut">Si tu móvil no deja compartir desde aquí, mantén pulsada la imagen o haz una captura.</small></div></div>';
      document.body.appendChild(modal);
      modal.querySelector('[data-nc-close]').addEventListener('click', () => modal.classList.add('hidden'));
    }
    modal.querySelector('img').src = url;
    modal.querySelector('[data-nc-download]').href = url;
    const shareBtn = modal.querySelector('[data-nc-do-share]');
    shareBtn.onclick = () => canvas.toBlob(async blob => {
      try {
        const file = new File([blob], 'runflow-mi-semana.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Mi semana con RunFlow' });
        else modal.querySelector('[data-nc-download]').click();
      } catch (error) { if (error?.name !== 'AbortError') modal.querySelector('[data-nc-download]').click(); }
    }, 'image/png');
    modal.classList.remove('hidden');
  }

  // ---------- Enganches con athlete.js ----------
  function wrap(name, after) {
    const original = window[name];
    if (typeof original !== 'function' || original.__nc) return;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      if (result && typeof result.then === 'function') return result.then(value => { try { after(...args); } catch (error) { console.warn(`[nueva cara] ${name}`, error); } return value; });
      try { after(...args); } catch (error) { console.warn(`[nueva cara] ${name}`, error); }
      return result;
    };
    wrapped.__nc = true;
    window[name] = wrapped;
  }

  // Guardamos el detalle de la actividad que pide athlete.js para no repetir la petición.
  if (typeof window.api === 'function' && !window.api.__nc) {
    const originalApi = window.api;
    const apiWrapped = async function (url, options) {
      const data = await originalApi(url, options);
      if (/^\/api\/athlete\/activities\/[^/?]+$/.test(String(url))) cache.activityDetail = data;
      if (/^\/api\/athlete\/activities\?/.test(String(url)) && Array.isArray(data?.activities) && data.activities.length) cache.lastActivity = data.activities[0];
      if (/^\/api\/athlete\/manual-log/.test(String(url))) cache.evolutionAt = 0;
      return data;
    };
    apiWrapped.__nc = true;
    window.api = apiWrapped;
  }

  wrap('renderToday', () => { renderHoy(); });
  wrap('openWorkout', () => enhanceSession());
  wrap('openActivity', () => enhanceActivity());
  wrap('switchView', name => { if (name === 'evolution') renderEvolution(); });

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-nc-open-workout],[data-nc-open-activity],[data-nc-nav],[data-nc-share],[data-nc-checkin]');
    if (!target) return;
    if (target.dataset.ncOpenWorkout) openWorkout(target.dataset.ncOpenWorkout);
    else if (target.dataset.ncOpenActivity) openActivity(target.dataset.ncOpenActivity);
    else if (target.dataset.ncNav) switchView(target.dataset.ncNav);
    else if (target.hasAttribute('data-nc-share')) shareCard();
    else if (target.hasAttribute('data-nc-checkin')) q('#runflowOpenDailyCheckin')?.click();
  });

  installEvolutionView();
  document.addEventListener('runflow:athlete-dashboard-ready', () => renderHoy());
  if (athlete()) renderHoy();
})();
