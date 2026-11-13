// Storage: everything lives on the phone (localStorage + IndexedDB for photos).
//
// Crews: a phone can belong to several crews and switch between them. Each crew has its own
// players, crew cards, card switches and finished games on the phone (its own localStorage
// key), so switching never mixes anything up. "This phone only" is a crew that never syncs.
// Shared crews are merged with the crew server so every phone in that crew sees the same records.

import { DEFAULT_SERVER } from './config.js';

const DATA_KEY = 'cad.data.v1';
const SETTINGS_KEY = 'cad.settings.v1';
const GAME_KEY = 'cad.game.v1';
export const COLLECTIONS = ['players', 'cards', 'games', 'toggles'];
export const LOCAL = 'local';
export const MAIN = 'main';

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { console.warn('save failed', key, e); return false; }
}

const emptyData = () => Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));

/**
 * Bring settings from any earlier version up to date. Before crews (≤ 2.3) there was one
 * shared crew via `crewKey`; its data stays where it was and becomes the "main" crew.
 */
export function migrateSettings(s) {
  s = { range: 1000, apiUrl: '', adminKey: '', crews: [], activeCrew: '', ...s };
  if ('crewKey' in s) {
    const hadSync = !!(s.apiUrl && s.crewKey);
    s.adminKey = s.crewKey || '';
    if (hadSync) s.crews.push({ id: MAIN, name: 'Main crew', admin: true, dataKey: DATA_KEY, meId: s.meId || '', lastPush: s.lastPush || 0, lastSync: s.lastSync || 0, syncError: '' });
    s.activeCrew = hadSync ? MAIN : LOCAL;
    // The app now knows the crew server by itself; only keep a custom one.
    if (s.apiUrl.replace(/\/+$/, '') === DEFAULT_SERVER) s.apiUrl = '';
    for (const k of ['crewKey', 'lastPush', 'lastSync', 'syncError']) delete s[k];
  }
  if (!s.crews.some((c) => c.local)) {
    const dataTaken = s.crews.some((c) => c.dataKey === DATA_KEY);
    s.crews.unshift({ id: LOCAL, name: 'This phone only', local: true, dataKey: dataTaken ? `${DATA_KEY}:${LOCAL}` : DATA_KEY, meId: dataTaken ? '' : (s.meId || '') });
  }
  delete s.meId;
  if (!s.crews.some((c) => c.id === s.activeCrew)) s.activeCrew = (s.crews.find((c) => c.id === MAIN) || s.crews[0]).id;
  return s;
}

const settings = migrateSettings(load(SETTINGS_KEY, {}));
const activeEntry = () => settings.crews.find((c) => c.id === settings.activeCrew);

export const store = {
  settings,
  data: { ...emptyData(), ...load(activeEntry().dataKey, {}) },
  game: load(GAME_KEY, null),
  listeners: new Set(),

  /** The crew this phone is playing in right now. */
  crew() { return activeEntry(); },
  crews() { return this.settings.crews; },

  saveData() { save(this.crew().dataKey, this.data); },
  saveSettings() { save(SETTINGS_KEY, this.settings); },
  saveGame() { if (this.game) save(GAME_KEY, this.game); else localStorage.removeItem(GAME_KEY); },

  /** Switch to another crew on this phone (not while a game is running). */
  switchCrew(id) {
    if (this.game) throw new Error('Finish or leave the running game first');
    const next = this.settings.crews.find((c) => c.id === id);
    if (!next) throw new Error('Unknown crew');
    this.saveData();
    this.settings.activeCrew = id;
    this.saveSettings();
    this.data = { ...emptyData(), ...load(next.dataKey, {}) };
    clearTimeout(syncTimer);
  },

  /** Add a crew to this phone, or update it (e.g. a member pass for a crew we already have). */
  addCrew({ id, name, token, admin, invite }) {
    let c = this.settings.crews.find((x) => x.id === id);
    if (!c) {
      c = { id, name, dataKey: `${DATA_KEY}:${id}`, meId: '', lastPush: 0, lastSync: 0, syncError: '' };
      this.settings.crews.push(c);
    }
    Object.assign(c, { name: name || c.name }, token ? { token } : {}, admin ? { admin: true } : {}, invite ? { invite } : {});
    this.saveSettings();
    return c;
  },

  /** Remove a crew from this phone, including its local copy. The server keeps the crew's data. */
  removeCrew(id) {
    const c = this.settings.crews.find((x) => x.id === id);
    if (!c || c.local || id === this.settings.activeCrew) return false;
    localStorage.removeItem(c.dataKey);
    this.settings.crews = this.settings.crews.filter((x) => x.id !== id);
    this.saveSettings();
    return true;
  },

  list(coll) { return Object.values(this.data[coll]).filter((x) => !x.deleted); },
  get(coll, id) { const x = this.data[coll][id]; return x && !x.deleted ? x : null; },

  put(coll, item) {
    this.data[coll][item.id] = { ...item, updatedAt: Date.now() };
    this.saveData();
    scheduleSync();
    return this.data[coll][item.id];
  },
  remove(coll, id) {
    this.data[coll][id] = { id, deleted: true, updatedAt: Date.now() };
    this.saveData();
    scheduleSync();
  },

  /** Merge items from elsewhere (server or backup file). Newest updatedAt wins. Returns number changed. */
  merge(incoming) {
    let changed = 0;
    for (const coll of COLLECTIONS) {
      for (const item of incoming?.[coll] || []) {
        if (!item || typeof item.id !== 'string') continue;
        const mine = this.data[coll][item.id];
        if (!mine || (item.updatedAt || 0) > (mine.updatedAt || 0)) { this.data[coll][item.id] = item; changed++; }
      }
    }
    if (changed) this.saveData();
    return changed;
  },

  exportJSON() {
    return JSON.stringify({ app: 'adventure-deck', version: 1, exportedAt: new Date().toISOString(),
      ...Object.fromEntries(COLLECTIONS.map((c) => [c, Object.values(this.data[c])])) }, null, 1);
  },

  /** Wipe this crew's data on this phone (and any running game). A shared crew re-downloads on the next sync. */
  resetAll() {
    this.data = emptyData();
    this.game = null;
    Object.assign(this.crew(), { lastPush: 0, lastSync: 0, syncError: '' });
    this.saveData(); this.saveGame(); this.saveSettings();
  },

  onChange(fn) { this.listeners.add(fn); },
  emit() { for (const fn of this.listeners) fn(); },
};

export const uid = (prefix = '') => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ── Talking to the crew server ──────────────────────────────────────────────
let syncTimer = null;
let syncing = null;

export const apiUrl = () => (store.settings.apiUrl || DEFAULT_SERVER).replace(/\/+$/, '');

/** Credentials for a crew: this phone's member pass, or the owner's admin key. */
export function authHeaders(crew = store.crew()) {
  if (crew.token) return { 'x-crew-id': crew.id, 'x-member-token': crew.token };
  return { 'x-crew-id': crew.id, 'x-crew-key': store.settings.adminKey };
}

export const canSync = (crew = store.crew()) => !!(crew && !crew.local && !crew.deleted && apiUrl() && (crew.token || (crew.admin && store.settings.adminKey)));
export const syncConfigured = () => canSync();
export const isAdmin = () => !!store.settings.adminKey;

/** Call the crew server. Throws an Error with the server's message on failure. */
export async function api(method, path, body, headers = {}) {
  let res;
  try {
    res = await fetch(apiUrl() + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new Error('No connection to the crew server');
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(data?.error || `Server said ${res.status}`); e.status = res.status; throw e; }
  return data;
}

const adminHeaders = () => ({ 'x-crew-key': store.settings.adminKey });

export const crewsApi = {
  /** Join with an invite code; this phone gets its own member pass. */
  async join(invite) {
    const r = await api('POST', '/api/join', { invite: String(invite).trim() });
    return store.addCrew({ id: r.crew.id, name: r.crew.name, token: r.token, invite: String(invite).trim().toUpperCase().replace(/^MAIN-/, 'main-') });
  },
  /** Owner only: make a new crew. */
  async create(name) {
    const r = await api('POST', '/api/crews', { name }, adminHeaders());
    return store.addCrew({ id: r.id, name: r.name, admin: true, invite: r.invite });
  },
  /** Owner only: a fresh invite code. Old codes stop working; existing members stay in. */
  async newInvite(id) {
    const r = await api('POST', `/api/crews/${id}/invite`, { name: store.settings.crews.find((c) => c.id === id)?.name }, adminHeaders());
    return store.addCrew({ id, name: r.name, admin: true, invite: r.invite });
  },
  /** Owner only: every crew on the server. */
  list: () => api('GET', '/api/crews', null, adminHeaders()),
  /** Owner only: erase a crew on the server (not Main), then drop it from this phone. */
  async remove(id) {
    const r = await api('DELETE', `/api/crews/${id}`, null, adminHeaders());
    const c = store.settings.crews.find((x) => x.id === id);
    if (c) {
      if (store.settings.activeCrew === id) {
        store.switchCrew((store.settings.crews.find((x) => x.id === MAIN && !x.deleted) || store.settings.crews.find((x) => x.local)).id);
      }
      store.removeCrew(id);
    }
    return r;
  },
};

export function scheduleSync(delay = 2500) {
  if (!syncConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync().catch(() => {}), delay);
}

/** Push local changes since the last successful push, then pull and merge the server copy. */
export async function sync() {
  if (!syncConfigured()) return { skipped: true };
  if (syncing) return syncing;
  syncing = (async () => {
    const c = store.crew(); // sync markers live per crew
    const startedAt = Date.now();
    const payload = Object.fromEntries(COLLECTIONS.map((k) => [k, Object.values(store.data[k]).filter((i) => (i.updatedAt || 0) > (c.lastPush || 0))]));
    try {
      const doc = await api('POST', '/api/sync', payload, authHeaders(c));
      if (store.crew().id !== c.id) return { ok: true, changed: 0, switched: true }; // crew switched meanwhile: ignore
      const changed = store.merge(doc);
      Object.assign(c, { lastPush: startedAt, lastSync: Date.now(), syncError: '' });
      store.saveSettings();
      if (changed) store.emit();
      return { ok: true, changed };
    } catch (e) {
      c.syncError = e.message;
      if (e.status === 410) c.deleted = true; // the owner deleted this crew
      store.saveSettings();
      if (e.status === 410) store.emit();
      throw e;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// ── Photos (IndexedDB, stay on this phone) ──────────────────────────────────
let dbp = null;
function photoDb() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('cad-photos', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const db = await photoDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('photos', mode);
    const r = fn(t.objectStore('photos'));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}
export const photos = {
  put: (key, blob) => tx('readwrite', (s) => s.put(blob, key)),
  get: (key) => tx('readonly', (s) => s.get(key)),
  del: (key) => tx('readwrite', (s) => s.delete(key)),
};

/** Shrink a camera photo to max 1000 px JPEG so storage stays small. */
export function compressImage(file, max = 1000, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not compress photo'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read photo')); };
    img.src = url;
  });
}
