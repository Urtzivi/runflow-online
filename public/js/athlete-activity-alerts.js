// RunFlow · aviso de actividad nueva.
// Cuando llega una actividad de Intervals/Garmin (planificada o no) que todavía no está valorada:
//  · en la APK, un proceso en segundo plano (mobile/www/runners/runflow-activity-check.js) avisa con una notificación
//    aunque la app esté cerrada; al tocarla se abre la actividad lista para valorar.
//  · al abrir la app (APK o web) aparece arriba una tarjeta "Valorar" con la última actividad pendiente.
// Este módulo guarda en el proceso de segundo plano el token del deportista de la sesión (tras RunFlowNotificationOwner).
(() => {
  'use strict';

  if (window.__runflowActivityAlertsInstalled) return;
  window.__runflowActivityAlertsInstalled = true;

  const RUNNER_LABEL = 'com.runflow.athlete.activitycheck';
  const TOKEN_KEY = 'runflow_activity_alerts_token';
  const DISMISSED_KEY = 'runflow_activity_alerts_dismissed';
  const OPEN_KEY = 'runflow_activity_alerts_open';
  const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;
  const CHECK_EVERY_MS = 5 * 60 * 1000;
  const BANNER_ID = 'runflowActivityAlert';

  const runner = () => window.Capacitor?.Plugins?.BackgroundRunner || null;
  function isNative() {
    try { return Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.getPlatform?.() !== 'web'); }
    catch { return false; }
  }
  function readJson(key, fallback) {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  function escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  async function getJson(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function currentAthlete() {
    const owner = window.RunFlowNotificationOwner;
    if (owner && !(await owner.ensure())) return '';
    try { return localStorage.getItem('runflow_notifications_athlete') || ''; } catch { return ''; }
  }

  // ── Proceso en segundo plano de la APK ──
  async function configureRunner(seen = []) {
    const BackgroundRunner = runner();
    if (!BackgroundRunner || !isNative()) return;
    const athleteId = await currentAthlete();
    if (!athleteId) return;
    let stored = readJson(TOKEN_KEY, null);
    const fresh = stored && stored.athlete_id === athleteId && Date.parse(stored.expires_at) - Date.now() > RENEW_BEFORE_MS;
    try {
      if (!fresh) {
        stored = await getJson('/api/athlete/activity-alerts/token', { method: 'POST' });
        writeJson(TOKEN_KEY, stored);
      }
      await BackgroundRunner.dispatchEvent({
        label: RUNNER_LABEL,
        event: 'configure',
        details: { token: stored.token, athlete_id: stored.athlete_id, base_url: location.origin, seen },
      });
    } catch (error) {
      console.warn('[RunFlow] aviso de actividad nueva', error);
    }
  }

  // ── Abrir la actividad para valorarla ──
  function athleteAppReady() {
    return typeof window.openActivity === 'function' && document.getElementById('athleteActivityModal');
  }
  async function openForRating(activityId) {
    if (!activityId) return;
    if (!athleteAppReady()) { try { sessionStorage.setItem(OPEN_KEY, activityId); } catch {} return; }
    try { sessionStorage.removeItem(OPEN_KEY); } catch {}
    removeBanner();
    await window.openActivity(activityId);
    const modal = document.getElementById('athleteActivityModal');
    const button = document.getElementById('openActivityLog');
    // Si aún no está valorada se va directo al formulario; si ya lo está se queda en el detalle.
    if (modal && !modal.classList.contains('hidden') && button && /^Valorar/.test(button.textContent || '')) button.click();
  }

  function installTapListener() {
    const BackgroundRunner = runner();
    if (!BackgroundRunner || !isNative()) return;
    try {
      BackgroundRunner.addListener('backgroundRunnerNotificationReceived', event => {
        const match = /^runflow_activity:(.+)$/.exec(String(event?.actionTypeId || ''));
        if (match) setTimeout(() => openForRating(match[1]), 300);
      });
    } catch (error) {
      console.warn('[RunFlow] aviso de actividad nueva · toque', error);
    }
  }

  // ── Tarjeta dentro de la app ──
  function removeBanner() { document.getElementById(BANNER_ID)?.remove(); }
  function dismissed() { return readJson(DISMISSED_KEY, []); }
  function dismiss(id) { writeJson(DISMISSED_KEY, [...dismissed().filter(item => item !== id), id].slice(-60)); }

  function renderBanner(activity, extra) {
    removeBanner();
    const shell = document.querySelector('main.athlete-v2-shell');
    if (!shell || !activity) return;
    const title = activity.planned && activity.planned_title ? activity.planned_title : activity.name;
    const card = document.createElement('div');
    card.id = BANNER_ID;
    card.setAttribute('role', 'status');
    card.style.cssText = 'margin:12px 16px 0;padding:14px 16px;border-radius:16px;background:#fbfbf7;border:1px solid #dfe3dc;box-shadow:0 10px 30px rgba(25,31,27,.08);display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center';
    card.innerHTML = `<div><p style="margin:0;font-size:12px;font-weight:800;letter-spacing:.06em;color:#7c837d">${activity.planned ? 'SESIÓN COMPLETADA' : 'NUEVA ACTIVIDAD'}${extra ? ` · +${extra} MÁS` : ''}</p>`
      + `<strong style="display:block;margin-top:2px;color:#171b18">${escapeText(title || 'Actividad')}</strong>`
      + `<span style="font-size:13px;color:#7c837d">Aún no la has valorado</span></div>`
      + `<div style="display:flex;gap:6px;align-items:center"><button type="button" class="athlete-primary-cta" data-alert-rate>Valorar</button>`
      + `<button type="button" aria-label="Ahora no" data-alert-close style="border:0;background:transparent;font-size:20px;color:#7c837d;padding:4px 6px">×</button></div>`;
    card.querySelector('[data-alert-rate]').addEventListener('click', () => openForRating(activity.id));
    card.querySelector('[data-alert-close]').addEventListener('click', () => { dismiss(activity.id); removeBanner(); });
    const anchor = document.getElementById('athleteMessage');
    if (anchor?.parentNode === shell) anchor.after(card); else shell.prepend(card);
  }

  let lastCheck = 0;
  async function checkPending(force = false) {
    if (!force && Date.now() - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = Date.now();
    try {
      const data = await getJson('/api/athlete/activity-alerts/pending');
      const hidden = dismissed();
      const list = (data.activities || []).filter(item => !hidden.includes(item.id));
      if (list.length) renderBanner(list[0], list.length - 1); else removeBanner();
      // Lo que ya se ve dentro de la app no se vuelve a avisar en el móvil.
      await configureRunner((data.activities || []).map(item => item.id));
    } catch (error) {
      console.warn('[RunFlow] actividades sin valorar', error);
      await configureRunner();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(() => checkPending(false), 600);
  });
  // Al guardar una valoración se quita la tarjeta si era de esa actividad.
  document.addEventListener('click', event => {
    if (event.target.closest('#saveLog')) setTimeout(() => checkPending(true), 2500);
  }, true);

  installTapListener();
  let pendingOpen = '';
  try { pendingOpen = sessionStorage.getItem(OPEN_KEY) || ''; } catch {}
  if (pendingOpen) setTimeout(() => openForRating(pendingOpen), 800);
  setTimeout(() => checkPending(true), 1500);

  window.RunFlowActivityAlerts = { checkPending, openForRating };
})();
