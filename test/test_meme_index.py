import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

from worker.meme_index import HOUR, METHOD, PRESET, Sources, collect, public_report, alt_observation, proxy_quotes

NOW = 2_000_000_000_000


def pair(member, change=1, now=NOW, **updates):
    row = dict(chainId=member['network'], baseToken=dict(address=member['contract_address'],symbol='PROVIDER'),
               quoteToken=dict(address='quote-address'), pairAddress='pool-'+member['symbol'],
               pairCreatedAt=now-2*HOUR, priceChange=dict(h1=change), liquidity=dict(usd=100_000),
               _sourceObservedAt=now-60_000)
    row.update(updates)
    return row


class FakeSources(Sources):
    def __init__(self, now=NOW):
        super().__init__(quotes=self.fetch)
        self.now, self.calls, self.alt_calls = now, [], 0
        self.pairs = [pair(member, index+1, now) for index, member in enumerate(PRESET)]
        self.pool_pairs = {}
        self.fail_networks = set()
        self.alt_error = False

    def fetch(self, network, addresses, scope='quotes'):
        self.calls.append((network, list(addresses), scope))
        if network in self.fail_networks:
            raise ValueError('source unavailable')
        values = self.pool_pairs.get(addresses[0], []) if scope == 'pools' else self.pairs
        # Deliberately return unrelated rows to exercise exact identity matching.
        return dict(value=copy.deepcopy(values), observedAt=self.now-60_000)

    def alt(self, now):
        self.alt_calls += 1
        if self.alt_error:
            raise ValueError('alt unavailable')
        return dict(hourChange=1,btcDelta=-.75,providerAt=now,source='CoinLore top 25 alts')

    def advance(self, now):
        self.now = now
        for row in self.pairs:
            row['_sourceObservedAt'] = now-60_000


class IndexTests(unittest.TestCase):
    def sample(self, source=None, now=NOW):
        with tempfile.TemporaryDirectory() as folder:
            return collect(Path(folder)/'index.json', source or FakeSources(now), now)

    def assert_fixed_roster(self, report):
        self.assertEqual([(row['chain'],row['address']) for row in report['basket']],
                         [(member['network'],member['contract_address']) for member in PRESET])
        self.assertEqual([row['symbol'] for row in report['basket']], [member['symbol'] for member in PRESET])
        self.assertEqual([row['weight'] for row in report['basket']], [1/11]*11)

    def test_exact_ordered_preset_and_method_identity_are_versioned(self):
        self.assertEqual([member['symbol'] for member in PRESET],
                         ['BP','STONK','PONS','CATE','SI','ANSEM','ZCAT','PURR','CASHCAT','NEARKAT','RAYCAT'])
        identities = [(member['network'],member['contract_address']) for member in PRESET]
        digest = hashlib.sha256(json.dumps(identities,separators=(',',':')).encode()).hexdigest()[:12]
        self.assertEqual(METHOD, 'fixed-preset-11-1h-v1-'+digest)
        self.assertRegex(METHOD, r'^fixed-preset-11-1h-v1-[0-9a-f]{12}$')
        self.assertEqual(len(set(identities)),11)

    def test_complete_fixed_mean_reuses_original_source_times_in_two_network_batches(self):
        source = FakeSources()
        report = self.sample(source)
        self.assertIsNone(report['error'])
        self.assertEqual(report['method'],METHOD)
        self.assert_fixed_roster(report)
        self.assertEqual(report['readings'][-1]['meme'],6)
        self.assertEqual(report['readings'][-1]['constituents'],11)
        self.assertEqual(report['marketObservedAt'],NOW-60_000)
        self.assertEqual(report['coverage'],dict(totalTokens=11,includedTokens=11,excludedTokens=0,exclusions={}))
        self.assertTrue(all(row['eligible'] and row['exclusionReason'] is None for row in report['basket']))
        self.assertEqual([(network,scope) for network,_,scope in source.calls],
                         [('solana','quotes'),('robinhood','quotes')])
        self.assertEqual([len(addresses) for _,addresses,_ in source.calls],[9,2])
        self.assertEqual(source.alt_calls,1)

    def test_membership_does_not_follow_provider_order_symbols_or_added_tokens(self):
        source=FakeSources()
        original=self.sample(source)
        source.pairs.reverse()
        source.pairs.append(pair(dict(network='solana',contract_address='stranger',symbol='NEW'),9e20))
        later=self.sample(source)
        self.assert_fixed_roster(later)
        self.assertEqual(later['basket'],original['basket'])
        self.assertEqual(later['readings'][-1]['meme'],6)

    def test_once_per_hour_and_missing_member_keeps_preset_and_denominator(self):
        source=FakeSources()
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'index.json'
            collect(path,source,NOW)
            collect(path,source,NOW+1)
            self.assertEqual(len(source.calls),2)
            source.advance(NOW+HOUR)
            source.pairs.pop(0)
            later=collect(path,source,NOW+HOUR)
        self.assert_fixed_roster(later)
        self.assertIsNone(later['readings'][-1]['meme'])
        self.assertEqual(later['basket'][0]['exclusionReason'],'missing_quote')
        self.assertEqual(later['coverage'],dict(totalTokens=11,includedTokens=10,excludedTokens=1,
                                                exclusions={'missing_quote':1}))
        self.assertEqual(later['readings'][-1]['altDelta'],1)
        self.assertEqual(later['readings'][-1]['btcDelta'],-.75)
        self.assertIn('reading withheld',later['error'])
        self.assertEqual(len(later['readings']),2)

    def test_invalid_and_missing_returns_withhold_complete_fixed_reading(self):
        for invalid,reason in ((None,'missing_return'),(float('nan'),'invalid_return'),
                               (float('inf'),'invalid_return'),(True,'invalid_return'),
                               (-101,'invalid_return'),('3','invalid_return')):
            source=FakeSources()
            source.pairs[0]['priceChange']['h1']=invalid
            with self.subTest(invalid=invalid):
                report=self.sample(source)
                self.assert_fixed_roster(report)
                self.assertIsNone(report['readings'][-1]['meme'])
                self.assertEqual(report['basket'][0]['exclusionReason'],reason)
                self.assertEqual(report['coverage']['includedTokens'],10)
                self.assertEqual(source.calls[-1],('solana',[PRESET[0]['contract_address']],'pools'))

    def test_source_timestamps_freshness_boundaries_are_not_receipt_times(self):
        for stamp,reason in ((None,'missing_observation'),(True,'missing_observation'),
                              (float('nan'),'missing_observation'),(NOW+1,'stale_quote'),
                              (NOW-900_000,'stale_quote')):
            source=FakeSources();source.pairs[0]['_sourceObservedAt']=stamp
            with self.subTest(stamp=stamp):
                report=self.sample(source)
                self.assertIsNone(report['readings'][-1]['meme'])
                self.assertEqual(report['basket'][0]['exclusionReason'],reason)
        source=FakeSources();source.pairs[0]['_sourceObservedAt']=NOW-899_999
        report=self.sample(source)
        self.assertEqual(report['readings'][-1]['meme'],6)
        self.assertEqual(report['basket'][0]['observedAt'],NOW-899_999)
        source=FakeSources();del source.pairs[0]['_sourceObservedAt']
        self.assertEqual(self.sample(source)['basket'][0]['observedAt'],NOW-60_000)

    def test_live_collection_accepts_source_observations_after_invocation_at_completion_time(self):
        source=FakeSources()
        def advancing_fetch(network,addresses,scope='quotes'):
            source.now+=2_000
            for row in source.pairs:row['_sourceObservedAt']=source.now
            return source.fetch(network,addresses,scope)
        source.quotes=advancing_fetch
        with tempfile.TemporaryDirectory() as folder, \
             patch('worker.meme_index.time.time',side_effect=lambda: source.now/1000):
            report=collect(Path(folder)/'index.json',source)
        self.assertEqual(report['attemptedAt'],NOW)
        self.assertEqual(report['readingAt'],NOW+4_000)
        self.assertEqual(report['readings'][-1]['at'],NOW+4_000)
        self.assertEqual(report['readings'][-1]['meme'],6)
        self.assertEqual(report['coverage']['includedTokens'],11)
        self.assertEqual(report['basket'][0]['observedAt'],NOW+2_000)
        self.assertEqual(report['basket'][2]['observedAt'],NOW+4_000)
        self.assertEqual(len(source.calls),2)

    def test_live_pool_discovery_validates_new_reply_at_receipt_without_restamping(self):
        source=FakeSources()
        valid=copy.deepcopy(source.pairs[0])
        source.pairs[0]['priceChange']={}
        def delayed_pool(network,addresses,scope='quotes'):
            if scope=='pools':
                source.now+=5_000
                valid['_sourceObservedAt']=source.now
                source.pool_pairs[addresses[0]]=[valid]
            return source.fetch(network,addresses,scope)
        source.quotes=delayed_pool
        with tempfile.TemporaryDirectory() as folder, \
             patch('worker.meme_index.time.time',side_effect=lambda: source.now/1000):
            report=collect(Path(folder)/'index.json',source)
        self.assertEqual(report['attemptedAt'],NOW)
        self.assertEqual(report['readingAt'],NOW+5_000)
        self.assertEqual(report['basket'][0]['observedAt'],NOW+5_000)
        self.assertEqual(report['basket'][1]['observedAt'],NOW-60_000)
        self.assertEqual(report['readings'][-1]['meme'],6)

    def test_live_collection_still_rejects_genuinely_future_source_observations(self):
        source=FakeSources();source.pairs[0]['_sourceObservedAt']=NOW+60_000
        with tempfile.TemporaryDirectory() as folder,patch('worker.meme_index.time.time',return_value=NOW/1000):
            report=collect(Path(folder)/'index.json',source)
        self.assertIsNone(report['readings'][-1]['meme'])
        self.assertEqual(report['basket'][0]['exclusionReason'],'stale_quote')
        self.assertEqual(report['basket'][0]['observedAt'],NOW+60_000)

    def test_live_collection_rechecks_freshness_when_quotes_expire_during_collection(self):
        source=FakeSources()
        rows=source.fixed_quotes(NOW)
        rows[0].update(observedAt=NOW-899_999)
        def delayed_quotes(now):
            self.assertIsNone(now)
            source.now+=2_000
            return rows
        source.fixed_quotes=delayed_quotes
        with tempfile.TemporaryDirectory() as folder, \
             patch('worker.meme_index.time.time',side_effect=lambda: source.now/1000):
            report=collect(Path(folder)/'index.json',source)
        self.assertEqual(report['readingAt'],NOW+2_000)
        self.assertEqual(report['basket'][0]['observedAt'],NOW-899_999)
        self.assertEqual(report['basket'][0]['exclusionReason'],'stale_quote')
        self.assertIsNone(report['readings'][-1]['meme'])

    def test_pool_requires_full_hour_at_original_observation_time(self):
        for age,eligible in ((HOUR-1,False),(HOUR,True),(HOUR+1,True)):
            source=FakeSources();source.pairs[0]['pairCreatedAt']=NOW-60_000-age
            with self.subTest(age=age):
                report=self.sample(source)
                self.assertEqual(report['basket'][0]['eligible'],eligible)
                self.assertEqual(report['readings'][-1]['meme'],6 if eligible else None)
                self.assertEqual(report['basket'][0]['exclusionReason'],None if eligible else 'incomplete_1h_window')

    def test_missing_pool_identity_and_unknown_age_keep_member_with_fixed_weight(self):
        cases=[({'pairAddress':value},'missing_pool') for value in (None,'','  ',False,123)]
        cases.extend(({'pairCreatedAt':value},'unknown_pool_age')
                     for value in (None,0,-1,True,'old',float('nan'),float('inf'),NOW,NOW+1))
        for mutation,reason in cases:
            source=FakeSources();source.pairs[0].update(mutation)
            with self.subTest(mutation=mutation):
                report=self.sample(source)
                self.assert_fixed_roster(report)
                self.assertIsNone(report['readings'][-1]['meme'])
                self.assertEqual(report['basket'][0]['exclusionReason'],reason)
                self.assertEqual(report['basket'][0]['priceChange1h'],1)

    def test_extreme_returns_are_retained_and_never_reweighted_capped_or_zeroed(self):
        for extreme in (17_361_910_275_994,13_770_788_521_195,1e308,sys.float_info.max):
            source=FakeSources();source.pairs[0]['priceChange']['h1']=extreme
            with self.subTest(extreme=extreme):
                report=self.sample(source)
                self.assertIsNone(report['readings'][-1]['meme'])
                self.assertEqual(report['basket'][0]['priceChange1h'],extreme)
                self.assertEqual(report['basket'][0]['exclusionReason'],'unverified_extreme_return')
                self.assertEqual(report['coverage']['includedTokens'],10)
                self.assertEqual(report['inputQuality']['extremeReturnCount'],1)
                self.assert_fixed_roster(report)

    def test_threshold_and_loss_boundaries_keep_the_fixed_denominator(self):
        source=FakeSources()
        values=[-100,10_000,0,0,0,0,0,0,0,0,0]
        for row,value in zip(source.pairs,values):row['priceChange']['h1']=value
        report=self.sample(source)
        self.assertEqual(report['readings'][-1]['meme'],900)
        self.assertEqual(report['coverage']['includedTokens'],11)
        self.assertEqual(report['inputQuality']['extremeReturnCount'],0)

    def test_highest_liquidity_qualified_pool_is_selected_before_incomplete_deeper_pool(self):
        source=FakeSources()
        missing=copy.deepcopy(source.pairs[0]);missing.update(pairAddress='deep-incomplete',liquidity=dict(usd=6_500_000))
        missing['priceChange']={}
        source.pairs[0].update(pairAddress='valid-secondary',liquidity=dict(usd=215_000))
        source.pairs.insert(0,missing)
        report=self.sample(source)
        self.assertEqual(report['basket'][0]['pool'],'valid-secondary')
        self.assertEqual(report['readings'][-1]['meme'],6)
        self.assertEqual(len(source.calls),2)

    def test_missing_batch_return_uses_exact_member_pool_discovery_through_same_owner(self):
        source=FakeSources()
        valid=copy.deepcopy(source.pairs[0]);valid.update(pairAddress='qualified-secondary',liquidity=dict(usd=215_000))
        source.pairs[0].update(pairAddress='deep-incomplete',liquidity=dict(usd=6_500_000),priceChange={})
        source.pool_pairs[PRESET[0]['contract_address']]=[source.pairs[0],valid]
        report=self.sample(source)
        self.assertEqual(report['basket'][0]['pool'],'qualified-secondary')
        self.assertEqual(report['basket'][0]['observedAt'],NOW-60_000)
        self.assertEqual(report['readings'][-1]['meme'],6)
        self.assertEqual(source.calls[-1],('solana',[PRESET[0]['contract_address']],'pools'))
        self.assertEqual(len(source.calls),3)

    def test_pool_selection_tie_is_deterministic_and_retains_best_qualified_liquidity(self):
        source=FakeSources()
        original=source.pairs.pop(0)
        alternatives=[dict(original,pairAddress='z-pool'),dict(original,pairAddress='a-pool'),
                      dict(original,pairAddress='smaller-pool',liquidity=dict(usd=1))]
        source.pairs.extend(alternatives)
        self.assertEqual(self.sample(source)['basket'][0]['pool'],'a-pool')
        source.pairs.reverse()
        self.assertEqual(self.sample(source)['basket'][0]['pool'],'a-pool')

    def test_exact_network_base_contract_rejects_wrong_chain_quote_side_and_same_symbol(self):
        for kind in ('wrong-network','quote-side','same-symbol'):
            source=FakeSources();row=source.pairs[0]
            if kind=='wrong-network':row['chainId']='base'
            else:
                row['baseToken']={'address':'other-address','symbol':'BP'}
                if kind=='quote-side':row['quoteToken']['address']=PRESET[0]['contract_address']
            with self.subTest(kind=kind):
                report=self.sample(source)
                self.assertIsNone(report['readings'][-1]['meme'])
                self.assertEqual(report['basket'][0]['exclusionReason'],'missing_quote')
                self.assert_fixed_roster(report)
        source=FakeSources();source.pairs[2]['baseToken']['address']=PRESET[2]['contract_address'].upper()
        self.assertEqual(self.sample(source)['readings'][-1]['meme'],6)
        source=FakeSources();source.pairs[0]['baseToken']['address']=PRESET[0]['contract_address'].lower()
        self.assertIsNone(self.sample(source)['readings'][-1]['meme'])

    def test_failed_network_keeps_all_members_and_other_network_and_benchmarks_live(self):
        source=FakeSources();source.fail_networks.add('robinhood')
        report=self.sample(source)
        self.assert_fixed_roster(report)
        self.assertIsNone(report['readings'][-1]['meme'])
        self.assertEqual(report['coverage']['includedTokens'],9)
        self.assertEqual(report['coverage']['exclusions'],{'source_unavailable':2})
        self.assertEqual(report['readings'][-1]['altDelta'],1)
        self.assertEqual(report['readings'][-1]['btcDelta'],-.75)

    def test_no_shared_source_retains_all_eleven_and_does_not_fetch_provider_directly(self):
        source=FakeSources();source.quotes=None
        report=self.sample(source)
        self.assert_fixed_roster(report)
        self.assertEqual(report['coverage']['includedTokens'],0)
        self.assertEqual(report['coverage']['exclusions'],{'source_unavailable':11})
        self.assertEqual(report['readings'][-1]['altDelta'],1)
        self.assertIsNone(report['marketObservedAt'])

    def test_benchmark_outage_does_not_discard_complete_meme_reading(self):
        source=FakeSources();source.alt_error=True
        report=self.sample(source)
        self.assertEqual(report['readings'][-1]['meme'],6)
        self.assertIsNone(report['readings'][-1]['altDelta'])
        self.assertIsNone(report['readings'][-1]['btcDelta'])
        self.assertEqual(report['error'],'Alt/BTC provider unavailable')

    def test_old_methods_are_archived_without_recertifying_their_saved_results(self):
        for previous_method in (None,'shared-trending-1h-v1','shared-trending-mature-1h-v2'):
            old={'version':2,'basket':[{'id':'original','priceChange1h':17_361_910_275_994}],
                 'readings':[{'at':NOW-24*HOUR,'meme':413_378_817_666.74445,'altDelta':2}],
                 'basketHistory':[{'at':NOW-HOUR,'tokens':[{'original':True}]}],'updatedAt':NOW}
            if previous_method:old['method']=previous_method
            with self.subTest(method=previous_method),tempfile.TemporaryDirectory() as folder:
                path=Path(folder)/'index.json';path.write_text(json.dumps(old))
                report=collect(path,FakeSources(),NOW)
            archived_method=previous_method or 'fomo-most-held-v1'
            self.assertEqual(report['legacyMethods'][archived_method],old)
            self.assertEqual(report['readings'][0]['method'],archived_method)
            self.assertEqual(report['readings'][0]['meme'],old['readings'][0]['meme'])
            self.assertEqual(report['readings'][-1]['method'],METHOD)
            self.assertEqual(report['readings'][-1]['meme'],6)
            self.assertNotIn('legacyMethods',public_report(report))

    def test_exact_inputs_are_saved_privately_and_public_retry_needs_no_source_read(self):
        source=FakeSources()
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'index.json'
            first=collect(path,source,NOW)
            original=copy.deepcopy(first['basket'])
            source.advance(NOW+HOUR);source.pairs[0]['priceChange']['h1']=100
            later=collect(path,source,NOW+HOUR)
            self.assertEqual(later['basketHistory'][0]['tokens'],original)
            self.assertNotEqual(later['basketHistory'][1]['tokens'],original)
            self.assertEqual(later['rebalancedAt'],NOW)
            projected=json.loads(path.with_suffix('.public.json').read_text())
            self.assertNotIn('basketHistory',projected)
            self.assertEqual(projected,public_report(later))
            path.with_suffix('.public.json').unlink()
            collect(path,source,NOW+HOUR+1)
            self.assertTrue(path.with_suffix('.public.json').exists())
            self.assertEqual(len(source.calls),4)

    def test_missing_member_recovers_same_hour_without_rewriting_original(self):
        source=FakeSources();missing=source.pairs.pop(0)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'index.json'
            first=collect(path,source,NOW)
            first_reading=copy.deepcopy(first['readings'][-1])
            first_basket=copy.deepcopy(first['basketHistory'][-1])
            source.pairs.append(missing);source.advance(NOW+60_000)
            recovered=collect(path,source,NOW+60_000)
            self.assertEqual(recovered['readings'][0],first_reading)
            self.assertEqual(recovered['basketHistory'][0],first_basket)
            self.assertEqual(recovered['readings'][-1]['meme'],6)
            self.assertIsNone(recovered['error'])
            calls=len(source.calls)
            collect(path,source,NOW+60_001)
            self.assertEqual(len(source.calls),calls)

    def test_modal_collector_injects_shared_owner_and_does_not_reload_ranked_stream(self):
        import modal_app
        history=Mock()
        source=Mock()
        expected=dict(updatedAt=NOW,basket=[{}]*11,error=None)
        with patch.object(modal_app,'history_volume',history), \
             patch.object(modal_app,'stream_volume',Mock()) as ranked, \
             patch.object(modal_app,'read_market_source',source), \
             patch('worker.meme_index.collect',return_value=expected) as collector:
            result=modal_app.collect_meme_index.local()
        self.assertEqual(result['constituents'],11)
        self.assertIs(collector.call_args.args[1].quotes,source.remote)
        ranked.reload.assert_not_called()
        history.reload.assert_called_once()
        history.commit.assert_called_once()

    def test_local_proxy_uses_shared_quote_and_pool_routes_and_original_header(self):
        response=Mock(headers={'x-data-observed-at':str(NOW-120_000)})
        response.json.return_value=[pair(PRESET[0])]
        read=proxy_quotes('http://127.0.0.1:4173/api/dex/')
        address=PRESET[0]['contract_address']
        with patch('httpx.get',return_value=response) as fetch:
            reply=read('solana',[address])
            self.assertEqual(fetch.call_args.args[0],
                             'http://127.0.0.1:4173/api/dex/tokens/v1/solana/'+address)
            self.assertEqual(reply['observedAt'],NOW-120_000)
            self.assertEqual(reply['value'],response.json.return_value)
            read('solana',[address],scope='pools')
            self.assertEqual(fetch.call_args.args[0],
                             'http://127.0.0.1:4173/api/dex/token-pairs/v1/solana/'+address)

    def test_local_proxy_never_invents_observation_time_or_bypasses_source_owner(self):
        for header in (None,'bad','NaN','Infinity'):
            response=Mock(headers={} if header is None else {'x-data-observed-at':header})
            response.json.return_value=[]
            with self.subTest(header=header),patch('httpx.get',return_value=response):
                reply=proxy_quotes('http://localhost:4173/api/dex')('solana',[PRESET[0]['contract_address']])
            self.assertIsNone(reply['observedAt'])
        with self.assertRaises(ValueError):
            proxy_quotes('https://api.dexscreener.com')

    def test_btc_uses_existing_feed_and_keeps_missing_values_unavailable(self):
        rows = [{'id': str(i + 100), 'rank': i + 2, 'symbol': str(i),
                 'market_cap_usd': '100', 'percent_change_1h': '2'} for i in range(25)]
        btc = {'id': '90', 'rank': 1, 'symbol': 'BTC',
               'market_cap_usd': '100000', 'percent_change_1h': '-.75'}
        result = alt_observation([btc, *rows], NOW)
        self.assertEqual(result['btcDelta'], -.75)
        self.assertAlmostEqual(result['hourChange'], 2)
        self.assertEqual(result['value'], 2500)
        for invalid in (None, 'NaN', 'Infinity', '-100', 'invalid'):
            self.assertIsNone(alt_observation([{**btc, 'percent_change_1h': invalid}, *rows], 1)['btcDelta'])
        self.assertIsNone(alt_observation(rows, 1)['btcDelta'])
        self.assertEqual(alt_observation([{**btc, 'percent_change_1h': '0'}, *rows], 1)['btcDelta'], 0)

    def test_broad_alt_sample_excludes_btc_eth_and_stables(self):
        rows = [{'id': str(i), 'rank': i, 'symbol': 'USDT' if i == 0 else str(i),
                 'market_cap_usd': '100', 'percent_change_1h': '2'} for i in range(26)]
        alt = alt_observation(rows, NOW)
        self.assertEqual(alt['value'], 2500)
        self.assertAlmostEqual(alt['hourChange'], 2)
        rows.pop()
        with self.assertRaises(ValueError):
            alt_observation(rows, NOW)
