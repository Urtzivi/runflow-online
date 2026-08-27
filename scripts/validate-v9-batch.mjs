import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const root=process.cwd();
const syntaxFiles=[
  'auth-recovery-hook.js','learning-api-hook.js','library-policy-hook.js','v9-engine-hook.js','v9-supplement-hook.js','public/js/login.js','public/js/activate.js',
  'public/js/coach-v9-batch.js','public/js/coach-v9-supplement.js','public/js/coach-v9-season-planner.js','public/js/coach-v9-season-bridge.js','public/js/coach-v9-profile-availability.js','public/js/coach-v9-hierarchy.js','public/js/coach-v9-stepwise-final.js','public/js/coach-v9-session-generator-fix.js','public/js/coach-v9-manual-planning.js','public/js/coach-v9-contextual-recommender-v2.js','public/js/coach-v9-plan-v2-import.js','public/js/coach-learning.js',
  'public/js/athlete-v2-beta.js','public/js/athlete-v2-complete.js','public/js/athlete-v2-fixes.js','public/js/athlete-learning.js'
];
for(const file of syntaxFiles){
  if(!fs.existsSync(path.join(root,file)))throw new Error(`Falta archivo: ${file}`);
  execFileSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});
}
const dataDir=path.join(root,'data');
const parts=fs.readdirSync(dataDir).filter(name=>/^runflow-v9-library\.part\d+\.b64$/.test(name)).sort((a,b)=>Number(a.match(/part(\d+)/)[1])-Number(b.match(/part(\d+)/)[1]));
if(!parts.length)throw new Error('No se encontraron partes de la biblioteca V9.');
const encoded=parts.map(name=>fs.readFileSync(path.join(dataDir,name),'utf8').trim()).join('');
const decoded=JSON.parse(zlib.gunzipSync(Buffer.from(encoded,'base64')).toString('utf8'));
const sessions=Array.isArray(decoded.s)?decoded.s:[];
if(sessions.length!==307)throw new Error(`Biblioteca V9 incompleta: ${sessions.length}/307 sesiones.`);
const ids=sessions.map(row=>row.i||row.ID).filter(Boolean);
if(ids.length!==307||new Set(ids).size!==307)throw new Error('La biblioteca V9 necesita 307 IDs únicos.');
console.log('OK diagnostic: sintaxis completa + biblioteca 307/307.');
