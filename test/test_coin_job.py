import asyncio
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from worker.coin_job import run_coin_job, bounded, StageTimeout, public_job_health, Child
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
                        'collect': [sys.executable, '-c', f'import json,time;from pathlib import Path;Path({str(Path(folder)/"coins.json")!r}).write_text(json.dumps({{"coins":[],"lastRun":int(time.time()*1000)}}));time.sleep(.15);print("collected")'],
                        'projections': [sys.executable, '-c', 'print("projected")']}
            logs=[]
            result=await run_coin_job(volume,priorities,root=folder,commands=commands,log=lambda message,**kw:logs.append(message))
            self.assertEqual(result['status'],'ok')
            self.assertEqual(len(commits),1)
            self.assertTrue(any('all writers closed' in line for line in logs))
            commands['collect']=[sys.executable,'-c','import time;time.sleep(10)']
            commands['index']=[sys.executable,'-c','import time;time.sleep(10)']
            before=time.monotonic()
            with self.assertRaisesRegex(RuntimeError,'collect exceeded'):
                await run_coin_job(volume,priorities,root=folder,commands=commands,budgets={'collect':.1},log=lambda *args,**kw:None)
            self.assertLess(time.monotonic()-before,2)
            self.assertEqual(len(commits),2)
            report=json.loads((Path(folder)/'coin-job-health.json').read_text())
            self.assertEqual(report['status'],'failed')
            self.assertEqual(report['consecutiveFailures'],1)

    async def exercise(self, folder, collect, *, projections='pass', budgets=None, commit=None):
        async def noop(): pass
        async def items():
            if False: yield None
        volume=SimpleNamespace(reload=SimpleNamespace(aio=noop),commit=SimpleNamespace(aio=commit or noop))
        priorities=SimpleNamespace(items=SimpleNamespace(aio=items))
        commands={key:[sys.executable,'-c',code] for key,code in
                  {'index':'pass','collect':collect,'projections':projections}.items()}
        return await run_coin_job(volume,priorities,root=folder,commands=commands,
                                  budgets=budgets,log=lambda *args,**kwargs:None)

    def checkpoint_command(self, folder):
        return f'import json,time;from pathlib import Path;Path({str(Path(folder)/"coins.json")!r}).write_text(json.dumps({{"coins":[],"lastRun":int(time.time()*1000),"revision":"test:1","feeds":{{}}}}));'

    async def test_timeout_with_fresh_checkpoint_is_degraded_and_committed(self):
        with tempfile.TemporaryDirectory() as folder:
            commits=[]
            async def commit(): commits.append(True)
            report=await self.exercise(folder,self.checkpoint_command(folder)+'time.sleep(10)',
                                       budgets={'collect':2},commit=commit)
            self.assertEqual(report['status'],'degraded')
            self.assertEqual(report['snapshot']['revision'],'test:1')
            self.assertEqual(report['consecutiveFailures'],0)
            self.assertEqual(len(commits),1)
            self.assertIn('Fresh checkpoint',report['warnings'][0])

    async def test_projection_failure_uses_fresh_main_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            report=await self.exercise(folder,self.checkpoint_command(folder),projections='raise ValueError("bad projection")')
            self.assertEqual(report['status'],'degraded')
            self.assertEqual(report['stages']['projections']['status'],'failed')
            self.assertIsNotNone(report['snapshot'])

    async def test_crash_and_stale_snapshot_are_real_failures(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder)/'coins.json').write_text(json.dumps({'coins':[],'lastRun':1}))
            with self.assertRaisesRegex(RuntimeError,'did not publish'):
                await self.exercise(folder,'pass')
            with self.assertRaisesRegex(RuntimeError,'broken collector'):
                await self.exercise(folder,'raise ValueError("broken collector")')
            report=json.loads((Path(folder)/'coin-job-health.json').read_text())
            self.assertEqual(report['consecutiveFailures'],2)

    async def test_commit_timeout_is_not_hidden_as_success(self):
        with tempfile.TemporaryDirectory() as folder:
            async def commit(): await asyncio.sleep(10)
            with self.assertRaisesRegex(StageTimeout,'commit exceeded'):
                await self.exercise(folder,self.checkpoint_command(folder),commit=commit,budgets={'commit':.01})

    async def test_deadline_does_not_wait_for_cancellation_acknowledgement(self):
        release=asyncio.Event()
        async def resistant():
            try:
                await release.wait()
            except asyncio.CancelledError:
                await release.wait()
        task=asyncio.create_task(resistant())
        started=time.monotonic()
        try:
            with self.assertRaises(StageTimeout):
                await bounded(task,.02,'RPC')
            self.assertLess(time.monotonic()-started,.5)
        finally:
            release.set()
            await task

    async def test_large_output_does_not_deadlock(self):
        child=Child()
        try:
            await child.start([sys.executable,'-c','import sys;sys.stdout.write("x"*1000000);sys.stderr.write("e"*1000000)'])
            result=await child.finish(3,'large output')
            self.assertEqual(len(result),4000)
        finally:
            await child.close(1)

    def test_health_detects_missing_and_stale_runs(self):
        self.assertTrue(public_job_health({},1000)['stale'])
        self.assertFalse(public_job_health({'completedAt':1000},2000)['stale'])
        self.assertTrue(public_job_health({'completedAt':1000},902000)['stale'])

    @unittest.skipUnless(os.name == 'posix', 'Modal Linux process-group test')
    async def test_descendant_is_stopped_after_leader_exits(self):
        with tempfile.TemporaryDirectory() as folder:
            marker=Path(folder)/'descendant-wrote'
            descendant=f'import time;from pathlib import Path;time.sleep(.5);Path({str(marker)!r}).write_text("unsafe")'
            leader=f'import subprocess,sys;subprocess.Popen([sys.executable,"-c",{descendant!r}]);print("leader done")'
            child=Child()
            try:
                await child.start([sys.executable,'-c',leader])
                await child.finish(2,'leader')
            finally:
                await child.close(1)
            await asyncio.sleep(.7)
            self.assertFalse(marker.exists())

    async def test_overall_deadline_is_enforced(self):
        with tempfile.TemporaryDirectory() as folder:
            started=time.monotonic()
            with self.assertRaises(StageTimeout):
                await self.exercise(folder,'import time;time.sleep(10)',budgets={
                    'total':.3,'commit':.01,'cleanup':.01,'report':.01,'collect':10})
            self.assertLess(time.monotonic()-started,1)

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
