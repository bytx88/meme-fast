"""Per-contract 24H comparisons, with explicit neutral enrollment references."""
import copy
import math
from urllib.parse import urlencode

HOUR = 3_600_000
DAY = 24*HOUR
MINUTE = 60_000
MATCH_TOLERANCE = 10*MINUTE
METHOD = 'component-1h-vs24h-v1'
MAX_RECOVERIES = 2


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def identity(row):
    network = row.get('chain') or row.get('network')
    address = row.get('address') or row.get('contract_address')
    if not network or not address:
        value = row.get('id')
        if not isinstance(value, str) or ':' not in value:
            return None
        network, address = value.split(':', 1)
    if not isinstance(network, str) or not isinstance(address, str):
        return None
    return network+':'+(address if network == 'solana' else address.lower())


def _observation(row, now, sampled_at=None):
    from worker.meme_index import quote_reason
    observed = row.get('observedAt')
    if not finite(observed) or observed > now or observed < now-31*DAY:
        return None
    checked_at = observed if sampled_at is None else sampled_at
    if not finite(checked_at) or quote_reason(row, checked_at) is not None:
        return None
    source = row.get('source') if row.get('source') == 'gecko-5m-close' else 'saved-h1'
    value = dict(observedAt=observed, priceChange1h=row['priceChange1h'], pool=row['pool'],
                 poolCreatedAt=row['poolCreatedAt'], source=source,
                 windowStartAt=observed-HOUR, windowEndAt=observed)
    if source == 'gecko-5m-close':
        value['retrievedAt'] = row.get('retrievedAt')
    return value


def _put(entry, observation):
    if observation is None:
        return
    key = (observation['observedAt'], observation['pool'], observation['source'])
    old = entry['observations']
    if not any((row['observedAt'], row['pool'], row['source']) == key for row in old):
        old.append(observation)


def _entry(ledger, key):
    return ledger['members'].setdefault(key, dict(observations=[]))


def _load_ledger(report, now):
    ledger = dict(version=1, members={})
    saved = report.get('componentBaselines')
    if isinstance(saved, dict) and isinstance(saved.get('members'), dict):
        for key, original in saved['members'].items():
            if not isinstance(key, str) or not isinstance(original, dict):
                continue
            entry = _entry(ledger, key)
            for field in ('firstAt', 'firstObservedAt', 'initialReturn', 'lastAttemptAt'):
                value = original.get(field)
                if finite(value):
                    entry[field] = value
            for row in original.get('observations', []):
                if isinstance(row, dict):
                    _put(entry, _observation(row, now))
    # All methods describe exact contracts; membership changes do not erase those
    # observations. An archive's aggregate result is never used as a baseline.
    pending = [report]
    while pending:
        saved = pending.pop()
        if not isinstance(saved, dict):
            continue
        at = saved.get('readingAt') or saved.get('updatedAt')
        samples = list(saved.get('basketHistory') or [])
        if saved.get('basket') and finite(at):
            samples.append(dict(at=at, tokens=saved['basket']))
        for sample in samples:
            if not isinstance(sample, dict) or not finite(sample.get('at')):
                continue
            for row in sample.get('tokens', []):
                if not isinstance(row, dict):
                    continue
                key = identity(row)
                observation = _observation(row, now, sample['at'])
                if key and observation:
                    _put(_entry(ledger, key), observation)
        archives = saved.get('legacyMethods')
        if isinstance(archives, dict):
            pending.extend(value for value in archives.values() if isinstance(value, dict))
    return ledger


def _match(entry, target):
    rows = [row for row in entry['observations'] if abs(row['observedAt']-target) <= MATCH_TOLERANCE]
    return min(rows, key=lambda row: (abs(row['observedAt']-target),
                                     row['source'] != 'saved-h1', -row['observedAt'], row['pool'])) if rows else None


def recover(row, fetch, now, clock=None):
    """One bounded shared-source read recovers usable windows for the next day."""
    interval = 5*MINUTE
    end = int(row['observedAt']//interval)*interval
    network = {'ethereum': 'eth', 'polygon': 'polygon_pos', 'avalanche': 'avax'}.get(row['chain'], row['chain'])
    address = row['address']
    path = f"/networks/{network}/pools/{row['pool']}/ohlcv/minute?" + urlencode(dict(
        aggregate=5, limit=302, currency='usd', token=address, before_timestamp=end//1000-1))
    reply = fetch(path, workload='background')
    receipt = clock() if clock is not None else now
    if not isinstance(reply, dict) or reply.get('status') != 200:
        return []
    body = reply.get('body')
    if not isinstance(body, dict):
        return []
    source_at = body.get('_sourceObservedAt')
    # The cache's original receipt time is evidence of the retrieval, never a
    # substitute for the historical candle closing times.
    if not finite(source_at) or source_at < end or source_at > receipt:
        return []
    data = body.get('data')
    attributes = data.get('attributes') if isinstance(data, dict) else None
    raw = attributes.get('ohlcv_list') if isinstance(attributes, dict) else None
    if not isinstance(raw, list):
        return []
    closes, ambiguous = {}, set()
    for candle in raw:
        if not isinstance(candle, list) or len(candle) < 6 or not all(finite(value) for value in candle[:6]):
            continue
        seconds, opened, high, low, close, volume = candle[:6]
        stamp = seconds*1000
        if (stamp % interval or stamp+interval > end or stamp < end-302*interval
                or low <= 0 or high < max(opened, close) or low > min(opened, close) or volume < 0):
            continue
        closing_at = stamp+interval
        if closing_at in closes and closes[closing_at] != close:
            ambiguous.add(closing_at)
        closes[closing_at] = close
    for stamp in ambiguous:
        closes.pop(stamp, None)
    observations = []
    for window_end in sorted(closes):
        window_start = window_end-HOUR
        if row['poolCreatedAt'] > window_start or not all(window_start+i*interval in closes for i in range(13)):
            continue
        change = (closes[window_end]/closes[window_start]-1)*100
        observation = _observation(dict(observedAt=window_end, priceChange1h=change,
            pool=row['pool'], poolCreatedAt=row['poolCreatedAt'], source='gecko-5m-close',
            retrievedAt=source_at), now)
        if observation:
            observations.append(observation)
    return observations


def compare_components(basket, report, now, history=None, prior_ids=None, clock=None):
    """Publish all N equal contributions; warming is explicit, never fake history."""
    from worker.meme_index import quote_reason
    ledger = _load_ledger(report, now)
    for row in basket:
        key = identity(row)
        entry = _entry(ledger, key)
        if prior_ids is not None and key not in prior_ids:
            for field in ('firstAt', 'firstObservedAt', 'initialReturn'):
                entry.pop(field, None)
    if history is not None:
        candidates = []
        for row in basket:
            entry = _entry(ledger, identity(row))
            if (row.get('eligible') is True and _match(entry, row['observedAt']-DAY) is None
                    and (not finite(entry.get('lastAttemptAt')) or now-entry['lastAttemptAt'] >= HOUR)):
                candidates.append((entry.get('lastAttemptAt', -1), identity(row), row, entry))
        for _, _, row, entry in sorted(candidates, key=lambda item: item[:2])[:MAX_RECOVERIES]:
            entry['lastAttemptAt'] = now
            try:
                for observation in recover(row, history, now, clock=clock):
                    _put(entry, observation)
            except Exception:
                pass  # A failed historical lookup creates no market observation.
    now = clock() if clock is not None else now
    components = []
    for row in basket:
        key = identity(row)
        entry = _entry(ledger, key)
        reason = quote_reason(row, now)
        if row.get('eligible') is not True:
            reason = row.get('exclusionReason') or reason or 'missing_quote'
        row.update(eligible=reason is None, exclusionReason=reason)
        current = row.get('priceChange1h') if finite(row.get('priceChange1h')) else None
        at = row.get('observedAt') if finite(row.get('observedAt')) else None
        if reason is None and (not finite(entry.get('firstAt')) or not finite(entry.get('initialReturn'))
                               or not finite(entry.get('firstObservedAt'))):
            entry.update(firstAt=now, firstObservedAt=at, initialReturn=current)
        first_at = entry.get('firstAt')
        warm_until = first_at+DAY if finite(first_at) else None
        baseline = _match(entry, at-DAY) if reason is None else None
        if (baseline is not None and finite(warm_until) and now < warm_until
                and baseline['observedAt'] >= entry['firstObservedAt']):
            # The matching tolerance cannot bring our own first sample into
            # use a few minutes before its full 24H enrollment has elapsed.
            baseline = None
        component = dict(id=key, weight=1/len(basket), status='unavailable', delta=None,
                         currentReturn=current, currentObservedAt=at, baselineReturn=None,
                         baselineObservedAt=None, baselineSource=None, baselineWindowStartAt=None,
                         baselineWindowEndAt=None, initialReturn=entry.get('initialReturn'),
                         firstAt=first_at, firstObservedAt=entry.get('firstObservedAt'),
                         warmUntil=warm_until, reason=reason or 'missing_24h_baseline')
        if baseline is not None:
            component.update(status='active', delta=current-baseline['priceChange1h'],
                             baselineReturn=baseline['priceChange1h'],
                             baselineObservedAt=baseline['observedAt'], baselineSource=baseline['source'],
                             baselineWindowStartAt=baseline['windowStartAt'],
                             baselineWindowEndAt=baseline['windowEndAt'], reason=None)
        elif reason is None and now < warm_until:
            component.update(status='warming', delta=0, baselineReturn=entry['initialReturn'],
                             baselineObservedAt=entry['firstObservedAt'], baselineSource='initial-reference',
                             reason='neutral_until_24h')
        components.append(component)
        row['comparison'] = copy.deepcopy(component)
        if reason is None:
            _put(entry, _observation(row, now))
        entry['observations'].sort(key=lambda value: (value['observedAt'], value['source'], value['pool']))
        entry['observations'] = entry['observations'][-1200:]
    unavailable = sum(row['status'] == 'unavailable' for row in components)
    value = math.fsum(row['delta'] for row in components)/len(components) if not unavailable else None
    comparison = dict(method=METHOD, at=now, value=value,
                      matchedMembers=sum(row['status'] == 'active' for row in components),
                      warmingMembers=sum(row['status'] == 'warming' for row in components),
                      unavailableMembers=unavailable, components=components)
    return comparison, ledger
