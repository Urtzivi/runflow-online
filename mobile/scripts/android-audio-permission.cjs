#!/usr/bin/env node
// Micrófono para la web dentro de la APK (grabar audios en los cuestionarios).
// Capacitor da el micrófono a la web solo si Android concede RECORD_AUDIO y MODIFY_AUDIO_SETTINGS;
// el segundo no lo declara ningún plugin, así que sin esto getUserMedia siempre falla en la APK.
// Ejecutar después de `npx cap sync android`. No duplica cambios.
const fs = require('fs');
const path = require('path');
const manifestFile = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(manifestFile)) { console.error('No se encuentra ' + manifestFile + '. Ejecuta antes `npx cap add android`.'); process.exit(1); }
let manifest = fs.readFileSync(manifestFile, 'utf8');
for (const perm of ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']) {
  if (manifest.includes(`"${perm}"`)) continue;
  manifest = manifest.replace(/<\/manifest>\s*$/, `    <uses-permission android:name="${perm}" />\n</manifest>\n`);
}
fs.writeFileSync(manifestFile, manifest);
console.log('Permisos de micrófono para la web: OK');
