import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit


class RunnerDispatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_mode_is_dispatched_before_discovery_and_reuses_existing_schedule(self):
        import modal_app
        calls = []
        async def dispatch():
            calls.append('mode')
        async def reload():
            calls.append('stream')
        async def url():
            self.fail('Scheduled collection must not wake the public web application')
        async def main(*args, **kwargs):
            calls.append('main')
            target = urlsplit(kwargs['market_url'])
            self.assertEqual(target.scheme, 'http')
            self.assertEqual(target.hostname, '127.0.0.1')
            self.assertEqual(target.path, '/api/dex')
            return {'status': 'test'}
        with patch.object(modal_app, 'collect_runner_mode', SimpleNamespace(spawn=SimpleNamespace(aio=dispatch))), \
             patch.object(modal_app, 'stream_volume', SimpleNamespace(reload=SimpleNamespace(aio=reload))), \
             patch.object(modal_app, 'web', SimpleNamespace(get_web_url=SimpleNamespace(aio=url))), \
             patch('worker.data_stream.read', return_value={}), patch('worker.coin_job.run_coin_job', main):
            await modal_app.collect_coins.local()
        self.assertEqual(calls, ['mode', 'stream', 'main'])
        tree = ast.parse(Path(modal_app.__file__).read_text(encoding='utf-8'))
        scheduled = [node.name for node in ast.walk(tree)
                     if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                     and any(isinstance(d, ast.Call) and any(k.arg == 'schedule' for k in d.keywords)
                             for d in node.decorator_list)]
        self.assertLessEqual(len(scheduled), 5)
        self.assertIn('collect_coins', scheduled)
        self.assertNotIn('collect_runner_mode', scheduled)


if __name__ == '__main__':
    unittest.main()
