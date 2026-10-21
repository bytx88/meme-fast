"""Bounded Solana holdings sampling for the user-assigned wallet classes."""
import json
import hashlib
import logging
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
if __package__:
    from worker.shared_holdings import observe
    from worker.data_stream import collection_order
else:
    from shared_holdings import observe
    from data_stream import collection_order

REGISTRY = Path(__file__).with_name('followed-wallets.json')
PROGRAMS = ('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')


CODES = {'F1', 'F2', 'Dev', 'C1', 'C2', 'S1', 'S2', 'N1', 'N2', 'L1', 'L2'}
BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def validate_wallet(value):
    if not isinstance(value, dict):
        raise ValueError('Enter a wallet name, Solana address and class')
    name, address, code = (value.get(key) for key in ('name', 'address', 'code'))
    if not all(isinstance(v, str) for v in (name, address, code)):
        raise ValueError('Enter a wallet name, Solana address and class')
    name, address = name.strip(), address.strip()
    if not name or len(name) > 80 or any(ord(ch) < 32 for ch in name):
        raise ValueError('Wallet name must contain 1 to 80 characters')
    if code not in CODES:
        raise ValueError('Choose a supported wallet class')
    if not 32 <= len(address) <= 44 or any(ch not in BASE58 for ch in address):
        raise ValueError('Enter a valid Solana wallet address')
    number = 0
    for ch in address:
        number = number * 58 + BASE58.index(ch)
    size = len(address) - len(address.lstrip('1')) + (number.bit_length() + 7) // 8
    if size != 32:
        raise ValueError('Enter a valid Solana wallet address')
    return dict(name=name, address=address, code=code, network='solana')


def registry_wallets(extra=()):
    rows = json.loads(REGISTRY.read_text())
    seen = {row['address'] for row in rows}
    for value in extra:
        row = validate_wallet(value)
        if row['address'] not in seen:
            rows.append(row)
            seen.add(row['address'])
    return rows


def registry_wallets_with_retry(read_items, transient_errors, sleep=time.sleep):
    """Retry an overloaded registry without collecting from a partial snapshot."""
    waits = (1, 2, 4)
    for attempt in range(len(waits) + 1):
        try:
            values = [value for _, value in read_items()]
        except transient_errors:
            if attempt == len(waits):
                raise
            logging.warning('Wallet registry overloaded; retrying full read in %s seconds', waits[attempt])
            sleep(waits[attempt])
        else:
            return registry_wallets(values)


def merge_report(report, registry):
    saved = {row['address']: row for row in report.get('wallets', [])}
    rows = []
    for entry in registry:
        old = saved.get(entry['address'], {})
        rows.append(dict(entry, checkedAt=old.get('checkedAt'), attemptedAt=old.get('attemptedAt'),
                         status=old.get('status', 'unavailable'), mints=old.get('mints', [])))
    return dict(report, version=1, wallets=rows)


def awaiting(registry=None):
    return {'version': 1, 'wallets': [dict(row, checkedAt=None, attemptedAt=None,
            status='unavailable', mints=[]) for row in (registry if registry is not None else registry_wallets())]}


def positive_mints(payload, owner):
    if payload.get('error') or not isinstance(payload.get('result', {}).get('value'), list):
        raise ValueError('RPC holdings unavailable')
    mints = set()
    for row in payload['result']['value']:
        info = row['account']['data']['parsed']['info']
        if info['owner'] != owner:
            raise ValueError('RPC owner mismatch')
        if int(info['tokenAmount']['amount']) > 0:
            mints.add(info['mint'])
    return mints


def collect(filename, fetcher=None, now=None, registry=None, budget_seconds=220, retain_mints=None):
    started = time.monotonic()
    deadline = started + budget_seconds
    fixed_now = now
    now = now if now is not None else int(time.time() * 1000)
    path = Path(filename)
    try:
        previous = {row['address']: row for row in json.loads(path.read_text())['wallets']}
    except (OSError, ValueError, KeyError):
        previous = {}
    if fetcher is None:
        import httpx
        import ssl
        import truststore
        client = httpx.Client(timeout=15, verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT))
        def fetcher(owner, program):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Wallet sampling budget exhausted')
            if os.getenv('MEME_SHARED_SOURCES') == '1':
                if __package__:
                    from worker.source_stream import shared_rpc
                else:
                    from source_stream import shared_rpc
                return {'result': shared_rpc('getTokenAccountsByOwner', [owner, {'programId': program},
                                            {'encoding': 'jsonParsed', 'commitment': 'confirmed'}])}
            response = client.post(os.getenv('SOLANA_WALLET_RPC_URL', 'https://api.mainnet-beta.solana.com'),
                timeout=min(15, remaining),
                json={'jsonrpc': '2.0', 'id': 1, 'method': 'getTokenAccountsByOwner',
                      'params': [owner, {'programId': program},
                                 {'encoding': 'jsonParsed', 'commitment': 'confirmed'}]})
            response.raise_for_status()
            return response.json()
    else:
        client = None
    # The RPC budget starts after client/TLS setup; the parent process still
    # enforces the independent overall deadline, including setup and shutdown.
    deadline = time.monotonic() + budget_seconds
    report = awaiting(registry)
    sampled = {}
    try:
        for row in collection_order(report['wallets'],previous):
            owner = row['address']
            old = previous.get(owner, {})
            recent = old.get('attemptedAt') and 0 <= now - old['attemptedAt'] < row.get('holdingsRefreshMs',row.get('refreshAfterMs', 0))
            if recent or time.monotonic() >= deadline:
                old = previous.get(owner, {})
                row.update(checkedAt=old.get('checkedAt'), attemptedAt=old.get('attemptedAt'), status=old.get('status', 'unavailable'), mints=old.get('mints', []), observation=old.get('observation'))
                continue
            if owner not in sampled:
                try:
                    mints, responses = set(), {}
                    sampled_at = fixed_now if fixed_now is not None else int(time.time() * 1000)
                    for program in PROGRAMS:
                        if time.monotonic() >= deadline:
                            raise TimeoutError('Wallet sampling budget exhausted')
                        responses[program] = fetcher(owner, program)
                        mints.update(positive_mints(responses[program], owner))
                        if client and os.getenv('MEME_SHARED_SOURCES') != '1':
                            time.sleep(min(1.5, max(0, deadline - time.monotonic())))
                    sampled[owner] = dict(checkedAt=sampled_at, attemptedAt=now, status='ok', mints=sorted(mints),
                                          observation=observe(owner, responses, min([sampled_at, *[
                                              value['result'].get('_sourceObservedAt', sampled_at) for value in responses.values()]]), retain_mints))
                    if sampled[owner]['observation']:
                        sampled[owner]['checkedAt'] = sampled[owner]['observation']['sampledAt']
                except Exception:
                    old = previous.get(owner, {})
                    sampled[owner] = dict(checkedAt=old.get('checkedAt'), attemptedAt=now,
                        status='unavailable', mints=old.get('mints', []), observation=old.get('observation'))
            row.update(sampled[owner])
    finally:
        if client:
            client.close()
    report['attemptedAt'] = now
    report['collection'] = dict(codeSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        elapsedSeconds=round(time.monotonic()-started, 1),
        sampledWallets=len(sampled), budgetReached=time.monotonic() >= deadline)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report, separators=(',', ':')))
    os.replace(temporary, path)
    return report


def collect_isolated(filename, registry, budget_seconds=180, timeout_seconds=210, retain_mints=None):
    """Stop even an RPC stuck reading a response before committing the Volume."""
    if not 0 < budget_seconds < timeout_seconds:
        raise ValueError('Sampling budget must fit inside the process deadline')
    # Registry transport lives outside the persistent Volume and is never uploaded.
    with tempfile.TemporaryDirectory(prefix='followed-wallets-') as folder:
        registry_path = Path(folder)/'registry.json'
        registry_path.write_text(json.dumps(registry), encoding='utf-8')
        arguments = []
        if retain_mints is not None:
            token_path = Path(folder)/'tokens.json'
            token_path.write_text(json.dumps(list(retain_mints)), encoding='utf-8')
            arguments = ['--retain-mints',str(token_path)]
        result = subprocess.run([sys.executable, str(Path(__file__).resolve()), str(filename),
            '--registry', str(registry_path), '--budget-seconds', str(budget_seconds), *arguments],
            capture_output=True, text=True, timeout=timeout_seconds)
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:] or f'Wallet collector exited {result.returncode}')
    return json.loads(Path(filename).read_text(encoding='utf-8'))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('filename')
    parser.add_argument('--registry')
    parser.add_argument('--budget-seconds', type=float, default=220)
    parser.add_argument('--retain-mints')
    args = parser.parse_args()
    registry = json.loads(Path(args.registry).read_text(encoding='utf-8')) if args.registry else None
    retained = json.loads(Path(args.retain_mints).read_text(encoding='utf-8')) if args.retain_mints else None
    report = collect(args.filename, registry=registry, budget_seconds=args.budget_seconds, retain_mints=retained)
    print(json.dumps({'wallets': len(report['wallets']),
                      'available': sum(row['status'] == 'ok' for row in report['wallets'])}))
