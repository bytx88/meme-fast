"""Render the persisted shared review without waiting for upstream providers."""
import html
import json
import re


def render_macro_bootstrap(source, report):
    if not isinstance(report, dict) or not report.get('collectedAt'):
        return source
    history = [r for r in report.get('history', []) if r.get('assessment')]
    latest = max(history, key=lambda r: r['date'], default=None)
    values = {'review-refresh-state': 'Saved shared review · refreshing sources in background'}
    if latest:
        a = latest['assessment']
        cards = []
        for row in a.get('dailyRead', []):
            tone = row.get('tone') if row.get('tone') in ('support', 'pressure', 'neutral', 'unavailable') else 'unavailable'
            contents = ''.join(f'<{tag} class="{cls}">{html.escape(str(row.get(key, "")))}</{tag}>' for tag, cls, key in (
                ('h3', '', 'label'), ('strong', 'daily-read-value', 'value'),
                ('p', 'daily-read-detail', 'detail'), ('span', 'daily-read-context', 'context'),
                ('time', 'daily-read-date', 'date')))
            cards.append(f'<article class="daily-read-card {tone}">{contents}</article>')
        if cards:
            source = re.sub(r'(<div\b[^>]*\bid="daily-market-read"[^>]*>).*?(</div>)',
                            lambda m: m[1] + ''.join(cards) + m[2], source, count=1, flags=re.S)
        floor = a.get('referenceHigh') if a.get('accepted') else a.get('low')
        values.update({'review-headline': a.get('phase', 'Saved assessment'),
                       'review-date': latest['date'],
                       'review-freshness': 'Saved assessment: ' + latest.get('observedAt', latest['date']) + ' · source candle: ' + latest['date'],
                       'phase-evidence': a.get('summary', ''),
                       'phase-next-level': f"${a['referenceHigh']:,.2f}" if isinstance(a.get('referenceHigh'), (int, float)) else 'Unavailable',
                       'phase-fail-level': f"${floor:,.2f}" if isinstance(floor, (int, float)) else 'Unavailable'})
    for key, value in values.items():
        pattern = r'(<[^>]+\bid="' + re.escape(key) + r'"[^>]*>)[^<]*(</[^>]+>)'
        source = re.sub(pattern, lambda m: m[1] + html.escape(str(value)) + m[2], source, count=1)
    payload = json.dumps({'version': 1, 'report': report}, separators=(',', ':'), allow_nan=False)
    payload = payload.replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')
    return source.replace('</body>', '<script type="application/json" id="macro-bootstrap">' + payload + '</script></body>')
