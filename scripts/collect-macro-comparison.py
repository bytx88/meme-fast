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
import httpx
import truststore

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gold-csv', type=Path)
    args = parser.parse_args()
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    start = '2025-11-01'
    earliest = '2025-10-01'
    series = {}
    with httpx.Client(verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT),
                      headers={'User-Agent': 'Mozilla/5.0'}, timeout=45, follow_redirects=True) as client:
        for symbol, ticker in [('QQQ', 'QQQ'), ('BTC', 'BTC-USD')]:
            response = client.get(f'https://query2.finance.yahoo.com/v8/finance/chart/{ticker}',
                                  params={'range': '2y', 'interval': '1d'})
            response.raise_for_status()
            result = response.json()['chart']['result'][0]
            series[symbol] = [{'date': dt.datetime.fromtimestamp(t, dt.timezone.utc).date().isoformat(), 'close': close}
                              for t, close in zip(result['timestamp'], result['indicators']['quote'][0]['close'])
                              if close and earliest <= dt.datetime.fromtimestamp(t, dt.timezone.utc).date().isoformat() < today]
        if args.gold_csv:
            gold_csv = args.gold_csv.read_text(encoding='utf-8')
        else:
            response = client.get('https://goldprice.com/gold-price-history.csv')
            response.raise_for_status()
            gold_csv = response.text
        gold = list(csv.DictReader(io.StringIO(gold_csv)))
        if not gold or 'close_usd_per_troy_oz' not in gold[0]:
            raise ValueError('Unexpected GoldPrice.com CSV schema')
        series['XAU'] = [{'date': row['date'], 'close': float(row['close_usd_per_troy_oz'])}
                         for row in gold if row.get('close_usd_per_troy_oz') and earliest <= row['date'] < today]
    for symbol, rows in series.items():
        if not rows or not any(row['date'] < start for row in rows):
            raise ValueError(f'{symbol}: missing prices / November baseline')
    payload = {'collectedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'start': start, 'series': series}
    (ROOT / 'dist/macro-data.mjs').write_text('export default '+json.dumps(payload, separators=(',', ':'))+';\n', encoding='utf-8')
    print('Snapshot saved:', {s: rows[-1]['date'] for s, rows in series.items()})

if __name__ == '__main__':
    main()
