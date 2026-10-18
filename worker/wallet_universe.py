"""Shared Solana wallet registry, independent Interested flag and provenance."""
import json
import time
from pathlib import Path
from worker.followed_wallets import validate_wallet, CODES
from worker.smart_wallets import group

SOURCES = {'Manual', 'Nansen', 'Fomo', 'Track V2', 'Public'}
NON_SMART_CODES = {'F1', 'F2', 'C1', 'C2', 'S1', 'S2', 'N1', 'N2'}


def smart_status(row):
    flag = row.get('smartMoney')
    return 'smart' if flag is True else 'non-smart' if flag is False else 'unclassified'


def migrate_smart_money(row):
    """One-time conversion of approved legacy eligibility; never used by filters.

    Existing explicit flags survive reruns. Classification corrections apply to
    legacy records only; source defaults preserve the previously selected cohort.
    New imports do not receive eligibility merely from their source.
    """
    result = dict(row)
    if 'smartMoney' not in result:
        code = result.get('code')
        if code in NON_SMART_CODES:
            flag = False
        elif code in {'L1', 'L2'}:
            flag = True
        elif result.get('smartStatus') in ('smart', 'non-smart', 'unclassified'):
            flag = {'smart': True, 'non-smart': False, 'unclassified': None}[result['smartStatus']]
        else:
            flag = True if (set(result.get('sources', [])) | {result.get('source')}) & {'Nansen', 'Fomo'} else None
        result['smartMoney'] = flag
    result['smartStatus'] = smart_status(result)
    return result

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
    sources = value.get('sources', [source])
    aliases = value.get('aliases', [])
    if not isinstance(sources, list) or any(not isinstance(s, str) or s not in SOURCES for s in sources):
        raise ValueError('Choose supported wallet sources')
    if not isinstance(aliases, list) or len(aliases) > 40 or any(not isinstance(s, str) or not s.strip() or len(s) > 80 or any(ord(c) < 32 for c in s) for s in aliases):
        raise ValueError('Invalid wallet aliases')
    row.update(sources=sorted(set(sources) | {source}), aliases=list(dict.fromkeys(s.strip() for s in aliases)))
    status = value.get('smartStatus')
    if status is not None and status not in ('smart', 'non-smart', 'unclassified'):
        raise ValueError('Choose a money classification')
    flag = value.get('smartMoney', {'smart': True, 'non-smart': False}.get(status))
    if flag is not None and type(flag) is not bool:
        raise ValueError('Choose SmartMoney Yes, No or Unreviewed')
    row['smartMoney'] = flag
    row['smartStatus'] = smart_status(row)
    for key, limit in [('label', 120), ('discoveryToken', 44), ('notes', 500)]:
        item = value.get(key, '')
        if not isinstance(item, str) or len(item) > limit or any(ord(c) < 32 and c not in '\n\t' for c in item):
            raise ValueError('Invalid ' + key)
        row[key] = item.strip()
    if row['discoveryToken']:
        validate_wallet(dict(name='Token', address=row['discoveryToken'], code='F1'))
    return row


def merge_import(current, incoming):
    """Merge provenance without replacing a higher-priority research identity."""
    incoming = validate_entry(incoming)
    if not current:
        return incoming
    current = validate_entry(current)
    priority = {'Nansen': 0, 'Fomo': 1, 'Track V2': 2, 'Manual': 3, 'Public': 4}
    winner = current if current['interested'] or priority[current['source']] <= priority[incoming['source']] else incoming
    result = dict(current, **{key: winner[key] for key in ('name', 'source', 'label', 'discoveryToken', 'notes')})
    result['sources'] = sorted(set(current['sources']) | set(incoming['sources']))
    result['aliases'] = list(dict.fromkeys(current['aliases'] + incoming['aliases'] + [current['name'], incoming['name']]))
    result['code'] = current['code'] or incoming['code']
    result['interested'] = current['interested'] or incoming['interested']
    # Imports add provenance; they cannot replace an already reviewed flag.
    result['smartMoney'] = current['smartMoney'] if current['smartMoney'] is not None else incoming['smartMoney']
    return validate_entry(result)


def universe(legacy, overrides=()):
    rows = {}
    for row in legacy:
        rows[row['address']] = dict(row, interested=True, source='Manual', label='Interested Party', discoveryToken='', notes='', addedAt=None)
    cohort = group()
    for row in cohort['wallets']:
        if row['address'] not in rows:
            rows[row['address']] = dict(row, network='solana', code='', smartMoney=True, interested=False, source='Nansen', label='User-supplied Smart Money list', discoveryToken=cohort['token'], notes='', addedAt=None)
    for value in overrides:
        row = validate_entry(value)
        rows[row['address']] = dict(row, addedAt=value.get('addedAt'), updatedAt=value.get('updatedAt'))
    return [dict(row, sources=row.get('sources', [row['source']]), aliases=row.get('aliases', []), smartMoney=row.get('smartMoney'), smartStatus=smart_status(row)) for row in rows.values()]


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
