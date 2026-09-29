"""Forward-only, equal-weight FOMO basket; no historical membership backcast."""
import json
import copy
import math
import os
import re
import time
from datetime import datetime
from pathlib import Path

HOUR = 3_600_000
REBALANCE = 72 * HOUR
NETWORKS = {1399811149: 'solana', 4663: 'robinhood', 56: 'bsc', 1: 'eth', 8453: 'base'}
ALT_EXCLUDE = {'BTC', 'ETH', 'USDT', 'USDC', 'DAI', 'USDE', 'PYUSD', 'FDUSD', 'TUSD',
               'USDD', 'FRAX', 'USDS', 'USD1', 'RLUSD', 'WBTC', 'WETH', 'STETH',
               'WSTETH', 'BETH', 'PAXG', 'XAUT'}


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) and value > 0 else None
    except (TypeError, ValueError):
        return None


def identity(chain, address):
    return chain + ':' + (address if chain == 'solana' else address.lower())


def alt_observation(rows, now):
    """One-hour cap-weighted return of 25 large alts from a bounded 50-row feed."""
    eligible = []
    for row in rows:
        cap = number(row.get('market_cap_usd'))
        try:
            change = float(row['percent_change_1h'])
        except (TypeError, ValueError, KeyError):
            continue
        if (row.get('symbol') in ALT_EXCLUDE or not cap or not math.isfinite(change)
                or change <= -90):
            continue
        eligible.append((row, cap, change))
    selected = sorted(eligible, key=lambda item: int(item[0].get('rank') or 1_000_000))[:25]
    if len(selected) != 25:
        raise ValueError('Broad-alt one-hour sample incomplete')
    current = sum(cap for _, cap, _ in selected)
    prior = sum(cap / (1 + change / 100) for _, cap, change in selected)
    return {'value': current, 'hourChange': (current / prior - 1) * 100,
            'providerAt': now, 'source': 'CoinLore top 25 alts'}



def candidates(payload, now, max_age=HOUR):
    captured = datetime.fromisoformat(payload['capturedAt'].replace('Z', '+00:00')).timestamp() * 1000
    if payload.get('stale') or payload.get('source') != 'live-fomo' or not 0 <= now - captured <= max_age:
        raise ValueError('Fresh FOMO leaderboard unavailable')
    result, seen = [], set()
    for row in sorted(payload.get('tokens', []), key=lambda r: r['rank']):
        chain = NETWORKS.get(row.get('network'))
        token = row.get('token', {})
        address = token.get('address', '')
        pattern = r'[1-9A-HJ-NP-Za-km-z]{32,44}' if chain == 'solana' else r'0x[0-9a-fA-F]{40}'
        if not chain or not re.fullmatch(pattern, address) or not number(row.get('holders')):
            continue
        key = identity(chain, address)
        if key in seen:
            continue
        seen.add(key)
        result.append({'id': key, 'chain': chain, 'address': address, 'rank': row['rank'],
                       'name': str(token.get('name', ''))[:100], 'symbol': str(token.get('symbol', ''))[:32],
                       'weight': .1, 'source': 'fomo-most-held', 'capturedAt': captured})
    return result


class Sources:
    def __init__(self):
        import httpx
        self.client = httpx.Client(timeout=12)

    def get(self, url, **kwargs):
        response = self.client.get(url, **kwargs)
        if response.status_code != 200:
            raise ValueError('Provider HTTP ' + str(response.status_code))
        return response.json()

    def board(self):
        key = os.environ.get('FOMO_KEY')
        if not key:
            raise ValueError('FOMO credential unavailable')
        return self.get('https://api.fomoapi.io/v2/leaderboard/tokens/most-held',
                        headers={'authorization': 'Bearer ' + key})

    def quotes(self, tokens, now):
        """Resolve up to 30 exact contracts with one bounded DexScreener request."""
        if not tokens or len(tokens) > 30:
            raise ValueError('Invalid basket quote batch')
        addresses = ','.join(token['address'] for token in tokens)
        pairs = self.get('https://api.dexscreener.com/latest/dex/tokens/' + addresses).get('pairs') or []
        result = {}
        for token in tokens:
            chain = {'eth': 'ethereum'}.get(token['chain'], token['chain'])
            candidates = []
            for pair in pairs:
                base = pair.get('baseToken') or {}
                if pair.get('chainId') != chain or identity(token['chain'], base.get('address', '')) != token['id']:
                    continue
                price = number(pair.get('priceUsd'))
                liquidity = number((pair.get('liquidity') or {}).get('usd'))
                volume = number((pair.get('volume') or {}).get('h24'))
                change = (pair.get('priceChange') or {}).get('h1')
                try:
                    change = float(change)
                except (TypeError, ValueError):
                    continue
                if price and liquidity and liquidity >= 10_000 and volume and math.isfinite(change) and change > -90:
                    candidates.append({'price': price, 'liquidity': liquidity, 'source': 'DexScreener',
                                       'h1': change, 'at': now})
            if candidates:
                result[token['id']] = max(candidates, key=lambda q: q['liquidity'])
        return result

    def alt(self, now):
        data = self.get('https://api.coinlore.net/api/tickers/', params={'start': 0, 'limit': 50})
        return alt_observation(data['data'], now)


def record_reading(report, now, quotes, alt):
    changes = [quotes[token['id']].get('h1') for token in report['basket']]
    if any(value is None or not math.isfinite(value) or value <= -90 for value in changes):
        raise ValueError('One-hour meme price change unavailable')
    report.setdefault('readings', []).append({'at': now,
        'meme': sum(changes) / 10, 'altDelta': alt['hourChange']})
    report['readings'] = [row for row in report['readings'] if now - row['at'] <= 30 * 24 * HOUR]
    report['readingAt'] = now
    report['altMethod'] = alt['source']



def advance(report, now, quotes, alt):
    """Commit only a complete, aligned sample. Missing constituents never become zero."""
    basket = report['basket']
    if len(basket) != 10 or any(t['id'] not in quotes for t in basket):
        raise ValueError('All 10 constituent quotes are required')
    previous = report.get('previous')
    level = previous['index'] if previous else 100.0
    if previous:
        level *= sum(quotes[t['id']]['price'] / previous['prices'][t['id']] for t in basket) / 10
    report.setdefault('samples', []).append({'at': now, 'index': level, 'alt': alt['value']})
    report['samples'] = [s for s in report['samples'] if now - s['at'] <= 30 * 24 * HOUR]
    report['previous'] = {'index': level, 'prices': {t['id']: quotes[t['id']]['price'] for t in basket}}
    report['quotes'] = copy.deepcopy(quotes)
    report['altProviderAt'] = alt['providerAt']
    report['updatedAt'] = now


def collect(path, sources=None, now=None, checkpoint_commit=None):
    now = int(now or time.time() * 1000)
    sources = sources or Sources()
    path = Path(path)
    try:
        report = json.loads(path.read_text())
    except FileNotFoundError:
        report = {'version': 1, 'basket': [], 'snapshots': [], 'samples': []}
        seed_path = Path(__file__).with_name('meme-index-seed.json')
        if seed_path.exists():
            seed = json.loads(seed_path.read_text(encoding='utf-8'))
            captured = datetime.fromisoformat(seed['capturedAt'].replace('Z', '+00:00')).timestamp() * 1000
            if 0 <= now - captured < REBALANCE:
                report['boardCache'] = seed
                report['boardAttemptAt'] = captured
    if now - report.get('updatedAt', 0) < 240_000:
        return report
    report['attemptedAt'] = now
    cache = {}
    def quote(token):
        if token['id'] not in cache:
            raise ValueError('Liquid exact-contract 1h quote unavailable')
        return cache[token['id']]
    try:
        alt = sources.alt(now)
        if report['basket']:
            cache.update(sources.quotes(report['basket'], now))
            for token in report['basket']:
                quote(token)
            if report.get('altMethod') != 'CoinLore top 25 alts':
                report['samples'] = []
            if any(token.get('priceSource') != 'DexScreener' for token in report['basket']):
                # Preserve the level while switching the hidden index to one batch price source.
                if report.get('previous'):
                    report['previous']['prices'] = {t['id']: cache[t['id']]['price'] for t in report['basket']}
                for token in report['basket']:
                    token['priceSource'] = 'DexScreener'
            advance(report, now, cache, alt)
            record_reading(report, now, cache, alt)
        due = not report['basket'] or now - report.get('rebalancedAt', 0) >= REBALANCE
        if due:
            if now - report.get('boardAttemptAt', 0) >= REBALANCE:
                report['boardAttemptAt'] = now
                # Save the attempt before the network request, including on process timeout.
                path.parent.mkdir(parents=True, exist_ok=True)
                checkpoint = path.with_suffix('.tmp')
                checkpoint.write_text(json.dumps(report, allow_nan=False), encoding='utf-8')
                checkpoint.replace(path)
                if checkpoint_commit:
                    checkpoint_commit()
                report['boardCache'] = sources.board()
                candidates(report['boardCache'], now)
            if not report.get('boardCache'):
                raise ValueError('Leaderboard unavailable; next FOMO attempt in 3 days')
            choices = candidates(report['boardCache'], now, REBALANCE)
            cache.update(sources.quotes(choices[:25], now))
            chosen = []
            for token in choices:
                try:
                    q = quote(token)
                    chosen.append({**token, 'priceSource': q['source']})
                except Exception:
                    continue
                if len(chosen) == 10:
                    break
            if len(chosen) != 10:
                raise ValueError('Fewer than 10 eligible liquid constituents')
            report['basket'] = chosen
            report['rebalancedAt'] = now
            report['snapshots'].append({'at': now, 'constituents': chosen})
            if report.get('previous'):
                report['previous']['prices'] = {t['id']: cache[t['id']]['price'] for t in chosen}
            else:
                advance(report, now, cache, alt)
                record_reading(report, now, cache, alt)
            report['quotes'] = {t['id']: cache[t['id']] for t in chosen}
        report['error'] = None
    except Exception as exc:
        # Never include request headers, credentials, or arbitrary provider bodies in public output.
        report['error'] = str(exc)[:120] if isinstance(exc, ValueError) else 'Market provider unavailable'
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(report, allow_nan=False), encoding='utf-8')
    temp.replace(path)
    return report


def public_report(report):
    return {k: report[k] for k in ('version', 'basket', 'samples', 'updatedAt', 'attemptedAt',
            'rebalancedAt', 'error', 'quotes', 'altProviderAt', 'altMethod', 'readings', 'readingAt') if k in report}


if __name__ == '__main__':
    import sys
    if sys.platform == 'win32':
        import truststore
        truststore.inject_into_ssl()
    result = collect(sys.argv[1])
    print(json.dumps({'updatedAt': result.get('updatedAt'), 'constituents': len(result['basket']), 'error': result.get('error')}))
