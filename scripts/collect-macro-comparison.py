"""Refresh the dated macro comparison snapshot from public closing-price feeds.

Use --gold-csv FILE if GoldPrice.com cannot be reached from the local network.
The supplied file must be its gold-price-history.csv, never a futures proxy.
"""
import argparse
import csv
import datetime as dt
import io
import json
from pathlib import Path
import ssl
import sys
import httpx
import truststore

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from worker.macro_review import yahoo_rows, gold_rows, START

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gold-csv', type=Path)
    args = parser.parse_args()
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    start = START
    earliest = '2025-09-01'
    series = {}
    with httpx.Client(verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT),
                      headers={'User-Agent': 'Mozilla/5.0'}, timeout=45, follow_redirects=True) as client:
        for symbol, ticker in [('QQQ', 'QQQ'), ('BTC', 'BTC-USD')]:
            response = client.get(f'https://query2.finance.yahoo.com/v8/finance/chart/{ticker}',
                                  params={'range': '2y', 'interval': '1d'})
            response.raise_for_status()
            series[symbol] = yahoo_rows(response.json(),today)
        if args.gold_csv:
            gold_csv = args.gold_csv.read_text(encoding='utf-8')
        else:
            response = client.get('https://goldprice.com/gold-price-history.csv')
            response.raise_for_status()
            gold_csv = response.text
        series['XAU'] = gold_rows(gold_csv,today)
    for symbol, rows in series.items():
        if not rows or not any(row['date'] < start for row in rows):
            raise ValueError(f'{symbol}: missing prices / October baseline')
    payload = {'collectedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'start': start, 'series': series}
    (ROOT / 'dist/macro-data.mjs').write_text('export default '+json.dumps(payload, separators=(',', ':'))+';\n', encoding='utf-8')
    print('Snapshot saved:', {s: rows[-1]['date'] for s, rows in series.items()})

if __name__ == '__main__':
    main()
