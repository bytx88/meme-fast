"""A warm API worker must reload before trusting a precomputed projection."""
import asyncio
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import httpx


class SnapshotApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.addCleanup(asyncio.set_event_loop_policy, asyncio.get_event_loop_policy())

    async def test_each_projected_view_reloads_without_parsing_the_large_snapshot(self):
        import modal_app
        names = {'coin': 'coins.snipe.v2.120.json', 'health': 'coins.health.json',
                 'catalog': 'coins.catalog.v2.json', 'tweet': 'coins.tweet.json'}
        for view, name in names.items():
            with self.subTest(view=view), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                reloads = []

                def mounted_path(value, *parts):
                    text = str(value).replace('\\', '/')
                    return root.joinpath(text.removeprefix('/history/'), *parts) if text.startswith('/history/') else Path(value, *parts)

                async def reload():
                    revision = len(reloads) + 1
                    reloads.append(revision)
                    # A valid projection must avoid parsing the large main file.
                    main, projection = root / 'coins.json', root / name
                    main.write_text('large main snapshot is not needed', encoding='utf-8')
                    projection.write_text(json.dumps({'revision': revision}), encoding='utf-8')
                    os.utime(main, ns=(1_000_000, 1_000_000))
                    os.utime(projection, ns=(2_000_000, 2_000_000))

                volume = SimpleNamespace(reload=SimpleNamespace(aio=reload))
                with patch.object(modal_app, 'Path', mounted_path), patch.object(modal_app, 'history_volume', volume):
                    app = modal_app.web.local()
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                        first = await client.get('/api/new-coins', params={'view': view})
                        second = await client.get('/api/new-coins', params={'view': view})
                self.assertEqual(first.status_code, 200)
                self.assertEqual(second.status_code, 200)
                self.assertEqual(first.json(), {'revision': 1})
                self.assertEqual(second.json(), {'revision': 2})
                self.assertEqual(second.headers['cache-control'], 'no-store')
                self.assertEqual(reloads, [1, 2])

    async def test_stale_projection_falls_back_with_only_one_volume_reload(self):
        import modal_app
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reloads = []

            def mounted_path(value, *parts):
                text = str(value).replace('\\', '/')
                return root.joinpath(text.removeprefix('/history/'), *parts) if text.startswith('/history/') else Path(value, *parts)

            async def reload():
                reloads.append(True)
                main, projection = root / 'coins.json', root / 'coins.health.json'
                main.write_text(json.dumps({'revision': 'fresh', 'lastRun': 123, 'feeds': {}}), encoding='utf-8')
                projection.write_text(json.dumps({'revision': 'stale'}), encoding='utf-8')
                os.utime(projection, ns=(1_000_000, 1_000_000))
                os.utime(main, ns=(2_000_000, 2_000_000))

            volume = SimpleNamespace(reload=SimpleNamespace(aio=reload))
            with patch.object(modal_app, 'Path', mounted_path), patch.object(modal_app, 'history_volume', volume):
                app = modal_app.web.local()
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                    response = await client.get('/api/new-coins?view=health')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['revision'], 'fresh')
            self.assertEqual(reloads, [True])


if __name__ == '__main__':
    unittest.main()
