"""Apply an explicitly requested, validated Smart history artifact using its single writer."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from worker.smart_wallets import group


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('payload')
    parser.add_argument('--apply', action='store_true', help='Write the requested history to the bytx24 meme-fast Smart Volume')
    args = parser.parse_args()
    payload = json.loads(Path(args.payload).read_text(encoding='utf-8'))
    cohort = group()
    if payload['groupId'] != cohort['groupId'] or payload['wallets'] != [row['address'] for row in cohort['wallets']]:
        raise ValueError('Payload does not match the current Smart group')
    print(json.dumps(dict(groupId=payload['groupId'], samples=len(payload['samples']), metadata=payload['metadata'])), flush=True)
    if not args.apply:
        print('Local artifact inspection only; no production write performed.')
        return
    os.environ.update(MODAL_PROFILE='bytx24', MODAL_WORKSPACE='bytx24')
    for key in ('MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET', 'MODAL_ENVIRONMENT'):
        os.environ.pop(key, None)
    import truststore
    truststore.inject_into_ssl()
    import modal
    function = modal.Function.from_name('meme-fast', 'collect_smart_wallets')
    result = function.remote(backfill=payload)
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
