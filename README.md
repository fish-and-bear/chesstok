# Move Rush

A mobile-first chess puzzle feed for quick tactical reps. Scroll to skip, tap a
move to solve, reveal when you want practice, and keep going.

The interface is intentionally small: side to move, board, streak, solved count,
and four actions. Rank and quest text stay out of the main UI because the puzzle
should take the attention, not the app.

## Run Locally

```sh
npm run preview
```

Then open `http://127.0.0.1:8899/`.

You can also serve the folder with any static server.

## Check Before Deploying

```sh
npm run check
```

The release check validates syntax, JSON, PWA assets, security headers, puzzle
shard shape, cache versions, and obvious stale UI tokens.

## Deploy

This is a static site. Use this folder as the deploy root.

- Cloudflare Pages: no build command required, or use `npm run check`.
- Netlify: publish this folder. `_headers` sets security headers.
- Vercel: deploy this folder. `vercel.json` sets security headers.
- GitHub Pages: publish this folder. GitHub Pages will not apply `_headers`,
  but the app still includes a CSP meta tag.

See [DEPLOYMENT.md](DEPLOYMENT.md) for host notes.

## Data

The bundled `puzzles.js` shard contains 10,000 puzzles generated from the
Lichess puzzle database. Lichess publishes that database under CC0:
https://database.lichess.org/#puzzles

Each puzzle keeps the fields the app needs: `FEN`, `Moves`, `Rating`,
`Popularity`, `NbPlays`, `Themes`, and opening text. The board applies the first
UCI move before showing the position, matching the Lichess puzzle database rule.

To build a shard from an extracted `lichess_db_puzzle.csv`:

```sh
node tools/build-shard.mjs /path/to/lichess_db_puzzle.csv --limit 10000 --out puzzles.js
```

The builder can read `lichess_db_puzzle.csv.zst` directly when `fzstd` is
available:

```sh
pnpm add fzstd
node tools/build-shard.mjs /path/to/lichess_db_puzzle.csv.zst --limit 10000 --out puzzles.js
```

Useful filters:

```sh
node tools/build-shard.mjs /path/to/lichess_db_puzzle.csv --min-rating 900 --max-rating 1900 --min-popularity 80 --max-deviation 90 --limit 10000 --out puzzles.js
```

For the full database, generate rating-band shards and serve them from an API or
CDN. Loading every Lichess puzzle into one browser module would make the feed
slower than the puzzles.

## Storage And Fairness

Progress is stored locally in IndexedDB with a localStorage mirror. The snapshot
includes XP, streak data, favorite puzzle IDs, unique solved puzzle IDs, and the
last reel position.

The local app is hardened for casual tampering, but browser-only stats are not
authoritative. Saved puzzle IDs are validated against the bundled shard, visible
numbers are clamped to plausible values, revealed answers are practice-only, and
the page ships with a restrictive CSP. A real public leaderboard needs
server-side scoring because client-side code can always be changed by the person
running it.

## License

App code is MIT licensed. Puzzle data attribution and third-party license notes
are in [NOTICE](NOTICE).
