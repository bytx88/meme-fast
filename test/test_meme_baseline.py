import copy
import unittest
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

from worker.meme_baseline import DAY, HOUR, METHOD, compare_components, recover

NOW = 2_000_000_000_000
MINUTE = 60_000


def member(address='A'*32, change=5, now=NOW, **updates):
    row = dict(id='solana:'+address, chain='solana', address=address, symbol='TEST', name='Test',
               eligible=True, exclusionReason=None, priceChange1h=change,
               observedAt=now-MINUTE, pool='pool-'+address, poolCreatedAt=now-10*DAY)
    row.update(updates)
    return row


def history_report(*rows, at=NOW-DAY):
    return dict(basketHistory=[dict(at=at, tokens=list(rows))])


def candles(row, now=NOW):
    end=int(row['observedAt']//(5*MINUTE))*(5*MINUTE)
    values=[]
    for index in range(302):
        stamp=end-(302-index)*5*MINUTE
        price=1+index/1000
        values.append([stamp/1000,price,price,price,price,10])
    return dict(status=200,body={'_sourceObservedAt':now,
                                'data':{'attributes':{'ohlcv_list':list(reversed(values))}}})


class BaselineTests(unittest.TestCase):
    def test_first_qualified_return_is_copied_and_neutral_for_full_day(self):
        basket=[member(change=8)]
        first,ledger=compare_components(basket,{},NOW)
        component=first['components'][0]
        self.assertEqual(first['method'],METHOD)
        self.assertEqual(first['at'],NOW)
        self.assertEqual(first['value'],0)
        self.assertEqual(component['status'],'warming')
        self.assertEqual(component['initialReturn'],8)
        self.assertEqual(component['baselineReturn'],8)
        self.assertEqual(component['baselineSource'],'initial-reference')
        self.assertEqual(component['baselineObservedAt'],NOW-MINUTE)
        self.assertEqual(component['firstAt'],NOW)
        self.assertEqual(component['warmUntil'],NOW+DAY)
        self.assertIsNone(component['baselineWindowEndAt'])
        self.assertEqual(len(ledger['members'][basket[0]['id']]['observations']),1)
        # The copy is an enrollment reference, never a manufactured historical row.
        self.assertEqual(ledger['members'][basket[0]['id']]['observations'][0]['observedAt'],NOW-MINUTE)
        later,_=compare_components([member(change=500,now=NOW+DAY-1)],
                                   dict(componentBaselines=ledger),NOW+DAY-1)
        self.assertEqual(later['components'][0]['initialReturn'],8)
        self.assertEqual(later['components'][0]['status'],'warming')
        self.assertEqual(later['value'],0)

    def test_at_day_boundary_real_first_sample_becomes_historical_baseline(self):
        first,ledger=compare_components([member(change=8)],{},NOW)
        at=NOW+DAY
        result,_=compare_components([member(change=11,now=at)],dict(componentBaselines=ledger),at)
        component=result['components'][0]
        self.assertEqual(result['value'],3)
        self.assertEqual(component['status'],'active')
        self.assertEqual(component['baselineSource'],'saved-h1')
        self.assertEqual(component['baselineReturn'],8)
        self.assertEqual(component['baselineObservedAt'],NOW-MINUTE)
        self.assertEqual(component['baselineWindowEndAt']-component['baselineWindowStartAt'],HOUR)

    def test_real_existing_baselines_continue_across_changed_rosters(self):
        a,b=member(change=7),member('B'*32,change=-4)
        old_a=member(change=2,now=NOW-DAY)
        old_b=member('B'*32,change=-1,now=NOW-DAY)
        report=dict(legacyMethods={'old-roster':history_report(old_a,old_b)})
        added=member('C'*32,change=100)
        result,_=compare_components([a,b,added],report,NOW,prior_ids={a['id'],b['id']})
        self.assertAlmostEqual(result['value'],(5-3+0)/3)
        self.assertEqual([row['status'] for row in result['components']],['active','active','warming'])
        self.assertEqual([row['weight'] for row in result['components']],[1/3]*3)
        removed,_=compare_components([a],report,NOW,prior_ids={a['id'],b['id']})
        self.assertEqual(removed['value'],5)
        self.assertEqual(removed['components'][0]['weight'],1)

    def test_history_uses_exact_contract_and_original_validated_source_time(self):
        current=member(change=7)
        wrong=member('B'*32,change=100,now=NOW-DAY)
        stale=member(change=50,now=NOW-DAY,observedAt=NOW-DAY-16*MINUTE)
        future=member(change=60,now=NOW-DAY,observedAt=NOW-DAY+1)
        report=history_report(wrong,stale,future)
        result,_=compare_components([current],report,NOW)
        self.assertEqual(result['components'][0]['status'],'warming')
        self.assertEqual(result['value'],0)

    def test_matured_component_without_matching_actual_history_is_unavailable(self):
        _,ledger=compare_components([member()],{},NOW)
        result,_=compare_components([member(now=NOW+2*DAY)],dict(componentBaselines=ledger),NOW+2*DAY)
        self.assertEqual(result['components'][0]['status'],'unavailable')
        self.assertEqual(result['components'][0]['reason'],'missing_24h_baseline')
        self.assertIsNone(result['value'])
        self.assertIsNone(result['components'][0]['delta'])

    def test_missing_current_quote_does_not_reweight_or_establish_reference(self):
        missing=member('B'*32,change=None,eligible=False,exclusionReason='missing_return')
        result,ledger=compare_components([member(),missing],{},NOW)
        self.assertIsNone(result['value'])
        self.assertEqual(result['warmingMembers'],1)
        self.assertEqual(result['unavailableMembers'],1)
        self.assertEqual([row['weight'] for row in result['components']],[.5,.5])
        self.assertNotIn('firstAt',ledger['members'][missing['id']])

    def test_recovery_is_one_exact_token_usd_bounded_request_covering_next_day(self):
        row=member(change=10)
        fetch=Mock(return_value=candles(row))
        result,ledger=compare_components([row],{},NOW,history=fetch)
        self.assertEqual(result['components'][0]['status'],'active')
        self.assertEqual(result['components'][0]['baselineSource'],'gecko-5m-close')
        path=fetch.call_args.args[0]
        self.assertIn('/networks/solana/pools/'+row['pool']+'/ohlcv/minute?',path)
        params=parse_qs(urlsplit(path).query)
        self.assertEqual(params['token'],[row['address']])
        self.assertEqual(params['currency'],['usd'])
        self.assertEqual(params['aggregate'],['5'])
        self.assertEqual(params['limit'],['302'])
        self.assertEqual(fetch.call_args.kwargs,dict(workload='background'))
        baseline=result['components'][0]
        self.assertLessEqual(abs(baseline['baselineObservedAt']-(row['observedAt']-DAY)),10*MINUTE)
        later=NOW+HOUR
        result,_=compare_components([member(change=20,now=later)],dict(componentBaselines=ledger),later,history=fetch)
        self.assertEqual(result['components'][0]['status'],'active')
        self.assertEqual(fetch.call_count,1)

    def test_recovery_sparse_conflicting_or_invalid_candles_never_fill_gaps(self):
        row=member()
        payload=candles(row)
        raw=payload['body']['data']['attributes']['ohlcv_list']
        # Keep just two price endpoints an hour apart: absent bars are not padded.
        sparse=copy.deepcopy(payload)
        sparse['body']['data']['attributes']['ohlcv_list']=[raw[0],raw[12]]
        self.assertEqual(recover(row,Mock(return_value=sparse),NOW),[])
        malformed=copy.deepcopy(payload)
        malformed['body']['data']['attributes']['ohlcv_list']=[[0,1,0,2,1,1]]
        self.assertEqual(recover(row,Mock(return_value=malformed),NOW),[])
        ambiguous=copy.deepcopy(sparse)
        conflict=copy.deepcopy(raw[0]);conflict[1:5]=[2,2,2,2]
        ambiguous['body']['data']['attributes']['ohlcv_list'].append(conflict)
        self.assertEqual(recover(row,Mock(return_value=ambiguous),NOW),[])

    def test_recovery_requires_pool_existed_for_entire_baseline_hour(self):
        row=member(poolCreatedAt=NOW-2*HOUR)
        result,_=compare_components([row],{},NOW,history=Mock(return_value=candles(row)))
        self.assertEqual(result['components'][0]['status'],'warming')
        self.assertEqual(result['value'],0)
        # Recent windows are real, but cannot stand in for yesterday's return.
        self.assertGreater(len(recover(row,Mock(return_value=candles(row)),NOW)),0)

    def test_recovery_missing_receipt_timestamp_and_extreme_return_stay_warming(self):
        row=member()
        bad=candles(row)
        del bad['body']['_sourceObservedAt']
        result,_=compare_components([row],{},NOW,history=Mock(return_value=bad))
        self.assertEqual(result['components'][0]['status'],'warming')
        old=member(change=17_361_910_275_994,now=NOW-DAY)
        result,_=compare_components([row],history_report(old),NOW)
        self.assertEqual(result['components'][0]['status'],'warming')

    def test_recovery_rejects_future_receipt_but_accepts_actual_fetch_completion_time(self):
        row=member()
        reply=candles(row,now=NOW+1000)
        self.assertEqual(recover(row,Mock(return_value=reply),NOW),[])
        self.assertGreater(len(recover(row,Mock(return_value=reply),NOW,clock=lambda:NOW+1000)),0)

    def test_recovery_maps_provider_network_ids_without_changing_contract(self):
        for chain, provider in (('ethereum','eth'),('polygon','polygon_pos'),('avalanche','avax')):
            with self.subTest(chain=chain):
                row=member(chain=chain,address='0x'+'ab'*20)
                fetch=Mock(return_value=candles(row))
                recover(row,fetch,NOW)
                self.assertTrue(fetch.call_args.args[0].startswith('/networks/'+provider+'/'))
                self.assertEqual(parse_qs(urlsplit(fetch.call_args.args[0]).query)['token'],[row['address']])

    def test_two_recoveries_per_pass_and_never_attempted_members_get_next_turn(self):
        rows=[member(char*32) for char in 'ABC']
        fetch=Mock(side_effect=ValueError('deferred'))
        first,ledger=compare_components(copy.deepcopy(rows),{},NOW,history=fetch)
        self.assertEqual(fetch.call_count,2)
        self.assertEqual(first['warmingMembers'],3)
        self.assertEqual(first['value'],0)
        later=NOW+HOUR
        fetch.reset_mock()
        newer=[member(char*32,now=later) for char in 'ABC']
        compare_components(newer,dict(componentBaselines=ledger),later,history=fetch)
        self.assertEqual(fetch.call_count,2)
        self.assertIn('C'*32,fetch.call_args_list[0].args[0])

    def test_slow_historical_recovery_rechecks_source_freshness_at_completion(self):
        row=member(observedAt=NOW-899_999)
        result,_=compare_components([row],{},NOW,history=Mock(side_effect=ValueError()),clock=lambda:NOW+2)
        self.assertEqual(result['at'],NOW+2)
        self.assertFalse(row['eligible'])
        self.assertEqual(row['exclusionReason'],'stale_quote')
        self.assertIsNone(result['value'])

    def test_removed_then_readded_member_gets_new_reference_if_no_matching_history(self):
        row=member()
        _,ledger=compare_components([row],{},NOW)
        later=NOW+2*DAY
        result,_=compare_components([member(change=20,now=later)],dict(componentBaselines=ledger),later,prior_ids=set())
        component=result['components'][0]
        self.assertEqual(component['status'],'warming')
        self.assertEqual(component['firstAt'],later)
        self.assertEqual(component['initialReturn'],20)

    def test_incumbent_without_yesterday_history_never_gets_neutral_warmup(self):
        row = member(change=8)
        admissions = {row['id']: dict(kind='existing', addedAt=None)}
        comparison, ledger = compare_components([row], {}, NOW, admissions=admissions)
        component = comparison['components'][0]
        self.assertEqual(component['status'], 'awaiting_history')
        self.assertEqual(component['kind'], 'existing')
        self.assertEqual(comparison['warmingMembers'], 0)
        self.assertEqual(comparison['awaitingHistoryMembers'], 1)
        self.assertEqual(comparison['unavailableMembers'], 0)
        for field in ('delta', 'baselineReturn', 'baselineObservedAt', 'baselineSource', 'warmUntil'):
            self.assertIsNone(component[field])
        self.assertIsNone(comparison['value'])
        self.assertNotIn('firstAt', ledger['members'][row['id']])
        self.assertEqual(len(ledger['members'][row['id']]['observations']), 1)

    def test_incumbent_real_baseline_works_without_any_enrollment_reference(self):
        row, old = member(change=8), member(change=2, now=NOW-DAY)
        comparison, _ = compare_components([row], history_report(old), NOW,
                    admissions={row['id']: dict(kind='existing', addedAt=None)})
        self.assertEqual(comparison['value'], 6)
        self.assertEqual(comparison['components'][0]['status'], 'active')
        self.assertIsNone(comparison['components'][0]['firstAt'])
        self.assertIsNone(comparison['components'][0]['warmUntil'])

    def test_upgrade_repairs_false_incumbent_warmup_without_rewriting_evidence(self):
        row = member(change=8)
        _, old_ledger = compare_components([copy.deepcopy(row)], {}, NOW)
        old_ledger['version'] = 1
        for entry in old_ledger['members'].values():
            entry.pop('kind'); entry.pop('addedAt')
        report = dict(componentBaselines=copy.deepcopy(old_ledger), readings=[dict(at=NOW, meme=8)])
        original = copy.deepcopy(report)
        comparison, ledger = compare_components([member(change=10, now=NOW+HOUR)], report, NOW+HOUR,
                        admissions={row['id']: dict(kind='existing', addedAt=None)})
        self.assertEqual(comparison['components'][0]['status'], 'awaiting_history')
        self.assertEqual(comparison['warmingMembers'], 0)
        self.assertIsNone(comparison['value'])
        self.assertEqual(ledger['members'][row['id']]['initialReturn'], 8)
        self.assertEqual(ledger['members'][row['id']]['firstAt'], NOW)
        self.assertEqual(report, original)

    def test_new_member_clock_survives_restarts_missing_quote_and_recovery(self):
        row = member(change=8)
        admissions = {row['id']: dict(kind='added', addedAt=NOW-1000)}
        _, ledger = compare_components([copy.deepcopy(row)], {}, NOW, admissions=admissions)
        missing = member(change=None, now=NOW+HOUR, eligible=False, exclusionReason='missing_return')
        unavailable, ledger = compare_components([missing], dict(componentBaselines=ledger), NOW+HOUR,
                            admissions=admissions, prior_ids={row['id']})
        self.assertEqual(unavailable['components'][0]['status'], 'unavailable')
        recovered, _ = compare_components([member(change=900, now=NOW+2*HOUR)],
                         dict(componentBaselines=ledger), NOW+2*HOUR,
                         admissions=admissions, prior_ids={row['id']})
        component = recovered['components'][0]
        self.assertEqual(component['status'], 'warming')
        self.assertEqual(component['firstAt'], NOW)
        self.assertEqual(component['warmUntil'], NOW+DAY)
        self.assertEqual(component['initialReturn'], 8)
        self.assertEqual(recovered['value'], 0)

    def test_invalid_or_future_admission_cannot_silently_neutralize_a_member(self):
        row = member()
        for entry in (dict(kind='existing', addedAt=NOW), dict(kind='added', addedAt=NOW+1),
                      dict(kind='added', addedAt=True), dict(kind='added', addedAt=None), dict(kind='bogus')):
            with self.subTest(entry=entry), self.assertRaises(ValueError):
                compare_components([copy.deepcopy(row)], {}, NOW, admissions={row['id']:entry})


if __name__ == '__main__':
    unittest.main()
