"""Restricted story inputs shared by collection and interactive research."""
from urllib.parse import urlsplit, parse_qsl, urlencode

SOURCES = {
    'jeanphil-story':'https://trenches-on.com/en/runners/2026-09-20-jeanphil/',
    'jeanphil-origin':'https://meme.com/memes/jean-phil',
    'super-inu':'https://opensea.io/token/solana/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP',
    'ionq-background':'https://www.reddit.com/r/Backpack_official/comments/1wnd2fi/ionq_stock_is_now_tokenized_on_solana_how_ionq/',
}
SEARCH = 'https://r.jina.ai/http://html.duckduckgo.com/html/'


def context_target(url):
    if url in {'https://r.jina.ai/'+source for source in SOURCES.values()}:
        return url, 900
    parsed = urlsplit(url)
    query = parse_qsl(parsed.query,keep_blank_values=True)
    if (parsed.scheme != 'https' or parsed.netloc != 'r.jina.ai'
            or parsed.path != '/http://html.duckduckgo.com/html/' or parsed.fragment
            or len(query)!=1 or query[0][0]!='q' or not 1<=len(query[0][1].strip())<=300):
        raise ValueError('Unsupported context source')
    return SEARCH+'?'+urlencode({'q':query[0][1].strip()}), 300
