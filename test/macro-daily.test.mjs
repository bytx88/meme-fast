import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyRead,mountDailyRead} from '../dist/macro-daily.mjs';
const dates=['2026-10-02','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'];
const report={series:Object.fromEntries(['QQQ','BTC','XAU'].map((k,j)=>[k,dates.map((date,i)=>({date,close:100+i*(j===1?-1:1)}))])),drivers:{YIELD:dates.map(date=>({date,close:5})),BRENT:dates.map(date=>({date,close:100}))},feeds:Object.fromEntries(['QQQ','BTC','XAU','YIELD','BRENT'].map(k=>[k,{status:'ok',latestDate:dates.at(-1)}]))};
const a={asOf:'2026-10-10',yield:{percentile:90,change5:0},oil:{percentile:80,change5:0}};
test('macro hurdle coexists with different observed asset responses',()=>{
 const [macro,btc,gold]=dailyRead(report,a);
 assert.equal(macro.tone,'pressure');assert.equal(btc.value,'-5.00%');assert.equal(gold.value,'+5.00%');
 assert.match(btc.detail,/underperforming/);assert.match(gold.detail,/ahead of BTC/);
 assert.equal(gold.date,'2026-10-02 → 2026-10-09');
});
test('missing, failed or stale coverage cannot assign bearish interpretation',()=>{
 for(const r of [{...report,feeds:{}},report]){
  const rows=dailyRead(r,{...a,asOf:'2026-12-01'});assert.ok(rows.every(row=>row.tone==='unavailable'));
 }
 assert.equal(dailyRead({series:{},drivers:{},feeds:{}},a)[0].value,'Coverage incomplete');
 assert.doesNotThrow(()=>mountDailyRead(null).update(report,a));
});
test('asset comparison withholds an incomplete aligned window',()=>{
 const r={...report,series:{...report.series,XAU:report.series.XAU.slice(0,-1)}};
 assert.equal(dailyRead(r,a)[1].value,'Response unavailable');
});
test('competing macro moves are mixed and preserve independent source dates',()=>{
 const rows=dailyRead(report,{...a,yield:{percentile:50,significant:true,change5:-.1},oil:{percentile:50,significant:true,change5:2}});
 assert.equal(rows[0].value,'Mixed directions');assert.equal(rows[0].tone,'neutral');
 assert.match(rows[0].date,/Yield 2026-10-09 · Oil 2026-10-09/);
});
