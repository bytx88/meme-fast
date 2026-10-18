"""Instruction-scoped swap ledger for the shared Solana wallet universe."""
import json
import os
import time
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

PROGRAMS = {row['program']: row for row in json.loads(Path(__file__).with_name('smartness-programs.json').read_text())}
TOKEN_PROGRAMS = {'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'}
SYSTEM = '11111111111111111111111111111111'
SOL = 'So11111111111111111111111111111111111111112'
QUOTES = {SOL: ('SOL', 9), 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': ('USDC', 6), 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': ('USDT', 6)}
BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
RETENTION = 30 * 86400000


def decode58(value):
    number = 0
    for ch in value:
        number = number * 58 + BASE58.index(ch)
    return b'\0' * (len(value) - len(value.lstrip('1'))) + number.to_bytes((number.bit_length() + 7) // 8, 'big')


def parse_swaps(tx, owner):
    """Only recognized direct swap instructions with opposite quote/token flows."""
    if not tx or not tx.get('meta') or tx['meta'].get('err') is not None:
        return []
    message = tx.get('transaction', {}).get('message', {})
    keys = message.get('accountKeys', [])
    if not any(isinstance(key, dict) and key.get('pubkey') == owner and key.get('signer') for key in keys):
        return []
    addresses = [key.get('pubkey') if isinstance(key, dict) else key for key in keys]
    meta = tx['meta']
    if not all(isinstance(meta.get(key), list) for key in ('preTokenBalances', 'postTokenBalances')):
        return []
    accounts, decimals, state = {}, {}, [defaultdict(int), defaultdict(int)]
    for side, field in enumerate(('preTokenBalances', 'postTokenBalances')):
        for row in meta[field]:
            index = row.get('accountIndex')
            if not isinstance(index, int) or not 0 <= index < len(addresses):
                return []
            amount = row['uiTokenAmount']
            identity = (row['mint'], row.get('owner'))
            address = addresses[index]
            if address in accounts and accounts[address] != identity:
                return []
            accounts[address] = identity
            if row['mint'] in decimals and decimals[row['mint']] != amount['decimals']:
                return []
            decimals[row['mint']] = amount['decimals']
            if row.get('owner') == owner:
                state[side][row['mint']] += int(amount['amount'])
    for mint, (_, places) in QUOTES.items():
        if mint in decimals and decimals[mint] != places:
            return []
        decimals[mint] = places
    inner = {row['index']: row.get('instructions', []) for row in meta.get('innerInstructions', []) or []}
    # Temporary wrapped-SOL accounts may be created and closed within one tx.
    for instruction in [*message.get('instructions', []), *[ix for group in inner.values() for ix in group]]:
        if instruction.get('programId') not in TOKEN_PROGRAMS:
            continue
        parsed = instruction.get('parsed', {})
        if parsed.get('type') in ('initializeAccount', 'initializeAccount2', 'initializeAccount3'):
            info = parsed['info']
            identity = (info['mint'], info['owner'])
            if info['account'] in accounts and accounts[info['account']] != identity:
                return []
            accounts[info['account']] = identity
    events = []
    for index, instruction in enumerate(message.get('instructions', [])):
        program = PROGRAMS.get(instruction.get('programId'))
        if not program:
            continue
        try:
            spec = program['instructions'].get(decode58(instruction.get('data', ''))[:8].hex())
        except ValueError:
            continue
        if not spec:
            continue
        movements, native = defaultdict(int), 0
        valid = True
        for transfer in inner.get(index, []):
            parsed = transfer.get('parsed', {})
            info = parsed.get('info', {})
            if transfer.get('programId') == SYSTEM and parsed.get('type') == 'transfer':
                amount = int(info.get('lamports', 0))
                native += amount * ((1 if info.get('destination') == owner else 0) - (1 if info.get('source') == owner else 0))
            elif transfer.get('programId') in TOKEN_PROGRAMS and parsed.get('type') in ('transfer', 'transferChecked'):
                source, destination = accounts.get(info.get('source')), accounts.get(info.get('destination'))
                owned_source = bool(source and source[1] == owner)
                owned_destination = bool(destination and destination[1] == owner)
                if not owned_source and not owned_destination:
                    continue
                mint = source[0] if owned_source else destination[0]
                if owned_source and owned_destination and source[0] != destination[0]:
                    valid = False
                    break
                if info.get('mint', mint) != mint:
                    valid = False
                    break
                if parsed['type'] == 'transferChecked':
                    amount = info['tokenAmount']
                    if mint in decimals and amount['decimals'] != decimals[mint]:
                        valid = False
                        break
                    decimals[mint] = amount['decimals']
                    raw = int(amount['amount'])
                else:
                    raw = int(info['amount'])
                movements[mint] += raw * (int(owned_destination) - int(owned_source))
        targets = [(mint, raw) for mint, raw in movements.items() if mint not in QUOTES and raw]
        quotes = [(mint, raw) for mint, raw in movements.items() if mint in QUOTES and raw]
        if not quotes and native:
            quotes = [(SOL, native)]
        if not valid or len(targets) != 1 or len(quotes) != 1:
            continue
        mint, raw = targets[0]
        quote, quote_raw = quotes[0]
        if raw * quote_raw >= 0 or mint not in decimals:
            continue
        side = 'buy' if raw > 0 else 'sell'
        if spec['side'] and spec['side'] != side:
            continue
        quantity = Decimal(abs(raw)) / Decimal(10) ** decimals[mint]
        value = Decimal(abs(quote_raw)) / Decimal(10) ** QUOTES[quote][1]
        if quantity <= 0 or value <= 0:
            continue
        events.append(dict(address=owner, mint=mint, side=side, quantity=str(quantity), quote=QUOTES[quote][0], quoteAmount=str(value), program=program['name'], instruction=index))
    signed = defaultdict(Decimal)
    for event in events:
        signed[event['mint']] += Decimal(event['quantity']) * (1 if event['side'] == 'buy' else -1) * Decimal(10) ** decimals[event['mint']]
    return [event for event in events if signed[event['mint']] == state[1].get(event['mint'], 0) - state[0].get(event['mint'], 0)]


def read_report(directory):
    try:
        value = json.loads((Path(directory) / 'ledger.json').read_text())
        if value.get('version') == 1:
            return value
    except (OSError, ValueError):
        pass
    return dict(version=1, startedAt=None, attemptedAt=None, scanning=False, events=[], wallets=[], seen={}, tokens={})


def write_report(directory, report):
    path = Path(directory) / 'ledger.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, separators=(',', ':')))
    temporary.replace(path)


def public_report(report, registry):
    known = {row['address'] for row in registry}
    result = {key: value for key, value in report.items() if key != 'seen'}
    result['events'] = [row for row in report['events'] if row['address'] in known]
    scans = {row['address']: row for row in report['wallets']}
    result['wallets'] = [dict(row, scan=scans.get(row['address'])) for row in registry]
    from worker.smart_wallets import group
    cohort = group()
    result['tokens'] = dict(report.get('tokens', {}))
    result['tokens'].setdefault(cohort['token'], {'symbol': cohort['symbol']})
    result['coverage'] = 'Retained samples of recognized direct Jupiter, Pump and PumpSwap instructions. Each scan reads up to 40 latest signatures and eight unseen transactions per wallet, within 30 days. Unsupported routes, transfers, token-to-token swaps and missing transactions are excluded. Quote flow is actual SOL / USDC / USDT quantity, not historical USD value or profit.'
    return result


def token_metadata(pairs, requested):
    result = {}
    if not isinstance(pairs, list):
        return result
    for pair in pairs:
        if not isinstance(pair, dict) or pair.get('chainId') != 'solana':
            continue
        for side in ('baseToken', 'quoteToken'):
            token = pair.get(side) or {}
            mint, symbol = token.get('address'), token.get('symbol')
            if mint in requested and isinstance(symbol, str) and symbol.strip():
                result.setdefault(mint, {'symbol': symbol.strip()[:40]})
    return result


def collect(directory, registry, rpc=None, now=None, pause=time.sleep, budget_seconds=190):
    report = read_report(directory)
    at = now if now is not None else int(time.time() * 1000)
    cutoff = at - RETENTION
    deadline = time.monotonic() + budget_seconds
    client = None
    if rpc is None:
        import httpx
        import ssl
        import truststore
        client = httpx.Client(timeout=8, verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT))
        def rpc(method, params):
            pause(1.6)
            response = client.post(os.getenv('SOLANA_WALLET_RPC_URL', 'https://api.mainnet-beta.solana.com'), json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
            response.raise_for_status()
            value = response.json()
            if value.get('error'):
                raise ValueError('Public RPC unavailable or rate limited')
            return value.get('result')
    seen = {address: {sig: stamp for sig, stamp in entries.items() if stamp >= cutoff} for address, entries in report.get('seen', {}).items()}
    scans = {row['address']: row for row in report['wallets']}
    events = {row['id']: row for row in report['events'] if row['time'] >= cutoff}
    errors = 0
    metadata = dict(report.get('tokens', {}))
    try:
        for wallet in sorted(registry, key=lambda row: scans.get(row['address'], {}).get('attemptedAt') or 0):
            if time.monotonic() >= deadline:
                break
            owner = wallet['address']
            prior = scans.get(owner, {})
            scan = dict(prior, address=owner, attemptedAt=at, status='partial', error=None)
            seen.setdefault(owner, {})
            try:
                signatures = rpc('getSignaturesForAddress', [owner, {'limit': 40, 'commitment': 'confirmed'}])
                if not isinstance(signatures, list):
                    raise ValueError('Signature history unavailable')
                eligible = [row for row in signatures if row.get('blockTime') and cutoff <= row['blockTime'] * 1000 <= at and not row.get('err')]
                pending = [row for row in eligible if row['signature'] not in seen[owner]]
                checked, missing = 0, 0
                for row in pending[:8]:
                    if time.monotonic() >= deadline:
                        break
                    try:
                        tx = rpc('getTransaction', [row['signature'], {'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 1, 'commitment': 'confirmed'}])
                        if not tx or tx.get('transaction', {}).get('signatures', [None])[0] != row['signature'] or tx.get('slot') != row.get('slot') or tx.get('blockTime') != row['blockTime']:
                            raise ValueError('Transaction identity or time mismatch')
                        parsed = parse_swaps(tx, owner)
                        for event in parsed:
                            identity = owner + ':' + row['signature'] + ':' + str(event['instruction'])
                            events[identity] = dict(event, id=identity, signature=row['signature'], time=row['blockTime'] * 1000)
                        seen[owner][row['signature']] = row['blockTime'] * 1000
                        checked += 1
                    except Exception:
                        missing += 1
                scan.update(checkedAt=at, returned=len(signatures), eligible=len(eligible), inspected=checked, missing=missing, pending=len(pending)-checked, signatureCapped=len(signatures)>=40, status='partial' if missing or len(pending)>checked or len(signatures)>=40 else 'ok')
                if missing:
                    scan['error'] = 'Some transactions were unavailable, invalid or rate limited.'
            except Exception:
                scan.update(status='unavailable', error='Public RPC signature history unavailable or rate limited.')
                errors += 1
            scans[owner] = scan
            # Avoid multiplying public-provider rate limits across all wallets.
            if errors >= 2:
                break
        if client:
            requested = sorted({row['mint'] for row in events.values()} - metadata.keys())[:30]
            if requested:
                try:
                    response = client.get('https://api.dexscreener.com/tokens/v1/solana/' + ','.join(requested))
                    response.raise_for_status()
                    metadata.update(token_metadata(response.json(), set(requested)))
                except Exception:
                    pass  # Missing labels never change classified trade amounts.
    finally:
        if client:
            client.close()
    seen = {owner: dict(sorted(entries.items(), key=lambda pair: pair[1], reverse=True)[:2000]) for owner, entries in seen.items()}
    report.update(startedAt=report.get('startedAt') or at, attemptedAt=at, scanning=False, events=sorted(events.values(), key=lambda row: row['time'])[-50000:], wallets=list(scans.values()), seen=seen, tokens=metadata)
    if len(events) > 50000: report['eventCappedAt'] = at
    report['eventCapped'] = bool(report.get('eventCappedAt') and report['eventCappedAt'] >= cutoff)
    write_report(directory, report)
    return report


def ingest_evidence(directory, registry, evidence, now=None):
    """Authenticated-only replay of already verified public transaction evidence."""
    at = now if now is not None else int(time.time() * 1000)
    if not isinstance(evidence, list) or len(evidence) > 1000:
        raise ValueError('Use at most 1000 verified transactions')
    known = {row['address'] for row in registry}
    report = read_report(directory)
    events = {row['id']: row for row in report['events'] if at - RETENTION <= row['time'] <= at}
    imported = 0
    for item in evidence:
        owner, tx = item['address'], item['transaction']
        if owner not in known or not isinstance(tx.get('slot'), int) or tx['slot'] < 0:
            raise ValueError('Evidence owner or slot invalid')
        signature = tx.get('transaction', {}).get('signatures', [None])[0]
        stamp = tx.get('blockTime', 0) * 1000
        if not isinstance(signature, str) or len(decode58(signature)) != 64 or not at - RETENTION <= stamp <= at:
            raise ValueError('Evidence signature or time invalid')
        for event in parse_swaps(tx, owner):
            identity = owner + ':' + signature + ':' + str(event['instruction'])
            if identity not in events:
                imported += 1
            events[identity] = dict(event, id=identity, signature=signature, time=stamp)
        report.setdefault('seen', {}).setdefault(owner, {})[signature] = stamp
    report.update(events=sorted(events.values(), key=lambda row: row['time'])[-50000:], evidenceImportedAt=at)
    if report['events']:
        report['startedAt'] = min(report.get('startedAt') or at, report['events'][0]['time'])
    write_report(directory, report)
    return report, imported
