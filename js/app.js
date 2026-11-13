// Copenhagen Adventure Deck: the app (screens, game flow, events).

import { DEFAULT_CARDS } from './data/cards.js';
import { PLACES } from './data/places.js';
import { PENANCES } from './data/lists.js';
import {
  DIFF, WHO, TAGS, TOOLS, MODES, modeById, PLACE_BONUS, CHECKIN_BONUS, CHECKIN_RADIUS, PENANCE_KEEP,
  activeCards, normalizeCard, resolvePlace, cardPoints, eligibleCards, nearbyCards, drawCard, rollPenance,
  playerStats, rejectCost, costAfterPenance, completionPoints, currentRound, isOver, winnersOf, awardsFor,
  leaderboard, topScores, distanceM, bearingDeg, compassLabel, fmtDistance,
} from './rules.js';
import { store, uid, sync, syncConfigured, photos, compressImage } from './store.js';
import { renderTool, toolOp, tickClock, fmtClock } from './tools.js';

const VERSION = '2.0.0';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMOJIS = ['🦊', '🐻', '🐼', '🐸', '🦁', '🐯', '🐨', '🐵', '🦄', '🐙', '🦉', '🐧', '🐳', '🦖', '🐝', '🦀', '🐢', '🦩', '🐺', '🦦', '🐲', '🦔', '🐞', '🦜'];
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

const LENGTHS = [['open', 'Open'], ['r3', '3 rounds'], ['r5', '5 rounds'], ['r6', '6 rounds'], ['r8', '8 rounds'], ['r12', '12 rounds'], ['t60', '60 min'], ['t90', '90 min'], ['t120', '2 hours']];

const ui = {
  tab: 'play',
  setup: {
    playerIds: [], modeId: 'classic', length: 'open', useLocation: true,
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
  const players = s.playerIds.map((id) => store.get('players', id)).filter(Boolean).map(({ id, name, emoji }) => ({ id, name, emoji }));
  return { filter, rules, players, range: store.settings.range, useLocation: s.useLocation, log: [], used: [] };
}

function viewSetup() {
  const s = ui.setup;
  const players = store.list('players').sort((a, b) => a.name.localeCompare(b.name));
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

  <section class="panel">
    <h2>Who's playing?</h2>
    <div class="chips">${players.map((p) => chip(pname(p), s.playerIds.includes(p.id), 'setup-player', { id: p.id })).join('')}</div>
    <form class="inline-add" data-form="add-player">
      <input name="name" placeholder="Add a player" maxlength="24" autocomplete="off">
      <button class="btn">Add</button>
    </form>
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

  <div class="start-bar">
    <p class="muted small">${pool.length} card${pool.length === 1 ? '' : 's'} match this setup${draft.players.length < 2 ? ' (duo and versus cards need 2+ players)' : ''}</p>
    <button class="btn primary big" data-act="start-game" ${draft.players.length && pool.length ? '' : 'disabled'}>
      ${draft.players.length ? `Start ${mode.icon} ${mode.name}` : 'Pick at least one player'}
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
    <span>${g.useLocation ? `<button class="gps-pill ${ui.geo}" data-act="geo-start">📍</button>` : ''}<button class="icon-btn" data-act="game-menu" aria-label="Game menu">⋯</button></span>
  </div>
  <div class="scores">${g.players.map((p, i) => `
    <div class="score ${i === g.turn ? 'turn' : ''}"><span class="em">${esc(p.emoji)}</span><span class="nm">${esc(p.name)}</span><b>${stats[p.id].score}</b></div>`).join('')}
  </div>
  ${over ? `<div class="banner">${over === 'time' ? "⏰ Time's up!" : '🏁 Last round played!'} <button class="btn primary" data-act="end-game">See the podium</button></div>` : ''}
  ${card ? viewCurrentCard(g, card, stats, turnP) : viewDrawArea(g, turnP)}`;
}

function viewDrawArea(g, turnP) {
  const here = g.useLocation ? ui.here : null;
  const near = g.useLocation ? nearbyCards(allCards(), g, here) : [];
  return `
  <div class="draw-area">
    <p class="turn-label">${pname(turnP)}'s turn</p>
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

  let pickers = '';
  if (card.who === 'duo') pickers = `<p class="pick-label">Partner</p><div class="chips">${others.map((p) => chip(pname(p), cur.partners.includes(p.id), 'pick-partner', { id: p.id })).join('')}</div>`;
  if (card.who === 'versus') pickers = `<p class="pick-label">Winner(s)</p><div class="chips">${g.players.map((p) => chip(pname(p), cur.winners.includes(p.id), 'pick-winner', { id: p.id })).join('')}</div>`;
  if (card.who === 'group') pickers = '<p class="pick-label">Everyone scores 🙌</p>';
  const needsPick = (card.who === 'duo' && !cur.partners.length) || (card.who === 'versus' && !cur.winners.length);

  return `
  <p class="turn-label">${pname(turnP)}'s card</p>
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
      <button class="btn ok big" data-act="resolve-done" ${needsPick ? 'disabled' : ''}>✅ Done <small>+${pts}</small></button>
      <button class="btn" data-act="resolve-fail">😅 Failed <small>0</small></button>
      <button class="btn bad" data-act="open-reject">🙅 Reject <small>${rc.free ? 'free veto' : `−${rc.cost}`}</small></button>
    </div>
    ${needsPick ? `<p class="muted small">Pick ${card.who === 'duo' ? 'a partner' : 'the winner(s)'} to complete.</p>` : ''}
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
    const rows = leaderboard(games, store.list('players')).sort((a, b) => sort.val(b) - sort.val(a));
    body = `<div class="chips scroll">${Object.entries(SORTS).map(([k, s]) => chip(s.label, ui.records.sort === k, 'rec-sort', { v: k })).join('')}</div>
      ${rows.length ? `<ol class="board">${rows.map((r) => `<li><span class="em">${esc(r.emoji)}</span><div><b>${esc(r.name)}</b><small>${r.games} game${r.games === 1 ? '' : 's'} · ${r.wins} win${r.wins === 1 ? '' : 's'} · best ${r.best ?? 0}</small></div><span class="val">${sort.val(r)}</span></li>`).join('')}</ol>`
        : '<p class="muted center">No finished games yet. Go play!</p>'}`;
  } else if (v === 'high') {
    const top = topScores(games, 15);
    body = top.length ? `<ol class="board">${top.map((r) => `<li><span class="em">${esc(r.emoji)}</span><div><b>${esc(r.name)}</b><small>${esc(r.modeName)} · ${r.nPlayers} players · ${fmtDate(r.endedAt)}</small></div><span class="val">${r.score}</span></li>`).join('')}</ol>`
      : '<p class="muted center">No scores yet.</p>';
  } else if (v === 'history') {
    body = games.length ? `<ul class="history">${games.map((g) => {
      const byId = Object.fromEntries(g.players.map((p) => [p.id, p]));
      return `<li><button data-act="open-game" data-id="${g.id}"><div><b>${g.modeIcon || ''} ${esc(g.modeName)}</b><small>${fmtDate(g.endedAt)} · ${g.players.length} players · ${g.log.length} cards</small></div><span>🏆 ${g.winnerIds.map((id) => esc(byId[id]?.emoji)).join('')}</span></button></li>`;
    }).join('')}</ul>` : '<p class="muted center">No games yet.</p>';
  } else {
    const ps = store.list('players').sort((a, b) => a.name.localeCompare(b.name));
    body = `<ul class="players">${ps.map((p) => `<li><span class="em">${esc(p.emoji)}</span><b>${esc(p.name)}</b><button class="btn small" data-act="edit-player" data-id="${p.id}">Edit</button></li>`).join('')}</ul>
      <form class="inline-add" data-form="add-player"><input name="name" placeholder="New player name" maxlength="24" autocomplete="off"><button class="btn">Add</button></form>`;
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
    <table class="tbl">${rows.map((p) => `<tr><td>${game.winnerIds.includes(p.id) ? '🏆 ' : ''}${pname(p)}</td><td><b>${p.score}</b></td></tr>`).join('')}</table>
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
  return `<header class="page-head"><h1>Settings</h1></header>
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
  ${rulesBlock()}
  <section class="panel">
    <h2>Danger zone</h2>
    <button class="btn bad" data-act="reset-all">Delete all data on this phone</button>
    <p class="muted small">Version ${VERSION}</p>
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
      <button class="btn" data-act="add-to-game">＋ Add a player to this game</button>
      <button class="btn bad" data-act="abandon-game">🗑 Abandon without saving</button>
      <button class="btn" data-act="close-sheet">Close</button>
    </div>
    <p class="muted small">Penance chance: ${Math.round((g.rules.penanceChance || 0) * 100)}% · Free vetoes: ${g.rules.freeVetoes || 0} each · Points ×${g.rules.mult || 1}</p>`;
}

function sheetPlayer(p) {
  if (!p) return '<p>Player not found.</p>';
  return `<h2>Edit player</h2>
    <form data-form="player" class="editor">
      <input type="hidden" name="id" value="${p.id}">
      <label>Name<input name="name" maxlength="24" required value="${esc(p.name)}"></label>
      <fieldset><legend>Emoji</legend><div class="seg wrap emoji-pick">${EMOJIS.map((e) => `<label><input type="radio" name="emoji" value="${e}" ${p.emoji === e ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div></fieldset>
      <div class="row"><button class="btn primary">Save</button><button class="btn" type="button" data-act="close-sheet">Cancel</button><button class="btn bad small" type="button" data-act="delete-player" data-id="${p.id}">Delete</button></div>
      <p class="muted small">Deleting a player keeps their past games in the records.</p>
    </form>`;
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

function addPlayer(name) {
  name = name.trim().slice(0, 24);
  if (!name) return null;
  const existing = store.list('players').find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const used = new Set(store.list('players').map((p) => p.emoji));
  const emoji = EMOJIS.find((e) => !used.has(e)) || EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
  return store.put('players', { id: uid('p_'), name, emoji });
}

function startGame() {
  const s = ui.setup, mode = modeById[s.modeId];
  const draft = setupGameDraft();
  if (!draft.players.length) return;
  store.game = {
    id: uid('g_'), startedAt: Date.now(), modeId: mode.id, modeName: mode.name, modeIcon: mode.icon,
    ...draft, turn: Math.floor(Math.random() * draft.players.length), current: null,
  };
  saveGame();
  if (s.useLocation) startGeo();
  toast(`${draft.players[store.game.turn].name} starts!`);
  render();
}

function dealCard(card, reshuffled = false) {
  const g = store.game;
  if (reshuffled) {
    const done = new Set(g.log.filter((e) => e.type === 'done').map((e) => e.cardId));
    g.used = g.used.filter((id) => done.has(id));
    toast('🔄 Deck reshuffled');
  }
  g.used.push(card.id);
  g.current = { cardId: card.id, penance: rollPenance(g.rules, PENANCES), partners: [], winners: [], bonus: false, checkin: false, tools: {} };
  saveGame();
}

function resolve(type, how) {
  const g = store.game, cur = g.current, card = cardById(cur.cardId);
  const p = g.players[g.turn];
  const entry = { ts: Date.now(), cardId: card.id, title: card.title, pid: p.id, type, awards: {}, place: !!card.place, offered: cur.penance || null, photo: cur.tools.photo?.key || null };
  if (type === 'done') {
    const ids = card.who === 'solo' ? [p.id] : card.who === 'duo' ? [p.id, ...cur.partners] : card.who === 'group' ? g.players.map((x) => x.id) : cur.winners;
    const pts = completionPoints(card, g.rules, { bonus: cur.bonus, checkin: cur.checkin });
    for (const id of ids) entry.awards[id] = pts;
    Object.assign(entry, { bonus: cur.bonus, checkin: cur.checkin });
    toast(`✅ +${pts} for ${ids.map((id) => g.players.find((x) => x.id === id)?.name).join(' & ')}`);
  } else if (type === 'reject') {
    const rc = rejectCost(card, g.rules, playerStats(g)[p.id]);
    let cost = rc.cost;
    if (how === 'penance' && cur.penance && !rc.free) { cost = costAfterPenance(cost, cur.penance.level); entry.penance = cur.penance; }
    Object.assign(entry, { free: rc.free, cost });
    if (cost) entry.awards[p.id] = -cost;
    toast(rc.free ? '🙅 Free veto used' : `🙅 −${cost} for ${p.name}`);
  } else {
    toast('😅 Good try. No points, no penalty');
  }
  g.log.push(entry);
  g.current = null;
  g.turn = (g.turn + 1) % g.players.length;
  saveGame();
  ui.sheet = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function undo() {
  const g = store.game;
  if (g.current) {
    // Put the drawn card back.
    g.used = g.used.filter((id) => id !== g.current.cardId);
    g.current = null;
  } else {
    const e = g.log.pop();
    if (!e) return;
    g.turn = Math.max(0, g.players.findIndex((p) => p.id === e.pid));
    g.current = { cardId: e.cardId, penance: e.offered || null, partners: [], winners: [], bonus: !!e.bonus, checkin: !!e.checkin, tools: e.photo ? { photo: { key: e.photo } } : {} };
  }
  saveGame();
  ui.sheet = null;
  toast('↩️ Undone');
  render();
}

function endGame() {
  const g = store.game;
  if (!g.log.length) {
    if (!confirm('No cards were played. End without saving?')) return;
    store.game = null; saveGame(); ui.sheet = null; render(); return;
  }
  const stats = playerStats(g);
  const rows = g.players.map((p) => ({ ...p, ...stats[p.id] }));
  const record = {
    id: g.id, startedAt: g.startedAt, endedAt: Date.now(), modeId: g.modeId, modeName: g.modeName, modeIcon: g.modeIcon,
    players: rows, winnerIds: winnersOf(rows), log: g.log,
  };
  store.put('games', record);
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
  'draw': () => {
    const g = store.game;
    const res = drawCard(allCards(), g, g.useLocation ? ui.here : null);
    if (!res) { toast('No cards left for this mode. End the game or change the deck'); return; }
    dealCard(res.card, res.reshuffled);
    renderView();
  },
  'take-card': ({ id }) => { const c = cardById(id); if (c) { dealCard(c); renderView(); window.scrollTo({ top: 0 }); } },
  'skip-turn': () => { const g = store.game; g.turn = (g.turn + 1) % g.players.length; saveGame(); renderView(); },
  'pick-partner': ({ id }) => { const c = store.game.current; c.partners = c.partners.includes(id) ? c.partners.filter((x) => x !== id) : [...c.partners, id]; saveGame(); renderView(); },
  'pick-winner': ({ id }) => { const c = store.game.current; c.winners = c.winners.includes(id) ? c.winners.filter((x) => x !== id) : [...c.winners, id]; saveGame(); renderView(); },
  'checkin': () => {
    const g = store.game, card = cardById(g.current.cardId), p = resolvePlace(card);
    if (!ui.here || !p) return toast('📍 No GPS fix yet');
    const d = distanceM(ui.here, p);
    if (d > CHECKIN_RADIUS) return toast(`Still ${fmtDistance(d)} away. Get within ${CHECKIN_RADIUS} m`);
    g.current.checkin = true; saveGame(); toast(`📍 Checked in! +${CHECKIN_BONUS}`); renderView();
  },
  'resolve-done': () => resolve('done'),
  'resolve-fail': () => resolve('fail'),
  'open-reject': () => { ui.sheet = { type: 'reject' }; renderSheet(); },
  'reject': ({ how }) => resolve('reject', how),
  'game-menu': () => { ui.sheet = { type: 'menu' }; renderSheet(); },
  'undo': undo,
  'end-game': endGame,
  'abandon-game': () => {
    if (!confirm('Abandon this game? Nothing will be saved.')) return;
    store.game = null; saveGame(); ui.sheet = null; render();
  },
  'add-to-game': () => {
    const g = store.game;
    const name = prompt('Name of the player joining:');
    if (!name) return;
    const p = addPlayer(name);
    if (!p) return;
    if (g.players.some((x) => x.id === p.id)) return toast(`${p.name} is already playing`);
    g.players.push({ id: p.id, name: p.name, emoji: p.emoji });
    saveGame(); ui.sheet = null; toast(`${p.emoji} ${p.name} joined`); render();
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
    const st = toolState(scope, tool);
    const ctx = { scope, card: scope === 'game' && store.game?.current ? cardById(store.game.current.cardId) : null, players: store.game?.players || [] };
    await toolOp(tool, st, op, ctx);
    if (scope === 'game') saveGame();
    if (ui.sheet?.type === 'tools' && scope === 'free') renderSheet(); else renderView();
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
    if (!confirm('Delete this player? Their past games stay in the records.')) return;
    store.remove('players', id); ui.setup.playerIds = ui.setup.playerIds.filter((x) => x !== id); ui.sheet = null; render();
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
  'range': (el) => { store.settings.range = Number(el.value); store.saveSettings(); if (store.game) { store.game.range = store.settings.range; saveGame(); } renderView(); },
  'bonus': (el) => { store.game.current.bonus = el.checked; saveGame(); renderView(); },
  'photo': async (el) => {
    const file = el.files?.[0];
    if (!file) return;
    try {
      const blob = await compressImage(file);
      const st = toolState(el.dataset.scope, 'photo');
      const key = uid('ph_');
      await photos.put(key, blob);
      st.key = key;
      if (el.dataset.scope === 'game') saveGame();
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
  'add-player': (form) => {
    const p = addPlayer(form.name.value);
    if (!p) return;
    if (ui.tab === 'play' && !ui.setup.playerIds.includes(p.id)) ui.setup.playerIds.push(p.id);
    renderView();
    $('[data-form="add-player"] input')?.focus();
  },
  'card': saveCardForm,
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
  formActions[form.dataset.form]?.(form);
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(); });
store.onChange(() => renderView());

// ── Boot ────────────────────────────────────────────────────────────────────
if (store.game?.useLocation) startGeo();
if (!store.game && store.list('players').length) {
  // Preselect the players from the most recent game.
  const last = store.list('games').sort((a, b) => b.endedAt - a.endedAt)[0];
  if (last) ui.setup.playerIds = last.players.map((p) => p.id).filter((id) => store.get('players', id));
}
render();
autoSync();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});

// For tests and debugging in the console.
window.__deck = { store, ui, render };
