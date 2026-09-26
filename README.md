# Meme Fast

Meme Fast connects emerging crypto narratives with observed token activity. Its research flow moves from public-source discovery to narrative evidence, exact contract associations, and recent swap analysis.

## Run locally

Requires Node.js 20 or newer. Robinhood pool indexing also uses Python with `httpx` and, on Windows, `truststore`.

```sh
py -m pip install httpx truststore
node preview.mjs
```

Open `http://127.0.0.1:4173/narratives.html`.
The local preview indexes Robinhood pools into `.data/robinhood-pools.sqlite` on each collection run. The public RPC is rate limited, so historical coverage builds gradually. Set `ROBINHOOD_RPC_URL` to a suitable archive endpoint when available to accelerate backfill.

## Product areas

- **Tweet** — incoming public-news signals and active Solana, Base, and Robinhood Chain pools
- **Snipe** — freshly discovered pools with evidence status and a research handoff
- **Hodl** — Swing and Longer-term research rankings with input coverage and explanations
- **Narrative research** — evidence trail, lifecycle context, and associated tokens
- **Order Flow** — observed swap flow, sizing, timeline, and transaction details
- **Watchlist** — browser-local saved narratives and tokens
- **Sources** — current feed coverage and a planned X-account collector watchlist

The current app uses public data providers and browser storage. See [ARCHITECTURE.md](ARCHITECTURE.md) for the application boundary and proposed persistent data model.

## Validate and build

```sh
node --test
py -m unittest discover -s test -p "test_*.py"
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
