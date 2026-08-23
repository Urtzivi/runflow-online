import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const syntaxFiles = [
  'auth-recovery-hook.js',
  'v9-engine-hook.js',
  'v9-supplement-hook.js',
  'public/js/login.js',
  'public/js/activate.js',
  'public/js/coach-v9-batch.js',
  'public/js/coach-v9-supplement.js',
  'public/js/coach-v9-season-planner.js',
  'public/js/coach-v9-season-bridge.js',
  'public/js/coach-v9-profile-availability.js',
  'public/js/coach-v9-hierarchy.js',
  'public/js/coach-v9-stepwise-final.js',
  'public/js/coach-v9-session-generator-fix.js',
  'public/js/coach-v9-manual-planning.js',
  'public/js/coach-v9-contextual-recommender-v2.js',
  'public/js/athlete-v2-complete.js',
  'public/js/athlete-v2-fixes.js',
];

for (const file of syntaxFiles) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
}

const dataDir = path.join(root, 'data');
const parts = fs.readdirSync(dataDir)
  .filter(name => /^runflow-v9-library\.part\d+\.b64$/.test(name))
  .sort((a, b) => Number(a.match(/part(\d+)/)[1]) - Number(b.match(/part(\d+)/)[1]));

if (!parts.length) throw new Error('No se encontraron partes de la biblioteca V9.');
const encoded = parts.map(name => fs.readFileSync(path.join(dataDir, name), 'utf8').trim()).join('');
const decoded = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
const sessions = Array.isArray(decoded.s) ? decoded.s : [];
if (sessions.length !== 307) throw new Error(`Biblioteca V9 incompleta: ${sessions.length}/307 sesiones.`);
const ids = sessions.map(row => row.i || row.ID).filter(Boolean);
if (ids.length !== 307) throw new Error(`Hay ${307 - ids.length} sesiones sin ID.`);
if (new Set(ids).size !== 307) throw new Error('La biblioteca V9 contiene IDs duplicados.');
const running = sessions.filter(row => String(row.d || row.Disciplina || '').toLowerCase() !== 'fuerza').length;
const strength = sessions.length - running;
console.log(`Biblioteca V9 OK: ${sessions.length} sesiones, ${ids.length} IDs únicos. Running/trail=${running}, fuerza=${strength}.`);

const requiredFiles = ['public/coach.html', 'public/coach-base.html', 'public/coach-v8.html', 'public/coach-v9.html', 'public/athlete.html'];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Falta la ruta requerida ${file}.`);
}
const primaryCoach = fs.readFileSync(path.join(root, 'public/coach.html'), 'utf8');
if (!primaryCoach.includes("location.replace('/login')")) throw new Error('El Coach principal no usa el login normal.');
if (!primaryCoach.includes('/js/coach-v9-stepwise-final.js')) throw new Error('El Coach principal no carga el planificador V9 actual.');
if (!primaryCoach.includes('/js/coach-v9-session-generator-fix.js')) throw new Error('El Coach principal no carga el generador de sesiones corregido.');
if (!primaryCoach.includes('/js/coach-v9-manual-planning.js')) throw new Error('El Coach principal no carga las herramientas manuales de planificación.');
if (!primaryCoach.includes('/css/coach-v9-manual-planning.css')) throw new Error('Falta el CSS de planificación manual.');
if (!primaryCoach.includes('/js/coach-v9-contextual-recommender-v2.js')) throw new Error('El Coach principal no carga el recomendador contextual.');
if (!primaryCoach.includes('/css/coach-v9-contextual-recommender.css')) throw new Error('Falta el CSS del recomendador contextual.');
if (!primaryCoach.includes('/coach-base.html')) throw new Error('El Coach principal no conserva la base clásica durante el bootstrap.');
const sessionFix = fs.readFileSync(path.join(root, 'public/js/coach-v9-session-generator-fix.js'), 'utf8');
if (!sessionFix.includes('No se ha encontrado ninguna sesión clave compatible')) throw new Error('El generador no protege el caso de estímulo clave incompatible.');
const manual = fs.readFileSync(path.join(root, 'public/js/coach-v9-manual-planning.js'), 'utf8');
for (const marker of ['runflow.week.v1','Pegar semana RunFlow','Estimar con historial','Pistas para construir este microciclo','persistCalendarWeek']) {
  if (!manual.includes(marker)) throw new Error(`Falta capacidad manual requerida: ${marker}`);
}
if (!manual.includes('/activities?oldest=') || !manual.includes('confidence')) throw new Error('La carga personalizada no usa historial real con nivel de confianza.');
const recommender = fs.readFileSync(path.join(root, 'public/js/coach-v9-contextual-recommender-v2.js'), 'utf8');
for (const marker of ['SESIONES CONTEXTUALES','Recomendadas para este contexto','P1:','Carga asignada','Ver toda la biblioteca','Crear desde cero','dynamic-profile','/api/v9/library','activities?oldest=']) {
  if (!recommender.includes(marker)) throw new Error(`Falta capacidad del recomendador contextual: ${marker}`);
}
if (!recommender.includes('max_minutes') || !recommender.includes('mountain') || !recommender.includes('strength')) throw new Error('El recomendador no está usando las restricciones diarias de la ficha.');
const loginHtml = fs.readFileSync(path.join(root, 'public/login.html'), 'utf8');
const loginJs = fs.readFileSync(path.join(root, 'public/js/login.js'), 'utf8');
const render = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
if (!loginHtml.includes('forgotPassword') || !loginJs.includes('/api/auth/recover')) throw new Error('El login no expone la recuperación de contraseña.');
if (!render.includes('-r ./auth-recovery-hook.js')) throw new Error('El hook de recuperación no está precargado en Render.');
console.log('Sintaxis OK, biblioteca 307/307, Coach manual, recomendador contextual, carga aprendida y recuperación validados.');
