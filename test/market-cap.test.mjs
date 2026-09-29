import test from 'node:test';
import assert from 'node:assert/strict';
import {marketCapSnapshot,marketCapTimeline,tokenPriceSnapshot} from '../dist/market-cap.mjs';
import {formatUnitPrice} from '../dist/unit-price.mjs';
const token={network:'solana',address:'ABC'};
const pool=(base,cap,price,liquidity=100)=>({attributes:{market_cap_usd:cap,base_token_price_usd:price,reserve_in_usd:liquidity,fdv_usd:999999},relationships:{base_token:{data:{id:'solana_'+base}},quote_token:{data:{id:'solana_ABC'}}}});
test('MC uses the selected base token, skips unknown valuations and never substitutes FDV',()=>{
  assert.equal(marketCapSnapshot(token,[pool('OTHER',100,1)]),null);
  assert.equal(marketCapSnapshot(token,[pool('ABC',null,1)]),null);
  const result=marketCapSnapshot(token,[pool('ABC',null,1,200),pool('ABC',2000,2)],123);
  assert.equal(result.value,2000);assert.equal(result.price,2);assert.equal(result.fetchedAt,123);
});
test('Estimated MC uses latest observed price per bin, preserves gaps and excludes other contracts',()=>{
  const snapshot={value:2000,price:2,tokenKey:'solana:ABC'};
  const rows=[{tokenKey:'solana:ABC',time:2,price:1},{tokenKey:'solana:ABC',time:9,price:3},{tokenKey:'solana:OTHER',time:8,price:100},{tokenKey:'solana:ABC',time:30,price:4}];
  const bins=[{start:0,end:10},{start:10,end:20},{start:20,end:30}];
  assert.deepEqual(marketCapTimeline(rows,bins,snapshot),[3000,null,4000]);
  assert.deepEqual(marketCapTimeline(rows,bins,{...snapshot,price:null}),[null,null,null]);
});
test('Unit price comes from the most liquid matching base pool even without MC',()=>{
  assert.equal(tokenPriceSnapshot(token,[pool('OTHER',100,5)]),null);
  const price=tokenPriceSnapshot(token,[pool('ABC',null,0.00153,200),pool('ABC',2000,0.002,100)],123);
  assert.equal(price.value,0.00153);assert.equal(price.fetchedAt,123);
});
test('Unit price uses three decimals above 0.1 and compact four-significant-figure notation below one cent',()=>{
  assert.equal(formatUnitPrice(1.23456),'$1.235');
  assert.equal(formatUnitPrice(0.12345),'$0.123');
  assert.equal(formatUnitPrice(0.015345),'$.01535');
  assert.equal(formatUnitPrice(0.001458),'$.01458 (e-1)');
  assert.equal(formatUnitPrice(0.00153),'$.0153 (e-1)');
  assert.equal(formatUnitPrice(0.0001458),'$.01458 (e-2)');
  assert.equal(formatUnitPrice(0.00000012345),'$.01235 (e-5)');
  assert.equal(formatUnitPrice(null),'—');
});
