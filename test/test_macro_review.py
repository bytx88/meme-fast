import asyncio
import datetime as dt
import json
import tempfile
import shutil
import unittest
from pathlib import Path
from worker.macro_review import MacroReview, fed_statement, fed_statement_urls, gold_rows, news_rows, valid_rows, okx_rows, etf_rows, yahoo_rows, fed_calendar, liquidation_rows, public_report

NOW = dt.datetime(2026, 10, 10, tzinfo=dt.timezone.utc).timestamp()
URL = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm'

class Response:
    def __init__(self, text='', data=None):
        self.text, self.data = text, data
    def raise_for_status(self):
        pass
    def json(self):
        return self.data

class MacroTests(unittest.TestCase):
    def test_public_journal_does_not_repeat_raw_histories_or_mutate_the_stored_record(self):
        record={'date':'2026-10-09','observedAt':'2026-10-10T00:00:00Z','ruleVersion':3,'assessment':{'phase':'Range'},'series':{'BTC':[1,2,3]},'positioning':{'SPOT':[1,2]}}
        report={'series':{'BTC':[1,2,3]},'history':[record]};wire=public_report(report)
        self.assertEqual(wire['history'][0]['assessment']['phase'],'Range');self.assertNotIn('series',wire['history'][0]);self.assertIn('series',report['history'][0])
    def test_spot_and_liquidation_samples_keep_scopes_dates_and_completed_candles(self):
        stamp=str(int((NOW-86400)*1000))
        spot=okx_rows({'code':'0','data':[[stamp,'60','40']]},'SPOT',NOW)
        self.assertEqual((spot[0]['sell'],spot[0]['buy']),(60,40))
        candle=[stamp,'100','110','90','105','1000','1000','100000','1']
        self.assertEqual(okx_rows({'code':'0','data':[candle]},'SPOT_PRICE',NOW)[0]['low'],90)
        candle[-1]='0';self.assertRaises(ValueError,okx_rows,{'code':'0','data':[candle]},'SPOT_PRICE',NOW)
        details=[{'ts':stamp,'sz':'2','posSide':'long'},{'ts':str(int((NOW+60)*1000)),'sz':'9','posSide':'short'}]
        rows=liquidation_rows({'code':'0','data':[{'instId':'ETH-USDT-SWAP','details':details},{'instId':'BTC-USDT-SWAP','details':details}]},NOW)
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['contracts'],2);self.assertEqual(rows[0]['side'],'long')
    def test_policy_calendar_uses_meeting_end_and_correct_year(self):
        def row(month,days):return f'<div class="fomc-meeting__month"><strong>{month}</strong></div><div class="fomc-meeting__date">{days}</div>'
        text='2026 FOMC Meetings'+row('September','15-16')+row('October','27-28')+'2027 FOMC Meetings'+row('January','26-27*')
        self.assertEqual([r['date'] for r in fed_calendar(text,'2026-10-10')],['2026-10-28','2027-01-27'])
    def test_exchange_units_completed_buckets_and_settled_funding(self):
        rows=okx_rows({'code':'0','data':[[str(int(NOW*1000)), '200','2','160000'],[str(int((NOW-86400)*1000)),'100','1','80000']]},'OI',NOW)
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['btc'],1);self.assertEqual(rows[0]['usd'],80000)
        funding=okx_rows({'code':'0','data':[{'fundingTime':str(int((NOW-3600)*1000)),'realizedRate':'-0.0001','fundingRate':'0.001'}]},'FUNDING',NOW)
        self.assertEqual(funding[0]['rate'],-0.0001)
        self.assertRaises(ValueError,okx_rows,{'code':'500','data':[]},'OI',NOW)

    def test_etf_parser_requires_complete_constituents_and_total_header(self):
        html='<table><tr><th>Date</th><th>IBIT</th><th>FBTC</th><th>Total</th></tr><tr><td>08 Oct 2026</td><td>100.0</td><td>(50.0)</td><td>50.0</td></tr><tr><td>09 Oct 2026</td><td>-</td><td>0.0</td><td>0.0</td></tr></table>'
        self.assertEqual(etf_rows(html,'2026-10-10'),[{'date':'2026-10-08','millionUsd':50.0}])
        self.assertRaises(ValueError,etf_rows,'<html>Access denied</html>','2026-10-10')

    def test_yahoo_ohlc_requires_a_consistent_candle(self):
        stamp=dt.datetime(2025,9,30,tzinfo=dt.timezone.utc).timestamp()
        def payload(high):return {'chart':{'result':[{'timestamp':[stamp],'indicators':{'quote':[{'open':[100],'high':[high],'low':[90],'close':[105]}]}}]}}
        self.assertEqual(yahoo_rows(payload(110),'2026-10-10')[0]['high'],110)
        self.assertNotIn('high',yahoo_rows(payload(101),'2026-10-10')[0])
    def test_policy_parser_reads_main_decision_and_fractional_rates(self):
        row = fed_statement('raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent. A vote favored 3 to 3-1/4 percent.', URL)
        self.assertEqual((row['low'], row['high']), (3.75, 4))
        self.assertEqual(row['date'], '2026-09-16')
        self.assertEqual(fed_statement('maintain the target range for the federal funds rate at 3.75 to 4 percent.', URL)['low'], 3.75)
        self.assertRaises(ValueError, fed_statement, 'Market expects 3.75 to 4 percent.', URL)

    def test_official_statement_selection_excludes_minutes_and_other_hosts(self):
        xml = f'<rss><channel><item><title>Federal Reserve issues FOMC statement</title><link>{URL}</link></item><item><title>Minutes</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261007a.htm</link></item><item><title>Federal Reserve issues FOMC statement</title><link>https://evil.test/monetary20261009a.htm</link></item></channel></rss>'
        self.assertEqual(fed_statement_urls(xml), [URL])

    def test_history_rejects_incomplete_days_invalid_prices_and_deduplicates(self):
        rows = valid_rows([{'date':'2025-09-30','close':100},{'date':'2026-10-09','close':200},{'date':'2026-10-09','close':210},{'date':'2026-10-10','close':999},{'date':'2026-10-08','close':float('inf')},{'date':'bad','close':3}], '2026-10-10')
        self.assertEqual(rows, [{'date':'2025-09-30','close':100.0},{'date':'2026-10-09','close':210.0}])
        self.assertEqual(gold_rows('date,close_usd_per_troy_oz\n2025-09-30,4000\n# credit,\n2026-10-09,4100', '2026-10-10')[-1]['close'], 4100)

    def test_headlines_require_known_publisher_relevance_and_recent_timestamp(self):
        xml = '<rss><channel>' + ''.join(f'<item><title>{title}</title><link>{url}</link><pubDate>{date}</pubDate></item>' for title,url,date in [
            ('Bitcoin ETF flows', 'https://www.coindesk.com/markets/etf', 'Fri, 09 Oct 2026 12:00:00 GMT'),
            ('Bitcoin spoof', 'https://coindesk.com.evil.test/evil', 'Fri, 09 Oct 2026 12:00:00 GMT'),
            ('Bitcoin old news', 'https://www.coindesk.com/old', 'Fri, 02 Oct 2026 00:00:00 GMT'),
            ('Fashion update', 'https://www.coindesk.com/other', 'Fri, 09 Oct 2026 12:00:00 GMT')]) + '</channel></rss>'
        self.assertEqual([r['title'] for r in news_rows(xml,'CoinDesk',NOW)], ['Bitcoin ETF flows'])

    def test_cache_and_partial_failure_keep_dated_observations_without_erasing_other_feeds(self):
        async def run():
            clock = [NOW]
            calls = []
            failure = [False]
            points = [dt.datetime(2025,9,30,tzinfo=dt.timezone.utc).timestamp(),dt.datetime(2026,10,9,tzinfo=dt.timezone.utc).timestamp()]
            async def fetch(url):
                calls.append(url)
                if 'goldprice.com' in url:
                    if failure[0]:
                        raise RuntimeError('provider down')
                    return Response('date,close_usd_per_troy_oz\n2025-09-30,4000\n2026-10-09,4200')
                if 'query2' in url:
                    return Response(data={'chart':{'result':[{'timestamp':points,'indicators':{'quote':[{'close':[100,110]}]}}]}})
                if 'press_monetary.xml' in url:
                    return Response(f'<rss><channel><item><title>Federal Reserve issues FOMC statement</title><link>{URL}</link></item></channel></rss>')
                if 'federalreserve.gov/newsevents' in url:
                    return Response('raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent.')
                return Response('<rss><channel></channel></rss>')
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder)/'seed.mjs'
                shutil.copyfile(Path(__file__).resolve().parents[1]/'dist/macro-analysis.mjs',Path(folder)/'macro-analysis.mjs')
                path.write_text('export default '+json.dumps({'collectedAt':'2026-10-08T00:00:00Z','series':{s:[{'date':'2025-09-30','close':90},{'date':'2026-10-08','close':95}] for s in ['QQQ','BTC','XAU']}})+';')
                store=Path(folder)/'review.json'
                cache = MacroReview(fetch,path,lambda:clock[0],store_path=store)
                first = await cache.get()
                self.assertEqual(first['history'][0]['assessment']['phase'],'Assessment withheld')
                self.assertEqual(first['history'][0]['ruleVersion'],5)
                self.assertEqual(first['drivers']['FED'][-1]['high'],4)
                count = len(calls)
                await cache.get()
                self.assertEqual(len(calls),count)
                cold=MacroReview(fetch,path,lambda:clock[0],store_path=store)
                self.assertEqual((await cold.get())['history'][0]['date'],'2026-10-09')
                self.assertEqual(cold.report['history'][0]['assessment'],first['history'][0]['assessment'])
                self.assertEqual(len(calls),count)
                legacy=json.loads(store.read_text());legacy['analysisRuleVersion']=1;store.write_text(json.dumps(legacy))
                self.assertEqual(MacroReview(fetch,path,lambda:clock[0],store_path=store).next_refresh,0)
                store.write_text(json.dumps(first))
                failure[0] = True;clock[0] += 1801
                second = await cold.get()
                self.assertEqual(second['feeds']['XAU']['status'],'error')
                self.assertEqual(second['feeds']['XAU']['lastSuccessAt'],first['feeds']['QQQ']['lastSuccessAt'])
                self.assertEqual(second['series']['XAU'][-1]['close'],4200)
                self.assertEqual(second['feeds']['QQQ']['status'],'ok')
                self.assertEqual(len(second['history']),1)
                self.assertEqual(MacroReview(fetch,path,lambda:clock[0],store_path=store).report['series']['XAU'][-1]['close'],4200)
                self.assertTrue(all('period2=' in url for url in calls if 'query2' in url))
        asyncio.run(run())

if __name__ == '__main__':
    unittest.main()
