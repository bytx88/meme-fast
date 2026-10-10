import test from 'node:test';
import assert from 'node:assert/strict';
import {fedPolicyMove,factorChanges,overviewEvidence,triggerReads,horizonReads,reviewChanges,restoreDeskCache,deskStamp} from '../dist/macro-desk.mjs';
const report={collectedAt:'2026-10-10T12:00:00Z',feeds:Object.fromEntries(['BTC','QQQ','XAU','YIELD','BRENT','SPOT','FUNDING'].map(k=>[k,{status:'ok',latestDate:'2026-10-09'}])),drivers:{},positioning:{},series:Object.fromEntries(['BTC','QQQ','XAU'].map(s=>[s,[{date:'2026-10-09',close:100}]]))};
const a={asOf:'2026-10-10',date:'2026-10-09',priceFresh:true,phase:'Range',referenceHigh:110,low:90,accepted:false,q:{value:-2},spotFresh:true,fundFresh:true};
test('Fed reversal context applies only to the verified September hike and retains its date through holds',()=>{
 const rows=[{date:'2026-07-29',low:3.5,high:3.75},{date:'2026-09-16',low:3.75,high:4}];
 assert.equal(fedPolicyMove(rows).label,'+25 bp hike');assert.equal(fedPolicyMove(rows).context,'First hike since 2023');
 rows.push({date:'2026-10-28',low:3.75,high:4});assert.equal(fedPolicyMove(rows).date,'2026-09-16');
 rows.push({date:'2026-12-09',low:4,high:4.25});assert.equal(fedPolicyMove(rows).context,'Last observed policy change');
 assert.equal(fedPolicyMove([rows[0]]),null);
});
test('factor comparisons require matching fresh scopes and distinct source dates',()=>{
 const old={observations:{ETF:{date:'2026-10-08',value:-10,fresh:true,scope:'TFTC'},OI:{date:'2026-10-08',value:100,fresh:true,scope:'OKX'}}};
 const next={oi5:-2,oiPrice:-3,observations:{ETF:{date:'2026-10-09',value:20,fresh:true,scope:'TFTC'},OI:{date:'2026-10-09',value:95,fresh:true,scope:'OKX'}}};
 const rows=factorChanges(next,old);assert.equal(rows.find(r=>r.label==='ETF daily flow').delta,'+30.00 $m');assert.equal(rows.find(r=>r.label==='Open interest').delta,'-5.00%');assert.match(rows.find(r=>r.label==='Open interest').interpretation,/possible unwind/);
 next.observations.ETF.scope='Farside';assert.equal(factorChanges(next,old).find(r=>r.label==='ETF daily flow').previousDate,null);
 next.observations.OI.fresh=false;assert.equal(factorChanges(next,old).find(r=>r.label==='Open interest').direction,'Unmeasured');
 assert.equal(factorChanges(next,null).length,9);
});
test('decision thresholds specify close-based triggers and switch at acceptance',()=>{
 assert.match(triggerReads(a).up,/Daily close above/);assert.match(triggerReads(a).down,/Daily close below/);
 assert.match(triggerReads({...a,accepted:true}).down,/at \/ below.*acceptance lost/);
 assert.match(triggerReads({...a,low:null}).down,/unavailable/);
 assert.match(triggerReads({...a,priceFresh:false}).up,/withheld/);
});
test('near-term pressure coexists with observed acceptance and a conditional long thesis',()=>{
 const r=horizonReads({...a,accepted:true},report);assert.equal(r[0].state,'Relative pressure');assert.equal(r[1].state,'Acceptance observed');assert.equal(r[2].tone,'awaiting');
 assert.equal(horizonReads({...a,priceFresh:false},report)[0].state,'Unmeasured');
});
test('review comparison distinguishes first session and missing evidence from unchanged',()=>{
 assert.equal(reviewChanges(a,null,report).baseline,null);
 const old={...a,date:'2026-10-08',spotBuyShare5:48,fundingRate:.0001},next={...a,spotBuyShare5:50,fundingRate:.0002};
 const changes=reviewChanges(next,old,report);assert.ok(changes.items.some(i=>i.label==='Spot buy share'&&i.value==='+2.00 pp'));assert.ok(changes.items.some(i=>i.label==='Funding / payment'&&i.value==='+1.00 bp'));
 const missing=reviewChanges({...next,spotFresh:false,fundFresh:false},old,{...report,feeds:{}});assert.equal(missing.items.length,0);assert.match(missing.message,/incomplete/);
});
test('cache restoration rejects corrupt inputs and preserves last-successful dates',()=>{
 assert.deepEqual(restoreDeskCache(JSON.stringify({version:1,report})),report);assert.equal(restoreDeskCache('{bad'),null);assert.equal(restoreDeskCache(JSON.stringify({version:1,report:{...report,series:{}}})),null);
 assert.equal(deskStamp(report,'QQQ').date,'2026-10-09');
});

test('first-screen evidence explains the phase without treating missing demand as support',()=>{
 assert.deepEqual(overviewEvidence({...a,spotBuyShare5:48},report),['Range intact','BTC lags QQQ','Spot sellers lead']);
 assert.equal(overviewEvidence({...a,low:null},report)[0],'Structure unavailable');
 assert.equal(horizonReads({...a,phase:'Assessment withheld'},report)[1].state,'Unmeasured');
 assert.match(triggerReads({...a,phase:'Assessment withheld'}).up,/withheld/);
 assert.deepEqual(overviewEvidence({...a,priceFresh:false,spotFresh:false},report),['Price unavailable','Leadership unavailable','Spot demand unavailable']);
});
