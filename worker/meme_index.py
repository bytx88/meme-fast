"""Hourly market readings from the shared 1H trending pool; no token refetch."""
import json
import math
import time
from pathlib import Path

HOUR = 3_600_000
METHOD = 'shared-trending-1h-v1'
EXTREME_RETURN = 10_000  # Diagnostic only; reported returns are never clipped.

ALT_EXCLUDE = {'BTC', 'ETH', 'USDT', 'USDC', 'DAI', 'USDE', 'PYUSD', 'FDUSD', 'TUSD',
               'USDD', 'FRAX', 'USDS', 'USD1', 'RLUSD', 'WBTC', 'WETH', 'STETH',
               'WSTETH', 'BETH', 'PAXG', 'XAUT'}


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) and value > 0 else None
    except (TypeError, ValueError):
        return None


def alt_observation(rows, now):
    """One-hour cap-weighted return of 25 large alts from a bounded 50-row feed."""
    btc_change = None
    for row in rows:
        if str(row.get('id')) == '90' and row.get('symbol') == 'BTC':
            try:
                value = float(row['percent_change_1h'])
                if math.isfinite(value) and value > -100:
                    btc_change = value
            except (KeyError, TypeError, ValueError):
                pass
            break
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
            'providerAt': now, 'source': 'CoinLore top 25 alts', 'btcDelta': btc_change}


class Sources:
    def __init__(self, directory='/stream'):
        self.directory = directory

    def trending(self):
        from worker.data_stream import read
        return read(self.directory)

    def alt(self, now):
        import httpx
        with httpx.Client(timeout=12) as client:
            response = client.get('https://api.coinlore.net/api/tickers/', params={'start':0,'limit':50})
            response.raise_for_status()
            return alt_observation(response.json()['data'],now)


def collect(path, sources=None, now=None):
    now = int(time.time()*1000) if now is None else now
    sources = sources or Sources()
    path = Path(path)
    try:
        report = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        report = {'version':2,'basket':[],'readings':[]}
    if report.get('method') != METHOD:
        # Retain the original report privately; never splice FOMO returns into
        # the new meme comparison. Alt/BTC history remains comparable.
        legacy = {key:value for key,value in report.items() if key!='legacyMethods'}
        archives = dict(report.get('legacyMethods',{}))
        if legacy.get('readings') or legacy.get('basket'):
            archives[report.get('method','fomo-most-held-v1')] = legacy
        report = {'version':2,'method':METHOD,'basket':[],
                  'readings':[dict(row,method=row.get('method','fomo-most-held-v1')) for row in legacy.get('readings',[])],
                  'legacyMethods':archives}
    if report.get('updatedAt') and now//HOUR == report['updatedAt']//HOUR:
        write_json(path.with_suffix('.public.json'),public_report(report))
        return report
    report['attemptedAt'] = now
    try:
        stream = sources.trending()
        stamp = stream.get('marketAt') or stream.get('updatedAt') or 0
        if not 0 <= now-stamp < 15*60000:
            raise ValueError('Shared trending pool is stale or unavailable')
        rows = stream.get('windows',{}).get('1h',{}).get('tokens',[])
        if not rows:
            raise ValueError('Shared 1H trending pool is empty')
        seen,basket,changes = set(),[],[]
        for row in rows:
            key,at,change = row.get('id'),row.get('observedAt'),row.get('priceChange1h')
            if not key or key in seen:
                raise ValueError('Shared trending membership is invalid')
            seen.add(key)
            if (type(at) not in (int,float) or not 0 <= now-at < 15*60000
                    or type(change) not in (int,float) or not math.isfinite(change) or change < -100):
                raise ValueError('Shared 1H price changes are incomplete; reading withheld')
            changes.append(change)
            basket.append(dict(id=key,chain=row['network'],address=row['contract_address'],
                name=row.get('name'),symbol=row.get('symbol'),rank=row.get('rank'),
                weight=1/len(rows),source='shared-trending-1h',priceSource=row.get('marketSource'),
                observedAt=at,priceChange1h=change))
        try:
            average = math.fsum(change/len(changes) for change in changes)
        except OverflowError:
            scale = max(abs(change) for change in changes)
            average = scale*(math.fsum(change/scale for change in changes)/len(changes))
        alt = sources.alt(now)
        oldest = min(row['observedAt'] for row in basket)
        quality = dict(extremeReturnThreshold=EXTREME_RETURN,
                       extremeReturnCount=sum(abs(change)>EXTREME_RETURN for change in changes),
                       minimumReturn=min(changes),maximumReturn=max(changes))
        report['readings'].append(dict(at=now,meme=average,
            altDelta=alt['hourChange'],btcDelta=alt.get('btcDelta'),method=METHOD,
            constituents=len(basket),marketObservedAt=oldest,inputQuality=quality))
        report['readings'] = [row for row in report['readings'] if now-row['at'] <= 30*24*HOUR]
        report['basketHistory'] = [row for row in report.get('basketHistory',[])
                                  if 0 <= now-row['at'] <= 30*24*HOUR]
        report['basketHistory'].append(dict(at=now,marketAt=stamp,tokens=basket))
        report.update(basket=basket,updatedAt=now,readingAt=now,rebalancedAt=now,
            poolUpdatedAt=stamp,marketObservedAt=oldest,altProviderAt=alt['providerAt'],
            altMethod=alt['source'],inputQuality=quality,error=None)
    except Exception as exc:
        report['error'] = str(exc)[:120] if isinstance(exc,ValueError) else 'Market provider unavailable'
    path.parent.mkdir(parents=True,exist_ok=True)
    write_json(path,report)
    write_json(path.with_suffix('.public.json'),public_report(report))
    return report


def write_json(path, report):
    temp=path.with_suffix('.tmp')
    temp.write_text(json.dumps(report,allow_nan=False),encoding='utf-8')
    temp.replace(path)


def public_report(report):
    return {key:value for key,value in report.items() if key in (
        'version','method','basket','readings','updatedAt','attemptedAt','rebalancedAt',
        'readingAt','poolUpdatedAt','marketObservedAt','altProviderAt','altMethod','inputQuality','error')}


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('path')
    parser.add_argument('--stream',default='.data')
    args=parser.parse_args()
    report=collect(args.path,Sources(args.stream))
    print(json.dumps(public_report(report)))
