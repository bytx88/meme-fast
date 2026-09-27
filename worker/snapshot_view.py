"""Public projections of the collector snapshot."""
import math

RETENTION_MS = 5 * 86400000
MINUTE = 60000


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


def snapshot_view(snapshot, view="", ids=(), now_ms=None):
    if now_ms is None:
        import time
        now_ms = time.time() * 1000
    cutoff = now_ms - RETENTION_MS
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
    result = dict(snapshot)
    result["coins"] = [coin for coin in snapshot.get("coins", []) if coin.get("firstSeen", 0) > cutoff]
    if view == "coin":
        result["coins"] = [
            {**{key: value for key, value in coin.items()
                if key not in ("marketHistory", "marketHistoryHourly", "priceHistory5m")},
             "flowSamples": _compact_flow(coin.get("marketHistory") or []),
             "earlyRampWarning": _early_ramp_warning(coin, now_ms)}
            for coin in result["coins"]
        ]
        result.pop("radarCoins", None)
    else:
        if view == "radar":
            result["coins"] = []
        result["radarCoins"] = [
            coin for coin in snapshot.get("radarCoins", [])
            if coin.get("lastSeenRadarAt", 0) > cutoff
        ]
    return result
