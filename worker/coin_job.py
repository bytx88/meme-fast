"""Deadline-driven refresh with bounded process cleanup and durable health."""
import asyncio
import hashlib
import json
import os
import signal
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit
from worker.refresh_priority import PRIORITY_TTL

DESIGN_VERSION = 3

# Volume latency can exceed a minute during service congestion. Leave space
# for durable publication inside Modal's 600-second function timeout, while
# keeping provider collection independently bounded.
DEFAULT_BUDGETS = {'total': 540, 'reload': 90, 'priorities': 20, 'collect': 280,
                   'projections': 60, 'commit': 120, 'cleanup': 10, 'report': 30}


class StageTimeout(RuntimeError):
    pass


async def bounded(operation, seconds, name):
    # wait_for waits for cancellation acknowledgement, which need not arrive
    # from a stalled RPC. The deadline must bound cancellation itself.
    task = asyncio.ensure_future(operation)
    try:
        done, _ = await asyncio.wait({task}, timeout=max(0, seconds))
        if done:
            return task.result()
        raise StageTimeout(f'collect_coins: {name} exceeded {seconds:.2f}s')
    finally:
        if not task.done():
            task.cancel()
            task.add_done_callback(lambda result: result.exception() if not result.cancelled() else None)


class Child:
    """No output pipes to fill or remain open in descendants after exit."""
    def __init__(self):
        self.output = tempfile.TemporaryFile()
        self.error = tempfile.TemporaryFile()
        self.process = None
        self.closed = False

    async def start(self, command, env=None):
        self.process = await asyncio.create_subprocess_exec(
            *command, stdout=self.output, stderr=self.error, env=env,
            **({'start_new_session': True} if os.name == 'posix' else {}))
        return self

    def tail(self, stream):
        stream.seek(0, os.SEEK_END)
        stream.seek(max(0, stream.tell()-4000))
        return stream.read().decode(errors='replace')

    async def finish(self, seconds, name):
        await bounded(self.process.wait(), seconds, name)
        if self.process.returncode:
            raise RuntimeError(self.tail(self.error) or f'{name} exited {self.process.returncode}')
        return self.tail(self.output)

    async def close(self, seconds):
        if self.closed:
            return
        try:
            if self.process:
                try:
                    # Descendants must not retain files after their leader exits.
                    if os.name == 'posix':
                        os.killpg(self.process.pid, signal.SIGKILL)
                    elif self.process.returncode is None:
                        self.process.kill()
                except ProcessLookupError:
                    pass
                await bounded(self.process.wait(), seconds, 'child shutdown')
            self.closed = True
        finally:
            # Even a failed shutdown must release our own temporary handles.
            self.output.close()
            self.error.close()


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return default


def write_report(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report), encoding='utf-8')
    os.replace(temporary, path)


def public_job_health(report, now_ms=None):
    now_ms = int(time.time()*1000) if now_ms is None else now_ms
    completed = report.get('completedAt')
    return {**report, 'stale': not isinstance(completed, (int, float))
            or now_ms-completed > 15*60*1000}


async def run_coin_job(volume, priorities, root='/history', app='/app', **options):
    # An independent outer deadline covers even unexpected gaps between stages.
    total = (options.get('budgets') or {}).get('total', DEFAULT_BUDGETS['total'])
    return await bounded(_run_coin_job(volume, priorities, root, app, **options), total, 'overall job')


async def _run_coin_job(volume, priorities, root='/history', app='/app', *,
                       budgets=None, commands=None, log=print, candidate_tokens=(), market_url=''):
    limits = dict(DEFAULT_BUDGETS)
    limits.update(budgets or {})
    started, started_at = time.monotonic(), int(time.time()*1000)
    started_cpu = os.times()
    deadline = started+limits['total']
    health_path = Path(root)/'coin-job-health.json'
    snapshot_path = Path(root)/'coins.json'
    stages, warnings = {}, []
    children = []
    failure = None
    checkpoint = None
    previous_health = {}

    def note(message):
        log(f'collect_coins +{time.monotonic()-started:.1f}s {message}', flush=True)

    async def stage(name, operation, *, reserve=True):
        note(name+' started')
        remaining = deadline-time.monotonic()
        if reserve:
            remaining -= limits['commit']+limits['cleanup']+limits['report']
        try:
            value = await bounded(operation, min(limits[name], max(0, remaining)), name)
        except Exception as error:
            stages[name] = {'status': 'failed', 'error': str(error)}
            note(name+f' failed: {error}')
            raise
        stages[name] = {'status': 'complete'}
        note(name+' completed')
        return value

    async def priority_ids():
        active = []
        async for token_id, requested_at in priorities.items.aio():
            if isinstance(requested_at, (int, float)) and 0 <= started_at-requested_at < PRIORITY_TTL:
                active.append((token_id, requested_at))
            else:
                await priorities.pop.aio(token_id, None)
        return [key for key, _ in sorted(active, key=lambda item: -item[1])[:300]]

    async def launch(command, env=None):
        child = Child()
        children.append(child)
        return await child.start(command, env)

    await stage('reload', volume.reload.aio())
    commands = commands or {
        'index': [sys.executable, f'{app}/worker/robinhood_indexer.py', 'scan', f'{root}/robinhood-pools.sqlite', f'{root}/robinhood-pool-feed.json'],
        'collect': ['node', f'{app}/worker/coin-collector.mjs', f'{root}/coins.json'],
        'projections': [sys.executable, f'{app}/worker/coin_projections.py', f'{root}/coins.json'],
    }
    async def read_checkpoint():
        value = await asyncio.to_thread(read_json, snapshot_path, {})
        if not isinstance(value.get('coins'), list) or not isinstance(value.get('lastRun'), (int, float)) or value['lastRun'] < started_at:
            return None
        return {'lastRun': value['lastRun'], 'revision': value.get('revision'),
                'coins': len(value['coins']), 'providerErrors': {
                    key: feed['error'] for key, feed in value.get('feeds', {}).items()
                    if isinstance(feed, dict) and feed.get('error')}}

    try:
        previous_health = await bounded(asyncio.to_thread(read_json, health_path, {}), limits['report'], 'previous health')
        try:
            ids = await stage('priorities', priority_ids())
        except Exception as error:
            warnings.append(f'Priority service unavailable: {error}')
            ids = []
        try:
            indexer = await bounded(launch(commands['index']), limits['cleanup'], 'indexer start')
        except Exception as error:
            indexer = None
            warnings.append(f'Optional indexer unavailable: {error}')
        collector = None
        async def collect():
            nonlocal collector
            collector = await launch(commands['collect'], {**os.environ, 'MEME_REFRESH_PRIORITY_IDS': json.dumps(ids),
                'MEME_STREAM_TOKEN_CANDIDATES': json.dumps(list(candidate_tokens)[:30]),
                'MEME_SHARED_MARKET_URL': market_url})
            return await collector.finish(limits['collect'], 'collect')
        collect_timeout = None
        try:
            note(await stage('collect', collect()))
        except StageTimeout as error:
            collect_timeout = error
        finally:
            if collector:
                await collector.close(limits['cleanup'])
        if collect_timeout:
            checkpoint = await bounded(read_checkpoint(), limits['report'], 'checkpoint validation')
            if checkpoint is None:
                raise collect_timeout
            warnings.append(f'Fresh checkpoint retained after {collect_timeout}')
        if indexer:
            # A fast shared-cache pass can finish before the event loop has
            # observed the indexer's exit. Give its final atomic export one
            # bounded second, without using the publication/cleanup reserve.
            grace = min(1, max(0, deadline-time.monotonic()-limits['commit']-limits['cleanup']-limits['report']))
            if indexer.process.returncode is None and grace:
                try:
                    await asyncio.wait_for(indexer.process.wait(), grace)
                except asyncio.TimeoutError:
                    pass
            if indexer.process.returncode is None:
                warnings.append('Indexer still running after market collection; retained its previous atomic export')
            elif indexer.process.returncode:
                warnings.append('Optional indexer failed: '+indexer.tail(indexer.error))
            await indexer.close(limits['cleanup'])
        async def projections():
            child = await launch(commands['projections'])
            return await child.finish(limits['projections'], 'projections')
        try:
            await stage('projections', projections())
        except Exception as error:
            warnings.append(f'Projection unavailable; API uses main snapshot: {error}')
        # Stop projections before validating and committing their input snapshot.
        await bounded(asyncio.gather(*(child.close(limits['cleanup']) for child in children)),
                      limits['cleanup'], 'all writers shutdown')
        checkpoint = await bounded(read_checkpoint(), limits['report'], 'checkpoint validation')
        if checkpoint is None:
            raise RuntimeError('Collector did not publish a fresh valid snapshot')
    except Exception as error:
        failure = error
    finally:
        # Never commit if we cannot establish that every writer has stopped.
        await bounded(asyncio.gather(*(child.close(limits['cleanup']) for child in children)),
                      limits['cleanup'], 'all writers shutdown')
        note('all writers closed')

    finished_cpu = os.times()
    process_cpu = sum(getattr(finished_cpu, key) - getattr(started_cpu, key)
                      for key in ('user', 'system', 'children_user', 'children_system'))
    report = {'version': DESIGN_VERSION,
              'codeSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'startedAt': started_at,
              'completedAt': int(time.time()*1000),
              'status': 'failed' if failure else 'degraded' if warnings or checkpoint['providerErrors'] else 'ok',
              'stages': stages, 'warnings': warnings, 'snapshot': checkpoint,
              'error': str(failure) if failure else None,
              'consecutiveFailures': previous_health.get('consecutiveFailures', 0)+1 if failure else 0,
              'lastSuccessAt': previous_health.get('lastSuccessAt') if failure else int(time.time()*1000),
              'marketTransport': 'loopback' if urlsplit(market_url).hostname == '127.0.0.1' else 'web' if market_url else 'direct',
              # Controller plus reaped children, before the final Volume commit;
              # remote source owners and Modal reservation billing are separate.
              'processCpuSeconds': round(process_cpu, 3),
              'elapsedSeconds': round(time.monotonic()-started, 1)}
    await bounded(asyncio.to_thread(write_report, health_path, report), limits['report'], 'health write')
    await stage('commit', volume.commit.aio(), reserve=False)
    note('finished '+report['status'])
    if failure:
        raise failure
    return report
