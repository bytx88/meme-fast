import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCausalMap,causalNodes,causalEdges,causalPositions,causalPath,marketResponse,responseSummary} from '../dist/macro-causal.mjs';
const dates=['2026-10-02','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'];
const report={series:Object.fromEntries(['QQQ','BTC','XAU'].map(k=>[k,dates.map((date,i)=>({date,close:100+i}))])),drivers:{FED:[{date:'2026-07-29',low:3.5,high:3.75},{date:'2026-09-16',low:3.75,high:4,sourceUrl:'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm'}],YIELD:dates.map((date,i)=>({date,close:5+i/100})),BRENT:dates.map((date,i)=>({date,close:100+i}))},positioning:{ETF:[{date:'2026-10-09',millionUsd:21,sourceUrl:'https://www.tftc.io/bitcoin-etf-flows'}]},feeds:Object.fromEntries(['QQQ','BTC','XAU','FED','YIELD','BRENT'].map(key=>[key,{status:'ok',latestDate:key==='FED'?'2026-09-16':'2026-10-09'}]))};
const a={asOf:'2026-10-10',flow5:-681,etfFresh:true,oiFresh:false};
test('a cached page without the new section can still render the existing dashboard',()=>{
 assert.doesNotThrow(()=>mountCausalMap(null).update(report,a));
});
test('unknown channels stay unmeasured despite measured ETF demand and policy change',()=>{
 const nodes=causalNodes(report,a);for(const id of ['WAR','CPI','QE']){const n=nodes.find(n=>n.id===id);assert.equal(n.value,'Unmeasured');assert.equal(n.tone,'unmeasured');assert.equal(n.date,null);}
 const liq=nodes.find(n=>n.id==='QE');assert.match(liq.evidence[0].text,/\+\$21.0m.*-\$681.0m/);assert.match(liq.note,/cannot establish the global total/);
 assert.match(nodes.find(n=>n.id==='FED').note,/First hike since 2023/);
 assert.equal(nodes.find(n=>n.id==='XAU').tone,'mixed');
});
test('stale and failed channels retain dated levels without assigning observed support',()=>{
 const stale=causalNodes(report,{...a,asOf:'2027-01-20'});for(const id of ['FED','YIELD','BRENT','BTC','QQQ','XAU'])assert.equal(stale.find(n=>n.id===id).tone,'unmeasured');
 const failed=causalNodes({...report,feeds:{}},a);assert.equal(failed.find(n=>n.id==='BTC').tone,'unmeasured');assert.equal(failed.find(n=>n.id==='BTC').date,'2026-10-09');
 const empty=causalNodes({series:{},drivers:{},feeds:{},positioning:{}},a);assert.equal(empty.length,9);assert.equal(empty.find(n=>n.id==='FED').value,'Unavailable');
});
test('the authored graph separates asset responses and makes market-yield links conditional',()=>{
 for(const edge of causalEdges){assert.ok(causalPositions[edge.from]);assert.ok(causalPositions[edge.to]);assert.ok(edge.effect.length>20);}
 assert.equal(causalEdges.find(e=>e.from==='FED'&&e.to==='YIELD').kind,'conditional');
 assert.ok(causalEdges.some(e=>e.from==='QE'&&e.to==='QQQ'));assert.ok(causalEdges.some(e=>e.from==='QE'&&e.to==='BTC'));
 assert.ok(!causalEdges.some(e=>e.from==='QQQ'&&e.to==='BTC'));
 assert.match(causalEdges.find(e=>e.from==='YIELD'&&e.to==='XAU').effect,/real yields/);
});

test('Fed traces ancestors and descendants without unrelated liquidity branches',()=>{
 const p=causalPath('FED');assert.deepEqual([...p.vertices].sort(),['BRENT','BTC','CPI','FED','QQQ','WAR','XAU','YIELD']);
 assert.ok(!p.edges.has(causalEdges.findIndex(e=>e.from==='WAR'&&e.to==='XAU')));
 assert.ok(p.edges.has(causalEdges.findIndex(e=>e.from==='YIELD'&&e.to==='XAU')));
});
test('asset responses align endpoints and do not bridge missing windows',()=>{
 const r={...report,series:{...report.series,XAU:report.series.XAU.slice(0,-1)}};
 const window=marketResponse(r,1);assert.equal(window.date,'2026-10-08');assert.equal(window.start,'2026-10-07');
 assert.equal(window.values.BTC.close,104);assert.equal(marketResponse(r,5).start,undefined);
 assert.match(responseSummary(r,a.asOf,20),/insufficient/);
 assert.match(responseSummary({...r,feeds:{}},a.asOf,1),/delayed/);
});
test('monthly CPI and weekly US balances retain scope and independent freshness',()=>{
 const r={...report,drivers:{...report.drivers,CPI:[{date:'2026-08-31',period:'2026-08',yoy:3.4,mom:.4}],H41:[{date:'2026-10-07',securities:6465328,securitiesChange:2581,reserves:3029659,reservesChange:81569,tga:880253,tgaChange:-68421,rrp:329526,rrpChange:266}]},feeds:{...report.feeds,CPI:{status:'ok',latestDate:'2026-08-31'},H41:{status:'ok',latestDate:'2026-10-07'}}};
 const nodes=causalNodes(r,a);assert.equal(nodes.find(n=>n.id==='CPI').value,'3.4% YoY');assert.equal(nodes.find(n=>n.id==='QE').value,'Held $6.465tn');assert.equal(nodes.find(n=>n.id==='QE').trend,'Reserves $3.030tn');assert.match(nodes.find(n=>n.id==='QE').evidence[1].text,/TGA.*reverse repos/);assert.match(nodes.find(n=>n.id==='QE').note,/does not establish/);assert.match(nodes.find(n=>n.id==='QE').note,/global liquidity remains unmeasured/i);
 assert.equal(causalNodes(r,{...a,asOf:'2026-10-25'}).find(n=>n.id==='CPI').tone,'unmeasured');
});

test('equal aligned returns are described as matching',()=>assert.match(responseSummary(report,a.asOf,5),/matching QQQ; matching gold/));
