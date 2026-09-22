import test from 'node:test';
import assert from 'node:assert/strict';
import {marketCapSnapshot,marketCapTimeline} from '../dist/market-cap.mjs';
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
