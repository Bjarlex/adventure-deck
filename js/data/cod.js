// Call of Duty splitscreen data. COD_GAMES is filled from research (see the comment there);
// FORMATS and HOUSE_RULES are ours and work in any of the games.
//
// Mode "kinds": duel (1v1), ffa (everyone for themselves), teams, party (fun modes), coop.

// ── Round formats ───────────────────────────────────────────────────────────
// players: a number, or 'all' (everyone who fits on the screen). min: players needed in the group.
export const FORMATS = [
  { id: 'duel',     name: '1v1 Duel',        kind: 'duel',  players: 2,     min: 2, diff: 2, mins: 10, weight: 3, text: 'First to {target} kills wins.', targets: [10, 15, 20] },
  { id: 'ffa',      name: 'Free-for-all',    kind: 'ffa',   players: 'all', min: 3, diff: 2, mins: 10, weight: 3, text: 'Highest score at the end of the match wins.' },
  { id: 'teams',    name: 'Team battle',     kind: 'teams', players: 'all', min: 4, diff: 2, mins: 15, weight: 3, text: 'The winning team scores, every member.' },
  { id: 'handicap', name: '2 vs 1 Handicap', kind: 'teams', players: 3,     min: 3, diff: 3, mins: 10, weight: 1, text: 'Two against one. Win as the lone wolf and you deserve the Legendary bonus.' },
  { id: 'party',    name: 'Party mode',      kind: 'party', players: 'all', min: 2, diff: 2, mins: 10, weight: 2, text: 'Whoever wins the mode takes the points.', houseRule: false },
  { id: 'coop',     name: 'Co-op survival',  kind: 'coop',  players: 'all', min: 2, diff: 3, mins: 30, weight: 2, text: 'Survive to round/wave {target} together.', targets: [5, 8, 10, 12, 15], houseRule: false },
];

// ── House rules (on top of the game's own settings) ─────────────────────────
const ALL = ['duel', 'ffa', 'teams'];
export const HOUSE_RULES = [
  { id: 'snipers',   kinds: ALL, name: 'Sniper battle',  text: 'Sniper rifles only.' },
  { id: 'pistols',   kinds: ALL, name: 'Pistol whip',    text: 'Pistols only, no primary weapon.' },
  { id: 'knives',    kinds: ALL, name: 'Knife fight',    text: 'Melee only (plus throwing knives if your game has them).' },
  { id: 'shotguns',  kinds: ALL, name: 'Close quarters', text: 'Shotguns only.' },
  { id: 'launchers', kinds: ALL, name: 'Boom',           text: 'Launchers only. Yes, really.' },
  { id: 'hipfire',   kinds: ALL, name: 'Hip fire',       text: 'No aiming down sights.' },
  { id: 'crouch',    kinds: ALL, name: 'Low profile',    text: 'No standing up: crouch or go prone the whole match.' },
  { id: 'nostreaks', kinds: ALL, name: 'Pure skill',     text: 'No killstreaks or scorestreaks.' },
  { id: 'leftpicks', kinds: ALL, name: 'Left hand',      text: 'The player on your left picks your loadout.' },
  { id: 'samegun',   kinds: ALL, name: 'Same gun',       text: 'Everyone uses the same weapon; whoever is sitting out (or the youngest) picks it.' },
  { id: 'swap',      kinds: ALL, name: 'Controller swap', text: 'At half-time, everyone swaps controllers and screen corners.' },
  { id: 'inverted',  kinds: ALL, name: 'Upside down',    text: 'Everyone plays with inverted look.' },
  { id: 'onehand',   kinds: ['duel', 'ffa'], name: 'One hand', text: 'Play with one hand on the controller.' },
  { id: 'default',   kinds: ALL, name: 'Default classes', text: 'Default classes only, no custom loadouts.' },
];

// ── Games ───────────────────────────────────────────────────────────────────
// Researched 2026-11-13 from the Call of Duty Wiki (callofduty.fandom.com: each game's page,
// map and game-type templates, "Split Screen"), cross-checked with Activision support FAQs
// (Black Ops III, Infinite Warfare) and Co-Optimus. On Xbox Series X, the 360 discs of MW2, Black Ops,
// MW3, Black Ops II, Ghosts and Advanced Warfare run via backward compatibility (Microsoft's list).
// maxSplit: local splitscreen players in offline multiplayer. Maps: base game only (no DLC,
// no pre-order bonus maps). Party modes are only listed where they are confirmed to work offline.
// modes[].kinds: which round formats a mode suits; min: fewest players it is fun with.
// coop: co-op / zombies mode with its own splitscreen limit, maps, goal and targets.

const TDM = { name: 'Team Deathmatch', kinds: ['teams'] };
const FFA = { name: 'Free-for-All', kinds: ['ffa', 'duel'] };
const DOM = { name: 'Domination', kinds: ['teams'] };
const SND = { name: 'Search and Destroy', kinds: ['teams', 'duel'], duelGoal: 'One life per round. Best of 7 rounds.' };
const KC = { name: 'Kill Confirmed', kinds: ['teams'] };
const CTF = { name: 'Capture the Flag', kinds: ['teams'] };
const HP = { name: 'Hardpoint', kinds: ['teams'] };
const DEM = { name: 'Demolition', kinds: ['teams'] };
const t = (name) => ({ name, kinds: ['teams'] });
const party = (name, min = 2) => ({ name, kinds: ['party'], min });
const ROUNDS = [5, 8, 10, 12, 15];

export const COD_GAMES = [
  { id: 'mw2', short: 'MW2', name: 'Modern Warfare 2', maxSplit: 4,
    maps: ['Afghan', 'Derail', 'Estate', 'Favela', 'Highrise', 'Invasion', 'Karachi', 'Quarry', 'Rundown', 'Rust', 'Scrapyard', 'Skidrow', 'Sub Base', 'Terminal', 'Underpass', 'Wasteland'],
    modes: [TDM, FFA, DOM, SND, t('Sabotage'), t('Headquarters'), CTF, DEM],
    coop: { name: 'Spec Ops', maxSplit: 2, maps: ['The Pit', 'Sniper Fi', 'O Cristo Redentor', 'Evasion', 'Suspension', 'Overwatch', 'Body Count', 'Bomb Squad', 'Race', 'Big Brother', 'Hidden', 'Breach & Clear', 'Time Trial', 'Homeland Security', 'Snatch & Grab', 'Wardriving', 'Wreckage', 'Acceptable Losses', 'Terminal', 'Estate Takedown', 'Wetwork', 'High Explosive', 'Armor Piercing'],
      goal: 'Finish the mission together on {target} or harder.', targets: ['Regular', 'Hardened', 'Veteran'] } },
  { id: 'bo1', short: 'Black Ops', name: 'Black Ops', maxSplit: 4,
    maps: ['Array', 'Cracked', 'Crisis', 'Firing Range', 'Grid', 'Hanoi', 'Havana', 'Jungle', 'Launch', 'Nuketown', 'Radiation', 'Summit', 'Villa', 'WMD'],
    modes: [TDM, FFA, DOM, SND, t('Sabotage'), t('Headquarters'), CTF, DEM],
    coop: { name: 'Zombies', maxSplit: 2, maps: ['Kino der Toten', '"Five" (unlockable)', 'Dead Ops Arcade (unlockable)'], goal: 'Survive to round {target} together.', targets: ROUNDS } },
  { id: 'mw3', short: 'MW3', name: 'Modern Warfare 3', maxSplit: 4,
    maps: ['Arkaden', 'Bakaara', 'Bootleg', 'Carbon', 'Dome', 'Downturn', 'Fallen', 'Hardhat', 'Interchange', 'Lockdown', 'Mission', 'Outpost', 'Resistance', 'Seatown', 'Underground', 'Village'],
    modes: [TDM, FFA, DOM, SND, t('Sabotage'), t('Headquarters Pro'), CTF, DEM, KC, t('Team Defender'), t('Drop Zone'), t('Team Juggernaut'),
      party('Infected', 3), party('Gun Game'), party('One in the Chamber'), party('Juggernaut', 3)],
    coop: { name: 'Survival', maxSplit: 2, maps: ['Resistance', 'Village', 'Interchange', 'Underground', 'Dome', 'Mission', 'Seatown', 'Carbon', 'Bootleg', 'Hardhat', 'Fallen', 'Outpost', 'Lockdown', 'Arkaden', 'Downturn', 'Bakaara'],
      goal: 'Survive to wave {target} together.', targets: [5, 10, 15, 20] } },
  { id: 'bo2', short: 'Black Ops II', name: 'Black Ops II', maxSplit: 4,
    maps: ['Aftermath', 'Cargo', 'Carrier', 'Drone', 'Express', 'Hijacked', 'Meltdown', 'Overflow', 'Plaza', 'Raid', 'Slums', 'Standoff', 'Turbine', 'Yemen'],
    modes: [TDM, FFA, DOM, SND, DEM, t('Headquarters'), HP, KC, CTF,
      party('Gun Game'), party('One in the Chamber'), party('Sharpshooter'), party('Sticks and Stones')],
    coop: { name: 'Zombies', maxSplit: 4, maps: ['TranZit', 'Bus Depot (Survival)', 'Farm (Survival)', 'Town (Survival)'], goal: 'Survive to round {target} together.', targets: ROUNDS } },
  { id: 'ghosts', short: 'Ghosts', name: 'Ghosts', maxSplit: 2,
    maps: ['Chasm', 'Flooded', 'Freight', 'Octane', 'Overlord', 'Prison Break', 'Siege', 'Sovereign', 'Stonehaven', 'Stormfront', 'Strikezone', 'Tremor', 'Warhawk', 'Whiteout'],
    modes: [TDM, FFA, DOM, SND, KC, t('Search and Rescue'), t('Blitz'), t('Grind'), t('Reinforce'), party('Cranked'), party('Hunted'), party('Infected', 3)],
    coop: { name: 'Extinction', maxSplit: 2, maps: ['Point of Contact'], goal: 'Destroy at least {target} hives together.', targets: [3, 5, 8] } },
  { id: 'aw', short: 'Adv. Warfare', name: 'Advanced Warfare', maxSplit: 2,
    maps: ['Ascend', 'Bio Lab', 'Comeback', 'Defender', 'Detroit', 'Greenband', 'Horizon', 'Instinct', 'Recovery', 'Retreat', 'Riot', 'Solar', 'Terrace'],
    modes: [TDM, FFA, DOM, SND, HP, KC, CTF, t('Uplink'), t('Search and Rescue'), t('Momentum')],
    coop: { name: 'Exo Survival', maxSplit: 2, maps: ['Bio Lab', 'Retreat', 'Detroit', 'Ascend', 'Horizon', 'Comeback', 'Terrace', 'Instinct', 'Greenband', 'Solar', 'Recovery', 'Defender'],
      goal: 'Survive to round {target} together.', targets: [10, 15, 20, 25] } },
  { id: 'bo3', short: 'Black Ops III', name: 'Black Ops III', maxSplit: 4, note: 'needs the Xbox One disc (4 players, runs on Series X); the 360 version has no splitscreen and is not backward compatible',
    maps: ['Aquarium', 'Breach', 'Combine', 'Evac', 'Exodus', 'Fringe', 'Havoc', 'Hunted', 'Infection', 'Metro', 'Redwood', 'Stronghold'],
    modes: [TDM, FFA, DOM, SND, DEM, HP, KC, CTF, t('Safeguard'), t('Uplink')],
    coop: { name: 'Zombies', maxSplit: 2, maps: ['Shadows of Evil'], goal: 'Survive to round {target} together.', targets: ROUNDS } },
  { id: 'iw', short: 'Inf. Warfare', name: 'Infinite Warfare', maxSplit: 2, note: 'Xbox One disc only (no 360 version)',
    maps: ['Breakout', 'Crusher', 'Frontier', 'Frost', 'Genesis', 'Grounded', 'Mayday', 'Precinct', 'Retaliation', 'Scorch', 'Skydock', 'Throwback'],
    modes: [TDM, FFA, DOM, SND, HP, KC, t('Frontline'), t('Defender'), CTF, t('Uplink'), t('Search and Rescue'), DEM, t('Reinforce'), t('Grind'), t('Drop Zone'),
      party('Gun Game'), party('Cranked'), party('All or Nothing'), party('Infected', 3)],
    coop: { name: 'Zombies', maxSplit: 2, maps: ['Zombies in Spaceland'], goal: 'Survive to round {target} together.', targets: ROUNDS } },
  { id: 'wwii', short: 'WWII', name: 'WWII', maxSplit: 2, note: 'Xbox One disc only (no 360 version)',
    maps: ['Aachen', 'Ardennes Forest', 'Flak Tower', 'Gibraltar', 'Gustav Cannon', 'London Docks', 'Pointe du Hoc', 'Sainte Marie du Mont', 'USS Texas'],
    modes: [TDM, FFA, DOM, SND, HP, CTF, KC, t('Gridiron')],
    coop: { name: 'Nazi Zombies', maxSplit: 2, maps: ['The Final Reich'], goal: 'Survive to round {target} together.', targets: ROUNDS } },
];
