"""Public projections of the collector snapshot."""
import math
import unicodedata

RETENTION_MS = 5 * 86400000
COMPETITION_FIELDS = ("id", "network", "chain", "contract_address", "contract_verified", "name", "symbol", "image_url", "poolCreated", "volume",
                      "firstSeen", "firstSeenRadarAt", "liquidity", "volume5m", "buys5m", "sells5m", "marketUpdatedAt", "fetchedAt")
MINUTE = 60000


def _name_key(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).strip().lower().split())


def _ticker_key(value):
    return _name_key(str(value or "").lstrip("$"))


def _number(value):
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (ValueError, TypeError):
        return None


def _compact_flow(history):
    rows = [row for row in history if isinstance(row, dict) and (_number(row.get("at")) or 0) > 0]
    rows.sort(key=lambda row: _number(row["at"]))
    return [{key: _number(row.get(key)) for key in ("at", "volume5m", "buys5m", "sells5m", "liquidity")}
            for row in rows[-2:]]


def _early_ramp_warning(coin, now_ms):
    if coin.get("ruggedAt"):
        return None
    created = _number(coin.get("poolCreated"))
    if created is None or created <= 0 or not 0 <= now_ms - created <= 60 * MINUTE:
        return None
    history = sorted(
        (row for row in coin.get("marketHistory", [])
         if isinstance(row, dict) and (at := _number(row.get("at"))) is not None
         and created <= at <= now_ms
         and (price := _number(row.get("priceUsd"))) is not None and price > 0),
        key=lambda row: float(row["at"]),
    )
    if len(history) < 5 or now_ms - float(history[-1]["at"]) > 10 * MINUTE:
        return None
    for offset in range(len(history) - 4):
        samples = history[offset:offset + 5]
        first, last = samples[0], samples[-1]
        span = float(last["at"]) - float(first["at"])
        if not 15 * MINUTE <= span <= 30 * MINUTE or float(last["priceUsd"]) < 2 * float(first["priceUsd"]):
            continue
        if any(float(row["priceUsd"]) < .95 * float(samples[index - 1]["priceUsd"])
               for index, row in enumerate(samples) if index):
            continue
        liquidity = _number(last.get("liquidity"))
        if liquidity is None or not 3000 <= liquidity <= 50000:
            continue
        if not all((_number(row.get("buys5m")) or 0) >= 50
                   and (_number(row.get("sells5m")) or 0) > 0
                   and float(row["buys5m"]) >= 2.5 * float(row["sells5m"])
                   for row in samples[:3]):
            continue
        return {"risePercent": math.floor((float(last["priceUsd"]) / float(first["priceUsd"]) - 1) * 100 + .5),
                "minutes": math.floor(span / MINUTE + .5)}
    return None
WATCHLIST_FIELDS = (
    "id", "name", "symbol", "network", "chain", "contract_address", "contract_verified", "image_url",
    "priceUsd", "priceChange", "mc", "fdv", "liquidity", "volume", "volume5m",
    "buys5m", "sells5m", "recentVolume1h", "poolCreated", "marketUpdatedAt", "priceUpdatedAt",
)


def snapshot_revision(snapshot):
    return snapshot.get("revision") or str(snapshot.get("lastRun") or 0)


def snapshot_version(snapshot):
    return {"revision": snapshot_revision(snapshot), "lastRun": snapshot.get("lastRun")}


def _key(value):
    return value if value.startswith("solana:") else value.lower()


def snapshot_view(snapshot, view="", ids=(), now_ms=None, name="", hours=120):
    if now_ms is None:
        import time
        now_ms = time.time() * 1000
    cutoff = now_ms - RETENTION_MS
    if view == "health":
        return {field: snapshot.get(field) for field in ("revision", "lastRun", "feeds")}
    if view == "name":
        key = _name_key(name)
        if not key or len(key) > 100:
            raise ValueError("Request a token name up to 100 characters")
        result = {field: snapshot[field] for field in ("version", "revision", "lastRun", "coverage", "feeds") if field in snapshot}
        result["coins"] = [
            {**{field: value for field, value in coin.items()
                if field not in ("marketHistory", "marketHistoryHourly", "priceHistory5m")},
             "flowSamples": _compact_flow(coin.get("marketHistory") or []),
             "earlyRampWarning": _early_ramp_warning(coin, now_ms)}
            for coin in snapshot.get("coins", []) if coin.get("firstSeen", 0) > cutoff and _name_key(coin.get("name")) == key
        ]
        result["competitionCoins"] = [
            {field: coin[field] for field in COMPETITION_FIELDS if field in coin}
            for coin in snapshot.get("radarCoins", [])
            if coin.get("lastSeenRadarAt", 0) > cutoff and _name_key(coin.get("name")) == key
        ]
        return result
    if view == "watchlist":
        if not 1 <= len(ids) <= 30 or any(len(item) > 160 or ":" not in item for item in ids):
            raise ValueError("Request 1 to 30 saved token IDs")
        available = {
            _key(coin["id"]): coin for coin in snapshot.get("radarCoins", [])
            if coin.get("lastSeenRadarAt", 0) > cutoff
        }
        for coin in snapshot.get("coins", []):
            if coin.get("firstSeen", 0) > cutoff:
                available.setdefault(_key(coin["id"]), coin)
        return {
            "version": 1, "lastRun": snapshot.get("lastRun"),
            "coins": [
                {field: available[_key(item)].get(field) for field in WATCHLIST_FIELDS}
                for item in ids if _key(item) in available
            ],
        }
    if view == "coin":
        if hours not in (1, 6, 12, 36, 120):
            raise ValueError("Choose a supported Snipe time window")
        retained = [coin for coin in snapshot.get("coins", []) if (coin.get("firstSeen") or 0) > cutoff]
        window_cutoff = now_ms - hours * 3600000
        visible = [coin for coin in retained if (coin.get("firstSeen") or 0) >= window_cutoff
                   or (coin.get("graduationObservedAt") or 0) >= window_cutoff]
        visible_ids = {coin["id"] for coin in visible}
        result = {field: snapshot[field] for field in ("version", "revision", "lastRun", "coverage", "feeds") if field in snapshot}
        result["retainedTotal"] = len(retained)
        result["retainedAddressLinked"] = sum(
            context.get("kind") == "verified" or context.get("kind") == "web" and bool((context.get("web") or {}).get("exact"))
            for coin in retained if isinstance(context := coin.get("savedContext"), dict)
        )
        result["coins"] = [
            {**{key: value for key, value in coin.items()
                if key not in ("marketHistory", "marketHistoryHourly", "priceHistory5m")},
             "flowSamples": _compact_flow(coin.get("marketHistory") or []),
             "earlyRampWarning": _early_ramp_warning(coin, now_ms)}
            for coin in visible
        ]
        names = {_name_key(coin.get("name")) for coin in visible} - {""}
        tickers = {_ticker_key(coin.get("symbol")) for coin in visible} - {""}
        result["competitionCoins"] = [
            {key: coin[key] for key in COMPETITION_FIELDS if key in coin}
            for coin in [*retained, *(coin for coin in snapshot.get("radarCoins", []) if (coin.get("lastSeenRadarAt") or 0) > cutoff)]
            if coin.get("id") not in visible_ids
            and (_name_key(coin.get("name")) in names or _ticker_key(coin.get("symbol")) in tickers)
        ]
        return result
    result = dict(snapshot)
    result["coins"] = [] if view == "radar" else [coin for coin in snapshot.get("coins", []) if coin.get("firstSeen", 0) > cutoff]
    if view == "radar":
        sample_fields = ("at", "volume5m", "buys5m", "sells5m", "liquidity")
        result["radarCoins"] = [
            {**{key: value for key, value in coin.items() if key not in ("marketHistory", "marketHistoryHourly", "priceHistory5m")},
             "marketHistory": [{key: row[key] for key in sample_fields if key in row}
                               for row in coin.get("marketHistory", []) if row.get("at", 0) >= now_ms - 4 * 3600000][-48:],
             "marketHistoryHourly": [{key: row[key] for key in sample_fields if key in row}
                                     for row in coin.get("marketHistoryHourly", []) if row.get("at", 0) >= now_ms - RETENTION_MS][-120:]}
            for coin in snapshot.get("radarCoins", []) if coin.get("lastSeenRadarAt", 0) > cutoff
        ]
    else:
        result["radarCoins"] = [coin for coin in snapshot.get("radarCoins", []) if coin.get("lastSeenRadarAt", 0) > cutoff]
    return result
