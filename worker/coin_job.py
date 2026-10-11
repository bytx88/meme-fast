"""Bounded coin refresh orchestration; commit only after both writers exit."""
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from worker.refresh_priority import PRIORITY_TTL


async def run_coin_job(volume, priorities, root='/history', app='/app', *,
                       budgets=None, commands=None, log=print):
    limits = {'reload': 45, 'priorities': 20, 'collect': 280, 'projections': 60, 'commit': 90}
    limits.update(budgets or {})
    started = time.monotonic()

    def note(message):
        log(f'collect_coins +{time.monotonic()-started:.1f}s {message}', flush=True)

    async def stage(name, operation):
        note(name + ' started')
        try:
            value = await asyncio.wait_for(operation, limits[name])
        except TimeoutError as error:
            note(name + f' timed out after {limits[name]}s')
            raise RuntimeError(f'collect_coins: {name} exceeded {limits[name]}s') from error
        except Exception as error:
            note(name + f' failed: {error}')
            raise
        note(name + ' completed')
        return value

    async def priority_ids():
        now = int(time.time()*1000)
        active = []
        async for token_id, requested_at in priorities.items.aio():
            if isinstance(requested_at, (int, float)) and 0 <= now-requested_at < PRIORITY_TTL:
                active.append((token_id, requested_at))
            else:
                await priorities.pop.aio(token_id, None)
        return [key for key, _ in sorted(active, key=lambda item: -item[1])[:300]]

    async def stop(process):
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        return await process.communicate()

    async def child(command, timeout, env=None):
        process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.PIPE,
                                                       stderr=asyncio.subprocess.PIPE, env=env)
        try:
            out, error = await asyncio.wait_for(process.communicate(), timeout)
        finally:
            if process.returncode is None:
                await stop(process)
        if process.returncode:
            raise RuntimeError(error.decode(errors='replace')[-2000:] or f'Child exited {process.returncode}')
        return out.decode(errors='replace')

    await stage('reload', volume.reload.aio())
    try:
        ids = await stage('priorities', priority_ids())
    except Exception as error:
        note(f'Priority service unavailable; collecting default targets: {error}')
        ids = []
    commands = commands or {
        'index': [sys.executable, f'{app}/worker/robinhood_indexer.py', 'scan', f'{root}/robinhood-pools.sqlite', f'{root}/robinhood-pool-feed.json'],
        'collect': ['node', f'{app}/worker/coin-collector.mjs', f'{root}/coins.json'],
        'projections': [sys.executable, f'{app}/worker/coin_projections.py', f'{root}/coins.json'],
    }
    indexer = await asyncio.create_subprocess_exec(*commands['index'], stdout=asyncio.subprocess.DEVNULL,
                                                  stderr=asyncio.subprocess.PIPE)
    index_started = time.monotonic()
    try:
        try:
            output = await stage('collect', child(commands['collect'], limits['collect'],
                                {**os.environ, 'MEME_REFRESH_PRIORITY_IDS': json.dumps(ids)}))
            await stage('projections', child(commands['projections'], limits['projections']))
            note(output.strip())
        finally:
            note('indexer shutdown started')
            try:
                _, error = await asyncio.wait_for(indexer.communicate(), max(.01, limits['collect']-(time.monotonic()-index_started)))
                if indexer.returncode:
                    note('Indexer failed: ' + error.decode(errors='replace')[-2000:])
            except TimeoutError:
                await stop(indexer)
                note('Indexer budget exhausted; retained its previous atomic export')
            note('indexer stopped; all writers closed')
    finally:
        # A single commit, with no child holding SQLite or snapshot files open.
        await stage('commit', volume.commit.aio())
    note('finished')
    return {'status': 'ok', 'elapsedSeconds': round(time.monotonic()-started, 1)}
