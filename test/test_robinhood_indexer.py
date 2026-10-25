import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

module_path = Path(__file__).resolve().parents[1] / "worker" / "robinhood_indexer.py"
spec = importlib.util.spec_from_file_location("robinhood_indexer", module_path)
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)


def word(address):
    return "0x" + "0" * 24 + address[2:]


class RobinhoodIndexerTest(unittest.TestCase):
    def test_decodes_v2_v3_v4_pool_events(self):
        token0, token1 = "0x" + "1" * 40, "0x" + "2" * 40
        pool, pool_id = "0x" + "3" * 40, "0x" + "4" * 64
        for source in indexer.SOURCES:
            name, emitter, topic = source
            topics = [topic, pool_id, word(token0), word(token1)] if name == "uniswap_v4" else [topic, word(token0), word(token1)]
            data = "0x" + ("0" * 64 if name == "uniswap_v3" else "") + word(pool)[2:]
            log = {"address": emitter, "topics": topics, "data": data, "blockNumber": "0x20"}
            row = indexer.decode_log(log, source)
            self.assertEqual(row[2], pool_id if name == "uniswap_v4" else pool)
            self.assertEqual(row[3:5], (token0, token1))

    def test_scan_persists_pool_and_resumes_cursor(self):
        token0, token1, pool = "0x" + "1" * 40, "0x" + "2" * 40, "0x" + "3" * 40
        source = indexer.SOURCES[0]
        log = {"address": source[1], "topics": [source[2], word(token0), word(token1)],
               "data": word(pool) + "0" * 64, "blockNumber": "0x20"}

        def fake_rpc(method, params=None):
            if method == "eth_chainId":
                return "0x1237"
            if method == "eth_blockNumber":
                return "0x1000000"
            return [log] if params[0]["address"] == source[1] else []

        with tempfile.TemporaryDirectory() as directory, patch.object(indexer, "rpc", fake_rpc):
            db = indexer.open_db(Path(directory) / "pools.sqlite")
            try:
                first = indexer.scan(db, now=1000)
                cursor = first["status"]["cursors"][source[0]]["backfill"]
                self.assertEqual(indexer.query(db, token0)["pools"][0]["pool"], pool)
                second = indexer.scan(db, now=2000)
                third = indexer.scan(db, now=3000)
                fourth = indexer.scan(db, now=4000)
                self.assertEqual([result["status"]["scannedSource"] for result in (first, second, third, fourth)],
                                 ["uniswap_v2", "uniswap_v3", "uniswap_v4", "uniswap_v2"])
                self.assertEqual(fourth["status"]["count"], 1)
                self.assertGreater(fourth["status"]["cursors"][source[0]]["backfill"], cursor)
            finally:
                db.close()

    def test_rpc_limit_keeps_catalog_available_and_reports_failure(self):
        token = "0x" + "1" * 40
        with tempfile.TemporaryDirectory() as directory, patch.object(indexer, "rpc", side_effect=RuntimeError("rate limited")):
            db = indexer.open_db(Path(directory) / "pools.sqlite")
            try:
                db.execute("INSERT INTO pools (id, source, pool, token0, token1, block) VALUES (?, ?, ?, ?, ?, ?)",
                           ("uniswap_v2:pool", "uniswap_v2", "pool", token, "0x" + "2" * 40, 32))
                result = indexer.scan(db, now=1000)
                self.assertEqual(result["status"]["count"], 1)
                self.assertEqual(result["status"]["errors"], {"rpc": "rate limited"})
                self.assertEqual(result["status"]["scannedSource"], None)
                self.assertEqual(len(result["pools"]), 1)
            finally:
                db.close()

    def test_refresh_queue_keeps_null_first_order_and_limit_without_sorting_catalog(self):
        now = 100_000_000
        cutoff = now - 6 * 3600000
        with tempfile.TemporaryDirectory() as directory, patch.object(indexer, "rpc", side_effect=RuntimeError("offline")):
            db = indexer.open_db(Path(directory) / "pools.sqlite")
            try:
                rows = [(f"pool-{i}", "uniswap_v2", f"pool-{i}", "token0", "token1", i,
                         None if i < 65 else cutoff - 1 if i < 85 else cutoff)
                        for i in range(105)]
                db.executemany("INSERT INTO pools (id, source, pool, token0, token1, block, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
                selection = "SELECT id, pool, token0, token1 FROM pools WHERE checked_at IS NULL OR checked_at < ? ORDER BY checked_at NULLS FIRST, block DESC LIMIT 60"
                plan = " ".join(row[3] for row in db.execute("EXPLAIN QUERY PLAN " + selection, (cutoff,)))
                self.assertNotIn("TEMP B-TREE", plan)
                first = indexer.scan(db, now=now)
                self.assertEqual([row["pool"] for row in first["pools"]], [f"pool-{i}" for i in range(64, 4, -1)])
                second = indexer.scan(db, now=now)
                self.assertEqual([row["pool"] for row in second["pools"]],
                                 [f"pool-{i}" for i in range(4, -1, -1)] + [f"pool-{i}" for i in range(84, 64, -1)])
                self.assertEqual(indexer.scan(db, now=now)["pools"], [])
                self.assertEqual(first["status"]["count"], 105)
            finally:
                db.close()


if __name__ == "__main__":
    unittest.main()
