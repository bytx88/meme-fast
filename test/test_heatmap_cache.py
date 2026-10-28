import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from urllib.error import HTTPError
from email.message import Message
from email.utils import formatdate
from worker.liquidation_heatmap import cached_load, retry_seconds


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'cache.sqlite'
        self.now = 1793193000
        self.body = dict(updated=self.now*1000, symbol='BTCUSDT', times=[1, 2], providerCacheSeconds=120)

    def read(self, now, fetch, symbol='BTCUSDT', days=30):
        return cached_load(self.path, days, symbol, fetch=fetch, now=now)

    def test_saved_snapshot_is_shared_and_refresh_cannot_bypass_ttl(self):
        fetch = Mock(return_value=self.body)
        self.read(self.now, fetch)
        reply = self.read(self.now+299, fetch)
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(reply['body']['cache']['state'], 'fresh')
        self.assertEqual(reply['body']['updated'], self.body['updated'])

    def test_failure_returns_last_good_without_retimestamping(self):
        self.read(self.now, Mock(return_value=self.body))
        failure = Mock(side_effect=TimeoutError())
        reply = self.read(self.now+301, failure)
        self.assertEqual(reply['status'], 200)
        self.assertEqual(reply['body']['cache']['state'], 'stale')
        self.assertEqual(reply['body']['updated'], self.body['updated'])
        self.read(self.now+302, failure)
        self.assertEqual(failure.call_count, 1)

    def test_provider_cooldown_spans_ranges_and_survives_new_connection(self):
        headers = Message()
        headers['Retry-After'] = '900'
        failure = Mock(side_effect=HTTPError('https://provider/', 429, 'Limited', headers, None))
        first = self.read(self.now, failure)
        other = self.read(self.now+10, failure, days=7)
        self.assertEqual(first['status'], 503)
        self.assertEqual(first['retryAfter'], 900)
        self.assertEqual(other['retryAfter'], 890)
        self.assertEqual(failure.call_count, 1)
        gold = Mock(return_value={**self.body, 'symbol':'XAUUSDT'})
        self.assertEqual(self.read(self.now+10, gold, symbol='XAUUSDT')['status'], 200)

    def test_fallback_expires_after_24_hours(self):
        self.read(self.now, Mock(return_value=self.body))
        reply = self.read(self.now+86401, Mock(side_effect=TimeoutError()))
        self.assertEqual(reply['status'], 503)
        self.assertNotIn('updated', reply['body'])

    def test_honors_longer_cache_control_and_retry_dates(self):
        fetch = Mock(return_value={**self.body, 'providerCacheSeconds':600})
        self.read(self.now, fetch)
        self.read(self.now+599, fetch)
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(retry_seconds(formatdate(self.now+1200, usegmt=True), self.now),1200)
        self.assertEqual(retry_seconds('invalid', self.now),300)

    def test_failed_refresh_never_overwrites_saved_snapshot(self):
        self.read(self.now, Mock(return_value=self.body))
        self.read(self.now+301, Mock(side_effect=ValueError('Malformed provider payload')))
        later = self.read(self.now+310, Mock(side_effect=AssertionError('Must not call provider')))
        self.assertEqual(later['body']['updated'], self.body['updated'])

    def test_cache_keys_keep_symbols_and_ranges_separate(self):
        first = self.read(self.now, Mock(return_value={**self.body, 'marker':'30d'}))
        second = self.read(self.now, Mock(return_value={**self.body, 'marker':'7d'}), days=7)
        self.assertEqual(first['body']['marker'],'30d')
        self.assertEqual(second['body']['marker'],'7d')


if __name__ == '__main__':
    unittest.main()
