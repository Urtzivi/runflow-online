'use strict';

// Repairs a missing or stale auth-user -> athlete link without creating a new athlete.
// Safety rules:
// - authenticated user must have athlete role
// - there must be exactly one active athlete with the same normalized email
// - if that athlete is linked to another auth UUID, that old auth user must no longer exist
const http = require('http');
const { URL } = require('url');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status, data });
  return data;
}

async function authUser(accessToken) {
  return jsonFetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
}

async function authAdminUser(userId) {
  try {
    const user = await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    return user || null;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function rows(table, query = '', options = {}) {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.prefer ? { Prefer: options.prefer } : {}),
  };
  return jsonFetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function repairAthleteLink(req) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return;
  const access = parseCookies(req).rf_access;
  if (!access) return;

  let user;
  try { user = await authUser(access); } catch { return; }
  if (!user?.id || !user?.email) return;

  const roles = await rows('user_roles', `user_id=eq.${encodeURIComponent(user.id)}&role=eq.athlete&select=role&limit=1`).catch(() => []);
  if (!roles.length) return;

  const linked = await rows('athletes', `user_id=eq.${encodeURIComponent(user.id)}&lifecycle_status=eq.active&select=id&limit=1`).catch(() => []);
  if (linked.length) return;

  const email = String(user.email).trim().toLowerCase();
  if (!email) return;
  const matches = await rows('athletes', `email=eq.${encodeURIComponent(email)}&lifecycle_status=eq.active&select=id,user_id,email&limit=2`).catch(() => []);
  if (matches.length !== 1) {
    if (matches.length > 1) console.warn('[athlete-link-recovery] ambiguous athlete email', email);
    return;
  }

  const athlete = matches[0];
  if (athlete.user_id && String(athlete.user_id) !== String(user.id)) {
    let oldAuthUser;
    try { oldAuthUser = await authAdminUser(athlete.user_id); }
    catch (error) {
      console.error('[athlete-link-recovery] could not verify stale auth user', error);
      return;
    }
    if (oldAuthUser) {
      console.warn('[athlete-link-recovery] athlete still linked to an existing auth user', athlete.id);
      return;
    }
    console.warn('[athlete-link-recovery] replacing stale auth link', athlete.id);
  }

  await rows('athletes', `id=eq.${encodeURIComponent(athlete.id)}`, {
    method: 'PATCH',
    body: { user_id: user.id, updated_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
  console.log('[athlete-link-recovery] repaired user-athlete link', athlete.id);
}

const previousCreateServer = http.createServer;
http.createServer = function athleteLinkRecoveryCreateServer(listener) {
  return previousCreateServer.call(http, async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/athlete/')) await repairAthleteLink(req);
    } catch (error) {
      console.error('[athlete-link-recovery]', error);
    }
    return listener(req, res);
  });
};
