import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyRead,mountDailyRead} from '../dist/macro-daily.mjs';
const dates=['2026-05-29','2026-10-02','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'];
const report={series:Object.fromEntries(['QQQ','BTC','XAU'].map((k,j)=>[k,dates.map((date,i)=>({date,close:100+i*(j===1?-1:1)}))])),drivers:{YIELD:dates.map(date=>({date,close:5})),BRENT:dates.map(date=>({date,close:100}))},feeds:Object.fromEntries(['QQQ','BTC','XAU','YIELD','BRENT'].map(k=>[k,{status:'ok',latestDate:dates.at(-1)}]))};
const a={asOf:'2026-10-10',yield:{percentile:90,change5:0},oil:{percentile:80,change5:0}};
test('macro hurdle coexists with different observed asset responses',()=>{
 const [macro,oil,btc,gold]=dailyRead(report,a);
 assert.equal(macro.tone,'pressure');assert.equal(btc.value,'-1.05%');assert.equal(gold.value,'+0.95%');
 assert.equal(btc.readings[0],'$94.00 (-1.05%)');assert.equal(gold.readings[0],'$106.00 (+0.95%)');
 assert.match(macro.readings[0],/5.000% \(\+0.0 bp\)/);
 assert.match(btc.detail,/behind QQQ/);assert.match(gold.detail,/ahead of BTC/);
 assert.equal(gold.date,'2026-10-08 → 2026-10-09');
});
test('missing, failed or stale coverage cannot assign bearish interpretation',()=>{
 for(const r of [{...report,feeds:{}},report]){
  const rows=dailyRead(r,{...a,asOf:'2026-12-01'});assert.ok(rows.every(row=>row.tone==='unavailable'));
 }
 assert.equal(dailyRead({series:{},drivers:{},feeds:{}},a)[0].value,'Coverage incomplete');
 assert.doesNotThrow(()=>mountDailyRead(null).update(report,a));
});
test('daily card withholds a missing previous close independently',()=>{
 const r={...report,series:{...report.series,XAU:report.series.XAU.slice(-1)}};
 assert.equal(dailyRead(r,a)[3].value,'Response unavailable');
 assert.deepEqual(dailyRead(r,a)[3].readings,[]);
 assert.equal(dailyRead(r,a)[2].value,'-1.05%');
});
test('separate macro cards preserve independent directions and coverage',()=>{
 const changed={...report,drivers:{YIELD:report.drivers.YIELD.map((r,i)=>({...r,close:i===6?4.9:5})),BRENT:report.drivers.BRENT.map((r,i)=>({...r,close:i===6?102:100}))}};
 const rows=dailyRead(changed,{...a,yield:{percentile:50},oil:{percentile:50}});
 assert.equal(rows[0].detail,'Yields easing');assert.equal(rows[0].tone,'support');
 assert.equal(rows[1].detail,'Oil rising');assert.equal(rows[1].tone,'pressure');
 assert.equal(rows[0].date,'2026-10-08 → 2026-10-09');assert.equal(rows[1].date,'2026-10-08 → 2026-10-09');
 assert.match(rows[0].readings[0],/-10.0 bp/);assert.match(rows[1].readings[0],/\+2.00%/);
 const partial=dailyRead({...report,feeds:{...report.feeds,BRENT:{status:'failed'}}},a);
 assert.equal(partial[0].tone,'pressure');assert.equal(partial[1].tone,'unavailable');
});

test('daily BTC follows its own calendar without comparing a different asset window',()=>{
 const r={...report,series:{...report.series,BTC:[...report.series.BTC,{date:'2026-10-10',close:95}]}};
 const btc=dailyRead(r,a)[2];
 assert.equal(btc.value,'+1.06%');assert.equal(btc.date,'2026-10-09 → 2026-10-10');
 assert.match(btc.detail,/comparison with QQQ pending/);assert.match(btc.context,/1D/);
});

test('weekend gold observations cannot create a zero-return Sunday close',()=>{
 const r={...report,series:{...report.series,
  BTC:[...report.series.BTC,{date:'2026-10-10',close:95},{date:'2026-10-11',close:96}],
  XAU:[...report.series.XAU,{date:'2026-10-10',close:106},{date:'2026-10-11',close:106}]},
  feeds:{...report.feeds,BTC:{status:'ok',latestDate:'2026-10-11'},XAU:{status:'ok',latestDate:'2026-10-11'}}};
 const rows=dailyRead(r,{...a,asOf:'2026-10-12'}),gold=rows[3];
 assert.equal(gold.readings[0],'$106.00 (+0.95%)');
 assert.equal(gold.date,'2026-10-08 → 2026-10-09');
 assert.match(gold.detail,/ahead of BTC over these dates/);
 assert.match(gold.detail,/weekend observations excluded/);
 assert.match(gold.context,/GoldPrice.com.*USD\/oz.*not live/);
 assert.match(rows[2].detail,/comparison with gold pending/);
});

test('Monday gold compares Friday to Monday with matching BTC endpoints',()=>{
 const r={...report,series:{...report.series,
  BTC:[...report.series.BTC,{date:'2026-10-11',close:110},{date:'2026-10-12',close:95}],
  XAU:[...report.series.XAU,{date:'2026-10-11',close:106},{date:'2026-10-12',close:107}]},
  feeds:{...report.feeds,BTC:{status:'ok',latestDate:'2026-10-12'},XAU:{status:'ok',latestDate:'2026-10-12'}}};
 const gold=dailyRead(r,{...a,asOf:'2026-10-13'})[3];
 assert.equal(gold.date,'2026-10-09 → 2026-10-12');
 assert.match(gold.detail,/behind BTC over these dates/);
 assert.doesNotMatch(gold.detail,/weekend observations excluded/);
});

test('new weekend source dates do not make an old weekday gold close fresh',()=>{
 const r={...report,series:{...report.series,XAU:[...report.series.XAU,{date:'2026-10-17',close:106},{date:'2026-10-18',close:106}]},
  feeds:{...report.feeds,XAU:{status:'ok',latestDate:'2026-10-18'}}};
 const gold=dailyRead(r,{...a,asOf:'2026-10-19'})[3];
 assert.equal(gold.value,'Response unavailable');assert.deepEqual(gold.readings,[]);
});

test('equal weekday gold closes describe the reported observation',()=>{
 const r={...report,series:{...report.series,XAU:report.series.XAU.map(row=>({...row,close:106}))}};
 const gold=dailyRead(r,a)[3];
 assert.equal(gold.value,'+0.00%');assert.match(gold.detail,/No change in reported closes/);
 assert.doesNotMatch(gold.detail,/Gold unchanged/);
});
