'use strict';
// Cuestionarios del coach al deportista: plantilla, validación de respuestas, envío y respuesta con audio.
const assert = require('assert');
const Q = require('../public/js/runflow-questionnaires.js');
const api = require('../questionnaire-api.js');

const t = Q.template('futbol-como-me-siento');
assert.ok(t, 'existe la plantilla de fútbol');
assert.equal(t.questions.length, 9);
assert.equal(t.questions.filter(x => x.type === 'choice').length, 8);
assert.ok(t.questions.slice(0, 8).every(x => x.options.length === 4), 'cuatro opciones por pregunta');
assert.equal(t.questions[8].type, 'open'); assert.equal(t.questions[8].audio, true);
assert.match(t.intro, /^No hay respuestas buenas ni malas/);

const full = Object.fromEntries(t.questions.filter(x => x.type === 'choice').map(x => [x.id, x.options[0]]));
let r = Q.cleanAnswers(t.questions, { answers: full });
assert.equal(r.errors.length, 1, 'la abierta es obligatoria (texto o audio)');
r = Q.cleanAnswers(t.questions, { answers: { ...full, q9: 'Arrancar antes' } });
assert.deepEqual(r.errors, []); assert.equal(r.answers.q9.text, 'Arrancar antes');
r = Q.cleanAnswers(t.questions, { answers: { ...full, q1: 'Inventada' , q9: 'x' } });
assert.equal(r.errors.length, 1, 'opción que no existe');
r = Q.cleanAnswers(t.questions, { answers: full, audio: { q9: { mime: 'audio/webm;codecs=opus', seconds: 12, data: Buffer.from('hola audio').toString('base64') } } });
assert.deepEqual(r.errors, []); assert.equal(r.audio.length, 1); assert.equal(r.answers.q9.has_audio, true);
r = Q.cleanAnswers(t.questions, { answers: full, audio: { q9: { mime: 'text/html', seconds: 3, data: 'AAAA' } } });
assert.ok(r.errors.length >= 1, 'formato de audio no válido');

// Envío y respuesta contra una tabla en memoria.
(async () => {
  const db = [];
  const rows = async (table, query, options = {}) => {
    const p = new URLSearchParams(query); const f = [...p.entries()].filter(([k, v]) => !['select', 'order', 'limit'].includes(k) && v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
    const match = row => f.every(([k, v]) => String(row[k]) === v);
    if (options.method === 'POST') { db.push({ ...options.body }); return [{ ...options.body }]; }
    if (options.method === 'PATCH') { const out = db.filter(match); out.forEach(row => Object.assign(row, options.body)); return out; }
    return db.filter(match).map(row => ({ ...row }));
  };
  const first = await api.assign(rows, 'coach-1', 'ath-1', 'futbol-como-me-siento');
  assert.equal(first.created, true);
  const again = await api.assign(rows, 'coach-1', 'ath-1', 'futbol-como-me-siento');
  assert.equal(again.created, false, 'no duplica uno pendiente');
  await assert.rejects(api.answer(rows, 'otro', first.item.id, { answers: full }), /no encontrado/);
  const audio = Buffer.from('audio-de-prueba').toString('base64');
  const done = await api.answer(rows, 'ath-1', first.item.id, { answers: { ...full, q9: 'Ir a por todos los balones' }, audio: { q9: { mime: 'audio/webm', seconds: 20, data: audio } } });
  assert.equal(done.status, 'answered'); assert.ok(done.answers.q9.audio_id); assert.equal(done.answers.q9.text, 'Ir a por todos los balones');
  const audioRow = db.find(x => x.id === done.answers.q9.audio_id);
  assert.equal(audioRow.category, api.AUDIO_CATEGORY); assert.equal(audioRow.template_data.data, audio);
  const list = await api.listForAthlete(rows, 'ath-1');
  assert.equal(list.length, 1); assert.ok(!JSON.stringify(list).includes(audio), 'la lista no lleva el audio');
  await assert.rejects(api.answer(rows, 'ath-1', first.item.id, { answers: full }), /Ya enviaste/);
  const text = api.readable(list[0]);
  assert.equal(text.estado, 'respondido'); assert.equal(text.respuestas[0].respuesta, 'Voy a por él con todo'); assert.match(text.respuestas[8].audio, /20 s/);
  console.log('Cuestionarios: OK');
})().catch(error => { console.error(error); process.exit(1); });
