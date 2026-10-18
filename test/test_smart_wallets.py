import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from worker import smart_wallets as smart

NOW = 1800000000000


def accounts(owner, mint, values):
    return {'result': {'context': {'slot': 123}, 'value': [
        {'pubkey': str(index), 'account': {'data': {'parsed': {'info': {
            'owner': owner, 'mint': mint, 'tokenAmount': {'amount': str(value), 'decimals': 6}
        }}}}} for index, value in enumerate(values)]}}


class SmartWalletTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cohort = smart.group()
        self.fail = set()
        self.empty = set()

    def rpc(self, method, params):
        if method == 'getTokenSupply':
            return {'result': {'value': {'amount': '1000000000000000', 'decimals': 6}}}
        owner = params[0]
        if owner in self.fail:
            raise ValueError('RPC unavailable')
        self.assertEqual(params[1], {'mint': self.cohort['token']})
        return accounts(owner, self.cohort['token'], [] if owner in self.empty else [1000000, 250000])

    def collect(self, at=NOW, price=lambda: .002):
        return smart.collect(self.directory.name, rpc=self.rpc, price_fetcher=price, now=at)

    def test_integer_amounts_sum_every_token_account_without_precision_loss(self):
        owner = self.cohort['wallets'][0]['address']
        raw, slot = smart.token_balance(accounts(owner, self.cohort['token'], [9007199254740993, 11]), owner, self.cohort['token'], 6)
        self.assertEqual(raw, 9007199254741004)
        self.assertEqual(slot, 123)

    def test_wrong_owner_mint_decimals_and_malformed_amount_are_rejected(self):
        owner, mint = self.cohort['wallets'][0]['address'], self.cohort['token']
        for field, value in [('owner', 'wrong'), ('mint', 'wrong')]:
            payload = accounts(owner, mint, [100])
            payload['result']['value'][0]['account']['data']['parsed']['info'][field] = value
            with self.assertRaises(ValueError): smart.token_balance(payload, owner, mint, 6)
        for amount in ['-1', '1.1', 'NaN', '١']:
            payload = accounts(owner, mint, [amount])
            with self.assertRaises(ValueError): smart.token_balance(payload, owner, mint, 6)
        with self.assertRaises(ValueError): smart.token_balance({'error': {}}, owner, mint, 6)

    def test_duplicate_accounts_are_rejected(self):
        owner, mint = self.cohort['wallets'][0]['address'], self.cohort['token']
        payload = accounts(owner, mint, [100])
        payload['result']['value'] *= 2
        with self.assertRaises(ValueError): smart.token_balance(payload, owner, mint, 6)

    def test_complete_observation_is_persisted_without_a_swap_feed(self):
        report = self.collect()
        latest = report['samples'][-1]
        self.assertEqual(report['status'], 'ok')
        self.assertEqual(latest['balanceRaw'], '11250000')
        self.assertEqual(latest['balance'], 11.25)
        self.assertEqual(latest['holders'], 9)
        self.assertEqual(len(latest['walletBalances']), 9)
        self.assertEqual(smart.read_report(self.directory.name), report)

    def test_failed_check_retains_stale_wallet_but_creates_a_group_gap(self):
        previous = self.collect()
        address = self.cohort['wallets'][0]['address']
        self.fail.add(address)
        report = self.collect(NOW + 300000)
        self.assertEqual(report['status'], 'partial')
        self.assertEqual(report['wallets'][0]['balance'], 1.25)
        self.assertEqual(report['wallets'][0]['checkedAt'], NOW)
        self.assertEqual(report['wallets'][0]['status'], 'unavailable')
        self.assertIsNone(report['samples'][-1]['balance'])
        self.assertIsNone(report['samples'][-1]['walletBalances'][0])
        self.assertEqual(report['samples'][0], previous['samples'][0])

    def test_confirmed_empty_clears_old_balance_and_remains_measured_zero(self):
        self.collect()
        self.empty.add(self.cohort['wallets'][0]['address'])
        report = self.collect(NOW + 300000)
        self.assertEqual(report['wallets'][0]['balanceRaw'], '0')
        self.assertEqual(report['wallets'][0]['status'], 'ok')
        self.assertEqual(report['samples'][-1]['holders'], 8)
        self.assertEqual(report['samples'][-1]['balance'], 10)

    def test_price_failure_does_not_discard_balances_or_reuse_old_price_as_fresh(self):
        self.collect()
        def failed(): raise ValueError('Unavailable')
        report = self.collect(NOW + 300000, price=failed)
        self.assertEqual(report['status'], 'ok')
        self.assertEqual(report['samples'][-1]['balance'], 11.25)
        self.assertIsNone(report['samples'][-1]['priceUSD'])

    def test_retention_never_backfills_unobserved_history(self):
        self.collect()
        report = self.collect(NOW + smart.RETENTION_MS + 1)
        self.assertEqual(len(report['samples']), 1)
        self.assertEqual(report['samples'][0]['time'], NOW + smart.RETENTION_MS + 1)
        self.assertEqual(report['startedAt'], NOW)

    def test_membership_change_uses_a_separate_file_and_keeps_old_history(self):
        self.collect()
        config = copy.deepcopy(self.cohort)
        config['wallets'].reverse()
        file = Path(self.directory.name) / 'group.json'
        file.write_text(json.dumps(config))
        with patch.object(smart, 'CONFIG', file):
            self.assertNotEqual(smart.group()['groupId'], self.cohort['groupId'])
            self.assertEqual(smart.read_report(self.directory.name)['samples'], [])
        self.assertEqual(len(smart.read_report(self.directory.name)['samples']), 1)

    def test_market_price_uses_exact_solana_base_token(self):
        mint = self.cohort['token']
        rows = [{'chainId': 'eth', 'baseToken': {'address': mint}, 'priceUsd': '999'},
                {'chainId': 'solana', 'baseToken': {'address': 'wrong'}, 'priceUsd': '999'},
                {'chainId': 'solana', 'baseToken': {'address': mint}, 'priceUsd': '.002', 'liquidity': {'usd': 10}},
                {'chainId': 'solana', 'baseToken': {'address': mint}, 'priceUsd': '.003', 'liquidity': {'usd': 100}}]
        self.assertEqual(smart.market_price(rows, mint), .003)


if __name__ == '__main__': unittest.main()
