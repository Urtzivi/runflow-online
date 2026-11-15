// RunFlow · aviso en el móvil para valorar las sesiones de fuerza del plan (app de running).
// Igual que el readiness de las 10:00: notificaciones locales de la app nativa, sin servidor de avisos.
// Cada sesión de fuerza sin valorar avisa ese día a las 20:00 y, si sigue sin valorar, al día siguiente a las 13:00.
// El aviso trae dos botones: "Valorar" abre el formulario de la sesión y "No la he hecho" la guarda como no realizada.
// Se reprograman cada vez que la app carga la semana y quitan las sesiones ya valoradas.
(() => {
  'use strict';

  if (window.__runflowStrengthNotificationsInstalled) return;
  window.__runflowStrengthNotificationsInstalled = true;

  const ACTION = 'strength_feedback';
  const ACTION_TYPE = 'RUNFLOW_STRENGTH';
  const SAME_DAY = '20:00';
  const NEXT_DAY = '13:00';
  const LOOK_BACK_DAYS = 2;

  const plugin = () => window.Capacitor?.Plugins?.LocalNotifications || null;
  function isNative() {
    try { return Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.getPlatform?.() !== 'web'); }
    catch { return false; }
  }

  function iso(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function dateOf(day) { return new Date(`${day}T00:00:00`); }
  function addDays(day, n) { const d = dateOf(day); d.setDate(d.getDate() + n); return iso(d); }
  function mondayOf(day) { const d = dateOf(day); const shift = (d.getDay() + 6) % 7; d.setDate(d.getDate() - shift); return iso(d); }
  function timeOn(day, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const at = dateOf(day);
    at.setHours(h, m, 0, 0);
    return at;
  }
  const WEEKDAY = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  // Fuerza = deporte Strength/WeightTraining, o un título de fuerza/gimnasio que no sea de carrera, bici, etc.
  function isStrength(workout) {
    const sport = String(workout?.sport || '');
    const title = String(workout?.title || '');
    if (/strength|weight/i.test(sport)) return true;
    if (/run|ride|bike|swim|walk|hike|trail/i.test(sport)) return false;
    return /\bfuerza\b|gimnasio|\bgym\b/i.test(title);
  }
  const pendingRating = w => w?.id && w.workout_date && isStrength(w) && !w.manual_log;

  // Ids estables por sesión y aviso, lejos de los de readiness (AAAAMMDD) y de fútbol (desde 1.000.000.000).
  function notificationId(key) {
    let h = 0;
    for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return 100000000 + (h % 800000000);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store', ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Error ${response.status}`);
    return data;
  }

  function loadedWeek() {
    try { return { weekStart: state?.selectedWeekStart, workouts: state?.athlete?.week?.workouts || null }; }
    catch { return { weekStart: null, workouts: null }; }
  }
  async function weekWorkouts(weekStart) {
    const loaded = loadedWeek();
    if (loaded.weekStart === weekStart && Array.isArray(loaded.workouts)) return loaded.workouts;
    const data = await api(`/api/athlete/dashboard?week_start=${weekStart}`);
    return data?.athlete?.week?.workouts || [];
  }

  // Sesiones de fuerza desde hace dos días hasta el final de la semana (y la siguiente si ya es fin de semana).
  async function strengthToRemind() {
    const today = iso(new Date());
    const weeks = new Set([mondayOf(addDays(today, -LOOK_BACK_DAYS)), mondayOf(today)]);
    if (dateOf(today).getDay() === 6 || dateOf(today).getDay() === 0) weeks.add(mondayOf(addDays(today, 7)));
    const lists = await Promise.all([...weeks].map(weekWorkouts));
    const from = addDays(today, -LOOK_BACK_DAYS);
    const seen = new Set();
    return lists.flat().filter(w => {
      if (!w?.id || seen.has(w.id)) return false;
      seen.add(w.id);
      return String(w.workout_date) >= from;
    });
  }

  function notificationsFor(workout, now) {
    const day = String(workout.workout_date).slice(0, 10);
    const weekday = WEEKDAY[dateOf(day).getDay()];
    const title = workout.title ? `${workout.title}. ` : '';
    return [
      { kind: 'same_day', at: timeOn(day, SAME_DAY), title: 'RunFlow · ¿Qué tal la fuerza de hoy?', body: `${title}Valórala en unos segundos o dinos que no la has hecho.` },
      { kind: 'next_day', at: timeOn(addDays(day, 1), NEXT_DAY), title: `RunFlow · Te falta valorar la fuerza del ${weekday}`, body: `${title}Valórala o dinos que no la has hecho: así el plan se ajusta a lo que haces de verdad.` },
    ].filter(n => n.at > now).map(n => ({
      id: notificationId(`${workout.id}|${n.kind}`),
      title: n.title,
      body: n.body,
      actionTypeId: ACTION_TYPE,
      schedule: { at: n.at, allowWhileIdle: true },
      extra: { runflow_action: ACTION, workout_id: workout.id, day },
    }));
  }

  let actionTypesReady = null;
  function registerActionTypes(LocalNotifications) {
    if (!actionTypesReady) {
      actionTypesReady = Promise.resolve(LocalNotifications.registerActionTypes?.({
        types: [{ id: ACTION_TYPE, actions: [{ id: 'rate', title: 'Valorar' }, { id: 'skipped', title: 'No la he hecho', destructive: true }] }],
      })).catch(error => { console.warn('[RunFlow Fuerza] botones del aviso', error); actionTypesReady = null; });
    }
    return actionTypesReady;
  }

  async function ensurePermission(LocalNotifications) {
    try {
      const current = await LocalNotifications.checkPermissions();
      if (current?.display === 'granted') return true;
      const requested = await LocalNotifications.requestPermissions();
      return requested?.display === 'granted';
    } catch (error) {
      console.warn('[RunFlow Fuerza] permiso de notificaciones', error);
      return false;
    }
  }

  // Quita de la bandeja los avisos de sesiones que ya no están pendientes (valoradas o marcadas como no hechas).
  async function clearDelivered(LocalNotifications, pendingIds) {
    try {
      const delivered = await LocalNotifications.getDeliveredNotifications?.();
      const stale = (delivered?.notifications || []).filter(n => n?.extra?.runflow_action === ACTION && !pendingIds.has(String(n.extra.workout_id)));
      if (stale.length) await LocalNotifications.removeDeliveredNotifications({ notifications: stale });
    } catch (error) {
      console.warn('[RunFlow Fuerza] limpiar avisos ya contestados', error);
    }
  }

  let running = null;
  let again = false;
  async function reschedule() {
    if (running) { again = true; return running; }
    running = (async () => {
      const LocalNotifications = plugin();
      if (!LocalNotifications || !isNative()) return;
      if (window.RunFlowNotificationOwner && !(await window.RunFlowNotificationOwner.ensure())) return;
      const workouts = await strengthToRemind();
      const pending = workouts.filter(pendingRating);
      const now = new Date();
      const notifications = pending.flatMap(w => notificationsFor(w, now));
      if (notifications.length && !(await ensurePermission(LocalNotifications))) return;
      await registerActionTypes(LocalNotifications);
      const scheduled = await LocalNotifications.getPending();
      const old = (scheduled?.notifications || []).filter(n => n?.extra?.runflow_action === ACTION).map(n => ({ id: n.id }));
      if (old.length) await LocalNotifications.cancel({ notifications: old });
      if (notifications.length) await LocalNotifications.schedule({ notifications });
      await clearDelivered(LocalNotifications, new Set(pending.map(w => String(w.id))));
    })().catch(error => console.warn('[RunFlow Fuerza] avisos de valoración', error))
      .finally(() => {
        running = null;
        if (again) { again = false; setTimeout(reschedule, 300); }
      });
    return running;
  }

  let timer = null;
  function soon(delay = 1500) {
    clearTimeout(timer);
    timer = setTimeout(reschedule, delay);
  }

  // Espera a que la app del atleta esté cargada (state y el formulario de valoración de athlete.js).
  function appReady(timeoutMs = 20000) {
    const started = Date.now();
    return new Promise(resolve => {
      const check = () => {
        let ready = false;
        try { ready = Boolean(state?.athlete && document.getElementById('logModal') && typeof resetFeedbackForm === 'function'); } catch {}
        if (ready || Date.now() - started > timeoutMs) resolve(ready);
        else setTimeout(check, 300);
      };
      check();
    });
  }

  async function findWorkout(workoutId, day) {
    const list = await weekWorkouts(mondayOf(day));
    return list.find(w => String(w.id) === String(workoutId)) || null;
  }

  function toast(text, kind = 'success') {
    try { if (typeof message === 'function') { message(text, kind); return; } } catch {}
    console.info('[RunFlow Fuerza]', text);
  }

  async function openRating(extra) {
    if (!(await appReady())) return;
    const workout = await findWorkout(extra.workout_id, extra.day).catch(() => null);
    if (!workout) { toast('No hemos encontrado esa sesión de fuerza. Puede que tu entrenador la haya cambiado.', 'error'); return; }
    try {
      state.selectedWorkout = workout;
      state.selectedActivity = null;
      resetFeedbackForm();
      document.getElementById('sessionDetail')?.classList.add('hidden');
      document.getElementById('logModal')?.classList.remove('hidden');
      const kicker = document.getElementById('logModal')?.querySelector('.athlete-kicker');
      if (kicker) kicker.textContent = 'FUERZA · CUÉNTANOS CÓMO FUE (SI NO LA HICISTE, MARCA "NO REALIZADA")';
    } catch (error) {
      console.warn('[RunFlow Fuerza] abrir valoración', error);
    }
  }

  async function markSkipped(extra) {
    try {
      await api('/api/athlete/manual-log', { method: 'POST', body: JSON.stringify({ workout_id: extra.workout_id, status: 'skipped' }) });
      const weekday = extra.day ? WEEKDAY[dateOf(extra.day).getDay()] : '';
      if (await appReady(8000)) {
        toast(`Anotado: no has hecho la fuerza${weekday ? ` del ${weekday}` : ''}. Tu entrenador lo verá.`);
        try { if (typeof loadDashboard === 'function') await loadDashboard(state.selectedWeekStart); } catch {}
      }
    } catch (error) {
      toast(`No se pudo guardar que no la has hecho: ${error.message}. Ábrela y marca "No realizada".`, 'error');
      openRating(extra);
      return;
    }
    soon(300);
  }

  function onTap(event) {
    const extra = event?.notification?.extra;
    if (!extra?.workout_id) return;
    if (event.actionId === 'skipped') markSkipped(extra);
    else setTimeout(() => openRating(extra), 250);
  }

  async function installActionListener() {
    const LocalNotifications = plugin();
    if (!LocalNotifications || !isNative()) return;
    registerActionTypes(LocalNotifications);
    if (window.RunFlowNotificationOwner?.onAction) { window.RunFlowNotificationOwner.onAction(ACTION, onTap); return; }
    try {
      await LocalNotifications.addListener('localNotificationActionPerformed', event => {
        if (event?.notification?.extra?.runflow_action === ACTION) onTap(event);
      });
    } catch (error) {
      console.warn('[RunFlow Fuerza] listener de avisos', error);
    }
  }

  document.addEventListener('runflow:athlete-dashboard-ready', () => soon());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(1200); });
  installActionListener();
  soon(2500);
})();
