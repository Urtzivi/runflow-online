// RunFlow Coach · cuestionarios al deportista.
// - «Para revisar»: aviso cuando un deportista responde (hasta que lo abres).
// - Ficha › Fútbol: enviar un cuestionario y ver los enviados con sus respuestas.
// - Ventana con las respuestas y el audio de la pregunta abierta.
(() => {
  'use strict';
  if (window.__rfCoachQuestionnaires) return;
  window.__rfCoachQuestionnaires = true;
  const q = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const when = iso => { if (!iso) return ''; const d = new Date(iso); return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(d).replace(/\./g, ''); };
  const mmss = s => `${Math.floor((s || 0) / 60)}:${String(Math.round((s || 0) % 60)).padStart(2, '0')}`;
  const state = { unseen: [], athleteId: '', athleteItems: null, templates: [], busy: false, lastFetch: 0 };

  async function api(url, options = {}) {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d;
  }

  function styles() {
    if (q('#rqCoachStyles')) return;
    const s = document.createElement('style'); s.id = 'rqCoachStyles';
    s.textContent = `
#rqReview{margin-bottom:14px}
.rqc-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid #e6e9e2}.rqc-row:first-of-type{border-top:0}
.rqc-row .ic{width:38px;height:38px;border-radius:12px;background:#eef8d6;display:grid;place-items:center;font-size:18px;flex:none}
.rqc-row b{display:block;font-size:14px}.rqc-row small{display:block;color:#737a74;font-size:12px;margin-top:2px}
.rqc-row .act{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.rqc-btn{border:1px solid #dde1da;background:#fff;border-radius:11px;padding:7px 12px;font:inherit;font-weight:800;font-size:13px;cursor:pointer;color:#181d19;white-space:nowrap}
.rqc-btn.lime{background:#C6F24E;border-color:#C6F24E;color:#111}.rqc-btn:disabled{opacity:.55;cursor:default}
.rqc-pill{font-size:11px;font-weight:900;border-radius:999px;padding:3px 9px;background:#eef0eb;color:#5d655e;white-space:nowrap}.rqc-pill.ok{background:#edf6dc;color:#3f8a2a}.rqc-pill.new{background:#C6F24E;color:#111}
#rqCoachBox{margin-top:14px}
.rqc-modal{position:fixed;inset:0;background:rgba(15,20,16,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:28px 14px;overflow-y:auto}
.rqc-sheet{background:#fbfbf7;color:#181d19;border-radius:20px;max-width:720px;width:100%;padding:22px 24px;box-shadow:0 24px 70px rgba(0,0,0,.25)}
.rqc-sheet h2{margin:4px 0 2px;font-size:22px}.rqc-sheet .sub{color:#737a74;font-size:13px}
.rqc-intro{background:#f1f7e2;border-radius:12px;padding:10px 12px;font-size:13px;margin:12px 0 4px;color:#424a43}
.rqc-qa{padding:12px 0;border-top:1px solid #e6e9e2}.rqc-qa:first-of-type{border-top:0}
.rqc-qa .qq{font-weight:800;font-size:14px}.rqc-qa .aa{margin-top:6px;font-size:14px}
.rqc-opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.rqc-opts span{font-size:12.5px;border-radius:999px;padding:4px 10px;background:#eef0eb;color:#8a918b}.rqc-opts span.on{background:#181d19;color:#fff;font-weight:800}
.rqc-open{white-space:pre-wrap;background:#fff;border:1px solid #dde1da;border-radius:12px;padding:10px 12px;margin-top:7px}
.rqc-audio{margin-top:8px}.rqc-audio audio{width:100%}
.rqc-close{float:right}`;
    document.head.appendChild(s);
  }

  // ---------- ventana con las respuestas ----------
  async function openModal(item) {
    styles();
    const wrap = document.createElement('div'); wrap.className = 'rqc-modal';
    const answered = item.status === 'answered';
    wrap.innerHTML = `<div class="rqc-sheet" role="dialog" aria-modal="true">
      <button type="button" class="rqc-btn rqc-close" data-rqc-close>Cerrar</button>
      <p class="rd-eyebrow">Cuestionario${item.athlete_name ? ` · ${esc(item.athlete_name)}` : ''}</p>
      <h2>${esc(item.title)}</h2>
      <div class="sub">Enviado ${esc(when(item.assigned_at))} · ${answered ? `respondido ${esc(when(item.answered_at))}` : 'todavía sin responder'}</div>
      <div class="rqc-intro">${esc(item.intro)}</div>
      ${item.questions.map((x, i) => {
        const a = item.answers?.[x.id];
        if (x.type === 'choice') return `<div class="rqc-qa"><div class="qq">${i + 1}. ${esc(x.text)}</div><div class="rqc-opts">${x.options.map(o => `<span class="${a === o ? 'on' : ''}">${a === o ? '✓ ' : ''}${esc(o)}</span>`).join('')}</div></div>`;
        return `<div class="rqc-qa"><div class="qq">${i + 1}. ${esc(x.text)}</div>
          ${a?.text ? `<div class="rqc-open">${esc(a.text)}</div>` : answered ? '<div class="aa" style="color:#737a74">No ha escrito nada.</div>' : ''}
          ${a?.audio_id ? `<div class="rqc-audio" data-rqc-audio="${esc(x.id)}"><small style="color:#737a74">Cargando el audio (${mmss(a.audio_seconds)})…</small></div>` : ''}</div>`;
      }).join('')}
    </div>`;
    const close = () => { wrap.querySelectorAll('audio').forEach(a => { a.pause(); if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src); }); wrap.remove(); };
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-rqc-close]')) close(); });
    document.body.appendChild(wrap);
    // El audio se descarga con la sesión del coach y se reproduce desde memoria.
    wrap.querySelectorAll('[data-rqc-audio]').forEach(async box => {
      try {
        const r = await fetch(`/api/coach/questionnaires/${encodeURIComponent(item.id)}/audio/${encodeURIComponent(box.dataset.rqcAudio)}`, { credentials: 'same-origin', cache: 'no-store' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo cargar el audio.');
        const url = URL.createObjectURL(await r.blob());
        box.innerHTML = `<div style="font-size:12.5px;font-weight:800;margin-bottom:4px">🎧 Su respuesta en audio (${mmss(item.answers[box.dataset.rqcAudio].audio_seconds)})</div><audio controls preload="auto" src="${url}"></audio>
          <a class="rqc-btn" style="display:inline-block;margin-top:6px;text-decoration:none" href="${url}" download="${esc(`${item.athlete_name || 'audio'}-${item.title}`.replace(/[^\wÀ-ÿ -]+/g, ''))}.${/mp4|m4a|aac/.test(item.answers[box.dataset.rqcAudio].audio_mime || '') ? 'm4a' : /ogg/.test(item.answers[box.dataset.rqcAudio].audio_mime || '') ? 'ogg' : 'webm'}">Descargar audio</a>`;
      } catch (error) { box.innerHTML = `<small style="color:#c0392b">${esc(error.message)}</small>`; }
    });
    if (answered && !item.seen_at) {
      api(`/api/coach/questionnaires/${encodeURIComponent(item.id)}/seen`, { method: 'POST', body: '{}' }).then(() => {
        item.seen_at = new Date().toISOString();
        state.unseen = state.unseen.filter(x => x.id !== item.id);
        paintReview();
        if (state.athleteItems) paintAthlete();
      }).catch(() => {});
    }
  }

  // ---------- «Para revisar» ----------
  async function loadUnseen(force = false) {
    if (!force && Date.now() - state.lastFetch < 60000) return;
    state.lastFetch = Date.now();
    try { state.unseen = (await api('/api/coach/questionnaires?status=answered&unseen=1')).questionnaires || []; }
    catch { state.unseen = []; }
    paintReview();
  }
  function paintReview() {
    const main = q('#rdReviewMain') || q('#summaryView');
    let box = q('#rqReview');
    if (!state.unseen.length) { if (box) box.remove(); return; }
    if (!main) return;
    styles();
    if (!box) { box = document.createElement('section'); box.id = 'rqReview'; box.className = 'rd-card'; const after = q('#rdProposals'); after && after.parentElement === main ? after.after(box) : main.prepend(box); }
    box.innerHTML = `<p class="rd-eyebrow" style="color:#3E9B4F">Cuestionarios respondidos</p>
      ${state.unseen.map((x, i) => `<div class="rqc-row"><span class="ic">📝</span><span><b>${esc(x.athlete_name || 'Un deportista')} ha respondido «${esc(x.title)}»</b><small>${esc(when(x.answered_at))}${Object.values(x.answers || {}).some(a => a && a.audio_id) ? ' · con audio 🎧' : ''}</small></span>
        <span class="act"><span class="rqc-pill new">Nuevo</span><button type="button" class="rqc-btn lime" data-rqc-unseen="${i}">Ver respuestas</button></span></div>`).join('')}`;
    box.querySelectorAll('[data-rqc-unseen]').forEach(b => b.onclick = () => openModal(state.unseen[Number(b.dataset.rqcUnseen)]));
  }

  // ---------- ficha › Fútbol ----------
  const selectedAthlete = () => q('#athleteSelect')?.value || '';
  const selectedName = () => q('#athleteSelect')?.selectedOptions?.[0]?.textContent.trim() || '';
  async function loadAthlete(id) {
    state.athleteId = id; state.athleteItems = null; paintAthlete();
    try {
      const d = await api(`/api/coach/athletes/${encodeURIComponent(id)}/questionnaires`);
      if (state.athleteId !== id) return;
      state.athleteItems = d.questionnaires || []; state.templates = d.templates || [];
    } catch (error) { if (state.athleteId === id) state.athleteItems = { error: error.message }; }
    paintAthlete();
  }
  function paintAthlete() {
    const view = q('#footballView'); if (!view) return;
    styles();
    let box = q('#rqCoachBox');
    if (!box) { box = document.createElement('div'); box.id = 'rqCoachBox'; view.appendChild(box); }
    const items = state.athleteItems;
    if (!items) { box.innerHTML = '<div class="fw-card"><div class="fw-eyebrow">Cuestionarios</div><p style="color:#737a74">Cargando…</p></div>'; return; }
    if (items.error) { box.innerHTML = `<div class="fw-card"><div class="fw-eyebrow">Cuestionarios</div><p style="color:#c0392b">${esc(items.error)}</p></div>`; return; }
    const pendingIds = new Set(items.filter(x => x.status === 'pending').map(x => x.template_id));
    box.innerHTML = `<div class="fw-card"><div class="fw-eyebrow">Cuestionarios</div>
      <p style="color:#737a74;margin:4px 0 8px">Le aparecen arriba en Inicio de su app hasta que los responde. Cuando responda te avisamos en «Para revisar».</p>
      ${items.map((x, i) => `<div class="rqc-row"><span class="ic">📝</span><span><b>${esc(x.title)}</b><small>Enviado ${esc(when(x.assigned_at))}${x.answered_at ? ` · respondido ${esc(when(x.answered_at))}` : ''}</small></span>
        <span class="act">${x.status === 'answered' ? `<span class="rqc-pill ${x.seen_at ? 'ok' : 'new'}">${x.seen_at ? 'Respondido' : 'Nuevo'}</span><button type="button" class="rqc-btn lime" data-rqc-item="${i}">Ver respuestas</button>`
          : `<span class="rqc-pill">Pendiente</span><button type="button" class="rqc-btn" data-rqc-item="${i}">Ver preguntas</button><button type="button" class="rqc-btn" data-rqc-cancel="${esc(x.id)}">Retirar</button>`}</span></div>`).join('') || '<p style="color:#737a74">Todavía no le has enviado ninguno.</p>'}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${state.templates.map(t => `<button type="button" class="rqc-btn${pendingIds.has(t.id) ? '' : ' lime'}" data-rqc-send="${esc(t.id)}" ${pendingIds.has(t.id) ? 'disabled title="Ya lo tiene pendiente"' : ''}>Enviar «${esc(t.title)}» (${t.questions} preguntas)</button>`).join('')}</div></div>`;
    box.querySelectorAll('[data-rqc-item]').forEach(b => b.onclick = () => openModal({ ...items[Number(b.dataset.rqcItem)], athlete_name: selectedName() }));
    box.querySelectorAll('[data-rqc-send]').forEach(b => b.onclick = async () => {
      const t = state.templates.find(x => x.id === b.dataset.rqcSend);
      if (!confirmSend(t)) return;
      b.disabled = true;
      try { await api(`/api/coach/athletes/${encodeURIComponent(state.athleteId)}/questionnaires`, { method: 'POST', body: JSON.stringify({ template_id: t.id }) }); }
      catch (error) { b.disabled = false; b.textContent = error.message; return; }
      loadAthlete(state.athleteId);
    });
    box.querySelectorAll('[data-rqc-cancel]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await api(`/api/coach/questionnaires/${encodeURIComponent(b.dataset.rqcCancel)}`, { method: 'DELETE' }); } catch (error) { b.textContent = error.message; return; }
      loadAthlete(state.athleteId);
    });
  }
  // Dos pulsaciones para enviar (sin ventanas del navegador).
  let armed = null;
  function confirmSend(t) {
    const b = q(`[data-rqc-send="${t.id}"]`);
    if (armed === t.id) { armed = null; return true; }
    armed = t.id; if (b) b.textContent = `Pulsa otra vez para enviar a ${selectedName() || 'este deportista'}`;
    setTimeout(() => { if (armed === t.id) { armed = null; paintAthlete(); } }, 5000);
    return false;
  }

  function tick() {
    const review = q('#summaryView');
    if (review && review.classList.contains('active')) { loadUnseen(); if (state.unseen.length && !q('#rqReview')) paintReview(); }
    const fv = q('#footballView');
    if (fv && fv.classList.contains('active')) {
      const id = selectedAthlete();
      if (id && id !== state.athleteId) loadAthlete(id);
      else if (id && !q('#rqCoachBox')) paintAthlete();
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { state.lastFetch = 0; tick(); } });
  setInterval(tick, 1500);
  setTimeout(() => loadUnseen(true), 1200);
  window.RunFlowCoachQuestionnaires = { refresh: () => { state.lastFetch = 0; loadUnseen(true); if (state.athleteId) loadAthlete(state.athleteId); }, openModal };
})();
