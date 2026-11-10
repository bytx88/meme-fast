import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyze,change,sectors} from '../dist/stock-analysis.mjs';
import {rankingRows,rankingMarkup} from '../dist/stock-ranking.mjs';
const dates=Array.from({length:900},(_,i)=>new Date(Date.UTC(2024,6,1+i))).filter(d=>![0,6].includes(d.getUTCDay())).map(d=>d.toISOString().slice(0,10)).filter(d=>d<='2026-11-13');
const series=Object.fromEntries(['SPY',...Object.keys(sectors)].map((s,j)=>[s,dates.map((date,i)=>({date,close:100*(1+(j+1)*.0001)**i}))]));
const assess=(period,asOf='2026-11-01',input=series)=>analyze(input,period,asOf);
test('November 1 compares completed October with September, including month-end baselines',()=>{
 const m=assess('1M');assert.equal(m.date,'2026-10-30');assert.equal(m.start,'2026-09-30');assert.equal(m.windows.current.label,'Oct 2026');
 assert.deepEqual(m.windows.previous,{start:'2026-08-31',end:'2026-09-30',label:'Sep 2026'});
 const row=m.rows.find(r=>r.symbol==='XLE'),sessions=dates.indexOf(m.date)-dates.indexOf(m.start),priorSessions=dates.indexOf('2026-09-30')-dates.indexOf('2026-08-31');
 assert.ok(Math.abs(row.ret-(1.0002**sessions-1)*100)<1e-9);
 assert.ok(Math.abs(row.previousRet-(1.0002**priorSessions-1)*100)<1e-9);
 assert.ok(Math.abs(row.relative-(row.ret-m.benchmark))<1e-9);
 assert.ok(Math.abs(row.previousRelative-(row.previousRet-m.previousBenchmark))<1e-9);
});
test('partial November data cannot change completed October performance',()=>{
 const a=assess('1M'),b=assess('1M','2026-11-14');assert.equal(a.date,b.date);assert.deepEqual(a.rows.map(r=>r.ret),b.rows.map(r=>r.ret));
});
test('calendar periods roll across December and January',()=>{
 const m=assess('1M','2026-01-01');assert.equal(m.windows.current.label,'Dec 2025');assert.equal(m.start,'2025-11-28');assert.equal(m.date,'2025-12-31');assert.equal(m.windows.previous.label,'Nov 2025');
});
test('3M compares Aug–Oct against May–Jul on November 1',()=>{
 const m=assess('3M');assert.equal(m.start,'2026-07-31');assert.equal(m.date,'2026-10-30');assert.equal(m.windows.previous.start,'2026-04-30');assert.equal(m.windows.previous.end,'2026-07-31');
});
test('1D and 1W compare adjacent equal-length trading-session blocks',()=>{
 for(const [period,count] of [['1D',1],['1W',5]]){const m=assess(period);assert.equal(m.start,dates.at(-1-count));assert.equal(m.windows.previous.end,m.start);assert.equal(m.windows.previous.start,dates.at(-1-count*2))}
});
test('YTD compares the same number of sessions in the prior year',()=>{
 const m=assess('YTD');assert.equal(m.start,'2025-12-31');assert.equal(m.windows.previous.start,'2024-12-31');assert.equal(dates.indexOf(m.date)-dates.indexOf(m.start),dates.indexOf(m.windows.previous.end)-dates.indexOf(m.windows.previous.start));
 assert.equal(change([{date:'2026-01-02',close:1}],'YTD'),null);
});
test('missing sector month-end does not silently shorten a calendar month',()=>{
 const input={...series,XLK:series.XLK.filter(r=>r.date!=='2026-10-30')};assert.equal(assess('1M','2026-11-01',input),null);
});
test('unavailable previous month remains unknown while current month can display',()=>{
 const input=Object.fromEntries(Object.entries(series).map(([s,rows])=>[s,rows.filter(r=>r.date<='2026-08-01'||r.date>='2026-09-01')]));
 const m=assess('1M','2026-11-01',input);assert.ok(m);assert.equal(m.windows.previous,null);assert.ok(m.rows.every(r=>r.previousRet===null&&r.previousRelative===null));
});
test('rotation remains a rolling 21-session lens independent of calendar selections',()=>{
 const a=assess('1D'),b=assess('1M');for(const r of a.rows){const other=b.rows.find(x=>x.symbol===r.symbol);assert.equal(r.rs,other.rs);assert.equal(r.momentum,other.momentum)}
});
test('incomplete history cannot produce a market assessment',()=>assert.equal(assess('1M','2026-11-01',{...series,XLK:[]}),null));

test('additional assets use sector dates and show missing comparisons without changing sector counts',()=>{
 const input={...series,GLD:series.XLV,COPX:series.XLB,SOXX:series.XLK,IWM:series.XLF,
  SPCX:series.XLI.filter(r=>r.date>='2026-06-12'),BTCUSDT:[...series.SPY,{date:'2026-11-14',close:999}]};
 const quarter=assess('3M','2026-11-01',input),original=assess('3M');
 const spacex=quarter.rows.find(r=>r.symbol==='SPCX');
 assert.deepEqual(quarter.windows,original.windows);
 assert.equal(quarter.advancing,original.advancing);
 assert.equal(quarter.outperforming,original.outperforming);
 assert.ok(Number.isFinite(spacex.ret));
 assert.equal(spacex.previousRet,null);
 for(const symbol of ['GLD','COPX','SOXX','IWM','BTCUSDT']){
  assert.ok(Number.isFinite(quarter.rows.find(r=>r.symbol===symbol).previousRet));
 }
 const daily=assess('1D','2026-11-14',input);
 assert.equal(daily.date,'2026-11-13');
 assert.equal(daily.rows.find(r=>r.symbol==='BTCUSDT').relative,0);
 const ytd=assess('YTD','2026-11-01',input);
 const ranked=rankingRows(ytd.rows).find(r=>r.symbol==='SPCX');
 assert.equal(ranked.currentRank,null);
 assert.equal(ranked.change,null);
 assert.match(rankingMarkup(ytd,{view:'side'}),/data-sector="SPCX"/);
 assert.doesNotMatch(rankingMarkup(ytd,{view:'side'}),/NaN|undefined/);
});
