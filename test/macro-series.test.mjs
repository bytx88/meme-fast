import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareSeries,visibleRows,dailyReview,seasonalFrames,frameReturns,executionReview,assetPeriods} from '../dist/macro-series.mjs';
const points=(values)=>values.map(([date,close])=>({date,close}));
test('November weekend uses last common pre-start close and excludes unmatched sessions',()=>{
 const s={QQQ:points([['2025-10-31',100],['2025-11-03',110],['2026-10-08',120]]),BTC:points([['2025-10-31',200],['2025-11-01',220],['2025-11-03',240],['2026-10-08',250]]),XAU:points([['2025-10-31',50],['2025-11-03',55],['2026-10-08',45]])};
 const c=compareSeries(s,'2025-11-01');assert.equal(c.anchor,'2025-10-31');assert.equal(c.rows.length,2);assert.ok(Math.abs(c.rows[0].returns.BTC-20)<1e-10);assert.ok(Math.abs(c.rows.at(-1).returns.XAU+10)<1e-10);
 assert.deepEqual(visibleRows(c,90),[c.rows.at(-1)]);assert.equal(visibleRows(c,90)[0].returns.BTC,25);
});
test('daily review separates period performance from the fixed reference and excludes latest close from range',()=>{
 const rows=Array.from({length:22},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),prices:{BTC:100+i,QQQ:100,XAU:200},returns:{BTC:999,QQQ:999,XAU:999}}));
 rows.at(-1).prices.BTC=150;
 const r=dailyReview({rows});assert.equal(r.state,'breakout');assert.equal(r.high,120);assert.equal(r.low,101);assert.equal(r.metrics.BTC[1],25);assert.ok(Math.abs(r.relative-100*(150/116-1))<1e-10);
 const sparse=dailyReview({rows:rows.slice(0,2)});assert.equal(sparse.state,'unknown');assert.equal(sparse.metrics.BTC[20],null);assert.equal(sparse.high,null);
});
test('seasonal frames cross the year boundary and partial-window returns remain observed',()=>{
 const frames=seasonalFrames('2025-10-01','2026-10-08');assert.equal(frames.length,4);assert.equal(frames[0].end,'2026-01-31');assert.equal(frames[0].complete,true);assert.equal(frames[3].end,'2027-01-31');assert.equal(frames[3].complete,false);
 const rows=[{date:'2026-09-30',prices:{BTC:120,QQQ:100,XAU:100}},{date:'2026-10-01',prices:{BTC:100,QQQ:100,XAU:100}},{date:'2026-10-08',prices:{BTC:90,QQQ:110,XAU:100}}];
 const value=frameReturns(rows,frames[3]);assert.equal(value.first,'2026-10-01');assert.equal(value.anchor,'2026-09-30');assert.equal(value.last,'2026-10-08');assert.ok(Math.abs(value.returns.BTC+25)<1e-10);assert.equal(value.returns.XAU,0);
});
test('lagging gold does not suppress the newest BTC and equity review',()=>{
 const rows=Array.from({length:25},(_,i)=>({date:new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),close:100+i}));
 const s={QQQ:rows,BTC:rows.map(r=>({...r,close:r.close*2})),XAU:rows.slice(0,-2)};
 const r=executionReview(s);assert.equal(r.date,rows.at(-1).date);assert.equal(r.price,248);assert.equal(r.relative,0);
 assert.equal(assetPeriods(s.XAU).date,rows.at(-3).date);assert.equal(assetPeriods(s.BTC).close,248);
});
test('comparable-session returns exclude weekend prices instead of mixing return horizons',()=>{
 const rows=points([['2026-10-02',100],['2026-10-03',1000],['2026-10-05',110]]);
 const r=assetPeriods(rows,['2026-10-02','2026-10-05']);assert.equal(r.date,'2026-10-05');assert.ok(Math.abs(r.returns[1]-10)<1e-10);
});
test('invalid prices cannot establish a baseline and missing common observations fail explicitly',()=>{
 const bad={QQQ:points([['2025-10-31',NaN]]),BTC:points([['2025-10-31',0]]),XAU:points([['2025-10-31',10]])};assert.throws(()=>compareSeries(bad,'2025-11-01'),/No common/);
 const empty=Object.fromEntries(['QQQ','BTC','XAU'].map(s=>[s,points([['2025-10-31',100]])]));assert.throws(()=>compareSeries(empty,'2025-11-01'),/No shared/);
});
