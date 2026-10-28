import copy
import unittest
from unittest.mock import patch, MagicMock
import json
import base64
import worker.liquidation_heatmap as feed
from worker.liquidation_heatmap import validate, load, normalize_gold, normalize_swole


class HeatmapTests(unittest.TestCase):
    def setUp(self):
        self.now = 1793193000000
        self.data = dict(times=[self.now-3600000, self.now], nbins=2,
                         price_lo=70000, price_hi=90000,
                         matrix=[[0, 10], [20, 0]], ohlc=[[80000, 81000, 79000, 80500]]*2,
                         profile_long=[20, 0], profile_short=[0, 10], updated=self.now,
                         exchanges=['binance', 'untrusted'])

    def test_preserves_profiles_and_reports_actual_coverage(self):
        report = validate(self.data, 30, self.now)
        self.assertEqual(report['profile_long'], [20, 0])
        self.assertEqual(report['exchanges'], ['binance'])
        self.assertLess(report['coverageDays'], 1)
        self.assertTrue(report['estimated'])

    def test_rejects_corruption_and_stale_observations(self):
        for field, value in [('times', [self.now, self.now]), ('matrix', [[0, 1]]),
                             ('profile_long', [float('nan'), 0]), ('price_hi', 60000),
                             ('ohlc', [[80000, 79000, 81000, 80500]]*2),
                             ('updated', self.now-900001), ('times', [self.now-10800000, self.now-7200000])]:
            with self.subTest(field=field, value=value):
                broken = copy.deepcopy(self.data)
                broken[field] = value
                with self.assertRaises(ValueError):
                    validate(broken, 30, self.now)

    def test_accepts_fresh_capture_with_forward_rounded_bucket(self):
        self.data['times'] = [self.now-600000, self.now+300000]
        self.assertEqual(validate(self.data, 1, self.now)['updated'], self.now)

    def test_unsupported_ranges_never_fetch(self):
        with patch('urllib.request.urlopen') as fetch:
            with self.assertRaises(ValueError):
                load(999)
            fetch.assert_not_called()

    def test_repeated_reads_reuse_cached_observation(self):
        response = MagicMock()
        response.__enter__.return_value.headers.get.return_value = ''
        payload = {**self.gold_payload(), 'coin': 'BTC'}
        response.__enter__.return_value.read.return_value = json.dumps(payload).encode()
        with patch.dict(feed._cache, clear=True), patch('time.time', return_value=self.now/1000), patch('urllib.request.urlopen', return_value=response) as fetch:
            first = load(30)
            second = load(30)
            self.assertIs(first, second)
            self.assertEqual(first['source'], 'Swolecharts')
            self.assertIn('/liquidation-heatmap/btc?', fetch.call_args.args[0].full_url)
            fetch.assert_called_once()

    def gold_payload(self):
        return dict(coin='XAU', cols=2, rows=3, y0=100, ratio=1.01, cap=25500,
                    cells=base64.b64encode(bytes([0, 127, 255, 255, 127, 0])).decode(),
                    candles=dict(o=[101, None], h=[102, None], l=[100, None], c=[101.5, None]),
                    price=101.5, price_as_of=self.now, t0=self.now-60000, dt=60000, as_of=self.now)

    def test_gold_preserves_quantization_log_bins_and_missing_candles(self):
        with patch('time.time', return_value=self.now/1000):
            report = normalize_gold(self.gold_payload(), 1)
        self.assertEqual(report['matrix'][0][2], 25500)
        self.assertAlmostEqual(report['matrix'][1][1], 25500 * (127/255)**2)
        self.assertEqual(report['profile_long'][0], 25500)
        self.assertEqual(report['profile_short'][0], 0)
        self.assertEqual(report['ohlc'][-1], None)
        self.assertEqual(report['current_price'], 101.5)
        self.assertAlmostEqual(report['price_edges'][2], 102.01)
        self.assertEqual(report['source'], 'Swolecharts')

    def test_gold_rejects_wrong_asset_stale_price_and_truncated_cells(self):
        for key, value in [('coin', 'BTC'), ('price_stale', True), ('cells', 'AAAA'),
                           ('price_as_of', self.now-3600001)]:
            data = self.gold_payload()
            data[key] = value
            with self.subTest(key=key), patch('time.time', return_value=self.now/1000), self.assertRaises(ValueError):
                normalize_gold(data, 1)

    def test_market_cache_does_not_return_btc_for_gold(self):
        response = MagicMock()
        response.__enter__.return_value.headers.get.return_value = ''
        response.__enter__.return_value.read.return_value = json.dumps(self.gold_payload()).encode()
        with patch.dict(feed._cache, {('BTCUSDT', 1): (float('inf'), {'symbol': 'BTCUSDT'})}, clear=True), patch('time.time', return_value=self.now/1000), patch('urllib.request.urlopen', return_value=response) as fetch:
            report = load(1, 'XAUUSDT')
            self.assertEqual(report['symbol'], 'XAUUSDT')
            self.assertIn('range=24h', fetch.call_args.args[0].full_url)
            with self.assertRaises(ValueError):
                load(1, 'UNSUPPORTED')

    def test_btc_never_uses_gold_payload_or_attribution(self):
        with patch('time.time', return_value=self.now/1000):
            with self.assertRaises(ValueError):
                normalize_swole(self.gold_payload(), 30, 'BTC')
            report = normalize_swole({**self.gold_payload(), 'coin':'BTC'}, 30, 'BTC')
        self.assertTrue(report['sourceUrl'].endswith('/BTC'))
        self.assertIn('BTC perpetual', report['scope'])

    def test_dated_snapshot_can_initialize_cache_with_original_timestamp(self):
        old = self.gold_payload()
        old['coin'] = 'BTC'
        for key in ('as_of', 'price_as_of', 't0'):
            old[key] -= 3600000
        with patch('time.time', return_value=self.now/1000):
            with self.assertRaises(ValueError):
                normalize_swole(old, 30, 'BTC')
            result = normalize_swole(old, 30, 'BTC', max_age_ms=86400000)
            self.assertEqual(result['updated'], self.now-3600000)
            old['as_of'] = self.now-86400001
            with self.assertRaises(ValueError):
                normalize_swole(old, 30, 'BTC', max_age_ms=86400000)

    def test_recent_model_capture_does_not_hide_an_old_price_timestamp(self):
        payload = self.gold_payload()
        payload['price_as_of'] = self.now-1800000
        with patch('time.time', return_value=self.now/1000):
            with self.assertRaises(ValueError):
                normalize_gold(payload, 30)
            report = normalize_swole(payload, 30, 'XAU', max_age_ms=86400000)
        self.assertEqual(report['updated'], payload['price_as_of'])


if __name__ == '__main__':
    unittest.main()
