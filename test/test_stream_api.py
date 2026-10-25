"""Exercise actual FastAPI routes with provider/storage boundaries substituted."""
import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from worker.data_stream import project


async def ready(*args, **kwargs):
    return None


class StreamApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.addCleanup(asyncio.set_event_loop_policy, asyncio.get_event_loop_policy())

    async def test_runner_mode_returns_unknown_before_collection_and_when_stale(self):
        import json
        import modal_app
        from worker.runner_mode import unknown
        volume = SimpleNamespace(reload=SimpleNamespace(aio=ready))
        with patch.object(modal_app, 'history_volume', volume):
            app = modal_app.web.local()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                with patch.object(Path, 'read_text', side_effect=FileNotFoundError):
                    response = await client.get('/api/runner-mode')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['cache-control'], 'no-store')
                self.assertEqual(response.json()['mode'], 'Unknown')
                self.assertIsNone(response.json()['counts24h']['500000'])
                stale = {**unknown(), 'mode': 'Easy', 'ready': True, 'updatedAt': 1000}
                with patch.object(Path, 'read_text', return_value=json.dumps(stale)):
                    response = await client.get('/api/runner-mode')
                self.assertEqual(response.json()['mode'], 'Unknown')
                self.assertFalse(response.json()['ready'])

    async def test_common_stream_routes_and_dex_use_saved_or_shared_data(self):
        import modal_app
        report = project({}, {}, {}, {}, 1800000000000)
        provider_calls = []
        async def market(network, addresses, scope='quotes'):
            self.assertEqual(scope,'profiles' if network=='profiles' else 'pools')
            provider_calls.append((network, addresses))
            return dict(value=[], observedAt=1234)
        context_calls=[]
        async def context(url):
            context_calls.append(url)
            return dict(value='saved research',observedAt=4567)
        volume = SimpleNamespace(reload=SimpleNamespace(aio=ready))
        with patch.object(modal_app, 'stream_volume', volume), patch.object(modal_app, 'source_volume', volume), \
             patch.object(modal_app, 'read_market_source', SimpleNamespace(remote=SimpleNamespace(aio=market))), \
             patch.object(modal_app, 'read_context_source', SimpleNamespace(remote=SimpleNamespace(aio=context))), \
             patch('worker.data_stream.read', return_value=report):
            app = modal_app.web.local()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                for window in ('5m','1h','6h','24h'):
                    response = await client.get('/api/data-stream', params={'window':window})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()['window'], window)
                    self.assertNotIn('history', response.json())
                self.assertEqual((await client.get('/api/data-stream?window=7d')).status_code, 400)
                candidates = await client.get('/api/wallet-candidates')
                self.assertEqual(candidates.status_code, 200)
                self.assertEqual(candidates.json()['source'], 'Shared 1h token stream')
                mint = 'So11111111111111111111111111111111111111112'
                response = await client.get('/api/dex/token-pairs/v1/solana/' + mint)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['x-data-observed-at'], '1234')
                self.assertEqual(provider_calls, [('solana', [mint])])
                self.assertEqual((await client.get('/api/dex/token-profiles/latest/v1')).status_code,200)
                self.assertEqual(provider_calls[-1],('profiles',[]))
                target='https://r.jina.ai/https://meme.com/memes/jean-phil'
                a=await client.get('/api/context/source/jeanphil-origin')
                b=await client.get('/api/context/read',params={'url':target})
                self.assertEqual(a.text,b.text)
                self.assertEqual(a.headers['x-data-observed-at'],'4567')
                self.assertEqual(context_calls,[target,target])
                self.assertEqual((await client.get('/api/context/read',params={'url':'http://localhost'})).status_code,400)
                self.assertEqual(len(context_calls),2)
                self.assertEqual((await client.get('/api/dex/arbitrary')).status_code, 404)


    async def test_gecko_roles_admission_headers_and_market_method_projection(self):
        import json
        import modal_app
        calls=[]
        async def gecko(path, workload='interactive'):
            calls.append((path,workload))
            return ({'status':503,'body':{'error':'deferred'},'deferred':True,'retryAfter':8}
                    if workload=='background' else {'status':200,'body':{'data':[],'_sourceObservedAt':1234}})
        volume=SimpleNamespace(reload=SimpleNamespace(aio=ready))
        with patch.object(modal_app,'history_volume',volume), \
             patch.object(modal_app,'read_gecko_source',SimpleNamespace(remote=SimpleNamespace(aio=gecko))):
            app=modal_app.web.local()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                path='/networks/solana/pools/So11111111111111111111111111111111111111112/trades'
                deferred=await client.get('/api/gecko'+path)
                self.assertEqual(deferred.status_code,503)
                self.assertEqual(deferred.headers['x-source-deferred'],'1')
                self.assertEqual(deferred.headers['retry-after'],'8')
                self.assertEqual((await client.get('/api/market'+path)).status_code,200)
                self.assertEqual(calls,[(path,'background'),(path,'interactive')])
                stored={'version':2,'method':'shared-trending-1h-v1','basket':[],'readings':[],
                        'marketObservedAt':1234,'legacyMethods':{'private':'original'},
                        'basketHistory':[{'private':'retained'}]}
                def public_only(path,**kwargs):
                    self.assertEqual(str(path).replace('\\','/'),'/history/meme-index.public.json')
                    return json.dumps(stored)
                with patch.object(Path,'read_text',autospec=True,side_effect=public_only) as reader:
                    response=await client.get('/api/meme-index')
                self.assertEqual(reader.call_count,1)
                self.assertEqual(response.json()['method'],stored['method'])
                self.assertEqual(response.json()['marketObservedAt'],1234)
                self.assertNotIn('legacyMethods',response.json())
                self.assertNotIn('basketHistory',response.json())
                def fallback(path,**kwargs):
                    if str(path).endswith('.public.json'):raise FileNotFoundError()
                    return json.dumps(stored)
                with patch.object(Path,'read_text',autospec=True,side_effect=fallback) as reader:
                    response=await client.get('/api/meme-index')
                self.assertEqual(reader.call_count,2)
                self.assertEqual(response.json()['method'],stored['method'])
                self.assertNotIn('basketHistory',response.json())
