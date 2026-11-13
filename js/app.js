// Copenhagen Adventure Deck: the app (screens, game flow, events).

import { DEFAULT_CARDS } from './data/cards.js';
import { PLACES } from './data/places.js';
import { PENANCES } from './data/lists.js';
import {
  DIFF, WHO, TAGS, TOOLS, MODES, modeById, PLACE_BONUS, CHECKIN_BONUS, CHECKIN_RADIUS, PENANCE_KEEP,
  activeCards, normalizeCard, resolvePlace, cardPoints, eligibleCards, nearbyCards, drawCard, rollPenance,
  playerStats, rejectCost, costAfterPenance, completionPoints, currentRound, isOver, winnersOf, awardsFor,
  leaderboard, topScores, distanceM, bearingDeg, compassLabel, fmtDistance,
  nameKey, isGuest, similarNames, duplicateGroups, mergePlayerInGame,
} from './rules.js';
import { store, uid, sync, syncConfigured, scheduleSync, photos, compressImage } from './store.js';
import { renderTool, toolOp, tickClock, fmtClock } from './tools.js';
import { live, normaliseCode } from './live.js';

import { VERSION } from './version.js';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMOJIS = ['🦊', '🐻', '🐼', '🐸', '🦁', '🐯', '🐨', '🐵', '🦄', '🐙', '🦉', '🐧', '🐳', '🦖', '🐝', '🦀', '🐢', '🦩', '🐺', '🦦', '🐲', '🦔', '🐞', '🦜'];
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

const LENGTHS = [['open', 'Open'], ['r3', '3 rounds'], ['r5', '5 rounds'], ['r6', '6 rounds'], ['r8', '8 rounds'], ['r12', '12 rounds'], ['t60', '60 min'], ['t90', '90 min'], ['t120', '2 hours']];

const ui = {
  tab: 'play',
  setup: {
    playerIds: [], guests: [], modeId: 'classic', length: 'open', useLocation: true, live: true,
    custom: { tags: {}, maxMins: 0, minDiff: 1, maxDiff: 4, freeVetoes: 1, penanceChance: 0.4, mult: 1, placeBias: 0 },
  },
  sheet: null,
  summaryId: null,
  cards: { q: '', source: 'all', tag: '' },
  records: { view: 'leaders', sort: 'points' },
  here: null,
  geo: 'off', // off | asking | on | denied | unsupported
  freeTools: {},
  freeTool: 'timer',
  lastGeoRender: 0,
  liveOk: true,   // last contact with the live game server worked
  update: { checkedAt: 0, latest: '' },
  joinCode: '',
};

// ── Card lookups ────────────────────────────────────────────────────────────
const allCards = () => activeCards(DEFAULT_CARDS, store.list('cards'), store.data.toggles);
function cardById(id) {
  const d = DEFAULT_CARDS.find((c) => c.id === id);
  if (d) return normalizeCard(d);
  const c = store.data.cards[id];
  return c && !c.deleted ? normalizeCard(c, true) : null;
}
const isOff = (id) => !!store.data.toggles[id]?.off;

// ── Small renderers ─────────────────────────────────────────────────────────
const chip = (label, on, act, data = {}) =>
  `<button class="chip ${on ? 'on' : ''}" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${label}</button>`;

function badges(c) {
  return `<span class="badge d${c.diff}">${DIFF[c.diff].label}</span>`
    + `<span class="badge">${WHO[c.who].icon} ${WHO[c.who].label}</span>`
    + `<span class="badge">⏱ ${c.mins} min</span>`
    + (c.place ? '<span class="badge place">📍 Spot</span>' : '')
    + (c.tool ? `<span class="badge">${TOOLS[c.tool].icon}</span>` : '')
    + (c.custom ? '<span class="badge crew">✍️ Crew</span>' : '');
}
const tagLine = (c) => c.tags.map((t) => `<span class="tag">${TAGS[t].icon} ${TAGS[t].label}</span>`).join('');
const pname = (p) => `${esc(p.emoji)} ${esc(p.name)}`;
const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function mapsLink(p) {
  return isIOS ? `https://maps.apple.com/?daddr=${p.lat},${p.lng}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking`;
}
function placeInfo(card) {
  const p = resolvePlace(card);
  if (!p) return '';
  const d = ui.here ? distanceM(ui.here, p) : null;
  const dirTxt = d == null ? 'GPS off' : `${fmtDistance(d)} ${compassLabel(bearingDeg(ui.here, p))}`;
  return `<span data-dist="${p.lat},${p.lng}">${dirTxt}</span>`;
}

// ── Root render ─────────────────────────────────────────────────────────────
function render() { renderView(); renderSheet(); }

function renderView() {
  const views = { play: viewPlay, cards: viewCards, records: viewRecords, tools: viewTools, settings: viewSettings };
  $('#view').innerHTML = views[ui.tab]();
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  afterRender($('#view'));
  syncLivePolling();
}

function afterRender(root) {
  // Load photos from IndexedDB into their slots.
  root.querySelectorAll('[data-photo-key]').forEach(async (el) => {
    try {
      const blob = await photos.get(el.dataset.photoKey);
      if (blob) el.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="Photo proof">`;
      else el.innerHTML = '';
    } catch { el.innerHTML = ''; }
  });
  root.querySelectorAll('[data-photo-slot]').forEach(async (el) => {
    const st = toolState(el.dataset.photoSlot, 'photo');
    if (!st.key) return;
    try {
      const blob = await photos.get(st.key);
      el.innerHTML = blob ? `<img src="${URL.createObjectURL(blob)}" alt="Photo proof">` : '';
    } catch { el.innerHTML = ''; }
  });
}

// ── PLAY ────────────────────────────────────────────────────────────────────
function viewPlay() {
  if (ui.summaryId) return viewSummary(store.data.games[ui.summaryId]);
  if (store.game) return viewGame();
  return viewSetup();
}

function setupGameDraft() {
  const s = ui.setup, mode = modeById[s.modeId];
  let filter = { ...mode.filter }, rules = { ...mode.rules };
  if (mode.custom) {
    const c = s.custom;
    filter = {
      anyTags: Object.keys(c.tags).filter((t) => c.tags[t] === 'any'),
      noTags: Object.keys(c.tags).filter((t) => c.tags[t] === 'no'),
      maxMins: c.maxMins || 0, minDiff: c.minDiff, maxDiff: c.maxDiff,
    };
    rules = { freeVetoes: c.freeVetoes, penanceChance: c.penanceChance, mult: c.mult, placeBias: c.placeBias, pickNearby: c.placeBias > 0 };
  }
  const len = s.length;
  if (len.startsWith('r')) rules.rounds = Number(len.slice(1)); else delete rules.rounds;
  if (len.startsWith('t')) rules.minutes = Number(len.slice(1)); else delete rules.minutes;
  const players = [
    ...s.playerIds.map((id) => store.get('players', id)).filter(Boolean).map(({ id, name, emoji }) => ({ id, name, emoji })),
    ...s.guests,
  ];
  return { filter, rules, players, range: store.settings.range, useLocation: s.useLocation, log: [], used: [] };
}

/** The crew player this phone belongs to (set in Settings or on the Play screen). */
const me = () => store.get('players', store.settings.meId);
const isMe = (id) => !!id && id === store.settings.meId;
const sortCrew = (list) => list.sort((a, b) => (isMe(b.id) - isMe(a.id)) || a.name.localeCompare(b.name));

function viewSetup() {
  const s = ui.setup;
  const players = sortCrew(store.list('players'));
  s.playerIds = s.playerIds.filter((id) => store.get('players', id));
  const mode = modeById[s.modeId];
  const draft = setupGameDraft();
  const pool = eligibleCards(allCards(), { ...draft, players: draft.players.length ? draft.players : [{}, {}] }, s.useLocation ? ui.here : null);
  const nearCount = pool.filter((c) => c.place).length;
  const c = s.custom;

  return `
  <header class="hero">
    <h1>Copenhagen<br>Adventure Deck</h1>
    <p class="muted">${allCards().length} cards in the deck · ${store.list('games').length} games played</p>
  </header>

  ${syncConfigured() ? `
  <section class="panel live-panel">
    <h2>📡 Join a live game</h2>
    <form class="inline-add" data-form="join-live">
      <input name="code" placeholder="CODE" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" class="code-input" value="${esc(ui.joinCode)}">
      <button class="btn primary">Join</button>
    </form>
    <p class="muted small">Someone started a game on their phone? Enter the 4-letter code shown at the top of their screen.</p>
  </section>` : ''}

  ${players.length && !me() ? `
  <section class="panel who-am-i">
    <h2>👋 Which one are you?</h2>
    <p class="muted small">Tell this phone who you are. It's then picked automatically, and you get "Your turn!" in live games. You can change it in Settings.</p>
    <div class="chips">${players.map((p) => chip(pname(p), false, 'set-me', { id: p.id })).join('')}</div>
  </section>` : ''}

  <section class="panel">
    <h2>Who's playing?</h2>
    <div class="chips">${players.map((p) => chip(pname(p) + (isMe(p.id) ? ' <small>(you)</small>' : ''), s.playerIds.includes(p.id), 'setup-player', { id: p.id })).join('')}
      ${s.guests.map((p) => `<button class="chip on guest" data-act="remove-guest" data-id="${p.id}">${pname(p)} <small>guest ✕</small></button>`).join('')}</div>
    <form class="inline-add" data-form="add-player">
      <input name="name" placeholder="Name" maxlength="24" autocomplete="off">
      <button class="btn" name="as" value="crew">＋ Crew</button>
      <button class="btn" name="as" value="guest">＋ Guest</button>
    </form>
    <p class="muted small"><b>Crew</b> players are saved and synced, and appear on the leaderboard. <b>Guests</b> play this game only.</p>
  </section>

  <section class="panel">
    <h2>Game mode</h2>
    <div class="modes">${MODES.map((m) => `
      <button class="mode ${m.id === s.modeId ? 'on' : ''}" data-act="setup-mode" data-id="${m.id}">
        <span class="mode-icon">${m.icon}</span><b>${m.name}</b><small>${m.desc}</small>
      </button>`).join('')}</div>
    ${mode.custom ? `
      <div class="custom-mode">
        <h3>Tags <small class="muted">tap: include → exclude → any</small></h3>
        <div class="chips">${Object.entries(TAGS).map(([k, t]) => {
          const v = c.tags[k];
          return `<button class="chip ${v === 'any' ? 'on' : v === 'no' ? 'off' : ''}" data-act="cm-tag" data-tag="${k}">${v === 'no' ? '🚫' : t.icon} ${t.label}</button>`;
        }).join('')}</div>
        <h3>Max length per card</h3>
        <div class="chips">${[[0, 'Any'], [5, '5 min'], [10, '10 min'], [20, '20 min'], [30, '30 min'], [60, '1 hour']].map(([v, l]) => chip(l, c.maxMins === v, 'cm-set', { key: 'maxMins', val: v })).join('')}</div>
        <h3>Difficulty</h3>
        <div class="chips">${[1, 2, 3, 4].map((d) => chip(DIFF[d].label, d >= c.minDiff && d <= c.maxDiff, 'cm-diff', { d })).join('')}</div>
        <h3>Free vetoes each</h3>
        <div class="chips">${[0, 1, 2, 3].map((v) => chip(String(v), c.freeVetoes === v, 'cm-set', { key: 'freeVetoes', val: v })).join('')}</div>
        <h3>Penance offered</h3>
        <div class="chips">${[[0, 'Never'], [0.25, '25%'], [0.5, '50%'], [1, 'Always']].map(([v, l]) => chip(l, c.penanceChance === v, 'cm-set', { key: 'penanceChance', val: v })).join('')}</div>
        <h3>Points</h3>
        <div class="chips">${[[1, '×1'], [1.5, '×1.5'], [2, '×2']].map(([v, l]) => chip(l, c.mult === v, 'cm-set', { key: 'mult', val: v })).join('')}</div>
        <h3>Location cards first</h3>
        <div class="chips">${[[0, 'No'], [0.7, 'Yes']].map(([v, l]) => chip(l, c.placeBias === v, 'cm-set', { key: 'placeBias', val: v })).join('')}</div>
      </div>` : ''}
  </section>

  <section class="panel">
    <h2>Length</h2>
    <div class="chips">${LENGTHS.map(([v, l]) => chip(l, s.length === v, 'setup-length', { v })).join('')}</div>
  </section>

  <section class="panel">
    <h2>Location cards</h2>
    <label class="switch-row"><input type="checkbox" data-act-change="setup-location" ${s.useLocation ? 'checked' : ''}> <span>Use GPS to deal cards for spots near you</span></label>
    ${s.useLocation ? `
      <label class="range-row">Range <b>${store.settings.range} m</b>
        <input type="range" min="500" max="1000" step="50" value="${store.settings.range}" data-act-change="range">
      </label>
      <p class="muted small">${geoLine()} ${ui.here ? `· ${nearCount} location card${nearCount === 1 ? '' : 's'} in range` : ''}</p>
      ${ui.geo !== 'on' ? '<button class="btn" data-act="geo-start">📍 Turn on GPS</button>' : ''}` : ''}
    ${mode.rules.needsLocation && !s.useLocation ? '<p class="warn">Explorer works best with GPS on.</p>' : ''}
  </section>

  <section class="panel">
    <h2>📡 Live on every phone</h2>
    ${syncConfigured()
      ? `<label class="switch-row"><input type="checkbox" data-act-change="setup-live" ${s.live ? 'checked' : ''}> <span>Share this game live. Friends join with a code, and anyone can draw and score.</span></label>`
      : '<p class="muted small">Set up crew sync in Settings to play one game across several phones.</p>'}
  </section>

  <div class="start-bar">
    <p class="muted small">${pool.length} card${pool.length === 1 ? '' : 's'} match this setup${draft.players.length < 2 ? ' (duo and versus cards need 2+ players)' : ''}</p>
    <button class="btn primary big" data-act="start-game" ${draft.players.length && pool.length ? '' : 'disabled'}>
      ${draft.players.length ? `Start ${mode.icon} ${mode.name}${s.live && syncConfigured() ? ' live 📡' : ''}` : 'Pick at least one player'}
    </button>
  </div>

  ${rulesBlock()}`;
}

function rulesBlock() {
  return `<details class="panel rules">
    <summary>How scoring works</summary>
    <ul>
      <li><b>Points:</b> Easy ${DIFF[1].pts} · Medium ${DIFF[2].pts} · Hard ${DIFF[3].pts} · Epic ${DIFF[4].pts}. Location cards give +${PLACE_BONUS}, and checking in by GPS at the spot (within ${CHECKIN_RADIUS} m) gives +${CHECKIN_BONUS} more.</li>
      <li><b>Who scores:</b> 👤 Solo: the player on turn. 👥 Duo: the player on turn and their partner. 🙌 Everyone: all players. ⚔️ Versus: only the winner(s).</li>
      <li><b>🔥 Legendary:</b> the group can award +25% for a performance with real style.</li>
      <li><b>Failed:</b> you tried and it didn't work out. 0 points and no penalty, because trying counts.</li>
      <li><b>Rejecting:</b> free vetoes are used first (how many depends on the mode). After that a rejection costs half the card's points, plus 5 more for every earlier paid rejection you've made this game.</li>
      <li><b>Penance:</b> sometimes (how often depends on the mode) you're offered a physical penance when you reject. A light one halves the loss and a heavy one cuts it to a quarter. You can always just take the hit.</li>
      <li><b>Undo</b> is in the ⋯ menu if someone tapped the wrong thing.</li>
    </ul>
  </details>`;
}

function geoLine() {
  return { off: 'GPS is off.', asking: 'Finding you…', on: `📍 GPS on${ui.here?.acc ? ` (±${Math.round(ui.here.acc)} m)` : ''}`, denied: '⚠️ Location permission denied. Allow it in your phone settings for this site.', unsupported: 'This browser has no GPS support.' }[ui.geo];
}

// ── In-game ────────────────────────────────────────────────────────────────
function viewGame() {
  const g = store.game;
  const stats = playerStats(g);
  const turnP = g.players[g.turn];
  const over = isOver(g);
  const cur = g.current;
  const card = cur ? cardById(cur.cardId) : null;
  const progress = g.rules.rounds ? `Round ${Math.min(currentRound(g), g.rules.rounds)}/${g.rules.rounds}`
    : g.rules.minutes ? `<span data-gametime>${fmtClock(g.startedAt + g.rules.minutes * 60000 - Date.now())}</span> left`
    : `Round ${currentRound(g)}`;

  return `
  <div class="game-top">
    <span>${g.modeIcon} <b>${esc(g.modeName)}</b> · ${progress}</span>
    <span>${g.live ? `<button class="live-pill ${ui.liveOk ? '' : 'bad'}" data-act="live-info">📡 ${esc(g.live.code)}</button>` : ''}${g.useLocation ? `<button class="gps-pill ${ui.geo}" data-act="geo-start">📍</button>` : ''}<button class="icon-btn" data-act="game-menu" aria-label="Game menu">⋯</button></span>
  </div>
  <div class="scores">${g.players.map((p, i) => `
    <div class="score ${i === g.turn ? 'turn' : ''} ${isMe(p.id) ? 'me' : ''}"><span class="em">${esc(p.emoji)}</span><span class="nm">${esc(p.name)}${isGuest(p) ? ' <small>guest</small>' : ''}</span><b>${stats[p.id].score}</b></div>`).join('')}
  </div>
  ${me() && !g.players.some((p) => isMe(p.id)) ? `<div class="banner soft">You're not in this game. <button class="btn small" data-act="join-as-me">＋ Join as ${pname(me())}</button></div>` : ''}
  ${over ? `<div class="banner">${over === 'time' ? "⏰ Time's up!" : '🏁 Last round played!'} <button class="btn primary" data-act="end-game">See the podium</button></div>` : ''}
  ${card ? viewCurrentCard(g, card, stats, turnP) : viewDrawArea(g, turnP)}`;
}

function viewDrawArea(g, turnP) {
  const here = g.useLocation ? ui.here : null;
  const near = g.useLocation ? nearbyCards(allCards(), g, here) : [];
  return `
  <div class="draw-area">
    <p class="turn-label ${isMe(turnP.id) ? 'mine' : ''}">${isMe(turnP.id) ? `🎯 Your turn, ${esc(turnP.name)}!` : `${pname(turnP)}'s turn`}</p>
    <button class="deck-btn" data-act="draw"><span>🃏</span>Draw a card</button>
    <button class="btn ghost" data-act="skip-turn">Skip to next player</button>
  </div>
  ${g.useLocation ? `
  <section class="panel">
    <h2>📍 Spots in range <small class="muted">${g.range} m</small></h2>
    ${!here ? `<p class="muted small">${geoLine()}</p>` : near.length ? `<ul class="near-list">${near.slice(0, 8).map(({ card: c, dist }) => `
      <li><div><b>${esc(c.title)}</b><small>${esc(resolvePlace(c).name)} · ${fmtDistance(dist)} ${compassLabel(bearingDeg(here, resolvePlace(c)))} · +${cardPoints(c, g.rules)}</small></div>
      ${g.rules.pickNearby ? `<button class="btn small" data-act="take-card" data-id="${c.id}">Take</button>` : ''}</li>`).join('')}</ul>
      ${g.rules.pickNearby ? '' : '<p class="muted small">These can come up when you draw. In Explorer mode you can pick one directly.</p>'}`
    : `<p class="muted small">No unplayed spots within ${g.range} m. Walk towards the centre, or raise the range in Settings.</p>`}
  </section>` : ''}`;
}

function viewCurrentCard(g, card, stats, turnP) {
  const cur = g.current;
  const pts = completionPoints(card, g.rules, { bonus: cur.bonus, checkin: cur.checkin });
  const rc = rejectCost(card, g.rules, stats[turnP.id]);
  const place = resolvePlace(card);
  const dist = place && ui.here ? distanceM(ui.here, place) : null;
  const canCheckin = dist != null && dist <= CHECKIN_RADIUS;
  const others = g.players.filter((p) => p.id !== turnP.id);

  const needsPick = (card.who === 'duo' && !cur.partners.length) || (card.who === 'versus' && !cur.winners.length);
  let pickers = '';
  if (card.who === 'duo') pickers = `<div class="picker ${needsPick ? 'needed' : ''}"><p class="pick-label">👥 Who was your partner?</p><div class="chips">${others.map((p) => chip(pname(p), cur.partners.includes(p.id), 'pick-partner', { id: p.id })).join('')}</div></div>`;
  if (card.who === 'versus') pickers = `<div class="picker ${needsPick ? 'needed' : ''}"><p class="pick-label">⚔️ Who won? <small class="muted">Tap one or more</small></p><div class="chips">${g.players.map((p) => chip(pname(p), cur.winners.includes(p.id), 'pick-winner', { id: p.id })).join('')}</div></div>`;
  if (card.who === 'group') pickers = '<p class="pick-label">🙌 Everyone scores</p>';

  return `
  <p class="turn-label ${isMe(turnP.id) ? 'mine' : ''}">${isMe(turnP.id) ? '🎯 Your card!' : `${pname(turnP)}'s card`}</p>
  <article class="card d${card.diff}">
    <div class="card-band"><span>${DIFF[card.diff].label}</span><span>+${cardPoints(card, g.rules)}</span></div>
    <h2>${esc(card.title)}</h2>
    <p class="card-text">${esc(card.text)}</p>
    <div class="badges">${badges(card)}</div>
    <div class="tags">${tagLine(card)}</div>
    ${place ? `
      <div class="place-box">
        <div><b>📍 ${esc(place.name)}</b><br><small>${placeInfo(card)}</small></div>
        <div class="row">
          <a class="btn small" href="${mapsLink(place)}" target="_blank" rel="noopener">Directions</a>
          ${cur.checkin ? '<span class="badge ok">✓ Checked in</span>' : `<button class="btn small" data-act="checkin" ${canCheckin ? '' : 'disabled'}>Check in +${CHECKIN_BONUS}</button>`}
        </div>
      </div>` : ''}
  </article>
  ${card.tool ? renderTool(card.tool, toolState('game', card.tool), { scope: 'game', card, players: g.players }) : ''}
  <button class="btn ghost small" data-act="open-tools">🧰 Other tools</button>

  <section class="panel resolve">
    ${pickers}
    <label class="switch-row"><input type="checkbox" data-act-change="bonus" ${cur.bonus ? 'checked' : ''}> <span>🔥 Legendary (+25%)</span></label>
    <div class="resolve-btns">
      <button class="btn ok big ${needsPick ? 'waiting' : ''}" data-act="resolve-done">✅ Done <small>${needsPick ? (card.who === 'duo' ? 'pick a partner first' : 'pick the winner first') : `+${pts}`}</small></button>
      <button class="btn" data-act="resolve-fail">😅 Failed <small>0</small></button>
      <button class="btn bad" data-act="open-reject">🙅 Reject <small>${rc.free ? 'free veto' : `−${rc.cost}`}</small></button>
    </div>
  </section>`;
}

function viewSummary(game) {
  if (!game) { ui.summaryId = null; return viewSetup(); }
  const rows = [...game.players].sort((a, b) => b.score - a.score);
  const awards = awardsFor(game.players);
  const byId = Object.fromEntries(game.players.map((p) => [p.id, p]));
  const podium = rows.slice(0, 3);
  return `
  <header class="hero"><h1>🏆 ${game.winnerIds.map((id) => esc(byId[id]?.name)).join(' & ')} win${game.winnerIds.length > 1 ? '' : 's'}!</h1>
  <p class="muted">${game.modeIcon || ''} ${esc(game.modeName)} · ${game.log.length} cards · ${Math.round((game.endedAt - game.startedAt) / 60000)} min</p></header>
  <div class="podium">${podium.map((p, i) => `<div class="pod p${i + 1}"><span class="em">${esc(p.emoji)}</span><b>${esc(p.name)}</b><span>${p.score}</span><div class="step">${['🥇', '🥈', '🥉'][i]}</div></div>`).join('')}</div>
  <section class="panel">
    <table class="tbl"><tr><th></th><th>Pts</th><th>✅</th><th>🙅</th><th>🦾</th></tr>
    ${rows.map((p) => `<tr><td>${pname(p)}</td><td><b>${p.score}</b></td><td>${p.done}</td><td>${p.rejected}</td><td>${p.penances}</td></tr>`).join('')}</table>
  </section>
  ${awards.length ? `<section class="panel"><h2>Awards</h2><ul class="awards">${awards.map((a) => `<li><span class="em">${a.icon}</span><div><b>${a.name}</b>: ${a.ids.map((id) => esc(byId[id]?.name)).join(', ')}<small>${a.desc} (${a.value})</small></div></li>`).join('')}</ul></section>` : ''}
  <div class="row center">
    <button class="btn primary big" data-act="summary-close">New game</button>
    <button class="btn" data-act="open-game" data-id="${game.id}">Game log</button>
  </div>`;
}

// ── CARDS ───────────────────────────────────────────────────────────────────
function filteredCardList() {
  const f = ui.cards;
  const q = f.q.trim().toLowerCase();
  const list = [
    ...DEFAULT_CARDS.map((c) => normalizeCard(c)),
    ...store.list('cards').map((c) => normalizeCard(c, true)),
  ];
  return list.filter((c) => {
    if (f.source === 'default' && c.custom) return false;
    if (f.source === 'crew' && !c.custom) return false;
    if (f.source === 'off' && !isOff(c.id)) return false;
    if (f.tag === 'place' && !c.place) return false;
    if (f.tag && f.tag !== 'place' && !c.tags.includes(f.tag)) return false;
    if (q && !(c.title + ' ' + c.text).toLowerCase().includes(q)) return false;
    return true;
  });
}

function cardListHTML() {
  const list = filteredCardList();
  if (!list.length) return '<p class="muted center">No cards match.</p>';
  return `<p class="muted small">${list.length} card${list.length === 1 ? '' : 's'}</p>` + list.map((c) => {
    const off = isOff(c.id);
    const p = resolvePlace(c);
    return `<article class="card-item ${off ? 'is-off' : ''}">
      <div class="ci-head"><b>${esc(c.title)}</b><span class="pts">+${cardPoints(c)}</span></div>
      <p>${esc(c.text)}</p>
      <div class="badges">${badges(c)}${p ? `<span class="badge">${esc(p.name)}</span>` : ''}</div>
      <div class="tags">${tagLine(c)}</div>
      <div class="row">
        <button class="btn small" data-act="toggle-card" data-id="${c.id}">${off ? '▶️ Switch on' : '⏸ Switch off'}</button>
        ${c.custom ? `<button class="btn small" data-act="edit-card" data-id="${c.id}">✏️ Edit</button><button class="btn small bad" data-act="delete-card" data-id="${c.id}">🗑</button>`
          : `<button class="btn small" data-act="copy-card" data-id="${c.id}">📝 Copy & edit</button>`}
      </div>
    </article>`;
  }).join('');
}

function viewCards() {
  const f = ui.cards;
  const crew = store.list('cards').length;
  const off = Object.values(store.data.toggles).filter((t) => t.off).length;
  return `
  <header class="page-head"><h1>Cards</h1><button class="btn primary" data-act="new-card">＋ New card</button></header>
  <p class="muted small">${DEFAULT_CARDS.length} default · ${crew} made by your crew · ${off} switched off. Switched-off cards are never dealt.</p>
  <input class="search" type="search" placeholder="Search cards" value="${esc(f.q)}" data-act-input="card-search">
  <div class="chips">${[['all', 'All'], ['crew', '✍️ Crew'], ['default', 'Default'], ['off', '⏸ Off']].map(([v, l]) => chip(l, f.source === v, 'card-source', { v })).join('')}</div>
  <div class="chips scroll">${chip('All tags', !f.tag, 'card-tag', { v: '' })}${chip('📍 Spots', f.tag === 'place', 'card-tag', { v: 'place' })}${Object.entries(TAGS).map(([k, t]) => chip(`${t.icon} ${t.label}`, f.tag === k, 'card-tag', { v: k })).join('')}</div>
  <div id="card-list">${cardListHTML()}</div>`;
}

function cardEditor(draft) {
  const players = store.list('players');
  const placeVal = !draft.place ? '' : typeof draft.place === 'string' ? draft.place : 'custom';
  const cp = typeof draft.place === 'object' && draft.place ? draft.place : null;
  return `
  <h2>${draft.id && store.data.cards[draft.id] ? 'Edit card' : 'New card'}</h2>
  <form data-form="card" class="editor">
    <label>Title<input name="title" maxlength="60" required value="${esc(draft.title)}" placeholder="e.g. Harbour Haiku"></label>
    <label>Challenge<textarea name="text" maxlength="400" rows="4" required placeholder="What do you have to do? How do you win?">${esc(draft.text)}</textarea></label>
    <fieldset><legend>Difficulty</legend><div class="seg">${[1, 2, 3, 4].map((d) => `<label><input type="radio" name="diff" value="${d}" ${draft.diff === d ? 'checked' : ''}><span>${DIFF[d].label}<small>${DIFF[d].pts}</small></span></label>`).join('')}</div></fieldset>
    <fieldset><legend>Who does it</legend><div class="seg">${Object.entries(WHO).map(([k, w]) => `<label><input type="radio" name="who" value="${k}" ${draft.who === k ? 'checked' : ''}><span>${w.icon} ${w.label}</span></label>`).join('')}</div></fieldset>
    <label>Roughly how many minutes<input name="mins" type="number" min="1" max="240" inputmode="numeric" value="${draft.mins}"></label>
    <fieldset><legend>Tags</legend><div class="seg wrap">${Object.entries(TAGS).map(([k, t]) => `<label><input type="checkbox" name="tags" value="${k}" ${draft.tags.includes(k) ? 'checked' : ''}><span>${t.icon} ${t.label}</span></label>`).join('')}</div></fieldset>
    <label>Built-in tool<select name="tool"><option value="">None</option>${Object.entries(TOOLS).map(([k, t]) => `<option value="${k}" ${draft.tool === k ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}</select></label>
    <label>Timer seconds (if the tool is Timer)<input name="secs" type="number" min="5" max="7200" inputmode="numeric" value="${draft.secs || 60}"></label>
    <label>Location<select name="place">
      <option value="">Anywhere</option>
      <option value="custom" ${placeVal === 'custom' ? 'selected' : ''}>📍 My current spot${cp ? ` (${esc(cp.name)})` : ''}</option>
      ${PLACES.map((p) => `<option value="${p.id}" ${placeVal === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    </select></label>
    <label>Spot name (for "My current spot")<input name="spotName" maxlength="40" value="${esc(cp?.name || '')}" placeholder="e.g. Our favourite bench"></label>
    <p class="muted small">Location cards are only dealt within range of the spot, and are worth +${PLACE_BONUS}. A "current spot" saves your GPS position with the card.</p>
    <label>Made by<select name="author"><option value="">Nobody in particular</option>${players.map((p) => `<option value="${p.id}" ${draft.author === p.id ? 'selected' : ''}>${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}</select></label>
    <input type="hidden" name="id" value="${esc(draft.id || '')}">
    <div class="row"><button class="btn primary big" type="submit">Save card</button><button class="btn" type="button" data-act="close-sheet">Cancel</button></div>
  </form>`;
}

// ── RECORDS ─────────────────────────────────────────────────────────────────
const SORTS = {
  points:   { label: 'Points',    val: (r) => r.points },
  wins:     { label: 'Wins',      val: (r) => r.wins },
  best:     { label: 'Best game', val: (r) => r.best ?? 0 },
  avg:      { label: 'Avg/game',  val: (r) => (r.games ? Math.round(r.points / r.games) : 0) },
  done:     { label: '✅ Done',   val: (r) => r.done },
  places:   { label: '🧭 Spots',  val: (r) => r.places },
  rejected: { label: '🐔 Chicken', val: (r) => r.rejected },
  penances: { label: '🦾 Iron',   val: (r) => r.penances },
};

function viewRecords() {
  const v = ui.records.view;
  const games = store.list('games').sort((a, b) => b.endedAt - a.endedAt);
  const tabs = [['leaders', 'Leaderboard'], ['high', 'Highscores'], ['history', 'History'], ['players', 'Players']];
  let body = '';
  if (v === 'leaders') {
    const sort = SORTS[ui.records.sort];
    const rows = leaderboard(games, store.list('players'), deletedIds()).sort((a, b) => sort.val(b) - sort.val(a));
    body = `<div class="chips scroll">${Object.entries(SORTS).map(([k, s]) => chip(s.label, ui.records.sort === k, 'rec-sort', { v: k })).join('')}</div>
      ${rows.length ? `<ol class="board">${rows.map((r) => `<li class="${isMe(r.id) ? 'me' : ''}"><span class="em">${esc(r.emoji)}</span><div><b>${esc(r.name)}${isMe(r.id) ? ' <small class="you">you</small>' : ''}</b><small>${r.games} game${r.games === 1 ? '' : 's'} · ${r.wins} win${r.wins === 1 ? '' : 's'} · best ${r.best ?? 0}</small></div><span class="val">${sort.val(r)}</span></li>`).join('')}</ol>`
        : '<p class="muted center">No finished games yet. Go play!</p>'}`;
  } else if (v === 'high') {
    const top = topScores(games, 15, deletedIds());
    body = top.length ? `<ol class="board">${top.map((r) => `<li class="${isMe(r.id) ? 'me' : ''}"><span class="em">${esc(r.emoji)}</span><div><b>${esc(r.name)}</b><small>${esc(r.modeName)} · ${r.nPlayers} players · ${fmtDate(r.endedAt)}</small></div><span class="val">${r.score}</span></li>`).join('')}</ol>`
      : '<p class="muted center">No scores yet.</p>';
  } else if (v === 'history') {
    body = games.length ? `<ul class="history">${games.map((g) => {
      const byId = Object.fromEntries(g.players.map((p) => [p.id, p]));
      return `<li><button data-act="open-game" data-id="${g.id}"><div><b>${g.modeIcon || ''} ${esc(g.modeName)}</b><small>${fmtDate(g.endedAt)} · ${g.players.length} players · ${g.log.length} cards</small></div><span>🏆 ${g.winnerIds.map((id) => esc(byId[id]?.emoji)).join('')}</span></button></li>`;
    }).join('')}</ul>` : '<p class="muted center">No games yet.</p>';
  } else {
    const ps = sortCrew(store.list('players'));
    const counts = gamesPerPlayer();
    const dups = duplicateGroups(ps);
    body = `${dups.map((grp) => `<div class="banner soft">⚠️ ${grp.length} players called "${esc(grp[0].name)}". Open the one you don't want and use <b>Merge into…</b></div>`).join('')}
      <ul class="players">${ps.map((p) => `<li class="${isMe(p.id) ? 'me' : ''}"><span class="em">${esc(p.emoji)}</span><b>${esc(p.name)}${isMe(p.id) ? ' <small class="you">you</small>' : ''}<small class="muted"> ${counts[p.id] || 0} game${counts[p.id] === 1 ? '' : 's'}</small></b><button class="btn small" data-act="edit-player" data-id="${p.id}">Edit</button></li>`).join('')}</ul>
      <form class="inline-add" data-form="add-player"><input name="name" placeholder="New crew player" maxlength="24" autocomplete="off"><button class="btn" name="as" value="crew">＋ Crew</button></form>
      <p class="muted small">Guests (added on the Play screen) aren't listed here and don't count on the leaderboard.</p>
      ${deletedWithGames().length ? `
      <h3>Deleted players</h3>
      <p class="muted small">Hidden from the leaderboard and highscores. Their games stay in History. Restore them, or merge their points into someone who is still in the crew.</p>
      <ul class="players deleted">${deletedWithGames().map((p) => `<li>
        <span class="em">${esc(p.emoji)}</span><b>${esc(p.name)}<small class="muted"> ${p.games} game${p.games === 1 ? '' : 's'}</small></b>
        <div class="row">
          <button class="btn small" data-act="restore-player" data-id="${p.id}">↩️ Restore</button>
          ${ps.length ? `<select id="merge-deleted-${p.id}">${ps.map((o) => `<option value="${o.id}">${esc(o.emoji)} ${esc(o.name)}${similarNames(o.name, p.name) ? ' (same name?)' : ''}</option>`).join('')}</select>
          <button class="btn small" data-act="merge-deleted" data-id="${p.id}">Merge</button>` : ''}
        </div>
      </li>`).join('')}</ul>` : ''}`;
  }
  return `<header class="page-head"><h1>Records</h1>${syncConfigured() ? '<button class="btn small" data-act="sync-now">⟳ Sync</button>' : ''}</header>
    <div class="seg-tabs">${tabs.map(([k, l]) => `<button class="${v === k ? 'on' : ''}" data-act="rec-view" data-v="${k}">${l}</button>`).join('')}</div>
    ${body}`;
}

function gameDetail(game) {
  const rows = [...game.players].sort((a, b) => b.score - a.score);
  const byId = Object.fromEntries(game.players.map((p) => [p.id, p]));
  const icon = { done: '✅', fail: '😅', reject: '🙅' };
  return `<h2>${game.modeIcon || ''} ${esc(game.modeName)}</h2>
    <p class="muted small">${new Date(game.startedAt).toLocaleString()} · ${Math.round((game.endedAt - game.startedAt) / 60000)} min</p>
    <table class="tbl">${rows.map((p) => `<tr><td>${game.winnerIds.includes(p.id) ? '🏆 ' : ''}${pname(p)}${isGuest(p) ? ' <small class="muted">guest</small>' : ''}</td><td><b>${p.score}</b></td></tr>`).join('')}</table>
    <h3>Cards</h3>
    <ol class="log">${game.log.map((e) => `<li>
      <div>${icon[e.type]} <b>${esc(e.title)}</b> <small>${esc(byId[e.pid]?.name || '')}</small></div>
      <small>${Object.entries(e.awards || {}).map(([pid, pts]) => `${esc(byId[pid]?.name || '?')} ${pts > 0 ? '+' : ''}${pts}`).join(', ') || '0 points'}${e.free ? ' · free veto' : ''}${e.penance ? ` · penance: ${esc(e.penance.text)}` : ''}${e.bonus ? ' · 🔥' : ''}${e.checkin ? ' · 📍 checked in' : ''}</small>
      ${e.photo ? `<div class="log-photo" data-photo-key="${esc(e.photo)}"></div>` : ''}
    </li>`).join('')}</ol>
    <div class="row"><button class="btn" data-act="close-sheet">Close</button><button class="btn bad small" data-act="delete-game" data-id="${game.id}">Delete game</button></div>`;
}

// ── TOOLS ───────────────────────────────────────────────────────────────────
function viewTools() {
  const t = ui.freeTool;
  return `<header class="page-head"><h1>Tools</h1></header>
    <div class="tool-grid">${Object.entries(TOOLS).map(([k, x]) => `<button class="${t === k ? 'on' : ''}" data-act="free-tool" data-v="${k}"><span>${x.icon}</span>${x.label}</button>`).join('')}</div>
    ${renderTool(t, toolState('free', t), { scope: 'free', players: store.game?.players || [] })}`;
}

// ── SETTINGS ────────────────────────────────────────────────────────────────
function viewSettings() {
  const s = store.settings;
  const crew = sortCrew(store.list('players'));
  return `<header class="page-head"><h1>Settings</h1></header>
  <section class="panel">
    <h2>⭐ You on this phone</h2>
    ${crew.length ? `<select class="search" data-act-change="set-me-select">
      <option value="">Not set</option>
      ${crew.map((p) => `<option value="${p.id}" ${isMe(p.id) ? 'selected' : ''}>${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}
    </select>
    <p class="muted small">Picked automatically for new games. You also get "Your turn!" in live games and are highlighted in the records. Only this phone knows, and it isn't synced.</p>`
    : '<p class="muted small">Add yourself as a crew player on the Play screen first.</p>'}
  </section>
  <section class="panel">
    <h2>Crew sync</h2>
    <p class="muted small">Share players, crew cards, switched-off cards and finished games between your phones, through your own Cloudflare Worker (see the README). Without it, everything stays on this phone.</p>
    <form data-form="sync" class="editor">
      <label>Server URL<input name="apiUrl" type="url" inputmode="url" placeholder="https://adventure-deck.yourname.workers.dev" value="${esc(s.apiUrl)}" autocomplete="off"></label>
      <label>Crew key<input name="crewKey" type="password" placeholder="The shared secret for your crew" value="${esc(s.crewKey)}" autocomplete="off"></label>
      <div class="row"><button class="btn primary">Save & sync</button>${syncConfigured() ? '<button class="btn" type="button" data-act="sync-now">Sync now</button>' : ''}</div>
    </form>
    <p class="small ${s.syncError ? 'warn' : 'muted'}">${!syncConfigured() ? 'Not set up.' : s.syncError ? `⚠️ ${esc(s.syncError)}` : s.lastSync ? `✓ Last synced ${new Date(s.lastSync).toLocaleString()}` : 'Not synced yet.'}</p>
  </section>
  <section class="panel">
    <h2>Location</h2>
    <label class="range-row">Range for location cards <b>${s.range} m</b>
      <input type="range" min="500" max="1000" step="50" value="${s.range}" data-act-change="range"></label>
    <p class="muted small">${geoLine()}</p>
    <button class="btn" data-act="geo-start">📍 Test GPS</button>
  </section>
  <section class="panel">
    <h2>Backup</h2>
    <p class="muted small">Save players, crew cards and game history to a file, or load one. Loading merges: nothing is overwritten with older data.</p>
    <div class="row"><button class="btn" data-act="export">⬇️ Export</button>
    <label class="btn file-btn">⬆️ Import<input type="file" accept="application/json,.json" data-act-change="import" hidden></label></div>
  </section>
  <section class="panel">
    <h2>Install</h2>
    <p class="small">${isIOS ? 'In Safari: tap <b>Share</b> → <b>Add to Home Screen</b>. Then always open the deck from the home-screen icon. It keeps its own storage, separate from Safari tabs.' : 'Use your browser menu → <b>Install app</b> or <b>Add to Home screen</b>.'}</p>
  </section>
  <section class="panel">
    <h2>App version</h2>
    <p>This phone runs <b>${VERSION}</b>${ui.update.latest && ui.update.latest !== VERSION ? `, and <b>${esc(ui.update.latest)}</b> is available` : ui.update.checkedAt ? ', the latest' : ''}.</p>
    <button class="btn" data-act="check-update">🔄 Check for updates</button>
    <p class="muted small">The app checks by itself every time it's opened, and updates straight away unless a game is running.</p>
  </section>
  ${rulesBlock()}
  <section class="panel">
    <h2>Danger zone</h2>
    <button class="btn bad" data-act="reset-all">Delete all data on this phone</button>
  </section>`;
}

// ── Sheets (modals) ─────────────────────────────────────────────────────────
function renderSheet() {
  const el = $('#sheet');
  const s = ui.sheet;
  if (!s) { el.innerHTML = ''; el.className = ''; return; }
  let body = '';
  if (s.type === 'reject') body = sheetReject();
  if (s.type === 'card') body = cardEditor(s.draft);
  if (s.type === 'game') body = store.data.games[s.id] ? gameDetail(store.data.games[s.id]) : '<p>Game not found.</p>';
  if (s.type === 'player') body = sheetPlayer(store.get('players', s.id));
  if (s.type === 'menu') body = sheetMenu();
  if (s.type === 'live') body = sheetLive();
  if (s.type === 'tools') body = `<h2>Tools</h2><div class="tool-grid">${Object.entries(TOOLS).map(([k, x]) => `<button class="${ui.freeTool === k ? 'on' : ''}" data-act="free-tool" data-v="${k}"><span>${x.icon}</span>${x.label}</button>`).join('')}</div>
    ${renderTool(ui.freeTool, toolState('free', ui.freeTool), { scope: 'free', players: store.game?.players || [] })}<div class="row"><button class="btn" data-act="close-sheet">Close</button></div>`;
  el.className = 'open';
  el.innerHTML = `<div class="backdrop" data-act="close-sheet"></div><div class="sheet" role="dialog">${body}</div>`;
  afterRender(el);
}

function sheetReject() {
  const g = store.game, cur = g.current, card = cardById(cur.cardId);
  const p = g.players[g.turn];
  const st = playerStats(g)[p.id];
  const rc = rejectCost(card, g.rules, st);
  const freeLeft = (g.rules.freeVetoes || 0) - st.freeUsed;
  if (rc.free) {
    return `<h2>Reject "${esc(card.title)}"?</h2>
      <p>${pname(p)} has <b>${freeLeft}</b> free veto${freeLeft === 1 ? '' : 'es'} left. This one costs nothing.</p>
      <div class="col"><button class="btn primary big" data-act="reject" data-how="free">Use a free veto</button><button class="btn" data-act="close-sheet">Never mind, we'll do it</button></div>`;
  }
  const pen = cur.penance;
  const after = pen ? costAfterPenance(rc.cost, pen.level) : null;
  return `<h2>Reject "${esc(card.title)}"?</h2>
    <p>No free vetoes left. Rejecting costs ${pname(p)} <b>−${rc.cost}</b> points${st.paidRejects ? ` (half the card's value, +${st.paidRejects * 5} for earlier rejections)` : " (half the card's value)"}.</p>
    ${pen ? `<div class="penance"><p class="pen-head">💪 Penance offered: ${pen.level === 2 ? 'HEAVY' : 'light'}</p><p class="pen-text">${esc(pen.text)}</p>
      <p class="small">Do it now and lose only <b>−${after}</b> (${pen.level === 2 ? 'a quarter' : 'half'} of the cost).</p>
      <button class="btn ok big" data-act="reject" data-how="penance">Penance done: −${after}</button></div>`
    : `<p class="muted small">No penance on offer this time (${Math.round((g.rules.penanceChance || 0) * 100)}% chance in this mode).</p>`}
    <div class="col"><button class="btn bad" data-act="reject" data-how="hit">Take the hit: −${rc.cost}</button><button class="btn" data-act="close-sheet">Never mind, we'll do it</button></div>`;
}

function sheetMenu() {
  const g = store.game;
  return `<h2>Game menu</h2>
    <div class="col">
      <button class="btn" data-act="undo" ${g.log.length || g.current ? '' : 'disabled'}>↩️ Undo last action</button>
      <button class="btn primary" data-act="end-game">🏁 End game & save</button>
      <div class="row"><button class="btn" data-act="add-to-game" data-as="crew">＋ Crew player</button><button class="btn" data-act="add-to-game" data-as="guest">＋ Guest</button></div>
      ${g.live ? '<button class="btn" data-act="live-info">📡 Show join code</button><button class="btn" data-act="leave-live">🚪 Stop following on this phone</button>'
        : syncConfigured() ? '<button class="btn" data-act="go-live">📡 Share this game live</button>' : ''}
      <button class="btn bad" data-act="abandon-game">🗑 Abandon without saving${g.live ? ' (for everyone)' : ''}</button>
      <button class="btn" data-act="close-sheet">Close</button>
    </div>
    <p class="muted small">Penance chance: ${Math.round((g.rules.penanceChance || 0) * 100)}% · Free vetoes: ${g.rules.freeVetoes || 0} each · Points ×${g.rules.mult || 1}</p>`;
}

function sheetLive() {
  const g = store.game;
  if (!g?.live) return '<p>This game is not live.</p><div class="row"><button class="btn" data-act="close-sheet">Close</button></div>';
  return `<h2>📡 Live game</h2>
    <div class="join-code">${esc(g.live.code)}</div>
    <p class="center">Friends open the deck → <b>Play</b> → <b>Join a live game</b> → enter this code.</p>
    <p class="muted small center">${ui.liveOk ? '✓ Connected. Every phone sees the same card and scores, and anyone can draw and score.' : '⚠️ No connection right now. Moves made here will fail until it comes back.'}</p>
    <div class="col"><button class="btn" data-act="close-sheet">Close</button></div>`;
}

/** Players deleted from the crew list (tombstones). They're hidden from the leaderboards. */
const deletedIds = () => new Set(Object.values(store.data.players).filter((p) => p.deleted).map((p) => p.id));

/** Deleted players that still have games, with their name and emoji from their latest game. */
function deletedWithGames() {
  const gone = deletedIds();
  const found = {};
  for (const g of store.list('games').sort((a, b) => a.endedAt - b.endedAt)) {
    for (const p of g.players) {
      if (!gone.has(p.id)) continue;
      found[p.id] = { id: p.id, name: p.name, emoji: p.emoji, games: (found[p.id]?.games || 0) + 1 };
    }
  }
  return Object.values(found).sort((a, b) => a.name.localeCompare(b.name));
}

function gamesPerPlayer() {
  const n = {};
  for (const g of store.list('games')) for (const p of g.players) n[p.id] = (n[p.id] || 0) + 1;
  return n;
}

function sheetPlayer(p) {
  if (!p) return '<p>Player not found.</p>';
  const others = sortCrew(store.list('players').filter((x) => x.id !== p.id));
  const nGames = gamesPerPlayer()[p.id] || 0;
  // Suggest the most likely duplicate first.
  others.sort((a, b) => similarNames(b.name, p.name) - similarNames(a.name, p.name));
  return `<h2>${esc(p.emoji)} ${esc(p.name)}</h2>
    <p class="muted small">${nGames} game${nGames === 1 ? '' : 's'} in the records</p>
    ${isMe(p.id) ? '<p class="badge ok">⭐ This is you on this phone</p>' : `<button class="btn" data-act="set-me" data-id="${p.id}">⭐ This is me (on this phone)</button>`}
    <form data-form="player" class="editor" style="margin-top:12px">
      <input type="hidden" name="id" value="${p.id}">
      <label>Name<input name="name" maxlength="24" required value="${esc(p.name)}"></label>
      <fieldset><legend>Emoji</legend><div class="seg wrap emoji-pick">${EMOJIS.map((e) => `<label><input type="radio" name="emoji" value="${e}" ${p.emoji === e ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div></fieldset>
      <div class="row"><button class="btn primary">Save</button><button class="btn" type="button" data-act="close-sheet">Cancel</button></div>
    </form>
    ${others.length ? `
    <h3>Merge into another player</h3>
    <p class="muted small">Same person twice? Move all of ${esc(p.name)}'s games and points to the other player, then remove ${esc(p.name)}. Applies on every phone.</p>
    <div class="inline-add">
      <select id="merge-target">${others.map((o) => `<option value="${o.id}">${esc(o.emoji)} ${esc(o.name)}${similarNames(o.name, p.name) ? ' (same name?)' : ''}</option>`).join('')}</select>
      <button class="btn" data-act="merge-player" data-id="${p.id}">Merge</button>
    </div>` : ''}
    <h3>Delete</h3>
    <div class="row"><button class="btn bad small" data-act="delete-player" data-id="${p.id}">Delete ${esc(p.name)}</button></div>
    <p class="muted small">${nGames ? 'They disappear from the leaderboard; their games stay in History and they can be restored later. To combine them with someone else, use Merge instead.' : 'They have no games yet, so nothing else changes.'}</p>`;
}

// ── Tool state ──────────────────────────────────────────────────────────────
function toolState(scope, tool) {
  if (scope === 'game' && store.game?.current) return (store.game.current.tools[tool] ??= {});
  return (ui.freeTools[tool] ??= {});
}

// ── Actions ─────────────────────────────────────────────────────────────────
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = ''), 2600);
}
const saveGame = () => store.saveGame();
const closeSheet = () => { ui.sheet = null; renderSheet(); };

function freeEmoji(taken = []) {
  const used = new Set([...store.list('players').map((p) => p.emoji), ...taken]);
  return EMOJIS.find((e) => !used.has(e)) || EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

/**
 * Add a crew player without creating duplicates. Pulls the latest crew list first (so a name
 * added on another phone is seen), reuses an exact match, and asks about similar names.
 * Returns the player to use, or null if cancelled.
 */
async function addCrewPlayer(name) {
  name = name.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!name) return null;
  if (syncConfigured()) {
    try { await Promise.race([sync(), new Promise((r) => setTimeout(r, 4000))]); } catch { /* offline: check what we have */ }
  }
  const crew = store.list('players');
  const exact = crew.find((p) => nameKey(p.name) === nameKey(name));
  if (exact) { toast(`${exact.emoji} ${exact.name} already exists, so I picked them`); return exact; }
  const near = crew.find((p) => similarNames(p.name, name));
  if (near && confirm(`Did you mean ${near.emoji} ${near.name}?\n\nOK = use ${near.name}\nCancel = create a new player "${name}"`)) return near;
  return store.put('players', { id: uid('p_'), name, emoji: freeEmoji() });
}

function makeGuest(name, takenEmojis = []) {
  name = name.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!name) return null;
  return { id: uid('guest_'), name, emoji: freeEmoji(takenEmojis), guest: true };
}

/** Rewrite every finished game so `fromId` becomes `toId`, then remove `fromId`. Syncs to all phones. */
function mergePlayers(fromId, toId) {
  const to = store.get('players', toId);
  if (!to) return 0;
  let n = 0;
  for (const g of store.list('games')) {
    const updated = mergePlayerInGame(g, fromId, { id: to.id, name: to.name, emoji: to.emoji });
    if (updated) { store.put('games', updated); n++; }
  }
  store.remove('players', fromId);
  if (store.settings.meId === fromId) { store.settings.meId = toId; store.saveSettings(); }
  ui.setup.playerIds = [...new Set(ui.setup.playerIds.map((id) => (id === fromId ? toId : id)))];
  return n;
}

// ── Changing the game (on this phone, or live for everyone) ─────────────────
let busy = false;

/**
 * Every change to the game goes through here. `fn` edits the game it is given and may return
 * false to cancel. Local game: applied and saved. Live game: applied to a copy that is sent to
 * the server together with the version it was based on. If another phone changed the game in
 * the meantime, the server refuses, and this phone adopts the newer state instead, so nothing
 * is ever counted twice. Returns true if the change went through.
 */
async function mutate(fn) {
  const g = store.game;
  if (!g) return false;
  if (!g.live) {
    if ((await fn(g)) === false) return false;
    saveGame();
    return true;
  }
  if (busy) return false; // ignore double taps while a move is on its way
  busy = true;
  document.body.classList.add('busy');
  try {
    const draft = structuredClone(g);
    if ((await fn(draft)) === false) return false;
    const r = await live.put(g.live.code, g.live.version, draft);
    draft.live = { ...g.live, version: r.version };
    store.game = draft;
    saveGame();
    setLiveOk(true);
    return true;
  } catch (e) {
    if (e.status === 409 && e.body?.state) { applyRemote(e.body, { quiet: true }); toast('🔄 Someone else was quicker. Updated'); }
    else if (e.status === 404) { dropGame('This live game no longer exists'); }
    else { setLiveOk(false); toast(`⚠️ ${e.message}. Try again`); }
    return false;
  } finally {
    busy = false;
    document.body.classList.remove('busy');
  }
}

async function addToGame(p) {
  if (store.game.players.some((x) => x.id === p.id)) { toast(`${p.name} is already playing`); return; }
  const entry = { id: p.id, name: p.name, emoji: p.emoji, ...(p.guest ? { guest: true } : {}) };
  const ok = await mutate((g) => { if (g.players.some((x) => x.id === p.id)) return false; g.players.push(entry); });
  ui.sheet = null;
  if (ok) toast(`${p.emoji} ${p.name} joined${p.guest ? ' as a guest' : ''}`);
  render();
}

function dropGame(msg) {
  store.game = null; saveGame(); ui.sheet = null;
  if (msg) toast(msg);
  render();
}

function applyDeal(g, card, reshuffled = false) {
  if (reshuffled) {
    const done = new Set(g.log.filter((e) => e.type === 'done').map((e) => e.cardId));
    g.used = g.used.filter((id) => done.has(id));
  }
  g.used.push(card.id);
  g.current = { cardId: card.id, penance: rollPenance(g.rules, PENANCES), partners: [], winners: [], bonus: false, checkin: false, tools: {} };
}

async function startGame() {
  const s = ui.setup, mode = modeById[s.modeId];
  const draft = setupGameDraft();
  if (!draft.players.length) return;
  store.game = {
    id: uid('g_'), startedAt: Date.now(), modeId: mode.id, modeName: mode.name, modeIcon: mode.icon,
    ...draft, turn: Math.floor(Math.random() * draft.players.length), current: null,
  };
  saveGame();
  if (s.useLocation) startGeo();
  const first = draft.players[store.game.turn].name;
  if (s.live && syncConfigured()) {
    const code = await goLive();
    if (code) { ui.sheet = { type: 'live' }; toast(`📡 Live as ${code}. ${first} starts!`); }
  } else {
    toast(`${first} starts!`);
  }
  render();
}

/** Put the current game on the server and get a join code. */
async function goLive() {
  const g = store.game;
  try {
    const r = await live.create(g);
    g.live = { code: r.code, version: r.version };
    saveGame();
    setLiveOk(true);
    return r.code;
  } catch (e) {
    toast(`⚠️ Could not go live (${e.message}). Playing on this phone only`);
    return null;
  }
}

async function joinLive(raw) {
  const code = normaliseCode(raw);
  ui.joinCode = code;
  if (code.length !== 4) { toast('A game code has 4 letters'); return; }
  try {
    const r = await live.get(code);
    if (r.state.ended?.record) { finishFromRemote(r.state.ended.record); return; }
    if (r.state.abandoned) { toast('That game was abandoned'); return; }
    store.game = { ...r.state, live: { code, version: r.version } };
    saveGame();
    ui.joinCode = ''; ui.summaryId = null; ui.tab = 'play';
    setLiveOk(true);
    if (store.game.useLocation) startGeo();
    toast(`📡 Joined ${code}`);
    render();
  } catch (e) {
    toast(`⚠️ ${e.message}`);
  }
}

function describeEntry(e, g) {
  const name = g.players.find((p) => p.id === e.pid)?.name || '?';
  if (e.type === 'done') return `✅ ${e.title}: ${Object.entries(e.awards).map(([id, pts]) => `${g.players.find((p) => p.id === id)?.name} +${pts}`).join(', ')}`;
  if (e.type === 'reject') return `🙅 ${name} rejected ${e.title}${e.cost ? ` (−${e.cost})` : ''}`;
  return `😅 ${name} gave ${e.title} a go`;
}

/** Another phone changed the live game: take over its state. */
function applyRemote({ version, state }, { quiet = false } = {}) {
  const prev = store.game;
  if (!prev?.live) return;
  if (state.ended?.record) { finishFromRemote(state.ended.record); return; }
  if (state.abandoned) { dropGame('The game was abandoned on another phone'); return; }
  const g = { ...state, live: { code: prev.live.code, version } };
  if (!quiet && g.log.length > prev.log.length) toast(describeEntry(g.log[g.log.length - 1], g));
  const myTurnNow = isMe(g.players[g.turn]?.id) && !isMe(prev.players[prev.turn]?.id);
  if (myTurnNow) {
    setTimeout(() => toast('🎯 Your turn!'), quiet ? 0 : 1800);
    try { navigator.vibrate?.([120, 60, 120]); } catch {}
  }
  store.game = g;
  saveGame();
  if (ui.sheet && ['reject', 'menu'].includes(ui.sheet.type)) ui.sheet = null; // those were about the old state
  if (ui.tab === 'play') render();
}

function finishFromRemote(record) {
  store.merge({ games: [record] });
  store.game = null; saveGame();
  ui.sheet = null; ui.summaryId = record.id; ui.tab = 'play';
  toast('🏁 Game over!');
  render();
}

// Poll the live game every 2.5 s while it is open and visible.
let pollTimer = null, polling = false;
function syncLivePolling() {
  const on = !!store.game?.live;
  if (on && !pollTimer) pollTimer = setInterval(pollLive, 2500);
  if (!on && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
async function pollLive() {
  const g = store.game;
  if (!g?.live || busy || polling || document.hidden) return;
  polling = true;
  try {
    const r = await live.get(g.live.code, g.live.version);
    setLiveOk(true);
    const now = store.game;
    if (r && !busy && now?.live?.code === g.live.code && r.version > now.live.version) applyRemote(r);
  } catch (e) {
    if (e.status === 404) dropGame('The live game is gone');
    else setLiveOk(false);
  } finally {
    polling = false;
  }
}
function setLiveOk(ok) {
  if (ui.liveOk === ok) return;
  ui.liveOk = ok;
  document.querySelector('.live-pill')?.classList.toggle('bad', !ok);
}

async function resolve(type, how) {
  const cardId = store.game?.current?.cardId;
  if (!cardId) return;
  let msg = '';
  const ok = await mutate((g) => {
    const cur = g.current;
    if (!cur || cur.cardId !== cardId) return false; // already resolved on another phone
    const card = cardById(cur.cardId);
    const p = g.players[g.turn];
    const entry = { ts: Date.now(), cardId: card.id, title: card.title, pid: p.id, type, awards: {}, place: !!card.place, offered: cur.penance || null, photo: cur.tools.photo?.key || null };
    if (type === 'done') {
      const ids = card.who === 'solo' ? [p.id] : card.who === 'duo' ? [p.id, ...cur.partners] : card.who === 'group' ? g.players.map((x) => x.id) : cur.winners;
      if (!ids.length || (card.who === 'duo' && ids.length < 2)) return false; // nobody picked: nothing to score
      const pts = completionPoints(card, g.rules, { bonus: cur.bonus, checkin: cur.checkin });
      for (const id of ids) entry.awards[id] = pts;
      Object.assign(entry, { bonus: cur.bonus, checkin: cur.checkin });
      msg = `✅ +${pts} for ${ids.map((id) => g.players.find((x) => x.id === id)?.name).join(' & ')}`;
    } else if (type === 'reject') {
      const rc = rejectCost(card, g.rules, playerStats(g)[p.id]);
      let cost = rc.cost;
      if (how === 'penance' && cur.penance && !rc.free) { cost = costAfterPenance(cost, cur.penance.level); entry.penance = cur.penance; }
      Object.assign(entry, { free: rc.free, cost });
      if (cost) entry.awards[p.id] = -cost;
      msg = rc.free ? '🙅 Free veto used' : `🙅 −${cost} for ${p.name}`;
    } else {
      msg = '😅 Good try. No points, no penalty';
    }
    g.log.push(entry);
    g.current = null;
    g.turn = (g.turn + 1) % g.players.length;
  });
  if (ok) { toast(msg); ui.sheet = null; }
  render();
  if (ok) window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function undo() {
  const ok = await mutate((g) => {
    if (g.current) {
      // Put the drawn card back.
      g.used = g.used.filter((id) => id !== g.current.cardId);
      g.current = null;
    } else {
      const e = g.log.pop();
      if (!e) return false;
      g.turn = Math.max(0, g.players.findIndex((p) => p.id === e.pid));
      g.current = { cardId: e.cardId, penance: e.offered || null, partners: [], winners: [], bonus: !!e.bonus, checkin: !!e.checkin, tools: e.photo ? { photo: { key: e.photo } } : {} };
    }
  });
  ui.sheet = null;
  if (ok) toast('↩️ Undone');
  render();
}

async function endGame() {
  const g = store.game;
  if (!g.log.length) {
    if (!confirm('No cards were played. End without saving?')) return;
    if (g.live && !(await mutate((d) => { d.abandoned = true; }))) return;
    dropGame();
    return;
  }
  const stats = playerStats(g);
  const rows = g.players.map((p) => ({ ...p, ...stats[p.id] }));
  const record = {
    id: g.id, startedAt: g.startedAt, endedAt: Date.now(), modeId: g.modeId, modeName: g.modeName, modeIcon: g.modeIcon,
    players: rows, winnerIds: winnersOf(rows), log: g.log, updatedAt: Date.now(),
  };
  // Live: tell the other phones the game is over (they show the same podium).
  if (g.live && !(await mutate((d) => { d.ended = { record }; }))) return;
  store.merge({ games: [record] });
  scheduleSync(500);
  store.game = null; saveGame();
  ui.sheet = null; ui.summaryId = record.id; ui.tab = 'play';
  render();
  window.scrollTo({ top: 0 });
}

async function saveCardForm(form) {
  const fd = new FormData(form);
  const placeSel = fd.get('place');
  let place = placeSel || null;
  if (placeSel === 'custom') {
    const prev = ui.sheet.draft.place;
    if (ui.here) place = { name: (fd.get('spotName') || 'Custom spot').trim().slice(0, 40), lat: +ui.here.lat.toFixed(5), lng: +ui.here.lng.toFixed(5) };
    else if (prev && typeof prev === 'object') place = { ...prev, name: (fd.get('spotName') || prev.name).trim().slice(0, 40) };
    else { startGeo(); toast('📍 Waiting for GPS. Try saving again in a moment'); return; }
  }
  const tool = fd.get('tool') || null;
  const card = normalizeCard({
    id: fd.get('id') || uid('c_'), title: fd.get('title').trim(), text: fd.get('text').trim(),
    diff: Number(fd.get('diff')), mins: Number(fd.get('mins')), who: fd.get('who'), tags: fd.getAll('tags'),
    tool, secs: Number(fd.get('secs')), place, author: fd.get('author') || null,
  }, true);
  if (!card.title || !card.text) { toast('A card needs a title and a challenge'); return; }
  store.put('cards', card);
  ui.sheet = null;
  ui.cards.source = 'crew';
  toast('💾 Card saved');
  render();
}

// ── Geolocation ─────────────────────────────────────────────────────────────
let geoWatch = null;
function startGeo() {
  if (!('geolocation' in navigator)) { ui.geo = 'unsupported'; renderView(); return; }
  if (geoWatch != null) return;
  ui.geo = 'asking';
  geoWatch = navigator.geolocation.watchPosition((pos) => {
    const first = !ui.here;
    const prev = ui.here;
    ui.here = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    ui.geo = 'on';
    // Distances update in place; full re-render at most every 10 s (or right away on the first fix or a 40 m move).
    updateDistances();
    const moved = prev ? distanceM(prev, ui.here) : Infinity;
    if ((first || moved > 40 || Date.now() - ui.lastGeoRender > 10000) && !ui.sheet && !document.activeElement?.matches('input,textarea,select')) {
      ui.lastGeoRender = Date.now();
      renderView();
    }
  }, (err) => {
    ui.geo = err.code === 1 ? 'denied' : 'off';
    navigator.geolocation.clearWatch(geoWatch); geoWatch = null;
    if (err.code !== 1) toast('📍 Could not get your location');
    renderView();
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  renderView();
}
function updateDistances() {
  if (!ui.here) return;
  document.querySelectorAll('[data-dist]').forEach((el) => {
    const [lat, lng] = el.dataset.dist.split(',').map(Number);
    el.textContent = `${fmtDistance(distanceM(ui.here, { lat, lng }))} ${compassLabel(bearingDeg(ui.here, { lat, lng }))}`;
  });
}

// ── Event wiring ────────────────────────────────────────────────────────────
const actions = {
  'close-sheet': closeSheet,
  'setup-player': ({ id }) => {
    const s = ui.setup;
    s.playerIds = s.playerIds.includes(id) ? s.playerIds.filter((x) => x !== id) : [...s.playerIds, id];
    renderView();
  },
  'setup-mode': ({ id }) => {
    ui.setup.modeId = id;
    ui.setup.length = modeById[id].rules.rounds ? `r${modeById[id].rules.rounds}` : 'open';
    if (modeById[id].rules.needsLocation) { ui.setup.useLocation = true; startGeo(); }
    renderView();
  },
  'setup-length': ({ v }) => { ui.setup.length = v; renderView(); },
  'cm-tag': ({ tag }) => {
    const t = ui.setup.custom.tags;
    t[tag] = !t[tag] ? 'any' : t[tag] === 'any' ? 'no' : undefined;
    if (!t[tag]) delete t[tag];
    renderView();
  },
  'cm-set': ({ key, val }) => { ui.setup.custom[key] = Number(val); renderView(); },
  'cm-diff': ({ d }) => {
    const c = ui.setup.custom; d = Number(d);
    if (d < c.minDiff) c.minDiff = d; else if (d > c.maxDiff) c.maxDiff = d;
    else if (d === c.minDiff && d < c.maxDiff) c.minDiff = d + 1;
    else if (d === c.maxDiff && d > c.minDiff) c.maxDiff = d - 1;
    else { c.minDiff = d; c.maxDiff = d; }
    renderView();
  },
  'geo-start': () => {
    if (geoWatch != null) { toast(geoLine()); return; }
    startGeo();
  },
  'start-game': startGame,
  'draw': async () => {
    let none = false, reshuffled = false;
    await mutate((g) => {
      if (g.current) return false; // someone already drew
      const res = drawCard(allCards(), g, g.useLocation ? ui.here : null);
      if (!res) { none = true; return false; }
      applyDeal(g, res.card, res.reshuffled);
      reshuffled = res.reshuffled;
    });
    if (none) toast('No cards left for this mode. End the game or change the deck');
    if (reshuffled) toast('🔄 Deck reshuffled');
    renderView();
  },
  'take-card': async ({ id }) => {
    const c = cardById(id);
    if (!c) return;
    const ok = await mutate((g) => { if (g.current) return false; applyDeal(g, c); });
    renderView();
    if (ok) window.scrollTo({ top: 0 });
  },
  'skip-turn': async () => { await mutate((g) => { if (g.current) return false; g.turn = (g.turn + 1) % g.players.length; }); renderView(); },
  'pick-partner': async ({ id }) => {
    await mutate((g) => { const c = g.current; if (!c) return false; c.partners = c.partners.includes(id) ? c.partners.filter((x) => x !== id) : [...c.partners, id]; });
    renderView();
  },
  'pick-winner': async ({ id }) => {
    await mutate((g) => { const c = g.current; if (!c) return false; c.winners = c.winners.includes(id) ? c.winners.filter((x) => x !== id) : [...c.winners, id]; });
    renderView();
  },
  'checkin': async () => {
    const card = cardById(store.game.current.cardId), p = resolvePlace(card);
    if (!ui.here || !p) return toast('📍 No GPS fix yet');
    const d = distanceM(ui.here, p);
    if (d > CHECKIN_RADIUS) return toast(`Still ${fmtDistance(d)} away. Get within ${CHECKIN_RADIUS} m`);
    const ok = await mutate((g) => { if (g.current?.cardId !== card.id) return false; g.current.checkin = true; });
    if (ok) toast(`📍 Checked in! +${CHECKIN_BONUS}`);
    renderView();
  },
  'resolve-done': () => {
    const cur = store.game?.current, card = cur && cardById(cur.cardId);
    const missing = card && ((card.who === 'versus' && !cur.winners.length) || (card.who === 'duo' && !cur.partners.length));
    if (missing) {
      // Don't silently ignore the tap: say what's needed and point at it.
      toast(card.who === 'versus' ? '⚔️ Tap who won first' : '👥 Tap your partner first');
      const picker = $('.picker');
      if (picker) {
        picker.scrollIntoView({ behavior: 'smooth', block: 'center' });
        picker.classList.remove('nudge'); void picker.offsetWidth; picker.classList.add('nudge');
      }
      return;
    }
    resolve('done');
  },
  'resolve-fail': () => resolve('fail'),
  'open-reject': () => { ui.sheet = { type: 'reject' }; renderSheet(); },
  'reject': ({ how }) => resolve('reject', how),
  'game-menu': () => { ui.sheet = { type: 'menu' }; renderSheet(); },
  'undo': undo,
  'end-game': endGame,
  'abandon-game': async () => {
    const g = store.game;
    if (!confirm(g.live ? 'Abandon this game for everyone? Nothing will be saved.' : 'Abandon this game? Nothing will be saved.')) return;
    if (g.live && !(await mutate((d) => { d.abandoned = true; }))) return;
    dropGame();
  },
  'add-to-game': async ({ as }) => {
    const name = prompt(as === 'guest' ? 'Name of the guest (this game only):' : 'Name of the crew player joining:');
    if (!name) return;
    const p = as === 'guest' ? makeGuest(name, store.game.players.map((x) => x.emoji)) : await addCrewPlayer(name);
    if (!p) return;
    await addToGame(p);
  },
  'join-as-me': () => { const m = me(); if (m) addToGame(m); },
  'set-me': ({ id }) => {
    const p = store.get('players', id);
    if (!p) return;
    store.settings.meId = id; store.saveSettings();
    if (!store.game && !ui.setup.playerIds.includes(id)) ui.setup.playerIds.push(id);
    toast(`⭐ Hi ${p.name}! This phone knows it's you`);
    if (ui.sheet?.type === 'player') ui.sheet = null;
    render();
  },
  'remove-guest': ({ id }) => { ui.setup.guests = ui.setup.guests.filter((g) => g.id !== id); renderView(); },
  'restore-player': ({ id }) => {
    const p = deletedWithGames().find((x) => x.id === id);
    if (!p) return;
    store.put('players', { id: p.id, name: p.name, emoji: p.emoji }); // newer than the deletion, so it wins on every phone
    toast(`↩️ ${p.emoji} ${p.name} is back, with their records`);
    renderView();
  },
  'merge-deleted': ({ id }) => {
    const from = deletedWithGames().find((x) => x.id === id);
    const to = store.get('players', $(`#merge-deleted-${id}`)?.value);
    if (!from || !to) return;
    if (!confirm(`Move all of ${from.name}'s games and points to ${to.emoji} ${to.name}?\n\nApplies on every phone and can't be undone.`)) return;
    const n = mergePlayers(id, to.id);
    toast(`🔗 Merged: ${n} game${n === 1 ? '' : 's'} moved to ${to.name}`);
    renderView();
  },
  'merge-player': ({ id }) => {
    const from = store.get('players', id);
    const toId = $('#merge-target')?.value;
    const to = store.get('players', toId);
    if (!from || !to) return;
    if (store.game?.players.some((p) => p.id === id)) return toast(`${from.name} is in the game that's running. End it first`);
    if (!confirm(`Merge ${from.emoji} ${from.name} into ${to.emoji} ${to.name}?\n\nAll of ${from.name}'s games and points move to ${to.name}, and ${from.name} is removed. This applies on every phone and can't be undone.`)) return;
    const n = mergePlayers(id, toId);
    ui.sheet = null;
    toast(`🔗 Merged: ${n} game${n === 1 ? '' : 's'} moved to ${to.name}`);
    render();
  },
  'live-info': () => { ui.sheet = { type: 'live' }; renderSheet(); },
  'check-update': () => checkForUpdate({ manual: true }),
  'apply-update': () => applyUpdate(),
  'go-live': async () => {
    const code = await goLive();
    ui.sheet = code ? { type: 'live' } : null;
    render();
  },
  'leave-live': () => {
    if (!confirm('Stop following this game on this phone? It carries on for the others.')) return;
    dropGame('You left the live game');
  },
  'summary-close': () => { ui.summaryId = null; renderView(); },
  'open-game': ({ id }) => { ui.sheet = { type: 'game', id }; renderSheet(); },
  'delete-game': ({ id }) => {
    if (!confirm('Delete this game from the records for everyone in the crew?')) return;
    store.remove('games', id); ui.sheet = null; if (ui.summaryId === id) ui.summaryId = null; render();
  },
  'open-tools': () => { ui.sheet = { type: 'tools' }; renderSheet(); },
  'free-tool': ({ v }) => { ui.freeTool = v; if (ui.sheet?.type === 'tools') renderSheet(); else renderView(); },
  'tool': async ({ scope, tool, op }) => {
    const players = store.game?.players || [];
    if (scope === 'game') {
      // Tools on the current card are part of the game, so a live timer or bingo card is shared.
      const cardId = store.game?.current?.cardId;
      await mutate(async (g) => {
        if (!g.current || g.current.cardId !== cardId) return false;
        await toolOp(tool, (g.current.tools[tool] ??= {}), op, { scope, card: cardById(cardId), players });
      });
      renderView();
      return;
    }
    await toolOp(tool, toolState(scope, tool), op, { scope, card: null, players });
    if (ui.sheet?.type === 'tools') renderSheet(); else renderView();
  },
  // Cards
  'card-source': ({ v }) => { ui.cards.source = v; renderView(); },
  'card-tag': ({ v }) => { ui.cards.tag = v; renderView(); },
  'toggle-card': ({ id }) => {
    const t = store.data.toggles[id];
    store.put('toggles', { id, off: !(t && t.off && !t.deleted) });
    $('#card-list').innerHTML = cardListHTML();
  },
  'new-card': () => { ui.sheet = { type: 'card', draft: { title: '', text: '', diff: 1, mins: 10, who: 'solo', tags: [], tool: null, secs: 60, place: null, author: null } }; renderSheet(); },
  'edit-card': ({ id }) => { const c = store.get('cards', id); if (c) { ui.sheet = { type: 'card', draft: normalizeCard(c, true) }; renderSheet(); } },
  'copy-card': ({ id }) => {
    const c = cardById(id);
    ui.sheet = { type: 'card', draft: { ...c, id: '', title: c.title + ' (crew)' } };
    renderSheet();
  },
  'delete-card': ({ id }) => {
    if (!confirm('Delete this card for the whole crew?')) return;
    store.remove('cards', id); renderView();
  },
  // Records
  'rec-view': ({ v }) => { ui.records.view = v; renderView(); },
  'rec-sort': ({ v }) => { ui.records.sort = v; renderView(); },
  'edit-player': ({ id }) => { ui.sheet = { type: 'player', id }; renderSheet(); },
  'delete-player': ({ id }) => {
    const p = store.get('players', id);
    const n = gamesPerPlayer()[id] || 0;
    const msg = n
      ? `${p?.name} has ${n} game${n === 1 ? '' : 's'} in the records.\n\nIf they're a duplicate of someone, Cancel and use "Merge into" instead.\n\nDelete anyway? They disappear from the leaderboard; their games stay in History, and you can restore them later.`
      : `Delete ${p?.name} for everyone in the crew?`;
    if (!confirm(msg)) return;
    store.remove('players', id);
    if (store.settings.meId === id) { store.settings.meId = ''; store.saveSettings(); }
    ui.setup.playerIds = ui.setup.playerIds.filter((x) => x !== id); ui.sheet = null; render();
  },
  // Settings
  'sync-now': async () => {
    toast('⟳ Syncing…');
    try { const r = await sync(); toast(r.changed ? `✓ Synced, ${r.changed} update${r.changed === 1 ? '' : 's'}` : '✓ Up to date'); } catch (e) { toast('⚠️ ' + store.settings.syncError); }
    renderView();
  },
  'export': () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `adventure-deck-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  'reset-all': () => {
    if (!confirm('Delete ALL players, cards, games and settings on this phone? (The sync server keeps its copy.)')) return;
    if (!confirm('Really? This cannot be undone.')) return;
    store.resetAll(); ui.summaryId = null; render(); toast('Everything on this phone was deleted');
  },
};

const changeActions = {
  'setup-location': (el) => { ui.setup.useLocation = el.checked; if (el.checked) startGeo(); renderView(); },
  'setup-live': (el) => { ui.setup.live = el.checked; renderView(); },
  'set-me-select': (el) => {
    if (el.value) return actions['set-me']({ id: el.value });
    store.settings.meId = ''; store.saveSettings(); toast('This phone no longer knows who you are'); renderView();
  },
  'range': async (el) => {
    store.settings.range = Number(el.value); store.saveSettings();
    if (store.game) await mutate((g) => { g.range = store.settings.range; });
    renderView();
  },
  'bonus': async (el) => {
    const checked = el.checked;
    await mutate((g) => { if (!g.current) return false; g.current.bonus = checked; });
    renderView();
  },
  'photo': async (el) => {
    const file = el.files?.[0];
    if (!file) return;
    const scope = el.dataset.scope;
    try {
      const blob = await compressImage(file);
      const key = uid('ph_');
      await photos.put(key, blob); // the photo itself stays on this phone
      if (scope === 'game') {
        const cardId = store.game?.current?.cardId;
        await mutate((g) => { if (g.current?.cardId !== cardId) return false; g.current.tools.photo = { key }; });
      } else {
        toolState(scope, 'photo').key = key;
      }
      toast('📷 Photo saved');
    } catch (e) { toast('⚠️ ' + e.message); }
    if (ui.sheet?.type === 'tools') renderSheet(); else renderView();
  },
  'import': async (el) => {
    const file = el.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'adventure-deck') throw new Error('Not an Adventure Deck backup');
      const n = store.merge(data);
      toast(`⬆️ Imported, ${n} item${n === 1 ? '' : 's'} updated`);
      if (n) store.emit();
      renderView();
    } catch (e) { toast('⚠️ ' + e.message); }
  },
};

const formActions = {
  'add-player': async (form, submitter) => {
    const name = form.name.value;
    if (!name.trim()) return;
    if (submitter?.value === 'guest') {
      const g = makeGuest(name, ui.setup.guests.map((x) => x.emoji));
      if (ui.setup.guests.some((x) => nameKey(x.name) === nameKey(g.name))) { toast(`${g.name} is already a guest`); return; }
      ui.setup.guests.push(g);
      toast(`${g.emoji} ${g.name} plays as a guest`);
    } else {
      const p = await addCrewPlayer(name);
      if (!p) return;
      if (ui.tab === 'play' && !ui.setup.playerIds.includes(p.id)) ui.setup.playerIds.push(p.id);
    }
    renderView();
    $('[data-form="add-player"] input')?.focus();
  },
  'card': saveCardForm,
  'join-live': (form) => joinLive(form.code.value),
  'player': (form) => {
    const fd = new FormData(form);
    const p = store.get('players', fd.get('id'));
    const name = fd.get('name').trim().slice(0, 24);
    if (!p || !name) return;
    store.put('players', { ...p, name, emoji: fd.get('emoji') || p.emoji });
    ui.sheet = null; render();
  },
  'sync': async (form) => {
    const url = form.apiUrl.value.trim().replace(/\/+$/, '');
    if (url && !/^https:\/\//.test(url)) { toast('The server URL must start with https://'); return; }
    if (url !== store.settings.apiUrl) store.settings.lastPush = 0; // new server: push everything
    Object.assign(store.settings, { apiUrl: url, crewKey: form.crewKey.value.trim(), syncError: '' });
    store.saveSettings();
    if (syncConfigured()) await actions['sync-now'](); else { toast('Sync switched off'); renderView(); }
  },
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tabs button');
  if (tab) { ui.tab = tab.dataset.tab; ui.sheet = null; render(); window.scrollTo({ top: 0 }); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn({ ...el.dataset }, el); }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-act-change]');
  if (el) changeActions[el.dataset.actChange]?.(el);
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-act-input]');
  if (el?.dataset.actInput === 'card-search') { ui.cards.q = el.value; $('#card-list').innerHTML = cardListHTML(); }
});
document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  formActions[form.dataset.form]?.(form, e.submitter);
});

// Clocks: timers, stopwatches and the game countdown.
setInterval(() => {
  let finished = false;
  document.querySelectorAll('[data-clock]').forEach((el) => {
    const tool = el.dataset.clock, scope = el.dataset.scope;
    if (tickClock(el, toolState(scope, tool))) { finished = true; if (scope === 'game') saveGame(); }
  });
  if (finished) toast('⏰ Time!');
  const gt = $('[data-gametime]');
  if (gt && store.game?.rules.minutes) gt.textContent = fmtClock(Math.max(0, store.game.startedAt + store.game.rules.minutes * 60000 - Date.now()));
}, 250);

// Sync when the app opens or comes back to the foreground.
let lastAutoSync = 0;
function autoSync() {
  if (!syncConfigured() || Date.now() - lastAutoSync < 60000) return;
  lastAutoSync = Date.now();
  sync().catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  autoSync();
  pollLive(); // catch up on a live game straight away after the phone was locked
  checkForUpdate(); // iPhones resume home-screen apps without reloading them
});

// ── Updates ─────────────────────────────────────────────────────────────────
// Ask the server which version is current (bypassing every cache). If it's newer than the
// one running: update right away when nothing is going on, otherwise show a banner.
async function checkForUpdate({ manual = false } = {}) {
  if (!manual && Date.now() - ui.update.checkedAt < 60000) return;
  ui.update.checkedAt = Date.now();
  try {
    const res = await fetch(`./js/version.js?check=${Date.now()}`, { cache: 'no-store' });
    const latest = (await res.text()).match(/VERSION\s*=\s*'([^']+)'/)?.[1];
    if (!latest) throw new Error('no version found');
    ui.update.latest = latest;
    if (latest === VERSION) {
      if (manual) toast(`✓ You have the latest version (${VERSION})`);
      showUpdateBanner(false);
    } else if (manual || (!store.game && !ui.sheet && !justTriedUpdating(latest) && !document.activeElement?.matches('input,textarea,select'))) {
      applyUpdate();
      return;
    } else {
      showUpdateBanner(true);
    }
  } catch {
    if (manual) toast('⚠️ Could not reach the server to check');
  }
  if (ui.tab === 'settings') renderView();
}

// Every file of the app (keep in step with SHELL in sw.js).
const APP_FILES = ['./', './index.html', './manifest.webmanifest', './css/app.css', './js/app.js', './js/version.js',
  './js/rules.js', './js/store.js', './js/tools.js', './js/live.js', './js/data/cards.js', './js/data/places.js', './js/data/lists.js'];

/** Did we already try to update to this version a moment ago? Then don't reload again (no loops). */
function justTriedUpdating(latest) {
  try {
    const t = JSON.parse(sessionStorage.getItem('cad.updateTry') || 'null');
    return t && t.v === latest && Date.now() - t.at < 120000;
  } catch { return false; }
}

async function applyUpdate() {
  toast('✨ Updating…');
  try { sessionStorage.setItem('cad.updateTry', JSON.stringify({ v: ui.update.latest, at: Date.now() })); } catch {}
  try {
    // 1. Drop the saved offline copy. 2. Fetch every file fresh, which also refreshes the
    // browser's own cache. Games, players and settings live in localStorage and IndexedDB,
    // which this doesn't touch.
    for (const k of await caches.keys()) await caches.delete(k);
    await Promise.all(APP_FILES.map((u) => fetch(u, { cache: 'reload' }).catch(() => null)));
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {}
  location.reload();
}

function showUpdateBanner(show) {
  let el = $('#update-banner');
  if (!show) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.id = 'update-banner';
  el.innerHTML = `✨ Version ${esc(ui.update.latest)} is ready <button class="btn small primary" data-act="apply-update">Update now</button>`;
  document.body.prepend(el);
}
store.onChange(() => renderView());

// ── Boot ────────────────────────────────────────────────────────────────────
if (store.game?.useLocation) startGeo();
if (!store.game && store.list('players').length) {
  // Preselect the players from the most recent game.
  const last = store.list('games').sort((a, b) => b.endedAt - a.endedAt)[0];
  if (last) ui.setup.playerIds = last.players.map((p) => p.id).filter((id) => store.get('players', id));
}
// You are always picked on your own phone.
if (me() && !ui.setup.playerIds.includes(store.settings.meId)) ui.setup.playerIds.unshift(store.settings.meId);
render();
autoSync();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
checkForUpdate();

// For tests and debugging in the console.
window.__deck = { store, ui, render };
