(() => {
  'use strict';

  const q = (s, r = document) => r.querySelector(s);
  const athleteId = () => q('#athleteSelect')?.value || q('#v8AthleteSelect')?.value || '';
  const apiCall = async (url, opt = {}) => {
    if (typeof api === 'function') return api(url, opt);
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...opt,
      headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
    return data;
  };

  const notify = (text, type = 'success') => {
    try { showMessage(text, type); }
    catch { window.alert(text); }
  };

  const norm = value => String(value || '').trim().toLowerCase();
  const caseId = pkg => String(pkg?.case_id || pkg?.source?.case_id || pkg?.generated_at || '')
    .replace(/[^a-zA-Z0-9_.:-]/g, '-')
    .slice(0, 120);

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return Boolean(aStart && aEnd && bStart && bEnd && aStart <= bEnd && bStart <= aEnd);
  }

  function conflictReason(season, pkg) {
    const cid = caseId(pkg);
    const notes = String(season?.notes || '');
    if (cid && notes.includes(`Case ID: ${cid}`)) return 'mismo caso importado';
    if (norm(season?.name) && norm(season?.name) === norm(pkg?.season?.name)) return 'mismo nombre de temporada';
    if (season?.start_date === pkg?.season?.start_date && season?.end_date === pkg?.season?.end_date) return 'mismas fechas';
    if (overlaps(season?.start_date, season?.end_date, pkg?.season?.start_date, pkg?.season?.end_date)) return 'fechas solapadas';
    return '';
  }

  async function listConflicts(pkg) {
    const id = athleteId();
    if (!id) throw new Error('Selecciona un deportista.');
    const data = await apiCall(`/api/coach/athletes/${encodeURIComponent(id)}/seasons`);
    return (data.seasons || [])
      .map(season => ({ season, reason: conflictReason(season, pkg) }))
      .filter(item => item.reason);
  }

  async function deleteSeason(season) {
    const id = athleteId();
    return apiCall(`/api/coach/athletes/${encodeURIComponent(id)}/seasons/${encodeURIComponent(season.id)}`, {
      method: 'DELETE',
    });
  }

  function conflictText(conflicts, pkg) {
    const rows = conflicts.map(({ season, reason }) =>
      `• ${season.name || 'Temporada'} (${season.start_date || '—'} → ${season.end_date || '—'}) · ${reason}`
    ).join('\n');
    return `RunFlow ha detectado planificación existente que entra en conflicto con «${pkg?.season?.name || 'la temporada importada'}»:\n\n${rows}\n\nSi continúas, se eliminará la PLANIFICACIÓN de esas temporadas y después se importará el archivo nuevo.\n\nLas actividades ya realizadas, su carga, feedback e histórico deportivo se conservarán.`;
  }

  async function prepareOverwrite(input, file) {
    let pkg;
    try {
      pkg = JSON.parse(await file.text());
    } catch {
      return { proceed: true };
    }
    if (pkg?.schema !== 'runflow.plan.v2' || !pkg?.season) return { proceed: true };

    const conflicts = await listConflicts(pkg);
    if (!conflicts.length) return { proceed: true };

    if (!window.confirm(`${conflictText(conflicts, pkg)}\n\n¿Quieres sobrescribir esta planificación?`)) {
      return { proceed: false };
    }
    const confirmation = window.prompt('Para confirmar, escribe SOBREESCRIBIR.', '');
    if (String(confirmation || '').trim().toUpperCase() !== 'SOBREESCRIBIR') {
      notify('Sobrescritura cancelada. No se ha modificado ninguna temporada.', 'error');
      return { proceed: false };
    }

    input.disabled = true;
    notify('Eliminando la planificación anterior y conservando el histórico realizado…');
    try {
      for (const { season } of conflicts) {
        await deleteSeason(season);
        try { localStorage.removeItem(`runflow_plan_season_${athleteId()}`); } catch {}
      }
      notify('Planificación anterior eliminada. Continuando con la importación…', 'success');
      return { proceed: true, overwritten: conflicts.length };
    } finally {
      input.disabled = false;
    }
  }

  // Capture the file before the V2 importer sees it. If there is a conflict,
  // the old season is safely removed first; then we replay the change event so
  // the existing, validated importer continues unchanged.
  document.addEventListener('change', async event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.id !== 'v9PlanV2File') return;
    if (input.dataset.runflowOverwriteReady === '1') return;
    const file = input.files?.[0];
    if (!file) return;

    event.stopImmediatePropagation();
    try {
      const result = await prepareOverwrite(input, file);
      if (!result.proceed) {
        input.value = '';
        return;
      }
      input.dataset.runflowOverwriteReady = '1';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      delete input.dataset.runflowOverwriteReady;
    } catch (error) {
      input.value = '';
      notify(`No se pudo preparar la sobrescritura: ${error.message}`, 'error');
    }
  }, true);

  // Extra fallback for the season delete button. The original delete UI relies
  // on state.plan; this fallback uses the actual selected season from the UI.
  async function removeSelectedSeason() {
    const select = q('#planSeasonSelect');
    const id = athleteId();
    const seasonId = select?.value || '';
    if (!id || !seasonId) return;
    const name = select?.selectedOptions?.[0]?.textContent?.trim() || 'temporada seleccionada';
    if (!window.confirm(`¿Eliminar «${name}»?\n\nSe eliminará su planificación completa. Las actividades realizadas y el histórico deportivo se conservarán.`)) return;
    const confirmation = window.prompt('Para confirmar el borrado, escribe ELIMINAR.', '');
    if (String(confirmation || '').trim().toUpperCase() !== 'ELIMINAR') return;

    const button = q('#runflowDeleteSelectedSeason');
    if (button) button.disabled = true;
    try {
      await apiCall(`/api/coach/athletes/${encodeURIComponent(id)}/seasons/${encodeURIComponent(seasonId)}`, { method: 'DELETE' });
      localStorage.removeItem(`runflow_plan_season_${id}`);
      notify('Temporada eliminada. El histórico realizado se conserva.', 'success');
      if (typeof loadPlan === 'function') await loadPlan(null);
      else window.location.reload();
    } catch (error) {
      notify(error.message, 'error');
      if (button) button.disabled = false;
    }
  }

  function installDeleteFallback() {
    const edit = q('#editSeason');
    if (!edit || q('#runflowDeleteSelectedSeason') || q('[data-v8-season-remove]')) return;
    const button = document.createElement('button');
    button.id = 'runflowDeleteSelectedSeason';
    button.type = 'button';
    button.className = 'btn danger small v8-remove-btn';
    button.textContent = 'Eliminar temporada';
    button.addEventListener('click', removeSelectedSeason);
    edit.parentElement?.appendChild(button);
  }

  new MutationObserver(installDeleteFallback).observe(document.documentElement, { subtree: true, childList: true });
  document.addEventListener('DOMContentLoaded', installDeleteFallback, { once: true });
  setTimeout(installDeleteFallback, 800);
})();
