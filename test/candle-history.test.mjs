import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCandles,candleMarketCaps,createCandleHistory,CANDLE_MS,HISTORY_MS} from '../dist/candle-history.mjs';
const now=1800000000000;
const payload=rows=>({data:{attributes:{ohlcv_list:rows}}});
const candle=(time,close=.5,high=close,low=close,volume=100)=>[time/1000,close,high,low,close,volume];
test('candles preserve historical peaks and conserve volume without fabricating buy/sell flow',()=>{
  const rows=normalizeCandles(payload([candle(now-2*CANDLE_MS,5,10,.4,1000),candle(now-CANDLE_MS,.5,.6,.4,100)]),now);
  const result=candleMarketCaps(rows,{value:500000,price:.5});
  assert.equal(result.high,10000000);assert.equal(result.low,400000);
  assert.equal(result.tiers.reduce((s,t)=>s+t.volume,0),1100);
  assert.equal(result.tiers.reduce((s,t)=>s+t.count,0),2);
  assert.equal(result.tiers.find(t=>t.low===5000000).volume,1000);
  const wick=result.tiers.find(t=>t.low===10000000);assert.equal(wick.count,0);assert.equal(wick.volume,0);assert.equal(wick.touches,1);
  assert.equal(result.tiers[0].buy,undefined);assert.equal(result.tiers[0].sell,undefined);
});
test('only completed candles inside five days survive; invalid and duplicate rows never inflate totals',()=>{
  const good=candle(now-CANDLE_MS);
  const rows=normalizeCandles(payload([good,good,candle(now),candle(now-CANDLE_MS/2),candle(now-HISTORY_MS-1),candle(now-2*CANDLE_MS,.5,.1),candle(now-3*CANDLE_MS,.5,.5,.5,-1),[null,1,1,1,1,1]]),now);
  assert.equal(rows.length,1);assert.equal(rows[0].time,now-CANDLE_MS);
  assert.throws(()=>normalizeCandles({data:[]},now));
  assert.equal(candleMarketCaps(rows,null),null);
});
test('historical requests are cached, keyed by token and pool, and failures stay explicit',async()=>{
  let calls=0,changed=0,clock=now;
  const loader=createCandleHistory(async path=>{calls++;assert.match(path,/aggregate=15&limit=1000&currency=usd&token=/);if(path.includes('bad'))throw new Error('offline');return payload([candle(now-CANDLE_MS)])},()=>changed++,()=>clock);
  const token={network:'robinhood',address:'abc'},pool={address:'pool'};
  const first=loader.read(token,pool);assert.equal(first.status,'loading');assert.equal(loader.read(token,pool),first);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(first.status,'loaded');assert.equal(changed,1);
  loader.read(token,pool);assert.equal(calls,1);
  const failed=loader.read({...token,address:'bad'},pool);await new Promise(resolve=>setImmediate(resolve));assert.equal(failed.status,'failed');assert.equal(failed.message,'offline');
  clock+=300001;loader.read(token,pool);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,3);
});
