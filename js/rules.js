// Game rules: scoring, rejections and penances, game modes, dealing cards, records.
// Pure functions only (no DOM), so they can be tested in tests/index.html.

import { placeById } from './data/places.js';

export const DIFF = {
  1: { label: 'Easy', pts: 10 },
  2: { label: 'Medium', pts: 20 },
  3: { label: 'Hard', pts: 35 },
  4: { label: 'Epic', pts: 50 },
};

export const WHO = {
  solo:   { label: 'Solo',     icon: '👤', hint: 'The player on turn does it and scores' },
  duo:    { label: 'Duo',      icon: '👥', hint: 'The player on turn picks a partner. Both score' },
  group:  { label: 'Everyone', icon: '🙌', hint: 'Everyone takes part and everyone scores' },
  versus: { label: 'Versus',   icon: '⚔️', hint: 'Compete. Only the winner(s) score' },
};

export const TAGS = {
  strangers: { label: 'Strangers', icon: '🗣️' },
  physical:  { label: 'Physical',  icon: '💪' },
  creative:  { label: 'Creative',  icon: '🎨' },
  food:      { label: 'Food',      icon: '🍕' },
  drinks:    { label: 'Drinks',    icon: '🍺' },
  culture:   { label: 'Culture',   icon: '🏛️' },
  photo:     { label: 'Photo',     icon: '📸' },
  explore:   { label: 'Explore',   icon: '🧭' },
  silly:     { label: 'Silly',     icon: '🤪' },
  water:     { label: 'Harbour',   icon: '🌊' },
  transit:   { label: 'Transit',   icon: '🚇' },
  chill:     { label: 'Chill',     icon: '😌' },
  indoor:    { label: 'Indoors',   icon: '🏠' },
};

// ── When a card can be played ───────────────────────────────────────────────
// A card's optional `needs` list; it is only dealt when all of them hold right now.
export const NEEDS = {
  summer:   { label: 'Summer (May–Sep)',         icon: '☀️' },
  winter:   { label: 'Winter (Nov–Mar)',         icon: '❄️' },
  xmas:     { label: 'Christmas (15 Nov–Dec)',   icon: '🎄' },
  daylight: { label: 'Daylight',                 icon: '🌤️' },
  dark:     { label: 'After dark',               icon: '🌙' },
  daytime:  { label: 'Opening hours (10–17)',    icon: '🕙' },
  dry:      { label: 'Not raining',              icon: '🌂' },
  rain:     { label: 'Raining',                  icon: '🌧️' },
};
const CPH = { lat: 55.68, lng: 12.57 };

/** Sunrise and sunset for a date and place (the SunCalc algorithm; accurate to a minute or two). */
export function sunTimes(date, lat = CPH.lat, lng = CPH.lng) {
  const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009, e = rad * 23.4397;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const d = date.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const lw = rad * -lng, phi = rad * lat;
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(0) * Math.cos(e) + Math.cos(0) * Math.sin(e) * Math.sin(L));
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const w = Math.acos((Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  const a = J0 + (w + lw) / (2 * Math.PI) + n;
  const Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset) };
}

/**
 * What's true right now. `weather` ({isDay, raining, temp}) comes from the weather service
 * and may be null (offline): then daylight is calculated and rain is unknown.
 */
export function currentConditions(now = new Date(), weather = null) {
  const month = now.getMonth() + 1, day = now.getDate(), hour = now.getHours();
  const sun = sunTimes(now);
  const isDay = typeof weather?.isDay === 'boolean' ? weather.isDay : now >= sun.rise && now < sun.set;
  return {
    summer: month >= 5 && month <= 9,
    winter: month >= 11 || month <= 3,
    xmas: (month === 11 && day >= 15) || month === 12,
    daylight: isDay,
    dark: !isDay,
    daytime: hour >= 10 && hour < 17,
    raining: typeof weather?.raining === 'boolean' ? weather.raining : null, // null = unknown
    temp: weather?.temp ?? null,
    sunset: sun.set,
  };
}

/** Can this card be played under these conditions? Unknown weather never blocks a card. */
export function fitsConditions(card, cond) {
  if (!cond) return true;
  return (card.needs || []).every((n) => {
    if (n === 'dry') return cond.raining !== true;
    if (n === 'rain') return cond.raining === true;
    return cond[n] === true;
  });
}

export const TOOLS = {
  timer:     { label: 'Timer',          icon: '⏱️' },
  stopwatch: { label: 'Stopwatch',      icon: '⏲️' },
  photo:     { label: 'Photo proof',    icon: '📷' },
  bingo:     { label: 'Sound Bingo',    icon: '🔔' },
  station:   { label: 'Random station', icon: '🚆' },
  compass:   { label: 'Direction',      icon: '🧭' },
  tarot:     { label: 'Urban Tarot',    icon: '🔮' },
  song:      { label: 'Movie scene',    icon: '🎬' },
  topic:     { label: 'Debate topic',   icon: '💬' },
  letter:    { label: 'Random letter',  icon: '🔤' },
  coin:      { label: 'Coin flip',      icon: '🪙' },
  dice:      { label: 'Dice',           icon: '🎲' },
  picker:    { label: 'Pick a player',  icon: '👉' },
};

// ── Scoring constants ───────────────────────────────────────────────────────
export const PLACE_BONUS = 10;      // location cards are worth more: you had to walk there
export const CHECKIN_BONUS = 5;     // GPS confirms you are at the spot
export const CHECKIN_RADIUS = 150;  // metres
export const STYLE_BONUS = 0.25;    // group-awarded "legendary" bonus, +25 %
export const REJECT_SHARE = 0.5;    // a rejection costs half the card's value…
export const REJECT_ESCALATION = 5; // …plus 5 for every earlier paid rejection by the same player this game
export const PENANCE_KEEP = { 1: 0.5, 2: 0.25 }; // light penance halves the loss, heavy keeps a quarter

export const MODES = [
  { id: 'classic',  name: 'Classic',    icon: '🃏', desc: 'The whole deck. 1 free veto each. A penance is offered 40% of the time.',
    filter: {}, rules: { freeVetoes: 1, penanceChance: 0.4, mult: 1 } },
  { id: 'quick',    name: 'Quick walk', icon: '⚡', desc: 'Only cards of 10 minutes or less. 6 rounds.',
    filter: { maxMins: 10 }, rules: { freeVetoes: 1, penanceChance: 0.4, mult: 1, rounds: 6 } },
  { id: 'explorer', name: 'Explorer',   icon: '🧭', desc: 'Location cards come first. Walk to spots within range, or pick a nearby one yourselves. Needs GPS.',
    filter: {}, rules: { freeVetoes: 1, penanceChance: 0.4, mult: 1, placeBias: 0.7, pickNearby: true, needsLocation: true } },
  { id: 'bar',      name: 'Bar crawl',  icon: '🍻', desc: 'Food, drinks, strangers and silliness. 2 free vetoes.',
    filter: { anyTags: ['food', 'drinks', 'strangers', 'silly'] }, rules: { freeVetoes: 2, penanceChance: 0.3, mult: 1 } },
  { id: 'sweat',    name: 'Sweat',      icon: '💪', desc: 'Medium cards and harder. No free vetoes, a penance is always offered, and points ×1.5.',
    filter: { minDiff: 2 }, rules: { freeVetoes: 0, penanceChance: 1, mult: 1.5 } },
  { id: 'chill',    name: 'Chill',      icon: '😌', desc: 'No physical or stranger cards. 2 free vetoes, no penances.',
    filter: { noTags: ['physical', 'strangers'] }, rules: { freeVetoes: 2, penanceChance: 0, mult: 1 } },
  { id: 'crew',     name: 'Crew cards', icon: '✍️', desc: 'Only the cards you made yourselves.',
    filter: { customOnly: true }, rules: { freeVetoes: 1, penanceChance: 0.4, mult: 1 } },
  { id: 'custom',   name: 'Custom',     icon: '🛠️', desc: 'Pick the tags, length, difficulty and rules yourselves.',
    filter: {}, rules: { freeVetoes: 1, penanceChance: 0.4, mult: 1 }, custom: true },
  // Indoor modes: their own decks, no walking.
  { id: 'couch',    name: 'Couch',      icon: '🛋️', desc: 'No walking. Would you rather, jokes, deep questions and quick party games for the sofa.',
    filter: { deck: 'couch' }, rules: { freeVetoes: 2, penanceChance: 0.25, mult: 1 }, indoor: true },
  { id: 'cod',      name: 'CoD splitscreen', icon: '🎮', desc: 'The app picks the game, map, mode, house rule and who plays. Only games your splitscreen supports for the player count.',
    filter: { deck: 'cod' }, rules: { freeVetoes: 1, penanceChance: 0, mult: 1 }, indoor: true, generated: 'cod' },
];
export const modeById = Object.fromEntries(MODES.map((m) => [m.id, m]));

// ── Cards ───────────────────────────────────────────────────────────────────
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function normalizeCard(c, custom = false) {
  return {
    id: String(c.id),
    title: String(c.title || 'Untitled').slice(0, 80),
    text: String(c.text || '').slice(0, 600),
    diff: clamp(Number(c.diff) || 1, 1, 4),
    mins: clamp(Number(c.mins) || 5, 1, 240),
    who: WHO[c.who] ? c.who : 'solo',
    tags: (Array.isArray(c.tags) ? c.tags : []).filter((t) => TAGS[t]),
    tool: TOOLS[c.tool] ? c.tool : null,
    secs: c.tool === 'timer' ? clamp(Number(c.secs) || 60, 5, 7200) : null,
    place: c.place || null,
    needs: (Array.isArray(c.needs) ? c.needs : []).filter((n) => NEEDS[n]),
    deck: ['walk', 'couch', 'cod'].includes(c.deck) ? c.deck : 'walk',
    mix: !!c.mix,
    custom: custom || !!c.custom,
    author: c.author || null,
  };
}

/** All cards in play: defaults plus crew cards, minus anything switched off. */
export function activeCards(defaults, customList, toggles) {
  const off = new Set(Object.values(toggles || {}).filter((t) => t.off && !t.deleted).map((t) => t.id));
  return [
    ...defaults.map((c) => normalizeCard(c)),
    ...customList.filter((c) => !c.deleted).map((c) => normalizeCard(c, true)),
  ].filter((c) => !off.has(c.id));
}

/** A card's place as {name, lat, lng}, from a place id or a custom {name, lat, lng}. */
export function resolvePlace(card) {
  const p = card.place;
  if (!p) return null;
  if (typeof p === 'string') return placeById[p] || null;
  if (typeof p.lat === 'number' && typeof p.lng === 'number') return { name: p.name || 'Custom spot', lat: p.lat, lng: p.lng };
  return null;
}

export function cardPoints(card, rules = {}) {
  return Math.round(DIFF[card.diff].pts * (rules.mult || 1)) + (card.place ? PLACE_BONUS : 0);
}

/**
 * Decks: 'walk' (the city cards), 'couch' (no walking) and 'cod' (generated Call of Duty rounds).
 * Walking games may also deal couch cards marked `mix`; couch games never deal walking cards.
 */
export function inDeck(card, deck = 'walk') {
  const d = card.deck || 'walk';
  if (deck === 'walk') return d === 'walk' || (d === 'couch' && !!card.mix);
  return d === deck;
}

export function matchesFilter(card, f = {}) {
  if (!inDeck(card, f.deck)) return false;
  if (f.customOnly && !card.custom) return false;
  if (f.maxMins && card.mins > f.maxMins) return false;
  if (f.minDiff && card.diff < f.minDiff) return false;
  if (f.maxDiff && card.diff > f.maxDiff) return false;
  if (f.anyTags?.length && !card.tags.some((t) => f.anyTags.includes(t))) return false;
  if (f.noTags?.length && card.tags.some((t) => f.noTags.includes(t))) return false;
  if (f.who?.length && !f.who.includes(card.who)) return false;
  return true;
}

// ── Geography ───────────────────────────────────────────────────────────────
export function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearingDeg(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

export function compassLabel(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

export function fmtDistance(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

// ── Dealing ─────────────────────────────────────────────────────────────────
function placeOk(card, game, here) {
  if (!card.place) return true;
  const p = resolvePlace(card);
  if (!p || !here) return false;
  return distanceM(here, p) <= game.range;
}

/**
 * Cards that may still be dealt in this game (ignoring which ones were already drawn).
 * `cond` (from currentConditions) holds back cards that don't fit the season, light or weather.
 */
export function eligibleCards(cards, game, here, cond = null) {
  const done = new Set(game.log.filter((e) => e.type === 'done').map((e) => e.cardId));
  const solo = game.players.length < 2;
  return cards.filter((c) => !done.has(c.id)
    && matchesFilter(c, game.filter)
    && !(solo && (c.who === 'duo' || c.who === 'versus'))
    && fitsConditions(c, cond)
    && placeOk(c, game, here));
}

/** Location cards in range, nearest first. */
export function nearbyCards(cards, game, here, cond = null) {
  if (!here) return [];
  return eligibleCards(cards, game, here, cond)
    .filter((c) => c.place)
    .map((c) => ({ card: c, dist: distanceM(here, resolvePlace(c)) }))
    .sort((a, b) => a.dist - b.dist);
}

function pickWeighted(list, weightFn, rng) {
  const total = list.reduce((s, c) => s + weightFn(c), 0);
  let r = rng() * total;
  for (const c of list) { r -= weightFn(c); if (r <= 0) return c; }
  return list[list.length - 1];
}

/**
 * Pick the next card. Returns {card, reshuffled} or null if nothing is eligible.
 * Cards already drawn are skipped until the eligible pool runs dry, then the deck reshuffles
 * (completed cards never come back within a game).
 */
export function drawCard(cards, game, here, rng = Math.random, cond = null) {
  const elig = eligibleCards(cards, game, here, cond);
  if (!elig.length) return null;
  const used = new Set(game.used);
  let pool = elig.filter((c) => !used.has(c.id));
  let reshuffled = false;
  if (!pool.length) { pool = elig; reshuffled = true; }
  const near = pool.filter((c) => c.place);
  let card;
  if (game.rules.placeBias && near.length && rng() < game.rules.placeBias) {
    card = near[Math.floor(rng() * near.length)];
  } else {
    // Spots you can walk to are twice as likely; so are indoor cards while it rains.
    const raining = cond?.raining === true;
    // Couch cards mixed into a walking game come up half as often, so walks stay about walking.
    const walking = (game.filter?.deck || 'walk') === 'walk';
    card = pickWeighted(pool, (c) => (c.place ? 2 : 1) * (raining && c.tags.includes('indoor') ? 2 : 1) * (walking && c.deck === 'couch' ? 0.5 : 1), rng);
  }
  return { card, reshuffled };
}

export function rollPenance(rules, penances, rng = Math.random) {
  if (!rules.penanceChance || rng() >= rules.penanceChance) return null;
  return penances[Math.floor(rng() * penances.length)];
}

// ── Scores ──────────────────────────────────────────────────────────────────
export function blankStats() {
  return { score: 0, done: 0, failed: 0, rejected: 0, freeUsed: 0, paidRejects: 0, penances: 0, places: 0, bonuses: 0, turns: 0 };
}

/** Derive every player's stats from the game log, so undo is just "remove the last entry". */
export function playerStats(game) {
  const s = Object.fromEntries(game.players.map((p) => [p.id, blankStats()]));
  for (const e of game.log) {
    const t = s[e.pid];
    if (t) t.turns++;
    for (const [pid, pts] of Object.entries(e.awards || {})) if (s[pid]) s[pid].score += pts;
    if (e.type === 'done') {
      for (const pid of Object.keys(e.awards || {})) {
        if (!s[pid]) continue;
        s[pid].done++;
        if (e.place) s[pid].places++;
        if (e.bonus) s[pid].bonuses++;
      }
    } else if (e.type === 'fail' && t) {
      t.failed++;
    } else if (e.type === 'reject' && t) {
      t.rejected++;
      if (e.free) t.freeUsed++; else t.paidRejects++;
      if (e.penance) t.penances++;
    }
  }
  return s;
}

/** What rejecting this card costs the player on turn right now. */
export function rejectCost(card, rules, stats) {
  if (stats.freeUsed < (rules.freeVetoes || 0)) return { cost: 0, free: true };
  const base = Math.ceil(cardPoints(card, rules) * REJECT_SHARE);
  return { cost: base + REJECT_ESCALATION * stats.paidRejects, free: false };
}

export function costAfterPenance(cost, level) {
  return Math.ceil(cost * (PENANCE_KEEP[level] ?? 1));
}

/** Points each listed player gets for completing a card. */
export function completionPoints(card, rules, { bonus = false, checkin = false } = {}) {
  const base = cardPoints(card, rules);
  return base + (bonus ? Math.round(base * STYLE_BONUS) : 0) + (checkin ? CHECKIN_BONUS : 0);
}

// ── Confirming results (live games) ─────────────────────────────────────────
// In a live game, "Done" or "Failed" is a claim the other players confirm on their phones.
// Rejecting (a veto) never needs confirmation.
export const CONFIRM = {
  majority: { label: 'Majority', hint: 'A majority of the players decides. The claim counts as the claimer\'s yes, so with 3 players one more yes is enough.' },
  off:      { label: 'Off',      hint: 'Whoever taps Done or Failed decides, as in a local game.' },
};
export const CLAIM_TIMEOUT = 120000; // after 2 min, a claim with ≥1 yes and no "no" can be accepted as is

/** Who votes on a claim: every player with a phone, i.e. everyone except guests. */
export function claimVoters(game) {
  return game.players.filter((p) => !isGuest(p)).map((p) => p.id);
}

/** Votes needed to accept: a majority of the voters. */
export const votesNeeded = (game) => Math.floor(claimVoters(game).length / 2) + 1;

export function needsConfirmation(game) {
  return !!game.live && !!game.rules.confirm && game.rules.confirm !== 'off' && claimVoters(game).length >= 2;
}

/**
 * 'accepted' | 'disputed' | 'pending' for the claim on the current card (null without a claim).
 * Accepted once a majority said yes; disputed once a majority can no longer be reached.
 */
export function claimOutcome(game) {
  const claim = game.current?.claim;
  if (!claim) return null;
  const voters = claimVoters(game);
  if (voters.length < 2) return 'accepted';
  const yes = voters.filter((id) => claim.votes?.[id] === 'yes').length;
  const open = voters.filter((id) => !claim.votes?.[id]).length;
  const need = votesNeeded(game);
  if (yes >= need) return 'accepted';
  if (yes + open < need) return 'disputed';
  return 'pending';
}

/** Can the waiting claim be accepted as it stands (timeout with only "yes" votes so far)? */
export function claimCanBeForced(game, now = Date.now()) {
  const claim = game.current?.claim;
  if (!claim || now - claim.at < CLAIM_TIMEOUT) return false;
  const votes = Object.values(claim.votes || {});
  return votes.includes('yes') && !votes.includes('no');
}

export function currentRound(game) {
  return Math.floor(game.log.length / Math.max(1, game.players.length)) + 1;
}

export function isOver(game, now = Date.now()) {
  if (game.rules.rounds && game.log.length >= game.rules.rounds * game.players.length) return 'rounds';
  if (game.rules.minutes && now >= game.startedAt + game.rules.minutes * 60000) return 'time';
  return false;
}

// ── End of game and records ─────────────────────────────────────────────────
export function winnersOf(rows) {
  if (!rows.length) return [];
  const best = Math.max(...rows.map((r) => r.score));
  return rows.filter((r) => r.score === best).map((r) => r.id);
}

/** Funny end-of-game awards. Each goes to the player(s) with the highest non-zero count. */
export const AWARDS = [
  { key: 'done',      icon: '🎯', name: 'Closer',   desc: 'most cards completed' },
  { key: 'rejected',  icon: '🐔', name: 'Chicken',  desc: 'most cards rejected' },
  { key: 'penances',  icon: '🦾', name: 'Iron',     desc: 'most penances done' },
  { key: 'places',    icon: '🧭', name: 'Explorer', desc: 'most location cards' },
  { key: 'bonuses',   icon: '🔥', name: 'Legend',   desc: 'most style bonuses' },
];

export function awardsFor(rows) {
  const out = [];
  for (const a of AWARDS) {
    const max = Math.max(0, ...rows.map((r) => r[a.key] || 0));
    if (max > 0) out.push({ ...a, value: max, ids: rows.filter((r) => r[a.key] === max).map((r) => r.id) });
  }
  return out;
}

// ── Players: names, guests, merging ─────────────────────────────────────────
export const nameKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Guests play in one game only: never in the crew list or the all-time records. */
export const isGuest = (p) => !!p?.guest || String(p?.id || '').startsWith('guest_');

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // Two swapped letters ("Bjarek") count as one typo.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** "Raf" vs "Rafael", "Matt" vs "Mat", "Bjarke" vs "Bjarek": probably the same person. */
export function similarNames(a, b) {
  a = nameKey(a); b = nameKey(b);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (Math.min(a.length, b.length) < 3) return false;
  return editDistance(a, b) <= (Math.max(a.length, b.length) >= 7 ? 2 : 1);
}

/** Groups of crew players sharing the same name (case and spacing ignored). */
export function duplicateGroups(players) {
  const by = {};
  for (const p of players) (by[nameKey(p.name)] ??= []).push(p);
  return Object.values(by).filter((g) => g.length > 1);
}

const STAT_KEYS = ['score', 'done', 'failed', 'rejected', 'freeUsed', 'paidRejects', 'penances', 'places', 'bonuses', 'turns'];

/**
 * Rewrite a finished game so player `fromId` becomes `to` ({id, name, emoji}).
 * Returns the new game, or null if `fromId` didn't play in it.
 */
export function mergePlayerInGame(game, fromId, to) {
  if (!game.players.some((p) => p.id === fromId)) return null;
  const g = structuredClone(game);
  const from = g.players.find((p) => p.id === fromId);
  const existing = g.players.find((p) => p.id === to.id);
  if (existing) {
    // Both copies played in the same game: add the numbers together.
    for (const k of STAT_KEYS) existing[k] = (existing[k] || 0) + (from[k] || 0);
    g.players = g.players.filter((p) => p.id !== fromId);
    g.winnerIds = winnersOf(g.players);
  } else {
    Object.assign(from, { id: to.id, name: to.name, emoji: to.emoji });
    g.winnerIds = [...new Set((g.winnerIds || []).map((id) => (id === fromId ? to.id : id)))];
  }
  for (const e of g.log || []) {
    if (e.pid === fromId) e.pid = to.id;
    if (e.awards && fromId in e.awards) {
      e.awards[to.id] = (e.awards[to.id] || 0) + e.awards[fromId];
      delete e.awards[fromId];
    }
  }
  return g;
}

/** All-time leaderboard from finished games. Guests and deleted players (ids in `hidden`) are left out. */
export function leaderboard(games, players, hidden = new Set()) {
  const rows = {};
  const ensure = (p) => (rows[p.id] ??= { id: p.id, name: p.name, emoji: p.emoji, games: 0, wins: 0, points: 0, best: null, done: 0, rejected: 0, penances: 0, places: 0 });
  for (const g of games) {
    for (const p of g.players) {
      if (isGuest(p) || hidden.has(p.id)) continue;
      const r = ensure(p);
      r.games++;
      r.points += p.score;
      r.best = r.best === null ? p.score : Math.max(r.best, p.score);
      r.done += p.done || 0;
      r.rejected += p.rejected || 0;
      r.penances += p.penances || 0;
      r.places += p.places || 0;
      if ((g.winnerIds || []).includes(p.id)) r.wins++;
    }
  }
  // Prefer current names and emojis from the player list.
  for (const p of players) if (rows[p.id]) Object.assign(rows[p.id], { name: p.name, emoji: p.emoji });
  return Object.values(rows);
}

export function topScores(games, n = 10, hidden = new Set()) {
  return games
    .flatMap((g) => g.players.filter((p) => !isGuest(p) && !hidden.has(p.id)).map((p) => ({ ...p, gameId: g.id, modeName: g.modeName, endedAt: g.endedAt, nPlayers: g.players.length })))
    .sort((a, b) => b.score - a.score || a.endedAt - b.endedAt)
    .slice(0, n);
}
