'use strict';

// Permission and rate-limit smoke test. Starts the full server (start.js,
// with every hook) in demo mode on a free port and checks who can see what.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const demoFile = path.join(root, 'data', 'demo-state.json');
const hadDemoFile = fs.existsSync(demoFile);
const port = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['start.js'], {
  cwd: root,
  env: { ...process.env, DEMO_MODE: '1', NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', RATE_LIMIT_AUTH_MAX: '5' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`El servidor no arrancó.\n${output}`);
}

async function request(pathname, { user, method = 'GET', body, ip } = {}) {
  const headers = {};
  if (user) headers.Cookie = `rf_demo_user=${user}`;
  if (ip) headers['X-Forwarded-For'] = ip;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return response.status;
}

const checks = [
  ['sin sesión no ve atletas', () => request('/api/coach/athletes'), 401],
  ['sin sesión no ve el panel de atleta', () => request('/api/athlete/dashboard'), 401],
  ['un atleta no entra en la API de coach', () => request('/api/coach/athletes', { user: 'u-ibon' }), 403],
  ['un atleta no ve la ficha de otro', () => request('/api/coach/athletes/a-urtzi', { user: 'u-ibon' }), 403],
  ['el coach ve a su atleta', () => request('/api/coach/athletes/a-ibon', { user: 'u-urtzi' }), 200],
  ['el coach no ve atletas ajenos', () => request('/api/coach/athletes/a-otro', { user: 'u-urtzi' }), 403],
  ['el atleta ve su panel', () => request('/api/athlete/dashboard', { user: 'u-ibon' }), 200],
];

(async () => {
  let failed = 0;
  try {
    await waitForServer();
    for (const [name, run, expected] of checks) {
      const status = await run();
      const ok = status === expected;
      if (!ok) failed += 1;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} (esperado ${expected}, recibido ${status})`);
    }
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push(await request('/api/auth/login', { method: 'POST', body: { email: 'x@runflow.demo', password: 'mal' }, ip: '203.0.113.9' }));
    const limited = statuses.slice(0, 5).every(status => status === 401) && statuses[5] === 429;
    if (!limited) failed += 1;
    console.log(`${limited ? 'OK  ' : 'FAIL'} el login se bloquea tras 5 intentos (${statuses.join(', ')})`);
    const otherIp = await request('/api/auth/login', { method: 'POST', body: { email: 'x@runflow.demo', password: 'mal' }, ip: '203.0.113.10' });
    if (otherIp !== 401) failed += 1;
    console.log(`${otherIp === 401 ? 'OK  ' : 'FAIL'} el bloqueo es por IP (recibido ${otherIp})`);
  } finally {
    server.kill();
    if (!hadDemoFile) fs.rmSync(demoFile, { force: true });
  }
  assert.strictEqual(failed, 0, `${failed} comprobaciones fallidas`);
  console.log('Permisos y límites de intentos validados.');
})().catch(error => { console.error(error.message); process.exit(1); });
