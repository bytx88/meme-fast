import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assess,rotationRows,driverContext,catalystSelection,ratioReturn} from '../dist/macro-analysis.mjs';
const day=i=>new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10);
function fixture(){
 const btc=Array.from({length:35},(_,i)=>({date:day(i),open:100,high:105,low:95,close:100}));
 const series={BTC:btc,QQQ:btc.map(r=>({date:r.date,close:100})),XAU:btc.map(r=>({date:r.date,close:100}))};
 const feeds=Object.fromEntries(['BTC','QQQ','XAU','OI','FUNDING','ETF'].map(k=>[k,{status:'ok',latestDate:day(34)}]));
 return {series,feeds,drivers:{},positioning:{FUNDING:Array.from({length:30},()=>({date:day(34),rate:0.0001})),ETF:Array.from({length:5},(_,i)=>({date:day(30+i),millionUsd:10}))}};
}
test('a direct advance can qualify without inventing a prior reset',()=>{
 const r=fixture();r.series.BTC[33]={...r.series.BTC[33],high:111,close:110};r.series.BTC[34]={...r.series.BTC[34],high:113,close:112};
 const a=assess(r,day(34));assert.equal(a.phase,'Expansion evidence');assert.equal(a.checks[0].status,'pending');assert.equal(a.accepted,true);
});
test('price acceptance cannot substitute for missing ETF evidence or a failed source',()=>{
 const r=fixture();r.series.BTC[33].close=110;r.series.BTC[33].high=111;r.series.BTC[34].close=112;r.series.BTC[34].high=113;r.feeds.ETF.status='error';
 const a=assess(r,day(34));assert.equal(a.phase,'Price acceptance / confirmation incomplete');assert.equal(a.checks[3].status,'unknown');
 r.feeds.BTC.latestDate=day(28);assert.equal(assess(r,day(34)).phase,'Assessment withheld');
});
test('missing funding or differently dated leadership cannot qualify full expansion',()=>{
 const r=fixture();r.series.BTC[33]={...r.series.BTC[33],high:111,close:110};r.series.BTC[34]={...r.series.BTC[34],high:113,close:112};
 r.feeds.FUNDING.status='error';assert.equal(assess(r,day(34)).phase,'Price acceptance / confirmation incomplete');
 r.feeds.FUNDING.status='ok';r.series.XAU.pop();assert.equal(assess(r,day(34)).phase,'Price acceptance / confirmation incomplete');
});
test('spot participation is a scoped alternative channel, not an inferred ETF flow',()=>{
 const r=fixture();r.feeds.ETF.status='error';r.feeds.SPOT={status:'ok',latestDate:day(34)};
 r.positioning.SPOT=Array.from({length:5},(_,i)=>({date:day(30+i),buy:60,sell:40}));
 r.series.BTC[33]={...r.series.BTC[33],high:111,close:110};r.series.BTC[34]={...r.series.BTC[34],high:113,close:112};
 const a=assess(r,day(34));assert.equal(a.phase,'Expansion evidence');assert.equal(a.spotBuyShare5,60);assert.equal(a.etfFresh,false);assert.match(a.summary,/one exchange/);
 r.positioning.SPOT.pop();assert.equal(assess(r,day(34)).phase,'Price acceptance / confirmation incomplete');
});
test('daily absorption candidates require same-date sell imbalance and actual venue price response',()=>{
 const r=fixture();r.feeds.SPOT=r.feeds.SPOT_PRICE={status:'ok',latestDate:day(34)};
 r.positioning.SPOT=[{date:day(34),buy:40,sell:60}];r.positioning.SPOT_PRICE=[{date:day(33),low:90,close:95},{date:day(34),low:91,close:96}];
 assert.equal(assess(r,day(34)).absorptionCandidate,true);
 r.positioning.SPOT_PRICE[1].low=89;assert.equal(assess(r,day(34)).absorptionCandidate,false);
});
test('acceptance retains its original range through a held pullback and fails on a close back inside',()=>{
 const r=fixture();
 for(const [i,c] of [[29,110],[30,112],[31,109],[32,108],[33,107],[34,106]])r.series.BTC[i]={...r.series.BTC[i],close:c,high:c+1,low:i>30?104:95};
 const a=assess(r,day(34));assert.equal(a.accepted,true);assert.equal(a.referenceHigh,105);assert.equal(a.acceptance.retest,day(31));assert.equal(a.phase,'Price acceptance / confirmation incomplete');
 r.series.BTC.at(-1).close=104;const b=assess(r,day(34));assert.equal(b.accepted,false);assert.equal(b.phase,'Reclaim acceptance lost');
});
test('a wick recovery is a candidate; insufficient OHLC cannot establish a sweep',()=>{
 const r=fixture();r.series.BTC[32].low=90;
 assert.equal(assess(r,day(34)).phase,'Sweep-and-recovery candidate');
 delete r.series.BTC[20].high;assert.equal(assess(r,day(34)).phase,'Assessment withheld');
 const gap=fixture();gap.series.BTC.splice(20,1);assert.equal(assess(gap,day(34)).phase,'Assessment withheld');
});
test('USD OI contraction from price alone does not establish position clearing',()=>{
 const r=fixture();r.series.BTC[29].close=110;
 r.positioning.OI=Array.from({length:6},(_,i)=>({date:day(29+i),btc:100+i,usd:11000-i*300}));
 const a=assess(r,day(34));assert.ok(a.oi5>0);assert.ok(a.oiPrice<0);assert.equal(a.clearing,false);
 r.positioning.OI.at(-1).btc=90;assert.equal(assess(r,day(34)).clearing,true);
});
test('a significant macro move depends on scale, not direction alone',()=>{
 const rows=Array.from({length:65},(_,i)=>({date:day(i),close:100+(i%2?2:-2)}));
 rows.at(-6).close=100;rows.at(-1).close=100.1;assert.equal(driverContext(rows).significant,false);
 rows.at(-1).close=130;assert.equal(driverContext(rows).significant,true);
});
test('leadership uses price ratios and starts at zero rather than an old cumulative baseline',()=>{
 const rows=[{date:day(0),prices:{BTC:100,QQQ:100,XAU:100}},{date:day(1),prices:{BTC:110,QQQ:120,XAU:100}}];
 const r=rotationRows(rows);assert.equal(r[0].returns.QQQ,0);assert.ok(Math.abs(r[1].returns.QQQ+8.3333333333)<1e-8);assert.ok(Math.abs(r[1].returns.XAU-10)<1e-8);
});
test('gold leadership excludes weekend observations and requires matching comparison endpoints',()=>{
 const dates=['2026-10-01','2026-10-02','2026-10-03','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'];
 const rows=dates.map((date,i)=>({date,close:100+i})),series={BTC:rows,QQQ:rows.filter(r=>r.date!=='2026-10-03'),XAU:rows.map(r=>({...r,close:r.date==='2026-10-03'?999:100}))};
 const q=ratioReturn(series,'BTC','QQQ'),g=ratioReturn(series,'BTC','XAU',5,series.QQQ.map(r=>r.date));assert.equal(q.start,g.start);assert.equal(g.start,'2026-10-02');assert.ok(Math.abs(g.value-100*(107/101-1))<1e-10);
});
test('news avoids irrelevant crime stories and duplicate leads within a channel',()=>{
 const news=[{title:'Bitcoin operator sentenced',topic:'Price',publishedAt:'2026-10-09'},{title:'Iran pause',topic:'Energy',publishedAt:'2026-10-08'},{title:'Iran second headline',topic:'Energy',publishedAt:'2026-10-07'},{title:'ETF flows',topic:'Flows',publishedAt:'2026-10-06'}];
 assert.deepEqual(catalystSelection(news).map(r=>r.title),['Iran pause','ETF flows']);
});
