"""Replay the existing verified public transaction cache into Smartness."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from worker.smartness import parse_swaps, ingest_evidence, RETENTION
from worker.wallet_universe import local_report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    registry=local_report()['wallets']
    now=int(time.time()*1000)
    evidence=[]
    for path in sorted(args.cache.glob('*.json')):
        tx=json.loads(path.read_text())
        if not now-RETENTION<=tx.get('blockTime',0)*1000<=now:
            continue
        if tx.get('transaction',{}).get('signatures',[None])[0]!=path.stem:
            raise ValueError('Cache filename/signature mismatch')
        for wallet in registry:
            if parse_swaps(tx,wallet['address']):
                evidence.append({'address':wallet['address'],'transaction':tx})
    report,imported=ingest_evidence(ROOT/'.data/smartness',registry,evidence)
    print(json.dumps({'verifiedTransactions':len(evidence),'importedLocally':imported,'events':len(report['events'])}),flush=True)
    if args.apply:
        os.environ.update(MODAL_PROFILE='bytx24',MODAL_WORKSPACE='bytx24')
        for key in ('MODAL_TOKEN_ID','MODAL_TOKEN_SECRET','MODAL_ENVIRONMENT'):
            os.environ.pop(key,None)
        import truststore
        truststore.inject_into_ssl()
        import modal
        print(json.dumps(modal.Function.from_name('meme-fast','collect_smartness').remote(evidence=evidence)),flush=True)

if __name__=='__main__':main()
