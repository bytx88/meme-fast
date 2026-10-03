import test from 'node:test';
import assert from 'node:assert/strict';
import {stageFor,recoveryFor,graduationSplit,isUnderObservation,normalizeLaunchpad} from '../dist/coin-stages.mjs';
import {refreshLaunchpad,selectLaunchCandidates} from '../worker/coin-collector.mjs';

test('launch stage cannot be overridden by price recovery or high volume',()=>{
 const now=Date.now(),live={marketUpdatedAt:now,poolCreated:now-3600000,liquidity:5000,recentVolume1h:100,sustainedAt:now-1000,successScenario:'continuation'};
 for(const extra of [{},{...live},{...live,laterRecoveryAt:now-500}, {...live,ruggedAt:now}]){
  assert.equal(stageFor({...extra,volume:1000000}),'unknown');
  assert.equal(stageFor({...extra,launchpad:{graduationPercentage:79.99,completed:false}}),'new');
  assert.equal(stageFor({...extra,launchpad:{graduationPercentage:80,completed:false}}),'stretch');
  assert.equal(stageFor({...extra,launchpad:{graduationPercentage:99.99,completed:false}}),'stretch');
  assert.equal(stageFor({...extra,launchpad:{graduationPercentage:100,completed:false}}),'stretch');
  assert.equal(stageFor({...extra,launchpad:{graduationPercentage:100,completed:true}}),'migrated');
 }
 assert.equal(stageFor({launchpad:{graduationPercentage:95}}),'unknown');
 assert.equal(stageFor({launchpad:{graduationPercentage:null,completed:false}}),'unknown');
 assert.equal(recoveryFor(live,now),'sustained');
 assert.equal(graduationSplit({...live,launchpad:{graduationPercentage:90,completed:false}},now),null);
 const graduated={...live,launchpad:{completed:true},graduationObservedAt:now-3600000};
 assert.equal(graduationSplit(graduated,now),'continuation');
 assert.equal(graduationSplit({...graduated,successScenario:'rebound'},now),'rebound');
 assert.equal(graduationSplit({...graduated,laterRecoveryAt:now},now),'later');
 assert.equal(graduationSplit({...graduated,sustainedAt:null,graduationObservedAt:now-1000},now),'tracking');
 assert.equal(graduationSplit({...graduated,marketUpdatedAt:1},now),'other');
});

test('Observed recovery requires fresh timestamp, liquidity and trading in the past hour',()=>{
 const coin={marketUpdatedAt:3000,sustainedAt:2000,poolCreated:1000,liquidity:5000,recentVolume1h:100};
 assert.equal(recoveryFor(coin,3000),'sustained');
 assert.equal(recoveryFor({...coin,liquidity:0},3000),null);
 assert.equal(recoveryFor({...coin,recentVolume1h:0},3000),null);
 assert.equal(recoveryFor({...coin,liquidity:2999},3000),null);
 assert.equal(recoveryFor({...coin,recentVolume1h:undefined,volume5m:20},3000),'sustained');
 assert.equal(recoveryFor({...coin,marketUpdatedAt:3000},3000+16*60000),null);
});

test('recent completed coins remain under observation without being called Sustained',()=>{
 const now=1000000000,coin={launchpad:{completed:true},graduationObservedAt:now-20*60000};
 assert.equal(stageFor(coin),'migrated');
 assert.equal(isUnderObservation(coin,now),true);
 assert.equal(isUnderObservation({...coin,graduationObservedAt:now-46*60000},now),false);
 assert.equal(isUnderObservation({...coin,sustainedAt:now-1000},now),false);
 assert.equal(isUnderObservation({...coin,ruggedAt:now-1000},now),false);
});

test('launchpad checks rotate older contracts while retaining new and near-graduation coins',()=>{
 const coins=Array.from({length:8},(_,i)=>({id:String(i),firstSeen:100-i,launchpadCheckedAt:i<6?100:0}));
 coins[5].launchpad={graduationPercentage:90,completed:false};
 assert.deepEqual(selectLaunchCandidates(coins,4).map(c=>c.id),['0','1','5','6']);
});

test('new pairs take the first 80 launchpad slots ahead of the retained backlog',()=>{
 const coins=Array.from({length:200},(_,i)=>({id:String(i),firstSeen:1000-i,launchpadCheckedAt:i<100?100:0}));
 for(let i=80;i<100;i++)coins[i].launchpad={graduationPercentage:90,completed:false};
 const selected=selectLaunchCandidates(coins);
 assert.equal(selected.length,120);
 assert.deepEqual(selected.slice(0,80).map(c=>c.id),coins.slice(0,80).map(c=>c.id));
 assert.deepEqual(selected.slice(80,100).map(c=>c.id),coins.slice(80,100).map(c=>c.id));
 assert.deepEqual(selected.slice(100).map(c=>c.id),coins.slice(100,120).map(c=>c.id));
});

test('collector attaches launch progress to the exact token and retains prior data on missing response',()=>{
 const coins=[{id:'solana:AbC',network:'solana',contract_address:'AbC'},{id:'base:0xABC',network:'base',contract_address:'0xABC',launchpad:{graduationPercentage:85,completed:false}}];
 const tokens=[{id:'solana_AbC',attributes:{address:'AbC',launchpad_details:{graduation_percentage:91.4,completed:false}}}];
 const updated=refreshLaunchpad(coins,tokens,1234);
 assert.deepEqual(updated[0].launchpad,{graduationPercentage:91.4,completed:false,completedAt:null});
 assert.equal(updated[0].launchpadUpdatedAt,1234);
 assert.deepEqual(updated[1],coins[1]);
 assert.equal(normalizeLaunchpad({graduation_percentage:null,completed:false}),null);
 assert.equal(normalizeLaunchpad({graduation_percentage:100,completed:true,completed_at:'2026-09-26T00:00:00Z'}).completedAt,Date.parse('2026-09-26T00:00:00Z'));
 const [graduated]=refreshLaunchpad([{id:'solana:XYZ',network:'solana',contract_address:'XYZ'}],[{id:'solana_XYZ',attributes:{address:'XYZ',launchpad_details:{graduation_percentage:100,completed:true,completed_at:'2026-09-26T00:00:00Z'}}}],Date.parse('2026-09-26T00:05:00Z'));
 assert.equal(graduated.graduationObservedAt,Date.parse('2026-09-26T00:00:00Z'));
 const [retained]=refreshLaunchpad([graduated],[{id:'solana_XYZ',attributes:{address:'XYZ'}}],Date.parse('2026-09-26T00:10:00Z'));
 assert.deepEqual(retained.launchpad,graduated.launchpad);
});
