"""Public research candidates; large holders are never verified Smart Money labels."""
import time
from collections import defaultdict
from worker.followed_wallets import validate_wallet, PROGRAMS
from worker.smartness import decode58, SYSTEM


def valid_address(address):
    validate_wallet(dict(name='Candidate', address=address, code='F1'))
    return address


def on_curve(address):
    """Reject program-derived authorities, which cannot be ordinary signing wallets."""
    raw = decode58(address)
    if len(raw) != 32:
        return False
    encoded = int.from_bytes(raw, 'little')
    y = encoded & ((1 << 255) - 1)
    p = 2**255 - 19
    if y >= p:
        return False
    d = -121665 * pow(121666, p - 2, p) % p
    denominator = (d * y * y + 1) % p
    if not denominator:
        return False
    x2 = (y*y - 1) * pow(denominator, p - 2, p) % p
    return (x2 == 0 and not (encoded >> 255)) or pow(x2, (p - 1)//2, p) == 1


def holder_candidates(mint, rpc, now=None):
    valid_address(mint)
    largest = rpc('getTokenLargestAccounts', [mint, {'commitment': 'confirmed'}])
    rows = largest.get('value') if isinstance(largest, dict) else None
    if not isinstance(rows, list):
        raise ValueError('Public holder data unavailable')
    rows = rows[:20]
    if not rows:
        return dict(token=mint, checkedAt=now or int(time.time()*1000), candidates=[], sampledAccounts=0, excludedAccounts=0)
    config = {'encoding': 'jsonParsed', 'commitment': 'confirmed'}
    slot = largest.get('context', {}).get('slot')
    if isinstance(slot, int):
        config['minContextSlot'] = slot
    account_addresses = [valid_address(row['address']) for row in rows]
    if len(set(account_addresses)) != len(account_addresses):
        raise ValueError('Duplicate token accounts in public holder response')
    payload = rpc('getMultipleAccounts', [account_addresses, config])
    accounts = payload.get('value') if isinstance(payload, dict) else None
    if not isinstance(accounts, list) or len(accounts) != len(rows):
        raise ValueError('Public token account resolution unavailable')
    owners, places, excluded = defaultdict(int), None, 0
    for account in accounts:
        try:
            if not account or account.get('owner') not in PROGRAMS:
                raise ValueError()
            info = account['data']['parsed']['info']
            if info['mint'] != mint or info.get('state') not in ('initialized', 'frozen'):
                raise ValueError()
            owner = valid_address(info['owner'])
            if not on_curve(owner):
                raise ValueError()
            amount = info['tokenAmount']
            decimals = amount['decimals']
            raw = amount['amount']
            if not isinstance(decimals, int) or not 0 <= decimals <= 18 or not isinstance(raw, str) or not raw.isascii() or not raw.isdigit():
                raise ValueError()
            if places is not None and decimals != places:
                raise ValueError('Inconsistent token decimals')
            places = decimals
            owners[owner] += int(raw)
        except (KeyError, TypeError, ValueError):
            excluded += 1
    # System-owned authorities only; executable accounts and program custody are excluded.
    addresses = sorted(owners, key=lambda owner: (-owners[owner], owner))
    if addresses:
        resolved = rpc('getMultipleAccounts', [addresses, config])
        values = resolved.get('value') if isinstance(resolved, dict) else None
        if not isinstance(values, list) or len(values) != len(addresses):
            raise ValueError('Public owner resolution unavailable')
    else:
        values = []
    candidates = []
    for owner, account in zip(addresses, values):
        if account and (account.get('executable') or account.get('owner') != SYSTEM):
            excluded += 1
            continue
        if owners[owner] <= 0:
            continue
        candidates.append(dict(address=owner, balanceRaw=str(owners[owner]), balance=owners[owner]/10**places,
                               label='Public holder candidate', source='Public', discoveryToken=mint))
    return dict(token=mint, checkedAt=now or int(time.time()*1000), candidates=candidates[:10],
                sampledAccounts=len(rows), excludedAccounts=excluded,
                coverage='Up to 10 signing-wallet candidates from 20 largest token accounts. Program authorities are excluded. Balances cover sampled accounts only. Holding size does not verify skill, identity or profitability.')


def discover(token=''):
    import httpx
    import ssl
    import truststore
    with httpx.Client(timeout=12, verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)) as client:
        if not token:
            response = client.get('https://api.geckoterminal.com/api/v2/networks/solana/trending_pools', params={'include': 'base_token', 'page': 1})
            response.raise_for_status()
            body = response.json()
            included = {row['id']: row for row in body.get('included', []) if row.get('type') == 'token'}
            tokens = {}
            for pool in body.get('data', []):
                row = included.get(pool.get('relationships', {}).get('base_token', {}).get('data', {}).get('id'), {})
                info = row.get('attributes', {})
                address = info.get('address')
                if address:
                    try:
                        valid_address(address)
                        tokens.setdefault(address, dict(address=address, symbol=str(info.get('symbol') or address[:8])[:40]))
                    except ValueError:
                        pass
            return dict(tokens=list(tokens.values())[:15], checkedAt=int(time.time()*1000), source='GeckoTerminal Solana trending pools')
        from worker.public_rpc import public_rpc
        rpc = public_rpc(client)
        return holder_candidates(token, rpc)
