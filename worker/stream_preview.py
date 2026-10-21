"""Local stream collection uses only .data; never contacts deployed storage."""
import json
import sys
from pathlib import Path

from worker.data_stream import read, collect, collection_wallets
from worker.followed_wallets import collect as collect_holdings
from worker.wallet_universe import local_report
from worker.smartness import read_report


def run():
    registry = collection_wallets(local_report()['wallets'], read('.data'))
    holdings = collect_holdings('.data/followed-wallets.json', registry=registry, budget_seconds=180)
    try:
        snapshot = json.loads(Path('.data/coins.json').read_text())
    except (OSError, ValueError):
        snapshot = {}
    import httpx
    from worker.public_rpc import public_rpc
    with httpx.Client(timeout=12) as client:
        report = collect('.data', snapshot, holdings, read_report('.data/smartness'), rpc=public_rpc(client))
    return dict(updatedAt=report['updatedAt'], tokens=len(report['tokens']), wallets=len(report['wallets']))


if __name__ == '__main__':
    print(json.dumps(run()))
