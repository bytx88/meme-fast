import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateMC,mcTier,tierMetric,tierRead} from '../dist/mc-detail.mjs';
import {summarize} from '../dist/core.mjs';
const snapshot={value:500000,price:.5,tokenKey:'solana:ABC'};
const trade=(id,price,side,usd,time=600000)=>({id,tokenKey:snapshot.tokenKey,price,side,usd,time});
test('tiers adapt by magnitude and use exclusive upper boundaries',()=>{
  for(const value of [500000,10000000,100000000,.0005]){const t=mcTier(value);assert.ok(t.low<=value&&t.high>value);assert.ok(t.high/t.low<=1.34)}
  assert.deepEqual(mcTier(400000),{low:400000,high:500000});
  assert.deepEqual(mcTier(500000),{low:500000,high:600000});
});
test('aggregation conserves totals and excludes missing prices and other tokens',()=>{
  const rows=[trade('a',.4,'buy',100),trade('b',.45,'sell',30),trade('c',.5,'buy',10),trade('d',null,'buy',999),{...trade('e',.4,'buy',999),tokenKey:'other'}];
  const result=aggregateMC(rows,snapshot);assert.equal(result.included,3);assert.equal(result.excluded,2);
  assert.equal(result.tiers.length,2);assert.equal(result.tiers[1].buy,100);assert.equal(result.tiers[1].sell,30);
  assert.deepEqual(tierMetric(result.tiers[1]),{buy:100,sell:30,net:70});
  assert.deepEqual(tierMetric(result.tiers[1],'count'),{buy:1,sell:1,net:0});
});
test('average difference uses per-side denominators and missing sides remain unknown',()=>{
  const tier={buy:100,sell:80,buyCount:2,sellCount:4};
  assert.deepEqual(tierMetric(tier,'average'),{buy:50,sell:20,net:30});
  assert.deepEqual(tierMetric({...tier,sell:0,sellCount:0},'average'),{buy:50,sell:null,net:null});
});
test('unavailable valuation is not interpreted as zero trading',()=>{
  for(const s of [null,{...snapshot,price:null},{...snapshot,value:0}])assert.equal(aggregateMC([trade('a',.4,'buy',100)],s).available,false);
});
test('selected time window and deduplication feed tier totals',()=>{
  const rows=[trade('a',.4,'buy',100),trade('a',.4,'buy',100),trade('b',.5,'sell',50,1)];
  assert.equal(aggregateMC(summarize(rows,5,600000).rows,snapshot).included,1);
  assert.equal(aggregateMC(summarize(rows,15,600000).rows,snapshot).included,2);
});
test('extreme ranges stay bounded while retaining all counts and dollars',()=>{
  const rows=Array.from({length:40},(_,i)=>trade(String(i),10**(i/4-5),'buy',i+1));
  const result=aggregateMC(rows,snapshot);assert.ok(result.tiers.length<=12);assert.equal(result.included,40);
  assert.equal(result.tiers.reduce((sum,t)=>sum+t.buy,0),820);
  assert.equal(result.tiers.reduce((sum,t)=>sum+t.buyCount,0),40);
});
test('read describes the chosen metric and activity without investment claims',()=>{
  assert.equal(tierRead({buy:80,sell:100,net:-20},'value',180,180),'Mild sell dominance');
  assert.equal(tierRead({buy:100,sell:99,net:1},'value',199,199),'Heavy two-way activity; nearly balanced');
  assert.equal(tierRead({buy:50,sell:20,net:30},'average',70,70),'Larger average buys');
});
