"""Daily sector and cross-asset comparisons using public market data."""
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
EXTRA_ASSETS = ('GLD', 'COPX', 'SOXX', 'IWM', 'SPCX', 'BTCUSDT')
STOCK_UNIVERSE_VERSION = 2
NEW_YORK = ZoneInfo('America/New_York')
BINANCE_KLINES = 'https://data-api.binance.vision/api/v3/klines'


def parse_chart(payload, now, minimum=80, symbol=''):
    chart = payload['chart']['result'][0]
    if symbol == 'SPCX' and chart['meta'].get('instrumentType') != 'EQUITY':
        raise ValueError('Expected the SpaceX equity listing')
    timestamps = chart['timestamp']
    prices = chart['indicators']['adjclose'][0]['adjclose']
    today = datetime.fromtimestamp(now, NEW_YORK).date().isoformat()
    end = chart['meta'].get('currentTradingPeriod', {}).get('regular', {}).get('end', now + 1)
    rows = []
    for stamp, price in zip(timestamps, prices):
        day = datetime.fromtimestamp(stamp, NEW_YORK).date().isoformat()
        # Yahoo may append a live daily candle. Never mix it with completed closes.
        if day > today or (day == today and now < end + 900):
            continue
        if symbol == 'SPCX' and day < '2026-06-12':
            continue  # The ticker previously belonged to a different security.
        if isinstance(price, (int, float)) and math.isfinite(price) and price > 0:
            rows.append({'date': day, 'close': price})
    rows = sorted({r['date']: r for r in rows}.values(), key=lambda r: r['date'])
    if len(rows) < minimum:
        raise ValueError('Insufficient adjusted history')
    return rows


def parse_btc_closes(candles, now):
    closes = {}
    for row in candles:
        # Binance's close time is inclusive. The next millisecond is the session boundary.
        boundary = (row[6] + 1) / 1000
        local = datetime.fromtimestamp(boundary, NEW_YORK)
        if boundary > now or (local.hour, local.minute, local.second) != (16, 0, 0):
            continue
        close = float(row[4])
        if math.isfinite(close) and close > 0:
            closes[local.date().isoformat()] = close
    if not closes:
        raise ValueError('No completed BTCUSDT closes')
    return [{'date': day, 'close': closes[day]} for day in sorted(closes)]


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
    if now < cached.get('retryAt', 0) and (sector or cached.get('universeVersion') == STOCK_UNIVERSE_VERSION):
        return cached
    required = SECTORS[sector][1] if sector else ['SPY', *SECTORS]
    symbols = required if sector else [*required, *EXTRA_ASSETS]
    semaphore = asyncio.Semaphore(5)
    async with httpx.AsyncClient(headers={'User-Agent': 'Mozilla/5.0'}) as client:
        async def get_json(url, params):
            async with semaphore, asyncio.timeout(18):
                reply = await client.get(url, params=params, timeout=18)
                reply.raise_for_status()
                return reply.json()

        async def fetch(symbol):
            if symbol == 'BTCUSDT':
                # UTC+3 and UTC+4 daily boundaries cover 4 p.m. New York in both seasons.
                winter, summer = await asyncio.gather(*(get_json(BINANCE_KLINES, {
                    'symbol': symbol, 'interval': '1d', 'timeZone': offset, 'limit': 750,
                }) for offset in ('3', '4')))
                return symbol, parse_btc_closes(winter + summer, now)
            payload = await get_json(f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}',
                                     {'range': '2y', 'interval': '1d'})
            return symbol, parse_chart(payload, now, minimum=1 if symbol == 'SPCX' else 80, symbol=symbol)
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
        result['universeVersion'] = STOCK_UNIVERSE_VERSION
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
