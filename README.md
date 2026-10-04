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

- **Learn** (`/learn.html`) — Meme 101 foundations, 202A Snipe, and 202B Swing. Each applied track has eight short chapters with three checks, an illustrative example, an evidence handoff, and optional deeper context. The Snipe and Swing tools link back to their courses.
- **Model** (`/model`) — visual research workflow, data coverage, order-flow reading guide, and signal limits
- **Tweet** — incoming public-news signals and active Solana, Base, and Robinhood Chain pools
- **Snipe** — Starter screening for pool timing, market age, flow, and order-size pressure; Discover and Explore views for stage and story context
- **Swing** — Swing and Longer-term research rankings with input coverage and explanations
- **Narrative research** — evidence trail, lifecycle context, and associated tokens
- **Order Flow** — observed swap flow, sizing, timeline, and transaction details
- **Watchlist** — browser-local saved narratives and tokens
- **Sources** — current feed coverage and a planned X-account collector watchlist; X RSS mentions are shown on Tweet and Swing
- **Coin vs Social** (`/jeanphil.html`) — a standalone Jean Phil experiment plotting sampled social Warmth against JEANPHIL price on one timeline

Learning pages follow Definition → Why it matters → What to check → Healthy / Dangerous → Beginner mistake → Takeaway. Meme 101 source lessons and guidance live in `content/meme-101/`. The original 202 outlines and condensed course content live in `content/meme-202/`. Regenerate all courses and the hub with `py scripts/render-meme-202.py`, then `node scripts/render-shared-pages.mjs` (also run by the Worker build). Tool links explain the evidence available and do not imply verification of wallet identity, cost basis, contract permissions, or execution capacity. The original `/meme-101.html` and lesson URLs remain available.

Inspect's **5D** view fetches historical 15-minute OHLCV candles for one listing's most liquid discovered pool. The historical chart preserves candle high/low ranges, and MC Detail keeps the standard MC Tier / Net / Buy / Sell / Read layout and metric selector. In Total Value mode, the Net column becomes Total and shows estimated total volume assigned by each candle's closing market-cap tier; unavailable directional values, trade counts and per-swap averages stay unknown. A wick-only tier has unknown volume allocation, not zero trading. Market cap is estimated from the latest reported MC/price ratio, assuming unchanged supply. Only completed candles inside the rolling five-day window are used; provider gaps and other pools are not covered. Candles have no buy/sell split or trade count, so the existing buy/sell summaries and observed swap table remain a separate bounded sample. History uses one capped 1,000-candle request, cached for five minutes, and requires no new API key.

## Jean Phil monitor

`/jeanphil.html` follows the exact Solana contract `GTBxUiw6wJdmmkCGZgRHLyYxqu1vG4KtRpeox6yDpump`. A dedicated Modal function samples the most liquid exact-contract DexScreener pool every five minutes and Google News RSS indexed X posts every 30 minutes. The 14-day monitor history is stored separately on the persistent Volume, so it continues collecting without page visits. Local preview stores the same report at `.data/jeanphil-monitor.json`. History begins when the collector first runs; it cannot reconstruct earlier social engagement.

Warmth is a provisional 0–100 saturation curve of indexed posts whose visible titles explicitly mention Jean Phil or Jean Philanthrope in the preceding two hours. Coin-only mentions are counted separately. The page shows the underlying posts and sample times. RSS coverage is incomplete and may lag; there are no X likes, reposts, views, unique-account measures, or Instagram engagement in this score. Failed feeds preserve earlier samples and report collection issues rather than recording false zeroes.

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

## Followed wallets

`/admin.html` shows the tracked-wallet registry, class legend, check status, check/attempt times, and last observed positive token-balance count, with name/address search and class filtering. An invisible footer link after Terms opens it; the link has no visible text or hover effect. It has no sitemap entry and requests no indexing. It is an unlisted page without login protection. Add wallet saves a name, validated Solana address and class to the durable Modal tracked-wallet registry; duplicate addresses are rejected. Added wallets survive deployments and join the next scheduled holdings collection. Refresh status reads the shared report; scheduled holdings collection still runs every five minutes.

Snipe cards and Swing’s holder column show compact class icons for positive Solana token balances held by the addresses in `worker/followed-wallets.json`. F1/F2 mean Finder class 1/2, C1/C2 Clipper fast/slow, N1/N2 Nurture slow/fast, L1 Long holder, and Dev Developer. Names and classes are user-assigned; they do not establish identity or prove token creation. Hover or tap a badge to see matching wallets and check times. The expandable Followed wallets line lists coverage and the class legend.

`collect_followed_wallets` samples both SPL Token and Token-2022 accounts every five minutes with confirmed commitment, using Solana `getTokenAccountsByOwner`. Cards match exact mint addresses. Failed checks retain the last complete holdings as stale; successful empty checks clear them. Samples older than ten minutes are stale. No badge is inconclusive when coverage is incomplete. This is a balance snapshot, not a buy/sell alert, and may include dust or unsolicited tokens. The collector defaults to the public mainnet RPC; `SOLANA_WALLET_RPC_URL` can select a dedicated endpoint in the collector environment. Local preview samples independently when collection is enabled; manually run `py worker/followed_wallets.py .data/followed-wallets.json` when disabled. `/api/followed-wallets` serves the shared sampled report.

## Trust and freshness

The collector refreshes up to 1,800 retained contracts per run alongside discovery: saved refresh interests first (up to 300), then the Swing universe, recent discoveries, and older contracts rotated by last refresh attempt. Saving a supported token or opening Snipe, Swing, or Watchlist requests 24-hour refresh priority for contracts already in the retained sample. This sends contract IDs only; the watchlist itself remains browser-local. Unknown contracts use manual lookup and are not silently added to scheduled collection. The shared priority queue does not guarantee a fresh provider response.

Provider requests are paced and start their timeout after leaving the queue. A rate-limited request waits for the provider cooldown and retries once when the collection budget allows; longer cooldowns preserve the last snapshot and survive collection runs. Discovery covers the first new-pool page of every chain, then checks launchpad progress for up to 200 retained and newly discovered contracts before dedicated Pump.fun/Meteora DBC discovery, trending feeds, tracked/indexed Robinhood pools and deeper pages can consume the provider budget. New pairs receive the first 80 of 120 check slots, followed by up to 20 known Final Stretch coins and an oldest-checked rotation for the remaining slots. Up to 80 additional check slots cover retained active launchpad pools and up to 30 saved refresh interests, ordered by pool liquidity; this does not assign graduation status. New dedicated-pool discoveries enter the following scheduled graduation pass. Pump.fun page one is checked every run, and pages 2–9 rotate over two runs; Meteora DBC page one is checked every run. Active launchpad pools can enter discovery even when older than 36 hours. Token checks include exact-token top pools so current curve liquidity comes from pool reserves instead of an absent Dexscreener field. These jobs run on the five-minute Modal schedule independently of page visits. Missing graduation coverage is shown as unavailable rather than a measured absence of Final Stretch coins. Retained market refresh proceeds independently; context has a separate bounded time window. A bounded request/time budget preserves retained snapshots when providers are unavailable. The Robinhood indexer runs alongside market collection, using its last atomic export for this run. Freshness is measured per token, separately from the collection timestamp: Snipe uses six minutes and Swing/Watchlist use fifteen. Missing current liquidity or volume stays unknown. Swing withholds displayed research scores for stale or incomplete market data.

Snipe classifies launch lifecycle before price patterns: measured progress below 80% is New Pairs; 80% or above without confirmed completion is Final Stretch; provider-confirmed completion is Graduated. Axiom’s public Pulse guide describes near-completion without specifying a threshold, so 80% remains an explicit Meme Fast rule. The left column stacks Final Stretch above Fresh Pairs. The middle Observed recovery column retains 45m A rebound / B continuation, later recovery, and confirmed graduations under observation. Recovery is an independent view: qualifying coins can appear there and in their launch-stage section, so a recovery never removes a coin from Final Stretch. The right Pool activity column separates confirmed graduation from volume-only evidence. Unknown graduation status and volume-only candidates are listed separately. Final Stretch spans the retained five-day sample, independently of the selected discovery window; Fresh Pairs keeps that window. The compact screener has Common, New Pairs, Recovery, and Graduation tabs. Common minimums and chain apply to Discover and Explore; each column tab adds its own 24h volume, liquidity, 5m volume, and transaction minimums in Discover. Every tab also includes minimum and maximum pool age in seconds and a lifetime pool transaction minimum. Lifetime transactions use reported 24h buys plus sells only for pools younger than 24 hours, whose lifetime fits inside that window; counts for older pools or missing data stay unavailable and fail a positive minimum. Zero disables an age limit or lifetime minimum. New Pairs defaults to a maximum pool age of 108,000 seconds (30 hours); existing settings without an age cap receive this default, while an explicitly saved zero stays off. Settings tabs show the number of active criteria, such as New Pairs (1). Zero disables an extra minimum. New Pairs settings also cover Final Stretch and unknown-status rows; Graduation settings cover confirmed graduations and volume-only rows. Recovery settings apply independently, preserving coins in other qualifying columns. Settings persist in this browser. Observed recovery describes a historical pattern. The drawdown/rapid-rise filter is a price-pattern filter, not a contract-safety test. Existing `radar.html` links and saved `radar` items continue to work under the Swing name.

For isolated UI checks, `PORT=4182` selects another preview port and `MEME_COLLECTOR_DISABLED=1` serves existing `.data` snapshots without starting collection.

## Shared Market Delta

The shared header displays a 1-hour Meme Delta and broad-alt Delta around zero. `collect_meme_index` samples them every five minutes on the persistent Volume, and `/api/meme-index` serves the public readings. Meme Delta is the equal-weight mean of one batched DexScreener request's 1-hour price changes for the 10 liquid exact-contract FOMO Most Held constituents. Alt Delta is the market-cap-weighted 1-hour change of the 25 largest eligible non-BTC/non-ETH altcoins from one bounded CoinLore top-50 request. Stablecoins and wrapped assets are excluded. The first complete reading is immediately displayable; later readings build the chart. Missing one-hour changes withhold a reading rather than becoming zero.

Only the collector receives the `meme-fast-fomolist` Modal secret (`FOMO_KEY`). FOMO Most Held is read at most once every 72 hours, including failed attempts; price sampling and page visits never call it. The initial authenticated September 29 leaderboard response is saved as a seed to avoid another FOMO read at startup. Every three days the collector freezes 10 eligible exact contracts and saves a membership snapshot. The separately stored compounded Meme Index starts at 100, retains its level across rebalances, and begins at collection without historical backfill.

Routine market sampling uses one batched meme request and one bounded alt request every five minutes. The chart compares reported 1-hour changes sampled at each collection, so it does not claim a continuous trade tape. Local preview reads `.data/meme-index.json`; run `py worker/meme_index.py .data/meme-index.json` explicitly to sample locally (future rebalances require local `FOMO_KEY`).
