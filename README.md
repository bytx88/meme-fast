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
- **Snipe** — Entry screening for pool timing, market age, flow, and order-size pressure; Discover and Explore views for stage and story context
- **Hodl** — Swing and Longer-term research rankings with input coverage and explanations
- **Narrative research** — evidence trail, lifecycle context, and associated tokens
- **Order Flow** — observed swap flow, sizing, timeline, and transaction details
- **Watchlist** — browser-local saved narratives and tokens
- **Sources** — current feed coverage and a planned X-account collector watchlist

## X Factor

Tweet shows a contract-level X Factor badge beside each Top Coins lifecycle tag. Hodl shows the same badge and an evidence section in its inspector. Both read `/api/x-factor` and withhold scores when a sample is over 30 minutes old. X Factor does not change either market ranking.

The collector uses [X recent search](https://docs.x.com/x-api/posts/search-recent-posts) every 15 minutes on Modal. It selects up to eight coins, prioritizing configured targets in [x-factor-targets.json](x-factor-targets.json), then the highest buyer counts in the saved market snapshot. Automatic targets search their exact contract address. Configured targets may add up to three aliases and ten creator/project handles; aliases must be manually associated with the correct contract. Its 12-hour search supports current and previous six-hour windows. A score uses unique accounts, posts, capped engagement, and, when configured, posts by key handles. `delta6h` is the change in score points between the windows. If a search is incomplete or fails, its score is withheld. The score is an experimental observation, not a return forecast or proof of organic activity.

The current priority mappings are the [e/acc contract and recipient](https://usepaid.app/token/CbcyNo7m1amFWqEQm2m4PLv1UNvpcL3C1Ujm6AkzpKoU), the [PAID contract and product](https://userpaid.app/), and the [XLINK project and XL contract](https://xl.money/). e/acc remains exact-contract coverage because the name also refers to a wider movement. PAID adds the distinct UsePaid product name; XL adds its project domain and handle. These mappings establish identity for X sampling, not a claim that every project mention concerns the token.

The endpoint reads `.data/x-factor.json` in local preview or `/history/x-factor.json` on Modal. The report uses coin keys such as `solana:<contract>` and contains a 0–100 score, score-point change over six hours, unique accounts, posts, key interactions, sample time, matching coverage, and linked post evidence. A missing X token yields `disconnected`; the UI shows an unavailable badge instead of a fabricated number.

To enable the live collector, set the `X_BEARER_TOKEN` key in the Modal secret `meme-fast-x-api` and redeploy `modal_app.py` with the `bytx24` profile. Local collection can be run explicitly with `X_BEARER_TOKEN` set: `node worker/x-factor-collector.mjs .data/coins.json .data/x-factor.json x-factor-targets.json`. Recent search is a paid X API operation. The collector limits each run to eight targets and three pages per target; adjust those caps only after checking usage and coverage.

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
