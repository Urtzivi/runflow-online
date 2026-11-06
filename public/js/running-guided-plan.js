/*
 * RunFlow · Plan de running guiado.
 * Motor sin dependencias (coach + tests): a partir de unas pocas respuestas
 * calcula macrociclo → mesociclos → microciclos y las sesiones de cada semana
 * con la biblioteca de sesiones. Todo se puede volver a calcular desde
 * cualquier semana (replan) cuando el atleta pierde días o semanas.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunFlowRunningPlan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;
  const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const MARKER = 'RUNFLOW_GUIDED_RUN_PLAN';
  const MESO_TYPE_PREFIX = 'RUNFLOW_MESO_TYPE:';
  const PHASE_PREFIX = 'RUNFLOW_GUIDED_PHASE:';

  const iso = value => new Date(`${value}T12:00:00Z`);
  const toIso = date => date.toISOString().slice(0, 10);
  const addDays = (value, days) => toIso(new Date(iso(value).getTime() + days * DAY_MS));
  const dayIndex = value => (iso(value).getUTCDay() + 6) % 7; // 0 = lunes
  const mondayOf = value => addDays(value, -dayIndex(value));
  const nextMonday = value => (dayIndex(value) === 0 ? value : addDays(mondayOf(value), 7));
  const weeksBetween = (fromMonday, toMonday) => Math.round((iso(toMonday) - iso(fromMonday)) / (7 * DAY_MS));
  const norm = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // ---------- Fases (mesociclos) en lenguaje sencillo ----------
  const PHASES = {
    prep: {
      name: 'Preparación', type: 'base', lib: 'Preparacion', min: 0,
      goal: 'Coger rutina: rodajes suaves, técnica y algo de fuerza.',
      success: 'Hace todas las sesiones sin molestias y con sensación de que le sobra.',
      why: 'Antes de apretar, el cuerpo tiene que acostumbrarse a correr varios días por semana.',
      quality: ['Speed/Economy', 'Fartlek'],
    },
    base: {
      name: 'Base', type: 'base', lib: 'Base', min: 2,
      goal: 'Más tiempo corriendo a ritmo fácil y una tirada larga que crece poco a poco.',
      success: 'La tirada larga sale cómoda y el ritmo fácil es más rápido con el mismo esfuerzo.',
      why: 'Es el motor: cuanto más sólida la base, más se aprovecha lo que viene después.',
      quality: ['Fartlek', 'Hills', 'Progressive'],
    },
    umbral: {
      name: 'Umbral', type: 'threshold', lib: 'Desarrollo', min: 0,
      goal: 'Correr cómodo-duro durante más tiempo (RPE 6-7).',
      success: 'Aguanta los bloques a umbral sin que el último se le haga eterno.',
      why: 'El umbral es el ritmo que más se nota en carreras de 10K a maratón.',
      quality: ['Threshold'],
    },
    vo2: {
      name: 'Velocidad', type: 'vo2max', lib: 'Desarrollo', min: 0,
      goal: 'Subir el techo con series cortas y rápidas (RPE 8).',
      success: 'Completa las series manteniendo el ritmo de la primera a la última.',
      why: 'En 5K y 10K el techo aeróbico marca el ritmo que se puede sostener.',
      quality: ['VO2max', 'Speed/Economy'],
    },
    resistencia: {
      name: 'Resistencia', type: 'development', lib: 'Desarrollo', min: 0,
      goal: 'Aguantar el ritmo con cansancio acumulado.',
      success: 'El final de las tiradas largas no se cae aunque el principio haya costado.',
      why: 'En media y maratón se gana o se pierde en los últimos kilómetros.',
      quality: ['Progressive', 'Threshold', 'Durability'],
    },
    terreno: {
      name: 'Cuestas y terreno', type: 'development', lib: 'Desarrollo', min: 0,
      goal: 'Subir y bajar con fuerza y técnica.',
      success: 'Sube a ritmo constante y baja suelto, sin cargar las piernas.',
      why: 'En trail las subidas y las bajadas deciden la carrera más que el llano.',
      quality: ['Trail Hills', 'Downhill', 'Power Hiking', 'Triangular'],
    },
    especifico: {
      name: 'Específico', type: 'specific', lib: 'Especifica', min: 2,
      goal: 'Ensayar el ritmo y las condiciones de la carrera.',
      success: 'Los bloques a ritmo de carrera salen controlados.',
      why: 'Las últimas semanas duras se parecen lo más posible a la carrera.',
      quality: ['Race Specific', 'Trail Specific'],
    },
    taper: {
      name: 'Puesta a punto', type: 'taper', lib: 'Taper', min: 1,
      goal: 'Menos volumen y algo de ritmo para llegar fresco.',
      success: 'Llega a la carrera con ganas y las piernas ligeras.',
      why: 'Descansar a tiempo es parte del entrenamiento: la forma aparece cuando baja la fatiga.',
      quality: ['Taper'],
    },
  };

  // Fuerza: qué se busca en cada bloque de carrera (en palabras sencillas) y qué familias de la biblioteca usa.
  const STRENGTH = {
    prep: { name: 'Aprender', goal: 'Aprender la técnica de los ejercicios básicos y fortalecer gemelos y tronco.', families: ['General Strength', 'Core', 'Calf/Soleus'], effort: 'RPE 5-7: terminar cada serie con 3-4 repeticiones de sobra.' },
    base: { name: 'Ganar fuerza', goal: 'Ganar fuerza con poco volumen y bastante peso: es cuando más se puede mejorar.', families: ['Max Strength', 'Calf/Soleus', 'Unilateral'], effort: 'RPE 7-8: pesado pero con 1-3 repeticiones de sobra, nunca al fallo.' },
    umbral: { name: 'Fuerza a una pierna', goal: 'Pasar la fuerza a una pierna y a la zancada, con menos peso.', families: ['Unilateral', 'Plyometric'], effort: 'RPE 6-8: técnica limpia; los saltos, pocos y de calidad.' },
    vo2: { name: 'Potencia', goal: 'Convertir la fuerza en potencia: saltos y movimientos rápidos.', families: ['Power', 'Plyometric'], effort: 'Rápido y con poca carga; parar antes de perder velocidad.' },
    resistencia: { name: 'Fuerza-resistencia', goal: 'Que las piernas aguanten la fatiga del final de carrera.', families: ['Strength Endurance', 'Unilateral'], effort: 'RPE 6-8: cargas moderadas y más repeticiones.' },
    terreno: { name: 'Fuerza para montaña', goal: 'Bajadas: fuerza excéntrica (frenar) y saltos para proteger cuádriceps y tobillos.', families: ['Trail Eccentric', 'Plyometric'], effort: 'RPE 6-8: bajar lento (2-4 segundos).' },
    especifico: { name: 'Mantener', goal: 'Mantener lo ganado sin cansar: poco volumen.', families: ['Maintenance', 'Plyometric'], effort: 'RPE 5-7: pocas series, lejos del fallo.', max: 1 },
    taper: { name: 'Activar', goal: 'Una sesión corta para mantener la chispa; la semana de carrera, nada.', families: ['Maintenance', 'Core'], effort: 'RPE 5-6: muy poco volumen.', max: 1 },
  };
  const EQUIPMENT = {
    gimnasio: { label: 'Gimnasio', hint: 'Barra, mancuernas y máquinas.' },
    casa: { label: 'En casa con mancuernas', hint: 'Mancuernas o kettlebell, gomas y un cajón o escalón.' },
    sin_material: { label: 'Sin material', hint: 'Peso corporal, un escalón y el suelo.' },
    gimnasio_guiado: { label: 'Gimnasio con entrenador', hint: 'Clase o entrenador del gimnasio. RunFlow marca el día y qué toca; los ejercicios los pone él.' },
  };
  const FAMILY_ES = {
    'General Strength': 'fuerza general de todo el cuerpo', Core: 'tronco (core)', 'Calf/Soleus': 'gemelos y sóleo',
    'Max Strength': 'fuerza máxima de piernas (pocas repeticiones con peso alto)', Unilateral: 'ejercicios a una pierna (zancadas, step-up, peso muerto a una pierna)',
    Plyometric: 'saltos cortos (pliometría)', Power: 'potencia (movimientos rápidos con poca carga)', 'Strength Endurance': 'fuerza-resistencia (más repeticiones, carga moderada)',
    'Trail Eccentric': 'excéntricos para bajadas (bajar lento)', Maintenance: 'mantenimiento con poco volumen',
  };
  // Qué puede hacer cada día. Un día admite varias a la vez.
  const ACTIVITIES = { run: 'Correr', trail: 'Trail', bike: 'Bici', strength: 'Fuerza', walk: 'Paseo' };
  function dayTypes(day) {
    if (Array.isArray(day?.types)) return day.types.filter(type => ACTIVITIES[type]);
    if (!(Number(day?.minutes) > 0)) return [];
    return ['run', ...(day.trail ? ['trail'] : []), ...(day.strength !== false ? ['strength'] : [])];
  }
  const canDo = (day, type) => Number(day?.minutes) > 0 && dayTypes(day).includes(type);
  const runsOn = day => canDo(day, 'run') || canDo(day, 'trail');
  function equipmentOk(row, equipment) {
    const mat = norm(row.material);
    if (equipment === 'casa') return !mat.startsWith('gimnasio;');
    if (equipment === 'sin_material') return /^(peso corporal|gomas|escalon|suelo)/.test(mat);
    return true;
  }
  const STRENGTH_RULES = [
    'Nunca el día antes de una sesión de calidad o de la tirada larga.',
    'Mejor en un día de rodaje fácil. Si no hay, el mismo día de la calidad, después de correr.',
    'Al menos un día entre dos sesiones de fuerza.',
    'En semanas de descarga, una sola sesión y más ligera. La semana de la carrera, nada.',
  ];
  /*
   * Recorrido de la carrera: km y desnivel positivo que mete el entrenador (o los del tipo de carrera).
   * hilly: 15 m+ por km o más (p. ej. una media con 300 m+): el plan mete cuestas y fuerza excéntrica.
   */
  function courseOf(answers) {
    const race = RACES[answers?.race];
    const km = Number(answers?.race_km) > 0 ? Math.round(Number(answers.race_km) * 10) / 10 : race ? race.distance_km : 0;
    const elevation = Math.max(0, Math.round(Number(answers?.race_elevation) || 0));
    const perKm = km ? elevation / km : 0;
    return { km, elevation, perKm, hilly: perKm >= 15, steep: perKm >= 40 };
  }
  function courseText(course) {
    return `${String(course.km).replace('.', ',')} km${course.elevation ? ` y ${course.elevation} m de desnivel positivo` : ''}`;
  }
  function strengthPlanFor(answers, race, phaseKey, weekType) {
    const chosen = Number(answers.strength) || 0;
    const base = STRENGTH[phaseKey] || STRENGTH.base;
    let families = (race.trail || courseOf(answers).hilly) && ['umbral', 'vo2', 'resistencia'].includes(phaseKey) ? ['Trail Eccentric', ...base.families] : base.families;
    if (answers.level === 'nuevo' && ['base', 'vo2'].includes(phaseKey)) families = ['General Strength', 'Unilateral', 'Calf/Soleus'];
    let perWeek = Math.min(chosen, base.max || 2);
    if (weekType === 'deload') perWeek = Math.min(perWeek, 1);
    if (weekType === 'recovery') { perWeek = answers.strength ? 1 : 0; families = ['Core', 'General Strength']; }
    if (weekType === 'competition') perWeek = 0;
    return { ...base, families, perWeek };
  }

  const RACES = {
    '5K': { label: '5K', article: 'el 5K', distance_km: 5, lib: '5K', taper: 1, route: [['prep', 1], ['base', 3], ['umbral', 2], ['vo2', 3], ['especifico', 2]], zone: 'Z5' },
    '10K': { label: '10K', article: 'el 10K', distance_km: 10, lib: '10K', taper: 1, route: [['prep', 1], ['base', 3], ['umbral', 3], ['vo2', 2], ['especifico', 2]], zone: 'Z4-Z5' },
    media: { label: 'Media maratón', article: 'la media maratón', distance_km: 21.1, lib: 'Media', taper: 1, route: [['prep', 1], ['base', 4], ['umbral', 3], ['resistencia', 2], ['especifico', 3]], zone: 'Z4', longCap: 120 },
    maraton: { label: 'Maratón', article: 'el maratón', distance_km: 42.2, lib: 'Maraton', taper: 2, route: [['prep', 1], ['base', 4], ['umbral', 2], ['resistencia', 3], ['especifico', 3]], zone: 'Z3', longCap: 180 },
    trail_corto: { label: 'Trail corto', article: 'el trail corto', distance_km: 21, lib: 'Trail corto', taper: 1, trail: true, route: [['prep', 1], ['base', 3], ['umbral', 2], ['terreno', 3], ['especifico', 2]], zone: 'Z3-Z4', longCap: 150 },
    trail_largo: { label: 'Trail largo', article: 'el trail largo', distance_km: 42, lib: 'Trail largo', taper: 2, trail: true, route: [['prep', 1], ['base', 4], ['terreno', 3], ['resistencia', 3], ['especifico', 3]], zone: 'Z3', longCap: 240 },
  };

  const LEVELS = {
    nuevo: { label: 'Empieza a correr', maxLib: 2, weeklyCap: 210, quality: 1, cycle: 3, prepWeight: 2 },
    regular: { label: 'Corre con regularidad', maxLib: 3, weeklyCap: 330, quality: 1, cycle: 4, prepWeight: 1 },
    experto: { label: 'Tiene experiencia', maxLib: 5, weeklyCap: 540, quality: 2, cycle: 4, prepWeight: 0 },
  };

  // Tipo de semana → % del tiempo disponible y explicación para el coach (y el atleta).
  const WEEK_TYPES = {
    adaptation: { label: 'Adaptación', pct: 0.65, rpe: 3.5, why: 'Semana de entrada: el cuerpo se acostumbra a la rutina.' },
    load: { label: 'Carga', pct: 0.75, rpe: 4.2, why: 'Semana de trabajo normal.' },
    development: { label: 'Construcción', pct: 0.85, rpe: 4.4, why: 'Sube un poco el volumen respecto a la anterior.' },
    overload: { label: 'Sobrecarga', pct: 0.95, rpe: 4.6, why: 'La semana más exigente del bloque.' },
    deload: { label: 'Descarga', pct: 0.6, rpe: 3.4, why: 'Se baja el volumen para asimilar lo trabajado.' },
    recovery: { label: 'Vuelta suave', pct: 0.45, rpe: 3, why: 'Vuelta tras unos días parado: todo suave y sin intensidad.' },
    taper: { label: 'Afinamiento', pct: 0.6, rpe: 3.8, why: 'Menos volumen y algo de ritmo para llegar fresco.' },
    competition: { label: 'Competición', pct: 0.4, rpe: 3.5, why: 'Semana de carrera: poco volumen, mucho descanso.' },
  };

  const REASONS = {
    trabajo: 'Trabajo o viaje',
    dolor: 'Dolor o lesión',
    enfermedad: 'Enfermedad',
    otro: 'Otro motivo',
  };

  const RPE_TEXT = [
    [2, 'muy suave, respiras como andando'],
    [4, 'puedes hablar con frases completas'],
    [6, 'puedes hablar a frases cortas'],
    [7, 'cómodo-duro, solo palabras sueltas'],
    [8, 'duro, no puedes hablar'],
    [10, 'máximo esfuerzo'],
  ];
  function rpeExplain(text) {
    const match = String(text || '').match(/RPE\s*(\d+(?:[.,]\d+)?)(?:\s*-\s*(\d+))?/i);
    if (!match) return '';
    const top = Number(match[2] || match[1]);
    const label = (RPE_TEXT.find(([limit]) => top <= limit) || RPE_TEXT[RPE_TEXT.length - 1])[1];
    return `RPE ${match[2] ? `${match[1]}-${match[2]}` : match[1]} de 10: ${label}`;
  }

  // ---------- Reparto de semanas ----------
  function distribute(total, items) {
    // items: [{key, weight, min}] → semanas por fase (largest remainder, respetando mínimos).
    const out = items.map(item => ({ ...item, weeks: 0 }));
    if (total <= 0) return out;
    let left = total;
    // Primero los mínimos, empezando por las fases protegidas (las últimas).
    for (let i = out.length - 1; i >= 0 && left > 0; i--) {
      const take = Math.min(out[i].min || 0, left);
      out[i].weeks = take; left -= take;
    }
    if (left <= 0) return out;
    const weightSum = out.reduce((sum, item) => sum + item.weight, 0) || 1;
    const shares = out.map(item => Math.max(0, item.weight / weightSum * total - item.weeks));
    const shareSum = shares.reduce((a, b) => a + b, 0) || 1;
    const exact = shares.map(share => share / shareSum * left);
    const floors = exact.map(Math.floor);
    floors.forEach((value, i) => { out[i].weeks += value; });
    let rest = left - floors.reduce((a, b) => a + b, 0);
    const order = exact.map((value, i) => ({ i, r: value - Math.floor(value), w: out[i].weight })).sort((a, b) => b.r - a.r || b.w - a.w || b.i - a.i);
    for (const entry of order) { if (rest <= 0) break; out[entry.i].weeks += 1; rest -= 1; }
    return out;
  }

  /*
   * buildStructure: calcula mesociclos y microciclos desde `startDate` hasta la carrera.
   * Opciones para recalcular a mitad de temporada:
   *   phaseFrom: fase por la que se reanuda (se saltan las anteriores)
   *   leadWeeks: semanas fijas al principio, p. ej. [{ type: 'recovery', reason: 'dolor' }]
   */
  function buildStructure(answers, options = {}) {
    const race = RACES[answers.race];
    if (!race) throw new Error('Elige la carrera objetivo.');
    if (!answers.race_date) throw new Error('Indica la fecha de la carrera.');
    const level = LEVELS[answers.level] || LEVELS.regular;
    const start = nextMonday(options.startDate || answers.start_date);
    const raceMonday = mondayOf(answers.race_date);
    const totalWeeks = weeksBetween(start, raceMonday) + 1;
    const warnings = [];
    if (totalWeeks < 1) throw new Error('La carrera es antes de la primera semana del plan.');

    const lead = (options.leadWeeks || []).slice(0, Math.max(0, totalWeeks - 1));
    const taperWeeks = Math.min(race.taper, totalWeeks - lead.length);
    const buildWeeks = Math.max(0, totalWeeks - lead.length - taperWeeks);

    let route = race.route.map(([key, weight]) => ({ key, weight: key === 'prep' ? level.prepWeight : weight, min: PHASES[key].min }));
    if (options.phaseFrom && options.phaseFrom !== 'taper') {
      const index = route.findIndex(item => item.key === options.phaseFrom);
      if (index > 0) route = route.slice(index);
    } else if (options.phaseFrom === 'taper') route = [];
    route = route.filter(item => item.weight > 0 || item.min > 0);
    const phases = distribute(buildWeeks, route).filter(item => item.weeks > 0);
    // Un bloque de 1 semana no da para nada: se junta con el siguiente (o con el anterior si es el último).
    for (let i = 0; i < phases.length; i++) {
      if (phases[i].weeks !== 1 || phases[i].key === 'prep' || phases.length === 1) continue;
      const target = phases[i + 1] || phases[i - 1];
      target.weeks += 1; phases.splice(i, 1); i -= 1;
    }
    phases.push({ key: 'taper', weeks: taperWeeks });

    if (totalWeeks < race.taper + 4) warnings.push(`Quedan ${totalWeeks} semanas: es poco para preparar ${race.article} con garantías. Valora cambiar el objetivo a terminarla o elegir una carrera más adelante.`);
    if (totalWeeks > 30) warnings.push(`Faltan ${totalWeeks} semanas: es mucho tiempo. Puedes empezar más tarde o meter una carrera intermedia como objetivo B.`);
    const cut = route.filter(item => !phases.some(p => p.key === item.key));
    if (cut.length && totalWeeks >= race.taper + 2) warnings.push(`No da tiempo a todo: se ha quitado ${cut.map(item => PHASES[item.key].name).join(', ')} para proteger el bloque específico y la puesta a punto.`);

    // Semanas
    const weeks = [];
    let cursor = start, sinceDeload = 0, first = !options.phaseFrom;
    const pushWeek = (phaseKey, type, extra = {}) => {
      weeks.push({ index: weeks.length + 1, start: cursor, end: addDays(cursor, 6), phase: phaseKey, type, ...extra });
      cursor = addDays(cursor, 7);
    };
    const leadPhase = phases[0]?.key || 'taper';
    lead.forEach(item => { pushWeek(leadPhase, item.type || 'recovery', { reason: item.reason || '' }); sinceDeload = 0; first = false; });
    phases.forEach(phase => {
      for (let i = 0; i < phase.weeks; i++) {
        if (phase.key === 'taper') { pushWeek('taper', i === phase.weeks - 1 ? 'competition' : 'taper'); continue; }
        const isLastBuild = phase === phases[phases.length - 2] && i === phase.weeks - 1;
        let type;
        if (first) { type = 'adaptation'; first = false; sinceDeload = 1; }
        else if (sinceDeload >= level.cycle - 1 && !isLastBuild) { type = 'deload'; sinceDeload = 0; }
        else if (isLastBuild && sinceDeload >= level.cycle - 1) { type = 'development'; sinceDeload += 1; }
        else { type = ['load', 'development', 'overload'][Math.min(sinceDeload, level.cycle - 2)]; sinceDeload += 1; }
        pushWeek(phase.key, type);
      }
    });

    // Volumen semanal en minutos
    const available = (answers.days || []).filter(runsOn).reduce((sum, day) => sum + (Number(day.minutes) || 0), 0);
    const capacity = Math.max(60, Math.min(available || level.weeklyCap, level.weeklyCap));
    weeks.forEach(week => {
      const info = WEEK_TYPES[week.type];
      const phaseFactor = week.phase === 'prep' ? 0.85 : 1;
      week.minutes = Math.round(capacity * info.pct * phaseFactor / 5) * 5;
      week.hours = Math.round(week.minutes / 6) / 10;
      week.load = Math.round(week.minutes * info.rpe);
      week.label = info.label;
      week.strength_sessions = strengthPlanFor(answers, race, week.phase, week.type).perWeek;
      week.why = week.reason ? `${REASONS[week.reason] ? `${REASONS[week.reason]}. ` : ''}${info.why}` : info.why;
      const race2 = (answers.other_races || []).find(item => item.date >= week.start && item.date <= week.end);
      if (race2) week.b_race = race2;
    });
    // Punto de partida: si en las últimas semanas corría bastante menos de lo que permite su
    // disponibilidad, el plan empieza cerca de lo que venía haciendo y sube como mucho un 10 % por semana.
    const history = Number(answers.history_minutes) || 0;
    if (history > 0 && !options.phaseFrom && !lead.length) {
      let ceiling = Math.max(60, Math.round(history * 1.1));
      let ramped = 0;
      weeks.forEach(week => {
        if (['taper', 'competition'].includes(week.type)) return;
        if (week.minutes > ceiling) {
          week.minutes = Math.round(ceiling / 5) * 5;
          week.hours = Math.round(week.minutes / 6) / 10;
          week.load = Math.round(week.minutes * WEEK_TYPES[week.type].rpe);
          week.why = `Sube poco a poco desde lo que venía corriendo (≈ ${Math.round(history)} min por semana). ${week.why}`;
          ramped += 1;
        }
        if (!['deload', 'recovery'].includes(week.type)) ceiling = Math.round(ceiling * 1.1);
      });
      if (ramped) warnings.push(`Venía corriendo ≈ ${Math.round(history)} min por semana: las ${ramped === 1 ? 'primera semana sube' : `${ramped} primeras semanas suben`} poco a poco (como mucho un 10 % cada semana) para no lesionarse.`);
    }

    // Regla 3: el volumen no sube más de un 10 % sobre la semana más alta anterior (las de descarga no cuentan).
    let peak = 0;
    weeks.forEach(week => {
      if (['deload', 'recovery', 'taper', 'competition'].includes(week.type)) return;
      const cap = peak ? Math.round(peak * 1.1 / 5) * 5 : Infinity;
      if (week.minutes > cap) {
        week.minutes = cap;
        week.hours = Math.round(week.minutes / 6) / 10;
        week.load = Math.round(week.minutes * WEEK_TYPES[week.type].rpe);
      }
      peak = Math.max(peak, week.minutes);
    });
    // La puesta a punto siempre por debajo de la semana más alta (si el inicio se frenó por el historial, también).
    weeks.forEach(week => {
      const share = { taper: 0.75, competition: 0.5 }[week.type];
      if (!share || !peak || week.minutes < peak) return;
      week.minutes = Math.max(30, Math.round(peak * share / 5) * 5);
      week.hours = Math.round(week.minutes / 6) / 10;
      week.load = Math.round(week.minutes * WEEK_TYPES[week.type].rpe);
    });

    const mesos = [];
    phases.forEach(phase => {
      const own = weeks.filter(week => week.phase === phase.key);
      if (!own.length) return;
      mesos.push({ key: phase.key, ...PHASES[phase.key], start: own[0].start, end: own[own.length - 1].end, weeks: own, strength: strengthPlanFor(answers, race, phase.key, 'load') });
    });
    // Las semanas de vuelta van dentro del primer mesociclo.
    if (lead.length && mesos.length) {
      const leadWeeksList = weeks.slice(0, lead.length);
      const target = mesos[0];
      target.weeks = [...leadWeeksList, ...target.weeks.filter(week => !leadWeeksList.includes(week))];
      target.start = leadWeeksList[0].start;
    }

    const goalText = answers.goal_mode === 'marca' && answers.target_time ? `bajar de ${answers.target_time}` : 'terminarla bien';
    return {
      race, level, start, end: addDays(raceMonday, 6), race_date: answers.race_date, totalWeeks, mesos, weeks, warnings,
      course: courseOf(answers),
      summary: `Tienes ${totalWeeks} ${totalWeeks === 1 ? 'semana' : 'semanas'} hasta ${race.article} (${courseText(courseOf(answers))}) con el objetivo de ${goalText}. `
        + (courseOf(answers).hilly ? 'Como tiene mucho desnivel, las tiradas largas irán con cuestas y la fuerza trabajará las bajadas. ' : '')
        + (mesos.length > 1 ? `${sequenceText(mesos.filter(m => m.key !== 'taper').map(m => m.name.toLowerCase()))} ${race.taper === 1 ? 'La última semana' : `Las ${race.taper} últimas semanas`} se baja el volumen para llegar fresco.` : 'Solo queda tiempo para la puesta a punto.'),
    };
  }

  function sequenceText(names) {
    if (names.length === 1) return `Todo el plan es de ${names[0]}.`;
    const rest = names.slice(1);
    return `Primero ${names[0]}, luego ${rest.length > 1 ? `${rest.slice(0, -1).join(', ')} y ${rest[rest.length - 1]}` : rest[0]}.`;
  }
  const towards = race => race.article.startsWith('el ') ? `al ${race.article.slice(3)}` : `a ${race.article}`;

  /*
   * replan: el atleta ha perdido semanas. Devuelve la estructura desde `fromDate` (lunes de vuelta).
   * Reglas: la fecha de la carrera no se mueve; dolor o enfermedad → semana de vuelta suave;
   * 3 o más semanas fuera → un paso atrás de fase; la puesta a punto y el específico se protegen.
   */
  function replan(answers, info) {
    const race = RACES[answers.race];
    const lostWeeks = Math.max(0, Number(info.lost_weeks) || 0);
    const route = race.route.map(([key]) => key);
    let phaseFrom = info.current_phase || route[0];
    const lead = [];
    if (['dolor', 'enfermedad'].includes(info.reason)) lead.push({ type: 'recovery', reason: info.reason });
    else if (lostWeeks >= 1) lead.push({ type: 'adaptation', reason: info.reason || 'otro' });
    if (lostWeeks >= 3) {
      const index = route.indexOf(phaseFrom);
      if (index > 0) phaseFrom = route[index - 1];
    }
    const result = buildStructure(answers, { startDate: info.from_date, phaseFrom, leadWeeks: lead });
    result.explanation = [
      `Se reanuda el ${formatDate(result.start)} con ${result.totalWeeks} semanas hasta la carrera.`,
      lead.length ? `La primera semana es "${WEEK_TYPES[lead[0].type].label}": ${WEEK_TYPES[lead[0].type].why}` : '',
      lostWeeks >= 3 ? `Como ha estado ${lostWeeks} semanas fuera, se vuelve un paso atrás a ${PHASES[phaseFrom].name}.` : '',
      ['dolor'].includes(info.reason) ? 'Antes de volver a meter intensidad, comprueba que el dolor ha desaparecido.' : '',
    ].filter(Boolean).join(' ');
    return result;
  }

  // ---------- Sesiones ----------
  function libRow(row) {
    const r = row || {};
    return {
      id: r.ID || r.i, name: r.Nombre || r.n, discipline: r.Disciplina || r.d, family: r.Familia || r.f,
      objective: r.Objetivo_primario || r.o, phases: norm(r.Fases || r.ph), goals: norm(r.Objetivos_prueba || r.g),
      level: Number(r.Nivel_1_5 || r.lv) || 3, minutes: Number(r.Tiempo_total_min || r.tm) || 0,
      warmup: Number(r.Calentamiento || r.wu) || 0, main: r.Bloque_principal || r.bp || '', cooldown: Number(r.Vuelta_calma || r.cd) || 0,
      intensity: r.Intensidad_prescrita || r.int || '', terrain: r.Terreno || r.ter || '', ok: r.Criterio_exito || r.ok || '',
      adjust: r.Regla_ajuste || r.adj || '', material: r.Material || r.mat || '', avoid: r.No_usar_si || r.no || '', load: Number(r.Carga_sRPE_est || r.l) || 0,
    };
  }
  const isStrengthRow = row => /fuerza|strength/.test(norm(row.discipline));
  const isTrailRow = row => /trail|downhill|power hiking|triangular/.test(norm(row.family)) || /trail/.test(norm(row.name));

  const ZONES = {
    Recovery: 'Z1', Easy: 'Z2', 'Long Run': 'Z2', 'Long Trail': 'Z2', Progressive: 'Z3', Fartlek: 'Z4', 'Speed/Economy': 'Z5', Hills: 'Z5',
    Threshold: 'Z4', VO2max: 'Z5', 'Trail Hills': 'Z4', Downhill: 'Z3', Triangular: 'Z4', 'Trail Specific': 'Z3-Z4', Durability: 'Z3', 'Power Hiking': 'Z3', Taper: 'Z3',
  };

  function parseMain(text) {
    const value = String(text || '').replace(/’/g, "'").replace(/”/g, '"');
    const reps = value.match(/^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(''|"|'|\s?km\b|K\b|m\b)/i);
    if (reps) {
      const unitRaw = reps[3].trim().toLowerCase();
      const unit = unitRaw === "''" || unitRaw === '"' ? 's' : unitRaw === "'" ? 'm' : unitRaw === 'm' ? 'mtr' : 'km';
      let workValue = Number(reps[2]), workUnit = unit;
      // Metros → km: así Intervals lo entiende y la duración no se confunde con minutos.
      if (unit === 'mtr') { workValue = workValue / 1000; workUnit = 'km'; }
      const rec = value.match(/rec(?:uperacion)?\s*(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?\s*(''|"|')/i);
      return { repetitions: Number(reps[1]), work_value: workValue, work_unit: workUnit, recovery_value: rec ? Number(rec[1]) : 0, recovery_unit: rec ? (rec[2] === "'" ? 'm' : 's') : 'm' };
    }
    const steady = value.match(/^(\d+)\s*'\s/);
    if (steady && !/\+/.test(value)) return { repetitions: 1, work_value: Number(steady[1]), work_unit: 'm', recovery_value: 0, recovery_unit: 'm' };
    return null;
  }

  function sessionFromRow(row, date, options = {}) {
    const strength = isStrengthRow(row);
    const rpe = rpeExplain(row.intensity);
    const zone = options.zone || ZONES[row.family] || 'Z2';
    const blocks = [];
    if (!strength) {
      const main = parseMain(row.main);
      const mainMinutes = Math.max(5, row.minutes - row.warmup - row.cooldown);
      if (row.warmup) blocks.push({ type: 'warmup', duration_min: row.warmup, target: 'Z1-Z2' });
      if (main) blocks.push({ type: 'central', name: row.main.slice(0, 90), ...main, target: zone, recovery_target: 'Z1' });
      else blocks.push({ type: 'steady', name: row.main.slice(0, 90) || 'Bloque principal', duration_min: mainMinutes, target: zone });
      if (row.cooldown) blocks.push({ type: 'cooldown', duration_min: row.cooldown, target: 'Z1' });
    }
    blocks.push({ type: 'runflow_meta', library_id: row.id || null, library_version: 'Biblioteca RunFlow de Sesiones v1', guided_plan: true });
    const lines = [
      row.warmup && `Calentamiento: ${row.warmup}' suave`,
      row.main && `Bloque principal: ${row.main}`,
      row.cooldown && `Vuelta a la calma: ${row.cooldown}' suave`,
      row.intensity && `Intensidad: ${row.intensity}`,
      rpe && `Cómo debe sentirse: ${rpe}`,
      row.ok && `Ha ido bien si: ${row.ok}`,
      row.adjust && `Si cuesta demasiado: ${row.adjust}`,
    ].filter(Boolean);
    return {
      sport: strength ? 'Strength' : 'Run',
      is_strength: strength,
      title: options.title || row.name,
      priority: options.priority || 'C',
      workout_date: date,
      planned_duration_min: row.minutes || null,
      planned_load: Math.min(1000, Math.round(row.load || 0)),
      session_objective: options.objective || row.objective || '',
      adaptation_target: row.family || '',
      summary: [options.role, rpe || row.intensity].filter(Boolean).join(' · '),
      structured_description: lines.join('\n'),
      blocks,
      runflow_library_id: row.id || null,
    };
  }

  function pickRow(rows, filter, progress, maxLevel, minutesLimit, used) {
    let pool = rows.filter(row => filter(row) && row.level <= maxLevel && (!minutesLimit || row.minutes <= minutesLimit));
    if (!pool.length) return null;
    const fresh = pool.filter(row => !used.has(row.id));
    if (fresh.length) pool = fresh;
    pool.sort((a, b) => a.level - b.level || a.minutes - b.minutes);
    return pool[Math.min(pool.length - 1, Math.floor(progress * pool.length))];
  }

  /*
   * Sesiones de una semana. days: [{ day: 0-6, minutes, types: ['run', 'trail', 'bike', 'strength', 'walk'] }]
   */
  const HILL_PHASES = ['umbral', 'terreno', 'resistencia', 'especifico'];
  const LONG_SHARE = 0.35; // regla 10: la tirada larga, como mucho el 35 % del tiempo de la semana
  const HARD_SHARE = { nuevo: 0.15, regular: 0.2, experto: 0.2 }; // regla 9: 80/20
  const hardMinutes = row => Math.max(0, (row.minutes || 0) - (row.warmup || 0) - (row.cooldown || 0));
  function buildWeekSessions(answers, structure, week, libraryRows) {
    const rows = (libraryRows || []).map(libRow).filter(row => row.id && row.name);
    const race = structure.race, level = structure.level, phase = PHASES[week.phase];
    const course = courseOf(answers);
    let allDays = (answers.days || []).filter(day => Number(day.minutes) > 0).sort((a, b) => a.day - b.day);
    // Regla 11: al menos un día de descanso completo (salvo atletas con experiencia). Mejor el día después de la tirada larga.
    if (allDays.length >= 7 && answers.level !== 'experto') {
      const longD = Number(answers.long_day);
      const rest = allDays.filter(day => day.day !== longD && !(day.gym && day.strength_minutes))
        .sort((a, b) => Number(b.day === (longD + 1) % 7) - Number(a.day === (longD + 1) % 7) || a.minutes - b.minutes)[0];
      allDays = allDays.filter(day => day !== rest);
    }
    const trainDays = allDays.filter(runsOn);
    if (!trainDays.length) return [];
    const phaseWeeks = structure.weeks.filter(item => item.phase === week.phase);
    const progress = phaseWeeks.length > 1 ? phaseWeeks.indexOf(week) / (phaseWeeks.length - 1) : 0.5;
    const used = new Set();
    const sessions = [];
    const dateOf = day => addDays(week.start, day);
    const raceDay = week.type === 'competition' ? dayIndex(structure.race_date) : -1;
    const daysUsable = trainDays.filter(day => raceDay < 0 || day.day < raceDay - 1);
    const goalOk = row => row.goals.includes(norm(race.lib));
    const phaseOk = row => row.phases.includes(norm(phase.lib));
    const allowTrail = day => race.trail && canDo(day, 'trail');
    const trailOnly = day => canDo(day, 'trail') && !canDo(day, 'run');
    const runFilter = (day, extra) => row => !isStrengthRow(row) && goalOk(row) && (allowTrail(day) || !isTrailRow(row)) && extra(row);
    // Sesión doble suave (p. ej. fuerza guiada + trote de descarga): ni tirada larga ni calidad ese día.
    const easyOnly = day => Boolean(day?.double && day?.extra_easy);
    const hardUsable = daysUsable.filter(day => !easyOnly(day));

    // 1) Tirada larga (desde la base; no en descarga ni en semana de carrera)
    const longDay = hardUsable.find(day => day.day === Number(answers.long_day)) || hardUsable.slice().sort((a, b) => b.minutes - a.minutes)[0];
    const quietWeek = ['recovery', 'competition'].includes(week.type);
    const plan = new Map();
    if (longDay && !quietWeek && week.phase !== 'taper') {
      const family = race.trail && allowTrail(longDay) ? 'Long Trail' : 'Long Run';
      // Si la carrera es más larga que la típica de su tipo, la tirada larga puede crecer (hasta +40 %).
      const longCap = Math.round((race.longCap || 100) * Math.min(1.4, Math.max(1, course.km / race.distance_km)));
      const cap = Math.min(longDay.minutes, longCap, week.type === 'deload' ? 75 : 999, Math.max(40, Math.round(week.minutes * LONG_SHARE)));
      const row = week.phase === 'prep'
        ? pickRow(rows, runFilter(longDay, r => r.family === 'Easy'), 1, level.maxLib, cap, used)
        : pickRow(rows, runFilter(longDay, r => r.family === family), progress, Math.min(5, level.maxLib + 1), cap, used)
          || pickRow(rows, runFilter(longDay, r => r.family === 'Easy'), 1, 5, cap, used);
      if (row) { used.add(row.id); plan.set(longDay.day, { row, role: 'Tirada larga', priority: 'A', objective: 'Resistencia: aguantar más tiempo a ritmo cómodo.' }); }
    }

    // 2) Sesiones de calidad
    let qualityCount = week.b_race ? 0 : level.quality;
    if (answers.goal_mode !== 'marca') qualityCount = Math.min(qualityCount, 1);
    if (trainDays.length <= 3) qualityCount = Math.min(qualityCount, 1);
    if (week.easier) qualityCount = Math.min(qualityCount, 1); // semana aligerada por cómo viene el atleta
    if (['recovery', 'competition'].includes(week.type)) qualityCount = week.type === 'competition' ? 1 : 0;
    if (week.type === 'deload') qualityCount = Math.min(qualityCount, 1);
    if (week.phase === 'prep' && answers.level === 'nuevo') qualityCount = 0;
    // Regla 13: los 2 días siguientes a una carrera de preparación no llevan series.
    const afterRace = day => (answers.other_races || []).some(r => r.date && r.date < dateOf(day.day) && dateOf(day.day) <= addDays(r.date, 2));
    // Fuerza de la semana y días en los que cabe, según dónde caigan las sesiones duras.
    const sp = strengthPlanFor(answers, race, week.phase, week.type);
    const strengthEligible = allDays.filter(day => canDo(day, 'strength') && (raceDay < 0 || day.day < raceDay - 2));
    // Fuerza guiada en el gimnasio: cita fija de la ficha (salvo la semana de la carrera).
    const fixedGym = week.type === 'competition' ? [] : strengthEligible.filter(day => day.gym && day.strength_minutes);
    const afterGym = day => fixedGym.some(gym => gym.day === day.day - 1);
    let free = hardUsable.filter(day => !plan.has(day.day) && !afterRace(day));
    // Mejor que la calidad no caiga el día siguiente al gimnasio, si hay otros días.
    if (free.filter(day => !afterGym(day)).length >= Math.min(qualityCount, free.length)) free = free.filter(day => !afterGym(day));
    const strengthDaysFor = quality => {
      if (fixedGym.length) {
        const chosen = fixedGym.slice();
        const extra = strengthEligible.filter(day => !day.gym && !quality.some(q => q.day === day.day + 1) && !chosen.some(other => Math.abs(other.day - day.day) < 2));
        for (const day of extra) { if (chosen.length >= sp.perWeek) break; chosen.push(day); }
        return chosen;
      }
      if (!sp.perWeek) return [];
      const hard = new Set([...quality.map(d => d.day), longDay && plan.has(longDay.day) ? longDay.day : undefined].filter(d => d !== undefined));
      // Regla: nunca el día antes de una sesión de calidad o de la tirada larga.
      // Primero un día solo de fuerza o de rodaje fácil; si no hay, el mismo día de la calidad (después de correr) salvo en atletas que empiezan.
      const dayBeforeHard = day => hard.has(day.day + 1);
      const easy = strengthEligible.filter(day => !hard.has(day.day) && !dayBeforeHard(day)).sort((a, b) => Number(runsOn(a)) - Number(runsOn(b)) || a.day - b.day);
      const onQuality = answers.level === 'nuevo' ? [] : strengthEligible.filter(day => quality.some(q => q.day === day.day) && !dayBeforeHard(day));
      const chosen = [];
      for (const day of [...easy, ...onQuality]) {
        if (chosen.length >= sp.perWeek) break;
        if (chosen.some(other => Math.abs(other.day - day.day) < 2)) continue;
        chosen.push(day);
      }
      return chosen;
    };
    // Días de calidad: separados de la tirada larga y elegidos para que también quepa la fuerza.
    const spaced = (list, day) => ![...plan.keys(), ...list.map(d => d.day)].some(other => Math.abs(other - day.day) <= 1);
    const combos = [];
    const walk = (start, list) => {
      if (list.length === qualityCount) return combos.push(list);
      for (let i = start; i < free.length; i++) if (spaced(list, free[i])) walk(i + 1, [...list, free[i]]);
    };
    if (qualityCount) walk(0, []);
    const score = list => strengthDaysFor(list).length * 1000 + list.reduce((sum, day) => sum + Number(day.minutes), 0);
    let qualityDays = combos.sort((a, b) => score(b) - score(a))[0];
    if (!qualityDays) {
      // No caben separadas: las más largas, aunque vayan seguidas.
      qualityDays = free.slice().sort((a, b) => b.minutes - a.minutes).slice(0, qualityCount);
    }
    qualityDays = qualityDays.slice().sort((a, b) => b.minutes - a.minutes);
    // Si la biblioteca no tiene la sesión (p. ej. las de >60 min que el club excluye), se tira de los bloques anteriores.
    const routeKeys = race.route.map(([key]) => key);
    const fallbackFamilies = [...routeKeys.slice(0, Math.max(0, routeKeys.indexOf(week.phase))).reverse().flatMap(key => PHASES[key].quality), 'Fartlek'];
    qualityDays.forEach((day, i) => {
      const families = phase.quality;
      const fam = families[i % families.length];
      const maxLevel = week.type === 'deload' ? Math.max(1, level.maxLib - 1) : level.maxLib;
      const row = pickRow(rows, runFilter(day, r => r.family === fam && (fam === 'Race Specific' ? true : phaseOk(r))), progress, maxLevel, day.minutes, used)
        || pickRow(rows, runFilter(day, r => families.includes(r.family)), progress, maxLevel, day.minutes, used)
        || fallbackFamilies.reduce((found, family) => found || pickRow(rows, runFilter(day, r => r.family === family), progress, maxLevel, day.minutes, used), null);
      if (row) { used.add(row.id); plan.set(day.day, { row, role: 'Sesión de calidad', priority: i ? 'B' : 'A', objective: phase.goal }); }
    });

    // 3) El resto, rodajes fáciles (los más cortos en descarga/vuelta)
    const easyMinutes = Math.max(25, Math.round((week.minutes - [...plan.values()].reduce((s, p) => s + p.row.minutes, 0)) / Math.max(1, daysUsable.length - plan.size)));
    daysUsable.filter(day => !plan.has(day.day)).forEach(day => {
      const limit = easyOnly(day) ? day.minutes : Math.min(day.minutes, easyMinutes + 5);
      const family = easyOnly(day) || ['recovery', 'deload'].includes(week.type) || week.phase === 'taper' ? 'Recovery' : 'Easy';
      const row = pickRow(rows, runFilter(day, r => r.family === family), 1, 5, limit, new Set())
        || pickRow(rows, runFilter(day, r => ['Easy', 'Recovery'].includes(r.family)), 0, 5, day.minutes, new Set());
      if (row) plan.set(day.day, { row, role: family === 'Recovery' ? 'Rodaje muy suave' : 'Rodaje fácil', priority: 'C', objective: 'Sumar tiempo corriendo sin cansarse.' });
    });

    // Regla 9 (80/20): el tiempo duro no pasa del 20 % del tiempo corriendo (15 % si empieza).
    // Primero se busca una sesión de calidad más corta; si no la hay, la segunda pasa a rodaje fácil.
    const hardLimit = HARD_SHARE[answers.level] || 0.2;
    for (let guard = 0; guard < 4; guard++) {
      const quality = [...plan.entries()].filter(([, item]) => item.role === 'Sesión de calidad' && week.type !== 'competition');
      const total = [...plan.values()].reduce((sum, item) => sum + item.row.minutes, 0);
      const hard = quality.reduce((sum, [, item]) => sum + hardMinutes(item.row), 0);
      if (!quality.length || hard <= total * hardLimit) break;
      const [qDay, item] = quality.sort((a, b) => hardMinutes(b[1].row) - hardMinutes(a[1].row))[0];
      const dayObj = trainDays.find(d => d.day === qDay);
      const allowed = hardMinutes(item.row) - (hard - total * hardLimit);
      const shorter = allowed >= 8 && pickRow(rows, runFilter(dayObj, r => r.family === item.row.family && hardMinutes(r) > 0 && hardMinutes(r) <= allowed), 1, level.maxLib, dayObj.minutes, used);
      if (shorter) { used.add(shorter.id); plan.set(qDay, { ...item, row: shorter }); continue; }
      if (quality.length < 2) break;
      const [bDay] = quality.find(([, it]) => it.priority === 'B') || quality[1];
      const bObj = trainDays.find(d => d.day === bDay);
      const easy = pickRow(rows, runFilter(bObj, r => r.family === 'Easy'), 1, 5, Math.min(bObj.minutes, easyMinutes + 5), new Set());
      if (easy) plan.set(bDay, { row: easy, role: 'Rodaje fácil', priority: 'C', objective: 'Sumar tiempo corriendo sin cansarse.' });
      else plan.delete(bDay);
    }

    [...plan.entries()].sort((a, b) => a[0] - b[0]).forEach(([day, item]) => {
      const session = sessionFromRow(item.row, dateOf(day), {
        priority: item.priority, role: item.role, objective: item.objective,
        zone: item.row.family === 'Race Specific' ? race.zone : undefined,
      });
      // Si ese día solo puede hacer trail, la sesión va por montaña (y así lo entiende la disponibilidad).
      if (trailOnly(trainDays.find(d => d.day === day)) && !/trail|montaña|desnivel/i.test(session.title)) session.title += ' · por montaña';
      session.easy = /^Rodaje/.test(item.role);
      // Carrera con mucho desnivel: la tirada larga de las fases fuertes va con cuestas, como la carrera.
      if (item.role === 'Tirada larga' && course.hilly && HILL_PHASES.includes(week.phase)) {
        if (!/trail|montaña|desnivel|cuesta/i.test(session.title)) session.title += ' · con cuestas';
        session.summary += ' · Por terreno con cuestas';
        session.structured_description += `\nTerreno: busca un recorrido con subidas y bajadas. La carrera tiene ${course.elevation} m de desnivel positivo en ${String(course.km).replace('.', ',')} km.`;
      }
      sessions.push(session);
    });

    // 4) Fuerza, periodizada con los bloques de carrera
    const chosen = strengthDaysFor(qualityDays);
    if (chosen.length) {
      chosen.sort((a, b) => a.day - b.day).forEach((day, i) => {
        // El rodaje de ese día pasa a ser una propuesta: lo importante es la fuerza (salvo sesión doble: caben las dos).
        if (!day.double) sessions.filter(s => s.easy && s.workout_date === dateOf(day.day)).forEach(makeOptional);
        const ranToday = sessions.filter(s => !s.optional && !s.is_strength && s.workout_date === dateOf(day.day)).reduce((sum, s) => sum + (Number(s.planned_duration_min) || 0), 0);
        const strengthMinutes = Number(day.strength_minutes) || 0;
        if (day.gym && strengthMinutes) { sessions.push(guidedStrengthSession(sp, dateOf(day.day), strengthMinutes, ranToday > 0, day)); return; }
        if (answers.equipment === 'gimnasio_guiado') { sessions.push(guidedStrengthSession(sp, dateOf(day.day), strengthMinutes || (Number(day.minutes) || 60) - ranToday, ranToday > 0, day)); return; }
        const fam = sp.families[i % sp.families.length];
        const maxLevel = week.type === 'deload' ? Math.max(1, level.maxLib - 1) : Math.max(2, level.maxLib);
        const limit = strengthMinutes || Math.min(50, Math.max(20, (Number(day.minutes) || 50) - ranToday));
        const row = pickRow(rows, r => isStrengthRow(r) && r.family === fam && equipmentOk(r, answers.equipment), progress, maxLevel, limit, used)
          || pickRow(rows, r => isStrengthRow(r) && sp.families.includes(r.family) && equipmentOk(r, answers.equipment), progress, 5, limit, used)
          || pickRow(rows, r => isStrengthRow(r) && ['General Strength', 'Core'].includes(r.family), progress, 5, limit, used);
        if (row) {
          used.add(row.id);
          const session = sessionFromRow(row, dateOf(day.day), { priority: 'B', role: `Fuerza · ${sp.name}`, objective: sp.goal });
          if (qualityDays.some(q => q.day === day.day)) session.summary += ' · Después de correr, no antes';
          sessions.push(session);
        }
      });
    }

    // 5) Días sin carrera ni fuerza en los que puede hacer bici o pasear: una propuesta suave, nunca obligatoria.
    const busy = new Set(sessions.map(s => s.workout_date));
    allDays.filter(day => !busy.has(dateOf(day.day)) && (raceDay < 0 || day.day < raceDay)).forEach(day => {
      if (canDo(day, 'bike') && week.type !== 'competition') sessions.push(crossSession('bike', dateOf(day.day), day.minutes));
      else if (canDo(day, 'walk')) sessions.push(crossSession('walk', dateOf(day.day), day.minutes));
    });
    sessions.forEach(s => delete s.easy);
    return sessions.sort((a, b) => a.workout_date.localeCompare(b.workout_date) || (a.is_strength ? 1 : -1));
  }

  const OPTIONAL = 'Opcional';
  function makeOptional(session) {
    if (session.optional) return;
    session.optional = true;
    session.priority = 'C';
    session.title = `${OPTIONAL} · ${session.title}`;
    session.summary = `Propuesta, no obligatorio: solo si tiene ganas y tiempo · ${session.summary}`;
    session.structured_description = `Opcional. Hoy lo importante es la fuerza; si corre, que sea muy suave y antes de la fuerza o en otro momento del día.\n${session.structured_description}`;
  }
  function crossSession(kind, date, minutes) {
    const bike = kind === 'bike';
    const duration = Math.max(20, Math.min(Number(minutes) || 45, bike ? 60 : 45));
    const title = `${OPTIONAL} · ${bike ? 'Bici suave' : 'Paseo'} ${duration}'`;
    return {
      sport: bike ? 'Ride' : 'Walk', is_strength: false, optional: true, title, priority: 'C', workout_date: date,
      planned_duration_min: duration, planned_load: Math.round(duration * (bike ? 0.6 : 0.3)),
      session_objective: bike ? 'Sumar trabajo aeróbico sin el impacto de correr.' : 'Moverse y recuperar sin cargar las piernas.',
      adaptation_target: bike ? 'Cross-training' : 'Recovery',
      summary: `Propuesta, no obligatorio · RPE ${bike ? '3-4' : '2-3'} de 10: ${bike ? 'puedes hablar con frases completas' : 'paseo tranquilo'}`,
      structured_description: bike
        ? `Opcional. Bici muy suave, sin cuestas duras.\nCómo debe sentirse: RPE 3-4 de 10, puedes hablar con frases completas.\nSi tiene las piernas cansadas, mejor descansar.`
        : `Opcional. Paseo a ritmo tranquilo, mejor por terreno blando o monte.\nSirve para recuperar; no cuenta como entrenamiento duro.`,
      blocks: [{ type: 'steady', name: bike ? 'Bici suave' : 'Paseo', duration_min: duration, target: 'Z1-Z2' }, { type: 'runflow_meta', library_id: null, guided_plan: true, optional: true }],
      runflow_library_id: null,
    };
  }
  function guidedStrengthSession(sp, date, minutes, afterRun, day = {}) {
    // Con minutos de fuerza en la ficha se respetan tal cual; si no, entre 30 y 60.
    const duration = day.strength_minutes ? Math.max(15, Math.min(Number(minutes) || 60, 180)) : Math.max(30, Math.min(Number(minutes) || 60, 60));
    const focus = sp.families.map(family => FAMILY_ES[family] || family).join('; ');
    const lines = [
      'Fuerza con el entrenador del gimnasio. RunFlow no marca los ejercicios: enséñale esto.',
      `Qué toca en esta fase (${sp.name.toLowerCase()}): ${sp.goal}`,
      `Qué trabajar: ${focus}.`,
      `Esfuerzo: ${sp.effort}`,
      'Es un corredor: piernas y tronco primero; si propone mucho volumen de piernas, mejor menos series y con buena técnica.',
      afterRun && 'Hoy también corre: la fuerza, después de correr.',
      day.double && day.extra_easy && `Sesión doble: además puede moverse como mucho ${day.minutes} min, siempre suave (descarga), nunca series ni tirada larga.`,
    ].filter(Boolean);
    return {
      sport: 'Strength', is_strength: true, title: `Fuerza guiada en el gimnasio · ${sp.name}`, priority: 'B', workout_date: date,
      planned_duration_min: duration, planned_load: Math.round(duration * 5),
      session_objective: sp.goal, adaptation_target: sp.families.join(', '),
      summary: `Fuerza · ${sp.name} · Con el entrenador del gimnasio · ${sp.effort}${afterRun ? ' · Después de correr, no antes' : ''}`,
      structured_description: lines.join('\n'),
      blocks: [{ type: 'runflow_meta', library_id: null, guided_plan: true, guided_gym: true }],
      runflow_library_id: null,
    };
  }


  // ---------- Temporada guardada → estructura (para preparar semana a semana) ----------
  // Ficha → días del plan. La ficha guarda 'gym' para la fuerza con entrenador.
  const FROM_PROFILE = { run: 'run', trail: 'trail', bike: 'bike', strength: 'strength', gym: 'strength', walk: 'walk' };
  function daysFromProfile(profile) {
    const days = profile?.availability?.days || [];
    const configured = profile?.availability?.configured || days.some(day => day && (day.activity_type || Object.prototype.hasOwnProperty.call(day, 'can_train')));
    if (!configured) return null;
    return [0, 1, 2, 3, 4, 5, 6].map(index => {
      const stored = days.find(day => Number(day.day) === index + 1) || {};
      const listed = Array.isArray(stored.activity_types) && stored.activity_types.length ? stored.activity_types : [stored.activity_type || (stored.can_train === false ? 'unavailable' : 'flexible')];
      let types = [...new Set(listed.flatMap(type => type === 'flexible' ? ['run', 'strength'] : FROM_PROFILE[type] ? [FROM_PROFILE[type]] : []))];
      if (stored.can_train === false) types = [];
      const day = { day: index, minutes: types.length ? Number(stored.max_minutes) || 60 : 0, types };
      return withStrengthSlot(day, stored, listed);
    });
  }
  /*
   * Días con fuerza y minutos de fuerza en la ficha (strength_minutes):
   * - gym: fuerza guiada en el gimnasio. Es una cita fija: ese día va la fuerza.
   * - double: además de la fuerza puede hacer otra actividad (sesión doble) de extra_minutes,
   *   suave (extra_intensity 'suave', por defecto) o sin límite de intensidad ('libre').
   * - Sin sesión doble: con fuerza guiada no hace nada más; con fuerza RunFlow, una cosa u otra.
   * day.minutes sigue siendo el tiempo para correr/bici/paseo ese día.
   */
  function withStrengthSlot(day, stored, listed) {
    const strengthMinutes = Number(stored.strength_minutes) > 0 ? Math.round(Number(stored.strength_minutes)) : 0;
    if (!strengthMinutes || !day.types.includes('strength')) return day;
    const gym = listed.includes('gym');
    const others = day.types.filter(type => type !== 'strength');
    const extra = Number(stored.extra_minutes) > 0 ? Math.round(Number(stored.extra_minutes)) : 0;
    const double = stored.double_session === true && others.length > 0 && extra > 0;
    day.strength_minutes = strengthMinutes;
    day.gym = gym;
    if (double) {
      day.double = true;
      day.minutes = extra;
      day.extra_easy = stored.extra_intensity !== 'libre';
    } else if (gym || !others.length) {
      day.types = ['strength'];
      day.minutes = strengthMinutes;
    }
    return day;
  }
  const strengthOnly = day => dayTypes(day).length === 1 && dayTypes(day)[0] === 'strength';
  function dayText(day) {
    if (!(Number(day?.minutes) > 0) || !dayTypes(day).length) return 'No entrena';
    const types = dayTypes(day).filter(type => type !== 'strength').map(type => ACTIVITIES[type].toLowerCase());
    if (!day.strength_minutes) return `${dayTypes(day).map(type => ACTIVITIES[type]).join(' o ')} · ${day.minutes} min`;
    const strength = `${day.gym ? 'Fuerza guiada en gimnasio' : 'Fuerza'} ${day.strength_minutes} min`;
    if (day.double) return `${strength} + ${types.join(' o ')} ${day.minutes} min${day.extra_easy ? ' suave' : ''} (sesión doble)`;
    if (strengthOnly(day)) return `${strength}, nada más`;
    return `${strength} o ${types.join(' o ')} ${day.minutes} min`;
  }
  function phaseOfMeso(meso) {
    const text = String(meso?.notes || '');
    const index = text.indexOf(PHASE_PREFIX);
    if (index >= 0) {
      const key = text.slice(index + PHASE_PREFIX.length).split('\n')[0].trim();
      if (PHASES[key]) return key;
    }
    const byName = Object.keys(PHASES).find(key => norm(PHASES[key].name) === norm(meso?.name));
    return byName || 'base';
  }
  /*
   * structureFromPlan: a partir de la temporada guardada (macrociclo del plan guiado con sus
   * mesociclos y microciclos) rehace la estructura que usa buildWeekSessions. Así cada semana
   * se prepara cuando toca, con la disponibilidad de ese momento.
   */
  function phaseOfMicro(micro) {
    const text = String(micro?.notes || '');
    const index = text.indexOf(PHASE_PREFIX);
    if (index < 0) return null;
    const key = text.slice(index + PHASE_PREFIX.length).split('\n')[0].trim();
    return PHASES[key] ? key : null;
  }
  function structureFromPlan(answers, macro) {
    const race = RACES[answers?.race];
    if (!race) throw new Error('Esta temporada no tiene los datos del plan guiado.');
    const level = LEVELS[answers.level] || LEVELS.regular;
    const weeks = [];
    (macro?.mesocycles || []).forEach(meso => {
      const mesoKey = phaseOfMeso(meso);
      (meso.microcycles || []).forEach(micro => {
        const type = WEEK_TYPES[micro.type] ? micro.type : 'load';
        const info = WEEK_TYPES[type];
        const hours = Number(micro.planned?.hours) || 0;
        const minutes = Math.round(hours * 60 / 5) * 5;
        // Tras recalcular la temporada, la fase de cada semana va en la propia semana.
        const key = phaseOfMicro(micro) || mesoKey;
        const week = {
          index: 0, start: micro.start_date, end: addDays(micro.start_date, 6), phase: key, type, minutes, hours,
          load: Number(micro.planned?.load) || Math.round(minutes * info.rpe), label: info.label, why: info.why,
          strength_sessions: Number(micro.planned?.strength_sessions) || 0, micro_id: micro.id, meso_id: meso.id,
          adapted: String(micro.notes || '').includes(ADAPTED_PREFIX),
        };
        const race2 = (answers.other_races || []).find(item => item.date >= week.start && item.date <= week.end);
        if (race2) week.b_race = race2;
        weeks.push(week);
      });
    });
    weeks.sort((a, b) => a.start.localeCompare(b.start)).forEach((week, i) => { week.index = i + 1; });
    // Bloques = semanas seguidas de la misma fase.
    const mesos = [];
    weeks.forEach(week => {
      const last = mesos[mesos.length - 1];
      if (last && last.key === week.phase) { last.weeks.push(week); last.end = week.end; return; }
      mesos.push({ key: week.phase, ...PHASES[week.phase], id: week.meso_id, start: week.start, end: week.end, weeks: [week], strength: strengthPlanFor(answers, race, week.phase, 'load') });
    });
    return { race, level, race_date: answers.race_date, start: weeks[0]?.start || '', end: weeks.length ? weeks[weeks.length - 1].end : '', totalWeeks: weeks.length, weeks, mesos, warnings: [] };
  }

  // ---------- «Ha pasado algo»: lesión, enfermedad, viaje o cansancio ----------
  const INCIDENT_MARKER = 'RUNFLOW_GUIDED_INCIDENTS';
  const ADAPTED_PREFIX = 'RUNFLOW_GUIDED_ADAPTED:';
  const INCIDENT_KINDS = {
    lesion: { label: 'Lesión o molestia', hint: 'Le duele algo al correr o después.' },
    enfermedad: { label: 'Enfermedad', hint: 'Gripe, fiebre, catarro fuerte…' },
    viaje: { label: 'Viaje o trabajo', hint: 'Unos días o semanas sin poder entrenar.' },
    cansancio: { label: 'Mucho cansancio', hint: 'Va cargado, duerme mal o no rinde.' },
  };
  const STATES = {
    parado: { label: 'Parado', why: 'Descanso: solo lo que no duela.' },
    sin_correr: { label: 'Entrena sin correr', why: 'Mantiene la forma con lo que sí puede hacer, sin cargar la lesión.' },
    vuelta: { label: 'Vuelta progresiva', why: 'Vuelve a correr poco a poco; manda el dolor.' },
    normal: { label: 'Normal', why: 'Sigue el plan de la temporada.' },
  };
  const ALTERNATIVES = { bike: 'Bici o elíptica', walk: 'Caminar', strength: 'Ejercicios de fuerza y recuperación' };
  const REHAB_CORE = ['Plancha frontal: 3 × 20-30 s', 'Dead bug: 3 × 8 por lado, lento', 'Puente de glúteo: 3 × 12'];
  const INJURY_ZONES = {
    pubis: {
      label: 'Pubis o ingle', can: ['bike', 'walk', 'strength'],
      avoid: ['Sprints y series rápidas', 'Cambios de dirección y giros bruscos', 'Cuestas fuertes, sobre todo bajando', 'Chutar o golpear un balón', 'Abrir mucho las piernas (zancadas laterales, sentadilla muy abierta)'],
      rehab: ['Aductores en isométrico: balón entre las rodillas tumbado boca arriba, apretar 5 × 30 s', 'Copenhagen corto (rodilla apoyada en el banco): 3 × 6-8 por lado', 'Puente de glúteo: 3 × 12', 'Plancha lateral: 3 × 20-30 s por lado', 'Dead bug: 3 × 8 por lado, lento'],
    },
    rodilla: {
      label: 'Rodilla', can: ['bike', 'walk', 'strength'],
      avoid: ['Bajadas', 'Escaleras con carga', 'Saltos', 'Sentadillas profundas'],
      rehab: ['Sentadilla isométrica en pared: 5 × 30-45 s', 'Step-up a un escalón bajo: 3 × 10 por pierna', 'Puente de glúteo: 3 × 12', 'Elevación de gemelos: 3 × 15', 'Abducción de cadera con goma: 3 × 15'],
    },
    gemelo: {
      label: 'Gemelo o Aquiles', can: ['bike', 'strength'],
      avoid: ['Cuestas', 'Correr de puntillas o rápido', 'Saltos', 'Zapatillas muy planas'],
      rehab: ['Gemelo en isométrico (de puntillas, quieto): 5 × 30 s', 'Elevaciones de gemelo con pierna estirada, bajando lento: 3 × 12-15', 'Elevaciones de gemelo con rodilla flexionada: 3 × 12-15', 'Equilibrio a una pierna: 3 × 30 s', ...REHAB_CORE.slice(0, 1)],
    },
    tobillo: {
      label: 'Tobillo o pie', can: ['bike', 'strength'],
      avoid: ['Terreno irregular o montaña', 'Saltos', 'Cambios de dirección'],
      rehab: ['Equilibrio a una pierna: 3 × 30 s', 'Movimientos del tobillo con goma en 4 direcciones: 3 × 15', 'Elevaciones de gemelo: 3 × 15', 'Recoger una toalla con los dedos: 3 × 30 s', ...REHAB_CORE.slice(0, 1)],
    },
    cadera: {
      label: 'Cadera o glúteo', can: ['bike', 'walk', 'strength'],
      avoid: ['Cuestas', 'Zancadas largas', 'Series rápidas'],
      rehab: ['Puente de glúteo: 3 × 12', 'Abducción con goma (paso lateral): 3 × 12 por lado', 'Plancha lateral: 3 × 20-30 s por lado', 'Peso muerto a una pierna sin peso: 3 × 8 por pierna', 'Bird dog: 3 × 8 por lado'],
    },
    espalda: {
      label: 'Espalda', can: ['bike', 'walk', 'strength'],
      avoid: ['Cargar peso', 'Giros bruscos', 'Bajadas largas'],
      rehab: ['Bird dog: 3 × 8 por lado', 'Dead bug: 3 × 8 por lado', 'Puente de glúteo: 3 × 12', 'Plancha lateral corta (rodillas apoyadas): 3 × 20 s'],
    },
    otra: { label: 'Otra zona', can: ['bike', 'walk', 'strength'], avoid: ['Todo lo que le duela'], rehab: [...REHAB_CORE, 'Plancha lateral: 3 × 20 s por lado'] },
  };
  // Vuelta a correr: cada semana en verde se sube un paso.
  const RETURN_STEPS = [
    { text: "5 × (1' trote muy suave + 2' andando)", run: 5, total: 15 },
    { text: "6 × (2' trote + 1' andando)", run: 12, total: 18 },
    { text: "4 × (4' trote + 1' andando)", run: 16, total: 20 },
    { text: "20' de trote suave seguido", run: 20, total: 20 },
    { text: "30' de trote suave seguido", run: 30, total: 30 },
    { text: "40' de trote suave seguido", run: 40, total: 40 },
  ];
  const PAIN_RULE = 'Manda el dolor, durante y a la mañana siguiente: 0-2 de 10, bien; 3-4, se repite el paso; 5 o más, se para y se avisa al coach.';

  // Estado con el que empieza: más prudente cuanto más duele.
  function initialState(incident) {
    if (incident.kind === 'enfermedad' || incident.kind === 'viaje') return 'parado';
    const pain = Number(incident.pain) || 0;
    if (pain >= 5) return 'parado';
    if (incident.can_run && pain <= 2) return 'vuelta';
    return 'sin_correr';
  }
  function readIncidents(notes) {
    const text = String(notes || '');
    const index = text.indexOf(INCIDENT_MARKER);
    if (index < 0) return [];
    try { const list = JSON.parse(text.slice(index + INCIDENT_MARKER.length).trim().split('\n')[0]); return Array.isArray(list) ? list : []; } catch { return []; }
  }
  function writeIncidents(notes, incidents) {
    const text = String(notes || '');
    const index = text.indexOf(INCIDENT_MARKER);
    let before = text, after = '';
    if (index >= 0) {
      before = text.slice(0, index);
      const rest = text.slice(index + INCIDENT_MARKER.length).replace(/^\s*\n/, '');
      const nl = rest.indexOf('\n');
      after = nl >= 0 ? rest.slice(nl + 1) : '';
    }
    const kept = incidents.slice(-5).map(item => ({ ...item, log: (item.log || []).slice(-12) }));
    return `${before.replace(/\s+$/, '')}\n${INCIDENT_MARKER}\n${JSON.stringify(kept)}${after ? `\n${after}` : ''}`;
  }
  const activeIncident = list => (list || []).slice().reverse().find(item => !item.closed) || null;

  function rehabSession(incident, date, maxMinutes) {
    const zone = INJURY_ZONES[incident.zone] || INJURY_ZONES.otra;
    const duration = Math.max(15, Math.min(25, Number(maxMinutes) || 25));
    const list = incident.kind === 'lesion' ? zone.rehab : [...REHAB_CORE, 'Movilidad suave de caderas y tobillos: 5 min'];
    return {
      sport: 'Strength', is_strength: true, priority: 'B', workout_date: date,
      title: incident.kind === 'lesion' ? `Recuperación · ${zone.label}` : 'Fuerza suave y movilidad',
      planned_duration_min: duration, planned_load: duration * 3,
      session_objective: 'Fortalecer la zona y el tronco para volver mejor.', adaptation_target: 'Rehab',
      summary: 'Ejercicios de recuperación · RPE 4-5 de 10 · sin dolor',
      structured_description: [
        'Ejercicios sencillos, sin dolor (si alguno duele más de 3 de 10, quítalo).',
        ...list.map(item => `· ${item}`),
        'Si el fisio le ha dado ejercicios, haz los suyos en lugar de estos.',
      ].join('\n'),
      blocks: [{ type: 'runflow_meta', library_id: null, guided_plan: true, adapted: true }],
      runflow_library_id: null,
    };
  }
  function altSession(kind, date, minutes, harder) {
    const bike = kind === 'bike';
    const duration = Math.max(20, Math.round(minutes / 5) * 5);
    const title = bike ? (harder ? `Bici o elíptica con cambios de ritmo ${duration}'` : `Bici o elíptica suave ${duration}'`) : `Caminar ${duration}'`;
    const lines = bike
      ? (harder
        ? ["Calentamiento 10' suave.", "6 × (2' algo fuerte, RPE 6 de 10 + 2' suave).", 'Resto suave. Sin dolor en ningún momento.']
        : ['Ritmo cómodo: RPE 3-4 de 10, puedes hablar con frases completas.', 'Sustituye a la carrera: mantiene el motor sin cargar la lesión.'])
      : ['Caminar a buen paso, mejor por terreno blando y llano.', 'Si al día siguiente duele más, la próxima vez más corto.'];
    return {
      sport: bike ? 'Ride' : 'Walk', is_strength: false, priority: harder ? 'B' : 'C', workout_date: date, title,
      planned_duration_min: duration, planned_load: Math.round(duration * (bike ? (harder ? 1.1 : 0.7) : 0.3)),
      session_objective: bike ? 'Mantener la forma aeróbica sin el impacto de correr.' : 'Moverse sin cargar la lesión.',
      adaptation_target: 'Cross-training',
      summary: bike ? (harder ? 'Sustituye a la carrera · RPE 6 de 10 en los cambios' : 'Sustituye a la carrera · RPE 3-4 de 10') : 'Sustituye a la carrera · paseo activo',
      structured_description: lines.join('\n'),
      blocks: [{ type: 'steady', name: title, duration_min: duration, target: harder ? 'Z3' : 'Z1-Z2' }, { type: 'runflow_meta', library_id: null, guided_plan: true, adapted: true }],
      runflow_library_id: null,
    };
  }
  function returnRunSession(step, index, date) {
    const s = RETURN_STEPS[Math.max(0, Math.min(RETURN_STEPS.length - 1, step))];
    const duration = s.total + 10;
    return {
      sport: 'Run', is_strength: false, priority: 'A', workout_date: date,
      title: `Vuelta a correr · paso ${step + 1} de ${RETURN_STEPS.length}`,
      planned_duration_min: duration, planned_load: Math.round(duration * 3),
      session_objective: 'Volver a correr sin que vuelva el dolor.', adaptation_target: 'Return to run',
      summary: `${s.text} · muy suave, por llano y terreno blando`,
      structured_description: [
        "Calentamiento: 5' andando rápido.",
        `Bloque principal: ${s.text}.`,
        "Vuelta a la calma: 5' andando.",
        'Ritmo: muy suave, RPE 2-3 de 10. Por llano y mejor sobre tierra o césped.',
        PAIN_RULE,
      ].join('\n'),
      blocks: [
        { type: 'warmup', duration_min: 5, target: 'Z1' },
        { type: 'steady', name: s.text, duration_min: s.total, target: 'Z1-Z2' },
        { type: 'cooldown', duration_min: 5, target: 'Z1' },
        { type: 'runflow_meta', library_id: null, guided_plan: true, adapted: true, return_step: step + 1, return_index: index },
      ],
      runflow_library_id: null,
    };
  }
  // Días separados al menos un día entre sí, empezando por los de más tiempo.
  function spacedDays(list, count) {
    const chosen = [];
    for (const day of list.slice().sort((a, b) => b.minutes - a.minutes || a.day - b.day)) {
      if (chosen.length >= count) break;
      if (chosen.some(other => Math.abs(other.day - day.day) < 2)) continue;
      chosen.push(day);
    }
    return chosen.sort((a, b) => a.day - b.day);
  }
  /*
   * Semana adaptada mientras dura una lesión, enfermedad o viaje. days: disponibilidad (0 = lunes).
   * fromDate: no se programa nada antes de ese día (lo pasado de la semana se respeta).
   */
  function buildAdaptedWeek(incident, week, days, options = {}) {
    const state = incident.state || initialState(incident);
    const from = options.fromDate || week.start;
    const dateOf = day => addDays(week.start, day.day);
    const usable = (days || []).filter(day => Number(day.minutes) > 0 && dateOf(day) >= from);
    const can = new Set(incident.can || []);
    const sessions = [];
    if (state === 'normal' || incident.kind === 'viaje' || incident.kind === 'enfermedad' && state === 'parado') return sessions;
    const runDays = usable.filter(runsOn);
    const strengthDays = usable.filter(day => canDo(day, 'strength'));
    const alt = can.has('bike') ? 'bike' : can.has('walk') ? 'walk' : null;
    const rehabCount = can.has('strength') && (state !== 'parado' || Number(incident.pain) <= 4) ? 2 : 0;
    // Primero se eligen los días de recuperación (fuerza) para dejarles sitio; después, lo demás.
    const rehabDays = spacedDays(strengthDays, rehabCount);
    const REHAB_MIN = 25;
    const room = day => Number(day.minutes) - (rehabDays.includes(day) ? REHAB_MIN : 0);
    let running = [];
    if (state === 'vuelta') running = spacedDays(runDays.filter(day => room(day) >= RETURN_STEPS[Math.min(RETURN_STEPS.length - 1, Number(incident.step) || 0)].total + 10 || !rehabDays.includes(day)), 3);
    running.forEach((day, i) => sessions.push(returnRunSession(Number(incident.step) || 0, i, dateOf(day))));
    if (state !== 'parado' && alt) {
      const pain = Number(incident.pain) || 0;
      let harderDone = !(alt === 'bike' && incident.kind === 'lesion' && pain <= 2);
      const longestDay = runDays.slice().sort((a, b) => b.minutes - a.minutes)[0];
      runDays.filter(day => !running.includes(day) && canDo(day, alt)).forEach(day => {
        const longest = day === longestDay;
        const minutes = Math.min(room(day), alt === 'bike' ? (longest ? 75 : 45) : 40);
        if (minutes < 20) return;
        const harder = !harderDone && !longest;
        if (harder) harderDone = true;
        sessions.push(altSession(alt, dateOf(day), minutes, harder));
      });
    }
    if (state === 'parado' && can.has('walk')) {
      spacedDays(usable.filter(day => canDo(day, 'walk')), 2).forEach(day => {
        const s = altSession('walk', dateOf(day), Math.min(room(day), 25), false);
        s.title = `Opcional · ${s.title}`; s.optional = true; s.summary = 'Solo si no duele · paseo tranquilo';
        sessions.push(s);
      });
    }
    rehabDays.forEach(day => {
      const used = sessions.filter(s => s.workout_date === dateOf(day) && !s.optional).reduce((sum, s) => sum + (Number(s.planned_duration_min) || 0), 0);
      if (Number(day.minutes) - used < 15) return;
      sessions.push(rehabSession(incident, dateOf(day), Number(day.minutes) - used));
    });
    return sessions.sort((a, b) => a.workout_date.localeCompare(b.workout_date) || Number(Boolean(a.is_strength)) - Number(Boolean(b.is_strength)));
  }
  // Tras la semana de vuelta: verde sube un paso, ámbar repite, rojo baja (o vuelve a «sin correr»).
  function nextReturnStep(incident, light) {
    const step = Number(incident.step) || 0;
    if (light === 'green') return { state: 'vuelta', step: Math.min(RETURN_STEPS.length - 1, step + 1), ready: step + 1 >= RETURN_STEPS.length };
    if (light === 'red') return step === 0 ? { state: 'sin_correr', step: 0 } : { state: 'vuelta', step: step - 1 };
    return { state: 'vuelta', step };
  }
  /*
   * Al volver: la carrera no se mueve. Se rehace la temporada desde el lunes de vuelta,
   * contando las semanas perdidas y la fase en la que estaba cuando pasó.
   */
  function returnPlan(answers, incident, structure, returnDate) {
    const startMonday = mondayOf(incident.from);
    const back = nextMonday(returnDate);
    const lostWeeks = Math.max(0, weeksBetween(startMonday, back));
    const atStart = structure.weeks.find(week => week.start <= incident.from && week.end >= incident.from) || structure.weeks.find(week => week.start >= incident.from);
    const reason = (incident.log || []).some(entry => entry.s === 'vuelta') || incident.kind === 'viaje' ? 'otro' : incident.kind === 'enfermedad' ? 'enfermedad' : 'dolor';
    const phase = atStart?.phase && atStart.phase !== 'taper' ? atStart.phase : undefined;
    const result = replan(answers, { from_date: back, lost_weeks: lostWeeks, reason, current_phase: phase });
    result.lost_weeks = lostWeeks;
    return result;
  }

  // ---------- Cargas útiles para la API ----------
  function seasonPayload(answers, structure) {
    return {
      name: answers.race_name ? `${answers.race_name} · ${structure.race.label}` : `${structure.race.label} · ${formatDate(answers.race_date)}`,
      start_date: structure.start, end_date: structure.end, status: 'planned',
      season_objective: structure.summary,
      notes: 'Plan creado con el asistente de planificación guiada.',
    };
  }
  function goalPayloads(answers, structure, seasonId) {
    const main = {
      season_id: seasonId, name: answers.race_name || structure.race.label, goal_date: answers.race_date, sport: structure.race.trail ? 'TrailRun' : 'Run',
      event_type: structure.race.label, goal_type: 'competition', priority_code: 'A', distance_km: courseOf(answers).km, elevation_m: courseOf(answers).elevation,
      target_time_sec: answers.goal_mode === 'marca' ? parseTime(answers.target_time) : null,
      performance_target: answers.goal_mode === 'marca' && answers.target_time ? `Bajar de ${answers.target_time}` : 'Terminarla en buen estado',
    };
    const others = (answers.other_races || []).filter(item => item.date && item.date >= structure.start && item.date < answers.race_date).map(item => ({
      season_id: seasonId, name: item.name || 'Carrera de preparación', goal_date: item.date, sport: 'Run', event_type: 'Carrera de preparación', goal_type: 'competition', priority_code: 'B',
      distance_km: Number(item.km) > 0 ? Number(item.km) : null, elevation_m: Number(item.elevation) > 0 ? Math.round(Number(item.elevation)) : null,
      performance_target: 'Usarla como entrenamiento de calidad',
    }));
    return [main, ...others];
  }
  function macroPayload(answers, structure, goalId) {
    return {
      goal_id: goalId || null,
      name: `Camino ${towards(structure.race)}`,
      start_date: structure.start, end_date: structure.end, status: 'planned',
      primary_objective: structure.summary,
      constraints: answers.injuries ? `Molestias o lesiones a vigilar: ${answers.injuries}` : '',
      notes: `${MARKER}\n${JSON.stringify(compactAnswers(answers))}`,
    };
  }
  function mesoPayload(meso) {
    return {
      name: meso.name, start_date: meso.start, end_date: meso.end, duration_weeks: meso.weeks.length, status: 'planned',
      primary_adaptation: meso.goal.slice(0, 200),
      secondary_adaptations: meso.strength.perWeek ? [`Fuerza: ${meso.strength.name.toLowerCase()} (${meso.strength.perWeek}/semana)`] : [],
      success_criteria: meso.strength.perWeek ? `${meso.success} Fuerza: ${meso.strength.goal}` : meso.success,
      planned_strength_sessions: meso.weeks.reduce((sum, w) => sum + (w.strength_sessions || 0), 0),
      planned_hours: Math.round(meso.weeks.reduce((s, w) => s + w.hours, 0) * 10) / 10,
      planned_load: meso.weeks.reduce((s, w) => s + w.load, 0),
      progression_pattern: meso.weeks.map(w => w.label),
      notes: `${MESO_TYPE_PREFIX}${meso.type}\n${PHASE_PREFIX}${meso.key}\nPor qué: ${meso.why}${meso.strength.perWeek ? `\nFuerza (${meso.strength.name}): ${meso.strength.goal} ${meso.strength.effort}` : ''}`,
    };
  }
  function microPayload(meso, week, workouts, answers) {
    const position = meso.weeks.indexOf(week) + 1;
    const strength = workouts ? workouts.filter(w => w.is_strength).length : week.strength_sessions || 0;
    return {
      name: `${meso.name} · semana ${position}`, start_date: week.start, end_date: week.end, type: week.type,
      primary_objective: week.b_race ? `${meso.goal} Esta semana hay carrera de preparación (${[week.b_race.name || 'objetivo B', Number(week.b_race.km) > 0 && `${week.b_race.km} km`, Number(week.b_race.elevation) > 0 && `${week.b_race.elevation} m+`].filter(Boolean).join(', ')}): úsala como sesión de calidad.` : meso.goal,
      planned: { hours: week.hours, distance_km: 0, elevation_m: 0, load: workouts && workouts.length ? workouts.filter(w => !w.optional).reduce((sum, w) => sum + (Number(w.planned_load) || 0), 0) : week.load, strength_sessions: strength },
      lifecycle_status: 'planned', publication_status: 'draft',
      recovery_target: ['deload', 'recovery', 'taper', 'competition'].includes(week.type) ? week.why : '',
      notes: `${week.label}: ${week.why}`,
      ...(workouts ? { workouts } : {}),
    };
  }

  function compactAnswers(a) {
    const num = value => (Number(value) > 0 ? Math.round(Number(value) * 10) / 10 : null);
    return {
      v: 1, race: a.race, race_date: a.race_date, race_name: a.race_name || '', race_km: num(a.race_km), race_elevation: num(a.race_elevation), goal_mode: a.goal_mode, target_time: a.target_time || '',
      level: a.level, injuries: a.injuries || '', history_minutes: num(a.history_minutes), long_day: a.long_day, strength: a.strength, equipment: a.equipment || 'gimnasio', start_date: a.start_date,
      days: (a.days || []).map(d => ({ day: d.day, minutes: d.minutes, types: dayTypes(d) })), other_races: (a.other_races || []).map(r => ({ name: r.name || '', date: r.date || '', km: num(r.km), elevation: num(r.elevation) })),
    };
  }
  function readAnswers(notes) {
    const text = String(notes || '');
    const index = text.indexOf(MARKER);
    if (index < 0) return null;
    try { return JSON.parse(text.slice(index + MARKER.length).trim().split('\n')[0]); } catch { return null; }
  }

  function parseTime(value) {
    const parts = String(value || '').trim().split(':').map(Number);
    if (!parts.length || parts.some(n => !Number.isFinite(n))) return null;
    return parts.reduce((total, n) => total * 60 + n, 0) * (parts.length === 2 ? 60 : 1) || null;
  }
  function formatDate(value) {
    if (!value) return '';
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${Number(value.slice(8, 10))} ${months[Number(value.slice(5, 7)) - 1]}`;
  }

  // ---------- Historial del atleta: punto de partida y ajuste de cada semana ----------
  const isRunSport = sport => /run|trail|correr/i.test(String(sport || ''));
  /*
   * Minutos de carrera por semana en las 6 semanas antes de `start` (actividades de Intervals).
   * Solo cuenta si hay datos en 3 semanas o más; si no, no se usa.
   */
  function historyFromActivities(activities, start, weeksBack = 6) {
    const first = addDays(mondayOf(start), -7 * weeksBack);
    const weeks = Array.from({ length: weeksBack }, (_, i) => ({ start: addDays(first, 7 * i), minutes: 0, runs: 0 }));
    (activities || []).forEach(item => {
      const date = String(item.activity_date || item.start_date_local || '').slice(0, 10);
      if (!isRunSport(item.sport || item.type)) return;
      const week = weeks.find(w => date >= w.start && date <= addDays(w.start, 6));
      if (!week) return;
      week.minutes += (Number(item.duration_sec ?? item.moving_time) || 0) / 60;
      week.runs += 1;
    });
    weeks.forEach(w => { w.minutes = Math.round(w.minutes); });
    const withData = weeks.filter(w => w.runs > 0);
    // Media de las 4 últimas semanas (una semana suelta muy baja no manda).
    const recent = weeks.slice(-4);
    const avg = Math.round(recent.reduce((sum, w) => sum + w.minutes, 0) / recent.length);
    const runsPerWeek = Math.round(recent.reduce((sum, w) => sum + w.runs, 0) / recent.length * 10) / 10;
    return { weeks, weeks_with_data: withData.length, avg_minutes: withData.length >= 3 ? avg : null, runs_per_week: runsPerWeek };
  }

  const ADJUST_PREFIX = 'RUNFLOW_GUIDED_ADJUST:';
  const ADJUST = {
    subir: { label: 'Puede dar algo más', short: 'Subir un poco', factor: 1.08 },
    mantener: { label: 'Mantener lo previsto', short: 'Mantener', factor: 1 },
    bajar: { label: 'Pedirle menos', short: 'Bajar', factor: 0.8 },
  };
  // RPE esperado de una sesión planificada: el que pone RunFlow en el resumen ("RPE 3-4 de 10").
  function expectedRpe(workout) {
    const text = `${workout?.summary || ''} ${workout?.structured_description || ''}`;
    const match = text.match(/RPE\s*(\d+(?:[.,]\d+)?)(?:\s*[-–a]\s*(\d+(?:[.,]\d+)?))?/i);
    if (!match) return null;
    const hi = Number(String(match[2] || match[1]).replace(',', '.'));
    return Number.isFinite(hi) ? hi : null;
  }
  const avg = list => (list.length ? list.reduce((sum, n) => sum + n, 0) / list.length : null);
  /*
   * ¿Puede dar más o hay que pedirle menos? Mira las 2 semanas antes de hoy:
   *   - cumplimiento: lo que hizo de lo planificado (las opcionales no cuentan),
   *   - esfuerzo: el RPE que puso frente al que se esperaba,
   *   - dolor y sensaciones que apuntó,
   *   - recuperación de los últimos 7 días frente a su media: sueño, VFC, pulso en reposo, fatiga (forma).
   * Devuelve subir / mantener / bajar con las razones. Nunca sube en descarga, afinamiento o carrera.
   */
  function weekAdvice({ week, calendarWeeks, recovery, today }) {
    const from = addDays(today, -14), to = addDays(today, -1);
    const workouts = (calendarWeeks || []).flatMap(w => w.workouts || [])
      .filter(w => String(w.workout_date) >= from && String(w.workout_date) <= to && !/^Opcional\s*·/i.test(String(w.title || '')) && !w.optional);
    const score = { completed: 1, partial: 0.5, changed: 0.75 };
    const done = workouts.reduce((sum, w) => sum + (score[w.execution_status] || 0), 0);
    const compliance = workouts.length >= 2 ? done / workouts.length : null;
    const rpeDiffs = workouts.map(w => {
      const rpe = Number(w.manual_log?.rpe), expected = expectedRpe(w);
      return Number.isFinite(rpe) && rpe > 0 && expected ? rpe - expected : null;
    }).filter(n => n !== null);
    const rpeDelta = rpeDiffs.length >= 2 ? avg(rpeDiffs) : null;
    const logs = workouts.map(w => w.manual_log).filter(Boolean);
    const pain = Math.max(0, ...logs.map(l => Number(l.pain) || 0));
    const painArea = logs.find(l => Number(l.pain) === pain && l.pain_area)?.pain_area || '';
    const badFeel = logs.filter(l => l.feeling === 'mal').length;

    // Recuperación: últimos 7 días frente a las 4 semanas anteriores.
    const rows = (recovery || []).filter(r => r.metric_date <= today);
    const last7 = rows.filter(r => r.metric_date >= addDays(today, -7));
    const baseRows = rows.filter(r => r.metric_date < addDays(today, -7) && r.metric_date >= addDays(today, -35));
    const mean = (list, key, scale = 1) => avg(list.map(r => Number(r[key])).filter(n => Number.isFinite(n) && n > 0).map(n => n / scale));
    const sleep = mean(last7, 'sleep_sec', 3600), sleepBase = mean(baseRows, 'sleep_sec', 3600);
    const hrv = mean(last7, 'hrv'), hrvBase = mean(baseRows, 'hrv');
    const rhr = mean(last7, 'resting_hr'), rhrBase = mean(baseRows, 'resting_hr');
    const formRow = [...rows].reverse().find(r => Number.isFinite(Number(r.form)) && r.form !== null);
    const form = formRow ? Number(formRow.form) : null;
    const recoveryBad = [], recoveryOk = [];
    if (sleep !== null && sleepBase !== null) (sleep < sleepBase - 0.75 ? recoveryBad : recoveryOk).push(sleep < sleepBase - 0.75 ? `Duerme menos de lo normal (${sleep.toFixed(1).replace('.', ',')} h frente a ${sleepBase.toFixed(1).replace('.', ',')} h).` : 'Duerme como siempre.');
    if (hrv !== null && hrvBase !== null) (hrv < hrvBase * 0.9 ? recoveryBad : recoveryOk).push(hrv < hrvBase * 0.9 ? `VFC más baja de lo normal (${Math.round(hrv)} frente a ${Math.round(hrvBase)}).` : 'VFC normal.');
    if (rhr !== null && rhrBase !== null) (rhr > rhrBase + 5 ? recoveryBad : recoveryOk).push(rhr > rhrBase + 5 ? `Pulso en reposo más alto (${Math.round(rhr)} frente a ${Math.round(rhrBase)}).` : 'Pulso en reposo normal.');
    if (form !== null && form < -25) recoveryBad.push(`Mucha fatiga acumulada (forma ${Math.round(form)}).`);

    // Regla 17: carga de los últimos 7 días frente a la media semanal de las 4 últimas semanas.
    const loads = [];
    (calendarWeeks || []).forEach(w => {
      (w.workouts || []).forEach(x => { const l = Number(x.actual?.load); if (l > 0) loads.push({ date: String(x.workout_date).slice(0, 10), load: l }); });
      (w.unplanned_activities || []).forEach(x => { const l = Number(x.load); if (l > 0) loads.push({ date: String(x.activity_date).slice(0, 10), load: l }); });
    });
    const sumLoad = (a, b) => loads.filter(x => x.date >= a && x.date <= b).reduce((sum, x) => sum + x.load, 0);
    const acute = sumLoad(addDays(today, -7), addDays(today, -1));
    const older = sumLoad(addDays(today, -28), addDays(today, -8));
    const acwr = older > 0 ? acute / ((acute + older) / 4) : null;

    const reasons = [];
    const add = (sign, text) => reasons.push({ sign, text });
    if (compliance !== null) add(compliance >= 0.9 ? 'ok' : compliance >= 0.6 ? 'mid' : 'bad', `Hizo ${String(Math.round(done * 10) / 10).replace('.', ',')} de ${workouts.length} sesiones de las 2 últimas semanas.`);
    if (rpeDelta !== null) add(rpeDelta <= -0.5 ? 'ok' : rpeDelta < 1 ? 'mid' : 'bad', rpeDelta <= -0.5 ? 'Le costaron menos de lo esperado (RPE más bajo del previsto).' : rpeDelta < 1 ? 'El esfuerzo fue el esperado.' : 'Le costaron más de lo esperado (RPE más alto del previsto).');
    if (pain >= 3) add('bad', `Apuntó dolor ${pain}/10${painArea ? ` (${painArea})` : ''}.`);
    if (badFeel >= 2) add('bad', `Malas sensaciones en ${badFeel} sesiones.`);
    if (acwr !== null) add(acwr > 1.5 ? 'bad' : acwr > 1.3 ? 'mid' : 'ok', acwr > 1.5 ? `La carga de esta semana es mucho más alta de lo habitual (${acwr.toFixed(1).replace('.', ',')} veces su media).` : acwr > 1.3 ? `La carga ha subido bastante respecto a lo habitual (${acwr.toFixed(1).replace('.', ',')} veces su media).` : 'La carga va en línea con lo habitual.');
    recoveryBad.forEach(text => add('bad', text));
    recoveryOk.forEach(text => add('ok', text));

    const hasData = compliance !== null || rpeDelta !== null || recoveryBad.length + recoveryOk.length > 0 || pain > 0 || acwr !== null;
    const protectedWeek = ['deload', 'recovery', 'taper', 'competition'].includes(week?.type);
    let decision = 'mantener', why;
    if (!hasData) why = 'No hay datos suficientes de las 2 últimas semanas: se prepara como estaba previsto.';
    else if (pain >= 3 || recoveryBad.length >= 2 || (rpeDelta !== null && rpeDelta >= 1.5) || (acwr !== null && acwr > 1.5)) {
      decision = 'bajar';
      why = pain >= 5 ? 'Con ese dolor conviene aflojar. Si sigue, usa «Ha pasado algo».' : 'Viene cargado: semana algo más corta y con una sola sesión dura.';
    } else if (compliance !== null && compliance >= 0.9 && rpeDelta !== null && rpeDelta <= -0.5 && !recoveryBad.length && badFeel < 2 && !(acwr > 1.3)) {
      decision = protectedWeek ? 'mantener' : 'subir';
      why = protectedWeek ? 'Viene bien, pero esta semana toca aflojar: se respeta.' : 'Viene bien: lo hace todo y le cuesta menos de lo previsto. Se puede subir un poco.';
    } else if (compliance !== null && compliance >= 0.9 && rpeDelta === null && !recoveryBad.length) {
      why = 'Lo está haciendo todo. Para saber si puede más, pídele que apunte el RPE de cada sesión.';
    } else if (compliance !== null && compliance < 0.6) {
      why = 'Está haciendo bastante menos de lo planificado: mejor no subir hasta que lo complete.';
    } else why = 'Va según lo previsto.';
    return {
      decision, ...ADJUST[decision], why, reasons, has_data: hasData, suggest_incident: pain >= 5,
      lessQuality: decision === 'bajar',
      data: { compliance, done, planned: workouts.length, rpe_delta: rpeDelta, pain, acwr, sleep, sleep_base: sleepBase, hrv, hrv_base: hrvBase, rhr, rhr_base: rhrBase, form },
    };
  }
  // La semana con el ajuste aplicado (más o menos minutos y, si se baja, una sola sesión dura).
  function adjustWeek(week, advice) {
    if (!advice || advice.decision === 'mantener') return week;
    const minutes = Math.round(week.minutes * advice.factor / 5) * 5;
    return { ...week, minutes, hours: Math.round(minutes / 6) / 10, load: Math.round(week.load * advice.factor), easier: Boolean(advice.lessQuality) };
  }
  function adjustNote(advice) {
    return advice && advice.decision !== 'mantener' ? `${ADJUST_PREFIX}${advice.decision}|${Math.round((advice.factor - 1) * 100)}` : '';
  }
  function readAdjust(notes) {
    const line = String(notes || '').split('\n').find(item => item.startsWith(ADJUST_PREFIX));
    if (!line) return null;
    const [decision, pct] = line.slice(ADJUST_PREFIX.length).split('|');
    return ADJUST[decision] ? { decision, pct: Number(pct) || 0, ...ADJUST[decision] } : null;
  }


  // ---------- Agente Planificador + Verificador ----------
  // El agente (Claude) parte SIEMPRE del cálculo del motor y solo puede retocarlo semana a semana:
  // cambiar el tipo de semana (p. ej. meter una descarga) o los minutos, como mucho un ±15 %.
  // El Verificador comprueba las reglas duras y, si alguna falla, la propuesta no se guarda.
  const AGENT_MAX_CHANGE = 0.15;
  const BUILD_TYPES = ['adaptation', 'load', 'development', 'overload'];
  const EASY_TYPES = ['deload', 'recovery'];
  const round5 = value => Math.round(value / 5) * 5;
  function applySeasonAdjustments(structure, adjustments) {
    const applied = [], ignored = [];
    (Array.isArray(adjustments) ? adjustments : []).slice(0, 60).forEach(item => {
      const week = structure.weeks.find(w => w.start === String(item?.start || item?.week_start || ''));
      if (!week) { ignored.push({ start: item?.start || item?.week_start || '', why: 'No hay ninguna semana del plan que empiece ese día (tiene que ser un lunes del plan).' }); return; }
      const base = week.agent || { base_minutes: week.minutes, base_type: week.type };
      const type = item.type && WEEK_TYPES[item.type] ? item.type : week.type;
      const minutes = Number(item.minutes) > 0 ? round5(Number(item.minutes)) : (type !== week.type ? round5(week.minutes * WEEK_TYPES[type].pct / WEEK_TYPES[week.type].pct) : week.minutes);
      const why = String(item.why || '').trim().slice(0, 600);
      // Referencia para el ±15 %: lo que pondría RunFlow para ese tipo de semana (una descarga ya baja sola).
      const reference = round5(base.base_minutes * WEEK_TYPES[type].pct / WEEK_TYPES[base.base_type].pct);
      Object.assign(week, {
        type, minutes, hours: Math.round(minutes / 6) / 10, load: Math.round(minutes * WEEK_TYPES[type].rpe), label: WEEK_TYPES[type].label,
        agent: { ...base, reference, why },
        why: why ? `Planificador: ${why} ${WEEK_TYPES[type].why}` : week.why,
      });
      applied.push({ start: week.start, type, minutes, base_type: base.base_type, base_minutes: base.base_minutes, reference, why });
    });
    return { structure, applied, ignored };
  }
  function verifySeason(answers, structure) {
    const failures = [], warnings = [];
    const fail = (rule, text, week) => failures.push({ rule, text, ...(week ? { week: week.start } : {}) });
    const weeks = structure.weeks || [];
    const race = structure.race || RACES[answers.race] || { taper: 1 };
    const level = structure.level || LEVELS[answers.level] || LEVELS.regular;
    const last = weeks[weeks.length - 1];
    if (!last || !(answers.race_date >= last.start && answers.race_date <= last.end)) fail('fecha_carrera', 'La última semana tiene que ser la de la carrera: la fecha de la carrera no se mueve.');
    else if (last.type !== 'competition') fail('fecha_carrera', 'La semana de la carrera tiene que ser de competición (poco volumen, mucho descanso).', last);
    const taperFrom = weeks.length - Math.min(race.taper, weeks.length);
    weeks.forEach((week, i) => {
      if (!WEEK_TYPES[week.type]) fail('tipo_semana', `Tipo de semana desconocido: ${week.type}.`, week);
      const inTaper = i >= taperFrom;
      if (inTaper && !['taper', 'competition'].includes(week.type)) fail('puesta_a_punto', `Las ${race.taper} últimas semanas son de puesta a punto: no se puede cargar justo antes de la carrera.`, week);
      if (!inTaper && ['taper', 'competition'].includes(week.type)) fail('puesta_a_punto', 'La puesta a punto solo va al final, antes de la carrera.', week);
      if (week.agent && week.agent.base_minutes > 0) {
        const reference = week.agent.reference || week.agent.base_minutes;
        const change = week.minutes / reference - 1;
        if (Math.abs(change) > AGENT_MAX_CHANGE + 0.02) fail('cambio_maximo', `Los minutos cambian un ${Math.round(change * 100)} % sobre lo que calcula RunFlow para una semana de ${WEEK_TYPES[week.type]?.label.toLowerCase() || week.type} (${reference} min). Como mucho ±${Math.round(AGENT_MAX_CHANGE * 100)} %.`, week);
        if (!week.agent.why) fail('justificacion', 'Cada cambio sobre el cálculo de RunFlow necesita un porqué.', week);
      }
    });
    // Regla 3: no subir más de un 10 % sobre la semana más alta anterior.
    let peak = 0;
    weeks.forEach(week => {
      if (!BUILD_TYPES.includes(week.type)) return;
      if (peak && week.minutes > round5(peak * 1.1) + 5) fail('progresion_10', `Sube de ${peak} a ${week.minutes} min: más de un 10 % sobre la semana más alta anterior.`, week);
      peak = Math.max(peak, week.minutes);
    });
    // Descargas: como mucho `cycle` semanas seguidas de carga sin bajar.
    let run = 0;
    weeks.forEach(week => {
      run = BUILD_TYPES.includes(week.type) ? run + 1 : 0;
      if (run === level.cycle + 1) fail('descarga', `Hay ${run} semanas seguidas de carga sin descarga (para su nivel, como mucho ${level.cycle}).`, week);
    });
    // La puesta a punto tiene que ser más suave que las semanas fuertes.
    weeks.filter(w => ['taper', 'competition'].includes(w.type)).forEach(week => {
      if (peak && week.minutes >= peak) fail('puesta_a_punto', `La puesta a punto (${week.minutes} min) no baja respecto a la semana más alta (${peak} min).`, week);
    });
    const available = (answers.days || []).filter(runsOn).reduce((sum, day) => sum + (Number(day.minutes) || 0), 0);
    if (available) weeks.forEach(week => { if (week.minutes > available) fail('disponibilidad', `Pide ${week.minutes} min y el atleta solo tiene ${available} min libres para correr a la semana.`, week); });
    const history = Number(answers.history_minutes) || 0;
    const firstBuild = weeks.find(w => BUILD_TYPES.includes(w.type));
    if (history && firstBuild && firstBuild.minutes > round5(Math.max(60, history * 1.1)) + 5) fail('punto_de_partida', `Empieza con ${firstBuild.minutes} min y venía corriendo ≈ ${Math.round(history)} min por semana: como mucho un 10 % más.`, firstBuild);
    if (!history) warnings.push('No hay historial de las últimas semanas: el punto de partida es una estimación.');
    return { ok: failures.length === 0, failures, warnings };
  }
  const HARD_TEXT = /series|intervalos|umbral|fartlek|tempo|vo2|cuestas|ritmo (de )?carrera|rpe\s*(7|8|9|10)/i;
  const isStrengthWorkout = w => Boolean(w?.is_strength) || /strength|fuerza|weight|gym/i.test(String(w?.sport || ''));
  const isHardWorkout = w => !isStrengthWorkout(w) && !w?.optional && (w?.priority === 'A' || w?.priority === 'B' || HARD_TEXT.test(`${w?.title || ''} ${w?.summary || ''}`));
  // Semana: fechas, días libres, minutos por día, nada duro dos días seguidos y, en rojo, nada duro.
  function verifyWeek({ weekStart, workouts, days, semaforo } = {}) {
    const failures = [];
    const fail = (rule, text, date) => failures.push({ rule, text, ...(date ? { date } : {}) });
    const end = addDays(weekStart, 6);
    const list = (workouts || []).filter(Boolean);
    const perDay = new Map();
    list.forEach(w => {
      const date = String(w.workout_date || '');
      if (!(date >= weekStart && date <= end)) { fail('fechas', `La sesión “${w.title || 'Sesión'}” (${date || 'sin fecha'}) está fuera de la semana ${weekStart} – ${end}.`, date); return; }
      if (!perDay.has(date)) perDay.set(date, []);
      perDay.get(date).push(w);
    });
    if (Array.isArray(days) && days.length) {
      const available = days.filter(runsOn).reduce((sum, day) => sum + (Number(day.minutes) || 0), 0);
      perDay.forEach((items, date) => {
        const day = days.find(d => d.day === dayIndex(date)) || { minutes: 0, types: [] };
        const required = items.filter(w => !w.optional);
        if (!required.length) return;
        if (!(Number(day.minutes) > 0)) { fail('dia_libre', `${DAYS[dayIndex(date)]} ${formatDate(date)}: el atleta no puede entrenar ese día.`, date); return; }
        const minutes = required.filter(w => !isStrengthWorkout(w)).reduce((sum, w) => sum + (Number(w.planned_duration_min) || 0), 0);
        if (minutes > Number(day.minutes) + 10) fail('minutos_dia', `${DAYS[dayIndex(date)]} ${formatDate(date)}: ${minutes} min y el atleta tiene ${day.minutes} min ese día.`, date);
        if (required.some(w => !isStrengthWorkout(w)) && !runsOn(day)) fail('tipo_dia', `${DAYS[dayIndex(date)]} ${formatDate(date)}: ese día no puede correr.`, date);
        if (required.some(isStrengthWorkout) && !canDo(day, 'strength') && !runsOn(day)) fail('tipo_dia', `${DAYS[dayIndex(date)]} ${formatDate(date)}: ese día no puede hacer fuerza.`, date);
        // Días con fuerza y minutos de fuerza en la ficha (fuerza guiada en gimnasio / sesión doble).
        if (day.strength_minutes) {
          const label = `${DAYS[dayIndex(date)]} ${formatDate(date)}`;
          const strength = required.filter(isStrengthWorkout);
          const other = required.filter(w => !isStrengthWorkout(w));
          const strengthMin = strength.reduce((sum, w) => sum + (Number(w.planned_duration_min) || 0), 0);
          if (strengthMin > day.strength_minutes + 10) fail('minutos_fuerza', `${label}: ${strengthMin} min de fuerza y la ficha dice ${day.strength_minutes} min.`, date);
          if (strength.length && other.length && !day.double) fail('sesion_doble', `${label}: ese día hace fuerza y la ficha no permite sesión doble (fuerza y otra actividad el mismo día).`, date);
          if (day.double && day.extra_easy && other.some(isHardWorkout)) fail('doble_suave', `${label}: en la sesión doble solo cabe algo suave (descarga) además de la fuerza, nada de calidad ni tirada larga.`, date);
        }
      });
      const total = list.filter(w => !w.optional && !isStrengthWorkout(w)).reduce((sum, w) => sum + (Number(w.planned_duration_min) || 0), 0);
      if (available && total > available * 1.1) fail('minutos_semana', `La semana suma ${total} min de carrera y el atleta tiene ${available} min libres.`);
    }
    const hardDates = [...perDay.entries()].filter(([, items]) => items.some(isHardWorkout)).map(([date]) => date).sort();
    hardDates.forEach((date, i) => { if (i && hardDates[i - 1] === addDays(date, -1)) fail('dias_duros_seguidos', `${formatDate(hardDates[i - 1])} y ${formatDate(date)}: dos días duros seguidos (tirada larga o calidad). Entre medias, un día suave o de descanso.`, date); });
    if (String(semaforo || '').toLowerCase() === 'rojo' && hardDates.length) fail('semaforo_rojo', `El Analista ha puesto el semáforo en rojo: esta semana no puede llevar sesiones duras (${hardDates.map(formatDate).join(', ')}).`);
    return { ok: failures.length === 0, failures };
  }

  return {
    courseOf, courseText,
    applySeasonAdjustments, verifySeason, verifyWeek, isHardWorkout, AGENT_MAX_CHANGE,
    historyFromActivities, weekAdvice, adjustWeek, adjustNote, readAdjust, expectedRpe, ADJUST, ADJUST_PREFIX,
    DAYS, DAYS_SHORT, PHASES, RACES, LEVELS, WEEK_TYPES, REASONS, MARKER, STRENGTH, EQUIPMENT, STRENGTH_RULES, ACTIVITIES,
    strengthPlanFor, equipmentOk, dayTypes, canDo, runsOn, strengthOnly, dayText,
    addDays, mondayOf, nextMonday, dayIndex, formatDate, rpeExplain, parseMain, parseTime,
    distribute, buildStructure, replan, buildWeekSessions, libRow,
    seasonPayload, goalPayloads, macroPayload, mesoPayload, microPayload, compactAnswers, readAnswers,
    daysFromProfile, phaseOfMeso, phaseOfMicro, structureFromPlan,
    INCIDENT_KINDS, STATES, ALTERNATIVES, INJURY_ZONES, RETURN_STEPS, PAIN_RULE, ADAPTED_PREFIX, PHASE_PREFIX,
    initialState, readIncidents, writeIncidents, activeIncident, buildAdaptedWeek, nextReturnStep, returnPlan,
  };
});
