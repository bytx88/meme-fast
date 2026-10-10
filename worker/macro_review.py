"""On-visit macro observations; bounded public feeds with explicit partial failures."""
import asyncio
import csv
import copy
import datetime as dt
import io
import json
import math
import re
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse
from html import unescape

START = '2025-11-01'
NEWS = {'CoinDesk': 'https://www.coindesk.com/arc/outboundfeeds/rss/',
        'CNBC': 'https://www.cnbc.com/id/20910258/device/rss/rss.html'}
TOPICS = re.compile(r'\b(bitcoin|fed|federal reserve|inflation|cpi|interest rates?|treasury|yields?|iran|oil|etf)\b', re.I)

def headline_topic(title):
    if re.search(r'\b(iran|oil|brent|war)\b', title, re.I):
        return 'Energy / geopolitics'
    if re.search(r'\b(fed|federal reserve|inflation|cpi|interest rates?|treasury|yields?)\b', title, re.I):
        return 'Rates / inflation'
    if re.search(r'\b(etfs?|inflows?|outflows?|institutional)\b', title, re.I):
        return 'Capital demand'
    if re.search(r'\bbitcoin\b', title, re.I) and re.search(r'\b(volatility|swings?|gains?|bears?|bulls?|liquidation|price|prices|rally|crash|steadies|drops?|falls?|rises?|markets?)\b', title, re.I):
        return 'Price / positioning'
    return None

def valid_rows(rows, today):
    found = {}
    for row in rows:
        try:
            date = dt.date.fromisoformat(row['date']).isoformat()
            close = float(row['close'])
            if '2025-09-01' <= date < today and math.isfinite(close) and close > 0:
                found[date] = {'date': date, 'close': close}
        except (ValueError, TypeError, KeyError):
            continue
    if not found or not any(date < START for date in found):
        raise ValueError('No valid history / November reference close')
    return [found[date] for date in sorted(found)]

def yahoo_rows(payload, today):
    value = payload['chart']['result'][0]
    return valid_rows([{'date': dt.datetime.fromtimestamp(t, dt.timezone.utc).date().isoformat(), 'close': close}
                       for t, close in zip(value['timestamp'], value['indicators']['quote'][0]['close'])], today)

def gold_rows(text, today):
    return valid_rows([{'date': row['date'], 'close': row.get('close_usd_per_troy_oz')}
                       for row in csv.DictReader(io.StringIO(text))], today)

def fed_statement(text, url):
    text = re.sub(r'<[^>]+>', ' ', unescape(text))
    for before, after in [('¾', '-3/4'), ('½', '-1/2'), ('¼', '-1/4'), ('‑', '-'), ('–', '-')]:
        text = text.replace(before, after)
    text = re.sub(r'\s+', ' ', text)
    match = re.search(r'target range for the federal funds rate(?: by \d+(?:/\d+|\.\d+)? percentage points?)? (?:at|to)\s+(\d+(?:-\d+/\d+|\.\d+)?)\s+to\s+(\d+(?:-\d+/\d+|\.\d+)?)\s+percent', text, re.I)
    if not match:
        raise ValueError('Fed target range not found in statement')
    def rate(value):
        if '-' in value:
            whole, fraction = value.split('-')
            numerator, denominator = fraction.split('/')
            return float(whole)+float(numerator)/float(denominator)
        return float(value)
    date = re.search(r'monetary(\d{4})(\d{2})(\d{2})a.htm$', url)
    if not date:
        raise ValueError('Unexpected Fed statement URL')
    low, high = rate(match[1]), rate(match[2])
    if not 0 <= low <= high <= 100:
        raise ValueError('Invalid Fed target range')
    return {'date': '-'.join(date.groups()), 'low': low, 'high': high, 'sourceUrl': url}

def fed_statement_urls(text):
    root = ET.fromstring(text.lstrip('\ufeff'))
    result = []
    for item in root.findall('./channel/item'):
        title = item.findtext('title') or ''
        url = item.findtext('link') or ''
        if 'issues FOMC statement' in title and re.fullmatch(r'https://www\.federalreserve\.gov/newsevents/pressreleases/monetary\d{8}a.htm', url):
            result.append(url)
    if not result:
        raise ValueError('No current FOMC statements in official feed')
    return sorted(set(result), reverse=True)[:3]

def news_rows(text, source, now):
    result = []
    root = ET.fromstring(text)
    if root.tag != 'rss' or root.find('channel') is None:
        raise ValueError('Unexpected RSS format')
    for item in root.findall('./channel/item'):
        title = re.sub(r'\s+', ' ', item.findtext('title') or '').strip()[:240]
        url = (item.findtext('link') or '').strip()
        try:
            published = parsedate_to_datetime(item.findtext('pubDate') or '').timestamp()
        except (TypeError, ValueError, OverflowError):
            continue
        host = (urlparse(url).hostname or '').lower()
        domain = 'coindesk.com' if source == 'CoinDesk' else 'cnbc.com'
        if (urlparse(url).scheme != 'https' or not (host == domain or host.endswith('.'+domain))
                or not 0 <= now-published <= 7*86400 or not TOPICS.search(title) or not headline_topic(title)):
            continue
        result.append({'title': title, 'url': url, 'source': source, 'topic': headline_topic(title),
                       'publishedAt': dt.datetime.fromtimestamp(published, dt.timezone.utc).isoformat()})
    return sorted(result, key=lambda r: r['publishedAt'], reverse=True)[:8]

class MacroReview:
    def __init__(self, fetch, seed_path, clock=time.time):
        self.fetch, self.clock = fetch, clock
        self.lock = asyncio.Lock()
        self.next_refresh = 0
        seed = json.loads(Path(seed_path).read_text(encoding='utf-8-sig').strip().removeprefix('export default ').removesuffix(';'))
        self.report = {'start': START, 'series': seed['series'], 'drivers': {}, 'news': [], 'feeds': {},
                       'collectedAt': seed['collectedAt'], 'seedAt': seed['collectedAt']}
        for symbol in ('QQQ', 'BTC', 'XAU'):
            self.report['feeds'][symbol] = {'status': 'seed', 'lastSuccessAt': seed['collectedAt'],
                                            'latestDate': seed['series'][symbol][-1]['date']}

    async def get(self):
        async with self.lock:
            now = self.clock()
            if now < self.next_refresh:
                return copy.deepcopy(self.report)
            today = dt.datetime.fromtimestamp(now, dt.timezone.utc).date().isoformat()
            attempted = dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat()
            requests = {'QQQ': 'https://query2.finance.yahoo.com/v8/finance/chart/QQQ?period1=1756684800&interval=1d',
                        'BTC': 'https://query2.finance.yahoo.com/v8/finance/chart/BTC-USD?period1=1756684800&interval=1d',
                        'XAU': 'https://goldprice.com/gold-price-history.csv',
                        'YIELD': 'https://query2.finance.yahoo.com/v8/finance/chart/%5ETNX?period1=1756684800&interval=1d',
                        'BRENT': 'https://query2.finance.yahoo.com/v8/finance/chart/BZ%3DF?period1=1756684800&interval=1d',
                        'FED': 'https://www.federalreserve.gov/feeds/press_monetary.xml', **NEWS}
            for key in ('QQQ', 'BTC', 'YIELD', 'BRENT'):
                requests[key] += f'&period2={int(now)}'
            async def one(key, url):
                try:
                    response = await asyncio.wait_for(self.fetch(url), timeout=20)
                    response.raise_for_status()
                    if key in ('QQQ', 'BTC', 'YIELD', 'BRENT'):
                        rows = yahoo_rows(response.json(), today)
                    elif key == 'XAU':
                        rows = gold_rows(response.text, today)
                    elif key == 'FED':
                        async def statement(target):
                            value = await asyncio.wait_for(self.fetch(target), timeout=12)
                            value.raise_for_status()
                            return fed_statement(value.text, target)
                        urls = fed_statement_urls(response.text)
                        values = await asyncio.gather(*(statement(target) for target in urls), return_exceptions=True)
                        if isinstance(values[0], Exception):
                            raise ValueError('Newest Fed statement unavailable')
                        rows = sorted([row for row in values if not isinstance(row, Exception) and row['date'] <= today], key=lambda r: r['date'])
                        if not rows:
                            raise ValueError('No dated policy statements')
                    else:
                        rows = news_rows(response.text, key, now)
                    return key, rows, None
                except Exception:
                    return key, None, 'Source unavailable; previous observation retained'
            results = await asyncio.gather(*(one(key, url) for key, url in requests.items()))
            for key, rows, error in results:
                old = self.report['feeds'].get(key, {})
                status = {**old, 'attemptedAt': attempted, 'status': 'error' if error else 'ok', 'error': error}
                if error is None:
                    status['lastSuccessAt'] = attempted
                    if key in ('QQQ', 'BTC', 'XAU'):
                        self.report['series'][key] = rows
                        status['latestDate'] = rows[-1]['date']
                    elif key in ('YIELD', 'BRENT', 'FED'):
                        self.report['drivers'][key] = rows
                        status['latestDate'] = rows[-1]['date']
                    else:
                        self.report['news'] = [r for r in self.report['news'] if r['source'] != key] + rows
                self.report['feeds'][key] = status
            self.report['news'] = sorted([r for r in self.report['news'] if
                                         0 <= now-dt.datetime.fromisoformat(r['publishedAt']).timestamp() <= 7*86400],
                                        key=lambda r: r['publishedAt'], reverse=True)
            self.report['attemptedAt'] = attempted
            self.report['collectedAt'] = attempted
            self.next_refresh = now + 1800
            self.report['nextRefreshAt'] = dt.datetime.fromtimestamp(self.next_refresh, dt.timezone.utc).isoformat()
            return copy.deepcopy(self.report)

if __name__ == '__main__':
    import sys
    import httpx
    import ssl
    import truststore
    root = Path(__file__).resolve().parents[1]
    async def collect():
        async with httpx.AsyncClient(verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT), timeout=18,
                                     follow_redirects=True, headers={'User-Agent':'Mozilla/5.0'}) as client:
            return await MacroReview(client.get, root / 'dist/macro-data.mjs').get()
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else root / '.data/macro-review.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(asyncio.run(collect())), encoding='utf-8')
    print('Local macro observation saved:', destination)
