"""Bounded token <-> wallet discovery and common timeframe projections.

Market rankings describe one selected pool. Holder rankings describe observed
wallets/accounts, never a claim to exhaustive ownership or investor skill.
"""
import json
import hashlib
import math
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path

WINDOWS = {'5m': ('m5', 300000, 500, 5), '1h': ('h1', 3600000, 5000, 10),
           '6h': ('h6', 21600000, 15000, 25), '24h': ('h24', 86400000, 15000, 50)}
MIN_LIQUIDITY = 3000
TOKEN_LIMIT = 60
WALLET_LIMIT = 100
HOLDER_DISCOVERY_LIMIT = 2
HISTORY_WALLET_LIMIT = 200
HISTORY_BALANCE_LIMIT = 100000
DAY = 86400000


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError):
        return None


def token_key(network, address):
    return f'{network}:{address if network == "solana" else address.lower()}'


def read(directory, full=False):
    for name in (('data-stream.json',) if full else ('data-stream.index.json','data-stream.json')):
        try:
            value = json.loads((Path(directory)/name).read_text(encoding='utf-8'))
            if value.get('version') == 1:
                return value
        except (OSError, ValueError):
            pass
    return dict(version=1, windows={}, tokens=[], wallets=[], holderReports={}, history={})


def write(directory, report):
    index = {key: value for key, value in report.items() if key not in ('history','coverageSets')}
    for name, value in (('data-stream.json',report),('data-stream.index.json',index)):
        path = Path(directory) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False), encoding='utf-8')
        temporary.replace(path)


def coverage_id(tokens, sets):
    tokens = sorted(tokens)
    identity = hashlib.sha256(json.dumps(tokens).encode()).hexdigest()[:16]
    sets[identity] = tokens
    return identity


def point_balance(point, mint, sets):
    if mint in point.get('balances', {}):
        return point['balances'][mint]
    if mint in sets.get(point.get('coverageId'), []):
        return dict(raw='0', decimals=None)
    return None


def bound_history(history, now):
    """Keep current/window anchors first, then extra measured points by recency."""
    selected = {owner: {} for owner in history}
    count = 0
    def add(owner, index):
        nonlocal count
        if index not in selected[owner]:
            point = history[owner][index]
            cost = len(point['balances'])
            if count + cost <= HISTORY_BALANCE_LIMIT:
                selected[owner][index] = point
                count += cost
    for owner, points in history.items():
        add(owner, len(points)-1)
        for _, duration, _, _ in WINDOWS.values():
            index = next((i for i in range(len(points)-1,-1,-1) if now-duration-60000 <= points[i]['at'] <= now-duration), None)
            if index is not None:
                add(owner, index)
    extra = sorted(((p['at'],owner,i) for owner,points in history.items() for i,p in enumerate(points)), reverse=True)
    for _, owner, index in extra:
        add(owner,index)
    return {owner: [points[i] for i in sorted(points)] for owner,points in selected.items() if points}


def market_tokens(snapshot, now):
    tokens = {}
    for field in ('coins', 'radarCoins', 'tweetCoins'):
        for row in snapshot.get(field, []):
            network, address = row.get('network'), row.get('contract_address')
            stamp = row.get('marketUpdatedAt') or row.get('fetchedAt') or 0
            if not network or not address or row.get('contract_verified') is False or not 0 <= now - stamp < 15 * 60000:
                continue
            key = token_key(network, address)
            if key not in tokens or stamp > (tokens[key].get('marketUpdatedAt') or tokens[key].get('fetchedAt') or 0):
                tokens[key] = row
    return tokens


def window_metrics(token, window):
    metrics = token.get('marketWindows', {}).get(WINDOWS[window][0], {})
    if not metrics and window in ('5m', '24h'):
        keys = ('volume5m', 'buys5m', 'sells5m') if window == '5m' else ('volume', 'buys', 'sells')
        metrics = dict(zip(('volume', 'buys', 'sells'), (token.get(k) for k in keys)))
    return metrics


def rank_market(tokens, window, now):
    _, _, minimum_volume, minimum_trades = WINDOWS[window]
    ranked = []
    for key, token in tokens.items():
        liquidity = number(token.get('liquidity'))
        metrics = window_metrics(token, window)
        volume, buys, sells = (number(metrics.get(k)) for k in ('volume', 'buys', 'sells'))
        if (liquidity is None or liquidity < MIN_LIQUIDITY or volume is None or volume < minimum_volume
                or buys is None or sells is None or buys + sells < minimum_trades):
            continue
        turnover = volume / liquidity
        score = math.log1p(volume) * (1 + min(turnover, 10)) * (0.5 + buys / (buys + sells))
        ranked.append(dict(id=key, network=token['network'], contract_address=token['contract_address'],
                           symbol=token.get('symbol'), name=token.get('name'), pool=token.get('pool'),
                           liquidity=liquidity, volume=volume, buys=buys, sells=sells,
                           uniqueBuyers=number(metrics.get('buyers')), turnover=turnover,
                           score=round(score, 6), observedAt=token.get('marketUpdatedAt') or token.get('fetchedAt')))
    ranked.sort(key=lambda row: (-row['score'], row['id']))
    return [dict(row, rank=index + 1) for index, row in enumerate(ranked[:TOKEN_LIMIT])]


def recent_events(ledger, now):
    seen = set()
    from worker.smart_seeding import valid_token
    for event in ledger.get('events', []):
        identity, stamp = event.get('id'), event.get('time')
        if (not identity or identity in seen or type(stamp) not in (int, float) or not 0 <= now - stamp <= DAY
                or event.get('side') not in ('buy', 'sell') or event.get('quote') not in ('SOL', 'USDC', 'USDT')
                or not valid_token(event.get('mint')) or not event.get('address')):
            continue
        try:
            quote, quantity = Decimal(str(event['quoteAmount'])), Decimal(str(event['quantity']))
            if not quote.is_finite() or not quantity.is_finite() or quote <= 0 or quantity <= 0:
                continue
        except (KeyError, InvalidOperation):
            continue
        seen.add(identity)
        yield event


def wallet_token_candidates(ledger, now):
    tokens = {}
    for event in recent_events(ledger, now):
        if event['side'] != 'buy':
            continue
        row = tokens.setdefault(event['mint'], dict(token=event['mint'], wallets=set(), lastBuyAt=0))
        row['wallets'].add(event['address'])
        row['lastBuyAt'] = max(row['lastBuyAt'], event['time'])
    return [dict(token=row['token'], buyers=len(row['wallets']), lastBuyAt=row['lastBuyAt'])
            for row in sorted(tokens.values(), key=lambda row: (-len(row['wallets']), -row['lastBuyAt'], row['token']))[:30]]


def project(snapshot, holdings, ledger, previous, now):
    tokens = market_tokens(snapshot, now)
    windows = {window: dict(tokens=rank_market(tokens, window, now), holders={}, holderCoverage={}, accumulators={}) for window in WINDOWS}
    # Interleave ranks so a busy 5m list cannot consume the entire 24h budget.
    active_ids = list(dict.fromkeys(value['tokens'][index]['id'] for index in range(TOKEN_LIMIT)
                                   for value in windows.values() if index < len(value['tokens'])))[:TOKEN_LIMIT]
    active = {key.split(':', 1)[1] for key in active_ids if key.startswith('solana:')}
    events = list(recent_events(ledger, now))
    for value in windows.values():
        value['tokens'] = [row for row in value['tokens'] if row['id'] in active_ids]
    holder_reports = {mint: report for mint, report in previous.get('holderReports', {}).items()
                      if mint in active and 0 <= now - max(report.get('checkedAt', 0), report.get('attemptedAt', 0)) < DAY}
    history, current_points = {}, {}
    coverage_sets = dict(previous.get('coverageSets', {}))
    current_coverage = coverage_id(active, coverage_sets)
    owners = {row['address']: row for row in holdings.get('wallets', [])}
    known = {row['address'] for row in previous.get('wallets', [])}
    selected_owners = set(sorted(owners, key=lambda owner: (owner not in known,
        -(owners[owner].get('observation') or {}).get('sampledAt',0),owner))[:HISTORY_WALLET_LIMIT])
    # Retain actual per-wallet observations, rather than manufactured fixed bars.
    for owner, wallet in owners.items():
        observed = wallet.get('observation') or {}
        at = observed.get('sampledAt', 0)
        points = []
        if owner in selected_owners:
            for point in previous.get('history', {}).get(owner, []):
                if not 0 <= now - point.get('at', 0) <= DAY + 600000:
                    continue
                identity = point.get('coverageId') or coverage_id(point.get('balances', {}),coverage_sets)
                points.append(dict(point, coverageId=identity,
                    balances={mint: value for mint,value in point.get('balances', {}).items() if int(value['raw']) > 0}))
        if active and observed.get('complete') is True and observed.get('owner') == owner and 0 <= now - at < 10 * 60000:
            balances = {mint: dict(raw=value['raw'],decimals=value['decimals'])
                        for mint,value in observed['balances'].items() if mint in active and int(value['raw']) > 0}
            identity = coverage_id(active - set(observed.get('omittedMints', [])), coverage_sets) if observed.get('omittedMints') else current_coverage
            current_points[owner] = dict(at=at, balances=balances, coverageId=identity)
            if owner in selected_owners and (not points or points[-1]['at'] < at):
                points.append(current_points[owner])
        if points:
            history[owner] = points[-300:]
    history = bound_history(history,now)
    for owner,points in history.items():
        if owner not in current_points or current_points[owner]['at'] < points[-1]['at']:
            current_points[owner] = points[-1]
    for key in active_ids:
        if not key.startswith('solana:'):
            continue
        mint = key.split(':', 1)[1]
        candidates = {}
        observed_wallets, observed_times = 0, []
        report = holder_reports.get(mint, {})
        if 0 <= now - report.get('checkedAt', 0) < 15 * 60000:
            observed_times.append(report['checkedAt'])
            for row in report.get('candidates', []):
                candidates[row['address']] = dict(row, observedAt=report['checkedAt'], coverage='sampled-largest-token-accounts')
        for owner, point in current_points.items():
            saved = point_balance(point,mint,coverage_sets)
            if not saved or not 0 <= now - point['at'] < 10 * 60000:
                continue
            observed_wallets += 1
            observed_times.append(point['at'])
            if owner in candidates and candidates[owner]['observedAt'] > point['at']:
                continue
            raw = saved['raw']
            if int(raw) == 0:
                candidates.pop(owner, None)
            else:
                candidates[owner] = dict(address=owner, balanceRaw=raw, decimals=saved['decimals'],
                                          observedAt=point['at'], coverage='complete-wallet-scan')
        largest = sorted(candidates.values(), key=lambda row: (-int(row['balanceRaw']), row['address']))[:100]
        for window, (_, duration, _, _) in WINDOWS.items():
            if key not in {row['id'] for row in windows[window]['tokens']}:
                continue
            windows[window]['holders'][key] = largest
            windows[window]['holderCoverage'][key] = dict(status='sampled' if observed_times else 'unavailable',
                completeWalletScans=observed_wallets, sampledLargestAccounts=report.get('sampledAccounts')
                if 0 <= now - report.get('checkedAt', 0) < 15 * 60000 else None,
                lastObservedAt=max(observed_times, default=None), exhaustive=False)
            flows = {}
            for event in events:
                if event['mint'] != mint or event['time'] < now - duration:
                    continue
                row = flows.setdefault(event['address'], dict(address=event['address'], buys=0, sells=0,
                                                             netByQuote={}, netTokenQuantity=Decimal(0), lastActivityAt=0))
                row['buys' if event['side'] == 'buy' else 'sells'] += 1
                quote = event['quote']
                row['netByQuote'][quote] = row['netByQuote'].get(quote, Decimal(0)) + Decimal(str(event['quoteAmount'])) * (1 if event['side'] == 'buy' else -1)
                row['netTokenQuantity'] += Decimal(str(event['quantity'])) * (1 if event['side'] == 'buy' else -1)
                row['lastActivityAt'] = max(row['lastActivityAt'], event['time'])
            accumulators = []
            for owner in set(flows) | set(history):
                row = flows.get(owner, dict(address=owner, buys=0, sells=0, netByQuote={},
                                             netTokenQuantity=Decimal(0), lastActivityAt=0))
                points = history.get(row['address'], [])
                baseline = next((p for p in reversed(points) if now - duration - 60000 <= p['at'] <= now - duration), None)
                current = points[-1] if points and 0 <= now - points[-1]['at'] < 10 * 60000 else None
                before = point_balance(baseline,mint,coverage_sets) if baseline else None
                after = point_balance(current,mint,coverage_sets) if current else None
                delta = str(int(after['raw']) - int(before['raw'])) if before and after else None
                if row['netTokenQuantity'] <= 0 and (delta is None or int(delta) <= 0):
                    continue
                places = after.get('decimals') if after else None
                change = Decimal(delta) / Decimal(10)**places if delta is not None and type(places) is int else None
                accumulators.append(dict(row, netByQuote={q: str(v) for q, v in row['netByQuote'].items()},
                    netTokenQuantity=str(row['netTokenQuantity']), holdingChangeRaw=delta,
                    holdingChangeQuantity=str(change) if change is not None else None,
                    baselineAt=baseline['at'] if baseline else None, balanceAt=current['at'] if current else None,
                    basis='observed-net-token-buys' if row['netTokenQuantity'] > 0 else 'holding-increase-unclassified'))
            accumulators.sort(key=lambda row: (-max(Decimal(row['netTokenQuantity']), Decimal(row['holdingChangeQuantity'] or 0)),
                                               -row['lastActivityAt'], row['address']))
            windows[window]['accumulators'][key] = accumulators[:100]
    candidate_wallets = {}
    for mint, report in holder_reports.items():
        if not 0 <= now - report.get('checkedAt', 0) < 3600000:
            continue
        for row in report.get('candidates', []):
            candidate_wallets[row['address']] = dict(address=row['address'], name=row['address'][:8],
                source='Public', sources=['Public'], smartMoney=None, interested=False, code='',
                discoveryToken=mint, lastRelevantAt=report['checkedAt'])
    for event in events:
        if event['mint'] in active:
            candidate_wallets[event['address']] = dict(candidate_wallets.get(event['address'], {}),
                address=event['address'], name=event['address'][:8], source='Public', sources=['Public'],
                smartMoney=None, interested=False, code='',
                lastRelevantAt=max(event['time'], candidate_wallets.get(event['address'], {}).get('lastRelevantAt', 0)))
    for owner, latest in current_points.items():
        if 0 <= now - latest['at'] < 10 * 60000 and any(mint in active and int(value['raw']) > 0 for mint,value in latest['balances'].items()):
            candidate_wallets[owner] = dict(candidate_wallets.get(owner, {}), address=owner, name=owner[:8],
                source='Public', sources=['Public'], smartMoney=None, interested=False, code='',
                lastRelevantAt=max(latest['at'], candidate_wallets.get(owner, {}).get('lastRelevantAt', 0)))
    for owner,wallet in owners.items():
        stamp = wallet.get('checkedAt') or 0
        if 0 <= now-stamp < 10*60000 and active.intersection(wallet.get('mints', [])):
            candidate_wallets[owner] = dict(candidate_wallets.get(owner, {}), address=owner, name=owner[:8],
                source='Public', sources=['Public'], smartMoney=None, interested=False, code='',
                lastRelevantAt=max(stamp,candidate_wallets.get(owner, {}).get('lastRelevantAt', 0)))
    wallets = sorted(candidate_wallets.values(), key=lambda row: (-row['lastRelevantAt'], row['address']))[:WALLET_LIMIT]
    return dict(version=1, updatedAt=now, marketAt=snapshot.get('lastRun'), ledgerAt=ledger.get('attemptedAt'),
        windows=windows, tokens=active_ids, wallets=wallets, holderReports=holder_reports, history=history,
        coverageSets={key: coverage_sets[key] for key in {p['coverageId'] for points in history.values() for p in points}},
        tokenCandidates=wallet_token_candidates(ledger, now),
        policy=dict(windows=list(WINDOWS), minLiquidity=MIN_LIQUIDITY, tokenLimit=TOKEN_LIMIT,
                    walletLimit=WALLET_LIMIT, holderDiscoveryPerRun=HOLDER_DISCOVERY_LIMIT,
                    historyWalletLimit=HISTORY_WALLET_LIMIT, historyBalanceLimit=HISTORY_BALANCE_LIMIT,
                    criteria={name: dict(minVolume=value[2], minTrades=value[3]) for name, value in WINDOWS.items()}),
        coverage=dict(holders='Observed wallets and sampled largest token accounts; incomplete holder coverage.',
                      accumulators='Observed classified swaps; net quote currencies are kept separate.',
                      market='One selected pool per token; provider rolling windows; launch age is unrestricted.',
                      freshMarketsByNetwork={network: sum(row['network'] == network for row in tokens.values())
                                             for network in {row['network'] for row in tokens.values()}},
                      measuredWindows={window: sum(all(number(window_metrics(row, window).get(key)) is not None
                                                       for key in ('volume','buys','sells')) for row in tokens.values())
                                       for window in WINDOWS},
                      walletNetworks=['solana']))


def collect(directory, snapshot, holdings, ledger, rpc=None, now=None):
    now = int(time.time() * 1000) if now is None else now
    previous = read(directory,full=True)
    report = project(snapshot, holdings, ledger, previous, now)
    if rpc is not None:
        from worker.wallet_discovery import holder_candidates
        eligible = [key.split(':', 1)[1] for key in report['tokens'] if key.startswith('solana:')]
        due = sorted(eligible, key=lambda mint: report['holderReports'].get(mint, {}).get('attemptedAt', 0))
        attempts = 0
        for mint in due:
            old = report['holderReports'].get(mint, {})
            if now - old.get('attemptedAt', 0) < 15 * 60000:
                continue
            attempts += 1
            try:
                report['holderReports'][mint] = dict(holder_candidates(mint, rpc, now=now), attemptedAt=now)
            except Exception as error:
                report['holderReports'][mint] = dict(old, attemptedAt=now, error=type(error).__name__)
            if attempts >= HOLDER_DISCOVERY_LIMIT:
                break
        report = project(snapshot, holdings, ledger, report, now)
    write(directory, report)
    return report


def public_view(report, window='1h', now=None):
    if window not in WINDOWS:
        raise ValueError('Choose 5m, 1h, 6h or 24h')
    now = int(time.time() * 1000) if now is None else now
    return {**{key: report.get(key) for key in ('version', 'updatedAt', 'marketAt', 'ledgerAt', 'policy', 'coverage')},
            'stale': not 0 <= now - (report.get('updatedAt') or 0) < 10 * 60000,
            'status': 'unavailable' if not report.get('coverage', {}).get('measuredWindows', {}).get(window)
                      else 'stale' if not 0 <= now - (report.get('updatedAt') or 0) < 10 * 60000 else 'ready',
            'window': window, **report.get('windows', {}).get(window, dict(tokens=[], holders={}, accumulators={}))}


def collection_wallets(registry, stream, now=None):
    now = int(time.time() * 1000) if now is None else now
    saved = {row['address']: dict(row) for row in registry}
    candidates = [row for row in stream.get('wallets', []) if 0 <= now - row.get('lastRelevantAt', 0) < DAY][:WALLET_LIMIT]
    for row in candidates:
        saved.setdefault(row['address'], dict(row))
    active = {row['address'] for row in candidates}
    for row in saved.values():
        hot = row.get('interested') or row['address'] in active
        row.update(collectionPriority=0 if hot else 1 if row.get('smartMoney') is True else 2,
                   refreshAfterMs=300000 if hot else 1800000 if row.get('smartMoney') is True else 3600000)
    return list(saved.values())
