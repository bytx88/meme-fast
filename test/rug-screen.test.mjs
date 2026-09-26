import test from 'node:test';
import assert from 'node:assert/strict';
import {earlyRampWarning} from '../dist/rug-screen.mjs';
import {snapshotView} from '../worker/snapshot-view.mjs';

const created=1790453285000;
const rows=[
 [1790453421784,0.00001395,24269.82,272,65],
 [1790453720967,0.00001853,28016.51,356,89],
 [1790454020816,0.00002299,31275.76,367,90],
 [1790454319231,0.00002532,32886.15,201,88],
 [1790454627407,0.00003127,36645.88,99,91],
].map(([at,priceUsd,liquidity,buys5m,sells5m])=>({at,priceUsd,liquidity,buys5m,sells5m}));
const paid={id:'solana:GuSJT9AjxMpzSPR14V6g5aegrQg8tffRV3LeKVdq382W',poolCreated:created,firstSeen:rows[0].at,marketHistory:rows};
const now=rows.at(-1).at;

test('PAID early ramp is shown as a caution pattern before any drawdown',()=>{
 assert.deepEqual(earlyRampWarning(paid,now),{risePercent:124,minutes:20});
 const projected=snapshotView({coins:[paid],radarCoins:[],lastRun:now},'coin',[],now).coins[0];
 assert.deepEqual(projected.earlyRampWarning,{risePercent:124,minutes:20});
 assert.equal('marketHistory' in projected,false);
});

test('missing or stale samples and ordinary gains do not create a ramp warning',()=>{
 assert.equal(earlyRampWarning({...paid,marketHistory:rows.slice(1)},now),null);
 assert.equal(earlyRampWarning(paid,now+11*60000),null);
 assert.deepEqual(earlyRampWarning({...paid,marketHistory:[...rows,{...rows.at(-1),at:now+10*60000,priceUsd:0.000043}]},now+10*60000),{risePercent:124,minutes:20});
 assert.equal(earlyRampWarning({...paid,marketHistory:rows.map((row,index)=>({...row,priceUsd:0.000014+index*0.000001}))},now),null);
 assert.equal(earlyRampWarning({...paid,marketHistory:rows.map(row=>({...row,liquidity:80000}))},now),null);
 assert.equal(earlyRampWarning({...paid,ruggedAt:now},now),null);
});
