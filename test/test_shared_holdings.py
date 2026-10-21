import copy
import tempfile
import unittest
from pathlib import Path

from worker.followed_wallets import collect as scan
from worker.shared_holdings import observe, balance, PROGRAMS, MAX_AGE_MS
from worker.smart_wallets import collect, group
from worker import smart_seeding as seeds

NOW = 1800000000000


def response(owner, mint, raw, *, slot=123, account='account'):
    return {'result': {'context': {'slot': slot}, 'value': [{'pubkey': account, 'account': {
        'data': {'parsed': {'info': {'owner': owner, 'mint': mint,
                                  'tokenAmount': {'amount': str(raw), 'decimals': 6}}}}}}]}}


def observation(owner, mint, raw, at=NOW):
    return observe(owner, {PROGRAMS[0]: response(owner, mint, raw),
                           PROGRAMS[1]: {'result': {'context': {'slot': 124}, 'value': []}}}, at)


class SharedHoldingsTests(unittest.TestCase):
    def test_unneeded_positive_mints_are_coverage_misses_instead_of_false_zero(self):
        responses = {PROGRAMS[0]: response('owner','unused',123),
                     PROGRAMS[1]: {'result':{'context':{'slot':124},'value':[]}}}
        saved = observe('owner',responses,NOW,retain_mints={'needed'})
        self.assertEqual(saved['balances'],{})
        self.assertEqual(saved['omittedMints'],['unused'])
        self.assertIsNone(balance(saved,'owner','unused',6,NOW))
        self.assertEqual(balance(saved,'owner','needed',6,NOW)['raw'],0)

    def test_integer_balances_and_absence_require_complete_current_evidence(self):
        raw = 2**64 - 1
        saved = observation('owner', 'mint', raw)
        self.assertEqual(balance(saved, 'owner', 'mint', 6, NOW)['raw'], raw)
        self.assertEqual(balance(saved, 'owner', 'other', 6, NOW)['raw'], 0)
        for at in (NOW - 1, NOW + MAX_AGE_MS):
            self.assertIsNone(balance(saved, 'owner', 'mint', 6, at))
        self.assertIsNone(balance(saved, 'other', 'mint', 6, NOW))
        self.assertIsNone(balance(saved, 'owner', 'mint', 9, NOW))
        self.assertIsNone(balance(saved, 'owner', 'mint', 6, NOW, not_before=NOW + 1))
        for key in ('programSlots', 'balances', 'complete'):
            invalid = dict(saved)
            invalid.pop(key)
            self.assertIsNone(balance(invalid, 'owner', 'missing', 6, NOW))

    def test_account_validation_rejects_duplicates_conflicts_and_partial_programs(self):
        original = {PROGRAMS[0]: response('owner', 'mint', 1),
                    PROGRAMS[1]: {'result': {'context': {'slot': 124}, 'value': []}}}
        self.assertIsNone(observe('owner', {PROGRAMS[0]: original[PROGRAMS[0]]}, NOW))
        for mutate in (
                lambda p: p[PROGRAMS[0]]['result']['value'].append(p[PROGRAMS[0]]['result']['value'][0]),
                lambda p: p[PROGRAMS[1]].update(error={'code': 1}),
                lambda p: p[PROGRAMS[0]]['result']['value'][0]['account']['data']['parsed']['info'].update(owner='other'),
                lambda p: p[PROGRAMS[0]]['result']['value'][0]['account']['data']['parsed']['info']['tokenAmount'].update(amount='-1'),
                lambda p: p[PROGRAMS[0]]['result'].update(context={})):
            payload = copy.deepcopy(original)
            mutate(payload)
            self.assertIsNone(observe('owner', payload, NOW))

    def test_scanner_keeps_raw_accounts_for_many_token_consumers_and_preserves_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'holdings.json'
            def fetch(owner, program):
                return response(owner, 'mint', 123) if program == PROGRAMS[0] else {'result': {'context': {'slot': 124}, 'value': []}}
            report = scan(path, fetch, now=NOW, registry=[dict(name='Owner', address='owner', code='F1')])
            self.assertEqual(report['wallets'][0]['mints'], ['mint'])
            self.assertEqual(balance(report['wallets'][0]['observation'], 'owner', 'mint', 6, NOW)['raw'], 123)
            def fail(*args):
                raise ValueError('Provider failed')
            failed = scan(path, fail, now=NOW + 1, registry=[dict(name='Owner', address='owner', code='F1')])
            self.assertEqual(failed['wallets'][0]['observation'], report['wallets'][0]['observation'])
            self.assertEqual(failed['wallets'][0]['checkedAt'], NOW)
            self.assertEqual(failed['wallets'][0]['status'], 'unavailable')

    def test_balance_collection_reuses_shared_scans_and_fetches_only_missing_wallets(self):
        cohort = dict(group(), decimals=6)
        wallets = cohort['wallets']
        calls = []
        def rpc(method, params):
            calls.append((method, params[0]))
            if method == 'getTokenSupply':
                return {'result': {'value': {'amount': '1000000000000', 'decimals': 6}}}
            return response(params[0], cohort['token'], 2000000)
        holdings = {'wallets': [dict(address=w['address'], observation=observation(w['address'], cohort['token'], 1000000, NOW - 1000))
                               for w in wallets[:-1]]}
        with tempfile.TemporaryDirectory() as folder:
            report = collect(folder, rpc=rpc, cohort=cohort, now=NOW, holdings=holdings)
        self.assertEqual([p for m, p in calls if m == 'getTokenAccountsByOwner'], [wallets[-1]['address']])
        self.assertEqual(report['requests'], dict(sharedBalanceHits=len(wallets) - 1, balanceFetches=1))
        self.assertEqual(report['wallets'][0]['checkedAt'], NOW - 1000)
        self.assertEqual(report['samples'][-1]['balanceRaw'], str((len(wallets) + 1) * 1000000))
        self.assertEqual(report['samples'][-1]['observedFrom'], NOW - 1000)

    def test_yesterdays_cached_zero_does_not_certify_today(self):
        midnight = NOW // seeds.DAY * seeds.DAY
        plan = dict(tokens={}, checks={})
        row = seeds.ensure_token(plan, 'token', 'g', midnight - seeds.DAY)
        report = dict(groupId='g', wallets=[{}], samples=[dict(time=midnight + 1000,
            balanceRaw='0', walletBalances=['0'], walletCheckedAt=[midnight - 1000], checkedWallets=1)])
        seeds.observe(row, report, midnight + 1000)
        self.assertEqual(row['zeroDays'], {})
