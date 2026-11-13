# Copenhagen Adventure Deck

A challenge card game for walking around Copenhagen with friends. Install it on your phone's home screen. It works offline, and it can share players, highscores and your own cards between your phones.

Version 2.8. The original Koder version is in `v1-original/`.

## What's in it

- **295 cards** (229 walking, 66 couch): the 18 originals (merged and fixed) plus the rest. Versus cards were cut to about 30; many contests became solo cards with a clear "done if…" or group cards. 85 of them are **location cards** at 75 Copenhagen spots (Indre By, Christianshavn, Nørrebro, Nordvest, Vesterbro, Frederiksberg, Valby, Islands Brygge, Amager and Sydhavn), only dealt when you're within range (500–1000 m, set in Settings).
- **Season, daylight and weather**: cards can say when they work (summer, winter, Christmas, daylight, after dark, opening hours, dry, raining). The deck only deals what fits right now, using the calendar, a sunset calculation and live weather for central Copenhagen from Open-Meteo. While it rains, indoor cards come up twice as often. Can be switched off on the Play screen.
- **Players, points and turns**: a scoreboard, a podium and awards at the end (🎯 Closer, 🐔 Chicken, 🦾 Iron, 🧭 Explorer, 🔥 Legend).
- **Rejections and penances**: see Scoring below.
- **10 game modes**: Classic, Quick walk, Explorer, Bar crawl, Sweat, Chill, Crew cards, Custom (pick tags, length, difficulty and rules yourself), plus two indoor modes with their own decks:
  - **🛋️ Couch**: 66 cards for the sofa: would you rather, deep questions, jokes, charades, quick party games. 42 of them also turn up (at half the rate) in walking games; walking cards never come up on the couch.
  - **🎮 CoD splitscreen**: the app makes up each round: game, map, mode, house rule (sniper battle, pistols only, controller swap…) and who plays, including teams and co-op zombies/survival. It only uses the games you tick and never puts more players on screen than the game supports (MW2, Black Ops, MW3, Black Ops II and Black Ops III do 4; Ghosts, Advanced Warfare, Infinite Warfare and WWII do 2). With more players, people take turns sitting out and refereeing. Data: `js/data/cod.js`, researched from the Call of Duty Wiki, Activision FAQs and Co-Optimus.
- **Built-in tools**: timer, stopwatch, photo proof, Sound Bingo, random S-train/Metro station, random direction or "wind at your back" (live wind data), Urban Tarot, movie scenes, debate topics, random letter, coin, dice, and a random player picker.
- **Card builder**: make your own cards, including cards tied to a spot from the list or to the GPS spot you're standing on. You can switch off default cards you don't like.
- **Records**: an all-time leaderboard (points, wins, best game, average, chicken…), top-15 highscores, and a full game history with photos.
- **Live games**: one phone starts a game and gets a 4-letter code, and the others join with it. Every phone shows the same card, turn and scores (updated every 2.5 s), and anyone can draw, pick winners, use the card's timer or bingo, and score. If two phones act at the same moment, only the first counts, and the other phone refreshes. When the game ends, every phone shows the podium. Needs crew sync plus the D1 database (step 4 below).

## Scoring

| | |
|---|---|
| Easy / Medium / Hard / Epic | 10 / 20 / 35 / 50 points |
| Location card | +10, and +5 more for checking in by GPS within 150 m of the spot |
| 🔥 Legendary (group decides) | +25% |
| Failed (tried, didn't work) | 0, no penalty |
| Reject | Free vetoes are used first (0–2 depending on the mode). After that: −half the card's value, and −5 more for each earlier paid rejection by you this game |
| Penance (offered sometimes) | A physical forfeit. Light halves the loss, heavy cuts it to a quarter. You can always just take the hit |

Who scores depends on the card: 👤 solo = the player on turn · 👥 duo = you plus a partner · 🙌 everyone = all players · ⚔️ versus = only the winner(s).

The constants are at the top of `js/rules.js` if you want to tune them.

## Hosting: GitHub Pages (the app) + Cloudflare (optional, for sync)

### 1. Put the app on GitHub Pages (free, about 5 minutes)

Use your **personal** GitHub account. GitHub Pages is free for public repos. Nothing secret is in this folder: the crew key lives only in Cloudflare and on your phones.

1. On github.com: **New repository**, name it `adventure-deck`, make it **Public**, and don't add a README.
2. In a terminal in this folder:

   ```bash
   git init -b main
   ```
   ```bash
   git add .
   ```
   ```bash
   git commit -m "Adventure Deck v2"
   ```
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/adventure-deck.git
   ```
   ```bash
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
4. After a minute the app is live at `https://YOUR-USERNAME.github.io/adventure-deck/`.

From then on, `git push` updates the app. **Bump the version in `js/version.js` with every release**: each time the app is opened or brought back from the background, it compares its version with the one on GitHub. If they differ it updates itself straight away, or shows an "Update now" banner if a game is running. Settings → App version also has a **Check for updates** button.

### 2. Install on the iPhone

Open the URL in **Safari → Share → Add to Home Screen**. Always open it from the icon. Home-screen apps keep their own storage, separate from Safari tabs, so the GPS permission and saved games live there.

At this point the game is fully playable on one phone. Each phone keeps its own players and records.

### 3. Optional: crew sync with a Cloudflare Worker (about 10 minutes)

This lets every friend's phone share players, crew cards, switched-off cards and finished games, so you get one shared leaderboard. It's the same setup we planned for Watchable: one Worker plus one KV namespace on the free plan. Use your personal Cloudflare account.

1. Sign up at dash.cloudflare.com (free).
2. **Storage & Databases → KV → Create namespace**, named `adventure-deck`.
3. **Workers & Pages → Create → Start from "Hello World"**, name it `adventure-deck` → **Deploy**.
4. Open the Worker → **Edit code** → replace everything with the contents of `worker/worker.js` → **Deploy**.
5. Worker → **Bindings → Add → KV namespace**: variable name `DECK`, pick the `adventure-deck` namespace.
6. Worker → **Settings → Variables and Secrets**:
   - **Secret** `CREW_KEY`: your **admin key**, a long random phrase. Keep it to yourself; friends get invite codes instead.
   - **Text** `ALLOWED_ORIGIN`: `https://YOUR-USERNAME.github.io` (no path, no trailing slash).
7. Put the Worker URL in `js/config.js` (`DEFAULT_SERVER`) and push. Phones then find the server by themselves.
8. On your own phone: **Settings → Crews → Crew owner settings** → paste the admin key → **Save**.

Sync happens automatically when the app opens, after a game ends and when cards or players change, and you can also press ⟳ Sync in Records or Settings.

### Crews and invites

Each crew has its own players, crew cards, switched-off cards, records and live games. A phone can be in several crews and switch between them in **Settings → Crews** (or tap the crew name on the Play screen). There is always a **📱 This phone only** crew that never syncs.

- **Create a crew** (owner only, needs the admin key): Settings → Crews → *Create a crew*. You get an invite code like `Q28SJ6X2-8629S4LQ4NELTJHMNRYV`.
- **Invite**: tap **✉️ Invite** next to a crew → **Share** (sends a message with the app link and the code) or **Copy**. Members can pass on the code they joined with.
- **Join**: friends open the app → Settings → Crews → *Join a crew* → paste the code. Each phone gets its own member pass; it never needs the admin key.
- **Leaked code?** The owner taps ✉️ Invite → **Replace invite code**. The old code stops working, and everyone already in the crew stays in.
- **The original crew** is called *Main crew*. Phones that used the crew key before 2.4 are moved into it automatically. The owner can make an invite for it like for any other crew.
- **Leave** removes a crew and its copy from this phone; the crew and its records stay on the server.
- **Delete** (owner only: 🗑 Delete next to the crew, or under "All crews on the server"): type the crew name to confirm. Its records and live games are erased from the server; members see "Deleted by the owner" and can leave it. The Main crew can't be deleted.
- Invite codes and member passes are stored on the server only as SHA-256 hashes.
- Switching crews isn't possible while a game is running.

**How records sync:** when a game ends it's saved and synced, and everyone's phone shows the same records.

**Players:**
- **Crew** players are one shared list that every phone can add to. Records are tied to the player, so renaming someone keeps their history.
- **⭐ This is me:** each phone picks its own player once (on the Play screen, or in Settings). It's then picked automatically, says "Your turn!" in live games, offers "Join as …" when you open a game you're not in, and is highlighted in the records. Only this phone knows; it isn't synced.
- **No duplicates:** before adding a crew player, the app pulls the latest list from the server. Exactly the same name reuses the existing player, and a similar one ("Raf" vs "Rafael", "Bjarek" vs "Bjarke") asks "Did you mean…?".
- **Guests** are for one game only: they play and score and appear in that game's history, but they never join the crew list, the leaderboard or the highscores.
- **Merge:** if a duplicate slips through anyway, Records → Players warns about it. Open the extra one → **Merge into…**. Their games, points and wins move over on every phone. Deleting a player hides them from the leaderboard and highscores (their games stay in History). Deleted players with games are listed under Records → Players, where you can restore them or merge their points into someone else.

Free-plan limits: KV allows 1,000 writes a day. The Worker only writes when something actually changed, so a crew uses a handful a day.

### 4. Optional: live games on every phone (about 3 minutes)

Games in progress are stored in a small D1 database (Cloudflare's SQLite). Unlike KV, D1 shows every change to every phone immediately.

1. **Storage & Databases → D1 SQL Database → Create**, named `adventure-deck-live`. The Worker creates the table itself; you don't need to run any SQL.
2. Worker → **Bindings → Add binding → D1 database**: variable name `GAMES`, pick `adventure-deck-live`.
3. Worker → **Edit code** → paste the latest `worker/worker.js` → **Deploy**.

To play: when starting a game, keep **📡 Share this game live** on. The code appears at the top of the screen (tap it to show it big). Others go to **Play → Join a live game** and enter it. You can also put an ongoing game live from the **⋯** menu.

- **Lobby first.** Starting a live game opens a lobby with the join code. Phones that join add their player (phones without ⭐ This is me pick who they are); the host can add crew players or guests, remove people, and taps ▶️ Start when everyone is in.
- **Your turn, your draw.** Only the phone of the player on turn can draw, take a nearby spot, skip or veto; the others see "Waiting for … to draw". A shared phone without ⭐ This is me can do everything.
- **A majority confirms results.** ✅ Done, 😅 Failed and 🏆 I won are claims. A majority of all players (guests excluded) decides, and the claim counts as the claimer's yes: with 3 players, one more yes is enough. Enough ❌ No votes send it back; the claimer can withdraw; after 2 minutes a claim with only ✅ votes can be accepted as it stands. Can be switched off at the start. **A veto is always instant.**
- Every move is sent to the server first. If the connection drops, the move fails with a message and nothing is lost: tap again when you have signal. The 📡 pill turns red while a phone has no connection.
- Photos stay on the phone that took them. GPS check-in uses the location of whoever presses it.
- **⋯ → Stop following on this phone** leaves the game; it carries on for the others. **Abandon** ends it for everyone.
- Live games untouched for 3 days are deleted automatically.
- Free plan: 4 phones checking every 2.5 s for 2 hours is about 12,000 reads, well within D1's 5 million a day.

## Editing content

- **Cards:** `js/data/cards.js` (field reference at the top). Or use the in-app card builder: those cards sync and don't need a code change.
- **Spots:** `js/data/places.js`. Coordinates were checked against OpenStreetMap; for long streets, big areas and gates the point is where the card happens. If one is off on a walk, fix it there.
- **Penances, bingo sounds, debate topics, tarot, stations:** `js/data/lists.js`.
- **Rules and modes:** `js/rules.js`.
- If you add or remove a file, update `SHELL` in `sw.js` and `APP_FILES` in `js/app.js`.

## Running locally

```bash
uv run serve.py
```

Then open http://127.0.0.1:8765. Tests (rules, deck data, the Worker merge logic) are at http://127.0.0.1:8765/tests/.

`uv run make_icons.py` redraws the icons.

## Privacy and safety notes

- Your GPS position never leaves the phone, with one exception: a crew card made with "My current spot" saves that spot's coordinates with the card (and syncs them).
- The wind tool asks Open-Meteo for the wind in central Copenhagen (fixed coordinates, not yours).
- Photos stay on the phone that took them and are not synced.
- Stranger cards are meant to be friendly. Take no for an answer. Drinks cards always allow a non-alcoholic version. Harbour swims only at official baths and beaches, in season.
