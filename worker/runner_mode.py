"""Forward-only Solana runner counts from shared, timestamped market quotes.

No ATH reconstruction, FDV substitution, or historical supply assumption. The
SQLite ledger survives the market snapshot's five-day expiry and deployments.
"""
import datetime as dt
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import statistics
import time

from worker.runner_policy import (DAY, HOUR, FOLLOWUP, LEVELS, MAX_POPULATION_RATIO,
                                  MIN_AGREEING_THRESHOLDS, MINUTE, POLICY,
                                  QUOTE_MAX_AGE, SAMPLE_INTERVAL, SCORES, number)
from worker.runner_ledger import (event_counts, initialise, prune_observations,
                                  record_pass, table_names)

SGT = dt.timezone(dt.timedelta(hours=8))

CLASSIFICATION = 'Descriptive score for a bounded rolling sample of observable Solana markets: 1 Hard, 2 Cooling, 3 Balanced, 4 Improving, 5 Easy; unknown has no score. All admitted mints remain tracked for 72 hours, including fallen or missing markets. At least 50 tracked markets are required. Initially, provisional Mode compares the oldest covered hour with the latest complete covered hour for the same observed tokens. Full Mode uses two baseline periods and a current covered 24H, 6H or 1H period. Each period needs 90% reliable five-minute slots; each slot needs 95% fresh runner-observation coverage of the entire cohort: an actual market-cap valuation or independent exact-mint aggregate zero 24H volume. Inactive observations never supply a cap or crossing. Discovery freshness is reported separately and does not certify market-wide coverage. A fully covered absence of sustained runners is Hard; sparse positive or conflicting evidence stays unknown. Not a validated predictive signal.'


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
    if at is None or not 0 <= now - at <= QUOTE_MAX_AGE:
        report.update(mode='Unknown', score=None, ready=False, reason='Runner collection is stale or unavailable')
    return report


def day_start(now):
    return int(dt.datetime.fromtimestamp(now / 1000, SGT).replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)


def classify(periods, provisional=False):
    """Two baseline observations plus a current, comparable observation.

    Periods can be hourly, six-hourly or daily; elapsed calendar age is not a gate.
    """
    baseline_periods = POLICY['provisionalBaselinePeriods'] if provisional else POLICY['baselinePeriods']
    if len(periods) < baseline_periods + 1 or not all(p['reliable'] for p in periods):
        return 'Unknown', 'Need two covered baseline periods and a comparable current period'
    populations = [p['population'] for p in periods]
    if min(populations) < POLICY['minimumPopulation']:
        return 'Unknown', 'Need at least 50 tracked markets with comparable covered observations'
    if max(populations) > min(populations) * MAX_POPULATION_RATIO:
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
            labels.append('Easy' if not provisional and current >= baseline else 'Improving')
        elif current < previous and current <= previous * (1 - POLICY['trendChange']):
            labels.append('Cooling' if provisional or current >= baseline else 'Hard')
        else:
            labels.append('Balanced')
    for label in ('Easy', 'Improving', 'Balanced', 'Cooling', 'Hard'):
        if labels.count(label) >= MIN_AGREEING_THRESHOLDS:
            return label, 'At least three supported thresholds agree across comparable covered periods'
    return 'Unknown', 'Threshold evidence is sparse or does not show a consistent direction'


def period_summary(db, start, end, managed=False):
    _, _, coverage_table = table_names(managed)
    slots = db.execute(f'SELECT reliable,population FROM {coverage_table} WHERE slot>=? AND slot<?',
                       (start // SAMPLE_INTERVAL, end // SAMPLE_INTERVAL)).fetchall()
    coverage = sum(r[0] for r in slots) / ((end - start) / SAMPLE_INTERVAL)
    counts = event_counts(db, start, end, managed)
    return {'startAt': start, 'endAt': end, 'counts': counts, 'coverage': coverage,
            'population': statistics.median(r[1] for r in slots) if slots else 0,
            'reliable': coverage >= POLICY['minimumPeriodCoverage']}


def usable_history(db, now, managed=False):
    """Reuse retained event/coverage tables. Never bridge an unobserved gap."""
    best = None
    coverage_table = table_names(managed)[2]
    first = db.execute(f'SELECT MIN(slot) FROM {coverage_table}').fetchone()[0]
    for hours in POLICY['periodHours']:
        length = hours * HOUR
        end = ((now + 8 * HOUR) // length) * length - 8 * HOUR
        periods = []
        for offset in range(28):  # Bounded lookback, not a waiting requirement.
            stop = end - offset * length
            if first is None or first * SAMPLE_INTERVAL >= stop:
                break
            period = period_summary(db, stop - length, stop, managed)
            if not period['reliable']:
                break
            populations = [p['population'] for p in [period, *periods]]
            if min(populations) <= 0 or max(populations) > min(populations) * MAX_POPULATION_RATIO:
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
    hour = HOUR
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
    start = max(first * SAMPLE_INTERVAL // hour * hour, end - 7 * DAY)
    def observed_mints(period):
        return {mint for mint, slots in db.execute(
            'SELECT mint,COUNT(DISTINCT slot) FROM ('
            'SELECT mint,slot FROM monitor_token_slots WHERE slot>=? AND slot<? '
            'UNION ALL SELECT mint,CAST(received_at / ? AS INTEGER) FROM monitor_observations '
            'WHERE received_at>=? AND received_at<? '
            'UNION ALL SELECT mint,CAST(received_at / ? AS INTEGER) FROM monitor_inactive_observations '
            'WHERE received_at>=? AND received_at<?) GROUP BY mint',
            (period['startAt']//SAMPLE_INTERVAL, period['endAt']//SAMPLE_INTERVAL,
             SAMPLE_INTERVAL, period['startAt'], period['endAt'],
             SAMPLE_INTERVAL, period['startAt'], period['endAt']))
            if slots / (HOUR / SAMPLE_INTERVAL) >= POLICY['minimumPeriodCoverage']}
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


def snapshot_rows(snapshot, managed):
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
    return rows, members


def sources_healthy(snapshot, now, managed):
    feeds = snapshot.get('feeds', {})
    keys = ('runner_market',) if managed else ('solana', 'launchpad_pools', 'dex_market')
    return all(feeds.get(key, {}).get('status') == 'ok'
               and not feeds[key].get('error')
               and (number(feeds[key].get('lastSuccess')) or 0) >= now-QUOTE_MAX_AGE
               for key in keys)


def daily_history(db, now, managed):
    coverage_table = table_names(managed)[2]
    first_slot = db.execute(f'SELECT MIN(slot) FROM {coverage_table}').fetchone()[0]
    midnight = day_start(now)
    days = []
    for offset in range(30, 0, -1):
        start = midnight - offset * DAY
        if first_slot is None or first_slot * SAMPLE_INTERVAL >= start + DAY:
            continue
        period = period_summary(db, start, start+DAY, managed)
        days.append({'date': dt.datetime.fromtimestamp(start / 1000, SGT).date().isoformat(),
                     **{key: period[key] for key in ('counts', 'coverage', 'population', 'reliable')}})
    return days


def collect(snapshot, directory):
    now = number(snapshot.get('lastRun'))
    if now is None:
        raise ValueError('Runner collection requires a timestamped market snapshot')
    now = int(now)
    managed = isinstance(snapshot.get('runnerCohort'), dict)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    rows, members = snapshot_rows(snapshot, managed)
    with closing(sqlite3.connect(directory / 'runner-mode.sqlite')) as db, db:
        initialise(db)
        coverage = record_pass(db, rows, members, now, managed,
                               sources_healthy(snapshot, now, managed))
        days = daily_history(db, now, managed)
        counts = event_counts(db, now-DAY, now, managed, rolling=True)
        history = usable_history(db, now, managed)
        if managed and history['comparablePeriods'] < POLICY['baselinePeriods'] + 1:
            history = provisional_history(db, now)
        mode, reason = history['mode'], history['reason']
        if not coverage['reliable']:
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
                  'coverage': coverage,
                  'cohort': ({key: snapshot['runnerCohort'].get(key) for key in ['id', 'startedAt', 'capacity', 'hourlyAdmissions', 'attemptedBatches', 'successfulBatches', 'admissionCandidates', 'errors', 'activityBatches', 'activityConfirmed']} if managed else None),
                  'discovery': snapshot.get('runnerDiscovery'),
                  'definition': 'Unique mints first observed crossing each market-cap threshold after a baseline below it; two distinct quotes within 15 minutes, liquidity at least $3K and positive 24H volume. Initial above-threshold tokens and repeat reclaims are excluded. Follow-up is 72 hours from admission; gaps remain unknown. Not first lifetime crossings or all Solana memes.',
                  'classification': CLASSIFICATION}

    if managed:
        with closing(sqlite3.connect(directory/'runner-mode.sqlite')) as cleanup, cleanup:
            prune_observations(cleanup, now)
    destination = directory / 'runner-mode.json'
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report, allow_nan=False), encoding='utf-8')
    os.replace(temporary, destination)
    return report
