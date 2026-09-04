import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const planner = read('public/js/coach-v10-calendar-planner.js');
const styles = read('public/css/coach-v10-calendar-planner.css');
const coach = read('public/coach.html');
const beta = read('public/coach-v9.html');

for (const html of [coach, beta]) {
  assert(html.includes('/css/coach-v10-calendar-planner.css?v=10.0.0'), 'Falta cargar el CSS del planificador V10.');
  assert(html.includes('/js/coach-v10-calendar-planner.js?v=10.0.0'), 'Falta cargar el JavaScript del planificador V10.');
}

assert(planner.includes("planner.level = 'season'"), 'Falta la vista de temporada.');
assert(planner.includes("planner.level = 'meso'"), 'Falta la navegación a mesociclos.');
assert(planner.includes("planner.level = 'micro'"), 'Falta la navegación a microciclos.');
assert(planner.includes('seasonMonths(season)'), 'El planificador no representa todos los meses de la temporada.');
assert(planner.includes('RUNFLOW_V10_TECHNICAL_MACRO'), 'Falta la compatibilidad interna con macrociclos existentes.');
assert(planner.includes("schema: 'runflow.microcycle.v1'"), 'Falta la plantilla de importación de sesiones.');
assert(planner.includes('/week/publish'), 'Falta la publicación explícita de sesiones en Intervals.');
assert(planner.includes("publication_status: 'draft'"), 'La importación no protege el estado borrador.');
assert(styles.includes('.v10-season-months'), 'Faltan los estilos del calendario de temporada.');

console.log('RunFlow V10 calendar planner validation passed.');
