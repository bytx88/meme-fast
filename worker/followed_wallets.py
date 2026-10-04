"""Bounded Solana holdings sampling for the user-assigned wallet classes."""
import json
import os
import time
from pathlib import Path

REGISTRY = Path(__file__).with_name('followed-wallets.json')
PROGRAMS = ('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')


CODES = {'F1', 'F2', 'Dev', 'C1', 'C2', 'N1', 'N2', 'L1'}
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


def collect(filename, fetcher=None, now=None, registry=None):
    now = now or int(time.time() * 1000)
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
            response = client.post(os.getenv('SOLANA_WALLET_RPC_URL', 'https://api.mainnet-beta.solana.com'),
                json={'jsonrpc': '2.0', 'id': 1, 'method': 'getTokenAccountsByOwner',
                      'params': [owner, {'programId': program},
                                 {'encoding': 'jsonParsed', 'commitment': 'confirmed'}]})
            response.raise_for_status()
            return response.json()
    else:
        client = None
    report = awaiting(registry)
    sampled = {}
    try:
        for row in report['wallets']:
            owner = row['address']
            if owner not in sampled:
                try:
                    mints = set()
                    for program in PROGRAMS:
                        mints.update(positive_mints(fetcher(owner, program), owner))
                        if client:
                            time.sleep(1.5)
                    sampled[owner] = dict(checkedAt=now, attemptedAt=now, status='ok', mints=sorted(mints))
                except Exception:
                    old = previous.get(owner, {})
                    sampled[owner] = dict(checkedAt=old.get('checkedAt'), attemptedAt=now,
                        status='unavailable', mints=old.get('mints', []))
            row.update(sampled[owner])
    finally:
        if client:
            client.close()
    report['attemptedAt'] = now
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report, separators=(',', ':')))
    os.replace(temporary, path)
    return report


if __name__ == '__main__':
    import sys
    report = collect(sys.argv[1])
    print(json.dumps({'wallets': len(report['wallets']),
                      'available': sum(row['status'] == 'ok' for row in report['wallets'])}))
