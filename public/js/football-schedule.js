// RunFlow Fútbol · semana del deportista, partidos y circuitos de fuerza.
// Módulo compartido: lo usan el servidor (football-api-hook.js), el Coach y la app del deportista.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunFlowFootballSchedule = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const WEEK_KINDS = ['football_training', 'strength', 'rest'];
  const EVENT_KINDS = ['match', 'football_training', 'strength', 'rest', 'cancel'];
  const RATED_KINDS = ['football_training', 'strength', 'match'];
  // Carga de sesión = minutos × RPE. El partido pesa un 30 % más: contactos, sprints y tensión competitiva
  // que el RPE solo no recoge (90 min de entreno a RPE 7 = 630; 90 min de partido a RPE 7 = 819).
  const MATCH_LOAD_FACTOR = 1.3;
  const sessionLoad = (kind, minutes, rpe) => {
    const m = Number(minutes), r = Number(rpe);
    if (!(m > 0) || !(r > 0)) return null;
    return Math.round(m * r * (kind === 'match' ? MATCH_LOAD_FACTOR : 1));
  };
  const KIND_LABEL = { football_training: 'Entreno fútbol', strength: 'Fuerza', match: 'Partido', rest: 'Descanso', cancel: 'Cancelado' };
  const IMPORTANCE = { friendly: 'Amistoso', league: 'Liga', tournament: 'Torneo' };
  const BODY = [
    { value: 1, label: 'Fresco', icon: '🔋' },
    { value: 2, label: 'Normal', icon: '👍' },
    { value: 3, label: 'Cargado', icon: '🦵' },
    { value: 4, label: 'Muy cargado', icon: '🪫' },
  ];
  const MOOD = [
    { value: 1, icon: '😞' }, { value: 2, icon: '😕' }, { value: 3, icon: '😐' }, { value: 4, icon: '🙂' }, { value: 5, icon: '😀' },
  ];

  const yt = query => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  // Biblioteca de fuerza específica de fútbol. Cada ejercicio lleva para qué sirve en el campo, paso a paso,
  // en qué fijarse y un vídeo. El coach puede cambiar texto y vídeo en cada estación o guardar los suyos.
  const STRENGTH_CATEGORIES = [
    { id: 'movilidad', label: 'Movilidad' },
    { id: 'preparacion', label: 'Preparación' },
    { id: 'potencia', label: 'Reactividad y pliometría' },
    { id: 'prevencion', label: 'Prevención de lesiones' },
    { id: 'inferior', label: 'Fuerza tren inferior' },
    { id: 'velocidad', label: 'Aceleración y cambio de dirección' },
    { id: 'core', label: 'Core y duelos' },
    { id: 'superior', label: 'Tren superior' },
  ];
  const STRENGTH_LIBRARY = [
    // Movilidad: tobillo, cadera, glúteo y core
    { cat: 'movilidad', name: 'Rodilla a la pared', work: '10 / pierna', note: 'Tobillo', why: 'Un tobillo que flexiona bien absorbe mejor los apoyos y quita carga a rodilla y Aquiles.', steps: ['De pie frente a una pared, un pie a un palmo de ella.', 'Lleva la rodilla hacia la pared sin levantar el talón.', 'Vuelve y repite; aleja el pie si tocas fácil.'], cues: 'El talón no se despega y la rodilla va por encima del dedo gordo.', video: yt('knee to wall ankle mobility') },
    { cat: 'movilidad', name: 'Marcha de puntas y talones', work: '2 × 15 m', note: 'Tobillo', why: 'Despierta tobillo y pie antes de correr, saltar y cambiar de dirección.', steps: ['Camina 15 m de puntillas, alto.', 'Vuelve caminando sobre los talones con las puntas arriba.'], cues: 'Pasos cortos y tronco alto.', video: yt('toe walk heel walk warm up') },
    { cat: 'movilidad', name: 'Cadera 90/90', work: '6 / lado', note: 'Cadera', why: 'Rotación de cadera para el golpeo, los giros y proteger la zona del pubis.', steps: ['Sentado con las dos rodillas dobladas a 90°, una delante y otra al lado.', 'Gira las dos rodillas al otro lado sin usar las manos si puedes.', 'Alterna de lado despacio.'], cues: 'Espalda alta; el movimiento sale de la cadera.', video: yt('90 90 hip mobility') },
    { cat: 'movilidad', name: 'Zancada con rotación', work: '4 / lado', note: 'Cadera y tronco', why: 'Abre cadera, isquio y espalda en un solo ejercicio: ideal antes de entrenar.', steps: ['Zancada larga hacia delante.', 'Apoya la mano contraria al pie de delante en el suelo.', 'Lleva el codo del mismo lado hacia el tobillo y luego gira el brazo hacia el cielo.', 'Cambia de pierna.'], cues: 'Rodilla de atrás estirada y mirada siguiendo la mano.', video: yt('worlds greatest stretch') },
    { cat: 'movilidad', name: 'Abre y cierra la puerta', work: '8 / pierna', note: 'Cadera', why: 'Movilidad de cadera en el gesto de conducir y cambiar de dirección.', steps: ['De pie, sube la rodilla al frente.', 'Ábrela hacia fuera dibujando un círculo y baja.', 'Haz las repeticiones y luego al revés, de fuera hacia dentro.'], cues: 'Tronco quieto; si te desequilibras, apóyate en una pared.', video: yt('hip open close the gate warm up') },
    { cat: 'movilidad', name: 'Paso lateral con banda', work: '10 pasos / lado', note: 'Glúteo · banda en las rodillas o tobillos', why: 'Activa el glúteo medio, que mantiene la rodilla alineada al apoyar y frenar.', steps: ['Banda alrededor de las rodillas, semiflexionado.', 'Da pasos laterales cortos sin juntar los pies.', 'Vuelve hacia el otro lado.'], cues: 'Las rodillas empujan la banda hacia fuera todo el rato.', video: yt('lateral band walk glute activation') },
    { cat: 'movilidad', name: 'Almeja con banda', work: '12 / lado', note: 'Glúteo', why: 'Glúteo medio despierto = rodillas más estables en los apoyos.', steps: ['Tumbado de lado, rodillas dobladas y banda encima de las rodillas.', 'Abre la rodilla de arriba sin separar los pies.', 'Baja despacio.'], cues: 'La cadera no rueda hacia atrás.', video: yt('clamshell exercise band') },
    { cat: 'movilidad', name: 'Gato-camello', work: '8 reps', note: 'Core y columna', why: 'Moviliza la espalda y prepara el core para el trabajo.', steps: ['A cuatro patas, manos bajo hombros y rodillas bajo cadera.', 'Redondea la espalda mirando al ombligo.', 'Después arquéala suave mirando al frente.'], cues: 'Movimiento lento, vértebra a vértebra.', video: yt('cat camel exercise') },
    { cat: 'movilidad', name: 'Bird dog', work: '6 / lado', note: 'Core', why: 'Activa el core y el glúteo a la vez, con la espalda estable.', steps: ['A cuatro patas.', 'Estira brazo y pierna contrarios hasta quedar en línea.', 'Aguanta 2 s, vuelve y cambia.'], cues: 'Que no se mueva la cadera: imagina un vaso de agua en la espalda.', video: yt('bird dog exercise técnica') },
    // Preparación: core, técnica de aterrizaje y desplazamientos
    { cat: 'preparacion', name: 'Plancha con toque de hombro', work: '10 / lado', note: 'Core', why: 'Core anti-rotación: tronco firme cuando te empujan o cambias de dirección.', steps: ['Plancha alta con los pies algo separados.', 'Toca con una mano el hombro contrario.', 'Alterna sin mover la cadera.'], cues: 'Si la cadera baila, separa más los pies.', video: yt('plank shoulder taps técnica') },
    { cat: 'preparacion', name: 'Aterrizaje desde cajón bajo', work: '5 reps', note: 'Técnica de aterrizaje', why: 'Aprender a caer bien protege la rodilla en cada salto y cabezazo.', steps: ['De pie en un cajón de 20–30 cm.', 'Da un paso al vacío y cae con las dos piernas.', 'Frena en media sentadilla y aguanta 2 s.'], cues: 'Cae en silencio, rodillas en línea con los pies, pecho delante.', video: yt('drop landing technique acl') },
    { cat: 'preparacion', name: 'Salto y caída congelada', work: '5 reps', note: 'Técnica de aterrizaje', why: 'Une el salto con un aterrizaje estable, como en el juego aéreo.', steps: ['Salta vertical con los brazos.', 'Cae y quédate quieto 2 s en media sentadilla.', 'Reinicia.'], cues: 'Ni ruido ni rodillas hacia dentro.', video: yt('jump and stick landing drill') },
    { cat: 'preparacion', name: 'Desplazamiento lateral defensivo', work: '2 × 10 m / lado', note: 'Desplazamientos', why: 'Moverse de lado sin cruzar los pies, como al defender un uno contra uno.', steps: ['Posición atlética baja.', 'Desplázate de lado empujando con la pierna de atrás.', 'Frena y vuelve hacia el otro lado.'], cues: 'Pies que no se juntan y cadera baja.', video: yt('defensive lateral shuffle football') },
    { cat: 'preparacion', name: 'Paso cruzado (carioca)', work: '2 × 15 m / lado', note: 'Desplazamientos', why: 'Coordinación y rotación de cadera para girar y perfilarse rápido.', steps: ['De lado, cruza un pie por delante y luego por detrás.', 'Los hombros miran al frente y la cadera gira.', 'Vuelve hacia el otro lado.'], cues: 'Ritmo suave al principio, luego más rápido.', video: yt('carioca drill técnica') },
    { cat: 'preparacion', name: 'Carrera de espaldas', work: '2 × 15 m', note: 'Desplazamientos', why: 'Correr hacia atrás con control para recuperar posición sin perder el balón de vista.', steps: ['Corre hacia atrás con pasos cortos.', 'Tronco ligeramente adelantado.', 'Al final, frena y sal hacia delante.'], cues: 'Apoya con la parte delantera del pie.', video: yt('backpedal drill technique') },
    // Reactividad y pliometría
    { cat: 'potencia', name: 'Saltos a la comba', work: '30 s', note: 'Ritmo constante', why: 'Tobillo rápido y coordinado; base de toda la pliometría.', steps: ['Saltos pequeños con los pies juntos.', 'Gira la comba con las muñecas.'], cues: 'Contactos cortos, sin hundir los talones.', video: yt('jump rope basic technique') },
    { cat: 'potencia', name: 'Saltos laterales en línea', work: '2 × 10 s', note: 'Pies juntos', why: 'Reactividad lateral del tobillo para los cambios de ritmo.', steps: ['De pie al lado de una línea.', 'Salta de un lado a otro lo más rápido posible.'], cues: 'Saltos bajos y rápidos.', video: yt('lateral line hops agility') },
    { cat: 'potencia', name: 'Pogos a 1 pierna', work: '2 × 8 / pierna', note: 'Solo si los de 2 piernas salen bien', why: 'Rigidez y reactividad del tobillo en el apoyo de una sola pierna, como en el sprint.', steps: ['Sobre una pierna, rebota con la parte delantera del pie.', 'Rodilla casi recta.', 'Cambia de pierna.'], cues: 'Toca el suelo lo menos posible y sin que la rodilla se vaya hacia dentro.', video: yt('single leg pogo hops') },
    { cat: 'potencia', name: 'Salto con contramovimiento', work: '5 reps', note: 'Máxima altura', why: 'Potencia vertical para el juego aéreo.', steps: ['De pie, baja rápido a media sentadilla con los brazos atrás.', 'Salta lo más alto posible lanzando los brazos.', 'Aterriza suave y reinicia.'], cues: 'Bajada y subida seguidas, sin pararte abajo.', video: yt('countermovement jump technique') },
    { cat: 'potencia', name: 'Saltos de vallas bajas', work: '3 × 5', note: 'Vallas de 15–30 cm', why: 'Reactividad encadenada: rebotar rápido entre apoyos.', steps: ['Pon 5 vallas bajas seguidas.', 'Sáltalas con los pies juntos sin pausa entre ellas.', 'Vuelve andando.'], cues: 'Contacto rápido entre vallas, como si el suelo quemara.', video: yt('mini hurdle hops plyometric') },
    { cat: 'potencia', name: 'Drop jump', work: '4 reps', note: 'Cajón de 20–30 cm, nivel avanzado', why: 'Lo más específico para la reactividad: caer y rebotar al instante.', steps: ['Da un paso desde el cajón.', 'Nada más tocar el suelo, salta lo más alto posible.', 'Aterriza suave.'], cues: 'Si el contacto es largo o la rodilla se va dentro, baja el cajón.', video: yt('drop jump technique') },
    // Prevención
    { cat: 'prevencion', name: 'Nórdico asistido', work: '5 reps', note: 'Prevención de isquios', why: 'Los isquios frenan la pierna en cada sprint. Es el ejercicio que más reduce las roturas de isquios en fútbol.', steps: ['De rodillas, con alguien o algo sujetando los tobillos.', 'Déjate caer hacia delante lo más lento que puedas.', 'Frena con las manos al final y vuelve ayudándote.'], cues: 'Cuerpo recto de rodillas a cabeza, sin doblar la cadera.', video: yt('nordic hamstring curl asistido') },
    { cat: 'prevencion', name: 'Copenhague corto', work: '20 s / lado', note: 'Prevención de aductores', why: 'Fortalece los aductores, que sufren en el golpeo, los cambios de dirección y las entradas. Menos pubalgias y roturas de aductor.', steps: ['Plancha lateral con la rodilla de arriba apoyada en un banco.', 'Sube la cadera y aguanta.', 'Cambia de lado.'], cues: 'Si molesta, apoya también la rodilla de abajo.', video: yt('copenhagen plank short lever') },
    { cat: 'prevencion', name: 'Copenhague largo', work: '15 s / lado', note: 'Solo si el corto sale fácil', why: 'Versión más exigente para aductores: prepara para los apoyos largos y los cruces de pierna en el duelo.', steps: ['Plancha lateral con el tobillo o el pie de arriba apoyado en un banco.', 'Sube la cadera hasta quedar en línea.', 'Aguanta sin que la cadera caiga y cambia de lado.'], cues: 'Hombro encima del codo y cuerpo en línea recta.', video: yt('copenhagen adductor plank long lever') },
    { cat: 'prevencion', name: 'Elevación de gemelos a 1 pierna', work: '12 / pierna', note: 'Lento al bajar', why: 'Gemelo y sóleo absorben cada carrera y salto. Protege tendón de Aquiles y tobillo.', steps: ['De pie en un escalón, apoyando la punta.', 'Sube al máximo y baja en 3 s.'], cues: 'Sin rebotar abajo.', video: yt('single leg calf raise técnica') },
    { cat: 'prevencion', name: 'Equilibrio a 1 pierna con alcance', work: '6 / pierna', note: 'Descalzo si se puede', why: 'Entrena el tobillo y la rodilla para aguantar apoyos inestables. Menos esguinces.', steps: ['Apoyado en una pierna, rodilla un poco doblada.', 'Lleva la otra pierna lo más lejos posible hacia delante, al lado y atrás tocando el suelo con la punta.', 'Vuelve al centro sin apoyar.'], cues: 'La rodilla de apoyo no se va hacia dentro.', video: yt('y balance exercise futbol tobillo') },
    { cat: 'preparacion', name: 'Aterrizaje a 1 pierna', work: '5 / pierna', note: 'Aguanta 2 s abajo', why: 'Aprender a caer bien tras un salto o un cabezazo protege la rodilla (cruzado).', steps: ['Salta suave desde dos piernas.', 'Cae sobre una pierna, rodilla y cadera dobladas.', 'Aguanta 2 s quieto y cambia de pierna.'], cues: 'Cae en silencio y con la rodilla mirando a la punta del pie.', video: yt('single leg landing drill knee acl prevention') },
    { cat: 'prevencion', name: 'Puente de isquios a 1 pierna', work: '8 / pierna', note: 'Talón en un banco', why: 'Fuerza de isquios cerca de la extensión, como al final de la zancada del sprint.', steps: ['Boca arriba con un talón sobre un banco y la otra pierna arriba.', 'Sube la cadera empujando con el talón.', 'Baja despacio sin tocar el suelo.'], cues: 'Si da calambre, acerca el banco.', video: yt('single leg hamstring bridge bench') },
    // Fuerza tren inferior
    { cat: 'inferior', name: 'Sentadilla goblet', work: '10 reps', note: 'Kettlebell o mancuerna, bajar controlado', why: 'Fuerza básica de piernas para saltar, chutar y proteger rodillas.', steps: ['Sujeta la pesa pegada al pecho.', 'Pies a la anchura de los hombros.', 'Baja con la espalda recta hasta que la cadera pase la rodilla.', 'Sube empujando el suelo.'], cues: 'Las rodillas siguen la dirección de los pies.', video: yt('sentadilla goblet técnica') },
    { cat: 'inferior', name: 'Zancada atrás', work: '6 / pierna', note: 'Rodilla alineada con el pie', why: 'Fuerza a una pierna, como se corre y se chuta en el campo.', steps: ['De pie, pies a la anchura de la cadera.', 'Paso largo atrás y baja hasta que la rodilla casi toque el suelo.', 'Empuja con el talón de delante para volver.'], cues: 'El tronco se queda recto, sin irse hacia delante.', video: yt('zancada atrás reverse lunge técnica') },
    { cat: 'inferior', name: 'Sentadilla búlgara', work: '6 / pierna', note: 'Pie de atrás en un banco', why: 'La mejor fuerza a una pierna: aceleraciones y frenadas más potentes y más estabilidad de rodilla.', steps: ['Pie de atrás apoyado en un banco.', 'Baja recto hasta que la rodilla de atrás casi toque el suelo.', 'Sube empujando con el pie de delante.'], cues: 'Deja 2–3 repeticiones en reserva.', video: yt('bulgarian split squat proper form') },
    { cat: 'inferior', name: 'Peso muerto rumano', work: '8 reps', note: 'Espalda neutra', why: 'Isquios y glúteo fuertes para el sprint y para prevenir lesiones de isquios.', steps: ['Pesas delante de los muslos.', 'Lleva la cadera atrás con las rodillas un poco dobladas.', 'Baja hasta notar los isquios y sube apretando glúteo.'], cues: 'La pesa va pegada a las piernas.', video: yt('peso muerto rumano técnica') },
    { cat: 'inferior', name: 'Peso muerto a 1 pierna', work: '6 / pierna', note: 'Con o sin peso', why: 'Isquios, glúteo y equilibrio a la vez, como en el apoyo del golpeo.', steps: ['De pie sobre una pierna, rodilla un poco doblada.', 'Inclina el tronco mientras la otra pierna va atrás.', 'Baja hasta notar el isquio y vuelve arriba.'], cues: 'Cadera nivelada: el ombligo mira al suelo.', video: yt('single leg romanian deadlift técnica') },
    { cat: 'inferior', name: 'Hip thrust', work: '10 reps', note: 'Pausa de 1 s arriba', why: 'Glúteo potente = más velocidad punta y menos carga en isquios.', steps: ['Espalda alta apoyada en un banco, pesa sobre la cadera.', 'Sube la cadera hasta alinear rodillas, cadera y hombros.', 'Baja controlado.'], cues: 'Barbilla recogida y costillas abajo, sin arquear la espalda.', video: yt('hip thrust técnica') },
    { cat: 'inferior', name: 'Puente de glúteo a 1 pierna', work: '40 s', note: 'Pausa de 2 s arriba', why: 'Activa el glúteo para que no trabajen solos los isquios en la carrera.', steps: ['Túmbate boca arriba, rodillas dobladas y pies apoyados.', 'Estira una pierna y deja la otra en el suelo.', 'Sube la cadera empujando con el talón hasta alinear rodilla, cadera y hombro.', 'Aguanta 2 s arriba y baja despacio.'], cues: 'La cadera no se cae hacia el lado de la pierna estirada.', video: yt('single leg glute bridge técnica') },
    { cat: 'inferior', name: 'Subida al cajón', work: '8 / pierna', note: 'Sin impulsarte con la de abajo', why: 'Fuerza de empuje a una pierna, como en el primer paso de la arrancada.', steps: ['Pie entero sobre un cajón a la altura de la rodilla.', 'Sube empujando solo con esa pierna.', 'Baja despacio y repite.'], cues: 'La rodilla de arriba no se va hacia dentro.', video: yt('step up exercise técnica') },
    { cat: 'potencia', name: 'Salto al cajón', work: '5 reps', note: 'Máxima calidad, aterrizar suave', why: 'Potencia de piernas para saltar al cabezazo y arrancar más rápido.', steps: ['De pie frente a un cajón estable.', 'Brazos atrás, flexiona y salta arriba.', 'Aterriza suave con las dos piernas.', 'Baja andando, no saltando.'], cues: 'Calidad antes que altura: si el aterrizaje es ruidoso, baja el cajón.', video: yt('box jump técnica futbol') },
    { cat: 'potencia', name: 'Pogos reactivos', work: '2 × 10', note: 'Contacto corto con el suelo', why: 'Tobillo reactivo: apoyos más rápidos en el sprint y en los cambios de ritmo.', steps: ['Saltos pequeños con las piernas casi rectas.', 'Rebota con la parte delantera del pie.', 'Brazos relajados.'], cues: 'Toca el suelo lo menos posible.', video: yt('pogo jumps futbol') },
    { cat: 'potencia', name: 'Salto horizontal', work: '3 reps', note: 'Recupera entre saltos', why: 'Potencia hacia delante, la misma dirección que la aceleración.', steps: ['Carga rápida de cadera con los brazos atrás.', 'Salta lo más lejos posible.', 'Aterriza estable, aguanta y reinicia.'], cues: 'Aterriza con las dos piernas a la vez y sin caer hacia atrás.', video: yt('standing broad jump technique') },
    { cat: 'potencia', name: 'Saltos laterales de patinador', work: '6 / lado', note: 'Aguanta 1 s en cada apoyo', why: 'Potencia lateral y frenada a una pierna para regates y cambios de dirección.', steps: ['De pie sobre una pierna.', 'Salta hacia el lado y cae sobre la otra pierna.', 'Frena, aguanta 1 s y salta de vuelta.'], cues: 'Cae con la rodilla flexionada y el pecho por delante.', video: yt('skater jumps técnica') },
    { cat: 'potencia', name: 'Saltos a 1 pierna encadenados', work: '3 × 4 / pierna', note: 'Solo con buena técnica', why: 'Potencia y rigidez a una pierna, como en cada zancada del sprint.', steps: ['Sobre una pierna, salta hacia delante.', 'Encadena 4 saltos seguidos con contactos cortos.', 'Para y cambia de pierna.'], cues: 'Si la rodilla se va hacia dentro, para.', video: yt('single leg hops forward drill') },
    // Velocidad
    { cat: 'velocidad', name: 'Skipping', work: '20 s', note: 'Rodillas arriba, rápido', why: 'Coordinación y frecuencia de zancada.', steps: ['Carrera en el sitio subiendo rodillas.', 'Brazos coordinados.'], cues: 'Apoyos rápidos y tronco alto.', video: yt('skipping futbol técnica') },
    { cat: 'velocidad', name: 'Arrancada en pared', work: '3 × 5 / pierna', note: 'Cuerpo inclinado', why: 'Enseña la postura de los primeros pasos de la aceleración.', steps: ['Manos en la pared, cuerpo inclinado unos 45°.', 'Sube una rodilla y cambia de pierna rápido.', 'Mantén la línea de tobillo a cabeza.'], cues: 'Empuja el suelo hacia atrás, no hacia abajo.', video: yt('wall drill acceleration sprint') },
    { cat: 'preparacion', name: 'Frenada en 3 pasos', work: '5 reps', note: 'Desde carrera suave', why: 'Saber frenar es lo que permite cambiar de dirección rápido y sin lesionarse.', steps: ['Corre 10 m a ritmo medio.', 'Frena en 3 pasos bajando la cadera.', 'Termina parado y equilibrado.'], cues: 'Pasos cortos al final, pecho por encima de las rodillas.', video: yt('deceleration drill football') },
    { cat: 'velocidad', name: 'Cambio de dirección a 45°', work: '4 / lado', note: 'Máxima calidad', why: 'Gesto de regate y desmarque: apoyo exterior fuerte y salida rápida.', steps: ['Corre 5 m.', 'Apoya fuera con la pierna contraria al cambio.', 'Sal a 45° acelerando 5 m.'], cues: 'Baja la cadera antes del apoyo y empuja fuera.', video: yt('45 degree cut change of direction drill') },
    // Core
    { cat: 'core', name: 'Plancha lateral', work: '30 s / lado', note: '', why: 'Tronco estable para el contacto y los cambios de dirección.', steps: ['Apoya el antebrazo bajo el hombro.', 'Sube la cadera hasta formar una línea recta.', 'Aguanta y cambia de lado.'], cues: 'No dejes caer la cadera.', video: yt('plancha lateral técnica') },
    { cat: 'core', name: 'Dead bug', work: '8 / lado', note: 'Zona lumbar pegada al suelo', why: 'Control del tronco mientras se mueven brazos y piernas, como al correr.', steps: ['Boca arriba, brazos y piernas arriba.', 'Estira brazo y pierna contrarios sin despegar la zona lumbar.', 'Vuelve y cambia de lado.'], cues: 'Respira y no arquees la espalda.', video: yt('dead bug ejercicio core') },
    { cat: 'core', name: 'Pallof press', work: '10 / lado', note: 'Goma elástica', why: 'Aguantar que te giren: tronco firme en los duelos y al proteger el balón.', steps: ['De lado a la goma, agárrala con las dos manos en el pecho.', 'Estira los brazos al frente sin dejar que te gire.', 'Aguanta 2 s y vuelve.'], cues: 'Cadera y hombros mirando al frente todo el rato.', video: yt('pallof press técnica') },
    { cat: 'core', name: 'Paseo del granjero a 1 mano', work: '20 m / lado', note: 'Peso en una sola mano', why: 'Core, agarre y estabilidad frente al contacto.', steps: ['Sujeta una pesa en una sola mano.', 'Camina alto sin inclinarte hacia el peso.', 'Cambia de mano a la vuelta.'], cues: 'Hombros nivelados y pasos tranquilos.', video: yt('suitcase carry técnica') },
    // Tren superior
    { cat: 'superior', name: 'Flexiones', work: '8 reps', note: 'Para antes de perder técnica', why: 'Fuerza de empuje para proteger el balón y ganar el cuerpo a cuerpo.', steps: ['Cuerpo en línea de cabeza a talones.', 'Baja el pecho con los codos a unos 45°.', 'Empuja el suelo sin hundir la cadera.'], cues: 'Si no salen bien, apoya las rodillas.', video: yt('push up proper form') },
    { cat: 'superior', name: 'Remo con mancuerna', work: '8 / lado', note: 'Sin girar el tronco', why: 'Espalda y hombros fuertes para el braceo en el sprint y el contacto.', steps: ['Una mano y una rodilla en un banco.', 'Lleva el codo atrás pegado al cuerpo.', 'Baja controlado.'], cues: 'Hombro lejos de la oreja.', video: yt('one arm dumbbell row proper form') },
  ];

  const TEMPLATES = [
    { id: 'tpl-inferior', name: 'Fuerza A · Tren inferior', objective: 'Fuerza y potencia de piernas sin llegar cargado al partido', format: 'circuit', rounds: 3, transition_sec: 15, rest_sec: 120,
      stations: ['Sentadilla goblet', 'Zancada atrás', 'Puente de glúteo a 1 pierna', 'Nórdico asistido', 'Salto al cajón', 'Plancha lateral'] },
    { id: 'tpl-prevencion', name: 'Fuerza B · Prevención', objective: 'Isquios, aductores y gemelos fuertes para prevenir lesiones', format: 'circuit', rounds: 2, transition_sec: 15, rest_sec: 90,
      stations: ['Nórdico asistido', 'Copenhague corto', 'Elevación de gemelos a 1 pierna', 'Dead bug', 'Plancha lateral'] },
    { id: 'tpl-md4', name: 'Fuerza MD-4 · Fuerza y potencia', objective: 'La sesión fuerte de la semana: fuerza a una pierna y potencia', format: 'sets', rounds: 3, transition_sec: 90, rest_sec: 120,
      stations: ['Salto horizontal', 'Sentadilla búlgara', 'Peso muerto rumano', 'Hip thrust', 'Pallof press'] },
    { id: 'tpl-cod', name: 'Velocidad y cambio de dirección', objective: 'Frenar, cambiar de dirección y acelerar mejor', format: 'circuit', rounds: 2, transition_sec: 30, rest_sec: 120,
      stations: ['Arrancada en pared', 'Saltos laterales de patinador', 'Frenada en 3 pasos', 'Cambio de dirección a 45°', 'Aterrizaje a 1 pierna'] },
    { id: 'tpl-preparacion', name: 'Movilidad y preparación', objective: 'Antes de la fuerza o del entreno: tobillo, cadera, glúteo, core, aterrizajes y desplazamientos', format: 'circuit', rounds: 1, transition_sec: 15, rest_sec: 0,
      stations: ['Rodilla a la pared', 'Cadera 90/90', 'Paso lateral con banda', 'Bird dog', 'Plancha con toque de hombro', 'Aterrizaje desde cajón bajo', 'Desplazamiento lateral defensivo', 'Paso cruzado (carioca)'] },
    { id: 'tpl-reactividad', name: 'Reactividad y pliometría', objective: 'Apoyos rápidos y saltos de calidad, de menos a más', format: 'sets', rounds: 2, transition_sec: 60, rest_sec: 90,
      stations: ['Saltos a la comba', 'Pogos reactivos', 'Saltos laterales en línea', 'Saltos de vallas bajas', 'Salto con contramovimiento'] },
    { id: 'tpl-activacion', name: 'Activación pre-partido', objective: 'Despertar el cuerpo el día antes, sin cansar', format: 'circuit', rounds: 2, transition_sec: 15, rest_sec: 60,
      stations: ['Skipping', 'Pogos reactivos', 'Puente de glúteo a 1 pierna', 'Dead bug'] },
  ];

  // ---------- utilidades ----------
  const text = (value, max = 200) => String(value ?? '').trim().replace(/[<>"`]/g, '').slice(0, max);
  const url = value => { const s = String(value || '').trim(); return /^https?:\/\/[^\s"'<>`]+$/i.test(s) ? s.slice(0, 600) : ''; };
  const num = (value, min, max, fallback = null) => {
    if (value === '' || value === null || value === undefined) return fallback;
    const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const time = value => { const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
  const isoDate = value => { const s = String(value || ''); return /^\d{4}-\d{2}-\d{2}$/.test(s) && isoFromDate(dateFromIso(s)) === s ? s : ''; };
  const id = (value, fallback) => String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || fallback;
  const steps = value => (Array.isArray(value) ? value : String(value || '').split('\n')).map(s => text(s, 300)).filter(Boolean).slice(0, 12);
  const randomId = prefix => `${prefix}${Math.random().toString(36).slice(2, 9)}`;

  const pad = n => String(n).padStart(2, '0');
  const dateFromIso = iso => new Date(`${iso}T12:00:00Z`);
  const isoFromDate = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const addDays = (iso, days) => { const d = dateFromIso(iso); d.setUTCDate(d.getUTCDate() + days); return isoFromDate(d); };
  const dayIndex = iso => (dateFromIso(iso).getUTCDay() + 6) % 7; // 0 = lunes
  const mondayOf = iso => addDays(iso, -dayIndex(iso));
  const daysBetween = (a, b) => Math.round((dateFromIso(b) - dateFromIso(a)) / 86400000);
  const todayMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  // ---------- saneado ----------
  function sanitizeStation(item) {
    const s = item && typeof item === 'object' ? item : {};
    return {
      name: text(s.name, 120), work: text(s.work, 40), note: text(s.note, 200), why: text(s.why, 300), steps: steps(s.steps),
      cues: text(s.cues, 400), video: url(s.video), img: url(s.img),
    };
  }
  // Ejercicios propios del coach: se reutilizan en los bloques de todos sus deportistas.
  function sanitizeLibrary(list) {
    const cats = STRENGTH_CATEGORIES.map(c => c.id), seen = new Set();
    return (Array.isArray(list) ? list : []).slice(0, 200).map(item => ({ ...sanitizeStation(item), cat: cats.includes(item?.cat) ? item.cat : 'otros' }))
      .filter(e => e.name && !seen.has(e.name.toLowerCase()) && seen.add(e.name.toLowerCase()));
  }
  function sanitizeStrength(list) {
    const used = new Set();
    return (Array.isArray(list) ? list : []).filter(b => b && typeof b === 'object').slice(0, 20).map((b, index) => {
      let blockId = id(b.id, `b${index + 1}`);
      while (used.has(blockId)) blockId = `${blockId}-${index + 1}`;
      used.add(blockId);
      return {
        id: blockId, name: text(b.name, 120) || `Bloque ${index + 1}`, objective: text(b.objective, 200),
        format: b.format === 'sets' ? 'sets' : 'circuit',
        rounds: num(b.rounds, 1, 10, 3), transition_sec: num(b.transition_sec, 0, 300, 15), rest_sec: num(b.rest_sec, 0, 900, 120),
        stations: (Array.isArray(b.stations) ? b.stations : []).slice(0, 15).map(sanitizeStation).filter(s => s.name),
      };
    });
  }
  function sanitizeItem(item, kinds) {
    const s = item && typeof item === 'object' ? item : {};
    const kind = kinds.includes(s.kind) ? s.kind : null;
    if (!kind) return null;
    const out = { kind, time: time(s.time), duration_min: num(s.duration_min, 0, 300, null), place: text(s.place, 80), note: text(s.note, 200) };
    if (kind === 'strength') out.strength_id = id(s.strength_id, '');
    return out;
  }
  function sanitizeSchedule(value) {
    const source = value && typeof value === 'object' ? value : {};
    const week = Array.from({ length: 7 }, (_, d) => (Array.isArray(source.week?.[d]) ? source.week[d] : [])
      .slice(0, 6).map(item => sanitizeItem(item, WEEK_KINDS)).filter(Boolean));
    const used = new Set();
    const events = (Array.isArray(source.events) ? source.events : []).slice(0, 300).map((e, index) => {
      const base = sanitizeItem(e, EVENT_KINDS);
      const date = isoDate(e?.date);
      if (!base || !date) return null;
      let eventId = id(e.id, `e${index + 1}`);
      while (used.has(eventId)) eventId = `${eventId}-${index + 1}`;
      used.add(eventId);
      const out = { id: eventId, date, ...base };
      if (base.kind === 'match') {
        out.rival = text(e.rival, 80); out.home = e.home !== false;
        out.importance = Object.prototype.hasOwnProperty.call(IMPORTANCE, e.importance) ? e.importance : 'league';
      }
      if (base.kind === 'cancel') out.cancel_kind = ['football_training', 'strength', 'all'].includes(e.cancel_kind) ? e.cancel_kind : 'football_training';
      return out;
    }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    // Desde cuándo vale la semana tipo: antes de esa fecha no se piden valoraciones de sesiones que no existían.
    return { start: isoDate(source.start), week, events };
  }

  // ---------- duración de un circuito ----------
  function stationSeconds(work) {
    const t = String(work || '').toLowerCase();
    const perSide = /\/\s*(lado|pierna|brazo)|por (lado|pierna)/.test(t) ? 2 : 1;
    const sets = t.match(/^(\d+)\s*[×x]\s*/);
    const mult = sets ? Number(sets[1]) : 1;
    const rest = sets ? t.slice(sets[0].length) : t;
    const secs = rest.match(/(\d+)\s*(s|seg)/);
    if (secs) return Number(secs[1]) * perSide * mult;
    const mins = rest.match(/(\d+)\s*min/);
    if (mins) return Number(mins[1]) * 60 * mult;
    const reps = rest.match(/(\d+)/);
    return Math.max(20, (reps ? Number(reps[1]) : 8) * 3.5) * perSide * mult;
  }
  function timedSeconds(work) {
    const t = String(work || '').toLowerCase();
    if (/^\d+\s*[×x]/.test(t)) return null;
    const secs = t.match(/^(\d+)\s*(s|seg)\b/);
    if (secs) return Number(secs[1]);
    const mins = t.match(/^(\d+)\s*min\b/);
    return mins ? Number(mins[1]) * 60 : null;
  }
  function blockMinutes(block) {
    if (!block || !Array.isArray(block.stations) || !block.stations.length) return 0;
    const rounds = Number(block.rounds || 1);
    const perRound = block.stations.reduce((sum, s) => sum + stationSeconds(s.work), 0) + Number(block.transition_sec || 0) * block.stations.length;
    return Math.max(1, Math.round((perRound * rounds + Number(block.rest_sec || 0) * Math.max(0, rounds - 1)) / 60));
  }
  function fromTemplate(templateId) {
    const tpl = TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return null;
    return {
      id: randomId('b'), name: tpl.name, objective: tpl.objective, format: tpl.format, rounds: tpl.rounds, transition_sec: tpl.transition_sec, rest_sec: tpl.rest_sec,
      stations: tpl.stations.map(name => { const { cat, ...station } = STRENGTH_LIBRARY.find(e => e.name === name); return { ...station, img: '' }; }),
    };
  }

  // ---------- plan resuelto día a día ----------
  function mdLabel(date, matchDates) {
    let next = null, prev = null;
    matchDates.forEach(m => {
      const d = daysBetween(date, m);
      if (d >= 0 && (next === null || d < next)) next = d;
      if (d < 0 && (prev === null || -d < prev)) prev = -d;
    });
    if (next === 0) return 'MD';
    if (prev !== null && prev <= 2 && (next === null || next > 3)) return `MD+${prev}`;
    if (next !== null && next <= 6) return `MD-${next}`;
    if (prev !== null && prev <= 3) return `MD+${prev}`;
    return '';
  }
  function itemTitle(item, strengthById) {
    if (item.kind === 'strength') return strengthById[item.strength_id]?.name || 'Fuerza';
    if (item.kind === 'match') return item.rival ? `Partido vs ${item.rival}` : 'Partido';
    return KIND_LABEL[item.kind] || item.kind;
  }
  function resolvePlan(program, from, to) {
    const schedule = sanitizeSchedule(program?.schedule);
    const strength = Array.isArray(program?.strength) ? program.strength : [];
    const strengthById = Object.fromEntries(strength.map(b => [b.id, b]));
    const matchDates = schedule.events.filter(e => e.kind === 'match').map(e => e.date);
    const days = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const dayEvents = schedule.events.filter(e => e.date === date);
      const cancels = dayEvents.filter(e => e.kind === 'cancel').map(e => e.cancel_kind);
      const hasMatch = dayEvents.some(e => e.kind === 'match');
      const template = (schedule.start && date < schedule.start ? [] : schedule.week[dayIndex(date)]).map((item, index) => ({ ...item, key: `${date}|w${index}`, source: 'week' }))
        .filter(item => !cancels.includes('all') && !cancels.includes(item.kind))
        .filter(item => !(hasMatch && item.kind === 'football_training'));
      const extra = dayEvents.filter(e => e.kind !== 'cancel').map(e => ({ ...e, key: `${date}|e${e.id}`, source: 'event' }));
      let items = [...template, ...extra];
      if (items.some(i => i.kind !== 'rest')) items = items.filter(i => i.kind !== 'rest');
      items = items.map(item => {
        const block = item.kind === 'strength' ? strengthById[item.strength_id] : null;
        return { ...item, date, title: itemTitle(item, strengthById), duration_min: item.duration_min || (block ? blockMinutes(block) : item.kind === 'match' ? 70 : null) };
      }).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
      const md = mdLabel(date, matchDates);
      const warnings = [];
      if (items.some(i => i.kind === 'strength') && (md === 'MD-1' || md === 'MD')) warnings.push(md === 'MD' ? 'Fuerza el mismo día del partido.' : 'Fuerza el día antes del partido.');
      days.push({ date, day: dayIndex(date), md, items, warnings, cancelled: cancels });
    }
    return days;
  }

  // Valoraciones: qué sesiones planificadas (pasadas o de hoy) aún no tienen valoración.
  function logPlanKey(log) { return log?.plan_key || log?.football?.plan_key || null; }
  function attachRatings(days, logs, today) {
    const byKey = new Map();
    (logs || []).forEach(log => { const key = logPlanKey(log); if (key && !byKey.has(key)) byKey.set(key, log); });
    days.forEach(day => day.items.forEach(item => {
      if (!RATED_KINDS.includes(item.kind)) return;
      item.rating = byKey.get(item.key) || null;
      item.pending = !item.rating && day.date <= today;
    }));
    return days;
  }

  return {
    DAYS, DAYS_SHORT, WEEK_KINDS, EVENT_KINDS, RATED_KINDS, KIND_LABEL, IMPORTANCE, BODY, MOOD, STRENGTH_CATEGORIES, STRENGTH_LIBRARY, TEMPLATES,
    sanitizeSchedule, sanitizeStrength, sanitizeStation, sanitizeLibrary, resolvePlan, attachRatings, blockMinutes, stationSeconds, timedSeconds, fromTemplate, mdLabel,
    addDays, dayIndex, mondayOf, daysBetween, todayMadrid, randomId, MATCH_LOAD_FACTOR, sessionLoad,
  };
}));
