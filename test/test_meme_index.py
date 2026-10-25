import copy
import sys
import json
import tempfile
import unittest
from pathlib import Path
from worker.meme_index import HOUR, METHOD, collect, public_report, alt_observation

NOW = 2_000_000_000_000

class FakeSources:
    def __init__(self, now=NOW):
        self.now, self.calls, self.alt_calls = now, 0, 0
        self.stream = {'marketAt':now,'windows':{'1h':{'tokens':[
            dict(id='solana:'+str(i), network='solana', contract_address=str(i), symbol=str(i),
                 observedAt=now-60000, priceChange1h=change, marketSource='DexScreener')
            for i,change in enumerate([-4,0,10])]}}}
    def trending(self):
        self.calls += 1
        return self.stream
    def alt(self, now):
        self.alt_calls += 1
        return dict(hourChange=1,btcDelta=-.75,providerAt=now,source='CoinLore top 25 alts')
    def advance(self, now):
        self.stream['marketAt'] = now
        for row in self.stream['windows']['1h']['tokens']:
            row['observedAt'] = now-60000

class IndexTests(unittest.TestCase):
    def test_shared_pool_reuses_every_member_and_original_timestamp(self):
        source = FakeSources()
        with tempfile.TemporaryDirectory() as folder:
            report = collect(Path(folder)/'index.json',source,NOW)
        self.assertIsNone(report['error'])
        self.assertEqual(report['method'],METHOD)
        self.assertEqual(len(report['basket']),3)
        self.assertEqual(report['readings'][-1]['meme'],2)
        self.assertEqual(report['marketObservedAt'],NOW-60000)
        self.assertEqual([t['weight'] for t in report['basket']],[1/3]*3)
        self.assertEqual(source.alt_calls,1)

    def test_once_per_hour_and_membership_refreshes_each_hour(self):
        source = FakeSources()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'index.json'
            collect(path,source,NOW)
            collect(path,source,NOW+1)
            self.assertEqual(source.calls,1)
            source.advance(NOW+HOUR)
            source.stream['windows']['1h']['tokens'].pop()
            later=collect(path,source,NOW+HOUR)
            self.assertEqual(len(later['basket']),2)
            self.assertEqual(later['readings'][-1]['meme'],-2)
            self.assertEqual(len(later['readings']),2)

    def test_missing_invalid_or_stale_member_withholds_complete_reading(self):
        for invalid in (None,float('nan'),float('inf'),True,-101,'3'):
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as folder:
                source=FakeSources();path=Path(folder)/'index.json'
                first=collect(path,source,NOW)
                source.advance(NOW+HOUR)
                source.stream['windows']['1h']['tokens'][0]['priceChange1h']=invalid
                later=collect(path,source,NOW+HOUR)
                self.assertEqual(later['readings'],first['readings'])
                self.assertEqual(later['updatedAt'],NOW)
                self.assertEqual(source.alt_calls,1)
                self.assertIn('withheld',later['error'])
        for mutate in (lambda s:s.update(marketAt=NOW-900000),
                       lambda s:s.update(marketAt=NOW+1),
                       lambda s:s['windows']['1h'].update(tokens=[]),
                       lambda s:s['windows']['1h']['tokens'][0].update(observedAt=NOW+1),
                       lambda s:s['windows']['1h']['tokens'][0].update(observedAt=NOW-900000),
                       lambda s:s['windows']['1h']['tokens'][0].update(id='solana:1')):
            with tempfile.TemporaryDirectory() as folder:
                source=FakeSources();mutate(source.stream)
                report=collect(Path(folder)/'index.json',source,NOW)
                self.assertTrue(report['error'])
                self.assertEqual(report['readings'],[])
                self.assertEqual(source.alt_calls,0)

    def test_migration_preserves_original_history_without_certifying_old_method(self):
        old={'version':1,'basket':[{'id':'legacy'}],'readings':[{'at':NOW-24*HOUR,'meme':8,'altDelta':2}],
             'snapshots':[{'private':'retained'}],'updatedAt':NOW}
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'index.json';path.write_text(json.dumps(old))
            report=collect(path,FakeSources(),NOW)
        self.assertEqual(report['legacyMethods']['fomo-most-held-v1'],old)
        self.assertEqual(report['readings'][0]['method'],'fomo-most-held-v1')
        self.assertEqual(report['readings'][-1]['method'],METHOD)
        self.assertEqual(len(report['basket']),3)
        self.assertNotIn('legacyMethods',public_report(report))
        self.assertEqual(public_report(report)['method'],METHOD)

    def test_reading_retains_exact_inputs_privately_and_uses_small_public_index(self):
        source=FakeSources()
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'index.json'
            first=collect(path,source,NOW)
            self.assertEqual([t['priceChange1h'] for t in first['basket']],[-4,0,10])
            original=copy.deepcopy(first['basket'])
            source.advance(NOW+HOUR)
            source.stream['windows']['1h']['tokens'][0]['priceChange1h']=100
            later=collect(path,source,NOW+HOUR)
            self.assertEqual(later['basketHistory'][0]['tokens'],original)
            self.assertNotEqual(later['basketHistory'][1]['tokens'],original)
            projected=json.loads(path.with_suffix('.public.json').read_text())
            self.assertNotIn('basketHistory',projected)
            self.assertEqual(projected,public_report(later))
            # A retry can repair the public index without another source read.
            path.with_suffix('.public.json').unlink()
            collect(path,source,NOW+HOUR+1)
            self.assertTrue(path.with_suffix('.public.json').exists())
            self.assertEqual(source.calls,2)

    def test_extreme_return_diagnostic_preserves_all_values_and_avoids_sum_overflow(self):
        for extreme in (1e308,sys.float_info.max):
            source=FakeSources()
            for row in source.stream['windows']['1h']['tokens']:row['priceChange1h']=extreme
            with tempfile.TemporaryDirectory() as folder:
                report=collect(Path(folder)/'index.json',source,NOW)
            self.assertIsNone(report['error'])
            self.assertEqual(report['readings'][-1]['meme'],extreme)
            self.assertEqual(report['inputQuality']['extremeReturnCount'],3)
            self.assertEqual([t['priceChange1h'] for t in report['basket']],[extreme]*3)
            self.assertEqual(report['readings'][-1]['inputQuality'],report['inputQuality'])

    def test_btc_uses_existing_feed_and_keeps_missing_values_unavailable(self):
        rows = [{'id': str(i + 100), 'rank': i + 2, 'symbol': str(i),
                 'market_cap_usd': '100', 'percent_change_1h': '2'} for i in range(25)]
        btc = {'id': '90', 'rank': 1, 'symbol': 'BTC',
               'market_cap_usd': '100000', 'percent_change_1h': '-0.75'}
        result = alt_observation([btc, *rows], 2000000000000)
        self.assertEqual(result['btcDelta'], -0.75)
        self.assertAlmostEqual(result['hourChange'], 2)
        self.assertEqual(result['value'], 2500)
        for invalid in (None, 'NaN', 'Infinity', '-100', 'invalid'):
            self.assertIsNone(alt_observation([{**btc, 'percent_change_1h': invalid}, *rows], 1)['btcDelta'])
        self.assertIsNone(alt_observation(rows, 1)['btcDelta'])
        self.assertEqual(alt_observation([{**btc, 'percent_change_1h': '0'}, *rows], 1)['btcDelta'], 0)

    def test_broad_alt_sample_excludes_btc_eth_and_stables(self):
        now = 2_000_000_000_000
        rows = [{'id': str(i), 'rank': i, 'symbol': 'USDT' if i == 0 else str(i),
                 'market_cap_usd': '100', 'percent_change_1h': '2'} for i in range(26)]
        alt = alt_observation(rows, now)
        self.assertEqual(alt['value'], 2500)
        self.assertAlmostEqual(alt['hourChange'], 2)
        rows.pop()
        with self.assertRaises(ValueError):
            alt_observation(rows, now)
