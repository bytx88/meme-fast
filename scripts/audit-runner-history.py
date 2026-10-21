"""Read-only audit of saved market snapshots and an optional downloaded ledger.

No snapshots are imported and no scalar cap/FDV is assigned a fabricated time.
"""
import argparse
from contextlib import closing
import datetime as dt
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker.runner_mode import eligible, number, usable_history


def audit_snapshot(path):
    raw = path.read_bytes()
    data = json.loads(raw)
    if not isinstance(data, dict):
        return None
    rows = {}
    for field in ('coins', 'radarCoins', 'competitionCoins', 'tokens'):
        values = data.get(field)
        if not isinstance(values, list):
            continue
        for row in values:
            if isinstance(row, dict) and row.get('network') == 'solana' and row.get('contract_address'):
                old = rows.get(row['contract_address'])
                if old is None or (number((row.get('runnerMarket') or {}).get('at')) or 0) > (
                        number((old.get('runnerMarket') or {}).get('at')) or 0):
                    rows[row['contract_address']] = row
    if not rows:
        return None
    points = [p for r in rows.values() for field in ('marketHistory', 'marketHistoryHourly', 'priceHistory5m')
              for p in r.get(field, []) if isinstance(p, dict)]
    quotes = [r['runnerMarket'] for r in rows.values() if isinstance(r.get('runnerMarket'), dict)]
    times = [p['at'] for p in points if number(p.get('at')) is not None]
    return {'file': path.name, 'sha256': hashlib.sha256(raw).hexdigest(),
            'snapshotAt': data.get('lastRun'), 'solanaMints': len(rows),
            'eligibleMints': sum(bool(eligible(r)) for r in rows.values()),
            'scalarCaps': sum(number(r.get('mc')) is not None for r in rows.values()),
            'historyPoints': len(points),
            'timestampedHistoricalCaps': sum(number(p.get('at')) is not None and any(
                number(p.get(k)) is not None for k in ('cap', 'mc', 'marketCap')) for p in points),
            'atomicRunnerQuotes': sum(number(q.get('cap')) is not None and number(q.get('at')) is not None
                                     for q in quotes),
            'historyRange': [min(times), max(times)] if times else None}


def audit_ledger(path):
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        result = {table: db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
                  for table in ('tokens', 'events', 'coverage')}
        result['reliableSlots'] = db.execute('SELECT COUNT(*) FROM coverage WHERE reliable=1').fetchone()[0]
        result['coverageRange'] = db.execute('SELECT MIN(slot)*300000,MAX(slot)*300000 FROM coverage').fetchone()
        result['history'] = usable_history(db, result['coverageRange'][1]) if result['coverageRange'][1] else None
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--ledger', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    snapshots, duplicates, hashes = [], [], set()
    for path in sorted(args.directory.glob('*.json')):
        try:
            result = audit_snapshot(path)
        except (ValueError, OSError):
            continue
        if result is None:
            continue
        if result['sha256'] in hashes:
            duplicates.append(result['file'])
            continue
        hashes.add(result['sha256'])
        snapshots.append(result)
    report = {'auditedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
              'snapshots': snapshots, 'duplicateCopies': duplicates,
              'ledger': audit_ledger(args.ledger) if args.ledger else None,
              'conclusion': 'Reuse the existing runner event/coverage ledger in place. Older scalar mc values lack dedicated valuation timestamps; market refresh historically changed fetchedAt/marketUpdatedAt without updating mc. Price-only histories, FDV, aggregate basket returns and duplicate copies do not establish crossing events or gap-free coverage. No unsupported records are imported.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'uniqueSnapshots': len(snapshots), 'duplicates': duplicates,
                      'historicalCapPoints': sum(r['timestampedHistoricalCaps'] for r in snapshots),
                      'atomicQuotes': sum(r['atomicRunnerQuotes'] for r in snapshots),
                      'ledger': report['ledger']}))


if __name__ == '__main__':
    main()
