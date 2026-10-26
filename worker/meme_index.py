"""Hourly readings for a fixed, equally weighted preset of exact contracts."""
import json
import math
import time
from pathlib import Path

from worker.meme_preset import default_config, method_for, validate_members, validate_admissions

HOUR = 3_600_000
MAX_QUOTE_AGE = 15*60_000
PRESET = tuple(default_config()['members'])
METHOD = method_for(PRESET)
# An unverified extreme withholds the fixed basket; it is never clipped or zeroed.
EXTREME_RETURN = 10_000

ALT_EXCLUDE = {'BTC', 'ETH', 'USDT', 'USDC', 'DAI', 'USDE', 'PYUSD', 'FDUSD', 'TUSD',
               'USDD', 'FRAX', 'USDS', 'USD1', 'RLUSD', 'WBTC', 'WETH', 'STETH',
               'WSTETH', 'BETH', 'PAXG', 'XAUT'}


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) and value > 0 else None
    except (TypeError, ValueError):
        return None


def alt_observation(rows, now):
    """One-hour cap-weighted return of 25 large alts from a bounded 50-row feed."""
    btc_change = None
    for row in rows:
        if str(row.get('id')) == '90' and row.get('symbol') == 'BTC':
            try:
                value = float(row['percent_change_1h'])
                if math.isfinite(value) and value > -100:
                    btc_change = value
            except (KeyError, TypeError, ValueError):
                pass
            break
    eligible = []
    for row in rows:
        cap = number(row.get('market_cap_usd'))
        try:
            change = float(row['percent_change_1h'])
        except (TypeError, ValueError, KeyError):
            continue
        if (row.get('symbol') in ALT_EXCLUDE or not cap or not math.isfinite(change)
                or change <= -90):
            continue
        eligible.append((row, cap, change))
    selected = sorted(eligible, key=lambda item: int(item[0].get('rank') or 1_000_000))[:25]
    if len(selected) != 25:
        raise ValueError('Broad-alt one-hour sample incomplete')
    current = sum(cap for _, cap, _ in selected)
    prior = sum(cap / (1 + change / 100) for _, cap, change in selected)
    return {'value': current, 'hourChange': (current / prior - 1) * 100,
            'providerAt': now, 'source': 'CoinLore top 25 alts', 'btcDelta': btc_change}


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def member_id(member):
    return member['network'] + ':' + member['contract_address']


def quote_reason(row, now):
    """A preset member stays present even when its one-hour input cannot be used."""
    at, change = row.get('observedAt'), row.get('priceChange1h')
    if not finite(at):
        return 'missing_observation'
    if not 0 <= now-at < MAX_QUOTE_AGE:
        return 'stale_quote'
    if change is None:
        return 'missing_return'
    if not finite(change) or change < -100:
        return 'invalid_return'
    if not isinstance(row.get('pool'), str) or not row['pool'].strip():
        return 'missing_pool'
    created = row.get('poolCreatedAt')
    if not finite(created) or not 0 < created <= at:
        return 'unknown_pool_age'
    if at-created < HOUR:
        return 'incomplete_1h_window'
    if change > EXTREME_RETURN:
        return 'unverified_extreme_return'
    return None


def normalize_pair(pair, observed_at, now):
    # A malformed per-pair timestamp must not be replaced with the receipt time.
    at = pair.get('_sourceObservedAt', observed_at)
    changes = pair.get('priceChange') if isinstance(pair.get('priceChange'), dict) else {}
    liquidity = pair.get('liquidity') if isinstance(pair.get('liquidity'), dict) else {}
    row = dict(observedAt=at, priceChange1h=changes.get('h1'),
               pool=pair.get('pairAddress'), poolCreatedAt=pair.get('pairCreatedAt'),
               marketSource='DexScreener', liquidity=liquidity.get('usd'))
    row['exclusionReason'] = quote_reason(row, now)
    # JSON cannot preserve NaN/Infinity; retain finite raw extremes unchanged.
    for field in ('observedAt', 'poolCreatedAt', 'priceChange1h', 'liquidity'):
        value = row[field]
        if type(value) in (int, float) and not math.isfinite(value):
            row[field] = None
    return row


def exact_pairs(reply, member, now):
    if not isinstance(reply, dict) or not isinstance(reply.get('value'), list):
        raise ValueError('Malformed shared market reply')
    network, address = member['network'], member['contract_address']
    canonical = lambda value: value if network == 'solana' else value.lower()
    rows = []
    for pair in reply['value']:
        if not isinstance(pair, dict) or pair.get('chainId') != network:
            continue
        base = pair.get('baseToken')
        candidate = base.get('address') if isinstance(base, dict) else None
        if isinstance(candidate, str) and canonical(candidate) == canonical(address):
            rows.append(normalize_pair(pair, reply.get('observedAt'), now))
    return rows


def best_pair(rows):
    """Prefer a complete full-hour quote before comparing liquidity."""
    qualified = [row for row in rows if row['exclusionReason'] is None]
    def order(row):
        liquidity = row.get('liquidity')
        return (-(liquidity if finite(liquidity) and liquidity >= 0 else 0), str(row.get('pool') or ''))
    return min(qualified or rows, key=order) if rows else None


class Sources:
    def __init__(self, directory=None, quotes=None, preset=None, history=None):
        # The callable is the existing source owner (or the local preview proxy),
        # never an independent provider request or a ranking-derived token list.
        self.quotes = quotes
        self.history = history
        self.preset = tuple(validate_members(PRESET if preset is None else preset))

    def fixed_quotes(self, now=None):
        # In live collection a provider request can finish after the job starts.
        # Validate against the clock after the reply, keeping source times intact.
        clock = (lambda: int(time.time()*1000)) if now is None else (lambda: now)
        groups = {}
        for member in self.preset:
            groups.setdefault(member['network'], []).append(member['contract_address'])
        batches = {}
        for network, addresses in groups.items():
            try:
                if self.quotes is None:
                    raise ValueError('Shared preset market source unavailable')
                batches[network] = self.quotes(network, addresses, scope='quotes')
            except Exception:
                batches[network] = None
        observations = []
        for member in self.preset:
            unavailable = batches[member['network']] is None
            try:
                candidates = exact_pairs(batches[member['network']], member, clock())
            except Exception:
                candidates, unavailable = [], True
            selected = best_pair(candidates)
            if selected is None or selected['exclusionReason'] is not None:
                # The batch endpoint can omit secondary pools. Ask the same
                # cached source owner only for this unresolved exact contract.
                try:
                    reply = self.quotes(member['network'], [member['contract_address']], scope='pools')
                    candidates.extend(exact_pairs(reply, member, clock()))
                    unavailable = False
                except Exception:
                    pass
                selected = best_pair(candidates)
            observations.append(dict(id=member_id(member), **(selected or dict(
                observedAt=None, priceChange1h=None, pool=None, poolCreatedAt=None,
                marketSource='DexScreener', liquidity=None,
                exclusionReason='source_unavailable' if unavailable else 'missing_quote'))))
        return observations

    def alt(self, now):
        import httpx
        with httpx.Client(timeout=12) as client:
            response = client.get('https://api.coinlore.net/api/tickers/', params={'start':0,'limit':50})
            response.raise_for_status()
            return alt_observation(response.json()['data'],now)


def proxy_quotes(base_url):
    """Local preview adapter; the proxy keeps request ownership and source times."""
    from urllib.parse import urlsplit
    target = urlsplit(base_url)
    if target.scheme not in ('http', 'https') or target.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('Use the local shared market proxy URL')
    def read_quotes(network, addresses, scope='quotes'):
        import httpx
        route = 'token-pairs/v1' if scope == 'pools' else 'tokens/v1'
        if scope not in ('quotes', 'pools') or scope == 'pools' and len(addresses) != 1:
            raise ValueError('Invalid preset market source scope')
        response = httpx.get(base_url.rstrip('/')+'/'+route+'/'+network+'/'+','.join(addresses),timeout=25)
        response.raise_for_status()
        try:
            observed_at = float(response.headers.get('x-data-observed-at', ''))
            if not math.isfinite(observed_at):
                observed_at = None
        except (ValueError, TypeError):
            observed_at = None
        return dict(value=response.json(), observedAt=observed_at)
    return read_quotes


def proxy_history(base_url):
    """Use only the local shared history proxy, preserving its receipt time."""
    from urllib.parse import urlsplit
    target = urlsplit(base_url)
    if target.scheme not in ('http', 'https') or target.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('Use the local shared history proxy URL')
    def read_history(path, workload='background'):
        import httpx
        from worker.source_stream import gecko_path
        response = httpx.get(base_url.rstrip('/')+gecko_path(path), timeout=35)
        body = response.json()
        if isinstance(body, dict) and '_sourceObservedAt' not in body:
            try:
                observed_at = float(response.headers.get('x-data-observed-at', ''))
                if math.isfinite(observed_at):
                    body = dict(body, _sourceObservedAt=observed_at)
            except (TypeError, ValueError):
                pass
        return dict(status=response.status_code, body=body)
    return read_history


def collect(path, sources=None, now=None, preset=None, admissions=None):
    live = now is None
    now = int(time.time()*1000) if live else now
    using_default = preset is None
    preset = tuple(validate_members(preset if preset is not None else getattr(sources, 'preset', PRESET)))
    method = method_for(preset)
    sources = sources or Sources(preset=preset)
    if isinstance(sources, Sources):
        sources.preset = preset
    path = Path(path)
    try:
        report = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        report = {'version':2,'basket':[],'readings':[]}
    from worker.meme_baseline import METHOD as COMPONENT_METHOD, compare_components, identity
    prior_ids = {identity(row) for row in report.get('basket', []) if isinstance(row, dict)}
    if admissions is None:
        if using_default or not report.get('basket'):
            admissions = validate_admissions(preset)
        else:
            saved_members = (report.get('componentBaselines') or {}).get('members', {})
            admissions = {}
            for member in preset:
                key = member_id(member)
                saved = saved_members.get(key, {})
                if saved.get('kind') == 'added' and finite(saved.get('addedAt')):
                    admissions[key] = dict(kind='added', addedAt=saved['addedAt'])
                else:
                    admissions[key] = dict(kind='existing', addedAt=None) if key in prior_ids else dict(kind='added', addedAt=now)
    admissions = validate_admissions(preset, admissions)
    if report.get('method') != method:
        # Retain original inputs and results privately; never splice returns
        # from a different Meme method into this comparison. Alt/BTC remains comparable.
        legacy_method = report.get('method','fomo-most-held-v1')
        ledger = report.get('componentBaselines')
        legacy = {key:value for key,value in report.items() if key not in ('legacyMethods', 'componentBaselines')}
        archives = dict(report.get('legacyMethods',{}))
        if legacy.get('readings') or legacy.get('basket'):
            archives[legacy_method] = legacy
        report = {'version':2,'method':method,'basket':[],
                  'readings':[dict(row,method=row.get('method',legacy_method)) for row in legacy.get('readings',[])],
                  'legacyMethods':archives}
        if isinstance(ledger, dict):
            report['componentBaselines'] = ledger
    latest = next((row for row in reversed(report.get('readings',[]))
                   if row.get('method') == method),None)
    retry_unqualified = latest is not None and latest.get('meme') is None
    engine = latest.get('memeComparison') if latest else None
    engine_current = (isinstance(engine, dict) and engine.get('method') == COMPONENT_METHOD
                      and engine.get('at') == latest.get('at')
                      and isinstance(engine.get('components'), list) and len(engine['components']) == len(preset)
                      and [row.get('id') if isinstance(row, dict) else None for row in engine['components']] ==
                          [member_id(member) for member in preset]
                      and all(isinstance(row, dict) and admissions.get(row.get('id')) ==
                              dict(kind=row.get('kind'), addedAt=row.get('addedAt'))
                              for row in engine['components']))
    if report.get('updatedAt') and now//HOUR == report['updatedAt']//HOUR and not retry_unqualified and engine_current:
        write_json(path.with_suffix('.public.json'),public_report(report))
        return report
    report['attemptedAt'] = now
    try:
        rows = sources.fixed_quotes(None if live else now)
        quotes = {row['id']:row for row in rows if isinstance(row, dict) and isinstance(row.get('id'), str)}
    except Exception:
        quotes = {}
    if live:
        # The reading describes completed market collection; attemptedAt remains
        # the start time. Recheck freshness without relabeling cached quotes.
        now = int(time.time()*1000)
    basket, changes, raw_changes, exclusions = [], [], [], {}
    for member in preset:
        row = quotes.get(member_id(member))
        reason = (row.get('exclusionReason') or quote_reason(row, now)) if row is not None else 'source_unavailable'
        row = row or {}
        at, change, created = row.get('observedAt'), row.get('priceChange1h'), row.get('poolCreatedAt')
        if reason:
            exclusions[reason] = exclusions.get(reason,0)+1
        else:
            changes.append(change)
        if finite(change):
            raw_changes.append(change)
        basket.append(dict(id=member_id(member),chain=member['network'],address=member['contract_address'],
            name=member['name'],symbol=member['symbol'],weight=1/len(preset),source='fixed-preset-1h',
            priceSource=row.get('marketSource'),observedAt=at if finite(at) else None,
            priceChange1h=change if finite(change) else None,pool=row.get('pool'),
            poolCreatedAt=created if finite(created) else None,
            eligible=reason is None,exclusionReason=reason))
    comparison, ledger = compare_components(basket, report, now,
        history=getattr(sources, 'history', None), prior_ids=prior_ids,
        clock=(lambda: int(time.time()*1000)) if live else None, admissions=admissions)
    now = comparison['at']
    # Historical recovery may take time. Qualify the original market observations
    # again at completion rather than relabeling their source times.
    changes = [row['priceChange1h'] for row in basket if row['eligible']]
    exclusions = {}
    for row in basket:
        if not row['eligible']:
            reason = row['exclusionReason']
            exclusions[reason] = exclusions.get(reason, 0)+1
    complete = len(changes) == len(preset)
    average = math.fsum(changes)/len(preset) if complete else None
    coverage = dict(totalTokens=len(preset),includedTokens=len(changes),
                    excludedTokens=len(preset)-len(changes),exclusions=exclusions)
    errors = [] if complete else [f'Fixed Meme preset incomplete ({len(changes)}/{len(preset)}); reading withheld']
    try:
        alt = sources.alt(now)
    except Exception:
        alt = dict(hourChange=None,btcDelta=None,providerAt=None,source='CoinLore top 25 alts')
        errors.append('Alt/BTC provider unavailable')
    if not complete and alt.get('providerAt') is not None:
        errors.append('Alt/BTC updated independently')
    oldest = min((row['observedAt'] for row in basket if finite(row['observedAt'])),default=None)
    quality = dict(extremeReturnThreshold=EXTREME_RETURN,
                   extremeReturnCount=sum(abs(change)>EXTREME_RETURN for change in raw_changes),
                   minimumReturn=min(raw_changes,default=None),maximumReturn=max(raw_changes,default=None))
    fallback = None
    if (complete and comparison['value'] is None and comparison['awaitingHistoryMembers'] > 0
            and comparison['unavailableMembers'] == 0):
        participating = [row for row in comparison['components'] if row['status'] != 'warming']
        fallback = dict(method='incumbent-current-1h-v1',
                        value=math.fsum(row['currentReturn'] for row in participating)/len(preset),
                        memberIds=[row['id'] for row in participating], denominator=len(preset),
                        excludedWarming=comparison['warmingMembers'])
    report['readings'].append(dict(at=now,meme=average,
        altDelta=alt['hourChange'],btcDelta=alt.get('btcDelta'),method=method,
        constituents=len(preset),marketObservedAt=oldest,inputQuality=quality,coverage=coverage,
        memeComparison=comparison, memeFallback=fallback))
    report['readings'] = [row for row in report['readings'] if now-row['at'] <= 30*24*HOUR]
    report['basketHistory'] = [row for row in report.get('basketHistory',[])
                              if 0 <= now-row['at'] <= 30*24*HOUR]
    report['basketHistory'].append(dict(at=now,marketAt=oldest,tokens=basket))
    report['componentBaselines'] = ledger
    report.update(basket=basket,updatedAt=now,readingAt=now,rebalancedAt=report.get('rebalancedAt',now),
        poolUpdatedAt=oldest,marketObservedAt=oldest,altProviderAt=alt['providerAt'],
        altMethod=alt['source'],inputQuality=quality,coverage=coverage,error='; '.join(errors) or None)
    path.parent.mkdir(parents=True,exist_ok=True)
    write_json(path,report)
    write_json(path.with_suffix('.public.json'),public_report(report))
    return report


def write_json(path, report):
    temp=path.with_suffix('.tmp')
    temp.write_text(json.dumps(report,allow_nan=False),encoding='utf-8')
    temp.replace(path)


def public_report(report):
    return {key:value for key,value in report.items() if key in (
        'version','method','basket','readings','updatedAt','attemptedAt','rebalancedAt',
        'readingAt','poolUpdatedAt','marketObservedAt','altProviderAt','altMethod','inputQuality','coverage','error',
        'presetRevision','presetUpdatedAt')}


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('path')
    parser.add_argument('--stream',default='.data',help='Legacy argument; preset membership does not use the ranked stream')
    parser.add_argument('--dex-proxy',help='Local shared market proxy URL, for example http://127.0.0.1:4173/api/dex')
    parser.add_argument('--preset',help='Saved local preset configuration JSON; uses the seed when the file is absent')
    parser.add_argument('--history-proxy',help='Local shared historical market proxy URL')
    args=parser.parse_args()
    from worker.meme_preset import read_config
    try:
        config = read_config(json.loads(Path(args.preset).read_text(encoding='utf-8'))) if args.preset else default_config()
    except FileNotFoundError:
        config = default_config()
    report=collect(args.path,Sources(quotes=proxy_quotes(args.dex_proxy) if args.dex_proxy else None,
                                    preset=config['members'],
                                    history=proxy_history(args.history_proxy) if args.history_proxy else None),
                   preset=config['members'], admissions=config['admissions'])
    print(json.dumps(public_report(report)))
