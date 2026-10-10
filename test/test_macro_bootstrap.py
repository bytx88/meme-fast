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
