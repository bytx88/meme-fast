import unittest
from datetime import datetime, timezone
from email.utils import format_datetime
from urllib.parse import parse_qs, urlparse

from worker.x_rss_collector import collect, parse_feed, search_url


NOW = 1_800_000_000_000
ID = "solana:98kfF7rmsg1QDUEoCqNE7g7M1FdrTt92TEp2CLzypump"


def item(guid, hours_ago, source="x.com"):
    date = format_datetime(datetime.fromtimestamp((NOW - hours_ago * 3_600_000) / 1000,
                                                 timezone.utc))
    return (f"<item><title>UsePaid post</title>"
            f"<link>https://news.google.com/rss/articles/{guid}?oc=5</link>"
            f"<guid>{guid}</guid><pubDate>{date}</pubDate>"
            f"<source url='https://x.com'>{source}</source></item>")


class XrssCollectorTests(unittest.TestCase):
    def test_search_uses_x_site_and_twelve_hour_window(self):
        query = parse_qs(urlparse(search_url("UsePaid")).query)["q"][0]
        self.assertIn('site:x.com "UsePaid" when:12h', query)

    def test_counts_deduplicated_indexed_posts_in_both_windows(self):
        body = ("<rss><channel>" + item("A123", 2) + item("B456", 8)
                + item("C789", 1, "example.com") + "</channel></rss>").encode()
        report = collect({"coins": []}, {"targets": [{"id": ID, "aliases": ["UsePaid"]}]},
                         fetcher=lambda _: body, now_ms=NOW, limit=1)
        row = report["coins"][ID]
        self.assertEqual(report["status"], "connected")
        self.assertEqual(row["posts6h"], 1)
        self.assertEqual(row["previousPosts6h"], 1)
        self.assertEqual(row["delta6h"], 0)
        self.assertEqual(len(row["posts"]), 1)

    def test_withholds_a_capped_feed(self):
        body = ("<rss><channel>" + item("A123", 2) * 100 + "</channel></rss>").encode()
        with self.assertRaisesRegex(ValueError, "100-item"):
            parse_feed(body, NOW)


if __name__ == "__main__":
    unittest.main()
