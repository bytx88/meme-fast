import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from worker.market_benchmarks import collect, merge, SOURCE, HOUR

NOW = 1800000000000


class MarketBenchmarkTests(unittest.TestCase):
    def test_hourly_sampler_does_not_call_meme_sources_and_keeps_real_zero_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'benchmarks.json'
            sources = Mock()
            sources.alt.return_value = dict(hourChange=0, btcDelta=0, providerAt=NOW)
            first = collect(path, sources, NOW)
            self.assertEqual(first['readings'][0], dict(at=NOW,meme=None,altDelta=0,btcDelta=0,method=SOURCE))
            collect(path, sources, NOW+1000)
            sources.alt.assert_called_once()
            sources.fixed_quotes.assert_not_called()
            sources.history.assert_not_called()

    def test_failed_or_incomplete_reads_preserve_history_and_retry_without_inventing_zeroes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'benchmarks.json'
            source = Mock()
            source.alt.return_value = dict(hourChange=1,btcDelta=2,providerAt=NOW)
            first = collect(path, source, NOW)
            source.alt.side_effect = ValueError('provider failed')
            failed = collect(path, source, NOW+HOUR)
            self.assertEqual(failed['readings'],first['readings'])
            self.assertEqual(failed['updatedAt'],NOW)
            self.assertIsNotNone(failed['error'])
            source.alt.side_effect = None
            source.alt.return_value = dict(hourChange=None,btcDelta=None,providerAt=NOW+HOUR)
            self.assertEqual(collect(path,source,NOW+HOUR)['readings'],first['readings'])
            source.alt.return_value = dict(hourChange=3,btcDelta=-1,providerAt=NOW+HOUR)
            recovered = collect(path,source,NOW+HOUR)
            self.assertEqual(len(recovered['readings']),2)
            self.assertIsNone(recovered['error'])

    def test_partial_benchmarks_keep_the_available_reading_independent(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Mock()
            source.alt.return_value = dict(hourChange=1.25,btcDelta=None,providerAt=NOW)
            result = collect(Path(directory)/'benchmarks.json',source,NOW)
            self.assertEqual(result['readings'][0]['altDelta'],1.25)
            self.assertIsNone(result['readings'][0]['btcDelta'])

    def test_api_merge_preserves_saved_basket_and_comparison_evidence(self):
        saved = dict(method='fixed-preset',basket=[{'id':'BP'}],readings=[{'at':NOW-24*HOUR,'meme':7,'altDelta':1,'btcDelta':2}],
                     membershipReading={'evidence':'kept'})
        before = copy.deepcopy(saved)
        result = merge(saved,dict(readings=[dict(at=NOW,meme=None,altDelta=3,btcDelta=4,method=SOURCE)],updatedAt=NOW))
        self.assertEqual(saved,before)
        self.assertEqual(result['basket'],before['basket'])
        self.assertEqual(result['membershipReading'],before['membershipReading'])
        self.assertEqual(len(result['readings']),2)
