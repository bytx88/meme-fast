"""Bounded, single-writer Mode sampling through the existing shared Dex source.

Admission is based on observable markets, never future gains or cap ranking.
Once admitted, a mint stays in the denominator for 72h, including failed reads.
"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import time

from worker.runner_mode import eligible, number, collect, MINUTE, FOLLOWUP

LIMIT = 300
BOOTSTRAP = 150
HOURLY_ADMISSIONS = 4
SCOPE = 'solana-observable-v1'


def read(path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return default


def atomic(path, value):
    tmp = path.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(value, allow_nan=False), encoding='utf-8')
    os.replace(tmp, path)


def observable(quote, now, max_age=15*MINUTE):
    if not isinstance(quote, dict):
        return False
    at, cap = number(quote.get('at')), number(quote.get('cap'))
    return (at is not None and 0 <= now-at <= max_age and cap is not None and 0 < cap <= 1e12
            and (number(quote.get('liquidity')) or 0) >= 3000
            and (number(quote.get('volume24h')) or 0) > 0)


def identity(mint):
    return {'network': 'solana', 'contract_address': mint}


def candidate_snapshot(snapshot):
    """Small projection: Mode never needs price histories, news or wallets."""
    rows = {}
    fields = ('network', 'contract_address', 'dex', 'launchpad', 'launchpadSource', 'runnerMarket')
    for field in ('coins', 'radarCoins'):
        for row in snapshot.get(field, []):
            if not eligible(row) or not isinstance(row.get('runnerMarket'), dict):
                continue
            mint = row['contract_address']
            if mint not in rows or (number(row['runnerMarket'].get('at')) or 0) > (
                    number(rows[mint]['runnerMarket'].get('at')) or 0):
                rows[mint] = {key: row.get(key) for key in fields}
    return {'lastRun': snapshot.get('lastRun'), 'coins': list(rows.values()),
            'feeds': {key: snapshot.get('feeds', {}).get(key) for key in ('solana', 'launchpad_pools')}}


def load_candidates(path):
    projection = path.with_name('coins.runner-candidates.json')
    if projection.exists():
        return read(projection, {})
    return candidate_snapshot(read(path, {}))


def quotes_from_reply(reply, addresses, now):
    if not isinstance(reply, dict) or not isinstance(reply.get('value'), list):
        raise ValueError('Malformed shared market batch')
    selected = {}
    for pair in reply['value']:
        mint = (pair.get('baseToken') or {}).get('address')
        if pair.get('chainId') != 'solana' or mint not in addresses:
            continue
        liquidity = number((pair.get('liquidity') or {}).get('usd'))
        old = selected.get(mint)
        if old is not None and (old['liquidity'] or 0) >= (liquidity or 0):
            continue
        at = number(pair.get('_sourceObservedAt'))
        if at is None:
            at = number(reply.get('observedAt'))
        selected[mint] = {'at': at, 'cap': number(pair.get('marketCap')),
                          'liquidity': liquidity,
                          'volume24h': number((pair.get('volume') or {}).get('h24')),
                          'source': 'DexScreener', 'receivedAt': now}
    return selected


async def sample(directory, snapshot, fetch_quotes, now=None, clock=None):
    clock = clock or (lambda: int(time.time()*1000))
    started = int(clock() if now is None else now)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory/'runner-cohort.json'
    cohort = read(path, {'version': 1, 'id': SCOPE, 'startedAt': started,
                         'members': [], 'seen': [], 'lastAdmissionHour': None})
    if cohort.get('id') != SCOPE:
        raise ValueError('Unexpected runner cohort identity; preserve the stored roster')
    members = [m for m in cohort['members'] if started-m['admittedAt'] < FOLLOWUP]
    seen = set(cohort['seen'])
    candidates = {}
    for field in ('coins', 'radarCoins'):
        for row in snapshot.get(field, []):
            if eligible(row) and row['contract_address'] not in seen:
                quote = row.get('runnerMarket')
                if observable(quote, started, 60*MINUTE):
                    candidates[row['contract_address']] = row
    # Stable hash order is independent of valuation, volume rank and outcome.
    ordered = sorted(candidates, key=lambda mint: hashlib.sha256(mint.encode()).digest())
    initial = not cohort['seen']
    admission_due = initial or cohort.get('lastAdmissionHour') != started//(60*MINUTE)
    probes = ordered[:BOOTSTRAP if initial else 30] if admission_due and len(members)<LIMIT else []
    active = {m['mint'] for m in members}
    addresses = list(dict.fromkeys([m['mint'] for m in members] + probes))
    quotes = {m['mint']: m.get('quote', {}) for m in members}
    errors, active_errors, attempted, succeeded = [], [], 0, 0
    # Two outstanding requests at most; the shared owner still handles pacing,
    # caching and cooldowns for all consumers. No unpaced direct fallback.
    semaphore = asyncio.Semaphore(2)
    async def batch(batch_addresses):
        nonlocal attempted, succeeded
        async with semaphore:
            attempted += 1
            try:
                reply = await asyncio.wait_for(fetch_quotes(batch_addresses), 35)
                received = int(clock() if now is None else now)
                parsed = quotes_from_reply(reply, set(batch_addresses), received)
                for mint in active.intersection(batch_addresses)-parsed.keys():
                    parsed[mint] = {'at': received, 'cap': None, 'liquidity': None,
                                    'volume24h': None, 'source': 'DexScreener',
                                    'status': 'not-returned'}
                for mint, quote in parsed.items():
                    if (number(quote.get('at')) or 0) >= (number(quotes.get(mint, {}).get('at')) or 0):
                        quotes[mint] = quote
                succeeded += 1
            except Exception:
                errors.append('Shared Solana market batch unavailable or malformed')
                if active.intersection(batch_addresses):
                    active_errors.append('Tracked cohort quote batch failed')
    await asyncio.gather(*(batch(addresses[i:i+30]) for i in range(0,len(addresses),30)))
    completed = int(clock() if now is None else now)
    admitted = []
    allowance = min(LIMIT-len(members), BOOTSTRAP if initial else HOURLY_ADMISSIONS)
    if admission_due:
        for mint in probes:
            if len(admitted) >= allowance:
                break
            if observable(quotes.get(mint), completed):
                admitted.append({'mint': mint, 'admittedAt': completed, 'quote': quotes[mint]})
                seen.add(mint)
        # A failed source read can retry; successful admissions cannot exceed
        # the hourly quota by rerunning a completed sampling pass.
        if admitted or not errors:
            cohort['lastAdmissionHour'] = started//(60*MINUTE)
    members.extend(admitted)
    for member in members:
        if member['mint'] in quotes:
            member['quote'] = quotes[member['mint']]
    cohort.update(members=members, seen=sorted(seen), updatedAt=completed,
                  capacity=LIMIT, hourlyAdmissions=HOURLY_ADMISSIONS,
                  attemptedBatches=attempted, successfulBatches=succeeded,
                  admissionCandidates=len(candidates), errors=errors)
    # Persist the same roster on errors. Never remove a failed market early.
    atomic(path, cohort)
    rows = [{**identity(m['mint']), 'runnerMarket': m.get('quote', {})} for m in members]
    source_ok = bool(members) and not active_errors
    observation = {'lastRun': completed, 'coins': rows, 'runnerCohort': cohort,
                   'feeds': {'runner_market': {'status': 'ok' if source_ok else 'failed',
                             'lastSuccess': completed if source_ok else None,
                             'error': None if source_ok else 'Incomplete reserved Mode quote pass'}},
                   'runnerDiscovery': {'snapshotAt': snapshot.get('lastRun'),
                                       'candidateMarkets': len(candidates),
                                       'feeds': snapshot.get('feeds', {}),
                                       'note': 'Admission uses shared discovery; quote coverage describes the tracked sample only.'}}
    return collect(observation, directory)


async def run_job(volume, fetch_quotes, directory='/history', snapshot_path='/history/coins.json'):
    """Separate scheduled writer: discovery delays cannot starve Mode quotes."""
    started = time.monotonic()
    await asyncio.wait_for(volume.reload.aio(), 60)
    snapshot = await asyncio.wait_for(asyncio.to_thread(load_candidates, Path(snapshot_path)), 15)
    try:
        report = await asyncio.wait_for(sample(directory, snapshot, fetch_quotes), 150)
    except Exception:
        from worker.runner_mode import unknown
        report = unknown('Reserved Mode collection failed; previous ledger retained')
        atomic(Path(directory)/'runner-mode.json', report)
        await asyncio.wait_for(volume.commit.aio(), 90)
        raise
    report['job'] = {'elapsedSeconds': round(time.monotonic()-started, 2),
                     'status': 'ok' if report['coverage']['reliable'] else 'degraded'}
    atomic(Path(directory)/'runner-mode.json', report)
    await asyncio.wait_for(volume.commit.aio(), 90)
    print(json.dumps({'runnerMode': report['score'], 'coverage': report['coverage'],
                      'elapsedSeconds': report['job']['elapsedSeconds']}), flush=True)
    return {'score': report['score'], 'coverage': report['coverage'],
            'cohort': report.get('cohort'), 'job': report['job']}


async def local_main():
    import sys
    import httpx
    import ssl
    import truststore
    directory, snapshot_path, base = sys.argv[1:4]
    async with httpx.AsyncClient(timeout=35, verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)) as client:
        async def fetch(addresses):
            response = await client.get(base.rstrip('/')+'/tokens/v1/solana/'+','.join(addresses))
            response.raise_for_status()
            return {'value': response.json(), 'observedAt': int(response.headers['x-data-observed-at'])}
        report = await sample(directory, load_candidates(Path(snapshot_path)), fetch)
        print(json.dumps({'score': report['score'], 'coverage': report['coverage']}))


if __name__ == '__main__':
    asyncio.run(local_main())
