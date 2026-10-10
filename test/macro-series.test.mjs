import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareSeries,visibleRows} from '../dist/macro-series.mjs';
const points=(values)=>values.map(([date,close])=>({date,close}));
test('November weekend uses last common pre-start close and excludes unmatched sessions',()=>{
 const s={QQQ:points([['2025-10-31',100],['2025-11-03',110],['2026-10-08',120]]),BTC:points([['2025-10-31',200],['2025-11-01',220],['2025-11-03',240],['2026-10-08',250]]),XAU:points([['2025-10-31',50],['2025-11-03',55],['2026-10-08',45]])};
 const c=compareSeries(s,'2025-11-01');assert.equal(c.anchor,'2025-10-31');assert.equal(c.rows.length,2);assert.ok(Math.abs(c.rows[0].returns.BTC-20)<1e-10);assert.ok(Math.abs(c.rows.at(-1).returns.XAU+10)<1e-10);
 assert.deepEqual(visibleRows(c,90),[c.rows.at(-1)]);assert.equal(visibleRows(c,90)[0].returns.BTC,25);
});
test('invalid prices cannot establish a baseline and missing common observations fail explicitly',()=>{
 const bad={QQQ:points([['2025-10-31',NaN]]),BTC:points([['2025-10-31',0]]),XAU:points([['2025-10-31',10]])};assert.throws(()=>compareSeries(bad,'2025-11-01'),/No common/);
 const empty=Object.fromEntries(['QQQ','BTC','XAU'].map(s=>[s,points([['2025-10-31',100]])]));assert.throws(()=>compareSeries(empty,'2025-11-01'),/No shared/);
});
