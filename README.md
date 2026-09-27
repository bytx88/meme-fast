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
- **Snipe** — Starter screening for pool timing, market age, flow, and order-size pressure; Discover and Explore views for stage and story context
- **Swing** — Swing and Longer-term research rankings with input coverage and explanations
- **Narrative research** — evidence trail, lifecycle context, and associated tokens
- **Order Flow** — observed swap flow, sizing, timeline, and transaction details
- **Watchlist** — browser-local saved narratives and tokens
- **Sources** — current feed coverage and a planned X-account collector watchlist; X RSS mentions are shown on Tweet and Swing

## X social signal

Tweet and Swing show an **X RSS** badge for each sampled contract. It counts x.com posts indexed by Google News RSS in the current six hours and shows the change versus the previous six hours. The inspector links to indexed items. A zero means none appeared in this RSS sample; it does not mean there were no X posts. The count does not include likes, reposts, author diversity, or a 0–100 X Factor score, and it does not affect market rankings.

The collector in [x_rss_collector.py](worker/x_rss_collector.py) queries the exact contract and up to three configured aliases in a 12-hour RSS window. It deduplicates items, requires an x.com source, and withholds a target when a query reaches the 100-item result cap. It prioritizes [e/acc, PAID, and XLINK](x-factor-targets.json), then high-buyer market coins. e/acc uses its exact contract because the name also describes a broader movement; PAID adds UsePaid, and XLINK adds its project domain and handle. These aliases require manual contract association.

`/api/x-factor` reads `/history/x-factor.json` on Modal or `.data/x-factor.json` locally. Its RSS report is marked `source: google-news-rss`. Modal refreshes the three priority targets every 30 minutes, and badges become stale after 45 minutes. Run `collect_x_factor` manually on Modal or `py worker/x_rss_collector.py .data/coins.json .data/x-factor.json x-factor-targets.json` locally. The deployed RSS collector needs no X API key.

The earlier [XFlux](https://www.xfluxapi.com/docs/api) collector remains in [x-factor-collector.mjs](worker/x-factor-collector.mjs) for manual experiments. Its initial live pilot returned matching posts without author identities, so the account-diversity score was withheld. The paid official X collector also remains an explicit local option. Neither is used by the deployed RSS function.

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

## Trust and freshness

The collector refreshes up to 1,800 retained contracts per run before discovery: saved refresh interests first (up to 300), then the Swing universe, recent discoveries, and older contracts rotated by last refresh attempt. Saving a supported token or opening Snipe, Swing, or Watchlist requests 24-hour refresh priority for contracts already in the retained sample. This sends contract IDs only; the watchlist itself remains browser-local. Unknown contracts use manual lookup and are not silently added to scheduled collection. The shared priority queue does not guarantee a fresh provider response.

Provider requests are paced, stop during rate-limit cooldowns, and start their timeout after leaving the queue. Cooldowns survive collection runs. A bounded request/time budget preserves retained snapshots when providers are unavailable. The Robinhood indexer runs alongside market collection, using its last atomic export for this run. Freshness is measured per token, separately from the collection timestamp: Snipe uses six minutes and Swing/Watchlist use fifteen. Missing current liquidity or volume stays unknown. Swing withholds displayed research scores for stale or incomplete market data.

Snipe separates confirmed launchpad completion from volume-only candidates. Observed recovery describes a historical pattern. The drawdown/rapid-rise filter is a price-pattern filter, not a contract-safety test. Existing `radar.html` links and saved `radar` items continue to work under the Swing name.

For isolated UI checks, `PORT=4182` selects another preview port and `MEME_COLLECTOR_DISABLED=1` serves existing `.data` snapshots without starting collection.
