import unittest
from worker.asset_revision import version_html_assets


class AssetRevisionTests(unittest.TestCase):
    def test_local_assets_follow_deployment_and_keep_existing_parameters(self):
        source = '<script src="./app.js?v=old"></script><link href="./style.css"><script src="./view.mjs"></script>'
        result = version_html_assets(source, 'release2')
        self.assertIn('/_assets/release2/app.js?v=old&amp;_rev=release2', result)
        self.assertIn('/_assets/release2/style.css?_rev=release2', result)
        self.assertIn('/_assets/release2/view.mjs?_rev=release2', result)
        self.assertEqual(version_html_assets(result, 'release2'), result)
        self.assertNotIn('release2', version_html_assets(result, 'release3'))

    def test_remote_assets_navigation_and_images_are_unchanged(self):
        source = '<script src="https://example.com/app.js"></script><link href="//cdn.test/a.css"><a href="./radar.html">Radar</a><img src="./brand.svg">'
        self.assertEqual(version_html_assets(source, 'new'), source)


if __name__ == '__main__':
    unittest.main()
