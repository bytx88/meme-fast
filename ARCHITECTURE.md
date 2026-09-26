# Meme Fast application skeleton

Meme Fast is organized around an evidence path:

`source → observation → narrative ↔ token → market observation`

## Product surfaces

- **Tweet** (`dist/narratives.html`) discovers changing narratives and active tokens.
- **Snipe** (`dist/index.html`, also `dist/new-coins.html`) collects fresh pools into an investigation queue and promotes only exact-address evidence matches.
- **Hodl** (`dist/radar.html`) ranks a separate universe of contracts retained by Snipe and discovered pools for swing and longer-term research. Its heuristic scores expose missing inputs and stale observations.
- **Narrative research** (`dist/narrative.html`) explains a story through evidence, lifecycle state, and exact-address token associations.
- **Order Flow** (`dist/order-flow.html`) investigates recent swap flow for a contract or a set of listings.
- **Watchlist** (`dist/watchlist.html`) keeps a personal queue of narratives and tokens.
- **Sources** (`dist/sources.html`) makes collection coverage and planned source accounts explicit.

Snipe uses a shared server history: a scheduled Modal function collects every five minutes, independently of page visits. One JSON snapshot on the persistent `meme-fast-coin-history` Volume stores each chain/contract, first-seen timestamp, latest returned market snapshot, and context. Every run discovers fresh pools, batch-refreshes retained contracts for current liquidity and 5-minute activity, then writes atomically; readers reload the Volume and GET `/api/new-coins`. Records expire five days after first discovery, regardless of repeat sightings. Feed failures preserve saved records and report degraded coverage. Context lookups are bounded to four pending coins per run, with six-hour retries. History starts at deployment; there is no backfill.

Hodl uses that same snapshot but has a separate `radarCoins` ranking sample capped at 200 contracts per chain. It includes retained Snipe contracts, new and trending pools on Solana, Base, and Robinhood Chain, and top pools on Solana and Robinhood Chain. Successful market refreshes retain up to four hours of five-minute samples and five days of hourly samples per coin. A missing provider refresh adds no sample. The longer-term view ranks research attention only; holder, developer, contract, and execution risk remain outside the available data.

Robinhood Chain is a shared source for Snipe, Hodl, contract search, and Order Flow. A separate SQLite catalog (`robinhood-pools.sqlite`) indexes Uniswap v2 `PairCreated`, v3 `PoolCreated`, and v4 `Initialize` events through Robinhood's public RPC with persistent live and historical cursors. Each scheduled run exports a bounded `robinhood-pool-feed.json` for market enrichment through GeckoTerminal. `/api/pool-catalog?query=<contract-or-pool>` finds exact onchain pool evidence even when a token is outside the Hodl ranking sample. The catalog only claims coverage for its configured event sources; other DEX protocols and historical backfill remain explicit coverage gaps until indexed. Pool existence does not imply active liquidity or a reliable market quote.

Other research surfaces still use browser storage as an adapter. The local preview runs the same collector while its Node server is running, storing `.data/coins.json`. The standalone Worker bundle does not provide this scheduled history backend; production Snipe is served by Modal.

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
- `/?query=<contract-or-ticker>` — token research
- `/watchlist.html` — saved research
- `/sources.html` — coverage configuration

These browser-safe URLs can later map directly to server routes without changing the user flow.
