"""Bounded, daily adjusted-close sector research; no key or local data upload."""
import asyncio
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import time
from zoneinfo import ZoneInfo

SECTORS = {
    'XLC': ('Communication services', ['GOOGL', 'META', 'NFLX']),
    'XLY': ('Consumer discretionary', ['AMZN', 'TSLA', 'HD']),
    'XLP': ('Consumer staples', ['WMT', 'COST', 'PG']),
    'XLE': ('Energy', ['XOM', 'CVX', 'COP']),
    'XLF': ('Financials', ['JPM', 'BAC', 'GS']),
    'XLV': ('Health care', ['LLY', 'JNJ', 'ABBV']),
    'XLI': ('Industrials', ['CAT', 'GE', 'RTX']),
    'XLB': ('Materials', ['LIN', 'SHW', 'FCX']),
    'XLRE': ('Real estate', ['PLD', 'AMT', 'EQIX']),
    'XLK': ('Technology', ['NVDA', 'MSFT', 'AAPL']),
    'XLU': ('Utilities', ['NEE', 'SO', 'DUK']),
}
EXTRA_ETFS = ('GLD', 'COPX')


def parse_chart(payload, now, minimum=80):
    chart = payload['chart']['result'][0]
    timestamps = chart['timestamp']
    prices = chart['indicators']['adjclose'][0]['adjclose']
    ny = ZoneInfo('America/New_York')
    today = datetime.fromtimestamp(now, ny).date()
    end = chart['meta'].get('currentTradingPeriod', {}).get('regular', {}).get('end', now + 1)
    rows = []
    for stamp, price in zip(timestamps, prices):
        day = datetime.fromtimestamp(stamp, ny).date()
        # Yahoo may append a live daily candle. Never mix it with completed closes.
        if day > today or (day == today and now < end + 900):
            continue
        if isinstance(price, (int, float)) and math.isfinite(price) and price > 0:
            rows.append({'date': day.isoformat(), 'close': price})
    rows = sorted({r['date']: r for r in rows}.values(), key=lambda r: r['date'])
    if len(rows) < minimum:
        raise ValueError('Insufficient adjusted history')
    return rows


async def report(directory, sector='', now=None):
    import httpx
    if sector and sector not in SECTORS:
        raise ValueError('Unknown sector')
    now = time.time() if now is None else now
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    file = root / ((sector or 'sectors') + '.json')
    try:
        cached = json.loads(file.read_text())
    except (OSError, ValueError):
        cached = {}
    if now < cached.get('retryAt', 0) and (sector or cached.get('extraEtfsChecked')):
        return cached
    required = SECTORS[sector][1] if sector else ['SPY', *SECTORS]
    symbols = required if sector else [*required, *EXTRA_ETFS]
    semaphore = asyncio.Semaphore(3)
    async with httpx.AsyncClient(timeout=18, headers={'User-Agent': 'Mozilla/5.0'}) as client:
        async def fetch(symbol):
            async with semaphore:
                reply = await client.get(f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}', params={'range': '2y', 'interval': '1d'})
                reply.raise_for_status()
                return symbol, parse_chart(reply.json(), now, minimum=1 if symbol in EXTRA_ETFS else 80)
        results = await asyncio.gather(*(fetch(symbol) for symbol in symbols), return_exceptions=True)
    good = {r[0]: r[1] for r in results if not isinstance(r, Exception)}
    complete = all(symbol in good for symbol in required)
    if complete:
        result = {'series': good, 'fetchedAt': datetime.fromtimestamp(now, timezone.utc).isoformat(),
                  'status': 'daily', 'retryAt': now + 1800}
    else:
        # Keep one coherent last-good snapshot; never silently mix source dates.
        result = {**cached, 'status': 'delayed', 'retryAt': now + 1800,
                  'message': 'Provider unavailable. Retry in 30 minutes; any displayed data is the last complete snapshot.'}
        if now - (cached.get('savedAt') or 0) > 7 * 86400:
            result.pop('series', None)
    result['savedAt'] = now if complete else cached.get('savedAt', 0)
    if not sector:
        result['extraEtfsChecked'] = True
    temp = file.with_suffix('.tmp')
    temp.write_text(json.dumps(result), encoding='utf-8')
    temp.replace(file)
    return result


if __name__ == '__main__':
    import sys
    if sys.platform == 'win32':
        import truststore
        truststore.inject_into_ssl()
    print(json.dumps(asyncio.run(report(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ''))))
