import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePostMigration} from '../dist/post-migration.mjs';
import {updateMigrationStates} from '../worker/coin-collector.mjs';

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
 assert.equal(evaluatePostMigration(coin([1,1.5,2,0.8,0.9]),start+20*60000),null);
 assert.equal(evaluatePostMigration(coin([1,1.5,2,0.8,0.9,1]),start+25*60000),null);
 const result=evaluatePostMigration(coin([1,1.5,2,0.8,0.9,1]),start+30*60000);
 assert.equal(result.state,'sustained');
 assert.equal(updateMigrationStates([coin([1,1.5,2,0.8,0.9,1])],start+30*60000)[0].sustainedAt,start+25*60000);
});

test('a new deeper retrace removes Sustained and a later 78 percent fall flags Rugged',()=>{
 const [sustained]=updateMigrationStates([coin([1,1.5,2,0.8,0.9,1])],start+30*60000);
 const [weakened]=updateMigrationStates([{...sustained,...coin([1,1.5,2,0.8,0.9,1,0.5]),priceUpdatedAt:start+30*60000}],start+30*60000);
 assert.equal(weakened.sustainedAt,null);
 const [rugged]=updateMigrationStates([{...weakened,...coin([1,1.5,2,0.8,0.9,1,0.5,0.4])}],start+35*60000);
 assert.equal(rugged.rugDrawdownPercent,80);
});

test('a coin without a pullback is not called Sustained',()=>{
 assert.equal(evaluatePostMigration(coin([1,1.1,1.2,1.3,1.4,1.5,1.6]),start+30*60000),null);
});

test('the 45-minute outcome stays fixed after the observation window',()=>{
 const observed=coin([1,1.5,2,0.8,0.9,1,1,1,1]);
 assert.equal(evaluatePostMigration(observed,start+45*60000).state,'sustained');
 assert.equal(evaluatePostMigration(observed,start+60*60000).state,'sustained');
});

test('missing early prices cannot be classified from a late snapshot',()=>{
 const late={...coin([]),marketHistory:[sample(15,1),sample(20,1.2),sample(25,1.3),sample(30,1.4)]};
 assert.equal(evaluatePostMigration(late,start+30*60000),null);
});
