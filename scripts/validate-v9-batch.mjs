import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const syntaxFiles = [
  'v9-engine-hook.js',
  'v9-supplement-hook.js',
  'public/js/coach-v9-batch.js',
  'public/js/coach-v9-supplement.js',
  'public/js/coach-v9-season-planner.js',
  'public/js/coach-v9-season-bridge.js',
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

const stableFiles = ['public/coach.html', 'public/coach-v8.html', 'public/athlete.html'];
for (const file of stableFiles) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Falta la ruta estable ${file}.`);
}
console.log('Sintaxis V9/V2 OK y rutas estables presentes.');
