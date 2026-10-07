import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SCREENER,normalizeScreener,passesScreener,passesLaneScreener,lifetimeTransactions} from '../dist/coin-screener.mjs';

test('24h volume starts at $15,000 and unavailable volume does not pass',()=>{
 const settings=normalizeScreener();
 assert.deepEqual(settings,DEFAULT_SCREENER);
 assert.equal(passesScreener({volume:14999},settings),false);
 assert.equal(passesScreener({volume:15000},settings),true);
 assert.equal(passesScreener({volume:null},settings),false);
});

test('other minimums and chain filter apply together; zero disables minimums',()=>{
 const settings=normalizeScreener({volume24h:0,liquidity:3000,volume5m:500,transactions5m:10,chain:'base'});
 const coin={network:'base',volume:null,liquidity:3000,volume5m:500,buys5m:6,sells5m:4};
 assert.equal(passesScreener(coin,settings),true);
 assert.equal(passesScreener({...coin,sells5m:3},settings),false);
 assert.equal(passesScreener({...coin,network:'solana'},settings),false);
 assert.equal(passesScreener({...coin,volume5m:null},settings),false);
});

test('invalid saved settings fall back to safe defaults',()=>{
 assert.deepEqual(normalizeScreener({volume24h:-1,liquidity:'oops',chain:'other'}),DEFAULT_SCREENER);
});
test('Robinhood Chain is available in Coin filters',()=>{
 const settings=normalizeScreener({chain:'robinhood',volume24h:0});
 assert.equal(settings.chain,'robinhood');
 assert.equal(passesScreener({network:'robinhood'},settings),true);
 assert.equal(passesScreener({network:'solana'},settings),false);
});

test('multiple chain selections persist and compose with lane thresholds',()=>{
 const settings=normalizeScreener({chain:['base','solana','base','unknown'],volume24h:0,lanes:{recovery:{liquidity:3000}}});
 assert.deepEqual(settings.chain,['base','solana']);
 assert.deepEqual(normalizeScreener(JSON.parse(JSON.stringify(settings))),settings);
 for(const network of ['base','solana']){
  assert.equal(passesLaneScreener({network,liquidity:3000},settings,'recovery'),true);
  assert.equal(passesLaneScreener({network,liquidity:2999},settings,'recovery'),false);
 }
 assert.equal(passesScreener({network:'robinhood',liquidity:3000},settings),false);
 const all=normalizeScreener({...settings,chain:[]});
 assert.equal(all.chain,'all');
 assert.equal(passesScreener({network:'robinhood'},all),true);
});

test('column minimums stay independent and combine with common filters',()=>{
 const settings=normalizeScreener({lanes:{newPairs:{liquidity:10000},recovery:{volume5m:500},graduation:{transactions5m:20}}});
 const coin={poolCreated:Date.now()-3600000,volume:20000,liquidity:5000,volume5m:600,buys5m:5,sells5m:5};
 assert.equal(passesLaneScreener(coin,settings,'newPairs'),false);
 assert.equal(passesLaneScreener(coin,settings,'recovery'),true);
 assert.equal(passesLaneScreener(coin,settings,'graduation'),false);
 assert.equal(passesLaneScreener({...coin,volume:1000},settings,'recovery'),false);
 assert.equal(passesLaneScreener({...coin,volume5m:null},settings,'recovery'),false);
 assert.equal(passesLaneScreener(coin,normalizeScreener({...settings,lanes:{}}),'newPairs'),true);
 assert.deepEqual(normalizeScreener({lanes:{recovery:{volume5m:-1,liquidity:'bad'}}}),DEFAULT_SCREENER);
 assert.deepEqual(normalizeScreener(JSON.parse(JSON.stringify(settings))),settings);
});

test('pool age uses inclusive seconds, rejecting missing and future timestamps',()=>{
 const now=1800000000000,settings=normalizeScreener({volume24h:0,poolAgeMinSeconds:30,poolAgeMaxSeconds:90});
 for(const seconds of [30,60,90])assert.equal(passesScreener({poolCreated:now-seconds*1000},settings,now),true);
 for(const seconds of [29.9,90.1])assert.equal(passesScreener({poolCreated:now-seconds*1000},settings,now),false);
 for(const poolCreated of [null,0,NaN,now+1000])assert.equal(passesScreener({poolCreated},settings,now),false);
 assert.equal(passesScreener({},normalizeScreener({volume24h:0}),now),true);
 const lanes=normalizeScreener({volume24h:0,lanes:{newPairs:{poolAgeMaxSeconds:60},recovery:{poolAgeMinSeconds:120}}});
 assert.equal(passesLaneScreener({poolCreated:now-60000},lanes,'newPairs',now),true);
 assert.equal(passesLaneScreener({poolCreated:now-60000},lanes,'recovery',now),false);
 assert.equal(passesLaneScreener({poolCreated:now-60000},lanes,'graduation',now),true);
 assert.deepEqual(normalizeScreener(JSON.parse(JSON.stringify(lanes))),lanes);
});

test('lifetime minimum uses full-lifetime counts for young pools and withholds rolling counts for older pools',()=>{
 const now=1800000000000,coin={poolCreated:now-3600000,buys:60,sells:40};
 const settings=normalizeScreener({volume24h:0,transactionsLifetime:100});
 assert.equal(lifetimeTransactions(coin,now),100);
 assert.equal(passesScreener(coin,settings,now),true);
 assert.equal(passesScreener({...coin,sells:39},settings,now),false);
 for(const change of [{sells:null},{buys:NaN},{buys:-1},{poolCreated:null},{poolCreated:now-86400000},{poolCreated:now+1}]){
  assert.equal(lifetimeTransactions({...coin,...change},now),null);
  assert.equal(passesScreener({...coin,...change},settings,now),false);
 }
 assert.equal(passesScreener({},normalizeScreener({volume24h:0}),now),true);
 const lanes=normalizeScreener({volume24h:0,lanes:{recovery:{transactionsLifetime:101}}});
 assert.equal(passesLaneScreener(coin,lanes,'recovery',now),false);
 assert.equal(passesLaneScreener(coin,lanes,'newPairs',now),true);
 assert.deepEqual(normalizeScreener(JSON.parse(JSON.stringify(lanes))),lanes);
});

test('New Pairs defaults to a 30-hour age cap, migrates missing values, and preserves explicit off',()=>{
 const now=1800000000000,settings=normalizeScreener({volume24h:0});
 assert.equal(settings.lanes.newPairs.poolAgeMaxSeconds,108000);
 assert.equal(normalizeScreener({lanes:{newPairs:{}}}).lanes.newPairs.poolAgeMaxSeconds,108000);
 assert.equal(passesLaneScreener({poolCreated:now-108000000},settings,'newPairs',now),true);
 assert.equal(passesLaneScreener({poolCreated:now-108001000},settings,'newPairs',now),false);
 assert.equal(passesLaneScreener({poolCreated:now-108001000},settings,'recovery',now),true);
 const off=normalizeScreener({volume24h:0,lanes:{newPairs:{poolAgeMaxSeconds:0}}});
 assert.equal(passesLaneScreener({},off,'newPairs',now),true);
 assert.deepEqual(normalizeScreener(JSON.parse(JSON.stringify(off))),off);
});
