"""Bounded, cached BTC model feed. No credentials or trading-account access."""
import json
import math
import threading
import time
import urllib.request

RANGES = (1, 3, 7, 30)
_cache = {}
_lock = threading.Lock()


def validate(data, days, now=None):
    now = time.time() * 1000 if now is None else now
    def number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    times = data.get('times', [])
    bins = data.get('nbins')
    if not isinstance(bins, int) or not 2 <= bins <= 500 or not 2 <= len(times) <= 3000:
        raise ValueError('Invalid heatmap dimensions')
    if not all(number(t) for t in times) or any(a >= b for a, b in zip(times, times[1:])):
        raise ValueError('Invalid heatmap timeline')
    updated = data.get('updated')
    if not number(updated) or not -60000 <= now - updated <= 900000 or not -60000 <= now - times[-1] <= 3600000:
        raise ValueError('Heatmap observations are stale')
    low, high = data.get('price_lo'), data.get('price_hi')
    if not number(low) or not number(high) or not 0 < low < high:
        raise ValueError('Invalid price bounds')
    matrix, candles = data.get('matrix', []), data.get('ohlc', [])
    if len(matrix) != len(times) or len(candles) != len(times):
        raise ValueError('Mismatched heatmap timeline')
    if any(not isinstance(row, list) or len(row) != bins or any(not number(v) or v < 0 for v in row) for row in matrix):
        raise ValueError('Invalid heatmap cells')
    for row in candles:
        if not isinstance(row, list) or len(row) != 4 or not all(number(v) and v > 0 for v in row):
            raise ValueError('Invalid candles')
        o, h, l, c = row
        if not l <= min(o, c) <= max(o, c) <= h:
            raise ValueError('Invalid candle range')
    for key in ('profile_long', 'profile_short'):
        values = data.get(key, [])
        if len(values) != bins or any(not number(v) or v < 0 for v in values):
            raise ValueError('Invalid liquidation profile')
    fields = ('times', 'nbins', 'matrix', 'ohlc', 'price_lo', 'price_hi', 'profile_long', 'profile_short', 'updated')
    return {**{key: data[key] for key in fields}, 'days': days,
            'coverageDays': round((times[-1] - times[0]) / 86400000, 2),
            'exchanges': [v for v in data.get('exchanges', []) if v in ('binance', 'bybit', 'okx', 'gate', 'hyperliquid')],
            'source': 'Edge or Not', 'sourceUrl': 'https://edgeornot.com/api', 'estimated': True}


def load(days=30):
    if days not in RANGES:
        raise ValueError('Unsupported range')
    with _lock:
        cached = _cache.get(days)
        if cached and time.monotonic() - cached[0] < 120:
            return cached[1]
        request = urllib.request.Request(
            f'https://edgeornot.com/api/liqmap/btc?days={days}&ex=all',
            headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read(12000001)
        if len(raw) > 12000000:
            raise ValueError('Heatmap response exceeds limit')
        result = validate(json.loads(raw), days)
        _cache[days] = (time.monotonic(), result)
        return result


if __name__ == '__main__':
    import sys
    if sys.platform == 'win32':
        import truststore
        truststore.inject_into_ssl()
    print(json.dumps(load(int(sys.argv[1]) if len(sys.argv) > 1 else 30)))
