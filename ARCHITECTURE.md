# Meme Fast application skeleton

Meme Fast is organized around an evidence path:

`source → observation → narrative ↔ token → market observation`

## Product surfaces

- **Radar** (`dist/narratives.html`) discovers changing narratives and active tokens.
- **New coins** (`dist/new-coins.html`) collects fresh pools into an investigation queue and promotes only exact-address evidence matches.
- **Narrative research** (`dist/narrative.html`) explains a story through evidence, lifecycle state, and exact-address token associations.
- **Token research** (`dist/index.html`) investigates recent swap flow for a contract or a set of listings.
- **Watchlist** (`dist/watchlist.html`) keeps a personal queue of narratives and tokens.
- **Sources** (`dist/sources.html`) makes collection coverage and planned source accounts explicit.

The current implementation deliberately uses browser storage as an adapter. It lets the product flow be tested before a backend schema is fixed.

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
- `/?query=<contract-or-ticker>` — token research
- `/watchlist.html` — saved research
- `/sources.html` — coverage configuration

These browser-safe URLs can later map directly to server routes without changing the user flow.
