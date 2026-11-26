// Combobulate API: one Cloudflare Worker, free plan.
//
//   GET /pair?first=Water&second=Fire  ->  { result: { name, emoji } | null, isNew }
//   GET /health                        ->  { ok: true }
//
// Each pair is asked of the AI once, ever. After that it comes from D1, so it is the same for
// everyone and costs nothing.

import { isValidInput, pairKeys } from './craft.js';
import { generate } from './providers.js';

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'method' }, 405, cors);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return json({ ok: true }, 200, cors);
      if (url.pathname === '/pair') return await pair(url, request, env, cors);
      return json({ error: 'not_found' }, 404, cors);
    } catch (err) {
      console.error('combobulate error', err);
      return json({ error: 'server' }, 500, cors);
    }
  },
};

async function pair(url, request, env, cors) {
  const first = url.searchParams.get('first');
  const second = url.searchParams.get('second');
  if (!isValidInput(first) || !isValidInput(second)) return json({ error: 'bad_input' }, 400, cors);

  const [a, b] = pairKeys(first, second);

  // 1. Already known? Serve it. This is the common case and never touches the AI.
  const known = await lookup(env, a, b);
  if (known) return json({ result: known.result, isNew: false }, 200, cors);

  // Only elements that really exist can be combined, so nobody can inject made-up words.
  const { results: inputs } = await env.DB.prepare('SELECT key, name FROM elements WHERE key IN (?, ?)')
    .bind(a, b)
    .all();
  const names = Object.fromEntries(inputs.map((r) => [r.key, r.name]));
  if (!names[a] || !names[b]) return json({ error: 'unknown_element' }, 400, cors);

  // 2. Per-visitor daily cap on brand-new pairs, so one person can't burn the free AI allowance.
  const limit = Number(env.DAILY_NEW_PER_VISITOR || 300);
  if (!(await takeQuota(env, request, limit))) return json({ error: 'visitor_limit' }, 429, cors);

  // 3. Ask the model.
  let made;
  try {
    made = await generate(env, names[a], names[b]);
  } catch (err) {
    if (err?.name === 'NoAnswerError') {
      // Every model declined this pair. Save nothing, so a better model can answer it later.
      console.warn('AI declined', err.message);
      return json({ error: 'no_answer' }, 422, cors);
    }
    // Your server is down/busy AND the Workers AI allowance is used up. Save nothing; try later.
    console.warn('AI unavailable', err?.message ?? err);
    return json({ error: 'ai_resting' }, 503, cors);
  }

  // 4. Save it. If someone else saved this pair a moment ago, theirs wins so everyone agrees.
  const resultKey = made ? made.name.toLowerCase() : null;
  const now = Date.now();
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO recipes (a, b, result, created_at) VALUES (?, ?, ?, ?)')
    .bind(a, b, resultKey, now)
    .run();
  if (ins.meta.changes === 0) {
    const raced = await lookup(env, a, b);
    return json({ result: raced?.result ?? null, isNew: false }, 200, cors);
  }
  if (!made) return json({ result: null, isNew: false }, 200, cors);

  const el = await env.DB.prepare('INSERT OR IGNORE INTO elements (key, name, emoji, created_at) VALUES (?, ?, ?, ?)')
    .bind(resultKey, made.name, made.emoji, now)
    .run();
  const isNew = el.meta.changes === 1;
  // If the element already existed (made by a different pair), keep its original spelling and emoji.
  const result = isNew
    ? made
    : await env.DB.prepare('SELECT name, emoji FROM elements WHERE key = ?').bind(resultKey).first();
  return json({ result: { name: result.name, emoji: result.emoji }, isNew }, 200, cors);
}

async function lookup(env, a, b) {
  const row = await env.DB.prepare(
    `SELECT r.result AS result, e.name AS name, e.emoji AS emoji
       FROM recipes r LEFT JOIN elements e ON e.key = r.result
      WHERE r.a = ? AND r.b = ?`,
  )
    .bind(a, b)
    .first();
  if (!row) return null;
  return { result: row.result ? { name: row.name, emoji: row.emoji } : null };
}

async function takeQuota(env, request, limit) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const day = new Date().toISOString().slice(0, 10);
  const visitor = await sha256(`${ip}|${day}|${env.VISITOR_SALT || 'combobulate'}`);
  const row = await env.DB.prepare(
    `INSERT INTO usage (visitor, day, n) VALUES (?, ?, 1)
     ON CONFLICT (visitor, day) DO UPDATE SET n = n + 1
     RETURNING n`,
  )
    .bind(visitor, day)
    .first();
  return row.n <= limit;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const h = { 'access-control-allow-methods': 'GET, OPTIONS', vary: 'origin' };
  if (allowed.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
