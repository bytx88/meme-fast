"""Direct, exact-mint holdings with durable, fixed-membership observations."""
import hashlib
import json
import math
import os
import time
from pathlib import Path

CONFIG = Path(__file__).with_name('smart-wallets.json')
RETENTION_MS = 35 * 86400000
MAX_SAMPLES = 11000
CACHE_MS = 240000


def group():
    value = json.loads(CONFIG.read_text(encoding='utf-8'))
    addresses = [row['address'] for row in value['wallets']]
    if len(addresses) != len(set(addresses)):
        raise ValueError('Duplicate Smart wallet')
    identity = json.dumps([value['network'], value['token'], addresses], separators=(',', ':'))
    return dict(value, groupId=hashlib.sha256(identity.encode()).hexdigest()[:16])


def read_report(directory):
    cohort = group()
    try:
        value = json.loads((Path(directory) / (cohort['groupId'] + '.json')).read_text())
        if value['groupId'] == cohort['groupId'] and value['token'] == cohort['token']:
            return value
    except (OSError, ValueError, KeyError):
        pass
    return dict(cohort, version=1, attemptedAt=None, status='unavailable', supply=None,
                samples=[], wallets=[dict(row, balance=None, balanceRaw=None, checkedAt=None,
                                          status='unavailable') for row in cohort['wallets']])


def token_balance(payload, owner, mint, decimals):
    result = payload.get('result', {})
    if payload.get('error') or not isinstance(result.get('value'), list):
        raise ValueError('RPC balance unavailable')
    total = 0
    seen = set()
    for row in result['value']:
        address = row['pubkey']
        if address in seen:
            raise ValueError('Duplicate token account')
        seen.add(address)
        info = row['account']['data']['parsed']['info']
        amount = info['tokenAmount']
        if info['owner'] != owner or info['mint'] != mint or amount['decimals'] != decimals:
            raise ValueError('Token account does not match owner, mint or decimals')
        raw = amount['amount']
        if not isinstance(raw, str) or not raw.isascii() or not raw.isdigit():
            raise ValueError('Invalid raw token amount')
        total += int(raw)
    return total, result.get('context', {}).get('slot')


def market_price(payload, mint):
    pairs = [row for row in payload if row.get('chainId') == 'solana'
             and row.get('baseToken', {}).get('address') == mint]
    pairs.sort(key=lambda row: float(row.get('liquidity', {}).get('usd') or 0), reverse=True)
    for row in pairs:
        try:
            value = float(row['priceUsd'])
            if math.isfinite(value) and value > 0:
                return value
        except (ValueError, TypeError, KeyError):
            continue
    return None


def collect(directory, rpc=None, price_fetcher=None, now=None, pause=time.sleep):
    cohort = group()
    previous = read_report(directory)
    at = now if now is not None else int(time.time() * 1000)
    prior = {row['address']: row for row in previous['wallets']}
    client = None
    if rpc is None:
        import httpx
        import ssl
        import truststore
        client = httpx.Client(timeout=10, verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT))
        def rpc(method, params):
            response = client.post(os.getenv('SOLANA_WALLET_RPC_URL', 'https://api.mainnet-beta.solana.com'),
                                   json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
            response.raise_for_status()
            return response.json()
        def price_fetcher():
            response = client.get('https://api.dexscreener.com/token-pairs/v1/solana/' + cohort['token'])
            response.raise_for_status()
            return market_price(response.json(), cohort['token'])
    wallets, supply, price = [], previous.get('supply'), None
    try:
        for entry in cohort['wallets']:
            try:
                raw, slot = token_balance(rpc('getTokenAccountsByOwner', [entry['address'],
                    {'mint': cohort['token']}, {'encoding': 'jsonParsed', 'commitment': 'confirmed'}]),
                    entry['address'], cohort['token'], cohort['decimals'])
                row = dict(entry, balanceRaw=str(raw), balance=raw / 10**cohort['decimals'],
                           checkedAt=at, attemptedAt=at, slot=slot, status='ok')
            except Exception:
                old = prior.get(entry['address'], {})
                row = dict(entry, balanceRaw=old.get('balanceRaw'), balance=old.get('balance'),
                           checkedAt=old.get('checkedAt'), attemptedAt=at, status='unavailable')
            wallets.append(row)
            if client:
                pause(1.2)
        try:
            payload = rpc('getTokenSupply', [cohort['token'], {'commitment': 'confirmed'}])
            value = payload['result']['value']
            raw = int(value['amount'])
            if payload.get('error') or value['decimals'] != cohort['decimals'] or raw <= 0:
                raise ValueError('Supply unavailable')
            supply = dict(raw=str(raw), value=raw / 10**cohort['decimals'], checkedAt=at)
        except Exception:
            pass
        try:
            price = price_fetcher() if price_fetcher else None
            if price is not None and (not math.isfinite(price) or price <= 0):
                price = None
        except Exception:
            price = None
    finally:
        if client:
            client.close()
    complete = all(row['status'] == 'ok' for row in wallets)
    raw_total = sum(int(row['balanceRaw']) for row in wallets) if complete else None
    point = dict(time=at, balanceRaw=str(raw_total) if complete else None,
                 balance=raw_total / 10**cohort['decimals'] if complete else None,
                 checkedWallets=sum(row['status'] == 'ok' for row in wallets),
                 holders=sum(row['balance'] > 0 for row in wallets) if complete else None,
                 walletBalances=[row['balanceRaw'] if row['status'] == 'ok' else None for row in wallets],
                 priceUSD=price)
    # Never construct a group total from a mixture of stale and fresh wallets.
    samples = [row for row in previous.get('samples', [])
               if at - RETENTION_MS <= row['time'] < at]
    samples.append(point)
    report = dict(cohort, version=1, attemptedAt=at,
                  startedAt=previous.get('startedAt') or (previous['samples'][0]['time'] if previous['samples'] else at),
                  wallets=wallets, supply=supply,
                  status='ok' if complete else 'partial' if point['checkedWallets'] else 'unavailable',
                  samples=samples[-MAX_SAMPLES:], **({'backfill': previous['backfill']} if 'backfill' in previous else {}))
    path = Path(directory) / (cohort['groupId'] + '.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    os.replace(temporary, path)
    return report


if __name__ == '__main__':
    import sys
    report = collect(sys.argv[1])
    print(json.dumps({'status': report['status'], 'wallets': len(report['wallets']),
                      'latest': report['samples'][-1]}))
