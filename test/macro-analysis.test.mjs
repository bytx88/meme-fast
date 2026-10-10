import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assess,rotationRows,driverContext,catalystSelection} from '../dist/macro-analysis.mjs';
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
test('news avoids irrelevant crime stories and duplicate leads within a channel',()=>{
 const news=[{title:'Bitcoin operator sentenced',topic:'Price',publishedAt:'2026-10-09'},{title:'Iran pause',topic:'Energy',publishedAt:'2026-10-08'},{title:'Iran second headline',topic:'Energy',publishedAt:'2026-10-07'},{title:'ETF flows',topic:'Flows',publishedAt:'2026-10-06'}];
 assert.deepEqual(catalystSelection(news).map(r=>r.title),['Iran pause','ETF flows']);
});
