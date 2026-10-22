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
  function strengthPlanFor(answers, race, phaseKey, weekType) {
    const chosen = Number(answers.strength) || 0;
    const base = STRENGTH[phaseKey] || STRENGTH.base;
    let families = race.trail && ['umbral', 'vo2', 'resistencia'].includes(phaseKey) ? ['Trail Eccentric', ...base.families] : base.families;
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
      summary: `Tienes ${totalWeeks} ${totalWeeks === 1 ? 'semana' : 'semanas'} hasta ${race.article} con el objetivo de ${goalText}. `
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
  function buildWeekSessions(answers, structure, week, libraryRows) {
    const rows = (libraryRows || []).map(libRow).filter(row => row.id && row.name);
    const race = structure.race, level = structure.level, phase = PHASES[week.phase];
    const allDays = (answers.days || []).filter(day => Number(day.minutes) > 0).sort((a, b) => a.day - b.day);
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

    // 1) Tirada larga (desde la base; no en descarga ni en semana de carrera)
    const longDay = daysUsable.find(day => day.day === Number(answers.long_day)) || daysUsable.slice().sort((a, b) => b.minutes - a.minutes)[0];
    const quietWeek = ['recovery', 'competition'].includes(week.type);
    const plan = new Map();
    if (longDay && !quietWeek && week.phase !== 'taper') {
      const family = race.trail && allowTrail(longDay) ? 'Long Trail' : 'Long Run';
      const cap = Math.min(longDay.minutes, race.longCap || 100, week.type === 'deload' ? 75 : 999, Math.max(40, Math.round(week.minutes * 0.4)));
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
    if (['recovery', 'competition'].includes(week.type)) qualityCount = week.type === 'competition' ? 1 : 0;
    if (week.type === 'deload') qualityCount = Math.min(qualityCount, 1);
    if (week.phase === 'prep' && answers.level === 'nuevo') qualityCount = 0;
    const free = daysUsable.filter(day => !plan.has(day.day));
    // Fuerza de la semana y días en los que cabe, según dónde caigan las sesiones duras.
    const sp = strengthPlanFor(answers, race, week.phase, week.type);
    const strengthEligible = allDays.filter(day => canDo(day, 'strength') && (raceDay < 0 || day.day < raceDay - 2));
    const strengthDaysFor = quality => {
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
      const limit = Math.min(day.minutes, easyMinutes + 5);
      const family = ['recovery', 'deload'].includes(week.type) || week.phase === 'taper' ? 'Recovery' : 'Easy';
      const row = pickRow(rows, runFilter(day, r => r.family === family), 1, 5, limit, new Set())
        || pickRow(rows, runFilter(day, r => ['Easy', 'Recovery'].includes(r.family)), 0, 5, day.minutes, new Set());
      if (row) plan.set(day.day, { row, role: family === 'Recovery' ? 'Rodaje muy suave' : 'Rodaje fácil', priority: 'C', objective: 'Sumar tiempo corriendo sin cansarse.' });
    });

    [...plan.entries()].sort((a, b) => a[0] - b[0]).forEach(([day, item]) => {
      const session = sessionFromRow(item.row, dateOf(day), {
        priority: item.priority, role: item.role, objective: item.objective,
        zone: item.row.family === 'Race Specific' ? race.zone : undefined,
      });
      // Si ese día solo puede hacer trail, la sesión va por montaña (y así lo entiende la disponibilidad).
      if (trailOnly(trainDays.find(d => d.day === day)) && !/trail|montaña|desnivel/i.test(session.title)) session.title += ' · por montaña';
      session.easy = /^Rodaje/.test(item.role);
      sessions.push(session);
    });

    // 4) Fuerza, periodizada con los bloques de carrera
    const chosen = strengthDaysFor(qualityDays);
    if (chosen.length) {
      chosen.sort((a, b) => a.day - b.day).forEach((day, i) => {
        // El rodaje de ese día pasa a ser una propuesta: lo importante es la fuerza.
        sessions.filter(s => s.easy && s.workout_date === dateOf(day.day)).forEach(makeOptional);
        const ranToday = sessions.filter(s => !s.optional && !s.is_strength && s.workout_date === dateOf(day.day)).reduce((sum, s) => sum + (Number(s.planned_duration_min) || 0), 0);
        if (answers.equipment === 'gimnasio_guiado') { sessions.push(guidedStrengthSession(sp, dateOf(day.day), (Number(day.minutes) || 60) - ranToday, ranToday > 0)); return; }
        const fam = sp.families[i % sp.families.length];
        const maxLevel = week.type === 'deload' ? Math.max(1, level.maxLib - 1) : Math.max(2, level.maxLib);
        const limit = Math.min(50, Math.max(20, (Number(day.minutes) || 50) - ranToday));
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
  function guidedStrengthSession(sp, date, minutes, afterRun) {
    const duration = Math.max(30, Math.min(Number(minutes) || 60, 60));
    const focus = sp.families.map(family => FAMILY_ES[family] || family).join('; ');
    const lines = [
      'Fuerza con el entrenador del gimnasio. RunFlow no marca los ejercicios: enséñale esto.',
      `Qué toca en esta fase (${sp.name.toLowerCase()}): ${sp.goal}`,
      `Qué trabajar: ${focus}.`,
      `Esfuerzo: ${sp.effort}`,
      'Es un corredor: piernas y tronco primero; si propone mucho volumen de piernas, mejor menos series y con buena técnica.',
      afterRun && 'Hoy también corre: la fuerza, después de correr.',
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
      event_type: structure.race.label, goal_type: 'competition', priority_code: 'A', distance_km: structure.race.distance_km,
      target_time_sec: answers.goal_mode === 'marca' ? parseTime(answers.target_time) : null,
      performance_target: answers.goal_mode === 'marca' && answers.target_time ? `Bajar de ${answers.target_time}` : 'Terminarla en buen estado',
    };
    const others = (answers.other_races || []).filter(item => item.date && item.date >= structure.start && item.date < answers.race_date).map(item => ({
      season_id: seasonId, name: item.name || 'Carrera de preparación', goal_date: item.date, sport: 'Run', event_type: 'Carrera de preparación', goal_type: 'competition', priority_code: 'B',
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
      primary_objective: week.b_race ? `${meso.goal} Esta semana hay carrera de preparación (${week.b_race.name || 'objetivo B'}): úsala como sesión de calidad.` : meso.goal,
      planned: { hours: week.hours, distance_km: 0, elevation_m: 0, load: workouts && workouts.length ? workouts.filter(w => !w.optional).reduce((sum, w) => sum + (Number(w.planned_load) || 0), 0) : week.load, strength_sessions: strength },
      lifecycle_status: 'planned', publication_status: 'draft',
      recovery_target: ['deload', 'recovery', 'taper', 'competition'].includes(week.type) ? week.why : '',
      notes: `${week.label}: ${week.why}`,
      ...(workouts ? { workouts } : {}),
    };
  }

  function compactAnswers(a) {
    return {
      v: 1, race: a.race, race_date: a.race_date, race_name: a.race_name || '', goal_mode: a.goal_mode, target_time: a.target_time || '',
      level: a.level, injuries: a.injuries || '', long_day: a.long_day, strength: a.strength, equipment: a.equipment || 'gimnasio', start_date: a.start_date,
      days: (a.days || []).map(d => ({ day: d.day, minutes: d.minutes, types: dayTypes(d) })), other_races: a.other_races || [],
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

  return {
    DAYS, DAYS_SHORT, PHASES, RACES, LEVELS, WEEK_TYPES, REASONS, MARKER, STRENGTH, EQUIPMENT, STRENGTH_RULES, ACTIVITIES,
    strengthPlanFor, equipmentOk, dayTypes, canDo, runsOn,
    addDays, mondayOf, nextMonday, dayIndex, formatDate, rpeExplain, parseMain, parseTime,
    distribute, buildStructure, replan, buildWeekSessions, libRow,
    seasonPayload, goalPayloads, macroPayload, mesoPayload, microPayload, compactAnswers, readAnswers,
  };
});
