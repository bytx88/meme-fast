"""SQLite persistence for Mode. No source requests or score classification."""
import json

from worker.runner_policy import (CONFIRMATION_WINDOW, DAY, FOLLOWUP, LEVELS,
                                  MAX_CAP, MIN_LIQUIDITY, POLICY,
                                  SAMPLE_INTERVAL, fresh, number)


def table_names(managed):
    prefix = 'monitor_' if managed else ''
    return tuple(prefix + name for name in ('tokens', 'events', 'coverage'))


def initialise(db):
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


def inactive_observation(quote, now, last_at):
    at = number(quote.get('at'))
    return (number(quote.get('cap')) is None and quote.get('status') == 'observed-nonqualifying'
            and quote.get('source') == 'GeckoTerminal'
            and quote.get('evidence') == 'token-aggregate-activity'
            and fresh(at, now) and (last_at is None or at >= last_at)
            and number(quote.get('tokenReserveUsd')) is not None
            and number(quote.get('volume24h')) == 0)


def valuation_gap(quote, now):
    if not quote:
        return 'missingQuote'
    if not fresh(number(quote.get('at')), now):
        return 'staleOrInvalidTime'
    cap = number(quote.get('cap'))
    if cap is None:
        return 'missingCap'
    if cap > MAX_CAP:
        return 'invalidCap'
    if number(quote.get('liquidity')) is None or number(quote.get('volume24h')) is None:
        return 'missingLiquidityOrVolume'
    return None


def record_crossings(db, tables, mint, state, quote, now):
    token_table, event_table, _ = tables
    last_at, seen, pending_json = state
    at, cap = number(quote['at']), number(quote['cap'])
    if last_at is not None and at <= last_at:
        return  # Reused cached quotes never confirm a crossing twice.
    liquidity, volume = number(quote['liquidity']), number(quote['volume24h'])
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
            if cap >= level and liquidity >= MIN_LIQUIDITY and volume > 0:
                first = pending.get(key)
                if first is not None and 0 < at - first <= CONFIRMATION_WINDOW:
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


def record_pass(db, rows, members, now, managed, sources_ok):
    token_table, event_table, coverage_table = table_names(managed)
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
        if managed and inactive_observation(quote, now, last_at):
            inactive += 1
            sampled_slots.append((mint, now//SAMPLE_INTERVAL, now, int(at), 'zero-volume'))
            db.execute('INSERT OR IGNORE INTO monitor_inactive_observations VALUES (?,?,?,?,?,?)',
                       (mint, int(at), now, number(quote['tokenReserveUsd']), volume, quote['source']))
            # Missing caps cannot set threshold bits, initialise a valuation,
            # confirm a crossing, or connect confirmations across this gap.
            db.execute("UPDATE monitor_tokens SET pending='{}' WHERE mint=?", (mint,))
            continue
        cause = valuation_gap(quote, now)
        if cause:
            gaps[cause] = gaps.get(cause, 0)+1
            continue
        valid += 1
        if managed:
            sampled_slots.append((mint, now//SAMPLE_INTERVAL, now, int(at), 'valuation'))
            db.execute('INSERT OR IGNORE INTO monitor_observations VALUES (?,?,?,?,?,?)',
                       (mint, int(at), now, cap, liquidity, volume))
        record_crossings(db, (token_table, event_table, coverage_table), mint,
                         (last_at, seen, pending_json), quote, now)
    fraction = valid / len(active) if active else 0
    observed_fraction = (valid + inactive) / len(active) if active else 0
    reliable = bool(active) and sources_ok and observed_fraction >= POLICY['minimumObservationCoverage']
    if managed and sources_ok:
        # A real sampling pass may reuse a still-fresh source observation.
        # Log the sampling slot, without creating another quote or crossing.
        db.executemany('INSERT OR IGNORE INTO monitor_token_slots VALUES (?,?,?,?,?)', sampled_slots)
    # Idempotent five-minute slots. Reruns cannot manufacture coverage.
    db.execute(f'INSERT OR IGNORE INTO {coverage_table} VALUES (?,?,?)',
               (now // SAMPLE_INTERVAL, int(reliable), len(active)))
    db.execute(f'DELETE FROM {coverage_table} WHERE slot<?', ((now - 100 * DAY) // SAMPLE_INTERVAL,))
    return {'eligibleTokens': len(active), 'valuedTokens': valid,
            'observedTokens': valid + inactive, 'nonqualifyingTokens': inactive,
            'observationFraction': observed_fraction, 'valuationFraction': fraction,
            'sourcesOk': sources_ok, 'reliable': reliable, 'gaps': gaps,
            'reservedPass': managed}


def event_counts(db, start, end, managed=False, rolling=False):
    """Complete periods use [start,end); the rolling report uses (start,end]."""
    event_table = table_names(managed)[1]
    lower, upper = ('>', '<=') if rolling else ('>=', '<')
    counts = {str(k): 0 for k in LEVELS}
    counts.update({str(k): n for k, n in db.execute(
        f'SELECT threshold,COUNT(*) FROM {event_table} WHERE at{lower}? AND at{upper}? GROUP BY threshold',
        (start, end))})
    return counts


def prune_observations(db, now):
    db.execute('DELETE FROM monitor_observations WHERE at<?', (now-7*DAY,))
    db.execute('DELETE FROM monitor_inactive_observations WHERE at<?', (now-7*DAY,))
    db.execute('DELETE FROM monitor_token_slots WHERE slot<?', ((now-7*DAY)//SAMPLE_INTERVAL,))
