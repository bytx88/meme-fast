import json
import re
import unittest
from worker.macro_bootstrap import render_macro_bootstrap


class BootstrapTests(unittest.TestCase):
    def test_saved_review_renders_without_fetch_and_escapes_headlines(self):
        report = {'collectedAt': '2026-10-10T12:00:00Z', 'history': [
            {'date': '2026-10-09', 'observedAt': '2026-10-10T12:00:00Z',
             'assessment': {'phase': '</h2><script>alert(1)</script>', 'referenceHigh': 110, 'low': 90}}],
            'news': [{'title': '</script><script>alert(2)</script>'}]}
        source = '<h2 id="review-headline">Loading</h2><strong id="phase-next-level"></strong></body>'
        result = render_macro_bootstrap(source, report)
        self.assertNotIn('<script>alert(', result)
        self.assertIn('$110.00', result)
        payload = re.search(r'id="macro-bootstrap">(.*?)</script>', result)[1]
        self.assertEqual(json.loads(payload)['report'], report)

    def test_missing_persisted_report_keeps_truthful_fallback(self):
        self.assertEqual(render_macro_bootstrap('Loading', {}), 'Loading')

    def test_daily_cards_render_immediately_and_escape_saved_content(self):
        report = {'collectedAt': '2026-10-10', 'history': [{'date': '2026-10-09',
            'assessment': {'dailyRead': [{'label': 'BTC response', 'value': '-2.31%',
                'tone': 'pressure', 'detail': '<script>bad()</script>',
                'context': '5 shared sessions', 'date': '2026-10-02 → 2026-10-09'}]}}]}
        source = '<div id="daily-market-read" aria-label="Daily read"></div></body>'
        result = render_macro_bootstrap(source, report)
        self.assertIn('daily-read-card pressure', result)
        self.assertIn('-2.31%', result)
        self.assertIn('&lt;script&gt;', result)
        self.assertNotIn('<script>bad()', result)
        self.assertEqual(result.count('id="daily-market-read"'), 1)
