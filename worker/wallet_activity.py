"""Bounded public RPC activity sample. Receipts alone never establish a buy."""
import os
import re
import time
from decimal import Decimal

SWAP_LOG = re.compile(r'^Program log: Instruction: (?:Swap(?:BaseIn|BaseOut|V2)?|Route|SharedAccountsRoute|Buy|BuyExactSolIn)$')


def acquisitions(tx, owner):
    if not tx or tx.get('meta', {}).get('err') is not None:
        return []
    meta = tx['meta']
    # Both sides must exist: a missing balance array is not a zero balance.
    if not isinstance(meta.get('preTokenBalances'), list) or not isinstance(meta.get('postTokenBalances'), list):
        return []
    totals = []
    for key in ('preTokenBalances', 'postTokenBalances'):
        side = {}
        for row in meta[key]:
            if row.get('owner') != owner:
                continue
            amount = row['uiTokenAmount']
            value = Decimal(amount['amount']) / Decimal(10) ** amount['decimals']
            side[row['mint']] = side.get(row['mint'], Decimal(0)) + value
        totals.append(side)
    before, after = totals
    deltas = {mint: after.get(mint, Decimal(0)) - before.get(mint, Decimal(0)) for mint in set(before) | set(after)}
    swap = any(SWAP_LOG.fullmatch(log) for log in meta.get('logMessages', []) or [])
    # A swap log can coexist with unrelated transfers; describe association,
    # not exact execution attribution or profit.
    return [dict(mint=mint, quantity=str(delta), kind='Swap-associated receipt' if swap else 'Received / unclassified')
            for mint, delta in deltas.items() if delta > 0]


def analyze(owner, rpc=None, pause=time.sleep, now=None):
    at = now or int(time.time() * 1000)
    client = None
    if rpc is None:
        import httpx
        import ssl
        import truststore
        client = httpx.Client(timeout=8, verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT))
        from worker.public_rpc import public_rpc
        rpc = public_rpc(client, pause=pause)
    events, checked, missing, returned = [], 0, 0, 0
    error = None
    try:
        signatures = rpc('getSignaturesForAddress', [owner, {'limit': 8, 'commitment': 'confirmed'}])
        if not isinstance(signatures, list):
            raise ValueError('Signature history unavailable')
        returned = len(signatures)
        for row in signatures:
            if row.get('err') or not row.get('blockTime') or row['blockTime'] * 1000 < at - 86400000:
                continue
            try:
                tx = rpc('getTransaction', [row['signature'], {'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 1, 'commitment': 'confirmed'}])
                if not tx:
                    raise ValueError('Transaction unavailable')
                actual = tx.get('transaction', {}).get('signatures', [])
                if not actual or actual[0] != row['signature'] or tx.get('slot') != row.get('slot'):
                    raise ValueError('Transaction identity mismatch')
                checked += 1
                for event in acquisitions(tx, owner):
                    events.append(dict(event, signature=row['signature'], time=row['blockTime'] * 1000))
            except Exception:
                missing += 1
        if missing:
            error = 'Some transactions were unavailable or rate limited.'
    except Exception:
        error = 'Public RPC history unavailable or rate limited. Try again later.'
    finally:
        if client:
            client.close()
    return dict(address=owner, checkedAt=at, returned=returned, checked=checked, missing=missing,
                events=events, status='partial' if error else 'ok', error=error,
                coverage='Latest eight address transactions, restricted to the past 24 hours. This is a sample, not complete buying history. Swap-associated receipts may include other transfers; no USD spend or profitability is inferred.')
