// Call of Duty splitscreen rounds: the app picks the game, map, mode, house rule and who plays.
// Pure functions (no DOM) so they can be tested. Game data lives in data/cod.js.

import { COD_GAMES, FORMATS, HOUSE_RULES } from './data/cod.js';

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** How many CoD rounds each player has been on screen for, so sitting out rotates fairly. */
function screenTime(g) {
  const n = Object.fromEntries(g.players.map((p) => [p.id, 0]));
  for (const e of g.log) for (const id of e.onScreen || []) if (id in n) n[id]++;
  return n;
}

/** Choose who plays: always the player on turn, then whoever has played least. */
function choosePlayers(g, count, rng) {
  const turnId = g.players[g.turn].id;
  const played = screenTime(g);
  const others = shuffle(g.players.filter((p) => p.id !== turnId), rng).sort((a, b) => played[a.id] - played[b.id]);
  return [turnId, ...others.slice(0, count - 1).map((p) => p.id)];
}

/** Games we can use: the ones the crew owns (all when none are ticked). */
export function ownedGames(owned) {
  return COD_GAMES.filter((x) => !owned?.length || owned.includes(x.id));
}

/**
 * A new round for game `g`, or null if nothing fits.
 * `owned`: ids of the games the crew has (empty = all).
 */
export function codRound(g, owned = [], rng = Math.random) {
  const n = g.players.length;
  const games = ownedGames(owned);
  if (!games.length || n < 1) return null;

  // Formats that fit the player count on at least one owned game.
  const fits = (f, game) => {
    let max;
    if (f.kind === 'coop') {
      if (!game.coop?.maps?.length) return false;
      max = game.coop.maxSplit;
    } else {
      max = game.maxSplit;
    }
    const need = f.players === 'all' ? Math.min(n, max) : f.players;
    if (f.kind !== 'coop' && !game.modes.some((m) => m.kinds.includes(f.kind) && (m.min || 0) <= need)) return false;
    return n >= f.min && need >= f.min && need <= max;
  };
  const options = FORMATS.flatMap((f) => games.filter((game) => fits(f, game)).map((game) => ({ f, game })));
  if (!options.length) return null;
  const { f, game } = pick(options.flatMap((o) => Array(o.f.weight || 1).fill(o)), rng);

  const max = f.kind === 'coop' ? game.coop.maxSplit : game.maxSplit;
  const count = f.players === 'all' ? Math.min(n, max) : f.players;
  const onScreen = choosePlayers(g, count, rng);
  const sittingOut = g.players.filter((p) => !onScreen.includes(p.id)).map((p) => p.id);

  let mode, map;
  if (f.kind === 'coop') {
    mode = { name: game.coop.name };
    map = pick(game.coop.maps, rng);
  } else {
    mode = pick(game.modes.filter((m) => m.kinds.includes(f.kind) && (m.min || 0) <= count), rng);
    map = pick(game.maps, rng);
  }
  const rules = HOUSE_RULES.filter((r) => r.kinds.includes(f.kind) && (!r.modes || r.modes.includes(mode.name)));
  const rule = f.houseRule === false || !rules.length ? null : pick(rules, rng);

  let teams = null;
  if (f.kind === 'teams') {
    const s = shuffle(onScreen, rng);
    const half = Math.ceil(s.length / 2);
    teams = [s.slice(0, half), s.slice(half)];
  }
  // The goal: co-op uses the game's own (rounds, waves, hives, difficulty); an S&D duel uses rounds.
  const goal = f.kind === 'coop' ? game.coop.goal : (f.kind === 'duel' && mode.duelGoal) || f.text;
  const targets = f.kind === 'coop' ? game.coop.targets : f.targets;
  const target = targets ? pick(targets, rng) : null;
  const name = (id) => g.players.find((p) => p.id === id)?.name || '?';
  const lines = [
    `${game.name} · ${map} · ${mode.name}`,
    teams ? `Red team: ${teams[0].map(name).join(' & ')} · Blue team: ${teams[1].map(name).join(' & ')}` : `On screen: ${onScreen.map(name).join(', ')}`,
    goal.replace('{target}', target ?? ''),
    rule ? `House rule: ${rule.text}` : '',
    sittingOut.length ? `Sitting out (and refereeing): ${sittingOut.map(name).join(', ')}` : '',
  ].filter(Boolean);

  return {
    id: `cod:${Date.now().toString(36)}${Math.floor(rng() * 1e6).toString(36)}`,
    generated: true, deck: 'cod',
    title: rule ? `${f.name}: ${rule.name}` : f.name,
    text: lines.join('\n'),
    diff: f.diff, mins: f.mins,
    who: f.kind === 'coop' ? 'group' : 'versus',
    tags: ['indoor'], tool: f.tool || null, secs: f.secs || null, place: null, needs: [], custom: false, mix: false,
    players: onScreen, teams,
    cod: { game: game.id, map, mode: mode.name, format: f.id, rule: rule?.id || null },
  };
}
