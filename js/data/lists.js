// Content for the built-in tools and the penance system. Edit freely.

// Penances: physical forfeits that can be offered when a player rejects a card.
// level 1 = light (halves the point loss), level 2 = heavy (cuts the loss to a quarter).
export const PENANCES = [
  { level: 1, text: '15 squats, right here' },
  { level: 1, text: '20 jumping jacks' },
  { level: 1, text: '30-second plank' },
  { level: 1, text: '10 push-ups (knees allowed)' },
  { level: 1, text: '30-second wall sit' },
  { level: 1, text: 'Hop on one foot to the next lamppost' },
  { level: 1, text: '20 calf raises on the nearest kerb' },
  { level: 1, text: '10 lunges per leg' },
  { level: 2, text: '25 push-ups' },
  { level: 2, text: '60-second plank' },
  { level: 2, text: '15 burpees' },
  { level: 2, text: 'Sprint 100 m and back' },
  { level: 2, text: 'Piggyback a friend 50 m (safely)' },
  { level: 2, text: '60-second wall sit while the others count out loud' },
  { level: 2, text: '30 squats with your arms straight out' },
  { level: 2, text: 'Bear-crawl 15 metres' },
];

export const BINGO_SOUNDS = [
  'Bike bell', 'Seagull', 'Church bells', 'Metro door chime', 'Ambulance siren', 'Someone laughing',
  'Dog barking', 'Harbour bus horn', 'Skateboard', 'Busker / street music', 'Someone says "hej"',
  'Glass clinking', 'Baby crying', 'Construction drill', 'Bus kneeling hiss', 'Someone whistling',
  'Coffee machine', 'Crow cawing', 'Car horn', 'Cargo bike rattling', 'A phone ringing',
  'Someone singing', 'Footsteps on cobbles', 'Flag flapping', 'Water splashing', 'Duck quacking',
  'Someone says "undskyld"', 'Shop door bell', 'Bottle deposit machine', 'Applause or cheering',
  'Someone speaking English', 'A train announcement',
];

export const DEBATE_TOPICS = [
  'Is falafel better than smørrebrød?',
  'Should bikes have the right of way over pedestrians everywhere?',
  'Are seagulls the true rulers of Copenhagen?',
  'Is rye bread a dessert?',
  'Should pigeons pay rent?',
  'Would the Little Mermaid be happier in Aarhus?',
  'Is it ever acceptable to walk in the bike lane?',
  'Cinnamon snail vs. chocolate snail: which deserves a statue?',
  'Should the Metro play music?',
  'Is a hot dog a sandwich?',
  'Should every bench have a cup holder?',
  'Are cargo bikes vehicles or lifestyle statements?',
  'Should Tivoli be open all year, 24/7?',
  'Is jaywalking a sport?',
  'Ducks or swans: who runs the Lakes?',
  'Should Copenhagen build a second Little Mermaid, but huge?',
  'Is pineapple on a hot dog genius or a crime?',
  'Should rain count as weather or as a personality trait?',
  'Is it rude to overtake someone on a Christiania bike?',
  'Should all bridges have slides?',
  'Is liquorice candy or punishment?',
  'Would you rather live in Nyhavn or on a houseboat?',
  'Is "hygge" a feeling or a business model?',
  'Should the Round Tower get an elevator?',
  'Are umbrellas pointless in Danish wind?',
  'Should brunch be illegal after 13:00?',
  'Is the harbour bus public transport or a cruise?',
  'Should statues be allowed to wear hats in winter?',
];

// Urban Tarot: harbour and street objects and what they mean.
export const TAROT = [
  ['Boat', 'Travel is coming'], ['Crane', 'Big change ahead'], ['Seagull', 'Someone wants what you have'],
  ['Bike', 'Keep moving, balance matters'], ['Bridge', 'A reconciliation'], ['Anchor', 'Stay where you are'],
  ['Lifebuoy', 'Help from an unexpected friend'], ['Rope', 'You are tied to an old promise'],
  ['Flag', 'Victory, or at least a good mood'], ['Bench', 'Rest before your next move'],
  ['Kayak', 'Go solo for a while'], ['Church spire', 'Ask for advice'], ['Puddle', 'Look closer at yourself'],
  ['Lamppost', 'An idea will strike tonight'], ['Statue', 'Someone is watching and judging'],
  ['Pigeon', 'Small gains, many of them'], ['Swan', 'Grace under pressure'], ['Bus', 'Opportunity that runs on a schedule'],
  ['Cobblestone', 'The path is bumpy but solid'], ['Pastry', 'Treat yourself, immediately'],
];

export const SONG_SCENES = [
  '80s training montage', 'Nordic noir crime scene', 'Bollywood wedding finale', 'Western showdown at noon',
  'Slow-motion heist walk-out', 'Rom-com airport run', 'Nature documentary: the hunt', 'Zombie apocalypse escape',
  'Fashion runway', 'Musical number in the rain', 'Spy tailing a suspect', 'Superhero landing',
  'Tragic opera finale', 'Kung-fu master entrance', 'Horror film: something is behind you',
  'Victorious sports team parade', 'Sneaking into a party', 'Space walk on the Moon', 'Pirate boarding a ship',
  'Elevator music, but intense',
];

// S-train and Metro stations around central Copenhagen.
export const STATIONS = [
  'Østerport', 'Nordhavn', 'Svanemøllen', 'Hellerup', 'Ryparken', 'Bispebjerg', 'Nørrebro', 'Fuglebakken',
  'Grøndal', 'Flintholm', 'KB Hallen', 'Peter Bangs Vej', 'Valby', 'Ny Ellebjerg', 'Sydhavn', 'Dybbølsbro',
  'Carlsberg', 'Vesterport', 'Nørreport', 'Emdrup', 'Charlottenlund', 'Klampenborg', 'Vanløse',
  'Kongens Nytorv', 'Gammel Strand', 'Rådhuspladsen', 'Marmorkirken', 'Frederiksberg Allé', 'Enghave Plads',
  'Aksel Møllers Have', 'Nuuks Plads', 'Skjolds Plads', 'Vibenshus Runddel', 'Poul Henningsens Plads',
  'Trianglen', 'Øresund', 'Lergravsparken', 'Amagerbro', 'Christianshavn', 'Islands Brygge', 'DR Byen',
  'Sundby', 'Bella Center', 'Ørestad', 'Femøren', 'Amager Strand', 'Forum', 'Fasanvej', 'Lindevang',
  'Orientkaj', 'Havneholmen', 'Enghave Brygge', 'Sluseholmen', 'Mozarts Plads',
];

export const LETTERS = 'ABCDEFGHIJKLMNOPRSTUVÆØÅ'.split('');

export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
