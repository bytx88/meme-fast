import sqlite3
import unittest

from worker.runner_mode import LEVELS, MINUTE, classify, provisional_history


class ProvisionalTests(unittest.TestCase):
    def database(self):
        db = sqlite3.connect(':memory:')
        db.executescript('''
            CREATE TABLE monitor_coverage(slot INTEGER PRIMARY KEY,reliable INTEGER,population INTEGER);
            CREATE TABLE monitor_observations(mint TEXT,at INTEGER);
            CREATE TABLE monitor_events(mint TEXT,threshold INTEGER,at INTEGER);
        ''')
        return db

    def hour(self, db, index, population=60, missing=0):
        for slot in range(12):
            at = (index * 60 + slot * 5) * MINUTE
            db.execute('INSERT INTO monitor_coverage VALUES (?,?,?)', (at // (5*MINUTE), 1, population))
            db.executemany('INSERT INTO monitor_observations VALUES (?,?)',
                           [(str(i), at) for i in range(population-missing)])

    def test_oldest_covered_hour_and_latest_complete_hour_skip_gap_and_partial(self):
        db = self.database()
        self.hour(db, 1)
        self.hour(db, 4)
        self.hour(db, 5)  # This hour is still incomplete at now.
        result = provisional_history(db, 5*60*MINUTE + 10*MINUTE)
        self.assertTrue(result['usable'])
        self.assertTrue(result['provisional'])
        self.assertEqual(result['mode'], 'Hard')
        self.assertEqual(result['matchedTokens'], 60)
        self.assertEqual([p['startAt'] for p in result['periods']], [60*MINUTE, 240*MINUTE])

    def test_missing_members_and_uncovered_latest_withhold(self):
        for missing in (4, 12):
            db = self.database()
            self.hour(db, 1)
            self.hour(db, 4, missing=missing)
            self.assertFalse(provisional_history(db, 300*MINUTE)['usable'])
        db = self.database()
        self.hour(db, 1)
        self.hour(db, 3)
        self.assertFalse(provisional_history(db, 300*MINUTE)['usable'])

    def test_provisional_direction_requires_supported_thresholds(self):
        def periods(values):
            return [{'reliable': True, 'population': 60,
                     'counts': {str(k): n for k in LEVELS}} for n in values]
        for values, mode in (([6,12], 'Improving'), ([12,6], 'Cooling'),
                             ([6,6], 'Balanced'), ([1,0], 'Hard'), ([1,2], 'Unknown')):
            self.assertEqual(classify(periods(values), provisional=True)[0], mode)

    def test_counts_are_restricted_to_same_tokens(self):
        db = self.database()
        self.hour(db, 1)
        self.hour(db, 4)
        db.execute('INSERT INTO monitor_events VALUES (?,?,?)', ('outsider', 500000, 245*MINUTE))
        result = provisional_history(db, 300*MINUTE)
        self.assertEqual(result['mode'], 'Hard')
        self.assertEqual(result['periods'][-1]['counts']['500000'], 0)
