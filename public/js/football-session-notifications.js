// RunFlow Fútbol · avisos en el móvil para valorar los entrenos de fútbol, la fuerza y el partido.
// Entrenos y fuerza: a media tarde (o 30 min después de acabar si terminan más tarde). Partido: 1 h después de terminar.
// El "¿Cómo te encuentras hoy?" de antes de entrenar lo programa athlete-native-readiness-notifications.js (8:00).
// Igual que el aviso de readiness (athlete-native-readiness-notifications.js): notificaciones locales de la app nativa.
// Se reprograman cada vez que la app carga la semana (evento runflow:football-week) y quitan las sesiones ya valoradas.
(() => {
  'use strict';

  if (window.__runflowFootballSessionNotificationsInstalled) return;
  window.__runflowFootballSessionNotificationsInstalled = true;

  const ACTION = 'football_feedback';
  const KINDS = ['football_training', 'strength', 'match'];
  const MID_AFTERNOON = '18:30';   // aviso de media tarde para valorar los entrenos del día
  const AFTER_MIN = { football_training: 30, strength: 30, match: 60 }; // minutos después de terminar
  const DEFAULT_MIN = { football_training: 75, strength: 45, match: 70 };
  const COPY = {
    football_training: { title: 'RunFlow · ¿Qué tal el entreno de fútbol?', body: 'Valora el entreno: esfuerzo, cómo tienes el cuerpo y cómo te sientes. Tu entrenador lo verá.' },
    strength: { title: 'RunFlow · ¿Qué tal la fuerza en el gimnasio?', body: 'Valora la sesión de fuerza: esfuerzo, cuerpo y ánimo. Son unos segundos.' },
    match: { title: 'RunFlow · ¿Qué tal el partido?', body: 'Rellena “Mi partido por dentro”: minutos, esfuerzo y cómo lo has vivido. Tu entrenador lo verá.' },
  };

  const plugin = () => window.Capacitor?.Plugins?.LocalNotifications || null;
  function isNative() {
    try { return Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.getPlatform?.() !== 'web'); }
    catch { return false; }
  }

  // Id estable por sesión (date|clave) dentro del rango de enteros de Android, lejos de los ids de readiness (AAAAMMDD).
  function notificationId(key) {
    let h = 0;
    for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return 1000000000 + (h % 1000000000);
  }

  function timeOn(date, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const at = new Date(`${date}T00:00:00`);
    at.setHours(h, m, 0, 0);
    return at;
  }
  // Partido: 1 h después de terminar. Entrenos y fuerza: a media tarde, pero nunca antes de que acabe la sesión.
  function reminderAt(item) {
    const afternoon = timeOn(item.date, MID_AFTERNOON);
    if (!item.time) return afternoon;
    const end = timeOn(item.date, item.time);
    end.setMinutes(end.getMinutes() + (Number(item.duration_min) || DEFAULT_MIN[item.kind]) + AFTER_MIN[item.kind]);
    if (item.kind === 'match') return end;
    return end > afternoon ? end : afternoon;
  }

  async function ensurePermission(LocalNotifications) {
    try {
      const current = await LocalNotifications.checkPermissions();
      if (current?.display === 'granted') return true;
      const requested = await LocalNotifications.requestPermissions();
      return requested?.display === 'granted';
    } catch (error) {
      console.warn('[RunFlow Fútbol] permiso de notificaciones', error);
      return false;
    }
  }

  async function reschedule(week) {
    const LocalNotifications = plugin();
    if (!LocalNotifications || !isNative() || !week?.days) return;
    if (!(await ensurePermission(LocalNotifications))) return;
    const now = new Date();
    const notifications = week.days.flatMap(day => day.items || [])
      .filter(item => KINDS.includes(item.kind) && !item.rating && item.key && item.date)
      .map(item => ({ item, at: reminderAt(item) }))
      .filter(({ at }) => at > now)
      .map(({ item, at }) => ({
        id: notificationId(item.key),
        title: COPY[item.kind].title,
        body: item.title && item.kind !== 'football_training' ? `${item.title}. ${COPY[item.kind].body}` : COPY[item.kind].body,
        schedule: { at, allowWhileIdle: true },
        extra: { runflow_action: ACTION, key: item.key, kind: item.kind, day: item.date },
      }));
    try {
      // Se cancelan los avisos anteriores de valoración (sesiones movidas, canceladas o ya valoradas) y se vuelven a crear.
      const pending = await LocalNotifications.getPending();
      const old = (pending?.notifications || []).filter(n => n?.extra?.runflow_action === ACTION).map(n => ({ id: n.id }));
      if (old.length) await LocalNotifications.cancel({ notifications: old });
      if (notifications.length) await LocalNotifications.schedule({ notifications });
    } catch (error) {
      console.warn('[RunFlow Fútbol] avisos de valoración', error);
    }
  }

  async function installActionListener() {
    const LocalNotifications = plugin();
    if (!LocalNotifications || !isNative()) return;
    try {
      await LocalNotifications.addListener('localNotificationActionPerformed', event => {
        const extra = event?.notification?.extra;
        if (extra?.runflow_action !== ACTION) return;
        setTimeout(() => document.dispatchEvent(new CustomEvent('runflow:open-football-rate', { detail: { key: extra.key, kind: extra.kind } })), 250);
      });
    } catch (error) {
      console.warn('[RunFlow Fútbol] listener de avisos', error);
    }
  }

  document.addEventListener('runflow:football-week', event => { reschedule(event?.detail?.week); });
  installActionListener();
})();
