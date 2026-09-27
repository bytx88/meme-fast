# Meme Fast application skeleton

Meme Fast is organized around an evidence path:

`source → observation → narrative ↔ token → market observation`

## Product surfaces

- **Tweet** (`dist/narratives.html`) discovers changing narratives and active tokens.
- **Snipe** (`dist/index.html`, also `dist/new-coins.html`) collects fresh pools into an investigation queue and promotes only exact-address evidence matches.
- **Swing** (`dist/radar.html`) ranks a separate universe of contracts retained by Snipe and discovered pools for swing and longer-term research. Its heuristic scores expose missing inputs and stale observations.
- **Narrative research** (`dist/narrative.html`) explains a story through evidence, lifecycle state, and exact-address token associations.
- **Order Flow** (`dist/order-flow.html`) investigates recent swap flow for a contract or a set of listings.
- **Watchlist** (`dist/watchlist.html`) keeps a personal queue of narratives and tokens.
- **Sources** (`dist/sources.html`) makes collection coverage and planned source accounts explicit.

Snipe uses a shared server history: a scheduled Modal function collects every five minutes, independently of page visits. One JSON snapshot on the persistent `meme-fast-coin-history` Volume stores each chain/contract, first-seen timestamp, latest returned market snapshot, and context. Every run discovers fresh pools, batch-refreshes retained contracts for current liquidity and 5-minute activity, then writes atomically; readers reload the Volume and GET `/api/new-coins`. Records expire five days after first discovery, regardless of repeat sightings. Feed failures preserve saved records and report degraded coverage. Context lookups are bounded to four pending coins per run, with six-hour retries. History starts at deployment; there is no backfill.

The Snipe Entry view screens pool age, discovery delay, market sample age, five-minute buys and sells, liquidity, and proposed order size as a share of displayed liquidity. Its API projection includes only the latest two five-minute market samples for a change comparison. These are overlapping windows from the scheduled collector. Entry screen passes are not executable quotes, price-impact estimates, sell simulations, or contract-risk verification; those checks require dedicated live integrations. The five-minute collection cadence does not support seconds-level pool sniping.

The collector has discovery, market enrichment, and context enrichment stages. It saves discovery and market results before slower context work, then saves a second revision. Each snapshot includes `pipeline` stage status, `feeds` with last attempt, last success, error, and record counts, plus `coverage` with those source states and sampling limits. Partial batches report their current returned count separately from the last complete count. `coins.version.json` is a small revision sidecar. `/api/new-coins/version` reads it for polling; clients fetch `/api/new-coins?view=coin` only when the revision changes. Local preview and Modal project the same `coin`, `radar`, and `watchlist` response shapes. The JavaScript and Python projection modules are kept in parity by tests.

Swing uses that same snapshot but has a separate `radarCoins` ranking sample capped at 200 contracts per chain. It includes retained Snipe contracts, new and trending pools on Solana, Base, and Robinhood Chain, and top pools on Solana and Robinhood Chain. Successful market refreshes retain up to four hours of five-minute samples and five days of hourly samples per coin. A missing provider refresh adds no sample. The longer-term view ranks research attention only; holder, developer, contract, and execution risk remain outside the available data.

Robinhood Chain is a shared source for Snipe, Swing, contract search, and Order Flow. A separate SQLite catalog (`robinhood-pools.sqlite`) indexes Uniswap v2 `PairCreated`, v3 `PoolCreated`, and v4 `Initialize` events through Robinhood's public RPC with persistent live and historical cursors. Each scheduled run exports a bounded `robinhood-pool-feed.json` for market enrichment through GeckoTerminal. `/api/pool-catalog?query=<contract-or-pool>` finds exact onchain pool evidence even when a token is outside the Swing ranking sample. The catalog only claims coverage for its configured event sources; other DEX protocols and historical backfill remain explicit coverage gaps until indexed. Pool existence does not imply active liquidity or a reliable market quote.

Other research surfaces still use browser storage as an adapter. The local preview runs the same collector while its Node server is running, storing `.data/coins.json`. The standalone Worker bundle does not provide this scheduled history backend; production Snipe is served by Modal.

Order Flow uses live provider data through a restricted market proxy. Local preview and Modal both cache successful responses, combine concurrent requests for the same path, and honor provider rate-limit cooldowns. The cache is process-local, so different Modal containers do not share entries. Its reported flow is a bounded sample, with pool and swap limits included in the read summary.

## Backend boundary

The next implementation should replace browser storage with one application API and a relational database. Suggested core records:

- `sources`: publisher, account, category, weight, collection state
- `observations`: immutable source item, source ID, observed/published times, normalized text, URL
- `narratives`: stable identity, title, summary, lifecycle state and timestamps
- `narrative_observations`: evidence membership and clustering confidence
- `tokens`: chain plus contract as the identity, symbol and metadata as mutable attributes
- `narrative_tokens`: association type, evidence, confidence, first and last observed times
- `market_observations`: timestamped pool and flow measurements with provider coverage
- `watchlists` and `watchlist_items`: account-owned research state
- `change_events`: material changes derived from new observations for alert delivery

Collectors append observations; clustering and association jobs update derived records; the web API reads those records. Lifecycle and token associations must retain the observations that support them.

## URL contract

- `/narratives.html` — discovery
- `/narrative.html?id=<narrative-id>` — narrative research
- `/new-coins.html` — newly discovered pools and story evidence status
- `/radar.html` — horizon-specific attention rankings for retained coins
- `/?contract=<contract-address>` — token research
- `/watchlist.html` — saved research
- `/sources.html` — coverage configuration

These browser-safe URLs can later map directly to server routes without changing the user flow.

## Collection priority and backpressure

`worker/provider-fetch.mjs` serializes requests per provider, paces dispatch, honors HTTP 429 Retry-After (with a one-minute minimum), persists cooldown timestamps in the snapshot, and starts network deadlines at dispatch. The collector has a 210-second request budget. The retained market refresh precedes discovery and is capped at 1,800 contracts; failed/skipped targets retain their old market timestamp, while last-attempt timestamps rotate the remainder of the retained universe.

`POST /api/refresh-priority` accepts 1-30 validated Solana/Base/Robinhood contract IDs per request and only registers contracts already in the snapshot. Modal stores contract-to-request-time entries in the separate `meme-fast-refresh-priorities` Dict, avoiding concurrent writers to the market snapshot Volume. Entries expire after 24 hours; collection considers the newest 300. Local preview uses `.data/refresh-priorities.json`. This is a shared refresh-interest queue, not account storage or persistent watchlists. No user names, notes, or positions are submitted. Collection consumes the queue and refreshes existing records; it does not execute trades.

The legacy `/new-coins.html` route serves the same Snipe interface as `/`. Swing continues to use `/radar.html` and existing browser storage identities, preserving bookmarks and saved items.
