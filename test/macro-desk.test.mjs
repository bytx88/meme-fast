import test from 'node:test';
import assert from 'node:assert/strict';
import {triggerReads,horizonReads,reviewChanges,restoreDeskCache,deskStamp} from '../dist/macro-desk.mjs';
const report={collectedAt:'2026-10-10T12:00:00Z',feeds:Object.fromEntries(['BTC','QQQ','XAU','YIELD','BRENT','SPOT','FUNDING'].map(k=>[k,{status:'ok',latestDate:'2026-10-09'}])),drivers:{},positioning:{},series:Object.fromEntries(['BTC','QQQ','XAU'].map(s=>[s,[{date:'2026-10-09',close:100}]]))};
const a={asOf:'2026-10-10',date:'2026-10-09',priceFresh:true,phase:'Range',referenceHigh:110,low:90,accepted:false,q:{value:-2},spotFresh:true,fundFresh:true};
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
