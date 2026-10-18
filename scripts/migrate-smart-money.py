"""Preview/apply the authorized legacy SmartMoney conversion on bytx24 only."""
import argparse
import collections
import concurrent.futures
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from worker.wallet_universe import migrate_smart_money


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.environ['MODAL_PROFILE'] = 'bytx24'
    os.environ['MODAL_WORKSPACE'] = 'bytx24'
    import truststore
    truststore.inject_into_ssl()
    import modal
    registry = modal.Dict.from_name('meme-fast-wallet-universe')
    before = dict(registry.items())
    plan = {address: migrate_smart_money(row) for address, row in before.items()}
    changed = {address: row for address, row in plan.items() if row != before[address]}
    folder = Path('.data')
    folder.mkdir(exist_ok=True)
    backup = folder / ('smart-money-migration-' + str(int(time.time())) + '.json')
    backup.write_text(json.dumps(dict(before=before, after=plan), ensure_ascii=False), encoding='utf-8')
    print(json.dumps(dict(wallets=len(plan), changes=len(changed),
                          flags=dict(collections.Counter(row['smartStatus'] for row in plan.values())),
                          backup=str(backup), apply=args.apply)), flush=True)
    if not args.apply:
        return
    def update(item):
        address, row = item
        if registry.get(address) != before[address]:
            raise RuntimeError('Concurrent wallet edit; not overwritten: ' + address)
        registry.put(address, row)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(update, changed.items()))
    after = dict(registry.items())
    for address, row in plan.items():
        assert after[address] == row, 'Read-back mismatch: ' + address
        preserved = {key: value for key, value in row.items() if key not in ('smartMoney', 'smartStatus')}
        assert preserved == {key: value for key, value in before[address].items() if key not in ('smartMoney', 'smartStatus')}
    print('Verified: flags saved; names, classes, Interested, sources and metadata preserved.', flush=True)


if __name__ == '__main__':
    main()
