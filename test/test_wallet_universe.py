import json
import unittest
import tempfile
from worker.followed_wallets import collect
from pathlib import Path
from worker.wallet_universe import universe, report, validate_entry, merge_import, smart_status
from worker.followed_wallets import registry_wallets
from worker.wallet_activity import acquisitions, analyze

class UniverseTests(unittest.TestCase):
    def test_import_priority_preserves_interested_identity_and_every_source(self):
        base=dict(registry_wallets()[0],source='Manual',interested=True,label='Interested Party')
        uploaded=dict(base,name='lower priority alias',source='Fomo',sources=['Track V2','Fomo'],code='',interested=False)
        merged=merge_import(base,uploaded)
        self.assertEqual((merged['name'],merged['code'],merged['interested']),(base['name'],base['code'],True))
        self.assertEqual(set(merged['sources']),{'Manual','Fomo','Track V2'})
        self.assertIn('lower priority alias',merged['aliases'])
        self.assertEqual(smart_status(merged),'non-smart')
        nansen=dict(base,name='Nansen name',code='',source='Nansen',interested=False)
        self.assertEqual(merge_import(nansen,uploaded)['name'],'Nansen name')
        self.assertEqual(merge_import(uploaded,nansen)['name'],'Nansen name')
        track=dict(nansen,name='Track name',source='Track V2')
        self.assertEqual(merge_import(track,uploaded)['name'],'lower priority alias')

    def test_money_class_is_independent_of_interest_and_source(self):
        for code in ('N1','N2','C1','C2','S1','S2'):
            self.assertEqual(smart_status(dict(code=code,source='Nansen',smartStatus='smart',interested=True)),'non-smart')
        for code in ('L1','L2','F1','F2'):
            self.assertEqual(smart_status(dict(code=code,source='Track V2',smartStatus='unclassified')),'smart')
        self.assertEqual(smart_status(dict(source='Track V2')),'unclassified')
        self.assertEqual(smart_status(dict(source='Track V2',sources=['Fomo','Track V2'])),'smart')
        self.assertEqual(smart_status(dict(source='Manual',interested=True)),'unclassified')
        from worker.smart_wallets import make_cohort, group
        rows=universe(registry_wallets())
        smart=make_cohort(group()['token'],rows,'universe')
        self.assertEqual({r['address'] for r in smart['wallets']},{r['address'] for r in rows if smart_status(r)=='smart'})
        self.assertEqual(len(make_cohort(group()['token'],rows,'interested')['wallets']),9)

    def test_seeds_and_interest_are_independent(self):
        rows=universe(registry_wallets())
        self.assertEqual(len(rows),22)
        self.assertEqual(sum(row['interested'] for row in rows),13)
        self.assertEqual(sum(row['source']=='Nansen' for row in rows),9)
        existing=rows[0]
        edited=dict(existing,interested=False)
        merged=universe(registry_wallets(),[edited])
        self.assertEqual(len(merged),22)
        self.assertFalse(merged[0]['interested'])
        self.assertEqual(merged[0]['code'],existing['code'])
        nansen=next(row for row in rows if row['source']=='Nansen')
        merged=universe(registry_wallets(),[dict(nansen,interested=True)])
        self.assertTrue(next(row for row in merged if row['address']==nansen['address'])['interested'])
        self.assertEqual(nansen['code'],'')

    def test_validation_and_report_keeps_identity_metadata(self):
        wallet=dict(name='Test',address=registry_wallets()[0]['address'],code='',source='Fomo',interested=True)
        self.assertEqual(validate_entry(wallet)['code'],'')
        for change in [dict(address='bad'),dict(source='fake'),dict(interested='false'),dict(discoveryToken='bad'),dict(code='bad')]:
            with self.assertRaises(ValueError):validate_entry(dict(wallet,**change))
        result=report([wallet],{'wallets':[dict(wallet,interested=False,checkedAt=1,status='ok',mints=['a'])]})
        self.assertTrue(result['wallets'][0]['interested'])
        self.assertEqual(result['wallets'][0]['mints'],['a'])
        self.assertIsNone(report([wallet],{})['wallets'][0]['checkedAt'])

    def test_collection_budget_preserves_unsampled_timestamps(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'report.json'
            row=dict(registry_wallets()[0],checkedAt=1000,attemptedAt=1000,status='ok',mints=['Token'])
            path.write_text(json.dumps({'wallets':[row]}))
            def forbidden(*args):raise AssertionError('No RPC after budget expires')
            result=collect(path,forbidden,now=2000,registry=[row],budget_seconds=0)
            self.assertEqual(result['wallets'][0]['checkedAt'],1000)
            self.assertEqual(result['wallets'][0]['attemptedAt'],1000)
            self.assertEqual(result['wallets'][0]['mints'],['Token'])

class ActivityTests(unittest.TestCase):
    def tx(self,swap=False,err=None):
        def balance(index,owner,amount):return dict(accountIndex=index,mint='Token',owner=owner,uiTokenAmount=dict(amount=amount,decimals=6))
        return dict(meta=dict(err=err,preTokenBalances=[balance(1,'owner','1000000'),balance(2,'other','5000000')],postTokenBalances=[balance(1,'owner','4000000'),balance(2,'other','2000000')],logMessages=['Program log: Instruction: Swap'] if swap else []))

    def test_transfer_is_not_buy_and_owner_delta_uses_raw_quantity(self):
        event=acquisitions(self.tx(),'owner')[0]
        self.assertEqual(event['quantity'],'3')
        self.assertEqual(event['kind'],'Received / unclassified')
        self.assertEqual(acquisitions(self.tx(True),'owner')[0]['kind'],'Swap-associated receipt')
        self.assertEqual(acquisitions(self.tx(err={'failed':True}),'owner'),[])
        tx=self.tx();del tx['meta']['preTokenBalances']
        self.assertEqual(acquisitions(tx,'owner'),[])

    def test_analyzer_scope_identity_and_partial_failure(self):
        calls=[];at=1700000000000
        def rpc(method,params):
            calls.append((method,params))
            if method=='getSignaturesForAddress':return [dict(signature='a',slot=1,blockTime=at//1000,err=None),dict(signature='b',slot=2,blockTime=at//1000,err=None),dict(signature='old',slot=3,blockTime=at//1000-86401,err=None)]
            if params[0]=='b':return None
            return dict(self.tx(True),slot=1,transaction=dict(signatures=['a']))
        result=analyze('owner',rpc,pause=lambda _:None,now=at)
        self.assertEqual((result['checked'],result['missing'],result['returned']),(1,1,3))
        self.assertEqual(result['status'],'partial')
        self.assertEqual(len(result['events']),1)
        self.assertEqual(calls[0][1][1]['limit'],8)
        self.assertEqual(calls[1][1][1]['maxSupportedTransactionVersion'],1)
        def wrong(method,params):
            if method=='getSignaturesForAddress':return [dict(signature='a',slot=1,blockTime=at//1000,err=None)]
            return dict(self.tx(True),slot=1,transaction=dict(signatures=['wrong']))
        self.assertEqual(analyze('owner',wrong,pause=lambda _:None,now=at)['events'],[])

if __name__=='__main__':unittest.main()
