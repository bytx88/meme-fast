"""Keep HTML and its local scripts/styles on the same deployment at CDN edges."""
import html
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def version_html_assets(source, revision):
    def replace(match):
        prefix, quote, raw = match.groups()
        url = urlsplit(html.unescape(raw))
        if url.scheme or url.netloc or not url.path.endswith(('.js', '.mjs', '.css')):
            return match.group(0)
        params = [(key, value) for key, value in parse_qsl(url.query, keep_blank_values=True) if key != '_rev']
        params.append(('_rev', revision))
        path = re.sub(r'^/_assets/[^/]+/', '/', url.path)
        path = '/_assets/' + revision + '/' + path.removeprefix('./').lstrip('/')
        value = urlunsplit((url.scheme, url.netloc, path, urlencode(params), url.fragment))
        return prefix + quote + html.escape(value, quote=True) + quote

    return re.sub(r'''(\b(?:src|href)\s*=\s*)(["'])(.*?)\2''', replace, source)
