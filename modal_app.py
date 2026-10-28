"""Modal deployment for Meme Fast.

Deploy with:
    py -m modal deploy modal_app.py
"""

from pathlib import Path
import hashlib
import os
import re
from urllib.parse import urlencode

import modal


APP_NAME = "meme-fast"
LOCAL_DIST = Path(__file__).parent / "dist"
REMOTE_DIST = "/app/dist"
RUNNING_IN_MODAL = Path(REMOTE_DIST).is_dir() or bool(
    os.getenv("MODAL_TASK_ID") or os.getenv("MODAL_ENVIRONMENT_NAME")
)
DIST_SOURCE = Path(REMOTE_DIST) if RUNNING_IN_MODAL else LOCAL_DIST
ASSET_REVISION = os.getenv("MEME_FAST_ASSET_REVISION", "") if RUNNING_IN_MODAL else hashlib.sha256(
    b"versioned-html-assets-v2" + b"".join(path.name.encode() + path.read_bytes() for path in sorted(LOCAL_DIST.iterdir()) if path.is_file())
).hexdigest()[:16]

if not RUNNING_IN_MODAL and not (LOCAL_DIST / "index.html").is_file():
    raise RuntimeError("dist/index.html is missing")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .env({"MEME_FAST_ASSET_REVISION": ASSET_REVISION, "MEME_SHARED_SOURCES": "1"})
    .apt_install("nodejs")
    .pip_install("fastapi>=0.111.0", "httpx>=0.27.0", "truststore>=0.10.0")
    .add_local_dir(DIST_SOURCE, remote_path=REMOTE_DIST, copy=True)
    .add_local_dir(Path("/app/worker") if RUNNING_IN_MODAL else Path(__file__).parent / "worker", remote_path="/app/worker")
    .add_local_file(Path("/app/x-factor-targets.json") if RUNNING_IN_MODAL else Path(__file__).parent / "x-factor-targets.json", remote_path="/app/x-factor-targets.json")
)

app = modal.App(APP_NAME, image=image)
refresh_priorities = modal.Dict.from_name("meme-fast-refresh-priorities", create_if_missing=True)
tracked_wallet_registry = modal.Dict.from_name("meme-fast-tracked-wallet-registry", create_if_missing=True)
wallet_universe_registry = modal.Dict.from_name("meme-fast-wallet-universe", create_if_missing=True)
meme_preset_registry = modal.Dict.from_name("meme-fast-meme-preset", create_if_missing=True)
history_volume = modal.Volume.from_name("meme-fast-coin-history", create_if_missing=True)
macro_volume = modal.Volume.from_name("meme-fast-macro-review", create_if_missing=True)
balance_watches = modal.Dict.from_name("meme-fast-balance-watches", create_if_missing=True)
smart_volume = modal.Volume.from_name("meme-fast-smart-wallet-history", create_if_missing=True)
balance_requests = modal.Dict.from_name("meme-fast-balance-requests", create_if_missing=True)
smartness_volume = modal.Volume.from_name("meme-fast-smartness-ledger", create_if_missing=True)
source_volume = modal.Volume.from_name("meme-fast-source-stream", create_if_missing=True)
stream_volume = modal.Volume.from_name("meme-fast-data-stream", create_if_missing=True)

# Collectors publish before returning, so idle workers need no warm tail.
# Source owners keep Modal's default idle window to preserve their batched caches.
COLLECTOR_IDLE_SECONDS = 2


@app.function(timeout=90, max_containers=1, volumes={'/sources': source_volume})
@modal.concurrent(max_inputs=1)
def read_gecko_source(path, workload='interactive'):
    import sys
    import httpx
    if '/app' not in sys.path:
        sys.path.insert(0, '/app')
    from worker.source_stream import source_session, paced_get, gecko_path, gecko_response, gecko_ttl, admit_gecko, SourceDeferred
    path = gecko_path(path)
    session = source_session('/sources/gecko', source_volume)
    stream = session.stream()
    ttl = gecko_ttl(path)
    try:
        def fetch(target_path):
            # Persist the budget with each outbound attempt, including failures.
            if not stream.cooldowns():
                admit_gecko(stream, workload)
                session.force_commit = True
            with httpx.Client(timeout=15, follow_redirects=False) as client:
                response = paced_get(session, client, 'https://api.geckoterminal.com/api/v2' + target_path, 0,
                                     headers={'accept': 'application/json;version=20230203'})
                body = response.json()
                if not isinstance(body, dict) or not isinstance(body.get('data'), (list, dict)):
                    raise ValueError('Invalid market source response')
                return body
        reply = gecko_response(stream, path, fetch, ttl)
        return dict(status=200, body=dict(reply['value'], _sourceObservedAt=reply['observedAt']))
    except Exception as error:
        import time
        cooldown = stream.cooldowns().get(('api.geckoterminal.com', 'get'), 0) - time.time()
        return dict(status=429 if cooldown > 0 else 503, body={'error':'Shared market source unavailable'},
                    retryAfter=max(1, int(cooldown), getattr(error,'retry_after',0)),
                    deferred=isinstance(error, SourceDeferred))
    finally:
        session.finish()


@app.function(timeout=60, max_containers=1, volumes={'/sources': source_volume})
@modal.concurrent(max_inputs=1)
def read_social_source(url):
    import sys
    from urllib.parse import urlparse, parse_qsl
    import httpx
    import xml.etree.ElementTree as ET
    if '/app' not in sys.path:
        sys.path.insert(0, '/app')
    from worker.source_stream import source_session, paced_get
    from worker.publisher_feed import SOURCES, publisher_json
    target = urlparse(url)
    publisher = url in SOURCES.values()
    if not publisher and (target.scheme != 'https' or target.netloc != 'news.google.com' or target.path != '/rss/search'
            or target.fragment or len(url) > 1500 or set(dict(parse_qsl(target.query))) - {'q', 'hl', 'gl', 'ceid'}):
        raise ValueError('Unsupported social source')
    session = source_session('/sources/rss', source_volume)
    stream = session.stream()
    try:
        def fetch():
            with httpx.Client(timeout=20, follow_redirects=True) as client:
                response = paced_get(session, client, url, 1,
                                     headers={'User-Agent': 'Mozilla/5.0 (compatible; MemeFastRSS/1.0)'})
                if publisher:
                    return publisher_json(response.content)
                if ET.fromstring(response.content).tag != 'rss':
                    raise ValueError('Invalid RSS source response')
                return response.content.decode('utf-8')
        return stream.get('publisher:feed' if publisher else 'rss:search',
                          url if publisher else sorted(parse_qsl(target.query)), fetch, 300)
    finally:
        session.finish()


@app.function(timeout=60, max_containers=1, volumes={'/sources': source_volume})
@modal.concurrent(max_inputs=1)
def read_context_source(url):
    import sys
    import httpx
    if '/app' not in sys.path:
        sys.path.insert(0, '/app')
    from worker.context_source import context_target
    from worker.source_stream import source_session, paced_get
    target, ttl = context_target(url)
    session = source_session('/sources/context', source_volume)
    try:
        def fetch():
            with httpx.Client(timeout=25,follow_redirects=False) as client:
                return paced_get(session,client,target,1,headers={'accept':'text/plain'}).text[:60000]
        return session.stream().get('context:read',target,fetch,ttl)
    finally:
        session.finish()


@app.function(timeout=60, max_containers=1, volumes={'/sources': source_volume})
@modal.concurrent(max_inputs=1)
def read_market_source(network, addresses, scope='quotes'):
    import sys
    import httpx
    if '/app' not in sys.path:
        sys.path.insert(0, '/app')
    from worker.source_stream import source_session, dex_tokens, dex_pools, paced_get
    profiles = network == 'profiles' and addresses == [] and scope == 'profiles'
    if network == 'profiles' and not profiles:
        raise ValueError('Invalid token profile source')
    if not profiles and (scope not in ('quotes', 'pools') or scope == 'pools' and len(addresses) != 1):
        raise ValueError('Invalid token source scope')
    search = network == 'search'
    if network not in ('solana', 'base', 'robinhood', 'bsc', 'ethereum', 'arbitrum', 'optimism', 'polygon', 'avalanche', 'search', 'profiles'):
        raise ValueError('Unsupported market network')
    if search:
        if not isinstance(addresses, list) or len(addresses) != 1 or not isinstance(addresses[0], str) or not 1 <= len(addresses[0].strip()) <= 160:
            raise ValueError('Invalid market search')
    elif not profiles and (not isinstance(addresses, list) or not 1 <= len(addresses) <= 30 or any(
            not isinstance(address, str) or not re.fullmatch(r'[A-Za-z0-9]{20,100}', address) for address in addresses)):
            raise ValueError('Invalid token addresses')
    if network not in ('solana', 'search'):
        addresses = [address.lower() for address in addresses]
    session = source_session('/sources/dex', source_volume)
    stream = session.stream()
    try:
        def fetch_json(url, **options):
            # Cache hits and projections do not need a connection or TLS setup.
            with httpx.Client(timeout=15, follow_redirects=False) as client:
                return paced_get(session, client, url, .3, **options).json()
        if profiles:
            def fetch_profiles():
                body = fetch_json('https://api.dexscreener.com/token-profiles/latest/v1')
                if not isinstance(body, list):
                    raise ValueError('Invalid token profiles')
                return body
            return stream.get('dex:profiles', [], fetch_profiles, 900)
        if search:
            def search_tokens():
                body = fetch_json('https://api.dexscreener.com/latest/dex/search', params={'q': addresses[0]})
                if not isinstance(body.get('pairs'), list):
                    raise ValueError('Invalid market search response')
                return body
            return stream.get('dex:search', addresses, search_tokens, 60)
        if scope == 'pools':
            def fetch_pools(chain, address):
                body = fetch_json('https://api.dexscreener.com/token-pairs/v1/' + chain + '/' + address)
                if not isinstance(body, list):
                    raise ValueError('Invalid token pool response')
                return body
            return dex_pools(stream, network, addresses[0], fetch_pools)
        def fetch(chain, contracts):
            body = fetch_json('https://api.dexscreener.com/tokens/v1/' + chain + '/' + ','.join(contracts))
            if not isinstance(body, list):
                raise ValueError('Invalid token market response')
            return body
        return dex_tokens(stream, network, addresses, fetch)
    finally:
        session.finish()


@app.function(timeout=240, max_containers=1, memory=128, scaledown_window=COLLECTOR_IDLE_SECONDS,
              volumes={'/stream': stream_volume, '/history': history_volume, '/smartness': smartness_volume})
@modal.concurrent(max_inputs=1)
def collect_data_stream():
    import sys
    import json
    import httpx
    if '/app' not in sys.path:
        sys.path.insert(0, '/app')
    from worker.data_stream import collect
    from worker.public_rpc import public_rpc
    from worker.smartness import read_report
    stream_volume.reload()
    history_volume.reload()
    smartness_volume.reload()
    def saved(name):
        try:
            return json.loads(Path('/history', name).read_text())
        except (OSError, ValueError):
            return {}
    with httpx.Client(timeout=12) as client:
        report = collect('/stream', saved('coins.json'), saved('followed-wallets.json'),
                         read_report('/smartness'), rpc=public_rpc(client))
    stream_volume.commit()
    return dict(updatedAt=report['updatedAt'], tokens=len(report['tokens']), wallets=len(report['wallets']))


@app.function(timeout=90, max_containers=1, volumes={'/sources': source_volume})
@modal.concurrent(max_inputs=1)
def read_source(provider, method, params):
    """One paced, cached provider owner for all wallet consumers."""
    import httpx
    import sys
    import time
    if '/app' not in sys.path:
        sys.path.insert(0, '/app')
    from worker.source_stream import source_session, RPC_TTL, mint_from_wallet_cache
    from worker.rpc_projection import multiple_accounts
    if provider != 'solana' or method not in RPC_TTL or not isinstance(params, list):
        raise ValueError('Unsupported source request')
    from worker.public_rpc import public_rpc
    session = source_session('/sources/solana', source_volume)
    stream = session.stream()
    blocked = stream.cooldowns()
    old_blocked = dict(blocked)
    try:
        def fetch(request):
            # Construct the provider client only after retained data misses.
            with httpx.Client(timeout=12) as client:
                return public_rpc(client, shared=False, blocked=blocked, clock=time.time)(method, request)
        if method == 'getTokenAccountsByOwner':
            derived = mint_from_wallet_cache(stream,params)
            if derived is not None:
                return derived
        if method == 'getMultipleAccounts':
            return multiple_accounts(stream, params, fetch, RPC_TTL[method])
        # Latest-eight activity and latest-forty ledger reads reuse one page.
        requested_limit = None
        if method == 'getSignaturesForAddress' and len(params) == 2 and isinstance(params[1], dict):
            requested_limit = params[1].get('limit', 40)
            if type(requested_limit) is int and 0 < requested_limit <= 40 and not any(k in params[1] for k in ('before', 'until')):
                params = [params[0], dict(params[1], limit=40)]
            else:
                requested_limit = None
        ttl = 240 if method == 'getTokenAccountsByOwner' and len(params) > 1 and 'programId' in params[1] else RPC_TTL[method]
        result = stream.get('solana:' + method, params, lambda: fetch(params), ttl)
        if requested_limit is not None and isinstance(result['value'], list):
            result['value'] = result['value'][:requested_limit]
        return result
    finally:
        stream.save_cooldowns(blocked)
        session.finish(force=blocked != old_blocked)


def dispatch_smart_collection():
    """One queued/running balance job for all automatic and Inspect requests."""
    import time
    from worker.smart_seeding import request_collection
    return request_collection(balance_requests, collect_smart_wallets.spawn, int(time.time() * 1000))


@app.function(timeout=1200, max_containers=1, scaledown_window=COLLECTOR_IDLE_SECONDS,
              volumes={"/smart": smart_volume, "/smartness": smartness_volume, "/history": history_volume, '/stream': stream_volume})
@modal.concurrent(max_inputs=1)
def collect_smart_wallets(backfill=None, token=None, cohort_scope="universe", request_key=None, request_at=None):
    try:
        return _collect_smart_wallets(backfill, token, cohort_scope)
    finally:
        if request_key:
            lease = balance_requests.get(request_key, None)
            if lease and lease.get('requestedAt') == request_at:
                balance_requests.pop(request_key, None)


def _collect_smart_wallets(backfill=None, token=None, cohort_scope="universe"):
    import sys
    import time
    if "/app" not in sys.path:
        sys.path.insert(0, "/app")
    from worker.smart_wallets import collect_cycle, read_report, make_cohort, needs_refresh, group
    from worker import smart_seeding as seeds
    from worker.smartness import read_report as read_ledger
    from worker.wallet_universe import universe
    from worker.followed_wallets import registry_wallets
    smart_volume.reload()
    report = read_report('/smart')
    if backfill is not None:
        from worker.smart_backfill import install_backfill
        report = install_backfill('/smart', backfill, int(time.time() * 1000))
        smart_volume.commit()
        return {'status': report['status'], 'backfill': report['backfill'], 'snapshots': len(report['samples'])}
    registry = universe(registry_wallets([value for _, value in tracked_wallet_registry.items()]),
                        [value for _, value in wallet_universe_registry.items()])
    now = int(time.time() * 1000)
    if token:
        key = token + ':' + cohort_scope
        balance_watches.put(key, dict(token=token, scope=cohort_scope, requestedAt=now))
    watches = [row for _, row in balance_watches.items()]
    smartness_volume.reload()
    history_volume.reload()
    try:
        import json
        holdings = json.loads(Path('/history/followed-wallets.json').read_text())
    except (OSError, ValueError):
        holdings = {}
    from worker.data_stream import read as read_stream
    stream_volume.reload()
    stream = read_stream('/stream')
    active_tokens = None
    if (0 <= now - (stream.get('marketAt') or 0) < 15 * 60000
            and stream.get('coverage', {}).get('freshMarketsByNetwork', {}).get('solana', 0) > 0):
        active_tokens = {key.split(':', 1)[1] for key in stream['tokens'] if key.startswith('solana:')}
    plan = seeds.prepare('/smart', registry, read_ledger('/smartness'), watches, holdings, now, active_tokens=active_tokens)
    smart_volume.commit()
    job = seeds.choose_job(plan, watches, now)
    result = None
    if job:
        job['startedAt'] = int(time.time() * 1000)
        plan['running'] = dict(job)
        seeds.save('/smart', plan)
        smart_volume.commit()
        def checkpoint(report):
            stamp = int(time.time() * 1000)
            # Keep a queued lease alive while pre-deployment inputs drain too.
            balance_requests.put('balance-heartbeat', dict(at=stamp))
            seeds.checkpoint(plan, job, report, stamp)
            seeds.save('/smart', plan)
            smart_volume.commit()
            print('Balance checkpoint', report['token'], report.get('collection', {}).get('checkedWallets',
                  sum(row['status'] == 'ok' for row in report['wallets'])), '/', len(report['wallets']), flush=True)
        try:
            cohort = make_cohort(job['token'], registry, job['scope'])
            result = collect_cycle('/smart', cohort=cohort, checkpoint=checkpoint, budget_seconds=900,
                                   pass_seconds=90, holdings=holdings)
            seeds.checkpoint(plan, job, result, int(time.time() * 1000), finished=True)
            plan.pop('error', None)
        except Exception as error:
            plan.update(running=None, error='Collection failed; saved readings retained: ' + type(error).__name__)
            check = plan['checks'].setdefault(job['token'] + ':' + job['scope'], {})
            check.update(nextDueAt=int(time.time() * 1000) + 300000, status='unavailable', retryPending=True)
        finally:
            seeds.save('/smart', plan)
            smart_volume.commit()
    # Keep the original archived group current, while honoring a token-wide pause.
    original = group()
    original_policy = plan['tokens'].get(original['token'], {})
    paused = original_policy.get('mode') == 'dormant' or original_policy.get('streamPaused')
    legacy_requested = any(watch.get('token') == original['token'] and
                           0 <= now - watch.get('requestedAt', 0) < 86400000 for watch in watches)
    relevant = legacy_requested or original['token'] in (active_tokens or set()) or any(
        row['token'] == original['token'] for row in plan['ranking'])
    if relevant and not paused and needs_refresh(read_report('/smart'), int(time.time() * 1000)):
        collect_cycle('/smart', budget_seconds=35, pass_seconds=35, holdings=holdings,
                      checkpoint=lambda _: smart_volume.commit())
    return result or dict(ranking=len(plan['ranking']), monitored=len(plan['tokens']), error=plan.get('error'))


@app.function(timeout=180, max_containers=1)
async def retain_wallet_registry():
    """Renew individual entries; listing a Dict is not an individual key read."""
    import asyncio
    gate = asyncio.Semaphore(16)

    async def touch(registry, key):
        async with gate:
            await registry.get.aio(key, None)

    counts = {}
    for name, registry in [('universe', wallet_universe_registry), ('tracked', tracked_wallet_registry)]:
        keys = [key async for key in registry.keys.aio()]
        await asyncio.gather(*(touch(registry, key) for key in keys))
        counts[name] = len(keys)
    import time
    await refresh_priorities.put.aio('wallet-registry-retained-at', int(time.time() * 1000))
    return counts


@app.function(timeout=240, max_containers=1, scaledown_window=COLLECTOR_IDLE_SECONDS, volumes={'/smartness': smartness_volume, '/stream': stream_volume})
@modal.concurrent(max_inputs=1)
def collect_smartness(evidence=None):
    import sys
    import time
    if '/app' not in sys.path:
        sys.path.insert(0, '/app')
    from worker.smartness import collect, read_report, write_report
    from worker.wallet_universe import universe
    from worker.followed_wallets import registry_wallets_with_retry
    from modal.exception import ResourceExhaustedError
    smartness_volume.reload()
    report = read_report('/smartness')
    now = int(time.time() * 1000)
    registry = universe(registry_wallets_with_retry(tracked_wallet_registry.items, (ResourceExhaustedError,)), [value for _, value in wallet_universe_registry.items()])
    from worker.data_stream import read as read_stream, collection_wallets
    stream_volume.reload()
    registry = collection_wallets(registry, read_stream('/stream'))
    if evidence is not None:
        from worker.smartness import ingest_evidence
        report, imported = ingest_evidence('/smartness', registry, evidence)
        smartness_volume.commit()
        return {'imported': imported, 'events': len(report['events'])}
    if report.get('attemptedAt') and 0 <= now - report['attemptedAt'] < 240000:
        return {'attemptedAt': report['attemptedAt'], 'events': len(report['events'])}
    report.update(scanning=True, scanStartedAt=now)
    write_report('/smartness', report)
    smartness_volume.commit()
    try:
        report = collect('/smartness', registry)
    finally:
        # A crash or provider failure preserves the existing ledger.
        final = read_report('/smartness')
        final['scanning'] = False
        write_report('/smartness', final)
        smartness_volume.commit()
    return {'attemptedAt': report.get('attemptedAt'), 'events': len(report['events'])}


@app.function(timeout=100, max_containers=1, scaledown_window=COLLECTOR_IDLE_SECONDS,
              volumes={"/macro": macro_volume})
@modal.concurrent(max_inputs=1)
async def collect_macro_review():
    import sys
    import httpx
    if "/app" not in sys.path: sys.path.insert(0, "/app")
    from worker.macro_review import MacroReview, public_report
    await macro_volume.reload.aio()
    async with httpx.AsyncClient(timeout=18, follow_redirects=True, headers={"User-Agent":"Mozilla/5.0"}) as client:
        report=await MacroReview(client.get, Path(REMOTE_DIST)/"macro-data.mjs", store_path="/macro/review.json").get()
    await macro_volume.commit.aio()
    return public_report(report)


@app.function(schedule=modal.Period(minutes=5), timeout=600, max_containers=1, scaledown_window=COLLECTOR_IDLE_SECONDS, volumes={"/history": history_volume, '/stream': stream_volume})
@modal.concurrent(max_inputs=1)
async def collect_coins():
    import asyncio
    import sys
    if "/app" not in sys.path:
        sys.path.insert(0, "/app")
    from worker.coin_job import run_coin_job
    from worker.collector_sources import CollectorSources
    from worker.data_stream import read as read_stream
    try:
        # Reuse the existing schedule slot, while running Mode in a separate
        # single-writer worker before slower discovery or Volume work begins.
        await asyncio.wait_for(collect_runner_mode.spawn.aio(), 10)
    except Exception as exc:
        print('Runner Mode dispatch failed: '+type(exc).__name__, flush=True)
    await stream_volume.reload.aio()
    candidates = read_stream('/stream').get('tokenCandidates', [])
    async with CollectorSources(read_market_source.remote.aio, read_gecko_source.remote.aio,
                                read_context_source.remote.aio, read_social_source.remote.aio) as market_url:
        return await run_coin_job(history_volume, refresh_priorities, candidate_tokens=candidates,
                                  market_url=market_url)


@app.function(timeout=360, max_containers=1, memory=128, scaledown_window=COLLECTOR_IDLE_SECONDS,
              volumes={"/history": history_volume})
@modal.concurrent(max_inputs=1)
async def collect_runner_mode():
    import sys
    if '/app' not in sys.path:
        sys.path.insert(0, '/app')
    from worker.runner_sampling import run_job
    async def quotes(addresses):
        return await read_market_source.remote.aio('solana', addresses)
    async def activity(addresses):
        from worker.source_stream import background_gecko
        return await background_gecko(lambda: read_gecko_source.remote.aio(
            '/networks/solana/tokens/multi/' + ','.join(addresses), workload='background'))
    return await run_job(history_volume, quotes, fetch_activity=activity)


@app.function(schedule=modal.Period(minutes=30), timeout=300, max_containers=1, scaledown_window=COLLECTOR_IDLE_SECONDS,
              volumes={"/history": history_volume})
def collect_x_factor(target_limit=3):
    import subprocess
    # Reuse the existing half-hour dispatch slot; the macro worker owns its own
    # Volume and runs independently even when X-source collection later fails.
    try:
        collect_macro_review.spawn()
    except Exception:
        print("Macro review dispatch unavailable; on-visit collection remains available")
    history_volume.reload()
    result = subprocess.run(
        ["python", "/app/worker/x_rss_collector.py", "/history/coins.json",
         "/history/x-factor.json", "/app/x-factor-targets.json"],
        capture_output=True, text=True, timeout=260,
        env={**os.environ, "X_FACTOR_TARGET_LIMIT": str(max(1, min(8, int(target_limit))))},
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    history_volume.commit()
    print(result.stdout)


# Automatic Jean Phil monitoring is disabled; retain manual invocation and history.
@app.function(timeout=120, max_containers=1, scaledown_window=COLLECTOR_IDLE_SECONDS,
              volumes={"/history": history_volume})
def collect_jeanphil_monitor():
    import subprocess
    history_volume.reload()
    result = subprocess.run(
        ["python", "/app/worker/jeanphil_monitor.py", "/history/jeanphil-monitor.json"],
        capture_output=True, text=True, timeout=110,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    history_volume.commit()
    print(result.stdout)


@app.function(timeout=30, max_containers=1, scaledown_window=COLLECTOR_IDLE_SECONDS,
              secrets=[modal.Secret.from_name('meme-fast-fomolist')])
def pull_meme_suggestions(config):
    import sys
    if '/app' not in sys.path:
        sys.path.insert(0, '/app')
    from worker.meme_suggestions import Unavailable, fetch_suggestions
    try:
        return {'status': 200, 'body': fetch_suggestions(config)}
    except Unavailable as error:
        return {'status': 503, 'body': {'detail': str(error)}}


@app.function(timeout=60, max_containers=1, scaledown_window=COLLECTOR_IDLE_SECONDS)
@modal.concurrent(max_inputs=1)
async def update_meme_preset(payload):
    import sys
    if '/app' not in sys.path:
        sys.path.insert(0, '/app')
    from worker.meme_preset import Conflict, read_config, revise
    current = read_config(await meme_preset_registry.get.aio('active', None))
    try:
        saved = revise(current, payload)
    except Conflict as error:
        return {'status': 409, 'body': {'detail': str(error), 'current': error.current}}
    except ValueError as error:
        return {'status': 400, 'body': {'detail': str(error)}}
    await meme_preset_registry.put.aio('active', saved)
    refreshing = True
    try:
        await collect_meme_index.spawn.aio()
    except Exception:
        refreshing = False
    return {'status': 200, 'body': {**saved, 'refreshRequested': refreshing}}


# Complete readings remain hourly. Deferred historical admission gets another
# bounded opportunity without restarting an incumbent's comparison history.
@app.function(schedule=modal.Cron("*/5 * * * *"), timeout=480, max_containers=1, scaledown_window=COLLECTOR_IDLE_SECONDS,
              volumes={"/history": history_volume})
@modal.concurrent(max_inputs=1)
def collect_meme_index():
    import sys
    import time
    if "/app" not in sys.path:
        sys.path.insert(0, "/app")
    from worker.meme_index import Sources, collect
    from worker.meme_preset import read_config
    from worker.source_stream import background_gecko_history
    config = read_config(meme_preset_registry.get('active', None))
    history_volume.reload()
    history_deadline = time.monotonic()+260
    def history(path, workload='background'):
        return background_gecko_history(
            lambda: read_gecko_source.remote(path, workload=workload), history_deadline)
    try:
        report = collect("/history/meme-index.json",
            Sources(quotes=read_market_source.remote, history=history,
                    preset=config['members']), preset=config['members'], admissions=config['admissions'])
    finally:
        history_volume.commit()
    return {"updatedAt": report.get("updatedAt"), "constituents": len(report["basket"]), "error": report.get("error")}


@app.function(schedule=modal.Period(minutes=5), timeout=480, max_containers=1, scaledown_window=COLLECTOR_IDLE_SECONDS,
              volumes={"/history": history_volume, '/stream': stream_volume})
def collect_followed_wallets():
    import sys
    import time
    started = time.monotonic()
    def note(stage):
        print(f'collect_followed_wallets +{time.monotonic()-started:.1f}s {stage}', flush=True)
    note('dispatch started')
    # Reuse this schedule slot; renew at most daily, after successful key reads.
    try:
        retained_at = refresh_priorities.get('wallet-registry-retained-at', 0)
        if time.time() * 1000 - retained_at >= 86400000:
            retain_wallet_registry.spawn()
    except Exception as exc:
        print('Wallet retention dispatch failed: ' + type(exc).__name__, flush=True)
    if "/app" not in sys.path:
        sys.path.insert(0, "/app")
    # Share the existing five-minute dispatch slot; keep balance-history writes
    # in their own single-writer function and Volume.
    try:
        collect_smartness.spawn()
    except Exception:
        print('Smartness dispatch unavailable; manual trade scan remains available')
    from modal.exception import ResourceExhaustedError
    note('dispatch completed; registry started')
    from worker.followed_wallets import collect_isolated, registry_wallets_with_retry
    registry = registry_wallets_with_retry(tracked_wallet_registry.items, (ResourceExhaustedError,))
    from worker.wallet_universe import universe
    registry = universe(registry, [value for _, value in wallet_universe_registry.items()])
    from worker.data_stream import read as read_stream, collection_wallets
    stream_volume.reload()
    registry = collection_wallets(registry, read_stream('/stream'))
    note(f'registry completed ({len(registry)} wallets); reload started')
    history_volume.reload()
    note('reload completed; sampling started')
    # Keep provider work bounded independently of registry and Volume latency.
    # subprocess.run kills and reaps the child on timeout, before any commit.
    stream = read_stream('/stream')
    retain_mints = {key.split(':', 1)[1] for key in stream.get('tokens', []) if key.startswith('solana:')}
    try:
        now_ms = int(time.time()*1000)
        interests = sorted([value for _,value in balance_watches.items()
                            if 0 <= now_ms-value.get('requestedAt',0) < 86400000], key=lambda row:-row['requestedAt'])[:300]
        retain_mints.update(row['token'] for row in interests)
    except Exception:
        retain_mints = None  # Missing interest coverage must not discard requested quantities.
    report = collect_isolated("/history/followed-wallets.json", registry=registry, retain_mints=retain_mints)
    note('sampling completed; commit started')
    history_volume.commit()
    note('commit completed')
    # Consumers reload the newly committed raw observations before fetching gaps.
    try:
        dispatch_smart_collection()
    except Exception:
        print('Smart wallet dispatch unavailable; on-visit collection remains available')
    try:
        collect_data_stream.spawn()
    except Exception:
        print('Shared stream dispatch unavailable; previous observations retained')
    summary = {"wallets": len(report["wallets"]),
               "available": sum(row["status"] == "ok" for row in report["wallets"]),
               "collection": report.get('collection'),
               "elapsedSeconds": round(time.monotonic()-started, 1)}
    print(f'Followed wallets: sampled {report["collection"]["sampledWallets"]}/{summary["wallets"]}; '
          f'available {summary["available"]}; budget reached {report["collection"]["budgetReached"]}', flush=True)
    return summary


@app.function(timeout=120, max_containers=1, scaledown_window=COLLECTOR_IDLE_SECONDS, volumes={"/history": history_volume})
def collect_coin_evidence(token_id):
    import json
    import subprocess
    history_volume.reload()
    result = subprocess.run(
        ["python", "/app/worker/coin_rss_evidence.py", "/history/coins.json",
         "/app/x-factor-targets.json", token_id, "/history/coin-rss-evidence"],
        capture_output=True, text=True, timeout=105,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-1000:])
    history_volume.commit()
    return json.loads(result.stdout)


@app.function(min_containers=0, max_containers=2, scaledown_window=30, timeout=150, volumes={"/history": history_volume, "/macro": macro_volume, "/smartness": smartness_volume, "/smart": smart_volume, '/stream': stream_volume, '/sources': source_volume})
@modal.concurrent(max_inputs=16, target_inputs=8)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.gzip import GZipMiddleware
    from fastapi.responses import FileResponse, RedirectResponse, Response
    import httpx

    web_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    web_app.add_middleware(GZipMiddleware, minimum_size=1000)
    import asyncio
    import json
    import sqlite3
    import sys
    import time
    from fastapi.responses import JSONResponse
    if "/app" not in sys.path:
        sys.path.insert(0, "/app")
    from worker.market_proxy import MarketProxy
    from worker.snapshot_view import snapshot_view, snapshot_version
    history_lock = asyncio.Lock()
    async def fetch_market(target):
        reply = await read_gecko_source.remote.aio(target.removeprefix('https://api.geckoterminal.com/api/v2'))
        return httpx.Response(reply['status'], json=reply['body'], headers={'retry-after':str(reply.get('retryAfter', 60))})
    market_cache = MarketProxy(fetch_market, broker=True)
    @web_app.get("/api/btc-liquidation-heatmap")
    def btc_liquidation_heatmap(days: int = 30, symbol: str = 'BTCUSDT'):
        from worker.liquidation_heatmap import load, RANGES, SYMBOLS
        if days not in RANGES or symbol not in SYMBOLS:
            raise HTTPException(status_code=400, detail="Unsupported heatmap range or symbol")
        try:
            return JSONResponse(load(days, symbol), headers={"cache-control": "public, max-age=120"})
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Heatmap provider unavailable; retry shortly",
                                headers={"Retry-After": "120"}) from exc

    @web_app.get("/api/macro-review")
    async def macro_review():
        return JSONResponse(await collect_macro_review.remote.aio(), headers={"cache-control": "no-store"})

    def loaded_snapshot():
        try:
            return json.loads(Path("/history/coins.json").read_text())
        except FileNotFoundError:
            return {"version": 2, "coins": [], "radarCoins": [], "lastRun": None, "feeds": {}}

    async def load_snapshot():
        async with history_lock:
            await history_volume.reload.aio()
            return loaded_snapshot()

    @web_app.get("/api/collector-health")
    async def collector_health():
        from worker.coin_job import public_job_health, bounded
        async with history_lock:
            try:
                await bounded(history_volume.reload.aio(), 15, 'health reload')
            except Exception as exc:
                raise HTTPException(status_code=503, detail="Collector health storage is unavailable") from exc
            try:
                report = json.loads(Path("/history/coin-job-health.json").read_text())
            except FileNotFoundError:
                report = {"version": 2, "status": "awaiting-first-run"}
            except (OSError, ValueError) as exc:
                raise HTTPException(status_code=503, detail="Collector health report is unreadable") from exc
        health = public_job_health(report)
        return JSONResponse(health, status_code=503 if health['stale'] or health['status'] == 'failed' else 200,
                            headers={"cache-control": "no-store"})

    @web_app.post("/api/refresh-priority")
    async def refresh_priority(request: Request):
        from worker.refresh_priority import valid_priority_ids
        body = await request.body()
        if len(body) > 6000:
            raise HTTPException(status_code=400, detail="Priority request too large")
        try:
            ids = valid_priority_ids(json.loads(body).get("ids"))
        except (ValueError, AttributeError, TypeError):
            raise HTTPException(status_code=400, detail="Request 1 to 30 supported token contracts")
        snapshot = await load_snapshot()
        key = lambda value: value if value.startswith("solana:") else value.lower()
        known = {key(coin["id"]) for coin in snapshot.get("coins", []) + snapshot.get("radarCoins", [])}
        accepted = [token_id for token_id in ids if token_id in known]
        now_ms = int(time.time() * 1000)
        await asyncio.gather(*(refresh_priorities.put.aio(token_id, now_ms) for token_id in accepted))
        return JSONResponse({"accepted": len(accepted), "expiresInHours": 24}, headers={"cache-control": "no-store"})

    @web_app.get("/api/x-factor")
    async def x_factor():
        async with history_lock:
            await history_volume.reload.aio()
            try:
                report = json.loads(Path("/history/x-factor.json").read_text())
            except (FileNotFoundError, ValueError):
                report = {"version": 1, "status": "disconnected", "coins": {}}
        return JSONResponse(report, headers={"cache-control": "no-store"})

    async def universe_registry():
        from worker.followed_wallets import registry_wallets
        from worker.wallet_universe import universe
        legacy = registry_wallets([value async for _, value in tracked_wallet_registry.items.aio()])
        return universe(legacy, [value async for _, value in wallet_universe_registry.items.aio()])

    async def universe_report():
        from worker.wallet_universe import report
        registry = await universe_registry()
        async with history_lock:
            await history_volume.reload.aio()
            try:
                holdings = json.loads(Path('/history/followed-wallets.json').read_text())
            except (OSError, ValueError):
                holdings = {}
        return report(registry, holdings)

    smartness_lock = asyncio.Lock()

    async def smartness_report():
        from worker.smartness import read_report, public_report
        registry = await universe_registry()
        async with smartness_lock:
            await smartness_volume.reload.aio()
            report = read_report('/smartness')
        return public_report(report, registry)

    @web_app.get('/api/smartness')
    async def get_smartness():
        return JSONResponse(await smartness_report(), headers={'cache-control':'no-store'})

    @web_app.post('/api/smartness/refresh')
    async def refresh_smartness():
        import time
        current = await smartness_report()
        if current.get('scanning'):
            return JSONResponse({'requested':True,'startedAt':current.get('scanStartedAt')}, status_code=202, headers={'cache-control':'no-store'})
        if current.get('attemptedAt') and not current.get('scanning') and 0 <= time.time() * 1000 - current['attemptedAt'] < 240000:
            return JSONResponse({'requested':False}, headers={'cache-control':'no-store'})
        # The single writer also enforces a four-minute collection cooldown.
        await collect_smartness.spawn.aio()
        return JSONResponse({'requested':True,'startedAt':int(time.time()*1000)}, status_code=202, headers={'cache-control':'no-store'})

    @web_app.get('/api/smart-seeding')
    async def get_smart_seeding():
        import time
        from worker.smart_seeding import load, public_report
        await smart_volume.reload.aio()
        value = public_report(load('/smart'), int(time.time() * 1000))
        lease = await balance_requests.get.aio('balance-writer', None)
        heartbeat = await balance_requests.get.aio('balance-heartbeat', {})
        value['queued'] = bool(lease and 0 <= value['now'] - max(lease.get('requestedAt', 0), heartbeat.get('at', 0)) < 1800000)
        return JSONResponse(value, headers={'cache-control':'no-store'})

    @web_app.post('/api/smart-seeding/refresh')
    async def refresh_smart_seeding():
        requested = await asyncio.to_thread(dispatch_smart_collection)
        return JSONResponse(dict(requested=requested), status_code=202, headers={'cache-control':'no-store'})

    @web_app.post('/api/smart-seeding/inspect')
    async def inspect_seed(request: Request):
        import time
        from worker.smart_seeding import valid_token
        body = await request.body()
        if len(body) > 300:
            raise HTTPException(status_code=400, detail='Invalid token request')
        try:
            value = json.loads(body)
            token = value.get('token')
            if not valid_token(token, include_quotes=True):
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(status_code=400, detail='Choose a Solana token')
        await balance_watches.put.aio(token + ':universe', dict(token=token, scope='universe', requestedAt=int(time.time() * 1000)))
        await asyncio.to_thread(dispatch_smart_collection)
        return JSONResponse(dict(requested=True), status_code=202, headers={'cache-control':'no-store'})

    @web_app.get('/api/wallet-universe')
    async def get_wallet_universe(metadata: bool = False):
        value = dict(version=1, wallets=await universe_registry()) if metadata else await universe_report()
        return JSONResponse(value, headers={'cache-control': 'no-store'})

    @web_app.post('/api/wallet-universe')
    @web_app.patch('/api/wallet-universe')
    async def save_universe_wallet(request: Request):
        import time
        from worker.wallet_universe import validate_entry, merge_import
        body = await request.body()
        if len(body) > 4000:
            raise HTTPException(status_code=400, detail='Wallet request too large')
        try:
            value = json.loads(body)
            address = value.get('address')
            current = next((row for row in await universe_registry() if row['address'] == address), None)
            merging = request.method == 'POST' and value.get('merge') is True
            if request.method == 'POST' and current and not merging:
                raise HTTPException(status_code=409, detail='Wallet already in the universe. Use Edit.')
            if request.method == 'PATCH' and not current:
                raise HTTPException(status_code=404, detail='Wallet not found')
            row = merge_import(current, value) if merging else validate_entry(dict(current or {}, **value))
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(status_code=400, detail='Enter a name, valid Solana address, source and optional class')
        now = int(time.time() * 1000)
        row.update(addedAt=current.get('addedAt') if current else now, updatedAt=now)
        if request.method == 'POST' and not current:
            added = await wallet_universe_registry.put.aio(row['address'], row, skip_if_exists=True)
            if not added:
                raise HTTPException(status_code=409, detail='Wallet already added')
        else:
            await wallet_universe_registry.put.aio(row['address'], row)
        return JSONResponse({'wallet': row}, status_code=201 if request.method == 'POST' and not current else 200, headers={'cache-control':'no-store'})

    candidate_cache = {}
    candidate_lock = asyncio.Lock()

    @web_app.get('/api/wallet-candidates')
    async def wallet_candidates(token: str = ''):
        import time
        from worker.wallet_discovery import discover, valid_address
        if not token:
            from worker.data_stream import read as read_stream
            await stream_volume.reload.aio()
            stream = read_stream('/stream')
            selected = stream.get('windows', {}).get('1h', {}).get('tokens', [])
            return JSONResponse(dict(tokens=[dict(address=row['contract_address'], symbol=row.get('symbol'))
                for row in selected if row['network'] == 'solana'][:15], checkedAt=stream.get('updatedAt'),
                source='Shared 1h token stream'), headers={'cache-control': 'no-store'})
        if token:
            try:
                valid_address(token)
            except ValueError:
                raise HTTPException(status_code=400, detail='Enter a valid Solana token contract')
        from worker.data_stream import read as read_stream
        await stream_volume.reload.aio()
        shared = read_stream('/stream').get('holderReports', {}).get(token)
        if shared and 0 <= time.time() * 1000 - shared.get('checkedAt', 0) < 300000:
            return JSONResponse(shared, headers={'cache-control':'no-store'})
        async with candidate_lock:
            cached = candidate_cache.get(token)
            if cached and time.time() * 1000 - cached['checkedAt'] < 300000:
                return JSONResponse(cached, headers={'cache-control': 'no-store'})
            try:
                result = await asyncio.to_thread(discover, token)
            except Exception:
                raise HTTPException(status_code=503, detail='Public discovery provider unavailable or rate limited. Retry later or paste a wallet list.')
            if len(candidate_cache) >= 200:
                candidate_cache.pop(next(iter(candidate_cache)))
            candidate_cache[token] = result
            return JSONResponse(result, headers={'cache-control': 'no-store'})

    activity_cache = {}
    activity_lock = asyncio.Lock()

    @web_app.get('/api/data-stream/sources')
    async def data_source_health():
        from worker.source_stream import source_metrics
        await source_volume.reload.aio()
        return JSONResponse(dict(version=1, sources=source_metrics('/sources'),
            note='Committed cache counters; warm source processes checkpoint every 30 seconds.'), headers={'cache-control':'no-store'})

    @web_app.get('/api/publisher/{source_id}')
    async def publisher_source(source_id: str):
        from worker.publisher_feed import SOURCES
        if source_id not in SOURCES:
            raise HTTPException(status_code=404, detail='Unknown publisher source')
        try:
            report = await read_social_source.remote.aio(SOURCES[source_id])
        except Exception:
            raise HTTPException(status_code=503, detail='Shared publisher feed unavailable')
        return JSONResponse(report['value'], headers={'cache-control':'no-store', 'x-data-observed-at':str(report['observedAt'])})

    @web_app.get('/api/data-stream')
    async def data_stream(window: str = '1h'):
        from worker.data_stream import read as read_stream, public_view
        if window not in ('5m', '1h', '6h', '24h'):
            raise HTTPException(status_code=400, detail='Choose 5m, 1h, 6h or 24h')
        await stream_volume.reload.aio()
        report = public_view(read_stream('/stream'), window)
        return JSONResponse(report, headers={'cache-control': 'no-store'})

    @web_app.get('/api/wallet-activity')
    async def wallet_activity(address: str):
        import time
        from worker.wallet_activity import analyze
        if not any(row['address'] == address for row in await universe_registry()):
            raise HTTPException(status_code=404, detail='Choose a wallet in the universe')
        async with activity_lock:
            cached = activity_cache.get(address)
            if cached and time.time() * 1000 - cached['checkedAt'] < 300000:
                return JSONResponse(cached, headers={'cache-control':'no-store'})
            result = await asyncio.to_thread(analyze, address)
            activity_cache[address] = result
            return JSONResponse(result, headers={'cache-control':'no-store'})

    @web_app.get('/api/followed-wallets')
    async def followed_wallets():
        report = await universe_report()
        report['wallets'] = [row for row in report['wallets'] if row['interested']]
        return JSONResponse(report, headers={'cache-control':'no-store'})

    @web_app.get("/api/smart-wallets")
    async def smart_wallets(token: str = '', scope: str = 'universe'):
        import time
        from worker.smart_wallets import make_cohort, group, read_report, needs_refresh
        try:
            cohort = make_cohort(token, await universe_registry(), scope) if token else group()
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        # Reads must not wait behind the single writer's RPC budget or other tokens.
        await smart_volume.reload.aio()
        report = read_report('/smart', cohort)
        now = int(time.time() * 1000)
        watch_scope = scope if token else 'legacy'
        await balance_watches.put.aio(cohort['token'] + ':' + watch_scope,
                                     dict(token=cohort['token'], scope=watch_scope, requestedAt=now))
        from worker.smart_seeding import load
        policy = load('/smart')['tokens'].get(cohort['token'], {})
        pending = needs_refresh(report, now) or policy.get('mode') == 'dormant'
        if pending:
            try:
                await asyncio.to_thread(dispatch_smart_collection)
            except Exception:
                report['error'] = 'Could not request a balance refresh. Saved observations are retained.'
        report['collectionPolicy'] = {k: v for k, v in policy.items() if k != 'zeroDays'}
        report['refreshing'] = pending
        return JSONResponse(report, headers={"cache-control": "no-store"})

    @web_app.post("/api/followed-wallets")
    async def add_followed_wallet(request: Request):
        from worker.followed_wallets import validate_wallet, registry_wallets, awaiting
        body = await request.body()
        if len(body) > 2000:
            raise HTTPException(status_code=400, detail="Wallet request too large")
        try:
            row = validate_wallet(json.loads(body))
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Enter a name (1 to 80 characters), valid Solana address and supported class")
        if any(entry['address'] == row['address'] for entry in registry_wallets()):
            raise HTTPException(status_code=409, detail="This wallet is already tracked")
        added = await tracked_wallet_registry.put.aio(row['address'], row, skip_if_exists=True)
        if not added:
            raise HTTPException(status_code=409, detail="This wallet is already tracked")
        return JSONResponse({"wallet": awaiting([row])["wallets"][0]}, status_code=201,
                            headers={"cache-control": "no-store"})

    @web_app.get("/api/runner-mode")
    async def runner_mode():
        from worker.runner_mode import public_report
        async with history_lock:
            await history_volume.reload.aio()
            try:
                saved = json.loads(Path('/history/runner-mode.json').read_text())
            except (FileNotFoundError, ValueError):
                saved = None
        return JSONResponse(public_report(saved), headers={'cache-control': 'no-store'})

    async def saved_meme_report():
        async with history_lock:
            await history_volume.reload.aio()
            from worker.meme_index import public_report
            report = {"version": 2, "basket": [], "readings": [], "error": "Awaiting first collection"}
            for name in ('meme-index.public.json','meme-index.json'):
                try:
                    saved = json.loads(Path('/history',name).read_text(encoding='utf-8'))
                    report = public_report(saved)
                    break
                except (OSError, ValueError):
                    continue
        return report

    async def active_meme_preset():
        from worker.meme_preset import read_config
        try:
            return read_config(await meme_preset_registry.get.aio('active', None))
        except Exception:
            raise HTTPException(status_code=503, detail='Saved Meme basket is unavailable. Retry without changing the basket.')

    @web_app.get('/api/meme-preset')
    async def get_meme_preset():
        from worker.meme_preset import admin_report
        config = await active_meme_preset()
        return JSONResponse(admin_report(config, await saved_meme_report()), headers={'cache-control': 'no-store'})

    @web_app.put('/api/meme-preset')
    async def put_meme_preset(request: Request):
        from worker.meme_preset import admin_report
        body = await request.body()
        if len(body) > 20000:
            raise HTTPException(status_code=400, detail='Basket request too large')
        try:
            payload = json.loads(body)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail='Enter a valid basket request')
        try:
            result = await update_meme_preset.remote.aio(payload)
        except Exception:
            raise HTTPException(status_code=503, detail='Could not save the Meme basket. Reload the saved basket before retrying.')
        if result['status'] != 200:
            return JSONResponse(result['body'], status_code=result['status'], headers={'cache-control': 'no-store'})
        saved = admin_report(result['body'], await saved_meme_report())
        saved['refreshRequested'] = result['body'].get('refreshRequested', False)
        return JSONResponse(saved, headers={'cache-control': 'no-store'})

    @web_app.post('/api/meme-preset/suggest')
    async def suggest_meme_preset():
        config = await active_meme_preset()
        try:
            result = await pull_meme_suggestions.remote.aio(config)
        except Exception:
            raise HTTPException(status_code=503, detail='FOMO ranking is unavailable. Your basket is unchanged.')
        return JSONResponse(result['body'], status_code=result['status'], headers={'cache-control': 'no-store'})

    @web_app.get('/api/meme-index')
    async def meme_index():
        from worker.meme_preset import project_report
        config = await active_meme_preset()
        return JSONResponse(project_report(await saved_meme_report(), config), headers={'cache-control': 'no-store'})

    @web_app.get("/api/jeanphil-monitor")
    async def jeanphil_monitor():
        async with history_lock:
            await history_volume.reload.aio()
            try:
                report = json.loads(Path("/history/jeanphil-monitor.json").read_text())
            except (FileNotFoundError, ValueError):
                report = {"version": 1, "id": "solana:GTBxUiw6wJdmmkCGZgRHLyYxqu1vG4KtRpeox6yDpump", "market": [], "social": []}
        return JSONResponse(report, headers={"cache-control": "no-store"})

    @web_app.post("/api/coin-evidence")
    async def coin_evidence(request: Request):
        try:
            token_id = (await request.json()).get("id", "")
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="Invalid token request")
        if not isinstance(token_id, str) or not re.fullmatch(
            r"solana:[1-9A-HJ-NP-Za-km-z]{32,44}|(?:base|robinhood|bsc):0x[a-fA-F0-9]{40}", token_id
        ):
            raise HTTPException(status_code=400, detail="Invalid token ID")
        try:
            report = await collect_coin_evidence.remote.aio(token_id)
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Coin RSS evidence is temporarily unavailable.") from exc
        return JSONResponse(report, headers={"cache-control": "no-store"})

    @web_app.get("/api/coin-context")
    async def coin_context(request: Request):
        token_id = request.query_params.get("id", "")
        if not re.fullmatch(
            r"solana:[1-9A-HJ-NP-Za-km-z]{32,44}|(?:base|robinhood|bsc):0x[a-fA-F0-9]{40}", token_id
        ):
            raise HTTPException(status_code=400, detail="Invalid token ID")
        snapshot = await load_snapshot()
        coin = next((row for field in ("coins", "radarCoins") for row in snapshot.get(field, [])
                     if row.get("id") == token_id), None)
        return JSONResponse({"id": token_id, "context": coin.get("savedContext") if coin else None},
                            headers={"cache-control": "no-store"})

    @web_app.get("/api/new-coins/version")
    async def new_coins_version():
        async with history_lock:
            await history_volume.reload.aio()
            main = Path("/history/coins.json")
            sidecar = Path("/history/coins.version.json")
            if sidecar.exists() and main.exists() and sidecar.stat().st_mtime_ns >= main.stat().st_mtime_ns:
                try:
                    version = json.loads(sidecar.read_text())
                except (OSError, ValueError):
                    version = snapshot_version(json.loads(main.read_text()))
            elif main.exists():
                version = snapshot_version(json.loads(main.read_text()))
            else:
                version = {"revision": "0", "lastRun": None}
        return JSONResponse(version, headers={"cache-control": "no-store"})

    @web_app.get("/api/new-coins")
    async def new_coins(request: Request):
        view = request.query_params.get("view", "")
        hours_text = request.query_params.get("hours", "120")
        if view == "coin" and hours_text not in ("1", "6", "12", "36", "120"):
            raise HTTPException(status_code=400, detail="Choose a supported Snipe time window")
        async with history_lock:
            # Refresh the mounted revision before choosing its cheap projection.
            # Otherwise a warm container can keep serving an internally coherent
            # old main/projection pair indefinitely. Fallback shares this reload.
            await history_volume.reload.aio()
            if view in ("coin", "health", "catalog", "tweet"):
                main = Path("/history/coins.json")
                projection = Path(f"/history/coins.snipe.v2.{hours_text}.json") if view == "coin" else Path({
                    "catalog": "/history/coins.catalog.v2.json", "health": "/history/coins.health.json",
                    "tweet": "/history/coins.tweet.json",
                }[view])
                if main.exists() and projection.exists() and projection.stat().st_mtime_ns >= main.stat().st_mtime_ns:
                    return Response(projection.read_bytes(), media_type="application/json",
                                    headers={"cache-control": "no-store"})
            snapshot = loaded_snapshot()
        try:
            payload = snapshot_view(snapshot, view, request.query_params.getlist("id"), name=request.query_params.get("name", ""), hours=int(hours_text) if view == "coin" else 120)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return JSONResponse(payload, headers={"cache-control": "no-store"})

    @web_app.get("/api/pool-catalog")
    async def pool_catalog(request: Request):
        query = request.query_params.get("query", "").strip().lower()
        if not re.fullmatch(r"0x[0-9a-f]{40}|0x[0-9a-f]{64}", query):
            raise HTTPException(status_code=400, detail="Use a Robinhood token contract or pool ID")
        async with history_lock:
            await history_volume.reload.aio()
            db_path = Path("/history/robinhood-pools.sqlite")
            if not db_path.exists():
                return JSONResponse({"network": "robinhood", "query": query, "pools": [], "total": 0}, headers={"cache-control": "no-store"})
            connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            try:
                rows = connection.execute(
                    "SELECT source, pool, token0, token1, block, tx_hash FROM pools WHERE token0=? OR token1=? OR pool=? ORDER BY block DESC LIMIT 50",
                    (query, query, query),
                ).fetchall()
            finally:
                connection.close()
        pools = [dict(zip(("source", "pool", "token0", "token1", "block", "txHash"), row)) for row in rows]
        return JSONResponse({"network": "robinhood", "query": query, "pools": pools, "total": len(pools)}, headers={"cache-control": "no-store"})
    dist = Path(REMOTE_DIST)
    allowed_types = {
        ".svg": "image/svg+xml",
        ".xml": "application/xml",
        ".txt": "text/plain; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
    }

    @web_app.get("/api/market/{market_path:path}")
    async def market_proxy(market_path: str, request: Request):
        path = "/" + market_path
        is_search = path == "/search/pools"
        is_pools = bool(re.fullmatch(r"/networks/[a-z0-9_-]{1,40}/tokens/[a-zA-Z0-9]{1,100}/pools", path))
        is_info = bool(re.fullmatch(r"/networks/(solana|base|robinhood|bsc)/tokens/[a-zA-Z0-9]{1,100}/info", path))
        is_new_pools = bool(re.fullmatch(r"/networks/[a-z0-9_-]{1,40}/new_pools", path))
        is_trades = bool(re.fullmatch(r"/networks/[a-z0-9_-]{1,40}/pools/[a-zA-Z0-9]{1,100}/trades", path))
        is_candles = bool(re.fullmatch(r"/networks/[a-z0-9_-]{1,40}/pools/[a-zA-Z0-9]{1,100}/ohlcv/minute", path))
        if not (is_search or is_pools or is_info or is_new_pools or is_trades or is_candles):
            raise HTTPException(status_code=404, detail="Unknown market endpoint")

        supplied = set(request.query_params.keys())
        allowed = {"aggregate", "limit", "currency", "token"} if is_candles else {"query", "include"}
        if supplied - allowed:
            raise HTTPException(status_code=404, detail="Unsupported query parameter")
        params = {}
        if is_candles:
            query = request.query_params
            if (query.get("aggregate") != "15" or query.get("limit") != "1000"
                    or query.get("currency") != "usd"
                    or not re.fullmatch(r"[a-zA-Z0-9]{1,100}", query.get("token", ""))):
                raise HTTPException(status_code=400, detail="Invalid candle query")
            params = {"aggregate": "15", "limit": "1000", "currency": "usd", "token": query["token"]}
        if is_search:
            query = request.query_params.get("query", "").strip()
            if not query or len(query) > 160:
                raise HTTPException(status_code=400, detail="Invalid search query")
            params["query"] = query
        if is_search or is_pools or is_new_pools:
            params["include"] = "base_token,quote_token"

        status, content, provider_headers = await market_cache.get(path + ("?" + urlencode(params) if params else ""))
        headers = {"cache-control": "public, max-age=300" if is_info and status == 200 else "no-store", "x-content-type-options": "nosniff"}
        headers.update(provider_headers)
        return Response(content, status_code=status, media_type="application/json", headers=headers)

    @web_app.get('/api/dex/{dex_path:path}')
    async def dex_source(dex_path: str, request: Request):
        if dex_path == 'token-profiles/latest/v1' and not request.query_params:
            network, addresses = 'profiles', []
        elif dex_path == 'latest/dex/search' and set(request.query_params) == {'q'}:
            query = request.query_params['q'].strip()
            if not 1 <= len(query) <= 160:
                raise HTTPException(status_code=400, detail='Invalid market search')
            network, addresses = 'search', [query]
        else:
            match = re.fullmatch(r'(?:tokens/v1|token-pairs/v1)/([a-z0-9_-]+)/([A-Za-z0-9,]{20,3100})', dex_path)
            if not match or request.query_params:
                raise HTTPException(status_code=404, detail='Unknown token market endpoint')
            network, addresses = match[1], match[2].split(',')
        try:
            report = await read_market_source.remote.aio(network, addresses,
                scope='profiles' if network == 'profiles' else 'pools' if dex_path.startswith('token-pairs/v1/') else 'quotes')
        except Exception:
            raise HTTPException(status_code=503, detail='Shared token market source unavailable')
        return JSONResponse(report['value'], headers={'cache-control':'no-store', 'x-data-observed-at':str(report['observedAt'])})

    @web_app.get('/api/gecko/{market_path:path}')
    async def shared_gecko(market_path: str, request: Request):
        from worker.source_stream import gecko_path
        try:
            path = gecko_path('/' + market_path + ('?' + str(request.query_params) if request.query_params else ''))
        except ValueError:
            raise HTTPException(status_code=404, detail='Unknown market source endpoint')
        reply = await read_gecko_source.remote.aio(path, workload='background')
        return JSONResponse(reply['body'], status_code=reply['status'], headers={
            'cache-control':'no-store', **({'x-source-deferred':'1'} if reply.get('deferred') else {}),
            **({'retry-after':str(reply['retryAfter'])} if 'retryAfter' in reply else {})})

    from worker.context_source import SOURCES as context_sources, context_target

    async def common_context(target):
        try:
            target, _ = context_target(target)
        except ValueError:
            raise HTTPException(status_code=400, detail='Unsupported context source')
        try:
            report = await read_context_source.remote.aio(target)
        except Exception:
            raise HTTPException(status_code=502, detail='Context source unavailable')
        return Response(report['value'], media_type='text/plain; charset=utf-8',headers={
            'cache-control':'no-store','x-data-observed-at':str(report['observedAt']),
            'x-content-type-options':'nosniff'})

    @web_app.get('/api/context/read')
    async def context_read(url: str):
        return await common_context(url)

    @web_app.get("/api/context/source/{source_id}")
    async def context_source(source_id: str):
        if source_id not in context_sources:
            raise HTTPException(status_code=404, detail="Unknown story source")
        return await common_context('https://r.jina.ai/' + context_sources[source_id])

    @web_app.get("/api/context/search")
    async def context_search(request: Request):
        name = request.query_params.get("name", "").strip()
        symbol = request.query_params.get("symbol", "").strip()
        contract = request.query_params.get("contract", "").strip()
        if not (1 <= len(name) <= 100 and 1 <= len(symbol) <= 32 and re.fullmatch(r"[A-Za-z0-9]{20,100}", contract)):
            raise HTTPException(status_code=400, detail="Invalid token context query")
        mode = request.query_params.get("mode", "story")
        search = f'"{contract}"' if mode == "contract" else f'"{name}" {symbol} meme origin story'
        target = "https://r.jina.ai/http://html.duckduckgo.com/html/?" + urlencode({"q": search})
        return await common_context(target)

    @web_app.api_route("/{asset_path:path}", methods=["GET", "HEAD"])
    async def static_app(asset_path: str, request: Request):
        if asset_path in {"guide", "guide.html"}:
            return RedirectResponse(url="/model", status_code=308)
        routes = {
            "": "order-flow.html",
            "narratives": "narratives.html",
            "narrative": "narrative.html",
            "new-coins": "new-coins.html",
            "radar": "radar.html",
            "watchlist": "watchlist.html",
            "sources": "sources.html",
            "jeanphil": "jeanphil.html",
            "about": "about.html",
            "model": "model.html",
            "meme-101": "meme-101.html",
            "meme-101a": "meme-101.html",
            "meme-101b": "meme-101b.html",
            "meme-101c": "meme-101c.html",
            "meme-303": "meme-303.html",
            "meme-303a": "meme-303a.html",
            "meme-303b": "meme-303b.html",
            "learn": "learn.html",
            "meme-202a": "meme-202a.html",
            "meme-202b": "meme-202b.html",
            "privacy": "privacy.html",
            "terms": "terms.html",
        }
        asset_path = re.sub(r"^_assets/[a-zA-Z0-9_-]+/", "", asset_path)
        relative = routes.get(asset_path, asset_path)
        candidate = (dist / relative).resolve()
        if dist.resolve() not in candidate.parents or not candidate.is_file() or candidate.suffix not in allowed_types:
            raise HTTPException(status_code=404, detail="Not found")
        etag = f'"{ASSET_REVISION}-{candidate.name}"'
        headers = {"cache-control": "no-cache", "etag": etag,
                   "x-content-type-options": "nosniff", "x-meme-fast-revision": ASSET_REVISION}
        if candidate.name == "macro.html":
            from worker.macro_bootstrap import render_macro_bootstrap
            from worker.macro_review import public_report
            from worker.asset_revision import version_html_assets
            source = candidate.read_text(encoding="utf-8")
            try:
                await macro_volume.reload.aio()
                source = render_macro_bootstrap(source, public_report(json.loads(Path('/macro/review.json').read_text(encoding='utf-8'))))
            except Exception:
                # Persistence outages must not prevent the static shell and API fallback.
                source = candidate.read_text(encoding="utf-8")
            headers['cache-control'] = 'no-store'
            headers.pop('etag', None)
            return Response(version_html_assets(source, ASSET_REVISION), media_type='text/html', headers=headers)
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
        if candidate.suffix == ".html":
            from worker.asset_revision import version_html_assets
            return Response(
                version_html_assets(candidate.read_text(encoding="utf-8"), ASSET_REVISION),
                media_type=allowed_types[candidate.suffix], headers=headers,
            )
        return FileResponse(
            candidate,
            media_type=allowed_types[candidate.suffix],
            headers=headers,
        )

    return web_app
