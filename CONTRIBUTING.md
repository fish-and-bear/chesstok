# Contributing

Keep the app fast, understandable, and low-friction.

Before opening a PR:

```sh
npm run check
```

Design rules:

- The first screen is the puzzle feed, not a landing page.
- Keep copy short. If a label needs explanation, remove it or make the state
  visible another way.
- Do not add accounts, tracking, or network calls without a clear reason.
- Keep repeated UI stable across 320px phones, landscape phones, and desktop.
- Do not turn hidden scoring mechanics into visible jargon.

Data rules:

- Keep puzzle data attribution in NOTICE.
- Do not commit the full Lichess database dump.
- Generated shards should be small enough to keep first load reasonable.
