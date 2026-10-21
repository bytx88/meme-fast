import unittest
from worker.publisher_feed import publisher_json


class PublisherFeedTests(unittest.TestCase):
    def test_rss_preserves_article_dates_excerpt_and_publisher_image(self):
        body = '''<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item>
        <title>Article &amp; context</title><link>https://decrypt.co/1</link>
        <pubDate>Wed, 21 Oct 2026 05:00:00 GMT</pubDate><description><![CDATA[<p>Actual excerpt.</p>]]></description>
        <media:content url="https://cdn.decrypt.co/image.jpg"/>
        <enclosure url="https://cdn.decrypt.co/image.jpg" type="image/jpeg"/>
        </item></channel></rss>'''
        report = publisher_json(body)
        self.assertEqual(report['status'],'ok')
        item = report['items'][0]
        self.assertEqual(item['title'],'Article & context')
        self.assertEqual(item['description'],'<p>Actual excerpt.</p>')
        self.assertEqual(item['thumbnail'],'https://cdn.decrypt.co/image.jpg')
        self.assertEqual(item['pubDate'],'Wed, 21 Oct 2026 05:00:00 GMT')

    def test_atom_alternate_link_and_empty_rss_are_valid_but_html_is_not(self):
        body = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Title</title><link href="https://decrypt.co/2"/><published>2026-10-21T05:00:00Z</published><summary>Excerpt</summary></entry></feed>'
        item = publisher_json(body)['items'][0]
        self.assertEqual(item['link'],'https://decrypt.co/2')
        self.assertEqual(item['description'],'Excerpt')
        self.assertEqual(publisher_json('<rss><channel/></rss>')['items'],[])
        with self.assertRaises(ValueError):publisher_json('<html><body>Blocked</body></html>')
