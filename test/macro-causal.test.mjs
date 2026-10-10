import test from 'node:test';
import assert from 'node:assert/strict';
import {causalNodes,causalEdges,causalPositions} from '../dist/macro-causal.mjs';
const dates=['2026-10-02','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'];
const report={series:Object.fromEntries(['QQQ','BTC','XAU'].map(k=>[k,dates.map((date,i)=>({date,close:100+i}))])),drivers:{FED:[{date:'2026-07-29',low:3.5,high:3.75},{date:'2026-09-16',low:3.75,high:4,sourceUrl:'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm'}],YIELD:dates.map((date,i)=>({date,close:5+i/100})),BRENT:dates.map((date,i)=>({date,close:100+i}))},positioning:{ETF:[{date:'2026-10-09',millionUsd:21,sourceUrl:'https://www.tftc.io/bitcoin-etf-flows'}]},feeds:Object.fromEntries(['QQQ','BTC','XAU','FED','YIELD','BRENT'].map(key=>[key,{status:'ok',latestDate:key==='FED'?'2026-09-16':'2026-10-09'}]))};
const a={asOf:'2026-10-10',flow5:-681,etfFresh:true,oiFresh:false};
test('unknown channels stay unmeasured despite measured ETF demand and policy change',()=>{
 const nodes=causalNodes(report,a);for(const id of ['WAR','CPI','QE','LIQUIDITY']){const n=nodes.find(n=>n.id===id);assert.equal(n.value,'Unmeasured');assert.equal(n.tone,'unmeasured');assert.equal(n.date,null);}
 const liq=nodes.find(n=>n.id==='LIQUIDITY');assert.match(liq.evidence[0].text,/\+\$21.0m.*-\$681.0m/);assert.match(liq.note,/cannot establish the global total/);
 assert.match(nodes.find(n=>n.id==='FED').note,/First hike since 2023/);
 assert.equal(nodes.find(n=>n.id==='XAU').tone,'mixed');
});
test('stale and failed channels retain dated levels without assigning observed support',()=>{
 const stale=causalNodes(report,{...a,asOf:'2027-01-20'});for(const id of ['FED','YIELD','BRENT','BTC','QQQ','XAU'])assert.equal(stale.find(n=>n.id===id).tone,'unmeasured');
 const failed=causalNodes({...report,feeds:{}},a);assert.equal(failed.find(n=>n.id==='BTC').tone,'unmeasured');assert.equal(failed.find(n=>n.id==='BTC').date,'2026-10-09');
 const empty=causalNodes({series:{},drivers:{},feeds:{},positioning:{}},a);assert.equal(empty.length,10);assert.equal(empty.find(n=>n.id==='FED').value,'Unavailable');
});
test('the authored graph separates asset responses and makes market-yield links conditional',()=>{
 for(const edge of causalEdges){assert.ok(causalPositions[edge.from]);assert.ok(causalPositions[edge.to]);assert.ok(edge.effect.length>20);}
 assert.equal(causalEdges.find(e=>e.from==='FED'&&e.to==='YIELD').kind,'conditional');
 assert.ok(causalEdges.some(e=>e.from==='LIQUIDITY'&&e.to==='QQQ'));assert.ok(causalEdges.some(e=>e.from==='LIQUIDITY'&&e.to==='BTC'));
 assert.ok(!causalEdges.some(e=>e.from==='QQQ'&&e.to==='BTC'));
 assert.match(causalEdges.find(e=>e.from==='YIELD'&&e.to==='XAU').effect,/real yields/);
});
