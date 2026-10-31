// RunFlow · dueño de los avisos del móvil.
// Los avisos (readiness de las 10:00, valoración de fútbol/fuerza/partido y actividad nueva) son notificaciones locales:
// se quedan programadas en el teléfono aunque se cierre sesión o entre otro deportista.
// Aquí se guarda para qué deportista están programadas y, si cambia, se borran antes de programar las nuevas.
(() => {
  'use strict';

  if (window.RunFlowNotificationOwner) return;

  const OWNER_KEY = 'runflow_notifications_athlete';
  const ACTIONS = ['daily_readiness', 'football_feedback', 'new_activity'];
  // El aviso de actividad nueva lo lanza un proceso en segundo plano (athlete-activity-alerts.js) con su propio token.
  const ACTIVITY_RUNNER_LABEL = 'com.runflow.athlete.activitycheck';
  const ACTIVITY_TOKEN_KEY = 'runflow_activity_alerts_token';

  const plugin = () => window.Capacitor?.Plugins?.LocalNotifications || null;
  function isNative() {
    try { return Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.getPlatform?.() !== 'web'); }
    catch { return false; }
  }
  function storedOwner() {
    try { return localStorage.getItem(OWNER_KEY) || ''; } catch { return ''; }
  }
  function storeOwner(athleteId) {
    try {
      if (athleteId) localStorage.setItem(OWNER_KEY, athleteId);
      else localStorage.removeItem(OWNER_KEY);
    } catch {}
  }

  // Borra los avisos de RunFlow pendientes y los que ya están en la bandeja del móvil.
  async function clearAll() {
    storeOwner('');
    try { localStorage.removeItem(ACTIVITY_TOKEN_KEY); } catch {}
    const BackgroundRunner = window.Capacitor?.Plugins?.BackgroundRunner;
    if (BackgroundRunner && isNative()) {
      try { await BackgroundRunner.dispatchEvent({ label: ACTIVITY_RUNNER_LABEL, event: 'reset', details: {} }); }
      catch (error) { console.warn('[RunFlow] borrar aviso de actividad del deportista anterior', error); }
    }
    const LocalNotifications = plugin();
    if (!LocalNotifications || !isNative()) return;
    try {
      const pending = await LocalNotifications.getPending();
      const ours = (pending?.notifications || [])
        .filter(n => ACTIONS.includes(n?.extra?.runflow_action))
        .map(n => ({ id: n.id }));
      if (ours.length) await LocalNotifications.cancel({ notifications: ours });
      await LocalNotifications.removeAllDeliveredNotifications?.();
    } catch (error) {
      console.warn('[RunFlow] borrar avisos del deportista anterior', error);
    }
  }

  // Deja los avisos del móvil a nombre de este deportista; si eran de otro (o no se sabe de quién), se borran.
  async function claim(athleteId) {
    const id = String(athleteId || '');
    if (!id) return false;
    if (storedOwner() !== id) {
      await clearAll();
      storeOwner(id);
    }
    return true;
  }

  // Consulta una vez el deportista de la sesión abierta. Los módulos de avisos esperan a esto antes de programar.
  let ensured = null;
  function ensure() {
    if (!ensured) {
      ensured = fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
        .then(response => (response.ok ? response.json() : null))
        .then(data => claim(data?.user?.athlete_id))
        .catch(error => { console.warn('[RunFlow] deportista de los avisos', error); return false; })
        .then(ok => { if (!ok) ensured = null; return ok; });
    }
    return ensured;
  }

  window.RunFlowNotificationOwner = { claim, clearAll, ensure };
})();
