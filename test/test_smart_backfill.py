import json
import tempfile
import unittest
from pathlib import Path
from worker.smart_wallets import group, collect, read_report
from worker.smart_backfill import reconstruct, install_backfill, SOURCE, STEP

NOW = 1800000000000


class BackfillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        (self.path / 'transactions').mkdir()
        self.cohort = group()
        wallets = []
        for i, wallet in enumerate(self.cohort['wallets']):
            account, sig = 'account' + str(i), 'signature' + str(i)
            value = dict(accountIndex=0, mint=self.cohort['token'], owner=wallet['address'], uiTokenAmount=dict(amount='1000000', decimals=6))
            tx = dict(slot=100, blockTime=(NOW - 86400000) // 1000,
                      transaction=dict(signatures=[sig], message=dict(accountKeys=[account], instructions=[dict(parsed=dict(type='initializeAccount3', info=dict(account=account, mint=self.cohort['token'])))])),
                      meta=dict(err=None, preTokenBalances=[], postTokenBalances=[value], innerInstructions=[]))
            (self.path / 'transactions' / (sig + '.json')).write_text(json.dumps(tx))
            signatures = [dict(signature=sig, slot=100, transactionIndex=0, err=None)]
            (self.path / ('signatures-' + account + '.json')).write_text(json.dumps(signatures))
            wallets.append(dict(wallet, slot=200, accounts=[dict(address=account, raw='1000000')]))
        (self.path / 'accounts.json').write_text(json.dumps(dict(at=NOW, wallets=wallets)))
        # Closing prices become available at the end of their hourly candle.
        candle = [NOW // 1000 - 3600, .01, .02, .005, .015, 100]
        (self.path / 'prices.json').write_text(json.dumps(dict(data=dict(attributes=dict(ohlcv_list=[candle])))))
        (self.path / 'price-source.json').write_text(json.dumps(dict(pool='pool', source='GeckoTerminal', interval='hour')))

    def payload(self): return reconstruct(self.path)

    def live(self):
        def rpc(method, params):
            if method == 'getTokenSupply': return dict(result=dict(value=dict(amount='100000000', decimals=6)))
            return {'result': {'context': {'slot': 200}, 'value': [{'pubkey': 'current', 'account': {'data': {'parsed': {'info': {
                'owner': params[0], 'mint': self.cohort['token'], 'tokenAmount': {'amount': '1000000', 'decimals': 6}
            }}}}}]}}
        return collect(self.path / 'live', rpc=rpc, now=NOW, price_fetcher=lambda: .02)

    def test_reconstructs_zero_before_creation_and_exact_raw_balances_afterwards(self):
        result = self.payload()
        self.assertEqual(len(result['samples']), 8640)
        self.assertEqual(result['samples'][0]['balanceRaw'], '0')
        self.assertEqual(result['samples'][-1]['balanceRaw'], '9000000')
        self.assertEqual(result['metadata']['transactions'], 9)
        self.assertFalse(result['metadata']['ownerAuditComplete'])
        self.assertTrue(all(row['source'] == SOURCE for row in result['samples']))

    def test_missing_transaction_and_wrong_owner_withhold_backfill(self):
        file = self.path / 'transactions' / 'signature0.json'
        tx = json.loads(file.read_text())
        tx['meta']['postTokenBalances'][0]['owner'] = 'wrong'
        file.write_text(json.dumps(tx))
        with self.assertRaisesRegex(ValueError, 'owner'): self.payload()
        file.unlink()
        with self.assertRaises(FileNotFoundError): self.payload()

    def test_rejects_missing_creation_and_anchor_mismatch(self):
        file = self.path / 'transactions' / 'signature0.json'
        tx = json.loads(file.read_text())
        tx['transaction']['message']['instructions'] = []
        file.write_text(json.dumps(tx))
        with self.assertRaisesRegex(ValueError, 'creation'): self.payload()

    def test_same_block_transactions_keep_ledger_order_and_check_continuity(self):
        creation = json.loads((self.path / 'transactions' / 'signature0.json').read_text())
        sale = json.loads(json.dumps(creation))
        sale['transaction']['signatures'] = ['sale']
        sale['transaction']['message']['instructions'] = []
        sale['meta']['preTokenBalances'] = json.loads(json.dumps(sale['meta']['postTokenBalances']))
        sale['meta']['postTokenBalances'][0]['uiTokenAmount']['amount'] = '500000'
        (self.path / 'transactions' / 'sale.json').write_text(json.dumps(sale))
        (self.path / 'signatures-account0.json').write_text(json.dumps([
            dict(signature='sale', slot=100, transactionIndex=1, err=None),
            dict(signature='signature0', slot=100, transactionIndex=0, err=None)]))
        anchor = json.loads((self.path / 'accounts.json').read_text())
        anchor['wallets'][0]['accounts'][0]['raw'] = '500000'
        (self.path / 'accounts.json').write_text(json.dumps(anchor))
        self.assertEqual(self.payload()['samples'][-1]['balanceRaw'], '8500000')
        sale['meta']['preTokenBalances'][0]['uiTokenAmount']['amount'] = '900000'
        (self.path / 'transactions' / 'sale.json').write_text(json.dumps(sale))
        with self.assertRaisesRegex(ValueError, 'continuity'): self.payload()

    def test_anchor_mismatch_withholds_the_entire_group_history(self):
        anchor = json.loads((self.path / 'accounts.json').read_text())
        anchor['wallets'][0]['accounts'][0]['raw'] = '7'
        (self.path / 'accounts.json').write_text(json.dumps(anchor))
        with self.assertRaisesRegex(ValueError, 'reconcile'): self.payload()

    def test_prices_are_not_backdated_before_the_candle_close(self):
        rows = self.payload()['samples']
        self.assertIsNone(rows[-2]['priceUSD'])
        self.assertEqual(rows[-1]['priceUSD'], .015)

    def test_preserves_observed_points_and_future_collection_keeps_history_metadata(self):
        live = self.live()
        payload = self.payload()
        report = install_backfill(self.path / 'live', payload, NOW)
        self.assertEqual(report['samples'][-1], live['samples'][-1])
        self.assertEqual(report['backfill']['importedSamples'], 8639)
        self.assertEqual(len(report['samples']), 8640)
        self.assertEqual(read_report(self.path / 'live'), report)
        self.live()
        self.assertEqual(read_report(self.path / 'live')['backfill'], report['backfill'])

    def test_wrong_group_and_corrupt_aggregate_are_rejected_before_writing(self):
        self.live()
        payload = self.payload()
        original = read_report(self.path / 'live')
        wrong = dict(payload, groupId='wrong')
        with self.assertRaises(ValueError): install_backfill(self.path / 'live', wrong, NOW)
        payload['samples'][0]['balanceRaw'] = '999'
        with self.assertRaises(ValueError): install_backfill(self.path / 'live', payload, NOW)
        self.assertEqual(read_report(self.path / 'live'), original)


if __name__ == '__main__': unittest.main()
