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
POLICY = {'version': 6, 'provisionalBaselinePeriods': 1, 'minimumPopulation': 50, 'cohortCapacity': 300, 'baselinePeriods': 2, 'periodHours': [24, 6, 1],
          'minimumRunnerEvents': 10, 'minimumThresholdEvents': 5, 'minimumPeriodCoverage': .9,
          'minimumValuationCoverage': .95, 'minimumObservationCoverage': .95, 'followupHours': 72,
          'confirmationMinutes': 15, 'trendChange': .2}

CLASSIFICATION = 'Descriptive score for a bounded rolling sample of observable Solana markets: 1 Hard, 2 Cooling, 3 Balanced, 4 Improving, 5 Easy; unknown has no score. All admitted mints remain tracked for 72 hours, including fallen or missing markets. At least 50 tracked markets are required. Initially, provisional Mode compares the oldest covered hour with the latest complete covered hour for the same observed tokens. Full Mode uses two baseline periods and a current covered 24H, 6H or 1H period. Each period needs 90% reliable five-minute slots; each slot needs 95% fresh runner-observation coverage of the entire cohort: an actual market-cap valuation or independent exact-mint aggregate zero 24H volume. Inactive observations never supply a cap or crossing. Discovery freshness is reported separately and does not certify market-wide coverage. A fully covered absence of sustained runners is Hard; sparse positive or conflicting evidence stays unknown. Not a validated predictive signal.'


def number(value):
    return (float(value) if isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value >= 0 else None)


def unknown(reason='Awaiting reliable Solana runner history'):
    return {'version': 1, 'mode': 'Unknown', 'score': None, 'ready': False, 'reason': reason,
            'updatedAt': None, 'counts24h': {str(k): None for k in LEVELS},
            'daily': [], 'reliableDays': 0, 'history': {'usable': False, 'periodHours': 1, 'comparablePeriods': 0, 'baselinePeriods': 0}, 'policy': POLICY,
            'scope': 'Bounded rolling sample of observable Solana markets; not a market-wide census'}


def public_report(report, now=None):
    now = int(time.time() * 1000) if now is None else now
    if not report:
        return unknown()
    report = dict(report)
    report['classification'] = CLASSIFICATION
    if (report.get('policy', {}).get('version') != POLICY['version']
            or not report.get('coverage', {}).get('reservedPass')):
        report.update(mode='Unknown', score=None, ready=False, policy=POLICY,
                      history=unknown()['history'], counts24h=unknown()['counts24h'],
                      coverage={'eligibleTokens': 0, 'valuedTokens': 0, 'reliable': False},
                      reason='Awaiting the reserved Mode cohort quote pass')
    at = number(report.get('updatedAt'))
    if at is None or not 0 <= now - at <= 15 * MINUTE:
        report.update(mode='Unknown', score=None, ready=False, reason='Runner collection is stale or unavailable')
    return report


def day_start(now):
    return int(dt.datetime.fromtimestamp(now / 1000, SGT).replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)


def classify(periods, provisional=False):
    """Two baseline observations plus a current, comparable observation.

    Periods can be hourly, six-hourly or daily; elapsed calendar age is not a gate.
    """
    if len(periods) < (2 if provisional else POLICY['baselinePeriods'] + 1) or not all(p['reliable'] for p in periods):
        return 'Unknown', 'Need two covered baseline periods and a comparable current period'
    populations = [p['population'] for p in periods]
    if min(populations) < POLICY['minimumPopulation']:
        return 'Unknown', 'Need at least 50 tracked markets with comparable covered observations'
    if max(populations) > min(populations) * 1.25:
        return 'Unknown', 'Observed token coverage changed too much for a comparable trend'
    if all(periods[-1]['counts'][str(k)] == 0 for k in LEVELS):
        return 'Hard', 'No sustained runners observed in the current adequately covered cohort period'
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
            labels.append('Improving' if provisional else 'Easy' if current >= baseline else 'Improving')
        elif current < previous and current <= previous * (1 - POLICY['trendChange']):
            labels.append('Cooling' if provisional else 'Cooling' if current >= baseline else 'Hard')
        else:
            labels.append('Balanced')
    for label in ('Easy', 'Improving', 'Balanced', 'Cooling', 'Hard'):
        if labels.count(label) >= 3:
            return label, 'At least three supported thresholds agree across comparable covered periods'
    return 'Unknown', 'Threshold evidence is sparse or does not show a consistent direction'


SCORES = {'Hard': 1, 'Cooling': 2, 'Balanced': 3, 'Improving': 4, 'Easy': 5}


def period_summary(db, start, end, managed=False):
    coverage_table = 'monitor_coverage' if managed else 'coverage'
    event_table = 'monitor_events' if managed else 'events'
    slots = db.execute(f'SELECT reliable,population FROM {coverage_table} WHERE slot>=? AND slot<?',
                       (start // (5 * MINUTE), end // (5 * MINUTE))).fetchall()
    coverage = sum(r[0] for r in slots) / ((end - start) / (5 * MINUTE))
    counts = {str(k): 0 for k in LEVELS}
    counts.update({str(k): n for k, n in db.execute(
        f'SELECT threshold,COUNT(*) FROM {event_table} WHERE at>=? AND at<? GROUP BY threshold', (start, end))})
    return {'startAt': start, 'endAt': end, 'counts': counts, 'coverage': coverage,
            'population': statistics.median(r[1] for r in slots) if slots else 0,
            'reliable': coverage >= POLICY['minimumPeriodCoverage']}


def usable_history(db, now, managed=False):
    """Reuse retained event/coverage tables. Never bridge an unobserved gap."""
    best = None
    coverage_table = 'monitor_coverage' if managed else 'coverage'
    first = db.execute(f'SELECT MIN(slot) FROM {coverage_table}').fetchone()[0]
    for hours in POLICY['periodHours']:
        length = hours * 60 * MINUTE
        end = ((now + 8 * 60 * MINUTE) // length) * length - 8 * 60 * MINUTE
        periods = []
        for offset in range(28):  # Bounded lookback, not a waiting requirement.
            stop = end - offset * length
            if first is None or first * 5 * MINUTE >= stop:
                break
            period = period_summary(db, stop - length, stop, managed)
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


def provisional_history(db, now):
    """Compare endpoints only, without certifying intervening gaps or changing events."""
    hour = 60 * MINUTE
    end = now // hour * hour
    latest = period_summary(db, end-hour, end, managed=True)
    result = {'usable': False, 'provisional': True, 'periodHours': 1,
              'comparablePeriods': 0, 'baselinePeriods': 0, 'periods': [],
              'mode': 'Unknown', 'reason': 'Need two complete covered hours for provisional Mode'}
    if not latest['reliable']:
        return result
    first = db.execute('SELECT MIN(slot) FROM monitor_coverage').fetchone()[0]
    if first is None:
        return result
    start = max(first * 5 * MINUTE // hour * hour, end - 7 * DAY)
    def observed_mints(period):
        return {mint for mint, slots in db.execute(
            'SELECT mint,COUNT(DISTINCT slot) FROM ('
            'SELECT mint,slot FROM monitor_token_slots WHERE slot>=? AND slot<? '
            'UNION ALL SELECT mint,CAST(received_at / ? AS INTEGER) FROM monitor_observations '
            'WHERE received_at>=? AND received_at<? '
            'UNION ALL SELECT mint,CAST(received_at / ? AS INTEGER) FROM monitor_inactive_observations '
            'WHERE received_at>=? AND received_at<?) GROUP BY mint',
            (period['startAt']//(5*MINUTE), period['endAt']//(5*MINUTE),
             5*MINUTE, period['startAt'], period['endAt'],
             5*MINUTE, period['startAt'], period['endAt']))
            if slots / 12 >= POLICY['minimumPeriodCoverage']}
    latest_mints = observed_mints(latest)
    for old_start in range(start, end-hour, hour):
        oldest = period_summary(db, old_start, old_start+hour, managed=True)
        if not oldest['reliable']:
            continue
        shared = observed_mints(oldest) & latest_mints
        if (len(shared) < POLICY['minimumPopulation'] or
                len(shared) < max(oldest['population'], latest['population']) * POLICY['minimumValuationCoverage']):
            continue
        periods = []
        for period in (oldest, latest):
            counts = {str(k): 0 for k in LEVELS}
            for mint, threshold in db.execute(
                    'SELECT mint,threshold FROM monitor_events WHERE at>=? AND at<?',
                    (period['startAt'], period['endAt'])):
                if mint in shared:
                    counts[str(threshold)] += 1
            periods.append({**period, 'counts': counts, 'population': len(shared)})
        mode, reason = classify(periods, provisional=True)
        return {**result, 'usable': mode != 'Unknown', 'comparablePeriods': 2,
                'baselinePeriods': 1, 'periods': periods, 'matchedTokens': len(shared),
                'mode': mode, 'reason': 'Provisional: oldest covered hour versus latest complete hour. ' + reason}
    return result


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
    managed = isinstance(snapshot.get('runnerCohort'), dict)
    token_table = 'monitor_tokens' if managed else 'tokens'
    event_table = 'monitor_events' if managed else 'events'
    coverage_table = 'monitor_coverage' if managed else 'coverage'
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    rows = {}
    members = {m['mint']: m for m in snapshot.get('runnerCohort', {}).get('members', [])} if managed else {}
    for field in ('coins', 'radarCoins'):
        for row in snapshot.get(field, []):
            if ((managed and row.get('network') == 'solana' and row.get('contract_address') in members)
                    or (not managed and eligible(row))):
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
        db.executescript('''
            CREATE TABLE IF NOT EXISTS monitor_tokens (
                mint TEXT PRIMARY KEY, admitted INTEGER NOT NULL, last_at INTEGER,
                seen INTEGER NOT NULL DEFAULT 0, pending TEXT NOT NULL DEFAULT '{}');
            CREATE TABLE IF NOT EXISTS monitor_events (
                mint TEXT NOT NULL, threshold INTEGER NOT NULL, at INTEGER NOT NULL,
                first_at INTEGER NOT NULL, available_at INTEGER NOT NULL,
                cap REAL NOT NULL, liquidity REAL NOT NULL, PRIMARY KEY(mint,threshold));
            CREATE INDEX IF NOT EXISTS monitor_event_time ON monitor_events(at);
            CREATE INDEX IF NOT EXISTS monitor_admission_time ON monitor_tokens(admitted);
            CREATE TABLE IF NOT EXISTS monitor_coverage (
                slot INTEGER PRIMARY KEY, reliable INTEGER NOT NULL, population INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS monitor_observations (
                mint TEXT NOT NULL, at INTEGER NOT NULL, received_at INTEGER NOT NULL,
                cap REAL NOT NULL, liquidity REAL NOT NULL, volume REAL NOT NULL,
                PRIMARY KEY(mint,at));
            CREATE TABLE IF NOT EXISTS monitor_inactive_observations (
                mint TEXT NOT NULL, at INTEGER NOT NULL, received_at INTEGER NOT NULL,
                token_reserve REAL NOT NULL, volume REAL NOT NULL, source TEXT NOT NULL,
                PRIMARY KEY(mint,at));
            CREATE TABLE IF NOT EXISTS monitor_token_slots (
                mint TEXT NOT NULL, slot INTEGER NOT NULL, observed_at INTEGER NOT NULL,
                source_at INTEGER NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(mint,slot));
            CREATE INDEX IF NOT EXISTS monitor_token_slot_time ON monitor_token_slots(slot);
            CREATE INDEX IF NOT EXISTS monitor_observation_received ON monitor_observations(received_at);
            CREATE INDEX IF NOT EXISTS monitor_inactive_received ON monitor_inactive_observations(received_at);
        ''')
        # Admit all eligible discoveries, including records with missing caps.
        db.executemany(f'INSERT OR IGNORE INTO {token_table}(mint,admitted) VALUES (?,?)',
                       [(mint, int(members[mint]['admittedAt']) if managed else now) for mint in rows])
        if managed:
            # Preserve legacy first-observed threshold exclusions without mixing
            # its incomplete coverage or counts into the new monitored sample.
            db.execute("UPDATE monitor_tokens SET seen=seen | COALESCE((SELECT seen FROM tokens WHERE tokens.mint=monitor_tokens.mint),0) WHERE last_at IS NULL")
        active = db.execute(f'SELECT mint,admitted,last_at,seen,pending FROM {token_table} WHERE admitted>?',
                            (now - FOLLOWUP,)).fetchall()
        valid, inactive = 0, 0
        sampled_slots = []
        gaps = {}
        for mint, admitted, last_at, seen, pending_json in active:
            quote = (rows.get(mint) or {}).get('runnerMarket') or {}
            at, cap = number(quote.get('at')), number(quote.get('cap'))
            liquidity, volume = number(quote.get('liquidity')), number(quote.get('volume24h'))
            if (managed and cap is None and quote.get('status') == 'observed-nonqualifying'
                    and quote.get('source') == 'GeckoTerminal'
                    and quote.get('evidence') == 'token-aggregate-activity'
                    and at is not None and 0 <= now-at <= 15*MINUTE
                    and (last_at is None or at >= last_at)
                    and number(quote.get('tokenReserveUsd')) is not None and volume == 0):
                inactive += 1
                sampled_slots.append((mint, now//(5*MINUTE), now, int(at), 'zero-volume'))
                db.execute('INSERT OR IGNORE INTO monitor_inactive_observations VALUES (?,?,?,?,?,?)',
                           (mint, int(at), now, number(quote['tokenReserveUsd']), volume, quote['source']))
                # Missing caps cannot set threshold bits, initialise a valuation,
                # confirm a crossing, or connect confirmations across this gap.
                db.execute("UPDATE monitor_tokens SET pending='{}' WHERE mint=?", (mint,))
                continue
            if (at is None or not 0 <= now - at <= 15 * MINUTE or cap is None
                    or cap > 1e12 or liquidity is None or volume is None):
                cause = 'missingQuote' if not quote else 'staleOrInvalidTime' if at is None or not 0 <= now-at <= 15*MINUTE else 'missingCap' if cap is None else 'invalidCap' if cap > 1e12 else 'missingLiquidityOrVolume'
                gaps[cause] = gaps.get(cause, 0)+1
                continue
            valid += 1
            if managed:
                sampled_slots.append((mint, now//(5*MINUTE), now, int(at), 'valuation'))
                db.execute('INSERT OR IGNORE INTO monitor_observations VALUES (?,?,?,?,?,?)',
                           (mint, int(at), now, cap, liquidity, volume))
            if last_at is not None and at <= last_at:
                continue  # Reused cached quotes never confirm a crossing twice.
            pending = json.loads(pending_json)
            if last_at is None:
                # Initial above-threshold stocks are baselines, not new runners.
                seen |= sum(1 << i for i, level in enumerate(LEVELS) if cap >= level)
                pending = {}
            else:
                for i, level in enumerate(LEVELS):
                    key = str(level)
                    if seen & (1 << i):
                        continue
                    if cap >= level and liquidity >= 3000 and volume > 0:
                        first = pending.get(key)
                        if first is not None and 0 < at - first <= 15 * MINUTE:
                            db.execute(f'INSERT OR IGNORE INTO {event_table} VALUES (?,?,?,?,?,?,?)',
                                       (mint, level, int(at), int(first), now, cap, liquidity))
                            seen |= 1 << i
                            pending.pop(key, None)
                        else:
                            pending[key] = at
                    else:
                        pending.pop(key, None)
            db.execute(f'UPDATE {token_table} SET last_at=?,seen=?,pending=? WHERE mint=?',
                       (int(at), seen, json.dumps(pending), mint))
        feeds = snapshot.get('feeds', {})
        sources_ok = all(feeds.get(key, {}).get('status') == 'ok'
                         and not feeds[key].get('error')
                         and (number(feeds[key].get('lastSuccess')) or 0) >= now - 15 * MINUTE
                         for key in (('runner_market',) if managed else ('solana', 'launchpad_pools', 'dex_market')))
        fraction = valid / len(active) if active else 0
        observed_fraction = (valid + inactive) / len(active) if active else 0
        reliable = bool(active) and sources_ok and observed_fraction >= POLICY['minimumObservationCoverage']
        if managed and sources_ok:
            # A real sampling pass may reuse a still-fresh source observation.
            # Log the sampling slot, without creating another quote or crossing.
            db.executemany('INSERT OR IGNORE INTO monitor_token_slots VALUES (?,?,?,?,?)', sampled_slots)
        # Idempotent five-minute slots. Reruns cannot manufacture coverage.
        db.execute(f'INSERT OR IGNORE INTO {coverage_table} VALUES (?,?,?)',
                   (now // (5 * MINUTE), int(reliable), len(active)))
        db.execute(f'DELETE FROM {coverage_table} WHERE slot<?', ((now - 100 * DAY) // (5 * MINUTE),))
        days = []
        midnight = day_start(now)
        first_slot = db.execute(f'SELECT MIN(slot) FROM {coverage_table}').fetchone()[0]
        for offset in range(30, 0, -1):
            start = midnight - offset * DAY
            if first_slot is None or first_slot * 5 * MINUTE >= start + DAY:
                continue
            slots = db.execute(f'SELECT reliable,population FROM {coverage_table} WHERE slot>=? AND slot<?',
                               (start // (5 * MINUTE), (start + DAY) // (5 * MINUTE))).fetchall()
            coverage = sum(r[0] for r in slots) / 288
            counts = {str(k): 0 for k in LEVELS}
            counts.update({str(k): n for k, n in db.execute(
                f'SELECT threshold,COUNT(*) FROM {event_table} WHERE at>=? AND at<? GROUP BY threshold', (start, start + DAY))})
            days.append({'date': dt.datetime.fromtimestamp(start / 1000, SGT).date().isoformat(),
                         'counts': counts, 'coverage': coverage,
                         'population': statistics.median(r[1] for r in slots) if slots else 0,
                         'reliable': coverage >= POLICY['minimumPeriodCoverage']})
        counts = {str(k): 0 for k in LEVELS}
        counts.update({str(k): n for k, n in db.execute(
            f'SELECT threshold,COUNT(*) FROM {event_table} WHERE at>? AND at<=? GROUP BY threshold', (now - DAY, now))})
        history = usable_history(db, now, managed)
        if managed and history['comparablePeriods'] < 3:
            history = provisional_history(db, now)
        mode, reason = history['mode'], history['reason']
        if not reliable:
            mode, reason = 'Unknown', 'Current source or runner-observation coverage is incomplete'
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
                               'observedTokens': valid + inactive, 'nonqualifyingTokens': inactive,
                               'observationFraction': observed_fraction,
                               'valuationFraction': fraction, 'sourcesOk': sources_ok,
                               'reliable': reliable, 'gaps': gaps, 'reservedPass': managed},
                  'cohort': ({key: snapshot['runnerCohort'].get(key) for key in ['id', 'startedAt', 'capacity', 'hourlyAdmissions', 'attemptedBatches', 'successfulBatches', 'admissionCandidates', 'errors', 'activityBatches', 'activityConfirmed']} if managed else None),
                  'discovery': snapshot.get('runnerDiscovery'),
                  'definition': 'Unique mints first observed crossing each market-cap threshold after a baseline below it; two distinct quotes within 15 minutes, liquidity at least $3K and positive 24H volume. Initial above-threshold tokens and repeat reclaims are excluded. Follow-up is 72 hours from admission; gaps remain unknown. Not first lifetime crossings or all Solana memes.',
                  'classification': CLASSIFICATION}

    if managed:
        with closing(sqlite3.connect(directory/'runner-mode.sqlite')) as cleanup, cleanup:
            cleanup.execute('DELETE FROM monitor_observations WHERE at<?', (now-7*DAY,))
            cleanup.execute('DELETE FROM monitor_inactive_observations WHERE at<?', (now-7*DAY,))
            cleanup.execute('DELETE FROM monitor_token_slots WHERE slot<?', ((now-7*DAY)//(5*MINUTE),))
    destination = directory / 'runner-mode.json'
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report, allow_nan=False), encoding='utf-8')
    os.replace(temporary, destination)
    return report
