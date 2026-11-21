# Thai-ji/token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Thai-ji/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Thai-ji/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for pre-token protocols. It reads the sealed snapshot, prices every protocol that has no token yet as if the market already paid it a comparable price, ranks 200 of them, and serves a static page that explains each score.

The price is comparables, not a guess: for each category the model takes the median market-cap-per-TVL of the live-token protocols already in that snapshot, then scales it by 7-day growth, age and chain count. The 24 live-token protocols stay in a separate view as the market's own values and never enter the ranking. Nothing is hand-picked, and the page recomputes every row from the same formula in the browser, so a wrong number would show up as a mismatch.

## What you get

- `out/board.json`: 200 ranked rows, each with the implied value, every multiplier and a seven-step farm plan with its cost and time.
- `out/dashboard/`: the page (index.html, app.css, app.js), no framework, no network, sortable and filterable, with a detail view and an honest methodology panel.
- `out/screenshots/`: the board, a detail view, a filtered view and the method panel.
- `out/dossier.json`: the summary the judge reads.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18 or later, standard library only.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
