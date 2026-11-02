/* RunFlow Coach · Análisis de una actividad al revisarla o validarla.
 * Enseña al entrenador lo mismo que ve el atleta en su pantalla de actividad (resumen,
 * lectura, ritmo y pulso, series, tiempo en zonas, contexto y su valoración) y añade el
 * efecto del entrenamiento (window.RunflowTrainingEffect). */
(function () {
  'use strict';
  const I = () => window.RunflowInsights;
  const TE = () => window.RunflowTrainingEffect;
  const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const km = m => `${String(Math.round((num(m) || 0) / 100) / 10).replace('.', ',')} km`;
  const clock = sec => { const s = Math.round(num(sec) || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`; };
  const ZONE_COLOR = ['#9DC0DC', '#4C8DBF', '#E2B23C', '#E07B39', '#C8402F', '#9E2A1F', '#6E1A12'];
  const DOMAIN_COLOR = { rec: '#9DC0DC', aer: '#4C8DBF', tempo: '#E2B23C', thr: '#E07B39', vo2: '#C8402F', speed: '#7A1E5A' };
  const KIND_COLOR = { vo2: '#C8402F', thr: '#E07B39', tempo: '#C9971A', speed: '#7A1E5A', aer: '#2F6FA6', rec: '#6C9AC0', maintain: '#6B7A70', none: '#8A948D' };
  const FEELING = { muy_bien: 'Muy bien', bien: 'Bien', normal: 'Normal', regular: 'Regular', mal: 'Mal', muy_mal: 'Muy mal' };

  function streamOf(streams, type) { const row = (Array.isArray(streams) ? streams : []).find(s => String(s?.type || '').toLowerCase() === type); return Array.isArray(row?.data) ? row.data : []; }

  function chart(activity) {
    const time = streamOf(activity.streams, 'time');
    if (time.length < 60) return '';
    const hr = streamOf(activity.streams, 'heartrate');
    let speed = streamOf(activity.streams, 'velocity_smooth');
    const dist = streamOf(activity.streams, 'distance');
    if (!speed.length && dist.length) speed = dist.map((d, i) => i ? (d - dist[i - 1]) / Math.max(1, time[i] - time[i - 1]) : 0);
    const n = 220, step = Math.max(1, Math.floor(time.length / n)), pts = [];
    for (let i = 0; i < time.length; i += step) {
      let hs = 0, hn = 0, ss = 0, sn = 0;
      for (let j = Math.max(0, i - 10); j < Math.min(time.length, i + 10); j += 1) { if (num(hr[j]) > 40) { hs += hr[j]; hn += 1; } if (num(speed[j]) > 0.8) { ss += speed[j]; sn += 1; } }
      pts.push({ t: time[i] - time[0], hr: hn ? hs / hn : null, pace: sn ? 1000 / (ss / sn) : null });
    }
    const W = 640, H = 170, T = Math.max(1, pts.at(-1).t);
    const paces = pts.map(p => p.pace).filter(Boolean).sort((a, b) => a - b), hrs = pts.map(p => p.hr).filter(Boolean).sort((a, b) => a - b);
    if (!paces.length && !hrs.length) return '';
    const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)))];
    const pMin = paces.length ? pct(paces, 0.02) : 0, pMax = paces.length ? pct(paces, 0.95) : 1;
    const hMin = hrs.length ? pct(hrs, 0.02) - 5 : 0, hMax = hrs.length ? pct(hrs, 0.99) + 3 : 1;
    const x = t => (t / T) * W;
    const yP = p => 10 + ((Math.min(pMax, Math.max(pMin, p)) - pMin) / Math.max(1, pMax - pMin)) * (H - 40);
    const yH = h => H - 22 - ((Math.min(hMax, Math.max(hMin, h)) - hMin) / Math.max(1, hMax - hMin)) * (H - 40);
    const line = (key, y) => pts.filter(p => p[key]).map(p => `${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => `<text x="${Math.min(W - 22, x(T * f)).toFixed(0)}" y="${H - 4}" class="ca-axis">${Math.round((T * f) / 60)}'</text>`).join('');
    return `<section class="ca-card"><div class="ca-row"><span class="ca-k">Ritmo y pulso</span><div class="ca-legend"><span><i style="background:#C8402F"></i>pulso</span><span><i style="background:#17201C"></i>ritmo</span></div></div>
      <svg viewBox="0 0 ${W} ${H}" class="ca-chart" role="img" aria-label="Ritmo y pulso durante la actividad">${paces.length ? `<polyline points="${line('pace', yP)}" fill="none" stroke="#17201C" stroke-width="1.4" stroke-linejoin="round"/>` : ''}${hrs.length ? `<polyline points="${line('hr', yH)}" fill="none" stroke="#C8402F" stroke-width="1.8" stroke-linejoin="round"/>` : ''}${ticks}</svg>
      <small class="ca-mut">Ritmo: más arriba es más rápido.${paces.length ? ` Entre ${I().fmtPace(pct(paces, 0.95))} y ${I().fmtPace(pct(paces, 0.02))}/km.` : ''}${hrs.length ? ` Pulso entre ${Math.round(pct(hrs, 0.02))} y ${Math.round(pct(hrs, 0.99))} ppm.` : ''}</small></section>`;
  }

  function zonesCard(raw) {
    const zt = I().zoneTimes(raw); if (!zt) return '';
    const shown = zt.values.map((v, i) => ({ v, i })).filter(z => z.v > 0);
    return `<section class="ca-card"><span class="ca-k">Tiempo en cada zona (Intervals)</span>
      <div class="ca-zbar">${shown.map(z => `<i style="width:${((z.v / zt.total) * 100).toFixed(1)}%;background:${ZONE_COLOR[z.i] || ZONE_COLOR[6]}"></i>`).join('')}</div>
      <div class="ca-legend">${shown.map(z => `<span><i style="background:${ZONE_COLOR[z.i] || ZONE_COLOR[6]}"></i>Z${z.i + 1} ${Math.round(z.v / 60)}'</span>`).join('')}</div>
      <small class="ca-mut">${Math.round((zt.easy / zt.total) * 100)} % suave · ${Math.round((zt.mid / zt.total) * 100)} % medio · ${Math.round((zt.hard / zt.total) * 100)} % fuerte</small></section>`;
  }

  function effectCard(effect) {
    if (!effect) return '';
    if (!effect.available) return `<section class="ca-card ca-effect"><span class="ca-k">Efecto del entrenamiento</span><p class="ca-p">No se puede calcular: ${esc(effect.reason)}</p></section>`;
    const T = TE();
    const color = KIND_COLOR[effect.kind] || '#6B7A70';
    const dist = T.DOMAINS.map(d => ({ d, m: effect.minutes[d] })).filter(x => x.m >= 0.25);
    const stim = effect.stimuli;
    const dots = level => [1, 2, 3].map(l => `<i class="${l <= level ? 'on' : ''}"></i>`).join('');
    const fmtMin = m => m >= 10 ? `${Math.round(m)}'` : `${String(Math.round(m * 10) / 10).replace('.', ',')}'`;
    const cuts = effect.cuts || {};
    const how = [
      cuts.hr ? `Pulso (umbral ${Math.round(effect.refs.lthr)} ppm): recuperación &lt; ${cuts.hr[0]} · aeróbico ${cuts.hr[0]}–${cuts.hr[1]} · tempo ${cuts.hr[1]}–${cuts.hr[2]} · umbral ${cuts.hr[2]}–${cuts.hr[3]} · VO₂máx &gt; ${cuts.hr[3]} ppm.` : '',
      cuts.pace ? `Ritmo en llano (umbral ${I().fmtPace(1000 / effect.refs.thrSpeed)}/km): aeróbico desde ${cuts.pace[0]} · tempo desde ${cuts.pace[1]} · umbral desde ${cuts.pace[2]} · VO₂máx desde ${cuts.pace[3]} · velocidad más rápido de ${cuts.pace[4]}/km.` : '',
      'Cada segundo cuenta en el dominio más alto que marquen el pulso o el ritmo (el pulso tarda en subir en series cortas).',
      'Para que haya mejora hacen falta, acumulados: VO₂máx 6 min, umbral 15 min, tempo 25 min, base aeróbica 45 min, velocidad 2 min. Con la mitad, mantiene; con el doble, mejora mucho.',
    ].filter(Boolean);
    return `<section class="ca-card ca-effect" style="--ca-effect:${color}">
      <div class="ca-row"><span class="ca-k">Efecto del entrenamiento</span>${effect.plan ? `<span class="ca-plan ${effect.plan.ok ? 'ok' : 'warn'}">${effect.plan.ok ? '✓' : '⚠'} ${esc(effect.plan.ok ? 'Según lo previsto' : 'Distinto a lo previsto')}</span>` : ''}</div>
      <h3 class="ca-effect-title">${esc(effect.headline)}</h3>
      <p class="ca-p">${effect.lines.map(esc).join(' ')}${effect.plan ? ` <b>${esc(effect.plan.text)}</b>` : ''}</p>
      <div class="ca-stimuli">${stim.map(s => `<div class="ca-stim ${s.key === effect.primary ? 'main' : ''}"><span>${esc(s.label)}</span><span class="ca-dots" title="${esc(s.levelLabel)}">${dots(s.level)}</span><small>${esc(s.levelLabel)} · ${fmtMin(s.minutes)}</small></div>`).join('')}</div>
      ${dist.length ? `<div class="ca-zbar">${dist.map(x => `<i title="${esc(T.DOMAIN_LABEL[x.d])} ${fmtMin(x.m)}" style="width:${((x.m / Math.max(1, effect.total)) * 100).toFixed(1)}%;background:${DOMAIN_COLOR[x.d]}"></i>`).join('')}</div>
      <div class="ca-legend">${dist.map(x => `<span><i style="background:${DOMAIN_COLOR[x.d]}"></i>${esc(T.DOMAIN_LABEL[x.d])} ${fmtMin(x.m)}</span>`).join('')}</div>` : ''}
      <details class="ca-how"><summary>Cómo se calcula</summary><small class="ca-mut">${esc(effect.methodText)}</small><ul>${how.map(t => `<li>${t}</li>`).join('')}</ul></details>
    </section>`;
  }

  function feedbackCard(feedback, log) {
    const f = feedback || (log && (log.rpe || log.comment || log.feeling) ? log : null);
    if (!f) return '<section class="ca-card"><span class="ca-k">Valoración del atleta</span><p class="ca-mut">El atleta todavía no ha valorado esta actividad.</p></section>';
    const bits = [num(f.rpe) ? `Esfuerzo ${num(f.rpe)}/10` : '', f.feeling ? `Sensación: ${FEELING[f.feeling] || String(f.feeling).replace('_', ' ')}` : '', num(f.pain) !== null ? `Molestias ${num(f.pain)}/10` : ''].filter(Boolean);
    return `<section class="ca-card"><span class="ca-k">Valoración del atleta</span><div class="ca-chips">${bits.map(b => `<span class="ca-chip">${esc(b)}</span>`).join('')}</div>${f.comment ? `<p class="ca-p ca-quote">“${esc(f.comment)}”</p>` : ''}</section>`;
  }

  function render(host, detail, { athleteId, activityId, log } = {}) {
    if (!I()) { host.innerHTML = ''; return; }
    const activity = detail.activity || {}; const raw = activity.raw_summary || {};
    const planned = detail.planned || null;
    const zones = detail.athlete_zones || { hr: [], pace: [] };
    const analysis = detail.block_analysis && Array.isArray(detail.block_analysis.blocks) && detail.block_analysis.blocks.some(b => b.main_work) ? detail.block_analysis : null;
    const plannedKey = planned ? I().classifySession(planned) : null;
    const effect = TE() ? TE().analyse({ activity, athleteZones: zones, plannedKey }) : null;
    const comp = I().compliance(activity, planned);
    const reading = I().activityReading({ activity, planned, athleteZones: zones, analysis });
    const pace = num(activity.avg_pace_sec_per_km);
    const stats = [['Distancia', num(activity.distance_m) ? km(activity.distance_m) : '—'], ['Tiempo', clock(activity.duration_sec)], pace && num(activity.distance_m) > 500 ? ['Ritmo', `${I().fmtPace(pace)}/km`] : ['Carga', num(activity.load) ? String(Math.round(num(activity.load))) : '—']];
    const extra = [num(activity.avg_hr) ? `Pulso medio ${Math.round(num(activity.avg_hr))}` : '', num(activity.max_hr) ? `máx. ${Math.round(num(activity.max_hr))}` : '', num(activity.load) && stats[2][0] !== 'Carga' ? `carga ${Math.round(num(activity.load))}` : '', num(raw.moving_time) && num(raw.elapsed_time) && raw.elapsed_time - raw.moving_time >= 120 ? `parado ${clock(raw.elapsed_time - raw.moving_time)}` : ''].filter(Boolean).join(' · ');
    const chips = I().contextChips(activity, null).filter(c => !/^Tu esfuerzo/.test(c.label));
    const watchRpe = num(raw.icu_rpe) ?? num(raw.session_rpe);
    if (watchRpe) chips.push({ label: `RPE del reloj ${watchRpe}/10`, hint: 'Puesto por el atleta en Garmin/Intervals' });
    host.innerHTML = `<div class="ca">
      <section class="ca-dark">
        <div class="ca-row">${planned ? `<span class="ca-pill lime">${comp !== null && comp >= 85 ? 'Sesión cumplida' : 'Sesión hecha'}${comp !== null ? ` · ${comp} %` : ''}</span><small class="ca-k-light">vs ${esc(planned.title || 'plan')}</small>` : '<span class="ca-pill soft">Actividad libre</span>'}</div>
        <div class="ca-grid3">${stats.map(([k, v]) => `<div><small class="ca-k-light">${k}</small><b class="ca-hero">${esc(v)}</b></div>`).join('')}</div>
        ${extra ? `<small class="ca-k-light">${esc(extra)}</small>` : ''}
      </section>
      ${effectCard(effect)}
      ${reading.length ? `<section class="ca-card"><span class="ca-k">Lectura de la sesión (la misma que ve el atleta)</span><p class="ca-p">${reading.map((t, i) => i === 0 ? `<b>${esc(t)}</b>` : esc(t)).join(' ')}</p></section>` : ''}
      ${analysis ? '<section class="ca-card ca-blocks" data-ca-blocks></section>' : chart(activity)}
      <div class="ca-two">${zonesCard(raw)}${feedbackCard(detail.feedback, log)}</div>
      ${chips.length ? `<section class="ca-card"><span class="ca-k">Contexto</span><div class="ca-chips">${chips.map(c => `<span class="ca-chip" title="${esc(c.hint)}">${esc(c.label)}</span>`).join('')}</div></section>` : ''}
    </div>`;
    const blocksHost = host.querySelector('[data-ca-blocks]');
    if (blocksHost && window.RunflowSessionBlocks) {
      const base = `/api/coach/athletes/${encodeURIComponent(athleteId)}/activities/${encodeURIComponent(activityId)}`;
      try { window.RunflowSessionBlocks.render(blocksHost, detail, { mode: 'athlete', comparisonUrl: `${base}/block-comparison` }); } catch (error) { blocksHost.remove(); }
      if (blocksHost.hidden || !blocksHost.innerHTML.trim()) blocksHost.outerHTML = chart(activity);
    }
    return { effect };
  }

  async function load(host, { athleteId, activityId, log }) {
    host.innerHTML = '<div class="ca"><p class="ca-mut">Cargando el análisis de la actividad desde Intervals…</p></div>';
    try {
      const response = await fetch(`/api/coach/athletes/${encodeURIComponent(athleteId)}/activities/${encodeURIComponent(activityId)}`, { credentials: 'same-origin' });
      const detail = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(detail.error || 'No se pudo cargar la actividad.');
      return render(host, detail, { athleteId, activityId, log });
    } catch (error) {
      host.innerHTML = `<div class="ca"><p class="ca-mut">No se pudo cargar el análisis: ${esc(error.message)}</p></div>`;
      return null;
    }
  }

  window.RunflowCoachActivity = { render, load };
})();
