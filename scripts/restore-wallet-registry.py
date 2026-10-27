"""Restore missing approved wallets on bytx24/main, preserving all live entries."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from worker.wallet_universe import validate_entry


async def restore(apply):
    for key in ('MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET', 'MODAL_ENVIRONMENT'):
        os.environ.pop(key, None)
    os.environ.update(MODAL_PROFILE='bytx24', MODAL_WORKSPACE='bytx24')
    import truststore
    truststore.inject_into_ssl()
    import modal
    registry = modal.Dict.from_name('meme-fast-wallet-universe', environment_name='main', create_if_missing=False)
    seed = json.loads((ROOT / 'worker/wallet-universe-seed.json').read_text(encoding='utf-8'))
    for row in seed:
        validate_entry(row)
    assert len(seed) == len({row['address'] for row in seed})
    before = dict([item async for item in registry.items.aio()])
    missing = [row for row in seed if row['address'] not in before]
    folder = ROOT / '.data'
    folder.mkdir(exist_ok=True)
    backup = folder / f'wallet-recovery-{time.time_ns()}.json'
    backup.write_text(json.dumps(dict(before=before, missing=missing), ensure_ascii=False), encoding='utf-8')
    print(json.dumps(dict(existing=len(before), missing=len(missing), backup=str(backup), apply=apply)), flush=True)
    if not apply:
        return
    gate = asyncio.Semaphore(8)

    async def save(row):
        async with gate:
            # Atomic insert protects edits/additions made after the initial read.
            await registry.put.aio(row['address'], row, skip_if_exists=True)

    await asyncio.gather(*(save(row) for row in missing))
    after = dict([item async for item in registry.items.aio()])
    assert all(row['address'] in after for row in seed), 'Restored addresses missing'
    assert all(key in after for key in before), 'Existing address missing'
    print(json.dumps(dict(stored=len(after), restoredBaseline=len(seed), preservedExisting=len(before))), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    asyncio.run(restore(parser.parse_args().apply))
