"""Reconstruct the discovered token accounts; never infer missing transaction history."""
import hashlib
import json
import math
import os
from pathlib import Path

from worker.smart_wallets import group, read_report, MAX_SAMPLES, RETENTION_MS

STEP = 300000
SOURCE = 'rpc-reconstructed'
SCOPE = 'Complete histories of the nine discovered token accounts, reconciled to current balances. Additional historical accounts, including closed non-associated accounts, are not verified.'


def reconstruct(cache_dir):
    directory = Path(cache_dir)
    cohort = group()
    anchor = json.loads((directory / 'accounts.json').read_text())
    if [row['address'] for row in anchor['wallets']] != [row['address'] for row in cohort['wallets']]:
        raise ValueError('Anchor membership differs from the configured group')
    end = anchor['at']
    start = end - 30 * 86400000
    changes, evidence, accounts = [], set(), []
    for index, wallet in enumerate(anchor['wallets']):
        if not wallet['accounts']:
            raise ValueError('Historical account discovery is missing')
        for account in wallet['accounts']:
            signatures = json.loads((directory / ('signatures-' + account['address'] + '.json')).read_text())
            if not signatures or len(signatures) >= 1000:
                raise ValueError('Account signature pagination is incomplete')
            previous = None
            rows = sorted(signatures, key=lambda row: (row['slot'], row.get('transactionIndex', 0)))
            for signature in rows:
                if signature.get('err') is not None:
                    continue
                tx = json.loads((directory / 'transactions' / (signature['signature'] + '.json')).read_text())
                if tx['slot'] != signature['slot'] or signature['signature'] not in tx['transaction']['signatures']:
                    raise ValueError('Transaction identity mismatch')
                if tx['meta']['err'] is not None or tx['blockTime'] is None:
                    raise ValueError('Failed or undated transaction in successful history')
                keys = [row['pubkey'] if isinstance(row, dict) else row for row in tx['transaction']['message']['accountKeys']]
                account_index = keys.index(account['address'])
                sides = []
                for field in ('preTokenBalances', 'postTokenBalances'):
                    values = [row for row in tx['meta'][field] if row['accountIndex'] == account_index]
                    if len(values) > 1:
                        raise ValueError('Duplicate account balance metadata')
                    value = values[0] if values else None
                    if value and (value['mint'] != cohort['token'] or value.get('owner') != wallet['address']
                                  or value['uiTokenAmount']['decimals'] != cohort['decimals']):
                        raise ValueError('Historical mint, owner or decimals mismatch')
                    raw = value['uiTokenAmount']['amount'] if value else '0'
                    if not isinstance(raw, str) or not raw.isascii() or not raw.isdigit():
                        raise ValueError('Malformed historical raw balance')
                    sides.append(int(raw))
                before, after = sides
                if previous is None:
                    instructions = tx['transaction']['message']['instructions'] + [item for group in tx['meta'].get('innerInstructions', []) for item in group['instructions']]
                    initialized = any(item.get('parsed', {}).get('type', '').startswith('initializeAccount')
                                      and item['parsed']['info'].get('account') == account['address']
                                      and item['parsed']['info'].get('mint') == cohort['token'] for item in instructions)
                    if before != 0 or not initialized:
                        raise ValueError('History does not reach verified token-account creation')
                elif before != previous:
                    raise ValueError('Historical balance continuity gap')
                previous = after
                if tx['slot'] > wallet['slot']:
                    raise ValueError('Account anchor predates downloaded transactions')
                changes.append((tx['blockTime'] * 1000, tx['slot'], signature.get('transactionIndex', 0), index, after - before))
                evidence.add(signature['signature'])
            if previous is None or previous != int(account['raw']):
                raise ValueError('Reconstruction does not reconcile to current balance')
            accounts.append(dict(wallet=wallet['address'], account=account['address'], transactions=len(rows)))
    changes.sort()
    prices = []
    for candle in json.loads((directory / 'prices.json').read_text())['data']['attributes']['ohlcv_list']:
        if len(candle) >= 6 and all(isinstance(value, (int, float)) and math.isfinite(value) for value in candle[:6]) and candle[4] > 0:
            # An hourly closing price is known at the end of its candle, never earlier.
            prices.append((int(candle[0] * 1000 + 3600000), candle[4]))
    prices.sort()
    price_by_time = dict(prices)
    balances = [0] * len(cohort['wallets'])
    cursor, samples = 0, []
    for at in range((start // STEP + 1) * STEP, end + 1, STEP):
        while cursor < len(changes) and changes[cursor][0] <= at:
            _, _, _, index, delta = changes[cursor]
            balances[index] += delta
            if balances[index] < 0:
                raise ValueError('Reconstructed balance becomes negative')
            cursor += 1
        raw = sum(balances)
        samples.append(dict(time=at, balanceRaw=str(raw), balance=raw / 10**cohort['decimals'],
                            walletBalances=[str(value) for value in balances], checkedWallets=len(balances),
                            holders=sum(value > 0 for value in balances), priceUSD=price_by_time.get(at), source=SOURCE))
    if not samples:
        raise ValueError('No reconstructed samples')
    digest = hashlib.sha256('\n'.join(sorted(evidence)).encode()).hexdigest()
    metadata = dict(source=SOURCE, fromTime=samples[0]['time'], toTime=samples[-1]['time'],
                    transactions=len(evidence), evidenceHash=digest, accounts=accounts,
                    ownerAuditComplete=False, priceSource=json.loads((directory / 'price-source.json').read_text()),
                    scope=SCOPE)
    return dict(groupId=cohort['groupId'], token=cohort['token'], wallets=[row['address'] for row in cohort['wallets']],
                samples=samples, metadata=metadata)


def install_backfill(directory, payload, now):
    cohort = group()
    if payload.get('groupId') != cohort['groupId'] or payload.get('token') != cohort['token'] or payload.get('wallets') != [row['address'] for row in cohort['wallets']]:
        raise ValueError('Backfill group mismatch')
    incoming = payload.get('samples', [])
    metadata = payload.get('metadata', {})
    if not 1 <= len(incoming) <= 9000 or metadata.get('source') != SOURCE or len(metadata.get('accounts', [])) < 9:
        raise ValueError('Backfill evidence is incomplete')
    if {row.get('wallet') for row in metadata['accounts']} != set(payload['wallets']) or len({row.get('account') for row in metadata['accounts']}) != len(metadata['accounts']):
        raise ValueError('Backfill account membership mismatch')
    clean, previous_time = [], 0
    for row in incoming:
        at = row['time']
        raw = row['walletBalances']
        if not isinstance(at, int) or not now - RETENTION_MS <= at <= now or at % STEP or at <= previous_time or len(raw) != 9:
            raise ValueError('Backfill sample range or order is invalid')
        if any(not isinstance(value, str) or not value.isascii() or not value.isdigit() for value in raw):
            raise ValueError('Invalid backfill raw balance')
        total = sum(int(value) for value in raw)
        if str(total) != row['balanceRaw'] or row.get('source') != SOURCE:
            raise ValueError('Backfill aggregate mismatch')
        price = row.get('priceUSD')
        if price is not None and (not isinstance(price, (int, float)) or not math.isfinite(price) or price <= 0):
            raise ValueError('Invalid historical price')
        clean.append(dict(row, balance=total / 10**cohort['decimals'], checkedWallets=9,
                          holders=sum(int(value) > 0 for value in raw)))
        previous_time = at
    report = read_report(directory)
    observed = [row for row in report['samples'] if row.get('source') != SOURCE]
    if not observed:
        raise ValueError('Collect a live balance snapshot before importing history')
    first = min(row['time'] for row in observed)
    historical = [row for row in clean if row['time'] < first]
    samples = sorted(historical + observed, key=lambda row: row['time'])[-MAX_SAMPLES:]
    report = dict(report, samples=samples, backfill=dict(metadata, scope=SCOPE, ownerAuditComplete=False,
                  importedAt=now, importedSamples=len(historical), importedToTime=historical[-1]['time'] if historical else None))
    path = Path(directory) / (cohort['groupId'] + '.json')
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    os.replace(temporary, path)
    return report


def collect_evidence(cache_dir):
    """Bounded, resumable public reads; immutable transactions are cached by signature."""
    import httpx
    import ssl
    import time
    import truststore
    cohort = group()
    directory = Path(cache_dir)
    (directory / 'transactions').mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=30, verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)) as client:
        def rpc(method, params):
            for attempt in range(4):
                response = client.post(os.getenv('SOLANA_WALLET_RPC_URL', 'https://api.mainnet-beta.solana.com'),
                    json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
                value = response.json()
                if response.status_code == 429 or value.get('error', {}).get('code') == 429:
                    time.sleep(max(5, min(120, float(response.headers.get('retry-after', 15)))))
                    continue
                response.raise_for_status()
                if value.get('error') or value.get('result') is None:
                    raise ValueError('Historical RPC response unavailable: ' + str(value.get('error', {}).get('code')))
                time.sleep(1.2)
                return value['result']
            raise ValueError('Historical RPC rate limit; rerun to resume cached evidence')
        wallets = []
        for wallet in cohort['wallets']:
            current = rpc('getTokenAccountsByOwner', [wallet['address'], {'mint': cohort['token']}, {'encoding': 'jsonParsed', 'commitment': 'finalized'}])
            accounts = []
            for account in current['value']:
                address = account['pubkey']
                signatures = rpc('getSignaturesForAddress', [address, {'limit': 1000, 'commitment': 'finalized'}])
                if len(signatures) >= 1000:
                    raise ValueError('Account needs deeper signature pagination; backfill withheld')
                (directory / ('signatures-' + address + '.json')).write_text(json.dumps(signatures))
                for signature in signatures:
                    target = directory / 'transactions' / (signature['signature'] + '.json')
                    if signature.get('err') is None and not target.exists():
                        tx = rpc('getTransaction', [signature['signature'], {'encoding': 'jsonParsed', 'commitment': 'finalized', 'maxSupportedTransactionVersion': 1}])
                        target.write_text(json.dumps(tx, separators=(',', ':')))
                accounts.append(dict(address=address, raw=account['account']['data']['parsed']['info']['tokenAmount']['amount']))
            wallets.append(dict(wallet, slot=current['context']['slot'], accounts=accounts))
            print('Collected:', wallet['name'], flush=True)
        (directory / 'accounts.json').write_text(json.dumps(dict(at=int(time.time() * 1000), wallets=wallets)))
        base = 'https://api.geckoterminal.com/api/v2/networks/solana'
        response = client.get(base + '/tokens/' + cohort['token'] + '/pools')
        response.raise_for_status()
        pool = max(response.json()['data'], key=lambda row: float(row['attributes'].get('reserve_in_usd') or 0))['attributes']['address']
        response = client.get(base + '/pools/' + pool + '/ohlcv/hour', params=dict(aggregate=1, limit=1000, currency='usd', token=cohort['token']))
        response.raise_for_status()
        (directory / 'prices.json').write_text(response.text)
        (directory / 'price-source.json').write_text(json.dumps(dict(pool=pool, interval='hour', source='GeckoTerminal')))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache_dir')
    parser.add_argument('output')
    parser.add_argument('--collect', action='store_true')
    args = parser.parse_args()
    if args.collect:
        collect_evidence(args.cache_dir)
    payload = reconstruct(args.cache_dir)
    Path(args.output).write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    print(json.dumps(dict(samples=len(payload['samples']), **payload['metadata'])))
