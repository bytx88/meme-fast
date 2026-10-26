"""Exercise admin persistence and public projection through actual FastAPI routes."""
import copy
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from worker.meme_preset import default_config
from worker.meme_preset_preview import handle


class PresetApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import modal_app
        self.app_module = modal_app
        self.stored = None
        self.puts = []
        self.refreshes = []
        self.suggestion_pulls = []
        self.suggestion_result = {'status': 200, 'body': {'source': 'FOMO most-held', 'suggestions': []}}
        self.now = int(time.time()*1000)
        seed = default_config()
        self.report = {'version': 2, 'method': seed['method'], 'basket': [],
                       'readings': [{'at': self.now, 'method': seed['method'], 'meme': 1, 'altDelta': 2, 'btcDelta': 3}]}

        async def get(key, default=None):
            self.assertEqual(key, 'active')
            return copy.deepcopy(self.stored)

        async def put(key, value):
            self.assertEqual(key, 'active')
            self.stored = copy.deepcopy(value)
            self.puts.append(value)

        async def refresh():
            self.refreshes.append(True)

        async def ready():
            return None

        async def update(payload):
            return await modal_app.update_meme_preset.local(payload)

        async def suggest(config):
            self.suggestion_pulls.append(config)
            return copy.deepcopy(self.suggestion_result)

        original = Path.read_text

        def read(path, *args, **kwargs):
            if str(path).replace('\\', '/').startswith('/history/'):
                return json.dumps(self.report)
            return original(path, *args, **kwargs)

        for context in (
            patch.object(modal_app, 'meme_preset_registry', SimpleNamespace(
                get=SimpleNamespace(aio=get), put=SimpleNamespace(aio=put))),
            patch.object(modal_app, 'collect_meme_index', SimpleNamespace(spawn=SimpleNamespace(aio=refresh))),
            patch.object(modal_app, 'update_meme_preset', SimpleNamespace(remote=SimpleNamespace(aio=update), local=modal_app.update_meme_preset.local)),
            patch.object(modal_app, 'pull_meme_suggestions', SimpleNamespace(remote=SimpleNamespace(aio=suggest))),
            patch.object(modal_app, 'history_volume', SimpleNamespace(reload=SimpleNamespace(aio=ready))),
            patch.object(modal_app, 'stream_volume', SimpleNamespace(reload=SimpleNamespace(aio=ready))),
            patch.object(Path, 'read_text', autospec=True, side_effect=read),
        ):
            context.start()
            self.addCleanup(context.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=modal_app.web.local()), base_url='http://test')
        self.addAsyncCleanup(self.client.aclose)

    async def test_save_persists_and_masks_old_roster_until_new_collection(self):
        loaded = (await self.client.get('/api/meme-preset')).json()
        self.assertEqual(len(loaded['members']), 11)
        self.assertEqual(self.puts, [])
        payload = {'revision': loaded['revision'], 'members': loaded['members'][:-1]}
        response = await self.client.put('/api/meme-preset', json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json()
        self.assertEqual(len(saved['members']), 10)
        self.assertTrue(saved['refreshRequested'])
        self.assertEqual(len(self.refreshes), 1)
        self.assertEqual(len(self.puts), 1)
        self.assertNotIn('quote', self.stored['members'][0])
        for member in saved['members']:
            self.assertIsNone(member['quote']['priceChange1h'])
            self.assertFalse(member['quote']['eligible'])
        current = (await self.client.get('/api/meme-preset')).json()
        self.assertEqual(current['revision'], saved['revision'])
        public = (await self.client.get('/api/meme-index')).json()
        self.assertEqual(public['method'], self.stored['method'])
        self.assertEqual(len(public['basket']), 10)
        self.assertEqual(public['readings'], self.report['readings'])
        self.assertEqual(public['coverage']['includedTokens'], 0)
        self.assertTrue(all(row['weight'] == .1 for row in public['basket']))
        stale = await self.client.put('/api/meme-preset', json=payload)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['current']['revision'], saved['revision'])
        self.assertEqual(len(self.puts), 1)
        self.assertEqual(len(self.refreshes), 1)

    async def test_invalid_requests_never_write_or_dispatch(self):
        seed = default_config()
        for members in ([], seed['members']*2, [{**seed['members'][0], 'contract_address': 'ticker'}]):
            response = await self.client.put('/api/meme-preset', json={'revision': seed['revision'], 'members': members})
            self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual((await self.client.put('/api/meme-preset', content='not-json')).status_code, 400)
        self.assertEqual((await self.client.put('/api/meme-preset', content='x'*20001)).status_code, 400)
        self.assertIn((await self.client.get('/api/meme-preset/suggest')).status_code, (404, 405))
        self.assertEqual((await self.client.post('/api/meme-preset')).status_code, 405)
        self.assertIsNone(self.stored)
        self.assertEqual(self.puts, [])
        self.assertEqual(self.refreshes, [])

    async def test_only_actual_added_contract_gets_server_owned_admission(self):
        loaded = (await self.client.get('/api/meme-preset')).json()
        self.assertTrue(all(row == {'kind': 'existing', 'addedAt': None} for row in loaded['admissions'].values()))
        added = dict(network='base', contract_address='0x'+'ab'*20, symbol='NEW', name='New member')
        key = 'base:'+added['contract_address']
        response = await self.client.put('/api/meme-preset', json={
            'revision': loaded['revision'], 'members': loaded['members']+[added],
            'admissions': {key: {'kind': 'existing', 'addedAt': None}}})
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json()
        self.assertEqual(saved['admissions'][key]['kind'], 'added')
        self.assertIsInstance(saved['admissions'][key]['addedAt'], int)
        for member_key, admission in loaded['admissions'].items():
            self.assertEqual(saved['admissions'][member_key], admission)
        changed = copy.deepcopy(saved['members'])
        changed[0]['symbol'] = 'BP renamed'
        renamed = await self.client.put('/api/meme-preset', json={
            'revision': saved['revision'], 'members': changed,
            'admissions': {member_key: {'kind': 'added', 'addedAt': 0} for member_key in saved['admissions']}})
        self.assertEqual(renamed.status_code, 200, renamed.text)
        self.assertEqual(renamed.json()['admissions'], saved['admissions'])
        self.assertEqual(self.stored['admissions'], saved['admissions'])

    async def test_suggest_pulls_fomo_only_on_explicit_request_without_changing_members(self):
        row = dict(network='solana', contract_address='A'*32, symbol='NEW', name='Candidate',
                   observedAt=self.now-1000, rank=1, holders=None)
        self.suggestion_result['body']['suggestions'] = [row]
        with patch('worker.data_stream.read') as read:
            await self.client.get('/api/meme-preset')
            self.assertEqual(self.suggestion_pulls, [])
            read.assert_not_called()
            response = await self.client.post('/api/meme-preset/suggest')
            read.assert_not_called()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.json()['suggestions'][0]['contract_address'], 'A'*32)
        self.assertEqual(response.json()['source'], 'FOMO most-held')
        self.assertIsNone(response.json()['suggestions'][0]['holders'])
        self.assertEqual(len(self.suggestion_pulls), 1)
        self.assertEqual(self.puts, [])
        self.assertEqual(self.refreshes, [])

    async def test_failed_fomo_request_is_reported_without_changing_saved_config(self):
        self.suggestion_result = {'status': 503, 'body': {'detail': 'FOMO ranking is unavailable'}}
        response = await self.client.post('/api/meme-preset/suggest')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(len(self.suggestion_pulls), 1)
        self.assertEqual(self.puts, [])
        self.assertEqual(self.refreshes, [])

    async def test_saved_config_survives_failed_refresh_dispatch(self):
        async def failed():
            raise RuntimeError('dispatch unavailable')
        seed = default_config()
        with patch.object(self.app_module, 'collect_meme_index', SimpleNamespace(spawn=SimpleNamespace(aio=failed))):
            response = await self.client.put('/api/meme-preset', json={'revision': seed['revision'], 'members': seed['members'][:-1]})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['refreshRequested'])
        self.assertEqual(len(self.stored['members']), 10)

    async def test_invalid_saved_config_is_not_replaced_with_seed(self):
        self.stored = {'version': 1, 'members': []}
        response = await self.client.get('/api/meme-preset')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.stored, {'version': 1, 'members': []})
        self.assertEqual(self.puts, [])


class PreviewPresetTests(unittest.TestCase):
    def test_preview_saves_locally_and_rejects_stale_edit_without_overwriting(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'meme-preset.json'
            first = handle('GET', directory=folder)['body']
            with patch('worker.meme_suggestions.fetch_suggestions', return_value={'suggestions': []}) as suggest:
                handle('SUGGEST', directory=folder)
                suggest.assert_called_once()
            self.assertFalse(path.exists())
            saved = handle('PUT', {'revision': first['revision'], 'members': first['members'][:-1]}, folder)
            self.assertEqual(saved['status'], 200)
            persisted = path.read_text()
            current = handle('GET', directory=folder)['body']
            self.assertEqual(len(current['members']), 10)
            conflict = handle('PUT', {'revision': first['revision'], 'members': first['members'][:1]}, folder)
            self.assertEqual(conflict['status'], 409)
            self.assertEqual(path.read_text(), persisted)
            public = handle('REPORT', directory=folder)['body']
            self.assertEqual(len(public['basket']), 10)
            self.assertEqual(public['readings'], [])
            path.write_text('{broken')
            self.assertEqual(handle('GET', directory=folder)['status'], 503)
            self.assertEqual(path.read_text(), '{broken')
