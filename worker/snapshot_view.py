"""Public projections of the collector snapshot."""

RETENTION_MS = 5 * 86400000
WATCHLIST_FIELDS = (
    "id", "name", "symbol", "network", "chain", "contract_address", "image_url",
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
            {key: value for key, value in coin.items()
             if key not in ("marketHistory", "marketHistoryHourly", "priceHistory5m")}
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
