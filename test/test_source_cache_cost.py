import tempfile
import unittest

from worker.source_stream import SourceStream


class SourceCacheCostTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.stream = SourceStream(self.folder.name, clock=lambda: 1000)

    def tearDown(self):
        self.stream.close()
        self.folder.cleanup()

    def rows(self, rows):
        self.stream.db.executemany('INSERT INTO responses VALUES (?,?,?,?)', rows)

    def test_expiry_including_boundary_and_failure_limits_are_unchanged(self):
        self.rows([('expired', 999, 900, '{}'), ('boundary', 1000, 900, '{}'),
                   ('retained', 1001, 900, '{}')])
        self.stream.db.executemany('INSERT INTO failed_reads VALUES (?,?)',
            [('expired', 999), ('boundary', 1000), *[(str(i), 1001 + i) for i in range(2001)]])
        self.stream.prune()
        self.assertEqual(self.stream.db.execute('SELECT key FROM responses').fetchall(), [('retained',)])
        self.assertEqual(self.stream.db.execute('SELECT COUNT(*),MIN(expires) FROM failed_reads').fetchone(),
                         (2000, 1002))

    def test_row_capacity_evicts_oldest_sample_regardless_of_expiry_or_insertion_order(self):
        self.rows([(str(i), 10000 - i, i, '{}') for i in reversed(range(2001))])
        self.stream.prune()
        self.assertEqual(self.stream.db.execute('SELECT COUNT(*) FROM responses').fetchone()[0], 2000)
        self.assertIsNone(self.stream.db.execute('SELECT key FROM responses WHERE key=?', ('0',)).fetchone())
        self.assertIsNotNone(self.stream.db.execute('SELECT key FROM responses WHERE key=?', ('2000',)).fetchone())

    def test_size_capacity_keeps_exact_32mb_and_evicts_oldest_sample(self):
        body = '"' + 'a' * 1_999_998 + '"'
        self.rows([(str(i), 2000, i, body) for i in range(17)])
        self.stream.prune()
        self.assertEqual(self.stream.db.execute('SELECT COUNT(*),SUM(LENGTH(body)) FROM responses').fetchone(),
                         (16, 32_000_000))
        self.assertIsNone(self.stream.db.execute('SELECT key FROM responses WHERE key=?', ('0',)).fetchone())
        self.assertIsNotNone(self.stream.db.execute('SELECT key FROM responses WHERE key=?', ('16',)).fetchone())

    def test_pruning_queries_use_covering_accounting_index_without_body_rescan_or_sort(self):
        self.rows([(str(i), 1100, i, '{"text":"retained"}') for i in range(2001)])
        statements = []
        self.stream.db.set_trace_callback(statements.append)
        try:
            self.stream.prune()
        finally:
            self.stream.db.set_trace_callback(None)
        # Inspect the actual production statements, including a real eviction.
        queries = [sql for sql in statements if sql.startswith('SELECT ')]
        self.assertEqual(len(queries), 2)
        for query in queries:
            with self.subTest(query=query):
                self.assertIn('INDEXED BY responses_prune', query)
                plan = ' '.join(str(row[-1]) for row in self.stream.db.execute('EXPLAIN QUERY PLAN ' + query))
                # Older SQLite labels an expression-index scan USING INDEX.
                self.assertRegex(plan, r'USING (?:COVERING )?INDEX responses_prune')
                self.assertNotIn('TEMP B-TREE', plan)
                bytecode = self.stream.db.execute('EXPLAIN ' + query).fetchall()
                self.assertFalse(any(row[1] == 'Function' and str(row[5]).startswith('length(')
                                     for row in bytecode), 'JSON length must come from the stored index expression')
        for table in ('responses', 'failed_reads'):
            plan = ' '.join(str(row[-1]) for row in self.stream.db.execute(
                f'EXPLAIN QUERY PLAN DELETE FROM {table} WHERE expires<=?', (1000,)))
            self.assertIn(f'USING INDEX {table}_expires', plan)

    def test_indexes_migrate_existing_cache_without_changing_observation_or_expiry(self):
        self.stream.store('test', ['A'], {'text': '\u732b'}, 990000, 60)
        self.stream.close()
        import sqlite3
        db = sqlite3.connect(self.folder.name + '/sources.sqlite')
        for name in ('responses_expires', 'responses_prune', 'failed_reads_expires'):
            db.execute('DROP INDEX ' + name)
        db.close()
        self.stream = SourceStream(self.folder.name, clock=lambda: 1000)
        reply = self.stream.lookup('test', ['A'])
        self.assertEqual(reply['value'], {'text': '\u732b'})
        self.assertEqual(reply['observedAt'], 990000)
        self.assertEqual(self.stream.db.execute('SELECT expires FROM responses').fetchone()[0], 1050)


if __name__ == '__main__':
    unittest.main()
