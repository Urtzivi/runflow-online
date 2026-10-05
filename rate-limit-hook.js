'use strict';

// Per-IP request limits for login, password recovery and OpenAI-backed
// endpoints. In-memory: enough for a single Render instance.
const http = require('http');
const { URL } = require('url');

const WINDOW_MS = 15 * 60 * 1000;
const RULES = [
  { name: 'auth', max: Number(process.env.RATE_LIMIT_AUTH_MAX || 20), match: (method, path) => method === 'POST' && path.startsWith('/api/auth/') && path !== '/api/auth/logout' },
  { name: 'ai', max: Number(process.env.RATE_LIMIT_AI_MAX || 30), match: (method, path) => method === 'POST' && (/^\/api\/coach\/athletes\/[^/]+\/activities\/[^/]+\/analyze$/.test(path) || path === '/api/athlete/transcribe-feedback') },
];
const buckets = new Map();

function clientIp(req) {
  // Render sits behind a proxy and puts the real client first in X-Forwarded-For.
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function hit(key, max, now) {
  let bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) {
    bucket = { count: 0, reset: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count > max ? Math.ceil((bucket.reset - now) / 1000) : 0;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
}, WINDOW_MS).unref();

const previousCreateServer = http.createServer;
http.createServer = function rateLimitCreateServer(listener) {
  return previousCreateServer.call(http, (req, res) => {
    let path = '';
    try { path = new URL(req.url, 'http://localhost').pathname; } catch { return listener(req, res); }
    const method = req.method || 'GET';
    const rule = RULES.find(item => item.match(method, path));
    if (rule) {
      const retryAfter = hit(`${rule.name}:${clientIp(req)}`, rule.max, Date.now());
      if (retryAfter) {
        const body = JSON.stringify({ error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' });
        res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' });
        return res.end(body);
      }
    }
    return listener(req, res);
  });
};
