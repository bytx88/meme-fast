import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from worker import smart_wallets as smart

NOW = 1800000000000


def accounts(owner, mint, values):
    return {'result': {'context': {'slot': 123}, 'value': [
        {'pubkey': str(index), 'account': {'data': {'parsed': {'info': {
            'owner': owner, 'mint': mint, 'tokenAmount': {'amount': str(value), 'decimals': 6}
        }}}}} for index, value in enumerate(values)]}}


class SmartWalletTests(unittest.TestCase):
    def test_default_valuation_reuses_shared_quote_without_full_pool_discovery(self):
        from worker.source_stream import SourceStream, dex_tokens
        from types import SimpleNamespace
        mint=self.cohort['token']
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder,clock=lambda:NOW/1000)
            dex_tokens(stream,'solana',[mint],lambda *args:[dict(chainId='solana',baseToken={'address':mint},priceUsd='.002')])
            def shared(network,addresses,scope='quotes'):
                self.assertEqual(scope,'quotes')
                return dex_tokens(stream,network,addresses,lambda *args:self.fail('duplicate valuation pull'))['value']
            with patch.dict('os.environ',{'MEME_SHARED_SOURCES':'1'}), \
                 patch('worker.public_rpc.public_rpc',return_value=lambda method,params:self.rpc(method,params)['result']), \
                 patch('worker.source_stream.shared_dex',side_effect=shared), \
                 patch('httpx.Client',return_value=SimpleNamespace(close=lambda:None)):
                report=smart.collect(self.directory.name,now=NOW,cohort=self.cohort)
            self.assertEqual(report['samples'][-1]['priceUSD'],.002)
            self.assertEqual(report['samples'][-1]['priceObservedAt'],NOW)
            stream.close()

    def test_reduced_membership_reuses_exact_wallet_history_without_changing_source(self):
        original=self.collect()
        source=Path(self.directory.name)/(self.cohort['groupId']+'.json')
        before=source.read_bytes()
        subset=dict(self.cohort,groupId='smaller-group',wallets=self.cohort['wallets'][:2])
        projected=smart.read_report(self.directory.name,subset)
        self.assertEqual(projected['samples'][0]['balanceRaw'],'2500000')
        self.assertEqual(projected['samples'][0]['walletBalances'],['1250000','1250000'])
        self.assertEqual(projected['samples'][0]['checkedWallets'],2)
        self.assertEqual(projected['samples'][0]['derivedFromGroupId'],original['groupId'])
        self.assertEqual(source.read_bytes(),before)
        self.fail.add(self.cohort['wallets'][0]['address'])
        self.collect(NOW+300000)
        projected=smart.read_report(self.directory.name,subset)
        self.assertIsNone(projected['samples'][-1]['balance'])
        self.assertEqual(projected['samples'][-1]['walletBalances'],[None,'1250000'])
        unknown=dict(subset,groupId='new-member',wallets=[dict(name='New',address='missing')])
        self.assertEqual(smart.read_report(self.directory.name,unknown)['samples'],[])

    def test_one_job_completes_319_wallets_and_publishes_progress_between_passes(self):
        cohort=dict(self.cohort,groupId='319-cycle',wallets=[dict(name=str(i),address='wallet'+str(i)) for i in range(319)])
        elapsed=[0];reads=[];checkpoints=[]
        def rpc(method,params):
            if method=='getTokenSupply':return {'result':{'value':{'amount':'1000000000000','decimals':6}}}
            elapsed[0]+=1;reads.append(params[0])
            return accounts(params[0],cohort['token'],[1000000])
        with patch.object(smart.time,'monotonic',side_effect=lambda:elapsed[0]), patch.object(smart.time,'time',side_effect=lambda:NOW/1000+elapsed[0]):
            report=smart.collect_cycle(self.directory.name,cohort=cohort,rpc=rpc,
                budget_seconds=400,pass_seconds=30,checkpoint=lambda r:checkpoints.append(r['collection']['checkedWallets']))
        self.assertEqual(checkpoints,[30,60,90,120,150,180,210,240,270,300,319])
        self.assertEqual(len(set(reads)),319)
        self.assertEqual(len(reads),319)
        self.assertEqual(report['samples'][-1]['balance'],319)
        self.assertEqual(report['collection']['startedAt'],NOW)
        self.assertFalse(report['collection']['inProgress'])

    def test_cycle_stops_when_provider_makes_no_progress(self):
        cohort=dict(self.cohort,groupId='blocked-cycle',wallets=[dict(name=str(i),address='wallet'+str(i)) for i in range(70)])
        calls=[];checkpoints=[]
        def failed(method,params):
            if method=='getTokenSupply':return {'result':{'value':{'amount':'1000000000000','decimals':6}}}
            calls.append(params[0]);raise ValueError('Provider unavailable')
        report=smart.collect_cycle(self.directory.name,cohort=cohort,rpc=failed,
            checkpoint=lambda r:checkpoints.append(r))
        self.assertEqual(len(checkpoints),1)
        self.assertEqual(len(calls),70)
        self.assertIsNone(report['samples'][-1]['balance'])
        self.assertEqual(report['collection']['checkedWallets'],0)

    def test_refresh_cadence_resumes_partial_cycles_without_polling_complete_groups(self):
        self.assertTrue(smart.needs_refresh({},NOW))
        report=dict(attemptedAt=NOW)
        self.assertFalse(smart.needs_refresh(report,NOW+60000))
        self.assertTrue(smart.needs_refresh(report,NOW+smart.CACHE_MS))
        report['collection']={'inProgress':True}
        self.assertFalse(smart.needs_refresh(report,NOW+59999))
        self.assertTrue(smart.needs_refresh(report,NOW+60000))
    def test_large_group_finishes_across_bounded_calls_without_resampling_completed_wallets(self):
        cohort=dict(self.cohort,groupId='large-test',wallets=[dict(name=str(i),address='wallet'+str(i)) for i in range(70)])
        elapsed=[0];reads=[]
        def rpc(method,params):
            if method=='getTokenSupply':return {'result':{'value':{'amount':'1000000000000','decimals':6}}}
            reads.append(params[0]);elapsed[0]+=1
            return accounts(params[0],cohort['token'],[1000000])
        with patch.object(smart.time,'monotonic',side_effect=lambda:elapsed[0]):
            for i in range(24):
                report=smart.collect(self.directory.name,rpc=rpc,now=NOW+i*60000,cohort=cohort,budget_seconds=3)
                if i==0:
                    self.assertIsNone(report['samples'][-1]['balance'])
                    self.assertEqual(report['samples'][-1]['checkedWallets'],3)
            self.assertEqual(report['samples'][-1]['balance'],70)
            self.assertEqual(len(reads),70)
            self.assertFalse(report['collection']['inProgress'])
            self.assertEqual(report['samples'][-1]['collectionStartedAt'],NOW)
            next_cycle=smart.collect(self.directory.name,rpc=rpc,now=NOW+24*60000,cohort=cohort,budget_seconds=3)
            self.assertIsNone(next_cycle['samples'][-1]['balance'])
            self.assertEqual(next_cycle['samples'][-1]['checkedWallets'],3)
            self.assertEqual(next_cycle['samples'][-2]['balance'],70)

    def test_expired_cycle_cannot_supply_old_wallets_to_a_new_total(self):
        cohort=dict(self.cohort,groupId='expiry-test',wallets=[dict(name=str(i),address='wallet'+str(i)) for i in range(70)])
        elapsed=[0]
        def rpc(method,params):
            if method=='getTokenSupply':return {'result':{'value':{'amount':'1000000000000','decimals':6}}}
            elapsed[0]+=1
            return accounts(params[0],cohort['token'],[1000000])
        with patch.object(smart.time,'monotonic',side_effect=lambda:elapsed[0]):
            smart.collect(self.directory.name,rpc=rpc,now=NOW,cohort=cohort,budget_seconds=3)
            report=smart.collect(self.directory.name,rpc=rpc,now=NOW+smart.COLLECTION_MS+1,cohort=cohort,budget_seconds=3)
        self.assertEqual(report['samples'][-1]['checkedWallets'],3)
        self.assertIsNone(report['samples'][-1]['balance'])
        self.assertEqual(report['collection']['startedAt'],NOW+smart.COLLECTION_MS+1)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cohort = smart.group()
        self.fail = set()
        self.empty = set()

    def rpc(self, method, params):
        if method == 'getTokenSupply':
            return {'result': {'value': {'amount': '1000000000000000', 'decimals': 6}}}
        owner = params[0]
        if owner in self.fail:
            raise ValueError('RPC unavailable')
        self.assertEqual(params[1], {'mint': self.cohort['token']})
        return accounts(owner, self.cohort['token'], [] if owner in self.empty else [1000000, 250000])

    def collect(self, at=NOW, price=lambda: .002):
        return smart.collect(self.directory.name, rpc=self.rpc, price_fetcher=price, now=at)

    def test_integer_amounts_sum_every_token_account_without_precision_loss(self):
        owner = self.cohort['wallets'][0]['address']
        raw, slot = smart.token_balance(accounts(owner, self.cohort['token'], [9007199254740993, 11]), owner, self.cohort['token'], 6)
        self.assertEqual(raw, 9007199254741004)
        self.assertEqual(slot, 123)

    def test_wrong_owner_mint_decimals_and_malformed_amount_are_rejected(self):
        owner, mint = self.cohort['wallets'][0]['address'], self.cohort['token']
        for field, value in [('owner', 'wrong'), ('mint', 'wrong')]:
            payload = accounts(owner, mint, [100])
            payload['result']['value'][0]['account']['data']['parsed']['info'][field] = value
            with self.assertRaises(ValueError): smart.token_balance(payload, owner, mint, 6)
        for amount in ['-1', '1.1', 'NaN', '١']:
            payload = accounts(owner, mint, [amount])
            with self.assertRaises(ValueError): smart.token_balance(payload, owner, mint, 6)
        with self.assertRaises(ValueError): smart.token_balance({'error': {}}, owner, mint, 6)

    def test_duplicate_accounts_are_rejected(self):
        owner, mint = self.cohort['wallets'][0]['address'], self.cohort['token']
        payload = accounts(owner, mint, [100])
        payload['result']['value'] *= 2
        with self.assertRaises(ValueError): smart.token_balance(payload, owner, mint, 6)

    def test_complete_observation_is_persisted_without_a_swap_feed(self):
        report = self.collect()
        latest = report['samples'][-1]
        self.assertEqual(report['status'], 'ok')
        self.assertEqual(latest['balanceRaw'], '11250000')
        self.assertEqual(latest['balance'], 11.25)
        self.assertEqual(latest['holders'], 9)
        self.assertEqual(len(latest['walletBalances']), 9)
        self.assertEqual(smart.read_report(self.directory.name), report)

    def test_failed_check_retains_stale_wallet_but_creates_a_group_gap(self):
        previous = self.collect()
        address = self.cohort['wallets'][0]['address']
        self.fail.add(address)
        report = self.collect(NOW + 300000)
        self.assertEqual(report['status'], 'partial')
        self.assertEqual(report['wallets'][0]['balance'], 1.25)
        self.assertEqual(report['wallets'][0]['checkedAt'], NOW)
        self.assertEqual(report['wallets'][0]['status'], 'unavailable')
        self.assertIsNone(report['samples'][-1]['balance'])
        self.assertIsNone(report['samples'][-1]['walletBalances'][0])
        self.assertEqual(report['samples'][0], previous['samples'][0])

    def test_confirmed_empty_clears_old_balance_and_remains_measured_zero(self):
        self.collect()
        self.empty.add(self.cohort['wallets'][0]['address'])
        report = self.collect(NOW + 300000)
        self.assertEqual(report['wallets'][0]['balanceRaw'], '0')
        self.assertEqual(report['wallets'][0]['status'], 'ok')
        self.assertEqual(report['samples'][-1]['holders'], 8)
        self.assertEqual(report['samples'][-1]['balance'], 10)

    def test_price_failure_does_not_discard_balances_or_reuse_old_price_as_fresh(self):
        self.collect()
        def failed(): raise ValueError('Unavailable')
        report = self.collect(NOW + 300000, price=failed)
        self.assertEqual(report['status'], 'ok')
        self.assertEqual(report['samples'][-1]['balance'], 11.25)
        self.assertIsNone(report['samples'][-1]['priceUSD'])

    def test_retention_never_backfills_unobserved_history(self):
        self.collect()
        report = self.collect(NOW + smart.RETENTION_MS + 1)
        self.assertEqual(len(report['samples']), 1)
        self.assertEqual(report['samples'][0]['time'], NOW + smart.RETENTION_MS + 1)
        self.assertEqual(report['startedAt'], NOW)

    def test_membership_change_uses_a_separate_file_and_keeps_old_history(self):
        self.collect()
        config = copy.deepcopy(self.cohort)
        config['wallets'].reverse()
        file = Path(self.directory.name) / 'group.json'
        file.write_text(json.dumps(config))
        with patch.object(smart, 'CONFIG', file):
            self.assertNotEqual(smart.group()['groupId'], self.cohort['groupId'])
            self.assertEqual(smart.read_report(self.directory.name)['samples'], [])
        self.assertEqual(len(smart.read_report(self.directory.name)['samples']), 1)

    def test_market_price_uses_exact_solana_base_token(self):
        mint = self.cohort['token']
        rows = [{'chainId': 'eth', 'baseToken': {'address': mint}, 'priceUsd': '999'},
                {'chainId': 'solana', 'baseToken': {'address': 'wrong'}, 'priceUsd': '999'},
                {'chainId': 'solana', 'baseToken': {'address': mint}, 'priceUsd': '.002', 'liquidity': {'usd': 10}},
                {'chainId': 'solana', 'baseToken': {'address': mint}, 'priceUsd': '.003', 'liquidity': {'usd': 100}}]
        self.assertEqual(smart.market_price(rows, mint), .003)


if __name__ == '__main__': unittest.main()
