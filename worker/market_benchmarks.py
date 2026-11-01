"""Hourly BTC/Alt observations independent of the optional Meme basket."""
import json
import math
import time
from pathlib import Path

HOUR = 3600000
SOURCE = 'coinlore-benchmarks-1h-v1'


def read(path):
    try:
        report = json.loads(Path(path).read_text(encoding='utf-8'))
        if report.get('version') == 1 and report.get('source') == SOURCE and isinstance(report.get('readings'), list):
            return report
    except (OSError, ValueError, AttributeError):
        pass
    return dict(version=1, source=SOURCE, readings=[])


def collect(path, sources=None, now=None):
    from worker.meme_index import Sources, write_json
    now = int(time.time()*1000) if now is None else now
    report = read(path)
    updated = report.get('updatedAt')
    if isinstance(updated, (int, float)) and 0 <= now-updated and now//HOUR == updated//HOUR:
        return report
    report['attemptedAt'] = now
    try:
        quote = (sources or Sources()).alt(now)
        valid = lambda key: type(quote.get(key)) in (int, float) and math.isfinite(quote[key])
        if not valid('providerAt') or not any(valid(key) for key in ('hourChange', 'btcDelta')):
            raise ValueError('Incomplete BTC/Alt observation')
        if not 0 <= now-quote['providerAt'] < 15*60000:
            raise ValueError('Stale BTC/Alt observation')
        report['readings'].append(dict(at=quote['providerAt'], meme=None,
            altDelta=quote['hourChange'] if valid('hourChange') else None,
            btcDelta=quote['btcDelta'] if valid('btcDelta') else None, method=SOURCE))
        report.update(updatedAt=quote['providerAt'], error=None if all(valid(key) for key in ('hourChange','btcDelta'))
                      else 'Partial BTC/Alt observation; missing inputs remain unavailable')
    except Exception:
        report['error'] = 'BTC/Alt provider unavailable; saved observations retained'
    report['readings'] = [row for row in report['readings'] if 0 <= now-row.get('at', 0) <= 31*24*HOUR]
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, report)
    return report


def merge(report, benchmarks):
    if not benchmarks.get('readings'):
        return report
    return dict(report, readings=sorted([*report.get('readings', []), *benchmarks['readings']], key=lambda row: row['at']),
        benchmarkCollection={key: benchmarks.get(key) for key in ('updatedAt', 'attemptedAt', 'error')})


if __name__ == '__main__':
    import sys
    print(json.dumps(collect(sys.argv[1])))
