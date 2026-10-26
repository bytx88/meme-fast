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
                 observedAt=now-60000, priceChange1h=change, marketSource='DexScreener',
                 pool='pool-'+str(i),poolCreatedAt=now-2*HOUR)
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
        self.assertEqual(report['coverage'],dict(totalTokens=3,includedTokens=3,excludedTokens=0,exclusions={}))
        self.assertTrue(all(t['eligible'] and t['exclusionReason'] is None for t in report['basket']))
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

    def test_uncapped_shared_method_is_archived_and_not_recertified_by_migration(self):
        previous_method='shared-trending-1h-v1'
        old={'version':2,'method':previous_method,'basket':[{'id':'original','priceChange1h':17_361_910_275_994}],
             'readings':[{'at':NOW-24*HOUR,'meme':413_378_817_666.74445,'altDelta':2},
                         {'at':NOW-HOUR,'meme':1,'altDelta':3,'method':previous_method}],
             'basketHistory':[{'at':NOW-HOUR,'tokens':[{'original':True}]}],'updatedAt':NOW}
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'index.json';path.write_text(json.dumps(old))
            report=collect(path,FakeSources(),NOW)
        self.assertEqual(report['legacyMethods'][previous_method],old)
        self.assertEqual([row['method'] for row in report['readings']],[previous_method,previous_method,METHOD])
        self.assertEqual(report['readings'][0]['meme'],old['readings'][0]['meme'])
        self.assertEqual(report['readings'][0]['altDelta'],2)
        self.assertEqual(report['readings'][-1]['meme'],2)

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
            self.assertEqual(projected['coverage'],later['readings'][-1]['coverage'])
            # A retry can repair the public index without another source read.
            path.with_suffix('.public.json').unlink()
            collect(path,source,NOW+HOUR+1)
            self.assertTrue(path.with_suffix('.public.json').exists())
            self.assertEqual(source.calls,2)

    def test_extreme_returns_are_retained_but_never_published_as_basket_returns(self):
        for extreme in (1e308,sys.float_info.max):
            source=FakeSources()
            for row in source.stream['windows']['1h']['tokens']:row['priceChange1h']=extreme
            with tempfile.TemporaryDirectory() as folder:
                report=collect(Path(folder)/'index.json',source,NOW)
            self.assertIn('No qualified',report['error'])
            self.assertIsNone(report['readings'][-1]['meme'])
            self.assertEqual(report['inputQuality']['extremeReturnCount'],3)
            self.assertEqual([t['priceChange1h'] for t in report['basket']],[extreme]*3)
            self.assertEqual(report['readings'][-1]['inputQuality'],report['inputQuality'])
            self.assertEqual([t['weight'] for t in report['basket']],[None]*3)
            self.assertEqual(report['coverage']['exclusions'],{'unverified_extreme_return':3})
            self.assertEqual(report['readings'][-1]['altDelta'],1)
            self.assertEqual(report['readings'][-1]['btcDelta'],-.75)
            self.assertEqual(report['updatedAt'],NOW)
            self.assertEqual(source.alt_calls,1)

    def test_saved_agt_and_forest_extremes_do_not_distort_qualified_mean(self):
        for symbol,extreme in (('AGT',17_361_910_275_994),('FOREST',13_770_788_521_195)):
            source=FakeSources()
            source.stream['windows']['1h']['tokens'][0].update(symbol=symbol,priceChange1h=extreme)
            with self.subTest(symbol=symbol), tempfile.TemporaryDirectory() as folder:
                report=collect(Path(folder)/'index.json',source,NOW)
            self.assertIsNone(report['error'])
            self.assertEqual(report['readings'][-1]['meme'],5)
            self.assertEqual(report['readings'][-1]['constituents'],2)
            excluded=report['basket'][0]
            self.assertEqual(excluded['priceChange1h'],extreme)
            self.assertFalse(excluded['eligible'])
            self.assertEqual(excluded['exclusionReason'],'unverified_extreme_return')
            self.assertIsNone(excluded['weight'])
            self.assertEqual([t['weight'] for t in report['basket'][1:]],[.5,.5])
            self.assertEqual(report['coverage'],dict(totalTokens=3,includedTokens=2,excludedTokens=1,
                                                    exclusions={'unverified_extreme_return':1}))

    def test_pool_must_have_a_full_hour_at_observation_not_at_collection_time(self):
        for pool_age,eligible in ((HOUR-1,False),(HOUR,True),(HOUR+1,True)):
            source=FakeSources()
            row=source.stream['windows']['1h']['tokens'][0]
            row['poolCreatedAt']=row['observedAt']-pool_age
            with self.subTest(pool_age=pool_age), tempfile.TemporaryDirectory() as folder:
                report=collect(Path(folder)/'index.json',source,NOW)
            self.assertEqual(report['basket'][0]['eligible'],eligible)
            self.assertEqual(report['basket'][0]['poolCreatedAt'],row['poolCreatedAt'])
            self.assertEqual(report['basket'][0]['pool'],row['pool'])
            self.assertEqual(report['readings'][-1]['meme'],2 if eligible else 5)
            self.assertEqual(report['coverage']['exclusions'],{} if eligible else {'incomplete_1h_window':1})

    def test_unknown_pool_identity_or_age_are_excluded_without_replacing_returns(self):
        cases=[({'pool':value},'missing_pool') for value in (None,'','  ',False,123)]
        cases.extend(({'poolCreatedAt':value},'unknown_pool_age')
                     for value in (None,0,-1,True,'old',float('nan'),float('inf'),NOW,NOW+1))
        for mutation,reason in cases:
            source=FakeSources()
            source.stream['windows']['1h']['tokens'][0].update(mutation)
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as folder:
                report=collect(Path(folder)/'index.json',source,NOW)
            self.assertIsNone(report['error'])
            self.assertEqual(report['readings'][-1]['meme'],5)
            self.assertEqual(report['basket'][0]['priceChange1h'],-4)
            self.assertEqual(report['basket'][0]['exclusionReason'],reason)
            self.assertIsNone(report['basket'][0]['weight'])
            self.assertEqual(report['coverage']['exclusions'],{reason:1})

    def test_threshold_and_loss_boundaries_are_included_without_clipping(self):
        source=FakeSources()
        for row,value in zip(source.stream['windows']['1h']['tokens'],[-100,10_000,0]):
            row['priceChange1h']=value
        with tempfile.TemporaryDirectory() as folder:
            report=collect(Path(folder)/'index.json',source,NOW)
        self.assertEqual(report['readings'][-1]['meme'],3300)
        self.assertEqual([t['priceChange1h'] for t in report['basket']],[-100,10_000,0])
        self.assertEqual(report['coverage']['includedTokens'],3)
        self.assertEqual(report['inputQuality']['extremeReturnCount'],0)

    def test_all_immature_members_keep_alt_btc_live_and_preserve_raw_basket(self):
        source=FakeSources()
        for row in source.stream['windows']['1h']['tokens']:
            row['poolCreatedAt']=row['observedAt']-HOUR+1
        with tempfile.TemporaryDirectory() as folder:
            report=collect(Path(folder)/'index.json',source,NOW)
        reading=report['readings'][-1]
        self.assertIsNone(reading['meme'])
        self.assertEqual(reading['altDelta'],1)
        self.assertEqual(reading['btcDelta'],-.75)
        self.assertEqual(report['updatedAt'],NOW)
        self.assertEqual(report['coverage']['includedTokens'],0)
        self.assertEqual(report['coverage']['exclusions'],{'incomplete_1h_window':3})
        self.assertEqual([t['priceChange1h'] for t in report['basket']],[-4,0,10])
        self.assertEqual(report['basketHistory'][-1]['tokens'],report['basket'])
        self.assertIn('Alt/BTC updated independently',report['error'])

    def test_unqualified_reading_can_recover_same_hour_without_rewriting_original(self):
        source=FakeSources()
        for row in source.stream['windows']['1h']['tokens']:
            row['poolCreatedAt']=None
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'index.json'
            first=collect(path,source,NOW)
            first_reading=copy.deepcopy(first['readings'][-1])
            first_basket=copy.deepcopy(first['basketHistory'][-1])
            self.assertIsNone(first_reading['meme'])
            source.advance(NOW+60000)
            for row in source.stream['windows']['1h']['tokens']:
                row['poolCreatedAt']=NOW-2*HOUR
            recovered=collect(path,source,NOW+60000)
            self.assertEqual(recovered['readings'][0],first_reading)
            self.assertEqual(recovered['basketHistory'][0],first_basket)
            self.assertEqual([row['at'] for row in recovered['readings']],[NOW,NOW+60000])
            self.assertEqual(recovered['readings'][-1]['meme'],2)
            self.assertEqual(recovered['readings'][-1]['altDelta'],first_reading['altDelta'])
            self.assertEqual(recovered['readings'][-1]['btcDelta'],first_reading['btcDelta'])
            self.assertIsNone(recovered['error'])
            self.assertEqual(recovered['coverage']['includedTokens'],3)
            self.assertEqual(source.calls,2)
            self.assertEqual(source.alt_calls,2)
            next_retry=collect(path,source,NOW+60001)
            self.assertEqual(next_retry,recovered)
            self.assertEqual(source.calls,2)
            self.assertEqual(source.alt_calls,2)

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
