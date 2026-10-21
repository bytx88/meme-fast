import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from worker.runner_mode import (DAY, LEVELS, MINUTE, classify, collect, day_start,
                                public_report, unknown)

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

    def test_unknown_until_complete_comparable_history_then_descriptive_labels(self):
        def days(values):
            return [{'reliable': True, 'population': 100,
                     'counts': {str(k): value for k in LEVELS}} for value in values]
        for label, values in [('Easy', [3]*12+[3,6]), ('Improving', [10]*12+[2,3]),
                              ('Hard', [5]*12+[3,1]), ('Cooling', [2]*12+[10,7])]:
            self.assertEqual(classify(days(values))[0], label)
        complete = days([3]*12+[3,6])
        self.assertEqual(classify(complete[:-1])[0], 'Unknown')
        complete[2]['reliable'] = False
        self.assertEqual(classify(complete)[0], 'Unknown')
        complete[2].update(reliable=True, population=200)
        self.assertEqual(classify(complete)[0], 'Unknown')
        self.assertEqual(classify(days([3]*14))[0], 'Unknown')
        report = {**unknown(), 'updatedAt': NOW, 'mode': 'Easy', 'ready': True}
        self.assertEqual(public_report(report, NOW+16*MINUTE)['mode'], 'Unknown')
        self.assertEqual(public_report(report, NOW-MINUTE)['mode'], 'Unknown')


if __name__ == '__main__':
    unittest.main()
