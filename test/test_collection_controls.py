import asyncio
import copy
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from worker.collection_controls import enabled, mode_report, read_controls, update_control


class Store(dict):
    def put(self, key, value):
        self[key] = copy.deepcopy(value)


class CollectionControlsTests(unittest.TestCase):
    def test_defaults_validation_and_independent_persistence(self):
        store = Store()
        self.assertFalse(enabled(store, 'wallets'))
        self.assertFalse(enabled(store, 'mode'))
        for value in (None, {}, {'feature':'web','enabled':False}, {'feature':'mode','enabled':'true'},
                      {'feature':'mode','enabled':1}, {'feature':'mode','enabled':True,'extra':1}):
            with self.assertRaises(ValueError):
                update_control(store, value)
        self.assertEqual(store, {})
        update_control(store, {'feature':'wallets','enabled':True})
        update_control(store, {'feature':'mode','enabled':True})
        update_control(store, {'feature':'wallets','enabled':False})
        self.assertFalse(enabled(store, 'wallets'))
        self.assertTrue(enabled(store, 'mode'))
        self.assertTrue(read_controls(store)['features']['mode']['enabled'])

    def test_unavailable_or_malformed_settings_cannot_enable_collection(self):
        for row in (True, 1, 'on', {'enabled':1}, {'enabled':'true'}, None):
            self.assertFalse(enabled(Store(mode=row), 'mode'))
        store = MagicMock()
        store.get.side_effect = RuntimeError('unavailable')
        self.assertFalse(enabled(store, 'mode'))

    def test_paused_mode_hides_score_without_mutating_saved_history(self):
        saved = dict(score=5, ready=True, mode='Easy', history={'kept':True}, updatedAt=123)
        paused = mode_report(saved, False)
        self.assertIsNone(paused['score'])
        self.assertFalse(paused['ready'])
        self.assertIn('off', paused['reason'])
        self.assertEqual(saved['score'], 5)
        self.assertEqual(paused['history'], saved['history'])
        self.assertEqual(mode_report(saved, True)['score'], 5)


class CollectionControlsApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.addCleanup(asyncio.set_event_loop_policy, asyncio.get_event_loop_policy())
        import modal_app
        self.module = modal_app
        self.store = Store()
        self.store_patch = patch.object(modal_app, 'collection_control_store', self.store)
        self.store_patch.start()
        self.addCleanup(self.store_patch.stop)

    async def client(self):
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.module.web.local()), base_url='http://test')
        self.addAsyncCleanup(client.aclose)
        return client

    async def test_actual_routes_default_off_save_independently_and_survive_new_app(self):
        client = await self.client()
        response = await client.get('/api/collection-controls')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertTrue(all(not row['enabled'] for row in response.json()['features'].values()))
        for feature in ('mode', 'wallets'):
            response = await client.patch('/api/collection-controls', json={'feature':feature,'enabled':True})
            self.assertEqual(response.status_code, 200)
        await client.patch('/api/collection-controls', json={'feature':'wallets','enabled':False})
        other = await self.client()
        saved = (await other.get('/api/collection-controls')).json()
        self.assertTrue(saved['features']['mode']['enabled'])
        self.assertFalse(saved['features']['wallets']['enabled'])
        before = copy.deepcopy(self.store)
        for body in ('not-json', '[]', '{"feature":"mode","enabled":"yes"}', 'x'*301):
            self.assertEqual((await client.patch('/api/collection-controls', content=body)).status_code, 400)
        self.assertEqual(before, self.store)

    async def test_off_blocks_refreshes_before_registry_source_or_dispatch(self):
        client = await self.client()
        with patch.object(self.module, 'collect_smartness') as scans, \
             patch.object(self.module, 'dispatch_smart_collection') as dispatch:
            for path in ('/api/smartness/refresh','/api/smart-seeding/refresh','/api/smart-seeding/inspect'):
                response = await client.post(path, json={'token':'anything'})
                self.assertEqual(response.status_code, 409)
                self.assertIn('off', response.json()['detail'])
            scans.spawn.aio.assert_not_called()
            dispatch.assert_not_called()

    async def test_enabled_refresh_reaches_dispatch_and_store_failure_fails_closed(self):
        client = await self.client()
        self.store['wallets'] = {'enabled':True}
        with patch.object(self.module, 'dispatch_smart_collection', return_value=True) as dispatch:
            self.assertEqual((await client.post('/api/smart-seeding/refresh')).status_code, 202)
            dispatch.assert_called_once()
        unavailable = MagicMock()
        unavailable.get.side_effect = RuntimeError('unavailable')
        with patch.object(self.module, 'collection_control_store', unavailable):
            self.assertEqual((await client.get('/api/collection-controls')).status_code, 503)
            self.assertEqual((await client.post('/api/smartness/refresh')).status_code, 409)

    async def test_worker_entrypoints_exit_before_reading_or_writing_observations(self):
        with patch.object(self.module, 'smart_volume') as smart, \
             patch.object(self.module, 'smartness_volume') as ledger, \
             patch.object(self.module, 'history_volume') as history, \
             patch.object(self.module, 'stream_volume') as stream:
            for worker in (self.module.collect_data_stream, self.module.collect_smartness,
                           self.module.collect_smart_wallets):
                self.assertEqual(worker.local()['status'], 'paused')
            self.assertEqual((await self.module.collect_runner_mode.local())['status'], 'paused')
            self.assertFalse(self.module.dispatch_smart_collection())
            for volume in (smart, ledger, history, stream):
                volume.reload.assert_not_called()
                volume.commit.assert_not_called()

    async def test_wallet_pause_preserves_registry_renewal_and_skips_downstream_workers(self):
        with patch.object(self.module, 'refresh_priorities', Store()), \
             patch.object(self.module, 'retain_wallet_registry') as retention, \
             patch.object(self.module, 'collect_smartness') as scans, \
             patch.object(self.module, 'history_volume') as history:
            self.assertEqual(self.module.collect_followed_wallets.local()['status'], 'paused')
            retention.spawn.assert_called_once()
            scans.spawn.assert_not_called()
            history.reload.assert_not_called()

    async def test_paused_queued_balance_job_releases_its_own_lease(self):
        with patch.object(self.module, 'balance_requests', Store(job={'requestedAt':123})) as requests:
            result = self.module.collect_smart_wallets.local(request_key='job', request_at=123)
            self.assertEqual(result['status'], 'paused')
            self.assertNotIn('job', requests)

    async def test_coin_collection_does_not_dispatch_mode_or_reload_wallet_stream_while_off(self):
        source_context = MagicMock()
        source_context.__aenter__ = AsyncMock(return_value='loopback')
        source_context.__aexit__ = AsyncMock(return_value=False)
        run = AsyncMock(return_value={'collected':True})
        with patch.object(self.module, 'collect_runner_mode') as mode, \
             patch.object(self.module, 'stream_volume') as stream, \
             patch('worker.collector_sources.CollectorSources', return_value=source_context), \
             patch('worker.coin_job.run_coin_job', run):
            self.assertEqual(await self.module.collect_coins.local(), {'collected':True})
            mode.spawn.aio.assert_not_called()
            stream.reload.aio.assert_not_called()
            self.assertEqual(run.call_args.kwargs['candidate_tokens'], [])

    async def test_enabled_mode_worker_reaches_sampling_again(self):
        self.store['mode'] = {'enabled':True}
        run = AsyncMock(return_value={'sampled':True})
        with patch('worker.runner_sampling.run_job', run):
            self.assertEqual(await self.module.collect_runner_mode.local(), {'sampled':True})
            run.assert_awaited_once()
