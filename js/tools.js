// Built-in tools. Each tool renders from a small state object, so a tool attached to the
// current card survives re-renders and app reloads (the state is saved with the game).
// Buttons use data-act="tool" data-tool="<id>" data-op="<operation>" data-scope="game|free".

import { BINGO_SOUNDS, DEBATE_TOPICS, TAROT, SONG_SCENES, STATIONS, LETTERS, DIRECTIONS } from './data/lists.js';
import { TOOLS } from './rules.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffled = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function fmtClock(ms) {
  const neg = ms < 0; ms = Math.abs(ms);
  const t = Math.ceil(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const body = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return (neg ? '-' : '') + body;
}

// ── Sound ───────────────────────────────────────────────────────────────────
let audio = null;
export function unlockAudio() {
  try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch {}
}
export function beep(times = 3) {
  if (!audio) return;
  for (let i = 0; i < times; i++) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; o.type = 'square';
    const t = audio.currentTime + i * 0.35;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.3);
  }
  try { navigator.vibrate?.([200, 100, 200, 100, 200]); } catch {}
}

// ── Wind (Open-Meteo, free, no key; we send fixed central-Copenhagen coordinates, not yours) ──
let windCache = null;
async function fetchWind() {
  if (windCache && Date.now() - windCache.at < 15 * 60000) return windCache;
  const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=55.68&longitude=12.57&current=wind_direction_10m,wind_speed_10m&wind_speed_unit=ms');
  if (!r.ok) throw new Error('weather service unavailable');
  const j = await r.json();
  windCache = { from: j.current.wind_direction_10m, speed: j.current.wind_speed_10m, at: Date.now() };
  return windCache;
}

// ── Rendering ───────────────────────────────────────────────────────────────
const btn = (scope, tool, op, label, cls = '') => `<button class="btn ${cls}" data-act="tool" data-scope="${scope}" data-tool="${tool}" data-op="${op}">${label}</button>`;

/**
 * @param {string} tool  tool id
 * @param {object} st    the tool's state (mutated by toolOp)
 * @param {object} ctx   {scope, card, players}
 */
export function renderTool(tool, st, ctx) {
  const { scope } = ctx;
  const b = (op, label, cls) => btn(scope, tool, op, label, cls);
  const head = `<div class="tool-head">${TOOLS[tool].label}</div>`;
  let body = '';
  switch (tool) {
    case 'timer': {
      const dur = st.dur ?? (ctx.card?.secs || 60) * 1000;
      st.dur = dur;
      body = `<div class="clock ${st.done ? 'clock-done' : ''}" data-clock="timer" data-scope="${scope}">${fmtClock(timerLeft(st))}</div>
        <div class="row">${st.endAt ? b('pause', 'Pause') : b('start', st.done ? 'Restart' : st.left != null && st.left < st.dur ? 'Resume' : 'Start', 'primary')}${b('reset', 'Reset')}</div>
        ${scope === 'free' || !ctx.card?.secs ? `<div class="row small">${[30, 60, 120, 300, 600, 900].map((s) => b('set:' + s, s < 60 ? s + 's' : s / 60 + 'm', 'chip')).join('')}</div>` : ''}`;
      break;
    }
    case 'stopwatch':
      body = `<div class="clock" data-clock="stopwatch" data-scope="${scope}">${fmtClock(stopwatchMs(st))}</div>
        <div class="row">${st.startAt ? b('stop', 'Stop') : b('start', st.acc ? 'Resume' : 'Start', 'primary')}${b('reset', 'Reset')}${st.startAt ? b('lap', 'Lap') : ''}</div>
        ${st.laps?.length ? `<ol class="laps">${st.laps.map((l) => `<li>${fmtClock(l)}</li>`).join('')}</ol>` : ''}`;
      break;
    case 'bingo': {
      if (!st.cells) Object.assign(st, { cells: shuffled(BINGO_SOUNDS).slice(0, 16), marked: [] });
      const lines = bingoLines(st.marked);
      body = `<div class="bingo">${st.cells.map((c, i) => `<button class="bingo-cell ${st.marked.includes(i) ? 'on' : ''}" data-act="tool" data-scope="${scope}" data-tool="bingo" data-op="mark:${i}">${esc(c)}</button>`).join('')}</div>
        ${lines ? `<div class="banner win">BINGO! ${lines} line${lines > 1 ? 's' : ''}</div>` : ''}
        <div class="row">${b('new', 'New card')}</div>`;
      break;
    }
    case 'station':
      body = `${st.value ? `<div class="big-result">${esc(st.value)}</div>` : '<p class="muted">Spin to pick a station.</p>'}
        <div class="row">${b('roll', st.value ? 'Spin again' : 'Spin', 'primary')}</div>`;
      break;
    case 'compass': {
      const arrow = st.deg != null ? `<div class="arrow" style="transform:rotate(${st.deg}deg)"><svg viewBox="0 0 24 24" width="64" height="64" aria-hidden="true"><path d="M12 2l7 19-7-4.5L5 21z" fill="currentColor"/></svg></div><div class="big-result">Head ${esc(st.label)}</div>` : '<p class="muted">Pick a random direction, or follow the wind.</p>';
      body = `${arrow}${st.note ? `<p class="muted small">${esc(st.note)}</p>` : ''}
        <div class="row">${b('random', 'Random direction', 'primary')}${b('wind', 'Wind at your back')}</div>`;
      break;
    }
    case 'tarot':
      body = `${st.reading ? `<div class="tarot">${st.reading.map(([o, m]) => `<div><b>${esc(o)}</b><span>${esc(m)}</span></div>`).join('')}</div>` : ''}
        <div class="row">${b('read', st.reading ? 'Draw again' : 'Random reading', 'primary')}${b('table', st.table ? 'Hide meanings' : 'All meanings')}</div>
        ${st.table ? `<div class="tarot small">${TAROT.map(([o, m]) => `<div><b>${esc(o)}</b><span>${esc(m)}</span></div>`).join('')}</div>` : ''}`;
      break;
    case 'song':
      body = `${st.value ? `<div class="big-result">${esc(st.value)}</div>` : ''}<div class="row">${b('roll', st.value ? 'Another scene' : 'Draw a scene', 'primary')}</div>`;
      break;
    case 'topic':
      body = `${st.value ? `<div class="big-result">${esc(st.value)}</div>` : ''}<div class="row">${b('roll', st.value ? 'Another topic' : 'Draw a topic', 'primary')}</div>`;
      break;
    case 'letter':
      body = `${st.value ? `<div class="big-result huge">${esc(st.value)}</div>` : ''}<div class="row">${b('roll', st.value ? 'Another letter' : 'Draw a letter', 'primary')}</div>`;
      break;
    case 'coin':
      body = `${st.value ? `<div class="big-result">${st.value === 'Heads' ? 'Heads: go left' : 'Tails: go right'}</div>` : ''}<div class="row">${b('roll', 'Flip', 'primary')}</div>`;
      break;
    case 'dice':
      body = `${st.value ? `<div class="big-result huge">${st.value}</div>` : ''}<div class="row">${b('roll', 'Roll', 'primary')}</div>`;
      break;
    case 'picker': {
      const ps = ctx.players || [];
      body = ps.length < 2 ? '<p class="muted">Needs a game with 2 or more players.</p>'
        : `${st.value ? `<div class="big-result">${esc(st.value)}</div>` : ''}<div class="row">${b('roll', 'Pick someone', 'primary')}</div>`;
      break;
    }
    case 'photo':
      body = `<div class="photo-slot" data-photo-slot="${scope}">${st.key ? '<p class="muted small">Loading photo…</p>' : ''}</div>
        <label class="btn primary file-btn">${st.key ? 'Retake' : 'Take photo'}<input type="file" accept="image/*" capture="environment" data-act-change="photo" data-scope="${scope}" hidden></label>
        <p class="muted small">Photos stay on this phone and show up in the game history.</p>`;
      break;
  }
  return `<div class="tool" data-tool-box="${tool}">${head}${body}</div>`;
}

// ── State helpers ───────────────────────────────────────────────────────────
export function timerLeft(st) {
  if (st.endAt) return st.endAt - Date.now();
  return st.left ?? st.dur ?? 60000;
}
export function stopwatchMs(st) {
  return (st.acc || 0) + (st.startAt ? Date.now() - st.startAt : 0);
}
function bingoLines(marked) {
  const m = new Set(marked);
  const lines = [];
  for (let i = 0; i < 4; i++) { lines.push([0, 1, 2, 3].map((j) => i * 4 + j)); lines.push([0, 1, 2, 3].map((j) => j * 4 + i)); }
  lines.push([0, 5, 10, 15], [3, 6, 9, 12]);
  return lines.filter((l) => l.every((x) => m.has(x))).length;
}

/** Apply a button press to a tool's state. Returns a promise for async ops (wind). */
export async function toolOp(tool, st, op, ctx) {
  const [name, arg] = op.split(':');
  switch (tool) {
    case 'timer':
      unlockAudio();
      if (name === 'start') {
        if (st.done || timerLeft(st) <= 0) st.left = null; // restart a finished timer from the top
        st.endAt = Date.now() + timerLeft(st); st.done = false;
      }
      if (name === 'pause') { st.left = Math.max(0, st.endAt - Date.now()); st.endAt = null; }
      if (name === 'reset') { st.endAt = null; st.left = null; st.done = false; }
      if (name === 'set') { st.dur = Number(arg) * 1000; st.endAt = null; st.left = null; st.done = false; }
      break;
    case 'stopwatch':
      if (name === 'start') st.startAt = Date.now();
      if (name === 'stop') { st.acc = stopwatchMs(st); st.startAt = null; }
      if (name === 'reset') { st.acc = 0; st.startAt = null; st.laps = []; }
      if (name === 'lap') (st.laps ??= []).push(stopwatchMs(st));
      break;
    case 'bingo':
      if (name === 'new') { st.cells = shuffled(BINGO_SOUNDS).slice(0, 16); st.marked = []; }
      if (name === 'mark') { const i = Number(arg); st.marked = st.marked.includes(i) ? st.marked.filter((x) => x !== i) : [...st.marked, i]; }
      break;
    case 'station': st.value = pick(STATIONS); break;
    case 'song': st.value = pick(SONG_SCENES); break;
    case 'topic': st.value = pick(DEBATE_TOPICS); break;
    case 'letter': st.value = pick(LETTERS); break;
    case 'coin': st.value = Math.random() < 0.5 ? 'Heads' : 'Tails'; break;
    case 'dice': st.value = 1 + Math.floor(Math.random() * 6); break;
    case 'picker': st.value = pick(ctx.players || [])?.name; break;
    case 'tarot':
      if (name === 'read') st.reading = shuffled(TAROT).slice(0, 3);
      if (name === 'table') st.table = !st.table;
      break;
    case 'compass':
      if (name === 'random') { const i = Math.floor(Math.random() * 8); Object.assign(st, { deg: i * 45, label: DIRECTIONS[i], note: '' }); }
      if (name === 'wind') {
        try {
          const w = await fetchWind();
          const to = (w.from + 180) % 360; // wind at your back = walk where the wind is blowing to
          Object.assign(st, { deg: to, label: DIRECTIONS[Math.round(to / 45) % 8], note: `Wind ${w.speed.toFixed(1)} m/s from ${DIRECTIONS[Math.round(w.from / 45) % 8]}. Arrow is relative to north.` });
        } catch {
          const i = Math.floor(Math.random() * 8);
          Object.assign(st, { deg: i * 45, label: DIRECTIONS[i], note: 'No connection to the weather service, so this direction is random.' });
        }
      }
      break;
  }
}

/** Called every 250 ms: refresh clocks, detect finished timers. Returns true if a timer just finished. */
export function tickClock(el, st) {
  const kind = el.dataset.clock;
  if (kind === 'timer') {
    const left = timerLeft(st);
    let finished = false;
    if (st.endAt && left <= 0 && !st.done) {
      st.done = true; st.left = 0; st.endAt = null;
      // Only beep if it just ran out. A live game can hand us a timer that ended a while ago.
      if (left > -3000) { beep(); finished = true; }
    }
    el.textContent = fmtClock(Math.max(0, timerLeft(st)));
    el.classList.toggle('clock-done', !!st.done);
    return finished;
  }
  if (kind === 'stopwatch') el.textContent = fmtClock(stopwatchMs(st));
  return false;
}
