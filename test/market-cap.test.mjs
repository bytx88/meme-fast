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
  const rows=[{tokenKey:'solana:ABC',time:2,price:1,usd:100},{tokenKey:'solana:ABC',time:9,price:3,usd:100},{tokenKey:'solana:OTHER',time:8,price:100,usd:100},{tokenKey:'solana:ABC',time:30,price:4,usd:100}];
  const bins=[{start:0,end:10},{start:10,end:20},{start:20,end:30}];
  assert.deepEqual(marketCapTimeline(rows,bins,snapshot),[3000,null,4000]);
  assert.deepEqual(marketCapTimeline(rows,bins,{...snapshot,price:null}),[null,null,null]);
});
test('Estimated MC line omits sparse thin-pool anomalies in the selected rows',()=>{
  const snapshot={value:500000,price:.5,tokenKey:'solana:ABC'};
  const rows=[{tokenKey:'solana:ABC',time:1,price:.5,usd:100},{tokenKey:'solana:ABC',time:2,price:.51,usd:100},{tokenKey:'solana:ABC',time:11,price:.025,usd:2}];
  assert.deepEqual(marketCapTimeline(rows,[{start:0,end:10},{start:10,end:20}],snapshot),[510000,null]);
});
test('Unit price comes from the most liquid matching base pool even without MC',()=>{
  assert.equal(tokenPriceSnapshot(token,[pool('OTHER',100,5)]),null);
  const price=tokenPriceSnapshot(token,[pool('ABC',null,0.00153,200),pool('ABC',2000,0.002,100)],123);
  assert.equal(price.value,0.00153);assert.equal(price.fetchedAt,123);
});
test('Unit price shares magnitude rounding and inline e-N notation with Smartness',()=>{
  assert.equal(formatUnitPrice(12.345678),'$12.3457');
  assert.equal(formatUnitPrice(1.2345678),'$1.23457');
  assert.equal(formatUnitPrice(0.12345678),'$0.123457');
  assert.equal(formatUnitPrice(0.012345678),'$0.012346');
  assert.equal(formatUnitPrice(0.0012345678),'$0.012346e-1');
  assert.equal(formatUnitPrice(0.00012345678),'$0.012346e-2');
  assert.equal(formatUnitPrice(0.00153),'$0.0153e-1');
  assert.equal(formatUnitPrice(0),'$0');
  assert.equal(formatUnitPrice(-1),'—');
  assert.equal(formatUnitPrice(null),'—');
});
