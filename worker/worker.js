// Adventure Deck sync server: a Cloudflare Worker with one KV namespace.
// It stores the crew's shared data (players, crew cards, card switches, finished games)
// as one JSON document and merges updates from each phone: newest updatedAt wins per item.
//
// Bindings (set in the Cloudflare dashboard, see README):
//   DECK            KV namespace   where the crew document is stored
//   CREW_KEY        secret         shared crew key; phones must send it in the x-crew-key header
//   ALLOWED_ORIGIN  text variable  your GitHub Pages origin, e.g. https://yourname.github.io
//                                  (no path, no trailing slash). Leave unset to allow any origin.

const COLLECTIONS = ['players', 'cards', 'games', 'toggles'];
const DOC_KEY = 'crew:doc:v1';
const MAX_BODY = 2_000_000;      // bytes per request
const MAX_ITEM = 200_000;        // bytes per item (a long game log is ~20 KB)
const MAX_ITEMS = 5000;          // per collection

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    try {
      if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) throw httpError(403, 'Origin not allowed');
      if (url.pathname === '/' || url.pathname === '/api/health') return json({ ok: true, app: 'adventure-deck' }, 200, cors);
      if (url.pathname !== '/api/sync') throw httpError(404, 'Not found');
      if (!env.CREW_KEY || !env.DECK) throw httpError(500, 'Server not configured: add the DECK KV binding and the CREW_KEY secret');
      if (!safeEqual(request.headers.get('x-crew-key') || '', env.CREW_KEY)) throw httpError(401, 'Wrong crew key');

      const doc = (await env.DECK.get(DOC_KEY, 'json')) || emptyDoc();
      if (request.method === 'GET') return json(toLists(doc), 200, cors);
      if (request.method !== 'POST') throw httpError(405, 'Method not allowed');

      const raw = await request.text();
      if (raw.length > MAX_BODY) throw httpError(413, 'Too much data in one sync');
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { throw httpError(400, 'Invalid JSON'); }

      const changed = mergeInto(doc, body, Date.now());
      if (changed) await env.DECK.put(DOC_KEY, JSON.stringify(doc)); // only write when something changed (free plan: 1,000 writes/day)
      return json(toLists(doc), 200, cors);
    } catch (e) {
      return json({ error: e.message || 'Server error' }, e.status || 500, cors);
    }
  },
};

function emptyDoc() {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));
}

/** Merge incoming lists into the stored doc. Returns how many items changed. */
function mergeInto(doc, body, now) {
  let changed = 0;
  for (const coll of COLLECTIONS) {
    doc[coll] ??= {};
    const items = Array.isArray(body?.[coll]) ? body[coll] : [];
    for (const item of items) {
      if (!validItem(item, now)) continue;
      const mine = doc[coll][item.id];
      if (mine && (mine.updatedAt || 0) >= item.updatedAt) continue;
      if (!mine && Object.keys(doc[coll]).length >= MAX_ITEMS) continue;
      doc[coll][item.id] = item;
      changed++;
    }
  }
  return changed;
}

function validItem(item, now) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (typeof item.id !== 'string' || !/^[\w-]{1,64}$/.test(item.id)) return false;
  if (typeof item.updatedAt !== 'number' || item.updatedAt > now + 86_400_000) return false; // no items from the far future
  return JSON.stringify(item).length <= MAX_ITEM;
}

function toLists(doc) {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, Object.values(doc[c] || {})]));
}

function corsHeaders(origin, env) {
  const allow = env.ALLOWED_ORIGIN || '*';
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-crew-key',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function safeEqual(a, b) {
  // Constant-time comparison, so the key cannot be guessed from response timing.
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}
