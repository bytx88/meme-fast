"""Shared Solana wallet registry, independent Interested flag and provenance."""
import json
import time
from pathlib import Path
from worker.followed_wallets import validate_wallet, CODES
from worker.smart_wallets import group

SOURCES = {'Manual', 'Nansen', 'Fomo'}

def validate_entry(value):
    if not isinstance(value, dict):
        raise ValueError('Enter wallet details')
    code = value.get('code', '')
    if not isinstance(code, str):
        raise ValueError('Unsupported class')
    row = validate_wallet(dict(value, code=code or 'F1'))
    row['code'] = code
    if code and code not in CODES:
        raise ValueError('Unsupported class')
    source = value.get('source', 'Manual')
    interested = value.get('interested', False)
    if source not in SOURCES or not isinstance(interested, bool):
        raise ValueError('Choose a source and Interested flag')
    row.update(source=source, interested=interested)
    for key, limit in [('label', 120), ('discoveryToken', 44), ('notes', 500)]:
        item = value.get(key, '')
        if not isinstance(item, str) or len(item) > limit or any(ord(c) < 32 and c not in '\n\t' for c in item):
            raise ValueError('Invalid ' + key)
        row[key] = item.strip()
    if row['discoveryToken']:
        validate_wallet(dict(name='Token', address=row['discoveryToken'], code='F1'))
    return row


def universe(legacy, overrides=()):
    rows = {}
    for row in legacy:
        rows[row['address']] = dict(row, interested=True, source='Manual', label='Interested Party', discoveryToken='', notes='', addedAt=None)
    cohort = group()
    for row in cohort['wallets']:
        if row['address'] not in rows:
            rows[row['address']] = dict(row, network='solana', code='', interested=False, source='Nansen', label='User-supplied Smart Money list', discoveryToken=cohort['token'], notes='', addedAt=None)
    for value in overrides:
        row = validate_entry(value)
        rows[row['address']] = dict(row, addedAt=value.get('addedAt'), updatedAt=value.get('updatedAt'))
    return list(rows.values())


def report(registry, holdings):
    previous = {row['address']: row for row in holdings.get('wallets', [])}
    wallets = []
    for row in registry:
        old = previous.get(row['address'], {})
        wallets.append(dict(row, **{key: old.get(key) for key in ('checkedAt', 'attemptedAt')}, status=old.get('status', 'unavailable'), mints=old.get('mints', [])))
    return dict(version=1, attemptedAt=holdings.get('attemptedAt'), wallets=wallets)


def local_report():
    from worker.followed_wallets import registry_wallets
    try:
        overrides = json.loads(Path('.data/wallet-universe.json').read_text())
    except (OSError, ValueError):
        overrides = []
    try:
        holdings = json.loads(Path('.data/followed-wallets.json').read_text())
    except (OSError, ValueError):
        holdings = {}
    return report(universe(registry_wallets(), overrides), holdings)
