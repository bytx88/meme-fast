import json
import unittest
from types import SimpleNamespace
from worker.market_proxy import MarketProxy


class CandleProxyTests(unittest.IsolatedAsyncioTestCase):
    async def test_object_candles_cache_and_invalid_responses_fail(self):
        calls = []
        payload = {"data": {"attributes": {"ohlcv_list": [[1, 1, 1, 1, 1, 10]]}}}

        async def fetch(url):
            calls.append(url)
            return SimpleNamespace(status_code=200, headers={}, content=json.dumps(payload).encode(), json=lambda: payload)

        proxy = MarketProxy(fetch)
        path = '/networks/robinhood/pools/abc/ohlcv/minute?aggregate=15&limit=1000&currency=usd&token=abc'
        self.assertEqual((await proxy.get(path))[0], 200)
        self.assertEqual((await proxy.get(path))[0], 200)
        self.assertEqual(len(calls), 1)
        payload['data'] = {}
        self.assertEqual((await MarketProxy(fetch).get(path))[0], 502)


if __name__ == '__main__':
    unittest.main()
