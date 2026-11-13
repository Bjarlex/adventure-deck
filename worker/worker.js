// Adventure Deck server: a Cloudflare Worker with one KV namespace and one D1 database.
//
// Crews: each crew (group of friends) has its own records and live games. The original crew
// is called "main". The owner creates crews with the admin key and hands out invite codes.
// A phone that joins with an invite gets its own member pass, so a new invite can be made
// later without locking out existing members.
//
// /api/join          POST {invite}  → {crew, token}          (no other auth: the invite is the proof)
// /api/crew          GET            → the caller's crew
// /api/crews         GET / POST     → list / create crews     (admin key only)
// /api/crews/:id/invite  POST       → a new invite code; the old one stops working (admin key only)
// /api/sync          Crew records (players, crew cards, card switches, finished games) as one JSON
//                    document per crew in KV. Updates are merged: newest updatedAt wins per item.
// /api/live[/CODE]   Games in progress in D1 (consistent: every phone sees each move at once).
//                    Each game has a version number; a change is only accepted if it was made on
//                    top of the latest version, so two phones can never both resolve the same card.
//
// Authentication, per request:
//   x-crew-key: <admin key>             the owner; optionally x-crew-id to pick a crew (default main)
//   x-crew-id + x-member-token          a phone that joined with an invite
//
// Bindings (set in the Cloudflare dashboard, see README):
//   DECK            KV namespace   crew records and crew settings
//   GAMES           D1 database    live games (only needed for live play)
//   CREW_KEY        secret         the owner's admin key
//   ALLOWED_ORIGIN  text variable  your GitHub Pages origin, e.g. https://yourname.github.io
//                                  (no path, no trailing slash). Leave unset to allow any origin.

const COLLECTIONS = ['players', 'cards', 'games', 'toggles'];
const MAIN = 'main';
const MAX_BODY = 2_000_000;      // bytes per request
const MAX_ITEM = 200_000;        // bytes per item (a long game log is ~20 KB)
const MAX_ITEMS = 5000;          // per collection
const MAX_LIVE_STATE = 400_000;  // bytes per live game
const LIVE_TTL = 3 * 86_400_000; // live games untouched for 3 days are cleaned up
const MAX_CREWS = 50;
const MAX_MEMBERS = 200;         // member passes kept per crew (oldest dropped first)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // live game codes: no I or O, they look like 1 and 0
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // crew ids and secrets: no I, O, 0, 1

const docKey = (crew) => (crew === MAIN ? 'crew:doc:v1' : `crew:doc:${crew}`);
const metaKey = (crew) => `crew:meta:${crew}`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) throw httpError(403, 'Origin not allowed');
      if (path === '/' || path === '/api/health') return json({ ok: true, app: 'adventure-deck', live: !!env.GAMES, crews: true }, 200, cors);
      if (!env.CREW_KEY) throw httpError(500, 'Server not configured: add the CREW_KEY secret');
      if (!env.DECK) throw httpError(500, 'Server not configured: add the DECK KV binding');

      if (path === '/api/join') return json(await join(request, env), 200, cors);

      const crewsRoute = path.match(/^\/api\/crews(?:\/([A-Za-z0-9]{4,8})\/invite)?$/);
      if (crewsRoute) {
        await authenticate(request, env, { adminOnly: true });
        if (crewsRoute[1]) {
          if (request.method !== 'POST') throw httpError(405, 'Method not allowed');
          return json(await newInvite(env, normaliseCrewId(crewsRoute[1]), await readJson(request)), 200, cors);
        }
        if (request.method === 'GET') return json(await listCrews(env), 200, cors);
        if (request.method === 'POST') return json(await createCrew(env, await readJson(request)), 201, cors);
        throw httpError(405, 'Method not allowed');
      }

      const isSync = path === '/api/sync';
      const live = path.match(/^\/api\/live(?:\/([A-Za-z]{4}))?$/);
      if (!isSync && !live && path !== '/api/crew') throw httpError(404, 'Not found');
      const who = await authenticate(request, env);

      if (path === '/api/crew') {
        const meta = await getMeta(env, who.crew);
        return json({ id: who.crew, name: meta?.name || 'Main crew', admin: who.admin }, 200, cors);
      }
      if (live) return await handleLive(request, env, who.crew, live[1]?.toUpperCase(), url, cors);

      const key = docKey(who.crew);
      const doc = (await env.DECK.get(key, 'json')) || emptyDoc();
      if (request.method === 'GET') return json(toLists(doc), 200, cors);
      if (request.method !== 'POST') throw httpError(405, 'Method not allowed');
      const raw = await request.text();
      if (raw.length > MAX_BODY) throw httpError(413, 'Too much data in one sync');
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { throw httpError(400, 'Invalid JSON'); }
      const changed = mergeInto(doc, body, Date.now());
      if (changed) await env.DECK.put(key, JSON.stringify(doc)); // only write when something changed (free plan: 1,000 writes/day)
      return json(toLists(doc), 200, cors);
    } catch (e) {
      return json({ error: e.message || 'Server error' }, e.status || 500, cors);
    }
  },
};

// ── Crews ───────────────────────────────────────────────────────────────────
function normaliseCrewId(s) {
  const id = String(s || '').trim();
  return id.toLowerCase() === MAIN ? MAIN : id.toUpperCase();
}
const validCrewId = (id) => id === MAIN || /^[A-Z2-9]{8}$/.test(id);

function randomString(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join(''); // 32 symbols: no modulo bias
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Crew settings are read on every request (live polling!), so keep them in memory briefly.
const metaCache = new Map();
async function getMeta(env, crew) {
  const hit = metaCache.get(crew);
  if (hit && Date.now() - hit.at < 30_000) return hit.meta;
  const meta = await env.DECK.get(metaKey(crew), 'json');
  metaCache.set(crew, { meta, at: Date.now() });
  return meta;
}
async function putMeta(env, meta) {
  await env.DECK.put(metaKey(meta.id), JSON.stringify(meta));
  metaCache.set(meta.id, { meta, at: Date.now() });
}

/** Who is calling? Returns {crew, admin}. Throws 401 if not allowed. */
async function authenticate(request, env, { adminOnly = false } = {}) {
  const key = request.headers.get('x-crew-key');
  const crew = normaliseCrewId(request.headers.get('x-crew-id') || MAIN);
  if (!validCrewId(crew)) throw httpError(400, 'Bad crew id');
  if (key) {
    if (!safeEqual(key, env.CREW_KEY)) throw httpError(401, 'Wrong crew key');
    if (crew !== MAIN && !(await getMeta(env, crew))) throw httpError(404, 'Unknown crew');
    return { crew, admin: true };
  }
  if (adminOnly) throw httpError(401, 'Only the crew owner (admin key) can do this');
  const token = request.headers.get('x-member-token') || '';
  if (!token || !request.headers.get('x-crew-id')) throw httpError(401, 'Not signed in to a crew');
  const meta = await getMeta(env, crew);
  const hash = await sha256(`${token}:${crew}`);
  if (!meta || !(meta.members || []).some((m) => safeEqual(m.hash, hash))) {
    throw httpError(401, 'This phone is not a member of that crew (any more). Ask the owner for a new invite');
  }
  return { crew, admin: false };
}

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > 10_000) throw httpError(413, 'Too large');
  try { return JSON.parse(raw || '{}'); } catch { throw httpError(400, 'Invalid JSON'); }
}

const cleanName = (s, fallback) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 40) || fallback;

async function createCrew(env, body) {
  const existing = await env.DECK.list({ prefix: 'crew:meta:' });
  if (existing.keys.length >= MAX_CREWS) throw httpError(400, `Maximum ${MAX_CREWS} crews`);
  let id;
  for (let i = 0; i < 5; i++) { id = randomString(8); if (!(await env.DECK.get(metaKey(id)))) break; }
  const secret = randomString(20);
  const meta = { id, name: cleanName(body.name, 'New crew'), inviteHash: await sha256(`${secret}:${id}`), members: [], createdAt: Date.now() };
  await putMeta(env, meta);
  return { id, name: meta.name, invite: `${id}-${secret}` };
}

async function listCrews(env) {
  const out = [{ id: MAIN, name: 'Main crew', members: 0 }];
  const { keys } = await env.DECK.list({ prefix: 'crew:meta:' });
  for (const k of keys) {
    const m = await env.DECK.get(k.name, 'json');
    if (!m) continue;
    if (m.id === MAIN) Object.assign(out[0], { name: m.name, members: m.members?.length || 0 });
    else out.push({ id: m.id, name: m.name, members: m.members?.length || 0, createdAt: m.createdAt });
  }
  return out;
}

async function newInvite(env, id, body) {
  if (!validCrewId(id)) throw httpError(400, 'Bad crew id');
  let meta = await env.DECK.get(metaKey(id), 'json');
  if (!meta && id !== MAIN) throw httpError(404, 'Unknown crew');
  meta ??= { id: MAIN, name: cleanName(body?.name, 'Main crew'), members: [], createdAt: Date.now() };
  const secret = randomString(20);
  meta.inviteHash = await sha256(`${secret}:${id}`);
  await putMeta(env, meta);
  return { id, name: meta.name, invite: `${id}-${secret}` };
}

async function join(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'Method not allowed');
  const { invite } = await readJson(request);
  const m = String(invite || '').trim().match(/^([A-Za-z0-9]{4,8})-([A-Za-z0-9]{20})$/);
  if (!m) throw httpError(400, 'That doesn\'t look like an invite code');
  const id = normaliseCrewId(m[1]), secret = m[2].toUpperCase();
  const meta = validCrewId(id) ? await env.DECK.get(metaKey(id), 'json') : null;
  if (!meta?.inviteHash || !safeEqual(meta.inviteHash, await sha256(`${secret}:${id}`))) {
    throw httpError(401, 'This invite code is wrong or has been replaced. Ask the crew owner for a new one');
  }
  const token = randomString(32);
  meta.members = [...(meta.members || []), { hash: await sha256(`${token}:${id}`), at: Date.now() }].slice(-MAX_MEMBERS);
  await putMeta(env, meta);
  return { crew: { id, name: meta.name }, token };
}

// ── Live games (D1) ─────────────────────────────────────────────────────────
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS live_games (code TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL, crew TEXT NOT NULL DEFAULT 'main')").run();
  // Tables made by the first live version have no crew column yet; their games belong to main.
  try { await db.prepare("ALTER TABLE live_games ADD COLUMN crew TEXT NOT NULL DEFAULT 'main'").run(); } catch { /* already there */ }
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

async function handleLive(request, env, crew, code, url, cors) {
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
      const r = await db.prepare('INSERT OR IGNORE INTO live_games (code, version, state, updated_at, crew) VALUES (?, 1, ?, ?, ?)').bind(c, JSON.stringify(state), now, crew).run();
      if (r.meta?.changes) return json({ code: c, version: 1 }, 201, cors);
    }
    throw httpError(503, 'Could not find a free game code, try again');
  }

  // Games are only visible inside their own crew.
  const select = () => db.prepare('SELECT version, state, updated_at FROM live_games WHERE code = ? AND crew = ?').bind(code, crew).first();

  if (request.method === 'GET') {
    const row = await select();
    if (!row) throw httpError(404, `No live game with code ${code} in this crew`);
    // Cheap polling: nothing changed since the version the phone already has.
    if (url.searchParams.get('since') === String(row.version)) return new Response(null, { status: 204, headers: cors });
    return liveJson(200, row, cors);
  }

  if (request.method === 'PUT') {
    const { state, baseVersion } = await readState(request);
    if (!Number.isInteger(baseVersion)) throw httpError(400, 'Missing baseVersion');
    const r = await db.prepare('UPDATE live_games SET state = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ? AND crew = ?')
      .bind(JSON.stringify(state), now, code, baseVersion, crew).run();
    if (r.meta?.changes) return json({ version: baseVersion + 1 }, 200, cors);
    const row = await select();
    if (!row) throw httpError(404, `No live game with code ${code} in this crew`);
    return liveJson(409, row, cors); // someone else changed the game first
  }

  if (request.method === 'DELETE') {
    await db.prepare('DELETE FROM live_games WHERE code = ? AND crew = ?').bind(code, crew).run();
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
    'access-control-allow-headers': 'content-type, x-crew-key, x-crew-id, x-member-token',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function safeEqual(a, b) {
  // Constant-time comparison, so secrets cannot be guessed from response timing.
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
