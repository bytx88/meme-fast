import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePostMigration,evaluateLaterRecovery,outcomeCoverage,POST_MIGRATION_WINDOW_MS} from '../dist/post-migration.mjs';
import {updateMigrationStates,backfillPriceHistory,selectPriceBackfills} from '../worker/coin-collector.mjs';

const start=1000000000;
const sample=(minute,priceUsd)=>({at:start+minute*60000,priceUsd});
const coin=(prices)=>({id:'solana:test',graduationObservedAt:start,launchpad:{completed:true},marketHistory:prices.map((price,index)=>sample(index*5,price))});

test('a 78 percent fall from the observed peak is flagged even after an earlier recovery',()=>{
 const result=evaluatePostMigration(coin([1,1.5,2,0.4]),start+15*60000);
 assert.equal(result.state,'rugged');
 assert.ok(result.drawdown>=0.78);
 const [flagged]=updateMigrationStates([coin([1,1.5,2,0.4])],start+15*60000);
 assert.equal(flagged.ruggedAt,start+15*60000);
 assert.equal(updateMigrationStates([flagged],start+30*60000)[0].ruggedAt,flagged.ruggedAt);
});

test('a sub-78-percent retrace needs two five-minute recovery samples',()=>{
 const prices=[1,1.1,1.2,0.8,0.9,1];
 assert.equal(evaluatePostMigration(coin(prices.slice(0,5)),start+20*60000),null);
 assert.equal(evaluatePostMigration(coin(prices),start+25*60000),null);
 const result=evaluatePostMigration(coin(prices),start+30*60000);
 assert.equal(result.state,'sustained');
 assert.equal(result.scenario,'recovery');
 assert.equal(updateMigrationStates([coin(prices)],start+30*60000)[0].sustainedAt,start+25*60000);
});

test('a later retrace retains the observed early success and also flags a deep fall',()=>{
 const [sustained]=updateMigrationStates([coin([1,1.5,2,0.8,0.9,1])],start+30*60000);
 const [weakened]=updateMigrationStates([{...sustained,...coin([1,1.5,2,0.8,0.9,1,0.5]),priceUpdatedAt:start+30*60000}],start+30*60000);
 assert.equal(weakened.sustainedAt,sustained.sustainedAt);
 const [rugged]=updateMigrationStates([{...weakened,...coin([1,1.5,2,0.8,0.9,1,0.5,0.4])}],start+35*60000);
 assert.equal(rugged.rugDrawdownPercent,80);
});

test('scenario B confirms strong continuation without requiring a pullback',()=>{
 const rising=coin([1,1.1,1.2,1.3,1.4,1.5,1.6]);
 assert.equal(evaluatePostMigration(rising,start+30*60000).scenario,'continuation');
 const [confirmed]=updateMigrationStates([rising],start+30*60000);
 assert.equal(confirmed.successScenario,'continuation');
 assert.equal(updateMigrationStates([confirmed],start+7*3600000)[0].sustainedAt,confirmed.sustainedAt);
});

test('scenario B also works from pool creation when launchpad completion is unavailable',()=>{
 const launched={id:'solana:new',poolCreated:start,marketHistory:[1,1.1,1.2,1.3,1.4,1.5,1.6].map((price,index)=>sample(index*5,price))};
 assert.equal(evaluatePostMigration(launched,start+30*60000).scenario,'continuation');
});

test('an early continuation remains a success after a later pullback in the 45-minute window',()=>{
 const launched={id:'solana:toe',poolCreated:start,marketHistory:[1,1.7,1.75,1.4,1.9,1.3,1,0.9,1.45,1.1].map((price,index)=>sample(index*5,price))};
 const result=evaluatePostMigration(launched,start+45*60000);
 assert.equal(result.scenario,'continuation');
 assert.equal(result.at,start+10*60000);
});

test('later recovery is checked after six hours and can follow a deep drawdown',()=>{
 const late={...coin([]),marketHistoryHourly:[sample(0,1),sample(60,2),sample(120,0.2),sample(360,0.5),sample(420,0.6)]};
 assert.equal(evaluateLaterRecovery(late,start+6*3600000),null);
 assert.equal(evaluateLaterRecovery(late,start+7*3600000).state,'laterRecovery');
 const [confirmed]=updateMigrationStates([{...late,ruggedAt:start+120*60000}],start+7*3600000);
 assert.equal(confirmed.laterRecoveryPercent,200);
 const declined={...late,marketHistoryHourly:[...late.marketHistoryHourly,sample(480,0.25)]};
 assert.equal(evaluateLaterRecovery(declined,start+8*3600000).at,start+420*60000);
 assert.equal(updateMigrationStates([late],start+2*86400000)[0].laterRecoveryAt,start+420*60000);
});

test('a late price alone cannot backfill missing early evidence',()=>{
 const late={...coin([]),marketHistoryHourly:[sample(60,1),sample(120,0.2),sample(360,0.5),sample(420,0.6)]};
 assert.equal(evaluateLaterRecovery(late,start+7*3600000),null);
});

test('five-minute pool candles fill missing early prices and stay tied to their pool',async()=>{
 const launched={id:'solana:test',network:'solana',pool:'pool-A',poolCreated:start,volume:100,marketHistory:[]};
 const rows=[0,5,10,15,20,25,30,35,40].map((minute,index)=>[(start+minute*60000)/1000,1,1,1,1+index*0.1,1]);
 const [filled]=await backfillPriceHistory([launched],async()=>Response.json({data:{attributes:{ohlcv_list:rows}}}),start+45*60000);
 assert.equal(filled.priceHistory5m.length,9);
 assert.equal(filled.priceHistoryPool,'pool-A');
 assert.equal(evaluatePostMigration(filled,start+45*60000).scenario,'continuation');
 assert.equal(updateMigrationStates([filled],start+2*3600000)[0].successScenario,'continuation');
 assert.equal(evaluatePostMigration({...filled,pool:'pool-B'},start+45*60000).scenario,'continuation');
 assert.equal(selectPriceBackfills([filled],start+46*60000).length,0);
});

test('backfill uses the earliest liquid pool when the current pool is newer',async()=>{
 const launched={id:'solana:Ca',network:'solana',contract_address:'Ca',pool:'new-pool',poolCreated:start+3600000,firstSeen:start,volume:100};
 const urls=[];
 const fetcher=async url=>{
  urls.push(url);
  if(url.includes('dexscreener'))return Response.json({pairs:[{chainId:'solana',baseToken:{address:'Ca'},pairAddress:'old-pool',pairCreatedAt:start,liquidity:{usd:5000}}]});
  return Response.json({data:{attributes:{ohlcv_list:[0,5,10,15,20].map((minute,index)=>[(start+minute*60000)/1000,1,1,1,1+index*0.2,1])}}});
 };
 const [filled]=await backfillPriceHistory([launched],fetcher,start+2*3600000);
 assert.equal(filled.priceHistoryPool,'old-pool');
 assert.ok(urls.some(url=>url.includes('/pools/old-pool/')));
 assert.equal(updateMigrationStates([filled],start+2*3600000)[0].successScenario,'continuation');
});

test('the 45-minute outcome stays fixed after the observation window',()=>{
 const observed=coin([1,1.5,2,0.8,0.9,1,1,1,1]);
 assert.equal(evaluatePostMigration(observed,start+45*60000).state,'sustained');
 assert.equal(evaluatePostMigration(observed,start+60*60000).state,'sustained');
});

test('missing early prices cannot be classified from a late snapshot',()=>{
 const late={...coin([]),marketHistory:[sample(15,1),sample(20,1.2),sample(25,1.3),sample(30,1.4)]};
 assert.equal(evaluatePostMigration(late,start+30*60000),null);
 assert.equal(outcomeCoverage(late,POST_MIGRATION_WINDOW_MS,start+45*60000),'insufficient');
});
