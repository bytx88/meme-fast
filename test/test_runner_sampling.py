import json
from pathlib import Path
from contextlib import closing
import sqlite3
import tempfile
import unittest

from worker.runner_sampling import sample, candidate_snapshot, HOURLY_ADMISSIONS
from worker.runner_mode import MINUTE, DAY, collect

NOW = 1_800_000_000_000 // (60*MINUTE) * (60*MINUTE)


def candidates(count=80, at=NOW):
    return {'lastRun': at, 'coins': [
        {'network': 'solana', 'contract_address': f'mint{i}', 'dex': 'pumpfun',
         'runnerMarket': {'at': at, 'cap': 100_000, 'liquidity': 10_000, 'volume24h': 50_000}}
        for i in range(count)], 'feeds': {'solana': {'status': 'failed'},
                                         'launchpad_pools': {'status': 'failed'}}}


def reply(addresses, at, missing_caps=(), quiet=(), cap=100_000):
    return {'observedAt': at, 'value': [
        {'chainId': 'solana', 'baseToken': {'address': mint},
         'marketCap': None if mint in missing_caps else cap, 'fdv': 50_000_000,
         'liquidity': {'usd': 0 if mint in quiet else 10_000},
         'volume': {'h24': 0 if mint in quiet else 50_000}, '_sourceObservedAt': at}
        for mint in addresses]}


class RunnerSamplingTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_history_is_retained_but_not_mixed_into_cohort_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            row = candidates(1)['coins'][0]
            def old_snapshot(at, cap):
                return {'lastRun': at, 'coins': [{**row, 'runnerMarket': {
                    **row['runnerMarket'], 'at': at, 'cap': cap}}],
                    'feeds': {key: {'status': 'ok', 'lastSuccess': at}
                              for key in ('solana', 'launchpad_pools', 'dex_market')}}
            collect(old_snapshot(NOW, 100_000), directory)
            collect(old_snapshot(NOW+5*MINUTE, 600_000), directory)
            collect(old_snapshot(NOW+10*MINUTE, 600_000), directory)
            at, cap = NOW+15*MINUTE, 100_000
            async def fetch(addresses):
                return reply(addresses, at, cap=cap)
            report = await sample(directory, candidates(at=at), fetch, now=at)
            self.assertEqual(report['counts24h']['500000'], 0)
            cap = 2_000_000
            for step in (20,25):
                at = NOW+step*MINUTE
                report = await sample(directory, {}, fetch, now=at)
            self.assertEqual(report['counts24h']['500000'], 79)
            self.assertEqual(report['counts24h']['1000000'], 80)
            with closing(sqlite3.connect(Path(directory)/'runner-mode.sqlite')) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM tokens').fetchone()[0], 1)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 1)

    async def test_quotes_remain_covered_when_discovery_fails_and_roster_survives_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            at = NOW
            calls = []
            async def fetch(addresses):
                calls.append(addresses)
                return reply(addresses, at)
            result = await sample(directory, candidates(), fetch, now=at)
            self.assertEqual(result['coverage']['eligibleTokens'], 80)
            self.assertEqual(result['coverage']['valuationFraction'], 1)
            self.assertTrue(result['coverage']['reliable'])
            self.assertTrue(result['coverage']['reservedPass'])
            self.assertLessEqual(max(map(len, calls)), 30)
            self.assertEqual(len(calls), 3)
            roster = json.loads((Path(directory)/'runner-cohort.json').read_text())['members']
            mints = [m['mint'] for m in roster]
            # No discovery records are needed to keep observing admitted mints.
            at += 5*MINUTE
            result = await sample(directory, {}, fetch, now=at)
            self.assertEqual(result['coverage']['eligibleTokens'], 80)
            self.assertTrue(result['coverage']['reliable'])
            # Missing caps stay missing; large FDV must not repair the gap.
            at += 5*MINUTE
            async def partial(addresses):
                return reply(addresses, at, missing_caps=mints[:10], quiet=mints[10:20])
            result = await sample(directory, {}, partial, now=at)
            self.assertEqual(result['coverage']['eligibleTokens'], 80)
            self.assertEqual(result['coverage']['valuedTokens'], 70)
            self.assertEqual(result['coverage']['gaps']['missingCap'], 10)
            self.assertIsNone(result['score'])
            self.assertFalse(result['coverage']['reliable'])
            at += MINUTE
            async def omitted(addresses):
                return reply([mint for mint in addresses if mint not in mints[:10]], at)
            result = await sample(directory, {}, omitted, now=at)
            self.assertEqual(result['coverage']['valuedTokens'], 70)
            self.assertEqual(result['coverage']['eligibleTokens'], 80)
            # Failed reads retain the full roster and its old observation time.
            at += 20*MINUTE
            async def unavailable(addresses):
                raise TimeoutError('test source failure')
            result = await sample(directory, {}, unavailable, now=at)
            self.assertEqual(result['coverage']['eligibleTokens'], 80)
            self.assertEqual(result['coverage']['valuedTokens'], 0)
            self.assertFalse(result['coverage']['sourcesOk'])
            self.assertEqual(len(json.loads((Path(directory)/'runner-cohort.json').read_text())['members']), 80)

    async def test_three_covered_hours_distinguish_no_runners_from_no_data(self):
        with tempfile.TemporaryDirectory() as directory:
            at = NOW
            async def fetch(addresses):
                return reply(addresses, at)
            for step in range(37):
                at = NOW + step*5*MINUTE
                result = await sample(directory, candidates(at=at), fetch, now=at)
            self.assertEqual(result['history']['comparablePeriods'], 3)
            self.assertEqual(result['score'], 1)
            self.assertEqual(result['mode'], 'Hard')
            self.assertTrue(result['coverage']['reliable'])
            with closing(sqlite3.connect(Path(directory)/'runner-mode.sqlite')) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM monitor_events').fetchone()[0], 0)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM monitor_observations').fetchone()[0], 80*37)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM tokens').fetchone()[0], 0)
            # A cached repeat cannot add observations or manufacture another slot.
            await sample(directory, {}, fetch, now=at)
            with closing(sqlite3.connect(Path(directory)/'runner-mode.sqlite')) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM monitor_observations').fetchone()[0], 80*37)
            async def fail(addresses):
                raise TimeoutError()
            at += 5*MINUTE
            result = await sample(directory, {}, fail, now=at)
            self.assertIsNone(result['score'])
            self.assertFalse(result['ready'])

    async def test_new_admissions_are_bounded_and_failed_members_are_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            at = NOW
            async def fetch(addresses):
                return reply(addresses, at)
            await sample(directory, candidates(), fetch, now=at)
            at += 60*MINUTE
            result = await sample(directory, candidates(200, at), fetch, now=at)
            self.assertEqual(result['coverage']['eligibleTokens'], 80+HOURLY_ADMISSIONS)
            result = await sample(directory, candidates(200, at), fetch, now=at)
            self.assertEqual(result['coverage']['eligibleTokens'], 80+HOURLY_ADMISSIONS)
            projection = candidate_snapshot({**candidates(), 'articles': ['private'], 'radarCoins': []})
            self.assertNotIn('articles', projection)
            self.assertNotIn('marketHistory', projection['coins'][0])


if __name__ == '__main__':
    unittest.main()
