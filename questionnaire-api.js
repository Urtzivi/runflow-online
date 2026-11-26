'use strict';

// RunFlow · cuestionarios del coach al deportista.
// Envío = fila interna de workout_templates (categoría QUESTIONNAIRE_CATEGORY) con una copia de la plantilla,
// el estado y las respuestas. El audio de las preguntas abiertas va en otra fila (AUDIO_CATEGORY) para que
// listar cuestionarios no descargue los audios.
//
// App:   GET  /api/athlete/questionnaires                 · pendientes y respondidos (sin audio)
//        POST /api/athlete/questionnaires/:id/answer      · { answers: {q1:'…', q9:'texto'}, audio: {q9:{mime,seconds,data(base64)}} }
// Coach: GET  /api/coach/questionnaires?status=answered&unseen=1   · para «Para revisar»
//        GET  /api/coach/questionnaire-templates
//        GET  /api/coach/athletes/:id/questionnaires
//        POST /api/coach/athletes/:id/questionnaires      · { template_id }
//        POST /api/coach/questionnaires/:id/seen
//        DELETE /api/coach/questionnaires/:id             · solo si sigue pendiente
//        GET  /api/coach/questionnaires/:id/audio/:qid    · el audio tal cual
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const Q = require('./public/js/runflow-questionnaires.js');

const QUESTIONNAIRE_CATEGORY = '__runflow_questionnaire__';
const AUDIO_CATEGORY = '__runflow_questionnaire_audio__';
const MAX_BODY = 6 * 1024 * 1024;
const LIST_SELECT = 'id,athlete_id,coach_user_id,template_data,created_at,updated_at';

function publicItem(row, athleteName) {
  const d = row?.template_data || {};
  return {
    id: row.id, athlete_id: row.athlete_id, athlete_name: athleteName || undefined,
    template_id: d.template_id, title: d.title, intro: d.intro, questions: d.questions || [],
    status: d.status || 'pending', assigned_at: d.assigned_at || row.created_at, answered_at: d.answered_at || null,
    seen_at: d.seen_at || null, answers: d.answers || null,
  };
}

async function listForAthlete(rows, athleteId) {
  const found = await rows('workout_templates', `athlete_id=eq.${encodeURIComponent(athleteId)}&category=eq.${encodeURIComponent(QUESTIONNAIRE_CATEGORY)}&select=${LIST_SELECT}&order=created_at.desc&limit=50`);
  return (found || []).map(row => publicItem(row));
}

async function getRow(rows, id) {
  const found = await rows('workout_templates', `id=eq.${encodeURIComponent(id)}&category=eq.${encodeURIComponent(QUESTIONNAIRE_CATEGORY)}&select=${LIST_SELECT}&limit=1`);
  return found?.[0] || null;
}

// Crea el envío. Si ya hay uno pendiente de la misma plantilla, lo devuelve en lugar de duplicarlo.
async function assign(rows, coachUserId, athleteId, templateId) {
  const snap = Q.snapshot(templateId);
  if (!snap) throw Object.assign(new Error('Ese cuestionario no existe.'), { status: 400 });
  const current = await listForAthlete(rows, athleteId);
  const pending = current.find(item => item.template_id === templateId && item.status === 'pending');
  if (pending) return { item: pending, created: false };
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(), coach_user_id: coachUserId, athlete_id: athleteId, name: `Cuestionario · ${snap.title}`,
    category: QUESTIONNAIRE_CATEGORY, sport: 'Internal', stimulus: 'questionnaire',
    template_data: { ...snap, status: 'pending', assigned_at: now, answered_at: null, seen_at: null, answers: null },
    created_at: now, updated_at: now,
  };
  const created = await rows('workout_templates', '', { method: 'POST', body: row, prefer: 'return=representation' });
  return { item: publicItem(created?.[0] || row), created: true };
}

async function answer(rows, athleteId, id, body) {
  const row = await getRow(rows, id);
  if (!row || row.athlete_id !== athleteId) throw Object.assign(new Error('Cuestionario no encontrado.'), { status: 404 });
  const data = row.template_data || {};
  if (data.status === 'answered') throw Object.assign(new Error('Ya enviaste este cuestionario. ¡Gracias!'), { status: 409 });
  const { answers, errors, audio } = Q.cleanAnswers(data.questions, body);
  if (errors.length) throw Object.assign(new Error(errors[0]), { status: 400, errors });
  const now = new Date().toISOString();
  for (const a of audio) {
    const audioRow = {
      id: crypto.randomUUID(), coach_user_id: row.coach_user_id, athlete_id: athleteId, name: `Audio · ${data.title}`,
      category: AUDIO_CATEGORY, sport: 'Internal', stimulus: 'questionnaire-audio',
      template_data: { questionnaire_id: id, question_id: a.question_id, mime: a.mime, seconds: a.seconds, bytes: Math.floor(a.data.length * 3 / 4), data: a.data },
      created_at: now, updated_at: now,
    };
    await rows('workout_templates', '', { method: 'POST', body: audioRow, prefer: 'return=minimal' });
    answers[a.question_id] = { ...answers[a.question_id], audio_id: audioRow.id, audio_seconds: a.seconds, audio_mime: a.mime };
  }
  const next = { ...data, status: 'answered', answered_at: now, answers };
  const updated = await rows('workout_templates', `id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { template_data: next, updated_at: now }, prefer: 'return=representation' });
  return publicItem(updated?.[0] || { ...row, template_data: next });
}

// Respuestas en texto legible (para el asistente): pregunta → respuesta.
function readable(item) {
  return {
    id: item.id, cuestionario: item.title, estado: item.status === 'answered' ? 'respondido' : 'pendiente',
    enviado: item.assigned_at, respondido: item.answered_at, visto_por_coach: item.seen_at,
    respuestas: item.answers ? item.questions.map((q, i) => {
      const a = item.answers[q.id];
      if (q.type === 'choice') return { pregunta: `${i + 1}. ${q.text}`, respuesta: a || null };
      return { pregunta: `${i + 1}. ${q.text}`, respuesta: a?.text || null, audio: a?.audio_id ? `Grabó un audio de ${a.audio_seconds || '?'} s (se escucha en el Coach)` : null };
    }) : null,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(Object.assign(new Error('El audio es demasiado largo.'), { status: 413 })); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); try { resolve(text ? JSON.parse(text) : {}); } catch { reject(Object.assign(new Error('JSON no válido.'), { status: 400 })); } });
    req.on('error', reject);
  });
}

// deps: { rows, athleteIdentity, coachUser, coachIdentity, sendJson } de football-api-hook.js
function install(deps) {
  const { rows, athleteIdentity, coachUser, coachIdentity, sendJson } = deps;
  const coachRow = async (req, id) => {
    const row = await getRow(rows, id);
    if (!row) throw Object.assign(new Error('Cuestionario no encontrado.'), { status: 404 });
    await coachIdentity(req, row.athlete_id);
    return row;
  };

  async function handle(req, res, url) {
    const path = url.pathname, method = String(req.method || 'GET').toUpperCase();
    let m;
    if (path === '/api/athlete/questionnaires' && method === 'GET') {
      const identity = await athleteIdentity(req);
      return sendJson(res, 200, { questionnaires: await listForAthlete(rows, identity.athleteId) });
    }
    if ((m = path.match(/^\/api\/athlete\/questionnaires\/([^/]+)\/answer$/)) && method === 'POST') {
      const identity = await athleteIdentity(req);
      return sendJson(res, 200, { questionnaire: await answer(rows, identity.athleteId, decodeURIComponent(m[1]), await readBody(req)) });
    }
    if (path === '/api/coach/questionnaire-templates' && method === 'GET') {
      await coachUser(req);
      return sendJson(res, 200, { templates: Q.listTemplates() });
    }
    if (path === '/api/coach/questionnaires' && method === 'GET') {
      const user = await coachUser(req);
      const found = await rows('workout_templates', `coach_user_id=eq.${encodeURIComponent(user.id)}&category=eq.${encodeURIComponent(QUESTIONNAIRE_CATEGORY)}&select=${LIST_SELECT}&order=updated_at.desc&limit=60`);
      let items = (found || []).map(row => publicItem(row));
      if (url.searchParams.get('status')) items = items.filter(i => i.status === url.searchParams.get('status'));
      if (url.searchParams.get('unseen') === '1') items = items.filter(i => !i.seen_at);
      const ids = [...new Set(items.map(i => i.athlete_id))];
      const names = ids.length ? await rows('athletes', `id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,display_name`).catch(() => []) : [];
      const nameOf = id => { const a = (names || []).find(x => x.id === id); return a?.display_name || ''; };
      return sendJson(res, 200, { questionnaires: items.map(i => ({ ...i, athlete_name: nameOf(i.athlete_id) })) });
    }
    if ((m = path.match(/^\/api\/coach\/athletes\/([^/]+)\/questionnaires$/)) && ['GET', 'POST'].includes(method)) {
      const athleteId = decodeURIComponent(m[1]), user = await coachIdentity(req, athleteId);
      if (method === 'GET') return sendJson(res, 200, { questionnaires: await listForAthlete(rows, athleteId), templates: Q.listTemplates() });
      const body = await readBody(req);
      const result = await assign(rows, user.id, athleteId, String(body.template_id || ''));
      return sendJson(res, result.created ? 201 : 200, { questionnaire: result.item, created: result.created });
    }
    if ((m = path.match(/^\/api\/coach\/questionnaires\/([^/]+)\/seen$/)) && method === 'POST') {
      const row = await coachRow(req, decodeURIComponent(m[1]));
      const now = new Date().toISOString();
      const next = { ...row.template_data, seen_at: row.template_data?.seen_at || now };
      await rows('workout_templates', `id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { template_data: next }, prefer: 'return=minimal' });
      return sendJson(res, 200, { ok: true, seen_at: next.seen_at });
    }
    if ((m = path.match(/^\/api\/coach\/questionnaires\/([^/]+)$/)) && method === 'DELETE') {
      const row = await coachRow(req, decodeURIComponent(m[1]));
      if (row.template_data?.status === 'answered') throw Object.assign(new Error('Ya está respondido: no se borra.'), { status: 409 });
      await rows('workout_templates', `id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE', prefer: 'return=minimal' });
      return sendJson(res, 200, { ok: true });
    }
    if ((m = path.match(/^\/api\/coach\/questionnaires\/([^/]+)\/audio\/([^/]+)$/)) && method === 'GET') {
      const row = await coachRow(req, decodeURIComponent(m[1]));
      const ans = row.template_data?.answers?.[decodeURIComponent(m[2])];
      if (!ans?.audio_id) throw Object.assign(new Error('No hay audio.'), { status: 404 });
      const found = await rows('workout_templates', `id=eq.${encodeURIComponent(ans.audio_id)}&category=eq.${encodeURIComponent(AUDIO_CATEGORY)}&select=template_data&limit=1`);
      const audio = found?.[0]?.template_data;
      if (!audio?.data) throw Object.assign(new Error('No hay audio.'), { status: 404 });
      const buffer = Buffer.from(audio.data, 'base64');
      res.writeHead(200, { 'Content-Type': String(audio.mime || 'audio/webm').split(';')[0], 'Content-Length': buffer.length, 'Cache-Control': 'private, no-store' });
      res.end(buffer);
      return true;
    }
    return false;
  }

  const previousCreateServer = http.createServer;
  http.createServer = function questionnaireCreateServer(listener) {
    return previousCreateServer.call(http, async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (/^\/api\/(athlete|coach)\/(questionnaire|athletes\/[^/]+\/questionnaires)/.test(url.pathname)) {
          const handled = await handle(req, res, url);
          if (handled !== false) return;
        }
      } catch (error) {
        if (Number(error.status || 500) >= 500) console.error('[questionnaires]', error);
        if (!res.headersSent) { res.writeHead(Number(error.status || 500), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: error.message || 'Error interno.' })); }
        return;
      }
      return listener(req, res);
    });
  };
}

module.exports = { install, assign, answer, listForAthlete, readable, publicItem, QUESTIONNAIRE_CATEGORY, AUDIO_CATEGORY };
