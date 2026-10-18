"""Persistent, evidence-based SmartMoney token ranking and collection policy."""
import json
import math
from decimal import Decimal, InvalidOperation
from pathlib import Path

DAY = 86400000
AUTO_INTERVAL = 4 * 3600000
MANUAL_INTERVAL = 15 * 60000
PROBE_INTERVAL = 7 * DAY
TOP_LIMIT = 20
WEIGHTS = dict(buyers=40, interested=25, flow=15, holders=10, recency=10)
FILE = 'collection-plan.json'


def request_collection(leases, dispatch, now):
    key = 'balance-writer'
    lease = leases.get(key, None)
    if lease and 0 <= now - lease.get('requestedAt', 0) < 1800000:
        return False
    if lease:
        leases.pop(key, None)
    if not leases.put(key, dict(requestedAt=now), skip_if_exists=True):
        return False
    try:
        dispatch(request_key=key, request_at=now)
    except Exception:
        leases.pop(key, None)
        raise
    return True


def valid_token(mint, include_quotes=False):
    from worker.followed_wallets import validate_wallet
    from worker.smartness import QUOTES
    try:
        validate_wallet(dict(name='Token', address=mint, code='F1'))
        return include_quotes or mint not in QUOTES
    except (ValueError, TypeError):
        return False


def raw_amounts(point, count):
    values = point.get('walletBalances', [])
    if not isinstance(values, list) or len(values) != count:
        return None
    return [int(v) if isinstance(v, str) and v.isascii() and v.isdigit() else None for v in values]


def complete(point, count):
    values = raw_amounts(point, count)
    raw = point.get('balanceRaw')
    return bool(count and values is not None and all(v is not None for v in values)
                and point.get('checkedWallets') == count and isinstance(raw, str)
                and raw.isascii() and raw.isdigit() and int(raw) == sum(values))


def new_holders(report, now):
    count = len(report.get('wallets', []))
    samples = report.get('samples', [])
    latest = next((p for p in reversed(samples) if p.get('time', 0) <= now and complete(p, count)), None)
    target = now - DAY
    baseline = next((p for p in reversed(samples) if target - 3600000 <= p.get('time', 0) <= target and complete(p, count)), None)
    if not latest or now - latest['time'] > AUTO_INTERVAL or not baseline:
        return None
    return sum(a == 0 and b > 0 for a, b in zip(raw_amounts(baseline, count), raw_amounts(latest, count)))


def rank_tokens(ledger, registry, reports, now):
    members = {r['address']: r for r in registry if r.get('smartMoney') is True}
    candidates, seen, valid = {}, set(), {}
    for event in ledger.get('events', []):
        owner, mint, identity = event.get('address'), event.get('mint'), event.get('id')
        stamp = event.get('time')
        if (not isinstance(owner, str) or not isinstance(mint, str) or owner not in members or not isinstance(identity, str) or identity in seen
                or not isinstance(stamp, (int, float)) or not math.isfinite(stamp)
                or not now - DAY <= stamp <= now or event.get('side') not in ('buy', 'sell')
                or event.get('quote') not in ('SOL', 'USDC', 'USDT')):
            continue
        if mint not in valid:
            valid[mint] = valid_token(mint)
        if not valid[mint]:
            continue
        try:
            amount, quantity = Decimal(str(event['quoteAmount'])), Decimal(str(event['quantity']))
            if not amount.is_finite() or not quantity.is_finite() or amount <= 0 or quantity <= 0:
                continue
        except (InvalidOperation, KeyError):
            continue
        seen.add(identity)
        row = candidates.setdefault(mint, dict(token=mint, buyers=set(), interested=set(), net={}, lastActivityAt=0, lastBuyAt=0, steps=0))
        if event['side'] == 'buy':
            row['buyers'].add(owner)
            if members[owner].get('interested'):
                row['interested'].add(owner)
            row['lastBuyAt'] = max(row['lastBuyAt'], stamp)
        quote = event['quote']
        row['net'][quote] = row['net'].get(quote, Decimal(0)) + amount * (1 if event['side'] == 'buy' else -1)
        row['lastActivityAt'] = max(row['lastActivityAt'], stamp)
        row['steps'] += 1
    for row in candidates.values():
        row['newHolders'] = new_holders(reports.get(row['token'], {}), now)
    maxima = dict(buyers=max((len(r['buyers']) for r in candidates.values()), default=1) or 1,
                  interested=max((len(r['interested']) for r in candidates.values()), default=1) or 1,
                  holders=max((r['newHolders'] or 0 for r in candidates.values()), default=1) or 1)
    net_max = {q: max((max(r['net'].get(q, 0), 0) for r in candidates.values()), default=0) for q in ('SOL', 'USDC', 'USDT')}
    output = []
    for row in candidates.values():
        factors = dict(buyers=len(row['buyers']) / maxima['buyers'], interested=len(row['interested']) / maxima['interested'],
                       holders=(row['newHolders'] or 0) / maxima['holders'],
                       recency=max(0, 1 - (now - row['lastActivityAt']) / DAY),
                       flow=max((float(max(row['net'].get(q, 0), 0) / value) for q, value in net_max.items() if value > 0), default=0))
        output.append(dict(token=row['token'], symbol=ledger.get('tokens', {}).get(row['token'], {}).get('symbol') or row['token'][:8],
                           score=round(sum(WEIGHTS[k] * v for k, v in factors.items()), 4),
                           components={k: round(WEIGHTS[k] * v, 4) for k, v in factors.items()},
                           buyers=len(row['buyers']), interestedBuyers=len(row['interested']), newHolders=row['newHolders'],
                           netByQuote={q: str(v) for q, v in row['net'].items()}, lastBuyAt=row['lastBuyAt'],
                           lastActivityAt=row['lastActivityAt'], steps=row['steps']))
    output.sort(key=lambda r: (-r['score'], -r['buyers'], -r['lastActivityAt'], r['token']))
    return [dict(row, rank=i + 1) for i, row in enumerate(output)]


def load(directory):
    try:
        value = json.loads((Path(directory) / FILE).read_text(encoding='utf-8'))
        if value.get('version') == 1:
            return value
    except (OSError, ValueError):
        pass
    return dict(version=1, tokens={}, checks={}, ranking=[], dispatchCount=0)


def save(directory, plan):
    path = Path(directory) / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(plan, separators=(',', ':')), encoding='utf-8')
    temporary.replace(path)


def ensure_token(plan, token, group_id, now):
    row = plan['tokens'].setdefault(token, dict(token=token, enrolledAt=now, mode='active'))
    if row.get('groupId') != group_id:
        row.update(groupId=group_id, mode='active', zeroDays={}, zeroStreak=0, lastSnapshotAt=0,
                   lastPositiveSignalAt=0, dormantAt=None, reason='New SmartMoney membership', membershipAt=now)
        plan['checks'] = {k: v for k, v in plan['checks'].items() if not k.startswith(token + ':')}
    if row['mode'] == 'unavailable':
        row['mode'] = 'active'
    return row


def positive(row, stamp, now, reason):
    day = str(int(stamp // DAY))
    row.setdefault('zeroDays', {})[day] = dict(positive=True, firstAt=stamp)
    row.update(zeroStreak=0, lastPositiveAt=max(row.get('lastPositiveAt', 0), stamp))
    if row['mode'] == 'dormant':
        row.update(mode='active', dormantAt=None, wokeAt=now, reason=reason)
        row['wakePending'] = True


def wake_inspect(row, now):
    if row['mode'] == 'dormant':
        row.update(mode='active', dormantAt=None, wokeAt=now, zeroDays={}, zeroStreak=0, reason='Opened in Inspect', wakePending=True)


def observe(row, report, now):
    """Only exact current membership and complete raw-zero checks certify a day."""
    if report.get('groupId') != row['groupId']:
        return
    count = len(report.get('wallets', []))
    for point in sorted(report.get('samples', []), key=lambda p: p.get('time', 0)):
        stamp = point.get('time', 0)
        # Projections preserve charts, but do not backdate a new membership's pause clock.
        if stamp <= row.get('lastSnapshotAt', 0) or stamp < row['membershipAt'] or stamp > now or point.get('derivedFromGroupId'):
            continue
        row['lastSnapshotAt'] = stamp
        values = raw_amounts(point, count)
        if values is not None and any(v is not None and v > 0 for v in values):
            positive(row, stamp, now, 'Positive SmartMoney balance observed')
        if not complete(point, count):
            continue
        row.update(lastCompleteAt=stamp, lastBalanceRaw=point['balanceRaw'])
        if int(point['balanceRaw']) != 0:
            continue
        day = str(int(stamp // DAY))
        certificate = row.setdefault('zeroDays', {}).setdefault(day, dict(positive=False, firstAt=stamp))
        if certificate['positive']:
            continue
        cursor, streak = int(stamp // DAY), 0
        while str(cursor) in row['zeroDays'] and not row['zeroDays'][str(cursor)]['positive']:
            streak += 1
            cursor -= 1
        row['zeroStreak'] = streak
        first = row['zeroDays'][str(cursor + 1)]['firstAt']
        if streak >= 10 and stamp - first >= 10 * DAY:
            row.update(mode='dormant', dormantAt=row.get('dormantAt') or now,
                       pausedZeroDays=streak, zeroSince=first,
                       reason='Complete daily zero checks for at least ten elapsed days')
    row['zeroDays'] = {d: v for d, v in row.get('zeroDays', {}).items() if int(d) >= now // DAY - 40}


def prepare(directory, registry, ledger, watches, holdings, now):
    from worker.smart_wallets import make_cohort, read_report
    plan = load(directory)
    # Only exact membership reports can supply holder-growth ranking inputs.
    reports = {}
    for token in plan['tokens']:
        try:
            reports[token] = read_report(directory, make_cohort(token, registry))
        except ValueError:
            continue
    ranked = rank_tokens(ledger, registry, reports, now)
    plan.update(ranking=ranked[:TOP_LIMIT], rankedAt=now, ledgerAt=ledger.get('attemptedAt'), candidateCount=len(ranked),
                smartWallets=sum(r.get('smartMoney') is True for r in registry))
    active = {r['token']: r for r in ranked[:TOP_LIMIT]}
    recent = {r['token']: r for r in ranked}
    visits = {r['token'] for r in watches if 0 <= now - r.get('requestedAt', 0) < DAY and valid_token(r.get('token'), include_quotes=True)}
    visit_times = {token: max(r.get('requestedAt', 0) for r in watches if r.get('token') == token) for token in visits}
    for token in set(active) | visits:
        try:
            ensure_token(plan, token, make_cohort(token, registry)['groupId'], now)
        except ValueError:
            continue
    members = {r['address'] for r in registry if r.get('smartMoney') is True}
    for token, row in plan['tokens'].items():
        try:
            ensure_token(plan, token, make_cohort(token, registry)['groupId'], now)
        except ValueError:
            row.update(mode='unavailable', reason='No eligible SmartMoney cohort')
            continue
        row.update(auto=token in active, rank=active.get(token, {}).get('rank'), symbol=active.get(token, {}).get('symbol') or row.get('symbol') or token[:8])
        if token in visits and visit_times[token] > (row.get('dormantAt') or 0):
            wake_inspect(row, now)
        if token in recent and recent[token]['lastBuyAt'] > row.get('lastBuyAt', 0):
            stamp = recent[token]['lastBuyAt']
            row['lastBuyAt'] = stamp
            positive(row, stamp, now, 'New SmartMoney buy')
        for wallet in holdings.get('wallets', []):
            stamp = wallet.get('checkedAt') or 0
            if (wallet.get('address') in members and wallet.get('status') == 'ok' and token in wallet.get('mints', [])
                    and now - DAY <= stamp <= now and stamp > row.get('lastPositiveSignalAt', 0)):
                row['lastPositiveSignalAt'] = stamp
                positive(row, stamp, now, 'Positive holding detected by wallet scan')
        if token not in reports:
            reports[token] = read_report(directory, make_cohort(token, registry))
        observe(row, reports[token], now)
        if row.pop('wakePending', False):
            plan['checks'].pop(token + ':universe', None)
    save(directory, plan)
    return plan


def choose_job(plan, watches, now):
    manual, automatic, monitoring = [], [], []
    for token, row in plan['tokens'].items():
        if row['mode'] == 'unavailable':
            continue
        interval = PROBE_INTERVAL if row['mode'] == 'dormant' else AUTO_INTERVAL if row.get('auto') else DAY
        check = plan['checks'].get(token + ':universe', {})
        due = check.get('nextDueAt', 0)
        if row['mode'] == 'dormant':
            due = max(due, (row.get('lastProbeAt') or row['dormantAt']) + PROBE_INTERVAL)
        if due <= now:
            job = dict(token=token, scope='universe', kind='probe' if row['mode'] == 'dormant' else 'automatic' if row.get('auto') else 'monitor',
                       interval=interval, dueAt=due, rank=row.get('rank') or 999999)
            (automatic if row.get('auto') and row['mode'] != 'dormant' else monitoring).append(job)
    for watch in watches:
        token, scope = watch.get('token'), watch.get('scope')
        if token not in plan['tokens'] or plan['tokens'][token]['mode'] == 'dormant' or scope not in ('universe', 'interested', 'legacy') or not 0 <= now - watch.get('requestedAt', 0) < DAY:
            continue
        due = plan['checks'].get(token + ':' + scope, {}).get('nextDueAt', 0)
        if due <= now:
            manual.append(dict(token=token, scope=scope, kind='inspect', interval=MANUAL_INTERVAL, dueAt=due, rank=0))
    manual.sort(key=lambda r: (r['dueAt'], r['token'], r['scope']))
    automatic.sort(key=lambda r: (r['dueAt'], r['rank'], r['token']))
    monitoring.sort(key=lambda r: (r['dueAt'], r['token']))
    # Reserve turns for each queue so a permanently open Inspect tab cannot starve seeds.
    lanes = [manual, automatic, monitoring]
    turn = plan.get('dispatchCount', 0) % 3
    for lane in [lanes[turn], *lanes]:
        if lane:
            return lane[0]
    return None


def checkpoint(plan, job, report, now, finished=False):
    row = plan['tokens'][job['token']]
    if job['scope'] == 'universe':
        observe(row, report, now)
    point = report.get('samples', [{}])[-1] if report.get('samples') else {}
    is_complete = (complete(point, len(report.get('wallets', []))) and not report.get('error')
                   and point.get('time', 0) >= job.get('startedAt', 0))
    interval = PROBE_INTERVAL if row['mode'] == 'dormant' else job['interval'] if is_complete else 5 * 60000
    check = plan['checks'].setdefault(job['token'] + ':' + job['scope'], {})
    check.update(lastAttemptAt=now, nextDueAt=now + interval, checkedWallets=point.get('checkedWallets', 0),
                 totalWallets=len(report.get('wallets', [])), status='dormant' if row['mode'] == 'dormant' else 'complete' if is_complete else 'partial',
                 lastCompleteAt=point['time'] if is_complete else check.get('lastCompleteAt'))
    if job['kind'] == 'probe' and finished:
        row['lastProbeAt'] = now
    if finished:
        plan.update(running=None, dispatchCount=plan.get('dispatchCount', 0) + 1, updatedAt=now)


def public_report(plan, now):
    rows = []
    for row in plan['tokens'].values():
        check = plan.get('checks', {}).get(row['token'] + ':universe', {})
        rows.append({**{k: v for k, v in row.items() if k != 'zeroDays'}, 'check': check})
    rows.sort(key=lambda r: (r['mode'] == 'dormant', r.get('rank') or 999999, r['token']))
    return dict(version=1, rankedAt=plan.get('rankedAt'), updatedAt=plan.get('updatedAt'), ledgerAt=plan.get('ledgerAt'),
                smartWallets=plan.get('smartWallets', 0), topLimit=TOP_LIMIT, candidateCount=plan.get('candidateCount', 0),
                ranking=plan.get('ranking', []), tokens=rows, running=plan.get('running'), weights=WEIGHTS,
                error=plan.get('error'),
                policy=dict(autoIntervalMs=AUTO_INTERVAL, manualIntervalMs=MANUAL_INTERVAL, probeIntervalMs=PROBE_INTERVAL, zeroDays=10),
                now=now)
