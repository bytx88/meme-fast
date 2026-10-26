import copy
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from worker import data_stream as stream
from worker.smart_wallets import group
from worker.shared_holdings import observe, PROGRAMS

NOW = 1800000000000
MINT = group()['token']
OWNER = group()['wallets'][0]['address']
KEY = 'solana:' + MINT


def token(**changes):
    return dict(id=KEY, network='solana', contract_address=MINT, contract_verified=True,
                symbol='TEST', poolCreated=NOW - 100 * stream.DAY, marketUpdatedAt=NOW,
                liquidity=10000, marketWindows={key: dict(volume=30000, buys=100, sells=50, buyers=80)
                                               for key in ('m5', 'h1', 'h6', 'h24')}, **changes)


def event(identity, quote='SOL', amount='1', stamp=NOW, side='buy'):
    return dict(id=identity, mint=MINT, address=OWNER, quote=quote, quoteAmount=amount,
                quantity='10', side=side, time=stamp)


class DataStreamTests(unittest.TestCase):
    def test_one_discovery_turn_prevents_expansion_starvation_without_draining_the_hot_queue(self):
        rows=[dict(address='hot',collectionPriority=0),dict(address='a',_streamDiscovered=True,lastRelevantAt=1),
              dict(address='b',_streamDiscovered=True,lastRelevantAt=2)]
        ordered=stream.collection_order(rows,{'hot':{'attemptedAt':100}})
        self.assertEqual([r['address'] for r in ordered],['a','hot','b'])

    def test_current_pool_wallets_take_priority_without_promoting_discovered_metadata(self):
        registry=[dict(address='pool',smartMoney=False),dict(address='pin',interested=True),dict(address='saved',smartMoney=True)]
        candidates=dict(wallets=[dict(address='pool',lastRelevantAt=NOW),dict(address='new',lastRelevantAt=NOW,smartMoney=None)])
        rows={row['address']:row for row in stream.collection_wallets(registry,candidates,now=NOW)}
        self.assertEqual(rows['pool']['collectionPriority'],0)
        self.assertEqual(rows['pin']['collectionPriority'],1)
        self.assertEqual(rows['pin']['holdingsRefreshMs'],300000)
        self.assertEqual(rows['saved']['holdingsRefreshMs'],6*3600000)
        self.assertTrue(rows['new']['_streamDiscovered'])
        self.assertIsNone(rows['new']['smartMoney'])
        self.assertFalse(rows['pool']['smartMoney'])

    def test_history_budget_preserves_each_wallets_current_and_window_anchors(self):
        balances = {str(i):dict(raw='1',decimals=6) for i in range(40)}
        history = {str(owner):[dict(at=NOW-i*300000,balances=balances) for i in reversed(range(300))]
                   for owner in range(10)}
        bounded = stream.bound_history(history,NOW)
        self.assertLessEqual(sum(len(point['balances']) for points in bounded.values() for point in points),stream.HISTORY_BALANCE_LIMIT)
        required = {NOW,*(NOW-values[1] for values in stream.WINDOWS.values())}
        for points in bounded.values():
            self.assertTrue(required.issubset({point['at'] for point in points}))

    def test_sparse_history_keeps_known_zero_distinct_from_an_omitted_balance(self):
        empty = observe(OWNER,{p:{'result':{'context':{'slot':123},'value':[]}} for p in PROGRAMS},NOW)
        report = stream.project({'coins':[token()]},{'wallets':[dict(address=OWNER,observation=empty)]},{},{},NOW)
        point = report['history'][OWNER][0]
        self.assertEqual(point['balances'],{})
        self.assertEqual(stream.point_balance(point,MINT,report['coverageSets'])['raw'],'0')
        self.assertIsNone(stream.point_balance(point,'not-covered',report['coverageSets']))
        partial = copy.deepcopy(empty)
        partial['omittedMints'] = [MINT]
        omitted = stream.project({'coins':[token()]},{'wallets':[dict(address=OWNER,observation=partial)]},{},{},NOW)
        self.assertIsNone(stream.point_balance(omitted['history'][OWNER][0],MINT,omitted['coverageSets']))

    def test_readers_use_small_index_while_the_writer_retains_private_history(self):
        with tempfile.TemporaryDirectory() as folder:
            report = dict(version=1,history={'owner':[{}]},coverageSets={'id':['mint']},tokens=['mint'])
            stream.write(folder,report)
            self.assertNotIn('history',stream.read(folder))
            self.assertEqual(stream.read(folder,full=True)['history'],report['history'])

    def test_all_four_windows_receive_collection_capacity(self):
        rows = []
        for window, (provider, _, _, _) in stream.WINDOWS.items():
            for index in range(20):
                address = '0x' + format(len(rows) + 1, '040x')
                coin = token()
                coin.update(id='base:'+address, network='base', contract_address=address,
                            marketWindows={provider: dict(volume=100000,buys=100,sells=50)})
                rows.append(coin)
        report = stream.project({'radarCoins':rows}, {}, {}, {}, NOW)
        self.assertEqual(len(report['tokens']), 60)
        self.assertEqual([len(value['tokens']) for value in report['windows'].values()], [15,15,15,15])

    def test_holder_expansion_is_bounded_and_failures_respect_retry_cooldown(self):
        rows = []
        for wallet in group()['wallets'][:3]:
            coin = token()
            coin.update(id='solana:'+wallet['address'], contract_address=wallet['address'])
            rows.append(coin)
        calls = []
        def failed(mint, *args, **kwargs):
            calls.append(mint)
            raise ValueError('Unavailable')
        with tempfile.TemporaryDirectory() as folder, patch('worker.wallet_discovery.holder_candidates', side_effect=failed):
            stream.collect(folder, {'coins':rows}, {}, {}, rpc=lambda *a:None, now=NOW)
            self.assertEqual(len(calls), 2)
            stream.collect(folder, {'coins':rows}, {}, {}, rpc=lambda *a:None, now=NOW+1000)
            self.assertEqual(len(calls), 3)
            stream.collect(folder, {'coins':rows}, {}, {}, rpc=lambda *a:None, now=NOW+2000)
            self.assertEqual(len(calls), 3)

    def test_net_sellers_do_not_rank_as_accumulators_just_for_many_buys(self):
        events = [event('buy'), dict(event('sell',side='sell'),quantity='20')]
        report = stream.project({'coins':[token()]}, {}, {'events':events}, {}, NOW)
        self.assertEqual(report['windows']['1h']['accumulators'][KEY], [])

    def test_old_launches_qualify_by_activity_in_four_actual_provider_windows(self):
        report = stream.project({'radarCoins': [token()]}, {}, {}, {}, NOW)
        self.assertEqual(report['tokens'], [KEY])
        for window in stream.WINDOWS:
            row = report['windows'][window]['tokens'][0]
            self.assertEqual(row['volume'], 30000)
            self.assertEqual(row['uniqueBuyers'], 80)
            self.assertEqual(row['observedAt'], NOW)
        sparse = token()
        sparse.pop('marketWindows')
        sparse.update(volume5m=1000, buys5m=10, sells5m=5)
        report = stream.project({'coins': [sparse]}, {}, {}, {}, NOW)
        self.assertEqual(len(report['windows']['5m']['tokens']), 1)
        self.assertEqual(report['windows']['1h']['tokens'], [])
        self.assertEqual(report['windows']['6h']['tokens'], [])

    def test_expired_future_illiquid_and_unknown_activity_do_not_enter_hot_pool(self):
        for changes in ({'marketUpdatedAt': NOW-900001}, {'marketUpdatedAt': NOW+1},
                        {'liquidity': 1}, {'marketWindows': {key: {'volume': 100000} for key in ('m5','h1','h6','h24')}}):
            coin = token()
            coin.update(changes)
            self.assertEqual(stream.project({'coins': [coin]}, {}, {}, {}, NOW)['tokens'], [])

    def test_holder_size_and_recent_accumulation_are_separate_and_currencies_not_added(self):
        previous = {'holderReports': {MINT: dict(checkedAt=NOW, candidates=[
            dict(address=OWNER, balanceRaw='9999999999999999999', decimals=6)])}}
        events = [event('sol', 'SOL', '1'), event('usd', 'USDC', '1000')]
        report = stream.project({'radarCoins': [token()]}, {}, {'events': events + events}, previous, NOW)
        for value in report['windows'].values():
            self.assertEqual(value['holders'][KEY][0]['balanceRaw'], '9999999999999999999')
            buyer = value['accumulators'][KEY][0]
            self.assertEqual(buyer['buys'], 2)
            self.assertEqual(buyer['netByQuote'], {'SOL': '1', 'USDC': '1000'})
            self.assertIsNone(buyer['holdingChangeRaw'])
        self.assertIsNone(report['wallets'][0]['smartMoney'])
        self.assertFalse(report['wallets'][0]['interested'])

    def test_wallet_token_discovery_rejects_old_future_invalid_and_duplicate_events(self):
        row = event('good')
        result = stream.wallet_token_candidates({'events': [row, row, event('old', stamp=NOW-stream.DAY-1),
            event('future', stamp=NOW+1), dict(event('invalid'), mint='bad'), event('sell', side='sell')]}, NOW)
        self.assertEqual(result, [dict(token=MINT, buyers=1, lastBuyAt=NOW)])

    def test_new_complete_zero_supersedes_old_sampled_holder_without_inventing_delta(self):
        observed = observe(OWNER, {p: {'result': {'context': {'slot': 123}, 'value': []}} for p in PROGRAMS}, NOW)
        holdings = {'wallets': [dict(address=OWNER, observation=observed)]}
        previous = {'holderReports': {MINT: dict(checkedAt=NOW-1000, candidates=[dict(address=OWNER, balanceRaw='123', decimals=6)])}}
        report = stream.project({'coins': [token()]}, holdings, {'events': [event('buy')]}, previous, NOW)
        self.assertEqual(report['windows']['1h']['holders'][KEY], [])
        self.assertIsNone(report['windows']['1h']['accumulators'][KEY][0]['holdingChangeRaw'])
        self.assertEqual(report['history'][OWNER][0]['at'], NOW)

    def test_holder_rankings_use_source_observation_age_instead_of_cache_check_time(self):
        observed_at = NOW-60000
        previous = {'holderReports': {MINT: dict(checkedAt=NOW, observedAt=observed_at, sampledAccounts=1,
            candidates=[dict(address=OWNER, balanceRaw='123', decimals=6)])}}
        report = stream.project({'coins':[token()]}, {}, {}, previous, NOW)
        self.assertEqual(report['windows']['1h']['holders'][KEY][0]['observedAt'], observed_at)
        self.assertEqual(report['windows']['1h']['holderCoverage'][KEY]['lastObservedAt'], observed_at)
        self.assertEqual(report['wallets'][0]['lastRelevantAt'], observed_at)
        previous['holderReports'][MINT]['observedAt'] = NOW-15*60000
        expired = stream.project({'coins':[token()]}, {}, {}, previous, NOW)
        self.assertEqual(expired['windows']['1h']['holders'][KEY], [])
        self.assertEqual(expired['windows']['1h']['holderCoverage'][KEY]['status'], 'unavailable')

    def test_candidate_enrolment_preserves_user_wallet_metadata(self):
        registry = [dict(address=OWNER, name='My name', smartMoney=True, interested=True)]
        result = stream.collection_wallets(registry, {'wallets': [dict(address=OWNER, name='Candidate', smartMoney=None)]})
        self.assertEqual(result[0]['name'], 'My name')
        self.assertTrue(result[0]['smartMoney'])
        self.assertEqual(result[0]['refreshAfterMs'], 300000)
        self.assertEqual(registry[0], dict(address=OWNER, name='My name', smartMoney=True, interested=True))

    def test_public_projection_excludes_internal_history_and_unknown_window(self):
        report = stream.project({'coins': [token()]}, {}, {}, {}, NOW)
        self.assertNotIn('history', stream.public_view(report))
        with self.assertRaises(ValueError):
            stream.public_view(report, '7d')


    def test_ranked_pool_carries_signed_hour_change_and_original_provenance(self):
        created_at, observed_at = NOW-10*60000, NOW-60000
        coin=token(priceChange1h=-2.5,marketSource='DexScreener',pool='selected-pool',marketPoolCreatedAt=created_at)
        coin['marketUpdatedAt']=observed_at
        report=stream.project({'coins':[coin]},{},{},{},NOW)
        row=report['windows']['1h']['tokens'][0]
        self.assertEqual(row['priceChange1h'],-2.5)
        self.assertEqual(row['marketSource'],'DexScreener')
        self.assertEqual(row['pool'],'selected-pool')
        self.assertEqual(row['poolCreatedAt'],created_at)
        self.assertEqual(row['observedAt'],observed_at)
        self.assertNotEqual(row['poolCreatedAt'],coin['poolCreated'])

    def test_unknown_quote_pool_age_never_falls_back_to_the_original_launch(self):
        for quote_age in ({},{'marketPoolCreatedAt':None}):
            coin=token(priceChange1h=17361910275994,pool='selected-pool',**quote_age)
            report=stream.project({'coins':[coin]},{},{},{},NOW)
            for window in stream.WINDOWS:
                row=report['windows'][window]['tokens'][0]
                self.assertIsNone(row['poolCreatedAt'])
                self.assertEqual(row['pool'],'selected-pool')
                self.assertEqual(row['priceChange1h'],17361910275994)

    def test_mature_anonymous_quote_is_preserved_then_excluded_from_meme(self):
        from worker.meme_index import collect as collect_meme
        coin=token(priceChange1h=5,pool=None,marketPoolCreatedAt=NOW-2*3600000)
        report=stream.project({'lastRun':NOW,'coins':[coin]},{},{},{},NOW)
        row=report['windows']['1h']['tokens'][0]
        self.assertIsNone(row['pool'])
        self.assertEqual(row['poolCreatedAt'],NOW-2*3600000)
        class Sources:
            def trending(self):
                return report
            def alt(self, now):
                return dict(hourChange=1,btcDelta=0,providerAt=now,source='fixture')
        with tempfile.TemporaryDirectory() as folder:
            result=collect_meme(Path(folder)/'meme.json',Sources(),NOW)
        self.assertIsNone(result['readings'][-1]['meme'])
        self.assertEqual(result['basket'][0]['exclusionReason'],'missing_pool')
        self.assertEqual(result['coverage']['includedTokens'],0)
