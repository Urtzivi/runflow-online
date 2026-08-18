import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.runflow.athlete',
  appName: 'RunFlow',
  webDir: 'www',
  server: {
    // Mobile 0.1: carga Athlete desde producción para validar rápido Android/iOS.
    // Antes de App Store / Google Play se sustituirá por assets web empaquetados.
    url: 'https://runflow-online-pilot.onrender.com/athlete',
    cleartext: false
  }
};

export default config;
