import asyncio
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from worker.macro_review import MacroReview, fed_statement, fed_statement_urls, gold_rows, news_rows, valid_rows

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
        rows = valid_rows([{'date':'2025-10-31','close':100},{'date':'2026-10-09','close':200},{'date':'2026-10-09','close':210},{'date':'2026-10-10','close':999},{'date':'2026-10-08','close':float('inf')},{'date':'bad','close':3}], '2026-10-10')
        self.assertEqual(rows, [{'date':'2025-10-31','close':100.0},{'date':'2026-10-09','close':210.0}])
        self.assertEqual(gold_rows('date,close_usd_per_troy_oz\n2025-10-31,4000\n# credit,\n2026-10-09,4100', '2026-10-10')[-1]['close'], 4100)

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
            points = [dt.datetime(2025,10,31,tzinfo=dt.timezone.utc).timestamp(),dt.datetime(2026,10,9,tzinfo=dt.timezone.utc).timestamp()]
            async def fetch(url):
                calls.append(url)
                if 'goldprice.com' in url:
                    if failure[0]:
                        raise RuntimeError('provider down')
                    return Response('date,close_usd_per_troy_oz\n2025-10-31,4000\n2026-10-09,4200')
                if 'query2' in url:
                    return Response(data={'chart':{'result':[{'timestamp':points,'indicators':{'quote':[{'close':[100,110]}]}}]}})
                if 'press_monetary.xml' in url:
                    return Response(f'<rss><channel><item><title>Federal Reserve issues FOMC statement</title><link>{URL}</link></item></channel></rss>')
                if 'federalreserve.gov/newsevents' in url:
                    return Response('raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent.')
                return Response('<rss><channel></channel></rss>')
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder)/'seed.mjs'
                path.write_text('export default '+json.dumps({'collectedAt':'2026-10-08T00:00:00Z','series':{s:[{'date':'2025-10-31','close':90},{'date':'2026-10-08','close':95}] for s in ['QQQ','BTC','XAU']}})+';')
                cache = MacroReview(fetch,path,lambda:clock[0])
                first = await cache.get()
                self.assertEqual(first['drivers']['FED'][-1]['high'],4)
                count = len(calls)
                await cache.get()
                self.assertEqual(len(calls),count)
                failure[0] = True;clock[0] += 1801
                second = await cache.get()
                self.assertEqual(second['feeds']['XAU']['status'],'error')
                self.assertEqual(second['feeds']['XAU']['lastSuccessAt'],first['feeds']['QQQ']['lastSuccessAt'])
                self.assertEqual(second['series']['XAU'][-1]['close'],4200)
                self.assertEqual(second['feeds']['QQQ']['status'],'ok')
                self.assertTrue(all('period2=' in url for url in calls if 'query2' in url))
        asyncio.run(run())

if __name__ == '__main__':
    unittest.main()
