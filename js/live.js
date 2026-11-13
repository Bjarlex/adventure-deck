// Live games: talk to /api/live on the crew's Worker.
// The game state itself is computed on the phones (rules.js); the server only stores it and
// makes sure changes are applied one at a time (version numbers).

import { store } from './store.js';

export class LiveError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function call(method, path, body) {
  const s = store.settings;
  let res;
  try {
    res = await fetch(s.apiUrl.replace(/\/+$/, '') + '/api/live' + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-crew-key': s.crewKey },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new LiveError('No connection to the server', 0);
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.ok) return data;
  if (res.status === 409) throw new LiveError('Someone else changed the game first', 409, data);
  throw new LiveError(data?.error || `Server said ${res.status}`, res.status, data);
}

/** The part of a game that is shared: everything except this phone's live bookkeeping. */
export function sharedState(game) {
  const { live, ...rest } = game;
  return rest;
}

export const live = {
  create: (game) => call('POST', '', { state: sharedState(game) }),           // → {code, version}
  get: (code, since) => call('GET', `/${code}${since ? `?since=${since}` : ''}`), // → null if unchanged, else {version, state}
  put: (code, baseVersion, game) => call('PUT', `/${code}`, { baseVersion, state: sharedState(game) }), // → {version}, or LiveError 409 with body {version, state}
  remove: (code) => call('DELETE', `/${code}`),
};

export const normaliseCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
