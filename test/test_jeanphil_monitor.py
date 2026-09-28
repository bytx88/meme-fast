import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
from jeanphil_monitor import CONTRACT, collect, market_sample, social_sample


NOW = 1_790_000_000_000


def pair(price="0.004"):
    return {"pairs": [{"chainId": "solana", "baseToken": {"address": CONTRACT},
                       "pairAddress": "pool", "priceUsd": price, "marketCap": 4000000,
                       "liquidity": {"usd": 200000}, "volume": {"m5": 500},
                       "txns": {"m5": {"buys": 4, "sells": 2}}}]}


class JeanPhilMonitorTest(unittest.TestCase):
    def test_exact_contract_market_and_history(self):
        self.assertEqual(market_sample(NOW, lambda _: pair())["priceUsd"], .004)
        wrong = pair()
        wrong["pairs"][0]["baseToken"]["address"] = "copycoin"
        with self.assertRaises(ValueError):
            market_sample(NOW, lambda _: wrong)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "monitor.json"
            def empty_rss(_):
                return b"<rss><channel></channel></rss>"
            first = collect(path, NOW, lambda _: pair(), empty_rss)
            second = collect(path, NOW + 300000, lambda _: pair("0.005"), empty_rss)
            self.assertEqual(len(first["social"]), 1)
            self.assertEqual(len(second["social"]), 1)  # Social is sampled at a slower cadence.
            self.assertEqual([row["priceUsd"] for row in second["market"]], [.004, .005])
            self.assertEqual(json.loads(path.read_text())["market"][-1]["priceUsd"], .005)

    def test_social_failure_does_not_invent_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "monitor.json"
            report = collect(path, NOW, lambda _: pair(), lambda _: (_ for _ in ()).throw(OSError("offline")))
            self.assertEqual(report["social"], [])
            self.assertIn("social", report["errors"])
            self.assertEqual(len(report["market"]), 1)


if __name__ == "__main__":
    unittest.main()
