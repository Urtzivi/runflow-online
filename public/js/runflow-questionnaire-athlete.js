// RunFlow · app del deportista: cuestionarios que le envía su entrenador.
// Sale una tarjeta arriba en Inicio mientras haya uno pendiente. Preguntas de una opción y una abierta
// que se responde escribiendo o grabando un audio (MediaRecorder; en la APK necesita la versión con micrófono).
(() => {
  'use strict';
  if (window.__rfQuestionnaireAthlete) return;
  window.__rfQuestionnaireAthlete = true;
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const MAX_SECONDS = (window.RunFlowQuestionnaires && window.RunFlowQuestionnaires.MAX_AUDIO_SECONDS) || 180;
  const DRAFT = id => `rf_questionnaire_draft_${id}`;
  const state = { list: [], current: null, answers: {}, rec: null, audio: {}, sending: false, back: 'home' };

  async function api(url, options = {}) {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo conectar con RunFlow.');
    return d;
  }
  function toast(text) { const el = $('#toast'); if (!el) return; el.textContent = text; el.classList.add('show'); clearTimeout(window.__rqToast); window.__rqToast = setTimeout(() => el.classList.remove('show'), 2600); }
  function show(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function injectUi() {
    if ($('#rqStyles')) return true;
    const app = $('#app') || document.querySelector('main');
    if (!app || !$('#home')) return false;
    const style = document.createElement('style'); style.id = 'rqStyles';
    style.textContent = `
.rq-card{display:flex;align-items:center;gap:12px;width:100%;margin:10px 0;padding:14px;border-radius:18px;border:1px solid rgba(183,243,74,.55);background:linear-gradient(100deg,rgba(183,243,74,.20),rgba(183,243,74,.04));color:inherit;text-align:left;font:inherit;cursor:pointer}
.rq-card .ic{width:42px;height:42px;border-radius:13px;background:rgba(183,243,74,.22);display:grid;place-items:center;font-size:21px;flex:none}
.rq-card b{display:block;font-size:14.5px}.rq-card small{display:block;color:#c9d8b0;font-size:12px;margin-top:2px}.rq-card .go{margin-left:auto;color:#b7f34a;font-weight:900;font-size:20px}
.rq-intro{padding:14px;border-radius:16px;background:rgba(183,243,74,.10);border:1px solid rgba(183,243,74,.35);font-size:14px;line-height:1.5;margin-top:4px}
.rq-prog{height:6px;border-radius:4px;background:#1f3550;margin:12px 0 4px;overflow:hidden}.rq-prog i{display:block;height:100%;background:#b7f34a;border-radius:4px;transition:width .2s}
.rq-progl{font-size:11.5px;color:var(--muted,#8fa7b8);font-weight:700}
.rq-q{margin:20px 0 8px;font-weight:900;font-size:15px;line-height:1.35}.rq-q small{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#b7f34a;margin-bottom:3px}
.rq-opts{display:grid;gap:7px}
.rq-opts button{width:100%;text-align:left;border-radius:13px;padding:12px 13px;border:1px solid var(--line,#24425e);background:#071724;color:#cfe0f5;font:inherit;font-size:14px;font-weight:700;cursor:pointer}
.rq-opts button.on{border-color:var(--blue,#3b8cff);background:#0f2a4a;color:#fff;box-shadow:0 0 0 1px var(--blue,#3b8cff) inset}
.rq-text{width:100%;box-sizing:border-box;min-height:110px;background:#071724;border:1px solid var(--line,#24425e);border-radius:13px;color:#fff;padding:11px 12px;font:inherit;font-size:14px;resize:vertical}
.rq-or{text-align:center;color:var(--muted,#8fa7b8);font-size:12px;font-weight:800;margin:10px 0}
.rq-rec{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px;border-radius:14px;border:1px dashed #35576c;background:#081a2c}
.rq-rec button{border:0;border-radius:12px;padding:11px 14px;font:inherit;font-weight:900;font-size:14px;cursor:pointer;background:#b7f34a;color:#0b1a10}
.rq-rec button.stop{background:#e2534b;color:#fff}.rq-rec button.ghost{background:transparent;border:1px solid var(--line,#24425e);color:#cfe0f5;font-weight:800}
.rq-rec .t{font-variant-numeric:tabular-nums;font-weight:900;font-size:16px}.rq-rec .dot{width:10px;height:10px;border-radius:50%;background:#e2534b;animation:rqBlink 1s infinite}
.rq-rec audio{width:100%;margin-top:4px}.rq-rec .msg{width:100%;font-size:12.5px;color:#f2c48f;line-height:1.4}
@keyframes rqBlink{50%{opacity:.25}}
.rq-send{width:100%;margin-top:20px}
.rq-done{text-align:center;padding:30px 16px}.rq-done b{display:block;font-size:22px;margin:10px 0 6px}.rq-done p{color:var(--muted,#8fa7b8);line-height:1.5}`;
    document.head.appendChild(style);
    const view = document.createElement('section');
    view.className = 'view'; view.id = 'rqView';
    view.innerHTML = `<div class="screen-head"><button class="back-btn" data-rq-back="1">‹</button><h1 style="font-size:20px;margin:0" id="rqTitle">Cuestionario</h1><span style="width:42px"></span></div><div id="rqBody"></div>`;
    const nav = app.querySelector('nav.nav');
    nav ? nav.before(view) : app.appendChild(view);
    app.addEventListener('click', onClick);
    app.addEventListener('input', onInput);
    return true;
  }

  // ---------- tarjeta en Inicio ----------
  function renderHomeCard() {
    const home = $('#home'); if (!home) return;
    let box = $('#rqHome');
    if (!box) { box = document.createElement('div'); box.id = 'rqHome'; const hero = home.querySelector('.hero'); hero ? hero.after(box) : home.prepend(box); }
    const pending = state.list.filter(q => q.status === 'pending');
    box.innerHTML = pending.map(q => `<button class="rq-card" data-rq-open="${esc(q.id)}"><span class="ic">📝</span><span><b>${esc(q.title)}</b><small>Tu entrenador te ha enviado ${q.questions.length} preguntas · unos 3 minutos</small></span><span class="go">›</span></button>`).join('');
  }
  async function refresh() {
    try { state.list = (await api('/api/athlete/questionnaires')).questionnaires || []; renderHomeCard(); }
    catch { /* sin sesión o sin conexión: no se enseña nada */ }
  }

  // ---------- cuestionario ----------
  function open(id) {
    const q = state.list.find(x => x.id === id); if (!q) return;
    state.current = q;
    let draft = {};
    try { draft = JSON.parse(localStorage.getItem(DRAFT(id)) || '{}') || {}; } catch { draft = {}; }
    state.answers = draft;
    $('#rqTitle').textContent = q.title;
    render(); show('rqView');
  }
  function saveDraft() { try { localStorage.setItem(DRAFT(state.current.id), JSON.stringify(state.answers)); } catch { /* sin almacenamiento */ } }
  function answeredCount() {
    const q = state.current;
    return q.questions.filter(x => x.type === 'choice' ? state.answers[x.id] : (String(state.answers[x.id] || '').trim() || state.audio[x.id])).length;
  }
  function recorderHtml(qid) {
    const r = state.rec && state.rec.qid === qid ? state.rec : null, a = state.audio[qid];
    if (r && r.recording) return `<div class="rq-rec"><span class="dot"></span><span class="t" data-rq-time="${qid}">${mmss(r.seconds)}</span><span class="rq-progl">/ ${mmss(MAX_SECONDS)}</span><button class="stop" data-rq-stop="${qid}" style="margin-left:auto">■ Parar</button></div>`;
    if (a) return `<div class="rq-rec"><span>🎧 Tu audio (${mmss(a.seconds)})</span><button class="ghost" data-rq-del="${qid}" style="margin-left:auto">Borrar y repetir</button><audio controls src="${a.url}"></audio></div>`;
    return `<div class="rq-rec"><button data-rq-rec="${qid}">🎙️ Grabar audio</button><span class="rq-progl">Hasta ${Math.round(MAX_SECONDS / 60)} minutos</span>${state.rec?.error && state.rec.qid === qid ? `<div class="msg">${esc(state.rec.error)}</div>` : ''}</div>`;
  }
  function render() {
    const q = state.current, body = $('#rqBody'); if (!q || !body) return;
    const total = q.questions.length, done = answeredCount();
    body.innerHTML = `<div class="rq-intro">${esc(q.intro)}</div>
      <div class="rq-prog"><i style="width:${Math.round(done / total * 100)}%"></i></div><div class="rq-progl" data-rq-count>${done} de ${total} respondidas</div>
      ${q.questions.map((x, i) => x.type === 'choice'
        ? `<div class="rq-q">${i + 1}. ${esc(x.text)}</div><div class="rq-opts">${x.options.map(o => `<button data-rq-q="${x.id}" data-rq-v="${esc(o)}" class="${state.answers[x.id] === o ? 'on' : ''}">${esc(o)}</button>`).join('')}</div>`
        : `<div class="rq-q"><small>${esc(x.label || 'Pregunta abierta')}</small>${i + 1}. ${esc(x.text)}</div>
           <textarea class="rq-text" data-rq-text="${x.id}" maxlength="3000" placeholder="Escribe aquí tu respuesta…">${esc(state.answers[x.id] || '')}</textarea>
           ${x.audio ? `<div class="rq-or">o si prefieres, cuéntalo con tu voz</div><div data-rq-recbox="${x.id}">${recorderHtml(x.id)}</div>` : ''}`).join('')}
      <button class="primary rq-send" data-rq-send="1">Enviar a mi entrenador</button>`;
  }
  function paintRecorder(qid) { const box = document.querySelector(`[data-rq-recbox="${qid}"]`); if (box) box.innerHTML = recorderHtml(qid); paintCount(); }
  function paintCount() {
    const q = state.current; if (!q) return;
    const done = answeredCount(), el = document.querySelector('[data-rq-count]'), bar = document.querySelector('.rq-prog i');
    if (el) el.textContent = `${done} de ${q.questions.length} respondidas`;
    if (bar) bar.style.width = `${Math.round(done / q.questions.length * 100)}%`;
  }

  // ---------- grabación ----------
  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  }
  const NO_MIC = 'Tu móvil no ha dejado usar el micrófono desde RunFlow. Si usas la app, instala la versión nueva que te ha pasado tu entrenador. Mientras, puedes escribir la respuesta arriba.';
  async function startRec(qid) {
    if (state.rec?.recording) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { state.rec = { qid, error: NO_MIC }; paintRecorder(qid); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (error) { state.rec = { qid, error: error?.name === 'NotFoundError' ? 'No encontramos el micrófono del móvil. Puedes escribir la respuesta arriba.' : NO_MIC }; paintRecorder(qid); return; }
    const mime = pickMime();
    let recorder;
    try { recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 }); }
    catch { recorder = new MediaRecorder(stream); }
    const rec = { qid, recording: true, seconds: 0, chunks: [], recorder, stream, startedAt: Date.now(), timer: null };
    state.rec = rec;
    recorder.ondataavailable = e => { if (e.data && e.data.size) rec.chunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(rec.timer);
      stream.getTracks().forEach(t => t.stop());
      rec.recording = false;
      if (rec.cancelled) return;
      const type = (recorder.mimeType || mime || 'audio/webm');
      const blob = new Blob(rec.chunks, { type });
      const seconds = Math.max(1, Math.round((Date.now() - rec.startedAt) / 1000));
      if (blob.size < 800) { state.rec = { qid, error: 'No se ha grabado nada. Prueba otra vez y habla cerca del móvil.' }; paintRecorder(qid); return; }
      if (state.audio[qid]?.url) URL.revokeObjectURL(state.audio[qid].url);
      state.audio[qid] = { blob, mime: type, seconds, url: URL.createObjectURL(blob) };
      state.rec = null;
      paintRecorder(qid);
    };
    rec.timer = setInterval(() => {
      rec.seconds = Math.floor((Date.now() - rec.startedAt) / 1000);
      const el = document.querySelector(`[data-rq-time="${qid}"]`); if (el) el.textContent = mmss(rec.seconds);
      if (rec.seconds >= MAX_SECONDS) stopRec();
    }, 500);
    recorder.start(1000);
    paintRecorder(qid);
  }
  function stopRec(cancel = false) {
    const rec = state.rec; if (!rec?.recording) return;
    rec.cancelled = cancel;
    try { rec.recorder.stop(); } catch { rec.stream?.getTracks().forEach(t => t.stop()); }
  }
  const toBase64 = blob => new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(',')[1] || ''); fr.onerror = () => reject(new Error('No se pudo leer el audio.')); fr.readAsDataURL(blob); });

  async function send(button) {
    const q = state.current; if (!q || state.sending) return;
    if (state.rec?.recording) return toast('Para la grabación antes de enviar.');
    const missing = q.questions.findIndex(x => x.type === 'choice' ? !state.answers[x.id] : !(String(state.answers[x.id] || '').trim() || state.audio[x.id]));
    if (missing >= 0) {
      toast(`Te falta la pregunta ${missing + 1}.`);
      document.querySelectorAll('.rq-q')[missing]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    state.sending = true; button.disabled = true; button.textContent = 'Enviando…';
    try {
      const audio = {};
      for (const [qid, a] of Object.entries(state.audio)) audio[qid] = { mime: a.mime, seconds: a.seconds, data: await toBase64(a.blob) };
      const answers = Object.fromEntries(q.questions.map(x => [x.id, x.type === 'choice' ? state.answers[x.id] : String(state.answers[x.id] || '').trim()]));
      await api(`/api/athlete/questionnaires/${encodeURIComponent(q.id)}/answer`, { method: 'POST', body: JSON.stringify({ answers, audio }) });
      try { localStorage.removeItem(DRAFT(q.id)); } catch { /* nada */ }
      Object.values(state.audio).forEach(a => URL.revokeObjectURL(a.url));
      state.audio = {};
      $('#rqBody').innerHTML = `<div class="card rq-done"><div style="font-size:44px">🙌</div><b>¡Gracias!</b><p>Tu entrenador ya tiene tus respuestas. Las usaremos para ayudarte a disfrutar y mejorar.</p><button class="primary" data-rq-back="1" style="width:100%;margin-top:14px">Volver al inicio</button></div>`;
      await refresh();
    } catch (error) {
      toast(error.message);
      button.disabled = false; button.textContent = 'Enviar a mi entrenador';
    } finally { state.sending = false; }
  }

  // ---------- eventos ----------
  function onClick(event) {
    const el = event.target.closest('[data-rq-open],[data-rq-back],[data-rq-q],[data-rq-rec],[data-rq-stop],[data-rq-del],[data-rq-send]');
    if (!el) return;
    const d = el.dataset;
    if (d.rqOpen) { open(d.rqOpen); return; }
    if (d.rqBack) { stopRec(true); show('home'); return; }
    if (d.rqQ) {
      state.answers[d.rqQ] = d.rqV; saveDraft();
      el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
      paintCount(); return;
    }
    if (d.rqRec) { startRec(d.rqRec); return; }
    if (d.rqStop) { stopRec(); return; }
    if (d.rqDel) { const a = state.audio[d.rqDel]; if (a) URL.revokeObjectURL(a.url); delete state.audio[d.rqDel]; paintRecorder(d.rqDel); return; }
    if (d.rqSend) send(el);
  }
  function onInput(event) {
    const qid = event.target.dataset?.rqText; if (!qid) return;
    state.answers[qid] = event.target.value; saveDraft(); paintCount();
  }

  function boot() {
    if (!injectUi()) { if ((boot.tries = (boot.tries || 0) + 1) < 40) setTimeout(boot, 250); return; }
    refresh();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('#rqView')?.classList.contains('active')) refresh(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
