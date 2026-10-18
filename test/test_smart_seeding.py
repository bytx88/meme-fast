import copy
import tempfile
import unittest
from worker import smart_seeding as seeds
from worker.smart_wallets import group, make_cohort
from test_smartness import encode58

NOW = (1800000000000 // seeds.DAY) * seeds.DAY + seeds.DAY // 2
TOKENS = [encode58(bytes([30+i])*32) for i in range(25)]
REGISTRY = [dict(row, smartMoney=True, interested=i == 0) for i, row in enumerate(group()['wallets'][:3])]


def event(token=0, owner=0, side='buy', quote='SOL', amount='1', stamp=NOW, identity=None):
    return dict(id=identity or f'{token}-{owner}-{side}-{quote}-{stamp}', address=REGISTRY[owner]['address'],
                mint=TOKENS[token], side=side, quote=quote, quoteAmount=amount, quantity='1', time=stamp)


def observation(stamp, values=('0','0'), group_id='g'):
    known = all(v is not None for v in values)
    point = dict(time=stamp, walletBalances=list(values), checkedWallets=sum(v is not None for v in values),
                 balanceRaw=str(sum(map(int,values))) if known else None)
    return dict(groupId=group_id, wallets=[{},{}], samples=[point])


def policy():
    plan=dict(tokens={},checks={})
    return seeds.ensure_token(plan,TOKENS[0],'g',NOW)


class RankingTests(unittest.TestCase):
    def test_dispatch_lease_prevents_backlogs_and_failed_enqueue_can_retry(self):
        class Leases(dict):
            def put(self,key,value,skip_if_exists=False):
                if skip_if_exists and key in self:return False
                self[key]=value
                return True
        leases=Leases();calls=[]
        self.assertTrue(seeds.request_collection(leases,lambda **k:calls.append(k),NOW))
        self.assertFalse(seeds.request_collection(leases,lambda **k:calls.append(k),NOW+60000))
        self.assertEqual(len(calls),1)
        self.assertTrue(seeds.request_collection(leases,lambda **k:calls.append(k),NOW+1800000))
        leases.clear()
        def broken(**kwargs):raise RuntimeError('Dispatcher unavailable')
        with self.assertRaises(RuntimeError):seeds.request_collection(leases,broken,NOW)
        self.assertEqual(leases,{})

    def test_distinct_smart_buyers_and_interested_outweigh_one_busy_wallet(self):
        events=[event(0,i) for i in range(3)] + [event(1,1,stamp=NOW-i,amount='1',identity=str(i)) for i in range(100)]
        ranked=seeds.rank_tokens(dict(events=events),REGISTRY,{},NOW)
        self.assertEqual(ranked[0]['token'],TOKENS[0])
        self.assertEqual(ranked[0]['buyers'],3)
        self.assertEqual(ranked[1]['buyers'],1)
        self.assertEqual(ranked[0]['interestedBuyers'],1)

    def test_non_smart_duplicates_future_invalid_and_old_events_are_excluded(self):
        registry=copy.deepcopy(REGISTRY);registry[1]['smartMoney']=False
        good=event(0,0)
        events=[good,good,event(1,1),event(2,2,stamp=NOW+1),event(3,2,stamp=NOW-seeds.DAY-1),dict(event(4,2),mint='bad'),event(5,2,amount='NaN')]
        ranked=seeds.rank_tokens(dict(events=events),registry,{},NOW)
        self.assertEqual(len(ranked),1)
        self.assertEqual(ranked[0]['steps'],1)
        self.assertIsNone(ranked[0]['newHolders'])

    def test_flow_is_normalized_per_quote_not_added_across_currencies(self):
        events=[event(0,0,quote='SOL',amount='2'),event(1,0,quote='USDC',amount='200000')]
        ranked=seeds.rank_tokens(dict(events=events),REGISTRY,{},NOW)
        self.assertEqual(ranked[0]['components']['flow'],15)
        self.assertEqual(ranked[1]['components']['flow'],15)
        self.assertEqual(ranked[0]['score'],ranked[1]['score'])

    def test_holder_growth_needs_complete_recent_history_for_exact_members(self):
        report=observation(NOW,('1','2'))
        report['samples'].insert(0,observation(NOW-seeds.DAY,('0','2'))['samples'][0])
        self.assertEqual(seeds.new_holders(report,NOW),1)
        report['samples'][0]['walletBalances'][0]=None
        self.assertIsNone(seeds.new_holders(report,NOW))

    def test_automatic_seeding_selects_only_top_twenty_and_persists_others(self):
        with tempfile.TemporaryDirectory() as folder:
            ledger=dict(events=[event(i,0,stamp=NOW-i) for i in range(25)])
            plan=seeds.prepare(folder,REGISTRY,ledger,[],{},NOW)
            self.assertEqual(len(plan['ranking']),20)
            self.assertEqual(len(plan['tokens']),21)  # existing HOOKED archive also gets pause monitoring
            self.assertEqual(sum(r['auto'] for r in plan['tokens'].values()),20)
            self.assertEqual(plan['candidateCount'],25)
            job=seeds.choose_job(plan,[],NOW)
            self.assertEqual(job['token'],plan['ranking'][0]['token'])
            later=seeds.prepare(folder,REGISTRY,dict(events=[]),[],{},NOW+seeds.DAY+1)
            self.assertEqual(len(later['tokens']),21)
            self.assertFalse(any(r['auto'] for r in later['tokens'].values()))


class DormancyTests(unittest.TestCase):
    def test_pause_requires_ten_elapsed_days_and_daily_complete_zeros(self):
        row=policy()
        for i in range(10):
            at=NOW+i*seeds.DAY
            seeds.observe(row,observation(at),at)
            self.assertEqual(row['mode'],'active')
        at=NOW+10*seeds.DAY
        seeds.observe(row,observation(at),at)
        self.assertEqual(row['mode'],'dormant')
        self.assertEqual(row['zeroStreak'],11)

    def test_missing_or_incomplete_day_does_not_count_as_zero(self):
        for missing in (True,False):
            row=policy()
            for i in range(11):
                at=NOW+i*seeds.DAY
                if i==5 and missing:continue
                report=observation(at,('0',None)) if i==5 else observation(at)
                seeds.observe(row,report,at)
            self.assertEqual(row['mode'],'active')
            self.assertEqual(row['zeroStreak'],5)

    def test_positive_partial_balance_invalidates_the_day_even_if_zero_later(self):
        row=policy()
        seeds.observe(row,observation(NOW,('1',None)),NOW)
        seeds.observe(row,observation(NOW+1),NOW+1)
        self.assertTrue(row['zeroDays'][str(NOW//seeds.DAY)]['positive'])
        self.assertEqual(row['zeroStreak'],0)

    def test_wrong_membership_bad_total_and_projected_history_cannot_certify_zero(self):
        for change in ('wrong','total','projected'):
            row=policy()
            for i in range(11):
                at=NOW+i*seeds.DAY
                report=observation(at)
                if change=='wrong':report['groupId']='other'
                if change=='total':report['samples'][0]['balanceRaw']='10'
                if change=='projected':report['samples'][0]['derivedFromGroupId']='old'
                seeds.observe(row,report,at)
            self.assertEqual(row['mode'],'active')
            self.assertEqual(row['zeroStreak'],0)

    def test_membership_changes_reset_zero_evidence_and_inspect_wakes(self):
        plan=dict(tokens={},checks={})
        row=seeds.ensure_token(plan,TOKENS[0],'g',NOW)
        row.update(mode='dormant',dormantAt=NOW,zeroDays={'1':dict(positive=False,firstAt=1)},zeroStreak=11)
        seeds.wake_inspect(row,NOW+1)
        self.assertEqual(row['mode'],'active')
        self.assertEqual(row['zeroDays'],{})
        row.update(mode='dormant',zeroStreak=11)
        changed=seeds.ensure_token(plan,TOKENS[0],'new',NOW+2)
        self.assertEqual(changed['mode'],'active')
        self.assertEqual(changed['zeroStreak'],0)

    def test_dormant_token_is_skipped_until_weekly_probe(self):
        row=policy();row.update(mode='dormant',dormantAt=NOW,auto=True)
        plan=dict(tokens={TOKENS[0]:row},checks={},dispatchCount=0)
        self.assertIsNone(seeds.choose_job(plan,[],NOW+seeds.DAY))
        self.assertEqual(seeds.choose_job(plan,[],NOW+seeds.PROBE_INTERVAL)['kind'],'probe')
        seeds.observe(row,observation(NOW+seeds.PROBE_INTERVAL,('0','1')),NOW+seeds.PROBE_INTERVAL)
        self.assertEqual(row['mode'],'active')

    def test_old_inspect_visit_cannot_keep_waking_a_newly_paused_token(self):
        with tempfile.TemporaryDirectory() as folder:
            plan=seeds.prepare(folder,REGISTRY,{},[dict(token=TOKENS[0],scope='universe',requestedAt=NOW)],{},NOW)
            plan['tokens'][TOKENS[0]].update(mode='dormant',dormantAt=NOW+1)
            seeds.save(folder,plan)
            next_plan=seeds.prepare(folder,REGISTRY,{},[dict(token=TOKENS[0],scope='universe',requestedAt=NOW)],{},NOW+2)
            self.assertEqual(next_plan['tokens'][TOKENS[0]]['mode'],'dormant')

    def test_buy_or_fresh_positive_wallet_scan_resumes_dormant_tokens(self):
        for signal in ('buy','holding'):
            with tempfile.TemporaryDirectory() as folder:
                plan=seeds.prepare(folder,REGISTRY,{},[dict(token=TOKENS[0],scope='universe',requestedAt=NOW)],{},NOW)
                plan['tokens'][TOKENS[0]].update(mode='dormant',dormantAt=NOW+1)
                seeds.save(folder,plan)
                ledger=dict(events=[event(stamp=NOW+2)]) if signal=='buy' else {}
                holdings=dict(wallets=[dict(REGISTRY[0],status='ok',checkedAt=NOW+2,mints=[TOKENS[0]])]) if signal=='holding' else {}
                result=seeds.prepare(folder,REGISTRY,ledger,[],holdings,NOW+3)
                self.assertEqual(result['tokens'][TOKENS[0]]['mode'],'active')

    def test_queue_reserves_automatic_turns_and_does_not_claim_stale_snapshot_as_fresh(self):
        row=policy();row.update(auto=True,rank=1)
        other=dict(policy(),token=TOKENS[1],auto=True,rank=2)
        plan=dict(tokens={TOKENS[0]:row,TOKENS[1]:other},checks={},dispatchCount=1)
        watches=[dict(token=TOKENS[1],scope='interested',requestedAt=NOW)]
        job=seeds.choose_job(plan,watches,NOW)
        self.assertEqual(job['kind'],'automatic')
        job['startedAt']=NOW+10
        seeds.checkpoint(plan,job,observation(NOW),NOW+20,finished=True)
        self.assertEqual(plan['checks'][job['token']+':universe']['status'],'partial')
        self.assertIsNone(plan['checks'][job['token']+':universe']['lastCompleteAt'])


if __name__=='__main__':unittest.main()
