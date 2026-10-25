import copy
import tempfile
import unittest

from worker.gecko_projection import index_entity, lookup_entity, seed_top_pools, MAX_CONTRACTS
from worker.source_stream import SourceStream, gecko_response


def resource(kind, address, network='solana', related=None):
    attrs = {'address': address}
    if kind == 'pool':
        attrs.update(base_token_price_usd='1', quote_token_price_usd='2', reserve_in_usd='10000',
                     volume_usd={'h24': '10000'}, transactions={'h1': {'buys': 10, 'sells': 2}},
                     price_change_percentage={'h1': '5'})
    else:
        attrs.update(total_reserve_in_usd='10000', volume_usd={'h24': '10000'})
    return dict(type=kind, id=network + '_' + address, attributes=attrs,
                relationships={name: {'data': refs} for name, refs in (related or {}).items()})


def reference(kind, address, network='solana'):
    return {'type': kind, 'id': network + '_' + address}


def pools(addresses):
    data = [resource('pool', address, related={'base_token': reference('token', 'Token' + address),
                                               'quote_token': reference('token', 'Quote'),
                                               'dex': {'type': 'dex', 'id': 'raydium'}}) for address in addresses]
    included = [resource('token', 'Token' + address) for address in addresses]
    included.extend([resource('token', 'Quote'), {'type': 'dex', 'id': 'raydium'}])
    return dict(data=data, included=included, links={'self': 'richer-endpoint'})


class GeckoProjectionTests(unittest.TestCase):
    def test_predeployment_rich_records_reuse_without_an_index_or_a_pull(self):
        now = [1000]
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: now[0])
            query = 'include=base_token%2Cquote_token'
            stream.store('gecko:entity', [2, 'solana', 'pools', 'A', query], pools(['A']), 1000000, 300)
            self.assertIsNone(stream.lookup('gecko:contracts', [1, 'solana', 'pools', 'A', '']))
            bare = lookup_entity(stream, 'solana', 'pools', 'A', '', 300)
            subset = lookup_entity(stream, 'solana', 'pools', 'A', 'include=base_token', 300)
            self.assertEqual(bare['observedAt'], 1000000)
            self.assertNotIn('included', bare['value'])
            self.assertEqual([row['id'] for row in subset['value']['included']], ['solana_TokenA'])
            reply = gecko_response(stream, '/networks/solana/pools/multi/A',
                                   lambda _: self.fail('predeployment record must prevent a new pull'), 300)
            self.assertEqual(reply['observedAt'], 1000000)
            now[0] = 1301
            self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'A', '', 300))
            self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'A', 'include=base_token', 300))
            stream.close()

    def test_legacy_probes_preserve_exact_noninclude_scope(self):
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: 1000)
            query = 'currency=usd&include=base_token%2Cquote_token'
            stream.store('gecko:entity', [2, 'solana', 'pools', 'A', query], pools(['A']), 1000000, 300)
            self.assertIsNotNone(lookup_entity(stream, 'solana', 'pools', 'A', 'currency=usd', 300))
            self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'A', 'currency=eth', 300))
            self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'A', '', 300))
            stream.close()

    def test_fresh_legacy_superset_can_satisfy_an_exact_key_in_backoff(self):
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: 1000, failure_ttl=30)
            query = 'include=base_token%2Cquote_token'
            stream.store('gecko:entity', [2, 'solana', 'pools', 'A', query], pools(['A']), 1000000, 300)
            stream.defer('gecko:entity', [2, 'solana', 'pools', 'A', ''])
            reply = gecko_response(stream, '/networks/solana/pools/multi/A',
                                   lambda _: self.fail('fresh compatible evidence must bypass exact-read backoff'), 300)
            self.assertEqual(reply['observedAt'], 1000000)
            self.assertEqual(reply['cache'], 'hit')
            self.assertNotIn('gecko:request', stream.metrics())
            stream.close()

    def test_normal_contracts_add_no_index_rows_and_lookups_use_fixed_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: 1000)
            # Near-capacity cache: indices must not evict useful market rows.
            rows = [(stream.key('fixture', number), 1300, 1000, '{}') for number in range(1998)]
            stream.db.executemany('INSERT INTO responses VALUES (?,?,?,?)', rows)
            stream.store('gecko:entity', [2, 'solana', 'pools', 'A', 'include=base_token%2Cquote_token'],
                         pools(['A']), 1000000, 300)
            before = stream.db.execute('SELECT COUNT(*) FROM responses').fetchone()[0]
            index_entity(stream, 'solana', 'pools', 'A', 'include=base_token%2Cquote_token')
            self.assertEqual(stream.db.execute('SELECT COUNT(*) FROM responses').fetchone()[0], before)
            statements = []
            stream.db.set_trace_callback(statements.append)
            self.assertIsNotNone(lookup_entity(stream, 'solana', 'pools', 'A', '', 300))
            stream.db.set_trace_callback(None)
            reads = [sql for sql in statements if sql.startswith('SELECT expires,sampled,body FROM responses')]
            self.assertEqual(len(reads), 5)  # Index, three known keys, returned exact-key read.
            self.assertTrue(all('WHERE key=' in sql for sql in reads))
            stream.close()

    def test_superset_reuses_overlap_and_only_missing_entities_reach_provider(self):
        now = [1000]
        query = 'include=base_token%2Cdex%2Cquote_token'
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: now[0])
            first = gecko_response(stream, '/networks/solana/pools/multi/A,B?' + query,
                                   lambda _: pools(['A', 'B']), 300)
            for address in ['A', 'B']:
                index_entity(stream, 'solana', 'pools', address, query)
            now[0] += 10
            subset = 'include=base_token%2Cquote_token'
            projected = lookup_entity(stream, 'solana', 'pools', 'B', subset, 300)
            self.assertEqual(projected['observedAt'], first['observedAt'])
            self.assertEqual({row['id'] for row in projected['value']['included']},
                             {'solana_TokenB', 'solana_Quote'})
            self.assertNotIn('links', projected['value'])
            calls = []
            def fetch(path):
                calls.append(path)
                return pools(['C'])
            joined = gecko_response(stream, '/networks/solana/pools/multi/B,C?' + subset, fetch, 300)
            self.assertEqual(calls, ['/networks/solana/pools/multi/C?' + subset])
            self.assertEqual(joined['observedAt'], first['observedAt'])
            self.assertEqual({row['id'] for row in joined['value']['data']}, {'solana_B', 'solana_C'})
            self.assertNotIn('solana_TokenA', {row['id'] for row in joined['value']['included']})
            stream.close()

    def test_nested_requested_includes_exclude_unrequested_reachable_resources(self):
        body = pools(['P'])
        base = body['included'][0]
        base['relationships'] = {'top_pools': {'data': [reference('pool', 'Other')]}}
        body['included'].append(resource('pool', 'Other'))
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: 1000)
            query = 'include=base_token.top_pools%2Cquote_token'
            stream.store('gecko:entity', [2, 'solana', 'pools', 'P', query], body, 1000000, 300)
            index_entity(stream, 'solana', 'pools', 'P', query)
            direct = lookup_entity(stream, 'solana', 'pools', 'P', 'include=base_token', 300)
            self.assertEqual([row['id'] for row in direct['value']['included']], ['solana_TokenP'])
            nested = lookup_entity(stream, 'solana', 'pools', 'P', 'include=base_token.top_pools', 300)
            self.assertEqual({row['id'] for row in nested['value']['included']}, {'solana_TokenP', 'solana_Other'})
            self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'P', 'include=dex', 300))
            stream.close()

    def test_noninclude_query_scope_and_solana_case_remain_exact(self):
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: 1000)
            query = 'currency=usd&include=base_token%2Cquote_token'
            stream.store('gecko:entity', [2, 'solana', 'pools', 'ABC', query], pools(['ABC']), 1000000, 300)
            index_entity(stream, 'solana', 'pools', 'ABC', query)
            self.assertIsNotNone(lookup_entity(stream, 'solana', 'pools', 'ABC', 'currency=usd', 300))
            self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'ABC', '', 300))
            self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'ABC', 'currency=eth', 300))
            self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'abc', 'currency=usd', 300))
            stream.close()

    def test_projection_cannot_extend_source_expiry_or_requested_freshness(self):
        now = [1000]
        query = 'include=base_token%2Cquote_token'
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: now[0])
            stream.store('gecko:entity', [2, 'solana', 'pools', 'A', query], pools(['A']), 1000000, 60)
            index_entity(stream, 'solana', 'pools', 'A', query)
            now[0] = 1059
            self.assertEqual(lookup_entity(stream, 'solana', 'pools', 'A', '', 300)['observedAt'], 1000000)
            self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'A', 'include=base_token', 30))
            now[0] = 1061
            self.assertIsNone(stream.lookup('gecko:entity', [2, 'solana', 'pools', 'A', '']))
            self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'A', 'include=base_token', 300))
            stream.close()

    def test_malformed_missing_includes_and_partial_primary_do_not_certify_projection(self):
        good = pools(['A'])
        mutations = [lambda body: body['data'][0]['attributes'].pop('quote_token_price_usd'),
                     lambda body: body['data'][0]['attributes'].update(address='Wrong'),
                     lambda body: body.update(included=[]),
                     lambda body: body['data'][0].update(relationships={'base_token': {'data': True}}),
                     lambda body: body['included'].append(dict(body['included'][0], attributes={'address': 'Wrong'}))]
        for mutate in mutations:
            body = copy.deepcopy(good)
            mutate(body)
            with self.subTest(body=body), tempfile.TemporaryDirectory() as folder:
                stream = SourceStream(folder, clock=lambda: 1000)
                query = 'include=base_token%2Cquote_token'
                stream.store('gecko:entity', [2, 'solana', 'pools', 'A', query], body, 1000000, 300)
                index_entity(stream, 'solana', 'pools', 'A', query)
                self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'A', '', 300))
                stream.close()

    def test_complete_launch_pools_supply_existing_pool_include_contract(self):
        body = pools(['P'])
        token = body['included'][0]
        token['relationships'] = {'top_pools': {'data': [reference('pool', 'P')]}}
        launch = {'data': [token], 'included': [body['data'][0], body['included'][1], body['included'][2]]}
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: 1000)
            seed_top_pools(stream, 'solana', launch, 1000000, 600)
            calls = []
            def fetch(path):
                calls.append(path)
                return pools(['P'])
            reply = gecko_response(stream, '/networks/solana/pools/multi/P?include=base_token,quote_token', fetch, 300)
            self.assertEqual(calls, [])
            self.assertEqual(reply['observedAt'], 1000000)
            self.assertEqual({row['id'] for row in reply['value']['included']}, {'solana_TokenP', 'solana_Quote'})
            self.assertIsNone(stream.lookup('gecko:request', '/networks/solana/tokens/TokenP/pools?include=base_token,quote_token'))
            # Included token displays are never promoted into aggregate observations.
            self.assertIsNone(stream.lookup('gecko:entity', [2, 'solana', 'tokens', 'Quote', '']))
            stream.close()

    def test_partial_top_pool_or_missing_quote_only_certifies_what_was_observed(self):
        for missing in ['quote', 'pool-price']:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as folder:
                body = pools(['P'])
                token = body['included'][0]
                token['relationships'] = {'top_pools': {'data': [reference('pool', 'P')]}}
                pool = body['data'][0]
                if missing == 'pool-price':
                    pool['attributes'].pop('quote_token_price_usd')
                stream = SourceStream(folder, clock=lambda: 1000)
                seed_top_pools(stream, 'solana', {'data': [token], 'included': [pool]}, 1000000, 300)
                self.assertIsNone(stream.lookup('gecko:entity', [2, 'solana', 'pools', 'P', 'include=base_token%2Cquote_token']))
                self.assertEqual(stream.lookup('gecko:entity', [2, 'solana', 'pools', 'P', '']) is not None,
                                 missing == 'quote')
                stream.close()

    def test_full_primary_token_top_pools_can_supply_mode_but_display_metadata_cannot(self):
        for partial in [False, True]:
            with self.subTest(partial=partial), tempfile.TemporaryDirectory() as folder:
                token = resource('token', 'A', related={'top_pools': [reference('pool', 'P')]})
                if partial:
                    token['attributes'].pop('total_reserve_in_usd')
                stream = SourceStream(folder, clock=lambda: 1000)
                query = 'include=top_pools'
                stream.store('gecko:entity', [2, 'solana', 'tokens', 'A', query],
                             {'data': [token], 'included': [resource('pool', 'P')]}, 1000000, 300)
                index_entity(stream, 'solana', 'tokens', 'A', query)
                reply = lookup_entity(stream, 'solana', 'tokens', 'A', '', 300)
                self.assertEqual(reply is None, partial)
                if reply:
                    self.assertNotIn('included', reply['value'])
                stream.close()

    def test_contract_index_is_bounded_and_evicted_entity_is_a_miss(self):
        now = [1000]
        with tempfile.TemporaryDirectory() as folder:
            stream = SourceStream(folder, clock=lambda: now[0])
            body = pools(['A'])
            for number in range(MAX_CONTRACTS + 3):
                relation = 'extra' + str(number)
                body['data'][0]['relationships'][relation] = {'data': None}
                query = 'include=' + relation
                stream.store('gecko:entity', [2, 'solana', 'pools', 'A', query], body, int(now[0] * 1000), 300)
                index_entity(stream, 'solana', 'pools', 'A', query)
                now[0] += 1
            saved = stream.lookup('gecko:contracts', [1, 'solana', 'pools', 'A', ''])
            self.assertEqual(len(saved['value']), MAX_CONTRACTS)
            stream.db.execute('DELETE FROM responses WHERE key<>?',
                              (stream.key('gecko:contracts', [1, 'solana', 'pools', 'A', '']),))
            self.assertIsNone(lookup_entity(stream, 'solana', 'pools', 'A', '', 300))
            stream.close()


if __name__ == '__main__':
    unittest.main()
