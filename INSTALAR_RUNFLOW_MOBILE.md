# RunFlow Mobile 0.1 — Android + iPhone

## Objetivo de esta fase

Validar RunFlow Athlete como aplicación nativa manteniendo la web actual como fuente. La app abre:

`https://runflow-online-pilot.onrender.com/athlete`

Esto permite que las mejoras que despliegues en RunFlow se vean inmediatamente en las apps de prueba.

> Esta arquitectura con `server.url` es para validación interna. Antes de publicar en Google Play o App Store se empaquetará el frontend dentro de la app y se mantendrá únicamente la API/backend remota.

## Qué se añade al repositorio

- `mobile/`: proyecto Capacitor común Android/iOS.
- `.github/workflows/runflow-mobile-android-debug.yml`: genera una APK Android desde GitHub Actions.
- `.github/workflows/runflow-mobile-ios-simulator.yml`: verifica que el proyecto iOS compila para simulador.

No modifica `server.js`, Coach ni Athlete web.

## Android: la forma más cómoda para probar ahora

Después de subir estos archivos a `main`:

1. GitHub > Actions.
2. Abre **RunFlow Android APK**.
3. Pulsa **Run workflow**.
4. Cuando termine, abre la ejecución.
5. En **Artifacts**, descarga `RunFlow-Android-debug`.
6. Dentro encontrarás `app-debug.apk`.
7. Instálala en tu Android.

La APK es de pruebas, no la versión para Google Play.

## Android con Android Studio

En un ordenador con Node 22+, Java 21, Android Studio y Android SDK:

```bash
cd mobile
npm install
npx cap add android
npx cap sync android
npx cap open android
```

## iPhone

El código iOS queda preparado con el mismo proyecto Capacitor. Compilar una app instalable en un iPhone requiere macOS + Xcode y firma de Apple.

En un Mac:

```bash
cd mobile
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

Después, en Xcode se selecciona el Apple Team y se ejecuta en el iPhone.

El workflow **RunFlow iOS Simulator Build** sirve para comprobar automáticamente que el proyecto iOS compila, pero el `.app` del simulador no se instala en un iPhone físico.

## Mobile 0.2

Después de validar login, Hoy, Semana, Sesiones, RPE y Mensajes:

- notificaciones push Coach ↔ Atleta;
- badge nativo de no leídos;
- deep link a conversación o sesión;
- aviso cuando el coach modifica una sesión publicada.

## Identificador actual

`com.runflow.athlete`

Antes de publicar se confirmará el Bundle/Application ID definitivo.
