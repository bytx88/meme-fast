import json
import tempfile
import subprocess
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from worker.followed_wallets import collect, collect_isolated, positive_mints, awaiting, PROGRAMS, registry_wallets, validate_wallet, registry_wallets_with_retry


def payload(owner, amounts):
    return {'result': {'value': [{'account': {'data': {'parsed': {'info': {
        'owner': owner, 'mint': mint, 'tokenAmount': {'amount': amount}}}}}}
        for mint, amount in amounts]}}


class WalletTests(unittest.TestCase):
    def test_deadline_between_programs_preserves_complete_previous_holdings(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'report.json'
            registry = [dict(name='Test', address='owner', code='F1')]
            collect(path, lambda owner, program: payload(owner, [('OLD', '1')]),
                    now=1000, registry=registry)
            clock = [0]
            calls = []
            def slow(owner, program):
                calls.append(program)
                clock[0] = 11
                return payload(owner, [('PARTIAL', '1')])
            with patch('worker.followed_wallets.time.monotonic', side_effect=lambda: clock[0]):
                report = collect(path, slow, now=2000, registry=registry, budget_seconds=10)
            self.assertEqual(calls, [PROGRAMS[0]])
            self.assertEqual(report['wallets'][0]['mints'], ['OLD'])
            self.assertEqual(report['wallets'][0]['checkedAt'], 1000)
            self.assertEqual(report['wallets'][0]['status'], 'unavailable')
            self.assertTrue(report['collection']['budgetReached'])

    def test_isolated_collector_uses_supplied_registry_and_publishes_revision(self):
        with tempfile.TemporaryDirectory() as folder:
            report = collect_isolated(Path(folder)/'report.json', [])
            self.assertEqual(report['wallets'], [])
            self.assertEqual(report['collection']['sampledWallets'], 0)
            self.assertEqual(len(report['collection']['codeSha256']), 64)

    def test_trickling_rpc_is_killed_without_replacing_previous_report(self):
        release = threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(200)
                self.send_header('Content-Length', '10000')
                self.end_headers()
                try:
                    while not release.wait(.02):
                        self.wfile.write(b' ')
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass
            def log_message(self, *args): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder)/'report.json'
                previous = json.dumps({'wallets': []})
                path.write_text(previous)
                registry = [dict(name='Test', address='owner', code='F1')]
                with patch.dict('os.environ', {'SOLANA_WALLET_RPC_URL': f'http://127.0.0.1:{server.server_port}'}):
                    before = time.monotonic()
                    with self.assertRaises(subprocess.TimeoutExpired):
                        collect_isolated(path, registry, budget_seconds=1, timeout_seconds=2)
                    self.assertLess(time.monotonic()-before, 4)
                self.assertEqual(path.read_text(), previous)
        finally:
            release.set()
            server.shutdown()
            server.server_close()
            thread.join()

    def test_overloaded_registry_restarts_the_entire_snapshot(self):
        calls, waits = [], []
        partial = dict(name='Partial', address='11111111111111111111111111111111', code='F1')
        complete = dict(partial, name='Complete')
        def read_items():
            calls.append(1)
            if len(calls) == 1:
                yield partial['address'], partial
                raise RuntimeError('overloaded')
            yield complete['address'], complete
        with self.assertLogs(level='WARNING'):
            rows = registry_wallets_with_retry(read_items, (RuntimeError,), sleep=waits.append)
        self.assertEqual(len(calls), 2)
        self.assertEqual(waits, [1])
        self.assertEqual([row['name'] for row in rows if row['address'] == partial['address']], ['Complete'])

    def test_registry_retry_exhaustion_and_other_errors_still_fail(self):
        calls, waits = [], []
        def overloaded():
            calls.append(1)
            raise RuntimeError('overloaded')
        with self.assertLogs(level='WARNING'), self.assertRaisesRegex(RuntimeError, 'overloaded'):
            registry_wallets_with_retry(overloaded, (RuntimeError,), sleep=waits.append)
        self.assertEqual(len(calls), 4)
        self.assertEqual(waits, [1, 2, 4])
        def unavailable():
            raise PermissionError('access denied')
        with self.assertRaises(PermissionError):
            registry_wallets_with_retry(unavailable, (RuntimeError,), sleep=waits.append)
        self.assertEqual(waits, [1, 2, 4])

    def test_registry_validation_errors_are_not_retried(self):
        calls, waits = [], []
        def invalid():
            calls.append(1)
            return [('invalid', {'name': 'Invalid'})]
        with self.assertRaises(ValueError):
            registry_wallets_with_retry(invalid, (RuntimeError,), sleep=waits.append)
        self.assertEqual(len(calls), 1)
        self.assertEqual(waits, [])

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
            self.assertEqual(len(calls), len(registry_wallets()) * len(PROGRAMS))
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
        self.assertEqual(len(rows), 13)
        self.assertEqual(len({row['address'] for row in rows}), 13)
        best = next(row for row in rows if row['name'] == 'Best 2')
        chill = next(row for row in rows if row['name'] == 'ChillDaddy')
        self.assertEqual(best['code'], 'F1')
        self.assertEqual(chill['code'], 'Dev')
        self.assertNotEqual(best['address'], chill['address'])
        frank = next(row for row in rows if row['name'] == 'Frankdegods')
        self.assertEqual(frank['address'], '498g1rVnFcnjBjpfw1xyqA1WvgQXUU8RWuELjxkjAayQ')
        self.assertEqual(validate_wallet(frank)['code'], 'L2')
