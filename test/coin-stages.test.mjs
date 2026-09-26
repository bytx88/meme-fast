import test from 'node:test';
import assert from 'node:assert/strict';
import {stageFor,normalizeLaunchpad} from '../dist/coin-stages.mjs';
import {refreshLaunchpad} from '../worker/coin-collector.mjs';

test('discover stages require measured volume or launch progress',()=>{
 assert.equal(stageFor({volume:49999}),'new');
 assert.equal(stageFor({volume:50000}),'migrated');
 assert.equal(stageFor({volume:1000,launchpad:{graduationPercentage:80,completed:false}}),'stretch');
 assert.equal(stageFor({volume:1000,launchpad:{graduationPercentage:79.99,completed:false}}),'new');
 assert.equal(stageFor({volume:1000,launchpad:{graduationPercentage:100,completed:true}}),'migrated');
 assert.equal(stageFor({volume:1000,launchpad:{graduationPercentage:95}}),'new');
});

test('collector attaches launch progress to the exact token and retains prior data on missing response',()=>{
 const coins=[{id:'solana:AbC',network:'solana',contract_address:'AbC'},{id:'base:0xABC',network:'base',contract_address:'0xABC',launchpad:{graduationPercentage:85,completed:false}}];
 const tokens=[{id:'solana_AbC',attributes:{address:'AbC',launchpad_details:{graduation_percentage:91.4,completed:false}}}];
 const updated=refreshLaunchpad(coins,tokens,1234);
 assert.deepEqual(updated[0].launchpad,{graduationPercentage:91.4,completed:false});
 assert.equal(updated[0].launchpadUpdatedAt,1234);
 assert.deepEqual(updated[1],coins[1]);
 assert.equal(normalizeLaunchpad({graduation_percentage:null,completed:false}),null);
});
