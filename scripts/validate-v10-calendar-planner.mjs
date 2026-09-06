import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const planner = read('public/js/coach-v10-calendar-planner.js');
const styles = read('public/css/coach-v10-calendar-planner.css');
const coach = read('public/coach.html');
const beta = read('public/coach-v9.html');
const base = read('public/coach-base.html');
const availability = read('public/js/coach-v9-profile-availability.js');
const seasonLoader = read('public/js/coach-v9-season-planner.js');
const login = read('public/js/login.js');
const loginHtml = read('public/login.html');
const server = read('server.js');
const engine = read('v9-engine-hook.js');

for (const html of [coach, beta]) {
  assert(html.includes('/css/coach-v10-calendar-planner.css?v=10.2.1'), 'Falta cargar el CSS del planificador V10.');
  assert(html.includes('/js/coach-v10-calendar-planner.js?v=10.3.0'), 'Falta cargar el JavaScript del planificador V10.');
  assert(html.includes('/js/coach-v9-profile-availability.js?v=9.4.4'), 'Falta cargar la disponibilidad semanal actualizada.');
  assert(html.includes('/js/coach-v9-season-planner.js?v=9.3.1'), 'Falta cargar la corrección de semanas del deportista.');
}

assert(planner.includes("planner.level = 'season'"), 'Falta la vista de temporada.');
assert(planner.includes("planner.level = 'meso'"), 'Falta la navegación a mesociclos.');
assert(planner.includes("planner.level = 'micro'"), 'Falta la navegación a microciclos.');
assert(planner.includes('seasonMonths(season)'), 'El planificador no representa todos los meses de la temporada.');
assert(planner.includes('Lista de mesociclos'), 'Falta la vista global de mesociclos.');
assert(planner.includes('mesocycleConflict(start, end, id)'), 'El formulario no bloquea mesociclos solapados.');
assert(planner.includes('refreshMesocycleMicrocycles'), 'Los microciclos no se recargan directamente tras guardarlos o abrir el mesociclo.');
assert(planner.includes('/microcycles`'), 'Falta la carga directa de microciclos por mesociclo.');
assert(planner.includes('RUNFLOW_V10_TECHNICAL_MACRO'), 'Falta la compatibilidad interna con macrociclos existentes.');
assert(planner.includes("schema: 'runflow.microcycle.v1'"), 'Falta la plantilla de importación de sesiones.');
assert(planner.includes('/week/publish'), 'Falta la publicación explícita de sesiones en Intervals.');
assert(planner.includes('sessionStructureErrors'), 'Falta validar la estructura publicable de cada sesión.');
assert(planner.includes('sin vídeo explicativo'), 'Las sesiones de fuerza no exigen vídeo por ejercicio.');
assert(planner.includes("publication_status: 'draft'"), 'La importación no protege el estado borrador.');
assert(styles.includes('.v10-season-months'), 'Faltan los estilos del calendario de temporada.');
assert(styles.includes('.v10-meso-overview'), 'Faltan los estilos del listado de mesociclos.');
assert(base.includes('Correo de acceso Athlete'), 'La ficha no identifica el correo de acceso del deportista.');
assert(base.includes('v9HierarchyAvailability'), 'La matriz semanal no está integrada en el cuerpo principal de la ficha.');
assert(base.includes('Notas adicionales de disponibilidad'), 'El texto libre debe distinguirse de la disponibilidad estructurada.');
for (const marker of ['activity_type', 'activity_types', 'modesFromStored', 'data-v9h-mode-secondary', 'configured: true', 'Gimnasio / fuerza externa', 'validateWorkout', 'Elige una o dos opciones para cada día']) {
  assert(availability.includes(marker), `Disponibilidad semanal incompleta: ${marker}`);
}
assert(availability.includes('v9hRetryAvailability'), 'La disponibilidad no permite reintentar si falla la carga.');
assert(availability.includes("classList.contains('active')) setTimeout(render, 50)"), 'La disponibilidad no se recarga al cambiar de deportista.');
assert(seasonLoader.includes("replace(/View$/,'')"), 'El cargador no normaliza los nombres de vista internos.');
assert(seasonLoader.includes('await loadCalendarMonth(false);lazy.week=true'), 'La semana queda bloqueada como cargada antes de recibir los datos.');
assert(seasonLoader.includes("runflow:v9-athlete-ready',()=>setTimeout(()=>lazyFor(activeViewName())"), 'La vista activa no se recarga al cambiar de deportista.');
for (const marker of ['v10AvailabilityStatus', 'validateWorkout', 'El archivo no respeta la disponibilidad']) {
  assert(planner.includes(marker), `El planificador no protege la disponibilidad: ${marker}`);
}
for (const marker of ['ATHLETE_AVAILABILITY_CONFLICT', 'assertWorkoutsFitAvailability', 'availabilityTypes', 'day.activity_types', 'synchroniseAthleteAccessEmail', 'existingProfiles']) {
  assert(server.includes(marker), `El servidor no protege ficha/planificación: ${marker}`);
}
assert(server.includes('ensureMesocycleDatesAvailable'), 'El servidor no bloquea mesociclos solapados.');
assert(server.includes("pathname === '/api/auth/athlete-email'"), 'Falta el acceso Athlete directo mediante email.');
assert(server.includes('createAthleteSessionToken'), 'Falta crear una sesión Athlete firmada.');
assert(server.includes("roles: ['athlete']"), 'La sesión directa no está limitada al rol Athlete.');
assert(login.includes('requestAthleteAccess'), 'La pantalla Athlete no solicita el acceso por email.');
assert(!login.includes('acceptMagicLink'), 'Athlete todavía depende de un enlace recibido por correo.');
assert(loginHtml.includes('/js/login.js?v=2.7.0'), 'Falta publicar la nueva pantalla de acceso Athlete.');
assert(engine.includes('dayAllowsWorkout'), 'La replanificación automática no respeta el tipo de actividad diario.');
assert(engine.includes('availabilityTypes'), 'La replanificación no respeta dos actividades permitidas en un día.');
assert(styles.includes('max-height: calc(100vh - 36px)'), 'La ficha de mesociclo puede quedar fuera de la pantalla.');
assert(styles.includes('position: sticky; bottom: 0'), 'El botón de guardado del ciclo no permanece accesible.');

console.log('RunFlow V10 planner, acceso Athlete y disponibilidad semanal validados.');
