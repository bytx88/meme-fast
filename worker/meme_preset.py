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


def default_config():
    members = validate_members(json.loads(Path(__file__).with_name('meme-index-preset.json').read_text(encoding='utf-8')))
    revision = hashlib.sha256(json.dumps(members, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:20]
    return dict(version=1, revision='seed-'+revision, members=members, updatedAt=None, method=method_for(members))


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
    return dict(version=1, revision=revision, members=members, updatedAt=stamp, method=method_for(members))


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
    return dict(version=1, revision=revision, members=members, updatedAt=now, method=method_for(members))


def project_report(report, config):
    """Old collector completions cannot reactivate a superseded roster."""
    from worker.meme_index import public_report
    config = read_config(config)
    saved = public_report(report) if isinstance(report, dict) else dict(version=2, readings=[])
    saved = copy.deepcopy(saved)
    saved.update(presetRevision=config['revision'], presetUpdatedAt=config['updatedAt'])
    if saved.get('method') == config['method']:
        # Label edits do not change a contract's calculation history.
        names = {(row['network'], row['contract_address']): row for row in config['members']}
        for row in saved.get('basket', []):
            member = names.get((row.get('chain'), row.get('address')))
            if member:
                row.update(symbol=member['symbol'], name=member['name'])
        return saved
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
    latest = current[-1] if current else {}
    return dict(config, members=members, coverage=projected.get('coverage'), latestReadingAt=latest.get('at'))


