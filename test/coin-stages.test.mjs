import test from 'node:test';
import assert from 'node:assert/strict';
import {stageFor,isUnderObservation,normalizeLaunchpad} from '../dist/coin-stages.mjs';
import {refreshLaunchpad,selectLaunchCandidates} from '../worker/coin-collector.mjs';

test('discover stages require measured volume or launch progress',()=>{
 const live={liquidity:5000,recentVolume1h:100};
 assert.equal(stageFor({volume:49999}),'new');
 assert.equal(stageFor({volume:50000}),'migrated');
 assert.equal(stageFor({volume:1000,launchpad:{graduationPercentage:80,completed:false}}),'stretch');
 assert.equal(stageFor({volume:1000000,launchpad:{graduationPercentage:90,completed:false}}),'stretch');
 assert.equal(stageFor({volume:1000000,launchpad:{graduationPercentage:40,completed:false}}),'new');
 assert.equal(stageFor({volume:1000,launchpad:{graduationPercentage:79.99,completed:false}}),'new');
 assert.equal(stageFor({volume:1000,launchpad:{graduationPercentage:100,completed:true}}),'migrated');
 assert.equal(stageFor({...live,volume:1000,launchpad:{graduationPercentage:100,completed:true},sustainedAt:1234}),'sustained');
 assert.equal(stageFor({...live,volume:1000,launchpad:{graduationPercentage:100,completed:true},sustainedAt:1234,ruggedAt:1500}),'migrated');
 assert.equal(stageFor({...live,volume:1000,launchpad:{graduationPercentage:10,completed:false},sustainedAt:1234,successScenario:'continuation'}),'sustained');
 assert.equal(stageFor({...live,volume:1000,launchpad:{graduationPercentage:100,completed:true},ruggedAt:1234,laterRecoveryAt:1500}),'sustained');
 assert.equal(stageFor({...live,poolCreated:1000,sustainedAt:2000},1000+5*3600000),'sustained');
 assert.equal(stageFor({...live,poolCreated:1000,sustainedAt:2000},1000+7*3600000),'new');
 assert.equal(stageFor({...live,poolCreated:1000,sustainedAt:2000,laterRecoveryAt:3000},1000+7*3600000),'sustained');
 assert.equal(stageFor({volume:1000,launchpad:{graduationPercentage:95}}),'new');
});

test('Success requires liquidity and trading in the past hour',()=>{
 const coin={sustainedAt:2000,poolCreated:1000,liquidity:5000,recentVolume1h:100};
 assert.equal(stageFor(coin,3000),'sustained');
 assert.equal(stageFor({...coin,liquidity:0},3000),'new');
 assert.equal(stageFor({...coin,recentVolume1h:0},3000),'new');
 assert.equal(stageFor({...coin,liquidity:2999},3000),'new');
 assert.equal(stageFor({...coin,recentVolume1h:undefined,volume5m:20},3000),'sustained');
 assert.equal(stageFor({...coin,marketUpdatedAt:3000},3000+16*60000),'new');
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
 assert.deepEqual(selectLaunchCandidates(coins,4).map(c=>c.id),['5','0','6','7']);
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
