"""Exercise the collector transport over a real loopback HTTP connection."""
import asyncio
import json
import os
from pathlib import Path
import shutil
import time
import unittest
from urllib.parse import urlsplit

import httpx

from worker.collector_sources import CollectorSources
from worker.publisher_feed import SOURCES as PUBLISHERS


MINT = 'So11111111111111111111111111111111111111112'
STORY = 'https://r.jina.ai/https://meme.com/memes/jean-phil'


class CollectorSourcesTests(unittest.IsolatedAsyncioTestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for the deployed collector transport')
    async def test_unchanged_node_provider_fetch_uses_loopback_and_retries_admission(self):
        calls = []
        async def market(network, addresses, scope):
            calls.append(('market', network, addresses, scope))
            return {'value': [], 'observedAt': 1234}
        async def gecko(path, workload):
            calls.append(('gecko', path, workload))
            if sum(row[0] == 'gecko' for row in calls) == 1:
                return {'status': 503, 'body': {'error': 'deferred'}, 'deferred': True, 'retryAfter': 1}
            return {'status': 200, 'body': {'data': [], '_sourceObservedAt': 5678}}
        async def context(target):
            calls.append(('context', target))
            return {'value': 'Saved research', 'observedAt': 9012}
        async def social(target):
            calls.append(('social', target))
            publisher = next(key for key, url in PUBLISHERS.items() if url == target)
            host = 'decrypt.co' if publisher == 'decrypt' else 'cointelegraph.com'
            return {'value': {'status': 'ok', 'items': [{'title': publisher + ' story',
                'pubDate': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'link': 'https://' + host + '/article', 'description': 'Observed publisher story'}]}, 'observedAt': 3456}
        module = Path('worker/provider-fetch.mjs').resolve().as_uri()
        news_module = Path('dist/public-radar.mjs').resolve().as_uri()
        script = '''
            const {createProviderFetch} = await import(process.argv[1]);
            const source = createProviderFetch(fetch, {budgetMs: 10000});
            const dex = await source('https://api.dexscreener.com/tokens/v1/solana/' + process.argv[2]);
            const gecko = await source('https://api.geckoterminal.com/api/v2/networks/solana/new_pools');
            const context = await source(process.argv[3]);
            const {FEEDS, fetchPublicSource} = await import(process.argv[4]);
            const news = await Promise.all(FEEDS.map(feed => fetchPublicSource(feed, source)));
            console.log(JSON.stringify({dex: await dex.json(), observed: dex.headers.get('x-data-observed-at'),
                gecko: await gecko.json(), context: await context.text(), news: news.map(items => items.map(item => item.feed))}));
        '''
        async with CollectorSources(market, gecko, context, social) as base:
            process = await asyncio.create_subprocess_exec('node', '--input-type=module', '-e', script,
                module, MINT, STORY, news_module, env={**os.environ, 'MEME_SHARED_MARKET_URL': base},
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            try:
                output, error = await asyncio.wait_for(process.communicate(), 15)
            finally:
                if process.returncode is None:
                    process.kill()
                    await process.wait()
            self.assertEqual(process.returncode, 0, error.decode())
            self.assertEqual(json.loads(output), {'dex': [], 'observed': '1234',
                'gecko': {'data': [], '_sourceObservedAt': 5678}, 'context': 'Saved research',
                'news': [['decrypt'], ['cointelegraph']]})
        self.assertEqual(calls[:4], [('market', 'solana', [MINT], 'quotes'),
            ('gecko', '/networks/solana/new_pools', 'background'),
            ('gecko', '/networks/solana/new_pools', 'background'), ('context', STORY)])
        self.assertCountEqual(calls[4:], [('social', PUBLISHERS['decrypt']), ('social', PUBLISHERS['cointelegraph'])])

    async def test_routes_keep_shared_source_scopes_observation_times_and_context(self):
        calls = []
        async def market(network, addresses, scope):
            calls.append(('market', network, addresses, scope))
            return {'value': [{'chainId': network, 'baseToken': {'address': MINT}}], 'observedAt': 1234}
        async def gecko(path, workload):
            calls.append(('gecko', path, workload))
            return {'status': 200, 'body': {'data': [], '_sourceObservedAt': 5678}}
        async def context(target):
            calls.append(('context', target))
            return {'value': 'Saved café research', 'observedAt': 9012}
        async def social(target):
            calls.append(('social', target))
            return {'value': {'status': 'ok', 'items': []}, 'observedAt': 3456}
        bridge = CollectorSources(market, gecko, context, social)
        async with bridge as base:
            self.assertEqual(urlsplit(base).hostname, '127.0.0.1')
            async with httpx.AsyncClient(trust_env=False) as client:
                quotes = await client.get(base + '/tokens/v1/solana/' + MINT)
                self.assertEqual(quotes.status_code, 200)
                self.assertEqual(quotes.headers['x-data-observed-at'], '1234')
                self.assertEqual(quotes.json()[0]['baseToken']['address'], MINT)
                self.assertEqual(quotes.headers['cache-control'], 'no-store')
                self.assertEqual((await client.get(base + '/token-pairs/v1/solana/' + MINT)).status_code, 200)
                self.assertEqual((await client.get(base + '/latest/dex/search', params={'q': ' café '})).status_code, 200)
                self.assertEqual((await client.get(base + '/token-profiles/latest/v1')).status_code, 200)
                route = base.replace('/dex', '/gecko') + '/networks/solana/tokens/multi/' + MINT
                observed = await client.get(route, params={'include': 'quote_token,base_token'})
                self.assertEqual(observed.json(), {'data': [], '_sourceObservedAt': 5678})
                story = await client.get(base.replace('/dex', '/context/read'), params={'url': STORY})
                self.assertEqual(story.status_code, 200)
                self.assertEqual(story.text, 'Saved café research')
                self.assertEqual(story.headers['x-data-observed-at'], '9012')
                self.assertEqual(story.headers['x-content-type-options'], 'nosniff')
                for publisher in PUBLISHERS:
                    empty = await client.get(base.replace('/dex', '/publisher') + '/' + publisher)
                    self.assertEqual(empty.status_code, 200)
                    self.assertEqual(empty.json(), {'status': 'ok', 'items': []})
                    self.assertEqual(empty.headers['x-data-observed-at'], '3456')
        self.assertEqual(calls, [
            ('market', 'solana', [MINT], 'quotes'), ('market', 'solana', [MINT], 'pools'),
            ('market', 'search', ['café'], 'quotes'), ('market', 'profiles', [], 'profiles'),
            ('gecko', '/networks/solana/tokens/multi/' + MINT + '?include=base_token%2Cquote_token', 'background'),
            ('context', STORY), ('social', PUBLISHERS['decrypt']), ('social', PUBLISHERS['cointelegraph'])])
        self.assertFalse(bridge.server.is_serving())
        self.assertFalse(bridge.writers)

    async def test_admission_and_provider_failures_preserve_retry_contract(self):
        async def failed(*args, **kwargs):
            raise RuntimeError('Private provider error')
        replies = [
            {'status': 503, 'body': {'error': 'deferred'}, 'deferred': True, 'retryAfter': 8},
            {'status': 429, 'body': {'error': 'limited'}, 'retryAfter': 60}]
        async def gecko(*args, **kwargs):
            if replies:
                return replies.pop(0)
            raise RuntimeError('Private provider error')
        async with CollectorSources(failed, gecko, failed, failed) as base:
            async with httpx.AsyncClient(trust_env=False) as client:
                path = base.replace('/dex', '/gecko') + '/networks/solana/new_pools'
                deferred = await client.get(path)
                self.assertEqual(deferred.status_code, 503)
                self.assertEqual(deferred.headers['x-source-deferred'], '1')
                self.assertEqual(deferred.headers['retry-after'], '8')
                self.assertEqual(deferred.json(), {'error': 'deferred'})
                limited = await client.get(path)
                self.assertEqual(limited.status_code, 429)
                self.assertEqual(limited.headers['retry-after'], '60')
                self.assertNotIn('x-source-deferred', limited.headers)
                self.assertEqual((await client.get(path)).status_code, 500)
                unavailable = await client.get(base + '/tokens/v1/solana/' + MINT)
                self.assertEqual(unavailable.status_code, 503)
                story = await client.get(base.replace('/dex', '/context/read'), params={'url': STORY})
                self.assertEqual(story.status_code, 502)
                self.assertNotIn('Private', story.text + unavailable.text)
                publisher = await client.get(base.replace('/dex', '/publisher') + '/decrypt')
                self.assertEqual(publisher.status_code, 503)
                self.assertNotIn('Private', publisher.text)

    async def test_rejects_unsupported_targets_queries_methods_and_request_bodies(self):
        calls = []
        async def forbidden(*args, **kwargs):
            calls.append((args, kwargs))
            self.fail('Invalid request must not invoke a shared source')
        async with CollectorSources(forbidden, forbidden, forbidden, forbidden) as base:
            async with httpx.AsyncClient(trust_env=False) as client:
                for path, status in [
                    ('/api/dex/arbitrary', 404), ('/api/dex/latest/dex/search?q=', 400),
                    ('/api/dex/latest/dex/search?q=a&q=b', 400),
                    ('/api/dex/token-profiles/latest/v1?extra=1', 404),
                    ('/api/gecko/unsupported', 404), ('/api/gecko/networks/solana/new_pools?unknown=1', 404),
                    ('/api/context/read?url=http%3A%2F%2Flocalhost', 400), ('/arbitrary', 404),
                    ('/api/publisher/', 404), ('/api/publisher/unknown', 404),
                    ('/api/publisher/decrypt?error=', 404), ('/api/publisher/cointelegraph?url=x', 404)]:
                    response = await client.get(base.removesuffix('/api/dex') + path)
                    self.assertEqual(response.status_code, status, path)
                self.assertEqual((await client.post(base + '/token-profiles/latest/v1')).status_code, 405)
            empty_query = await self.raw(base, b'GET /api/publisher/decrypt? HTTP/1.1\r\n\r\n')
            self.assertTrue(empty_query.startswith(b'HTTP/1.1 404 '))
            for request in [
                b'GET http://example.com/api/dex/token-profiles/latest/v1 HTTP/1.1\r\n\r\n',
                b'GET http://[invalid HTTP/1.1\r\n\r\n',
                b'GET /api/dex/token-profiles/latest/v1 HTTP/1.1\r\ncontent-length: 1\r\n\r\nx',
                b'GET /api/dex/token-profiles/latest/v1 HTTP/1.1\r\ntransfer-encoding: chunked\r\n\r\n',
                b'GET / HTTP/9.9\r\n\r\n',
                b'GET / HTTP/1.1\r\ninvalid-header\r\n\r\n',
                b'GET / HTTP/1.1\r\nx-large: ' + b'a' * 17000 + b'\r\n\r\n']:
                reply = await self.raw(base, request)
                self.assertTrue(reply.startswith(b'HTTP/1.1 400 '), reply[:100])
        self.assertFalse(calls)

    async def raw(self, base, request):
        target = urlsplit(base)
        reader, writer = await asyncio.open_connection(target.hostname, target.port)
        try:
            writer.write(request)
            await writer.drain()
            return await asyncio.wait_for(reader.read(), 2)
        finally:
            writer.close()
            await writer.wait_closed()

    async def test_bounds_header_and_source_waits_and_closes_listener(self):
        cancelled = asyncio.Event()
        async def stalled(*args, **kwargs):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        bridge = CollectorSources(stalled, stalled, stalled, stalled, header_timeout=.05, request_timeout=.05)
        async with bridge as base:
            slow_header = await self.raw(base, b'GET / HTTP/1.1\r\n')
            self.assertTrue(slow_header.startswith(b'HTTP/1.1 408 '))
            async with httpx.AsyncClient(trust_env=False) as client:
                timed_out = await client.get(base + '/token-profiles/latest/v1')
                self.assertEqual(timed_out.status_code, 504)
            await asyncio.wait_for(cancelled.wait(), 1)
        target = urlsplit(base)
        with self.assertRaises(OSError):
            await asyncio.open_connection(target.hostname, target.port)
        self.assertFalse(bridge.tasks)

    async def test_client_disconnect_and_job_exit_cancel_outstanding_source_calls(self):
        entered, cancelled = asyncio.Event(), asyncio.Event()
        async def stalled(*args, **kwargs):
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        for disconnect in (True, False):
            with self.subTest(disconnect=disconnect):
                entered.clear()
                cancelled.clear()
                bridge = CollectorSources(stalled, stalled, stalled, stalled)
                async with bridge as base:
                    target = urlsplit(base)
                    reader, writer = await asyncio.open_connection(target.hostname, target.port)
                    writer.write(b'GET /api/dex/token-profiles/latest/v1 HTTP/1.1\r\n\r\n')
                    await writer.drain()
                    await asyncio.wait_for(entered.wait(), 1)
                    if disconnect:
                        writer.close()
                        await writer.wait_closed()
                        await asyncio.wait_for(cancelled.wait(), 1)
                await asyncio.wait_for(cancelled.wait(), 1)
                self.assertFalse(bridge.tasks)
                self.assertFalse(bridge.writers)
                writer.close()
                await writer.wait_closed()


if __name__ == '__main__':
    unittest.main()
