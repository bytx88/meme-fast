import copy
import json
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timezone
from worker.meme_index import HOUR, REBALANCE, advance, alt_observation, candidates, collect, public_report, record_reading


def board(now, offset=0):
    return {'source': 'live-fomo', 'stale': False,
            'capturedAt': datetime.fromtimestamp(now / 1000, timezone.utc).isoformat(),
            'tokens': [{'rank': i + 1, 'network': 4663, 'holders': 100,
                        'token': {'symbol': str(i), 'name': str(i), 'address': '0x' + format(i+offset, '040x')}} for i in range(10)]}


class FakeSources:
    def __init__(self, now):
        self.now = now
        self.calls = 0
        self.price = 10
        self.missing = False
        self.fail_board = False

    def board(self):
        self.calls += 1
        if self.fail_board:
            raise ValueError('FOMO unavailable')
        return board(self.now, self.calls * 100)

    def quotes(self, tokens, now):
        if self.missing:
            return {}
        return {token['id']: {'price': self.price, 'liquidity': 20000,
                'source': 'DexScreener', 'h1': 2.0, 'at': now} for token in tokens}

    def alt(self, now, basket=None):
        return {'value': 1000, 'hourChange': 1.0, 'providerAt': now, 'source': 'CoinLore top 25 alts'}


class IndexTests(unittest.TestCase):
    def test_one_hour_reading_uses_current_provider_change(self):
        now = 2_000_000_000_000
        basket = candidates(board(now), now)
        report = {'basket': basket}
        quotes = {t['id']: {'price': 10, 'h1': 2.0} for t in basket}
        alt = {'value': 1000, 'hourChange': 1.0, 'providerAt': now, 'source': 'CoinLore top 25 alts'}
        record_reading(report, now, quotes, alt)
        self.assertEqual(report['readings'][0]['meme'], 2)
        self.assertEqual(report['readings'][0]['altDelta'], 1)
        self.assertEqual(report['readingAt'], now)

    def test_broad_alt_sample_excludes_btc_eth_and_stables(self):
        now = 2_000_000_000_000
        rows = [{'id': str(i), 'rank': i, 'symbol': 'USDT' if i == 0 else str(i),
                 'market_cap_usd': '100', 'percent_change_1h': '2'} for i in range(26)]
        alt = alt_observation(rows, now)
        self.assertEqual(alt['value'], 2500)
        self.assertAlmostEqual(alt['hourChange'], 2)
        rows.pop()
        with self.assertRaises(ValueError):
            alt_observation(rows, now)

    def test_initial_seed_reuses_authenticated_response_without_fomo_request(self):
        now = int(datetime(2026, 9, 29, 15, tzinfo=timezone.utc).timestamp() * 1000)
        source = FakeSources(now)
        with tempfile.TemporaryDirectory() as directory:
            report = collect(Path(directory) / 'index.json', source, now)
            self.assertEqual(source.calls, 0)
            self.assertEqual(len(report['basket']), 10)

    def test_compounding_requires_every_constituent(self):
        now = 2_000_000_000_000
        basket = candidates(board(now), now)
        report = {'basket': basket}
        quotes = {t['id']: {'price': 10} for t in basket}
        advance(report, now, quotes, {'value': 1000, 'providerAt': now})
        quotes[basket[0]['id']]['price'] = 20
        advance(report, now+HOUR, quotes, {'value': 1100, 'providerAt': now})
        self.assertAlmostEqual(report['samples'][-1]['index'], 110)
        before = copy.deepcopy(report)
        del quotes[basket[1]['id']]
        with self.assertRaises(ValueError):
            advance(report, now+2*HOUR, quotes, {'value': 1100, 'providerAt': now})
        self.assertEqual(report, before)

    def test_board_once_per_three_days_and_rebalance_continuity(self):
        now = 2_000_000_000_000
        source = FakeSources(now)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'index.json'
            first = collect(path, source, now)
            self.assertEqual(source.calls, 1)
            source.price = 11
            next_report = collect(path, source, now+HOUR)
            self.assertEqual(source.calls, 1)
            self.assertAlmostEqual(next_report['samples'][-1]['index'], 110)
            source.now = now+REBALANCE
            final = collect(path, source, source.now)
            self.assertEqual(source.calls, 2)
            self.assertNotEqual(first['basket'][0]['id'], final['basket'][0]['id'])
            self.assertAlmostEqual(final['samples'][-1]['index'], 110)
            self.assertEqual(len(final['snapshots']), 2)
            self.assertNotIn('boardCache', public_report(final))

    def test_failed_board_is_not_retried_by_five_minute_collector(self):
        now = 2_000_000_000_000
        source = FakeSources(now)
        source.fail_board = True
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'index.json'
            collect(path, source, now)
            collect(path, source, now+HOUR)
            self.assertEqual(source.calls, 1)

    def test_missing_price_preserves_history_and_timestamp(self):
        now = 2_000_000_000_000
        source = FakeSources(now)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'index.json'
            first = collect(path, source, now)
            source.missing = True
            later = collect(path, source, now+HOUR)
            self.assertEqual(later['samples'], first['samples'])
            self.assertEqual(later['updatedAt'], now)
            self.assertTrue(later['error'])

    def test_stale_leaderboard_is_rejected(self):
        now = 2_000_000_000_000
        data = board(now)
        data['stale'] = True
        with self.assertRaises(ValueError):
            candidates(data, now)
