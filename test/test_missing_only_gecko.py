import tempfile
import unittest
from contextlib import closing
from worker.source_stream import SourceStream, gecko_response
from test_gecko_projection import pools, resource, reference


class MissingOnlyGeckoTests(unittest.TestCase):
    def test_inspect_bare_pool_batch_reuses_discovery_and_fetches_only_unseen_pool(self):
        with tempfile.TemporaryDirectory() as folder, closing(SourceStream(folder,clock=lambda:1000)) as stream:
            calls=[]
            first=gecko_response(stream,'/networks/solana/trending_pools?duration=1h&include=base_token,quote_token',
                                 lambda _:pools(['A','B']),600)
            def fetch(path):calls.append(path);return {'data':pools(['C'])['data']}
            reply=gecko_response(stream,'/networks/solana/pools/multi/B,C',fetch,300)
            self.assertEqual(calls,['/networks/solana/pools/multi/C'])
            self.assertEqual(reply['observedAt'],first['observedAt'])
            self.assertEqual({row['id'] for row in reply['value']['data']},{'solana_B','solana_C'})
            self.assertNotIn('included',reply['value'])

    def test_launch_pools_supply_inspect_primary_fields_without_certifying_a_token_pool_list(self):
        with tempfile.TemporaryDirectory() as folder, closing(SourceStream(folder,clock=lambda:1000)) as stream:
            token=resource('token','T',related={'top_pools':[reference('pool','P')]})
            body={'data':[token],'included':pools(['P'])['data']}
            first=gecko_response(stream,'/networks/solana/tokens/multi/T?include=top_pools',lambda _:body,300)
            reply=gecko_response(stream,'/networks/solana/pools/multi/P',
                                 lambda _:self.fail('included complete pool should be shared'),300)
            self.assertEqual(reply['observedAt'],first['observedAt'])
            calls=[]
            gecko_response(stream,'/networks/solana/tokens/T/pools?include=base_token,quote_token',
                           lambda path:calls.append(path) or {'data':[],'included':[]},300)
            self.assertEqual(len(calls),1)


if __name__=='__main__':unittest.main()
