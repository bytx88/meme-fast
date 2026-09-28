import test from 'node:test';
import assert from 'node:assert/strict';
import {chartRange} from '../dist/jeanphil-range.mjs';

const now = 1_790_600_000_000;
const minute = 60_000;

test('a new monitor zooms to its collected samples without changing the selected period', () => {
  const view = chartRange({market: [{at: now - 7*minute}, {at: now - 2*minute}],
    social: [{at: now - 7*minute}]}, 336, now);
  assert.equal(view.zoomed, true);
  assert.equal(view.selectedStart, now - 336*60*minute);
  assert.ok(view.start < now - 7*minute);
  assert.ok(view.end > now);
  assert.ok((5*minute)/(view.end-view.start) > 0.2); // The price interval is visible.
});

test('the full selected interval returns when sufficient history exists', () => {
  const view = chartRange({market: [{at: now - 12*60*minute}]}, 24, now);
  assert.equal(view.zoomed, false);
  assert.equal(view.start, now - 24*60*minute);
  assert.equal(view.end, now);
});

test('empty history leaves the requested interval intact', () => {
  const view = chartRange({market: [], social: []}, 24, now);
  assert.equal(view.zoomed, false);
  assert.equal(view.first, null);
});
