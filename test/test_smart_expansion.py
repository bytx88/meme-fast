import tempfile
import unittest
from unittest.mock import patch
from worker import smart_wallets as balances
from worker.smartness import history_step, RETENTION
from worker.wallet_discovery import holder_candidates, on_curve
from worker.followed_wallets import PROGRAMS
from test_smartness import fixture, SIGNATURE, AT


class PublicRpcTests(unittest.TestCase):
    def test_public_method_failure_falls_back_and_cools_down(self):
        from worker.public_rpc import public_rpc, PUBLIC_ENDPOINTS
        class Response:
            def __init__(self, status): self.status_code = status
            def raise_for_status(self): pass
            def json(self): return {'result': ['observed']}
        class Client:
            def __init__(self): self.calls = []
            def post(self, endpoint, **kwargs):
                self.calls.append(endpoint)
                return Response(429 if endpoint == PUBLIC_ENDPOINTS[0] else 200)
        client = Client()
        with patch.dict('os.environ', {'SOLANA_WALLET_RPC_URL': ''}):
            rpc = public_rpc(client, pause=lambda _: None, clock=lambda: 0)
            self.assertEqual(rpc('getTransaction', []), ['observed'])
            self.assertEqual(rpc('getTransaction', []), ['observed'])
        self.assertEqual(client.calls, [PUBLIC_ENDPOINTS[0], PUBLIC_ENDPOINTS[1], PUBLIC_ENDPOINTS[1]])

    def test_configured_endpoint_does_not_send_requests_to_public_fallbacks(self):
        from worker.public_rpc import public_rpc
        class Client:
            def __init__(self): self.calls = []
            def post(self, endpoint, **kwargs):
                self.calls.append(endpoint)
                raise ValueError('Unavailable')
        client = Client()
        with patch.dict('os.environ', {'SOLANA_WALLET_RPC_URL': 'https://configured.invalid'}):
            rpc = public_rpc(client, pause=lambda _: None)
            with self.assertRaises(ValueError): rpc('getTransaction', [])
        self.assertEqual(client.calls, ['https://configured.invalid'])


class BalanceExpansionTests(unittest.TestCase):
    def setUp(self):
        self.legacy = balances.group()
        self.registry = [dict(row, source='Nansen', smartMoney=True, interested=index == 0) for index, row in enumerate(self.legacy['wallets'])]
        self.token = 'So11111111111111111111111111111111111111112'

    def test_membership_is_stable_under_sort_and_separate_across_tokens_and_groups(self):
        one = balances.make_cohort(self.token, self.registry)
        self.assertEqual(one['groupId'], balances.make_cohort(self.token, self.registry[::-1])['groupId'])
        self.assertNotEqual(one['groupId'], balances.make_cohort(self.token, self.registry, 'interested')['groupId'])
        self.assertNotEqual(one['groupId'], balances.make_cohort(self.legacy['token'], self.registry)['groupId'])
        self.assertEqual(balances.make_cohort(self.legacy['token'], self.registry, 'legacy'), self.legacy)
        for token, scope in [(self.token, 'legacy'), ('bad', 'universe'), (self.token, 'all')]:
            with self.assertRaises(ValueError): balances.make_cohort(token, self.registry, scope)
        with self.assertRaises(ValueError): balances.make_cohort(self.token, [], 'interested')

    def test_arbitrary_mint_uses_measured_decimals_and_keeps_old_membership_history(self):
        cohort = balances.make_cohort(self.token, self.registry, 'interested')
        def rpc(method, params):
            if method == 'getTokenSupply':
                return {'result': {'value': {'amount': '1000000000000', 'decimals': 9}}}
            return {'result': {'value': [{'pubkey': 'account', 'account': {'data': {'parsed': {'info': {
                'owner': params[0], 'mint': self.token, 'tokenAmount': {'amount': '1234567890', 'decimals': 9}
            }}}}}]}}
        with tempfile.TemporaryDirectory() as folder:
            report = balances.collect(folder, rpc=rpc, now=AT, cohort=cohort)
            self.assertEqual(report['decimals'], 9)
            self.assertEqual(report['samples'][-1]['balanceRaw'], '1234567890')
            self.assertEqual(report['samples'][-1]['balance'], 1.23456789)
            changed = balances.make_cohort(self.token, self.registry[:2])
            self.assertEqual(balances.read_report(folder, changed)['samples'], [])
            self.assertEqual(len(balances.read_report(folder, cohort)['samples']), 1)

    def test_unknown_decimals_never_turn_into_invented_zero_balances(self):
        cohort = balances.make_cohort(self.token, self.registry)
        calls = []
        def rpc(method, params):
            calls.append(method)
            return {'error': {'message': 'rate limit'}}
        with tempfile.TemporaryDirectory() as folder:
            report = balances.collect(folder, rpc=rpc, now=AT, cohort=cohort)
        self.assertEqual(calls, ['getTokenSupply'])
        self.assertEqual(report['samples'], [])
        self.assertEqual(report['status'], 'unavailable')


class HistoryExpansionTests(unittest.TestCase):
    def test_cursor_waits_for_missing_transactions_and_then_advances(self):
        state, seen, events, calls = {}, {}, {}, []
        page = [dict(signature=SIGNATURE, slot=123, blockTime=AT//1000, err=None)]
        missing = True
        def rpc(method, params):
            calls.append((method, params))
            if method == 'getSignaturesForAddress': return page
            return None if missing else fixture()
        history_step('owner', state, seen, events, rpc, AT, float('inf'))
        self.assertEqual(len(state['pending']), 1)
        self.assertNotIn('before', state)
        self.assertNotIn('finishedAt', state)
        missing = False
        history_step('owner', state, seen, events, rpc, AT, float('inf'))
        self.assertEqual(state['before'], SIGNATURE)
        self.assertEqual(state['pending'], [])
        self.assertEqual(state['finishedAt'], AT)
        self.assertEqual(len(events), 1)
        self.assertEqual(sum(method == 'getSignaturesForAddress' for method, _ in calls), 1)

    def test_full_pages_use_saved_before_cursor_and_stop_at_old_boundary(self):
        seen, events = {}, {}
        page = [dict(signature='s'+str(i), slot=i, blockTime=AT//1000, err={'failed': 1}) for i in range(40)]
        calls = []
        def rpc(method, params):
            calls.append(params[1])
            return page if len(calls) == 1 else [dict(signature='old', slot=0, blockTime=(AT-RETENTION-1000)//1000, err=None)]
        state = history_step('owner', {}, seen, events, rpc, AT, float('inf'))
        self.assertEqual(state['before'], 's39')
        self.assertNotIn('finishedAt', state)
        state = history_step('owner', state, seen, events, rpc, AT, float('inf'))
        self.assertEqual(calls[1]['before'], 's39')
        self.assertEqual(state['finishedAt'], AT)
        self.assertEqual(events, {})


class DiscoveryTests(unittest.TestCase):
    def test_largest_token_accounts_resolve_deduplicate_and_filter_authorities(self):
        mint = balances.group()['token']
        owners = [row['address'] for row in balances.group()['wallets']]
        self.assertTrue(on_curve(owners[0]))
        # Construct an off-curve authority deterministically.
        from test_smartness import encode58
        pda = next(encode58(bytes([i])*32) for i in range(1, 255) if not on_curve(encode58(bytes([i])*32)))
        accounts = owners[:4]
        def account(owner, raw):
            return dict(owner=PROGRAMS[0], data=dict(parsed=dict(info=dict(owner=owner, mint=mint, state='initialized', tokenAmount=dict(amount=str(raw), decimals=6)))))
        def rpc(method, params):
            if method == 'getTokenLargestAccounts': return dict(context=dict(slot=100), value=[dict(address=address) for address in accounts])
            if params[0] == accounts: return dict(value=[account(owners[0], 100), account(owners[0], 200), account(pda, 999), account(owners[1], 500)])
            return dict(value=[dict(owner=PROGRAMS[0], executable=False) if address == owners[1] else dict(owner='11111111111111111111111111111111', executable=False) for address in params[0]])
        report = holder_candidates(mint, rpc, now=AT)
        self.assertEqual(len(report['candidates']), 1)
        self.assertEqual(report['candidates'][0]['address'], owners[0])
        self.assertEqual(report['candidates'][0]['balanceRaw'], '300')
        self.assertEqual(report['candidates'][0]['source'], 'Public')
        self.assertEqual(report['excludedAccounts'], 2)

    def test_incomplete_account_resolution_is_an_error_not_an_empty_holder_list(self):
        mint = balances.group()['token']
        address = balances.group()['wallets'][0]['address']
        def rpc(method, params):
            return dict(value=[dict(address=address)]) if method == 'getTokenLargestAccounts' else dict(value=[])
        with self.assertRaises(ValueError): holder_candidates(mint, rpc)


if __name__ == '__main__': unittest.main()
