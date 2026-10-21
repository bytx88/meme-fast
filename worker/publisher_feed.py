"""Normalize configured publisher RSS without an RSS-to-JSON dependency."""
import xml.etree.ElementTree as ET

SOURCES = {'decrypt':'https://decrypt.co/feed','cointelegraph':'https://cointelegraph.com/rss'}


def publisher_json(body):
    root = ET.fromstring(body)
    if root.tag == 'rss' and root.find('channel') is not None:
        entries = root.findall('channel/item')
    elif root.tag == '{http://www.w3.org/2005/Atom}feed':
        entries = root.findall('{http://www.w3.org/2005/Atom}entry')
    else:
        raise ValueError('Invalid publisher RSS/Atom response')
    def text(entry, name):
        node = entry.find(name)
        if node is None:
            node = entry.find('{http://www.w3.org/2005/Atom}'+name)
        return ''.join(node.itertext()) if node is not None else ''
    items = []
    for entry in entries[:100]:
        link = text(entry,'link')
        if not link:
            links = entry.findall('{http://www.w3.org/2005/Atom}link')
            link = next((row.get('href','') for row in links if row.get('rel','alternate') == 'alternate'),'')
        image = next((row.get('url') for row in entry.iter() if row.tag in (
            '{http://search.yahoo.com/mrss/}thumbnail','{http://search.yahoo.com/mrss/}content') and row.get('url')),None)
        enclosure = entry.find('enclosure')
        items.append(dict(title=text(entry,'title'),link=link,
            pubDate=text(entry,'pubDate') or text(entry,'published') or text(entry,'updated'),
            description=text(entry,'description') or text(entry,'summary') or text(entry,'content'),
            thumbnail=image,enclosure=dict(link=enclosure.get('url'),type=enclosure.get('type')) if enclosure is not None else None))
    return dict(status='ok',items=items)
