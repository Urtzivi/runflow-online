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
  'public/js/coach-v9-plan-v2-import.js',
  'public/js/athlete-v2-complete.js',
  'public/js/athlete-v2-fixes.js',
];
for (const file of syntaxFiles) execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });

const dataDir = path.join(root, 'data');
const parts = fs.readdirSync(dataDir).filter(name => /^runflow-v9-library\.part\d+\.b64$/.test(name)).sort((a,b)=>Number(a.match(/part(\d+)/)[1])-Number(b.match(/part(\d+)/)[1]));
if (!parts.length) throw new Error('No se encontraron partes de la biblioteca V9.');
const encoded = parts.map(name => fs.readFileSync(path.join(dataDir, name), 'utf8').trim()).join('');
const decoded = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
const sessions = Array.isArray(decoded.s) ? decoded.s : [];
if (sessions.length !== 307) throw new Error(`Biblioteca V9 incompleta: ${sessions.length}/307 sesiones.`);
const ids = sessions.map(row => row.i || row.ID).filter(Boolean);
if (ids.length !== 307 || new Set(ids).size !== 307) throw new Error('La biblioteca V9 necesita 307 IDs únicos.');

const requiredFiles = ['public/coach.html','public/coach-base.html','public/coach-v8.html','public/coach-v9.html','public/athlete.html'];
for (const file of requiredFiles) if (!fs.existsSync(path.join(root,file))) throw new Error(`Falta ${file}.`);
const primaryCoach = fs.readFileSync(path.join(root,'public/coach.html'),'utf8');
for (const marker of ["location.replace('/login')",'/js/coach-v9-stepwise-final.js','/js/coach-v9-session-generator-fix.js','/js/coach-v9-manual-planning.js','/js/coach-v9-contextual-recommender-v2.js','/js/coach-v9-plan-v2-import.js','/css/coach-v9-plan-v2-import.css','/coach-base.html']) {
  if (!primaryCoach.includes(marker)) throw new Error(`Coach principal: falta ${marker}`);
}
const manual = fs.readFileSync(path.join(root,'public/js/coach-v9-manual-planning.js'),'utf8');
for (const marker of ['runflow.week.v1','Pegar semana RunFlow','Estimar con historial','Pistas para construir este microciclo','persistCalendarWeek']) if (!manual.includes(marker)) throw new Error(`Falta capacidad manual: ${marker}`);
const recommender = fs.readFileSync(path.join(root,'public/js/coach-v9-contextual-recommender-v2.js'),'utf8');
for (const marker of ['SESIONES CONTEXTUALES','Recomendadas para este contexto','P1:','Carga asignada','Ver toda la biblioteca','Crear desde cero','dynamic-profile','/api/v9/library','activities?oldest=','max_minutes','mountain','strength']) if (!recommender.includes(marker)) throw new Error(`Falta recomendador: ${marker}`);
const importer = fs.readFileSync(path.join(root,'public/js/coach-v9-plan-v2-import.js'),'utf8');
for (const marker of ['runflow.plan.v2','RUNFLOW_PLAN_V2','Case ID:','coach_approved','Importar plan completo','goal_key','macrociclos','mesociclos','microciclos','workouts','termina ${ma.end_date} antes de su objetivo','alreadyImported']) if (!importer.includes(marker)) throw new Error(`Falta importador V2: ${marker}`);
if (!importer.includes('/seasons') || !importer.includes('/goals') || !importer.includes('/macrocycles') || !importer.includes('/mesocycles') || !importer.includes('/microcycles')) throw new Error('El importador V2 no recorre toda la jerarquía persistente.');
const loginHtml=fs.readFileSync(path.join(root,'public/login.html'),'utf8'), loginJs=fs.readFileSync(path.join(root,'public/js/login.js'),'utf8'), render=fs.readFileSync(path.join(root,'render.yaml'),'utf8');
if (!loginHtml.includes('forgotPassword') || !loginJs.includes('/api/auth/recover') || !render.includes('-r ./auth-recovery-hook.js')) throw new Error('Recuperación de contraseña incompleta.');
console.log('OK: 307/307, Coach V9, manual, recomendador contextual, plan.v2 + casos de aprendizaje y recuperación.');
