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

Order Flow uses provider data through restricted market proxies. On Modal, GeckoTerminal, DexScreener, Solana RPC and indexed-X RSS each have one source owner shared by scheduled collectors and request handlers. These owners pace upstream requests, share cached observations across consumers and retain provider cooldowns. Their cache databases are separate files on `meme-fast-source-stream`; each file has one writer. Warm processes batch Volume checkpoints, so an idle or terminated cache can lose uncheckpointed entries and counters without losing retained research history. Local preview and the standalone Worker retain bounded process-local market proxies.

The scheduled Node market collector uses a bounded loopback HTTP bridge in its own Modal container to invoke those same source owners directly, avoiding a public-web invocation for each internal provider read. The bridge retains source scopes, publisher allowlists, background Gecko admission/retry headers, deadlines and original observation times; it closes with the job. Article contract/name matching prepares each article once per collection pass. The API still reloads the mounted history revision before serving a precomputed projection or its snapshot fallback.

## Shared token and wallet stream

`worker/data_stream.py` builds the shared pool on `meme-fast-data-stream`, using the retained market snapshot, complete wallet observations and classified swap ledger. The followed-wallet dispatcher requests this projection after committing holdings. `GET /api/data-stream?window=5m|1h|6h|24h` exposes trending tokens, largest observed holders and recent accumulators separately. The response includes observation times, coverage, criteria and a stale flag. `GET /api/data-stream/sources` exposes committed cache counters, without credentials or RPC endpoint URLs.

Market eligibility uses current liquidity of at least $3,000 and actual provider rolling-window volume/trade counts. Initial minimum volume/trades are $500/5 for 5m, $5,000/10 for 1h, $15,000/25 for 6h and $15,000/50 for 24h. Launch age is unrestricted. Unknown windows do not qualify; five-minute samples are not summed into invented six-hour totals. Rankings use volume, turnover and buy participation in one selected pool, not an investment-quality score. DexScreener transaction counts never become unique-buyer counts in this feed.

The common pool admits at most 60 tokens, interleaving ranks across all four windows. Each pass can inspect two due Solana tokens for signing-wallet candidates among their sampled largest token accounts. At most 100 discovered wallets join collection; their provenance remains Public and SmartMoney stays unreviewed. Existing user metadata takes precedence. Recent classified wallet buys nominate at most 30 unknown token contracts for the existing market batch; liquidity and activity gates still apply before they enter the active pool. Expansion does not recursively enroll every holding or transfer.

Complete wallet scans retain integer balances needed by the active pool and recent Inspect interests, decimals, both token-program slots and original sample times. Unneeded positive mints are marked as omitted; requesting their quantities causes a coverage miss and a direct fetch, never a false zero. The common history uses sparse positive balances and deduplicated coverage sets to distinguish measured absence from missing coverage. History is capped at 200 wallets and 100,000 stored positive-balance entries, preserving current/window anchors first; unavailable baselines remain unknown. API readers use an atomic lightweight index instead of parsing private history. Balance cohorts reuse fresh scans and fetch coverage misses. An absent mint certifies zero only when both program scans completed. Partial failures retain the previous observation and its time; yesterday's cached zero cannot certify today for the dormancy policy. Shared balance histories support holder changes only when both endpoints were observed. Unclassified holding increases remain distinct from classified net buying; frequent buys by a net seller do not qualify as accumulation. Largest-holder lists remain sampled and are not complete ownership rankings. Wallet collection currently covers Solana; the market pool retains its existing supported chains.

Current-pool wallets take first priority, followed by Interested wallets. Their holdings and activity are due every five minutes. Outside that pool, cheap activity checks use 30 minutes for saved SmartMoney wallets and one hour for other saved wallets; broader holdings probes use six hours and one day respectively. Each pass reserves one initial discovery check; other new candidates wait behind current holders and user interests. New wallets receive an initial check; deadlines and provider capacity can delay coverage. Wallets involved with current pool tokens receive active priority. Non-Interested trade scans focus on the recent 24 hours, preserving existing older ledger records. Interested wallets retain the existing history collection path. Quiet token markets leave the hot market-refresh queue; discovery and explicit saved interests can reactivate them. SmartMoney balance jobs outside a measured current pool pause routine collection while retaining history, and Inspect interests can resume them. The original archived cohort no longer refreshes unconditionally on every dispatcher run. Existing certified dormancy and weekly-probe rules remain separate.

Tweet reads `GET /api/new-coins?view=tweet` from scheduled news and qualifying shared 24H market observations, including retained tokens when a discovery feed is unavailable. Its per-chain projection uses the common liquidity/activity gate and preserves source attribution; unknown unique-buyer counts stay unknown. Opening Tweet adds no publisher/trending upstream requests. Snipe, Swing and Watchlist keep their existing projections of the shared snapshot; Inspect uses the shared restricted GeckoTerminal and DexScreener sources. DexScreener batches reuse per-token entries, so overlapping batches request only their missing contracts. At the RPC source, complete cached scans of both token programs can also supply a later mint-specific query, including a new Inspect interest, without another provider read. Full-pool discovery remains distinct from a batch quote. X badges, on-demand evidence and the manual Jean Phil monitor reuse the same fetched Google RSS queries while preserving their separate matching rules.

Inspect also retains up to three exact-contract flow snapshots in browser storage for up to 24 hours, bounded to 1.8 million characters. Reopening a previously resolved single listing restores its identity, charts, and swaps synchronously, labels the original snapshot time, and refreshes pools in the background. Existing data stays visible until the refresh finishes; a failed refresh preserves the saved sample and timestamp. Ambiguous/ticker searches, unverified tokens, expired snapshots, and unavailable storage use the normal lookup flow. A first visit still requires a network fetch.

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

`worker/provider-fetch.mjs` serializes requests per provider, paces dispatch, honors HTTP 429 Retry-After (with a one-minute minimum), persists cooldown timestamps in the snapshot, and starts network deadlines at dispatch. Discovery and market collection have a 210-second request budget, followed by a separate 45-second context budget. A transient 429 receives one retry after cooldown if it fits within the remaining budget. Discovery queues first pages for all chains, trending, and top pools, then tracked/indexed Robinhood pools, before deeper pages. The retained market refresh runs concurrently on its independent provider queue and is capped at 1,800 contracts; failed/skipped targets retain their old market timestamp, while last-attempt timestamps rotate the remainder of the retained universe.

`POST /api/refresh-priority` accepts 1-30 validated Solana/Base/Robinhood contract IDs per request and only registers contracts already in the snapshot. Modal stores contract-to-request-time entries in the separate `meme-fast-refresh-priorities` Dict, avoiding concurrent writers to the market snapshot Volume. Entries expire after 24 hours; collection considers the newest 300. Local preview uses `.data/refresh-priorities.json`. This is a shared refresh-interest queue, not account storage or persistent watchlists. No user names, notes, or positions are submitted. Collection consumes the queue and refreshes existing records; it does not execute trades.

The legacy `/new-coins.html` route serves the same Snipe interface as `/`. Swing continues to use `/radar.html` and existing browser storage identities, preserving bookmarks and saved items.

Publisher news is fetched directly from the two configured RSS feeds through the shared social source, rather than depending on the RSS-to-JSON service blocked by the production host. A prebuilt Tweet projection avoids parsing the full market archive on each page visit. Browser observations survive a failed shared source with their original timestamps.

The collector's historical pool lookup uses the same full-pool Dex source as Inspect. Python adapters preserve full-pool versus quote scope. Dex token profiles are cached by the Dex owner for 15 minutes; unsupported deployed Dex routes fail instead of silently fetching directly. Quotes are shared for five minutes to span the normal collection cycle, while full-pool Dex discovery stays at one minute and Gecko swap samples at one minute. Original observation times remain attached, so cache reuse does not produce new market-history samples.

Gecko token/pool multi requests reuse individual entities across overlapping batches, with separate cache contracts for network, entity kind and query parameters. Only missing entities are requested; included relationships are retained and merged. Different includes, discovery pages, candle windows and trade samples remain distinct evidence. Collector and UI story research now use the single `read_context_source` owner: 15-minute configured-source and five-minute normalized-search caches. The source accepts only the configured story URLs and the fixed search route, not arbitrary URLs. Context counters appear alongside the other source counters.

Dedicated collection remains for macro series/news, the CoinLore benchmark and Robinhood event indexing. Market Delta samples the fixed 11-contract preset through the existing shared Dex quote owner, with full-pool discovery through that same owner only for unresolved members. It never derives membership from trending rankings or FOMO. Local preview uses its restricted Dex proxy and preserves original cache timestamps. Other local/manual tools retain their explicit direct-provider mode. A cache miss after its freshness window is a new reading, not a promise of zero future upstream calls. Public endpoints denying largest-account access receive a one-hour method-specific cooldown; unavailable holder coverage is never represented as an empty holder list.

Gecko multi projections canonicalize hexadecimal EVM addresses while preserving Solana address case. Batch shapes and identities are validated before caching. Each entity retains only its reachable included-resource graph, including nested relationships, so a subset read does not inherit unrelated resources from a larger batch. The projection cache contract is versioned to avoid reusing earlier case-sensitive or oversized entity entries.

Deployed source sessions share a bounded 30-second failed-read backoff as well as successful observations. Failure markers survive checkpoints, are scoped to the request (and individual entities for overlapping batches), do not extend when hit, and never become empty or successful observations. `:backoff` metric namespaces count suppressed retries separately from successful response reuse. Equivalent Gecko include ordering and hexadecimal address case share keys for both single and multi reads. Smart Wallet valuation consumes common token quotes; it does not request full-pool discovery just to obtain a price.

### Deployed source ownership audit

| Function / consumer | Data ownership |
| --- | --- |
| `read_source` | Sole Solana RPC owner; shared holdings, signatures, transactions, supply and holder discovery |
| `read_market_source` | Sole Dex owner; quotes, full pools, search and profiles retain distinct contracts |
| `read_gecko_source` | Sole Gecko owner; discovery, metadata, pools, swaps and candles |
| `read_social_source` | Sole configured publisher / indexed-X RSS owner |
| `read_context_source` | Sole configured story / normalized search owner |
| `collect_coins` | Common market/news sources, saved Robinhood catalogue and bounded wallet nominations; publishes the token snapshot |
| `collect_followed_wallets` | Common RPC; publishes reusable complete holdings |
| `collect_smart_wallets` | Reuses complete holdings; gaps use common RPC, valuation uses common quotes |
| `collect_smartness` | Common RPC and quotes; publishes the classified ledger |
| `collect_data_stream` | Projects the saved token, holdings and ledger datasets; discovery gaps use common RPC |
| `collect_x_factor`, `collect_coin_evidence`, manual Jean Phil monitor | Common RSS / quotes, with separate analysis rules and saved histories |
| Web: Snipe, Swing, Tweet, Watchlist | Saved snapshot views; detail gaps use the common owners |
| Web: Inspect, wallet activity / candidates, Smartness and balances | Saved datasets or common owners; no independent token/wallet provider client |
| `collect_meme_index` | Fixed 11-contract preset through common Dex quotes/pools, retaining original observation times; one dedicated CoinLore request supplies both Alt and BTC |
| `collect_macro_review` | Single owner of its dedicated economic/exchange/news inputs and saved 30-minute report |
| Robinhood indexer | Single event-index owner with persistent scan cursors; downstream readers reuse its catalogue |

The common stream comprises these shared source observations and retained datasets; not every feature reads the ranked `/api/data-stream` projection. Distinct provider endpoints, analysis coverage, expired observations and explicit local/manual collection still require separate work. No claim of zero upstream traffic after cache expiry, restart, eviction or deployment is made.


### Final reuse and rate-limit boundaries

Gecko discovery rows from network, DEX and token-pool pages can seed later exact pool-multi reads. Only complete pool representations with matching requested includes and reachable included resources qualify. Pagination, ranking and sort affect list membership, so they are removed from the per-pool projection contract. Projected entries preserve the source observation time and expire within five minutes, even when the originating discovery page is reused for ten minutes. A projected pool never certifies a complete token-pool list. Included token display metadata never certifies aggregate token activity. Malformed or partial rows do not seed projections. A token-multi response with `include=top_pools` can also supply the bare token-aggregate read used by Mode when the primary token attributes actually contain its exact address, aggregate reserves and 24H volume. Pool-included display tokens cannot supply this evidence. Original timestamps and the five-minute activity TTL still apply. Multi requests fetch only their missing eligible entities.

All deployed Gecko consumers use one persistent eight-request rolling minute budget with 7.5-second spacing. Background discovery and Mode activity use at most six slots, leaving capacity for Inspect. Background admission waits happen outside the source owner and never become failed-observation backoff. First pages for every chain and market view precede optional enrichment and deep pages. Discovery may retry a provider 429 once after Retry-After within its deadline; provider cooldowns are not copied into client gates that could hide common cache hits. Optional work can remain partial within these limits.

Market Delta uses the ordered exact identities in `worker/meme-index-preset.json`: BP, STONK, PONS, CATE, SI, ANSEM, ZCAT, PURR, CASHCAT, NEARKAT and RAYCAT. All 11 remain in the basket with permanent 1/11 weights, even when unavailable. Two network quote batches use the common source owner; an unresolved token can request its complete pool list. The most liquid qualified exact-base-token pool supplies each return. Quotes must be younger than 15 minutes, include a known pool at least one hour old at the original observation, and report a finite 1H return between -100% and 10,000%. If any input fails, Meme is withheld, with no replacement, reweighting, clipping or zero substitution. Alt/BTC update independently.

New readings save each constituent's raw one-hour return, selected pool, eligibility reason and original observation time, plus a private 30-day basket history. The public `meme-index.public.json` projection excludes private history; API and local preview prefer it, with a compatibility fallback to the original report. A same-hour successful collector retry repairs a missing public projection without fetching sources; an incomplete reading may retry quotes. The fixed-preset method includes the ordered contract identity hash, so only identical presets supply Meme comparisons. Former FOMO and shared-trending reports remain archived and their Meme values are withheld by the browser. Alt/BTC history stays independently comparable.

Separate upstream reads remain necessary for different evidence: wallet/RPC observations, exact swap tapes, token metadata, candle ranges, macro data, the shared Alt/BTC benchmark and event indexing. Cache expiry, eviction, unsupported field contracts and provider failures can also require a later read. Sharing removes redundant eligible reads; it does not imply complete holder coverage or unlimited free-provider capacity.

The October 25 follow-up review also checks consumers of cached observations. Coin and Radar merges retain the newest complete market observation as one unit, including its pool, measured windows and provenance; an older discovery response cannot replace it. A newly encountered shared quote advances market history once at its original time, while repeat, expired and out-of-order observations add no sample. The tracked Robinhood fallback uses the same quote projection, and launchpad metadata and included pools retain their source times. Dex batch and full-pool responses are structurally validated before success-cache admission; invalid replies enter failed-read backoff and cannot poison a successful cache entry.

Sampled holder reports distinguish the latest attempt from the oldest source observation used to resolve holders. Rankings and freshness use the observation time; retry scheduling uses the attempt time. Markets qualifying only in 6H/24H windows refresh every ten minutes, within the common pool's fifteen-minute market freshness limit, subject to the existing bounded request budget.

### Missing-only enrichment

Gecko entity reads also reuse richer include contracts when the requested primary fields and relationships are fully covered. All non-include query parameters must match. Complete pools included in launchpad token responses can supply later exact pool reads. Bare, base/quote and top-pool contracts use bounded direct cache-key lookups, including observations retained before deployment; uncommon include combinations use a bounded index. These projections retain original times and expiry and never certify complete list membership from individual pools or aggregate token activity from display metadata.

Inspect reuses a fresh complete exact-token Gecko pool lookup for five minutes. A valid existing Dex valuation from a complete lookup within one minute supplies the cap cross-check without another quote lookup. Independent Gecko membership and pool-price coverage still apply: a complete Dex list cannot prove Gecko has no additional pools. Search results, changed pool hints, expired lists and missing valuation fields retain the normal missing-data path.

Solana `getMultipleAccounts` batches reuse compatible individual accounts, including measured nulls, across overlapping and reordered requests. Only missing, expired or insufficient-slot accounts are sent upstream. Encoding, commitment and data-slice scopes stay separate. Composite responses explicitly report non-atomic coverage, the minimum actual slot and each account's original time/context; they do not manufacture a single-bank observation.

Mode reuses complete shared quotes and exact zero-volume activity certificates within the same five-minute source lifetime. Only uncovered mints enter quote/activity batches. The fifteen-minute outage tolerance does not extend this reuse window, and newer positive activity invalidates older inactivity. Cohort membership, score policy and crossing deduplication remain unchanged.
