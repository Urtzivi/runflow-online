/* RunFlow · Análisis de sesión por bloques (Coach y app del atleta).
 * Dibuja ritmo y FC en el tiempo con cada serie marcada, su objetivo, el detalle de cada
 * serie, la tabla de series y la lectura de la sesión. Usa `block_analysis` y los streams
 * que ya devuelve el detalle de la actividad.
 * API: RunflowSessionBlocks.render(host, detail, { mode: 'coach'|'athlete', comparisonUrl })
 *      RunflowSessionBlocks.open({ athleteId, activityId, title }) → diálogo del Coach. */
(function () {
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = value => { const n = Number(value); return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : n; };
  const fmtPace = sec => { const v = num(sec); if (!v || v <= 0) return '—'; const r = Math.round(v); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };
  const fmtTime = sec => { const v = Math.max(0, Math.round(num(sec) || 0)); const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), s = v % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
  const fmtInt = value => { const v = num(value); return v === null ? '—' : String(Math.round(v)); };
  const signed = (value, unit) => { const v = num(value); if (v === null) return '—'; const r = Math.round(v); return `${r > 0 ? '+' : ''}${r}${unit}`; };
  const STATUS = { good: '✓ En objetivo', warn: '! Fuera por poco', bad: '✕ Fuera' };
  const SHORT = { good: '✓', warn: '!', bad: '✕' };

  function stream(streams, type) {
    const row = (Array.isArray(streams) ? streams : []).find(item => String(item && item.type || '').toLowerCase() === type);
    return row && Array.isArray(row.data) ? row.data : [];
  }

  function percentile(values, p) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
  }

  // Serie de puntos suavizada (ventana 15 s) y reducida a ~600 puntos para el SVG.
  function samples(detail) {
    const streams = detail.activity && detail.activity.streams;
    const time = stream(streams, 'time');
    if (time.length < 30) return [];
    const hr = stream(streams, 'heartrate');
    let speed = stream(streams, 'velocity_smooth');
    const distance = stream(streams, 'distance');
    if (!speed.length && distance.length) speed = distance.map((d, i) => i ? (Number(d) - Number(distance[i - 1])) / Math.max(1, Number(time[i]) - Number(time[i - 1])) : 0);
    const origin = Number(time[0]) || 0;
    const step = Math.max(1, Math.floor(time.length / 600));
    const out = [];
    for (let i = 0; i < time.length; i += step) {
      const t = Number(time[i]) - origin;
      let sSum = 0, sN = 0, hSum = 0, hN = 0;
      for (let j = i; j >= 0 && t - (Number(time[j]) - origin) <= 7; j -= 1) { const s = num(speed[j]); if (s !== null) { sSum += s; sN += 1; } const h = num(hr[j]); if (h && h > 30) { hSum += h; hN += 1; } }
      for (let j = i + 1; j < time.length && (Number(time[j]) - origin) - t <= 7; j += 1) { const s = num(speed[j]); if (s !== null) { sSum += s; sN += 1; } const h = num(hr[j]); if (h && h > 30) { hSum += h; hN += 1; } }
      const v = sN ? sSum / sN : null;
      out.push({ t, pace: v && v > 0.8 ? 1000 / v : null, hr: hN ? hSum / hN : null });
    }
    return out;
  }

  function blockLabel(block) {
    if (block.main_work) return `Serie ${block.repetition}`;
    if (block.phase === 'warmup') return 'Calentamiento';
    if (block.phase === 'cooldown') return 'Vuelta a la calma';
    if (block.kind === 'recovery') return 'Recuperación';
    return block.label || 'Bloque';
  }

  function targetText(target) {
    if (!target) return '—';
    const parts = [];
    if (target.pace) parts.push(`${fmtPace(target.pace.min)}–${fmtPace(target.pace.max)}`);
    if (target.hr) parts.push(`${target.hr.min}–${target.hr.max} ppm`);
    return parts.length ? parts.join(' · ') : target.text || '—';
  }

  // ---------- Gráfico ----------
  function drawChart(host, ctx, metric, height, compact) {
    const { points, blocks, total, selected } = ctx;
    const W = Math.max(260, host.clientWidth || 600), H = height;
    const padL = compact ? 34 : 44, padR = 10, padT = compact ? 6 : 18, padB = compact ? 18 : 22;
    const isPace = metric === 'pace';
    const work = blocks.filter(b => b.main_work);
    let lo, hi;
    if (isPace) {
      const all = points.map(p => p.pace).filter(Number.isFinite);
      const workPaces = points.filter(p => work.some(b => p.t >= b.start_second && p.t < b.end_second)).map(p => p.pace).filter(Number.isFinite);
      const targets = work.map(b => b.target && b.target.pace && b.target.pace.min).filter(Number.isFinite);
      lo = Math.floor((Math.min(percentile(workPaces.length ? workPaces : all, 0.03) || 240, ...targets) - 10) / 15) * 15;
      hi = Math.min(lo + 300, Math.ceil(((percentile(all, 0.97) || 360) + 10) / 15) * 15);
    } else {
      const all = points.map(p => p.hr).filter(Number.isFinite);
      lo = Math.floor(((percentile(all, 0.02) || 100) - 5) / 10) * 10;
      hi = Math.ceil(((Math.max(...all, ...work.map(b => b.target && b.target.hr ? b.target.hr.max : 0)) || 180) + 5) / 10) * 10;
    }
    if (!(hi > lo)) hi = lo + 60;
    const x = t => padL + (t / total) * (W - padL - padR);
    const y = v => isPace ? padT + ((v - lo) / (hi - lo)) * (H - padT - padB) : padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const clampY = v => y(Math.max(lo, Math.min(hi, v)));
    let g = '';
    blocks.forEach((b, i) => {
      const x0 = x(b.start_second), x1 = x(b.end_second), w = Math.max(1, x1 - x0 - 2);
      if (b.kind === 'transition' || b.phase === 'warmup' || b.phase === 'cooldown') { g += `<rect x="${x0}" y="${padT}" width="${Math.max(1, x1 - x0)}" height="${H - padT - padB}" class="sb-wu"/>`; return; }
      const sel = i === selected;
      const cls = b.kind === 'work' ? (sel ? 'sb-work sb-sel' : 'sb-work') : 'sb-rec';
      g += `<rect data-block="${i}" x="${x0 + 1}" y="${padT}" width="${w}" height="${H - padT - padB}" rx="3" class="${cls}"/>`;
      const range = b.main_work && b.target ? (isPace ? b.target.pace : b.target.hr) : null;
      if (range) g += `<rect x="${x0 + 1}" y="${Math.min(clampY(range.min), clampY(range.max))}" width="${w}" height="${Math.max(2, Math.abs(clampY(range.min) - clampY(range.max)))}" class="sb-target" pointer-events="none"/>`;
      if (!compact && isPace && b.main_work && w > 14) g += `<text x="${(x0 + x1) / 2}" y="${padT - 5}" text-anchor="middle" class="sb-blabel${sel ? ' on' : ''}">S${b.repetition}</text>`;
    });
    const tickStep = isPace ? (hi - lo > 180 ? 60 : 30) : 20;
    for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi; v += tickStep) g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="sb-grid"/><text x="${padL - 6}" y="${y(v) + 3}" text-anchor="end" class="sb-tick">${isPace ? fmtPace(v) : v}</text>`;
    const minutes = total / 60, xStep = minutes > 150 ? 30 : minutes > 70 || compact ? 20 : 10;
    for (let m = 0; m <= minutes; m += xStep) g += `<text x="${x(m * 60)}" y="${H - 5}" text-anchor="middle" class="sb-tick">${m}′</text>`;
    let path = '', open = false;
    points.forEach(p => { const v = isPace ? p.pace : p.hr; if (!Number.isFinite(v)) { open = false; return; } path += `${open ? 'L' : 'M'}${x(p.t).toFixed(1)},${clampY(v).toFixed(1)}`; open = true; });
    g += `<path d="${path}" class="${isPace ? 'sb-line-pace' : 'sb-line-hr'}"/>`;
    g += `<line class="sb-xh" x1="0" x2="0" y1="${padT}" y2="${H - padB}"/>`;
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${isPace ? 'Ritmo' : 'Frecuencia cardiaca'} durante la sesión">${g}</svg>`;
    host._scale = { x, padL, padR, W };
  }

  function bindCharts(root, ctx, onSelect) {
    const hosts = [...root.querySelectorAll('[data-sb-chart]')];
    const tip = root.querySelector('.sb-tip');
    hosts.forEach(host => {
      const svg = host.querySelector('svg'); if (!svg) return;
      svg.addEventListener('mousemove', event => {
        const rect = svg.getBoundingClientRect(), { padL, padR, W } = host._scale;
        const t = Math.max(0, Math.min(ctx.total, ((event.clientX - rect.left) - padL) / (W - padL - padR) * ctx.total));
        const point = ctx.points.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a, ctx.points[0]);
        const block = ctx.blocks.find(b => point.t >= b.start_second && point.t < b.end_second);
        hosts.forEach(h => { const line = h.querySelector('.sb-xh'); if (line) { const px = h._scale.x(point.t); line.setAttribute('x1', px); line.setAttribute('x2', px); line.style.opacity = '.45'; } });
        if (!tip) return;
        const box = root.getBoundingClientRect();
        tip.innerHTML = `<b>${esc(block ? blockLabel(block) : 'Sesión')}</b><br>${fmtTime(point.t)} · ${fmtPace(point.pace)} /km · ${fmtInt(point.hr)} ppm`;
        tip.style.display = 'block';
        let left = event.clientX - box.left + 14; if (left > box.width - 190) left -= 210;
        tip.style.left = `${left}px`; tip.style.top = `${event.clientY - box.top - 12}px`;
      });
      svg.addEventListener('mouseleave', () => { if (tip) tip.style.display = 'none'; hosts.forEach(h => { const line = h.querySelector('.sb-xh'); if (line) line.style.opacity = '0'; }); });
      svg.addEventListener('click', event => { const rect = event.target.closest('[data-block]'); if (rect && ctx.blocks[Number(rect.dataset.block)].kind === 'work') onSelect(Number(rect.dataset.block)); });
    });
  }

  // ---------- Piezas de la vista ----------
  function kpis(summary) {
    if (!summary) return '';
    const items = [
      ['Series en objetivo', summary.with_target ? `${summary.in_target}<small>/${summary.with_target}</small>` : `${summary.work_count}<small> series</small>`, summary.with_target ? 'Ritmo y FC frente al objetivo' : 'Sin objetivo comparable'],
      ['Ritmo medio series', `${fmtPace(summary.avg_work_pace_sec_per_km)}<small>/km</small>`, 'Media de las series'],
      ['FC media series', `${fmtInt(summary.avg_work_hr)}<small> ppm</small>`, 'Media de las series'],
      ['FC 1.ª → última', summary.hr_rise === null ? '—' : `${signed(summary.hr_rise, '')}<small> ppm</small>`, summary.pace_change_sec_per_km === null ? '' : `Ritmo ${signed(summary.pace_change_sec_per_km, ' s/km')}`],
      ['Recuperación', summary.avg_recovery_hr_drop === null ? '—' : `−${fmtInt(summary.avg_recovery_hr_drop)}<small> ppm</small>`, 'Bajada media de FC'],
    ];
    return `<div class="sb-kpis">${items.map(([label, value, note]) => `<div class="sb-kpi"><span>${label}</span><b>${value}</b><small>${esc(note)}</small></div>`).join('')}</div>`;
  }

  function detailCard(ctx) {
    const b = ctx.blocks[ctx.selected];
    if (!b) return '<p class="sb-muted">Toca una serie para ver su detalle.</p>';
    const works = ctx.blocks.filter(x => x.main_work);
    const prev = b.main_work ? works[works.indexOf(b) - 1] : null;
    const next = ctx.blocks[ctx.selected + 1];
    const tp = b.target && b.target.pace;
    const paceNote = tp && num(b.pace_sec_per_km) ? (b.pace_sec_per_km < tp.min ? `${Math.round(tp.min - b.pace_sec_per_km)} s/km más rápido que el objetivo` : b.pace_sec_per_km > tp.max ? `${Math.round(b.pace_sec_per_km - tp.max)} s/km más lento que el objetivo` : 'Dentro del objetivo') : (b.planned_target ? `Objetivo: ${b.planned_target}` : 'Sin objetivo de ritmo');
    const halves = num(b.first_half_pace_sec_per_km) && num(b.second_half_pace_sec_per_km) ? b.second_half_pace_sec_per_km - b.first_half_pace_sec_per_km : null;
    const facts = [
      ['Ritmo', `${fmtPace(b.pace_sec_per_km)} /km`, paceNote],
      ['FC media', `${fmtInt(b.average_hr)} ppm`, b.target && b.target.hr ? `Objetivo ${b.target.hr.min}–${b.target.hr.max}` : ''],
      ['FC máxima', `${fmtInt(b.max_hr)} ppm`, b.target && b.target.hr && num(b.max_hr) ? (b.max_hr > b.target.hr.max ? 'Pasa la zona' : 'Dentro de zona') : ''],
      ['1.ª / 2.ª mitad', halves === null ? '—' : `${fmtPace(b.first_half_pace_sec_per_km)} · ${fmtPace(b.second_half_pace_sec_per_km)}`, halves === null ? '' : halves > 4 ? 'Se cae al final' : halves < -3 ? 'Acelera al final' : 'Ritmo regular'],
      ['FC inicio → final', num(b.start_hr) && num(b.end_hr) ? `${fmtInt(b.start_hr)} → ${fmtInt(b.end_hr)}` : '—', num(b.hr_change) !== null ? `${signed(b.hr_change, ' ppm')} dentro de la serie` : ''],
      ['Cadencia', num(b.average_cadence) ? `${fmtInt(b.average_cadence)}` : '—', num(b.average_cadence) ? 'pasos por minuto' : ''],
    ];
    const extra = [];
    if (next && next.kind === 'recovery' && num(next.hr_drop) !== null) extra.push(`<b>Recuperación siguiente:</b> la FC baja de ${fmtInt(b.end_hr)} a ${fmtInt(next.end_hr)} ppm en ${fmtTime(next.duration_seconds)} (−${fmtInt(next.hr_drop)}).`);
    if (prev && num(prev.pace_sec_per_km) && num(b.pace_sec_per_km)) extra.push(`Frente a la serie anterior: ${signed(b.pace_sec_per_km - prev.pace_sec_per_km, ' s/km')} y ${signed((b.average_hr || 0) - (prev.average_hr || 0), ' ppm')}.`);
    return `<div class="sb-detail-top"><h4>${esc(blockLabel(b))}</h4>${b.status ? `<span class="sb-pill ${b.status}">${STATUS[b.status]}</span>` : ''}<span class="sb-muted sb-right">${fmtTime(b.duration_seconds)}${num(b.distance_m) ? ` · ${fmtInt(b.distance_m)} m` : ''}</span></div>
      <div class="sb-facts">${facts.map(([label, value, note]) => `<div class="sb-fact"><span>${label}</span><b>${value}</b><small>${esc(note)}</small></div>`).join('')}</div>
      ${extra.length ? `<div class="sb-note">${extra.join(' ')}</div>` : ''}`;
  }

  function readingList(reading) {
    if (!reading || !reading.length) return '<p class="sb-muted">Sin datos suficientes para leer la sesión por bloques.</p>';
    const icon = { good: '✓', warn: '!', bad: '✕', info: 'i' };
    return `<ul class="sb-reading">${reading.map(item => `<li><span class="sb-ic ${esc(item.level)}">${icon[item.level] || 'i'}</span><span><b>${esc(item.title)}.</b> ${esc(item.text)}</span></li>`).join('')}</ul>`;
  }

  function segmentationNote(analysis) {
    if (analysis.segmentation === 'intervals') return 'Cortes de los bloques: series detectadas por Intervals.icu (vuelta o cambio de ritmo).';
    if (analysis.segmentation === 'plan') return 'Cortes de los bloques: duraciones de la sesión planificada, porque Intervals no detectó las series. Si el calentamiento duró más o menos de lo previsto, los bloques pueden estar desplazados.';
    if (analysis.segmentation === 'intervals_summary') return 'Datos por parcial de Intervals.icu. No hay datos segundo a segundo para dibujar el gráfico.';
    return '';
  }

  function seriesTable(ctx) {
    const rows = [];
    const works = ctx.blocks.filter(b => b.main_work);
    ctx.blocks.forEach((b, i) => {
      if (b.main_work) {
        const prev = works[works.indexOf(b) - 1];
        const dP = prev && num(prev.pace_sec_per_km) && num(b.pace_sec_per_km) ? b.pace_sec_per_km - prev.pace_sec_per_km : null;
        const dH = prev && num(prev.average_hr) && num(b.average_hr) ? b.average_hr - prev.average_hr : null;
        rows.push(`<tr data-row="${i}" class="${i === ctx.selected ? 'sel' : ''}"><td class="sb-n">S${b.repetition} · ${fmtTime(b.duration_seconds)}</td><td>${esc(targetText(b.target) === '—' ? (b.planned_target || '—') : targetText(b.target))}</td><td><b>${fmtPace(b.pace_sec_per_km)}</b></td><td>${fmtInt(b.average_hr)}</td><td>${fmtInt(b.max_hr)}</td><td>${fmtInt(b.end_hr)}</td><td>${num(b.first_half_pace_sec_per_km) ? `${fmtPace(b.first_half_pace_sec_per_km)} / ${fmtPace(b.second_half_pace_sec_per_km)}` : '—'}</td><td>${dP === null ? '—' : `<span class="${dP > 0 ? 'sb-up' : dP < 0 ? 'sb-dn' : ''}">${signed(dP, ' s/km')}</span> · <span class="${dH > 2 ? 'sb-up' : ''}">${signed(dH, ' ppm')}</span>`}</td><td>${b.status ? `<span class="sb-pill ${b.status}">${STATUS[b.status]}</span>` : '—'}</td></tr>`);
      } else if (b.kind === 'recovery' && works.length) {
        rows.push(`<tr class="sb-recrow"><td>↳ Recuperación ${fmtTime(b.duration_seconds)}</td><td>${esc(b.planned_target || '')}</td><td colspan="7">${num(b.hr_drop) !== null ? `La FC baja de ${fmtInt(b.hr_from)} a ${fmtInt(b.end_hr)} ppm (−${fmtInt(b.hr_drop)})` : `${fmtPace(b.pace_sec_per_km)} /km · ${fmtInt(b.average_hr)} ppm`}</td></tr>`);
      }
    });
    if (!works.length) return '';
    return `<div class="sb-scroll"><table class="sb-table"><thead><tr><th>Serie</th><th>Objetivo</th><th>Ritmo</th><th>FC media</th><th>FC máx.</th><th>FC final</th><th>1.ª / 2.ª mitad</th><th>Δ vs anterior</th><th>Estado</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function athleteReps(ctx) {
    const works = ctx.blocks.filter(b => b.main_work);
    if (!works.length) return '';
    const paces = works.map(b => num(b.pace_sec_per_km)).filter(Boolean);
    const targets = works.flatMap(b => b.target && b.target.pace ? [b.target.pace.min, b.target.pace.max] : []);
    const lo = Math.min(...paces, ...targets) - 8, hi = Math.max(...paces, ...targets) + 8;
    const pos = v => ((v - lo) / (hi - lo)) * 100;
    const recs = ctx.blocks.filter(b => b.kind === 'recovery');
    return works.map(b => {
      const after = ctx.blocks[ctx.blocks.indexOf(b) + 1];
      const rec = after && recs.includes(after) && num(after.end_hr) ? ` · recuperas a ${fmtInt(after.end_hr)}` : '';
      const tp = b.target && b.target.pace;
      return `<div class="sb-rep"><div class="sb-num">${b.repetition}</div><div><b>${fmtPace(b.pace_sec_per_km)} /km</b><small>${fmtInt(b.average_hr)} ppm de media · máx. ${fmtInt(b.max_hr)}${rec}</small>
        ${num(b.pace_sec_per_km) ? `<div class="sb-bar">${tp ? `<i class="sb-band" style="left:${pos(tp.min)}%;width:${pos(tp.max) - pos(tp.min)}%"></i>` : ''}<i class="sb-dot ${b.status || 'none'}" style="left:${pos(b.pace_sec_per_km)}%"></i></div>` : ''}</div>
        ${b.status ? `<span class="sb-pill ${b.status}" title="${STATUS[b.status]}">${SHORT[b.status]}</span>` : '<span></span>'}</div>`;
    }).join('') + (works.some(b => b.target && b.target.pace) ? '<p class="sb-muted">La franja verde es tu ritmo objetivo.</p>' : '');
  }

  async function loadComparison(root, url, mode) {
    const host = root.querySelector('[data-sb-compare]');
    if (!host || !url) return;
    try {
      const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
      const data = await response.json().catch(() => ({}));
      const comparison = response.ok && data.comparison;
      if (!comparison || !comparison.block_comparison || !comparison.block_comparison.length) { host.innerHTML = '<p class="sb-muted">No hay una sesión anterior equivalente para comparar serie a serie.</p>'; return; }
      const rows = comparison.block_comparison;
      const avg = key => rows.map(r => num(r[key])).filter(v => v !== null).reduce((a, b, _, arr) => a + b / arr.length, 0);
      const dPace = avg('pace_change_sec_per_km'), dHr = avg('hr_change');
      const date = esc(comparison.date ? new Date(`${comparison.date}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '');
      const sentence = `Misma sesión el ${date}: ${Math.abs(dPace) < 1 ? 'mismo ritmo' : `${Math.round(Math.abs(dPace))} s/km ${dPace < 0 ? 'más rápido' : 'más lento'}`} de media y ${Math.abs(dHr) < 1 ? 'la misma FC' : `${Math.round(Math.abs(dHr))} ppm ${dHr < 0 ? 'menos' : 'más'}`}.`;
      if (mode === 'athlete') { host.innerHTML = `<p class="sb-text">${sentence}${dPace <= 0 && dHr <= 0 ? ' Vas a mejor.' : ''}</p>`; return; }
      host.innerHTML = `<p class="sb-text"><b>${esc(comparison.title || 'Sesión anterior')}</b> · ${sentence}</p><div class="sb-scroll"><table class="sb-table"><thead><tr><th>Serie</th><th>Ritmo antes</th><th>Ritmo hoy</th><th>Δ</th><th>FC antes</th><th>FC hoy</th><th>Δ</th></tr></thead><tbody>${rows.map(r => `<tr><td class="sb-n">S${esc(r.repetition)}</td><td>${fmtPace(r.previous_pace_sec_per_km)}</td><td><b>${fmtPace(r.current_pace_sec_per_km)}</b></td><td class="${r.pace_change_sec_per_km < 0 ? 'sb-dn' : r.pace_change_sec_per_km > 0 ? 'sb-up' : ''}">${signed(r.pace_change_sec_per_km, ' s')}</td><td>${fmtInt(r.previous_avg_hr)}</td><td><b>${fmtInt(r.current_avg_hr)}</b></td><td class="${r.hr_change < 0 ? 'sb-dn' : r.hr_change > 0 ? 'sb-up' : ''}">${signed(r.hr_change, '')}</td></tr>`).join('')}</tbody></table></div>`;
    } catch { host.innerHTML = '<p class="sb-muted">No se pudo cargar la comparación.</p>'; }
  }

  // Dibuja cuando el contenedor ya tiene ancho (p. ej. dentro de un modal que se está abriendo)
  // y vuelve a dibujar si cambia de tamaño.
  function watchWidth(host, paint) {
    if (host._sbObserver) host._sbObserver.disconnect();
    let width = 0;
    const run = () => { const w = host.clientWidth; if (w > 0 && Math.abs(w - width) > 20) { width = w; paint(); } };
    if ('ResizeObserver' in window) { host._sbObserver = new ResizeObserver(run); host._sbObserver.observe(host); }
    if (host.clientWidth > 0) run(); else requestAnimationFrame(() => (host.clientWidth > 0 ? run() : paint()));
  }

  // ---------- Render principal ----------
  function render(host, detail, options = {}) {
    if (!host) return;
    const analysis = detail && detail.block_analysis;
    const blocks = analysis && Array.isArray(analysis.blocks) ? analysis.blocks : [];
    const works = blocks.filter(b => b.main_work);
    if (!works.length) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    const mode = options.mode === 'athlete' ? 'athlete' : 'coach';
    const points = ['intervals', 'plan'].includes(analysis.segmentation) ? samples(detail) : [];
    const timed = blocks.every(b => Number.isFinite(Number(b.start_second)) && Number.isFinite(Number(b.end_second)));
    const total = points.length ? Math.max(points[points.length - 1].t, ...blocks.map(b => Number(b.end_second) || 0)) : 0;
    const flagged = works.find(b => b.status === 'bad') || works.find(b => b.status === 'warn') || works[0];
    const ctx = { points, blocks, total, selected: blocks.indexOf(flagged) };
    const hasChart = points.length && timed && total > 0;
    const charts = hasChart ? `<div class="sb-chart-label">Ritmo <span>min/km · más arriba es más rápido</span></div><div class="sb-chart" data-sb-chart="pace"></div><div class="sb-chart-label">Frecuencia cardiaca <span>ppm</span></div><div class="sb-chart" data-sb-chart="hr"></div>` : '';
    const legend = '<div class="sb-legend"><span><i class="w"></i>Serie</span><span><i class="r"></i>Recuperación</span><span><i class="t"></i>Objetivo</span></div>';
    const note = segmentationNote(analysis);

    if (mode === 'athlete') {
      const s = analysis.summary || {};
      const verdictLevel = s.with_target ? (s.in_target === s.with_target ? 'good' : s.in_target >= s.with_target / 2 ? 'warn' : 'bad') : 'info';
      const lead = (analysis.reading || []).slice(1, 2).map(item => item.text).join(' ');
      host.innerHTML = `<div class="sb sb-athlete">
        <div class="sb-verdict"><div class="sb-big ${verdictLevel}">${s.with_target ? `${s.in_target}/${s.with_target}` : s.work_count}</div><div><b>${s.with_target ? 'Series en objetivo' : 'Series realizadas'}</b><p>${esc(lead || (analysis.reading && analysis.reading[0] ? analysis.reading[0].text : ''))}</p></div></div>
        ${hasChart ? `<h4>Tu sesión</h4>${charts}` : ''}
        <h4>Tus series</h4>${athleteReps(ctx)}
        ${options.comparisonUrl ? '<h4>Comparado con la última sesión igual</h4><div data-sb-compare><p class="sb-muted">Buscando la última sesión igual…</p></div>' : ''}
        <div class="sb-tip"></div></div>`;
      if (hasChart) watchWidth(host, () => { drawChart(host.querySelector('[data-sb-chart="pace"]'), ctx, 'pace', 120, true); drawChart(host.querySelector('[data-sb-chart="hr"]'), ctx, 'hr', 105, true); bindCharts(host, ctx, () => {}); });
      loadComparison(host, options.comparisonUrl, mode);
      return;
    }

    host.innerHTML = `<div class="sb sb-coach">
      ${kpis(analysis.summary)}
      <section class="sb-card"><div class="sb-head"><div><h3>Sesión bloque a bloque</h3><p class="sb-muted">${hasChart ? 'Toca una serie en el gráfico o en la tabla para ver su detalle' : 'Sin datos segundo a segundo: se muestran los parciales'}</p></div>${hasChart ? legend : ''}</div>${charts}</section>
      <div class="sb-row"><section class="sb-card" data-sb-detail></section><section class="sb-card"><h3>Lectura de la sesión</h3>${readingList(analysis.reading)}${note ? `<div class="sb-note">${esc(note)}</div>` : ''}</section></div>
      <section class="sb-card"><h3>Series</h3><div data-sb-table></div></section>
      ${options.comparisonUrl ? '<section class="sb-card"><h3>Comparación con la última sesión igual</h3><div data-sb-compare><p class="sb-muted">Buscando la última sesión igual…</p></div></section>' : ''}
      <div class="sb-tip"></div></div>`;
    const paint = () => {
      if (hasChart) { drawChart(host.querySelector('[data-sb-chart="pace"]'), ctx, 'pace', 190, false); drawChart(host.querySelector('[data-sb-chart="hr"]'), ctx, 'hr', 160, false); bindCharts(host, ctx, select); }
      host.querySelector('[data-sb-detail]').innerHTML = detailCard(ctx);
      const table = host.querySelector('[data-sb-table]');
      table.innerHTML = seriesTable(ctx);
      table.querySelectorAll('tr[data-row]').forEach(tr => { tr.onclick = () => select(Number(tr.dataset.row)); });
    };
    const select = index => { ctx.selected = index; paint(); };
    watchWidth(host, paint);
    loadComparison(host, options.comparisonUrl, mode);
  }

  // Diálogo del Coach a partir de una actividad de Intervals.
  async function open({ athleteId, activityId, title }) {
    let dialog = document.getElementById('sbDialog');
    if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'sbDialog'; dialog.className = 'sb-dialog'; document.body.appendChild(dialog); }
    dialog.innerHTML = `<div class="sb-dialog-head"><div><span class="sb-eyebrow">Sesión por bloques</span><h2>${esc(title || 'Sesión')}</h2></div><button type="button" class="sb-close" data-close>Cerrar</button></div><div data-sb-body><p class="sb-muted">Cargando la sesión desde Intervals…</p></div>`;
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
    const base = `/api/coach/athletes/${encodeURIComponent(athleteId)}/activities/${encodeURIComponent(activityId)}`;
    try {
      const response = await fetch(base, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
      const detail = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(detail.error || 'No se pudo cargar la sesión.');
      const body = dialog.querySelector('[data-sb-body]');
      render(body, detail, { mode: 'coach', comparisonUrl: `${base}/block-comparison` });
      if (body.hidden) { body.hidden = false; body.innerHTML = '<p class="sb-muted">Esta sesión no tiene series que analizar por bloques.</p>'; }
    } catch (error) {
      dialog.querySelector('[data-sb-body]').innerHTML = `<p class="sb-muted">${esc(error.message)}</p>`;
    }
  }

  window.RunflowSessionBlocks = { render, open };
})();
