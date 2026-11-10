import unittest
import asyncio
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, AsyncMock, Mock
from datetime import datetime, timezone
from worker.stock import STOCK_UNIVERSE_VERSION, parse_btc_closes, parse_chart, report

class StockTest(unittest.TestCase):
    def test_partial_session_excluded_and_adjusted_used(self):
        now = datetime(2026, 10, 30, 18, tzinfo=timezone.utc).timestamp()
        stamps = [now - i * 86400 for i in range(100, -1, -1)]
        chart = {'chart': {'result': [{'timestamp': stamps, 'meta': {'currentTradingPeriod': {'regular': {'end': now + 7200}}}, 'indicators': {'adjclose': [{'adjclose': [100]*101}], 'quote': [{'close': [200]*101}]}}]}}
        rows = parse_chart(chart, now)
        self.assertEqual(len(rows), 100)
        self.assertEqual(rows[-1]['date'], '2026-10-29')
        self.assertEqual(rows[-1]['close'], 100)
        self.assertEqual(len(parse_chart(chart, now + 9000)), 101)

    def test_fresh_cache_avoids_source_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            cached = {'series': {'SPY': []}, 'retryAt': 2000, 'savedAt': 1000, 'status': 'daily',
                      'universeVersion': STOCK_UNIVERSE_VERSION}
            Path(directory, 'sectors.json').write_text(json.dumps(cached))
            with patch('httpx.AsyncClient') as client:
                self.assertEqual(asyncio.run(report(directory, now=1100)), cached)
                client.assert_not_called()

    def test_legacy_cache_refresh_accepts_short_spacex_history_and_tolerates_missing_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory, 'sectors.json')
            file.write_text(json.dumps({'series': {'SPY': []}, 'retryAt': 2000, 'extraEtfsChecked': True}))
            with patch('httpx.AsyncClient') as client, patch('worker.stock.parse_chart') as parse:
                get = client.return_value.__aenter__.return_value.get
                response = Mock()

                async def fetch(url, **_):
                    if url.endswith(('/COPX', '/klines')):
                        raise RuntimeError('offline')
                    return response

                get.side_effect = fetch
                parse.side_effect = lambda payload, now, minimum, symbol: [{'date': '2026-11-09', 'close': minimum}]
                result = asyncio.run(report(directory, now=1100))
                self.assertEqual(result['status'], 'daily')
                self.assertEqual(result['series']['SPCX'][0]['close'], 1)
                self.assertEqual(result['series']['SPY'][0]['close'], 80)
                self.assertNotIn('COPX', result['series'])
                self.assertNotIn('BTCUSDT', result['series'])
                self.assertEqual(result['universeVersion'], STOCK_UNIVERSE_VERSION)

    def test_spacex_ignores_history_before_its_listing_and_rejects_the_old_etf(self):
        def timestamp(day):
            return datetime.fromisoformat(day + 'T14:00:00+00:00').timestamp()

        chart = {'timestamp': [timestamp('2026-04-06'), timestamp('2026-06-12')],
                 'meta': {'instrumentType': 'EQUITY'},
                 'indicators': {'adjclose': [{'adjclose': [25, 150]}]}}
        payload = {'chart': {'result': [chart]}}
        now = timestamp('2026-06-15')
        self.assertEqual(parse_chart(payload, now, minimum=1, symbol='SPCX'),
                         [{'date': '2026-06-12', 'close': 150}])
        chart['meta']['instrumentType'] = 'ETF'
        with self.assertRaisesRegex(ValueError, 'SpaceX equity'):
            parse_chart(payload, now, minimum=1, symbol='SPCX')

    def test_bitcoin_selects_the_completed_4pm_new_york_close_in_both_seasons(self):
        def candle(boundary, price):
            millis = int(datetime.fromisoformat(boundary).timestamp() * 1000)
            return [None, None, None, None, str(price), None, millis - 1]

        candles = [
            candle('2026-03-06T20:00:00+00:00', 100), candle('2026-03-06T21:00:00+00:00', 101),
            candle('2026-03-09T20:00:00+00:00', 102), candle('2026-03-09T21:00:00+00:00', 103),
            candle('2026-03-10T20:00:00+00:00', 104),
        ]
        now = datetime.fromisoformat('2026-03-10T19:59:00+00:00').timestamp()
        self.assertEqual(parse_btc_closes(candles, now),
                         [{'date': '2026-03-06', 'close': 101}, {'date': '2026-03-09', 'close': 102}])

    def test_provider_failure_retains_dated_snapshot_then_expires_it(self):
        with tempfile.TemporaryDirectory() as directory:
            cached = {'series': {'SPY': []}, 'retryAt': 1000, 'savedAt': 1000, 'fetchedAt': 'original'}
            file = Path(directory, 'sectors.json')
            file.write_text(json.dumps(cached))
            with patch('httpx.AsyncClient') as client:
                client.return_value.__aenter__ = AsyncMock(return_value=AsyncMock())
                client.return_value.__aexit__ = AsyncMock()
                client.return_value.__aenter__.return_value.get.side_effect = RuntimeError('offline')
                result = asyncio.run(report(directory, now=2000))
                self.assertEqual(result['series'], cached['series'])
                self.assertEqual(result['fetchedAt'], 'original')
                self.assertEqual(result['status'], 'delayed')
                result = asyncio.run(report(directory, now=1000 + 8*86400))
                self.assertNotIn('series', result)

if __name__ == '__main__':
    unittest.main()
