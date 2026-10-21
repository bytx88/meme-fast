import tempfile
import unittest
from unittest.mock import patch
from worker.source_stream import SourceStream, dex_tokens, dex_pools, SourceSession, gecko_path, source_metrics, mint_from_wallet_cache


class SourceStreamTests(unittest.TestCase):
    def test_complete_program_cache_supplies_mint_reads_without_another_rpc(self):
        from worker.shared_holdings import PROGRAMS
        config={'encoding':'jsonParsed','commitment':'confirmed'}
        positive={'context':{'slot':123},'value':[{'pubkey':'account','account':{'data':{'parsed':{'info':
            {'owner':'owner','mint':'mint','tokenAmount':{'amount':'123','decimals':6}}}}}}]}
        empty={'context':{'slot':124},'value':[]}
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder,clock=lambda:1010)
            stream.store('solana:getTokenAccountsByOwner',['owner',{'programId':PROGRAMS[0]},config],positive,1000000,240)
            self.assertIsNone(mint_from_wallet_cache(stream,['owner',{'mint':'mint'},config]))
            stream.store('solana:getTokenAccountsByOwner',['owner',{'programId':PROGRAMS[1]},config],empty,1001000,240)
            reply=mint_from_wallet_cache(stream,['owner',{'mint':'mint'},config])
            self.assertEqual(reply['observedAt'],1000000)
            self.assertEqual(reply['value']['context']['slot'],123)
            self.assertEqual(len(reply['value']['value']),1)
            self.assertEqual(mint_from_wallet_cache(stream,['owner',{'mint':'missing'},config])['value']['value'],[])
            stream.close()
    def test_older_pool_evidence_does_not_replace_a_newer_shared_quote(self):
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder,clock=lambda:1100)
            stream.store('quote',['A'],{'price':2},1100000,60)
            stream.store('quote',['A'],{'price':1},1090000,60)
            self.assertEqual(stream.lookup('quote',['A'])['value'],{'price':2})
            stream.close()

    def test_batch_quote_is_not_used_as_complete_pool_discovery(self):
        calls = []
        pair = dict(chainId='solana',baseToken={'address':'A'},pairAddress='pool1')
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder)
            dex_tokens(stream,'solana',['A'],lambda *a:[pair])
            def pools(*args):
                calls.append(args)
                return [pair,dict(pair,pairAddress='pool2')]
            complete = dex_pools(stream,'solana','A',pools)
            self.assertEqual(len(complete['value']),2)
            self.assertEqual(len(calls),1)
            quote = dex_tokens(stream,'solana',['A'],lambda *a:self.fail('full pools should supply quotes'))
            self.assertEqual(len(quote['value']),2)
            stream.close()
    def test_overlapping_market_batches_fetch_only_missing_tokens_and_keep_times(self):
        calls, clock = [], [1000]
        def fetch(network, addresses):
            calls.append(addresses)
            return [dict(chainId=network, baseToken={'address': address}, priceUsd='1') for address in addresses]
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: clock[0])
            first = dex_tokens(stream, 'solana', ['A','B'], fetch)
            clock[0] += 10
            second = dex_tokens(stream, 'solana', ['B','C'], fetch)
            third = dex_tokens(stream, 'solana', ['C','B'], fetch)
            self.assertEqual(calls, [['A','B'],['C']])
            self.assertEqual(second['observedAt'], first['observedAt'])
            self.assertEqual({p['baseToken']['address']: p['_sourceObservedAt'] for p in second['value']}, {'B':1000000,'C':1010000})
            self.assertEqual(third['cache'], 'hit')
            stream.close()

    def test_volume_checkpoints_are_batched_and_close_sqlite_before_commit(self):
        clock, calls = [1000], []
        class Volume:
            def reload(self): calls.append('reload')
            def commit(self): calls.append('commit')
        with tempfile.TemporaryDirectory() as folder:
            session = SourceSession(folder, Volume(), clock=lambda: clock[0])
            session.stream().get('a', [], lambda: [], 60)
            for _ in range(20):session.finish()
            self.assertEqual(calls, ['reload'])
            clock[0] += 30
            session.finish()
            self.assertIsNone(session.connection)
            self.assertEqual(calls, ['reload','commit'])
            session.stream().get('a', [], lambda: [], 60)
            session.finish(force=True)
            self.assertEqual(calls, ['reload','commit','commit'])

    def test_gecko_source_rejects_unrestricted_paths_and_normalizes_query_order(self):
        self.assertEqual(gecko_path('/networks/solana/trending_pools?page=1&include=base_token'),
                         gecko_path('/networks/solana/trending_pools?include=base_token&page=1'))
        for path in ('https://example.com/x', '//example.com/x', '/networks/solana/../../x',
                     '/networks/solana/new_pools?key=secret', '/networks/solana/new_pools?page=1&page=2'):
            with self.assertRaises(ValueError):gecko_path(path)

    def test_source_health_reads_only_committed_counters(self):
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder+'/solana')
            stream.get('method', [], lambda: [], 60)
            stream.close()
            self.assertEqual(source_metrics(folder)['solana']['method'], dict(cacheHits=0,cacheMisses=1,failures=0))

    def test_cross_instance_cache_preserves_observation_time_and_counts_actual_fetches(self):
        clock = [1000]
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: clock[0])
            first = stream.get('rpc', {'b': 2, 'a': 1}, lambda: {'value': 'raw'}, 60)
            stream.close()
            clock[0] += 30
            stream = SourceStream(folder, clock=lambda: clock[0])
            second = stream.get('rpc', {'a': 1, 'b': 2}, lambda: self.fail('duplicate fetch'), 60)
            self.assertEqual(second['observedAt'], first['observedAt'])
            self.assertEqual(second['cache'], 'hit')
            self.assertEqual(stream.metrics()['rpc'], dict(hits=1, requests=1, failures=0))
            clock[0] += 30
            third = stream.get('rpc', {'a': 1, 'b': 2}, lambda: {'value': 'new'}, 60)
            self.assertEqual(third['cache'], 'miss')
            self.assertEqual(third['observedAt'], 1060000)
            stream.close()

    def test_failed_or_absent_responses_are_not_cached_as_observations(self):
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder)
            for _ in range(2):
                with self.assertRaises(ValueError):
                    stream.get('rpc', [], lambda: None, 60)
            self.assertEqual(stream.metrics()['rpc'], dict(hits=0, requests=2, failures=2))
            empty = stream.get('rpc', [], lambda: [], 60)
            self.assertEqual(empty['value'], [])  # A measured empty list is valid.
            stream.close()

    def test_provider_cooldowns_survive_source_container_restarts(self):
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: 1000)
            stream.save_cooldowns({('endpoint', 'method'): 1100, ('expired', 'method'): 900})
            stream.close()
            other = SourceStream(folder, clock=lambda: 1050)
            self.assertEqual(other.cooldowns(), {('endpoint', 'method'): 1100})
            other.close()
