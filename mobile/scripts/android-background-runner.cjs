#!/usr/bin/env node
// Prepara el proyecto Android (`npx cap add android`) para el aviso de actividad nueva (@capacitor/background-runner):
//  1. MainActivity recibe el toque en la notificación (acción ".NOTIFICATION_CLICKED") para abrir la actividad.
//  2. Se quitan los permisos de ubicación que el plugin declara y RunFlow no usa.
//  3. El módulo app encuentra el motor JS del plugin (android-js-engine-release.aar).
// Se puede ejecutar varias veces: no duplica cambios.
const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, '..', 'android', 'app');
const manifestFile = path.join(appDir, 'src', 'main', 'AndroidManifest.xml');
const gradleFile = path.join(appDir, 'build.gradle');

if (!fs.existsSync(manifestFile) || !fs.existsSync(gradleFile)) {
  console.error('No se encuentra el proyecto Android en ' + appDir + '. Ejecuta antes `npx cap add android`.');
  process.exit(1);
}

let manifest = fs.readFileSync(manifestFile, 'utf8');

if (!/xmlns:tools=/.test(manifest)) {
  manifest = manifest.replace(/<manifest\b/, '<manifest xmlns:tools="http://schemas.android.com/tools"');
}

if (!manifest.includes('.NOTIFICATION_CLICKED')) {
  const activity = manifest.match(/<activity\b[^>]*android:name="[^"]*MainActivity"[\s\S]*?<\/activity>/);
  if (!activity) {
    console.error('No se encuentra MainActivity en AndroidManifest.xml.');
    process.exit(1);
  }
  const filter = [
    '            <intent-filter>',
    '                <action android:name=".NOTIFICATION_CLICKED" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '            </intent-filter>',
    '',
  ].join('\n');
  const patched = activity[0].replace(/(\s*)<\/activity>$/, `\n${filter}$1</activity>`);
  manifest = manifest.replace(activity[0], patched);
}

for (const permission of ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION']) {
  const name = `android.permission.${permission}`;
  if (manifest.includes(`"${name}" tools:node="remove"`)) continue;
  manifest = manifest.replace(/(\s*)<application\b/, `$1<uses-permission android:name="${name}" tools:node="remove" />$1<application`);
}

fs.writeFileSync(manifestFile, manifest);

let gradle = fs.readFileSync(gradleFile, 'utf8');
const engineDir = "../../node_modules/@capacitor/background-runner/android/src/main/libs";
if (!gradle.includes(engineDir)) {
  if (/flatDir\s*\{/.test(gradle)) {
    gradle = gradle.replace(/flatDir\s*\{/, `flatDir {\n        dirs '${engineDir}', 'libs'`);
  } else {
    gradle += `\nrepositories {\n    flatDir {\n        dirs '${engineDir}', 'libs'\n    }\n}\n`;
  }
  fs.writeFileSync(gradleFile, gradle);
}

console.log('Android preparado para el aviso de actividad nueva (Background Runner).');
