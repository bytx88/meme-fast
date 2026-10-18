"""Local preview persistence, isolated from deployed registry data."""
import json
import sys
import time
from pathlib import Path
from worker.wallet_universe import local_report, validate_entry
from worker.wallet_activity import analyze


def handle(method, value):
    report = local_report()
    if method == 'GET':
        return report
    if method == 'ACTIVITY':
        if not any(row['address'] == value for row in report['wallets']):
            raise ValueError('Choose a wallet in the universe')
        return analyze(value)
    current = next((row for row in report['wallets'] if row['address'] == value.get('address')), None)
    if method == 'POST' and current:
        raise ValueError('Wallet already in the universe')
    if method == 'PATCH' and not current:
        raise ValueError('Wallet not found')
    row = validate_entry(dict(current or {}, **value))
    now = int(time.time() * 1000)
    row.update(addedAt=current.get('addedAt') if current else now, updatedAt=now)
    path = Path('.data/wallet-universe.json')
    try:
        overrides = json.loads(path.read_text())
    except (OSError, ValueError):
        overrides = []
    overrides = [old for old in overrides if old['address'] != row['address']] + [row]
    path.parent.mkdir(exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(overrides))
    temporary.replace(path)
    return {'wallet': row}


if __name__ == '__main__':
    print(json.dumps(handle(sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else None)))
