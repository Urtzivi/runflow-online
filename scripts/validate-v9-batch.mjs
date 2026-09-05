import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const syntaxFiles = [
  'auth-recovery-hook.js','athlete-link-recovery-hook.js','learning-api-hook.js','library-policy-hook.js','session-comparison-metrics.js','v9-engine-hook.js','v9-supplement-hook.js','public/js/login.js','public/js/activate.js',
  'public/js/coach-v9-batch.js','public/js/coach-v9-supplement.js','public/js/coach-v9-season-planner.js','public/js/coach-v9-season-bridge.js',
  'public/js/coach-v9-profile-availability.js','public/js/coach-v9-hierarchy.js','public/js/coach-v9-stepwise-final.js','public/js/coach-v9-session-generator-fix.js',
  'public/js/coach-v9-manual-planning.js','public/js/coach-v9-contextual-recommender-v2.js','public/js/coach-v9-plan-v2-import.js','public/js/coach-learning.js',
  'public/js/athlete.js','public/js/athlete-v2-beta.js','public/js/athlete-v2-complete.js','public/js/athlete-v2-fixes.js','public/js/athlete-learning.js',
];
for (const file of syntaxFiles) execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio:'inherit' });

const dataDir=path.join(root,'data');
const parts=fs.readdirSync(dataDir).filter(name=>/^runflow-v9-library\.part\d+\.b64$/.test(name)).sort((a,b)=>Number(a.match(/part(\d+)/)[1])-Number(b.match(/part(\d+)/)[1]));
if(!parts.length)throw new Error('No se encontraron partes de la biblioteca V9.');
const encoded=parts.map(name=>fs.readFileSync(path.join(dataDir,name),'utf8').trim()).join('');
const decoded=JSON.parse(zlib.gunzipSync(Buffer.from(encoded,'base64')).toString('utf8'));
const sessions=Array.isArray(decoded.s)?decoded.s:[];
if(sessions.length!==307)throw new Error(`Biblioteca V9 incompleta: ${sessions.length}/307 sesiones.`);
const ids=sessions.map(row=>row.i||row.ID).filter(Boolean);
if(ids.length!==307||new Set(ids).size!==307)throw new Error('La biblioteca V9 necesita 307 IDs únicos.');

const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const longSource=row=>/tirada larga|long run|duracion larga|larga aerobica/.test(norm(`${row.n||row.Nombre||''} ${row.f||row.Familia||''} ${row.o||row.Objetivo_primario||''}`));
const over60=sessions.filter(row=>Number(row.tm??row.Tiempo_total_min)>60&&!longSource(row));
const band45=sessions.filter(row=>!longSource(row)&&Number(row.tm??row.Tiempo_total_min)>=40&&Number(row.tm??row.Tiempo_total_min)<=50).length;
const band60=sessions.filter(row=>!longSource(row)&&Number(row.tm??row.Tiempo_total_min)>50&&Number(row.tm??row.Tiempo_total_min)<=60).length;

for(const file of ['public/coach.html','public/coach-base.html','public/coach-v8.html','public/coach-v9.html','public/athlete.html','public/athlete-base.html','public/athlete-v2.html'])if(!fs.existsSync(path.join(root,file)))throw new Error(`Falta ${file}.`);
const primaryCoach=fs.readFileSync(path.join(root,'public/coach.html'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
for(const marker of ["location.replace('/login')",'/js/coach-v9-stepwise-final.js','/js/coach-v9-session-generator-fix.js','/js/coach-v9-manual-planning.js','/js/coach-v9-contextual-recommender-v2.js','/js/coach-v9-plan-v2-import.js','/js/coach-v9-supplement.js?v=9.3.0','/css/coach-v9-plan-v2-import.css','/coach-base.html','/js/coach-learning.js?v=1.0.0'])if(!primaryCoach.includes(marker))throw new Error(`Coach principal: falta ${marker}`);

const manual=fs.readFileSync(path.join(root,'public/js/coach-v9-manual-planning.js'),'utf8');
for(const marker of ['runflow.week.v1','Pegar semana RunFlow','Estimar con historial','Pistas para construir este microciclo','persistCalendarWeek'])if(!manual.includes(marker))throw new Error(`Falta capacidad manual: ${marker}`);
const recommender=fs.readFileSync(path.join(root,'public/js/coach-v9-contextual-recommender-v2.js'),'utf8');
for(const marker of ['SESIONES CONTEXTUALES','Recomendadas para este contexto','P1:','Carga asignada','Ver toda la biblioteca','Crear desde cero','dynamic-profile','/api/v9/library','activities?oldest=','max_minutes','mountain','strength'])if(!recommender.includes(marker))throw new Error(`Falta recomendador: ${marker}`);

const importer=fs.readFileSync(path.join(root,'public/js/coach-v9-plan-v2-import.js'),'utf8');
for(const marker of ['runflow.plan.v2','RUNFLOW_PLAN_V2','Case ID:','coach_approved','Importar plan completo','goal_key','macrocycles','mesocycles','microcycles','workouts','antes de su objetivo','alreadyImported','Aprobar este plan como caso de aprendizaje'])if(!importer.includes(marker))throw new Error(`Falta capacidad importador V2: ${marker}`);
for(const route of ['/seasons','/goals','/macrocycles','/mesocycles','/microcycles'])if(!importer.includes(route))throw new Error(`El importador V2 no usa la ruta jerárquica ${route}.`);
for(const rule of ['el primer mesociclo no empieza con el macro','hay hueco o solapamiento','el último mesociclo no llega al final del macro','el último micro no llega al final del meso','está fuera de'])if(!importer.includes(rule))throw new Error(`Falta validación jerárquica V2: ${rule}`);

const athleteOfficial=fs.readFileSync(path.join(root,'public/athlete.html'),'utf8');
for(const marker of ['/athlete-base.html','/js/athlete.js?v=2.4.2.3','/js/athlete-v2-beta.js?v=2.0.3','/js/athlete-v2-complete.js?v=2.2.0','/js/athlete-v2-fixes.js?v=2.1.0','/js/athlete-learning.js?v=2.3.0','/css/athlete-learning.css?v=2.3.0',"location.replace('/login?mode=athlete')","runflowAthleteVersion='2.3-learning'"])if(!athleteOfficial.includes(marker))throw new Error(`Athlete oficial: falta ${marker}`);
if(athleteOfficial.includes('athlete-v2-beta-banner'))throw new Error('Athlete oficial no debe mostrar el banner beta.');
const athleteJs=fs.readFileSync(path.join(root,'public/js/athlete.js'),'utf8');
for(const marker of ['renderDashboardError','Error al cargar tus datos','Reintentar'])if(!athleteJs.includes(marker))throw new Error(`Athlete no conserva el error del dashboard: falta ${marker}`);
const athleteBeta=fs.readFileSync(path.join(root,'public/athlete-v2.html'),'utf8');
if(!athleteBeta.includes('/athlete-base.html')||!athleteBeta.includes('athlete-v2-beta-banner'))throw new Error('La ruta beta debe conservar su banner y usar la base preservada.');

const learningApi=fs.readFileSync(path.join(root,'learning-api-hook.js'),'utf8');
for(const marker of ['/api/v2/athlete/daily-checkin','/api/v2/athlete/pending-feedback','learning-summary','RUNFLOW_DAILY_CHECKIN','RUNFLOW_LEARNING_EVENT','baseline_mean','pre_state','feedback'])if(!learningApi.includes(marker))throw new Error(`Learning API incompleta: ${marker}`);
const coachLearning=fs.readFileSync(path.join(root,'public/js/coach-learning.js'),'utf8');
for(const marker of ['manual','imported','runflow_generated','ai_accepted','ai_modified','learning-event'])if(!coachLearning.includes(marker))throw new Error(`Captura de decisiones incompleta: ${marker}`);
const athleteLearning=fs.readFileSync(path.join(root,'public/js/athlete-learning.js'),'utf8');
for(const marker of ['Muy fatigado','Muy recuperado','daily-checkin','pending-feedback','Media personal','resetFeedbackForm'])if(!athleteLearning.includes(marker))throw new Error(`Check-in/feedback Athlete incompleto: ${marker}`);

const generator=fs.readFileSync(path.join(root,'public/js/coach-v9-session-generator-fix.js'),'utf8');
for(const marker of ['dur>60','isLongSession','targetMinutes','duration_mix','library_id','X-RunFlow-Planning-Origin'])if(!generator.includes(marker))throw new Error(`Política de duración/generación incompleta: ${marker}`);
const policy=fs.readFileSync(path.join(root,'library-policy-hook.js'),'utf8');
for(const marker of ['non_long_max_minutes:60','excluded_over_60_non_long','selection_balance_targets_min:[45,60]','No se recortan automáticamente'])if(!policy.includes(marker))throw new Error(`Política de biblioteca incompleta: ${marker}`);
const linkRecovery=fs.readFileSync(path.join(root,'athlete-link-recovery-hook.js'),'utf8');
for(const marker of ['user_id=eq.','email=ilike.','matches.length !== 1','authAdminUser','error?.status === 404','same-email auth conflict','replacing stale or mismatched auth link'])if(!linkRecovery.includes(marker))throw new Error(`Recuperación de vínculo Athlete incompleta: ${marker}`);

const loginHtml=fs.readFileSync(path.join(root,'public/login.html'),'utf8');
const loginJs=fs.readFileSync(path.join(root,'public/js/login.js'),'utf8');
const render=fs.readFileSync(path.join(root,'render.yaml'),'utf8');
if(!loginHtml.includes('forgotPassword')||!loginJs.includes('/api/auth/recover')||!render.includes('-r ./auth-recovery-hook.js'))throw new Error('Recuperación de contraseña incompleta.');
if(!render.includes('-r ./learning-api-hook.js')||!render.includes('-r ./library-policy-hook.js'))throw new Error('Los hooks de aprendizaje/biblioteca no están cargados en Render.');
for(const marker of ['optionalRows(\'perfil\'','optionalRows(\'semana\'','optionalRows(\'sesiones\'','[athlete-dashboard] semana decorada'])if(!server.includes(marker))throw new Error(`Dashboard Athlete no tolera fallos parciales: falta ${marker}`);
if(!render.includes('-r ./athlete-link-recovery-hook.js'))throw new Error('El hook de recuperación del vínculo Athlete no está cargado en Render.');

const comparisonModule=await import(`file://${path.join(root,'session-comparison-metrics.js')}`);
const comparison=comparisonModule.default||comparisonModule;
const workout={title:'VO2max 5 x 3 minutos',sport:'Run',blocks:[{type:'runflow_meta',library_id:'RF-VO2-01'}]};
const intervalActivity={avg_pace_sec_per_km:360,avg_hr:120,raw_summary:{icu_intervals:[
  {type:'WARMUP',moving_time:600,distance:1800,average_heartrate:120},
  {type:'WORK',moving_time:180,distance:750,average_heartrate:155},
  {type:'RECOVERY',moving_time:120,distance:300,average_heartrate:135},
  {type:'WORK',moving_time:180,distance:720,average_heartrate:158},
  {type:'COOLDOWN',moving_time:600,distance:1700,average_heartrate:125},
]}};
const blockMetric=comparison.metricForSession(intervalActivity,workout);
if(!blockMetric.available||blockMetric.scope!=='work_blocks'||blockMetric.work_blocks!==2)throw new Error('La comparación no está aislando los bloques de trabajo.');
if(Math.abs(blockMetric.pace_sec_per_km-244.9)>.1||Math.abs(blockMetric.avg_hr-156.5)>.1)throw new Error('Las medias ponderadas de bloques no son correctas.');
if(Math.abs(blockMetric.ratio-(blockMetric.pace_sec_per_km/blockMetric.avg_hr))>.001)throw new Error('El índice ritmo/FC no es correcto.');
const continuous=comparison.metricForSession({avg_pace_sec_per_km:300,avg_hr:150,raw_summary:{}},{title:'Rodaje Z2',sport:'Run',blocks:[]});
if(!continuous.available||continuous.scope!=='whole_activity'||continuous.ratio!==2)throw new Error('La comparación continua Z2 no usa la actividad completa.');
const identities=[
  {identity:comparison.identity({title:'VO2max 6 x 3',sport:'Run',blocks:[{type:'runflow_meta',library_id:'RF-1'}]})},
  {identity:comparison.identity({title:'VO2max 5 x 4',sport:'Run',blocks:[{type:'runflow_meta',library_id:'RF-2'}]})},
  {identity:comparison.identity({title:'VO2max 6 x 3',sport:'Run',blocks:[{type:'runflow_meta',library_id:'RF-3'}]})},
];
const sameName=comparison.findPreviousComparable(identities,2);
if(!sameName||sameName.match!=='same_name'||sameName.row!==identities[0])throw new Error('La comparación no prioriza sesiones del mismo nombre.');
const sameType=comparison.findPreviousComparable(identities,1);
if(!sameType||sameType.match!=='session_type'||sameType.row!==identities[0])throw new Error('La comparación no recurre al mismo tipo de sesión.');

console.log(`OK: 307/307 fuente; Learning V1 validado; vínculo Athlete protegido; ${over60.length} sesiones no-largas >60 se excluirán operativamente; catálogo fuente bandas 45=${band45}, 60=${band60}.`);
