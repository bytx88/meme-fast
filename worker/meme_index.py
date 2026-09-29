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
PLATFORMS = {'solana': 'solana', 'bsc': 'binance-smart-chain', 'eth': 'ethereum', 'base': 'base'}


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) and value > 0 else None
    except (TypeError, ValueError):
        return None


def identity(chain, address):
    return chain + ':' + (address if chain == 'solana' else address.lower())


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
        self.last_gt = 0

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

    def quote(self, token, now):
        chain, address = token['chain'], token['address']
        quotes = []
        try:
            if token.get('priceSource') == 'DexScreener':
                raise ValueError('Use the basket-selected DexScreener source')
            time.sleep(max(0, 2.1 - (time.monotonic() - self.last_gt)))
            self.last_gt = time.monotonic()
            pools = self.get(f'https://api.geckoterminal.com/api/v2/networks/{chain}/tokens/{address}/pools')['data']
            for pool in pools:
                a, rel = pool['attributes'], pool['relationships']
                for side in ('base', 'quote'):
                    pool_token = rel[side + '_token']['data']['id'].split('_', 1)[1]
                    if identity(chain, pool_token) != token['id']:
                        continue
                    price, liquidity = number(a.get(side + '_token_price_usd')), number(a.get('reserve_in_usd'))
                    if price and liquidity and liquidity >= 10_000 and number(a.get('volume_usd', {}).get('h24')):
                        quotes.append({'price': price, 'liquidity': liquidity, 'source': 'GeckoTerminal', 'at': now})
        except (ValueError, KeyError, TypeError):
            pass
        except Exception:
            pass
        if not quotes:
            try:
                pairs = self.get(f'https://api.dexscreener.com/latest/dex/tokens/{address}').get('pairs') or []
                for p in pairs:
                    if p.get('chainId') != {'eth': 'ethereum'}.get(chain, chain) or identity(chain, p.get('baseToken', {}).get('address', '')) != token['id']:
                        continue
                    price, liquidity = number(p.get('priceUsd')), number(p.get('liquidity', {}).get('usd'))
                    if price and liquidity and liquidity >= 10_000 and number(p.get('volume', {}).get('h24')):
                        quotes.append({'price': price, 'liquidity': liquidity, 'source': 'DexScreener', 'at': now})
            except Exception:
                pass
        if not quotes:
            raise ValueError('Liquid exact-contract price unavailable')
        quote = max(quotes, key=lambda q: q['liquidity'])
        # Persist the selected provider for this basket period to avoid source switching.
        platform = PLATFORMS.get(chain)
        if platform and token.get('priceSource') in (None, 'CoinGecko'):
            try:
                data = self.get(f'https://api.coingecko.com/api/v3/simple/token_price/{platform}', params={
                    'contract_addresses': address, 'vs_currencies': 'usd', 'include_last_updated_at': 'true'})
                p = data.get(address) or data.get(address.lower()) or {}
                stamp = (number(p.get('last_updated_at')) or 0) * 1000
                if number(p.get('usd')) and 0 <= now - stamp <= 15 * 60_000:
                    quote = {**quote, 'price': float(p['usd']), 'source': 'CoinGecko', 'providerAt': stamp}
            except Exception:
                pass
        if token.get('priceSource') and quote['source'] != token['priceSource']:
            raise ValueError('Basket price provider unavailable')
        return quote

    def alt(self, now):
        data = self.get('https://api.coingecko.com/api/v3/global')['data']
        stamp = float(data['updated_at']) * 1000
        total = number(data['total_market_cap']['usd'])
        shares = data['market_cap_percentage']
        btc, eth = float(shares['btc']), float(shares['eth'])
        if not total or not 0 <= now - stamp <= 15 * 60_000 or not (0 < btc + eth < 100):
            raise ValueError('Fresh broad-alt market cap unavailable')
        return {'value': total * (1 - (btc + eth) / 100), 'providerAt': stamp}


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
            cache[token['id']] = sources.quote(token, now)
        return cache[token['id']]
    try:
        alt = sources.alt(now)
        if report['basket']:
            for token in report['basket']:
                quote(token)
            advance(report, now, cache, alt)
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
            'rebalancedAt', 'error', 'quotes', 'altProviderAt') if k in report}


if __name__ == '__main__':
    import sys
    if sys.platform == 'win32':
        import truststore
        truststore.inject_into_ssl()
    result = collect(sys.argv[1])
    print(json.dumps({'updatedAt': result.get('updatedAt'), 'constituents': len(result['basket']), 'error': result.get('error')}))
