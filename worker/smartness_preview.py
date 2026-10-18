import json
import sys
from worker.smartness import read_report, public_report, collect
from worker.wallet_universe import local_report
registry=local_report()['wallets']
report=collect('.data/smartness',registry) if len(sys.argv)>1 and sys.argv[1]=='collect' else read_report('.data/smartness')
print(json.dumps(public_report(report,registry)))
