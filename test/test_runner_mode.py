import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from worker.runner_mode import (DAY, LEVELS, MINUTE, classify, collect, day_start,
                                eligible, public_report, unknown, SCORES)

NOW = 1_800_000_000_000


def coin(mint='mint', cap=100_000, at=NOW, **quote):
    return {'network': 'solana', 'contract_address': mint, 'dex': 'pumpfun',
            'runnerMarket': {'at': at, 'cap': cap, 'liquidity': 10_000,
                             'volume24h': 100_000, **quote}}


def snapshot(rows, at=NOW):
    return {'lastRun': at, 'coins': rows, 'radarCoins': rows,
            'feeds': {key: {'status': 'ok', 'lastSuccess': at}
                      for key in ('solana', 'launchpad_pools', 'dex_market')}}


class RunnerModeTests(unittest.TestCase):
    def test_both_provider_launchpad_identities_are_admitted(self):
        for dex in ('pumpfun', 'pumpswap', 'meteoradbc', 'pump-fun', 'pump-swap', 'meteora-dbc'):
            self.assertTrue(eligible({**coin(), 'dex': dex}))
        self.assertTrue(eligible({**coin(), 'dex': 'raydium', 'launchpadSource': 'pump-fun'}))
        self.assertFalse(eligible({**coin(), 'dex': 'raydium'}))
        self.assertFalse(eligible({**coin(), 'network': 'base'}))

    def test_crossings_are_confirmed_mint_deduplicated_and_not_reclaims(self):
        with tempfile.TemporaryDirectory() as folder:
            collect(snapshot([coin()]), folder)
            t = NOW + 5 * MINUTE
            first = collect(snapshot([coin(cap=6_000_000, at=t)], t), folder)
            self.assertEqual(first['counts24h']['500000'], 0)
            # Same cached quote cannot confirm, even in a new collection slot.
            cached = collect(snapshot([coin(cap=6_000_000, at=t)], t + MINUTE), folder)
            self.assertEqual(cached['counts24h']['500000'], 0)
            t += 5 * MINUTE
            result = collect(snapshot([coin(cap=6_000_000, at=t)], t), folder)
            self.assertEqual(result['counts24h'], {'500000': 1, '1000000': 1, '5000000': 1, '10000000': 0})
            collect(snapshot([coin(at=t+MINUTE)], t+MINUTE), folder)
            collect(snapshot([coin(cap=6_000_000, at=t+2*MINUTE)], t+2*MINUTE), folder)
            result = collect(snapshot([coin(cap=6_000_000, at=t+3*MINUTE)], t+3*MINUTE), folder)
            self.assertEqual(result['counts24h']['500000'], 1)
            self.assertEqual(result['mode'], 'Unknown')
            with closing(sqlite3.connect(Path(folder)/'runner-mode.sqlite')) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM tokens').fetchone()[0], 1)

    def test_initial_stocks_missing_caps_fdv_and_thin_quotes_do_not_create_runners(self):
        with tempfile.TemporaryDirectory() as folder:
            collect(snapshot([coin('old', 20_000_000), coin('new')]), folder)
            t = NOW + 5 * MINUTE
            missing = {**coin('new', None, t), 'mc': 50_000_000, 'fdv': 50_000_000}
            result = collect(snapshot([coin('old', 20_000_000, t), missing], t), folder)
            self.assertEqual(sum(result['counts24h'].values()), 0)
            self.assertFalse(result['coverage']['reliable'])
            for step in (10, 15):
                t = NOW + step * MINUTE
                result = collect(snapshot([coin('new', 20_000_000, t, liquidity=10)], t), folder)
            self.assertEqual(sum(result['counts24h'].values()), 0)

    def test_failed_sources_gaps_case_identity_and_followup_expiry(self):
        with tempfile.TemporaryDirectory() as folder:
            rows = [coin('Mint'), coin('mint'), {**coin('other'), 'network': 'base'}]
            result = collect(snapshot(rows), folder)
            self.assertEqual(result['coverage']['eligibleTokens'], 2)
            t = NOW + 5 * MINUTE
            collect(snapshot([coin('Mint', 1_000_000, t)], t), folder)
            t += 16 * MINUTE
            bad = snapshot([coin('Mint', 1_000_000, t)], t)
            bad['feeds']['solana']['status'] = 'failed'
            result = collect(bad, folder)
            self.assertEqual(result['counts24h']['500000'], 0)
            self.assertFalse(result['coverage']['sourcesOk'])
            t = NOW + 4 * DAY
            result = collect(snapshot([coin('Mint', 20_000_000, t)], t), folder)
            self.assertEqual(result['coverage']['eligibleTokens'], 0)
            self.assertEqual(result['counts24h']['10000000'], 0)

    def test_coverage_slots_are_idempotent_and_days_use_sgt(self):
        start = day_start(NOW)
        self.assertEqual((start + 8 * 60 * MINUTE) % DAY, 0)
        with tempfile.TemporaryDirectory() as folder:
            for _ in range(3):
                collect(snapshot([coin(at=start)], start), folder)
            result = collect(snapshot([coin(at=start+DAY)], start+DAY), folder)
            self.assertEqual(len(result['daily']), 1)
            self.assertAlmostEqual(result['daily'][0]['coverage'], 1 / 288)
            self.assertFalse(result['daily'][0]['reliable'])
            self.assertEqual(json.loads((Path(folder)/'runner-mode.json').read_text())['mode'], 'Unknown')

    def test_scores_use_usable_periods_instead_of_elapsed_calendar_days(self):
        def periods(values):
            return [{'reliable': True, 'population': 100,
                     'counts': {str(k): value for k in LEVELS}} for value in values]
        for score, label, values in [(5, 'Easy', [6, 6, 12]), (4, 'Improving', [10, 2, 3]),
                                     (3, 'Balanced', [5, 5, 5]), (1, 'Hard', [6, 4, 2]),
                                     (2, 'Cooling', [2, 10, 7])]:
            mode, _ = classify(periods(values))
            self.assertEqual(mode, label)
            self.assertEqual(SCORES[mode], score)
        complete = periods([6, 6, 12])
        self.assertEqual(classify(complete[:-1])[0], 'Unknown')
        complete[1]['reliable'] = False
        self.assertEqual(classify(complete)[0], 'Unknown')
        complete[1].update(reliable=True, population=200)
        self.assertEqual(classify(complete)[0], 'Unknown')
        sparse = periods([10, 10, 10])
        for period in sparse:
            period['counts'].update({'1000000': 0, '5000000': 0, '10000000': 0})
        self.assertEqual(classify(sparse)[0], 'Unknown')
        self.assertEqual(classify(periods([2, 1, 0]))[0], 'Hard')
        report = {**unknown(), 'updatedAt': NOW, 'mode': 'Easy', 'score': 5, 'ready': True}
        self.assertIsNone(public_report(report, NOW+16*MINUTE)['score'])
        self.assertIsNone(public_report(report, NOW-MINUTE)['score'])
        old = {**report, 'policy': {'version': 1}, 'classification': 'Old 14-day rule'}
        self.assertFalse(public_report(old, NOW)['ready'])
        self.assertIsNone(public_report(old, NOW)['score'])
        self.assertEqual(public_report(old, NOW)['policy']['version'], 6)
        self.assertNotIn('historyDays', public_report(old, NOW)['policy'])
        self.assertNotIn('14', public_report(old, NOW)['classification'])

    def test_end_to_end_three_covered_hours_can_score_and_missing_coverage_withholds_it(self):
        # Synthetic unit data only: 100 tracked mints, six/six/twelve new runners
        # per hour, with distinct baseline and confirmation quotes for every mint.
        start = NOW // (60 * MINUTE) * 60 * MINUTE
        with tempfile.TemporaryDirectory() as folder:
            for step in range(37):
                at = start + step * 5 * MINUTE
                winners = 0 if step == 0 else 6 if step < 13 else 12 if step < 25 else 24
                rows = [coin(str(i), 20_000_000 if i < winners else 100_000, at) for i in range(100)]
                report = collect(snapshot(rows, at), folder)
            self.assertEqual(report['score'], 5)
            self.assertEqual(report['history']['periodHours'], 1)
            self.assertEqual(report['history']['comparablePeriods'], 3)
            self.assertTrue(report['ready'])
            with closing(sqlite3.connect(Path(folder)/'runner-mode.sqlite')) as db, db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 24 * 4)
                db.execute('UPDATE coverage SET reliable=0 WHERE slot IN (?,?)',
                           (start // (5*MINUTE) + 26, start // (5*MINUTE) + 27))
            report = collect(snapshot(rows, at), folder)
            self.assertEqual(report['mode'], 'Unknown')
            self.assertIsNone(report['score'])
            self.assertFalse(report['ready'])
            # The new policy reuses every saved event, even when coverage fails.
            with closing(sqlite3.connect(Path(folder)/'runner-mode.sqlite')) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 24 * 4)


if __name__ == '__main__':
    unittest.main()
