#!/usr/bin/env bash
# Declara el permiso de micrófono en los proyectos nativos que genera `npx cap add`.
# Sin él, la WebView rechaza getUserMedia y el botón "Grabar nota de voz" no pide permiso.
# Uso: native-permissions.sh [directorio con android/ y/o ios/] (por defecto, el actual)
set -euo pipefail
root="${1:-.}"

manifest="$root/android/app/src/main/AndroidManifest.xml"
if [ -f "$manifest" ]; then
  for permission in RECORD_AUDIO MODIFY_AUDIO_SETTINGS; do
    if ! grep -q "android.permission.$permission\"" "$manifest"; then
      PERMISSION="$permission" perl -0pi -e 's#</manifest>#    <uses-permission android:name="android.permission.$ENV{PERMISSION}" />\n</manifest>#' "$manifest"
    fi
  done
  echo "Permisos Android:"; grep "uses-permission" "$manifest"
fi

plist="$root/ios/App/App/Info.plist"
if [ -f "$plist" ] && ! grep -q "NSMicrophoneUsageDescription" "$plist"; then
  text='RunFlow usa el micrófono para grabar notas de voz en el feedback de tus sesiones.'
  TEXT="$text" perl -0pi -e 's#<dict>#<dict>\n\t<key>NSMicrophoneUsageDescription</key>\n\t<string>$ENV{TEXT}</string>#' "$plist"
  echo "Permiso de micrófono iOS añadido."
fi
