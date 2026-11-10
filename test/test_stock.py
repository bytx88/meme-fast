import unittest
import asyncio
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, AsyncMock, Mock
from datetime import datetime, timezone
from worker.stock import parse_chart, report

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
            cached = {'series': {'SPY': []}, 'retryAt': 2000, 'savedAt': 1000, 'status': 'daily', 'extraEtfsChecked': True}
            Path(directory, 'sectors.json').write_text(json.dumps(cached))
            with patch('httpx.AsyncClient') as client:
                self.assertEqual(asyncio.run(report(directory, now=1100)), cached)
                client.assert_not_called()

    def test_legacy_cache_refresh_accepts_short_etf_history_and_tolerates_missing_etf(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory, 'sectors.json')
            file.write_text(json.dumps({'series': {'SPY': []}, 'retryAt': 2000}))
            with patch('httpx.AsyncClient') as client, patch('worker.stock.parse_chart') as parse:
                get = client.return_value.__aenter__.return_value.get
                response = Mock()

                async def fetch(url, **_):
                    if url.endswith('/COPX'):
                        raise RuntimeError('offline')
                    return response

                get.side_effect = fetch
                parse.side_effect = lambda payload, now, minimum: [{'date': '2026-11-09', 'close': minimum}]
                result = asyncio.run(report(directory, now=1100))
                self.assertEqual(result['status'], 'daily')
                self.assertEqual(result['series']['GLD'][0]['close'], 1)
                self.assertEqual(result['series']['SPY'][0]['close'], 80)
                self.assertNotIn('COPX', result['series'])
                self.assertTrue(result['extraEtfsChecked'])

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
