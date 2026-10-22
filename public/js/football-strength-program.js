// RunFlow Fútbol · programa de fuerza guiado.
// Con unas pocas respuestas (días, temporada, semanas, objetivo, nivel y material) genera un mesociclo completo:
// sesiones A/B de 6 bloques (preparación, pliometría, fuerza principal, fuerza específica, tren superior + core y
// transferencia), 4 fases de progresión y una guía de esfuerzo en cada ejercicio. Lo usan el Coach y los tests.
(function (root, factory) {
  const api = factory(root.RunFlowFootballSchedule || (typeof require === 'function' ? require('./football-schedule.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunFlowStrengthProgram = api;
}(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  const OPTIONS = {
    days_per_week: [
      { value: 1, label: '1 día', hint: 'Mantenimiento. Mejor que nada, pero progresa poco.' },
      { value: 2, label: '2 días', hint: 'Recomendado: sesión A y sesión B con 48–72 h entre ellas.', recommended: true },
      { value: 3, label: '3 días', hint: 'Solo con experiencia y pocos partidos. La tercera es más corta.' },
    ],
    season: [
      { value: 'pre', label: 'Pretemporada', hint: 'Más volumen: es el mejor momento para construir fuerza.' },
      { value: 'inicio', label: 'Inicio de liga', hint: 'Volumen normal, respetando el partido.' },
      { value: 'media', label: 'Mitad de liga', hint: 'Una serie menos en la fuerza para llegar frescos.' },
      { value: 'final', label: 'Final de temporada', hint: 'Mantener lo ganado con poco volumen.' },
    ],
    minutes: [
      { value: 30, label: '30 minutos', hint: 'Lo esencial: preparación, saltos, fuerza principal y específico con core.' },
      { value: 45, label: '45 minutos', hint: 'Casi todo: la transferencia se junta con los saltos y hay algo menos de volumen.' },
      { value: 60, label: '60 minutos', hint: 'La sesión completa de 6 partes.', recommended: true },
    ],
    weeks: [
      { value: 4, label: '4 semanas' }, { value: 6, label: '6 semanas' }, { value: 8, label: '8 semanas', recommended: true, hint: '16 sesiones con 2 días.' },
      { value: 10, label: '10 semanas' }, { value: 12, label: '12 semanas' },
    ],
    focus: [
      { value: 'equilibrado', label: 'Equilibrado', hint: 'Fuerza, salto, aceleración y prevención por igual.', recommended: true },
      { value: 'aceleracion', label: 'Aceleración', hint: 'Más sprints cortos y salto + sprint.' },
      { value: 'salto', label: 'Salto y potencia', hint: 'Más saltos verticales en la sesión A.' },
      { value: 'cod', label: 'Cambio de dirección', hint: 'Más frenadas y cambios de dirección.' },
      { value: 'prevencion', label: 'Prevención de lesiones', hint: 'Más nórdico y Copenhague (isquios y aductores).' },
    ],
    level: [
      { value: 'inicial', label: 'Iniciación', hint: 'Sin experiencia o aún aprendiendo la técnica (p. ej. 12–13 años). Regresiones y poca carga.' },
      { value: 'intermedio', label: 'Intermedio', hint: 'Técnica buena en sentadilla, zancada y peso muerto.', recommended: true },
      { value: 'avanzado', label: 'Avanzado', hint: 'Domina la técnica (p. ej. 15–16 años con experiencia). Más carga y variantes difíciles.' },
    ],
    material: [
      { value: 'corporal', label: 'Peso corporal y gomas', hint: 'Sin pesas: variantes con el propio cuerpo.' },
      { value: 'mancuernas', label: 'Mancuernas o kettlebells', hint: 'Lo habitual en un gimnasio pequeño.', recommended: true },
      { value: 'gimnasio', label: 'Gimnasio completo', hint: 'Barra, trap bar, banco, TRX…' },
    ],
  };
  const label = (key, value) => OPTIONS[key]?.find(o => o.value === value)?.label || '';

  const RULES = [
    'Nunca al fallo: deja normalmente 2–3 repeticiones en reserva.',
    'Técnica perfecta antes de subir peso.',
    'Los saltos se paran cuando pierden altura o el aterrizaje hace ruido.',
    'Los sprints, con descanso completo: salir rápidos, no cansados.',
    'No hacer 1RM ni series hasta no poder más.',
    'Se progresa por técnica, no por edad: el mismo patrón con otra carga o una variante más fácil.',
  ];

  const PHASES = {
    aprender: { label: 'Aprender a moverse', goal: 'Técnica y control. Posiciones perfectas, sin agujetas.', rpe: '5–6', rir: '3–4',
      effort: 'RPE 5–6: deberías poder hacer 3–4 repeticiones más. Peso ligero, técnica perfecta. Si dudas, no subas.' },
    fuerza: { label: 'Construir fuerza', goal: 'Empezar a cargar de verdad.', rpe: '7', rir: '2–3',
      effort: 'RPE 7: la última repetición cuesta pero sale limpia y te quedan 2–3 más. Si te sobran más de 4, sube un poco la próxima vez; si la técnica se rompe, baja.' },
    potencia: { label: 'Convertir fuerza en potencia', goal: 'Mismo volumen, más intención de velocidad.', rpe: '7', rir: '2–3',
      effort: 'RPE 7: peso parecido a la fase anterior, pero cada repetición lo más rápida posible en la subida. Deja 2–3 en reserva.' },
    explosivo: { label: 'Fútbol explosivo', goal: 'Mantener la fuerza con menos volumen y transferirla al campo.', rpe: '6–7', rir: '2–3',
      effort: 'RPE 6–7: menos series, máxima calidad y velocidad. Hay que salir del gimnasio sintiéndose rápido, no destrozado.' },
    cierre: { label: 'Cierre y test', goal: 'Volumen un 25 % menor, medir progresos y acabar con buena sensación.', rpe: '6', rir: '3',
      effort: 'RPE 6: nada de máximos. Calidad y velocidad; los test, con descanso completo entre intentos.' },
  };

  // Sesiones según el tiempo que tiene el deportista: minutos por parte y cuántos ejercicios entran.
  // 45 min: la transferencia se junta con la pliometría. 30 min: lo esencial de fuerza + específico con core; el tren superior queda para el otro día.
  const DURATION = {
    60: { minutes: { prep: 8, plyo: 10, main: 18, comp: 10, upper: 9, transfer: 5 }, max: {} },
    45: { minutes: { prep: 6, plyo: 7, main: 15, comp: 8, upper: 7, transfer: 0 }, max: { prep: 3, plyo: 3, comp: 2, upper: 2, transfer: 0 } },
    30: { minutes: { prep: 5, plyo: 5, main: 12, comp: 8, upper: 0, transfer: 0 }, max: { prep: 2, plyo: 2, main: 2, comp: 1, upper: 0, transfer: 0 } },
  };
  const CORE_SLOTS = ['pallof', 'sideplank', 'deadbug'];
  const SPRINT_SLOTS = ['accel', 'cod45', 'cod90', 'react', 'decel', 'jumpsprint'];
  const PREVENT_SLOTS = ['nordic', 'copen', 'curl'];
  function sectionPlan(minutes) {
    const d = DURATION[minutes] || DURATION[60];
    return ORDER.filter(k => d.minutes[k] > 0).map(k => ({ key: k, name: k === 'comp' && Number(minutes) === 30 ? 'Fuerza específica y core' : SECTIONS[k].name, minutes: d.minutes[k] }));
  }

  const SECTIONS = {
    prep: { name: 'Preparación y movilidad', minutes: 8, rest: 15, effort: () => 'Suave y controlado: preparar posiciones, no cansarse.' },
    plyo: { name: 'Reactividad y pliometría', minutes: 10, rest: 45, effort: () => 'Máxima calidad: pocos contactos y buenos. Para si pierdes altura o el aterrizaje hace ruido.' },
    main: { name: 'Fuerza principal', minutes: 18, rest: 90, effort: p => `Peso: deja ${p.rir} repeticiones en reserva (RPE ${p.rpe}). Nunca al fallo.` },
    comp: { name: 'Fuerza específica del futbolista', minutes: 10, rest: 60, effort: p => `Controlado, dejando ${p.rir} repeticiones en reserva.` },
    upper: { name: 'Tren superior y core', minutes: 9, rest: 45, effort: p => `Deja ${p.rir} repeticiones en reserva; en el core, tronco quieto.` },
    transfer: { name: 'Transferencia', minutes: 5, rest: 75, effort: () => 'Al 100 % y con descanso completo (60–90 s). Sin convertirlo en cansancio.' },
  };

  // Ejercicio de la biblioteca para cada hueco según nivel, material y fase (0–3).
  const SLOTS = {
    ankle: 'Rodilla a la pared', hip9090: 'Cadera 90/90', bridge: 'Puente de glúteo', deadbug: 'Dead bug', rockback: 'Balanceo de aductor',
    band: 'Paso lateral con banda', bear: 'Oso (bear crawl)',
    snap: 'Snap down', pogo: 'Pogos reactivos', wall: 'Arrancada en pared', accel: 'Aceleraciones cortas', broad: 'Salto horizontal',
    cmj: 'Salto con contramovimiento', lateral: 'Saltos laterales de patinador', drop: 'Aterrizaje desde cajón bajo', hurdle: 'Saltos de vallas bajas',
    split: c => c.level === 'avanzado' || (c.level === 'intermedio' && c.phase >= 2) ? 'Sentadilla búlgara' : 'Split squat',
    squat: c => c.material === 'corporal' ? 'Sentadilla al cajón' : c.level === 'avanzado' && c.material === 'gimnasio' && c.phase >= 1 ? 'Sentadilla frontal' : 'Sentadilla goblet',
    rdl: c => c.material === 'corporal' ? 'Peso muerto a 1 pierna' : 'Peso muerto rumano',
    hip: c => c.material === 'corporal' ? 'Puente de glúteo a 1 pierna' : c.level === 'avanzado' && c.material === 'gimnasio' && c.phase >= 1 ? 'Peso muerto con trap bar' : 'Hip thrust',
    nordic: 'Nórdico asistido', curl: 'Curl de isquios deslizante', calf: 'Elevación de gemelos a 1 pierna', soleus: 'Elevación de sóleo sentado',
    tibial: 'Elevación de tibial', rdl1: 'Peso muerto a 1 pierna', stepup: 'Subida al cajón',
    copen: c => c.level === 'avanzado' && c.phase >= 2 ? 'Copenhague largo' : 'Copenhague corto',
    row: c => c.material === 'corporal' || c.level === 'inicial' ? 'Remo invertido' : 'Remo con mancuerna',
    pull: c => c.level === 'avanzado' ? 'Dominada asistida' : 'Remo invertido',
    push: 'Flexiones', explpush: c => c.level === 'inicial' ? 'Flexiones' : 'Flexión explosiva',
    press: c => c.material === 'corporal' ? 'Flexiones' : 'Press de pecho con mancuerna',
    vpress: c => c.material === 'corporal' ? 'Plancha con toque de hombro' : 'Press de hombro con mancuerna',
    pallof: 'Pallof press', carry: c => c.material === 'corporal' ? 'Oso (bear crawl)' : 'Paseo del granjero', sideplank: 'Plancha lateral',
    decel: 'Frenada en 3 pasos', cod45: 'Cambio de dirección a 45°', cod90: 'Cambio de dirección a 90°', react: 'Reacción + cambio de dirección',
    jumpsprint: 'Salto + sprint',
  };
  // Notas de regresión para iniciación.
  const BEGINNER_NOTES = {
    nordic: 'Muy asistido: frena solo la primera mitad de la bajada.', copen: 'Con la rodilla apoyada en el banco.',
    drop: 'Desde poca altura (15–20 cm).', squat: 'Peso corporal o kettlebell ligera.', split: 'Primero sin peso; después mancuernas ligeras.',
    rdl: 'Kettlebell ligera; la técnica manda.', hurdle: 'Vallas muy bajas o líneas en el suelo.',
  };

  // [hueco, series, trabajo, nota]. Series y trabajo pueden ser listas: un valor por semana dentro de la fase (0 = ese día no se hace).
  const PREP_A = [['ankle', 1, '8 / pierna'], ['hip9090', 1, '6 / lado'], ['bridge', 2, '8 reps'], ['deadbug', 2, '6 / lado']];
  const PREP_B = [['ankle', 1, '8 / pierna'], ['rockback', 1, '8 / lado'], ['band', 1, '10 pasos / lado'], ['bear', 2, '10 m']];
  const SESSIONS = {
    aprender: {
      A: { title: 'Base + aceleración', prep: PREP_A,
        plyo: [['snap', 2, '5 reps'], ['pogo', 2, ['10 reps', '12 reps']], ['wall', 2, '5 / pierna'], ['accel', [3, 4, 4], '5 m']],
        main: [['split', 3, ['6 / pierna', '7 / pierna']], ['row', 3, '8 reps']],
        comp: [['rdl', [2, 3], '8 reps'], ['calf', 2, ['10 / pierna', '12 / pierna']]],
        upper: [['push', 2, '8–12 reps'], ['pallof', 2, '8 / lado'], ['carry', 2, '15–20 m']],
        transfer: [['accel', 3, '10 m', 'Técnicamente perfectos.']] },
      B: { title: 'Aterrizaje + fuerza general', prep: PREP_B,
        plyo: [['snap', 2, '5 reps', 'Caída desde puntillas y bloqueo.'], ['cmj', 3, '3 reps'], ['lateral', [2, 3], '3 / lado', 'Aguanta el aterrizaje 2 s.']],
        main: [['squat', 3, ['6 reps', '7 reps']], ['push', 3, '8–10 reps']],
        comp: [['hip', [2, 3], '8 reps'], ['copen', 2, ['15 s / lado', '20 s / lado']]],
        upper: [['row', 2, '10 reps'], ['sideplank', 2, '20 s / lado'], ['soleus', 2, '12 reps']],
        transfer: [['decel', [3, 4], '1 / lado', 'Frenada desde 5 m.']] },
    },
    fuerza: {
      A: { title: 'Fuerza + aceleración', prep: PREP_A,
        plyo: [['pogo', 2, '10 reps'], ['broad', 3, ['3 reps', '2 reps']], ['accel', 4, '10 m']],
        main: [['split', 3, '6 / pierna'], ['row', 3, '8 reps']],
        comp: [['rdl', 3, '6 reps'], ['nordic', 2, ['3–4 reps', '4 reps']], ['calf', [0, 3], '8 / pierna', 'Más pesado.']],
        upper: [['push', 3, '8 reps'], ['pallof', 2, '8 / lado'], ['carry', 2, '20 m']],
        transfer: [['accel', 2, '10 m']] },
      B: { title: 'Potencia + fuerza', prep: PREP_B,
        plyo: [['drop', 2, '4 reps', 'Caída y bloqueo.'], ['cmj', 3, '3 reps'], ['lateral', 2, '4 / lado'], ['hurdle', [0, 3], '3 reps']],
        main: [['squat', 3, '6 reps'], ['press', 3, '8 reps']],
        comp: [['hip', 3, ['6–8 reps', '6 reps']], ['copen', 2, ['20 s / lado', '20–25 s / lado']]],
        upper: [['row', 2, '8 reps'], ['soleus', 3, '10 reps']],
        transfer: [['cod45', [3, 0], '3 / lado'], ['cod90', [0, 3], '3 / lado']] },
    },
    potencia: {
      A: { title: 'Fuerza + potencia horizontal', prep: PREP_A,
        plyo: [['pogo', 2, '10 reps'], ['broad', 3, '2 reps'], ['accel', 4, '10 m']],
        main: [['broad', [0, 3], '2 reps', 'Contraste: 2 saltos, descansa 30 s y haz la zancada.'], ['split', 3, '5 / pierna'], ['row', 3, '6–8 reps']],
        comp: [['rdl', 3, ['5–6 reps', '5 reps']], ['nordic', [3, 2], ['3 reps', '4 reps']]],
        upper: [['explpush', 3, '5 reps'], ['pallof', 2, '8 / lado'], ['carry', 2, '15 m', 'Pesado.']],
        transfer: [['accel', [2, 3], ['15 m', '10 m']]] },
      B: { title: 'Potencia vertical', prep: PREP_B,
        plyo: [['pogo', 2, '10 reps'], ['cmj', [4, 0], '2 reps'], ['hurdle', 3, '3 reps']],
        main: [['squat', 3, '5 reps'], ['cmj', [0, 3], '2 reps', 'Contraste: 60–90 s después de la sentadilla.'], ['press', 3, '6 reps']],
        comp: [['hip', 3, '5–6 reps'], ['copen', 2, ['20 s / lado', '20–25 s / lado']]],
        upper: [['soleus', 3, '8 reps', 'Pesado.'], ['tibial', 2, '12 reps'], ['row', [0, 2], '8 reps']],
        transfer: [['react', 3, '3 / lado']] },
    },
    explosivo: {
      A: { title: 'Fútbol explosivo · horizontal', prep: PREP_A,
        plyo: [['pogo', 2, '8 reps', 'Rápido.'], ['broad', 3, '2 reps'], ['accel', 3, '10 m']],
        main: [['split', 3, '4 / pierna'], ['rdl', 3, '5 reps']],
        comp: [['nordic', 2, '3 reps'], ['calf', 2, '8 / pierna', 'Pesado.']],
        upper: [['row', 2, '6 reps'], ['explpush', 2, '6 reps'], ['carry', 2, '20 m']],
        transfer: [['accel', 2, '15 m']] },
      B: { title: 'Fútbol explosivo · vertical', prep: PREP_B,
        plyo: [['pogo', 2, '8 reps'], ['cmj', 3, '2 reps'], ['hurdle', 3, '2 reps']],
        main: [['squat', 3, '4–5 reps'], ['hip', 3, '5 reps']],
        comp: [['copen', 2, '20 s / lado'], ['soleus', 2, '8 reps']],
        upper: [['vpress', 2, '6 reps'], ['pull', 2, '6 reps']],
        transfer: [['react', 3, '3 / lado']] },
    },
    cierre: {
      A: { title: 'Calidad máxima', prep: PREP_A,
        plyo: [['broad', 3, '2 reps'], ['accel', 3, '10 m']],
        main: [['split', 2, '5 / pierna'], ['rdl', 2, '5 reps']],
        comp: [['nordic', 2, '3 reps']],
        upper: [['row', 2, '8 reps'], ['push', 2, '8 reps'], ['carry', 2, '20 m']],
        transfer: [['accel', 2, '10 m']] },
      B: { title: 'Cierre y test', prep: PREP_B,
        plyo: [['broad', 3, '1 intento', 'TEST: apunta el mejor salto.'], ['cmj', 3, '1 intento', 'TEST: si podéis medirlo.'], ['accel', 3, '10 m', 'TEST: cronometra si tenéis fotocélulas.']],
        main: [['squat', 2, '5 reps', 'Técnica, nada de máximo.'], ['hip', 2, '6 reps']],
        comp: [['copen', 2, '15 s / lado'], ['calf', 2, '10 / pierna']],
        upper: [['row', 2, '8 reps']],
        transfer: [['react', 3, '3 / lado', 'Competición por parejas: acabar con buena sensación.']] },
    },
  };
  const FOCUS_EXTRA = {
    aceleracion: { A: { transfer: [['accel', 1, '10 m', 'Extra de aceleración.']] }, B: { transfer: [['jumpsprint', 2, '1 rep']] } },
    salto: { A: { plyo: [['cmj', 2, '3 reps', 'Extra de salto vertical.']] }, B: { plyo: [['lateral', 2, '3 / lado']] } },
    cod: { A: { transfer: [['cod45', 2, '2 / lado']] }, B: { transfer: [['decel', 2, '1 / lado']] } },
    prevencion: { A: { comp: [['copen', 2, '20 s / lado']] }, B: { comp: [['nordic', 2, '3–4 reps'], ['tibial', 2, '12 reps']] } },
  };
  const ORDER = ['prep', 'plyo', 'main', 'comp', 'upper', 'transfer'];

  // ---------- fases ----------
  function phasePlan(weeks) {
    const n = Math.max(1, Math.min(16, Number(weeks) || 8));
    const keys = ['aprender', 'fuerza', 'potencia', 'explosivo'];
    const counts = keys.map(() => Math.floor(n / 4));
    let rest = n - counts.reduce((a, b) => a + b, 0);
    [1, 0, 2].forEach(i => { if (rest > 0) { counts[i] += 1; rest -= 1; } });
    const out = []; let week = 0;
    keys.forEach((key, phase) => { for (let i = 0; i < counts[phase]; i++) out.push({ week: week++, key, phase, inPhase: i }); });
    if (n >= 6) out[n - 1] = { ...out[n - 1], key: 'cierre' };
    return out;
  }

  // ---------- días de fuerza ----------
  function chooseDays(answers) {
    const k = Math.max(1, Math.min(3, Number(answers.days_per_week) || 2));
    const m = answers.match_day === null || answers.match_day === undefined || answers.match_day === '' ? null : Number(answers.match_day);
    const md = d => m === null ? null : ((m - d + 7) % 7); // días que faltan para el partido
    const blocked = d => m !== null && [0, 1, 6].includes(md(d)); // MD, MD-1 y MD+1
    const prefer = d => { const x = md(d); return x === null ? 0 : x === 4 ? 3 : x === 3 || x === 2 ? 2 : x === 5 ? 1 : 0; };
    const allowed = [0, 1, 2, 3, 4, 5, 6].filter(d => !blocked(d));
    let best = null;
    const combos = (start, acc) => {
      if (acc.length === k) {
        const gaps = acc.map((d, i) => (acc[(i + 1) % k] - d + 7) % 7 || 7);
        // Primero al menos 48 h entre sesiones, después los días preferidos respecto al partido (MD-4, MD-3/MD-2) y después más separación.
        const score = [Math.min(2, ...gaps), acc.reduce((s, d) => s + prefer(d), 0), Math.min(...gaps), -acc[0]];
        const better = !best || (() => { for (let i = 0; i < score.length; i++) if (score[i] !== best.score[i]) return score[i] > best.score[i]; return false; })();
        if (better) best = { days: acc.slice(), score };
        return;
      }
      for (let i = start; i < allowed.length; i++) combos(i + 1, [...acc, allowed[i]]);
    };
    combos(0, []);
    return best ? best.days : [1, 3, 5].slice(0, k);
  }
  function mdText(day, matchDay) {
    if (matchDay === null || matchDay === undefined || matchDay === '') return '';
    const x = (Number(matchDay) - day + 7) % 7;
    return x === 0 ? 'MD' : x <= 3 ? `MD-${x}` : x >= 5 ? `MD+${7 - x}` : 'MD-4';
  }

  // ---------- generación ----------
  const pickAt = (value, i) => Array.isArray(value) ? value[Math.min(i, value.length - 1)] : value;
  function libraryEntry(name) { return S.STRENGTH_LIBRARY.find(e => e.name === name) || { name, work: '', note: '', why: '', steps: [], cues: '', video: '' }; }

  function buildSession(phaseKey, letter, ctx) {
    const spec = SESSIONS[phaseKey][letter === 'C' ? 'A' : letter];
    const phase = PHASES[phaseKey];
    const extra = FOCUS_EXTRA[ctx.focus]?.[letter === 'C' ? 'A' : letter] || {};
    const used = new Set(), stations = [];
    const duration = DURATION[ctx.minutes] || DURATION[60];
    ORDER.forEach(sectionKey => {
      const section = SECTIONS[sectionKey];
      const max = duration.max[sectionKey] ?? Infinity;
      let items = [...(spec[sectionKey] || []), ...(extra[sectionKey] || [])].filter(([, setsSpec]) => pickAt(setsSpec, ctx.inPhase));
      const minutes = Number(ctx.minutes) || 60;
      if (minutes === 45 && sectionKey === 'plyo') {
        // La transferencia (sprint o cambio de dirección) se junta con los saltos.
        const sprint = [...(spec.transfer || []), ...(extra.transfer || []), ...items].find(([slot, setsSpec]) => SPRINT_SLOTS.includes(slot) && pickAt(setsSpec, ctx.inPhase));
        items = [...items.filter(([slot]) => !SPRINT_SLOTS.includes(slot)).slice(0, max - (sprint ? 1 : 0)), ...(sprint ? [sprint] : [])];
      } else if (minutes === 30 && sectionKey === 'comp') {
        // Con 30 min: un ejercicio preventivo (nórdico, Copenhague…) y el core del tren superior.
        const prevent = items.find(([slot]) => PREVENT_SLOTS.includes(slot)) || items[0];
        const core = (spec.upper || []).find(([slot]) => CORE_SLOTS.includes(slot)) || ['pallof', 2, '8 / lado'];
        items = [...(prevent ? [prevent] : []), core];
      } else items = items.slice(0, max);
      const sectionName = sectionKey === 'comp' && Number(ctx.minutes) === 30 ? 'Fuerza específica y core' : section.name;
      items.forEach(([slot, setsSpec, workSpec, note]) => {
        let sets = pickAt(setsSpec, ctx.inPhase);
        if (!sets) return;
        const strength = sectionKey === 'main' || sectionKey === 'comp';
        if (strength && (ctx.season === 'media' || ctx.season === 'final')) sets = Math.max(2, sets - 1);
        if (strength && ctx.season === 'pre' && sectionKey === 'main' && phaseKey !== 'cierre') sets = Math.min(4, sets + 1);
        if (letter === 'C' && strength) sets = Math.max(2, sets - 1);
        if (ctx.level === 'inicial' && strength) sets = Math.min(sets, 3);
        const ref = typeof SLOTS[slot] === 'function' ? SLOTS[slot](ctx) : SLOTS[slot];
        // El mismo ejercicio puede repetirse en otra parte (p. ej. aceleraciones en pliometría y en transferencia), no en la misma.
        if (!ref || used.has(`${sectionKey}|${ref}`)) return;
        used.add(`${sectionKey}|${ref}`);
        const lib = libraryEntry(ref);
        const notes = [note, ctx.level === 'inicial' ? BEGINNER_NOTES[slot] : ''].filter(Boolean).join(' ');
        stations.push({
          name: lib.name, work: pickAt(workSpec, ctx.inPhase), note: notes || lib.note || '', why: lib.why || '', steps: (lib.steps || []).slice(), cues: lib.cues || '',
          video: lib.video || '', img: '', section: sectionName, sets, rest_sec: section.rest, effort: section.effort(phase),
        });
      });
    });
    return stations;
  }

  // Devuelve los bloques y eventos del calendario (fechas concretas) y un resumen para enseñar antes de crear.
  function generate(answers) {
    const a = S.sanitizeStrengthPlan({ ...answers }) || {};
    const weeks = a.weeks || 8;
    const days = (a.strength_days && a.strength_days.length === a.days_per_week ? a.strength_days : chooseDays(a)).slice().sort();
    const start = a.start || nextMonday(S.todayMadrid());
    const monday = S.mondayOf(start);
    const letters = days.length === 1 ? null : days.length === 2 ? ['A', 'B'] : ['A', 'B', 'C'];
    const plan = phasePlan(weeks);
    const blocks = [], events = [], sessions = [];
    plan.forEach(w => {
      const phase = PHASES[w.key];
      days.forEach((day, i) => {
        const letter = letters ? letters[i] : (w.week % 2 ? 'B' : 'A');
        let date = S.addDays(monday, w.week * 7 + day);
        if (date < start) date = null;
        const ctx = { ...a, phase: w.phase, inPhase: w.inPhase };
        const stations = buildSession(w.key, letter, ctx);
        const spec = SESSIONS[w.key][letter === 'C' ? 'A' : letter];
        const id = `gp-s${w.week + 1}${letter.toLowerCase()}`;
        const name = `S${w.week + 1} · Sesión ${letter} · ${letter === 'C' ? `${spec.title} (corta)` : spec.title}`;
        const block = {
          id, name, objective: `${phase.label}: ${phase.goal}`, format: 'sets', rounds: 2, transition_sec: 60, rest_sec: 20,
          stations, effort: phase.effort, plan: `${w.week + 1}/${weeks}`,
        };
        blocks.push(block);
        // Duración real de la sesión (incluye montaje y cambios), no la suma de repeticiones.
        const minutes = letter === 'C' || w.key === 'cierre' ? Math.min(45, a.minutes || 60) : (a.minutes || 60);
        if (date) events.push({ id: `gp${w.week + 1}${letter.toLowerCase()}`, date, kind: 'strength', strength_id: id, time: '', duration_min: minutes, place: '', note: `Semana ${w.week + 1} de ${weeks} · ${phase.label}` });
        sessions.push({ week: w.week + 1, phase: w.key, letter, date, name, minutes, exercises: stations.length });
      });
    });
    const phases = [];
    plan.forEach(w => { const last = phases[phases.length - 1]; if (last && last.key === w.key) last.to = w.week + 1; else phases.push({ key: w.key, label: PHASES[w.key].label, goal: PHASES[w.key].goal, effort: PHASES[w.key].effort, from: w.week + 1, to: w.week + 1 }); });
    return { answers: { ...a, start, strength_days: days }, days, blocks, events, sessions, phases };
  }
  function nextMonday(today) { return S.dayIndex(today) === 0 ? today : S.addDays(S.mondayOf(today), 7); }
  const isGuided = id => String(id || '').startsWith('gp-');

  return { OPTIONS, RULES, PHASES, SECTIONS, DURATION, sectionPlan, label, phasePlan, chooseDays, mdText, generate, nextMonday, isGuided };
}));
