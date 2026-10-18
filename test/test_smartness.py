import copy
import tempfile
import unittest
from worker.smartness import PROGRAMS, SOL, QUOTES, parse_swaps, collect, read_report, public_report, ingest_evidence

USDC=next(m for m,q in QUOTES.items() if q[0]=='USDC')
JUP=next(p for p,row in PROGRAMS.items() if row['name']=='Jupiter')
TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
SYSTEM='11111111111111111111111111111111'
ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

def encode58(raw):
    n=int.from_bytes(raw,'big');out=''
    while n:n,r=divmod(n,58);out=ALPHABET[r]+out
    return '1'*(len(raw)-len(raw.lstrip(b'\0')))+out

SIGNATURE=encode58(bytes([7])*64)
AT=1792310000000

def balance(index,mint,owner,amount,decimals=6):
    return dict(accountIndex=index,mint=mint,owner=owner,uiTokenAmount=dict(amount=str(amount),decimals=decimals))

def fixture(side='buy',native=False):
    quote=SOL if native else USDC
    raw=5000000
    qraw=1000000000 if native else 10000000
    target_transfer=dict(programId=TOKEN,parsed=dict(type='transfer',info=dict(source='poolToken' if side=='buy' else 'ownedToken',destination='ownedToken' if side=='buy' else 'poolToken',amount=str(raw))))
    quote_transfer=dict(programId=SYSTEM,parsed=dict(type='transfer',info=dict(source='owner' if side=='buy' else 'poolNative',destination='poolNative' if side=='buy' else 'owner',lamports=qraw))) if native else dict(programId=TOKEN,parsed=dict(type='transferChecked',info=dict(source='ownedQuote' if side=='buy' else 'poolQuote',destination='poolQuote' if side=='buy' else 'ownedQuote',mint=quote,tokenAmount=dict(amount=str(qraw),decimals=6))))
    program=next(p for p,row in PROGRAMS.items() if row['name']=='Pump') if native else JUP
    opcode=next(d for d,spec in PROGRAMS[program]['instructions'].items() if spec['name']==side) if native else next(iter(PROGRAMS[program]['instructions']))
    before=[balance(1,'mint','owner',0 if side=='buy' else raw),balance(2,'mint','pool',raw if side=='buy' else 0)]
    after=[balance(1,'mint','owner',raw if side=='buy' else 0),balance(2,'mint','pool',0 if side=='buy' else raw)]
    if not native:
        before += [balance(3,quote,'owner',qraw if side=='buy' else 0),balance(4,quote,'pool',0 if side=='buy' else qraw)]
        after += [balance(3,quote,'owner',0 if side=='buy' else qraw),balance(4,quote,'pool',qraw if side=='buy' else 0)]
    return dict(slot=123,blockTime=AT//1000,meta=dict(err=None,fee=5000,preTokenBalances=before,postTokenBalances=after,innerInstructions=[dict(index=0,instructions=[target_transfer,quote_transfer])]),transaction=dict(signatures=[SIGNATURE],message=dict(accountKeys=[dict(pubkey='owner',signer=True),dict(pubkey='ownedToken'),dict(pubkey='poolToken'),dict(pubkey='ownedQuote'),dict(pubkey='poolQuote')],instructions=[dict(programId=program,data=encode58(bytes.fromhex(opcode)+b'\0'*16))])))

class DecoderTests(unittest.TestCase):
    def test_actual_buy_sell_quote_units(self):
        for side in ('buy','sell'):
            event=parse_swaps(fixture(side),'owner')[0]
            self.assertEqual((event['side'],event['quantity'],event['quote'],event['quoteAmount']),(side,'5','USDC','10'))

    def test_native_quote_excludes_rent_and_network_fee(self):
        for side in ('buy','sell'):
            tx=fixture(side,native=True)
            tx['meta']['innerInstructions'][0]['instructions'].append(dict(programId=SYSTEM,parsed=dict(type='createAccount',info=dict(source='owner',lamports=2039280))))
            event=parse_swaps(tx,'owner')[0]
            self.assertEqual((event['quote'],event['quoteAmount'],event['side']),('SOL','1',side))

    def test_receipt_and_forged_logs_do_not_establish_swaps(self):
        tx=fixture();tx['transaction']['message']['instructions'][0]['programId']='unknown'
        tx['meta']['logMessages']=['Program log: Instruction: Swap']
        self.assertEqual(parse_swaps(tx,'owner'),[])
        tx=fixture();tx['transaction']['message']['instructions'][0]['data']=encode58(bytes(24))
        self.assertEqual(parse_swaps(tx,'owner'),[])
        tx=fixture();tx['meta']['innerInstructions'][0]['instructions'].pop()
        self.assertEqual(parse_swaps(tx,'owner'),[])

    def test_failures_non_signer_and_inconsistent_owner_balances_rejected(self):
        tx=fixture();tx['meta']['err']={'failed':1};self.assertEqual(parse_swaps(tx,'owner'),[])
        tx=fixture();tx['transaction']['message']['accountKeys'][0]['signer']=False;self.assertEqual(parse_swaps(tx,'owner'),[])
        tx=fixture();tx['meta']['postTokenBalances'][0]['uiTokenAmount']['amount']='4999999';self.assertEqual(parse_swaps(tx,'owner'),[])
        tx=fixture();tx['meta']['innerInstructions'][0]['instructions'][1]['parsed']['info']['tokenAmount']['decimals']=9;self.assertEqual(parse_swaps(tx,'owner'),[])

    def test_unknown_or_conflicting_metadata_rejected(self):
        tx=fixture();tx['meta']['postTokenBalances'][0]['owner']='different';self.assertEqual(parse_swaps(tx,'owner'),[])
        tx=fixture();del tx['meta']['preTokenBalances'];self.assertEqual(parse_swaps(tx,'owner'),[])

class LedgerTests(unittest.TestCase):
    registry=[dict(address='owner',name='Owner',interested=True,source='Manual')]
    def rpc(self,method,params):
        if method=='getSignaturesForAddress':return [dict(signature=SIGNATURE,slot=123,blockTime=AT//1000,err=None)]
        return fixture()

    def test_idempotent_collection_and_public_scope(self):
        with tempfile.TemporaryDirectory() as folder:
            first=collect(folder,self.registry,self.rpc,now=AT)
            second=collect(folder,self.registry,self.rpc,now=AT+1000)
            self.assertEqual(len(first['events']),1);self.assertEqual(len(second['events']),1)
            self.assertEqual(second['wallets'][0]['inspected'],0)
            self.assertNotIn('seen',public_report(second,self.registry))
            self.assertEqual(public_report(second,[])['events'],[])

    def test_bad_identity_and_unavailable_rpc_preserve_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            collect(folder,self.registry,self.rpc,now=AT)
            def fail(*args):raise ValueError('rate limit')
            report=collect(folder,self.registry,fail,now=AT+1000)
            self.assertEqual(len(report['events']),1)
            self.assertEqual(report['wallets'][0]['checkedAt'],AT)
            self.assertEqual(report['wallets'][0]['status'],'unavailable')
        with tempfile.TemporaryDirectory() as folder:
            def wrong(method,params):
                result=self.rpc(method,params)
                if method=='getTransaction':result['slot']=999
                return result
            report=collect(folder,self.registry,wrong,now=AT)
            self.assertEqual(report['events'],[])
            self.assertEqual(report['wallets'][0]['missing'],1)

    def test_evidence_replay_is_idempotent_and_preserves_scan_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            collect(folder,self.registry,self.rpc,now=AT)
            tx=fixture('sell');tx['transaction']['signatures']=[encode58(bytes([8])*64)]
            report,count=ingest_evidence(folder,self.registry,[dict(address='owner',transaction=tx)],now=AT+1000)
            self.assertEqual(count,1);self.assertEqual(len(report['events']),2)
            self.assertEqual(report['attemptedAt'],AT)
            report,count=ingest_evidence(folder,self.registry,[dict(address='owner',transaction=tx)],now=AT+1000)
            self.assertEqual(count,0)
            with self.assertRaises(ValueError):ingest_evidence(folder,[],[dict(address='owner',transaction=tx)],now=AT+1000)

    def test_budget_does_not_invent_checks(self):
        with tempfile.TemporaryDirectory() as folder:
            report=collect(folder,self.registry,lambda *args:self.fail('Unexpected RPC'),now=AT,budget_seconds=0)
            self.assertEqual(report['wallets'],[])
            self.assertEqual(report['events'],[])

if __name__=='__main__':unittest.main()
