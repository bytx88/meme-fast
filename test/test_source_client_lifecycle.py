import asyncio
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from worker.source_stream import SourceStream


class SourceClientLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(asyncio.set_event_loop_policy, asyncio.get_event_loop_policy())
        import modal_app
        self.app = modal_app
        self.folder = tempfile.TemporaryDirectory()
        self.stream = SourceStream(self.folder.name, clock=lambda: 1000, failure_ttl=30)
        self.session = SimpleNamespace(stream=lambda: self.stream, finish=MagicMock())
        self.session_patch = patch('worker.source_stream.source_session', return_value=self.session)
        self.session_patch.start()
        self.client_patch = patch('httpx.Client')
        self.client = self.client_patch.start()
        self.client.return_value.__enter__.return_value = sentinel = object()
        self.entered_client = sentinel

    def tearDown(self):
        self.client_patch.stop()
        self.session_patch.stop()
        self.stream.close()
        self.folder.cleanup()

    def test_each_market_contract_opens_client_only_for_miss_and_always_closes_it(self):
        address = 'A' * 32
        cases = [('profiles', [], 'profiles', []), ('search', ['cat'], 'quotes', {'pairs': []}),
                 ('solana', [address], 'pools', []), ('base', ['b' * 40], 'quotes', [])]
        for network, addresses, scope, body in cases:
            with self.subTest(scope=scope, network=network), patch('worker.source_stream.paced_get') as get:
                self.client.reset_mock()
                get.return_value.json.return_value = body
                first = self.app.read_market_source.local(network, addresses, scope)
                second = self.app.read_market_source.local(network, addresses, scope)
                self.assertEqual(second['cache'], 'hit')
                self.assertEqual(second['observedAt'], first['observedAt'])
                self.client.assert_called_once_with(timeout=15, follow_redirects=False)
                self.client.return_value.__exit__.assert_called_once()
                get.assert_called_once()
                self.assertIs(get.call_args.args[1], self.entered_client)

    def test_market_pool_projection_skips_client_and_preserves_observation(self):
        address = 'A' * 32
        pair = {'chainId': 'solana', 'baseToken': {'address': address}}
        self.stream.store('dex:pools', [2, 'solana', address], [pair], 990000, 60)
        pool = self.app.read_market_source.local('solana', [address], 'pools')
        quote = self.app.read_market_source.local('solana', [address], 'quotes')
        self.client.assert_not_called()
        self.assertEqual(pool['observedAt'], 990000)
        self.assertEqual(quote['observedAt'], 990000)
        self.assertEqual(quote['value'][0]['_sourceObservedAt'], 990000)

    def test_market_failure_closes_client_and_shared_backoff_skips_setup(self):
        with patch('worker.source_stream.paced_get', side_effect=ValueError('unavailable')):
            with self.assertRaises(ValueError):
                self.app.read_market_source.local('profiles', [], 'profiles')
            with self.assertRaises(ValueError):
                self.app.read_market_source.local('profiles', [], 'profiles')
        self.client.assert_called_once()
        self.client.return_value.__exit__.assert_called_once()
        self.assertEqual(self.session.finish.call_count, 2)

    def test_rpc_exact_hit_and_account_projection_skip_setup_after_closed_miss(self):
        with patch('worker.public_rpc.public_rpc') as rpc:
            rpc.return_value.return_value = {'value': '100'}
            first = self.app.read_source.local('solana', 'getTokenSupply', ['mint'])
            second = self.app.read_source.local('solana', 'getTokenSupply', ['mint'])
            self.assertEqual(first['observedAt'], second['observedAt'])
            self.client.assert_called_once_with(timeout=12)
            self.client.return_value.__exit__.assert_called_once()
            rpc.assert_called_once()
        self.client.reset_mock()
        config = {'encoding': 'base64'}
        with patch('worker.public_rpc.public_rpc') as rpc:
            rpc.return_value.return_value = {'context': {'slot': 42}, 'value': [None, None]}
            first = self.app.read_source.local('solana', 'getMultipleAccounts', [['A', 'B'], config])
            second = self.app.read_source.local('solana', 'getMultipleAccounts', [['B'], config])
            self.assertEqual(second['cache'], 'hit')
            self.assertEqual(first['observedAt'], second['observedAt'])
            self.client.assert_called_once_with(timeout=12)
            self.client.return_value.__exit__.assert_called_once()
            rpc.assert_called_once()

    def test_rpc_wallet_projection_never_opens_client(self):
        from worker.shared_holdings import PROGRAMS
        config = {'encoding': 'jsonParsed', 'commitment': 'confirmed'}
        for program in PROGRAMS:
            self.stream.store('solana:getTokenAccountsByOwner', ['owner', {'programId': program}, config],
                              {'context': {'slot': 42}, 'value': []}, 990000, 240)
        reply = self.app.read_source.local('solana', 'getTokenAccountsByOwner',
                                           ['owner', {'mint': 'mint'}, config])
        self.client.assert_not_called()
        self.assertEqual(reply['cache'], 'projected-wallet-scan')
        self.assertEqual(reply['observedAt'], 990000)

    def test_rpc_failure_closes_client_persists_cooldown_and_shared_backoff_skips_setup(self):
        def fail(client, **options):
            options['blocked'][('rpc.test', 'getTokenSupply')] = 100000000000
            raise ValueError('unavailable')
        with patch('worker.public_rpc.public_rpc', side_effect=fail):
            for _ in range(2):
                with self.assertRaises(ValueError):
                    self.app.read_source.local('solana', 'getTokenSupply', ['mint'])
        self.client.assert_called_once()
        self.client.return_value.__exit__.assert_called_once()
        self.assertEqual(self.stream.cooldowns(), {('rpc.test', 'getTokenSupply'): 100000000000})
        self.assertEqual(self.session.finish.call_args_list[0].kwargs, {'force': True})


if __name__ == '__main__':
    unittest.main()
