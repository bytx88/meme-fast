# Meme Fast application skeleton

Meme Fast is organized around an evidence path:

`source → observation → narrative ↔ token → market observation`

## Product surfaces

- **Radar** (`dist/narratives.html`) discovers changing narratives and active tokens.
- **New coins** (`dist/new-coins.html`) collects fresh pools into an investigation queue and promotes only exact-address evidence matches.
- **Radar** (`dist/radar.html`) ranks a separate universe of retained Coin contracts and GeckoTerminal trending contracts for scalp, swing, and longer-term research. Its heuristic scores expose missing inputs and stale observations.
- **Narrative research** (`dist/narrative.html`) explains a story through evidence, lifecycle state, and exact-address token associations.
- **Token research** (`dist/index.html`) investigates recent swap flow for a contract or a set of listings.
- **Watchlist** (`dist/watchlist.html`) keeps a personal queue of narratives and tokens.
- **Sources** (`dist/sources.html`) makes collection coverage and planned source accounts explicit.

New Coins uses a shared server history: a scheduled Modal function collects every five minutes, independently of page visits. One JSON snapshot on the persistent `meme-fast-coin-history` Volume stores each chain/contract, first-seen timestamp, latest returned market snapshot, and context. Every run discovers fresh pools, batch-refreshes retained contracts for current liquidity and 5-minute activity, then writes atomically; readers reload the Volume and GET `/api/new-coins`. Records expire five days after first discovery, regardless of repeat sightings. Feed failures preserve saved records and report degraded coverage. Context lookups are bounded to four pending coins per run, with six-hour retries. History starts at deployment; there is no backfill.

Radar uses that same snapshot but has a separate `radarCoins` collection capped at 200 contracts. The collector includes retained Coin contracts, trending pools from Solana, Base, and Robinhood Chain, and explicitly tracked contracts such as CASHED. Coin's Solana and Base new-pool criteria are unchanged. Successful market refreshes retain up to four hours of five-minute samples and five days of hourly samples per coin. A missing provider refresh adds no sample. The longer-term view ranks research attention only; holder, developer, contract, and execution risk remain outside the available data.

Other research surfaces still use browser storage as an adapter. The local preview runs the same collector while its Node server is running, storing `.data/coins.json`. The standalone Worker bundle does not provide this scheduled history backend; production New Coins is served by Modal.

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
