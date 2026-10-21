"""Forward-only Solana runner counts from shared, timestamped market quotes.

No ATH reconstruction, FDV substitution, or historical supply assumption. The
SQLite ledger survives the market snapshot's five-day expiry and deployments.
"""
import datetime as dt
from contextlib import closing
import json
import math
import os
from pathlib import Path
import sqlite3
import statistics
import time

LEVELS = (500_000, 1_000_000, 5_000_000, 10_000_000)
MINUTE = 60_000
DAY = 24 * 60 * MINUTE
FOLLOWUP = 3 * DAY
SGT = dt.timezone(dt.timedelta(hours=8))
POLICY = {'version': 2, 'baselinePeriods': 2, 'periodHours': [24, 6, 1],
          'minimumRunnerEvents': 10, 'minimumThresholdEvents': 5, 'minimumPeriodCoverage': .9,
          'minimumValuationCoverage': .95, 'followupHours': 72,
          'confirmationMinutes': 15, 'trendChange': .2}


def number(value):
    return (float(value) if isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value >= 0 else None)


def unknown(reason='Awaiting reliable Solana runner history'):
    return {'version': 1, 'mode': 'Unknown', 'score': None, 'ready': False, 'reason': reason,
            'updatedAt': None, 'counts24h': {str(k): None for k in LEVELS},
            'daily': [], 'reliableDays': 0, 'history': {'usable': False, 'periodHours': 1, 'comparablePeriods': 0, 'baselinePeriods': 0}, 'policy': POLICY,
            'scope': 'Observed Solana launchpad-token sample; not a market-wide census'}


def public_report(report, now=None):
    now = int(time.time() * 1000) if now is None else now
    if not report:
        return unknown()
    report = dict(report)
    if report.get('policy', {}).get('version') != POLICY['version']:
        report.update(mode='Unknown', score=None, ready=False, reason='Awaiting a report using usable history and coverage')
    at = number(report.get('updatedAt'))
    if at is None or not 0 <= now - at <= 15 * MINUTE:
        report.update(mode='Unknown', score=None, ready=False, reason='Runner collection is stale or unavailable')
    return report


def day_start(now):
    return int(dt.datetime.fromtimestamp(now / 1000, SGT).replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)


def classify(periods):
    """Two baseline observations plus a current, comparable observation.

    Periods can be hourly, six-hourly or daily; elapsed calendar age is not a gate.
    """
    if len(periods) < POLICY['baselinePeriods'] + 1 or not all(p['reliable'] for p in periods):
        return 'Unknown', 'Need two covered baseline periods and a comparable current period'
    populations = [p['population'] for p in periods]
    if min(populations) <= 0 or max(populations) > min(populations) * 1.25:
        return 'Unknown', 'Observed token coverage changed too much for a comparable trend'
    if sum(p['counts']['500000'] for p in periods) < POLICY['minimumRunnerEvents']:
        return 'Unknown', 'Too few observed runners to establish a direction'
    labels = []
    for threshold in LEVELS:
        values = [p['counts'][str(threshold)] for p in periods]
        if sum(values) < POLICY['minimumThresholdEvents']:
            continue  # Empty high-cap buckets cannot manufacture a neutral signal.
        baseline = statistics.median(values[:-1])
        previous, current = values[-2:]
        if current > previous and current >= previous * (1 + POLICY['trendChange']):
            labels.append('Easy' if current >= baseline else 'Improving')
        elif current < previous and current <= previous * (1 - POLICY['trendChange']):
            labels.append('Cooling' if current >= baseline else 'Hard')
        else:
            labels.append('Balanced')
    for label in ('Easy', 'Improving', 'Balanced', 'Cooling', 'Hard'):
        if labels.count(label) >= 3:
            return label, 'At least three supported thresholds agree across comparable covered periods'
    return 'Unknown', 'Threshold evidence is sparse or does not show a consistent direction'


SCORES = {'Hard': 1, 'Cooling': 2, 'Balanced': 3, 'Improving': 4, 'Easy': 5}


def period_summary(db, start, end):
    slots = db.execute('SELECT reliable,population FROM coverage WHERE slot>=? AND slot<?',
                       (start // (5 * MINUTE), end // (5 * MINUTE))).fetchall()
    coverage = sum(r[0] for r in slots) / ((end - start) / (5 * MINUTE))
    counts = {str(k): 0 for k in LEVELS}
    counts.update({str(k): n for k, n in db.execute(
        'SELECT threshold,COUNT(*) FROM events WHERE at>=? AND at<? GROUP BY threshold', (start, end))})
    return {'startAt': start, 'endAt': end, 'counts': counts, 'coverage': coverage,
            'population': statistics.median(r[1] for r in slots) if slots else 0,
            'reliable': coverage >= POLICY['minimumPeriodCoverage']}


def usable_history(db, now):
    """Reuse retained event/coverage tables. Never bridge an unobserved gap."""
    best = None
    first = db.execute('SELECT MIN(slot) FROM coverage').fetchone()[0]
    for hours in POLICY['periodHours']:
        length = hours * 60 * MINUTE
        end = ((now + 8 * 60 * MINUTE) // length) * length - 8 * 60 * MINUTE
        periods = []
        for offset in range(28):  # Bounded lookback, not a waiting requirement.
            stop = end - offset * length
            if first is None or first * 5 * MINUTE >= stop:
                break
            period = period_summary(db, stop - length, stop)
            if not period['reliable']:
                break
            populations = [p['population'] for p in [period, *periods]]
            if min(populations) <= 0 or max(populations) > min(populations) * 1.25:
                break  # Older incompatible samples do not invalidate a usable recent run.
            periods.insert(0, period)
        mode, reason = classify(periods)
        usable = (len(periods) >= POLICY['baselinePeriods'] + 1
                  and all(p['reliable'] for p in periods)
                  and mode != 'Unknown')
        result = {'usable': usable, 'periodHours': hours, 'comparablePeriods': len(periods),
                  'baselinePeriods': max(0, len(periods) - 1), 'periods': periods,
                  'mode': mode, 'reason': reason}
        if usable:
            return result
        if best is None or len(periods) >= best['comparablePeriods']:
            best = result
    return best


def eligible(row):
    return (row.get('network') == 'solana' and row.get('contract_address')
            and (row.get('dex') in ('pumpfun', 'pumpswap', 'meteoradbc',
                                   'pump-fun', 'pump-swap', 'meteora-dbc')
                 or row.get('launchpadSource') in ('pump-fun', 'meteora-dbc', 'verified-curve')
                 or isinstance(row.get('launchpad'), dict)))


def collect(snapshot, directory):
    now = number(snapshot.get('lastRun'))
    if now is None:
        raise ValueError('Runner collection requires a timestamped market snapshot')
    now = int(now)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    rows = {}
    for field in ('coins', 'radarCoins'):
        for row in snapshot.get(field, []):
            if eligible(row):
                mint = row['contract_address']  # Solana addresses are case-sensitive.
                if mint not in rows or (number((row.get('runnerMarket') or {}).get('at')) or 0) > (
                        number((rows[mint].get('runnerMarket') or {}).get('at')) or 0):
                    rows[mint] = row
    with closing(sqlite3.connect(directory / 'runner-mode.sqlite')) as db, db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS tokens (
                mint TEXT PRIMARY KEY, admitted INTEGER NOT NULL, last_at INTEGER,
                seen INTEGER NOT NULL DEFAULT 0, pending TEXT NOT NULL DEFAULT '{}');
            CREATE TABLE IF NOT EXISTS events (
                mint TEXT NOT NULL, threshold INTEGER NOT NULL, at INTEGER NOT NULL,
                first_at INTEGER NOT NULL, available_at INTEGER NOT NULL,
                cap REAL NOT NULL, liquidity REAL NOT NULL,
                PRIMARY KEY (mint, threshold));
            CREATE INDEX IF NOT EXISTS event_time ON events(at);
            CREATE INDEX IF NOT EXISTS admission_time ON tokens(admitted);
            CREATE TABLE IF NOT EXISTS coverage (
                slot INTEGER PRIMARY KEY, reliable INTEGER NOT NULL, population INTEGER NOT NULL);
        ''')
        # Admit all eligible discoveries, including records with missing caps.
        db.executemany('INSERT OR IGNORE INTO tokens(mint,admitted) VALUES (?,?)',
                       [(mint, now) for mint in rows])
        active = db.execute('SELECT mint,admitted,last_at,seen,pending FROM tokens WHERE admitted>?',
                            (now - FOLLOWUP,)).fetchall()
        valid = 0
        for mint, admitted, last_at, seen, pending_json in active:
            quote = (rows.get(mint) or {}).get('runnerMarket') or {}
            at, cap = number(quote.get('at')), number(quote.get('cap'))
            liquidity, volume = number(quote.get('liquidity')), number(quote.get('volume24h'))
            if (at is None or not 0 <= now - at <= 15 * MINUTE or cap is None
                    or cap > 1e12 or liquidity is None or volume is None):
                continue
            valid += 1
            if last_at is not None and at <= last_at:
                continue  # Reused cached quotes never confirm a crossing twice.
            pending = json.loads(pending_json)
            if last_at is None:
                # Initial above-threshold stocks are baselines, not new runners.
                seen = sum(1 << i for i, level in enumerate(LEVELS) if cap >= level)
                pending = {}
            else:
                for i, level in enumerate(LEVELS):
                    key = str(level)
                    if seen & (1 << i):
                        continue
                    if cap >= level and liquidity >= 3000 and volume > 0:
                        first = pending.get(key)
                        if first is not None and 0 < at - first <= 15 * MINUTE:
                            db.execute('INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?)',
                                       (mint, level, int(at), int(first), now, cap, liquidity))
                            seen |= 1 << i
                            pending.pop(key, None)
                        else:
                            pending[key] = at
                    else:
                        pending.pop(key, None)
            db.execute('UPDATE tokens SET last_at=?,seen=?,pending=? WHERE mint=?',
                       (int(at), seen, json.dumps(pending), mint))
        feeds = snapshot.get('feeds', {})
        sources_ok = all(feeds.get(key, {}).get('status') == 'ok'
                         and not feeds[key].get('error')
                         and (number(feeds[key].get('lastSuccess')) or 0) >= now - 15 * MINUTE
                         for key in ('solana', 'launchpad_pools', 'dex_market'))
        fraction = valid / len(active) if active else 0
        reliable = bool(active) and sources_ok and fraction >= POLICY['minimumValuationCoverage']
        # Idempotent five-minute slots. Reruns cannot manufacture coverage.
        db.execute('INSERT OR IGNORE INTO coverage VALUES (?,?,?)',
                   (now // (5 * MINUTE), int(reliable), len(active)))
        db.execute('DELETE FROM coverage WHERE slot<?', ((now - 100 * DAY) // (5 * MINUTE),))
        days = []
        midnight = day_start(now)
        first_slot = db.execute('SELECT MIN(slot) FROM coverage').fetchone()[0]
        for offset in range(30, 0, -1):
            start = midnight - offset * DAY
            if first_slot is None or first_slot * 5 * MINUTE >= start + DAY:
                continue
            slots = db.execute('SELECT reliable,population FROM coverage WHERE slot>=? AND slot<?',
                               (start // (5 * MINUTE), (start + DAY) // (5 * MINUTE))).fetchall()
            coverage = sum(r[0] for r in slots) / 288
            counts = {str(k): 0 for k in LEVELS}
            counts.update({str(k): n for k, n in db.execute(
                'SELECT threshold,COUNT(*) FROM events WHERE at>=? AND at<? GROUP BY threshold', (start, start + DAY))})
            days.append({'date': dt.datetime.fromtimestamp(start / 1000, SGT).date().isoformat(),
                         'counts': counts, 'coverage': coverage,
                         'population': statistics.median(r[1] for r in slots) if slots else 0,
                         'reliable': coverage >= POLICY['minimumPeriodCoverage']})
        counts = {str(k): 0 for k in LEVELS}
        counts.update({str(k): n for k, n in db.execute(
            'SELECT threshold,COUNT(*) FROM events WHERE at>? AND at<=? GROUP BY threshold', (now - DAY, now))})
        history = usable_history(db, now)
        mode, reason = history['mode'], history['reason']
        if not reliable:
            mode, reason = 'Unknown', 'Current source or valuation coverage is incomplete'
        consecutive = 0
        for day in reversed(days):
            if not day['reliable']:
                break
            consecutive += 1
        report = {**unknown(), 'mode': mode, 'ready': mode != 'Unknown', 'reason': reason,
                  'score': SCORES.get(mode), 'history': history,
                  'updatedAt': now, 'counts24h': counts, 'daily': days,
                  'reliableDays': consecutive,
                  'coverage': {'eligibleTokens': len(active), 'valuedTokens': valid,
                               'valuationFraction': fraction, 'sourcesOk': sources_ok,
                               'reliable': reliable},
                  'definition': 'Unique mints first observed crossing each market-cap threshold after a baseline below it; two distinct quotes within 15 minutes, liquidity at least $3K and positive 24H volume. Initial above-threshold tokens and repeat reclaims are excluded. Follow-up is 72 hours from admission; gaps remain unknown. Not first lifetime crossings or all Solana memes.',
                  'classification': 'Provisional descriptive score: 1 Hard, 2 Cooling, 3 Balanced, 4 Improving, 5 Easy; unknown has no score. Compare adjacent equal-length 24H, 6H or 1H periods using existing covered history, with two earlier baseline periods. Each period needs at least 90% reliable five-minute slots; each slot needs 95% fresh valuation coverage. Population variation is at most 25%, at least ten $500K events and five events at each of three agreeing thresholds. Daily history length alone never unlocks a score. Not a validated trading signal.'}

    destination = directory / 'runner-mode.json'
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report, allow_nan=False), encoding='utf-8')
    os.replace(temporary, destination)
    return report
