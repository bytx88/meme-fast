"""Bounded, cached BTC and gold models. No credentials or account access."""
import base64
import json
import math
import threading
import time
import urllib.request

RANGES = (1, 3, 7, 30)
SYMBOLS = ('BTCUSDT', 'XAUUSDT')
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
    # Bucket labels can round forward to the next interval boundary. Freshness
    # is anchored to the provider's capture time, not that rounded label.
    bucket_ms = min(10800000, max(900000, times[-1] - times[-2]))
    if not number(updated) or not -60000 <= now - updated <= 900000 or not -bucket_ms <= now - times[-1] <= max(3600000, bucket_ms * 1.5):
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
        if row is None:
            continue
        if not isinstance(row, list) or len(row) != 4 or not all(number(v) and v > 0 for v in row):
            raise ValueError('Invalid candles')
        o, h, l, c = row
        if not l <= min(o, c) <= max(o, c) <= h:
            raise ValueError('Invalid candle range')
    current_price = data.get('current_price')
    if current_price is not None and (not number(current_price) or current_price <= 0):
        raise ValueError('Invalid current price')
    if candles[-1] is None and current_price is None:
        raise ValueError('Latest price is unavailable')
    for key in ('profile_long', 'profile_short'):
        values = data.get(key, [])
        if len(values) != bins or any(not number(v) or v < 0 for v in values):
            raise ValueError('Invalid liquidation profile')
    edges = data.get('price_edges')
    if edges is not None and (len(edges) != bins + 1 or any(not number(v) or v <= 0 for v in edges) or
                              any(a >= b for a, b in zip(edges, edges[1:])) or edges[0] != low or edges[-1] != high):
        raise ValueError('Invalid price bucket edges')
    fields = ('times', 'nbins', 'matrix', 'ohlc', 'price_lo', 'price_hi', 'profile_long', 'profile_short', 'updated')
    return {**{key: data[key] for key in fields}, 'days': days,
            **({'price_edges': edges} if edges is not None else {}),
            **({'current_price': current_price} if current_price is not None else {}),
            'coverageDays': round((times[-1] - times[0]) / 86400000, 2),
            'exchanges': [v for v in data.get('exchanges', []) if v in ('binance', 'bybit', 'okx', 'gate', 'hyperliquid')],
            'source': 'Edge or Not', 'sourceUrl': 'https://edgeornot.com/api', 'estimated': True}


def normalize_gold(data, days):
    if data.get('coin') != 'XAU' or data.get('error') or data.get('price_stale'):
        raise ValueError('Gold model is unavailable')
    cols, rows = data.get('cols'), data.get('rows')
    if not isinstance(cols, int) or not isinstance(rows, int) or not 2 <= cols <= 3000 or not 2 <= rows <= 500:
        raise ValueError('Invalid gold dimensions')
    raw = base64.b64decode(data['cells'], validate=True)
    if len(raw) != cols * rows:
        raise ValueError('Invalid gold cell encoding')
    y0, ratio, cap = data['y0'], data['ratio'], data['cap']
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (y0, ratio, cap)) or not (y0 > 0 and 1 < ratio < 1.1 and cap > 0):
        raise ValueError('Invalid gold scale')
    # Provider's public renderer decodes column-major, square-root quantized USD.
    matrix = [[cap * (raw[c * rows + r] / 255) ** 2 for r in range(rows)] for c in range(cols)]
    edges = [y0 * ratio ** r for r in range(rows + 1)]
    candles = data['candles']
    if any(len(candles[k]) != cols for k in ('o', 'h', 'l', 'c')):
        raise ValueError('Invalid gold candles')
    ohlc = [[candles[k][c] for k in ('o', 'h', 'l', 'c')] for c in range(cols)]
    ohlc = [None if any(v is None for v in row) else row for row in ohlc]
    current = data['price']
    if not isinstance(current, (int, float)) or not math.isfinite(current) or current <= 0:
        raise ValueError('Latest gold price missing')
    if not -60000 <= time.time() * 1000 - data['price_as_of'] <= 3600000:
        raise ValueError('Gold price is stale')
    # The source clears crossed model cells; classify its latest cells by price.
    longs = [v if math.sqrt(edges[r] * edges[r+1]) < current else 0 for r, v in enumerate(matrix[-1])]
    shorts = [v if math.sqrt(edges[r] * edges[r+1]) >= current else 0 for r, v in enumerate(matrix[-1])]
    report = validate(dict(times=[data['t0'] + c * data['dt'] for c in range(cols)], nbins=rows,
                           matrix=matrix, ohlc=ohlc, price_lo=edges[0], price_hi=edges[-1], price_edges=edges,
                           profile_long=longs, profile_short=shorts, updated=data['as_of'], current_price=current), days)
    return {**report, 'source': 'Swolecharts', 'sourceUrl': 'https://swolecharts.com/liquidation-heatmap/XAU',
            'modelVersion': data.get('version'), 'scope': 'Aggregated XAU gold perpetual model in USD; not a single exchange XAUUSDT pair. Side bars use latest model cells split above/below price. Values are quantized estimates.',
            'licenseLabel': 'Provider terms', 'licenseUrl': 'https://swolecharts.com/developers#terms'}


def load(days=30, symbol='BTCUSDT'):
    if days not in RANGES:
        raise ValueError('Unsupported range')
    if symbol not in SYMBOLS:
        raise ValueError('Unsupported symbol')
    key = (symbol, days)
    with _lock:
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < 120:
            return cached[1]
        gold_range = '24h' if days == 1 else f'{days}d'
        url = (f'https://swolecharts.com/api/liquidation-heatmap/xau?range={gold_range}' if symbol == 'XAUUSDT' else
               f'https://edgeornot.com/api/liqmap/btc?days={days}&ex=all')
        request = urllib.request.Request(url,
            headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read(12000001)
        if len(raw) > 12000000:
            raise ValueError('Heatmap response exceeds limit')
        payload = json.loads(raw)
        result = normalize_gold(payload, days) if symbol == 'XAUUSDT' else {
            **validate(payload, days), 'scope': 'Aggregated BTC perpetual model; venue coverage shown above.',
            'licenseLabel': 'CC BY 4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/'}
        result['symbol'] = symbol
        _cache[key] = (time.monotonic(), result)
        return result


if __name__ == '__main__':
    import sys
    if sys.platform == 'win32':
        import truststore
        truststore.inject_into_ssl()
    print(json.dumps(load(int(sys.argv[1]) if len(sys.argv) > 1 else 30, sys.argv[2] if len(sys.argv) > 2 else 'BTCUSDT')))
