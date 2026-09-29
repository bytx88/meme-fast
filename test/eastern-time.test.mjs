import test from 'node:test';
import assert from 'node:assert/strict';
import {easternDateTime,easternRange} from '../dist/eastern-time.mjs';

test('Eastern display follows daylight saving time and shows the date', () => {
  assert.equal(easternDateTime('2026-01-15T17:00:00Z'), 'Jan 15, 2026, 12:00 PM ET');
  assert.equal(easternDateTime('2026-09-29T17:00:00Z'), 'Sep 29, 2026, 1:00 PM ET');
  assert.equal(easternRange('2026-09-30T03:30:00Z', '2026-09-30T04:30:00Z'),
    'Sep 29, 2026, 11:30 PM ET–Sep 30, 2026, 12:30 AM ET');
});
