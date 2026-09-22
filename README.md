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

## Update GitHub and Modal on Windows

Double-click `update-github-and-modal.bat`. It validates the app, commits all non-ignored project changes on `main`, pushes `origin` to `bytx88/meme-fast`, and then deploys `modal_app.py` using the `bytx24` Modal profile. A failed check or push stops deployment; a failed Modal deployment leaves the successful GitHub push intact. It never force-pushes or changes your global Modal profile.

Requires Git, Node.js 20+, Python 3.11+, the Modal Python package, GitHub push access, and valid credentials in your `bytx24` Modal profile. The file runs from its own folder, so paths containing spaces work.

Run `update-github-and-modal.bat --check` for local validation without committing, pushing, or deploying. This checks that the Modal profile is present, but does not verify its online credentials. Optionally pass `--message "Your commit message"` when publishing.
