"""Cached, on-demand RSS evidence for one known token contract."""

import hashlib
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from worker.x_rss_collector import ID_RE, fetch_feed, parse_feed, search_url


HOUR_MS = 3_600_000
FRESH_MS = 4 * HOUR_MS
STALE_MS = 8 * HOUR_MS
BLOCKED_NAMES = {"bitcoin", "ethereum", "solana", "base", "paid", "money", "token", "coin", "crypto"}


def select_target(snapshot, config, token_id):
    if not ID_RE.fullmatch(token_id):
        raise ValueError("Invalid token ID")
    configured = next((row for row in config.get("targets", []) if row.get("id") == token_id), None)
    coin = next((row for field in ("coins", "radarCoins") for row in snapshot.get(field, [])
                 if row.get("id") == token_id), None)
    if not configured and not coin:
        raise ValueError("Token is not in the tracked market or evidence watchlist")
    terms = [(token_id.split(":", 1)[1], "contract query")]
    if configured:
        terms.extend((alias, "configured alias query") for alias in configured.get("aliases", [])
                     if isinstance(alias, str) and 3 <= len(alias) <= 80)
    elif coin:
        name = str(coin.get("name") or "").strip()
        if len(name) >= 6 and name.lower() not in BLOCKED_NAMES:
            terms.append((name[:80], "name query; contract unverified"))
    return {"id": token_id, "name": coin.get("name") if coin else configured.get("name", token_id),
            "symbol": coin.get("symbol") if coin else configured.get("symbol", "?"),
            "terms": list(dict.fromkeys(terms[:4]))}


def _path(cache_dir, token_id):
    return Path(cache_dir) / (hashlib.sha256(token_id.encode()).hexdigest() + ".json")


def _read(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if value.get("version") == 1 else None
    except (FileNotFoundError, ValueError, AttributeError):
        return None


def _save(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
    temp.replace(path)


def _serve(report, now_ms, status):
    return {**report, "cacheStatus": status,
            "nextRefreshAt": report["sampledAt"] + FRESH_MS,
            "staleAfter": report["sampledAt"] + STALE_MS,
            "ageMs": now_ms - report["sampledAt"]}


def collect_coin_evidence(snapshot, config, token_id, cache_dir, fetcher=fetch_feed, now_ms=None):
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    target = select_target(snapshot, config, token_id)
    path = _path(cache_dir, token_id)
    cache = _read(path)
    age = now_ms - cache["sampledAt"] if cache and cache.get("sampledAt") else None
    if age is not None and 0 <= age < FRESH_MS:
        return _serve(cache, now_ms, "fresh")
    if cache and now_ms - cache.get("lastAttemptAt", 0) < FRESH_MS:
        if age is not None and age < STALE_MS:
            return _serve(cache, now_ms, "stale")
        return {"version": 1, "id": token_id, "status": "error", "cacheStatus": "error",
                "message": "RSS retry cooldown is active.", "posts": [],
                "nextRefreshAt": cache["lastAttemptAt"] + FRESH_MS}

    found, errors = {}, []
    for term, reason in target["terms"]:
        try:
            for post in parse_feed(fetcher(search_url(term)), now_ms):
                current = found.get(post["guid"])
                if current is None or reason == "contract query":
                    found[post["guid"]] = {"url": post["url"], "title": post["title"],
                                           "publishedAt": post["publishedAt"], "reason": reason}
        except Exception as error:
            errors.append({"query": reason, "message": str(error)[:200]})
    if len(errors) == len(target["terms"]):
        if cache:
            _save(path, {**cache, "lastAttemptAt": now_ms})
            if age is not None and age < STALE_MS:
                return {**_serve(cache, now_ms, "stale"), "errors": errors}
        else:
            _save(path, {"version": 1, "lastAttemptAt": now_ms})
        return {"version": 1, "id": token_id, "status": "error", "cacheStatus": "error",
                "message": errors[0]["message"], "posts": [], "errors": errors,
                "nextRefreshAt": now_ms + FRESH_MS}

    posts = sorted(found.values(), key=lambda row: row["publishedAt"], reverse=True)
    current = [row for row in posts if row["publishedAt"] >= now_ms - 6 * HOUR_MS]
    previous = [row for row in posts if row["publishedAt"] < now_ms - 6 * HOUR_MS]
    report = {"version": 1, "id": token_id,
              "status": "partial" if errors else "connected", "source": "google-news-rss",
              "sampledAt": now_ms, "lastAttemptAt": now_ms,
              "coverage": "Google News RSS index of x.com; incomplete sample; alias and name queries do not prove a contract link",
              "queries": [{"term": term, "reason": reason} for term, reason in target["terms"]],
              "posts6h": len(current), "previousPosts6h": len(previous),
              "posts": current[:10], "errors": errors}
    _save(path, report)
    return _serve(report, now_ms, "fresh")


if __name__ == "__main__":
    try:
        snapshot = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        config = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        print(json.dumps(collect_coin_evidence(snapshot, config, sys.argv[3], sys.argv[4]), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
