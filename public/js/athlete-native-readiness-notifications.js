(() => {
  'use strict';

  if (window.__runflowNativeReadinessNotificationsInstalled) return;
  window.__runflowNativeReadinessNotificationsInstalled = true;

  const REMINDER_HOUR = 8;
  const REMINDER_MINUTE = 0;
  const DAYS_AHEAD = 14;

  function plugin() {
    return window.Capacitor?.Plugins?.LocalNotifications || null;
  }

  function isNative() {
    try {
      return Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.getPlatform?.() !== 'web');
    } catch {
      return false;
    }
  }

  function notificationId(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return Number(`${y}${m}${d}`);
  }

  function localDay(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function reminderDate(base, addDays) {
    const date = new Date(base);
    date.setDate(date.getDate() + addDays);
    date.setHours(REMINDER_HOUR, REMINDER_MINUTE, 0, 0);
    return date;
  }

  async function ensurePermission() {
    const LocalNotifications = plugin();
    if (!LocalNotifications) return false;
    try {
      const current = await LocalNotifications.checkPermissions();
      if (current?.display === 'granted') return true;
      const requested = await LocalNotifications.requestPermissions();
      return requested?.display === 'granted';
    } catch (error) {
      console.warn('[RunFlow Native] notification permission', error);
      return false;
    }
  }

  async function cancelDay(date = new Date()) {
    const LocalNotifications = plugin();
    if (!LocalNotifications) return;
    try {
      await LocalNotifications.cancel({ notifications: [{ id: notificationId(date) }] });
    } catch (error) {
      console.warn('[RunFlow Native] cancel readiness reminder', error);
    }
  }

  async function scheduleRollingReminders(todayCompleted = false) {
    const LocalNotifications = plugin();
    if (!LocalNotifications || !isNative()) return;
    if (!(await ensurePermission())) return;

    const now = new Date();
    const notifications = [];
    for (let i = 0; i < DAYS_AHEAD; i += 1) {
      const at = reminderDate(now, i);
      if (i === 0 && (todayCompleted || at <= now)) continue;
      notifications.push({
        id: notificationId(at),
        title: 'RunFlow · ¿Cómo te encuentras hoy?',
        body: 'Completa tu check-in de recuperación. Son unos segundos y ayuda a ajustar tu entrenamiento.',
        schedule: { at, allowWhileIdle: true },
        extra: { runflow_action: 'daily_readiness', day: localDay(at) },
      });
    }

    try {
      if (todayCompleted) await cancelDay(now);
      if (notifications.length) await LocalNotifications.schedule({ notifications });
    } catch (error) {
      console.warn('[RunFlow Native] schedule readiness reminders', error);
    }
  }

  async function refreshFromServer() {
    if (!isNative() || !plugin()) return;
    try {
      const response = await fetch('/api/v2/athlete/daily-checkin', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      await scheduleRollingReminders(Boolean(data?.today));
    } catch (error) {
      console.warn('[RunFlow Native] readiness state', error);
    }
  }

  async function installActionListener() {
    const LocalNotifications = plugin();
    if (!LocalNotifications || !isNative()) return;
    try {
      await LocalNotifications.addListener('localNotificationActionPerformed', event => {
        if (event?.notification?.extra?.runflow_action !== 'daily_readiness') return;
        setTimeout(() => document.dispatchEvent(new CustomEvent('runflow:open-morning-checkin')), 250);
      });
    } catch (error) {
      console.warn('[RunFlow Native] notification listener', error);
    }
  }

  document.addEventListener('runflow:daily-checkin-state', event => {
    scheduleRollingReminders(Boolean(event?.detail?.completed));
  });

  document.addEventListener('runflow:daily-checkin-saved', () => {
    cancelDay(new Date());
    scheduleRollingReminders(true);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(refreshFromServer, 400);
  });

  installActionListener();
  setTimeout(refreshFromServer, 1200);
})();
