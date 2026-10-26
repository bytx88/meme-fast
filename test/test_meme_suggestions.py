import copy
import json
import runpy
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from worker.meme_preset import default_config
from worker.meme_suggestions import ENDPOINT, Unavailable, fetch_suggestions, ranked_suggestions

NOW = 2_000_000_000_000
HOUR = 3_600_000


def iso(stamp=NOW-60_000):
    return datetime.fromtimestamp(stamp/1000, timezone.utc).isoformat().replace('+00:00', 'Z')


def token(rank=1, network=1399811149, address='A'*32, **updates):
    row = dict(rank=rank, network=network, holders=None,
               token=dict(address=address, symbol='T'+str(rank), name='Token '+str(rank)))
    row.update(updates)
    return row


def board(*rows, **updates):
    payload = dict(board='most-held', source='live-fomo', capturedAt=iso(), stale=False,
                   count=len(rows), tokens=list(rows))
    payload.update(updates)
    return payload


def response(payload=None, status=200, content=None):
    return SimpleNamespace(status_code=status,
                           content=json.dumps(payload).encode() if content is None else content,
                           json=lambda: payload)


class FakeClient:
    def __init__(self, reply=None, failure=None):
        self.reply = reply or response(board(token()))
        self.failure = failure
        self.calls = []

    def get(self, url, **options):
        self.calls.append((url, options))
        if self.failure:
            raise self.failure
        return self.reply


class FomoSuggestionsTests(unittest.TestCase):
    def test_one_explicit_most_held_request_uses_existing_bearer_credential(self):
        config = default_config()
        original = copy.deepcopy(config)
        client = FakeClient()
        result = fetch_suggestions(config, client=client, key='test-key', now=NOW)
        self.assertEqual(len(client.calls), 1)
        url, options = client.calls[0]
        self.assertEqual(url, ENDPOINT)
        self.assertEqual(options['params'], {'limit': 25})
        self.assertEqual(options['headers']['authorization'], 'Bearer test-key')
        self.assertEqual(result['source'], 'FOMO most-held')
        self.assertEqual(result['observedAt'], NOW-60_000)
        self.assertEqual(result['suggestions'][0]['quoteStatus'], 'not_requested')
        self.assertNotIn('eligible', result['suggestions'][0])
        self.assertNotIn('priceChange1h', result['suggestions'][0])
        self.assertEqual(config, original)

    def test_null_holders_on_current_most_held_board_do_not_discard_ranked_tokens(self):
        payload = board(token(1), token(2, address='B'*32, holders=250),
                        token(3, address='C'*32, holders=0))
        result = ranked_suggestions(payload, default_config(), now=NOW)
        self.assertEqual([row['rank'] for row in result['suggestions']], [1, 2, 3])
        self.assertEqual([row['holders'] for row in result['suggestions']], [None, 250, 0])
        self.assertIn('Holder count not provided by FOMO', result['suggestions'][0]['reasons'])

    def test_preserves_fomo_rank_without_reordering_by_holders_prices_or_liquidity(self):
        payload = board(token(3, address='C'*32, holders=1_000_000, liquidity=1e9, change24h=9000),
                        token(1, holders=10, liquidity=1, change24h=-20),
                        token(2, address='B'*32, holders=100))
        original = copy.deepcopy(payload)
        result = ranked_suggestions(payload, default_config(), now=NOW)
        self.assertEqual([row['rank'] for row in result['suggestions']], [1, 2, 3])
        self.assertEqual(payload, original)

    def test_keeps_the_full_twenty_five_board_with_no_top_ten_cutoff(self):
        rows = [token(rank=index+1, network=8453, address='0x'+format(index+1, '040x')) for index in range(25)]
        result = ranked_suggestions(board(*rows), default_config(), now=NOW)
        self.assertEqual(len(result['suggestions']), 25)
        self.assertEqual([row['rank'] for row in result['suggestions']], list(range(1, 26)))

    def test_original_network_ids_map_to_current_network_names(self):
        mapping = [(1399811149, 'solana', 'A'*32), (4663, 'robinhood', '0x'+'ab'*20),
                   (56, 'bsc', '0x'+'cd'*20), (1, 'ethereum', '0x'+'ef'*20),
                   (8453, 'base', '0x'+'12'*20)]
        rows = [token(rank=index+1, network=network, address=address) for index, (network, _, address) in enumerate(mapping)]
        result = ranked_suggestions(board(*rows), default_config(), now=NOW)
        self.assertEqual([row['network'] for row in result['suggestions']], [row[1] for row in mapping])

    def test_omits_active_exact_members_and_deduplicates_evm_without_collapsing_solana_case(self):
        config = default_config()
        member = config['members'][0]
        rows = [token(1, address=member['contract_address']),
                token(2, address='A'*32), token(3, address='a'*32),
                token(4, network=8453, address='0x'+'AB'*20),
                token(5, network=8453, address='0x'+'ab'*20)]
        result = ranked_suggestions(board(*rows), config, now=NOW)
        self.assertEqual([row['rank'] for row in result['suggestions']], [2, 3, 4])
        self.assertEqual(result['suggestions'][-1]['contract_address'], '0x'+'ab'*20)

    def test_unsupported_networks_bad_ranks_and_invalid_contracts_are_never_guessed(self):
        rows = [token(), token(2, network=999), token(3, address='ticker-only'),
                token(True, address='B'*32), token(4.5, address='C'*32),
                token(5, network=True, address='0x'+'ab'*20), token(6, token=None), None]
        result = ranked_suggestions(board(*rows), default_config(), now=NOW)
        self.assertEqual([row['rank'] for row in result['suggestions']], [1])

    def test_stored_captured_fallback_stale_future_and_wrong_boards_are_rejected(self):
        invalid = [board(token(), source='captured'), board(token(), stale=True),
                   board(token(), capturedAt=iso(NOW-HOUR-1)), board(token(), capturedAt=iso(NOW+1)),
                   board(token(), board='trending'), board(token(), capturedAt='bad'),
                   board(token(), capturedAt='2030-01-01T00:00:00'), {'available': False},
                   board(token(), tokens='bad'), board(*([token()]*26)), None]
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(Unavailable):
                ranked_suggestions(payload, default_config(), now=NOW)

    def test_missing_credentials_and_invalid_config_make_no_provider_call(self):
        client = FakeClient()
        for key in ('', ' ', None, 'bad\nkey'):
            with patch.dict('os.environ', {}, clear=True), self.subTest(key=key), self.assertRaises(Unavailable):
                fetch_suggestions(default_config(), client=client, key=key, now=NOW)
        self.assertEqual(client.calls, [])
        with self.assertRaises(ValueError):
            fetch_suggestions({}, client=client, key='test-key', now=NOW)
        self.assertEqual(client.calls, [])

    def test_http_failures_are_one_call_without_retry_seed_or_sensitive_error_details(self):
        for status in (301, 401, 402, 403, 404, 429, 500, 503):
            client = FakeClient(response({'error': 'private-provider-body test-key'}, status))
            with self.subTest(status=status), self.assertRaises(Unavailable) as raised:
                fetch_suggestions(default_config(), client=client, key='test-key', now=NOW)
            self.assertEqual(len(client.calls), 1)
            self.assertNotIn('test-key', str(raised.exception))
            self.assertNotIn('private-provider-body', str(raised.exception))
        client = FakeClient(failure=RuntimeError('private-request-error test-key'))
        with self.assertRaises(Unavailable) as raised:
            fetch_suggestions(default_config(), client=client, key='test-key', now=NOW)
        self.assertEqual(len(client.calls), 1)
        self.assertNotIn('test-key', str(raised.exception))

    def test_oversized_and_malformed_replies_are_truthfully_unavailable(self):
        client = FakeClient(response(board(token()), content=b'x'*2_000_001))
        with self.assertRaises(Unavailable):
            fetch_suggestions(default_config(), client=client, key='test-key', now=NOW)
        malformed = response()
        def broken():
            raise ValueError('private-body test-key')
        malformed.json = broken
        with self.assertRaises(Unavailable) as raised:
            fetch_suggestions(default_config(), client=FakeClient(malformed), key='test-key', now=NOW)
        self.assertNotIn('test-key', str(raised.exception))

    def test_import_and_pure_normalization_do_not_initialize_a_network_client(self):
        with patch('httpx.Client') as factory:
            module = runpy.run_path(str(Path(__file__).parents[1]/'worker/meme_suggestions.py'))
            module['ranked_suggestions'](board(token()), default_config(), now=NOW)
            factory.assert_not_called()


if __name__ == '__main__':
    unittest.main()
