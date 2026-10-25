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

from worker.runner_mode import eligible, collect
from worker.runner_policy import (BOOTSTRAP, FOLLOWUP, HOURLY_ADMISSIONS, HOUR,
                                  LIMIT, MAX_CAP, MIN_LIQUIDITY, QUOTE_MAX_AGE,
                                  SAMPLE_INTERVAL, number, fresh)
from worker.source_stream import QUOTE_TTL

SCOPE = 'solana-observable-v1'
REUSE_MAX_AGE = min(SAMPLE_INTERVAL, QUOTE_TTL*1000)


def read(path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return default


def atomic(path, value):
    tmp = path.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(value, allow_nan=False), encoding='utf-8')
    os.replace(tmp, path)


def observable(quote, now, max_age=QUOTE_MAX_AGE):
    if not isinstance(quote, dict):
        return False
    at, cap = number(quote.get('at')), number(quote.get('cap'))
    return (at is not None and fresh(at, now, max_age) and cap is not None and 0 < cap <= MAX_CAP
            and (number(quote.get('liquidity')) or 0) >= MIN_LIQUIDITY
            and (number(quote.get('volume24h')) or 0) > 0)


def reusable(quote, now):
    """Reuse one source observation for its normal five-minute cache lifetime.

    The longer valuation tolerance is error coverage, not a reason to skip
    scheduled observations. Preserve the original source time on every reuse.
    """
    if not isinstance(quote, dict):
        return False
    at = number(quote.get('at'))
    if at is None or not 0 <= now-at < REUSE_MAX_AGE:
        return False
    if quote.get('status') == 'observed-nonqualifying':
        return (quote.get('source') == 'GeckoTerminal'
                and quote.get('evidence') == 'token-aggregate-activity'
                and number(quote.get('cap')) is None
                and number(quote.get('tokenReserveUsd')) is not None
                and number(quote.get('volume24h')) == 0)
    cap = number(quote.get('cap'))
    return (quote.get('source') == 'DexScreener' and cap is not None and cap <= MAX_CAP
            and number(quote.get('liquidity')) is not None
            and number(quote.get('volume24h')) is not None)


def supersedes_inactivity(quote, cached):
    """Do not let old inactivity conceal a newer valuation or positive volume."""
    return (isinstance(quote, dict) and quote.get('source') == 'DexScreener'
            and (number(quote.get('at')) or 0) >= (number(cached.get('at')) or 0)
            and (number(quote.get('cap')) is not None
                 or (number(quote.get('volume24h')) or 0) > 0))


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


def activity_from_reply(reply, addresses, now):
    """Exact-mint zero token volume can rule out qualification without a cap.

    Do not turn an FDV, price or an omitted record into a market cap or zero.
    """
    if not isinstance(reply, dict) or reply.get('status') != 200:
        raise ValueError('Independent activity source unavailable')
    body = reply.get('body', {})
    at = number(body.get('_sourceObservedAt'))
    if at is None or not fresh(at, now) or not isinstance(body.get('data'), list):
        raise ValueError('Independent activity observation is stale or malformed')
    def metric(value):
        try:
            return number(float(value)) if not isinstance(value, bool) else None
        except (ValueError, TypeError, OverflowError):
            return None
    result = {}
    for row in body['data']:
        attrs = row.get('attributes') or {}
        mint = attrs.get('address')
        if mint not in addresses or row.get('type') != 'token' or row.get('id') != 'solana_'+mint:
            continue
        liquidity = metric(attrs.get('total_reserve_in_usd'))
        volume = metric((attrs.get('volume_usd') or {}).get('h24'))
        if liquidity is None or volume is None or volume != 0:
            continue
        result[mint] = {'at': at, 'cap': None, 'liquidity': None, 'tokenReserveUsd': liquidity, 'volume24h': volume,
                        'source': 'GeckoTerminal', 'receivedAt': now,
                        'status': 'observed-nonqualifying', 'evidence': 'token-aggregate-activity'}
    return result


async def sample(directory, snapshot, fetch_quotes, now=None, clock=None, fetch_activity=None):
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
    candidates, shared_quotes = {}, {}
    for field in ('coins', 'radarCoins'):
        for row in snapshot.get(field, []):
            if not eligible(row):
                continue
            mint, quote = row['contract_address'], row.get('runnerMarket')
            if not isinstance(quote, dict):
                continue
            if (number(quote.get('at')) or 0) >= (number(shared_quotes.get(mint, {}).get('at')) or 0):
                shared_quotes[mint] = quote
            if mint not in seen and observable(quote, started, HOUR):
                previous = candidates.get(mint, {}).get('runnerMarket', {})
                if (number(quote.get('at')) or 0) >= (number(previous.get('at')) or 0):
                    candidates[mint] = row
    # Stable hash order is independent of valuation, volume rank and outcome.
    ordered = sorted(candidates, key=lambda mint: hashlib.sha256(mint.encode()).digest())
    initial = not cohort['seen']
    admission_due = initial or cohort.get('lastAdmissionHour') != started//(HOUR)
    probes = ordered[:BOOTSTRAP if initial else 30] if admission_due and len(members)<LIMIT else []
    active = {m['mint'] for m in members}
    addresses = list(dict.fromkeys([m['mint'] for m in members] + probes))
    quotes = {m['mint']: m.get('quote', {}) for m in members}
    activity_cache = {m['mint']: m.get('activity', m.get('quote', {})) for m in members}
    for mint in addresses:
        shared = shared_quotes.get(mint, {})
        shared_at = number(shared.get('at'))
        if (shared.get('source') == 'DexScreener' and shared_at is not None
                and 0 <= started-shared_at < REUSE_MAX_AGE
                and shared_at >= (number(quotes.get(mint, {}).get('at')) or 0)):
            quotes[mint] = shared
        cached = activity_cache.get(mint, {})
        if supersedes_inactivity(quotes.get(mint, {}), cached):
            activity_cache.pop(mint, None)
        elif reusable(cached, started) and not reusable(quotes.get(mint, {}), started):
            quotes[mint] = cached
    needed_quotes = [mint for mint in addresses if not reusable(quotes.get(mint, {}), started)]
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
                omitted = active.intersection(batch_addresses)-parsed.keys()
                if omitted and number(reply.get('observedAt')) is None:
                    raise ValueError('An omitted market requires a source observation time')
                for mint in omitted:
                    previous = quotes.get(mint, {})
                    if (previous.get('source') == 'DexScreener'
                            and number(previous.get('cap')) is None
                            and (number(previous.get('volume24h')) or 0) > 0
                            and fresh(number(previous.get('at')), received)):
                        # An omission does not retract positive activity. Keep
                        # that evidence so an older zero certificate cannot
                        # hide a revival; it still supplies no valuation.
                        continue
                    parsed[mint] = {'at': number(reply.get('observedAt')), 'cap': None, 'liquidity': None,
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
    await asyncio.gather(*(batch(needed_quotes[i:i+30]) for i in range(0,len(needed_quotes),30)))
    # Only missing tracked valuations need the independent activity check.
    # Use the shared, paced Gecko owner; no provider bypass or per-token fanout.
    missing = [mint for mint in addresses if mint in active and number(quotes.get(mint, {}).get('cap')) is None]
    completed_quotes = int(clock() if now is None else now)
    for mint in active:
        if supersedes_inactivity(quotes.get(mint, {}), activity_cache.get(mint, {})):
            activity_cache.pop(mint, None)
    needed_activity = [mint for mint in missing if not reusable(activity_cache.get(mint, {}), completed_quotes)]
    activity_attempted, activity_confirmed = 0, 0
    if fetch_activity:
        for i in range(0, len(needed_activity), 30):
            requested = needed_activity[i:i+30]
            activity_attempted += 1
            try:
                reply = await asyncio.wait_for(fetch_activity(requested), 35)
                received = int(clock() if now is None else now)
                observed = activity_from_reply(reply, set(requested), received)
                observed = {mint: quote for mint, quote in observed.items()
                            if not supersedes_inactivity(quotes.get(mint, {}), quote)}
                quotes.update(observed)
                activity_cache.update(observed)
                activity_confirmed += len(observed)
                # A successful active/omitted record invalidates the old
                # no-volume certificate; never hide a reported revival.
                for mint in set(requested)-observed.keys():
                    activity_cache.pop(mint, None)
            except Exception:
                errors.append('Independent activity batch unavailable, stale or malformed')
        completed_check = int(clock() if now is None else now)
        for mint in missing:
            cached = activity_cache.get(mint, {})
            at = number(cached.get('at'))
            if (quotes.get(mint, {}).get('status') == 'not-returned'
                    and cached.get('status') == 'observed-nonqualifying'
                    and at is not None and fresh(at, completed_check)):
                quotes[mint] = cached
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
            cohort['lastAdmissionHour'] = started//(HOUR)
    members.extend(admitted)
    for member in members:
        if member['mint'] in quotes:
            member['quote'] = quotes[member['mint']]
        cached = activity_cache.get(member['mint'], {})
        if cached.get('status') == 'observed-nonqualifying':
            member['activity'] = cached
        else:
            member.pop('activity', None)
    cohort.update(members=members, seen=sorted(seen), updatedAt=completed,
                  capacity=LIMIT, hourlyAdmissions=HOURLY_ADMISSIONS,
                  attemptedBatches=attempted, successfulBatches=succeeded,
                  admissionCandidates=len(candidates), errors=errors)
    cohort.update(activityBatches=activity_attempted, activityConfirmed=activity_confirmed)
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


async def run_job(volume, fetch_quotes, directory='/history', snapshot_path='/history/coins.json', fetch_activity=None):
    """Separate scheduled writer: discovery delays cannot starve Mode quotes."""
    started = time.monotonic()
    await asyncio.wait_for(volume.reload.aio(), 60)
    snapshot = await asyncio.wait_for(asyncio.to_thread(load_candidates, Path(snapshot_path)), 15)
    try:
        report = await asyncio.wait_for(sample(directory, snapshot, fetch_quotes, fetch_activity=fetch_activity), 150)
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
