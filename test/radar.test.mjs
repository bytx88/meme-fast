import test from 'node:test';
import assert from 'node:assert/strict';
import {radarReading,rankRadar} from '../dist/radar-model.mjs';

const now=1800000000000;
const coin=(extra={})=>({id:'solana:ABC',network:'solana',symbol:'ABC',contract_address:'ABC',poolCreated:now-86400000,
 marketUpdatedAt:now,liquidity:50000,volume5m:5000,volume:150000,buys5m:30,sells5m:10,...extra});

test('scalp ranking explains missing acceleration and does not treat it as zero',()=>{
 const result=radarReading(coin(),'scalp',now);
 assert.equal(result.stale,false);
 assert.equal(result.coverage,80);
 assert.equal(result.parts.at(-1).value,null);
 assert.ok(result.score>50);
});
test('fresh readings sort ahead of stale readings and no-score readings',()=>{
 const stale=coin({id:'stale',marketUpdatedAt:now-3600000});
 const fresh=coin({id:'fresh',volume5m:1000,buys5m:5,sells5m:5});
 const empty=coin({id:'empty',liquidity:null,volume5m:null,volume:null,buys5m:null,sells5m:null});
 assert.deepEqual(rankRadar([stale,empty,fresh],'scalp',now).map(row=>row.coin.id),['fresh','empty','stale']);
});
test('swing and longer-term readings wait for enough observed history',()=>{
 const early=coin({marketHistory:[{at:now,volume5m:5000,buys5m:30,sells5m:10}],marketHistoryHourly:[{at:now,volume5m:5000,buys5m:30,sells5m:10}]});
 const swing=radarReading(early,'swing',now),research=radarReading(early,'research',now);
 assert.equal(swing.parts.find(part=>part.label==='Repeated activity').value,null);
 assert.equal(research.parts.find(part=>part.label==='Day persistence').value,null);
 assert.equal(research.parts.find(part=>part.label==='Observed history').value,null);
 assert.equal(swing.score,null);
 assert.equal(research.score,null);
});
test('repeated market samples and exact contract context contribute to horizon-specific readings',()=>{
 const recent=Array.from({length:12},(_,index)=>({at:now-(11-index)*5*60000,volume5m:1500,buys5m:12,sells5m:4}));
 const hourly=Array.from({length:25},(_,index)=>({at:now-(24-index)*3600000,volume5m:1500,buys5m:12,sells5m:4}));
 const observed=coin({marketHistory:recent,marketHistoryHourly:hourly,savedContext:{kind:'verified'}});
 assert.equal(radarReading(observed,'swing',now).parts.find(part=>part.label==='Repeated activity').value,1);
 assert.equal(radarReading(observed,'research',now).parts.find(part=>part.label==='Day persistence').value,1);
 assert.equal(radarReading(observed,'research',now).parts.find(part=>part.label==='Context').value,1);
});
