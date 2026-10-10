import asyncio
import copy
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from worker.etf_flows import FUNDS, TFTC_URL, tftc_rows
from worker.macro_review import MacroReview


def dataset():
    parts = dict.fromkeys(FUNDS, 0)
    parts.update(IBIT=22380000, FBTC=-3580502.45, HODL=2328581)
    return {'name':'US Spot Bitcoin ETF Daily Flows', 'units':'USD',
            'updatedThrough':'2026-10-09', 'days':[{'date':'2026-10-09',
            'netFlowUsd':sum(parts.values()), 'perEtfUsd':parts}]}


class Response:
    def __init__(self, data=None, text='', failed=False):
        self.data, self.text, self.failed = data, text, failed
    def json(self): return self.data
    def raise_for_status(self):
        if self.failed: raise RuntimeError('HTTP 403')


class ETFFlowTests(unittest.TestCase):
    def test_usd_conversion_and_negative_constituents_reconcile(self):
        rows=tftc_rows(dataset(),'2026-10-10')
        self.assertAlmostEqual(rows[-1]['millionUsd'],21.12807855)
        self.assertEqual(rows[-1]['fundCount'],12)
        self.assertEqual(rows[-1]['perEtfUsd']['FBTC'],-3580502.45)
        self.assertEqual(rows[-1]['provider'],'TFTC')

    def test_missing_funds_bad_totals_future_dates_and_wrong_units_are_rejected(self):
        for mutate in [lambda p:p.update(units='US$m'),
                       lambda p:p['days'][0]['perEtfUsd'].pop('IBIT'),
                       lambda p:p['days'][0]['perEtfUsd'].update(IBIT=None),
                       lambda p:p['days'][0].update(netFlowUsd=float('nan')),
                       lambda p:p['days'][0].update(netFlowUsd=100000000),
                       lambda p:p['days'][0].update(date='2026-10-10'),
                       lambda p:p['days'][0].update(date='2026-10-11')]:
            value=dataset();mutate(value)
            with self.assertRaises((ValueError,TypeError)):tftc_rows(value,'2026-10-10')

    def test_fallback_and_failures_retain_dated_values_and_provider(self):
        async def run():
            clock=[dt.datetime(2026,10,10,tzinfo=dt.timezone.utc).timestamp()]
            mode=['primary'];calls=[]
            async def fetch(url):
                calls.append(url)
                if url==TFTC_URL:return Response(dataset(),failed=mode[0]!='primary')
                if 'farside' in url:
                    return Response(text='<table><tr><th>Date</th><th>IBIT</th><th>FBTC</th><th>Total</th></tr><tr><td>09 Oct 2026</td><td>100.0</td><td>(50.0)</td><td>50.0</td></tr></table>',failed=mode[0]=='fail')
                return Response(failed=True)
            with tempfile.TemporaryDirectory() as folder:
                store=Path(folder)/'review.json'
                cache=MacroReview(fetch,Path('dist/macro-data.mjs'),lambda:clock[0],store)
                first=await cache.get()
                self.assertEqual(first['feeds']['ETF']['provider'],'TFTC')
                self.assertFalse(any('farside' in u for u in calls))
                mode[0]='fallback';clock[0]+=1801
                fallback=await cache.get()
                self.assertEqual(fallback['feeds']['ETF']['provider'],'Farside')
                self.assertEqual(fallback['positioning']['ETF'][-1]['millionUsd'],50)
                mode[0]='fail';clock[0]+=1801
                failure=await cache.get()
                self.assertEqual(failure['feeds']['ETF']['status'],'error')
                self.assertEqual(failure['positioning']['ETF'],fallback['positioning']['ETF'])
                self.assertEqual(failure['feeds']['ETF']['lastSuccessAt'],fallback['feeds']['ETF']['lastSuccessAt'])
                saved=copy.deepcopy(first);saved.pop('etfFeedVersion');store.write_text(json.dumps(saved))
                self.assertEqual(MacroReview(fetch,Path('dist/macro-data.mjs'),lambda:clock[0],store).next_refresh,0)
        asyncio.run(run())


if __name__=='__main__':unittest.main()
