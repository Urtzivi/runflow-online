// RunFlow · cuestionarios que el coach envía a un deportista (servidor, app y Coach).
// Cada plantilla tiene una introducción y preguntas de una opción ('choice') o abiertas ('open').
// Las abiertas se pueden responder por escrito o grabando un audio (audio: true).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunFlowQuestionnaires = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TEMPLATES = {
    'futbol-como-me-siento': {
      id: 'futbol-como-me-siento',
      title: 'Cómo me siento jugando',
      sport: 'football',
      intro: 'No hay respuestas buenas ni malas. Queremos saber cómo te sientes jugando para ayudarte a disfrutar y mejorar.',
      questions: [
        { id: 'q1', type: 'choice', text: 'Cuando ves un balón al que podrías llegar corriendo, ¿qué suele pasar?', options: ['Voy a por él con todo', 'Depende de si creo que llegaré', 'A veces dudo y arranco tarde', 'No lo tengo claro'] },
        { id: 'q2', type: 'choice', text: '¿Sientes que puedes correr más rápido de lo que corres en los partidos?', options: ['Sí, bastante más', 'A veces', 'No, voy al máximo', 'No lo sé'] },
        { id: 'q3', type: 'choice', text: 'Cuando el partido va de un lado a otro, ¿cómo te encuentras?', options: ['Sé dónde colocarme', 'A veces me pierdo', 'Me cuesta mucho encontrar mi sitio', 'Depende del partido'] },
        { id: 'q4', type: 'choice', text: 'Cuando tu equipo tiene el balón, ¿sabes dónde moverte para recibir?', options: ['Casi siempre', 'Muchas veces', 'Pocas veces', 'Depende de mis compañeros'] },
        { id: 'q5', type: 'choice', text: 'Cuando cometes un error, ¿qué te ocurre?', options: ['Sigo jugando con confianza', 'Me molesta, pero se me pasa', 'Me cuesta volver a intentarlo', 'Depende del error'] },
        { id: 'q6', type: 'choice', text: '¿Cómo te sientes físicamente durante los partidos?', options: ['Con mucha energía', 'Me canso en algunos momentos', 'Me cuesta seguir el ritmo', 'Depende del día'] },
        { id: 'q7', type: 'choice', text: '¿Qué te gustaría mejorar más ahora mismo?', options: ['Ser más rápido y explosivo', 'Colocarme mejor en el campo', 'Tener más confianza', 'Participar más en el juego'] },
        { id: 'q8', type: 'choice', text: '¿Cuánto estás disfrutando del fútbol últimamente?', options: ['Muchísimo', 'Bastante', 'Regular', 'Poco'] },
        { id: 'q9', type: 'open', label: 'Pregunta abierta', text: 'Si pudieras cambiar una sola cosa de cómo juegas ahora, ¿cuál sería?', audio: true },
      ],
    },
  };

  const MAX_TEXT = 3000;
  const MAX_AUDIO_SECONDS = 180;
  const AUDIO_MIME = /^audio\/(webm|ogg|mp4|mpeg|aac|x-m4a|wav)(;\s*codecs=[\w.,"-]+)?$/i;

  function template(id) { return TEMPLATES[id] || null; }
  function listTemplates() { return Object.values(TEMPLATES).map(t => ({ id: t.id, title: t.title, sport: t.sport, questions: t.questions.length })); }

  // Copia de la plantilla que se guarda con el envío: si luego cambia, lo enviado no cambia.
  function snapshot(id) {
    const t = template(id);
    return t ? JSON.parse(JSON.stringify({ template_id: t.id, title: t.title, intro: t.intro, questions: t.questions })) : null;
  }

  // Valida las respuestas de la app. Devuelve { answers, errors, audio: [{ question_id, mime, seconds, data }] }.
  function cleanAnswers(questions, body) {
    const input = (body && typeof body.answers === 'object' && body.answers) || {};
    const audios = (body && typeof body.audio === 'object' && body.audio) || {};
    const answers = {}, errors = [], audio = [];
    (questions || []).forEach((q, i) => {
      const value = input[q.id];
      if (q.type === 'choice') {
        if (!q.options.includes(value)) errors.push(`Falta responder la pregunta ${i + 1}.`);
        else answers[q.id] = value;
        return;
      }
      const text = String((value && typeof value === 'object' ? value.text : value) || '').trim().slice(0, MAX_TEXT);
      const a = q.audio ? audios[q.id] : null;
      let hasAudio = false;
      if (a && a.data) {
        const mime = String(a.mime || '').trim();
        const data = String(a.data).replace(/^data:[^,]*,/, '');
        if (!AUDIO_MIME.test(mime)) errors.push('Formato de audio no válido.');
        else if (!/^[A-Za-z0-9+/=]+$/.test(data)) errors.push('Audio dañado. Vuelve a grabarlo.');
        else {
          const seconds = Math.max(0, Math.min(MAX_AUDIO_SECONDS + 5, Math.round(Number(a.seconds) || 0)));
          audio.push({ question_id: q.id, mime, seconds, data });
          hasAudio = true;
        }
      }
      if (!text && !hasAudio) errors.push(`Responde la pregunta ${i + 1} por escrito o con un audio.`);
      answers[q.id] = { text, has_audio: hasAudio };
    });
    return { answers, errors, audio };
  }

  return { TEMPLATES, template, listTemplates, snapshot, cleanAnswers, MAX_AUDIO_SECONDS, MAX_TEXT };
});
