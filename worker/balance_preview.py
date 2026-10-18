"""Local-only balance selection, independent of deployed history."""
import json
import sys
from worker.smart_wallets import collect, read_report, make_cohort
from worker.wallet_universe import local_report

token = sys.argv[1] if len(sys.argv) > 1 else ''
scope = sys.argv[2] if len(sys.argv) > 2 else 'universe'
cohort = make_cohort(token, local_report()['wallets'], scope) if token else None
report = collect('.data/smart-wallets', cohort=cohort) if len(sys.argv) > 3 and sys.argv[3] == 'collect' else read_report('.data/smart-wallets', cohort)
print(json.dumps(report))
