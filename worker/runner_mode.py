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
POLICY = {'version': 1, 'historyDays': 14, 'minimumDailyCoverage': .9,
          'minimumValuationCoverage': .95, 'followupHours': 72,
          'confirmationMinutes': 15, 'trendChange': .2}


def number(value):
    return (float(value) if isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value >= 0 else None)


def unknown(reason='Awaiting reliable Solana runner history'):
    return {'version': 1, 'mode': 'Unknown', 'ready': False, 'reason': reason,
            'updatedAt': None, 'counts24h': {str(k): None for k in LEVELS},
            'daily': [], 'reliableDays': 0, 'policy': POLICY,
            'scope': 'Observed Solana launchpad-token sample; not a market-wide census'}


def public_report(report, now=None):
    now = int(time.time() * 1000) if now is None else now
    if not report:
        return unknown()
    report = dict(report)
    at = number(report.get('updatedAt'))
    if at is None or not 0 <= now - at <= 15 * MINUTE:
        report.update(mode='Unknown', ready=False, reason='Runner collection is stale or unavailable')
    return report


def day_start(now):
    return int(dt.datetime.fromtimestamp(now / 1000, SGT).replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)


def classify(days):
    """Descriptive provisional rule, gated on 14 comparable, complete SGT days."""
    if len(days) < 14 or not all(d['reliable'] for d in days[-14:]):
        return 'Unknown', 'Need 14 consecutive complete SGT days with reliable coverage'
    recent = days[-14:]
    populations = [d['population'] for d in recent]
    if min(populations) <= 0 or max(populations) > min(populations) * 1.25:
        return 'Unknown', 'Observed token coverage changed too much for a comparable trend'
    if sum(d['counts']['500000'] for d in recent) < 10:
        return 'Unknown', 'Too few observed runners to establish a direction'
    labels = []
    for threshold in LEVELS:
        values = [d['counts'][str(threshold)] for d in recent]
        baseline = statistics.median(values)
        yesterday, current = values[-2:]
        if current > yesterday and current >= yesterday * 1.2:
            labels.append('Easy' if current >= baseline else 'Improving')
        elif current < yesterday and current <= yesterday * .8:
            labels.append('Cooling' if current >= baseline else 'Hard')
    for label in ('Easy', 'Improving', 'Cooling', 'Hard'):
        if labels.count(label) >= 3:
            return label, 'At least three thresholds agree versus the previous complete SGT day'
    return 'Unknown', 'Threshold counts do not yet show a consistent direction'


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
        for offset in range(14, 0, -1):
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
                         'reliable': coverage >= POLICY['minimumDailyCoverage']})
        counts = {str(k): 0 for k in LEVELS}
        counts.update({str(k): n for k, n in db.execute(
            'SELECT threshold,COUNT(*) FROM events WHERE at>? AND at<=? GROUP BY threshold', (now - DAY, now))})
        mode, reason = classify(days)
        if not reliable:
            mode, reason = 'Unknown', 'Current source or valuation coverage is incomplete'
        consecutive = 0
        for day in reversed(days):
            if not day['reliable']:
                break
            consecutive += 1
        report = {**unknown(), 'mode': mode, 'ready': mode != 'Unknown', 'reason': reason,
                  'updatedAt': now, 'counts24h': counts, 'daily': days,
                  'reliableDays': consecutive,
                  'coverage': {'eligibleTokens': len(active), 'valuedTokens': valid,
                               'valuationFraction': fraction, 'sourcesOk': sources_ok,
                               'reliable': reliable},
                  'definition': 'Unique mints first observed crossing each market-cap threshold after a baseline below it; two distinct quotes within 15 minutes, liquidity at least $3K and positive 24H volume. Initial above-threshold tokens and repeat reclaims are excluded. Follow-up is 72 hours from admission; gaps remain unknown. Not first lifetime crossings or all Solana memes.',
                  'classification': 'Provisional descriptive rule: 14 complete SGT days, at least 90% reliable five-minute slots per day and 95% fresh valuation coverage per slot; population variation at most 25%; at least 10 $500K runners. Three thresholds must agree on a daily count change of at least 20%; high/low uses the 14-day median. Not a validated trading signal.'}
    destination = directory / 'runner-mode.json'
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report, allow_nan=False), encoding='utf-8')
    os.replace(temporary, destination)
    return report
