import asyncio
import copy
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from worker.collection_controls import enabled, mode_report, read_controls, update_control, DEFAULTS


class Store(dict):
    def put(self, key, value):
        self[key] = copy.deepcopy(value)


class CollectionControlsTests(unittest.TestCase):
    def test_defaults_validation_and_independent_persistence(self):
        store = Store()
        self.assertFalse(enabled(store, 'wallets'))
        self.assertFalse(enabled(store, 'mode'))
        self.assertFalse(enabled(store, 'meme'))
        for feature in ('robinhood','context','x_rss','markets','macro'):
            self.assertTrue(enabled(store, feature))
            update_control(store, {'feature':feature,'enabled':False})
            self.assertFalse(enabled(store, feature))
        store.clear()
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


class CoreEngineTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.addCleanup(asyncio.set_event_loop_policy, asyncio.get_event_loop_policy())

    async def test_market_pause_keeps_mode_dispatch_but_skips_sources_and_volume(self):
        import modal_app
        mode = SimpleNamespace(spawn=SimpleNamespace(aio=AsyncMock()))
        volume = SimpleNamespace(reload=SimpleNamespace(aio=AsyncMock()))
        with patch.object(modal_app, 'collection_control_store', Store(markets={'enabled':False}, mode={'enabled':True})), \
             patch.object(modal_app, 'collect_runner_mode', mode), \
             patch.object(modal_app, 'stream_volume', volume), \
             patch('worker.coin_job.run_coin_job', new_callable=AsyncMock) as job:
            result = await modal_app.collect_coins.local()
        self.assertEqual(result['status'], 'paused')
        mode.spawn.aio.assert_awaited_once()
        volume.reload.aio.assert_not_awaited()
        job.assert_not_awaited()

    async def test_macro_background_pause_skips_sources_and_volume(self):
        import modal_app
        volume = SimpleNamespace(reload=SimpleNamespace(aio=AsyncMock()))
        with patch.object(modal_app, 'collection_control_store', Store(macro={'enabled':False})), \
             patch.object(modal_app, 'macro_volume', volume):
            result = await modal_app.collect_macro_review.local(background=True)
        self.assertEqual(result['status'], 'paused')
        volume.reload.aio.assert_not_awaited()

    async def test_macro_on_demand_still_refreshes_when_background_is_paused(self):
        import modal_app
        volume = SimpleNamespace(reload=SimpleNamespace(aio=AsyncMock()), commit=SimpleNamespace(aio=AsyncMock()))
        review = SimpleNamespace(get=AsyncMock(return_value={'updatedAt':123}))
        with patch.object(modal_app, 'collection_control_store', Store(macro={'enabled':False})), \
             patch.object(modal_app, 'macro_volume', volume), \
             patch('worker.macro_review.MacroReview', return_value=review), \
             patch('worker.macro_review.public_report', side_effect=lambda value:value):
            result = await modal_app.collect_macro_review.local()
        self.assertEqual(result, {'updatedAt':123})
        review.get.assert_awaited_once()
        volume.commit.aio.assert_awaited_once()

    async def test_macro_dispatch_is_independent_of_social_and_honors_its_own_switch(self):
        import modal_app
        dispatch = MagicMock()
        for is_enabled in (False, True):
            dispatch.reset_mock()
            with patch.object(modal_app, 'collection_control_store', Store(macro={'enabled':is_enabled}, x_rss={'enabled':False})), \
                 patch.object(modal_app, 'collect_macro_review', SimpleNamespace(spawn=dispatch)):
                result = modal_app.collect_x_factor.local()
            self.assertEqual(result['status'], 'paused')
            if is_enabled:
                dispatch.assert_called_once_with(background=True)
            else:
                dispatch.assert_not_called()


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
        self.assertEqual({k:v['enabled'] for k,v in response.json()['features'].items()}, DEFAULTS)
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

    async def test_x_rss_pause_preserves_macro_refresh_and_skips_sources_and_volume(self):
        self.store['x_rss'] = {'enabled':False}
        with patch.object(self.module, 'collect_macro_review') as macro, \
             patch.object(self.module, 'history_volume') as history, \
             patch('subprocess.run') as run:
            self.assertEqual(self.module.collect_x_factor.local()['status'], 'paused')
            macro.spawn.assert_called_once()
            history.reload.assert_not_called()
            run.assert_not_called()

    async def test_coin_dispatch_forwards_the_two_new_collector_switches(self):
        self.store.update(robinhood={'enabled':False},context={'enabled':False})
        source_context = MagicMock()
        source_context.__aenter__ = AsyncMock(return_value='loopback')
        source_context.__aexit__ = AsyncMock(return_value=False)
        run = AsyncMock(return_value={})
        with patch('worker.collector_sources.CollectorSources', return_value=source_context), \
             patch('worker.coin_job.run_coin_job', run):
            await self.module.collect_coins.local()
            self.assertFalse(run.call_args.kwargs['robinhood_enabled'])
            self.assertFalse(run.call_args.kwargs['context_enabled'])

    async def test_meme_off_skips_basket_and_history_recovery_but_collects_benchmarks(self):
        with patch.object(self.module,'history_volume') as volume, \
             patch.object(self.module,'meme_preset_registry') as preset, \
             patch('worker.meme_index.collect') as basket, \
             patch('worker.market_benchmarks.collect',return_value={'updatedAt':123}) as benchmarks:
            result = self.module.collect_meme_index.local()
            self.assertEqual(result['status'],'paused')
            self.assertEqual(result['benchmarkUpdatedAt'],123)
            basket.assert_not_called()
            preset.get.assert_not_called()
            benchmarks.assert_called_once_with('/history/market-benchmarks.json')
            volume.commit.assert_called_once()
