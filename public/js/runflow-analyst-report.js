/* RunFlow Coach · Informes del Analista (Claude).
 * Pinta el informe que guarda el Analista (Markdown sencillo: ##, ###, listas, **negrita**)
 * en el diálogo de validar una sesión y en las propuestas semanales. Solo lectura. */
(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');

  function markdown(text) {
    const out = []; let list = null, para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      let m;
      if (!line) { flushPara(); flushList(); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); const level = Math.min(5, m[1].length + 2); out.push(`<h${level}>${inline(m[2])}</h${level}>`); continue; }
      if ((m = line.match(/^[-*•]\s+(.*)$/)) || (m = line.match(/^\d+[.)]\s+(.*)$/))) {
        flushPara(); const tag = /^\d/.test(line) ? 'ol' : 'ul';
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push(m[1]); continue;
      }
      if (/^(-{3,}|_{3,})$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
      flushList(); para.push(line);
    }
    flushPara(); flushList();
    return out.join('');
  }

  const LIGHT = { verde: ['Verde', 'ok'], ambar: ['Ámbar', 'warn'], rojo: ['Rojo', 'bad'] };
  const GOAL = { si: ['Objetivo conseguido', 'ok'], parcial: ['Objetivo a medias', 'warn'], no: ['Objetivo no conseguido', 'bad'], sin_plan: ['Sin objetivo planificado', 'mut'] };

  function card(draft, { title = 'Informe del Analista', open = true } = {}) {
    if (!draft) return '';
    const light = LIGHT[draft.semaforo], goal = GOAL[draft.objetivo_cumplido];
    const when = String(draft.updated_at || draft.created_at || '').slice(0, 16).replace('T', ' ');
    const pills = [goal ? `<span class="ar-pill ${goal[1]}">${goal[0]}</span>` : '', draft.efecto_principal ? `<span class="ar-pill mut">Efecto: ${esc(draft.efecto_principal)}</span>` : '', light ? `<span class="ar-pill ${light[1]}">Semáforo ${light[0]}</span>` : ''].join('');
    const body = draft.informe_coach ? markdown(draft.informe_coach) : `<p>${esc((draft.hechos || []).join(' · '))}</p>`;
    const alerts = (draft.alertas || []).length ? `<div class="ar-alerts">${draft.alertas.map(a => `<p>⚠ ${esc(a)}</p>`).join('')}</div>` : '';
    const message = draft.mensaje_atleta ? `<div class="ar-msg"><span class="ar-k">Borrador de mensaje al atleta (no se ha enviado)</span><p>${esc(draft.mensaje_atleta)}</p></div>` : '';
    return `<section class="ar-card"><div class="ar-head"><span class="ar-k">${esc(title)}</span><small>${esc(when)}</small></div>${pills ? `<div class="ar-pills">${pills}</div>` : ''}${draft.resumen ? `<p class="ar-lead">${esc(draft.resumen)}</p>` : ''}${alerts}<details class="ar-details"${open ? ' open' : ''}><summary>Informe completo</summary><div class="ar-body">${body}</div>${message}</details></section>`;
  }

  const cache = new Map();
  async function drafts(athleteId, kind) {
    const key = `${athleteId}:${kind}`;
    if (!cache.has(key)) {
      cache.set(key, fetch(`/api/coach/assistant-drafts?status=all&kind=${encodeURIComponent(kind)}&athlete_id=${encodeURIComponent(athleteId)}`, { credentials: 'same-origin' })
        .then(r => (r.ok ? r.json() : { drafts: [] })).then(d => d.drafts || []).catch(() => []));
      setTimeout(() => cache.delete(key), 60000);
    }
    return cache.get(key);
  }
  async function forSession(athleteId, activityId) { return (await drafts(athleteId, 'session')).find(d => String(d.activity_id) === String(activityId)) || null; }
  async function forWeek(athleteId, weekStart) { return (await drafts(athleteId, 'week')).find(d => String(d.week_start) === String(weekStart)) || null; }

  window.RunflowAnalystReport = { markdown, card, forSession, forWeek };
})();
