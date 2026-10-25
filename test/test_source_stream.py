import tempfile
import unittest
from unittest.mock import patch
from worker.source_stream import SourceStream, SourceUnavailable, dex_tokens, dex_pools, SourceSession, gecko_path, source_metrics, mint_from_wallet_cache, gecko_response, source_json


class SourceStreamTests(unittest.TestCase):
    def test_broad_scan_backoff_does_not_block_an_exact_mint_coverage_miss(self):
        from worker.shared_holdings import PROGRAMS
        config={'encoding':'jsonParsed','commitment':'confirmed'}
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder,failure_ttl=30)
            def fail():raise ValueError('broad scan unavailable')
            with self.assertRaises(ValueError):
                stream.get('solana:getTokenAccountsByOwner',['owner',{'programId':PROGRAMS[0]},config],fail,240)
            self.assertIsNone(mint_from_wallet_cache(stream,['owner',{'mint':'mint'},config]))
            value=stream.get('solana:getTokenAccountsByOwner',['owner',{'mint':'mint'},config],lambda:{'value':[]},30)
            self.assertEqual(value['value'],{'value':[]})
            stream.close()

    def test_failed_read_backoff_survives_restart_is_scoped_and_does_not_extend_on_hits(self):
        clock,calls=[1000],[]
        def failed():
            calls.append('failed')
            raise ValueError('provider unavailable')
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder,clock=lambda:clock[0],failure_ttl=30)
            with self.assertRaises(ValueError):stream.get('rpc',['A'],failed,60)
            stream.close()
            clock[0]+=10
            stream=SourceStream(folder,clock=lambda:clock[0],failure_ttl=30)
            for seconds in (20,10):
                with self.assertRaises(SourceUnavailable) as caught:stream.get('rpc',['A'],failed,60)
                self.assertEqual(caught.exception.retry_after,seconds)
                clock[0]+=10
            self.assertEqual(calls,['failed'])
            self.assertEqual(stream.get('rpc',['B'],lambda:[],60)['value'],[])
            recovered=stream.get('rpc',['A'],lambda:['real observation'],60)
            self.assertEqual(recovered['observedAt'],1030000)
            self.assertEqual(recovered['value'],['real observation'])
            self.assertEqual(stream.metrics()['rpc:backoff']['hits'],2)
            stream.close()

    def test_overlapping_failed_batches_share_entity_backoff_without_returning_empty_data(self):
        for provider in ('dex','gecko'):
            with self.subTest(provider=provider), tempfile.TemporaryDirectory() as folder:
                clock,calls=[1000],[]
                stream=SourceStream(folder,clock=lambda:clock[0],failure_ttl=30)
                def fetch(*args):
                    calls.append(args)
                    raise ValueError('unavailable')
                def read(addresses):
                    return dex_tokens(stream,'solana',addresses,fetch) if provider=='dex' else gecko_response(
                        stream,'/networks/solana/tokens/multi/'+','.join(addresses),fetch)
                with self.assertRaises(ValueError):read(['A','B'])
                clock[0]+=10
                with self.assertRaises(SourceUnavailable):read(['B','C'])
                self.assertEqual(len(calls),1)
                clock[0]+=20
                with self.assertRaises(ValueError):read(['B','C'])
                self.assertEqual(len(calls),2)
                stream.close()

    def test_gecko_single_reads_share_evm_case_and_equivalent_include_order(self):
        address='0x'+'aB'*20
        first=gecko_path('/networks/base/tokens/'+address+'/pools?include=quote_token,base_token')
        second=gecko_path('/networks/base/tokens/'+address.lower()+'/pools?include=base_token,quote_token')
        self.assertEqual(first,second)
        self.assertNotEqual(gecko_path('/networks/solana/tokens/ABC/pools'),
                            gecko_path('/networks/solana/tokens/abc/pools'))
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder)
            a=gecko_response(stream,first,lambda _:dict(data=[]))
            b=gecko_response(stream,second,lambda _:self.fail('duplicate equivalent read'))
            self.assertEqual(a['observedAt'],b['observedAt'])
            stream.close()

    def test_denied_holder_method_backs_off_across_mints_without_blocking_other_reads(self):
        import httpx
        from worker.public_rpc import public_rpc
        clock,calls,blocked=[1000],[],{}
        def respond(request):
            import json
            method=json.loads(request.content)['method']
            calls.append(method)
            return httpx.Response(403 if method=='getTokenLargestAccounts' else 200,json={'result':{'value':[]}})
        with patch.dict('os.environ',{'SOLANA_WALLET_RPC_URL':'https://rpc.test'}), httpx.Client(transport=httpx.MockTransport(respond)) as client:
            rpc=public_rpc(client,shared=False,pause=lambda _:None,clock=lambda:clock[0],blocked=blocked)
            with self.assertRaises(ValueError):rpc('getTokenLargestAccounts',['A'])
            clock[0]+=600
            with self.assertRaises(ValueError):rpc('getTokenLargestAccounts',['B'])
            self.assertEqual(calls,['getTokenLargestAccounts'])
            self.assertEqual(rpc('getTokenSupply',['B']),{'value':[]})
            clock[0]+=3000
            with self.assertRaises(ValueError):rpc('getTokenLargestAccounts',['B'])
            self.assertEqual(calls.count('getTokenLargestAccounts'),2)

    def test_python_adapter_preserves_quote_and_full_pool_contracts(self):
        with patch.dict('os.environ',{'MEME_SHARED_SOURCES':'1'}), patch('worker.source_stream.shared_dex',return_value=[]) as shared:
            source_json(None,'https://api.dexscreener.com/token-pairs/v1/solana/A')
            shared.assert_called_with('solana',['A'],scope='pools')
            source_json(None,'https://api.dexscreener.com/tokens/v1/solana/A,B')
            shared.assert_called_with('solana',['A','B'],scope='quotes')
            with self.assertRaisesRegex(ValueError,'direct fallback disabled'):
                source_json(None,'https://api.dexscreener.com/latest/dex/tokens/A')

    def test_quote_reuse_spans_collection_phases_but_expires_without_changing_times(self):
        clock, calls = [1000], []
        def fetch(network,addresses):
            calls.append(addresses)
            return [dict(chainId=network,baseToken={'address':address}) for address in addresses]
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder,clock=lambda:clock[0])
            first=dex_tokens(stream,'solana',['A'],fetch)
            clock[0]+=240
            second=dex_tokens(stream,'solana',['A'],fetch)
            self.assertEqual(first['observedAt'],second['observedAt'])
            self.assertEqual(calls,[['A']])
            clock[0]+=60
            dex_tokens(stream,'solana',['A'],fetch)
            self.assertEqual(calls,[['A'],['A']])
            stream.close()

    def test_gecko_overlapping_batches_reuse_entities_and_keep_query_scopes_separate(self):
        clock,calls=[1000],[]
        def fetch(path):
            calls.append(path)
            addresses=path.split('?')[0].split('/')[-1].split(',')
            return {'data':[{'id':'solana_'+a,'type':'token','relationships':{'top_pools':{'data':[{'type':'pool','id':'pool'}]}}} for a in addresses],
                    'included':[{'id':'pool','type':'pool','price':clock[0]}]}
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder,clock=lambda:clock[0])
            first=gecko_response(stream,'/networks/solana/tokens/multi/A,B?include=top_pools',fetch)
            clock[0]+=10
            second=gecko_response(stream,'/networks/solana/tokens/multi/B,C?include=top_pools',fetch)
            self.assertEqual(calls,['/networks/solana/tokens/multi/A,B?include=top_pools',
                                    '/networks/solana/tokens/multi/C?include=top_pools'])
            self.assertEqual(second['observedAt'],first['observedAt'])
            self.assertEqual({row['id'] for row in second['value']['data']},{'solana_B','solana_C'})
            self.assertEqual(second['value']['included'][0]['price'],1010)
            gecko_response(stream,'/networks/solana/tokens/multi/C,B?include=top_pools',fetch)
            self.assertEqual(len(calls),2)
            gecko_response(stream,'/networks/solana/tokens/multi/B?include=other',fetch)
            self.assertEqual(len(calls),3)
            clock[0]+=60
            gecko_response(stream,'/networks/solana/tokens/multi/B,C?include=top_pools',fetch)
            self.assertEqual(len(calls),4)
            stream.close()

    def test_gecko_evm_address_case_reuses_one_observation_without_changing_solana_identity(self):
        calls=[]
        def fetch(path):
            calls.append(path)
            network=path.split('/')[2]
            address=path.split('/')[-1]
            return {'data':[{'id':network+'_'+address,'type':'token'}]}
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder)
            address='0x'+'aB'*20
            first=gecko_response(stream,'/networks/bsc/tokens/multi/'+address,fetch)
            second=gecko_response(stream,'/networks/bsc/tokens/multi/'+address.lower(),fetch)
            self.assertEqual(len(first['value']['data']),1)
            self.assertEqual(first['observedAt'],second['observedAt'])
            self.assertEqual(len(calls),1)
            gecko_response(stream,'/networks/solana/tokens/multi/ABC',fetch)
            gecko_response(stream,'/networks/solana/tokens/multi/abc',fetch)
            self.assertEqual(len(calls),3)
            stream.close()

    def test_invalid_gecko_batch_is_not_cached_and_next_valid_read_recovers(self):
        invalids=[{'data':{}},{'data':[None]},
                  {'data':[{'id':'bsc_A','type':'token'}]},
                  {'data':[{'id':'solana_A','type':'token','relationships':None}]},
                  {'data':[],'included':[{'id':'x','type':'pool','relationships':{'x':{'data':{'type':'token','id':{}}}}}]}]
        for invalid in invalids:
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as folder:
                stream=SourceStream(folder)
                with self.assertRaises(ValueError):
                    gecko_response(stream,'/networks/solana/tokens/multi/A',lambda _:invalid)
                calls=[]
                def valid(path):
                    calls.append(path)
                    return {'data':[{'id':'solana_A','type':'token'}]}
                self.assertEqual(len(gecko_response(stream,'/networks/solana/tokens/multi/A',valid)['value']['data']),1)
                self.assertEqual(len(calls),1)
                stream.close()

    def test_cached_gecko_entity_keeps_only_its_nested_relationships_and_handles_cycles(self):
        def ref(kind,identity):return {'type':kind,'id':identity}
        def entity(kind,identity,related):
            return dict(ref(kind,identity),relationships={'related':{'data':related}})
        body={'data':[entity('token','solana_A',[ref('pool','poolA')]),entity('token','solana_B',[ref('pool','poolB')])],
              'included':[entity('pool','poolA',[ref('token','quote')]),
                          entity('token','quote',[ref('pool','poolA')]),entity('pool','poolB',[])]}
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder)
            gecko_response(stream,'/networks/solana/tokens/multi/A,B',lambda _:body)
            subset=gecko_response(stream,'/networks/solana/tokens/multi/A',lambda _:self.fail('duplicate provider pull'))
            self.assertEqual({row['id'] for row in subset['value']['included']},{'poolA','quote'})
            self.assertEqual([row['id'] for row in subset['value']['data']],['solana_A'])
            stream.close()

    def test_context_is_restricted_and_collector_ui_search_encodings_share_one_key(self):
        from worker.context_source import context_target
        first,ttl=context_target('https://r.jina.ai/http://html.duckduckgo.com/html/?q=cat%20story')
        second,_=context_target('https://r.jina.ai/http://html.duckduckgo.com/html/?q=cat+story')
        self.assertEqual(first,second)
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder)
            original=stream.get('context:read',first,lambda:'story',ttl)
            reused=stream.get('context:read',second,lambda:self.fail('duplicate research'),ttl)
            self.assertEqual(original['observedAt'],reused['observedAt'])
            stream.close()
        for url in ('https://r.jina.ai/http://localhost/', 'https://evil.test/x',
                    'https://r.jina.ai/http://html.duckduckgo.com/html/?q=x&q=y'):
            with self.assertRaises(ValueError):context_target(url)

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


class GeckoAdmissionTests(unittest.TestCase):
    def test_background_reserves_two_slots_and_budget_survives_restart(self):
        from worker.source_stream import admit_gecko, SourceDeferred
        now=[1000.0]
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder,clock=lambda:now[0])
            for _ in range(6):
                admit_gecko(stream,'background');now[0]+=7.5
            with self.assertRaises(SourceDeferred) as caught:
                admit_gecko(stream,'background')
            self.assertEqual(caught.exception.retry_after,15)
            admit_gecko(stream)
            now[0]+=7.5
            stream.close()
            stream=SourceStream(folder,clock=lambda:now[0])
            admit_gecko(stream)
            with self.assertRaises(SourceDeferred):
                admit_gecko(stream,'background')
            def sleep(delay):now[0]+=delay
            admit_gecko(stream,sleep=sleep)
            self.assertEqual(now[0],1060)
            self.assertEqual(stream.db.execute('SELECT count(*) FROM gecko_requests').fetchone()[0],8)
            stream.close()

    def test_admission_deferral_does_not_poison_multi_entities_or_failures(self):
        from worker.source_stream import SourceDeferred
        path='/networks/solana/tokens/multi/A,B'
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder,failure_ttl=30)
            def defer(path):raise SourceDeferred(8)
            with self.assertRaises(SourceDeferred):gecko_response(stream,path,defer)
            self.assertEqual(stream.db.execute('SELECT count(*) FROM failed_reads').fetchone()[0],0)
            self.assertEqual(stream.metrics()['gecko:request']['failures'],0)
            self.assertEqual(stream.metrics()['gecko:request']['requests'],0)
            def fetch(path):return {'data':[{'id':'solana_'+a,'type':'token'} for a in path.split('/')[-1].split(',')]}
            self.assertEqual(gecko_response(stream,path,fetch)['cache'],'miss')
            self.assertEqual(gecko_response(stream,path,defer)['cache'],'hit')
            stream.close()

    def test_ttl_matches_data_change_rate(self):
        from worker.source_stream import gecko_ttl
        self.assertEqual(gecko_ttl('/networks/solana/pools/A/trades'),60)
        self.assertEqual(gecko_ttl('/networks/solana/tokens/A/info'),900)
        self.assertEqual(gecko_ttl('/networks/solana/trending_pools?duration=1h'),600)
        self.assertEqual(gecko_ttl('/networks/solana/new_pools?page=2'),900)
        self.assertEqual(gecko_ttl('/networks/solana/tokens/multi/A'),300)


class GeckoRetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_mode_retries_admission_but_not_provider_failure(self):
        from worker.source_stream import background_gecko
        waits=[]
        replies=iter([{'status':503,'deferred':True,'retryAfter':8},{'status':200,'body':{'data':[]}}])
        async def fetch():return next(replies)
        async def sleep(delay):waits.append(delay)
        self.assertEqual((await background_gecko(fetch,sleep))['status'],200)
        self.assertEqual(waits,[8])
        async def limited():return {'status':429,'retryAfter':60}
        self.assertEqual((await background_gecko(limited,sleep))['status'],429)
        self.assertEqual(waits,[8])


class GeckoPoolReuseTests(unittest.TestCase):
    @staticmethod
    def body(addresses, network='solana'):
        data=[];included=[]
        for address in addresses:
            token=network+'_Token'+address
            data.append(dict(id=network+'_'+address,type='pool',attributes=dict(address=address,
                base_token_price_usd='1',quote_token_price_usd='100',reserve_in_usd='10000',
                volume_usd={'h1':'5000'},transactions={'h1':{'buys':10,'sells':5}},price_change_percentage={'h1':'2'}),
                relationships={'base_token':{'data':{'id':token,'type':'token'}},
                               'quote_token':{'data':{'id':network+'_Quote','type':'token'}}}))
            included.append(dict(id=token,type='token',attributes={'address':'Token'+address}))
        included.append(dict(id=network+'_Quote',type='token',attributes={'address':'Quote'}))
        return dict(data=data,included=included,links={'next':'discovery-page-two'})

    def test_discovery_supplies_overlapping_pool_batch_but_not_unrelated_includes(self):
        now=[1000];calls=[]
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder,clock=lambda:now[0])
            gecko_response(stream,'/networks/solana/trending_pools?duration=1h&include=quote_token,base_token',
                           lambda _:self.body(['A','B']),600)
            now[0]+=10
            def fetch(path):
                calls.append(path)
                return self.body(['C'])
            response=gecko_response(stream,'/networks/solana/pools/multi/B,C?include=base_token,quote_token',fetch,300)
            self.assertEqual(calls,['/networks/solana/pools/multi/C?include=base_token%2Cquote_token'])
            self.assertEqual(response['observedAt'],1000000)
            self.assertEqual({r['id'] for r in response['value']['data']},{'solana_B','solana_C'})
            self.assertNotIn('solana_TokenA',{r['id'] for r in response['value']['included']})
            cached=gecko_response(stream,'/networks/solana/pools/multi/B?include=quote_token,base_token',
                                  lambda _:self.fail('duplicate pool pull'),300)
            self.assertEqual(cached['cache'],'hit')
            self.assertNotIn('links',cached['value'])
            stream.close()

    def test_token_multi_aggregate_attributes_supply_mode_without_pool_metadata_request(self):
        now=[1000]
        token={'id':'solana_A','type':'token','attributes':{'address':'A','name':'Actual token',
               'total_reserve_in_usd':'100','volume_usd':{'h24':'0'}},
               'relationships':{'top_pools':{'data':[{'id':'solana_P','type':'pool'}]}}}
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder,clock=lambda:now[0])
            rich={'data':[token],'included':[{'id':'solana_P','type':'pool'}]}
            path='/networks/solana/tokens/multi/A?include=top_pools'
            gecko_response(stream,path,lambda _:rich,300)
            now[0]+=10
            mode=gecko_response(stream,'/networks/solana/tokens/multi/A',lambda _:self.fail('duplicate aggregate pull'),300)
            self.assertEqual(mode['value']['data'],[token])
            self.assertNotIn('included',mode['value'])
            self.assertEqual(mode['observedAt'],1000000)
            now[0]=1301
            calls=[]
            def fetch(path):calls.append(path);return {'data':[token]}
            gecko_response(stream,'/networks/solana/tokens/multi/A',fetch,300)
            self.assertEqual(len(calls),1)
            stream.close()

    def test_partial_token_metadata_does_not_certify_aggregate_activity(self):
        for attrs in ({'address':'A'}, {'address':'A','volume_usd':{'h24':'0'}},
                      {'address':'wrong','total_reserve_in_usd':'1','volume_usd':{'h24':'0'}}):
            with tempfile.TemporaryDirectory() as folder:
                stream=SourceStream(folder)
                body={'data':[{'id':'solana_A','type':'token','attributes':attrs}]}
                gecko_response(stream,'/networks/solana/tokens/multi/A?include=top_pools',lambda _:body,300)
                calls=[]
                def fetch(path):calls.append(path);return body
                gecko_response(stream,'/networks/solana/tokens/multi/A',fetch,300)
                self.assertEqual(len(calls),1)
                stream.close()

    def test_cached_discovery_replay_does_not_extend_five_minute_pool_observation(self):
        now=[1000]
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder,clock=lambda:now[0])
            path='/networks/solana/new_pools?page=1&include=base_token,quote_token'
            gecko_response(stream,path,lambda _:self.body(['A']),600)
            now[0]=1299
            gecko_response(stream,path,lambda _:self.fail('discovery still cached'),600)
            now[0]=1301;calls=[]
            def fetch(path):calls.append(path);return self.body(['A'])
            renewed=gecko_response(stream,'/networks/solana/pools/multi/A?include=base_token,quote_token',fetch,300)
            self.assertEqual(len(calls),1)
            self.assertEqual(renewed['observedAt'],1301000)
            stream.close()

    def test_projection_keeps_query_contracts_and_complete_pool_lists_separate(self):
        with tempfile.TemporaryDirectory() as folder:
            stream=SourceStream(folder)
            gecko_response(stream,'/networks/solana/tokens/TokenA/pools?include=base_token,quote_token',
                           lambda _:self.body(['A']),300)
            calls=[]
            def fetch(path):calls.append(path);return self.body(['A'])
            gecko_response(stream,'/networks/solana/pools/multi/A?include=dex',fetch,300)
            gecko_response(stream,'/networks/solana/tokens/TokenB/pools?include=base_token,quote_token',fetch,300)
            self.assertEqual(len(calls),2)
            # Included token identities do not certify token-aggregate activity.
            def token_fetch(path):calls.append(path);return {'data':[{'id':'solana_TokenA','type':'token'}]}
            gecko_response(stream,'/networks/solana/tokens/multi/TokenA',token_fetch,300)
            self.assertEqual(len(calls),3)
            stream.close()

    def test_incomplete_or_malformed_discovery_does_not_certify_pool_batch(self):
        import copy
        good=self.body(['A'])
        invalids=[]
        for mutate in (lambda b:b['data'][0]['attributes'].pop('quote_token_price_usd'),
                       lambda b:b.update(included=[]),
                       lambda b:b['data'][0]['attributes'].update(address='wrong'),
                       lambda b:b['data'][0].update(relationships={'base_token':{'data':True}})):
            body=copy.deepcopy(good);mutate(body);invalids.append(body)
        for invalid in invalids:
            with self.subTest(body=invalid),tempfile.TemporaryDirectory() as folder:
                stream=SourceStream(folder)
                gecko_response(stream,'/networks/solana/new_pools?include=base_token,quote_token',lambda _:invalid,600)
                calls=[]
                def fetch(path):calls.append(path);return good
                gecko_response(stream,'/networks/solana/pools/multi/A?include=base_token,quote_token',fetch,300)
                self.assertEqual(len(calls),1)
                stream.close()

    def test_discovery_and_batch_share_evm_identity_without_lowercasing_solana(self):
        for network,address,requested in [('base','0xAaBb','0xaabb'),('solana','ABC','abc')]:
            with tempfile.TemporaryDirectory() as folder:
                stream=SourceStream(folder)
                gecko_response(stream,f'/networks/{network}/pools?include=base_token,quote_token',lambda _:self.body([address],network),600)
                calls=[]
                def fetch(path):calls.append(path);return self.body([requested],network)
                gecko_response(stream,f'/networks/{network}/pools/multi/{requested}?include=base_token,quote_token',fetch,300)
                self.assertEqual(len(calls),0 if network=='base' else 1)
                stream.close()
