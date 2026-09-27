import asyncio
import json
import subprocess
import unittest
from pathlib import Path

from worker.market_proxy import MarketProxy
from worker.snapshot_view import snapshot_view, snapshot_version


class FakeResponse:
    def __init__(self, status=200, data=None, headers=None):
        self.status_code = status
        self.content = json.dumps(data if data is not None else {"data": []}).encode()
        self.headers = headers or {}

    def json(self):
        return json.loads(self.content)


class SnapshotViewTests(unittest.TestCase):
    def test_views_and_revision(self):
        now = 1800000000000
        coin = {"id": "solana:ABC", "firstSeen": now, "lastSeenRadarAt": now,
                "marketHistory": [{"at": now}], "marketHistoryHourly": [], "priceHistory5m": []}
        snapshot = {"version": 2, "revision": f"{now}:2", "lastRun": now,
                    "coins": [coin], "radarCoins": [coin], "feeds": {}}
        self.assertEqual(snapshot_version(snapshot), {"revision": f"{now}:2", "lastRun": now})
        self.assertNotIn("marketHistory", snapshot_view(snapshot, "coin", now_ms=now)["coins"][0])
        self.assertEqual(len(snapshot_view(snapshot, "coin", now_ms=now)["coins"][0]["flowSamples"]), 1)
        self.assertNotIn("radarCoins", snapshot_view(snapshot, "coin", now_ms=now))
        self.assertEqual(snapshot_view(snapshot, "radar", now_ms=now)["coins"], [])
        self.assertEqual(len(snapshot_view(snapshot, "radar", now_ms=now)["radarCoins"]), 1)
        self.assertEqual(snapshot_view(snapshot, "watchlist", ["solana:ABC"], now_ms=now)["coins"][0]["id"], "solana:ABC")
        with self.assertRaises(ValueError):
            snapshot_view(snapshot, "watchlist", [], now_ms=now)

    def test_python_and_javascript_projections_match(self):
        now = 1800000000000
        coin = {"id": "solana:ABC", "network": "solana", "contract_address": "ABC",
                "firstSeen": now, "lastSeenRadarAt": now, "marketHistory": [{"at": now}]}
        snapshot = {"version": 2, "revision": f"{now}:2", "lastRun": now,
                    "coins": [coin], "radarCoins": [coin], "feeds": {}}
        script = (
            "import {snapshotView} from './worker/snapshot-view.mjs';"
            "let text='';for await(const chunk of process.stdin)text+=chunk;"
            "const {snapshot,view,ids,now,name}=JSON.parse(text);"
            "console.log(JSON.stringify(snapshotView(snapshot,view,ids,now,name)));"
        )
        root = Path(__file__).resolve().parents[1]
        for view, ids, name in (("coin", [], ""), ("radar", [], ""), ("watchlist", ["solana:ABC"], ""), ("name", [], "Yee")):
            source = snapshot if view != "name" else {**snapshot, "coins": [{**coin, "name": " Yee "}],
                                                      "radarCoins": [{**coin, "name": "Yee", "id": "base:B", "lastSeenRadarAt": now}]}
            result = subprocess.run(
                ["node", "--input-type=module", "-e", script], cwd=root,
                input=json.dumps({"snapshot": source, "view": view, "ids": ids, "now": now, "name": name}),
                text=True, capture_output=True, check=True,
            )
            self.assertEqual(json.loads(result.stdout), snapshot_view(source, view, ids, now_ms=now, name=name))

    def test_early_ramp_projection_matches_javascript(self):
        now = 1790454627407
        history = [
            {"at": at, "priceUsd": price, "liquidity": liquidity,
             "buys5m": buys, "sells5m": sells}
            for at, price, liquidity, buys, sells in (
                (1790453421784, .00001395, 24269.82, 272, 65),
                (1790453720967, .00001853, 28016.51, 356, 89),
                (1790454020816, .00002299, 31275.76, 367, 90),
                (1790454319231, .00002532, 32886.15, 201, 88),
                (now, .00003127, 36645.88, 99, 91),
            )
        ]
        coin = {"id": "solana:PAID", "network": "solana", "contract_address": "PAID",
                "poolCreated": 1790453285000, "firstSeen": history[0]["at"],
                "marketHistory": history}
        snapshot = {"coins": [coin], "radarCoins": [], "lastRun": now}
        expected = snapshot_view(snapshot, "coin", now_ms=now)
        self.assertEqual(expected["coins"][0]["earlyRampWarning"], {"risePercent": 124, "minutes": 20})
        script = (
            "import {snapshotView} from './worker/snapshot-view.mjs';"
            "let text='';for await(const chunk of process.stdin)text+=chunk;"
            "const {snapshot,now}=JSON.parse(text);"
            "console.log(JSON.stringify(snapshotView(snapshot,'coin',[],now)));"
        )
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=Path(__file__).resolve().parents[1],
            input=json.dumps({"snapshot": snapshot, "now": now}), text=True, capture_output=True, check=True,
        )
        self.assertEqual(json.loads(result.stdout), expected)


class MarketProxyTests(unittest.IsolatedAsyncioTestCase):
    async def test_token_info_object_is_cached_for_holder_display(self):
        calls = 0

        async def fetch(_):
            nonlocal calls
            calls += 1
            return FakeResponse(data={"data": {"id": "robinhood_0x123", "attributes": {"holders": {"count": 12}}}})

        proxy = MarketProxy(fetch)
        path = "/networks/robinhood/tokens/0x123/info"
        self.assertEqual((await proxy.get(path))[0], 200)
        self.assertEqual((await proxy.get(path))[0], 200)
        self.assertEqual(calls, 1)

    async def test_inflight_cache_and_cooldown(self):
        now = 1000
        calls = []
        gate = asyncio.Event()

        async def fetch(url):
            calls.append(url)
            await gate.wait()
            if url.endswith("/limited"):
                return FakeResponse(429, headers={"retry-after": "120"})
            return FakeResponse(data={"data": [{"id": "actual"}]})

        proxy = MarketProxy(fetch, clock=lambda: now)
        first = asyncio.create_task(proxy.get("/cached"))
        second = asyncio.create_task(proxy.get("/cached"))
        await asyncio.sleep(0)
        gate.set()
        self.assertEqual((await first)[0], 200)
        self.assertEqual((await second)[0], 200)
        self.assertEqual(len(calls), 1)
        self.assertEqual((await proxy.get("/cached"))[0], 200)
        self.assertEqual(len(calls), 1)
        self.assertEqual((await proxy.get("/limited"))[0], 429)
        self.assertEqual((await proxy.get("/new"))[0], 429)
        self.assertEqual((await proxy.get("/cached"))[0], 200)
        self.assertEqual(len(calls), 2)

    async def test_invalid_response_is_not_cached(self):
        calls = 0

        async def fetch(_):
            nonlocal calls
            calls += 1
            return FakeResponse(data={"unexpected": True})

        proxy = MarketProxy(fetch)
        self.assertEqual((await proxy.get("/invalid"))[0], 502)
        self.assertEqual((await proxy.get("/invalid"))[0], 502)
        self.assertEqual(calls, 2)

    async def test_cancelled_caller_does_not_cancel_shared_fetch(self):
        gate = asyncio.Event()

        async def fetch(_):
            await gate.wait()
            return FakeResponse()

        proxy = MarketProxy(fetch)
        first = asyncio.create_task(proxy.get("/shared"))
        second = asyncio.create_task(proxy.get("/shared"))
        await asyncio.sleep(0)
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        gate.set()
        self.assertEqual((await second)[0], 200)
        self.assertEqual(proxy.inflight, {})
