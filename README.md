# Meme Fast

Meme Fast connects emerging crypto narratives with observed token activity. Its research flow moves from public-source discovery to narrative evidence, exact contract associations, and recent swap analysis.

## Run locally

Requires Node.js 20 or newer.

```sh
node preview.mjs
```

Open `http://127.0.0.1:4173/narratives.html`.

## Product areas

- **Radar** — incoming public-news signals and active Solana/Base pools
- **Narrative research** — evidence trail, lifecycle context, and associated tokens
- **Token research** — observed swap flow, sizing, timeline, and transaction details
- **Watchlist** — browser-local saved narratives and tokens
- **Sources** — current feed coverage and a planned X-account collector watchlist

The current app uses public data providers and browser storage. See [ARCHITECTURE.md](ARCHITECTURE.md) for the application boundary and proposed persistent data model.

## Validate and build

```sh
node --test
node scripts/build-worker.mjs
```

The build script packages the static application and market-data proxy as a deployable Worker bundle under `dist/server/`.

## Deploy to Modal

```sh
py -m modal deploy modal_app.py
```

The Modal app is named `meme-fast`; its `web` function serves the frontend and the restricted GeckoTerminal proxy.
