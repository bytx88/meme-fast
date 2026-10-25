import copy
import tempfile
import unittest

from worker.rpc_projection import multiple_accounts
from worker.source_stream import SourceDeferred, SourceStream, SourceUnavailable


def account(label='A', encoding='base64'):
    data = ({'program': 'spl-token', 'parsed': {'type': 'account', 'info': {'owner': label}}, 'space': 165}
            if encoding == 'jsonParsed' else [label, encoding])
    return dict(data=data, executable=False, lamports=100, owner='program', rentEpoch=10, space=165)


class RpcProjectionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.clock = [1000]
        self.stream = SourceStream(self.folder.name, clock=lambda: self.clock[0], failure_ttl=30)
        self.calls = []

    def tearDown(self):
        self.stream.close()
        self.folder.cleanup()

    def provider(self, slot=100, nulls=()):
        def fetch(params):
            self.calls.append(copy.deepcopy(params))
            return dict(context={'slot': slot, 'apiVersion': '2.3'},
                        value=[None if address in nulls else account(address, params[1].get('encoding', 'base64'))
                               for address in params[0]])
        return fetch

    def test_production_rpc_owner_uses_missing_only_projection(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        import modal_app
        finishes=[]
        session=SimpleNamespace(stream=lambda:self.stream,finish=lambda **kwargs:finishes.append(kwargs))
        def rpc(method,params):
            self.assertEqual(method,'getMultipleAccounts')
            return self.provider()(params)
        config={'encoding':'jsonParsed','commitment':'confirmed'}
        with patch('worker.source_stream.source_session',return_value=session), \
             patch('worker.public_rpc.public_rpc',return_value=rpc):
            modal_app.read_source.local('solana','getMultipleAccounts',[['A','B'],config])
            reply=modal_app.read_source.local('solana','getMultipleAccounts',[['B','C'],config])
        self.assertEqual([row[0] for row in self.calls],[['A','B'],['C']])
        self.assertFalse(reply['value']['_sourceAtomic'])
        self.assertEqual(len(finishes),2)

    def read(self, addresses, config=None, fetch=None):
        return multiple_accounts(self.stream, [addresses, config or {}], fetch or self.provider())

    def test_overlap_reorders_and_duplicates_reuse_nulls_with_original_evidence(self):
        first = self.read(['A', 'B', 'C'], fetch=self.provider(100, nulls={'B'}))
        self.clock[0] += 10
        second = self.read(['C', 'B', 'D', 'C'], fetch=self.provider(110))
        self.assertEqual([call[0] for call in self.calls], [['A', 'B', 'C'], ['D']])
        self.assertEqual([row['data'][0] if row else None for row in second['value']['value']], ['C', None, 'D', 'C'])
        self.assertEqual(second['observedAt'], first['observedAt'])
        self.assertEqual(second['value']['context']['slot'], 100)
        evidence = second['value']['_sourceAccountObservations']
        self.assertEqual([row['context']['slot'] for row in evidence], [100, 100, 110, 100])
        self.assertEqual([row['observedAt'] for row in evidence], [1000000, 1000000, 1010000, 1000000])
        self.assertTrue(first['value']['_sourceAtomic'])
        self.assertFalse(second['value']['_sourceAtomic'])
        self.assertEqual(self.read(['B', 'A'])['cache'], 'hit')
        self.assertEqual(len(self.calls), 2)

    def test_minimum_slot_is_a_constraint_and_only_outdated_accounts_are_pulled(self):
        config = {'encoding': 'jsonParsed', 'commitment': 'confirmed', 'minContextSlot': 90}
        self.read(['A', 'B'], config, self.provider(100))
        self.clock[0] += 1
        stronger = dict(config, minContextSlot=101)
        self.read(['B'], stronger, self.provider(200))
        self.clock[0] += 1
        result = self.read(['A', 'B'], dict(config, minContextSlot=150), self.provider(210))
        self.assertEqual([call[0] for call in self.calls], [['A', 'B'], ['B'], ['A']])
        self.assertEqual(result['value']['context']['slot'], 200)
        self.assertEqual([row['context']['slot'] for row in result['value']['_sourceAccountObservations']], [210, 200])
        self.read(['A', 'B'], dict(config, minContextSlot=99))
        self.assertEqual(len(self.calls), 3)

    def test_encoding_commitment_slice_and_unknown_options_remain_separate_scopes(self):
        configs = [{}, {'encoding': 'base64'}, {'encoding': 'jsonParsed'},
                   {'encoding': 'base64', 'commitment': 'confirmed'},
                   {'encoding': 'base64', 'dataSlice': {'offset': 0, 'length': 0}},
                   {'encoding': 'base64', 'dataSlice': {'offset': 0, 'length': 8}},
                   {'encoding': 'base64', 'futureOption': 'required'}]
        for config in configs:
            self.read(['A'], config)
        for config in reversed(configs):
            self.read(['A'], config)
        self.assertEqual(len(self.calls), len(configs))
        self.assertEqual([call[1] for call in self.calls], configs)

    def test_freshness_never_extends_and_partial_expiry_fetches_only_expired_rows(self):
        first = self.read(['A'])
        self.clock[0] += 10
        self.read(['A', 'B'])
        self.clock[0] += 19
        self.assertEqual(self.read(['A', 'B'])['observedAt'], first['observedAt'])
        self.clock[0] += 1
        refreshed = self.read(['A', 'B'], fetch=self.provider(101))
        self.assertEqual([call[0] for call in self.calls], [['A'], ['B'], ['A']])
        self.assertEqual(refreshed['observedAt'], 1010000)
        self.assertEqual([row['observedAt'] for row in refreshed['value']['_sourceAccountObservations']], [1030000, 1010000])

    def test_invalid_provider_batch_never_certifies_a_partial_or_zero_observation(self):
        valid = dict(context={'slot': 100}, value=[account('A'), account('B')])
        cases = [None, {}, dict(valid, value=[]), dict(valid, context={'slot': True}),
                 dict(valid, context={'slot': 99}), dict(valid, context={'slot': 100, 'apiVersion': 2}),
                 dict(valid, value=[account('A'), {}]), dict(valid, value=[account('A'), False]),
                 dict(valid, value=[account('A'), dict(account(), lamports=True)]),
                 dict(valid, value=[account('A'), dict(account(), data=['x', 'base58'])]),
                 dict(valid, error={'message': 'unavailable'})]
        for index, body in enumerate(cases):
            with self.subTest(body=body):
                addresses = [f'A{index}', f'B{index}']
                with self.assertRaises(ValueError):
                    self.read(addresses, {'encoding': 'base64', 'minContextSlot': 100}, lambda _: body)
                self.assertEqual(self.stream.db.execute('SELECT count(*) FROM responses').fetchone()[0], 0)

    def test_failed_batch_backoff_applies_to_overlaps_and_expires_without_extension(self):
        def fail(params):
            self.calls.append(copy.deepcopy(params))
            raise ValueError('provider unavailable')
        with self.assertRaises(ValueError):
            self.read(['A', 'B'], fetch=fail)
        self.clock[0] += 10
        with self.assertRaises(SourceUnavailable) as caught:
            self.read(['B', 'C'])
        self.assertEqual(caught.exception.retry_after, 20)
        self.clock[0] += 10
        with self.assertRaises(SourceUnavailable) as caught:
            self.read(['C', 'B'])
        self.assertEqual(caught.exception.retry_after, 10)
        self.assertEqual(len(self.calls), 1)
        self.clock[0] += 10
        result = self.read(['B', 'C'])
        self.assertEqual(result['observedAt'], 1030000)
        self.assertEqual(len(self.calls), 2)

    def test_failed_stricter_constraint_cannot_block_weaker_compatible_read(self):
        config = {'encoding': 'base64'}
        self.read(['A'], config, self.provider(100))
        def fail(_):
            raise ValueError('minimum context slot not reached')
        with self.assertRaises(ValueError):
            self.read(['A', 'B'], dict(config, minContextSlot=200), fail)
        self.assertEqual(self.read(['A'], dict(config, minContextSlot=90))['cache'], 'hit')
        self.read(['B'], dict(config, minContextSlot=90), self.provider(110))
        self.assertEqual(len(self.calls), 2)

    def test_cache_reuse_survives_restart_and_does_not_trust_legacy_exact_cache(self):
        self.stream.store('solana:getMultipleAccounts', [['A'], {}], {'value': [None]}, 1000000, 30)
        original = self.read(['A', 'B'], fetch=self.provider(100, nulls={'A'}))
        self.stream.close()
        self.stream = SourceStream(self.folder.name, clock=lambda: self.clock[0], failure_ttl=30)
        restored = self.read(['B', 'A'])
        self.assertEqual(restored['observedAt'], original['observedAt'])
        self.assertEqual(restored['value']['value'][1], None)
        self.assertEqual(len(self.calls), 1)

    def test_same_slot_and_millisecond_from_distinct_batches_is_not_atomic(self):
        self.read(['A'])
        result = self.read(['A', 'B'])
        self.assertFalse(result['value']['_sourceAtomic'])
        self.assertEqual(result['value']['context']['slot'], 100)

    def test_recorded_system_and_token_shapes_accept_u64_sentinel_and_parsed_fallback(self):
        # Shapes from Solana's getMultipleAccounts example and Agave's account
        # encoder: ordinary system wallets have empty data and are not parsed.
        system = {'data': ['', 'base64'], 'executable': False,
                  'lamports': 88849814690250, 'owner': '11111111111111111111111111111111',
                  'rentEpoch': 18446744073709551615, 'space': 0}
        token = account('token', 'jsonParsed')
        def fetch(params):
            self.calls.append(copy.deepcopy(params))
            return {'context': {'slot': 341197247, 'apiVersion': '3.1.8'},
                    'value': [system, token, None]}
        result = self.read(['wallet', 'token', 'missing'], {'encoding': 'jsonParsed'}, fetch)
        self.assertEqual(result['value']['value'], [system, token, None])
        cached = self.read(['missing', 'token', 'wallet'], {'encoding': 'jsonParsed'})
        self.assertEqual(cached['value']['value'], [None, token, system])
        self.assertEqual(len(self.calls), 1)

    def test_zstd_plain_base64_fallback_reuses_only_its_requested_scope(self):
        def fetch(params):
            self.calls.append(copy.deepcopy(params))
            return {'context': {'slot': 100}, 'value': [account('AQI=', 'base64')]}
        first = self.read(['A'], {'encoding': 'base64+zstd'}, fetch)
        again = self.read(['A', 'A'], {'encoding': 'base64+zstd'}, fetch)
        self.assertEqual(again['observedAt'], first['observedAt'])
        self.assertEqual(len(self.calls), 1)
        self.read(['A'], {'encoding': 'base64'}, fetch)
        self.assertEqual(len(self.calls), 2)

    def test_base58_encoding_error_sentinel_is_not_a_successful_observation(self):
        def fetch(params):
            self.calls.append(copy.deepcopy(params))
            return {'context': {'slot': 100},
                    'value': [account('error: data too large for bs58 encoding', 'base58')]}
        with self.assertRaisesRegex(ValueError, 'encoding failed'):
            self.read(['A'], {'encoding': 'base58'}, fetch)
        self.assertEqual(self.stream.db.execute('SELECT count(*) FROM responses').fetchone()[0], 0)
        with self.assertRaises(SourceUnavailable):
            self.read(['A', 'B'], {'encoding': 'base58'}, fetch)
        self.assertEqual(len(self.calls), 1)
        # The failure is an encoding problem, not an absence of this account.
        self.read(['A'], {'encoding': 'jsonParsed'}, self.provider())
        self.assertEqual(len(self.calls), 2)

    def test_deferred_admission_is_not_a_failed_account_observation(self):
        def deferred(_):
            raise SourceDeferred(7)
        with self.assertRaises(SourceDeferred):
            self.read(['A'], fetch=deferred)
        result = self.read(['A'])
        self.assertEqual(result['cache'], 'miss')
        self.assertEqual(self.stream.metrics()['solana:getMultipleAccounts']['failures'], 0)

    def test_empty_batch_preserves_a_real_provider_context(self):
        result = self.read([], fetch=self.provider(123))
        self.assertEqual(result['value']['context']['slot'], 123)
        self.assertEqual(result['value']['value'], [])
        self.read([])
        self.assertEqual(len(self.calls), 1)

    def test_invalid_request_constraints_fail_before_any_provider_read(self):
        configs = [{'minContextSlot': True}, {'minContextSlot': -1}, {'minContextSlot': 1.5},
                   {'encoding': None}, {'commitment': 'unknown'},
                   {'dataSlice': {'offset': 0, 'length': True}},
                   {'dataSlice': {'offset': 0}}, {'futureOption': float('nan')}]
        for config in configs:
            with self.subTest(config=config), self.assertRaises(ValueError):
                self.read(['A'], config)
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
