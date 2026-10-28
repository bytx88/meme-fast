import copy
import unittest
from unittest.mock import patch, MagicMock
import json
import worker.liquidation_heatmap as feed
from worker.liquidation_heatmap import validate, load


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
        response.__enter__.return_value.read.return_value = json.dumps(self.data).encode()
        with patch.dict(feed._cache, clear=True), patch('time.time', return_value=self.now/1000), patch('urllib.request.urlopen', return_value=response) as fetch:
            first = load(30)
            second = load(30)
            self.assertIs(first, second)
            fetch.assert_called_once()


if __name__ == '__main__':
    unittest.main()
