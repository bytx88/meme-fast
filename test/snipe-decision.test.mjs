import test from 'node:test';
import assert from 'node:assert/strict';
import {assessEntry,compactFlow,DEFAULT_ENTRY} from '../dist/snipe-decision.mjs';

const now=1800000000000;
const coin={poolCreated:now-10*60000,firstSeen:now-8*60000,marketUpdatedAt:now-60000,liquidity:25000,volume5m:5000,buys5m:12,sells5m:6,
 flowSamples:[{at:now-6*60000,volume5m:3500,buys5m:9,sells5m:5,liquidity:25000},{at:now-60000,volume5m:5000,buys5m:12,sells5m:6,liquidity:25000}]};

test('entry screen exposes timing, size pressure, and overlapping-window flow change',()=>{
 const result=assessEntry(coin,DEFAULT_ENTRY,now);
 assert.equal(result.passesScreen,true);
 assert.equal(result.detectionLagMinutes,2);
 assert.equal(result.sizeLiquidityPercent,1);
 assert.equal(result.volumeChange,1500);
 assert.equal(result.buysChange,3);
 assert.equal(result.liquidityChange,0);
 assert.equal(result.executionVerified,false);
 assert.equal(result.contractRiskVerified,false);
});

test('missing or stale data cannot pass the entry screen',()=>{
 assert.deepEqual(assessEntry({...coin,marketUpdatedAt:now-7*60000},DEFAULT_ENTRY,now).reasons,['Market stale']);
 const missing=assessEntry({...coin,marketUpdatedAt:null,liquidity:null,buys5m:null,sells5m:null},DEFAULT_ENTRY,now);
 assert.equal(missing.passesScreen,false);
 assert.ok(missing.reasons.includes('Market stale'));
 assert.ok(missing.reasons.includes('Sell pressure'));
});

test('flow projection retains only two newest finite samples',()=>{
 assert.deepEqual(compactFlow([{at:10,volume5m:1},{at:30,volume5m:3},{at:20,volume5m:2},{at:'bad'}]).map(row=>row.at),[20,30]);
});
