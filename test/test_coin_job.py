import asyncio
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from worker.coin_job import run_coin_job
from worker.coin_projections import project


class CoinJobTests(unittest.IsolatedAsyncioTestCase):
    async def test_commits_once_after_indexer_exits(self):
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder)/'index.done'
            commits = []
            async def reload(): pass
            async def commit():
                self.assertTrue(marker.exists())
                commits.append(True)
            async def items():
                yield 'base:token', int(time.time()*1000)
            async def pop(*args): pass
            volume = SimpleNamespace(reload=SimpleNamespace(aio=reload), commit=SimpleNamespace(aio=commit))
            priorities = SimpleNamespace(items=SimpleNamespace(aio=items), pop=SimpleNamespace(aio=pop))
            commands = {'index': [sys.executable, '-c', f'import time;from pathlib import Path;time.sleep(.1);Path({str(marker)!r}).write_text("done")'],
                        'collect': [sys.executable, '-c', 'print("collected")'],
                        'projections': [sys.executable, '-c', 'print("projected")']}
            logs=[]
            result=await run_coin_job(volume,priorities,commands=commands,log=lambda message,**kw:logs.append(message))
            self.assertEqual(result['status'],'ok')
            self.assertEqual(len(commits),1)
            self.assertTrue(any('all writers closed' in line for line in logs))
            commands['collect']=[sys.executable,'-c','import time;time.sleep(10)']
            commands['index']=[sys.executable,'-c','import time;time.sleep(10)']
            before=time.monotonic()
            with self.assertRaisesRegex(RuntimeError,'collect exceeded'):
                await run_coin_job(volume,priorities,commands=commands,budgets={'collect':.1},log=lambda *args,**kw:None)
            self.assertLess(time.monotonic()-before,2)
            self.assertEqual(len(commits),2)

    async def test_reload_timeout_is_identified_before_any_writer_starts(self):
        async def reload(): await asyncio.sleep(10)
        volume=SimpleNamespace(reload=SimpleNamespace(aio=reload))
        with self.assertRaisesRegex(RuntimeError,'reload exceeded'):
            await run_coin_job(volume,None,budgets={'reload':.01},log=lambda *args,**kw:None)

    def test_projections_are_valid_and_leave_original_snapshot_intact(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'coins.json'
            raw=json.dumps({'coins':[],'radarCoins':[],'lastRun':123,'feeds':{}})
            path.write_text(raw,encoding='utf-8')
            project(path)
            self.assertEqual(path.read_text(encoding='utf-8'),raw)
            for hours in (1,6,12,36,120):
                output=json.loads(path.with_name(f'coins.snipe.v2.{hours}.json').read_text(encoding='utf-8'))
                self.assertEqual(output['coins'],[])
