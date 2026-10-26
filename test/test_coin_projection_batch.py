import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from worker.coin_projections import project
import worker.snapshot_view as views


class CoinProjectionBatchTests(unittest.TestCase):
    now = 1800000000000

    def snapshot(self):
        now = self.now
        history = [dict(at=now - (4 - i) * 5 * 60000, priceUsd=1 + i / 2,
                        volume5m=100 + i, buys5m=150, sells5m=20, liquidity=10000) for i in range(5)]
        def coin(identity, age, **extra):
            return dict(id=identity, firstSeen=now - age, name='  ＣＡＴ  meme ', symbol='$$CAT',
                        poolCreated=now - 30 * 60000, marketHistory=copy.deepcopy(history),
                        marketHistoryHourly=[{'at': now - 3600000}], priceHistory5m=[{'at': now}], **extra)
        return dict(version=2, revision='batch:2', lastRun=now, feeds={'bad': {'error': 'limited'}, 'ok': {'error': None}},
                    coverage={'sources': {}}, coins=[
                        coin('solana:recent', 3600000, savedContext={'kind': 'verified'}),
                        coin('solana:older', 7 * 3600000, savedContext={'kind': 'web', 'web': {'exact': True}}),
                        coin('base:stretch', 4 * 86400000, launchpad={'completed': False, 'graduationPercentage': 92}),
                        coin('base:graduated', 4 * 86400000, graduationObservedAt=now - 3600000),
                        coin('base:old', 40 * 3600000, savedContext={'kind': 'web', 'web': {'exact': False}}),
                        coin('solana:expired-boundary', views.RETENTION_MS),
                    ], radarCoins=[
                        {'id': 'base:radar', 'lastSeenRadarAt': now, 'name': 'cat MEME', 'symbol': '$other'},
                        {'id': 'solana:ticker', 'lastSeenRadarAt': now, 'name': 'unrelated', 'symbol': 'cat'},
                        {'id': 'solana:recent', 'lastSeenRadarAt': now, 'name': 'cat meme'},
                        {'id': 'base:expired-radar', 'lastSeenRadarAt': now - views.RETENTION_MS, 'name': 'cat meme'},
                    ])

    def test_each_window_is_byte_identical_to_independent_projection(self):
        snapshot = self.snapshot()
        original = copy.deepcopy(snapshot)
        for hours, result in views.coin_projection_views(snapshot, now_ms=self.now):
            with self.subTest(hours=hours):
                expected = views.snapshot_view(snapshot, 'coin', now_ms=self.now, hours=hours)
                self.assertEqual(json.dumps(result, separators=(',', ':')), json.dumps(expected, separators=(',', ':')))
        self.assertEqual(snapshot, original)

    def test_duplicate_ids_preserve_each_row_and_history_is_derived_once_per_object(self):
        snapshot = self.snapshot()
        duplicate = dict(snapshot['coins'][0], name='other name', marketHistory=[{'at': self.now, 'volume5m': '27'}])
        snapshot['coins'].append(duplicate)
        expected = [views.snapshot_view(snapshot, 'coin', now_ms=self.now, hours=hours)
                    for hours in (1, 6, 12, 36, 120)]
        with patch.object(views, '_compact_flow', wraps=views._compact_flow) as compact, \
             patch.object(views, '_early_ramp_warning', wraps=views._early_ramp_warning) as warning:
            actual = [result for _, result in views.coin_projection_views(snapshot, now_ms=self.now)]
        self.assertEqual(actual, expected)
        retained = len(snapshot['coins']) - 1
        self.assertEqual(compact.call_count, retained)
        self.assertEqual(warning.call_count, retained)
        self.assertNotEqual(actual[-1]['coins'][0]['flowSamples'], actual[-1]['coins'][-1]['flowSamples'])

    def test_later_batches_use_current_history_context_and_time(self):
        snapshot = self.snapshot()
        list(views.coin_projection_views(snapshot, now_ms=self.now))
        snapshot['coins'][0]['marketHistory'].append({'at': self.now + 1, 'volume5m': 999})
        snapshot['coins'][0]['savedContext'] = None
        for hours, actual in views.coin_projection_views(snapshot, now_ms=self.now + 3600001):
            self.assertEqual(actual, views.snapshot_view(snapshot, 'coin', now_ms=self.now + 3600001, hours=hours))

    def test_project_uses_one_time_and_returns_verified_checkpoint_without_changing_source(self):
        snapshot = self.snapshot()
        raw = json.dumps(snapshot)
        with tempfile.TemporaryDirectory() as folder:
            main = Path(folder) / 'coins.json'
            main.write_text(raw, encoding='utf-8')
            with patch('worker.coin_projections.time.time', return_value=self.now / 1000) as clock:
                result = project(main)
            clock.assert_called_once()
            self.assertEqual(main.read_text(encoding='utf-8'), raw)
            stat = main.stat()
            self.assertEqual(result, dict(version=1, snapshotSize=stat.st_size, snapshotMtimeNs=stat.st_mtime_ns,
                snapshotDev=stat.st_dev, snapshotIno=stat.st_ino,
                checkpoint=dict(lastRun=self.now, revision='batch:2', coins=6, providerErrors={'bad': 'limited'})))
            for hours in (1, 6, 12, 36, 120):
                output = main.with_name(f'coins.snipe.v2.{hours}.json').read_text(encoding='utf-8')
                expected = views.snapshot_view(snapshot, 'coin', now_ms=self.now, hours=hours)
                self.assertEqual(output, json.dumps(expected, separators=(',', ':')))

    def test_project_rejects_checkpoint_when_source_changes_during_projection(self):
        with tempfile.TemporaryDirectory() as folder:
            main = Path(folder) / 'coins.json'
            main.write_text(json.dumps(self.snapshot()), encoding='utf-8')
            def changing_view(*args, **kwargs):
                main.write_text('{"coins":[]}', encoding='utf-8')
                return views.snapshot_view(*args, **kwargs)
            with patch('worker.coin_projections.snapshot_view', side_effect=changing_view):
                with self.assertRaisesRegex(RuntimeError, 'Snapshot changed'):
                    project(main)

    def test_project_does_not_certify_invalid_empty_coin_mapping(self):
        with tempfile.TemporaryDirectory() as folder:
            main = Path(folder) / 'coins.json'
            main.write_text(json.dumps(dict(coins={}, radarCoins=[], lastRun=self.now, feeds={})), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'coins must be a list'):
                project(main)
            self.assertFalse(main.with_name('coins.catalog.v2.json').exists())

    def test_project_rejects_same_size_same_time_atomic_replacement(self):
        with tempfile.TemporaryDirectory() as folder:
            main = Path(folder) / 'coins.json'
            raw = json.dumps(self.snapshot())
            main.write_text(raw, encoding='utf-8')
            original = main.stat()
            replaced = False
            def replacing_view(*args, **kwargs):
                nonlocal replaced
                if not replaced:
                    temporary = main.with_suffix('.replacement')
                    temporary.write_text(raw, encoding='utf-8')
                    os.utime(temporary, ns=(original.st_atime_ns, original.st_mtime_ns))
                    os.replace(temporary, main)
                    replaced = True
                return views.snapshot_view(*args, **kwargs)
            with patch('worker.coin_projections.snapshot_view', side_effect=replacing_view):
                with self.assertRaisesRegex(RuntimeError, 'Snapshot changed'):
                    project(main)

    def test_cli_prints_one_checkpoint_json_line(self):
        with tempfile.TemporaryDirectory() as folder:
            main = Path(folder) / 'coins.json'
            main.write_text(json.dumps(self.snapshot()), encoding='utf-8')
            command = [sys.executable, str(Path(__file__).resolve().parents[1] / 'worker' / 'coin_projections.py'), str(main)]
            output = subprocess.run(command, check=True, capture_output=True, text=True).stdout.splitlines()
            self.assertEqual(len(output), 1)
            self.assertEqual(json.loads(output[0])['checkpoint']['coins'], 6)


if __name__ == '__main__':
    unittest.main()
