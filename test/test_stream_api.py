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
    async def test_common_stream_routes_and_dex_use_saved_or_shared_data(self):
        policy = asyncio.get_event_loop_policy()
        import modal_app
        self.addCleanup(asyncio.set_event_loop_policy, policy)
        report = project({}, {}, {}, {}, 1800000000000)
        provider_calls = []
        async def market(network, addresses, scope='quotes'):
            self.assertEqual(scope,'pools')
            provider_calls.append((network, addresses))
            return dict(value=[], observedAt=1234)
        volume = SimpleNamespace(reload=SimpleNamespace(aio=ready))
        with patch.object(modal_app, 'stream_volume', volume), patch.object(modal_app, 'source_volume', volume), \
             patch.object(modal_app, 'read_market_source', SimpleNamespace(remote=SimpleNamespace(aio=market))), \
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
                self.assertEqual((await client.get('/api/dex/arbitrary')).status_code, 404)
