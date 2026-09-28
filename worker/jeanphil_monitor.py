"""Persistent, contract-specific Jean Phil price and sampled social monitor."""

import json
import math
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen

from x_rss_collector import fetch_feed, parse_feed, search_url, title_matches


CONTRACT = "GTBxUiw6wJdmmkCGZgRHLyYxqu1vG4KtRpeox6yDpump"
TOKEN_ID = f"solana:{CONTRACT}"
TERMS = (CONTRACT, "JEANPHIL", "Jean Phil", "Jean Philanthrope")
FIVE_MINUTES = 300_000
SOCIAL_INTERVAL = 30 * 60_000
RETENTION = 14 * 24 * 60 * 60_000


def _number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError):
        return None


def market_sample(now_ms, fetcher=None):
    if fetcher is None:
        def fetcher(url):
            request = Request(url, headers={"User-Agent": "MemeFast/1.0", "Accept": "application/json"})
            with urlopen(request, timeout=20) as response:
                return json.load(response)
    payload = fetcher(f"https://api.dexscreener.com/latest/dex/tokens/{CONTRACT}")
    pairs = [pair for pair in payload.get("pairs") or []
             if pair.get("chainId") == "solana" and pair.get("baseToken", {}).get("address") == CONTRACT]
    if not pairs:
        raise ValueError("No Solana pool returned for the exact Jean Phil contract")
    pair = max(pairs, key=lambda row: _number((row.get("liquidity") or {}).get("usd")) or 0)
    price = _number(pair.get("priceUsd"))
    if price is None:
        raise ValueError("Selected Jean Phil pool has no price")
    return {"at": now_ms, "priceUsd": price, "marketCap": _number(pair.get("marketCap")),
            "fdv": _number(pair.get("fdv")), "liquidity": _number((pair.get("liquidity") or {}).get("usd")),
            "volume5m": _number((pair.get("volume") or {}).get("m5")),
            "buys5m": _number(((pair.get("txns") or {}).get("m5") or {}).get("buys")),
            "sells5m": _number(((pair.get("txns") or {}).get("m5") or {}).get("sells")),
            "pool": pair.get("pairAddress")}


def social_sample(now_ms, fetcher=fetch_feed):
    posts = {}
    errors = []
    for term in TERMS:
        try:
            for post in parse_feed(fetcher(search_url(term)), now_ms):
                if title_matches(post["title"], term):
                    posts[post["guid"]] = post
        except Exception as exc:
            errors.append(f"{term}: {str(exc)[:120]}")
    if len(errors) == len(TERMS):
        raise ValueError("All X RSS searches failed: " + "; ".join(errors))
    recent = sorted((post for post in posts.values() if post["publishedAt"] >= now_ms - 2 * 60 * 60_000),
                    key=lambda post: post["publishedAt"], reverse=True)
    def kind(post):
        return "personality" if any(title_matches(post["title"], term) for term in ("Jean Phil", "Jean Philanthrope")) else "coin"
    personality_count = sum(kind(post) == "personality" for post in recent)
    # A deliberately simple saturation curve: about 12 indexed personality posts in 2h maps to 78/100.
    warmth = round(100 * (1 - math.exp(-personality_count / 8)))
    return {"at": now_ms, "warmth": warmth, "posts2h": personality_count,
            "coinPosts2h": len(recent) - personality_count,
            "posts": [{"url": post["url"], "title": post["title"], "publishedAt": post["publishedAt"], "kind": kind(post)}
                      for post in recent[:25]], "partial": bool(errors), "errors": errors}


def collect(path, now_ms=None, market_fetcher=None, social_fetcher=fetch_feed):
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    try:
        report = json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        report = {"version": 1, "id": TOKEN_ID, "market": [], "social": []}
    report["id"] = TOKEN_ID
    report["version"] = 1
    report.setdefault("errors", {})
    try:
        market = market_sample(now_ms, market_fetcher)
        report["market"] = [row for row in report.get("market", [])
                            if now_ms - RETENTION < row.get("at", 0) < now_ms - FIVE_MINUTES // 2][-4031:] + [market]
        report["errors"].pop("market", None)
    except Exception as exc:
        report["errors"]["market"] = {"at": now_ms, "message": str(exc)[:300]}
    if not report.get("social") or now_ms - report["social"][-1]["at"] >= SOCIAL_INTERVAL:
        try:
            social = social_sample(now_ms, social_fetcher)
            report["social"] = [row for row in report.get("social", [])
                                if now_ms - RETENTION < row.get("at", 0) < now_ms][-671:] + [social]
            report["errors"].pop("social", None)
        except Exception as exc:
            report["errors"]["social"] = {"at": now_ms, "message": str(exc)[:300]}
    report["updatedAt"] = now_ms
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(report, separators=(",", ":")), encoding="utf-8")
    temporary.replace(output)
    return report


if __name__ == "__main__":
    file = sys.argv[1] if len(sys.argv) > 1 else ".data/jeanphil-monitor.json"
    result = collect(file)
    print(f"Jean Phil: {len(result['market'])} market samples, {len(result.get('social', []))} social samples")
