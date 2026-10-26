"""Explicit, versioned membership for the admin-managed Meme index."""
import copy
import hashlib
import json
import math
import re
import time
from pathlib import Path

NETWORKS = ('solana', 'base', 'robinhood', 'bsc', 'ethereum', 'arbitrum',
            'optimism', 'polygon', 'avalanche')
MAX_MEMBERS = 30


class Conflict(ValueError):
    """The editor was opened before another membership save."""
    def __init__(self, current):
        super().__init__('The preset changed in another session. Reload it before saving.')
        self.current = current


def _text(value, field, limit):
    if not isinstance(value, str):
        raise ValueError(f'Enter a {field}')
    value = value.strip()
    if not 1 <= len(value) <= limit or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError(f'{field.capitalize()} must contain 1 to {limit} characters')
    return value


def validate_members(members):
    if not isinstance(members, (list, tuple)) or not 1 <= len(members) <= MAX_MEMBERS:
        raise ValueError(f'Keep between 1 and {MAX_MEMBERS} preset members')
    output, seen = [], set()
    for member in members:
        if not isinstance(member, dict):
            raise ValueError('Each member needs a network and exact token contract')
        network = member.get('network')
        address = member.get('contract_address')
        if network not in NETWORKS or not isinstance(address, str):
            raise ValueError('Choose a supported network and exact token contract')
        address = address.strip()
        pattern = r'[1-9A-HJ-NP-Za-km-z]{32,44}' if network == 'solana' else r'0x[a-fA-F0-9]{40}'
        if not re.fullmatch(pattern, address):
            raise ValueError('Enter a valid exact token contract for the selected network')
        if network != 'solana':
            address = address.lower()
        identity = (network, address)
        if identity in seen:
            raise ValueError('This exact token contract is already in the preset')
        seen.add(identity)
        output.append(dict(network=network, contract_address=address,
                           symbol=_text(member.get('symbol'), 'symbol', 32),
                           name=_text(member.get('name'), 'name', 100)))
    return output


def method_for(members):
    members = validate_members(members)
    identity = [(member['network'], member['contract_address']) for member in members]
    digest = hashlib.sha256(json.dumps(identity, separators=(',', ':')).encode()).hexdigest()[:12]
    return f'fixed-preset-{len(members)}-1h-v1-{digest}'


def member_identity(member):
    return member['network']+':'+member['contract_address']


def validate_admissions(members, admissions=None):
    """Only server state decides which members were genuinely added.

    Configurations saved before admissions were introduced are incumbents. An
    application upgrade is never a membership addition or a new warmup clock.
    """
    if admissions is None:
        return {member_identity(row): dict(kind='existing', addedAt=None) for row in members}
    if not isinstance(admissions, dict):
        raise ValueError('Saved Meme member admissions are invalid')
    output = {}
    for member in members:
        key = member_identity(member)
        entry = admissions.get(key)
        if not isinstance(entry, dict) or entry.get('kind') not in ('existing', 'added'):
            raise ValueError('Saved Meme member admission is invalid')
        added = entry.get('addedAt')
        if ((entry['kind'] == 'existing' and added is not None)
                or (entry['kind'] == 'added' and (type(added) not in (int, float)
                    or not math.isfinite(added) or added < 0))):
            raise ValueError('Saved Meme member admission time is invalid')
        output[key] = dict(kind=entry['kind'], addedAt=added)
    return output


def default_config():
    members = validate_members(json.loads(Path(__file__).with_name('meme-index-preset.json').read_text(encoding='utf-8')))
    revision = hashlib.sha256(json.dumps(members, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:20]
    return dict(version=1, revision='seed-'+revision, members=members, updatedAt=None,
                method=method_for(members), admissions=validate_admissions(members))


def read_config(value):
    """Missing storage uses the seed; malformed saved membership must fail closed."""
    if value is None:
        return default_config()
    if not isinstance(value, dict) or value.get('version') != 1:
        raise ValueError('Saved Meme preset is invalid')
    members = validate_members(value.get('members'))
    revision = value.get('revision')
    stamp = value.get('updatedAt')
    if not isinstance(revision, str) or not 1 <= len(revision) <= 128:
        raise ValueError('Saved Meme preset revision is invalid')
    if stamp is not None and (type(stamp) not in (int, float) or not math.isfinite(stamp) or stamp < 0):
        raise ValueError('Saved Meme preset time is invalid')
    if 'admissions' in value and value['admissions'] is None:
        raise ValueError('Saved Meme member admissions are invalid')
    return dict(version=1, revision=revision, members=members, updatedAt=stamp,
                method=method_for(members), admissions=validate_admissions(members, value.get('admissions')))


def revise(current, payload, now=None):
    current = read_config(current)
    if not isinstance(payload, dict):
        raise ValueError('Enter preset members and the current revision')
    if payload.get('revision') != current['revision']:
        raise Conflict(current)
    members = validate_members(payload.get('members'))
    if members == current['members']:
        return current
    now = int(time.time()*1000) if now is None else now
    if type(now) not in (int, float) or not math.isfinite(now) or now < 0:
        raise ValueError('Invalid preset save time')
    revision = hashlib.sha256(json.dumps([current['revision'], now, members],
                                         sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:24]
    admissions = {member_identity(row): copy.deepcopy(current['admissions'].get(member_identity(row),
                    dict(kind='added', addedAt=now))) for row in members}
    return dict(version=1, revision=revision, members=members, updatedAt=now,
                method=method_for(members), admissions=admissions)


def _membership_source(saved):
    """Use only a genuine, internally consistent current component reading."""
    from worker.meme_baseline import DAY, HOUR, METHOD, MATCH_TOLERANCE, finite
    from worker.meme_index import quote_reason
    rows = saved.get('readings')
    basket = saved.get('basket')
    if not isinstance(rows, list) or not isinstance(basket, list) or not basket:
        return None
    source = next((row for row in reversed(rows) if isinstance(row, dict)
                   and row.get('method') == saved.get('method')), None)
    if not source or not finite(source.get('at')) or source['at'] <= 0 or 'membershipProjection' in source:
        return None
    if any(field in saved and saved[field] != source['at'] for field in ('readingAt', 'updatedAt')):
        return None
    engine = source.get('memeComparison')
    if (not isinstance(engine, dict) or engine.get('method') != METHOD or engine.get('at') != source['at']
            or not isinstance(engine.get('components'), list) or len(engine['components']) != len(basket)):
        return None
    try:
        members = [dict(network=row['chain'], contract_address=row['address'],
                        symbol=row['symbol'], name=row['name']) for row in basket]
        if method_for(members) != saved.get('method'):
            return None
    except (KeyError, TypeError, ValueError):
        return None
    components = engine['components']
    excluded = ('warming', 'pending')
    denominator = sum(row.get('status') not in excluded for row in components if isinstance(row, dict))
    qualified, total, counts = [], [], {status: 0 for status in ('active', 'warming', 'pending', 'awaiting_history', 'unavailable')}
    blank = ('baselineReturn', 'baselineObservedAt', 'baselineSource', 'baselineWindowStartAt', 'baselineWindowEndAt')
    def equal(left, right):
        return finite(left) and finite(right) and math.isclose(left, right, rel_tol=1e-8, abs_tol=1e-8)
    def valid_return(value):
        return finite(value) and -100 <= value <= 10_000
    for member, quote, component in zip(members, basket, components):
        if not isinstance(component, dict):
            return None
        status, key = component.get('status'), member_identity(member)
        if (status not in counts or quote.get('id') != key or component.get('id') != key
                or quote.get('comparison') != component
                or not equal(component.get('weight'), 0 if status in excluded or not denominator else 1/denominator)
                or component.get('kind') not in ('existing', 'added')
                or (component['kind'] == 'existing' and component.get('addedAt') is not None)
                or (component['kind'] == 'added' and (not finite(component.get('addedAt'))
                    or component['addedAt'] < 0 or component['addedAt'] > source['at']))
                or type(component.get('currentEligible')) is not bool
                or component['currentEligible'] != (quote.get('eligible') is True)
                or component.get('currentReturn') != quote.get('priceChange1h')
                or component.get('currentObservedAt') != quote.get('observedAt')):
            return None
        counts[status] += 1
        if component['currentEligible']:
            if quote_reason(quote, source['at']) is not None:
                return None
            qualified.append(component['currentReturn'])
        elif (component.get('currentReturn') is not None and not finite(component['currentReturn'])
                or component.get('currentObservedAt') is not None and not finite(component['currentObservedAt'])):
            return None
        if status == 'active':
            if (not component['currentEligible'] or not valid_return(component.get('baselineReturn'))
                    or component.get('baselineSource') not in ('saved-h1', 'gecko-5m-close')
                    or not finite(component.get('baselineObservedAt'))
                    or abs(component['baselineObservedAt']-(component['currentObservedAt']-DAY)) > MATCH_TOLERANCE
                    or component.get('baselineWindowEndAt') != component['baselineObservedAt']
                    or component.get('baselineWindowStartAt') != component['baselineObservedAt']-HOUR
                    or not equal(component.get('delta'), component['currentReturn']-component['baselineReturn'])):
                return None
            total.append(component['delta'])
        elif status == 'warming':
            if (component['kind'] != 'added' or component.get('reason') != 'neutral_until_24h'
                    or component.get('delta') != 0 or not valid_return(component.get('initialReturn'))
                    or component.get('baselineReturn') != component['initialReturn']
                    or component.get('baselineSource') != 'initial-reference'
                    or not finite(component.get('firstAt')) or component['firstAt'] < component['addedAt']
                    or not finite(component.get('firstObservedAt')) or component['firstObservedAt'] <= 0
                    or not 0 <= component['firstAt']-component['firstObservedAt'] < 15*60_000
                    or component.get('baselineObservedAt') != component['firstObservedAt']
                    or component.get('warmUntil') != component['firstAt']+DAY
                    or not component['firstAt'] <= source['at'] < component['warmUntil']
                    or component.get('baselineWindowStartAt') is not None or component.get('baselineWindowEndAt') is not None):
                return None
        elif status == 'pending':
            if (component['kind'] != 'added' or component['currentEligible'] or component.get('delta') != 0
                    or component.get('reason') != 'awaiting_initial_quote'
                    or any(component.get(field) is not None for field in (*blank, 'firstAt', 'firstObservedAt', 'initialReturn', 'warmUntil'))):
                return None
        elif (component.get('delta') is not None or any(component.get(field) is not None for field in blank)
                or (status == 'awaiting_history' and (component['kind'] != 'existing'
                    or not component['currentEligible'] or component.get('reason') != 'missing_24h_baseline'
                    or component.get('warmUntil') is not None))):
            return None
    coverage = source.get('coverage')
    if (not isinstance(coverage, dict)
            or any(type(coverage.get(field)) is not int for field in ('totalTokens', 'includedTokens', 'excludedTokens'))
            or any(type(engine.get(field)) is not int for field in ('matchedMembers', 'warmingMembers', 'awaitingHistoryMembers', 'unavailableMembers', 'denominator'))
            or coverage.get('totalTokens') != len(basket)
            or coverage.get('includedTokens') != len(qualified) or coverage.get('excludedTokens') != len(basket)-len(qualified)
            or (len(qualified) == len(basket) and not equal(source.get('meme'), math.fsum(qualified)/len(basket)))
            or (len(qualified) != len(basket) and source.get('meme') is not None)
            or engine.get('matchedMembers') != counts['active']
            or engine.get('warmingMembers') != counts['warming']+counts['pending']
            or engine.get('awaitingHistoryMembers') != counts['awaiting_history']
            or engine.get('unavailableMembers') != counts['unavailable'] or engine.get('denominator') != denominator
            or ((counts['awaiting_history'] or counts['unavailable'] or not denominator) and engine.get('value') is not None)
            or (not counts['awaiting_history'] and not counts['unavailable'] and denominator
                and not equal(engine.get('value'), math.fsum(total)/denominator))):
        return None
    return source


def _project_membership(saved, config, source):
    """Reweight retained observations without recording a new market reading."""
    from worker.meme_baseline import METHOD
    old = {row['id']: row for row in saved['basket']}
    count = len(config['members'])
    basket, components = [], []
    for member in config['members']:
        key = member_identity(member)
        admission = config['admissions'][key]
        quote = old.get(key)
        prior = quote.get('comparison') if quote else None
        if prior and admission == dict(kind=prior['kind'], addedAt=prior['addedAt']):
            quote = copy.deepcopy(quote)
            component = copy.deepcopy(prior)
            quote.update(name=member['name'], symbol=member['symbol'], weight=1/count)
        else:
            # A new generation cannot inherit a quote or its earlier enrollment
            # reference. Its first qualified collection starts that clock.
            if admission['kind'] != 'added':
                return None
            component = dict(id=key, weight=0, status='pending', delta=0,
                kind='added', addedAt=admission['addedAt'], currentReturn=None, currentObservedAt=None,
                currentEligible=False, baselineReturn=None, baselineObservedAt=None, baselineSource=None,
                baselineWindowStartAt=None, baselineWindowEndAt=None, initialReturn=None, firstAt=None,
                firstObservedAt=None, warmUntil=None, reason='awaiting_initial_quote')
            quote = dict(id=key, chain=member['network'], address=member['contract_address'],
                name=member['name'], symbol=member['symbol'], weight=1/count, source='fixed-preset-1h',
                priceSource=None, observedAt=None, priceChange1h=None, pool=None, poolCreatedAt=None,
                eligible=False, exclusionReason='awaiting_collection')
        basket.append(quote)
        components.append(component)
    counts = {status: sum(row['status'] == status for row in components)
              for status in ('active', 'warming', 'pending', 'awaiting_history', 'unavailable')}
    denominator = count-counts['warming']-counts['pending']
    for quote, component in zip(basket, components):
        component['weight'] = 0 if component['status'] in ('warming', 'pending') or not denominator else 1/denominator
        quote['comparison'] = copy.deepcopy(component)
    changes = [row['priceChange1h'] for row in basket if row['eligible']]
    exclusions = {}
    for row in basket:
        if not row['eligible']:
            reason = row['exclusionReason']
            exclusions[reason] = exclusions.get(reason, 0)+1
    coverage = dict(totalTokens=count, includedTokens=len(changes), excludedTokens=count-len(changes), exclusions=exclusions)
    comparison = dict(method=METHOD, at=source['at'], components=components,
        value=(math.fsum(row['delta'] for row in components if row['status'] == 'active')/denominator
               if denominator and not counts['awaiting_history'] and not counts['unavailable'] else None),
        matchedMembers=counts['active'], warmingMembers=counts['warming']+counts['pending'],
        denominator=denominator, awaitingHistoryMembers=counts['awaiting_history'], unavailableMembers=counts['unavailable'])
    marker = dict(sourceMethod=source['method'], sourceAt=source['at'], configuredAt=config['updatedAt'], revision=config['revision'])
    reading = copy.deepcopy(source)
    reading.update(method=config['method'], constituents=count, meme=math.fsum(changes)/count if len(changes) == count else None,
                   coverage=coverage, memeComparison=comparison, membershipProjection=copy.deepcopy(marker))
    observed = [row['observedAt'] for row in basket if type(row.get('observedAt')) in (int, float) and math.isfinite(row['observedAt'])]
    oldest = min(observed, default=None)
    reading['marketObservedAt'] = oldest
    raw = [row['priceChange1h'] for row in basket if type(row.get('priceChange1h')) in (int, float) and math.isfinite(row['priceChange1h'])]
    quality = dict(extremeReturnThreshold=10_000, extremeReturnCount=sum(abs(value) > 10_000 for value in raw),
                   minimumReturn=min(raw, default=None), maximumReturn=max(raw, default=None))
    reading['inputQuality'] = quality
    saved.update(method=config['method'], basket=basket, membershipReading=reading, membershipProjection=marker,
                 updatedAt=source['at'], readingAt=source['at'], rebalancedAt=config['updatedAt'],
                 marketObservedAt=oldest, poolUpdatedAt=oldest, inputQuality=quality, coverage=coverage,
                 error='Preset updated; retained comparisons continue while new members await collection' if counts['pending'] else None)
    return saved


def project_report(report, config):
    """Old collector completions cannot reactivate a superseded roster."""
    from worker.meme_index import public_report
    config = read_config(config)
    saved = public_report(report) if isinstance(report, dict) else dict(version=2, readings=[])
    saved = copy.deepcopy(saved)
    saved.update(presetRevision=config['revision'], presetUpdatedAt=config['updatedAt'],
                 presetAdmissions=copy.deepcopy(config['admissions']))
    saved.pop('membershipReading', None)
    saved.pop('membershipProjection', None)
    source = _membership_source(saved)
    saved_rows = saved.get('readings') if isinstance(saved.get('readings'), list) else []
    latest = next((row for row in reversed(saved_rows) if isinstance(row, dict)
                   and row.get('method') == saved.get('method')), {})
    raw_engine = latest.get('memeComparison')
    admissions_match = True
    if isinstance(raw_engine, dict) and raw_engine.get('method') == 'component-1h-vs24h-v3':
        raw_components = raw_engine.get('components')
        raw_ids = [row.get('id') for row in raw_components if isinstance(row, dict)] if isinstance(raw_components, list) else []
        admissions_match = (isinstance(raw_components, list) and len(raw_components) == len(config['members'])
            and all(isinstance(key, str) for key in raw_ids) and len(set(raw_ids)) == len(config['members'])
            and all(isinstance(row, dict) and config['admissions'].get(row.get('id')) ==
                    dict(kind=row.get('kind'), addedAt=row.get('addedAt')) for row in raw_components))
    if saved.get('method') == config['method'] and admissions_match:
        # Label edits do not change a contract's calculation history.
        names = {(row['network'], row['contract_address']): row for row in config['members']}
        for row in saved.get('basket', []):
            member = names.get((row.get('chain'), row.get('address')))
            if member:
                row.update(symbol=member['symbol'], name=member['name'])
        return saved
    if source is not None:
        projected = _project_membership(saved, config, source)
        if projected is not None:
            return projected
    count = len(config['members'])
    basket = [dict(id=row['network']+':'+row['contract_address'], chain=row['network'],
                   address=row['contract_address'], name=row['name'], symbol=row['symbol'],
                   weight=1/count, source='fixed-preset-1h', priceSource=None, observedAt=None,
                   priceChange1h=None, pool=None, poolCreatedAt=None, eligible=False,
                   exclusionReason='awaiting_collection') for row in config['members']]
    saved.update(version=2, method=config['method'], basket=basket, updatedAt=None,
                 readingAt=None, attemptedAt=None, rebalancedAt=config['updatedAt'],
                 poolUpdatedAt=None, marketObservedAt=None, inputQuality=None,
                 coverage=dict(totalTokens=count, includedTokens=0, excludedTokens=count,
                               exclusions={'awaiting_collection': count}),
                 error='Preset saved; awaiting its first complete collection')
    saved.setdefault('readings', [])
    return saved


def admin_report(config, report):
    """Configuration plus measured quote status, without persisting quote fields."""
    config = read_config(config)
    projected = project_report(report, config)
    quotes = {(row['chain'], row['address']): row for row in projected.get('basket', [])}
    members = []
    for member in config['members']:
        row = quotes.get((member['network'], member['contract_address']), {})
        quote = {key: row.get(key) for key in ('priceChange1h', 'observedAt', 'pool', 'poolCreatedAt')}
        quote.update(eligible=row.get('eligible') is True,
                     exclusionReason=row.get('exclusionReason') or (None if row.get('eligible') is True else 'awaiting_collection'))
        members.append(dict(member, quote=quote, comparison=copy.deepcopy(row.get('comparison'))))
    current = [row for row in projected.get('readings', []) if row.get('method') == config['method']]
    latest = projected.get('membershipReading') or (current[-1] if current else {})
    return dict(config, members=members, coverage=projected.get('coverage'), latestReadingAt=latest.get('at'))


