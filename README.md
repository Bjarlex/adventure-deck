# Copenhagen Adventure Deck

A challenge card game for walking around Copenhagen with friends. Install it on your phone's home screen. It works offline, and it can share players, highscores and your own cards between your phones.

Version 2.1. The original Koder version is in `v1-original/`.

## What's in it

- **162 cards**: the 18 originals (merged and fixed) plus about 140 new ones. 40 of them are **location cards** tied to Copenhagen spots, and they are only dealt when you're within range (500–1000 m, set in Settings).
- **Players, points and turns**: a scoreboard, a podium and awards at the end (🎯 Closer, 🐔 Chicken, 🦾 Iron, 🧭 Explorer, 🔥 Legend).
- **Rejections and penances**: see Scoring below.
- **8 game modes**: Classic, Quick walk, Explorer, Bar crawl, Sweat, Chill, Crew cards, and Custom (pick tags, length, difficulty and rules yourself).
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

From then on, `git push` updates the app. Phones pick up the new version the next time the app is opened (it loads from cache first and refreshes in the background, so occasionally it takes two launches).

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
   - **Secret** `CREW_KEY`: a long random phrase you share with your friends (for example four random words).
   - **Text** `ALLOWED_ORIGIN`: `https://YOUR-USERNAME.github.io` (no path, no trailing slash).
7. In the app on each phone: **Settings → Crew sync** → server URL `https://adventure-deck.YOUR-SUBDOMAIN.workers.dev`, enter the crew key → **Save & sync**.

Sync happens automatically when the app opens, after a game ends and when cards or players change, and you can also press ⟳ Sync in Records.

**How records sync:** when a game ends it's saved and synced, and everyone's phone shows the same records. Create players on one phone and sync before the others add them, otherwise you get two "Rafael"s.

Free-plan limits: KV allows 1,000 writes a day. The Worker only writes when something actually changed, so a crew uses a handful a day.

### 4. Optional: live games on every phone (about 3 minutes)

Games in progress are stored in a small D1 database (Cloudflare's SQLite). Unlike KV, D1 shows every change to every phone immediately.

1. **Storage & Databases → D1 SQL Database → Create**, named `adventure-deck-live`. The Worker creates the table itself; you don't need to run any SQL.
2. Worker → **Bindings → Add binding → D1 database**: variable name `GAMES`, pick `adventure-deck-live`.
3. Worker → **Edit code** → paste the latest `worker/worker.js` → **Deploy**.

To play: when starting a game, keep **📡 Share this game live** on. The code appears at the top of the screen (tap it to show it big). Others go to **Play → Join a live game** and enter it. You can also put an ongoing game live from the **⋯** menu.

- Every move is sent to the server first. If the connection drops, the move fails with a message and nothing is lost: tap again when you have signal. The 📡 pill turns red while a phone has no connection.
- Photos stay on the phone that took them. GPS check-in uses the location of whoever presses it.
- **⋯ → Stop following on this phone** leaves the game; it carries on for the others. **Abandon** ends it for everyone.
- Live games untouched for 3 days are deleted automatically.
- Free plan: 4 phones checking every 2.5 s for 2 hours is about 12,000 reads, well within D1's 5 million a day.

## Editing content

- **Cards:** `js/data/cards.js` (field reference at the top). Or use the in-app card builder: those cards sync and don't need a code change.
- **Spots:** `js/data/places.js`. Coordinates are approximate (about ±50 m), which is fine for a 500–1000 m radius. Fix any that are off.
- **Penances, bingo sounds, debate topics, tarot, stations:** `js/data/lists.js`.
- **Rules and modes:** `js/rules.js`.
- After changing the list of files, bump `CACHE` in `sw.js`.

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
