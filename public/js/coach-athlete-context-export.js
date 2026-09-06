(() => {
  'use strict';
  const q = selector => document.querySelector(selector);
  const athleteId = () => q('#athleteSelect')?.value || '';
  const apiCall = async url => {
    if (typeof api === 'function') return api(url);
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo preparar el contexto del deportista.');
    return data;
  };
  const isoDaysAgo = days => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const safeName = value => String(value || 'deportista').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  const compactActivity = row => ({
    activity_date: row.activity_date,
    sport: row.sport,
    name: row.name,
    duration_min: row.duration_sec == null ? null : Math.round(Number(row.duration_sec) / 60),
    distance_km: row.distance_m == null ? null : Math.round(Number(row.distance_m) / 100) / 10,
    elevation_m: row.elevation_gain_m ?? null,
    load: row.load ?? null,
    avg_hr: row.avg_hr ?? null,
    max_hr: row.max_hr ?? null,
    avg_pace_sec_per_km: row.avg_pace_sec_per_km ?? null,
    rpe: row.rpe ?? null,
  });
  const compactRecovery = row => ({
    date: row.metric_date || row.date,
    readiness_score: row.readiness_score ?? null,
    sleep_hours: row.sleep_hours ?? null,
    resting_hr: row.resting_hr ?? null,
    hrv: row.hrv ?? null,
    soreness: row.soreness ?? null,
    fatigue: row.fatigue ?? null,
  });
  function profileForPlanning(athlete, dynamic) {
    const profile = athlete.profile || {};
    return {
      display_name: athlete.display_name,
      birth_date: profile.birth_date || null,
      sex: profile.sex || null,
      weight_kg: profile.weight_kg ?? null,
      height_cm: profile.height_cm ?? null,
      level: profile.level || null,
      experience_years: profile.experience_years ?? null,
      current_weekly_sessions: profile.weekly_sessions ?? null,
      current_weekly_km: profile.weekly_km ?? null,
      current_weekly_hours: profile.weekly_hours ?? null,
      watch: [profile.watch_brand, profile.watch_model].filter(Boolean).join(' ') || null,
      general_objective: profile.objective || null,
      injury_history: profile.injury_history || null,
      current_issues: profile.current_issues || null,
      family_or_work_restrictions: profile.restrictions || null,
      availability_notes: profile.availability_notes || profile.availability_text || null,
      coach_notes: profile.coach_notes || null,
      availability: dynamic.availability || profile.availability || {},
      strength_mode: dynamic.strength_mode || dynamic.availability?.strength_mode || 'runflow',
      external_strength_days: dynamic.external_strength_days || [],
      load_tolerance: profile.load_tolerance_profile || dynamic.load_tolerance_profile || {},
      current_max_load: dynamic.max_load ?? null,
    };
  }
  async function buildContext() {
    const id = athleteId();
    if (!id) throw new Error('Selecciona primero un deportista.');
    const oldestActivities = isoDaysAgo(180), oldestRecovery = isoDaysAgo(90), newest = today();
    const [athleteData, dynamic, seasonsData, activitiesData, recoveryData, performance] = await Promise.all([
      apiCall(`/api/coach/athletes/${encodeURIComponent(id)}`),
      apiCall(`/api/v9/coach/athletes/${encodeURIComponent(id)}/dynamic-profile`),
      apiCall(`/api/coach/athletes/${encodeURIComponent(id)}/seasons`),
      apiCall(`/api/coach/athletes/${encodeURIComponent(id)}/activities?oldest=${oldestActivities}&newest=${newest}`),
      apiCall(`/api/coach/athletes/${encodeURIComponent(id)}/recovery?oldest=${oldestRecovery}&newest=${newest}`),
      apiCall(`/api/coach/athletes/${encodeURIComponent(id)}/performance?days=180`),
    ]);
    const athlete = athleteData.athlete || {};
    const seasons = seasonsData.seasons || [];
    const plans = [];
    for (const season of seasons) {
      try { plans.push(await apiCall(`/api/coach/athletes/${encodeURIComponent(id)}/plan?season_id=${encodeURIComponent(season.id)}`)); }
      catch (error) { plans.push({ season: { id: season.id, name: season.name }, error: error.message }); }
    }
    return {
      schema: 'runflow.athlete-planning-context.v1',
      generated_at: new Date().toISOString(),
      purpose: 'Contexto completo para diseñar una temporada RunFlow antes de importarla.',
      mandatory_planning_rules: [
        'La disponibilidad semanal es una restricción obligatoria, no una preferencia.',
        'No programar una actividad distinta de activity_type en ese día.',
        'No superar max_minutes.',
        'Los días unavailable o can_train=false no admiten sesiones.',
        'Las sesiones de fuerza deben incluir video_url HTTPS en cada ejercicio.',
        'Las sesiones de running y trail deben contener bloques estructurados compatibles con Intervals.',
        'Toda la temporada se importará en borrador; solo el coach publicará cada semana.',
      ],
      athlete: profileForPlanning(athlete, dynamic),
      training_zones: athlete.zones || { hr: [], pace: [] },
      active_goals: athlete.goals || [],
      seasons_and_plans: plans,
      current_metrics: athlete.metrics || null,
      performance_context: performance || null,
      recent_activities: (activitiesData.activities || []).map(compactActivity),
      recent_recovery: (recoveryData.rows || []).map(compactRecovery),
      excluded_for_privacy_and_security: ['email de acceso', 'teléfono', 'user_id', 'claves de Intervals', 'cookies y credenciales'],
    };
  }
  function downloadJson(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `RunFlow_contexto_${safeName(data.athlete?.display_name)}_${today()}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportContext() {
    const button = q('#exportAthleteContext');
    const original = button?.textContent;
    try {
      if (button) { button.disabled = true; button.textContent = 'Preparando contexto…'; }
      downloadJson(await buildContext());
      if (typeof showMessage === 'function') showMessage('Contexto del deportista descargado. Súbelo al chat antes de diseñar la temporada.', 'success');
    } catch (error) {
      if (typeof showMessage === 'function') showMessage(error.message, 'error'); else alert(error.message);
    } finally {
      if (button) { button.disabled = false; button.textContent = original; }
    }
  }
  function install() {
    if (q('#exportAthleteContext')) return;
    const save = q('#saveProfile');
    if (!save) return setTimeout(install, 100);
    const button = document.createElement('button');
    button.id = 'exportAthleteContext';
    button.className = 'btn secondary';
    button.type = 'button';
    button.textContent = 'Descargar contexto para planificar';
    button.addEventListener('click', exportContext);
    save.insertAdjacentElement('afterend', button);
  }
  install();
})();
