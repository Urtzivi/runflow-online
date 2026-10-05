# RunFlow Mobile

Capacitor 8.5.0 · Android + iOS.

- App ID: `com.runflow.athlete`
- App name: `RunFlow`
- Athlete production URL: `https://runflow-online-pilot.onrender.com/athlete`

La carpeta `www/` existe para que Capacitor tenga un `webDir` válido. En Mobile 0.1, `server.url` carga la aplicación Athlete desplegada en Render.

## Servidor web

- Arranque: `node start.js` (Render, Docker y `start.bat`). Carga los hooks en orden y después `server.js`; un hook nuevo se añade a la lista de `start.js`.
- Pruebas: `npm test` arranca el servidor en modo demo y comprueba permisos y límites de intentos.
- Supabase: `supabase/rls.sql` revisa y activa Row Level Security en todas las tablas.
- Límites de intentos por IP cada 15 min: 20 en `/api/auth/*` y 30 en análisis con OpenAI. Se ajustan con `RATE_LIMIT_AUTH_MAX` y `RATE_LIMIT_AI_MAX`.
