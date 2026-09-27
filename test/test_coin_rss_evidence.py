import tempfile
import unittest
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from worker.coin_rss_evidence import collect_coin_evidence, select_target, FRESH_MS, STALE_MS


NOW = 1_800_000_000_000
ID = "solana:98kfF7rmsg1QDUEoCqNE7g7M1FdrTt92TEp2CLzypump"
SNAPSHOT = {"coins": [], "radarCoins": []}
CONFIG = {"targets": [{"id": ID, "name": "Paid", "symbol": "PAID", "aliases": ["UsePaid"]}]}


def feed(guid="A123", hours_ago=1):
    date = format_datetime(datetime.fromtimestamp((NOW-hours_ago*3_600_000)/1000, timezone.utc))
    return (f"<rss><channel><item><title>UsePaid post</title>"
            f"<link>https://news.google.com/rss/articles/{guid}?oc=5</link>"
            f"<guid>{guid}</guid><pubDate>{date}</pubDate>"
            "<source url='https://x.com'>x.com</source></item></channel></rss>").encode()


class CoinRssEvidenceTests(unittest.TestCase):
    def test_only_known_contracts_can_trigger_a_search(self):
        with self.assertRaisesRegex(ValueError, "not in the tracked"):
            select_target(SNAPSHOT, CONFIG, "solana:CbcyNo7m1amFWqEQm2m4PLv1UNvpcL3C1Ujm6AkzpKoU")
        self.assertEqual(select_target(SNAPSHOT, CONFIG, ID)["terms"],
                         [(ID.split(":")[1], "contract query"), ("UsePaid", "configured alias query")])

    def test_four_hour_cache_and_eight_hour_stale_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []

            def working(url):
                query = parse_qs(urlparse(url).query)["q"][0]
                calls.append(query)
                return feed() if "UsePaid" in query else b"<rss><channel></channel></rss>"

            first = collect_coin_evidence(SNAPSHOT, CONFIG, ID, directory, working, NOW)
            self.assertEqual(first["posts6h"], 1)
            self.assertEqual(first["posts"][0]["reason"], "configured alias query")
            self.assertEqual(len(calls), 2)
            cached = collect_coin_evidence(SNAPSHOT, CONFIG, ID, directory, working, NOW+FRESH_MS-1)
            self.assertEqual(cached["cacheStatus"], "fresh")
            self.assertEqual(len(calls), 2)

            def broken(_):
                calls.append("failed")
                raise OSError("RSS unavailable")

            stale = collect_coin_evidence(SNAPSHOT, CONFIG, ID, directory, broken, NOW+FRESH_MS+1)
            self.assertEqual(stale["cacheStatus"], "stale")
            self.assertEqual(len(calls), 4)
            again = collect_coin_evidence(SNAPSHOT, CONFIG, ID, directory, broken, NOW+STALE_MS-1)
            self.assertEqual(again["cacheStatus"], "stale")
            self.assertEqual(len(calls), 4)
            expired = collect_coin_evidence(SNAPSHOT, CONFIG, ID, directory, broken, NOW+STALE_MS+2)
            self.assertEqual(expired["status"], "error")


if __name__ == "__main__":
    unittest.main()
