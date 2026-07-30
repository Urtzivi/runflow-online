# RunFlow Online Pilot 1.1

Versión preparada para desplegar RunFlow en Internet como un servicio Node.js privado.

## Arquitectura del piloto

- **Web del coach:** solo Urtzi entra en `/login` y gestiona perfiles, zonas, objetivos, semanas, actividades, recuperación y análisis.
- **App del deportista:** usará la misma API online, pero cada corredor verá solo su propia información.
- **Supabase:** usuarios, base de datos y permisos.
- **Render:** servidor Node.js con HTTPS.
- **Intervals.icu:** integración individual por deportista.
- **OpenAI:** análisis de sesiones, cuando se active la clave.

## Piloto inicial

- Coach y deportista: Urtzi — `urtzi@suibroker.es`.
- Deportista pendiente de acceso: Ibon Larrinaga — `larri_hc@hotmail.es`.
- La ficha de Ibon se crea sin usuario. Su invitación a la app se activa más adelante desde la web del coach.

## Funciones recuperadas en 1.1

- **Actividades:** sincronización desde Intervals.icu, histórico, detalle, intervalos, comparación con la sesión programada y revisión del entrenador.
- **Análisis:** preanálisis por reglas y análisis con OpenAI cuando la clave está configurada.
- **Recuperación:** sueño, HRV, frecuencia cardiaca en reposo, aptitud, fatiga, forma y nota orientativa de disposición.
- Los datos sincronizados se guardan en las tablas `activities`, `daily_metrics` y `activity_reviews`, ya incluidas en la migración inicial.

## Seguridad

- La `SUPABASE_SERVICE_ROLE_KEY`, la clave de OpenAI y las claves de Intervals solo se usan en el servidor.
- No se incluyen en el HTML ni en la APK.
- Las claves de Intervals se cifran antes de guardarse en la base de datos.
- En producción, RunFlow no arranca si faltan variables obligatorias.
- Las cookies de sesión se marcan como `Secure` y `HttpOnly`.
- Las tablas incluyen políticas RLS como defensa adicional.

## Despliegue

Lee primero [SUBIR_A_INTERNET.md](SUBIR_A_INTERNET.md).

## Archivos principales

- `server.js`: servidor y API de RunFlow.
- `public/`: web del coach y cliente del deportista.
- `supabase/migrations/001_runflow_pilot.sql`: esquema y permisos.
- `scripts/bootstrap-pilot.mjs`: crea el coach y los perfiles iniciales.
- `scripts/check-online.mjs`: comprueba la conexión con Supabase.
- `render.yaml`: despliegue mediante Render Blueprint.
- `Dockerfile`: alternativa para cualquier hosting compatible con Docker.

## Prueba local de la interfaz

```bash
DEMO_MODE=1 node server.js
```

En Windows también puedes ejecutar `start-demo.bat`.

La demostración es local y no debe desplegarse públicamente.
