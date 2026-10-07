"""Count Google News RSS results whose source is x.com, by token contract."""

import json
import os
from pathlib import Path
import re
import sys
import time
from datetime import timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


HOUR_MS = 3_600_000
MAX_TARGETS = 8
ID_RE = re.compile(r"^(?:solana:[1-9A-HJ-NP-Za-km-z]{32,44}|(?:base|robinhood|bsc):0x[a-fA-F0-9]{40})$")
ARTICLE_RE = re.compile(r"^/rss/articles/[A-Za-z0-9_-]+$")


def select_targets(snapshot, config, limit=MAX_TARGETS):
    configured = [row for row in config.get("targets", []) if ID_RE.fullmatch(str(row.get("id", "")))]
    market = [row for field in ("coins", "radarCoins") for row in snapshot.get(field, [])
              if ID_RE.fullmatch(str(row.get("id", "")))]
    market.sort(key=lambda row: float(row.get("buyers") or 0), reverse=True)
    selected = []
    for row in [*configured, *market]:
        token_id = row["id"]
        if token_id not in selected:
            selected.append(token_id)
        if len(selected) >= limit:
            break
    by_id = {row["id"]: row for row in configured}
    return [dict(id=token_id, contract=token_id.split(":", 1)[1],
                 aliases=[alias for alias in by_id.get(token_id, {}).get("aliases", [])
                          if isinstance(alias, str) and 3 <= len(alias) <= 80][:3])
            for token_id in selected]


def search_url(term):
    safe_term = term.replace('"', "")
    query = f'site:x.com "{safe_term}" when:12h'
    return "https://news.google.com/rss/search?" + urlencode(
        {"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"})


def fetch_feed(url):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; MemeFastRSS/1.0)"})
    with urlopen(request, timeout=20) as response:
        return response.read()


def title_matches(title, term):
    text, needle = title.casefold(), term.casefold()
    start = text.find(needle)
    while start >= 0:
        before = text[start - 1] if start else ""
        after = text[start + len(needle):start + len(needle) + 1]
        if not before.isalnum() and not after.isalnum():
            return True
        start = text.find(needle, start + 1)
    return False


def parse_feed(body, now_ms):
    root = ET.fromstring(body)
    if root.tag != "rss" or root.find("channel") is None:
        raise ValueError("Invalid Google News RSS response")
    items = root.findall("channel/item")
    if len(items) >= 100:
        raise ValueError("Google News RSS reached its 100-item result cap")
    posts = []
    for item in items:
        source = item.find("source")
        if source is None or (source.text or "").strip().lower() not in ("x.com", "twitter.com"):
            continue
        link = (item.findtext("link") or "").strip()
        parsed = urlparse(link)
        if parsed.scheme != "https" or parsed.netloc != "news.google.com" or not ARTICLE_RE.fullmatch(parsed.path):
            continue
        published = item.findtext("pubDate")
        if not published:
            continue
        try:
            at = int(parsedate_to_datetime(published).astimezone(timezone.utc).timestamp() * 1000)
        except (TypeError, ValueError, OverflowError):
            continue
        if at < now_ms - 12 * HOUR_MS or at > now_ms + 5 * 60_000:
            continue
        title = (item.findtext("title") or "").removesuffix(" - x.com").strip()
        guid = (item.findtext("guid") or parsed.path).strip()
        posts.append({"guid": guid, "url": link, "title": title[:300], "publishedAt": min(at, now_ms)})
    return posts


def collect(snapshot, config, fetcher=fetch_feed, now_ms=None, limit=3):
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    targets = select_targets(snapshot, config, min(MAX_TARGETS, max(1, int(limit))))
    coins, errors = {}, []
    for target in targets:
        found = {}
        try:
            for term in [target["contract"], *target["aliases"]]:
                for post in parse_feed(fetcher(search_url(term)), now_ms):
                    if not title_matches(post["title"], term):
                        continue
                    found[post["guid"]] = post
            posts = list(found.values())
            current = sorted((post for post in posts if post["publishedAt"] >= now_ms - 6 * HOUR_MS),
                             key=lambda post: post["publishedAt"], reverse=True)
            previous = sum(now_ms - 12 * HOUR_MS <= post["publishedAt"] < now_ms - 6 * HOUR_MS
                           for post in posts)
            coins[target["id"]] = {
                "source": "google-news-rss", "sampledAt": now_ms,
                "posts6h": len(current), "previousPosts6h": previous,
                "delta6h": len(current) - previous,
                "coverage": "Google News RSS index of x.com; visible title matches for contract or configured aliases; sampled, incomplete coverage; alias matches do not prove a contract link",
                "posts": [{"url": post["url"], "title": post["title"],
                           "publishedAt": post["publishedAt"]} for post in current[:10]],
            }
        except Exception as error:
            errors.append({"id": target["id"], "message": str(error)[:240]})
    return {"version": 1, "status": "connected" if coins else "error",
            "source": "google-news-rss", "sampledAt": now_ms,
            "coverage": {"sampled": len(coins), "targeted": len(targets),
                         "method": "Google News RSS indexed x.com posts; sampled, not complete X coverage"},
            "coins": coins, "errors": errors}


def main():
    defaults = [".data/coins.json", ".data/x-factor.json", "x-factor-targets.json"]
    snapshot_file, output_file, config_file = [sys.argv[i] if len(sys.argv) > i else defaults[i-1]
                                               for i in range(1, 4)]
    snapshot = json.loads(Path(snapshot_file).read_text(encoding="utf-8"))
    config = json.loads(Path(config_file).read_text(encoding="utf-8"))
    report = collect(snapshot, config, limit=int(os.getenv("X_FACTOR_TARGET_LIMIT", "3")))
    output = Path(output_file)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(report), encoding="utf-8")
    temporary.replace(output)
    print(f"X RSS: {report['status']}; {len(report['coins'])} sampled coins")


if __name__ == "__main__":
    main()
