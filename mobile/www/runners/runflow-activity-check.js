// RunFlow · aviso de actividad nueva (se ejecuta en segundo plano, fuera de la app).
// Android lo lanza cada ~15 min (Background Runner). Pregunta al servidor por actividades recientes
// sin valorar y avisa una sola vez de cada una. La app guarda aquí el token del deportista con "configure"
// y lo borra con "reset" al cerrar sesión o cambiar de deportista.
//
// Este archivo va dentro de la APK: si se cambia, hay que generar una APK nueva. Por eso decide lo mínimo
// y el servidor (/api/athlete/activity-alerts/pending) decide qué actividades están pendientes.

const KEY_CONFIG = 'runflow_activity_alerts_config';
const KEY_NOTIFIED = 'runflow_activity_alerts_notified';
const MAX_REMEMBERED = 60;

function kvGet(key) {
  try {
    const result = CapacitorKV.get(key);
    const value = result && typeof result === 'object' ? result.value : result;
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

function kvSet(key, value) {
  CapacitorKV.set(key, JSON.stringify(value));
}

function kvRemove(key) {
  try { CapacitorKV.remove(key); } catch (error) {}
}

// Id numérico estable (32 bits) para la notificación de cada actividad.
function notificationId(activityId) {
  let hash = 0;
  const text = String(activityId);
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 31) + text.charCodeAt(i)) | 0;
  return 700000000 + (Math.abs(hash) % 100000000);
}

function durationLabel(seconds) {
  const total = Math.round(Number(seconds || 0) / 60);
  if (!total) return '';
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
}

function distanceLabel(meters) {
  const km = Number(meters || 0) / 1000;
  if (km < 0.2) return '';
  return `${km.toFixed(km >= 10 ? 1 : 2).replace('.', ',')} km`;
}

function notificationFor(activity) {
  const details = [distanceLabel(activity.distance_m), durationLabel(activity.duration_sec)].filter(Boolean).join(' · ');
  const name = activity.planned && activity.planned_title ? activity.planned_title : (activity.name || 'Actividad');
  return {
    id: notificationId(activity.id),
    title: activity.planned ? 'RunFlow · Sesión completada' : 'RunFlow · Nueva actividad',
    body: `${name}${details ? ` (${details})` : ''}. Toca para valorarla.`,
    scheduleAt: new Date(Date.now() + 1000),
    autoCancel: true,
    // La app lee este texto al tocar el aviso y abre la actividad para valorarla.
    actionTypeId: `runflow_activity:${activity.id}`,
  };
}

addEventListener('configure', (resolve, reject, args) => {
  try {
    const details = args || {};
    if (!details.token || !details.base_url || !details.athlete_id) {
      kvRemove(KEY_CONFIG);
      kvRemove(KEY_NOTIFIED);
      resolve({ configured: false });
      return;
    }
    const previous = kvGet(KEY_CONFIG);
    if (previous && previous.athlete_id !== details.athlete_id) kvRemove(KEY_NOTIFIED);
    kvSet(KEY_CONFIG, { token: details.token, base_url: details.base_url, athlete_id: details.athlete_id });
    // Las actividades que la app ya ha mostrado no se vuelven a avisar.
    if (Array.isArray(details.seen) && details.seen.length) {
      const notified = kvGet(KEY_NOTIFIED) || [];
      const merged = notified.concat(details.seen.map(String).filter(id => notified.indexOf(id) < 0));
      kvSet(KEY_NOTIFIED, merged.slice(-MAX_REMEMBERED));
    }
    resolve({ configured: true });
  } catch (error) {
    reject(error);
  }
});

addEventListener('reset', (resolve) => {
  kvRemove(KEY_CONFIG);
  kvRemove(KEY_NOTIFIED);
  resolve({ configured: false });
});

addEventListener('checkActivities', async (resolve, reject) => {
  try {
    const config = kvGet(KEY_CONFIG);
    if (!config || !config.token || !config.base_url) {
      resolve({ checked: false });
      return;
    }
    const response = await fetch(`${config.base_url}/api/athlete/activity-alerts/pending`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
    });
    if (response.status === 401) {
      // Token caducado o deportista dado de baja: se deja de consultar hasta que la app lo renueve.
      kvRemove(KEY_CONFIG);
      resolve({ checked: false });
      return;
    }
    if (!response.ok) {
      resolve({ checked: false, status: response.status });
      return;
    }
    const data = JSON.parse(await response.text());
    if (!data || data.athlete_id !== config.athlete_id) {
      resolve({ checked: false });
      return;
    }
    const notified = kvGet(KEY_NOTIFIED) || [];
    const fresh = (data.activities || []).filter(item => item && item.id && notified.indexOf(String(item.id)) < 0);
    if (fresh.length) {
      CapacitorNotifications.schedule(fresh.slice(0, 3).map(notificationFor));
      kvSet(KEY_NOTIFIED, notified.concat(fresh.map(item => String(item.id))).slice(-MAX_REMEMBERED));
    }
    resolve({ checked: true, notified: fresh.length });
  } catch (error) {
    reject(error);
  }
});
