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
import subprocess
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse
from html import unescape

START = '2025-10-01'
NEWS = {'CoinDesk': 'https://www.coindesk.com/arc/outboundfeeds/rss/',
        'CNBC': 'https://www.cnbc.com/id/20910258/device/rss/rss.html'}
TOPICS = re.compile(r'\b(bitcoin|fed|federal reserve|inflation|cpi|interest rates?|treasury|yields?|iran|oil|etf)\b', re.I)

def headline_topic(title):
    if re.search(r'\b(sentenced|forfeits?|drug|dark web|hires|advisor|adviser)\b', title, re.I):
        return None
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
                value = {'date': date, 'close': close}
                try:
                    o, h, l = (float(row[k]) for k in ('open', 'high', 'low'))
                    if all(math.isfinite(v) and v > 0 for v in (o, h, l)) and l <= min(o, close) <= max(o, close) <= h:
                        value.update(open=o, high=h, low=l)
                except (KeyError, TypeError, ValueError):
                    pass
                found[date] = value
        except (ValueError, TypeError, KeyError):
            continue
    if not found or not any(date < START for date in found):
        raise ValueError('No valid history / October reference close')
    return [found[date] for date in sorted(found)]

def yahoo_rows(payload, today):
    value = payload['chart']['result'][0]
    quote = value['indicators']['quote'][0]
    return valid_rows([{'date': dt.datetime.fromtimestamp(t, dt.timezone.utc).date().isoformat(),
                        **{key: values[i] if i < len(values) else None for key, values in quote.items() if key in ('open','high','low','close')}}
                       for i, t in enumerate(value['timestamp'])], today)

def okx_rows(payload, kind, now):
    if payload.get('code') != '0':
        raise ValueError('Exchange rejected request')
    result = {}
    for row in payload['data']:
        try:
            timestamp = float(row[0] if kind in ('OI','SPOT','SPOT_PRICE') else row['fundingTime']) / 1000
            # OI uses UTC daily bucket observations; discard the current incomplete bucket.
            if timestamp > now or (kind in ('OI','SPOT','SPOT_PRICE') and timestamp + 86400 > now):
                continue
            value = {'timestamp': dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).isoformat(),
                     'date': dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).date().isoformat()}
            if kind == 'OI':
                value.update(btc=float(row[2]), usd=float(row[3]))
                if not all(math.isfinite(value[k]) and value[k] > 0 for k in ('btc','usd')):
                    continue
            elif kind == 'SPOT':
                value.update(sell=float(row[1]),buy=float(row[2]))
                if not all(math.isfinite(value[k]) and value[k]>=0 for k in ('sell','buy')) or value['sell']+value['buy']<=0:continue
            elif kind == 'SPOT_PRICE':
                value.update(open=float(row[1]),high=float(row[2]),low=float(row[3]),close=float(row[4]))
                if row[-1]!='1' or not all(math.isfinite(value[k]) and value[k]>0 for k in ('open','high','low','close')) or not value['low']<=min(value['open'],value['close'])<=max(value['open'],value['close'])<=value['high']:continue
            else:
                value['rate'] = float(row.get('realizedRate') or row['fundingRate'])
                if not math.isfinite(value['rate']) or abs(value['rate']) > 1:
                    continue
            result[timestamp] = value
        except (KeyError, ValueError, TypeError, IndexError):
            continue
    if not result:
        raise ValueError('No valid completed exchange observations')
    return [result[t] for t in sorted(result)]

def liquidation_rows(payload, now):
    if payload.get('code')!='0':raise ValueError('Exchange rejected request')
    result={}
    for group in payload['data']:
        if group.get('instId')!='BTC-USDT-SWAP':continue
        for row in group.get('details',[]):
            try:
                timestamp=float(row['ts'])/1000;size=float(row['sz']);side=row['posSide']
                if not 0<=now-timestamp<=7*86400 or side not in ('long','short') or not math.isfinite(size) or size<=0:continue
                stamp=dt.datetime.fromtimestamp(timestamp,dt.timezone.utc)
                value={'timestamp':stamp.isoformat(),'date':stamp.date().isoformat(),'contracts':size,'side':side}
                result[(timestamp,side,size)]=value
            except (KeyError,TypeError,ValueError):continue
    if not result:raise ValueError('No recent valid liquidation sample')
    return [result[key] for key in sorted(result)][-100:]

class FlowTable(HTMLParser):
    def __init__(self):
        super().__init__(); self.rows=[]; self.row=None; self.cell=None
    def handle_starttag(self, tag, attrs):
        if tag == 'tr': self.row=[]
        if tag in ('td','th') and self.row is not None: self.cell=[]
    def handle_data(self, data):
        if self.cell is not None: self.cell.append(data)
    def handle_endtag(self, tag):
        if tag in ('td','th') and self.cell is not None:
            self.row.append(''.join(self.cell).strip()); self.cell=None
        if tag == 'tr' and self.row is not None:
            self.rows.append(self.row); self.row=None

def etf_rows(text, today):
    parser=FlowTable(); parser.feed(text)
    totals=None; result={}
    for row in parser.rows:
        if row and row[0].lower() == 'date' and 'Total' in row:
            totals=row.index('Total'); continue
        if totals is None or len(row) <= totals:
            continue
        try:
            date=dt.datetime.strptime(row[0], '%d %b %Y').date().isoformat()
            # Missing constituent cells mean preliminary/incomplete, not zero.
            cells=row[1:totals+1]
            if date >= today or any(not cell or cell.strip() in ('-', '–', '—') for cell in cells):
                continue
            raw=row[totals].replace(',', '').replace('(', '-').replace(')', '')
            total=float(raw)
            parts=[float(cell.replace(',','').replace('(', '-').replace(')','')) for cell in cells[:-1]]
            if math.isfinite(total) and all(math.isfinite(n) for n in parts) and abs(sum(parts)-total) <= max(.2,.1*len(parts)):
                result[date]={'date':date,'millionUsd':total}
        except (ValueError, TypeError):
            continue
    if not result: raise ValueError('No complete dated ETF totals')
    return [result[d] for d in sorted(result)][-90:]

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

def fed_calendar(text, today):
    headings=list(re.finditer(r'(\d{4}) FOMC Meetings', text))
    result=[]
    for i,heading in enumerate(headings):
        section=text[heading.end():headings[i+1].start() if i+1<len(headings) else len(text)]
        for match in re.finditer(r'fomc-meeting__month[^>]*>\s*<strong>([A-Za-z]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<',section,re.S):
            try:
                month=dt.datetime.strptime(match[1],'%B').month
                days=re.fullmatch(r'\s*(\d{1,2})-(\d{1,2})\*?\s*',unescape(match[2]))
                if not days: continue
                date=dt.date(int(heading[1]),month,int(days[2])).isoformat()
                if today <= date and (dt.date.fromisoformat(date)-dt.date.fromisoformat(today)).days <= 120:
                    result.append({'date':date,'title':'FOMC scheduled decision / meeting end','sourceUrl':'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'})
            except ValueError:
                continue
    if not result: raise ValueError('No upcoming official FOMC dates parsed')
    return sorted(result,key=lambda r:r['date'])

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

def public_report(report):
    # Raw historical inputs remain on the Volume; the browser needs the saved
    # assessment, not 120 repeated copies of exchange and price histories.
    result={**report}
    result['history']=[{key:row[key] for key in ('date','observedAt','ruleVersion','assessment') if key in row}
                       if row.get('assessment') else row for row in report.get('history',[])]
    return result

class MacroReview:
    def __init__(self, fetch, seed_path, clock=time.time, store_path=None):
        self.fetch, self.clock = fetch, clock
        self.lock = asyncio.Lock()
        self.next_refresh = 0
        self.store_path = Path(store_path) if store_path else None
        self.analysis_path=Path(seed_path).parent / 'macro-analysis.mjs'
        seed = json.loads(Path(seed_path).read_text(encoding='utf-8-sig').strip().removeprefix('export default ').removesuffix(';'))
        self.report = {'version':2, 'analysisRuleVersion':4, 'start': START, 'series': seed['series'], 'drivers': {}, 'positioning': {}, 'calendar': [], 'history': [], 'news': [], 'feeds': {},
                       'collectedAt': seed['collectedAt'], 'seedAt': seed['collectedAt']}
        for symbol in ('QQQ', 'BTC', 'XAU'):
            self.report['feeds'][symbol] = {'status': 'seed', 'lastSuccessAt': seed['collectedAt'],
                                            'latestDate': seed['series'][symbol][-1]['date']}
        if self.store_path and self.store_path.exists():
            try:
                saved=json.loads(self.store_path.read_text(encoding='utf-8'))
                if saved.get('version') == 2 and all(saved['series'].get(s) for s in ('QQQ','BTC','XAU')):
                    self.report=saved
                    self.next_refresh=dt.datetime.fromisoformat(saved['nextRefreshAt']).timestamp() if saved.get('analysisRuleVersion')==4 else 0
            except (ValueError, KeyError, TypeError):
                pass

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
                        'FED': 'https://www.federalreserve.gov/feeds/press_monetary.xml',
                        'FEDCAL': 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
                        'OI': 'https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1Dutc&limit=100',
                        'FUNDING': 'https://www.okx.com/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=100',
                        'SPOT': 'https://www.okx.com/api/v5/rubik/stat/taker-volume?ccy=BTC&instType=SPOT&period=1D',
                        'SPOT_PRICE': 'https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=1Dutc&limit=35',
                        'LIQ': 'https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&instFamily=BTC-USDT&state=filled&limit=100',
                        'ETF': 'https://farside.co.uk/bitcoin-etf-flow-all-data/', **NEWS}
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
                    elif key in ('OI', 'FUNDING','SPOT','SPOT_PRICE'):
                        rows = okx_rows(response.json(), key, now)
                    elif key=='LIQ':
                        rows=liquidation_rows(response.json(),now)
                    elif key == 'ETF':
                        rows = etf_rows(response.text, today)
                    elif key == 'FEDCAL':
                        rows = fed_calendar(response.text,today)
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
                    elif key in ('OI', 'FUNDING', 'ETF','SPOT','SPOT_PRICE','LIQ'):
                        self.report['positioning'][key] = rows
                        status['latestDate'] = rows[-1]['date']
                    elif key == 'FEDCAL':
                        self.report['calendar']=rows
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
            self.report['analysisRuleVersion']=4
            common=sorted(set(r['date'] for r in self.report['series']['QQQ']) & set(r['date'] for r in self.report['series']['BTC']))
            if common and all(self.report['feeds'][s]['status']=='ok' for s in ('QQQ','BTC')) and (dt.date.fromisoformat(today)-dt.date.fromisoformat(common[-1])).days <= 4:
                entry={'date':self.report['series']['BTC'][-1]['date'], 'observedAt':attempted,
                       'series':{s:rows[-65:] for s,rows in self.report['series'].items()},
                       'drivers':{s:rows[-65:] for s,rows in self.report['drivers'].items()},
                       'positioning':copy.deepcopy(self.report['positioning']), 'feeds':copy.deepcopy(self.report['feeds'])}
                if self.analysis_path.exists():
                    program='import {assess} from '+json.dumps(self.analysis_path.resolve().as_uri())+';let s="";for await(const c of process.stdin)s+=c;const r=JSON.parse(s);process.stdout.write(JSON.stringify(assess(r,r.observedAt.slice(0,10))));'
                    value=subprocess.run(['node','--input-type=module','-e',program],input=json.dumps(entry),capture_output=True,text=True,timeout=8,check=True)
                    entry['assessment']=json.loads(value.stdout)
                    entry['ruleVersion']=4
                history={r['date']:r for r in self.report.get('history', [])}
                if not history or entry['date']>=max(history):
                    history[entry['date']]=entry
                self.report['history']=[history[d] for d in sorted(history)][-120:]
            if self.store_path:
                self.store_path.parent.mkdir(parents=True, exist_ok=True)
                temporary=self.store_path.with_suffix('.tmp')
                temporary.write_text(json.dumps(self.report, separators=(',',':')), encoding='utf-8')
                temporary.replace(self.store_path)
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
            return await MacroReview(client.get, root / 'dist/macro-data.mjs', store_path=destination).get()
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else root / '.data/macro-review.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(asyncio.run(collect())), encoding='utf-8')
    print('Local macro observation saved:', destination)
