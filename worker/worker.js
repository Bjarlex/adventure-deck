// Adventure Deck server: a Cloudflare Worker with one KV namespace and one D1 database.
//
// /api/sync   Crew records (players, crew cards, card switches, finished games) as one JSON
//             document in KV. Updates from each phone are merged: newest updatedAt wins per item.
// /api/live   Games in progress, shared between phones, in D1 (consistent, so every phone sees
//             each move at once). Each game has a version number. A change is only accepted if
//             it was made on top of the latest version, so two phones can never both resolve the
//             same card: the second one gets 409 and the current state back.
//
// Bindings (set in the Cloudflare dashboard, see README):
//   DECK            KV namespace   crew records
//   GAMES           D1 database    live games (only needed for live play)
//   CREW_KEY        secret         shared crew key; phones must send it in the x-crew-key header
//   ALLOWED_ORIGIN  text variable  your GitHub Pages origin, e.g. https://yourname.github.io
//                                  (no path, no trailing slash). Leave unset to allow any origin.

const COLLECTIONS = ['players', 'cards', 'games', 'toggles'];
const DOC_KEY = 'crew:doc:v1';
const MAX_BODY = 2_000_000;      // bytes per request
const MAX_ITEM = 200_000;        // bytes per item (a long game log is ~20 KB)
const MAX_ITEMS = 5000;          // per collection
const MAX_LIVE_STATE = 400_000;  // bytes per live game
const LIVE_TTL = 3 * 86_400_000; // live games untouched for 3 days are cleaned up
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they look like 1 and 0

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    try {
      if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) throw httpError(403, 'Origin not allowed');
      if (url.pathname === '/' || url.pathname === '/api/health') return json({ ok: true, app: 'adventure-deck', live: !!env.GAMES }, 200, cors);
      const isSync = url.pathname === '/api/sync';
      const live = url.pathname.match(/^\/api\/live(?:\/([A-Za-z]{4}))?$/);
      if (!isSync && !live) throw httpError(404, 'Not found');
      if (!env.CREW_KEY) throw httpError(500, 'Server not configured: add the CREW_KEY secret');
      if (!safeEqual(request.headers.get('x-crew-key') || '', env.CREW_KEY)) throw httpError(401, 'Wrong crew key');
      if (live) return await handleLive(request, env, live[1]?.toUpperCase(), url, cors);
      if (!env.DECK) throw httpError(500, 'Server not configured: add the DECK KV binding');

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

// ── Live games (D1) ─────────────────────────────────────────────────────────
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS live_games (code TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  schemaReady = true;
}

async function readState(request) {
  const raw = await request.text();
  if (raw.length > MAX_LIVE_STATE) throw httpError(413, 'Game state too large');
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { throw httpError(400, 'Invalid JSON'); }
  if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) throw httpError(400, 'Missing game state');
  return body;
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

async function handleLive(request, env, code, url, cors) {
  const db = env.GAMES;
  if (!db) throw httpError(500, 'Live games need the GAMES D1 binding (see README)');
  await ensureSchema(db);
  const now = Date.now();

  // Start a live game: store the state, hand out a 4-letter join code.
  if (!code) {
    if (request.method !== 'POST') throw httpError(405, 'Method not allowed');
    const { state } = await readState(request);
    await db.prepare('DELETE FROM live_games WHERE updated_at < ?').bind(now - LIVE_TTL).run();
    for (let i = 0; i < 8; i++) {
      const c = newCode();
      const r = await db.prepare('INSERT OR IGNORE INTO live_games (code, version, state, updated_at) VALUES (?, 1, ?, ?)').bind(c, JSON.stringify(state), now).run();
      if (r.meta?.changes) return json({ code: c, version: 1 }, 201, cors);
    }
    throw httpError(503, 'Could not find a free game code, try again');
  }

  if (request.method === 'GET') {
    const row = await db.prepare('SELECT version, state, updated_at FROM live_games WHERE code = ?').bind(code).first();
    if (!row) throw httpError(404, `No live game with code ${code}`);
    // Cheap polling: nothing changed since the version the phone already has.
    if (url.searchParams.get('since') === String(row.version)) return new Response(null, { status: 204, headers: cors });
    return liveJson(200, row, cors);
  }

  if (request.method === 'PUT') {
    const { state, baseVersion } = await readState(request);
    if (!Number.isInteger(baseVersion)) throw httpError(400, 'Missing baseVersion');
    const r = await db.prepare('UPDATE live_games SET state = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?')
      .bind(JSON.stringify(state), now, code, baseVersion).run();
    if (r.meta?.changes) return json({ version: baseVersion + 1 }, 200, cors);
    const row = await db.prepare('SELECT version, state, updated_at FROM live_games WHERE code = ?').bind(code).first();
    if (!row) throw httpError(404, `No live game with code ${code}`);
    return liveJson(409, row, cors); // someone else changed the game first
  }

  if (request.method === 'DELETE') {
    await db.prepare('DELETE FROM live_games WHERE code = ?').bind(code).run();
    return json({ ok: true }, 200, cors);
  }
  throw httpError(405, 'Method not allowed');
}

function liveJson(status, row, cors) {
  // state is stored as JSON text; splice it in instead of parsing and re-serialising.
  return new Response(`{"version":${row.version},"updatedAt":${row.updated_at},"state":${row.state}}`,
    { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
}

// ── Crew records (KV) ───────────────────────────────────────────────────────
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
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
