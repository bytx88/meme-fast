import json
from contextlib import closing
import sqlite3
import tempfile
import unittest
from pathlib import Path

from worker.runner_mode import MINUTE
from worker.runner_sampling import activity_from_reply, sample
from test_runner_sampling import NOW, candidates, reply


def activity(addresses, at, volume='0.0', reserve='1000'):
    return {'status': 200, 'body': {'_sourceObservedAt': at, 'data': [
        {'id': 'solana_'+mint, 'type': 'token', 'attributes': {
            'address': mint, 'total_reserve_in_usd': reserve,
            'volume_usd': {'h24': volume}, 'market_cap_usd': None,
            'fdv_usd': '10000000'}} for mint in addresses]}}


class ActivityTests(unittest.IsolatedAsyncioTestCase):
    def test_only_fresh_exact_mint_zero_volume_records_qualify(self):
        self.assertEqual(set(activity_from_reply(activity(['mint'], NOW), {'mint'}, NOW)), {'mint'})
        for volume in (None, True, 'nan', '-1', '0.01'):
            self.assertEqual(activity_from_reply(activity(['mint'], NOW, volume), {'mint'}, NOW), {})
        self.assertEqual(activity_from_reply(activity(['other'], NOW), {'mint'}, NOW), {})
        wrong = activity(['mint'], NOW)
        wrong['body']['data'][0]['id'] = 'base_mint'
        self.assertEqual(activity_from_reply(wrong, {'mint'}, NOW), {})
        for at in (NOW-16*MINUTE, NOW+1):
            with self.assertRaises(ValueError):
                activity_from_reply(activity(['mint'], at), {'mint'}, NOW)
        # A tiny token-side reserve is not proof of pair liquidity below $3K.
        self.assertEqual(activity_from_reply(activity(['mint'], NOW, '1', '0.0001'), {'mint'}, NOW), {})

    async def test_recovers_observation_coverage_without_caps_or_new_events(self):
        with tempfile.TemporaryDirectory() as directory:
            at = NOW
            async def fetch(addresses):
                return reply(addresses, at)
            await sample(directory, candidates(), fetch, now=at)
            roster = json.loads((Path(directory)/'runner-cohort.json').read_text())['members']
            missing = [m['mint'] for m in roster[:20]]
            at += 5*MINUTE
            async def partial(addresses):
                return reply([m for m in addresses if m not in missing], at)
            calls = []
            async def independent(addresses):
                calls.append(addresses)
                return activity([m for m in addresses if m in missing[:18]], at)
            result = await sample(directory, {}, partial, now=at, fetch_activity=independent)
            self.assertTrue(result['coverage']['reliable'])
            self.assertEqual(result['coverage']['valuedTokens'], 60)
            self.assertEqual(result['coverage']['nonqualifyingTokens'], 18)
            self.assertEqual(result['coverage']['observedTokens'], 78)
            self.assertEqual(result['coverage']['gaps']['missingCap'], 2)
            self.assertEqual(set(sum(calls, [])), set(missing))
            self.assertEqual(result['coverage']['eligibleTokens'], 80)
            self.assertIsNone(result['score'])  # No fabricated historical coverage.
            with closing(sqlite3.connect(Path(directory)/'runner-mode.sqlite')) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM monitor_inactive_observations').fetchone()[0], 18)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM monitor_events').fetchone()[0], 0)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM monitor_observations WHERE at=?', (at,)).fetchone()[0], 60)
            # A short source failure reuses the original certificate timestamp.
            at += 5*MINUTE
            async def failed(addresses):
                raise TimeoutError()
            result = await sample(directory, {}, partial, now=at, fetch_activity=failed)
            self.assertTrue(result['coverage']['reliable'])
            self.assertEqual(result['coverage']['nonqualifyingTokens'], 18)
            # Expired evidence cannot be refreshed by a failed request.
            at += 16*MINUTE
            result = await sample(directory, {}, partial, now=at, fetch_activity=failed)
            self.assertFalse(result['coverage']['reliable'])
            self.assertEqual(result['coverage']['nonqualifyingTokens'], 0)
            self.assertEqual(result['coverage']['gaps']['missingCap'], 20)

    async def test_reported_volume_revival_invalidates_cached_inactivity(self):
        with tempfile.TemporaryDirectory() as directory:
            at, omitted = NOW, False
            async def fetch(addresses):
                return reply([] if omitted else addresses, at)
            await sample(directory, candidates(1), fetch, now=at)
            omitted = True
            async def zero(addresses):
                return activity(addresses, at)
            at += 5*MINUTE
            result = await sample(directory, {}, fetch, now=at, fetch_activity=zero)
            self.assertEqual(result['coverage']['nonqualifyingTokens'], 1)
            async def revived(addresses):
                return activity(addresses, at, volume='1')
            at += MINUTE
            result = await sample(directory, {}, fetch, now=at, fetch_activity=revived)
            self.assertEqual(result['coverage']['nonqualifyingTokens'], 0)
            async def failed(addresses):
                raise TimeoutError()
            at += MINUTE
            result = await sample(directory, {}, fetch, now=at, fetch_activity=failed)
            self.assertEqual(result['coverage']['nonqualifyingTokens'], 0)

    async def test_two_covered_hours_with_activity_evidence_can_score(self):
        with tempfile.TemporaryDirectory() as directory:
            at = NOW
            missing = {f'mint{i}' for i in range(30)}
            async def fetch(addresses):
                return reply(addresses if at == NOW else [m for m in addresses if m not in missing], at)
            async def independent(addresses):
                return activity(addresses, at)
            for step in range(25):
                at = NOW+step*5*MINUTE
                result = await sample(directory, candidates() if step == 0 else {}, fetch,
                                      now=at, fetch_activity=independent)
            self.assertTrue(result['history']['provisional'])
            self.assertEqual(result['history']['matchedTokens'], 80)
            self.assertEqual(result['score'], 1)
            self.assertEqual(result['coverage']['valuedTokens'], 50)
            self.assertEqual(result['coverage']['observedTokens'], 80)

    async def test_activity_clears_pending_confirmation_and_real_caps_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            at, cap, omit = NOW, 100000, False
            async def fetch(addresses):
                return reply([] if omit else addresses, at, cap=cap)
            async def independent(addresses):
                return activity(addresses, at)
            await sample(directory, candidates(1), fetch, now=at)
            at, cap = NOW+5*MINUTE, 600000
            await sample(directory, {}, fetch, now=at)
            at, omit = NOW+10*MINUTE, True
            await sample(directory, {}, fetch, now=at, fetch_activity=independent)
            at, omit = NOW+15*MINUTE, False
            result = await sample(directory, {}, fetch, now=at)
            self.assertEqual(result['counts24h']['500000'], 0)
            at += 5*MINUTE
            result = await sample(directory, {}, fetch, now=at)
            self.assertEqual(result['counts24h']['500000'], 1)
