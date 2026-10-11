// RunFlow Fútbol · app del deportista: su semana, el circuito de fuerza del día con la ficha de cada ejercicio
// y la valoración después de cada entreno, partido o fuerza.
(() => {
  'use strict';
  const S = window.RunFlowFootballSchedule;
  if (!S) return;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const ICON = { football_training: '⚽', strength: '🏋️', match: '🏆', rest: '💤' };
  const dayLong = iso => { const s = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric' }).format(new Date(`${iso}T12:00:00`)); return s.charAt(0).toUpperCase() + s.slice(1); };
  const monthName = iso => new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(new Date(`${iso}T12:00:00`));
  const STORE = 'rf_football_circuit_v1';
  const state = { week: null, rate: null, circuit: null, timer: null, lastView: 'home' };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo conectar con RunFlow.');
    return data;
  }
  function toast(text) { const el = $('#toast'); if (!el) return; el.textContent = text; el.classList.add('show'); clearTimeout(window.__rfWeekToast); window.__rfWeekToast = setTimeout(() => el.classList.remove('show'), 2400); }
  function show(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
    const nav = { home: 'home', fwkCircuit: 'training', fwkExercise: 'training', fwkRate: 'home' }[id];
    if (nav) document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.go === nav));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const blockOf = item => (state.week?.strength || []).find(b => b.id === item?.strength_id) || null;
  const allItems = () => (state.week?.days || []).flatMap(d => d.items.map(i => ({ ...i, md: d.md })));
  const findItem = key => allItems().find(i => i.key === key) || null;

  // ---------- estilos y pantallas ----------
  function injectUi() {
    if ($('#fwkStyles')) return;
    const style = document.createElement('style'); style.id = 'fwkStyles';
    style.textContent = `
.fwk-pend{display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,rgba(242,166,91,.18),rgba(242,166,91,.05));border:1px solid rgba(242,166,91,.45);border-radius:16px;padding:12px;margin:10px 0;width:100%;color:inherit;text-align:left;font:inherit}
.fwk-pend .ic{width:38px;height:38px;border-radius:12px;background:rgba(242,166,91,.2);display:grid;place-items:center;font-size:19px;flex:none}
.fwk-pend b{display:block;font-size:13.5px}.fwk-pend small{color:#d7b48c;font-size:11.5px}.fwk-pend .go{margin-left:auto;color:#f2a65b;font-weight:900;font-size:18px}
.fwk-card{padding:14px;margin-top:10px}
.fwk-card h3{margin:2px 0 0;font-size:16px}
.fwk-strip{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-top:10px}
.fwk-strip button{border-radius:12px;padding:7px 2px;text-align:center;border:1px solid var(--line);background:#071724;color:inherit;font:inherit}
.fwk-strip b{display:block;font-size:10px;color:var(--muted);font-weight:800}
.fwk-strip span{display:block;font-size:17px;margin:3px 0 1px;min-height:22px}
.fwk-strip small{display:block;font-size:9px;color:var(--muted);font-weight:700}
.fwk-strip .today{border-color:var(--blue);background:#0f2a4a;box-shadow:0 0 0 1px var(--blue) inset}
.fwk-strip .past{opacity:.62}
.fwk-dot{width:6px;height:6px;border-radius:50%;margin:3px auto 0;background:transparent}
.fwk-dot.ok{background:#4cc38a}.fwk-dot.todo{background:#f2a65b}
.fwk-legend{margin-top:9px;font-size:11.5px;color:var(--muted)}
.fwk-next{display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #1a2e45;width:100%;background:none;border-left:0;border-right:0;border-top:0;color:inherit;text-align:left;font:inherit}
.fwk-next:last-child{border-bottom:0}
.fwk-next .ic{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;font-size:20px}
.fwk-ic-football_training{background:rgba(59,140,255,.16)}.fwk-ic-match{background:rgba(238,117,110,.18)}.fwk-ic-strength{background:rgba(242,166,91,.18)}.fwk-ic-rest{background:rgba(143,167,184,.12)}
.fwk-next b{font-size:13.5px}.fwk-next small{display:block;color:var(--muted);font-size:11.5px}
.fwk-next em{font-style:normal;font-size:11px;font-weight:900;color:#f2a65b}
.fwk-next em.ok{color:#4cc38a}
.fwk-round{display:flex;gap:6px;margin-top:8px}.fwk-round i{flex:1;height:6px;border-radius:4px;background:#1f3550}.fwk-round i.on{background:#f2a65b}.fwk-round i.half{background:linear-gradient(90deg,#f2a65b 50%,#1f3550 50%)}
.fwk-timer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px}
.fwk-timer h3{margin:0;font-size:18px}.fwk-timer p{margin:3px 0 0;color:var(--muted);font-size:12.5px}
.fwk-timer b{font-size:40px;font-variant-numeric:tabular-nums;letter-spacing:-.02em;white-space:nowrap}
.fwk-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.fwk-st{display:grid;grid-template-columns:28px 1fr auto;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #1a2e45}
.fwk-st:last-child{border-bottom:0}
.fwk-st .n{width:28px;height:28px;border-radius:9px;background:rgba(242,166,91,.18);color:#f2a65b;display:grid;place-items:center;font-weight:900;font-size:12px}
.fwk-st.now{background:rgba(242,166,91,.08);margin:0 -8px;padding:8px;border-radius:12px;border-bottom:0}
.fwk-st.now .n{background:#f2a65b;color:#06111c}.fwk-st.ok{opacity:.55}
.fwk-st b{font-size:13px}.fwk-st small{display:block;color:var(--muted);font-size:11px}
.fwk-st button{width:32px;height:32px;border-radius:50%;border:1px solid var(--line);background:#071724;color:white;font-size:11px}
.fwk-rest{text-align:center;padding:18px 14px}.fwk-rest b{display:block;font-size:46px;font-variant-numeric:tabular-nums;margin:6px 0}
.fwk-video{height:200px;border-radius:16px;overflow:hidden;position:relative;border:1px solid #35576c;background:linear-gradient(135deg,#123a63,#081a2c);display:grid;place-items:center;margin-top:4px}
.fwk-video img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.5}
.fwk-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.fwk-video a{position:relative;width:62px;height:62px;border-radius:50%;background:rgba(255,255,255,.92);color:#06111c;display:grid;place-items:center;font-size:22px;padding-left:4px;text-decoration:none}
.fwk-video small{position:absolute;left:10px;bottom:8px;font-size:11px;font-weight:800;color:#cfe0f5}
.fwk-cue{display:flex;gap:8px;align-items:flex-start;color:#cfe0f5;font-size:12.5px;line-height:1.45;margin-top:7px}
.fwk-q{margin:16px 0 7px;font-weight:900;font-size:14px}.fwk-q small{color:var(--muted);font-weight:700;font-size:11.5px}
.fwk-rpe{display:grid;grid-template-columns:repeat(10,1fr);gap:4px}
.fwk-rpe button{border-radius:9px;padding:9px 0;text-align:center;font-weight:900;font-size:13px;border:1px solid var(--line);background:#071724;color:#9fb3cc;font-family:inherit}
.fwk-rpe button.on{color:#06111c;border-color:transparent;transform:scale(1.08)}
.fwk-rpe-l{display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);margin-top:5px;font-weight:700}
.fwk-opts{display:grid;gap:6px}.fwk-opts.c2{grid-template-columns:1fr 1fr}.fwk-opts.c3{grid-template-columns:repeat(3,1fr)}.fwk-opts.c4{grid-template-columns:repeat(4,1fr)}.fwk-opts.c5{grid-template-columns:repeat(5,1fr)}
.fwk-opts button{border-radius:12px;padding:9px 4px;text-align:center;font-weight:800;font-size:11px;border:1px solid var(--line);background:#071724;color:#9fb3cc;line-height:1.3;font-family:inherit}
.fwk-opts button i{display:block;font-style:normal;font-size:20px;margin-bottom:2px}
.fwk-opts button.on{border-color:var(--blue);background:#0f2a4a;color:#fff}
.fwk-num{display:flex;align-items:center;justify-content:space-between;background:#071724;border:1px solid var(--line);border-radius:13px;padding:8px 10px}
.fwk-num b{font-size:20px}.fwk-num button{width:36px;height:36px;border-radius:10px;background:#15283f;border:0;color:white;font-weight:900;font-size:18px}
.fwk-load{display:flex;justify-content:space-between;align-items:center;background:rgba(59,140,255,.12);border:1px solid rgba(59,140,255,.35);border-radius:14px;padding:11px 13px;margin-top:16px}
.fwk-load b{font-size:22px}.fwk-load small{color:#9fb3cc;font-size:11.5px}
.fwk-input{width:100%;box-sizing:border-box;min-height:44px;background:#071724;border:1px solid var(--line);border-radius:12px;color:white;padding:0 12px;font:inherit;margin-top:6px}
.fwk-info{color:var(--muted);font-size:12.5px;background:#071724;border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.fwk-done{text-align:center;padding:22px 14px}.fwk-done b{display:block;font-size:20px;margin:8px 0 4px}`;
    document.head.appendChild(style);
    const app = $('#app'), nav = app?.querySelector('nav.nav');
    if (!app) return;
    const view = (id, title, back) => { const s = document.createElement('section'); s.className = 'view'; s.id = id; s.innerHTML = `<div class="screen-head"><button class="back-btn" data-fwk-back="${back}">‹</button><h1 style="font-size:20px;margin:0" id="${id}Title">${title}</h1><span style="width:42px"></span></div><div id="${id}Body"></div>`; app.insertBefore(s, nav); };
    view('fwkCircuit', 'Fuerza', 'home');
    view('fwkExercise', 'Cómo se hace', 'fwkCircuit');
    view('fwkRate', 'Valorar', 'home');
    app.addEventListener('click', onClick);
    app.addEventListener('input', onInput);
    const home = $('#home'), anchor = home?.querySelector('.mood-card');
    if (home && anchor) { const box = document.createElement('div'); box.id = 'fwkHome'; anchor.before(box); }
    const training = $('#training');
    if (training) { const box = document.createElement('div'); box.id = 'fwkTraining'; training.querySelector('.screen-head')?.after(box); }
    // Registrar algo que no estaba en la semana: abre la misma valoración.
    document.querySelectorAll('.log-shortcut').forEach(button => {
      const copy = button.cloneNode(true); button.replaceWith(copy);
      copy.addEventListener('click', () => openRate(null, { Fuerza: 'strength', Fútbol: 'football_training', Partido: 'match' }[copy.dataset.kind] || 'football_training'));
    });
    const register = $('#home .activity-register');
    if (register) {
      register.querySelector('h3') && (register.querySelector('h3').textContent = '¿Algo fuera de tu semana?');
      register.querySelector('.eyebrow') && (register.querySelector('.eyebrow').textContent = 'Registrar actividad');
      register.querySelector('.badge')?.remove();
      const help = register.querySelector('.muted'); if (help) help.textContent = 'Lo que ya está en tu semana te lo pedimos solo. Usa esto para un entreno o partido extra.';
    }
  }

  // ---------- inicio ----------
  function renderHome() {
    const box = $('#fwkHome'); if (!box || !state.week) return;
    const today = state.week.today, monday = S.mondayOf(today);
    const week = state.week.days.filter(d => d.date >= monday && d.date <= S.addDays(monday, 6));
    const hasPlan = state.week.days.some(d => d.items.length);
    const pending = state.week.pending || [];
    let html = '';
    if (pending.length) {
      const p = pending[0];
      const when = p.date === today ? 'de hoy' : p.date === S.addDays(today, -1) ? 'de ayer' : `del ${dayLong(p.date).toLowerCase()}`;
      const what = p.kind === 'match' ? `el partido ${when}` : p.kind === 'strength' ? `la fuerza ${when}` : `el entreno ${when}`;
      html += `<button class="fwk-pend" data-fwk-rate="${esc(p.key)}"><span class="ic">📝</span><span><b>¿Qué tal ${what}?</b><small>${pending.length > 1 ? `Tienes ${pending.length} sesiones sin valorar` : 'Valóralo en 30 segundos'}</small></span><span class="go">›</span></button>`;
    }
    if (hasPlan) {
      html += `<div class="card fwk-card"><div class="eyebrow">Tu semana</div><h3>${Number(monday.slice(8))}–${Number(S.addDays(monday, 6).slice(8))} de ${monthName(S.addDays(monday, 6))}</h3>
        <div class="fwk-strip">${week.map(d => {
          const main = d.items.find(i => i.kind === 'match') || d.items.find(i => i.kind === 'football_training') || d.items.find(i => i.kind === 'strength') || d.items[0];
          const rated = d.items.filter(i => S.RATED_KINDS.includes(i.kind));
          const dot = !rated.length ? '' : rated.some(i => i.pending) ? 'todo' : rated.every(i => i.rating) ? 'ok' : '';
          return `<button class="${d.date === today ? 'today' : d.date < today ? 'past' : ''}" data-fwk-day="${d.date}"><b>${'LMXJVSD'[d.day]}</b><span>${main ? ICON[main.kind] : ''}${d.items.length > 1 && main?.kind !== 'rest' ? '<sup style="font-size:9px">+</sup>' : ''}</span><small>${Number(d.date.slice(8))}${d.md ? ` · ${d.md}` : ''}</small><i class="fwk-dot ${dot}"></i></button>`;
        }).join('')}</div>
        <div class="fwk-legend"><span style="color:#4cc38a">●</span> valorada &nbsp; <span style="color:#f2a65b">●</span> pendiente de valorar</div></div>`;
      const upcoming = allItems().filter(i => i.date >= today && i.kind !== 'rest').slice(0, 4);
      if (upcoming.length) html += `<div class="card fwk-card"><div class="eyebrow">Hoy y próximo</div>${upcoming.map(itemRow).join('')}</div>`;
    }
    box.innerHTML = html;
    const training = $('#fwkTraining');
    if (training) {
      const todayStrength = allItems().find(i => i.date === today && i.kind === 'strength' && blockOf(i));
      training.innerHTML = todayStrength ? `<button class="fwk-pend" style="border-color:rgba(242,166,91,.6)" data-fwk-circuit="${esc(todayStrength.key)}"><span class="ic">🏋️</span><span><b>Hoy toca ${esc(todayStrength.title)}</b><small>Circuito · ${todayStrength.duration_min} min · toca para empezar</small></span><span class="go">›</span></button>` : '';
    }
  }
  function itemRow(i) {
    const today = state.week.today;
    const when = i.date === today ? 'Hoy' : dayLong(i.date);
    const detail = i.kind === 'match' ? [i.time, i.rival ? `vs ${i.rival}` : '', i.home === false ? 'fuera' : 'casa'].filter(Boolean).join(' · ')
      : i.kind === 'strength' ? [`${i.duration_min} min`, i.note].filter(Boolean).join(' · ')
        : [i.time, i.duration_min ? `${i.duration_min} min` : '', i.place].filter(Boolean).join(' · ');
    const status = i.rating ? '<em class="ok">✓ valorado</em>' : i.pending ? '<em>Valorar ›</em>' : i.kind === 'strength' && i.date === today ? '<em>Empezar ›</em>' : '';
    const act = i.kind === 'strength' && !i.rating ? `data-fwk-circuit="${esc(i.key)}"` : i.pending ? `data-fwk-rate="${esc(i.key)}"` : '';
    const title = i.kind === 'football_training' ? 'Entreno fútbol' : i.title;
    return `<button class="fwk-next" ${act}><span class="ic fwk-ic-${i.kind}">${ICON[i.kind]}</span><span><b>${esc(title)} · ${esc(when.toLowerCase() === 'hoy' ? 'hoy' : when)}</b><small>${esc(detail)}</small></span>${status}</button>`;
  }

  // ---------- circuito ----------
  function buildSteps(block) {
    const steps = [], n = block.stations.length, R = block.rounds || 1;
    if (block.format === 'sets') {
      block.stations.forEach((_, s) => {
        for (let r = 0; r < R; r++) {
          steps.push({ type: 'work', station: s, round: r });
          if (r < R - 1 && block.transition_sec) steps.push({ type: 'rest', sec: block.transition_sec, label: 'Descanso entre series' });
        }
        if (s < n - 1 && block.rest_sec) steps.push({ type: 'rest', sec: block.rest_sec, label: 'Descanso, cambia de ejercicio' });
      });
    } else {
      for (let r = 0; r < R; r++) {
        block.stations.forEach((_, s) => {
          steps.push({ type: 'work', station: s, round: r });
          if (s < n - 1 && block.transition_sec) steps.push({ type: 'rest', sec: block.transition_sec, label: 'Cambio de estación' });
        });
        if (r < R - 1 && block.rest_sec) steps.push({ type: 'rest', sec: block.rest_sec, label: `Descanso · vuelta ${r + 2} de ${R} a continuación` });
      }
    }
    return steps;
  }
  function loadProgress(key) { try { return JSON.parse(localStorage.getItem(STORE) || '{}')[key] || null; } catch { return null; } }
  function saveProgress(key, value) { try { const all = JSON.parse(localStorage.getItem(STORE) || '{}'); all[key] = value; localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* sin almacenamiento */ } }
  function openCircuit(key) {
    const item = findItem(key), block = blockOf(item);
    if (!item || !block || !block.stations.length) { toast('Este bloque aún no tiene ejercicios.'); return; }
    const saved = loadProgress(key);
    state.circuit = { key, item, block, steps: buildSteps(block), step: saved?.step || 0, finished: !!saved?.finished, left: null, running: false };
    stopTimer();
    renderCircuit(); show('fwkCircuit');
  }
  const fmtClock = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  function renderCircuit() {
    const c = state.circuit, body = $('#fwkCircuitBody'); if (!c || !body) return;
    const { block } = c, circuit = block.format !== 'sets';
    $('#fwkCircuitTitle').textContent = block.name;
    if (c.finished) {
      body.innerHTML = `<div class="card fwk-done"><div style="font-size:40px">💪</div><b>¡${circuit ? 'Circuito' : 'Fuerza'} terminado!</b><div class="muted">${block.stations.length} ejercicios × ${block.rounds} ${circuit ? 'vueltas' : 'series'} · ${c.item.duration_min} min</div>
        ${c.item.rating ? '<div class="muted" style="margin-top:10px">✓ Ya lo has valorado.</div>' : `<button class="primary" style="width:100%;margin-top:14px" data-fwk-rate="${esc(c.key)}">Valorar la sesión</button>`}
        <button class="secondary" style="width:100%;margin-top:8px" data-fwk-act="restart">Empezar de nuevo</button></div>`;
      return;
    }
    const step = c.steps[c.step];
    const workSteps = c.steps.filter(s => s.type === 'work');
    const doneWork = c.steps.slice(0, c.step).filter(s => s.type === 'work').length;
    const current = step.type === 'work' ? step : c.steps.slice(c.step).find(s => s.type === 'work');
    const round = current ? current.round : block.rounds - 1;
    let top;
    if (step.type === 'rest') {
      const next = block.stations[current.station];
      if (c.left === null) { c.left = step.sec; startTimer(); }
      top = `<div class="card fwk-rest"><div class="eyebrow">${esc(step.label)}</div><b>${fmtClock(c.left)}</b><div class="muted">Siguiente: ${esc(next.name)} · ${esc(next.work)}</div>
        <button class="secondary" style="width:100%;margin-top:12px" data-fwk-act="next">Saltar descanso ›</button></div>`;
    } else {
      const st = block.stations[step.station], timed = S.timedSeconds(st.work);
      if (c.left === null && timed) c.left = timed;
      const label = circuit ? `Vuelta ${step.round + 1} de ${block.rounds} · estación ${step.station + 1} de ${block.stations.length}` : `${st.name.split(' ')[0]} · serie ${step.round + 1} de ${block.rounds}`;
      top = `<div class="card fwk-card"><div class="eyebrow">${esc(label)}</div>
        <div class="fwk-round">${Array.from({ length: circuit ? block.rounds : block.stations.length }, (_, i) => { const idx = circuit ? step.round : step.station; return `<i class="${i < idx ? 'on' : i === idx ? 'half' : ''}"></i>`; }).join('')}</div>
        <div class="fwk-timer"><div><h3>${esc(st.name)}</h3><p>${esc(st.note || '')}</p></div><b>${timed ? fmtClock(c.left ?? timed) : esc(st.work)}</b></div>
        ${timed ? `<div class="fwk-btns"><button class="secondary" data-fwk-ex="${step.station}">ⓘ Cómo se hace</button><button class="primary" data-fwk-act="${c.running ? 'pause' : 'start'}">${c.running ? '❚❚ Pausa' : '▶ Empezar'}</button></div><button class="secondary" style="width:100%;margin-top:8px" data-fwk-act="next">Siguiente ›</button>`
          : `<div class="fwk-btns"><button class="secondary" data-fwk-ex="${step.station}">ⓘ Cómo se hace</button><button class="primary" data-fwk-act="next">Hecho ›</button></div>`}</div>`;
    }
    const list = block.stations.map((st, i) => {
      const doneThisRound = circuit ? c.steps.slice(0, c.step).some(s => s.type === 'work' && s.station === i && s.round === round) : c.steps.slice(0, c.step).filter(s => s.type === 'work' && s.station === i).length >= block.rounds;
      const now = current && current.station === i;
      return `<div class="fwk-st${now ? ' now' : doneThisRound ? ' ok' : ''}"><div class="n">${doneThisRound && !now ? '✓' : i + 1}</div><div><b>${esc(st.name)}</b><small>${esc(st.work)}${now ? ' · ahora' : ''}</small></div><button data-fwk-ex="${i}" aria-label="Ver cómo se hace">▶</button></div>`;
    }).join('');
    const transition = circuit ? `${block.transition_sec} s para cambiar de estación · ${fmtClock(block.rest_sec)} de descanso al acabar la vuelta` : `${block.transition_sec} s entre series · ${fmtClock(block.rest_sec)} entre ejercicios`;
    body.innerHTML = `${top}<div class="card fwk-card">${list}</div><p class="muted" style="text-align:center">${transition} · ${doneWork}/${workSteps.length} hechos</p>
      <button class="secondary" style="width:100%" data-fwk-act="finish">Terminar y valorar</button>`;
  }
  function startTimer() {
    const c = state.circuit; if (!c) return;
    stopTimer(); c.running = true;
    state.timer = setInterval(() => {
      if (!state.circuit || !$('#fwkCircuit')?.classList.contains('active')) return;
      c.left = Math.max(0, (c.left ?? 0) - 1);
      if (c.left === 0) { try { navigator.vibrate?.(300); } catch { /* sin vibración */ } advance(); return; }
      const big = $('#fwkCircuitBody .fwk-rest b, #fwkCircuitBody .fwk-timer b'); if (big) big.textContent = fmtClock(c.left);
    }, 1000);
  }
  function stopTimer() { clearInterval(state.timer); state.timer = null; if (state.circuit) state.circuit.running = false; }
  function advance() {
    const c = state.circuit; stopTimer(); c.left = null;
    c.step += 1;
    if (c.step >= c.steps.length) { c.finished = true; c.step = c.steps.length - 1; }
    saveProgress(c.key, { step: c.step, finished: c.finished });
    renderCircuit();
  }
  function openExercise(index) {
    const c = state.circuit; if (!c) return;
    const st = c.block.stations[index], body = $('#fwkExerciseBody'); if (!st || !body) return;
    body.innerHTML = `${videoHtml(st)}
      <div class="eyebrow" style="margin-top:13px;color:#f2a65b">${c.block.format === 'sets' ? 'Ejercicio' : 'Estación'} ${index + 1}</div>
      <h1 style="font-size:23px;margin:4px 0 2px">${esc(st.name)}</h1><div class="muted">${esc(st.work)}${st.note ? ` · ${esc(st.note)}` : ''}</div>
      ${st.steps.length ? `<div class="card" style="padding:14px;margin-top:10px"><div class="eyebrow" style="margin-bottom:9px">Paso a paso</div><div class="steps">${st.steps.map((s, j) => `<div class="step"><b>${j + 1}</b><span>${esc(s)}</span></div>`).join('')}</div></div>` : ''}
      ${st.cues || st.note ? `<div class="card" style="padding:14px;margin-top:10px"><div class="eyebrow">Fíjate en</div>${st.cues ? `<div class="fwk-cue">✅ ${esc(st.cues)}</div>` : ''}${st.note ? `<div class="fwk-cue">💬 Nota de tu entrenador: ${esc(st.note)}</div>` : ''}</div>` : ''}
      <button class="primary" style="width:100%;margin-top:12px" data-fwk-back="fwkCircuit">Volver al circuito</button>`;
    show('fwkExercise');
  }
  function youtubeId(url) {
    const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : null;
  }
  function videoHtml(st) {
    const id = youtubeId(st.video);
    if (id) return `<div class="fwk-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${esc(st.name)}" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
    if (st.video) return `<div class="fwk-video">${st.img ? `<img src="${esc(st.img)}" alt="">` : ''}<a href="${esc(st.video)}" target="_blank" rel="noopener" aria-label="Ver vídeo">▶</a><small>Vídeo · se abre en otra pestaña</small></div>`;
    return st.img ? `<div class="fwk-video"><img src="${esc(st.img)}" alt="" style="opacity:1"></div>` : '';
  }

  // ---------- valoración ----------
  function openRate(key, kind) {
    const item = key ? findItem(key) : null;
    const k = item?.kind || kind || 'football_training';
    state.rate = {
      key: item?.key || null, date: item?.date || state.week?.today || S.todayMadrid(), kind: k, item,
      minutes: k === 'match' ? (item?.duration_min || 70) : (item?.duration_min || (k === 'strength' ? 30 : 75)),
      rpe: null, body: null, mood: null, pain: false, painArea: '', painLevel: 2, note: '',
    };
    renderRate(); show('fwkRate');
  }
  const RPE_COLORS = ['#4cc38a', '#4cc38a', '#7fd17a', '#a8d86b', '#d6d55c', '#f2c14e', '#f2a65b', '#f2a65b', '#ee756e', '#e2534b'];
  function renderRate() {
    const r = state.rate, body = $('#fwkRateBody'); if (!r || !body) return;
    const color = r.kind === 'match' ? '#ee756e' : r.kind === 'strength' ? '#f2a65b' : '#29a7ff';
    const title = r.item ? (r.kind === 'match' ? (r.item.rival ? `vs ${r.item.rival}` : 'Partido') : r.kind === 'football_training' ? 'Entreno fútbol' : r.item.title) : `${S.KIND_LABEL[r.kind]} fuera de tu semana`;
    const load = r.rpe ? Math.round(r.minutes * r.rpe) : null;
    const durationQ = r.kind === 'match' ? `<div class="fwk-q">¿Cuántos minutos has jugado?</div><div class="fwk-num"><button data-fwk-min="-5">−</button><b>${r.minutes} min</b><button data-fwk-min="5">＋</button></div>`
      : r.item ? `<div class="fwk-info" style="margin-top:14px">Duración: <b>${r.minutes} min</b> (según tu plan)</div>`
        : `<div class="fwk-q">¿Cuánto ha durado?</div><div class="fwk-num"><button data-fwk-min="-5">−</button><b>${r.minutes} min</b><button data-fwk-min="5">＋</button></div>`;
    body.innerHTML = `<div class="card" style="padding:12px 14px"><div class="eyebrow" style="color:${color}">${esc(S.KIND_LABEL[r.kind])} · ${esc(dayLong(r.date))}</div><h3 style="margin:3px 0 0;font-size:17px">${esc(title)}</h3></div>
      ${durationQ}
      <div class="fwk-q">¿Cuánto esfuerzo te ha costado? <small>(RPE)</small></div>
      <div class="fwk-rpe">${Array.from({ length: 10 }, (_, i) => `<button data-fwk-rpe="${i + 1}" class="${r.rpe === i + 1 ? 'on' : ''}" ${r.rpe === i + 1 ? `style="background:${RPE_COLORS[i]}"` : ''}>${i + 1}</button>`).join('')}</div>
      <div class="fwk-rpe-l"><span>Muy fácil</span><span>Muy duro</span><span>Máximo</span></div>
      <div class="fwk-q">¿Cómo tienes el cuerpo?</div>
      <div class="fwk-opts c4">${S.BODY.map(b => `<button data-fwk-body="${b.value}" class="${r.body === b.value ? 'on' : ''}"><i>${b.icon}</i>${b.label}</button>`).join('')}</div>
      <div class="fwk-q">¿Cómo te sientes?</div>
      <div class="fwk-opts c5">${S.MOOD.map(m => `<button data-fwk-mood="${m.value}" class="${r.mood === m.value ? 'on' : ''}" aria-label="Ánimo ${m.value} de 5"><i>${m.icon}</i></button>`).join('')}</div>
      <div class="fwk-q">¿Te duele algo?</div>
      <div class="fwk-opts c2"><button data-fwk-pain="0" class="${!r.pain ? 'on' : ''}">No</button><button data-fwk-pain="1" class="${r.pain ? 'on' : ''}">Sí, dime dónde</button></div>
      ${r.pain ? `<input class="fwk-input" data-fwk-field="painArea" placeholder="Gemelo derecho, rodilla…" value="${esc(r.painArea)}">
        <div class="fwk-opts c3" style="margin-top:6px">${[[2, 'Leve'], [5, 'Media'], [8, 'Fuerte']].map(([v, l]) => `<button data-fwk-plevel="${v}" class="${r.painLevel === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      <input class="fwk-input" data-fwk-field="note" placeholder="Nota opcional: sensaciones, rival, resultado…" value="${esc(r.note)}" style="margin-top:14px">
      <div class="fwk-load"><div><small>Carga de la sesión</small><br><b>${load ?? '—'}</b></div><small style="text-align:right">${r.minutes} min × RPE ${r.rpe ?? '—'}<br>Tu entrenador la verá</small></div>
      <button class="primary" style="width:100%;margin-top:12px" data-fwk-act="save-rate">Guardar valoración</button>`;
  }
  async function saveRate(button) {
    const r = state.rate;
    if (!r.rpe) return toast('Elige el esfuerzo (RPE).');
    if (!r.body) return toast('Dinos cómo tienes el cuerpo.');
    if (!r.mood) return toast('Dinos cómo te sientes.');
    const payload = {
      kind: r.kind, rpe: r.rpe, body_state: r.body, mood: r.mood, note: r.note,
      pain: r.pain ? r.painLevel : 0, pain_area: r.pain ? r.painArea : '',
      feeling: { 5: 'muy_bien', 4: 'bien', 3: 'normal', 2: 'mal', 1: 'mal' }[r.mood],
      plan_key: r.key, plan_date: r.date,
      title: r.item ? (r.kind === 'match' ? (r.item.rival ? `vs ${r.item.rival}` : 'Partido') : r.item.title) : S.KIND_LABEL[r.kind],
    };
    if (r.kind === 'match') payload.minutes_played = r.minutes; else payload.duration_min = r.minutes;
    button.disabled = true;
    try {
      await api('/api/athlete/football/activity', { method: 'POST', body: JSON.stringify(payload) });
      toast('Valoración guardada ✓');
      await refresh();
      show('home');
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }

  // ---------- eventos ----------
  function onClick(event) {
    const el = event.target.closest('[data-fwk-back],[data-fwk-rate],[data-fwk-circuit],[data-fwk-act],[data-fwk-ex],[data-fwk-day],[data-fwk-rpe],[data-fwk-body],[data-fwk-mood],[data-fwk-pain],[data-fwk-plevel],[data-fwk-min]');
    if (!el) return;
    const d = el.dataset, r = state.rate;
    if (d.fwkBack) { if (d.fwkBack !== 'fwkCircuit') stopTimer(); show(d.fwkBack); return; }
    if (d.fwkRate) { stopTimer(); openRate(d.fwkRate); return; }
    if (d.fwkCircuit) { openCircuit(d.fwkCircuit); return; }
    if (d.fwkEx !== undefined) { openExercise(Number(d.fwkEx)); return; }
    if (d.fwkDay) { dayDetail(d.fwkDay); return; }
    if (d.fwkRpe) { r.rpe = Number(d.fwkRpe); renderRate(); return; }
    if (d.fwkBody) { r.body = Number(d.fwkBody); renderRate(); return; }
    if (d.fwkMood) { r.mood = Number(d.fwkMood); renderRate(); return; }
    if (d.fwkPain) { r.pain = d.fwkPain === '1'; renderRate(); return; }
    if (d.fwkPlevel) { r.painLevel = Number(d.fwkPlevel); renderRate(); return; }
    if (d.fwkMin) { r.minutes = Math.max(0, Math.min(r.kind === 'match' ? 180 : 360, r.minutes + Number(d.fwkMin))); renderRate(); return; }
    const c = state.circuit;
    switch (d.fwkAct) {
      case 'next': advance(); break;
      case 'start': startTimer(); renderCircuit(); break;
      case 'pause': stopTimer(); renderCircuit(); break;
      case 'restart': c.step = 0; c.finished = false; c.left = null; saveProgress(c.key, { step: 0, finished: false }); renderCircuit(); break;
      case 'finish': stopTimer(); saveProgress(c.key, { step: c.step, finished: true }); openRate(c.key); break;
      case 'save-rate': saveRate(el); break;
      default: break;
    }
  }
  function onInput(event) {
    const field = event.target.dataset?.fwkField;
    if (field && state.rate) state.rate[field] = event.target.value;
  }
  function dayDetail(date) {
    const day = state.week.days.find(d => d.date === date); if (!day) return;
    const items = day.items.filter(i => i.kind !== 'rest');
    if (!items.length) { toast(`${dayLong(date)}: descanso`); return; }
    const first = items.find(i => i.pending) || items.find(i => i.kind === 'strength' && date === state.week.today && !i.rating);
    if (first) { if (first.kind === 'strength' && !first.rating && !first.pending) openCircuit(first.key); else if (first.kind === 'strength' && date === state.week.today && !first.rating) openCircuit(first.key); else openRate(first.key); return; }
    toast(`${dayLong(date)}: ${items.map(i => i.kind === 'football_training' ? 'entreno' : i.title).join(' + ')}${items.every(i => i.rating || !S.RATED_KINDS.includes(i.kind)) && date <= state.week.today ? ' ✓' : ''}`);
  }

  async function refresh() {
    try { state.week = await api('/api/athlete/football/week'); renderHome(); }
    catch (error) { console.warn('[RunFlow Fútbol semana]', error); }
  }
  injectUi();
  refresh();
})();
