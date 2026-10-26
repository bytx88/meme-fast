import copy
import unittest

from worker.meme_preset import (Conflict, admin_report, default_config, method_for,
                               project_report, read_config, revise, validate_members, member_identity)

NOW = 2_000_000_000_000
HOUR = 3_600_000


def candidate(address='A'*32, **updates):
    row = dict(network='solana', contract_address=address, symbol='TEST', name='Test token',
               observedAt=NOW-60_000, priceChange1h=1, pool='exact-pool-'+address,
               poolCreatedAt=NOW-2*HOUR, liquidity=100_000, volume=20_000, buys=20, sells=10)
    row.update(updates)
    return row


def stream(*rows):
    return dict(updatedAt=NOW-30_000, windows={'1h': {'tokens': list(rows)}})


def incumbent_report(config=None):
    from worker.meme_baseline import DAY, compare_components
    config = config or default_config()
    basket, yesterday = [], []
    for index, member in enumerate(config['members']):
        row = dict(id=member_identity(member), chain=member['network'], address=member['contract_address'],
                   name=member['name'], symbol=member['symbol'], weight=1/len(config['members']),
                   source='fixed-preset-1h', priceSource='dexscreener', priceChange1h=index+1,
                   observedAt=NOW-60_000, pool='pool-'+str(index), poolCreatedAt=NOW-10*DAY,
                   eligible=True, exclusionReason=None)
        basket.append(row)
        yesterday.append(dict(row, observedAt=row['observedAt']-DAY, priceChange1h=index-2))
    history = dict(basketHistory=[dict(at=NOW-DAY, tokens=yesterday)])
    comparison, ledger = compare_components(basket, history, NOW, admissions=config['admissions'])
    coverage = dict(totalTokens=len(basket), includedTokens=len(basket), excludedTokens=0, exclusions={})
    reading = dict(at=NOW, method=config['method'], meme=sum(row['priceChange1h'] for row in basket)/len(basket),
                   coverage=coverage, memeComparison=comparison, altDelta=1, btcDelta=2,
                   constituents=len(basket), marketObservedAt=NOW-60_000)
    return dict(version=2, method=config['method'], basket=basket, readings=[reading],
                updatedAt=NOW, readingAt=NOW, attemptedAt=NOW-500,
                marketObservedAt=NOW-60_000, poolUpdatedAt=NOW-60_000,
                coverage=coverage, componentBaselines=ledger, **history)


class PresetTests(unittest.TestCase):
    def test_default_is_original_eleven_and_independent_per_call(self):
        config = default_config()
        self.assertEqual(len(config['members']), 11)
        self.assertEqual(config['members'][0]['symbol'], 'BP')
        self.assertEqual(config['method'], method_for(config['members']))
        self.assertIsNone(config['updatedAt'])
        config['members'].clear()
        self.assertEqual(len(default_config()['members']), 11)
        self.assertEqual(read_config(None), default_config())

    def test_manual_add_remove_changes_identity_method_and_equal_count(self):
        original = default_config()
        added = revise(original, dict(revision=original['revision'], members=[*original['members'], candidate()]), NOW)
        self.assertEqual(len(added['members']), 12)
        self.assertNotEqual(added['revision'], original['revision'])
        self.assertRegex(added['method'], r'^fixed-preset-12-1h-v1-[0-9a-f]{12}$')
        removed = revise(added, dict(revision=added['revision'], members=original['members']), NOW)
        self.assertEqual(removed['method'], original['method'])
        self.assertNotEqual(removed['revision'], original['revision'])
        self.assertEqual(original, default_config())

    def test_stale_editor_rejected_even_after_membership_returns_to_previous_value(self):
        original = default_config()
        changed = revise(original, dict(revision=original['revision'], members=original['members'][:-1]), NOW)
        restored = revise(changed, dict(revision=changed['revision'], members=original['members']), NOW)
        with self.assertRaises(Conflict) as result:
            revise(restored, dict(revision=original['revision'], members=original['members'][:-1]), NOW)
        self.assertEqual(result.exception.current, restored)

    def test_noop_keeps_revision_and_label_edit_preserves_calculation_method(self):
        original = default_config()
        self.assertEqual(revise(original, dict(revision=original['revision'], members=original['members']), NOW), original)
        members = copy.deepcopy(original['members'])
        members[0]['name'] = 'Backpack'
        renamed = revise(original, dict(revision=original['revision'], members=members), NOW)
        self.assertEqual(renamed['method'], original['method'])
        self.assertNotEqual(renamed['revision'], original['revision'])

    def test_exact_network_contract_validation_and_duplicates(self):
        members = default_config()['members']
        evm = dict(members[2], contract_address='0x'+members[2]['contract_address'][2:].upper())
        self.assertEqual(validate_members([evm])[0]['contract_address'], members[2]['contract_address'])
        with self.assertRaisesRegex(ValueError, 'already'):
            validate_members([members[2], evm])
        # Case differences must never be collapsed as EVM addresses are.
        self.assertEqual(len(validate_members([candidate('A'*32), candidate('a'*32)])), 2)
        for invalid in (None, [], members*3, [dict(candidate(), network='unknown')],
                        [dict(candidate(), contract_address='name-only')],
                        [dict(candidate(), network='base')], [dict(candidate(), symbol='')],
                        [dict(candidate(), name='bad\nname')], [None]):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_members(invalid)

    def test_saved_config_validation_fails_closed_and_strips_response_quote_fields(self):
        config = default_config()
        config['members'][0]['quote'] = {'eligible': True}
        config['method'] = 'untrusted-method'
        actual = read_config(config)
        self.assertNotIn('quote', actual['members'][0])
        self.assertEqual(actual['method'], default_config()['method'])
        for invalid in ({}, dict(config, revision=None), dict(config, members=[]),
                        dict(config, updatedAt=float('nan')), dict(config, updatedAt=True)):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                read_config(invalid)

    def test_pending_roster_projection_preserves_real_history_without_old_quotes(self):
        original = default_config()
        config = revise(original, dict(revision=original['revision'], members=[candidate()]), NOW)
        reading = dict(at=NOW-1000, method=original['method'], meme=12, altDelta=1, btcDelta=2)
        old = dict(version=2, method=original['method'], readings=[reading],
                   basket=[dict(chain='solana', address='A'*32, eligible=True, priceChange1h=77)],
                   basketHistory=[{'private': True}], updatedAt=NOW-1000)
        projected = project_report(old, config)
        self.assertEqual(projected['method'], config['method'])
        self.assertEqual(projected['readings'], [reading])
        self.assertIsNone(projected['updatedAt'])
        self.assertEqual(projected['basket'][0]['weight'], 1)
        self.assertFalse(projected['basket'][0]['eligible'])
        self.assertIsNone(projected['basket'][0]['priceChange1h'])
        self.assertEqual(projected['basket'][0]['exclusionReason'], 'awaiting_collection')
        self.assertEqual(projected['coverage']['includedTokens'], 0)
        self.assertNotIn('basketHistory', projected)
        self.assertEqual(old['basket'][0]['priceChange1h'], 77)

    def test_admin_report_includes_matching_quote_but_never_persists_it(self):
        config = default_config()
        member = config['members'][0]
        report = dict(method=config['method'], readings=[dict(at=NOW, method=config['method'])],
                      basket=[dict(chain=member['network'], address=member['contract_address'],
                                   eligible=True, priceChange1h=-3, observedAt=NOW-1000,
                                   pool='pool', poolCreatedAt=NOW-2*HOUR, exclusionReason=None)],
                      coverage=dict(totalTokens=11, includedTokens=1, excludedTokens=10))
        actual = admin_report(config, report)
        self.assertEqual(actual['latestReadingAt'], NOW)
        self.assertEqual(actual['members'][0]['quote']['priceChange1h'], -3)
        self.assertTrue(actual['members'][0]['quote']['eligible'])
        self.assertFalse(actual['members'][1]['quote']['eligible'])
        self.assertIsNone(actual['members'][1]['quote']['observedAt'])
        self.assertNotIn('quote', config['members'][0])
        renamed = copy.deepcopy(config)
        renamed['members'][0]['symbol'] = 'NEW-LABEL'
        self.assertEqual(project_report(report, renamed)['basket'][0]['symbol'], 'NEW-LABEL')

    def test_new_admin_roster_never_inherits_old_membership_quotes(self):
        config = default_config()
        replacement = revise(config, dict(revision=config['revision'], members=[candidate()]), NOW)
        old = dict(method=config['method'], readings=[dict(at=NOW, method=config['method'])],
                   basket=[dict(chain='solana', address='A'*32, eligible=True, priceChange1h=50,
                                observedAt=NOW, pool='old-pool')])
        actual = admin_report(replacement, old)
        self.assertIsNone(actual['latestReadingAt'])
        self.assertFalse(actual['members'][0]['quote']['eligible'])
        self.assertIsNone(actual['members'][0]['quote']['pool'])
        self.assertIsNone(actual['members'][0]['quote']['priceChange1h'])

    def test_addition_immediately_keeps_eleven_actual_comparisons_and_original_history(self):
        config, report = default_config(), incumbent_report()
        original = copy.deepcopy(report)
        added = revise(config, dict(revision=config['revision'], members=[*config['members'], candidate()]), NOW+1000)
        projected = project_report(report, added)
        reading = projected['membershipReading']
        comparison = reading['memeComparison']
        self.assertEqual(comparison['value'], 3)
        self.assertEqual((comparison['matchedMembers'], comparison['warmingMembers'], comparison['denominator']), (11, 1, 11))
        self.assertEqual(projected['readings'], report['readings'])
        self.assertEqual(report, original)
        self.assertNotIn('componentBaselines', projected)
        self.assertNotIn('basketHistory', projected)
        self.assertIsNone(reading['meme'])
        self.assertEqual(reading['coverage']['includedTokens'], 11)
        self.assertEqual(reading['coverage']['excludedTokens'], 1)
        self.assertEqual(projected['presetAdmissions'], added['admissions'])
        for previous, retained in zip(report['basket'], projected['basket']):
            self.assertEqual({key: value for key, value in retained.items() if key != 'weight'},
                             {key: value for key, value in previous.items() if key != 'weight'})
        addition = projected['basket'][-1]
        self.assertFalse(addition['eligible'])
        self.assertIsNone(addition['observedAt'])
        self.assertIsNone(addition['pool'])
        self.assertEqual(addition['comparison']['status'], 'pending')
        self.assertEqual(addition['comparison']['weight'], 0)
        self.assertEqual(addition['comparison']['addedAt'], NOW+1000)
        for field in ('initialReturn', 'firstAt', 'firstObservedAt', 'warmUntil', 'baselineReturn', 'baselineObservedAt'):
            self.assertIsNone(addition['comparison'][field])
        self.assertEqual(admin_report(added, report)['latestReadingAt'], NOW)

    def test_removal_reweights_retained_actual_deltas_without_resetting_baselines(self):
        config, report = default_config(), incumbent_report()
        # Make removing the first member visibly change the correct aggregate.
        report['basket'][0]['priceChange1h'] += 11
        first = report['basket'][0]['comparison']
        first['currentReturn'] += 11
        first['delta'] += 11
        report['readings'][0]['memeComparison']['components'][0] = copy.deepcopy(first)
        report['readings'][0]['memeComparison']['value'] += 1
        report['readings'][0]['meme'] += 1
        removed = revise(config, dict(revision=config['revision'], members=config['members'][1:]), NOW+1000)
        projected = project_report(report, removed)
        reading = projected['membershipReading']
        self.assertEqual(reading['memeComparison']['value'], 3)
        self.assertEqual(reading['memeComparison']['denominator'], 10)
        self.assertEqual(reading['memeComparison']['warmingMembers'], 0)
        self.assertEqual([row['id'] for row in projected['basket']], [row['id'] for row in report['basket'][1:]])
        for old, actual in zip(report['basket'][1:], projected['basket']):
            self.assertEqual({key: value for key, value in old['comparison'].items() if key != 'weight'},
                             {key: value for key, value in actual['comparison'].items() if key != 'weight'})
            self.assertEqual(actual['comparison']['weight'], .1)
        self.assertEqual(projected['readings'], report['readings'])

    def test_reorder_only_preserves_each_contract_comparison(self):
        config, report = default_config(), incumbent_report()
        reordered = revise(config, dict(revision=config['revision'], members=list(reversed(config['members']))), NOW+1000)
        projected = project_report(report, reordered)
        self.assertEqual(projected['membershipReading']['memeComparison']['value'], 3)
        self.assertEqual(projected['basket'], list(reversed(report['basket'])))
        self.assertEqual(projected['readings'], report['readings'])

    def test_same_roster_readdition_projects_only_new_generation_as_pending(self):
        config, report = default_config(), incumbent_report()
        removed = revise(config, dict(revision=config['revision'], members=config['members'][1:]), NOW+1000)
        readded = revise(removed, dict(revision=removed['revision'], members=config['members']), NOW+2000)
        self.assertEqual(readded['method'], config['method'])
        projected = project_report(report, readded)
        self.assertEqual(projected['basket'][0]['comparison']['status'], 'pending')
        self.assertIsNone(projected['basket'][0]['priceChange1h'])
        self.assertEqual(projected['basket'][0]['comparison']['addedAt'], NOW+2000)
        self.assertEqual(projected['membershipReading']['memeComparison']['matchedMembers'], 10)
        self.assertEqual(projected['membershipReading']['memeComparison']['warmingMembers'], 1)
        for prior, actual in zip(report['basket'][1:], projected['basket'][1:]):
            self.assertEqual({key: value for key, value in prior['comparison'].items() if key != 'weight'},
                             {key: value for key, value in actual['comparison'].items() if key != 'weight'})

    def test_projection_keeps_old_source_time_and_does_not_freshen_on_save(self):
        config, report = default_config(), incumbent_report()
        added = revise(config, dict(revision=config['revision'], members=[*config['members'], candidate()]), NOW+2*HOUR)
        projected = project_report(report, added)
        reading = projected['membershipReading']
        self.assertEqual((projected['updatedAt'], projected['readingAt'], reading['at'], reading['memeComparison']['at']), (NOW,)*4)
        self.assertEqual(projected['attemptedAt'], report['attemptedAt'])
        self.assertEqual(projected['marketObservedAt'], NOW-60_000)
        marker = dict(sourceMethod=config['method'], sourceAt=NOW, configuredAt=NOW+2*HOUR, revision=added['revision'])
        self.assertEqual(projected['membershipProjection'], marker)
        self.assertEqual(reading['membershipProjection'], marker)
        self.assertEqual(projected['readings'][0]['at'], NOW)

    def test_another_addition_does_not_restart_an_existing_addition_warmup(self):
        from worker.meme_baseline import compare_components
        config, report = default_config(), incumbent_report()
        added = revise(config, dict(revision=config['revision'], members=[*config['members'], candidate()]), NOW-HOUR)
        basket = incumbent_report(added)['basket']
        comparison, ledger = compare_components(basket, report, NOW, admissions=added['admissions'])
        # This real saved reading includes one addition whose clock already runs.
        reading = dict(report['readings'][0], method=added['method'], constituents=12,
                       meme=sum(row['priceChange1h'] for row in basket)/12,
                       coverage=dict(totalTokens=12, includedTokens=12, excludedTokens=0, exclusions={}),
                       memeComparison=comparison)
        report.update(method=added['method'], basket=basket, readings=[reading], componentBaselines=ledger)
        later = revise(added, dict(revision=added['revision'], members=[*added['members'], candidate('B'*32)]), NOW+1000)
        projected = project_report(report, later)
        previous = report['basket'][-1]['comparison']
        retained = projected['basket'][-2]['comparison']
        self.assertEqual(previous['status'], 'warming')
        self.assertEqual(retained, previous)
        self.assertEqual(retained['firstAt'], NOW)
        self.assertEqual(projected['membershipReading']['memeComparison']['warmingMembers'], 2)
        self.assertEqual(projected['membershipReading']['memeComparison']['denominator'], 11)

    def test_add_then_remove_before_collection_restores_original_comparison_without_projection(self):
        config, report = default_config(), incumbent_report()
        added = revise(config, dict(revision=config['revision'], members=[*config['members'], candidate()]), NOW+1000)
        removed = revise(added, dict(revision=added['revision'], members=config['members']), NOW+2000)
        projected = project_report(report, removed)
        self.assertNotIn('membershipReading', projected)
        self.assertEqual(projected['basket'], report['basket'])
        self.assertEqual(projected['readings'], report['readings'])

    def test_malformed_or_legacy_comparison_cannot_be_projected_as_current_evidence(self):
        config = default_config()
        added = revise(config, dict(revision=config['revision'], members=[*config['members'], candidate()]), NOW+1000)
        for field, value in (('method', 'component-1h-vs24h-v2'), ('value', 123), ('matchedMembers', 10), ('at', NOW+1)):
            report = incumbent_report()
            report['readings'][0]['memeComparison'][field] = value
            with self.subTest(field=field):
                projected = project_report(report, added)
                self.assertNotIn('membershipReading', projected)
                self.assertIsNone(projected['updatedAt'])
                self.assertTrue(all(row['comparison'] is None for row in admin_report(added, report)['members']))

    def test_malformed_same_roster_proof_cannot_restore_a_readded_generation(self):
        config, report = default_config(), incumbent_report()
        removed = revise(config, dict(revision=config['revision'], members=config['members'][1:]), NOW+1000)
        readded = revise(removed, dict(revision=removed['revision'], members=config['members']), NOW+2000)
        report['readings'][0]['memeComparison']['value'] = 123
        projected = project_report(report, readded)
        self.assertNotIn('membershipReading', projected)
        self.assertIsNone(projected['updatedAt'])
        self.assertIsNone(projected['basket'][0]['priceChange1h'])

    def test_source_basket_must_belong_to_its_actual_reading_timestamp(self):
        config = default_config()
        added = revise(config, dict(revision=config['revision'], members=[*config['members'], candidate()]), NOW+1000)
        for field in ('updatedAt', 'readingAt'):
            report = incumbent_report()
            report[field] += 1
            with self.subTest(field=field):
                projected = project_report(report, added)
                self.assertNotIn('membershipReading', projected)
                self.assertIsNone(projected['updatedAt'])

    def test_only_genuine_additions_receive_server_owned_admission_clocks(self):
        original = default_config()
        self.assertTrue(all(value == dict(kind='existing', addedAt=None)
                            for value in original['admissions'].values()))
        addition = candidate()
        added = revise(original, dict(revision=original['revision'],
                       members=[*original['members'], addition],
                       admissions={member_identity(addition): dict(kind='existing', addedAt=None)}), NOW)
        key = member_identity(addition)
        self.assertEqual(added['admissions'][key], dict(kind='added', addedAt=NOW))
        self.assertEqual({key: added['admissions'][key] for key in original['admissions']},
                         original['admissions'])
        members = copy.deepcopy(added['members'])
        members[-1]['name'] = 'Renamed'
        renamed = revise(added, dict(revision=added['revision'], members=members), NOW+1)
        self.assertEqual(renamed['admissions'], added['admissions'])
        self.assertEqual(read_config(renamed)['admissions'], renamed['admissions'])

    def test_removed_then_readded_contract_gets_new_admission_only_for_itself(self):
        original = default_config()
        removed = revise(original, dict(revision=original['revision'], members=original['members'][1:]), NOW)
        first_key = member_identity(original['members'][0])
        self.assertNotIn(first_key, removed['admissions'])
        restored = revise(removed, dict(revision=removed['revision'], members=original['members']), NOW+10)
        self.assertEqual(restored['admissions'][first_key], dict(kind='added', addedAt=NOW+10))
        self.assertTrue(all(restored['admissions'][key] == value for key, value in removed['admissions'].items()))

    def test_legacy_configuration_upgrade_is_not_a_new_membership_event(self):
        config = default_config()
        config.pop('admissions')
        self.assertEqual(read_config(config)['admissions'], default_config()['admissions'])
        config['members'] = [candidate()]
        config['updatedAt'] = NOW-HOUR
        self.assertEqual(read_config(config)['admissions'],
                         {member_identity(candidate()): dict(kind='existing', addedAt=None)})

    def test_corrupt_saved_admissions_fail_closed(self):
        config = default_config()
        key = member_identity(config['members'][0])
        for invalid in (None, [], {}, {key: {'kind':'other'}},
                        dict(config['admissions'], **{key: dict(kind='added', addedAt=True)}),
                        dict(config['admissions'], **{key: dict(kind='added', addedAt=float('nan'))}),
                        dict(config['admissions'], **{key: dict(kind='existing', addedAt=NOW)})):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                read_config(dict(config, admissions=invalid))

if __name__ == '__main__':
    unittest.main()
