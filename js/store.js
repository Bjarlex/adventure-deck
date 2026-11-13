// Storage: everything lives on the phone (localStorage + IndexedDB for photos).
// If a sync server is configured, players, crew cards, card switches and finished games
// are merged with the server so every phone in the crew sees the same records.

const DATA_KEY = 'cad.data.v1';
const SETTINGS_KEY = 'cad.settings.v1';
const GAME_KEY = 'cad.game.v1';
export const COLLECTIONS = ['players', 'cards', 'games', 'toggles'];

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { console.warn('save failed', key, e); return false; }
}

const emptyData = () => Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));

export const store = {
  data: { ...emptyData(), ...load(DATA_KEY, {}) },
  settings: { range: 1000, apiUrl: '', crewKey: '', lastPush: 0, lastSync: 0, syncError: '', ...load(SETTINGS_KEY, {}) },
  game: load(GAME_KEY, null),
  listeners: new Set(),

  saveData() { save(DATA_KEY, this.data); },
  saveSettings() { save(SETTINGS_KEY, this.settings); },
  saveGame() { if (this.game) save(GAME_KEY, this.game); else localStorage.removeItem(GAME_KEY); },

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

  resetAll() {
    this.data = emptyData();
    this.game = null;
    this.settings = { ...this.settings, lastPush: 0, lastSync: 0, syncError: '' };
    this.saveData(); this.saveGame(); this.saveSettings();
  },

  onChange(fn) { this.listeners.add(fn); },
  emit() { for (const fn of this.listeners) fn(); },
};

export const uid = (prefix = '') => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ── Sync with the Cloudflare Worker ─────────────────────────────────────────
let syncTimer = null;
let syncing = null;

export function syncConfigured() {
  return !!(store.settings.apiUrl && store.settings.crewKey);
}

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
    const s = store.settings;
    const startedAt = Date.now();
    const payload = Object.fromEntries(COLLECTIONS.map((c) => [c, Object.values(store.data[c]).filter((i) => (i.updatedAt || 0) > (s.lastPush || 0))]));
    try {
      const res = await fetch(s.apiUrl.replace(/\/+$/, '') + '/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-crew-key': s.crewKey },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let msg = `Server said ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      const doc = await res.json();
      const changed = store.merge(doc);
      Object.assign(s, { lastPush: startedAt, lastSync: Date.now(), syncError: '' });
      store.saveSettings();
      if (changed) store.emit();
      return { ok: true, changed };
    } catch (e) {
      s.syncError = e.message === 'Failed to fetch' || e.name === 'TypeError' ? 'Offline or server unreachable' : e.message;
      store.saveSettings();
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
