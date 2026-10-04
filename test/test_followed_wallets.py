import json
import tempfile
import unittest
from pathlib import Path
from worker.followed_wallets import collect, positive_mints, awaiting, PROGRAMS


def payload(owner, amounts):
    return {'result': {'value': [{'account': {'data': {'parsed': {'info': {
        'owner': owner, 'mint': mint, 'tokenAmount': {'amount': amount}}}}}}
        for mint, amount in amounts]}}


class WalletTests(unittest.TestCase):
    def test_balances(self):
        self.assertEqual(positive_mints(payload('owner', [('A', '0'), ('B', '1'), ('B', '99')]), 'owner'), {'B'})
        with self.assertRaises(ValueError):
            positive_mints(payload('other', [('A', '1')]), 'owner')
        with self.assertRaises(ValueError):
            positive_mints({'error': {'message': 'rate limited'}}, 'owner')

    def test_both_programs_and_failure_preservation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'report.json'
            calls = []
            def fetch(owner, program):
                calls.append((owner, program))
                return payload(owner, [('A' if program == PROGRAMS[0] else 'B', '1')])
            report = collect(path, fetch, now=1000)
            self.assertEqual(len(calls), 16)
            self.assertTrue(all(row['mints'] == ['A', 'B'] for row in report['wallets']))
            def fail(owner, program):
                if program == PROGRAMS[1]:
                    raise ValueError('unavailable')
                return payload(owner, [])
            failed = collect(path, fail, now=2000)
            self.assertTrue(all(row['mints'] == ['A', 'B'] and row['checkedAt'] == 1000
                                and row['status'] == 'unavailable' for row in failed['wallets']))
            empty = collect(path, lambda owner, program: payload(owner, []), now=3000)
            self.assertTrue(all(row['mints'] == [] and row['checkedAt'] == 3000 for row in empty['wallets']))

    def test_registry(self):
        rows = awaiting()['wallets']
        self.assertEqual(len(rows), 8)
        self.assertEqual(len({row['address'] for row in rows}), 8)
        best = next(row for row in rows if row['name'] == 'Best 2')
        chill = next(row for row in rows if row['name'] == 'ChillDaddy')
        self.assertEqual(best['code'], 'F1')
        self.assertEqual(chill['code'], 'Dev')
        self.assertNotEqual(best['address'], chill['address'])
