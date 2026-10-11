import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonalChange} from '../dist/macro-series.mjs';
const series=(rows)=>Object.fromEntries(['QQQ','BTC','XAU'].map(s=>[s,rows.map(([date,close])=>({date,close}))]));
test('October headline includes the full June-start return through the latest shared close',()=>{
 const r=seasonalChange(series([['2026-05-29',100],['2026-06-01',102],['2026-09-30',105],['2026-10-09',110]]));
 assert.equal(r.start,'2026-06-01');assert.equal(r.anchor,'2026-05-29');assert.equal(r.date,'2026-10-09');assert.equal(r.label,'Since Jun 2026');assert.ok(Math.abs(r.returns.BTC-10)<1e-8);
});
test('headlines move to the preceding seasonal frame across year and June boundaries',()=>{
 assert.equal(seasonalChange(series([['2025-05-30',100],['2026-01-09',110]])).start,'2025-06-01');
 assert.equal(seasonalChange(series([['2025-09-30',100],['2026-02-09',110]])).start,'2025-10-01');
 assert.equal(seasonalChange(series([['2026-01-30',100],['2026-06-09',110]])).start,'2026-02-01');
});
test('seasonal headlines match all asset dates and reject missing or distant baselines',()=>{
 const r=series([['2026-05-29',100],['2026-10-08',105],['2026-10-09',110]]);r.XAU.pop();
 assert.equal(seasonalChange(r).date,'2026-10-08');
 r.XAU.shift();assert.equal(seasonalChange(r),null);
 assert.equal(seasonalChange(series([['2026-05-01',100],['2026-10-09',110]])),null);
});
